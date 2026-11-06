import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const pane = () => screen.getByRole("complementary", { name: "Details" });
const needsYou = () => screen.getByRole("region", { name: "Needs you" });
const later = () => screen.getByRole("region", { name: "Later" });
const row = (name: RegExp) => screen.getByRole("button", { name });
/** Waits for the rows, not the skeleton, which is also labelled Needs you. */
const rows = () => screen.findAllByRole("button", { pressed: false });

describe("queue: populated", () => {
	it("shows the summary, stages, groups, footer, and selects the first row", async () => {
		await renderApp("/");
		await rows();
		expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
		expect(screen.getByText(/\d+ need you · \d+ can wait/)).toBeInTheDocument();
		const stages = screen.getByRole("navigation", { name: "Stages" });
		for (const s of ["Intake", "Plan", "Build", "Verify", "Review", "Ship", "Observe"]) {
			expect(within(stages).getByRole("link", { name: new RegExp(s) })).toHaveAttribute("href", "/floor");
		}
		expect(within(stages).getByRole("link", { name: /Build/ })).toHaveTextContent("2/3");
		const first = within(needsYou()).getAllByRole("button")[0];
		expect(first).toHaveAttribute("aria-pressed", "true");
		expect(first).toHaveTextContent("TypeError");
		expect(within(later()).getAllByRole("button").length).toBeGreaterThan(0);
		expect(screen.getByText("start work order")).toBeInTheDocument();
		// One primary per view: the pane's. The header's is secondary.
		expect(screen.getByRole("button", { name: "New work order" })).toHaveClass("btn-secondary");
		expect(within(pane()).getByRole("button", { name: "Start work order" })).toHaveClass("btn-filled");
	});

	it("never mentions cost", async () => {
		await renderApp("/");
		await rows();
		expect(document.body.textContent).not.toMatch(/\$\d|Cost|spent/);
	});

	it("opens the new work order dialog from the header, and returns focus to it", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		const opener = screen.getByRole("button", { name: "New work order" });
		await user.click(opener);
		await screen.findByRole("dialog", { name: "New work order" });
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await waitFor(() => expect(opener).toHaveFocus());
	});
});

describe("queue: pane by item kind", () => {
	it("error", async () => {
		await renderApp("/");
		await rows();
		const p = within(pane());
		await p.findByText("src/scorecard/load.ts:42");
		expect(p.getByRole("heading", { level: 2 })).toHaveTextContent("reading 'holes'");
		expect(await p.findByText("Fairway · production · fairway")).toBeInTheDocument();
		expect(p.getByRole("img", { name: /Events over the last 24 hours, rising sharply/ })).toBeInTheDocument();
		expect(p.getByText("41 events")).toBeInTheDocument();
		expect(p.getByText("14 users")).toBeInTheDocument();
		expect(p.getByText("First release")).toBeInTheDocument();
		expect(p.getByRole("heading", { level: 3, name: "Bug fix" })).toBeInTheDocument();
		expect(p.getByText(/Runs in a T3 thread on a new worktree/)).toBeInTheDocument();
		expect(p.getByRole("link", { name: "Open full error" })).toHaveAttribute("href", "/errors/6001");
	});

	it("question", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/Agent asks: Keep the old migration/));
		const p = within(pane());
		await waitFor(() =>
			expect(p.getByRole("heading", { level: 2 })).toHaveTextContent("Keep the old migration?"),
		);
		expect(p.getByText(/Foundry · WO-\d+ · Build · waiting 8m/)).toBeInTheDocument();
		expect(p.getByRole("link", { name: "Answer" })).toHaveClass("btn-filled");
		expect(p.getByRole("link", { name: "Open work order" })).toBeInTheDocument();
		expect(p.queryByRole("button", { name: "Snooze" })).not.toBeInTheDocument();
	});

	it("plan shows time as its estimate", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/Plan ready: Show the empty scorecard state/));
		const p = within(pane());
		await p.findByRole("link", { name: "Review plan" });
		expect(p.getByText("About 10 minutes")).toBeInTheDocument();
		expect(p.getByText(/Guard the scorecard loader against courses/)).toBeInTheDocument();
	});

	it("red main", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/CI red on main/));
		const p = within(pane());
		await waitFor(() => expect(p.getByText("f81c0de")).toBeInTheDocument());
		expect(p.getByText("Gather · main · CI")).toBeInTheDocument();
		expect(p.getByText("Red for")).toBeInTheDocument();
		expect(p.getByText("Blocks")).toBeInTheDocument();
		expect(p.getByText(/CI \/ check failed/)).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Start work order" })).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
	});

	it("gates failed after retries", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/Tests failed: Fix the leaderboard sort/));
		const p = within(pane());
		await p.findByText("Tests failed twice");
		expect(p.getByText(/expected \[3, 2, 1\], got \[1, 2, 3\]/)).toBeInTheDocument();
		expect(p.getByRole("link", { name: "Open work order" })).toHaveClass("btn-filled");
		expect(p.getByRole("link", { name: "Take over in T3" })).toBeInTheDocument();
	});

	it("ready PR", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/#96 Update the changelog/));
		const p = within(pane());
		await p.findByRole("link", { name: "Review PR" });
		expect(p.getByText(/roadmaps · PR #96/)).toBeInTheDocument();
		expect(p.getByText("All 4 gates passed")).toBeInTheDocument();
		expect(p.getByRole("img", { name: /Typecheck passed/ })).toBeInTheDocument();
		expect(p.getByText("+36 −3 · 2 files")).toBeInTheDocument();
		expect(p.queryByText(/Cost/)).not.toBeInTheDocument();
	});

	it("stale PR", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/#7 Try the new router/));
		const p = within(pane());
		await p.findByText(/stale 40 days/);
		expect(p.getByText(/No commits or comments for 40 days/)).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Start rebase work order" })).toBeInTheDocument();
	});

	it("needs rebase", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/#44 Rename the event model/));
		const p = within(pane());
		await p.findByText(/Gather · PR #44 · needs rebase/);
		expect(p.getByText(/main moved on/)).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Start rebase work order" })).toBeInTheDocument();
	});

	it("toolkit behind", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/Toolkit is behind/));
		const p = within(pane());
		await p.findByText("labs · 41 days behind");
		expect(p.getByText("12 standards changed in developer-tools since the last sync.")).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Start sync work order" })).toBeInTheDocument();
	});

	it("selects the row named by ?select=", async () => {
		await renderApp("/?select=toolkit%3Alabs");
		await rows();
		expect(within(pane()).getByText("labs · 41 days behind")).toBeInTheDocument();
		expect(row(/Toolkit is behind/)).toHaveAttribute("aria-pressed", "true");
	});

	it("falls back to the first row when ?select= names something gone", async () => {
		await renderApp("/?select=error%3Anope");
		await rows();
		expect(within(needsYou()).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true");
	});
});

describe("queue: states", () => {
	it("back after time away: the summary, without any cost", async () => {
		await renderApp("/", "back");
		await rows();
		expect(screen.getByText(/^Since (today|yesterday) at \d\d:\d\d$/)).toBeInTheDocument();
		expect(screen.getByText("4 shipped · 1 gate failed and needs you · 2 new errors")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "See numbers" })).toHaveAttribute("href", "/health");
	});

	it("first look: the banner, with the project count", async () => {
		await renderApp("/", "first_look");
		await rows();
		expect(screen.getByText("Your first queue, ranked from 7 projects")).toBeInTheDocument();
		expect(screen.getByText(/Production errors first, then agents waiting on you/)).toBeInTheDocument();
		expect(
			within(screen.getByRole("navigation", { name: "Stages" })).getByRole("link", { name: /Build/ }),
		).toHaveTextContent("0/3");
	});

	it("nothing needs you: live counts, no pane, Later rows link out", async () => {
		await renderApp("/", "empty");
		await screen.findByRole("heading", { name: "Nothing needs you" });
		expect(screen.getByText("0 need you · 3 can wait")).toBeInTheDocument();
		expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
		expect(
			screen.getByText(
				"No agents are working and nothing is shipping. New errors, questions, and ready PRs land here. The next check runs in 1 minute.",
			),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "New work order" })).toHaveClass("btn-filled");
		expect(screen.getByRole("link", { name: "See the floor" })).toHaveAttribute("href", "/floor");
		expect(within(later()).getByRole("link", { name: /#44 Rename the event model/ })).toHaveAttribute(
			"href",
			"/prs/gather/44",
		);
		expect(within(later()).getByRole("link", { name: /Toolkit is behind/ })).toHaveAttribute(
			"href",
			"/projects/labs",
		);
	});

	it("quiet: nothing at all still shows the panel, without an empty Later", async () => {
		await renderApp("/", "quiet");
		await screen.findByRole("heading", { name: "Nothing needs you" });
		expect(screen.queryByRole("region", { name: "Later" })).not.toBeInTheDocument();
	});

	it("agents at limit: the pane says slots are busy and Start becomes Add to Intake", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/", "limit");
		await rows();
		const p = within(pane());
		expect(
			p.getByText("All 3 agent slots are busy. This waits in Intake and starts when a slot opens."),
		).toBeInTheDocument();
		expect(p.queryByRole("button", { name: "Start work order" })).not.toBeInTheDocument();
		await user.click(p.getByRole("button", { name: "Add to Intake" }));
		await waitFor(() => expect(h.mutations.some((m) => m.startsWith("POST /api/work-orders "))).toBe(true));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("review full: the hold is named", async () => {
		await renderApp("/", "review_hold");
		await rows();
		const p = within(pane());
		expect(p.getByText("New work waits in Intake until you review a PR.")).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Add to Intake" })).toBeInTheDocument();
	});

	it("line stopped: the wait is named", async () => {
		await renderApp("/", "stopped");
		await rows();
		const p = within(pane());
		expect(p.getByText("The line is stopped. This waits in Intake until you restart.")).toBeInTheDocument();
		expect(p.getByRole("button", { name: "Add to Intake" })).toBeInTheDocument();
	});

	it("loading: skeleton and status, never the empty state", async () => {
		await renderApp("/", "loading");
		const status = await screen.findByText(/^Reading \d+ projects$/);
		expect(status).toHaveAttribute("role", "status");
		expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
		expect(needsYou().closest('[aria-busy="true"]')).not.toBeNull();
		expect(
			within(screen.getByRole("navigation", { name: "Main" })).getByText("Checking GitHub and Sentry"),
		).toBeInTheDocument();
	});

	it("before the first answer: skeleton and the known project count, not empty", async () => {
		const user = userEvent.setup();
		await renderApp("/floor");
		const nav = screen.getByRole("navigation", { name: "Main" });
		await within(nav).findByText(/agents working/);
		const answered = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes("/api/queue") ? new Promise(() => {}) : answered(input, init)) as typeof fetch;
		await user.click(within(nav).getByRole("link", { name: /Queue/ }));
		expect(await screen.findByText(/^Reading \d+ projects$/)).toHaveAttribute("role", "status");
		expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
	});

	it("a source failing: alert names the source, age, fix, and what's fine, and old items stay", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/", "degraded");
		await rows();
		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Sentry is out of date: errors are from 38 minutes ago");
		expect(alert).toHaveTextContent(
			"The sentry token expired. Run sentry auth login, then check again. GitHub and T3 are fine.",
		);
		expect(within(needsYou()).getAllByRole("button").length).toBeGreaterThan(0);
		await user.click(within(alert).getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/sources/check {}"));
		const nav = screen.getByRole("navigation", { name: "Main" });
		expect(within(nav).getByText("Sentry synced 38m ago")).toBeInTheDocument();
	});

	it("Check again failing says so by the banner", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/", "degraded");
		await rows();
		h.failNext("/api/sources/check");
		await user.click(screen.getByRole("button", { name: "Check again" }));
		expect(await screen.findByText("Couldn't check this. Try again.")).toBeInTheDocument();
	});

	it("a failed load says so, and doesn't show the empty state", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor");
		await screen.findByRole("heading", { level: 1 });
		h.failNext("/api/queue", 500, "That failed.");
		h.client.removeQueries({ queryKey: ["queue"] });
		await user.click(
			within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /Queue/ }),
		);
		expect(await screen.findByText("Couldn't load the queue.")).toBeInTheDocument();
		expect(screen.queryByText("Nothing needs you")).not.toBeInTheDocument();
	});

	it("long titles wrap, whole, in the row and the pane", async () => {
		const user = userEvent.setup();
		await renderApp("/", "long");
		await rows();
		await user.click(screen.getByRole("button", { name: /RangeError: Maximum call stack/ }));
		const p = within(pane());
		await waitFor(() => expect(p.getByRole("heading", { level: 2 })).toHaveTextContent("render.ts"));
	});

	it("regression names itself in the row", async () => {
		await renderApp("/", "regression");
		await rows();
		expect(within(needsYou()).getAllByText(/Regression · 14 users/).length).toBeGreaterThan(0);
	});

	it("untrusted text stays text", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		await user.click(row(/Tests failed: Fix the leaderboard sort/));
		await within(pane()).findByText("Tests failed twice");
		expect(pane().querySelector("pre")?.children.length).toBe(0);
	});
});

describe("queue: actions", () => {
	it("starts a work order from an error, naming only the item", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Start work order" }));
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
		const sent = h.mutations.find((m) => m.startsWith("POST /api/work-orders "));
		expect(sent).toContain('"source":{"kind":"error","fingerprint":"error:6001"}');
		expect(sent).toContain('"type":"Bug fix"');
	});

	it("starts a work order from red main", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/?select=main%3Agather");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Start work order" }));
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
		expect(h.mutations.find((m) => m.startsWith("POST /api/work-orders "))).toContain(
			'"source":{"kind":"red_main","fingerprint":"main:gather"}',
		);
	});

	it("starts a rebase work order", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/?select=pr%3Agather%3A44");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Start rebase work order" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/gather/44/rebase {}"));
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
	});

	it("starts a sync and goes to the floor", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/?select=toolkit%3Alabs");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Start sync work order" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/projects/sync {"slugs":["labs"]}'));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("a sync blocked by a missing folder says so, with the way to fix it", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/?select=toolkit%3Alabs", "missing_folder_queue");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Start sync work order" }));
		expect(await within(pane()).findByRole("alert")).toHaveTextContent("Folder missing");
		expect(within(pane()).getByRole("link", { name: "Fix labs" })).toHaveAttribute("href", "/projects/labs");
		expect(h.router.state.location.pathname).toBe("/");
	});

	it("shows why a start failed, near the control, and stays put", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		h.failNext("/api/work-orders");
		await user.click(within(pane()).getByRole("button", { name: "Start work order" }));
		expect(await within(pane()).findByRole("alert")).toHaveTextContent("Couldn't start this. Try again.");
		expect(h.router.state.location.pathname).toBe("/");
	});

	it("snoozes: the row leaves, the next is selected, focus moves, the note offers Undo", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Snooze" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"snooze"}'),
		);
		expect(await screen.findByText("Snoozed until tomorrow at 09:00.")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: /reading 'holes'/ })).not.toBeInTheDocument(),
		);
		const first = within(needsYou()).getAllByRole("button")[0];
		await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "true"));
		expect(first).toHaveFocus();
		expect(screen.getByText("Snoozed until tomorrow at 09:00.").closest('[role="status"]')).not.toBeNull();
	});

	it("dismisses, and Undo brings it back and selects it", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Dismiss" }));
		expect(await screen.findByText("Dismissed. It comes back only if it gets worse.")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: /reading 'holes'/ })).not.toBeInTheDocument(),
		);
		await user.click(screen.getByRole("button", { name: "Undo" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"undo"}'),
		);
		const back = await screen.findByRole("button", { name: /reading 'holes'/ });
		await waitFor(() => expect(back).toHaveAttribute("aria-pressed", "true"));
		await waitFor(() => expect(back).toHaveFocus());
		expect(screen.queryByText("Dismissed. It comes back only if it gets worse.")).not.toBeInTheDocument();
	});

	it("a failed snooze keeps the row and says so by the buttons", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		h.failNext("/api/triage");
		await user.click(within(pane()).getByRole("button", { name: "Snooze" }));
		expect(await within(pane()).findByRole("alert")).toHaveTextContent("Couldn't snooze this. Try again.");
		expect(screen.getByRole("button", { name: /reading 'holes'/ })).toHaveAttribute("aria-pressed", "true");
	});

	it("a failed undo says so, and keeps the note", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Dismiss" }));
		const undo = await screen.findByRole("button", { name: "Undo" });
		h.failNext("/api/triage");
		await user.click(undo);
		expect(await screen.findByText("Couldn't undo this. Try again.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
	});

	it("snoozing the last Needs you row hands focus to Undo and shows the panel", async () => {
		const user = userEvent.setup();
		await renderApp("/", "first_look");
		await rows();
		await user.click(within(pane()).getByRole("button", { name: "Snooze" }));
		await waitFor(() => expect(within(needsYou()).getAllByRole("button")).toHaveLength(1));
		await user.click(within(pane()).getByRole("button", { name: "Snooze" }));
		await screen.findByRole("heading", { name: "Nothing needs you" });
		await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus());
		expect(screen.getByText("Snoozed until tomorrow at 09:00.")).toBeInTheDocument();
	});
});

describe("queue: keyboard", () => {
	it("j and k move the selection and the pane, and quick presses add up", async () => {
		const user = userEvent.setup();
		await renderApp("/");
		await rows();
		const buttons = within(needsYou()).getAllByRole("button");
		await user.keyboard("j");
		await waitFor(() => expect(buttons[1]).toHaveAttribute("aria-pressed", "true"));
		expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
		expect(buttons[1]).toHaveFocus();
		await waitFor(() =>
			expect(within(pane()).getByRole("link", { name: "Review plan" })).toBeInTheDocument(),
		);
		await user.keyboard("k");
		await waitFor(() => expect(buttons[0]).toHaveAttribute("aria-pressed", "true"));
		await user.keyboard("jj");
		await waitFor(() => expect(buttons[2]).toHaveAttribute("aria-pressed", "true"));
		await waitFor(() => expect(within(pane()).getByRole("link", { name: "Answer" })).toBeInTheDocument());
	});

	it("keeps the selection in the search param", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("j");
		await waitFor(() =>
			expect((h.router.state.location.search as { select?: string }).select).toMatch(/^wo:\d+:plan$/),
		);
	});

	it("Enter opens the selected item's page", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("{Enter}");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/errors/6001"));
	});

	it("arrows rove, Enter on a focused row selects it, and a second Enter opens it", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		const [first, second] = within(needsYou()).getAllByRole("button");
		first?.focus();
		await user.keyboard("{ArrowDown}");
		expect(second).toHaveFocus();
		expect(second).toHaveAttribute("aria-pressed", "false");
		await user.keyboard("{Enter}");
		await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "true"));
		expect(h.router.state.location.pathname).toBe("/");
		await user.keyboard("{Enter}");
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
	});

	it("Enter on another control leaves it alone", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		screen.getByRole("button", { name: "New work order" }).focus();
		await user.keyboard("{Enter}");
		await screen.findByRole("dialog", { name: "New work order" });
		expect(h.router.state.location.pathname).toBe("/");
	});

	it("w starts a work order on the selected row", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("w");
		await waitFor(() => expect(h.mutations.some((m) => m.startsWith("POST /api/work-orders "))).toBe(true));
	});

	it("w does nothing on a ready PR, and s and d do nothing on a question", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/?select=pr%3Aroadmaps%3A96");
		await rows();
		await user.keyboard("w");
		await user.click(row(/Agent asks/));
		await waitFor(() => expect(row(/Agent asks/)).toHaveAttribute("aria-pressed", "true"));
		await user.keyboard("sd");
		expect(h.mutations).toEqual([]);
	});

	it("s and d triage the selected row", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("s");
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"snooze"}'),
		);
		await screen.findByText("Snoozed until tomorrow at 09:00.");
	});

	it("g s goes to Settings and doesn't snooze", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("gs");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/settings/agents"));
		expect(h.mutations.filter((m) => m.includes("triage"))).toEqual([]);
	});

	it("letters do nothing while a dialog is open", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/");
		await rows();
		await user.keyboard("n");
		const dialog = await screen.findByRole("dialog", { name: "New work order" });
		await user.type(within(dialog).getByLabelText("What should change?"), "sdwjk");
		expect(h.mutations.filter((m) => m.includes("triage"))).toEqual([]);
		expect(within(dialog).getByLabelText("What should change?")).toHaveValue("sdwjk");
	});
});
