import type { SubmitPayload, SubmittedAnswer } from "./answer-state";
import { isSecretValuePresent, normalizeChoiceItems, normalizeTextAnswer } from "./answer-state";
import { assertSessionId } from "./cloud-protocol";
import type { NormalizedField, NormalizedSession } from "./schema";

export function createAnswerMarkdown(input: {
  sessionId: string;
  session: NormalizedSession;
  payload: SubmitPayload;
  now?: Date;
}): string {
  const fields = flattenFields(input.session);
  const hasSecretValues = hasSubmittedSecretValues(fields, input.payload);
  const secretRetrievalCommand = hasSecretValues ? secretCommand(input.sessionId) : undefined;

  return [
    `# ${inlineProse(input.session.title)} Answers`,
    "",
    hasSecretValues
      ? "Paste this Markdown back to the agent. Secret values are omitted below and require the listed Loopmark command."
      : "Paste this Markdown back to the agent.",
    "",
    ...fields.flatMap((field) => renderField(field, input.payload.answers[field.id])),
    ...renderSecretRetrieval(secretRetrievalCommand),
    ""
  ].join("\n");
}

function renderField(field: NormalizedField, answer: SubmittedAnswer | undefined): string[] {
  return [
    `## ${inlineProse(field.label)}`,
    "",
    "Field:",
    "",
    ...quoteProse(field.id),
    "",
    ...renderAnswer(field, answer),
    ""
  ];
}

function renderAnswer(field: NormalizedField, answer: SubmittedAnswer | undefined): string[] {
  if (field.type === "text" && field.secret) {
    const note = answer?.type === "secret" ? normalizeTextAnswer(answer.note) : null;
    const answerLines =
      answer?.type === "secret" && isSecretValuePresent(answer.value)
        ? ["Answer: _Secret omitted from Markdown._"]
        : ["Answer: _No secret value provided._"];
    return note ? [...answerLines, "", ...renderTextValue("Note", note)] : answerLines;
  }

  if (field.type === "text") {
    const value = answer?.type === "text" ? normalizeTextAnswer(answer.value) : null;
    return renderTextValue("Answer", value);
  }

  if (answer?.type !== "choice") {
    return ["Answer: _No answer_"];
  }

  const items = normalizeChoiceItems(answer.items);
  const note = normalizeTextAnswer(answer.note);
  const answerLines =
    items.length === 0
      ? ["Answer: _No answer_"]
      : field.mode === "single"
        ? ["Answer:", "", ...renderChoiceItem(items[0])]
        : ["Answer:", "", ...items.flatMap((item, index) => [`Choice ${index + 1}:`, "", ...renderChoiceItem(item), ""])];

  return note ? [...answerLines, "", ...renderTextValue("Note", note)] : answerLines;
}

function renderSecretRetrieval(command: string | undefined): string[] {
  if (!command) {
    return [];
  }

  return [
    "## Secrets",
    "",
    "Secret answers were omitted from this Markdown. Run this command on the agent machine to download them:",
    "",
    "```sh",
    command,
    "```",
    ""
  ];
}

function secretCommand(sessionId: string): string {
  return `npx --yes @andie/loopmark secrets ${assertSessionId(sessionId)}`;
}

function renderTextValue(label: string, value: string | null): string[] {
  if (!value) {
    return [`${label}: _No answer_`];
  }

  return [`${label}:`, "", ...quoteProse(value)];
}

function quoteProse(value: string): string[] {
  return value.split(/\r?\n/).map((line) => `> ${line}`);
}

function renderChoiceItem(item: { label: string; description?: string }): string[] {
  const lines = ["Label:", "", ...quoteProse(item.label)];
  if (!item.description) {
    return lines;
  }

  return [...lines, "", "Description:", "", ...quoteProse(item.description)];
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
