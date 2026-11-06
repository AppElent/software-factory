/**
 * Headless auth behavior for native consumers.
 *
 * This module intentionally has no Clerk or Expo import. Apps adapt the Clerk
 * generation they use to the small password-sign-in port below, then provide
 * their own translated copy and navigation/provisioning behavior.
 */

export type CodedClerkError = {
	code?: unknown;
	message?: unknown;
	longMessage?: unknown;
	errors?: unknown;
};

export type ClerkErrorMessages = Readonly<Record<string, string>>;

export type ClerkErrorMessageOptions = {
	messages: ClerkErrorMessages;
	/** Maps Clerk's stable error codes to keys in `messages`. */
	codeMap?: Readonly<Record<string, string>>;
	/** Defaults to `generic`. */
	genericKey?: string;
	/** Used when no translated generic message is present. */
	fallback?: string;
	onUnknownCode?: (code: string) => void;
};

export type ClerkErrorSignal = {
	fields?: Record<string, unknown>;
	global?: readonly unknown[] | null;
};

/** The stable Clerk codes shared by the web and Expo adapters. */
export const DEFAULT_CLERK_ERROR_MAP: Readonly<Record<string, string>> = {
	form_identifier_not_found: "identifierNotFound",
	form_password_incorrect: "passwordIncorrect",
	form_identifier_exists: "identifierExists",
	form_param_format_invalid: "emailInvalid",
	form_param_nil: "required",
	form_param_missing: "required",
	form_password_length_too_short: "passwordTooShort",
	form_password_pwned: "passwordPwned",
	form_password_validation_failed: "passwordDoesNotMeetRequirements",
	form_code_incorrect: "codeIncorrect",
	verification_failed: "codeIncorrect",
	verification_expired: "codeExpired",
	too_many_requests: "tooManyRequests",
	rate_limit_exceeded: "tooManyRequests",
	network_error: "network",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function findClerkErrorCode(
	error: unknown,
	seen: WeakSet<object>,
	depth: number,
): string | null {
	if (!isRecord(error) || depth > 8 || seen.has(error)) return null;
	seen.add(error);
	if (Object.hasOwn(error, "code") && typeof error.code === "string") {
		return error.code;
	}
	if (Object.hasOwn(error, "errors") && Array.isArray(error.errors)) {
		for (const nested of error.errors) {
			const code = findClerkErrorCode(nested, seen, depth + 1);
			if (code) return code;
		}
	}
	return null;
}

/** Read a machine-stable code without exposing Clerk's provider message. */
export function clerkErrorCode(error: unknown): string | null {
	return findClerkErrorCode(error, new WeakSet<object>(), 0);
}
/** Map a Clerk error to app-owned translated copy. */
export function readClerkError(
	error: unknown,
	options: ClerkErrorMessageOptions,
): string | null {
	if (!error) return null;
	const code = clerkErrorCode(error);
	const key = code && (options.codeMap ?? DEFAULT_CLERK_ERROR_MAP)[code];
	if (code && !key) options.onUnknownCode?.(code);
	const mapped = key ? options.messages[key] : undefined;
	return (
		mapped ??
		options.messages[options.genericKey ?? "generic"] ??
		options.fallback ??
		"Something went wrong. Please try again."
	);
}

/** Read the first field/global error from a Core 3 error signal. */
export function readClerkErrors(
	errors: ClerkErrorSignal | null | undefined,
	options: ClerkErrorMessageOptions,
): string | null {
	if (!errors) return null;
	for (const value of Object.values(errors.fields ?? {})) {
		if (Array.isArray(value)) {
			for (const fieldError of value) {
				const message = readClerkError(fieldError, options);
				if (message) return message;
			}
		} else {
			const message = readClerkError(value, options);
			if (message) return message;
		}
	}
	return readClerkError(errors.global?.[0], options);
}

/** Prefer the refreshed Core 3 signal, then the method's returned wrapper. */
export function pickClerkError(
	errors: ClerkErrorSignal | null | undefined,
	returned: unknown,
	options: ClerkErrorMessageOptions,
): string | null {
	return readClerkErrors(errors, options) ?? readClerkError(returned, options);
}

/** Normalize errors thrown by Core 2 resource methods. */
export function readThrownClerkError(
	error: unknown,
	options: ClerkErrorMessageOptions,
): string {
	return (
		readClerkError(error, options) ??
		options.fallback ??
		"Something went wrong. Please try again."
	);
}

export type PasswordSignInInput = {
	identifier: string;
	password: string;
};

export type PasswordSignInOutcome =
	| { status: "complete" }
	| { status: "error"; error: unknown }
	| { status: "unsupported"; clerkStatus: string };

export type PasswordSignInAdapter = {
	submit(input: PasswordSignInInput): Promise<PasswordSignInOutcome>;
};

export type Core3PasswordSignIn = {
	password(input: PasswordSignInInput): Promise<{ error?: unknown | null }>;
	readonly status?: string;
	finalize(): Promise<{ error?: unknown | null }>;
};

/** Adapt `@clerk/expo` Core 3's result-and-finalize flow. */
export function createCore3PasswordSignInAdapter(
	signIn: Core3PasswordSignIn,
): PasswordSignInAdapter {
	return {
		async submit(input) {
			try {
				const attempt = await signIn.password({
					identifier: input.identifier.trim(),
					password: input.password,
				});
				if (attempt.error) return { status: "error", error: attempt.error };
				if (signIn.status !== "complete") {
					return {
						status: "unsupported",
						clerkStatus: signIn.status ?? "unknown",
					};
				}
				const finalized = await signIn.finalize();
				return finalized.error
					? { status: "error", error: finalized.error }
					: { status: "complete" };
			} catch (error) {
				return { status: "error", error };
			}
		},
	};
}

export type Core2PasswordSignIn = {
	create(input: PasswordSignInInput): Promise<{
		status: string;
		createdSessionId?: string | null;
	}>;
};

/** Adapt `@clerk/clerk-react` Core 2's throwing `create`/`setActive` flow. */
export function createCore2PasswordSignInAdapter(
	signIn: Core2PasswordSignIn,
	setActive: (params: { session: string }) => Promise<unknown> | unknown,
): PasswordSignInAdapter {
	return {
		async submit(input) {
			try {
				const result = await signIn.create({
					identifier: input.identifier.trim(),
					password: input.password,
				});
				if (result.status !== "complete") {
					return { status: "unsupported", clerkStatus: result.status };
				}
				if (!result.createdSessionId) {
					return {
						status: "error",
						error: new Error("Clerk completed sign-in without a session"),
					};
				}
				await setActive({ session: result.createdSessionId });
				return { status: "complete" };
			} catch (error) {
				return { status: "error", error };
			}
		},
	};
}

export type NativeAuthPhase = "loading" | "signed-out" | "signed-in";

/** Keep native route guards on Clerk state, never on the backend handshake. */
export function resolveNativeAuthPhase(input: {
	isLoaded: boolean;
	isSignedIn: boolean | undefined;
}): NativeAuthPhase {
	if (!input.isLoaded || input.isSignedIn === undefined) return "loading";
	return input.isSignedIn ? "signed-in" : "signed-out";
}
