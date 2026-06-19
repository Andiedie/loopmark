# Agent Notes

Use this file as the routing layer for future agents. Keep it short and move durable detail to the linked source documents.

## Project Rules

- Use `pnpm`; `package.json` declares `packageManager: pnpm@11.5.2`.
- Investigate repository facts before asking a human. Loopmark is for real human decisions, private context, approvals, preferences, ranked priorities, or secrets.
- Do not ask with Loopmark for facts discoverable from code, tests, logs, docs, APIs, or web research.
- The published agent skill lives under `skills/loopmark/`; treat those Markdown files as product protocol, not ordinary docs.

## Where To Look

- Domain language and invariants: `CONTEXT.md`.
- Documentation rules and ownership: `docs/agents/documentation.md`.
- Product design constraints: `DESIGN.md`.
- Cloudflare deployment and self-hosting: `docs/operations/cloudflare.md`.
- Architecture decisions: `docs/adr/`.
- Agent-facing Loopmark usage protocol: `skills/loopmark/SKILL.md`; read `skills/loopmark/references/protocol.md` for grouped sessions, secrets, custom base URLs, output shapes, or validation errors.

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues. External PRs are not a triage request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: read root `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Before Finishing

- Run the narrowest relevant checks first, then broaden when shared behavior changed.
- For doc-only changes, at minimum run `git diff --check` and search for stale links or references.
- If behavior docs or skill docs changed, run `pnpm exec vitest run tests/skill.test.ts --coverage=false`.
