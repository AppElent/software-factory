---
type: standard
kind: platform
description: Read when a toolkit sync stops on conflicts or interruption, or when upgrading from an earlier updater.
version: 1.0.0
applies_to: [all]
---

# Toolkit sync detail

Supporting detail for the [baseline](../baseline.md) toolkit rules.

## Options

`--ref <branch|tag|commit>` is retained in the receipt; `--ref main` returns to the default. `--check` is offline drift detection; `--dry-run` discovers upstream changes. `--source /path/to/developer-tools` installs from a local checkout without fetching or executing it; the receipt says local and records no machine path, and the next normal update fetches the retained ref. Only committed and pushed source is available through GitHub. `--path <root>` targets another project root.

## Ownership and conflicts

Standards, guides, scripts, and templates are toolkit-owned. `CODING_STANDARDS.md` and `DESIGN_SYSTEM.md` are project-owned: sync creates them when missing, then updates only their `appelent-standards` blocks. `AGENTS.md` owns the task entry point; the managed `CLAUDE.md` block only points to it. Content outside managed blocks is preserved. Files created from templates belong to the application.

A locally changed toolkit file stops the whole update before any write; reconcile deliberately instead of deleting the receipt. Files that already match the release are adopted without overwriting. A legacy `.appelent/guidelines.json` receipt supplies ownership for unchanged files during first adoption and stays as history. Existing `project-coding.md`, `project-design.md`, and `app.md` are preserved; move their decisions into the root files when migrating that project.

## Interruption

Writes are individually atomic, not one transaction. An interrupted run leaves `.appelent/devtools-pending.json`: run `node scripts/sync-devtools.mjs --recover` to restore the previous contents, then retry. Recovery refuses concurrent edits. Remove a stale `.appelent/devtools.lock` directory only after confirming no sync is running. Never delete the pending journal to bypass recovery.

## Upgrading from earlier updaters

- Earlier updaters reject `docs/standards/` and the per-folder `.template.md` destinations, and distribution schema 2: copy the current `scripts/sync-devtools.mjs` once, then sync.
- Rename `docs/product/` to `docs/contracts/` and update links; the toolkit does not move project documents.
- Remove `--scope`, `--agent`, and `--skill-scope`. Project skill copies from older receipts are released from toolkit ownership on the next update; reconcile duplicates with the skills CLI.
- The `sync-guidelines` bootstrap and the adjacent developer CLI launcher are retired. Runtime package imports and project configuration need their own migrations.
