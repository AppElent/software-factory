import type { ReactNode } from "react";
import type { Gates, Limits, Mode, QueueItem, QueueKind, WorkOrder } from "../../shared/types.ts";
import { GATE_NAMES } from "../../shared/types.ts";
import { api } from "../api.ts";
import { confirmOnProductionError, FixButton, fixLabel } from "../fix.tsx";
import { ago, plural, span } from "../format.ts";
import {
	Button,
	ButtonLink,
	ButtonOut,
	CodeBlock,
	Facts,
	GATE_WORD,
	GateRow,
	Glyph,
	Histogram,
	InlineError,
	Lnk,
	Muted,
	Pane,
} from "../kit.tsx";
import { useAction, useError, useProjects } from "../queries.ts";
import { CheckNow, DeployActions, FixEnvironment } from "./environments.tsx";

/* The right-hand pane, one body per queue item kind. Everything from outside the factory renders as text. */

export type TriageAction = "snooze" | "dismiss";

export interface PaneActions {
	limits: Limits;
	start: (mode?: Mode | null, confirmed?: boolean) => void;
	startPending: boolean;
	startError: string | null;
	/** Set when a sync couldn't start because the project's folder is missing. */
	blocked: { slug: string; name: string } | null;
	triage: (action: TriageAction) => void;
	triagePending: boolean;
	triageError: string | null;
}

const STARTS: QueueKind[] = ["error", "red_main", "stale_pr", "rebase_pr", "toolkit"];
const TRIAGES: QueueKind[] = [
	"env_down",
	"env_down_later",
	"error",
	"red_main",
	"ready_pr",
	"stale_pr",
	"rebase_pr",
	"toolkit",
	"tool",
];

/** Kinds that begin a new work order. The rest already have one, or a PR to review. */
export const canStart = (kind: QueueKind) => STARTS.includes(kind);
/** Kinds with Snooze and Dismiss. An agent waiting on you can't be snoozed. */
export const canTriage = (kind: QueueKind) => TRIAGES.includes(kind);

/** "22 minutes", "3 hours", "87 days". */
export function spanWords(iso: string, now = Date.now()): string {
	const minutes = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
	if (minutes < 60) return plural(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (hours < 48) return plural(hours, "hour");
	return plural(Math.round(hours / 24), "day");
}

/* ---------- parts ---------- */

function Heading({ meta, title }: { meta: ReactNode; title: ReactNode }) {
	return (
		<div>
			<span className="text-meta text-text-muted [overflow-wrap:anywhere]">{meta}</span>
			<h2 className="mb-0 mt-1 text-detail-title [overflow-wrap:anywhere]">{title}</h2>
		</div>
	);
}

const Body = ({ children }: { children: ReactNode }) => (
	<p className="m-0 text-text-muted [overflow-wrap:anywhere]">{children}</p>
);

/** Snooze and Dismiss, with the failure right under them. */
function Triage({ actions }: { actions: PaneActions }) {
	return (
		<>
			<div className="grid grid-cols-2 gap-2">
				<Button disabled={actions.triagePending} onClick={() => actions.triage("snooze")}>
					Snooze
				</Button>
				<Button disabled={actions.triagePending} onClick={() => actions.triage("dismiss")}>
					Dismiss
				</Button>
			</div>
			<InlineError>{actions.triageError}</InlineError>
		</>
	);
}

function StartButton({ actions, label }: { actions: PaneActions; label: ReactNode }) {
	return (
		<>
			<Button variant="primary" grow disabled={actions.startPending} onClick={() => actions.start()}>
				{label}
			</Button>
			<InlineError>{actions.startError}</InlineError>
			{actions.blocked && (
				<div role="alert" className="flex flex-wrap items-center gap-2 text-status-fail">
					<Glyph kind="fail" size={14} />
					Folder missing
					<Lnk to={`/projects/${actions.blocked.slug}`}>Fix {actions.blocked.name}</Lnk>
				</div>
			)}
		</>
	);
}

/** Starting a fix, with a choice of how. */
function FixStart({ actions, item }: { actions: PaneActions; item: QueueItem }) {
	const body = {
		project: item.project,
		type: "Bug fix",
		title: item.title,
		description: item.title,
		source: { kind: item.kind === "error" ? "error" : "red_main", fingerprint: item.fingerprint },
	};
	return (
		<>
			<FixButton
				grow
				label={(mode) => fixLabel(1, mode, !!actions.limits.startBlock)}
				pending={actions.startPending}
				run={(mode, confirmed) => actions.start(mode, confirmed)}
				confirm={item.kind === "error" ? confirmOnProductionError(1) : undefined}
				commands={() => [body]}
			/>
			<InlineError>{actions.startError}</InlineError>
		</>
	);
}

function waitHint(limits: Limits): string {
	if (limits.startBlock === "stopped") return "The line is stopped. This waits in Intake until you restart.";
	if (limits.startBlock === "review") return "New work waits in Intake until you review a PR.";
	if (limits.agents === 1) return "Your 1 agent slot is busy. This waits in Intake and starts when it opens.";
	return `All ${limits.agents} agent slots are busy. This waits in Intake and starts when a slot opens.`;
}

function FailureLine({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-start gap-2">
			<Glyph kind="fail" />
			<span className="font-medium [overflow-wrap:anywhere]">{children}</span>
		</div>
	);
}

const workOrderMeta = (item: QueueItem, w: WorkOrder) =>
	`${w.projectName} · WO-${w.id} · ${w.stage} · waiting ${span(item.since)}`;

/* ---------- error ---------- */

/** Bars well above the usual count are the spike. */
function spikeLimit(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	return Math.max((sorted[Math.floor(sorted.length / 2)] ?? 0) * 2, 2);
}

function histogramLabel(values: number[], limit: number) {
	let trailing = 0;
	for (let i = values.length - 1; i >= 0 && (values[i] ?? 0) > limit; i -= 1) trailing += 1;
	const base = "Events over the last 24 hours";
	if (trailing === 0) return base;
	const hours = Math.max(1, Math.round((trailing * 24) / values.length));
	return `${base}, rising sharply in the last ${plural(hours, "hour")}`;
}

function ErrorPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const error = item.error;
	const detail = useError(error?.id ?? "");
	const projects = useProjects();
	if (!error) return null;
	const sentry = projects.data?.find((p) => p.slug === error.project)?.sentryProject;
	const meta = [error.projectName, error.environment, sentry].filter(Boolean).join(" · ");
	const limit = spikeLimit(error.histogram);
	const facts: Array<[ReactNode, ReactNode, boolean?]> = [];
	if (error.firstRelease) facts.push(["First release", error.firstRelease, true]);
	if (detail.data?.likelySource) facts.push(["Likely source", detail.data.likelySource, true]);
	return (
		<>
			<Heading meta={meta} title={error.title} />
			<div className="flex flex-col gap-2">
				{error.histogram.length > 0 && (
					<Histogram
						values={error.histogram}
						label={histogramLabel(error.histogram, limit)}
						spike={(v) => v > limit}
						unit=" events"
					/>
				)}
				<div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-data">
					<span>{plural(error.events, "event")}</span>
					<span>{plural(error.users, "user")}</span>
					<span>first seen {ago(error.firstSeen)}</span>
				</div>
			</div>
			{facts.length > 0 && <Facts rows={facts} />}
			<div className="flex flex-col gap-2 border-0 border-t border-solid border-border-subtle pt-4">
				<h3 className="m-0 text-body font-semibold">Bug fix</h3>
				<p className="m-0 text-meta text-text-muted">
					{actions.limits.startBlock
						? waitHint(actions.limits)
						: "Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. It won't merge."}
				</p>
				<FixStart actions={actions} item={item} />
				<Triage actions={actions} />
				<ButtonLink to={item.href} grow>
					Open full error
				</ButtonLink>
			</div>
		</>
	);
}

/* ---------- red main ---------- */

function RedMainPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const main = item.main;
	const projects = useProjects();
	if (!main) return null;
	const branch = projects.data?.find((p) => p.slug === item.project)?.defaultBranch ?? "main";
	const log = main.failing.find((f) => f.url)?.url;
	return (
		<>
			<Heading meta={`${item.projectName} · ${branch} · ${item.meta}`} title={item.title} />
			{main.failing.length > 0 && (
				<CodeBlock>
					{main.failing.map((f) => `${f.workflow ? `${f.workflow} / ` : ""}${f.name} failed`).join("\n")}
				</CodeBlock>
			)}
			<Facts
				rows={[
					["Commit", main.sha.slice(0, 7), true],
					["Red for", spanWords(main.committedAt)],
					["Blocks", plural(main.blocks, "open PR")],
				]}
			/>
			<FixStart actions={actions} item={item} />
			<Triage actions={actions} />
			{log && (
				<ButtonOut href={log} grow>
					Open the log
				</ButtonOut>
			)}
		</>
	);
}

function EnvDownPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const e = item.environment;
	if (!e) return null;
	const after =
		e.deployedAt && e.health.downSince
			? Math.round((Date.parse(e.health.downSince) - Date.parse(e.deployedAt)) / 60_000)
			: null;
	return (
		<>
			<Heading meta={`${item.projectName} · ${e.name} · ${item.meta}`} title={item.title} />
			<Facts
				rows={[
					["Down for", spanWords(e.health.downSince ?? item.since)],
					["Commit", e.deployedSha ? e.deployedSha.slice(0, 7) : "–", true],
					["Errors", plural(e.errors, "error")],
				]}
			/>
			{after !== null && after >= 0 && (
				<p className="m-0 text-text-muted">It went down {after}m after the last deploy.</p>
			)}
			<FixEnvironment e={e} />
			<DeployActions e={e} folder={e.folder} again />
			<CheckNow e={e} grow />
			<Triage actions={actions} />
			<ButtonLink to="/projects/$slug/environments" params={{ slug: e.project }} grow>
				Open project page
			</ButtonLink>
		</>
	);
}

/* ---------- pull requests ---------- */

function gatesSummary(gates: Gates) {
	const passed = GATE_NAMES.filter((n) => gates[n] === "passed").length;
	if (passed === GATE_NAMES.length) return `All ${passed} gates passed`;
	const others = GATE_NAMES.filter((n) => gates[n] !== "passed").map(
		(n) => `${n} ${GATE_WORD[gates[n]].toLowerCase()}`,
	);
	return `${passed} of ${GATE_NAMES.length} gates passed · ${others.join(", ")}`;
}

function ReadyPrPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const pr = item.pr;
	if (!pr) return null;
	const facts: Array<[ReactNode, ReactNode, boolean?]> = [
		["Size", `+${pr.additions} −${pr.deletions} · ${plural(pr.changedFiles, "file")}`, true],
	];
	if (pr.workOrderId) facts.push(["Work order", `WO-${pr.workOrderId}`]);
	const meta = [pr.projectName, `PR #${pr.number}`, pr.workType].filter(Boolean).join(" · ");
	return (
		<>
			<Heading meta={meta} title={pr.title} />
			<div className="flex items-center gap-2">
				<GateRow gates={pr.gates} />
				<Muted className="text-meta">{gatesSummary(pr.gates)}</Muted>
			</div>
			<Facts rows={facts} />
			<ButtonLink variant="primary" to={item.href} grow>
				Review PR
			</ButtonLink>
			<Triage actions={actions} />
		</>
	);
}

function RebasePane({ item, actions, stale }: { item: QueueItem; actions: PaneActions; stale?: boolean }) {
	const pr = item.pr;
	if (!pr) return null;
	const conflicts = pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY";
	const gatesPassed = GATE_NAMES.every((n) => pr.gates[n] === "passed");
	let body: string;
	if (stale) {
		body = `No commits or comments for ${spanWords(pr.updatedAt)}.${conflicts ? ` It conflicts with ${pr.baseRef}.` : ""}`;
	} else if (gatesPassed) {
		body = `Gates passed ${spanWords(pr.updatedAt)} ago. ${pr.baseRef} moved on, so they need to run again after a rebase.`;
	} else {
		body = `${pr.baseRef} moved on, so the gates need to run again after a rebase.`;
	}
	const state = stale ? `stale ${spanWords(pr.updatedAt)}` : "needs rebase";
	return (
		<>
			<Heading meta={`${pr.projectName} · PR #${pr.number} · ${state}`} title={pr.title} />
			<Body>{body}</Body>
			<StartButton actions={actions} label="Start rebase work order" />
			<Triage actions={actions} />
		</>
	);
}

/* ---------- toolkit and tools ---------- */

function ToolkitPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const toolkit = item.toolkit;
	if (!toolkit) return null;
	return (
		<>
			<Heading
				meta={`${item.projectName} · ${plural(toolkit.behindDays, "day")} behind`}
				title={item.title}
			/>
			<Body>
				{toolkit.changed === 1 ? "1 standard" : `${toolkit.changed} standards`} changed in developer-tools
				since the last sync.
			</Body>
			<StartButton actions={actions} label="Start sync work order" />
			<Triage actions={actions} />
		</>
	);
}

function ToolPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	return (
		<>
			<Heading meta={item.tool?.name ?? item.meta} title={item.title} />
			{item.tool?.fix && <CodeBlock>{item.tool.fix}</CodeBlock>}
			<ButtonLink variant="primary" to="/settings/tools" grow>
				Open Tools
			</ButtonLink>
			<Triage actions={actions} />
		</>
	);
}

function NewProjectPane({ item }: { item: QueueItem }) {
	const run = item.newProject;
	if (!run) return null;
	return (
		<>
			<Heading meta={item.meta} title={item.title} />
			<ButtonLink
				variant="primary"
				to="/projects/new/$step"
				params={{ step: run.step }}
				search={{ run: run.id } as never}
				grow
			>
				Open setup
			</ButtonLink>
		</>
	);
}

/* ---------- work orders waiting on you ---------- */

function OpenWorkOrder({ item, primary }: { item: QueueItem; primary?: boolean }) {
	return (
		<ButtonLink variant={primary ? "primary" : "secondary"} to={item.href} grow>
			Open work order
		</ButtonLink>
	);
}

function QuestionPane({ item, w }: { item: QueueItem; w: WorkOrder }) {
	return (
		<>
			<Heading meta={workOrderMeta(item, w)} title={w.question?.question ?? w.title} />
			{w.question?.detail && <Body>{w.question.detail}</Body>}
			<ButtonLink variant="primary" to={item.href} grow>
				Answer
			</ButtonLink>
			<OpenWorkOrder item={item} />
		</>
	);
}

function PlanPane({ item, w }: { item: QueueItem; w: WorkOrder }) {
	const facts: Array<[ReactNode, ReactNode, boolean?]> = [];
	if (w.plan?.estimate) facts.push(["Estimate", w.plan.estimate]);
	if (w.plan?.risk) facts.push(["Risk", w.plan.risk]);
	if (w.plan?.files) facts.push(["Files", w.plan.files, true]);
	return (
		<>
			<Heading meta={workOrderMeta(item, w)} title={w.title} />
			{w.plan?.summary && <Body>{w.plan.summary}</Body>}
			{facts.length > 0 && <Facts rows={facts} />}
			<ButtonLink variant="primary" to={item.href} grow>
				Review plan
			</ButtonLink>
		</>
	);
}

function failedTimes(w: WorkOrder) {
	const gate = w.failedGate ?? "A gate";
	if (w.retries === 0) return `${gate} failed`;
	if (w.retries === 1) return `${gate} failed twice`;
	return `${gate} failed ${w.retries + 1} times`;
}

function FailedGatesPane({ item, w }: { item: QueueItem; w: WorkOrder }) {
	return (
		<>
			<Heading meta={workOrderMeta(item, w)} title={w.title} />
			<FailureLine>{failedTimes(w)}</FailureLine>
			{w.failure && <CodeBlock>{w.failure}</CodeBlock>}
			<div className="flex items-center gap-2">
				<GateRow gates={w.gates} />
				<Muted className="text-meta">{gatesSummary(w.gates)}</Muted>
			</div>
			<OpenWorkOrder item={item} primary />
			{w.threadLink && (
				<ButtonOut href={w.threadLink} grow>
					Take over in T3
				</ButtonOut>
			)}
		</>
	);
}

function WaitingInT3Pane({ item, w }: { item: QueueItem; w: WorkOrder }) {
	return (
		<>
			<Heading meta={workOrderMeta(item, w)} title={w.title} />
			<Body>The agent asked for something only T3 can answer. Answer it there and the work carries on.</Body>
			{w.threadLink && (
				<ButtonOut variant="primary" href={w.threadLink} grow>
					Open in T3
				</ButtonOut>
			)}
			<OpenWorkOrder item={item} primary={!w.threadLink} />
		</>
	);
}

function RunFailedPane({ item, w }: { item: QueueItem; w: WorkOrder }) {
	const retry = useAction(() => api.post(`/api/work-orders/${w.id}/retry`, {}));
	return (
		<>
			<Heading meta={workOrderMeta(item, w)} title={w.title} />
			<FailureLine>This run failed.</FailureLine>
			{w.failure && <CodeBlock>{w.failure}</CodeBlock>}
			<Button variant="primary" grow disabled={retry.pending} onClick={() => void retry.run()}>
				Try again
			</Button>
			<InlineError>{retry.error && "Couldn't retry this. Try again."}</InlineError>
			{w.threadLink && (
				<ButtonOut href={w.threadLink} grow>
					Open in T3
				</ButtonOut>
			)}
			<OpenWorkOrder item={item} />
		</>
	);
}

/* ---------- the pane ---------- */

function PaneBody({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	const w = item.workOrder;
	switch (item.kind) {
		case "env_down":
		case "env_down_later":
			return <EnvDownPane item={item} actions={actions} />;
		case "error":
			return <ErrorPane item={item} actions={actions} />;
		case "red_main":
			return <RedMainPane item={item} actions={actions} />;
		case "ready_pr":
			return <ReadyPrPane item={item} actions={actions} />;
		case "stale_pr":
			return <RebasePane item={item} actions={actions} stale />;
		case "rebase_pr":
			return <RebasePane item={item} actions={actions} />;
		case "toolkit":
			return <ToolkitPane item={item} actions={actions} />;
		case "tool":
			return <ToolPane item={item} actions={actions} />;
		case "new_project":
			return <NewProjectPane item={item} />;
		case "question":
			return w ? <QuestionPane item={item} w={w} /> : null;
		case "plan":
			return w ? <PlanPane item={item} w={w} /> : null;
		case "failed_gates":
			return w ? <FailedGatesPane item={item} w={w} /> : null;
		case "waiting_in_t3":
			return w ? <WaitingInT3Pane item={item} w={w} /> : null;
		case "run_failed":
			return w ? <RunFailedPane item={item} w={w} /> : null;
	}
}

export function ItemPane({ item, actions }: { item: QueueItem; actions: PaneActions }) {
	return (
		<Pane>
			<PaneBody item={item} actions={actions} />
		</Pane>
	);
}
