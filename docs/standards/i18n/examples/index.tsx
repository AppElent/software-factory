import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { isLocale, resolveLocale } from "./core";

export { fmt, isLocale, plural, resolveLocale } from "./core";

export type I18nConfig<L extends string, M> = {
	locales: readonly L[];
	fallback: L;
	/** Cookie name that stores an explicit user language choice. Defaults to "lang". */
	cookieName?: string;
	messages: Record<L, M>;
};

export type I18nValue<L extends string, M> = {
	locale: L;
	messages: M;
	setLocale: (locale: L) => void;
};

export type LocaleProviderProps<L extends string, M> = {
	/** The app's module-level config; the same object passed to `createI18n`. */
	config: I18nConfig<L, M>;
	initialLocale: L;
	children: ReactNode;
};

// Components and hooks live at module scope (Biome's noComponentHookFactories);
// `createI18n` only binds their types to the app's locales.
// The context is untyped; `useLocaleContext<L, M>` restores the app's types.
const I18nContext = createContext<unknown>(null);

function cookieNameOf<L extends string, M>(config: I18nConfig<L, M>): string {
	return config.cookieName ?? "lang";
}

function readLangCookie(cookieName: string): string | undefined {
	const row = document.cookie
		.split("; ")
		.find((entry) => entry.startsWith(`${cookieName}=`));
	return row?.slice(cookieName.length + 1);
}

/** Client-side locale resolution (mirrors the server's cookie-first order). */
export function readClientLocale<L extends string, M>(
	config: I18nConfig<L, M>,
): L {
	return resolveLocale(
		config.locales,
		config.fallback,
		readLangCookie(cookieNameOf(config)),
		navigator.language,
	);
}

/** True when the user made an explicit choice (cookie set by setLocale). */
export function hasExplicitLocaleChoice<L extends string, M>(
	config: I18nConfig<L, M>,
): boolean {
	return isLocale(config.locales, readLangCookie(cookieNameOf(config)));
}

export function LocaleProvider<L extends string, M>({
	config,
	initialLocale,
	children,
}: LocaleProviderProps<L, M>) {
	const [locale, setLocaleState] = useState<L>(initialLocale);
	const cookieName = cookieNameOf(config);

	const setLocale = useCallback(
		(next: L) => {
			setLocaleState(next);
			document.cookie = `${cookieName}=${next}; path=/; max-age=31536000; samesite=lax`;
			document.documentElement.lang = next;
		},
		[cookieName],
	);

	const value = useMemo<I18nValue<L, M>>(
		() => ({ locale, messages: config.messages[locale], setLocale }),
		[config.messages, locale, setLocale],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Context read; apps use the `useI18n` that `createI18n` binds to their types. */
export function useLocaleContext<L extends string, M>(): I18nValue<L, M> {
	const value = useContext(I18nContext);
	if (!value) {
		throw new Error("useI18n must be used inside LocaleProvider");
	}
	return value as I18nValue<L, M>;
}

function useLocaleMessages<L extends string, M>(): M {
	return useLocaleContext<L, M>().messages;
}

/**
 * Bind the module-level provider, hooks, and helpers to one app's locales and
 * message shape. Call it once at module scope with a module-level config, and
 * render `<LocaleProvider config={config} initialLocale={…}>`.
 */
export function createI18n<L extends string, M>(config: I18nConfig<L, M>) {
	return {
		config,
		LocaleProvider: LocaleProvider<L, M>,
		useI18n: useLocaleContext<L, M>,
		useMessages: useLocaleMessages<L, M>,
		readClientLocale: (): L => readClientLocale(config),
		hasExplicitLocaleChoice: (): boolean => hasExplicitLocaleChoice(config),
	};
}
