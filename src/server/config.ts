import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	dataDir: string;
	port: number;
	host: "127.0.0.1";
	sessionToken: string;
	demo: boolean;
}

const fromHome = (...p: string[]) => join(homedir(), ...p);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const dataDir = env.SF_DATA_DIR ?? fromHome("Library", "Application Support", "Software Factory");
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	return {
		dataDir,
		port: Number(env.SF_PORT ?? 4310),
		host: "127.0.0.1",
		sessionToken: sessionToken(dataDir),
		demo: env.SF_DEMO === "1",
	};
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

/** Never-touch rules are private config: a JSON file in the data folder, never in the repo or the database. */
export function readNeverTouch(dataDir: string): string[] {
	const file = join(dataDir, "never-touch.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return Array.isArray(parsed) ? parsed.filter((r) => typeof r === "string") : [];
	} catch {
		// A broken file must not silently allow everything through.
		throw new Error(`${file} isn't valid JSON. Fix it before the factory reads any repo.`);
	}
}

export function writeNeverTouch(dataDir: string, rules: string[]): void {
	writeFileSync(join(dataDir, "never-touch.json"), `${JSON.stringify(rules, null, "\t")}\n`, { mode: 0o600 });
}
