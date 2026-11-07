/** Pure rules from docs/contracts/factory.md. No I/O, so each is a table test. */
import type {
	AutomationSchedule,
	CheckRun,
	GateName,
	GateState,
	Gates,
	IssueGroup,
	IssueSignals,
	Limits,
	PrGroup,
	PullRequest,
	QueueItem,
	QueueKind,
	StartBlock,
	WorkType,
} from "./types.ts";
import { GATE_NAMES } from "./types.ts";

/* ---------- never touch ---------- */

const escapeRe = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
const globBody = (rule: string) => escapeRe(rule).replace(/\*/g, ".*").replace(/\?/g, ".");

/** Removes `.`, `..`, doubled slashes, and a trailing slash, so a path can't step around a rule. */
function cleanPath(path: string): string {
	const out: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return `${path.startsWith("/") ? "/" : ""}${out.join("/")}`;
}

/**
 * How a rule reads a path. Every form covers everything beneath the folder it names:
 * `/abs/folder`, `~/folder` (any home, since this module can't know the real one), or a relative `folder` or
 * `a/b`, which matches those folders anywhere in the path. Overmatching is the safe way to be wrong here.
 */
function pathRe(rule: string): RegExp {
	if (rule.startsWith("~/")) return new RegExp(`^/.*/${globBody(rule.slice(2))}(/.*)?$`, "i");
	if (rule.startsWith("/")) return new RegExp(`^${globBody(rule)}(/.*)?$`, "i");
	return new RegExp(`(^|/)${globBody(rule)}(/|$)`, "i");
}

/** People paste what's in front of them, so a repo's URL counts as the repo. */
function cleanRule(raw: string) {
	const rule = raw.trim().replace(/\/+$/, "");
	if (rule.startsWith("/") || rule.startsWith("~")) return rule;
	return rule
		.replace(/^(?:(?:https?|ssh):\/\/)?(?:[\w-]+@)?(?:www\.)?github\.com[/:]/i, "")
		.replace(/\.git$/i, "");
}

/** A rule matches a repo name, an owner, `owner/name`, or a folder and everything beneath it. */
export function matchesNeverTouch(
	rules: string[],
	candidate: { repo?: string; path?: string | null },
): boolean {
	const repos: string[] = [];
	if (candidate.repo) {
		repos.push(candidate.repo);
		const name = candidate.repo.split("/").pop();
		if (name) repos.push(name);
		const owner = candidate.repo.split("/")[0];
		if (owner && candidate.repo.includes("/")) repos.push(owner);
	}
	const path = candidate.path ? cleanPath(candidate.path) : null;
	return rules.some((raw) => {
		const rule = cleanRule(raw);
		if (!rule) return false;
		const repoRe = new RegExp(`^${globBody(rule)}$`, "i");
		if (repos.some((t) => repoRe.test(t))) return true;
		return path != null && pathRe(rule).test(path);
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
const TESTS = /\btests?\b|vitest|jest|pytest|rspec|\bunit\b|\be2e\b|maestro/i;
const LINT = /\blint\b|biome|eslint/i;
const PREVIEW = /preview|\bdeploy\b|vercel|pages/i;
/**
 * The toolkit's CI runs typecheck, tests, and lint in one job called `check` or `verify`. Only a job with exactly
 * that name counts. `Spell check` and `EAS Build` pass without running a single test.
 */
const COMBINED = /^(?:[\w-]+\s*\/\s*)?(?:check|checks|verify|ci)$/i;

function combine(states: GateState[]): GateState {
	if (states.length === 0) return "not_set_up";
	if (states.includes("failed")) return "failed";
	if (states.includes("running")) return "running";
	if (states.every((s) => s === "not_set_up")) return "not_set_up";
	return "passed";
}

const bucketState = (b: CheckRun["bucket"]): GateState =>
	b === "pass" ? "passed" : b === "fail" ? "failed" : b === "running" ? "running" : "not_set_up";

/**
 * Maps a PR's check runs to the four gates. A skipped run says nothing, so it counts as not set up.
 * A failing or running check with no gate of its own counts against Tests, so a red CodeQL can't read as passed.
 */
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
		} else if (state === "failed" || state === "running") found.Tests.push(state);
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

/** A PR with no checks at all has this long for some to appear. */
export const NO_CHECKS_MS = 5 * 60_000;

type PushedPr = Pick<PullRequest, "headSha" | "checks" | "awaitingChecksSince" | "expectedChecks">;
type AwaitedPr = PushedPr & Pick<PullRequest, "gates" | "group">;

/**
 * Right after a push, GitHub has few or no checks for the new commit. Whatever ran on the commit before will run
 * on this one too, so until it reports, its gate hasn't passed. The limit covers a push that really doesn't run it.
 */
export function awaitChecks<T extends AwaitedPr>(previous: PushedPr | null, pr: T, now: number): T {
	if (!previous) return pr;
	const samePush = previous.headSha === pr.headSha;
	const since = samePush ? previous.awaitingChecksSince : now;
	if (since === undefined || now - since >= NO_CHECKS_MS) return pr;
	const expected = samePush
		? (previous.expectedChecks ?? [])
		: [
				...(previous.expectedChecks ?? []),
				...previous.checks
					.filter((c) => c.bucket !== "skipped")
					.map((c) => ({ ...c, bucket: "running" as const })),
			];
	const reported = new Set(pr.checks.map((c) => c.name));
	const waiting = mapGates(expected.filter((c) => !reported.has(c.name)));
	const held = GATE_NAMES.filter(
		(n) => waiting[n] === "running" && (pr.gates[n] === "passed" || pr.gates[n] === "not_set_up"),
	);
	if (held.length === 0) return pr;
	const gates = { ...pr.gates };
	for (const n of held) gates[n] = "not_started";
	return {
		...pr,
		gates,
		group: pr.group === "ready" ? "running" : pr.group,
		awaitingChecksSince: since,
		expectedChecks: expected,
	};
}

/** Agents commit and push from a project's folder, so it has to be a checkout of that project's repo. */
export function originIs(url: string, repo: string): boolean {
	const clean = url
		.trim()
		.replace(/\/$/, "")
		.replace(/\.git$/, "")
		.toLowerCase();
	const want = repo.toLowerCase();
	return clean.endsWith(`/${want}`) || clean.endsWith(`:${want}`);
}

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
	// GitHub also says UNSTABLE while checks run, so it only means failed once every gate is clear.
	return pr.mergeState === "UNSTABLE" ? "failed" : "ready";
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
	else if (pr.mergeState === "UNSTABLE" && gatesClear(pr.gates))
		out.push("GitHub says a check on this PR isn't passing.");
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

/** A deploy takes time to land, so events this soon after a merge say nothing about the fix. */
export const REGRESSION_GRACE_MS = 3_600_000;

/**
 * An error is a regression when its fix merged, the grace period passed, and it was seen after that.
 * When both releases are known, an event from the release that had the bug is an old build still running.
 */
export function isRegression(
	error: { lastSeen: string; release?: string | null },
	fix: { mergedAt: string | null; release?: string | null } | null,
): boolean {
	if (!fix?.mergedAt) return false;
	if (Date.parse(error.lastSeen) <= Date.parse(fix.mergedAt) + REGRESSION_GRACE_MS) return false;
	return !(error.release && fix.release && error.release === fix.release);
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

/** Work orders on a PR the factory didn't open. Its branch and its merge belong to whoever opened it. */
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEK = [1, 2, 3, 4, 5];

export function scheduleWords(s: AutomationSchedule): string {
	switch (s.type) {
		case "interval": {
			const minutes = Math.round(s.everyMs / 60_000);
			if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440}d`;
			return minutes % 60 === 0 ? `Every ${minutes / 60}h` : `Every ${minutes}m`;
		}
		case "fixed_time": {
			const days = [...(s.weekdays ?? [])].sort();
			if (days.length === 0 || days.length === 7) return `Every day ${s.timeOfDay}`;
			if (days.join() === WEEK.join()) return `Weekdays ${s.timeOfDay}`;
			return `${days.map((d) => DAYS[d]).join(", ")} ${s.timeOfDay}`;
		}
		case "once":
			return `Once, ${s.runAt.replace("T", " ").slice(0, 16)}`;
		case "webhook":
			return "Webhook";
	}
}

export const ownsNoPr = (kind: string) => kind === "rebase_pr" || kind === "pr_changes";

/**
 * A mode's merge is chosen for one run, so a gate that isn't set up doesn't block it, as it does Merge without me.
 * Tests still have to have run: a green lint is no reason to merge.
 */
export const modeGatesPassed = (g: Gates) => gatesPassed(g) && g.Tests === "passed";

/** The files an agent could use to loosen the rules around itself. They always wait for you. */
const OWNER_ONLY_EVERYWHERE = [/^\.github\/workflows\//];
const OWNER_ONLY_HERE = [/^src\/server\/security\.ts$/, /^src\/shared\/rules\.ts$/, /^docs\/adr\//];

export function ownerOnlyFiles(paths: string[], isThisApp: boolean): string[] {
	const rules = isThisApp ? [...OWNER_ONLY_EVERYWHERE, ...OWNER_ONLY_HERE] : OWNER_ONLY_EVERYWHERE;
	return paths.filter((p) => rules.some((r) => r.test(p)));
}

export function mayMergeAlone(input: {
	on: boolean;
	/** The run's mode merges, rather than the Merge without me setting. */
	byMode?: boolean;
	projectMerging: "follow" | "ask";
	gates: Gates;
	mergeable: string;
	mergeState: string;
	isDraft: boolean;
	hold: boolean;
	sourceKind: string;
	/** An issue that's waiting to be read, or changed since it was. */
	unreadIssue?: boolean;
}): boolean {
	if (!input.on || input.projectMerging === "ask") return false;
	if (input.hold || ownsNoPr(input.sourceKind)) return false;
	// Work picked up from T3 may have started in any mode, so assuming one that merges would be a guess.
	if (input.sourceKind === "restored" || input.unreadIssue) return false;
	if (!(input.byMode ? modeGatesPassed(input.gates) : allFourPassed(input.gates))) return false;
	if (input.mergeState !== "CLEAN") return false;
	return mergeBlockers(input).length === 0;
}

/** While the agent has work in progress, the PR's gates describe code that's about to change. */
export function agentHoldsMerge(
	wo: { state: string; failedSha?: string | null } | null,
	headSha: string,
): string | null {
	if (!wo) return null;
	if (["planning", "building", "retrying", "rebasing", "waiting_in_t3", "question"].includes(wo.state))
		return "The agent is still working on this PR.";
	if (wo.state === "verifying")
		return wo.failedSha === headSha
			? "The agent's changes haven't reached this PR yet."
			: "The factory is still checking this PR's gates.";
	// Asked for changes that never came. What's on the PR is still the commit you wanted changed.
	if (wo.failedSha === headSha) {
		if (wo.state === "waiting") return "The agent hasn't started on this PR's changes yet.";
		if (wo.state === "failed" || wo.state === "run_failed")
			return "The agent's changes haven't reached this PR. Try again from its work order, or close it.";
	}
	return null;
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
	"env_down",
	"error",
	"question",
	"plan",
	"waiting_in_t3",
	"run_failed",
	"new_project",
	"red_main",
	"failed_gates",
	"ready_pr",
];
const LATER_ORDER: QueueKind[] = ["env_down_later", "stale_pr", "rebase_pr", "toolkit", "tool"];

export const isNeedsYou = (k: QueueKind) => NEEDS_YOU_ORDER.includes(k);

function groupRank(kind: QueueKind): number {
	// Questions and plans share a rank in the contract, and so do the T3 waits that behave like them.
	if (kind === "question" || kind === "plan" || kind === "waiting_in_t3") return 1;
	if (kind === "run_failed" || kind === "new_project") return 3;
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

/** Characters that show as nothing, so a person reading the text can't see what they carry. */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/** Leaves lines and tabs. A lone carriage return can end a heredoc once it's pasted, and escapes can end a paste. */
export function stripControls(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes.
	return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

/** Wraps outside text so an agent reads it as data. A closing tag inside it can't end the block. */
export function delimit(source: string, text: string): string {
	const safe = stripControls(text)
		.replace(INVISIBLE, "")
		.replace(/<\/?untrusted-data/gi, (m) => m.replace("<", "&lt;"));
	return `<untrusted-data source="${source}">\n${safe}\n</untrusted-data>`;
}

/* ---------- issues ---------- */

const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Written for an agent, not for a person fixing a bug. A hit is a reason to read closely, not a verdict. */
const AGENT_PATTERNS = [
	/\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|instructions|rules)\b/gi,
	/\bsystem prompt\b/gi,
	/\byou are now\b[^.\n]{0,60}/gi,
	/\b(?:print|send|post|upload|share|reveal|paste|exfiltrate)\b[^.\n]{0,40}(?:\b(?:secrets?|tokens?|api keys?|credentials|passwords?)\b|\.env\b)/gi,
];
/** Asks whoever reads it to run something. Real reports do this too, so alone it only asks for a closer read. */
const RUN_PATTERNS = [
	/\b(?:curl|wget)\b[^\n|]{0,120}\|\s*(?:ba|z)?sh\b/gi,
	/\b(?:please |first |must )?(?:run|execute)\b[^.\n]{0,40}\b(?:script|\.sh|\.ps1|installer)\b[^\n]{0,60}/gi,
];
const HIDDEN_PATTERNS = [/<!--[\s\S]*?-->/g, INVISIBLE];
const LINK = /https?:\/\/[^\s)>\]"']+/gi;

export interface SuspectRange {
	start: number;
	end: number;
	why: "agent" | "run" | "hidden";
}

/** The parts of an issue to underline, in order and never overlapping. */
export function suspectRanges(text: string): SuspectRange[] {
	const found: SuspectRange[] = [];
	const scan = (patterns: RegExp[], why: SuspectRange["why"]) => {
		for (const re of patterns)
			for (const m of text.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length, why });
	};
	scan(HIDDEN_PATTERNS, "hidden");
	scan(AGENT_PATTERNS, "agent");
	scan(RUN_PATTERNS, "run");
	const out: SuspectRange[] = [];
	for (const r of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
		const last = out.at(-1);
		if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
		else out.push({ ...r });
	}
	return out;
}

export function issueSignals(
	issue: { title: string; body: string; authorAssociation: string; authorCreatedAt: string | null },
	now: number,
): IssueSignals {
	const text = `${issue.title}\n${issue.body}`;
	const links = [...text.matchAll(LINK)].map((m) => m[0]);
	const ranges = suspectRanges(text);
	return {
		trusted: TRUSTED_AUTHORS.has(issue.authorAssociation),
		association: issue.authorAssociation,
		accountAgeDays: issue.authorCreatedAt
			? Math.floor((now - Date.parse(issue.authorCreatedAt)) / 86_400_000)
			: null,
		links: links.length,
		outsideLinks: links.filter((l) => !/^https?:\/\/([a-z0-9-]+\.)*github\.com\//i.test(l)).length,
		instructions: ranges.filter((r) => r.why === "run").length,
		aimedAtAgents: ranges.filter((r) => r.why === "agent").length,
		hidden: ranges.filter((r) => r.why === "hidden").length,
	};
}

/** Your read wins, then the author, then the text. An agent's opinion never moves an issue. */
export function issueGroup(signals: IssueSignals, read: boolean): IssueGroup {
	if (read || signals.trusted) return "looks_legit";
	return signals.aimedAtAgents > 0 || signals.hidden > 0 ? "looks_off" : "needs_read";
}

/** Text from outside reaches a mode that merges on its own only after a person read this exact version. */
export const issueLocked = (signals: IssueSignals, read: boolean) => !signals.trusted && !read;

export const issueWorkType = (labels: string[]): WorkType =>
	labels.some((l) => /^(enhancement|feature|feat)\b/i.test(l)) ? "Feature" : "Bug fix";

/** The most of an issue an agent gets. GitHub allows 65,536 characters. */
export const ISSUE_DATA_MAX = 20_000;

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
