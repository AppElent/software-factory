import { describe, expect, it } from "vitest";
import {
	allFourPassed,
	applyNeverTouch,
	delimit,
	gatesClear,
	gatesPassed,
	isRegression,
	mapGates,
	matchesNeverTouch,
	mayMergeAlone,
	mergeBlockers,
	noGates,
	originIs,
	parseReply,
	prGroup,
	qualifies,
	REGRESSION_GRACE_MS,
	rankQueue,
	securityOf,
	snoozeUntil,
	startBlock,
	suspectRanges,
	triageHides,
} from "../../src/shared/rules.ts";
import type { CheckRun, QueueItem } from "../../src/shared/types.ts";

const check = (name: string, bucket: CheckRun["bucket"], workflow: string | null = "CI"): CheckRun => ({
	name,
	bucket,
	workflow,
	url: null,
});

describe("a job's name as proof", () => {
	it("doesn't take a build or a spell check for typecheck, tests, and lint", () => {
		for (const name of ["build", "EAS Build", "Spell check", "Link check", "docs / verify docs"]) {
			const g = mapGates([check(name, "pass")]);
			expect(g.Tests, name).toBe("not_set_up");
			expect(allFourPassed({ ...g, Preview: "passed" }), name).toBe(false);
		}
	});

	it("takes the toolkit's one job for all three", () => {
		for (const name of ["check", "verify", "ci", "CI / check"]) {
			const g = mapGates([check(name, "pass")]);
			expect([g.Typecheck, g.Tests, g.Lint], name).toEqual(["passed", "passed", "passed"]);
		}
	});

	it("knows a checkout by its origin, not by a name that contains it", () => {
		expect(originIs("git@github.com:me/fairway.git\n", "me/fairway")).toBe(true);
		expect(originIs("https://github.com/Me/Fairway/", "me/fairway")).toBe(true);
		expect(originIs("https://github.com/me/fairway-old.git", "me/fairway")).toBe(false);
		expect(originIs("https://github.com/notme/fairway.git", "me/fairway")).toBe(false);
	});
});

describe("checks with no gate of their own", () => {
	it("counts a failing or running one against Tests, and ignores a passing one", () => {
		expect(mapGates([check("CodeQL", "fail")]).Tests).toBe("failed");
		expect(mapGates([check("CodeQL", "running")]).Tests).toBe("running");
		expect(mapGates([check("CodeQL", "pass")]).Tests).toBe("not_set_up");
		expect(mapGates([check("pytest", "pass")]).Tests).toBe("passed");
	});

	it("reads running checks as running, though GitHub says UNSTABLE while they run", () => {
		const pr = {
			isDraft: false,
			gates: { ...noGates("passed"), Tests: "running" as const },
			mergeable: "MERGEABLE",
			mergeState: "UNSTABLE",
			updatedAt: "2026-11-06T00:00:00Z",
			now: Date.parse("2026-11-06T12:00:00Z"),
		};
		expect(prGroup(pr)).toBe("running");
		expect(mergeBlockers(pr)).toEqual(["Gates are still running."]);
	});

	it("doesn't call an UNSTABLE merge state ready, whatever the gates say", () => {
		const pr = { isDraft: false, gates: noGates("passed"), mergeable: "MERGEABLE", mergeState: "UNSTABLE" };
		expect(prGroup(pr as never)).toBe("failed");
		expect(mergeBlockers(pr as never).join()).toMatch(/isn't passing/);
	});
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
		const { kept, skipped } = applyNeverTouch(
			["client-*"],
			[{ repo: "me/client-a" }, { repo: "me/fairway" }],
		);
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
		expect(mapGates([check("check", "pass"), check("deploy", "skipped", "PR Preview")]).Preview).toBe(
			"not_set_up",
		);
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

describe("never touch, by rule shape", () => {
	const path = "/Users/me/Developer/Secret/app";
	it.each([
		"Secret",
		"Secret/",
		"secret*",
		"~/Developer/Secret",
		"~/Developer/Secret/",
		"~/Developer/Secret/*",
		"/Users/me/Developer/Secret",
		"/Users/me/Developer/Secret/",
		"/Users/me/Developer/Secret/*",
		"Developer/Secret",
		"*/Secret/*",
	])("%s covers a folder and everything beneath it", (rule) => {
		expect(matchesNeverTouch([rule], { repo: "me/app", path })).toBe(true);
		expect(matchesNeverTouch([rule], { path: `${path}/deep/er/` })).toBe(true);
	});
	it.each(["/Users/me/Developer/Sec", "~/Developer/Other", "Secre", "Developer/Other"])(
		"%s leaves the folder alone",
		(rule) => {
			expect(matchesNeverTouch([rule], { path })).toBe(false);
		},
	);
	it("can't be walked around with dots", () => {
		expect(matchesNeverTouch(["/a/Secret"], { path: "/a/x/../Secret/./app" })).toBe(true);
		expect(matchesNeverTouch(["/a/Secret"], { path: "/a/Secret/../Open" })).toBe(false);
	});
	it("still reads a trailing slash on a repo rule", () => {
		expect(matchesNeverTouch(["Secret/"], { repo: "me/Secret" })).toBe(true);
	});
});

describe("regressions", () => {
	const merged = "2026-11-06T12:00:00Z";
	const past = (ms: number) => new Date(Date.parse(merged) + ms).toISOString();
	it("ignores events inside the grace period", () => {
		expect(isRegression({ lastSeen: past(60_000) }, { mergedAt: merged })).toBe(false);
		expect(isRegression({ lastSeen: past(REGRESSION_GRACE_MS + 1) }, { mergedAt: merged })).toBe(true);
	});
	it("treats the release that had the bug as an old build, when both are known", () => {
		const late = past(REGRESSION_GRACE_MS + 1);
		const fix = { mergedAt: merged, release: "1.4.2" };
		expect(isRegression({ lastSeen: late, release: "1.4.2" }, fix)).toBe(false);
		expect(isRegression({ lastSeen: late, release: "1.4.3" }, fix)).toBe(true);
		expect(isRegression({ lastSeen: late, release: null }, fix)).toBe(true);
	});
	it("needs a merged fix", () => {
		expect(isRegression({ lastSeen: past(1) }, null)).toBe(false);
		expect(isRegression({ lastSeen: past(1) }, { mergedAt: null })).toBe(false);
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
		hold: false,
		sourceKind: "person",
	};
	it("needs every gate passed, the setting on, and the project following", () => {
		expect(mayMergeAlone(base)).toBe(true);
		expect(mayMergeAlone({ ...base, hold: true })).toBe(false);
		expect(mayMergeAlone({ ...base, sourceKind: "rebase_pr" })).toBe(false);
		expect(mayMergeAlone({ ...base, sourceKind: "restored" })).toBe(false);
		expect(mayMergeAlone({ ...base, unreadIssue: true })).toBe(false);
		expect(mayMergeAlone({ ...base, sourceKind: "pr_changes" })).toBe(false);
		expect(mayMergeAlone({ ...base, mergeState: "UNSTABLE" })).toBe(false);
		expect(mayMergeAlone({ ...base, mergeState: "BLOCKED" })).toBe(false);
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
		expect(
			triageHides(snooze, { events: 11, users: 2, release: "1.0" }, Date.parse("2026-11-07T09:00:00Z")),
		).toBe(false);
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
	const item = (
		kind: QueueItem["kind"],
		users = 0,
		since = "2026-11-06T00:00:00Z",
		fp: string = kind,
	): QueueItem => ({
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

describe("a Never touch rule pasted as a URL", () => {
	it.each([
		"https://github.com/me/x",
		"https://github.com/me/x/",
		"https://github.com/me/x.git",
		"github.com/me/x",
		"git@github.com:me/x.git",
		"ssh://git@github.com/me/x.git",
		"me/x.git",
	])("%s counts as the repo", (rule) => {
		expect(matchesNeverTouch([rule], { repo: "me/x" })).toBe(true);
		expect(matchesNeverTouch([rule], { repo: "me/x-2" })).toBe(false);
	});

	it("leaves a folder rule as it is", () => {
		expect(matchesNeverTouch(["/work/x.git"], { repo: "me/x", path: "/work/x" })).toBe(false);
	});
});

describe("text from outside", () => {
	it("marks characters a person can't see", () => {
		const tag = String.fromCodePoint(0xe0069, 0xe0067);
		for (const hidden of [tag, "\u00AD", "\u2066", "\u200B"])
			expect(new Set(suspectRanges(`Login is broken.${hidden}`).map((r) => r.why))).toEqual(
				new Set(["hidden"]),
			);
	});

	it("doesn't pass them on to an agent", () => {
		const tag = String.fromCodePoint(0xe0069, 0xe0067);
		const out = delimit("issue", `a${tag}\u00AD\u2066b\u001b[201~c\rd`);
		expect(out).toContain("ab[201~c\nd");
	});
});

describe("securityOf", () => {
	const NOW = Date.parse("2026-11-09T12:00:00Z");
	const DAY = 86_400_000;
	const alert = (number: number, severity: "critical" | "high" | "moderate" | "low", daysOld: number) => ({
		number,
		severity,
		package: `pkg-${number}`,
		ecosystem: "npm",
		summary: "",
		ghsaId: `GHSA-${number}`,
		patched: "1.0.1",
		manifest: null,
		createdAt: new Date(NOW - daysOld * DAY).toISOString(),
	});
	const setup = { alerts: true, securityUpdates: true, dependabotConfig: true, branchProtected: true };
	const deadlines = { critical: 0, high: 7, moderate: null, low: null };
	const url = "https://github.com/example-org/gather";

	it("is unknown before a read, and green when clear and set up", () => {
		expect(securityOf(null, deadlines, NOW, url).status).toBe("unknown");
		expect(securityOf({ alerts: [], total: 0, setup }, deadlines, NOW, url).status).toBe("green");
	});

	it("turns red once an alert passes its deadline, and puts it first", () => {
		const s = securityOf(
			{ alerts: [alert(1, "low", 90), alert(2, "high", 3), alert(3, "high", 8)], total: 3, setup },
			deadlines,
			NOW,
			url,
		);
		expect(s.status).toBe("red");
		expect(s.overdue).toBe(1);
		expect(s.alerts.map((a) => a.number)).toEqual([3, 2, 1]);
		expect(s.alerts[0]?.url).toBe(`${url}/security/dependabot/3`);
		expect(s.alerts[2]?.dueAt).toBeNull();
		expect(s.counts).toEqual({ critical: 0, high: 2, moderate: 0, low: 1 });
	});

	it("is amber for alerts inside their deadline, or a missing setup item, and never counts unknown as missing", () => {
		expect(securityOf({ alerts: [alert(1, "high", 1)], total: 1, setup }, deadlines, NOW, url).status).toBe(
			"amber",
		);
		const gaps = securityOf(
			{ alerts: [], total: 0, setup: { ...setup, dependabotConfig: false, branchProtected: null } },
			deadlines,
			NOW,
			url,
		);
		expect(gaps.status).toBe("amber");
		expect(gaps.missing).toEqual(["dependabotConfig"]);
	});

	it("is unknown, never green, when GitHub wouldn't list alerts", () => {
		expect(securityOf({ alerts: [], total: 0, setup, unread: true }, deadlines, NOW, url).status).toBe(
			"unknown",
		);
		const kept = securityOf(
			{ alerts: [alert(1, "critical", 3)], total: 1, setup, unread: true },
			deadlines,
			NOW,
			url,
		);
		expect(kept.status).toBe("red");
	});

	it("keeps GitHub's total past the alerts it read", () => {
		expect(securityOf({ alerts: [alert(1, "low", 1)], total: 140, setup }, deadlines, NOW, url).total).toBe(
			140,
		);
	});

	it("ranks security after red main in Needs you, and setup after toolkit in Later", () => {
		const item = (kind: QueueItem["kind"], id: string): QueueItem => ({
			fingerprint: id,
			kind,
			project: null,
			projectName: null,
			title: id,
			meta: "",
			since: "2026-11-09T00:00:00Z",
			users: 0,
			href: "",
		});
		const ranked = rankQueue([
			item("security_setup", "s"),
			item("toolkit", "t"),
			item("security", "x"),
			item("red_main", "r"),
		]);
		expect(ranked.map((i) => i.fingerprint)).toEqual(["r", "x", "t", "s"]);
	});
});
