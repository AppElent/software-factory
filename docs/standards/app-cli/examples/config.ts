import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";

import { CliError } from "./errors";

export type ConfigRuntime = {
	env: Record<string, string | undefined>;
	appName: string;
	defaultApiUrl?: string;
};

export type Credential = {
	token: string;
	expiresAt?: number;
};

export type CliConfig = {
	apiUrl: string;
	convexUrl?: string;
	credential?: Credential;
};

const DEFAULT_API_URL = "http://localhost:3000";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrimmedNonEmptyString(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.trim() === value
	);
}

function parseCredential(value: unknown, path: string): Credential | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || !isTrimmedNonEmptyString(value.token)) {
		throw new CliError(
			"Usage",
			`Invalid config file at ${path}: credential must include a token string.`,
		);
	}
	if (value.expiresAt !== undefined && typeof value.expiresAt !== "number") {
		throw new CliError(
			"Usage",
			`Invalid config file at ${path}: credential expiresAt must be a number.`,
		);
	}
	const credential: Credential = { token: value.token };
	if (typeof value.expiresAt === "number") {
		credential.expiresAt = value.expiresAt;
	}
	return credential;
}

function parseConfigFile(text: string, path: string): CliConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError("Usage", `Invalid config file at ${path}: ${message}`);
	}

	if (!isRecord(parsed)) {
		throw new CliError(
			"Usage",
			`Invalid config file at ${path}: expected a JSON object.`,
		);
	}

	if (!isTrimmedNonEmptyString(parsed.apiUrl)) {
		throw new CliError(
			"Usage",
			`Invalid config file at ${path}: apiUrl must be a non-empty string.`,
		);
	}

	if (
		parsed.convexUrl !== undefined &&
		!isTrimmedNonEmptyString(parsed.convexUrl)
	) {
		throw new CliError(
			"Usage",
			`Invalid config file at ${path}: convexUrl must be a non-empty string.`,
		);
	}

	return {
		apiUrl: parsed.apiUrl,
		convexUrl: parsed.convexUrl,
		credential: parseCredential(parsed.credential, path),
	};
}

export function configDir(runtime: ConfigRuntime): string {
	const envVar = `${runtime.appName.toUpperCase()}_CONFIG_DIR`;
	const override = runtime.env[envVar];
	if (override) return override;
	if (platform === "win32") {
		return join(runtime.env.APPDATA ?? homedir(), runtime.appName);
	}
	return join(
		runtime.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
		runtime.appName,
	);
}

export function configPath(runtime: ConfigRuntime): string {
	return join(configDir(runtime), "config.json");
}

export async function loadConfig(runtime: ConfigRuntime): Promise<CliConfig> {
	const path = configPath(runtime);

	try {
		const text = await readFile(path, "utf8");
		return parseConfigFile(text, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { apiUrl: runtime.defaultApiUrl ?? DEFAULT_API_URL };
		}
		throw error;
	}
}

export async function saveConfig(
	config: CliConfig,
	runtime: ConfigRuntime,
): Promise<void> {
	await mkdir(configDir(runtime), { recursive: true });
	await writeFile(
		configPath(runtime),
		`${JSON.stringify(config, null, "\t")}\n`,
	);
}

export async function clearCredential(runtime: ConfigRuntime): Promise<void> {
	const config = await loadConfig(runtime);
	const { credential: _credential, ...rest } = config;
	await saveConfig(rest, runtime);
}
