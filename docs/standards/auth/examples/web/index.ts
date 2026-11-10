// Web account UI starter for @clerk/react (Clerk Core 3) custom flows. Copy this
// file and its siblings into an app-owned directory, preserving relative imports.
//
// Provides sign-in, sign-up, password reset, profile, header user menu, test
// login, and light/dark theme helpers. Needs react, @clerk/react, clsx,
// tailwind-merge, and lucide-react.
//
// Clerk Core 3 methods resolve to `{ error }` instead of throwing; `orThrow`
// keeps one catch path. Sign-in finalizes with `signIn.finalize()` after MFA or
// device-trust (`needs_client_trust`) verification.
//
// Test login needs a `pk_test_` key, email-code sign-in enabled, and a
// `+clerk_test` `VITE_TEST_USER_EMAIL`. It uses Clerk's development
// verification code, so no password is configured.

// Components

export { AppearanceSettings } from "./AppearanceSettings";
export { AuthButton } from "./AuthButton";
export { AuthCard } from "./AuthCard";
export {
	AuthConfigProvider,
	DEFAULT_AUTH_CONFIG,
	useAuthConfig,
} from "./AuthConfigProvider";
export { AuthError } from "./AuthError";
export { AuthField } from "./AuthField";
export { ForgotPasswordForm } from "./ForgotPasswordForm";
export { ProfilePanel } from "./ProfilePanel";
export { SignInForm } from "./SignInForm";
export { SignUpForm } from "./SignUpForm";
export { TestLoginButton } from "./TestLoginButton";
export type { AuthConfig, SlotClassNames, SocialProvider } from "./types";
export { ThemeSync } from "./ThemeSync";
// Lib
export {
	CLERK_TEST_VERIFICATION_CODE,
	clerkErrorMessage,
	isClerkTestEmail,
	orThrow,
	pickSecondFactor,
	type SecondFactorStrategy,
	shouldShowTestLogin,
} from "./core";
export { default as HeaderUser } from "./HeaderUser";
export {
	applyThemeMode,
	getInitialMode,
	reconcileTheme,
	setThemeMode,
	THEME_INIT_SCRIPT,
	type ThemeMode,
} from "./theme";
