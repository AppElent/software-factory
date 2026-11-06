import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

describe("shell", () => {
	it("shows the nav with counts and the running status", async () => {
		await renderApp("/floor");
		const nav = screen.getByRole("navigation", { name: "Main" });
		await waitFor(() => expect(within(nav).getByText(/agents working/)).toBeInTheDocument());
		expect(within(nav).getByRole("link", { name: /Floor/ })).toHaveAttribute("aria-current", "page");
		expect(within(nav).getByRole("button", { name: "Stop the line" })).toBeInTheDocument();
	});

	it("stops the line through the confirm dialog, with focus starting on Cancel", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor");
		const nav = screen.getByRole("navigation", { name: "Main" });
		await user.click(await within(nav).findByRole("button", { name: "Stop the line" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Stop the line?" });
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		await user.click(within(dialog).getByRole("button", { name: "Stop the line" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/line {"stopped":true}'));
		expect(await within(nav).findByRole("button", { name: "Restart the line" })).toBeInTheDocument();
	});

	it("keeps the description and shows the error when a new work order fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/floor?new=work-order");
		const dialog = await screen.findByRole("dialog", { name: "New work order" });
		await user.click(within(dialog).getByRole("button", { name: "Start work order" }));
		expect(within(dialog).getByText("Describe the change so the agent can plan it.")).toBeInTheDocument();
		await user.type(within(dialog).getByLabelText("What should change?"), "Add a summary");
		h.failNext("/api/work-orders", 500, "That failed.");
		await user.click(within(dialog).getByRole("button", { name: "Start work order" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("That failed.");
		expect(within(dialog).getByLabelText("What should change?")).toHaveValue("Add a summary");
	});

	it("opens the command menu with cmd K and offers a work order from an empty search", async () => {
		const user = userEvent.setup();
		await renderApp("/floor");
		await screen.findByText(/agents working/);
		await user.keyboard("{Meta>}k{/Meta}");
		const input = await screen.findByPlaceholderText("Search or run a command");
		await user.type(input, "zzzzqq");
		expect(await screen.findByText("No results for ‘zzzzqq’.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "New work order from this" })).toBeInTheDocument();
	});

	it("sends a first run to the tools step", async () => {
		const h = await renderApp("/", "first_run");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/welcome/tools"));
	});
});
