/**
 * React Native-safe locale runtime.
 *
 * No Expo, DOM, cookie, or navigator imports belong here. A native app injects
 * its synchronous device-locale reader and preference store, keeping platform
 * provisioning and app dictionaries outside this module.
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { isLocale, resolveLocale } from "./core";

export type NativeDeviceLocale = string | { languageTag?: string | null };

export type NativeLocaleConfig<L extends string, M> = {
	locales: readonly L[];
	fallback: L;
	messages: Record<L, M>;
	getDeviceLocales: () => readonly NativeDeviceLocale[] | string;
	readStoredLocale?: () => unknown;
	writeStoredLocale?: (locale: L) => void;
};

function deviceLocaleHeader(
	value: readonly NativeDeviceLocale[] | string,
): string {
	if (typeof value === "string") return value;
	return value
		.map((item) => (typeof item === "string" ? item : (item.languageTag ?? "")))
		.filter(Boolean)
		.join(",");
}

function readStored<L extends string, M>(
	config: NativeLocaleConfig<L, M>,
): unknown {
	try {
		return config.readStoredLocale?.();
	} catch {
		return undefined;
	}
}

/** Build a synchronous-first-paint locale provider for a native app. */
export function createNativeI18n<L extends string, M>(
	config: NativeLocaleConfig<L, M>,
) {
	function readInitialLocale(): L {
		let deviceLocales: readonly NativeDeviceLocale[] | string = "";
		try {
			deviceLocales = config.getDeviceLocales();
		} catch {
			// An unavailable native locale module falls back to the configured locale.
		}
		const stored = readStored(config);
		return resolveLocale(
			config.locales,
			config.fallback,
			isLocale(config.locales, stored) ? stored : undefined,
			deviceLocaleHeader(deviceLocales),
		);
	}

	function hasExplicitLocaleChoice(): boolean {
		return isLocale(config.locales, readStored(config));
	}

	const Context = createContext<{
		locale: L;
		messages: M;
		setLocale: (locale: L) => void;
	} | null>(null);

	function LocaleProvider({ children }: { children: ReactNode }) {
		const [locale, setLocaleState] = useState(readInitialLocale);
		const setLocale = useCallback((next: L) => {
			if (!isLocale(config.locales, next)) return;
			setLocaleState(next);
			try {
				config.writeStoredLocale?.(next);
			} catch {
				// Persistence is best effort; the current session still changes.
			}
		}, []);
		const value = useMemo(
			() => ({ locale, messages: config.messages[locale], setLocale }),
			[locale, setLocale],
		);
		return <Context.Provider value={value}>{children}</Context.Provider>;
	}

	function useI18n() {
		const value = useContext(Context);
		if (!value) throw new Error("useI18n must be used within a LocaleProvider");
		return value;
	}

	function useMessages(): M {
		return useI18n().messages;
	}

	return {
		LocaleProvider,
		useI18n,
		useMessages,
		readInitialLocale,
		hasExplicitLocaleChoice,
	};
}

export { fmt, isLocale, plural, resolveLocale } from "./core";
