import { describe, expect, it } from "vitest";
import { createAnswerText } from "../src/shared/answer-text";
import { normalizeSession } from "../src/shared/schema";

describe("answer text", () => {
  it("renders readable plain text answers while pointing secret retrieval to a short command", () => {
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

    const answerText = createAnswerText({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload,
      now: new Date("2026-06-18T00:00:00.000Z")
    });

    expect(answerText).toContain("Need input Answers");
    expect(answerText).toContain("Scope\nAnswer: Ship it\nField: scope");
    expect(answerText).toContain("API key\nAnswer: [secret omitted]\nNote: Use the staging credential.\nField: api_key");
    expect(answerText).toContain("npx --yes @andie/loopmark secrets s_abcdefghijklmnopqrstuvwx");
    expect(answerText).not.toContain("#");
    expect(answerText).not.toContain("```");
    expect(answerText).not.toContain("> ");
    expect(answerText).not.toContain("_Secret omitted");
    expect(answerText).not.toContain("super-secret-token");
  });

  it("keeps question text primary and field ids secondary", () => {
    const session = normalizeSession({
      title: "kivo lark-channel-bridge 启用信息",
      fields: [
        { id: "app_id", label: "Feishu/Lark App ID", type: "text" },
        {
          id: "tenant",
          label: "租户类型",
          type: "choice",
          mode: "single",
          options: [{ label: "feishu", description: "中国大陆飞书，默认推荐。" }]
        }
      ]
    });

    const answerText = createAnswerText({
      sessionId: "s_Hr4tMipC8uYZQwAJEVawN7Hf",
      session,
      payload: {
        answers: {
          app_id: { type: "text", value: "cli_aabf87f87438dbd7" },
          tenant: {
            type: "choice",
            items: [{ label: "feishu", description: "中国大陆飞书，默认推荐。" }]
          }
        }
      }
    });

    expect(answerText).toContain("Feishu/Lark App ID\nAnswer: cli_aabf87f87438dbd7\nField: app_id");
    expect(answerText).toContain("租户类型\nAnswer: feishu\nDetails: 中国大陆飞书，默认推荐。\nField: tenant");
  });

  it("indents multiline text without Markdown block syntax", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text", multiline: true }]
    });

    const answerText = createAnswerText({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload: {
        answers: {
          scope: { type: "text", value: "First line\nSecond line" }
        }
      }
    });

    expect(answerText).toContain("Answer:\n  First line\n  Second line\nField: scope");
    expect(answerText).not.toContain("> First line");
  });

  it("renders multiple and ranking choices in answer order", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "priority",
          label: "Rank priorities",
          type: "choice",
          mode: "ranking",
          options: ["Alpha", "Beta"]
        }
      ]
    });

    const answerText = createAnswerText({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload: {
        answers: {
          priority: {
            type: "choice",
            items: [
              { label: "Beta", description: "Second option first." },
              { label: "Alpha" }
            ],
            note: "Beta is urgent."
          }
        }
      }
    });

    expect(answerText).toContain("Answer:\nChoice 1: Beta\nDetails 1: Second option first.\nChoice 2: Alpha\nNote: Beta is urgent.");
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

    const answerText = createAnswerText({
      sessionId: "s_abcdefghijklmnopqrstuvwx",
      session,
      payload: { answers: {} }
    });

    expect(answerText).toContain("Decision");
    expect(answerText).toContain("Answer: [no answer]");
  });

  it("does not claim secrets were omitted when a secret field only has a note", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });

    const answerText = createAnswerText({
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

    expect(answerText).toContain("Paste this answer text back to the agent.");
    expect(answerText).toContain("Answer: [no secret value provided]");
    expect(answerText).toContain("Note: No credential is needed for this pass.");
    expect(answerText).not.toContain("Secret values were omitted");
    expect(answerText).not.toContain("[secret omitted]");
    expect(answerText).not.toContain("Secrets");
  });

  it("rejects malformed session ids before rendering a secrets command", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "api_key", label: "API key", type: "text", secret: true }]
    });

    expect(() =>
      createAnswerText({
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
