import type { NormalizedField } from "./schema";

export type ChoiceAnswerItem = {
  label: string;
  description?: string;
};

export type SubmittedAnswer =
  | { type: "text"; value: string | null }
  | { type: "secret"; value: string | null; note?: string | null }
  | { type: "choice"; items: ChoiceAnswerItem[] | null; note?: string | null };

export type SubmitPayload = {
  answers: Record<string, SubmittedAnswer>;
};

export function normalizeTextAnswer(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isSecretValuePresent(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.length > 0;
}

export function normalizeChoiceItems(items: ChoiceAnswerItem[] | null | undefined): ChoiceAnswerItem[] {
  if (!items) {
    return [];
  }

  return items
    .map((item) => ({
      label: item.label.trim(),
      description: item.description?.trim() || undefined
    }))
    .filter((item) => item.label.length > 0);
}

export function getInitialAnswer(field: NormalizedField): SubmittedAnswer {
  if (field.type === "text" && field.secret) {
    return { type: "secret", value: null };
  }

  if (field.type === "text") {
    return { type: "text", value: field.default ?? "" };
  }

  return {
    type: "choice",
    items: field.defaultItems.map(toAnswerItem)
  };
}

export function toAnswerItem(item: Pick<ChoiceAnswerItem, "label" | "description">): ChoiceAnswerItem {
  return {
    label: item.label,
    ...(item.description ? { description: item.description } : {})
  };
}

export function isAnswerPresent(field: NormalizedField, answer: SubmittedAnswer | undefined): boolean {
  if (!answer) {
    return false;
  }

  if (field.type === "text") {
    if (answer.type !== (field.secret ? "secret" : "text")) {
      return false;
    }

    if (answer.type === "secret") {
      return isSecretValuePresent(answer.value) || normalizeTextAnswer(answer.note) !== null;
    }

    return normalizeTextAnswer(answer.value) !== null;
  }

  if (answer.type !== "choice") {
    return false;
  }

  return normalizeChoiceItems(answer.items).length > 0 || normalizeTextAnswer(answer.note) !== null;
}
