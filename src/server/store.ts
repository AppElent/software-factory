import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultModes } from "../shared/modes.ts";
import type { TriageRecord } from "../shared/rules.ts";
import {
	agentHoldsMerge,
	branchIsntOurs,
	DEFAULT_DEADLINES,
	isRegression,
	issueGroup,
	issueLocked,
	issueSignals,
	noGates,
	securityOf,
	triageHides,
} from "../shared/rules.ts";
import type {
	ActivityEntry,
	AgentSettings,
	ApprovalSettings,
	EnvironmentView,
	ErrorItem,
	Issue,
	IssueAdvice,
	Mode,
	NotificationSettings,
	Project,
	ProjectSecurity,
	PullRequest,
	SecurityRead,
	SecuritySettings,
	Settings,
	SourceHealth,
	SourceName,
	TriageState,
	WorkOrder,
	WorkOrderSource,
	WorkType,
} from "../shared/types.ts";
import { scrub } from "./cli.ts";
import { filterNeverTouch, readNeverTouch } from "./config.ts";
import { type ConfigData, ConfigFile } from "./config-file.ts";
import type { IssueRead } from "./connectors/github.ts";
import type { Db } from "./db.ts";
import { kvGet, kvSet } from "./db.ts";

interface IssueStateRow {
	project: string;
	number: number;
	read_hash: string | null;
	read_at: string | null;
	hidden: string | null;
	hidden_hash: string | null;
	hidden_until: string | null;
	advice: string | null;
	advice_hash: string | null;
}

/** A folder in someone else's home came from another Mac's config file, and means nothing here. */
const cloneFolderHere = (saved: string | null | undefined) => {
	const home = homedir();
	const elsewhere = saved?.startsWith("/Users/") && !saved.startsWith(`${home}/`) && !existsSync(saved);
	return saved && !elsewhere ? saved : join(home, "Developer");
};

const REGRESSED = "regressed_while_broken";

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
	readonly configDir: string;
	readonly file: ConfigFile;
	readonly now: () => Date;

	constructor(db: Db, dataDir: string, now: () => Date = () => new Date(), configDir: string = dataDir) {
		this.db = db;
		this.dataDir = dataDir;
		this.configDir = configDir;
		this.file = new ConfigFile(configDir);
		this.now = now;
	}

	iso() {
		return this.now().toISOString();
	}

	/* ---------- settings ---------- */

	/** The config file wins. Values still in the database are from before it existed. */
	settings(): Settings {
		const saved = this.file.read().settings as {
			agents?: Partial<AgentSettings>;
			approvals?: Partial<ApprovalSettings>;
			notifications?: Partial<NotificationSettings>;
			security?: { deadlines?: Partial<SecuritySettings["deadlines"]> };
			cloneFolder?: string;
		};
		const notifications = kvGet<Partial<NotificationSettings>>(this.db, "settings:notifications");
		const approvals: ApprovalSettings = {
			...DEFAULT_APPROVALS,
			...kvGet<Partial<ApprovalSettings>>(this.db, "settings:approvals"),
			...saved.approvals,
		};
		// A file that can't be read isn't a yes, and the old values in the database may not be what you want now.
		if (this.file.error()) approvals.mergeWithoutMe = WORK_TYPE_MAP(false);
		for (const type of kvGet<WorkType[]>(this.db, REGRESSED) ?? []) {
			approvals.mergeWithoutMe = { ...approvals.mergeWithoutMe, [type]: false };
			approvals.turnedOffByRegression = { ...approvals.turnedOffByRegression, [type]: true };
		}
		return {
			agents: {
				...DEFAULT_AGENTS,
				...kvGet<Partial<AgentSettings>>(this.db, "settings:agents"),
				...saved.agents,
			},
			approvals,
			notifications: {
				...DEFAULT_NOTIFICATIONS,
				...notifications,
				...saved.notifications,
				// How the last test went is a fact about this Mac, so it isn't config.
				lastTest: notifications?.lastTest ?? null,
			},
			projects: {
				cloneFolder: cloneFolderHere(saved.cloneFolder ?? kvGet<string>(this.db, "settings:cloneFolder")),
				neverTouch: readNeverTouch(this.configDir),
			},
			security: { deadlines: { ...DEFAULT_DEADLINES, ...saved.security?.deadlines } },
		};
	}

	saveSettings(change: {
		agents?: AgentSettings;
		approvals?: ApprovalSettings;
		notifications?: Omit<NotificationSettings, "lastTest">;
		security?: SecuritySettings;
		cloneFolder?: string;
	}): void {
		this.file.update((data) => ({
			...data,
			settings: { ...data.settings, ...(change as ConfigData["settings"]) },
		}));
	}

	saveApprovals(a: ApprovalSettings): void {
		this.saveSettings({ approvals: a });
	}

	/**
	 * Settings from before the config file only live in the database, where they'd be lost with it, and where
	 * they'd come back if the file went. They move once. How the last notification test went stays: it's about this Mac.
	 */
	moveSettingsToFile(): void {
		if (this.file.error()) return;
		const agents = kvGet<Partial<AgentSettings>>(this.db, "settings:agents");
		const approvals = kvGet<Partial<ApprovalSettings>>(this.db, "settings:approvals");
		const cloneFolder = kvGet<string>(this.db, "settings:cloneFolder");
		const { lastTest = null, ...notifications } =
			kvGet<Partial<NotificationSettings>>(this.db, "settings:notifications") ?? {};
		const hasNotifications = Object.keys(notifications).length > 0;
		if (!agents && !approvals && !cloneFolder && !hasNotifications) return;
		this.file.update((data) => {
			// What's in the file wins, as it did when both were read.
			const saved = data.settings;
			const moved = {
				...(agents ? { agents: { ...agents, ...saved.agents } } : {}),
				...(approvals ? { approvals: { ...approvals, ...saved.approvals } } : {}),
				...(hasNotifications ? { notifications: { ...notifications, ...saved.notifications } } : {}),
				...(cloneFolder ? { cloneFolder: saved.cloneFolder ?? cloneFolder } : {}),
			};
			return { ...data, settings: { ...saved, ...(moved as ConfigData["settings"]) } };
		});
		for (const key of ["settings:agents", "settings:approvals", "settings:cloneFolder"])
			this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
		if (hasNotifications) kvSet(this.db, "settings:notifications", { lastTest });
	}

	/** A regression always stops merging alone. When the file can't be written, that's held here until it can. */
	stopMergingAfterRegression(type: WorkType): boolean {
		if (this.file.error()) {
			const held = kvGet<WorkType[]>(this.db, REGRESSED) ?? [];
			if (!held.includes(type)) kvSet(this.db, REGRESSED, [...held, type]);
			return true;
		}
		const approvals = this.settings().approvals;
		if (!approvals.mergeWithoutMe[type]) return false;
		this.saveApprovals({
			...approvals,
			mergeWithoutMe: { ...approvals.mergeWithoutMe, [type]: false },
			turnedOffByRegression: { ...approvals.turnedOffByRegression, [type]: true },
		});
		return true;
	}

	/** Writes what stopMergingAfterRegression held, once the file is fixed. */
	settleRegressions(): void {
		if (this.file.error() || !kvGet<WorkType[]>(this.db, REGRESSED)?.length) return;
		this.saveApprovals(this.settings().approvals);
		kvSet(this.db, REGRESSED, []);
	}

	neverTouch(): string[] {
		return readNeverTouch(this.configDir);
	}

	/* ---------- modes ---------- */

	/** Saved modes, or the defaults for the skills on this Mac until you save some. */
	modes(skills: string[]): { modes: Mode[]; defaultMode: string } {
		const data = this.file.read();
		const modes = data.modes ?? defaultModes(skills);
		const wanted = data.defaultMode;
		const usable = modes.find((m) => m.id === wanted && m.merge !== "factory");
		return { modes, defaultMode: usable?.id ?? modes.find((m) => m.merge !== "factory")?.id ?? "" };
	}

	saveModes(modes: Mode[], defaultMode: string): void {
		this.file.update((data) => {
			// A field from a newer version stays on its mode.
			const before = new Map(data.modes?.map((m) => [m.id, m]));
			return { ...data, modes: modes.map((m) => ({ ...before.get(m.id), ...m })), defaultMode };
		});
	}

	line(): { stopped: boolean; stoppedAt: string | null } {
		return kvGet(this.db, "line") ?? { stopped: false, stoppedAt: null };
	}

	/* ---------- projects ---------- */

	/** Every project read goes through here, so a new never-touch rule takes effect everywhere at once. */
	projects(): Project[] {
		const { deadlines } = this.settings().security;
		return this.projectRows().map((row) => this.toProject(row, deadlines));
	}

	private projectRows(): ProjectRow[] {
		const rows = this.db
			.prepare("SELECT * FROM projects WHERE removed_at IS NULL ORDER BY name COLLATE NOCASE")
			.all() as unknown as ProjectRow[];
		const candidates = rows.map((r) => ({ row: r, repo: r.repo, path: r.local_path }));
		return filterNeverTouch(this.neverTouch(), candidates).kept.map(({ row }) => row);
	}

	project(slug: string): Project | null {
		return this.projects().find((p) => p.slug === slug) ?? null;
	}

	private toProject(r: ProjectRow, deadlines: SecuritySettings["deadlines"]): Project {
		const read = r.security ? (JSON.parse(r.security) as SecurityRead) : null;
		const { alerts: _, ...security } = securityOf(read, deadlines, this.now().getTime(), r.url);
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
			lastDeployAt: (
				this.db
					.prepare(
						"SELECT MAX(merged_at) at FROM work_orders WHERE project = ? AND state IN ('observing', 'done')",
					)
					.get(r.slug) as { at: string | null }
			).at,
			openPrs: count("SELECT COUNT(*) n FROM prs WHERE project = ?", r.slug),
			openErrors: count("SELECT COUNT(*) n FROM errors WHERE project = ?", r.slug),
			openWorkOrders: count(
				`SELECT COUNT(*) n FROM work_orders WHERE project = ? AND ${OPEN_FILTER}`,
				r.slug,
			),
			redMain: main?.state === "red",
			security,
		};
	}

	/** Every project's alerts and setup. */
	security(): ProjectSecurity[] {
		const { deadlines } = this.settings().security;
		return this.projectRows().map((r) => {
			const read = r.security ? (JSON.parse(r.security) as SecurityRead) : null;
			return {
				...securityOf(read, deadlines, this.now().getTime(), r.url),
				slug: r.slug,
				name: r.name,
				repo: r.repo,
				url: r.url,
				setup: read?.setup ?? {
					alerts: null,
					securityUpdates: null,
					dependabotConfig: null,
					branchProtected: null,
				},
				readAt: read ? r.read_at : null,
			};
		});
	}

	main(slug: string) {
		const row = this.db.prepare("SELECT main FROM projects WHERE slug = ?").get(slug) as
			| { main: string | null }
			| undefined;
		return row?.main ? JSON.parse(row.main) : null;
	}

	/* ---------- PRs ---------- */

	/** A PR the agent is still changing can't read as ready, wherever it's shown. */
	prs(project?: string): PullRequest[] {
		const visible = this.projects();
		const names = new Map(visible.map((p) => [p.slug, p.name]));
		const links = this.db
			.prepare(
				`SELECT id, project, pr_number, branch, type, state, failed_sha, source FROM work_orders WHERE (pr_number IS NOT NULL OR branch IS NOT NULL) AND ${OPEN_FILTER}`,
			)
			.all() as Array<{
			id: number;
			project: string;
			pr_number: number | null;
			branch: string | null;
			type: WorkType;
			state: string;
			failed_sha: string | null;
			source: string;
		}>;
		// Picked-up work on a branch that isn't the factory's, even the default one, doesn't own what's on it.
		const byBranch = (l: (typeof links)[number]) =>
			!branchIsntOurs({ source: JSON.parse(l.source) as { kind: string }, branch: l.branch });
		const rows = this.db.prepare("SELECT project, json FROM prs").all() as Array<{
			project: string;
			json: string;
		}>;
		return rows
			.filter((r) => names.has(r.project) && (!project || r.project === project))
			.map((r) => {
				const pr = JSON.parse(r.json) as Omit<
					PullRequest,
					"project" | "projectName" | "workOrderId" | "workType"
				>;
				// The agent opens its PR mid-turn, before the factory knows the number. Its branch says whose it is.
				const linked = links.filter(
					(l) =>
						l.project === r.project &&
						(l.pr_number === pr.number || (l.branch === pr.headRef && !pr.fromFork && byBranch(l))),
				);
				const holds = (l: (typeof links)[number]) =>
					agentHoldsMerge({ state: l.state, failedSha: l.failed_sha }, pr.headSha);
				// A rebase can run on a PR that has its own work order. Whichever is busy is the one that counts.
				const link = linked.find(holds) ?? linked[0];
				const held = link && holds(link);
				return {
					...pr,
					group: held && pr.group === "ready" ? "running" : pr.group,
					heldBy: held || undefined,
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

	/* ---------- issues ---------- */

	/** GitHub's list replaces the old one. What you've read stays, pinned to the text you read. */
	saveIssues(project: string, issues: IssueRead[]) {
		this.db.prepare("DELETE FROM issues WHERE project = ?").run(project);
		const insert = this.db.prepare("INSERT INTO issues (project, number, json) VALUES (?, ?, ?)");
		for (const i of issues) insert.run(project, i.number, JSON.stringify(i));
	}

	/** Open issues, without those you've put away. An edit brings one back. */
	issues(project?: string): Issue[] {
		return this.allIssues(project).filter((i) => !i.hidden);
	}

	issue(project: string, number: number): Issue | null {
		return this.allIssues(project).find((i) => i.number === number) ?? null;
	}

	private allIssues(project?: string): Array<Issue & { hidden: boolean }> {
		const names = new Map(this.projects().map((p) => [p.slug, p.name]));
		const now = this.now().getTime();
		const states = new Map(
			(this.db.prepare("SELECT * FROM issue_state").all() as unknown as IssueStateRow[]).map((s) => [
				`${s.project}:${s.number}`,
				s,
			]),
		);
		const owners = new Map(
			(
				this.db
					.prepare(
						`SELECT id, fingerprint FROM work_orders WHERE fingerprint LIKE 'issue:%' AND ${OPEN_FILTER}`,
					)
					.all() as Array<{ id: number; fingerprint: string }>
			).map((o) => [o.fingerprint, o.id]),
		);
		const rows = this.db.prepare("SELECT project, number, json FROM issues").all() as Array<{
			project: string;
			number: number;
			json: string;
		}>;
		return rows
			.filter((r) => names.has(r.project) && (!project || r.project === project))
			.map((r) => {
				const i = JSON.parse(r.json) as IssueRead;
				const s = states.get(`${r.project}:${r.number}`);
				const read = !!s && s.read_hash === i.bodyHash;
				const signals = issueSignals(i, now);
				const fp = `issue:${r.project}:${r.number}`;
				const expired = !!s?.hidden_until && Date.parse(s.hidden_until) <= now;
				return {
					...i,
					project: r.project,
					projectName: names.get(r.project) ?? r.project,
					signals,
					group: issueGroup(signals, read),
					readAt: read ? (s?.read_at ?? null) : null,
					editedSinceRead: !!s?.read_hash && !read,
					locked: issueLocked(signals, read),
					advice: s?.advice && s.advice_hash === i.bodyHash ? (JSON.parse(s.advice) as IssueAdvice) : null,
					asking: this.askingIssues.has(fp),
					workOrderId: owners.get(fp) ?? null,
					hidden: !!s?.hidden && s.hidden_hash === i.bodyHash && !expired,
				};
			})
			.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	}

	/** Set by Environments, whose reads need more than the database. */
	envViews: () => EnvironmentView[] = () => [];

	/** Issues an agent is reading right now. Not saved: after a restart you can just ask again. */
	readonly askingIssues = new Set<string>();

	markIssueRead(project: string, number: number, hash: string) {
		this.db
			.prepare(
				`INSERT INTO issue_state (project, number, read_hash, read_at) VALUES (?, ?, ?, ?)
				ON CONFLICT(project, number) DO UPDATE SET read_hash = excluded.read_hash, read_at = excluded.read_at`,
			)
			.run(project, number, hash, this.iso());
	}

	hideIssue(project: string, number: number, how: string | null, hash: string | null, until: string | null) {
		this.db
			.prepare(
				`INSERT INTO issue_state (project, number, hidden, hidden_hash, hidden_until) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(project, number) DO UPDATE SET hidden = excluded.hidden, hidden_hash = excluded.hidden_hash, hidden_until = excluded.hidden_until`,
			)
			.run(project, number, how, hash, until);
	}

	saveIssueAdvice(project: string, number: number, advice: IssueAdvice, hash: string) {
		this.db
			.prepare(
				`INSERT INTO issue_state (project, number, advice, advice_hash) VALUES (?, ?, ?, ?)
				ON CONFLICT(project, number) DO UPDATE SET advice = excluded.advice, advice_hash = excluded.advice_hash`,
			)
			.run(project, number, JSON.stringify(advice), hash);
	}

	/* ---------- errors ---------- */

	/** The release an error was on when its fix merged. */
	fixRelease(workOrderId: number): string | null {
		return kvGet<string>(this.db, `fix_release:${workOrderId}`);
	}

	errors(project?: string): ErrorItem[] {
		const visible = new Map(this.projects().map((p) => [p.slug, p]));
		const rows = this.db.prepare("SELECT project, json FROM errors").all() as Array<{
			project: string;
			json: string;
		}>;
		return rows
			.filter((r) => visible.has(r.project) && (!project || r.project === project))
			.map((r) =>
				this.decorateError(
					{ ...JSON.parse(r.json), project: r.project },
					visible.get(r.project)?.name ?? r.project,
				),
			)
			.sort((a, b) => b.users - a.users || Date.parse(a.firstSeen) - Date.parse(b.firstSeen));
	}

	error(id: string): ErrorItem | null {
		return this.errors().find((e) => e.id === id) ?? null;
	}

	private decorateError(e: ErrorItem, projectName: string): ErrorItem {
		const fp = `error:${e.id}`;
		const open = this.db
			.prepare(
				// A fix being observed still owns its error, until the error comes back.
				`SELECT id FROM work_orders WHERE fingerprint = ? AND ${OPEN_FILTER}${e.kind === "regression" ? " AND stage <> 'Observe'" : ""}`,
			)
			.get(fp) as { id: number } | undefined;
		// A shipped fix owns its error until the error comes back. Nothing new has happened to offer it again.
		const fix =
			open || e.kind === "regression"
				? null
				: (this.db
						.prepare(
							"SELECT id, merged_at FROM work_orders WHERE fingerprint = ? AND merged_at IS NOT NULL ORDER BY id DESC",
						)
						.get(fp) as { id: number; merged_at: string } | undefined);
		const owner =
			open?.id ??
			(fix &&
			!isRegression(
				{ lastSeen: e.lastSeen, release: e.latestRelease ?? null },
				{ mergedAt: fix.merged_at, release: this.fixRelease(fix.id) },
			)
				? fix.id
				: null);
		// A snooze that woke, or a dismissal that got worse, no longer counts as triaged.
		const rec = this.triageRecord(fp);
		const held =
			rec &&
			triageHides(
				rec,
				{ events: e.events, users: e.users, release: e.latestRelease ?? e.firstRelease },
				this.now().getTime(),
			);
		return { ...e, projectName, workOrderId: owner, triage: held ? this.triage(fp) : null };
	}

	/* ---------- triage ---------- */

	triage(fingerprint: string): TriageState | null {
		const row = this.db
			.prepare("SELECT action, until, at FROM triage WHERE fingerprint = ?")
			.get(fingerprint) as { action: "snooze" | "dismiss"; until: string | null; at: string } | undefined;
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
			mode: r.mode ? (JSON.parse(r.mode) as Mode) : null,
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
			activity: activity.map(
				(a): ActivityEntry => ({ at: a.at, text: a.text, detail: a.detail ?? undefined }),
			),
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
		mode?: Mode | null;
	}): number {
		const at = this.iso();
		const res = this.db
			.prepare(
				`INSERT INTO work_orders (project, type, title, description, stage, state, source, fingerprint, gates, agent, pr_number, mode, created_at, updated_at, stage_at)
				VALUES (?, ?, ?, ?, 'Intake', 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				input.mode ? JSON.stringify(input.mode) : null,
				at,
				at,
				at,
			);
		return Number(res.lastInsertRowid);
	}

	patchWorkOrder(id: number, patch: Partial<WorkOrderPatch>): void {
		// Agent output and failure text can quote a token. Nothing token-shaped reaches the database or the page.
		const entries = Object.entries(patch).map(([k, v]) => [k, typeof v === "string" ? scrub(v) : v] as const);
		if (entries.length === 0) return;
		const set = entries.map(([k]) => `${k} = ?`).join(", ");
		this.db
			.prepare(`UPDATE work_orders SET ${set}, updated_at = ? WHERE id = ?`)
			.run(...(entries.map(([, v]) => v) as (string | number | null)[]), this.iso(), id);
	}

	errorDetail(id: string | undefined): { release?: string | null } | null {
		if (!id) return null;
		const row = this.db.prepare("SELECT detail FROM errors WHERE id = ?").get(id) as
			| { detail: string | null }
			| undefined;
		return row?.detail ? JSON.parse(row.detail) : null;
	}

	addActivity(id: number, text: string, detail: string | null = null): void {
		this.db
			.prepare("INSERT INTO activity (work_order, at, text, detail) VALUES (?, ?, ?, ?)")
			.run(id, this.iso(), scrub(text), detail === null ? null : scrub(detail));
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
	security: string | null;
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
	pending_send: string | null;
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
	mode: string | null;
}

export type WorkOrderPatch = Pick<
	WorkOrderRow,
	| "stage"
	| "state"
	| "plan"
	| "question"
	| "failure"
	| "failed_gate"
	| "pending_send"
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
