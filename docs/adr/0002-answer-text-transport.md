# ADR 0002: Answer Text Transport

Status: accepted.

Loopmark replaces pasted Markdown answers with pasted Answer Text. Answer Text is plain text: each field keeps the human-facing question label first, includes the answer next, and keeps the field id as secondary metadata. Choice descriptions remain visible as `Details`, secret values are represented as `[secret omitted]`, and the `loopmark secrets` command is a normal text line rather than a Markdown code fence.

This keeps the human-visible copy/paste transport from ADR 0001 while removing Markdown-specific syntax that made copied answers read like a protocol dump. The secret boundary is unchanged: non-secret answers and notes are pasted into the conversation, secret plaintext stays out of the copied text, and encrypted secret bundles are still downloaded with the local receipt.
