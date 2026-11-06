// Starter for the `last-known` flavor, layered on `retention.tsx`. Copied code
// becomes project-owned. Screens import from this file only.
import type { OptionalRestArgsOrSkip, RequestForQueries } from "convex/react";
import { useConvexAuth, useConvexConnectionState } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { getFunctionName } from "convex/server";
import { convexToJson, jsonToConvex, type Value } from "convex/values";
import Storage from "expo-sqlite/kv-store";
import { createContext, createElement, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { QueryCacheProvider as RetentionProvider, useAccountReady, useQueries as useRetainedQueries, useQuery as useRetainedQuery } from "./retention";

export { usePaginatedQuery } from "./retention";

/** Backend modules whose results persist as last-known values. */
const persistedModules = new Set<string>(["nutrition"]);
/** Functions in those modules that must never persist. */
const excludedFunctions = new Set<string>(["nutrition:search"]);

const PREFIX = "qc|";
// App-chosen limits; record them with the flavor in CODING_STANDARDS.md.
const MAX_VALUE_LENGTH = 100_000;
const MAX_ENTRIES = 500;
const QueryCacheScope = createContext<string | undefined>(undefined);

/** Keep mounted above the auth gate, under Convex's auth provider, even signed out. */
export function QueryCacheProvider({ bundleVersion, account, confirmedAccount, fallback, children }: {
	bundleVersion: string;
	/** undefined while auth loads; null only after sign-out is confirmed. */
	account: string | null | undefined;
	/** Current live backend viewer/account result, never a cached or local identity. */
	confirmedAccount: string | null | undefined;
	fallback: ReactNode;
	children: ReactNode;
}) {
	const ready = useAccountReady(account, confirmedAccount);
	const { isAuthenticated } = useConvexAuth();
	const scope = typeof account === "string" ? JSON.stringify([bundleVersion, account]) : undefined;
	useLayoutEffect(() => {
		if (account !== undefined) pruneQueryCache(scope);
	}, [account, scope]);
	return createElement(QueryCacheScope.Provider, { value: ready ? scope : undefined },
		typeof account !== "string"
			? (isAuthenticated ? fallback : children)
			: createElement(RetentionProvider, { key: scope, account, confirmedAccount, fallback, children }));
}

/** Delete entries from other versions or accounts; undefined deletes all cache entries. */
function pruneQueryCache(scope: string | undefined) {
	try {
		const keys = Storage.getAllKeysSync().filter((k: string) => k.startsWith(PREFIX));
		const keep = scope ? `${PREFIX}${scope}|` : undefined;
		const tooMany = keys.length > MAX_ENTRIES;
		for (const key of keys)
			if (tooMany || !keep || !key.startsWith(keep)) Storage.removeItemSync(key);
	} catch {}
}

function cacheKey(scope: string | undefined, query: FunctionReference<"query">, args: Value | "skip") {
	if (!scope || args === "skip") return undefined;
	try {
		const name = getFunctionName(query);
		if (!persistedModules.has(name.split(":")[0]) || excludedFunctions.has(name)) return undefined;
		return `${PREFIX}${scope}|${name}|${JSON.stringify(convexToJson(args))}`;
	} catch {
		return undefined;
	}
}

function read(key: string): Value | undefined {
	try {
		const raw = Storage.getItemSync(key);
		return raw === null ? undefined : jsonToConvex(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function write(key: string, value: Value) {
	try {
		const raw = JSON.stringify(convexToJson(value));
		if (raw.length > MAX_VALUE_LENGTH) {
			Storage.removeItemSync(key);
			return;
		}
		const otherKeys = Storage.getAllKeysSync().filter((k: string) => k.startsWith(PREFIX) && k !== key);
		// Any eviction is acceptable for a disposable cache; no extra LRU metadata.
		for (const oldKey of otherKeys.slice(0, Math.max(0, otherKeys.length - MAX_ENTRIES + 1)))
			Storage.removeItemSync(oldKey);
		// Synchronous writes cannot complete after sign-out pruning.
		Storage.setItemSync(key, raw);
	} catch {}
}

function useDiskScope() {
	const scope = useContext(QueryCacheScope);
	const { isAuthenticated } = useConvexAuth();
	const { isWebSocketConnected } = useConvexConnectionState();
	return isAuthenticated && isWebSocketConnected ? scope : undefined;
}

/** Live-only: retained subscriptions, never disk values. For forms and current state. */
export const useLiveQueries = useRetainedQueries;
export function useLiveQuery<Q extends FunctionReference<"query">>(query: Q, ...args: OptionalRestArgsOrSkip<Q>) {
	return useRetainedQuery(query, ...args) as FunctionReturnType<Q> | undefined;
}

/** Display reads: live value, or last-known while authenticated and connected. */
export function useQuery<Q extends FunctionReference<"query">>(query: Q, ...args: OptionalRestArgsOrSkip<Q>) {
	const live = useLiveQuery(query, ...args);
	const key = cacheKey(useDiskScope(), query, args[0] ?? {});
	const cached = useMemo(() => (key ? read(key) : undefined), [key]);
	useEffect(() => {
		if (key && live !== undefined) write(key, live);
	}, [key, live]);
	return (live === undefined ? cached : live) as FunctionReturnType<Q> | undefined;
}

/** Batched display reads; preserve undefined and Error semantics per request. */
export function useQueries(queries: RequestForQueries): ReturnType<typeof useRetainedQueries> {
	const live = useLiveQueries(queries);
	const scope = useDiskScope();
	const keySignature = JSON.stringify(Object.entries(queries).map(([id, { query, args }]) =>
		[id, cacheKey(scope, query, args) ?? null]));
	const keys = useMemo(() => JSON.parse(keySignature) as [string, string | null][], [keySignature]);
	const pendingSignature = JSON.stringify(keys.filter(([id, key]) => key && live[id] === undefined));
	const cached = useMemo(() => new Map(
		(JSON.parse(pendingSignature) as [string, string][]).map(([id, key]) => [id, read(key)]),
	), [pendingSignature]);
	const lastWritten = useRef(new Map<string, Value>());
	useEffect(() => {
		const next = new Map<string, Value>();
		for (const [id, key] of keys) {
			const value = live[id];
			if (!key || value === undefined || value instanceof Error) continue;
			if (!next.has(key) && !Object.is(lastWritten.current.get(key), value)) write(key, value);
			next.set(key, value);
		}
		lastWritten.current = next;
	}, [keys, live]);
	return Object.fromEntries(Object.keys(queries).map((id) =>
		[id, live[id] === undefined ? cached.get(id) : live[id]]));
}
