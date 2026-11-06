import { useEffect, useRef, useState } from "react";
import type { Project, SyncResult, WorkOrder } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, list, plural } from "../format.ts";
import {
	BulkBar,
	Button,
	ButtonLink,
	ConfirmDialog,
	Glyph,
	type GlyphKind,
	InlineError,
	Lnk,
	Mono,
	Page,
	PageHeader,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useProjects, useShell, useWorkOrders } from "../queries.ts";

/* Shared with the project page. */

export const failed = (verb: string, error: string | null) =>
	error ? `Couldn't ${verb} this. Try again. ${error}` : null;

export const behindWords = (days: number) => `${plural(days, "day")} behind`;

export function toolkitWords(p: Project): { glyph: GlyphKind; words: string } {
	switch (p.toolkit.status) {
		case "source":
			return { glyph: "pass", words: "Source" };
		case "current":
			return { glyph: "pass", words: "Current" };
		case "behind":
			return { glyph: "idle", words: behindWords(p.toolkit.behindDays) };
		case "none":
			return { glyph: "idle", words: "Not set up" };
		default:
			return { glyph: "idle", words: "Unknown" };
	}
}

/** A sync work order still open for this project, so a reload can't start a second one. */
export const openSync = (workOrders: WorkOrder[] | undefined, slug: string) =>
	workOrders?.find((w) => w.project === slug && w.type === "Toolkit sync");

/* The table. */

const HEAD =
	"whitespace-nowrap border-0 border-b border-solid border-border-subtle px-3 py-2 text-meta font-medium text-text-muted";
const CELL = "border-0 border-b border-solid border-border-subtle px-3 py-2";
const NUM = `${CELL} whitespace-nowrap text-end`;

const isActive = (p: Project) => p.openWorkOrders + p.openPrs + p.openErrors > 0;

/** "1 agent slot is free, so 1 starts now and 3 wait in Intake." */
function slotsLine(n: number, free: number, stopped: boolean): string {
	const intro = "Each runs on its own worktree and opens a PR for you to merge.";
	if (stopped) {
		return `${intro} The line is stopped, so ${n === 1 ? "it waits" : "they wait"} in Intake until you restart.`;
	}
	const slots =
		free === 0
			? "No agent slot is free"
			: free === 1
				? "1 agent slot is free"
				: `${free} agent slots are free`;
	if (free === 0) return `${intro} ${slots}, so ${n === 1 ? "it waits" : "they all wait"} in Intake.`;
	if (free >= n) return `${intro} ${slots}, so ${n === 1 ? "it starts now" : `all ${n} start now`}.`;
	const wait = n - free;
	return `${intro} ${slots}, so ${free} ${free === 1 ? "starts" : "start"} now and ${wait} ${wait === 1 ? "waits" : "wait"} in Intake.`;
}

interface Done {
	started: number;
	waiting: number;
	blocked: Project[];
}

function doneWords(d: Done): { title: string; body: string } {
	const names = d.blocked.map((p) => p.name);
	const startedWords = `${d.started} sync work ${d.started === 1 ? "order" : "orders"} started`;
	const title = names.length ? `${startedWords}, ${list(names)} couldn't start` : startedWords;
	const building = d.started - d.waiting;
	let pace = "";
	if (d.started > 1) {
		const waits = `${d.waiting} ${d.waiting === 1 ? "waits" : "wait"} in Intake`;
		const builds = `${building} ${building === 1 ? "is" : "are"} building`;
		if (building && d.waiting) pace = `${builds} and ${waits}. `;
		else pace = `${building ? builds : waits}. `;
	}
	const missing = names.length
		? ` ${list(names)} ${names.length === 1 ? "isn't in its folder" : "aren't in their folders"} on this Mac.`
		: "";
	return { title, body: `${pace}Their PRs land in Pull requests.${missing}` };
}

function ToolkitCell({
	project,
	started,
	blocked,
	pending,
	error,
	onSync,
}: {
	project: Project;
	started: boolean;
	blocked: boolean;
	pending: boolean;
	error: string | null;
	onSync: () => void;
}) {
	const { glyph, words } = toolkitWords(project);
	if (project.toolkit.status !== "behind") {
		return (
			<span className="inline-flex items-center gap-2">
				<Glyph kind={glyph} size={14} />
				<span>{words}</span>
			</span>
		);
	}
	if (started) {
		return (
			<Lnk to="/floor" className="inline-flex items-center gap-2">
				<Glyph kind="run" size={14} />
				Sync started
			</Lnk>
		);
	}
	if (blocked) {
		return (
			<Lnk to="/projects/$slug" params={{ slug: project.slug }} className="inline-flex items-center gap-2">
				<Glyph kind="fail" size={14} />
				Folder missing
			</Lnk>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="inline-flex items-center gap-2">
				<Glyph kind={glyph} size={14} />
				<span>{words}</span>
				<Button aria-label={`Sync ${project.name}`} disabled={pending} onClick={onSync}>
					Sync
				</Button>
			</span>
			{error && (
				<div className="min-w-[220px] whitespace-normal">
					<InlineError>{error}</InlineError>
				</div>
			)}
		</div>
	);
}

function LoadingRows() {
	return (
		<>
			<StatusLine className="text-text-muted">Loading projects</StatusLine>
			<div className="flex flex-col gap-3">
				{["a", "b", "c", "d", "e"].map((k) => (
					<Skeleton key={k} width="100%" height={36} />
				))}
			</div>
		</>
	);
}

export function ProjectsScreen() {
	const projects = useProjects();
	const workOrders = useWorkOrders();
	const shell = useShell();
	const [selected, setSelected] = useState<string[]>([]);
	const [asking, setAsking] = useState(false);
	const [startedNow, setStartedNow] = useState<string[]>([]);
	const [blockedNow, setBlockedNow] = useState<string[]>([]);
	const [done, setDone] = useState<Done | null>(null);
	const [note, setNote] = useState("");
	const [rowSlug, setRowSlug] = useState<string | null>(null);
	const banner = useRef<HTMLDivElement>(null);

	const remember = (r: SyncResult) => {
		setStartedNow((s) => [...s, ...r.started.map((x) => x.slug)]);
		setBlockedNow((s) => [
			...s.filter((x) => !r.started.some((y) => y.slug === x)),
			...r.blocked.map((x) => x.slug),
		]);
	};
	const postSync = (slugs: string[]) => api.post<SyncResult>("/api/projects/sync", { slugs });
	const bulk = useAction(postSync, {
		onSuccess: (r) => {
			remember(r);
			setDone({
				started: r.started.length,
				waiting: r.started.filter((x) => x.waiting).length,
				blocked: (projects.data ?? []).filter((p) => r.blocked.some((x) => x.slug === p.slug)),
			});
			setSelected([]);
			setAsking(false);
		},
	});
	const row = useAction(postSync, {
		onSuccess: (r) => {
			remember(r);
			const name = (slug: string) => projects.data?.find((p) => p.slug === slug)?.name ?? slug;
			setNote(
				[
					...r.started.map((x) => `Sync started for ${name(x.slug)}.`),
					...r.blocked.map((x) => `${name(x.slug)} couldn't start: ${x.reason}.`),
				].join(" "),
			);
		},
	});

	// The bar that opened the dialog is gone by now, so focus moves to the result.
	useEffect(() => {
		if (done) banner.current?.focus();
	}, [done]);

	const all = projects.data ?? [];
	const ordered = [...all.filter(isActive), ...all.filter((p) => !isActive(p))];
	const isStarted = (p: Project) => startedNow.includes(p.slug) || !!openSync(workOrders.data, p.slug);
	const isBlocked = (p: Project) => blockedNow.includes(p.slug) && p.folderMissing && !isStarted(p);
	const isIdle = (p: Project) => p.toolkit.status === "behind" && !isStarted(p) && !isBlocked(p);
	const idle = all.filter(isIdle);
	const chosen = idle.filter((p) => selected.includes(p.slug));
	const n = chosen.length;
	const toggle = (slug: string) =>
		setSelected((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));

	const free = Math.max(0, (shell.data?.agents.limit ?? 0) - (shell.data?.agents.working ?? 0));
	const doneText = done && doneWords(done);
	const sub = projects.data
		? `${plural(all.length, "project")}${idle.length ? ` · ${idle.length} behind on the toolkit` : ""}`
		: undefined;

	return (
		<Page>
			<PageHeader
				title="Projects"
				summary={sub}
				actions={
					<>
						{n === 0 && idle.length > 1 && (
							<Button onClick={() => setSelected(idle.map((p) => p.slug))}>
								Select {idle.length} behind
							</Button>
						)}
						<ButtonLink
							variant={n === 0 ? "primary" : "secondary"}
							to="/projects/new/$step"
							params={{ step: "describe" }}
						>
							New project
						</ButtonLink>
					</>
				}
			/>
			<StatusLine className="contents">
				{doneText && (
					<div
						ref={banner}
						tabIndex={-1}
						className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-solid border-border-subtle bg-bg-surface px-4 py-3"
					>
						<Glyph kind="run" />
						<div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
							<strong className="font-semibold">{doneText.title}</strong>
							<span className="text-text-muted">{doneText.body}</span>
						</div>
						<div className="flex flex-wrap gap-2">
							{done.blocked.map((p) => (
								<ButtonLink key={p.slug} to="/projects/$slug" params={{ slug: p.slug }}>
									Fix {p.name}
								</ButtonLink>
							))}
							<ButtonLink to="/floor">See the floor</ButtonLink>
						</div>
					</div>
				)}
			</StatusLine>
			<StatusLine className="sr-only">{note}</StatusLine>

			{projects.isLoading && <LoadingRows />}
			{projects.isError && (
				<InlineError>Couldn't load your projects. {(projects.error as Error).message}</InlineError>
			)}
			{projects.data && (
				<div className="overflow-x-auto">
					<table className="w-full border-collapse">
						<thead>
							<tr>
								<th scope="col" className="w-9 border-0 border-b border-solid border-border-subtle">
									<span className="sr-only">Select</span>
								</th>
								<th scope="col" className={`${HEAD} text-start`}>
									Project
								</th>
								<th scope="col" className={`${HEAD} text-end`}>
									Work orders
								</th>
								<th scope="col" className={`${HEAD} text-end`}>
									PRs
								</th>
								<th scope="col" className={`${HEAD} text-end`}>
									Errors
								</th>
								<th scope="col" className={`${HEAD} text-start`}>
									Toolkit
								</th>
								<th scope="col" className={`${HEAD} text-start`}>
									Last deploy
								</th>
							</tr>
						</thead>
						<tbody>
							{ordered.map((p) => {
								const repoName = p.repo.split("/")[1] ?? p.repo;
								return (
									<tr key={p.slug}>
										<td className="w-9 border-0 border-b border-solid border-border-subtle p-0 ps-1">
											{isIdle(p) && (
												<label className="flex min-h-row w-9 flex-none cursor-pointer items-center justify-center">
													<input
														type="checkbox"
														aria-label={`Select ${p.name}`}
														checked={selected.includes(p.slug)}
														onChange={() => toggle(p.slug)}
													/>
												</label>
											)}
										</td>
										<th scope="row" className={`${CELL} min-w-[140px] text-start font-medium`}>
											<Lnk
												to="/projects/$slug"
												params={{ slug: p.slug }}
												className="[overflow-wrap:anywhere]"
											>
												{p.name}
											</Lnk>
											{repoName !== p.name && (
												<div className="font-mono text-data font-normal text-text-muted [overflow-wrap:anywhere]">
													{repoName}
												</div>
											)}
										</th>
										<td className={NUM}>
											<Mono>{p.openWorkOrders}</Mono>
										</td>
										<td className={NUM}>
											<Mono>{p.openPrs}</Mono>
										</td>
										<td className={NUM}>
											<Mono>{p.sentryProject ? p.openErrors : "–"}</Mono>
										</td>
										<td className={`${CELL} whitespace-nowrap`}>
											<ToolkitCell
												project={p}
												started={isStarted(p)}
												blocked={isBlocked(p)}
												pending={row.pending && rowSlug === p.slug}
												error={rowSlug === p.slug ? failed("sync", row.error) : null}
												onSync={() => {
													setRowSlug(p.slug);
													void row.run([p.slug]);
												}}
											/>
										</td>
										<td className={`${CELL} whitespace-nowrap text-text-muted`}>{ago(p.lastDeployAt)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{n > 0 && (
				<BulkBar count={n} onClear={() => setSelected([])}>
					<Button variant="primary" onClick={() => setAsking(true)}>
						Sync {plural(n, "project")}
					</Button>
				</BulkBar>
			)}

			<ConfirmDialog
				open={asking}
				onOpenChange={(next) => {
					setAsking(next);
					if (!next) bulk.clearError();
				}}
				title={n === 1 ? `Sync ${chosen[0]?.name}?` : `Start ${n} sync work orders?`}
				description={
					<div className="flex flex-col gap-4">
						<ul className="m-0 flex list-none flex-col gap-1 p-0">
							{chosen.map((p) => (
								<li key={p.slug} className="flex flex-wrap gap-2">
									<span className="font-medium text-text-primary">{p.name}</span>
									<span>{behindWords(p.toolkit.behindDays)}</span>
								</li>
							))}
						</ul>
						<p className="m-0">{slotsLine(n, free, !!shell.data?.line.stopped)}</p>
					</div>
				}
				action={n === 1 ? "Start work order" : `Start ${n} work orders`}
				actionVariant="primary"
				onAction={() => void bulk.run(chosen.map((p) => p.slug))}
				pending={bulk.pending}
				error={failed("start", bulk.error)}
			/>
		</Page>
	);
}
