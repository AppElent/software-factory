---
type: standard
kind: platform
description: Read before designing or changing browser UI.
version: 1.2.0
applies_to: [web]
---

# Web design

Browser UI is semantic, keyboard-accessible, responsive, and recoverable. Builds on [general design](general-design.md).

## Rules

- Use links for navigation and buttons for actions. Provide accessible names, keyboard access, visible focus, and sensible focus restoration after dialogs.
- Associate labels and errors with fields. Make feedback discoverable without relying only on color.
- Preserve normal browser scrolling and zoom.
- Preserve useful content during navigation/refresh and entered values on recoverable failures.
- Give each page a meaningful document title. Route failures show the shared error fallback with recovery; dialogs/popovers use the selected accessible primitives rather than browser confirmation dialogs.

### Responsive action controls

- Compact add, edit, delete, and refresh controls show only their icon below the desktop breakpoint (tablets included) and the icon with its visible label at and above it.
- Every icon-only control keeps a translated accessible name.
- Keep a visible label where it carries essential state or workflow context, such as a form submission or confirmation.

### Nested pages carry their own trail

A page below a collection index renders breadcrumbs from that index down to itself. The shell keeps global navigation; only the page knows which record it shows, so it owns the local hierarchy.

- **Required:** back points at the parent's address, built with the app's route helpers so context such as the active group travels with it. It never calls `history.back()`: where someone came from is not the collection the page belongs to.
- **Required:** the current page is the one step without a link, rendered `aria-current="page"`.
- **Required:** crumb labels arrive already localized. Content labels, such as a record's name, are not translated, so the page resolves them and the breadcrumb component reads no message catalog.
- Collection indexes and flat shell pages get no trail: a one-step trail repeats what the shell already says.
- Add the trail in the same change as the nested route. A page without one renders fine, so nothing else catches the omission.

## Verify

- Narrow layouts, zoom, long translations, and supported themes.
- Action controls at both sides of the desktop breakpoint; nested pages reach their parent through the trail.

## Exceptions

Record in `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
