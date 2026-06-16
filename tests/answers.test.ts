import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFinalOutput, SECRET_DESCRIPTION, safeFileName } from "../src/shared/answers";
import { normalizeSession } from "../src/shared/schema";
import type { SubmitPayload } from "../src/shared/answer-state";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "loopmark-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("final answer serialization", () => {
  it("serializes text, secret, single, multiple, and ranking answers", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "notes", label: "Notes", type: "text" },
        { id: "api_key", label: "API Key", type: "text", secret: true },
        { id: "style", label: "Style", type: "choice", options: ["Simple", "Complete"] },
        { id: "scope", label: "Scope", type: "choice", mode: "multiple", options: ["CLI", "UI"] },
        { id: "priority", label: "Priority", type: "choice", mode: "ranking", options: ["Validation", "UI"] }
      ]
    });
    const payload: SubmitPayload = {
      answers: {
        notes: { type: "text", value: "  Ship it cleanly.  " },
        api_key: { type: "secret", value: "super-secret" },
        style: { type: "choice", items: [{ label: "Simple", description: "Readable first." }] },
        scope: { type: "choice", items: [{ label: "CLI" }, { label: "UI" }] },
        priority: {
          type: "choice",
          items: [{ label: "Validation" }, { label: "UI", description: "Paper Trail implementation." }]
        }
      }
    };

    const output = await buildFinalOutput(session, payload, { secretDir: tempDir });

    expect(output.status).toBe("submitted");
    expect(output.answers.notes).toEqual({ question: "Notes", answer: "Ship it cleanly." });
    expect(output.answers.style).toEqual({
      question: "Style",
      answer: { label: "Simple", description: "Readable first." }
    });
    expect(output.answers.scope).toEqual({
      question: "Scope",
      answer: [{ label: "CLI" }, { label: "UI" }]
    });
    expect(output.answers.priority).toEqual({
      question: "Priority",
      answer: [{ label: "Validation" }, { label: "UI", description: "Paper Trail implementation." }]
    });

    const secretAnswer = output.answers.api_key.answer as { secretFile: string; description: string };
    expect(secretAnswer.description).toBe(SECRET_DESCRIPTION);
    expect(await readFile(secretAnswer.secretFile, "utf8")).toBe("super-secret");
    expect(JSON.stringify(output)).not.toContain("super-secret");
  });

  it("returns null for skipped optional answers", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "notes", label: "Notes", type: "text" },
        { id: "choice", label: "Choice", type: "choice", mode: "multiple", options: ["A"] }
      ]
    });

    const output = await buildFinalOutput(
      session,
      {
        answers: {
          notes: { type: "text", value: "   " },
          choice: { type: "choice", items: [] }
        }
      },
      { secretDir: tempDir }
    );

    expect(output.answers.notes).toEqual({ question: "Notes", answer: null });
    expect(output.answers.choice).toEqual({ question: "Choice", answer: null });
  });

  it("returns null for blank secret values and mismatched submitted answer types", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "secret", label: "Secret", type: "text", secret: true },
        { id: "notes", label: "Notes", type: "text" },
        { id: "single", label: "Single", type: "choice", options: ["A"] },
        { id: "many", label: "Many", type: "choice", mode: "multiple", options: ["A"] }
      ]
    });

    const output = await buildFinalOutput(
      session,
      {
        answers: {
          secret: { type: "secret", value: "   " },
          notes: { type: "choice", items: [{ label: "A" }] },
          single: { type: "choice", items: [] },
          many: { type: "secret", value: "wrong type" }
        }
      },
      { secretDir: tempDir }
    );

    expect(output.answers.secret).toEqual({ question: "Secret", answer: null });
    expect(output.answers.notes).toEqual({ question: "Notes", answer: null });
    expect(output.answers.single).toEqual({ question: "Single", answer: null });
    expect(output.answers.many).toEqual({ question: "Many", answer: null });
  });

  it("sanitizes secret file names", () => {
    expect(safeFileName("API key / prod")).toBe("API_key_prod");
    expect(safeFileName("")).toBe("secret");
  });

  it("keeps secret files distinct when sanitized field ids collide", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "api key", label: "API key", type: "text", secret: true },
        { id: "api/key", label: "API/key", type: "text", secret: true }
      ]
    });

    const output = await buildFinalOutput(
      session,
      {
        answers: {
          "api key": { type: "secret", value: "first-secret" },
          "api/key": { type: "secret", value: "second-secret" }
        }
      },
      { secretDir: tempDir }
    );

    const first = output.answers["api key"].answer as { secretFile: string; description: string };
    const second = output.answers["api/key"].answer as { secretFile: string; description: string };
    expect(first.secretFile).not.toBe(second.secretFile);
    expect(await readFile(first.secretFile, "utf8")).toBe("first-secret");
    expect(await readFile(second.secretFile, "utf8")).toBe("second-secret");
  });
});
