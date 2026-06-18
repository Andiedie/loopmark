import { describe, expect, it } from "vitest";
import { getInitialAnswer } from "../src/shared/answer-state";
import { LoopmarkInputError } from "../src/shared/errors";
import { normalizeSession, parseInputJson } from "../src/shared/schema";
import { validateSubmitPayload } from "../src/shared/submission";

describe("input schema normalization", () => {
  it("normalizes a compact fields session into one group", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "What is in scope?" }]
    });

    expect(session.groups).toHaveLength(1);
    expect(session.groups[0].id).toBe("questions");
    expect(session.groups[0].fields[0]).toMatchObject({
      id: "scope",
      type: "text",
      multiline: false,
      secret: false
    });
    expect(session.groups[0].fields[0]).not.toHaveProperty("required");
    expect(session.groups[0].fields[0]).not.toHaveProperty("format");
  });

  it("accepts but removes legacy field and option knobs from normalized output", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        { id: "notes", label: "Notes", type: "text", required: true, format: "markdown" },
        {
          id: "choice",
          label: "Choice",
          type: "choice",
          required: true,
          allowCustom: false,
          editable: false,
          options: [{ value: "a", label: "A" }]
        }
      ]
    });

    const [textField, choiceField] = session.groups[0].fields;
    expect(textField).not.toHaveProperty("required");
    expect(textField).not.toHaveProperty("format");
    expect(choiceField).not.toHaveProperty("required");
    expect(choiceField).not.toHaveProperty("allowCustom");
    expect(choiceField).not.toHaveProperty("editable");
    expect(choiceField.type === "choice" ? choiceField.options[0] : undefined).toEqual({
      id: "option_1",
      label: "A"
    });
  });

  it("normalizes choice defaults and ranking option order", () => {
    const session = normalizeSession({
      title: "Need input",
      groups: [
        {
          title: "Scope",
          fields: [
            {
              id: "priority",
              type: "choice",
              label: "Rank priorities",
              mode: "ranking",
              options: [
                { value: "schema", label: "Input validation", description: "Readable errors." },
                "CLI lifecycle"
              ]
            }
          ]
        }
      ]
    });

    const field = session.groups[0].fields[0];
    expect(field).toMatchObject({ type: "choice", mode: "ranking" });
    expect(field.type === "choice" ? field.defaultItems : []).toEqual([
      { id: "option_1", label: "Input validation", description: "Readable errors." },
      { id: "option_2", label: "CLI lifecycle" }
    ]);
  });

  it("treats object defaults as existing options and ignores legacy option values", () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "style",
          type: "choice",
          label: "Preferred style",
          default: { label: "Paper Trail", description: "Use the refined document direction." },
          options: [
            { value: "paper", label: "Paper Trail", description: "Original option description." },
            "Plain Form"
          ]
        }
      ]
    });

    const field = session.groups[0].fields[0];
    expect(field.type === "choice" ? field.defaultItems[0] : undefined).toMatchObject({
      id: "option_1",
      label: "Paper Trail",
      description: "Use the refined document direction."
    });

    const answers = Object.fromEntries(session.groups.flatMap((group) => group.fields).map((item) => [item.id, getInitialAnswer(item)]));
    expect(validateSubmitPayload(session, { answers })).toMatchObject({ ok: true });
  });

  it("rejects defaults that do not match existing option labels", () => {
    expect.assertions(2);

    try {
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "style",
            type: "choice",
            label: "Preferred style",
            default: { label: "Editorial Review", description: "This is not an existing option." },
            options: ["Paper Trail", "Plain Form"]
          }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].default",
        code: "unknown_default_option"
      });
    }
  });

  it("rejects duplicate default labels before they create invalid initial answers", () => {
    expect.assertions(2);

    try {
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "scope",
            type: "choice",
            mode: "multiple",
            label: "Scope",
            options: ["CLI", "UI"],
            default: ["CLI", { label: "CLI", description: "Repeated by mistake." }]
          }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].default[1]",
        code: "duplicate_default_option"
      });
    }
  });

  it("rejects empty and invalid choice defaults with targeted guidance", () => {
    expect.assertions(4);

    try {
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "scope",
            type: "choice",
            label: "Scope",
            options: ["CLI"],
            default: "   "
          }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].default",
        code: "invalid_default_item"
      });
    }

    try {
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "scope",
            type: "choice",
            mode: "multiple",
            label: "Scope",
            options: ["CLI"],
            default: [123]
          }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].default[0]",
        code: "invalid_default_item"
      });
    }
  });

  it("returns an agent-readable JSON parse error", () => {
    expect(() => parseInputJson("{nope")).toThrow(LoopmarkInputError);

    try {
      parseInputJson("{nope");
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "$",
        code: "invalid_json"
      });
    }
  });

  it("rejects unsupported number and boolean field types with fix guidance", () => {
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "timeout", type: "number", label: "Timeout" }]
      })
    ).toThrow(LoopmarkInputError);

    try {
      normalizeSession({
        title: "Need input",
        fields: [{ id: "timeout", type: "number", label: "Timeout" }]
      });
    } catch (error) {
      const report = (error as LoopmarkInputError).report;
      expect(JSON.stringify(report)).toContain("path");
      expect(JSON.stringify(report)).toContain("fix");
    }
  });

  it("rejects duplicate field ids", () => {
    expect(() =>
      normalizeSession({
        title: "Need input",
        groups: [
          { title: "A", fields: [{ id: "same", label: "One" }] },
          { title: "B", fields: [{ id: "same", label: "Two" }] }
        ]
      })
    ).toThrow(LoopmarkInputError);
  });

  it("rejects duplicate group ids because UI anchors and collapsed state use them", () => {
    expect.assertions(2);

    try {
      normalizeSession({
        title: "Need input",
        groups: [
          { id: "same", title: "A", fields: [{ id: "a", label: "One" }] },
          { id: "same", title: "B", fields: [{ id: "b", label: "Two" }] }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "groups[1].id",
        code: "duplicate_group_id"
      });
    }
  });

  it("keeps semantic error paths aligned with the fields shorthand", () => {
    expect.assertions(1);

    try {
      normalizeSession({
        title: "Need input",
        fields: [{ id: "text", label: "Text", type: "text", default: 1 }]
      });
    } catch (error) {
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].default",
        code: "invalid_text_default"
      });
    }
  });

  it("rejects secret defaults and ignores duplicate legacy option values", () => {
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "secret", type: "text", secret: true, label: "Secret", default: "abc" }]
      })
    ).toThrow(LoopmarkInputError);

    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "choice",
          type: "choice",
          label: "Choice",
          options: [
            { value: "a", label: "A" },
            { value: "a", label: "Again" }
          ]
        }
      ]
    });
    expect(session.groups[0].fields[0].type === "choice" ? session.groups[0].fields[0].options : []).toEqual([
      { id: "option_1", label: "A" },
      { id: "option_2", label: "Again" }
    ]);
  });

  it("rejects duplicate choice option labels because answers use labels", () => {
    expect.assertions(2);

    try {
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "choice",
            type: "choice",
            label: "Choice",
            options: [
              { value: "a", label: "Same" },
              { value: "b", label: "Same" }
            ]
          }
        ]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LoopmarkInputError);
      expect((error as LoopmarkInputError).report.errors[0]).toMatchObject({
        path: "fields[0].options[1].label",
        code: "duplicate_option_label"
      });
    }
  });

  it("rejects ambiguous session shapes and text fields with choice keys", () => {
    expect(() => normalizeSession({ title: "Need input" })).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "a", label: "A" }],
        groups: [{ title: "G", fields: [{ id: "b", label: "B" }] }]
      })
    ).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "text", label: "Text", type: "text", options: ["A"] }]
      })
    ).toThrow(LoopmarkInputError);
  });

  it("rejects invalid defaults with targeted fixes", () => {
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "text", label: "Text", type: "text", default: 1 }]
      })
    ).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [
          { id: "single", label: "Single", type: "choice", options: ["A"], mode: "single", default: ["A"] }
        ]
      })
    ).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [
          { id: "multiple", label: "Multiple", type: "choice", options: ["A"], mode: "multiple", default: "A" }
        ]
      })
    ).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [
          {
            id: "choice",
            label: "Choice",
            type: "choice",
            options: ["A"],
            default: "B"
          }
        ]
      })
    ).toThrow(LoopmarkInputError);
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "choice", label: "Choice", type: "choice", options: ["A"], default: 1 }]
      })
    ).toThrow(LoopmarkInputError);
  });

  it("rejects choice fields without options", () => {
    expect(() =>
      normalizeSession({
        title: "Need input",
        fields: [{ id: "choice", label: "Choice", type: "choice" }]
      })
    ).toThrow(LoopmarkInputError);
  });
});
