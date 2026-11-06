import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { GithubError, readRepos } from "../../src/server/connectors/github.ts";
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
});
