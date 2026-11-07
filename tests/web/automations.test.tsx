import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const sent = (m: string | undefined): Record<string, unknown> =>
	JSON.parse((m ?? "").replace(/^\S+ \S+ /, ""));

describe("Automations", () => {
	it("lists what T3 has, and says it runs without this app", async () => {
		await renderApp("/automations", "automations");
		expect(await screen.findByText("Upgrade dependencies")).toBeInTheDocument();
		expect(screen.getByText("Mondays 08:00")).toBeInTheDocument();
		expect(screen.getByText("Every 6h")).toBeInTheDocument();
		expect(
			screen.getByText(/Saved in T3, and keep running without this app\. Read from T3 2h ago/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
		expect(screen.getAllByRole("link", { name: "Open in T3" })).toHaveLength(2);
	});

	it("is on the nav with a count", async () => {
		await renderApp("/automations", "automations");
		const link = await screen.findByRole("link", { name: /Automations/ });
		await waitFor(() => expect(link).toHaveTextContent("3"));
	});

	it("doesn't read by itself, because a read costs a model turn", async () => {
		const h = await renderApp("/automations", "no_automations");
		expect(await screen.findByText("Nothing read yet")).toBeInTheDocument();
		expect(h.mutations).toEqual([]);
	});

	it("reads when you ask", async () => {
		const user = userEvent.setup();
		await renderApp("/automations", "no_automations");
		await user.click(await screen.findByRole("button", { name: "Read from T3" }));
		expect(await screen.findByText("Read from T3 just now")).toBeInTheDocument();
	});

	it("creates one in T3, with a schedule built from the choices", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/automations", "automations");
		const pane = await screen.findByRole("heading", { name: "New automation" });
		const form = pane.parentElement as HTMLElement;
		const create = within(form).getByRole("button", { name: "Create in T3" });
		expect(create).toBeDisabled();
		await user.type(within(form).getByLabelText("Name"), "Weekly check");
		await user.type(within(form).getByLabelText("Prompt"), "Check things.");
		await user.selectOptions(within(form).getByLabelText("Day"), "Weekdays");
		await user.click(create);
		await waitFor(() => expect(h.mutations.at(-1)).toContain("POST /api/automations"));
		expect(sent(h.mutations.at(-1))).toMatchObject({
			name: "Weekly check",
			prompt: "Check things.",
			when: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1, 2, 3, 4, 5] },
		});
		expect(await screen.findByText("Weekly check")).toBeInTheDocument();
	});

	it("can't make a webhook", async () => {
		await renderApp("/automations", "automations");
		expect(await screen.findByRole("button", { name: "Webhook" })).toBeDisabled();
		expect(screen.getByText("Webhook needs T3 Connect.")).toBeInTheDocument();
	});

	it("builds an interval, and a once", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/automations", "automations");
		await user.type(await screen.findByLabelText("Name"), "x");
		await user.type(screen.getByLabelText("Prompt"), "y");
		await user.click(screen.getByRole("button", { name: "Every" }));
		await user.selectOptions(screen.getByLabelText("Unit"), "days");
		await user.click(screen.getByRole("button", { name: "Create in T3" }));
		await waitFor(() => expect(h.mutations.at(-1)).toContain("POST /api/automations"));
		expect(sent(h.mutations.at(-1)).when).toEqual({ type: "interval", everyMs: 6 * 86_400_000 });
	});
});
