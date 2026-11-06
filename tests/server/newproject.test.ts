import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { openDb } from "../../src/server/db.ts";
import { NewProjects } from "../../src/server/newproject.ts";
import { Store } from "../../src/server/store.ts";

let dir: string;
let store: Store;
let projects: NewProjects;
let repoExists: boolean;
let ran: string[];

const cli: Cli = async (cmd, args) => {
	if (cmd === "gh" && args[0] === "api")
		return { code: 0, stdout: "me", stderr: "", timedOut: false, missing: false };
	return {
		code: cmd === "gh" && args[1] === "view" && repoExists ? 0 : 1,
		stdout: "",
		stderr: "",
		timedOut: false,
		missing: false,
	};
};

const input = { name: "fresh", template: "node", visibility: "private", description: "A project" } as const;
const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sf-np-"));
	store = new Store(openDb(join(dir, "t.db")), dir, () => new Date("2026-11-06T12:00:00Z"));
	repoExists = false;
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
