import type { CliResult, IoRuntime, RunCliOptions } from "./run";
import { runCli } from "./run";

export function createCli(options: RunCliOptions): {
	runCli: (args: string[], ioRuntime: IoRuntime) => Promise<CliResult>;
} {
	return {
		runCli: (args, ioRuntime) => runCli(args, ioRuntime, options),
	};
}
