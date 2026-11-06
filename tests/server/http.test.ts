import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { Bus } from "../../src/server/bus.ts";
import type { Cli } from "../../src/server/cli.ts";
import type { Config } from "../../src/server/config.ts";
import { filterNeverTouch, readNeverTouch, writeNeverTouch } from "../../src/server/config.ts";
import { kvSet, openDb } from "../../src/server/db.ts";
import { Engine } from "../../src/server/engine.ts";
import { FakeExecutor } from "../../src/server/executor/fake.ts";
import { Notifier } from "../../src/server/notify.ts";
import { Poller } from "../../src/server/poller.ts";
import { Store } from "../../src/server/store.ts";

const PORT = 4399;
const TOKEN = "t".repeat(32);
const HOST = { host: `127.0.0.1:${PORT}` };
const SESSION = { ...HOST, "x-sf-session": TOKEN, "content-type": "application/json" };

let dir: string;
let store: Store;
let calls: string[];
let notifyCode = 0;
let origin = "git@github.com:me/fairway.git\n";
let app: ReturnType<typeof createApp>;

const cli: Cli = async (cmd, args) => {
	calls.push(`${cmd} ${args.join(" ")}`);
	if (cmd === "git" && args[0] === "remote")
		return { code: 0, stdout: origin, stderr: "", timedOut: false, missing: false };
	if (cmd === "terminal-notifier")
		return { code: notifyCode, stdout: "", stderr: "", timedOut: false, missing: false };
	if (cmd === "gh" && args[1] === "list") {
		return {
			code: 0,
			stdout: JSON.stringify(
				["me/fairway", "me/client-work", "me/client-archive"].map((nameWithOwner) => ({
					nameWithOwner,
					pushedAt: "2026-11-01T00:00:00Z",
					isPrivate: true,
					isArchived: false,
				})),
			),
			stderr: "",
			timedOut: false,
			missing: false,
		};
	}
	return { code: 0, stdout: "", stderr: "", timedOut: false, missing: false };
};

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sf-"));
	calls = [];
	const config: Config = { dataDir: dir, port: PORT, host: "127.0.0.1", sessionToken: TOKEN, demo: false };
	store = new Store(openDb(join(dir, "t.db")), dir);
	const bus = new Bus();
	const engine = new Engine({
		store,
		cli,
		executor: new FakeExecutor(),
		publish: bus.publish,
		pollSoon: () => {},
	});
	const poller = new Poller({
		store,
		cli,
		engine: () => engine,
		publish: bus.publish,
		onRegression: () => {},
		onRead: () => {},
	});
	poller.stop();
	app = createApp({
		config,
		store,
		cli,
		engine,
		poller,
		notifier: new Notifier(store, cli, PORT),
		bus,
		webRoot: join(dir, "none"),
	});
});

describe("the boundary", () => {
	it("refuses a wrong Host, which stops DNS rebinding", async () => {
		const res = await app.request("/api/shell", { headers: { host: "evil.example" } });
		expect(res.status).toBe(403);
	});

	it("refuses a wrong Origin", async () => {
		const res = await app.request("/api/line", {
			method: "POST",
			headers: { ...SESSION, origin: "https://evil.example" },
			body: '{"stopped":true}',
		});
		expect(res.status).toBe(403);
		expect(store.line().stopped).toBe(false);
	});

	it("refuses a mutation without the session header", async () => {
		const res = await app.request("/api/line", {
			method: "POST",
			headers: { ...HOST, "content-type": "application/json" },
			body: '{"stopped":true}',
		});
		expect(res.status).toBe(403);
		expect(store.line().stopped).toBe(false);
	});

	it("accepts a mutation with it", async () => {
		const res = await app.request("/api/line", {
			method: "POST",
			headers: SESSION,
			body: '{"stopped":true}',
		});
		expect(res.status).toBe(200);
		expect(store.line().stopped).toBe(true);
	});

	it("refuses another site calling the API", async () => {
		const res = await app.request("/api/queue", { headers: { ...HOST, "sec-fetch-site": "cross-site" } });
		expect(res.status).toBe(403);
	});

	it("sets a strict CSP and no CORS", async () => {
		const res = await app.request("/api/shell", { headers: HOST });
		expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("rejects a bad body with a plain message", async () => {
		const res = await app.request("/api/line", { method: "POST", headers: SESSION, body: "{}" });
		expect(res.status).toBe(400);
	});
});

describe("never touch", () => {
	beforeEach(() => writeNeverTouch(dir, ["client-*"]));

	it("removes matching repos from the list and sends only a count", async () => {
		const res = await app.request("/api/repos", { headers: HOST });
		const text = await res.text();
		const body = JSON.parse(text);
		expect(body.repos.map((r: { repo: string }) => r.repo)).toEqual(["me/fairway"]);
		expect(body.skipped).toBe(2);
		expect(text).not.toContain("client-work");
	});

	it("refuses to add or clone a matching repo", async () => {
		const res = await app.request("/api/projects", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ repos: [{ repo: "me/client-work", clone: true }] }),
		});
		const body = await res.json();
		expect(body.added).toEqual([]);
		expect(body.failed[0].reason).toContain("Never touch");
		expect(calls.some((c) => c.includes("clone"))).toBe(false);
	});

	it("a rule added later hides an existing project everywhere", async () => {
		writeNeverTouch(dir, []);
		await app.request("/api/projects", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ repos: [{ repo: "me/client-new", clone: false }] }),
		});
		expect(store.projects()).toHaveLength(1);
		writeNeverTouch(dir, ["client-*"]);
		expect(store.projects()).toHaveLength(0);
		const res = await app.request("/api/projects/client-new", { headers: HOST });
		expect(res.status).toBe(404);
	});
});

describe("removing a project", () => {
	beforeEach(() => {
		for (const slug of ["a", "b"]) {
			store.db
				.prepare("INSERT INTO projects (slug, repo, name, url, added_at) VALUES (?, ?, ?, ?, ?)")
				.run(slug, `me/${slug}`, slug, "", new Date().toISOString());
		}
	});

	it("refuses the last project", async () => {
		await app.request("/api/projects/a/remove", { method: "POST", headers: SESSION });
		const res = await app.request("/api/projects/b/remove", { method: "POST", headers: SESSION });
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain("only project");
	});
});

describe("settings", () => {
	it("refuses limits out of range", async () => {
		const res = await app.request("/api/settings/agents", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ agentsAtOnce: 9, pauseOnReview: false, retries: 1, agent: "claude" }),
		});
		expect(res.status).toBe(400);
	});

	it("won't turn on merge without me for a type that hasn't qualified", async () => {
		const { approvals } = store.settings();
		const res = await app.request("/api/settings/approvals", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ ...approvals, mergeWithoutMe: { ...approvals.mergeWithoutMe, Chore: true } }),
		});
		expect(res.status).toBe(409);
		expect(store.settings().approvals.mergeWithoutMe.Chore).toBe(false);
	});

	it("tells a blocked notification from a sent one", async () => {
		notifyCode = 3;
		const blocked = await app.request("/api/notifications/test", {
			method: "POST",
			headers: SESSION,
			body: "{}",
		});
		expect(await blocked.json()).toEqual({ ok: false, result: "blocked" });
		expect(store.settings().notifications.lastTest).toBe("blocked");
		notifyCode = 0;
		const sent = await app.request("/api/notifications/test", {
			method: "POST",
			headers: SESSION,
			body: "{}",
		});
		expect(await sent.json()).toEqual({ ok: true, result: "ok" });
		expect(store.settings().notifications.lastTest).toBe("ok");
	});
});

describe("the Never touch file", () => {
	it("refuses a file it can't fully read, rather than dropping rules", () => {
		const file = join(dir, "never-touch.json");
		for (const bad of ['{"rules":["*x*"]}', '["*x*", 3]', "not json"]) {
			writeFileSync(file, bad);
			expect(() => readNeverTouch(dir)).toThrow(/JSON list of strings/);
		}
		writeFileSync(file, '["*x*"]');
		expect(readNeverTouch(dir)).toEqual(["*x*"]);
	});
});

describe("choosing a project's folder", () => {
	const add = async () =>
		app.request("/api/projects", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ repos: [{ repo: "me/fairway", clone: false }] }),
		});
	const choose = (path: string) =>
		app.request("/api/projects/fairway/folder", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ path }),
		});
	const checkout = (name: string) => {
		const path = join(dir, name);
		mkdirSync(join(path, ".git"), { recursive: true });
		return path;
	};

	beforeEach(() => {
		origin = "git@github.com:me/fairway.git\n";
		writeNeverTouch(dir, []);
	});

	it("takes a checkout of this repo", async () => {
		await add();
		expect((await choose(checkout("mine"))).status).toBe(200);
	});

	it("refuses a checkout of a different repo, since agents push from it", async () => {
		await add();
		origin = "git@github.com:me/something-else.git\n";
		const res = await choose(checkout("other"));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain("isn't a checkout of me/fairway");
	});

	it("follows a symlink before checking Never touch", async () => {
		await add();
		const real = checkout("client-secret");
		const link = join(dir, "innocent");
		symlinkSync(real, link);
		writeNeverTouch(dir, ["*client-secret*"]);
		expect((await choose(link)).status).toBe(403);
	});
});

describe("a symlink to a Never touch folder", () => {
	it("is refused when adding a project, and hides a project already pointing there", async () => {
		origin = "git@github.com:me/fairway.git\n";
		const clones = join(dir, "clones");
		mkdirSync(clones);
		kvSet(store.db, "settings:cloneFolder", clones);
		const secret = join(dir, "client-secret");
		mkdirSync(join(secret, ".git"), { recursive: true });
		symlinkSync(secret, join(clones, "fairway"));
		writeNeverTouch(dir, ["*client-secret*"]);
		const res = await app.request("/api/projects", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ repos: [{ repo: "me/fairway", clone: false }] }),
		});
		expect((await res.json()).added).toEqual([]);
		expect(store.projects()).toEqual([]);
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("fairway", "me/fairway", "fairway", "", join(clones, "fairway"), store.iso());
		expect(store.projects()).toEqual([]);
	});
});

describe("two repos with the same name", () => {
	const add = async (...repos: string[]) =>
		(
			await app.request("/api/projects", {
				method: "POST",
				headers: SESSION,
				body: JSON.stringify({ repos: repos.map((repo) => ({ repo, clone: false })) }),
			})
		).json();

	it("stay two projects, each acting on its own repo", async () => {
		expect((await add("client/app", "me/app")).added).toEqual(["app", "me-app"]);
		expect(store.project("app")?.repo).toBe("client/app");
		expect(store.project("me-app")?.repo).toBe("me/app");
	});

	it("still treats adding the same repo again as the same project", async () => {
		await add("client/app", "me/app");
		expect((await add("me/app")).added).toEqual(["me-app"]);
		expect((await add("Client/App")).added).toEqual(["app"]);
		expect(store.projects()).toHaveLength(2);
	});
});

describe("a new project and Never touch", () => {
	it("refuses a matching name before asking GitHub about it", async () => {
		writeNeverTouch(dir, ["*client-secret*"]);
		const res = await app.request("/api/new-project/check", {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify({ name: "client-secret-app" }),
		});
		expect((await res.json()).problem).toMatch(/Never touch/);
	});

	it("follows a symlinked clone folder to where a new folder would land", () => {
		const secret = join(dir, "client-secret");
		mkdirSync(secret);
		const link = join(dir, "clones-link");
		symlinkSync(secret, link);
		const { kept } = filterNeverTouch(["*client-secret*"], [{ repo: "me/app", path: join(link, "app") }]);
		expect(kept).toEqual([]);
	});
});

describe("a broken Never touch file, seen from the page", () => {
	it("says what's wrong instead of a generic failure", async () => {
		writeFileSync(join(dir, "never-touch.json"), "{broken");
		const res = await app.request("/api/shell", { headers: HOST });
		expect(res.status).toBe(503);
		expect((await res.json()).error).toContain("must be a JSON list of strings");
	});
});
