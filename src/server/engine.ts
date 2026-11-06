import { execFile } from "node:child_process";
import { z } from "zod";
import {
	allFourPassed,
	anyGate,
	failedGate,
	gatesClear,
	gatesPassed,
	mayMergeAlone,
	mergeBlockers,
	noGates,
	parseReply,
	slugify,
	startBlock,
	verifyHasRoom,
} from "../shared/rules.ts";
import type {
	AgentQuestion,
	GateName,
	Limits,
	Plan,
	PullRequest,
	StartBlock,
	WorkOrder,
	WorkOrderSource,
	WorkType,
} from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { closePr, failedLog, mergePr, prByBranch, prState } from "./connectors/github.ts";
import { audit, kvSet } from "./db.ts";
import type { Executor, ThreadState } from "./executor/types.ts";
import { ExecutorError } from "./executor/types.ts";
import {
	answerPrompt,
	buildPrompt,
	changePlanPrompt,
	planPrompt,
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
/** A PR with no checks at all goes to Review after this long. */
const NO_CHECKS_MS = 5 * 60_000;
const SHIP_MAX_MS = 30 * 60_000;
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
	git?: (cwd: string, args: string[]) => Promise<void>;
	/** Events the queue can't show, for notifications. */
	onEvent?: (event: EngineEvent) => void;
}

export type EngineEvent =
	| { kind: "merged_alone"; workOrder: WorkOrder; prTitle: string }
	| { kind: "shipped"; workOrder: WorkOrder }
	| { kind: "slots_full"; agents: number; waiting: number };

const realGit = (cwd: string, args: string[]) =>
	new Promise<void>((resolve) => {
		execFile("git", args, { cwd }, () => resolve());
	});

export class Engine {
	private readonly store: Store;
	private readonly cli: Cli;
	private readonly executor: Executor;
	private readonly publish: (keys: string[]) => void;
	private readonly pollSoon: () => void;
	private readonly git: (cwd: string, args: string[]) => Promise<void>;
	private readonly onEvent: (event: EngineEvent) => void;
	private ticking = false;
	private tickAgain = false;

	constructor(deps: EngineDeps) {
		this.store = deps.store;
		this.cli = deps.cli;
		this.executor = deps.executor;
		this.publish = deps.publish;
		this.pollSoon = deps.pollSoon;
		this.git = deps.git ?? realGit;
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
				for (const wo of this.store.workOrders()) {
					if (wo.state === "waiting" || wo.state === "plan_approved") continue;
					await this.advance(wo);
				}
				await this.startWaiting();
			} while (this.tickAgain);
		} finally {
			this.ticking = false;
		}
	}

	private patch(id: number, patch: Partial<WorkOrderPatch>) {
		this.store.patchWorkOrder(id, { state_at: this.store.iso(), ...patch });
		this.publish(["work-orders", `work-order:${id}`, "queue", "floor", "shell"]);
	}

	private async startWaiting() {
		const line = this.store.line();
		for (const wo of this.store.workOrders("state IN ('waiting', 'plan_approved')")) {
			if (line.stopped) {
				if (!wo.heldByLine) this.store.patchWorkOrder(wo.id, { held_by_line: 1 });
				continue;
			}
			if (wo.heldByLine) this.store.patchWorkOrder(wo.id, { held_by_line: 0 });
			if (wo.hold) continue;
			const project = this.store.project(wo.project);
			if (!project || project.paused || project.folderMissing || !project.localPath) continue;
			const open = this.store.workOrders();
			const build = open.filter((w) => w.stage === "Build").length;
			// Plans are short agent runs. They count here so a long Intake can't start every plan at once.
			const planning = open.filter((w) => w.stage === "Plan" && w.state === "planning").length;
			const review = open.filter((w) => w.stage === "Review").length;
			const block = this.block(build + (wo.state === "waiting" ? planning : 0), review);
			if (block) {
				if (block === "limit") {
					const waiting = open.filter((w) => w.stage === "Intake").length;
					if (waiting) this.onEvent({ kind: "slots_full", agents: this.store.settings().agents.agentsAtOnce, waiting });
				}
				return;
			}
			if (wo.state === "plan_approved") await this.startBuildTurn(wo);
			else await this.startFromIntake(wo, project.localPath, project.defaultBranch);
		}
	}

	private async startFromIntake(wo: WorkOrder, localPath: string, base: string) {
		const review = this.store.settings().approvals.planReview[wo.type];
		const needsPlan = review === "always" && !["rebase_pr", "toolkit"].includes(wo.source.kind);
		const stage = needsPlan ? "Plan" : "Build";
		const prompt = needsPlan ? planPrompt(wo) : this.directPrompt(wo);
		const branch = `factory/wo-${wo.id}-${slugify(wo.title, 32)}`;
		try {
			const { threadId, link } = await this.executor.start({
				projectPath: localPath,
				title: `WO-${wo.id} ${wo.title}`,
				prompt,
				baseBranch: base,
				branch,
				agent: this.store.settings().agents.agent,
			});
			const state = await this.executor.status(threadId).catch(() => null);
			this.store.addActivity(wo.id, "Created worktree and branch");
			audit(this.store.db, "start agent", `WO-${wo.id}`, "factory", branch, this.store.now());
			this.patch(wo.id, {
				stage,
				state: needsPlan ? "planning" : "building",
				stage_at: this.store.iso(),
				thread_id: threadId,
				thread_link: link,
				branch,
				worktree: state?.worktree ?? null,
			});
		} catch (e) {
			this.runFailed(wo, stage, e);
		}
	}

	private directPrompt(wo: WorkOrder) {
		if (wo.source.kind === "rebase_pr" && wo.prNumber) return rebasePrompt(wo.prNumber);
		if (wo.source.kind === "toolkit") return syncPrompt();
		return buildPrompt(wo);
	}

	private runFailed(wo: WorkOrder, stage: WorkOrder["stage"], e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		this.store.addActivity(wo.id, "T3 couldn't start this run", message);
		this.patch(wo.id, { stage, state: "run_failed", failure: message });
	}

	private async startBuildTurn(wo: WorkOrder) {
		if (!wo.threadId) return;
		try {
			await this.executor.send(wo.threadId, buildPrompt(wo));
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
			this.setT3Health(false, e instanceof Error ? e.message : String(e));
			return;
		}
		const output = JSON.stringify(state.recent.map(stripBlocks));
		if (state.worktree && state.worktree !== wo.worktree) this.store.patchWorkOrder(wo.id, { worktree: state.worktree });
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
			this.patch(wo.id, { state: wo.stage === "Plan" ? "planning" : wo.stage === "Verify" ? "retrying" : "building" });
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
			this.patch(wo.id, { state: "question", question: JSON.stringify(question.data satisfies AgentQuestion) });
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
			const number = wo.prNumber ?? (project && wo.branch ? await prByBranch(this.cli, project.repo, wo.branch) : null);
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
			this.markMerged(wo, "Merged on GitHub");
			return true;
		}
		if (state === "CLOSED") {
			this.store.addActivity(wo.id, `PR #${wo.prNumber} was closed`);
			this.patch(wo.id, { state: "closed", finished_at: this.store.iso() });
			return true;
		}
		return false;
	}

	private markMerged(wo: WorkOrder, text: string) {
		const at = this.store.iso();
		this.store.addActivity(wo.id, text);
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
		if (anyGate(pr.gates, "running")) return;
		const noChecks = !gatesPassed(pr.gates) && gatesClear(pr.gates);
		if (noChecks && this.store.now().getTime() - Date.parse(wo.stageAt) < NO_CHECKS_MS) return;
		const first = wo.retries === 0 && wo.firstTry;
		this.store.addActivity(
			wo.id,
			allFourPassed(pr.gates) && first ? "All 4 gates passed on the first try" : noChecks ? "No gates set up" : "Gates passed",
		);
		this.patch(wo.id, { stage: "Review", state: "ready", stage_at: this.store.iso(), failure: null, failed_gate: null });
		await this.review({ ...wo, gates: pr.gates, stage: "Review", state: "ready" });
	}

	private failedSha(id: number) {
		return (this.store.db.prepare("SELECT failed_sha FROM work_orders WHERE id = ?").get(id) as { failed_sha: string | null })
			.failed_sha;
	}

	private stateAt(id: number) {
		const row = this.store.db.prepare("SELECT state_at, updated_at FROM work_orders WHERE id = ?").get(id) as {
			state_at: string | null;
			updated_at: string;
		};
		return row.state_at ?? row.updated_at;
	}

	private async gateFailed(wo: WorkOrder, pr: PullRequest, samePush: boolean) {
		const gate = failedGate(pr.gates);
		const project = this.store.project(wo.project);
		const check = pr.checks.find((c) => c.bucket === "fail");
		const log = project && check ? await failedLog(this.cli, project.repo, check.url) : null;
		const text = log ?? (samePush ? "The agent's retry pushed no new commit." : `${check?.name ?? gate ?? "A gate"} failed.`);
		const { retries } = this.store.settings().agents;
		const line = this.store.line();
		if (wo.retries < retries && !line.stopped && !wo.hold && wo.threadId && !samePush) {
			this.store.addActivity(wo.id, `${gate ?? "A gate"} failed`, text);
			this.patch(wo.id, {
				state: "retrying",
				retries: wo.retries + 1,
				first_try: 0,
				failed_gate: gate,
				failed_sha: pr.headSha,
			});
			try {
				await this.executor.send(wo.threadId, retryPrompt(gate, text, null));
			} catch (e) {
				this.runFailed(wo, "Verify", e);
			}
			return;
		}
		if (line.stopped || wo.hold) {
			if (!wo.heldByLine) this.store.patchWorkOrder(wo.id, { held_by_line: line.stopped ? 1 : 0 });
			return;
		}
		this.store.addActivity(wo.id, `${gate ?? "A gate"} failed after retries`, text);
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
		const project = this.store.project(wo.project);
		const approvals = this.store.settings().approvals;
		if (
			project &&
			!this.store.line().stopped &&
			mayMergeAlone({
				on: approvals.mergeWithoutMe[wo.type],
				projectMerging: project.merging,
				gates: pr.gates,
				mergeable: pr.mergeable,
				mergeState: pr.mergeState,
				isDraft: pr.isDraft,
			})
		) {
			const res = await mergePr(this.cli, project.repo, pr.number);
			audit(this.store.db, "merge PR", `${project.repo}#${pr.number}`, "factory", res.reason || null, this.store.now());
			if (res.ok) {
				this.markMerged(wo, "Merged without you");
				this.onEvent({ kind: "merged_alone", workOrder: wo, prTitle: pr.title });
			}
			this.pollSoon();
		}
	}

	private async ship(wo: WorkOrder) {
		const main = this.store.main(wo.project);
		const elapsed = this.store.now().getTime() - Date.parse(wo.stageAt);
		if (main?.state === "running" && elapsed < SHIP_MAX_MS) return;
		if (main?.state === "red" && elapsed < SHIP_MAX_MS) return;
		this.store.addActivity(wo.id, main?.state === "red" ? "Main is red after shipping" : "Shipped");
		if (main?.state !== "red") this.onEvent({ kind: "shipped", workOrder: wo });
		this.patch(wo.id, { stage: "Observe", state: "observing", stage_at: this.store.iso() });
	}

	private async observe(wo: WorkOrder) {
		if (this.store.now().getTime() - Date.parse(wo.stageAt) < OBSERVE_MS) return;
		this.store.addActivity(wo.id, "No errors traced to this change");
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
	}): number {
		const project = this.store.project(input.project);
		if (!project) throw new ActionError("That project isn't in the factory.", 404);
		const fp = input.source.fingerprint;
		if (fp) {
			const existing = this.store.db
				.prepare("SELECT id FROM work_orders WHERE fingerprint = ? AND state NOT IN ('done', 'closed')")
				.get(fp) as { id: number } | undefined;
			if (existing) return existing.id;
		}
		const id = this.store.insertWorkOrder({ ...input, agent: this.store.settings().agents.agent });
		this.store.addActivity(id, input.source.kind === "person" ? "Added by you" : "Started from the queue");
		this.publish(["work-orders", "queue", "floor", "shell"]);
		void this.tick();
		return id;
	}

	private need(id: number, states: WorkOrder["state"][]): WorkOrder {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		if (!states.includes(wo.state)) throw new ActionError("That work order has moved on. Reload to see where it is.");
		return wo;
	}

	async approve(id: number) {
		this.need(id, ["plan_ready"]);
		this.store.addActivity(id, "Plan approved by you");
		this.patch(id, { state: "plan_approved" });
		await this.tick();
	}

	async change(id: number, note: string) {
		const wo = this.need(id, ["plan_ready"]);
		if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
		await this.sendOrThrow(wo.threadId, changePlanPrompt(note));
		this.store.addActivity(id, "You asked for changes to the plan", note);
		this.patch(id, { state: "planning" });
	}

	async reject(id: number) {
		this.need(id, ["plan_ready"]);
		audit(this.store.db, "reject plan", `WO-${id}`, "you", null, this.store.now());
		await this.closeOut(id, "Plan rejected by you");
	}

	async answer(id: number, answer: string, note: string | null) {
		const wo = this.need(id, ["question"]);
		const option = wo.question?.options.find((o) => o.label === answer);
		if (option?.stop) {
			await this.close(id);
			return;
		}
		if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
		await this.sendOrThrow(wo.threadId, answerPrompt(answer, note));
		this.store.addActivity(id, `You answered: ${answer}`, note);
		this.patch(id, {
			question: null,
			state: wo.stage === "Plan" ? "planning" : wo.stage === "Verify" ? "retrying" : "building",
		});
	}

	/** Holds at the next step. T3 has no interrupt in its CLI, so the current turn finishes. */
	stop(id: number) {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		audit(this.store.db, "stop work order", `WO-${id}`, "you", null, this.store.now());
		this.store.addActivity(id, "You stopped this work order");
		this.patch(id, { hold: 1 });
	}

	async resume(id: number) {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		this.store.addActivity(id, "You restarted this work order");
		this.patch(id, { hold: 0 });
		await this.tick();
	}

	async retry(id: number, note: string | null) {
		const wo = this.need(id, ["failed", "run_failed"]);
		if (wo.state === "run_failed" && !wo.threadId) {
			this.store.addActivity(id, "You tried again");
			this.patch(id, { state: "waiting", stage: "Intake", failure: null });
			await this.tick();
			return;
		}
		if (!wo.threadId) throw new ActionError("This work order has no agent thread.");
		const pr = this.openPr(wo);
		const prompt =
			wo.state === "failed"
				? retryPrompt(wo.failedGate as GateName | null, wo.failure ?? "", note)
				: wo.stage === "Plan"
					? planPrompt(wo)
					: this.directPrompt(wo);
		await this.sendOrThrow(wo.threadId, prompt);
		this.store.addActivity(id, note ? "You retried with a note" : "You tried again", note);
		this.patch(id, {
			state: wo.stage === "Plan" ? "planning" : wo.state === "failed" ? "retrying" : "building",
			retries: wo.state === "failed" ? wo.retries + 1 : wo.retries,
			first_try: wo.state === "failed" ? 0 : wo.firstTry ? 1 : 0,
			failure: null,
			failed_sha: wo.state === "failed" ? (pr?.headSha ?? null) : null,
		});
	}

	/** Deletes the worktree and branch. The source error stays in the queue. */
	async close(id: number) {
		audit(this.store.db, "close work order", `WO-${id}`, "you", null, this.store.now());
		await this.closeOut(id, "Closed by you");
	}

	private async closeOut(id: number, text: string, opts: { keepRemoteBranch?: boolean } = {}) {
		const wo = this.store.workOrder(id);
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		if (wo.state === "done" || wo.state === "closed") return;
		const project = this.store.project(wo.project);
		if (project?.localPath && wo.branch) {
			if (wo.worktree) await this.git(project.localPath, ["worktree", "remove", "--force", wo.worktree]);
			await this.git(project.localPath, ["branch", "-D", wo.branch]);
			if (!opts.keepRemoteBranch) {
				if (wo.prNumber) await closePr(this.cli, project.repo, wo.prNumber);
				await this.git(project.localPath, ["push", "origin", "--delete", wo.branch]);
				audit(this.store.db, "delete branch", `${project.repo}:${wo.branch}`, "you", null, this.store.now());
			}
		}
		this.store.addActivity(id, text);
		this.patch(id, { state: "closed", finished_at: this.store.iso() });
		this.pollSoon();
	}

	async requestChanges(project: string, number: number, note: string) {
		const pr = this.store.pr(project, number);
		if (!pr) throw new ActionError("That PR isn't open.", 404);
		const wo = pr.workOrderId ? this.store.workOrder(pr.workOrderId) : null;
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		if (wo?.threadId) {
			await this.sendOrThrow(wo.threadId, requestChangesPrompt(note));
			this.store.addActivity(wo.id, "You asked for changes on the PR", note);
			this.patch(wo.id, { stage: "Verify", state: "retrying", first_try: 0, failed_sha: pr.headSha, gates: JSON.stringify(noGates("running")) });
			return { workOrderId: wo.id };
		}
		// A PR with no work order gets one, with the note as its request.
		const id = this.create({
			project,
			type: "Chore",
			title: `Changes on #${number}: ${pr.title}`,
			description: note,
			source: { kind: "rebase_pr", prNumber: number },
			prNumber: number,
		});
		return { workOrderId: id };
	}

	private async sendOrThrow(threadId: string, prompt: string) {
		try {
			await this.executor.send(threadId, prompt);
		} catch (e) {
			if (e instanceof ExecutorError) throw new ActionError(`T3 couldn't take this: ${e.message}`, 502);
			throw e;
		}
	}

	/** Merge is checked here on every call, whatever the page showed. */
	async merge(project: string, number: number): Promise<{ ok: boolean; reason: string }> {
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		const pr = this.store.pr(project, number);
		if (!pr) throw new ActionError("That PR isn't open.", 404);
		const blockers = mergeBlockers(pr);
		if (blockers.length) return { ok: false, reason: blockers.join(" ") };
		const res = await mergePr(this.cli, proj.repo, number);
		audit(this.store.db, "merge PR", `${proj.repo}#${number}`, "you", res.reason || null, this.store.now());
		if (res.ok) {
			const wo = pr.workOrderId ? this.store.workOrder(pr.workOrderId) : null;
			if (wo) this.markMerged(wo, `Merged PR #${number} by you`);
			this.store.db.prepare("DELETE FROM prs WHERE project = ? AND number = ?").run(project, number);
			this.publish(["prs", "queue", "floor", "shell", "projects"]);
		}
		this.pollSoon();
		return res;
	}

	async closePullRequest(project: string, number: number) {
		const proj = this.store.project(project);
		if (!proj) throw new ActionError("That project isn't in the factory.", 404);
		const pr = this.store.pr(project, number);
		if (!pr) throw new ActionError("That PR isn't open.", 404);
		const res = await closePr(this.cli, proj.repo, number);
		if (res.code !== 0) throw new ActionError(res.stderr.trim() || "GitHub refused.", 502);
		audit(this.store.db, "close PR", `${proj.repo}#${number}`, "you", null, this.store.now());
		if (pr.workOrderId) await this.closeOut(pr.workOrderId, `PR #${number} closed by you`, { keepRemoteBranch: true });
		this.store.db.prepare("DELETE FROM prs WHERE project = ? AND number = ?").run(project, number);
		this.publish(["prs", "queue", "shell", "projects"]);
	}

	setLine(stopped: boolean) {
		const at = this.store.iso();
		kvSet(this.store.db, "line", { stopped, stoppedAt: stopped ? at : null });
		audit(this.store.db, stopped ? "stop the line" : "restart the line", "line", "you", null, this.store.now());
		if (!stopped) this.store.db.prepare("UPDATE work_orders SET held_by_line = 0").run();
		this.publish(["line", "queue", "floor", "shell", "work-orders"]);
		void this.tick();
	}
}

function stripBlocks(text: string) {
	return parseReply(text).text;
}
