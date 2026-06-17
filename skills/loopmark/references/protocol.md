# Loopmark Protocol

## CLI Contract

Loopmark has two cloud commands:

1. Create a cloud session from JSON on stdin.
2. Collect the encrypted answer later with the local receipt file.

Create with inline stdin:

```bash
printf '%s\n' '{"title":"Need your input","fields":[{"id":"decision","label":"What should I do next?","type":"text"}]}' | npx --yes @andie/loopmark
```

Create with file redirection:

```bash
npx --yes @andie/loopmark < /path/to/questions.json
```

`--yes` belongs to `npx`; it prevents package-runner install prompts. It is not a Loopmark CLI option.

Create stdout:

```json
{
  "status": "created",
  "fillUrl": "https://loopmark.ssoo.fun/s#lm1_...",
  "receiptFile": "/tmp/loopmark-receipts/s_xxx.receipt.json",
  "sessionId": "s_xxx"
}
```

Create stderr may repeat the URL and receipt path for human readability. Do not parse stderr as the machine-readable result unless the command exits non-zero with a validation report.

Keep the `receiptFile` path local. It contains the answer decryption key and is required for collection.

Collect:

```bash
npx --yes @andie/loopmark collect /tmp/loopmark-receipts/s_xxx.receipt.json
```

Collect stdout is either:

```json
{
  "status": "pending",
  "message": "Loopmark session has not been submitted yet."
}
```

or:

```json
{
  "status": "submitted",
  "answers": {}
}
```

Do not poll. Run `collect` after the human explicitly says the form is submitted. If `collect` returns `pending`, tell the human it is still pending and wait again.

Use another Loopmark server with:

```bash
npx --yes @andie/loopmark --base-url https://your-loopmark.example < /path/to/questions.json
```

or set `LOOPMARK_BASE_URL` in the agent runtime.

Use a custom receipt or secret directory only when the runtime needs one:

```bash
npx --yes @andie/loopmark --receipt-dir /path/to/receipts < /path/to/questions.json
npx --yes @andie/loopmark collect /path/to/s_xxx.receipt.json --secret-dir /path/to/secrets
```

## Security Model

The public fill URL contains only a session code in the URL hash. The local receipt file contains the answer decryption key. Do not share receipt files in chat, logs, commits, issue comments, or messages to the human.

The Worker and R2 only store encrypted JSON envelopes. Browser submissions include a session-code-derived proof, so knowing a `sessionId` alone is not enough to submit an answer. Secret answers are encrypted in the browser, decrypted during `collect`, written to a local temporary file, and omitted from stdout.

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
- `secret`: write the submitted value to a local temporary file during collection instead of stdout.

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

## Submitted Output Shape

Text answers are strings or `null`:

```json
{
  "question": "What context should I preserve?",
  "answer": "Keep the implementation small."
}
```

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
    "description": "Secret value was written to a local temporary file during collection and omitted from answers."
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

Other CLI errors exit non-zero and write JSON to stderr:

```json
{
  "status": "error",
  "message": "Option --base-url requires a value."
}
```
