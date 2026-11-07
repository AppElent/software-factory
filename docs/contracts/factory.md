---

type: contract
description: Read when changing how work orders move, what needs approval, what the queue ranks, or what the factory may touch.
version: 2.1.0
status: current
---

# Factory behaviour

Screens and copy are in the [companion](../../designs/control-room/control-room_final.md). What has run for real is in the [first real run](../records/2026-11-06-first-real-run.md).

## Work orders

`Intake → Plan → Build → Verify → Review → Ship → Observe`

- Sources: a person, a production error, a CI failure, a stale or conflicted PR, or toolkit drift.
- Observe watches for new errors after shipping. An error feeds a new work order back to Intake, carrying the earlier fix as context when it's a regression.
- An error is a regression when it's seen more than an hour after its fix merged, unless its latest event is from the release it was on when the fix merged, which means an old build is still running.
- Every merge names the commit its gates were read for, and refuses while the agent is changing the PR. A gate that fails or restarts during Review returns the work order to Verify.
- Observe traces an error to a work order when the error is untriaged, in the same project, and first seen after the merge.
- Each work order has one worktree, branch, and T3 thread. One open work order per error fingerprint.
- The factory sends one stage per agent turn, so a hold takes effect at the next step.
- Closing a work order deletes its worktree and branch. The source error stays in the queue. A step that fails is named in the activity, and nothing reports a delete that didn't happen.
- When a merged work order finishes Observe, the factory removes its worktree and local branch. When its PR is closed outside the factory, it removes only the worktree. A worktree with uncommitted changes stays, and the activity says so.
- Closing a PR keeps the branch on GitHub and closes its work order.
- A PR belongs to the work order whose branch it's on from the moment GitHub shows it, so merging refuses while that agent is still working, and while changes you asked for are waiting, failed, or never pushed. Try again or Close is the way past it.
- Closing a work order closes its PR first. If GitHub refuses, nothing else changes.
- Merging is refused when the factory hasn't read the project from GitHub for 15 minutes. Merge without me also waits for that, and for a paused project.

## Agents

- Native questions in T3 can't be answered over the CLI, so agents ask with `factory-question` blocks.
- If a native request appears anyway, the work order goes to `waiting_in_t3`, with `Open in T3`.
- Live output is the agent's assistant messages. Tool output stays in T3.
- Codex runs use `--provider codex --model $SF_CODEX_MODEL`, default `gpt-6.1-terra`, because T3 requires a model with a provider and has no list command.
- T3 exposes no cost source, so nothing shows cost. A plan `Estimate` keeps time only.

## Limits

- **Agents at once** (`N`, default 3, range 1 to 8) applies separately to Build and Verify, each shown as `x/N`.
- The shell's "agents working" count is Build's count.
- A work order leaves Intake when Build has room. Running plans count against that room, so a long Intake can't start every plan at once. Intake is first in, first out.
- **Pause new work when Review is full** is off by default, so PRs can pile up and Review shows a plain count. When it's on, Review shows `x/N`, and work also waits for Review to have room.
- A work order waiting on a question keeps its slot. A failed one keeps its Verify slot until it's retried or closed.
- A project that's paused or has no folder doesn't start work. Its orders wait in Intake and don't block others.

## Gates

Typecheck, Tests, Lint, Preview. Each is not set up, not started, running, passed, failed, or out of date.

- Failing triggers automatic retries (default 1, range 0 to 2), then the work order stops and needs you.
- Retrying with a note counts as a new retry and a miss for first try.
- A PR with no CI goes to Review after 5 minutes, with the activity line `No gates set up`.
- A check that ran on the commit before and hasn't reported on this one hasn't passed. Its gate reads not started for up to 5 minutes, and merging waits.
- Only a job named exactly `check`, `checks`, `verify`, or `ci` counts as typecheck, tests, and lint together. `build`, `EAS Build`, or `Spell check` passing proves none of them.
- A failing or running check with no gate of its own counts against Tests. A passing one is ignored. A cancelled or stale run counts as failed.
- `Try again` after T3 failed resends the same turn, plus any note. If T3 no longer has the thread, the work order starts over from Intake on a new branch, and any PR it had stays open as yours.
- A work order starts from the default branch's latest commit on origin, fetched first. If the fetch fails, the run fails and says so.
- Rebasing makes every gate out of date until it runs again. List rows and the page for a PR that needs a rebase or is stale show its gates as out of date.
- A stale PR uses the rebase page.
- A PR that falls behind again after its rebase finished goes back on the queue, and starting it sends the same agent another rebase turn.
- Merge requires no conflicts, and no gate failed, running, not started, or out of date. `Not set up` doesn't block a manual merge.

## Approvals

| Moment                            | Rule                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Plan                              | Per work type. Defaults: Always for Bug fix and Feature, Skip for Toolkit sync and Chore |
| Merge                             | You, one PR at a time, with no dialog on the PR page. Bulk merge has a confirmation      |
| New project                       | Each outside change is approved first, and each service is confirmed or skipped          |
| Deleting anything outside the app | Named and confirmed. Never automatic, except a finished work order's own clean worktree  |

### Merge without me

Off by default and built last.

- A work type **qualifies** after 10 or more finished runs, 80% or more first try, and no regressions in those runs. Thresholds are editable: runs 5 or more, first try 50 to 100%.
- Qualifying changes nothing. Merging stays yours until you turn it on for that work type.
- Once on: a PR with all four gates passed merges and ships alone, and shows on the floor. `Not set up` isn't passed. A project set to Always ask me is exempt.
- One regression turns it off for that work type.
- It merges only with all four gates passed and GitHub calling the PR `CLEAN`. It never merges a work order you stopped, or a rebase or requested change on a PR the factory didn't open. If GitHub refuses, it says so on the work order and doesn't ask again until a new commit.

### Modes

A mode is a way to start work: a prompt added before the work order's own instructions, a plan rule, who merges, and optionally a provider and model. Fix buttons run your default mode. Choosing another applies to that run only, and the next one starts on the default again.

- Modes live in the config file, with defaults built from the skills found on this Mac. The defaults work with no skills installed.
- A mode that merges on its own can't be the default. If an edit makes it so, the factory uses the first mode that doesn't.
- A work order keeps a copy of its mode, so editing a mode never changes work already running.
- A mode that merges does it through Review, so Stop the line and a failing gate hold it. It needs Typecheck, Tests and Lint passed, with Preview passed or not set up, and GitHub calling the PR `CLEAN`. Tests not set up means it waits and says why.
- Its agent is told not to merge. The factory merges, and the audit log names the mode.
- **Always yours, in every mode and setting:** changes to `.github/workflows/`, and on this app's own repo also `src/server/security.ts`, `src/shared/rules.ts` and `docs/adr/`. When the factory can't read which files changed, it waits and reads again.
- Starting a merging mode on a production error asks once more, and the server refuses it without that confirmation.
- Copy as command gives the same work as a `t3 thread start` command that runs without this app. Text from outside stays delimited as data, and can't end the command's quoted prompt.

### Config file

`~/.config/software-factory/config.json` holds what you'd want on a new Mac: settings, modes, environments and projects. It is plain JSON, written whole and readable only by you. It wins over older values in the database. A file that doesn't parse is never overwritten: saves refuse and say why until you fix it.

### New project

- The scaffold script is `scripts/new-project.mjs` in this repo, not the toolkit. Moving it upstream is a follow-up.
- `Remove what was created` needs `gh`'s `delete_repo` rights. Without them the removal fails, and the page says so.
- A red baseline still commits and pushes what it set up, so an agent's branch has CI. It offers `Start work order`, a new baseline run, which first pulls `main`, and `Remove what was created`. It has no `Open in T3`, because no thread exists yet.

## Stopping

- **Stop the line:** agents finish their step and hold, worktrees stay, nothing new starts, and PRs and errors keep updating. Merges and deploys already running continue. Restart needs no confirmation and resumes agents the line held.
- **Stop one work order:** same hold, for one. T3 has no CLI interrupt, so the copy says the agent stops at its next step. An immediate stop happens in T3.
- **Restart this work order** (Resume) lifts that hold. Restarting the line doesn't.

## Queue

- **Needs you, in order:** production errors, then agent questions, plans, and requests waiting in T3, then failed runs, red CI on main, gates failed after retries, and PRs ready to merge.
- A new project that failed or has a red baseline ranks with failed runs and opens its setup page.
- **Later:** stale PRs, PRs needing a rebase, toolkit behind, tools and services you skipped.
- Within a group: most users affected first, then oldest.
- **Snooze:** until tomorrow at 09:00. A snoozed error's release is read each time it gets a new event. Wakes early at 100 events or a new release with users.
- **Dismiss:** returns only if it gets worse.
- A failing source shows as stale with its age, never as empty.
- An error with an open work order doesn't show in the queue.
- A PR failing without a work order shows only in the PR list.
- Red main shows the failing check names and `Open the log`, with no log excerpt.

## Screens

- **Floor summary:** shipped this week, first try, and median to PR, nothing else.
- **Failed work order:** the banner says it stopped so it can't keep going. It doesn't cite money.
- **Queue and PR panes:** `In that release` and conflict-file counts are left out, because no source has them.
- **Health:** tiles cover 14 days. By-type counts are all-time. A work type under 5 runs says `Too few runs`.
- **Project:** last deploy is the latest shipped merge, with no provider, because there's no deploy connector. Services shows Sentry only. `Open in T3` is hidden with no thread. Connect Sentry takes a typed project name, and Change folder a typed path.
- **Settings:** Add projects is at `/settings/add-projects`.
- **First run:** reading warns about a missing Sentry link. The service has no EAS data.
- **Ages** are relative only.

## Boundaries

- **Never touch:** matching repos and folders are filtered before any clone, read, or agent. The rules are private config outside this repo. Every listing starts by applying them, and tests cover it. `/api/repos` and reading send only a count of skips, never names: `2 repos match a Never touch rule, so nothing in them was opened.` A folder rule covers everything beneath it, written as an absolute path, a `~/` path, or a relative one that matches anywhere in the path.
- **Removing** a project stops watching it. The repo, folder, and services stay. A project with open work orders can't be removed.
- **Diffs** stay on GitHub. The factory shows a summary, files, and size, and links out.
- **Notifications** go out through macOS, grouped within a minute, once per error and once per red main. The queue is the only inbox, and notifying only when the app isn't in front is on by default. `terminal-notifier` exit 3 means macOS blocks them, so `lastTest` is `ok`, `failed`, or `blocked`.
- **Audit log:** every outward-facing action records what, target, when, and who started it.
