import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NewProjectLogLine, NewProjectRun, ToolStatus } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { cliEnv, scrub } from "./cli.ts";
import { filterNeverTouch } from "./config.ts";
import { checkTools } from "./connectors/tools.ts";
import { audit } from "./db.ts";
import type { Store } from "./store.ts";

export const SCAFFOLD_STEPS = ["repo", "folder", "template", "baseline", "t3"] as const;
export type ScaffoldStep = (typeof SCAFFOLD_STEPS)[number];

const LABELS: Record<ScaffoldStep, (r: NewProjectRun) => string> = {
	repo: (r) => `Create ${r.repo}`,
	folder: (r) => `Create ${r.localPath}`,
	template: (r) => `Apply the ${templateName(r.template)} template`,
	baseline: () => "Run the baseline: typecheck, tests, lint",
	t3: () => "Add it to T3",
};

export const TEMPLATES: Record<string, string> = {
	expo: "Expo app",
	vite: "Vite web app",
	node: "Node service",
	bare: "Toolkit only",
};
export const templateName = (t: string) => TEMPLATES[t] ?? t;

export type ScaffoldRunner = (
	run: NewProjectRun,
	step: ScaffoldStep,
	cli: Cli,
) => Promise<{ ok: boolean; detail?: string }>;

const ROOT = new URL("../../", import.meta.url).pathname;

/** Each step is one call to scripts/new-project.mjs, which is resumable and has a dry run. */
export const scriptRunner: ScaffoldRunner = (run, step) =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[
				join(ROOT, "scripts/new-project.mjs"),
				"--step",
				step,
				"--repo",
				run.repo,
				"--folder",
				run.localPath,
				"--template",
				run.template,
				"--visibility",
				run.visibility,
				"--description",
				run.description,
			],
			{ env: cliEnv(), timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) resolve({ ok: false, detail: `${stderr}\n${stdout}`.trim().slice(-2000) });
				else resolve({ ok: true });
			},
		);
	});

const folderInUse = (folder: string) => existsSync(folder) && readdirSync(folder).length > 0;

export class NewProjects {
	private readonly store: Store;
	private readonly cli: Cli;
	private readonly runner: ScaffoldRunner;
	private readonly publish: (keys: string[]) => void;
	private readonly addProject: (repo: string, localPath: string) => string;
	/** Runs scaffolding right now. A saved `scaffold` step without one means the service restarted mid-run. */
	private readonly running = new Set<number>();

	constructor(deps: {
		store: Store;
		cli: Cli;
		runner?: ScaffoldRunner;
		publish: (keys: string[]) => void;
		addProject: (repo: string, localPath: string) => string;
	}) {
		this.store = deps.store;
		this.cli = deps.cli;
		this.runner = deps.runner ?? scriptRunner;
		this.publish = deps.publish;
		this.addProject = deps.addProject;
		this.recover();
	}

	/** Nothing survives a restart mid-run, so a saved `scaffold` step stopped there. It goes back to the owner. */
	private recover() {
		const rows = this.store.db.prepare("SELECT id FROM new_projects").all() as Array<{ id: number }>;
		for (const { id } of rows) {
			const run = this.get(id);
			if (run?.step !== "scaffold") continue;
			const line = run.log.find((l) => l.state === "running") ?? run.log.find((l) => l.state !== "done");
			const detail = "The service restarted during this step. Retry to pick up where it stopped.";
			if (line) {
				line.state = "failed";
				line.detail = detail;
			}
			run.failure = detail;
			run.step = "failed";
			run.failedAt = this.store.iso();
			this.save(run);
		}
	}

	get(id: number): NewProjectRun | null {
		const row = this.store.db.prepare("SELECT json FROM new_projects WHERE id = ?").get(id) as
			| { json: string }
			| undefined;
		return row ? { ...JSON.parse(row.json), id } : null;
	}

	private save(run: NewProjectRun) {
		this.store.db.prepare("UPDATE new_projects SET json = ? WHERE id = ?").run(JSON.stringify(run), run.id);
		this.publish([`new-project:${run.id}`, "shell", "queue"]);
	}

	/** Blank name, a taken repo, a path in use. Returns a message, or null when it's fine. */
	async validate(owner: string, name: string, folder: string): Promise<string | null> {
		if (!name.trim()) return "Enter a name for the project.";
		if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return "Use letters, numbers, dashes, dots, and underscores.";
		const res = await this.cli("gh", ["repo", "view", `${owner}/${name}`, "--json", "name"]);
		if (res.code === 0) return `${owner} already has a repo with this name. Choose another name.`;
		if (folderInUse(folder)) return `${folder} already has files in it. Choose another name.`;
		return null;
	}

	async owner(): Promise<string> {
		const res = await this.cli("gh", ["api", "user", "--jq", ".login"]);
		return res.code === 0 ? res.stdout.trim() : "";
	}

	async create(input: {
		name: string;
		description: string;
		template: string;
		visibility: "private" | "public";
	}) {
		const owner = await this.owner();
		const folder = this.store.settings().projects.cloneFolder;
		const run: Omit<NewProjectRun, "id"> = {
			...input,
			repo: `${owner}/${input.name}`,
			localPath: join(folder, input.name),
			step: "approve",
			log: SCAFFOLD_STEPS.map((step) => ({ step, state: "pending", at: null })),
			failure: null,
			created: [],
			services: {},
			serviceTools: {},
			projectSlug: null,
			workOrderId: null,
		};
		const res = this.store.db.prepare("INSERT INTO new_projects (json) VALUES (?)").run(JSON.stringify(run));
		return Number(res.lastInsertRowid);
	}

	/** Runs from the first unfinished step. Doesn't block the request. */
	async scaffold(id: number): Promise<void> {
		const run = this.get(id);
		if (!run || this.running.has(id)) return;
		if (!["approve", "scaffold", "failed", "baseline"].includes(run.step)) return;
		this.running.add(id);
		try {
			await this.runSteps(run);
		} finally {
			this.running.delete(id);
		}
	}

	/** What's there may have changed since the name was checked. This run never adopts what it didn't make. */
	private async alreadyThere(run: NewProjectRun, step: ScaffoldStep): Promise<string | null> {
		if (step === "repo") {
			const res = await this.cli("gh", ["repo", "view", run.repo, "--json", "name"]);
			if (res.code === 0) return `${run.repo} already exists, and this run didn't make it.`;
			// Only GitHub saying it's free counts. A failed look proves nothing.
			if (!/could not resolve to a repository/i.test(res.stderr))
				return `Couldn't check whether ${run.repo} exists. ${scrub(res.stderr).trim()}`.trim();
		}
		if (step === "folder" && folderInUse(run.localPath))
			return `${run.localPath} already has files in it, and this run didn't put them there.`;
		return null;
	}

	private async runSteps(run: NewProjectRun): Promise<void> {
		run.step = "scaffold";
		run.failure = null;
		this.save(run);
		const startedAt = this.store.now().getTime();
		for (const line of run.log) {
			if (line.state === "done") continue;
			// A rule can be added between approving and any step. It wins, before this touches anything.
			if (this.neverTouched(run)) {
				line.state = "failed";
				line.detail = "A Never touch rule matches this project, so this stopped.";
				run.failure = line.detail;
				run.step = "failed";
				run.failedAt = this.store.iso();
				this.save(run);
				return;
			}
			line.state = "running";
			line.detail = undefined;
			this.save(run);
			const step = line.step as ScaffoldStep;
			const taken = run.claimed?.includes(step) ? null : await this.alreadyThere(run, step);
			if (!taken) {
				run.claimed = [...new Set([...(run.claimed ?? []), step])];
				this.save(run);
			}
			const result = taken ? { ok: false, detail: taken } : await this.runner(run, step, this.cli);
			// A claim only outlives a restart. A step that ran and failed gets checked again.
			if (taken || !result.ok) run.claimed = run.claimed?.filter((s) => s !== step);
			const elapsed = Math.round((this.store.now().getTime() - startedAt) / 1000);
			line.at = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
			if (!result.ok) {
				line.state = "failed";
				line.detail = result.detail && scrub(result.detail);
				run.failure = line.detail ?? `${LABELS[step](run)} failed.`;
				run.step = step === "baseline" ? "baseline" : "failed";
				run.failedAt = this.store.iso();
				// The template built, so the project exists and an agent can be given the fix.
				if (step === "baseline") this.addTo(run);
				this.save(run);
				return;
			}
			line.state = "done";
			if (step === "repo") run.created.push(`repo:${run.repo}`);
			if (step === "folder") run.created.push(`folder:${run.localPath}`);
			audit(this.store.db, `new project: ${step}`, run.repo, "you", null, this.store.now());
			this.save(run);
		}
		if (!this.addTo(run)) return;
		const tools = await checkTools(this.cli);
		const has = (n: string): ToolStatus | undefined => tools.find((t) => t.name === n);
		run.serviceTools = Object.fromEntries(
			["sentry", "eas", "infisical"].map((n) => [
				n,
				{
					installed: has(n)?.state !== "missing",
					fix: has(n)?.state === "missing" ? (has(n)?.fix ?? null) : null,
				},
			]),
		);
		run.services = {
			sentry: "open",
			eas: "open",
			infisical: has("infisical")?.state === "missing" ? "skipped" : "open",
		};
		run.step = "connect";
		this.save(run);
	}

	private neverTouched(run: NewProjectRun) {
		const { kept } = filterNeverTouch(this.store.neverTouch(), [{ repo: run.repo, path: run.localPath }]);
		return kept.length === 0;
	}

	/** A Never touch rule added while this ran refuses the project, and the page has to hear about it. */
	private addTo(run: NewProjectRun) {
		try {
			run.projectSlug = this.addProject(run.repo, run.localPath);
			return true;
		} catch (e) {
			run.step = "failed";
			run.failure = scrub(e instanceof Error ? e.message : String(e));
			run.failedAt = this.store.iso();
			this.save(run);
			return false;
		}
	}

	async connect(id: number, service: string): Promise<{ ok: boolean; reason?: string }> {
		const run = this.get(id);
		if (!run) return { ok: false, reason: "Not found" };
		if (this.neverTouched(run)) return { ok: false, reason: "A Never touch rule matches this project." };
		const name = run.name;
		const folder = run.localPath;
		let res: { code: number; stderr: string } | null = null;
		if (service === "sentry") {
			const org = await this.cli("sentry", ["org", "list", "--json"]);
			const slug = org.code === 0 ? (JSON.parse(org.stdout)?.[0]?.slug as string | undefined) : undefined;
			res = await this.cli("sentry", ["project", "create", `${slug ?? ""}/${name}`, "react-native"]);
			if (res.code === 0 && run.projectSlug) {
				this.store.db
					.prepare("UPDATE projects SET sentry_project = ? WHERE slug = ?")
					.run(name, run.projectSlug);
			}
		} else if (service === "eas") {
			res = await this.cli("eas", ["init", "--non-interactive", "--force"], { cwd: folder });
		} else if (service === "infisical") {
			res = await this.cli("infisical", ["init"], { cwd: folder });
		} else {
			return { ok: false, reason: "Unknown service" };
		}
		audit(
			this.store.db,
			`connect ${service}`,
			run.repo,
			"you",
			res.code === 0 ? null : res.stderr,
			this.store.now(),
		);
		if (res.code !== 0) return { ok: false, reason: res.stderr.trim() || "It didn't connect." };
		run.services[service] = "connected";
		this.save(run);
		return { ok: true };
	}

	setService(id: number, service: string, state: "open" | "skipped") {
		const run = this.get(id);
		if (!run) return;
		run.services[service] = state;
		this.save(run);
	}

	finish(id: number) {
		const run = this.get(id);
		if (!run) return;
		run.step = "done";
		this.save(run);
	}

	setWorkOrder(id: number, workOrderId: number) {
		const run = this.get(id);
		if (!run) return;
		run.workOrderId = workOrderId;
		this.save(run);
	}

	/** Removes only what this run created, and only what the person confirmed by name. */
	async remove(id: number): Promise<{ ok: boolean; reason?: string }> {
		const run = this.get(id);
		if (!run) return { ok: false, reason: "Not found" };
		if (this.running.has(id) || !["failed", "baseline"].includes(run.step))
			return { ok: false, reason: "This project isn't in a state that can be removed." };
		const open =
			run.projectSlug &&
			this.store.db
				.prepare("SELECT 1 FROM work_orders WHERE project = ? AND state NOT IN ('done', 'closed') LIMIT 1")
				.get(run.projectSlug);
		if (open) return { ok: false, reason: "This project has open work orders. Close them first." };
		// A rule added since then wins. The run goes, and what it made stays out of the factory's hands.
		for (const item of this.neverTouched(run) ? [] : run.created) {
			if (item.startsWith("repo:")) {
				const res = await this.cli("gh", ["repo", "delete", item.slice(5), "--yes"]);
				audit(this.store.db, "delete repo", item.slice(5), "you", res.stderr || null, this.store.now());
				// Deleted on GitHub by hand, which is what the missing scope asks people to do.
				if (res.code !== 0 && !/could not resolve to a repository/i.test(res.stderr)) {
					const scope = /delete_repo/.test(res.stderr);
					return {
						ok: false,
						reason: scope
							? "GitHub needs the delete_repo scope. Run gh auth refresh -s delete_repo, then try again."
							: res.stderr.trim(),
					};
				}
			}
			if (item.startsWith("folder:") && existsSync(item.slice(7))) {
				await this.cli("rm", ["-rf", item.slice(7)]);
				audit(this.store.db, "delete folder", item.slice(7), "you", null, this.store.now());
			}
		}
		if (run.projectSlug)
			this.store.db
				.prepare("UPDATE projects SET removed_at = ? WHERE slug = ?")
				.run(this.store.iso(), run.projectSlug);
		this.store.db.prepare("DELETE FROM new_projects WHERE id = ?").run(id);
		this.publish(["projects", "shell", "queue"]);
		return { ok: true };
	}
}

export type { NewProjectLogLine };
