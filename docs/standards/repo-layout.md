---
type: standard
kind: platform
description: Read when adding a workspace package, moving top-level folders, or wiring web, Convex, and mobile to shared code.
version: 1.0.1
applies_to: [web, mobile, backend]
---

# Repository layout

One repository holds the web app, the Convex backend, the Expo app, and the code they share, in the same places in every app.

## Rules

- The web app is the repository root: `src/`, `vite.config.ts`, `wrangler.jsonc`, `public/`. `convex/` sits next to it. The Expo app is `apps/mobile`; shared code is `packages/core`. Toolkit and app scripts live in `scripts/`, docs in `docs/`, and `env.manifest.ts` and `appelent.json` at the root.
- `pnpm-workspace.yaml` lists `apps/*` and `packages/*`; the root package is the web app.
- `packages/core` has no dependencies, only dev tools. It holds pure TypeScript that runs unchanged in the browser, on the Worker, in Convex, and on Hermes: no DOM, Node, React, or Convex imports, `lib: ["ES2022"]`, `types: []`.
- **Default:** `packages/core` exports raw `.ts` subpaths with no build step: `"./geo": "./src/geo.ts"`, or `"./*": "./src/*.ts"`. Vite, Metro, and Convex's bundler read these directly; there is no `dist/`, watch process, or build-before-typecheck ordering. Import a subpath (`@app/core/geo`), not a barrel.
- Mobile reaches `convex/_generated` by relative path through one module, `apps/mobile/src/convex/api.ts`, which re-exports `api`, `Doc`, and `Id`. Screens import from that module, never from a deep `../../convex/_generated` path. `convex/` is not a workspace package.
- Package names: the root `package.json` is named for the app (`my-app`). Workspace packages use the app's scope: `@<app>/core`, `@<app>/mobile`. Every package is `private: true` and depends on siblings with `workspace:*`.
- Root scripts drive every target: `typecheck` covers web, `convex`, `packages/core`, and `apps/mobile` (directly or through `pnpm --filter`), and `check` includes Biome and the [mobile structure](mobile-structure.md) check.

## Implementation

```text
src/                     web app (TanStack Start), routes and features
convex/                  backend functions, schema, _generated/
apps/mobile/             Expo app (@app/mobile)
  src/convex/api.ts      re-exports ../../../../convex/_generated
packages/core/           @app/core: dependency-free shared logic
  src/geo.ts             exported as @app/core/geo
scripts/                 toolkit scripts plus app scripts
env.manifest.ts          environment routing
appelent.json            workspace policy
pnpm-workspace.yaml      packages: apps/*, packages/*
```

```json
{
  "name": "@app/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" }
}
```

A built core (tsup to `dist/` with a `react-native` condition pointing at `src/`) is an exception. Record it only when a consumer actually cannot read raw `.ts`, with the failing import. The build then has to run before every typecheck, test, and deploy of the other targets.

## Verify

- `pnpm typecheck` covers all four targets; `pnpm check` runs the mobile structure check.
- `git grep "convex/_generated" apps/mobile` matches only `apps/mobile/src/convex/api.ts`.
- `packages/core/package.json` has no `dependencies`.

## Migration

Existing apps keep their names and folders; move a deep `convex/_generated` import to `api.ts` when touching the file, and switch a built core to raw `.ts` subpaths (remove the build, point `exports` at `src/`, drop the build step from scripts and CI) in one dedicated PR.
