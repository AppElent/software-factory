import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
	);

describe("paths", () => {
	it("never reads a file path from a URL's pathname, which keeps spaces as %20", () => {
		const offenders = [...files("src/server"), "scripts/service.mjs", "scripts/update-guard.mjs"].filter(
			(f) => /import\.meta\.url\)\.pathname/.test(readFileSync(f, "utf8")),
		);
		expect(offenders).toEqual([]);
	});
});
