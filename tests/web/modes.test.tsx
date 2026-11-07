import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

async function chooseMode(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
	await user.click(screen.getByRole("button", { name: "Choose a mode" }));
	await user.click(await screen.findByRole("menuitemradio", { name }));
}

describe("modes on the fix button", () => {
	it("starts on the default mode and sends the chosen one", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001", "errors_list");
		await screen.findByRole("button", { name: "Fix with Standard" });
		await chooseMode(user, /Quick fix/);
		await user.click(screen.getByRole("button", { name: "Fix with Quick fix" }));
		await waitFor(() =>
			expect(h.mutations.find((m) => m.startsWith("POST /api/work-orders "))).toContain('"mode":"quick-fix"'),
		);
	});

	it("asks once more before Full send on a production error", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001", "errors_list");
		await screen.findByRole("button", { name: "Fix with Standard" });
		await chooseMode(user, /Full send/);
		await user.click(screen.getByRole("button", { name: "Fix with Full send" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Full send on a production error?" });
		expect(h.mutations.filter((m) => m.startsWith("POST /api/work-orders "))).toEqual([]);
		await user.click(within(dialog).getByRole("button", { name: "Start with Full send" }));
		await waitFor(() => {
			const sent = h.mutations.find((m) => m.startsWith("POST /api/work-orders ")) ?? "";
			expect(sent).toContain('"mode":"full-send"');
			expect(sent).toContain('"confirmed":true');
		});
	});

	it("copies a command that names no app", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/errors/6001", "errors_list");
		await screen.findByRole("button", { name: "Fix with Standard" });
		await user.click(screen.getByRole("button", { name: "Choose a mode" }));
		await user.click(await screen.findByRole("menuitem", { name: "Copy as command" }));
		await waitFor(() =>
			expect(h.mutations.some((m) => m.startsWith("POST /api/work-orders/command"))).toBe(true),
		);
		expect(await screen.findByText("Copied the command. It runs without this app.")).toBeInTheDocument();
		const copied = await navigator.clipboard.readText();
		expect(copied).toMatch(/^t3 thread start /);
		expect(copied).toContain("<<'PROMPT'");
		expect(copied).not.toContain("127.0.0.1");
	});
});

describe("Settings: Modes", () => {
	it("lists the defaults and marks one as default", async () => {
		await renderApp("/settings/modes", "errors_list");
		expect(await screen.findByRole("heading", { name: "Modes" })).toBeInTheDocument();
		const standard = await screen.findByRole("button", { name: /Standard/ });
		expect(standard).toHaveTextContent("default");
		for (const name of ["Quick fix", "Full stop", "Council", "Full send"])
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
	});

	it("saves an edit, and inserts a detected skill", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/modes", "errors_list");
		await user.click(await screen.findByRole("button", { name: "Quick fix" }));
		await user.click(screen.getByRole("button", { name: "Insert sol-loop" }));
		expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("sol loop");
		await user.click(screen.getByRole("button", { name: "Save mode" }));
		await waitFor(() => {
			const put = h.mutations.find((m) => m.startsWith("PUT /api/modes")) ?? "";
			expect(put).toContain('"prompt":"sol loop"');
		});
		expect(await screen.findByText("Saved Quick fix.")).toBeInTheDocument();
	});

	it("won't offer Full send as the default", async () => {
		const user = userEvent.setup();
		await renderApp("/settings/modes", "errors_list");
		await user.click(await screen.findByRole("button", { name: "Full send" }));
		expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Make default" })).toBeNull();
	});

	it("explains a provider with no model", async () => {
		const user = userEvent.setup();
		await renderApp("/settings/modes", "errors_list");
		await user.click(await screen.findByRole("button", { name: "Council" }));
		await user.type(screen.getByRole("textbox", { name: "Provider" }), "codex");
		await user.click(screen.getByRole("button", { name: "Save mode" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("needs a model too");
	});
});

describe("a mode's words", () => {
	it("change with its Plan setting, because the split button shows them", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/modes", "errors_list");
		await user.click(await screen.findByRole("button", { name: /^Standard/ }));
		await user.click(screen.getByRole("radio", { name: "Skip the plan" }));
		await user.click(screen.getByRole("button", { name: "Save mode" }));
		await screen.findByText("Saved Standard.");
		const put = h.mutations.find((m) => m.startsWith("PUT /api/modes")) ?? "";
		const saved = JSON.parse(put.slice(put.indexOf("{"))).modes.find(
			(m: { id: string }) => m.id === "standard",
		);
		expect(saved.plan).toBe("skip");
		expect(saved.description).toBe("Skips the plan. You review and merge.");
	});
});
