import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cli } from "../../src/server/cli.ts";
import { kvSet, openDb } from "../../src/server/db.ts";
import { Engine } from "../../src/server/engine.ts";
import { FakeExecutor } from "../../src/server/executor/fake.ts";
import { Poller } from "../../src/server/poller.ts";
import { Store } from "../../src/server/store.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const ok = (stdout: string, code = 0, stderr = "") => ({
	code,
	stdout,
	stderr,
	timedOut: false,
	missing: false,
});

let dir: string;
let store: Store;
let poller: Poller;
let calls: string[];
let badProject: string | null;

const cli: Cli = async (cmd, args) => {
	const line = `${cmd} ${args.join(" ")}`;
	calls.push(line);
	if (cmd === "gh" && args[0] === "api") return ok(JSON.stringify({ data: {} }));
	if (cmd === "sentry" && args[0] === "org") return ok(JSON.stringify([{ slug: "acme" }]));
	if (cmd === "sentry" && args[0] === "issue" && args[1] === "list") {
		if (badProject && args[2]?.endsWith(`/${badProject}`)) return ok("", 1, "Project not found: 404");
		return ok(fixture("sentry/issue-list.json"));
	}
	if (cmd === "sentry" && args[0] === "issue" && args[1] === "view")
		return ok(fixture("sentry/issue-view.json"));
	return ok("");
};

const addProject = (slug: string, sentry: string) =>
	store.db
		.prepare(
			"INSERT INTO projects (slug, repo, name, url, local_path, added_at, sentry_project) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(slug, `me/${slug}`, slug, "", "/tmp", store.iso(), sentry);

const health = (source: string) => store.health().find((h) => h.source === source);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sf-poll-"));
	store = new Store(openDb(join(dir, "t.db")), dir);
	calls = [];
	badProject = null;
	kvSet(store.db, "sentry_projects", ["good", "typo"]);
	const engine = new Engine({
		store,
		cli,
		executor: new FakeExecutor(),
		publish: () => {},
		pollSoon: () => {},
		git: async () => {},
	});
	poller = new Poller({
		store,
		cli,
		engine: () => engine,
		publish: () => {},
		onRegression: () => {},
		onRead: () => {},
	});
});

describe("Sentry reads", () => {
	it("keeps reading other projects past one mistyped name, and names it without blaming the login", async () => {
		addProject("a-typo", "typo");
		addProject("b-good", "good");
		badProject = "typo";
		await poller.readSentry();
		expect(store.errors("b-good").length).toBeGreaterThan(0);
		const h = health("Sentry");
		expect(h?.ok).toBe(false);
		expect(h?.error).toContain("typo");
		expect(h?.fix).toBeNull();
	});

	it("still points at the login when nothing could be read", async () => {
		addProject("a-good", "good");
		const refused: Cli = async (cmd, args) =>
			cmd === "sentry" && args[1] === "list" ? ok("", 1, "Not authenticated") : cli(cmd, args);
		const p = new Poller({ ...depsOf(refused) });
		await p.readSentry();
		expect(health("Sentry")?.fix).toBe("sentry auth login");
	});

	const depsOf = (c: Cli) => ({
		store,
		cli: c,
		engine: () =>
			new Engine({ store, cli: c, executor: new FakeExecutor(), publish: () => {}, pollSoon: () => {} }),
		publish: () => {},
		onRegression: () => {},
		onRead: () => {},
	});
});

describe("a broken Never touch file", () => {
	it("shows on GitHub's health and doesn't stop reads once it's fixed", async () => {
		addProject("a", "good");
		writeFileSync(join(dir, "never-touch.json"), "{broken");
		await poller.readGithub();
		expect(health("GitHub")?.ok).toBe(false);
		expect(health("GitHub")?.error).toContain("never-touch.json");
		expect(health("GitHub")?.fix).toBeNull();
		await poller.readSentry();
		expect(health("Sentry")?.ok).toBe(false);
		writeFileSync(join(dir, "never-touch.json"), "[]");
		calls = [];
		await poller.readGithub();
		expect(calls.some((c) => c.startsWith("gh api"))).toBe(true);
	});
});
