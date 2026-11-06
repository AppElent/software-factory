import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

describe("Health", () => {
	it("shows the three numbers and no cost", async () => {
		await renderApp("/health", "projects");
		expect(await screen.findByText("Last 14 days")).toBeInTheDocument();
		const buttons = screen
			.getAllByRole("button", { pressed: false })
			.concat(screen.getByRole("button", { pressed: true }));
		expect(buttons).toHaveLength(3);
		expect(screen.getByRole("button", { name: /^Shipped \d+ last 14 days$/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("button", { name: /^First-try \d+% \d+ of \d+$/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^Median to PR \d+m was \d+m$/ })).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/Cost|\$\d/);
		expect(screen.queryByRole("columnheader", { name: /Cost/ })).toBeNull();
	});

	it("switches the chart, with a summary for screen readers", async () => {
		const user = userEvent.setup();
		await renderApp("/health", "projects");
		await screen.findByText("Shipped per day");
		expect(
			screen.getByRole("img", { name: /^Shipped, last 14 days\. Latest \d+\. Highest \d+\.$/ }),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /^Median to PR/ }));
		expect(screen.getByText("Median to PR per day")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^Median to PR/ })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("img", { name: /^Median to PR, last 14 days\./ })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /^First-try/ }));
		expect(screen.getByText("First-try per day")).toBeInTheDocument();
	});

	it("opens the daily numbers in a real table", async () => {
		await renderApp("/health", "projects");
		const summary = await screen.findByText("Show daily numbers");
		const details = summary.closest("details");
		if (!details) throw new Error("No details");
		expect(within(details).getAllByRole("rowheader", { hidden: true })).toHaveLength(14);
	});

	it("uses words for each work type's merging", async () => {
		await renderApp("/health", "merge_ready");
		await screen.findByRole("rowheader", { name: "Toolkit sync" });
		const row = (name: string) =>
			within(screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement);
		expect(row("Toolkit sync").getByText("Can merge without you")).toBeInTheDocument();
		expect(row("Toolkit sync").getByText("12 of 12")).toBeInTheDocument();
		expect(row("Bug fix").getByText("Too few runs")).toBeInTheDocument();
		expect(row("Bug fix").getAllByText("–").length).toBeGreaterThan(0);
	});

	it("turns merging on through the dialog, focus starting on Cancel", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/health", "merge_ready");
		const opener = await screen.findByRole("button", {
			name: "Turn on merging without you for Toolkit sync",
		});
		await user.click(opener);
		const dialog = await screen.findByRole("alertdialog", { name: "Let toolkit syncs merge without you?" });
		expect(within(dialog).getByText(/a toolkit-sync PR merges and ships without you/)).toBeInTheDocument();
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
		expect(await screen.findByText("Merges without you")).toBeInTheDocument();
		expect(h.mutations.at(-1)).toMatch(/^PUT \/api\/settings\/approvals /);
		expect(h.mutations.at(-1)).toContain('"Toolkit sync":true');
	});

	it("keeps the dialog and says so when turning on fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/health", "merge_ready");
		await user.click(await screen.findByRole("button", { name: /^Turn on merging/ }));
		const dialog = await screen.findByRole("alertdialog");
		h.failNext("/api/settings/approvals", 500, "That failed.");
		await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't turn this on. Try again.");
	});

	it("closes the dialog with Escape and returns focus", async () => {
		const user = userEvent.setup();
		await renderApp("/health", "merge_ready");
		const opener = await screen.findByRole("button", { name: /^Turn on merging/ });
		opener.focus();
		await user.keyboard("{Enter}");
		await screen.findByRole("alertdialog");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(opener).toHaveFocus());
	});

	it("holds the numbers back under 10 finished work orders", async () => {
		await renderApp("/health", "few_runs");
		expect(await screen.findByText("3 work orders so far")).toBeInTheDocument();
		expect(screen.getByText("Too little data to trust yet")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Numbers show after 10 finished work orders, because 3 runs can swing from 100% to 67% on one failure. 7 to go.",
			),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "See finished work orders" })).toHaveAttribute("href", "/floor");
		expect(screen.getAllByText("Not enough runs")).toHaveLength(2);
		expect(screen.getByText("Until then, every merge waits for you.")).toBeInTheDocument();
		expect(screen.queryByRole("img", { name: /last 14 days/ })).toBeNull();
		expect(screen.queryByRole("button", { pressed: true })).toBeNull();
		expect(document.body.textContent).not.toMatch(/Cost/);
	});

	it("says when the numbers failed to load", async () => {
		const h = await renderApp("/projects", "projects");
		await screen.findByRole("heading", { name: "Projects" });
		h.failNext("/api/health", 500, "That failed.");
		await h.router.navigate({ to: "/health" });
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the health numbers.");
	});

	it("is reached with g then h", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await screen.findByRole("heading", { name: "Projects" });
		await user.keyboard("gh");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/health"));
	});
});
