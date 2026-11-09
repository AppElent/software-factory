import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("security", () => {
	it("SecurityList: past-deadline projects first, with counts by severity and setup", async () => {
		await renderApp("/security", "security");
		await screen.findByRole("heading", { name: "Security", level: 1 });
		const gather = await screen.findByRole("button", { name: /^Gather/ });
		expect(gather).toHaveTextContent("2 past deadline");
		expect(gather).toHaveTextContent("3 of 4");
		const names = screen
			.getAllByRole("listitem")
			.map((li) => li.textContent ?? "")
			.filter((t) => /^(Gather|Fairway|labs|Foundry)/.test(t))
			.map((t) => t.match(/^(Gather|Fairway|labs|Foundry)/)?.[0]);
		expect(names[0]).toBe("Gather");
		expect(names.at(-1)).toBe("Foundry");
		expect(row("Foundry")).toHaveTextContent("Clear");
		expect(screen.getByText(/Critical alerts turn a project red right away/)).toBeInTheDocument();
	});

	it("SecurityDetail: overdue alerts first, and a work order carries package names, not advisory text", async () => {
		const user = userEvent.setup();
		await renderApp("/security?select=gather", "security");
		const alerts = await screen.findByRole("region", { name: "Alerts" });
		const items = within(alerts).getAllByRole("listitem");
		expect(items[0]).toHaveTextContent("fast-uri");
		expect(items[1]).toHaveTextContent("node-forge");
		expect(items[2]).toHaveTextContent("uuid");
		const setup = screen.getByRole("region", { name: "Setup" });
		expect(within(setup).getByText(/Anyone with push rights/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Fix in a work order" }));
		const dialog = await screen.findByRole("dialog", { name: "New work order" });
		const text = within(dialog).getByRole("textbox", { name: /what/i }) as HTMLTextAreaElement;
		expect(text.value).toContain("fast-uri");
		expect(text.value).toContain("GHSA-demo-5");
		expect(text.value).not.toContain("sample vulnerability");
	});

	it("SecurityTurnOn: asks first, then turns on alerts and security updates", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/security?select=labs", "security");
		await user.click(await screen.findByRole("button", { name: "Turn on alerts and security updates" }));
		const dialog = await screen.findByRole("alertdialog", { name: /Turn on security in/ });
		await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
		await waitFor(() =>
			expect(h.mutations).toContain(
				'POST /api/projects/labs/security/turn-on {"what":["alerts","securityUpdates"]}',
			),
		);
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Turn on alerts and security updates" })).toBeNull(),
		);
	});

	it("narrows to the chosen projects", async () => {
		await renderApp("/security?projects=fairway", "security");
		await screen.findByRole("button", { name: /^Fairway/ });
		expect(screen.queryByRole("button", { name: /^Gather/ })).toBeNull();
	});

	it("SecurityQueue: past-deadline alerts need you, setup gaps wait in Later", async () => {
		const user = userEvent.setup();
		await renderApp("/", "security");
		// The skeleton is labelled Needs you too, so wait for the rows first.
		await screen.findAllByRole("button", { pressed: false });
		const needsYou = screen.getByRole("region", { name: "Needs you" });
		const overdue = within(needsYou).getByRole("button", { name: /2 security alerts past the deadline/ });
		const later = screen.getByRole("region", { name: "Later" });
		expect(within(later).getByRole("button", { name: /Turn on Dependabot alerts/ })).toBeInTheDocument();
		await user.click(overdue);
		await user.click(await screen.findByRole("link", { name: "Open Security" }));
		await screen.findByRole("region", { name: "Alerts" });
	});
});
