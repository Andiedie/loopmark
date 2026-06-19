import type { SubmitPayload, SubmittedAnswer } from "./answer-state";
import { isSecretValuePresent, normalizeChoiceItems, normalizeTextAnswer } from "./answer-state";
import { assertSessionId } from "./cloud-protocol";
import type { NormalizedField, NormalizedSession } from "./schema";

export function createAnswerText(input: {
  sessionId: string;
  session: NormalizedSession;
  payload: SubmitPayload;
  now?: Date;
}): string {
  const fields = flattenFields(input.session);
  const hasSecretValues = hasSubmittedSecretValues(fields, input.payload);
  const secretRetrievalCommand = hasSecretValues ? secretCommand(input.sessionId) : undefined;

  return [
    `${inlineProse(input.session.title)} Answers`,
    "",
    hasSecretValues
      ? "Paste this answer text back to the agent. Secret values are omitted below and require the listed Loopmark command."
      : "Paste this answer text back to the agent.",
    "",
    ...fields.flatMap((field) => renderField(field, input.payload.answers[field.id])),
    ...renderSecretRetrieval(secretRetrievalCommand),
    ""
  ].join("\n");
}

function renderField(field: NormalizedField, answer: SubmittedAnswer | undefined): string[] {
  return [`${inlineProse(field.label)}`, ...renderAnswer(field, answer), `Field: ${field.id}`, ""];
}

function renderAnswer(field: NormalizedField, answer: SubmittedAnswer | undefined): string[] {
  if (field.type === "text" && field.secret) {
    const note = answer?.type === "secret" ? normalizeTextAnswer(answer.note) : null;
    const answerLines =
      answer?.type === "secret" && isSecretValuePresent(answer.value) ? ["Answer: [secret omitted]"] : ["Answer: [no secret value provided]"];
    return note ? [...answerLines, ...renderTextValue("Note", note)] : answerLines;
  }

  if (field.type === "text") {
    const value = answer?.type === "text" ? normalizeTextAnswer(answer.value) : null;
    return renderTextValue("Answer", value);
  }

  if (answer?.type !== "choice") {
    return ["Answer: [no answer]"];
  }

  const items = normalizeChoiceItems(answer.items);
  const note = normalizeTextAnswer(answer.note);
  const answerLines =
    items.length === 0
      ? ["Answer: [no answer]"]
      : field.mode === "single"
        ? renderChoiceItem("Answer", "Details", items[0])
        : ["Answer:", ...items.flatMap((item, index) => renderChoiceItem(`Choice ${index + 1}`, `Details ${index + 1}`, item))];

  return note ? [...answerLines, ...renderTextValue("Note", note)] : answerLines;
}

function renderSecretRetrieval(command: string | undefined): string[] {
  if (!command) {
    return [];
  }

  return ["Secrets", "Secret values were omitted. Run this on the agent machine:", command, ""];
}

function secretCommand(sessionId: string): string {
  return `npx --yes @andie/loopmark secrets ${assertSessionId(sessionId)}`;
}

function renderTextValue(label: string, value: string | null): string[] {
  if (!value) {
    return [`${label}: [no answer]`];
  }

  return renderLabeledText(label, value);
}

function renderChoiceItem(answerLabel: string, detailLabel: string, item: { label: string; description?: string }): string[] {
  const lines = renderLabeledText(answerLabel, item.label);
  if (!item.description) {
    return lines;
  }

  return [...lines, ...renderLabeledText(detailLabel, item.description)];
}

function renderLabeledText(label: string, value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.length === 1) {
    return [`${label}: ${lines[0]}`];
  }

  return [`${label}:`, ...lines.map((line) => `  ${line}`)];
}

function flattenFields(session: NormalizedSession): NormalizedField[] {
  return session.groups.flatMap((group) => group.fields);
}

function hasSubmittedSecretValues(fields: NormalizedField[], payload: SubmitPayload): boolean {
  return fields.some((field) => {
    const answer = payload.answers[field.id];
    return field.type === "text" && field.secret && answer?.type === "secret" && isSecretValuePresent(answer.value);
  });
}

function inlineProse(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
