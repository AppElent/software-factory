import { Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import type { RepoChoice, ToolStatus } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, list, plural } from "../format.ts";
import {
	Banner,
	Button,
	ButtonLink,
	CodeBlock,
	Glyph,
	InlineError,
	LoadFailed,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useReading, useRepos, useTools } from "../queries.ts";
import { SetupLayout } from "../shell.tsx";

const STEPS = ["Check your tools", "Choose projects", "Read projects", "Open your queue"];

export function WelcomeScreen() {
	const { step } = useParams({ strict: false }) as { step?: string };
	if (step === "tools") return <ToolsStep />;
	if (step === "repos") return <ReposStep />;
	if (step === "reading") return <ReadingStep />;
	return <Navigate to="/welcome/$step" params={{ step: "tools" }} replace />;
}

const RowsLoading = ({ label }: { label: string }) => (
	<div role="status" className="flex flex-col gap-4">
		<span className="text-text-muted">{label}</span>
		<Skeleton width="70%" />
		<Skeleton width="55%" />
		<Skeleton width="62%" />
	</div>
);

/* ---------- tools ---------- */

/** The service joins the status and the reason. The rows show them apart. */
const toolWhy = (t: ToolStatus) => t.detail.replace(/^Not (signed in|installed)\. ?/, "");

function ToolRow({
	tool,
	blocked,
	checking,
	onCheck,
}: {
	tool: ToolStatus;
	blocked: boolean;
	checking: boolean;
	onCheck: () => void;
}) {
	const bad = tool.state !== "ready";
	const required = bad && tool.required;
	const busy = checking && bad;
	const glyph = !bad
		? "pass"
		: busy
			? "run"
			: required || (!blocked && tool.state === "signed_out")
				? "fail"
				: "idle";
	const word = !bad
		? tool.detail
		: busy
			? "Checking"
			: tool.state === "signed_out"
				? "Not signed in"
				: tool.state === "missing"
					? "Not installed"
					: tool.detail;
	return (
		<div className="flex flex-col gap-2 border-0 border-b border-solid border-border-subtle py-3">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Glyph kind={glyph} />
				<span className="w-[136px] font-mono text-data">{tool.name}</span>
				<span className="flex-[1_1_240px] text-text-muted">{tool.purpose}</span>
				<span className="font-medium">{word}</span>
			</div>
			{required && (
				<div className="flex flex-col gap-2 ps-7">
					{tool.fix && <CodeBlock>{tool.fix}</CodeBlock>}
					<span className="text-meta text-text-muted">{toolWhy(tool)}</span>
				</div>
			)}
			{bad && !required && blocked && <div className="ps-7 text-meta text-text-muted">{toolWhy(tool)}</div>}
			{bad && !required && !blocked && tool.state === "missing" && (
				<div className="ps-7 text-meta text-text-muted">
					{toolWhy(tool)} Install it with{" "}
					<span className="font-mono text-data text-text-primary">{tool.fix}</span>
				</div>
			)}
			{bad && !required && !blocked && tool.state !== "missing" && (
				<div className="flex flex-col gap-2 ps-7">
					{tool.fix && <CodeBlock>{tool.fix}</CodeBlock>}
					<div>
						<Button disabled={checking} onClick={onCheck}>
							{checking ? "Checking…" : "Check again"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function ToolsStep() {
	const tools = useTools();
	const check = useAction(() => api.post<ToolStatus[]>("/api/tools/check"));
	const missing = tools.data?.filter((t) => t.required && t.state !== "ready") ?? [];
	const blocked = missing.length > 0;
	const later = tools.data?.filter((t) => !t.required && t.state !== "ready") ?? [];
	const need = missing.map((t) => `${t.state === "missing" ? "Install" : "Sign in to"} ${t.name}`);
	const first = need[0] ?? "";
	return (
		<SetupLayout
			steps={STEPS}
			current={0}
			title="Check your tools"
			lead="Software Factory runs on the tools you already use. Nothing has been changed on this Mac."
		>
			{tools.isError ? (
				<>
					<LoadFailed what="your tools" error={tools.error} />
					<div>
						<Button disabled={tools.isFetching} onClick={() => void tools.refetch()}>
							Check again
						</Button>
					</div>
				</>
			) : !tools.data ? (
				<RowsLoading label="Checking your tools" />
			) : (
				<>
					<div>
						{tools.data.map((t) => (
							<ToolRow
								key={t.name}
								tool={t}
								blocked={blocked}
								checking={check.pending}
								onCheck={() => void check.run()}
							/>
						))}
					</div>
					<InlineError>{check.error && "Couldn't check this. Try again."}</InlineError>
					<div className="flex flex-wrap items-center gap-3">
						{blocked ? (
							<>
								<Button variant="primary" disabled={check.pending} onClick={() => void check.run()}>
									{check.pending ? "Checking…" : "Check again"}
								</Button>
								<span className="text-meta text-text-muted">
									{[first, ...need.slice(1).map((n) => n.charAt(0).toLowerCase() + n.slice(1))].join(" and ")}{" "}
									to continue.
								</span>
							</>
						) : (
							<>
								<ButtonLink variant="primary" to="/welcome/$step" params={{ step: "repos" }}>
									Continue
								</ButtonLink>
								{later.length > 0 && (
									<span className="text-meta text-text-muted">
										You can fix {list(later.map((t) => t.name))} later. They show in Later on the queue.
									</span>
								)}
							</>
						)}
					</div>
				</>
			)}
		</SetupLayout>
	);
}

/* ---------- repos ---------- */

function RepoRow({
	repo,
	on,
	onFlip,
	cloned,
	onCloned,
}: {
	repo: RepoChoice;
	on: boolean;
	onFlip: () => void;
	cloned: string | undefined;
	onCloned: (path: string) => void;
}) {
	const clone = useAction(
		() => api.post<{ ok: boolean; path: string }>("/api/repos/clone", { repo: repo.repo }),
		{
			onSuccess: (r) => onCloned(r.path),
		},
	);
	const path = repo.localPath ?? cloned;
	return (
		<div className="flex flex-col gap-1 border-0 border-b border-solid border-border-subtle">
			<div className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-1">
				<label className="flex min-h-row min-w-0 flex-[1_1_240px] cursor-pointer items-center gap-2">
					<input type="checkbox" checked={on || repo.added} disabled={repo.added} onChange={onFlip} />
					<span className="font-medium [overflow-wrap:anywhere]">{repo.name}</span>
					{repo.added && <span className="text-meta text-text-muted">In the factory</span>}
				</label>
				<span className="text-meta text-text-muted">{ago(repo.pushedAt)}</span>
				<span className="flex w-[200px] max-w-full items-center gap-2">
					{path ? (
						<span className="min-w-0 font-mono text-data text-text-muted [overflow-wrap:anywhere]">
							{path}
						</span>
					) : clone.pending ? (
						<Button disabled>Cloning…</Button>
					) : (
						<>
							<span className="text-meta text-text-muted">Not on this Mac</span>
							<Button aria-label={`Clone ${repo.name}`} onClick={() => void clone.run()}>
								Clone
							</Button>
						</>
					)}
				</span>
			</div>
			<InlineError>{clone.error && "Couldn't clone this. Try again."}</InlineError>
		</div>
	);
}

/** The repo list, shared by first run and Settings › Projects › Add projects. */
export function RepoChooser({
	primary,
	secondary,
	onDone,
}: {
	primary: string;
	secondary: ReactNode;
	onDone: () => void;
}) {
	const repos = useRepos();
	const [q, setQ] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [cloned, setCloned] = useState<Record<string, string>>({});
	const [empty, setEmpty] = useState(false);
	const [failures, setFailures] = useState<Array<{ repo: string; reason: string }>>([]);
	const add = useAction(
		() =>
			api.post<{ added: string[]; failed: Array<{ repo: string; reason: string }> }>("/api/projects", {
				repos: [...selected].map((repo) => ({ repo, clone: !!cloned[repo] })),
			}),
		{
			onSuccess: (r) => {
				setFailures(r.failed);
				setSelected(new Set(r.failed.map((f) => f.repo)));
				if (r.failed.length === 0) onDone();
			},
		},
	);

	if (repos.isError) {
		return (
			<>
				<LoadFailed what="your repos" error={repos.error} />
				<div className="flex flex-wrap gap-2">
					<Button disabled={repos.isFetching} onClick={() => void repos.refetch()}>
						Check again
					</Button>
					{secondary}
				</div>
			</>
		);
	}
	if (!repos.data) return <RowsLoading label="Reading your repo list from GitHub" />;

	const all = repos.data.repos;
	const t = q.trim().toLowerCase();
	const shown = t ? all.filter((r) => r.repo.toLowerCase().includes(t)) : all;
	const inFactory = all.some((r) => r.added);
	const skipped = repos.data.skipped;

	const submit = () => {
		if (selected.size === 0) {
			if (inFactory && primary === "Continue") onDone();
			else setEmpty(true);
			return;
		}
		void add.run();
	};

	return (
		<>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<input
					type="search"
					aria-label="Search repos"
					placeholder={`Search ${plural(all.length, "repo")}`}
					className="min-w-0 flex-[1_1_240px]"
					value={q}
					onChange={(e) => setQ(e.target.value)}
				/>
				<StatusLine className="font-mono text-data tabular-nums text-text-muted">
					{selected.size} of {all.length} selected
				</StatusLine>
			</div>
			<div className="flex flex-col">
				{shown.map((r) => (
					<RepoRow
						key={r.repo}
						repo={r}
						on={selected.has(r.repo)}
						cloned={cloned[r.repo]}
						onCloned={(path) => setCloned((c) => ({ ...c, [r.repo]: path }))}
						onFlip={() => {
							setEmpty(false);
							setSelected((s) => {
								const next = new Set(s);
								if (!next.delete(r.repo)) next.add(r.repo);
								return next;
							});
						}}
					/>
				))}
				{shown.length === 0 && (
					<p className="m-0 py-3 text-text-muted [overflow-wrap:anywhere]">
						{t ? `No repos match ‘${q}’.` : "No repos found on GitHub."}
					</p>
				)}
			</div>
			{skipped > 0 && (
				<Banner
					title={`${plural(skipped, "repo")} skipped before reading`}
					body={`${skipped === 1 ? "1 repo matches a Never touch rule" : `${skipped} repos match a Never touch rule`}, so nothing in them was opened.`}
				/>
			)}
			{empty && (
				<p role="alert" className="m-0 flex items-center gap-2 text-status-fail">
					<Glyph kind="fail" size={14} />
					Turn on at least one project to continue.
				</p>
			)}
			{failures.map((f) => (
				<InlineError key={f.repo}>
					Couldn't add {f.repo.split("/")[1] ?? f.repo}. {f.reason}
				</InlineError>
			))}
			<InlineError>{add.error && "Couldn't add this. Try again."}</InlineError>
			<div className="flex flex-wrap gap-2">
				<Button variant="primary" disabled={add.pending} onClick={submit}>
					{primary}
				</Button>
				{secondary}
			</div>
		</>
	);
}

function ReposStep() {
	const navigate = useNavigate();
	return (
		<SetupLayout
			steps={STEPS}
			current={1}
			title="Choose projects"
			lead="Everything starts off. Only the projects you turn on get read, and reading doesn't change anything."
		>
			<RepoChooser
				primary="Continue"
				secondary={
					<ButtonLink to="/welcome/$step" params={{ step: "tools" }}>
						Back
					</ButtonLink>
				}
				onDone={() => void navigate({ to: "/welcome/$step", params: { step: "reading" } })}
			/>
		</SetupLayout>
	);
}

/* ---------- reading ---------- */

function ReadingStep() {
	const navigate = useNavigate();
	const reading = useReading();
	const open = useAction(
		async () => {
			// The banner on the queue comes from these two: one marks it, the other turns it on for this visit.
			await api.post("/api/first-look");
			await api.post("/api/visit");
		},
		{ onSuccess: () => void navigate({ to: "/" }) },
	);
	const projects = reading.data?.projects;
	const busy = projects?.filter((p) => p.state === "reading") ?? [];
	const n = projects?.length ?? 0;
	if (projects && n === 0) return <Navigate to="/welcome/$step" params={{ step: "repos" }} replace />;
	const warned = projects?.filter((p) => p.warning) ?? [];
	return (
		<SetupLayout
			steps={STEPS}
			current={2}
			title={
				!projects
					? "Reading your projects"
					: busy.length > 0
						? `Reading ${plural(n, "project")}`
						: `Read ${plural(n, "project")}`
			}
			lead="Reading only. No branches, no commits, no agents."
		>
			{reading.isError && !projects ? (
				<LoadFailed what="your projects" error={reading.error} />
			) : !projects ? (
				<RowsLoading label="Starting to read" />
			) : (
				<>
					<div role="status">
						{projects.map((p) => (
							<div
								key={p.slug}
								className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 border-0 border-b border-solid border-border-subtle py-2"
							>
								<Glyph kind={p.state === "done" ? "pass" : "run"} />
								<span className="w-[140px] font-medium [overflow-wrap:anywhere]">{p.name}</span>
								<span className="flex-[1_1_240px] text-text-muted">{p.summary}</span>
							</div>
						))}
					</div>
					{warned.map((p) => (
						<Banner
							key={p.slug}
							glyph="idle"
							title={p.warning}
							body="You can still see its PRs. Its errors won't reach the queue until you connect it in Projects."
						/>
					))}
					<InlineError>{open.error && "Couldn't open this. Try again."}</InlineError>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							variant="primary"
							disabled={!reading.data?.ready || open.pending}
							onClick={() => void open.run()}
						>
							Open your queue
						</Button>
						{busy.length > 0 && reading.data?.ready && (
							<span className="text-meta text-text-muted">
								{list(busy.map((p) => p.name))} {busy.length === 1 ? "joins" : "join"} the queue when{" "}
								{busy.length === 1 ? "it finishes" : "they finish"}.
							</span>
						)}
					</div>
				</>
			)}
		</SetupLayout>
	);
}
