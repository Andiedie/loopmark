---
name: loopmark
description: "Use when an AI agent needs structured human input through the cloud-only Loopmark CLI: product decisions, preferences, approvals, private details, ranked priorities, or secrets that should stay out of chat/stdout. Do not use for facts the agent can verify from code, logs, docs, tests, APIs, or web research."
---

# Loopmark

## Overview

Loopmark is a cloud-only human-input handoff for agents. Use it to create an encrypted public fill page, give the URL to the human, then collect the encrypted answer later with the local receipt file.

## Operating Principles

- Investigate first. Do not ask the human for information you can reasonably discover from the repository, logs, tests, documentation, APIs, or web research.
- Use Loopmark when the blocker is a real human decision: product tradeoff, preference, approval, private context, credential, or ranked priority.
- Ask the smallest useful question set. Prefer 1-5 high-signal fields with clear labels, tradeoffs, and useful defaults.
- Prefer choices for product decisions, rankings for priority ordering, multiline text for nuanced context, and secret text only for sensitive values.
- Treat stdout as the only machine-readable stream. Treat stderr as human-readable operational output.
- Do not poll. Create once, wait for the human to say they submitted the form, then run `collect` once.

## Workflow

1. Decide whether human input is necessary. If the issue is discoverable, research or reproduce it instead.
2. Build a Loopmark session JSON object with `title` and either `fields` or `groups`.
3. Run the cloud create command with the JSON on stdin:

```bash
npx @andie/loopmark < /path/to/questions.json
```

4. Parse stdout from the create command. It has `status`, `fillUrl`, `receiptFile`, and `sessionId`.
5. Send only `fillUrl` to the human. Keep `receiptFile` local; it contains the answer decryption key.
6. Tell the human you will continue after they submit the form. Then stop tool activity for this wait. Do not rerun create and do not run `collect` repeatedly.
7. When the human says the form is submitted, run:

```bash
npx @andie/loopmark collect /path/to/s_xxx.receipt.json
```

8. Parse stdout from `collect`. If it returns `status: "pending"`, tell the human the form is not submitted yet and wait again. If it returns `status: "submitted"`, incorporate the answers into the work.
9. Avoid exposing secret file contents unless the task truly requires reading them.

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
      "required": true,
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
      "format": "markdown",
      "multiline": true
    }
  ]
}
```

## Protocol Reference

Read `references/protocol.md` when constructing grouped sessions, using secrets, setting choice defaults, interpreting output shapes, specifying another Loopmark server with `--base-url` / `LOOPMARK_BASE_URL`, or debugging validation and collection errors.

Deployment is human-facing project setup, not part of the agent handoff protocol. If the human asks how to deploy Loopmark, point them to the README self-hosting docs: https://github.com/Andiedie/loopmark#self-hosting-on-cloudflare
