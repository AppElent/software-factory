// Starter for the `retention` flavor. Copied code becomes project-owned.
import {
	ConvexQueryCacheProvider,
	useQueries,
	useQuery,
} from "convex-helpers/react/cache";
import { ConvexQueryCacheContext } from "convex-helpers/react/cache/provider";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { type ReactNode, useContext, useEffect } from "react";
import { AppState } from "react-native";

export { usePaginatedQuery, useQueries, useQuery };

// App-chosen bounds; record them with the flavor in CODING_STANDARDS.md.
const EXPIRATION_MS = 5 * 60_000;
const MAX_IDLE_ENTRIES = 20;

// This adapter uses the helper's exposed registry; verify it when upgrading.
function CacheLifecycle({ children }: { children: ReactNode }) {
	const { registry } = useContext(ConvexQueryCacheContext);
	useEffect(() => {
		if (!registry) return;
		const release = (all: boolean) => {
			for (const [key, entry] of registry.queries) {
				if (!all && entry.refs.size !== 0) continue;
				if (entry.evictTimer !== null) clearTimeout(entry.evictTimer);
				entry.unsub();
				registry.queries.delete(key);
			}
			registry.idle = 0;
			if (all) registry.subs.clear();
		};
		const update = (state: string) => {
			const foreground = state === "active";
			registry.timeout = foreground ? EXPIRATION_MS : 0;
			registry.maxIdleEntries = foreground ? MAX_IDLE_ENTRIES : 0;
			if (!foreground) release(false);
		};
		update(AppState.currentState);
		const listener = AppState.addEventListener("change", update);
		return () => {
			listener.remove();
			registry.timeout = 0;
			registry.maxIdleEntries = 0;
			release(true);
		};
	}, [registry]);
	return children;
}

/** A live backend identity must match the locally selected account. */
export function useAccountReady(account: string | null | undefined, confirmedAccount: string | null | undefined) {
	const { isAuthenticated } = useConvexAuth();
	return typeof account === "string" && isAuthenticated && confirmedAccount === account;
}

/** Mount below the auth gate. Account changes disable queries until backend confirmation. */
export function QueryCacheProvider({
	account,
	confirmedAccount,
	fallback,
	children,
}: {
	account: string;
	/** Current live backend viewer/account result, never a cached or local identity. */
	confirmedAccount: string | null | undefined;
	/** App-owned auth loading/recovery UI while the identities do not match. */
	fallback: ReactNode;
	children: ReactNode;
}) {
	const ready = useAccountReady(account, confirmedAccount);
	if (!ready) return fallback;
	return (
		<ConvexQueryCacheProvider
			key={account}
			expiration={EXPIRATION_MS}
			maxIdleEntries={MAX_IDLE_ENTRIES}
		>
			<CacheLifecycle>{children}</CacheLifecycle>
		</ConvexQueryCacheProvider>
	);
}
