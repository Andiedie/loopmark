import { z } from "zod";
import type { NormalizedChoiceField, NormalizedField, NormalizedSession } from "./schema";
import { formatPath } from "./errors";
import {
  isAnswerComplete,
  type SubmitPayload,
  type SubmittedAnswer
} from "./answer-state";

export type SubmitValidationError = {
  path: string;
  code: string;
  message: string;
  fieldId?: string;
};

export type SubmitValidationReport = {
  status: "invalid_submit";
  errors: SubmitValidationError[];
};

export type SubmitValidationResult =
  | { ok: true; payload: SubmitPayload }
  | { ok: false; report: SubmitValidationReport };

const choiceItemSchema = z
  .object({
    label: z.string(),
    description: z.string().optional()
  })
  .strict();

const submittedAnswerSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      value: z.string().nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal("secret"),
      value: z.string().nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal("choice"),
      items: z.array(choiceItemSchema).nullable()
    })
    .strict()
]);

const submitPayloadSchema = z
  .object({
    answers: z.record(z.string(), submittedAnswerSchema)
  })
  .strict();

export function validateSubmitPayload(session: NormalizedSession, input: unknown): SubmitValidationResult {
  const parsed = submitPayloadSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      report: {
        status: "invalid_submit",
        errors: parsed.error.issues.map((issue) => ({
          path: formatPath(issue.path),
          code: "invalid_submit_payload",
          message: issue.message
        }))
      }
    };
  }

  const errors = validateSubmittedAnswers(session, parsed.data);

  if (errors.length > 0) {
    return {
      ok: false,
      report: {
        status: "invalid_submit",
        errors
      }
    };
  }

  return { ok: true, payload: parsed.data };
}

export function validateSubmittedAnswers(
  session: NormalizedSession,
  payload: SubmitPayload
): SubmitValidationError[] {
  const fields = flattenFields(session);
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const errors: SubmitValidationError[] = [];

  for (const fieldId of Object.keys(payload.answers)) {
    if (!fieldById.has(fieldId)) {
      errors.push({
        path: `answers.${fieldId}`,
        code: "unknown_answer_field",
        message: "Submitted answer does not match any question in this session.",
        fieldId
      });
    }
  }

  for (const field of fields) {
    const answer = payload.answers[field.id];

    if (answer && !answerTypeMatchesField(field, answer)) {
      errors.push({
        path: `answers.${field.id}.type`,
        code: "answer_type_mismatch",
        message: `Answer for "${field.label}" must use type "${expectedAnswerType(field)}".`,
        fieldId: field.id
      });
      continue;
    }

    const fieldErrors =
      field.type === "choice" && answer?.type === "choice" ? validateChoiceAnswer(field, answer) : [];
    errors.push(...fieldErrors);

    if (field.required && fieldErrors.length === 0 && !isAnswerComplete(field, answer)) {
      errors.push({
        path: `answers.${field.id}`,
        code: "required_answer_missing",
        message: "This required question needs an answer before the agent can continue.",
        fieldId: field.id
      });
    }
  }

  return errors;
}

export function fieldErrorsFromSubmitReport(report: SubmitValidationReport): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const error of report.errors) {
    if (error.fieldId && !fieldErrors[error.fieldId]) {
      fieldErrors[error.fieldId] = error.message;
    }
  }

  return fieldErrors;
}

function flattenFields(session: NormalizedSession): NormalizedField[] {
  return session.groups.flatMap((group) => group.fields);
}

function answerTypeMatchesField(field: NormalizedField, answer: SubmittedAnswer): boolean {
  return answer.type === expectedAnswerType(field);
}

function expectedAnswerType(field: NormalizedField): SubmittedAnswer["type"] {
  if (field.type === "choice") {
    return "choice";
  }

  return field.secret ? "secret" : "text";
}

function validateChoiceAnswer(
  field: NormalizedChoiceField,
  answer: Extract<SubmittedAnswer, { type: "choice" }>
): SubmitValidationError[] {
  const items = answer.items ?? [];
  const errors: SubmitValidationError[] = [];
  const seenLabels = new Map<string, number>();
  const allowedLabels = new Set(field.options.map((option) => normalizeChoiceLabel(option.label)));
  const normalizedLabels = items.map((item) => normalizeChoiceLabel(item.label));

  if (field.mode === "single" && normalizedLabels.filter(Boolean).length > 1) {
    errors.push({
      path: `answers.${field.id}.items`,
      code: "too_many_single_choice_items",
      message: "Single choice answers can include at most one selected item.",
      fieldId: field.id
    });
  }

  normalizedLabels.forEach((label, index) => {
    if (!label) {
      errors.push({
        path: `answers.${field.id}.items[${index}].label`,
        code: "empty_choice_item",
        message: "Choice answer labels cannot be empty.",
        fieldId: field.id
      });
      return;
    }

    const firstIndex = seenLabels.get(label);
    if (firstIndex !== undefined) {
      errors.push({
        path: `answers.${field.id}.items[${index}].label`,
        code: "duplicate_choice_item",
        message: "Choice answers cannot repeat the same label.",
        fieldId: field.id
      });
      return;
    }
    seenLabels.set(label, index);

    if (!field.allowCustom && !allowedLabels.has(label)) {
      errors.push({
        path: `answers.${field.id}.items[${index}].label`,
        code: "unknown_choice_item",
        message: "This field does not allow custom answers, so submitted choices must match an existing option.",
        fieldId: field.id
      });
    }
  });

  return errors;
}

function normalizeChoiceLabel(label: string): string {
  return label.trim();
}
