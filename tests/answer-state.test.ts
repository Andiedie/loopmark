import { describe, expect, it } from "vitest";
import {
  getInitialAnswer,
  isAnswerComplete,
  isChoiceField,
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

  it("creates initial answers and completion state for field types", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "text", label: "Text", type: "text", required: true, default: "hello" },
        { id: "secret", label: "Secret", type: "text", secret: true, required: true },
        { id: "choice", label: "Choice", type: "choice", options: ["A"], default: "A", required: true }
      ]
    });
    const [text, secret, choice] = session.groups[0].fields;

    expect(getInitialAnswer(text)).toEqual({ type: "text", value: "hello" });
    expect(getInitialAnswer(secret)).toEqual({ type: "secret", value: null });
    expect(getInitialAnswer(choice)).toEqual({ type: "choice", items: [{ label: "A" }] });
    expect(isAnswerComplete(text, { type: "text", value: "hello" })).toBe(true);
    expect(isAnswerComplete(text, { type: "secret", value: "wrong" })).toBe(false);
    expect(isAnswerComplete(secret, { type: "secret", value: "value" })).toBe(true);
    expect(isAnswerComplete(secret, undefined)).toBe(false);
    expect(isAnswerComplete(choice, { type: "choice", items: [{ label: "A" }] })).toBe(true);
    expect(isAnswerComplete(choice, { type: "text", value: "A" })).toBe(false);
    expect(isChoiceField(choice)).toBe(true);
    expect(toAnswerItem({ label: "A", description: "B" })).toEqual({ label: "A", description: "B" });
  });

  it("treats optional fields as complete", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "optional", label: "Optional" }]
    });

    expect(isAnswerComplete(session.groups[0].fields[0], undefined)).toBe(true);
  });
});
