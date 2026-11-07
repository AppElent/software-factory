import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
	DeployRun,
	EnvHealth,
	EnvironmentConfig,
	EnvironmentView,
	EnvSuggestion,
	Project,
} from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { cliEnv, scrub } from "./cli.ts";
import { audit } from "./db.ts";
import { ActionError } from "./engine.ts";
import { OPEN_FILTER, type Store } from "./store.ts";

const CHECK_EVERY_MS = 60_000;
const CHECK_TIMEOUT_MS = 10_000;
const SLOW_MS = 2000;
const DEPLOYED_EVERY_MS = 5 * 60_000;
const DEPLOY_TIMEOUT_MS = 30 * 60_000;
const LOG_MAX = 200_000;
const FLUSH_MS = 500;
/** One failed check is a blip. Two in a row is down. */
const DOWN_AFTER = 2;

export interface RunningDeploy {
	done: Promise<number>;
	kill: () => void;
}

/** Runs a deploy command. A seam so tests and the demo never run anything. */
export type DeployRunner = (command: string, cwd: string, onOutput: (text: string) => void) => RunningDeploy;

/** Fetches a health URL. Resolves to the status, or null when nothing answered. */
export type HealthFetch = (url: string) => Promise<{ status: number | null; error: string | null }>;

export const realDeployRunner: DeployRunner = (command, cwd, onOutput) => {
	// Its own process group, so Stop reaches whatever the command started.
	const child = spawn("/bin/sh", ["-c", command], {
		cwd,
		env: cliEnv(),
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (d) => onOutput(String(d)));
	child.stderr.on("data", (d) => onOutput(String(d)));
	const signal = (s: NodeJS.Signals) => {
		try {
			if (child.pid) process.kill(-child.pid, s);
		} catch {
			// Already gone.
		}
	};
	const timer = setTimeout(() => signal("SIGTERM"), DEPLOY_TIMEOUT_MS);
	return {
		done: new Promise((resolve) => {
			child.on("error", (e) => {
				onOutput(`${e.message}\n`);
				clearTimeout(timer);
				resolve(127);
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve(code ?? 1);
			});
		}),
		kill: () => {
			signal("SIGTERM");
			setTimeout(() => signal("SIGKILL"), 5000).unref();
		},
	};
};

export const realHealthFetch: HealthFetch = async (url) => {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), redirect: "follow" });
		await res.body?.cancel();
		return { status: res.status, error: null };
	} catch (e) {
		const timedOut = e instanceof Error && e.name === "TimeoutError";
		return { status: null, error: timedOut ? "No answer in 10s" : "Couldn't connect" };
	}
};

const Deployment = z.array(z.object({ sha: z.string(), created_at: z.string() }));
const Compare = z.object({ ahead_by: z.number() });

interface HealthRow {
	project: string;
	env: string;
	ok: number | null;
	status: number | null;
	ms: number | null;
	error: string | null;
	checked_at: string | null;
	down_since: string | null;
	fails: number;
	deployed_sha: string | null;
	deployed_at: string | null;
	deployed_read_at: string | null;
	behind: number | null;
	behind_of: string | null;
}

interface DeployRow {
	id: number;
	project: string;
	env: string;
	command: string;
	state: DeployRun["state"];
	started_at: string;
	finished_at: string | null;
	exit_code: number | null;
	sha: string | null;
	message: string | null;
	log: string;
}

const toRun = (r: DeployRow): DeployRun => ({
	id: r.id,
	project: r.project,
	env: r.env,
	command: r.command,
	state: r.state,
	startedAt: r.started_at,
	finishedAt: r.finished_at,
	exitCode: r.exit_code,
	sha: r.sha,
	message: r.message,
	log: r.log,
});

export function issueLabelOf(env: EnvironmentConfig) {
	return env.issueLabel ?? `env:${env.name.toLowerCase()}`;
}

export function sentryEnvOf(env: EnvironmentConfig) {
	return env.sentryEnvironment ?? env.name.toLowerCase();
}

export const shellQuoteSimple = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

export class Environments {
	private readonly running = new Map<string, RunningDeploy & { stopping: boolean }>();
	private timer: NodeJS.Timeout | null = null;
	private checking = false;

	private readonly d: {
		store: Store;
		cli: Cli;
		publish: (keys: string[]) => void;
		deployRunner: DeployRunner;
		healthFetch: HealthFetch;
	};

	constructor(d: Environments["d"]) {
		this.d = d;
		d.store.envViews = () => this.all();
		// Nothing is watching a deploy from before this start.
		d.store.db
			.prepare(
				"UPDATE deploys SET state = 'failed', finished_at = ?, message = 'The service restarted during this deploy. Check the environment, because the command may have kept running.' WHERE state = 'running'",
			)
			.run(d.store.iso());
	}

	start() {
		const beat = () => {
			void this.checkAll().catch((e) => console.error(scrub(String(e))));
		};
		beat();
		this.timer = setInterval(beat, CHECK_EVERY_MS);
		this.timer.unref();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
	}

	configOf(slug: string): EnvironmentConfig[] {
		return this.d.store.file.read().environments[slug] ?? [];
	}

	saveConfig(slug: string, environments: EnvironmentConfig[]) {
		const names = environments.map((e) => e.name.toLowerCase());
		if (new Set(names).size !== names.length)
			throw new ActionError("Two environments have the same name.", 400);
		this.d.store.file.update((c) => ({ ...c, environments: { ...c.environments, [slug]: environments } }));
		const keep = new Set(environments.map((e) => e.name));
		const rows = this.d.store.db.prepare("SELECT env FROM env_health WHERE project = ?").all(slug) as Array<{
			env: string;
		}>;
		for (const r of rows)
			if (!keep.has(r.env))
				this.d.store.db.prepare("DELETE FROM env_health WHERE project = ? AND env = ?").run(slug, r.env);
		audit(this.d.store.db, "change environments", slug, "you", null, this.d.store.now());
		this.d.publish(["environments", "shell", "queue"]);
	}

	/* ---------- reading ---------- */

	private healthRow(project: string, env: string) {
		return this.d.store.db
			.prepare("SELECT * FROM env_health WHERE project = ? AND env = ?")
			.get(project, env) as unknown as HealthRow | undefined;
	}

	private lastDeploy(project: string, env: string): DeployRun | null {
		const row = this.d.store.db
			.prepare("SELECT * FROM deploys WHERE project = ? AND env = ? ORDER BY id DESC LIMIT 1")
			.get(project, env) as unknown as DeployRow | undefined;
		return row ? toRun(row) : null;
	}

	history(project: string, limit = 20): DeployRun[] {
		return (
			this.d.store.db
				.prepare("SELECT * FROM deploys WHERE project = ? ORDER BY id DESC LIMIT ?")
				.all(project, limit) as unknown as DeployRow[]
		).map(toRun);
	}

	private healthOf(env: EnvironmentConfig, row: HealthRow | undefined): EnvHealth {
		if (!env.healthUrl)
			return { state: "not_checked", status: null, ms: null, checkedAt: null, downSince: null, error: null };
		if (!row?.checked_at || row.ok === null)
			return { state: "not_checked", status: null, ms: null, checkedAt: null, downSince: null, error: null };
		const down = row.fails >= DOWN_AFTER;
		const answered = row.ok === 1;
		return {
			state: down ? "down" : answered && (row.ms ?? 0) > SLOW_MS ? "slow" : "up",
			status: row.status,
			ms: row.ms,
			checkedAt: row.checked_at,
			downSince: down ? row.down_since : null,
			error: down ? row.error : null,
		};
	}

	view(project: Project, env: EnvironmentConfig): EnvironmentView {
		const { store } = this.d;
		const row = this.healthRow(project.slug, env.name);
		const deploy = this.lastDeploy(project.slug, env.name);
		const lastPassed = store.db
			.prepare(
				"SELECT sha, finished_at FROM deploys WHERE project = ? AND env = ? AND state = 'passed' ORDER BY id DESC LIMIT 1",
			)
			.get(project.slug, env.name) as { sha: string | null; finished_at: string } | undefined;
		// GitHub knows about deploys made without this app. The newer of the two is what's out there.
		const ownIsNewer =
			lastPassed && (!row?.deployed_at || Date.parse(lastPassed.finished_at) >= Date.parse(row.deployed_at));
		const sentry = sentryEnvOf(env);
		const label = issueLabelOf(env).toLowerCase();
		return {
			...env,
			project: project.slug,
			projectName: project.name,
			health: this.healthOf(env, row),
			deploy,
			deployedSha: ownIsNewer ? lastPassed.sha : (row?.deployed_sha ?? null),
			deployedAt: ownIsNewer ? lastPassed.finished_at : (row?.deployed_at ?? null),
			behind: row?.behind ?? null,
			errors: store
				.errors(project.slug)
				.filter((e) => e.environment === sentry && e.triage?.action !== "dismiss").length,
			issues: store.issues(project.slug).filter((i) => i.labels.some((l) => l.toLowerCase() === label))
				.length,
			folder: project.localPath,
			workOrderId:
				(
					store.db
						.prepare(`SELECT id FROM work_orders WHERE fingerprint = ? AND ${OPEN_FILTER}`)
						.get(`env:${project.slug}:${env.name}`) as { id: number } | undefined
				)?.id ?? null,
		};
	}

	viewsFor(project: Project): EnvironmentView[] {
		return this.configOf(project.slug).map((e) => this.view(project, e));
	}

	all(): EnvironmentView[] {
		return this.d.store.projects().flatMap((p) => this.viewsFor(p));
	}

	/* ---------- health ---------- */

	async checkAll() {
		if (this.checking) return;
		this.checking = true;
		try {
			for (const p of this.d.store.projects()) {
				if (p.paused) continue;
				for (const env of this.configOf(p.slug)) {
					await this.check(p, env);
					await this.readDeployed(p, env);
				}
			}
			this.d.publish(["environments", "shell", "queue"]);
		} finally {
			this.checking = false;
		}
	}

	private saveCheck(
		project: string,
		env: string,
		ok: boolean,
		status: number | null,
		ms: number | null,
		error: string | null,
	) {
		const { store } = this.d;
		const prev = this.healthRow(project, env);
		const fails = ok ? 0 : (prev?.fails ?? 0) + 1;
		const downSince = ok ? null : (prev?.down_since ?? store.iso());
		store.db
			.prepare(
				`INSERT INTO env_health (project, env, ok, status, ms, error, checked_at, down_since, fails) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(project, env) DO UPDATE SET ok = excluded.ok, status = excluded.status, ms = excluded.ms,
				error = excluded.error, checked_at = excluded.checked_at, down_since = excluded.down_since, fails = excluded.fails`,
			)
			.run(project, env, ok ? 1 : 0, status, ms, error, store.iso(), downSince, fails);
	}

	/** One attempt on the timer. Asking by hand doesn't wait a minute to tell a blip from an outage. */
	async check(project: Project, env: EnvironmentConfig, byHand = false) {
		if (!env.healthUrl) return;
		const attempts = byHand ? DOWN_AFTER : 1;
		for (let n = 0; n < attempts; n += 1) {
			const started = Date.now();
			const { status, error } = await this.d.healthFetch(env.healthUrl);
			const ok = status !== null && status >= 200 && status < 400;
			this.saveCheck(
				project.slug,
				env.name,
				ok,
				status,
				Date.now() - started,
				ok ? null : status !== null ? `Health check returned HTTP ${status}.` : `${error ?? "No answer"}.`,
			);
			if (ok) break;
		}
	}

	private async readDeployed(project: Project, env: EnvironmentConfig) {
		const { store, cli } = this.d;
		const row = this.healthRow(project.slug, env.name);
		const now = store.now().getTime();
		const stale = !row?.deployed_read_at || now - Date.parse(row.deployed_read_at) >= DEPLOYED_EVERY_MS;
		let sha = row?.deployed_sha ?? null;
		let at = row?.deployed_at ?? null;
		if (stale) {
			const res = await cli("gh", [
				"api",
				`repos/${project.repo}/deployments?environment=${encodeURIComponent(env.name)}&per_page=1`,
			]);
			if (res.code === 0) {
				try {
					const first = Deployment.parse(JSON.parse(res.stdout))[0];
					sha = first?.sha ?? sha;
					at = first?.created_at ?? at;
				} catch {
					// Keeps what it had.
				}
			}
		}
		const view = this.lastDeploy(project.slug, env.name);
		const newest = view?.state === "passed" && view.sha ? view.sha : sha;
		const main = store.main(project.slug);
		let behind = row?.behind ?? null;
		const behindOf = main && newest ? `${newest}...${main.sha}` : null;
		if (behindOf && behindOf !== row?.behind_of) {
			const res = await cli("gh", ["api", `repos/${project.repo}/compare/${behindOf}`]);
			if (res.code === 0) {
				const parsed = Compare.safeParse(parseJson(res.stdout));
				if (parsed.success) behind = parsed.data.ahead_by;
			}
		}
		store.db
			.prepare(
				`INSERT INTO env_health (project, env, deployed_sha, deployed_at, deployed_read_at, behind, behind_of) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(project, env) DO UPDATE SET deployed_sha = excluded.deployed_sha, deployed_at = excluded.deployed_at,
				deployed_read_at = excluded.deployed_read_at, behind = excluded.behind, behind_of = excluded.behind_of`,
			)
			.run(
				project.slug,
				env.name,
				sha,
				at,
				stale ? store.iso() : (row?.deployed_read_at ?? null),
				behind,
				behindOf,
			);
	}

	/* ---------- deploys ---------- */

	private need(slug: string, name: string) {
		const project = this.d.store.project(slug);
		if (!project) throw new ActionError("That project isn't in the factory.", 404);
		const env = this.configOf(slug).find((e) => e.name === name);
		if (!env) throw new ActionError("That environment isn't set up.", 404);
		return { project, env };
	}

	async checkNow(slug: string, name: string) {
		const { project, env } = this.need(slug, name);
		await this.check(project, env, true);
		this.d.publish(["environments", "shell", "queue"]);
	}

	/** The command comes from your config file, never from the repo or the page. */
	async deploy(slug: string, name: string, confirmed: boolean): Promise<number> {
		const { store, cli, deployRunner, publish } = this.d;
		const { project, env } = this.need(slug, name);
		if (!env.deployCommand) throw new ActionError("This environment has no deploy command.", 409);
		if (!project.localPath || !existsSync(project.localPath))
			throw new ActionError("This project has no folder on this Mac.", 409);
		if (env.production && !confirmed)
			throw new ActionError(`Deploying to ${env.name} needs confirming.`, 409);
		const key = `${slug}:${name}`;
		if (this.running.has(key)) throw new ActionError(`${env.name} is already deploying.`, 409);
		// Held before the first await, so a double click can't start two.
		const slot = { done: Promise.resolve(0), kill: () => {}, stopping: false };
		this.running.set(key, slot);
		try {
			const git = (args: string[]) => cli("git", ["-C", project.localPath as string, ...args]);
			const [head, branch, dirty] = await Promise.all([
				git(["log", "-1", "--format=%H%x00%s"]),
				git(["branch", "--show-current"]),
				git(["status", "--porcelain"]),
			]);
			const [sha, message] = head.code === 0 ? head.stdout.trim().split("\0") : [null, null];
			const notes = [
				`$ ${env.deployCommand}`,
				`In ${project.localPath}${branch.code === 0 && branch.stdout.trim() ? `, on ${branch.stdout.trim()}` : ""}${sha ? ` at ${sha.slice(0, 7)}` : ""}`,
				...(dirty.code === 0 && dirty.stdout.trim() ? ["This folder has uncommitted changes."] : []),
				"",
			].join("\n");
			const id = Number(
				store.db
					.prepare(
						"INSERT INTO deploys (project, env, command, state, started_at, sha, message, log) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
					)
					.run(slug, name, env.deployCommand, store.iso(), sha ?? null, message ?? null, notes)
					.lastInsertRowid,
			);
			audit(store.db, "deploy", `${slug} ${name}`, "you", null, store.now());
			let log = notes;
			let flushed = 0;
			const flush = () => {
				flushed = Date.now();
				store.db.prepare("UPDATE deploys SET log = ? WHERE id = ?").run(log, id);
				publish([`deploy:${id}`, "environments"]);
			};
			const run = deployRunner(env.deployCommand, project.localPath, (text) => {
				log = `${log}${scrub(text)}`.slice(-LOG_MAX);
				if (Date.now() - flushed >= FLUSH_MS) flush();
			});
			slot.kill = run.kill;
			slot.done = run.done;
			publish(["environments", "shell"]);
			void run.done
				.catch(() => 1)
				.then((code) => {
					const state = slot.stopping ? "stopped" : code === 0 ? "passed" : "failed";
					store.db
						.prepare("UPDATE deploys SET state = ?, finished_at = ?, exit_code = ?, log = ? WHERE id = ?")
						.run(state, store.iso(), code, log, id);
					this.running.delete(key);
					// What's out there changed, so look now instead of on the next minute.
					void this.check(project, env).finally(() => publish(["environments", "shell", "queue"]));
				});
			return id;
		} catch (e) {
			this.running.delete(key);
			throw e;
		}
	}

	stopDeploy(slug: string, name: string) {
		const run = this.running.get(`${slug}:${name}`);
		if (!run) throw new ActionError("Nothing is deploying there.", 409);
		run.stopping = true;
		run.kill();
		audit(this.d.store.db, "stop deploy", `${slug} ${name}`, "you", null, this.d.store.now());
	}

	/** Wait for every deploy to finish. For tests. */
	async settled() {
		await Promise.all([...this.running.values()].map((r) => r.done));
		await new Promise((r) => setTimeout(r, 0));
	}

	/* ---------- suggestions ---------- */

	/** What the repo hints at. You see these first, and nothing runs until you've added one. */
	async suggest(project: Project): Promise<EnvSuggestion[]> {
		const out = new Map<string, EnvSuggestion>();
		const add = (name: string, deployCommand: string | null, from: string) => {
			const key = name.toLowerCase();
			const prev = out.get(key);
			if (prev?.deployCommand) return;
			out.set(key, {
				name: name.charAt(0).toUpperCase() + name.slice(1),
				deployCommand: deployCommand ?? prev?.deployCommand ?? null,
				production: /^prod/i.test(name),
				from: prev ? `${prev.from}, ${from}` : from,
			});
		};
		const res = await this.d.cli("gh", ["api", `repos/${project.repo}/environments`]);
		const names: string[] = [];
		if (res.code === 0) {
			const parsed = z
				.object({ environments: z.array(z.object({ name: z.string() })) })
				.safeParse(parseJson(res.stdout));
			if (parsed.success) names.push(...parsed.data.environments.map((e) => e.name));
		}
		const path = project.localPath;
		if (path && existsSync(path)) {
			const manager = existsSync(join(path, "pnpm-lock.yaml"))
				? "pnpm"
				: existsSync(join(path, "yarn.lock"))
					? "yarn"
					: "npm run";
			try {
				const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as {
					scripts?: Record<string, string>;
				};
				for (const script of Object.keys(pkg.scripts ?? {})) {
					const m = /^deploy:([\w-]+)$/.exec(script);
					if (m?.[1]) add(m[1], `${manager} ${script}`, "package.json");
				}
			} catch {
				// No package.json, or one that doesn't parse.
			}
			const workflows = join(path, ".github/workflows");
			if (existsSync(workflows)) {
				for (const file of readdirSync(workflows)) {
					if (!/deploy.*\.ya?ml$/i.test(file)) continue;
					const text = readFileSync(join(workflows, file), "utf8");
					if (!text.includes("workflow_dispatch")) continue;
					for (const name of names) add(name, `gh workflow run ${file} -f environment=${name}`, file);
				}
			}
			if (["wrangler.toml", "wrangler.json", "wrangler.jsonc"].some((f) => existsSync(join(path, f)))) {
				for (const name of names) add(name, `npx wrangler deploy --env ${name}`, "wrangler config");
			}
		}
		for (const name of names) add(name, null, "GitHub environments");
		const taken = new Set(this.configOf(project.slug).map((e) => e.name.toLowerCase()));
		return [...out.values()].filter((s) => !taken.has(s.name.toLowerCase()));
	}
}
