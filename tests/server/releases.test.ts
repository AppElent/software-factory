import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { type GuardRequest, privateHits, privateTerms, Releases } from "../../src/server/releases.ts";
import type { VersionInfo } from "../../src/shared/types.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const row = (sha: string, state: VersionInfo["state"], at = "2026-11-01T00:00:00.000Z"): VersionInfo => ({
	sha,
	label: sha.slice(0, 7),
	message: `commit ${sha.slice(0, 1)}`,
	state,
	error: null,
	at,
	canRollBack: false,
});

let base: string;
let dir: string;
let head: string;
let checkRuns: Array<{ status: string; conclusion: string | null }>;
let totalRuns: number | null;
let onChecks: (() => void) | null;
let status: { state: string; total_count: number };
let committed: string;
let failing: string | null;
let calls: string[];
let guards: GuardRequest[];
let exits: number;
let smoke: (d: string, sha: string) => Promise<void>;
let busy: string | null;

const cli: Cli = async (cmd, args) => {
	const line = [cmd, ...args].join(" ");
	calls.push(line);
	const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
	if (failing && line.startsWith(failing))
		return { code: 1, stdout: "", stderr: "tsc found 2 errors", timedOut: false, missing: false };
	if (line.endsWith("/commits/HEAD"))
		return ok(
			JSON.stringify({
				sha: head,
				commit: { message: "Add a filter (#48)\n\nLonger text", committer: { date: committed } },
			}),
		);
	if (line.endsWith("/check-runs?per_page=100")) {
		onChecks?.();
		return ok(JSON.stringify({ check_runs: checkRuns, total_count: totalRuns ?? checkRuns.length }));
	}
	if (line.endsWith("/status")) return ok(JSON.stringify(status));
	if (line.startsWith("git remote")) return ok("https://github.com/me/software-factory.git\n");
	if (line.startsWith("git clone")) mkdirSync(args.at(-1) as string, { recursive: true });
	return ok();
};

const make = (sha: string | null) => {
	if (sha) mkdirSync(join(dir, sha), { recursive: true });
	return new Releases({
		root: sha ? join(dir, sha) : join(base, "checkout"),
		dir,
		repo: "me/software-factory",
		port: 4310,
		serviceLabel: "test.label",
		cli,
		publish: () => {},
		smoke: (d, s) => smoke(d, s),
		guard: (r) => guards.push(r),
		exit: () => {
			exits += 1;
		},
		busy: () => busy,
	});
};
const seed = (rows: VersionInfo[]) => writeFileSync(join(dir, "versions.json"), JSON.stringify(rows));
const saved = (): VersionInfo[] => JSON.parse(readFileSync(join(dir, "versions.json"), "utf8"));

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "sf-rel-")));
	dir = join(base, "releases");
	mkdirSync(dir);
	mkdirSync(join(base, "checkout"));
	head = B;
	checkRuns = [{ status: "completed", conclusion: "success" }];
	totalRuns = null;
	onChecks = null;
	status = { state: "pending", total_count: 0 };
	committed = "2026-01-01T00:00:00Z";
	failing = null;
	calls = [];
	guards = [];
	exits = 0;
	busy = null;
	smoke = async () => {};
});
afterEach(() => {
	vi.useRealTimers();
	rmSync(base, { recursive: true, force: true });
});

describe("checkout or version folder", () => {
	it("a checkout has nothing to switch, and never looks", async () => {
		const r = make(null);
		expect(r.view().mode).toBe("checkout");
		expect(r.view().running).toBeNull();
		await r.check();
		expect(calls).toEqual([]);
		await expect(r.activate(A)).rejects.toThrow(/checkout/);
	});

	it("a version folder knows what it runs", () => {
		seed([row(A, "running")]);
		const r = make(A);
		expect(r.view().mode).toBe("release");
		expect(r.view().running).toMatchObject({ sha: A, label: "aaaaaaa", message: "commit a" });
	});
});

describe("getting a version ready", () => {
	it("builds a new commit in its own folder, and doesn't switch to it", async () => {
		seed([row(A, "running")]);
		const r = make(A);
		await r.check();
		expect(saved()[0]).toMatchObject({ sha: B, state: "ready", message: "Add a filter (#48)" });
		expect(existsSync(join(dir, B))).toBe(true);
		expect(existsSync(join(dir, `.tmp-${B}`))).toBe(false);
		expect(calls).toContain(`pnpm install --frozen-lockfile`);
		expect(calls).toContain("pnpm build");
		expect(guards).toEqual([]);
		expect(exits).toBe(0);
	});

	it("smoke tests the finished folder", async () => {
		seed([row(A, "running")]);
		const seen: string[] = [];
		smoke = async (d, sha) => {
			seen.push(d, sha);
		};
		await make(A).check();
		expect(seen).toEqual([join(dir, B), B]);
	});

	it("does nothing when it already runs the newest commit", async () => {
		head = A;
		seed([row(A, "running")]);
		await make(A).check();
		expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
		expect(saved()).toHaveLength(1);
	});

	it.each([
		["failed", { status: "completed", conclusion: "failure" }],
		["unfinished", { status: "in_progress", conclusion: null }],
	])("waits when the commit's checks are %s", async (_, run) => {
		checkRuns = [run];
		seed([row(A, "running")]);
		await make(A).check();
		expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
		expect(saved()).toHaveLength(1);
	});

	it("gives a new commit a few minutes to get its checks", async () => {
		checkRuns = [];
		committed = new Date(Date.now() - 60_000).toISOString();
		seed([row(A, "running")]);
		await make(A).check();
		expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
	});

	it.each([
		["failing", { state: "failure", total_count: 1 }],
		["pending", { state: "pending", total_count: 1 }],
	])("waits on a %s commit status too", async (_, s) => {
		checkRuns = [];
		status = s;
		seed([row(A, "running")]);
		await make(A).check();
		expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
	});

	it("goes ahead on a repo with no checks", async () => {
		checkRuns = [];
		seed([row(A, "running")]);
		await make(A).check();
		expect(saved()[0]).toMatchObject({ sha: B, state: "ready" });
	});

	it("records a failed build, removes its folder, and doesn't try the same commit again", async () => {
		failing = "pnpm build";
		seed([row(A, "running")]);
		const r = make(A);
		await r.check();
		expect(saved()[0]).toMatchObject({ sha: B, state: "failed" });
		expect(saved()[0]?.error).toMatch(/Build failed\. tsc found 2 errors/);
		expect(existsSync(join(dir, `.tmp-${B}`))).toBe(false);
		calls = [];
		await r.check();
		expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
	});

	it("tries a failed commit again when you ask", async () => {
		failing = "pnpm build";
		seed([row(A, "running")]);
		const r = make(A);
		await r.check();
		failing = null;
		await r.check();
		expect(saved()[0]?.state).toBe("failed");
		await r.check(true);
		expect(saved()[0]).toMatchObject({ sha: B, state: "ready", error: null });
	});

	it("a version that fails its smoke test is never offered", async () => {
		smoke = async () => {
			throw new Error("It answered 500 and 500.");
		};
		seed([row(A, "running")]);
		await make(A).check();
		expect(saved()[0]).toMatchObject({ sha: B, state: "failed", error: "It answered 500 and 500." });
		expect(existsSync(join(dir, B))).toBe(false);
	});

	it("says when GitHub can't be read", async () => {
		failing = "gh api repos/me/software-factory/commits/HEAD";
		seed([row(A, "running")]);
		const r = make(A);
		await r.check();
		expect(r.view().checkError).toMatch(/tsc found/);
	});

	it("replaces a ready version nobody switched to", async () => {
		seed([row(B, "ready"), row(A, "running")]);
		mkdirSync(join(dir, B));
		head = C;
		await make(A).check();
		expect(saved().map((v) => [v.sha, v.state])).toEqual([
			[C, "ready"],
			[A, "running"],
		]);
		expect(existsSync(join(dir, B))).toBe(false);
	});

	it("a restart mid-build gets a new try", async () => {
		seed([row(B, "preparing"), row(A, "running")]);
		mkdirSync(join(dir, `.tmp-${B}`));
		const r = make(A);
		r.start();
		r.stop();
		await r.done;
		expect(saved()[0]).toMatchObject({ sha: B, state: "ready" });
		expect(existsSync(join(dir, `.tmp-${B}`))).toBe(false);
	});

	it("keeps the two newest to go back to, whatever the list order", async () => {
		const old = ["1", "2", "3"].map((n) => n.repeat(40));
		seed([
			row(old[0] as string, "replaced", "2026-10-01T00:00:00.000Z"),
			row(old[1] as string, "replaced", "2026-10-03T00:00:00.000Z"),
			row(old[2] as string, "replaced", "2026-10-02T00:00:00.000Z"),
			row(A, "running"),
		]);
		for (const s of old) mkdirSync(join(dir, s));
		await make(A).check();
		expect(existsSync(join(dir, old[0] as string))).toBe(false);
		expect(existsSync(join(dir, old[1] as string))).toBe(true);
		expect(existsSync(join(dir, old[2] as string))).toBe(true);
		expect(existsSync(join(dir, A))).toBe(true);
		expect(existsSync(join(dir, B))).toBe(true);
	});
});

describe("switching", () => {
	const ready = () => {
		seed([row(B, "ready"), row(A, "running")]);
		mkdirSync(join(dir, B));
		symlinkSync(A, join(dir, "current"));
	};

	it("moves current, starts the guard, then exits after the answer is sent", async () => {
		vi.useFakeTimers();
		ready();
		const r = make(A);
		await r.activate(B);
		expect(readlinkSync(join(dir, "current"))).toBe(B);
		expect(guards[0]).toMatchObject({ to: B, from: A, port: 4310, dir });
		expect(guards[0]?.kick.join(" ")).toMatch(/launchctl kickstart -k gui\/\d+\/test\.label/);
		expect(saved().find((v) => v.sha === A)?.state).toBe("replaced");
		expect(saved().find((v) => v.sha === B)?.state).toBe("running");
		expect(exits).toBe(0);
		vi.advanceTimersByTime(400);
		expect(exits).toBe(1);
	});

	it("reads the checks again before going forward", async () => {
		ready();
		checkRuns = [{ status: "completed", conclusion: "failure" }];
		await expect(make(A).activate(B)).rejects.toThrow(/aren't green/);
		expect(readlinkSync(join(dir, "current"))).toBe(A);
		expect(guards).toEqual([]);
	});

	it("doesn't switch when it can't read the checks", async () => {
		ready();
		failing = "gh api repos/me/software-factory/commits";
		await expect(make(A).activate(B)).rejects.toThrow(/Couldn't read/);
		expect(readlinkSync(join(dir, "current"))).toBe(A);
	});

	it("going back doesn't depend on GitHub", async () => {
		vi.useFakeTimers();
		seed([row(B, "replaced"), row(A, "running")]);
		mkdirSync(join(dir, B));
		symlinkSync(A, join(dir, "current"));
		failing = "gh api";
		await make(A).activate(B);
		expect(readlinkSync(join(dir, "current"))).toBe(B);
		vi.advanceTimersByTime(400);
	});

	it("never drops what runs from a long history", async () => {
		const many = Array.from({ length: 20 }, (_, i) => row(String(i).padStart(40, "0"), "failed"));
		seed([...many, row(A, "running")]);
		await make(A).check();
		expect(saved().find((v) => v.sha === A)?.state).toBe("running");
		expect(saved().length).toBeLessThan(22);
	});

	it("refuses during a deploy, and leaves everything alone", async () => {
		ready();
		busy = "A deploy is running.";
		await expect(make(A).activate(B)).rejects.toThrow("A deploy is running.");
		expect(readlinkSync(join(dir, "current"))).toBe(A);
		expect(guards).toEqual([]);
		expect(saved().find((v) => v.sha === B)?.state).toBe("ready");
	});

	it.each([
		["running", A, /already running/],
		["unknown", C, /isn't ready/],
	])("refuses a version that's %s", async (_, sha, why) => {
		ready();
		await expect(make(A).activate(sha)).rejects.toThrow(why);
		expect(guards).toEqual([]);
	});

	it("refuses a failed version, and one whose folder is gone", async () => {
		seed([row(B, "failed"), row(C, "replaced"), row(A, "running")]);
		mkdirSync(join(dir, B));
		const r = make(A);
		await expect(r.activate(B)).rejects.toThrow(/isn't ready/);
		await expect(r.activate(C)).rejects.toThrow(/isn't ready/);
	});

	it("offers a way back only to a folder that's still there", () => {
		seed([row(B, "replaced"), row(C, "replaced"), row(A, "running")]);
		mkdirSync(join(dir, B));
		const view = make(A).view();
		expect(view.history.find((v) => v.sha === B)?.canRollBack).toBe(true);
		expect(view.history.find((v) => v.sha === C)?.canRollBack).toBe(false);
		expect(view.history.find((v) => v.sha === A)?.canRollBack).toBe(false);
	});
});

describe("the guard", () => {
	let server: Server | null = null;
	const serve = (sha: string, page = 200) =>
		new Promise<number>((done) => {
			server = createServer((req, res) => {
				res.statusCode = req.url === "/" ? page : 200;
				res.end(req.url === "/" ? "ok" : JSON.stringify({ sha }));
			}).listen(0, "127.0.0.1", () => {
				const a = server?.address();
				done(a && typeof a === "object" ? a.port : 0);
			});
		});
	const run = (req: Partial<GuardRequest>) =>
		new Promise<number | null>((done) => {
			const script = resolve("scripts/update-guard.mjs");
			spawn(process.execPath, [script, JSON.stringify(req)], { stdio: "ignore" }).on("exit", done);
		});
	const setUp = () => {
		seed([row(B, "running"), row(A, "replaced")]);
		symlinkSync(B, join(dir, "current"));
	};
	const kickFile = () => join(base, "kicked");
	const request = (port: number): GuardRequest => ({
		port,
		to: B,
		from: A,
		dir,
		kick: ["touch", kickFile()],
		waitMs: 600,
		everyMs: 100,
	});

	afterEach(() => {
		server?.close();
		server = null;
	});

	it("leaves a healthy new version alone", async () => {
		setUp();
		expect(await run(request(await serve(B)))).toBe(0);
		expect(readlinkSync(join(dir, "current"))).toBe(B);
		expect(saved().find((v) => v.sha === B)?.state).toBe("running");
		expect(existsSync(kickFile())).toBe(false);
	});

	it.each([
		["the old version still answers", A, 200],
		["the page fails", B, 500],
	])("goes back when %s", async (_, sha, page) => {
		setUp();
		await run(request(await serve(sha, page)));
		expect(readlinkSync(join(dir, "current"))).toBe(A);
		expect(saved().find((v) => v.sha === B)).toMatchObject({ state: "failed" });
		expect(saved().find((v) => v.sha === B)?.error).toMatch(/went back/);
		expect(saved().find((v) => v.sha === A)?.state).toBe("running");
		expect(existsSync(kickFile())).toBe(true);
	});

	it("goes back when nothing answers at all", async () => {
		setUp();
		await run(request(1));
		expect(readlinkSync(join(dir, "current"))).toBe(A);
		expect(existsSync(kickFile())).toBe(true);
	});
});

describe("what's on disk wins", () => {
	it("corrects the list after a crash between moving current and saving", () => {
		seed([row(B, "ready"), row(A, "running")]);
		const r = make(B);
		r.start();
		r.stop();
		expect(saved().find((v) => v.sha === B)?.state).toBe("running");
		expect(saved().find((v) => v.sha === A)?.state).toBe("replaced");
	});

	it("doesn't count a commit with more checks than one page shows", async () => {
		seed([row(B, "ready"), row(A, "running")]);
		mkdirSync(join(dir, B));
		symlinkSync(A, join(dir, "current"));
		totalRuns = 101;
		await expect(make(A).activate(B)).rejects.toThrow(/aren't green/);
	});

	it("stops if the version went away while its checks were read", async () => {
		seed([row(B, "ready"), row(A, "running")]);
		mkdirSync(join(dir, B));
		symlinkSync(A, join(dir, "current"));
		onChecks = () => rmSync(join(dir, B), { recursive: true });
		await expect(make(A).activate(B)).rejects.toThrow(/isn't ready/);
		expect(readlinkSync(join(dir, "current"))).toBe(A);
		expect(guards).toEqual([]);
	});

	it("stops if a deploy started while its checks were read", async () => {
		seed([row(B, "ready"), row(A, "running")]);
		mkdirSync(join(dir, B));
		symlinkSync(A, join(dir, "current"));
		onChecks = () => {
			busy = "A deploy is running.";
		};
		await expect(make(A).activate(B)).rejects.toThrow(/deploy is running/);
		expect(readlinkSync(join(dir, "current"))).toBe(A);
	});
});

describe("private names", () => {
	const terms = privateTerms({
		privateProjects: [{ name: "Secret Client", repo: "me/secret-client" }],
		neverTouch: ["acme-*", "*/internal-tools"],
		home: "/Users/someone",
		email: "someone@example.com",
	});

	it.each([
		"Fix the bug in secret-client",
		"it broke for SECRET CLIENT",
		"see acme",
		"acmesomething",
		"the acme_portal repo",
		"in secret-client_v2",
		"in internal-tools",
		"the file at /Users/someone/x",
		"mail someone@example.com",
		"ask someone",
	])("finds it in %s", (text) => {
		expect(privateHits(text, terms).length).toBeGreaterThan(0);
	});

	it.each(["Filter the Issues screen", "client secrets are hidden", "somebody else"])(
		"finds nothing in %s",
		(text) => {
			expect(privateHits(text, terms)).toEqual([]);
		},
	);

	it.each([
		["~/Developer/acme", "the acme portal", "for every developer"],
		["/Users/someone/work/clients/acme", "the acme portal", "the network"],
		["acme-*-portal", "the acme bug", "nothing here"],
		["acme-*-portal", "the portal", "nothing here"],
		["acme/secretrepo", "the acme bug", "nothing here"],
	])("reads the rule %s as finding %s but not %s", (rule, hit, miss) => {
		const t = privateTerms({
			privateProjects: [],
			neverTouch: [rule],
			home: "/Users/someone",
			cloneFolder: "/Users/someone/Developer",
			email: null,
		});
		expect(privateHits(hit, t).length).toBeGreaterThan(0);
		expect(privateHits(miss, t)).toEqual([]);
	});

	it("leaves out terms too short to mean anything", () => {
		const short = privateTerms({
			privateProjects: [{ name: "ab", repo: "me/ab" }],
			neverTouch: ["*"],
			home: "/x",
			email: null,
		});
		expect(short).toEqual([]);
	});
});
