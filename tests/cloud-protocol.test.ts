import { describe, expect, it } from "vitest";
import { normalizeSession } from "../src/shared/schema";
import {
  assertAnswerSubmissionEnvelope,
  createAnswerSubmission,
  createRemoteSessionPackage,
  decryptAnswerEnvelope,
  decryptSessionEnvelope,
  deriveSessionId,
  encryptAnswerEnvelope,
  extractSessionCodeFromHash,
  verifyAnswerProof
} from "../src/shared/cloud-protocol";

describe("cloud protocol", () => {
  it("creates a short link code that decrypts the session but not the answer", async () => {
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

    const answer = await encryptAnswerEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      payload: {
        answers: {
          scope: { type: "text", value: "Ship it" },
          token: { type: "secret", value: "secret-value" }
        }
      }
    });
    expect(JSON.stringify(answer)).not.toContain("secret-value");
    const submission = await createAnswerSubmission({
      sessionCode: created.sessionCode,
      envelope: answer
    });
    expect(JSON.stringify(submission)).not.toContain("secret-value");
    await expect(verifyAnswerProof(submission.answerProof, created.envelope.answerProofHash)).resolves.toBe(true);
    await expect(verifyAnswerProof("wrong-proof", created.envelope.answerProofHash)).resolves.toBe(false);

    const decryptedAnswer = await decryptAnswerEnvelope({
      receipt: created.receipt,
      envelope: submission.envelope
    });
    expect(decryptedAnswer.answers.token).toEqual({ type: "secret", value: "secret-value" });
  });

  it("rejects invalid link fragments", () => {
    expect(extractSessionCodeFromHash("")).toBeNull();
    expect(extractSessionCodeFromHash("#not-a-loopmark-code")).toBeNull();
  });

  it("rejects malformed answer submission wrappers", () => {
    expect(() => assertAnswerSubmissionEnvelope(null)).toThrow("Answer submission must be an object.");
    expect(() => assertAnswerSubmissionEnvelope({ version: 1 })).toThrow("Answer submission is invalid.");
  });
});
