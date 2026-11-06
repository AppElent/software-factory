import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { kvSet, openDb } from "../../src/server/db.ts";
import { ActionError, Engine, OBSERVE_MS } from "../../src/server/engine.ts";
import { FakeExecutor } from "../../src/server/executor/fake.ts";
import { Store } from "../../src/server/store.ts";
import { noGates } from "../../src/shared/rules.ts";
import type { CheckRun, PullRequest, WorkOrder } from "../../src/shared/types.ts";

type Calls = string[];

let store: Store;
let exec: FakeExecutor;
let engine: Engine;
let clock: number;
let calls: Calls;
let cliResult: Record<string, { code: number; stdout?: string; stderr?: string }>;

const cli: Cli = async (cmd, args) => {
	const line = `${cmd} ${args.join(" ")}`;
	calls.push(line);
	for (const [k, v] of Object.entries(cliResult)) {
		if (line.includes(k))
			return {
				code: v.code,
				stdout: v.stdout ?? "",
				stderr: v.stderr ?? "",
				timedOut: false,
				missing: false,
			};
	}
	return { code: 0, stdout: "", stderr: "", timedOut: false, missing: false };
};

const addProject = (slug = "fairway") =>
	store.db
		.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
		.run(slug, `me/${slug}`, slug, `https://github.com/me/${slug}`, "/tmp", new Date(clock).toISOString());

const putPr = (number: number, over: Partial<PullRequest> = {}, project = "fairway") => {
	const pr = {
		number,
		title: "A change",
		url: "",
		body: "",
		isDraft: false,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		headRef: "b",
		headSha: "sha1",
		baseRef: "main",
		createdAt: new Date(clock).toISOString(),
		updatedAt: new Date(clock).toISOString(),
		mergeable: "MERGEABLE",
		mergeState: "CLEAN",
		gates: noGates("passed"),
		checks: [] as CheckRun[],
		group: "ready",
		...over,
	};
	store.db
		.prepare("INSERT OR REPLACE INTO prs (project, number, json) VALUES (?, ?, ?)")
		.run(project, number, JSON.stringify(pr));
};

const wo = (id: number) => store.workOrder(id) as WorkOrder;
const start = (over: Partial<Parameters<Engine["create"]>[0]> = {}) =>
	engine.create({
		project: "fairway",
		type: "Bug fix",
		title: "Fix it",
		description: "Fix it",
		source: { kind: "person" },
		...over,
	});
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0));
	// A work order moves one step per pass, as it does on the service's heartbeat.
	await engine.tick();
	await engine.tick();
};
const threadOf = (id: number) => wo(id).threadId as string;

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "sf-"));
	clock = Date.parse("2026-11-06T12:00:00Z");
	store = new Store(openDb(join(dir, "t.db")), dir, () => new Date(clock));
	exec = new FakeExecutor();
	calls = [];
	cliResult = { "pr view": { code: 0, stdout: '{"state":"OPEN"}' } };
	engine = new Engine({
		store,
		cli,
		executor: exec,
		publish: () => {},
		pollSoon: () => {},
		git: async () => {},
	});
	addProject();
});

const planBlock = '```factory-plan\n{"summary":"Do it","steps":["one"]}\n```';

describe("a work order's path", () => {
	it("goes from Intake to Observe with approvals at each gate", async () => {
		const id = start();
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Plan", state: "planning" });

		exec.finish(threadOf(id), planBlock);
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Plan", state: "plan_ready", plan: { summary: "Do it" } });

		await engine.approve(id);
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Build", state: "building" });
		expect(exec.threads.get(threadOf(id))?.sent).toHaveLength(2);

		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7, { gates: { ...noGates("running") } });
		exec.finish(threadOf(id), "Opened the PR.");
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Verify", state: "verifying", prNumber: 7 });

		putPr(7);
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Review", state: "ready", firstTry: true });

		const merged = await engine.merge("fairway", 7);
		expect(merged.ok).toBe(true);
		expect(wo(id)).toMatchObject({ stage: "Ship", state: "shipping" });

		await settle();
		expect(wo(id)).toMatchObject({ stage: "Observe", state: "observing" });

		clock += OBSERVE_MS + 1;
		await settle();
		expect(wo(id).state).toBe("done");
	});

	it("skips Plan when the work type says so", async () => {
		const id = start({ type: "Chore" });
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Build", state: "building" });
	});

	it("treats an agent's question as waiting for you, and keeps going after the answer", async () => {
		const id = start({ type: "Chore" });
		await settle();
		exec.finish(
			threadOf(id),
			'```factory-question\n{"question":"Which?","options":[{"label":"A"},{"label":"Stop","stop":true}]}\n```',
		);
		await settle();
		expect(wo(id)).toMatchObject({ state: "question", question: { question: "Which?" } });
		await engine.answer(id, "A", null);
		expect(wo(id).state).toBe("building");
		expect(wo(id).question).toBeNull();
	});

	it("marks a native T3 question as waiting in T3", async () => {
		const id = start({ type: "Chore" });
		await settle();
		exec.nativeWait(threadOf(id));
		await settle();
		expect(wo(id).state).toBe("waiting_in_t3");
	});

	it("shows a failed start honestly", async () => {
		exec.failStart = "T3 is down";
		const id = start();
		await settle();
		expect(wo(id)).toMatchObject({ state: "run_failed", failure: "T3 is down" });
		exec.failStart = null;
		await engine.retry(id, null);
		await settle();
		expect(wo(id).state).toBe("planning");
	});

	it("says so when the agent finishes without a PR", async () => {
		cliResult["pr list"] = { code: 0, stdout: "[]" };
		const id = start({ type: "Chore" });
		await settle();
		exec.finish(threadOf(id), "All done!");
		await settle();
		expect(wo(id)).toMatchObject({
			state: "run_failed",
			failure: "The agent finished without opening a PR.",
		});
	});
});

describe("retries", () => {
	const toVerify = async () => {
		const id = start({ type: "Chore" });
		await settle();
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7, { gates: noGates("running") });
		exec.finish(threadOf(id), "Done");
		await settle();
		return id;
	};

	it("retries once, then stops and needs you", async () => {
		const id = await toVerify();
		const failed = { ...noGates("passed"), Tests: "failed" as const };
		putPr(7, { gates: failed, headSha: "sha1" });
		await settle();
		expect(wo(id)).toMatchObject({ state: "retrying", retries: 1, firstTry: false, failedGate: "Tests" });
		expect(exec.threads.get(threadOf(id))?.sent.at(-1)).toContain("Tests");

		exec.finish(threadOf(id), "Pushed a fix");
		putPr(7, { gates: failed, headSha: "sha2" });
		await settle();
		expect(wo(id)).toMatchObject({ state: "failed", failedGate: "Tests" });

		await engine.retry(id, "Look at the sort");
		expect(wo(id)).toMatchObject({ state: "retrying", retries: 2 });
		expect(exec.threads.get(threadOf(id))?.sent.at(-1)).toContain("Look at the sort");
	});

	it("doesn't count old failures on the same commit as a second try", async () => {
		const id = await toVerify();
		const failed = { ...noGates("passed"), Tests: "failed" as const };
		putPr(7, { gates: failed, headSha: "sha1" });
		await settle();
		exec.finish(threadOf(id), "Working on it");
		await settle();
		expect(wo(id).state).toBe("verifying");
		await settle();
		expect(wo(id).state).toBe("verifying");
	});
});

describe("limits", () => {
	it("starts up to the limit, in order, and the rest wait", async () => {
		kvSet(store.db, "settings:agents", {
			agentsAtOnce: 1,
			pauseOnReview: false,
			retries: 1,
			agent: "claude",
		});
		const a = start({ type: "Chore", title: "a" });
		const b = start({ type: "Chore", title: "b" });
		await settle();
		expect(wo(a).state).toBe("building");
		expect(wo(b).state).toBe("waiting");
		expect(engine.limits().startBlock).toBe("limit");
	});

	it("doesn't start anything for a paused project, and doesn't block others", async () => {
		addProject("foundry");
		store.db.prepare("UPDATE projects SET paused = 1 WHERE slug = 'fairway'").run();
		const a = start({ type: "Chore" });
		const b = start({ type: "Chore", project: "foundry" });
		await settle();
		expect(wo(a).state).toBe("waiting");
		expect(wo(a).waitingFor).toContain("paused");
		expect(wo(b).state).toBe("building");
	});

	it("allows one open work order per fingerprint", async () => {
		const a = start({ source: { kind: "error", fingerprint: "error:1" } });
		const b = start({ source: { kind: "error", fingerprint: "error:1" } });
		expect(a).toBe(b);
	});
});

describe("stopping", () => {
	it("the line holds new work and restart resumes it", async () => {
		engine.setLine(true);
		const id = start({ type: "Chore" });
		await settle();
		expect(wo(id).state).toBe("waiting");
		expect(wo(id).heldByLine).toBe(true);
		engine.setLine(false);
		await settle();
		expect(wo(id).state).toBe("building");
	});

	it("an agent mid-step finishes it and holds before the gates", async () => {
		const id = start({ type: "Chore" });
		await settle();
		engine.setLine(true);
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		exec.finish(threadOf(id), "Done");
		await settle();
		expect(wo(id)).toMatchObject({ stage: "Build", state: "build_done", heldByLine: true });
		engine.setLine(false);
		await settle();
		expect(wo(id).stage).toBe("Verify");
	});

	it("stopping one holds that one", async () => {
		const id = start({ type: "Chore" });
		await settle();
		engine.stop(id);
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		exec.finish(threadOf(id), "Done");
		await settle();
		expect(wo(id).state).toBe("build_done");
		await engine.resume(id);
		await settle();
		expect(wo(id).stage).toBe("Verify");
	});
});

describe("merging", () => {
	it("refuses on the server when a gate failed, whatever the page showed", async () => {
		putPr(9, { gates: { ...noGates("passed"), Tests: "failed" } });
		const res = await engine.merge("fairway", 9);
		expect(res.ok).toBe(false);
		expect(calls.some((c) => c.includes("pr merge"))).toBe(false);
	});

	it("records merges in the audit log", async () => {
		putPr(9);
		await engine.merge("fairway", 9);
		const row = store.db.prepare("SELECT action, target, started_by FROM audit_log").get();
		expect(row).toMatchObject({ action: "merge PR", target: "me/fairway#9", started_by: "you" });
	});

	it("reports GitHub's reason when it won't merge", async () => {
		cliResult["pr merge"] = { code: 1, stderr: "Base branch was modified" };
		putPr(9);
		const res = await engine.merge("fairway", 9);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain("Base branch");
	});

	it("merges alone only when turned on, and only with all four gates", async () => {
		const approvals = store.settings().approvals;
		store.saveApprovals({ ...approvals, mergeWithoutMe: { ...approvals.mergeWithoutMe, Chore: true } });
		const id = start({ type: "Chore" });
		await settle();
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7, { gates: { ...noGates("passed"), Preview: "not_set_up" } });
		exec.finish(threadOf(id), "Done");
		await settle();
		expect(wo(id).state).toBe("ready");

		putPr(7);
		await settle();
		expect(wo(id).stage).not.toBe("Review");
		expect(calls.some((c) => c.includes("pr merge"))).toBe(true);
	});

	it("a project set to always ask is exempt", async () => {
		store.db.prepare("UPDATE projects SET merging = 'ask' WHERE slug = 'fairway'").run();
		const approvals = store.settings().approvals;
		store.saveApprovals({ ...approvals, mergeWithoutMe: { ...approvals.mergeWithoutMe, Chore: true } });
		const id = start({ type: "Chore" });
		await settle();
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7);
		exec.finish(threadOf(id), "Done");
		await settle();
		expect(wo(id).state).toBe("ready");
		expect(calls.some((c) => c.includes("pr merge"))).toBe(false);
	});

	it("notices a merge made on GitHub", async () => {
		const id = start({ type: "Chore" });
		await settle();
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7);
		exec.finish(threadOf(id), "Done");
		await settle();
		store.db.prepare("DELETE FROM prs").run();
		cliResult["pr view"] = { code: 0, stdout: '{"state":"MERGED"}' };
		await settle();
		expect(wo(id).stage).not.toBe("Review");
		expect(wo(id).mergedAt).not.toBeNull();
	});
});

describe("closing", () => {
	it("needs the right state for each action", async () => {
		const id = start();
		await settle();
		await expect(engine.approve(id)).rejects.toThrow(ActionError);
	});

	it("rejecting a plan closes the work order", async () => {
		const id = start();
		await settle();
		exec.finish(threadOf(id), planBlock);
		await settle();
		await engine.reject(id);
		expect(wo(id).state).toBe("closed");
	});

	it("closing a PR keeps the branch on GitHub", async () => {
		const id = start({ type: "Chore" });
		await settle();
		cliResult["pr list"] = { code: 0, stdout: '[{"number":7}]' };
		putPr(7);
		exec.finish(threadOf(id), "Done");
		await settle();
		await engine.closePullRequest("fairway", 7);
		expect(wo(id).state).toBe("closed");
		expect(calls.some((c) => c.includes("--delete"))).toBe(false);
	});
});
