import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectRemoteResult, createRemoteSession } from "../src/cli/remote";
import { LoopmarkInputError } from "../src/shared/errors";
import { normalizeSession } from "../src/shared/schema";
import {
  decryptSessionEnvelope,
  deriveSessionId,
  encryptAnswerEnvelope,
  extractSessionCodeFromHash,
  type AnswerEnvelope,
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
  it("creates a receipt and collects an encrypted answer into final output", async () => {
    const store: { session?: SessionEnvelope; answer?: AnswerEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      const answerMatch = /^\/api\/sessions\/([^/]+)\/answer$/.exec(url.pathname);
      if (answerMatch && !store.answer) {
        return new Response(JSON.stringify({ status: "pending" }), { status: 202 });
      }
      if (answerMatch && store.answer) {
        return new Response(JSON.stringify(store.answer), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "scope", label: "Scope", type: "text", required: true },
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

    const pending = await collectRemoteResult(created.receiptFile, {
      secretDir: tempDir,
      fetch: fetchMock
    });
    expect(pending).toEqual({
      status: "pending",
      message: "Loopmark session has not been submitted yet."
    });

    const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
    expect(sessionCode).not.toBeNull();
    await expect(deriveSessionId(sessionCode!)).resolves.toBe(created.sessionId);
    const decryptedSession = await decryptSessionEnvelope(sessionCode!, store.session!);
    store.answer = await encryptAnswerEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      payload: {
        answers: {
          scope: { type: "text", value: "Build it" },
          api_key: { type: "secret", value: "secret-from-remote-test" }
        }
      }
    });

    const collected = await collectRemoteResult(created.receiptFile, {
      secretDir: tempDir,
      fetch: fetchMock
    });

    expect(collected.status).toBe("submitted");
    if (collected.status !== "submitted") {
      throw new Error("Expected submitted output.");
    }
    expect(collected.answers.scope.answer).toBe("Build it");
    const secretAnswer = collected.answers.api_key.answer;
    expect(JSON.stringify(collected)).not.toContain("secret-from-remote-test");
    expect(secretAnswer).toMatchObject({ description: expect.stringContaining("omitted") });
    if (!secretAnswer || typeof secretAnswer !== "object" || !("secretFile" in secretAnswer)) {
      throw new Error("Expected secret file answer.");
    }
    expect(await readFile(secretAnswer.secretFile, "utf8")).toBe("secret-from-remote-test");
  });

  it("reports failed remote responses and invalid receipts without treating missing sessions as pending", async () => {
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
    await expect(collectRemoteResult(badReceiptFile)).rejects.toThrow("Loopmark receipt is invalid.");

    const created = await createRemoteSession(session, {
      baseUrl: "https://loopmark.test",
      receiptDir: tempDir,
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 201 })
    });
    await expect(
      collectRemoteResult(created.receiptFile, {
        fetch: async () =>
          new Response(JSON.stringify({ error: "Loopmark session was not found." }), {
            status: 404
          })
      })
    ).rejects.toThrow("Loopmark session was not found.");
  });

  it("rejects decrypted answers that do not satisfy the original session", async () => {
    const store: { session?: SessionEnvelope; answer?: AnswerEnvelope } = {};
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.pathname === "/api/sessions" && init?.method === "POST") {
        store.session = JSON.parse(String(init.body)) as SessionEnvelope;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      if (/^\/api\/sessions\/[^/]+\/answer$/.test(url.pathname) && store.answer) {
        return new Response(JSON.stringify(store.answer), { status: 200 });
      }

      return new Response(JSON.stringify({ status: "pending" }), { status: 202 });
    };
    const session = normalizeSession({
      title: "Need required input",
      fields: [{ id: "scope", label: "Scope", type: "text", required: true }]
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
    store.answer = await encryptAnswerEnvelope({
      sessionId: created.sessionId,
      answerPublicKey: decryptedSession.answerPublicKey,
      payload: { answers: {} }
    });

    await expect(
      collectRemoteResult(created.receiptFile, {
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(LoopmarkInputError);
  });
});
