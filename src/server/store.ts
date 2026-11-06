import { applyNeverTouch, noGates } from "../shared/rules.ts";
import type {
	ActivityEntry,
	AgentSettings,
	ApprovalSettings,
	ErrorItem,
	NotificationSettings,
	Project,
	PullRequest,
	Settings,
	SourceHealth,
	SourceName,
	TriageState,
	WorkOrder,
	WorkOrderSource,
	WorkType,
} from "../shared/types.ts";
import { readNeverTouch } from "./config.ts";
import type { Db } from "./db.ts";
import { kvGet, kvSet } from "./db.ts";
import type { TriageRecord } from "../shared/rules.ts";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const OPEN_FILTER = "state NOT IN ('done', 'closed')";

const WORK_TYPE_MAP = <T>(v: T): Record<WorkType, T> => ({
	"Bug fix": v,
	Feature: v,
	"Toolkit sync": v,
	Chore: v,
});

export const DEFAULT_AGENTS: AgentSettings = {
	agentsAtOnce: 3,
	pauseOnReview: false,
	retries: 1,
	agent: "claude",
};

export const DEFAULT_APPROVALS: ApprovalSettings = {
	planReview: { "Bug fix": "always", Feature: "always", "Toolkit sync": "skip", Chore: "skip" },
	mergeWithoutMe: WORK_TYPE_MAP(false),
	turnedOffByRegression: WORK_TYPE_MAP(false),
	thresholds: { runs: 10, firstTryPct: 80 },
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
	events: {
		question: true,
		plan: true,
		ready_pr: true,
		failed_gates: true,
		error: true,
		red_main: true,
		merged_alone: true,
		shipped: false,
		slots_full: false,
	},
	onlyWhenAway: true,
	lastTest: null,
};

export const agentLabel = (agent: string) => (agent === "codex" ? "Codex in T3" : "Claude in T3");

export class Store {
	readonly db: Db;
	readonly dataDir: string;
	readonly now: () => Date;

	constructor(db: Db, dataDir: string, now: () => Date = () => new Date()) {
		this.db = db;
		this.dataDir = dataDir;
		this.now = now;
	}

	iso() {
		return this.now().toISOString();
	}

	/* ---------- settings ---------- */

	settings(): Settings {
		return {
			agents: { ...DEFAULT_AGENTS, ...kvGet<Partial<AgentSettings>>(this.db, "settings:agents") },
			approvals: { ...DEFAULT_APPROVALS, ...kvGet<Partial<ApprovalSettings>>(this.db, "settings:approvals") },
			notifications: {
				...DEFAULT_NOTIFICATIONS,
				...kvGet<Partial<NotificationSettings>>(this.db, "settings:notifications"),
			},
			projects: {
				cloneFolder: kvGet<string>(this.db, "settings:cloneFolder") ?? join(homedir(), "Developer"),
				neverTouch: readNeverTouch(this.dataDir),
			},
		};
	}

	saveApprovals(a: ApprovalSettings): void {
		kvSet(this.db, "settings:approvals", a);
	}

	neverTouch(): string[] {
		return readNeverTouch(this.dataDir);
	}

	line(): { stopped: boolean; stoppedAt: string | null } {
		return kvGet(this.db, "line") ?? { stopped: false, stoppedAt: null };
	}

	/* ---------- projects ---------- */

	/** Every project read goes through here, so a new never-touch rule takes effect everywhere at once. */
	projects(): Project[] {
		const rows = this.db
			.prepare("SELECT * FROM projects WHERE removed_at IS NULL ORDER BY name COLLATE NOCASE")
			.all() as unknown as ProjectRow[];
		const candidates = rows.map((r) => ({ row: r, repo: r.repo, path: r.local_path }));
		const { kept } = applyNeverTouch(this.neverTouch(), candidates);
		return kept.map(({ row }) => this.toProject(row));
	}

	project(slug: string): Project | null {
		return this.projects().find((p) => p.slug === slug) ?? null;
	}

	private toProject(r: ProjectRow): Project {
		const count = (sql: string, ...args: (string | number)[]) =>
			(this.db.prepare(sql).get(...args) as { n: number }).n;
		const main = r.main ? JSON.parse(r.main) : null;
		return {
			slug: r.slug,
			repo: r.repo,
			name: r.name,
			url: r.url,
			isPrivate: !!r.is_private,
			localPath: r.local_path,
			folderMissing: r.local_path ? !existsSync(r.local_path) : true,
			paused: !!r.paused,
			merging: r.merging as Project["merging"],
			sentryProject: r.sentry_project,
			sentrySkipped: !!r.sentry_skipped,
			defaultBranch: r.default_branch,
			toolkit: JSON.parse(r.toolkit),
			pushedAt: r.pushed_at,
			addedAt: r.added_at,
			readAt: r.read_at,
			openPrs: count("SELECT COUNT(*) n FROM prs WHERE project = ?", r.slug),
			openErrors: count("SELECT COUNT(*) n FROM errors WHERE project = ?", r.slug),
			openWorkOrders: count(`SELECT COUNT(*) n FROM work_orders WHERE project = ? AND ${OPEN_FILTER}`, r.slug),
			redMain: main?.state === "red",
		};
	}

	main(slug: string) {
		const row = this.db.prepare("SELECT main FROM projects WHERE slug = ?").get(slug) as
			| { main: string | null }
			| undefined;
		return row?.main ? JSON.parse(row.main) : null;
	}

	/* ---------- PRs ---------- */

	prs(project?: string): PullRequest[] {
		const visible = this.projects();
		const names = new Map(visible.map((p) => [p.slug, p.name]));
		const links = this.db
			.prepare(`SELECT id, project, pr_number, type FROM work_orders WHERE pr_number IS NOT NULL AND ${OPEN_FILTER}`)
			.all() as Array<{ id: number; project: string; pr_number: number; type: WorkType }>;
		const rows = this.db.prepare("SELECT project, json FROM prs").all() as Array<{ project: string; json: string }>;
		return rows
			.filter((r) => names.has(r.project) && (!project || r.project === project))
			.map((r) => {
				const pr = JSON.parse(r.json) as Omit<PullRequest, "project" | "projectName" | "workOrderId" | "workType">;
				const link = links.find((l) => l.project === r.project && l.pr_number === pr.number);
				return {
					...pr,
					project: r.project,
					projectName: names.get(r.project) ?? r.project,
					workOrderId: link?.id ?? null,
					workType: link?.type ?? null,
				};
			})
			.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	}

	pr(project: string, number: number): PullRequest | null {
		return this.prs(project).find((p) => p.number === number) ?? null;
	}

	/* ---------- errors ---------- */

	errors(project?: string): ErrorItem[] {
		const visible = new Map(this.projects().map((p) => [p.slug, p]));
		const rows = this.db.prepare("SELECT project, json FROM errors").all() as Array<{
			project: string;
			json: string;
		}>;
		return rows
			.filter((r) => visible.has(r.project) && (!project || r.project === project))
			.map((r) => this.decorateError(JSON.parse(r.json), visible.get(r.project)?.name ?? r.project))
			.sort((a, b) => b.users - a.users || Date.parse(a.firstSeen) - Date.parse(b.firstSeen));
	}

	error(id: string): ErrorItem | null {
		return this.errors().find((e) => e.id === id) ?? null;
	}

	private decorateError(e: ErrorItem, projectName: string): ErrorItem {
		const fp = `error:${e.id}`;
		const open = this.db
			.prepare(`SELECT id FROM work_orders WHERE fingerprint = ? AND ${OPEN_FILTER} AND stage NOT IN ('Observe')`)
			.get(fp) as { id: number } | undefined;
		return { ...e, projectName, workOrderId: open?.id ?? null, triage: this.triage(fp) };
	}

	/* ---------- triage ---------- */

	triage(fingerprint: string): TriageState | null {
		const row = this.db.prepare("SELECT action, until, at FROM triage WHERE fingerprint = ?").get(fingerprint) as
			| { action: "snooze" | "dismiss"; until: string | null; at: string }
			| undefined;
		return row ?? null;
	}

	triageRecord(fingerprint: string): TriageRecord | null {
		const row = this.db.prepare("SELECT * FROM triage WHERE fingerprint = ?").get(fingerprint) as
			| {
					action: "snooze" | "dismiss";
					until: string | null;
					baseline_events: number;
					baseline_users: number;
					baseline_release: string | null;
			  }
			| undefined;
		if (!row) return null;
		return {
			action: row.action,
			until: row.until,
			baselineEvents: row.baseline_events,
			baselineUsers: row.baseline_users,
			baselineRelease: row.baseline_release,
		};
	}

	/* ---------- work orders ---------- */

	workOrders(where = OPEN_FILTER, ...args: (string | number)[]): WorkOrder[] {
		const rows = this.db
			.prepare(`SELECT * FROM work_orders WHERE ${where} ORDER BY id`)
			.all(...args) as unknown as WorkOrderRow[];
		const visible = new Map(this.projects().map((p) => [p.slug, p]));
		return rows.filter((r) => visible.has(r.project)).map((r) => this.toWorkOrder(r, visible.get(r.project)));
	}

	workOrder(id: number): WorkOrder | null {
		const row = this.db.prepare("SELECT * FROM work_orders WHERE id = ?").get(id) as unknown as
			| WorkOrderRow
			| undefined;
		if (!row) return null;
		const project = this.project(row.project);
		if (!project) return null;
		return this.toWorkOrder(row, project);
	}

	private toWorkOrder(r: WorkOrderRow, project: Project | undefined): WorkOrder {
		const activity = this.db
			.prepare("SELECT at, text, detail FROM activity WHERE work_order = ? ORDER BY id")
			.all(r.id) as Array<{ at: string; text: string; detail: string | null }>;
		const source = JSON.parse(r.source) as WorkOrderSource;
		return {
			id: r.id,
			project: r.project,
			projectName: project?.name ?? r.project,
			type: r.type,
			title: r.title,
			description: r.description,
			stage: r.stage as WorkOrder["stage"],
			state: r.state as WorkOrder["state"],
			source,
			plan: r.plan ? JSON.parse(r.plan) : null,
			question: r.question ? JSON.parse(r.question) : null,
			failure: r.failure,
			failedGate: r.failed_gate as WorkOrder["failedGate"],
			retries: r.retries,
			firstTry: !!r.first_try,
			hold: !!r.hold,
			heldByLine: !!r.held_by_line,
			threadId: r.thread_id,
			threadLink: r.thread_link,
			branch: r.branch,
			worktree: r.worktree,
			prNumber: r.pr_number,
			gates: JSON.parse(r.gates),
			agent: agentLabel(r.agent),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			stageAt: r.stage_at,
			finishedAt: r.finished_at,
			mergedAt: r.merged_at,
			activity: activity.map((a): ActivityEntry => ({ at: a.at, text: a.text, detail: a.detail ?? undefined })),
			output: JSON.parse(r.output),
			waitingFor: this.waitingFor(r, project),
		};
	}

	private waitingFor(r: WorkOrderRow, project: Project | undefined): string | null {
		if (r.state !== "waiting" && r.state !== "plan_approved") return null;
		if (project?.paused) return `${project.name} is paused.`;
		if (project?.folderMissing) return `${project.name}'s folder is missing.`;
		return null;
	}

	insertWorkOrder(input: {
		project: string;
		type: WorkType;
		title: string;
		description: string;
		source: WorkOrderSource;
		agent: string;
		prNumber?: number | null;
		branch?: string | null;
	}): number {
		const at = this.iso();
		const res = this.db
			.prepare(
				`INSERT INTO work_orders (project, type, title, description, stage, state, source, fingerprint, gates, agent, pr_number, created_at, updated_at, stage_at)
				VALUES (?, ?, ?, ?, 'Intake', 'waiting', ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.project,
				input.type,
				input.title,
				input.description,
				JSON.stringify(input.source),
				input.source.fingerprint ?? null,
				JSON.stringify(noGates()),
				input.agent,
				input.prNumber ?? null,
				at,
				at,
				at,
			);
		return Number(res.lastInsertRowid);
	}

	patchWorkOrder(id: number, patch: Partial<WorkOrderPatch>): void {
		const entries = Object.entries(patch);
		if (entries.length === 0) return;
		const set = entries.map(([k]) => `${k} = ?`).join(", ");
		this.db
			.prepare(`UPDATE work_orders SET ${set}, updated_at = ? WHERE id = ?`)
			.run(...(entries.map(([, v]) => v) as (string | number | null)[]), this.iso(), id);
	}

	addActivity(id: number, text: string, detail: string | null = null): void {
		this.db
			.prepare("INSERT INTO activity (work_order, at, text, detail) VALUES (?, ?, ?, ?)")
			.run(id, this.iso(), text, detail);
	}

	/* ---------- source health ---------- */

	health(): SourceHealth[] {
		return (["GitHub", "Sentry", "T3"] as SourceName[]).map(
			(source) =>
				kvGet<SourceHealth>(this.db, `health:${source}`) ?? {
					source,
					ok: true,
					lastOk: null,
					error: null,
					fix: null,
					nextCheckAt: null,
				},
		);
	}

	setHealth(h: SourceHealth): void {
		kvSet(this.db, `health:${h.source}`, h);
	}
}

export interface ProjectRow {
	slug: string;
	repo: string;
	name: string;
	url: string;
	is_private: number;
	local_path: string | null;
	paused: number;
	merging: string;
	sentry_project: string | null;
	sentry_skipped: number;
	default_branch: string;
	toolkit: string;
	main: string | null;
	pushed_at: string | null;
	added_at: string;
	read_at: string | null;
}

export interface WorkOrderRow {
	id: number;
	project: string;
	type: WorkType;
	title: string;
	description: string;
	stage: string;
	state: string;
	source: string;
	fingerprint: string | null;
	plan: string | null;
	question: string | null;
	failure: string | null;
	failed_gate: string | null;
	retries: number;
	first_try: number;
	hold: number;
	held_by_line: number;
	thread_id: string | null;
	thread_link: string | null;
	branch: string | null;
	worktree: string | null;
	pr_number: number | null;
	gates: string;
	agent: string;
	output: string;
	created_at: string;
	updated_at: string;
	stage_at: string;
	pr_opened_at: string | null;
	finished_at: string | null;
	merged_at: string | null;
	regressed: number;
	failed_sha: string | null;
	state_at: string | null;
}

export type WorkOrderPatch = Pick<
	WorkOrderRow,
	| "stage"
	| "state"
	| "plan"
	| "question"
	| "failure"
	| "failed_gate"
	| "retries"
	| "first_try"
	| "hold"
	| "held_by_line"
	| "thread_id"
	| "thread_link"
	| "branch"
	| "worktree"
	| "pr_number"
	| "gates"
	| "output"
	| "stage_at"
	| "pr_opened_at"
	| "finished_at"
	| "merged_at"
	| "regressed"
	| "failed_sha"
	| "state_at"
>;
