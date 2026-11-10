---
type: standard
kind: capability
description: Read when adding or changing how a web app and its backend deploy to staging or production.
version: 1.2.0
applies_to: [web, backend]
---

# Deployments

Shipped environments deploy from `main` through one workflow, with the backend first and values scoped per environment, so no deploy depends on a laptop.

## Rules

- A merge to `main` deploys the first shipped environment: staging when it exists, otherwise production. Production from a manual run deploys only from `main`; fail loudly on any other ref.
- Deploy the backend before the Worker that calls it: `convex deploy` runs the web build through `--cmd`, then `wrangler deploy`. Run seeds and other backend steps before the Worker step.
- Each target is a GitHub Environment holding its own secrets and variables, written by `env:apply <environment>` from the manifest ([environments](environments.md)). The workflow names each value once and never selects values with `github.event_name` expressions.
- Check the environment before anything ships: `env.mjs check <environment> --ci`, plus a `prod:` prefix check on `CONVEX_DEPLOY_KEY`. A missing Environment secret falls back to a repository secret of the same name; repository scope holds only `PREVIEW_` names ([environments](environments.md)), and the prefix check catches a repository that still has an unprefixed preview key.
- With `@cloudflare/vite-plugin`, the build picks the Wrangler environment: it reads `CLOUDFLARE_ENV` at build time and writes the resolved Worker into `dist/server/wrangler.json`, which `wrangler deploy` follows; `wrangler deploy --env <name>` is ignored. Build each environment with `CLOUDFLARE_ENV=<name>`, including in package scripts such as `deploy:dev`. Wrangler environments use the standard names (`dev`, `staging`, and `pr` for previews), so Workers are `<name>-<environment>`, matching [environments](environments.md) routing.
- The deploy job compares the built Worker name (`jq -r .name dist/server/wrangler.json`) with the target it expects and fails on a mismatch. Without that check, a staging deploy silently replaces the production Worker.
- Deploys never cancel each other: `concurrency` per target with `cancel-in-progress: false`.
- Rerun the CI checks in the deploy workflow (`uses:` the CI workflow), because admins can bypass required checks.
- **Default:** a `main` ruleset requires a pull request and the CI job `check`, blocks force pushes and deletion, and lets admins bypass only through a pull request.
- **Default:** a local `deploy:<environment>` script runs the same deploy command with values from Infisical (`env.mjs exec <environment> --only github -- …`), for when CI is unavailable.

## Implementation

1. Adapt the [workflow template](deployments/templates/deploy.yml). Add `workflow_call:` to the CI workflow and drop its `push: main` trigger, which the deploy now covers.
2. In the manifest, land build values on `vite-build` and deploy credentials on `workflow` for each deployed environment; the shared routing writes both to that GitHub Environment. Mark `VITE_CONVEX_URL` `suppliedIn` those environments by `convex deploy --cmd-url-env-var-name CONVEX_URL`.
3. Create a production deploy key in the Convex dashboard, store it in Infisical, create the Environment (`gh api -X PUT repos/<owner>/<repo>/environments/<name>`) and run `pnpm env:apply <environment> --only github`.
4. Once a pull request has a successful status check named `check`, create the ruleset from the [template](deployments/templates/main-ruleset.json): `gh api -X POST repos/<owner>/<repo>/rulesets --input docs/standards/deployments/templates/main-ruleset.json`. It requires the CI job `check` from GitHub Actions (`integration_id` 15368); created earlier, it blocks every pull request, including the one that adds the job. Rulesets need a public repository or a paid plan; a private repository on GitHub Free records the missing ruleset as an exception.

## Verify

- `gh api repos/<owner>/<repo>/rules/branches/main` lists `pull_request` and `required_status_checks` with context `check`.
- `pnpm env:plan <environment>` lists every GitHub destination with no errors.
- A staging build's `jq -r .name dist/server/wrangler.json` prints the staging Worker name.
- A manual run from a branch fails at the ref guard; one with no Environment deploy key fails at the environment check.
- After the first merge, the Convex dashboard shows the new functions and the Worker serves the new build.
