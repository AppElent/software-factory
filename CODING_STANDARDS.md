---
version: 4.6.0
description: Coding rules and task-specific implementation references.
---

# Coding standards

<!-- appelent-standards:start -->
## Shared guidance

Read only what the task needs; never preload every standard.

1. **Every code change:** [general coding](docs/standards/general-coding.md), plus [mobile coding](docs/standards/mobile-coding.md) for native code.
2. **When the task matches a row:** the linked standard.

| Task | Read |
| --- | --- |
| Adding, moving, or naming native files | [Mobile structure](docs/standards/mobile-structure.md) |
| Repository, package manager, formatter, types, tests, CI, or toolkit sync | [Baseline](docs/standards/baseline.md) |
| Top-level folders, workspace packages, or shared code between web, Convex, and mobile | [Repository layout](docs/standards/repo-layout.md) |
| Dependabot or automated dependency PRs | [Dependency updates](docs/standards/dependency-updates.md) |
| Web app stack, UI states, or browser capabilities | [Web baseline](docs/standards/web-baseline.md) |
| Expo setup, native configuration, builds, or releases | [Mobile baseline](docs/standards/mobile-baseline.md) |
| Getting a build onto a phone, TestFlight, or OTA updates | [Mobile distribution](docs/standards/mobile-distribution.md) |
| Verification | [Verification](docs/standards/verification.md), then the project's check commands |
| Environment variables and secrets | [Environments](docs/standards/environments.md) |
| Worktrees and isolated backends | [Workspaces](docs/standards/workspaces.md) |
| Authentication | [Auth](docs/standards/auth.md) |
| Convex functions, schema, migrations, seeds, tests, or account deletion and export | [Convex backend](docs/standards/convex.md) |
| Convex query reads, subscription retention, or local read caches | [Convex query caching](docs/standards/convex-query-caching.md) |
| Localization | [i18n](docs/standards/i18n.md) |
| Error reporting and source maps | [Sentry monitoring](docs/standards/sentry-monitoring.md) |
| In-app problem reports | [Issue reporting](docs/standards/issue-reporting.md) |
| Pull-request previews | [Previews](docs/standards/previews.md) |
| Staging or production deploys, deploy workflows, or branch rules | [Deployments](docs/standards/deployments.md) |
| Web manifest, installability, or service worker | [PWA](docs/standards/pwa.md) |
| Application CLI or browser login for it | [App CLI](docs/standards/app-cli.md) |
| MCP server or tools | [MCP](docs/standards/mcp.md) |
| Documentation or instruction changes | [Documentation](docs/standards/documentation.md) |
| Specialist tasks | [Specialist skills](docs/standards/specialist-skills.md) |

### Working with standards

- **Conform:** follow standards as written. Installed copies are never edited in the project.
- **Improve:** when a standard is wrong, unclear, or missing a rule other projects would share, propose the change upstream with the `developer-tools` skill: a pull request when concrete, an issue when not.
- **Differ:** when this project needs something else, discuss it with the user first; never deviate silently. Record the agreed exception below: rule, scope, replacement, reason.

Project decisions below select implementations and explain deviations from shared defaults.
<!-- appelent-standards:end -->

## Exceptions

| Rule | Scope | Replacement | Reason |
| --- | --- | --- | --- |
| [Web baseline](docs/standards/web-baseline.md): TanStack Start with file-based TanStack Router, generated route trees, on Cloudflare Workers | `src/web` | Code-based TanStack Router routes in `src/web/router.tsx`, in a Vite app the local service serves | It runs on one Mac behind loopback, with no server rendering or Workers ([ADR 0001](docs/adr/0001-local-service.md)), so Start adds nothing and a short route list needs no generator |
| [Web baseline](docs/standards/web-baseline.md): Base UI for accessible primitives | Dialogs and the command menu in `src/web` | `AlertDialog` and `Dialog` from `radix-ui`, `Command.Dialog` from `cmdk` | The approved [companion](designs/control-room/control-room_final.md#components) binds these. `cmdk`'s dialog is built on Radix, so this keeps one dialog family. Other controls stay native |
