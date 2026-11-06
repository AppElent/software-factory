---
type: standard
kind: platform
description: Read when adding, moving, or reviewing documentation or agent instructions.
version: 3.0.0
applies_to: [all]
---

# Documentation

Every rule has one owner, every document has one type, and readers find the right
file from its folder and frontmatter.

## Rules

### Owners

- **Required:** give each rule one owner. Remove product nouns and paths: if another
  project would decide the same, it belongs in a shared standard and the project
  keeps only its binding. Shared files change only through a developer-tools PR.

| Content | Owner |
| --- | --- |
| Personal preferences across repositories | Global AGENTS.md |
| Reusable engineering, design, or interaction rules | Shared standard or guideline |
| Project adoption, bindings, deviations (rule, scope, replacement, reason) | `CODING_STANDARDS.md`, `DESIGN_SYSTEM.md` |
| Domain vocabulary | `GLOSSARY.md` |
| Everything else | One document type below |

- **Required:** AGENTS.md routes tasks and names each trigger; CLAUDE.md delegates
  to it.
- **Default:** delete text that changes no decision and facts that config or source
  already states. Keep rationale and hazards.

### Types

| Type | Answers | Lifetime | Location |
| --- | --- | --- | --- |
| `standard` | What must hold for this platform, capability, or pattern? | Living; shared | `docs/standards/<name>.md` |
| `contract` | How should this feature behave? | Living | `docs/contracts/<area>.md` |
| `decision` | Why this hard-to-reverse trade-off? | Immutable | `docs/adr/NNNN-<slug>.md` |
| `runbook` | Which project facts does this repeatable task need here? | Living | `docs/runbooks/<task>.md` |
| `record` | What evidence backs this contract or decision? | Frozen | `docs/records/YYYY-MM-DD-<slug>.md` |

- **Required:** projects do not edit standards.
- **Required:** `docs/README.md` is the only index. Frontmatter descriptions replace
  per-folder indexes.
- **Default:** names are lowercase kebab-case. A record's `kind` is `research`,
  `verification`, or `review`. Design studies live in `designs/`.

### Runbooks and skills

- **Required:** a runbook holds this project's facts for one repeatable task:
  commands, names, accounts, environments, and exceptions. Steps that would be the
  same in another project belong in a shared standard or skill, which reads the runbook.
- **Default:** add a skill when agents repeat the procedure and it involves decisions;
  shared if other projects would run it, project-local otherwise. A project skill may
  be one line pointing at its runbook.
- **Required:** one-off work (migrations, cleanups) is an issue and its PR, not a
  runbook. Keep a record afterwards only when a contract or decision cites it.

### Records

- **Required:** write a record only when a contract or decision needs its evidence.
  Plans, specs, and reviews otherwise live in the issue or PR.
- **Required:** pending acceptance and follow-ups are GitHub issues; a record links
  them and never tracks them itself. Records are frozen when written; new evidence is
  a new record.
- **Default:** evidence is screenshots and text. Do not commit video; link it instead.

### Frontmatter and versions

- **Required:** every document has `type`, `description` (one line naming the
  reader's trigger), and `version`. Per type:

| Type | Also |
| --- | --- |
| `standard` | `kind`: platform, capability, pattern; `applies_to` |
| `contract` | `status`: draft, current |
| `decision` | `status`: proposed, accepted, superseded; `date`; `superseded_by` only when superseded |
| `record` | `kind`; `date` |

- **Required:** version living documents: major when a relied-on rule, behavior, or
  step changes or is removed, minor when one is added, patch for wording. Decisions
  and records change only by patch. Never change an accepted decision's substance;
  add a new one and mark the old one superseded.

### Lifecycle

- **Required:** before deleting a superseded contract or runbook, move its unresolved
  acceptance to an issue. Git keeps history.
- **Default:** lasting behavior from a plan or spec moves into a contract.

## Implementation

1. Copy the folder's managed `.template.md` (this folder's is [the standard
   template](.template.md)) and start at `version: 1.0.0`.
2. A document with assets is a folder: `<name>/README.md` for records,
   `<name>/` for standards (examples, templates, long setup detail). Commit only assets it cites.
3. Moving a document moves its incoming links in the same change.
4. Link follow-up issues from the record or contract that needs them.

## Verify

- Every file under `docs/{standards,contracts,adr,runbooks,records}` starts with the
  required frontmatter for its type.
- Relative links resolve, including from AGENTS.md and the root standards.
- Every record is cited by a contract or decision; no record has an open-items section.
- Documentation changes do not establish runtime acceptance.

## Exceptions

None expected. Record any in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
