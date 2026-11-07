import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { Bus } from "./bus.ts";
import { realCli } from "./cli.ts";
import { loadConfig, selfRepo } from "./config.ts";
import { openDb } from "./db.ts";
import { installDemo } from "./demo.ts";
import { Engine, type EngineEvent } from "./engine.ts";
import { t3Executor } from "./executor/t3.ts";
import { Notifier } from "./notify.ts";
import { Poller } from "./poller.ts";
import { readItemsForNotify } from "./read.ts";
import { Store } from "./store.ts";

const config = loadConfig();
const db = openDb(join(config.dataDir, "factory.db"));
const store = new Store(db, config.dataDir, undefined, config.configDir);
// Reading the rules at boot means a broken file stops the service before it reads anything.
store.neverTouch();

const bus = new Bus();
const demo = config.demo ? installDemo(store) : null;
const cli = demo?.cli ?? realCli;
const executor = demo?.executor ?? t3Executor(realCli);

const notifier = new Notifier(store, cli, config.port);
const onEvent = (e: EngineEvent) => {
	const on = store.settings().notifications.events;
	if (e.kind === "merged_alone" && on.merged_alone) {
		notifier.queue({
			key: `merged:${e.workOrder.id}`,
			event: "merged_alone",
			title: `${e.workOrder.projectName}: merged without you`,
			message: e.prTitle,
			path: `/work-orders/${e.workOrder.id}`,
		});
	}
	if (e.kind === "shipped" && on.shipped) {
		notifier.queue({
			key: `shipped:${e.workOrder.id}`,
			event: "shipped",
			title: `${e.workOrder.projectName}: shipped`,
			message: e.workOrder.title,
			path: `/work-orders/${e.workOrder.id}`,
		});
	}
	if (e.kind === "slots_full" && on.slots_full) {
		notifier.fullOnce(e.agents, e.waiting);
	}
};

let poller: Poller | null = null;
const engine = new Engine({
	store,
	cli,
	executor,
	publish: bus.publish,
	pollSoon: () => poller?.soon(),
	onEvent,
	// The demo's folders are samples. Closing a sample work order touches nothing real.
	git: demo ? async () => ({ ok: true, error: "" }) : undefined,
	selfRepo: demo ? null : selfRepo(),
});

poller = new Poller({
	store,
	cli,
	engine: () => engine,
	publish: bus.publish,
	onRegression: (r) => {
		const approvals = store.settings().approvals;
		if (approvals.mergeWithoutMe[r.type]) {
			approvals.mergeWithoutMe[r.type] = false;
			approvals.turnedOffByRegression[r.type] = true;
			store.saveApprovals(approvals);
			bus.publish(["settings", "health"]);
		}
	},
	onRead: () => notifier.observe(readItemsForNotify(store)),
});

const app = createApp({
	config,
	store,
	cli,
	engine,
	poller,
	notifier,
	bus,
	scaffold: demo?.scaffold,
	extend: demo ? (a) => demo.routes(a, engine, bus) : undefined,
	restart: demo ? () => {} : undefined,
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
	console.log(`Software Factory on http://${config.host}:${info.port}${config.demo ? " (demo)" : ""}`);
});

if (!config.demo) poller.start();

// The engine needs a heartbeat even when GitHub is quiet: agent turns finish on their own time.
const heartbeat = setInterval(() => void engine.tick().catch((e) => console.error(String(e))), 5000);
heartbeat.unref();

const stop = () => {
	poller?.stop();
	clearInterval(heartbeat);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Prevents a stray rejection in a background task from taking the service down.
process.on("unhandledRejection", (e) => console.error(String(e)));
