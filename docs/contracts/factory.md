---
type: contract
description: Read when changing how work orders move, what needs approval, what the queue ranks, or what the factory may touch.
version: 1.1.0
status: draft
---

# Factory behaviour

Draft until the first end-to-end work order runs. Screens and copy are in the [companion](../../designs/control-room/control-room_final.md).

## Work orders

`Intake → Plan → Build → Verify → Review → Ship → Observe`

- Sources: a person, a production error, a CI failure, a stale or conflicted PR, or toolkit drift.
- Observe watches for new errors after shipping. An error feeds a new work order back to Intake, carrying the earlier fix as context when it's a regression.
- Each work order has one worktree, branch, and T3 thread. One open work order per error fingerprint.
- The factory sends one stage per agent turn, so a hold takes effect at the next step.
- Closing a work order deletes its worktree and branch. The source error stays in the queue.
- Closing a PR keeps the branch on GitHub and closes its work order.

## Limits

- **Agents at once** (`N`, default 3, range 1 to 8) applies separately to Build and Verify, each shown as `x/N`.
- The shell's "agents working" count is Build's count.
- A work order leaves Intake when Build has room. Intake is first in, first out.
- **Pause new work when Review is full** is off by default, so PRs can pile up and Review shows a plain count. When it's on, Review shows `x/N`, and work also waits for Review to have room.
- A work order waiting on a question keeps its slot. A failed one keeps its Verify slot until it's retried or closed.
- A project that's paused or has no folder doesn't start work. Its orders wait in Intake and don't block others.

## Gates

Typecheck, Tests, Lint, Preview. Each is not started, running, passed, failed, or out of date.

- Failing triggers automatic retries (default 1, range 0 to 2), then the work order stops and needs you.
- Retrying with a note counts as a new retry and a miss for first try.
- Rebasing makes every gate out of date until it runs again. Merge requires all gates passed and no conflicts.

## Approvals

| Moment | Rule |
| --- | --- |
| Plan | Per work type. Defaults: Always for Bug fix and Feature, Skip for Toolkit sync and Chore |
| Merge | You, one PR at a time, with no dialog on the PR page. Bulk merge has a confirmation |
| New project | Each outside change is approved first, and each service is confirmed or skipped |
| Deleting anything outside the app | Named and confirmed. Never automatic |

### Merge without me

Off by default and built last.

- A work type **qualifies** after 10 or more finished runs, 80% or more first try, and no regressions in those runs. Thresholds are editable: runs 5 or more, first try 50 to 100%.
- Qualifying changes nothing. Merging stays yours until you turn it on for that work type.
- Once on: a PR with all four gates passed merges and ships alone, and shows on the floor. A project set to Always ask me is exempt.
- One regression turns it off for that work type.

## Stopping

- **Stop the line:** agents finish their step and hold, worktrees stay, nothing new starts, and PRs and errors keep updating. Merges and deploys already running continue. Restart needs no confirmation and resumes held agents.
- **Stop one work order:** same hold, for one. An immediate stop happens in T3.
- **Spend limit:** optional, default $25 a day when set. New work waits until tomorrow; running agents finish. Depends on [cost reporting](../../designs/control-room/control-room_final.md#open-runtime-questions).

## Queue

- **Needs you, in order:** production errors, agent questions and plans, red CI on main, gates failed after retries, PRs ready to merge.
- **Later:** stale PRs, PRs needing a rebase, toolkit behind, tools and services you skipped.
- Within a group: most users affected first, then oldest.
- **Snooze:** until tomorrow at 09:00. Wakes early at 100 events or a new release with users.
- **Dismiss:** returns only if it gets worse.
- A failing source shows as stale with its age, never as empty.

## Boundaries

- **Never touch:** matching repos and folders are filtered before any clone, read, or agent. The rules are private config outside this repo. Every listing starts by applying them, and tests cover it.
- **Removing** a project stops watching it. The repo, folder, and services stay. A project with open work orders can't be removed.
- **Diffs** stay on GitHub. The factory shows a summary, files, and size, and links out.
- **Notifications** go out through macOS, grouped within a minute, once per error and once per red main. The queue is the only inbox, and notifying only when the app isn't in front is on by default.
- **Audit log:** every outward-facing action records what, target, when, and who started it.
