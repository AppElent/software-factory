import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
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
});
