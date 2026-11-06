import { z } from "zod";
import type { StackFrame } from "../../shared/types.ts";
import type { Cli } from "../cli.ts";

const Issue = z.object({
	id: z.string(),
	shortId: z.string(),
	title: z.string(),
	culprit: z.string().nullable().optional(),
	level: z.string().nullable().optional(),
	permalink: z.string(),
	count: z.union([z.string(), z.number()]),
	userCount: z.number(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	stats: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))).optional(),
});
const IssueList = z.object({ data: z.array(Issue) });

export interface SentryIssue {
	id: string;
	shortId: string;
	title: string;
	culprit: string;
	level: string;
	permalink: string;
	events: number;
	users: number;
	firstSeen: string;
	lastSeen: string;
	histogram: number[];
}

export class SentryError extends Error {}

function parseOrThrow(stdout: string, stderr: string) {
	let json: unknown;
	try {
		json = JSON.parse(stdout);
	} catch {
		throw new SentryError(stderr.trim() || "Sentry returned something unreadable.");
	}
	const parsed = IssueList.safeParse(json);
	if (!parsed.success) throw new SentryError("Sentry returned an unexpected response.");
	return parsed.data;
}

export function toIssue(raw: z.infer<typeof Issue>): SentryIssue {
	const series = raw.stats ? (Object.values(raw.stats)[0] ?? []) : [];
	return {
		id: raw.id,
		shortId: raw.shortId,
		title: raw.title,
		culprit: raw.culprit ?? "",
		level: raw.level ?? "error",
		permalink: raw.permalink,
		events: Number(raw.count),
		users: raw.userCount,
		firstSeen: raw.firstSeen,
		lastSeen: raw.lastSeen,
		histogram: series.slice(-24).map(([, n]) => n),
	};
}

export async function readIssues(cli: Cli, org: string, project: string): Promise<SentryIssue[]> {
	const res = await cli(
		"sentry",
		["issue", "list", `${org}/${project}`, "--query", "is:unresolved", "--limit", "25", "--period", "14d", "--json", "--fresh"],
		{ timeoutMs: 60_000 },
	);
	if (res.code !== 0) throw new SentryError(res.stderr.trim() || `sentry exited with ${res.code}`);
	return parseOrThrow(res.stdout, res.stderr).data.map(toIssue);
}

const Org = z.array(z.object({ slug: z.string() }));
const ProjectList = z.union([
	z.object({ data: z.array(z.object({ slug: z.string() })) }),
	z.array(z.object({ slug: z.string() })),
]);

export async function readOrg(cli: Cli): Promise<string> {
	const res = await cli("sentry", ["org", "list", "--json"]);
	if (res.code !== 0) throw new SentryError(res.stderr.trim() || "sentry org list failed");
	const orgs = Org.safeParse(JSON.parse(res.stdout));
	const first = orgs.success ? orgs.data[0] : undefined;
	if (!first) throw new SentryError("No Sentry organisation found.");
	return first.slug;
}

export async function readProjects(cli: Cli, org: string): Promise<string[]> {
	const res = await cli("sentry", ["project", "list", `${org}/`, "--json"]);
	if (res.code !== 0) throw new SentryError(res.stderr.trim() || "sentry project list failed");
	const parsed = ProjectList.safeParse(JSON.parse(res.stdout));
	if (!parsed.success) throw new SentryError("Sentry returned an unexpected response.");
	const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
	return list.map((p) => p.slug);
}

const Frame = z.object({
	filename: z.string().nullable().optional(),
	absPath: z.string().nullable().optional(),
	function: z.string().nullable().optional(),
	lineNo: z.number().nullable().optional(),
	inApp: z.boolean().nullable().optional(),
	context: z.array(z.tuple([z.number(), z.string().nullable()])).nullable().optional(),
});

const View = z.object({
	event: z
		.object({
			release: z.object({ version: z.string().nullable().optional() }).nullable().optional(),
			tags: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
			entries: z.array(z.object({ type: z.string(), data: z.unknown() })).optional(),
		})
		.nullable()
		.optional(),
});

const ExceptionData = z.object({
	values: z.array(z.object({ stacktrace: z.object({ frames: z.array(Frame) }).nullable().optional() })),
});

export interface SentryDetail {
	stack: StackFrame[];
	environment: string | null;
	release: string | null;
	likelySource: string | null;
}

export function parseDetail(stdout: string): SentryDetail {
	const view = View.parse(JSON.parse(stdout));
	const tags = view.event?.tags ?? [];
	const tag = (key: string) => tags.find((t) => t.key === key)?.value ?? null;
	const exception = view.event?.entries?.find((e) => e.type === "exception");
	const data = exception ? ExceptionData.safeParse(exception.data) : null;
	const frames = data?.success ? (data.data.values.at(-1)?.stacktrace?.frames ?? []) : [];
	// Sentry lists the crashing frame last. The page shows it first.
	const stack: StackFrame[] = [...frames]
		.reverse()
		.slice(0, 30)
		.map((f) => ({
			file: f.filename ?? f.absPath ?? f.function ?? "unknown",
			line: f.lineNo ?? null,
			inApp: f.inApp === true,
			context: f.context?.find(([n]) => n === f.lineNo)?.[1]?.trim() ?? f.function ?? null,
		}));
	const top = stack.find((f) => f.inApp);
	return {
		stack,
		environment: tag("environment"),
		release: view.event?.release?.version ?? tag("release"),
		likelySource: top ? `${top.file}${top.line ? `:${top.line}` : ""}` : null,
	};
}

export async function readDetail(cli: Cli, id: string): Promise<SentryDetail | null> {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
	const res = await cli("sentry", ["issue", "view", id, "--json"], { timeoutMs: 60_000 });
	if (res.code !== 0) return null;
	try {
		return parseDetail(res.stdout);
	} catch {
		return null;
	}
}
