---

type: contract
description: Read when changing how work orders move, what needs approval, what the queue ranks, or what the factory may touch.
version: 2.7.8
status: current
---

# Factory behaviour

Screens and copy are in the [companion](../../designs/control-room/control-room_final.md). What has run for real is in the [first real run](../records/2026-11-06-first-real-run.md).

## Work orders

`Intake → Plan → Build → Verify → Review → Ship → Observe`

- Sources: a person, a GitHub issue, a production error, a CI failure, a stale or conflicted PR, or toolkit drift.
- Observe watches for new errors after shipping. An error feeds a new work order back to Intake, carrying the earlier fix as context when it's a regression.
- An error is a regression when it's seen more than an hour after its fix merged, unless its latest event is from the release it was on when the fix merged, which means an old build is still running.
- Every merge names the commit its gates were read for, and refuses while the agent is changing the PR. A gate that fails or restarts during Review returns the work order to Verify.
- Observe traces an error to a work order when the error is untriaged, in the same project, and first seen after the merge.
- Each work order has one worktree, branch, and T3 thread. One open work order per error fingerprint.
- The factory sends one stage per agent turn, so a hold takes effect at the next step.
- Closing a work order deletes its worktree and branch. The source error stays in the queue. A step that fails is named in the activity, and nothing reports a delete that didn't happen.
- When a merged work order finishes Observe, the factory removes its worktree and local branch. When its PR is closed outside the factory, it removes only the worktree. A worktree with uncommitted changes stays, and the activity says so.
- Closing a PR keeps the branch on GitHub and closes its work order.
- A PR belongs to the work order whose branch it's on from the moment GitHub shows it, except picked-up work on a branch that isn't the factory's, so merging refuses while that agent is still working, and while changes you asked for are waiting, failed, or never pushed. Try again or Close is the way past it.
- Closing a work order closes its PR first. If GitHub refuses, nothing else changes. Picked-up work on a branch that isn't the factory's only closes the work order: the branch, its folder and any PR stay.
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
- Once on: a PR with all four gates passed merges alone, and shows on the floor. `Not set up` isn't passed. A project set to Always ask me is exempt.
- One regression turns it off for that work type.
- It merges only with all four gates passed and GitHub calling the PR `CLEAN`. It never merges a work order you stopped, or a rebase or requested change on a PR the factory didn't open. If GitHub refuses, it says so on the work order and doesn't ask again until a new commit.

### Modes

A mode is a way to start work: a prompt added before the work order's own instructions, a plan rule, who merges, and optionally a provider and model. Fix buttons run your default mode. Choosing another applies to that run only, and the next one starts on the default again.

- Modes live in the config file, with defaults built from the skills found on this Mac. The defaults work with no skills installed.
- A mode that merges on its own can't be the default. If an edit makes it so, the factory uses the first mode that doesn't.
- A work order keeps a copy of its mode, so editing a mode never changes work already running.
- A mode that merges does it through Review, so Stop the line and a failing gate hold it. It needs Typecheck, Tests and Lint passed, with Preview passed or not set up, and GitHub calling the PR `CLEAN`. A gate of those three not set up means it waits and says which.
- Its agent is told not to merge. The factory merges, and the audit log names the mode.
- **Always yours, in every mode and setting:** changes to `.github/workflows/`, and on this app's own repo also `src/server/security.ts`, `src/shared/rules.ts`, `docs/adr/`, `package.json`, the lockfile, `.npmrc` and `scripts/`. When the factory can't read which files changed, it waits and reads again. A PR with more files than GitHub lists waits for you.
- A PR from a fork is never a work order's, even when its branch has the same name, and the factory never merges one.
- Everything that stops a merge is read again after reading the file list, so Stop, Stop the line and a pause count right up to the merge.
- A config file that can't be read says so on every page. Until it's fixed, nothing merges on its own, and modes, environments and settings can show their defaults. Never touch rules can still be saved.
- Settings from before the config file move into it once, and leave the database.
- Starting a merging mode on a production error asks once more, and the server refuses it without that confirmation.
- Copy as command gives the same work as a `t3 thread start` command that runs without this app. Text from outside stays delimited as data, and can't end the command's quoted prompt.

### Leaving

This app can be stopped or deleted, and you lose little. Durable things live where they keep working without it.

| Thing | Where it lives |
| --- | --- |
| Settings, modes, environments, project list | The config file, plain JSON |
| Never touch rules | `never-touch.json`, next to the config file |
| Running agents and their threads | T3 |
| Branches, PRs, issues, deployments | GitHub |
| Errors | Sentry |
| Automations | T3 |

The database holds what can be read again, plus history. Deleting the data folder loses finished work orders, deploy history, the audit log, metrics, dismissals and snoozes, and which issues you've read.

- **Restore.** On a start with a database that has never held a project, projects come back from the config file. Never touch rules still apply. A database with rows, even removed ones, isn't touched.
- **Pick up.** Work orders come back from T3 when their thread title starts `WO-<number>`, the thread isn't settled, and it's still running or has an open PR on its `factory/wo-` branch. Finished work stays history. Picked-up work keeps its number and its thread, and never merges on its own, whatever mode it started in. On a `factory/wo-` branch, an open PR is its PR, however long before the pickup it opened. Otherwise a run only takes a PR opened after it started, or after the pickup, and never one from the default branch.
- **Numbers.** New work orders start above the highest number found in T3, so a new branch can't collide with an old one.
- **Copy as command.** Starting a work order and deploying both show the terminal command that does the same thing.

## Automations

Automations are T3's scheduled tasks. They live in T3 and keep running without this app. T3 has no command for them, so an agent thread reads and creates them with T3's own tools.

- **Read.** `Read again` starts one thread that lists tasks for the factory's projects only. It costs a model turn, so it runs when you press it and never on a timer. The last answer is kept to show, and only as a cache.
- **Create.** `Create in T3` starts a thread that calls T3 once. The prompt goes to it as delimited data, so the thread saves it and doesn't carry it out. A mode's prompt goes in front.
- **Schedules.** Every, at a time, or once. Webhook needs T3 Connect and can't be made here.
- **Failure.** A thread that finishes without confirming shows as not created, with a link to read it. T3 may still have the task, so check before trying again.

## Environments

An environment belongs to a project and lives in the config file: name, URL, health URL, deploy command, Sentry environment, issue label and whether it's production. The Sentry environment defaults to the lowercase name, and the issue label to `env:<name>`.

- **Health.** Every minute the factory asks each health URL. A 2xx or 3xx answer is up, and over 2 seconds is slow. One failed check is a blip. Two in a row is down. `Check now` tries twice straight away.
- **Deploy.** `Deploy` runs the saved command in the project's folder, in a shell, on what's checked out there. It doesn't fetch or pull, because that folder can hold your own work, so a fix merged on GitHub needs pulling first. The command comes from your config file, never from the repo or the page, and changing it needs the session token. Production asks you first. One deploy runs at a time per environment. The log streams to the page, scrubbed of secrets. `Stop deploy` signals the whole process group. A deploy times out after 30 minutes. A restart marks a running deploy failed and says the command may have kept running.
- **Stop the line** doesn't block a deploy you press. It stops agents, and a deploy is your own action.
- **Look in the repo** reads GitHub environments, `deploy:<env>` scripts, workflows with `workflow_dispatch` and wrangler config. It shows what it finds. Nothing runs or saves until you add it.
- **Queue.** A down production tops Needs you. Any other down environment goes under Later. Dismissing an outage holds until that environment goes down again.
- **Fix** starts a work order with the fingerprint `env:<project>:<name>`, and the health error and any failed deploy log as delimited data. A mode that merges on its own needs confirming on production.
- **What's deployed** is whichever finished last: the factory's own last passed deploy, or the successful GitHub deployment for that environment that finished last, among the five asked for most recently. Behind counts commits on the default branch since then.

## Issues

Open issues read from GitHub, in three groups. They stay out of the queue, because they ask for a decision and don't report damage.

| Group        | Means                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Needs a read | Someone outside the repo wrote it, and you haven't read this version                                   |
| Looks legit  | The owner, a member or a collaborator wrote it, or you've read this version                            |
| Looks off    | Someone outside wrote it, it has text aimed at an agent or hidden from view, and you haven't read this |

- The check runs on every read and uses no model. It looks at who wrote it, links, requests to run something, text aimed at an agent, and hidden text. A hit is a reason to read closely, never a verdict. Text is shown plain, with those passages underlined, so nothing is hidden by rendering.
- **The lock:** a mode that merges on its own won't start on an outsider's issue until you've read it. The server enforces this, and a read is pinned to a hash of the title and body. An edit on GitHub takes the read away, and the same is true of a snooze or dismissal: an edit brings the issue back.
- **An agent's read** is advice. You ask for it per issue, it runs in an empty folder so it has no project to act on, and nothing depends on it, least of all the lock. It's dropped when the issue is edited.
- The agent fixing an issue gets the title and body the factory read, as delimited data, up to 20,000 characters. The page names the issue and sends no text. Comments aren't included.
- In the command menu, `fix #12 full send`, `fix ledger #12`, `fix FAIRWAY-3K council` and `fix everything red with full stop` start work directly. A mode it can't find is reported and the default isn't used instead. A merging mode on a production error, or on everything red, asks once more.

### Config file

`~/.config/software-factory/config.json` holds what you'd want on a new Mac: settings, modes, environments and projects. It is plain JSON, written whole and readable only by you. It wins over older values in the database, except for projects: the database holds the current list, and that is written to the file. So a project edited by hand only counts on a new database. A file that doesn't parse is never overwritten: saves refuse and say why until you fix it.

### New project

- The scaffold script is `scripts/new-project.mjs` in this repo, not the toolkit. Moving it upstream is a follow-up.
- `Remove what was created` needs `gh`'s `delete_repo` rights. Without them the removal fails, and the page says so.
- A red baseline still commits and pushes what it set up, so an agent's branch has CI. It offers `Start work order`, a new baseline run, which first pulls `main`, and `Remove what was created`. It has no `Open in T3`, because no thread exists yet.

## Stopping

- **Stop the line:** agents finish their step and hold, worktrees stay, no new work starts, and PRs and errors keep updating. Asking about an issue and creating an automation are your own actions, so they still run. Merges and deploys already running continue. Restart needs no confirmation and resumes agents the line held.
- **Stop one work order:** same hold, for one. T3 has no CLI interrupt, so the copy says the agent stops at its next step. An immediate stop happens in T3.
- **Restart this work order** (Resume) lifts that hold. Restarting the line doesn't.

## Queue

- **Needs you, in order:** production errors, then agent questions, plans, and requests waiting in T3, then failed runs, red CI on main, security alerts past their deadline, gates failed after retries, and PRs ready to merge.
- A new project that failed or has a red baseline ranks with failed runs and opens its setup page.
- **Later:** stale PRs, PRs needing a rebase, toolkit behind, security setup that's off, tools and services you skipped.
- Within a group: most users affected first, then oldest.
- **Snooze:** until tomorrow at 09:00. A snoozed error's release is read each time it gets a new event. Wakes early at 100 events or a new release with users.
- **Dismiss:** returns only if it gets worse.
- A failing source shows as stale with its age, never as empty.
- An error with an open work order doesn't show in the queue.
- A PR failing without a work order shows only in the PR list.
- Red main shows the failing check names and `Open the log`, with no log excerpt.

## Security

Open Dependabot alerts and a setup checklist, read from GitHub with everything else. Severities are GitHub's: critical, high, moderate, low.

- **Deadlines.** Each severity has one, counted from when the alert opened. By default critical and high turn a project red right away, and moderate and low never do. Settings changes them, and a change applies on the next page load, without reading GitHub again.
- **Status.** Red: an alert is past its deadline. Amber: open alerts, or a setup item that's off. Green: neither. Not read yet: GitHub hasn't answered for it.
- **Setup:** Dependabot alerts, security updates, `.github/dependabot.yml`, and protection on the default branch, by a rule or an active ruleset. An item GitHub won't tell us about, often for lack of admin rights, is unknown and never counts as off. Security updates are read at most every 30 minutes, because they need one call per repo.
- **Alerts read:** the first 100 open ones per repo. The total comes from GitHub, so a project with more says how many are left on GitHub.
- **Turn on** sets alerts, then security updates, on GitHub. It asks first, and is logged. The dependabot.yml and branch protection need a change in the repo, so they go through a work order.
- **Fix in a work order** sends package names, versions and advisory IDs. Advisory text stays out, because anyone can write it.
- **Queue.** A project past a deadline ranks after red main in Needs you. Setup that's off goes under Later, after toolkit. Dismissing holds until the overdue alerts or the missing items change.

## Chosen projects

The project picker in the header of Queue, Floor, Pull requests, Issues, Errors, Environments, Security and Health narrows them to the projects ticked. None ticked means every project.

- The choice lives in `?projects=a,b` and in this browser, so it follows you between pages, survives reload and comes back on the next visit. A link with `?projects=` wins over what the browser remembers.
- A project that's gone is dropped from the choice.
- Queue items with no project, such as a skipped tool, always show.
- Nav counts stay factory-wide.
- **Health** narrows its tiles and days. By work type stays factory-wide, because merging without you is decided per work type, not per project.
- Slots on the Floor are shared, so their counts don't narrow.

## Improve yourself

A person writes a change, and it becomes an ordinary work order on the factory's own repo. Changes to security files wait for the owner in every mode, as they do on any repo.

- **Private names.** The repo may be public, so the text is checked first against private project names, Never touch rules, the home path, the username and the git email. Any match is named before anything is sent. The owner can still send it, because a project called `dashboard` shouldn't ban the word. The server refuses unconfirmed text as well.
- **Project.** The factory's repo is added when it isn't in yet. Running from a version folder, it gets a clone of its own, because version folders get replaced.

## Versions

Each version runs from its own folder, and `current` points at one. See ADR 0005.

- **Getting ready.** Every 10 minutes and on `Check for a new version`, the factory looks at the default branch. A repo a Never touch rule matches is left alone. A commit with red or unfinished checks waits, and so does one with no checks that the factory first saw under 5 minutes ago. Otherwise it's cloned, installed without install scripts or a pnpmfile and built in a new folder, then started on a spare port with sample data. All of it gets no tokens and a throwaway home folder. A version that's ready stays offered until a newer one is ready too. It must report its own commit and serve the page. A commit that fails stays failed on the timer. `Check for a new version` tries it again, because a failure can be the network's.
- **Updating.** Only by pressing `Update`, which reads the commit's checks again first. A running deploy blocks it, because the restart would cut the deploy off.
- **Going back.** A guard outside the service expects the new commit to answer within 90 seconds. If not, it switches back, marks the version failed, and restarts. `Roll back` switches to an older folder the same way. The running version and the two newest before it are kept.
- **Database.** Migrations stay additive, so an older version runs on a newer database. There are no backups.
- **Checkout.** A copy running from a checkout has no versions, and says how to get them.

## New device

The first page on a new Mac sets it up. It shows when there are no projects, or when projects just came back from the config file.

- **Tools.** `Install` runs the command listed for that tool, and nothing typed by anyone reaches it. `Sign in` opens that tool's login in Terminal, where it can ask questions. Neither happens without pressing the button.
- **Projects.** Projects from the config file show whether their folder is on this Mac. `Clone` adds the missing ones. It can be skipped, and work on that project waits for its folder.
- **Never touch** applies before any of this, as it does everywhere.

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
