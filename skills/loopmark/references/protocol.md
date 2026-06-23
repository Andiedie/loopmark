# Loopmark Protocol

## CLI Contract

Loopmark has one cloud create command and one local secret download command:

1. Create a cloud session from JSON on stdin.
2. Read the pasted Answer Text directly.
3. Download omitted secrets later with the local receipt file only if the Answer Text includes a secrets section.

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

## Opening Fill Pages In Agent Browsers

After create succeeds, present `fillUrl` to the human. If the agent runtime exposes an in-app browser control capability, use it to open the fill URL for the human. In Codex, this means using the `browser:control-in-app-browser` skill when it is listed or discoverable, even if the low-level browser object is not already mounted in the current tool list.

The in-app browser is only a presentation surface. Do not treat browser state, screenshots, DOM reads, or page scraping as the answer transport. The human still needs to click Copy answers and paste the copied Answer Text back to chat so the conversation has the durable human-visible record.

If no browser control capability is available, or ordinary setup fails, give the human the clickable `fillUrl` and wait. Do not install plugins, poll the page, rerun create, or spend time debugging unrelated browser tooling solely for Loopmark.

After the human answers in the browser, clicks Copy answers, and pastes the copied Answer Text back to chat, read non-secret answers directly from that Answer Text. Do not ask the human to paste only "done" or a short retrieval token; the Answer Text is the durable conversation record.

If the Answer Text says secrets were omitted, download the encrypted secret bundle by session id:

```bash
npx --yes @andie/loopmark secrets s_xxx
```

The Answer Text includes a human-readable answer summary. Secret values are omitted and replaced by a command when a secret value was entered. Notes remain visible in Answer Text.

```text
Scope
Answer: Keep the smallest viable change.
Field: scope

API token
Answer: [secret omitted]
Field: api_token

Secrets
Secret values were omitted. Run this on the agent machine:
npx --yes @andie/loopmark secrets s_xxx
```

Secret download stdout is:

```json
{
  "status": "secrets_downloaded",
  "sessionId": "s_xxx",
  "secretFile": "/tmp/loopmark-s_xxx/secrets.env",
  "format": "env",
  "preview": {
    "kind": "env_redacted",
    "text": "api_token=<redacted>\n"
  }
}
```

The redacted preview shows the `.env` keys without exposing values. The actual secret file is `.env` style:

```dotenv
api_token=secret-value
```

Do not poll. Run `secrets` only after the human pastes copied Answer Text that says secrets were omitted.

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

The Worker and R2 store encrypted session envelopes and encrypted secret bundles only. Non-secret answers and notes are not posted to or stored by the Worker; they exist in the pasted Answer Text conversation. Secret values are encrypted in the browser, uploaded as ciphertext, decrypted during `secrets`, written to a local `.env` file, and omitted from stdout.

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

Field ids must be unique across the whole session. Prefer stable `snake_case` ids because the pasted Answer Text and secret `.env` file both refer to field ids.

All fields are optional.
The fill page lets the human skip any field. Skipping clears the field's text, selected choices, ranking, secret value, and note so agent-provided defaults are not copied back as answers.

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
- `secret`: omit the submitted value from Answer Text, encrypt it in the browser, and later write it to a local `.env` file with `loopmark secrets`.

Do not set `default` on secret fields.

Secret text fields also include a collapsed public note control in the fill page. When expanded and filled, the note is visible in Answer Text like other notes and is not written to the secret `.env` file.

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

Single, multiple, and ranking choice fields also include a collapsed note control in the fill page. The human can expand it to explain why they chose an option, why they reordered items, or why they skipped the question.

## Pasted Answer Text Shape

Text answers are visible in Answer Text. The field label is the question text, and the field id is kept as secondary metadata:

```text
What context should I preserve?
Answer: Keep the implementation small.
Field: context
```

Single choice answers include the selected label and optional description:

```text
Which direction should I implement?
Answer: Smallest compatible package change
Details: Publish the bundled skill and README instructions.
Field: direction
```

Multiple and ranking choice answers list each choice. Ranking order is the Answer Text order.

Choice answers may include a note:

```text
Rank priorities
Answer:
Choice 1: Beta
Details 1: Most urgent user-visible fix.
Choice 2: Alpha
Note: This keeps the change small enough to review today.
Field: priority
```

Secret answers are omitted from Answer Text:

```text
Optional API token
Answer: [secret omitted]
Field: api_token
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
