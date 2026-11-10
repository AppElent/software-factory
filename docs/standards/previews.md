---
type: standard
kind: capability
description: Read when adding or changing pull-request preview deployments.
version: 4.1.0
applies_to: [web, backend]
---

# Pull-request previews

A same-repository pull request labelled `preview:web` gets an isolated, disposable backend and Worker that never touch production.

## Rules

- Previews are opt-in per pull request: deploy only while the `preview:web` label is present, redeploy on pushes while it stays, and delete the Worker when the label is removed.
- Closing a PR always runs cleanup, whatever its labels, with a delete that tolerates an absent Worker.
- Unrelated label changes neither deploy nor cancel a running deploy: gate each job on the label and keep concurrency at job level.
- Build previews with a wrangler env that clears routes, `"pr": { "workers_dev": true, "routes": [] }`, and set `CLOUDFLARE_ENV: pr` on the job. Without it, `wrangler deploy --name APP_NAME-pr-<N>` still carries the top-level `routes` and moves the production custom domain to the PR Worker ([build-time env selection](deployments.md)).
- A guard step fails the job when the deploy output mentions `custom domain`. If a preview claimed the domain, redeploy production to take it back.
- Existing custom staging/production environment names and routes survive.
- The seed function is safe for a fresh disposable backend and never writes production resources.
- Previews use the Clerk development instance, and the per-PR backend trusts its issuer ([environments](environments.md)). Test-user values still never reach them: `VITE_*` values are public in the bundle.
- Only same-repository PRs deploy. Never switch to `pull_request_target` with an untrusted PR checkout to reach secrets. Review deploy-token permissions and branch trust.
- Worker cleanup is not backend cleanup. No safe Convex deployment delete is assumed: configure provider expiry/retention.

## Implementation

1. Adapt the [workflow template](previews/templates/preview.yml) as app-owned source: APP_NAME, seed function, build output, and deployment environments. Keep an existing customized preview workflow as the starting point.
2. Add the `pr` env to `wrangler.jsonc`.
3. Preview values live in GitHub repository scope as `PREVIEW_<name>`, written by `env:apply preview` ([environments](environments.md)). `PREVIEW_CONVEX_DEPLOY_KEY` is a Convex preview deploy key.
4. Create the `preview:web` label in the repository.

## Verify

- Run an isolated PR pilot: distinct Convex and Worker identities, seeded data, public build URL, auth redirects, refresh, and Worker deletion on close.
- After a preview build, `jq .routes dist/server/wrangler.json` shows no routes.
- The Convex preview deployment is gone after its retention period.

## Migration

From 3.x: rename the repository secrets and variables to their `PREVIEW_` names with `pnpm env:apply preview --only github`, then update the workflow from the template. From 3.0, also add the `pr` env to `wrangler.jsonc`.
