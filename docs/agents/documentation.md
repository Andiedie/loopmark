# Documentation Maintenance

## Purpose

Keep Loopmark documentation useful for future agents by giving each durable fact one home. Code, tests, config, and runtime behavior are the source of truth; old docs are evidence to verify, not text to preserve by default.

## Read When

- Adding, deleting, reorganizing, or reseeding repository documentation.
- Changing behavior that is described in README, DESIGN, ADRs, operations docs, or the bundled skill.
- Deciding whether a fact belongs in docs or should stay in code, tests, comments, issues, or final response notes.

## Source Of Truth

- Product overview and install path: `README.md`.
- Domain language and cross-module invariants: `CONTEXT.md`.
- UI design system and interaction constraints: `DESIGN.md`.
- Cloudflare deployment and self-hosting operations: `docs/operations/cloudflare.md`.
- Architecture decisions: `docs/adr/`.
- Agent skill protocol: `skills/loopmark/SKILL.md` and `skills/loopmark/references/protocol.md`.
- Brand asset provenance: `assets/brand/README.md`.

## Ownership Rules

- Keep `AGENTS.md` short. It routes agents to deeper docs and should not duplicate runbooks.
- Keep `README.md` public and user-facing. It should explain what Loopmark is, how to install the skill, the basic workflow, privacy guarantees, and where self-hosting docs live.
- Keep high-risk operational detail in `docs/operations/`, not repeated in README.
- Keep stable domain vocabulary in `CONTEXT.md`.
- Keep UI rules in `DESIGN.md`; update it in the same change as material UI behavior, layout, state, token, or component changes.
- Keep durable decisions in `docs/adr/`. Use ADRs only when alternatives and consequences matter later.
- Treat `skills/loopmark/**` as published product protocol and agent discovery surface. Do not move it during documentation reseeds.
- Treat examples, tests, workflow YAML, package metadata, and source comments as code-layer content, not ordinary documentation to archive.

## Write Rules

- Document context, constraints, risks, operations, invariants, and decisions that future agents cannot safely infer from one file.
- Do not document obvious file lists, function bodies, temporary plans, or prose that merely repeats tests.
- Prefer updating the nearest existing source over creating a duplicate.
- Delete or rewrite stale docs. Incorrect docs are worse than missing docs.
- Link to code or tests for current behavior instead of copying implementation detail.
- If a test intentionally guards a documentation promise, update the test with the doc change.

## Verification

- Search for references to renamed or deleted docs: `rg "old-doc-name|old-anchor"`.
- Check changed Markdown links manually when no markdown-link checker is configured.
- Run `git diff --check`.
- Run `pnpm exec vitest run tests/skill.test.ts --coverage=false` when README, DESIGN, `docs/operations/cloudflare.md`, or `skills/loopmark/**` changes.
- Run broader tests when docs describe behavior changed in code.

## Update When

- A new durable doc category appears.
- README, DESIGN, CONTEXT, operations docs, ADRs, or the bundled skill change responsibility.
- A future reseed moves ordinary docs to a new backup location.
