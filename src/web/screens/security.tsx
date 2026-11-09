import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
	type ProjectSecurity,
	SEVERITIES,
	type SecurityAlert,
	type SecurityCheck,
	type SecurityStatus,
	type Severity,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, plural, span } from "../format.ts";
import {
	Button,
	ButtonOut,
	ConfirmDialog,
	Glyph,
	type GlyphKind,
	Lnk,
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
import { useAction, useSecurity } from "../queries.ts";
import { useOpenNewWorkOrder } from "../shell.tsx";

const STATUS: Record<SecurityStatus, { glyph: GlyphKind; word: string }> = {
	red: { glyph: "fail", word: "Past deadline" },
	amber: { glyph: "err", word: "Needs attention" },
	green: { glyph: "pass", word: "Clear" },
	unknown: { glyph: "idle", word: "Not read yet" },
};

const SEVERITY_WORD: Record<Severity, string> = {
	critical: "Critical",
	high: "High",
	moderate: "Moderate",
	low: "Low",
};

const CHECKS: Array<{ key: SecurityCheck; label: string; off: string }> = [
	{ key: "alerts", label: "Dependabot alerts", off: "GitHub doesn't report vulnerable dependencies." },
	{ key: "securityUpdates", label: "Security updates", off: "Dependabot doesn't open PRs for fixes." },
	{ key: "dependabotConfig", label: "dependabot.yml", off: "No grouped routine updates." },
	{
		key: "branchProtected",
		label: "Branch protection",
		off: "Anyone with push rights can push to the default branch.",
	},
];

const RANK: Record<SecurityStatus, number> = { red: 0, amber: 1, unknown: 2, green: 3 };

const ROW =
	"grid w-full cursor-pointer grid-cols-[minmax(140px,1.4fr)_minmax(150px,1fr)_repeat(4,56px)_minmax(80px,0.6fr)] items-center gap-2 rounded-sm border-0 bg-transparent px-3 py-2 text-start font-[inherit] text-text-primary";

function Counts({ p }: { p: ProjectSecurity }) {
	return (
		<>
			{SEVERITIES.map((s) => (
				<span
					key={s}
					className={`text-end font-mono text-data tabular-nums ${p.counts[s] ? "" : "text-text-muted"}`}
				>
					{p.counts[s]}
				</span>
			))}
		</>
	);
}

const setupOn = (p: ProjectSecurity) => CHECKS.filter((c) => p.setup[c.key] === true).length;

function Row({ p, selected, onOpen }: { p: ProjectSecurity; selected: boolean; onOpen: () => void }) {
	const { glyph, word } = STATUS[p.status];
	return (
		<button
			type="button"
			aria-current={selected ? "true" : undefined}
			onClick={onOpen}
			className={`${ROW} hover-row ${selected ? "bg-bg-active" : ""}`}
		>
			<span className="truncate font-medium">{p.name}</span>
			<span className="flex items-center gap-2">
				<Glyph kind={glyph} size={14} />
				{p.status === "red" ? `${p.overdue} past deadline` : word}
			</span>
			<Counts p={p} />
			<span className="text-end font-mono text-data tabular-nums text-text-muted">{setupOn(p)} of 4</span>
		</button>
	);
}

/** "Due in 4 days", "3d past the deadline", or "Open 12d" for a severity with no deadline. */
function due(a: SecurityAlert, now = Date.now()): string {
	if (!a.dueAt) return `Open ${span(a.createdAt, now)}`;
	if (a.overdue) return `${span(a.dueAt, now)} past the deadline`;
	const days = Math.ceil((Date.parse(a.dueAt) - now) / 86_400_000);
	return days <= 1 ? "Due within a day" : `Due in ${plural(days, "day")}`;
}

function AlertRow({ a }: { a: SecurityAlert }) {
	return (
		<li className="flex flex-col gap-0.5 border-0 border-t border-solid border-border-subtle py-2">
			<span className="flex items-center gap-2">
				<Glyph kind={a.overdue ? "fail" : "err"} size={12} />
				<span className="font-medium">{SEVERITY_WORD[a.severity]}</span>
				<span className="font-mono text-data [overflow-wrap:anywhere]">{a.package}</span>
			</span>
			<span className="text-meta text-text-muted [overflow-wrap:anywhere]">{a.summary}</span>
			<span className="flex flex-wrap gap-x-3 text-meta text-text-muted">
				<span>{due(a)}</span>
				<span>{a.patched ? `Fixed in ${a.patched}` : "No fix yet"}</span>
				<LnkOut href={a.url} muted>
					{a.ghsaId}
				</LnkOut>
			</span>
		</li>
	);
}

/** Text for the new work order dialog. Package names and IDs only: advisory text stays on GitHub. */
function fixText(p: ProjectSecurity): string {
	const missing = p.missing.filter((c) => c === "dependabotConfig" || c === "branchProtected");
	const lines: string[] = [];
	const overdue = p.alerts.filter((a) => a.overdue);
	if (overdue.length) {
		lines.push(`Fix the Dependabot alerts past their deadline in ${p.repo}:`);
		for (const a of overdue.slice(0, 20))
			lines.push(
				`- ${a.package} (${a.ecosystem}), ${a.severity}, ${a.ghsaId}${a.patched ? `, fixed in ${a.patched}` : ""}`,
			);
	}
	if (missing.includes("dependabotConfig"))
		lines.push("Add .github/dependabot.yml following the toolkit's dependency-updates standard.");
	if (missing.includes("branchProtected"))
		lines.push("Protect the default branch with a ruleset following the toolkit's deployments standard.");
	return lines.join("\n");
}

function SecurityPane({ p }: { p: ProjectSecurity }) {
	const openNew = useOpenNewWorkOrder();
	const [asking, setAsking] = useState(false);
	const offByApi = (["alerts", "securityUpdates"] as const).filter((c) => p.setup[c] === false);
	const turnOn = useAction(
		() => api.post(`/api/projects/${encodeURIComponent(p.slug)}/security/turn-on`, { what: offByApi }),
		{ onSuccess: () => setAsking(false) },
	);
	const { glyph, word } = STATUS[p.status];
	const text = fixText(p);
	const shown = p.alerts.slice(0, 50);
	return (
		<Pane>
			<div>
				<h2 className="m-0 text-detail-title">{p.name}</h2>
				<p className="m-0 mt-1 flex items-baseline gap-2">
					<Glyph kind={glyph} size={14} />
					<span>
						{p.status === "red"
							? `${plural(p.overdue, "alert")} past the deadline.`
							: p.status === "unknown"
								? p.unread
									? "GitHub wouldn't list alerts. Reading them may need admin rights."
									: "GitHub hasn't been read for this project yet."
								: p.total
									? `${plural(p.total, "open alert")}, none past the deadline.`
									: `${word}.`}{" "}
						{p.readAt && `Read ${ago(p.readAt)}.`}
						{p.unread &&
							p.status !== "unknown" &&
							" GitHub wouldn't list alerts this time, so these are from an earlier read."}
					</span>
				</p>
			</div>

			<section aria-label="Setup" className="flex flex-col gap-1">
				<SectionLabel level={3}>Setup</SectionLabel>
				<ul className="m-0 flex list-none flex-col gap-2 p-0">
					{CHECKS.map((c) => {
						const on = p.setup[c.key];
						return (
							<li key={c.key} className="flex items-start gap-2">
								<span className="pt-0.5">
									<Glyph kind={on === true ? "pass" : on === false ? "fail" : "idle"} size={14} />
								</span>
								<span className="flex flex-col">
									<span>
										{c.label}{" "}
										<span className="text-text-muted">
											{on === true ? "on" : on === false ? "off" : "unknown"}
										</span>
									</span>
									{on === false && <span className="text-meta text-text-muted">{c.off}</span>}
									{on === null && (
										<span className="text-meta text-text-muted">
											GitHub didn't say. Reading it may need admin rights.
										</span>
									)}
								</span>
							</li>
						);
					})}
				</ul>
			</section>

			<div className="flex flex-col gap-2">
				{offByApi.length > 0 && (
					<Button variant="primary" grow onClick={() => setAsking(true)}>
						Turn on{" "}
						{offByApi.length === 2 || offByApi[0] === "securityUpdates"
							? "alerts and security updates"
							: "alerts"}
					</Button>
				)}
				{text && (
					<Button
						variant={offByApi.length ? "secondary" : "primary"}
						grow
						onClick={() => openNew({ project: p.slug, text })}
					>
						Fix in a work order
					</Button>
				)}
				<ButtonOut href={`${p.url}/security/dependabot`} grow>
					Open on GitHub
				</ButtonOut>
			</div>

			{p.alerts.length > 0 && (
				<section aria-label="Alerts" className="flex flex-col gap-1">
					<SectionLabel level={3}>Alerts</SectionLabel>
					<ul className="m-0 list-none p-0">
						{shown.map((a) => (
							<AlertRow key={a.number} a={a} />
						))}
					</ul>
					{p.total > shown.length && (
						<p className="m-0 text-meta text-text-muted">
							{plural(p.total - shown.length, "more alert")} on GitHub.
						</p>
					)}
				</section>
			)}

			<ConfirmDialog
				open={asking}
				onOpenChange={(o) => !o && setAsking(false)}
				title={`Turn on security in ${p.repo}?`}
				description="This changes the repo's settings on GitHub. Dependabot then reports vulnerable dependencies and opens PRs that fix them. Turn them off again in the repo's settings."
				action="Turn on"
				actionVariant="primary"
				pending={turnOn.pending}
				error={turnOn.error}
				onAction={() => void turnOn.run()}
			/>
		</Pane>
	);
}

export function SecurityScreen() {
	const { select } = useSearch({ from: "/shell/security" });
	const navigate = useNavigate();
	const q = useSecurity();
	const [chosen] = useChosenProjects();
	if (!q.data)
		return (
			<Page>
				<PageHeader title="Security" actions={<ProjectPicker />} />
				{q.isError ? (
					<LoadFailed what="security" error={q.error} />
				) : (
					<>
						<StatusLine className="text-text-muted">Loading security</StatusLine>
						<Skeleton width="100%" height={120} />
					</>
				)}
			</Page>
		);
	const list = q.data.projects
		.filter((p) => chosen.length === 0 || chosen.includes(p.slug))
		.sort((a, b) => RANK[a.status] - RANK[b.status] || b.overdue - a.overdue || b.total - a.total);
	const current = list.find((p) => p.slug === select) ?? list[0] ?? null;
	const red = list.filter((p) => p.status === "red").length;
	const amber = list.filter((p) => p.status === "amber").length;
	const unknown = list.filter((p) => p.status === "unknown").length;
	// "All clear" only when every project was read and is green.
	const summary =
		[red && `${red} past deadline`, amber && `${amber} need attention`, unknown && `${unknown} not read`]
			.filter(Boolean)
			.join(" · ") || (list.length ? "All clear" : "No projects");
	const { critical, high } = q.data.deadlines;
	const deadlineWords = (d: number | null) =>
		d === null ? "never" : d === 0 ? "right away" : `after ${plural(d, "day")}`;
	return (
		<Page pane={current ? <SecurityPane key={current.slug} p={current} /> : undefined}>
			<div className="flex flex-col gap-4">
				<PageHeader title="Security" summary={summary} actions={<ProjectPicker />} />
				<ChosenNote />
				<p className="m-0 text-meta text-text-muted">
					Open Dependabot alerts and setup, read from GitHub. Critical alerts turn a project red{" "}
					{deadlineWords(critical)}, high ones {deadlineWords(high)}.{" "}
					<Lnk to="/settings/$section" params={{ section: "security" }}>
						Change deadlines
					</Lnk>
				</p>
				<div className="overflow-x-auto">
					<div className="flex min-w-[620px] flex-col gap-0.5">
						<div className={`${ROW} cursor-default text-meta text-text-muted`} aria-hidden="true">
							<span>Project</span>
							<span>Status</span>
							{SEVERITIES.map((s) => (
								<span key={s} className="text-end">
									{SEVERITY_WORD[s]}
								</span>
							))}
							<span className="text-end">Setup</span>
						</div>
						<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
							{list.map((p) => (
								<li key={p.slug}>
									<Row
										p={p}
										selected={current?.slug === p.slug}
										onOpen={() =>
											void navigate({
												to: "/security",
												search: (prev: Record<string, unknown>) => ({ ...prev, select: p.slug }),
												replace: true,
												resetScroll: false,
											} as never)
										}
									/>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</Page>
	);
}
