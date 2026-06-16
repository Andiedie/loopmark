# Loopmark Protocol

## CLI Contract

Loopmark reads one JSON session object from stdin, starts a temporary local web page, waits for the human to submit answers, and writes the final answer JSON to stdout.

Use stderr for URLs, logs, and validation errors. Do not parse stderr as the final result unless the command exits non-zero.

Common commands:

```bash
npx @andie/loopmark < /path/to/questions.json
pnpx @andie/loopmark < /path/to/questions.json
```

If `loopmark` is already on PATH, `loopmark < /path/to/questions.json` is also valid.

Loopmark opens the browser by default. Use `--no-open` or `LOOPMARK_NO_OPEN=1` only in headless or remote environments where opening a local browser is impossible; then share the URL from stderr with the human.

## Session Object

Use either top-level `fields` or `groups`, not both.

```json
{
  "title": "Need your input",
  "description": "Optional context for the whole session.",
  "fields": []
}
```

Grouped sessions use:

```json
{
  "title": "Iteration prep",
  "groups": [
    {
      "id": "scope",
      "title": "Scope",
      "description": "Optional group context.",
      "fields": []
    }
  ]
}
```

Field ids must be unique across the whole session. Prefer stable `snake_case` ids because final answers are keyed by id.

## Text Fields

Text fields are the default field type:

```json
{
  "id": "context",
  "label": "What context should I preserve?",
  "type": "text",
  "required": true,
  "multiline": true,
  "format": "markdown",
  "default": "Keep the implementation small and package-compatible."
}
```

Supported text keys:

- `required`: require a non-empty answer.
- `multiline`: render a textarea.
- `format`: `plain`, `markdown`, or `code`.
- `default`: string only.
- `secret`: write the submitted value to a local temporary file instead of stdout.

Do not set `default` on secret fields.

Secret field example:

```json
{
  "id": "api_token",
  "label": "Optional API token",
  "type": "text",
  "secret": true
}
```

## Choice Fields

Choice fields require a non-empty `options` array:

```json
{
  "id": "direction",
  "label": "Which direction should I implement?",
  "type": "choice",
  "mode": "single",
  "required": true,
  "default": "Smallest compatible package change",
  "options": [
    {
      "label": "Smallest compatible package change",
      "description": "Publish the bundled skill and README instructions."
    },
    {
      "label": "Research only",
      "description": "Stop after reporting findings and ask again before editing files."
    }
  ]
}
```

Supported choice keys:

- `mode`: `single`, `multiple`, or `ranking`; defaults to `single`.
- `options`: strings or `{ "value", "label", "description" }` objects.
- `default`: string or `{ "label", "description" }` for `single`; array for `multiple` and `ranking`.
- `allowCustom`: defaults to `true`.
- `editable`: defaults to `true`.

For `ranking` fields with no explicit default, Loopmark initially ranks all options in the provided order.

## Output Shape

Successful stdout:

```json
{
  "status": "submitted",
  "answers": {
    "context": {
      "question": "What context should I preserve?",
      "answer": "Keep the implementation small."
    }
  }
}
```

Text answers are strings or `null`.

Single choice answers are one object or `null`:

```json
{
  "question": "Which direction should I implement?",
  "answer": {
    "label": "Smallest compatible package change",
    "description": "Publish the bundled skill and README instructions."
  }
}
```

Multiple and ranking choice answers are arrays or `null`. Ranking order is the returned array order.

Secret answers return a file pointer, not the secret value:

```json
{
  "question": "Optional API token",
  "answer": {
    "secretFile": "/tmp/loopmark-secrets/001_api_token.txt",
    "description": "Secret value was written to a local temporary file and omitted from answers."
  }
}
```

Read a secret file only when the task requires the value. Do not paste secret values into chat, logs, commits, or non-secret outputs.

## Validation Failures

Invalid input exits non-zero and writes an agent-readable report to stderr:

```json
{
  "status": "invalid_input",
  "errors": [
    {
      "path": "fields[0].options",
      "code": "missing_choice_options",
      "message": "Choice fields must include at least one option.",
      "why": "Loopmark needs initial options before the user can select, edit, rank, or add custom feedback.",
      "fix": "Add an options array. Use strings for the shortest input JSON.",
      "example": ["Simple first", "Complete architecture"]
    }
  ]
}
```

When validation fails, fix the JSON and rerun Loopmark instead of asking the human to work around a malformed session.
