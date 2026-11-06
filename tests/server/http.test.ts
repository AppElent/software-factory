import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { Bus } from "../../src/server/bus.ts";
import type { Cli } from "../../src/server/cli.ts";
import type { Config } from "../../src/server/config.ts";
import { writeNeverTouch } from "../../src/server/config.ts";
import { openDb } from "../../src/server/db.ts";
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
let app: ReturnType<typeof createApp>;

const cli: Cli = async (cmd, args) => {
	calls.push(`${cmd} ${args.join(" ")}`);
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
	const engine = new Engine({ store, cli, executor: new FakeExecutor(), publish: bus.publish, pollSoon: () => {} });
	const poller = new Poller({ store, cli, engine: () => engine, publish: bus.publish, onRegression: () => {}, onRead: () => {} });
	poller.stop();
	app = createApp({ config, store, cli, engine, poller, notifier: new Notifier(store, cli, PORT), bus, webRoot: join(dir, "none") });
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
		const res = await app.request("/api/line", { method: "POST", headers: SESSION, body: '{"stopped":true}' });
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
});
