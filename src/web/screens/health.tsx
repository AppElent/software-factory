import { useState } from "react";
import type { DailyNumbers, HealthResponse, Settings, WorkType, WorkTypeHealth } from "../../shared/types.ts";
import { api } from "../api.ts";
import { minutes, plural } from "../format.ts";
import {
	Banner,
	Button,
	ButtonLink,
	ConfirmDialog,
	Glyph,
	Histogram,
	Lnk,
	LoadFailed,
	Mono,
	Page,
	PageHeader,
	SectionLabel,
	Skeleton,
	StatusLine,
} from "../kit.tsx";
import { ChosenNote, ProjectPicker, useChosenProjects } from "../project-picker.tsx";
import { useAction, useHealth, useSettings } from "../queries.ts";

/** Numbers show from here. */
const EARLY_UNTIL = 10;
/** Below this, a work type's record says too little even to call it `Needs you`. Settings' lowest threshold. */
const FEW_RUNS = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (day: string) => {
	const [, month, date] = day.split("-").map(Number);
	return `${date} ${MONTHS[(month ?? 1) - 1]}`;
};

type MetricKey = "shipped" | "first" | "time";

interface Metric {
	label: string;
	value: string;
	sub: string;
	of: (d: DailyNumbers) => number | null;
	words: (v: number | null) => string;
}

function metrics(h: HealthResponse): Record<MetricKey, Metric> {
	const w = h.window;
	const pct = w.shipped ? Math.round((w.firstTry / w.shipped) * 100) : null;
	const was = w.previousMedianToPrMinutes;
	return {
		shipped: {
			label: "Shipped",
			value: String(w.shipped),
			sub: "last 14 days",
			of: (d) => d.shipped,
			words: (v) => String(v ?? 0),
		},
		first: {
			label: "First-try",
			value: pct === null ? "–" : `${pct}%`,
			sub: `${w.firstTry} of ${w.shipped}`,
			of: (d) => d.firstTryPct,
			words: (v) => (v === null ? "–" : `${v}%`),
		},
		time: {
			label: "Median to PR",
			value: minutes(w.medianToPrMinutes),
			sub: was === null ? "last 14 days" : `was ${minutes(was)}`,
			of: (d) => d.medianToPrMinutes,
			words: minutes,
		},
	};
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
	<>
		<span className="text-meta text-text-muted">{label}</span>{" "}
		<span className="font-mono text-metric">{value}</span>{" "}
		<span className="text-meta text-text-muted">{sub}</span>
	</>
);

function Chart({ metric, daily }: { metric: Metric; daily: DailyNumbers[] }) {
	const values = daily.map(metric.of);
	const known = values.filter((v): v is number => v !== null);
	const latest = values.at(-1) ?? null;
	const highest = known.length ? Math.max(...known) : null;
	const line = `${metric.label}, last 14 days. Latest ${metric.words(latest)}. Highest ${metric.words(highest)}.`;
	return (
		<section aria-label="Chart" className="flex flex-col gap-2">
			<SectionLabel>{metric.label} per day</SectionLabel>
			<div className="border-0 border-b border-solid border-border-subtle">
				<Histogram
					values={values.map((v) => v ?? 0)}
					label={line}
					height={160}
					tip={(_v, i) => {
						const d = daily[i] as DailyNumbers;
						return `${dayWords(d.day)}: ${metric.words(metric.of(d))}`;
					}}
				/>
			</div>
			<div
				aria-hidden="true"
				className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5 text-meta text-text-muted"
			>
				{daily.map((d, i) => (
					<span key={d.day} className="whitespace-nowrap">
						{i % 3 === 0 ? dayWords(d.day) : ""}
					</span>
				))}
			</div>
			<p className="m-0 text-meta text-text-muted">{line}</p>
			<details>
				<summary className="text-meta text-text-muted">Show daily numbers</summary>
				<table className="mt-2 border-collapse text-meta">
					<tbody>
						{daily.map((d) => (
							<tr key={d.day}>
								<th scope="row" className="py-0.5 pe-4 text-start font-normal text-text-muted">
									{dayWords(d.day)}
								</th>
								<td className="text-end">
									<Mono>{metric.words(metric.of(d))}</Mono>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</section>
	);
}

const HEAD =
	"whitespace-nowrap border-0 border-b border-solid border-border-subtle px-3 py-2 text-meta font-medium text-text-muted";
const CELL = "whitespace-nowrap border-0 border-b border-solid border-border-subtle px-3 py-2";

/** The words the dialog needs for each type. */
const TYPE_WORDS: Record<WorkType, { many: string; adjective: string; one: string }> = {
	"Bug fix": { many: "bug fixes", adjective: "bug-fix", one: "a bug fix" },
	Feature: { many: "features", adjective: "feature", one: "a feature" },
	"Toolkit sync": { many: "toolkit syncs", adjective: "toolkit-sync", one: "a toolkit sync" },
	Chore: { many: "chores", adjective: "chore", one: "a chore" },
};

function MergingCell({ row, onAsk }: { row: WorkTypeHealth; onAsk: () => void }) {
	if (row.mergeWithoutMe) {
		return (
			<span className="inline-flex items-center gap-2">
				<Glyph kind="pass" size={14} />
				<span>Merges without you</span>
			</span>
		);
	}
	if (row.qualifies) {
		return (
			<span className="inline-flex items-center gap-2">
				<Glyph kind="pass" size={14} />
				<span>Can merge without you</span>
				<Button aria-label={`Turn on merging without you for ${row.type}`} onClick={onAsk}>
					Turn on
				</Button>
			</span>
		);
	}
	return <span className="text-text-muted">{row.runs < FEW_RUNS ? "Too few runs" : "Needs you"}</span>;
}

function ByWorkType({
	health,
	settings,
	filtered,
}: {
	health: HealthResponse;
	settings: Settings | undefined;
	filtered: boolean;
}) {
	const [asking, setAsking] = useState<WorkType | null>(null);
	const turnOn = useAction(
		(type: WorkType) => {
			const a = (settings as Settings).approvals;
			return api.put("/api/settings/approvals", {
				planReview: a.planReview,
				mergeWithoutMe: { ...a.mergeWithoutMe, [type]: true },
				thresholds: a.thresholds,
			});
		},
		{ onSuccess: () => setAsking(null) },
	);
	const runs = settings?.approvals.thresholds.runs ?? 10;
	const pct = settings?.approvals.thresholds.firstTryPct ?? 80;
	const words = asking && TYPE_WORDS[asking];
	return (
		<section aria-label="By work type" className="flex flex-col gap-2">
			<SectionLabel>By work type</SectionLabel>
			{filtered && (
				<p className="m-0 text-meta text-text-muted">
					Every project counts here, because merging without you is set per work type.
				</p>
			)}
			<div className="overflow-x-auto">
				<table className="w-full border-collapse">
					<thead>
						<tr>
							<th scope="col" className={`${HEAD} text-start`}>
								Work type
							</th>
							<th scope="col" className={`${HEAD} text-end`}>
								Runs
							</th>
							<th scope="col" className={`${HEAD} text-end`}>
								First try
							</th>
							<th scope="col" className={`${HEAD} text-end`}>
								Median to PR
							</th>
							<th scope="col" className={`${HEAD} text-start`}>
								Merging
							</th>
						</tr>
					</thead>
					<tbody>
						{health.byType.map((row) => {
							const firstTry =
								row.firstTryPct === null || row.runs < FEW_RUNS
									? "–"
									: `${Math.round((row.firstTryPct * row.runs) / 100)} of ${row.runs}`;
							return (
								<tr key={row.type}>
									<th scope="row" className={`${CELL} text-start font-medium`}>
										{row.type}
									</th>
									<td className={`${CELL} text-end`}>
										<Mono>{row.runs}</Mono>
									</td>
									<td className={`${CELL} text-end`}>
										<Mono>{firstTry}</Mono>
									</td>
									<td className={`${CELL} text-end`}>
										<Mono>{minutes(row.medianToPrMinutes)}</Mono>
									</td>
									<td className={CELL}>
										<MergingCell
											row={row}
											onAsk={() => {
												turnOn.clearError();
												setAsking(row.type);
											}}
										/>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="m-0 text-meta text-text-muted">
				A work type qualifies after {runs} runs with at least {pct}% passing every gate on the first try and
				no regressions. Nothing changes until you turn it on.{" "}
				<Lnk to="/settings/$section" params={{ section: "approvals" }}>
					Change this in Settings
				</Lnk>
			</p>
			<ConfirmDialog
				open={asking !== null}
				onOpenChange={(next) => {
					if (!next) setAsking(null);
				}}
				title={words ? `Let ${words.many} merge without you?` : ""}
				description={
					words
						? `When all 4 gates pass, ${/^[aeiou]/.test(words.adjective) ? "an" : "a"} ${words.adjective} PR merges without you. You still see it on the floor, and any new error goes back to Intake. If ${words.one} causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.`
						: ""
				}
				action="Turn on"
				actionVariant="primary"
				pending={turnOn.pending || !settings}
				onAction={() => {
					if (asking) void turnOn.run(asking);
				}}
				error={turnOn.error ? `Couldn't turn this on. Try again. ${turnOn.error}` : null}
			/>
		</section>
	);
}

function Early({ health }: { health: HealthResponse }) {
	const n = health.finished;
	const tiles: Array<[string, string, string]> = [
		["Shipped", String(health.finishedChosen), "so far"],
		["First-try", "–", "Not enough runs"],
		["Median to PR", "–", "Not enough runs"],
	];
	return (
		<Page>
			<PageHeader title="Health" summary={`${plural(n, "work order")} so far`} actions={<ProjectPicker />} />
			<ChosenNote />
			<Banner
				title="Too little data to trust yet"
				body={`Numbers show after ${EARLY_UNTIL} finished work orders, because 3 runs can swing from 100% to 67% on one failure. ${EARLY_UNTIL - n} to go.`}
				actions={<ButtonLink to="/floor">See finished work orders</ButtonLink>}
			/>
			<div className="flex flex-wrap gap-2">
				{tiles.map(([label, value, sub]) => (
					<div
						key={label}
						className="flex flex-[1_1_160px] flex-col gap-0.5 rounded-sm border border-solid border-border-subtle px-4 py-3"
					>
						<Tile label={label} value={value} sub={sub} />
					</div>
				))}
			</div>
			<p className="m-0 text-text-muted">Until then, every merge waits for you.</p>
		</Page>
	);
}

function Numbers({ health }: { health: HealthResponse }) {
	const [tab, setTab] = useState<MetricKey>("shipped");
	const settings = useSettings();
	const [chosen] = useChosenProjects();
	const all = metrics(health);
	return (
		<Page>
			<PageHeader title="Health" summary="Last 14 days" actions={<ProjectPicker />} />
			<ChosenNote />
			<div className="flex flex-wrap gap-2">
				{(Object.keys(all) as MetricKey[]).map((key) => (
					<button
						key={key}
						type="button"
						aria-pressed={tab === key}
						onClick={() => setTab(key)}
						className={`btn-secondary flex flex-[1_1_160px] cursor-pointer flex-col items-start gap-0.5 rounded-sm border border-solid border-border-subtle px-4 py-3 text-start font-[inherit] text-text-primary ${tab === key ? "bg-bg-raised" : "bg-transparent"}`}
					>
						<Tile label={all[key].label} value={all[key].value} sub={all[key].sub} />
					</button>
				))}
			</div>
			<Chart metric={all[tab]} daily={health.daily} />
			<ByWorkType health={health} settings={settings.data} filtered={chosen.length > 0} />
		</Page>
	);
}

export function HealthScreen() {
	const [chosen] = useChosenProjects();
	const health = useHealth(chosen);
	if (health.data) {
		return health.data.finished < EARLY_UNTIL ? (
			<Early health={health.data} />
		) : (
			<Numbers health={health.data} />
		);
	}
	return (
		<Page>
			<PageHeader title="Health" />
			{health.isError ? (
				<LoadFailed what="the health numbers" error={health.error} />
			) : (
				<>
					<StatusLine className="text-text-muted">Loading the health numbers</StatusLine>
					<div className="flex flex-wrap gap-2">
						{["a", "b", "c"].map((k) => (
							<Skeleton key={k} width="30%" height={72} />
						))}
					</div>
					<Skeleton width="100%" height={160} />
				</>
			)}
		</Page>
	);
}
