---
type: standard
kind: platform
description: Read before reporting any change as complete or accepted.
version: 2.2.0
applies_to: [all]
---

# Verification

Completion claims rest on the target's checks and observed runtime evidence, with untested paths stated.

## Rules

- Run the affected target's configured checks. Start with the changed behavior and failure paths, then complete its required gates. Build shared workspace outputs before dependent checks. A root suite does not cover an excluded target. Preserve assertions and checks; report pre-existing failures with evidence.
- For runtime work, identify the revision, bundle, backend, and device/browser before writes. Use the host's shared preview/device tools when available. Exercise the changed journey, recovery, and refresh/reopen; identify inaccessible paths.
- For mobile runtime work driven by an automation tool such as `agent-device`, run the loop: open the app, act, read the UI diff each action returns, then assert the end state (for example `wait text "…"`). A screenshot alone is not verification. Prefer id selectors (`testID` maps to Android's `resource-id`) over text selectors, since visible text changes with locale.
- For a supplied design, verify each state as [design studies](design-studies.md#verify) describes.
- For native sheets, keyboard accessories, overlays, or platform hosts, run the [editors](editors.md#verify) flow before polishing.
- Verify supported themes/locales, larger text, accessibility, Back/dismissal, relevant gestures, and offline/error states. Capture motion as a recording; a still image cannot verify it. Physical hardware is needed for tactile haptics.
- Automated tests, bundle exports, device behavior, and provider delivery are separate evidence. Record untested paths explicitly.

## Implementation

1. Report results in the PR. Write a verification [record](documentation.md#records) only when a contract or decision cites the evidence.
2. Save noisy diagnostic output locally and inspect the failure excerpt with its exit status.

## Verify

- Documentation-only changes need the [documentation](documentation.md#verify) checks.
