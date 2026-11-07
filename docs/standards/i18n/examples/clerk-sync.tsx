import { useUser } from "@clerk/react";
import { useEffect } from "react";
import { isLocale } from "./core";
import type { I18nValue } from "./index";

export type LanguageSyncDeps<L extends string, M> = {
	useI18n: () => I18nValue<L, M>;
	hasExplicitLocaleChoice: () => boolean;
	locales: readonly L[];
};

/**
 * Build a `<LanguageSync />` component that mirrors an explicit locale
 * choice into Clerk's `unsafeMetadata.language` so it follows a signed-in
 * user across devices. The cookie (via `hasExplicitLocaleChoice`) stays the
 * source of truth for an explicit choice; this is a best-effort mirror.
 */
export function createLanguageSync<L extends string, M>({
	useI18n,
	hasExplicitLocaleChoice,
	locales,
}: LanguageSyncDeps<L, M>) {
	return function LanguageSync() {
		const { user } = useUser();
		const { locale, setLocale } = useI18n();
		const userId = user?.id;

		// biome-ignore lint/correctness/useExhaustiveDependencies: `user` identity changes on every update() — keying on userId/locale is deliberate to avoid a sync loop.
		useEffect(() => {
			if (!user) {
				return;
			}
			const saved = user.unsafeMetadata?.language;
			const savedLocale = isLocale(locales, saved) ? saved : undefined;
			if (savedLocale === locale) {
				return;
			}
			if (savedLocale && !hasExplicitLocaleChoice()) {
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
		}, [userId, locale, setLocale]);

		return null;
	};
}
