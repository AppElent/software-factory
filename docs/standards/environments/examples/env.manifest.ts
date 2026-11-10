// Copy to env.manifest.ts at the app root and delete what the app does not use.
// Values live in Infisical, never here. Routing is the shared model in
// docs/standards/environments.md: entries say which consumer reads a value in
// which environment; the engine picks the destination.
// Optional typing: import type { EnvironmentEntry } from "./scripts/lib/env/types.ts";

export const ENV_CONFIG = {
	appName: "replace-app",
	source: { paths: ["/", "/replace-app"] },
	convex: {
		project: "replace-team:replace-app",
		deployments: { production: "replace-prod-deployment" },
	},
	worker: { name: "replace-app" },
	mobile: { path: "apps/mobile" },
	github: { repository: "AppElent/replace-app" },
};

// Infisical tiers follow lifetime: local reads dev; preview (short-lived web PR
// previews) reads staging; staging and production read prod. "staging" is also the
// installed preview app (EAS preview), so a mobile app lists it even without a
// staging web. For a staging web, add "staging" to WEB and WEB_DEPLOYED, set
// convex.deployments.staging, and add an entry for its own `prod:` deploy key
// (infisicalKey "convex-staging-deploy-key", in Infisical prod) landing on workflow
// for staging only.
export const ENVIRONMENTS = ["local", "preview", "staging", "production"] as const;

const WEB = ["local", "preview", "production"];
const WEB_DEPLOYED = ["preview", "production"];
// Installed apps: the preview app reads staging, the store app production.
const APP = ["staging", "production"];

export const ENTRIES = [
	{
		key: "convexUrl",
		infisicalKey: "convex-url",
		description: "Convex client URL",
		secret: false,
		lands: {
			"vite-build": {
				name: "VITE_CONVEX_URL",
				environments: WEB,
				suppliedIn: { preview: "convex deploy", production: "convex deploy" },
			},
			"expo-build": { name: "EXPO_PUBLIC_CONVEX_URL", environments: APP },
			"expo-local": { name: "EXPO_PUBLIC_CONVEX_URL", environments: ["local"] },
		},
	},
	{
		key: "convexDeployKey",
		infisicalKey: "convex-deploy-key",
		description: "Deploy key: preview kind in Infisical staging, production kind in prod",
		secret: true,
		lands: { workflow: { name: "CONVEX_DEPLOY_KEY", environments: WEB_DEPLOYED } },
	},
	{
		key: "clerkPublishableKey",
		infisicalKey: "clerk-publishable-key",
		description: "pk_test_ in Infisical dev and staging, pk_live_ in prod",
		secret: false,
		lands: {
			"vite-build": { name: "VITE_CLERK_PUBLISHABLE_KEY", environments: WEB },
			"expo-build": { name: "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", environments: APP },
			"expo-local": { name: "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", environments: ["local"] },
		},
	},
	{
		key: "clerkJwtIssuerDomain",
		infisicalKey: "clerk-jwt-issuer-domain",
		description: "Issuer Convex trusts",
		secret: false,
		lands: { "convex-functions": { name: "CLERK_JWT_ISSUER_DOMAIN", environments: WEB } },
	},
	{
		key: "testUserEmail",
		infisicalKey: "test-user-email",
		description: "+clerk_test address on the development instance",
		optional: true,
		secret: false,
		lands: { "vite-build": { name: "VITE_TEST_USER_EMAIL", environments: ["local"] } },
	},
	{
		key: "sentryDsn",
		infisicalKey: "sentry-dsn",
		description: "Public Sentry DSN",
		optional: true,
		secret: false,
		lands: { "vite-build": { name: "VITE_SENTRY_DSN", environments: WEB_DEPLOYED } },
	},
	{
		key: "sentryAuthToken",
		infisicalKey: "sentry-auth-token",
		description: "Source-map upload token",
		optional: true,
		secret: true,
		lands: {
			workflow: { name: "SENTRY_AUTH_TOKEN", environments: WEB_DEPLOYED },
			"eas-tooling": { name: "SENTRY_AUTH_TOKEN", environments: APP },
		},
	},
	{
		key: "cloudflareApiToken",
		infisicalKey: "cloudflare-api-token",
		description: "Worker deploy token",
		secret: true,
		lands: { workflow: { name: "CLOUDFLARE_API_TOKEN", environments: WEB_DEPLOYED } },
	},
	{
		key: "cloudflareAccountId",
		infisicalKey: "cloudflare-account-id",
		description: "Cloudflare account for Worker deploys",
		secret: false,
		lands: { workflow: { name: "CLOUDFLARE_ACCOUNT_ID", environments: WEB_DEPLOYED } },
	},
];
