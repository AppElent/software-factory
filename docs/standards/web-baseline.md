---
type: standard
kind: platform
description: Read when setting up or changing a TanStack Start web app stack, its UI states, or browser capabilities.
version: 2.2.0
applies_to: [web]
---

# Web baseline

Web apps share one TanStack Start stack and state components, with app-owned wiring.

## Rules

- React with TanStack Start and file-based TanStack Router on Vite, deployed to Cloudflare Workers. The [shared baseline](baseline.md) owns pnpm, TypeScript, Biome, CI, and dependency policy.
- Tailwind CSS with CVA for variants, Base UI for accessible primitives, TanStack Form with Zod for forms, Lucide React for icons, Recharts for charts, date-fns for dates, and Vitest with Testing Library for behavior tests. Add each when the app needs it, not to match this list.
- Reuse the app's class-merging helper, components, and semantic tokens. No parallel icon, modal, styling, validation, or feedback systems.
- Shared implementation lives behind app-owned interfaces, not copies in individual screens.
- Generate route trees through the router tooling; never edit them by hand.
- Backend/auth choices, visual identity, source layout, aliases, and provider identifiers belong in project standards. With Convex/Clerk, follow [auth](auth.md) and use the existing data hooks or query adapter consistently.
- Validate env values at build and runtime boundaries with the app's existing schema mechanism. Never expose backend secrets through `VITE_` variables.
- Wrangler environments are chosen at build time with `CLOUDFLARE_ENV`; [deployments](deployments.md) owns the build and deploy rules.

## Implementation

1. Start from a TanStack Start + Vite scaffold with framework-compatible React, TypeScript, Tailwind, Biome, test tooling, Wrangler, and the Cloudflare Vite plugin.
2. Run setup. `--name` is required only when it creates Wrangler configuration; the header of `scripts/baseline.mjs` lists what it creates and preserves.

   ```sh
   node scripts/baseline-web.mjs --name my-worker --dry-run
   node scripts/baseline-web.mjs --name my-worker --apply
   ```

3. Complete the Vite wiring for the installed framework version with [Cloudflare's TanStack guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/). Review the server environment name the Cloudflare plugin expects, plugin ordering, and the output directory.
4. Add [environment routing](environments.md). Public build values and server credentials have separate destinations. Preserve existing staging/production names.
5. With Clerk/Convex, follow [auth](auth.md) for provider wiring and protected routes. Authorize in each query/mutation, not only in route guards.
6. Build UI states per [general design](general-design.md), preferring existing app components. App-owned starting points: [skeleton](web-baseline/examples/skeleton.tsx), [empty state](web-baseline/examples/empty-state.tsx), [toast](web-baseline/examples/toast.tsx), [confirmation](web-baseline/examples/confirm-dialog.tsx), [route error](web-baseline/examples/route-error.tsx).
7. Review the [input-sizing CSS](web-baseline/templates/mobile-viewport.css) against existing styles. Keep inputs readable on iOS without disabling pinch zoom.
8. Add [previews](previews.md), [deployments](deployments.md), [issue reporting](issue-reporting.md), [PWA](pwa.md), [i18n](i18n.md), or [MCP](mcp.md) only when needed.

## Verify

- Install, check, typecheck, test, and a production build pass.
- Inspect server rendering and hydration, direct protected-route loading, session transitions, refresh, keyboard/focus, browser zoom and text scaling, themes, and narrow layouts.
