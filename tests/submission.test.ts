import { describe, expect, it } from "vitest";
import { normalizeSession } from "../src/shared/schema";
import { fieldErrorsFromSubmitReport, validateSubmitPayload } from "../src/shared/submission";

describe("submit payload validation", () => {
  it("rejects duplicate choice labels in one submitted answer", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "priority",
          label: "Priority",
          type: "choice",
          mode: "ranking",
          options: ["A", "B"]
        }
      ]
    });

    const result = validateSubmitPayload(session, {
      answers: {
        priority: { type: "choice", items: [{ label: "A" }, { label: "A" }] }
      }
    });

    expect(result).toMatchObject({
      ok: false,
      report: {
        status: "invalid_submit",
        errors: [{ fieldId: "priority", code: "duplicate_choice_item" }]
      }
    });
  });

  it("allows custom choice labels only when the field allows custom answers", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "decision",
          label: "Decision",
          type: "choice",
          mode: "multiple",
          allowCustom: true,
          options: ["A", "B"]
        }
      ]
    });

    const result = validateSubmitPayload(session, {
      answers: {
        decision: { type: "choice", items: [{ label: "C", description: "Custom direction." }] }
      }
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("rejects unknown answer fields and answer type mismatches", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "notes", label: "Notes", type: "text", required: true },
        { id: "secret", label: "Secret", type: "text", secret: true },
        { id: "choice", label: "Choice", type: "choice", options: ["A"] }
      ]
    });

    const result = validateSubmitPayload(session, {
      answers: {
        extra: { type: "text", value: "No matching field" },
        notes: { type: "choice", items: [{ label: "A" }] },
        secret: { type: "text", value: "wrong type" },
        choice: { type: "secret", value: "wrong type" }
      }
    });

    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({ fieldId: "extra", code: "unknown_answer_field" }),
          expect.objectContaining({ fieldId: "notes", code: "answer_type_mismatch" }),
          expect.objectContaining({ fieldId: "secret", code: "answer_type_mismatch" }),
          expect.objectContaining({ fieldId: "choice", code: "answer_type_mismatch" })
        ])
      }
    });
  });

  it("rejects empty choice labels and maps only the first field error for display", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "choice", mode: "multiple", options: ["A", "B"] }]
    });

    const result = validateSubmitPayload(session, {
      answers: {
        scope: { type: "choice", items: [{ label: " " }, { label: "A" }, { label: "A" }] }
      }
    });

    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({ fieldId: "scope", code: "empty_choice_item" }),
          expect.objectContaining({ fieldId: "scope", code: "duplicate_choice_item" })
        ])
      }
    });

    if (!result.ok) {
      expect(fieldErrorsFromSubmitReport(result.report)).toEqual({
        scope: "Choice answer labels cannot be empty."
      });
    }
  });
});
