import { describe, expect, it } from "vitest";
import { realDeployRunner } from "../../src/server/environments.ts";

describe("running a deploy command", () => {
	it("finishes when the command does, even with something left in the background", async () => {
		const out: string[] = [];
		const run = realDeployRunner("sleep 30 & echo started", process.cwd(), (t) => out.push(t));
		const started = Date.now();
		expect(await run.done).toBe(0);
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(out.join("")).toContain("started");
		run.kill();
	}, 15_000);

	it("reports the command's own exit code", async () => {
		expect(await realDeployRunner("exit 3", process.cwd(), () => {}).done).toBe(3);
	});
});
