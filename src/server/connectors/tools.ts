import type { ToolStatus } from "../../shared/types.ts";
import type { Cli } from "../cli.ts";

interface ToolDef {
	name: string;
	purpose: string;
	required: boolean;
	version: string[];
	/** Auth command. Absent means installed is enough. */
	auth?: string[];
	login?: string;
	signedIn?: (out: string) => string;
	install: string;
	whyRequired?: string;
	whyOptional?: string;
}

export const TOOLS: ToolDef[] = [
	{
		name: "gh",
		purpose: "Pull requests and repos",
		required: true,
		version: ["--version"],
		auth: ["auth", "status"],
		login: "gh auth login",
		signedIn: (out) => {
			const m = out.match(/account (\S+)/);
			return m ? `Signed in as ${m[1]}` : "Signed in";
		},
		install: "brew install gh",
		whyRequired: "Required. Projects and PRs come from GitHub.",
	},
	{
		name: "t3",
		purpose: "Runs the agents",
		required: true,
		version: ["--version"],
		install: "brew install --cask t3-code",
		whyRequired: "Required. Agents run in T3.",
	},
	{
		name: "sentry",
		purpose: "Production errors",
		required: false,
		version: ["--version"],
		auth: ["auth", "status"],
		login: "sentry auth login",
		install: "brew install getsentry/tools/sentry-cli",
		whyOptional: "Optional. Without it, errors don't reach the queue.",
	},
	{
		name: "eas",
		purpose: "App builds and deploys",
		required: false,
		version: ["--version"],
		auth: ["whoami"],
		login: "eas login",
		install: "npm install -g eas-cli",
		whyOptional: "Optional. Without it, app deploys aren't tracked.",
	},
	{
		name: "wrangler",
		purpose: "Cloudflare deploys",
		required: false,
		version: ["--version"],
		auth: ["whoami"],
		login: "wrangler login",
		install: "npm install -g wrangler",
		whyOptional: "Optional. Without it, Cloudflare deploys aren't tracked.",
	},
	{
		name: "infisical",
		purpose: "Secrets for new projects",
		required: false,
		version: ["--version"],
		install: "brew install infisical",
		whyOptional: "Optional. Without it, new projects skip the secrets step.",
	},
	{
		name: "terminal-notifier",
		purpose: "macOS notifications",
		required: false,
		version: ["-version"],
		install: "brew install terminal-notifier",
		whyOptional: "Optional. Without it, notifications don't go out.",
	},
];

export async function checkTool(cli: Cli, def: ToolDef): Promise<ToolStatus> {
	const base = { name: def.name, purpose: def.purpose, required: def.required };
	const why = def.whyRequired ?? def.whyOptional ?? "";
	const ver = await cli(def.name, def.version, { timeoutMs: 20_000 });
	if (ver.missing) {
		return { ...base, state: "missing", detail: `Not installed. ${why}`, fix: def.install, version: null };
	}
	const version = ver.stdout.split("\n")[0]?.trim() || null;
	if (!def.auth) return { ...base, state: "ready", detail: "Ready", fix: null, version };
	const auth = await cli(def.name, def.auth, { timeoutMs: 20_000 });
	if (auth.code !== 0) {
		return { ...base, state: "signed_out", detail: `Not signed in. ${why}`, fix: def.login ?? null, version };
	}
	const out = `${auth.stdout}\n${auth.stderr}`;
	return { ...base, state: "ready", detail: def.signedIn?.(out) ?? "Signed in", fix: null, version };
}

export const checkTools = (cli: Cli) => Promise.all(TOOLS.map((t) => checkTool(cli, t)));
