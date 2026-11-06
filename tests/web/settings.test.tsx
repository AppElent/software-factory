import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { connection } from "../../src/web/api.ts";
import { renderApp, waitFor } from "./harness.tsx";

afterEach(() => connection.setOffline(false));

const saved = () => waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

describe("Settings: navigation", () => {
	it("marks the current section and moves between them", async () => {
		const user = userEvent.setup();
		await renderApp("/settings/agents");
		const nav = await screen.findByRole("navigation", { name: "Settings sections" });
		expect(within(nav).getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
		await user.click(within(nav).getByRole("link", { name: "Tools" }));
		expect(await screen.findByRole("heading", { name: "Tools" })).toBeInTheDocument();
		expect(within(nav).getByRole("link", { name: "Tools" })).toHaveAttribute("aria-current", "page");
	});

	it("sends an unknown section to Agents and this-mac to Tools", async () => {
		const h = await renderApp("/settings/nope");
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/settings/agents"));
		const other = await renderApp("/settings/this-mac");
		await waitFor(() => expect(other.router.state.location.pathname).toBe("/settings/tools"));
	});
});

describe("SettingsAgents", () => {
	it("says so when settings can't load", async () => {
		const h = await renderApp("/floor");
		await screen.findByRole("navigation", { name: "Main" });
		h.failNext("/api/settings", 500, "That failed.");
		await h.router.navigate({ to: "/settings/$section", params: { section: "agents" } });
		expect(await screen.findByRole("alert")).toHaveTextContent(/settings/);
	});

	it("shows the defaults", async () => {
		await renderApp("/settings/agents");
		expect(await screen.findByLabelText(/Agents at once/)).toHaveValue("3");
		expect(screen.getByRole("checkbox", { name: /Pause new work when Review is full/ })).not.toBeChecked();
		expect(screen.getByLabelText(/Automatic retries/)).toHaveValue("1");
		expect(screen.getByLabelText(/^Agent\b/)).toHaveValue("claude");
		expect(screen.queryByText(/spend/i)).not.toBeInTheDocument();
	});

	it("saves a change and says so", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/agents");
		await user.click(await screen.findByRole("checkbox", { name: /Pause new work/ }));
		await waitFor(() =>
			expect(h.mutations.join()).toContain('PUT /api/settings/agents {"agentsAtOnce":3,"pauseOnReview":true'),
		);
		await saved();
	});

	it("refuses a limit outside 1 to 8 without saving", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/agents");
		const limit = await screen.findByLabelText(/Agents at once/);
		await user.clear(limit);
		await user.type(limit, "9");
		await user.tab();
		expect(await screen.findByText("Enter a whole number from 1 to 8.")).toBeInTheDocument();
		expect(h.mutations.filter((m) => m.includes("settings/agents"))).toEqual([]);
	});

	it("keeps the choice and shows the error beside it when a save fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/agents");
		const select = await screen.findByLabelText(/^Agent\b/);
		h.failNext("/api/settings/agents", 500, "That failed.");
		await user.selectOptions(select, "codex");
		expect(await screen.findByText("Couldn't save this. Try again.")).toBeInTheDocument();
		expect(select).toHaveValue("codex");
	});

	it("is reachable by keyboard", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/agents");
		const box = await screen.findByRole("checkbox", { name: /Pause new work/ });
		box.focus();
		await user.keyboard(" ");
		await waitFor(() => expect(h.mutations.join()).toContain("settings/agents"));
		expect(box).toHaveFocus();
	});
});

describe("SettingsApprovals", () => {
	it("shows merging off by default and what each type still needs", async () => {
		await renderApp("/settings/approvals", "first_look");
		const table = await screen.findByRole("table");
		const row = within(table).getByRole("row", { name: /Bug fix/ });
		expect(within(row).getByText("You merge")).toBeInTheDocument();
		expect(within(row).getByText("Needs 10 more runs.")).toBeInTheDocument();
		expect(within(row).getByText("0 of 0")).toBeInTheDocument();
		expect(screen.queryByText("Merges without you")).not.toBeInTheDocument();
	});

	it("turns on from the dialog, focus on Cancel, and moves focus to Turn off", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/approvals", "merge_ready");
		const row = await screen.findByRole("row", { name: /Toolkit sync/ });
		expect(within(row).getByText("You merge. Qualifies.")).toBeInTheDocument();
		await user.click(within(row).getByRole("button", { name: "Merge without me" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Let toolkit syncs merge without you?" });
		await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
		await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
		await waitFor(() =>
			expect(h.mutations.join()).toMatch(/PUT \/api\/settings\/approvals .*"Toolkit sync":true/),
		);
		const off = await within(row).findByRole("button", { name: "Turn off" });
		await waitFor(() => expect(off).toHaveFocus());
		expect(within(row).getByText("Merges without you")).toBeInTheDocument();
	});

	it("returns focus to the opener when the dialog is cancelled", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/approvals", "merge_ready");
		const row = await screen.findByRole("row", { name: /Toolkit sync/ });
		const open = within(row).getByRole("button", { name: "Merge without me" });
		await user.click(open);
		await screen.findByRole("alertdialog");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(open).toHaveFocus());
		expect(h.mutations).toEqual([]);
	});

	it("keeps the dialog open with the error when turning on fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/approvals", "merge_ready");
		const row = await screen.findByRole("row", { name: /Toolkit sync/ });
		await user.click(within(row).getByRole("button", { name: "Merge without me" }));
		const dialog = await screen.findByRole("alertdialog");
		h.failNext("/api/settings/approvals", 500, "That failed.");
		await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't save this. Try again.");
		expect(within(row).queryByText("Merges without you")).not.toBeInTheDocument();
	});

	it("shows a type merging alone, one a regression turned off, and a project that always asks", async () => {
		await renderApp("/settings/approvals", "approvals_regressed");
		const sync = await screen.findByRole("row", { name: /Toolkit sync/ });
		expect(within(sync).getByText("Merges without you")).toBeInTheDocument();
		const bug = screen.getByRole("row", { name: /Bug fix/ });
		expect(within(bug).getByText("A regression turned this off.")).toBeInTheDocument();
		const asks = screen.getByRole("region", { name: "Projects that always ask you" });
		expect(await within(asks).findByRole("link", { name: "labs" })).toBeInTheDocument();
	});

	it("says none when no project always asks", async () => {
		await renderApp("/settings/approvals", "merge_ready");
		const asks = await screen.findByRole("region", { name: "Projects that always ask you" });
		expect(within(asks).getByText(/None\. Set this on a/)).toBeInTheDocument();
	});

	it("checks the thresholds and saves a plan review change", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/approvals");
		const runs = await screen.findByLabelText("Finished runs, at least");
		expect(runs).toHaveValue("10");
		await user.clear(runs);
		await user.type(runs, "2");
		await user.tab();
		expect(await screen.findByText("Enter 5 or more.")).toBeInTheDocument();
		const pct = screen.getByLabelText("First try, at least (%)");
		await user.clear(pct);
		await user.type(pct, "40");
		await user.tab();
		expect(await screen.findByText("Enter 50 to 100.")).toBeInTheDocument();
		await user.selectOptions(screen.getByLabelText("Plan review for Chore"), "always");
		await waitFor(() => expect(h.mutations.join()).toContain('"Chore":"always"'));
	});

	it("has no cost row", async () => {
		await renderApp("/settings/approvals");
		await screen.findByRole("table");
		expect(screen.queryByText(/cost|spend|\$/i)).not.toBeInTheDocument();
	});
});

describe("SettingsNotifications", () => {
	it("makes no claim about macOS until a test is sent, then says what to check", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/notifications");
		const send = await screen.findByRole("button", { name: "Send a test" });
		expect(screen.queryByText(/notifications are on/i)).not.toBeInTheDocument();
		await user.click(send);
		await waitFor(() => expect(h.mutations).toContain("POST /api/notifications/test {}"));
		expect(
			await screen.findByText("Sent. Nothing showed? Check Focus and System Settings."),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Open System Settings/ })).toBeInTheDocument();
	});

	it("saves an event toggle and links to the samples", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/notifications");
		await user.click(await screen.findByRole("checkbox", { name: /All agent slots are full/ }));
		await waitFor(() => expect(h.mutations.join()).toContain("PUT /api/settings/notifications"));
		await saved();
		expect(screen.getByRole("link", { name: "See how they read" })).toBeInTheDocument();
	});

	it("shows the error when the test can't be requested", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/notifications");
		const send = await screen.findByRole("button", { name: "Send a test" });
		h.failNext("/api/notifications/test", 500, "That failed.");
		await user.click(send);
		expect(await screen.findByText("Couldn't send this. Try again.")).toBeInTheDocument();
	});
});

describe("SettingsNotifyBlocked", () => {
	it("asks for permission after a failed test, and clears once a test goes through", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/notifications", "notify_failed");
		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("The test notification didn't send");
		expect(banner).toHaveTextContent("Allow terminal-notifier in System Settings");
		expect(within(banner).getByRole("link", { name: /Open System Settings/ })).toBeInTheDocument();
		await user.click(within(banner).getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/notifications/test {}"));
		expect(await screen.findByText("Test sent to this Mac")).toBeInTheDocument();
		expect(screen.queryByText("The test notification didn't send")).not.toBeInTheDocument();
	});

	it("gives the install command when terminal-notifier isn't there", async () => {
		await renderApp("/settings/notifications", "notify_missing");
		const banner = await screen.findByRole("alert");
		await within(banner).findByText("brew install terminal-notifier");
		expect(within(banner).queryByRole("link", { name: /Open System Settings/ })).not.toBeInTheDocument();
	});
});

describe("SettingsProjects", () => {
	it("shows the count and lists the rules", async () => {
		await renderApp("/settings/projects");
		expect(await screen.findByText(/of 7 repos are in the factory\./)).toBeInTheDocument();
		expect(screen.getByLabelText(/Clone folder/)).toBeInTheDocument();
		expect(screen.getByText("client-*")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Add projects" })).toBeInTheDocument();
	});

	it("adds a rule, and refuses a blank one", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/projects");
		const add = await screen.findByLabelText("Add a pattern");
		await user.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByText("Enter a repo name or pattern.")).toBeInTheDocument();
		expect(add).toHaveFocus();
		await user.type(add, "labs-*{Enter}");
		await waitFor(() => expect(h.mutations.join()).toContain('"neverTouch":["client-*","labs-*"]'));
		expect(await screen.findByText("labs-*")).toBeInTheDocument();
		expect(add).toHaveValue("");
	});

	it("keeps what was typed when adding a rule fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/projects");
		const add = await screen.findByLabelText("Add a pattern");
		await user.type(add, "labs-*");
		h.failNext("/api/settings/projects", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByText("Couldn't save this. Try again.")).toBeInTheDocument();
		expect(add).toHaveValue("labs-*");
	});

	it("removes a rule with an undo, and moves focus to the field", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/projects");
		await user.click(await screen.findByRole("button", { name: "Remove client-*" }));
		expect(await screen.findByText("Removed client-*.")).toBeInTheDocument();
		expect(h.mutations.join()).toContain('"neverTouch":[]');
		await waitFor(() => expect(screen.getByLabelText("Add a pattern")).toHaveFocus());
		expect(screen.getByText("Nothing is excluded, so the factory can see every repo.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Undo" }));
		expect(await screen.findByRole("button", { name: "Remove client-*" })).toBeInTheDocument();
	});

	it("needs a folder, and saves a new one when the field is left", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/projects");
		const folder = await screen.findByLabelText(/Clone folder/);
		await user.clear(folder);
		await user.tab();
		expect(await screen.findByText("Enter a folder.")).toBeInTheDocument();
		expect(h.mutations).toEqual([]);
		await user.type(folder, "/tmp/elsewhere");
		await user.tab();
		await waitFor(() => expect(h.mutations.join()).toContain('"cloneFolder":"/tmp/elsewhere"'));
		await saved();
	});

	it("adds projects from the shared chooser and never names a skipped repo", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/add-projects", "quiet");
		await user.click(await screen.findByRole("checkbox", { name: "gather" }));
		expect(
			screen.getByText("2 repos match a Never touch rule, so nothing in them was opened."),
		).toBeInTheDocument();
		expect(screen.queryByText(/client-work|client-archive/)).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Add projects" }));
		await waitFor(() => expect(h.mutations.join()).toContain('"repo":"example-org/gather"'));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/projects"));
	});
});

describe("SettingsTools", () => {
	it("lists each tool, with the fix for a signed-out one and no drama for an optional missing one", async () => {
		await renderApp("/settings/tools", "tools_problem");
		expect(await screen.findByText("wrangler")).toBeInTheDocument();
		expect(screen.getByText("Not signed in")).toBeInTheDocument();
		expect(screen.getByText("wrangler login")).toBeInTheDocument();
		expect(screen.getByText("Optional · not installed")).toBeInTheDocument();
		expect(screen.queryByText("brew install infisical")).not.toBeInTheDocument();
	});

	it("checks again", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/tools", "tools_problem");
		await user.click(await screen.findByRole("button", { name: "Check again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/tools/check {}"));
	});

	it("shows the failure beside the control when a check fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/tools", "tools_problem");
		const button = await screen.findByRole("button", { name: "Check again" });
		h.failNext("/api/tools/check", 500, "That failed.");
		await user.click(button);
		expect(await screen.findByText("Couldn't check this. Try again.")).toBeInTheDocument();
	});

	it("shows this Mac, backs up, and goes offline after a restart", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/tools");
		expect(await screen.findByText(/Running at 127\.0\.0\.1:/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Back up data" }));
		expect(await screen.findByText(/Backed up to .*factory-.*\.db\./)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Restart service" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/service/restart {}"));
	});
});

describe("NotifSamples", () => {
	it("shows each sample with where it opens, and opens a real page", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/settings/notifications/samples");
		expect(await screen.findByRole("heading", { name: "How notifications read" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getAllByText("Software Factory").length).toBeGreaterThanOrEqual(11);
		expect(screen.getByText("Opens the question")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByRole("link", { name: /agent asks a question/ }).getAttribute("href")).toMatch(
				/^\/work-orders\/\d+/,
			),
		);
		await user.click(screen.getByRole("link", { name: /3 PRs ready to merge/ }));
		await waitFor(() => expect(h.router.state.location.pathname).toBe("/prs"));
	});

	it("falls back to a list when there is no matching item", async () => {
		await renderApp("/settings/notifications/samples", "quiet");
		await screen.findByRole("heading", { name: "How notifications read" });
		expect(screen.getByRole("link", { name: /agent asks a question/ })).toHaveAttribute("href", "/floor");
		expect(screen.getByRole("link", { name: /new production error/ })).toHaveAttribute("href", "/errors");
	});
});
