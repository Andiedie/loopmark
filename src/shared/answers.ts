import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedField, NormalizedSession } from "./schema";
import {
  normalizeChoiceItems,
  normalizeTextAnswer,
  type ChoiceAnswerItem,
  type SubmitPayload,
  type SubmittedAnswer
} from "./answer-state";

export type { ChoiceAnswerItem, SubmitPayload, SubmittedAnswer };

export const SECRET_DESCRIPTION =
  "Secret value was written to a local temporary file and omitted from answers.";

export type FinalAnswer =
  | { question: string; answer: string | null }
  | { question: string; answer: { secretFile: string; description: string } | null }
  | { question: string; answer: ChoiceAnswerItem | null }
  | { question: string; answer: ChoiceAnswerItem[] | null };

export type FinalOutput = {
  status: "submitted";
  answers: Record<string, FinalAnswer>;
};

export type BuildAnswerOptions = {
  secretDir: string;
};

export async function buildFinalOutput(
  session: NormalizedSession,
  payload: SubmitPayload,
  options: BuildAnswerOptions
): Promise<FinalOutput> {
  const answers: Record<string, FinalAnswer> = {};

  for (const [fieldIndex, field] of flattenFields(session).entries()) {
    const submitted = payload.answers[field.id];
    answers[field.id] = await buildFieldAnswer(field, submitted, options, fieldIndex);
  }

  return {
    status: "submitted",
    answers
  };
}

export function flattenFields(session: NormalizedSession): NormalizedField[] {
  return session.groups.flatMap((group) => group.fields);
}

async function buildFieldAnswer(
  field: NormalizedField,
  submitted: SubmittedAnswer | undefined,
  options: BuildAnswerOptions,
  fieldIndex: number
): Promise<FinalAnswer> {
  if (field.type === "text" && field.secret) {
    const value = submitted?.type === "secret" ? submitted.value : null;

    if (!value || value.trim().length === 0) {
      return { question: field.label, answer: null };
    }

    await mkdir(options.secretDir, { recursive: true, mode: 0o700 });
    const secretFile = join(options.secretDir, secretFileName(field.id, fieldIndex));
    await writeFile(secretFile, value, { encoding: "utf8", mode: 0o600 });

    return {
      question: field.label,
      answer: {
        secretFile,
        description: SECRET_DESCRIPTION
      }
    };
  }

  if (field.type === "text") {
    const value = submitted?.type === "text" ? submitted.value : null;
    return {
      question: field.label,
      answer: normalizeTextAnswer(value)
    };
  }

  const items = submitted?.type === "choice" ? submitted.items : null;
  const cleaned = normalizeChoiceItems(items);

  if (field.mode === "single") {
    return {
      question: field.label,
      answer: cleaned[0] ?? null
    };
  }

  return {
    question: field.label,
    answer: cleaned.length > 0 ? cleaned : null
  };
}

export function safeFileName(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return cleaned || "secret";
}

export function secretFileName(fieldId: string, fieldIndex: number): string {
  const prefix = String(fieldIndex + 1).padStart(3, "0");
  return `${prefix}_${safeFileName(fieldId)}.txt`;
}
