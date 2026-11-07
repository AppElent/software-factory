import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ErrorDetail, Limits, Mode } from "../../shared/types.ts";
import { confirmOnProductionError, FixButton, fixLabel } from "../fix.tsx";
import { ago, clock, plural } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonLink,
	ButtonOut,
	CodeBlock,
	Facts,
	Glyph,
	Histogram,
	InlineError,
	Lnk,
	LoadFailed,
	Page,
	Pane,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useError, useProjects, useQueue } from "../queries.ts";
import { fixBody, kindWord, startFix, triage } from "./errors.tsx";
import { prSize } from "./prs.tsx";

const dateWords = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

/** "tomorrow at 09:00", or the date when it's further off. */
function untilWords(iso: string | null) {
	if (!iso) return "later";
	const at = new Date(iso);
	const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
	const day = days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${dateWords(iso)}`;
	return `${day} at ${clock(iso)}`;
}

/** Bars well above the usual count. They're the spike the label names. */
function spikeFrom(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
	return Math.max(2 * median, 1);
}

function historyLabel(values: number[], threshold: number) {
	const first = values.findIndex((v) => v > threshold);
	const total = values.reduce((a, b) => a + b, 0);
	if (first < 0) return `Events over the last 24 hours, ${plural(total, "event")} in all, with no spike`;
	const hours = Math.max(1, Math.round(((values.length - first) * 24) / values.length));
	return `Events over the last 24 hours, rising sharply in the last ${plural(hours, "hour")}`;
}

const blockWords = (block: Limits["startBlock"], agents: number) =>
	block === "stopped"
		? "The line is stopped. This waits in Intake until you restart."
		: block === "review"
			? "Review is full. This waits in Intake until you review a PR."
			: `All ${agents} agent slots are busy. This waits in Intake and starts when a slot opens.`;

function ErrorPage({ e }: { e: ErrorDetail }) {
	const navigate = useNavigate();
	const queue = useQueue();
	const projects = useProjects();
	const limits = queue.data?.limits;
	const [verb, setVerb] = useState("change");

	const start = useAction(
		({ mode, confirmed }: { mode: Mode | null; confirmed: boolean }) => startFix(e, mode, confirmed),
		{
			onSuccess: (r) => void navigate({ to: "/work-orders/$id", params: { id: String(r.id) } }),
		},
	);
	const act = useAction((action: "snooze" | "dismiss" | "undo") => triage([e.id], action), {
		onSuccess: (_, action) => {
			if (action === "dismiss") void navigate({ to: "/errors", search: { dismissed: e.id } });
		},
	});
	const run = (action: "snooze" | "dismiss" | "undo") => {
		setVerb(action);
		void act.run(action);
	};

	const snoozed = e.triage?.action === "snooze";
	const dismissed = e.triage?.action === "dismiss";
	const regression = e.kind === "regression" ? e.regressionOf : null;
	const threshold = spikeFrom(e.histogram);
	const repoUrl = projects.data?.find((p) => p.slug === e.project)?.url;

	const head = snoozed
		? `Snoozed until ${untilWords(e.triage?.until ?? null)}`
		: dismissed
			? "Dismissed"
			: regression
				? `Regression · came back ${ago(e.lastSeen)}`
				: `${kindWord(e)} · first seen ${ago(e.firstSeen)}`;

	const blocked = limits?.startBlock;
	const hint = blocked
		? blockWords(blocked, limits?.agents ?? 0)
		: snoozed
			? "You can start a fix while it is snoozed."
			: regression
				? "The new work order gets the old fix and its PR as context, so the agent starts from what already failed."
				: "Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. It won't merge.";

	const pane = (
		<Pane>
			<Facts
				rows={[
					[
						"Project",
						<Lnk key="p" to="/projects/$slug" params={{ slug: e.project }}>
							{e.projectName}
						</Lnk>,
					],
					["Environment", e.environment ?? "–"],
					["First release", e.firstRelease ?? "–", true],
					["Likely source", e.likelySource ?? "–", true],
					["Sentry issue", e.shortId, true],
				]}
			/>
			<div className="flex flex-col gap-2 border-0 border-t border-solid border-border-subtle pt-4">
				<h2 className="m-0 text-body-strong">Bug fix</h2>
				{e.workOrderId ? (
					<>
						<p className="m-0 text-meta text-text-muted">A work order is already on this.</p>
						<ButtonLink variant="primary" grow to="/work-orders/$id" params={{ id: String(e.workOrderId) }}>
							Open work order
						</ButtonLink>
					</>
				) : (
					<>
						<p className="m-0 text-meta text-text-muted">{hint}</p>
						<FixButton
							grow
							label={(mode) => fixLabel(1, mode, !!blocked)}
							pending={start.pending}
							run={(mode, confirmed) => void start.run({ mode, confirmed })}
							confirm={confirmOnProductionError(1)}
							commands={() => [fixBody(e)]}
						/>
						<InlineError>{start.error && "Couldn't start this. Try again."}</InlineError>
					</>
				)}
				{snoozed || dismissed ? (
					<Button grow disabled={act.pending} onClick={() => run("undo")}>
						{snoozed ? "Unsnooze" : "Undo"}
					</Button>
				) : (
					<div className="grid grid-cols-2 gap-2">
						<Button disabled={act.pending} onClick={() => run("snooze")}>
							Snooze
						</Button>
						<Button disabled={act.pending} onClick={() => run("dismiss")}>
							Dismiss
						</Button>
					</div>
				)}
				<InlineError>{act.error && `Couldn't ${verb} this. Try again.`}</InlineError>
				<ButtonOut grow href={e.permalink}>
					Open in Sentry
				</ButtonOut>
			</div>
		</Pane>
	);

	return (
		<Page pane={pane}>
			<div className="flex flex-col gap-5">
				<Breadcrumb
					crumbs={[
						{ label: "Errors", link: { to: "/errors" } },
						{ label: e.projectName, link: { to: "/errors", search: { project: e.project } } as never },
						{ label: <span className="[overflow-wrap:anywhere]">{e.title}</span> },
					]}
				/>
				<div>
					<div className="flex items-center gap-2 text-meta text-text-muted">
						<Glyph kind={snoozed || dismissed ? "idle" : "err"} />
						<span>{head}</span>
					</div>
					<h1 className="m-0 mt-1 text-page-title [overflow-wrap:anywhere]">{e.title}</h1>
				</div>
				{regression && (
					<Banner
						glyph="err"
						title="This came back after a fix"
						body={
							<>
								<Lnk muted to="/work-orders/$id" params={{ id: String(regression.workOrderId) }}>
									WO-{regression.workOrderId}
								</Lnk>{" "}
								fixed it{regression.fixedAt ? ` on ${dateWords(regression.fixedAt)}` : ""}
								{regression.prNumber ? ` in PR #${regression.prNumber}` : ""}.
								{e.firstRelease ? ` It returned in release ${e.firstRelease}.` : ""}
							</>
						}
						actions={
							regression.prNumber && repoUrl ? (
								<ButtonOut href={`${repoUrl}/pull/${regression.prNumber}`}>
									Open PR #{regression.prNumber}
								</ButtonOut>
							) : undefined
						}
					/>
				)}
				{snoozed && (
					<Banner
						glyph="idle"
						title={`Snoozed until ${untilWords(e.triage?.until ?? null)}`}
						body="It returns to the queue sooner if it reaches 100 events or reaches users in a new release."
					/>
				)}
				{dismissed && <Banner glyph="idle" title="Dismissed" body="It comes back only if it gets worse." />}
				{e.histogram.length > 0 && (
					<section aria-label="Event history" className="flex flex-col gap-2">
						<SectionLabel>Last 24 hours</SectionLabel>
						<Histogram
							values={e.histogram}
							label={historyLabel(e.histogram, threshold)}
							spike={(v) => v > threshold}
							height={72}
							unit=" events"
						/>
						<div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-data tabular-nums">
							<span>{plural(e.events, "event")}</span>
							<span>{plural(e.users, "user")}</span>
							<span>first seen {ago(e.firstSeen)}</span>
						</div>
					</section>
				)}
				{e.stack.length > 0 && (
					<section aria-label="Stack trace" className="flex flex-col gap-2">
						<SectionLabel>Stack trace</SectionLabel>
						<CodeBlock>
							{e.stack
								.map((f) => `${f.file}${f.line ? `:${f.line}` : ""}${f.context ? `    ${f.context}` : ""}`)
								.join("\n")}
						</CodeBlock>
					</section>
				)}
				{e.releasePrs.length > 0 && (
					<section aria-label="Likely cause" className="flex flex-col gap-2">
						<SectionLabel>In release {e.firstRelease}</SectionLabel>
						<div className="flex flex-col">
							{e.releasePrs.map((p) => (
								<LnkRow key={p.number} {...p} />
							))}
						</div>
					</section>
				)}
			</div>
		</Page>
	);
}

function LnkRow(p: ErrorDetail["releasePrs"][number]) {
	return (
		<a
			href={p.url}
			target="_blank"
			rel="noreferrer"
			className="hover-row flex min-h-control flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-1"
		>
			<span className="font-mono text-data text-text-muted">#{p.number}</span>
			<span className="min-w-0 flex-[1_1_140px] [overflow-wrap:anywhere]">{p.title}</span>
			<span className="font-mono text-data tabular-nums text-text-muted">
				{prSize(p.additions, p.deletions)}
			</span>
		</a>
	);
}

export function ErrorDetailScreen() {
	const { id } = useParams({ from: "/shell/errors/$id" });
	const q = useError(id);
	if (q.data) return <ErrorPage key={id} e={q.data} />;
	const crumbs = [{ label: "Errors", link: { to: "/errors" } }, { label: id }];
	if (q.isError) {
		return (
			<Page>
				<Breadcrumb crumbs={crumbs} />
				<LoadFailed what="this error" error={q.error} />
			</Page>
		);
	}
	return (
		<Page>
			<Breadcrumb crumbs={crumbs} />
			<StatusLine className="text-text-muted">Loading this error</StatusLine>
			<Skeleton width="50%" height={20} />
			<Skeleton width="100%" height={72} />
			<Skeleton width="70%" />
		</Page>
	);
}
