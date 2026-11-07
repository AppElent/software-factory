import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const rowOf = (name: string) => {
	const row = screen.getByRole("link", { name }).closest("tr");
	if (!row) throw new Error(`No row for ${name}`);
	return within(row);
};

describe("Projects", () => {
	it("lists projects, active first, with a sync control only on those behind", async () => {
		await renderApp("/projects", "projects");
		expect(await screen.findByText("8 projects · 4 behind on the toolkit")).toBeInTheDocument();
		const names = screen.getAllByRole("rowheader").map((h) => within(h).getByRole("link").textContent);
		expect(names.indexOf("Fairway")).toBeLessThan(names.indexOf("roadmaps"));
		expect(rowOf("Fairway").getByText("Current")).toBeInTheDocument();
		expect(rowOf("Fairway").queryByRole("checkbox")).toBeNull();
		expect(rowOf("developer-tools").getByText("Source")).toBeInTheDocument();
		expect(rowOf("developer-tools").queryByRole("button", { name: /Sync/ })).toBeNull();
		expect(rowOf("Arcade Club").getByRole("checkbox", { name: "Select Arcade Club" })).toBeInTheDocument();
		expect(rowOf("Arcade Club").getByText("4 days behind")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "New project" })).toHaveAttribute(
			"href",
			"/projects/new/describe",
		);
		// No Sentry reads as a dash, not zero.
		expect(rowOf("roadmaps").getAllByText("–").length).toBeGreaterThan(0);
	});

	it("selects those behind, moves the primary to the bar, and clears", async () => {
		const user = userEvent.setup();
		await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("button", { name: "Select 4 behind" }));
		const bar = screen.getByRole("region", { name: "Bulk actions" });
		expect(within(bar).getByRole("status")).toHaveTextContent("4 selected");
		expect(within(bar).getByRole("button", { name: "Sync 4 projects" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Select 4 behind" })).toBeNull();
		await user.click(within(bar).getByRole("button", { name: "Clear" }));
		expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
	});

	it("confirms the sync with each drift, starts on Cancel, and returns focus on Escape", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("button", { name: "Select 4 behind" }));
		const opener = screen.getByRole("button", { name: "Sync 4 projects" });
		opener.focus();
		await user.keyboard("{Enter}");
		const dialog = await screen.findByRole("alertdialog", { name: "Start 4 sync work orders?" });
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		expect(within(dialog).getByText("41 days behind")).toBeInTheDocument();
		expect(within(dialog).getByText(/Each runs on its own worktree/)).toBeInTheDocument();
		expect(within(dialog).getByText(/in Intake\./)).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await waitFor(() => expect(opener).toHaveFocus());
		expect(h.mutations).toEqual([]);
	});

	it("starts them, and reports the one that couldn't start", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("button", { name: "Select 4 behind" }));
		await user.click(screen.getByRole("button", { name: "Sync 4 projects" }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "Start 4 work orders" }));
		expect(await screen.findByText("3 sync work orders started, labs couldn't start")).toBeInTheDocument();
		expect(h.mutations.at(-1)).toContain("POST /api/projects/sync");
		expect(screen.getByText(/isn't in its folder on this Mac\./)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Fix labs" })).toHaveAttribute("href", "/projects/labs");
		expect(screen.getByRole("link", { name: "See the floor" })).toHaveAttribute("href", "/floor");
		expect(rowOf("Arcade Club").getByRole("link", { name: "Sync started" })).toBeInTheDocument();
		expect(rowOf("labs").getByRole("link", { name: "Folder missing" })).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
	});

	it("syncs one row with no dialog", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("button", { name: "Sync satisfactory" }));
		await waitFor(() =>
			expect(rowOf("satisfactory").getByRole("link", { name: "Sync started" })).toBeInTheDocument(),
		);
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(h.mutations).toEqual(['POST /api/projects/sync {"slugs":["satisfactory"]}']);
	});

	it("shows a failed row sync beside the row, and leaves it idle", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await screen.findByRole("button", { name: "Sync satisfactory" });
		h.failNext("/api/projects/sync", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Sync satisfactory" }));
		expect(await rowOf("satisfactory").findByRole("alert")).toHaveTextContent(
			"Couldn't sync this. Try again.",
		);
		expect(rowOf("satisfactory").getByRole("button", { name: "Sync satisfactory" })).toBeEnabled();
	});

	it("keeps the dialog and the selection when a bulk sync fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("checkbox", { name: "Select Arcade Club" }));
		await user.click(screen.getByRole("button", { name: "Sync 1 project" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Sync Arcade Club?" });
		h.failNext("/api/projects/sync", 500, "That failed.");
		await user.click(within(dialog).getByRole("button", { name: "Start work order" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't start this. Try again.");
		expect(screen.getByRole("checkbox", { name: "Select Arcade Club", hidden: true })).toBeChecked();
	});

	it("shows Sync started after a reload, so nothing starts twice", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects", "projects");
		await user.click(await screen.findByRole("button", { name: "Sync roadmaps" }));
		await waitFor(() =>
			expect(rowOf("roadmaps").getByRole("link", { name: "Sync started" })).toBeInTheDocument(),
		);
		await h.router.navigate({ to: "/health" });
		await h.router.navigate({ to: "/projects" });
		await waitFor(() =>
			expect(rowOf("roadmaps").getByRole("link", { name: "Sync started" })).toBeInTheDocument(),
		);
	});

	it("doesn't render loading as empty, and says when the list failed", async () => {
		const h = await renderApp("/health", "projects");
		await screen.findByRole("heading", { name: "Health" });
		h.failNext("/api/projects", 500, "That failed.");
		await h.router.navigate({ to: "/projects" });
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load");
	});

	it("is reached with g then o", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/health", "projects");
		await screen.findByRole("heading", { name: "Health" });
		await user.keyboard("go");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/projects"));
	});
});

describe("Project page", () => {
	it("shows an active project: open lists, record, and one primary", async () => {
		await renderApp("/projects/fairway", "projects");
		expect(await screen.findByRole("heading", { name: "Fairway" })).toBeInTheDocument();
		expect(screen.getByText(/need you$|needs you$/)).toBeInTheDocument();
		expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Fairway");
		expect(screen.getByRole("region", { name: /^Work orders · \d+$/ })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: /^Errors · 1$/ })).toBeInTheDocument();
		expect(screen.getByText("Plan · waiting on you")).toBeInTheDocument();
		expect(screen.getByText("New · 14 users")).toBeInTheDocument();
		const pane = screen.getByRole("complementary", { name: "Details" });
		expect(within(pane).getByText("example-org/fairway")).toBeInTheDocument();
		expect(within(pane).getByText("Last 30 days")).toBeInTheDocument();
		expect(within(pane).getByText("Median to PR")).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/Cost|\$\d/);
		const main = screen.getByRole("main");
		expect(within(main).getByRole("button", { name: "Start work order" }).className).toContain(
			"bg-accent-solid",
		);
		expect(within(main).getByRole("link", { name: "Open in T3" })).toHaveAttribute(
			"href",
			"https://t3.example/thread",
		);
	});

	it("shows a quiet project with its toolkit banner and Sentry prompt", async () => {
		await renderApp("/projects/roadmaps", "projects");
		expect(await screen.findByText("Nothing open")).toBeInTheDocument();
		expect(screen.getByText("69 days behind on the toolkit")).toBeInTheDocument();
		expect(
			screen.getByText("14 standards changed in developer-tools since the last sync."),
		).toBeInTheDocument();
		expect(screen.getAllByText("None open.")).toHaveLength(2);
		expect(screen.getByText("Sentry isn't connected, so errors can't show here.")).toBeInTheDocument();
		expect(screen.getByText("Nothing shipped through the factory yet.")).toBeInTheDocument();
		expect(screen.queryByText("Last 30 days")).toBeNull();
		expect(screen.queryByRole("link", { name: "Open in T3" })).toBeNull();
		const primary = screen.getByRole("button", { name: "Start sync work order" });
		expect(primary.className).toContain("bg-accent-solid");
		expect(screen.getByRole("button", { name: "Start work order" }).className).not.toContain(
			"bg-accent-solid",
		);
	});

	it("starts a sync from the banner and goes to the floor", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/roadmaps", "projects");
		await user.click(await screen.findByRole("button", { name: "Start sync work order" }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/floor"));
		expect(h.mutations).toEqual(['POST /api/projects/sync {"slugs":["roadmaps"]}']);
	});

	it("pauses, then resumes", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "projects");
		await user.click(await screen.findByRole("button", { name: "Pause project" }));
		expect(await screen.findByText("Paused")).toBeInTheDocument();
		expect(
			screen.getByText("New work orders for this project wait in Intake. Work already running finishes."),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Pause project" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Resume" }));
		await waitFor(() => expect(screen.queryByText("Paused")).toBeNull());
		expect(h.mutations).toEqual([
			"POST /api/projects/fairway/pause {}",
			"POST /api/projects/fairway/resume {}",
		]);
	});

	it("opens paused from the seed, with the failure beside Resume", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/roadmaps", "missing_folder");
		expect(await screen.findByText("Paused")).toBeInTheDocument();
		h.failNext("/resume", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Resume" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't resume this. Try again.");
		expect(screen.getByText("Paused")).toBeInTheDocument();
	});

	it("saves the merging choice per project", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "projects");
		const ask = await screen.findByRole("radio", { name: "Always ask me" });
		expect(screen.getByRole("radio", { name: /Follow/ })).toBeChecked();
		await user.click(ask);
		await waitFor(() =>
			expect(h.mutations).toEqual(['POST /api/projects/fairway/merging {"merging":"ask"}']),
		);
		expect(await screen.findByText("Saved")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Always ask me" })).toBeChecked();
	});

	it("puts the merging choice back when it can't save", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "projects");
		const ask = await screen.findByRole("radio", { name: "Always ask me" });
		h.failNext("/merging", 500, "That failed.");
		await user.click(ask);
		expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save this. Try again.");
		expect(screen.getByRole("radio", { name: /Follow/ })).toBeChecked();
	});

	it("won't remove a project with open work: offers its work orders and a pause", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "projects");
		const opener = await screen.findByRole("button", { name: "Remove from factory" });
		await user.click(opener);
		const dialog = await screen.findByRole("alertdialog", { name: "Fairway can't be removed yet" });
		expect(
			within(dialog).getByText(/open work orders\. Close them first, or pause the project/),
		).toBeInTheDocument();
		expect(within(dialog).getByRole("link", { name: "See work orders" })).toHaveAttribute(
			"href",
			"/floor?project=fairway",
		);
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		await user.click(within(dialog).getByRole("button", { name: "Pause project" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(await screen.findByText("Paused")).toBeInTheDocument();
		expect(h.mutations).toEqual(["POST /api/projects/fairway/pause {}"]);
	});

	it("removes a quiet project and goes back to the list", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/roadmaps", "projects");
		await user.click(await screen.findByRole("button", { name: "Remove from factory" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Remove roadmaps from the factory?" });
		expect(
			within(dialog).getByText(
				"The factory stops watching it. Your GitHub repo, local folder, and services stay as they are. You can add it back from Settings.",
			),
		).toBeInTheDocument();
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		await user.click(within(dialog).getByRole("button", { name: "Remove project" }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/projects"));
		expect(h.mutations).toEqual(["POST /api/projects/roadmaps/remove {}"]);
		expect(await screen.findByRole("link", { name: "Fairway" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "roadmaps" })).toBeNull();
	});

	it("shows why a removal failed, in the dialog", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/roadmaps", "projects");
		await user.click(await screen.findByRole("button", { name: "Remove from factory" }));
		const dialog = await screen.findByRole("alertdialog");
		h.failNext("/remove", 502, "gh lacks delete rights.");
		await user.click(within(dialog).getByRole("button", { name: "Remove project" }));
		const alert = await within(dialog).findByRole("alert");
		expect(alert).toHaveTextContent("Couldn't remove this. Try again.");
		expect(alert).toHaveTextContent("gh lacks delete rights.");
	});

	it("won't remove the only project", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "quiet");
		await h.router.navigate({ to: "/projects/$slug", params: { slug: "foundry" } });
		await user.click(await screen.findByRole("button", { name: "Remove from factory" }));
		const first = await screen.findByRole("alertdialog", { name: "Remove Foundry from the factory?" });
		await user.click(within(first).getByRole("button", { name: "Remove project" }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/projects"));
		await h.router.navigate({ to: "/projects/$slug", params: { slug: "fairway" } });
		await user.click(await screen.findByRole("button", { name: "Remove from factory" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Fairway is your only project." });
		expect(within(dialog).getByText("Add a project first.")).toBeInTheDocument();
		expect(within(dialog).queryByRole("button", { name: "Remove project" })).toBeNull();
	});

	it("explains a missing folder, clones it back, and offers the sync", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/labs", "projects");
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("labs isn't in its folder");
		expect(alert).toHaveTextContent("Agents work from this copy, so nothing can start until it is back.");
		expect(screen.getByText("Work orders can't start")).toBeInTheDocument();
		expect(screen.getByText("Sentry isn't connected.")).toBeInTheDocument();
		expect(screen.queryByRole("region", { name: "Shipped recently" })).toBeNull();
		expect(screen.getByRole("button", { name: "Start work order" }).className).not.toContain(
			"bg-accent-solid",
		);
		await user.click(within(alert).getByRole("button", { name: "Clone it again" }));
		expect(await screen.findByText("labs is back")).toBeInTheDocument();
		expect(screen.getByText(/^Now cloned to .*\. You can start work orders again\.$/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Start sync work order" })).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(h.mutations).toEqual(["POST /api/projects/labs/clone {}"]);
	});

	it("shows Cloning while it runs, and a failed clone stays honest", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/labs", "projects");
		await screen.findByRole("alert");
		h.failNext("/clone", 502, "fatal: could not read from remote");
		await user.click(screen.getByRole("button", { name: "Clone it again" }));
		await waitFor(() =>
			expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Couldn't clone this. Try again."),
		);
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("fatal: could not read from remote");
		expect(screen.getByText("labs isn't in its folder")).toBeInTheDocument();
	});

	it("changes the folder, keeping what was typed when it isn't a checkout", async () => {
		const user = userEvent.setup();
		await renderApp("/projects/labs", "projects");
		await user.click(await screen.findByRole("button", { name: "Change folder" }));
		const dialog = await screen.findByRole("dialog", { name: "Change folder" });
		const field = within(dialog).getByLabelText("Folder");
		await user.clear(field);
		await user.click(within(dialog).getByRole("button", { name: "Use this folder" }));
		expect(within(dialog).getByText("Enter the folder.")).toBeInTheDocument();
		expect(field).toHaveFocus();

		await user.type(field, "/tmp");
		await user.click(within(dialog).getByRole("button", { name: "Use this folder" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("That folder isn't a git checkout.");
		expect(field).toHaveValue("/tmp");

		const checkout = mkdtempSync(join(tmpdir(), "sf-checkout-"));
		mkdirSync(join(checkout, ".git"));
		await user.clear(field);
		await user.type(field, checkout);
		await user.click(within(dialog).getByRole("button", { name: "Use this folder" }));
		expect(await screen.findByText("labs is back")).toBeInTheDocument();
		expect(screen.getByText(/^Now using .*\. You can start work orders again\.$/)).toBeInTheDocument();
		rmSync(checkout, { recursive: true, force: true });
	});

	it("connects Sentry from the Errors section, and returns focus when cancelled", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/roadmaps", "projects");
		await screen.findByText("Sentry isn't connected, so errors can't show here.");
		const buttons = screen.getAllByRole("button", { name: "Connect Sentry" });
		expect(buttons).toHaveLength(2);
		const opener = buttons[0] as HTMLElement;
		opener.focus();
		await user.keyboard("{Enter}");
		let dialog = await screen.findByRole("dialog", { name: "Connect Sentry" });
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(opener).toHaveFocus());

		await user.click(opener);
		dialog = await screen.findByRole("dialog", { name: "Connect Sentry" });
		await user.click(within(dialog).getByRole("button", { name: "Connect" }));
		expect(within(dialog).getByText("Enter the Sentry project.")).toBeInTheDocument();
		await user.type(within(dialog).getByLabelText("Sentry project"), "roadmaps-web");
		h.failNext("/connect", 500, "That failed.");
		await user.click(within(dialog).getByRole("button", { name: "Connect" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't connect this. Try again.");
		expect(within(dialog).getByLabelText("Sentry project")).toHaveValue("roadmaps-web");
		await user.click(within(dialog).getByRole("button", { name: "Connect" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(h.mutations.at(-1)).toBe('POST /api/projects/roadmaps/connect {"sentryProject":"roadmaps-web"}');
		const pane = screen.getByRole("complementary", { name: "Details" });
		expect(await within(pane).findByText("roadmaps-web")).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByText("None open.")).toHaveLength(3));
	});

	it("opens the new work order for this project", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/projects/fairway", "projects");
		await user.click(await screen.findByRole("button", { name: "Start work order" }));
		const dialog = await screen.findByRole("dialog", { name: "New work order" });
		expect(within(dialog).getByRole("combobox")).toHaveValue("fairway");
		expect(h.router.state.location.pathname).toBe("/projects/fairway");
	});

	it("wraps long names, paths, and branches rather than overflowing", async () => {
		await renderApp("/projects/fairway", "project_long");
		const title = "Fairway Scorecards for Weekend Golf Societies and Long Tournaments";
		expect(await screen.findByRole("heading", { name: title })).toHaveClass("[overflow-wrap:anywhere]");
		expect(screen.getByText("release/2026-11-spring-season-scorecard-migration")).toBeInTheDocument();
		expect(screen.getByText(/^Fix TypeError: Cannot read properties of undefined/)).toHaveClass(
			"[overflow-wrap:anywhere]",
		);
	});

	it("treats titles as text, never as HTML", async () => {
		await renderApp("/projects/fairway", "project_long");
		await screen.findByRole("region", { name: /^Work orders/ });
		expect(document.querySelector("main script, aside script")).toBeNull();
	});

	it("says when the project isn't in the factory", async () => {
		await renderApp("/projects/nope", "projects");
		expect(await screen.findByRole("alert")).toHaveTextContent("That project isn't in the factory.");
		expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
	});
});
