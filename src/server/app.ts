import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, normalize, resolve } from "node:path";
import { backup } from "node:sqlite";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { applyNeverTouch, mergeBlockers, qualifies, snoozeUntil } from "../shared/rules.ts";
import type {
	BackSummary,
	BulkMergeResult,
	ErrorDetail,
	PrDetail,
	ProjectDetail,
	ReadingResponse,
	RepoListResponse,
	Settings,
	SyncResult,
} from "../shared/types.ts";
import { WORK_TYPES } from "../shared/types.ts";
import type { Bus } from "./bus.ts";
import type { Cli } from "./cli.ts";
import { scrub } from "./cli.ts";
import type { Config } from "./config.ts";
import { writeNeverTouch } from "./config.ts";
import { cloneRepo, listRepos, REPO_RE, readPrFiles } from "./connectors/github.ts";
import { checkTools, TOOLS } from "./connectors/tools.ts";
import { audit, kvGet, kvSet } from "./db.ts";
import type { Engine } from "./engine.ts";
import { ActionError } from "./engine.ts";
import { NewProjects, type ScaffoldRunner, TEMPLATES } from "./newproject.ts";
import type { Notifier } from "./notify.ts";
import type { Poller } from "./poller.ts";
import { readFloor, readHealth, readProjectRecord, readQueue, readShell, triageBaseline } from "./read.ts";
import { CSP, guard, SESSION_HEADER } from "./security.ts";
import type { Store } from "./store.ts";

const WEB_ROOT = resolve(new URL("../../dist/web", import.meta.url).pathname);
const AWAY_MS = 4 * 3_600_000;

const MIME: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
	".map": "application/json",
};

export interface AppDeps {
	config: Config;
	store: Store;
	cli: Cli;
	engine: Engine;
	poller: Poller;
	notifier: Notifier;
	bus: Bus;
	scaffold?: ScaffoldRunner;
	/** Extra routes for demo mode. */
	extend?: (app: Hono) => void;
	/** Restarts the service. Replaced in tests and demo mode. */
	restart?: () => void;
	webRoot?: string;
}

const body = async <T extends z.ZodType>(
	req: { json: () => Promise<unknown> },
	shape: T,
): Promise<z.infer<T>> => {
	const raw = await req.json().catch(() => {
		throw new ActionError("That request wasn't valid JSON.", 400);
	});
	const parsed = shape.safeParse(raw);
	if (!parsed.success) throw new ActionError("That request had the wrong shape.", 400);
	return parsed.data;
};

const num = (s: string | undefined) => {
	const n = Number(s);
	if (!Number.isInteger(n) || n < 0) throw new ActionError("Not found", 404);
	return n;
};

const launchdRestart = () => {
	const uid = process.getuid?.() ?? 501;
	execFile("launchctl", ["kickstart", "-k", `gui/${uid}/com.appelent.software-factory`], (err) => {
		// Not running under launchd: exit and let whoever started it decide.
		if (err) process.exit(0);
	});
};

export function createApp(d: AppDeps): Hono {
	const { config, store, cli, engine, poller, notifier, bus } = d;
	const webRoot = d.webRoot ?? process.env.SF_WEB_ROOT ?? WEB_ROOT;
	const app = new Hono();
	const devOrigin = process.env.SF_DEV_ORIGIN;
	const buildId = () => {
		const index = join(webRoot, "index.html");
		return existsSync(index)
			? createHash("sha1").update(readFileSync(index)).digest("hex").slice(0, 10)
			: "dev";
	};
	const newProjects = new NewProjects({
		store,
		cli,
		runner: d.scaffold,
		publish: bus.publish,
		addProject: (repo, localPath) => addProject(repo, localPath),
	});

	app.use(
		guard({ port: config.port, token: config.sessionToken, devOrigins: devOrigin ? [devOrigin] : undefined }),
	);

	app.onError((e, c) => {
		if (e instanceof ActionError) return c.json({ error: e.message }, e.status as 400);
		console.error(scrub(e instanceof Error ? (e.stack ?? e.message) : String(e)));
		return c.json({ error: "Something went wrong in the service." }, 500);
	});

	/* ---------- projects ---------- */

	function addProject(repo: string, localPath: string | null): string {
		if (!REPO_RE.test(repo)) throw new ActionError("That isn't a GitHub repo.", 400);
		const rules = store.neverTouch();
		const { kept } = applyNeverTouch(rules, [{ repo, path: localPath }]);
		if (kept.length === 0) throw new ActionError("A Never touch rule matches that repo.", 403);
		const name = repo.split("/")[1] ?? repo;
		const slug = name.toLowerCase();
		store.db
			.prepare(
				`INSERT INTO projects (slug, repo, name, url, local_path, added_at) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(slug) DO UPDATE SET repo = excluded.repo, local_path = COALESCE(excluded.local_path, local_path), removed_at = NULL`,
			)
			.run(slug, repo, name, `https://github.com/${repo}`, localPath, store.iso());
		audit(store.db, "add project", repo, "you", null, store.now());
		bus.publish(["shell", "projects", "queue"]);
		poller.soon();
		// The demo has no Sentry to read, and a read would replace its sample errors.
		if (!config.demo) poller.soonSentry();
		return slug;
	}

	/** For showing a path. The page never sends it back. */
	const shortPath = (path: string | null) =>
		path?.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path;

	const findFolder = (repo: string, cloneFolder: string) => {
		const path = join(cloneFolder, repo.split("/")[1] ?? "");
		return existsSync(join(path, ".git")) ? path : null;
	};

	app.get("/api/repos", async (c) => {
		const { cloneFolder } = store.settings().projects;
		const rules = store.neverTouch();
		const listed = await listRepos(cli).catch((e: Error) => {
			throw new ActionError(scrub(e.message), 502);
		});
		// Rules run on the names first. Nothing about a skipped repo goes further than this line.
		const { kept, skipped } = applyNeverTouch(
			rules,
			listed.map((r) => ({
				...r,
				repo: r.nameWithOwner,
				path: join(cloneFolder, r.nameWithOwner.split("/")[1] ?? ""),
			})),
		);
		const added = new Set(store.projects().map((p) => p.repo.toLowerCase()));
		const res: RepoListResponse = {
			repos: kept
				.map((r) => {
					const name = r.repo.split("/")[1] ?? r.repo;
					return {
						repo: r.repo,
						slug: name.toLowerCase(),
						name,
						pushedAt: r.pushedAt,
						isPrivate: r.isPrivate,
						localPath: shortPath(findFolder(r.repo, cloneFolder)),
						added: added.has(r.repo.toLowerCase()),
					};
				})
				.sort((a, b) => Date.parse(b.pushedAt ?? "0") - Date.parse(a.pushedAt ?? "0")),
			skipped: skipped.length,
			cloneFolder,
		};
		kvSet(store.db, "skipped_repos", skipped.length);
		return c.json(res);
	});

	app.post("/api/repos/clone", async (c) => {
		const { repo } = await body(c.req, z.object({ repo: z.string() }));
		if (!REPO_RE.test(repo)) throw new ActionError("That isn't a GitHub repo.", 400);
		const { cloneFolder } = store.settings().projects;
		const dest = join(cloneFolder, repo.split("/")[1] ?? "");
		// The rule check comes before the clone.
		const { kept } = applyNeverTouch(store.neverTouch(), [{ repo, path: dest }]);
		if (kept.length === 0) throw new ActionError("A Never touch rule matches that repo.", 403);
		const found = findFolder(repo, cloneFolder);
		if (found) return c.json({ ok: true, path: shortPath(found) });
		const res = await cloneRepo(cli, repo, dest);
		audit(store.db, "clone repo", repo, "you", res.code === 0 ? null : res.stderr, store.now());
		if (res.code !== 0) throw new ActionError(scrub(res.stderr.trim()) || "The clone failed.", 502);
		return c.json({ ok: true, path: shortPath(dest) });
	});

	app.post("/api/projects", async (c) => {
		const input = await body(
			c.req,
			z.object({ repos: z.array(z.object({ repo: z.string(), clone: z.boolean() })).min(1) }),
		);
		const { cloneFolder } = store.settings().projects;
		const added: string[] = [];
		const failed: Array<{ repo: string; reason: string }> = [];
		for (const { repo, clone } of input.repos) {
			if (!REPO_RE.test(repo)) {
				failed.push({ repo, reason: "That isn't a GitHub repo." });
				continue;
			}
			const dest = join(cloneFolder, repo.split("/")[1] ?? "");
			// The rule check comes before the clone.
			const { kept } = applyNeverTouch(store.neverTouch(), [{ repo, path: dest }]);
			if (kept.length === 0) {
				failed.push({ repo, reason: "A Never touch rule matches that repo." });
				continue;
			}
			let path = findFolder(repo, cloneFolder);
			if (!path && clone) {
				const res = await cloneRepo(cli, repo, dest);
				audit(store.db, "clone repo", repo, "you", res.code === 0 ? null : res.stderr, store.now());
				if (res.code !== 0) {
					failed.push({ repo, reason: scrub(res.stderr.trim()) });
					continue;
				}
				path = dest;
			}
			added.push(addProject(repo, path));
		}
		return c.json({ added, failed });
	});

	app.get("/api/reading", (c) => {
		const projects = store.projects().map((p) => {
			const read = !!p.readAt;
			const parts = [`${p.openPrs} open ${p.openPrs === 1 ? "PR" : "PRs"}`];
			if (p.sentryProject) {
				parts.push(
					p.openErrors === 0
						? "no errors"
						: `${p.openErrors} production ${p.openErrors === 1 ? "error" : "errors"}`,
				);
			}
			if (p.toolkit.status === "current") parts.push("toolkit current");
			if (p.toolkit.status === "behind") parts.push("toolkit behind");
			return {
				slug: p.slug,
				name: p.name,
				state: read ? ("done" as const) : ("reading" as const),
				summary: read ? parts.join(" · ") : "Reading open PRs",
				warning: read && !p.sentryProject ? `${p.name} has no Sentry project linked` : null,
			};
		});
		const res: ReadingResponse = {
			projects,
			skipped: kvGet<number>(store.db, "skipped_repos") ?? 0,
			ready: projects.some((p) => p.state === "done"),
		};
		return c.json(res);
	});

	app.get("/api/projects", (c) => c.json(store.projects()));

	const blockedRemove = (slug: string, openWork: number): ProjectDetail["blockedRemove"] => {
		if (openWork > 0) return "open_work";
		return store.projects().length <= 1 && store.project(slug) ? "last_project" : null;
	};

	app.get("/api/projects/:slug", (c) => {
		const slug = c.req.param("slug");
		const p = store.project(slug);
		if (!p) throw new ActionError("That project isn't in the factory.", 404);
		const shipped = store
			.workOrders("project = ? AND merged_at IS NOT NULL", slug)
			.sort((a, b) => Date.parse(b.mergedAt ?? "0") - Date.parse(a.mergedAt ?? "0"))
			.slice(0, 5);
		const open = store.workOrders().filter((w) => w.project === slug);
		const res: ProjectDetail = {
			...p,
			workOrders: open,
			prs: store.prs(slug),
			errors: store.errors(slug),
			shipped,
			main: store.main(slug),
			blockedRemove: blockedRemove(slug, open.length),
			last30: readProjectRecord(store, slug),
		};
		return c.json(res);
	});

	const needProject = (slug: string) => {
		const p = store.project(slug);
		if (!p) throw new ActionError("That project isn't in the factory.", 404);
		return p;
	};

	const setPaused = (slug: string, paused: boolean) => {
		needProject(slug);
		store.db.prepare("UPDATE projects SET paused = ? WHERE slug = ?").run(paused ? 1 : 0, slug);
		bus.publish(["projects", `project:${slug}`, "floor", "queue", "shell"]);
		if (!paused) void engine.tick();
	};
	app.post("/api/projects/:slug/pause", (c) => {
		setPaused(c.req.param("slug"), true);
		return c.json({ ok: true });
	});
	app.post("/api/projects/:slug/resume", (c) => {
		setPaused(c.req.param("slug"), false);
		return c.json({ ok: true });
	});

	app.post("/api/projects/:slug/merging", async (c) => {
		const slug = c.req.param("slug");
		needProject(slug);
		const { merging } = await body(c.req, z.object({ merging: z.enum(["follow", "ask"]) }));
		store.db.prepare("UPDATE projects SET merging = ? WHERE slug = ?").run(merging, slug);
		bus.publish(["projects", `project:${slug}`]);
		return c.json({ ok: true });
	});

	app.post("/api/projects/:slug/remove", (c) => {
		const slug = c.req.param("slug");
		const p = needProject(slug);
		const blocked = blockedRemove(slug, p.openWorkOrders);
		if (blocked === "open_work") throw new ActionError("This project has open work orders.");
		if (blocked === "last_project") throw new ActionError(`${p.name} is your only project.`);
		// Removing stops watching. The repo, folder, and services stay.
		store.db.prepare("UPDATE projects SET removed_at = ? WHERE slug = ?").run(store.iso(), slug);
		store.db.prepare("DELETE FROM prs WHERE project = ?").run(slug);
		store.db.prepare("DELETE FROM errors WHERE project = ?").run(slug);
		audit(store.db, "remove project", p.repo, "you", null, store.now());
		bus.publish(["projects", "floor", "queue", "shell", "prs", "errors"]);
		return c.json({ ok: true });
	});

	app.post("/api/projects/:slug/clone", async (c) => {
		const slug = c.req.param("slug");
		const p = needProject(slug);
		const dest = p.localPath ?? join(store.settings().projects.cloneFolder, p.name);
		const { kept } = applyNeverTouch(store.neverTouch(), [{ repo: p.repo, path: dest }]);
		if (kept.length === 0) throw new ActionError("A Never touch rule matches that folder.", 403);
		const res = await cloneRepo(cli, p.repo, dest);
		audit(store.db, "clone repo", p.repo, "you", res.code === 0 ? null : res.stderr, store.now());
		if (res.code !== 0) throw new ActionError(scrub(res.stderr.trim()) || "It didn't clone.", 502);
		store.db.prepare("UPDATE projects SET local_path = ? WHERE slug = ?").run(dest, slug);
		bus.publish(["projects", `project:${slug}`, "floor", "shell"]);
		void engine.tick();
		return c.json({ ok: true, path: dest });
	});

	app.post("/api/projects/:slug/folder", async (c) => {
		const slug = c.req.param("slug");
		const p = needProject(slug);
		const { path } = await body(c.req, z.object({ path: z.string().min(1) }));
		const { kept } = applyNeverTouch(store.neverTouch(), [{ repo: p.repo, path }]);
		if (kept.length === 0) throw new ActionError("A Never touch rule matches that folder.", 403);
		if (!existsSync(join(path, ".git"))) throw new ActionError("That folder isn't a git checkout.", 400);
		store.db.prepare("UPDATE projects SET local_path = ? WHERE slug = ?").run(path, slug);
		bus.publish(["projects", `project:${slug}`, "floor", "shell"]);
		void engine.tick();
		return c.json({ ok: true });
	});

	app.post("/api/projects/:slug/connect", async (c) => {
		const slug = c.req.param("slug");
		needProject(slug);
		const { sentryProject, skip } = await body(
			c.req,
			z.object({ sentryProject: z.string().optional(), skip: z.boolean().optional() }),
		);
		store.db
			.prepare("UPDATE projects SET sentry_project = ?, sentry_skipped = ? WHERE slug = ?")
			.run(sentryProject ?? null, skip ? 1 : 0, slug);
		bus.publish(["projects", `project:${slug}`, "errors", "queue"]);
		poller.soonSentry();
		return c.json({ ok: true });
	});

	app.post("/api/projects/sync", async (c) => {
		const { slugs } = await body(c.req, z.object({ slugs: z.array(z.string()).min(1) }));
		const res: SyncResult = { started: [], blocked: [] };
		for (const slug of slugs) {
			const p = store.project(slug);
			if (!p) continue;
			if (p.folderMissing) {
				res.blocked.push({ slug, reason: "Folder missing" });
				continue;
			}
			const id = engine.create({
				project: slug,
				type: "Toolkit sync",
				title: "Sync toolkit standards",
				description: "Bring this project up to date with the shared toolkit.",
				source: { kind: "toolkit", fingerprint: `toolkit:${slug}` },
			});
			audit(store.db, "start toolkit sync", p.repo, "you", null, store.now());
			res.started.push({ slug, workOrderId: id, waiting: store.workOrder(id)?.state === "waiting" });
		}
		return c.json(res);
	});

	/* ---------- shell and queue ---------- */

	app.get("/api/shell", (c) => c.json(readShell(store, engine, buildId())));
	app.get("/api/queue", (c) => c.json(readQueue(store, engine)));

	/** Runs once per page load. Works out the Back summary and clears the first-look banner. */
	app.post("/api/visit", (c) => {
		const lastSeen = kvGet<string>(store.db, "last_seen");
		const state = kvGet<{ firstLookPending?: boolean }>(store.db, "visit_flags") ?? {};
		let back: BackSummary | null = null;
		if (lastSeen && store.now().getTime() - Date.parse(lastSeen) > AWAY_MS) {
			const since = lastSeen;
			const count = (sql: string) => (store.db.prepare(sql).get(since) as { n: number }).n;
			back = {
				since,
				shipped: count("SELECT COUNT(*) n FROM work_orders WHERE merged_at >= ?"),
				failed: count("SELECT COUNT(*) n FROM work_orders WHERE state = 'failed' AND state_at >= ?"),
				newErrors: store.errors().filter((e) => e.firstSeen >= since).length,
			};
		}
		kvSet(store.db, "visit_state", { back, firstLook: !!state.firstLookPending });
		kvSet(store.db, "visit_flags", {});
		kvSet(store.db, "last_seen", store.iso());
		return c.json({ ok: true });
	});

	/** `Check again` on a failing source. Demo mode never runs a connector. */
	app.post("/api/sources/check", async (c) => {
		if (!config.demo) {
			const failing = store.health().filter((h) => !h.ok);
			await Promise.all(
				failing.map((h) =>
					h.source === "GitHub" ? poller.readGithub() : h.source === "Sentry" ? poller.readSentry() : null,
				),
			);
		}
		bus.publish(["queue", "shell"]);
		return c.json({ ok: true });
	});

	app.post("/api/first-look", (c) => {
		kvSet(store.db, "visit_flags", { firstLookPending: true });
		return c.json({ ok: true });
	});

	app.post("/api/presence", (c) => {
		notifier.seen();
		kvSet(store.db, "last_seen", store.iso());
		return c.json({ ok: true });
	});

	app.post("/api/triage", async (c) => {
		const input = await body(
			c.req,
			z.object({ fingerprints: z.array(z.string()).min(1), action: z.enum(["snooze", "dismiss", "undo"]) }),
		);
		for (const fp of input.fingerprints) {
			if (input.action === "undo") {
				store.db.prepare("DELETE FROM triage WHERE fingerprint = ?").run(fp);
				continue;
			}
			const base = triageBaseline(store, fp);
			store.db
				.prepare(
					`INSERT INTO triage (fingerprint, action, until, baseline_events, baseline_users, baseline_release, at)
					VALUES (?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(fingerprint) DO UPDATE SET action = excluded.action, until = excluded.until,
					baseline_events = excluded.baseline_events, baseline_users = excluded.baseline_users,
					baseline_release = excluded.baseline_release, at = excluded.at`,
				)
				.run(
					fp,
					input.action,
					input.action === "snooze" ? snoozeUntil(store.now()).toISOString() : null,
					base.events,
					base.users,
					base.release,
					store.iso(),
				);
		}
		bus.publish(["queue", "shell", "errors"]);
		return c.json({ ok: true });
	});

	app.get("/api/floor", (c) => c.json(readFloor(store, engine, c.req.query("project") || undefined)));

	app.post("/api/line", async (c) => {
		const { stopped } = await body(c.req, z.object({ stopped: z.boolean() }));
		engine.setLine(stopped);
		return c.json({ ok: true });
	});

	/* ---------- work orders ---------- */

	app.get("/api/work-orders", (c) => c.json(store.workOrders()));

	app.post("/api/work-orders", async (c) => {
		const input = await body(
			c.req,
			z.object({
				project: z.string(),
				type: z.enum(WORK_TYPES),
				title: z.string().optional(),
				description: z.string().min(1),
				source: z
					.object({
						kind: z.enum(["person", "error", "red_main", "stale_pr", "rebase_pr", "toolkit", "new_project"]),
						fingerprint: z.string().optional(),
						prNumber: z.number().optional(),
					})
					.optional(),
			}),
		);
		const source = await sourceFor(input.source ?? { kind: "person" }, input.project);
		const id = engine.create({
			project: input.project,
			type: input.type,
			title: input.title ?? firstLine(input.description),
			description: input.description,
			source,
			prNumber: source.prNumber ?? null,
		});
		return c.json({ id, waiting: store.workOrder(id)?.state === "waiting" });
	});

	/** Builds the context an agent gets. The browser only names the item; the text comes from here. */
	async function sourceFor(
		s: { kind: string; fingerprint?: string; prNumber?: number },
		project: string,
	): Promise<import("../shared/types.ts").WorkOrderSource> {
		const kind = s.kind as import("../shared/types.ts").WorkOrderSource["kind"];
		if (s.fingerprint?.startsWith("error:")) {
			const id = s.fingerprint.slice(6);
			const e = store.error(id);
			const detail = errorDetail(id);
			if (e) {
				return {
					kind,
					fingerprint: s.fingerprint,
					data: [
						`${e.title}`,
						`${e.culprit}`,
						`${e.events} events, ${e.users} users, first seen ${e.firstSeen}`,
						...(detail?.stack ?? [])
							.slice(0, 12)
							.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} ${f.context ?? ""}`),
					].join("\n"),
					regressionOf: e.regressionOf
						? { workOrderId: e.regressionOf.workOrderId, prNumber: e.regressionOf.prNumber }
						: undefined,
				};
			}
		}
		if (s.fingerprint?.startsWith("main:")) {
			const main = store.main(project);
			return {
				kind,
				fingerprint: s.fingerprint,
				data: main
					? `${main.sha} ${main.message}\n${main.failing.map((f: { name: string }) => f.name).join("\n")}`
					: undefined,
			};
		}
		return { kind, fingerprint: s.fingerprint, prNumber: s.prNumber };
	}

	app.get("/api/work-orders/:id", (c) => {
		const wo = store.workOrder(num(c.req.param("id")));
		if (!wo) throw new ActionError("That work order doesn't exist.", 404);
		return c.json(wo);
	});

	const ok = { ok: true };
	app.post("/api/work-orders/:id/approve", async (c) => {
		await engine.approve(num(c.req.param("id")));
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/change", async (c) => {
		const { note } = await body(c.req, z.object({ note: z.string().min(1) }));
		await engine.change(num(c.req.param("id")), note);
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/reject", async (c) => {
		await engine.reject(num(c.req.param("id")));
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/answer", async (c) => {
		const { answer, note } = await body(
			c.req,
			z.object({ answer: z.string().min(1), note: z.string().nullish() }),
		);
		await engine.answer(num(c.req.param("id")), answer, note ?? null);
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/stop", (c) => {
		engine.stop(num(c.req.param("id")));
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/resume", async (c) => {
		await engine.resume(num(c.req.param("id")));
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/retry", async (c) => {
		const { note } = await body(c.req, z.object({ note: z.string().nullish() }));
		await engine.retry(num(c.req.param("id")), note ?? null);
		return c.json(ok);
	});
	app.post("/api/work-orders/:id/close", async (c) => {
		await engine.close(num(c.req.param("id")));
		return c.json(ok);
	});

	/* ---------- pull requests ---------- */

	app.get("/api/prs", (c) => c.json(store.prs(c.req.query("project") || undefined)));

	app.get("/api/prs/:project/:n", async (c) => {
		const project = c.req.param("project");
		const number = num(c.req.param("n"));
		const pr = store.pr(project, number);
		const p = store.project(project);
		if (!pr || !p) throw new ActionError("That PR isn't open.", 404);
		const res: PrDetail = {
			...pr,
			workOrder: pr.workOrderId ? store.workOrder(pr.workOrderId) : null,
			files: await readPrFiles(cli, p.repo, number),
			mergeBlockers: mergeBlockers(pr),
		};
		return c.json(res);
	});

	app.post("/api/prs/merge", async (c) => {
		const { prs } = await body(
			c.req,
			z.object({ prs: z.array(z.object({ project: z.string(), number: z.number() })).min(1) }),
		);
		const res: BulkMergeResult = { merged: [], failed: [] };
		// One at a time, in order, as the dialog says.
		for (const { project, number } of prs) {
			const r = await engine.merge(project, number).catch((e: Error) => ({ ok: false, reason: e.message }));
			if (r.ok) res.merged.push(number);
			else res.failed.push({ project, number, reason: scrub(r.reason) });
		}
		return c.json(res);
	});

	app.post("/api/prs/:project/:n/merge", async (c) => {
		const res = await engine.merge(c.req.param("project"), num(c.req.param("n")));
		return c.json({ ok: res.ok, reason: scrub(res.reason) });
	});
	app.post("/api/prs/:project/:n/request-changes", async (c) => {
		const { note } = await body(c.req, z.object({ note: z.string().min(1) }));
		return c.json(await engine.requestChanges(c.req.param("project"), num(c.req.param("n")), note));
	});
	app.post("/api/prs/:project/:n/close", async (c) => {
		await engine.closePullRequest(c.req.param("project"), num(c.req.param("n")));
		return c.json(ok);
	});
	app.post("/api/prs/:project/:n/rebase", (c) => {
		const project = c.req.param("project");
		const number = num(c.req.param("n"));
		const pr = store.pr(project, number);
		if (!pr) throw new ActionError("That PR isn't open.", 404);
		const id = engine.create({
			project,
			type: "Chore",
			title: `Rebase #${number} ${pr.title}`,
			description: `Rebase PR #${number} on its base branch and resolve any conflicts.`,
			source: { kind: "rebase_pr", fingerprint: `rebase:${project}:${number}`, prNumber: number },
			prNumber: number,
		});
		return c.json({ workOrderId: id });
	});

	/* ---------- errors ---------- */

	/** A dismissed error stays gone until it gets worse. A snoozed one still shows, as Snoozed. */
	const isOpen = (e: { triage: { action: string } | null }) => e.triage?.action !== "dismiss";

	app.get("/api/errors", (c) => {
		const project = c.req.query("project") || undefined;
		const projects = store.projects();
		return c.json({
			errors: store.errors(project).filter(isOpen),
			checkedAt: store.health().find((h) => h.source === "Sentry")?.lastOk ?? null,
			withoutSentry: projects.filter((p) => !p.sentryProject).length,
			quiet: projects.filter((p) => p.sentryProject && !store.errors(p.slug).some(isOpen)).length,
		});
	});

	function errorDetail(id: string): ErrorDetail | null {
		const e = store.error(id);
		if (!e) return null;
		const row = store.db.prepare("SELECT detail FROM errors WHERE id = ?").get(id) as {
			detail: string | null;
		};
		const detail = row.detail ? JSON.parse(row.detail) : null;
		return {
			...e,
			stack: detail?.stack ?? [],
			likelySource: detail?.likelySource ?? null,
			releasePrs: detail?.releasePrs ?? [],
		};
	}

	app.get("/api/errors/:id", (c) => {
		const e = errorDetail(c.req.param("id"));
		if (!e) throw new ActionError("That error isn't open.", 404);
		return c.json(e);
	});

	/* ---------- health ---------- */

	app.get("/api/health", (c) => {
		const m = /^(\d+)d$/.exec(c.req.query("window") ?? "14d");
		return c.json(readHealth(store, Math.min(Number(m?.[1] ?? 14), 90)));
	});

	/* ---------- settings ---------- */

	app.get("/api/settings", (c) => c.json(store.settings()));

	app.put("/api/settings/agents", async (c) => {
		const next = await body(
			c.req,
			z.object({
				agentsAtOnce: z.number().int().min(1).max(8),
				pauseOnReview: z.boolean(),
				retries: z.number().int().min(0).max(2),
				agent: z.enum(["claude", "codex"]),
			}),
		);
		kvSet(store.db, "settings:agents", next);
		bus.publish(["settings", "queue", "floor", "shell"]);
		void engine.tick();
		return c.json(store.settings().agents);
	});

	const byWorkType = <T extends z.ZodType>(v: T) =>
		z.object({ "Bug fix": v, Feature: v, "Toolkit sync": v, Chore: v });

	app.put("/api/settings/approvals", async (c) => {
		const next = await body(
			c.req,
			z.object({
				planReview: byWorkType(z.enum(["always", "skip"])),
				mergeWithoutMe: byWorkType(z.boolean()),
				thresholds: z.object({ runs: z.number().int().min(5), firstTryPct: z.number().min(50).max(100) }),
			}),
		);
		const current = store.settings().approvals;
		const health = readHealth(store);
		for (const type of WORK_TYPES) {
			const turningOn = next.mergeWithoutMe[type] && !current.mergeWithoutMe[type];
			if (!turningOn) continue;
			// The server decides. A stale page can't turn this on for a type that doesn't qualify.
			const rec = health.byType.find((t) => t.type === type);
			const qualified =
				rec &&
				qualifies(
					{
						runs: rec.runs,
						firstTry: Math.round(((rec.firstTryPct ?? 0) * rec.runs) / 100),
						regressions: rec.regressions,
					},
					next.thresholds,
				);
			if (!qualified) throw new ActionError(`${type} doesn't qualify yet.`);
			audit(store.db, "turn on merge without me", type, "you", null, store.now());
		}
		const turnedOff = { ...current.turnedOffByRegression };
		for (const type of WORK_TYPES) {
			if (next.mergeWithoutMe[type]) turnedOff[type] = false;
			if (!next.mergeWithoutMe[type] && current.mergeWithoutMe[type])
				audit(store.db, "turn off merge without me", type, "you", null, store.now());
		}
		kvSet(store.db, "settings:approvals", { ...next, turnedOffByRegression: turnedOff });
		bus.publish(["settings", "health"]);
		void engine.tick();
		return c.json(store.settings().approvals);
	});

	app.put("/api/settings/notifications", async (c) => {
		const next = await body(
			c.req,
			z.object({
				events: z.object({
					question: z.boolean(),
					plan: z.boolean(),
					ready_pr: z.boolean(),
					failed_gates: z.boolean(),
					error: z.boolean(),
					red_main: z.boolean(),
					merged_alone: z.boolean(),
					shipped: z.boolean(),
					slots_full: z.boolean(),
				}),
				onlyWhenAway: z.boolean(),
			}),
		);
		const prev = store.settings().notifications;
		kvSet(store.db, "settings:notifications", { ...prev, ...next });
		bus.publish(["settings"]);
		return c.json(store.settings().notifications);
	});

	app.put("/api/settings/projects", async (c) => {
		const next = await body(
			c.req,
			z.object({ cloneFolder: z.string().min(1), neverTouch: z.array(z.string().min(1)) }),
		);
		// Paths from here go straight to git and the file system, which don't expand a typed ~.
		kvSet(store.db, "settings:cloneFolder", next.cloneFolder.replace(/^~(?=$|\/)/, homedir()));
		writeNeverTouch(config.dataDir, next.neverTouch);
		audit(store.db, "change never touch rules", `${next.neverTouch.length} rules`, "you", null, store.now());
		bus.publish(["settings", "projects", "queue", "floor", "prs", "errors", "shell"]);
		return c.json(store.settings().projects);
	});

	app.post("/api/notifications/test", async (c) => {
		const sent = await notifier.send({
			title: "This is a test",
			message: "Notifications from Software Factory reach this Mac.",
			path: "/settings/notifications",
		});
		const prev = store.settings().notifications;
		kvSet(store.db, "settings:notifications", { ...prev, lastTest: sent ? "ok" : "failed" });
		bus.publish(["settings"]);
		return c.json({ ok: sent });
	});

	app.get("/api/tools", async (c) => c.json(await checkTools(cli)));
	app.post("/api/tools/check", async (c) => {
		const tools = await checkTools(cli);
		bus.publish(["tools"]);
		return c.json(tools);
	});
	app.get("/api/this-mac", (c) =>
		c.json({ dataDir: config.dataDir, port: config.port, tools: TOOLS.length, version: process.version }),
	);

	app.post("/api/service/restart", (c) => {
		audit(store.db, "restart service", "this Mac", "you", null, store.now());
		setTimeout(() => (d.restart ?? launchdRestart)(), 150).unref();
		return c.json(ok);
	});

	app.post("/api/backup", async (c) => {
		const dir = join(config.dataDir, "backups");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `factory-${store.iso().replaceAll(":", "-")}.db`);
		await backup(store.db, path);
		audit(store.db, "back up data", basename(path), "you", null, store.now());
		await cli("open", ["-R", path]);
		return c.json({ ok: true, path });
	});

	/* ---------- new project ---------- */

	app.post("/api/new-project/check", async (c) => {
		const { name } = await body(c.req, z.object({ name: z.string() }));
		const owner = await newProjects.owner();
		const { cloneFolder } = store.settings().projects;
		return c.json({
			owner,
			folder: join(cloneFolder, name),
			problem: await newProjects.validate(owner, name),
		});
	});

	app.post("/api/new-project", async (c) => {
		const input = await body(
			c.req,
			z.object({
				name: z.string().min(1),
				description: z.string(),
				template: z.string().refine((t) => t in TEMPLATES),
				visibility: z.enum(["private", "public"]),
			}),
		);
		const owner = await newProjects.owner();
		const problem = await newProjects.validate(owner, input.name);
		if (problem) throw new ActionError(problem, 400);
		const { cloneFolder } = store.settings().projects;
		const { kept } = applyNeverTouch(store.neverTouch(), [
			{ repo: `${owner}/${input.name}`, path: join(cloneFolder, input.name) },
		]);
		if (kept.length === 0) throw new ActionError("A Never touch rule matches that name.", 403);
		return c.json({ id: await newProjects.create(input) });
	});

	const needRun = (id: number) => {
		const run = newProjects.get(id);
		if (!run) throw new ActionError("That new project doesn't exist.", 404);
		return run;
	};

	app.get("/api/new-project/:id", (c) => c.json(needRun(num(c.req.param("id")))));

	const startScaffold = (c: {
		req: { param: (k: string) => string | undefined };
		json: (v: unknown) => Response;
	}) => {
		const id = num(c.req.param("id"));
		needRun(id);
		void newProjects.scaffold(id).catch((e) => console.error(scrub(String(e))));
		return c.json(ok);
	};
	app.post("/api/new-project/:id/approve", startScaffold as never);
	app.post("/api/new-project/:id/retry", startScaffold as never);

	app.post("/api/new-project/:id/remove", async (c) => {
		const res = await newProjects.remove(num(c.req.param("id")));
		return c.json(res);
	});
	app.post("/api/new-project/:id/connect", async (c) => {
		const { service } = await body(c.req, z.object({ service: z.string() }));
		return c.json(await newProjects.connect(num(c.req.param("id")), service));
	});
	app.post("/api/new-project/:id/service", async (c) => {
		const { service, state } = await body(
			c.req,
			z.object({ service: z.string(), state: z.enum(["open", "skipped"]) }),
		);
		newProjects.setService(num(c.req.param("id")), service, state);
		return c.json(ok);
	});
	app.post("/api/new-project/:id/finish", async (c) => {
		const id = num(c.req.param("id"));
		const { idea } = await body(c.req, z.object({ idea: z.string().nullish() }));
		const run = needRun(id);
		let workOrderId: number | null = null;
		if (idea?.trim() && run.projectSlug) {
			workOrderId = engine.create({
				project: run.projectSlug,
				type: "Feature",
				title: firstLine(idea),
				description: idea,
				source: { kind: "new_project" },
			});
			newProjects.setWorkOrder(id, workOrderId);
		}
		newProjects.finish(id);
		return c.json({ workOrderId, project: run.projectSlug });
	});

	/* ---------- live updates ---------- */

	app.get("/api/events", (c) =>
		streamSSE(c, async (stream) => {
			let closed = false;
			const unsubscribe = bus.subscribe((keys) => {
				if (!closed) void stream.writeSSE({ event: "changed", data: JSON.stringify({ keys }) });
			});
			stream.onAbort(() => {
				closed = true;
				unsubscribe();
			});
			await stream.writeSSE({ event: "hello", data: JSON.stringify({ build: buildId() }) });
			while (!closed) {
				await stream.sleep(25_000);
				if (!closed) await stream.writeSSE({ event: "ping", data: "" });
			}
		}),
	);

	if (devOrigin) app.get("/api/session", (c) => c.json({ token: config.sessionToken }));

	d.extend?.(app);

	app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

	/* ---------- the page ---------- */

	app.get("*", (c) => {
		const rel = normalize(decodeURIComponent(c.req.path)).replace(/^\/+/, "");
		const file = resolve(webRoot, rel);
		if (
			rel &&
			file.startsWith(`${webRoot}/`) &&
			existsSync(file) &&
			statSync(file).isFile() &&
			!file.endsWith("index.html")
		) {
			const immutable = rel.startsWith("assets/");
			return c.body(readFileSync(file), 200, {
				"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
				"Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
			});
		}
		const index = join(webRoot, "index.html");
		if (!existsSync(index)) return c.text("The page isn't built yet. Run pnpm build.", 503);
		const html = readFileSync(index, "utf8").replace(
			"</head>",
			`<meta name="sf-session" content="${config.sessionToken}"><meta name="sf-build" content="${buildId()}"></head>`,
		);
		return c.html(html, 200, { "Cache-Control": "no-store" });
	});

	return app;
}

const firstLine = (text: string) => {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 80 ? `${line.slice(0, 77)}…` : line;
};

export type { Settings };
export { CSP, SESSION_HEADER };
