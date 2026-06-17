import { describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "../src/server/worker";
import { normalizeSession } from "../src/shared/schema";
import {
  createAnswerSubmission,
  createRemoteSessionPackage,
  decryptSessionEnvelope,
  encryptAnswerEnvelope
} from "../src/shared/cloud-protocol";

class MemoryR2Object {
  constructor(private readonly value: string) {}

  async text(): Promise<string> {
    return this.value;
  }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, string>();

  async get(key: string): Promise<MemoryR2Object | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : new MemoryR2Object(value);
  }

  async put(
    key: string,
    value: string,
    options?: { onlyIf?: { etagDoesNotMatch?: string } }
  ): Promise<unknown | null> {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }
    this.objects.set(key, value);
    return { key };
  }
}

function createEnv(bucket = new MemoryR2Bucket()): WorkerEnv {
  return {
    LOOPMARK_SESSIONS: bucket,
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 })
    }
  };
}

describe("Cloudflare Worker API", () => {
  it("returns health and API 404 responses", async () => {
    const env = createEnv();

    const health = await worker.fetch(new Request("https://loopmark.test/api/health"), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "loopmark", protocol: 1 });

    const missing = await worker.fetch(new Request("https://loopmark.test/api/missing"), env);
    expect(missing.status).toBe(404);
  });

  it("stores an encrypted session, accepts one encrypted answer, and returns pending before submit", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text", required: true }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    const bucket = new MemoryR2Bucket();
    const env = createEnv(bucket);

    const createResponse = await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created.envelope)
      }),
      env
    );
    expect(createResponse.status).toBe(201);
    expect(bucket.objects.has(`sessions/${created.sessionId}/session.json`)).toBe(true);

    const sessionResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}`),
      env
    );
    expect(sessionResponse.status).toBe(200);
    const returnedEnvelope = await sessionResponse.json();
    await expect(decryptSessionEnvelope(created.sessionCode, returnedEnvelope)).resolves.toMatchObject({
      session: { title: "Need input" }
    });

    const pending = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`),
      env
    );
    expect(pending.status).toBe(202);

    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const answer = await encryptAnswerEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      payload: {
        answers: {
          scope: { type: "text", value: "MVP" }
        }
      }
    });
    const submission = await createAnswerSubmission({
      sessionCode: created.sessionCode,
      envelope: answer
    });
    const invalidProof = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...submission, answerProof: "invalid-proof" })
      }),
      env
    );
    expect(invalidProof.status).toBe(403);

    const submit = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission)
      }),
      env
    );
    expect(submit.status).toBe(201);

    const duplicate = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission)
      }),
      env
    );
    expect(duplicate.status).toBe(409);

    const collected = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`),
      env
    );
    expect(collected.status).toBe(200);
    expect(await collected.json()).toMatchObject({ kind: "loopmark.answer", sessionId: created.sessionId });
  });

  it("rejects invalid session ids, non-JSON bodies, invalid envelopes, and oversized bodies", async () => {
    const env = createEnv();

    const invalidId = await worker.fetch(new Request("https://loopmark.test/api/sessions/not-valid"), env);
    expect(invalidId.status).toBe(400);

    const invalidAnswerId = await worker.fetch(new Request("https://loopmark.test/api/sessions/not-valid/answer"), env);
    expect(invalidAnswerId.status).toBe(400);

    const invalidPostAnswerId = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/not-valid/answer", {
        method: "POST",
        body: "{}"
      }),
      env
    );
    expect(invalidPostAnswerId.status).toBe(400);

    const missingAnswerSession = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/answer"),
      env
    );
    expect(missingAnswerSession.status).toBe(404);

    const invalidJson = await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        body: "{bad"
      }),
      env
    );
    expect(invalidJson.status).toBe(400);

    const invalidEnvelope = await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1 })
      }),
      env
    );
    expect(invalidEnvelope.status).toBe(400);

    const invalidEnvelopeSessionId = await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          kind: "loopmark.session",
          sessionId: "not-valid",
          answerProofHash: "hash",
          salt: "salt",
          iv: "iv",
          ciphertext: "ciphertext"
        })
      }),
      env
    );
    expect(invalidEnvelopeSessionId.status).toBe(400);

    const tooLarge = await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-length": String(1024 * 1024 + 1) },
        body: "{}"
      }),
      env
    );
    expect(tooLarge.status).toBe(400);
  });

  it("returns a generic 500 when a binding throws unexpectedly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env: WorkerEnv = {
      LOOPMARK_SESSIONS: {
        get: async () => {
          throw new Error("R2 binding failed");
        },
        put: async () => ({})
      },
      ASSETS: {
        fetch: async () => new Response("asset")
      }
    };

    try {
      const response = await worker.fetch(new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx"), env);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "Unexpected Loopmark Worker error." });
      expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("serves static assets outside API routes", async () => {
    const response = await worker.fetch(new Request("https://loopmark.test/s"), createEnv());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
  });

  it("rejects duplicate sessions and malformed answer submissions", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    const env = createEnv();
    const createRequest = () =>
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created.envelope)
      });

    expect((await worker.fetch(createRequest(), env)).status).toBe(201);
    expect((await worker.fetch(createRequest(), env)).status).toBe(409);

    const missingSessionSubmit = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/answer", {
        method: "POST",
        body: "{}"
      }),
      env
    );
    expect(missingSessionSubmit.status).toBe(404);

    const invalidAnswer = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1 })
      }),
      env
    );
    expect(invalidAnswer.status).toBe(400);

    const invalidAnswerJson = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        body: "{bad"
      }),
      env
    );
    expect(invalidAnswerJson.status).toBe(400);

    const tooLargeAnswer = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1)
      }),
      env
    );
    expect(tooLargeAnswer.status).toBe(400);

    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const answer = await encryptAnswerEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      payload: { answers: {} }
    });
    const mismatchedAnswer = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          await createAnswerSubmission({
            sessionCode: created.sessionCode,
            envelope: { ...answer, sessionId: "s_abcdefghijklmnopqrstuvwx" }
          })
        )
      }),
      env
    );
    expect(mismatchedAnswer.status).toBe(400);
  });
});
