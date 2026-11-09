import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { allFourPassed, noGates } from "../../shared/rules.ts";
import { GATE_NAMES, type GateName, type PrDetail } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ago, list, plural, span } from "../format.ts";
import {
	Banner,
	Breadcrumb,
	Button,
	ButtonOut,
	Facts,
	Field,
	GateList,
	Glyph,
	type GlyphKind,
	InlineConfirm,
	InlineError,
	Lnk,
	LnkOut,
	LoadFailed,
	Page,
	Pane,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { useAction, usePr } from "../queries.ts";
import { needsRebase, prSize } from "./prs.tsx";

const WORDS_DAY = 86_400_000;

/** "18 days", "3 hours", for the rebase pane. */
function spanWords(iso: string) {
	const ms = Date.now() - Date.parse(iso);
	const days = Math.round(ms / WORDS_DAY);
	if (days >= 1) return plural(days, "day");
	const hours = Math.round(ms / 3_600_000);
	if (hours >= 1) return plural(hours, "hour");
	return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
}

const prPath = (pr: { project: string; number: number }) =>
	`/api/prs/${encodeURIComponent(pr.project)}/${pr.number}`;

/** A PR body is untrusted text. Lines become paragraphs and bullets, never HTML. */
function PrBody({ text }: { text: string }) {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const blocks: Array<{ bullets: boolean; lines: string[] }> = [];
	for (const raw of lines) {
		const bullet = /^[-*] /.test(raw);
		const line = bullet ? raw.slice(2) : raw;
		const last = blocks.at(-1);
		if (last && last.bullets === bullet) last.lines.push(line);
		else blocks.push({ bullets: bullet, lines: [line] });
	}
	return (
		<>
			{blocks.map((b, i) =>
				b.bullets ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the blocks don't reorder.
					<ul key={i} className="m-0 list-disc ps-5 text-text-muted [overflow-wrap:anywhere]">
						{b.lines.map((l, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the lines don't reorder.
							<li key={j}>{l}</li>
						))}
					</ul>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: the blocks don't reorder.
					<p key={i} className="m-0 [overflow-wrap:anywhere]">
						{b.lines.join(" ")}
					</p>
				),
			)}
		</>
	);
}

const failedGates = (pr: PrDetail): GateName[] => GATE_NAMES.filter((n) => pr.gates[n] === "failed");
/** A check with no gate of its own can fail with every gate clear. */
const whatFailed = (pr: PrDetail) => (failedGates(pr).length ? list(failedGates(pr)) : "A check");

function statusOf(pr: PrDetail): { glyph: GlyphKind; text: string } {
	if (pr.group === "ready") {
		const notSetUp = GATE_NAMES.filter((n) => pr.gates[n] === "not_set_up");
		return allFourPassed(pr.gates)
			? { glyph: "pass", text: "All gates passed · ready to merge" }
			: { glyph: "pass", text: `Ready to merge · ${list(notSetUp)} not set up` };
	}
	if (pr.group === "failed") return { glyph: "fail", text: `${whatFailed(pr)} failed · can't merge yet` };
	if (pr.group === "rebase")
		return { glyph: "idle", text: `Needs rebase · ${spanWords(pr.updatedAt)} behind` };
	if (pr.group === "stale")
		return { glyph: "idle", text: `Stale · no activity for ${spanWords(pr.updatedAt)}` };
	// Gates that are running say it plainly. A hold only needs saying when the gates look finished.
	const running = GATE_NAMES.some((n) => pr.gates[n] === "running" || pr.gates[n] === "not_started");
	if (pr.heldBy && !running) return { glyph: pr.workOrder?.failure ? "fail" : "run", text: pr.heldBy };
	return pr.isDraft
		? { glyph: "idle", text: "Draft · can't merge yet" }
		: { glyph: "run", text: "Checks running" };
}

function FailedBanner({ pr }: { pr: PrDetail }) {
	const failed = failedGates(pr);
	const log = pr.checks.find((c) => c.bucket === "fail" && c.url)?.url;
	const title =
		failed.length === 1 && failed[0] === "Preview" ? "Preview build failed" : `${whatFailed(pr)} failed`;
	const cause = pr.workOrder?.failure?.split("\n")[0];
	return (
		<Banner
			glyph="fail"
			title={title}
			body={
				<>
					{cause && <code className="font-mono text-data">{cause}</code>}
					{cause && ". "}
					Merge stays off until the gate passes.
				</>
			}
			actions={log ? <ButtonOut href={log}>Open the log</ButtonOut> : undefined}
		/>
	);
}

function RebaseBanner({ pr }: { pr: PrDetail }) {
	const conflicts = pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY";
	if (pr.group === "stale") {
		return (
			<Banner
				glyph="idle"
				title={`No commits or comments for ${spanWords(pr.updatedAt)}`}
				body="A rebase work order brings it up to date and runs the gates again."
			/>
		);
	}
	return (
		<Banner
			glyph="idle"
			title={`${pr.baseRef} moved ahead`}
			body={`The gates passed ${ago(pr.updatedAt)}, so they no longer count. ${
				conflicts
					? "Some files conflict. A rebase work order resolves them"
					: "A rebase work order updates it"
			} and runs the gates again.`}
		/>
	);
}

function PrReview({ pr }: { pr: PrDetail }) {
	const navigate = useNavigate();
	const toFloor = () => void navigate({ to: "/floor" });
	const [merged, setMerged] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const [changing, setChanging] = useState(false);
	const [note, setNote] = useState("");
	const [noteInvalid, setNoteInvalid] = useState(false);
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);

	const merge = useAction(() => api.post<{ ok: boolean; reason: string }>(`${prPath(pr)}/merge`), {
		onSuccess: (r) => {
			if (r.ok) setMerged(true);
			else setRefused(r.reason);
		},
	});
	const change = useAction((text: string) => api.post(`${prPath(pr)}/request-changes`, { note: text }), {
		onSuccess: toFloor,
	});
	const close = useAction(() => api.post(`${prPath(pr)}/close`), {
		onSuccess: () => void navigate({ to: "/prs" }),
	});
	const rebase = useAction(() => api.post(`${prPath(pr)}/rebase`), { onSuccess: toFloor });

	const wasChanging = useRef(false);
	useEffect(() => {
		if (changing) noteRef.current?.focus();
		else if (wasChanging.current) toggleRef.current?.focus();
		wasChanging.current = changing;
	}, [changing]);

	const isBehind = pr.group === "rebase" || pr.group === "stale";
	const refusedBehind = refused != null && needsRebase(refused);
	const canMerge = pr.group === "ready" && !refusedBehind;
	const status = statusOf(pr);
	const typed = pr.workType ? ` · ${pr.workType}` : "";

	const submitNote = () => {
		if (!note.trim()) {
			setNoteInvalid(true);
			noteRef.current?.focus();
			return;
		}
		void change.run(note.trim());
	};

	const pane: ReactNode = (
		<Pane>
			{!merged && (
				<div className="flex items-center gap-2 font-medium">
					<Glyph kind={status.glyph} />
					<span className="[overflow-wrap:anywhere]">{status.text}</span>
				</div>
			)}
			<StatusLine>
				{merged && (
					<>
						Merged on GitHub. <Lnk to="/floor">See the floor</Lnk>
					</>
				)}
			</StatusLine>
			{!merged && canMerge && (
				<Button variant="primary" grow disabled={merge.pending} onClick={() => void merge.run()}>
					{merge.pending ? "Merging…" : "Merge"}
				</Button>
			)}
			{!merged && pr.group === "failed" && (
				<>
					<Button
						variant="primary"
						grow
						disabled={change.pending}
						onClick={() =>
							void change.run(`${whatFailed(pr)} failed on this PR. Fix it and push to this PR.`)
						}
					>
						Send back to the agent
					</Button>
					{!changing && <InlineError>{change.error && `Couldn't send this. ${change.error}`}</InlineError>}
				</>
			)}
			{!merged && isBehind && (
				<>
					<Button variant="primary" grow disabled={rebase.pending} onClick={() => void rebase.run()}>
						Start rebase work order
					</Button>
					<InlineError>{rebase.error && "Couldn't start this. Try again."}</InlineError>
				</>
			)}
			{!merged && (
				<div className="flex flex-col gap-2">
					<Button
						ref={toggleRef}
						grow
						aria-expanded={changing}
						onClick={() => {
							setChanging((v) => !v);
							change.clearError();
						}}
					>
						Request changes
					</Button>
					<InlineConfirm
						label="Close PR"
						title={
							<div className="flex flex-col gap-2">
								<strong>Close PR #{pr.number}?</strong>
								<p className="m-0 text-meta text-text-muted">
									The branch stays on GitHub.{pr.workOrderId ? " The work order closes." : ""}
								</p>
							</div>
						}
						keep="Keep it"
						confirm="Close PR"
						pending={close.pending}
						error={close.error && "Couldn't close this. Try again."}
						onConfirm={() => void close.run()}
					/>
				</div>
			)}
			<div className="flex flex-col gap-2 border-0 border-t border-solid border-border-subtle pt-4">
				<SectionLabel level={3}>Gates</SectionLabel>
				{/* Gates from before the base moved no longer count. */}
				<GateList gates={isBehind ? noGates("out_of_date") : pr.gates} />
			</div>
			<div className="border-0 border-t border-solid border-border-subtle pt-4">
				<Facts
					rows={[
						...(pr.workOrderId
							? ([
									[
										"Work order",
										<Lnk key="wo" to="/work-orders/$id" params={{ id: String(pr.workOrderId) }}>
											WO-{pr.workOrderId}
										</Lnk>,
									],
								] as Array<[ReactNode, ReactNode]>)
							: []),
						["Age", span(pr.createdAt), true],
						[
							"On GitHub",
							<LnkOut key="gh" href={pr.url} className="[overflow-wrap:anywhere]">
								{pr.url.replace("https://github.com/", "").replace("/pull/", "#")}
							</LnkOut>,
						],
					]}
				/>
			</div>
		</Pane>
	);

	return (
		<Page pane={pane}>
			<Breadcrumb crumbs={[{ label: "Pull requests", link: { to: "/prs" } }, { label: `#${pr.number}` }]} />
			<div>
				<span className="text-meta text-text-muted [overflow-wrap:anywhere]">
					<Lnk muted to="/projects/$slug" params={{ slug: pr.project }}>
						{pr.projectName}
					</Lnk>{" "}
					· PR #{pr.number}
					{typed}
				</span>
				<h1 className="m-0 mt-1 text-page-title [overflow-wrap:anywhere]">{pr.title}</h1>
			</div>
			{refused != null && !merged && (
				<Banner
					role="alert"
					glyph="err"
					title={`#${pr.number} couldn't merge.`}
					body={refused}
					actions={
						refusedBehind && !isBehind ? (
							<Button disabled={rebase.pending} onClick={() => void rebase.run()}>
								Start rebase work order
							</Button>
						) : undefined
					}
				/>
			)}
			<InlineError>{merge.error && "Couldn't merge this. Try again."}</InlineError>
			{refusedBehind && !isBehind && (
				<InlineError>{rebase.error && "Couldn't start this. Try again."}</InlineError>
			)}
			{!merged && pr.group === "failed" && <FailedBanner pr={pr} />}
			{!merged && isBehind && <RebaseBanner pr={pr} />}
			{changing && !merged && (
				<div className="flex max-w-[72ch] flex-col gap-2">
					<Field
						label="What should change?"
						hint="The agent pushes to this PR and the gates run again."
						error={
							noteInvalid && !note.trim() ? "Say what should change so the agent can act on it." : undefined
						}
					>
						{(p) => (
							<textarea
								{...p}
								ref={noteRef}
								rows={3}
								value={note}
								onChange={(e) => setNote(e.target.value)}
							/>
						)}
					</Field>
					<InlineError>{change.error && "Couldn't send this. Try again."}</InlineError>
					<div>
						<Button disabled={change.pending} onClick={submitNote}>
							Send to agent
						</Button>
					</div>
				</div>
			)}
			{pr.body.trim() && (
				<section aria-label="Summary" className="flex max-w-[72ch] flex-col gap-2">
					<SectionLabel>What changed</SectionLabel>
					<PrBody text={pr.body} />
				</section>
			)}
			<section aria-label="Files" className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<SectionLabel>Files · {prSize(pr.additions, pr.deletions)}</SectionLabel>
					<span className="ms-auto">
						<ButtonOut href={`${pr.url}/files`}>Open diff on GitHub</ButtonOut>
					</span>
				</div>
				{pr.files.map((f) => (
					<div key={f.path} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3">
						<span className="min-w-0 font-mono text-data [overflow-wrap:anywhere]">{f.path}</span>
						<span className="ms-auto font-mono text-data tabular-nums text-text-muted">
							{prSize(f.additions, f.deletions)}
						</span>
					</div>
				))}
			</section>
		</Page>
	);
}

export function PrReviewScreen() {
	const { project, number } = useParams({ from: "/shell/prs/$project/$number" });
	const q = usePr(project, Number(number));
	// A merged PR leaves the service, so the refetch fails while the page keeps what it has.
	if (q.data) return <PrReview key={`${project}#${number}`} pr={q.data} />;
	const crumbs = [{ label: "Pull requests", link: { to: "/prs" } }, { label: `#${number}` }];
	if (q.isError) {
		return (
			<Page>
				<Breadcrumb crumbs={crumbs} />
				<LoadFailed what="this pull request" error={q.error} />
			</Page>
		);
	}
	return (
		<Page>
			<Breadcrumb crumbs={crumbs} />
			<StatusLine className="text-text-muted">Loading this pull request</StatusLine>
			<Skeleton width="50%" height={20} />
			<Skeleton width="70%" />
			<Skeleton width="60%" />
		</Page>
	);
}
