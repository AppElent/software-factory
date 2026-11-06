import { z } from "zod";
import type { Cli } from "../cli.ts";
import type { Executor, ThreadState } from "./types.ts";
import { ExecutorError } from "./types.ts";

const StartOut = z.object({ threadId: z.string(), runId: z.string().optional() });

const ShowOut = z.object({
	thread: z.object({
		status: z.string(),
		link: z.string().nullable().optional(),
		branch: z.string().nullable().optional(),
		worktreePath: z.string().nullable().optional(),
		pendingRequestCount: z.number().optional(),
		error: z.string().nullable().optional(),
	}),
	messages: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
});

/** Provider ids T3 needs alongside a model. Empty agent means the project's default. */
function agentFlags(agent: string): string[] {
	// T3 only takes a provider together with a model, and it has no command that lists models.
	if (agent === "codex")
		return ["--provider", "codex", "--model", process.env.SF_CODEX_MODEL ?? "gpt-6.1-terra"];
	return [];
}

export function t3Executor(cli: Cli): Executor {
	return {
		async start(req) {
			// A repo has to be a T3 project first. Adding one twice is a no-op error, so ignore the result.
			await cli("t3", ["project", "add", req.projectPath]);
			const res = await cli(
				"t3",
				[
					"thread",
					"start",
					req.projectPath,
					"-",
					"--title",
					req.title,
					"--worktree",
					req.baseBranch,
					"--branch",
					req.branch,
					"--json",
					...agentFlags(req.agent),
				],
				{ stdin: req.prompt, timeoutMs: 60_000 },
			);
			if (res.code !== 0) throw new ExecutorError(res.stderr.trim() || `t3 exited with ${res.code}`);
			const parsed = StartOut.safeParse(JSON.parse(res.stdout));
			if (!parsed.success) throw new ExecutorError("t3 returned an unexpected response.");
			const state = await this.status(parsed.data.threadId);
			return { threadId: parsed.data.threadId, link: state.link };
		},
		async status(threadId) {
			const res = await cli("t3", ["thread", "show", threadId, "--messages", "12", "--json"], {
				timeoutMs: 30_000,
			});
			if (res.code !== 0) throw new ExecutorError(res.stderr.trim() || `t3 exited with ${res.code}`);
			return parseShow(res.stdout);
		},
		async send(threadId, prompt) {
			const res = await cli("t3", ["thread", "send", threadId, "-", "--json"], {
				stdin: prompt,
				timeoutMs: 60_000,
			});
			if (res.code !== 0) throw new ExecutorError(res.stderr.trim() || `t3 exited with ${res.code}`);
		},
	};
}

export function parseShow(stdout: string): ThreadState {
	const parsed = ShowOut.safeParse(JSON.parse(stdout));
	if (!parsed.success) throw new ExecutorError("t3 returned an unexpected response.");
	const { thread, messages = [] } = parsed.data;
	const assistant = messages.filter((m) => m.role === "assistant").map((m) => m.text);
	const raw = thread.status;
	let status: ThreadState["status"] = "unknown";
	if ((thread.pendingRequestCount ?? 0) > 0) status = "waiting_native";
	else if (raw === "running" || raw === "starting") status = "running";
	else if (raw === "queued") status = "queued";
	else if (raw === "completed") status = "completed";
	else if (raw === "failed" || raw === "interrupted" || raw === "cancelled") status = "failed";
	return {
		status,
		link: thread.link ?? null,
		branch: thread.branch ?? null,
		worktree: thread.worktreePath ?? null,
		lastReply: assistant.at(-1) ?? null,
		recent: assistant.slice(-6),
		error: thread.error ?? null,
	};
}
