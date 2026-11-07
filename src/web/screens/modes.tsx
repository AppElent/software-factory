import { useState } from "react";
import { skillPhrase, USEFUL_SKILLS } from "../../shared/modes.ts";
import { slugify } from "../../shared/rules.ts";
import type { Mode, ModesResponse } from "../../shared/types.ts";
import { api } from "../api.ts";
import {
	Button,
	Choice,
	Field,
	InlineError,
	LoadFailed,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useModes } from "../queries.ts";

const uniqueId = (name: string, taken: Mode[]) => {
	const base = slugify(name, 36) || "mode";
	let id = base;
	for (let n = 2; taken.some((m) => m.id === id); n += 1) id = `${base}-${n}`;
	return id;
};

const BLANK: Omit<Mode, "id"> = {
	name: "New mode",
	description: "",
	prompt: "",
	plan: "follow",
	merge: "you",
	provider: null,
	model: null,
	builtin: false,
};

const whoMerges = (m: Mode) =>
	m.merge === "factory"
		? "The factory merges once gates pass, unless the line is stopped."
		: "You review and merge.";

const planWords: Record<Mode["plan"], string> = {
	follow: "Plans when Settings says to.",
	always: "Always plans first.",
	skip: "Skips the plan.",
};

/** Words written for other choices are false after changing them, and the split button shows them when you choose. */
const describe = (m: Mode, before: Mode) =>
	m.merge === before.merge && m.plan === before.plan && m.description.trim()
		? m.description
		: `${planWords[m.plan]} ${whoMerges(m)}`;

function ModeForm({
	data,
	mode,
	onSaved,
	onDeleted,
}: {
	data: ModesResponse;
	mode: Mode;
	onSaved: (id: string) => void;
	onDeleted: () => void;
}) {
	const [draft, setDraft] = useState(mode);
	const [saved, setSaved] = useState(false);
	const set = (patch: Partial<Mode>) => {
		setSaved(false);
		setDraft((d) => ({ ...d, ...patch }));
	};
	const original = data.defaults.find((m) => m.id === mode.id);
	const isNew = !data.modes.some((m) => m.id === mode.id);
	const put = (modes: Mode[], defaultMode = data.defaultMode) =>
		api.put<ModesResponse>("/api/modes", { modes, defaultMode });
	const save = useAction(
		() => {
			const next = { ...draft, description: describe(draft, mode) };
			const list = isNew ? [...data.modes, next] : data.modes.map((m) => (m.id === mode.id ? next : m));
			return put(list);
		},
		{
			onSuccess: () => {
				setSaved(true);
				onSaved(draft.id);
			},
		},
	);
	const remove = useAction(() => put(data.modes.filter((m) => m.id !== mode.id)), { onSuccess: onDeleted });
	const makeDefault = useAction(() => put(data.modes, mode.id));
	const insert = (skill: string) =>
		set({ prompt: `${skillPhrase(skill)}${draft.prompt ? `\n\n${draft.prompt}` : ""}` });
	const known = data.skills.filter((s) => USEFUL_SKILLS.includes(s));
	const others = data.skills.filter((s) => !USEFUL_SKILLS.includes(s));
	const isDefault = data.defaultMode === mode.id;
	const provider = draft.provider ?? "";
	return (
		<form
			className="flex min-w-0 max-w-[680px] flex-[999_1_420px] flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				void save.run();
			}}
		>
			<Field label="Name">
				{(p) => (
					<input {...p} type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
				)}
			</Field>
			<Field label="Prompt" hint="Added before the work order's own instructions.">
				{(p) => (
					<textarea
						{...p}
						rows={6}
						className="font-mono text-data"
						value={draft.prompt}
						onChange={(e) => set({ prompt: e.target.value })}
					/>
				)}
			</Field>
			<div className="flex flex-col gap-2">
				<SectionLabel>Detected on this Mac</SectionLabel>
				{data.skills.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{known.map((s) => (
							<Button key={s} onClick={() => insert(s)}>
								Insert {s}
							</Button>
						))}
						{others.length > 0 && (
							<select
								aria-label="Insert another skill"
								className="w-auto"
								value=""
								onChange={(e) => e.target.value && insert(e.target.value)}
							>
								<option value="">Insert another skill</option>
								{others.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						)}
					</div>
				)}
				<p className="m-0 text-meta text-text-muted">
					{data.skills.length === 0
						? "No skills found. The default prompts work without them."
						: "Skills are optional. On a Mac without them, the default prompts still work."}
				</p>
			</div>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
				<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
					<legend className="mb-1 p-0 font-medium">Plan</legend>
					<Choice
						type="radio"
						name="mode-plan"
						title="Follow Approvals settings"
						checked={draft.plan === "follow"}
						onChange={() => set({ plan: "follow" })}
					/>
					<Choice
						type="radio"
						name="mode-plan"
						title="Always ask me to approve"
						checked={draft.plan === "always"}
						onChange={() => set({ plan: "always" })}
					/>
					<Choice
						type="radio"
						name="mode-plan"
						title="Skip the plan"
						checked={draft.plan === "skip"}
						onChange={() => set({ plan: "skip" })}
					/>
				</fieldset>
				<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
					<legend className="mb-1 p-0 font-medium">Who merges</legend>
					<Choice
						type="radio"
						name="mode-merge"
						title="Me"
						checked={draft.merge === "you"}
						onChange={() => set({ merge: "you" })}
					/>
					<Choice
						type="radio"
						name="mode-merge"
						title="The factory, once gates pass"
						description="Stop the line, paused projects, and files that always wait for you still apply."
						checked={draft.merge === "factory"}
						onChange={() => set({ merge: "factory" })}
					/>
				</fieldset>
			</div>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
				<Field label="Provider" hint="Blank uses T3's default.">
					{(p) => (
						<input
							{...p}
							type="text"
							placeholder="T3 default"
							value={provider}
							onChange={(e) => set({ provider: e.target.value.trim() || null })}
						/>
					)}
				</Field>
				<Field
					label="Model"
					hint={provider ? "T3 needs a model when you name a provider." : "Blank uses T3's default."}
				>
					{(p) => (
						<input
							{...p}
							type="text"
							placeholder="T3 default"
							value={draft.model ?? ""}
							onChange={(e) => set({ model: e.target.value.trim() || null })}
						/>
					)}
				</Field>
			</div>
			<InlineError>
				{(save.error && `Couldn't save this. ${save.error}`) ||
					(remove.error && `Couldn't delete this. ${remove.error}`) ||
					(makeDefault.error && `Couldn't change the default. ${makeDefault.error}`)}
			</InlineError>
			<StatusLine className="text-meta text-text-muted">{saved && `Saved ${draft.name}.`}</StatusLine>
			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" variant="primary" disabled={save.pending}>
					Save mode
				</Button>
				{original && <Button onClick={() => set(original)}>Reset to default</Button>}
				{!isNew && !isDefault && draft.merge !== "factory" && (
					<Button disabled={makeDefault.pending} onClick={() => void makeDefault.run()}>
						Make default
					</Button>
				)}
				{!isNew && !isDefault && (
					<Button className="ms-auto" disabled={remove.pending} onClick={() => void remove.run()}>
						Delete
					</Button>
				)}
			</div>
		</form>
	);
}

export function ModesSection() {
	const q = useModes();
	const [selected, setSelected] = useState<string | null>(null);
	const [fresh, setFresh] = useState<Mode | null>(null);
	if (q.isError && !q.data) return <LoadFailed what="modes" error={q.error} />;
	if (!q.data) return <Skeleton width="60%" height={20} />;
	const data = q.data;
	const current = fresh ?? data.modes.find((m) => m.id === selected) ?? data.modes[0];
	return (
		<div className="flex flex-col gap-4">
			<h2 className="m-0 text-page-title">Modes</h2>
			<div className="flex flex-wrap items-start gap-6">
				<div className="flex min-w-[220px] max-w-[280px] flex-[1_1_240px] flex-col gap-1">
					{data.modes.map((m) => (
						<button
							key={m.id}
							type="button"
							aria-current={current?.id === m.id ? "true" : undefined}
							onClick={() => {
								setFresh(null);
								setSelected(m.id);
							}}
							className={`hover-row flex min-h-action cursor-pointer items-center rounded-sm border-0 bg-transparent px-3 text-start font-[inherit] text-text-primary ${current?.id === m.id ? "bg-bg-raised font-medium" : ""}`}
						>
							{m.name}
							{data.defaultMode === m.id && (
								<span className="ms-auto font-mono text-data text-text-muted">default</span>
							)}
						</button>
					))}
					<Button
						className="mt-2"
						onClick={() => setFresh({ ...BLANK, id: uniqueId(BLANK.name, data.modes) })}
					>
						New mode
					</Button>
					<p className="m-0 mt-2 text-meta text-text-muted [overflow-wrap:anywhere]">
						Saved in a plain config file, so they survive without this app's database:{" "}
						<span className="font-mono">{data.configPath}</span>
					</p>
				</div>
				{current && (
					<ModeForm
						key={current.id}
						data={data}
						mode={current}
						onSaved={(id) => {
							setFresh(null);
							setSelected(id);
						}}
						onDeleted={() => {
							setFresh(null);
							setSelected(null);
						}}
					/>
				)}
			</div>
		</div>
	);
}
