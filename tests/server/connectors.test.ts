import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { scrub } from "../../src/server/cli.ts";
import {
	cleanLog,
	GithubError,
	readRepos,
	readSecurityUpdates,
	readToolkit,
	turnOnSecurity,
} from "../../src/server/connectors/github.ts";
import { parseDetail, readIssues, SentryError } from "../../src/server/connectors/sentry.ts";
import { parseShow, t3Executor } from "../../src/server/executor/t3.ts";

const fixture = (path: string) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8");
const ok = (stdout: string, code = 0, stderr = "") => ({
	code,
	stdout,
	stderr,
	timedOut: false,
	missing: false,
});
const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("GitHub responses", () => {
	const cli: Cli = async () => ok(fixture("gh/repo-read.json"), 1, "Could not resolve to a Repository");

	it("reads main and PR checks, and keeps other repos when one is gone", async () => {
		const read = await readRepos(cli, ["example-org/gather", "example-org/gone"], NOW);
		expect(read.missing).toEqual(["example-org/gone"]);
		expect(read.rate?.remaining).toBe(4900);
		const [repo] = read.repos;
		expect(repo?.main?.state).toBe("red");
		expect(repo?.main?.failing.map((c) => c.name)).toEqual(["deploy"]);
		const pr = repo?.prs[0];
		expect(pr?.number).toBe(240);
		expect(pr?.mergeable).toBe("CONFLICTING");
		expect(pr?.gates.Typecheck).toBe("passed");
		expect(pr?.gates.Preview).toBe("failed");
		expect(pr?.checks.find((c) => c.name === "cleanup")?.bucket).toBe("skipped");
	});

	it("counts a repo that answers under a new name as missing", async () => {
		const renamed: Cli = async () => ok(fixture("gh/repo-read.json"));
		const read = await readRepos(renamed, ["example-org/old-name"], NOW);
		expect(read.missing).toEqual(["example-org/old-name"]);
		expect(read.repos).toEqual([]);
	});

	it("says when a PR comes from a fork", async () => {
		const fixtureText = fixture("gh/repo-read.json").replaceAll(
			'"isCrossRepository": false',
			'"isCrossRepository": true',
		);
		const read = await readRepos(async () => ok(fixtureText), ["example-org/gather"], NOW);
		const prs = read.repos.flatMap((r) => r.prs);
		expect(prs.length).toBeGreaterThan(0);
		expect(prs.every((p) => p.fromFork)).toBe(true);
	});

	it("reports an unreadable response instead of treating it as no PRs", async () => {
		const broken: Cli = async () => ok("not json", 1, "HTTP 502");
		await expect(readRepos(broken, ["example-org/gather"], NOW)).rejects.toThrow(GithubError);
		const wrong: Cli = async () => ok(JSON.stringify({ data: { r0: { nameWithOwner: 3 } } }));
		await expect(readRepos(wrong, ["example-org/gather"], NOW)).rejects.toThrow(GithubError);
	});

	it("skips anything that isn't owner/name before it reaches the command", async () => {
		const calls: string[][] = [];
		const spy: Cli = async (_cmd, args) => {
			calls.push(args);
			return ok(JSON.stringify({ data: {} }));
		};
		await readRepos(spy, ["bad repo; rm -rf"], NOW);
		expect(calls).toEqual([]);
	});
});

describe("GitHub security", () => {
	const withSecurity = (extra: Record<string, unknown>) => {
		const json = JSON.parse(fixture("gh/repo-read.json"));
		json.data.r0 = { ...json.data.r0, ...extra };
		const cli: Cli = async () => ok(JSON.stringify(json));
		return readRepos(cli, ["example-org/gather"], NOW).then((r) => r.repos[0]?.security);
	};
	const alert = (number: number, severity: string, patched: string | null = "1.2.4") => ({
		number,
		createdAt: "2026-11-01T00:00:00Z",
		vulnerableManifestPath: "pnpm-lock.yaml",
		securityVulnerability: {
			severity,
			package: { name: `pkg-${number}`, ecosystem: "NPM" },
			advisory: { ghsaId: `GHSA-${number}`, summary: "Prototype pollution" },
			firstPatchedVersion: patched ? { identifier: patched } : null,
		},
	});

	it("reads open alerts with GitHub's severities and the setup checklist", async () => {
		const security = await withSecurity({
			hasVulnerabilityAlertsEnabled: true,
			vulnerabilityAlerts: {
				totalCount: 140,
				nodes: [alert(1, "CRITICAL"), alert(2, "MODERATE", null), null],
			},
			dependabotYml: null,
			dependabotYaml: { id: "x" },
			rulesets: {
				nodes: [
					{
						enforcement: "ACTIVE",
						target: "BRANCH",
						conditions: { refName: { include: ["~DEFAULT_BRANCH"] } },
					},
				],
			},
		});
		expect(security?.total).toBe(140);
		expect(security?.alerts.map((a) => [a.severity, a.package, a.ecosystem, a.patched])).toEqual([
			["critical", "pkg-1", "npm", "1.2.4"],
			["moderate", "pkg-2", "npm", null],
		]);
		expect(security?.setup).toEqual({
			alerts: true,
			securityUpdates: null,
			dependabotConfig: true,
			branchProtected: true,
		});
	});

	it("reads off only when GitHub says so, and unknown when it won't answer", async () => {
		const off = await withSecurity({
			hasVulnerabilityAlertsEnabled: false,
			dependabotYml: null,
			dependabotYaml: null,
			rulesets: {
				nodes: [
					{ enforcement: "DISABLED", target: "BRANCH", conditions: { refName: { include: ["~ALL"] } } },
				],
			},
		});
		expect(off?.setup).toMatchObject({ alerts: false, dependabotConfig: false, branchProtected: false });
		const refused = await withSecurity({ vulnerabilityAlerts: null, rulesets: null });
		expect(refused?.setup).toMatchObject({ alerts: null, dependabotConfig: null, branchProtected: null });
		expect(refused?.alerts).toEqual([]);
	});

	it("reads security updates, and turns both on in order", async () => {
		expect(await readSecurityUpdates(async () => ok('{"enabled":true,"paused":false}'), "a/b")).toBe(true);
		expect(await readSecurityUpdates(async () => ok("", 1, "HTTP 403"), "a/b")).toBeNull();
		const calls: string[] = [];
		await turnOnSecurity(
			async (_cmd, args) => {
				calls.push(args.join(" "));
				return ok("");
			},
			"a/b",
			["securityUpdates", "alerts"],
		);
		expect(calls).toEqual([
			"api -X PUT repos/a/b/vulnerability-alerts",
			"api -X PUT repos/a/b/automated-security-fixes",
		]);
		await expect(
			turnOnSecurity(async () => ok("", 1, "HTTP 403: Must have admin rights"), "a/b", ["alerts"]),
		).rejects.toThrow("Must have admin rights");
	});
});

describe("Sentry responses", () => {
	it("reads the issue list", async () => {
		const cli: Cli = async () => ok(fixture("sentry/issue-list.json"));
		const [issue] = await readIssues(cli, "example-org", "foundry");
		expect(issue?.shortId).toBe("FOUNDRY-R");
		expect(issue?.events).toBeGreaterThan(0);
		expect(issue?.level).toBe("fatal");
	});

	it("reports an unexpected response", async () => {
		const cli: Cli = async () => ok(JSON.stringify({ data: [{ id: 1 }] }));
		await expect(readIssues(cli, "example-org", "foundry")).rejects.toThrow(SentryError);
	});

	it("reads the stack with the crashing frame first, including frames with no file", () => {
		const detail = parseDetail(fixture("sentry/issue-view.json"));
		expect(detail.environment).toBe("production");
		expect(detail.release).toBe("foundry@1.0.0");
		expect(detail.stack.length).toBe(4);
		expect(detail.stack[0]?.file).toBeTruthy();
	});
});

describe("T3 responses", () => {
	it("reads a finished thread", () => {
		const state = parseShow(fixture("t3/show-completed.json"));
		expect(state.status).toBe("completed");
		expect(state.branch).toBeTruthy();
		expect(state.lastReply).toBeTruthy();
	});

	it("reads a thread waiting on a native question", () => {
		expect(parseShow(fixture("t3/show-ask.json")).status).toBe("waiting_native");
	});

	it("rejects an unexpected shape", () => {
		expect(() => parseShow(JSON.stringify({ nope: true }))).toThrow(/unexpected/);
	});

	it("sends the prompt on stdin, with a model whenever it names a provider", async () => {
		const calls: Array<{ args: string[]; stdin?: string }> = [];
		const show = fixture("t3/show-completed.json");
		const cli: Cli = async (_c, args, opts) => {
			calls.push({ args, stdin: opts?.stdin });
			if (args[1] === "start") return ok(fixture("t3/start-nowait.json"));
			return ok(show);
		};
		await t3Executor(cli).start({
			projectPath: "/tmp/repo",
			title: "A title",
			baseBranch: "main",
			branch: "factory/wo-1",
			prompt: "--not-a-flag do the thing",
			agent: "codex",
		});
		const start = calls.find((c) => c.args[1] === "start");
		expect(start?.stdin).toBe("--not-a-flag do the thing");
		expect(start?.args).not.toContain("--not-a-flag do the thing");
		expect(start?.args).toContain("--provider");
		expect(start?.args).toContain("--model");
	});

	it("still reports a started thread when the read after it fails", async () => {
		const cli: Cli = async (_cmd, args) => {
			if (args[1] === "start") return ok(JSON.stringify({ threadId: "T1", runId: "r" }));
			if (args[1] === "show") return ok("", 1, "server busy");
			return ok("");
		};
		await expect(
			t3Executor(cli).start({
				projectPath: "/tmp/x",
				title: "t",
				baseBranch: "main",
				branch: "factory/wo-1",
				prompt: "p",
				agent: "claude",
			}),
		).resolves.toEqual({ threadId: "T1", link: null });
	});
});

describe("a failed CI log", () => {
	it("loses the job, the step, the time, and the terminal colours", () => {
		const raw =
			"verify\tRun tests\t2026-11-06T14:38:02.1856700Z \u001b[36;1mpnpm test\u001b[0m\nverify\tRun tests\t2026-11-06T14:38:03.0000000Z not ok 1";
		expect(cleanLog(raw)).toBe("pnpm test\nnot ok 1");
	});
});

describe("t3 thread status", () => {
	it("marks a thread T3 no longer has, but not any other failure", async () => {
		const answer =
			(stderr: string): Cli =>
			async () => ({ code: 1, stdout: "", stderr, timedOut: false, missing: false });
		await expect(t3Executor(answer("Thread X is no longer available.")).status("X")).rejects.toMatchObject({
			gone: true,
		});
		await expect(t3Executor(answer("connection refused")).status("X")).rejects.toMatchObject({ gone: false });
	});
});

describe("scrub", () => {
	it("covers fine-grained GitHub tokens", () => {
		expect(scrub(`x github_pat_${"A1_".repeat(10)} y`)).not.toContain("github_pat_A1");
	});
});

describe("toolkit drift over time", () => {
	it("asks again after an hour, because the toolkit moves on while the pin stays", async () => {
		let ahead = 0;
		const fake: Cli = async (_cmd, args) => ({
			code: 0,
			stdout: args.some((a) => a.includes("/compare/"))
				? JSON.stringify({ ahead_by: ahead, files: [{ filename: "a" }] })
				: JSON.stringify({ commit: { committer: { date: "2026-11-01T00:00:00Z" } } }),
			stderr: "",
			timedOut: false,
			missing: false,
		});
		const cache = new Map();
		const start = Date.parse("2026-11-06T00:00:00Z");
		expect((await readToolkit(fake, "me/app", "abc", cache, start)).status).toBe("current");
		ahead = 5;
		expect((await readToolkit(fake, "me/app", "abc", cache, start + 60_000)).status).toBe("current");
		expect((await readToolkit(fake, "me/app", "abc", cache, start + 61 * 60_000)).status).toBe("behind");
	});
});
