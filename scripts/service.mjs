#!/usr/bin/env node
/** Installs Software Factory as a launchd agent for this user: it starts at login and restarts if it stops. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LABEL = process.env.SF_SERVICE_LABEL ?? "com.appelent.software-factory";

/** Homebrew removes a version's folder when it upgrades. Its `opt` path follows along. */
const stableNode = () =>
	process.execPath.replace(/\/Cellar\/(node(?:@[^/]+)?)\/[^/]+\/bin\/node$/, "/opt/$1/bin/node");
const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const root = resolve(new URL("..", import.meta.url).pathname);
const domain = `gui/${process.getuid()}`;
const logs = join(homedir(), "Library", "Logs", "Software Factory");
const run = (...args) => execFileSync("launchctl", args, { stdio: "pipe" });
const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const releases =
	process.env.SF_RELEASES_DIR ??
	join(homedir(), "Library", "Application Support", "Software Factory Releases");
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();

/** Each version gets a folder of its own, so the service never runs from the checkout you're editing. */
function installRelease() {
	const sha = sh("git", ["rev-parse", "HEAD"], root);
	const message = sh("git", ["log", "-1", "--format=%s"], root);
	const folder = join(releases, sha);
	mkdirSync(releases, { recursive: true });
	if (!existsSync(join(folder, "dist/web/index.html"))) {
		rmSync(folder, { recursive: true, force: true });
		const tmp = join(releases, `.tmp-${sha}`);
		rmSync(tmp, { recursive: true, force: true });
		console.log(`Preparing ${sha.slice(0, 7)}. This takes a minute.`);
		sh("git", ["clone", "--quiet", root, tmp]);
		sh("git", ["remote", "set-url", "origin", sh("git", ["remote", "get-url", "origin"], root)], tmp);
		sh("git", ["checkout", "--quiet", "--detach", sha], tmp);
		sh("pnpm", ["install", "--frozen-lockfile"], tmp);
		sh("pnpm", ["build"], tmp);
		renameSync(tmp, folder);
	}
	const link = join(releases, `.current-${sha}`);
	rmSync(link, { force: true });
	symlinkSync(sha, link);
	renameSync(link, join(releases, "current"));
	const manifest = join(releases, "versions.json");
	const at = new Date().toISOString();
	const rows = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : [];
	const others = rows
		.filter((r) => r.sha !== sha)
		.map((r) => (r.state === "running" ? { ...r, state: "replaced", at } : r));
	const row = { sha, label: sha.slice(0, 7), message, state: "running", error: null, at, canRollBack: false };
	writeFileSync(manifest, JSON.stringify([row, ...others], null, 1));
	return join(releases, "current");
}

const command = process.argv[2];

if (command === "install") {
	const current = installRelease();
	mkdirSync(logs, { recursive: true });
	mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
	writeFileSync(
		plist,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key><array>
		<string>${xml(stableNode())}</string>
		<string>${xml(join(current, "src/server/main.ts"))}</string>
	</array>
	<key>WorkingDirectory</key><string>${xml(current)}</string>
	<key>EnvironmentVariables</key><dict>
		<key>SF_SERVICE_LABEL</key><string>${xml(LABEL)}</string>
		<key>SF_RELEASES_DIR</key><string>${xml(releases)}</string>
		${["SF_PORT", "SF_DATA_DIR", "SF_CONFIG_DIR", "SF_DEMO"]
			.filter((k) => process.env[k])
			.map((k) => `<key>${k}</key><string>${xml(process.env[k])}</string>`)
			.join("\n\t\t")}
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>StandardOutPath</key><string>${xml(join(logs, "service.log"))}</string>
	<key>StandardErrorPath</key><string>${xml(join(logs, "service.log"))}</string>
</dict></plist>
`,
	);
	try {
		run("bootout", `${domain}/${LABEL}`);
	} catch {}
	run("bootstrap", domain, plist);
	console.log(`Software Factory is running at http://127.0.0.1:${process.env.SF_PORT ?? 4310}`);
} else if (command === "uninstall") {
	try {
		run("bootout", `${domain}/${LABEL}`);
	} catch {}
	rmSync(plist, { force: true });
	rmSync(releases, { recursive: true, force: true });
	console.log(
		"Removed the launchd agent and its copies of the app. Your data folder and config file are untouched.",
	);
} else {
	console.error("Usage: service.mjs install | uninstall");
	process.exit(1);
}
