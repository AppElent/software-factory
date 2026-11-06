import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GATE_NAMES, type Gates, STAGES, type Stage, type WorkOrder } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, clock, minutes, plural, span } from "../format.ts";
import {
	Banner,
	Button,
	ButtonLink,
	GateRow,
	Glyph,
	type GlyphKind,
	InlineError,
	Lnk,
	LoadFailed,
	Mono,
	Page,
	PageHeader,
	SectionLabel,
	Skeleton,
	useTick,
} from "../kit.tsx";
import { useAction, useFloor, useShell } from "../queries.ts";
import { useOpenNewWorkOrder } from "../shell.tsx";

const GRID = "grid items-start gap-2";
const AGENT_STATES: WorkOrder["state"][] = ["planning", "building", "retrying", "rebasing"];

/** "Tests failed twice", from the gate and how many retries it took. */
export function failedAgain(retries: number): string {
	if (retries <= 0) return "failed";
	if (retries === 1) return "failed twice";
	return `failed ${retries + 1} times`;
}

function reviewStatus(gates: Gates): { glyph: GlyphKind; text: string } {
	const failed = GATE_NAMES.find((n) => gates[n] === "failed");
	if (failed) return { glyph: "fail", text: `${failed} failed` };
	if (GATE_NAMES.some((n) => gates[n] === "out_of_date")) return { glyph: "idle", text: "Needs rebase" };
	if (GATE_NAMES.every((n) => gates[n] === "passed")) return { glyph: "pass", text: "Ready to merge" };
	return { glyph: "run", text: "Checks running" };
}

function cardStatus(w: WorkOrder, stopped: boolean, caused: number): { glyph: GlyphKind; text: string } {
	const working = AGENT_STATES.includes(w.state);
	if (working && stopped) return { glyph: "run", text: "Finishing its step" };
	if (working && w.hold) return { glyph: "run", text: "Stopping at its next step" };
	if (w.heldByLine && w.state !== "waiting") return { glyph: "idle", text: "Stopped with the line" };
	if (w.hold && (w.state === "plan_approved" || w.state === "build_done" || w.state === "verifying")) {
		return { glyph: "idle", text: "Stopped by you" };
	}
	switch (w.state) {
		case "waiting":
			return { glyph: "idle", text: w.type === "Feature" ? "Idea · waiting" : "Waiting" };
		case "planning":
			return { glyph: "run", text: w.plan ? "Rewriting the plan" : "Writing the plan" };
		case "plan_ready":
			return { glyph: "ask", text: "Approve plan" };
		case "plan_approved":
			return { glyph: "idle", text: "Waiting for a Build slot" };
		case "building":
			return { glyph: "run", text: "Working" };
		case "build_done":
			return { glyph: "idle", text: "Waiting for a Verify slot" };
		case "question":
			return { glyph: "ask", text: "Agent asks a question" };
		case "waiting_in_t3":
			return { glyph: "ask", text: "Waiting in T3" };
		case "run_failed":
			return { glyph: "fail", text: "Run failed" };
		case "verifying":
			return { glyph: "run", text: "Gates running" };
		case "retrying":
			return { glyph: "run", text: "Retrying" };
		case "failed":
			return { glyph: "fail", text: `${w.failedGate ?? "Gates"} ${failedAgain(w.retries)}` };
		case "ready":
			return reviewStatus(w.gates);
		case "rebasing":
			return { glyph: "run", text: "Rebasing" };
		case "shipping":
			return { glyph: "run", text: "Shipping" };
		case "observing":
			return caused > 0
				? { glyph: "err", text: `Shipped ${ago(w.mergedAt)} · caused ${plural(caused, "error")}` }
				: { glyph: "pass", text: `Shipped ${ago(w.mergedAt)} · no new errors` };
		default:
			return { glyph: "idle", text: "Closed" };
	}
}

const CARD = "hover-card flex flex-col gap-1 rounded-sm bg-bg-raised px-3 py-2";

function CardBody({
	id,
	age,
	title,
	project,
	glyph,
	status,
	gates,
}: {
	id: string;
	age?: string;
	title: string;
	project: string;
	glyph: GlyphKind;
	status: string;
	gates?: Gates;
}) {
	return (
		<>
			<div className="flex items-center gap-2">
				<Mono className="text-text-muted">{id}</Mono>
				{age && <Mono className="ms-auto text-text-muted">{age}</Mono>}
			</div>
			<div className="font-medium [overflow-wrap:anywhere]">{title}</div>
			<span className="text-meta text-text-muted [overflow-wrap:anywhere]">{project}</span>
			<div className="mt-1 flex flex-wrap items-center gap-2">
				<span className="flex min-w-0 items-start gap-2">
					<span className="mt-px">
						<Glyph kind={glyph} size={14} />
					</span>
					<span className="min-w-0 text-meta text-text-muted">{status}</span>
				</span>
				{gates && (
					<span className="ms-auto">
						<GateRow gates={gates} />
					</span>
				)}
			</div>
		</>
	);
}

/** Boards show an age from Build through Review, where time spent is the thing to watch. */
const AGED: Stage[] = ["Build", "Verify", "Review", "Ship"];

function WorkOrderCard({ w, stopped, caused }: { w: WorkOrder; stopped: boolean; caused: number }) {
	const { glyph, text } = cardStatus(w, stopped, caused);
	const body = {
		age: AGED.includes(w.stage) ? span(w.createdAt) : undefined,
		title: w.title,
		project: w.projectName,
		glyph,
		status: text,
		gates: w.stage === "Verify" || w.stage === "Review" ? w.gates : undefined,
	};
	if (w.stage === "Review" && w.prNumber) {
		return (
			<Link
				to="/prs/$project/$number"
				params={{ project: w.project, number: String(w.prNumber) }}
				className={CARD}
			>
				<CardBody id={`#${w.prNumber}`} {...body} />
			</Link>
		);
	}
	return (
		<Link to="/work-orders/$id" params={{ id: String(w.id) }} className={CARD}>
			<CardBody id={`WO-${w.id}`} {...body} />
		</Link>
	);
}

function Column({ stage, count, children }: { stage: Stage; count: ReactNode; children: ReactNode }) {
	return (
		<section aria-label={stage} className="flex min-w-0 flex-col gap-2">
			<div className="flex min-h-7 items-center gap-2">
				<SectionLabel>{stage}</SectionLabel>
				<span className="ms-auto inline-flex items-center gap-1 font-mono text-data text-text-muted">
					{count}
				</span>
			</div>
			{children}
		</section>
	);
}

const Full = ({ used, limit }: { used: number; limit: number }) => (
	<>
		<Glyph kind="ask" size={12} />
		<span>Full</span>
		{used}/{limit}
	</>
);

/** Each column is 140px or wider, so the board scrolls in its own region when it can't fit. */
function template(shipEmpty: boolean) {
	return STAGES.map((s) => (s === "Ship" && shipEmpty ? "minmax(88px,0.5fr)" : "minmax(140px,1fr)")).join(
		" ",
	);
}

function LoadingBoard() {
	return (
		<>
			<div role="status" className="sr-only">
				Loading the floor
			</div>
			<div className="overflow-x-auto pb-2">
				<div className={GRID} style={{ gridTemplateColumns: template(false) }}>
					{STAGES.map((s) => (
						<Column key={s} stage={s} count={null}>
							<div className="flex flex-col gap-2 rounded-sm bg-bg-raised px-3 py-2">
								<Skeleton width="40%" />
								<Skeleton width="90%" />
								<Skeleton width="60%" />
							</div>
						</Column>
					))}
				</div>
			</div>
		</>
	);
}

export function FloorScreen() {
	useTick();
	const { project } = useSearch({ from: "/shell/floor" });
	const navigate = useNavigate({ from: "/floor" });
	const openNew = useOpenNewWorkOrder();
	const floor = useFloor(project);
	const restart = useAction(() => api.post("/api/line", { stopped: false }));
	const shell = useShell();
	const data = floor.data;
	// Before the first read, an empty board means "not known yet", not "nothing here".
	const reading =
		!!data &&
		data.observeErrors.length === 0 &&
		STAGES.every((s) => data.columns[s].length === 0) &&
		(shell.isPending || !!shell.data?.checking);

	const known = data?.projects.some((p) => p.slug === project);
	const sorted = [...(data?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
	const summary = data?.summary;
	const stopped = data?.line.stopped ?? false;
	// While the line is stopped, nothing waits on a slot, so nothing reads as full.
	const buildFull = !!data && !stopped && data.limits.build >= data.limits.agents;
	const reviewFull =
		!!data && !stopped && data.limits.pauseOnReview && data.limits.review >= data.limits.agents;

	return (
		<Page>
			<PageHeader
				title="Floor"
				summary={
					summary &&
					!reading && (
						<Lnk to="/health" muted className="text-meta">
							{[
								`${summary.shippedThisWeek} shipped this week`,
								summary.firstTryPct != null && `${summary.firstTryPct}% first try`,
								summary.medianToPrMinutes != null && `${minutes(summary.medianToPrMinutes)} median to PR`,
							]
								.filter(Boolean)
								.join(" · ")}
						</Lnk>
					)
				}
				actions={
					<span className="flex flex-wrap items-center gap-2">
						<label htmlFor="floor-project" className="text-meta text-text-muted">
							Project
						</label>
						<select
							id="floor-project"
							value={project ?? ""}
							onChange={(e) =>
								void navigate({
									search: (prev) => ({ ...prev, project: e.target.value || undefined }),
								})
							}
						>
							<option value="">All projects</option>
							{project && data && !known && <option value={project}>{project}</option>}
							{sorted.map((p) => (
								<option key={p.slug} value={p.slug}>
									{p.name}
								</option>
							))}
						</select>
						<Button onClick={() => openNew({ project })}>New work order</Button>
					</span>
				}
			/>

			{stopped && data && (
				<>
					<Banner
						role="alert"
						glyph="fail"
						title={`Line stopped at ${clock(data.line.stoppedAt)}`}
						body={
							data.stopImpact.finishing === 1
								? "Nothing new starts. 1 agent is finishing the step it’s on, then it holds. PRs and errors keep updating."
								: data.stopImpact.finishing === 0
									? "Nothing new starts. No agents are working. PRs and errors keep updating."
									: `Nothing new starts. ${data.stopImpact.finishing} agents are finishing the step they’re on, then they hold. PRs and errors keep updating.`
						}
						actions={
							<Button variant="primary" disabled={restart.pending} onClick={() => void restart.run()}>
								Restart the line
							</Button>
						}
					/>
					<InlineError>{restart.error && "Couldn't restart the line. Try again."}</InlineError>
				</>
			)}
			{buildFull && (
				<Banner
					role="status"
					glyph="ask"
					title="Build is full"
					body="Work orders wait in Intake and start when a slot opens."
				/>
			)}
			{reviewFull && (
				<Banner
					role="status"
					glyph="ask"
					title="Review is full"
					body="New work waits in Intake until you review a PR. You turned this on in Settings."
					actions={
						<>
							<ButtonLink to="/prs">Review PRs</ButtonLink>
							<ButtonLink to="/settings/$section" params={{ section: "agents" }}>
								Change this
							</ButtonLink>
						</>
					}
				/>
			)}

			{data && !reading ? (
				<div className="overflow-x-auto pb-2">
					<div className={GRID} style={{ gridTemplateColumns: template(data.columns.Ship.length === 0) }}>
						{STAGES.map((stage) => {
							const cards = data.columns[stage];
							const errors = stage === "Observe" ? data.observeErrors : [];
							const total = cards.length + errors.length;
							let count: ReactNode = total;
							if (stage === "Build") {
								count = buildFull ? (
									<Full used={data.limits.build} limit={data.limits.agents} />
								) : (
									`${data.limits.build}/${data.limits.agents}`
								);
							} else if (stage === "Verify") {
								count = `${data.limits.verify}/${data.limits.agents}`;
							} else if (stage === "Review" && reviewFull) {
								count = <Full used={data.limits.review} limit={data.limits.agents} />;
							}
							return (
								<Column key={stage} stage={stage} count={count}>
									{cards.map((w) => (
										<WorkOrderCard key={w.id} w={w} stopped={stopped} caused={data.causedErrors[w.id] ?? 0} />
									))}
									{errors.map((e) => (
										<Link key={e.id} to="/errors/$id" params={{ id: e.id }} className={CARD}>
											<CardBody
												id={e.shortId}
												title={e.title}
												project={e.projectName}
												glyph="err"
												status={plural(e.users, "user")}
											/>
										</Link>
									))}
									{total === 0 && <p className="m-0 px-3 py-2 text-meta text-text-muted">Nothing here</p>}
								</Column>
							);
						})}
					</div>
				</div>
			) : floor.isError ? (
				<LoadFailed what="the floor" error={floor.error} />
			) : (
				<LoadingBoard />
			)}
		</Page>
	);
}
