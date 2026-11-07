/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CLERK_PUBLISHABLE_KEY: string;
	/** Dev-only `+clerk_test` email for the test-login button; never a password. */
	readonly VITE_TEST_USER_EMAIL?: string;
}
