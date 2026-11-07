---
type: standard
kind: platform
description: Read before implementing or reviewing any code change.
version: 2.1.0
applies_to: [all]
---

# General coding

Changes extend existing owners, add complexity only when its cost is justified, keep generated output generated, and finish verified.

## Rules

- Extend the existing owner of a responsibility; avoid a parallel mechanism.
- Before adding a reusable mechanism, check the existing standards and component owners. Keep domain decisions app-owned. Extract reusable code when actual callers demonstrate a common contract. Keep repeatable setup in portable scripts and implementation choices in standards. Copied application examples become project-owned.
- Follow the applicable [baseline](baseline.md) and project overrides. Use pnpm for JavaScript/TypeScript projects; use `pnpm exec` for installed tools and `pnpm dlx` for deliberate one-off tools. Read versions, formatter options, scripts, and supply-chain policy from configuration rather than duplicating them in prose.
- Treat generated files as outputs. Change their source or generator and regenerate; never patch generated route trees, API bindings, or datasets by hand.
- Preserve the existing environment/credential routing. Keep secrets out of tracked files and client bundles.
- For documentation, follow the [documentation standard](documentation.md). Keep domain vocabulary in GLOSSARY.md and hard-to-reverse, surprising trade-offs in ADRs.
- **Default:** consult [specialist skills](specialist-skills.md) only when task-specific expertise is useful.

### One-shot code

Migrations, backfills, and compatibility shims run against a data shape and then are dead, yet they sit among live code and their tests keep passing whether or not the shape still exists. Each states, where it lives, what retires it:

- **Migration code:** deleted when its record (issue, PR, or migration note) says it has run everywhere, or that something superseded it.
- **Compatibility shim:** names the date or event after which it goes.
- Code with no end condition is not one-shot code; it is ordinary code and is maintained as such.

### Complexity cost

Every dependency, abstraction, code path, state, schema, service, flag, and native module is paid for in reading, testing, upgrading, and debugging, by people and agents, for as long as it exists. Weigh that cost in every design choice.

- Prefer the cheapest option that delivers the required behavior, in this order: change nothing or narrow the scope, delete or reuse what exists, use the platform or framework, write small local code, share an abstraction, add a dependency, add a service.
- Decide routine cases yourself (a small dependency, a local helper) and note them in the PR. Raise it with the user, with a recommendation, only when:
  - a clearly cheaper option exists but changes the requested behavior or scope;
  - the complexity is hard to reverse or large: a new service or provider, persisted schema or data migration, caching/offline/sync, or a second way to do something the codebase already does.
- Never trade behavior away silently.
- State accepted complexity in the PR: what was added, why, and the cheaper option rejected. Hard-to-reverse choices also get an ADR.
- Remove complexity that loses its last caller or reason in the same change.

## Verify

- The PR names added complexity with its justification and the rejected cheaper option.
- Before completion, follow the [verification standard](verification.md) and the affected project's check commands.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
