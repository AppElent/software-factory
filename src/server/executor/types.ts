export interface ThreadState {
	status: "running" | "queued" | "completed" | "failed" | "waiting_native" | "unknown";
	link: string | null;
	branch: string | null;
	worktree: string | null;
	/** The newest assistant reply, once the turn has ended. */
	lastReply: string | null;
	/** Latest assistant messages, oldest first. */
	recent: string[];
	error: string | null;
}

export interface StartRequest {
	projectPath: string;
	title: string;
	prompt: string;
	baseBranch: string;
	branch: string;
	agent: string;
}

/** The seam for running agents. T3 is the default adapter. See docs/adr/0002-t3-runner.md. */
export interface Executor {
	/** Throws ExecutorError when the run can't start. */
	start(req: StartRequest): Promise<{ threadId: string; link: string | null }>;
	status(threadId: string): Promise<ThreadState>;
	/** Sends the next turn. Nothing is interrupted. */
	send(threadId: string, prompt: string): Promise<void>;
}

export class ExecutorError extends Error {
	/** T3 answered, and this thread no longer exists there. */
	readonly gone: boolean;
	constructor(message: string, gone = false) {
		super(message);
		this.gone = gone;
	}
}
