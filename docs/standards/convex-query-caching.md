---
type: standard
kind: capability
description: Read when adding, changing, or reviewing Convex query reads, subscription retention, or local read caches in an Expo app.
version: 1.3.0
applies_to: [mobile]
---

# Convex query caching

Screens return to recently viewed data without reloading, through one query module and a fixed set of flavors, with no cache code in screens.

## Rules

### All flavors

- **Default:** the `retention` flavor (Layer 1), for online-first apps where revisits should be instant. Choose `last-known` (Layers 1 and 2) only when the project has decided to keep disposable copies of account data on the device so cold starts paint before queries answer. A project adopts exactly one flavor and records it in `CODING_STANDARDS.md` as `Convex query caching: <flavor>`; with none recorded, the standard is not adopted, so ask before adding one. Never combine parts of flavors or add per-screen or per-feature caches. Lifetimes and size limits are app values, not part of the flavor.
- One app-owned query module provides `useQuery`, `useQueries`, and `usePaginatedQuery`. Screens never import these from `convex/react`; Biome's `noRestrictedImports` enforces it. Mutations, actions, imperative `client.query`, and connection/auth hooks may still come from `convex/react`.
- Convex queries are live subscriptions with no stale time: never add pull-to-refresh or manual refetch for subscribed data.
- The cache stays below the authentication gate required by [auth](auth.md). It never shows data before Convex authenticates.
- A direct account switch disables the protected query subtree until its live backend identity matches the locally selected account. Convex's authentication boolean alone can still describe the previous account during the transition.

### Layer 1: subscription retention (`retention`, `last-known`)

- `useQuery` and `useQueries` read through `convex-helpers/react/cache`, which keeps a subscription alive after its last consumer unmounts, so remounting with the same function and arguments returns data immediately.
- Retention is always bounded by a finite expiration and a maximum idle count. The app defines both once in the query module and records them with its flavor in `CODING_STANDARDS.md`; there are no per-query lifetimes.
- The provider is keyed by account, so sign-out or account change disposes every subscription. Backgrounding releases idle subscriptions and disables retention until the foreground; mounted subscriptions continue.
- Hooks pass arguments through unchanged and never skip queries on hidden screens.
- `usePaginatedQuery` passes through to `convex/react` unretained.

### Layer 2: last-known value on disk (`last-known` only)

- A disposable copy of query results is read synchronously on mount and shown until the live result replaces it and is written back.
- Arguments and values use Convex's `convexToJson`/`jsonToConvex` codec inside JSON, preserving bigint, bytes, and non-finite numbers. The key, not schema validation, provides correctness: cache version, account, function name, and arguments. The cache version changes with every JS bundle (native build plus OTA update id), so new code never reads an old shape.
- Startup and sign-out delete entries outside the current version and account. Writes are synchronous, so none survives account cleanup. Oversized values are skipped and every insertion enforces the total entry bound; the app records both limits with its retention values.
- Every failure (missing storage, read, parse, write, quota) is a cache miss: the cache never breaks a screen, blocks a write, or holds the only copy of data.
- Persistence is opt-in per backend module through one allowlist in the query module, covering `useQuery` and each `useQueries` request; callers do not change. Batched errors stay errors, never disk fallbacks.
- A cached value is for display only. Code that seeds a form, decides a write, or reads state that must be current (an active session, a lock, a balance) uses the module's `useLiveQuery` or `useLiveQueries`, which skip Layer 2.
- Disk fallback requires Convex-confirmed authentication and a connected socket; an offline cold start never paints persisted data. This is not offline support.
- Never persist search results, paginated or growing history, or functions excluded in the allowlist.
- **Default:** `expo-sqlite/kv-store` for synchronous reads.

## Implementation

1. Install `convex-helpers` at a version whose `convex` peer matches the app. Recheck the retention starter's registry adapter when upgrading it. For `last-known`, also run `pnpm exec expo install expo-sqlite` and rebuild a development client if SQLite is newly added.
2. Copy the flavor's starter into the app's client query folder: [retention](convex-query-caching/examples/retention.tsx), or that file plus [last-known](convex-query-caching/examples/last-known.ts). Mount its `QueryCacheProvider` (`retention`: around the authenticated subtree; `last-known`: above the auth gate, kept mounted while signed out) and pass `account`, `confirmedAccount`, and `fallback`, plus `bundleVersion` for `last-known`, as the starter's header comment specifies. `confirmedAccount` is the live backend viewer query's result, derived from `ctx.auth`; never a disk copy or local identity.
3. Merge the [baseline](baseline.md) Biome fragment, which scopes `noRestrictedImports` to consumer directories. Exclude every app-owned query boundary file (the copied starters and the identity-query adapter); their direct Convex imports implement the boundary.
4. Change screen imports to the module. With `last-known`, move editors and current-state reads to `useLiveQuery`/`useLiveQueries`.
5. Delete per-feature retention or mirrors that the flavor replaces.
6. `last-known` only: to persist another area later, add its backend module to the allowlist, exclude any of its functions that must stay live-only, verify its screens, and delete its local retention.

## Verify

All flavors:

- Leave a screen and return within the expiration: no loading state, and no new subscription on the wire.
- Sign out and switch accounts, including directly while Convex still reports the previous identity: no previous account data appears, protected screens stay unmounted until the live backend account matches, and no old result is written under the new account's key.
- Background the app: idle subscriptions are released, and returning works normally.
- Paginated lists load and paginate as before.

`last-known` only:

- Relaunch on a persisted screen, with auth still loading and then offline: last-known data appears only once the same account authenticates and Convex connects, then updates to live. Confirmed sign-out, even right after a live result, deletes the account's entries.
- Change the bundle version, corrupt a value, make storage throw, and exceed the entry limit: no earlier entries are read, screens load from Convex, and the stored count stays bounded.
- bigint, bytes, and non-finite arguments and results round-trip in single and batched reads; batched errors still surface; an editor opened over cached data waits for live data.
