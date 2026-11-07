import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const sent = (m: string | undefined): Record<string, unknown> =>
	JSON.parse((m ?? "").replace(/^\S+ \S+ /, ""));

describe("Improve yourself", () => {
	it("is on the nav, and says what it works on", async () => {
		await renderApp("/improve", "version_ready");
		expect(await screen.findByRole("heading", { name: "Improve yourself" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Improve yourself" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByText(/own repo, me\/software-factory/)).toBeInTheDocument();
		expect(screen.getByText(/checked for your private names/)).toBeInTheDocument();
		expect(screen.getByText(/security files always wait for you/)).toBeInTheDocument();
	});

	it("needs text before it can start", async () => {
		const user = userEvent.setup();
		await renderApp("/improve", "quiet");
		const start = await screen.findByRole("button", { name: "Start work order" });
		expect(start).toBeDisabled();
		await user.type(screen.getByLabelText("What should change?"), "Filter issues");
		expect(start).toBeEnabled();
	});

	it("starts a work order and opens it", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "quiet");
		await user.click(await screen.findByRole("radio", { name: "Bug" }));
		await user.type(screen.getByLabelText("What should change?"), "The Close button reports twice");
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		await waitFor(() => expect(h.mutations.some((m) => m.startsWith("POST /api/improve {"))).toBe(true));
		const body = sent(h.mutations.find((m) => m.startsWith("POST /api/improve {")));
		expect(body).toMatchObject({ type: "Bug", text: "The Close button reports twice", confirmed: false });
		expect(
			await screen.findByRole("heading", { name: /The Close button reports twice/ }),
		).toBeInTheDocument();
	});

	it("shows private names first, and sends nothing until you decide", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "quiet");
		const home = process.env.HOME ?? "";
		await user.type(await screen.findByLabelText("What should change?"), `Broken at ${home}/x`);
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText(/This repo is public/)).toBeInTheDocument();
		expect(within(dialog).getByText(new RegExp(home))).toBeInTheDocument();
		expect(h.mutations.some((m) => m.startsWith("POST /api/improve {"))).toBe(false);
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(h.mutations.some((m) => m.startsWith("POST /api/improve {"))).toBe(false);
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		await user.click(await screen.findByRole("button", { name: "Start anyway" }));
		await waitFor(() =>
			expect(sent(h.mutations.find((m) => m.startsWith("POST /api/improve {")))).toMatchObject({
				confirmed: true,
			}),
		);
	});

	it("asks before a mode that merges by itself", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "quiet");
		await user.type(await screen.findByLabelText("What should change?"), "Filter issues");
		await user.selectOptions(screen.getByLabelText("Mode"), "Full send");
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		expect(await screen.findByRole("alertdialog")).toHaveTextContent(/merges this as soon as its gates pass/);
		expect(h.mutations.some((m) => m.startsWith("POST /api/improve {"))).toBe(false);
	});

	it("copies a command without starting anything", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "quiet");
		await user.type(await screen.findByLabelText("What should change?"), "Filter issues");
		await user.click(screen.getByRole("button", { name: "Copy as command" }));
		await waitFor(() =>
			expect(h.mutations.some((m) => m.startsWith("POST /api/improve/command"))).toBe(true),
		);
		expect(h.mutations.some((m) => m.startsWith("POST /api/improve {"))).toBe(false);
	});

	it("shows a ready version with the one filled action, and how it goes back", async () => {
		await renderApp("/improve", "version_ready");
		const update = await screen.findByRole("button", { name: "Update to c3d4e5f" });
		expect(update).toBeInTheDocument();
		expect(screen.getByText(/passed its smoke test/)).toBeInTheDocument();
		expect(screen.getByText(/goes back to b2c3d4e on its own/)).toBeInTheDocument();
		expect(screen.getByText(/Running now/)).toBeInTheDocument();
	});

	it("updates when you say so", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "version_ready");
		await user.click(await screen.findByRole("button", { name: "Update to c3d4e5f" }));
		await waitFor(() =>
			expect(sent(h.mutations.find((m) => m.startsWith("POST /api/versions/activate")))).toMatchObject({
				sha: expect.stringMatching(/^c3d4e5f/),
			}),
		);
	});

	it("rolling back asks first", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/improve", "quiet");
		await user.click(await screen.findByRole("button", { name: "Roll back" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog).toHaveTextContent(/Roll back to a1b2c3d/);
		expect(h.mutations.some((m) => m.includes("activate"))).toBe(false);
		await user.click(within(dialog).getByRole("button", { name: "Roll back" }));
		await waitFor(() => expect(h.mutations.some((m) => m.includes("activate"))).toBe(true));
	});

	it("says why a version failed, and offers no update", async () => {
		await renderApp("/improve", "version_failed");
		expect(await screen.findByText("Build failed. tsc found 2 errors.")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Update to/ })).toBeNull();
	});
});
