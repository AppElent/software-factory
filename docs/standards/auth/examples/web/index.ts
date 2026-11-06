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
