---
type: standard
kind: capability
description: Read when adding or changing pull-request preview deployments.
version: 3.1.0
applies_to: [web, backend]
---

# Pull-request previews

A same-repository pull request labelled `preview:web` gets an isolated, disposable backend and Worker that never touch production.

## Rules

Previews are opt-in per pull request. Deploy only while the `preview:web` label is present, redeploy on pushes while it stays, and delete the Worker when the label is removed. Closing a PR always runs cleanup, whatever its labels, with a delete that tolerates an absent Worker. Unrelated label changes must neither deploy nor cancel a running deploy: gate each job on the label and keep concurrency at job level. Create the label in the repository.

Run an isolated PR pilot: verify distinct Convex/Worker identities, seeded data, public build URL, auth redirects, refresh, and close-event Worker cleanup. The current workspace/preview contract does not assume a safe Convex deployment deletion command: configure provider expiry/retention and verify absence separately. Worker cleanup alone is not full backend cleanup.

**Required:** build previews with a wrangler env that clears routes, `"pr": { "workers_dev": true, "routes": [] }`, and set `CLOUDFLARE_ENV: pr` on the job. The Cloudflare Vite plugin picks the env at build time ([web baseline](web-baseline.md)), so `wrangler deploy --name APP_NAME-pr-<N>` alone still carries the top-level `routes` and moves the production custom domain to the PR Worker. **Required:** a guard step fails the job when the deploy output mentions `custom domain`.

Existing custom staging/production environment names and routes must survive. If build/deploy flags differ in the installed provider CLI, inspect its actual help and adapt the project template before execution.

## Implementation

Use the [workflow template](previews/templates/preview.yml) as app-owned source after adapting APP_NAME, seed function, provider secret/variable names, build output, and deployment environments. Keep an existing customized preview workflow as the starting point; never replace it merely because the template changed.

The template uses a Convex preview-kind deploy key to create an isolated PR backend, runs a configured seed function, passes its URL into the web build, and deploys a per-PR Worker. Closing the PR deletes that Worker. The seed function must be safe for a fresh disposable backend and must not write production resources.

Configure PREVIEW_CONVEX_DEPLOY_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and a public preview Clerk key under the names used in the workflow. Route their values through [environments](environments.md). Keep development/preview auth distinct from production. If private package dependencies remain, preserve their registry authentication and minimum package-read permissions separately.

Only same-repository PRs receive the deployment workflow. Never change this to pull_request_target with untrusted PR checkout to make fork secrets available. Review deploy-token permissions and branch trust. The template deliberately does not install or execute itself during toolkit sync.

## Migration

Replace the baseline.preview recipe procedure with this guide and the app's committed workflow.

From 2.x: add the `labeled`/`unlabeled` triggers, the label conditions, and job-level concurrency from the template to the existing workflow, then create the `preview:web` label. Open PRs lose their automatic redeploy until labelled; their existing Worker is still deleted when the PR closes. Compare changes and verify a fresh preview; a template/version update is not proof an existing workflow deployed or cleaned up successfully.

From 3.0: add the `pr` env to wrangler.jsonc, `CLOUDFLARE_ENV: pr` to the deploy job, and the deploy-log guard. After a preview build, `jq .routes dist/server/wrangler.json` must show no routes. If a preview already claimed the domain, redeploy production to take it back.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
