---
type: standard
kind: pattern
description: Read when creating, reviewing, or implementing from a design study.
version: 2.0.0
applies_to: [web, mobile]
---

# Design studies

A study records design intent in rounds, covers every state before approval, and gives implementers a companion they can build from without the study.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- A study starts from the design system, tokens, component APIs, and existing studies. A redesign keeps the current screen's actions, menus, gestures, and states unless their removal is agreed. Data is realistic and copy uses the product's chosen language.
- Open choices appear as 1–5 labeled alternatives with a recommendation and its reason. With a design system in place, alternatives vary layout, navigation, information order, or interaction; a token or component change is labeled a design system proposal and shown on the screens it affects.
- Reference screens resolve concrete design questions. The study names each source beside the design and what it contributed, extracting hierarchy and control patterns rather than another product's pixels or proprietary assets.
- Each round opens with a numbered critique ranked by impact and links the round before it. Important interactions are operable: navigation, menus, scrolling, selection, theme, and keyboard-related compositions where feasible.
- Before approval, the study shows the states that [general design](general-design.md) and the target platform standard require, plus offline and draft states where they apply, the complete action inventory with visible alternatives to gestures, bulk actions, follow-up forms, long and larger text, and every supported theme. Summaries route to their detail and the data that explains them.
- The approved study shows the selected states and links the deciding rounds. Beside it, a Markdown companion holds the implementation notes, every state, the exact copy, component and API bindings, installed-version constraints, and open runtime questions. Implementers build from the companion and use the study as the visual reference.
- **Default:** rounds and the final live in `designs/<area>/` as `<screen>_round<n>.html` and `<screen>_final.html` with its companion `<screen>_final.md`, listed in the project's design inventory. A study kept on a hosted canvas instead records the canvas link in its companion and copies the final artboards' source to `designs/<area>/<screen>_final/`; its rounds stay on the canvas.
- A study establishes design intent, not native acceptance.

## Implementation

1. Classify each accepted decision with the [documentation standard](documentation.md). Extract reusable patterns into a developer-tools standard; product contracts retain identity, bindings, domain behavior, and explicit exceptions. Label unresolved shared adoption as proposed, with applicability and evidence.
2. Apply an approved design system proposal to the design system's source and its code tokens in the change that adopts it.

## Verify

- Compare the implementation per state with the companion, following the [verification standard](verification.md).

## Migration

Version 2 states rules only; how a session presents rounds now lives with the design workflow that runs it. Existing studies stay valid. Studies kept on a hosted canvas add the canvas link to their companion and a copy of the final artboards' source.

## Exceptions

Record in `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
