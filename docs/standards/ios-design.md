---
type: standard
kind: platform
description: Read before designing or changing iOS UI.
version: 1.2.1
applies_to: [ios]
---

# iOS design

iOS screens use native controls, top-right screen actions, and working gestures. Builds on [mobile design](mobile-design.md).

## Rules

- Prefer native navigation, controls, sheets, menus, and their built-in behavior. Keep screen-level actions top-right: one or two toolbar items or a menu; do not replace them by default with large content buttons.
- Implement expected swipe actions, swipe-back, and long-press context menus where appropriate to the iOS pattern.
- For input presentation, follow the [editors pattern](editors.md); use native toolbar actions for screen-level work and adjacent submit actions for composers.

## Verify

- Swipe actions, swipe-back, and context menus work on device.

## Exceptions

Record in `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
