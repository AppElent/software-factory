---
type: standard
kind: platform
description: Read when adding, moving, or reviewing documentation or agent instructions.
version: 3.1.0
applies_to: [all]
---

# Documentation

Every rule has one owner, every document has one type, and readers find the right
file from its folder and frontmatter.

## Rules

### Owners

- Give each rule one owner. Remove product nouns and paths: if another project would
  decide the same, it belongs in a shared standard and the project keeps only its
  binding. Shared files change only through a developer-tools PR.

| Content | Owner |
| --- | --- |
| Personal preferences across repositories | Global AGENTS.md |
| Reusable engineering, design, or interaction rules | Shared standard or guideline |
| Project adoption, bindings, deviations (rule, scope, replacement, reason) | `CODING_STANDARDS.md`, `DESIGN_SYSTEM.md` |
| Domain vocabulary | `GLOSSARY.md` |
| Everything else | One document type below |

- AGENTS.md routes tasks and names each trigger; CLAUDE.md delegates to it.
- **Default:** delete text that changes no decision and facts that config or source
  already states. Keep rationale and hazards.

### Types

| Type | Answers | Location |
| --- | --- | --- |
| `standard` | What must hold for this platform, capability, or pattern? | `docs/standards/<name>.md` |
| `contract` | How should this feature behave? | `docs/contracts/<area>.md` |
| `decision` | Why this hard-to-reverse trade-off? | `docs/adr/NNNN-<slug>.md` |
| `runbook` | Which project facts does this repeatable task need here? | `docs/runbooks/<task>.md` |
| `record` | What evidence backs this contract or decision? | `docs/records/YYYY-MM-DD-<slug>.md` |

- `docs/README.md` is the only index. Frontmatter descriptions replace per-folder
  indexes.
- **Default:** names are lowercase kebab-case. A record's `kind` is `research`,
  `verification`, or `review`. Design studies live in `designs/`.

### Runbooks and skills

- A runbook holds this project's facts for one repeatable task: commands, names,
  accounts, environments, and exceptions. Steps that would be the same in another
  project belong in a shared standard or skill, which reads the runbook.
- **Default:** add a skill when agents repeat the procedure and it involves decisions;
  shared if other projects would run it, project-local otherwise. A project skill may
  be one line pointing at its runbook.
- One-off work (migrations, cleanups) is an issue and its PR, not a runbook.

### Records

- Write a record only when a contract or decision needs its evidence. Plans, specs,
  and reviews otherwise live in the issue or PR.
- Pending acceptance and follow-ups are GitHub issues, linked from the record or
  contract that needs them; a record never tracks them itself. Records are frozen when written; new evidence is a new record.
- **Default:** evidence is screenshots and text. Do not commit video; link it instead.

### Frontmatter and versions

- Every document has `type`, `description` (one line naming the reader's trigger),
  and `version`. Standards add `kind` (platform, capability, pattern) and
  `applies_to`; contracts `status` (draft, current); decisions `status` (proposed,
  accepted, superseded), `date`, and `superseded_by` only when superseded; records
  `kind` and `date`.

- Version living documents: major when a relied-on rule, behavior, or step changes or
  is removed, minor when one is added, patch for wording. When projects must act, add
  a `From X.Y:` migration note and delete it at the next major version. Decisions and
  records change only by patch. Never change an accepted decision's substance; add a
  new one and mark the old one superseded.

### Lifecycle

- Before deleting a superseded contract or runbook, move its unresolved acceptance to
  an issue. Git keeps history.
- **Default:** lasting behavior from a plan or spec moves into a contract.

## Implementation

1. Copy the folder's managed `.template.md` (this folder's is [the standard
   template](.template.md)) and start at `version: 1.0.0`.
2. A document with assets is a folder: `<name>/README.md` for records,
   `<name>/` for standards (examples, templates, long setup detail). Commit only assets it cites.
3. Moving a document moves its incoming links in the same change.

## Verify

- Every file under `docs/{standards,contracts,adr,runbooks,records}` starts with the
  required frontmatter for its type.
- Relative links resolve, including from AGENTS.md and the root standards.
- Each changed rule has one owner, and every new document is reachable from AGENTS.md
  routing.
- Every record is cited by a contract or decision; no record has an open-items section.
