---
type: standard
kind: platform
description: Read before reporting any change as complete or accepted.
version: 2.1.0
applies_to: [all]
---

# Verification

Completion claims rest on the target's checks and observed runtime evidence, with untested paths stated.

## Rules

- Run the affected target's configured checks. Start with the changed behavior and failure paths, then complete its required gates. Build shared workspace outputs before dependent checks. A root suite does not cover an excluded target. Preserve assertions and checks; report pre-existing failures with evidence.
- For runtime work, identify the revision, bundle, backend, and device/browser before writes. Use the host's shared preview/device tools when available. Exercise the changed journey, recovery, and refresh/reopen; identify inaccessible paths.
- For mobile runtime work driven by an automation tool such as `agent-device`, run the loop: open the app, act, read the UI diff each action returns, then assert the end state (for example `wait text "…"`). A screenshot alone is not verification. Prefer id selectors (`testID` maps to Android's `resource-id`) over text selectors, since visible text changes with locale.
- For a supplied design, list its applicable states before implementation, including menus, keyboard, and clean/dirty/invalid forms. Resolve material deviations with the user. Compare each state against the running implementation and record pass, agreed deviation, or unresolved, with current screenshots/recordings. Recheck states affected by later changes.
- For native sheets, keyboard accessories, overlays, or platform hosts, exercise a small complete flow before polishing: open, focus, switch inputs/presentations, dismiss, reopen. Check that the parent remains tappable, the draft survives the intended transitions, and one owner coordinates keyboard/scroll/insets. Repeat affected transitions after geometry or adapter changes.
- Verify supported themes/locales, larger text, accessibility, Back/dismissal, relevant gestures, and offline/error states. Capture motion as a recording; a still image cannot verify it. Physical hardware is needed for tactile haptics.
- Automated tests, bundle exports, device behavior, and provider delivery are separate evidence. Record untested paths explicitly.

## Implementation

1. Report results in the PR. Write a verification record (`docs/records/.template.md`) only when a contract or decision cites the evidence; pending acceptance goes to a GitHub issue.
2. Save noisy diagnostic output locally and inspect the failure excerpt with its exit status.

## Verify

- Documentation-only changes need link, ownership, and routing checks.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
