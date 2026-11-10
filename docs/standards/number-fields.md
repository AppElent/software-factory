---
type: standard
kind: pattern
description: Read when entering or adjusting a numeric value.
version: 1.0.3
applies_to: [web, mobile]
---

# Number fields

Numbers are edited inline, parsed separately from their text, and validated at an explicit commit boundary.

## Rules

- Use an inline labelled field when a number can be edited in its surrounding row. Keep the unit visible and separately accessible. Use a stepper for frequent bounded adjustments; direct entry remains available when stepping across the range is slow. Product rules own units, bounds, precision, increments, and conversion semantics.
- Keep editable text separate from the parsed domain value. Support the app's decimal locales and intermediate input while typing. Validate on the declared commit boundary; avoid cursor jumps from formatting on each keystroke. Distinguish empty, zero, invalid, and unavailable values. A numeric keyboard is a convenience, not a validator; pasted and hardware-keyboard input needs the same validation.
- Keep the focused value and commit action above the keyboard. Offer previous/next and Done for repeated fields when the platform keyboard lacks navigation. Use native text editing so selection, caret, paste, and accessibility remain available.
- Choose one variant explicitly:
  - **Ordinary entry:** focus preserves the editable value. Clear follows the domain's explicit optional/required policy.
  - **Replace on focus:** for rapidly replacing an existing value, show the previous value as a placeholder; the first input replaces it. Leaving untouched or cleared restores the previous value. Removal is a separate action. Unsuitable when empty itself must be saved.
  - **Quantity adjustment:** combine direct entry with useful increments and optional unit/serving selection. Keep conversion and remembered amounts domain-owned.

## Verify

- Decimal separators, paste, zero/empty/invalid values, bounds, precision, focus/blur without typing, clear, keyboard dismissal, larger text, and screen-reader label/value/unit.
- A failed save preserves input.
