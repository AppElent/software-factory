---
type: record
kind: verification
description: Read for what the factory has done against real repos, and what it hasn't, as of 2026-11-06.
version: 1.0.0
date: 2026-11-06
---

# First real run

Revision `d52c3d1` on `v1` by commit times, with the blocked check from `c2da2fd`; macOS, real `gh` and `t3`. Supports: [Factory behaviour](../contracts/factory.md). Follow-up: #9, #15, #17.

## Findings

- **A real work order went end to end.** WO-1, a Chore, started in the New work order dialog, ran as a real T3 agent in a worktree, and opened PR #20 on this repo.
- **The wait for gates worked.** The repo had no CI on main at that time, so WO-1 waited 5 minutes for gates, then reached Review. GitHub lists no checks on PR #20: opened 13:47:37Z, merged 13:53:19Z.
- **The merge worked.** It went through the PR page. GitHub reports PR #20 merged, as `f3c4cb0`.
- **The read worked.** A real read of 4 repos: 27 listed, 2 skipped by a Never touch rule. Only the count went further.
- **Notifications are blocked on this Mac.** `terminal-notifier` exits 3 because notifications are turned off for it. A real delivery and click-to-open weren't verified.
- **Not covered:** a real Sentry error to a merged PR, a real project reaching green CI through the factory, and a real Toolkit sync.
