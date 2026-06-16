import type { ZodIssue } from "zod";

export type AgentValidationError = {
  path: string;
  code: string;
  message: string;
  why: string;
  fix: string;
  example?: unknown;
};

export type InvalidInputReport = {
  status: "invalid_input";
  errors: AgentValidationError[];
};

export class InterrogateInputError extends Error {
  readonly report: InvalidInputReport;

  constructor(errors: AgentValidationError[]) {
    super("Invalid InterroGate input.");
    this.name = "InterrogateInputError";
    this.report = { status: "invalid_input", errors };
  }
}

export function makeError(error: AgentValidationError): AgentValidationError {
  return error;
}

export function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "$";
  }

  return path
    .map((part, index) => {
      if (typeof part === "number") {
        return `[${part}]`;
      }

      const text = String(part);
      return index === 0 ? text : `.${text}`;
    })
    .join("");
}

export function zodIssueToAgentError(issue: ZodIssue): AgentValidationError {
  const path = formatPath(issue.path);

  if (issue.code === "unrecognized_keys") {
    return {
      path,
      code: "unknown_key",
      message: `Unknown key: ${issue.keys.join(", ")}.`,
      why: "InterroGate keeps the input schema small so agents spend fewer tokens and avoid ambiguous form behavior.",
      fix: "Remove the unknown key, or rename it to one of the supported keys for this object.",
      example: {
        title: "Need your input",
        fields: [{ id: "scope", label: "What should be in scope?", type: "text" }]
      }
    };
  }

  if (issue.code === "invalid_value") {
    return {
      path,
      code: "invalid_value",
      message: issue.message,
      why: "This value is outside the supported InterroGate vocabulary.",
      fix: "Use one of the supported literal values shown in the error message.",
      example: "text"
    };
  }

  if (issue.code === "invalid_type") {
    return {
      path,
      code: "invalid_type",
      message: issue.message,
      why: "The JSON shape does not match what InterroGate can render or return to the agent.",
      fix: "Change the value to the expected JSON type.",
      example: path.endsWith("fields") ? [] : "A short answer"
    };
  }

  return {
    path,
    code: issue.code,
    message: issue.message,
    why: "The input JSON did not pass InterroGate schema validation.",
    fix: "Adjust the value at this path to match the documented schema.",
    example: {
      id: "question_id",
      label: "Question label",
      type: "text"
    }
  };
}
