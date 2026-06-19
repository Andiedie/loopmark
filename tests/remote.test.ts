import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteSession, downloadRemoteSecrets } from "../src/cli/remote";
import { normalizeSession } from "../src/shared/schema";
import {
  decryptSessionEnvelope,
  deriveSessionId,
  encryptSecretBundleEnvelope,
  extractSessionCodeFromHash,
  type SecretBundle,
  type SecretBundleEnvelope,
  type SessionEnvelope
} from "../src/shared/cloud-protocol";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "loopmark-remote-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("remote CLI client", () => {
  it("creates a receipt and downloads remote secrets into an env file by session id", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname === "/api/sessions/s_PLACEHOLDER/secrets") {
        return new Response("wrong path", { status: 500 });
      }

      if (url.pathname.endsWith("/secrets") && init?.method !== "POST") {
        if (!store.secrets) {
          return new Response(JSON.stringify({ error: "not ready" }), { status: 404 });
        }
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "scope", label: "Scope", type: "text" },
        { id: "api_key", label: "API key", type: "text", secret: true }
      ]
    });

    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });

    expect(created.status).toBe("created");
    expect(created.fillUrl).toMatch(/^https:\/\/loopmark\.test\/s#lm1_/);
    expect(await readFile(created.receiptFile, "utf8")).toContain(created.sessionId);
    expect(store.session).toBeDefined();

    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    expect(sessionCode).not.toBeNull();
    await expect(deriveSessionId(sessionCode!)).resolves.toBe(created.sessionId);
    const decryptedSession = await decryptSessionEnvelope(sessionCode!, store.session!);
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          api_key: {
            value: "secret-from-remote-test"
          }
        }
      }
    });

    const downloaded = await downloadRemoteSecrets(created.sessionId, {
      receiptDir: tempDir,
      secretDir: tempDir,
      fetch: fetchMock
    });

    expect(downloaded).toEqual({
      status: "secrets_downloaded",
      sessionId: created.sessionId,
      secretFile: join(tempDir, "secrets.env"),
      format: "env",
      preview: {
        kind: "env_redacted",
        text: "api_key=<redacted>\n"
      }
    });
    expect(JSON.stringify(downloaded)).not.toContain("secret-from-remote-test");
    expect(await readFile(downloaded.secretFile, "utf8")).toBe("api_key=secret-from-remote-test\n");
  });

  it("writes only declared secret fields with stable env keys", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname.endsWith("/secrets")) {
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "scope", label: "Scope", type: "text" },
        { id: "api key", label: "API key", type: "text", secret: true },
        { id: "123token", label: "Numeric token", type: "text", secret: true },
        { id: "$$$", label: "Fallback key", type: "text", secret: true },
        { id: "note_only", label: "Note only", type: "text", secret: true },
        { id: "missing_secret", label: "Missing secret", type: "text", secret: true }
      ]
    });
    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });
    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    if (!sessionCode || !store.session) {
      throw new Error("Expected created remote session.");
    }
    const decryptedSession = await decryptSessionEnvelope(sessionCode, store.session);
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          "api key": { value: "needs quotes" },
          "123token": { value: "plain-token" },
          "$$$": { value: "fallback" },
          unknown_secret: { value: "ignored" }
        }
      }
    });

    const downloaded = await downloadRemoteSecrets(created.sessionId, {
      receiptFile: created.receiptFile,
      secretDir: tempDir,
      fetch: fetchMock
    });

    expect(await readFile(downloaded.secretFile, "utf8")).toBe(
      'api_key="needs quotes"\n_123token=plain-token\nSECRET=fallback\n'
    );
    expect(downloaded.preview).toEqual({
      kind: "env_redacted",
      text: "api_key=<redacted>\n_123token=<redacted>\nSECRET=<redacted>\n"
    });
    expect(JSON.stringify(downloaded.preview)).not.toContain("needs quotes");
    expect(JSON.stringify(downloaded.preview)).not.toContain("plain-token");
    expect(JSON.stringify(downloaded.preview)).not.toContain("fallback");
  });

  it("rejects decrypted secret bundles with malformed secret values", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname.endsWith("/secrets")) {
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });
    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    if (!sessionCode || !store.session) {
      throw new Error("Expected created remote session.");
    }
    const decryptedSession = await decryptSessionEnvelope(sessionCode, store.session);
    const malformedBundle = {
      secrets: {
        api_key: { value: 42 }
      }
    } as unknown as SecretBundle;
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: malformedBundle
    });

    await expect(
      downloadRemoteSecrets(created.sessionId, {
        receiptFile: created.receiptFile,
        secretDir: tempDir,
        fetch: fetchMock
      })
    ).rejects.toThrow("Decrypted Loopmark secret bundle is invalid.");
  });

  it("rejects secret bundles that contain no declared secret values", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname.endsWith("/secrets")) {
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });
    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    if (!sessionCode || !store.session) {
      throw new Error("Expected created remote session.");
    }
    const decryptedSession = await decryptSessionEnvelope(sessionCode, store.session);
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          unknown_secret: { value: "ignored" }
        }
      }
    });

    await expect(
      downloadRemoteSecrets(created.sessionId, {
        receiptFile: created.receiptFile,
        secretDir: tempDir,
        fetch: fetchMock
      })
    ).rejects.toThrow("Loopmark secret bundle did not contain any declared secret values.");
  });

  it("rejects receipts whose secret fields collide as env keys", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname.endsWith("/secrets")) {
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "api-key", label: "API key", type: "text", secret: true },
        { id: "api key 2", label: "Second API key", type: "text", secret: true }
      ]
    });
    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });
    const receipt = JSON.parse(await readFile(created.receiptFile, "utf8")) as {
      session: { groups: Array<{ fields: Array<{ id: string }> }> };
    };
    receipt.session.groups[0].fields[1].id = "api_key";
    await writeFile(created.receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    if (!sessionCode || !store.session) {
      throw new Error("Expected created remote session.");
    }
    const decryptedSession = await decryptSessionEnvelope(sessionCode, store.session);
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          "api-key": { value: "first" },
          api_key: { value: "second" }
        }
      }
    });

    await expect(
      downloadRemoteSecrets(created.sessionId, {
        receiptFile: created.receiptFile,
        secretDir: tempDir,
        fetch: fetchMock
      })
    ).rejects.toThrow("Loopmark secret fields map to duplicate env key: api_key.");
  });

  it("rejects receipts with malformed private keys before decrypting secrets", async () => {
    const store: { session?: SessionEnvelope; secrets?: SecretBundleEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (url.pathname.endsWith("/secrets")) {
        return new Response(JSON.stringify(store.secrets), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });
    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: fetchMock
    });
    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    if (!sessionCode || !store.session) {
      throw new Error("Expected created remote session.");
    }
    const decryptedSession = await decryptSessionEnvelope(sessionCode, store.session);
    store.secrets = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: { secrets: { api_key: { value: "secret" } } }
    });
    const receipt = JSON.parse(await readFile(created.receiptFile, "utf8")) as {
      answerPrivateKey: unknown;
    };
    receipt.answerPrivateKey = {};
    await writeFile(created.receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(
      downloadRemoteSecrets(created.sessionId, {
        receiptFile: created.receiptFile,
        secretDir: tempDir,
        fetch: fetchMock
      })
    ).rejects.toThrow("Loopmark receipt is invalid.");
  });

  it("reports failed remote responses and invalid receipts", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });

    await expect(
      createRemoteSession(session, {
        baseUrl: "https://loopmark.test",
        receiptDir: tempDir,
        fetch: async () => new Response(JSON.stringify({ error: "R2 unavailable" }), { status: 503 })
      })
    ).rejects.toThrow("R2 unavailable");

    await expect(
      createRemoteSession(session, {
        baseUrl: "https://loopmark.test",
        receiptDir: tempDir,
        fetch: async () => new Response("", { status: 500 })
      })
    ).rejects.toThrow("Unable to create Loopmark session. HTTP 500.");

    await expect(
      createRemoteSession(session, {
        baseUrl: "https://loopmark.test",
        receiptDir: tempDir,
        fetch: async () => new Response("plain failure", { status: 502 })
      })
    ).rejects.toThrow("plain failure");

    await expect(
      createRemoteSession(session, {
        baseUrl: "https://loopmark.test",
        receiptDir: tempDir,
        fetch: async () => new Response(JSON.stringify({ message: "non-standard error" }), { status: 502 })
      })
    ).rejects.toThrow("non-standard error");

    const badReceiptFile = join(tempDir, "bad.receipt.json");
    await writeFile(badReceiptFile, "{}");
    await expect(downloadRemoteSecrets("s_abcdefghijklmnopqrstuvwx", { receiptFile: badReceiptFile })).rejects.toThrow(
      "Loopmark receipt is invalid."
    );

    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 201 })
    });
    await expect(
      downloadRemoteSecrets(created.sessionId, {
        receiptFile: created.receiptFile,
        fetch: async () => new Response(JSON.stringify({ error: "Secret bundle expired" }), { status: 404 })
      })
    ).rejects.toThrow("Secret bundle expired");

    await expect(
      downloadRemoteSecrets("s_abcdefghijklmnopqrstuvwx", { receiptFile: created.receiptFile })
    ).rejects.toThrow("Loopmark receipt does not match the requested session id.");
  });

  it("rejects malformed session ids before reading default receipt paths", async () => {
    const receiptDir = join(tempDir, "receipts");
    const escapedReceiptFile = join(tempDir, "escaped.receipt.json");
    const escapedSessionId = "../escaped";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "should not fetch" }), { status: 500 }));
    await writeFile(
      escapedReceiptFile,
      `${JSON.stringify(
        {
          version: 1,
          baseUrl: "https://loopmark.test",
          fillUrl: "https://loopmark.test/s#lm1_test",
          sessionId: escapedSessionId,
          createdAt: "2026-06-18T00:00:00.000Z",
          session: normalizeSession({
            title: "Need input",
            fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
          }),
          answerPrivateKey: {}
        },
        null,
        2
      )}\n`
    );

    await expect(
      downloadRemoteSecrets(escapedSessionId, {
        receiptDir,
        secretDir: tempDir,
        fetch: fetchMock
      })
    ).rejects.toThrow("Loopmark session id is invalid.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
