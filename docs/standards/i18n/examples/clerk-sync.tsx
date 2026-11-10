import { useUser } from "@clerk/react";
import { useEffect } from "react";
import { isLocale } from "./core";
import {
	hasExplicitLocaleChoice,
	type I18nConfig,
	useLocaleContext,
} from "./index";

export type LanguageSyncProps<L extends string, M> = {
	/** The app's module-level config; the same object passed to `createI18n`. */
	config: I18nConfig<L, M>;
};

/**
 * Mirror an explicit locale choice into Clerk's `unsafeMetadata.language` so it
 * follows a signed-in user across devices. Render `<LanguageSync config={config} />`
 * inside `LocaleProvider`. The cookie (via `hasExplicitLocaleChoice`) stays the
 * source of truth for an explicit choice; this is a best-effort mirror.
 */
export function LanguageSync<L extends string, M>({
	config,
}: LanguageSyncProps<L, M>) {
	const { user } = useUser();
	const { locale, setLocale } = useLocaleContext<L, M>();
	const userId = user?.id;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `user` identity changes on every update() — keying on userId/locale is deliberate to avoid a sync loop.
	useEffect(() => {
		if (!user) {
			return;
		}
		const saved = user.unsafeMetadata?.language;
		const savedLocale = isLocale(config.locales, saved) ? saved : undefined;
		if (savedLocale === locale) {
			return;
		}
		if (savedLocale && !hasExplicitLocaleChoice(config)) {
			setLocale(savedLocale);
			return;
		}
		user
			.update({
				unsafeMetadata: { ...user.unsafeMetadata, language: locale },
			})
			.catch(() => {
				// Best-effort sync; the cookie already holds the choice locally.
			});
	}, [config, userId, locale, setLocale]);

	return null;
}
