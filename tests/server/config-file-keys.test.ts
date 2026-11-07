import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigFile } from "../../src/server/config-file.ts";
import { openDb } from "../../src/server/db.ts";
import { Store } from "../../src/server/store.ts";

describe("the config file on another version or Mac", () => {
	it("keeps keys this version doesn't know", () => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const file = new ConfigFile(dir);
		writeFileSync(file.path, JSON.stringify({ version: 1, fromNewerVersion: { a: 1 } }));
		file.update((d) => ({ ...d, defaultMode: "std" }));
		expect(JSON.parse(readFileSync(file.path, "utf8")).fromNewerVersion).toEqual({ a: 1 });
	});

	it.each([
		["/Users/not-this-person/code", join(homedir(), "Developer")],
		[`${homedir()}/code`, `${homedir()}/code`],
		["/Volumes/Work/code", "/Volumes/Work/code"],
	])("treats a clone folder of %s as %s", (saved, expected) => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
		store.file.update((d) => ({ ...d, settings: { ...d.settings, cloneFolder: saved } }));
		expect(store.settings().projects.cloneFolder).toBe(expected);
	});
});
