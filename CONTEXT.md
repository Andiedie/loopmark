# Loopmark Context

## Purpose

Loopmark is a cloud human-input handoff for AI agents. It lets an agent create a small encrypted question session, send a public fill URL to a human, and continue from the Markdown answer the human pastes back.

This document preserves domain language, invariants, and source-of-truth routes that are easy to lose when reading one file at a time.

## Read When

- Changing the CLI, Worker API, browser fill page, answer Markdown, secret handling, or bundled agent skill.
- Updating docs that describe Loopmark's protocol, privacy model, self-hosting, or product boundaries.
- Debugging a mismatch between README, skill protocol, tests, and runtime behavior.

## Source Of Truth

- Session input schema and normalization: `src/shared/schema.ts`.
- Submitted answer validation: `src/shared/submission.ts`.
- Answer Markdown rendering: `src/shared/answer-markdown.ts`.
- Encrypted session, receipt, fill URL, session id, and secret bundle protocol: `src/shared/cloud-protocol.ts`.
- CLI create and secret download lifecycle: `src/cli/run.ts` and `src/cli/remote.ts`.
- Worker API and R2 key layout: `src/server/worker.ts`.
- Browser fill experience: `src/ui/App.tsx`.
- UI design constraints: `DESIGN.md`.
- Agent-facing protocol docs: `skills/loopmark/SKILL.md` and `skills/loopmark/references/protocol.md`.
- Cloudflare deployment: `wrangler.jsonc`, `.github/workflows/deploy-cloudflare.yml`, and `docs/operations/cloudflare.md`.

## Invariants

- Loopmark is a human-input handoff, not a survey SaaS, dashboard, form builder, or approval system.
- Agents investigate first. Loopmark is only for decisions, preferences, approvals, private context, ranked priorities, or secrets that cannot be safely recovered elsewhere.
- Create is one-shot: the agent sends JSON on stdin, the CLI posts an encrypted session envelope, writes a local receipt, prints JSON on stdout, and exits.
- Agents do not poll for ordinary answers. The human copies Markdown in the browser and pastes that Markdown back to the agent.
- Non-secret answers and notes are transported in pasted Markdown. They are not stored as cloud answer objects.
- Secret plaintext must not appear in copied Markdown, stdout, logs, commits, issue comments, or ordinary docs.
- Secret values are encrypted in the browser, uploaded as `sessions/{sessionId}/secrets.json`, then downloaded with `npx --yes @andie/loopmark secrets <session-id>` and written to a local `.env` file.
- R2 stores encrypted session envelopes at `sessions/{sessionId}/session.json` and encrypted secret bundles at `sessions/{sessionId}/secrets.json` only.
- The public fill URL carries a session code in the URL hash. The local receipt file carries the private key required for secret download and must stay local.
- All fields are optional. Single and multiple choice fields get a system `Other` option in the UI; ranking fields do not.
- `--yes` is an `npx` option, not a Loopmark CLI option.

## Domain Language

- Agent: the AI system asking for human input.
- Human: the person opening the fill URL and pasting copied Markdown back.
- Session: one normalized question document with a title and either top-level fields or groups.
- Field: one text or choice question. Text fields may be secret. Choice fields can be single, multiple, or ranking.
- Group: a chapter-like section for complex sessions. Ungrouped input is normalized into one group.
- Fill URL: public browser URL generated from the base URL and session code hash.
- Session code: URL-hash secret used by the browser to derive the session id, decrypt the session envelope, and authorize secret upload.
- Session id: stable `s_...` id derived from the session code and used in Worker API paths and receipt filenames.
- Receipt: local JSON file written by the CLI. It stores session metadata and the private key for decrypting omitted secrets.
- Answer Markdown: the human-readable answer transport pasted back to the agent.
- Secret bundle: encrypted browser upload containing only secret answers that were omitted from Markdown.

## Verification

- Protocol or skill docs: `pnpm exec vitest run tests/skill.test.ts --coverage=false`.
- Schema or answer behavior: targeted tests under `tests/schema.test.ts`, `tests/submission.test.ts`, and `tests/answer-markdown.test.ts`.
- CLI or remote lifecycle: `tests/cli.test.ts`, `tests/remote.test.ts`, and `tests/local-server.test.ts`.
- Worker storage and API behavior: `tests/worker.test.ts`.
- UI behavior: `tests/app.test.tsx`; use browser screenshots for visual changes.

## Update When

- The question JSON schema, answer Markdown shape, secret handling, R2 object layout, CLI stdout contract, or fill URL protocol changes.
- The product stops using pasted Markdown as the required non-secret answer transport.
- The bundled skill gains or loses supported question types, flags, or workflow steps.
