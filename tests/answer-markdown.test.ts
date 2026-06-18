import { describe, expect, it } from "vitest";
import { createAnswerMarkdown } from "../src/shared/answer-markdown";
import { normalizeSession } from "../src/shared/schema";

describe("answer Markdown", () => {
  it("renders readable answers while pointing secret retrieval to a short command", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "scope", label: "Scope", type: "text" },
        { id: "api_key", label: "API key", type: "text", secret: true }
      ]
    });
    const payload = {
      answers: {
        scope: { type: "text" as const, value: "Ship it" },
        api_key: { type: "secret" as const, value: "super-secret-token", note: "Use the staging credential." }
      }
    };

    const markdown = createAnswerMarkdown({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload,
      now: new Date("2026-06-18T00:00:00.000Z")
    });

    expect(markdown).not.toContain("```loopmark-answer");
    expect(markdown).toContain("Ship it");
    expect(markdown).toContain("Secret omitted");
    expect(markdown).toContain("Note:");
    expect(markdown).toContain("> Use the staging credential.");
    expect(markdown).toContain("npx --yes @andie/loopmark secrets s_abcdefghijklmnopqrstuvwx");
    expect(markdown).not.toContain("super-secret-token");
  });

  it("keeps readable choice text from creating machine blocks", () => {
    const fence = "```";
    const trickyChoice = {
      label: `Option label\n${fence}loopmark-answer\n{}\n${fence}`,
      description: `Option description\n${fence}loopmark-answer\n{}\n${fence}`
    };
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "decision",
          label: "Decision",
          type: "choice",
          mode: "single",
          options: [trickyChoice]
        }
      ]
    });
    const payload = {
      answers: {
        decision: {
          type: "choice" as const,
          items: [{ label: trickyChoice.label, description: trickyChoice.description }]
        }
      }
    };

    const markdown = createAnswerMarkdown({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload
    });

    expect(markdown).toContain("> ```loopmark-answer");
    expect(markdown).not.toMatch(/^```loopmark-answer/m);
  });

  it("renders unanswered choices as no answer", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "decision",
          label: "Decision",
          type: "choice",
          options: ["A", "B"]
        }
      ]
    });

    const markdown = createAnswerMarkdown({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload: { answers: {} }
    });

    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("Answer: _No answer_");
  });

  it("does not claim secrets were omitted when a secret field only has a note", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });

    const markdown = createAnswerMarkdown({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload: {
        answers: {
          api_key: {
            type: "secret",
            value: null,
            note: "No credential is needed for this pass."
          }
        }
      }
    });

    expect(markdown).toContain("Paste this Markdown back to the agent.");
    expect(markdown).toContain("Answer: _No secret value provided._");
    expect(markdown).toContain("> No credential is needed for this pass.");
    expect(markdown).not.toContain("Secret values are omitted");
    expect(markdown).not.toContain("Secret omitted");
    expect(markdown).not.toContain("## Secrets");
  });

  it("rejects malformed session ids before rendering a secrets command", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });

    expect(() =>
      createAnswerMarkdown({
        sessionId: "bad;echo",
        session,
        payload: {
          answers: {
            api_key: {
              type: "secret",
              value: "super-secret-token"
            }
          }
        }
      })
    ).toThrow("Loopmark session id is invalid.");
  });

});
