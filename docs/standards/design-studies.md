---
type: standard
kind: pattern
description: Read when creating, reviewing, or implementing from a design study.
version: 3.0.0
applies_to: [web, mobile]
---

# Design studies

A study records design intent in rounds, covers every state before approval, and gives implementers a companion they can build from without the study.

## Rules

- A study starts from the design system, tokens, component APIs, and existing studies. A redesign keeps the current screen's actions, menus, gestures, and states unless their removal is agreed. Data is realistic and copy uses the product's chosen language.
- Reference screens resolve concrete design questions. The study names each source beside the design and what it contributed, extracting hierarchy and control patterns rather than another product's pixels or proprietary assets.
- Before approval, the study shows the states that [general design](general-design.md) and the target platform standard require, plus offline and draft states where they apply, the complete action inventory with visible alternatives to gestures, bulk actions, follow-up forms, long and larger text, and every supported theme. Summaries route to their detail and the data that explains them.
- The approved study shows the selected states and links the deciding rounds. Beside it, a Markdown companion holds the implementation notes, every state, the exact copy, component and API bindings, installed-version constraints, and open runtime questions. Implementers build from the companion and use the study as the visual reference.
- **Default:** rounds and the final live in `designs/<area>/` as `<screen>_round<n>.html` and `<screen>_final.html` with its companion `<screen>_final.md`, listed in the project's design inventory. A study kept on a hosted canvas instead records the canvas link in its companion and copies the final artboards' source to `designs/<area>/<screen>_final/`; its rounds stay on the canvas.

## Implementation

1. Classify each accepted decision by owner with the [documentation standard](documentation.md#owners).
2. Apply an approved design system proposal to the design system's source and its code tokens in the change that adopts it.

## Verify

A study establishes design intent, not acceptance. For a study or other supplied design:

- Before implementation, list its applicable states, including menus, keyboard, and clean/dirty/invalid forms. Resolve material deviations with the user.
- Compare each state against the running implementation and record pass, agreed deviation, or unresolved, with current screenshots/recordings. Recheck states affected by later changes.
