#!/usr/bin/env node
/** Installs Software Factory as a launchd agent for this user: it starts at login and restarts if it stops. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LABEL = "com.appelent.software-factory";
const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const root = resolve(new URL("..", import.meta.url).pathname);
const domain = `gui/${process.getuid()}`;
const logs = join(homedir(), "Library", "Logs", "Software Factory");
const run = (...args) => execFileSync("launchctl", args, { stdio: "pipe" });
const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const command = process.argv[2];

if (command === "install") {
	if (!existsSync(join(root, "dist/web/index.html"))) {
		console.error("Run pnpm build first.");
		process.exit(1);
	}
	mkdirSync(logs, { recursive: true });
	mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
	writeFileSync(
		plist,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key><array>
		<string>${xml(process.execPath)}</string>
		<string>${xml(join(root, "src/server/main.ts"))}</string>
	</array>
	<key>WorkingDirectory</key><string>${xml(root)}</string>
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
	console.log("Software Factory is running at http://127.0.0.1:4310");
} else if (command === "uninstall") {
	try {
		run("bootout", `${domain}/${LABEL}`);
	} catch {}
	rmSync(plist, { force: true });
	console.log("Removed the launchd agent. Your data folder is untouched.");
} else {
	console.error("Usage: service.mjs install | uninstall");
	process.exit(1);
}
