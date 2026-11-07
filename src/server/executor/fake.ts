import type { AskReply, AskRequest, Executor, StartRequest, ThreadState } from "./types.ts";
import { ExecutorError } from "./types.ts";

export interface FakeThread {
	id: string;
	req: StartRequest;
	sent: string[];
	state: ThreadState;
}

/** Drives work-order flows in tests and demo mode. Tests decide when a turn ends. */
export class FakeExecutor implements Executor {
	threads = new Map<string, FakeThread>();
	failStart: string | null = null;
	/** Set to end every turn at once with this reply. */
	autoReply: ((prompt: string, t: FakeThread) => string) | null = null;
	private n = 0;

	async start(req: StartRequest) {
		if (this.failStart) throw new ExecutorError(this.failStart);
		this.n += 1;
		const id = `fake:${this.n}`;
		const link = `https://t3.example/threads/${this.n}`;
		const thread: FakeThread = {
			id,
			req,
			sent: [req.prompt],
			state: {
				status: "running",
				link,
				branch: req.branch,
				worktree: `/tmp/worktrees/${req.branch.replaceAll("/", "-")}`,
				lastReply: null,
				recent: [],
				error: null,
			},
		};
		this.threads.set(id, thread);
		if (this.autoReply) this.finish(id, this.autoReply(req.prompt, thread));
		return { threadId: id, link };
	}

	async status(threadId: string) {
		const t = this.threads.get(threadId);
		if (!t) throw new ExecutorError(`Thread ${threadId} is no longer available.`, true);
		return t.state;
	}

	async send(threadId: string, prompt: string) {
		const t = this.threads.get(threadId);
		if (!t) throw new ExecutorError(`Thread ${threadId} is no longer available.`, true);
		t.sent.push(prompt);
		t.state = { ...t.state, status: "running", lastReply: null };
		if (this.autoReply) this.finish(threadId, this.autoReply(prompt, t));
	}

	asked: AskRequest[] = [];
	askReply: string | Error = "```json\n{}\n```";

	async ask(req: AskRequest): Promise<AskReply> {
		this.asked.push(req);
		if (this.askReply instanceof Error) throw this.askReply;
		return { reply: this.askReply, link: "https://t3.example/threads/asked" };
	}

	/** Ends the current turn. */
	finish(threadId: string, reply: string) {
		const t = this.threads.get(threadId);
		if (!t) throw new Error(`No thread ${threadId}`);
		t.state = {
			...t.state,
			status: "completed",
			lastReply: reply,
			recent: [...t.state.recent, reply].slice(-6),
		};
	}

	fail(threadId: string, error: string) {
		const t = this.threads.get(threadId);
		if (!t) throw new Error(`No thread ${threadId}`);
		t.state = { ...t.state, status: "failed", error };
	}

	nativeWait(threadId: string) {
		const t = this.threads.get(threadId);
		if (!t) throw new Error(`No thread ${threadId}`);
		t.state = { ...t.state, status: "waiting_native" };
	}

	last(): FakeThread | undefined {
		return [...this.threads.values()].at(-1);
	}
}
