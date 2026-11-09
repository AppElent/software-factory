import type { Mode } from "./types.ts";

export type FixTarget =
	| { kind: "issue"; number: number; project: string | null }
	| { kind: "error"; shortId: string }
	| { kind: "red" };

export interface FixCommand {
	target: FixTarget;
	/** Null means your default mode. */
	mode: Mode | null;
	/** Words after the target that name no mode. */
	unknownMode: string | null;
}

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Reads what's typed in the command menu. `fix #12 full send`, `fix ledger #12`, `fix FAIRWAY-3K council`,
 * `fix everything red with full stop`. Anything else isn't a command, so the menu goes on searching.
 */
export function parseFixCommand(text: string, modes: Mode[]): FixCommand | null {
	const m = /^fix\s+(.+)$/i.exec(text.trim());
	if (!m?.[1]) return null;
	const rest = m[1].trim();
	let target: FixTarget;
	let words: string;
	const red = /^everything red\b(.*)$/i.exec(rest);
	const issue = /^(?:([a-z0-9_.-]+)\s+)?#(\d+)\b(.*)$/i.exec(rest);
	const error = /^([A-Z0-9]+(?:-[A-Z0-9]+)+)\b(.*)$/i.exec(rest);
	if (red) {
		target = { kind: "red" };
		words = red[1] ?? "";
	} else if (issue) {
		target = { kind: "issue", number: Number(issue[2]), project: issue[1]?.toLowerCase() ?? null };
		words = issue[3] ?? "";
	} else if (error?.[1]) {
		target = { kind: "error", shortId: error[1].toUpperCase() };
		words = error[2] ?? "";
	} else return null;
	const name = clean(words).replace(/^with\s+/, "");
	if (!name) return { target, mode: null, unknownMode: null };
	const mode = modes.find((x) => clean(x.name) === name || x.id === name.replaceAll(" ", "-")) ?? null;
	return { target, mode, unknownMode: mode ? null : name };
}
