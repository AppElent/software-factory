import {
	gateSummary,
	isNeedsYou,
	isRegression,
	median,
	ownsNoPr,
	qualifies,
	rankQueue,
	triageHides,
} from "../shared/rules.ts";
import type {
	BackSummary,
	DailyNumbers,
	ErrorItem,
	FloorResponse,
	HealthResponse,
	NewProjectRun,
	ProjectDetail,
	QueueItem,
	QueueResponse,
	ShellResponse,
	Stage,
	StageCounts,
	WorkOrder,
	WorkType,
	WorkTypeHealth,
} from "../shared/types.ts";
import { STAGES, WORK_TYPES } from "../shared/types.ts";
import { filterNeverTouch } from "./config.ts";
import { kvGet } from "./db.ts";
import type { Engine } from "./engine.ts";
import type { Store } from "./store.ts";

export const stageCounts = (open: WorkOrder[]): StageCounts => {
	const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as unknown as StageCounts;
	for (const w of open) counts[w.stage] += 1;
	return counts;
};

const ACTIVE_STATES: WorkOrder["state"][] = ["planning", "building", "retrying", "rebasing"];

export function readShell(store: Store, engine: Engine, build: string): ShellResponse {
	const open = store.workOrders();
	const queue = readItems(store);
	const health = store.health();
	const projects = store.projects();
	const floor = open.filter((w) => !["Intake", "Observe"].includes(w.stage)).length;
	const limits = engine.limits();
	return {
		hasProjects: projects.length > 0,
		counts: {
			queue: queue.length,
			floor,
			prs: store.prs().length,
			issues: store.issues().length,
			errors: store.errors().filter((e) => e.triage?.action !== "dismiss").length,
			projects: projects.length,
		},
		agents: { working: limits.build, limit: limits.agents },
		line: store.line(),
		sources: health,
		checking: projects.length > 0 && projects.every((p) => !p.readAt),
		build,
	};
}

/** Every queue item, ranked, with triaged ones removed. */
function readItems(store: Store): QueueItem[] {
	const now = store.now().getTime();
	const items: QueueItem[] = [];
	const open = store.workOrders();

	for (const e of store.errors()) {
		if (e.workOrderId) continue;
		items.push({
			fingerprint: `error:${e.id}`,
			kind: "error",
			project: e.project,
			projectName: e.projectName,
			title: e.title,
			meta: `${e.kind === "regression" ? "Regression" : "Production error"} · ${e.users} ${e.users === 1 ? "user" : "users"}`,
			since: e.kind === "regression" ? e.lastSeen : e.firstSeen,
			users: e.users,
			href: `/errors/${e.id}`,
			error: e,
		});
	}

	for (const w of open) {
		const base = {
			project: w.project,
			projectName: w.projectName,
			since: w.updatedAt,
			users: 0,
			href: `/work-orders/${w.id}`,
			workOrder: w,
		};
		const id = `WO-${w.id} · ${w.stage}`;
		if (w.state === "question") {
			items.push({
				...base,
				fingerprint: `wo:${w.id}:question`,
				kind: "question",
				title: `Agent asks: ${w.question?.question ?? ""}`,
				meta: id,
			});
		} else if (w.state === "plan_ready") {
			items.push({
				...base,
				fingerprint: `wo:${w.id}:plan`,
				kind: "plan",
				title: `Plan ready: ${w.title}`,
				meta: id,
			});
		} else if (w.state === "waiting_in_t3") {
			items.push({
				...base,
				fingerprint: `wo:${w.id}:t3`,
				kind: "waiting_in_t3",
				title: `Agent is waiting in T3: ${w.title}`,
				meta: id,
			});
		} else if (w.state === "run_failed") {
			items.push({
				...base,
				fingerprint: `wo:${w.id}:run`,
				kind: "run_failed",
				title: `Run failed: ${w.title}`,
				meta: id,
			});
		} else if (w.state === "failed") {
			items.push({
				...base,
				fingerprint: `wo:${w.id}:failed`,
				kind: "failed_gates",
				title: `${w.failedGate ?? "A gate"} failed: ${w.title}`,
				meta: `${id} · retries used`,
			});
		}
	}

	for (const p of store.projects()) {
		const main = store.main(p.slug);
		if (main?.state === "red") {
			const prs = store.prs(p.slug);
			const failing = main.failing[0];
			items.push({
				fingerprint: `main:${p.slug}`,
				kind: "red_main",
				project: p.slug,
				projectName: p.name,
				title: `CI red on ${p.defaultBranch}${failing ? `: ${failing.name}` : ""}`,
				meta: failing?.workflow ?? "GitHub Actions",
				since: main.committedAt,
				users: 0,
				href: `/projects/${p.slug}`,
				main: { ...main, blocks: prs.length },
			});
		}
		if (p.toolkit.status === "behind") {
			const hasSync = store
				.workOrders("source LIKE '%\"toolkit\"%' AND state NOT IN ('done', 'closed')")
				.some((w) => w.project === p.slug);
			if (!hasSync) {
				items.push({
					fingerprint: `toolkit:${p.slug}`,
					kind: "toolkit",
					project: p.slug,
					projectName: p.name,
					title: "Toolkit is behind",
					meta: "Sync available",
					since: new Date(now - p.toolkit.behindDays * 86_400_000).toISOString(),
					users: 0,
					href: `/projects/${p.slug}`,
					toolkit: p.toolkit,
				});
			}
		}
	}

	const SERVICE_NAMES: Record<string, string> = { sentry: "Sentry", eas: "EAS", infisical: "Infisical" };
	const runs = store.db.prepare("SELECT id, json FROM new_projects").all() as Array<{
		id: number;
		json: string;
	}>;
	for (const row of runs) {
		const run = { ...JSON.parse(row.json), id: row.id } as NewProjectRun;
		if (!filterNeverTouch(store.neverTouch(), [{ repo: run.repo, path: run.localPath }]).kept.length)
			continue;
		const project = run.projectSlug ? store.project(run.projectSlug) : null;
		if (run.step === "failed" || run.step === "baseline") {
			items.push({
				fingerprint: `new-project:${run.id}`,
				kind: "new_project",
				project: project?.slug ?? null,
				projectName: run.name,
				title:
					run.step === "baseline" ? `The baseline is red on ${run.name}` : `${run.name} couldn't be built`,
				meta: "New project",
				since: run.failedAt ?? store.iso(),
				users: 0,
				href: `/projects/new/${run.step}?run=${run.id}`,
				newProject: { id: run.id, step: run.step },
			});
		}
		if (!project) continue;
		for (const [service, state] of Object.entries(run.services)) {
			if (state !== "skipped") continue;
			const name = SERVICE_NAMES[service] ?? service;
			items.push({
				fingerprint: `tool:${run.id}:${service}`,
				kind: "tool",
				project: project.slug,
				projectName: project.name,
				title: `${name} isn't set up on ${project.name}`,
				meta: "Skipped when you made it",
				since: project.addedAt,
				users: 0,
				href: "/settings/tools",
				tool: { name, fix: run.serviceTools[service]?.fix ?? null },
			});
		}
	}

	const rebasing = new Set(
		// One that finished has nothing left to do, so a PR that fell behind again is news.
		open
			.filter((w) => w.source.kind === "rebase_pr" && w.state !== "ready")
			.map((w) => `${w.project}:${w.prNumber}`),
	);
	for (const pr of store.prs()) {
		const base = {
			fingerprint: `pr:${pr.project}:${pr.number}`,
			project: pr.project,
			projectName: pr.projectName,
			users: 0,
			href: `/prs/${pr.project}/${pr.number}`,
			pr,
		};
		const title = `#${pr.number} ${pr.title}`;
		if (pr.group === "ready") {
			items.push({
				...base,
				kind: "ready_pr",
				title,
				meta: `${gateSummary(pr.gates)} · ready to merge`,
				since: pr.updatedAt,
			});
		} else if (rebasing.has(`${pr.project}:${pr.number}`)) {
		} else if (pr.group === "stale") {
			items.push({ ...base, kind: "stale_pr", title, meta: "Stale · no activity", since: pr.updatedAt });
		} else if (pr.group === "rebase") {
			items.push({ ...base, kind: "rebase_pr", title, meta: "Needs rebase", since: pr.updatedAt });
		}
	}

	return rankQueue(items).filter((item) => !isTriaged(store, item, now));
}

function isTriaged(store: Store, item: QueueItem, now: number) {
	const rec = store.triageRecord(item.fingerprint);
	if (!rec) return false;
	// Dismissing a red main is about that commit. A later commit going red is news.
	if (item.main && rec.action === "dismiss" && rec.baselineRelease !== item.main.sha) return false;
	const current = {
		events: item.error?.events ?? 0,
		users: item.error?.users ?? 0,
		release: item.error?.latestRelease ?? item.error?.firstRelease ?? item.main?.sha ?? null,
	};
	return triageHides(rec, current, now);
}

export const readItemsForNotify = (store: Store) => readItems(store);

/** The numbers a triage record compares against later. */
export function triageBaseline(store: Store, fingerprint: string) {
	const item = readAllUntriaged(store).find((i) => i.fingerprint === fingerprint);
	return {
		events: item?.error?.events ?? 0,
		users: item?.error?.users ?? 0,
		release: item?.error?.latestRelease ?? item?.error?.firstRelease ?? item?.main?.sha ?? null,
	};
}

function readAllUntriaged(store: Store): QueueItem[] {
	const errors = store.errors().map(
		(e: ErrorItem): QueueItem => ({
			fingerprint: `error:${e.id}`,
			kind: "error",
			project: e.project,
			projectName: e.projectName,
			title: e.title,
			meta: "",
			since: e.firstSeen,
			users: e.users,
			href: "",
			error: e,
		}),
	);
	const mains = store.projects().flatMap((p): QueueItem[] => {
		const main = store.main(p.slug);
		if (!main) return [];
		return [
			{
				fingerprint: `main:${p.slug}`,
				kind: "red_main",
				project: p.slug,
				projectName: p.name,
				title: "",
				meta: "",
				since: main.committedAt,
				users: 0,
				href: "",
				main: { ...main, blocks: 0 },
			},
		];
	});
	return [...errors, ...mains];
}

export function readQueue(store: Store, engine: Engine): QueueResponse {
	const items = readItems(store);
	const open = store.workOrders();
	const projects = store.projects();
	const health = store.health();
	const visit = kvGet<{ back: BackSummary | null; firstLook: boolean }>(store.db, "visit_state");
	const nextChecks = health.map((h) => h.nextCheckAt).filter(Boolean) as string[];
	return {
		loading: projects.length > 0 && projects.every((p) => !p.readAt) && !items.length,
		projects: projects.length,
		stages: stageCounts(open),
		limits: engine.limits(),
		needsYou: items.filter((i) => isNeedsYou(i.kind)),
		later: items.filter((i) => !isNeedsYou(i.kind)),
		sources: health,
		back: visit?.back ?? null,
		firstLook: visit?.firstLook ?? false,
		nextCheckAt: nextChecks.sort()[0] ?? null,
	};
}

export function readFloor(store: Store, engine: Engine, project?: string): FloorResponse {
	const all = store.workOrders();
	const open = project ? all.filter((w) => w.project === project) : all;
	const columns = Object.fromEntries(STAGES.map((s) => [s, [] as WorkOrder[]])) as unknown as Record<
		Stage,
		WorkOrder[]
	>;
	for (const w of open) columns[w.stage].push(w);
	const weekAgo = store.now().getTime() - 7 * 86_400_000;
	const merged = store.workOrders("merged_at IS NOT NULL");
	const week = merged.filter((w) => w.mergedAt && Date.parse(w.mergedAt) >= weekAgo);
	const firstTry = week.filter((w) => w.firstTry).length;
	const limits = engine.limits();
	// An untriaged error first seen after a change shipped to the same project is traced to that change.
	const observeErrors = new Map<string, ErrorItem>();
	const causedErrors: Record<number, number> = {};
	const openErrors = store.errors(project).filter((e) => !e.triage);
	for (const w of columns.Observe) {
		if (!w.mergedAt) continue;
		const shipped = Date.parse(w.mergedAt);
		const caused = openErrors.filter((e) => e.project === w.project && Date.parse(e.firstSeen) >= shipped);
		causedErrors[w.id] = caused.length;
		for (const e of caused) observeErrors.set(e.id, e);
	}
	return {
		projects: store.projects().map((p) => ({ slug: p.slug, name: p.name })),
		columns,
		observeErrors: [...observeErrors.values()],
		causedErrors,
		limits,
		line: store.line(),
		summary: {
			shippedThisWeek: week.length,
			firstTryPct: week.length ? Math.round((firstTry / week.length) * 100) : null,
			medianToPrMinutes: medianToPr(store, week),
		},
		stopImpact: {
			finishing: all.filter((w) => ACTIVE_STATES.includes(w.state)).length,
			waiting: all.filter((w) => w.stage === "Intake" || w.state === "plan_approved").length,
			review: all.filter((w) => w.stage === "Review").length,
		},
	};
}

function medianToPr(store: Store, list: WorkOrder[]): number | null {
	if (list.length === 0) return null;
	const rows = store.db
		.prepare(
			`SELECT created_at, pr_opened_at FROM work_orders WHERE pr_opened_at IS NOT NULL AND id IN (${list.map((w) => w.id).join(",")})`,
		)
		.all() as Array<{ created_at: string; pr_opened_at: string }>;
	const m = median(rows.map((r) => (Date.parse(r.pr_opened_at) - Date.parse(r.created_at)) / 60_000));
	return m === null ? null : Math.round(m);
}

/** A project's record over the last 30 days, for its page. */
export function readProjectRecord(store: Store, slug: string): ProjectDetail["last30"] {
	const since = new Date(store.now().getTime() - 30 * 24 * 3_600_000).toISOString();
	const list = store.workOrders("project = ? AND merged_at >= ?", slug, since);
	return {
		shipped: list.length,
		firstTry: list.filter((w) => w.firstTry).length,
		medianToPrMinutes: medianToPr(store, list),
	};
}

export function readHealth(store: Store, days = 14): HealthResponse {
	const { approvals } = store.settings();
	const merged = store.workOrders("merged_at IS NOT NULL");
	const regressed = (w: WorkOrder) =>
		(store.db.prepare("SELECT regressed FROM work_orders WHERE id = ?").get(w.id) as { regressed: number })
			.regressed === 1;
	const byType: WorkTypeHealth[] = WORK_TYPES.map((type: WorkType) => {
		const runs = merged.filter((w) => w.type === type && !ownsNoPr(w.source.kind));
		const first = runs.filter((w) => w.firstTry).length;
		const regressions = runs.filter(regressed).length;
		return {
			type,
			runs: runs.length,
			firstTryPct: runs.length ? Math.round((first / runs.length) * 100) : null,
			medianToPrMinutes: medianToPr(store, runs),
			regressions,
			qualifies: qualifies({ runs: runs.length, firstTry: first, regressions }, approvals.thresholds),
			mergeWithoutMe: approvals.mergeWithoutMe[type],
			turnedOffByRegression: approvals.turnedOffByRegression[type],
		};
	});
	const now = store.now();
	const daily: DailyNumbers[] = [];
	for (let i = days - 1; i >= 0; i -= 1) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		const list = merged.filter((w) => w.mergedAt?.slice(0, 10) === key);
		daily.push({
			day: key,
			shipped: list.length,
			firstTryPct: list.length
				? Math.round((list.filter((w) => w.firstTry).length / list.length) * 100)
				: null,
			medianToPrMinutes: medianToPr(store, list),
			regressions: list.filter(regressed).length,
		});
	}
	const first = merged.filter((w) => w.firstTry).length;
	const dayMs = 24 * 3_600_000;
	const inWindow = merged.filter((w) => (w.mergedAt ?? "") >= (daily[0]?.day ?? ""));
	const previousStart = new Date(Date.parse(daily[0]?.day ?? "") - days * dayMs).toISOString().slice(0, 10);
	const previous = merged.filter(
		(w) => (w.mergedAt ?? "") >= previousStart && (w.mergedAt ?? "") < (daily[0]?.day ?? ""),
	);
	return {
		finished: merged.length,
		byType,
		daily,
		window: {
			shipped: inWindow.length,
			firstTry: inWindow.filter((w) => w.firstTry).length,
			medianToPrMinutes: medianToPr(store, inWindow),
			previousMedianToPrMinutes: medianToPr(store, previous),
		},
		totals: {
			shipped: merged.length,
			firstTryPct: merged.length ? Math.round((first / merged.length) * 100) : null,
			medianToPrMinutes: medianToPr(store, merged),
			regressions: merged.filter(regressed).length,
		},
	};
}

const fixedError = (e: ErrorItem) => ({ lastSeen: e.lastSeen, release: e.latestRelease ?? null });

/** Marks shipped fixes whose error came back. Returns the work orders newly regressed. */
export function findRegressions(
	store: Store,
): Array<{ id: number; type: WorkType; prNumber: number | null }> {
	const out: Array<{ id: number; type: WorkType; prNumber: number | null }> = [];
	for (const e of store.errors()) {
		const fix = store.db
			.prepare(
				"SELECT id, type, pr_number, merged_at, regressed FROM work_orders WHERE fingerprint = ? AND merged_at IS NOT NULL ORDER BY id DESC",
			)
			.get(`error:${e.id}`) as
			| { id: number; type: WorkType; pr_number: number | null; merged_at: string; regressed: number }
			| undefined;
		if (!fix || !isRegression(fixedError(e), { mergedAt: fix.merged_at, release: store.fixRelease(fix.id) }))
			continue;
		if (fix.regressed) continue;
		store.db
			.prepare(
				"UPDATE work_orders SET regressed = 1, state = CASE WHEN state = 'observing' THEN 'done' ELSE state END WHERE id = ?",
			)
			.run(fix.id);
		store.addActivity(fix.id, "The error came back after this fix");
		out.push({ id: fix.id, type: fix.type, prNumber: fix.pr_number });
	}
	return out;
}
