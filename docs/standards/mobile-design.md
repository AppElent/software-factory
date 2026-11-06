---
type: standard
kind: platform
description: Read before designing or changing native mobile UI.
version: 1.1.1
applies_to: [mobile]
---

# Mobile design

Native UI uses platform navigation, respects safe areas and the keyboard, and is verified on device. Builds on [general design](general-design.md); add [iOS](ios-design.md) or [Android](android-design.md).

## Rules

- Decide presentation and Back/Cancel behavior before building a screen. Use platform controls and navigation where they fit the task.
- Keep text and controls inside safe areas. Keep the focused input and required actions visible with the keyboard open; avoid applying keyboard/safe-area insets twice.
- Preserve expected native gestures. Provide discoverable alternatives for actions otherwise accessible only by gesture.
- Support larger system text, accessible labels, reduced motion, and supported themes. Preserve list position and input across recoverable failures.

## Verify

- Affected flows on their intended platforms, including keyboard opening/dismissal and gesture behavior. State any untested platform; web preview/typechecking alone is not device evidence.

## Exceptions

Record in `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
