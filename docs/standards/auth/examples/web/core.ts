// DOM-free, framework-free logic. No React, browser globals, or styling deps.

export interface TestLoginEnv {
	VITE_CLERK_PUBLISHABLE_KEY?: string;
	VITE_TEST_USER_EMAIL?: string;
}

/** Clerk development instances accept this code for `+clerk_test` emails. */
export const CLERK_TEST_VERIFICATION_CODE = "424242";

/** True for Clerk test emails such as `jane+clerk_test@example.com`. */
export function isClerkTestEmail(email: string | undefined): boolean {
	return !!email && /\+clerk_test@/i.test(email);
}

/**
 * Show the dev test-login button only on a Clerk *test* instance with a
 * `+clerk_test` email provided via env. The test login signs in with Clerk's
 * fixed development verification code, so no password reaches the bundle;
 * the email alone grants nothing on a production instance.
 *
 * This is bundler-agnostic by construction: it takes a plain env object
 * rather than reading `import.meta.env`/`process.env` itself, so any caller
 * can supply it regardless of bundler — Vite (`VITE_*`) on web, Expo
 * (`EXPO_PUBLIC_*`) on mobile, etc. A caller on another bundler maps its own
 * vars onto these `VITE_*` keys, e.g.:
 *
 *   shouldShowTestLogin({
 *     VITE_CLERK_PUBLISHABLE_KEY: env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
 *     VITE_TEST_USER_EMAIL: env.EXPO_PUBLIC_TEST_USER_EMAIL,
 *   })
 */
export function shouldShowTestLogin(env: TestLoginEnv): boolean {
	const onTestInstance =
		!!env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_");
	return onTestInstance && isClerkTestEmail(env.VITE_TEST_USER_EMAIL);
}

/** Second-factor strategies the sign-in example can complete, in preference order. */
export const SECOND_FACTOR_STRATEGIES = [
	"totp",
	"phone_code",
	"email_code",
	"backup_code",
] as const;
export type SecondFactorStrategy = (typeof SECOND_FACTOR_STRATEGIES)[number];

/** Pick the preferred supported second factor, or undefined when none is usable. */
export function pickSecondFactor<T extends { strategy: string }>(
	factors: readonly T[],
): (T & { strategy: SecondFactorStrategy }) | undefined {
	for (const strategy of SECOND_FACTOR_STRATEGIES) {
		const factor = factors.find((f) => f.strategy === strategy);
		if (factor) return factor as T & { strategy: SecondFactorStrategy };
	}
	return undefined;
}

interface ClerkLikeError {
	errors?: { longMessage?: string; message?: string }[];
}

/** Extract a readable message from a thrown Clerk error (or any error). */
export function clerkErrorMessage(
	err: unknown,
	fallback = "Something went wrong.",
): string {
	const e = err as ClerkLikeError;
	const first = e?.errors?.[0];
	return first?.longMessage ?? first?.message ?? fallback;
}

/**
 * Clerk Core 3 resource methods resolve to `{ error }` instead of throwing.
 * Rethrowing keeps each form's single try/catch the one error path, and the
 * error (a `ClerkAPIResponseError` with `errors[]`) still reads through
 * `clerkErrorMessage`.
 */
export async function orThrow(
	pending: Promise<{ error: unknown }>,
): Promise<void> {
	const { error } = await pending;
	if (error) {
		throw error;
	}
}
