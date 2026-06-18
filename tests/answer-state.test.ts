import { describe, expect, it } from "vitest";
import {
  getInitialAnswer,
  isAnswerPresent,
  normalizeChoiceItems,
  normalizeTextAnswer,
  toAnswerItem
} from "../src/shared/answer-state";
import { normalizeSession } from "../src/shared/schema";

describe("answer state helpers", () => {
  it("normalizes empty and non-empty text answers", () => {
    expect(normalizeTextAnswer(null)).toBeNull();
    expect(normalizeTextAnswer(undefined)).toBeNull();
    expect(normalizeTextAnswer("   ")).toBeNull();
    expect(normalizeTextAnswer("  useful  ")).toBe("useful");
  });

  it("normalizes choice items into compact readable objects", () => {
    expect(
      normalizeChoiceItems([
        { label: "  A  ", description: " first " },
        { label: " " },
        { label: "B", description: "   " }
      ])
    ).toEqual([{ label: "A", description: "first" }, { label: "B" }]);
    expect(normalizeChoiceItems(null)).toEqual([]);
  });

  it("creates initial answers for field types", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "text", label: "Text", type: "text", default: "hello" },
        { id: "secret", label: "Secret", type: "text", secret: true },
        { id: "choice", label: "Choice", type: "choice", options: ["A"], default: "A" }
      ]
    });
    const [text, secret, choice] = session.groups[0].fields;

    expect(getInitialAnswer(text)).toEqual({ type: "text", value: "hello" });
    expect(getInitialAnswer(secret)).toEqual({ type: "secret", value: null });
    expect(getInitialAnswer(choice)).toEqual({ type: "choice", items: [{ label: "A" }] });
    expect(toAnswerItem({ label: "A", description: "B" })).toEqual({ label: "A", description: "B" });
  });

  it("detects whether optional fields contain user-provided content", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "text", label: "Text", type: "text" },
        { id: "secret", label: "Secret", type: "text", secret: true },
        { id: "choice", label: "Choice", type: "choice", options: ["A"] }
      ]
    });
    const [text, secret, choice] = session.groups[0].fields;

    expect(isAnswerPresent(text, undefined)).toBe(false);
    expect(isAnswerPresent(text, { type: "secret", value: "wrong" })).toBe(false);
    expect(isAnswerPresent(text, { type: "text", value: "   " })).toBe(false);
    expect(isAnswerPresent(text, { type: "text", value: "Ready" })).toBe(true);
    expect(isAnswerPresent(secret, { type: "text", value: "wrong" })).toBe(false);
    expect(isAnswerPresent(secret, { type: "secret", value: "token" })).toBe(true);
    expect(isAnswerPresent(choice, { type: "text", value: "wrong" })).toBe(false);
    expect(isAnswerPresent(choice, { type: "choice", items: [] })).toBe(false);
    expect(isAnswerPresent(choice, { type: "choice", items: [], note: "Skipping this." })).toBe(true);
    expect(isAnswerPresent(choice, { type: "choice", items: [{ label: "A" }] })).toBe(true);
  });
});
