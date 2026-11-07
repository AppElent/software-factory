import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { allFourPassed, noGates } from "../../shared/rules.ts";
import type { BulkMergeResult, PrGroup, PullRequest } from "../../shared/types.ts";
import { api } from "../api.ts";
import { list, plural, span } from "../format.ts";
import {
	Banner,
	BulkBar,
	Button,
	ButtonLink,
	ConfirmDialog,
	GateRow,
	Glyph,
	type GlyphKind,
	InlineError,
	LoadFailed,
	Page,
	PageHeader,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useProjects, usePrs, useShell } from "../queries.ts";
import { useOpenNewWorkOrder } from "../shell.tsx";

/* ---------- parts the Errors list shares ---------- */

/** Project select. The value lives in `?project=`, so it survives reload and Back. */
export function ProjectFilter({
	value,
	onChange,
	selectRef,
}: {
	value: string | undefined;
	onChange: (slug: string | undefined) => void;
	selectRef?: RefObject<HTMLSelectElement | null>;
}) {
	const id = useId();
	const projects = useProjects();
	return (
		<span className="flex flex-wrap items-center gap-2">
			<label htmlFor={id} className="text-meta text-text-muted">
				Project
			</label>
			<select
				id={id}
				ref={selectRef}
				className="max-w-full"
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value || undefined)}
			>
				<option value="">All projects</option>
				{projects.data
					?.slice()
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				{value && projects.data && !projects.data.some((p) => p.slug === value) && (
					<option value={value}>{value}</option>
				)}
			</select>
		</span>
	);
}

/** Never renders loading as empty. `Reading N projects` while the first read runs. */
export function ListSkeleton({ noun }: { noun: string }) {
	const shell = useShell();
	const label = shell.data?.checking
		? `Reading ${plural(shell.data.counts.projects, "project")}`
		: `Loading ${noun}`;
	return (
		<div className="flex flex-col gap-3">
			<StatusLine className="text-text-muted">{label}</StatusLine>
			{["60%", "45%", "70%", "50%"].map((w) => (
				<div key={w} className="flex min-h-row items-center px-3">
					<Skeleton width={w} />
				</div>
			))}
		</div>
	);
}

export function NothingIn({ name, onShowAll }: { name: string; onShowAll: () => void }) {
	return (
		<div className="flex flex-col items-start gap-2">
			<p role="status" className="m-0">
				Nothing open in {name}.
			</p>
			<Button onClick={onShowAll}>Show all projects</Button>
		</div>
	);
}

export const openSummary = (count: number, projects: number) =>
	count === 0 ? "0 open" : `${count} open in ${plural(projects, "project")}`;

/* ---------- pull requests ---------- */

export const prSize = (additions: number, deletions: number) => `+${additions} −${deletions}`;

const GROUPS: Array<{ group: PrGroup; label: string; glyph: GlyphKind }> = [
	{ group: "ready", label: "Ready to merge", glyph: "pass" },
	{ group: "failed", label: "Gate failed", glyph: "fail" },
	{ group: "running", label: "Running", glyph: "run" },
	{ group: "rebase", label: "Needs rebase", glyph: "idle" },
	{ group: "stale", label: "Stale", glyph: "idle" },
];

const keyOf = (pr: PullRequest) => `${pr.project}#${pr.number}`;

/** GitHub's words for a merge blocked by the base branch moving. */
export const needsRebase = (reason: string) =>
	/behind|rebase|conflict|moved on|base branch|not mergeable|out of date/i.test(reason);

interface BulkResult {
	merged: PullRequest[];
	failed: Array<{ pr: PullRequest; reason: string }>;
}

function resultBody({ merged, failed }: BulkResult) {
	const parts: string[] = [];
	if (merged.length > 0) {
		const names = merged.map((p) => `${p.projectName} #${p.number}`);
		parts.push(`${list(names)} ${merged.length === 1 ? "is" : "are"} shipping now.`);
	}
	for (const { pr, reason } of failed) {
		parts.push(
			needsRebase(reason)
				? `${pr.projectName} moved on while #${pr.number} waited, so it needs a rebase.`
				: `#${pr.number}: ${reason}`,
		);
	}
	return parts.join(" ");
}

function resultTitle({ merged, failed }: BulkResult) {
	const parts: string[] = [];
	if (merged.length > 0) parts.push(`${merged.length} merged.`);
	if (failed.length > 0) parts.push(`${list(failed.map((f) => `#${f.pr.number}`))} couldn't merge.`);
	return parts.join(" ");
}

function PrRow({
	pr,
	glyph,
	checked,
	onToggle,
}: {
	pr: PullRequest;
	glyph: GlyphKind;
	checked?: boolean;
	onToggle?: () => void;
}) {
	const body = (
		<>
			<Glyph kind={glyph} />
			<span className="font-mono text-data text-text-muted">#{pr.number}</span>
			<span className="min-w-0 flex-[1_1_180px] font-medium [overflow-wrap:anywhere]">{pr.title}</span>
			{/* On a phone the title gets its own line, so every row reads the same. */}
			<span aria-hidden="true" className="-mb-1 h-0 basis-full sm:hidden" />
			<span className="w-22 text-text-muted [overflow-wrap:anywhere] max-sm:w-auto">{pr.projectName}</span>
			<span className="w-14">
				{/* Gates from before the base moved no longer count. */}
				<GateRow gates={pr.group === "rebase" || pr.group === "stale" ? noGates("out_of_date") : pr.gates} />
			</span>
			<span className="w-22 text-end font-mono text-data tabular-nums text-text-muted max-sm:w-auto">
				{prSize(pr.additions, pr.deletions)}
			</span>
			<span className="w-8 text-end font-mono text-data tabular-nums text-text-muted">
				{span(pr.createdAt)}
			</span>
		</>
	);
	const rowClass =
		"hover-row flex min-h-row min-w-0 flex-[1_1_0] flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-1.5";
	return (
		<div className="flex items-center">
			{onToggle && (
				<label className="flex min-h-row w-9 flex-none cursor-pointer items-center justify-center">
					<input
						type="checkbox"
						aria-label={`Select PR #${pr.number}`}
						checked={checked}
						onChange={onToggle}
					/>
				</label>
			)}
			{/* A running PR with a work order opens that work order, as the board links it. */}
			{pr.group === "running" && pr.workOrderId ? (
				<Link to="/work-orders/$id" params={{ id: String(pr.workOrderId) }} className={rowClass}>
					{body}
				</Link>
			) : (
				<Link
					to="/prs/$project/$number"
					params={{ project: pr.project, number: String(pr.number) }}
					className={rowClass}
				>
					{body}
				</Link>
			)}
		</div>
	);
}

export function PullRequestsScreen() {
	const { project } = useSearch({ from: "/shell/prs" });
	const navigate = useNavigate();
	const q = usePrs(project);
	const shell = useShell();
	const projects = useProjects();
	const openNew = useOpenNewWorkOrder();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [asking, setAsking] = useState(false);
	const [result, setResult] = useState<BulkResult | null>(null);
	const resultRef = useRef<HTMLDivElement>(null);

	const setProject = (slug: string | undefined) => void navigate({ to: "/prs", search: { project: slug } });

	const prs = q.data ?? [];
	const ready = prs.filter((p) => p.group === "ready");
	// One ready PR is merged from its own page, so it has no checkbox.
	const selectable = ready.length >= 2;
	const chosen = selectable ? ready.filter((p) => selected.has(keyOf(p))) : [];

	const merge = useAction(
		(list: PullRequest[]) =>
			api.post<BulkMergeResult>("/api/prs/merge", {
				prs: list.map((p) => ({ project: p.project, number: p.number })),
			}),
		{
			onSuccess: (r, sent) => {
				const failed = r.failed.flatMap((f) => {
					const pr = sent.find((p) => p.project === f.project && p.number === f.number);
					return pr ? [{ pr, reason: f.reason }] : [];
				});
				setResult({
					merged: sent.filter((p) => !failed.some((f) => f.pr === p)),
					failed,
				});
				setSelected(new Set());
				setAsking(false);
			},
		},
	);
	const rebase = useAction(
		async (list: PullRequest[]) => {
			for (const p of list) {
				await api.post(`/api/prs/${encodeURIComponent(p.project)}/${p.number}/rebase`);
			}
		},
		{ onSuccess: () => void navigate({ to: "/floor" }) },
	);

	// The opener left with the selection, so focus moves to the result.
	useEffect(() => {
		if (result) resultRef.current?.focus();
	}, [result]);

	const toggle = (pr: PullRequest) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(keyOf(pr))) next.add(keyOf(pr));
			return next;
		});

	const loading = q.isPending || (prs.length === 0 && (shell.isPending || shell.data?.checking));

	if (q.isError && !q.data) {
		return (
			<Page>
				<PageHeader title="Pull requests" />
				<LoadFailed what="pull requests" error={q.error} />
			</Page>
		);
	}
	if (loading) {
		return (
			<Page>
				<PageHeader title="Pull requests" />
				<ListSkeleton noun="pull requests" />
			</Page>
		);
	}
	if (prs.length === 0 && !project && !result) {
		return (
			<Page>
				<PageHeader title="Pull requests" summary="0 open" />
				<div className="flex max-w-[560px] flex-col items-start gap-2 pt-8">
					<h2 className="m-0 text-detail-title">No open pull requests</h2>
					<p className="m-0 text-text-muted">
						PRs from your work orders and from anyone else on GitHub show up here, grouped by what they need.
					</p>
					<div className="mt-2">
						<Button variant="primary" onClick={() => openNew()}>
							New work order
						</Button>
					</div>
				</div>
			</Page>
		);
	}

	const projectName = projects.data?.find((p) => p.slug === project)?.name ?? project ?? "";
	const toRebase = result?.failed.filter((f) => needsRebase(f.reason)).map((f) => f.pr) ?? [];
	const n = chosen.length;
	const mergeLabel = `Merge ${plural(n, "PR")}`;
	const sentence = chosen.every((p) => allFourPassed(p.gates))
		? "All 4 gates passed on each one."
		: "Every gate that's set up passed on each one.";

	return (
		<Page>
			<div className="flex flex-col gap-5">
				<PageHeader
					title="Pull requests"
					summary={openSummary(prs.length, new Set(prs.map((p) => p.project)).size)}
					actions={<ProjectFilter value={project} onChange={setProject} />}
				/>
				{result && (
					<div ref={resultRef} tabIndex={-1} className="flex flex-col gap-2">
						<Banner
							role="status"
							glyph={result.failed.length > 0 ? "err" : "pass"}
							title={resultTitle(result)}
							body={resultBody(result)}
							actions={
								<>
									{toRebase.length > 0 && (
										<Button disabled={rebase.pending} onClick={() => void rebase.run(toRebase)}>
											{toRebase.length === 1
												? "Start rebase work order"
												: `Start ${toRebase.length} rebase work orders`}
										</Button>
									)}
									{result.merged.length > 0 && <ButtonLink to="/floor">See the floor</ButtonLink>}
								</>
							}
						/>
						<InlineError>{rebase.error && "Couldn't start this. Try again."}</InlineError>
					</div>
				)}
				{GROUPS.map(({ group, label, glyph }) => {
					const rows = prs.filter((p) => p.group === group);
					if (rows.length === 0) return null;
					return (
						<section key={group} aria-label={label} className="flex flex-col gap-1">
							<SectionLabel>
								{label} · {rows.length}
							</SectionLabel>
							{rows.map((pr) => (
								<PrRow
									key={keyOf(pr)}
									pr={pr}
									glyph={glyph}
									checked={selected.has(keyOf(pr))}
									onToggle={group === "ready" && selectable ? () => toggle(pr) : undefined}
								/>
							))}
						</section>
					);
				})}
				{prs.length === 0 && project && (
					<NothingIn name={projectName} onShowAll={() => setProject(undefined)} />
				)}
			</div>
			{n > 0 && (
				<div className="sticky bottom-4 z-10 mt-auto">
					<BulkBar count={n} onClear={() => setSelected(new Set())}>
						<Button variant="primary" onClick={() => setAsking(true)}>
							{mergeLabel}
						</Button>
					</BulkBar>
				</div>
			)}
			<ConfirmDialog
				open={asking && n > 0}
				onOpenChange={(open) => {
					setAsking(open);
					if (!open) merge.clearError();
				}}
				title={`Merge ${plural(n, "PR")}?`}
				description={
					<div className="flex flex-col gap-4">
						<ul className="m-0 flex list-none flex-col gap-1 p-0 text-text-primary">
							{chosen.map((p) => (
								<li key={keyOf(p)} className="flex items-center gap-2">
									<GateRow gates={p.gates} />
									<span className="min-w-0 [overflow-wrap:anywhere]">
										#{p.number} {p.title} · {p.projectName}
									</span>
								</li>
							))}
						</ul>
						<p className="m-0">
							{sentence} They merge one at a time and each ships to production as it merges. If one can't
							merge, it stays open and the rest continue. You can't undo a merge from here.
						</p>
					</div>
				}
				action={merge.pending ? "Merging…" : mergeLabel}
				actionVariant="primary"
				pending={merge.pending}
				error={merge.error && "Couldn't merge these. Try again."}
				onAction={() => void merge.run(chosen)}
			/>
		</Page>
	);
}
