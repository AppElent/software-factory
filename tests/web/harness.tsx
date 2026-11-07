import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { Bus } from "../../src/server/bus.ts";
import type { Config } from "../../src/server/config.ts";
import { openDb } from "../../src/server/db.ts";
import { installDemo } from "../../src/server/demo.ts";
import { Engine } from "../../src/server/engine.ts";
import { Notifier } from "../../src/server/notify.ts";
import { Poller } from "../../src/server/poller.ts";
import { Store } from "../../src/server/store.ts";
import { routeTree } from "../../src/web/router.tsx";

const PORT = 4398;
const TOKEN = "t".repeat(32);

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

export interface Harness {
	/** Every request the page sent that changes something: `POST /api/line {"stopped":true}`. */
	mutations: string[];
	/** Calls the service directly, such as moving to another scenario mid-test. */
	scenario: (name: string) => Promise<void>;
	/** Replaces a response for a path, for failures the service can't be pushed into. */
	failNext: (match: string, status?: number, error?: string) => void;
	router: ReturnType<typeof makeRouter>;
	client: QueryClient;
}

const makeRouter = (path: string) =>
	createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
		defaultPreload: false,
	});

/**
 * Renders the real app at `path` against the real service in-process, seeded with a demo scenario.
 * The same scenarios `pnpm demo` serves, so what a test sees is what a browser sees.
 */
export async function renderApp(path: string, scenarioName = "full"): Promise<Harness> {
	const dir = mkdtempSync(join(tmpdir(), "sf-web-"));
	const store = new Store(openDb(join(dir, "factory.db")), dir);
	const demo = installDemo(store);
	const bus = new Bus();
	const config: Config = {
		host: "127.0.0.1",
		port: PORT,
		dataDir: dir,
		sessionToken: TOKEN,
		demo: true,
	} as Config;
	const notifier = new Notifier(store, demo.cli, PORT);
	const engine = new Engine({
		store,
		cli: demo.cli,
		executor: demo.executor,
		publish: bus.publish,
		pollSoon: () => {},
		onEvent: () => {},
	});
	const poller = new Poller({
		store,
		cli: demo.cli,
		engine: () => engine,
		publish: bus.publish,
		onRegression: () => {},
		onRead: () => {},
	});
	const app = createApp({
		config,
		store,
		cli: demo.cli,
		engine,
		executor: demo.executor,
		poller,
		notifier,
		bus,
		scaffold: demo.scaffold,
		extend: (a) => demo.routes(a, engine, bus),
		restart: () => {},
		webRoot: dir,
	});

	const mutations: string[] = [];
	const failures: Array<{ match: string; status: number; error: string }> = [];
	const realFetch = globalThis.fetch;
	const serve = (url: string, init?: RequestInit) =>
		app.request(url, {
			...init,
			headers: { ...(init?.headers as Record<string, string>), host: `127.0.0.1:${PORT}` },
		});
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url === "/api/session") return Response.json({ token: TOKEN });
		const method = init?.method ?? "GET";
		if (method !== "GET") mutations.push(`${method} ${url}${init?.body ? ` ${init.body}` : ""}`);
		const failure = failures.find((f) => url.includes(f.match));
		if (failure) {
			failures.splice(failures.indexOf(failure), 1);
			return Response.json({ error: failure.error }, { status: failure.status });
		}
		return serve(url, init);
	}) as typeof fetch;

	const scenario = async (name: string) => {
		const res = await serve("/api/demo/scenario", {
			method: "POST",
			headers: { "x-sf-session": TOKEN, "content-type": "application/json" },
			body: JSON.stringify({ name }),
		});
		if (!res.ok) throw new Error(`No scenario ${name}: ${await res.text()}`);
	};
	await scenario(scenarioName);

	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
	const router = makeRouter(path);
	await act(async () => {
		render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await router.load();
	});
	cleanups.push(() => {
		client.clear();
		globalThis.fetch = realFetch;
		rmSync(dir, { recursive: true, force: true });
	});
	return {
		mutations,
		scenario,
		failNext: (match, status = 500, error = "That failed.") => failures.push({ match, status, error }),
		router,
		client,
	};
}

export { waitFor };
