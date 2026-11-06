import type { NotificationEvent, QueueItem } from "../shared/types.ts";
import type { Cli } from "./cli.ts";
import { audit } from "./db.ts";
import type { Store } from "./store.ts";

export interface Note {
	key: string;
	event: NotificationEvent;
	title: string;
	message: string;
	path: string;
}

const EVENT: Partial<Record<QueueItem["kind"], NotificationEvent>> = {
	error: "error",
	question: "question",
	plan: "plan",
	red_main: "red_main",
	failed_gates: "failed_gates",
	ready_pr: "ready_pr",
};

/** Copy from NotifSamples. */
export function noteFor(item: QueueItem): Note | null {
	const event = EVENT[item.kind];
	if (!event) return null;
	const who = item.projectName ?? "Software Factory";
	const wo = item.workOrder;
	switch (item.kind) {
		case "question":
			return {
				key: `${item.fingerprint}:${wo?.updatedAt}`,
				event,
				title: `${who}: agent asks a question`,
				message: `WO-${wo?.id}: ${wo?.question?.question ?? ""}`,
				path: item.href,
			};
		case "plan":
			return {
				key: `${item.fingerprint}:${wo?.updatedAt}`,
				event,
				title: `${who}: plan ready for you`,
				message: `WO-${wo?.id}: ${wo?.title}`,
				path: item.href,
			};
		case "ready_pr":
			return {
				key: item.fingerprint,
				event,
				title: `${who}: PR ready to merge`,
				message: `#${item.pr?.number} ${item.pr?.title}. All gates passed.`,
				path: item.href,
			};
		case "failed_gates":
			return {
				key: `${item.fingerprint}:${wo?.retries}`,
				event,
				title: `${who}: ${(wo?.failedGate ?? "gate").toLowerCase()} failed`,
				message: `WO-${wo?.id}: ${wo?.title}`,
				path: item.href,
			};
		case "error": {
			const e = item.error;
			if (e?.kind === "regression") {
				return {
					key: `${item.fingerprint}:regression`,
					event,
					title: `${who}: an error came back`,
					message: `${e.title}. Its fix had shipped.`,
					path: item.href,
				};
			}
			return {
				key: item.fingerprint,
				event,
				title: `${who}: new production error`,
				message: `${e?.title}. ${e?.users} ${e?.users === 1 ? "user" : "users"} so far.`,
				path: item.href,
			};
		}
		case "red_main":
			return {
				// Once per project until it's green again: the key is cleared when main is green.
				key: item.fingerprint,
				event,
				title: `${who}: CI red on main`,
				message: `${item.main?.failing[0]?.name ?? "A check"} failed on ${item.main?.sha.slice(0, 7)}.`,
				path: `/?select=${encodeURIComponent(item.fingerprint)}`,
			};
		default:
			return null;
	}
}

/** Several events within a minute arrive as one. */
export function groupNotes(notes: Note[]): Array<Pick<Note, "title" | "message" | "path">> {
	if (notes.length <= 1) return notes;
	const allPrs = notes.every((n) => n.event === "ready_pr");
	const names = [...new Set(notes.map((n) => n.title.split(":")[0] ?? ""))];
	const list = names.length > 1 ? `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}` : (names[0] ?? "");
	if (allPrs) return [{ title: `${notes.length} PRs ready to merge`, message: list, path: "/prs" }];
	return [{ title: `${notes.length} things need you`, message: list, path: "/" }];
}

export function appUrl(port: number, path: string) {
	return `http://127.0.0.1:${port}${path}`;
}

export class Notifier {
	private readonly store: Store;
	private readonly cli: Cli;
	private readonly port: number;
	private pending: Note[] = [];
	private flushTimer: NodeJS.Timeout | null = null;
	private lastSeenAt = 0;
	/** Without a previous pass, everything already in the queue would notify at once. */
	private primed = false;

	constructor(store: Store, cli: Cli, port: number) {
		this.store = store;
		this.cli = cli;
		this.port = port;
	}

	/** The page reports while it's the visible tab. */
	seen() {
		this.lastSeenAt = this.store.now().getTime();
	}

	private away() {
		return this.store.now().getTime() - this.lastSeenAt > 45_000;
	}

	private already(key: string) {
		return this.store.db.prepare("SELECT 1 FROM notified WHERE key = ?").get(key) !== undefined;
	}

	private mark(key: string) {
		this.store.db
			.prepare("INSERT OR IGNORE INTO notified (key, at) VALUES (?, ?)")
			.run(key, this.store.iso());
	}

	/** Compares the queue with what has already been sent. Called after every read. */
	observe(items: QueueItem[]) {
		const settings = this.store.settings().notifications;
		const live = new Set(items.map((i) => i.fingerprint));
		// A green main can go red again and notify again.
		this.store.db
			.prepare("SELECT key FROM notified WHERE key LIKE 'main:%'")
			.all()
			.forEach((row) => {
				const key = (row as { key: string }).key;
				if (!live.has(key)) this.store.db.prepare("DELETE FROM notified WHERE key = ?").run(key);
			});
		for (const item of items) {
			const note = noteFor(item);
			if (!note || this.already(note.key)) continue;
			this.mark(note.key);
			if (this.primed && settings.events[note.event]) this.queue(note);
		}
		this.primed = true;
	}

	/** Once per hour, so a full factory doesn't keep saying so. */
	fullOnce(agents: number, waiting: number) {
		const key = `full:${this.store.iso().slice(0, 13)}`;
		if (this.already(key)) return;
		this.mark(key);
		this.queue({
			key,
			event: "slots_full",
			title: `All ${agents} agents are busy`,
			message: `${waiting} work ${waiting === 1 ? "order is" : "orders are"} waiting in Intake.`,
			path: "/floor",
		});
	}

	queue(note: Note) {
		this.pending.push(note);
		if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => void this.flush(), 60_000);
			this.flushTimer.unref();
		}
	}

	async flush() {
		const notes = this.pending;
		this.pending = [];
		this.flushTimer = null;
		const settings = this.store.settings().notifications;
		if (settings.onlyWhenAway && !this.away()) return;
		for (const n of groupNotes(notes)) await this.send(n);
	}

	async send(n: Pick<Note, "title" | "message" | "path">) {
		const res = await this.cli("terminal-notifier", [
			"-title",
			"Software Factory",
			"-subtitle",
			n.title,
			"-message",
			n.message.slice(0, 200),
			"-open",
			appUrl(this.port, n.path),
			"-group",
			"software-factory",
		]);
		audit(this.store.db, "notify", n.title, "factory", null, this.store.now());
		return res.code === 0;
	}
}
