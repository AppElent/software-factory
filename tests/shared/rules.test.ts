import { describe, expect, it } from "vitest";
import {
	applyNeverTouch,
	gatesClear,
	gatesPassed,
	mapGates,
	matchesNeverTouch,
	mayMergeAlone,
	mergeBlockers,
	noGates,
	parseReply,
	prGroup,
	qualifies,
	rankQueue,
	snoozeUntil,
	startBlock,
	triageHides,
} from "../../src/shared/rules.ts";
import type { CheckRun, QueueItem } from "../../src/shared/types.ts";

const check = (name: string, bucket: CheckRun["bucket"], workflow: string | null = "CI"): CheckRun => ({
	name,
	bucket,
	workflow,
	url: null,
});

describe("never touch", () => {
	it.each([
		["client-*", { repo: "me/client-work" }, true],
		["client-*", { repo: "me/fairway" }, false],
		["client-*", { path: "/Users/x/Developer/client-work" }, true],
		["CLIENT-*", { repo: "me/client-work" }, true],
		["me/secret", { repo: "me/secret" }, true],
		["me/secret", { repo: "me/secret-two" }, false],
	])("%s against %j is %s", (rule, candidate, expected) => {
		expect(matchesNeverTouch([rule], candidate)).toBe(expected);
	});

	it("splits a list before anything reads it", () => {
		const { kept, skipped } = applyNeverTouch(["client-*"], [{ repo: "me/client-a" }, { repo: "me/fairway" }]);
		expect(kept.map((r) => r.repo)).toEqual(["me/fairway"]);
		expect(skipped).toHaveLength(1);
	});
});

describe("gates", () => {
	it("maps the toolkit's combined check to three gates", () => {
		const g = mapGates([check("check", "pass")]);
		expect(g.Typecheck).toBe("passed");
		expect(g.Tests).toBe("passed");
		expect(g.Lint).toBe("passed");
		expect(g.Preview).toBe("not_set_up");
	});

	it("maps a preview deploy to Preview, and a skipped one to not set up", () => {
		expect(mapGates([check("check", "pass"), check("deploy", "pass", "PR Preview")]).Preview).toBe("passed");
		expect(mapGates([check("check", "pass"), check("deploy", "skipped", "PR Preview")]).Preview).toBe("not_set_up");
	});

	it("a failed check fails its gates", () => {
		expect(mapGates([check("check", "fail")]).Tests).toBe("failed");
	});

	it("not set up doesn't block a clear result, but isn't a pass", () => {
		const g = { ...noGates("passed"), Preview: "not_set_up" as const };
		expect(gatesClear(g)).toBe(true);
		expect(gatesPassed(g)).toBe(true);
		expect(gatesClear(noGates("not_started"))).toBe(false);
	});
});

describe("PR groups", () => {
	const base = {
		gates: noGates("passed"),
		mergeable: "MERGEABLE",
		mergeState: "CLEAN",
		isDraft: false,
		now: Date.parse("2026-11-06T12:00:00Z"),
		updatedAt: "2026-11-06T11:00:00Z",
	};
	it.each([
		["ready", base],
		["stale", { ...base, updatedAt: "2026-09-01T00:00:00Z" }],
		["rebase", { ...base, mergeable: "CONFLICTING" }],
		["rebase", { ...base, mergeState: "BEHIND" }],
		["failed", { ...base, gates: { ...base.gates, Tests: "failed" as const } }],
		["running", { ...base, isDraft: true }],
		["running", { ...base, gates: { ...base.gates, Tests: "running" as const } }],
	])("%s", (group, pr) => {
		expect(prGroup(pr)).toBe(group);
	});

	it("blocks a merge on conflicts, failed gates, and drafts", () => {
		expect(mergeBlockers(base)).toEqual([]);
		expect(mergeBlockers({ ...base, mergeable: "CONFLICTING" }).length).toBeGreaterThan(0);
		expect(mergeBlockers({ ...base, gates: { ...base.gates, Lint: "failed" } }).length).toBeGreaterThan(0);
		expect(mergeBlockers({ ...base, isDraft: true }).length).toBeGreaterThan(0);
	});
});

describe("starting work", () => {
	const base = { stopped: false, agents: 3, build: 0, review: 0, pauseOnReview: false };
	it.each([
		[base, null],
		[{ ...base, build: 3 }, "limit"],
		[{ ...base, stopped: true }, "stopped"],
		[{ ...base, review: 5 }, null],
		[{ ...base, review: 3, pauseOnReview: true }, "review"],
	])("%j → %s", (input, expected) => {
		expect(startBlock(input)).toBe(expected);
	});
});

describe("merge without me", () => {
	const base = {
		on: true,
		projectMerging: "follow" as const,
		gates: noGates("passed"),
		mergeable: "MERGEABLE",
		mergeState: "CLEAN",
		isDraft: false,
	};
	it("needs every gate passed, the setting on, and the project following", () => {
		expect(mayMergeAlone(base)).toBe(true);
		expect(mayMergeAlone({ ...base, on: false })).toBe(false);
		expect(mayMergeAlone({ ...base, projectMerging: "ask" })).toBe(false);
		expect(mayMergeAlone({ ...base, gates: { ...base.gates, Preview: "not_set_up" } })).toBe(false);
		expect(mayMergeAlone({ ...base, mergeable: "CONFLICTING" })).toBe(false);
	});

	it("qualifies only with enough runs, first tries, and no regressions", () => {
		const t = { runs: 10, firstTryPct: 80 };
		expect(qualifies({ runs: 10, firstTry: 8, regressions: 0 }, t)).toBe(true);
		expect(qualifies({ runs: 9, firstTry: 9, regressions: 0 }, t)).toBe(false);
		expect(qualifies({ runs: 10, firstTry: 7, regressions: 0 }, t)).toBe(false);
		expect(qualifies({ runs: 10, firstTry: 10, regressions: 1 }, t)).toBe(false);
	});
});

describe("triage", () => {
	const now = Date.parse("2026-11-06T12:00:00Z");
	const snooze = {
		action: "snooze" as const,
		until: "2026-11-07T09:00:00Z",
		baselineEvents: 10,
		baselineUsers: 2,
		baselineRelease: "1.0",
	};
	it("snooze ends at the time, at 100 events, or on a new release with users", () => {
		expect(triageHides(snooze, { events: 11, users: 2, release: "1.0" }, now)).toBe(true);
		expect(triageHides(snooze, { events: 11, users: 2, release: "1.0" }, Date.parse("2026-11-07T09:00:00Z"))).toBe(false);
		expect(triageHides(snooze, { events: 100, users: 2, release: "1.0" }, now)).toBe(false);
		expect(triageHides(snooze, { events: 11, users: 2, release: "1.1" }, now)).toBe(false);
	});
	it("dismiss returns only when it gets worse", () => {
		const d = { ...snooze, action: "dismiss" as const, until: null };
		expect(triageHides(d, { events: 11, users: 2, release: "9" }, now)).toBe(true);
		expect(triageHides(d, { events: 11, users: 3, release: "1.0" }, now)).toBe(false);
	});
	it("snoozes until tomorrow at 09:00 local", () => {
		const d = snoozeUntil(new Date(2026, 10, 6, 15, 0));
		expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([7, 9, 0]);
	});
});

describe("queue rank", () => {
	const item = (kind: QueueItem["kind"], users = 0, since = "2026-11-06T00:00:00Z", fp = kind): QueueItem => ({
		fingerprint: fp,
		kind,
		project: null,
		projectName: null,
		title: fp,
		meta: "",
		since,
		users,
		href: "",
	});
	it("orders by kind, then users, then oldest", () => {
		const ranked = rankQueue([
			item("ready_pr"),
			item("stale_pr"),
			item("question"),
			item("error", 1, "2026-11-06T00:00:00Z", "small"),
			item("error", 9, "2026-11-06T00:00:00Z", "big"),
			item("red_main"),
			item("failed_gates"),
		]);
		expect(ranked.map((i) => i.fingerprint)).toEqual([
			"big",
			"small",
			"question",
			"red_main",
			"failed_gates",
			"ready_pr",
			"stale_pr",
		]);
	});
});

describe("agent replies", () => {
	it("reads a plan block and strips it from the text", () => {
		const r = parseReply('Here it is.\n```factory-plan\n{"summary":"Do it","steps":["a"]}\n```\nDone.');
		expect(r.plan).toEqual({ summary: "Do it", steps: ["a"] });
		expect(r.text).toContain("Here it is.");
		expect(r.text).not.toContain("factory-plan");
	});
	it("reads a question block", () => {
		const r = parseReply('```factory-question\n{"question":"Which?","options":[{"label":"A"}]}\n```');
		expect(r.question).toEqual({ question: "Which?", options: [{ label: "A" }] });
	});
	it("treats broken JSON as plain text", () => {
		const r = parseReply("```factory-plan\n{nope\n```");
		expect(r.plan).toBeNull();
	});
});
