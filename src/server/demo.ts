import type { Hono } from "hono";
import { z } from "zod";
import { mapGates, noGates, prGroup } from "../shared/rules.ts";
import type {
	CheckRun,
	ErrorItem,
	Gates,
	MainBranchState,
	Plan,
	PullRequest,
	Stage,
	ToolkitState,
	WorkOrderState,
	WorkType,
} from "../shared/types.ts";
import type { Bus } from "./bus.ts";
import type { Cli } from "./cli.ts";
import { kvSet } from "./db.ts";
import type { Engine } from "./engine.ts";
import { FakeExecutor } from "./executor/fake.ts";
import type { ThreadState } from "./executor/types.ts";
import type { ScaffoldRunner } from "./newproject.ts";
import type { Store } from "./store.ts";

/** Sample data for checking screens. Public, invented names only, and no connector ever runs in this mode. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const OWNER = "example-org";

class DemoExecutor extends FakeExecutor {
	override async status(threadId: string): Promise<ThreadState> {
		const t = this.threads.get(threadId);
		if (t) return t.state;
		return {
			status: "running",
			link: "https://t3.example/thread",
			branch: null,
			worktree: null,
			lastReply: null,
			recent: [
				"Reading the failing test.",
				"Adding a guard to the scorecard loader.",
				"Running the test suite.",
			],
			error: null,
		};
	}
	override async send(threadId: string, prompt: string) {
		if (this.threads.has(threadId)) return super.send(threadId, prompt);
	}
}

const demoCli: Cli = async (cmd, args) => {
	const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
	const line = `${cmd} ${args.join(" ")}`;
	if (cmd === "gh" && args[0] === "api" && args[1] === "user") return ok(OWNER);
	if (cmd === "gh" && args[0] === "repo" && args[1] === "view") {
		return args[2]?.endsWith("/taken") ? ok("{}") : { ...ok(), code: 1, stderr: "not found" };
	}
	if (cmd === "gh" && args[0] === "repo" && args[1] === "list") {
		return ok(
			JSON.stringify(
				[
					"fairway",
					"foundry",
					"gather",
					"arcade-club",
					"labs",
					"roadmaps",
					"satisfactory",
					"client-work",
					"client-archive",
				].map((n, i) => ({
					nameWithOwner: `${OWNER}/${n}`,
					pushedAt: new Date(Date.now() - i * DAY).toISOString(),
					isPrivate: i % 2 === 0,
					isArchived: false,
				})),
			),
		);
	}
	if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
		return ok(
			JSON.stringify({
				files: [
					{ path: "src/scorecard/load.ts", additions: 12, deletions: 3 },
					{ path: "tests/scorecard.test.ts", additions: 24, deletions: 0 },
				],
			}),
		);
	}
	if (line.includes("--version") || line.includes("auth status") || args[0] === "whoami")
		return ok("demo 1.0.0");
	return ok("{}");
};

const demoScaffold: ScaffoldRunner = async (run, step) => {
	await new Promise((r) => setTimeout(r, 400));
	if (run.name === "fail-template" && step === "template")
		return { ok: false, detail: "pnpm install failed: registry timeout" };
	if (run.name === "fail-baseline" && step === "baseline")
		return { ok: false, detail: "Tests failed: 1 of 3\nexpected 200, got 500" };
	return { ok: true };
};

const check = (name: string, bucket: CheckRun["bucket"], workflow = "CI"): CheckRun => ({
	name,
	workflow,
	bucket,
	url: `https://github.com/${OWNER}/actions/${name}`,
});
const PASS = [check("check", "pass"), check("deploy", "pass", "PR Preview")];
const FAIL = [check("check", "fail"), check("deploy", "pass", "PR Preview")];
const RUN = [check("check", "running"), check("deploy", "running", "PR Preview")];

interface ProjectSeed {
	slug: string;
	name: string;
	toolkit?: Partial<ToolkitState>;
	main?: Partial<MainBranchState>;
	missing?: boolean;
	paused?: boolean;
	noSentry?: boolean;
	merging?: "follow" | "ask";
}

interface WoSeed {
	project: string;
	title: string;
	type?: WorkType;
	stage: Stage;
	state: WorkOrderState;
	ageMin?: number;
	plan?: Plan;
	question?: object;
	failure?: string;
	failedGate?: string;
	retries?: number;
	prNumber?: number;
	gates?: Gates;
	hold?: boolean;
	output?: string[];
	mergedDaysAgo?: number;
	firstTry?: boolean;
	regressed?: boolean;
	fingerprint?: string;
	source?: object;
	activity?: Array<[string, string?]>;
}

const PLAN: Plan = {
	summary:
		"Guard the scorecard loader against courses with no holes, and show the empty state instead of crashing.",
	steps: [
		"Add a test for a course with no holes.",
		"Return an empty scorecard when holes is missing.",
		"Render the existing empty state.",
	],
	files: "src/scorecard/load.ts, tests/scorecard.test.ts",
	risk: "Low. The change is in one loader.",
	estimate: "About 10 minutes",
	outOfScope: "Reworking the course sync.",
};

const QUESTION = {
	question: "Keep the old migration?",
	detail: "The new table replaces it, but a rollback would need it. Removing it makes the release simpler.",
	options: [
		{ label: "Keep it", detail: "Safer rollback, one extra file." },
		{ label: "Remove it", detail: "Cleaner, no rollback past this release." },
		{ label: "Stop this work order", detail: "Closes it without changes.", stop: true },
	],
};

export function installDemo(store: Store) {
	const seedProject = (p: ProjectSeed) => {
		const now = store.now().getTime();
		const main: MainBranchState = {
			sha: "f81c0de2a9",
			message: "Update lockfile",
			committedAt: new Date(now - 2 * HOUR).toISOString(),
			state: "green",
			failing: [],
			...p.main,
		};
		store.db
			.prepare(
				`INSERT INTO projects (slug, repo, name, url, is_private, local_path, paused, merging, sentry_project, sentry_skipped, default_branch, toolkit, main, pushed_at, added_at, read_at)
				VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 'main', ?, ?, ?, ?, ?)`,
			)
			.run(
				p.slug,
				`${OWNER}/${p.slug}`,
				p.name,
				`https://github.com/${OWNER}/${p.slug}`,
				p.missing ? "/nowhere/on/this/mac" : "/tmp",
				p.paused ? 1 : 0,
				p.merging ?? "follow",
				p.noSentry ? null : p.slug,
				JSON.stringify({ status: "current", behindDays: 0, changed: 0, ...p.toolkit }),
				JSON.stringify(main),
				new Date(now - HOUR).toISOString(),
				new Date(now - 30 * DAY).toISOString(),
				new Date(now - MIN).toISOString(),
			);
	};

	const seedPr = (
		project: string,
		number: number,
		title: string,
		opts: Partial<PullRequest> & { checks?: CheckRun[]; ageDays?: number } = {},
	) => {
		const now = store.now().getTime();
		const checks = opts.checks ?? PASS;
		const base = {
			number,
			title,
			url: `https://github.com/${OWNER}/${project}/pull/${number}`,
			body: "",
			isDraft: false,
			additions: 36,
			deletions: 3,
			changedFiles: 2,
			headRef: `factory/wo-${number}`,
			headSha: `abc${number}`,
			baseRef: "main",
			createdAt: new Date(now - (opts.ageDays ?? 0) * DAY - HOUR).toISOString(),
			updatedAt: new Date(now - (opts.ageDays ?? 0) * DAY - 20 * MIN).toISOString(),
			mergeable: "MERGEABLE" as const,
			mergeState: "CLEAN",
			...opts,
			gates: opts.gates ?? mapGates(checks),
			checks,
		};
		const group = prGroup({ ...base, now });
		store.db
			.prepare("INSERT INTO prs (project, number, json) VALUES (?, ?, ?)")
			.run(project, number, JSON.stringify({ ...base, group }));
	};

	const seedError = (
		project: string,
		id: string,
		title: string,
		opts: Partial<ErrorItem> = {},
		stack = true,
	) => {
		const now = store.now().getTime();
		const item: Partial<ErrorItem> = {
			id,
			shortId: `${project.toUpperCase()}-${id}`,
			title,
			culprit: "src/scorecard/load.ts in loadScorecard",
			level: "error",
			events: 41,
			users: 14,
			firstSeen: new Date(now - 3 * HOUR).toISOString(),
			lastSeen: new Date(now - 5 * MIN).toISOString(),
			permalink: `https://sentry.example/issues/${id}`,
			histogram: [0, 0, 0, 1, 0, 2, 1, 3, 2, 8, 14, 41],
			environment: "production",
			firstRelease: "1.4.2",
			kind: "new",
			regressionOf: null,
			...opts,
		};
		const detail = stack
			? {
					stack: [
						{
							file: "src/scorecard/load.ts",
							line: 42,
							context: "const first = course.holes[0];",
							inApp: true,
						},
						{
							file: "src/screens/Round.tsx",
							line: 18,
							context: "const card = loadScorecard(course);",
							inApp: true,
						},
						{ file: "node_modules/react/index.js", line: 901, context: "renderWithHooks", inApp: false },
					],
					likelySource: "src/scorecard/load.ts:42",
				}
			: null;
		store.db
			.prepare("INSERT INTO errors (id, project, json, detail) VALUES (?, ?, ?, ?)")
			.run(id, project, JSON.stringify(item), detail ? JSON.stringify(detail) : null);
	};

	const seedWo = (w: WoSeed) => {
		const now = store.now().getTime();
		const at = new Date(now - (w.ageMin ?? 6) * MIN).toISOString();
		const merged = w.mergedDaysAgo != null ? new Date(now - w.mergedDaysAgo * DAY).toISOString() : null;
		const res = store.db
			.prepare(
				`INSERT INTO work_orders (project, type, title, description, stage, state, source, fingerprint, plan, question, failure, failed_gate, retries, first_try, hold, thread_id, thread_link, branch, worktree, pr_number, gates, agent, output, created_at, updated_at, stage_at, pr_opened_at, merged_at, finished_at, regressed, state_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				w.project,
				w.type ?? "Bug fix",
				w.title,
				w.title,
				w.stage,
				w.state,
				JSON.stringify(w.source ?? { kind: "person" }),
				w.fingerprint ?? null,
				w.plan ? JSON.stringify(w.plan) : null,
				w.question ? JSON.stringify(w.question) : null,
				w.failure ?? null,
				w.failedGate ?? null,
				w.retries ?? 0,
				w.firstTry === false ? 0 : 1,
				w.hold ? 1 : 0,
				w.state === "waiting" ? null : "demo:thread",
				w.state === "waiting" ? null : "https://t3.example/thread",
				`factory/wo-${w.title.length}-demo`,
				`~/Developer/.worktrees/${w.project}/factory-wo`,
				w.prNumber ?? null,
				JSON.stringify(w.gates ?? noGates()),
				JSON.stringify(w.output ?? []),
				at,
				at,
				at,
				w.prNumber ? at : null,
				merged,
				merged,
				w.regressed ? 1 : 0,
				at,
			);
		const id = Number(res.lastInsertRowid);
		for (const [text, detail] of w.activity ?? [["Added by you"], ["Created worktree and branch"]]) {
			store.db
				.prepare("INSERT INTO activity (work_order, at, text, detail) VALUES (?, ?, ?, ?)")
				.run(id, at, text, detail ?? null);
		}
		return id;
	};

	const reset = () => {
		for (const t of [
			"projects",
			"prs",
			"errors",
			"triage",
			"work_orders",
			"activity",
			"audit_log",
			"notified",
			"new_projects",
		]) {
			store.db.prepare(`DELETE FROM ${t}`).run();
		}
		store.db.prepare("DELETE FROM kv WHERE key NOT LIKE 'settings:cloneFolder'").run();
	};

	const healthy = (over: Partial<Record<"GitHub" | "Sentry" | "T3", object>> = {}) => {
		const now = store.now().getTime();
		for (const source of ["GitHub", "Sentry", "T3"] as const) {
			kvSet(store.db, `health:${source}`, {
				source,
				ok: true,
				lastOk: new Date(now - MIN).toISOString(),
				error: null,
				fix: null,
				nextCheckAt: new Date(now + MIN).toISOString(),
				...over[source],
			});
		}
	};

	const baseProjects = () => {
		seedProject({ slug: "fairway", name: "Fairway" });
		seedProject({ slug: "foundry", name: "Foundry" });
		seedProject({ slug: "gather", name: "Gather" });
		seedProject({ slug: "arcade-club", name: "Arcade Club" });
		seedProject({ slug: "roadmaps", name: "roadmaps", noSentry: true });
		seedProject({ slug: "satisfactory", name: "satisfactory", noSentry: true });
		seedProject({
			slug: "labs",
			name: "labs",
			noSentry: true,
			toolkit: { status: "behind", behindDays: 41, changed: 12 },
		});
	};

	const history = () => {
		const types: WorkType[] = ["Bug fix", "Feature", "Toolkit sync", "Chore"];
		for (let i = 0; i < 24; i += 1) {
			seedWo({
				project: i % 2 ? "fairway" : "foundry",
				title: `Shipped change ${i + 1}`,
				type: types[i % 3 === 0 ? 2 : i % 4] ?? "Chore",
				stage: "Observe",
				state: "done",
				mergedDaysAgo: i % 14,
				firstTry: i % 5 !== 0,
				prNumber: 100 + i,
				gates: noGates("passed"),
				activity: [["Shipped"]],
			});
		}
	};

	const full = () => {
		baseProjects();
		healthy();
		history();
		seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')", {
			users: 14,
			events: 41,
		});
		const q = seedWo({
			project: "foundry",
			title: "Migrate the invoices table",
			stage: "Build",
			state: "question",
			ageMin: 8,
			question: QUESTION,
			output: ["Reading the migration folder.", "Two migrations touch invoices."],
		});
		seedWo({
			project: "fairway",
			title: "Show the empty scorecard state",
			stage: "Plan",
			state: "plan_ready",
			plan: PLAN,
			ageMin: 12,
		});
		store.db.prepare("UPDATE projects SET main = ? WHERE slug = 'gather'").run(
			JSON.stringify({
				sha: "f81c0de2a9",
				message: "Update lockfile",
				committedAt: new Date(store.now().getTime() - 40 * MIN).toISOString(),
				state: "red",
				failing: [check("check", "fail")],
			}),
		);
		seedWo({
			project: "arcade-club",
			title: "Fix the leaderboard sort",
			stage: "Verify",
			state: "failed",
			failedGate: "Tests",
			retries: 1,
			firstTry: false,
			prNumber: 31,
			gates: { Typecheck: "passed", Tests: "failed", Lint: "passed", Preview: "passed" },
			failure: "FAIL tests/leaderboard.test.ts > sorts by score\nexpected [3, 2, 1], got [1, 2, 3]",
			activity: [
				["Created worktree and branch"],
				["Opened PR #31"],
				["Tests failed", "expected [3, 2, 1], got [1, 2, 3]"],
				["Tests failed after retries"],
			],
		});
		seedPr("arcade-club", 31, "Fix the leaderboard sort", { checks: FAIL, additions: 8, deletions: 2 });
		seedWo({
			project: "fairway",
			title: "Guard the scorecard loader",
			stage: "Build",
			state: "building",
			output: ["Reading the failing test.", "Adding a guard to the scorecard loader."],
			activity: [["Plan approved by you"], ["Created worktree and branch"]],
		});
		seedWo({
			project: "foundry",
			title: "Add invoice export",
			type: "Feature",
			stage: "Verify",
			state: "verifying",
			prNumber: 168,
			gates: { Typecheck: "passed", Tests: "running", Lint: "passed", Preview: "running" },
		});
		seedPr("foundry", 168, "Add invoice export", { checks: RUN });
		seedWo({
			project: "fairway",
			title: "Add the round summary",
			type: "Feature",
			stage: "Intake",
			state: "waiting",
		});
		seedWo({
			project: "roadmaps",
			title: "Update the changelog",
			type: "Chore",
			stage: "Review",
			state: "ready",
			prNumber: 96,
			gates: noGates("passed"),
		});
		seedPr("roadmaps", 96, "Update the changelog", {});
		seedPr("satisfactory", 12, "Sync toolkit standards", {});
		seedPr("labs", 7, "Try the new router", { ageDays: 40 });
		seedPr("gather", 44, "Rename the event model", {
			mergeable: "CONFLICTING",
			mergeState: "DIRTY",
			gates: { Typecheck: "out_of_date", Tests: "out_of_date", Lint: "out_of_date", Preview: "out_of_date" },
		});
		seedWo({
			project: "fairway",
			title: "Fix the handicap rounding",
			stage: "Observe",
			state: "observing",
			mergedDaysAgo: 0,
			prNumber: 90,
			gates: noGates("passed"),
		});
		seedWo({
			project: "foundry",
			title: "Remove the old export",
			type: "Chore",
			stage: "Ship",
			state: "shipping",
			mergedDaysAgo: 0,
			prNumber: 165,
			gates: noGates("passed"),
		});
		return q;
	};

	const SCENARIOS: Record<string, () => void> = {
		first_run: () => {},
		full,
		back: () => {
			full();
			kvSet(store.db, "visit_state", {
				back: {
					since: new Date(store.now().getTime() - 16 * HOUR).toISOString(),
					shipped: 4,
					failed: 1,
					newErrors: 2,
				},
				firstLook: false,
			});
		},
		first_look: () => {
			baseProjects();
			healthy();
			seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')");
			seedPr("satisfactory", 12, "Sync toolkit standards", {});
			kvSet(store.db, "visit_state", { back: null, firstLook: true });
		},
		empty: () => {
			baseProjects();
			healthy();
			history();
			seedPr("labs", 7, "Try the new router", { ageDays: 40 });
			seedPr("gather", 44, "Rename the event model", { mergeable: "CONFLICTING", mergeState: "DIRTY" });
		},
		quiet: () => {
			seedProject({ slug: "fairway", name: "Fairway" });
			seedProject({ slug: "foundry", name: "Foundry" });
			healthy();
		},
		limit: () => {
			full();
			kvSet(store.db, "settings:agents", {
				agentsAtOnce: 1,
				pauseOnReview: false,
				retries: 1,
				agent: "claude",
			});
		},
		review_hold: () => {
			full();
			kvSet(store.db, "settings:agents", {
				agentsAtOnce: 1,
				pauseOnReview: true,
				retries: 1,
				agent: "claude",
			});
		},
		loading: () => {
			baseProjects();
			store.db.prepare("UPDATE projects SET read_at = NULL").run();
		},
		degraded: () => {
			full();
			healthy({
				Sentry: {
					ok: false,
					lastOk: new Date(store.now().getTime() - 38 * MIN).toISOString(),
					error: "401 Unauthorized",
					fix: "sentry auth login",
				},
			});
		},
		stopped: () => {
			full();
			kvSet(store.db, "line", {
				stopped: true,
				stoppedAt: new Date(store.now().getTime() - 12 * MIN).toISOString(),
			});
			store.db
				.prepare(
					"UPDATE work_orders SET held_by_line = 1 WHERE state IN ('waiting', 'plan_approved', 'build_done')",
				)
				.run();
		},
		long: () => {
			full();
			const long =
				"Make the scorecard loader handle courses that were imported from the legacy federation export without any hole data and then re-synced";
			seedError(
				"foundry",
				"6002",
				`${long} — RangeError: Maximum call stack size exceeded in src/invoices/really/deeply/nested/folder/structure/render.ts`,
				{ users: 3 },
			);
			seedWo({ project: "foundry", title: long, stage: "Build", state: "building" });
			seedPr("foundry", 170, long, {
				headRef: "factory/wo-170-a-very-long-branch-name-that-keeps-going-and-going-past-the-edge",
			});
		},
		regression: () => {
			baseProjects();
			healthy();
			const fix = seedWo({
				project: "fairway",
				title: "Guard the scorecard loader",
				stage: "Observe",
				state: "done",
				mergedDaysAgo: 6,
				prNumber: 88,
				regressed: true,
				gates: noGates("passed"),
				fingerprint: "error:6001",
			});
			seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')", {
				kind: "regression",
				regressionOf: {
					workOrderId: fix,
					prNumber: 88,
					fixedAt: new Date(store.now().getTime() - 6 * DAY).toISOString(),
				},
			});
		},
		merge_ready: () => {
			baseProjects();
			healthy();
			// Enough record for each work type to qualify.
			for (let i = 0; i < 12; i += 1) {
				seedWo({
					project: "foundry",
					title: `Sync ${i}`,
					type: "Toolkit sync",
					stage: "Observe",
					state: "done",
					mergedDaysAgo: i % 10,
					prNumber: 200 + i,
					gates: noGates("passed"),
				});
			}
		},
		missing_folder: () => {
			seedProject({ slug: "fairway", name: "Fairway" });
			seedProject({
				slug: "labs",
				name: "labs",
				missing: true,
				noSentry: true,
				toolkit: { status: "behind", behindDays: 41, changed: 12 },
			});
			seedProject({
				slug: "roadmaps",
				name: "roadmaps",
				paused: true,
				noSentry: true,
				toolkit: { status: "behind", behindDays: 9, changed: 3 },
			});
			healthy();
		},
	};

	return {
		cli: demoCli,
		executor: new DemoExecutor(),
		scaffold: demoScaffold,
		routes(app: Hono, engine: Engine, bus: Bus) {
			app.post("/api/demo/scenario", async (c) => {
				const { name } = z.object({ name: z.string() }).parse(await c.req.json());
				const seed = SCENARIOS[name];
				if (!seed) return c.json({ error: "Unknown scenario" }, 404);
				reset();
				seed();
				bus.publish([
					"queue",
					"floor",
					"prs",
					"errors",
					"projects",
					"shell",
					"work-orders",
					"settings",
					"health",
					"line",
				]);
				void engine;
				return c.json({
					ok: true,
					ids: store.workOrders().map((w) => ({ id: w.id, state: w.state, title: w.title })),
				});
			});
		},
	};
}
