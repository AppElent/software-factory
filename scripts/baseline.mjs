#!/usr/bin/env node
// Bounded shared setup (standards/baseline.md); baseline-web.mjs and
// baseline-mobile.mjs add their target's steps to the same library.
//
// Creates: missing .editorconfig and .gitattributes (LF). With package.json:
// packageManager pinned to the installed pnpm (or --pnpm-version, 11+),
// missing check/format, typecheck, and test scripts only for Biome,
// TypeScript, and Vitest already declared, and starter biome.json and
// pnpm-workspace.yaml when absent. --ci adds .github/workflows/ci.yml when
// the required scripts exist. Without package.json: text settings only.
//
// baseline-web.mjs requires a TanStack Start + Vite scaffold and adds missing
// dev/build scripts, plus deploy/cf-typegen when Wrangler is declared. With no
// Wrangler config it creates wrangler.jsonc (needs --name): TanStack server
// entry, today's compatibility date, nodejs_compat, and observability.
// Existing Wrangler dates, environments, bindings, routes, and IDs are kept.
//
// Preserves: existing scripts, versions, configuration, unknown package
// fields, pnpm-workspace.yaml, and ci.yml. Installs no packages. Stops on a
// non-pnpm lockfile or packageManager.
//
// Output is app-owned: no catalog, adoption version, or receipt is kept.
// The plan lists paths and review notes without printing config values.
// Writes check the planned contents first and respect symlink boundaries.
// Each write is atomic, the run is not: after an interruption inspect the
// diff and rerun; matching files are kept. A stale .appelent/baseline.lock
// may be removed only after confirming no setup process is running.
import { baselineMain } from './lib/baseline.mjs';
baselineMain('general').catch(error => { console.error(error.message); process.exitCode = 1; });
