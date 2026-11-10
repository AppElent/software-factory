import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { writeNeverTouch } from "../../src/server/config.ts";
import { openDb } from "../../src/server/db.ts";
import { NewProjects } from "../../src/server/newproject.ts";
import { readItemsForNotify } from "../../src/server/read.ts";
import { Store } from "../../src/server/store.ts";

let dir: string;
let store: Store;
let projects: NewProjects;
let repoExists: boolean;
let ran: string[];
let viewError: string;
const deleted: string[] = [];

const cli: Cli = async (cmd, args) => {
	if (cmd === "gh" && args[1] === "delete") deleted.push(args[2] as string);
	if (cmd === "gh" && args[0] === "api")
		return { code: 0, stdout: "me", stderr: "", timedOut: false, missing: false };
	return {
		code: cmd === "gh" && args[1] === "view" && repoExists ? 0 : 1,
		stdout: "",
		stderr: viewError,
		timedOut: false,
		missing: false,
	};
};

const input = { name: "fresh", template: "node", visibility: "private", description: "A project" } as const;
const readAll = () => readItemsForNotify(store);
const calls = () => deleted;
const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sf-np-"));
	store = new Store(openDb(join(dir, "t.db")), dir, () => new Date("2026-11-06T12:00:00Z"));
	repoExists = false;
	viewError = "GraphQL: Could not resolve to a Repository with the name 'me/fresh'. (repository)";
	ran = [];
	deleted.length = 0;
	projects = new NewProjects({
		store,
		cli,
		publish: () => {},
		addProject: () => "fresh",
		runner: async (_run, step) => {
			ran.push(step);
			return { ok: true };
		},
	});
});

describe("New project never adopts what it didn't make", () => {
	it("refuses a repo or a folder already in use", async () => {
		const folder = join(dir, "fresh");
		expect(await projects.validate("me", "fresh", folder)).toBeNull();
		mkdirSync(folder);
		expect(await projects.validate("me", "fresh", folder)).toBeNull();
		writeFileSync(join(folder, "README.md"), "mine");
		expect(await projects.validate("me", "fresh", folder)).toMatch(/already has files/);
		repoExists = true;
		expect(await projects.validate("me", "fresh", join(dir, "other"))).toMatch(/already has a repo/);
	});

	it("fails the step when the repo appeared after the name was checked, and has nothing to delete", async () => {
		const id = await projects.create(input);
		repoExists = true;
		await projects.scaffold(id);
		const run = projects.get(id);
		expect(run?.step).toBe("failed");
		expect(run?.failure).toMatch(/didn't make it/);
		expect(run?.created).toEqual([]);
		expect(ran).toEqual([]);
	});

	it("fails the step when the folder filled up after the name was checked", async () => {
		const id = await projects.create(input);
		const folder = projects.get(id)?.localPath as string;
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "README.md"), "mine");
		await projects.scaffold(id);
		expect(projects.get(id)?.failure).toMatch(/already has files/);
		expect(projects.get(id)?.created).toEqual(["repo:me/fresh"]);
		rmSync(folder, { recursive: true });
	});

	it("refuses to go on when it can't tell whether the repo exists", async () => {
		const id = await projects.create(input);
		viewError = "error connecting to api.github.com";
		await projects.scaffold(id);
		expect(projects.get(id)?.failure).toMatch(/Couldn't check/);
		expect(ran).toEqual([]);
	});

	it("runs once when approve is pressed twice", async () => {
		const id = await projects.create(input);
		await Promise.all([projects.scaffold(id), projects.scaffold(id)]);
		await settle();
		expect(ran.filter((s) => s === "repo")).toHaveLength(1);
	});

	it("won't remove a project that's already through", async () => {
		const id = await projects.create(input);
		await projects.scaffold(id);
		expect(projects.get(id)?.step).toBe("connect");
		expect((await projects.remove(id)).ok).toBe(false);
	});

	it("stops before any step when a rule was added after the approval", async () => {
		const id = await projects.create(input);
		writeNeverTouch(dir, ["me/fresh"]);
		await projects.scaffold(id);
		expect(ran).toEqual([]);
		expect(projects.get(id)?.step).toBe("failed");
		expect(projects.get(id)?.failure).toMatch(/Never touch/);
		expect((await projects.connect(id, "sentry")).ok).toBe(false);
	});

	it("fails the run when a Never touch rule refuses the project at the end", async () => {
		const refusing = new NewProjects({
			store,
			cli,
			publish: () => {},
			addProject: () => {
				throw new Error("A Never touch rule matches this.");
			},
			runner: async () => ({ ok: true }),
		});
		const id = await refusing.create(input);
		await refusing.scaffold(id);
		expect(refusing.get(id)?.step).toBe("failed");
		expect(refusing.get(id)?.failure).toBe("A Never touch rule matches this.");
	});

	it("finishes removing when the repo was already deleted by hand", async () => {
		const id = await projects.create(input);
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		store.db
			.prepare("UPDATE new_projects SET json = ? WHERE id = ?")
			.run(JSON.stringify({ ...run, step: "failed", created: ["repo:me/fresh"] }), id);
		expect(await projects.remove(id)).toEqual({ ok: true });
		expect(projects.get(id)).toBeFalsy();
	});

	it("deletes nothing when a Never touch rule has come to match it", async () => {
		const id = await projects.create(input);
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		store.db
			.prepare("UPDATE new_projects SET json = ? WHERE id = ?")
			.run(JSON.stringify({ ...run, step: "failed", created: ["repo:me/fresh"] }), id);
		writeNeverTouch(dir, ["me/fresh"]);
		const before = deleted.length;
		expect(readItemsForNotify(store).filter((i) => i.kind === "new_project")).toEqual([]);
		expect(await projects.remove(id)).toEqual({ ok: true });
		expect(deleted).toHaveLength(before);
		expect(projects.get(id)).toBeFalsy();
	});

	it("won't remove a project an agent is still working on", async () => {
		const id = await projects.create(input);
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("fresh", "me/fresh", "fresh", "", "/nope", store.iso());
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		store.db
			.prepare("UPDATE new_projects SET json = ? WHERE id = ?")
			.run(JSON.stringify({ ...run, step: "baseline", projectSlug: "fresh" }), id);
		store.insertWorkOrder({
			project: "fresh",
			type: "Bug fix",
			title: "Fix the red baseline",
			description: "Make it pass.",
			source: { kind: "new_project" },
			agent: "claude",
		});
		expect(await projects.remove(id)).toEqual({
			ok: false,
			reason: "This project has open work orders. Close them first.",
		});
		expect(store.project("fresh")).toBeTruthy();
	});

	it("takes the project off the list when it removes one", async () => {
		const id = await projects.create(input);
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("fresh", "me/fresh", "fresh", "", "/nope", store.iso());
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		store.db
			.prepare("UPDATE new_projects SET json = ? WHERE id = ?")
			.run(JSON.stringify({ ...run, step: "failed", projectSlug: "fresh" }), id);
		expect((await projects.remove(id)).ok).toBe(true);
		expect(store.project("fresh")).toBeFalsy();
	});
});

describe("New project after a restart", () => {
	const again = () =>
		new NewProjects({
			store,
			cli,
			publish: () => {},
			addProject: () => "fresh",
			runner: async (_run, step) => {
				ran.push(step);
				return { ok: true };
			},
		});
	/** Saves a run as a killed service left it: `repo` was running, and the repo was made. */
	const killedDuringRepo = async () => {
		const id = await projects.create(input);
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		run.step = "scaffold";
		run.claimed = ["repo"];
		(run.log[0] as { state: string }).state = "running";
		store.db.prepare("UPDATE new_projects SET json = ? WHERE id = ?").run(JSON.stringify(run), id);
		repoExists = true;
		return id;
	};

	it("hands the stopped run back, with what can be done and nothing deleted", async () => {
		const id = await killedDuringRepo();
		const fresh = again();
		const run = fresh.get(id);
		expect(run?.step).toBe("failed");
		expect(run?.failure).toMatch(/restarted/);
		expect(run?.created).toEqual([]);
		expect((await fresh.remove(id)).ok).toBe(true);
		expect(calls()).toEqual([]);
	});

	it("retries the step it stopped in, without calling its own repo someone else's", async () => {
		const id = await killedDuringRepo();
		const fresh = again();
		await fresh.scaffold(id);
		expect(fresh.get(id)?.step).toBe("connect");
		expect(fresh.get(id)?.created).toContain("repo:me/fresh");
	});

	it("shows on the queue until it's dealt with", async () => {
		const id = await killedDuringRepo();
		again();
		const item = readAll().find((i) => i.kind === "new_project");
		expect(item?.newProject).toEqual({ id, step: "failed" });
		expect(item?.title).toBe("fresh couldn't be built");
	});
});

describe("Skipped services on the queue", () => {
	it("stays under Later, and goes when the project does", async () => {
		const id = await projects.create(input);
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("fresh", "me/fresh", "fresh", "", "/nope", store.iso());
		await projects.scaffold(id);
		const run = projects.get(id) as NonNullable<ReturnType<NewProjects["get"]>>;
		store.db
			.prepare("UPDATE new_projects SET json = ? WHERE id = ?")
			.run(JSON.stringify({ ...run, projectSlug: "fresh" }), id);
		projects.setService(id, "sentry", "skipped");
		const skipped = () => readAll().filter((i) => i.kind === "tool");
		expect(skipped().map((i) => i.title)).toContain("Sentry isn't set up on fresh");
		store.db.prepare("UPDATE projects SET removed_at = ? WHERE slug = 'fresh'").run(store.iso());
		expect(skipped()).toEqual([]);
	});
});

describe("the scaffold script", () => {
	it("says what's missing in a sentence when the service can't find a tool", () => {
		const res = spawnSync(
			process.execPath,
			[
				"scripts/new-project.mjs",
				"--step",
				"repo",
				"--repo",
				"me/fresh",
				"--folder",
				join(tmpdir(), "sf-never"),
				"--template",
				"node",
				"--visibility",
				"private",
				"--description",
				"x",
			],
			{ encoding: "utf8", env: { PATH: "/nonexistent" } },
		);
		expect(res.status).toBe(1);
		expect(res.stderr.trim()).toBe("gh isn't installed, or the service can't find it.");
	});

	it("pushes the first commit on a retry, when that push is what failed", () => {
		const root = mkdtempSync(join(tmpdir(), "sf-template-"));
		const remote = join(root, "remote", "me", "fresh.git");
		mkdirSync(remote, { recursive: true });
		execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: remote, stdio: "pipe" });
		const folder = join(root, "fresh");
		mkdirSync(folder);
		const git = (...args: string[]) =>
			execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], {
				cwd: folder,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		git("init", "-b", "main");
		git("remote", "add", "origin", remote);
		git("commit", "--allow-empty", "-m", "First commit");
		const res = spawnSync(
			process.execPath,
			["scripts/new-project.mjs", "--step", "template", "--repo", "me/fresh", "--folder", folder],
			{ encoding: "utf8", env: { PATH: process.env.PATH } },
		);
		expect(res.stderr).toBe("");
		expect(res.status).toBe(0);
		expect(execFileSync("git", ["rev-parse", "main"], { cwd: remote, encoding: "utf8" }).trim()).toBe(
			git("rev-parse", "HEAD").trim(),
		);
		rmSync(root, { recursive: true, force: true });
	});

	describe("a red baseline", () => {
		const git = (cwd: string, ...args: string[]) =>
			execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});

		const setup = () => {
			const root = mkdtempSync(join(tmpdir(), "sf-baseline-"));
			const remote = join(root, "remote", "me", "fresh.git");
			mkdirSync(remote, { recursive: true });
			git(remote, "init", "--bare", "-b", "main");
			const folder = join(root, "fresh");
			mkdirSync(folder);
			git(folder, "init", "-b", "main");
			git(folder, "remote", "add", "origin", remote);
			writeFileSync(join(folder, ".gitignore"), "node_modules\n");
			writeFileSync(join(folder, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
			git(folder, "add", "-A");
			git(folder, "commit", "-m", "Start");
			git(folder, "push", "-u", "origin", "main");

			const toolkit = join(root, "toolkit");
			mkdirSync(join(toolkit, "scripts"), { recursive: true });
			writeFileSync(join(toolkit, "scripts", "baseline.mjs"), "");
			const bin = join(root, "bin");
			mkdirSync(bin);
			writeFileSync(
				join(bin, "pnpm"),
				'#!/bin/sh\nif [ "$1" = test ] && [ ! -f fixed ]; then echo "1 test failed" >&2; exit 1; fi\nexit 0\n',
			);
			chmodSync(join(bin, "pnpm"), 0o755);

			const baseline = () =>
				spawnSync(
					process.execPath,
					[
						"scripts/new-project.mjs",
						"--step",
						"baseline",
						"--repo",
						"me/fresh",
						"--folder",
						folder,
						"--toolkit",
						toolkit,
					],
					{
						encoding: "utf8",
						env: {
							PATH: `${bin}:${process.env.PATH}`,
							GIT_AUTHOR_NAME: "t",
							GIT_AUTHOR_EMAIL: "t@example.test",
							GIT_COMMITTER_NAME: "t",
							GIT_COMMITTER_EMAIL: "t@example.test",
						},
					},
				);
			return { root, remote, folder, bin, baseline };
		};

		it("pushes on a retry when only the push failed last time", () => {
			const { root, remote, folder, bin, baseline } = setup();
			writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
			git(folder, "remote", "set-url", "--push", "origin", join(root, "nowhere.git"));

			expect(baseline().status).toBe(1);
			expect(git(remote, "ls-tree", "-r", "--name-only", "main")).not.toContain(".github/workflows/ci.yml");

			git(folder, "remote", "set-url", "--push", "origin", remote);
			expect(baseline().status).toBe(0);
			expect(git(remote, "ls-tree", "-r", "--name-only", "main")).toContain(".github/workflows/ci.yml");
			// The `main` ruleset requires a status check named `check`, so the gate job keeps that id.
			expect(git(remote, "show", "main:.github/workflows/ci.yml")).toMatch(/^jobs:\n {2}check:\n/m);
			rmSync(root, { recursive: true, force: true });
		});

		it("still reaches main, so a fix has CI, and passes once the fix has merged", () => {
			const { root, remote, folder, baseline } = setup();

			const red = baseline();
			expect(red.status).toBe(1);
			expect(red.stderr.trim()).toBe("1 test failed");
			expect(git(remote, "ls-tree", "-r", "--name-only", "main")).toContain(".github/workflows/ci.yml");

			// The agent's fix merges on GitHub, while the folder here still has the old main.
			const elsewhere = join(root, "elsewhere");
			git(root, "clone", remote, elsewhere);
			writeFileSync(join(elsewhere, "fixed"), "");
			git(elsewhere, "add", "-A");
			git(elsewhere, "commit", "-m", "Fix it");
			git(elsewhere, "push", "origin", "main");

			const green = baseline();
			expect(green.stderr).toBe("");
			expect(green.status).toBe(0);
			expect(existsSync(join(folder, "fixed"))).toBe(true);
			rmSync(root, { recursive: true, force: true });
		});
	});
});
