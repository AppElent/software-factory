import { clearCredential, loadConfig, saveConfig } from "./config";
import { CliError } from "./errors";
import type { CliRuntime } from "./run";

function isExpired(expiresAt: number | undefined): boolean {
	return typeof expiresAt === "number" && expiresAt <= Date.now();
}

export function decodeJwtExpiry(token: string): number | undefined {
	const [, body] = token.split(".");
	if (!body) return undefined;

	try {
		const parsed = JSON.parse(
			Buffer.from(body, "base64url").toString("utf8"),
		) as {
			exp?: unknown;
		};
		return typeof parsed.exp === "number" && Number.isFinite(parsed.exp)
			? parsed.exp * 1000
			: undefined;
	} catch {
		return undefined;
	}
}

export async function saveToken(
	token: string,
	runtime: CliRuntime,
): Promise<void> {
	const config = await loadConfig(runtime);
	await saveConfig(
		{
			...config,
			credential: { token, expiresAt: decodeJwtExpiry(token) },
		},
		runtime,
	);
}

export async function requireCredential(runtime: CliRuntime): Promise<string> {
	const config = await loadConfig(runtime);
	const token = config.credential?.token;
	if (!token) throw new CliError("MissingAuth");
	if (isExpired(config.credential?.expiresAt))
		throw new CliError("ExpiredAuth");
	return token;
}

export async function logout(runtime: CliRuntime): Promise<void> {
	await clearCredential(runtime);
}

export async function getCredentialStatus(runtime: CliRuntime): Promise<{
	signedIn: boolean;
	expiresAt?: number;
	expired: boolean;
}> {
	const config = await loadConfig(runtime);
	const signedIn = Boolean(config.credential?.token);
	const expiresAt = config.credential?.expiresAt;
	return {
		signedIn,
		expiresAt,
		expired: signedIn && isExpired(expiresAt),
	};
}
