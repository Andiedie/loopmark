import { createReadStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFinalOutput, type FinalOutput } from "../shared/answers";
import { validateSubmitPayload } from "../shared/submission";
import type { NormalizedSession } from "../shared/schema";

export type LoopmarkServerOptions = {
  webRoot?: string;
  secretRoot?: string;
  host?: string;
};

export type RunningLoopmarkServer = {
  url: string;
  token: string;
  port: number;
  result: Promise<FinalOutput>;
  close: () => Promise<void>;
};

type SubmissionState = "open" | "submitting" | "settled";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const ROOT_STATIC_FILES = new Set([
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "icon-192.png",
  "icon-512.png",
  "site.webmanifest"
]);

const MAX_JSON_BODY_LENGTH = 1024 * 1024;

type JsonBodyReadResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      message: string;
    };

export async function startLoopmarkServer(
  session: NormalizedSession,
  options: LoopmarkServerOptions = {}
): Promise<RunningLoopmarkServer> {
  const token = randomUUID();
  const host = options.host ?? "127.0.0.1";
  const webRoot = options.webRoot ?? defaultWebRoot();
  const secretRoot = options.secretRoot ?? join(tmpdir(), `loopmark-${token}`);
  let submissionState: SubmissionState = "open";
  let resolveResult: (output: FinalOutput) => void;
  let rejectResult: (error: Error) => void;

  const result = new Promise<FinalOutput>((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });

  const server = createServer(async (request, response) => {
    try {
      await handleRequest({
        request,
        response,
        session,
        token,
        webRoot,
        secretRoot,
        canSubmit: () => submissionState === "open",
        claimSubmit: () => {
          if (submissionState !== "open") {
            return false;
          }

          submissionState = "submitting";
          return true;
        },
        settle: (output) => {
          submissionState = "settled";
          resolveResult(output);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      writeJson(response, 500, { error: message });
      rejectResult(error instanceof Error ? error : new Error(message));
    }
  });

  await listen(server, host);
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Unable to determine Loopmark server port.");
  }

  const url = `http://${host}:${address.port}/s/${token}`;

  return {
    url,
    token,
    port: address.port,
    result,
    close: () => closeServer(server)
  };
}

function defaultWebRoot(): string {
  const current = dirname(fileURLToPath(import.meta.url));
  return resolve(current, "../web");
}

function listen(server: Server, host: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    });
  });
}

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  session: NormalizedSession;
  token: string;
  webRoot: string;
  secretRoot: string;
  canSubmit: () => boolean;
  claimSubmit: () => boolean;
  settle: (output: FinalOutput) => void;
}) {
  const { request, response, session, token, webRoot, secretRoot, canSubmit, claimSubmit, settle } = input;
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (requestUrl.pathname === `/s/${token}` || requestUrl.pathname === `/s/${token}/`) {
    return serveFile(response, webRoot, "index.html");
  }

  if (requestUrl.pathname === "/api/session") {
    if (!isAuthorized(requestUrl, token)) {
      return writeJson(response, 403, { error: "Invalid session token." });
    }

    return writeJson(response, 200, session);
  }

  if (requestUrl.pathname === "/api/submit") {
    if (!isAuthorized(requestUrl, token)) {
      return writeJson(response, 403, { error: "Invalid session token." });
    }

    if (!canSubmit()) {
      return writeJson(response, 409, { error: "This Loopmark session has already been submitted." });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return writeJson(response, 400, { error: body.message });
    }

    const validation = validateSubmitPayload(session, body.value);
    if (!validation.ok) {
      return writeJson(response, 400, validation.report);
    }

    if (!claimSubmit()) {
      return writeJson(response, 409, { error: "This Loopmark session has already been submitted." });
    }

    await mkdir(secretRoot, { recursive: true, mode: 0o700 });
    const output = await buildFinalOutput(session, validation.payload, { secretDir: secretRoot });
    settle(output);
    return writeJson(response, 200, { ok: true });
  }

  if (requestUrl.pathname.startsWith("/assets/")) {
    return serveFile(response, webRoot, requestUrl.pathname.slice(1));
  }

  const rootStaticFile = requestUrl.pathname.slice(1);
  if (ROOT_STATIC_FILES.has(rootStaticFile)) {
    return serveFile(response, webRoot, rootStaticFile);
  }

  return writeJson(response, 404, { error: "Not found." });
}

function isAuthorized(url: URL, token: string): boolean {
  return url.searchParams.get("token") === token;
}

function readJsonBody(request: IncomingMessage): Promise<JsonBodyReadResult> {
  return new Promise((resolvePromise) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }

      body += chunk;
      if (body.length > MAX_JSON_BODY_LENGTH) {
        body = "";
        tooLarge = true;
      }
    });
    request.on("error", (error) => {
      resolvePromise({
        ok: false,
        message: error instanceof Error ? error.message : "Request body must be valid JSON."
      });
    });
    request.on("end", () => {
      if (tooLarge) {
        resolvePromise({ ok: false, message: "Request body is too large." });
        return;
      }

      try {
        resolvePromise({ ok: true, value: JSON.parse(body) as unknown });
      } catch {
        resolvePromise({ ok: false, message: "Request body must be valid JSON." });
      }
    });
  });
}

function serveFile(response: ServerResponse, root: string, relativePath: string) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, relativePath);

  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${sep}`)) {
    return writeJson(response, 404, { error: "Static asset not found." });
  }

  if (!existsSync(resolved)) {
    return writeJson(response, 404, { error: "Static asset not found." });
  }

  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(resolved)] ?? "application/octet-stream"
  });
  createReadStream(resolved).pipe(response);
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
