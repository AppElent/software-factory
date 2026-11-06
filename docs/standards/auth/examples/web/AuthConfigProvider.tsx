import { createContext, useContext } from "react";
import type { AuthConfig } from "./types";

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
	appName: "ArchStudio",
	paths: {
		signIn: "/sign-in",
		signUp: "/sign-up",
		forgotPassword: "/forgot-password",
		afterAuth: "/dashboard",
		account: "/account",
	},
	features: { forgotPassword: true },
	socialProviders: [],
};

const AuthConfigContext = createContext<AuthConfig>(DEFAULT_AUTH_CONFIG);

export function AuthConfigProvider({
	config = DEFAULT_AUTH_CONFIG,
	children,
}: {
	config?: AuthConfig;
	children: React.ReactNode;
}) {
	return (
		<AuthConfigContext.Provider value={config}>
			{children}
		</AuthConfigContext.Provider>
	);
}

export function useAuthConfig(): AuthConfig {
	return useContext(AuthConfigContext);
}
