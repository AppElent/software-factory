---
type: standard
kind: capability
description: Read when writing or reviewing Convex functions, schema changes, migrations, seeds, tests, or account deletion and export.
version: 2.0.0
applies_to: [backend]
---

# Convex backend

Every public function authenticates and validates its caller, fails with a keyed error, and is covered by a convex-test test.

## Rules

### Auth and visibility

- Anyone with the deployment URL can call a public `query`, `mutation`, or `action`. Each resolves its caller through one helper module, `convex/lib/auth.ts`: `requireUserId(ctx)` throws the keyed `signInRequired` error, and `getOptionalUserId(ctx)` serves reads that are deliberately public. Never read `ctx.auth` ad hoc and never fall back to a shared account.
- Scoped data (a group, a household) is authorized in one access module, from the id or slug the caller passed: resolve the scope, check membership, then read. Never use a stored "active" scope or fall back to another scope the caller belongs to. Keep "unknown" and "not a member" distinct for the UI without telling a stranger that the scope exists.
- Changing shared data, such as a catalog entry, needs a signed-in caller and an explicit edit rule (creator, member, or admin). Refuse deleting a row that other users' data references.
- Functions no client calls (seeds, migrations, scheduled jobs, crons, webhook helpers, `--preview-run` targets) are `internalQuery`, `internalMutation`, or `internalAction`, called through `internal.*`.

### Validators and errors

- Every public function declares `args` and `returns` validators. Bound free-text and opaque strings by length, and use `v.id(table)` for ids.
- A failure the user should see throws `new ConvexError({ code, params? })`. The `code` type is `keyof Messages["serverErrors"]` from the shared message catalog in `packages/core`, so an unknown code fails typecheck. Never throw English text or a bare string.
- Clients render errors through one shared helper, `errorMessage(messages, caught, fallback)`. A value without a known code (network failure, crash, invariant) shows the fallback, so raw server text never reaches the UI. Error reporting skips `ConvexError` as an expected outcome and reports everything else; backend failure forwarding follows [Sentry monitoring](sentry-monitoring.md).

### Tests

- Test functions with `convex-test` under Vitest, in a project with `environment: "edge-runtime"` (`@edge-runtime/vm`) that includes `convex/**/*.test.ts`.
- Every public function has a test for its unauthenticated or non-member call (with and without `t.withIdentity(...)`).

### Migrations

- Change schema in steps that each deploy cleanly: widen (add an optional field or a new table), backfill, switch readers, then narrow in a later deploy.
- A backfill is an `internalMutation` in `convex/migrations.ts`, run by hand with `convex run migrations:<name> --prod`, never by a deploy or a request. It is idempotent, processes a bounded batch per call with a resumable cursor, and its comment names what retires it. Delete it once every deployment has run it.

### Account deletion and export

- Account deletion is a public mutation that deletes the caller's personal data, stored files included, in resumable bounded batches; the client repeats it until it returns `done`. It takes the caller's `expectedSubject` and refuses when the signed-in subject differs, so an account switch mid-run cannot delete the wrong data. It reports blockers (active sessions, data others depend on) instead of half-deleting. Shared catalogs are untouched. The identity-provider account is deleted after the data.
- An iOS app offering Sign in with Apple revokes the Apple grant before deletion. A public action takes a fresh authorization code from the native Apple sheet, plus the bundle ID of the build that showed it, and calls Apple's revoke endpoint with credentials routed through [environments](environments.md). A failed revocation returns a stable code and does not block the deletion.
- Export and deletion are each driven by a registry keyed by every table, `{ [T in TableNames]: Treatment<T> }`: read by owner or scope, read under a parent, or excluded with a reason. A new table then fails typecheck until it states its treatment. Export reads in bounded pages, omits secrets and internal identifiers (auth subjects, invite codes, tokens), and shows other people only by display name.

### Catalogs and seeding

- Reference data is a committed catalog (JSON or TypeScript under `convex/`), written to the database by an idempotent internal seed that upserts by a stable key. It reruns safely on every deploy; the catalog wins over database edits.
- Seeds and preview runs make no network calls. A separate script refreshes a catalog from its external source and commits the result for review.
- A preview deployment runs one internal seed entry point (`--preview-run seedPreview:seedPreview`) that loads catalogs only. Per-user demo data needs an identity and is seeded on request with `convex run ... --identity`.

### Development deployments

- Worktrees share the dev deployment unless prepared with their own backend ([workspaces](workspaces.md)). A schema push to the shared deployment changes every worktree's backend, so push there only schema every open branch can run against; a schema change that breaks other branches gets its own backend.

## Implementation

```ts
// convex/lib/errors.ts
import type { ServerErrorCode, ServerErrorParams } from "@app/core/errors";
import { ConvexError } from "convex/values";

export function appError(code: ServerErrorCode, params?: ServerErrorParams) {
  return new ConvexError(params ? { code, params } : { code });
}

// convex/lib/auth.ts
export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("signInRequired");
  return identity.subject;
}
```

```ts
// vitest.config.ts: one project among the app's others
{ extends: true, test: { name: "convex", include: ["convex/**/*.test.ts"], environment: "edge-runtime" } }
```

```ts
const EXPORT_TABLES: { [T in TableNames]: ExportTreatment<T> } = {
  users: { scope: "account", self: true, omit: ["clerkId"] },
  entries: { scope: "account", index: "by_user" },
  sessions: { exclude: "Expires within a day; holds no user content." },
};
```

An existing app adopts these rules per function as it touches it, but first fixes public functions without an auth call (`git grep -L "requireUserId\|getOptionalUserId" convex/*.ts`) as security bugs. Introduce the registries when building export or deletion.

## Verify

- `git grep -n "ctx.auth.getUserIdentity" convex` matches only the auth helper module.
- Every public function has `args` and `returns`; every `ConvexError` passes an object with a `code`.
- The convex Vitest project runs in CI and includes an unauthenticated test per public function.
- Adding a table to the schema fails typecheck until the export and deletion registries state its treatment.
- A preview deploy seeds with no outbound network access.

## Migration

From 1.x: worktrees share the dev deployment by default; follow the [workspaces](workspaces.md) migration.
