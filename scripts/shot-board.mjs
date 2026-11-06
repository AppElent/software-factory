#!/usr/bin/env node
// Screenshots an approved design board: node scripts/shot-board.mjs Queue out.png [width] [height]
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const [board, out, width = "1440", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
await page.goto(`file://${resolve(`designs/control-room/control-room_final/${board}.dc.html`)}`);
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
