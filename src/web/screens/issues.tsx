import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { INVISIBLE, issueWorkType, suspectRanges } from "../../shared/rules.ts";
import type { Issue, IssueGroup, Mode } from "../../shared/types.ts";
import { api } from "../api.ts";
import { commandsFor, FixButton, fixLabel, useCopyCommand, type WorkOrderBody } from "../fix.tsx";
import { plural, span } from "../format.ts";
import {
	BulkBar,
	Button,
	Glyph,
	InlineError,
	Lnk,
	LoadFailed,
	Page,
	PageHeader,
	SectionLabel,
	StatusLine,
} from "../kit.tsx";
import { useAction, useIssues, useModes, useProjects, useQueue, useShell } from "../queries.ts";
import { agoWords } from "./errors.tsx";
import { ListSkeleton, NothingIn, openSummary, ProjectFilter } from "./prs.tsx";

const keyOf = (i: Pick<Issue, "project" | "number">) => `${i.project}:${i.number}`;

/** The service builds the agent's text from this fingerprint, so what starts is what you were shown. */
export const issueBody = (i: Pick<Issue, "project" | "number" | "labels">): WorkOrderBody => ({
	project: i.project,
	type: issueWorkType(i.labels),
	description: `Fix issue #${i.number}`,
	source: { kind: "issue", fingerprint: `issue:${i.project}:${i.number}` },
});

export const startIssue = (i: Issue, mode: Mode | null) =>
	api.post<{ id: number; waiting: boolean }>("/api/work-orders", { ...issueBody(i), mode: mode?.id });

const ref = ({ project, number }: Issue) => ({ project, number });

const WHO: Record<string, string> = {
	OWNER: "you",
	MEMBER: "member",
	COLLABORATOR: "collaborator",
	CONTRIBUTOR: "outside contributor",
	FIRST_TIME_CONTRIBUTOR: "first-time contributor",
	FIRST_TIMER: "first-timer",
};

const NEW_ACCOUNT_DAYS = 30;

const whoWord = (i: Issue) =>
	(i.signals.accountAgeDays ?? Number.POSITIVE_INFINITY) < NEW_ACCOUNT_DAYS && !i.signals.trusted
		? "new account"
		: (WHO[i.authorAssociation] ?? "outside contributor");

function accountAge(days: number) {
	if (days < 14) return plural(days, "day");
	if (days < 60) return plural(Math.round(days / 7), "week");
	if (days < 730) return plural(Math.round(days / 30), "month");
	return plural(Math.round(days / 365), "year");
}

const authorLine = (i: Issue) => {
	if (i.signals.trusted)
		return i.authorAssociation === "OWNER" ? "You opened this." : `${WHO[i.authorAssociation]} on this repo.`;
	const who = i.authorAssociation === "NONE" ? "Someone outside this repo." : "Outside contributor.";
	return i.signals.accountAgeDays === null
		? who
		: `${who} Account is ${accountAge(i.signals.accountAgeDays)} old.`;
};

const linksLine = ({ links, outsideLinks }: Issue["signals"]) => {
	if (links === 0) return "No links";
	if (outsideLinks === 0) return `${plural(links, "link")}, all on GitHub`;
	return `${plural(outsideLinks, "link")} to a site outside GitHub`;
};

const GROUPS: Array<[IssueGroup, string]> = [
	["needs_read", "Needs a read"],
	["looks_legit", "Looks legit"],
	["looks_off", "Looks off"],
];

const GROUP_GLYPH = { needs_read: "ask", looks_legit: null, looks_off: "fail" } as const;

function Row({
	issue,
	selected,
	checked,
	onOpen,
	onToggle,
}: {
	issue: Issue;
	selected: boolean;
	checked: boolean;
	onOpen: () => void;
	onToggle: () => void;
}) {
	const glyph = GROUP_GLYPH[issue.group];
	return (
		<div className={`flex items-start ${selected ? "bg-bg-raised" : ""}`}>
			<label className="flex min-h-row w-9 flex-none cursor-pointer items-center justify-center">
				<input
					type="checkbox"
					aria-label={`Select issue ${issue.number}`}
					checked={checked}
					onChange={onToggle}
				/>
			</label>
			<button
				type="button"
				aria-current={selected ? "true" : undefined}
				onClick={onOpen}
				className="hover-row flex min-h-row min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-sm border-0 bg-transparent py-1.5 pe-3 text-start"
			>
				<span className="flex items-baseline gap-2 font-medium">
					{glyph && <Glyph kind={glyph} />}
					<span className="min-w-0 [overflow-wrap:anywhere]">{issue.title}</span>
				</span>
				<span className="text-meta text-text-muted">
					<span className="font-mono text-data">#{issue.number}</span> {issue.projectName} · {whoWord(issue)}{" "}
					· {span(issue.updatedAt)}
				</span>
			</button>
		</div>
	);
}

/** Plain text, on purpose: nothing here renders as HTML, so hidden text stays visible. */
function IssueText({ text }: { text: string }) {
	const parts: Array<{ text: string; why?: string }> = [];
	let at = 0;
	for (const r of suspectRanges(text)) {
		if (r.start > at) parts.push({ text: text.slice(at, r.start) });
		parts.push({ text: text.slice(r.start, r.end), why: r.why });
		at = r.end;
	}
	if (at < text.length) parts.push({ text: text.slice(at) });
	if (!text.trim()) return <p className="m-0 text-text-muted">No description.</p>;
	return (
		<p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
			{parts.map((p, n) =>
				p.why ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the parts don't reorder.
					<mark key={n} className="bg-transparent text-inherit underline decoration-status-fail decoration-2">
						{/* Characters you can't see get a name you can. */}
						{p.text.replace(
							INVISIBLE,
							(c) => `[hidden U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}]`,
						)}
					</mark>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: the parts don't reorder.
					<span key={n}>{p.text}</span>
				),
			)}
		</p>
	);
}

function Signal({
	glyph,
	name,
	children,
}: {
	glyph: "ask" | "fail" | "pass" | "run" | "idle";
	name: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid grid-cols-[16px_96px_minmax(0,1fr)] gap-2 py-1">
			<Glyph kind={glyph} />
			<span className="text-text-muted">{name}</span>
			<span>{children}</span>
		</div>
	);
}

function Detail({
	issue,
	atLimit,
	onHide,
	hideError,
}: {
	issue: Issue;
	atLimit: boolean;
	onHide: (i: Issue, action: "not_legit") => void;
	hideError: string | null;
}) {
	const navigate = useNavigate();
	const modes = useModes();
	const { copy, view } = useCopyCommand();
	const merging = modes.data?.modes.find((m) => m.merge === "factory");
	const start = useAction((mode: Mode | null) => startIssue(issue, mode), {
		onSuccess: ({ id }) => void navigate({ to: "/work-orders/$id", params: { id: String(id) } }),
	});
	const read = useAction(() => api.post("/api/issues/read", { ...ref(issue), hash: issue.bodyHash }));
	const ask = useAction(() => api.post("/api/issues/ask", ref(issue)));
	const { signals: s, advice } = issue;
	const adviceGlyph = advice?.verdict === "legit" ? "pass" : advice?.verdict === "off" ? "fail" : "idle";

	return (
		<section aria-label={`Issue ${issue.number}`} className="flex min-w-0 flex-col gap-4">
			<div>
				<h2 className="m-0 text-detail-title [overflow-wrap:anywhere]">{issue.title}</h2>
				<p className="m-0 mt-1 text-text-muted">
					<span className="font-mono text-data">#{issue.number}</span> · {issue.projectName} · opened{" "}
					{agoWords(issue.createdAt)}
					{issue.author ? ` by ${issue.author}` : ""} ·{" "}
					<a className="lnk" href={issue.url} target="_blank" rel="noreferrer noopener">
						Open on GitHub
					</a>
				</p>
			</div>
			<div className="max-w-[72ch]">
				<SectionLabel>Triage</SectionLabel>
				<Signal glyph={s.trusted ? "pass" : "ask"} name="Author">
					{authorLine(issue)}
				</Signal>
				<Signal glyph={s.outsideLinks > 0 ? "ask" : "pass"} name="Links">
					{linksLine(s)}
				</Signal>
				<Signal glyph={s.instructions + s.aimedAtAgents > 0 ? "fail" : "pass"} name="Instructions">
					{s.aimedAtAgents > 0
						? "Written to steer an agent"
						: s.instructions > 0
							? "Tells the reader to run something"
							: "None found"}
				</Signal>
				{s.hidden > 0 && (
					<Signal glyph="fail" name="Hidden text">
						{`${plural(s.hidden, "passage")} you wouldn't see on GitHub`}
					</Signal>
				)}
				<Signal glyph={issue.asking ? "run" : advice ? adviceGlyph : "idle"} name="Agent's read">
					{issue.asking ? (
						"An agent is reading this."
					) : advice && !advice.failed ? (
						`${advice.why} This is advice only.`
					) : (
						<span className="inline-flex flex-wrap items-center gap-2">
							{advice && <span>{advice.why}</span>}
							<Button disabled={ask.pending} onClick={() => void ask.run()}>
								{advice ? "Ask again" : "Ask an agent to read this"}
							</Button>
							<span className="text-meta text-text-muted">
								Advice only. It reads in an empty folder, away from your projects.
							</span>
						</span>
					)}
				</Signal>
				<InlineError>{ask.error}</InlineError>
			</div>
			<div className="max-w-[72ch] rounded-sm bg-bg-surface px-4 py-3">
				<IssueText text={issue.body} />
			</div>
			{(issue.locked || issue.readAt) && (
				<p className="m-0 max-w-[72ch] text-text-muted">
					{issue.editedSinceRead
						? "This changed on GitHub after you read it. Read this version before a mode that merges comes back."
						: issue.readAt
							? "You read this version. If it's edited on GitHub, you read it again."
							: `The agent gets this version as data, not instructions. If the issue is edited on GitHub, you read it again before ${merging?.name ?? "a mode that merges"} comes back.`}
				</p>
			)}
			{issue.workOrderId ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="m-0">
						<Glyph kind="run" /> Being fixed in{" "}
						<Lnk to="/work-orders/$id" params={{ id: String(issue.workOrderId) }}>
							WO-{issue.workOrderId}
						</Lnk>
					</p>
					{issue.locked && (
						<Button disabled={read.pending} onClick={() => void read.run()}>
							{merging ? `I've read this, unlock ${merging.name}` : "I've read this"}
						</Button>
					)}
				</div>
			) : (
				<div className="flex flex-wrap items-start gap-2">
					<FixButton
						label={(mode) => fixLabel(1, mode, atLimit)}
						pending={start.pending}
						run={(mode) => void start.run(mode)}
						locked={(mode) => (mode.merge === "factory" && issue.locked ? "Read this issue first." : null)}
						commands={() => [issueBody(issue)]}
					/>
					{issue.locked && (
						<Button disabled={read.pending} onClick={() => void read.run()}>
							{merging ? `I've read this, unlock ${merging.name}` : "I've read this"}
						</Button>
					)}
					<Button onClick={() => onHide(issue, "not_legit")}>Not legit</Button>
					<Button onClick={() => void copy(() => commandsFor([issueBody(issue)], null))}>
						Copy as command
					</Button>
				</div>
			)}
			{view}
			<InlineError>{start.error ?? read.error ?? hideError}</InlineError>
		</section>
	);
}

export function IssuesScreen() {
	const { project, select } = useSearch({ from: "/shell/issues" });
	const navigate = useNavigate();
	const q = useIssues(project);
	const shell = useShell();
	const queue = useQueue();
	const projects = useProjects();
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [note, setNote] = useState<{ text: string; items: Issue[] } | null>(null);
	const undoRef = useRef<HTMLButtonElement>(null);
	const atLimit = !!queue.data?.limits.startBlock;

	const hide = useAction(
		({ items, action }: { items: Issue[]; action: "snooze" | "dismiss" | "not_legit" }) =>
			api.post("/api/issues/triage", { items: items.map(ref), action }),
		{
			onSuccess: (_, { items, action }) => {
				setChecked(new Set());
				const word = action === "snooze" ? "Snoozed" : action === "dismiss" ? "Dismissed" : "Set aside";
				setNote({ text: `${word} ${plural(items.length, "issue")}.`, items });
			},
		},
	);
	const undo = useAction(
		(items: Issue[]) => api.post("/api/issues/triage", { items: items.map(ref), action: "undo" }),
		{ onSuccess: () => setNote(null) },
	);
	const startMany = useAction(
		async ({ list, mode }: { list: Issue[]; mode: Mode | null }) => {
			// One at a time. Those already started leave the selection, so Try again doesn't repeat them.
			for (const i of list) {
				await startIssue(i, mode);
				setChecked((prev) => {
					const next = new Set(prev);
					next.delete(keyOf(i));
					return next;
				});
			}
		},
		{ onSuccess: () => void navigate({ to: "/floor" }) },
	);

	useEffect(() => {
		if (note) undoRef.current?.focus();
	}, [note]);

	if (q.isError && !q.data) {
		return (
			<Page>
				<PageHeader title="Issues" />
				<LoadFailed what="issues" error={q.error} />
			</Page>
		);
	}
	if (q.isPending || !q.data || (q.data.issues.length === 0 && shell.data?.checking)) {
		return (
			<Page>
				<PageHeader title="Issues" />
				<ListSkeleton noun="issues" />
			</Page>
		);
	}

	const issues = q.data.issues;
	const setProject = (slug: string | undefined) =>
		void navigate({ to: "/issues", search: { project: slug } });
	const open = (i: Issue) =>
		void navigate({ to: "/issues", search: { project, select: keyOf(i) }, replace: true });
	const toggle = (i: Issue) =>
		setChecked((prev) => {
			const next = new Set(prev);
			if (!next.delete(keyOf(i))) next.add(keyOf(i));
			return next;
		});
	const ordered = GROUPS.flatMap(([g]) => issues.filter((i) => i.group === g));
	const current = ordered.find((i) => keyOf(i) === select) ?? ordered[0] ?? null;
	const chosen = issues.filter((i) => checked.has(keyOf(i)));
	const startable = chosen.filter((i) => !i.workOrderId);
	const lockedCount = startable.filter((i) => i.locked).length;
	const inProjects = new Set(issues.map((i) => i.project)).size;
	const projectName = projects.data?.find((p) => p.slug === project)?.name ?? project ?? "";

	const noteLine = (
		<div className="flex flex-col gap-2">
			<StatusLine>
				{note && (
					<span className="inline-flex flex-wrap items-center gap-3">
						{note.text}
						<Button ref={undoRef} disabled={undo.pending} onClick={() => void undo.run(note.items)}>
							Undo
						</Button>
					</span>
				)}
			</StatusLine>
			<InlineError>{undo.error && "Couldn't undo this. Try again."}</InlineError>
		</div>
	);

	if (issues.length === 0 && !project) {
		return (
			<Page>
				<PageHeader title="Issues" summary="0 open" />
				<div className="flex max-w-[560px] flex-col items-start gap-2 pt-8">
					<h2 className="m-0 text-detail-title">No open issues</h2>
					<p className="m-0 text-text-muted">
						GitHub shows nothing open in {plural(q.data.projects, "project")}.
						{q.data.checkedAt ? ` Checked ${agoWords(q.data.checkedAt)}.` : ""}
					</p>
				</div>
				{noteLine}
			</Page>
		);
	}

	return (
		<Page>
			<PageHeader
				title="Issues"
				summary={openSummary(issues.length, inProjects)}
				actions={<ProjectFilter value={project} onChange={setProject} />}
			/>
			{issues.length === 0 && <NothingIn name={projectName} onShowAll={() => setProject(undefined)} />}
			{noteLine}
			<div className="flex flex-wrap items-start gap-6">
				<section
					aria-label="Issue list"
					className="flex min-w-[280px] flex-[1_1_320px] flex-col gap-4 lg:max-w-[400px]"
				>
					{GROUPS.map(([g, label]) => {
						const rows = issues.filter((i) => i.group === g);
						if (rows.length === 0) return null;
						return (
							<div key={g} className="flex flex-col gap-1">
								<SectionLabel>
									{label} · {rows.length}
								</SectionLabel>
								{rows.map((i) => (
									<Row
										key={keyOf(i)}
										issue={i}
										selected={current ? keyOf(current) === keyOf(i) : false}
										checked={checked.has(keyOf(i))}
										onOpen={() => open(i)}
										onToggle={() => toggle(i)}
									/>
								))}
							</div>
						);
					})}
				</section>
				<div className="min-w-0 flex-[999_1_420px]">
					{current && (
						<Detail
							key={keyOf(current)}
							issue={current}
							atLimit={atLimit}
							onHide={(i, action) => void hide.run({ items: [i], action })}
							hideError={hide.error && chosen.length === 0 ? "Couldn't change this. Try again." : null}
						/>
					)}
				</div>
			</div>
			{chosen.length > 0 && (
				<div className="sticky bottom-4 z-10 mt-auto">
					<BulkBar count={chosen.length} onClear={() => setChecked(new Set())}>
						<InlineError>
							{(hide.error && "Couldn't change these. Try again.") ||
								(startMany.error && `Couldn't start them all: ${startMany.error}`)}
						</InlineError>
						<Button
							disabled={hide.pending}
							onClick={() => void hide.run({ items: chosen, action: "snooze" })}
						>
							Snooze
						</Button>
						<Button
							disabled={hide.pending}
							onClick={() => void hide.run({ items: chosen, action: "dismiss" })}
						>
							Dismiss
						</Button>
						{startable.length > 0 && (
							<FixButton
								label={(mode) => fixLabel(startable.length, mode, atLimit)}
								pending={startMany.pending}
								run={(mode) => void startMany.run({ list: startable, mode })}
								locked={(mode) =>
									mode.merge === "factory" && lockedCount > 0
										? `Read ${plural(lockedCount, "issue")} first.`
										: null
								}
								commands={() => startable.map(issueBody)}
							/>
						)}
					</BulkBar>
				</div>
			)}
		</Page>
	);
}
