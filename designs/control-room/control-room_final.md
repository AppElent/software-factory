# Control room: build companion

Build from this file. Use the boards as the visual reference.

| | |
| --- | --- |
| Status | Approved 2026-11-06 |
| Canvas | https://claude.ai/artifact/KPeYSx9hRhAgk9oeAVDc5F (private) |
| Deciding rounds | Canvas version 15 (round 1) and version 18 (round 2, final) |
| Board source | [`control-room_final/`](control-room_final/): 71 boards, one per state |
| Exact copy | [`control-room_copy.md`](control-room_copy.md) |
| Tokens | [`tokens.json`](tokens.json), [`tokens.css`](tokens.css) |
| Behaviour rules | [`docs/contracts/factory.md`](../../docs/contracts/factory.md) |
| Words | [`GLOSSARY.md`](../../GLOSSARY.md) |

**Not verified.** No board has been rendered in a browser. The checks were a source lint and a logic
smoke test that fired 348 handlers. Layout claims here, such as where the floor stops fitting, come from
calculation. Phase 5 compares each state on the running app with this file.

## Changes after hand-off

Decided while building. These win over the rest of this file, the boards, and the copy file. The boards and
[`control-room_copy.md`](control-room_copy.md) are hand-off snapshots, so they still show cost and the older copy.

- **Cost:** no cost UI anywhere, because T3 exposes no cost source. A plan `Estimate` keeps time only.
- **Questions:** native questions in T3 can't be answered over the CLI. Agents use `factory-question` blocks. A native request shows `waiting_in_t3` with `Open in T3`.
- **Stop:** there's no CLI interrupt, so Stop keeps its wording: `Stopping at the agent's next step.` A held work order has `Restart this work order` (Resume).
- **Live output:** the agent's assistant messages.
- **Never touch:** `/api/repos` and reading send only a count of skips, never names. `2 repos match a Never touch rule, so nothing in them was opened.`
- **Gates:** `Not set up` doesn't block a manual merge. Merge without me requires all four gates passed. A PR with no CI goes to Review after 5 minutes (`No gates set up`).
- **Intake:** running plans count against Build room for leaving Intake.
- **Queue:** errors with an open work order are hidden. PRs failing without a work order show only in the PR list.
- **Notifications:** the blocked state comes from `terminal-notifier`'s exit code 3. `lastTest` is `ok`, `failed`, or `blocked`.
- **New project:** the script is `scripts/new-project.mjs` in this repo, not upstream. Moving it to the toolkit is a follow-up. If `gh` has no `delete_repo` rights, Remove surfaces the failure.
- **Codex:** runs use `--provider codex --model $SF_CODEX_MODEL`, default `gpt-6.1-terra`, because T3 requires a model with a provider and has no list command.
- **Red main and PRs:** red main shows check names and `Open the log`, with no log excerpt. Stale PRs use the rebase page. Rebase and stale list rows show gates as out of date. `In that release` and conflict-file counts are dropped: no data source.
- **Floor:** the summary shows weekly shipped, first try, and median to PR only. The failed banner says "keep going" rather than citing money. Observe traces an untriaged error in the same project, first seen after the merge.
- **Project:** last deploy comes from the latest shipped merge, with no provider, because there's no deploy connector. Services shows Sentry only. `Open in T3` is hidden with no thread. Connect Sentry and Change folder are typed-entry dialogs: a Sentry project name and a folder path.
- **Health:** `Too few runs` under 5 runs. By-type counts are all-time, and tiles cover 14 days. HealthEarly's copy is corrected from "100% to 33%" to "100% to 67%".
- **Settings and setup:** Add projects is at `/settings/add-projects`. NLBaseline omits `Open in T3`, since no thread exists. NLScaffold's Prototype line isn't product copy. The FRReading warning uses Sentry, since the service has no EAS data. Ages use the relative format only.

## Reading a board

Each `.dc.html` is a template plus a small logic class. They run only on the canvas: `./support.js` is
served there and isn't in this repo.

- `{{hole}}` reads a value from `renderVals()`. `<sc-if value>` shows or hides. `<sc-for list as>` repeats.
- `this.state = {...}` is the state that board opens in. Boards that differ only by this are one screen
  in two states.
- The `<helmet>` CSS holds hover, focus, and phone-width rules. The inline styles are the layout.
- Links between boards stand for navigation. Use the routes below.

Names, numbers, paths, and times are sample data. Some sample data disagrees across boards, for example
WORun211 reuses Fairway's error text and PR #96's test count differs between WOReady and PRFix. Don't
reproduce it. `Open in T3` (`#t3`) and `Back up data` (`#backup`) are placeholders with real behaviour
below. Generator sources are in [`generator/`](generator/) for future rounds. They aren't app code.

## Routes

| Route | Screen | Boards |
| --- | --- | --- |
| `/` | Queue | Queue, QueueBack, QueueEmpty, QueueLimit, QueueLoading, QueueDegraded, QueueFirst |
| `/floor` | Floor | FloorBoard, FloorLimit, FloorReviewHold, FloorStopped, FloorLong; StopConfirm as a dialog |
| `/prs` | Pull requests | PullRequests, PullRequestsEmpty, PullRequestsBulk, PullRequestsBulkConfirm, PullRequestsBulkDone |
| `/prs/$project/$number` | PR review | PRFix, PRPassed, PRFailed, PRRebase, PRLong |
| `/errors` | Errors | ErrorsList, ErrorsEmpty, ErrorsBulk |
| `/errors/$id` | Error detail | ErrorNew, ErrorRegression, ErrorSnoozed |
| `/work-orders/$id` | Work order | WOPlan, WORunning, WORun211, WOReady, WOQuestion, WOFailed, WOStopped |
| `/projects` | Projects | Projects, ProjectsBulk, ProjectsBulkConfirm, ProjectsBulkDone |
| `/projects/$slug` | Project | ProjectDetail, ProjectPaused, ProjectBlockedRemove, ProjectQuiet, ProjectRemove, ProjectMissing, ProjectLong |
| `/projects/new/$step` | New project | NLDescribe, NLApprove, NLScaffold, NLFailed, NLBaseline, NLConnect, NLDone |
| `/health` | Health | Health, HealthEarly |
| `/settings/$section` | Settings | SettingsAgents, SettingsApprovals, SettingsNotifications, SettingsNotifyBlocked, SettingsProjects, SettingsTools |
| `/settings/notifications/samples` | Notification samples | NotifSamples |
| `/welcome/$step` | First run | FRTools, FRToolsBlocked, FRRepos, FRReading |
| Any route + `?new=work-order` | New work order dialog | NewWorkOrder |
| Global overlay | Command menu | CmdK, CmdKEmpty |
| Any route, service unreachable | Offline page | AppOffline |

Project names in PR, work order, and error headers link to `/projects/$slug`, and every Projects row
links to its project. The boards only link Fairway, labs, and roadmaps because only those have detail boards.
Filters such as the project select go in search params so they survive reload and Back.

First run shows when no project exists. Otherwise `/` loads the queue. Finishing `/welcome/reading` goes to `/` with the QueueFirst banner.

## Shell

From `shell()` in [`generator/lib.mjs`](generator/lib.mjs).

- **Navigation (216px, `bg-surface`):** wordmark, search button (`Search or run a command`, `⌘K`), Queue,
  Floor, Pull requests, Errors, Projects, Health. The footer holds Settings, two status lines, and Stop or
  Restart the line. Counts are mono. Current item: `aria-current="page"`, weight 600, `bg-active`.
- **Counts:** Queue = needs you + later; Floor = work orders in Plan through Ship; Pull requests = open;
  Errors = open; Projects = in the factory. Health has none.
- **Status lines:** line 1 is `N of M agents working`, `No agents working yet`, `Checking GitHub and Sentry`,
  or `Line stopped at HH:MM`. Line 2 is `Synced 1m ago`, or one line per source when they differ
  (`GitHub synced 1m ago`, `Sentry synced 38m ago`).
- **Stop the line:** text in `status-fail` in the footer on every page, except setup pages, which use their own layout.
- **Main:** `flex: 999 1 560px`. **Detail pane:** 340 to 380px, `bg-surface`, 20px padding, `<aside aria-label="Details">`.
- **Skip link** to `#main` is the first focusable element.

Setup pages (first run, new project) use `setup()`: wordmark and step rail on the left (240 to 280px), a
single 720px column on the right, and no navigation.

**Phone width (below 760px):** usable, not optimised. Navigation becomes a horizontally scrolling row without
wordmark, search, or status. The pane stacks under main. The Floor and stage strip scroll inside their own
region. The page itself never scrolls sideways. See QueueNarrow, FloorNarrow, ProjectNarrow,
PullRequestsNarrow, and SettingsNarrow on the canvas: same source at 390×844, so they aren't copied here.

## Components

Native controls are deliberate: checkboxes, radios, and selects stay native with `accent-color`, so they
need no library. Radix is only for what native can't do reliably.

| Component | Binding | Used by |
| --- | --- | --- |
| Button: primary, secondary, danger, danger fill | `<button>`, or `<a>` when it navigates. Heights 44, 36, 36, 44. One primary per view | All |
| Link | `.lnk`: underline in `border-input`, `text-primary` on hover | All |
| StatusGlyph | Inline SVG from `g()`: ask, run, pass, fail, err, idle, gp, gf, gr, gi. `aria-hidden`, always beside text | All |
| GateRow | Four square glyphs with `role="img"` and an `aria-label` naming each gate and state | Queue pane, Floor, PR list |
| GateList | Label and state per gate, in a pane | Work order, PR |
| StageStrip | Seven links with counts, `overflow-x: auto`, labelled `Stages` | Queue |
| StageTrack | Seven stages with current step, no counts | Work order |
| QueueRow | `<button aria-pressed>`, min height 44. Selected: `bg-raised` and `inset 2px 0 0 text-primary` | Queue |
| Banner | Glyph, title, body, actions. `role="alert"` or `"status"` by urgency | Many |
| Facts | `<dl>`, 96px label column, 12px | Panes |
| Breadcrumb | `<nav aria-label="Breadcrumb">`, `aria-current="page"` on the last item | Detail pages |
| ConfirmDialog | `AlertDialog` from `radix-ui`: Root, Portal, Overlay, Content, Title, Description, Cancel, Action | Below |
| FormDialog | `Dialog` from `radix-ui` | NewWorkOrder |
| InlineConfirm | Expands in place in the pane, no library | Stop work order, close PR, close work order, remove scaffold |
| CommandMenu | `Command.Dialog` from `cmdk` | CmdK |
| BulkBar | `role="region" aria-label="Bulk actions"`, sticky at `bottom: 16px`, count in `role="status"`, Clear | Projects, PRs, Errors |
| MetricTabs | `<button aria-pressed>` in a row, not ARIA tabs, because each only switches the chart below | Health |
| Histogram | Bars with `role="img"` and summary label, `title` per bar. `border-input`, or `status-fail` for the spike. Health adds a `<details>` table of daily numbers | Queue pane, Error, Health |
| DataTable | Real `<table>` | Projects, Health, Settings › Approvals |
| FloorColumn, FloorCard | `<section>` with label and count; card is a link, `bg-raised`, hover `bg-active` | Floor |
| Field, Choice | Label above control, hint below; radio or checkbox and label as one target | Forms |
| CodeBlock | `<pre>`, mono 12, `overflow-wrap: anywhere` | Commands, failures |
| Skeleton | Static `bg-raised` block. No shimmer, so reduced motion needs no special case | QueueLoading |
| NumberField | Ordinary entry per the number-fields standard: keep raw text, validate on blur, show the inline error, keep the value on a failed save | Agents at once, thresholds |

**Radix:** one package, `import { AlertDialog, Dialog } from "radix-ui"`. Set `onOpenAutoFocus` on Content so
focus lands on Cancel for destructive confirmations. Content handles the focus trap, Escape, and focus return.
For dialogs opened from something other than a Trigger, restore focus in `onCloseAutoFocus`.

**cmdk:** controlled `Command.Dialog` with `open`, `onOpenChange`, `label`, then `Command.Input`,
`Command.List`, `Command.Empty`, `Command.Group`, and `Command.Item`. Set `loop`. Pass aliases as `keywords`.
Everything in `Command.Empty` (the two no-results buttons) is reached with Tab, since arrow keys only move
through items. Live data (work orders, PRs) comes from the query cache; keep the default filter.

## Tokens

[`tokens.css`](tokens.css) is a Tailwind v4 `@theme` block generated from `tokens.json`. Import it after
`tailwindcss`. It clears the default palette (`--color-*: initial`), so a stray `bg-red-500` fails to build
a colour rather than sneaking in.

| Group | Utilities |
| --- | --- |
| Colour | `bg-bg-canvas`, `border-border-input`, `text-text-muted`, `bg-accent-solid`, `text-status-fail`. Names match `tokens.json` one to one, so the stutter is on purpose: grep finds both |
| Type | `text-page-title`, `text-detail-title`, `text-body`, `text-body-strong`, `text-meta`, `text-section-label`, `text-metric`, `text-data`. Each sets size, line height, and weight. Add `font-mono` for metric and data, and `uppercase` for section labels |
| Space | Tailwind's default 4px steps equal the system: `p-1` is 4, `p-6` is 24 |
| Radius | `rounded-sm` (6px), `rounded-md` (8px) |
| Heights | `h-control` (36), `h-action` (44), `min-h-row` (44) |
| Dialog | `bg-scrim`, `shadow-dialog` |

Root: `antialiased`, `bg-bg-canvas`, `text-text-primary`, `font-sans`, `tabular-nums` on metrics, data, and
ages. Fonts: IBM Plex Sans 400, 500, 600 and IBM Plex Mono 400, 500. Self-host the woff2 files, because a
strict CSP and a local tool shouldn't depend on Google Fonts. Focus: `:focus-visible` 2px `text-primary`
outline with a 2px offset. Hover: rows, nav, and secondary buttons `bg-raised`; cards `bg-active`; primary `brightness(1.08)`.

## States

"Not drawn" means no board shows it. These use existing patterns, and their copy is new: see [Not drawn](#not-drawn).

### Queue

The first row is selected and fills the pane. Clicking a row, or `j`/`k`, moves selection. Ranking is in the contract.

| State | When | Differs | Board |
| --- | --- | --- | --- |
| Populated | Items exist | `N need you · M can wait` | Queue |
| Pane by item kind | Selected row | Error, question, red CI, ready PR, stale PR, rebase, toolkit behind: each has its own pane | Queue (`sel`) |
| Back after time away | Last visit over 4 hours ago (proposed) | Summary line: shipped, failed, new errors; `See numbers`. Gone on next visit | QueueBack |
| First look | First visit after first run | Banner `Your first queue, ranked from N projects`, stage counts near zero | QueueFirst |
| Nothing needs you | No Needs you items | `Nothing needs you` panel with live counts, no pane; Later rows still show | QueueEmpty |
| Agents at limit | No start allowed under the slot rule | Pane says slots are busy, `Start work order` becomes `Add to Intake` | QueueLimit |
| Loading | First load only, no cached data | Skeleton rows, `Reading N projects` in `role="status"`; footer `Checking GitHub and Sentry` | QueueLoading |
| A source is failing | Source health not OK | `role="alert"` banner naming the source, its age, the fix command, and what's fine. Each source has its own sync line. Old items stay, never shown as empty | QueueDegraded |
| Snoozed or dismissed | `s`, `d`, or pane buttons | Row leaves, next row selected, `role="status"` note with Undo | Queue |
| Long title | Always possible | Row titles wrap, never truncate | QueueDegraded row 1 |
| Service down | Browser can't reach the service | Full page with the `launchctl kickstart` command and `Check again` | AppOffline |

Snooze: `Snoozed until tomorrow at 09:00.` Dismiss: `Dismissed. It comes back only if it gets worse.` Rows
that link out in QueueEmpty's Later list go to their own page; the pane is hidden there.

### Error detail

| State | When | Differs | Board |
| --- | --- | --- | --- |
| New | First seen, not fixed before | `New · first seen 3h ago` | ErrorNew |
| Regression | Fingerprint had a shipped fix | `Regression`, banner `This came back after a fix` with the old WO and PR; pane says old fix is context | ErrorRegression |
| Snoozed | Snooze active | Banner states the wake conditions, `Unsnooze` replaces Snooze and Dismiss, can still start a fix | ErrorSnoozed |
| Agents at limit | As in the queue | `Add to Intake`, same copy as QueueLimit | Not drawn |

Likely cause lists PRs in the release. `Open in Sentry` opens the issue URL.

### New work order

Dialog over the current page. Fields: project select, `What should change?`, work type radios. Empty text and
Start shows `Describe the change so the agent can plan it.` under the field and moves focus to it. Cancel
closes. Bug fix and Feature go to Plan, Chore skips it per plan-review settings. Toolkit sync isn't offered here: it starts from project rows. Copy on `Start work order` changes to `Add to Intake` when at limit.

### Work order

The track shows the current stage. The pane leads with one `role="status"` line, then the primary action,
gates, agent, worktree, and time.

| State | Status line | Actions | Board |
| --- | --- | --- | --- |
| Plan ready | `Plan ready for you` | Approve plan, Change plan, Reject plan, Open in T3 | WOPlan |
| Change plan | Same | Textarea and `Send to agent`; then `Agent is rewriting the plan. You'll see it here and in the queue.` | WOPlan (`change`, `sent`) |
| Running | `Agent working · 6m` | Stop this work order (inline confirm), Open in T3. Activity feed plus live output | WORunning, WORun211 |
| Stopping | `Stopping at the agent's next step.` | None | WORunning (`stopped`) |
| Question | `Waiting for your answer · 8m` | Agent's question, options, optional note, `Answer`; then `Answer sent. The agent is continuing.` | WOQuestion |
| Gate failed | `Tests failed twice` | Failure text, note for the agent, Retry with this note, Take over in T3, Close work order (inline confirm) | WOFailed |
| Line stopped | `Stopped with the line at 14:02` | Restart the line, Take over in T3 | WOStopped |
| PR ready | `PR #96 ready for you` | Review PR, Open in T3 | WOReady |

`Stop work order`, `Close work order`, and `Reject plan` go in the audit log. `Open in T3` opens the thread's
`link` from `t3 thread show --json`. Live output shows the agent's latest lines in a `<pre>`, and treats them as text only, never HTML. Output doesn't announce to screen readers; the Activity list and status line do.

### PR review

Works for any open PR, including ones without a work order, where the Work order row is absent.

| State | When | Primary | Board |
| --- | --- | --- | --- |
| Ready | All gates passed, no conflict | `Merge`, no dialog: this page is the review | PRFix, PRPassed |
| Merging | After click | Disabled `Merging…` | PRFix (`st`) |
| Merged | GitHub confirms | `Merged. Shipping to production now.` `See the floor` | PRFix (`st`) |
| Gate failed | Any gate failed | Banner with cause, `Open the log`; `Send back to the agent`; Merge absent | PRFailed |
| Needs rebase | Base moved or conflicts | Banner, gates `Out of date`, `Start rebase work order` | PRRebase |
| Running | Gates in progress | Merge absent, `Checks running` | Not drawn |

Request changes opens a textarea, then sends to the agent and re-runs gates. Close PR is an inline confirm
that keeps the branch. Diff lives on GitHub: `Open diff on GitHub` goes to the PR's files tab. Long titles, repos, and paths wrap with `overflow-wrap: anywhere`: PRLong.

### Floor

Seven columns: `minmax(140px,1fr)`, Ship when empty `minmax(88px,0.5fr)`, gap 8. Calculated to fit from about
1,240px, and below that the board scrolls in its own region. Summary link goes to Health. Project filter narrows cards.

| State | When | Differs | Board |
| --- | --- | --- | --- |
| Normal | Default | Build and Verify counts as `2/3`, Review as a plain count, cards show ID, age, title, project, status, gates | FloorBoard |
| Empty column | No cards | `Nothing here` | FloorBoard (Ship) |
| Build full | Build at limit | Column label `Full`, banner `Build is full` | FloorLimit |
| Review full | The pause setting is on and Review is at limit | Review shows `Full 3/3`, banner with `Review PRs` and `Change this` | FloorReviewHold |
| Stop confirm | Stop the line | Dialog listing agents affected, waiting, not affected | StopConfirm |
| Stopped | Line stopped | `role="alert"` banner, cards `Finishing its step`, footer Restart. Restart needs no confirmation | FloorStopped |
| Long text | Always possible | Card text wraps | FloorLong |
| Nothing at all | No work orders yet | All columns `Nothing here`, plus `New work order` in the header | Not drawn |

### Pull requests list

Groups, in order: Ready to merge, Gate failed, Running, Needs rebase, Stale. Empty groups are hidden. Only
Ready rows have a checkbox, and only when two or more are ready, since one is merged from its page
(PullRequestsBulkDone's lone checkbox is a leftover). Row: number, title, project, gates, size, age.

| State | When | Board |
| --- | --- | --- |
| Populated | | PullRequests |
| Filter with nothing | `Nothing open in {project}.` `Show all projects` | PullRequests (`pr`) |
| None | `No open pull requests` | PullRequestsEmpty |
| Several selected | BulkBar: `N selected`, Clear, `Merge N PRs` | PullRequestsBulk |
| Confirm | Dialog lists each PR, states merges go one at a time, ship as they merge, and can't be undone | PullRequestsBulkConfirm |
| Partly done | `2 merged. #31 couldn't merge.` Failed PR moves to Needs rebase, with `Start rebase work order` | PullRequestsBulkDone |

### Errors list

Grouped by project, each row with checkbox and link. Bulk: Snooze, Dismiss, `Start N work orders` with an Undo
note for the first two. A footer states coverage: `7 other projects have no open errors. 3 have no Sentry yet. Checked 1 minute ago.`

Boards: ErrorsList, ErrorsBulk, ErrorsEmpty (includes `Connect them in Projects`). Filter empties match the PR list.

### Projects list

A table, active projects first. Only projects behind on the toolkit have a checkbox and row `Sync`. `Select all`
scopes to those. Projects with Source (the toolkit repo) or Current have none.

| State | When | Board |
| --- | --- | --- |
| Populated | | Projects |
| Some selected | BulkBar: `N selected`, Clear, `Sync N projects` | ProjectsBulk |
| Confirm | Dialog lists each with its drift and states how many start and wait | ProjectsBulkConfirm |
| Started, one blocked | Status banner, rows `Sync started`, blocked row `Folder missing` with `Fix labs` | ProjectsBulkDone |
| Single row sync | No dialog: row becomes `Sync started` | Projects (`syncOne`) |

No drawn empty state, because first run requires at least one project and removal of the last is blocked by rule (see contract).

### Project detail

| State | When | Differs | Board |
| --- | --- | --- | --- |
| Active | Open work | Lists: work orders, PRs, errors, shipped recently | ProjectDetail |
| Quiet | Nothing open | `Nothing open`, `None open.` per list, toolkit banner, Connect Sentry | ProjectQuiet |
| Paused | Paused | Banner and Resume; new work waits in Intake, running work finishes | ProjectPaused |
| Can't remove | Open work orders exist | Dialog: `See work orders`, `Pause project` | ProjectBlockedRemove |
| Remove | Nothing open | Dialog states repo, folder, and services stay | ProjectRemove |
| Folder missing | `local_path` gone | `role="alert"`, `Clone it again`, `Change folder`, then cloning and back states. `Work orders can't start` | ProjectMissing |
| Long text | | Wrap: ProjectLong | ProjectLong |

Merging control: `Follow` (Settings) or `Always ask me`, per project.

### Health

Three metric buttons switch the chart. `Show daily numbers` opens the table. By-work-type table shows Runs,
First try, Median to PR, Merging. HealthEarly appears under 10 finished work orders. `Turn on`
opens the same dialog as Approvals. Non-numeric cells use `–`; the Merging cell uses `Too few runs`.

### Settings

Section nav in a sub-column. Changes save as made, with `Saved` in `role="status"`.

| Section | States | Board |
| --- | --- | --- |
| Agents | Limit error `Enter a whole number from 1 to 8.`; `Pause new work when Review is full`, off by default; retries 0 to 2; agent | SettingsAgents |
| Approvals | Table of plan review, record, and merging per work type; thresholds with errors `Enter 5 or more.` and `Enter 50 to 100.`; turn-on dialog; turn off | SettingsApprovals |
| Notifications | Allowed, checking, blocked; test; per-event checkboxes; only-when-away | SettingsNotifications, SettingsNotifyBlocked |
| Notification samples | How each reads and where it opens | NotifSamples |
| Projects | Clone folder; count and `Add projects`; Never touch rules with Add, Remove, Undo, empty, and error | SettingsProjects |
| Tools | One row per tool; signed out with command and `Check again`; This Mac; Restart service; Back up data | SettingsTools |

`Restart service` shows AppOffline until the service answers, then returns. `Back up data` copies the database
with `node:sqlite`'s backup and reveals the file in Finder. Add projects reuses the FRRepos list inside the shell. `Clicking one opens the item it names` means each notification opens its route.

### First run

| Step | States | Board |
| --- | --- | --- |
| Tools | Optional missing (Continue allowed); required missing (blocked, `Sign in to gh to continue.`); checking; fixed | FRTools, FRToolsBlocked |
| Projects | Search, select, clone, not on this Mac, no match, `Turn on at least one project to continue.`, skipped by rule | FRRepos |
| Reading | Progress per project in `role="status"`, warning for missing links, Open your queue once one project is read | FRReading |
| Queue | First look | QueueFirst |

Required: `gh`, and `t3` (not drawn missing; see below). Optional: `sentry`, `eas`, `wrangler`, `infisical`, `terminal-notifier`. Nothing outside the app changes during first run except clones you ask for.

### New project

| Step | States | Board |
| --- | --- | --- |
| Describe | Blank name, repo name taken, template, visibility (Private default) | NLDescribe |
| Approve | Plain list of outside changes, `Approve and create`, `Change something` | NLApprove |
| Scaffold | Live step log with times, can leave the page | NLScaffold |
| Scaffold failed | Failure text, `Retry this step`, inline confirm `Remove what was created` | NLFailed |
| Baseline red | Failure text, `Start work order`, `Open in T3` | NLBaseline |
| Connect | Per service: open, connecting, connected, skipped with Undo; note about reminders | NLConnect |
| Done | First idea, or `Skip for now`; first idea goes to Plan | NLDone |

If a tool for a service isn't installed, `Connect` is disabled and the row states the install command. The board leaves it enabled.

### Not drawn

New copy, following existing patterns. Review it with the first implementation of each.

| Case | Pattern | Copy |
| --- | --- | --- |
| Single merge fails | `role="alert"` Banner on the PR | `#96 couldn't merge.` + GitHub's reason + `Start rebase work order` if behind |
| A mutation fails | Inline `role="alert"` by the control; input kept | `Couldn't {verb} this. Try again.` |
| An agent run can't start | Work order status line, `role="alert"` | `T3 couldn't start this run.` + stderr in CodeBlock + `Try again`, `Open in T3` |
| Starting while stopped | Same as at-limit pane | `The line is stopped. This waits in Intake until you restart.` `Add to Intake` |
| Tab from an older build | `role="alert"` Banner | `This page is out of date.` `Reload` |
| `t3` missing at first run | Same row as `gh` in FRToolsBlocked | `Required. Agents run in T3.` |
| Project removal when it's the last | Same as can't remove | `{name} is your only project.` `Add a project first.` |

## Keyboard and screen readers

The canvas can't show these. They're required.

| Key | Where | Action |
| --- | --- | --- |
| `⌘K` | Everywhere | Toggle the command menu |
| `j` / `k` | Queue | Next and previous row, updates the pane |
| `↵` | Queue | Open the selected item's full page |
| `w` | Queue | Start work order on the selected row |
| `s` / `d` | Queue | Snooze, dismiss |
| `g` then `q f p e o h s` | Everywhere | Queue, Floor, Pull requests, Errors, Projects, Health, Settings |
| `n` | Everywhere | New work order |
| `Esc` | Dialogs, menu, inline confirms | Close and return focus |

Single-letter keys do nothing while focus is in an input, textarea, select, or dialog. All are listed in the
command menu or Queue footer. Every action also has a visible control.

- **Row selection:** roving focus. `aria-pressed` on the selected row; `Enter` on a focused row selects it, a second `Enter` opens it.
- **After removing a row:** focus moves to the next row, and the Undo note announces.
- **Dialogs:** focus moves in, background inert, Escape closes, focus returns to the opener. Destructive dialogs start on Cancel.
- **Inline confirms:** focus moves to the safe button. Keep returns it to the opener.
- **Live regions:** `role="status"` for progress and results, `role="alert"` only for blocks and failures. Render the empty region at mount so a later insert announces. Don't announce SSE row updates, only the shell's count change at most once a minute.
- **Validation:** error below the field, tied with `aria-describedby`, `aria-invalid`, focus moved to the first bad field.
- **Colour is never alone:** status always pairs with a glyph and text.
- **Table semantics:** header cells have `scope`, checkbox labels name the row.
- **Reduced motion:** the design has no motion beyond hover. Add none without a `prefers-reduced-motion` guard.
- **Zoom:** at 200% the app follows the phone-width layout.

## Runtime

Checked 2026-11-06 from npm and this Mac. Take versions from here unless the toolkit baseline says otherwise.

| Package | Version | Constraint |
| --- | --- | --- |
| Node | 26.9.0 | `node:sqlite` loads; stability level not checked |
| pnpm | 11.8.0 | Baseline `minimumReleaseAge: 4320` |
| typescript | `~6.0` | Baseline holds the 6.0 line. npm latest is 7.0.2: don't use it |
| react, react-dom | 19.2.3 or newer | Toolkit pins 19.2.3; npm latest 19.3.1 |
| vite | 8.3.6 | |
| @tanstack/react-router | 1.170.46 | |
| @tanstack/react-query | 5.106.1 | |
| tailwindcss | 4.3.4 | `@theme` tokens |
| radix-ui | 1.8.1 | Unified package |
| cmdk | 1.1.1 | |
| hono | 4.13.16 | `streamSSE`, with `@hono/node-server`; check its hostname option in ticket 01 |
| zod | 4.6.7 | Validates every CLI response |
| @biomejs/biome | 2.6.5 | Baseline fragment |
| vitest | 4.1.9 or 5.1.0 | Toolkit pins 4.1.9; take whichever works with the React plugin |
| terminal-notifier | 3.1.0 | Installed. Not yet sent a notification |

## API bindings

Proposed. Mutating routes need the session header and write to `audit_log` when outward-facing. Rules for
security are in [`docs/adr/0001-local-service.md`](../../docs/adr/0001-local-service.md).

| Screen | Route | Source |
| --- | --- | --- |
| All | `GET /api/events` (SSE: `changed` with keys for Query to invalidate, `health`, `line`) | Hono `streamSSE`; stop on `stream.aborted` |
| Shell, Queue | `GET /api/queue` → stages, needsYou, later, sources | SQLite, filled by connectors |
| Queue, Errors | `POST /api/triage` `{fingerprints, action: snooze, dismiss, undo}` | SQLite |
| Floor | `GET /api/floor?project=` | SQLite |
| Line | `POST /api/line` `{stopped}` | SQLite; no `t3` call |
| Work orders | `POST /api/work-orders`, `GET /:id`, `POST /:id/{approve, change, reject, answer, stop, retry, close}` | `t3 thread start --worktree --json`, `t3 thread send`, `t3 thread show --json` |
| PRs | `GET /api/prs?project=`, `GET /api/prs/:project/:n`, `POST …/{merge, request-changes, close}`, `POST /api/prs/merge` (bulk, sequential) | `gh api graphql`, `gh pr merge`, `gh pr checks --json` |
| Errors | `GET /api/errors?project=`, `GET /api/errors/:id` | `sentry` CLI; shapes unconfirmed |
| Projects | `GET /api/projects`, `GET /:slug`, `POST /:slug/{pause, resume, remove, clone, connect}`, `POST /api/projects/sync` | SQLite, `gh repo clone`, `sync-devtools --check` |
| New project | `POST /api/new-project`, `GET /:id`, `POST /:id/{retry, remove}` | Upstream `new-project.mjs` |
| Health | `GET /api/health?window=14d` | SQLite run history |
| Settings | `GET/PUT /api/settings/:section`, `GET /api/tools`, `POST /api/tools/check`, `POST /api/notifications/test` | SQLite, CLI `--version` and auth status, `terminal-notifier` |
| First run | `GET /api/repos` (rules applied first), `POST /api/projects` | `gh repo list` |

**Agent input:** Sentry text, issue and PR bodies, comments, and logs are untrusted. Pass them as delimited data, never as instructions. Render all such text as text. Never send secret values to the browser.

## Open runtime questions

Each resolves in the T3 spike or first use. None changes the screens above except where noted.

The [T3 spike](../../docs/records/2026-11-06-t3-spike.md) and the [first real run](../../docs/records/2026-11-06-first-real-run.md) hold the evidence.

1. **Cost source. Answered:** there's none, so cost fields, the Cost tab, and spend limit are gone.
2. **T3 runs. Answered:** worktree runs work. Exit 1 is a failed run, and exit 2 is a native question.
3. **Stopping one agent. Answered:** there's no CLI interrupt. `Stop` keeps its copy ("at its next step"), and immediate stop stays in T3.
4. **Live output. Answered:** the agent's assistant messages, from `t3 thread show`. Tool output stays in T3.
5. **Gates per project. Answered:** check-run names map to the four gates. A gate with no check says `Not set up`, which blocks merging without you but not a manual merge.
6. **Bulk merge can't be undone.** Accepted, with the dialog saying so. Confirm it's right once real.
7. **Notifications. Partly answered:** the blocked state is detected from `terminal-notifier`'s exit code 3, so SettingsNotifyBlocked's detection stays. Click-to-open is still unverified, because notifications are turned off for it on this Mac.
8. **EAS and Infisical auth.** Commands unconfirmed for the Tools rows.
9. **Sentry JSON shapes.** Unconfirmed: spike with recorded samples.
10. **Controls added during design:** Pause, Remove, agent choice. Approved, but drop any that use shows no need for.
11. **Native questions. Answered:** `send` can't answer them. Agents use `factory-question` blocks, and a native request shows `waiting_in_t3` with `Open in T3`.
