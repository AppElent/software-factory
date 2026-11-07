import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { VersionInfo, VersionsResponse } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { cliEnv, scrub } from "./cli.ts";
import { ActionError } from "./engine.ts";

/**
 * Each version of the app is a folder of its own, with `current` pointing at the one that runs. Settings and work
 * orders live elsewhere, so switching touches neither. See docs/adr/0005-versions.md.
 */

const KEEP_FOLDERS = 3;
const KEEP_ROWS = 12;
const CHECK_EVERY_MS = 10 * 60_000;
const STEP_TIMEOUT_MS = 10 * 60_000;
const NO_CHECKS_WAIT_MS = 5 * 60_000;

export type Versions = Pick<Releases, "view" | "check" | "activate">;

export interface GuardRequest {
	port: number;
	to: string;
	from: string;
	dir: string;
	kick: string[];
	waitMs: number;
	everyMs: number;
}

const sparePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.once("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("No spare port."))));
		});
	});

/** Starts the version on a spare port with sample data, so its first run touches nothing real. */
export async function realSmoke(dir: string, sha: string) {
	const port = await sparePort();
	const data = mkdtempSync(join(tmpdir(), "sf-smoke-"));
	const child = spawn(process.execPath, ["src/server/main.ts"], {
		cwd: dir,
		env: {
			...cliEnv(),
			SF_DEMO: "1",
			SF_PORT: String(port),
			SF_DATA_DIR: data,
			SF_RELEASES_DIR: dirname(dir),
		},
		stdio: "ignore",
	});
	try {
		const deadline = Date.now() + 30_000;
		let last = "It didn't answer.";
		while (Date.now() < deadline) {
			try {
				const version = await fetch(`http://127.0.0.1:${port}/api/version`);
				const page = await fetch(`http://127.0.0.1:${port}/`);
				const running = version.ok ? ((await version.json()) as { sha: string | null }).sha : null;
				if (running === sha && page.ok) return;
				last = `It answered ${version.status} and ${page.status}, as ${running ?? "no version"}.`;
			} catch {
				// Not up yet.
			}
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(last);
	} finally {
		child.kill("SIGKILL");
		rmSync(data, { recursive: true, force: true });
	}
}

/** Runs apart from this process, so it can still act if the new version never comes up. */
export const realGuard =
	(root: string) =>
	(req: GuardRequest): void => {
		spawn(process.execPath, [join(root, "scripts/update-guard.mjs"), JSON.stringify(req)], {
			detached: true,
			stdio: "ignore",
		}).unref();
	};

export class Releases {
	private readonly d: {
		root: string;
		dir: string;
		repo: string | null;
		port: number;
		serviceLabel: string;
		cli: Cli;
		publish: (keys: string[]) => void;
		smoke: (dir: string, sha: string) => Promise<void>;
		guard: (req: GuardRequest) => void;
		exit: () => void;
		/** Why now is a bad time to restart. */
		busy?: () => string | null;
	};
	private checking = false;
	private checkedAt: string | null = null;
	private checkError: string | null = null;
	private timer: NodeJS.Timeout | null = null;
	/** The newest check. For tests. */
	done: Promise<void> = Promise.resolve();

	constructor(d: Releases["d"]) {
		this.d = d;
	}

	private get manifest() {
		return join(this.d.dir, "versions.json");
	}

	private rows(): VersionInfo[] {
		try {
			return JSON.parse(readFileSync(this.manifest, "utf8")) as VersionInfo[];
		} catch {
			return [];
		}
	}

	private save(rows: VersionInfo[]) {
		const tmp = `${this.manifest}.tmp`;
		// History can go. What runs, and what you can still go to, can't.
		const live = (r: VersionInfo) =>
			r.state !== "failed" && (r.state !== "replaced" || existsSync(join(this.d.dir, r.sha)));
		const kept = rows.filter((r, i) => i < KEEP_ROWS || live(r));
		writeFileSync(tmp, JSON.stringify(kept, null, 1));
		renameSync(tmp, this.manifest);
	}

	private patch(sha: string, change: Partial<VersionInfo>) {
		this.save(this.rows().map((r) => (r.sha === sha ? { ...r, ...change } : r)));
	}

	/** The sha this process runs, when it runs from a version folder. */
	running(): string | null {
		try {
			const real = realpathSync(this.d.root);
			if (dirname(real) !== realpathSync(this.d.dir)) return null;
			return basename(real);
		} catch {
			return null;
		}
	}

	view(): Omit<VersionsResponse, "building"> {
		const sha = this.running();
		const rows = this.rows();
		const row = rows.find((r) => r.sha === sha);
		return {
			mode: sha ? "release" : "checkout",
			running: sha
				? { sha, label: sha.slice(0, 7), message: row?.message ?? "", since: row?.at ?? null }
				: null,
			history: rows.map((r) => ({
				...r,
				canRollBack: r.state === "replaced" && existsSync(join(this.d.dir, r.sha)),
			})),
			checkedAt: this.checkedAt,
			checkError: this.checkError,
			repo: this.d.repo,
		};
	}

	start() {
		if (!this.running()) return;
		// A restart cuts off whatever was getting ready. It gets a new try.
		const cut = this.rows().filter((r) => r.state === "preparing");
		if (cut.length > 0) this.save(this.rows().filter((r) => r.state !== "preparing"));
		for (const r of cut) {
			rmSync(join(this.d.dir, `.tmp-${r.sha}`), { recursive: true, force: true });
			rmSync(join(this.d.dir, r.sha), { recursive: true, force: true });
		}
		const beat = () => {
			void this.check().catch((e) => console.error(scrub(String(e))));
		};
		beat();
		this.timer = setInterval(beat, CHECK_EVERY_MS);
		this.timer.unref();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
	}

	/** Looks for a newer commit on the default branch, and gets it ready. Nothing switches until you say. */
	check(retry = false): Promise<void> {
		if (this.checking) return this.done;
		this.done = this.look(retry);
		return this.done;
	}

	/** On a timer a failed commit stays failed. Asking is a new try, because a failure can be the network's. */
	private async look(retry: boolean) {
		const { cli, repo, publish } = this.d;
		if (!repo || !this.running()) return;
		this.checking = true;
		this.checkError = null;
		try {
			const res = await cli("gh", ["api", `repos/${repo}/commits/HEAD`]);
			if (res.code !== 0) throw new Error(res.stderr.trim() || "GitHub didn't answer.");
			const head = JSON.parse(res.stdout) as {
				sha: string;
				commit: { message: string; committer?: { date?: string } };
			};
			this.checkedAt = new Date().toISOString();
			if (!/^[0-9a-f]{40}$/.test(head.sha)) throw new Error("GitHub returned something unexpected.");
			if (head.sha === this.running()) return;
			const known = this.rows().find((r) => r.sha === head.sha);
			if (known?.state === "failed" && retry) this.save(this.rows().filter((r) => r.sha !== head.sha));
			else if (known) return;
			if ((await this.checksOf(head.sha, head.commit.committer?.date)) !== "passed") return;
			await this.prepare(head.sha, head.commit.message.split("\n")[0] ?? "");
		} catch (e) {
			this.checkError = scrub(e instanceof Error ? e.message : String(e)).slice(0, 300);
		} finally {
			this.checking = false;
			publish(["versions"]);
		}
	}

	/**
	 * Red or unfinished checks mean not yet. A repo with no checks has nothing to wait for, but a new commit may just
	 * not have them yet, so it gets a few minutes first.
	 */
	private async checksOf(sha: string, committedAt?: string): Promise<"passed" | "waiting" | "red"> {
		const { cli, repo } = this.d;
		const read = async (path: string) => {
			const res = await cli("gh", ["api", `repos/${repo}/commits/${sha}/${path}`]);
			if (res.code !== 0) throw new Error(res.stderr.trim() || "GitHub didn't answer.");
			return JSON.parse(res.stdout);
		};
		const { check_runs: runs } = (await read("check-runs?per_page=100")) as {
			check_runs: Array<{ status: string; conclusion: string | null }>;
		};
		const status = (await read("status")) as { state: string; total_count: number };
		const bad = (r: { conclusion: string | null }) =>
			!["success", "neutral", "skipped"].includes(r.conclusion ?? "");
		if (runs.some((r) => r.status === "completed" && bad(r))) return "red";
		if (status.total_count > 0 && ["failure", "error"].includes(status.state)) return "red";
		if (runs.some((r) => r.status !== "completed")) return "waiting";
		if (status.total_count > 0 && status.state !== "success") return "waiting";
		if (runs.length > 0 || status.total_count > 0) return "passed";
		const age = committedAt ? Date.now() - Date.parse(committedAt) : Number.POSITIVE_INFINITY;
		return age >= NO_CHECKS_WAIT_MS ? "passed" : "waiting";
	}

	private async prepare(sha: string, message: string) {
		const { cli, dir, root, smoke, publish } = this.d;
		const label = sha.slice(0, 7);
		const now = new Date().toISOString();
		// A newer commit makes one you never switched to pointless.
		const stale = this.rows().filter((r) => r.state === "ready");
		for (const r of stale) rmSync(join(dir, r.sha), { recursive: true, force: true });
		const others = this.rows().filter((r) => r.state !== "ready");
		this.save([
			{ sha, label, message, state: "preparing", error: null, at: now, canRollBack: false },
			...others,
		]);
		publish(["versions"]);
		const tmp = join(dir, `.tmp-${sha}`);
		rmSync(tmp, { recursive: true, force: true });
		const step = async (what: string, cmd: string, args: string[], cwd?: string) => {
			const res = await cli(cmd, args, { cwd, timeoutMs: STEP_TIMEOUT_MS });
			if (res.code !== 0) throw new Error(`${what} failed. ${scrub(res.stderr).trim().slice(-200)}`.trim());
			return res.stdout.trim();
		};
		try {
			const origin = await step("Finding the repo", "git", ["remote", "get-url", "origin"], root);
			await step("Clone", "git", ["clone", "--quiet", origin, tmp]);
			await step("Checkout", "git", ["checkout", "--quiet", "--detach", sha], tmp);
			await step("Install", "pnpm", ["install", "--frozen-lockfile"], tmp);
			await step("Build", "pnpm", ["build"], tmp);
			const folder = join(dir, sha);
			rmSync(folder, { recursive: true, force: true });
			renameSync(tmp, folder);
			await smoke(folder, sha);
			this.patch(sha, { state: "ready", at: new Date().toISOString() });
			this.prune();
		} catch (e) {
			rmSync(tmp, { recursive: true, force: true });
			rmSync(join(dir, sha), { recursive: true, force: true });
			this.patch(sha, {
				state: "failed",
				error: scrub(e instanceof Error ? e.message : String(e)).slice(0, 300),
			});
		}
	}

	/** Keeps what you might go to, and the newest few to go back to. */
	private prune() {
		const running = this.running();
		let kept = 0;
		const newestFirst = [...this.rows()].sort((a, b) => b.at.localeCompare(a.at));
		for (const r of newestFirst) {
			if (r.sha === running || r.state === "ready" || r.state === "preparing") continue;
			if (r.state === "replaced" && kept < KEEP_FOLDERS - 1) {
				kept += 1;
				continue;
			}
			rmSync(join(this.d.dir, r.sha), { recursive: true, force: true });
		}
	}

	/** Moves `current`, starts the guard, and exits. Launchd starts whatever `current` points at. */
	async activate(sha: string) {
		const { dir, port, guard, exit, serviceLabel, publish, busy } = this.d;
		const from = this.running();
		if (!from) throw new ActionError("This copy runs from a checkout, so it has no versions to switch.", 409);
		if (sha === from) throw new ActionError("That version is already running.", 409);
		const row = this.rows().find((r) => r.sha === sha);
		if (!row || (row.state !== "ready" && row.state !== "replaced") || !existsSync(join(dir, sha)))
			throw new ActionError("That version isn't ready to run.", 409);
		const why = busy?.();
		if (why) throw new ActionError(why, 409);
		// Going forward, its checks can have gone red since it was built. Going back is how you escape a bad one.
		if (row.state === "ready") {
			const checks = await this.checksOf(sha).catch(() => null);
			if (checks === null) throw new ActionError("Couldn't read its checks on GitHub. Try again.", 409);
			if (checks !== "passed")
				throw new ActionError(`The checks on ${row.label} aren't green any more.`, 409);
		}
		const link = join(dir, `.current-${sha}`);
		rmSync(link, { force: true });
		symlinkSync(sha, link);
		renameSync(link, join(dir, "current"));
		const at = new Date().toISOString();
		this.save(
			this.rows().map((r) =>
				r.sha === from
					? { ...r, state: "replaced", at }
					: r.sha === sha
						? { ...r, state: "running", at, error: null }
						: r,
			),
		);
		const uid = process.getuid?.() ?? 0;
		guard({
			port,
			to: sha,
			from,
			dir,
			kick: ["launchctl", "kickstart", "-k", `gui/${uid}/${serviceLabel}`],
			waitMs: 90_000,
			everyMs: 2000,
		});
		publish(["versions"]);
		// The answer reaches the page first.
		setTimeout(exit, 300);
	}
}

export interface PrivateTerm {
	term: string;
	/** A rule like `acme_*` also means `acme_portal`, so it matches inside a word. */
	anywhere: boolean;
}

/** What Improve yourself must not send to a public repo without you seeing it first. */
export function privateTerms(input: {
	privateProjects: Array<{ name: string; repo: string }>;
	neverTouch: string[];
	home: string;
	email: string | null;
}): PrivateTerm[] {
	const out = new Map<string, boolean>();
	for (const p of input.privateProjects) {
		out.set(p.name, false);
		out.set(p.repo.split("/")[1] ?? p.repo, false);
	}
	for (const rule of input.neverTouch) {
		const parts = rule.split(/[*/?]+/).filter(Boolean);
		const longest = parts.sort((a, b) => b.length - a.length)[0];
		if (longest) out.set(longest.replace(/^[-_.]+|[-_.]+$/g, ""), true);
	}
	out.set(input.home, false);
	const user = input.home.split("/").filter(Boolean).at(-1);
	if (user) out.set(user, false);
	if (input.email) out.set(input.email, false);
	return [...out].filter(([term]) => term.length >= 3).map(([term, anywhere]) => ({ term, anywhere }));
}

export function privateHits(text: string, terms: PrivateTerm[]): string[] {
	const lower = text.toLowerCase();
	return terms
		.filter(({ term, anywhere }) => {
			if (anywhere) return lower.includes(term.toLowerCase());
			const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// An underscore joins words in a name, so it counts as an edge here.
			return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
		})
		.map(({ term }) => term);
}
