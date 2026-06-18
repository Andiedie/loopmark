import { describe, expect, it } from "vitest";
import { normalizeSession } from "../src/shared/schema";
import {
  assertSessionEnvelope,
  assertSecretBundleEnvelope,
  createSecretBundleSubmission,
  createRemoteSessionPackage,
  decryptSecretBundleEnvelope,
  decryptSessionEnvelope,
  deriveSessionId,
  encryptSecretBundleEnvelope,
  extractSessionCodeFromHash,
  parseRemoteSessionReceipt
} from "../src/shared/cloud-protocol";

describe("cloud protocol", () => {
  it("creates a short link code that decrypts the session but not the secret bundle", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "scope", label: "Scope", type: "text" },
        { id: "token", label: "Token", type: "text", secret: true }
      ]
    });

    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.example/base"
    });

    expect(created.fillUrl).toMatch(/^https:\/\/loopmark\.example\/s#lm1_/);
    expect(created.receipt.answerPrivateKey.d).toEqual(expect.any(String));
    expect(created.receipt.fillUrl).toBe(created.fillUrl);
    await expect(deriveSessionId(created.sessionCode)).resolves.toBe(created.sessionId);
    expect(extractSessionCodeFromHash(new URL(created.fillUrl).hash)).toBe(created.sessionCode);

    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    expect(decryptedSession.session.title).toBe("Need input");
    expect(decryptedSession.answerPublicKey.d).toBeUndefined();

    const secretBundle = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          token: { value: "secret-value" }
        }
      }
    });
    expect(JSON.stringify(secretBundle)).not.toContain("secret-value");

    const decryptedSecrets = await decryptSecretBundleEnvelope({
      receipt: created.receipt,
      envelope: secretBundle
    });
    expect(decryptedSecrets.secrets.token).toEqual({ value: "secret-value" });
  });

  it("rejects malformed receipts before decrypting secret bundles", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "token", label: "Token", type: "text", secret: true }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.example"
    });
    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const secretBundle = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: {
        secrets: {
          token: { value: "secret-value" }
        }
      }
    });

    await expect(
      decryptSecretBundleEnvelope({
        receipt: { ...created.receipt, answerPrivateKey: {} },
        envelope: secretBundle
      })
    ).rejects.toThrow("Loopmark receipt is invalid.");
  });

  it("rejects invalid link fragments", () => {
    expect(extractSessionCodeFromHash("")).toBeNull();
    expect(extractSessionCodeFromHash("#not-a-loopmark-code")).toBeNull();
  });

  it("rejects malformed secret bundle envelopes", () => {
    expect(() => assertSecretBundleEnvelope(null)).toThrow("Secret bundle envelope must be an object.");
    expect(() => assertSecretBundleEnvelope({ version: 1 })).toThrow("Secret bundle envelope is invalid.");
    expect(() =>
      assertSecretBundleEnvelope({
        version: 1,
        kind: "loopmark.secrets",
        sessionId: "s_abcdefghijklmnopqrstuvwx",
        ephemeralPublicKey: {},
        salt: "salt",
        iv: "iv",
        ciphertext: "ciphertext"
      })
    ).toThrow("Secret bundle envelope is invalid.");
    expect(() =>
      assertSecretBundleEnvelope({
        version: 1,
        kind: "loopmark.secrets",
        sessionId: "not-valid",
        ephemeralPublicKey: {
          kty: "EC",
          crv: "P-256",
          x: "x",
          y: "y"
        },
        salt: "salt",
        iv: "iv",
        ciphertext: "ciphertext"
      })
    ).toThrow("Secret bundle envelope is invalid.");
  });

  it("rejects malformed session envelopes", () => {
    expect(() => assertSessionEnvelope(null)).toThrow("Session envelope must be an object.");
    expect(() =>
      assertSessionEnvelope({
        version: 1,
        kind: "loopmark.session",
        sessionId: "not-valid",
        secretUploadProofHash: "proof-hash",
        salt: "salt",
        iv: "iv",
        ciphertext: "ciphertext"
      })
    ).toThrow("Session envelope is invalid.");
  });

  it("refuses to create secret transport objects with malformed session ids", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "token", label: "Token", type: "text", secret: true }]
    });
    const created = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    const decryptedSession = await decryptSessionEnvelope(created.sessionCode, created.envelope);
    const envelope = await encryptSecretBundleEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      bundle: { secrets: { token: { value: "secret" } } }
    });

    await expect(
      encryptSecretBundleEnvelope({
        sessionId: "bad;echo",
        answerPublicKey: decryptedSession.answerPublicKey,
        bundle: { secrets: { token: { value: "secret" } } }
      })
    ).rejects.toThrow("Loopmark session id is invalid.");
    await expect(
      encryptSecretBundleEnvelope({
        sessionId: created.sessionId,
        answerPublicKey: {},
        bundle: { secrets: { token: { value: "secret" } } }
      })
    ).rejects.toThrow("Loopmark answer public key is invalid.");
    await expect(
      createSecretBundleSubmission({
        sessionCode: created.sessionCode,
        sessionId: "bad;echo",
        envelope
      })
    ).rejects.toThrow("Loopmark session id is invalid.");
    await expect(
      createSecretBundleSubmission({
        sessionCode: created.sessionCode,
        sessionId: "s_abcdefghijklmnopqrstuvwx",
        envelope
      })
    ).rejects.toThrow("Secret submission session id does not match its envelope.");
  });

  it("rejects receipts with malformed normalized sessions", () => {
    expect(() =>
      parseRemoteSessionReceipt({
        version: 1,
        baseUrl: "https://loopmark.test",
        fillUrl: "https://loopmark.test/s#lm1_test",
        sessionId: "s_abcdefghijklmnopqrstuvwx",
        createdAt: "2026-06-18T00:00:00.000Z",
        session: {},
        answerPrivateKey: {}
      })
    ).toThrow("Loopmark receipt is invalid.");
  });

  it("rejects receipts with malformed base URLs", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });

    expect(() =>
      parseRemoteSessionReceipt({
        version: 1,
        baseUrl: "not a url",
        fillUrl: "https://loopmark.test/s#lm1_test",
        sessionId: "s_abcdefghijklmnopqrstuvwx",
        createdAt: "2026-06-18T00:00:00.000Z",
        session,
        answerPrivateKey: {
          kty: "EC",
          crv: "P-256",
          x: "x",
          y: "y",
          d: "d"
        }
      })
    ).toThrow("Loopmark receipt is invalid.");
  });

  it("rejects receipts with malformed session ids", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });

    expect(() =>
      parseRemoteSessionReceipt({
        version: 1,
        baseUrl: "https://loopmark.test",
        fillUrl: "https://loopmark.test/s#lm1_test",
        sessionId: "not-valid",
        createdAt: "2026-06-18T00:00:00.000Z",
        session,
        answerPrivateKey: {
          kty: "EC",
          crv: "P-256",
          x: "x",
          y: "y",
          d: "d"
        }
      })
    ).toThrow("Loopmark receipt is invalid.");
  });
});
