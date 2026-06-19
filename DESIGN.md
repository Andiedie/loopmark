# Loopmark Design

## Purpose

Loopmark is a cloud human-input handoff for AI agents. The browser experience should feel like a refined paper trail: editorial, calm, precise, and trustworthy. It lets a human review questions, edit answers, copy Markdown, and keep secret values out of the conversation.

This file is the current UI design source of truth. It describes constraints and acceptance checks, not historical exploration.

## Read When

- Changing the fill page, answer controls, validation, copy flow, responsive layout, or design tokens.
- Adding a new field type, state, visual pattern, or icon.
- Updating tests or screenshots for the browser experience.

## Source Of Truth

- Product/domain invariants: `CONTEXT.md`.
- Tokens: `tailwind.config.ts`.
- Shared controls: `src/components/ui/`.
- Page composition: `src/ui/App.tsx`.
- Answer Markdown and secret behavior: `src/shared/answer-markdown.ts`, `src/shared/submission.ts`, and `src/shared/cloud-protocol.ts`.

## Product Stance

- Loopmark is not a dashboard, survey SaaS, form builder, or approval system.
- The primary surface is a readable question document.
- Human edits are first-class. Agent defaults are suggestions that can be changed or cleared.
- Simple ungrouped sessions and complex grouped sessions follow the same rules; grouped sessions add structure without becoming admin chrome.
- Output is for the agent, but the human must understand what will be pasted back.

## Visual Invariants

- Use a warm paper background, fine borders, and typographic hierarchy.
- Use deep green only for progress, selected states, primary action, and numbering accents.
- Avoid dashboard cards, KPI blocks, bento grids, heavy shadows, large rounded containers, glassmorphism, saturated gradients, and decorative illustrations.
- Product name and document headings use the serif token. Controls, progress, buttons, labels, and helper text use the sans token.
- Do not hardcode hex colors in React components.
- Letter spacing is normal except for small uppercase utility labels.
- No clipped labels, placeholder text, progress values, or horizontal overflow on mobile.

## Layout

- Desktop grouped sessions may show a light outline plus document workspace.
- Ungrouped sessions use a centered single-column document without outline or note rail.
- The top bar, document body, and copy action share the same page frame.
- The copy action belongs to the document flow; avoid a full-width dashboard footer.
- Question rows use a narrow number and a wide answer path on desktop, then collapse cleanly below desktop widths.
- Marginal notes are secondary and move below answers before content becomes cramped.
- Tablet and mobile hide the outline while keeping group headers and progress visible inside the document.

Responsive breakpoints:

```text
Desktop: >= 1024px
Tablet: 768px-1023px
Mobile: < 768px
```

## Detailed Layout Constraints

- Desktop grouped layout uses a light outline of about `260px` plus a flexible document workspace.
- Document readable width should stay around `960px` to `1040px` on wide screens.
- Question anatomy is number, question line, optional status icons, description, answer control, validation, and notes.
- Answer controls sit below the question line rather than in a cramped parallel column.
- Section gaps should stay near `40px` to `56px`; question vertical padding should stay near `20px` to `28px`.
- Modals and drawers are not part of v1. The flow completes inline in the document.
- Mobile top bar may stack product, session title, and progress, but the page must remain a readable document.

## Answer Controls

- Text answers use inputs or textareas. Long or free-form answers use multiline controls.
- Do not expose `Markdown`, `Code`, or `Text` type markers in the UI; free-form answers are simply text.
- Single and multiple choice fields always include a system `Other` option. Agents do not provide it.
- Selecting `Other` reveals a short answer input and submits the typed value as the selected answer label. Blank `Other` counts as no selected answer.
- Ranking fields do not include `Other`.
- Choice descriptions should be visible in the option row when present, not hidden only in tooltips.
- Choice fields include a compact note textarea so humans can explain selection, reordering, or skipped answers.
- Text fields do not need a separate note because the answer itself can carry explanation.

## Component Rules

- Use buttons only for explicit actions. Keep one primary button per action area.
- Icon-only buttons must have accessible labels.
- Disabled controls stay visible but quiet and must not create layout shift.
- Inputs are compact, about `36px` tall, and must not clip placeholder text.
- Textareas handle ordinary text answers, choice notes, secret notes, and multiline answers.
- Choice options use a readable ruled list. Avoid tiny chips, desktop-only grids, and selected-answer editors.
- Selected options use both accent color and a check icon; color alone is not enough.
- Reset controls restore the initial answer for a field and require confirmation because they discard human edits.
- Reserve header space for reset controls and default hints so appearing or disappearing icons do not shift content.
- Notes stay visually secondary and must not compete with the answer control.

## Ranking

- Ranking items must be sortable by drag, keyboard sorting through the drag handle, and up/down buttons.
- Ranking items can be removed directly. Reset restores the initial ranking.
- Rank numbers are typographic gutter numbers, not badges, pills, boxes, or inputs.
- The actively dragged row must sit above neighboring rows visually.
- Touch drag handles use `touch-action: none`; the rest of the row should still allow normal page scroll.
- Mobile ranking rows stay compact and must not become large stacked control blocks.

## Field Notes And Reset

- Default hints are icon-level while the current answer still matches the initial default.
- Secret fields use a lock icon. The explanation is that the secret value is omitted from Markdown and later written to a local file by the agent.
- Do not repeat long "Agent suggests..." or secret-handling copy beside every field.
- Changed fields show a reset icon. Reset requires confirmation and must not create layout shift when appearing.

## Validation And Copy

- The user reviews defaults inline, edits answers, then clicks one primary copy action.
- Validation marks every invalid field and scrolls to the first issue.
- If the first invalid field is inside a collapsed group, expand the group before scrolling.
- Do not add a separate first-issue navigation button.
- Errors appear directly under the relevant answer and use both text/icon and color.
- Success tells the user to paste the copied Markdown back to the agent.
- If clipboard access fails after answers are prepared, show the generated Markdown in a readonly textarea for manual copy.

## Secrets

- Secret values are encrypted before copy.
- Secret plaintext is never shown in answer Markdown.
- Notes on secret fields remain visible in Markdown like other notes.
- The copied Markdown includes the `loopmark secrets` command only when a secret value was entered.
- The UI should make omitted-from-Markdown behavior and local `.env` retrieval visible without exposing secret content.

## States

Required states:

- Loading: quiet centered state with a small spinner.
- Fatal load error: centered error message.
- Inline validation error.
- Partial progress.
- Disabled controls.
- Secret field.
- Copying.
- Copied.
- Manual copy fallback.

Not in v1:

- Offline state.
- Syncing or unsaved remote state.
- Permission-denied state beyond clipboard fallback.

If those become real product states, update this file before implementation.

## Accessibility And Motion

- Every input has a visible label or accessible name.
- Validation messages appear adjacent to the field and are communicated through text, not color alone.
- Focus-visible states must be clear on buttons, links, inputs, textareas, drag handles, and icon controls.
- Ranking always has non-drag alternatives.
- Respect `prefers-reduced-motion`.
- Motion is functional only: hover/focus transitions around `120ms` to `180ms`, no bounce, large decorative movement, or flashing effects.

## Content Style

- Tone is professional, direct, and sparse.
- Prefer short labels over explanatory paragraphs.
- Button copy uses clear verbs such as `Copy answers` and `Add`.
- Error copy explains what failed and how to recover.
- Do not add visible feature explanations that duplicate obvious controls.
- Output-facing wording should stay dense enough for an agent to understand without making the UI feel technical.

## Implementation Constraints

- Framework: React, Vite, and TypeScript.
- Styling: Tailwind with tokens in `tailwind.config.ts`.
- Shared primitives live under `src/components/ui/`.
- Page composition currently lives in `src/ui/App.tsx`; if it grows further, split by feature area instead of creating one-off style islands.
- Use lucide icons only for functional controls and states.
- Do not mix icon libraries or introduce decorative raster assets unless the product direction changes.
- Any major UI pattern change must update this file in the same change set.

## Acceptance Checklist

- The page reads as a document rather than a dashboard.
- Questions and answer controls are the clearest elements on the page.
- Simple ungrouped sessions avoid duplicate section chrome.
- Grouped sessions are navigable without feeling like an admin sidebar.
- Defaults are visibly marked and easy to change or clear.
- Secret fields are explained without revealing content.
- Validation expands collapsed groups and points to the first issue.
- Loading, error, success, disabled, validation, copied, and manual-copy states are covered.
- Desktop and mobile screenshots have no overlap or horizontal overflow.
- Colors, fonts, spacing, and borders use documented tokens.
- Accessibility and motion rules are still satisfied.
- Content remains sparse and action-oriented.

## Update When

- Layout, tokens, component behavior, state handling, copy flow, secret handling, or core interaction changes.
- A new visual direction replaces the current "Paper Trail" document model.
