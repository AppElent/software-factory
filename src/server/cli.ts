import { execFile, spawn } from "node:child_process";

export interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
	/** The binary isn't installed. */
	missing?: boolean;
}

export interface CliOptions {
	cwd?: string;
	stdin?: string;
	timeoutMs?: number;
}

/** Every outside tool goes through here, so tests can replace all of them with recorded output. */
export type Cli = (cmd: string, args: string[], opts?: CliOptions) => Promise<CliResult>;

const SECRET =
	/\b(gh[opusr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sntry[a-z]*_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;

/** Removes token-shaped strings before anything reaches a log, the database, or the browser. */
export const scrub = (text: string) => text.replace(SECRET, "[hidden]");

const PATH_EXTRA = ["/opt/homebrew/bin", "/usr/local/bin"];

/** launchd starts with a thin PATH, so add the Homebrew folders. */
export const cliEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
	...env,
	PATH: [...PATH_EXTRA, env.PATH ?? "/usr/bin:/bin"].join(":"),
	NO_COLOR: "1",
	GH_PROMPT_DISABLED: "1",
});

export const realCli: Cli = (cmd, args, opts = {}) =>
	new Promise((resolve) => {
		if (opts.stdin !== undefined) {
			const child = spawn(cmd, args, { cwd: opts.cwd, env: cliEnv(), stdio: ["pipe", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 120_000);
			child.stdout.on("data", (d) => {
				stdout += d;
			});
			child.stderr.on("data", (d) => {
				stderr += d;
			});
			child.on("error", (e: NodeJS.ErrnoException) => {
				clearTimeout(timer);
				resolve({ code: 127, stdout, stderr: scrub(e.message), missing: e.code === "ENOENT" });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ code: code ?? 1, stdout: scrub(stdout), stderr: scrub(stderr) });
			});
			// A child that exits before reading all of it isn't a reason to take the service down.
			child.stdin.on("error", () => {});
			child.stdin.end(opts.stdin);
			return;
		}
		execFile(
			cmd,
			args,
			{ cwd: opts.cwd, env: cliEnv(), timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
					resolve({ code: 127, stdout: "", stderr: `${cmd} isn't installed`, missing: true });
					return;
				}
				const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
				resolve({ code, stdout: scrub(stdout.toString()), stderr: scrub(stderr.toString()) });
			},
		);
	});
