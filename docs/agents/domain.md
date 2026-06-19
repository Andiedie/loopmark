# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

Single-context repo.

Read:

- `CONTEXT.md` at the repo root.
- Relevant ADRs under `docs/adr/`.

No `CONTEXT-MAP.md` is used.

## Use The Glossary's Vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`.

If the concept is missing, either reconsider the wording or note the gap for `/domain-modeling`.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly instead of silently overriding it.

## Update When

- The repo becomes multi-context and gains `CONTEXT-MAP.md`.
- Domain docs move away from root `CONTEXT.md` or `docs/adr/`.
