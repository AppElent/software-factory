---
type: standard
kind: platform
description: Read when adding, routing, or checking environment variables and secrets.
version: 4.0.0
applies_to: [all]
---

# Environments

Every app names the same environments, reads them from the same Infisical tiers, and
lands each value in the same destination, from one data-only manifest.

## Rules

### Environments and tiers

- Use only these names, and only the ones the app has:

  | Environment | What it is | Infisical |
  | --- | --- | --- |
  | `local` | Your machine and every worktree | `dev` |
  | `dev` | A shared deployed development backend | `dev` |
  | `preview` | Short-lived web PR previews | `staging` |
  | `staging` | A deployed release candidate, and the installed preview app | `prod` |
  | `production` | Production | `prod` |

- Infisical tiers follow lifetime. `dev` serves your machine and the shared dev
  backend, `staging` serves only short-lived web PR previews, and `prod` serves
  everything long-lived: `staging`, `production`, and the installed preview app, which
  is the owner's daily driver on real data. Infisical has exactly these three tiers.
- Auth follows the tier ([auth](auth.md)). Infisical `dev` and `staging` hold the
  Clerk development instance's key and issuer, so PR previews and their per-PR
  backends sign in on `workers.dev`; `prod` holds the production instance. A
  production instance signs in only on its domain and subdomains, so staging web needs
  such a host, not `workers.dev`.
- The installed preview app is written from `staging`: EAS `preview` gets its values
  from `env:apply staging`, so an app with a mobile preview build lists `staging` even
  without a staging web. EAS landings never list `preview`; `env:check` warns
  (`landing.eas-preview`).
- Test-user values (any name containing `TEST_USER`) land only in `local` and `dev`.
  `env:check` warns on any other landing, and plan, apply, and exec refuse that
  environment.
- `staging` and `production` share Infisical `prod`. A value that differs between them,
  such as a staging web's own `prod:` Convex deploy key, gets its own Infisical key
  (`convex-staging-deploy-key`).
- The mobile preview app sees backend changes only after a production deploy. Keep
  client changes compatible with deployed functions, or ship them together.

### Routing

- `env.manifest.ts` is data: `ENV_CONFIG`, `ENVIRONMENTS`, and `ENTRIES`. Each entry
  names its Infisical key, whether it is secret, and which consumer reads it under
  which name in which environments. The engine picks the destination:

  | Consumer | local | dev | preview | staging | production |
  | --- | --- | --- | --- | --- | --- |
  | `vite-build` | `.env.local` | GitHub `dev` | GitHub repo | GitHub `staging` | GitHub `production` |
  | `local-tooling` | `.env.local` | | | | |
  | `worker-runtime` | `.dev.vars` | `<worker>-dev` | `<worker>-pr-<n>` | `<worker>-staging` | `<worker>` |
  | `convex-functions` | `convex.deployments.dev`, else the CLI's dev deployment | `convex.deployments.dev` | preview default | `convex.deployments.staging` | `convex.deployments.production` |
  | `workflow` | | GitHub `dev` | GitHub repo | GitHub `staging` | GitHub `production` |
  | `expo-build`, `eas-tooling` | EAS development | EAS development | | EAS preview | EAS production |
  | `expo-local` | `<mobile>/.env.local` | | | | |

- GitHub repository scope holds only preview values, named `PREVIEW_<name>`, so a
  missing Environment secret never falls back to a preview value. Workflows map them
  back (`NAME: ${{ secrets.PREVIEW_NAME }}`); `exec` and `--ci` use the unprefixed name.
- Workflows read secret entries from `secrets.` and public ones from `vars.`.
- Preview Worker values need `--pr <n>`; without it they are skipped with a warning.
- Deployed environments read values from their destination, never from a
  `.env.<environment>.local` file. A local command that needs deployed values runs
  through `env:exec`.
- `VITE_` and `EXPO_PUBLIC_` values are public; routing a secret to a client consumer
  fails validation.
- **Default:** no `placementsFor`, `CONSUMERS`, or source mapping in the manifest. To
  change one cell of the table, set `ENV_CONFIG.routes[consumer][environment]` to a
  destination or `null` and record the reason as an exception.
- Generated dotenv files hold only manifest values. Never edit them by hand; a value
  missing from the manifest is added there.

### Commands

- Every app has exactly these scripts, each `node scripts/env.mjs <command>`:
  `env:check`, `env:plan`, `env:apply`, `env:generate`, `env:exec`.
- `env:exec` adds the selected values to one command's environment under their
  variable names (unprefixed), writes nothing, and returns the command's exit code. For
  a deployed environment it also sets every local-file name it doesn't supply to `""`,
  so `.env.local` values (test users, local flags) can't leak into a build. Local
  deploys and OTA publishes use it: `deploy:<environment>` runs
  `node scripts/env.mjs exec <environment> --only github -- <deploy command>`, and
  `mobile:update:<channel>` runs `… exec <environment> --only eas -- <publish command>`,
  where the `preview` channel's environment is `staging`.
- Worktrees get local values from [workspaces](workspaces.md), never by copying
  another checkout's dotenv files.

### Safety

- Plans and diagnostics show names and destinations, never values. Missing required
  values block; missing optional values keep what is there; empty values are not
  written.
- `--prune` removes only keys the engine owns (`.appelent/env-state.json`, kept out of
  Git with `.appelent/env.lock/`). Production pruning needs `--yes` or typed
  confirmation.
- Provider writes are not one transaction: after a partial failure, run `plan` or
  `check` before retrying. EAS's `--value` argument is visible to local process
  inspection while it runs; applying a Worker secret may publish a Worker version.
  A provider that times out is killed with its whole process tree before the env
  lock is released.

## Implementation

1. Copy the [example manifest](environments/examples/env.manifest.ts) to the app root
   and set `appName`, `source.paths` (later folders win), `convex`, `worker`,
   `mobile`, and `github.repository`. Use only the environments the app deploys.
2. Write `.infisical.json` (project reference, no secrets) and authenticate the
   provider CLIs the operation uses. Node 22.15+.
3. Run from the app root (or pass `--path`):

   ```sh
   pnpm env:generate                 # .env.example from the manifest
   pnpm env:check                    # manifest only; no credentials
   pnpm env:plan local
   pnpm env:apply local --only file
   pnpm env:apply preview --only worker --pr 12   # --pr names per-PR destinations
   ```

4. CI holds values in the job env under their variable names and passes `--ci`.
   Without `INFISICAL_TOKEN`, `check <environment> --ci` only verifies that every
   GitHub-routed name is set, and `apply <environment> --ci` reads values from the job
   env. With a machine identity exported as `INFISICAL_TOKEN`, CI loads the source and
   compares as usual.

The manifest is trusted code run after Node's type stripping: keep it self-contained,
use `import type` only, and avoid enums, namespaces, and parameter properties.

## Verify

- `pnpm env:check` reports no errors and no `environment.nonstandard`,
  `source.nonstandard`, or `landing.test-user` warnings.
- After `env:apply staging`, EAS `preview` holds a `pk_live_` key and the production
  backend URL, while `PREVIEW_VITE_CLERK_PUBLISHABLE_KEY`, local, and dev hold
  `pk_test_`.
- `git ls-files '*.env*'` lists only `.env.example` files.

## Migration

From 3.x:

1. In Infisical `staging` at `/`, point `clerk-publishable-key` and
   `clerk-jwt-issuer-domain` at the `dev` values (secret references). Values only the
   preview app read from `staging` now come from `prod`.
2. Drop the `pr-clerk-*` entries; the regular Clerk entries land in `preview` again.
3. Move every `expo-build` and `eas-tooling` landing from `preview` to `staging`, and
   add `staging` to `ENVIRONMENTS` if the app ships a mobile preview build.
4. A staging web's `convex-staging-deploy-key` moves to Infisical `prod`.
5. `mobile:update:preview` runs `exec staging --only eas`. Then `env:plan` and
   `env:apply` `preview` and `staging`.

From 2.x:

1. Rename environments to the table (`stg` → `staging`). Map them to the standard
   Infisical tiers; moving preview from `dev` to `staging` needs an app folder in
   `staging` with the production values the preview app needs.
2. Drop test-user landings outside local and dev (apply refuses them), plus
   `.env.production.local` / `.env.development.local` and unmanaged keys in generated
   files.
3. Delete `CONSUMERS`, `placementsFor`, destination helpers, type scaffolding, and
   `source.environments`; move deployment and Worker names into `ENV_CONFIG.convex`
   and `ENV_CONFIG.worker`; keep live Worker names that differ from
   `<worker>-<environment>` in `worker.names`. Rename custom consumers to the standard
   ones.
4. `pnpm env:plan <environment>` for each environment and compare destinations with
   the old plan. GitHub repository names are now `PREVIEW_<name>`: apply preview, then
   update the preview workflow and delete the old repository secrets.
5. Wrap local deploys and OTA publishes in `env:exec`, and add the five `env:*`
   scripts.
6. Publish a preview update (`pnpm mobile:update:preview`) so the installed app gets
   the new `EXPO_PUBLIC_*` values; rebuild only when native configuration changed.
