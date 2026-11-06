import { awaitChecks, isRegression } from "../shared/rules.ts";
import type { ErrorItem, Project, ToolkitState, WorkType } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { scrub } from "./cli.ts";
import { GithubError, readRepos, readToolkit } from "./connectors/github.ts";
import { readDetail, readIssues, readOrg, readProjects, SentryError } from "./connectors/sentry.ts";
import { kvGet, kvSet } from "./db.ts";
import type { Engine } from "./engine.ts";
import { findRegressions } from "./read.ts";
import type { Store } from "./store.ts";

const GITHUB_MS = 60_000;
const GITHUB_BUSY_MS = 20_000;
const SENTRY_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const LOW_RATE = 300;

export interface PollerDeps {
	store: Store;
	cli: Cli;
	engine: () => Engine;
	publish: (keys: string[]) => void;
	onRegression: (r: { id: number; type: WorkType; prNumber: number | null }) => void;
	onRead: () => void;
}

/** Reads GitHub and Sentry on a timer. A failed read keeps old data and reports the source as stale. */
export class Poller {
	private readonly d: PollerDeps;
	private timers: NodeJS.Timeout[] = [];
	private githubFails = 0;
	private sentryFails = 0;
	private readonly toolkitCache = new Map<string, { state: ToolkitState; at: number }>();
	private stopped = false;
	private reading = false;

	constructor(deps: PollerDeps) {
		this.d = deps;
	}

	start() {
		this.schedule("github", 0);
		this.schedule("sentry", 500);
	}

	stop() {
		this.stopped = true;
		for (const t of this.timers) clearTimeout(t);
	}

	private schedule(kind: "github" | "sentry", ms: number) {
		if (this.stopped) return;
		const timer = setTimeout(async () => {
			let next = ms;
			try {
				next = kind === "github" ? await this.readGithub() : await this.readSentry();
			} catch (e) {
				// A read that dies must not end the polling for good.
				console.error(scrub(e instanceof Error ? (e.stack ?? e.message) : String(e)));
			}
			this.schedule(kind, next);
		}, ms);
		timer.unref();
		this.timers.push(timer);
	}

	/** Called after a merge, a push, or a new project. Debounced by the read itself. */
	soon() {
		if (this.stopped) return;
		const timer = setTimeout(() => void this.readGithub(), 1500);
		timer.unref();
		this.timers.push(timer);
	}

	soonSentry() {
		if (this.stopped) return;
		const timer = setTimeout(() => void this.readSentry(), 500);
		timer.unref();
		this.timers.push(timer);
	}

	/** A read is reported by now. What follows it can't be allowed to take the read down with it. */
	private async afterRead(step: () => Promise<void>) {
		try {
			await step();
		} catch (e) {
			console.error(scrub(e instanceof Error ? (e.stack ?? e.message) : String(e)));
		}
	}

	async readGithub(): Promise<number> {
		const { store, cli, publish } = this.d;
		if (this.reading) return GITHUB_MS;
		this.reading = true;
		const now = store.now();
		let delay = GITHUB_MS;
		let gone: string[] = [];
		try {
			// Inside the try: these read the Never touch file, and a broken one stops reads loudly.
			const busy = store.workOrders("state IN ('verifying', 'retrying', 'ready', 'shipping')").length > 0;
			if (busy) delay = GITHUB_BUSY_MS;
			const projects = store.projects();
			if (projects.length) {
				const read = await readRepos(
					cli,
					projects.map((p) => p.repo),
					now.getTime(),
				);
				gone = read.missing;
				for (const r of read.repos) {
					const project = projects.find((p) => p.repo.toLowerCase() === r.repo.toLowerCase());
					if (!project) continue;
					const toolkit = await readToolkit(cli, r.repo, r.devtoolsCommit, this.toolkitCache, now.getTime());
					this.saveRepo(project, r, toolkit);
				}
				if (read.rate && read.rate.remaining < LOW_RATE) {
					delay = Math.max(delay, Math.min(Date.parse(read.rate.resetAt) - now.getTime(), MAX_BACKOFF_MS));
				}
			}
			this.githubFails = 0;
			store.setHealth({
				source: "GitHub",
				ok: gone.length === 0,
				lastOk: store.iso(),
				error: gone.length ? `GitHub can't find ${gone.join(", ")}. It may be renamed or deleted.` : null,
				fix: gone.length ? `gh repo view ${gone[0]}` : null,
				nextCheckAt: new Date(now.getTime() + delay).toISOString(),
			});
		} catch (e) {
			this.githubFails += 1;
			delay = Math.min(GITHUB_MS * 2 ** this.githubFails, MAX_BACKOFF_MS);
			const prev = store.health().find((h) => h.source === "GitHub");
			store.setHealth({
				source: "GitHub",
				ok: false,
				lastOk: prev?.lastOk ?? null,
				error: scrub(e instanceof Error ? e.message : String(e)),
				fix: e instanceof GithubError ? "gh auth login" : null,
				nextCheckAt: new Date(now.getTime() + delay).toISOString(),
			});
		} finally {
			this.reading = false;
		}
		publish(["queue", "shell", "prs", "floor", "projects", "work-orders"]);
		await this.afterRead(async () => {
			this.d.onRead();
			await this.d.engine().tick();
		});
		return delay;
	}

	private saveRepo(
		project: Project,
		r: Awaited<ReturnType<typeof readRepos>>["repos"][number],
		toolkit: ToolkitState,
	) {
		const { store } = this.d;
		store.db
			.prepare(
				"UPDATE projects SET name = ?, url = ?, is_private = ?, default_branch = ?, toolkit = ?, main = ?, pushed_at = ?, read_at = ? WHERE slug = ?",
			)
			.run(
				r.name,
				r.url,
				r.isPrivate ? 1 : 0,
				r.defaultBranch,
				JSON.stringify(toolkit),
				r.main ? JSON.stringify(r.main) : null,
				r.pushedAt,
				store.iso(),
				project.slug,
			);
		const before = new Map(
			(
				store.db.prepare("SELECT number, json FROM prs WHERE project = ?").all(project.slug) as Array<{
					number: number;
					json: string;
				}>
			).map((row) => [row.number, JSON.parse(row.json)]),
		);
		store.db.prepare("DELETE FROM prs WHERE project = ?").run(project.slug);
		const insert = store.db.prepare("INSERT INTO prs (project, number, json) VALUES (?, ?, ?)");
		const now = store.now().getTime();
		for (const pr of r.prs)
			insert.run(
				project.slug,
				pr.number,
				JSON.stringify(awaitChecks(before.get(pr.number) ?? null, pr, now)),
			);
	}

	async readSentry(): Promise<number> {
		const { store, cli, publish } = this.d;
		const now = store.now();
		let delay = SENTRY_MS;
		const failed: string[] = [];
		let attempted = 0;
		let lastError = "";
		try {
			const projects = store.projects();
			if (projects.every((p) => p.sentrySkipped)) return delay;
			const org = await this.sentryOrg();
			const known = kvGet<string[]>(store.db, "sentry_projects") ?? (await readProjects(cli, org));
			kvSet(store.db, "sentry_projects", known);
			for (const p of projects) {
				if (p.sentrySkipped) continue;
				const slug = p.sentryProject ?? this.matchSentry(known, p);
				if (!slug) continue;
				if (!p.sentryProject) {
					store.db.prepare("UPDATE projects SET sentry_project = ? WHERE slug = ?").run(slug, p.slug);
				}
				attempted += 1;
				try {
					await this.saveErrors(p, await readIssues(cli, org, slug));
				} catch (e) {
					// One mistyped name mustn't stop the other projects' errors.
					failed.push(slug);
					lastError = e instanceof Error ? e.message : String(e);
				}
			}
			if (attempted > 0 && failed.length === attempted && !/not found|404/i.test(lastError)) {
				throw new SentryError(lastError);
			}
			this.sentryFails = 0;
			store.setHealth({
				source: "Sentry",
				ok: failed.length === 0,
				lastOk: store.iso(),
				error: failed.length ? scrub(`Sentry couldn't read ${failed.join(", ")}. ${lastError}`) : null,
				// A project Sentry doesn't know is a name to change on the project's page, not a login.
				fix: null,
				nextCheckAt: new Date(now.getTime() + delay).toISOString(),
			});
			for (const r of findRegressions(store)) this.d.onRegression(r);
		} catch (e) {
			this.sentryFails += 1;
			delay = Math.min(SENTRY_MS * 2 ** this.sentryFails, MAX_BACKOFF_MS);
			const prev = store.health().find((h) => h.source === "Sentry");
			store.setHealth({
				source: "Sentry",
				ok: false,
				lastOk: prev?.lastOk ?? null,
				error: scrub(e instanceof Error ? e.message : String(e)),
				fix: e instanceof SentryError ? "sentry auth login" : null,
				nextCheckAt: new Date(now.getTime() + delay).toISOString(),
			});
		}
		publish(["queue", "shell", "errors", "projects"]);
		await this.afterRead(async () => this.d.onRead());
		return delay;
	}

	private async sentryOrg() {
		const { store, cli } = this.d;
		const cached = kvGet<string>(store.db, "sentry_org");
		if (cached) return cached;
		const org = await readOrg(cli);
		kvSet(store.db, "sentry_org", org);
		return org;
	}

	private matchSentry(known: string[], p: Project): string | null {
		const wanted = [p.slug, p.name.toLowerCase().replace(/[^a-z0-9]/g, "")];
		return known.find((k) => wanted.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ""))) ?? null;
	}

	private async saveErrors(p: Project, issues: Awaited<ReturnType<typeof readIssues>>) {
		const { store, cli } = this.d;
		const previous = new Map(
			(
				store.db.prepare("SELECT id, json, detail FROM errors WHERE project = ?").all(p.slug) as Array<{
					id: string;
					json: string;
					detail: string | null;
				}>
			).map((r) => [r.id, r]),
		);
		const rows: Array<[string, string, string, string | null]> = [];
		for (const issue of issues) {
			const prev = previous.get(issue.id);
			const detailJson = prev?.detail ?? null;
			let detail = detailJson ? JSON.parse(detailJson) : null;
			if (!detail) detail = await readDetail(cli, issue.id);
			const fix = store.db
				.prepare(
					"SELECT id, pr_number, merged_at FROM work_orders WHERE fingerprint = ? AND merged_at IS NOT NULL ORDER BY id DESC",
				)
				.get(`error:${issue.id}`) as { id: number; pr_number: number | null; merged_at: string } | undefined;
			const before = prev ? (JSON.parse(prev.json) as ErrorItem) : null;
			let latestRelease = before?.latestRelease ?? null;
			const fp = `error:${issue.id}`;
			const tracked = store.db
				.prepare("SELECT 1 FROM work_orders WHERE fingerprint = ? AND state NOT IN ('done', 'closed')")
				.get(fp);
			const watched = fix || tracked || store.triageRecord(fp)?.action === "snooze";
			if (watched && (before?.lastSeen !== issue.lastSeen || (tracked && !before?.latestRelease))) {
				// Only these need the extra read. Which build is sending it decides if a fix failed or a snooze wakes.
				const fresh = await readDetail(cli, issue.id);
				if (fresh) {
					detail = { ...fresh, release: detail?.release ?? fresh.release };
					latestRelease = fresh.release;
				}
			}
			const regressed =
				fix &&
				isRegression(
					{ lastSeen: issue.lastSeen, release: latestRelease },
					{ mergedAt: fix.merged_at, release: store.fixRelease(fix.id) },
				);
			const item: ErrorItem = {
				...issue,
				project: p.slug,
				projectName: p.name,
				environment: detail?.environment ?? null,
				firstRelease: detail?.release ?? null,
				latestRelease,
				kind: regressed ? "regression" : prev ? "ongoing" : "new",
				regressionOf: regressed
					? { workOrderId: fix.id, prNumber: fix.pr_number, fixedAt: fix.merged_at }
					: null,
				triage: null,
				workOrderId: null,
			};
			if (!regressed && prev)
				item.kind = (JSON.parse(prev.json) as ErrorItem).kind === "new" ? "new" : "ongoing";
			rows.push([issue.id, p.slug, JSON.stringify(item), detail ? JSON.stringify(detail) : null]);
		}
		// Reading took a while. Swap in one go, so nothing reads an empty list in between.
		store.db.prepare("DELETE FROM errors WHERE project = ?").run(p.slug);
		const insert = store.db.prepare("INSERT INTO errors (id, project, json, detail) VALUES (?, ?, ?, ?)");
		for (const row of rows) insert.run(...row);
	}
}
