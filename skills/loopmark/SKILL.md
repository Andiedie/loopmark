---
name: loopmark
description: "Use when an AI agent needs to pause for local human input through the Loopmark CLI: product decisions, preferences, approvals, private local details, ranked options, or secrets that should stay out of chat/stdout. Do not use for facts the agent can verify from code, logs, docs, tests, or web research."
---

# Loopmark

## Overview

Loopmark is a local human-input gate for agents. Use it to ask the human a compact, structured set of questions, then continue from the JSON result written to stdout.

## Operating Principles

- Investigate first. Do not ask the human for information you can reasonably discover from the repository, logs, tests, documentation, APIs, or web research.
- Use Loopmark when the blocker is a real human decision: product tradeoff, preference, approval, private context, local credential, or ranked priority.
- Ask the smallest useful question set. Prefer 1-5 high-signal fields with clear labels, tradeoffs, and useful defaults.
- Prefer choices for product decisions, rankings for priority ordering, multiline text for nuanced context, and secret text only for sensitive values.
- Treat stderr as operational output and stdout as the only machine-readable final answer stream.

## Workflow

1. Decide whether human input is necessary. If the issue is discoverable, research or reproduce it instead.
2. Build a Loopmark session JSON object with `title` and either `fields` or `groups`.
3. Run Loopmark with JSON on stdin through the package runner available in the environment. These commands open the browser by default:

```bash
npx @andie/loopmark < /path/to/questions.json
```

```bash
pnpx @andie/loopmark < /path/to/questions.json
```

If `loopmark` is already on PATH, `loopmark < /path/to/questions.json` is also acceptable.

4. Share the URL printed on stderr with the human if the browser did not open automatically.
5. Keep the command running until Loopmark writes the final JSON result to stdout.
6. Parse stdout, incorporate the answers into the work, and avoid exposing secret file contents unless the task truly requires reading them.

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

Read `references/protocol.md` when constructing grouped sessions, using secrets, setting choice defaults, interpreting output shapes, or debugging validation errors.
