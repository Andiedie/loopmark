# Loopmark Protocol

## CLI Contract

Loopmark has one cloud create command and one local secret download command:

1. Create a cloud session from JSON on stdin.
2. Read the pasted Markdown answer directly.
3. Download omitted secrets later with the local receipt file only if the Markdown includes a secrets section.

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

Keep the `receiptFile` path local. It contains the secret decryption key and is required for `secrets`.

After the human opens the fill URL, answers in the browser, clicks Copy answers, and pastes the copied Markdown back to chat, read non-secret answers directly from that Markdown. Do not ask the human to paste only "done" or a short retrieval token; the Markdown is the durable conversation record.

If the Markdown says secrets were omitted, download the encrypted secret bundle by session id:

```bash
npx --yes @andie/loopmark secrets s_xxx
```

The Markdown includes a human-readable answer summary. Secret values are omitted and replaced by a command when a secret value was entered. Notes remain visible in Markdown.

````markdown
## Scope

Answer:

> Keep the smallest viable change.

## API token

Answer: _Secret omitted from Markdown._

## Secrets

Secret answers were omitted from this Markdown. Run this command on the agent machine to download them:

```sh
npx --yes @andie/loopmark secrets s_xxx
```
````

Secret download stdout is:

```json
{
  "status": "secrets_downloaded",
  "sessionId": "s_xxx",
  "secretFile": "/tmp/loopmark-s_xxx/secrets.env",
  "format": "env"
}
```

The secret file is `.env` style:

```dotenv
api_token=secret-value
```

Do not poll. Run `secrets` only after the human pastes copied Markdown that says secrets were omitted.

Use another Loopmark server with:

```bash
npx --yes @andie/loopmark --base-url https://your-loopmark.example < /path/to/questions.json
```

or set `LOOPMARK_BASE_URL` in the agent runtime.

Use a custom receipt or secret directory only when the runtime needs one:

```bash
npx --yes @andie/loopmark --receipt-dir /path/to/receipts < /path/to/questions.json
npx --yes @andie/loopmark secrets s_xxx --receipt /path/to/s_xxx.receipt.json --secret-dir /path/to/secrets
```

## Security Model

The public fill URL contains only a session code in the URL hash. The local receipt file contains the secret decryption key. Do not share receipt files in chat, logs, commits, issue comments, or messages to the human.

The Worker and R2 store encrypted session envelopes and encrypted secret bundles only. Non-secret answers and notes are not posted to or stored by the Worker; they exist in the pasted Markdown conversation. Secret values are encrypted in the browser, uploaded as ciphertext, decrypted during `secrets`, written to a local `.env` file, and omitted from stdout.

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

Field ids must be unique across the whole session. Prefer stable `snake_case` ids because the pasted Markdown and secret `.env` file both refer to field ids.

All fields are optional.

## Text Fields

Text fields are the default field type:

```json
{
  "id": "context",
  "label": "What context should I preserve?",
  "type": "text",
  "multiline": true,
  "default": "Keep the implementation small and package-compatible."
}
```

Supported text keys:

- `multiline`: render a textarea.
- `default`: string only.
- `secret`: omit the submitted value from Markdown, encrypt it in the browser, and later write it to a local `.env` file with `loopmark secrets`.

Do not set `default` on secret fields.

Secret text fields also include a normal note textarea in the fill page. The note is visible in Markdown like other notes and is not written to the secret `.env` file.

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
- `options`: strings or `{ "label", "description" }` objects.
- `default`: string or `{ "label", "description" }` for `single`; array for `multiple` and `ranking`.

Choice defaults must match existing option labels. Use object defaults only when you want to keep the option label and override the default answer description.

For `single` and `multiple` choice fields, Loopmark always adds a system `Other` option. Do not include `Other` yourself. When the human selects `Other`, Loopmark reveals an input and returns the typed value as the selected answer label. If the input is empty, no `Other` answer is submitted.

For `ranking` fields with no explicit default, Loopmark initially ranks all options in the provided order.

Single, multiple, and ranking choice fields also include a note textarea in the fill page. The human can explain why they chose an option, why they reordered items, or why they skipped the question.

## Pasted Markdown Shape

Text answers are visible in Markdown:

```markdown
## What context should I preserve?

Field:

> context

Answer:

> Keep the implementation small.
```

Single choice answers include the selected label and optional description:

```markdown
## Which direction should I implement?

Field:

> direction

Answer:

Label:

> Smallest compatible package change
```

Multiple and ranking choice answers list each choice. Ranking order is the Markdown order.

Choice answers may include a note:

```markdown
Note:

> This keeps the change small enough to review today.
```

Secret answers are omitted from Markdown:

```markdown
## Optional API token

Field:

> api_token

Answer: _Secret omitted from Markdown._
```

After running `loopmark secrets`, secret values are written to the reported `.env` file. Read that file only when the task requires the value. Do not paste secret values into chat, logs, commits, or non-secret outputs.

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
      "why": "Loopmark needs initial options before the user can select or rank feedback.",
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
