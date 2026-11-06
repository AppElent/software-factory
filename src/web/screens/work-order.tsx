import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ownsNoPr } from "../../shared/rules.ts";
import type { ActivityEntry, Plan, WorkOrder } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, clock, plural, span } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonLink,
	ButtonOut,
	Choice,
	CodeBlock,
	Facts,
	Field,
	GateList,
	Glyph,
	type GlyphKind,
	InlineConfirm,
	InlineError,
	Lnk,
	LoadFailed,
	Mono,
	Muted,
	Page,
	Pane,
	SectionLabel,
	Skeleton,
	StageTrack,
	StatusLine,
	useTick,
} from "../kit.tsx";
import { useAction, useShell, useWorkOrder } from "../queries.ts";
import { failedAgain } from "./floor.tsx";

/* ---------- which view a work order is in ---------- */

type View =
	| "plan"
	| "running"
	| "stopping"
	| "held"
	| "line"
	| "question"
	| "failed"
	| "run_failed"
	| "in_t3"
	| "ready"
	| "other";

const AGENT_STATES: WorkOrder["state"][] = ["planning", "building", "retrying", "rebasing"];
/** Waiting for a slot or the gates: nothing the agent can be asked to do right now. */
const BETWEEN: WorkOrder["state"][] = ["waiting", "plan_approved", "build_done", "verifying"];

function viewOf(wo: WorkOrder, lineStopped: boolean): View {
	const working = AGENT_STATES.includes(wo.state);
	if (wo.state === "question") return "question";
	if (wo.state === "plan_ready") return "plan";
	if (wo.state === "failed") return "failed";
	if (wo.state === "run_failed") return "run_failed";
	if (wo.state === "waiting_in_t3") return "in_t3";
	if (wo.state === "ready") return "ready";
	if (lineStopped && (working || wo.heldByLine)) return "line";
	if (working) return wo.hold ? "stopping" : "running";
	if (wo.hold && BETWEEN.includes(wo.state)) return "held";
	return "other";
}

function statusOf(wo: WorkOrder, view: View, stoppedAt: string | null): { glyph: GlyphKind; text: string } {
	const gate = wo.failedGate ?? "Gates";
	switch (view) {
		case "plan":
			return { glyph: "ask", text: "Plan ready for you" };
		case "running":
			return { glyph: "run", text: `Agent working · ${span(wo.stageAt)}` };
		case "stopping":
			return { glyph: "run", text: "Stopping at the agent's next step." };
		case "held":
			return { glyph: "idle", text: "You stopped this work order" };
		case "line":
			return AGENT_STATES.includes(wo.state)
				? { glyph: "run", text: `Finishing its step · ${span(wo.stageAt)}` }
				: { glyph: "idle", text: `Stopped with the line at ${clock(stoppedAt)}` };
		case "question":
			return { glyph: "ask", text: `Waiting for your answer · ${span(wo.updatedAt)}` };
		case "failed":
			return { glyph: "fail", text: `${gate} ${failedAgain(wo.retries)}` };
		case "run_failed":
			return { glyph: "fail", text: "T3 couldn't start this run." };
		case "in_t3":
			return { glyph: "ask", text: "Agent is waiting in T3" };
		case "ready":
			return { glyph: "pass", text: `PR #${wo.prNumber} ready for you` };
		default:
			break;
	}
	switch (wo.state) {
		case "waiting":
			return { glyph: "idle", text: "Waiting in Intake" };
		case "plan_approved":
			return { glyph: "idle", text: "Plan approved. Waiting for a Build slot." };
		case "build_done":
			return { glyph: "idle", text: "Build finished. Waiting for a Verify slot." };
		case "verifying":
			return { glyph: "run", text: `Gates running · ${span(wo.stageAt)}` };
		case "shipping":
			return { glyph: "run", text: "Merged. Shipping to production now." };
		case "observing":
			return { glyph: "pass", text: `Shipped ${ago(wo.mergedAt)} · watching for errors` };
		case "done":
			return { glyph: "pass", text: wo.mergedAt ? `Shipped ${ago(wo.mergedAt)}` : "Done" };
		default:
			return { glyph: "idle", text: "Closed" };
	}
}

const activityGlyph = (text: string): GlyphKind => {
	if (/\bfail/i.test(text)) return "fail";
	if (/asked a question|waiting in t3/i.test(text)) return "ask";
	if (/\bstopped\b/i.test(text)) return "idle";
	return "pass";
};

const NOW_WORDS: Partial<Record<WorkOrder["state"], string>> = {
	planning: "Writing the plan",
	building: "Working",
	retrying: "Fixing the failed gate",
	rebasing: "Rebasing",
};

/* ---------- pieces ---------- */

const ROW = "flex min-h-control items-center gap-3 px-2 py-1";
const ROW_TEXT = "min-w-0 flex-[1_1_0] [overflow-wrap:anywhere]";
const SUMMARY = `${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

function ActivityRow({ glyph, text, when }: { glyph: GlyphKind; text: string; when: string }) {
	return (
		<>
			<Glyph kind={glyph} />
			<span className={ROW_TEXT}>{text}</span>
			<Mono className="text-text-muted">{when}</Mono>
		</>
	);
}

function Activity({
	entries,
	now,
	next = [],
}: {
	entries: ActivityEntry[];
	now?: string | null;
	next?: string[];
}) {
	return (
		<section aria-label="Activity" className="flex flex-col gap-1">
			<SectionLabel>Activity</SectionLabel>
			{/* Announces new entries. The row for what's happening now changes too often, so it sits outside. */}
			<ul aria-live="polite" className="m-0 flex list-none flex-col gap-1 p-0">
				{entries.map((e, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: the list only grows at the end.
					<li key={i}>
						{e.detail ? (
							<details className="rounded-sm">
								<summary className={SUMMARY}>
									<ActivityRow glyph={activityGlyph(e.text)} text={e.text} when={clock(e.at)} />
								</summary>
								<div className="pb-2 ps-9 pe-2 pt-1">
									<CodeBlock>{e.detail}</CodeBlock>
								</div>
							</details>
						) : (
							<div className={ROW}>
								<ActivityRow glyph={activityGlyph(e.text)} text={e.text} when={clock(e.at)} />
							</div>
						)}
					</li>
				))}
			</ul>
			{(now || next.length > 0) && (
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{now && (
						<li className={ROW}>
							<ActivityRow glyph="run" text={now} when="now" />
						</li>
					)}
					{next.map((text) => (
						<li key={text} className={ROW}>
							<ActivityRow glyph="idle" text={text} when="next" />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function LiveOutput({ wo }: { wo: WorkOrder }) {
	return (
		<section aria-label="Live output" className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<SectionLabel>Live output</SectionLabel>
				{wo.threadLink && (
					<span className="ms-auto">
						<ButtonOut href={wo.threadLink}>Open in T3</ButtonOut>
					</span>
				)}
			</div>
			{wo.output.length > 0 ? (
				<CodeBlock>{wo.output.join("\n")}</CodeBlock>
			) : (
				<Muted>No output yet. The agent's latest lines show here as it works.</Muted>
			)}
		</section>
	);
}

function PlanSection({ plan }: { plan: Plan }) {
	const facts: Array<[ReactNode, ReactNode, boolean?]> = [];
	if (plan.files) facts.push(["Files", plan.files, true]);
	if (plan.risk) facts.push(["Risk", plan.risk]);
	if (plan.estimate) facts.push(["Estimate", plan.estimate, true]);
	if (plan.outOfScope) facts.push(["Out of scope", plan.outOfScope]);
	return (
		<section aria-label="Plan" className="flex max-w-[72ch] flex-col gap-3">
			<h2 className="m-0 text-detail-title">Plan</h2>
			<p className="m-0 text-text-muted [overflow-wrap:anywhere]">{plan.summary}</p>
			{plan.steps.length > 0 && (
				<ol className="m-0 flex list-decimal flex-col gap-1 ps-5">
					{plan.steps.map((step) => (
						<li key={step} className="[overflow-wrap:anywhere]">
							{step}
						</li>
					))}
				</ol>
			)}
			{facts.length > 0 && <Facts rows={facts} />}
		</section>
	);
}

const PaneBlock = ({ children }: { children: ReactNode }) => (
	<div className="flex flex-col gap-2 border-0 border-t border-solid border-border-subtle pt-4">
		{children}
	</div>
);

/** `Couldn't {verb} this. Try again.`, then the service's own reason. */
const Failed = ({ verb, error }: { verb: string; error: string | null }) => (
	<InlineError>
		{error && (
			<>
				Couldn't {verb} this. Try again. <Muted>{error}</Muted>
			</>
		)}
	</InlineError>
);

/* ---------- the page ---------- */

function WorkOrderPage({
	wo,
	stoppedAt,
	lineStopped,
}: {
	wo: WorkOrder;
	stoppedAt: string | null;
	lineStopped: boolean;
}) {
	const navigate = useNavigate();
	const statusRef = useRef<HTMLDivElement>(null);
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const id = wo.id;

	const [changing, setChanging] = useState(false);
	const [changeText, setChangeText] = useState("");
	const [changeProblem, setChangeProblem] = useState<string | null>(null);
	const [retryNote, setRetryNote] = useState("");
	const [pick, setPick] = useState<string | null>(null);
	const [answerNote, setAnswerNote] = useState("");
	const [answered, setAnswered] = useState(false);

	/** The control just used is about to go away, so focus goes to the line saying what happened. */
	const toStatus = () => statusRef.current?.focus();
	const toFloor = () => void navigate({ to: "/floor" });

	const approve = useAction(() => api.post(`/api/work-orders/${id}/approve`), { onSuccess: toStatus });
	const change = useAction((note: string) => api.post(`/api/work-orders/${id}/change`, { note }), {
		onSuccess: () => {
			setChanging(false);
			setChangeText("");
			toStatus();
		},
	});
	const reject = useAction(() => api.post(`/api/work-orders/${id}/reject`), {
		onSuccess: () => void navigate({ to: "/" }),
	});
	const answer = useAction(
		(a: { answer: string; note: string | null; stop: boolean }) =>
			api.post(`/api/work-orders/${id}/answer`, { answer: a.answer, note: a.note }),
		{
			onSuccess: (_r, a) => {
				if (!a.stop) setAnswered(true);
				toStatus();
			},
		},
	);
	const stop = useAction(() => api.post(`/api/work-orders/${id}/stop`), { onSuccess: toStatus });
	const resume = useAction(() => api.post(`/api/work-orders/${id}/resume`), { onSuccess: toStatus });
	const retry = useAction((note: string | null) => api.post(`/api/work-orders/${id}/retry`, { note }), {
		onSuccess: toFloor,
	});
	const close = useAction(() => api.post(`/api/work-orders/${id}/close`), { onSuccess: toFloor });
	const restart = useAction(() => api.post("/api/line", { stopped: false }), { onSuccess: toStatus });

	useEffect(() => {
		if (changing) noteRef.current?.focus();
	}, [changing]);

	const view = viewOf(wo, lineStopped);
	const status = statusOf(wo, view, stoppedAt);
	const working = AGENT_STATES.includes(wo.state);
	const options = wo.question?.options ?? [];
	const picked = pick ?? options[0]?.label ?? "";
	const gate = wo.failedGate ?? "Gates";

	const openInT3 = wo.threadLink ? (
		<ButtonOut href={wo.threadLink} grow>
			Open in T3
		</ButtonOut>
	) : null;
	const takeOver = wo.threadLink ? (
		<ButtonOut href={wo.threadLink} grow>
			Take over in T3
		</ButtonOut>
	) : null;
	const closeControl = (
		<InlineConfirm
			label="Close work order"
			title={
				<span className="flex flex-col gap-2">
					<strong className="font-semibold">Close WO-{id}?</strong>
					<span className="text-meta text-text-muted">
						{ownsNoPr(wo.source.kind)
							? `This deletes the worktree. PR #${wo.prNumber} stays open.`
							: wo.prNumber
								? `This closes PR #${wo.prNumber} and deletes the worktree and the branch.`
								: "This deletes the worktree and the branch."}
						{wo.source.kind === "error" && " The original error stays in the queue."}
					</span>
				</span>
			}
			keep="Keep it"
			confirm="Close work order"
			pending={close.pending}
			error={close.error && `Couldn't close this. Try again. ${close.error}`}
			onConfirm={() => void close.run()}
		/>
	);
	const stopControl = (
		<InlineConfirm
			label="Stop this work order"
			title={
				<span className="flex flex-col gap-2">
					<strong className="font-semibold">Stop this work order?</strong>
					<span className="text-meta text-text-muted">
						The agent stops at its next step. The worktree and branch stay, so you can restart or take over in
						T3.
					</span>
				</span>
			}
			keep="Keep running"
			confirm="Stop work order"
			pending={stop.pending}
			error={stop.error && `Couldn't stop this. Try again. ${stop.error}`}
			onConfirm={() => void stop.run()}
		/>
	);

	const actions = (() => {
		switch (view) {
			case "plan":
				return (
					<>
						<Button
							variant="primary"
							grow
							disabled={approve.pending}
							onClick={() => {
								approve.clearError();
								void approve.run();
							}}
						>
							Approve plan
						</Button>
						<Failed verb="approve" error={approve.error} />
						<div className="grid grid-cols-2 gap-2">
							<Button aria-expanded={changing} onClick={() => setChanging((open) => !open)}>
								Change plan
							</Button>
							<Button disabled={reject.pending} onClick={() => void reject.run()}>
								Reject plan
							</Button>
						</div>
						<Failed verb="reject" error={reject.error} />
						{openInT3}
					</>
				);
			case "running":
				return (
					<>
						{stopControl}
						{closeControl}
					</>
				);
			case "stopping":
				return closeControl;
			case "held":
				return (
					<>
						<Button variant="primary" grow disabled={resume.pending} onClick={() => void resume.run()}>
							Restart this work order
						</Button>
						<Failed verb="restart" error={resume.error} />
						{takeOver}
						{closeControl}
					</>
				);
			case "line":
				return (
					<>
						<Button variant="primary" grow disabled={restart.pending} onClick={() => void restart.run()}>
							Restart the line
						</Button>
						<InlineError>{restart.error && "Couldn't restart the line. Try again."}</InlineError>
						{takeOver}
					</>
				);
			case "question":
				return (
					<>
						<Button
							variant="primary"
							grow
							disabled={answer.pending || (!options.length && !answerNote.trim())}
							onClick={() =>
								void answer.run(
									// An open question has no options, so what you typed is the answer.
									options.length
										? {
												answer: picked,
												note: answerNote.trim() || null,
												stop: !!options.find((o) => o.label === picked)?.stop,
											}
										: { answer: answerNote.trim(), note: null, stop: false },
								)
							}
						>
							Answer
						</Button>
						<Failed verb="send" error={answer.error} />
						{openInT3}
						{closeControl}
					</>
				);
			case "failed":
				return (
					<>
						<Button
							variant="primary"
							grow
							disabled={retry.pending}
							onClick={() => void retry.run(retryNote.trim() || null)}
						>
							Retry with this note
						</Button>
						<Failed verb="retry" error={retry.error} />
						{takeOver}
						{closeControl}
					</>
				);
			case "run_failed":
				return (
					<>
						<Button variant="primary" grow disabled={retry.pending} onClick={() => void retry.run(null)}>
							Try again
						</Button>
						<Failed verb="retry" error={retry.error} />
						{openInT3}
						{closeControl}
					</>
				);
			case "in_t3":
				return (
					<>
						{wo.threadLink && (
							<ButtonOut href={wo.threadLink} variant="primary" grow>
								Open in T3
							</ButtonOut>
						)}
						{closeControl}
					</>
				);
			case "ready":
				return (
					<>
						{wo.prNumber && (
							<ButtonLink
								variant="primary"
								grow
								to="/prs/$project/$number"
								params={{ project: wo.project, number: String(wo.prNumber) }}
							>
								Review PR
							</ButtonLink>
						)}
						{openInT3}
					</>
				);
			default:
				if (wo.state === "verifying") {
					return (
						<>
							{stopControl}
							{openInT3}
						</>
					);
				}
				if (BETWEEN.includes(wo.state)) {
					return (
						<>
							{openInT3}
							{closeControl}
						</>
					);
				}
				return openInT3;
		}
	})();

	const pane = (
		<Pane>
			<div
				ref={statusRef}
				tabIndex={-1}
				role={view === "run_failed" ? "alert" : "status"}
				className="flex items-center gap-2 font-medium"
			>
				<Glyph kind={status.glyph} />
				<span className="min-w-0">{status.text}</span>
			</div>
			{actions}
			<PaneBlock>
				<SectionLabel level={3}>Gates</SectionLabel>
				<GateList
					gates={wo.gates}
					notes={
						wo.state === "failed" && wo.failedGate
							? {
									[wo.failedGate]: `${failedAgain(wo.retries)[0]?.toUpperCase()}${failedAgain(wo.retries).slice(1)}`,
								}
							: undefined
					}
				/>
			</PaneBlock>
			<PaneBlock>
				<Facts
					rows={[
						["Agent", wo.agent],
						["Worktree", wo.worktree ? (wo.worktree.split("/").at(-1) ?? wo.worktree) : "–", true],
						["Time", span(wo.createdAt, wo.finishedAt ? Date.parse(wo.finishedAt) : undefined), true],
					]}
				/>
			</PaneBlock>
		</Pane>
	);

	const showPlan = wo.plan && (view === "plan" || wo.state === "planning" || wo.state === "plan_approved");
	const next = wo.state === "building" ? ["Run the gates", "Open a PR"] : [];
	const nowLine = working && view !== "line" ? (wo.output.at(-1) ?? NOW_WORDS[wo.state]) : null;
	const lineBody = working
		? "This agent finishes the step it's on, then stops. It picks up from here when the line restarts. Its worktree and branch are untouched."
		: wo.state === "waiting"
			? "This waits in Intake until you restart."
			: "This agent finished its step and stopped. It picks up from here when the line restarts. Its worktree and branch are untouched.";

	return (
		<Page pane={pane}>
			<Breadcrumb crumbs={[{ label: "Floor", link: { to: "/floor" } }, { label: `WO-${id}` }]} />
			<div>
				<span className="text-meta text-text-muted">
					<Lnk to="/projects/$slug" params={{ slug: wo.project }} muted>
						{wo.projectName}
					</Lnk>{" "}
					· WO-{id} · {wo.type}
				</span>
				<h1 className="m-0 mt-1 text-page-title [overflow-wrap:anywhere]">{wo.title}</h1>
			</div>
			<StageTrack current={wo.stage} glyph={status.glyph} />

			{view === "line" && <Banner glyph="idle" title="The line is stopped" body={lineBody} />}
			{view === "held" && (
				<Banner
					glyph="idle"
					title="You stopped this work order"
					body="This agent finished its step and stopped. It picks up from here when you restart it. Its worktree and branch are untouched."
				/>
			)}
			{view === "in_t3" && (
				<Banner
					glyph="ask"
					title="The agent needs you in T3"
					body="It stopped on a question or permission request that only T3 can show. Answer it there, and this page picks up again."
				/>
			)}
			{view === "failed" && (
				<Banner
					glyph="fail"
					title={
						wo.retries > 0
							? `The agent tried ${wo.retries === 1 ? "once more" : "again"} and the same ${wo.failedGate === "Tests" ? "test" : "gate"} failed`
							: `${gate} failed`
					}
					body={
						wo.retries > 0
							? `It stops after ${wo.retries === 1 ? "one retry" : plural(wo.retries, "retry", "retries")} so it can't keep going. Your call on what happens next.`
							: "Your call on what happens next."
					}
				/>
			)}
			{wo.waitingFor && <Muted>{wo.waitingFor}</Muted>}

			<StatusLine className="flex flex-wrap items-center gap-2 empty:absolute">
				{answered && view !== "question" && (
					<>
						<Glyph kind="run" />
						Answer sent. The agent is continuing. <Lnk to="/">Back to the queue</Lnk>
					</>
				)}
			</StatusLine>

			{view === "question" && wo.question && (
				<section aria-label="Agent question" className="flex max-w-[72ch] flex-col gap-3">
					<h2 className="m-0 text-detail-title [overflow-wrap:anywhere]">{wo.question.question}</h2>
					{wo.question.detail && (
						<p className="m-0 text-text-muted [overflow-wrap:anywhere]">{wo.question.detail}</p>
					)}
					{options.length > 0 && (
						<fieldset className="m-0 flex flex-col border-0 p-0">
							<legend className="section-label mb-1 p-0">Your answer</legend>
							{options.map((o) => (
								<Choice
									key={o.label}
									type="radio"
									name="answer"
									title={o.label}
									description={o.detail}
									checked={picked === o.label}
									onChange={() => setPick(o.label)}
								/>
							))}
						</fieldset>
					)}
					<Field label={options.length ? "Add a note (optional)" : "Your answer"}>
						{(p) => (
							<textarea {...p} rows={2} value={answerNote} onChange={(e) => setAnswerNote(e.target.value)} />
						)}
					</Field>
				</section>
			)}

			{view === "failed" && (
				<>
					<section aria-label="Failure" className="flex flex-col gap-2">
						<SectionLabel>{gate}</SectionLabel>
						<CodeBlock>{wo.failure ?? "No failure text came back."}</CodeBlock>
					</section>
					<section aria-label="Retry" className="flex max-w-[72ch] flex-col gap-2">
						<Field
							label="Tell the agent what to try"
							hint="Your note goes into the next attempt. This counts as a new retry."
						>
							{(p) => (
								<textarea
									{...p}
									rows={3}
									placeholder="The tie break should use finishedAt, not createdAt."
									value={retryNote}
									onChange={(e) => setRetryNote(e.target.value)}
								/>
							)}
						</Field>
					</section>
				</>
			)}

			{view === "run_failed" && wo.failure && (
				<section aria-label="Failure" className="flex flex-col gap-2">
					<SectionLabel>What T3 said</SectionLabel>
					<CodeBlock>{wo.failure}</CodeBlock>
				</section>
			)}

			{showPlan && wo.plan && <PlanSection plan={wo.plan} />}
			{view === "plan" && changing && (
				<form
					className="flex max-w-[72ch] flex-col gap-2"
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						const note = changeText.trim();
						if (!note) {
							setChangeProblem("Say what should change so the agent can rewrite the plan.");
							noteRef.current?.focus();
							return;
						}
						setChangeProblem(null);
						void change.run(note);
					}}
				>
					<Field
						label="What should change?"
						hint="The agent rewrites the plan and asks you again."
						error={changeProblem}
					>
						{(p) => (
							<textarea
								{...p}
								ref={noteRef}
								rows={3}
								placeholder="Don't refetch. Clear the old cache entries instead."
								value={changeText}
								onChange={(e) => setChangeText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setChanging(false);
								}}
							/>
						)}
					</Field>
					<div>
						<Button type="submit" disabled={change.pending}>
							Send to agent
						</Button>
					</div>
					<Failed verb="send" error={change.error} />
				</form>
			)}
			<StatusLine className="flex items-center gap-2 empty:absolute">
				{wo.state === "planning" && view !== "line" && (
					<>
						<Glyph kind="run" />
						{wo.plan
							? "Agent is rewriting the plan. You'll see it here and in the queue."
							: "Agent is writing the plan. You'll see it here and in the queue."}
					</>
				)}
			</StatusLine>

			{view !== "plan" && (
				<Activity entries={wo.activity} now={nowLine} next={view === "running" ? next : []} />
			)}
			{working && <LiveOutput wo={wo} />}
		</Page>
	);
}

function LoadingPage() {
	return (
		<Page
			pane={
				<Pane>
					<Skeleton width="60%" height={16} />
					<Skeleton width="100%" height={44} />
				</Pane>
			}
		>
			<div role="status" className="sr-only">
				Loading the work order
			</div>
			<Skeleton width="20%" />
			<Skeleton width="50%" height={20} />
			<Skeleton width="100%" height={36} />
			<Skeleton width="80%" />
			<Skeleton width="70%" />
		</Page>
	);
}

export function WorkOrderScreen() {
	useTick();
	const { id } = useParams({ from: "/shell/work-orders/$id" });
	const wo = useWorkOrder(Number(id));
	const shell = useShell();
	if (wo.data) {
		return (
			<WorkOrderPage
				key={wo.data.id}
				wo={wo.data}
				lineStopped={shell.data?.line.stopped ?? false}
				stoppedAt={shell.data?.line.stoppedAt ?? null}
			/>
		);
	}
	if (wo.isError) {
		return (
			<Page>
				<Breadcrumb crumbs={[{ label: "Floor", link: { to: "/floor" } }, { label: `WO-${id}` }]} />
				<LoadFailed what="this work order" error={wo.error} />
			</Page>
		);
	}
	return <LoadingPage />;
}
