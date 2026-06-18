import {
  assertSecretBundleSubmission,
  assertSessionEnvelope,
  isValidSessionId,
  verifySecretUploadProof
} from "../shared/cloud-protocol";

type R2ObjectBodyLike = {
  text: () => Promise<string>;
};

type R2BucketLike = {
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  put: (
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string };
      onlyIf?: { etagDoesNotMatch?: string };
    }
  ) => Promise<unknown | null>;
};

type AssetsBindingLike = {
  fetch: (request: Request) => Promise<Response>;
};

export type WorkerEnv = {
  LOOPMARK_SESSIONS: R2BucketLike;
  ASSETS: AssetsBindingLike;
};

const MAX_JSON_BODY_LENGTH = 1024 * 1024;

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: "Unexpected Loopmark Worker error." }, 500);
    }
  }
};

export default worker;

async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "loopmark", protocol: 1 });
  }

  if (url.pathname === "/api/sessions" && request.method === "POST") {
    return createSession(request, env);
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (sessionMatch && request.method === "GET") {
    return getSession(env, sessionMatch[1]);
  }

  const secretMatch = /^\/api\/sessions\/([^/]+)\/secrets$/.exec(url.pathname);
  if (secretMatch && request.method === "POST") {
    return putSecretBundle(request, env, secretMatch[1]);
  }

  if (secretMatch && request.method === "GET") {
    return getSecretBundle(env, secretMatch[1]);
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }

  return env.ASSETS.fetch(request);
}

async function createSession(request: Request, env: WorkerEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return json({ error: body.message }, 400);
  }

  try {
    assertSessionEnvelope(body.value);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Session envelope is invalid." }, 400);
  }

  const sessionId = body.value.sessionId;
  if (!isValidSessionId(sessionId)) {
    return json({ error: "Session id is invalid." }, 400);
  }

  const key = sessionKey(sessionId);
  const written = await env.LOOPMARK_SESSIONS.put(key, JSON.stringify(body.value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    onlyIf: { etagDoesNotMatch: "*" }
  });
  if (written === null) {
    return json({ error: "Loopmark session already exists." }, 409);
  }

  return json({ ok: true, sessionId }, 201);
}

async function getSession(env: WorkerEnv, sessionId: string): Promise<Response> {
  if (!isValidSessionId(sessionId)) {
    return json({ error: "Session id is invalid." }, 400);
  }

  const object = await env.LOOPMARK_SESSIONS.get(sessionKey(sessionId));
  if (!object) {
    return json({ error: "Loopmark session was not found." }, 404);
  }

  return jsonText(await object.text(), 200);
}

async function putSecretBundle(request: Request, env: WorkerEnv, sessionId: string): Promise<Response> {
  if (!isValidSessionId(sessionId)) {
    return json({ error: "Session id is invalid." }, 400);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return json({ error: body.message }, 400);
  }

  try {
    assertSecretBundleSubmission(body.value);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Secret submission is invalid." }, 400);
  }

  if (body.value.sessionId !== sessionId) {
    return json({ error: "Secret submission session id does not match the URL." }, 400);
  }

  const sessionObject = await env.LOOPMARK_SESSIONS.get(sessionKey(sessionId));
  if (!sessionObject) {
    return json({ error: "Loopmark session was not found." }, 404);
  }

  let sessionEnvelope: unknown;
  try {
    sessionEnvelope = JSON.parse(await sessionObject.text()) as unknown;
    assertSessionEnvelope(sessionEnvelope);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Stored Loopmark session is invalid." }, 500);
  }

  const authorized = await verifySecretUploadProof({
    secretUploadProof: body.value.secretUploadProof,
    secretUploadProofHash: sessionEnvelope.secretUploadProofHash
  });
  if (!authorized) {
    return json({ error: "Secret upload proof is invalid." }, 403);
  }

  const written = await env.LOOPMARK_SESSIONS.put(secretBundleKey(sessionId), JSON.stringify(body.value.envelope), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    onlyIf: { etagDoesNotMatch: "*" }
  });
  if (written === null) {
    return json({ error: "Loopmark secret bundle already exists." }, 409);
  }

  return json({ ok: true, sessionId }, 201);
}

async function getSecretBundle(env: WorkerEnv, sessionId: string): Promise<Response> {
  if (!isValidSessionId(sessionId)) {
    return json({ error: "Session id is invalid." }, 400);
  }

  const object = await env.LOOPMARK_SESSIONS.get(secretBundleKey(sessionId));
  if (!object) {
    return json({ error: "Loopmark secret bundle was not found." }, 404);
  }

  return jsonText(await object.text(), 200);
}

function sessionKey(sessionId: string): string {
  return `sessions/${sessionId}/session.json`;
}

function secretBundleKey(sessionId: string): string {
  return `sessions/${sessionId}/secrets.json`;
}

async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_JSON_BODY_LENGTH) {
    return { ok: false, message: "Request body is too large." };
  }

  const text = await request.text();
  if (text.length > MAX_JSON_BODY_LENGTH) {
    return { ok: false, message: "Request body is too large." };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
}

function json(value: unknown, status = 200): Response {
  return jsonText(JSON.stringify(value), status);
}

function jsonText(value: string, status: number): Response {
  return new Response(value, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
