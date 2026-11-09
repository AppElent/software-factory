import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The folders agents read skills from. Someone else's Mac can have none of these, and everything still works. */
const skillFolders = (home: string) => [join(home, ".claude", "skills"), join(home, ".agents", "skills")];

export function detectSkills(home: string = homedir()): string[] {
	const found = new Set<string>();
	for (const folder of skillFolders(home)) {
		if (!existsSync(folder)) continue;
		for (const entry of readdirSync(folder)) {
			if (existsSync(join(folder, entry, "SKILL.md"))) found.add(entry);
		}
	}
	return [...found].sort();
}
