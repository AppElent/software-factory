import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BackSummary,
	Mode,
	QueueItem,
	QueueResponse,
	SourceHealth,
	SourceName,
	SyncResult,
} from "../../shared/types.ts";
import { STAGES } from "../../shared/types.ts";
import { api } from "../api.ts";
import { clock, list, plural, span } from "../format.ts";
import { useKeys } from "../keyboard.ts";
import {
	Banner,
	Button,
	ButtonLink,
	Glyph,
	type GlyphKind,
	InlineError,
	LoadFailed,
	Page,
	PageHeader,
	Pane,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useQueue, useShell } from "../queries.ts";
import { useOpenNewWorkOrder } from "../shell.tsx";
import { canStart, canTriage, ItemPane, spanWords, type TriageAction } from "./queue-pane.tsx";

/* ---------- stage strip ---------- */

function stageCount(data: QueueResponse, stage: (typeof STAGES)[number]) {
	const n = data.stages[stage];
	return stage === "Build" || stage === "Verify" ? `${n}/${data.limits.agents}` : String(n);
}

function StageStrip({ data }: { data: QueueResponse }) {
	return (
		<nav aria-label="Stages" className="overflow-x-auto">
			<div className="grid grid-cols-[repeat(7,minmax(84px,1fr))] rounded-sm border border-solid border-border-subtle">
				{STAGES.map((stage, i) => (
					<Link
						key={stage}
						to="/floor"
						className={`nav-item px-3 py-2 ${i > 0 ? "border-0 border-s border-solid border-border-subtle" : ""}`}
					>
						<div className="text-meta text-text-muted">{stage}</div>
						<div className="mt-0.5 font-mono text-metric tabular-nums">{stageCount(data, stage)}</div>
					</Link>
				))}
			</div>
		</nav>
	);
}

/* ---------- rows ---------- */

const GLYPHS: Partial<Record<QueueItem["kind"], GlyphKind>> = {
	error: "err",
	question: "ask",
	plan: "ask",
	waiting_in_t3: "ask",
	red_main: "fail",
	failed_gates: "fail",
	run_failed: "fail",
	ready_pr: "pass",
};

function RowCells({ item, strong }: { item: QueueItem; strong: boolean }) {
	return (
		<>
			<Glyph kind={GLYPHS[item.kind] ?? "idle"} />
			<span className="w-[88px] text-text-muted [overflow-wrap:anywhere]">{item.projectName}</span>
			<span
				className={`min-w-0 flex-[1_1_220px] [overflow-wrap:anywhere] max-[760px]:basis-full ${strong ? "font-medium" : ""}`}
			>
				{item.title}
			</span>
			<span className="text-meta text-text-muted max-[760px]:me-auto">{item.meta}</span>
			<span className="min-w-8 text-end font-mono text-data tabular-nums text-text-muted">
				{span(item.since)}
			</span>
		</>
	);
}

const ROW = "flex w-full flex-wrap items-center gap-x-3 gap-y-1 min-h-row rounded-sm box-border px-3 py-1.5";

function QueueRow({
	item,
	strong,
	selected,
	onSelect,
	register,
}: {
	item: QueueItem;
	strong: boolean;
	selected: boolean;
	onSelect: () => void;
	register: (el: HTMLButtonElement | null) => void;
}) {
	return (
		<button
			type="button"
			ref={register}
			data-queue-row={item.fingerprint}
			aria-pressed={selected}
			tabIndex={selected ? 0 : -1}
			onClick={onSelect}
			className={`${ROW} hover-row cursor-pointer border-0 text-start font-[inherit] text-text-primary ${
				selected ? "bg-bg-raised shadow-[inset_2px_0_0_var(--color-text-primary)]" : "bg-transparent"
			}`}
		>
			<RowCells item={item} strong={strong} />
		</button>
	);
}

/* ---------- banners ---------- */

function sinceWords(iso: string, now = new Date()) {
	const at = new Date(iso);
	const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
	if (days === 0) return `Since today at ${clock(iso)}`;
	if (days === 1) return `Since yesterday at ${clock(iso)}`;
	return `Since ${at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${clock(iso)}`;
}

function BackBanner({ back }: { back: BackSummary }) {
	const parts: string[] = [];
	if (back.shipped > 0) parts.push(`${back.shipped} shipped`);
	if (back.failed > 0)
		parts.push(
			back.failed === 1 ? "1 gate failed and needs you" : `${back.failed} gates failed and need you`,
		);
	if (back.newErrors > 0) parts.push(plural(back.newErrors, "new error"));
	if (parts.length === 0) return null;
	return (
		<Banner
			title={sinceWords(back.since)}
			body={parts.join(" · ")}
			actions={<ButtonLink to="/health">See numbers</ButtonLink>}
		/>
	);
}

const SOURCE_DATA: Record<SourceName, string> = {
	Sentry: "errors are",
	GitHub: "PRs and checks are",
	T3: "agent updates are",
};
const SOURCE_TOOL: Record<SourceName, string> = { Sentry: "sentry", GitHub: "gh", T3: "t3" };

function sourceReason(source: SourceHealth) {
	if (!source.error) return "The last check failed.";
	if (/401|403|unauthori[sz]ed|expired|token|auth/i.test(source.error))
		return `The ${SOURCE_TOOL[source.source]} token expired.`;
	return source.error.endsWith(".") ? source.error : `${source.error}.`;
}

function SourceBanner({
	source,
	fine,
	onCheck,
	pending,
}: {
	source: SourceHealth;
	fine: string[];
	onCheck: () => void;
	pending: boolean;
}) {
	return (
		<Banner
			role="alert"
			glyph="fail"
			title={
				source.lastOk
					? `${source.source} is out of date: ${SOURCE_DATA[source.source]} from ${spanWords(source.lastOk)} ago`
					: `${source.source} hasn't synced yet`
			}
			body={
				<>
					{sourceReason(source)}{" "}
					{source.fix ? (
						<>
							Run <code className="font-mono text-data">{source.fix}</code>, then check again.
						</>
					) : (
						"Check again in a minute."
					)}
					{fine.length > 0 && ` ${list(fine)} ${fine.length === 1 ? "is" : "are"} fine.`}
				</>
			}
			actions={
				<Button onClick={onCheck} disabled={pending}>
					Check again
				</Button>
			}
		/>
	);
}

function SourceBanners({ sources }: { sources: SourceHealth[] }) {
	const check = useAction(() => api.post("/api/sources/check", {}));
	const failing = sources.filter((s) => !s.ok);
	if (failing.length === 0) return null;
	const fine = sources.filter((s) => s.ok).map((s) => s.source);
	return (
		<>
			{failing.map((s) => (
				<SourceBanner
					key={s.source}
					source={s}
					fine={fine}
					pending={check.pending}
					onCheck={() => void check.run()}
				/>
			))}
			<InlineError>{check.error && "Couldn't check this. Try again."}</InlineError>
		</>
	);
}

function Banners({ data }: { data: QueueResponse }) {
	return (
		<>
			<SourceBanners sources={data.sources} />
			{data.firstLook && (
				<Banner
					glyph="pass"
					title={`Your first queue, ranked from ${plural(data.projects, "project")}`}
					body="Production errors first, then agents waiting on you, red builds, and ready PRs. Start with the top item."
				/>
			)}
			{data.back && <BackBanner back={data.back} />}
		</>
	);
}

/* ---------- loading ---------- */

function SkeletonRow({ width }: { width: string }) {
	return (
		<div className="flex min-h-row items-center gap-3 px-3">
			<Skeleton width="16px" height={16} />
			<Skeleton width="88px" />
			<Skeleton width={width} />
			<span className="ms-auto">
				<Skeleton width="32px" />
			</span>
		</div>
	);
}

function QueueLoading({ projects }: { projects: number | undefined }) {
	return (
		<Page
			pane={
				<Pane>
					<Skeleton width="60%" />
					<Skeleton width="90%" height={20} />
					<Skeleton width="100%" height={48} />
					<Skeleton width="70%" />
					<Skeleton width="100%" height={44} />
				</Pane>
			}
		>
			<div aria-busy="true" className="flex flex-col gap-5">
				<h1 className="m-0 text-page-title">Queue</h1>
				<div className="overflow-x-auto">
					<div className="box-border grid h-[60px] grid-cols-[repeat(7,minmax(84px,1fr))] items-center rounded-sm border border-solid border-border-subtle px-3">
						{STAGES.map((s) => (
							<Skeleton key={s} width="48px" height={24} />
						))}
					</div>
				</div>
				<section aria-label="Needs you">
					<SectionLabel>Needs you</SectionLabel>
					<SkeletonRow width="44%" />
					<SkeletonRow width="36%" />
					<SkeletonRow width="40%" />
					<SkeletonRow width="32%" />
				</section>
				<section aria-label="Later">
					<SectionLabel>Later</SectionLabel>
					<SkeletonRow width="38%" />
					<SkeletonRow width="34%" />
				</section>
				<p role="status" className="m-0 text-text-muted">
					{projects === undefined ? "Reading your projects" : `Reading ${plural(projects, "project")}`}
				</p>
			</div>
		</Page>
	);
}

/* ---------- nothing needs you ---------- */

function nothingNeedsYou(data: QueueResponse) {
	const agents = data.limits.build;
	const shipping = data.stages.Ship;
	const working =
		agents === 0
			? "No agents are working"
			: agents === 1
				? "1 agent is working"
				: `${agents} agents are working`;
	const moving =
		shipping === 0
			? "nothing is shipping"
			: shipping === 1
				? "1 change is shipping"
				: `${shipping} changes are shipping`;
	let next = "";
	if (data.nextCheckAt) {
		const minutes = Math.ceil((Date.parse(data.nextCheckAt) - Date.now()) / 60_000);
		next =
			minutes > 0 ? ` The next check runs in ${plural(minutes, "minute")}.` : " The next check runs soon.";
	}
	return `${working} and ${moving}. New errors, questions, and ready PRs land here.${next}`;
}

function NothingNeedsYou({ data }: { data: QueueResponse }) {
	const openNew = useOpenNewWorkOrder();
	return (
		<section aria-label="Needs you" className="flex max-w-[560px] flex-col items-start gap-2 py-8">
			<h2 className="m-0 text-detail-title">Nothing needs you</h2>
			<p className="m-0 text-text-muted">{nothingNeedsYou(data)}</p>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				<Button variant="primary" onClick={() => openNew()}>
					New work order
				</Button>
				<ButtonLink to="/floor">See the floor</ButtonLink>
			</div>
		</section>
	);
}

/* ---------- the screen ---------- */

const NOTE: Record<TriageAction, string> = {
	snooze: "Snoozed until tomorrow at 09:00.",
	dismiss: "Dismissed. It comes back only if it gets worse.",
};

type Started = { to: "floor" } | { id: number } | { blocked: string };

async function startWork(item: QueueItem, mode?: Mode | null, confirmed?: boolean): Promise<Started> {
	if (item.kind === "toolkit") {
		const res = await api.post<SyncResult>("/api/projects/sync", { slugs: [item.project] });
		const blocked = res.blocked[0];
		return blocked ? { blocked: blocked.slug } : { to: "floor" };
	}
	if (item.kind === "stale_pr" || item.kind === "rebase_pr") {
		const res = await api.post<{ workOrderId: number }>(
			`/api/prs/${encodeURIComponent(item.project ?? "")}/${item.pr?.number}/rebase`,
			{},
		);
		return { id: res.workOrderId };
	}
	return api.post<{ id: number }>("/api/work-orders", {
		project: item.project,
		type: "Bug fix",
		title: item.title,
		description: item.title,
		source: { kind: item.kind === "error" ? "error" : "red_main", fingerprint: item.fingerprint },
		mode: mode?.id,
		confirmed,
	});
}

function QueueList({ data }: { data: QueueResponse }) {
	const navigate = useNavigate();
	const router = useRouter();
	const openNew = useOpenNewWorkOrder();
	const search = useSearch({ strict: false }) as { select?: string };
	const rows = useRef(new Map<string, HTMLButtonElement>());
	const undoRef = useRef<HTMLButtonElement>(null);
	const focusAfterRefresh = useRef<string | null>(null);
	const afterG = useRef(0);
	const [note, setNote] = useState<{ text: string; fingerprint: string } | null>(null);
	const [triageVerb, setTriageVerb] = useState<TriageAction>("snooze");
	const [blocked, setBlocked] = useState<{ fingerprint: string; slug: string; name: string } | null>(null);

	const needsYou = data.needsYou;
	const later = data.later;
	const listing = needsYou.length > 0;
	const items = listing ? [...needsYou, ...later] : [];
	const selected = items.find((i) => i.fingerprint === search.select) ?? items[0] ?? null;

	const select = useCallback(
		(fingerprint: string | undefined) =>
			void navigate({
				to: "/",
				search: (prev: Record<string, unknown>) => ({ ...prev, select: fingerprint }),
				replace: true,
				resetScroll: false,
			} as never),
		[navigate],
	);

	const start = useAction(
		({ item, mode, confirmed }: { item: QueueItem; mode?: Mode | null; confirmed?: boolean }) =>
			startWork(item, mode, confirmed),
		{
			onSuccess: (res, { item }) => {
				if ("blocked" in res) {
					setBlocked({
						fingerprint: item.fingerprint,
						slug: res.blocked,
						name: item.projectName ?? res.blocked,
					});
				} else if ("to" in res || data.limits.startBlock) {
					// It waits in Intake, or it's a sync, whose board goes to the floor.
					void navigate({ to: "/floor" });
				} else {
					void navigate({ to: "/work-orders/$id", params: { id: String(res.id) } });
				}
			},
		},
	);

	const triage = useAction(
		({ item, action }: { item: QueueItem; action: TriageAction }) =>
			api.post("/api/triage", { fingerprints: [item.fingerprint], action }),
		{
			onSuccess: (_res, { item, action }) => {
				const at = items.findIndex((i) => i.fingerprint === item.fingerprint);
				const next = items[at + 1] ?? items[at - 1];
				setNote({ text: NOTE[action], fingerprint: item.fingerprint });
				select(next?.fingerprint);
				if (next) rows.current.get(next.fingerprint)?.focus();
				else focusAfterRefresh.current = "undo";
			},
		},
	);

	const undo = useAction(
		(fingerprint: string) => api.post("/api/triage", { fingerprints: [fingerprint], action: "undo" }),
		{
			onSuccess: (_res, fingerprint) => {
				setNote(null);
				select(fingerprint);
				focusAfterRefresh.current = fingerprint;
			},
		},
	);

	const runTriage = (item: QueueItem, action: TriageAction) => {
		setTriageVerb(action);
		void triage.run({ item, action });
	};

	// The row list just changed: move focus where the last action promised.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each refresh of the queue.
	useEffect(() => {
		const target = focusAfterRefresh.current;
		if (!target) return;
		if (target === "undo") {
			if (!undoRef.current) return;
			undoRef.current.focus();
			focusAfterRefresh.current = null;
			return;
		}
		const row = rows.current.get(target);
		if (row) {
			row.focus();
			focusAfterRefresh.current = null;
		}
	}, [data]);

	// Snoozing the last Needs you row turns the rows into links, so focus goes to Undo.
	useEffect(() => {
		if (!listing && note) undoRef.current?.focus();
	}, [listing, note]);

	// A failure belongs to the row it happened on.
	const selectedFingerprint = selected?.fingerprint;
	const clearStart = start.clearError;
	const clearTriage = triage.clearError;
	// biome-ignore lint/correctness/useExhaustiveDependencies: clears whenever the selection moves.
	useEffect(() => {
		clearStart();
		clearTriage();
		setBlocked(null);
	}, [selectedFingerprint, clearStart, clearTriage]);

	const move = (delta: number) => {
		if (items.length === 0) return;
		// The location updates at once, the render a moment later, so quick presses still add up.
		const current = (router.latestLocation.search as { select?: string }).select;
		const known = items.findIndex((i) => i.fingerprint === current);
		const at = known === -1 ? 0 : known;
		const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
		if (!next) return;
		select(next.fingerprint);
		rows.current.get(next.fingerprint)?.focus();
	};

	const open = (item: QueueItem) => void navigate({ to: item.href });

	/** Roving focus: arrows move focus through the rows, and Enter selects the focused one. */
	const focusNeighbour = (e: KeyboardEvent, delta: number) => {
		const row = (e.target as HTMLElement).closest<HTMLElement>("[data-queue-row]");
		if (!row) return;
		e.preventDefault();
		const at = items.findIndex((i) => i.fingerprint === row.dataset.queueRow);
		const next = items[at + delta];
		if (next) rows.current.get(next.fingerprint)?.focus();
	};

	/** `g s` goes to Settings, and must not also snooze. The shell handles the `g`. */
	const key = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
		if (Date.now() - afterG.current < 1500) {
			afterG.current = 0;
			return;
		}
		fn(e);
	};

	useKeys({
		g: () => {
			afterG.current = Date.now();
		},
		j: key(() => move(1)),
		k: key(() => move(-1)),
		w: key(() => {
			if (selected && canStart(selected.kind) && !start.pending) void start.run({ item: selected });
		}),
		s: key(() => {
			if (selected && canTriage(selected.kind) && !triage.pending) runTriage(selected, "snooze");
		}),
		d: key(() => {
			if (selected && canTriage(selected.kind) && !triage.pending) runTriage(selected, "dismiss");
		}),
		Enter: key((e) => {
			if (!selected) return;
			const target = e.target as HTMLElement;
			const row = target.closest<HTMLElement>("[data-queue-row]");
			if (row) {
				e.preventDefault();
				const fingerprint = row.dataset.queueRow;
				if (fingerprint === selected.fingerprint) open(selected);
				else select(fingerprint);
			} else if (target === document.body) {
				open(selected);
			}
		}),
		ArrowDown: key((e) => focusNeighbour(e, 1)),
		ArrowUp: key((e) => focusNeighbour(e, -1)),
	});

	const renderRow = (item: QueueItem, strong: boolean) => (
		<QueueRow
			key={item.fingerprint}
			item={item}
			strong={strong}
			selected={item.fingerprint === selected?.fingerprint}
			onSelect={() => select(item.fingerprint)}
			register={(el) => {
				if (el) rows.current.set(item.fingerprint, el);
				else rows.current.delete(item.fingerprint);
			}}
		/>
	);

	const pane = selected ? (
		<ItemPane
			key={selected.fingerprint}
			item={selected}
			actions={{
				limits: data.limits,
				start: (mode, confirmed) => void start.run({ item: selected, mode, confirmed }),
				startPending: start.pending,
				startError: start.error && "Couldn't start this. Try again.",
				blocked: blocked?.fingerprint === selected.fingerprint ? blocked : null,
				triage: (action) => runTriage(selected, action),
				triagePending: triage.pending,
				triageError: triage.error && `Couldn't ${triageVerb} this. Try again.`,
			}}
		/>
	) : undefined;

	const needCount = needsYou.length === 1 ? "1 needs you" : `${needsYou.length} need you`;
	return (
		<Page pane={pane}>
			<PageHeader
				title="Queue"
				summary={`${needCount} · ${later.length} can wait`}
				actions={listing ? <Button onClick={() => openNew()}>New work order</Button> : undefined}
			/>
			<Banners data={data} />
			<StageStrip data={data} />
			{listing ? (
				<>
					<section aria-label="Needs you" className="mt-1 flex flex-col gap-1">
						<SectionLabel>Needs you</SectionLabel>
						{needsYou.map((item) => renderRow(item, true))}
					</section>
					{later.length > 0 && (
						<section aria-label="Later" className="mt-1 flex flex-col gap-1">
							<SectionLabel>Later</SectionLabel>
							{later.map((item) => renderRow(item, false))}
						</section>
					)}
				</>
			) : (
				<>
					<NothingNeedsYou data={data} />
					{later.length > 0 && (
						<section aria-label="Later" className="flex flex-col gap-1">
							<SectionLabel>Later</SectionLabel>
							{later.map((item) => (
								<Link key={item.fingerprint} to={item.href} className={`${ROW} hover-row`}>
									<RowCells item={item} strong={false} />
								</Link>
							))}
						</section>
					)}
				</>
			)}
			<StatusLine className="min-h-9">
				{note && (
					<span className="inline-flex flex-wrap items-center gap-3">
						{note.text}
						<Button ref={undoRef} disabled={undo.pending} onClick={() => void undo.run(note.fingerprint)}>
							Undo
						</Button>
					</span>
				)}
			</StatusLine>
			<InlineError>{undo.error && "Couldn't undo this. Try again."}</InlineError>
			{listing && (
				<footer className="mt-auto flex flex-wrap gap-4 pt-4 text-meta text-text-muted">
					{(
						[
							["j k", "move"],
							["↵", "open"],
							["w", "start work order"],
							["s", "snooze"],
							["d", "dismiss"],
						] as const
					).map(([k, what]) => (
						<span key={k}>
							<b className="font-mono font-medium text-text-primary">{k}</b> {what}
						</span>
					))}
				</footer>
			)}
		</Page>
	);
}

export function QueueScreen() {
	const queue = useQueue();
	const shell = useShell();
	if (queue.data && !queue.data.loading) return <QueueList data={queue.data} />;
	if (queue.data) return <QueueLoading projects={queue.data.projects} />;
	if (queue.isPending) return <QueueLoading projects={shell.data?.counts.projects} />;
	return (
		<Page>
			<PageHeader title="Queue" />
			<LoadFailed what="the queue" error={queue.error} />
		</Page>
	);
}
