# Design system

Software Factory's design system: https://claude.ai/artifact/Q7SJkZoNSh1Si9dNUHt4Ae

Design canvas: https://claude.ai/artifact/KPeYSx9hRhAgk9oeAVDc5F

Both links are private. The approved design and tokens are copied here so anyone building from a public checkout has them.

## Inventory

| Study | Status | Files |
| --- | --- | --- |
| Control room | Approved 2026-11-06 | [Companion](designs/control-room/control-room_final.md), [boards](designs/control-room/control-room_final/), [copy](designs/control-room/control-room_copy.md) |

## Tokens in code

[`tokens.json`](designs/control-room/tokens.json) is the source. [`tokens.css`](designs/control-room/tokens.css) is the Tailwind v4 `@theme` block generated from it. Components use semantic tokens only, and a role with no token gets a new token. The companion lists the utility names.

`scrim` and `shadow-dialog` were added at hand-off because the dialogs already used those values. The hosted design system doesn't have them yet.

## Exceptions

| Rule | Scope | Replacement | Reason |
| --- | --- | --- | --- |
| Inputs are 16px on mobile (typography) | Every input below 760px | Inputs stay 13px | Desktop tool on this Mac. Phone width is usable, not a target |
| Support each theme a user expects | Whole app | Dark only | One user, one direction, chosen in the study |

The boards load IBM Plex from Google Fonts. The app self-hosts it, because its CSP allows no third-party origins.

## Proposed for the shared standards

Not adopted upstream. Each would go through a developer-tools PR.

| Pattern | Applies to | Evidence | Target |
| --- | --- | --- | --- |
| Bulk bar: sticky region with count, Clear, and actions; a confirm dialog listing each item; a result naming partial failure | Lists with outward-facing bulk actions | Projects, Pull requests, Errors boards; not yet run | `lists.md` |
| Source health: a failing source is shown as stale with its age and fix command, never as empty | Screens that aggregate outside services | QueueDegraded; not yet run | `general-design.md` |
