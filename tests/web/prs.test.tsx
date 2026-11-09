import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PrDetail } from "../../src/shared/types.ts";
import { renderApp, waitFor } from "./harness.tsx";

const section = (name: string) => screen.findByRole("region", { name });

describe("pull requests list", () => {
	it("PullRequests: groups in order, gates named, no checkbox with one ready PR", async () => {
		await renderApp("/prs", "first_look");
		const ready = await section("Ready to merge");
		expect(within(ready).getByText("Sync toolkit standards")).toBeInTheDocument();
		expect(within(ready).getByRole("img", { name: /Typecheck passed/ })).toBeInTheDocument();
		expect(screen.getByText("1 open in 1 project")).toBeInTheDocument();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("PullRequests: every group shows, in the designed order, and a running row opens its work order", async () => {
		await renderApp("/prs");
		await section("Ready to merge");
		const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
		expect(headings).toEqual([
			"Ready to merge · 2",
			"Gate failed · 1",
			"Running · 1",
			"Needs rebase · 1",
			"Stale · 1",
		]);
		const running = within(await section("Running")).getByRole("link");
		expect(running.getAttribute("href")).toMatch(/^\/work-orders\/\d+$/);
		const failed = within(await section("Gate failed")).getByRole("link");
		expect(failed).toHaveAttribute("href", "/prs/arcade-club/31");
	});

	it("filter: nothing open in a project, with the way back, kept in the URL", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs?project=fairway");
		expect(await screen.findByText("Nothing open in Fairway.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Show all projects" }));
		await section("Ready to merge");
		await user.selectOptions(screen.getByLabelText("Project"), "gather");
		await waitFor(() => expect(h.router.state.location.search).toEqual({ project: "gather" }));
		expect(await section("Needs rebase")).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Ready to merge" })).toBeNull();
	});

	it("PullRequestsEmpty: says so and offers a new work order", async () => {
		const user = userEvent.setup();
		await renderApp("/prs", "quiet");
		expect(await screen.findByRole("heading", { name: "No open pull requests" })).toBeInTheDocument();
		expect(screen.getByText("0 open")).toBeInTheDocument();
		expect(screen.queryByLabelText("Project")).toBeNull();
		await user.click(screen.getByRole("button", { name: "New work order" }));
		expect(await screen.findByRole("dialog", { name: "New work order" })).toBeInTheDocument();
	});

	it("loading never renders as empty", async () => {
		await renderApp("/prs", "loading");
		expect(await screen.findByText("Reading 7 projects")).toBeInTheDocument();
		expect(screen.queryByText("No open pull requests")).toBeNull();
	});

	it("a failed load says so", async () => {
		const h = await renderApp("/floor");
		await screen.findByText(/agents working/);
		// The nav's badge already holds the unfiltered list, so a filtered view is what really fetches here.
		h.failNext("/api/prs?project=gather", 500);
		await h.router.navigate({ to: "/prs", search: { project: "gather" } });
		expect(await screen.findByText("Couldn't load pull requests.")).toBeInTheDocument();
		expect(screen.queryByText("No open pull requests")).toBeNull();
	});

	it("PullRequestsBulk: the bar counts and clears the selection", async () => {
		const user = userEvent.setup();
		await renderApp("/prs", "merge_ready");
		await user.click(await screen.findByRole("checkbox", { name: "Select PR #168" }));
		await user.click(screen.getByRole("checkbox", { name: "Select PR #62" }));
		const bar = screen.getByRole("region", { name: "Bulk actions" });
		expect(within(bar).getByRole("status")).toHaveTextContent("2 selected");
		expect(within(bar).getByRole("button", { name: "Merge 2 PRs" })).toBeInTheDocument();
		await user.click(within(bar).getByRole("button", { name: "Clear" }));
		expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
		expect(screen.getByRole("checkbox", { name: "Select PR #168" })).not.toBeChecked();
	});

	it("PullRequestsBulkConfirm: lists each PR, starts on Cancel, and Escape returns to the opener", async () => {
		const user = userEvent.setup();
		await renderApp("/prs", "merge_ready");
		await user.click(await screen.findByRole("checkbox", { name: "Select PR #168" }));
		await user.click(screen.getByRole("checkbox", { name: "Select PR #62" }));
		const opener = screen.getByRole("button", { name: "Merge 2 PRs" });
		await user.click(opener);
		const dialog = await screen.findByRole("alertdialog", { name: "Merge 2 PRs?" });
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		expect(within(dialog).getByText("#168 Sync toolkit standards · Foundry")).toBeInTheDocument();
		expect(within(dialog).getByText(/All 4 gates passed on each one\./)).toBeInTheDocument();
		expect(within(dialog).getByText(/You can't undo a merge from here\./)).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(opener).toHaveFocus());
	});

	it("doesn't claim four gates when one isn't set up, and still lets it merge", async () => {
		const user = userEvent.setup();
		await renderApp("/prs", "merge_ready");
		await user.click(await screen.findByRole("checkbox", { name: "Select PR #12" }));
		await user.click(screen.getByRole("checkbox", { name: "Select PR #62" }));
		await user.click(screen.getByRole("button", { name: "Merge 2 PRs" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText(/Every gate that's set up passed/)).toBeInTheDocument();
		expect(within(dialog).queryByText(/All 4 gates/)).toBeNull();
	});

	it("PullRequestsBulkDone: reports the split, moves the failed PR, and starts its rebase", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs", "merge_ready");
		for (const n of ["168", "62", "31"]) {
			await user.click(await screen.findByRole("checkbox", { name: `Select PR #${n}` }));
		}
		await user.click(screen.getByRole("button", { name: "Merge 3 PRs" }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "Merge 3 PRs" }));

		const banner = await screen.findByText("2 merged. #31 couldn't merge.");
		const status = banner.closest('[role="status"]') as HTMLElement;
		// Rows sort by age, and seeded PRs can share a millisecond.
		expect(status).toHaveTextContent(
			/(Foundry #168 and Arcade Club #62|Arcade Club #62 and Foundry #168) are shipping now\./,
		);
		expect(status).toHaveTextContent(/satisfactory moved on while #31 waited, so it needs a rebase\./);
		const merge = h.mutations.find((m) => m.startsWith("POST /api/prs/merge"));
		expect(merge).toContain('"number":168');
		expect(merge).toContain('"number":31');
		const rebase = await section("Needs rebase");
		expect(rebase).toHaveTextContent("#31");
		expect(within(rebase).getByRole("img", { name: /Typecheck out of date/ })).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
		expect(within(status).getByRole("link", { name: "See the floor" })).toHaveAttribute("href", "/floor");

		await user.click(within(status).getByRole("button", { name: "Start rebase work order" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/satisfactory/31/rebase {}"));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("a failed bulk merge stays in the dialog, with the selection kept", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs", "merge_ready");
		await user.click(await screen.findByRole("checkbox", { name: "Select PR #168" }));
		await user.click(screen.getByRole("checkbox", { name: "Select PR #62" }));
		await user.click(screen.getByRole("button", { name: "Merge 2 PRs" }));
		const dialog = await screen.findByRole("alertdialog");
		h.failNext("/api/prs/merge");
		await user.click(within(dialog).getByRole("button", { name: "Merge 2 PRs" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't merge these. Try again.");
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(screen.getByRole("checkbox", { name: "Select PR #168" })).toBeChecked();
	});
});

describe("PR review", () => {
	it("PRFix: merges with no dialog, shows Merged, and stays when the PR is gone", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/roadmaps/96");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).getByText("All gates passed · ready to merge")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: "Update the changelog" })).toBeInTheDocument();
		expect(screen.getByText(/· PR #96 · Chore/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open diff on GitHub" })).toHaveAttribute(
			"href",
			"https://github.com/example-org/roadmaps/pull/96/files",
		);
		expect(screen.queryByText(/Cost/)).toBeNull();
		expect(within(pane).getByRole("link", { name: /^WO-\d+$/ })).toBeInTheDocument();
		await user.click(within(pane).getByRole("button", { name: "Merge" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/roadmaps/96/merge {}"));
		expect(await within(pane).findByText(/Merged on GitHub\./)).toBeInTheDocument();
		expect(within(pane).getByRole("link", { name: "See the floor" })).toBeInTheDocument();
		expect(within(pane).queryByRole("button", { name: "Merge" })).toBeNull();
		expect(within(pane).queryByText(/ready to merge/)).toBeNull();
		expect(screen.queryByText("Couldn't load this pull request.")).toBeNull();
	});

	it("PRPassed: a PR with no work order has no work order row or close wording", async () => {
		const user = userEvent.setup();
		await renderApp("/prs/satisfactory/12");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).queryByText("Work order")).toBeNull();
		await user.click(within(pane).getByRole("button", { name: "Close PR" }));
		expect(within(pane).getByText("The branch stays on GitHub.")).toBeInTheDocument();
	});

	it("a gate that isn't set up doesn't block merging by hand", async () => {
		await renderApp("/prs/roadmaps/12", "merge_ready");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).getByText("Ready to merge · Preview not set up")).toBeInTheDocument();
		expect(within(pane).getByRole("button", { name: "Merge" })).toBeEnabled();
		expect(within(pane).getByText("Not set up")).toBeInTheDocument();
	});

	it("single merge failure: an alert with the reason and a rebase when behind", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/satisfactory/31", "merge_ready");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		await user.click(within(pane).getByRole("button", { name: "Merge" }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("#31 couldn't merge.");
		expect(alert).toHaveTextContent("Pull request is behind the base branch");
		// The refetch moves it to Needs rebase, so the pane's button is the one way to start it.
		await user.click(await within(pane).findByRole("button", { name: "Start rebase work order" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/satisfactory/31/rebase {}"));
		expect(within(pane).queryByRole("button", { name: "Merge" })).toBeNull();
	});

	it("a refusal that isn't about the base leaves Merge there to try again", async () => {
		const user = userEvent.setup();
		await renderApp("/prs/roadmaps/96");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		const harnessFetch = globalThis.fetch;
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
			String(input).endsWith("/roadmaps/96/merge")
				? Promise.resolve(Response.json({ ok: false, reason: "Branch protection needs a review" }))
				: harnessFetch(input, init)) as typeof fetch;
		await user.click(within(pane).getByRole("button", { name: "Merge" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Branch protection needs a review");
		expect(within(pane).getByRole("button", { name: "Merge" })).toBeEnabled();
	});

	it("a merge the service can't run shows inline and Merge comes back", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/roadmaps/96");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		h.failNext("/merge");
		await user.click(within(pane).getByRole("button", { name: "Merge" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't merge this. Try again.");
		expect(within(pane).getByRole("button", { name: "Merge" })).toBeEnabled();
	});

	it("PRFailed: banner with the cause and log, Merge absent, send back to the agent", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/arcade-club/31");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(
			within(pane).getByText(/Typecheck, Tests, and Lint failed|failed · can't merge yet/),
		).toBeInTheDocument();
		expect(within(pane).queryByRole("button", { name: "Merge" })).toBeNull();
		expect(screen.getByText(/Merge stays off until the gate passes\./)).toBeInTheDocument();
		expect(screen.getByText(/FAIL tests\/leaderboard\.test\.ts/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open the log" })).toHaveAttribute("href");
		await user.click(within(pane).getByRole("button", { name: "Send back to the agent" }));
		await waitFor(() =>
			expect(h.mutations.some((m) => m.startsWith("POST /api/prs/arcade-club/31/request-changes"))).toBe(
				true,
			),
		);
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("PRRebase: banner, gates out of date, starts the rebase work order", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/gather/44");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).getByText(/^Needs rebase · .+ behind$/)).toBeInTheDocument();
		expect(within(pane).getAllByText("Out of date")).toHaveLength(4);
		expect(screen.getByText("main moved ahead")).toBeInTheDocument();
		expect(
			screen.getByText(/no longer count\. Some files conflict\. A rebase work order resolves them and runs/),
		).toBeInTheDocument();
		expect(within(pane).queryByRole("button", { name: "Merge" })).toBeNull();
		await user.click(within(pane).getByRole("button", { name: "Start rebase work order" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/gather/44/rebase {}"));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("a failed rebase shows inline", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/gather/44");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		h.failNext("/rebase");
		await user.click(within(pane).getByRole("button", { name: "Start rebase work order" }));
		expect(await within(pane).findByRole("alert")).toHaveTextContent("Couldn't start this. Try again.");
	});

	it("Stale: the page offers a rebase", async () => {
		await renderApp("/prs/labs/7");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).getByText(/^Stale · no activity for /)).toBeInTheDocument();
		expect(within(pane).getByRole("button", { name: "Start rebase work order" })).toBeInTheDocument();
	});

	it("Running: Merge absent, Checks running", async () => {
		await renderApp("/prs/foundry/168");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		expect(within(pane).getByText("Checks running")).toBeInTheDocument();
		expect(within(pane).queryByRole("button", { name: "Merge" })).toBeNull();
	});

	it("Request changes: focuses the field, requires text, keeps it on failure, then goes to the floor", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/roadmaps/96");
		await user.click(await screen.findByRole("button", { name: "Request changes" }));
		const field = await screen.findByLabelText("What should change?");
		await waitFor(() => expect(field).toHaveFocus());
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		expect(screen.getByText("Say what should change so the agent can act on it.")).toBeInTheDocument();
		expect(h.mutations).toEqual([]);
		await user.type(field, "Use the shared date helper");
		h.failNext("/request-changes");
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send this. Try again.");
		expect(field).toHaveValue("Use the shared date helper");
		await user.click(screen.getByRole("button", { name: "Send to agent" }));
		await waitFor(() =>
			expect(h.mutations).toContain(
				'POST /api/prs/roadmaps/96/request-changes {"note":"Use the shared date helper"}',
			),
		);
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
	});

	it("Close PR: inline confirm starts on Keep, Escape returns focus, and closing goes to the list", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/roadmaps/96");
		const pane = await screen.findByRole("complementary", { name: "Details" });
		const open = () => within(pane).getByRole("button", { name: "Close PR" });
		await user.click(open());
		await waitFor(() => expect(within(pane).getByRole("button", { name: "Keep it" })).toHaveFocus());
		expect(within(pane).getByText("Close PR #96?")).toBeInTheDocument();
		expect(within(pane).getByText("The branch stays on GitHub. The work order closes.")).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(open()).toHaveFocus());
		await user.click(open());
		h.failNext("/close");
		await user.click(within(pane).getByRole("button", { name: "Close PR" }));
		expect(await within(pane).findByRole("alert")).toHaveTextContent("Couldn't close this. Try again.");
		await user.click(within(pane).getByRole("button", { name: "Close PR" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/prs/roadmaps/96/close {}"));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/prs"));
	});

	it("PRLong: long text is all there", async () => {
		await renderApp("/prs/foundry/170", "long");
		expect(
			await screen.findByRole("heading", { level: 1, name: /legacy federation export/ }),
		).toBeInTheDocument();
		expect(await screen.findByText(/RoundSummaryCard\.integration\.test\.tsx/)).toBeInTheDocument();
		expect(screen.getByText(/renders exactly as it did before\./)).toBeInTheDocument();
	});

	it("a PR body renders as text, never as HTML", async () => {
		const h = await renderApp("/prs/roadmaps/96");
		await screen.findByRole("complementary", { name: "Details" });
		h.client.setQueryData<PrDetail>(["pr", "roadmaps", "96"], (old) =>
			old ? { ...old, body: '<img src=x onerror="alert(1)">\n- <b>bold</b>' } : old,
		);
		expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
		expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
		expect(document.querySelector("main img")).toBeNull();
	});

	it("a PR that isn't open says so", async () => {
		await renderApp("/prs/roadmaps/9999");
		expect(await screen.findByText("Couldn't load this pull request.")).toBeInTheDocument();
		expect(screen.getByText("That PR isn't open.")).toBeInTheDocument();
	});

	it("keyboard: the global g then e works from here, and letters do nothing in the field", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/prs/roadmaps/96");
		await user.click(await screen.findByRole("button", { name: "Request changes" }));
		await waitFor(() => expect(screen.getByLabelText("What should change?")).toHaveFocus());
		await user.keyboard("ge");
		expect(h.router.state.location.pathname).toBe("/prs/roadmaps/96");
		await user.click(screen.getByRole("heading", { level: 1 }));
		await user.keyboard("ge");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/errors"));
	});
});
