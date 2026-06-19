---
name: loopmark
description: "Use when an AI agent needs structured human input through the Loopmark CLI: product decisions, preferences, approvals, private details, ranked priorities, or secrets that should stay out of chat/stdout. Do not use for facts the agent can verify from code, logs, docs, tests, APIs, or web research."
---

# Loopmark

## Overview

Loopmark is a cloud-backed human-input handoff for agents. Use it to create an encrypted public fill page, give the URL to the human, then read the pasted Answer Text directly. If secrets were omitted, download the encrypted secret bundle with the local receipt file.

## Operating Principles

- Investigate first. Do not ask the human for information you can reasonably discover from the repository, logs, tests, documentation, APIs, or web research.
- Use Loopmark when the blocker is a real human decision: product tradeoff, preference, approval, private context, credential, or ranked priority.
- Ask the smallest useful question set. Prefer 1-5 high-signal fields with clear labels, tradeoffs, and useful defaults.
- Prefer choices for product decisions, rankings for priority ordering, multiline text for nuanced context, and secret text only for sensitive values.
- Treat every field as optional.
- Do not include an `Other` option in single-choice or multiple-choice fields. Loopmark adds `Other` automatically, and it is always present on the fill page for those modes.
- Treat stdout as the only machine-readable stream. Treat stderr as human-readable operational output.
- Do not poll. Create once, wait for the human to paste the copied Answer Text, then run `secrets` only if the Answer Text says secrets were omitted.

## Workflow

1. Decide whether human input is necessary. If the issue is discoverable, research or reproduce it instead.
2. Build a Loopmark session JSON object with `title` and either `fields` or `groups`.
3. Run the cloud create command with the JSON on stdin. Use either inline stdin for short sessions or file redirection when the JSON already exists or is easier to inspect:

```bash
printf '%s\n' '{"title":"Need your decision","fields":[{"id":"direction","label":"Which direction should I take?","type":"choice","mode":"single","options":["Small fix","Broader cleanup"]}]}' | npx --yes @andie/loopmark
```

If the session JSON already exists as a file, redirect it instead:

```bash
npx --yes @andie/loopmark < /path/to/questions.json
```

`--yes` belongs to `npx`; it prevents package-runner install prompts. It is not a Loopmark CLI option.

4. Parse stdout from the create command. It has `status`, `fillUrl`, `receiptFile`, and `sessionId`.
5. Send only `fillUrl` to the human. Keep `receiptFile` local; it contains the answer decryption key.
6. Ask the human to open the URL, answer in the browser, click Copy answers, and paste the copied Answer Text back into chat. Then stop tool activity for this wait. Do not rerun create and do not poll.
7. When the human pastes the Answer Text, read the non-secret answers directly from it. The Answer Text is the durable conversation record; do not replace it with a short retrieval token.
8. If the Answer Text contains a `Secrets` section, run the listed command or use the same `sessionId` from create:

```bash
npx --yes @andie/loopmark secrets s_xxx
```

9. Parse stdout from `secrets`. If it returns `status: "secrets_downloaded"`, use `preview.text` to understand the redacted `.env` shape and read the reported `.env` file only when the task truly requires the secret values.
10. Avoid exposing secret file contents unless the task truly requires reading them.

For a self-hosted Loopmark service, pass `--base-url https://your-loopmark.example` on the create command or set `LOOPMARK_BASE_URL`.

## Minimal Session

```json
{
  "title": "Need your decision",
  "description": "I checked the repository and need one product call before continuing.",
  "fields": [
    {
      "id": "implementation_scope",
      "label": "Which implementation scope should I use?",
      "type": "choice",
      "mode": "single",
      "default": {
        "label": "Bundled Skill support",
        "description": "Ship the Skill in the repository so Vercel skills can install it."
      },
      "options": [
        {
          "label": "Bundled Skill support",
          "description": "Add standard skills/loopmark files so Vercel skills can discover them."
        },
        {
          "label": "Research only",
          "description": "Stop after reporting findings and ask again before editing files."
        }
      ]
    },
    {
      "id": "notes",
      "label": "Any nuance I should preserve?",
      "type": "text",
      "multiline": true
    }
  ]
}
```

## Protocol Reference

Read `references/protocol.md` when constructing grouped sessions, using secrets, setting choice defaults, interpreting output shapes, specifying another Loopmark server with `--base-url` / `LOOPMARK_BASE_URL`, or debugging validation and secret download errors.

Deployment is human-facing project setup, not part of the agent handoff protocol. If the human asks how to deploy Loopmark, point them to the README self-hosting docs: https://github.com/Andiedie/loopmark#self-hosting-on-cloudflare
