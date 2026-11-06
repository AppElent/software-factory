import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
	ErrorItem,
	ProjectDetail,
	PullRequest,
	SyncResult,
	WorkOrder,
	WorkOrderState,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, list, minutes, plural, span } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonLink,
	ButtonOut,
	ConfirmDialog,
	Facts,
	Field,
	FormDialog,
	Glyph,
	type GlyphKind,
	InlineError,
	LnkOut,
	LoadFailed,
	Mono,
	Page,
	Pane,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useProject } from "../queries.ts";
import { useOpenNewWorkOrder } from "../shell.tsx";
import { behindWords, failed, openSync, toolkitWords } from "./projects.tsx";

/* ---------- words ---------- */

/** Home folders read better as ~. */
const tilde = (path: string) => path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");

const WORK_ORDER_WORDS: Record<WorkOrderState, [GlyphKind, string]> = {
	waiting: ["idle", "Intake · idea"],
	planning: ["run", "Plan · agent writing"],
	plan_ready: ["ask", "Plan · waiting on you"],
	plan_approved: ["idle", "Plan · approved"],
	building: ["run", "Build · agent working"],
	build_done: ["idle", "Build · finished"],
	question: ["ask", "Waiting for your answer"],
	waiting_in_t3: ["ask", "Waiting in T3"],
	run_failed: ["fail", "This run failed"],
	verifying: ["run", "Verify · gates running"],
	retrying: ["run", "Verify · agent fixing a gate"],
	failed: ["fail", "Verify · gates failed"],
	ready: ["ask", "Review · waiting on you"],
	rebasing: ["run", "Review · agent rebasing"],
	shipping: ["run", "Ship · deploying"],
	observing: ["pass", "Observe · watching for errors"],
	done: ["pass", "Done"],
	closed: ["idle", "Closed"],
};

function workOrderWords(w: WorkOrder): [GlyphKind, string] {
	if (w.state === "failed" && w.failedGate) return ["fail", `Verify · ${w.failedGate} failed`];
	return WORK_ORDER_WORDS[w.state];
}

function prWords(pr: PullRequest): [GlyphKind, string] {
	const gate = Object.entries(pr.gates).find(([, state]) => state === "failed")?.[0];
	switch (pr.group) {
		case "ready":
			return ["ask", "Ready to merge"];
		case "failed":
			return ["fail", gate ? `${gate} failed` : "Gate failed"];
		case "running":
			return ["run", "Checks running"];
		case "rebase":
			return ["idle", "Needs rebase"];
		default:
			return ["idle", "Stale"];
	}
}

const ERROR_KIND = { new: "New", regression: "Regression", ongoing: "Ongoing" } as const;

const errorWords = (e: ErrorItem) => `${ERROR_KIND[e.kind]} · ${plural(e.users, "user")}`;

/** "1 plan and 2 errors need you". */
function summary(p: ProjectDetail): string {
	if (p.folderMissing) return "Work orders can't start";
	const states = (...s: WorkOrderState[]) => p.workOrders.filter((w) => s.includes(w.state)).length;
	const counts: Array<[number, string]> = [
		[states("plan_ready"), "plan"],
		[states("question", "waiting_in_t3"), "question"],
		[states("failed", "run_failed"), "failed work order"],
		[p.prs.filter((pr) => pr.group === "ready").length, "PR"],
		[p.errors.filter((e) => !e.triage).length, "error"],
	];
	const parts = counts.filter(([n]) => n > 0).map(([n, one]) => plural(n, one));
	if (parts.length) {
		const total = counts.reduce((sum, [n]) => sum + n, 0);
		return `${list(parts)} ${total === 1 ? "needs" : "need"} you`;
	}
	return p.workOrders.length + p.prs.length + p.errors.length ? "Nothing needs you" : "Nothing open";
}

/* ---------- rows ---------- */

function Row({
	link,
	glyph,
	id,
	title,
	status,
	age,
}: {
	link: { to: string; params: Record<string, string> };
	glyph: GlyphKind;
	id: ReactNode;
	title: string;
	status: string;
	age?: string;
}) {
	return (
		<Link
			to={link.to}
			params={link.params as never}
			className="hover-row flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-1.5"
		>
			<Glyph kind={glyph} />
			<Mono className="text-text-muted">{id}</Mono>
			<span className="min-w-0 flex-[1_1_220px] font-medium [overflow-wrap:anywhere]">{title}</span>
			<span className="text-meta text-text-muted">{status}</span>
			{age && (
				<span className="w-8 text-end">
					<Mono className="text-text-muted">{age}</Mono>
				</span>
			)}
		</Link>
	);
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
	const label = count ? `${title} · ${count}` : title;
	return (
		<section aria-label={label} className="flex flex-col gap-1">
			<SectionLabel>{label}</SectionLabel>
			{children}
		</section>
	);
}

const Nothing = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
	<div className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2 px-3 text-text-muted">
		<span>{children}</span>
		{action}
	</div>
);

/* ---------- dialogs ---------- */

/** One text field in a dialog. Keeps what was typed when the save fails. */
function PathDialog({
	open,
	onClose,
	title,
	label,
	hint,
	initial,
	blank,
	action,
	pending,
	error,
	onSubmit,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	label: string;
	hint: string;
	initial: string;
	blank: string;
	action: string;
	pending: boolean;
	error: string | null;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState(initial);
	const [problem, setProblem] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	return (
		<FormDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			title={title}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (!value.trim()) {
						setProblem(blank);
						input.current?.focus();
						return;
					}
					setProblem(null);
					onSubmit(value.trim());
				}}
			>
				<Field label={label} hint={hint} error={problem}>
					{(p) => (
						<input
							{...p}
							ref={input}
							type="text"
							className="w-full font-mono"
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
					)}
				</Field>
				<InlineError>{error}</InlineError>
				<div className="flex flex-wrap justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={pending}>
						{action}
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}

function RemoveDialog({
	project: p,
	open,
	onClose,
	onPause,
	pausing,
	pauseError,
}: {
	project: ProjectDetail;
	open: boolean;
	onClose: () => void;
	onPause: () => void;
	pausing: boolean;
	pauseError: string | null;
}) {
	const navigate = useNavigate();
	const remove = useAction(() => api.post(`/api/projects/${encodeURIComponent(p.slug)}/remove`), {
		onSuccess: () => void navigate({ to: "/projects" }),
	});
	const onOpenChange = (next: boolean) => {
		if (!next) onClose();
	};
	if (p.blockedRemove === "last_project") {
		return (
			<ConfirmDialog
				open={open}
				onOpenChange={onOpenChange}
				title={`${p.name} is your only project.`}
				description="Add a project first."
				extra={
					<ButtonLink to="/projects/new/$step" params={{ step: "describe" }}>
						New project
					</ButtonLink>
				}
			/>
		);
	}
	if (p.blockedRemove === "open_work") {
		const open_ = plural(p.workOrders.length, "open work order");
		return (
			<ConfirmDialog
				open={open}
				onOpenChange={onOpenChange}
				title={`${p.name} can't be removed yet`}
				description={
					p.paused
						? `It has ${open_}. Close them first.`
						: `It has ${open_}. Close them first, or pause the project so nothing new starts.`
				}
				extra={
					<ButtonLink to="/floor" search={{ project: p.slug } as never}>
						See work orders
					</ButtonLink>
				}
				action={p.paused ? undefined : "Pause project"}
				actionVariant="primary"
				onAction={onPause}
				pending={pausing}
				error={failed("pause", pauseError)}
			/>
		);
	}
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Remove ${p.name} from the factory?`}
			description={
				p.folderMissing
					? "The factory stops watching it. Your GitHub repo stays as it is. You can add it back from Settings."
					: "The factory stops watching it. Your GitHub repo, local folder, and services stay as they are. You can add it back from Settings."
			}
			action="Remove project"
			onAction={() => void remove.run()}
			pending={remove.pending}
			error={failed("remove", remove.error)}
		/>
	);
}

/* ---------- the page ---------- */

function ProjectPage({ project: p }: { project: ProjectDetail }) {
	const navigate = useNavigate();
	const openNew = useOpenNewWorkOrder();
	const path = `/api/projects/${encodeURIComponent(p.slug)}`;

	const [asking, setAsking] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [changingFolder, setChangingFolder] = useState(false);
	/** Set when the folder came back through this page. */
	const [back, setBack] = useState<{ path: string; how: "cloned" | "changed" } | null>(null);
	const [merging, setMerging] = useState<ProjectDetail["merging"] | null>(null);
	const [saved, setSaved] = useState(false);
	const [syncProblem, setSyncProblem] = useState<string | null>(null);

	const pause = useAction(() => api.post(`${path}/pause`), { onSuccess: () => setAsking(false) });
	const resume = useAction(() => api.post(`${path}/resume`));
	const clone = useAction(() => api.post<{ ok: boolean; path: string }>(`${path}/clone`), {
		onSuccess: (r) => setBack({ path: r.path, how: "cloned" }),
	});
	const changeFolder = useAction((folder: string) => api.post(`${path}/folder`, { path: folder }), {
		onSuccess: (_r, folder) => {
			setBack({ path: folder, how: "changed" });
			setChangingFolder(false);
		},
	});
	const connect = useAction((sentryProject: string) => api.post(`${path}/connect`, { sentryProject }), {
		onSuccess: () => setConnecting(false),
	});
	const setMergingOn = useAction((value: ProjectDetail["merging"]) =>
		api.post(`${path}/merging`, { merging: value }),
	);
	const sync = useAction(() => api.post<SyncResult>("/api/projects/sync", { slugs: [p.slug] }), {
		onSuccess: (r) => {
			const blocked = r.blocked[0];
			if (blocked) setSyncProblem(`${p.name} couldn't start: ${blocked.reason}.`);
			else void navigate({ to: "/floor" });
		},
	});

	// The server's answer wins as soon as it arrives.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new server value clears the local choice.
	useEffect(() => {
		setMerging(null);
	}, [p.merging]);

	const mergingNow = merging ?? p.merging;
	const chooseMerging = async (value: ProjectDetail["merging"]) => {
		setMerging(value);
		setSaved(false);
		const ok = await setMergingOn.run(value);
		if (ok) setSaved(true);
		else setMerging(null);
	};

	const missing = p.folderMissing && !back;
	const behind = p.toolkit.status === "behind";
	const running = openSync(p.workOrders, p.slug);
	const showToolkit = behind && !missing && !back;
	const startIsPrimary = !missing && !(showToolkit && !running);
	const thread = p.workOrders.find((w) => w.threadLink)?.threadLink ?? null;
	const toolkit = toolkitWords(p).words;
	const syncError = failed("start", sync.error) ?? syncProblem;

	const startSync = (variant: "primary" | "secondary") =>
		running ? (
			<ButtonLink to="/work-orders/$id" params={{ id: String(running.id) }}>
				Sync started
			</ButtonLink>
		) : (
			<Button variant={variant} disabled={sync.pending} onClick={() => void sync.run()}>
				Start sync work order
			</Button>
		);

	return (
		<Page
			pane={
				<Pane>
					<Facts
						rows={[
							[
								"Repo",
								<LnkOut key="repo" href={p.url} className="[overflow-wrap:anywhere]">
									{p.repo}
								</LnkOut>,
							],
							["Folder", p.localPath ? tilde(back?.path ?? p.localPath) : "–", true],
							["Branch", p.defaultBranch, true],
							["Toolkit", toolkit],
							["Last deploy", p.lastDeployAt ? ago(p.lastDeployAt) : "None"],
						]}
					/>
					{p.last30.shipped > 0 && (
						<PaneBlock>
							<SectionLabel>Last 30 days</SectionLabel>
							<Facts
								rows={[
									["Shipped", p.last30.shipped, true],
									["First try", `${p.last30.firstTry} of ${p.last30.shipped}`, true],
									["Median to PR", minutes(p.last30.medianToPrMinutes), true],
								]}
							/>
						</PaneBlock>
					)}
					<PaneBlock>
						<SectionLabel>Services</SectionLabel>
						<div className="flex min-h-control items-center gap-2">
							<Glyph kind={p.sentryProject ? "pass" : "idle"} size={14} />
							<span className="flex-[1_1_0]">Sentry</span>
							{p.sentryProject ? (
								<span className="text-meta text-text-muted [overflow-wrap:anywhere]">{p.sentryProject}</span>
							) : (
								<Button aria-label="Connect Sentry" onClick={() => setConnecting(true)}>
									Connect
								</Button>
							)}
						</div>
					</PaneBlock>
					<PaneBlock>
						<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
							<legend className="section-label mb-1 p-0">Merging</legend>
							<label className="flex min-h-control cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="merging"
									checked={mergingNow === "follow"}
									onChange={() => void chooseMerging("follow")}
								/>
								<span>
									Follow{" "}
									<Link className="lnk" to="/settings/$section" params={{ section: "approvals" }}>
										Settings
									</Link>
								</span>
							</label>
							<label className="flex min-h-control cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="merging"
									checked={mergingNow === "ask"}
									onChange={() => void chooseMerging("ask")}
								/>
								<span>Always ask me</span>
							</label>
						</fieldset>
						<InlineError>{failed("save", setMergingOn.error)}</InlineError>
						<StatusLine className="contents text-meta text-text-muted">
							{saved && !setMergingOn.pending && !setMergingOn.error ? "Saved" : null}
						</StatusLine>
					</PaneBlock>
					<PaneBlock>
						{!p.paused && (
							<Button grow disabled={pause.pending} onClick={() => void pause.run()}>
								Pause project
							</Button>
						)}
						{!asking && <InlineError>{failed("pause", pause.error)}</InlineError>}
						<Button variant="danger" grow onClick={() => setAsking(true)}>
							Remove from factory
						</Button>
					</PaneBlock>
				</Pane>
			}
		>
			<Breadcrumb crumbs={[{ label: "Projects", link: { to: "/projects" } }, { label: p.name }]} />
			<header className="flex flex-wrap items-start gap-x-3 gap-y-2">
				<div className="min-w-0 flex-[1_1_320px]">
					<h1 className="m-0 text-page-title [overflow-wrap:anywhere]">{p.name}</h1>
					<span className="text-text-muted">{summary(p)}</span>
				</div>
				<div className="flex flex-wrap gap-2">
					{thread && <ButtonOut href={thread}>Open in T3</ButtonOut>}
					<ButtonOut href={p.url}>GitHub</ButtonOut>
					<Button
						variant={startIsPrimary ? "primary" : "secondary"}
						onClick={() => openNew({ project: p.slug })}
					>
						Start work order
					</Button>
				</div>
			</header>

			<StatusLine className="contents">
				{p.paused && (
					<Banner
						glyph="idle"
						title="Paused"
						body="New work orders for this project wait in Intake. Work already running finishes."
						actions={
							<Button disabled={resume.pending} onClick={() => void resume.run()}>
								Resume
							</Button>
						}
					/>
				)}
				{clone.pending && (
					<Banner glyph="run" title={`Cloning ${p.repo}`} actions={<Button disabled>Cloning…</Button>} />
				)}
				{back && (
					<Banner
						glyph="pass"
						title={`${p.name} is back`}
						body={`${back.how === "cloned" ? "Now cloned to" : "Now using"} ${tilde(back.path)}. You can start work orders again.`}
						actions={behind ? startSync("secondary") : undefined}
					/>
				)}
			</StatusLine>
			<InlineError>{failed("resume", resume.error)}</InlineError>

			{missing && !clone.pending && (
				<Banner
					role="alert"
					glyph="err"
					title={`${p.name} isn't in its folder`}
					body={
						p.localPath
							? `It was at ${tilde(p.localPath)} and is gone now. Agents work from this copy, so nothing can start until it is back. The repo is safe on GitHub.`
							: "It has no folder on this Mac. Agents work from this copy, so nothing can start until it is back. The repo is safe on GitHub."
					}
					actions={
						<>
							<Button variant="primary" onClick={() => void clone.run()}>
								Clone it again
							</Button>
							<Button
								onClick={() => {
									changeFolder.clearError();
									setChangingFolder(true);
								}}
							>
								Change folder
							</Button>
						</>
					}
				/>
			)}
			<InlineError>{failed("clone", clone.error)}</InlineError>

			{showToolkit && (
				<Banner
					glyph="idle"
					title={`${behindWords(p.toolkit.behindDays)} on the toolkit`}
					body={`${plural(p.toolkit.changed, "standard")} changed in developer-tools since the last sync.`}
					actions={startSync("primary")}
				/>
			)}
			{(showToolkit || back) && <InlineError>{syncError}</InlineError>}

			<Section title="Work orders" count={p.workOrders.length}>
				{p.workOrders.length === 0 && <Nothing>None open.</Nothing>}
				{p.workOrders.map((w) => {
					const [glyph, words] = workOrderWords(w);
					return (
						<Row
							key={w.id}
							link={{ to: "/work-orders/$id", params: { id: String(w.id) } }}
							glyph={glyph}
							id={`WO-${w.id}`}
							title={w.title}
							status={words}
							age={w.state === "waiting" ? undefined : span(w.stageAt)}
						/>
					);
				})}
			</Section>

			<Section title="Pull requests" count={p.prs.length}>
				{p.prs.length === 0 && <Nothing>None open.</Nothing>}
				{p.prs.map((pr) => {
					const [glyph, words] = prWords(pr);
					return (
						<Row
							key={pr.number}
							link={{
								to: "/prs/$project/$number",
								params: { project: p.slug, number: String(pr.number) },
							}}
							glyph={glyph}
							id={`#${pr.number}`}
							title={pr.title}
							status={words}
							age={span(pr.createdAt)}
						/>
					);
				})}
			</Section>

			<Section title="Errors" count={p.errors.length}>
				{!p.sentryProject && p.folderMissing && <Nothing>Sentry isn't connected.</Nothing>}
				{!p.sentryProject && !p.folderMissing && (
					<Nothing action={<Button onClick={() => setConnecting(true)}>Connect Sentry</Button>}>
						Sentry isn't connected, so errors can't show here.
					</Nothing>
				)}
				{p.sentryProject && p.errors.length === 0 && <Nothing>None open.</Nothing>}
				{p.errors.map((e) => (
					<Row
						key={e.id}
						link={{ to: "/errors/$id", params: { id: e.id } }}
						glyph="err"
						id={e.shortId}
						title={e.title}
						status={errorWords(e)}
						age={span(e.firstSeen)}
					/>
				))}
			</Section>

			{!(p.folderMissing && p.shipped.length === 0) && (
				<Section title="Shipped recently">
					{p.shipped.length === 0 && <Nothing>Nothing shipped through the factory yet.</Nothing>}
					{p.shipped.map((w) => {
						const caused = p.errors.filter((e) => e.regressionOf?.workOrderId === w.id);
						const first = caused[0];
						return (
							<Row
								key={w.id}
								link={
									first
										? { to: "/errors/$id", params: { id: first.id } }
										: { to: "/work-orders/$id", params: { id: String(w.id) } }
								}
								glyph={first ? "err" : "pass"}
								id={`WO-${w.id}`}
								title={w.title}
								status={first ? `Caused ${plural(caused.length, "error")}` : "No new errors"}
								age={span(w.mergedAt)}
							/>
						);
					})}
				</Section>
			)}

			<RemoveDialog
				project={p}
				open={asking}
				onClose={() => {
					setAsking(false);
					pause.clearError();
				}}
				onPause={() => void pause.run()}
				pausing={pause.pending}
				pauseError={pause.error}
			/>
			<PathDialog
				open={connecting}
				onClose={() => {
					setConnecting(false);
					connect.clearError();
				}}
				title="Connect Sentry"
				label="Sentry project"
				hint="Its name in Sentry, such as fairway-web."
				initial=""
				blank="Enter the Sentry project."
				action="Connect"
				pending={connect.pending}
				error={failed("connect", connect.error)}
				onSubmit={(v) => void connect.run(v)}
			/>
			<PathDialog
				open={changingFolder}
				onClose={() => {
					setChangingFolder(false);
					changeFolder.clearError();
				}}
				title="Change folder"
				label="Folder"
				hint={`Where ${p.repo} is on this Mac. It must be a git checkout.`}
				initial={p.localPath ?? ""}
				blank="Enter the folder."
				action="Use this folder"
				pending={changeFolder.pending}
				error={failed("change", changeFolder.error)}
				onSubmit={(v) => void changeFolder.run(v)}
			/>
		</Page>
	);
}

const PaneBlock = ({ children }: { children: ReactNode }) => (
	<div className="flex flex-col gap-2 border-0 border-t border-solid border-border-subtle pt-4">
		{children}
	</div>
);

export function ProjectDetailScreen() {
	const { slug } = useParams({ from: "/shell/projects/$slug" });
	const project = useProject(slug);
	if (project.data) return <ProjectPage key={slug} project={project.data} />;
	return (
		<Page>
			<Breadcrumb crumbs={[{ label: "Projects", link: { to: "/projects" } }, { label: slug }]} />
			{project.isError ? (
				<LoadFailed what="this project" error={project.error} />
			) : (
				<>
					<StatusLine className="text-text-muted">Loading this project</StatusLine>
					<div className="flex flex-col gap-3">
						<Skeleton width="30%" height={24} />
						{["a", "b", "c", "d"].map((k) => (
							<Skeleton key={k} width="100%" height={36} />
						))}
					</div>
				</>
			)}
		</Page>
	);
}
