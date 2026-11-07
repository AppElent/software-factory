import { z } from "zod";
import { noGates } from "../shared/rules.ts";
import type { Mode } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { filterNeverTouch } from "./config.ts";
import { ConfigFileError } from "./config-file.ts";
import { kvGet, kvSet } from "./db.ts";
import type { Executor } from "./executor/types.ts";
import { OPEN_FILTER, type Store } from "./store.ts";

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

/** Set until T3 has answered for every project, because on a new Mac it often can't yet. */
export const PICK_UP = "pick_up_pending";

/** The file couldn't be read when this database was new, so its projects still have to come in. */
const RESTORE_OWED = "restore_owed";

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
	// A database that has never held a project has nothing to say, and an empty list would wipe the file.
	const held = store.db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
	if (held.n === 0 || kvGet(store.db, RESTORE_OWED) === true) return;
	// A field from a newer version, or one you added, stays on its entry.
	const before = new Map(store.file.read().projects.map((p) => [p.repo, p]));
	const next = entries(store).map((e) => ({ ...before.get(e.repo), ...e }));
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
	const owed = kvGet(store.db, RESTORE_OWED) === true;
	if (seen.n > 0 && !owed) return 0;
	if (store.file.error()) {
		kvSet(store.db, RESTORE_OWED, true);
		return 0;
	}
	const have = new Set(store.projects().map((p) => p.repo));
	const wanted = store.file
		.read()
		.projects.filter((p) => REPO.test(p.repo) && !have.has(p.repo))
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
	if (owed) kvSet(store.db, RESTORE_OWED, false);
	if (kept.length > 0) {
		if (seen.n === 0) kvSet(store.db, "new_device", true);
		kvSet(store.db, PICK_UP, true);
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
		return Threads.safeParse(JSON.parse(text)).data ?? null;
	} catch {
		return null;
	}
};

const OpenPrs = z.array(z.object({ number: z.number() }));

/** `starting` is a run with this number still waiting to hear which thread T3 gave it, which may be this one. */
const ownerOf = (store: Store, threadId: string, number: number) => {
	if (store.db.prepare("SELECT 1 FROM work_orders WHERE thread_id = ?").get(threadId)) return "held";
	const row = store.db
		.prepare(`SELECT 1 FROM work_orders WHERE id = ? AND thread_id IS NULL AND ${OPEN_FILTER}`)
		.get(number);
	return row ? "starting" : "free";
};

/**
 * Picks up work that's still going, from T3's threads. Finished work is history, and stays gone. Only projects
 * already in the factory are read, so a Never touch repo's threads are never looked at.
 */
export async function rebuildWorkOrders(store: Store, cli: Cli, executor: Executor): Promise<number> {
	let adopted = 0;
	let highest = 0;
	let complete = true;
	for (const project of store.projects()) {
		if (!project.localPath) continue;
		const res = await cli("t3", ["thread", "list", "--project", project.localPath, "--json"]);
		const threads = res.code === 0 ? parseThreads(res.stdout) : null;
		if (!threads) {
			complete = false;
			continue;
		}
		for (const thread of threads) {
			const match = WO_TITLE.exec(thread.title);
			if (!match) continue;
			const id = Number(match[1]);
			highest = Math.max(highest, id);
			if (thread.settled) continue;
			if (ownerOf(store, thread.threadId, id) !== "free") {
				if (ownerOf(store, thread.threadId, id) === "starting") complete = false;
				continue;
			}
			const state = await executor.status(thread.threadId).catch(() => null);
			if (!state) {
				complete = false;
				continue;
			}
			const alive = ["running", "queued", "waiting_native"].includes(state.status);
			let prNumber: number | null = null;
			let prKnown = true;
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
						prNumber = OpenPrs.parse(JSON.parse(prs.stdout))[0]?.number ?? null;
					} catch {
						prKnown = false;
					}
				} else prKnown = false;
			}
			if (!alive && prNumber === null) {
				// Finished with no PR is history, but only if GitHub really said so. `gh` may not be signed in yet.
				if (!prKnown) complete = false;
				continue;
			}
			// Those calls took a moment, and a run can have got its thread in the meantime.
			if (ownerOf(store, thread.threadId, id) !== "free") {
				if (ownerOf(store, thread.threadId, id) === "starting") complete = false;
				continue;
			}
			const at = store.iso();
			const adopt = store.db.prepare(
				`INSERT OR IGNORE INTO work_orders (id, project, type, title, description, stage, state, source, gates, agent, mode, thread_id, thread_link, branch, worktree, pr_number, created_at, updated_at, stage_at)
				VALUES (?, ?, 'Bug fix', ?, '', 'Build', 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			const insert = (number: number | null) =>
				adopt.run(
					number,
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
			// A work order started while T3 wasn't answering can have this number already. The thread still counts.
			const taken = insert(id).changes === 0;
			const added = taken ? insert(null) : null;
			const newId = taken ? Number(added?.lastInsertRowid) : id;
			if (newId) {
				adopted += 1;
				store.addActivity(
					newId,
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
	if (complete) kvSet(store.db, PICK_UP, false);
	return adopted;
}
