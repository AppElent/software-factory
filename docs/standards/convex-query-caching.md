---
type: standard
kind: capability
description: Read when adding, changing, or reviewing Convex query reads, subscription retention, or local read caches in an Expo app.
version: 1.2.2
applies_to: [mobile]
---

# Convex query caching

Screens return to recently viewed data without reloading, through one query module and a fixed set of flavors, with no cache code in screens.

## Flavors

A project adopts exactly one flavor and records it in `CODING_STANDARDS.md` as `Convex query caching: <flavor>`. Do not combine parts of flavors or add per-screen or per-feature caches without a recorded exception. Lifetimes and size limits are app values, not part of the flavor (see below). Moving to another flavor is a project decision, not an implementation detail.

| Flavor | Adds | Choose when |
| --- | --- | --- |
| `retention` | Layer 1 | Default. Online-first apps where revisits should be instant. |
| `last-known` | Layer 1 and Layer 2 | The project has decided to keep disposable copies of account data on the device so cold starts paint before queries answer. |

When no flavor is recorded, the project has not adopted this standard. Ask before adding one.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

### All flavors

- One app-owned query module provides `useQuery`, `useQueries`, and `usePaginatedQuery`. Screens never import these from `convex/react`; a Biome `noRestrictedImports` rule enforces it. Mutations, actions, imperative `client.query`, and connection/auth hooks may still come from `convex/react`.
- Convex queries are live subscriptions: there is no stale time to tune and no refresh to trigger. Do not add pull-to-refresh or manual refetch for subscribed data.
- The cache stays below the authentication gate required by [auth](auth.md). It never shows data before Convex authenticates.
- A direct account switch disables the protected query subtree until its live backend identity matches the locally selected account. Convex's authentication boolean alone can still describe the previous account during the transition.

### Layer 1: subscription retention (`retention`, `last-known`)

- `useQuery` and `useQueries` read through `convex-helpers/react/cache`. After the last consumer unmounts, a subscription stays alive for a bounded time and idle count, so remounting with the same function and arguments returns data immediately.
- Retention is always bounded: a finite expiration and a maximum idle count. The app chooses both values, defines them once in the query module, and records them with its flavor in `CODING_STANDARDS.md`. They apply to every query through one provider; there are no per-query lifetimes. Changing them is a project decision, not an exception.
- The provider is keyed by account, so sign-out or account change disposes every subscription. Backgrounding releases existing idle subscriptions and disables further retention; returning to the foreground restores the defaults. Mounted subscriptions continue normally.
- Hooks pass arguments through unchanged; they do not skip queries on hidden screens. A mounted screen behaves like a plain Convex hook.
- `usePaginatedQuery` passes through to `convex/react`. These flavors retain non-paginated queries only.

### Layer 2: last-known value on disk (`last-known` only)

- A disposable copy of query results, read synchronously on mount and returned until the live result arrives. The live result replaces it and is written back.
- Arguments and values use Convex's `convexToJson`/`jsonToConvex` codec inside JSON, preserving bigint, bytes, and non-finite numbers. Correctness comes from the key, not application schema validation: the key contains cache version, account, function name, and arguments. The cache version changes with every JS bundle (native build plus OTA update id), so new code never reads an old shape.
- Entries outside the current version and account are deleted at startup and on sign-out. Writes complete synchronously so none can survive account cleanup. Oversized values are not stored, and every insertion enforces the total entry bound. The app chooses and records both limits alongside its retention values.
- Every failure (missing storage, read, parse, write, quota) is a cache miss. The cache can never break a screen, block a write, or hold the only copy of data.
- Persistence is opt-in per backend module through one allowlist in the query module, for both `useQuery` and each request in `useQueries`. Callers do not change when a module is enabled. Batched errors remain errors, never disk fallbacks.
- A cached value is for display only. Code that seeds a form, decides a write, or reads state that must be current (an active session, a lock, a balance) uses the module's `useLiveQuery` or `useLiveQueries`, which skip Layer 2.
- Disk fallback requires Convex-confirmed authentication and a connected socket. A cold start offline never paints persisted data; this flavor is not offline support.
- Never persist search results, paginated or growing history, or functions excluded in the allowlist.
- **Default:** `expo-sqlite/kv-store` for synchronous reads.

## Implementation

1. Install `convex-helpers` at a version whose `convex` peer matches the app. The retention starter adapts the exposed registry to dispose subscriptions; verify that registry contract when upgrading. For `last-known`, also run `pnpm exec expo install expo-sqlite` and rebuild a development client if SQLite is newly added.
2. Copy the flavor's starter into the app's client query folder: [retention](convex-query-caching/examples/retention.tsx), or that file plus [last-known](convex-query-caching/examples/last-known.ts). For `retention`, wrap the authenticated subtree with its `QueryCacheProvider`, passing `account`. For `last-known`, use its `QueryCacheProvider` under the Convex auth provider and **above** the auth gate, keeping it mounted while signed out. Pass `account` (the current account id, `undefined` while the app's auth provider restores its session, or `null` after confirmed sign-out) and `bundleVersion` (native build plus OTA update id). It supplies the disk scope, defers pruning while auth loads, prunes when startup/account/bundle identity resolves, and keys the retention subtree. Confirmed sign-out clears disk; provider unmount alone preserves it for the next launch. Query screens remain below the auth gate.
3. Both providers also require `confirmedAccount` and `fallback`. Reuse the app's live backend viewer/account query outside the cache provider, using the raw `convex/react` hook in the app-owned query boundary and `"skip"` until Convex authenticates. The backend derives this identifier from `ctx.auth`, in the same account vocabulary as `account`; it must not echo a caller-selected account. Pass its current result as `confirmedAccount`, never a disk copy or local auth identity. A stale previous-account result fails the match. Pass the app's auth loading/recovery UI as `fallback`, and handle identity-query errors with the app's error boundary. The provider hides protected children and disables disk scope until the identities match. During sign-out or a loading transition, `last-known` also keeps the fallback visible while Convex still reports authentication; once authentication is lost, the outer auth gate can show its signed-out UI.
4. Add the lint rule in a Biome override scoped to screen/feature consumer directories. Exclude the app-owned query boundary files (the starter's `retention.tsx`/`last-known.ts` and the identity-query adapter): their direct Convex imports implement the allowed boundary.

   ```json
   "noRestrictedImports": { "level": "error", "options": { "paths": {
     "convex/react": { "importNames": ["useQuery", "useQueries", "usePaginatedQuery"],
       "message": "Import query hooks from the app query module." }
   } } }
   ```

5. Change screen imports to the module. With `last-known`, move editors and current-state reads to `useLiveQuery`/`useLiveQueries`.
6. Delete per-feature retention or mirrors that the flavor replaces.
7. `last-known` only: to persist another area later, add its backend module to the allowlist, exclude any of its functions that must stay live-only, verify its screens, and delete its local retention.

## Verify

All flavors:

- Leave a screen and return within the expiration: no loading state, and no new subscription on the wire.
- Sign out and switch accounts: no previous account data appears.
- Switch accounts directly while Convex still reports the previous identity as authenticated: protected screens remain unmounted until the live backend account matches. No old result is written under the new account's key.
- Background the app: idle subscriptions are released, and returning works normally.
- Paginated lists load and paginate as before.

`last-known` only:

- Kill and relaunch on a persisted screen: last-known data paints as soon as the auth gate opens, then updates to live.
- Change the bundle version: no earlier entries are read, and stale keys are removed.
- Corrupt a stored value and make storage throw: the screen loads normally from Convex.
- Check bigint, bytes, and non-finite arguments/results in both single and batched reads; batched query errors still surface.
- Insert more than the entry limit in one session: the stored count stays bounded. Sign out immediately after a live result: old account entries stay deleted.
- Relaunch offline: persisted data stays hidden until Convex authenticates and connects.
- Launch with auth still loading, then restore the same account: persisted entries survive and appear after authentication. Confirmed sign-out clears them.
- An editor opened while only cached data exists waits for live data before filling the form.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
