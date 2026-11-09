import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * What must survive losing this app: settings, modes, environments, and which projects you run. It's a plain file
 * outside the data folder, so you can read it, copy it to a new Mac, and delete the database without losing them.
 */
export const ModeSchema = z.object({
	id: z.string().regex(/^[a-z0-9-]{1,40}$/),
	name: z.string().trim().min(1).max(40),
	description: z.string().max(200),
	prompt: z.string().max(8000),
	plan: z.enum(["follow", "always", "skip"]),
	merge: z.enum(["you", "factory"]),
	provider: z
		.string()
		.regex(/^[\w.-]{1,40}$/)
		.nullable(),
	model: z
		.string()
		.regex(/^[\w.:/-]{1,80}$/)
		.nullable(),
	builtin: z.boolean(),
});

export const EnvironmentSchema = z.object({
	// Part of a fingerprint and shown in commands, so no colons or quotes.
	name: z
		.string()
		.trim()
		.regex(/^[\w .-]{1,40}$/),
	url: z.url({ protocol: /^https?$/ }).nullable(),
	healthUrl: z.url({ protocol: /^https?$/ }).nullable(),
	deployCommand: z.string().max(2000).nullable(),
	sentryEnvironment: z.string().max(80).nullable(),
	issueLabel: z.string().max(80).nullable(),
	production: z.boolean(),
});

export const ProjectEntrySchema = z.object({
	repo: z.string(),
	slug: z
		.string()
		.regex(/^[\w.-]+$/)
		.optional(),
	name: z.string().optional(),
	localPath: z.string().nullable(),
	paused: z.boolean().optional(),
	merging: z.enum(["follow", "ask"]).optional(),
	sentryProject: z.string().nullable().optional(),
	sentrySkipped: z.boolean().optional(),
});

const byType = <T extends z.ZodType>(value: T) => z.record(z.string(), value).optional();

/** Only what the app reads. A wrong type here reads as a broken file, instead of as yes or as a crash. */
const SettingsSchema = z
	.object({
		agents: z
			.object({
				agentsAtOnce: z.number().optional(),
				pauseOnReview: z.boolean().optional(),
				retries: z.number().optional(),
				agent: z.string().optional(),
			})
			.loose()
			.optional(),
		approvals: z
			.object({
				planReview: byType(z.enum(["always", "skip"])),
				mergeWithoutMe: byType(z.boolean()),
				turnedOffByRegression: byType(z.boolean()),
				thresholds: z.object({ runs: z.number(), firstTryPct: z.number() }).loose().optional(),
			})
			.loose()
			.optional(),
		notifications: z
			.object({ events: byType(z.boolean()), onlyWhenAway: z.boolean().optional() })
			.loose()
			.optional(),
		cloneFolder: z.string().optional(),
	})
	.loose();

const Schema = z
	.object({
		version: z.literal(1).default(1),
		settings: SettingsSchema.default({}),
		modes: z.array(ModeSchema.loose()).optional(),
		defaultMode: z.string().optional(),
		environments: z.record(z.string(), z.array(EnvironmentSchema.loose())).default({}),
		projects: z.array(ProjectEntrySchema.loose()).default([]),
		// A key this version doesn't know may belong to a newer one, or to you.
	})
	.loose();

export type ConfigData = z.infer<typeof Schema>;
const empty = (): ConfigData => Schema.parse({});

export class ConfigFileError extends Error {}

export class ConfigFile {
	readonly path: string;
	private cached: { stamp: string; data: ConfigData; error: string | null } | null = null;

	constructor(dir: string) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		this.path = join(dir, "config.json");
	}

	private load() {
		if (!existsSync(this.path)) return { stamp: "", data: empty(), error: null };
		const s = statSync(this.path);
		const stamp = `${s.mtimeMs}:${s.size}`;
		if (this.cached?.stamp === stamp) return this.cached;
		let next: { stamp: string; data: ConfigData; error: string | null };
		try {
			const parsed = Schema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
			next = parsed.success
				? { stamp, data: parsed.data, error: null }
				: { stamp, data: empty(), error: `${this.path} doesn't have the expected shape.` };
		} catch {
			next = { stamp, data: empty(), error: `${this.path} isn't valid JSON.` };
		}
		this.cached = next;
		return next;
	}

	read(): ConfigData {
		return this.load().data;
	}

	/** Why the file can't be used, in words. While it's set, saving is refused so your file isn't overwritten. */
	error(): string | null {
		return this.load().error;
	}

	update(change: (data: ConfigData) => ConfigData): void {
		const current = this.load();
		if (current.error) throw new ConfigFileError(`${current.error} Fix it, then try again.`);
		const next = Schema.parse(change(current.data));
		// Written whole and renamed, so a crash leaves the old file rather than half of the new one.
		const tmp = `${this.path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, { mode: 0o600 });
		chmodSync(tmp, 0o600);
		renameSync(tmp, this.path);
	}

	/** Demo scenarios start clean. */
	reset(): void {
		rmSync(this.path, { force: true });
		this.cached = null;
	}
}
