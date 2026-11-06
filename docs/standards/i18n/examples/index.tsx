import {
	createContext,
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

/**
 * Build a locale-set-and-message-shape-specific i18n provider/hooks bundle.
 * Each app calls this once with its own locales and message dictionaries.
 */
export function createI18n<L extends string, M>(config: I18nConfig<L, M>) {
	const { locales, fallback, messages } = config;
	const cookieName = config.cookieName ?? "lang";

	function readLangCookie(): string | undefined {
		const row = document.cookie
			.split("; ")
			.find((entry) => entry.startsWith(`${cookieName}=`));
		return row?.slice(cookieName.length + 1);
	}

	/** Client-side locale resolution (mirrors the server's cookie-first order). */
	function readClientLocale(): L {
		return resolveLocale(
			locales,
			fallback,
			readLangCookie(),
			navigator.language,
		);
	}

	/** True when the user made an explicit choice (cookie set by setLocale). */
	function hasExplicitLocaleChoice(): boolean {
		return isLocale(locales, readLangCookie());
	}

	const I18nContext = createContext<I18nValue<L, M> | null>(null);

	function LocaleProvider({
		initialLocale,
		children,
	}: {
		initialLocale: L;
		children: React.ReactNode;
	}) {
		const [locale, setLocaleState] = useState<L>(initialLocale);

		const setLocale = useCallback((next: L) => {
			setLocaleState(next);
			document.cookie = `${cookieName}=${next}; path=/; max-age=31536000; samesite=lax`;
			document.documentElement.lang = next;
		}, []);

		const value = useMemo<I18nValue<L, M>>(
			() => ({ locale, messages: messages[locale], setLocale }),
			[locale, setLocale],
		);

		return (
			<I18nContext.Provider value={value}>{children}</I18nContext.Provider>
		);
	}

	function useI18n(): I18nValue<L, M> {
		const value = useContext(I18nContext);
		if (!value) {
			throw new Error("useI18n must be used inside LocaleProvider");
		}
		return value;
	}

	function useMessages(): M {
		return useI18n().messages;
	}

	return {
		LocaleProvider,
		useI18n,
		useMessages,
		readClientLocale,
		hasExplicitLocaleChoice,
	};
}
