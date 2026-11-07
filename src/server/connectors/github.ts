import { createHash } from "node:crypto";
import { z } from "zod";
import { mapGates, prGroup } from "../../shared/rules.ts";
import type {
	CheckBucket,
	CheckRun,
	Issue,
	MainBranchState,
	PullRequest,
	ToolkitState,
} from "../../shared/types.ts";
import type { Cli } from "../cli.ts";
import { scrub } from "../cli.ts";

/** Covers what an agent would get, so an edit to either means reading it again. */
export const issueHash = (title: string, body: string) =>
	createHash("sha256").update(`${title}\0${body}`).digest("hex");

export const TOOLKIT_REPO = "AppElent/developer-tools";

const Contexts = z
	.object({
		contexts: z.object({
			nodes: z.array(
				z.object({
					__typename: z.string(),
					name: z.string().optional(),
					status: z.string().optional(),
					conclusion: z.string().nullable().optional(),
					detailsUrl: z.string().nullable().optional(),
					checkSuite: z
						.object({
							workflowRun: z
								.object({ workflow: z.object({ name: z.string() }) })
								.nullable()
								.optional(),
						})
						.nullable()
						.optional(),
					context: z.string().optional(),
					state: z.string().optional(),
					targetUrl: z.string().nullable().optional(),
				}),
			),
		}),
	})
	.nullable()
	.optional();

const Blob = z.object({ text: z.string().nullable().optional() }).nullable().optional();

const RepoNode = z.object({
	nameWithOwner: z.string(),
	url: z.string(),
	isPrivate: z.boolean(),
	pushedAt: z.string().nullable(),
	defaultBranchRef: z
		.object({
			name: z.string(),
			target: z.object({
				oid: z.string(),
				messageHeadline: z.string(),
				committedDate: z.string(),
				statusCheckRollup: Contexts,
			}),
		})
		.nullable(),
	pullRequests: z.object({
		nodes: z.array(
			z.object({
				number: z.number(),
				title: z.string(),
				url: z.string(),
				body: z.string(),
				isDraft: z.boolean(),
				mergeable: z.string(),
				mergeStateStatus: z.string(),
				additions: z.number(),
				deletions: z.number(),
				changedFiles: z.number(),
				headRefName: z.string(),
				isCrossRepository: z.boolean(),
				baseRefName: z.string(),
				createdAt: z.string(),
				updatedAt: z.string(),
				commits: z.object({
					nodes: z.array(z.object({ commit: z.object({ oid: z.string(), statusCheckRollup: Contexts }) })),
				}),
			}),
		),
	}),
	// Optional, so a repo with Issues turned off still reads. One bad row loses that row and not the repo.
	issues: z
		.object({
			nodes: z.array(
				z
					.object({
						number: z.number(),
						title: z.string(),
						url: z.string(),
						body: z.string().nullable(),
						authorAssociation: z.string().nullable().optional(),
						author: z.object({ login: z.string(), createdAt: z.string().optional() }).nullable().optional(),
						createdAt: z.string(),
						updatedAt: z.string(),
						labels: z
							.object({ nodes: z.array(z.object({ name: z.string() }).nullable()) })
							.nullable()
							.optional(),
						comments: z.object({ totalCount: z.number() }).optional(),
					})
					.nullable(),
			),
		})
		.nullable()
		.optional(),
	devtools: Blob,
	appJson: Blob,
});

const Response = z.object({
	data: z.record(
		z.string(),
		z.union([RepoNode, z.object({ remaining: z.number(), resetAt: z.string() }), z.null()]),
	),
});

const CommitDate = z.object({ commit: z.object({ committer: z.object({ date: z.string() }) }) });
const Compare = z.object({ ahead_by: z.number(), files: z.array(z.unknown()).optional() });

/** An issue as GitHub has it. What the factory thinks of it is worked out when it's read back. */
export type IssueRead = Pick<
	Issue,
	| "number"
	| "title"
	| "url"
	| "body"
	| "author"
	| "authorAssociation"
	| "authorCreatedAt"
	| "createdAt"
	| "updatedAt"
	| "labels"
	| "comments"
	| "bodyHash"
>;

export interface RepoRead {
	repo: string;
	url: string;
	isPrivate: boolean;
	name: string;
	pushedAt: string | null;
	defaultBranch: string;
	main: MainBranchState | null;
	prs: Array<Omit<PullRequest, "project" | "projectName" | "workOrderId" | "workType">>;
	issues: IssueRead[];
	devtoolsCommit: string | null;
}

export interface GithubRead {
	repos: RepoRead[];
	missing: string[];
	rate: { remaining: number; resetAt: string } | null;
}

const FIELDS = `
	nameWithOwner url isPrivate pushedAt
	defaultBranchRef { name target { ... on Commit { oid messageHeadline committedDate statusCheckRollup { contexts(first: 50) { nodes { ...checks } } } } } }
	pullRequests(states: OPEN, first: 40, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
		number title url body isDraft mergeable mergeStateStatus additions deletions changedFiles headRefName isCrossRepository baseRefName createdAt updatedAt
		commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 50) { nodes { ...checks } } } } } }
	} }
	issues(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
		number title url body authorAssociation createdAt updatedAt
		author { login ... on User { createdAt } }
		labels(first: 10) { nodes { name } }
		comments { totalCount }
	} }
	devtools: object(expression: "HEAD:.appelent/devtools.json") { ... on Blob { text } }
	appJson: object(expression: "HEAD:app.json") { ... on Blob { text } }
`;

const CHECKS = `fragment checks on StatusCheckRollupContext { __typename
	... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { workflow { name } } } }
	... on StatusContext { context state targetUrl }
}`;

type Rollup = z.infer<typeof Contexts>;

export function readChecks(rollup: Rollup): CheckRun[] {
	return (rollup?.contexts.nodes ?? []).map((n) => {
		if (n.__typename === "StatusContext") {
			const bucket: CheckBucket =
				n.state === "SUCCESS" ? "pass" : n.state === "PENDING" || n.state === "EXPECTED" ? "running" : "fail";
			return { name: n.context ?? "status", workflow: null, bucket, url: n.targetUrl ?? null };
		}
		let bucket: CheckBucket = "running";
		if (n.status === "COMPLETED") {
			const c = n.conclusion ?? "";
			if (c === "SUCCESS") bucket = "pass";
			// A cancelled run passed nothing, so it isn't the same as one that chose to skip.
			else if (c === "SKIPPED" || c === "NEUTRAL") bucket = "skipped";
			else bucket = "fail";
		}
		return {
			name: n.name ?? "check",
			workflow: n.checkSuite?.workflowRun?.workflow.name ?? null,
			bucket,
			url: n.detailsUrl ?? null,
		};
	});
}

function displayName(repo: string, appJson: string | null | undefined): string {
	const fallback = repo.split("/")[1] ?? repo;
	if (!appJson) return fallback;
	try {
		const name = JSON.parse(appJson)?.expo?.name;
		return typeof name === "string" && name.trim() ? name.trim() : fallback;
	} catch {
		return fallback;
	}
}

function devtoolsCommit(text: string | null | undefined): string | null {
	if (!text) return null;
	try {
		const commit = JSON.parse(text)?.commit;
		return typeof commit === "string" && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
	} catch {
		return null;
	}
}

function readMain(
	target: NonNullable<z.infer<typeof RepoNode>["defaultBranchRef"]>["target"],
): MainBranchState {
	const checks = readChecks(target.statusCheckRollup);
	const failing = checks.filter((c) => c.bucket === "fail");
	const running = checks.some((c) => c.bucket === "running");
	return {
		sha: target.oid,
		message: target.messageHeadline,
		committedAt: target.committedDate,
		state: checks.length === 0 ? "none" : failing.length ? "red" : running ? "running" : "green",
		failing,
	};
}

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Reads every repo in one batched query per 10 repos. Throws GithubError on anything unusable. */
export async function readRepos(cli: Cli, repos: string[], now: number): Promise<GithubRead> {
	const out: GithubRead = { repos: [], missing: [], rate: null };
	const valid = repos.filter((r) => REPO_RE.test(r));
	for (let i = 0; i < valid.length; i += 10) {
		const batch = valid.slice(i, i + 10);
		const vars = batch.flatMap((repo, n) => {
			const [owner, name] = repo.split("/");
			return ["-f", `o${n}=${owner}`, "-f", `n${n}=${name}`];
		});
		const decl = batch.map((_, n) => `$o${n}: String!, $n${n}: String!`).join(", ");
		const body = batch
			.map((_, n) => `r${n}: repository(owner: $o${n}, name: $n${n}) { ${FIELDS} }`)
			.join("\n");
		const query = `query(${decl}) {\n${body}\nrateLimit { remaining resetAt }\n}\n${CHECKS}`;
		const res = await cli("gh", ["api", "graphql", "-f", `query=${query}`, ...vars], { timeoutMs: 60_000 });
		let json: unknown;
		try {
			json = JSON.parse(res.stdout);
		} catch {
			throw new GithubError(res.stderr.trim() || "GitHub returned something unreadable.");
		}
		const parsed = Response.safeParse(json);
		// A repo that's gone returns null plus an error, and gh exits non-zero. The other repos still count.
		if (!parsed.success)
			throw new GithubError(res.stderr.trim() || "GitHub returned an unexpected response.");
		batch.forEach((repo, n) => {
			const node = parsed.data.data[`r${n}`];
			// A renamed repo answers under its new name, which no project here has.
			if (!node || !("nameWithOwner" in node) || node.nameWithOwner.toLowerCase() !== repo.toLowerCase()) {
				out.missing.push(repo);
				return;
			}
			out.repos.push(toRepoRead(node, now));
		});
		const rate = parsed.data.data.rateLimit;
		if (rate && "remaining" in rate) out.rate = rate;
	}
	return out;
}

function toRepoRead(node: z.infer<typeof RepoNode>, now: number): RepoRead {
	return {
		repo: node.nameWithOwner,
		url: node.url,
		isPrivate: node.isPrivate,
		name: displayName(node.nameWithOwner, node.appJson?.text),
		pushedAt: node.pushedAt,
		defaultBranch: node.defaultBranchRef?.name ?? "main",
		main: node.defaultBranchRef ? readMain(node.defaultBranchRef.target) : null,
		devtoolsCommit: devtoolsCommit(node.devtools?.text),
		issues: (node.issues?.nodes ?? []).flatMap((i) =>
			i
				? [
						{
							number: i.number,
							title: i.title,
							url: i.url,
							body: i.body ?? "",
							author: i.author?.login ?? null,
							authorAssociation: i.authorAssociation ?? "NONE",
							authorCreatedAt: i.author?.createdAt ?? null,
							createdAt: i.createdAt,
							updatedAt: i.updatedAt,
							labels: (i.labels?.nodes ?? []).flatMap((l) => (l ? [l.name] : [])),
							comments: i.comments?.totalCount ?? 0,
							bodyHash: issueHash(i.title, i.body ?? ""),
						},
					]
				: [],
		),
		prs: node.pullRequests.nodes.map((pr) => {
			const checks = readChecks(pr.commits.nodes[0]?.commit.statusCheckRollup);
			const gates = mapGates(checks);
			const mergeable = (["MERGEABLE", "CONFLICTING"].includes(pr.mergeable) ? pr.mergeable : "UNKNOWN") as
				| "MERGEABLE"
				| "CONFLICTING"
				| "UNKNOWN";
			return {
				number: pr.number,
				title: pr.title,
				url: pr.url,
				body: pr.body,
				isDraft: pr.isDraft,
				additions: pr.additions,
				deletions: pr.deletions,
				changedFiles: pr.changedFiles,
				headRef: pr.headRefName,
				fromFork: pr.isCrossRepository,
				headSha: pr.commits.nodes[0]?.commit.oid ?? "",
				baseRef: pr.baseRefName,
				createdAt: pr.createdAt,
				updatedAt: pr.updatedAt,
				mergeable,
				mergeState: pr.mergeStateStatus,
				gates,
				checks,
				group: prGroup({
					gates,
					mergeable,
					mergeState: pr.mergeStateStatus,
					updatedAt: pr.updatedAt,
					isDraft: pr.isDraft,
					now,
				}),
			};
		}),
	};
}

export class GithubError extends Error {}

const HEAD = z.object({ sha: z.string(), commit: z.object({ committer: z.object({ date: z.string() }) }) });

const TOOLKIT_CACHE_MS = 60 * 60_000;

/** Compares a project's pinned toolkit commit with the toolkit's main branch. */
export async function readToolkit(
	cli: Cli,
	repo: string,
	commit: string | null,
	cache: Map<string, { state: ToolkitState; at: number }>,
	now: number,
): Promise<ToolkitState> {
	if (repo === TOOLKIT_REPO) return { status: "source", behindDays: 0, changed: 0 };
	if (!commit) return { status: "none", behindDays: 0, changed: 0 };
	const cached = cache.get(commit);
	// The pinned commit doesn't move, but the toolkit does. An old answer stops being true.
	if (cached && now - cached.at < TOOLKIT_CACHE_MS) return cached.state;
	const compare = await cli("gh", ["api", `repos/${TOOLKIT_REPO}/compare/${commit}...HEAD`]);
	if (compare.code !== 0) return { status: "unknown", behindDays: 0, changed: 0 };
	const parsed = Compare.safeParse(JSON.parse(compare.stdout));
	if (!parsed.success) return { status: "unknown", behindDays: 0, changed: 0 };
	if (parsed.data.ahead_by === 0) {
		const state: ToolkitState = { status: "current", behindDays: 0, changed: 0 };
		cache.set(commit, { state, at: now });
		return state;
	}
	const pinned = await cli("gh", ["api", `repos/${TOOLKIT_REPO}/commits/${commit}`]);
	const date = pinned.code === 0 ? CommitDate.safeParse(JSON.parse(pinned.stdout)) : null;
	const days = date?.success
		? Math.floor((now - Date.parse(date.data.commit.committer.date)) / 86_400_000)
		: 0;
	const state: ToolkitState = { status: "behind", behindDays: days, changed: parsed.data.files?.length ?? 0 };
	cache.set(commit, { state, at: now });
	return state;
}

export const parseHead = (stdout: string) => HEAD.parse(JSON.parse(stdout));

const RepoListItem = z.object({
	nameWithOwner: z.string(),
	pushedAt: z.string().nullable(),
	isPrivate: z.boolean(),
	isArchived: z.boolean(),
});

/** Names only. Callers apply never-touch rules before anything else sees them. */
export async function listRepos(cli: Cli) {
	const res = await cli("gh", [
		"repo",
		"list",
		"--limit",
		"300",
		"--json",
		"nameWithOwner,pushedAt,isPrivate,isArchived",
	]);
	if (res.code !== 0) throw new GithubError(res.stderr.trim() || "gh repo list failed.");
	return z
		.array(RepoListItem)
		.parse(JSON.parse(res.stdout))
		.filter((r) => !r.isArchived);
}

const PrFiles = z.object({
	files: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number() })),
});

/** The files a PR changes, or null when GitHub didn't say. Nothing that guards a merge may read null as "none". */
export async function tryReadPrFiles(cli: Cli, repo: string, number: number) {
	const res = await cli("gh", ["pr", "view", String(number), "-R", repo, "--json", "files"]);
	if (res.code !== 0) return null;
	try {
		const parsed = PrFiles.safeParse(JSON.parse(res.stdout));
		return parsed.success ? parsed.data.files : null;
	} catch {
		return null;
	}
}

export const MOST_FILES_GITHUB_LISTS = 3000;

/**
 * Every path a PR touches, including the old name of a moved file, or null when GitHub didn't say. GitHub stops
 * listing at MOST_FILES_GITHUB_LISTS, so a list that long may not be all of it. This one guards merges, and
 * `gh pr view` lists 100 files at most.
 */
export async function tryReadPrPaths(cli: Cli, repo: string, number: number): Promise<string[] | null> {
	const res = await cli("gh", [
		"api",
		"--paginate",
		`repos/${repo}/pulls/${number}/files?per_page=100`,
		"--jq",
		".[] | .filename, (.previous_filename // empty)",
	]);
	if (res.code !== 0) return null;
	return res.stdout.split("\n").filter(Boolean);
}

export async function readPrFiles(cli: Cli, repo: string, number: number) {
	return (await tryReadPrFiles(cli, repo, number)) ?? [];
}

/** Squash by default. Repos that forbid it get a merge commit. Returns GitHub's words on failure. */
export async function mergePr(
	cli: Cli,
	repo: string,
	number: number,
	headSha: string,
): Promise<{ ok: boolean; reason: string }> {
	// GitHub refuses if the PR moved on from the commit the gates were read for.
	const pinned = ["--match-head-commit", headSha];
	const first = await cli("gh", ["pr", "merge", String(number), "-R", repo, "--squash", ...pinned], {
		timeoutMs: 90_000,
	});
	if (first.code === 0) return { ok: true, reason: "" };
	if (/squash merges? (are )?not allowed|not allowed to.*squash/i.test(first.stderr)) {
		const second = await cli("gh", ["pr", "merge", String(number), "-R", repo, "--merge", ...pinned], {
			timeoutMs: 90_000,
		});
		if (second.code === 0) return { ok: true, reason: "" };
		return { ok: false, reason: second.stderr.trim() };
	}
	return { ok: false, reason: first.stderr.trim() };
}

export async function closePr(cli: Cli, repo: string, number: number) {
	// Keeps the branch, per the contract.
	return cli("gh", ["pr", "close", String(number), "-R", repo]);
}

export const PR_UNREADABLE = "unreadable";

/**
 * `--head` matches on the branch's name alone, and anyone can give a fork's branch the same name. So a fork's PR
 * is never the one the agent opened.
 */
export async function prByBranch(
	cli: Cli,
	repo: string,
	branch: string,
): Promise<number | null | typeof PR_UNREADABLE> {
	const res = await cli("gh", [
		"pr",
		"list",
		"-R",
		repo,
		"--head",
		branch,
		"--state",
		"all",
		"--json",
		"number,state,isCrossRepository",
	]);
	if (res.code !== 0) return PR_UNREADABLE;
	try {
		const parsed = z
			.array(z.object({ number: z.number(), isCrossRepository: z.boolean().optional() }))
			.safeParse(JSON.parse(res.stdout));
		if (!parsed.success) return PR_UNREADABLE;
		return parsed.data.find((pr) => !pr.isCrossRepository)?.number ?? null;
	} catch {
		return PR_UNREADABLE;
	}
}

export async function prState(
	cli: Cli,
	repo: string,
	number: number,
): Promise<"OPEN" | "MERGED" | "CLOSED" | null> {
	const res = await cli("gh", ["pr", "view", String(number), "-R", repo, "--json", "state"]);
	if (res.code !== 0) return null;
	const parsed = z.object({ state: z.enum(["OPEN", "MERGED", "CLOSED"]) }).safeParse(JSON.parse(res.stdout));
	return parsed.success ? parsed.data.state : null;
}

export async function cloneRepo(cli: Cli, repo: string, dest: string) {
	return cli("gh", ["repo", "clone", repo, dest], { timeoutMs: 600_000 });
}

const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** `gh run view --log-failed` prefixes each line with job, step, and time, and keeps the terminal's colours. */
export function cleanLog(raw: string): string {
	return raw
		.trim()
		.split("\n")
		.map((line) => line.split("\t").slice(2).join("\t") || line)
		.map((line) => line.replace(COLOUR, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""))
		.slice(-40)
		.join("\n");
}

/** The last lines of a failed job's log, or null. Output is untrusted and only ever shown as text. */
export async function failedLog(cli: Cli, repo: string, url: string | null): Promise<string | null> {
	const run = url?.match(/\/actions\/runs\/(\d+)/)?.[1];
	if (!run) return null;
	const res = await cli("gh", ["run", "view", run, "-R", repo, "--log-failed"], { timeoutMs: 60_000 });
	if (res.code !== 0) return null;
	return scrub(cleanLog(res.stdout));
}
