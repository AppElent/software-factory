#!/usr/bin/env node
/**
 * Watches a version switch from outside the service. If the new version doesn't answer in time, this puts `current`
 * back and restarts the service. It runs from the old version's folder and needs nothing installed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { port, to, from, dir, kick, waitMs, everyMs } = JSON.parse(process.argv[2]);
const base = `http://127.0.0.1:${port}`;

const healthy = async () => {
	try {
		const version = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(everyMs) });
		if (!version.ok) return false;
		const { sha } = await version.json();
		if (sha !== to) return false;
		const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(everyMs) });
		return page.ok;
	} catch {
		return false;
	}
};

// Counted in tries, not by the clock, so a closed lid doesn't use up the wait.
for (let tries = Math.ceil(waitMs / everyMs); tries > 0; tries -= 1) {
	if (await healthy()) process.exit(0);
	await new Promise((r) => setTimeout(r, everyMs));
}
if (await healthy()) process.exit(0);

const link = join(dir, `.current-${from}`);
rmSync(link, { force: true });
symlinkSync(from, link);
renameSync(link, join(dir, "current"));

const manifest = join(dir, "versions.json");
const at = new Date().toISOString();
const rows = JSON.parse(readFileSync(manifest, "utf8")).map((r) =>
	r.sha === to
		? { ...r, state: "failed", at, error: "It didn't start or failed its check, so the factory went back." }
		: r.sha === from
			? { ...r, state: "running", at }
			: r,
);
writeFileSync(`${manifest}.tmp`, JSON.stringify(rows, null, 1));
renameSync(`${manifest}.tmp`, manifest);

try {
	execFileSync(kick[0], kick.slice(1), { stdio: "ignore" });
} catch {
	// Launchd keeps the service alive anyway, and the next start reads `current`.
}
