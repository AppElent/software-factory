---
type: standard
kind: platform
description: Read when preparing or cleaning an isolated worktree and its backend resources.
version: 2.1.0
applies_to: [all]
---

# Isolated workspaces

Each worktree gets isolated app resources that are prepared and cleaned by one portable script.

## Rules

State stays in the existing operating-system application state directory, outside the checkout. Identity includes repository/worktree paths and host identity. Ledgers record resource ownership, expiry, completed steps, file hashes, and port claims, never secret values. Preserve this state during migration so cleanup can still identify resources.

Only ledger-owned scoped credentials and unchanged generated files are cleaned. Modified/unowned files and inaccessible resources remain for explicit resolution. The checkout is never deleted. Where the installed provider CLI lacks a verified deployment-delete contract, finite lease expiry and a subsequent not-found check establish absence; still-present, denied, or inaccessible resources are not reported cleaned. Local deployment cleanup remains constrained by that provider boundary.

Locks are not reclaimed merely because they are old. Inspect ownership and verify no operation is active before removing a stale lock. A failed cleanup/GC is outstanding work, not permission to erase the ledger.

## Implementation

T3/Orca/Git own worktree creation, placement, and deletion. The portable workspace script prepares and cleans app resources. Run from the worktree root or pass --path:

```sh
node scripts/workspace.mjs prepare --editor t3 --dry-run
node scripts/workspace.mjs prepare --editor t3
node scripts/workspace.mjs clean
node scripts/workspace.mjs gc --dry-run
node scripts/workspace.mjs gc --apply
```

Retain the existing appelent.json workspace object and env.manifest.ts during extraction. The [configuration example](workspaces/examples/appelent.json) shows policy fields; replace provider identities and paths deliberately.

### appelent.json

| Key | Purpose |
| --- | --- |
| `schemaVersion` | Always `1`. |
| `workspace` | Policy for `workspace.mjs`: backend mode and lease, install/build steps, generated env outputs, ports. |
| `envManifest` | Path to the environment manifest that `workspace.mjs prepare` routes; defaults to `env.manifest.ts`. |
| `targets`, `guidelines` | Accepted for compatibility; no script reads them. |
| `features` | Legacy metadata from the retired feature catalog. `check-project.mjs` warns; remove it. |

### Preparation

Select backend mode none/local/cloud explicitly, with a team:project for backend provisioning. Cloud leases require a finite expiry. Setup optionally installs dependencies/builds, captures canonical source values, prepares the selected backend, routes Convex placements to that backend, creates a scoped credential when configured, pushes once, writes client URLs, seeds, and records readiness.

Provider commands remove inherited deployment selectors/credentials and use explicit references and isolated directories. The source-routing step writes local files only; it does not update shared GitHub/EAS settings. Never copy the parent's dotenv files or deployment key into a child worktree. Keep Convex selectors out of an unmanaged .env that package scripts could load independently.

Preparation is synchronous and resumable. Persistent backend/web/Metro processes start separately through host actions. For physical devices supply a device-reachable backend URL; loopback is insufficient.

### Host setup and verification

Point the supported host setup action at `node scripts/workspace.mjs prepare --editor <host>` from the project root. Preserve custom run actions/icons/settings. Remove broad parent-env copying only after the replacement is verified. Keep backend/web/mobile run actions separate and arrange cleanup before checkout removal when the host supports it. If a host has no supported hook-writing API, configure its native settings explicitly; do not invent a repo config file or report unverified registration as complete.

The script runs before app dependencies exist, using Node built-ins; provider CLIs still need installation/authentication as appropriate. Test prepare --dry-run and an isolated lifecycle, including a resumed failure, generated client URLs, seeding, and cleanup/expiry verification. Automated regression tests inject synthetic providers and do not prove live provider permissions or device reachability.

## Migration

Replace workspace CLI invocations with this script, retaining existing policy, identities, ledgers, resource expiry, and env ownership. This extraction intentionally preserves the current provider commands and state format. Verify against the actually installed provider/host versions before live adoption. App migrations and removal of old package dependencies are a separate stage.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
