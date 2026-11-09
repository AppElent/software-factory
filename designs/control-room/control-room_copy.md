# Control room: exact copy

Every string on every final board, generated from the board source in `control-room_final/`.
Product copy is exact. Names, numbers, and paths are sample data: bind them to real values.

How to read it:

- `[Label] → Board` is a link. `[Label] on handler` is a button that changes state on the same board.
- `if x:` and `for x in y:` show when text appears. `{{x}}` is computed in that board's logic; its parts are under "Strings in logic".
- `|` separates pieces of text that sit in separate elements on one line.
- `(aria-label: …)`, `(placeholder: …)`, `(title: …)`, and `(role: …)` are attributes, not visible text.
- `(shell: …)` is the navigation footer status. The full navigation is in the companion.
- A diff lists what changes from the named board, and a "same copy" note means only the starting state differs.

Two prototype-only lines are not product copy: "Prototype only: jump ahead to when the agent finishes" on WORunning, and "Prototype: Connect services turns on when the baseline is green. See the failures: scaffold failed, baseline red." on NLScaffold.

## Queue

### Queue: Queue

Initial state: `{"sel":"r1","gone":{},"note":""}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Queue
{{summary}}
[New work order] → NewWorkOrder
(aria-label: Stages)
Intake
4
[] → FloorBoard
Plan
1
[] → FloorBoard
Build
2/3
[] → FloorBoard
Verify
1/3
[] → FloorBoard
Review
3
[] → FloorBoard
Ship
0
[] → FloorBoard
Observe
3
[] → FloorBoard
(aria-label: Needs you)
Needs you
if show.r1:
  [Fairway | TypeError reading 'holes' | Production error · 14 users | 3h] on pick.r1
if show.r2:
  [Foundry | Agent asks: keep the old migration? | WO-212 · Build | 8m] on pick.r2
if show.r3:
  [Gather | CI red on main: typecheck | GitHub Actions | 22m] on pick.r3
if show.r4:
  [Foundry | #168 Sync toolkit standards | All gates passed · ready to merge | 1h] on pick.r4
(aria-label: Later)
Later
if show.r5:
  [Gather | #127 Provider-backed task lists | Stale · no activity | 87d] on pick.r5
if show.r6:
  [Gather | #240 Export your data as JSON | Needs rebase | 18d] on pick.r6
if show.r7:
  [Arcade Club | Toolkit is behind | Sync available | 4d] on pick.r7
(role: status)
if hasNote:
  {{note}}
  [Undo] on undo
j k | move | ↵ | open | w | start work order | s | snooze | d | dismiss
(aria-label: Details)
if pane.r1:
  Fairway · production · fairway-web
  TypeError: Cannot read properties of undefined (reading 'holes')
  (aria-label: Events over the last 24 hours, rising sharply in the last 4 hours)
  41 events | 14 users | first seen 3h ago
  First release
  a1b2c3d
  Likely source
  src/rounds/score.ts:42
  In that release
  2 merged PRs
  Bug fix
  Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. The mode decides who merges.
  [Start work order] → WOPlan
  [Snooze] on snooze
  [Dismiss] on dismiss
  [Open full error] → ErrorNew
if pane.r2:
  Foundry · WO-212 · Build · waiting 8m
  Keep the old migration?
  Migration 0042 still reads sets_old | . Removing the table breaks a fresh install unless 0042 goes too.
  [Answer] → WOQuestion
  [Open work order] → WOQuestion
if pane.r3:
  Gather · main · GitHub Actions
  CI red on main: typecheck
  src/tasks/sync.ts(88,14): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Commit
  f81c0de
  Red for
  22 minutes
  Blocks
  3 open PRs
  [Start work order] → WOPlan
  [Snooze] on snooze
  [Dismiss] on dismiss
if pane.r4:
  Foundry · PR #168 · Toolkit sync
  Sync toolkit standards
  (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
  All 4 gates passed
  Size
  +214 −98 · 11 files
  Work order
  WO-207
  Cost
  $0.62
  [Review PR] → PRPassed
  [Snooze] on snooze
  [Dismiss] on dismiss
if pane.r5:
  Gather · PR #127 · stale 87 days
  Provider-backed task lists
  No commits or comments for 87 days. It conflicts with main in 6 files.
  [Start rebase work order] → PRRebase
  [Snooze] on snooze
  [Dismiss] on dismiss
if pane.r6:
  Gather · PR #240 · needs rebase
  Export your data as JSON
  Gates passed 18 days ago. main moved on, so they need to run again after a rebase.
  [Start rebase work order] → PRRebase
  [Snooze] on snooze
  [Dismiss] on dismiss
if pane.r7:
  Arcade Club · 4 days behind
  Toolkit is behind
  6 standards changed in developer-tools since the last sync.
  [Start sync work order] → FloorBoard
  [Snooze] on snooze
  [Dismiss] on dismiss
```

Strings in logic:

- inset 2px 0 0 #E6E8EB
-  need you · 
-  can wait
- Snoozed until tomorrow at 09:00.
- Dismissed. It comes back only if it gets worse.

### QueueBack: Queue: back after time away

Initial state: `{"sel":"r1","gone":{},"note":""}`

Changes from Queue (`-` removed, `+` added):

```diff
+Since yesterday at 18:20 | 3 shipped · 1 gate failed and needs you · 2 new errors · $4.10 spent
+[See numbers] → Health
```

### QueueEmpty: Queue: nothing needs you

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Queue
0 need you · 2 can wait
(aria-label: Stages)
Intake
2
[] → FloorBoard
Plan
0
[] → FloorBoard
Build
2/3
[] → FloorBoard
Verify
0/3
[] → FloorBoard
Review
0
[] → FloorBoard
Ship
1
[] → FloorBoard
Observe
3
[] → FloorBoard
(aria-label: Needs you)
Nothing needs you
2 agents are working and 1 change is shipping. New errors, questions, and ready PRs land here. The next check runs in 4 minutes.
[New work order] → NewWorkOrder
[See the floor] → FloorBoard
(aria-label: Later)
Later
[Gather | #240 Export your data as JSON | Needs rebase | 18d] → PRRebase
[Arcade Club | Toolkit is behind | Sync available | 4d] → Projects
```

### QueueLimit: Queue: agents at limit

Initial state: `{"sel":"r1","gone":{},"note":""}`

Changes from Queue (`-` removed, `+` added):

```diff
-(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
+(shell: 3 of 3 agents working · Synced 1m ago; footer Stop the line)
-2/3
+3/3
-  Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. The mode decides who merges.
-  [Start work order] → WOPlan
+  All 3 agent slots are busy. This waits in Intake and starts when a slot opens.
+  [Add to Intake] → FloorLimit
-  [Start work order] → WOPlan
+  [Add to Intake] → WOPlan
```

### QueueLoading: Queue: loading

```text
(shell: Checking GitHub and Sentry; footer Stop the line)
Queue
(aria-label: Needs you)
Needs you
(aria-label: Later)
Later
(role: status)
Reading 12 projects
(aria-label: Details)
```

### QueueDegraded: Queue: Sentry unreachable

Initial state: `{"sel":"r1","gone":{},"note":""}`

Changes from Queue (`-` removed, `+` added):

```diff
-(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
+(shell: 2 of 3 agents working · GitHub synced 1m ago · Sentry synced 38m ago; footer Stop the line)
+(role: alert)
+Sentry is out of date: errors are from 38 minutes ago | The sentry token expired. Run sentry auth login | , then check again. GitHub and T3 are fine.
+[Check again] → Queue
-  [Fairway | TypeError reading 'holes' | Production error · 14 users | 3h] on pick.r1
+  [Fairway | TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round | Production error · 14 users | 3h] on pick.r1
```

### AppOffline: Factory not running

```text
The factory isn't running
This page can't reach the local service on port 4310. Agents already working in T3 keep going, but nothing new starts and nothing here updates. Start the service, then check again.
launchctl kickstart gui/$UID/com.appelent.software-factory
[Check again] → Queue
```

## Error detail and new work

### ErrorNew: Error: new

Initial state: `{"snoozed":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Errors] → ErrorsList
/
[Fairway] → ErrorsList
/ | TypeError reading 'holes'
New · first seen 3h ago
TypeError: Cannot read properties of undefined (reading 'holes')
(aria-label: Event history)
Last 24 hours
(aria-label: Events over the last 24 hours, rising sharply in the last 8 hours)
41 events | 14 users | first seen 3h ago
(aria-label: Stack trace)
Stack trace
src/rounds/score.ts:42 const total = round.holes.reduce(addScore, 0) src/rounds/RoundSummaryCard.tsx:18 src/rounds/RoundPage.tsx:61 node_modules/react-dom/client.js:8234
(aria-label: Likely cause)
In release a1b2c3d
[#92 | Share a round with a link | +312 −40] → https://github.com/AppElent/golf-app/pulls
[#93 | Cache finished rounds | +88 −12] → https://github.com/AppElent/golf-app/pulls
(aria-label: Details)
Project
Fairway
Environment
production
First release
a1b2c3d
Likely source
src/rounds/score.ts:42
Sentry issue
FAIRWAY-W3
Bug fix
Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. The mode decides who merges.
[Start work order] → WOPlan
[Snooze] → ErrorSnoozed
[Dismiss] → ErrorsList
[Open in Sentry] → https://sentry.io
```

### ErrorRegression: Error: regression

Initial state: `{"snoozed":false}`

Changes from ErrorNew (`-` removed, `+` added):

```diff
-New · first seen 3h ago
+Regression · came back 3h ago
+This came back after a fix | WO-198 fixed it on 28 October in PR #88. It returned in release a1b2c3d.
+[Open PR #88] → https://github.com/AppElent/golf-app/pulls
-Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. The mode decides who merges.
+The new work order gets the old fix and its PR as context, so the agent starts from what already failed.
```

### ErrorSnoozed: Error: snoozed

Initial state: `{"snoozed":false}`

Changes from ErrorNew (`-` removed, `+` added):

```diff
-New · first seen 3h ago
+Snoozed until tomorrow at 09:00
+Snoozed until tomorrow at 09:00 | It returns to the queue sooner if it reaches 100 events or reaches users in a new release.
-Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. The mode decides who merges.
+You can start a fix while it is snoozed.
-[Snooze] → ErrorSnoozed
-[Dismiss] → ErrorsList
+[Unsnooze] → ErrorNew
```

### NewWorkOrder: New work order

Initial state: `{"text":"","err":false,"line":"bug"}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Queue
(role: dialog)
New work order
Project
<select>
Fairway
Foundry
Gather
Arcade Club
What should change?
(placeholder: Add a weekly summary to the workout history page)
<textarea value={{text}} on type>
if err:
  Describe the change so the agent can plan it.
Work type
<radio checked={{on.bug}} on pick.bug>
Bug fix | You approve the plan. It builds, checks, and opens a PR. |
<radio checked={{on.feature}} on pick.feature>
Feature | Same steps, with a longer plan to read first. |
<radio checked={{on.chore}} on pick.chore>
Chore | Skips the plan. For small, safe changes. |
[Cancel] → Queue
if ready:
  [Start work order] → WOPlan
if notReady:
  [Start work order] on fail
```

## Work order

### WOPlan: Work order: approve plan

Initial state: `{"change":false,"sent":false,"text":""}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-214
Fairway · WO-214 · Bug fix
Fix TypeError reading 'holes'
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
(aria-label: Plan)
Plan
Shared rounds load without their holes, because the cache added in PR #93 stores the round summary only. score.ts | then reads round.holes | on a summary.
Add a failing test that scores a round loaded from the share link.
Store holes with the cached round in src/rounds/cache.ts | .
Handle rounds already cached without holes by fetching them again.
Open a PR. Mark the Sentry issue as fixed in the next release.
Files
src/rounds/cache.ts, score.ts, cache.test.ts
Risk
Low. No schema change, and cached rounds refill themselves.
Estimate
$0.60 · about 25 minutes
Out of scope
The share link flow itself.
if change:
  What should change?
  (placeholder: Don't refetch. Clear the old cache entries instead.)
  <textarea>
  The agent rewrites the plan and asks you again.
  [Send to agent] on send
if sent:
  (role: status)
  Agent is rewriting the plan. You'll see it here and in the queue.
(aria-label: Details)
(role: status)
Plan ready for you
[Approve plan] → WORunning
[Change plan] on toggle
[Reject plan] → Queue
[Open in T3] → #t3
Gates
Typecheck | Not started
Tests | Not started
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-214-holes-typeerror
Time
2m 10s
Cost so far
$0.12
```

### WORunning: Work order: running

Initial state: `{"ask":false,"stopped":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-214
Fairway · WO-214 · Bug fix
Fix TypeError reading 'holes'
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
(aria-label: Activity)
Activity
Plan approved by you | 14:02
Created worktree and branch | 14:02
Wrote a failing test | 14:06
✕ scores a round loaded from the share link TypeError: Cannot read properties of undefined (reading 'holes')
Editing src/rounds/cache.ts | now
Run the gates | next
Open a PR | next
(aria-label: Live output)
Live output
[Open in T3] → #t3
✓ wrote src/rounds/cache.test.ts ✓ test fails as expected: round.holes is undefined → editing src/rounds/cache.ts storing holes with the cached round
Prototype only:
[jump ahead to when the agent finishes] → WOReady
(aria-label: Details)
(role: status)
Agent working · 6m
if notAsk:
  [Stop this work order] on askStop
if ask:
  Stop this work order?
  The agent stops at its next step. The worktree and branch stay, so you can restart or take over in T3.
  [Keep running] on keep
  [Stop work order] on stop
if stopped:
  (role: status)
  Stopping at the agent's next step.
Gates
Typecheck | Not started
Tests | Not started
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-214-holes-typeerror
Time
8m 40s
Cost so far
$0.31
```

### WOReady: Work order: PR ready

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-214
Fairway · WO-214 · Bug fix
Fix TypeError reading 'holes'
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
(aria-label: Activity)
Activity
Plan approved by you | 14:02
Wrote a failing test | 14:06
Stored holes with the cached round | 14:14
All 4 gates passed on the first try | 14:22
Opened PR #96 | 14:26
(aria-label: Details)
(role: status)
PR #96 ready for you
[Review PR] → PRFix
[Open in T3] → #t3
Gates
Typecheck | Passed
Tests | 180 passed
Lint | Passed
Preview | Passed
Agent
Claude in T3
Worktree
wo-214-holes-typeerror
Time
24m
Cost so far
$0.58
```

### WOQuestion: Work order: agent question

Initial state: `{"q":"a","done":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-212
Foundry · WO-212 · Bug fix
Remove legacy set table
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
if open:
  (aria-label: Agent question)
  Keep the old migration?
  Migration 0042 still reads sets_old | . Removing the table breaks a fresh install unless 0042 goes too. Production already ran 0042.
  Your answer
  <radio checked={{qa}} on pa>
  Squash 0001 to 0042 into a new baseline | The agent's suggestion. Fresh installs skip the old table. Production is unaffected. |
  <radio checked={{qb}} on pb>
  Keep 0042 and add 0043 to drop the table | Safest and smallest. Every install still creates the table first, then drops it. |
  <radio checked={{qc}} on pc>
  Stop here and leave the table | Closes the work order without changes. |
  Add a note (optional)
  <textarea>
if done:
  (role: status)
  Answer sent. The agent is continuing.
  [Back to the queue] → Queue
(aria-label: Activity)
Activity
Plan approved by you | 13:30
Removed models and queries for sets_old | 13:42
Asked a question | 13:49
(aria-label: Details)
(role: status)
Waiting for your answer · 8m
if open:
  [Answer] on send
[Open in T3] → #t3
Gates
Typecheck | Not started
Tests | Not started
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-212-remove-set-table
Time
19m
Cost so far
$0.74
```

### WOFailed: Work order: gate failed

Initial state: `{"ask":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-213
Arcade Club · WO-213 · Bug fix
Flaky leaderboard test
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
The agent tried once more and the same test failed | It stops after one retry so it can't keep spending. Your call on what happens next.
(aria-label: Failure)
Tests · 2 failed, 214 passed
✕ leaderboard › orders ties by time expected ['ana', 'bo'] to equal ['bo', 'ana'] src/leaderboard/rank.test.ts:58 ✕ leaderboard › keeps rank after refresh src/leaderboard/rank.test.ts:91
(aria-label: Retry)
Tell the agent what to try
(placeholder: The tie break should use finishedAt, not createdAt.)
<textarea>
Your note goes into the next attempt. This counts as a new retry.
(aria-label: Activity)
Activity
Build finished | 13:12
Tests failed | 13:15
Retry failed the same way | 13:24
(aria-label: Details)
(role: status)
Tests failed twice
[Retry with this note] → FloorBoard
[Take over in T3] → #t3
if notAsk:
  [Close work order] on askClose
if ask:
  Close WO-213?
  This deletes the worktree and the branch. The original error stays in the queue.
  [Keep it] on keep
  [Close work order] → FloorBoard
Gates
Typecheck | Passed
Tests | Failed twice
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-213-flaky-leaderboard
Time
31m
Cost so far
$1.12
```

### WOStopped: Work order: stopped

```text
(shell: Line stopped at 14:02 · Synced 1m ago; footer Restart the line)
(aria-label: Breadcrumb)
[Floor] → FloorStopped
/ | WO-211
Gather · WO-211 · Bug fix
Task sync retries twice
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
The line is stopped | This agent finished its step and stopped. It picks up from here when the line restarts. Its worktree and branch are untouched.
(aria-label: Activity)
Activity
Wrote a failing test | 13:50
Edited src/tasks/sync.ts | 13:59
Stopped before running the gates | 14:02
(aria-label: Details)
(role: status)
Stopped with the line at 14:02
[Restart the line] → FloorBoard
[Take over in T3] → #t3
Gates
Typecheck | Not started
Tests | Not started
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-211-sync-retries
Time
14m
Cost so far
$0.54
```

### WORun211: Work order: running (WO-211)

Initial state: `{"ask":false,"stopped":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Floor] → FloorBoard
/ | WO-211
Gather · WO-211 · Bug fix
Task sync retries twice
(aria-label: Stages)
Intake
Plan
Build
Verify
Review
Ship
Observe
(aria-label: Activity)
Activity
Plan approved by you | 14:02
Created worktree and branch | 14:02
Wrote a failing test | 14:06
✕ retries a failed sync once TypeError: Cannot read properties of undefined (reading 'holes')
Editing src/tasks/sync.ts | now
Run the gates | next
Open a PR | next
(aria-label: Live output)
Live output
[Open in T3] → #t3
✓ wrote src/tasks/sync.test.ts ✓ test fails as expected: retry ran 2 times → editing src/tasks/sync.ts storing holes with the cached round
(aria-label: Details)
(role: status)
Agent working · 12m
if notAsk:
  [Stop this work order] on askStop
if ask:
  Stop this work order?
  The agent stops at its next step. The worktree and branch stay, so you can restart or take over in T3.
  [Keep running] on keep
  [Stop work order] on stop
if stopped:
  (role: status)
  Stopping at the agent's next step.
Gates
Typecheck | Not started
Tests | Not started
Lint | Not started
Preview | Not started
Agent
Claude in T3
Worktree
wo-211-sync-retries
Time
14m
Cost so far
$0.54
```

## PR review

### PRFix: PR review: the fix

Initial state: `{"st":"idle","changes":false,"closing":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Pull requests] → PullRequests
/ | #96
Fairway · PR #96 · Bug fix
Fix TypeError reading 'holes'
if changes:
  What should change?
  <textarea>
  The agent pushes to this PR and the gates run again.
  [Send to agent] → FloorBoard
(aria-label: Summary)
What changed
Cached rounds now include their holes. Rounds cached before this change refetch once.
Adds a test that loads a round from a share link
Follows the approved plan with no changes
(aria-label: Files)
Files · +46 −9
[Open diff on GitHub] → https://github.com/AppElent/golf-app/pull/96/files
src/rounds/cache.ts | +18 −7 |
src/rounds/score.ts | +2 −2 |
src/rounds/cache.test.ts | +26 −0 |
(aria-label: Details)
All gates passed · ready to merge
if notMerged:
  if idle:
    [Merge] on merge
  if merging:
    [Merging…] (inert) disabled when busy
if merged:
  (role: status)
  Merged on GitHub.
  [See the floor] → FloorBoard
if notMerged:
  [Request changes] on toggle
  if notClosing:
    [Close PR] on askClose
  if closing:
    Close PR #96?
    The branch stays on GitHub. The work order closes.
    [Keep it] on keep
    [Close PR] → PullRequests
Gates
Typecheck | Passed
Tests | 216 passed
Lint | Passed
Preview | Passed
Work order
WO-214
Cost
$0.58
Age
4m
On GitHub
[AppElent/golf-app#96] → https://github.com/AppElent/golf-app/pull/96
```

### PRPassed: PR review: all gates passed

Initial state: `{"st":"idle","changes":false,"closing":false}`

Changes from PRFix (`-` removed, `+` added):

```diff
-/ | #96
-Fairway · PR #96 · Bug fix
-Fix TypeError reading 'holes'
+/ | #168
+Foundry · PR #168 · Toolkit sync
+Sync toolkit standards
-Cached rounds now include their holes. Rounds cached before this change refetch once.
-Adds a test that loads a round from a share link
-Follows the approved plan with no changes
+Brings Foundry up to the current developer-tools standards. Biome config moves to the shared preset. No app code changed.
+Replaces 3 local rules with the shared preset
+Updates the CI workflow to the shared action
-Files · +46 −9
-[Open diff on GitHub] → https://github.com/AppElent/golf-app/pull/96/files
-src/rounds/cache.ts | +18 −7 |
-src/rounds/score.ts | +2 −2 |
-src/rounds/cache.test.ts | +26 −0 |
+Files · +214 −98
+[Open diff on GitHub] → https://github.com/AppElent/workouts/pull/168/files
+biome.json | +12 −48 |
+.github/workflows/ci.yml | +34 −40 |
+docs/standards/README.md | +168 −10 |
-    Close PR #96?
+    Close PR #168?
-WO-214
+WO-207
-$0.58
+$0.62
-4m
+1h
-[AppElent/golf-app#96] → https://github.com/AppElent/golf-app/pull/96
+[AppElent/workouts#168] → https://github.com/AppElent/workouts/pull/168
```

### PRFailed: PR review: gate failed

Initial state: `{"st":"idle","changes":false,"closing":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Pull requests] → PullRequests
/ | #94
Fairway · PR #94 · Feature
Course search empty state
Preview build failed | The build can't find EXPO_PUBLIC_MAPS_KEY | . Merge stays off until the gate passes.
[Open the log] → https://github.com/AppElent/golf-app/actions
if changes:
  What should change?
  <textarea>
  The agent pushes to this PR and the gates run again.
  [Send to agent] → FloorBoard
(aria-label: Summary)
What changed
Shows a message and a clear-search action when a course search finds nothing.
(aria-label: Files)
Files · +88 −12
[Open diff on GitHub] → https://github.com/AppElent/golf-app/pull/94/files
src/courses/SearchResults.tsx | +62 −12 |
src/courses/SearchResults.test.tsx | +26 −0 |
(aria-label: Details)
Preview failed · can't merge yet
if notMerged:
  [Send back to the agent] → FloorBoard
if merged:
  (role: status)
  Merged on GitHub.
  [See the floor] → FloorBoard
if notMerged:
  [Request changes] on toggle
  if notClosing:
    [Close PR] on askClose
  if closing:
    Close PR #94?
    The branch stays on GitHub. The work order closes.
    [Keep it] on keep
    [Close PR] → PullRequests
Gates
Typecheck | Passed
Tests | 180 passed
Lint | Passed
Preview | Failed
Work order
WO-209
Cost
$1.40
Age
3h
On GitHub
[AppElent/golf-app#94] → https://github.com/AppElent/golf-app/pull/94
```

### PRRebase: PR review: needs rebase

Initial state: `{"st":"idle","changes":false,"closing":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Pull requests] → PullRequests
/ | #240
Gather · PR #240 · Feature
Export your data as JSON
main moved 41 commits ahead | The gates passed 18 days ago, so they no longer count. 3 files conflict. A rebase work order resolves them and runs the gates again.
if changes:
  What should change?
  <textarea>
  The agent pushes to this PR and the gates run again.
  [Send to agent] → FloorBoard
(aria-label: Summary)
What changed
Adds an export button in settings that downloads all your lists as a JSON file.
(aria-label: Files)
Files · +402 −31
[Open diff on GitHub] → https://github.com/AppElent/gather/pull/240/files
src/settings/ExportData.tsx | +180 −4 |
src/data/export.ts | +150 −0 |
src/data/export.test.ts | +72 −27 |
(aria-label: Details)
Needs rebase · 18 days behind
if notMerged:
  [Start rebase work order] → FloorBoard
if merged:
  (role: status)
  Merged on GitHub.
  [See the floor] → FloorBoard
if notMerged:
  [Request changes] on toggle
  if notClosing:
    [Close PR] on askClose
  if closing:
    Close PR #240?
    The branch stays on GitHub. The work order closes.
    [Keep it] on keep
    [Close PR] → PullRequests
Gates
Typecheck | Out of date
Tests | Out of date
Lint | Out of date
Preview | Out of date
Work order
WO-188
Cost
$2.15
Age
18d
On GitHub
[AppElent/gather#240] → https://github.com/AppElent/gather/pull/240
```

## Floor

### FloorBoard: Floor

Initial state: `{"pr":"All projects"}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Floor
[6 shipped today · 4 of 6 first try · 38m median to PR · $1.80 per change] → Health
Project
<select on pick>
All projects
Arcade Club
Fairway
Foundry
Gather
[New work order] → NewWorkOrder
(aria-label: Intake)
Intake
4
if vis.c1:
  WO-215
  Export rounds to CSV
  Fairway
  Idea · waiting
  [] → WOPlan
if vis.c2:
  WO-216
  Daily score reset
  Arcade Club
  Idea · waiting
  [] → WOPlan
if vis.c3:
  WO-217
  Sync toolkit standards
  Arcade Club
  Waiting
  [] → WOPlan
if vis.c4:
  WO-218
  Fix typecheck on main
  Gather
  Waiting
  [] → WOPlan
(aria-label: Plan)
Plan
1
if vis.c5:
  WO-214
  Fix TypeError reading 'holes'
  Fairway
  Approve plan
  [] → WOPlan
(aria-label: Build)
Build
2/3
if vis.c6:
  WO-212 | 19m |
  Remove legacy set table
  Foundry
  Agent asks a question
  [] → WOQuestion
if vis.c7:
  WO-211 | 14m |
  Task sync retries twice
  Gather
  Working
  [] → WORun211
(aria-label: Verify)
Verify
1/3
if vis.c8:
  WO-213 | 31m |
  Flaky leaderboard test
  Arcade Club
  Tests failed twice
  (aria-label: Typecheck passed, Tests failed, Lint not started, Preview not started)
  [] → WOFailed
(aria-label: Review)
Review
3
if vis.c9:
  #168 | 1h |
  Sync toolkit standards
  Foundry
  Ready to merge
  (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
  [] → PRPassed
if vis.c10:
  #94 | 3h |
  Course search empty state
  Fairway
  Preview failed
  (aria-label: Typecheck passed, Tests passed, Lint passed, Preview failed)
  [] → PRFailed
if vis.c11:
  #240 | 18d |
  Export your data as JSON
  Gather
  Needs rebase
  (aria-label: Typecheck not started, Tests not started, Lint not started, Preview not started)
  [] → PRRebase
(aria-label: Ship)
Ship
0
Nothing here
(aria-label: Observe)
Observe
3
if vis.c12:
  WO-208
  Faster workout list
  Foundry
  Shipped 2h ago · no new errors
  [] → Health
if vis.c13:
  FAIRWAY-W3
  TypeError reading 'holes'
  Fairway
  14 users
  [] → ErrorNew
if vis.c14:
  WO-206
  Share a round with a link
  Fairway
  Shipped 5h ago · caused 1 error
  [] → ErrorNew
```

Strings in logic:

- All projects
- Fairway
- Arcade Club
- Gather
- Foundry

### FloorLimit: Floor: at limit

Initial state: `{"pr":"All projects"}`

Changes from FloorBoard (`-` removed, `+` added):

```diff
-(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
+(shell: 3 of 3 agents working · Synced 1m ago; footer Stop the line)
+Build is full | Work orders wait in Intake and start when a slot opens.
-2/3
+Full | 3/3
+if vis.c20:
+  WO-219 | 3m |
+  Weekly summary
+  Foundry
+  Working
+  [] → WORun211
```

### FloorReviewHold: Floor: paused for review

Initial state: `{"pr":"All projects"}`

Changes from FloorBoard (`-` removed, `+` added):

```diff
+Review is full | New work waits in Intake until you review a PR. You turned this on in Settings.
+[Review PRs] → PullRequests
+[Change this] → SettingsAgents
-3
+Full | 3/3
```

### StopConfirm: Stop the line: confirm

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Floor
(role: dialog)
Stop the line?
Agents already working finish the step they’re on, then hold. Their worktrees stay as they are. To stop one right away, open it in T3. Nothing new starts until you restart.
Agents affected
WO-211, WO-212
Waiting
4 in Intake, 1 in Plan
Not affected
Merged PRs and deploys already running
[Cancel] → FloorBoard
[Stop the line] → FloorStopped
```

### FloorStopped: Floor: line stopped

Initial state: `{"pr":"All projects"}`

Changes from FloorBoard (`-` removed, `+` added):

```diff
-(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
+(shell: Line stopped at 14:02 · Synced 1m ago; footer Restart the line)
+(role: alert)
+Line stopped at 14:02 | Nothing new starts. 2 agents are finishing the step they’re on, then they hold. PRs and errors keep updating.
+[Restart the line] → FloorBoard
-  Working
-  [] → WORun211
+  Finishing its step
+  [] → WOStopped
```

## Health and command menu

### Health: Health

Initial state: `{"tab":"shipped","ask":false,"on":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Health
Last 14 days |
[Shipped | 31 | last 14 days] on tabs.shipped
[First-try | 71% | 22 of 31] on tabs.first
[Median to PR | 38m | was 52m] on tabs.time
[Cost per change | $1.80 | was $2.40] on tabs.cost
(aria-label: Chart)
{{title}}
(aria-label: {{summary}})
for b in bars:
  (title: {{b.tip}})
for b in bars:
  {{b.tick}}
{{summary}}
Show daily numbers
for b in bars:
  {{b.day}}
  {{b.val}}
(aria-label: By work type)
By work type
Work type
Runs
First try
Median to PR
Cost per change
Merging
Bug fix
14
12 of 14
31m
$1.40
if notAlone:
  Can merge without you
  [Turn on] on askOn
if alone:
  Merges without you
Feature
9
5 of 9
54m
$3.10
Needs you
Toolkit sync
6
5 of 6
12m
$0.60
Needs you
Chore
2
–
9m
$0.30
Too few runs
A work type qualifies after 10 runs with at least 80% passing every gate on the first try and no regressions. Nothing changes until you turn it on.
[Change this in Settings] → SettingsApprovals
if ask:
  (role: dialog)
  Let bug fixes merge without you?
  When all 4 gates pass, a bug-fix PR merges without you. You still see it on the floor, and any new error goes back to Intake. If a bug fix causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.
  [Cancel] on keep
  [Turn on] on turnOn
```

Strings in logic:

- Shipped
- last 14 days
- First-try
- Median to PR
- was 52m
- Cost per change
- was $2.40
-  per day
- , last 14 days. Latest 
- . Highest 

### HealthEarly: Health: too little data

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Health
3 work orders so far |
Too little data to trust yet | Numbers show after 10 finished work orders, because 3 runs can swing from 100% to 67% on one failure. 7 to go.
[See finished work orders] → FloorBoard
Shipped | 3 | so far
First-try | – | Not enough runs
Median to PR | – | Not enough runs
Cost per change | – | Not enough runs
Until then, every merge waits for you.
```

### CmdK: Command menu

Initial state: `{"q":""}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Queue
(aria-label: Search or run a command)
(role: dialog)
(aria-label: Search or run a command)
(placeholder: Search or run a command)
<search value={{q}} on type>
if some:
  if gv.Goto:
    Go to
    if vis.i0:
      [Queue | g q] → Queue
    if vis.i1:
      [Floor | g f] → FloorBoard
    if vis.i2:
      [Pull requests | g p] → PullRequests
    if vis.i3:
      [Errors | g e] → ErrorsList
    if vis.i4:
      [Projects | g o] → Projects
    if vis.i5:
      [Health | g h] → Health
    if vis.i9:
      [Settings | g s] → SettingsAgents
  if gv.Actions:
    Actions
    if vis.i6:
      [New work order | n] → NewWorkOrder
    if vis.i7:
      [New project] → NLDescribe
    if vis.i8:
      [Sync 4 projects behind on the toolkit] → ProjectsBulk
    if vis.i10:
      [Stop the line] → StopConfirm
  if gv.Work:
    Work
    if vis.i11:
      [WO-212 Remove legacy set table] → WOQuestion
    if vis.i12:
      [WO-214 Fix TypeError reading holes] → WOPlan
    if vis.i13:
      [#168 Sync toolkit standards] → PRPassed
    if vis.i14:
      [#240 Export your data as JSON] → PRRebase
if none:
  (role: status)
  No results for ‘{{q}}’.
  [New work order from this] → NewWorkOrder
  [Clear search] on clear
↑ ↓ | move | ↵ | open | esc | close
```

Strings in logic:

- Go to
- Queue
- Floor
- Pull requests
- Errors
- Projects
- Health
- Actions
- New work order
- New project
- Sync 4 projects behind on the toolkit
- Settings
- Stop the line
- Work
- WO-212 Remove legacy set table
- WO-214 Fix TypeError reading holes

### CmdKEmpty: Command menu: no results

Initial state: `{"q":"deploy gather"}`

Same copy as CmdK; differs only by its starting state above.

Strings in logic:

- deploy gather

## Project detail

### ProjectDetail: Project: Fairway

Initial state: `{"paused":false,"ask":false,"merge":"follow","cloning":false,"cloned":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Projects] → Projects
/ | Fairway
Fairway
1 plan and 2 errors need you
[Open in T3] → #t3
[GitHub] → https://github.com/AppElent/golf-app
[Start work order] → NewWorkOrder
if paused:
  (role: status)
  Paused | New work orders for this project wait in Intake. Work already running finishes.
  [Resume] on resume
(aria-label: Work orders · 2)
Work orders · 2
[WO-214 | Fix TypeError reading 'holes' | Plan · waiting on you | 4m |] → WOPlan
[WO-215 | Export rounds to CSV | Intake · idea] → WOPlan
(aria-label: Pull requests · 1)
Pull requests · 1
[#94 | Course search empty state | Preview failed | 3h |] → PRFailed
(aria-label: Errors · 2)
Errors · 2
[FAIRWAY-W3 | TypeError reading 'holes' | New · 14 users | 3h |] → ErrorNew
[FAIRWAY-R1 | NetworkError fetching course list | Regression · 5 users | 1d |] → ErrorRegression
(aria-label: Shipped recently)
Shipped recently
[WO-206 | Share a round with a link | Caused 1 error | 5h |] → ErrorNew
[WO-203 | Faster course search | No new errors | 2d |] → Health
(aria-label: Details)
Repo
[AppElent/golf-app] → https://github.com/AppElent/golf-app
Folder
~/Developer/golf-app
Branch
main
Toolkit
Current
Last deploy
5h ago · EAS
Last 30 days
Shipped
11
First try
8 of 11
Median to PR
41m
Cost per change
$1.60
Services
Sentry | fairway-web
EAS | Connected
Infisical
[Connect] → NLConnect
Merging
<radio checked={{follow}} on setFollow>
Follow
[Settings] → SettingsApprovals
<radio checked={{always}} on setAlways>
Always ask me
if running:
  [Pause project] on pause
[Remove from factory] on askOn
if ask:
  (role: dialog)
  Fairway can't be removed yet
  It has 2 open work orders. Close them first, or pause the project so nothing new starts.
  [Cancel] on keep
  [See work orders] → FloorBoard
  [Pause project] on pause
```

### ProjectPaused: Project: paused

Initial state: `{"paused":true,"ask":false,"merge":"follow","cloning":false,"cloned":false}`

Same copy as ProjectDetail; differs only by its starting state above.

### ProjectBlockedRemove: Project: can't remove yet

Initial state: `{"paused":false,"ask":true,"merge":"follow","cloning":false,"cloned":false}`

Same copy as ProjectDetail; differs only by its starting state above.

### ProjectQuiet: Project: nothing open, behind on the toolkit

Initial state: `{"paused":false,"ask":false,"merge":"follow","cloning":false,"cloned":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Projects] → Projects
/ | roadmaps
roadmaps
Nothing open
[Open in T3] → #t3
[GitHub] → https://github.com/AppElent/roadmaps
[Start work order] → NewWorkOrder
if paused:
  (role: status)
  Paused | New work orders for this project wait in Intake. Work already running finishes.
  [Resume] on resume
69 days behind on the toolkit | 14 standards changed in developer-tools since the last sync.
[Start sync work order] → FloorBoard
(aria-label: Work orders)
Work orders
None open.
(aria-label: Pull requests)
Pull requests
None open.
(aria-label: Errors)
Errors
Sentry isn't connected, so errors can't show here.
[Connect Sentry] → NLConnect
(aria-label: Shipped recently)
Shipped recently
Nothing shipped through the factory yet.
(aria-label: Details)
Repo
[AppElent/roadmaps] → https://github.com/AppElent/roadmaps
Folder
~/Developer/roadmaps
Branch
main
Toolkit
69 days behind
Last deploy
None
Services
Sentry
[Connect] → NLConnect
Deploys | None set up
Infisical
[Connect] → NLConnect
Merging
<radio checked={{follow}} on setFollow>
Follow
[Settings] → SettingsApprovals
<radio checked={{always}} on setAlways>
Always ask me
if running:
  [Pause project] on pause
[Remove from factory] on askOn
if ask:
  (role: dialog)
  Remove roadmaps from the factory?
  The factory stops watching it. Your GitHub repo, local folder, and services stay as they are. You can add it back from Settings.
  [Cancel] on keep
  [Remove project] → Projects
```

### ProjectRemove: Project: confirm removal

Initial state: `{"paused":false,"ask":true,"merge":"follow","cloning":false,"cloned":false}`

Same copy as ProjectQuiet; differs only by its starting state above.

### ProjectMissing: Project: folder missing

Initial state: `{"paused":false,"ask":false,"merge":"follow","cloning":false,"cloned":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Projects] → Projects
/ | labs
labs
Work orders can't start
[Open in T3] → #t3
[GitHub] → https://github.com/AppElent/labs
[Start work order] → NewWorkOrder
if paused:
  (role: status)
  Paused | New work orders for this project wait in Intake. Work already running finishes.
  [Resume] on resume
if needClone:
  (role: alert)
  labs isn't in its folder | It was at ~/Developer/labs and is gone now. Agents work from this copy, so nothing can start until it is back. The repo is safe on GitHub.
  [Clone it again] on clone
  [Change folder] → SettingsProjects
if cloning:
  (role: status)
  Cloning AppElent/labs
  [Cloning…] (inert) disabled when busy
if cloned:
  (role: status)
  labs is back | Now cloned to ~/Developer/labs. You can start work orders again.
  [Start sync work order] → FloorBoard
(aria-label: Work orders)
Work orders
None open.
(aria-label: Pull requests)
Pull requests
None open.
(aria-label: Errors)
Errors
Sentry isn't connected.
(aria-label: Details)
Repo
[AppElent/labs] → https://github.com/AppElent/labs
Folder
~/Developer/labs
Branch
main
Toolkit
41 days behind
Last deploy
None
Services
Sentry
[Connect] → NLConnect
Deploys | None set up
Merging
<radio checked={{follow}} on setFollow>
Follow
[Settings] → SettingsApprovals
<radio checked={{always}} on setAlways>
Always ask me
if running:
  [Pause project] on pause
[Remove from factory] on askOn
if ask:
  (role: dialog)
  Remove labs from the factory?
  The factory stops watching it. Your GitHub repo stays as it is. You can add it back from Settings.
  [Cancel] on keep
  [Remove project] → Projects
```

## Projects list and bulk sync

### Projects: Projects

Initial state: `{"sel":{},"ask":false,"done":null}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Projects
{{sub}}
if canAll:
  [{{allLabel}}] on selectAll
if none:
  [New project] → NLDescribe
if some:
  [New project] → NLDescribe
if hasDone:
  (role: status)
  {{doneTitle}} | {{doneBody}}
  if hasBad:
    [Fix labs] → ProjectMissing
  [See the floor] → FloorBoard
Select
Project
Work orders
PRs
Errors
Toolkit
Last deploy
[Fairway] → ProjectDetail
golf-app
2
1
2
Current |
5h ago · EAS
Foundry
workouts
1
2
0
Current |
2h ago · EAS
Gather
gather
2
3
1
Current |
1d ago · Cloudflare
if idle.p3:
  (aria-label: Select Arcade Club)
  <checkbox checked={{sel.p3}} on tog.p3>
Arcade Club
games
3
1
0
if idle.p3:
  4 days behind
  [Sync] on syncOne.p3
if started.p3:
  [Sync started] → FloorBoard
if failed.p3:
  [Folder missing] → ProjectMissing
3d ago · Cloudflare
developer-tools
0
0
–
Source |
–
if idle.p5:
  (aria-label: Select labs)
  <checkbox checked={{sel.p5}} on tog.p5>
[labs] → ProjectMissing
0
0
–
if idle.p5:
  41 days behind
  [Sync] on syncOne.p5
if started.p5:
  [Sync started] → FloorBoard
if failed.p5:
  [Folder missing] → ProjectMissing
–
if idle.p6:
  (aria-label: Select satisfactory)
  <checkbox checked={{sel.p6}} on tog.p6>
satisfactory
0
0
0
if idle.p6:
  69 days behind
  [Sync] on syncOne.p6
if started.p6:
  [Sync started] → FloorBoard
if failed.p6:
  [Folder missing] → ProjectMissing
69d ago · Cloudflare
if idle.p7:
  (aria-label: Select roadmaps)
  <checkbox checked={{sel.p7}} on tog.p7>
[roadmaps] → ProjectQuiet
0
0
–
if idle.p7:
  69 days behind
  [Sync] on syncOne.p7
if started.p7:
  [Sync started] → FloorBoard
if failed.p7:
  [Folder missing] → ProjectMissing
–
appelent-skills
0
0
–
Current |
–
appelent-packages
0
0
–
Current |
–
agent-plugins
0
0
–
Current |
–
workout-tracker
0
0
–
Current |
–
if some:
  (aria-label: Bulk actions)
  (role: region)
  (role: status)
  {{n}} selected
  [Clear] on clear
  [{{syncLabel}}] on askOn
if ask:
  (role: dialog)
  {{askTitle}}
  for x in chosen:
    {{x.n}} | {{x.tk}}
  {{slots}}
  [Cancel] on keep
  [{{startLabel}}] on start
```

Strings in logic:

- Arcade Club
- Select 
-  behind
- Sync 
-  project
-  projects
- Start 
-  sync work orders?
- Start work order
-  work orders
- Each runs on its own worktree and opens a PR for you to merge. 1 agent slot is free, so 
-  starts now and 
-  waits
-  wait
-  in Intake.
- it starts now.
-  sync work order started
-  sync work orders started
- , labs couldn't start
-  in Intake. 
- Their PRs land in Pull requests.
-  labs isn't in its folder on this Mac.
-  behind on the toolkit

### ProjectsBulk: Projects: behind ones selected

Initial state: `{"sel":{"p3":true,"p5":true,"p6":true,"p7":true},"ask":false,"done":null}`

Same copy as Projects; differs only by its starting state above.

### ProjectsBulkConfirm: Projects: confirm the sync

Initial state: `{"sel":{"p3":true,"p5":true,"p6":true,"p7":true},"ask":true,"done":null}`

Same copy as Projects; differs only by its starting state above.

### ProjectsBulkDone: Projects: sync started, one blocked

Initial state: `{"sel":{},"ask":false,"done":{"ok":["p3","p6","p7"],"bad":["p5"]}}`

Same copy as Projects; differs only by its starting state above.

## Pull requests list and bulk merge

### PullRequests: Pull requests

Initial state: `{"pr":"All projects","sel":{},"gone":{},"ask":false,"note":""}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Pull requests
{{sub}}
Project
<select value={{pr}} on pickP>
All projects
Arcade Club
Fairway
Foundry
Gather
if gv.ready:
  (aria-label: Ready to merge)
  Ready to merge · {{gc.ready}}
  if vis.a:
    #168 | Sync toolkit standards | Foundry
    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
    [+214 −98 | | 1h |] → PRPassed
if gv.failed:
  (aria-label: Gate failed)
  Gate failed · {{gc.failed}}
  if vis.b:
    #94 | Course search empty state | Fairway
    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview failed)
    [+88 −12 | | 3h |] → PRFailed
if gv.run:
  (aria-label: Running)
  Running · {{gc.run}}
  if vis.c:
    #101 | Retry failed sync once | Gather
    (aria-label: Typecheck passed, Tests running, Lint not started, Preview not started)
    [+22 −9 | | 6m |] → WORun211
  if vis.d:
    #61 | Daily score reset | Arcade Club
    (aria-label: Typecheck passed, Tests passed, Lint running, Preview not started)
    [+140 −6 | | 12m |] → WORun211
if gv.rebase:
  (aria-label: Needs rebase)
  Needs rebase · {{gc.rebase}}
  if vis.e:
    #240 | Export your data as JSON | Gather
    (aria-label: Typecheck not started, Tests not started, Lint not started, Preview not started)
    [+402 −31 | | 18d |] → PRRebase
  if vis.f:
    #118 | Add support code for Foundry Ops | Foundry
    (aria-label: Typecheck not started, Tests not started, Lint not started, Preview not started)
    [+96 −4 | | 40d |] → PRRebase
if gv.stale:
  (aria-label: Stale)
  Stale · {{gc.stale}}
  if vis.g:
    #127 | Provider-backed task lists | Gather
    (aria-label: Typecheck not started, Tests not started, Lint not started, Preview not started)
    [+1204 −311 | | 87d |] → PRRebase
if noneShown:
  (role: status)
  Nothing open in {{pr}}.
  [Show all projects] on allP
```

Strings in logic:

- All projects
- Foundry
- Fairway
- Gather
- Arcade Club
-  open in 
-  project
-  projects

### PullRequestsEmpty: Pull requests: none open

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Pull requests
0 open |
No open pull requests
PRs from your work orders and from anyone else on GitHub show up here, grouped by what they need.
[New work order] → NewWorkOrder
```

### PullRequestsBulk: Pull requests: several selected

Initial state: `{"pr":"All projects","sel":{"a":true,"h":true,"i":true},"gone":{},"ask":false,"note":""}`

Changes from PullRequests (`-` removed, `+` added):

```diff
+    (aria-label: Select PR #168)
+    <checkbox checked={{sel.a}} on tog.a>
+  if vis.h:
+    (aria-label: Select PR #62)
+    <checkbox checked={{sel.h}} on tog.h>
+    #62 | Sync toolkit standards | Arcade Club
+    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
+    [+96 −41 | | 9m |] → PRPassed
+  if vis.i:
+    (aria-label: Select PR #31)
+    <checkbox checked={{sel.i}} on tog.i>
+    #31 | Sync toolkit standards | satisfactory
+    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
+    [+302 −117 | | 7m |] → PRPassed
+  if vis.j:
+    (aria-label: Select PR #12)
+    <checkbox checked={{sel.j}} on tog.j>
+    #12 | Sync toolkit standards | roadmaps
+    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
+    [+188 −64 | | 4m |] → PRPassed
+if some:
+  (aria-label: Bulk actions)
+  (role: region)
+  (role: status)
+  {{n}} selected
+  [Clear] on clear
+  [{{mergeLabel}}] on askOn
+if ask:
+  (role: dialog)
+  {{askTitle}}
+  for x in chosen:
+    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
+    {{x.label}}
+  All 4 gates passed on each one. They merge one at a time. If one can't merge, it stays open and the rest continue. You can't undo a merge from here.
+  [Cancel] on keep
+  [{{mergeLabel}}] → PullRequestsBulkDone
```

Strings in logic:

- Merge 
-  PR
-  PRs
-  PR?
-  PRs?

### PullRequestsBulkConfirm: Pull requests: confirm merging

Initial state: `{"pr":"All projects","sel":{"a":true,"h":true,"i":true},"gone":{},"ask":true,"note":""}`

Same copy as PullRequestsBulk; differs only by its starting state above.

### PullRequestsBulkDone: Pull requests: merged, one blocked

Initial state: `{"pr":"All projects","sel":{},"gone":{},"ask":false,"note":""}`

Changes from PullRequests (`-` removed, `+` added):

```diff
+(role: status)
+2 merged. #31 couldn't merge. | Foundry #168 and Arcade Club #62 are merged on GitHub. satisfactory moved on while #31 waited, so it needs a rebase.
+[Start rebase work order] → PRRebase
+[See the floor] → FloorBoard
-  if vis.a:
-    #168 | Sync toolkit standards | Foundry
+  if vis.j:
+    (aria-label: Select PR #12)
+    <checkbox checked={{sel.j}} on tog.j>
+    #12 | Sync toolkit standards | roadmaps
-    [+214 −98 | | 1h |] → PRPassed
+    [+188 −64 | | 4m |] → PRPassed
+  if vis.i:
+    #31 | Sync toolkit standards | satisfactory
+    (aria-label: Typecheck not started, Tests not started, Lint not started, Preview not started)
+    [+302 −117 | | 7m |] → PRRebase
+if some:
+  (aria-label: Bulk actions)
+  (role: region)
+  (role: status)
+  {{n}} selected
+  [Clear] on clear
+  [{{mergeLabel}}] on askOn
+if ask:
+  (role: dialog)
+  {{askTitle}}
+  for x in chosen:
+    (aria-label: Typecheck passed, Tests passed, Lint passed, Preview passed)
+    {{x.label}}
+  All 4 gates passed on each one. They merge one at a time. If one can't merge, it stays open and the rest continue. You can't undo a merge from here.
+  [Cancel] on keep
+  [{{mergeLabel}}] → PullRequestsBulkDone
```

Strings in logic:

- Merge 
-  PR
-  PRs
-  PR?
-  PRs?

## Errors list and bulk

### ErrorsList: Errors

Initial state: `{"pr":"All projects","sel":{},"gone":{},"ask":false,"note":""}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Errors
{{sub}}
Project
<select value={{pr}} on pickP>
All projects
Arcade Club
Fairway
Foundry
Gather
if gv.fairway:
  (aria-label: Fairway)
  Fairway · {{gc.fairway}}
  if vis.a:
    (aria-label: Select TypeError reading 'holes')
    <checkbox checked={{sel.a}} on tog.a>
    [TypeError reading 'holes' | New | 41 events | | 14 users | | 3h |] → ErrorNew
  if vis.b:
    (aria-label: Select NetworkError fetching course list)
    <checkbox checked={{sel.b}} on tog.b>
    [NetworkError fetching course list | Regression | 12 events | | 5 users | | 1d |] → ErrorRegression
if gv.gather:
  (aria-label: Gather)
  Gather · {{gc.gather}}
  if vis.c:
    (aria-label: Select Task sync timed out)
    <checkbox checked={{sel.c}} on tog.c>
    [Task sync timed out | Snoozed | 6 events | | 2 users | | 2d |] → ErrorSnoozed
if noneShown:
  (role: status)
  Nothing open in {{pr}}.
  [Show all projects] on allP
(role: status)
if hasNote:
  {{note}}
  [Undo] on undo
7 other projects have no open errors. 3 have no Sentry yet. Checked 1 minute ago.
if some:
  (aria-label: Bulk actions)
  (role: region)
  (role: status)
  {{n}} selected
  [Clear] on clear
  [Snooze] on snooze
  [Dismiss] on dismiss
  [{{startLabel}}] → FloorBoard
```

Strings in logic:

- All projects
- Fairway
- TypeError reading 'holes'
- NetworkError fetching course list
- Gather
- Task sync timed out
-  error.
-  errors.
-  open in 
-  project
-  projects
- Start work order
- Start 
-  work orders
- Snoozed
- Dismissed

### ErrorsEmpty: Errors: none open

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Errors
0 open |
No open errors
Sentry reports nothing new in 9 connected projects. Checked 1 minute ago.
3 projects have no Sentry yet.
[Connect them in Projects] → Projects
```

### ErrorsBulk: Errors: two selected

Initial state: `{"pr":"All projects","sel":{"a":true,"b":true},"gone":{},"ask":false,"note":""}`

Same copy as ErrorsList; differs only by its starting state above.

## Settings

### SettingsAgents: Settings: agents

Initial state: `{"limit":"3","saved":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Settings
(aria-label: Settings sections)
[Agents] → SettingsAgents
[Approvals] → SettingsApprovals
[Notifications] → SettingsNotifications
[Projects] → SettingsProjects
[Tools] → SettingsTools
Agents
Changes save as you make them and apply to the next work order.
Agents at once
<text value={{limit}} on type>
Work orders past this limit wait in Intake. From 1 to 8.
if bad:
  Enter a whole number from 1 to 8.
<checkbox on mark>
Pause new work when Review is full | Review is full when as many PRs wait for you as agents at once. New work then waits in Intake until you review one. |
Automatic retries
<select on mark>
0
1
2 When a gate fails, the agent tries this many more times before it asks you.
Agent
<select on mark>
Claude in T3
Codex in T3 Used for new work orders. Each run gets its own worktree.
Daily spend limit
<text value=$25 on mark>
At this amount, new work waits until tomorrow. Running agents finish. Leave it empty for no limit.
if saved:
  (role: status)
  Saved
```

### SettingsApprovals: Settings: approvals

Initial state: `{"on":false,"ask":false,"saved":false,"runs":"10","pct":"80"}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Settings
(aria-label: Settings sections)
[Agents] → SettingsAgents
[Approvals] → SettingsApprovals
[Notifications] → SettingsNotifications
[Projects] → SettingsProjects
[Tools] → SettingsTools
Approvals
What needs your approval, by type of work. You approve every merge until you turn that off here.
(aria-label: By work type)
Work type
Plan review
First-try record
Merging
Bug fix
(aria-label: Plan review for Bug fix)
<select on mark>
Always
Skip
12 of 14
if off:
  You merge. Qualifies.
  [Merge without me] on askOn
if on:
  Merges without you
  [Turn off] on turnOff
Feature
(aria-label: Plan review for Feature)
<select on mark>
Always
Skip
5 of 9
You merge
Needs 1 more run and 80% first try. Now 56%.
Toolkit sync
(aria-label: Plan review for Toolkit sync)
<select on mark>
Always
Skip
5 of 6
You merge
Needs 4 more runs.
Chore
(aria-label: Plan review for Chore)
<select on mark>
Always
Skip
2 of 2
You merge
Needs 8 more runs.
(aria-label: When a work type qualifies)
When a work type qualifies
Finished runs, at least
<text value={{runs}} on typeRuns>
if runsBad:
  Enter 5 or more.
First try, at least (%)
<text value={{pct}} on typePct>
if pctBad:
  Enter 50 to 100.
First try means every gate passed without a retry. A work type also needs no regressions in those runs: no error that came back after its fix shipped, and no new error traced to one of its PRs.
Qualifying changes nothing by itself. Merging stays yours until you turn it on. One regression turns it off again.
(aria-label: Projects that always ask you)
Projects that always ask you
None. Set this on a
[project’s page] → ProjectDetail
. Use it for projects with few tests, where passing gates prove less.
if saved:
  (role: status)
  Saved
if ask:
  (role: dialog)
  Let bug fixes merge without you?
  When all 4 gates pass, a bug-fix PR merges without you. You still see it on the floor, and any new error goes back to Intake. If a bug fix causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.
  [Cancel] on keep
  [Turn on] on turnOn
```

### SettingsProjects: Settings: projects

Initial state: `{"rules":["client-*"],"draft":"","err":false,"removed":"","saved":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Settings
(aria-label: Settings sections)
[Agents] → SettingsAgents
[Approvals] → SettingsApprovals
[Notifications] → SettingsNotifications
[Projects] → SettingsProjects
[Tools] → SettingsTools
Projects
Which of your GitHub repos the factory can see, and where it keeps them.
Clone folder
<text value=~/Developer on mark>
New clones go here. Projects already cloned stay where they are.
12 of 26 repos are in the factory.
[Add projects] → FRRepos
(aria-label: Never touch)
Never touch
Repos and folders that match are never cloned, read, or given to an agent. Use * as a wildcard.
for x in rules:
  {{x.r}}
  [Remove] on x.remove
if none:
  Nothing is excluded, so the factory can see every repo.
if hasRemoved:
  (role: status)
  Removed {{removed}}.
  [Undo] on undo
Add a pattern
(placeholder: client-*)
<text value={{draft}} on type>
[Add] on add
if err:
  Enter a repo name or pattern.
if saved:
  (role: status)
  Saved
```

### SettingsTools: Settings: tools

Initial state: `{"st":"bad","restarting":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Settings
(aria-label: Settings sections)
[Agents] → SettingsAgents
[Approvals] → SettingsApprovals
[Notifications] → SettingsNotifications
[Projects] → SettingsProjects
[Tools] → SettingsTools
Tools
The tools the factory runs on, checked when it starts and whenever you ask.
gh | Pull requests and repos | Signed in as AppElent
t3 | Runs the agents | Ready
sentry | Production errors | Signed in
eas | App builds and deploys | Signed in
if bad:
  wrangler | Cloudflare deploys | Not signed in
  wrangler login
  [Check again] on check
if checking:
  wrangler | Cloudflare deploys | Checking
  wrangler login
  [Checking…] (inert) disabled when busy
if good:
  wrangler | Cloudflare deploys | Signed in
infisical | Secrets for new projects | Optional · not installed
terminal-notifier | macOS notifications | Ready
(aria-label: This Mac)
This Mac
Service
Running at 127.0.0.1:4310
Starts
At login
Data
~/Library/Application Support/Software Factory/factory.db
[Restart service] → AppOffline
[Back up data] → #backup
```

### SettingsNotifications: Settings: notifications

Initial state: `{"chk":{"q":true,"plan":true,"pr":true,"gate":true,"err":true,"ci":true,"alone":true,"ship":false,"full":false},"blocked":false,"sent":false,"front":true,"saved":false,"checking":false}`

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
Settings
(aria-label: Settings sections)
[Agents] → SettingsAgents
[Approvals] → SettingsApprovals
[Notifications] → SettingsNotifications
[Projects] → SettingsProjects
[Tools] → SettingsTools
Notifications
Sent by this Mac, even with the browser closed. Clicking one opens the item it names.
if blocked:
  (role: alert)
  macOS is blocking notifications | Allow terminal-notifier in System Settings, under Notifications. Until then, everything still lands in the Queue.
  [Open System Settings] → x-apple.systempreferences:com.apple.Notifications-Settings.extension
  [Check again] on recheck
if checking:
  (role: status)
  Checking macOS
  [Checking…] (inert) disabled when busy
if allowed:
  macOS notifications are on
  [Send a test] on test
  if sent:
    (role: status)
    Sent. Nothing showed? Check Focus and System Settings.
(aria-label: Needs you)
Needs you
<checkbox checked={{chk.q}} on tog.q>
An agent asks a question | The work order waits until you answer. |
<checkbox checked={{chk.plan}} on tog.plan>
A plan needs approval | Build starts after you approve. |
<checkbox checked={{chk.pr}} on tog.pr>
A PR is ready to merge | All gates passed. |
<checkbox checked={{chk.gate}} on tog.gate>
Gates fail after the retries | The agent has stopped trying. |
<checkbox checked={{chk.err}} on tog.err>
A new production error or a regression | Once per error, not once per event. |
<checkbox checked={{chk.ci}} on tog.ci>
CI goes red on main | Once per project until it is green again. |
(aria-label: Just so you know)
Just so you know
<checkbox checked={{chk.alone}} on tog.alone>
A PR merges without you | Only when you turned that on in Approvals. |
<checkbox checked={{chk.ship}} on tog.ship>
A work order ships | Merged, and main didn't go red after it. |
<checkbox checked={{chk.full}} on tog.full>
All agent slots are full | New work is waiting in Intake. |
<checkbox checked={{front}} on flipFront>
Only when Software Factory isn’t the tab you’re on
Several events within a minute arrive as one. Focus and Do Not Disturb apply as usual. There’s no separate inbox: the Queue is the list of what needs you.
[See how they read] → NotifSamples
if saved:
  (role: status)
  Saved
```

### SettingsNotifyBlocked: Settings: notifications blocked by macOS

Initial state: `{"chk":{"q":true,"plan":true,"pr":true,"gate":true,"err":true,"ci":true,"alone":true,"ship":false,"full":false},"blocked":true,"sent":false,"front":true,"saved":false,"checking":false}`

Same copy as SettingsNotifications; differs only by its starting state above.

### NotifSamples: Notifications: how they read

```text
(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
(aria-label: Breadcrumb)
[Settings] → SettingsAgents
/
[Notifications] → SettingsNotifications
/ | How they read
How notifications read
(aria-label: Needs you)
Needs you
[SF | Software Factory | Foundry: agent asks a question | WO-212: Keep the old migration? |] → WOQuestion
Opens the question
[SF | Software Factory | Fairway: plan ready for you | WO-214: Fix TypeError reading 'holes' |] → WOPlan
Opens the plan
[SF | Software Factory | Foundry: PR ready to merge | #168 Sync toolkit standards. All 4 gates passed. |] → PRPassed
Opens the PR
[SF | Software Factory | Arcade Club: tests failed twice | WO-213: Flaky leaderboard test |] → WOFailed
Opens the work order
[SF | Software Factory | Fairway: new production error | TypeError reading 'holes'. 14 users so far. |] → ErrorNew
Opens the error
[SF | Software Factory | Fairway: an error came back | NetworkError fetching course list. Its fix shipped 6 days ago. |] → ErrorRegression
Opens the error
[SF | Software Factory | Gather: CI red on main | Typecheck failed on f81c0de. |] → Queue
Opens the Queue, on that row
[SF | Software Factory | 3 PRs ready to merge | Arcade Club, satisfactory, and roadmaps |] → PullRequestsBulk
Opens Pull requests
(aria-label: Just so you know)
Just so you know
[SF | Software Factory | Fairway: merged without you | #96 Fix TypeError reading 'holes' |] → PRFix
Opens the PR
[SF | Software Factory | Foundry: shipped | WO-208: Faster workout list |] → FloorBoard
Opens the floor
[SF | Software Factory | All 3 agents are busy | 2 work orders are waiting in Intake. |] → FloorLimit
Opens the floor
```

## Long text

### ProjectLong: Long text: project

Initial state: `{"paused":false,"ask":false,"merge":"follow","cloning":false,"cloned":false}`

Changes from ProjectDetail (`-` removed, `+` added):

```diff
-/ | Fairway
-Fairway
+/ | Fairway Scorecards for Weekend Golf Societies and Long Tournaments
+Fairway Scorecards for Weekend Golf Societies and Long Tournaments
-[GitHub] → https://github.com/AppElent/golf-app
+[GitHub] → https://github.com/AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments
-(aria-label: Work orders · 2)
-Work orders · 2
-[WO-214 | Fix TypeError reading 'holes' | Plan · waiting on you | 4m |] → WOPlan
-[WO-215 | Export rounds to CSV | Intake · idea] → WOPlan
+(aria-label: Work orders · 1)
+Work orders · 1
+[WO-214 | Fix TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round | Plan · waiting on you | 4m |] → WOPlan
-[#94 | Course search empty state | Preview failed | 3h |] → PRFailed
-(aria-label: Errors · 2)
-Errors · 2
-[FAIRWAY-W3 | TypeError reading 'holes' | New · 14 users | 3h |] → ErrorNew
-[FAIRWAY-R1 | NetworkError fetching course list | Regression · 5 users | 1d |] → ErrorRegression
-(aria-label: Shipped recently)
-Shipped recently
-[WO-206 | Share a round with a link | Caused 1 error | 5h |] → ErrorNew
-[WO-203 | Faster course search | No new errors | 2d |] → Health
+[#94 | Show a helpful empty state with a clear-search action when a course search finds nothing in the selected region or season | Preview failed | 3h |] → PRFailed
-[AppElent/golf-app] → https://github.com/AppElent/golf-app
+[AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments] → https://github.com/AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments
-~/Developer/golf-app
+~/Developer/clients-and-side-projects/2026/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments
-main
+release/2026-11-spring-season-scorecard-migration
```

### PRLong: Long text: PR

Initial state: `{"st":"idle","changes":false,"closing":false}`

Changes from PRFix (`-` removed, `+` added):

```diff
-Fairway · PR #96 · Bug fix
-Fix TypeError reading 'holes'
+Fairway Scorecards for Weekend Golf Societies and Long Tournaments · PR #96 · Bug fix
+Fix TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round
-Cached rounds now include their holes. Rounds cached before this change refetch once.
-Adds a test that loads a round from a share link
-Follows the approved plan with no changes
+Cached rounds now include their holes. Rounds cached before this change refetch once, which can take a moment on a slow connection, so the scorecard shows its loading state until the refetch finishes and then renders exactly as it did before.
-Files · +46 −9
-[Open diff on GitHub] → https://github.com/AppElent/golf-app/pull/96/files
-src/rounds/cache.ts | +18 −7 |
-src/rounds/score.ts | +2 −2 |
-src/rounds/cache.test.ts | +26 −0 |
+Files · +12046 −9981
+[Open diff on GitHub] → https://github.com/AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments/pull/96/files
+packages/scorecards/src/features/shared-rounds/components/round-summary/RoundSummaryCard.integration.test.tsx | +18 −7 |
+src/rounds/cache.ts | +2 −2 |
-$0.58
+$12.58
-[AppElent/golf-app#96] → https://github.com/AppElent/golf-app/pull/96
+[AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments#96] → https://github.com/AppElent/fairway-scorecards-for-weekend-golf-societies-and-long-tournaments/pull/96
```

### FloorLong: Long text: floor

Initial state: `{"pr":"All projects"}`

Changes from FloorBoard (`-` removed, `+` added):

```diff
+if vis.c21:
+  WO-1042 | 114m |
+  Show a helpful empty state with a clear-search action when a course search finds nothing in the selected region
+  Fairway Scorecards for Weekend Golf Societies and Long Tournaments
+  Working
+  [] → WORun211
```

## First run

### FRTools: First run: tools with a problem

Initial state: `{"st":"bad"}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Check your tools
Choose projects
Read projects
Open your queue
Check your tools
Software Factory runs on the tools you already use. Nothing changes on this Mac until you press a button.
gh | Pull requests and repos | Signed in as AppElent
t3 | Runs the agents | Ready
sentry | Production errors | Signed in
if good:
  eas | App builds and deploys | Signed in
if bad:
  eas | App builds and deploys | Not signed in
  eas login
  [Check again] on check
if checking:
  eas | App builds and deploys | Checking
  eas login
  [Checking…] (inert) disabled when busy
infisical | Secrets for new projects | Not installed
Optional. Without it, new projects skip the secrets step. Install it with | brew install infisical
terminal-notifier | macOS notifications | Ready
[Continue] → FRRepos
You can fix eas and infisical later. They show in Later on the queue.
```

### FRToolsBlocked: First run: required tool missing

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Check your tools
Choose projects
Read projects
Open your queue
Check your tools
Software Factory runs on the tools you already use. Nothing changes on this Mac until you press a button.
gh | Pull requests and repos | Not signed in
gh auth login
Required. Projects and PRs come from GitHub.
t3 | Runs the agents | Ready
sentry | Production errors | Not signed in
Optional. Without it, errors don't reach the queue.
eas | App builds and deploys | Not signed in
Optional. Without it, app deploys aren't tracked.
infisical | Secrets for new projects | Not installed
Optional. Without it, new projects skip the secrets step.
terminal-notifier | macOS notifications | Ready
[Check again] → FRTools
Sign in to gh to continue.
```

### FRRepos: First run: choose projects

Initial state: `{"sel":{},"q":"","clone":{},"err":false}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Check your tools
Choose projects
Read projects
Open your queue
Choose projects
Everything starts off. Only the projects you turn on get read, and reading doesn't change anything.
(aria-label: Search repos)
(placeholder: Search 26 repos)
<search value={{q}} on type>
(role: status)
{{count}}
if show.workouts:
  <checkbox checked={{on.workouts}} on flip.workouts>
  workouts | Foundry
  3 days ago | ~/Developer/workouts |
if show.golf_app:
  <checkbox checked={{on.golf_app}} on flip.golf_app>
  golf-app | Fairway
  4 days ago | ~/Developer/golf-app |
if show.gather:
  <checkbox checked={{on.gather}} on flip.gather>
  gather | Gather
  4 days ago | ~/Developer/gather |
if show.games:
  <checkbox checked={{on.games}} on flip.games>
  games | Arcade Club
  4 days ago
  if notCloned.games:
    Not on this Mac
    [Clone] on clone.games
  if cloning.games:
    [Cloning…] (inert) disabled when busy
  if cloned.games:
    ~/Developer/games
if show.developer_tools:
  <checkbox checked={{on.developer_tools}} on flip.developer_tools>
  developer-tools
  1 day ago | ~/Developer/developer-tools |
if show.labs:
  <checkbox checked={{on.labs}} on flip.labs>
  labs
  43 days ago
  if notCloned.labs:
    Not on this Mac
    [Clone] on clone.labs
  if cloning.labs:
    [Cloning…] (inert) disabled when busy
  if cloned.labs:
    ~/Developer/labs
if show.satisfactory:
  <checkbox checked={{on.satisfactory}} on flip.satisfactory>
  satisfactory
  69 days ago | ~/Developer/satisfactory |
if show.roadmaps:
  <checkbox checked={{on.roadmaps}} on flip.roadmaps>
  roadmaps
  69 days ago
  if notCloned.roadmaps:
    Not on this Mac
    [Clone] on clone.roadmaps
  if cloning.roadmaps:
    [Cloning…] (inert) disabled when busy
  if cloned.roadmaps:
    ~/Developer/roadmaps
if none:
  No repos match ‘{{q}}’.
2 repos skipped before reading | client-work and client-archive match your exclude rule, so nothing in them was opened.
if err:
  (role: alert)
  Turn on at least one project to continue.
if ready:
  [Continue] → FRReading
if notReady:
  [Continue] on fail
[Back] → FRTools
```

Strings in logic:

-  of 26 selected

### FRReading: First run: reading projects

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Check your tools
Choose projects
Read projects
Open your queue
Reading 3 projects
Reading only. No branches, no commits, no agents.
(role: status)
Foundry | 2 open PRs · no errors · toolkit current
Fairway | 2 open PRs · 1 production error · toolkit current
Gather | Reading open PRs
Fairway has no EAS project linked | You can still see its PRs and errors. Its deploys won't be tracked until you connect it in Projects.
[Open your queue] → QueueFirst
Gather joins the queue when it finishes.
```

### QueueFirst: Queue: first look

Initial state: `{"sel":"r1","gone":{},"note":""}`

Changes from Queue (`-` removed, `+` added):

```diff
-(shell: 2 of 3 agents working · Synced 1m ago; footer Stop the line)
+(shell: No agents working yet · Synced just now; footer Stop the line)
+Your first queue, ranked from 3 projects | Production errors first, then agents waiting on you, red builds, and ready PRs. Start with the top item.
-4
+0
-1
+0
-2/3
+0/3
-1/3
+0/3
-3
+1
```

### Tools: fixing one

| Where | Copy |
| --- | --- |
| Missing tool | `Install gh`, while running `Installing gh…` |
| Signed-out tool | `Sign in to gh`, then `Finish in Terminal, then check again.` |
| No Homebrew | `Homebrew isn't installed. Get it from brew.sh, then try again.` |
| Terminal won't open | `Couldn't open Terminal. Run gh auth login yourself, then check again.` |

### Restore projects

Shown after Tools when projects came back from the config file.

| Where | Copy |
| --- | --- |
| Title | `Restore projects` |
| Lead | `These came from your config file. Reading them doesn't change anything, and cloning only adds folders.` |
| Row | `On this Mac`, `Not on this Mac`, or the clone's error |
| Buttons | `Clone 2 projects`, while running `Cloning…`. `Open your queue` |
| With folders missing | `Work on a project without a folder waits until you clone it.` |

## Improve yourself

| Where | Copy |
| --- | --- |
| Lead | `Starts a work order on Software Factory's own repo, me/software-factory.` |
| Notice | `This repo may be public, and this text can end up in commits and PRs. It's checked for your private names before it's sent.` |
| Footer | `Changes to security files always wait for you, in every mode.` |
| Private match | Title `This mentions something private`. `It mentions quiet-thing. This repo may be public, so this could end up in commits and PRs.` Action `Start anyway` or `Copy anyway` |
| Merging mode | Title `Full send on the factory itself?`. `The factory merges this as soon as its gates pass. Changes to security files still wait for you.` Action `Start with Full send` |
| Ready | `c3d4e5f is ready`, `Started on a spare port, and passed its smoke test`, `Update to c3d4e5f`, `Your settings and work orders stay. If c3d4e5f doesn't start or fails its check, the factory goes back to b2c3d4e on its own.` |
| History | `Building: <title>`, `Running now, since 3d`, `Getting ready: <commit>`, `Replaced 3d ago`, or why it failed |
| Roll back | Title `Roll back to a1b2c3d?`. `The factory restarts on that version. Your settings and work orders stay. A newer version's database changes stay too, and older versions ignore them.` |
| Checkout | `This copy runs from a checkout, so there's nothing to switch. Run pnpm service:install to get versions with a way back.` |
| Went back | `It didn't start or failed its check, so the factory went back.` |

## New project

### NLDescribe: New project: describe

Initial state: `{"name":"caddie","tpl":"expo","vis":"private","err":false}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
New project
Nothing is created until you approve the next step.
Name
<text value={{name}} on type>
Becomes the repo name and the folder in ~/Developer.
if taken:
  AppElent already has a repo with this name. Choose another name.
if blank:
  Enter a name for the project.
What is it for?
<textarea>
Agents read this as the project brief.
Toolkit template
<radio checked={{tplOn.expo}} on tplPick.expo>
Expo app | iOS, Android, and web from one codebase. EAS builds. |
<radio checked={{tplOn.vite}} on tplPick.vite>
Vite web app | React with TanStack Router. Deploys to Cloudflare. |
<radio checked={{tplOn.node}} on tplPick.node>
Node service | Hono API. Deploys to Cloudflare Workers. |
<radio checked={{tplOn.bare}} on tplPick.bare>
Toolkit only | Standards, CI, and agents setup with no app code. |
Repo visibility
<radio checked={{priv}} on pickPriv>
Private | Only you can see it. |
<radio checked={{pub}} on pickPub>
Public | Anyone can see the code. |
if ok:
  [Continue] → NLApprove
if notOk:
  [Continue] on fail
[Cancel] → Projects
```

### NLApprove: New project: approve changes

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
Approve these changes
These happen outside this app. Nothing has been created yet.
Create the GitHub repo | AppElent/caddie · private
Create the local folder | ~/Developer/caddie
Apply the Expo app template | From developer-tools, then the first commit on main
Add it to T3 | So agents can open threads and worktrees here
Services come after the first green build, and you confirm each one then.
[Approve and create] → NLScaffold
[Change something] → NLDescribe
```

### NLScaffold: New project: scaffolding

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
Building caddie
You can leave this page. It keeps going, and the queue tells you when it needs you.
(role: status)
Created AppElent/caddie | 0:04
Created ~/Developer/caddie | 0:05
Applied the Expo app template | 0:48
Running the baseline: typecheck, tests, lint | 1:12
Add it to T3
[Connect services] → NLConnect
[Back to the queue] → Queue
Prototype: Connect services turns on when the baseline is green. See the failures:
[scaffold failed] → NLFailed
,
[baseline red] → NLBaseline
.
```

### NLFailed: New project: scaffold failed

Initial state: `{"ask":false}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
caddie couldn't be built
The template step failed. The repo and folder exist, so you can retry from here.
Created AppElent/caddie | 0:04
Created ~/Developer/caddie | 0:05
Applied the Expo app template | 0:31
pnpm install failed ERR_PNPM_FETCH_503 registry.npmjs.org: Service Unavailable
Run the baseline
Add it to T3
[Retry this step] → NLScaffold
if notAsk:
  [Remove what was created] on askRm
if ask:
  Remove caddie?
  This deletes the AppElent/caddie repo on GitHub and the ~/Developer/caddie folder. It can't be undone.
  [Keep it] on keep
  [Remove repo and folder] → Projects
```

### NLBaseline: New project: baseline red

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
The baseline is red
The template built, but a check failed. An agent can fix it. The project won't take other work until the baseline is green.
Created AppElent/caddie | 0:04
Applied the Expo app template | 0:48
Baseline: tests | 1:40
✕ app/index.test.tsx Cannot find module 'expo-router/testing-library'
[Start work order] → WOPlan
[Open in T3] → #t3
```

### NLConnect: New project: connect services

Initial state: `{"st":{"infisical":"skip"}}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
Connect services
The baseline is green. Each of these creates something outside this app, so you confirm or skip each one.
Sentry
Create the project caddie and add its DSN to secrets. Errors reach the queue.
if open.sentry:
  [Connect Sentry] on go.sentry
  [Skip] on skipIt.sentry
if busy.sentry:
  [Connecting…] (inert) disabled when disabled
if done.sentry:
  Connected
if skip.sentry:
  Skipped
  [Undo] on undo.sentry
EAS
Create the project and link it to the repo. Builds and deploys are tracked.
if open.eas:
  [Connect EAS] on go.eas
  [Skip] on skipIt.eas
if busy.eas:
  [Connecting…] (inert) disabled when disabled
if done.eas:
  Connected
if skip.eas:
  Skipped
  [Undo] on undo.eas
Infisical
Not installed on this Mac. Secrets stay out of the repo.
if open.infisical:
  [Connect Infisical] on go.infisical
  [Skip] on skipIt.infisical
if busy.infisical:
  [Connecting…] (inert) disabled when disabled
if done.infisical:
  Connected
if skip.infisical:
  Skipped
  [Undo] on undo.infisical
if any:
  (role: status)
  {{note}}
[Finish] → NLDone
```

Strings in logic:

-  skipped service stays as a reminder under Later.
-  skipped services stay as reminders under Later.

### NLDone: New project: running

Initial state: `{"text":"","err":false}`

```text
[Skip to content] → #main
Software Factory
(aria-label: Steps)
Describe
Approve changes
Scaffold
Connect services
First idea
(aria-label: Breadcrumb)
[Projects] → Projects
/ | New project
caddie is on the floor
The baseline is green and the project is open. All 4 gates are ready.
What should it build first?
(placeholder: A screen that lists my clubs with their average distance)
<textarea value={{text}} on type>
This becomes the first work order. It goes to Plan and waits for your approval.
if err:
  Describe the first change, or skip this for now.
if ready:
  [Start work order] → WOPlan
if notReady:
  [Start work order] on fail
[Skip for now] → FloorBoard
Repo
[AppElent/caddie] → https://github.com/AppElent
Folder
~/Developer/caddie
Services
Sentry, EAS
Skipped
Infisical. Reminder under Later.
```

## Config file that can't be used

Shown on every page while the config file can't be read.

| Element | Copy |
| --- | --- |
| Banner title | `Your config file can't be used.` |
| Banner body | `{why} Modes, environments and settings may show their defaults, because the file can't say what you set. Nothing merges on its own until it's fixed.` |

## Closing picked-up work on someone else's branch

| Element | Copy |
| --- | --- |
| Close dialog body | `This only closes the work order. The branch, its folder and any PR stay, because they aren't the factory's.` |
