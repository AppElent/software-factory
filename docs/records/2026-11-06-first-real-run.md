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

## Second real run: new project, failed gate, retry, merge

A private throwaway repo, `factory-sandbox`, went through the real flow on 2026-11-06, using the real `gh`, `t3`, and GitHub Actions.

| Step | Result |
| --- | --- |
| New project, Node template, through the API | All five steps passed. Repo private, added to T3 and to the factory |
| Scaffold CI | **Bug found.** The scaffold added no workflow, so gates never ran. The baseline step now writes `.github/workflows/ci.yml` |
| Bug fix work order: Intake to a real plan | 30 seconds. The `factory-plan` block parsed |
| Approve, Build, PR | 45 seconds. PR found by branch |
| First push fails CI | Detected, the retry sent with the log, gates went back to running on the new commit |
| Retry passes | Gates passed, Review, not the first try |
| Merge through the app | `--match-head-commit` accepted, GitHub says merged, then Ship and Observe |
| `t3 thread send`, then `show` | `running` immediately, so the engine can't read the previous reply as this turn's |

It also found three smaller things, all fixed: a job that stands for several gates reported a test failure as `Typecheck failed`, the failure log kept timestamps and terminal colours, and `Shipped` appeared before CI on main had started.

Still not exercised on real services: a Sentry error through to a merged fix, Merge without me, a real toolkit sync, delivered notifications.


## Two dependent work orders

A review found that work orders started from the folder's local `main`, which merges on GitHub never move. The fix fetches first and starts from that commit. Two Chore work orders then ran for real on the sandbox repo:

- WO-3 added a note file and merged as PR #2.
- WO-4 was told to stop if that file was missing. The folder's `main` was behind, but WO-4 found the file, added a line, and merged as PR #3.

T3 also confirmed two facts on this run:

- `--worktree <commit>` creates the branch with no upstream, so an agent's push can't reach the default branch by accident.
- A second thread on a branch that already exists ends with status `failed` and no worktree. Starting over after T3 loses a thread therefore takes a new branch.
