import { getStringFlag } from "../args";
import { getCredentialStatus, logout, saveToken } from "../auth";
import { startBrowserLogin } from "../callbackServer";
import { CliError } from "../errors";
import { formatJson } from "../output";
import type { CliRuntime } from "../run";

export async function handleAuthCommand(
	positionals: string[],
	flags: Record<string, string | boolean>,
	runtime: CliRuntime,
): Promise<number> {
	const { appName } = runtime;

	function authUsage(): never {
		throw new CliError("Usage", `Usage: ${appName} auth login|status|logout`);
	}

	function loginUsage(): never {
		throw new CliError("Usage", `Usage: ${appName} auth login --token <token>`);
	}

	const subcommand = positionals[1];

	if (subcommand === "login") {
		if (positionals.length !== 2) authUsage();
		if (Object.keys(flags).some((key) => key !== "token")) loginUsage();
		if (flags.token === true) loginUsage();

		const token = getStringFlag(flags, "token");
		if (token !== undefined) {
			if (token.trim().length === 0 || token.trim() !== token) {
				loginUsage();
			}

			await saveToken(token, runtime);
			runtime.writeOut("Signed in with token.\n");
			return 0;
		}

		await startBrowserLogin(runtime);
		runtime.writeOut("Signed in through browser.\n");
		return 0;
	}

	if (subcommand === "status") {
		if (positionals.length !== 2) authUsage();
		if (Object.keys(flags).some((key) => key !== "json")) authUsage();

		const status = await getCredentialStatus(runtime);
		if (flags.json === true) {
			runtime.writeOut(
				formatJson({
					signedIn: status.signedIn,
					expiresAt: status.expiresAt,
				}),
			);
			return 0;
		}

		if (!status.signedIn) {
			runtime.writeOut("Not signed in.\n");
		} else if (status.expired) {
			runtime.writeOut("Expired auth.\n");
		} else {
			runtime.writeOut("Signed in.\n");
		}
		return 0;
	}

	if (subcommand === "logout") {
		if (positionals.length !== 2) authUsage();
		if (Object.keys(flags).length > 0) authUsage();

		await logout(runtime);
		runtime.writeOut("Signed out of the CLI.\n");
		return 0;
	}

	authUsage();
}
