---
type: standard
kind: capability
description: Read when adding or changing how a web app and its backend deploy to staging or production.
version: 1.0.0
applies_to: [web, backend]
---

# Deployments

Shipped environments deploy from `main` through one workflow, with the backend first and values scoped per environment, so no deploy depends on a laptop.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- A merge to `main` deploys the first shipped environment: staging when it exists, otherwise production. Production from a manual run deploys only from `main`; fail loudly on any other ref.
- Deploy the backend before the Worker that calls it: `convex deploy` runs the web build through `--cmd`, then `wrangler deploy`. Run seeds and other backend steps before the Worker step.
- Each target is a GitHub Environment holding its own secrets and variables, written by `env:apply <environment>` from the manifest ([environments](environments.md)). The workflow names each value once and never selects values with `github.event_name` expressions.
- Check the environment before anything ships: `env.mjs check <environment> --ci`, plus a `prod:` prefix check on `CONVEX_DEPLOY_KEY`. A missing Environment secret falls back to a repo secret of the same name, which is usually the preview key.
- Deploys never cancel each other: `concurrency` per target with `cancel-in-progress: false`.
- Rerun the CI checks in the deploy workflow (`uses:` the CI workflow), because admins can bypass required checks.
- **Default:** a `main` ruleset requires a pull request and the CI check job, blocks force pushes and deletion, and lets admins bypass only through a pull request.
- **Default:** a local `deploy:<environment>` script runs the same deploy command with values from Infisical (`env.mjs exec <environment> --only github -- …`), for when CI is unavailable.

## Implementation

1. Adapt the [workflow template](deployments/templates/deploy.yml). Add `workflow_call:` to the CI workflow and drop its `push: main` trigger, which the deploy now covers.
2. In the manifest, land deploy values on `{ kind: "github", scope: "<environment>" }` and mark `VITE_CONVEX_URL` as supplied by `convex deploy --cmd-url-env-var-name CONVEX_URL` for those environments.
3. Create a production deploy key in the Convex dashboard, store it in Infisical, create the Environment (`gh api -X PUT repos/<owner>/<repo>/environments/<name>`) and run `pnpm env:apply <environment> --only github`.
4. Create the ruleset with `gh api repos/<owner>/<repo>/rulesets --input <file>`, with the CI check context as the required status check.

## Verify

- `pnpm env:plan <environment>` lists every GitHub destination with no errors.
- A manual run from a branch fails at the ref guard; one with no Environment deploy key fails at the environment check.
- After the first merge, the Convex dashboard shows the new functions and the Worker serves the new build.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
