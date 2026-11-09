import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.ts";
import { ConfigFile } from "../../src/server/config-file.ts";
import { kvSet, openDb } from "../../src/server/db.ts";
import { Store } from "../../src/server/store.ts";

describe("the config file on another version or Mac", () => {
	it("keeps keys this version doesn't know", () => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const file = new ConfigFile(dir);
		writeFileSync(file.path, JSON.stringify({ version: 1, fromNewerVersion: { a: 1 } }));
		file.update((d) => ({ ...d, defaultMode: "std" }));
		expect(JSON.parse(readFileSync(file.path, "utf8")).fromNewerVersion).toEqual({ a: 1 });
	});

	// Only a Mac has `/Users/Shared`, and only a path under `/Users/` can be another Mac's.
	it.skipIf(!existsSync("/Users/Shared"))("keeps a shared folder that exists here", () => {
		const shared = mkdtempSync("/Users/Shared/sf-cfg-");
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
		store.file.update((d) => ({ ...d, settings: { ...d.settings, cloneFolder: shared } }));
		expect(store.settings().projects.cloneFolder).toBe(shared);
		rmSync(shared, { recursive: true });
	});

	it("keeps sample data away from the real config and data", () => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const other = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const demo = { SF_DEMO: "1", SF_DATA_DIR: dir, SF_CONFIG_DIR: other };
		expect(loadConfig(demo).configDir).toBe(dir);
		expect(() => loadConfig({ SF_DEMO: "1" })).toThrow(/SF_DATA_DIR/);
		expect(loadConfig({ SF_DATA_DIR: dir, SF_CONFIG_DIR: other }).configDir).toBe(other);
	});

	it.each([
		[{ cloneFolder: 123 }],
		[{ approvals: { mergeWithoutMe: { Chore: "no" } } }],
		[{ agents: { agentsAtOnce: "lots" } }],
		[{ approvals: { thresholds: 5 } }],
	])("reads a wrong type in settings as a broken file: %j", (settings) => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
		writeFileSync(store.file.path, JSON.stringify({ version: 1, settings }));
		expect(store.file.error()).toMatch(/expected shape/);
		expect(() => store.settings()).not.toThrow();
		expect(Object.values(store.settings().approvals.mergeWithoutMe)).not.toContain(true);
	});

	it("keeps fields from a newer version when a list is saved", () => {
		const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
		const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
		const { modes, defaultMode } = store.modes([]);
		store.saveModes(modes, defaultMode);
		const data = JSON.parse(readFileSync(store.file.path, "utf8"));
		data.modes[0].fromNewer = 1;
		writeFileSync(store.file.path, JSON.stringify(data));
		store.saveModes(store.modes([]).modes, defaultMode);
		expect(JSON.parse(readFileSync(store.file.path, "utf8")).modes[0].fromNewer).toBe(1);
	});

	describe("settings from before the config file", () => {
		const carried = () => {
			const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
			const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
			kvSet(store.db, "settings:agents", { agentsAtOnce: 7 });
			kvSet(store.db, "settings:approvals", {
				mergeWithoutMe: { "Bug fix": false, Feature: false, "Toolkit sync": false, Chore: true },
			});
			kvSet(store.db, "settings:notifications", { onlyWhenAway: true, lastTest: "ok" });
			kvSet(store.db, "settings:cloneFolder", `${homedir()}/code`);
			return store;
		};

		it("move to the file, so they survive losing the database", () => {
			const store = carried();
			store.moveSettingsToFile();
			const after = new Store(
				openDb(join(mkdtempSync(join(tmpdir(), "sf-cfg-")), "t.db")),
				"x",
				undefined,
				store.configDir,
			);
			expect(after.settings().agents.agentsAtOnce).toBe(7);
			expect(after.settings().notifications.onlyWhenAway).toBe(true);
			expect(after.settings().projects.cloneFolder).toBe(`${homedir()}/code`);
			expect(store.settings().notifications.lastTest).toBe("ok");
		});

		it("don't overwrite what's in the file", () => {
			const store = carried();
			store.file.update((d) => ({ ...d, settings: { ...d.settings, agents: { agentsAtOnce: 2 } } }));
			store.moveSettingsToFile();
			expect(store.settings().agents.agentsAtOnce).toBe(2);
		});

		it("don't come back when the file is deleted", () => {
			const store = carried();
			store.moveSettingsToFile();
			rmSync(store.file.path);
			expect(store.settings().approvals.mergeWithoutMe.Chore).toBe(false);
		});

		it("wait while the file can't be read", () => {
			const store = carried();
			writeFileSync(store.file.path, "{ nope");
			store.moveSettingsToFile();
			expect(readFileSync(store.file.path, "utf8")).toBe("{ nope");
			expect(store.settings().agents.agentsAtOnce).toBe(7);
		});
	});

	describe("while the file can't be read", () => {
		const broken = () => {
			const dir = mkdtempSync(join(tmpdir(), "sf-cfg-"));
			const store = new Store(openDb(join(dir, "t.db")), dir, undefined, dir);
			const on = { "Bug fix": true, Feature: false, "Toolkit sync": false, Chore: true };
			// From before the config file existed.
			kvSet(store.db, "settings:approvals", { mergeWithoutMe: on });
			store.saveApprovals({ ...store.settings().approvals, mergeWithoutMe: on });
			const good = readFileSync(store.file.path, "utf8");
			writeFileSync(store.file.path, "{ nope");
			return { store, good };
		};

		it("nothing merges alone, whatever the database still says", () => {
			const { store } = broken();
			expect(Object.values(store.settings().approvals.mergeWithoutMe)).not.toContain(true);
		});

		it("a regression still counts, once the file is fixed", () => {
			const { store, good } = broken();
			expect(store.stopMergingAfterRegression("Chore")).toBe(true);
			store.settleRegressions();
			writeFileSync(store.file.path, good);
			expect(store.settings().approvals.mergeWithoutMe).toMatchObject({ "Bug fix": true, Chore: false });
			store.settleRegressions();
			const saved = JSON.parse(readFileSync(store.file.path, "utf8")).settings.approvals;
			expect(saved.mergeWithoutMe.Chore).toBe(false);
			expect(saved.turnedOffByRegression.Chore).toBe(true);
			// It's in the file now, so turning it back on is yours to do.
			store.saveApprovals({
				...store.settings().approvals,
				mergeWithoutMe: { ...store.settings().approvals.mergeWithoutMe, Chore: true },
			});
			expect(store.settings().approvals.mergeWithoutMe.Chore).toBe(true);
		});
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
