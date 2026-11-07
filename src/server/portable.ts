import { z } from "zod";
import { noGates } from "../shared/rules.ts";
import type { Mode } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { filterNeverTouch } from "./config.ts";
import { ConfigFileError } from "./config-file.ts";
import { type Executor, ExecutorError } from "./executor/types.ts";
import type { Store } from "./store.ts";

/**
 * Everything you'd miss lives outside the database, so you can stop using this app or delete its data.
 * Settings, modes and environments are written to the config file directly. Projects are mirrored here.
 * Running work is read back from T3, which is where it runs.
 */

const WO_TITLE = /^WO-(\d+) (.+)$/s;
const REPO = /^[\w.-]+\/[\w.-]+$/;

/** Work the factory picked up again never merges on its own, whatever mode it started in. */
const RESTORED_MODE: Mode = {
	id: "restored",
	name: "Picked up again",
	description: "",
	prompt: "",
	plan: "skip",
	merge: "you",
	provider: null,
	model: null,
	builtin: false,
};

const entries = (store: Store) =>
	store.projects().map((p) => ({
		repo: p.repo,
		slug: p.slug,
		name: p.name,
		localPath: p.localPath,
		paused: p.paused,
		merging: p.merging,
		sentryProject: p.sentryProject,
		sentrySkipped: p.sentrySkipped,
	}));

/** Writes the project list to the config file when it changed. Safe to call often. */
export function mirrorProjects(store: Store) {
	const next = entries(store);
	if (JSON.stringify(next) === JSON.stringify(store.file.read().projects)) return;
	try {
		store.file.update((data) => ({ ...data, projects: next }));
	} catch (e) {
		// A config file with a typo stays yours to fix. It's reported in Settings, and this tries again.
		if (!(e instanceof ConfigFileError)) throw e;
	}
}

/**
 * Brings projects back from the config file when the database has never had any. A database that has rows,
 * even removed ones, stays as it is, so removing your last project doesn't bring them all back.
 */
export function restoreProjects(store: Store): number {
	const seen = store.db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
	if (seen.n > 0) return 0;
	const wanted = store.file
		.read()
		.projects.filter((p) => REPO.test(p.repo))
		.map((p) => ({ ...p, path: p.localPath }));
	const { kept } = filterNeverTouch(store.neverTouch(), wanted);
	const insert = store.db.prepare(
		`INSERT OR IGNORE INTO projects (slug, repo, name, url, local_path, paused, merging, sentry_project, sentry_skipped, added_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const p of kept) {
		const name = p.name ?? p.repo.split("/")[1] ?? p.repo;
		insert.run(
			p.slug ?? name,
			p.repo,
			name,
			`https://github.com/${p.repo}`,
			p.localPath,
			p.paused ? 1 : 0,
			p.merging ?? "follow",
			p.sentryProject ?? null,
			p.sentrySkipped ? 1 : 0,
			store.iso(),
		);
	}
	return kept.length;
}

const Threads = z.array(
	z.object({
		threadId: z.string(),
		title: z.string(),
		link: z.string().nullable().optional(),
		settled: z.boolean().optional(),
	}),
);

const parseThreads = (text: string) => {
	try {
		return Threads.safeParse(JSON.parse(text)).data ?? [];
	} catch {
		return [];
	}
};

const OpenPrs = z.array(z.object({ number: z.number() }));

/**
 * Picks up work that's still going, from T3's threads. Finished work is history, and stays gone. Only projects
 * already in the factory are read, so a Never touch repo's threads are never looked at.
 */
export async function rebuildWorkOrders(store: Store, cli: Cli, executor: Executor): Promise<number> {
	let adopted = 0;
	let highest = 0;
	for (const project of store.projects()) {
		if (!project.localPath) continue;
		const res = await cli("t3", ["thread", "list", "--project", project.localPath, "--json"]);
		if (res.code !== 0) continue;
		for (const thread of parseThreads(res.stdout)) {
			const match = WO_TITLE.exec(thread.title);
			if (!match) continue;
			const id = Number(match[1]);
			highest = Math.max(highest, id);
			if (thread.settled) continue;
			const state = await executor.status(thread.threadId).catch((e) => {
				if (e instanceof ExecutorError) return null;
				throw e;
			});
			if (!state) continue;
			const alive = ["running", "queued", "waiting_native"].includes(state.status);
			let prNumber: number | null = null;
			if (state.branch) {
				const prs = await cli("gh", [
					"pr",
					"list",
					"--repo",
					project.repo,
					"--head",
					state.branch,
					"--state",
					"open",
					"--json",
					"number",
				]);
				if (prs.code === 0) {
					try {
						prNumber = OpenPrs.safeParse(JSON.parse(prs.stdout)).data?.[0]?.number ?? null;
					} catch {
						// Reads as no PR. The engine looks again.
					}
				}
			}
			if (!alive && prNumber === null) continue;
			const at = store.iso();
			const added = store.db
				.prepare(
					`INSERT OR IGNORE INTO work_orders (id, project, type, title, description, stage, state, source, gates, agent, mode, thread_id, thread_link, branch, worktree, pr_number, created_at, updated_at, stage_at)
					VALUES (?, ?, 'Bug fix', ?, '', 'Build', 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					project.slug,
					match[2] as string,
					JSON.stringify({ kind: "restored" }),
					JSON.stringify(noGates()),
					store.settings().agents.agent,
					JSON.stringify(RESTORED_MODE),
					thread.threadId,
					thread.link ?? state.link,
					state.branch,
					state.worktree,
					prNumber,
					at,
					at,
					at,
				);
			if (added.changes > 0) {
				adopted += 1;
				store.addActivity(
					id,
					"Picked up again from its T3 thread. You merge this one, whatever mode it started in.",
				);
			}
		}
	}
	// A new work order must not reuse a number from before, because its branch would already exist.
	const row = store.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'work_orders'").get() as
		| { seq: number }
		| undefined;
	if (highest > (row?.seq ?? 0)) {
		store.db.prepare("DELETE FROM sqlite_sequence WHERE name = 'work_orders'").run();
		store.db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('work_orders', ?)").run(highest);
	}
	return adopted;
}
