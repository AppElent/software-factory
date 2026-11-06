import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { platform } from "node:process";

import { saveToken } from "./auth";
import { loadConfig } from "./config";
import { CliError } from "./errors";
import type { CliRuntime } from "./run";

export type BrowserLoginOptions = {
	loginPath?: string;
	callbackPath?: string;
	timeoutMs?: number;
	openBrowser?: (url: string) => Promise<void> | void;
};

const DEFAULT_LOGIN_PATH = "/api/cli/auth/login";
const DEFAULT_CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 120_000;

function writeHtml(response: ServerResponse, statusCode: number, body: string) {
	response.writeHead(statusCode, {
		"Content-Type": "text/html; charset=utf-8",
	});
	response.end(body);
}

function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			const address = server.address();
			if (typeof address === "object" && address !== null) {
				resolve(address.port);
				return;
			}
			reject(
				new CliError("Unsupported", "Could not start login callback server."),
			);
		});
	});
}

function closeServer(server: Server) {
	server.close(() => undefined);
}

function defaultOpenBrowser(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// rundll32 opens the URL directly via the OS URL handler, unlike
		// `cmd /c start`, which re-parses the URL as a shell command line and
		// mangles it at the first `&` (every query string with more than one
		// param) or `%` (percent-encoded octets read as env var expansion).
		const command =
			platform === "win32"
				? "rundll32"
				: platform === "darwin"
					? "open"
					: "xdg-open";
		const args =
			platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
		const child = spawn(command, args, {
			detached: true,
			stdio: "ignore",
		});
		// spawn() cannot throw synchronously for a missing launcher binary
		// (e.g. xdg-open on a minimal Linux install) — the failure surfaces
		// as an async "error" event. Without a listener, Node treats that as
		// an unhandled error and crashes the process instead of letting the
		// caller's try/catch fall back to printing the login URL.
		child.once("error", reject);
		child.once("spawn", () => {
			child.off("error", reject);
			resolve();
		});
		child.unref();
	});
}

export async function startBrowserLogin(runtime: CliRuntime): Promise<void> {
	const config = await loadConfig(runtime);
	const options = runtime.auth ?? {};
	const loginPath = options.loginPath ?? DEFAULT_LOGIN_PATH;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const state = randomUUID();
	const server = createServer();

	const loginResult = new Promise<void>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			settle(
				new CliError("Usage", "Timed out waiting for browser login callback."),
			);
		}, timeoutMs);

		function settle(error?: unknown) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			closeServer(server);
			if (error) {
				reject(error);
				return;
			}
			resolve();
		}

		server.on("request", async (request, response) => {
			const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
			const callbackUrl = new URL(callbackPath, origin);
			const requestUrl = new URL(request.url ?? "/", origin);

			if (
				request.method !== "GET" ||
				requestUrl.pathname !== callbackUrl.pathname
			) {
				writeHtml(response, 404, "Not found.");
				return;
			}

			if (requestUrl.searchParams.get("state") !== state) {
				const error = new CliError(
					"Usage",
					"Browser login state did not match.",
				);
				writeHtml(response, 400, error.message);
				settle(error);
				return;
			}

			const loginError = requestUrl.searchParams.get("error");
			if (loginError) {
				const description =
					requestUrl.searchParams.get("error_description") ?? loginError;
				const error = new CliError(
					"Usage",
					`Browser login failed: ${description}`,
				);
				writeHtml(response, 400, error.message);
				settle(error);
				return;
			}

			const token = requestUrl.searchParams.get("token");
			if (!token || token.trim().length === 0 || token.trim() !== token) {
				const error = new CliError(
					"Usage",
					"Browser login callback did not include a token.",
				);
				writeHtml(response, 400, error.message);
				settle(error);
				return;
			}

			try {
				await saveToken(token, runtime);
				writeHtml(response, 200, "Signed in. You can close this tab.");
				settle();
			} catch (error) {
				writeHtml(response, 500, "Could not save CLI credential.");
				settle(error);
			}
		});
	});
	loginResult.catch(() => undefined);

	const port = await listen(server);
	const callbackUrl = new URL(callbackPath, `http://127.0.0.1:${port}`);
	const loginUrl = new URL(loginPath, config.apiUrl);
	loginUrl.searchParams.set("redirect_uri", callbackUrl.toString());
	loginUrl.searchParams.set("state", state);

	try {
		await (options.openBrowser ?? defaultOpenBrowser)(loginUrl.toString());
	} catch {
		closeServer(server);
		throw new CliError(
			"Unsupported",
			`Could not open a browser. Visit ${loginUrl.toString()} to sign in.`,
		);
	}

	await loginResult;
}
