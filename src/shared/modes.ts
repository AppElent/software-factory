import { stripControls } from "./rules.ts";
import type { Mode } from "./types.ts";

/** Skills that modes know how to use. Each is offered only when it's found on this Mac. */
export const USEFUL_SKILLS = ["full-stop", "full-send", "council", "sol-loop", "babysit-pr"];

/** Skills trigger on their name as words: `full-stop` on "full stop". */
export const skillPhrase = (skill: string) => skill.replace(/[-_]+/g, " ");

const READY = "Work until the pull request is ready, with proof that it works. Don't merge.";

const lead = (skills: string[], skill: string, rest: string) =>
	skills.includes(skill) ? `${skillPhrase(skill)}\n\n${rest}` : rest;

/**
 * The modes a new install starts with. They work with no skills installed, and use one where it's found.
 * Full send leads with full stop on purpose: that skill stops with the PR ready, and the factory does the merge,
 * so Review and Stop the line still apply.
 */
export function defaultModes(skills: string[]): Mode[] {
	const has = (s: string) => skills.includes(s);
	const base = { provider: null, model: null, builtin: true };
	return [
		{
			...base,
			id: "standard",
			name: "Standard",
			description: "Plans, builds and runs the gates. You review and merge.",
			prompt: "",
			plan: "follow",
			merge: "you",
		},
		{
			...base,
			id: "quick-fix",
			name: "Quick fix",
			description: "Skips the plan. You review and merge.",
			prompt: "",
			plan: "skip",
			merge: "you",
		},
		{
			...base,
			id: "full-stop",
			name: "Full stop",
			description: has("full-stop")
				? "Uses your full-stop skill. Stops with the PR ready and proof."
				: "Stops with the PR ready and proof.",
			prompt: lead(skills, "full-stop", READY),
			plan: "follow",
			merge: "you",
		},
		{
			...base,
			id: "council",
			name: "Council",
			description: has("council")
				? "Uses your council skill. Three models review before you do."
				: "Reviews its own work closely before you do.",
			prompt: lead(
				skills,
				"council",
				"Before you stop, review your own change as a skeptical outsider, and fix what you find. Don't merge.",
			),
			plan: "follow",
			merge: "you",
		},
		{
			...base,
			id: "full-send",
			name: "Full send",
			description: "The factory merges once gates pass, unless the line is stopped.",
			prompt: lead(skills, "full-stop", READY),
			plan: "skip",
			merge: "factory",
		},
	];
}

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A heredoc ends at the first line equal to its delimiter, so outside text must not contain that line. */
function delimiterFor(text: string) {
	const lines = new Set(text.split("\n").map((l) => l.trim()));
	let word = "PROMPT";
	for (let n = 2; lines.has(word); n += 1) word = `PROMPT_${n}`;
	return word;
}

/** The same run, for a terminal. It needs nothing from this app, which is the point. */
export function t3Command(input: {
	path: string;
	title: string;
	base: string;
	branch: string;
	prompt: string;
	provider?: string | null;
	model?: string | null;
}): string {
	const prompt = stripControls(input.prompt);
	const flags = [
		`--title ${shellQuote(stripControls(input.title).replace(/\n/g, " "))}`,
		`--worktree ${shellQuote(input.base)}`,
		`--branch ${shellQuote(input.branch)}`,
		...(input.provider ? [`--provider ${shellQuote(input.provider)}`] : []),
		...(input.model ? [`--model ${shellQuote(input.model)}`] : []),
	];
	const end = delimiterFor(prompt);
	return `t3 thread start ${shellQuote(input.path)} - ${flags.join(" ")} <<'${end}'\n${prompt}\n${end}\n`;
}

/** Where a mode's rules can go wrong, in words. Empty means it can be saved. */
export function modeProblems(modes: Mode[], defaultMode: string): string[] {
	const out: string[] = [];
	if (modes.length === 0) out.push("Keep at least one mode.");
	const ids = new Set<string>();
	for (const m of modes) {
		if (!m.name.trim()) out.push("Every mode needs a name.");
		if (ids.has(m.id)) out.push(`Two modes share the name ${m.name}.`);
		ids.add(m.id);
		if (m.provider && !m.model) out.push(`${m.name} names a provider, so it needs a model too.`);
	}
	const chosen = modes.find((m) => m.id === defaultMode);
	if (!chosen) out.push("The default mode isn't in the list.");
	else if (chosen.merge === "factory")
		out.push(`${chosen.name} merges by itself, so it can't be the default. It's chosen one run at a time.`);
	return out;
}
