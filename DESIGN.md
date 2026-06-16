# InterroGate Design

InterroGate is a local human-input gate for AI Agents. It reads a compact JSON question session, opens a temporary local page, and returns dense human feedback to the calling agent. The interface is not a form builder, dashboard, survey SaaS, or approval system. It is a quiet, well-set document where a human can review, edit, rank, and submit answers with confidence.

## 1. Design Goal

The product should feel like a refined paper trail: editorial, calm, precise, and trustworthy. It must support a three-question ungrouped session as naturally as a longer grouped questionnaire.

Design priorities:

- Make the question document immediately understandable.
- Keep answer editing fast and direct.
- Preserve enough context that the user knows what the agent is asking and why.
- Avoid dashboard aesthetics, KPI blocks, heavy cards, bright gradients, and decorative UI.
- Treat defaults as agent suggestions that the user can edit, not as final truth.
- Protect sensitive answers by making local secret-file behavior visible without exposing secret content.

## 2. Principles

### 2.1 Document First

The primary surface is a document with a title, context, chapters, numbered questions, editable answers, marginal notes, and a final submit action. Use typography, spacing, and fine rules before panels or cards.

### 2.2 Content Before Chrome

Questions and answers get the widest and clearest reading path. Controls should support the document, not compete with it. Avoid side panels or multi-column layouts that make labels or answer controls feel cramped.

### 2.3 Human Edits Are First-Class

Agent-provided defaults are editable drafts. Choice answers, ranking items, custom options, labels, and descriptions must be directly editable when the schema allows it.

### 2.4 State Must Be Explicit

Required progress, selected choices, validation errors, collapsed groups, secret handling, loading, and submitted states must be visible without making the page feel noisy.

### 2.5 Compact Output, Rich Context

The UI can show guidance and context, but final output is for an agent. The page should help the human produce answers that are concise, readable, and self-explanatory.

### 2.6 Same Rules For Simple And Complex Sessions

Ungrouped sessions should become an elegant single-column document. Grouped sessions add a light outline and chapter structure. They should not become an admin dashboard.

## 3. Information Architecture

```text
App Shell
├── Top Bar: product name, session title, required progress
├── Outline: grouped-session table of contents only
├── Document Workspace: title, description, groups, questions, answer controls
└── Action Bar: submit action and validation copy
```

Rules:

- The top bar is global context. Keep it short and stable.
- The outline appears only for grouped sessions. It is a table of contents, not navigation chrome.
- The document workspace owns all question and answer content.
- Marginal notes are secondary and reserved for information that changes the user's decision. Agent default hints should be icon-level by default, not repeated paragraphs.
- Modals are not used in v1. The flow should complete inline.
- Drawers are not used in v1. Mobile should remain a readable document, not a hidden-panel workflow.

Core path:

```text
Agent asks -> human reviews defaults -> human edits answers -> validation points to first issue -> submit -> agent receives JSON
```

## 4. Layout

### Desktop

- Minimum comfortable width: 1024px.
- Grouped layout: `260px` outline plus flexible document workspace.
- Ungrouped layout: centered document, no outline.
- Document max readable width: about `960px` to `1040px`.
- Question row: narrow number column, wide answer column, optional marginal note column only for grouped sessions where the note is genuinely useful.
- Question anatomy: number -> question line -> optional status icons -> description -> answer control -> validation/notes.
- The answer control appears below the question line, not in a cramped parallel column.
- Ungrouped sessions use a broad single-column document. They must not inherit the grouped outline, right note rail, or complex side-by-side chrome.
- The top bar, document body, and submit action use the same page frame. Avoid full-width header/footer interiors when the document itself is narrower.
- The final action area belongs to the document flow and aligns to the document width. It is not a full-width dashboard footer.
- Section gap: 40px to 56px.
- Question vertical padding: 20px to 28px.

### Tablet

- Hide the outline.
- Keep group headers and progress visible inside the document.
- Marginal notes move below answer controls and should disappear entirely when they are not needed.
- Preserve the question number, but do not let it force narrow content.

### Mobile

- Single-column document.
- Top bar stacks product, session title, and progress.
- Choice options wrap naturally.
- Ranking items stay compact on mobile: drag handle, rank number, item text, and up/down actions share one ruled row.
- Ranking rank numbers must never stretch to full row width on mobile.
- Ranking drag handles are real touch targets. Gestures that start on the handle must reorder the list, not scroll the page.
- Description editors must show at least two lines when content may be long.
- No horizontal scrolling, clipped labels, or truncated placeholders.

## 5. Visual Style

Keywords: paper, editorial, calm, precise, restrained, local, trustworthy.

Rules:

- Background is warm paper white, not dashboard gray.
- Use fine borders and typographic hierarchy instead of cards and shadows.
- Use deep green only for progress, selected states, primary action, and numbering accents.
- Avoid large rounded cards, nested cards, glassmorphism, colored metric blocks, saturated gradients, and decorative illustrations.
- Icons are small functional marks only: add, remove, reorder, lock, collapse, error, loading.
- Shadows are avoided in the main document. If needed for overlays later, use only subtle elevation.

## 6. Design Tokens

Tokens live in `tailwind.config.ts`. Components and pages should use token names instead of ad-hoc hex values.

### Color

```text
paper.50      #fbfaf7  page background
paper.100     #f4f1eb  subtle marker background
paper.200     #e7e0d3  progress track / muted fill
paper.line    #d9d2c6  rules and control borders
paper.ink     #1f1d1a  primary text
paper.muted   #706a60  secondary text
paper.accent  #2e6048  selected state / progress / primary action
paper.accentDark #214633 hover primary action
paper.danger  #b43b3b  validation error
```

### Typography

```text
Document serif:
  Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif

UI sans:
  Avenir Next, Avenir, ui-sans-serif, system-ui, sans-serif

Mono:
  SFMono-Regular, Menlo, Consolas, monospace
```

Type rules:

- Product name and document headings use serif.
- Question labels use serif to preserve the editorial rhythm.
- Controls, progress, buttons, labels, and helper text use sans.
- Do not scale font size with viewport width.
- Letter spacing should be normal except for small uppercase utility labels.
- Long user-editable descriptions should use multiline controls.

### Spacing

Use the Tailwind spacing scale and prefer:

```text
4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80
```

Avoid one-off spacing values unless a layout primitive requires an exact track width.

### Radius

The Paper Trail direction is mostly square and finely ruled.

```text
Controls: 0px to 2px
Markers: 2px
Cards: avoid in primary document
```

### Shadow

Primary document UI should not use visible shadows. Borders and spacing are the default separators.

## 7. Components

### Button

- Use for explicit actions.
- One primary button per action area.
- Primary button is deep green.
- Secondary buttons are white with a fine border.
- Icon-only buttons must have accessible labels.
- Disabled buttons remain visible but quiet.
- Do not use buttons as badges or status labels.

### Input

- Use for short answer labels or short plain text.
- Height: compact, about 36px.
- Must never clip placeholder text in ordinary desktop widths.
- Must show focus-visible state with accent border/ring.

### Textarea

- Use for ordinary text answers, long descriptions, custom option descriptions, ranking descriptions, and multi-line answers.
- Description editors should show at least two lines.
- Do not expose `Markdown`, `Code`, or `Text` type markers in the UI. All free-form answers are simply text.

### Choice Options

- Selected options use accent fill and a check icon.
- Unselected options are white with a fine border.
- Options show label and description before selection when description exists.
- Options use a readable ruled list, not tiny chips or desktop two-column grids. One option occupies one row so label and description have a stable reading path.
- `single`, `multiple`, and `ranking` use the same label/description answer item shape.
- `single` and `multiple` default to direct selection only. Do not show selected-answer editors by default.
- Custom answers are progressive: show a lightweight custom/add button first; reveal label and optional description inputs only after the user asks to customize.
- A newly added custom answer immediately becomes selected and remains in the option area even if the user later selects another answer.
- Edited option labels/descriptions persist in the field draft state when the user switches away and back.
- Add-custom and edit-details are mutually exclusive inline panels.
- Opening add-custom hides edit-details until the add panel is cancelled or completed. Opening edit-details hides add-custom until editing is done.
- Tooltips are secondary help, not the only place where option descriptions live.

### Editable Answer Items

- Label and description are editable separately only after the user opens details.
- Description editors should be multiline to avoid hidden feedback.
- Remove action is an icon button inside the item it affects, and it appears only when removal is allowed. Do not show disabled remove icons that look clickable but cannot act.
- Do not show large selected-answer editors on initial render for `single` or `multiple`.
- For `ranking`, sorting is part of answering and is available without entering edit mode. Edit mode means editing item labels/descriptions and removing items.

### Reset

- A changed field shows a small reset icon.
- Reset requires confirmation because it can discard human edits, custom options, and edited descriptions.
- Reset restores both the answer and the field's local option draft state.
- Reserve header space for reset even when the icon is hidden. Reset appearing must not change the title row height or push field content.

### Ranking

- Ranking items are always sortable through drag, keyboard sorting through the drag handle, and up/down buttons.
- Edit-details mode exposes label and description inputs plus allowed remove actions. It does not own sorting.
- Add-ranked-item uses the same progressive custom panel pattern as other choice fields and is mutually exclusive with edit-details.
- Rank number remains visible as a typographic gutter number. Do not render ranking numbers as bordered boxes, badges, pills, or input-like controls.
- The actively dragged row must sit above neighboring rows visually.
- On mobile, reorder actions remain aligned with the row header. Description text may wrap, but controls must not become large stacked blocks.
- On touch devices, the drag handle must opt out of browser panning with `touch-action: none`; the surrounding row should still scroll normally when the user swipes outside the handle.

### Field Notes

- Agent-provided defaults are shown as a small hint icon while the current answer still matches the default.
- The hint explains itself on hover/focus and disappears once the user edits the answer away from the default.
- Reserve header space for default hints when a field has an initial default. The icon disappearing must not create layout shift.
- Do not repeat full "Agent suggests..." copy on every field.
- Secret handling is indicated with a lock icon and hover/focus explanation.
- Do not repeat full secret-handling copy beside every secret field.
- Notes must never compete visually with the answer control.

### Validation Error

- Errors appear directly under the relevant answer.
- Error copy must explain what is wrong and what to do next.
- Error state must use both color and text/icon, not color alone.

## 8. Interaction Patterns

### Review And Submit

The user reviews defaults inline, edits as needed, then submits once. Avoid extra confirmation unless the action becomes destructive or external.

The submit action is part of the document, aligned to the same page frame as the questions. Do not use a full-width footer with large empty space around a small set of controls.

### Validation Recovery

When validation fails:

- Mark every invalid field.
- Scroll to the first invalid field.
- If the field is inside a collapsed group, expand that group first.
- Do not show a separate first-issue navigation button. The submit attempt itself performs recovery.
- Keep the action area visually calm: one primary submit action plus concise validation copy.

### Group Collapse

Groups can collapse to reduce complexity. Collapsed headers still show required progress. Collapsing must not hide validation recovery.

### Secret Fields

Secret fields render as password/text areas as appropriate. A lock icon explains that secret content is saved to a local temporary file and omitted from stdout. The final JSON references only `secretFile` and `description`.

## 9. State Design

Required states:

- Loading: centered, quiet, with a small spinner and short text.
- Error: centered for load/fatal errors; inline for validation errors.
- Success: tells the user to return to the agent and does not show answer JSON.
- Disabled: reduced opacity, cursor disabled, no hidden layout shift.
- Validation failed: inline field errors plus automatic first-error reveal.
- Partial: progress shows required answered count.
- Secret: lock icon plus local-file copy.
- Submitted: no more editing in the page.

Not in v1:

- Offline state.
- Permission denied state.
- Syncing/unsaved remote state.

If those become real product states later, this document must be updated before implementation.

## 10. Content Style

Tone: professional, direct, sparse.

Rules:

- Prefer short labels over explanatory paragraphs.
- Button copy uses clear verbs: `Submit inputs`, `Add`.
- Error copy should say what failed and how to recover.
- Avoid playful or apologetic copy.
- Do not add visible feature explanations that duplicate obvious controls.
- Output-facing concepts should keep wording dense enough for an agent to understand without the UI.

## 11. Accessibility

- Every input must have a label or accessible name.
- Icon-only controls must have `aria-label`.
- Validation messages must be adjacent to the field and announced through text.
- Focus-visible must be clear on buttons, links, inputs, and textareas.
- Selection cannot rely on color alone; selected choices include a check icon.
- Ranking must have non-drag alternatives.
- Respect `prefers-reduced-motion`.
- No text overlap, clipped control labels, or horizontal page overflow at mobile width.

## 12. Responsive Rules

```text
Desktop: >= 1024px
Tablet: 768px-1023px
Mobile: < 768px
```

- Desktop grouped sessions show outline.
- Tablet and mobile hide outline.
- Question rows collapse to one column below desktop widths.
- Marginal notes move below answers before content becomes cramped.
- Action area becomes document-flow on small screens if sticky behavior would obscure content.

## 13. Motion

Motion is functional only.

- Hover/focus transitions: 120-180ms.
- Collapse/expand may animate later, but must not shift focus unexpectedly.
- Loading spinner is acceptable.
- Avoid bounce, large movement, decorative animation, or flashing effects.

## 14. Assets And Icons

- No raster assets are required for v1.
- Use lucide icons only for functional controls and states.
- Icon stroke, size, and color must stay restrained.
- Do not mix icon libraries.
- Do not introduce decorative images unless the product direction changes.

## 15. Implementation Constraints

- Framework: React + Vite + TypeScript.
- Styling: Tailwind with tokens in `tailwind.config.ts`.
- Shared controls live under `src/components/ui`.
- Page composition currently lives in `src/ui/App.tsx`; if it grows further, split by feature area rather than creating one-off style islands.
- Do not hardcode hex colors in React components.
- Do not introduce dashboard cards, bento grids, gradient backgrounds, or marketing hero sections.
- Prefer shared primitives for buttons, inputs, and textareas.
- Any major UI pattern change must update this file in the same change set.

## 16. Design Acceptance Checklist

Before shipping a UI change:

- Does the page still read as a document rather than a dashboard?
- Are questions and answer controls the clearest elements on the page?
- Are simple ungrouped sessions clean without duplicate section chrome?
- Are complex grouped sessions navigable without feeling like an admin sidebar?
- Are field labels, placeholders, progress values, and buttons free from clipping?
- Are defaults visibly editable?
- Are secret fields explained without revealing content?
- Does validation expand collapsed groups and point to the first issue?
- Are loading, error, success, disabled, and validation states covered?
- Are desktop and mobile screenshots free of overlap and horizontal overflow?
- Are colors, fonts, spacing, and borders using the documented tokens?

## 17. Reference Direction

The accepted visual direction is "Paper Trail": a publication-like local questionnaire with a thin top bar, a light outline, chapter headings, numbered questions, broad answer controls, restrained green selection states, and marginal agent notes.

Do not commit local absolute paths to generated concept images. The repository source of truth is this document plus checked-in examples and tests. Temporary screenshots used during review should stay outside the repo.

Avoid:

- Generic dashboard templates.
- Large metric cards.
- Heavy rounded containers.
- Purple/blue SaaS gradients.
- Dense multi-column forms that make answers cramped.
- Hiding long answer descriptions inside single-line controls.

## 18. Maintenance

Keep this file current. When layout, tokens, component behavior, state handling, or core interaction changes, update `DESIGN.md` in the same pull request. Remove obsolete rules instead of leaving them as historical notes. This document describes the product as it should currently be built, not a wishlist for another product.
