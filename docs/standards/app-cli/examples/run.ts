import { ArgsError, parseArgs } from "./args";
import type { BrowserLoginOptions } from "./callbackServer";
import { handleAuthCommand } from "./commands/auth";
import { handleConfigCommand } from "./commands/config";
import { CliError, formatError } from "./errors";

export type IoRuntime = {
	writeOut: (value: string) => void;
	writeErr: (value: string) => void;
	env: Record<string, string | undefined>;
};

export type CliRuntime = IoRuntime & {
	appName: string;
	defaultApiUrl: string;
	auth?: BrowserLoginOptions;
};

export type CliResult = {
	exitCode: number;
};

export type CliCommand = {
	name: string;
	usage: string[];
	handle: (
		positionals: string[],
		flags: Record<string, string | boolean>,
		runtime: CliRuntime,
	) => Promise<number>;
};

export type RunCliOptions = {
	appName: string;
	defaultApiUrl?: string;
	auth?: BrowserLoginOptions;
	commands?: CliCommand[];
};

const DEFAULT_API_URL = "http://localhost:3000";

function buildHelp(appName: string, commands: CliCommand[]): string {
	const lines = [
		appName,
		"",
		"Usage:",
		`  ${appName} auth login`,
		`  ${appName} auth status`,
		`  ${appName} auth logout`,
		`  ${appName} config get`,
		`  ${appName} config set api-url <value>`,
		`  ${appName} config set convex-url <value>`,
		...commands.flatMap((command) => command.usage.map((line) => `  ${line}`)),
		"",
		"Options:",
		"  --json      Print machine-readable JSON",
		"  --help      Show help",
	];
	return `${lines.join("\n")}\n`;
}

export async function runCli(
	args: string[],
	ioRuntime: IoRuntime,
	options: RunCliOptions,
): Promise<CliResult> {
	const commands = options.commands ?? [];
	const runtime: CliRuntime = {
		...ioRuntime,
		appName: options.appName,
		defaultApiUrl: options.defaultApiUrl ?? DEFAULT_API_URL,
		auth: options.auth,
	};

	try {
		const parsed = parseArgs(args);
		if (
			args.length === 0 ||
			parsed.flags.help === true ||
			parsed.flags.h === true
		) {
			runtime.writeOut(buildHelp(options.appName, commands));
			return { exitCode: 0 };
		}

		if (parsed.positionals[0] === "auth") {
			const exitCode = await handleAuthCommand(
				parsed.positionals,
				parsed.flags,
				runtime,
			);
			return { exitCode };
		}

		if (parsed.positionals[0] === "config") {
			const exitCode = await handleConfigCommand(
				parsed.positionals,
				parsed.flags,
				runtime,
			);
			return { exitCode };
		}

		const command = commands.find(
			(candidate) => candidate.name === parsed.positionals[0],
		);
		if (command) {
			const exitCode = await command.handle(
				parsed.positionals,
				parsed.flags,
				runtime,
			);
			return { exitCode };
		}

		const commandText =
			parsed.positionals.length > 0
				? parsed.positionals.join(" ")
				: args.join(" ");
		throw new CliError("Usage", `Unknown command: ${commandText}`);
	} catch (caughtError) {
		const error =
			caughtError instanceof ArgsError
				? new CliError("Usage", caughtError.message)
				: caughtError;
		runtime.writeErr(formatError(error, options.appName));
		return { exitCode: 1 };
	}
}
