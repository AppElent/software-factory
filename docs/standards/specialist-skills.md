---
type: standard
kind: platform
description: Read when deciding whether to load an external specialist skill (Expo, Vercel React Native, better-*) for a task.
version: 2.0.1
applies_to: [all]
---

# Specialist skills

External skills add expertise for a task without overriding project standards or loading unrelated guides.

## Rules

- Read project standards first. Load a specialist skill only for the task at hand, and only the referenced rules it needs.
- Keep deliberate product choices and project-owned components. Still report evidence-backed accessibility, correctness, or data-loss problems when a project rule causes them, and propose the fix at that rule's owner.
- Check advice against the project's installed versions and real workload before applying it.
- Browser-specific advice (CSS, DOM, ARIA) is not a native recipe: apply the platform equivalent and verify on that platform.
- External skills stay with their own installer or plugin. Never copy them into developer-tools or silently install dependencies.
- Capture a useful general lesson as a developer-tools issue only when asked; never promote it to shared policy automatically.

## Implementation

| Skills | Use for |
| --- | --- |
| Expo | Expo APIs, Router, native UI, builds, upgrades, SDK-specific workflows |
| Vercel React Native | List performance, rendering, animation, native interaction |
| better-* | One focused skill per focused change. `better-interface` only for a requested broad interface review; it depends on six domain skills, so report missing ones instead of claiming full coverage |

## Verify

- The change cites the specialist rule it applied.
- Native changes from browser advice were verified on the native platform.
