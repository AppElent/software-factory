import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Mode, VersionInfo, VersionsResponse } from "../../shared/types.ts";
import { api } from "../api.ts";
import { useCopyCommand } from "../fix.tsx";
import { ago, span } from "../format.ts";
import {
	Button,
	ButtonLink,
	ConfirmDialog,
	Field,
	Glyph,
	InlineError,
	LoadFailed,
	Mono,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, useModes, useVersions } from "../queries.ts";

type Kind = "Improvement" | "Bug";
type Asking = { action: "start" | "copy"; hits: string[]; merges: boolean };

function Suggest({ repo }: { repo: string | null }) {
	const navigate = useNavigate();
	const modes = useModes();
	const [type, setType] = useState<Kind>("Improvement");
	const [text, setText] = useState("");
	const [modeId, setModeId] = useState<string | null>(null);
	const [asking, setAsking] = useState<Asking | null>(null);
	const { copy, view } = useCopyCommand();
	const all = modes.data?.modes ?? [];
	const mode: Mode | undefined = all.find((m) => m.id === (modeId ?? modes.data?.defaultMode));
	const payload = (confirmed: boolean) => ({ type, text, mode: mode?.id, confirmed });

	const start = useAction(
		(confirmed: boolean) => api.post<{ id: number }>("/api/improve", payload(confirmed)),
		{
			onSuccess: ({ id }) => void navigate({ to: "/work-orders/$id", params: { id: String(id) } }),
		},
	);
	const makeCommand = (confirmed: boolean) =>
		copy(
			async () => (await api.post<{ command: string }>("/api/improve/command", payload(confirmed))).command,
		);
	const check = useAction(async (action: Asking["action"]) => {
		const { hits } = await api.post<{ hits: string[] }>("/api/improve/check", { text });
		const merges = action === "start" && mode?.merge === "factory";
		if (hits.length > 0 || merges) setAsking({ action, hits, merges });
		else if (action === "start") void start.run(false);
		else void makeCommand(false);
	});
	const ready = text.trim().length > 0 && !!repo;

	return (
		<section aria-label="Suggest a change" className="flex flex-col gap-4">
			<div>
				<h1 className="m-0 text-page-title">Improve yourself</h1>
				<p className="m-0 mt-1 text-text-muted">
					{repo
						? `Starts a work order on Software Factory's own repo, ${repo}.`
						: "This copy has no GitHub repo to work on."}
				</p>
			</div>
			<fieldset className="m-0 flex gap-4 border-0 p-0">
				<legend className="mb-1 p-0 font-medium">Type</legend>
				{(["Improvement", "Bug"] as Kind[]).map((k) => (
					<label key={k} className="flex min-h-7 items-center gap-2">
						<input type="radio" name="improve-type" checked={type === k} onChange={() => setType(k)} />
						{k}
					</label>
				))}
			</fieldset>
			<Field label="What should change?">
				{(p) => <textarea {...p} rows={7} value={text} onChange={(e) => setText(e.target.value)} />}
			</Field>
			<p className="m-0 text-text-muted">
				This repo is public, and this text can end up in commits and PRs. It's checked for your private names
				before it's sent.
			</p>
			<Field label="Mode">
				{(p) => (
					<select {...p} value={mode?.id ?? ""} onChange={(e) => setModeId(e.target.value)}>
						{all.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				)}
			</Field>
			<div className="flex flex-wrap gap-2">
				<Button disabled={!ready || check.pending || start.pending} onClick={() => void check.run("start")}>
					Start work order
				</Button>
				<Button disabled={!ready || check.pending} onClick={() => void check.run("copy")}>
					Copy as command
				</Button>
			</div>
			{view}
			<InlineError>{check.error ?? start.error}</InlineError>
			<p className="m-0 text-text-muted">Changes to security files always wait for you, in every mode.</p>
			<ConfirmDialog
				open={asking !== null}
				onOpenChange={(o) => !o && setAsking(null)}
				title={
					asking?.hits.length ? "This mentions something private" : `${mode?.name} on the factory itself?`
				}
				description={
					asking?.hits.length
						? `It mentions ${asking.hits.join(", ")}. This repo is public, so this could end up in commits and PRs.${asking.merges ? ` ${mode?.name} also merges this as soon as its gates pass.` : ""}`
						: "The factory merges this as soon as its gates pass. Changes to security files still wait for you."
				}
				action={
					asking?.action === "copy"
						? "Copy anyway"
						: asking?.hits.length
							? "Start anyway"
							: `Start with ${mode?.name}`
				}
				onAction={() => {
					const was = asking;
					setAsking(null);
					if (was?.action === "copy") void makeCommand(true);
					else void start.run(true);
				}}
			/>
		</section>
	);
}

function ReadyCard({ version, running }: { version: VersionInfo; running: string | undefined }) {
	const activate = useAction(() => api.post("/api/versions/activate", { sha: version.sha }));
	return (
		<div className="flex flex-col gap-3 rounded-lg bg-bg-surface p-4">
			<div>
				<p className="m-0 font-medium">
					<Mono>{version.label}</Mono> is ready
				</p>
				<p className="m-0 mt-1 text-text-muted">{version.message}</p>
			</div>
			<p className="m-0 flex items-center gap-2">
				<Glyph kind="pass" size={14} /> Started on a spare port, and passed its smoke test
			</p>
			<Button variant="primary" grow disabled={activate.pending} onClick={() => void activate.run()}>
				Update to {version.label}
			</Button>
			<InlineError>{activate.error}</InlineError>
			<p className="m-0 text-text-muted">
				Your settings and work orders stay. If {version.label} doesn't start or fails its check, the factory
				goes back to {running} on its own.
			</p>
		</div>
	);
}

const ROW =
	"grid min-h-11 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-solid border-border-subtle py-1";

function RollBack({ version }: { version: VersionInfo }) {
	const [open, setOpen] = useState(false);
	const roll = useAction(() => api.post("/api/versions/activate", { sha: version.sha }), {
		onSuccess: () => setOpen(false),
	});
	return (
		<>
			<Button onClick={() => setOpen(true)}>Roll back</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={`Roll back to ${version.label}?`}
				description="The factory restarts on that version. Your settings and work orders stay. A newer version's database changes stay too, and older versions ignore them."
				action="Roll back"
				pending={roll.pending}
				error={roll.error}
				onAction={() => void roll.run()}
			/>
		</>
	);
}

function Versions({ data }: { data: VersionsResponse }) {
	const check = useAction(() => api.post("/api/versions/check"));
	if (data.mode === "checkout")
		return (
			<section aria-label="Versions" className="flex flex-col gap-3">
				<h2 className="m-0 text-detail-title">Versions</h2>
				<p className="m-0 text-text-muted">
					This copy runs from a checkout, so there's nothing to switch. Run <Mono>pnpm service:install</Mono>{" "}
					to get versions with a way back.
				</p>
			</section>
		);
	const ready = data.history.find((v) => v.state === "ready");
	const running = data.running;
	const others = data.history.filter((v) => v.sha !== running?.sha && v !== ready);
	return (
		<section aria-label="Versions" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="m-0 me-auto text-detail-title">Versions</h2>
				<span className="text-meta text-text-muted">
					{data.checkedAt ? `Checked ${ago(data.checkedAt)}` : ""}
				</span>
				<Button disabled={check.pending} onClick={() => void check.run()}>
					Check for a new version
				</Button>
			</div>
			<InlineError>{check.error ?? data.checkError}</InlineError>
			{ready && <ReadyCard version={ready} running={running?.label} />}
			<div>
				<SectionLabel level={3}>History</SectionLabel>
				<div className="mt-1">
					{data.building.map((b) => (
						<div key={b.id} className={ROW}>
							<Mono>WO-{b.id}</Mono>
							<span className="flex items-baseline gap-2">
								<Glyph kind="run" size={14} /> Building: {b.title}
							</span>
							<ButtonLink to="/work-orders/$id" params={{ id: String(b.id) }}>
								Open
							</ButtonLink>
						</div>
					))}
					{running && (
						<div className={ROW}>
							<Mono>{running.label}</Mono>
							<span className="flex items-baseline gap-2">
								<Glyph kind="pass" size={14} /> Running now
								{running.since ? `, since ${span(running.since)}` : ""}
							</span>
							<span />
						</div>
					)}
					{others.map((v) => (
						<div key={v.sha} className={ROW}>
							<Mono>{v.label}</Mono>
							{v.state === "preparing" ? (
								<span className="flex items-baseline gap-2">
									<Glyph kind="run" size={14} /> Getting ready: {v.message}
								</span>
							) : v.state === "failed" ? (
								<span className="flex items-baseline gap-2">
									<Glyph kind="fail" size={14} />
									<span className="[overflow-wrap:anywhere]">{v.error ?? "It failed."}</span>
								</span>
							) : (
								<span className="text-text-muted">Replaced {ago(v.at)}</span>
							)}
							{v.canRollBack ? <RollBack version={v} /> : <span />}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export function ImproveScreen() {
	const q = useVersions();
	return (
		<main className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] content-start gap-8 px-6 py-5">
			{q.isError && !q.data ? (
				<LoadFailed what="versions" error={q.error} />
			) : !q.data ? (
				<>
					<StatusLine className="text-text-muted">Loading</StatusLine>
					<Skeleton width="100%" height={120} />
				</>
			) : (
				<>
					<Suggest repo={q.data.repo} />
					<Versions data={q.data} />
				</>
			)}
		</main>
	);
}
