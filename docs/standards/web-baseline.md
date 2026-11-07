---
type: standard
kind: platform
description: Read when setting up or changing a TanStack Start web app stack, its UI states, or browser capabilities.
version: 2.1.0
applies_to: [web]
---

# Web baseline

Web apps share one TanStack Start stack and state components, with app-owned wiring.

## Rules

All current web projects use React with TanStack Start and file-based TanStack Router on Vite, deployed to Cloudflare Workers. Use Tailwind CSS with CVA for variants, Base UI for accessible primitives, TanStack Form with Zod for forms, Lucide React for icons, and Vitest with Testing Library for behavior tests. For charts use Recharts; for date utilities use date-fns. Add these when the application needs their functionality, rather than installing unused libraries to match the stack list. Use the [shared baseline](baseline.md) for pnpm, TypeScript, Biome, CI, and dependency policy.

Reuse the app's class-merging helper, components, and semantic tokens. Avoid parallel icon, modal, styling, validation, and feedback systems. Generate route trees through the router tooling; never edit them by hand. Shared implementation lives behind app-owned interfaces, not copies in individual screens.

Backend/auth choices, visual identity, source layout, aliases, and provider identifiers belong in project standards. When the project uses Convex/Clerk, follow [auth](auth.md) and use the existing data hooks or query adapter consistently. The standard does not require adding either provider to a project.

## Implementation

### Setup

Start with an existing TanStack Start + Vite scaffold. Select framework-compatible React, TypeScript, Tailwind, Biome, test tooling, Wrangler, and the Cloudflare Vite plugin in the app; the toolkit does not pin a second framework dependency graph.

```sh
node scripts/baseline-web.mjs --name my-worker --dry-run
node scripts/baseline-web.mjs --name my-worker --apply
```

`--name` is required only when creating Wrangler configuration. Shared setup includes pnpm and editor configuration. Missing dev/build scripts are added, plus deploy/type-generation scripts when Wrangler is declared. Existing configuration dates, environment names, bindings, domains, package scripts, and IDs are preserved.

For a new Wrangler config, the script sets the TanStack server entry, today's compatibility date, nodejs_compat, and observability. Complete Vite wiring according to the app's installed framework version and [Cloudflare's TanStack guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/). Review the server environment name expected by the Cloudflare plugin, plugin ordering, and output directory; configuration alone does not establish SSR deployment readiness.

With `@cloudflare/vite-plugin`, the build picks the Wrangler environment. It reads `CLOUDFLARE_ENV` at build time and writes the resolved Worker into `dist/server/wrangler.json`. `wrangler deploy` then follows that output, and `wrangler deploy --env <name>` is ignored. Build each environment with `CLOUDFLARE_ENV=<name>`, including in package scripts such as `deploy:dev`. A deploy job compares the built Worker name (`jq -r .name dist/server/wrangler.json`) with the target it expects and fails on a mismatch. Without that check, a staging deploy silently replaces the production Worker.

### Finish the application wiring

1. Add [environment routing](environments.md). Public build values and server credentials must have separate destinations. Preserve existing staging/production names.
2. If using Clerk/Convex, follow [auth](auth.md) for provider wiring and protected routes. Backend authorization belongs in each query/mutation, not just route guards.
3. Validate env values at the application's build/runtime boundaries using its existing schema mechanism. Never expose backend secrets through VITE_ variables.
4. Use the installed web/general design guidance. Build loading, empty, error, pending, and populated states together. Prefer existing app components; optional [skeleton](web-baseline/examples/skeleton.tsx), [empty state](web-baseline/examples/empty-state.tsx), [toast](web-baseline/examples/toast.tsx), [confirmation](web-baseline/examples/confirm-dialog.tsx), and [route error](web-baseline/examples/route-error.tsx) examples are app-owned starting points. Toast/confirmation examples require compatible Base UI and React versions, translated labels, and provider mounting.
5. Review the [input-sizing CSS](web-baseline/templates/mobile-viewport.css) against existing styles. Keep inputs readable on iOS without disabling pinch zoom; verify text scaling and existing typography.
6. Add [previews](previews.md), [issue reporting](issue-reporting.md), [PWA](pwa.md), [i18n](i18n.md), or [MCP](mcp.md) only when needed.

For workspace hooks and launch actions use [workspaces](workspaces.md). Setup completes before persistent backend/web processes start. Never copy a parent's deployment credentials into a child worktree.

## Verify

Run install, formatting/lint, types, tests, and a production build. Inspect server rendering and hydration, direct protected-route loading, session transitions, refresh, keyboard/focus, browser zoom, themes, and narrow layouts. Preview deployment needs a real isolated pilot; no toolkit command here deploys production.

The old 16 baseline steps now map to shared/web setup (1–3, 5–7), environments (4), previews (8), reporter (9), workspaces/CI (10–11), actual verification (12), i18n (13), input sizing (14), PWA (15), and UI states (16). Preserve deliberate deviations. There is no blanket version stamp or automatic retrofit of custom source.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
