import { z } from "zod";
import {
  LoopmarkInputError,
  makeError,
  zodIssueToAgentError,
  type AgentValidationError
} from "./errors";

export type ChoiceMode = "single" | "multiple" | "ranking";

export type NormalizedChoiceItem = {
  id: string;
  label: string;
  description?: string;
};

export type NormalizedFieldBase = {
  id: string;
  label: string;
  description?: string;
};

export type NormalizedTextField = NormalizedFieldBase & {
  type: "text";
  multiline: boolean;
  secret: boolean;
  default?: string;
};

export type NormalizedChoiceField = NormalizedFieldBase & {
  type: "choice";
  mode: ChoiceMode;
  options: NormalizedChoiceItem[];
  defaultItems: NormalizedChoiceItem[];
};

export type NormalizedField = NormalizedTextField | NormalizedChoiceField;

export type NormalizedGroup = {
  id: string;
  title: string;
  description?: string;
  fields: NormalizedField[];
};

export type NormalizedSession = {
  title: string;
  description?: string;
  groups: NormalizedGroup[];
};

const jsonString = z.string().trim().min(1);

const optionSchema = z.union([
  jsonString,
  z
    .object({
      value: jsonString.optional(),
      label: jsonString,
      description: z.string().trim().optional()
    })
    .strict()
]);

const fieldSchema = z
  .object({
    id: jsonString,
    type: z.enum(["text", "choice"]).optional(),
    label: jsonString,
    description: z.string().trim().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    multiline: z.boolean().optional(),
    secret: z.boolean().optional(),
    format: z.enum(["plain", "markdown", "code"]).optional(),
    mode: z.enum(["single", "multiple", "ranking"]).optional(),
    options: z.array(optionSchema).optional(),
    allowCustom: z.boolean().optional(),
    editable: z.boolean().optional()
  })
  .strict();

const groupSchema = z
  .object({
    id: jsonString.optional(),
    title: jsonString,
    description: z.string().trim().optional(),
    fields: z.array(fieldSchema).min(1)
  })
  .strict();

const sessionSchema = z
  .object({
    title: jsonString,
    description: z.string().trim().optional(),
    fields: z.array(fieldSchema).min(1).optional(),
    groups: z.array(groupSchema).min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.fields && !value.groups) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Provide either fields or groups."
      });
    }

    if (value.fields && value.groups) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Use either fields or groups, not both."
      });
    }
  });

type RawField = z.infer<typeof fieldSchema>;
type RawGroup = z.infer<typeof groupSchema>;
type RawSession = z.infer<typeof sessionSchema>;
type RawGroupDescriptor = {
  group: RawGroup;
  fieldPathPrefix: string;
};

export function parseInputJson(input: string): NormalizedSession {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new LoopmarkInputError([
      makeError({
        path: "$",
        code: "invalid_json",
        message: error instanceof Error ? error.message : "Input is not valid JSON.",
        why: "Loopmark reads stdin as JSON before it can render any questions.",
        fix: "Pass a valid JSON object to stdin, for example: cat questions.json | loopmark.",
        example: {
          title: "Need your input",
          fields: [{ id: "scope", label: "What should be in scope?", type: "text" }]
        }
      })
    ]);
  }

  return normalizeSession(parsed);
}

export function normalizeSession(input: unknown): NormalizedSession {
  const result = sessionSchema.safeParse(input);

  if (!result.success) {
    throw new LoopmarkInputError(result.error.issues.map(zodIssueToAgentError));
  }

  const errors: AgentValidationError[] = [];
  const rawGroups = getRawGroups(result.data);
  collectDuplicateGroupErrors(rawGroups, errors);
  const groups = rawGroups.map(({ group, fieldPathPrefix }, groupIndex) =>
    normalizeGroup(group, groupIndex, fieldPathPrefix, errors)
  );

  collectDuplicateFieldErrors(rawGroups, errors);

  if (errors.length > 0) {
    throw new LoopmarkInputError(errors);
  }

  return {
    title: result.data.title,
    description: cleanOptional(result.data.description),
    groups
  };
}

function getRawGroups(session: RawSession): RawGroupDescriptor[] {
  if (session.groups) {
    return session.groups.map((group, index) => ({
      group,
      fieldPathPrefix: `groups[${index}].fields`
    }));
  }

  return [
    {
      group: {
        id: "questions",
        title: session.title,
        description: session.description,
        fields: session.fields ?? []
      },
      fieldPathPrefix: "fields"
    }
  ];
}

function normalizeGroup(
  group: RawGroup,
  groupIndex: number,
  fieldPathPrefix: string,
  errors: AgentValidationError[]
): NormalizedGroup {
  return {
    id: normalizedGroupId(group, groupIndex),
    title: group.title,
    description: cleanOptional(group.description),
    fields: group.fields.map((field, fieldIndex) =>
      normalizeField(field, `${fieldPathPrefix}[${fieldIndex}]`, errors)
    )
  };
}

function normalizeField(field: RawField, path: string, errors: AgentValidationError[]): NormalizedField {
  const type = field.type ?? "text";
  const base = {
    id: field.id,
    label: field.label,
    description: cleanOptional(field.description)
  };

  if (type === "text") {
    if (field.options || field.mode) {
      errors.push(
        makeError({
          path,
          code: "text_field_has_choice_keys",
          message: "Text fields cannot define mode or options.",
          why: "Text fields render free-form input. Choice behavior belongs to type: \"choice\".",
          fix: "Remove mode/options, or change this field to type: \"choice\".",
          example: { id: field.id, type: "choice", label: field.label, options: ["Yes", "No"] }
        })
      );
    }

    if (field.default !== undefined && typeof field.default !== "string") {
      errors.push(
        makeError({
          path: `${path}.default`,
          code: "invalid_text_default",
          message: "Text default must be a string.",
          why: "The default is inserted into a text input as the agent's recommended answer.",
          fix: "Use a string default, or remove default.",
          example: "Prefer the simplest useful implementation."
        })
      );
    }

    if (field.secret && field.default !== undefined) {
      errors.push(
        makeError({
          path: `${path}.default`,
          code: "secret_default_not_allowed",
          message: "Secret fields cannot include a default value.",
          why: "Secret defaults would place sensitive content in the input JSON and page state.",
          fix: "Remove default from this secret field.",
          example: { id: field.id, type: "text", secret: true, label: field.label }
        })
      );
    }

    return {
      ...base,
      type: "text",
      multiline: field.multiline ?? false,
      secret: field.secret ?? false,
      default: typeof field.default === "string" ? field.default : undefined
    };
  }

  if (!field.options || field.options.length === 0) {
    errors.push(
      makeError({
        path: `${path}.options`,
        code: "missing_choice_options",
        message: "Choice fields must include at least one option.",
        why: "Loopmark needs initial options before the user can select or rank feedback.",
        fix: "Add an options array. Use strings for the shortest input JSON.",
        example: ["Simple first", "Complete architecture", "Ask me again later"]
      })
    );
  }

  const options = normalizeOptions(field.options ?? [], `${path}.options`, errors);
  const mode = field.mode ?? "single";
  const defaultItems = normalizeDefaultItems({
    field,
    path,
    options,
    mode,
    errors
  });

  return {
    ...base,
    type: "choice",
    mode,
    options,
    defaultItems
  };
}

function normalizeOptions(
  options: Array<string | { value?: string; label: string; description?: string }>,
  path: string,
  errors: AgentValidationError[]
): NormalizedChoiceItem[] {
  const seenLabels = new Set<string>();

  return options.map((option, index) => {
    const item =
      typeof option === "string"
        ? { id: `option_${index + 1}`, label: option }
        : {
            id: `option_${index + 1}`,
            label: option.label,
            description: cleanOptional(option.description)
          };

    if (seenLabels.has(item.label)) {
      errors.push(
        makeError({
          path: typeof option === "string" ? `${path}[${index}]` : `${path}[${index}].label`,
          code: "duplicate_option_label",
          message: "Choice option label must be unique.",
          why: "Final answers use labels and the UI uses labels to track selected options, so duplicate labels are ambiguous.",
          fix: "Rename one option label so every option in this field is distinct.",
          example: `${item.label} ${index + 1}`
        })
      );
    }
    seenLabels.add(item.label);

    return item;
  });
}

function normalizeDefaultItems(input: {
  field: RawField;
  path: string;
  options: NormalizedChoiceItem[];
  mode: ChoiceMode;
  errors: AgentValidationError[];
}): NormalizedChoiceItem[] {
  const { field, path, options, mode, errors } = input;

  if (field.default === undefined) {
    return mode === "ranking" ? options : [];
  }

  if (mode === "single") {
    if (Array.isArray(field.default)) {
      errors.push(
        makeError({
          path: `${path}.default`,
          code: "invalid_single_default",
          message: "Single choice default must be one item, not an array.",
          why: "Single choice can only recommend one answer.",
          fix: "Use a string or option-like object as default.",
          example: "Simple first"
        })
      );
      return [];
    }

    const item = normalizeDefaultItem(field.default, options, `${path}.default`, errors);
    return item ? [item] : [];
  }

  if (!Array.isArray(field.default)) {
    errors.push(
      makeError({
        path: `${path}.default`,
        code: "invalid_list_default",
        message: `${mode} choice default must be an array.`,
        why: "Multiple and ranking choices can recommend several items.",
        fix: "Use an array of option labels or option-like objects.",
        example: ["Schema validation", "CLI lifecycle"]
      })
    );
    return [];
  }

  const defaultItems = field.default
    .map((item, index) => ({
      index,
      item: normalizeDefaultItem(item, options, `${path}.default[${index}]`, errors)
    }))
    .filter((entry): entry is { index: number; item: NormalizedChoiceItem } => Boolean(entry.item));

  collectDuplicateDefaultErrors(defaultItems, `${path}.default`, errors);
  return defaultItems.map((entry) => entry.item);
}

function normalizeDefaultItem(
  value: unknown,
  options: NormalizedChoiceItem[],
  path: string,
  errors: AgentValidationError[]
): NormalizedChoiceItem | null {
  if (typeof value === "string") {
    const label = value.trim();

    if (label.length === 0) {
      errors.push(
        makeError({
          path,
          code: "invalid_default_item",
          message: "Default item must not be empty.",
          why: "Empty default items would render as blank recommendations and serialize to no answer.",
          fix: "Use an existing option label, or remove this default item.",
          example: options[0]?.label ?? "Existing option"
        })
      );
      return null;
    }

    const matched = options.find((option) => option.label === label);
    if (matched) {
      return matched;
    }

    errors.push(
      makeError({
        path,
        code: "unknown_default_option",
        message: "Default does not match any option.",
        why: "Choice defaults must point to an option the agent provided.",
        fix: "Use one of the option labels, or remove the default.",
        example: options[0]?.label ?? "Existing option"
      })
    );
    return null;
  }

  const objectResult = z
    .object({
      label: jsonString,
      description: z.string().trim().optional()
    })
    .strict()
    .safeParse(value);

  if (objectResult.success) {
    const matched = options.find((option) => option.label === objectResult.data.label);
    const description = cleanOptional(objectResult.data.description);

    if (matched) {
      return {
        ...matched,
        ...(description ? { description } : {})
      };
    }

    errors.push(
      makeError({
        path,
        code: "unknown_default_option",
        message: "Default does not match any option.",
        why: "Choice defaults must point to an option the agent provided.",
        fix: "Use one of the option labels, or remove the default.",
        example: options[0]?.label ?? "Existing option"
      })
    );
    return null;
  }

  errors.push(
    makeError({
      path,
      code: "invalid_default_item",
      message: "Default item must be a string or an object with label and optional description.",
      why: "Loopmark needs a readable recommendation that can become the user's answer.",
      fix: "Use a string for compact input, or { label, description } for richer feedback.",
      example: { label: "Paper Trail UI", description: "Keep the interface elegant and document-like." }
    })
  );
  return null;
}

function collectDuplicateDefaultErrors(
  defaults: Array<{ index: number; item: NormalizedChoiceItem }>,
  path: string,
  errors: AgentValidationError[]
) {
  const seen = new Map<string, number>();

  for (const { index, item } of defaults) {
    const label = item.label.trim();
    const previousIndex = seen.get(label);

    if (previousIndex !== undefined) {
      errors.push(
        makeError({
          path: `${path}[${index}]`,
          code: "duplicate_default_option",
          message: "Choice defaults cannot repeat the same label.",
          why: "Final answers use labels, and repeated defaults would create an invalid initial answer.",
          fix: "Remove the repeated default or rename it so every default answer is distinct.",
          example: `${label} ${index + 1}`
        })
      );
    } else {
      seen.set(label, index);
    }
  }
}

function collectDuplicateGroupErrors(groups: RawGroupDescriptor[], errors: AgentValidationError[]) {
  const seen = new Map<string, string>();

  groups.forEach(({ group }, groupIndex) => {
    const groupId = normalizedGroupId(group, groupIndex);
    const path = `groups[${groupIndex}].id`;
    const previous = seen.get(groupId);

    if (previous) {
      errors.push(
        makeError({
          path,
          code: "duplicate_group_id",
          message: `Duplicate group id: ${groupId}.`,
          why: "The UI uses group ids for document anchors, outline links, React keys, and collapsed-section state.",
          fix: "Give each group a unique id, or omit ids and let Loopmark generate stable ids.",
          example: `${groupId}_${groupIndex + 1}`
        })
      );
    } else {
      seen.set(groupId, path);
    }
  });
}

function collectDuplicateFieldErrors(groups: RawGroupDescriptor[], errors: AgentValidationError[]) {
  const seen = new Map<string, string>();

  groups.forEach(({ group, fieldPathPrefix }) => {
    group.fields.forEach((field, fieldIndex) => {
      const path = `${fieldPathPrefix}[${fieldIndex}].id`;
      const previous = seen.get(field.id);

      if (previous) {
        errors.push(
          makeError({
            path,
            code: "duplicate_field_id",
            message: `Duplicate field id: ${field.id}.`,
            why: "Final answers are keyed by field id, so duplicate ids would overwrite each other.",
            fix: "Give each field a unique stable id.",
            example: `${field.id}_${fieldIndex + 1}`
          })
        );
      } else {
        seen.set(field.id, path);
      }
    });
  });
}

function normalizedGroupId(group: RawGroup, groupIndex: number): string {
  return group.id ?? `group_${groupIndex + 1}`;
}

function cleanOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
