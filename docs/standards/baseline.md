---
type: standard
kind: platform
description: Read when setting up or changing repository, package-manager, formatter, type, test, or CI configuration, or when installing or updating the toolkit.
version: 2.2.0
applies_to: [all]
---

# Shared baseline

Every JavaScript/TypeScript repository uses the same package manager, checks, and CI gates, with app-owned layout.

## Rules

Use pnpm, TypeScript, and Biome for new JavaScript/TypeScript applications. Keep versions and formatter options in configuration. Commit the lockfile; CI installs it frozen and runs the affected targets' lint/format, types, tests, and build checks. Existing target-specific test runners remain valid: the web baseline uses Vitest and the mobile baseline uses Jest with Expo support. Respect the configured dependency release-age policy and build-script approvals; security overrides need a demonstrated advisory and compatible resolution.

### Dependencies and configuration

- Start `pnpm-workspace.yaml` from the [template](baseline/templates/pnpm-workspace.yaml): `minimumReleaseAge: 4320`, an `allowBuilds` ledger where every entry carries its reason, `virtualStoreDirMaxLength: 60`, and `verifyDepsBeforeRun: install`. A cooldown exemption names its date and reason.
- Every dependency has an explicit version or semver range. Never `latest`, `*`, or a dist-tag; the lockfile pins what installs. Use `expo install` versions for SDK packages.
- One TypeScript channel: `typescript` from npm on the 6.0 line (`~6.0.x`), with no npm aliases. Do not add `@typescript/native` or alias `typescript` to `@typescript/typescript6`. Toolkit checks such as `check-mobile-structure.mjs` use the TypeScript compiler API, and Expo and the Vite toolchain still target 6.0. Move every app to 7 in one coordinated change.
- Every tsconfig keeps the root's strictness: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. `noUncheckedIndexedAccess` is optional. It catches unguarded record and array lookups, but it also flags every index into a known-length tuple or a just-checked array, so existing code needs many non-null assertions. Enable it per app when the code base is ready, for every target at once.
- Merge the [Biome fragment](baseline/templates/biome.fragment.json) into `biome.json`: tabs and double quotes; in `apps/mobile`, `noReactNativeRawText` (skipping the app's `AppText`) and `noRestrictedImports` that sends Convex query hooks through `src/convex/query-cache` ([Convex query caching](convex-query-caching.md)).
- CI starts from the [shared workflow](baseline/templates/ci.yml): check, env:check, typecheck for web, core, and mobile, Vitest, mobile Jest when present, and build. An optional [lefthook pre-commit](baseline/templates/lefthook.yml) runs `biome check --staged`.

Install and update the toolkit with `scripts/sync-devtools.mjs`; it needs Node 22.15+ and GitHub CLI authenticated for AppElent/developer-tools. Commit installed files and `.appelent/devtools.json`. Never edit toolkit-owned files in the project: change them upstream. Sync never runs downloaded code, provisions resources, enables a capability, or migrates application code. Review changed scripts before running them. Install skills separately with the skills CLI.

Repository layout, package names, aliases, and deployment identities remain project-owned. These standards describe defaults, not an automatic migration of existing projects. Record deliberate exceptions with scope and reason in CODING_STANDARDS.md.

## Implementation

Run from the repository root. Read the installed general coding/design guidance and project decisions first.

```sh
node scripts/baseline.mjs --dry-run
node scripts/baseline.mjs --apply
node scripts/check-project.mjs
```

The script creates missing editor/LF settings. With package.json it pins the installed pnpm version (or `--pnpm-version 11.8.0`), adds missing scripts only for tools already declared, and creates starter pnpm/Biome configuration when absent. It installs no packages. A repository without package.json receives only text-file settings; no Node app is created.

Existing scripts, versions, configuration, and unknown package fields survive. A non-pnpm lockfile blocks automatic setup: review `pnpm import`, install, and remove the old lockfile only as an explicit package-manager migration. Existing pnpm-workspace.yaml is preserved; inspect it for a release-age policy and approve only native build scripts actually required by the dependency graph. Do not copy vulnerability overrides from another app.

Choose compatible Biome, TypeScript, and target-specific test dependencies in the application, then rerun setup. The script creates check/format for Biome, typecheck for TypeScript, and test for Vitest only when those dependencies exist. Existing test runners remain valid. New TypeScript configuration should come from the framework scaffold; do not overwrite a framework-specific tsconfig with a generic one.

`--ci` creates a workflow only if required package roles exist. Existing ci.yml is preserved. Inspect other workflows before enabling it to avoid duplicate checks. The generated workflow assumes a public dependency graph; an app still using private packages must retain its existing registry authentication. Monorepos should apply root settings once and keep target-specific workflows at the correct working directory.

For a new web or Expo app, create it with the supported upstream scaffold first, then follow [web](web-baseline.md) or [mobile](mobile-baseline.md). Those scripts include this shared setup; they are not independent package-manager policies.

### Toolkit

```sh
node scripts/sync-devtools.mjs --dry-run   # preview upstream changes
node scripts/sync-devtools.mjs             # install or update everything
node scripts/sync-devtools.mjs --check     # offline drift check
npx skills add https://github.com/AppElent/developer-tools/tree/main/skills --skill '*' -a codex claude-code -g
npx skills update
```

Copy a reviewed `scripts/sync-devtools.mjs` once to bootstrap; it updates itself, and the new version runs on the next invocation. Updates resolve `main` once and fetch every file from that commit. After an update, read the migration notes of changed standards you use, apply them to the app, and run its checks: syncing a standard is not proof of migration. Options, conflicts, interruption recovery, and upgrades from earlier updaters: [toolkit sync detail](baseline/toolkit.md).

## Verify

Setup output becomes app-owned. No capability catalog, adoption version, or permanent recipe receipt is added. Plans list paths and manual review items without dumping existing config values. Writes preflight expected contents and preserve symlink boundaries. They are individually atomic, not one transaction: after interruption inspect the diff and rerun; matching files are retained. A stale .appelent/baseline.lock requires verifying no setup process remains before manual removal.

`node scripts/sync-devtools.mjs --check` passes. Run the actual install, check, typecheck, test, and build roles. A successful setup command proves configuration writes only. `check-project.mjs` reads metadata and routing files without executing app code, reading dotenv values, or contacting providers.

## Migration

From 2.1: compare `pnpm-workspace.yaml`, `biome.json`, and CI with the templates and add what is missing. Replace `latest` ranges with the installed versions. Add the root's strictness flags to `apps/mobile/tsconfig.json` and fix what they report. Record existing differences, such as another formatter style or an aliased TypeScript, as exceptions until they are migrated.

Replace `appelent recipe ... baseline.config` with focused baseline script invocations. Preserve prior recipe receipts and feature records as historical evidence until project migration is reviewed. Do not infer that old numbered steps are all complete.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
