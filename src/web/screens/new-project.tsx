import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { NewProjectLogLine, NewProjectRun, NewProjectStep } from "../../shared/types.ts";
import { ApiFailure, api } from "../api.ts";
import {
	Button,
	ButtonLink,
	Choice,
	CodeBlock,
	Facts,
	Field,
	Glyph,
	type GlyphKind,
	InlineConfirm,
	InlineError,
	LnkOut,
	LoadFailed,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useSettings } from "../queries.ts";
import { SetupLayout } from "../shell.tsx";

const STEPS = ["Describe", "Approve changes", "Scaffold", "Connect services", "First idea"];
const RAIL: Record<NewProjectStep, number> = {
	describe: 0,
	approve: 1,
	scaffold: 2,
	failed: 2,
	baseline: 2,
	connect: 3,
	done: 4,
};

const TEMPLATES = [
	{ id: "expo", name: "Expo app", desc: "iOS, Android, and web from one codebase. EAS builds." },
	{ id: "vite", name: "Vite web app", desc: "React with TanStack Router. Deploys to Cloudflare." },
	{ id: "node", name: "Node service", desc: "Hono API. Deploys to Cloudflare Workers." },
	{ id: "bare", name: "Toolkit only", desc: "Standards, CI, and agents setup with no app code." },
];
const templateName = (id: string) => TEMPLATES.find((t) => t.id === id)?.name ?? id;

function Setup({
	step,
	title,
	lead,
	children,
}: {
	step: NewProjectStep;
	title: ReactNode;
	lead?: ReactNode;
	children: ReactNode;
}) {
	return (
		<SetupLayout
			steps={STEPS}
			current={RAIL[step]}
			title={title}
			lead={lead}
			crumbs={[{ label: "Projects", link: { to: "/projects" } }, { label: "New project" }]}
		>
			{children}
		</SetupLayout>
	);
}

export function NewProjectScreen() {
	const { step = "describe" } = useParams({ strict: false }) as { step?: string };
	const { run } = useSearch({ strict: false }) as { run?: number };
	if (step === "describe") return <Describe key={run ?? "new"} runId={run} />;
	if (!run) return <Navigate to="/projects/new/$step" params={{ step: "describe" }} replace />;
	return <RunPage key={run} id={run} step={step} />;
}

const useRun = (id: number | undefined) =>
	useQuery({
		queryKey: ["new-project", String(id)],
		queryFn: () => api.get<NewProjectRun>(`/api/new-project/${id}`),
		enabled: id != null,
		refetchInterval: (q) => (q.state.data?.step === "scaffold" ? 1000 : false),
	});

/** The run decides what can show. A finished scaffold can still be looked at, and Connect leads to Done. */
function viewFor(run: NewProjectRun, wanted: string): NewProjectStep {
	if (run.step === "connect" && (wanted === "scaffold" || wanted === "done")) return wanted;
	return run.step;
}

function RunPage({ id, step }: { id: number; step: string }) {
	const navigate = useNavigate();
	const query = useRun(id);
	const run = query.data;
	const view = run ? viewFor(run, step) : null;
	useEffect(() => {
		if (view && view !== step) {
			void navigate({
				to: "/projects/new/$step",
				params: { step: view },
				search: { run: id },
				replace: true,
			});
		}
	}, [view, step, id, navigate]);

	if (!run) {
		if (query.isError) {
			return (
				<Setup step="describe" title="New project">
					<LoadFailed what="this new project" error={query.error} />
					<div>
						<ButtonLink to="/projects/new/$step" params={{ step: "describe" }}>
							Start again
						</ButtonLink>
					</div>
				</Setup>
			);
		}
		return (
			<Setup step="scaffold" title="New project">
				<div role="status" className="flex flex-col gap-3">
					<span className="text-text-muted">Loading this new project</span>
					<Skeleton width="70%" />
					<Skeleton width="55%" />
				</div>
			</Setup>
		);
	}
	if (view === "approve") return <Approve run={run} />;
	if (view === "scaffold") return <Scaffold run={run} />;
	if (view === "failed") return <Failed run={run} />;
	if (view === "baseline") return <Baseline run={run} />;
	if (view === "connect") return <Connect run={run} />;
	return <Done run={run} />;
}

/* ---------- describe ---------- */

function Describe({ runId }: { runId: number | undefined }) {
	const navigate = useNavigate();
	const settings = useSettings();
	const existing = useRun(runId);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [template, setTemplate] = useState("expo");
	const [visibility, setVisibility] = useState<"private" | "public">("private");
	const [nameError, setNameError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	// Change something comes back here with what was entered before.
	const filled = useRef(false);
	useEffect(() => {
		const run = existing.data;
		if (!run || filled.current) return;
		filled.current = true;
		setName(run.name);
		setDescription(run.description);
		setTemplate(run.template);
		setVisibility(run.visibility);
	}, [existing.data]);

	const refuse = (problem: string) => {
		setNameError(problem);
		nameRef.current?.focus();
	};

	const create = useAction(
		async () => {
			const trimmed = name.trim();
			const check = await api.post<{ problem: string | null }>("/api/new-project/check", { name: trimmed });
			if (check.problem) return { problem: check.problem, id: 0 };
			const made = await api.post<{ id: number }>("/api/new-project", {
				name: trimmed,
				description,
				template,
				visibility,
			});
			// The earlier draft created nothing yet, so nothing is left behind.
			if (existing.data?.step === "approve") {
				await api.post(`/api/new-project/${existing.data.id}/remove`).catch(() => undefined);
			}
			return { problem: null, id: made.id };
		},
		{
			onSuccess: (r) => {
				if (r.problem) refuse(r.problem);
				else
					void navigate({
						to: "/projects/new/$step",
						params: { step: "approve" },
						search: { run: r.id } as never,
					});
			},
		},
	);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			refuse("Enter a name for the project.");
			return;
		}
		void create.run();
	};

	const folder = settings.data?.projects.cloneFolder;
	return (
		<Setup step="describe" title="New project" lead="Nothing is created until you approve the next step.">
			<form onSubmit={submit} noValidate className="flex flex-col gap-5">
				<Field
					label="Name"
					hint={`Becomes the repo name and the folder in ${folder ?? "your clone folder"}.`}
					error={nameError}
				>
					{(p) => (
						<input
							{...p}
							ref={nameRef}
							type="text"
							value={name}
							onChange={(e) => {
								setName(e.target.value);
								setNameError(null);
							}}
						/>
					)}
				</Field>
				<Field label="What is it for?" hint="Agents read this as the project brief.">
					{(p) => (
						<textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
					)}
				</Field>
				<fieldset className="m-0 flex flex-col border-0 p-0">
					<legend className="mb-1 p-0 font-medium">Toolkit template</legend>
					{TEMPLATES.map((t) => (
						<Choice
							key={t.id}
							type="radio"
							name="template"
							title={t.name}
							description={t.desc}
							checked={template === t.id}
							onChange={() => setTemplate(t.id)}
						/>
					))}
				</fieldset>
				<fieldset className="m-0 flex flex-col border-0 p-0">
					<legend className="mb-1 p-0 font-medium">Repo visibility</legend>
					<Choice
						type="radio"
						name="visibility"
						title="Private"
						description="Only you can see it."
						checked={visibility === "private"}
						onChange={() => setVisibility("private")}
					/>
					<Choice
						type="radio"
						name="visibility"
						title="Public"
						description="Anyone can see the code."
						checked={visibility === "public"}
						onChange={() => setVisibility("public")}
					/>
				</fieldset>
				<InlineError>{create.error && `Couldn't create this. ${create.error}`}</InlineError>
				<div className="flex flex-wrap gap-2">
					<Button type="submit" variant="primary" disabled={create.pending}>
						Continue
					</Button>
					<ButtonLink to="/projects">Cancel</ButtonLink>
				</div>
			</form>
		</Setup>
	);
}

/* ---------- approve ---------- */

function Approve({ run }: { run: NewProjectRun }) {
	const approve = useAction(() => api.post(`/api/new-project/${run.id}/approve`));
	const rows: Array<[string, string]> = [
		["Create the GitHub repo", `${run.repo} · ${run.visibility}`],
		["Create the local folder", run.localPath],
		[
			`Apply the ${templateName(run.template)} template`,
			"From developer-tools, then the first commit on main",
		],
		["Add it to T3", "So agents can open threads and worktrees here"],
	];
	return (
		<Setup
			step="approve"
			title="Approve these changes"
			lead="These happen outside this app. Nothing has been created yet."
		>
			<div className="flex flex-col">
				{rows.map(([what, detail]) => (
					<div
						key={what}
						className="box-border flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 border-0 border-b border-solid border-border-subtle py-1"
					>
						<Glyph kind="idle" />
						<span className="flex-[1_1_240px] font-medium">{what}</span>
						<span className="min-w-0 font-mono text-data text-text-muted [overflow-wrap:anywhere]">
							{detail}
						</span>
					</div>
				))}
			</div>
			<p className="m-0 text-text-muted">
				Services come after the first green build, and you confirm each one then.
			</p>
			<InlineError>{approve.error && "Couldn't start this. Try again."}</InlineError>
			<div className="flex flex-wrap gap-2">
				<Button variant="primary" disabled={approve.pending} onClick={() => void approve.run()}>
					Approve and create
				</Button>
				<ButtonLink to="/projects/new/$step" params={{ step: "describe" }} search={{ run: run.id } as never}>
					Change something
				</ButtonLink>
			</div>
		</Setup>
	);
}

/* ---------- the step log ---------- */

const LOG_GLYPH: Record<NewProjectLogLine["state"], GlyphKind> = {
	done: "pass",
	running: "run",
	failed: "fail",
	pending: "idle",
};

function logWords(line: NewProjectLogLine, run: NewProjectRun): string {
	const tpl = `${templateName(run.template)} template`;
	const s = line.state;
	switch (line.step) {
		case "repo":
			return s === "done"
				? `Created ${run.repo}`
				: s === "running"
					? `Creating ${run.repo}`
					: `Create ${run.repo}`;
		case "folder":
			return s === "done"
				? `Created ${run.localPath}`
				: s === "running"
					? `Creating ${run.localPath}`
					: `Create ${run.localPath}`;
		case "template":
			return s === "done" || s === "failed"
				? `Applied the ${tpl}`
				: s === "running"
					? `Applying the ${tpl}`
					: `Apply the ${tpl}`;
		case "baseline": {
			if (s === "failed") {
				const which = /\b(typecheck|tests?|lint)\b/i.exec(line.detail ?? "")?.[1]?.toLowerCase();
				return which ? `Baseline: ${which}` : "Baseline failed";
			}
			if (s === "done") return "Ran the baseline: typecheck, tests, lint";
			return s === "running" ? "Running the baseline: typecheck, tests, lint" : "Run the baseline";
		}
		default:
			return s === "done" ? "Added it to T3" : s === "running" ? "Adding it to T3" : "Add it to T3";
	}
}

function LogRows({ run, lines }: { run: NewProjectRun; lines: NewProjectLogLine[] }) {
	return (
		<>
			{lines.map((line) => (
				<div
					key={line.step}
					className="flex flex-col gap-2 border-0 border-b border-solid border-border-subtle px-3 py-2"
				>
					<div className="flex min-h-7 items-center gap-3">
						<Glyph kind={LOG_GLYPH[line.state]} />
						<span className="min-w-0 flex-[1_1_0] [overflow-wrap:anywhere]">{logWords(line, run)}</span>
						{line.at && <span className="font-mono text-data tabular-nums text-text-muted">{line.at}</span>}
					</div>
					{line.state === "failed" && <CodeBlock>{line.detail ?? run.failure}</CodeBlock>}
				</div>
			))}
		</>
	);
}

/* ---------- scaffold ---------- */

function Scaffold({ run }: { run: NewProjectRun }) {
	const green = run.step === "connect";
	return (
		<Setup
			step="scaffold"
			title={`Building ${run.name}`}
			lead="You can leave this page. It keeps going, and the queue tells you when it needs you."
		>
			<div role="status" className="flex flex-col">
				<LogRows run={run} lines={run.log} />
			</div>
			<div className="flex flex-wrap gap-2">
				{green ? (
					<ButtonLink
						variant="primary"
						to="/projects/new/$step"
						params={{ step: "connect" }}
						search={{ run: run.id } as never}
					>
						Connect services
					</ButtonLink>
				) : (
					<Button variant="primary" disabled>
						Connect services
					</Button>
				)}
				<ButtonLink to="/">Back to the queue</ButtonLink>
			</div>
		</Setup>
	);
}

/* ---------- failed ---------- */

const STEP_WORD: Record<string, string> = {
	repo: "repo",
	folder: "folder",
	template: "template",
	baseline: "baseline",
	t3: "T3",
};

function RemoveRun({ run }: { run: NewProjectRun }) {
	const navigate = useNavigate();
	const remove = useAction(
		async () => {
			const res = await api.post<{ ok: boolean; reason?: string }>(`/api/new-project/${run.id}/remove`);
			if (!res.ok) throw new ApiFailure(res.reason ?? "It wasn't removed.", 502);
		},
		{ onSuccess: () => void navigate({ to: "/projects" }) },
	);
	const hasRepo = run.created.some((c) => c.startsWith("repo:"));
	const hasFolder = run.created.some((c) => c.startsWith("folder:"));
	const unsure = Boolean(run.claimed?.length);
	const deletes = [
		hasRepo ? `the ${run.repo} repo on GitHub` : null,
		hasFolder ? `the ${run.localPath} folder` : null,
	].filter(Boolean);
	return (
		<InlineConfirm
			grow={false}
			label="Remove what was created"
			title={
				<div className="flex flex-col gap-2">
					<strong>Remove {run.name}?</strong>
					<p className="m-0 text-text-muted [overflow-wrap:anywhere]">
						{deletes.length > 0
							? `This deletes ${deletes.join(" and ")}. It can't be undone.`
							: unsure
								? `This deletes nothing outside this app. Check GitHub for ${run.repo} and ${run.localPath} yourself, since the restart may have left them.`
								: "Nothing was created outside this app, so nothing else is deleted."}
					</p>
				</div>
			}
			keep="Keep it"
			confirm={hasRepo && hasFolder ? "Remove repo and folder" : hasRepo ? "Remove repo" : "Remove"}
			pending={remove.pending}
			onConfirm={() => void remove.run()}
			error={remove.error && `Couldn't remove this. ${remove.error}`}
		/>
	);
}

function Failed({ run }: { run: NewProjectRun }) {
	const retry = useAction(() => api.post(`/api/new-project/${run.id}/retry`));
	const step = run.log.find((l) => l.state === "failed")?.step ?? "template";
	const hasRepo = run.created.some((c) => c.startsWith("repo:"));
	const hasFolder = run.created.some((c) => c.startsWith("folder:"));
	// A step that was running when the service stopped may have made something this run can't prove is its own.
	const unsure = Boolean(run.claimed?.length);
	const exists =
		hasRepo && hasFolder
			? "The repo and folder exist, so you can retry from here."
			: hasRepo
				? "The repo exists, so you can retry from here."
				: unsure
					? "The service restarted partway, so you can retry from here."
					: "Nothing was created, so you can retry from here.";
	return (
		<Setup
			step="failed"
			title={`${run.name} couldn't be built`}
			lead={`The ${STEP_WORD[step] ?? step} step failed. ${exists}`}
		>
			<div className="flex flex-col">
				<LogRows run={run} lines={run.log} />
			</div>
			<InlineError>{retry.error && "Couldn't retry this. Try again."}</InlineError>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary" disabled={retry.pending} onClick={() => void retry.run()}>
					Retry this step
				</Button>
				<RemoveRun run={run} />
			</div>
		</Setup>
	);
}

/* ---------- baseline red ---------- */

function Baseline({ run }: { run: NewProjectRun }) {
	const navigate = useNavigate();
	const start = useAction(
		() =>
			api.post<{ id: number }>("/api/work-orders", {
				project: run.projectSlug,
				type: "Bug fix",
				title: "Fix the red baseline",
				description: "The baseline failed on a new project. Make it pass.",
				source: { kind: "new_project", newProjectId: run.id },
			}),
		{ onSuccess: (r) => void navigate({ to: "/work-orders/$id", params: { id: String(r.id) } }) },
	);
	const retry = useAction(() => api.post(`/api/new-project/${run.id}/retry`));
	return (
		<Setup
			step="baseline"
			title="The baseline is red"
			lead="The template built, but a check failed. An agent can fix it."
		>
			<div className="flex flex-col">
				<LogRows run={run} lines={run.log.filter((l) => l.state !== "pending")} />
			</div>
			<InlineError>{start.error && "Couldn't start this. Try again."}</InlineError>
			<InlineError>{retry.error && "Couldn't retry this. Try again."}</InlineError>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="primary"
					disabled={start.pending || !run.projectSlug}
					onClick={() => void start.run()}
				>
					Start work order
				</Button>
				<Button disabled={retry.pending} onClick={() => void retry.run()}>
					Run the baseline again
				</Button>
				<RemoveRun run={run} />
			</div>
		</Setup>
	);
}

/* ---------- connect ---------- */

const SERVICES = [
	{
		id: "sentry",
		name: "Sentry",
		does: (run: NewProjectRun) => `Create the project ${run.name} and add its DSN to secrets.`,
		why: "Errors reach the queue.",
	},
	{
		id: "eas",
		name: "EAS",
		does: () => "Create the project and link it to the repo.",
		why: "Builds and deploys are tracked.",
	},
	{
		id: "infisical",
		name: "Infisical",
		does: () => "Create the project and keep its secrets there.",
		why: "Secrets stay out of the repo.",
	},
];

function ServiceRow({ run, service }: { run: NewProjectRun; service: (typeof SERVICES)[number] }) {
	const state = run.services[service.id] ?? "open";
	const tool = run.serviceTools[service.id];
	const installed = tool?.installed !== false;
	const connect = useAction(async () => {
		const res = await api.post<{ ok: boolean; reason?: string }>(`/api/new-project/${run.id}/connect`, {
			service: service.id,
		});
		if (!res.ok) throw new ApiFailure(res.reason ?? "It didn't connect.", 502);
	});
	const set = useAction((next: "open" | "skipped") =>
		api.post(`/api/new-project/${run.id}/service`, { service: service.id, state: next }),
	);
	return (
		<div className="box-border flex min-h-[60px] flex-col gap-2 border-0 border-b border-solid border-border-subtle py-2">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<div className="min-w-0 flex-[1_1_280px]">
					<div className="font-medium">{service.name}</div>
					<span className="text-meta text-text-muted">
						{installed ? (
							`${service.does(run)} ${service.why}`
						) : (
							<>
								Not installed on this Mac. {service.why}
								{tool?.fix && (
									<>
										{" "}
										Install it with <span className="font-mono text-data text-text-primary">{tool.fix}</span>
									</>
								)}
							</>
						)}
					</span>
				</div>
				{state === "connected" ? (
					<span className="flex items-center gap-2">
						<Glyph kind="pass" />
						Connected
					</span>
				) : state === "skipped" ? (
					<span className="flex items-center gap-2">
						<Glyph kind="idle" />
						Skipped
						<Button
							aria-label={`Undo skipping ${service.name}`}
							disabled={set.pending}
							onClick={() => void set.run("open")}
						>
							Undo
						</Button>
					</span>
				) : connect.pending ? (
					<Button disabled>Connecting…</Button>
				) : (
					<span className="flex flex-wrap gap-2">
						<Button disabled={!installed} onClick={() => void connect.run()}>
							Connect {service.name}
						</Button>
						<Button
							aria-label={`Skip ${service.name}`}
							disabled={set.pending}
							onClick={() => void set.run("skipped")}
						>
							Skip
						</Button>
					</span>
				)}
			</div>
			<InlineError>{connect.error && `Couldn't connect this. ${connect.error}`}</InlineError>
			<InlineError>{set.error && "Couldn't save this. Try again."}</InlineError>
		</div>
	);
}

function Connect({ run }: { run: NewProjectRun }) {
	const skipped = SERVICES.filter((s) => run.services[s.id] === "skipped").length;
	return (
		<Setup
			step="connect"
			title="Connect services"
			lead="The baseline is green. Each of these creates something outside this app, so you confirm or skip each one."
		>
			<div className="flex flex-col">
				{SERVICES.map((s) => (
					<ServiceRow key={s.id} run={run} service={s} />
				))}
			</div>
			<StatusLine className="text-text-muted">
				{skipped === 1 && "1 skipped service stays as a reminder under Later."}
				{skipped > 1 && `${skipped} skipped services stay as reminders under Later.`}
			</StatusLine>
			<div>
				<ButtonLink
					variant="primary"
					to="/projects/new/$step"
					params={{ step: "done" }}
					search={{ run: run.id } as never}
				>
					Finish
				</ButtonLink>
			</div>
		</Setup>
	);
}

/* ---------- done ---------- */

function Done({ run }: { run: NewProjectRun }) {
	const navigate = useNavigate();
	const [idea, setIdea] = useState("");
	const [blank, setBlank] = useState(false);
	const ideaRef = useRef<HTMLTextAreaElement>(null);
	const finish = useAction(
		(text: string | null) =>
			api.post<{ workOrderId: number | null }>(`/api/new-project/${run.id}/finish`, { idea: text }),
		{
			onSuccess: (r) => {
				if (r.workOrderId != null) {
					void navigate({ to: "/work-orders/$id", params: { id: String(r.workOrderId) } });
				} else {
					void navigate({ to: "/floor" });
				}
			},
		},
	);
	const start = (e: FormEvent) => {
		e.preventDefault();
		if (!idea.trim()) {
			setBlank(true);
			ideaRef.current?.focus();
			return;
		}
		void finish.run(idea.trim());
	};
	const named = (state: string) =>
		SERVICES.filter((s) => run.services[s.id] === state)
			.map((s) => s.name)
			.join(", ");
	const connected = named("connected");
	const skipped = named("skipped");
	return (
		<Setup
			step="done"
			title={`${run.name} is on the floor`}
			lead="The baseline is green and the project is open. All 4 gates are ready."
		>
			{run.step === "done" ? (
				<div className="flex flex-wrap gap-2">
					<ButtonLink variant="primary" to="/floor">
						See the floor
					</ButtonLink>
				</div>
			) : (
				<form onSubmit={start} noValidate className="flex flex-col gap-5">
					<Field
						label="What should it build first?"
						hint="This becomes the first work order. It goes to Plan and waits for your approval."
						error={blank && !idea.trim() ? "Describe the first change, or skip this for now." : undefined}
					>
						{(p) => (
							<textarea
								{...p}
								ref={ideaRef}
								rows={3}
								placeholder="A screen that lists my clubs with their average distance"
								value={idea}
								onChange={(e) => setIdea(e.target.value)}
							/>
						)}
					</Field>
					<InlineError>{finish.error && "Couldn't finish this. Try again."}</InlineError>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" variant="primary" disabled={finish.pending}>
							Start work order
						</Button>
						<Button disabled={finish.pending} onClick={() => void finish.run(null)}>
							Skip for now
						</Button>
					</div>
				</form>
			)}
			<Facts
				rows={[
					[
						"Repo",
						<LnkOut key="repo" href={`https://github.com/${run.repo}`}>
							{run.repo}
						</LnkOut>,
					],
					["Folder", run.localPath, true],
					["Services", connected || "None"],
					...(skipped ? [["Skipped", `${skipped}. Reminder under Later.`] as [ReactNode, ReactNode]] : []),
				]}
			/>
		</Setup>
	);
}
