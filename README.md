# Loopmark

Loopmark is a local Human Input gate for AI Agents.

```bash
cat examples/basic.json | loopmark
```

The CLI reads a JSON question session from stdin, starts a temporary local web page, waits for human input, and writes the final JSON answers to stdout. Logs, URLs, and validation errors go to stderr.

## Install

```bash
npm install -g @andie/loopmark
```

Run once without installing globally:

```bash
cat questions.json | npx --yes @andie/loopmark
```

## Development

```bash
pnpm install
pnpm build
cat examples/basic.json | node dist/cli/index.js
```

Try the local flow with bundled JSON:

```bash
pnpm try:simple
pnpm try:complex
```

`pnpm try:simple` uses an ungrouped session. `pnpm try:complex` uses `examples/full.json`, which exercises grouped sections, multiline text, single/multiple/ranking choices, editable/custom answers, defaults, descriptions, and secret-file output.

## Test

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## Input Shape

Use either top-level `fields` or grouped `groups`.

```json
{
  "title": "Need your input",
  "fields": [
    {
      "id": "scope",
      "label": "What should be in scope?",
      "type": "text",
      "required": true
    }
  ]
}
```

Field types are `text` and `choice`. Choice modes are `single`, `multiple`, and `ranking`.
