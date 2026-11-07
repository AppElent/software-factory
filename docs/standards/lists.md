---
type: standard
kind: pattern
description: Read when adding row actions, selection, or section menus to a list.
version: 1.0.2
applies_to: [web, mobile]
---

# Actionable lists

Every row action is discoverable without gestures, and bulk work uses an explicit selection mode.

## Rules

- A row has one primary tap action. Reveal at most two frequent secondary actions by swipe where the platform supports it; full swipe reveals rather than commits a destructive action. Long press can expose the full contextual action set. Every gesture-only action also needs a discoverable visible route.
- Use selection for bulk operations. Show the selected count, scope select-all to an explicit group, keep bulk actions together, and provide a clear exit. A list without useful bulk actions does not need selection mode.
- When a section owns actions, its labelled heading can open the menu. Preserve a clear disclosure affordance and accessible name. Empty sections only expose applicable actions. Screens with editable text rows need a gesture implementation that preserves caret, selection, focus, and keyboard behavior.
- Match the primary action to the task: a review row may open details, while a logging row opens an editor. Product behavior owns that choice, action inventory, and consequences. A redesign retains existing actions unless their removal is explicitly agreed.

## Implementation

A nutrition diary was the originating example; its domain actions and platform adapters remain app-owned.

## Verify

- Tap, swipe, context menu, selection, keyboard/screen-reader access, large text, empty groups, and action failures.

## Exceptions

Record in `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
