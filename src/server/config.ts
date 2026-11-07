import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { applyNeverTouch } from "../shared/rules.ts";

export interface Config {
	dataDir: string;
	/** Where the plain config file and never-touch rules live. Deleting the data folder leaves them. */
	configDir?: string;
	port: number;
	host: "127.0.0.1";
	sessionToken: string;
	demo: boolean;
}

const fromHome = (...p: string[]) => join(homedir(), ...p);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const demo = env.SF_DEMO === "1";
	// Sample data replaces what's there, so it never runs on the real folders.
	if (demo && !env.SF_DATA_DIR) throw new Error("Sample data needs its own folder. Set SF_DATA_DIR.");
	const dataDir = env.SF_DATA_DIR ?? fromHome("Library", "Application Support", "Software Factory");
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	// A chosen data folder, as in demo mode and tests, keeps everything together and away from the real config.
	const configDir = demo
		? dataDir
		: (env.SF_CONFIG_DIR ?? (env.SF_DATA_DIR ? dataDir : fromHome(".config", "software-factory")));
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	moveNeverTouch(dataDir, configDir);
	return {
		dataDir,
		configDir,
		port: Number(env.SF_PORT ?? 4310),
		host: "127.0.0.1",
		sessionToken: sessionToken(dataDir),
		demo,
	};
}

/** Older installs kept the rules in the data folder. Deleting that folder must not delete a safety rule. */
function moveNeverTouch(dataDir: string, configDir: string) {
	const from = join(dataDir, "never-touch.json");
	const to = join(configDir, "never-touch.json");
	if (dataDir !== configDir && existsSync(from) && !existsSync(to)) copyFileSync(from, to);
}

/** One token per install. It lives only in the data folder and the served page. */
function sessionToken(dataDir: string): string {
	const file = join(dataDir, "session-token");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	const token = randomBytes(32).toString("hex");
	writeFileSync(file, token, { mode: 0o600 });
	chmodSync(file, 0o600);
	return token;
}

const realOr = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		// Not there yet. Where it will land still depends on the folders above it.
		const parent = dirname(path);
		return parent === path ? path : join(realOr(parent), basename(path));
	}
};

/** Never touch judges both the path given and where it really leads, so a symlink can't lead around a rule. */
export function filterNeverTouch<T extends { repo?: string; path?: string | null }>(
	rules: string[],
	items: T[],
) {
	const { kept, skipped } = applyNeverTouch(rules, items);
	const out: { kept: T[]; skipped: T[] } = { kept: [], skipped };
	for (const item of kept) {
		const real = item.path ? { ...item, path: realOr(item.path) } : item;
		(applyNeverTouch(rules, [real]).kept.length ? out.kept : out.skipped).push(item);
	}
	return out;
}

/** The rules can't be read, so nothing can be shown or done safely until the file is fixed. */
export class NeverTouchError extends Error {}

/** Never-touch rules are private config: a JSON file beside the config file, never in the repo or the database. */
export function readNeverTouch(configDir: string): string[] {
	const file = join(configDir, "never-touch.json");
	if (!existsSync(file)) return [];
	// A broken file must not silently allow everything through, or drop a rule it couldn't read.
	const refuse = () =>
		new NeverTouchError(`${file} must be a JSON list of strings. Fix it before the factory reads any repo.`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw refuse();
	}
	if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === "string")) throw refuse();
	return parsed;
}

export function writeNeverTouch(configDir: string, rules: string[]): void {
	writeFileSync(join(configDir, "never-touch.json"), `${JSON.stringify(rules, null, "\t")}\n`, {
		mode: 0o600,
	});
}

/** This app's own repo, from its checkout's origin. Forks and copies get their own. */
export function selfRepo(root: string = resolve(import.meta.dirname, "../..")): string | null {
	try {
		const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
		return /[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/.exec(url)?.[1] ?? null;
	} catch {
		return null;
	}
}
