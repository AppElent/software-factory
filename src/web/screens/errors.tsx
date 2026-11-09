import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ErrorItem, Mode } from "../../shared/types.ts";
import { api } from "../api.ts";
import { confirmOnProductionError, FixButton, fixLabel } from "../fix.tsx";
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
} from "../kit.tsx";
import { ProjectPicker, useChosenProjects, useChosenWords } from "../project-picker.tsx";
import { useAction, useErrors, useQueue, useShell } from "../queries.ts";
import { ListSkeleton, NothingIn, openSummary } from "./prs.tsx";

/* ---------- parts the error page shares ---------- */

export const fingerprintOf = (id: string) => `error:${id}`;

export const triage = (ids: string[], action: "snooze" | "dismiss" | "undo") =>
	api.post("/api/triage", { fingerprints: ids.map(fingerprintOf), action });

/** The service builds the agent's context from the fingerprint, so the old fix comes along on a regression. */
export const fixBody = (e: Pick<ErrorItem, "id" | "project" | "title">) => ({
	project: e.project,
	type: "Bug fix",
	description: `Fix ${e.title}`,
	source: { kind: "error", fingerprint: fingerprintOf(e.id) },
});

export const startFix = (
	e: Pick<ErrorItem, "id" | "project" | "title">,
	mode: Mode | null = null,
	confirmed = false,
) =>
	api.post<{ id: number; waiting: boolean }>("/api/work-orders", {
		...fixBody(e),
		mode: mode?.id,
		confirmed,
	});

/** "1 minute ago", the spelled-out age the Errors boards use. */
export function agoWords(iso: string) {
	const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
	if (m < 1) return "just now";
	if (m < 60) return `${plural(m, "minute")} ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${plural(h, "hour")} ago`;
	return `${plural(Math.round(h / 24), "day")} ago`;
}

export const kindWord = (e: ErrorItem) =>
	e.triage?.action === "snooze"
		? "Snoozed"
		: e.kind === "new"
			? "New"
			: e.kind === "regression"
				? "Regression"
				: "Ongoing";

function ErrorRow({ e, checked, onToggle }: { e: ErrorItem; checked: boolean; onToggle: () => void }) {
	return (
		<div className="flex items-center">
			<label className="flex min-h-row w-9 flex-none cursor-pointer items-center justify-center">
				<input type="checkbox" aria-label={`Select ${e.title}`} checked={checked} onChange={onToggle} />
			</label>
			<Link
				to="/errors/$id"
				params={{ id: e.id }}
				className="hover-row flex min-h-row min-w-0 flex-[1_1_0] flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-1.5"
			>
				<Glyph kind={e.triage?.action === "snooze" ? "idle" : "err"} />
				<span className="min-w-0 flex-[1_1_180px] font-medium [overflow-wrap:anywhere]">{e.title}</span>
				{/* On a phone the title gets its own line, so every row reads the same. */}
				<span aria-hidden="true" className="-mb-1 h-0 basis-full sm:hidden" />
				<span className="w-24 text-meta text-text-muted max-sm:w-auto">{kindWord(e)}</span>
				<span className="w-22 text-end font-mono text-data tabular-nums text-text-muted max-sm:w-auto">
					{plural(e.events, "event")}
				</span>
				<span className="w-18 text-end font-mono text-data tabular-nums text-text-muted max-sm:w-auto">
					{plural(e.users, "user")}
				</span>
				<span className="w-8 text-end font-mono text-data tabular-nums text-text-muted">
					{span(e.kind === "regression" ? e.lastSeen : e.firstSeen)}
				</span>
			</Link>
		</div>
	);
}

export function ErrorsScreen() {
	const { dismissed } = useSearch({ from: "/shell/errors" });
	const navigate = useNavigate();
	const [chosenProjects, setChosenProjects] = useChosenProjects();
	const chosenWords = useChosenWords();
	const filtered = chosenProjects.length > 0;
	const q = useErrors(chosenProjects);
	const shell = useShell();
	const queue = useQueue();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [gone, setGone] = useState<Set<string>>(new Set());
	const [note, setNote] = useState<{ text: string; ids: string[] } | null>(() =>
		dismissed ? { text: "Dismissed 1 error.", ids: [dismissed] } : null,
	);
	const undoRef = useRef<HTMLButtonElement>(null);
	const pickerRef = useRef<HTMLButtonElement>(null);

	const errors = (q.data?.errors ?? []).filter((e) => !gone.has(e.id));
	const chosen = errors.filter((e) => selected.has(e.id));
	const startable = chosen.filter((e) => !e.workOrderId);
	const atLimit = !!queue.data?.limits.startBlock;

	const act = useAction(
		({ ids, action }: { ids: string[]; action: "snooze" | "dismiss" }) => triage(ids, action),
		{
			onSuccess: (_, { ids, action }) => {
				setGone((prev) => new Set([...prev, ...ids]));
				setSelected(new Set());
				setNote({
					text: `${action === "snooze" ? "Snoozed" : "Dismissed"} ${plural(ids.length, "error")}.`,
					ids,
				});
			},
		},
	);
	const undo = useAction((ids: string[]) => triage(ids, "undo"), {
		onSuccess: (_, ids) => {
			setGone((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
			setNote(null);
			if (dismissed) void navigate({ to: "/errors", search: {} });
			pickerRef.current?.focus();
		},
	});
	const start = useAction(
		async ({ list, mode, confirmed }: { list: ErrorItem[]; mode: Mode | null; confirmed: boolean }) => {
			// One at a time. Those already started leave the selection, so Try again doesn't repeat them.
			for (const e of list) {
				await startFix(e, mode, confirmed);
				setSelected((prev) => {
					const next = new Set(prev);
					next.delete(e.id);
					return next;
				});
			}
		},
		{ onSuccess: () => void navigate({ to: "/floor" }) },
	);

	// The bar left with the selection, so focus moves to Undo.
	useEffect(() => {
		if (note) undoRef.current?.focus();
	}, [note]);

	const toggle = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});

	const notePanel = (
		<div className="flex flex-col gap-2">
			<div role="status" className="min-h-9">
				{note && (
					<span className="inline-flex flex-wrap items-center gap-3">
						{note.text}
						<Button ref={undoRef} disabled={undo.pending} onClick={() => void undo.run(note.ids)}>
							Undo
						</Button>
					</span>
				)}
			</div>
			<InlineError>{undo.error && "Couldn't undo this. Try again."}</InlineError>
		</div>
	);

	const loading = q.isPending || (q.data?.errors.length === 0 && (shell.isPending || shell.data?.checking));

	if (q.isError && !q.data) {
		return (
			<Page>
				<PageHeader title="Errors" />
				<LoadFailed what="errors" error={q.error} />
			</Page>
		);
	}
	if (loading || !q.data) {
		return (
			<Page>
				<PageHeader title="Errors" />
				<ListSkeleton noun="errors" />
			</Page>
		);
	}

	const { checkedAt, quiet, withoutSentry } = q.data;
	const checked = checkedAt ? `Checked ${agoWords(checkedAt)}.` : "";

	if (errors.length === 0 && !filtered) {
		return (
			<Page>
				<PageHeader title="Errors" summary="0 open" />
				<div className="flex max-w-[560px] flex-col items-start gap-2 pt-8">
					<h2 className="m-0 text-detail-title">No open errors</h2>
					<p className="m-0 text-text-muted">
						Sentry reports nothing new in {plural(quiet, "connected project")}. {checked}
					</p>
					{withoutSentry > 0 && (
						<p className="m-0 text-text-muted">
							{withoutSentry === 1 ? "1 project has" : `${withoutSentry} projects have`} no Sentry yet.{" "}
							<Lnk to="/projects">Connect them in Projects</Lnk>
						</p>
					)}
				</div>
				{notePanel}
			</Page>
		);
	}

	const groups = new Map<string, ErrorItem[]>();
	for (const e of errors) groups.set(e.projectName, [...(groups.get(e.projectName) ?? []), e]);
	const coverage = [
		quiet > 0 &&
			(quiet === 1 ? "1 other project has no open errors." : `${quiet} other projects have no open errors.`),
		withoutSentry > 0 && `${withoutSentry} ${withoutSentry === 1 ? "has" : "have"} no Sentry yet.`,
		checked,
	]
		.filter(Boolean)
		.join(" ");
	const n = chosen.length;
	const count = startable.length;

	return (
		<Page>
			<div className="flex flex-col gap-5">
				<PageHeader
					title="Errors"
					summary={openSummary(errors.length, groups.size)}
					actions={<ProjectPicker triggerRef={pickerRef} />}
				/>
				{[...groups].map(([name, rows]) => (
					<section key={name} aria-label={name} className="flex flex-col gap-1">
						<SectionLabel>
							{name} · {rows.length}
						</SectionLabel>
						{rows.map((e) => (
							<ErrorRow key={e.id} e={e} checked={selected.has(e.id)} onToggle={() => toggle(e.id)} />
						))}
					</section>
				))}
				{errors.length === 0 && <NothingIn name={chosenWords} onShowAll={() => setChosenProjects([])} />}
				{notePanel}
				{!filtered && coverage && <p className="m-0 text-meta text-text-muted">{coverage}</p>}
			</div>
			{n > 0 && (
				<div className="sticky bottom-4 z-10 mt-auto">
					<BulkBar count={n} onClear={() => setSelected(new Set())}>
						<InlineError>
							{(act.error && "Couldn't change these. Try again.") ||
								(start.error && "Couldn't start these. Try again.")}
						</InlineError>
						<Button
							disabled={act.pending}
							onClick={() => void act.run({ ids: chosen.map((e) => e.id), action: "snooze" })}
						>
							Snooze
						</Button>
						<Button
							disabled={act.pending}
							onClick={() => void act.run({ ids: chosen.map((e) => e.id), action: "dismiss" })}
						>
							Dismiss
						</Button>
						{count > 0 && (
							<FixButton
								label={(mode) => fixLabel(count, mode, atLimit)}
								pending={start.pending}
								run={(mode, confirmed) => void start.run({ list: startable, mode, confirmed })}
								confirm={confirmOnProductionError(count)}
								commands={() => startable.map(fixBody)}
							/>
						)}
					</BulkBar>
				</div>
			)}
		</Page>
	);
}
