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
	kind:
		| "person"
		| "error"
		| "issue"
		| "environment"
		| "restored"
		| "red_main"
		| "stale_pr"
		| "rebase_pr"
		| "pr_changes"
		| "toolkit"
		| "new_project";
	fingerprint?: string;
	/** Text from outside the factory. Reaches the agent only as delimited data. */
	data?: string;
	prNumber?: number;
	issueNumber?: number;
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

export type ModePlan = "follow" | "always" | "skip";
export type ModeMerge = "you" | "factory";

/** How one run goes. Chosen per run, and saved in the plain config file. */
export interface Mode {
	id: string;
	name: string;
	description: string;
	/** Added before the work order's own instructions. */
	prompt: string;
	plan: ModePlan;
	merge: ModeMerge;
	provider: string | null;
	model: string | null;
	/** One of the modes a new install starts with, so Reset to default has something to go back to. */
	builtin: boolean;
}

export interface ModesResponse {
	modes: Mode[];
	defaultMode: string;
	defaults: Mode[];
	/** Skills found on this Mac. Offered, never assumed. */
	skills: string[];
	configPath: string;
}

export interface WorkOrder {
	id: number;
	/** The mode as it was when this started, so editing a mode doesn't change running work. */
	mode: Mode | null;
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

export const SEVERITIES = ["critical", "high", "moderate", "low"] as const;
/** GitHub's words for how bad an advisory is. */
export type Severity = (typeof SEVERITIES)[number];

/** One open Dependabot alert, as GitHub has it. */
export interface SecurityAlertRead {
	number: number;
	severity: Severity;
	package: string;
	ecosystem: string;
	summary: string;
	ghsaId: string;
	/** The first version without it. Null when no fix exists yet. */
	patched: string | null;
	manifest: string | null;
	createdAt: string;
}

export interface SecurityAlert extends SecurityAlertRead {
	url: string;
	/** Open longer than its severity's deadline allows. */
	overdue: boolean;
	/** When its deadline passes, or null when its severity has none. */
	dueAt: string | null;
}

/** The setup checklist. Null means GitHub didn't say, usually for lack of admin rights. */
export interface SecuritySetup {
	alerts: boolean | null;
	securityUpdates: boolean | null;
	dependabotConfig: boolean | null;
	branchProtected: boolean | null;
}

export type SecurityCheck = keyof SecuritySetup;

/** What a GitHub read keeps. The status is worked out on reading back, so a new deadline applies at once. */
export interface SecurityRead {
	alerts: SecurityAlertRead[];
	/** Open alerts on GitHub. Only the first 100 are read. */
	total: number;
	setup: SecuritySetup;
	/** GitHub wouldn't list alerts on the last read. The alerts are the last ones it did list, if any. */
	unread?: boolean;
}

/** `red`: an alert past its deadline. `amber`: open alerts or a setup gap. `unknown`: not read yet. */
export type SecurityStatus = "red" | "amber" | "green" | "unknown";

export interface SecuritySummary {
	status: SecurityStatus;
	total: number;
	overdue: number;
	counts: Record<Severity, number>;
	/** Checklist items that are off. Unknown ones aren't counted. */
	missing: SecurityCheck[];
}

export interface ProjectSecurity extends SecuritySummary {
	slug: string;
	name: string;
	repo: string;
	url: string;
	setup: SecuritySetup;
	alerts: SecurityAlert[];
	readAt: string | null;
	unread: boolean;
}

export interface SecurityResponse {
	projects: ProjectSecurity[];
	deadlines: SecuritySettings["deadlines"];
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
	/** When work the factory merged last finished shipping. No deploy connector exists, so nothing else feeds it. */
	lastDeployAt: string | null;
	openPrs: number;
	openErrors: number;
	openWorkOrders: number;
	redMain: boolean;
	security: SecuritySummary;
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
	/** Why the factory won't merge this yet, when the reason is the agent's work and not the gates. */
	heldBy?: string;
	/** Set while a new commit has no checks yet, though the one before it had some. */
	awaitingChecksSince?: number;
	/** What ran on the commit before, while this commit's checks report. */
	expectedChecks?: CheckRun[];
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
	/** Someone's fork, so the branch name says nothing about whose it is. */
	fromFork: boolean;
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
	/** The release of its latest event. Only read once a fix has merged. */
	latestRelease?: string | null;
	kind: "new" | "regression" | "ongoing";
	regressionOf: { workOrderId: number; prNumber: number | null; fixedAt: string | null } | null;
	triage: TriageState | null;
	workOrderId: number | null;
}

export interface ErrorDetail extends ErrorItem {
	stack: StackFrame[];
	likelySource: string | null;
	/** PRs in the release it first appeared in. Empty until a connector can say. */
	releasePrs: Array<{ number: number; title: string; url: string; additions: number; deletions: number }>;
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
	| "env_down"
	| "env_down_later"
	| "error"
	| "question"
	| "plan"
	| "red_main"
	| "failed_gates"
	| "ready_pr"
	| "stale_pr"
	| "rebase_pr"
	| "toolkit"
	| "security"
	| "security_setup"
	| "tool"
	| "waiting_in_t3"
	| "run_failed"
	| "new_project";

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
	/** `key` names what's wrong, so a dismissal holds until something new is. */
	security?: SecuritySummary & { key: string };
	tool?: { name: string; fix: string | null };
	newProject?: { id: number; step: NewProjectStep };
	environment?: EnvironmentView;
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

/* ---------- automations ---------- */

/** T3's own trigger shapes. A webhook needs T3 Connect, so it can be read here but not made. */
export type AutomationSchedule =
	| { type: "interval"; everyMs: number }
	| { type: "fixed_time"; timeOfDay: string; weekdays?: number[] }
	| { type: "once"; runAt: string }
	| { type: "webhook" };

export interface Automation {
	id: string;
	title: string;
	project: string;
	projectName: string;
	schedule: AutomationSchedule;
	enabled: boolean;
	nextRunAt: string | null;
	lastRunStatus: string | null;
	/** The thread that created it, when this app did. T3 has no link to a schedule itself. */
	link: string | null;
}

export interface AutomationJob {
	id: number;
	name: string;
	projectName: string;
	/** Why it didn't work. Null while it's still going. */
	error: string | null;
	link: string | null;
}

export interface AutomationsResponse {
	items: Automation[];
	readAt: string | null;
	reading: boolean;
	readError: string | null;
	jobs: AutomationJob[];
}

/* ---------- environments ---------- */

/** One target a project deploys to. Lives in your config file, not the database. */
export interface EnvironmentConfig {
	name: string;
	url: string | null;
	healthUrl: string | null;
	deployCommand: string | null;
	sentryEnvironment: string | null;
	issueLabel: string | null;
	production: boolean;
}

export interface EnvHealth {
	state: "up" | "slow" | "down" | "not_checked";
	status: number | null;
	ms: number | null;
	checkedAt: string | null;
	downSince: string | null;
	error: string | null;
}

export interface DeployRun {
	id: number;
	project: string;
	env: string;
	command: string;
	state: "running" | "passed" | "failed" | "stopped";
	startedAt: string;
	finishedAt: string | null;
	exitCode: number | null;
	sha: string | null;
	message: string | null;
	log: string;
}

export interface EnvironmentView extends EnvironmentConfig {
	project: string;
	projectName: string;
	health: EnvHealth;
	/** The newest deploy started from here, running or not. */
	deploy: DeployRun | null;
	deployedSha: string | null;
	deployedAt: string | null;
	/** Commits on main that aren't out there yet. */
	behind: number | null;
	errors: number;
	issues: number;
	/** The project's folder, to show where a deploy runs. */
	folder: string | null;
	workOrderId: number | null;
}

export interface EnvironmentsResponse {
	projects: Array<{ slug: string; name: string; environments: EnvironmentView[] }>;
	/** Column order for the fleet: production last. */
	names: string[];
	checkedAt: string | null;
}

export interface ProjectEnvironmentsResponse {
	environments: EnvironmentView[];
	deploys: DeployRun[];
	configPath: string;
	folder: string | null;
}

export interface EnvSuggestion {
	name: string;
	deployCommand: string | null;
	production: boolean;
	from: string;
}

export type IssueGroup = "needs_read" | "looks_legit" | "looks_off";

/** What can be told about an issue without running a model. */
export interface IssueSignals {
	/** The owner, or someone GitHub lists as working on the repo. */
	trusted: boolean;
	association: string;
	accountAgeDays: number | null;
	links: number;
	outsideLinks: number;
	/** Passages asking the reader to run something. */
	instructions: number;
	/** Passages written to steer an agent. */
	aimedAtAgents: number;
	hidden: number;
}

export interface IssueAdvice {
	verdict: "legit" | "off" | "unsure";
	why: string;
	at: string;
	/** The agent never answered, so asking again is worth it. */
	failed?: boolean;
}

export interface Issue {
	project: string;
	projectName: string;
	number: number;
	title: string;
	url: string;
	body: string;
	author: string | null;
	authorAssociation: string;
	authorCreatedAt: string | null;
	createdAt: string;
	updatedAt: string;
	labels: string[];
	comments: number;
	/** Pins a read to this text. An edit on GitHub changes it. */
	bodyHash: string;
	signals: IssueSignals;
	group: IssueGroup;
	/** When you read this version. */
	readAt: string | null;
	/** You read an earlier version, and it has changed since. */
	editedSinceRead: boolean;
	/** A mode that merges on its own can't start until you've read it. */
	locked: boolean;
	advice: IssueAdvice | null;
	/** An agent is reading it now. */
	asking: boolean;
	workOrderId: number | null;
}

export interface IssuesResponse {
	issues: Issue[];
	checkedAt: string | null;
	/** Projects read, including those with nothing open. */
	projects: number;
}

export interface ShellResponse {
	hasProjects: boolean;
	/** Projects came back from the config file, so this Mac still needs setting up. */
	newDevice: boolean;
	/** Why the config file can't be used. While it's set, nothing merges alone and nothing saves to it. */
	configError: string | null;
	counts: {
		queue: number;
		floor: number;
		prs: number;
		issues: number;
		errors: number;
		environments: number;
		automations: number;
		projects: number;
		security: number;
	};
	agents: { working: number; limit: number };
	line: { stopped: boolean; stoppedAt: string | null };
	sources: SourceHealth[];
	checking: boolean;
	build: string;
}

export interface FloorResponse {
	columns: Record<Stage, WorkOrder[]>;
	/** Errors first seen after a work order in Observe shipped to the same project. */
	observeErrors: ErrorItem[];
	/** How many such errors each work order in Observe caused, by id. */
	causedErrors: Record<number, number>;
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
	last30: { shipped: number; firstTry: number; medianToPrMinutes: number | null };
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
	/** The asked-for window, and the median from the window before it. */
	window: {
		shipped: number;
		firstTry: number;
		medianToPrMinutes: number | null;
		previousMedianToPrMinutes: number | null;
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
	lastTest: "ok" | "failed" | "blocked" | null;
}

export interface ProjectSettings {
	cloneFolder: string;
	neverTouch: string[];
}

/** Days an open alert may stay open before it turns its project red. Null never does. */
export interface SecuritySettings {
	deadlines: Record<Severity, number | null>;
}

export interface Settings {
	agents: AgentSettings;
	approvals: ApprovalSettings;
	notifications: NotificationSettings;
	projects: ProjectSettings;
	security: SecuritySettings;
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
	/** When it last needed you. */
	failedAt?: string;
	/** Checked as free, then started. After a restart mid-step, what's there may be this run's own. */
	claimed?: string[];
}

/* ---------- versions ---------- */

export interface VersionInfo {
	/** When this copy first saw the commit. Checks that never showed up get a few minutes from here. */
	seenAt?: string;
	sha: string;
	label: string;
	message: string;
	state: "preparing" | "ready" | "failed" | "running" | "replaced";
	error: string | null;
	/** When it was prepared, or for one that ran, when it was replaced. */
	at: string;
	canRollBack: boolean;
}

export interface VersionsResponse {
	/** A checkout has no versions to switch between. Installing the service makes them. */
	mode: "release" | "checkout";
	running: { sha: string; label: string; message: string; since: string | null } | null;
	history: VersionInfo[];
	checkedAt: string | null;
	checkError: string | null;
	/** The repo that Improve yourself works on. */
	repo: string | null;
	/** Open work on that repo. */
	building: Array<{ id: number; title: string }>;
}
