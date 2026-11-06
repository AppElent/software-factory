---
type: decision
description: Read when changing how the factory starts, watches, or stops agents.
version: 1.0.0
status: proposed
date: 2026-11-06
---

# T3 as the default agent runner

Agents run in T3 threads on their own worktrees, driven by the `t3` CLI behind an `Executor` interface (`start`, `status`, `send`, `cancel`).

## Why

Any run can be opened, watched, and taken over in T3, which is what makes a stuck agent cheap to rescue. Headless `claude -p` and `codex exec` give up that, so they stay as drop-in alternatives.

## Status

Proposed until the spike answers:

- Do worktree runs and exit codes 1 and 2 work as the CLI documents?
- Can a run be stopped? `t3 thread` has no cancel, and `send` waits for the next turn.
- Where does cost come from? `t3 thread show --json` had no cost, usage, or token field in the thread checked on 2026-11-06.

The spike accepts this or replaces it, and records its evidence in `docs/records/`.

## Consequences

The factory sends one stage per turn, so holds take effect at the next step and don't need a cancel. If T3 has no cost source, cost leaves the interface instead of being estimated.
