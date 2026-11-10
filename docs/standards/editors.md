---
type: standard
kind: pattern
description: Read when choosing fullscreen, sheet, or keyboard-anchored editing, or handling drafts.
version: 1.2.0
applies_to: [web, mobile]
---

# Editors

Choose the editing presentation by attention, space, and navigation needs, and never lose a draft silently.

## Rules

| Task | Presentation |
| --- | --- |
| Sustained, multi-section work or navigation among related details | Pushed/fullscreen editor |
| Focused self-contained edit with useful underlying context | Native bottom/form sheet |
| Small contextual capture or adjustment | Keyboard-anchored popup/composer |

- A popup augments the current task; expanding it to a fuller editor preserves the same draft. A small field count alone does not justify an overlay when validation or nested navigation needs more space. Web uses its corresponding accessible page/dialog/popover controls; platform styling is not part of the contract.
- Saved data changes only on commit. Scope a draft to its account and item/context. A clean editor dismisses immediately; a dirty editor preserves its draft or asks before losing meaningful changes. Explicit Discard abandons it. Apply the same policy to close, Back, swipe dismissal, and presentation changes.
- Save reflects clean, changed, invalid/conflicting, pending, and failed states. Block duplicate commits; failure preserves the draft and offers recovery. Choose screen-level native toolbar actions for full editors and sheets; keep a composer's submit action beside its input. Give icon actions accessible names.
- View and edit are separate tasks: viewing reads saved data; editing owns a draft, validation, and save. Create the draft once per editing session and keep it when switching presentation; calling the same hook twice does not share state.
- Page and sheet are presentations, not separate screens. When content and behavior match, reuse one screen and set the presentation in the navigator. Add page/sheet wrappers only when composition differs; they share content or form components and own navigation and dismissal.
- Use routed sheets for navigable tasks and local sheets for auxiliary controls.
- One owner coordinates scroll, keyboard, safe-area insets, and dismissal. The focused input and required actions stay visible. Avoid layering platform hosts inside keyboard windows unless the installed runtime supports that composition. Runtime-specific workarounds live beside the affected adapter.

## Verify

- Before polishing, run a small complete flow: open/focus, next field, nested popup, switching inputs and presentations, expansion, dismissal by each route, reopen, invalid input, failed commit, large text, and keyboard motion. Repeat affected transitions after geometry or adapter changes.
- The draft survives the intended transitions, and closed auxiliary controls leave the parent tappable.
