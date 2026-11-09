import type { QueryClient } from "@tanstack/react-query";
import { api, connection, pageBuild } from "./api.ts";

/** One query prefix per published key, plus the detail queries a list change can affect. */
const ALSO: Record<string, string[]> = {
	projects: ["project"],
	prs: ["pr", "project"],
	errors: ["error", "project"],
	issues: ["shell", "project-environments", "environments"],
	environments: ["project-environments"],
	automations: ["shell"],
	"work-orders": ["project", "pr", "health"],
	line: ["shell", "floor", "queue"],
};

/** Keeps the page current: listens for changes, reports presence, and notices a newer build. */
export function startLive(client: QueryClient) {
	void api
		.post("/api/visit")
		.then(() => client.invalidateQueries({ queryKey: ["queue"] }))
		// The shell's own request shows the offline page.
		.catch(() => {});

	const source = new EventSource("/api/events");
	source.addEventListener("hello", (e) => {
		const { build } = JSON.parse((e as MessageEvent).data) as { build: string };
		connection.setOffline(false);
		const mine = pageBuild();
		connection.setStaleBuild(!!mine && mine !== build);
		// Anything could have happened while the connection was down.
		void client.invalidateQueries();
	});
	source.addEventListener("changed", (e) => {
		const { keys } = JSON.parse((e as MessageEvent).data) as { keys: string[] };
		const prefixes = new Set<string>();
		for (const key of keys) {
			const [head, id] = key.split(":");
			if (!head) continue;
			if (id) {
				void client.invalidateQueries({ queryKey: [head, id] });
			} else {
				prefixes.add(head);
				for (const also of ALSO[head] ?? []) prefixes.add(also);
			}
		}
		for (const p of prefixes) void client.invalidateQueries({ queryKey: [p] });
	});
	source.onerror = () => {
		if (source.readyState !== EventSource.OPEN) void client.invalidateQueries({ queryKey: ["shell"] });
	};

	const beat = () => {
		if (document.visibilityState === "visible" && document.hasFocus())
			void api.post("/api/presence").catch(() => {});
	};
	setInterval(beat, 30_000);
	window.addEventListener("focus", beat);
	beat();
}
