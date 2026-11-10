---
type: standard
kind: platform
description: Read before implementing or reviewing any code change.
version: 2.2.0
applies_to: [all]
---

# General coding

Changes extend existing owners, add complexity only when its cost is justified, keep generated output generated, and finish verified.

## Rules

- Extend the existing owner of a responsibility (check the standards and component owners); avoid a parallel mechanism.
- Keep domain decisions app-owned; extract reusable code only when actual callers share a contract. Repeatable setup goes in portable scripts, implementation choices in standards. Copied examples become project-owned.
- Follow the [baseline](baseline.md) and project overrides. Use `pnpm exec` for installed tools and `pnpm dlx` for deliberate one-off tools.
- Change generated files (route trees, API bindings, datasets) through their source or generator and regenerate; never patch them by hand.
- Preserve the existing environment/credential routing. Keep secrets out of tracked files and client bundles.

### One-shot code

Migrations, backfills, and compatibility shims are dead once their data shape is gone, yet their tests keep passing. Each states, where it lives, what retires it:

- **Migration code:** deleted when its record (issue, PR, or migration note) says it has run everywhere, or that something superseded it.
- **Compatibility shim:** names the date or event after which it goes.
- Code with no end condition is ordinary code.

### Complexity cost

Every dependency, abstraction, code path, state, schema, service, flag, and native module costs reading, testing, upgrading, and debugging for as long as it exists.

- Prefer the cheapest option that delivers the required behavior, in this order: change nothing or narrow the scope, delete or reuse what exists, use the platform or framework, write small local code, share an abstraction, add a dependency, add a service.
- Decide routine cases (a small dependency, a local helper) yourself and note them in the PR. Raise it with the user, with a recommendation, only when:
  - a clearly cheaper option exists but changes the requested behavior or scope;
  - the complexity is large or hard to reverse: a new service or provider, persisted schema or data migration, caching/offline/sync, or a second way to do something the codebase already does.
- Never trade behavior away silently.
- State accepted complexity in the PR: what was added, why, and the cheaper option rejected. Hard-to-reverse choices also get an ADR.
- Remove complexity that loses its last caller or reason in the same change.

## Verify

- The [verification standard](verification.md) and the affected project's check commands pass before completion.
