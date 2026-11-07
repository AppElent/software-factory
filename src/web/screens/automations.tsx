import { useState } from "react";
import { scheduleWords } from "../../shared/rules.ts";
import type { Automation, AutomationSchedule } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago } from "../format.ts";
import {
	Banner,
	Button,
	ButtonOut,
	EmptyPanel,
	Field,
	Glyph,
	InlineError,
	LoadFailed,
	Page,
	PageHeader,
	Pane,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useAutomations, useModes, useProjects } from "../queries.ts";

type When = "interval" | "fixed_time" | "once";
const WHEN: Array<[When, string]> = [
	["interval", "Every"],
	["fixed_time", "At a time"],
	["once", "Once"],
];
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const DAY_CHOICES: Array<[string, number[] | undefined]> = [
	["Every day", undefined],
	["Weekdays", [1, 2, 3, 4, 5]],
	["Mondays", [1]],
	["Tuesdays", [2]],
	["Wednesdays", [3]],
	["Thursdays", [4]],
	["Fridays", [5]],
	["Saturdays", [6]],
	["Sundays", [0]],
];

function NewAutomation() {
	const projects = useProjects();
	const modes = useModes();
	const [name, setName] = useState("");
	const [project, setProject] = useState("");
	const [when, setWhen] = useState<When>("fixed_time");
	const [every, setEvery] = useState(6);
	const [unit, setUnit] = useState<keyof typeof UNIT_MS>("hours");
	const [day, setDay] = useState("Mondays");
	const [time, setTime] = useState("08:00");
	const [runAt, setRunAt] = useState("");
	const [prompt, setPrompt] = useState("");
	const [mode, setMode] = useState<string | null>(null);

	const list = projects.data ?? [];
	const chosenProject = project || list[0]?.slug || "";
	const chosenMode = mode ?? modes.data?.defaultMode ?? "";
	const schedule = (): AutomationSchedule => {
		if (when === "interval") return { type: "interval", everyMs: every * UNIT_MS[unit] };
		// The picker gives your local time with no zone, which T3 could read as UTC.
		if (when === "once") return { type: "once", runAt: new Date(runAt).toISOString() };
		const weekdays = DAY_CHOICES.find(([label]) => label === day)?.[1];
		return { type: "fixed_time", timeOfDay: time, ...(weekdays ? { weekdays } : {}) };
	};
	const create = useAction(
		() =>
			api.post("/api/automations", {
				name,
				project: chosenProject,
				prompt,
				mode: chosenMode || undefined,
				when: schedule(),
			}),
		{
			onSuccess: () => {
				setName("");
				setPrompt("");
			},
		},
	);
	const ready = name.trim() && prompt.trim() && chosenProject && (when !== "once" || runAt);
	return (
		<Pane>
			<h2 className="m-0 text-detail-title">New automation</h2>
			<Field label="Name">
				{(p) => <input {...p} type="text" value={name} onChange={(e) => setName(e.target.value)} />}
			</Field>
			<Field label="Project">
				{(p) => (
					<select {...p} value={chosenProject} onChange={(e) => setProject(e.target.value)}>
						{list.map((x) => (
							<option key={x.slug} value={x.slug}>
								{x.name}
							</option>
						))}
					</select>
				)}
			</Field>
			<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
				<legend className="mb-1 p-0 font-medium">When</legend>
				<div className="flex gap-1">
					{WHEN.map(([value, label]) => (
						<Button
							key={value}
							grow
							aria-pressed={when === value}
							className={`flex-1 ${when === value ? "bg-bg-raised font-medium" : ""}`}
							onClick={() => setWhen(value)}
						>
							{label}
						</Button>
					))}
					<Button grow disabled aria-pressed={false} className="flex-1">
						Webhook
					</Button>
				</div>
				<div className="mt-1 grid grid-cols-2 gap-2">
					{when === "interval" && (
						<>
							<input
								type="number"
								aria-label="How many"
								min={1}
								value={every}
								onChange={(e) => setEvery(Number(e.target.value))}
							/>
							<select
								aria-label="Unit"
								value={unit}
								onChange={(e) => setUnit(e.target.value as keyof typeof UNIT_MS)}
							>
								<option value="minutes">Minutes</option>
								<option value="hours">Hours</option>
								<option value="days">Days</option>
							</select>
						</>
					)}
					{when === "fixed_time" && (
						<>
							<select aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)}>
								{DAY_CHOICES.map(([label]) => (
									<option key={label}>{label}</option>
								))}
							</select>
							<input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
						</>
					)}
					{when === "once" && (
						<input
							type="datetime-local"
							aria-label="Date and time"
							className="col-span-2"
							value={runAt}
							onChange={(e) => setRunAt(e.target.value)}
						/>
					)}
				</div>
				<span className="text-text-muted">Webhook needs T3 Connect.</span>
			</fieldset>
			<Field label="Prompt">
				{(p) => <textarea {...p} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}
			</Field>
			<Field label="Mode">
				{(p) => (
					<select {...p} value={chosenMode} onChange={(e) => setMode(e.target.value)}>
						{(modes.data?.modes ?? []).map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				)}
			</Field>
			<div className="flex flex-col gap-2">
				<Button variant="primary" grow disabled={!ready || create.pending} onClick={() => void create.run()}>
					Create in T3
				</Button>
				<InlineError>{create.error}</InlineError>
				<p className="m-0 text-text-muted">
					An agent thread creates it, so this takes about a minute. The thread is yours to read in T3.
				</p>
			</div>
		</Pane>
	);
}

function Row({ item }: { item: Automation }) {
	return (
		<tr className="border-0 border-t border-solid border-border-subtle">
			<td className="px-3 py-2 [overflow-wrap:anywhere]">{item.title}</td>
			<td className="px-3 py-2 text-text-muted">{item.projectName}</td>
			<td className="px-3 py-2 font-mono text-data text-text-muted">
				{item.schedule.type === "once"
					? `Once, ${new Date(item.schedule.runAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
					: scheduleWords(item.schedule)}
			</td>
			<td className="px-3 py-2">
				<span className="flex items-center gap-2">
					<Glyph kind={item.enabled ? "pass" : "idle"} size={14} /> {item.enabled ? "On" : "Off"}
				</span>
			</td>
			<td className="px-3 py-1 text-end">
				{item.link && <ButtonOut href={item.link}>Open in T3</ButtonOut>}
			</td>
		</tr>
	);
}

export function AutomationsScreen() {
	const q = useAutomations();
	const read = useAction(() => api.post("/api/automations/read"));
	if (q.isError && !q.data)
		return (
			<Page>
				<PageHeader title="Automations" />
				<LoadFailed what="automations" error={q.error} />
			</Page>
		);
	if (!q.data)
		return (
			<Page>
				<PageHeader title="Automations" />
				<StatusLine className="text-text-muted">Loading automations</StatusLine>
				<Skeleton width="100%" height={120} />
			</Page>
		);
	const { items, readAt, reading, readError, jobs } = q.data;
	const seen = reading
		? "An agent is reading them from T3."
		: readAt
			? `Read from T3 ${ago(readAt)}.`
			: "Not read from T3 yet. Reading takes an agent turn, so it runs when you ask.";
	return (
		<Page pane={<NewAutomation />}>
			<PageHeader
				title="Automations"
				summary={`Saved in T3, and keep running without this app. ${seen}`}
				actions={
					<Button disabled={reading || read.pending} onClick={() => void read.run()}>
						{readAt ? "Read again" : "Read from T3"}
					</Button>
				}
			/>
			<InlineError>{read.error ?? readError}</InlineError>
			{jobs.map((j) =>
				j.error ? (
					<Banner
						key={j.id}
						role="alert"
						glyph="fail"
						title={`${j.name} wasn't created`}
						body={j.error}
						actions={j.link ? <ButtonOut href={j.link}>Open in T3</ButtonOut> : undefined}
					/>
				) : (
					<StatusLine key={j.id}>
						<span className="flex items-center gap-2">
							<Glyph kind="run" size={14} /> Creating {j.name} in {j.projectName}
						</span>
					</StatusLine>
				),
			)}
			{items.length === 0 ? (
				<EmptyPanel
					title={readAt ? "No automations in T3" : "Nothing read yet"}
					body={
						readAt
							? "Create one here. It's saved in T3 and runs without this app."
							: "Read from T3 to see what's there, or create one here."
					}
				/>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[620px] border-collapse">
						<thead>
							<tr className="text-meta text-text-muted">
								<th scope="col" className="px-3 py-2 text-start font-normal">
									Name
								</th>
								<th scope="col" className="px-3 py-2 text-start font-normal">
									Project
								</th>
								<th scope="col" className="px-3 py-2 text-start font-normal">
									Schedule
								</th>
								<th scope="col" className="px-3 py-2 text-start font-normal">
									State
								</th>
								<th scope="col" className="px-3 py-2">
									<span className="sr-only">Open</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{items.map((i) => (
								<Row key={i.id} item={i} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</Page>
	);
}
