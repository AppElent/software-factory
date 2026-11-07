import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { resolveLocale } from "./core";

/**
 * Build the SSR locale-resolution server fn for an app's own locale set.
 * Mirrors the client-side resolution order: cookie, then Accept-Language,
 * then fallback. The result's `locale` is always one of `locales`, typed as
 * `string` here because TanStack's server fn serialization check requires a
 * concrete type, not a generic `L` — cast to the app's own `Locale` union at
 * the call site.
 */
export function createGetSsrLocale<L extends string>(
	locales: readonly L[],
	fallback: L,
	cookieName = "lang",
) {
	return createServerFn({ method: "GET" }).handler((): { locale: string } => ({
		locale: resolveLocale(
			locales,
			fallback,
			getCookie(cookieName),
			getRequestHeader("accept-language"),
		),
	}));
}
