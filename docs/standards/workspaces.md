---
type: standard
kind: platform
description: Read when creating, preparing, or cleaning a worktree and its backend resources.
version: 3.0.0
applies_to: [all]
---

# Workspaces

Every worktree is prepared by one script from the canonical source, the same way in
every app and editor, and cleans up what it created.

## Rules

- The editor's worktree setup hook runs `node scripts/workspace.mjs prepare --editor
  <host>` from the new worktree. No other setup script, and no copying of another
  checkout's dotenv files, `.dev.vars`, or deployment keys (`.worktreeinclude` lists no
  `.env*`).
- **Default:** `backend.mode: "none"`. Prepare writes local files from Infisical
  (`env apply local --only file`), so every worktree uses the dev deployment named in
  Infisical `dev`. Its data and functions are shared: use throwaway accounts for
  destructive checks, and push backend changes from a `local` or `cloud` worktree.
- `local` mode selects the project's local Convex deployment (`<project>:local`, run on
  this machine) for offline work or isolation without a cloud deployment.
- Use `cloud` (policy `backend.mode`, or `prepare --backend cloud` for one worktree,
  with a `team:project` and a finite `expiration`) when a change needs its own
  backend: schema migrations, seeds, destructive data work. The script provisions it,
  applies its Convex values, writes client URLs, seeds, and records it for cleanup.
- Cleanup removes only what the ledger owns: scoped credentials, unchanged generated
  files, and expired or deleted deployments it can prove absent. Modified or unowned
  files stay; the checkout is never deleted. A failed cleanup is outstanding work,
  not permission to erase the ledger.
- Provider commands drop inherited deployment selectors and credentials. Keep Convex
  selectors out of any unmanaged `.env` a package script could load.
- After a successful `clean`, `prepare` starts over and accepts a changed policy;
  after an interrupted `clean`, finish `clean` first. A failed `prepare` names the
  step and one credential-scrubbed line of output.
- Never reclaim a lock because it is old: confirm no operation is active first.
- Persistent processes (Convex, web, Metro) run as separate editor actions, not in
  setup. Physical devices need a device-reachable backend URL, not loopback.

## Implementation

1. Add the `workspace` policy to `appelent.json` ([example](workspaces/examples/appelent.json)):

   | Key | Purpose |
   | --- | --- |
   | `schemaVersion` | Always `1`. |
   | `workspace.backend` | `mode`, `project`, `expiration`, `scopedCredential`, `push`. |
   | `workspace.install`, `buildScripts`, `seedScript` | Install and build before the environment step; seed a new backend. |
   | `workspace.outputs` | Generated files and the mobile URL name. |
   | `workspace.ports` | Web and Metro ports. |
   | `envManifest` | Manifest path; defaults to `env.manifest.ts`. |

2. Point the editor's setup hook at the script; configure cleanup before checkout
   removal where the editor supports it. Configure editors without a hook API through
   their own settings; never invent a repository config file for them.

   ```sh
   node scripts/workspace.mjs prepare --editor t3 --dry-run
   node scripts/workspace.mjs prepare --editor t3
   node scripts/workspace.mjs clean
   node scripts/workspace.mjs gc --dry-run
   node scripts/workspace.mjs gc --apply
   ```

The script needs only Node built-ins and the authenticated provider CLIs, so it runs
before dependencies are installed. State and ledgers live in the operating system's
application state directory, outside the checkout, and never hold secret values.

## Verify

- A new worktree has `.env.local` (and the mobile file) marked as generated, without
  any manual copy.
- `prepare` resumes after an interrupted run; `clean` then leaves no owned files, and
  `gc --dry-run` reports nothing outstanding.
- With `cloud`: the worktree's Convex URL differs from the dev deployment, and the
  deployment is gone or expired after `clean`.

## Migration

From 2.x: point the editor hook at `workspace.mjs prepare` and verify a fresh
worktree; then remove copy scripts (`copy-env.sh`, `copy-worktree-env.mjs`, custom
`setup-worktree.mjs`) and `.env*` lines in `.worktreeinclude`, and delete the
"worktrees share the dev deployment" exception: that is now the default. Apps that
relied on isolated worktrees set `backend.mode` to `cloud` or `local`. Keep existing
ledgers so cleanup still finds old resources. Remove the legacy `features` key from `appelent.json`.
