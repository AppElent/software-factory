import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import type {
	DeployRun,
	EnvironmentConfig,
	EnvironmentView,
	EnvSuggestion,
	Mode,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { FixButton, fixLabel, useCopyCommand } from "../fix.tsx";
import { ago, plural, span } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonLink,
	CodeBlock,
	ConfirmDialog,
	Facts,
	Field,
	FormDialog,
	Glyph,
	type GlyphKind,
	InlineError,
	LnkOut,
	LoadFailed,
	Page,
	PageHeader,
	Pane,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { ChosenNote, ProjectPicker, useChosenProjects } from "../project-picker.tsx";
import { useAction, useEnvironments, useProject, useProjectEnvironments, useQueue } from "../queries.ts";

const envKey = (e: Pick<EnvironmentView, "project" | "name">) => `${e.project}:${e.name}`;

/* ---------- words for an environment's state ---------- */

const deploying = (e: EnvironmentView) => e.deploy?.state === "running";

export function statusOf(e: EnvironmentView): { glyph: GlyphKind; word: string } {
	if (deploying(e)) return { glyph: "run", word: "Deploying" };
	switch (e.health.state) {
		case "down":
			return { glyph: "fail", word: `Down ${span(e.health.downSince)}` };
		case "slow":
			return { glyph: "ask", word: "Slow" };
		case "up":
			return { glyph: "pass", word: "Up" };
		default:
			return { glyph: "idle", word: "Not checked" };
	}
}

const commitWord = (e: EnvironmentView) => {
	if (deploying(e)) return "going out";
	if (e.behind === null) return null;
	return e.behind === 0 ? "up to date" : `${e.behind} behind main`;
};

const Sha = ({ sha }: { sha: string | null }) => <>{sha ? sha.slice(0, 7) : "–"}</>;

function Errors({ e }: { e: EnvironmentView }) {
	if (e.errors === 0) return <span className="font-mono text-data">0</span>;
	return (
		<Link
			to="/errors"
			search={{ projects: e.project }}
			className="lnk inline-flex items-center gap-1 font-mono text-data"
		>
			<Glyph kind="err" size={12} /> {e.errors}
		</Link>
	);
}

function Issues({ e }: { e: EnvironmentView }) {
	return (
		<Link to="/issues" search={{ projects: e.project }} className="lnk font-mono text-data">
			{e.issues}
		</Link>
	);
}

const urlText = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/* ---------- actions ---------- */

export const envBody = (e: Pick<EnvironmentView, "project" | "name" | "projectName">) => ({
	project: e.project,
	type: "Bug fix",
	description: `Fix ${e.projectName} ${e.name}`,
	source: { kind: "environment", fingerprint: `env:${e.project}:${e.name}` },
});

const envRef = (e: EnvironmentView) => ({ project: e.project, env: e.name });

const confirmOnProduction = (e: EnvironmentView) => (mode: Mode) =>
	mode.merge === "factory" && e.production
		? {
				title: `${mode.name} on ${e.name}?`,
				description:
					"The factory merges the fix as soon as its gates pass, without you reading it. Stopping the line still stops it.",
				action: `Start with ${mode.name}`,
			}
		: null;

export function DeployActions({
	e,
	folder,
	filled,
	grow,
	again,
}: {
	e: EnvironmentView;
	folder: string | null;
	filled?: boolean;
	grow?: boolean;
	again?: boolean;
}) {
	const [asking, setAsking] = useState(false);
	const { copy, view } = useCopyCommand();
	const deploy = useAction(
		(confirmed: boolean) => api.post("/api/environments/deploy", { ...envRef(e), confirmed }),
		{ onSuccess: () => setAsking(false) },
	);
	const stop = useAction(() => api.post("/api/environments/stop", envRef(e)));
	if (deploying(e))
		return (
			<div className="flex flex-col gap-2">
				<Button grow disabled={stop.pending} onClick={() => void stop.run()}>
					Stop deploy
				</Button>
				<InlineError>{stop.error}</InlineError>
			</div>
		);
	if (!e.deployCommand) return <p className="m-0 text-meta text-text-muted">No deploy command yet.</p>;
	const label = again ? "Deploy again" : "Deploy";
	const command = e.deployCommand;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				<Button
					variant={filled ? "primary" : "secondary"}
					grow={grow ?? true}
					disabled={deploy.pending}
					className="flex-1"
					onClick={() => (e.production ? setAsking(true) : void deploy.run(false))}
				>
					{label}
				</Button>
				<Button
					onClick={() =>
						void copy(async () =>
							folder ? `cd '${folder.replaceAll("'", `'\\''`)}' && ${command}` : command,
						)
					}
				>
					Copy command
				</Button>
			</div>
			{view}
			{!asking && <InlineError>{deploy.error}</InlineError>}
			<ConfirmDialog
				open={asking}
				onOpenChange={setAsking}
				title={`Deploy to ${e.name}?`}
				action={label}
				actionVariant="primary"
				pending={deploy.pending}
				error={deploy.error}
				onAction={() => void deploy.run(true)}
			>
				<p className="m-0">
					{folder ? `This runs in ${folder}, on what's checked out there:` : "This runs:"}
				</p>
				<CodeBlock>{command}</CodeBlock>
			</ConfirmDialog>
		</div>
	);
}

export function CheckNow({ e, grow }: { e: EnvironmentView; grow?: boolean }) {
	const check = useAction(() => api.post("/api/environments/check", envRef(e)));
	if (!e.healthUrl) return null;
	return (
		<span className={grow ? "flex flex-1 flex-col gap-1" : "inline-flex flex-col gap-1"}>
			<Button grow={grow} disabled={check.pending} onClick={() => void check.run()}>
				Check now
			</Button>
			<InlineError>{check.error}</InlineError>
		</span>
	);
}

export function FixEnvironment({ e }: { e: EnvironmentView }) {
	const navigate = useNavigate();
	const queue = useQueue();
	const atLimit = !!queue.data?.limits.startBlock;
	const start = useAction(
		({ mode, confirmed }: { mode: Mode | null; confirmed: boolean }) =>
			api.post<{ id: number }>("/api/work-orders", { ...envBody(e), mode: mode?.id, confirmed }),
		{ onSuccess: ({ id }) => void navigate({ to: "/work-orders/$id", params: { id: String(id) } }) },
	);
	if (e.workOrderId)
		return (
			<ButtonLink to="/work-orders/$id" params={{ id: String(e.workOrderId) }} grow>
				Open WO-{e.workOrderId}
			</ButtonLink>
		);
	return (
		<div className="flex flex-col gap-2">
			<FixButton
				grow
				label={(mode) => fixLabel(1, mode, atLimit)}
				pending={start.pending}
				run={(mode, confirmed) => void start.run({ mode, confirmed })}
				confirm={confirmOnProduction(e)}
				commands={() => [envBody(e)]}
			/>
			<InlineError>{start.error}</InlineError>
		</div>
	);
}

/* ---------- fleet ---------- */

const CELL =
	"box-border block min-h-row w-full cursor-pointer rounded-sm border-0 bg-transparent px-3 py-2 text-start";

function Cell({ e, selected, onOpen }: { e: EnvironmentView; selected: boolean; onOpen: () => void }) {
	const { glyph, word } = statusOf(e);
	const down = e.health.state === "down";
	const elapsed = deploying(e) ? span(e.deploy?.startedAt) : null;
	const behind = e.behind ? `${e.behind} behind` : e.behind === 0 ? "up to date" : null;
	const detail = down
		? e.health.status
			? `HTTP ${e.health.status}`
			: e.health.error
		: elapsed
			? elapsed
			: e.health.state === "not_checked" && !e.healthUrl
				? "No health URL"
				: behind;
	return (
		<button
			type="button"
			aria-pressed={selected}
			aria-label={`${e.projectName} ${e.name}: ${word}`}
			onClick={onOpen}
			className={`${CELL} hover-row ${selected ? "bg-bg-raised" : ""}`}
		>
			<span className="flex items-center gap-2">
				<Glyph kind={glyph} size={14} /> {word}
			</span>
			<span className="flex flex-wrap items-center gap-1 text-meta text-text-muted">
				{detail}
				{e.errors > 0 && (
					<>
						{detail && " · "}
						<Glyph kind="err" size={12} /> {plural(e.errors, "error")}
					</>
				)}
			</span>
		</button>
	);
}

function FleetPane({ e, folder }: { e: EnvironmentView; folder: string | null }) {
	const { glyph } = statusOf(e);
	const down = e.health.state === "down";
	const after =
		down && e.deployedAt && e.health.downSince
			? Math.round((Date.parse(e.health.downSince) - Date.parse(e.deployedAt)) / 60_000)
			: null;
	return (
		<Pane>
			<div>
				<h2 className="m-0 text-detail-title">
					{e.projectName}, {e.name.toLowerCase()}
				</h2>
				<p className="m-0 mt-1 flex items-baseline gap-2">
					<Glyph kind={glyph} size={14} />
					<span>
						{down
							? `Down for ${span(e.health.downSince)}. ${e.health.error ?? ""}`
							: deploying(e)
								? `Deploying for ${span(e.deploy?.startedAt)}.`
								: e.health.state === "not_checked"
									? e.healthUrl
										? "Not checked yet."
										: "No health URL, so nothing checks this."
									: `${statusOf(e).word}, ${e.health.ms} ms. Checked ${ago(e.health.checkedAt)}.`}
					</span>
				</p>
			</div>
			<EnvFacts e={e} />
			{down && e.production && (
				<p className="m-0 text-text-muted">
					This also tops the queue.
					{after !== null && after >= 0 ? ` It went down ${after}m after the last deploy.` : ""}
				</p>
			)}
			{deploying(e) && e.deploy && <DeployLog run={e.deploy} />}
			{down && <FixEnvironment e={e} />}
			<DeployActions e={e} folder={folder} again={down} />
			<div className="flex flex-wrap gap-2">
				<CheckNow e={e} grow />
				<ButtonLink to="/projects/$slug/environments" params={{ slug: e.project }} grow>
					Open project page
				</ButtonLink>
			</div>
		</Pane>
	);
}

function EnvFacts({ e }: { e: EnvironmentView }) {
	const word = commitWord(e);
	const sha = deploying(e) ? e.deploy?.sha : e.deployedSha;
	return (
		<Facts
			rows={[
				[
					"Commit",
					<>
						<Sha sha={sha ?? null} />
						{word ? ` · ${word}` : ""}
					</>,
					true,
				],
				...(e.deployedAt && !deploying(e)
					? ([["Deployed", ago(e.deployedAt), true]] as [string, string, boolean][])
					: []),
				["Errors", <Errors key="e" e={e} />],
				["Issues", <Issues key="i" e={e} />],
				...(e.url
					? ([
							[
								"URL",
								<LnkOut key="u" href={e.url} className="font-mono text-data [overflow-wrap:anywhere]">
									{urlText(e.url)}
								</LnkOut>,
							],
						] as [string, React.ReactNode][])
					: []),
			]}
		/>
	);
}

export function EnvironmentsScreen() {
	const { select } = useSearch({ from: "/shell/environments" });
	const navigate = useNavigate();
	const q = useEnvironments();
	const [chosen] = useChosenProjects();
	if (q.isError && !q.data)
		return (
			<Page>
				<PageHeader title="Environments" />
				<LoadFailed what="environments" error={q.error} />
			</Page>
		);
	if (!q.data)
		return (
			<Page>
				<PageHeader title="Environments" />
				<StatusLine className="text-text-muted">Loading environments</StatusLine>
				<Skeleton width="100%" height={120} />
			</Page>
		);
	const { names, checkedAt } = q.data;
	const projects = q.data.projects.filter((p) => chosen.length === 0 || chosen.includes(p.slug));
	const configured = projects.filter((p) => p.environments.length > 0);
	const listed = configured.flatMap((p) => p.environments);
	const down = listed.filter((e) => e.health.state === "down").length;
	const behind = listed.filter((e) => (e.behind ?? 0) > 0).length;
	if (configured.length === 0)
		return (
			<Page>
				<PageHeader title="Environments" actions={<ProjectPicker />} />
				<ChosenNote />
				<div className="flex max-w-[560px] flex-col items-start gap-2 pt-8">
					<h2 className="m-0 text-detail-title">No environments yet</h2>
					<p className="m-0 text-text-muted">
						Add them per project. Each gets a health check, a deploy button and its own errors and issues.
					</p>
					{projects.length > 0 && (
						<div className="flex flex-wrap gap-2 pt-2">
							{projects.slice(0, 6).map((p) => (
								<ButtonLink key={p.slug} to="/projects/$slug/environments" params={{ slug: p.slug }}>
									{p.name}
								</ButtonLink>
							))}
						</div>
					)}
				</div>
			</Page>
		);
	const summary = [
		down > 0 && `${down} down`,
		behind > 0 && `${behind} behind main`,
		checkedAt && `checked ${ago(checkedAt)}`,
	]
		.filter(Boolean)
		.join(", ");
	const every = listed;
	const current =
		every.find((e) => envKey(e) === select) ?? every.find((e) => e.health.state === "down") ?? null;
	const open = (e: EnvironmentView) =>
		void navigate({ to: "/environments", search: { select: envKey(e) }, replace: true });
	return (
		<Page pane={current ? <FleetPane e={current} folder={current.folder} /> : undefined}>
			<PageHeader title="Environments" summary={summary || "All up"} actions={<ProjectPicker />} />
			<ChosenNote />
			<div className="overflow-x-auto">
				<table className="w-full min-w-[560px] border-collapse">
					<thead>
						<tr className="text-meta text-text-muted">
							<th scope="col" className="px-3 py-2 text-start font-normal">
								Project
							</th>
							{names.map((n) => (
								<th key={n} scope="col" className="px-3 py-2 text-start font-normal">
									{n}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{configured.map((p) => (
							<tr key={p.slug} className="border-0 border-t border-solid border-border-subtle">
								<th scope="row" className="px-3 py-2 text-start align-middle font-medium">
									<Link to="/projects/$slug/environments" params={{ slug: p.slug }} className="lnk lnk-muted">
										{p.name}
									</Link>
								</th>
								{names.map((n) => {
									const e = p.environments.find((x) => x.name === n);
									return (
										<td key={n} className="p-0 align-top">
											{e ? (
												<Cell
													e={e}
													selected={current ? envKey(current) === envKey(e) : false}
													onOpen={() => open(e)}
												/>
											) : (
												<Link
													to="/projects/$slug/environments"
													params={{ slug: p.slug }}
													search={{ edit: true }}
													className={`${CELL} hover-row`}
												>
													<span className="flex items-center gap-2">
														<Glyph kind="idle" size={14} /> Not set up
													</span>
													<span className="text-meta text-text-muted">Add environment</span>
												</Link>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Page>
	);
}

/* ---------- project page ---------- */

export function ProjectTabs({ slug, current }: { slug: string; current: "overview" | "environments" }) {
	const tab = (on: boolean) =>
		`flex min-h-9 items-center rounded-sm px-3 ${on ? "bg-bg-active font-semibold" : "hover-row text-text-muted"}`;
	return (
		<nav aria-label="Project" className="flex flex-wrap gap-1">
			<Link
				to="/projects/$slug"
				params={{ slug }}
				aria-current={current === "overview" ? "page" : undefined}
				className={tab(current === "overview")}
			>
				Overview
			</Link>
			<Link
				to="/projects/$slug/environments"
				params={{ slug }}
				aria-current={current === "environments" ? "page" : undefined}
				className={tab(current === "environments")}
			>
				Environments
			</Link>
		</nav>
	);
}

function DeployLog({ run }: { run: DeployRun }) {
	return (
		<div role="log" aria-label="Deploy log">
			<pre className="m-0 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm bg-bg-canvas p-3 font-mono text-data [overflow-wrap:anywhere]">
				{run.log}
			</pre>
		</div>
	);
}

function EnvColumn({ e, folder }: { e: EnvironmentView; folder: string | null }) {
	const { glyph, word } = statusOf(e);
	const failed = e.deploy?.state === "failed" && !deploying(e);
	const down = e.health.state === "down";
	return (
		<section aria-label={e.name} className="flex min-w-0 flex-col gap-3 rounded-md bg-bg-surface p-4">
			<div className="flex items-baseline gap-2">
				<h2 className="m-0 text-detail-title">{e.name}</h2>
				<span className="ms-auto flex items-baseline gap-1.5">
					<Glyph kind={glyph} size={14} />
					{word}
					<span className="font-mono text-data text-text-muted">
						{deploying(e)
							? span(e.deploy?.startedAt)
							: e.health.ms !== null && !down
								? `${e.health.ms} ms`
								: ""}
					</span>
				</span>
			</div>
			{down && <p className="m-0 text-text-muted">{e.health.error}</p>}
			<EnvFacts e={e} />
			{deploying(e) && e.deploy ? (
				<DeployLog run={e.deploy} />
			) : failed && e.deploy ? (
				<>
					<p className="m-0 flex items-baseline gap-2">
						<Glyph kind="fail" size={14} /> The last deploy failed
						{e.deploy.exitCode !== null ? ` with exit code ${e.deploy.exitCode}` : ""}.
					</p>
					{e.deploy.message && <p className="m-0 text-meta text-text-muted">{e.deploy.message}</p>}
					<DeployLog run={e.deploy} />
				</>
			) : (
				e.deployCommand && (
					<code className="block rounded-sm bg-bg-canvas p-3 font-mono text-data [overflow-wrap:anywhere]">
						{e.deployCommand}
					</code>
				)
			)}
			<div className="mt-auto flex flex-col gap-2">
				{down && <FixEnvironment e={e} />}
				<DeployActions e={e} folder={folder} filled={!down && e.production && (e.behind ?? 0) > 0} />
				{e.production && e.deployCommand && !deploying(e) && (
					<p className="m-0 text-meta text-text-muted">
						Asks you to confirm first. One deploy at a time per environment.
					</p>
				)}
				<CheckNow e={e} />
			</div>
		</section>
	);
}

const DEPLOY_GLYPH: Record<DeployRun["state"], GlyphKind> = {
	running: "run",
	passed: "pass",
	failed: "fail",
	stopped: "idle",
};
const DEPLOY_WORD: Record<DeployRun["state"], string> = {
	running: "Running",
	passed: "Passed",
	failed: "Failed",
	stopped: "Stopped",
};

const blank = (): EnvironmentConfig => ({
	name: "",
	url: null,
	healthUrl: null,
	deployCommand: null,
	sentryEnvironment: null,
	issueLabel: null,
	production: false,
});

/** A name changes as you type, so a row needs its own key. */
type Row = EnvironmentConfig & { key: number };
let nextKey = 0;
const keyed = (e: EnvironmentConfig): Row => {
	nextKey += 1;
	return { ...e, key: nextKey };
};

const orNull = (v: string) => v.trim() || null;

function EditEnvironments({
	slug,
	current,
	configPath,
	onClose,
}: {
	slug: string;
	current: EnvironmentConfig[];
	configPath: string;
	onClose: () => void;
}) {
	const [rows, setRows] = useState<Row[]>(() => (current.length ? current : [blank()]).map(keyed));
	const save = useAction(
		(environments: EnvironmentConfig[]) =>
			api.put(`/api/projects/${encodeURIComponent(slug)}/environments`, { environments }),
		{ onSuccess: onClose },
	);
	const suggest = useAction(() =>
		api.get<EnvSuggestion[]>(`/api/projects/${encodeURIComponent(slug)}/environments/suggest`),
	);
	const [found, setFound] = useState<EnvSuggestion[] | null>(null);
	const set = (i: number, patch: Partial<EnvironmentConfig>) =>
		setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
	const clean = rows.filter((r) => r.name.trim()).map(({ key: _key, ...e }) => e);
	const unnamed = rows.some((r) => !r.name.trim() && (r.deployCommand || r.url || r.healthUrl));
	return (
		<FormDialog open onOpenChange={(o) => !o && onClose()} title="Edit environments" width={720}>
			<p className="m-0 text-text-muted">
				Saved in <span className="font-mono text-data [overflow-wrap:anywhere]">{configPath}</span>, so they
				survive without this app's database.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={suggest.pending} onClick={() => void suggest.run().then((s) => s && setFound(s))}>
					Look in the repo
				</Button>
				<span className="text-meta text-text-muted">
					Shows what it finds. Nothing runs or saves until you do.
				</span>
			</div>
			<InlineError>{suggest.error}</InlineError>
			{found?.length === 0 && <p className="m-0 text-text-muted">Nothing new found in this repo.</p>}
			{found?.map((s) => (
				<div key={s.name} className="flex flex-wrap items-center gap-3 rounded-sm bg-bg-raised p-3">
					<div className="min-w-0 flex-1">
						<div className="font-medium">{s.name}</div>
						<div className="font-mono text-data [overflow-wrap:anywhere]">
							{s.deployCommand ?? "No deploy command found"}
						</div>
						<div className="text-meta text-text-muted">From {s.from}</div>
					</div>
					<Button
						onClick={() => {
							setRows((r) => [
								...r.filter((x) => x.name.trim()),
								keyed({ ...blank(), name: s.name, deployCommand: s.deployCommand, production: s.production }),
							]);
							setFound((f) => f?.filter((x) => x !== s) ?? null);
						}}
					>
						Add {s.name}
					</Button>
				</div>
			))}
			{rows.map((r, i) => (
				<fieldset
					key={r.key}
					className="m-0 flex flex-col gap-3 rounded-sm border border-solid border-border-subtle p-3"
				>
					<legend className="px-1 font-medium">{r.name || "New environment"}</legend>
					<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
						<Field label="Name">
							{(p) => (
								<input
									{...p}
									className="sf-input"
									value={r.name}
									onChange={(e) => set(i, { name: e.target.value })}
								/>
							)}
						</Field>
						<Field label="URL">
							{(p) => (
								<input
									{...p}
									className="sf-input"
									value={r.url ?? ""}
									onChange={(e) => set(i, { url: orNull(e.target.value) })}
								/>
							)}
						</Field>
						<Field label="Health URL" hint="Checked every minute. Leave empty to skip.">
							{(p) => (
								<input
									{...p}
									className="sf-input"
									value={r.healthUrl ?? ""}
									onChange={(e) => set(i, { healthUrl: orNull(e.target.value) })}
								/>
							)}
						</Field>
						<Field label="Sentry environment" hint={`Default: ${r.name.toLowerCase() || "the name"}`}>
							{(p) => (
								<input
									{...p}
									className="sf-input"
									value={r.sentryEnvironment ?? ""}
									onChange={(e) => set(i, { sentryEnvironment: orNull(e.target.value) })}
								/>
							)}
						</Field>
						<Field label="Issue label" hint={`Default: env:${r.name.toLowerCase() || "name"}`}>
							{(p) => (
								<input
									{...p}
									className="sf-input"
									value={r.issueLabel ?? ""}
									onChange={(e) => set(i, { issueLabel: orNull(e.target.value) })}
								/>
							)}
						</Field>
					</div>
					<Field
						label="Deploy command"
						hint="Runs in the project's folder, in a shell, on what's checked out there, when you press Deploy."
					>
						{(p) => (
							<textarea
								{...p}
								rows={2}
								className="sf-input font-mono text-data"
								value={r.deployCommand ?? ""}
								onChange={(e) => set(i, { deployCommand: orNull(e.target.value) })}
							/>
						)}
					</Field>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={r.production}
								onChange={(e) => set(i, { production: e.target.checked })}
							/>
							Production: ask before deploying, and tops the queue when down
						</label>
						<Button onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>
							Remove {r.name || "this"}
						</Button>
					</div>
				</fieldset>
			))}
			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={() => setRows((r) => [...r, keyed(blank())])}>Add environment</Button>
				<span className="ms-auto flex flex-wrap gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button variant="primary" disabled={save.pending || unnamed} onClick={() => void save.run(clean)}>
						Save environments
					</Button>
				</span>
			</div>
			<InlineError>{save.error ?? (unnamed ? "Give each environment a name to save." : null)}</InlineError>
		</FormDialog>
	);
}

export function ProjectEnvironmentsScreen() {
	const { slug } = useParams({ from: "/shell/projects/$slug/environments" });
	const { edit } = useSearch({ from: "/shell/projects/$slug/environments" });
	const project = useProject(slug);
	const q = useProjectEnvironments(slug);
	const [editing, setEditing] = useState(!!edit);
	const name = project.data?.name ?? slug;
	const crumbs = <Breadcrumb crumbs={[{ label: "Projects", link: { to: "/projects" } }, { label: name }]} />;
	if (q.isError && !q.data)
		return (
			<Page>
				{crumbs}
				<LoadFailed what="environments" error={q.error} />
			</Page>
		);
	if (!q.data)
		return (
			<Page>
				{crumbs}
				<StatusLine className="text-text-muted">Loading environments</StatusLine>
				<Skeleton width="100%" height={160} />
			</Page>
		);
	const { environments, deploys, configPath, folder } = q.data;
	return (
		<Page>
			{crumbs}
			<PageHeader
				title={name}
				actions={<Button onClick={() => setEditing(true)}>Edit environments</Button>}
			/>
			<ProjectTabs slug={slug} current="environments" />
			{environments.length > 0 && !folder && (
				<Banner glyph="ask" title="This project has no folder on this Mac, so Deploy can't run here." />
			)}
			{environments.length === 0 ? (
				<div className="flex max-w-[560px] flex-col items-start gap-2 pt-4">
					<h2 className="m-0 text-detail-title">No environments yet</h2>
					<p className="m-0 text-text-muted">
						Add one with a deploy command and a health URL. The factory can look in the repo for you.
					</p>
					<Button onClick={() => setEditing(true)}>Add environment</Button>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
					{environments.map((e) => (
						<EnvColumn key={e.name} e={e} folder={folder} />
					))}
				</div>
			)}
			{deploys.length > 0 && (
				<section aria-label="Deploy history" className="flex flex-col gap-2">
					<SectionLabel>Deploy history</SectionLabel>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[560px] border-collapse">
							<tbody>
								{deploys.map((d) => (
									<tr key={d.id} className="border-0 border-t border-solid border-border-subtle">
										<td className="px-3 py-2 text-text-muted">{d.env}</td>
										<td className="px-3 py-2 font-mono text-data">{d.sha ? d.sha.slice(0, 7) : "–"}</td>
										<td className="px-3 py-2 [overflow-wrap:anywhere]">{d.message ?? d.command}</td>
										<td className="px-3 py-2 font-mono text-data text-text-muted">{span(d.startedAt)}</td>
										<td className="px-3 py-2">
											<span className="flex items-center gap-2">
												<Glyph kind={DEPLOY_GLYPH[d.state]} size={14} /> {DEPLOY_WORD[d.state]}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}
			{editing && (
				<EditEnvironments
					slug={slug}
					current={environments.map(
						({ name, url, healthUrl, deployCommand, sentryEnvironment, issueLabel, production }) => ({
							name,
							url,
							healthUrl,
							deployCommand,
							sentryEnvironment,
							issueLabel,
							production,
						}),
					)}
					configPath={configPath}
					onClose={() => setEditing(false)}
				/>
			)}
		</Page>
	);
}
