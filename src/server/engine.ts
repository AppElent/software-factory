import { execFile } from "node:child_process";
import { z } from "zod";
import {
	agentHoldsMerge,
	allFourPassed,
	anyGate,
	branchIsntOurs,
	failedGate,
	gatesClear,
	gatesPassed,
	gateValues,
	MODE_NEEDS,
	mayMergeAlone,
	mergeBlockers,
	NO_CHECKS_MS,
	noGates,
	ownerOnlyFiles,
	ownsNoPr,
	parseReply,
	slugify,
	startBlock,
	verifyHasRoom,
} from "../shared/rules.ts";
import type {
	AgentQuestion,
	GateName,
	Limits,
	Mode,
	Plan,
	Project,
	PullRequest,
	StartBlock,
	WorkOrder,
	WorkOrderSource,
	WorkType,
} from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { scrub } from "./cli.ts";
import { NeverTouchError } from "./config.ts";
import {
	closePr,
	failedLog,
	MOST_FILES_GITHUB_LISTS,
	mergePr,
	PR_UNREADABLE,
	prByBranch,
	prState,
	tryReadPrPaths,
} from "./connectors/github.ts";
import { audit, kvGet, kvSet } from "./db.ts";
import type { Executor, ThreadState } from "./executor/types.ts";
import { ExecutorError } from "./executor/types.ts";
import {
	answerPrompt,
	buildPrompt,
	changePlanPrompt,
	planPrompt,
	prChangesPrompt,
	rebasePrompt,
	requestChangesPrompt,
	retryPrompt,
	syncPrompt,
} from "./playbooks/index.ts";
import type { Store, WorkOrderPatch } from "./store.ts";

const PlanShape = z.object({
	summary: z.string(),
	steps: z.array(z.string()).default([]),
	files: z.string().optional(),
	risk: z.string().optional(),
	estimate: z.string().optional(),
	outOfScope: z.string().optional(),
});

const QuestionShape = z.object({
	question: z.string(),
	detail: z.string().optional(),
	options: z
		.array(z.object({ label: z.string(), detail: z.string().optional(), stop: z.boolean().optional() }))
		.default([]),
});

/** A push from the agent has this long to show up before the factory stops waiting for new gates. */
const PUSH_WAIT_MS = 10 * 60_000;
/** Main's CI on the merge commit takes a moment to show up. Until then, main's state is about the commit before. */
const SHIP_MIN_MS = 2 * 60_000;
const SHIP_MAX_MS = 30 * 60_000;
/** Gates this old may no longer be true. GitHub reads run every minute or so when anything's in review. */
const READ_MAX_AGE_MS = 15 * 60_000;
export const OBSERVE_MS = 24 * 3_600_000;

export class ActionError extends Error {
	readonly status: number;
	constructor(message: string, status = 409) {
		super(message);
		this.status = status;
	}
}

export interface EngineDeps {
	store: Store;
	cli: Cli;
	executor: Executor;
	/** Tells the page which queries changed. */
	publish: (keys: string[]) => void;
	/** Asks for a GitHub read soon. */
	pollSoon: () => void;
	git?: GitRunner;
	/** This app's own repo, where more files wait for you. */
	selfRepo?: string | null;
	/** Events the queue can't show, for notifications. */
	onEvent?: (event: EngineEvent) => void;
}

export type EngineEvent =
	| { kind: "merged_alone"; workOrder: WorkOrder; prTitle: string }
	| { kind: "shipped"; workOrder: WorkOrder }
	| { kind: "slots_full"; agents: number; waiting: number };

const nextBranch = (branch: string) => {
	const tried = /^(.*)-try(\d+)$/.exec(branch);
	return tried ? `${tried[1]}-try${Number(tried[2]) + 1}` : `${branch}-try2`;
};

export type GitRunner = (cwd: string, args: string[]) => Promise<{ ok: boolean; error: string }>;

const realGit: GitRunner = (cwd, args) =>
	new Promise((resolve) => {
		execFile("git", args, { cwd, timeout: 60_000 }, (err, _stdout, stderr) => {
			resolve({ ok: !err, error: err ? scrub(String(stderr).trim() || err.message) : "" });
		});
	});

/** Something already gone is what the step wanted, so it isn't a failure. */
const ALREADY_GONE = /is not a working tree|branch '.*' not found|remote ref does not exist/i;

export class Engine {
	private readonly store: Store;
	private readonly cli: Cli;
	private readonly executor: Executor;
	private readonly publish: (keys: string[]) => void;
	private readonly pollSoon: () => void;
	private readonly git: GitRunner;
	private readonly selfRepo: string | null;
	private readonly onEvent: (event: EngineEvent) => void;
	private ticking = false;
	private tickAgain = false;
	/** The tail of each work order's line of steps. See `locked`. */
	private readonly locks = new Map<number, Promise<unknown>>();

	constructor(deps: EngineDeps) {
		this.store = deps.store;
		this.cli = deps.cli;
		this.executor = deps.executor;
		this.publish = deps.publish;
		this.pollSoon = deps.pollSoon;
		this.git = deps.git ?? realGit;
		this.selfRepo = deps.selfRepo ?? null;
		this.onEvent = deps.onEvent ?? (() => {});
	}

	limits(): Limits {
		const open = this.store.workOrders();
		const { agents } = this.store.settings();
		const build = open.filter((w) => w.stage === "Build").length;
		const verify = open.filter((w) => w.stage === "Verify").length;
		const review = open.filter((w) => w.stage === "Review").length;
		return {
			agents: agents.agentsAtOnce,
			build,
			verify,
			review,
			pauseOnReview: agents.pauseOnReview,
			startBlock: this.block(build, review),
		};
	}

	private block(build: number, review: number): StartBlock {
		const { agents } = this.store.settings();
		return startBlock({
			stopped: this.store.line().stopped,
			agents: agents.agentsAtOnce,
			build,
			review,
			pauseOnReview: agents.pauseOnReview,
		});
	}

	/* ---------- the loop ---------- */

	/**
	 * Runs one step on a work order, after any step already running on it. The CLIs take seconds, and
	 * without this a Close during `t3 thread start` gets overwritten when the start returns. Every step reads
	 * the work order inside the lock. Never call `tick` from inside: it would wait for this same lock.
	 */
	private locked<T>(id: number, step: () => Promise<T>): Promise<T> {
		const run = (this.locks.get(id) ?? Promise.resolve()).then(step, step);
		const tail = run.catch(() => {});
		this.locks.set(id, tail);
		void tail.then(() => {
			if (this.locks.get(id) === tail) this.locks.delete(id);
		});
		return run;
	}

	/** One work order's bad step stays with it. The rest of the floor keeps moving. */
	private logStep(id: number) {
		return (e: unknown) => {
			console.error(`WO-${id}: step failed: ${scrub(e instanceof Error ? e.message : String(e))}`);
		};
	}

	/** Moves every open work order as far as it can go. One at a time, so a slot can't be given out twice. */
	async tick(): Promise<void> {
		if (this.ticking) {
			this.tickAgain = true;
			return;
		}
		this.ticking = true;
		try {
			do {
				this.tickAgain = false;
				for (const { id } of this.store.workOrders()) {
					await this.locked(id, async () => {
						const wo = this.store.workOrder(id);
						if (wo) await this.advance(wo);
					}).catch(this.logStep(id));
				}
				await this.startWaiting();
			} while (this.tickAgain);
		} catch (e) {
			// A broken rules file stops the factory on purpose, and every page already says so.
			if (!(e instanceof NeverTouchError)) throw e;
		} finally {
			this.ticking = false;
		}
	}

	private patch(id: number, patch: Partial<WorkOrderPatch>) {
		this.store.patchWorkOrder(id, { state_at: this.store.iso(), ...patch });
		this.publish(["work-orders", `work-order:${id}`, "queue", "floor", "shell"]);
	}

	private async startWaiting() {
		for (const { id } of this.store.workOrders("state IN ('waiting', 'plan_approved')")) {
			const full = await this.locked(id, () => this.startOne(id)).catch((e) => {
				this.logStep(id)(e);
				return false;
			});
			if (full) return;
		}
	}

	/** Returns true when no more can start this pass. */
	private async startOne(id: number): Promise<boolean> {
		const wo = this.store.workOrder(id);
		if (!wo || (wo.state !== "waiting" && wo.state !== "plan_approved")) return false;
		if (this.store.line().stopped) {
			if (!wo.heldByLine) this.store.patchWorkOrder(wo.id, { held_by_line: 1 });
			return false;
		}
		if (wo.heldByLine) this.store.patchWorkOrder(wo.id, { held_by_line: 0 });
		if (wo.hold) return false;
		// The PR it was meant to work on merged or closed while this waited for a slot.
		if (ownsNoPr(wo.source.kind) && wo.prNumber && !this.openPr(wo)) {
			await this.closeOut(id, `PR #${wo.prNumber} is no longer open, so there's nothing to do`);
			return false;
		}
		const project = this.store.project(wo.project);
		if (!project || project.paused || project.folderMissing || !project.localPath) return false;
		const open = this.store.workOrders();
		const build = open.filter((w) => w.stage === "Build").length;
		// Plans are short agent runs. They count here so a long Intake can't start every plan at once.
		const planning = open.filter((w) => w.stage === "Plan" && w.state === "planning").length;
		const review = open.filter((w) => w.stage === "Review").length;
		const block = this.block(build + (wo.state === "waiting" ? planning : 0), review);
		if (block) {
			if (block === "limit") {
				const waiting = open.filter((w) => w.stage === "Intake").length;
				if (waiting)
					this.onEvent({ kind: "slots_full", agents: this.store.settings().agents.agentsAtOnce, waiting });
			}
			return true;
		}
		if (wo.state === "plan_approved") await this.startBuildTurn(wo);
		else await this.startFromIntake(wo, project.localPath, project.defaultBranch);
		return false;
	}

	private async startFromIntake(wo: WorkOrder, localPath: string, base: string) {
		const review = this.store.settings().approvals.planReview[wo.type];
		const wantsPlan = wo.mode?.plan === "always" || (wo.mode?.plan !== "skip" && review === "always");
		const needsPlan = wantsPlan && !ownsNoPr(wo.source.kind) && wo.source.kind !== "toolkit";
		const stage = needsPlan ? "Plan" : "Build";
		const prompt = needsPlan ? planPrompt(wo) : this.directPrompt(wo);
		// T3 can't start on a branch that already exists, so starting over after a lost thread takes a new one.
		const branch = wo.branch ? nextBranch(wo.branch) : `factory/wo-${wo.id}-${slugify(wo.title, 32)}`;
		try {
			this.store.patchWorkOrder(wo.id, { pending_send: prompt });
			// Merges happen on GitHub, so the folder's own branch falls behind. Work starts from what's on origin.
			const fetched = await this.cli("git", ["fetch", "origin", base], {
				cwd: localPath,
				timeoutMs: 60_000,
			});
			if (fetched.code !== 0)
				throw new Error(`Couldn't fetch ${base} from origin. ${fetched.stderr.trim()}`.trim());
			const latest = await this.cli("git", ["rev-parse", "FETCH_HEAD"], { cwd: localPath });
			const { threadId, link } = await this.executor.start({
				projectPath: localPath,
				title: `WO-${wo.id} ${wo.title}`,
				prompt,
				baseBranch: latest.stdout.trim() || base,
				branch,
				agent: this.store.settings().agents.agent,
				provider: wo.mode?.provider,
				model: wo.mode?.model,
			});
			const state = await this.executor.status(threadId).catch(() => null);
			this.store.addActivity(wo.id, "Created worktree and branch");
			// The new branch gets its own PR. The one from the lost thread is yours to merge or close.
			const leftPr = wo.branch && wo.prNumber && !ownsNoPr(wo.source.kind) ? wo.prNumber : null;
			if (leftPr) this.store.addActivity(wo.id, `Started over on a new branch. PR #${leftPr} stays open.`);
			audit(this.store.db, "start agent", `WO-${wo.id}`, "factory", branch, this.store.now());
			this.patch(wo.id, {
				stage,
				state: needsPlan ? "planning" : "building",
				stage_at: this.store.iso(),
				thread_id: threadId,
				thread_link: link,
				branch,
				worktree: state?.worktree ?? null,
				...(leftPr ? { pr_number: null, failed_sha: null } : {}),
			});
		} catch (e) {
			this.runFailed(wo, stage, e);
		}
	}

	private directPrompt(wo: WorkOrder) {
		if (wo.source.kind === "rebase_pr" && wo.prNumber) return rebasePrompt(wo.prNumber);
		if (wo.source.kind === "pr_changes" && wo.prNumber) return prChangesPrompt(wo.prNumber, wo.description);
		if (wo.source.kind === "toolkit") return syncPrompt();
		return buildPrompt(wo);
	}

	private runFailed(wo: WorkOrder, stage: WorkOrder["stage"], e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		this.store.addActivity(wo.id, "T3 couldn't start this run", message);
		const gone = e instanceof ExecutorError && e.gone;
		this.patch(wo.id, {
			stage: gone ? "Intake" : stage,
			state: "run_failed",
			failure: message,
			...(gone ? { thread_id: null, thread_link: null } : {}),
		});
	}

	/** Every turn goes through here, so Try again can resend exactly what failed. */
	private async sendTurn(id: number, threadId: string, prompt: string) {
		this.store.patchWorkOrder(id, { pending_send: prompt });
		await this.executor.send(threadId, prompt);
	}

	private lastPrompt(id: number) {
		return (
			this.store.db.prepare("SELECT pending_send FROM work_orders WHERE id = ?").get(id) as {
				pending_send: string | null;
			}
		).pending_send;
	}

	private async startBuildTurn(wo: WorkOrder) {
		if (!wo.threadId) return;
		try {
			await this.sendTurn(wo.id, wo.threadId, buildPrompt(wo));
			this.patch(wo.id, { stage: "Build", state: "building", stage_at: this.store.iso() });
		} catch (e) {
			this.runFailed(wo, "Build", e);
		}
	}

	private async advance(wo: WorkOrder) {
		switch (wo.state) {
			case "planning":
			case "building":
			case "retrying":
			case "rebasing":
			case "waiting_in_t3":
				return this.watchTurn(wo);
			case "build_done":
				return this.moveToVerify(wo);
			case "verifying":
				return this.verify(wo);
			case "ready":
				return this.review(wo);
			case "shipping":
				return this.ship(wo);
			case "observing":
				return this.observe(wo);
			case "failed":
			case "run_failed":
			case "question":
				// Waiting on you, but the PR can still be merged or closed on GitHub.
				if (wo.prNumber && !this.openPr(wo)) await this.prLeft(wo);
				return;
			default:
				return;
		}
	}

	private async watchTurn(wo: WorkOrder) {
		if (!wo.threadId) return;
		let state: ThreadState;
		try {
			state = await this.executor.status(wo.threadId);
			this.setT3Health(true, null);
		} catch (e) {
			if (e instanceof ExecutorError && e.gone) {
				// T3 is fine. This one thread is gone, so nothing will ever finish this turn.
				this.setT3Health(true, null);
				this.runFailed(wo, wo.stage, e);
				return;
			}
			this.setT3Health(false, e instanceof Error ? e.message : String(e));
			return;
		}
		const output = JSON.stringify(state.recent.map(stripBlocks));
		if (state.worktree && state.worktree !== wo.worktree)
			this.store.patchWorkOrder(wo.id, { worktree: state.worktree });
		if (JSON.stringify(wo.output) !== output) {
			this.store.patchWorkOrder(wo.id, { output });
			this.publish([`work-order:${wo.id}`]);
		}
		if (state.status === "waiting_native") {
			if (wo.state !== "waiting_in_t3") {
				this.store.addActivity(wo.id, "The agent is waiting in T3");
				this.patch(wo.id, { state: "waiting_in_t3" });
			}
			return;
		}
		if (wo.state === "waiting_in_t3" && (state.status === "running" || state.status === "queued")) {
			this.patch(wo.id, {
				state: wo.stage === "Plan" ? "planning" : wo.stage === "Verify" ? "retrying" : "building",
			});
			return;
		}
		if (state.status === "failed") {
			const message = state.error ?? "The run failed.";
			this.store.addActivity(wo.id, "The run failed", message);
			this.patch(wo.id, { state: "run_failed", failure: message });
			return;
		}
		if (state.status !== "completed") return;
		await this.turnFinished(wo, state.lastReply ?? "");
	}

	private async turnFinished(wo: WorkOrder, reply: string) {
		const parsed = parseReply(reply);
		const question = QuestionShape.safeParse(parsed.question);
		if (question.success) {
			this.store.addActivity(wo.id, "Asked a question");
			this.patch(wo.id, {
				state: "question",
				question: JSON.stringify(question.data satisfies AgentQuestion),
			});
			return;
		}
		if (wo.stage === "Plan") {
			const shaped = PlanShape.safeParse(parsed.plan);
			const plan: Plan = shaped.success ? shaped.data : { summary: parsed.text || reply, steps: [] };
			this.store.addActivity(wo.id, "Wrote the plan");
			this.patch(wo.id, { state: "plan_ready", plan: JSON.stringify(plan) });
			return;
		}
		if (wo.stage === "Build") {
			const project = this.store.project(wo.project);
			// A picked-up run is as old as its thread, not as the moment it was picked up. On a factory branch, an open
			// PR is its PR, however old. Any other branch T3 reports could be anything, even `main`.
			const openOnly = wo.source.kind === "restored" && !branchIsntOurs(wo);
			// Until GitHub has been read, the default branch is a guess, and so is whether this is it.
			if (!wo.prNumber && branchIsntOurs(wo) && !project?.readAt) return;
			const number =
				wo.prNumber ??
				(project && wo.branch && wo.branch !== project.defaultBranch
					? await prByBranch(this.cli, project.repo, wo.branch, wo.createdAt, { openOnly })
					: null);
			// GitHub didn't answer, which says nothing about the agent. The next pass asks again.
			if (number === PR_UNREADABLE) return;
			if (!number) {
				const message = "The agent finished without opening a PR.";
				this.store.addActivity(wo.id, message, parsed.text || null);
				this.patch(wo.id, { state: "run_failed", failure: message });
				return;
			}
			if (!wo.prNumber) this.store.addActivity(wo.id, `Opened PR #${number}`);
			this.store.patchWorkOrder(wo.id, { pr_number: number, pr_opened_at: this.store.iso() });
			this.pollSoon();
			await this.moveToVerify({ ...wo, prNumber: number });
			return;
		}
		// A retry or a change request finished. Its push starts new gates.
		this.pollSoon();
		this.patch(wo.id, { state: "verifying" });
	}

	private async moveToVerify(wo: WorkOrder) {
		const limits = this.limits();
		if (!verifyHasRoom(limits) || this.store.line().stopped || wo.hold) {
			const held = this.store.line().stopped;
			if (wo.state !== "build_done") {
				if (held) this.store.addActivity(wo.id, "Stopped before running the gates");
				this.patch(wo.id, { state: "build_done", held_by_line: held ? 1 : 0 });
			}
			return;
		}
		this.patch(wo.id, { stage: "Verify", state: "verifying", stage_at: this.store.iso(), held_by_line: 0 });
	}

	private openPr(wo: WorkOrder): PullRequest | null {
		return wo.prNumber ? this.store.pr(wo.project, wo.prNumber) : null;
	}

	/** The PR left the open list. Find out why. Returns true when the work order moved. */
	private async prLeft(wo: WorkOrder): Promise<boolean> {
		const project = this.store.project(wo.project);
		if (!project || !wo.prNumber) return false;
		const state = await prState(this.cli, project.repo, wo.prNumber);
		if (state === "MERGED") {
			// Only a mode's own prompt tells an agent anything about merging, and "don't" isn't always what it says.
			this.markMerged(wo, wo.mode?.prompt ? "Merged on GitHub, not by the factory" : "Merged on GitHub");
			return true;
		}
		if (state === "CLOSED") {
			this.store.addActivity(wo.id, `PR #${wo.prNumber} was closed`);
			await this.cleanUp(wo, { merged: false });
			this.patch(wo.id, { state: "closed", finished_at: this.store.iso() });
			return true;
		}
		return false;
	}

	private markMerged(wo: WorkOrder, text: string) {
		const at = this.store.iso();
		this.store.addActivity(wo.id, text);
		// Remembered so a later event can be told apart: the build that had the bug, or the fix failing.
		const fingerprint = wo.source.fingerprint;
		if (fingerprint?.startsWith("error:")) {
			const error = this.store.error(fingerprint.slice(6));
			const release =
				error?.latestRelease ?? this.store.errorDetail(error?.id)?.release ?? error?.firstRelease;
			if (release) kvSet(this.store.db, `fix_release:${wo.id}`, release);
		}
		this.patch(wo.id, { stage: "Ship", state: "shipping", stage_at: at, merged_at: at });
	}

	private async verify(wo: WorkOrder) {
		const pr = this.openPr(wo);
		if (!pr) {
			if (wo.prNumber) await this.prLeft(wo);
			return;
		}
		const gates = JSON.stringify(pr.gates);
		if (gates !== JSON.stringify(wo.gates)) this.store.patchWorkOrder(wo.id, { gates });
		const waitedOnPush = wo.prNumber != null && this.failedSha(wo.id) === pr.headSha;
		if (waitedOnPush) {
			// Gates on this commit are the ones that already failed. Wait for the agent's push to arrive.
			const age = this.store.now().getTime() - Date.parse(this.stateAt(wo.id));
			if (age < PUSH_WAIT_MS) return;
			await this.gateFailed(wo, pr, true);
			return;
		}
		if (anyGate(pr.gates, "failed")) return this.gateFailed(wo, pr, false);
		if (anyGate(pr.gates, "running") || anyGate(pr.gates, "not_started")) return;
		const noChecks = !gatesPassed(pr.gates) && gatesClear(pr.gates);
		// Timed from entering this state: right after a retry's push, GitHub has no checks for the new commit yet.
		if (noChecks && this.store.now().getTime() - Date.parse(this.stateAt(wo.id)) < NO_CHECKS_MS) return;
		const first = wo.retries === 0 && wo.firstTry;
		this.store.addActivity(
			wo.id,
			allFourPassed(pr.gates) && first
				? "All 4 gates passed on the first try"
				: noChecks
					? "No gates set up"
					: "Gates passed",
		);
		this.patch(wo.id, {
			stage: "Review",
			state: "ready",
			stage_at: this.store.iso(),
			failure: null,
			failed_gate: null,
		});
		await this.review({ ...wo, gates: pr.gates, stage: "Review", state: "ready" });
	}

	private failedSha(id: number) {
		return (
			this.store.db.prepare("SELECT failed_sha FROM work_orders WHERE id = ?").get(id) as {
				failed_sha: string | null;
			}
		).failed_sha;
	}

	private stateAt(id: number) {
		const row = this.store.db
			.prepare("SELECT state_at, updated_at FROM work_orders WHERE id = ?")
			.get(id) as {
			state_at: string | null;
			updated_at: string;
		};
		return row.state_at ?? row.updated_at;
	}

	private async gateFailed(wo: WorkOrder, pr: PullRequest, samePush: boolean) {
		const held = () => this.store.line().stopped || Boolean(this.store.workOrder(wo.id)?.hold);
		if (held()) {
			if (!wo.heldByLine)
				this.store.patchWorkOrder(wo.id, { held_by_line: this.store.line().stopped ? 1 : 0 });
			return;
		}
		// One CI job can stand for several gates, and then its failure doesn't say which of them it was.
		const gate =
			gateValues(pr.gates).filter((g) => g === "failed").length === 1 ? failedGate(pr.gates) : null;
		const project = this.store.project(wo.project);
		const check = pr.checks.find((c) => c.bucket === "fail");
		const label = gate ?? check?.name ?? "A gate";
		const log = project && check ? await failedLog(this.cli, project.repo, check.url) : null;
		if (held()) return;
		const text = log ?? (samePush ? "The agent's retry pushed no new commit." : `${label} failed.`);
		const { retries } = this.store.settings().agents;
		if (wo.retries < retries && wo.threadId && !samePush) {
			this.store.addActivity(wo.id, `${label} failed`, text);
			this.patch(wo.id, {
				state: "retrying",
				retries: wo.retries + 1,
				first_try: 0,
				failed_gate: gate,
				failed_sha: pr.headSha,
			});
			try {
				await this.sendTurn(wo.id, wo.threadId, retryPrompt(gate, text, null));
			} catch (e) {
				this.runFailed(wo, "Verify", e);
			}
			return;
		}
		this.store.addActivity(wo.id, `${label} failed after retries`, text);
		this.patch(wo.id, { state: "failed", failed_gate: gate, failure: text, first_try: 0 });
	}

	private async review(wo: WorkOrder) {
		const pr = this.openPr(wo);
		if (!pr) {
			await this.prLeft(wo);
			return;
		}
		const gates = JSON.stringify(pr.gates);
		if (gates !== JSON.stringify(wo.gates)) this.store.patchWorkOrder(wo.id, { gates });
		// A push or a re-run after the gates passed. What passed is no longer what's on the PR.
		const failed = anyGate(pr.gates, "failed");
		if (failed || anyGate(pr.gates, "running") || anyGate(pr.gates, "not_started")) {
			this.store.addActivity(
				wo.id,
				failed ? "A gate failed during review" : "New gates started during review",
			);
			this.patch(wo.id, { stage: "Verify", state: "verifying", stage_at: this.store.iso() });
			return;
		}
		const project = this.store.project(wo.project);
		if (project && wo.mode?.merge === "factory") this.sayWhyModeWaits(wo, pr, project);
		if (!project || !this.mergeAllowed(wo, pr)) return;
		// GitHub said no to this commit. Asking again every pass won't change that; a new commit might.
		const refusedKey = `merge_refused:${wo.id}`;
		if (kvGet<string>(this.store.db, refusedKey) === pr.headSha) return;
		// Both settings decide who merges, and neither gets to skip this. The list is read for this commit.
		const paths = await tryReadPrPaths(this.cli, project.repo, pr.number);
		// Not knowing what it changes is a reason to wait. The next pass reads it again.
		if (paths === null) return;
		// That took a moment. You can have pressed Stop, a gate can have failed, or a new commit can have come in.
		const current = this.store.workOrder(wo.id);
		const latest = this.store.prs(wo.project).find((p) => p.number === pr.number);
		if (
			!current ||
			current.state !== wo.state ||
			latest?.headSha !== pr.headSha ||
			!this.mergeAllowed(current, latest)
		)
			return;
		if (paths.length >= MOST_FILES_GITHUB_LISTS) {
			kvSet(this.store.db, refusedKey, pr.headSha);
			this.store.addActivity(wo.id, "This changes too many files to check, so it waits for you");
			this.publish([`work-order:${wo.id}`]);
			return;
		}
		const held = ownerOnlyFiles(paths, project.repo.toLowerCase() === this.selfRepo?.toLowerCase());
		if (held.length > 0) {
			kvSet(this.store.db, refusedKey, pr.headSha);
			this.store.addActivity(wo.id, "This changes files that always wait for you", held.join("\n"));
			this.publish([`work-order:${wo.id}`]);
			return;
		}
		const res = await mergePr(this.cli, project.repo, pr.number, pr.headSha);
		audit(
			this.store.db,
			"merge PR",
			`${project.repo}#${pr.number}`,
			wo.mode?.merge === "factory" ? `factory (${wo.mode.name})` : "factory",
			res.reason || null,
			this.store.now(),
		);
		if (res.ok) {
			this.markMerged(wo, wo.mode?.merge === "factory" ? `Merged by ${wo.mode.name}` : "Merged without you");
			this.onEvent({ kind: "merged_alone", workOrder: wo, prTitle: pr.title });
		} else {
			kvSet(this.store.db, refusedKey, pr.headSha);
			this.store.addActivity(wo.id, "GitHub refused to merge this without you", res.reason || null);
			this.publish([`work-order:${wo.id}`]);
		}
		this.pollSoon();
	}

	/** An issue that left the list can't be vouched for any more, so it counts the same as one that changed. */
	private issueHolds(wo: WorkOrder) {
		if (wo.source.kind !== "issue") return false;
		const issue = wo.source.issueNumber ? this.store.issue(wo.project, wo.source.issueNumber) : undefined;
		return !issue || issue.locked;
	}

	/** Every reason the factory may not merge this, read fresh, so it can be asked again after waiting on GitHub. */
	private mergeAllowed(wo: WorkOrder, pr: PullRequest) {
		const project = this.store.project(wo.project);
		const byMode = wo.mode?.merge === "factory";
		if (
			!project ||
			project.paused ||
			pr.group === "stale" ||
			// Not false also covers a row saved before this was read. The next read fills it in.
			pr.fromFork !== false ||
			// Another work order can be busy on this PR, such as a rebase.
			pr.heldBy ||
			this.staleRead(project) ||
			this.store.line().stopped ||
			// A config file that can't be read can't say what you wanted.
			this.store.file.error()
		)
			return false;
		return mayMergeAlone({
			on: this.store.settings().approvals.mergeWithoutMe[wo.type] || byMode,
			byMode,
			projectMerging: project.merging,
			gates: pr.gates,
			mergeable: pr.mergeable,
			mergeState: pr.mergeState,
			isDraft: pr.isDraft,
			hold: wo.hold,
			sourceKind: wo.source.kind,
			unreadIssue: this.issueHolds(wo),
		});
	}

	/** A run you chose to send can stop at Review for reasons of its own. Says so once, so it doesn't look stuck. */
	private sayWhyModeWaits(wo: WorkOrder, pr: PullRequest, project: Project) {
		const missing = MODE_NEEDS.filter((n) => pr.gates[n] !== "passed");
		const reason = this.store.file.error()
			? "The config file can't be read, so fix it first."
			: project.merging === "ask"
				? `${project.name} is set to ask you before merging.`
				: this.issueHolds(wo)
					? this.store.issue(wo.project, wo.source.issueNumber ?? 0)
						? `#${wo.source.issueNumber} changed since you read it, so read it again or merge this yourself.`
						: `#${wo.source.issueNumber} isn't in the open issues any more, so merge this yourself.`
					: !gatesClear(pr.gates)
						? null
						: missing.length === 0
							? ["CLEAN", "UNKNOWN"].includes(pr.mergeState) && pr.mergeable !== "CONFLICTING"
								? null
								: "GitHub won't merge this yet. It goes ahead once GitHub will, or you can merge it yourself."
							: `${missing.join(" and ")} ${missing.length === 1 && missing[0] !== "Tests" ? "isn't" : "aren't"} set up on this project, so a merge is yours to make.`;
		if (!reason) return;
		const key = `mode_waits:${wo.id}`;
		if (kvGet<string>(this.store.db, key) === reason) return;
		kvSet(this.store.db, key, reason);
		this.store.addActivity(wo.id, `${wo.mode?.name} is waiting for you. ${reason}`);
		this.publish([`work-order:${wo.id}`]);
	}

	private async ship(wo: WorkOrder) {
		const main = this.store.main(wo.project);
		const elapsed = this.store.now().getTime() - Date.parse(wo.stageAt);
		if (elapsed < SHIP_MIN_MS) return;
		if (main?.state === "running" && elapsed < SHIP_MAX_MS) return;
		if (main?.state === "red" && elapsed < SHIP_MAX_MS) return;
		this.store.addActivity(wo.id, main?.state === "red" ? "Main is red after shipping" : "Shipped");
		if (main?.state !== "red") this.onEvent({ kind: "shipped", workOrder: wo });
		this.patch(wo.id, { stage: "Observe", state: "observing", stage_at: this.store.iso() });
	}

	private async observe(wo: WorkOrder) {
		if (this.store.now().getTime() - Date.parse(wo.stageAt) < OBSERVE_MS) return;
		const shipped = Date.parse(wo.mergedAt ?? wo.stageAt);
		// The same rule the floor counts by. The errors themselves are in the queue.
		const caused = this.store
			.errors(wo.project)
			.filter((e) => !e.triage && Date.parse(e.firstSeen) >= shipped).length;
		this.store.addActivity(
			wo.id,
			caused === 0
				? "No errors traced to this change"
				: `${caused} new ${caused === 1 ? "error" : "errors"} since this shipped`,
		);
		await this.cleanUp(wo, { merged: true });
		this.patch(wo.id, { state: "done", finished_at: this.store.iso() });
	}

	private setT3Health(ok: boolean, error: string | null) {
		const now = this.store.iso();
		const prev = this.store.health().find((h) => h.source === "T3");
		this.store.setHealth({
			source: "T3",
			ok,
			lastOk: ok ? now : (prev?.lastOk ?? null),
			error,
			fix: ok ? null : "t3 service status",
			nextCheckAt: null,
		});
	}

	/* ---------- actions ---------- */

	create(input: {
		project: string;
		type: WorkType;
		title: string;
		description: string;
		source: WorkOrderSource;
		prNumber?: number | null;
		mode?: Mode | null;
	}): number {
		const project = this.store.project(input.project);
		if (!project) throw new ActionError("That project isn't in the factory.", 404);
		const fp = input.source.fingerprint;
		if (fp) {
			const existing = this.store.db
				.prepare(
					"SELECT id, stage FROM work_orders WHERE fingerprint = ? AND state NOT IN ('done', 'closed')",
				)
				.get(fp) as { id: number; stage: string } | undefined;
			if (existing && existing.stage !== "Observe") return existing.id;
			// Starting again means the shipped fix isn't the answer. Its watch ends and new work begins.
			if (existing) {
				this.store.addActivity(existing.id, "You started new work on this");
				this.patch(existing.id, { state: "done", finished_at: this.store.iso() });
			}
		}
		const id = this.store.insertWorkOrder({ ...input, agent: this.store.settings().agents.agent });
		this.store.addActivity(
			id,
			input.source.kind === "person"
				? "Added by you"
				: input.source.kind === "pr_changes"
					? "You asked for changes on the PR"
					: input.source.kind === "issue"
						? `Started from issue #${input.source.issueNumber}`
						: "Started from the queue",
			input.source.kind === "pr_changes" ? input.description : null,
		);
		// The PR's gates describe its current commit. Verify waits for the agent's push before reading them.
		const pr = input.prNumber ? this.store.pr(input.project, input.prNumber) : null;
		if (pr && ownsNoPr(input.source.kind)) this.store.patchWorkOrder(id, { failed_sha: pr.headSha });
		this.publish(["work-orders", "queue", "floor", "shell"]);
		void this.tick();
		return id;
	}

	private need(id: number, states: WorkOrder["state"][]): WorkOrder {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		if (!states.includes(wo.state))
			throw new ActionError("That work order has moved on. Reload to see where it is.");
		return wo;
	}

	async approve(id: number) {
		await this.locked(id, async () => {
			this.need(id, ["plan_ready"]);
			this.store.addActivity(id, "Plan approved by you");
			this.patch(id, { state: "plan_approved" });
		});
		await this.tick();
	}

	change(id: number, note: string) {
		return this.locked(id, async () => {
			const wo = this.need(id, ["plan_ready"]);
			if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
			await this.sendOrThrow(id, wo.threadId, changePlanPrompt(note));
			this.store.addActivity(id, "You asked for changes to the plan", note);
			this.patch(id, { state: "planning" });
		});
	}

	reject(id: number) {
		return this.locked(id, async () => {
			this.need(id, ["plan_ready"]);
			audit(this.store.db, "reject plan", `WO-${id}`, "you", null, this.store.now());
			await this.closeOut(id, "Plan rejected by you");
		});
	}

	answer(id: number, answer: string, note: string | null) {
		return this.locked(id, async () => {
			const wo = this.need(id, ["question"]);
			const option = wo.question?.options.find((o) => o.label === answer);
			if (option?.stop) {
				audit(this.store.db, "close work order", `WO-${id}`, "you", null, this.store.now());
				await this.closeOut(id, "Closed by you");
				return;
			}
			if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
			await this.sendOrThrow(id, wo.threadId, answerPrompt(answer, note));
			this.store.addActivity(id, `You answered: ${answer}`, note);
			this.patch(id, {
				question: null,
				state: wo.stage === "Plan" ? "planning" : wo.stage === "Verify" ? "retrying" : "building",
			});
		});
	}

	/**
	 * Holds at the next step. T3 has no interrupt in its CLI, so the current turn finishes. It takes no lock:
	 * it only sets a flag that steps read, and the button shouldn't wait on a slow CLI.
	 */
	stop(id: number) {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		if (wo.state === "done" || wo.state === "closed")
			throw new ActionError("That work order has moved on. Reload to see where it is.");
		audit(this.store.db, "stop work order", `WO-${id}`, "you", null, this.store.now());
		this.store.addActivity(id, "You stopped this work order");
		this.patch(id, { hold: 1 });
	}

	async resume(id: number) {
		await this.locked(id, async () => {
			const wo = this.store.workOrder(id);
			if (!wo) throw new ActionError("That work order doesn't exist.", 404);
			this.store.addActivity(id, "You restarted this work order");
			this.patch(id, { hold: 0 });
		});
		await this.tick();
	}

	async retry(id: number, note: string | null) {
		const restarted = await this.locked(id, async () => {
			const wo = this.need(id, ["failed", "run_failed"]);
			if (wo.state === "run_failed" && !wo.threadId) {
				this.store.addActivity(id, "You tried again");
				this.patch(id, { state: "waiting", stage: "Intake", failure: null });
				return true;
			}
			if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
			const pr = this.openPr(wo);
			const prompt =
				wo.state === "failed"
					? retryPrompt(wo.failedGate as GateName | null, wo.failure ?? "", note)
					: `${this.lastPrompt(id) ?? (wo.stage === "Plan" ? planPrompt(wo) : this.directPrompt(wo))}${note ? `\n\nOwner's note:\n${note}` : ""}`;
			await this.sendOrThrow(id, wo.threadId, prompt);
			this.store.addActivity(id, note ? "You retried with a note" : "You tried again", note);
			this.patch(id, {
				state: wo.stage === "Plan" ? "planning" : wo.stage === "Verify" ? "retrying" : "building",
				retries: wo.state === "failed" ? wo.retries + 1 : wo.retries,
				first_try: wo.state === "failed" ? 0 : wo.firstTry ? 1 : 0,
				failure: null,
				// After a run that never finished, the commit it was waiting to replace is still the one to wait on.
				...(wo.state === "failed" ? { failed_sha: pr?.headSha ?? null } : {}),
			});
			return false;
		});
		if (restarted) await this.tick();
	}

	/** Deletes the worktree and branch. The source error stays in the queue. */
	close(id: number) {
		return this.locked(id, async () => {
			audit(this.store.db, "close work order", `WO-${id}`, "you", null, this.store.now());
			await this.closeOut(id, "Closed by you");
		});
	}

	/** Call inside `locked`. */
	private async closeOut(id: number, text: string, opts: { keepRemoteBranch?: boolean } = {}) {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		if (wo.state === "done" || wo.state === "closed") return;
		const project = this.store.project(wo.project);
		// A rebase or a requested change works on someone else's PR. Closing the work order leaves that PR alone.
		const notOurs = branchIsntOurs(wo);
		const closesRemote = !opts.keepRemoteBranch && !ownsNoPr(wo.source.kind) && !notOurs;
		if (project && closesRemote && wo.prNumber) {
			const res = await closePr(this.cli, project.repo, wo.prNumber);
			if (res.code !== 0 && !/already (been )?(closed|merged)/i.test(res.stderr))
				throw new ActionError(res.stderr.trim() || "GitHub refused to close the PR.", 502);
		}
		const left: string[] = [];
		if (project?.localPath && wo.branch && !notOurs) {
			if (wo.worktree) {
				const res = await this.gitStep(project.localPath, ["worktree", "remove", "--force", wo.worktree]);
				if (!res.ok) left.push(`the worktree ${wo.worktree} (${res.error})`);
			}
			const branch = await this.gitStep(project.localPath, ["branch", "-D", wo.branch]);
			if (!branch.ok) left.push(`the local branch ${wo.branch} (${branch.error})`);
			if (closesRemote) {
				const remote = await this.gitStep(project.localPath, ["push", "origin", "--delete", wo.branch]);
				if (remote.ok)
					audit(
						this.store.db,
						"delete branch",
						`${project.repo}:${wo.branch}`,
						"you",
						null,
						this.store.now(),
					);
				else left.push(`the branch ${wo.branch} on GitHub (${remote.error})`);
			}
		}
		this.store.addActivity(id, text);
		if (notOurs && wo.branch)
			this.store.addActivity(
				id,
				`Left the branch ${wo.branch} and its folder alone, because they aren't the factory's.`,
			);
		if (left.length > 0)
			this.store.addActivity(id, `Couldn't delete ${left.join(", and ")}. Delete it by hand.`);
		this.patch(id, { state: "closed", finished_at: this.store.iso() });
		this.pollSoon();
	}

	private async gitStep(cwd: string, args: string[]) {
		const res = await this.git(cwd, args);
		return res.ok || ALREADY_GONE.test(res.error) ? { ok: true, error: "" } : res;
	}

	/**
	 * A finished work order's worktree is the factory's own scratch space, so it goes without asking. Uncommitted
	 * changes keep it, because nothing else has a copy of them. A branch goes only once its work is merged.
	 */
	private async cleanUp(wo: WorkOrder, opts: { merged: boolean }) {
		const project = this.store.project(wo.project);
		if (!project?.localPath || branchIsntOurs(wo)) return;
		if (wo.worktree) {
			const res = await this.gitStep(project.localPath, ["worktree", "remove", wo.worktree]);
			if (!res.ok) {
				this.store.addActivity(wo.id, `Kept the worktree ${wo.worktree}: ${res.error}`);
				return;
			}
		}
		if (!opts.merged || !wo.branch || ownsNoPr(wo.source.kind)) return;
		const branch = await this.gitStep(project.localPath, ["branch", "-D", wo.branch]);
		if (!branch.ok) this.store.addActivity(wo.id, `Kept the local branch ${wo.branch}: ${branch.error}`);
	}

	/** A rebase that finished and fell behind again goes back to the agent that has the branch checked out. */
	async rebasePr(project: string, number: number) {
		const pr = this.store.pr(project, number);
		if (!pr) throw new ActionError("That PR isn't open.", 404);
		const fingerprint = `rebase:${project}:${number}`;
		const idle = this.store.db
			.prepare("SELECT id FROM work_orders WHERE fingerprint = ? AND state = 'ready'")
			.get(fingerprint) as { id: number } | undefined;
		if (!idle)
			return this.create({
				project,
				type: "Chore",
				title: `Rebase #${number} ${pr.title}`,
				description: `Rebase PR #${number} on its base branch and resolve any conflicts.`,
				source: { kind: "rebase_pr", fingerprint, prNumber: number },
				prNumber: number,
			});
		return this.locked(idle.id, async () => {
			const wo = this.store.workOrder(idle.id);
			const current = this.store.pr(project, number);
			if (!wo || !current || wo.state !== "ready" || !wo.threadId) return idle.id;
			await this.sendOrThrow(wo.id, wo.threadId, rebasePrompt(number));
			this.store.addActivity(wo.id, "You asked for another rebase");
			this.patch(wo.id, {
				stage: "Verify",
				state: "retrying",
				first_try: 0,
				failed_sha: current.headSha,
				gates: JSON.stringify(noGates("running")),
			});
			return idle.id;
		});
	}

	async requestChanges(project: string, number: number, note: string) {
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		const linked = this.store.pr(project, number)?.workOrderId ?? null;
		const run = async () => {
			const pr = this.store.pr(project, number);
			if (!pr) throw new ActionError("That PR isn't open.", 404);
			const wo = pr.workOrderId ? this.store.workOrder(pr.workOrderId) : null;
			if (wo) {
				// A run that failed isn't busy. Asking again is one of the ways past it.
				const stuck = wo.state === "failed" || wo.state === "run_failed";
				const busy = stuck ? null : this.agentBusy(wo, pr);
				if (busy) throw new ActionError(busy);
				if (!wo.threadId)
					throw new ActionError("This PR's work order hasn't started yet. Try again once it has.");
				await this.sendOrThrow(wo.id, wo.threadId, requestChangesPrompt(note));
				this.store.addActivity(wo.id, "You asked for changes on the PR", note);
				this.patch(wo.id, {
					stage: "Verify",
					state: "retrying",
					first_try: 0,
					failed_sha: pr.headSha,
					gates: JSON.stringify(noGates("running")),
				});
				return { workOrderId: wo.id };
			}
			// A PR with no work order gets one, with the note as its request.
			const id = this.create({
				project,
				type: "Chore",
				title: `Changes on #${number}: ${pr.title}`,
				description: note,
				source: { kind: "pr_changes", prNumber: number },
				prNumber: number,
			});
			return { workOrderId: id };
		};
		return linked ? this.locked(linked, run) : run();
	}

	private staleRead(project: { readAt: string | null }) {
		return (
			project.readAt != null && this.store.now().getTime() - Date.parse(project.readAt) > READ_MAX_AGE_MS
		);
	}

	private agentBusy(wo: WorkOrder, pr: PullRequest) {
		return agentHoldsMerge({ state: wo.state, failedSha: this.failedSha(wo.id) }, pr.headSha);
	}

	private async sendOrThrow(id: number, threadId: string, prompt: string) {
		if (this.store.line().stopped) throw new ActionError("The line is stopped. Restart it first.");
		try {
			await this.sendTurn(id, threadId, prompt);
		} catch (e) {
			if (e instanceof ExecutorError && e.gone) {
				const wo = this.store.workOrder(id);
				if (wo) this.runFailed(wo, wo.stage, e);
				throw new ActionError("T3 no longer has this agent's thread. Try again starts it over.", 502);
			}
			if (e instanceof ExecutorError) throw new ActionError(`T3 couldn't take this: ${e.message}`, 502);
			throw e;
		}
	}

	/** Merge is checked here on every call, whatever the page showed. */
	async merge(project: string, number: number): Promise<{ ok: boolean; reason: string }> {
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		const linked = this.store.pr(project, number)?.workOrderId ?? null;
		const run = async () => {
			const pr = this.store.pr(project, number);
			if (!pr) throw new ActionError("That PR isn't open.", 404);
			const wo = pr.workOrderId ? this.store.workOrder(pr.workOrderId) : null;
			const busy = wo ? this.agentBusy(wo, pr) : null;
			const stale = this.staleRead(proj)
				? "The factory hasn't read this PR from GitHub lately. Try again once it has."
				: null;
			const old = pr.group === "stale" ? "This PR is stale, so rebase it first." : null;
			const blockers = busy ? [busy] : stale ? [stale] : old ? [old] : mergeBlockers(pr);
			if (blockers.length) return { ok: false, reason: blockers.join(" ") };
			const res = await mergePr(this.cli, proj.repo, number, pr.headSha);
			audit(this.store.db, "merge PR", `${proj.repo}#${number}`, "you", res.reason || null, this.store.now());
			if (res.ok) {
				if (wo) this.markMerged(wo, `Merged PR #${number} by you`);
				this.store.db.prepare("DELETE FROM prs WHERE project = ? AND number = ?").run(project, number);
				this.publish(["prs", "queue", "floor", "shell", "projects"]);
			}
			this.pollSoon();
			return res;
		};
		return linked ? this.locked(linked, run) : run();
	}

	async closePullRequest(project: string, number: number) {
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		const linked = this.store.pr(project, number)?.workOrderId ?? null;
		const run = async () => {
			const pr = this.store.pr(project, number);
			if (!pr) throw new ActionError("That PR isn't open.", 404);
			const res = await closePr(this.cli, proj.repo, number);
			if (res.code !== 0) throw new ActionError(res.stderr.trim() || "GitHub refused.", 502);
			audit(this.store.db, "close PR", `${proj.repo}#${number}`, "you", null, this.store.now());
			if (pr.workOrderId)
				await this.closeOut(pr.workOrderId, `PR #${number} closed by you`, { keepRemoteBranch: true });
			this.store.db.prepare("DELETE FROM prs WHERE project = ? AND number = ?").run(project, number);
			this.publish(["prs", "queue", "shell", "projects"]);
		};
		return linked ? this.locked(linked, run) : run();
	}

	setLine(stopped: boolean) {
		const at = this.store.iso();
		kvSet(this.store.db, "line", { stopped, stoppedAt: stopped ? at : null });
		audit(
			this.store.db,
			stopped ? "stop the line" : "restart the line",
			"line",
			"you",
			null,
			this.store.now(),
		);
		if (!stopped) this.store.db.prepare("UPDATE work_orders SET held_by_line = 0").run();
		this.publish(["line", "queue", "floor", "shell", "work-orders"]);
		void this.tick();
	}
}

function stripBlocks(text: string) {
	return parseReply(text).text;
}
