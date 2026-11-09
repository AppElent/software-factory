import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { parseFixCommand } from "../shared/command.ts";
import type { ShellResponse, SourceHealth, WorkType } from "../shared/types.ts";
import { api, connection } from "./api.ts";
import { confirmOnProductionError, useCopyCommand } from "./fix.tsx";
import { ago, clock, plural } from "./format.ts";
import { typing } from "./keyboard.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	CodeBlock,
	ConfirmDialog,
	Facts,
	Field,
	FormDialog,
	Glyph,
	InlineError,
} from "./kit.tsx";
import { useRestoreChosenProjects } from "./project-picker.tsx";
import {
	useAction,
	useErrors,
	useFloor,
	useIssues,
	useModes,
	useProjects,
	usePrs,
	useQueue,
	useShell,
	useWorkOrders,
} from "./queries.ts";
import { startFix } from "./screens/errors.tsx";
import { startIssue } from "./screens/issues.tsx";

/* ---------- shared overlays ---------- */

const overlayState = {
	listeners: new Set<() => void>(),
	stop: false,
	menu: false,
	set(next: { stop?: boolean; menu?: boolean }) {
		if (next.stop !== undefined) this.stop = next.stop;
		if (next.menu !== undefined) this.menu = next.menu;
		for (const l of this.listeners) l();
	},
};

/** Opens the Stop the line dialog from anywhere. */
export const openStopDialog = () => overlayState.set({ stop: true });
/** Opens the new work order dialog over the current page, optionally filled in. */
export function useOpenNewWorkOrder() {
	const navigate = useNavigate();
	return (opts: { project?: string; text?: string } = {}) =>
		void navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				new: "work-order" as const,
				newProject: opts.project,
				newText: opts.text,
			}),
		} as never);
}

function useOverlay<T>(pick: () => T): T {
	return useSyncExternalStore((l) => {
		overlayState.listeners.add(l);
		return () => overlayState.listeners.delete(l);
	}, pick);
}

/* ---------- root ---------- */

export function Root() {
	const offline = useSyncExternalStore(connection.subscribe, connection.offline);
	const shell = useShell();
	const location = useLocation();
	const navigate = useNavigate();

	// While the service is down, keep asking. It comes back on its own under launchd.
	useEffect(() => {
		if (!offline) return;
		const t = setInterval(() => void shell.refetch(), 3000);
		return () => clearInterval(t);
	}, [offline, shell.refetch]);

	const firstRun = shell.data && (!shell.data.hasProjects || shell.data.newDevice);
	const onSetup = location.pathname.startsWith("/welcome") || location.pathname.startsWith("/projects/new");
	useEffect(() => {
		if (firstRun && !onSetup) void navigate({ to: "/welcome/$step", params: { step: "tools" } });
	}, [firstRun, onSetup, navigate]);

	if (offline) return <AppOffline onCheck={() => void shell.refetch()} />;
	return (
		<>
			<Outlet />
			<GlobalKeys hasProjects={shell.data?.hasProjects !== false} />
		</>
	);
}

function AppOffline({ onCheck }: { onCheck: () => void }) {
	return (
		<main id="main" className="mx-auto flex max-w-[640px] flex-col gap-4 px-6 py-16">
			<h1 className="m-0 text-page-title">The factory isn't running</h1>
			<p className="m-0 text-text-muted">
				This page can't reach the local service on port {window.location.port || "4310"}. Agents already
				working in T3 keep going, but nothing new starts and nothing here updates. Start the service, then
				check again.
			</p>
			<CodeBlock>launchctl kickstart gui/$UID/com.appelent.software-factory</CodeBlock>
			<div>
				<Button variant="primary" onClick={onCheck}>
					Check again
				</Button>
			</div>
		</main>
	);
}

/* ---------- keyboard and overlays ---------- */

const GO: Record<string, string> = {
	q: "/",
	f: "/floor",
	p: "/prs",
	i: "/issues",
	e: "/errors",
	v: "/environments",
	x: "/security",
	o: "/projects",
	u: "/automations",
	y: "/improve",
	h: "/health",
	s: "/settings/agents",
};

function GlobalKeys({ hasProjects }: { hasProjects: boolean }) {
	const navigate = useNavigate();
	const openNew = useOpenNewWorkOrder();
	const pendingG = useRef<number | null>(null);
	useEffect(() => {
		const on = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				if (hasProjects) overlayState.set({ menu: !overlayState.menu });
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || !hasProjects) return;
			if (pendingG.current !== null) {
				window.clearTimeout(pendingG.current);
				pendingG.current = null;
				const to = GO[e.key];
				if (to) void navigate({ to });
				return;
			}
			if (e.key === "g") {
				pendingG.current = window.setTimeout(() => {
					pendingG.current = null;
				}, 1500);
				return;
			}
			if (e.key === "n") {
				e.preventDefault();
				openNew();
			}
		};
		window.addEventListener("keydown", on);
		return () => window.removeEventListener("keydown", on);
	});
	return null;
}

/* ---------- shell layout ---------- */

const NAV: Array<{ label: string; to: string; count?: keyof ShellResponse["counts"] }> = [
	{ label: "Queue", to: "/", count: "queue" },
	{ label: "Floor", to: "/floor", count: "floor" },
	{ label: "Pull requests", to: "/prs", count: "prs" },
	{ label: "Issues", to: "/issues", count: "issues" },
	{ label: "Errors", to: "/errors", count: "errors" },
	{ label: "Environments", to: "/environments", count: "environments" },
	{ label: "Security", to: "/security", count: "security" },
	{ label: "Projects", to: "/projects", count: "projects" },
	{ label: "Automations", to: "/automations", count: "automations" },
	{ label: "Health", to: "/health" },
];

function statusLines(data: ShellResponse): [string, string[]] {
	let first: string;
	if (data.line.stopped) first = `Line stopped at ${clock(data.line.stoppedAt)}`;
	else if (data.checking) first = "Checking GitHub and Sentry";
	else if (data.agents.working === 0) first = "No agents working yet";
	else first = `${data.agents.working} of ${data.agents.limit} agents working`;
	const read = data.sources.filter((s: SourceHealth) => s.source !== "T3" && s.lastOk);
	const ages = new Set(read.map((s) => ago(s.lastOk)));
	const failing = data.sources.some((s) => s.source !== "T3" && !s.ok);
	if (read.length === 0) return [first, []];
	if (ages.size === 1 && !failing) return [first, [`Synced ${ago(read[0]?.lastOk)}`]];
	return [first, read.map((s) => `${s.source} synced ${ago(s.lastOk)}`)];
}

export function ShellOutlet() {
	useRestoreChosenProjects();
	const shell = useShell();
	const stale = useSyncExternalStore(connection.subscribe, connection.staleBuild);
	const location = useLocation();
	const data = shell.data;
	const stopOpen = useOverlay(() => overlayState.stop);
	const restart = useAction(() => api.post("/api/line", { stopped: false }));
	const [first, second] = data ? statusLines(data) : ["Checking GitHub and Sentry", []];

	// Announces count changes at most once a minute, and never row updates.
	const [announce, setAnnounce] = useState("");
	const last = useRef({ at: 0, count: -1 });
	const queueCount = data?.counts.queue ?? -1;
	useEffect(() => {
		if (queueCount < 0) return;
		const now = Date.now();
		if (last.current.count === -1) {
			last.current = { at: now, count: queueCount };
			return;
		}
		if (queueCount !== last.current.count && now - last.current.at > 60_000) {
			last.current = { at: now, count: queueCount };
			setAnnounce(`${plural(queueCount, "item")} in the queue`);
		}
	}, [queueCount]);

	const isCurrent = (to: string) =>
		to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

	return (
		<div className="relative flex min-h-screen flex-wrap items-stretch bg-bg-canvas">
			<a className="skip-link" href="#main">
				Skip to content
			</a>
			<nav
				aria-label="Main"
				className="sf-nav box-border flex min-w-[200px] max-w-[216px] flex-[1_1_216px] flex-col gap-1 border-0 border-e border-solid border-border-subtle bg-bg-surface px-3 py-4"
			>
				<div className="sf-word px-3 pb-4 pt-1 text-detail-title">Software Factory</div>
				<button
					type="button"
					onClick={() => overlayState.set({ menu: true })}
					className="btn-secondary sf-find mb-3 flex min-h-control cursor-pointer items-center rounded-sm border border-solid border-border-control bg-bg-canvas px-3 text-meta text-text-muted"
				>
					Search or run a command
					<span className="ms-auto font-mono">⌘K</span>
				</button>
				{NAV.map((item) => {
					const on = isCurrent(item.to);
					return (
						<Link
							key={item.label}
							to={item.to}
							aria-current={on ? "page" : undefined}
							className={`nav-item flex min-h-control items-center rounded-sm px-3 ${on ? "bg-bg-active font-semibold" : ""}`}
						>
							<span>{item.label}</span>
							{item.count && data && (
								<span className="ms-auto ps-2 font-mono text-data tabular-nums text-text-muted">
									{data.counts[item.count]}
								</span>
							)}
						</Link>
					);
				})}
				<div className="sf-foot mt-auto flex flex-col gap-2 pt-4">
					<Link
						to="/improve"
						aria-current={location.pathname === "/improve" ? "page" : undefined}
						className={`nav-item flex min-h-control items-center rounded-sm px-3 ${location.pathname === "/improve" ? "bg-bg-active font-semibold" : ""}`}
					>
						Improve yourself
					</Link>
					<Link
						to="/settings/$section"
						params={{ section: "agents" }}
						aria-current={location.pathname.startsWith("/settings") ? "page" : undefined}
						className={`nav-item flex min-h-control items-center rounded-sm px-3 ${location.pathname.startsWith("/settings") ? "bg-bg-active font-semibold" : ""}`}
					>
						Settings
					</Link>
					<div className="sf-status px-3 text-meta text-text-muted">
						<div>{first}</div>
						{second.map((s) => (
							<div key={s}>{s}</div>
						))}
					</div>
					{data?.line.stopped ? (
						<Button grow onClick={() => void restart.run()} disabled={restart.pending}>
							Restart the line
						</Button>
					) : (
						<Button variant="danger" grow onClick={openStopDialog}>
							Stop the line
						</Button>
					)}
					<InlineError>{restart.error && "Couldn't restart the line. Try again."}</InlineError>
				</div>
			</nav>
			<div className="flex min-w-0 flex-[999_1_560px] flex-col">
				{stale && (
					<div className="px-6 pt-4">
						<Banner
							role="alert"
							glyph="err"
							title="This page is out of date."
							actions={<Button onClick={() => window.location.reload()}>Reload</Button>}
						/>
					</div>
				)}
				{shell.data?.configError && (
					<div className="px-6 pt-4">
						<Banner
							role="alert"
							glyph="err"
							title="Your config file can't be used."
							body={`${shell.data.configError} Modes, environments and settings may show their defaults, because the file can't say what you set. Nothing merges on its own until it's fixed.`}
						/>
					</div>
				)}
				<Outlet />
			</div>
			<div role="status" className="sr-only">
				{announce}
			</div>
			<CommandMenu />
			<NewWorkOrderDialog />
			{stopOpen && <StopDialog />}
		</div>
	);
}

/** Setup pages bring their own layout: see <SetupLayout>. */
export function SetupOutlet() {
	return <Outlet />;
}

/* ---------- stop the line ---------- */

function StopDialog() {
	const floor = useFloor();
	const stop = useAction(() => api.post("/api/line", { stopped: true }), {
		onSuccess: () => overlayState.set({ stop: false }),
	});
	const active = floor.data
		? Object.values(floor.data.columns)
				.flat()
				.filter((w) => ["planning", "building", "retrying", "rebasing"].includes(w.state))
				.map((w) => `WO-${w.id}`)
		: [];
	const intake = floor.data?.columns.Intake.length ?? 0;
	const plan = floor.data?.columns.Plan.length ?? 0;
	return (
		<ConfirmDialog
			open
			onOpenChange={(open) => overlayState.set({ stop: open })}
			title="Stop the line?"
			description="Agents already working finish the step they’re on, then hold. Their worktrees stay as they are. To stop one right away, open it in T3. Nothing new starts until you restart."
			action="Stop the line"
			onAction={() => void stop.run()}
			pending={stop.pending}
			error={stop.error && "Couldn't stop the line. Try again."}
		>
			<Facts
				rows={[
					["Agents affected", active.length ? active.join(", ") : "None"],
					["Waiting", `${intake} in Intake, ${plan} in Plan`],
					["Not affected", "Merged PRs and deploys already running"],
				]}
			/>
		</ConfirmDialog>
	);
}

/* ---------- new work order ---------- */

const TYPES: Array<{ value: WorkType; title: string; desc: string }> = [
	{ value: "Bug fix", title: "Bug fix", desc: "You approve the plan. It builds, checks, and opens a PR." },
	{ value: "Feature", title: "Feature", desc: "Same steps, with a longer plan to read first." },
	{ value: "Chore", title: "Chore", desc: "Skips the plan. For small, safe changes." },
];

function NewWorkOrderDialog() {
	const search = useSearch({ strict: false }) as { new?: string; newProject?: string; newText?: string };
	const navigate = useNavigate();
	const open = search.new === "work-order";
	const close = (extra: Record<string, unknown> = {}) =>
		void navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				new: undefined,
				newProject: undefined,
				newText: undefined,
				...extra,
			}),
		} as never);
	return (
		<FormDialog open={open} onOpenChange={(o) => !o && close()} title="New work order">
			{open && (
				<NewWorkOrderForm initialProject={search.newProject} initialText={search.newText} onClose={close} />
			)}
		</FormDialog>
	);
}

function NewWorkOrderForm({
	initialProject,
	initialText,
	onClose,
}: {
	initialProject?: string;
	initialText?: string;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const projects = useProjects();
	const queue = useQueue();
	const [project, setProject] = useState(initialProject ?? "");
	const [text, setText] = useState(initialText ?? "");
	const [type, setType] = useState<WorkType>("Bug fix");
	const modes = useModes();
	const [modeId, setModeId] = useState("");
	const mode = modeId || modes.data?.defaultMode || "";
	const { copy, view: copyView } = useCopyCommand();
	const [invalid, setInvalid] = useState(false);
	const textRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => textRef.current?.focus(), []);
	const selected = project || projects.data?.[0]?.slug || "";
	const create = useAction(
		() =>
			api.post<{ id: number }>("/api/work-orders", {
				project: selected,
				type,
				description: text.trim(),
				mode: mode || undefined,
			}),
		{
			onSuccess: (r) => {
				void navigate({ to: "/work-orders/$id", params: { id: String(r.id) } });
			},
		},
	);
	const atLimit = !!queue.data?.limits.startBlock;
	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!text.trim()) {
			setInvalid(true);
			textRef.current?.focus();
			return;
		}
		void create.run();
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-4">
			<Field label="Project">
				{(p) => (
					<select {...p} value={selected} onChange={(e) => setProject(e.target.value)}>
						{projects.data?.map((x) => (
							<option key={x.slug} value={x.slug}>
								{x.name}
							</option>
						))}
					</select>
				)}
			</Field>
			<Field
				label="What should change?"
				error={invalid && !text.trim() ? "Describe the change so the agent can plan it." : undefined}
			>
				{(p) => (
					<textarea
						{...p}
						ref={textRef}
						rows={4}
						placeholder="Add a weekly summary to the workout history page"
						value={text}
						onChange={(e) => setText(e.target.value)}
					/>
				)}
			</Field>
			<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
				<legend className="mb-1 p-0 font-medium">Work type</legend>
				{TYPES.map((t) => (
					<label
						key={t.value}
						className="hover-row flex cursor-pointer items-start gap-2 rounded-sm px-3 py-2"
					>
						<input
							type="radio"
							name="work-type"
							className="mt-0.5"
							checked={type === t.value}
							onChange={() => setType(t.value)}
						/>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="font-medium">{t.title}</span>
							<span className="text-meta text-text-muted">{t.desc}</span>
						</span>
					</label>
				))}
			</fieldset>
			<Field label="Mode" hint={modes.data?.modes.find((m) => m.id === mode)?.description}>
				{(p) => (
					<select {...p} value={mode} onChange={(e) => setModeId(e.target.value)}>
						{modes.data?.modes.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				)}
			</Field>
			<InlineError>{create.error && `Couldn't start this. ${create.error}`}</InlineError>
			{copyView}
			<div className="flex flex-wrap justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button
					disabled={!text.trim()}
					onClick={() =>
						void copy(() =>
							api
								.post<{ command: string }>("/api/work-orders/command", {
									project: selected,
									type,
									description: text.trim(),
									mode: mode || undefined,
								})
								.then((r) => r.command),
						)
					}
				>
					Copy as command
				</Button>
				<Button type="submit" variant="primary" disabled={create.pending}>
					{atLimit ? "Add to Intake" : "Start work order"}
				</Button>
			</div>
		</form>
	);
}

/* ---------- command menu ---------- */

const ITEM =
	"flex min-h-control cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 [overflow-wrap:anywhere]";

function Key({ children }: { children: string }) {
	return <span className="ms-auto ps-3 font-mono text-data text-text-muted">{children}</span>;
}

/** `fix #12 full send` and its kin, resolved against what's open. These bypass the menu's search. */
function FixCommands({ text, onDone }: { text: string; onDone: (to: string) => void }) {
	const modes = useModes();
	const isFix = /^fix\s/i.test(text.trim());
	const issues = useIssues();
	const errors = useErrors();
	const queue = useQueue();
	const [asking, setAsking] = useState<{
		title: string;
		description: string;
		action: string;
		go: () => void;
	} | null>(null);
	const run = useAction(async (work: () => Promise<string>) => onDone(await work()));
	const all = modes.data?.modes ?? [];
	const command = isFix ? parseFixCommand(text, all) : null;
	if (!command) return null;
	const mode = command.mode ?? all.find((m) => m.id === modes.data?.defaultMode) ?? null;
	const merges = mode?.merge === "factory";
	const named = mode ? ` with ${mode.name}` : "";
	const item = (key: string, label: string, onSelect: () => void, disabled?: string | null) => (
		<Command.Item
			key={key}
			forceMount
			disabled={!!disabled}
			className={ITEM}
			value={`${text} ${key}`}
			onSelect={onSelect}
		>
			<span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
			{disabled && <span className="ms-auto flex-none text-meta text-text-muted">{disabled}</span>}
		</Command.Item>
	);

	const rows: React.ReactNode[] = [];
	if (command.unknownMode) {
		rows.push(item("no-mode", `No mode called ‘${command.unknownMode}’`, () => {}, "Check Settings"));
	} else if (command.target.kind === "issue") {
		const { number, project } = command.target;
		const found = (issues.data?.issues ?? []).filter(
			(i) => i.number === number && (!project || i.project === project),
		);
		if (found.length === 0) rows.push(item("none", `No open issue #${number}`, () => {}, "Nothing to fix"));
		for (const i of found) {
			const why = i.workOrderId ? `WO-${i.workOrderId} has it` : merges && i.locked ? "Read it first" : null;
			rows.push(
				item(
					`issue-${i.project}-${i.number}`,
					`Fix ${i.projectName} #${i.number} ${i.title}${named}`,
					() =>
						void run.run(async () => {
							const { id } = await startIssue(i, mode);
							return `/work-orders/${id}`;
						}),
					why,
				),
			);
		}
	} else if (command.target.kind === "error") {
		const { shortId } = command.target;
		const e = (errors.data?.errors ?? []).find((x) => x.shortId.toUpperCase() === shortId);
		if (!e) rows.push(item("none", `No open error ${shortId}`, () => {}, "Nothing to fix"));
		else {
			const go = (confirmed: boolean) =>
				void run.run(async () => {
					const { id } = await startFix(e, mode, confirmed);
					return `/work-orders/${id}`;
				});
			const ask = mode ? confirmOnProductionError(1)(mode) : null;
			rows.push(
				item(
					`error-${e.id}`,
					`Fix ${e.projectName} ${e.shortId} ${e.title}${named}`,
					() => (ask ? setAsking({ ...ask, go: () => go(true) }) : go(false)),
					e.workOrderId ? `WO-${e.workOrderId} has it` : null,
				),
			);
		}
	} else {
		const red = [...(queue.data?.needsYou ?? []), ...(queue.data?.later ?? [])].filter(
			(q) => q.kind === "red_main" && q.project,
		);
		const go = () =>
			void run.run(async () => {
				for (const q of red)
					await api.post("/api/work-orders", {
						project: q.project,
						type: "Bug fix",
						title: q.title,
						description: q.title,
						source: { kind: "red_main", fingerprint: q.fingerprint },
						mode: mode?.id,
					});
				return "/floor";
			});
		rows.push(
			item(
				"red",
				`Fix everything red${named}: ${plural(red.length, "project")}`,
				() =>
					merges
						? setAsking({
								title: `${mode?.name} on ${plural(red.length, "red project")}?`,
								description:
									"The factory merges each fix as soon as its gates pass, without you reading it. Stopping the line still stops it.",
								action: `Start with ${mode?.name}`,
								go,
							})
						: go(),
				red.length === 0 ? "Nothing is red" : null,
			),
		);
	}
	return (
		<>
			<Command.Group forceMount heading="Fix">
				{rows}
			</Command.Group>
			{run.error && (
				<p role="alert" className="m-0 p-3 text-status-fail">
					{run.error}
				</p>
			)}
			<ConfirmDialog
				open={!!asking}
				onOpenChange={(o) => !o && setAsking(null)}
				title={asking?.title}
				description={asking?.description}
				action={asking?.action}
				actionVariant="primary"
				onAction={() => {
					const go = asking?.go;
					setAsking(null);
					go?.();
				}}
			/>
		</>
	);
}

function CommandMenu() {
	const open = useOverlay(() => overlayState.menu);
	const navigate = useNavigate();
	const [q, setQ] = useState("");
	const work = useWorkOrders();
	const prs = usePrs();
	const projects = useProjects();
	const shell = useShell();
	const openNew = useOpenNewWorkOrder();
	const behind = projects.data?.filter((p) => p.toolkit.status === "behind" && !p.folderMissing) ?? [];
	const stopped = shell.data?.line.stopped;
	const lineAction = useAction(() => api.post("/api/line", { stopped: false }));

	useEffect(() => {
		if (!open) setQ("");
	}, [open]);

	const close = () => overlayState.set({ menu: false });
	const go = (to: string) => {
		close();
		void navigate({ to });
	};
	const goItems: Array<[string, string, string]> = [
		["Queue", "/", "g q"],
		["Floor", "/floor", "g f"],
		["Pull requests", "/prs", "g p"],
		["Issues", "/issues", "g i"],
		["Errors", "/errors", "g e"],
		["Environments", "/environments", "g v"],
		["Security", "/security", "g x"],
		["Projects", "/projects", "g o"],
		["Automations", "/automations", "g u"],
		["Health", "/health", "g h"],
		["Improve yourself", "/improve", "g y"],
		["Settings", "/settings/agents", "g s"],
	];

	return (
		<Command.Dialog
			open={open}
			onOpenChange={(o) => overlayState.set({ menu: o })}
			label="Search or run a command"
			loop
			overlayClassName="fixed inset-0 z-20 bg-scrim"
			contentClassName="fixed left-1/2 top-24 z-30 box-border w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 rounded-md border border-solid border-border-control bg-bg-raised shadow-dialog"
		>
			<Command.Input
				value={q}
				onValueChange={setQ}
				placeholder="Search or run a command"
				className="box-border h-11 w-full rounded-t-md border-0 border-b border-solid border-border-subtle bg-transparent px-4 outline-none"
			/>
			<Command.List className="max-h-[50vh] overflow-y-auto p-2">
				<Command.Empty>
					<div role="status" className="flex flex-col items-start gap-2 p-3">
						<span>No results for ‘{q}’.</span>
						<div className="flex flex-wrap gap-2">
							<Button
								onClick={() => {
									close();
									openNew({ text: q });
								}}
							>
								New work order from this
							</Button>
							<Button onClick={() => setQ("")}>Clear search</Button>
						</div>
					</div>
				</Command.Empty>
				<FixCommands text={q} onDone={go} />
				<Command.Group heading="Go to">
					{goItems.map(([label, to, key]) => (
						<Command.Item key={to} className={ITEM} value={label} onSelect={() => go(to)}>
							{label}
							<Key>{key}</Key>
						</Command.Item>
					))}
				</Command.Group>
				<Command.Group heading="Actions">
					<Command.Item
						className={ITEM}
						value="New work order"
						onSelect={() => {
							close();
							openNew();
						}}
					>
						New work order
						<Key>n</Key>
					</Command.Item>
					<Command.Item className={ITEM} value="New project" onSelect={() => go("/projects/new/describe")}>
						New project
					</Command.Item>
					{behind.length > 0 && (
						<Command.Item
							className={ITEM}
							value={`Sync ${behind.length} toolkit`}
							onSelect={() => go("/projects")}
						>
							Sync {plural(behind.length, "project")} behind on the toolkit
						</Command.Item>
					)}
					{stopped ? (
						<Command.Item
							className={ITEM}
							value="Restart the line"
							onSelect={() => {
								close();
								void lineAction.run();
							}}
						>
							Restart the line
						</Command.Item>
					) : (
						<Command.Item
							className={ITEM}
							value="Stop the line"
							onSelect={() => overlayState.set({ menu: false, stop: true })}
						>
							Stop the line
						</Command.Item>
					)}
				</Command.Group>
				{((work.data?.length ?? 0) > 0 || (prs.data?.length ?? 0) > 0) && (
					<Command.Group heading="Work">
						{work.data?.map((w) => (
							<Command.Item
								key={`wo-${w.id}`}
								className={ITEM}
								value={`WO-${w.id} ${w.title} ${w.id}`}
								keywords={[w.projectName]}
								onSelect={() => go(`/work-orders/${w.id}`)}
							>
								WO-{w.id} {w.title}
							</Command.Item>
						))}
						{prs.data?.map((p) => (
							<Command.Item
								key={`pr-${p.project}-${p.number}`}
								className={ITEM}
								value={`#${p.number} ${p.title} ${p.project}`}
								keywords={[p.projectName]}
								onSelect={() => go(`/prs/${p.project}/${p.number}`)}
							>
								#{p.number} {p.title}
							</Command.Item>
						))}
					</Command.Group>
				)}
			</Command.List>
			<div className="flex flex-wrap gap-3 border-0 border-t border-solid border-border-subtle px-4 py-2 text-meta text-text-muted">
				<span>
					<span className="font-mono">↑ ↓</span> move
				</span>
				<span>
					<span className="font-mono">↵</span> open
				</span>
				<span>
					<span className="font-mono">esc</span> close
				</span>
			</div>
		</Command.Dialog>
	);
}

/* ---------- setup layout ---------- */

/** First run and new project: wordmark and step rail on the left, one 720px column on the right. */
export function SetupLayout({
	steps,
	current,
	title,
	lead,
	crumbs,
	children,
}: {
	steps: string[];
	current: number;
	title: ReactNode;
	lead?: ReactNode;
	crumbs?: ComponentProps<typeof Breadcrumb>["crumbs"];
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-wrap items-stretch bg-bg-canvas">
			<a className="skip-link" href="#main">
				Skip to content
			</a>
			<div className="sf-rail box-border flex max-w-[280px] flex-[1_1_240px] flex-col gap-6 border-0 border-e border-solid border-border-subtle bg-bg-surface px-6 py-5">
				<div className="text-detail-title">Software Factory</div>
				<ol aria-label="Steps" className="m-0 flex list-none flex-col gap-1 p-0">
					{steps.map((s, i) => (
						<li
							key={s}
							aria-current={i === current ? "step" : undefined}
							className={`flex min-h-8 items-center gap-2 ${i === current ? "font-semibold" : i > current ? "text-text-muted" : ""}`}
						>
							<Glyph kind={i < current ? "pass" : i === current ? "run" : "idle"} />
							<span>{s}</span>
						</li>
					))}
				</ol>
			</div>
			<main id="main" className="box-border flex min-w-0 flex-[999_1_560px] justify-center px-6 py-8">
				<div className="flex min-w-0 max-w-[720px] flex-[1_1_560px] flex-col gap-5">
					{crumbs && <Breadcrumb crumbs={crumbs} />}
					<div className="flex flex-col gap-1">
						<h1 className="m-0 text-page-title">{title}</h1>
						{lead && <p className="m-0 max-w-[62ch] text-text-muted">{lead}</p>}
					</div>
					{children}
				</div>
			</main>
		</div>
	);
}
