import type { NormalizedChoiceField, NormalizedField } from "./schema";

export type ChoiceAnswerItem = {
  label: string;
  description?: string;
};

export type SubmittedAnswer =
  | { type: "text"; value: string | null }
  | { type: "secret"; value: string | null }
  | { type: "choice"; items: ChoiceAnswerItem[] | null };

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

export function isAnswerComplete(field: NormalizedField, answer: SubmittedAnswer | undefined): boolean {
  if (!field.required) {
    return true;
  }

  if (!answer) {
    return false;
  }

  if (field.type === "text") {
    if (answer.type !== (field.secret ? "secret" : "text")) {
      return false;
    }

    return Boolean(answer.value && answer.value.trim().length > 0);
  }

  if (answer.type !== "choice") {
    return false;
  }

  if (field.mode === "single") {
    return normalizeChoiceItems(answer.items).length === 1;
  }

  return normalizeChoiceItems(answer.items).length > 0;
}

export function isChoiceField(field: NormalizedField): field is NormalizedChoiceField {
  return field.type === "choice";
}
