#!/usr/bin/env node
// Drives the built page in a real browser against the demo service. Needs `pnpm build` and the
// Playwright chromium headless shell. Every state must load without console errors or sideways scroll,
// and the main journeys must work with real clicks and keys.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.SF_PORT ?? 4319);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "sf-e2e-"));
const startService = () =>
	spawn(process.execPath, ["src/server/main.ts"], {
		env: { ...process.env, SF_DEMO: "1", SF_DATA_DIR: dataDir, SF_PORT: String(PORT) },
		stdio: "ignore",
	});
let service = startService();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
	if (
		await fetch(base).then(
			() => true,
			() => false,
		)
	)
		break;
	await wait(150);
}
const token = readFileSync(join(dataDir, "session-token"), "utf8").trim();

const scenario = async (name) => {
	const res = await fetch(`${base}/api/demo/scenario`, {
		method: "POST",
		headers: { "x-sf-session": token, "content-type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (!res.ok) throw new Error(`Scenario ${name}: ${res.status}`);
	return res.json();
};

const SCENARIOS = [
	"full",
	"environments",
	"no_environments",
	"automations",
	"no_automations",
	"version_ready",
	"version_failed",
	"back",
	"first_look",
	"empty",
	"quiet",
	"limit",
	"review_hold",
	"loading",
	"degraded",
	"stopped",
	"long",
	"regression",
	"merge_ready",
	"missing_folder",
	"issues_inbox",
	"no_issues",
];
const PATHS = [
	"/",
	"/floor",
	"/prs",
	"/issues",
	"/errors",
	"/environments",
	"/automations",
	"/improve",
	"/projects/fairway/environments",
	"/projects",
	"/health",
	"/settings/agents",
	"/settings/approvals",
	"/settings/notifications",
	"/settings/projects",
	"/settings/tools",
	"/settings/notifications/samples",
];

const failures = [];
const browser = await chromium.launch({ headless: true });
let checked = 0;

async function openPage(width, height = 900) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		// A failed request logs itself. The page handles those, so tests judge the page's reaction.
		if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
	});
	return { page, errors, close: () => context.close() };
}

async function checkState(label, path, width) {
	const { page, errors, close } = await openPage(width);
	await page.goto(base + path, { waitUntil: "load" });
	await page
		.locator("h1")
		.first()
		.waitFor({ timeout: 5000 })
		.catch(() => errors.push("no h1"));
	await wait(150);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (overflow > 0) errors.push(`${overflow}px sideways scroll`);
	const unnamed = await page.evaluate(() =>
		[...document.querySelectorAll("button, a[href], input, select, textarea")]
			.filter((el) => {
				const name = el.getAttribute("aria-label") || el.textContent?.trim() || el.getAttribute("title");
				const labelled = el.labels?.length || el.getAttribute("aria-labelledby");
				return !name && !labelled;
			})
			.map((el) => el.outerHTML.slice(0, 80)),
	);
	if (unnamed.length) errors.push(`no accessible name: ${unnamed[0]}`);
	// biome-ignore lint/performance/useDomNodeTextContent: this checks what's visible, and textContent includes hidden text.
	const text = await page.locator("body").innerText();
	// The sample error's own title says "properties of undefined".
	if (/\{\{|undefined|\bNaN\b|\[object/.test(text.replaceAll("properties of undefined", "")))
		errors.push("placeholder text on the page");
	if (/\$\d|spent|Cost/.test(text)) errors.push("cost text on the page");
	if (errors.length) failures.push(`${label} ${path} @${width}: ${errors.join("; ")}`);
	checked += 1;
	await close();
}

for (const name of SCENARIOS) {
	const seeded = await scenario(name);
	const ids = (seeded.ids ?? []).map((w) => `/work-orders/${w.id}`);
	for (const path of [...PATHS, ...ids]) {
		await checkState(name, path, 1440);
		if (name === "full" || name === "long") await checkState(name, path, 390);
	}
}

await scenario("config_broken");
await checkState("config_broken", "/", 1440);
await scenario("new_device");
for (const path of ["/welcome/tools", "/welcome/restore"]) await checkState("new_device", path, 1440);
await scenario("first_run");
for (const path of ["/welcome/tools", "/welcome/repos", "/projects/new/describe"])
	await checkState("first_run", path, 1440);

async function journey(name, fn) {
	const { page, errors, close } = await openPage(1440);
	try {
		await fn(page);
		if (errors.length) failures.push(`journey ${name}: ${errors.join("; ")}`);
	} catch (e) {
		failures.push(`journey ${name}: ${e.message.split("\n")[0]}`);
	}
	checked += 1;
	await close();
}

await journey("keyboard moves between pages", async (page) => {
	await scenario("full");
	await page.goto(base);
	await page.getByRole("heading", { name: "Queue", level: 1 }).waitFor();
	await page.keyboard.press("g");
	await page.keyboard.press("f");
	await page.waitForURL("**/floor");
	await page.keyboard.press("ControlOrMeta+k");
	await page.getByPlaceholder("Search or run a command").fill("Health");
	await page.keyboard.press("Enter");
	await page.waitForURL("**/health");
	await page.keyboard.press("n");
	await page.getByRole("dialog", { name: "New work order" }).waitFor();
	await page.keyboard.press("Escape");
	await page.getByRole("dialog").waitFor({ state: "detached" });
});

await journey("start a work order and watch it reach Review", async (page) => {
	await scenario("quiet");
	await page.goto(`${base}/?new=work-order`);
	const dialog = page.getByRole("dialog", { name: "New work order" });
	await dialog.getByLabel("What should change?").fill("Add a weekly summary");
	await dialog.getByRole("radio", { name: /Chore/ }).check();
	await dialog.getByRole("button", { name: /Start work order|Add to Intake/ }).click();
	await page.waitForURL(/work-orders\/\d+/);
	await page.getByRole("heading", { name: /Add a weekly summary/ }).waitFor();
});

await journey("stop and restart the line", async (page) => {
	await scenario("full");
	await page.goto(`${base}/floor`);
	const nav = page.getByRole("navigation", { name: "Main" });
	await nav.getByRole("button", { name: "Stop the line" }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByRole("button", { name: "Stop the line" }).click();
	await nav.getByRole("button", { name: "Restart the line" }).click();
	await nav.getByRole("button", { name: "Stop the line" }).waitFor();
});

await journey("the page refuses a request without its session", async () => {
	const res = await fetch(`${base}/api/line`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: '{"stopped":true}',
	});
	if (res.status !== 403 && res.status !== 401) throw new Error(`Got ${res.status}`);
});

await journey("the offline page appears when the service stops, and clears when it's back", async (page) => {
	await scenario("full");
	await page.goto(base);
	await page.getByRole("heading", { name: "Queue", level: 1 }).waitFor();
	service.kill();
	await page.getByRole("heading", { name: "The factory isn't running" }).waitFor({ timeout: 40_000 });
	service = startService();
	await page.getByRole("heading", { name: "Queue", level: 1 }).waitFor({ timeout: 15_000 });
});

await browser.close();
service.kill();
rmSync(dataDir, { recursive: true, force: true });

if (failures.length) {
	console.error(`${failures.length} failed of ${checked}:\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`${checked} states and journeys passed.`);
