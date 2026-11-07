#!/usr/bin/env node
// Screenshots a page of the running demo: node scripts/shot.mjs <scenario> <path> <out.png> [width] [height]
// Needs `pnpm build` and `pnpm demo` running. Prints console errors and horizontal overflow.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const [scenario, path, out, width = "1440", height = "900"] = process.argv.slice(2);
if (!scenario || !path || !out) {
	console.error("Usage: shot.mjs <scenario|-> <path> <out.png> [width] [height]");
	process.exit(2);
}
const base = `http://127.0.0.1:${process.env.SF_PORT ?? 4311}`;
if (scenario !== "-") {
	const token = readFileSync(`${process.env.SF_DATA_DIR ?? ".scratch/demo"}/session-token`, "utf8").trim();
	const res = await fetch(`${base}/api/demo/scenario`, {
		method: "POST",
		headers: { "x-sf-session": token, "content-type": "application/json", host: "127.0.0.1" },
		body: JSON.stringify({ name: scenario }),
	});
	if (!res.ok) throw new Error(`Scenario failed: ${res.status} ${await res.text()}`);
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on("console", (m) => {
	if (m.type() === "error") console.log(`console error: ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 0) console.log(`horizontal overflow: ${overflow}px`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
