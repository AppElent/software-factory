/**
 * Forwards failed Convex executions, including scheduled and other unattended
 * functions, from `convex logs --jsonl` to Sentry. Copy to scripts/ and add
 * `"sentry:convex": "node scripts/convex-sentry.mjs"`; needs @sentry/node.
 *
 *   pnpm sentry:convex --prod
 *   pnpm sentry:convex --deployment <name>
 *
 * Env: SENTRY_CONVEX_DSN (or SENTRY_DSN), optional SENTRY_ENVIRONMENT and
 * SENTRY_APP (surface tag, default `<package name>-convex`), and Convex CLI
 * auth (a logged-in CLI or a private CONVEX_DEPLOY_KEY).
 *
 * Best effort: delivery is in memory, so failures older than the replayed
 * history are lost while the forwarder is down. Run it on an always-on host.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HISTORY = 100;
const SEEN_LIMIT = 10_000;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

/** Strips credentials, email addresses, and logged values from error text. */
export function sanitizeText(value) {
	return value
		.replace(/Bearer\s+[^\s"']+/gi, "Bearer [Filtered]")
		.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[Filtered]")
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[Filtered]")
		.replace(
			/([?&](?:token|key|password|secret|email|code|authorization)=)[^&#\s]*/gi,
			"$1[Filtered]",
		)
		.replace(/^(\s*(?:Object|Value):).*$/gm, "$1 [Filtered]");
}

/**
 * One `convex logs --jsonl` record as a Sentry exception, or null. Only final
 * failed completions, and only structural fields: never log lines, arguments,
 * return values, or the caller's identity.
 */
export function executionErrorEvent(entry, { deployment, app }) {
	if (entry?.kind !== "Completion") return null;
	if (typeof entry.error !== "string" || !entry.error) return null;
	if (typeof entry.identifier !== "string") return null;
	if (typeof entry.timestamp !== "number") return null;
	// Convex retries an OCC conflict; only the final failure counts.
	if (entry.willRetry === true) return null;
	const stack = sanitizeText(entry.error);
	const error = new Error(stack.split("\n")[0]);
	error.stack = stack;
	const eventId = createHash("sha256")
		.update(
			JSON.stringify([
				deployment,
				entry.requestId,
				entry.executionId,
				entry.identifier,
				entry.timestamp,
			]),
		)
		.digest("hex")
		.slice(0, 32);
	return {
		error,
		eventId,
		// Seconds, which is also what a Sentry event timestamp uses.
		timestamp: entry.timestamp,
		tags: {
			app,
			func: entry.identifier,
			func_type: String(entry.udfType || "unknown"),
			...(typeof entry.caller === "string" ? { caller: entry.caller } : {}),
			...(typeof entry.requestId === "string"
				? { request_id: entry.requestId }
				: {}),
		},
	};
}

async function main(args) {
	const index = args.indexOf("--deployment");
	const deployment = args.includes("--prod")
		? "production"
		: index >= 0
			? args[index + 1]
			: process.env.CONVEX_DEPLOYMENT;
	if (!deployment) {
		console.error("Select one deployment: --prod, --deployment <name>, or CONVEX_DEPLOYMENT.");
		process.exit(1);
	}
	const dsn = process.env.SENTRY_CONVEX_DSN || process.env.SENTRY_DSN;
	if (!dsn) {
		console.error("Set SENTRY_CONVEX_DSN or SENTRY_DSN.");
		process.exit(1);
	}
	const app =
		process.env.SENTRY_APP || `${process.env.npm_package_name || "app"}-convex`;
	const Sentry = await import("@sentry/node");
	Sentry.init({
		dsn,
		environment:
			process.env.SENTRY_ENVIRONMENT ||
			(args.includes("--prod") ? "production" : "development"),
		serverName: deployment,
		defaultIntegrations: false,
		dataCollection: {
			userInfo: false,
			cookies: false,
			httpHeaders: false,
			httpBodies: [],
			urlQueryParams: false,
			stackFrameVariables: false,
		},
		beforeSend(event) {
			delete event.request;
			delete event.extra;
			delete event.user;
			return event;
		},
	});

	const seen = new Set();
	let child;
	let stopping = false;
	let backoff = MIN_BACKOFF_MS;
	const forward = (line) => {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		backoff = MIN_BACKOFF_MS;
		const result = executionErrorEvent(entry, { deployment, app });
		if (!result || seen.has(result.eventId)) return;
		seen.add(result.eventId);
		if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
		Sentry.withScope((scope) => {
			scope.addEventProcessor((event) => ({ ...event, timestamp: result.timestamp }));
			Sentry.captureException(result.error, {
				event_id: result.eventId,
				tags: result.tags,
			});
		});
	};
	const start = () => {
		console.log(`Forwarding Convex failures (${deployment}) to Sentry.`);
		child = spawn(
			"pnpm",
			["exec", "convex", "logs", "--jsonl", "--history", String(HISTORY), ...args],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		const lines = createInterface({ input: child.stdout });
		lines.on("line", forward);
		child.on("error", () => console.error("Could not start the Convex log reader."));
		child.on("close", (code) => {
			lines.close();
			if (stopping) return;
			console.error(`Convex log reader exited (${code}); reconnecting in ${backoff / 1000}s.`);
			setTimeout(start, backoff);
			backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		});
	};
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		child?.kill("SIGTERM");
		await Sentry.close(5_000);
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	start();
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
	await main(process.argv.slice(2));
