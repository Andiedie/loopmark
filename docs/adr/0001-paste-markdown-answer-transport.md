# ADR 0001: Paste Markdown Answer Transport

## Status

Accepted

## Context

Loopmark originally used a cloud answer transport: the browser encrypted answers, posted them to the Worker, R2 stored the encrypted answer envelope, and the CLI later collected and decrypted the answer with a local receipt file.

The desired interaction is now simpler and more explicit: after the human answers in the browser, they copy a Markdown answer and paste it back to the agent. This removes the need for cloud answer storage and pending collection while preserving the browser-based editing experience.

The pasted Markdown is mandatory, not optional. It is the durable human-visible conversation record; a short "I filled it out" or retrieval token would make later context compression and human review much worse.

Secrets remain a hard boundary. Secret values must not appear in chat, stdout, logs, commits, issue comments, or copied Markdown plaintext. Notes on secret fields are not secrets; they remain visible in Markdown like other notes. At the same time, putting long ciphertext in Markdown wastes agent input tokens.

## Decision

Loopmark will use Markdown as the non-secret answer transport and R2 as the encrypted secret-bundle transport:

- The browser copies human-readable Markdown for non-secret answers.
- Secret fields are represented in visible Markdown only as omitted values.
- If secrets exist, the browser encrypts a secret bundle with the receipt public key, authorizes upload with a session-code-derived proof, and stores it at `sessions/{sessionId}/secrets.json`.
- The Markdown includes an O(1) command, `npx --yes @andie/loopmark secrets <session-id>`, for downloading the omitted secret bundle.
- The CLI downloads the encrypted secret bundle, decrypts it with the local receipt private key, and writes a local `0600` `.env` file.
- R2 stores encrypted session envelopes and encrypted secret bundles only. Non-secret answers are not stored in R2.

## Considered Alternatives

### Keep Cloud Answer Collection

This preserves the existing flow but keeps R2 answer objects, pending state, answer overwrite protection, and a second CLI command that depends on remote answer availability for all answers. It is more infrastructure than non-secret answers require.

### Put All Answers In Plain Markdown

This gives the simplest user experience but is unacceptable for secrets because users would paste secret plaintext into the agent conversation.

### Put Encrypted Secrets In Markdown

This avoids a secret download command but can produce very large pasted Markdown. The extra ciphertext consumes agent input tokens without improving human traceability, because humans cannot inspect it.

### Remove R2 Entirely

This would make Loopmark a static page and CLI-only protocol. It would also force sessions into URLs or require another local-to-browser transfer mechanism, making links longer and less reliable. Keeping R2 only for encrypted sessions is the smaller step.

## Consequences

- The non-secret answer lifecycle becomes human-visible: copy Markdown, paste Markdown, continue work.
- The Worker data model is still small: `sessions/{sessionId}/session.json` plus optional `sessions/{sessionId}/secrets.json`.
- The CLI remains necessary for receipt management and local secret decryption, but not for reading non-secret answers.
- End-to-end encryption still matters for session contents and for secret bundles.
- Any future protocol change must keep non-secret answers visible in Markdown and secret plaintext out of Markdown.

## Verification

- UI tests should assert that copying answers writes traceable Markdown, omits secret plaintext, keeps notes visible, and uploads encrypted secret bundles separately only when secret values are present.
- CLI tests should download secret bundles by session id and write `.env` files without printing secret values.
- Worker tests should assert that `/api/sessions/:id/secrets` requires a valid upload proof and stores only encrypted secret bundles.
- Shared protocol tests should round-trip secret bundle encryption and decryption with the local receipt key.
