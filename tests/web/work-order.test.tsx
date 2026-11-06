import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { type Harness, renderApp, waitFor } from "./harness.tsx";

/** Opens the page of the open work order with this title. */
async function openOrder(title: string, scenario = "full"): Promise<{ h: Harness; id: number }> {
	const h = await renderApp("/floor", scenario);
	const list = (await (await fetch("/api/work-orders")).json()) as Array<{ id: number; title: string }>;
	const found = list.find((w) => w.title === title);
	if (!found) throw new Error(`No work order called ${title}`);
	await act(async () => {
		await h.router.navigate({ to: "/work-orders/$id", params: { id: String(found.id) } });
	});
	await screen.findByRole("heading", { name: title, level: 1 });
	return { h, id: found.id };
}

const pane = () => screen.getByRole("complementary", { name: "Details" });
const paneStatus = () => within(pane()).getAllByRole("status")[0];

describe("work order", () => {
	it("WOPlan: shows the plan, one primary, and an estimate in time only", async () => {
		const { id } = await openOrder("Show the empty scorecard state");
		expect(paneStatus()).toHaveTextContent("Plan ready for you");
		expect(within(pane()).getByText("Claude in T3")).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(`WO-${id}`);
		expect(screen.getByText(`· WO-${id} · Bug fix`, { exact: false })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Fairway" })).toHaveAttribute("href", "/projects/fairway");
		const plan = screen.getByRole("region", { name: "Plan" });
		expect(within(plan).getByText("Add a test for a course with no holes.")).toBeInTheDocument();
		expect(within(plan).getByText("About 10 minutes")).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/\$|Cost/);
		const track = screen.getByRole("list", { name: "Stages" });
		expect(within(track).getByText("Plan").closest("li")).toHaveAttribute("aria-current", "step");
		// Plan shows no activity on its board.
		expect(screen.queryByRole("region", { name: "Activity" })).not.toBeInTheDocument();
		expect(within(pane()).getByRole("link", { name: "Open in T3" })).toHaveAttribute(
			"href",
			"https://t3.example/thread",
		);
	});

	it("WOPlan: approve sends it and stays on the page", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Show the empty scorecard state");
		await user.click(within(pane()).getByRole("button", { name: "Approve plan" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/approve {}`));
		await waitFor(() => expect(paneStatus()).not.toHaveTextContent("Plan ready for you"));
		expect(h.router.state.location.pathname).toBe(`/work-orders/${id}`);
		expect(paneStatus()).toHaveFocus();
	});

	it("WOPlan: a failed approve shows inline and leaves the plan actionable", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Show the empty scorecard state");
		h.failNext("/approve", 409, "That work order has moved on. Reload to see where it is.");
		await user.click(within(pane()).getByRole("button", { name: "Approve plan" }));
		const alert = await within(pane()).findByRole("alert");
		expect(alert).toHaveTextContent("Couldn't approve this. Try again.");
		expect(alert).toHaveTextContent("That work order has moved on.");
		expect(within(pane()).getByRole("button", { name: "Approve plan" })).toBeEnabled();
	});

	it("WOPlan: Change plan needs text, sends it, and says the agent is rewriting", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Show the empty scorecard state");
		await user.click(within(pane()).getByRole("button", { name: "Change plan" }));
		const field = screen.getByLabelText("What should change?");
		expect(field).toHaveFocus();
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		expect(screen.getByText("Say what should change so the agent can rewrite the plan.")).toBeInTheDocument();
		expect(field).toHaveAttribute("aria-invalid", "true");
		expect(h.mutations.filter((m) => m.includes("/change"))).toEqual([]);

		await user.type(field, "Clear the old entries instead");
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		await waitFor(() =>
			expect(h.mutations).toContain(
				`POST /api/work-orders/${id}/change {"note":"Clear the old entries instead"}`,
			),
		);
		expect(
			await screen.findByText("Agent is rewriting the plan. You'll see it here and in the queue."),
		).toBeInTheDocument();
		// The old plan stays readable while the new one is written.
		expect(screen.getByRole("region", { name: "Plan" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Approve plan" })).not.toBeInTheDocument();
	});

	it("WOPlan: a failed change keeps what was typed", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Show the empty scorecard state");
		await user.click(within(pane()).getByRole("button", { name: "Change plan" }));
		await user.type(screen.getByLabelText("What should change?"), "Keep this text");
		h.failNext("/change");
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		expect(await screen.findByText(/Couldn't send this. Try again./)).toBeInTheDocument();
		expect(screen.getByLabelText("What should change?")).toHaveValue("Keep this text");
	});

	it("WOPlan: Escape closes the change box", async () => {
		const user = userEvent.setup();
		await openOrder("Show the empty scorecard state");
		await user.click(within(pane()).getByRole("button", { name: "Change plan" }));
		await user.keyboard("{Escape}");
		expect(screen.queryByLabelText("What should change?")).not.toBeInTheDocument();
	});

	it("WOPlan: reject goes back to the queue", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Show the empty scorecard state");
		await user.click(within(pane()).getByRole("button", { name: "Reject plan" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/reject {}`));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/"));
	});

	it("WORunning: activity, next steps, live output as text, and no primary button", async () => {
		await openOrder("Guard the scorecard loader");
		expect(paneStatus()).toHaveTextContent(/^Agent working · \d+m$/);
		const activity = screen.getByRole("region", { name: "Activity" });
		expect(within(activity).getByText("Plan approved by you")).toBeInTheDocument();
		expect(within(activity).getByText("Run the gates")).toBeInTheDocument();
		expect(within(activity).getByText("Open a PR")).toBeInTheDocument();
		expect(within(activity).getAllByText("next")).toHaveLength(2);
		const output = screen.getByRole("region", { name: "Live output" });
		expect(output.querySelector("pre")).toHaveTextContent("Reading the failing test.");
		expect(output.querySelector("[aria-live]")).toBeNull();
		expect(within(output).getByRole("link", { name: "Open in T3" })).toBeInTheDocument();
		expect(within(pane()).queryByRole("link", { name: "Open in T3" })).not.toBeInTheDocument();
	});

	it("WORunning: Stop is an inline confirm that starts on the safe button, and Escape returns focus", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Guard the scorecard loader");
		const opener = within(pane()).getByRole("button", { name: "Stop this work order" });
		await user.click(opener);
		expect(within(pane()).getByText("Stop this work order?")).toBeInTheDocument();
		expect(
			within(pane()).getByText(
				"The agent stops at its next step. The worktree and branch stay, so you can restart or take over in T3.",
			),
		).toBeInTheDocument();
		expect(within(pane()).getByRole("button", { name: "Keep running" })).toHaveFocus();
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(within(pane()).getByRole("button", { name: "Stop this work order" })).toHaveFocus(),
		);

		await user.click(within(pane()).getByRole("button", { name: "Stop this work order" }));
		await user.click(within(pane()).getByRole("button", { name: "Stop work order" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/stop {}`));
		await waitFor(() => expect(paneStatus()).toHaveTextContent("Stopping at the agent's next step."));
		expect(within(pane()).queryByRole("button", { name: /Stop/ })).not.toBeInTheDocument();
	});

	it("WORunning: a failed stop stays open with the error", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Guard the scorecard loader");
		await user.click(within(pane()).getByRole("button", { name: "Stop this work order" }));
		h.failNext("/stop");
		await user.click(within(pane()).getByRole("button", { name: "Stop work order" }));
		expect(await within(pane()).findByText(/Couldn't stop this. Try again./)).toBeInTheDocument();
		expect(within(pane()).getByRole("button", { name: "Keep running" })).toBeInTheDocument();
	});

	it("Stopping: closing is the only action, so a turn that never ends can't hold its slot", async () => {
		await openOrder("Stopping at the next step", "wo_states");
		expect(paneStatus()).toHaveTextContent("Stopping at the agent's next step.");
		expect(
			within(pane())
				.getAllByRole("button")
				.map((b) => b.textContent),
		).toEqual(["Close work order"]);
	});

	it("WORunning: closing is on offer when the agent never finishes", async () => {
		await openOrder("Guard the scorecard loader");
		expect(within(pane()).getByRole("button", { name: "Stop this work order" })).toBeInTheDocument();
		expect(within(pane()).getByRole("button", { name: "Close work order" })).toBeInTheDocument();
	});

	it("Held: Restart this work order resumes it", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Stopped and held", "wo_states");
		expect(paneStatus()).toHaveTextContent("You stopped this work order");
		await user.click(within(pane()).getByRole("button", { name: "Restart this work order" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/resume {}`));
		await waitFor(() => expect(paneStatus()).not.toHaveTextContent("You stopped this work order"));
	});

	it("Held: a failed resume shows inline", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Stopped and held", "wo_states");
		h.failNext("/resume");
		await user.click(within(pane()).getByRole("button", { name: "Restart this work order" }));
		expect(await within(pane()).findByText(/Couldn't restart this. Try again./)).toBeInTheDocument();
	});

	it("WOQuestion: picks the first option, sends the answer and note, then says it's continuing", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Migrate the invoices table");
		expect(paneStatus()).toHaveTextContent(/^Waiting for your answer · \d+m$/);
		const question = screen.getByRole("region", { name: "Agent question" });
		expect(within(question).getByRole("heading", { name: "Keep the old migration?" })).toBeInTheDocument();
		expect(within(question).getByRole("radio", { name: /Keep it/ })).toBeChecked();
		await user.click(within(question).getByRole("radio", { name: /Remove it/ }));
		await user.type(within(question).getByLabelText("Add a note (optional)"), "Drop it next release");
		await user.click(within(pane()).getByRole("button", { name: "Answer" }));
		await waitFor(() =>
			expect(h.mutations).toContain(
				`POST /api/work-orders/${id}/answer {"answer":"Remove it","note":"Drop it next release"}`,
			),
		);
		expect(await screen.findByText(/Answer sent. The agent is continuing./)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Back to the queue" })).toHaveAttribute("href", "/");
		expect(screen.queryByRole("region", { name: "Agent question" })).not.toBeInTheDocument();
	});

	it("WOQuestion: an open question takes what you type as the answer", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Name the new export", "open_question");
		const answerButton = within(pane()).getByRole("button", { name: "Answer" });
		expect(answerButton).toBeDisabled();
		expect(screen.queryByRole("radio")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("Your answer"), "Ledger export");
		await user.click(answerButton);
		await waitFor(() =>
			expect(h.mutations).toContain(
				`POST /api/work-orders/${id}/answer {"answer":"Ledger export","note":null}`,
			),
		);
	});

	it("WOQuestion: a question you don't want to answer can be closed", async () => {
		await openOrder("Name the new export", "open_question");
		expect(within(pane()).getByRole("button", { name: "Close work order" })).toBeInTheDocument();
	});

	it("WOQuestion: a failed answer keeps the choice and the note", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Migrate the invoices table");
		const question = screen.getByRole("region", { name: "Agent question" });
		await user.click(within(question).getByRole("radio", { name: /Remove it/ }));
		await user.type(within(question).getByLabelText("Add a note (optional)"), "A note");
		h.failNext("/answer");
		await user.click(within(pane()).getByRole("button", { name: "Answer" }));
		expect(await within(pane()).findByText(/Couldn't send this. Try again./)).toBeInTheDocument();
		expect(within(question).getByRole("radio", { name: /Remove it/ })).toBeChecked();
		expect(within(question).getByLabelText("Add a note (optional)")).toHaveValue("A note");
	});

	it("WOQuestion: the stop option closes the work order without the continuing note", async () => {
		const user = userEvent.setup();
		const { id } = await openOrder("Migrate the invoices table");
		await user.click(screen.getByRole("radio", { name: /Stop this work order/ }));
		await user.click(within(pane()).getByRole("button", { name: "Answer" }));
		await waitFor(() => expect(paneStatus()).toHaveTextContent("Closed"));
		expect(screen.queryByText(/Answer sent/)).not.toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(`WO-${id}`);
	});

	it("WOFailed: banner, failure as text, note, and gate words", async () => {
		await openOrder("Fix the leaderboard sort");
		expect(paneStatus()).toHaveTextContent("Tests failed twice");
		expect(screen.getByText("The agent tried once more and the same test failed")).toBeInTheDocument();
		expect(
			screen.getByText("It stops after one retry so it can't keep going. Your call on what happens next."),
		).toBeInTheDocument();
		const failure = screen.getByRole("region", { name: "Failure" });
		expect(failure.querySelector("pre")).toHaveTextContent("expected [3, 2, 1], got [1, 2, 3]");
		expect(within(pane()).getByText("Failed twice")).toBeInTheDocument();
		expect(within(pane()).getByRole("link", { name: "Take over in T3" })).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/spending|\$/);
	});

	it("WOFailed: retry sends the note and goes to the floor", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Fix the leaderboard sort");
		await user.type(screen.getByLabelText("Tell the agent what to try"), "Sort descending");
		await user.click(within(pane()).getByRole("button", { name: "Retry with this note" }));
		await waitFor(() =>
			expect(h.mutations).toContain(`POST /api/work-orders/${id}/retry {"note":"Sort descending"}`),
		);
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("WOFailed: a failed retry keeps the note", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Fix the leaderboard sort");
		await user.type(screen.getByLabelText("Tell the agent what to try"), "Sort descending");
		h.failNext("/retry");
		await user.click(within(pane()).getByRole("button", { name: "Retry with this note" }));
		expect(await within(pane()).findByText(/Couldn't retry this. Try again./)).toBeInTheDocument();
		expect(screen.getByLabelText("Tell the agent what to try")).toHaveValue("Sort descending");
	});

	it("WOFailed: close is an inline confirm, and goes to the floor", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Fix the leaderboard sort");
		await user.click(within(pane()).getByRole("button", { name: "Close work order" }));
		expect(within(pane()).getByText(`Close WO-${id}?`)).toBeInTheDocument();
		expect(within(pane()).getByRole("button", { name: "Keep it" })).toHaveFocus();
		await user.click(within(pane()).getByRole("button", { name: "Close work order" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/close {}`));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("WOStopped: held by the line, with restart and takeover", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Task sync retries twice", "stopped");
		await waitFor(() => expect(paneStatus()).toHaveTextContent(/^Stopped with the line at \d\d:\d\d$/));
		expect(screen.getByText("The line is stopped")).toBeInTheDocument();
		expect(
			screen.getByText(
				"This agent finished its step and stopped. It picks up from here when the line restarts. Its worktree and branch are untouched.",
			),
		).toBeInTheDocument();
		expect(within(pane()).getByRole("link", { name: "Take over in T3" })).toBeInTheDocument();
		await user.click(within(pane()).getByRole("button", { name: "Restart the line" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/line {"stopped":false}'));
	});

	it("WOStopped: a running agent is finishing its step, not stopped yet", async () => {
		await openOrder("Guard the scorecard loader", "stopped");
		await waitFor(() => expect(paneStatus()).toHaveTextContent(/^Finishing its step · \d+m$/));
		expect(within(pane()).getByRole("button", { name: "Restart the line" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Live output" })).toBeInTheDocument();
	});

	it("WOStopped: waiting work says it waits in Intake", async () => {
		await openOrder("Add the round summary", "stopped");
		expect(await screen.findByText("This waits in Intake until you restart.")).toBeInTheDocument();
	});

	it("WOStopped: a failed restart shows inline", async () => {
		const user = userEvent.setup();
		const { h } = await openOrder("Task sync retries twice", "stopped");
		const button = await within(pane()).findByRole("button", { name: "Restart the line" });
		h.failNext("/api/line");
		await user.click(button);
		expect(await within(pane()).findByText("Couldn't restart the line. Try again.")).toBeInTheDocument();
	});

	it("WOReady: Review PR is the primary and opens the PR", async () => {
		await openOrder("Update the changelog");
		expect(paneStatus()).toHaveTextContent("PR #96 ready for you");
		expect(within(pane()).getByRole("link", { name: "Review PR" })).toHaveAttribute(
			"href",
			"/prs/roadmaps/96",
		);
		expect(within(pane()).getAllByText("Passed")).toHaveLength(4);
	});

	it("waiting_in_t3: Open in T3 is the primary", async () => {
		await openOrder("Agent waiting in T3", "wo_states");
		expect(paneStatus()).toHaveTextContent("Agent is waiting in T3");
		expect(screen.getByText("The agent needs you in T3")).toBeInTheDocument();
		const link = within(pane()).getByRole("link", { name: "Open in T3" });
		expect(link).toHaveAttribute("href", "https://t3.example/thread");
		expect(link.className).toContain("bg-accent-solid");
	});

	it("run_failed: alerts, shows what T3 said, and tries again", async () => {
		const user = userEvent.setup();
		const { h, id } = await openOrder("Run that T3 couldn't start", "wo_states");
		const alert = within(pane()).getByRole("alert");
		expect(alert).toHaveTextContent("This run failed.");
		const failure = screen.getByRole("region", { name: "Failure" });
		expect(failure.querySelector("pre")).toHaveTextContent("worktree already exists");
		expect(within(pane()).getByRole("link", { name: "Open in T3" })).toBeInTheDocument();
		await user.click(within(pane()).getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(h.mutations).toContain(`POST /api/work-orders/${id}/retry {"note":null}`));
	});

	it("run_failed: with no thread there's no link to T3", async () => {
		await openOrder("Run with no thread", "wo_states");
		expect(within(pane()).getByRole("alert")).toHaveTextContent("This run failed.");
		expect(screen.queryByRole("link", { name: "Open in T3" })).not.toBeInTheDocument();
		expect(within(pane()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
	});

	it("planning: says the agent is writing the plan", async () => {
		await openOrder("Write the first plan", "wo_states");
		expect(paneStatus()).toHaveTextContent(/^Agent working/);
		expect(
			screen.getByText("Agent is writing the plan. You'll see it here and in the queue."),
		).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Plan" })).not.toBeInTheDocument();
	});

	it("verifying: gates running, and it can still be stopped", async () => {
		await openOrder("Add invoice export");
		expect(paneStatus()).toHaveTextContent(/^Gates running · \d+m$/);
		expect(within(pane()).getByRole("button", { name: "Stop this work order" })).toBeInTheDocument();
	});

	it("waiting: says it's in Intake and can be closed", async () => {
		await openOrder("Add the round summary");
		expect(paneStatus()).toHaveTextContent("Waiting in Intake");
		expect(within(pane()).getByRole("button", { name: "Close work order" })).toBeInTheDocument();
	});

	it("shipping and observing say the change is out, with no actions to take", async () => {
		await openOrder("Remove the old export");
		expect(paneStatus()).toHaveTextContent("Merged. Shipping to production now.");
		expect(within(pane()).queryByRole("button")).not.toBeInTheDocument();
	});

	it("observing: watching for errors", async () => {
		await openOrder("Fix the handicap rounding");
		expect(paneStatus()).toHaveTextContent(/^Shipped .* · watching for errors$/);
	});

	it("activity details open as text, and a pasted tag stays text", async () => {
		const user = userEvent.setup();
		await openOrder("Rewrite the plan", "wo_states");
		const activity = screen.getByRole("region", { name: "Activity" });
		await user.click(within(activity).getByText("You asked for changes to the plan"));
		expect(within(activity).getByText("Clear the old entries.")).toBeVisible();
	});

	it("says so when the work order can't load", async () => {
		await renderApp("/work-orders/999999");
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load this work order.")).toBeInTheDocument();
		expect(within(alert).getByText("That work order doesn't exist.")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Floor" })).toBeInTheDocument();
	});
});
