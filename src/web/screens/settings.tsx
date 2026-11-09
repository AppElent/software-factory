import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
	type AgentSettings,
	type ApprovalSettings,
	type NotificationEvent,
	type NotificationSettings,
	type ProjectSettings,
	type ToolStatus,
	WORK_TYPES,
	type WorkType,
	type WorkTypeHealth,
} from "../../shared/types.ts";
import { api, connection } from "../api.ts";
import { plural } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonLink,
	ButtonOut,
	Choice,
	CodeBlock,
	ConfirmDialog,
	Facts,
	Field,
	Glyph,
	InlineError,
	Lnk,
	LoadFailed,
	NumberField,
	Page,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useHealth, useProjects, useRepos, useSettings, useTools } from "../queries.ts";
import { ModesSection } from "./modes.tsx";
import { RepoChooser } from "./welcome.tsx";

const SECTIONS = [
	{ id: "agents", label: "Agents" },
	{ id: "approvals", label: "Approvals" },
	{ id: "modes", label: "Modes" },
	{ id: "notifications", label: "Notifications" },
	{ id: "projects", label: "Projects" },
	{ id: "tools", label: "Tools" },
];

const SYSTEM_SETTINGS = "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

export function SettingsScreen() {
	const { section = "agents" } = useParams({ strict: false }) as { section?: string };
	if (section === "this-mac") {
		return <Navigate to="/settings/$section" params={{ section: "tools" }} replace />;
	}
	const known = section === "add-projects" || SECTIONS.some((s) => s.id === section);
	if (!known) return <Navigate to="/settings/$section" params={{ section: "agents" }} replace />;
	const current = section === "add-projects" ? "projects" : section;
	return (
		<Page>
			<div className="flex flex-col gap-5">
				<h1 className="m-0 text-page-title">Settings</h1>
				<div className="flex flex-wrap items-start gap-6">
					<nav aria-label="Settings sections" className="flex min-w-[140px] flex-[0_1_168px] flex-col gap-1">
						{SECTIONS.map((s) => (
							<Link
								key={s.id}
								to="/settings/$section"
								params={{ section: s.id }}
								aria-current={s.id === current ? "page" : undefined}
								className={`nav-item flex min-h-control items-center rounded-sm px-3 ${s.id === current ? "bg-bg-active font-semibold" : ""}`}
							>
								{s.label}
							</Link>
						))}
					</nav>
					<div className="flex min-w-0 max-w-[820px] flex-[1_1_480px] flex-col gap-5">
						{section === "agents" && <AgentsSection />}
						{section === "approvals" && <ApprovalsSection />}
						{section === "modes" && <ModesSection />}
						{section === "notifications" && <NotificationsSection />}
						{section === "projects" && <ProjectsSection />}
						{section === "add-projects" && <AddProjectsSection />}
						{section === "tools" && <ToolsSection />}
					</div>
				</div>
			</div>
		</Page>
	);
}

/* ---------- shared by the sections ---------- */

const SectionHead = ({ title, lead }: { title: ReactNode; lead: ReactNode }) => (
	<div className="flex flex-col gap-1">
		<h2 className="m-0 text-detail-title">{title}</h2>
		<p className="m-0 max-w-[62ch] text-text-muted">{lead}</p>
	</div>
);

const SectionLoading = () => (
	<div role="status" className="flex flex-col gap-3">
		<span className="sr-only">Loading</span>
		<Skeleton width="40%" height={36} />
		<Skeleton width="70%" />
		<Skeleton width="55%" />
	</div>
);

/** Present from mount, so a later `Saved` announces. */
const Saved = ({ on }: { on: boolean }) => (
	<StatusLine className="min-h-5 text-meta text-text-muted">
		{on && (
			<span className="inline-flex items-center gap-2">
				<Glyph kind="pass" size={14} />
				Saved
			</span>
		)}
	</StatusLine>
);

/**
 * Changes save as made. The page keeps its own copy, so a failed save leaves the value on screen
 * with the error beside the control that caused it.
 */
function useSection<T extends object>(path: string, server: T | undefined) {
	const [draft, setDraft] = useState<T | undefined>(server);
	const [field, setField] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const save = useAction((next: T) => api.put<T>(path, next));
	const holding = useRef(false);
	holding.current = save.pending || !!save.error;
	useEffect(() => {
		if (server && !holding.current) setDraft(server);
	}, [server]);
	return {
		draft,
		saved,
		pending: save.pending,
		failed: (name: string) => !!save.error && field === name,
		error: (name: string) =>
			save.error && field === name ? <InlineError>Couldn't save this. Try again.</InlineError> : null,
		/** Shows the change at once. Use `commit` for rows that shouldn't appear until the service agrees. */
		change(patch: Partial<T>, name: string) {
			if (!draft) return;
			const next = { ...draft, ...patch };
			setDraft(next);
			setField(name);
			setSaved(false);
			void save.run(next).then((r) => r && setSaved(true));
		},
		/** Resolves true once saved. */
		async commit(patch: Partial<T>, name: string): Promise<boolean> {
			if (!draft) return false;
			const next = { ...draft, ...patch };
			setField(name);
			setSaved(false);
			const r = await save.run(next);
			if (!r) return false;
			setDraft(next);
			setSaved(true);
			return true;
		},
	};
}

/* ---------- agents ---------- */

function AgentsSection() {
	const settings = useSettings();
	const sec = useSection<AgentSettings>("/api/settings/agents", settings.data?.agents);
	const a = sec.draft;
	return (
		<>
			<SectionHead title="Agents" lead="Changes save as you make them and apply to the next work order." />
			{settings.isError ? (
				<LoadFailed what="settings" error={settings.error} />
			) : !a ? (
				<SectionLoading />
			) : (
				<div className="flex max-w-[480px] flex-col gap-4">
					<div className="flex flex-col gap-1">
						<NumberField
							label="Agents at once"
							hint="Work orders past this limit wait in Intake. From 1 to 8."
							width={96}
							value={a.agentsAtOnce}
							validate={(n) =>
								Number.isInteger(n) && n >= 1 && n <= 8 ? null : "Enter a whole number from 1 to 8."
							}
							onCommit={(n) => sec.change({ agentsAtOnce: n }, "limit")}
						/>
						{sec.error("limit")}
					</div>
					<div className="flex flex-col gap-1">
						<Choice
							type="checkbox"
							title="Pause new work when Review is full"
							description="Review is full when as many PRs wait for you as agents at once. New work then waits in Intake until you review one."
							checked={a.pauseOnReview}
							onChange={(e) => sec.change({ pauseOnReview: e.target.checked }, "pause")}
						/>
						{sec.error("pause")}
					</div>
					<div className="flex flex-col gap-1">
						<Field
							label="Automatic retries"
							hint="When a gate fails, the agent tries this many more times before it asks you."
						>
							{(p) => (
								<select
									{...p}
									className="w-24"
									value={a.retries}
									onChange={(e) => sec.change({ retries: Number(e.target.value) }, "retries")}
								>
									<option value={0}>0</option>
									<option value={1}>1</option>
									<option value={2}>2</option>
								</select>
							)}
						</Field>
						{sec.error("retries")}
					</div>
					<div className="flex flex-col gap-1">
						<Field label="Agent" hint="Used for new work orders. Each run gets its own worktree.">
							{(p) => (
								<select
									{...p}
									className="w-60 max-w-full"
									value={a.agent}
									onChange={(e) => sec.change({ agent: e.target.value }, "agent")}
								>
									<option value="claude">Claude in T3</option>
									<option value="codex">Codex in T3</option>
								</select>
							)}
						</Field>
						{sec.error("agent")}
					</div>
					<Saved on={sec.saved} />
				</div>
			)}
		</>
	);
}

/* ---------- approvals ---------- */

const MERGE_WORDS: Record<WorkType, { many: string; pr: string; one: string }> = {
	"Bug fix": { many: "bug fixes", pr: "a bug-fix PR", one: "a bug fix" },
	Feature: { many: "features", pr: "a feature PR", one: "a feature" },
	"Toolkit sync": { many: "toolkit syncs", pr: "a toolkit-sync PR", one: "a toolkit sync" },
	Chore: { many: "chores", pr: "a chore PR", one: "a chore" },
};

/** `Needs 1 more run and 80% first try. Now 56%.` from the record and the thresholds. */
function needsLine(rec: WorkTypeHealth, t: ApprovalSettings["thresholds"]): string | null {
	const missing: string[] = [];
	const more = t.runs - rec.runs;
	if (more > 0) missing.push(`${more} more ${more === 1 ? "run" : "runs"}`);
	const low = rec.firstTryPct != null && rec.firstTryPct < t.firstTryPct;
	if (low) missing.push(`${t.firstTryPct}% first try`);
	if (rec.regressions > 0) missing.push("no regressions");
	if (missing.length === 0) return null;
	const joined =
		missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : (missing[0] ?? "");
	return `Needs ${joined}.${low ? ` Now ${rec.firstTryPct}%.` : ""}`;
}

const firstTryCount = (rec: WorkTypeHealth) => Math.round(((rec.firstTryPct ?? 0) * rec.runs) / 100);

const CELL = "border-0 border-b border-solid border-border-subtle px-3 py-2 align-top";

function ApprovalsSection() {
	const settings = useSettings();
	const health = useHealth();
	const projects = useProjects();
	const sec = useSection<ApprovalSettings>("/api/settings/approvals", settings.data?.approvals);
	const [asking, setAsking] = useState<WorkType | null>(null);
	const [merging, setMerging] = useState<WorkType | null>(null);
	/** The control that replaces the one just pressed takes the focus, once the dialog has let go of it. */
	const focusRow = useRef<WorkType | null>(null);
	const mergeControls = useRef<Partial<Record<WorkType, HTMLElement | null>>>({});
	const mergeControl = (type: WorkType) => (el: HTMLElement | null) => {
		mergeControls.current[type] = el;
	};
	const a = sec.draft;
	const mergeState = a?.mergeWithoutMe;
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the row's control has changed.
	useEffect(() => {
		const type = focusRow.current;
		if (asking || !type) return;
		focusRow.current = null;
		const timer = setTimeout(() => mergeControls.current[type]?.focus());
		return () => clearTimeout(timer);
	}, [asking, mergeState]);

	const lead =
		"What needs your approval, by type of work. You approve every merge until you turn that off here.";
	if (settings.isError || health.isError) {
		return (
			<>
				<SectionHead title="Approvals" lead={lead} />
				<LoadFailed what="approvals" error={settings.error ?? health.error} />
			</>
		);
	}
	if (!a || !health.data) {
		return (
			<>
				<SectionHead title="Approvals" lead={lead} />
				<SectionLoading />
			</>
		);
	}

	const setMerge = async (type: WorkType, on: boolean) => {
		setMerging(type);
		focusRow.current = type;
		const ok = await sec.commit({ mergeWithoutMe: { ...a.mergeWithoutMe, [type]: on } }, `merge:${type}`);
		if (ok) setAsking(null);
		else focusRow.current = null;
		setMerging(null);
	};

	const asked = asking ? MERGE_WORDS[asking] : null;
	const askers = projects.data?.filter((p) => p.merging === "ask") ?? [];

	return (
		<>
			<SectionHead title="Approvals" lead={lead} />
			<section aria-label="By work type" className="flex flex-col gap-2">
				<div className="overflow-x-auto">
					<table className="w-full border-collapse">
						<thead>
							<tr>
								{["Work type", "Plan review", "First-try record", "Merging"].map((h) => (
									<th
										key={h}
										scope="col"
										className="whitespace-nowrap border-0 border-b border-solid border-border-subtle px-3 py-2 text-start text-meta font-medium text-text-muted"
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{WORK_TYPES.map((type) => {
								const rec = health.data.byType.find((t) => t.type === type);
								const on = a.mergeWithoutMe[type];
								const needs = rec ? needsLine(rec, a.thresholds) : null;
								return (
									<tr key={type}>
										<th
											scope="row"
											className="whitespace-nowrap border-0 border-b border-solid border-border-subtle p-3 text-start align-top font-medium"
										>
											{type}
										</th>
										<td className={CELL}>
											<select
												aria-label={`Plan review for ${type}`}
												className="w-[104px]"
												value={a.planReview[type]}
												onChange={(e) =>
													sec.change(
														{
															planReview: {
																...a.planReview,
																[type]: e.target.value as "always" | "skip",
															},
														},
														`plan:${type}`,
													)
												}
											>
												<option value="always">Always</option>
												<option value="skip">Skip</option>
											</select>
											{sec.error(`plan:${type}`)}
										</td>
										<td className={`${CELL} whitespace-nowrap`}>
											<span className="font-mono text-data tabular-nums">
												{rec ? `${firstTryCount(rec)} of ${rec.runs}` : "–"}
											</span>
										</td>
										<td className={`${CELL} min-w-[220px]`}>
											{on ? (
												<div className="flex flex-wrap items-center gap-2">
													<span>Merges without you</span>
													<Button
														ref={mergeControl(type)}
														disabled={merging === type}
														onClick={() => void setMerge(type, false)}
													>
														Turn off
													</Button>
												</div>
											) : rec?.qualifies ? (
												<div className="flex flex-wrap items-center gap-2">
													<span>You merge. Qualifies.</span>
													<Button ref={mergeControl(type)} onClick={() => setAsking(type)}>
														Merge without me
													</Button>
												</div>
											) : (
												<>
													<div ref={mergeControl(type)} tabIndex={-1}>
														You merge
													</div>
													{a.turnedOffByRegression[type] ? (
														<span className="text-meta text-text-muted">A regression turned this off.</span>
													) : (
														needs && <span className="text-meta text-text-muted">{needs}</span>
													)}
												</>
											)}
											{asking !== type && sec.error(`merge:${type}`)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>
			<section aria-label="When a work type qualifies" className="flex flex-col gap-3">
				<SectionLabel>When a work type qualifies</SectionLabel>
				<div className="flex flex-wrap gap-4">
					<div className="flex flex-[0_1_200px] flex-col gap-1">
						<NumberField
							label="Finished runs, at least"
							width={96}
							value={a.thresholds.runs}
							validate={(n) => (Number.isInteger(n) && n >= 5 ? null : "Enter 5 or more.")}
							onCommit={(n) => sec.change({ thresholds: { ...a.thresholds, runs: n } }, "runs")}
						/>
						{sec.error("runs")}
					</div>
					<div className="flex flex-[0_1_200px] flex-col gap-1">
						<NumberField
							label="First try, at least (%)"
							width={96}
							value={a.thresholds.firstTryPct}
							validate={(n) => (n >= 50 && n <= 100 ? null : "Enter 50 to 100.")}
							onCommit={(n) => sec.change({ thresholds: { ...a.thresholds, firstTryPct: n } }, "pct")}
						/>
						{sec.error("pct")}
					</div>
				</div>
				<p className="m-0 max-w-[62ch] text-meta text-text-muted">
					First try means every gate passed without a retry. A work type also needs no regressions in those
					runs: no error that came back after its fix shipped, and no new error traced to one of its PRs.
				</p>
				<p className="m-0 max-w-[62ch] text-meta text-text-muted">
					Qualifying changes nothing by itself. Merging stays yours until you turn it on. One regression turns
					it off again.
				</p>
			</section>
			<section aria-label="Projects that always ask you" className="flex flex-col gap-1">
				<SectionLabel>Projects that always ask you</SectionLabel>
				{askers.length > 0 ? (
					<>
						<ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
							{askers.map((p) => (
								<li key={p.slug}>
									<Lnk to="/projects/$slug" params={{ slug: p.slug }}>
										{p.name}
									</Lnk>
								</li>
							))}
						</ul>
						<p className="m-0 text-text-muted">
							Use it for projects with few tests, where passing gates prove less.
						</p>
					</>
				) : (
					<p className="m-0 text-text-muted">
						None. Set this on a <Lnk to="/projects">project’s page</Lnk>. Use it for projects with few tests,
						where passing gates prove less.
					</p>
				)}
			</section>
			<Saved on={sec.saved} />
			<ConfirmDialog
				open={!!asking}
				onOpenChange={(open) => {
					if (!open) setAsking(null);
				}}
				title={asked ? `Let ${asked.many} merge without you?` : ""}
				description={
					asked
						? `When all 4 gates pass, ${asked.pr} merges without you. You still see it on the floor, and any new error goes back to Intake. If ${asked.one} causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.`
						: undefined
				}
				action="Turn on"
				actionVariant="primary"
				pending={sec.pending}
				onAction={() => {
					if (asking) void setMerge(asking, true);
				}}
				error={asking && sec.failed(`merge:${asking}`) ? "Couldn't save this. Try again." : null}
			/>
		</>
	);
}

/* ---------- notifications ---------- */

const NEEDS_YOU: Array<{ id: NotificationEvent; title: string; body: string }> = [
	{ id: "question", title: "An agent asks a question", body: "The work order waits until you answer." },
	{ id: "plan", title: "A plan needs approval", body: "Build starts after you approve." },
	{ id: "ready_pr", title: "A PR is ready to merge", body: "All gates passed." },
	{ id: "failed_gates", title: "Gates fail after the retries", body: "The agent has stopped trying." },
	{
		id: "error",
		title: "A new production error or a regression",
		body: "Once per error, not once per event.",
	},
	{ id: "red_main", title: "CI goes red on main", body: "Once per project until it is green again." },
];
const JUST_SO: Array<{ id: NotificationEvent; title: string; body: string }> = [
	{
		id: "merged_alone",
		title: "A PR merges without you",
		body: "Only when you turned that on in Approvals.",
	},
	{ id: "shipped", title: "A work order ships", body: "Merged, and main didn't go red after it." },
	{ id: "slots_full", title: "All agent slots are full", body: "New work is waiting in Intake." },
];

function NotificationsSection() {
	const settings = useSettings();
	const tools = useTools();
	const sec = useSection<NotificationSettings>("/api/settings/notifications", settings.data?.notifications);
	const [sent, setSent] = useState(false);
	const test = useAction(() => api.post<{ ok: boolean }>("/api/notifications/test"), {
		onSuccess: (r) => setSent(r.ok),
	});
	const n = sec.draft;
	const lead = "Sent by this Mac, even with the browser closed. Clicking one opens the item it names.";
	if (settings.isError) {
		return (
			<>
				<SectionHead title="Notifications" lead={lead} />
				<LoadFailed what="settings" error={settings.error} />
			</>
		);
	}
	if (!n) {
		return (
			<>
				<SectionHead title="Notifications" lead={lead} />
				<SectionLoading />
			</>
		);
	}

	// macOS blocking terminal-notifier shows up as its own exit code. Focus and banner settings don't, so a sent test still says what to check.
	const lastTest = settings.data?.notifications.lastTest;
	const blocked = lastTest === "blocked" && !sent;
	const failed = (lastTest === "failed" || lastTest === "blocked") && !sent;
	const notifier = tools.data?.find((t) => t.name === "terminal-notifier");
	const missing = notifier?.state === "missing";
	const rows = (items: typeof NEEDS_YOU) =>
		items.map((e) => (
			<div key={e.id} className="flex flex-col gap-1 border-0 border-b border-solid border-border-subtle">
				<label className="hover-row box-border flex min-h-row cursor-pointer items-start gap-3 px-3 py-2">
					<input
						type="checkbox"
						className="mt-0.5"
						checked={n.events[e.id]}
						onChange={(ev) => sec.change({ events: { ...n.events, [e.id]: ev.target.checked } }, e.id)}
					/>
					<span className="flex min-w-0 flex-col gap-0.5">
						<span className="font-medium">{e.title}</span>
						<span className="text-meta text-text-muted">{e.body}</span>
					</span>
				</label>
				{sec.error(e.id)}
			</div>
		));

	return (
		<>
			<SectionHead title="Notifications" lead={lead} />
			{failed && test.pending ? (
				<Banner
					role="status"
					glyph="run"
					title="Checking macOS"
					actions={<Button disabled>Checking…</Button>}
				/>
			) : failed ? (
				<Banner
					role="alert"
					glyph="fail"
					title={blocked ? "macOS is blocking notifications" : "The test notification didn't send"}
					body={
						missing ? (
							<>
								terminal-notifier isn't installed. Install it with{" "}
								<span className="font-mono text-data">{notifier?.fix}</span>. Until then, everything still
								lands in the Queue.
							</>
						) : (
							"Allow terminal-notifier in System Settings, under Notifications. Until then, everything still lands in the Queue."
						)
					}
					actions={
						<>
							{!missing && (
								<ButtonOut href={SYSTEM_SETTINGS} target="_self">
									Open System Settings
								</ButtonOut>
							)}
							<Button onClick={() => void test.run()}>Check again</Button>
						</>
					}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<Glyph kind={sent ? "pass" : "idle"} />
						<span className="font-medium">
							{sent ? "Test sent to this Mac" : "Send a test to see one on this Mac"}
						</span>
						<Button disabled={test.pending} onClick={() => void test.run()}>
							Send a test
						</Button>
						{sent && (
							<ButtonOut href={SYSTEM_SETTINGS} target="_self">
								Open System Settings
							</ButtonOut>
						)}
					</div>
					<StatusLine className="text-meta text-text-muted">
						{sent && "Sent. Nothing showed? Check Focus and System Settings."}
					</StatusLine>
				</div>
			)}
			<InlineError>{test.error && "Couldn't send this. Try again."}</InlineError>
			<section aria-label="Needs you" className="flex flex-col">
				<SectionLabel>Needs you</SectionLabel>
				{rows(NEEDS_YOU)}
			</section>
			<section aria-label="Just so you know" className="flex flex-col">
				<SectionLabel>Just so you know</SectionLabel>
				{rows(JUST_SO)}
			</section>
			<div className="flex flex-col gap-1">
				<label className="hover-row flex min-h-row cursor-pointer items-center gap-3 px-3">
					<input
						type="checkbox"
						checked={n.onlyWhenAway}
						onChange={(e) => sec.change({ onlyWhenAway: e.target.checked }, "away")}
					/>
					<span>Only when Software Factory isn’t the tab you’re on</span>
				</label>
				{sec.error("away")}
			</div>
			<p className="m-0 max-w-[62ch] text-meta text-text-muted">
				Several events within a minute arrive as one. Focus and Do Not Disturb apply as usual. There’s no
				separate inbox: the Queue is the list of what needs you.{" "}
				<Lnk to="/settings/notifications/samples">See how they read</Lnk>
			</p>
			<Saved on={sec.saved} />
		</>
	);
}

/* ---------- projects ---------- */

function CloneFolder({
	value,
	onCommit,
	error,
}: {
	value: string;
	onCommit: (v: string) => void;
	error: ReactNode;
}) {
	const [text, setText] = useState(value);
	const [blank, setBlank] = useState(false);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setText(value);
	}, [value]);
	return (
		<div className="flex flex-col gap-1">
			<Field
				label="Clone folder"
				hint="New clones go here. Projects already cloned stay where they are."
				error={blank ? "Enter a folder." : undefined}
			>
				{(p) => (
					<input
						{...p}
						type="text"
						className="w-80 max-w-full"
						value={text}
						onFocus={() => {
							focused.current = true;
						}}
						onChange={(e) => setText(e.target.value)}
						onBlur={() => {
							focused.current = false;
							const next = text.trim();
							setBlank(!next);
							if (next && next !== value) onCommit(next);
						}}
					/>
				)}
			</Field>
			{error}
		</div>
	);
}

function ProjectsSection() {
	const settings = useSettings();
	const projects = useProjects();
	const repos = useRepos();
	const sec = useSection<ProjectSettings>("/api/settings/projects", settings.data?.projects);
	const [pattern, setPattern] = useState("");
	const [patternBad, setPatternBad] = useState(false);
	const [removed, setRemoved] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const removeButtons = useRef<Array<HTMLButtonElement | null>>([]);
	const p = sec.draft;
	const lead = "Which of your GitHub repos the factory can see, and where it keeps them.";
	if (settings.isError) {
		return (
			<>
				<SectionHead title="Projects" lead={lead} />
				<LoadFailed what="settings" error={settings.error} />
			</>
		);
	}
	if (!p) {
		return (
			<>
				<SectionHead title="Projects" lead={lead} />
				<SectionLoading />
			</>
		);
	}

	const add = async (e: FormEvent) => {
		e.preventDefault();
		const next = pattern.trim();
		if (!next) {
			setPatternBad(true);
			input.current?.focus();
			return;
		}
		if (p.neverTouch.includes(next)) {
			setPattern("");
			return;
		}
		if (await sec.commit({ neverTouch: [...p.neverTouch, next] }, "rules")) setPattern("");
	};
	const remove = async (rule: string, index: number) => {
		const rules = p.neverTouch.filter((r) => r !== rule);
		if (await sec.commit({ neverTouch: rules }, "rules")) {
			setRemoved(rule);
			// The next row takes the focus, or the add field when no rows are left.
			requestAnimationFrame(() => {
				const nextButton = removeButtons.current[Math.min(index, rules.length - 1)];
				(rules.length ? nextButton : input.current)?.focus();
			});
		}
	};
	const undo = async () => {
		if (removed && (await sec.commit({ neverTouch: [...p.neverTouch, removed] }, "rules"))) {
			setRemoved(null);
			input.current?.focus();
		}
	};

	const list = repos.data?.repos;
	const inFactory = list?.filter((r) => r.added).length ?? projects.data?.length;

	return (
		<>
			<SectionHead title="Projects" lead={lead} />
			<div className="flex max-w-[560px] flex-col gap-4">
				<CloneFolder
					value={p.cloneFolder}
					onCommit={(v) => sec.change({ cloneFolder: v }, "folder")}
					error={sec.error("folder")}
				/>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					{inFactory == null ? (
						<Skeleton width="180px" />
					) : list ? (
						<span>
							{inFactory} of {plural(list.length, "repo")} {list.length === 1 ? "is" : "are"} in the factory.
						</span>
					) : (
						<span>{plural(inFactory, "project")} in the factory.</span>
					)}
					<ButtonLink to="/settings/$section" params={{ section: "add-projects" }}>
						Add projects
					</ButtonLink>
				</div>
			</div>
			<section aria-label="Never touch" className="flex max-w-[560px] flex-col gap-2">
				<SectionLabel>Never touch</SectionLabel>
				<p className="m-0 text-meta text-text-muted">
					Repos and folders that match are never cloned, read, or given to an agent. A folder rule covers
					everything inside it. Use * as a wildcard.
				</p>
				{p.neverTouch.length > 0 && (
					<ul className="m-0 list-none p-0">
						{p.neverTouch.map((rule, i) => (
							<li
								key={rule}
								className="flex min-h-row items-center gap-3 border-0 border-b border-solid border-border-subtle px-3"
							>
								<span className="flex-[1_1_0] font-mono text-data [overflow-wrap:anywhere]">{rule}</span>
								<Button
									ref={(el) => {
										removeButtons.current[i] = el;
									}}
									aria-label={`Remove ${rule}`}
									disabled={sec.pending}
									onClick={() => void remove(rule, i)}
								>
									Remove
								</Button>
							</li>
						))}
					</ul>
				)}
				{p.neverTouch.length === 0 && (
					<p className="m-0 text-meta text-text-muted">
						Nothing is excluded, so the factory can see every repo.
					</p>
				)}
				<StatusLine className="flex flex-wrap items-center gap-3">
					{removed && (
						<>
							<span className="[overflow-wrap:anywhere]">Removed {removed}.</span>
							<Button disabled={sec.pending} onClick={() => void undo()}>
								Undo
							</Button>
						</>
					)}
				</StatusLine>
				<form onSubmit={(e) => void add(e)} noValidate className="flex flex-col gap-2">
					<div className="flex flex-wrap items-end gap-2">
						<div className="min-w-0 flex-[1_1_240px]">
							<Field
								label="Add a pattern"
								error={patternBad && !pattern.trim() ? "Enter a repo name or pattern." : undefined}
							>
								{(f) => (
									<input
										{...f}
										ref={input}
										type="text"
										placeholder="client-*"
										className="w-full"
										value={pattern}
										onChange={(e) => {
											setPattern(e.target.value);
											setPatternBad(false);
										}}
									/>
								)}
							</Field>
						</div>
						<Button type="submit" disabled={sec.pending}>
							Add
						</Button>
					</div>
					{sec.error("rules")}
				</form>
			</section>
			<Saved on={sec.saved} />
		</>
	);
}

function AddProjectsSection() {
	const navigate = useNavigate();
	return (
		<>
			<Breadcrumb
				crumbs={[
					{ label: "Settings", link: { to: "/settings/$section", params: { section: "agents" } } as never },
					{ label: "Projects", link: { to: "/settings/$section", params: { section: "projects" } } as never },
					{ label: "Add projects" },
				]}
			/>
			<SectionHead
				title="Add projects"
				lead="Everything starts off. Only the projects you turn on get read, and reading doesn't change anything."
			/>
			<RepoChooser
				primary="Add projects"
				secondary={
					<ButtonLink to="/settings/$section" params={{ section: "projects" }}>
						Cancel
					</ButtonLink>
				}
				onDone={() => void navigate({ to: "/projects" })}
			/>
		</>
	);
}

/* ---------- tools ---------- */

function toolWord(t: ToolStatus, checking: boolean): string {
	if (t.state === "ready") return t.detail;
	if (checking) return "Checking";
	if (t.state === "signed_out") return "Not signed in";
	if (t.state === "missing") return t.required ? "Not installed" : "Optional · not installed";
	return t.detail;
}

function toolGlyph(t: ToolStatus, checking: boolean) {
	if (t.state === "ready") return "pass" as const;
	if (checking) return "run" as const;
	return t.state === "missing" && !t.required ? ("idle" as const) : ("fail" as const);
}

function ToolsSection() {
	const tools = useTools();
	const mac = useQuery({
		queryKey: ["this-mac"],
		queryFn: () => api.get<{ dataDir: string; port: number }>("/api/this-mac"),
	});
	const [backedUp, setBackedUp] = useState<string | null>(null);
	const check = useAction(() => api.post<ToolStatus[]>("/api/tools/check"));
	const restart = useAction(() => api.post("/api/service/restart"), {
		onSuccess: () => connection.setOffline(true),
	});
	const backup = useAction(() => api.post<{ ok: boolean; path: string }>("/api/backup"), {
		onSuccess: (r) => setBackedUp(r.path),
	});
	return (
		<>
			<SectionHead
				title="Tools"
				lead="The tools the factory runs on, checked when it starts and whenever you ask."
			/>
			{tools.isError ? (
				<LoadFailed what="tools" error={tools.error} />
			) : !tools.data ? (
				<SectionLoading />
			) : (
				<div>
					{tools.data.map((t) => {
						const checking = check.pending && t.state !== "ready";
						const showFix = !!t.fix && (t.state === "signed_out" || t.required);
						return (
							<div
								key={t.name}
								className="box-border flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 border-0 border-b border-solid border-border-subtle px-3 py-1.5"
							>
								<Glyph kind={toolGlyph(t, checking)} />
								<span className="w-[136px] font-mono text-data">{t.name}</span>
								<span className="flex-[1_1_200px] text-text-muted">{t.purpose}</span>
								<span>{toolWord(t, checking)}</span>
								{showFix && (
									<div className="flex-[1_1_100%] py-2">
										<CodeBlock>{t.fix}</CodeBlock>
										<div className="mt-2 flex flex-col gap-2">
											<div>
												<Button disabled={check.pending} onClick={() => void check.run()}>
													{check.pending ? "Checking…" : "Check again"}
												</Button>
											</div>
											<InlineError>{check.error && "Couldn't check this. Try again."}</InlineError>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			<section aria-label="This Mac" className="flex flex-col gap-3">
				<SectionLabel>This Mac</SectionLabel>
				{mac.isError ? (
					<LoadFailed what="this Mac" error={mac.error} />
				) : !mac.data ? (
					<Skeleton width="50%" />
				) : (
					<Facts
						rows={[
							["Service", `Running at 127.0.0.1:${mac.data.port}`, true],
							["Starts", "At login"],
							["Data", `${mac.data.dataDir}/factory.db`, true],
						]}
					/>
				)}
				<div className="flex flex-wrap gap-2">
					<Button disabled={restart.pending} onClick={() => void restart.run()}>
						Restart service
					</Button>
					<Button disabled={backup.pending} onClick={() => void backup.run()}>
						{backup.pending ? "Backing up…" : "Back up data"}
					</Button>
				</div>
				<InlineError>{restart.error && "Couldn't restart this. Try again."}</InlineError>
				<InlineError>{backup.error && "Couldn't back this up. Try again."}</InlineError>
				<StatusLine className="text-meta text-text-muted [overflow-wrap:anywhere]">
					{backedUp && `Backed up to ${backedUp}.`}
				</StatusLine>
			</section>
		</>
	);
}
