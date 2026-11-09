import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const HOLES = "TypeError: Cannot read properties of undefined (reading 'holes')";
const NETWORK = "NetworkError fetching course list";

describe("errors list", () => {
	it("ErrorsList: groups by project with labels, and a coverage footer", async () => {
		await renderApp("/errors", "errors_list");
		const fairway = await screen.findByRole("region", { name: "Fairway" });
		expect(within(fairway).getByRole("heading", { name: "Fairway · 2" })).toBeInTheDocument();
		expect(within(fairway).getByRole("link", { name: new RegExp(NETWORK) })).toHaveTextContent("Regression");
		expect(within(fairway).getByRole("link", { name: /holes/ })).toHaveTextContent("New");
		expect(within(fairway).getByRole("link", { name: /holes/ })).toHaveTextContent("41 events");
		const gather = screen.getByRole("region", { name: "Gather" });
		expect(within(gather).getByRole("link", { name: /Task sync/ })).toHaveTextContent("Snoozed");
		expect(screen.getByText("3 open in 2 projects")).toBeInTheDocument();
		expect(
			screen.getByText("2 other projects have no open errors. 3 have no Sentry yet. Checked 1 minute ago."),
		).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: `Select ${NETWORK}` })).not.toBeChecked();
	});

	it("filter: nothing open in a project, with the way back", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors?project=labs", "errors_list");
		expect(await screen.findByText("Nothing open in labs.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Show all projects" }));
		await waitFor(() => expect(h.router.state.location.search).toEqual({}));
		expect(await screen.findByRole("region", { name: "Fairway" })).toBeInTheDocument();
	});

	it("ErrorsEmpty: says what was checked and offers to connect the rest", async () => {
		await renderApp("/errors", "empty");
		expect(await screen.findByRole("heading", { name: "No open errors" })).toBeInTheDocument();
		expect(screen.getByText("0 open")).toBeInTheDocument();
		expect(
			screen.getByText("Sentry reports nothing new in 4 connected projects. Checked 1 minute ago."),
		).toBeInTheDocument();
		expect(screen.getByText(/3 projects have no Sentry yet\./)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Connect them in Projects" })).toHaveAttribute(
			"href",
			"/projects",
		);
	});

	it("loading never renders as empty, and a failed load says so", async () => {
		const h = await renderApp("/errors", "loading");
		expect(await screen.findByText("Reading 7 projects")).toBeInTheDocument();
		expect(screen.queryByText("No open errors")).toBeNull();
		await h.scenario("full");
		h.failNext("/api/errors", 500);
		await h.client.resetQueries({ queryKey: ["errors"] });
		expect(await screen.findByText("Couldn't load errors.")).toBeInTheDocument();
	});

	it("ErrorsBulk: the bar counts, labels Start by count, and clears", async () => {
		const user = userEvent.setup();
		await renderApp("/errors", "errors_list");
		await user.click(await screen.findByRole("checkbox", { name: `Select ${HOLES}` }));
		const bar = screen.getByRole("region", { name: "Bulk actions" });
		expect(await within(bar).findByRole("button", { name: "Fix with Standard" })).toBeInTheDocument();
		await user.click(screen.getByRole("checkbox", { name: `Select ${NETWORK}` }));
		expect(within(bar).getByText("2 selected")).toBeInTheDocument();
		expect(await within(bar).findByRole("button", { name: "Fix 2 with Standard" })).toBeInTheDocument();
		await user.click(within(bar).getByRole("button", { name: "Clear" }));
		expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
	});

	it("bulk snooze: rows leave, the note announces, focus lands on Undo, and Undo brings them back", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors", "errors_list");
		await user.click(await screen.findByRole("checkbox", { name: `Select ${HOLES}` }));
		await user.click(screen.getByRole("checkbox", { name: `Select ${NETWORK}` }));
		await user.click(screen.getByRole("button", { name: "Snooze" }));
		await waitFor(() =>
			expect(h.mutations).toContain(
				'POST /api/triage {"fingerprints":["error:6001","error:6002"],"action":"snooze"}',
			),
		);
		const undo = await screen.findByRole("button", { name: "Undo" });
		expect(undo.closest('[role="status"]')).toHaveTextContent("Snoozed 2 errors.");
		await waitFor(() => expect(undo).toHaveFocus());
		expect(screen.queryByRole("region", { name: "Fairway" })).toBeNull();
		await user.click(undo);
		await waitFor(() =>
			expect(h.mutations).toContain(
				'POST /api/triage {"fingerprints":["error:6001","error:6002"],"action":"undo"}',
			),
		);
		expect(await screen.findByRole("region", { name: "Fairway" })).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
	});

	it("bulk dismiss: gone after a reload too, and a failure stays in the bar", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors", "errors_list");
		await user.click(await screen.findByRole("checkbox", { name: `Select ${NETWORK}` }));
		h.failNext("/api/triage");
		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		const bar = screen.getByRole("region", { name: "Bulk actions" });
		expect(await within(bar).findByRole("alert")).toHaveTextContent("Couldn't change these. Try again.");
		expect(screen.getByRole("checkbox", { name: `Select ${NETWORK}` })).toBeChecked();
		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(await screen.findByText(/Dismissed 1 error\./)).toBeInTheDocument();
		await h.client.resetQueries({ queryKey: ["errors"] });
		await screen.findByRole("region", { name: "Fairway" });
		expect(screen.queryByRole("link", { name: new RegExp(NETWORK) })).toBeNull();
		expect(screen.getByText("2 open in 2 projects")).toBeInTheDocument();
	});

	it("bulk start: one work order each, with its source, then the floor", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors", "errors_list");
		await user.click(await screen.findByRole("checkbox", { name: `Select ${HOLES}` }));
		await user.click(screen.getByRole("checkbox", { name: `Select ${NETWORK}` }));
		await user.click(screen.getByRole("button", { name: "Fix 2 with Standard" }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
		const started = h.mutations.filter((m) => m.startsWith("POST /api/work-orders"));
		expect(started).toHaveLength(2);
		expect(started[0]).toContain('"source":{"kind":"error","fingerprint":"error:6001"}');
		expect(started[1]).toContain('"fingerprint":"error:6002"');
	});

	it("a failed bulk start keeps what didn't start selected", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors", "errors_list");
		await user.click(await screen.findByRole("checkbox", { name: `Select ${HOLES}` }));
		h.failNext("/api/work-orders");
		await user.click(screen.getByRole("button", { name: "Fix with Standard" }));
		const bar = screen.getByRole("region", { name: "Bulk actions" });
		expect(await within(bar).findByRole("alert")).toHaveTextContent("Couldn't start these. Try again.");
		expect(screen.getByRole("checkbox", { name: `Select ${HOLES}` })).toBeChecked();
	});
});

describe("error detail", () => {
	it("ErrorNew: head, histogram, stack, release, facts, and actions", async () => {
		await renderApp("/errors/6001");
		expect(await screen.findByRole("heading", { level: 1, name: HOLES })).toBeInTheDocument();
		expect(screen.getByText("New · first seen 3h ago")).toBeInTheDocument();
		const history = screen.getByRole("region", { name: "Event history" });
		expect(within(history).getByRole("img", { name: /rising sharply in the last/ })).toBeInTheDocument();
		expect(within(history).getByText("41 events")).toBeInTheDocument();
		expect(within(history).getByText("14 users")).toBeInTheDocument();
		const stack = screen.getByRole("region", { name: "Stack trace" });
		expect(
			within(stack).getByText(/src\/scorecard\/load\.ts:42 const first = course\.holes\[0\];/),
		).toBeInTheDocument();
		const cause = screen.getByRole("region", { name: "Likely cause" });
		expect(within(cause).getByRole("heading", { name: "In release 1.4.2" })).toBeInTheDocument();
		expect(within(cause).getByRole("link", { name: /Share a round with a link/ })).toHaveTextContent(
			"+312 −40",
		);
		const pane = screen.getByRole("complementary", { name: "Details" });
		expect(within(pane).getByText("FAIRWAY-6001")).toBeInTheDocument();
		expect(within(pane).getByRole("link", { name: "Fairway" })).toHaveAttribute("href", "/projects/fairway");
		expect(
			within(pane).getByText(/Opens a PR after the gates pass\. The mode decides who merges\./),
		).toBeInTheDocument();
		expect(within(pane).getByRole("link", { name: "Open in Sentry" })).toHaveAttribute(
			"href",
			"https://sentry.example/issues/6001",
		);
		expect(within(pane).queryByRole("button", { name: "Unsnooze" })).toBeNull();
	});

	it("Start work order: carries the source and opens the work order", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		await user.click(await screen.findByRole("button", { name: "Fix with Standard" }));
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
		const started = h.mutations.find((m) => m.startsWith("POST /api/work-orders")) as string;
		expect(started).toContain('"project":"fairway"');
		expect(started).toContain('"type":"Bug fix"');
		expect(started).toContain('"source":{"kind":"error","fingerprint":"error:6001"}');
	});

	it("a failed start shows inline and the button stays", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		h.failNext("/api/work-orders");
		await user.click(await within(pane).findByRole("button", { name: "Fix with Standard" }));
		expect(await within(pane).findByRole("alert")).toHaveTextContent("Couldn't start this. Try again.");
		expect(await within(pane).findByRole("button", { name: "Fix with Standard" })).toBeEnabled();
	});

	it("ErrorRegression: says it came back, links the old PR, and tells what the agent gets", async () => {
		await renderApp("/errors/6001", "regression");
		expect(await screen.findByText(/^Regression · came back /)).toBeInTheDocument();
		expect(screen.getByText("This came back after a fix")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /^WO-\d+$/ })).toBeInTheDocument();
		expect(
			screen.getByText(/fixed it on .+ in PR #88\. It returned in release 1\.4\.2\./),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open PR #88" })).toHaveAttribute(
			"href",
			"https://github.com/example-org/fairway/pull/88",
		);
		expect(
			screen.getByText(
				"The new work order gets the old fix and its PR as context, so the agent starts from what already failed.",
			),
		).toBeInTheDocument();
	});

	it("ErrorSnoozed: Snooze switches the page, can still start a fix, and Unsnooze returns", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		await user.click(within(pane).getByRole("button", { name: "Snooze" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"snooze"}'),
		);
		expect(await screen.findAllByText("Snoozed until tomorrow at 09:00")).toHaveLength(2);
		expect(
			screen.getByText(
				"It returns to the queue sooner if it reaches 100 events or reaches users in a new release.",
			),
		).toBeInTheDocument();
		expect(within(pane).getByText("You can start a fix while it is snoozed.")).toBeInTheDocument();
		expect(await within(pane).findByRole("button", { name: "Fix with Standard" })).toBeInTheDocument();
		expect(within(pane).queryByRole("button", { name: "Dismiss" })).toBeNull();
		await user.click(within(pane).getByRole("button", { name: "Unsnooze" }));
		expect(await screen.findByText("New · first seen 3h ago")).toBeInTheDocument();
		expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"undo"}');
	});

	it("a failed snooze says which verb, near the button", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		h.failNext("/api/triage");
		await user.click(within(pane).getByRole("button", { name: "Snooze" }));
		expect(await within(pane).findByRole("alert")).toHaveTextContent("Couldn't snooze this. Try again.");
	});

	it("Dismiss: goes to the list with an Undo that restores it", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		await user.click(await screen.findByRole("button", { name: "Dismiss" }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/errors"));
		expect(await screen.findByText(/Dismissed 1 error\./)).toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "No open errors" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Undo" }));
		expect(await screen.findByRole("region", { name: "Fairway" })).toBeInTheDocument();
		expect(h.mutations).toContain('POST /api/triage {"fingerprints":["error:6001"],"action":"undo"}');
		await waitFor(() => expect(h.router.state.location.search).toEqual({}));
	});

	it("Agents at limit: Add to Intake, with the queue's words", async () => {
		await renderApp("/errors/6001", "limit");
		expect(await screen.findByRole("button", { name: "Add to Intake with Standard" })).toBeInTheDocument();
		expect(
			screen.getByText("All 3 agent slots are busy. This waits in Intake and starts when a slot opens."),
		).toBeInTheDocument();
	});

	it("Line stopped: waits in Intake until restart", async () => {
		await renderApp("/errors/6001", "stopped");
		expect(await screen.findByRole("button", { name: "Add to Intake with Standard" })).toBeInTheDocument();
		expect(
			screen.getByText("The line is stopped. This waits in Intake until you restart."),
		).toBeInTheDocument();
	});

	it("a running fix links the work order instead of starting another", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001");
		await user.click(await screen.findByRole("button", { name: "Fix with Standard" }));
		await waitFor(() => expect(h.router.state.location.pathname).toMatch(/^\/work-orders\/\d+$/));
		await h.router.navigate({ to: "/errors/$id", params: { id: "6001" } });
		expect(await screen.findByRole("link", { name: "Open work order" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Fix with Standard" })).toBeNull();
	});

	it("an unknown error says so", async () => {
		await renderApp("/errors/nope");
		expect(await screen.findByText("Couldn't load this error.")).toBeInTheDocument();
		expect(screen.getByText("That error isn't open.")).toBeInTheDocument();
	});

	it("loads with a status, never as empty", async () => {
		const h = await renderApp("/errors");
		await screen.findByRole("region", { name: "Fairway" });
		const go = h.router.navigate({ to: "/errors/$id", params: { id: "6001" } });
		await go;
		expect(await screen.findByRole("heading", { level: 1, name: HOLES })).toBeInTheDocument();
	});
});
