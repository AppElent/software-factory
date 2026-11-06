/** Pure rules from docs/contracts/factory.md. No I/O, so each is a table test. */
import type {
	CheckRun,
	GateName,
	GateState,
	Gates,
	Limits,
	PrGroup,
	QueueItem,
	QueueKind,
	StartBlock,
} from "./types.ts";
import { GATE_NAMES } from "./types.ts";

/* ---------- never touch ---------- */

const escapeRe = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
const globRe = (rule: string) =>
	new RegExp(`^${escapeRe(rule).replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

/**
 * A rule matches a repo name, `owner/name`, or any single folder in a path.
 * Rules with a slash match the whole `owner/name` or path instead.
 */
export function matchesNeverTouch(
	rules: string[],
	candidate: { repo?: string; path?: string | null },
): boolean {
	const targets: string[] = [];
	if (candidate.repo) {
		targets.push(candidate.repo);
		const name = candidate.repo.split("/").pop();
		if (name) targets.push(name);
		const owner = candidate.repo.split("/")[0];
		if (owner && candidate.repo.includes("/")) targets.push(owner);
	}
	if (candidate.path) {
		targets.push(candidate.path);
		targets.push(...candidate.path.split("/").filter(Boolean));
	}
	return rules.some((raw) => {
		const rule = raw.trim();
		if (!rule) return false;
		const re = globRe(rule);
		return targets.some((t) => re.test(t));
	});
}

export function applyNeverTouch<T extends { repo?: string; path?: string | null }>(
	rules: string[],
	items: T[],
): { kept: T[]; skipped: T[] } {
	const kept: T[] = [];
	const skipped: T[] = [];
	for (const item of items) (matchesNeverTouch(rules, item) ? skipped : kept).push(item);
	return { kept, skipped };
}

/* ---------- gates ---------- */

const TYPECHECK = /type-?check|\btsc\b|\btypes\b/i;
const TESTS = /\btests?\b|vitest|jest|\bunit\b|\be2e\b|maestro/i;
const LINT = /\blint\b|biome|eslint/i;
const PREVIEW = /preview|\bdeploy\b|vercel|pages/i;
/** The toolkit's CI runs typecheck, tests, and lint in one job called `check` or `verify`. */
const COMBINED = /(^|[\s/])(check|checks|verify|ci|build)$/i;

function combine(states: GateState[]): GateState {
	if (states.length === 0) return "not_set_up";
	if (states.includes("failed")) return "failed";
	if (states.includes("running")) return "running";
	if (states.every((s) => s === "not_set_up")) return "not_set_up";
	return "passed";
}

const bucketState = (b: CheckRun["bucket"]): GateState =>
	b === "pass" ? "passed" : b === "fail" ? "failed" : b === "running" ? "running" : "not_set_up";

/** Maps a PR's check runs to the four gates. A skipped run says nothing, so it counts as not set up. */
export function mapGates(checks: CheckRun[]): Gates {
	const found: Record<GateName, GateState[]> = { Typecheck: [], Tests: [], Lint: [], Preview: [] };
	for (const c of checks) {
		const state = bucketState(c.bucket);
		const name = c.name.trim();
		if (name === "cleanup" || /cleanup/i.test(name)) continue;
		const workflow = c.workflow ?? "";
		if (PREVIEW.test(name) || PREVIEW.test(workflow)) found.Preview.push(state);
		else if (TYPECHECK.test(name)) found.Typecheck.push(state);
		else if (TESTS.test(name)) found.Tests.push(state);
		else if (LINT.test(name)) found.Lint.push(state);
		else if (COMBINED.test(name)) {
			found.Typecheck.push(state);
			found.Tests.push(state);
			found.Lint.push(state);
		}
	}
	return {
		Typecheck: combine(found.Typecheck),
		Tests: combine(found.Tests),
		Lint: combine(found.Lint),
		Preview: combine(found.Preview),
	};
}

export const noGates = (state: GateState = "not_started"): Gates => ({
	Typecheck: state,
	Tests: state,
	Lint: state,
	Preview: state,
});

export const gateValues = (g: Gates): GateState[] => GATE_NAMES.map((n) => g[n]);
export const anyGate = (g: Gates, s: GateState) => gateValues(g).includes(s);

/** First failed gate, by name. */
export const failedGate = (g: Gates): GateName | null => GATE_NAMES.find((n) => g[n] === "failed") ?? null;

/** Every gate that exists has passed, and at least one exists. */
export function gatesPassed(g: Gates): boolean {
	const real = gateValues(g).filter((s) => s !== "not_set_up");
	return real.length > 0 && real.every((s) => s === "passed");
}

/** Nothing is failing, running, or out of date. A project with no CI at all is clear, and says `Not set up`. */
export const gatesClear = (g: Gates) =>
	!anyGate(g, "failed") && !anyGate(g, "running") && !anyGate(g, "out_of_date") && !anyGate(g, "not_started");

/** Says what a ready PR's gates really did. A repo with no CI hasn't passed anything. */
export function gateSummary(gates: Gates): string {
	const passed = GATE_NAMES.filter((n) => gates[n] === "passed").length;
	if (passed === GATE_NAMES.length) return "All gates passed";
	if (passed === 0) return "No gates set up";
	return `${passed} of ${GATE_NAMES.length} gates passed`;
}

/** All four gates passed. `Not set up` blocks merging without you. */
export const allFourPassed = (g: Gates) => gateValues(g).every((s) => s === "passed");

const STALE_DAYS = 30;

export function prGroup(pr: {
	gates: Gates;
	mergeable: string;
	mergeState: string;
	updatedAt: string;
	isDraft: boolean;
	now: number;
}): PrGroup {
	const ageDays = (pr.now - Date.parse(pr.updatedAt)) / 86_400_000;
	if (ageDays >= STALE_DAYS) return "stale";
	if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY" || pr.mergeState === "BEHIND")
		return "rebase";
	if (anyGate(pr.gates, "failed")) return "failed";
	if (pr.isDraft || !gatesClear(pr.gates)) return "running";
	return "ready";
}

/** Why a PR can't merge right now. Empty means it can. Checked on the server before every merge. */
export function mergeBlockers(pr: {
	gates: Gates;
	mergeable: string;
	mergeState: string;
	isDraft: boolean;
}): string[] {
	const out: string[] = [];
	if (pr.isDraft) out.push("It's a draft.");
	if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY")
		out.push("It conflicts with the base branch.");
	if (pr.mergeState === "BEHIND") out.push("The base branch moved on, so it needs a rebase.");
	if (anyGate(pr.gates, "failed")) out.push("A gate failed.");
	if (anyGate(pr.gates, "running")) out.push("Gates are still running.");
	if (anyGate(pr.gates, "out_of_date")) out.push("Gates are out of date.");
	if (anyGate(pr.gates, "not_started")) out.push("Gates haven't started.");
	return [...new Set(out)];
}

/* ---------- slots ---------- */

export function startBlock(input: {
	stopped: boolean;
	agents: number;
	build: number;
	review: number;
	pauseOnReview: boolean;
}): StartBlock {
	if (input.stopped) return "stopped";
	if (input.build >= input.agents) return "limit";
	if (input.pauseOnReview && input.review >= input.agents) return "review";
	return null;
}

/** A work order moves into Verify only when Verify has room. */
export const verifyHasRoom = (l: Pick<Limits, "verify" | "agents">) => l.verify < l.agents;

/* ---------- first try, regression, merge rule ---------- */

export const isFirstTry = (wo: { retries: number; gatesPassedAtSomePoint: boolean }) =>
	wo.retries === 0 && wo.gatesPassedAtSomePoint;

/** An error is a regression when a work order that fixed its fingerprint shipped, and it was seen after that. */
export function isRegression(error: { lastSeen: string }, fix: { mergedAt: string | null } | null): boolean {
	if (!fix?.mergedAt) return false;
	return Date.parse(error.lastSeen) > Date.parse(fix.mergedAt);
}

export interface Record_ {
	runs: number;
	firstTry: number;
	regressions: number;
}

export function qualifies(rec: Record_, t: { runs: number; firstTryPct: number }): boolean {
	if (rec.runs < t.runs || rec.runs === 0) return false;
	if (rec.regressions > 0) return false;
	return (rec.firstTry / rec.runs) * 100 >= t.firstTryPct;
}

export function mayMergeAlone(input: {
	on: boolean;
	projectMerging: "follow" | "ask";
	gates: Gates;
	mergeable: string;
	mergeState: string;
	isDraft: boolean;
}): boolean {
	if (!input.on || input.projectMerging === "ask") return false;
	if (!allFourPassed(input.gates)) return false;
	return mergeBlockers(input).length === 0;
}

/* ---------- triage ---------- */

export const SNOOZE_WAKE_EVENTS = 100;

/** Next 09:00 tomorrow, local time. */
export function snoozeUntil(now: Date): Date {
	const d = new Date(now);
	d.setDate(d.getDate() + 1);
	d.setHours(9, 0, 0, 0);
	return d;
}

export interface TriageRecord {
	action: "snooze" | "dismiss";
	until: string | null;
	baselineEvents: number;
	baselineUsers: number;
	baselineRelease: string | null;
}

/** Whether a triage record still hides its item. Contract: Queue, Snooze, Dismiss. */
export function triageHides(
	rec: TriageRecord,
	current: { events: number; users: number; release: string | null },
	now: number,
): boolean {
	if (rec.action === "dismiss") {
		// Dismiss returns only if it gets worse.
		const worse = current.users > rec.baselineUsers || current.events >= Math.max(rec.baselineEvents * 2, 10);
		return !worse;
	}
	if (rec.until && now >= Date.parse(rec.until)) return false;
	if (current.events >= SNOOZE_WAKE_EVENTS && rec.baselineEvents < SNOOZE_WAKE_EVENTS) return false;
	if (current.release && rec.baselineRelease && current.release !== rec.baselineRelease && current.users > 0)
		return false;
	return true;
}

/* ---------- ranking ---------- */

const NEEDS_YOU_ORDER: QueueKind[] = [
	"error",
	"question",
	"plan",
	"waiting_in_t3",
	"run_failed",
	"red_main",
	"failed_gates",
	"ready_pr",
];
const LATER_ORDER: QueueKind[] = ["stale_pr", "rebase_pr", "toolkit", "tool"];

export const isNeedsYou = (k: QueueKind) => NEEDS_YOU_ORDER.includes(k);

function groupRank(kind: QueueKind): number {
	// Questions and plans share a rank in the contract, and so do the T3 waits that behave like them.
	if (kind === "question" || kind === "plan" || kind === "waiting_in_t3") return 1;
	if (kind === "run_failed") return 3;
	const n = NEEDS_YOU_ORDER.indexOf(kind);
	if (n >= 0) return n;
	return 100 + LATER_ORDER.indexOf(kind);
}

/** Group order first, then most users, then oldest. */
export function rankQueue(items: QueueItem[]): QueueItem[] {
	return [...items].sort((a, b) => {
		const g = groupRank(a.kind) - groupRank(b.kind);
		if (g !== 0) return g;
		if (b.users !== a.users) return b.users - a.users;
		return Date.parse(a.since) - Date.parse(b.since);
	});
}

/* ---------- agent protocol ---------- */

export interface ParsedReply {
	plan: unknown | null;
	question: unknown | null;
	/** Reply text with protocol blocks removed. */
	text: string;
}

const BLOCK = /```factory-(plan|question)\s*\n([\s\S]*?)\n```/g;

/** Reads the fenced blocks playbooks ask for. A malformed block counts as absent. */
export function parseReply(reply: string): ParsedReply {
	const out: ParsedReply = { plan: null, question: null, text: reply.replace(BLOCK, "").trim() };
	for (const m of reply.matchAll(BLOCK)) {
		try {
			const value = JSON.parse(m[2] ?? "");
			if (m[1] === "plan") out.plan = value;
			else out.question = value;
		} catch {
			// Treated as no block, so the text still reaches the person.
		}
	}
	return out;
}

/** Wraps outside text so an agent reads it as data. A closing tag inside it can't end the block. */
export function delimit(source: string, text: string): string {
	const safe = text.replace(/<\/?untrusted-data/gi, (m) => m.replace("<", "&lt;"));
	return `<untrusted-data source="${source}">\n${safe}\n</untrusted-data>`;
}

/* ---------- formatting shared by screens and notifications ---------- */

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export const slugify = (text: string, max = 40) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/, "");
