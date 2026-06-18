import { describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "../src/server/worker";
import { normalizeSession } from "../src/shared/schema";
import {
  createSecretBundleSubmission,
  createRemoteSessionPackage,
  decryptSecretBundleEnvelope,
  decryptSessionEnvelope,
  encryptSecretBundleEnvelope
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

  it("stores and returns an encrypted session without accepting answer storage", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
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

    const answerRoute = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/answer`),
      env
    );
    expect(answerRoute.status).toBe(404);
    expect(bucket.objects.has(`sessions/${created.sessionId}/answer.json`)).toBe(false);
  });

  it("stores encrypted secret bundles only with a valid upload proof", async () => {
    const session = normalizeSession({
      title: "Secret review",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const envelope = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          api_key: {
            value: "secret-from-worker-test"
          }
        }
      }
    });
    const submission = await createSecretBundleSubmission({
      sessionCode: created.sessionCode,
      sessionId: created.sessionId,
      envelope
    });
    const env = createEnv();

    const missingSessionResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission)
      }),
      env
    );
    expect(missingSessionResponse.status).toBe(404);

    await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created.envelope)
      }),
      env
    );

    const badProofResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...submission, secretUploadProof: "wrong-proof" })
      }),
      env
    );
    expect(badProofResponse.status).toBe(403);

    const uploadResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission)
      }),
      env
    );
    expect(uploadResponse.status).toBe(201);

    const downloadResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`),
      env
    );
    expect(downloadResponse.status).toBe(200);
    await expect(
      decryptSecretBundleEnvelope({
        receipt: created.receipt,
        envelope: await downloadResponse.json()
      })
    ).resolves.toEqual({
      secrets: {
        api_key: {
          value: "secret-from-worker-test"
        }
      }
    });
  });

  it("does not let a later secret upload overwrite the first submitted bundle", async () => {
    const session = normalizeSession({
      title: "Secret review",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const firstEnvelope = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          api_key: {
            value: "first-secret"
          }
        }
      }
    });
    const secondEnvelope = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          api_key: {
            value: "second-secret"
          }
        }
      }
    });
    const firstSubmission = await createSecretBundleSubmission({
      sessionCode: created.sessionCode,
      sessionId: created.sessionId,
      envelope: firstEnvelope
    });
    const secondSubmission = await createSecretBundleSubmission({
      sessionCode: created.sessionCode,
      sessionId: created.sessionId,
      envelope: secondEnvelope
    });
    const env = createEnv();

    await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created.envelope)
      }),
      env
    );

    const firstUpload = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(firstSubmission)
      }),
      env
    );
    expect(firstUpload.status).toBe(201);

    const secondUpload = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(secondSubmission)
      }),
      env
    );
    expect(secondUpload.status).toBe(409);

    const downloadResponse = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`),
      env
    );
    await expect(
      decryptSecretBundleEnvelope({
        receipt: created.receipt,
        envelope: await downloadResponse.json()
      })
    ).resolves.toEqual({
      secrets: {
        api_key: {
          value: "first-secret"
        }
      }
    });
  });

  it("rejects invalid session ids, non-JSON bodies, invalid envelopes, and oversized bodies", async () => {
    const env = createEnv();

    const invalidId = await worker.fetch(new Request("https://loopmark.test/api/sessions/not-valid"), env);
    expect(invalidId.status).toBe(400);

    const invalidAnswerId = await worker.fetch(new Request("https://loopmark.test/api/sessions/not-valid/answer"), env);
    expect(invalidAnswerId.status).toBe(404);

    const invalidPostAnswerId = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/not-valid/answer", {
        method: "POST",
        body: "{}"
      }),
      env
    );
    expect(invalidPostAnswerId.status).toBe(404);

    const missingAnswerSession = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/answer"),
      env
    );
    expect(missingAnswerSession.status).toBe(404);

    const invalidSecretId = await worker.fetch(new Request("https://loopmark.test/api/sessions/not-valid/secrets"), env);
    expect(invalidSecretId.status).toBe(400);

    const missingSecretBundle = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/secrets"),
      env
    );
    expect(missingSecretBundle.status).toBe(404);

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

    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSessionPackage({ session, baseUrl: "https://loopmark.test" });
    await worker.fetch(
      new Request("https://loopmark.test/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created.envelope)
      }),
      env
    );

    const malformedSecretSubmission = await worker.fetch(
      new Request(`https://loopmark.test/api/sessions/${created.sessionId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      env
    );
    expect(malformedSecretSubmission.status).toBe(400);

    const mismatchedSecretSubmission = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          kind: "loopmark.secret_submission",
          sessionId: created.sessionId,
          secretUploadProof: "proof",
          envelope: {
            version: 1,
            kind: "loopmark.secrets",
            sessionId: created.sessionId,
            ephemeralPublicKey: {},
            salt: "salt",
            iv: "iv",
            ciphertext: "ciphertext"
          }
        })
      }),
      env
    );
    expect(mismatchedSecretSubmission.status).toBe(400);
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

  it("rejects duplicate sessions and leaves answer routes unsupported", async () => {
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

    const answerPost = await worker.fetch(
      new Request("https://loopmark.test/api/sessions/s_abcdefghijklmnopqrstuvwx/answer", {
        method: "POST",
        body: "{}"
      }),
      env
    );
    expect(answerPost.status).toBe(404);
  });
});
