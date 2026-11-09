import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const sent = (mutation: string | undefined): unknown => JSON.parse((mutation ?? "").replace(/^\S+ \S+ /, ""));
const column = (name: string) => screen.findByRole("region", { name });
const FLEET = "/environments";
const PROJECT = "/projects/fairway/environments";

describe("Environments fleet", () => {
	it("shows the matrix, and opens the one that's down", async () => {
		await renderApp(FLEET, "environments");
		await screen.findByRole("heading", { name: "Foundry, production" });
		expect(screen.getByRole("columnheader", { name: "Production" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Foundry Production: Down/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByText(/1 down, .* behind main, checked/)).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Fix with Standard" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Deploy again" })).toBeInTheDocument();
	});

	it("is on the nav with the down count", async () => {
		await renderApp(FLEET, "environments");
		const link = await screen.findByRole("link", { name: /Environments/ });
		await waitFor(() => expect(link).toHaveTextContent("1"));
	});

	it("offers to add what a project doesn't have", async () => {
		await renderApp(FLEET, "environments");
		await screen.findByRole("heading", { name: "Foundry, production" });
		expect(screen.getByRole("link", { name: /Not set up/ })).toHaveAttribute(
			"href",
			expect.stringContaining("/projects/gather/environments"),
		);
		expect(screen.getByText("No health URL")).toBeInTheDocument();
	});

	it("says what to do with none set up", async () => {
		await renderApp(FLEET, "no_environments");
		expect(await screen.findByRole("heading", { name: "No environments yet" })).toBeInTheDocument();
	});

	it("starts a fix from the pane, tied to that environment", async () => {
		const user = userEvent.setup();
		const h = await renderApp(FLEET, "environments");
		await user.click(await screen.findByRole("button", { name: "Fix with Standard" }));
		await waitFor(() => expect(h.mutations.at(-1)).toContain("POST /api/work-orders"));
		expect(sent(h.mutations.at(-1))).toMatchObject({
			source: { kind: "environment", fingerprint: "env:foundry:Production" },
		});
	});
});

describe("A project's environments", () => {
	it("shows a column for each, with its command", async () => {
		await renderApp(PROJECT, "environments");
		const prod = await column("Production");
		expect(within(prod).getByText(/3 behind main/)).toBeInTheDocument();
		expect(within(prod).getByText("pnpm deploy:production")).toBeInTheDocument();
		expect(within(prod).getByRole("button", { name: "Deploy" })).toBeInTheDocument();
	});

	it("shows a running deploy's log and a way to stop it", async () => {
		await renderApp(PROJECT, "environments");
		const staging = await column("Staging");
		expect(within(staging).getByLabelText("Deploy log")).toHaveTextContent("Uploading 41 files");
		expect(within(staging).getByRole("button", { name: "Stop deploy" })).toBeInTheDocument();
		expect(within(staging).queryByRole("button", { name: /^Deploy/ })).not.toBeInTheDocument();
	});

	it("says why the last deploy failed", async () => {
		await renderApp(PROJECT, "environments");
		const preview = await column("Preview");
		expect(within(preview).getByText(/The last deploy failed with exit code 2/)).toBeInTheDocument();
		expect(within(preview).getByLabelText("Deploy log")).toHaveTextContent("Cannot find module");
	});

	it("asks before deploying to production, and shows the command", async () => {
		const user = userEvent.setup();
		const h = await renderApp(PROJECT, "environments");
		const prod = await column("Production");
		await user.click(within(prod).getByRole("button", { name: "Deploy" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(h.mutations).toEqual([]);
		expect(within(dialog).getByText("pnpm deploy:production")).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", { name: "Deploy" }));
		await waitFor(() => expect(h.mutations.at(-1)).toContain("POST /api/environments/deploy"));
		expect(sent(h.mutations.at(-1))).toEqual({ project: "fairway", env: "Production", confirmed: true });
	});

	it("doesn't ask for an environment that isn't production", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/foundry/environments", "environments");
		const preview = await column("Preview");
		await user.click(within(preview).getByRole("button", { name: "Deploy" }));
		await waitFor(() => expect(h.mutations.at(-1)).toContain("POST /api/environments/deploy"));
		expect(sent(h.mutations.at(-1))).toMatchObject({ env: "Preview", confirmed: false });
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});

	it("lists deploy history", async () => {
		await renderApp(PROJECT, "environments");
		const history = await screen.findByRole("region", { name: "Deploy history" });
		expect(within(history).getByText("Fix the handicap rounding")).toBeInTheDocument();
		expect(within(history).getByText("Failed")).toBeInTheDocument();
	});

	it("saves an edit to the config, and shows where", async () => {
		const user = userEvent.setup();
		const h = await renderApp(PROJECT, "environments");
		await user.click(await screen.findByRole("button", { name: "Edit environments" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText(/config/)).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", { name: "Add environment" }));
		await user.type(within(dialog).getAllByLabelText("Deploy command").at(-1) as HTMLElement, "ship");
		expect(within(dialog).getByRole("button", { name: "Save environments" })).toBeDisabled();
		expect(within(dialog).getByText("Give each environment a name to save.")).toBeInTheDocument();
		await user.clear(within(dialog).getAllByLabelText("Deploy command").at(-1) as HTMLElement);
		await user.click(
			within(dialog)
				.getAllByRole("button", { name: /^Remove/ })
				.at(-1) as HTMLElement,
		);
		await user.click(within(dialog).getByRole("button", { name: "Add environment" }));
		const names = within(dialog).getAllByLabelText("Name");
		await user.type(names.at(-1) as HTMLElement, "QA");
		await user.click(within(dialog).getByRole("button", { name: "Save environments" }));
		await waitFor(() => expect(h.mutations.at(-1)).toContain("PUT /api/projects/fairway/environments"));
		const saved = (sent(h.mutations.at(-1)) as { environments: Array<{ name: string }> }).environments;
		expect(saved.map((e) => e.name)).toEqual(["Preview", "Staging", "Production", "QA"]);
	});

	it("adds a suggestion only when you say so", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway/environments?edit=true", "no_environments");
		const dialog = await screen.findByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "Look in the repo" }));
		await waitFor(() => expect(within(dialog).getByText(/Nothing new found/)).toBeInTheDocument());
		expect(h.mutations).toEqual([]);
	});

	it("has tabs between the overview and environments", async () => {
		await renderApp(PROJECT, "environments");
		const nav = await screen.findByRole("navigation", { name: "Project" });
		expect(within(nav).getByRole("link", { name: "Environments" })).toHaveAttribute("aria-current", "page");
		expect(within(nav).getByRole("link", { name: "Overview" })).toBeInTheDocument();
	});
});

describe("The queue", () => {
	it("puts a down production on top, with a fix and a deploy", async () => {
		await renderApp("/", "environments");
		await screen.findByRole("heading", { name: "Production is down" });
		expect(screen.getByRole("button", { name: "Deploy again" })).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Fix with Standard" })).toBeInTheDocument();
	});
});
