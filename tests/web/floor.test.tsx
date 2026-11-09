import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const column = (name: string) => screen.getByRole("region", { name });

describe("floor", () => {
	it("FloorBoard: shows seven columns, slot counts, cards, and gates", async () => {
		await renderApp("/floor");
		await screen.findByRole("heading", { name: "Floor", level: 1 });
		await screen.findByText("Guard the scorecard loader");
		for (const s of ["Intake", "Plan", "Build", "Verify", "Review", "Ship", "Observe"]) {
			expect(column(s)).toBeInTheDocument();
		}
		expect(within(column("Build")).getByText("2/3")).toBeInTheDocument();
		expect(within(column("Verify")).getByText("2/3")).toBeInTheDocument();
		expect(within(column("Plan")).getByText("Approve plan")).toBeInTheDocument();
		expect(within(column("Build")).getByText("Agent asks a question")).toBeInTheDocument();
		expect(within(column("Build")).getByText("Working")).toBeInTheDocument();
		expect(within(column("Verify")).getByText("Tests failed twice")).toBeInTheDocument();
		expect(
			within(column("Verify")).getByRole("img", {
				name: "Typecheck passed, Tests failed, Lint passed, Preview passed",
			}),
		).toBeInTheDocument();
		// Review cards go by PR number and open the PR.
		expect(within(column("Review")).getByRole("link", { name: /#96/ })).toHaveAttribute(
			"href",
			"/prs/roadmaps/96",
		);
		expect(screen.getByRole("link", { name: /shipped this week/ })).toHaveAttribute("href", "/health");
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Build is full|Review is full|Line stopped at/)).not.toBeInTheDocument();
	});

	it("FloorBoard: traces an error to the change that shipped before it, in Observe", async () => {
		await renderApp("/floor");
		await screen.findByText(/Shipped .* · caused 1 error/);
		const observe = column("Observe");
		expect(within(observe).getByText(/Shipped .* · no new errors/)).toBeInTheDocument();
		expect(within(observe).getByRole("link", { name: /FAIRWAY-6001/ })).toHaveAttribute(
			"href",
			"/errors/6001",
		);
		expect(within(observe).getByText("14 users")).toBeInTheDocument();
	});

	it("narrows cards to the chosen projects, in the search params and this browser", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor");
		await screen.findByText("Guard the scorecard loader");
		await user.click(screen.getByRole("button", { name: "Projects: All projects" }));
		await user.click(await screen.findByRole("menuitemcheckbox", { name: "Foundry" }));
		await waitFor(() => expect(h.router.state.location.search).toMatchObject({ projects: "foundry" }));
		expect(window.localStorage.getItem("sf:projects")).toBe("foundry");
		await waitFor(() => expect(screen.queryByText("Guard the scorecard loader")).not.toBeInTheDocument());
		expect(await screen.findByText("Add invoice export")).toBeInTheDocument();
		// The menu stays open, so a second project is one more click.
		await user.click(screen.getByRole("menuitemcheckbox", { name: "Fairway" }));
		await waitFor(() =>
			expect(h.router.state.location.search).toMatchObject({ projects: "foundry,fairway" }),
		);
		await user.keyboard("{Escape}");
		expect(screen.getByRole("button", { name: "Projects: 2 projects" })).toBeInTheDocument();
		// Slots are shared across projects, so the count doesn't narrow.
		expect(within(column("Verify")).getByText("2/3")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Show all" }));
		await screen.findByText("Guard the scorecard loader");
		expect(window.localStorage.getItem("sf:projects")).toBeNull();
	});

	it("reads the chosen projects from the URL on load, and lists projects A to Z", async () => {
		const user = userEvent.setup();
		await renderApp("/floor?projects=foundry");
		await screen.findByText("Add invoice export");
		expect(screen.queryByText("Guard the scorecard loader")).not.toBeInTheDocument();
		expect(screen.getByText(/Showing 1 of \d+ projects\./)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Projects: Foundry" }));
		const items = await screen.findAllByRole("menuitemcheckbox");
		expect(items.slice(0, 3).map((o) => o.textContent?.replace("✓", ""))).toEqual([
			"All projects",
			"Arcade Club",
			"Fairway",
		]);
		expect(screen.getByRole("menuitemcheckbox", { name: "Foundry" })).toHaveAttribute("aria-checked", "true");
	});

	it("keeps the choice when moving to another page", async () => {
		const h = await renderApp("/floor?projects=foundry");
		await screen.findByText("Add invoice export");
		await h.router.navigate({ to: "/prs" });
		await waitFor(() => expect(h.router.state.location.search).toMatchObject({ projects: "foundry" }));
		expect(await screen.findByRole("button", { name: "Projects: Foundry" })).toBeInTheDocument();
	});

	it("drops a project that's no longer in the factory", async () => {
		await renderApp("/floor?projects=gone");
		await screen.findByText("Guard the scorecard loader");
		expect(screen.getByRole("button", { name: "Projects: All projects" })).toBeInTheDocument();
	});

	it("FloorLimit: Build is full", async () => {
		await renderApp("/floor", "limit");
		await screen.findByText("Build is full");
		expect(screen.getByText("Work orders wait in Intake and start when a slot opens.")).toBeInTheDocument();
		const build = column("Build");
		expect(within(build).getByText("Full")).toBeInTheDocument();
		expect(within(build).getByText(/3\/3/)).toBeInTheDocument();
		expect(within(build).getByText("Weekly summary")).toBeInTheDocument();
		expect(screen.queryByText("Review is full")).not.toBeInTheDocument();
	});

	it("FloorReviewHold: Review is full, with its status words per PR", async () => {
		await renderApp("/floor", "review_hold");
		await screen.findByText("Review is full");
		expect(
			screen.getByText("New work waits in Intake until you review a PR. You turned this on in Settings."),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Review PRs" })).toHaveAttribute("href", "/prs");
		expect(screen.getByRole("link", { name: "Change this" })).toHaveAttribute("href", "/settings/agents");
		const review = column("Review");
		expect(within(review).getByText("Full")).toBeInTheDocument();
		expect(within(review).getByText(/3\/3/)).toBeInTheDocument();
		expect(within(review).getByText("Ready to merge")).toBeInTheDocument();
		expect(within(review).getByText("Preview failed")).toBeInTheDocument();
		expect(within(review).getByText("Needs rebase")).toBeInTheDocument();
		expect(within(column("Build")).getByText("2/3")).toBeInTheDocument();
		expect(screen.queryByText("Build is full")).not.toBeInTheDocument();
	});

	it("FloorStopped: alert banner, finishing cards, and restart without a confirm", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor", "stopped");
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText(/^Line stopped at \d\d:\d\d$/)).toBeInTheDocument();
		expect(
			within(alert).getByText(
				"Nothing new starts. 1 agent is finishing the step it’s on, then it holds. PRs and errors keep updating.",
			),
		).toBeInTheDocument();
		const build = column("Build");
		expect(within(build).getByText("Finishing its step")).toBeInTheDocument();
		expect(within(build).getByText("Stopped with the line")).toBeInTheDocument();
		expect(within(build).queryByText("Full")).not.toBeInTheDocument();
		await user.click(within(alert).getByRole("button", { name: "Restart the line" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/line {"stopped":false}'));
		await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
	});

	it("FloorStopped: a failed restart says so by the control and keeps the banner", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor", "stopped");
		const banner = await screen.findByRole("alert");
		h.failNext("/api/line");
		await user.click(within(banner).getByRole("button", { name: "Restart the line" }));
		expect(await screen.findByText("Couldn't restart the line. Try again.")).toBeInTheDocument();
		expect(within(banner).getByText(/^Line stopped at/)).toBeInTheDocument();
	});

	it("FloorLong: long text renders in full on the card", async () => {
		await renderApp("/floor", "long");
		const title = await screen.findByText(/^Make the scorecard loader handle courses/);
		expect(title.className).toContain("overflow-wrap:anywhere");
	});

	it("Nothing at all: every column says Nothing here, and New work order stays in the header", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor", "empty");
		await screen.findAllByText("Nothing here");
		expect(screen.getAllByText("Nothing here")).toHaveLength(7);
		await user.click(screen.getByRole("button", { name: "New work order" }));
		await screen.findByRole("dialog", { name: "New work order" });
		expect(h.router.state.location.search).toMatchObject({ new: "work-order" });
	});

	it("shows a skeleton while loading, never Nothing here", async () => {
		const h = await renderApp("/health");
		await screen.findByRole("navigation", { name: "Main" });
		const real = globalThis.fetch;
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).startsWith("/api/floor")) await gate;
			return real(input, init);
		}) as typeof fetch;
		h.client.removeQueries({ queryKey: ["floor"] });
		await h.router.navigate({ to: "/floor" });
		expect(await screen.findByText("Loading the floor")).toBeInTheDocument();
		expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
		release();
		await screen.findByText("Guard the scorecard loader");
		globalThis.fetch = real;
	});

	it("shows the skeleton until the first read finishes, not an empty board", async () => {
		await renderApp("/floor", "loading");
		await screen.findByRole("heading", { name: "Floor", level: 1 });
		await screen.findByText("Checking GitHub and Sentry");
		expect(await screen.findByText("Loading the floor")).toBeInTheDocument();
		expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
		expect(screen.queryByText(/shipped this week/)).not.toBeInTheDocument();
	});

	it("says so when the floor can't load", async () => {
		const h = await renderApp("/health");
		await screen.findByRole("navigation", { name: "Main" });
		h.client.removeQueries({ queryKey: ["floor"] });
		h.failNext("/api/floor", 500, "That failed.");
		await h.router.navigate({ to: "/floor" });
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load the floor.")).toBeInTheDocument();
		expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
	});

	it("renders an untrusted title as text, never as HTML", async () => {
		const user = userEvent.setup();
		await renderApp("/floor?new=work-order");
		const dialog = await screen.findByRole("dialog", { name: "New work order" });
		await user.type(within(dialog).getByLabelText("What should change?"), "<img src=x onerror=alert(1)>");
		await user.click(within(dialog).getByRole("button", { name: "Start work order" }));
		await screen.findByText("<img src=x onerror=alert(1)>");
		expect(document.querySelector("img[src='x']")).toBeNull();
	});

	it("keyboard: n opens the new work order dialog, and cards are links", async () => {
		const user = userEvent.setup();
		await renderApp("/floor");
		await screen.findByText("Guard the scorecard loader");
		expect(screen.getByRole("link", { name: /Guard the scorecard loader/ })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/work-orders\/\d+$/),
		);
		await user.keyboard("n");
		await screen.findByRole("dialog", { name: "New work order" });
	});
});
