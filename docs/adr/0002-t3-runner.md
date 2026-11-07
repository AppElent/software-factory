---

type: decision
description: Read when changing how the factory starts, watches, or stops agents.
version: 1.0.0
status: accepted
date: 2026-11-06
---

# T3 as the default agent runner

Agents run in T3 threads on their own worktrees, driven by the `t3` CLI behind an `Executor` interface (`start`, `status`, `send`).

## Why

Any run can be opened, watched, and taken over in T3, which is what makes a stuck agent cheap to rescue. Headless `claude -p` and `codex exec` give up that, so they stay as drop-in alternatives.

## Evidence

Accepted after the [T3 spike](../records/2026-11-06-t3-spike.md).

## Consequences

The factory sends one stage per turn, so holds take effect at the next step and don't need a cancel. `Executor` has no `cancel`. T3 has no cost source, so cost leaves the interface instead of being estimated. Native agent questions can't be answered through the CLI, so agents ask through a factory protocol.
