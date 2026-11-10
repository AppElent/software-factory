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

export type NativeI18nValue<L extends string, M> = {
	locale: L;
	messages: M;
	setLocale: (locale: L) => void;
};

export type NativeLocaleProviderProps<L extends string, M> = {
	/** The app's module-level config; the same object passed to `createNativeI18n`. */
	config: NativeLocaleConfig<L, M>;
	children: ReactNode;
};

// Components and hooks live at module scope (Biome's noComponentHookFactories);
// `createNativeI18n` only binds their types to the app's locales.
// The context is untyped; `useLocaleContext<L, M>` restores the app's types.
const Context = createContext<unknown>(null);

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

/** Resolve the first-paint locale: stored choice, then device locales, then fallback. */
export function readInitialLocale<L extends string, M>(
	config: NativeLocaleConfig<L, M>,
): L {
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

export function hasExplicitLocaleChoice<L extends string, M>(
	config: NativeLocaleConfig<L, M>,
): boolean {
	return isLocale(config.locales, readStored(config));
}

/** Synchronous-first-paint locale provider for a native app. */
export function LocaleProvider<L extends string, M>({
	config,
	children,
}: NativeLocaleProviderProps<L, M>) {
	const [locale, setLocaleState] = useState(() => readInitialLocale(config));
	const setLocale = useCallback(
		(next: L) => {
			if (!isLocale(config.locales, next)) return;
			setLocaleState(next);
			try {
				config.writeStoredLocale?.(next);
			} catch {
				// Persistence is best effort; the current session still changes.
			}
		},
		[config],
	);
	const value = useMemo<NativeI18nValue<L, M>>(
		() => ({ locale, messages: config.messages[locale], setLocale }),
		[config, locale, setLocale],
	);
	return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Context read; apps use the `useI18n` that `createNativeI18n` binds to their types. */
export function useLocaleContext<L extends string, M>(): NativeI18nValue<L, M> {
	const value = useContext(Context);
	if (!value) throw new Error("useI18n must be used within a LocaleProvider");
	return value as NativeI18nValue<L, M>;
}

function useLocaleMessages<L extends string, M>(): M {
	return useLocaleContext<L, M>().messages;
}

/**
 * Bind the module-level provider, hooks, and helpers to one app's locales and
 * message shape. Call it once at module scope with a module-level config, and
 * render `<LocaleProvider config={config}>`.
 */
export function createNativeI18n<L extends string, M>(
	config: NativeLocaleConfig<L, M>,
) {
	return {
		config,
		LocaleProvider: LocaleProvider<L, M>,
		useI18n: useLocaleContext<L, M>,
		useMessages: useLocaleMessages<L, M>,
		readInitialLocale: (): L => readInitialLocale(config),
		hasExplicitLocaleChoice: (): boolean => hasExplicitLocaleChoice(config),
	};
}

export { fmt, isLocale, plural, resolveLocale } from "./core";
