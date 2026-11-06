import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { mapGates, noGates, prGroup, snoozeUntil } from "../shared/rules.ts";
import type {
	CheckRun,
	ErrorItem,
	Gates,
	MainBranchState,
	NewProjectRun,
	Plan,
	PullRequest,
	Stage,
	ToolkitState,
	WorkOrderState,
	WorkType,
} from "../shared/types.ts";
import type { Bus } from "./bus.ts";
import type { Cli } from "./cli.ts";
import { writeNeverTouch } from "./config.ts";
import { kvSet } from "./db.ts";
import type { Engine } from "./engine.ts";
import { FakeExecutor } from "./executor/fake.ts";
import type { ThreadState } from "./executor/types.ts";
import { SCAFFOLD_STEPS, type ScaffoldRunner } from "./newproject.ts";
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
			status: threadId === "demo:waiting" ? "waiting_native" : "running",
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
		return args[2]?.endsWith("/taken")
			? ok("{}")
			: { ...ok(), code: 1, stderr: "GraphQL: Could not resolve to a Repository" };
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
	if (cmd === "gh" && args[0] === "repo" && args[1] === "clone") {
		mkdirSync(args[3] as string, { recursive: true });
		return ok();
	}
	if (cmd === "gh" && args[0] === "pr" && args[1] === "view" && args[2] === "170") {
		return ok(
			JSON.stringify({
				files: [
					{
						path: "packages/scorecards/src/features/shared-rounds/components/round-summary/RoundSummaryCard.integration.test.tsx",
						additions: 12046,
						deletions: 9981,
					},
				],
			}),
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
	/** How long the work order took to open its PR. */
	toPrMin?: number;
	regressed?: boolean;
	fingerprint?: string;
	source?: object;
	activity?: Array<[string, string?]>;
	/** A thread id with its own demo behaviour, or null for a run that never got one. */
	thread?: string | null;
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

const PR_BODIES: Record<string, string> = {
	"Update the changelog":
		"Adds this release's changes to the changelog.\n- Lists the scorecard fixes\n- Follows the approved plan with no changes",
	"Sync toolkit standards":
		"Brings this project up to the current developer-tools standards. No app code changed.\n- Replaces 3 local rules with the shared preset\n- Updates the CI workflow to the shared action",
	"Fix the leaderboard sort": "Sorts the leaderboard by score, highest first.",
	"Add invoice export": "Adds a button that exports invoices as a CSV file.",
	"Rename the event model": "Renames Event to Gathering across the data layer.",
	"Try the new router": "Moves two screens to the new router to see how it feels.",
	"Course search empty state":
		"Shows a message and a clear-search action when a course search finds nothing.",
	"Export your data as JSON":
		"Adds an export button in settings that downloads all your lists as a JSON file.",
	"Make the scorecard loader handle courses that were imported from the legacy federation export without any hole data and then re-synced":
		"Cached rounds now include their holes. Rounds cached before this change refetch once, which can take a moment on a slow connection, so the scorecard shows its loading state until the refetch finishes and then renders exactly as it did before.",
};

export function installDemo(store: Store) {
	/** Folders that must exist or go missing for real, inside the demo's own data folder. */
	const demoFolders = join(store.dataDir, "demo-folders");
	/** Clones stay in the demo's own folder, so a demo clone never lands in the real clone folder. */
	const clones = join(store.dataDir, "clones");
	/** Tools that first run and Settings should find missing or signed out. */
	let toolFaults: Record<string, "missing" | "signed_out"> = {};

	const prepareRepos = () => {
		rmSync(clones, { recursive: true, force: true });
		for (const name of ["fairway", "foundry", "gather"]) {
			mkdirSync(join(clones, name, ".git"), { recursive: true });
		}
		kvSet(store.db, "settings:cloneFolder", clones);
		// The client-* repos on the demo's GitHub list are skipped before reading, as a real rule would.
		writeNeverTouch(store.dataDir, ["client-*"]);
	};
	prepareRepos();

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
				p.missing ? join(demoFolders, p.slug) : "/tmp",
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
			body: PR_BODIES[title] ?? "",
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
					releasePrs: [
						{
							number: 92,
							title: "Share a round with a link",
							url: `https://github.com/${OWNER}/${project}/pull/92`,
							additions: 312,
							deletions: 40,
						},
						{
							number: 93,
							title: "Cache finished rounds",
							url: `https://github.com/${OWNER}/${project}/pull/93`,
							additions: 88,
							deletions: 12,
						},
					],
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
				w.state === "waiting" || w.thread === null ? null : (w.thread ?? "demo:thread"),
				w.state === "waiting" || w.thread === null ? null : "https://t3.example/thread",
				`factory/wo-${w.title.length}-demo`,
				`~/Developer/.worktrees/${w.project}/factory-wo`,
				w.prNumber ?? null,
				JSON.stringify(w.gates ?? noGates()),
				JSON.stringify(w.output ?? []),
				at,
				at,
				at,
				w.prNumber ? new Date(Date.parse(at) + (w.toPrMin ?? 0) * MIN).toISOString() : null,
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
		toolFaults = {};
		rmSync(demoFolders, { recursive: true, force: true });
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
		prepareRepos();
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
				ageMin: (i % 14) * 1440 + 120,
				toPrMin: 18 + ((i * 7) % 40),
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
			activity: [["Added by you"]],
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
		// Shipped before the Fairway error was first seen, so the floor traces the error to it.
		seedWo({
			project: "fairway",
			title: "Share a round with a link",
			type: "Feature",
			stage: "Observe",
			state: "observing",
			mergedDaysAgo: 5 / 24,
			prNumber: 88,
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

	/** One new-project run per step of the wizard. `done` is how many log lines finished. */
	const seedRun = (
		id: number,
		step: NewProjectRun["step"],
		done: number,
		last: { state: "running" | "failed"; detail?: string } | null,
		over: Partial<NewProjectRun> = {},
	) => {
		const created = [`repo:${OWNER}/caddie`, `folder:${join(clones, "caddie")}`].slice(0, done);
		const run: Omit<NewProjectRun, "id"> = {
			name: "caddie",
			description: "Tracks my clubs and how far each one goes.",
			template: "expo",
			visibility: "private",
			repo: `${OWNER}/caddie`,
			localPath: join(clones, "caddie"),
			step,
			log: SCAFFOLD_STEPS.map((s, i) => {
				if (i < done)
					return { step: s, state: "done" as const, at: `0:${String(4 + i * 17).padStart(2, "0")}` };
				if (i === done && last) {
					const at = last.state === "failed" ? `0:${String(4 + i * 17).padStart(2, "0")}` : null;
					return { step: s, state: last.state, at, detail: last.detail };
				}
				return { step: s, state: "pending" as const, at: null };
			}),
			failure: last?.state === "failed" ? (last.detail ?? null) : null,
			created,
			services: {},
			serviceTools: {},
			projectSlug: null,
			workOrderId: null,
			...over,
		};
		store.db.prepare("INSERT INTO new_projects (id, json) VALUES (?, ?)").run(id, JSON.stringify(run));
	};

	const SCENARIOS: Record<string, () => void> = {
		first_run: () => healthy(),
		/** FRTools: the required tools are ready, one optional tool signed out and one missing. */
		first_run_tools: () => {
			healthy();
			toolFaults = { eas: "signed_out", infisical: "missing" };
		},
		/** FRToolsBlocked: gh is signed out, so first run can't go on. */
		first_run_blocked: () => {
			healthy();
			toolFaults = { gh: "signed_out", sentry: "signed_out", eas: "signed_out", infisical: "missing" };
		},
		first_run_no_t3: () => {
			healthy();
			toolFaults = { t3: "missing" };
		},
		/** FRReading: two projects read, one still reading, one with no Sentry project. */
		reading: () => {
			seedProject({ slug: "foundry", name: "Foundry" });
			seedProject({ slug: "fairway", name: "Fairway", noSentry: true });
			seedProject({ slug: "gather", name: "Gather" });
			store.db.prepare("UPDATE projects SET read_at = NULL WHERE slug = 'gather'").run();
			seedPr("foundry", 168, "Add invoice export", {});
			seedPr("foundry", 165, "Sync toolkit standards", {});
			seedPr("fairway", 94, "Course search empty state", {});
			seedPr("fairway", 96, "Fix the handicap rounding", {});
			kvSet(store.db, "skipped_repos", 2);
		},
		/** Settings > Tools with a signed-out tool and a missing one. */
		tools_problem: () => {
			full();
			toolFaults = { wrangler: "signed_out", infisical: "missing" };
		},
		/** SettingsNotifyBlocked: macOS refused the last test, and the next one works. */
		notify_failed: () => {
			full();
			kvSet(store.db, "settings:notifications", { ...store.settings().notifications, lastTest: "blocked" });
		},
		notify_missing: () => {
			full();
			toolFaults = { "terminal-notifier": "missing" };
			kvSet(store.db, "settings:notifications", { ...store.settings().notifications, lastTest: "failed" });
		},
		/** SettingsApprovals: one type merging alone, one turned off by a regression, one project that always asks. */
		approvals_regressed: () => {
			full();
			const a = store.settings().approvals;
			kvSet(store.db, "settings:approvals", {
				...a,
				mergeWithoutMe: { ...a.mergeWithoutMe, "Toolkit sync": true },
				turnedOffByRegression: { ...a.turnedOffByRegression, "Bug fix": true },
			});
			store.db.prepare("UPDATE projects SET merging = 'ask' WHERE slug = 'labs'").run();
		},
		/** The New project wizard: each id is a run stopped at one of its steps. */
		new_project_runs: () => {
			full();
			seedProject({ slug: "caddie", name: "caddie", noSentry: true });
			const tools = {
				sentry: { installed: true, fix: null },
				eas: { installed: true, fix: null },
				infisical: { installed: false, fix: "brew install infisical" },
			};
			seedRun(1, "approve", 0, null);
			seedRun(2, "failed", 2, { state: "failed", detail: "pnpm install failed: registry timeout" });
			seedRun(
				3,
				"baseline",
				3,
				{ state: "failed", detail: "Tests failed: 1 of 3\nexpected 200, got 500" },
				{ projectSlug: "caddie" },
			);
			seedRun(4, "connect", 5, null, {
				projectSlug: "caddie",
				services: { sentry: "open", eas: "open", infisical: "skipped" },
				serviceTools: tools,
			});
			seedRun(5, "connect", 5, null, {
				projectSlug: "caddie",
				services: { sentry: "connected", eas: "connected", infisical: "skipped" },
				serviceTools: tools,
			});
			seedRun(6, "scaffold", 2, { state: "running" });
		},
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
			// The page's own visit recomputes the summary, so a browser needs the away time as well.
			kvSet(store.db, "last_seen", new Date(store.now().getTime() - 16 * HOUR).toISOString());
		},
		first_look: () => {
			baseProjects();
			healthy();
			seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')");
			seedPr("satisfactory", 12, "Sync toolkit standards", {});
			kvSet(store.db, "visit_state", { back: null, firstLook: true });
			kvSet(store.db, "visit_flags", { firstLookPending: true });
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
			seedWo({
				project: "foundry",
				title: "Weekly summary",
				type: "Feature",
				stage: "Build",
				state: "building",
				ageMin: 3,
				output: ["Reading the summary query."],
			});
			kvSet(store.db, "settings:agents", {
				agentsAtOnce: 3,
				pauseOnReview: false,
				retries: 1,
				agent: "claude",
			});
		},
		review_hold: () => {
			full();
			seedWo({
				project: "fairway",
				title: "Course search empty state",
				stage: "Review",
				state: "ready",
				ageMin: 180,
				prNumber: 94,
				gates: { Typecheck: "passed", Tests: "passed", Lint: "passed", Preview: "failed" },
			});
			seedPr("fairway", 94, "Course search empty state", { checks: FAIL });
			seedWo({
				project: "gather",
				title: "Export your data as JSON",
				type: "Feature",
				stage: "Review",
				state: "ready",
				ageMin: 18 * 24 * 60,
				prNumber: 240,
				gates: noGates("out_of_date"),
			});
			seedPr("gather", 240, "Export your data as JSON", {
				mergeable: "CONFLICTING",
				mergeState: "DIRTY",
				ageDays: 18,
			});
			kvSet(store.db, "settings:agents", {
				agentsAtOnce: 3,
				pauseOnReview: true,
				retries: 1,
				agent: "claude",
			});
		},
		loading: () => {
			baseProjects();
			// Nothing is known before the first read, including the toolkit, which would otherwise be a row.
			store.db
				.prepare("UPDATE projects SET read_at = NULL, toolkit = ?")
				.run(JSON.stringify({ status: "unknown", behindDays: 0, changed: 0 }));
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
			seedWo({
				project: "gather",
				title: "Task sync retries twice",
				stage: "Build",
				state: "build_done",
				ageMin: 14,
				activity: [
					["Wrote a failing test"],
					["Edited src/tasks/sync.ts"],
					["Stopped before running the gates"],
				],
			});
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
		/** Every Projects board at once: four behind, one folder gone, one quiet, and the toolkit's own repo. */
		projects: () => {
			full();
			seedProject({
				slug: "developer-tools",
				name: "developer-tools",
				noSentry: true,
				toolkit: { status: "source" },
			});
			for (const [slug, behindDays, changed] of [
				["arcade-club", 4, 3],
				["labs", 41, 12],
				["satisfactory", 69, 14],
				["roadmaps", 69, 14],
			] as const) {
				store.db
					.prepare("UPDATE projects SET toolkit = ? WHERE slug = ?")
					.run(JSON.stringify({ status: "behind", behindDays, changed }), slug);
			}
			store.db
				.prepare("UPDATE projects SET local_path = ? WHERE slug = 'labs'")
				.run(join(demoFolders, "labs"));
			for (const slug of ["labs", "roadmaps", "satisfactory"]) {
				store.db.prepare("DELETE FROM prs WHERE project = ?").run(slug);
				store.db.prepare("DELETE FROM work_orders WHERE project = ?").run(slug);
			}
			// The window before this one, so Median to PR has something to compare with.
			for (let i = 0; i < 6; i += 1) {
				seedWo({
					project: "fairway",
					title: `Older change ${i + 1}`,
					stage: "Observe",
					state: "done",
					mergedDaysAgo: 15 + i,
					ageMin: (15 + i) * 1440 + 120,
					toPrMin: 40 + i * 6,
					prNumber: 60 + i,
					gates: noGates("passed"),
					activity: [["Shipped"]],
				});
			}
		},
		/** ProjectLong: a long name, repo, folder, and branch, on a project with long open work. */
		project_long: () => {
			baseProjects();
			healthy();
			const repo = "fairway-scorecards-for-weekend-golf-societies-and-long-tournaments";
			const folder = join(demoFolders, "clients-and-side-projects", "2026", repo);
			mkdirSync(folder, { recursive: true });
			store.db
				.prepare(
					"UPDATE projects SET name = ?, repo = ?, url = ?, local_path = ?, default_branch = ? WHERE slug = 'fairway'",
				)
				.run(
					"Fairway Scorecards for Weekend Golf Societies and Long Tournaments",
					`${OWNER}/${repo}`,
					`https://github.com/${OWNER}/${repo}`,
					folder,
					"release/2026-11-spring-season-scorecard-migration",
				);
			seedWo({
				project: "fairway",
				title:
					"Fix TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round",
				stage: "Plan",
				state: "plan_ready",
				plan: PLAN,
			});
			seedPr(
				"fairway",
				94,
				"Show a helpful empty state with a clear-search action when a course search finds nothing in the selected region or season",
				{ checks: FAIL },
			);
		},
		/** HealthEarly: three finished work orders, seven short of showing numbers. */
		few_runs: () => {
			baseProjects();
			healthy();
			for (let i = 0; i < 3; i += 1) {
				seedWo({
					project: "fairway",
					title: `Shipped change ${i + 1}`,
					stage: "Observe",
					state: "done",
					mergedDaysAgo: i,
					prNumber: 100 + i,
					gates: noGates("passed"),
					activity: [["Shipped"]],
				});
			}
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
			seedWo({
				project: "foundry",
				title: "Sync toolkit standards",
				type: "Toolkit sync",
				stage: "Review",
				state: "ready",
				ageMin: 60,
				prNumber: 168,
				gates: noGates("passed"),
			});
			seedPr("foundry", 168, "Sync toolkit standards", { additions: 214, deletions: 98 });
			seedPr("arcade-club", 62, "Sync toolkit standards", { additions: 96, deletions: 41 });
			// Merging this one fails, for the partly done state.
			seedPr("satisfactory", 31, "Sync toolkit standards", { additions: 302, deletions: 117 });
			// No preview in this project, which doesn't block merging by hand.
			seedPr("roadmaps", 12, "Sync toolkit standards", {
				additions: 188,
				deletions: 64,
				checks: [check("check", "pass")],
			});
		},
		/** The Errors list board: new, regression, and snoozed across two projects. */
		errors_list: () => {
			baseProjects();
			healthy();
			seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')");
			const fix = seedWo({
				project: "fairway",
				title: "Retry the course list",
				stage: "Observe",
				state: "done",
				mergedDaysAgo: 6,
				prNumber: 88,
				regressed: true,
				gates: noGates("passed"),
				fingerprint: "error:6002",
			});
			seedError("fairway", "6002", "NetworkError fetching course list", {
				kind: "regression",
				events: 12,
				users: 5,
				regressionOf: {
					workOrderId: fix,
					prNumber: 88,
					fixedAt: new Date(store.now().getTime() - 6 * DAY).toISOString(),
				},
			});
			seedError("gather", "6003", "Task sync timed out", {
				kind: "ongoing",
				events: 6,
				users: 2,
				firstSeen: new Date(store.now().getTime() - 2 * DAY).toISOString(),
			});
			store.db
				.prepare(
					"INSERT INTO triage (fingerprint, action, until, baseline_events, baseline_users, baseline_release, at) VALUES (?, 'snooze', ?, 6, 2, '1.4.2', ?)",
				)
				.run("error:6003", snoozeUntil(store.now()).toISOString(), store.iso());
		},
		/** The agent asked something with no options to pick from. */
		open_question: () => {
			baseProjects();
			healthy();
			seedWo({
				project: "foundry",
				title: "Name the new export",
				stage: "Build",
				state: "question",
				thread: "demo:open-question",
				question: { question: "What should the export be called?", options: [] },
			});
		},
		/** One work order per state the other scenarios don't reach. */
		wo_states: () => {
			baseProjects();
			healthy();
			// Exactly full, so the slot-waiting and Intake rows stay where they are.
			kvSet(store.db, "settings:agents", {
				agentsAtOnce: 5,
				pauseOnReview: false,
				retries: 1,
				agent: "claude",
			});
			seedWo({
				project: "fairway",
				title: "Agent waiting in T3",
				stage: "Build",
				state: "waiting_in_t3",
				thread: "demo:waiting",
				activity: [["Plan approved by you"], ["The agent is waiting in T3"]],
			});
			seedWo({
				project: "foundry",
				title: "Run that T3 couldn't start",
				stage: "Build",
				state: "run_failed",
				failure: "t3 thread start: exit 2\nworktree already exists: factory/wo-demo",
				activity: [["Plan approved by you"], ["The run failed", "t3 thread start: exit 2"]],
			});
			seedWo({
				project: "gather",
				title: "Run with no thread",
				stage: "Plan",
				state: "run_failed",
				thread: null,
				failure: "t3: command not found",
				activity: [["The run failed", "t3: command not found"]],
			});
			seedWo({
				project: "arcade-club",
				title: "Stopping at the next step",
				stage: "Build",
				state: "building",
				hold: true,
				output: ["Reading the leaderboard query."],
				activity: [["Plan approved by you"], ["You stopped this work order"]],
			});
			seedWo({
				project: "arcade-club",
				title: "Stopped and held",
				stage: "Build",
				state: "build_done",
				hold: true,
				activity: [["Plan approved by you"], ["You stopped this work order"]],
			});
			seedWo({
				project: "roadmaps",
				title: "Write the first plan",
				type: "Feature",
				stage: "Plan",
				state: "planning",
				output: ["Reading the roadmap."],
				activity: [["Added by you"]],
			});
			seedWo({
				project: "roadmaps",
				title: "Rewrite the plan",
				stage: "Plan",
				state: "planning",
				plan: PLAN,
				output: ["Rereading the loader."],
				activity: [["Wrote the plan"], ["You asked for changes to the plan", "Clear the old entries."]],
			});
			seedWo({
				project: "satisfactory",
				title: "Approved, waiting for a slot",
				stage: "Plan",
				state: "plan_approved",
				plan: PLAN,
				activity: [["Plan approved by you"]],
			});
			seedWo({
				project: "satisfactory",
				title: "Fix the failed gate",
				stage: "Verify",
				state: "retrying",
				prNumber: 12,
				retries: 1,
				firstTry: false,
				gates: { Typecheck: "passed", Tests: "failed", Lint: "passed", Preview: "passed" },
				output: ["Running the tests again."],
				activity: [["Tests failed"], ["You retried with a note", "Use finishedAt."]],
			});
			seedWo({
				project: "labs",
				title: "Rebase on main",
				stage: "Review",
				state: "rebasing",
				prNumber: 7,
				gates: noGates("out_of_date"),
				output: ["Resolving the conflict in the router."],
				activity: [["Started the rebase"]],
			});
			seedWo({
				project: "labs",
				title: "Waits in Intake",
				type: "Feature",
				stage: "Intake",
				state: "waiting",
				activity: [["Added by you"]],
			});
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
		// The same projects with a row needing you, so the Later rows open a pane and a sync can be blocked.
		missing_folder_queue: () => {
			SCENARIOS.missing_folder?.();
			seedError("fairway", "6001", "TypeError: Cannot read properties of undefined (reading 'holes')");
		},
	};

	return {
		cli: (async (cmd, args, opts) => {
			const fault = toolFaults[cmd];
			const answer = { stdout: "", stderr: "", timedOut: false };
			if (fault === "missing") return { ...answer, code: 127, missing: true };
			if (fault === "signed_out" && (args.includes("auth") || args[0] === "whoami")) {
				return { ...answer, code: 1, missing: false };
			}
			if (cmd === "gh" && args[0] === "api" && args[1] === "graphql") {
				// A read finds nothing new, and keeps the seeded PRs. It still marks a just-added project as read.
				store.db.prepare("UPDATE projects SET read_at = ? WHERE read_at IS NULL").run(store.iso());
				return { ...answer, code: 0, stdout: '{"data":{}}', missing: false };
			}
			if (cmd === "gh" && args.join(" ").startsWith(`pr merge 31 -R ${OWNER}/satisfactory --squash`)) {
				// The base moved while it waited: it stays open and needs a rebase.
				store.db
					.prepare(
						"UPDATE prs SET json = json_set(json, '$.mergeState', 'BEHIND', '$.group', 'rebase') WHERE project = 'satisfactory' AND number = 31",
					)
					.run();
				return {
					code: 1,
					stdout: "",
					stderr: "Pull request is behind the base branch",
					timedOut: false,
					missing: false,
				};
			}
			return demoCli(cmd, args, opts);
		}) as Cli,
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
