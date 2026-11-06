---
type: standard
kind: capability
description: Read when enabling or changing Dependabot, or reviewing automated dependency PRs.
version: 1.0.0
applies_to: [web, mobile, backend]
---

# Dependency updates

Dependabot delivers security fixes and routine bumps as small, reviewable PRs; agents handle majors and SDK-aligned upgrades as planned work.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- Enable Dependabot alerts and security updates on every repository.
- Version updates never propose majors. Majors and migrations go through the `upgrade-deps` skill and are discussed first.
- Packages whose versions an SDK selects (Expo: `expo`, `expo-*`, `@expo/*`, `react`, `react-dom`, `react-native`, `react-native-*`, `@react-native/*`, `jest-expo`, and SDK-pinned tooling) are ignored by version updates and upgraded with `expo install --fix`.
- Packages with a committed patch (`patchedDependencies`) are ignored by version updates.
- Every `ignore` entry names `update-types`; a bare `dependency-name` ignore also blocks security updates. Ignore majors in every ecosystem entry, GitHub Actions included.
- `cooldown.default-days` is at least the pnpm `minimumReleaseAge` (in days); otherwise proposed lockfiles fail frozen installs.
- Workflows that need Actions secrets skip Dependabot PRs (`github.event.pull_request.user.login != 'dependabot[bot]'`), or the needed values are added as Dependabot secrets. Never switch to `pull_request_target` to supply them.
- **Default:** weekly npm updates grouped by dependency type and minor/patch, at most 5 open PRs; monthly grouped GitHub Actions updates.
- **Default:** merge by hand after CI passes and the changelog is reviewed. Auto-merge, if adopted, covers only dev-dependency minor/patch groups behind required checks.

## Implementation

1. Enable alerts and security updates:
   `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts` and
   `gh api -X PUT repos/<owner>/<repo>/automated-security-fixes`.
   Enable **Grouped security updates** in Settings → Advanced Security; it has no REST endpoint.
2. Copy the [Dependabot template](dependency-updates/templates/dependabot.yml) to `.github/dependabot.yml` (project-owned). List each workspace directory, set the cooldown from `pnpm-workspace.yaml`, drop the Expo ignores for web-only apps, and add patched packages.
3. Guard secret-dependent PR workflows as above. Builds that read optional secrets (such as a source-map upload token) must still pass without them.
4. Note the Dependabot setup in the project's dependency-upgrade runbook.

## Verify

- `gh api repos/<owner>/<repo>/automated-security-fixes` reports `enabled: true`.
- After merge, the first run under Insights → Dependency graph → Dependabot completes without lockfile errors (Dependabot can trail new pnpm releases).
- The first Dependabot PR's CI passes, and secret-dependent jobs are skipped, not failed.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
