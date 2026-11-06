import { loadConfig, saveConfig } from "../config";
import { CliError } from "../errors";
import { formatDetail, formatJson } from "../output";
import type { CliRuntime } from "../run";

export async function handleConfigCommand(
	positionals: string[],
	flags: Record<string, string | boolean>,
	runtime: CliRuntime,
): Promise<number> {
	const { appName } = runtime;
	const subcommand = positionals[1];
	if (subcommand === "get") {
		const config = await loadConfig(runtime);
		const { credential: _credential, ...publicConfig } = config;
		runtime.writeOut(
			flags.json === true
				? formatJson(publicConfig)
				: formatDetail(publicConfig),
		);
		return 0;
	}

	if (subcommand === "set") {
		const usage = `Usage: ${appName} config set <key> <value>`;
		if (positionals.length !== 4) {
			throw new CliError("Usage", usage);
		}
		if (Object.keys(flags).length > 0) {
			throw new CliError("Usage", usage);
		}

		const key = positionals[2];
		const value = positionals[3];
		if (value.trim().length === 0 || value.trim() !== value) {
			throw new CliError("Usage", usage);
		}

		const config = await loadConfig(runtime);
		if (key === "api-url") {
			await saveConfig({ ...config, apiUrl: value }, runtime);
		} else if (key === "convex-url") {
			await saveConfig({ ...config, convexUrl: value }, runtime);
		} else {
			throw new CliError("Usage", `Unknown config key: ${key}`);
		}

		runtime.writeOut(`Saved ${key}.\n`);
		return 0;
	}

	throw new CliError("Usage", `Usage: ${appName} config get|set`);
}
