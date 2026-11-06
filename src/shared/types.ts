/** Shapes shared by the service and the control room. Words follow GLOSSARY.md. */

export const STAGES = ["Intake", "Plan", "Build", "Verify", "Review", "Ship", "Observe"] as const;
export type Stage = (typeof STAGES)[number];

export const WORK_TYPES = ["Bug fix", "Feature", "Toolkit sync", "Chore"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const GATE_NAMES = ["Typecheck", "Tests", "Lint", "Preview"] as const;
export type GateName = (typeof GATE_NAMES)[number];
export type GateState = "not_set_up" | "not_started" | "running" | "passed" | "failed" | "out_of_date";
export type Gates = Record<GateName, GateState>;

export type WorkOrderState =
	| "waiting" // Intake: waiting for a slot
	| "planning" // Plan: agent writing or rewriting the plan
	| "plan_ready" // Plan: waiting for you
	| "plan_approved" // Plan: approved, waiting for a Build slot
	| "building" // Build: agent working
	| "build_done" // Build: finished, waiting for a Verify slot
	| "question" // Build or Plan: agent asked through the factory protocol
	| "waiting_in_t3" // The agent used a native question or permission request
	| "run_failed" // T3 couldn't start or finish the run
	| "verifying" // Verify: gates running on GitHub
	| "retrying" // Verify: agent fixing a failed gate
	| "failed" // Verify: gates failed after retries
	| "ready" // Review: PR waiting for you
	| "rebasing" // Review: agent rebasing
	| "shipping" // Ship: merged, deploy running
	| "observing" // Observe: watching for errors
	| "done"
	| "closed";

export interface WorkOrderSource {
	kind: "person" | "error" | "red_main" | "stale_pr" | "rebase_pr" | "toolkit" | "new_project";
	fingerprint?: string;
	/** Text from outside the factory. Reaches the agent only as delimited data. */
	data?: string;
	prNumber?: number;
	regressionOf?: { workOrderId: number; prNumber: number | null };
}

export interface Plan {
	summary: string;
	steps: string[];
	files?: string;
	risk?: string;
	estimate?: string;
	outOfScope?: string;
}

export interface QuestionOption {
	label: string;
	detail?: string;
	/** Choosing it closes the work order without changes. */
	stop?: boolean;
}

export interface AgentQuestion {
	question: string;
	detail?: string;
	options: QuestionOption[];
}

export interface ActivityEntry {
	at: string;
	text: string;
	/** Failure or command text, shown in a pre block. */
	detail?: string;
}

export interface WorkOrder {
	id: number;
	project: string;
	projectName: string;
	type: WorkType;
	title: string;
	description: string;
	stage: Stage;
	state: WorkOrderState;
	source: WorkOrderSource;
	plan: Plan | null;
	question: AgentQuestion | null;
	failure: string | null;
	failedGate: GateName | null;
	retries: number;
	firstTry: boolean;
	hold: boolean;
	heldByLine: boolean;
	threadId: string | null;
	threadLink: string | null;
	branch: string | null;
	worktree: string | null;
	prNumber: number | null;
	gates: Gates;
	agent: string;
	createdAt: string;
	updatedAt: string;
	stageAt: string;
	finishedAt: string | null;
	mergedAt: string | null;
	activity: ActivityEntry[];
	output: string[];
	/** Why it can't leave Intake right now, in interface words. */
	waitingFor: string | null;
}

export interface ToolkitState {
	status: "source" | "current" | "behind" | "none" | "unknown";
	behindDays: number;
	changed: number;
}

export interface Project {
	slug: string;
	repo: string;
	name: string;
	url: string;
	isPrivate: boolean;
	localPath: string | null;
	folderMissing: boolean;
	paused: boolean;
	merging: "follow" | "ask";
	sentryProject: string | null;
	sentrySkipped: boolean;
	defaultBranch: string;
	toolkit: ToolkitState;
	pushedAt: string | null;
	addedAt: string;
	readAt: string | null;
	openPrs: number;
	openErrors: number;
	openWorkOrders: number;
	redMain: boolean;
}

export type CheckBucket = "pass" | "fail" | "running" | "skipped";

export interface CheckRun {
	name: string;
	workflow: string | null;
	bucket: CheckBucket;
	url: string | null;
}

export type PrGroup = "ready" | "failed" | "running" | "rebase" | "stale";

export interface PullRequest {
	project: string;
	projectName: string;
	number: number;
	title: string;
	url: string;
	body: string;
	isDraft: boolean;
	additions: number;
	deletions: number;
	changedFiles: number;
	headRef: string;
	headSha: string;
	baseRef: string;
	createdAt: string;
	updatedAt: string;
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	mergeState: string;
	gates: Gates;
	checks: CheckRun[];
	group: PrGroup;
	workOrderId: number | null;
	workType: WorkType | null;
}

export interface MainBranchState {
	sha: string;
	message: string;
	committedAt: string;
	state: "green" | "red" | "running" | "none";
	failing: CheckRun[];
}

export interface StackFrame {
	file: string;
	line: number | null;
	context: string | null;
	inApp: boolean;
}

export interface ErrorItem {
	id: string;
	shortId: string;
	project: string;
	projectName: string;
	title: string;
	culprit: string;
	level: string;
	events: number;
	users: number;
	firstSeen: string;
	lastSeen: string;
	permalink: string;
	histogram: number[];
	environment: string | null;
	firstRelease: string | null;
	kind: "new" | "regression" | "ongoing";
	regressionOf: { workOrderId: number; prNumber: number | null; fixedAt: string | null } | null;
	triage: TriageState | null;
	workOrderId: number | null;
}

export interface ErrorDetail extends ErrorItem {
	stack: StackFrame[];
	likelySource: string | null;
}

export interface TriageState {
	action: "snooze" | "dismiss";
	until: string | null;
	at: string;
}

export type SourceName = "GitHub" | "Sentry" | "T3";

export interface SourceHealth {
	source: SourceName;
	ok: boolean;
	lastOk: string | null;
	error: string | null;
	fix: string | null;
	nextCheckAt: string | null;
}

export type QueueKind =
	| "error"
	| "question"
	| "plan"
	| "red_main"
	| "failed_gates"
	| "ready_pr"
	| "stale_pr"
	| "rebase_pr"
	| "toolkit"
	| "tool"
	| "waiting_in_t3"
	| "run_failed";

export interface QueueItem {
	fingerprint: string;
	kind: QueueKind;
	project: string | null;
	projectName: string | null;
	title: string;
	meta: string;
	since: string;
	users: number;
	href: string;
	error?: ErrorItem;
	workOrder?: WorkOrder;
	pr?: PullRequest;
	main?: MainBranchState & { blocks: number };
	toolkit?: ToolkitState;
	tool?: { name: string; fix: string | null };
}

export type StartBlock = "limit" | "review" | "stopped" | null;

export interface Limits {
	agents: number;
	build: number;
	verify: number;
	review: number;
	pauseOnReview: boolean;
	startBlock: StartBlock;
}

export interface StageCounts {
	Intake: number;
	Plan: number;
	Build: number;
	Verify: number;
	Review: number;
	Ship: number;
	Observe: number;
}

export interface BackSummary {
	since: string;
	shipped: number;
	failed: number;
	newErrors: number;
}

export interface QueueResponse {
	loading: boolean;
	projects: number;
	stages: StageCounts;
	limits: Limits;
	needsYou: QueueItem[];
	later: QueueItem[];
	sources: SourceHealth[];
	back: BackSummary | null;
	firstLook: boolean;
	/** Projects read so far, for the first-look banner. */
	nextCheckAt: string | null;
}

export interface ShellResponse {
	hasProjects: boolean;
	counts: { queue: number; floor: number; prs: number; errors: number; projects: number };
	agents: { working: number; limit: number };
	line: { stopped: boolean; stoppedAt: string | null };
	sources: SourceHealth[];
	checking: boolean;
	build: string;
}

export interface FloorResponse {
	projects: Array<{ slug: string; name: string }>;
	columns: Record<Stage, WorkOrder[]>;
	limits: Limits;
	line: { stopped: boolean; stoppedAt: string | null };
	summary: { shippedThisWeek: number; firstTryPct: number | null; medianToPrMinutes: number | null };
	stopImpact: { finishing: number; waiting: number; review: number };
}

export interface PrDetail extends PullRequest {
	workOrder: WorkOrder | null;
	files: Array<{ path: string; additions: number; deletions: number }>;
	mergeBlockers: string[];
}

export interface ProjectDetail extends Project {
	workOrders: WorkOrder[];
	prs: PullRequest[];
	errors: ErrorItem[];
	shipped: WorkOrder[];
	main: MainBranchState | null;
	blockedRemove: "open_work" | "last_project" | null;
}

export interface WorkTypeHealth {
	type: WorkType;
	runs: number;
	firstTryPct: number | null;
	medianToPrMinutes: number | null;
	regressions: number;
	qualifies: boolean;
	mergeWithoutMe: boolean;
	turnedOffByRegression: boolean;
}

export interface DailyNumbers {
	day: string;
	shipped: number;
	firstTryPct: number | null;
	medianToPrMinutes: number | null;
	regressions: number;
}

export interface HealthResponse {
	finished: number;
	byType: WorkTypeHealth[];
	daily: DailyNumbers[];
	totals: {
		shipped: number;
		firstTryPct: number | null;
		medianToPrMinutes: number | null;
		regressions: number;
	};
}

export interface AgentSettings {
	agentsAtOnce: number;
	pauseOnReview: boolean;
	retries: number;
	agent: string;
}

export type PlanReview = "always" | "skip";

export interface ApprovalSettings {
	planReview: Record<WorkType, PlanReview>;
	mergeWithoutMe: Record<WorkType, boolean>;
	turnedOffByRegression: Record<WorkType, boolean>;
	thresholds: { runs: number; firstTryPct: number };
}

export const NOTIFICATION_EVENTS = [
	"question",
	"plan",
	"ready_pr",
	"failed_gates",
	"error",
	"red_main",
	"merged_alone",
	"shipped",
	"slots_full",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationSettings {
	events: Record<NotificationEvent, boolean>;
	onlyWhenAway: boolean;
	lastTest: "ok" | "failed" | null;
}

export interface ProjectSettings {
	cloneFolder: string;
	neverTouch: string[];
}

export interface Settings {
	agents: AgentSettings;
	approvals: ApprovalSettings;
	notifications: NotificationSettings;
	projects: ProjectSettings;
}

export interface ToolStatus {
	name: string;
	purpose: string;
	required: boolean;
	state: "ready" | "signed_out" | "missing" | "error";
	detail: string;
	fix: string | null;
	version: string | null;
}

export interface RepoChoice {
	repo: string;
	slug: string;
	name: string;
	pushedAt: string | null;
	isPrivate: boolean;
	localPath: string | null;
	added: boolean;
}

export interface RepoListResponse {
	repos: RepoChoice[];
	/** How many matched a Never touch rule. Their names don't leave the service. */
	skipped: number;
	cloneFolder: string;
}

export interface ReadingProgress {
	slug: string;
	name: string;
	state: "reading" | "done";
	summary: string;
	warning: string | null;
}

export interface ReadingResponse {
	projects: ReadingProgress[];
	skipped: number;
	ready: boolean;
}

export interface ApiError {
	error: string;
}

export interface MergeResult {
	ok: boolean;
	reason: string;
}

export interface BulkMergeResult {
	merged: number[];
	failed: Array<{ project: string; number: number; reason: string }>;
}

export interface SyncResult {
	started: Array<{ slug: string; workOrderId: number; waiting: boolean }>;
	blocked: Array<{ slug: string; reason: string }>;
}

export type NewProjectStep = "describe" | "approve" | "scaffold" | "failed" | "baseline" | "connect" | "done";

export interface NewProjectLogLine {
	step: string;
	state: "done" | "running" | "failed" | "pending";
	at: string | null;
	detail?: string;
}

export interface NewProjectRun {
	id: number;
	name: string;
	description: string;
	template: string;
	visibility: "private" | "public";
	repo: string;
	localPath: string;
	step: NewProjectStep;
	log: NewProjectLogLine[];
	failure: string | null;
	created: string[];
	services: Record<string, "open" | "connected" | "skipped">;
	serviceTools: Record<string, { installed: boolean; fix: string | null }>;
	projectSlug: string | null;
	workOrderId: number | null;
}
