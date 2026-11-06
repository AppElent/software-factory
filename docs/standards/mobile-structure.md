---
type: standard
kind: platform
description: Read when adding, moving, or naming files in a native mobile app.
version: 1.1.1
applies_to: [mobile]
---

# Mobile structure

Every file has one obvious home, named for its subject, task, and role.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- `app/` holds routes only: parameter validation, navigation, and presentation options. Screens and state live in features.
- `src/features/<feature>/<subject>/` owns a subject's screens, state, and supporting code. Components shared by several subjects of one feature go in `src/features/<feature>/components/`; cross-subject hooks at the feature root.
- `src/ui/` holds domain-independent controls and platform adapters. It never imports or re-exports feature code. Domain-aware UI stays in its feature and may wrap a `src/ui/` primitive.
- Domain calculations and catalogs shared with other targets live in a workspace package, not in the app. Reuse existing data services instead of duplicating their operations.
- Filenames are kebab-case `<subject>-<task>-<role>` (`food-editor-form.tsx`); shared subject parts omit the task (`food-header.tsx`). No vague names such as `helpers.ts` or `utils.ts`.
- Component exports match the filename in PascalCase; hooks use `use-` filenames and `use` exports. Tests and platform variants keep the full basename (`food-editor-form.ios.tsx`, `food-editor-form.test.tsx`).
- Colocate supporting components, hooks, and tests with their screen. Promote to `components/` when a second subject needs the same contract, not before.
- **Default:** keep a subject folder flat; add subfolders when size warrants them, not because tasks or presentations differ.
- **Default:** feature code uses theme typography tokens, never literal `fontSize`.

View, edit, page, and sheet composition: [editors](editors.md).

## Implementation

```text
app/(app)/food/[id].tsx            route: validates params, renders the screen
src/
  ui/segmented.tsx                 generic control
  features/nutrition/
    components/meal-picker.tsx     shared across nutrition subjects
    food/
      food-header.tsx
      food-view-screen.tsx
      food-editor-form.tsx
      food-editor-form.test.tsx
      food-editor-screen.tsx
      use-food-editor.ts
```

Copy [`check-mobile-structure.mjs`](mobile-structure/examples/check-mobile-structure.mjs) into `scripts/`, set its source root, and run it from the project's `check` script. It enforces feature filenames, the `src/ui/` import boundary, and literal font sizes. Across `src/` and `app/` it also reports UI text outside the message catalog: literal JSX text, readable props such as `accessibilityLabel` and `placeholder`, literal toast and alert messages, `locale === "…"` branches that pick text, and `*-copy.ts` modules. Set `messagesRoot` to the catalog folder, or `null` when the app has no catalog, and list words that read the same in every language in `UNTRANSLATED`. Ownership still needs review.

## Verify

- The structure check passes in CI.
- Review: no screen or state under `app/`, no feature import from `src/ui/`, no shared component living in one subject's folder.

## Migration

From 1.0: copy the new checker over the old one and keep your configured roots. It now reports literal UI text; move that text into the catalog, or add a word that every language shares to `UNTRANSLATED`.

New work follows this structure. Move a legacy screen when changing its behavior, not in a bulk rename. Record the adopted scope and any project owners (data layer, shared component folders) in the app's `CODING_STANDARDS.md`.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
