import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
	slug TEXT PRIMARY KEY, repo TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 0,
	local_path TEXT, paused INTEGER NOT NULL DEFAULT 0, merging TEXT NOT NULL DEFAULT 'follow',
	sentry_project TEXT, sentry_skipped INTEGER NOT NULL DEFAULT 0, default_branch TEXT NOT NULL DEFAULT 'main',
	toolkit TEXT NOT NULL DEFAULT '{"status":"unknown","behindDays":0,"changed":0}', main TEXT, pushed_at TEXT,
	added_at TEXT NOT NULL, read_at TEXT, removed_at TEXT
);
CREATE TABLE IF NOT EXISTS prs (
	project TEXT NOT NULL, number INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (project, number)
);
CREATE TABLE IF NOT EXISTS issues (
	project TEXT NOT NULL, number INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (project, number)
);
CREATE TABLE IF NOT EXISTS issue_state (
	project TEXT NOT NULL, number INTEGER NOT NULL,
	read_hash TEXT, read_at TEXT,
	hidden TEXT, hidden_hash TEXT, hidden_until TEXT,
	advice TEXT, advice_hash TEXT,
	PRIMARY KEY (project, number)
);
CREATE TABLE IF NOT EXISTS deploys (
	id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, env TEXT NOT NULL, command TEXT NOT NULL,
	state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER,
	sha TEXT, message TEXT, log TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS env_health (
	project TEXT NOT NULL, env TEXT NOT NULL, ok INTEGER, status INTEGER, ms INTEGER, error TEXT,
	checked_at TEXT, down_since TEXT, fails INTEGER NOT NULL DEFAULT 0,
	deployed_sha TEXT, deployed_at TEXT, deployed_read_at TEXT, behind INTEGER, behind_of TEXT,
	PRIMARY KEY (project, env)
);
CREATE TABLE IF NOT EXISTS errors (
	id TEXT PRIMARY KEY, project TEXT NOT NULL, json TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS triage (
	fingerprint TEXT PRIMARY KEY, action TEXT NOT NULL, until TEXT, baseline_events INTEGER NOT NULL DEFAULT 0,
	baseline_users INTEGER NOT NULL DEFAULT 0, baseline_release TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_orders (
	id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL, state TEXT NOT NULL, source TEXT NOT NULL,
	fingerprint TEXT, plan TEXT, question TEXT, failure TEXT, failed_gate TEXT, retries INTEGER NOT NULL DEFAULT 0,
	first_try INTEGER NOT NULL DEFAULT 1, hold INTEGER NOT NULL DEFAULT 0, held_by_line INTEGER NOT NULL DEFAULT 0,
	thread_id TEXT, thread_link TEXT, branch TEXT, worktree TEXT, pr_number INTEGER, gates TEXT NOT NULL,
	agent TEXT NOT NULL, pending_send TEXT, output TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL, stage_at TEXT NOT NULL, pr_opened_at TEXT, finished_at TEXT, merged_at TEXT, regressed INTEGER NOT NULL DEFAULT 0,
	failed_sha TEXT, state_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_fingerprint ON work_orders (fingerprint)
	WHERE fingerprint IS NOT NULL AND state NOT IN ('done', 'closed');
CREATE TABLE IF NOT EXISTS activity (
	id INTEGER PRIMARY KEY AUTOINCREMENT, work_order INTEGER NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, started_by TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS new_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notified (key TEXT PRIMARY KEY, at TEXT NOT NULL);
`;

export type Db = DatabaseSync;

/** `CREATE TABLE IF NOT EXISTS` doesn't reach a table an older version made. */
function addColumn(db: Db, table: string, column: string, type: string) {
	const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function openDb(path: string): Db {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
	db.exec(SCHEMA);
	addColumn(db, "work_orders", "mode", "TEXT");
	return db;
}

export function kvGet<T>(db: Db, key: string): T | null {
	const row = db.prepare("SELECT json FROM kv WHERE key = ?").get(key) as { json: string } | undefined;
	return row ? (JSON.parse(row.json) as T) : null;
}

export function kvSet(db: Db, key: string, value: unknown): void {
	db.prepare(
		"INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
	).run(key, JSON.stringify(value));
}

export function kvDelete(db: Db, key: string): void {
	db.prepare("DELETE FROM kv WHERE key = ?").run(key);
}

export function audit(
	db: Db,
	action: string,
	target: string,
	startedBy = "you",
	detail: string | null = null,
	now: Date = new Date(),
): void {
	db.prepare("INSERT INTO audit_log (at, action, target, started_by, detail) VALUES (?, ?, ?, ?, ?)").run(
		now.toISOString(),
		action,
		target,
		startedBy,
		detail,
	);
}
