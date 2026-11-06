import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, waitFor } from "./harness.tsx";

const path = (h: { router: { state: { location: { pathname: string } } } }) =>
	h.router.state.location.pathname;
const NEW = "/projects/new";

describe("FRTools", () => {
	it("sends a first run here, with the steps and no shell", async () => {
		const h = await renderApp("/", "first_run");
		await waitFor(() => expect(path(h)).toBe("/welcome/tools"));
		expect(await screen.findByRole("heading", { name: "Check your tools" })).toBeInTheDocument();
		expect(screen.getByRole("list", { name: "Steps" })).toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
	});

	it("lets you go on with an optional tool missing or signed out", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/tools", "first_run_tools");
		const go = await screen.findByRole("link", { name: "Continue" });
		expect(screen.getByText("eas login")).toBeInTheDocument();
		expect(screen.getByText("brew install infisical")).toBeInTheDocument();
		expect(
			screen.getByText("You can fix eas and infisical later. They show in Later on the queue."),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/tools/check {}"));
		await user.click(go);
		await waitFor(() => expect(path(h)).toBe("/welcome/repos"));
	});
});

describe("FRToolsBlocked", () => {
	it("stops here until gh is signed in", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/tools", "first_run_blocked");
		await screen.findByText("Sign in to gh to continue.");
		expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
		expect(screen.getByText("gh auth login")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Check again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/tools/check {}"));
	});

	it("names an install when a required tool is missing", async () => {
		await renderApp("/welcome/tools", "first_run_no_t3");
		expect(await screen.findByText("Install t3 to continue.")).toBeInTheDocument();
	});

	it("shows the failure beside the button and keeps the rows", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/tools", "first_run_blocked");
		const again = await screen.findByRole("button", { name: "Check again" });
		h.failNext("/api/tools/check", 500, "That failed.");
		await user.click(again);
		expect(await screen.findByText("Couldn't check this. Try again.")).toBeInTheDocument();
		expect(screen.getByText("gh auth login")).toBeInTheDocument();
	});

	it("uses the design's failed-load path when the tools can't be read", async () => {
		const h = await renderApp("/welcome/repos", "first_run");
		await screen.findByRole("heading", { name: "Choose projects" });
		h.failNext("/api/tools", 500, "That failed.");
		await h.router.navigate({ to: "/welcome/$step", params: { step: "tools" } });
		expect(await screen.findByRole("button", { name: "Check again" })).toBeInTheDocument();
	});
});

describe("FRRepos", () => {
	it("starts with everything off and counts skips without naming them", async () => {
		await renderApp("/welcome/repos", "first_run");
		await screen.findByRole("checkbox", { name: "fairway" });
		for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
		expect(screen.getByText("0 of 7 selected")).toBeInTheDocument();
		expect(screen.getByText("2 repos skipped before reading")).toBeInTheDocument();
		expect(
			screen.getByText("2 repos match a Never touch rule, so nothing in them was opened."),
		).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/client-/);
	});

	it("asks for at least one project", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/repos", "first_run");
		await screen.findByRole("checkbox", { name: "fairway" });
		await user.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Turn on at least one project to continue.");
		expect(h.mutations).toEqual([]);
	});

	it("searches, adds what's chosen, and goes on to reading", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/repos", "first_run");
		await user.type(await screen.findByRole("searchbox", { name: "Search repos" }), "fair");
		expect(screen.queryByRole("checkbox", { name: "foundry" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("checkbox", { name: "fairway" }));
		expect(screen.getByText("1 of 7 selected")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() =>
			expect(h.mutations.join()).toContain(
				'POST /api/projects {"repos":[{"repo":"example-org/fairway","clone":false}]}',
			),
		);
		await waitFor(() => expect(path(h)).toBe("/welcome/reading"));
	});

	it("says when a search finds nothing", async () => {
		const user = userEvent.setup();
		await renderApp("/welcome/repos", "first_run");
		await user.type(await screen.findByRole("searchbox", { name: "Search repos" }), "zzz");
		expect(screen.getByText("No repos match ‘zzz’.")).toBeInTheDocument();
	});

	it("clones a repo that isn't on this Mac, and shows a failed clone in its row", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/repos", "first_run");
		const clone = await screen.findByRole("button", { name: "Clone labs" });
		h.failNext("/api/repos/clone", 502, "That failed.");
		await user.click(clone);
		expect(await screen.findByText("Couldn't clone this. Try again.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Clone labs" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/repos/clone {"repo":"example-org/labs"}'));
		await waitFor(() => expect(screen.queryByRole("button", { name: "Clone labs" })).not.toBeInTheDocument());
	});

	it("keeps the selection when adding fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/repos", "first_run");
		await user.click(await screen.findByRole("checkbox", { name: "fairway" }));
		h.failNext("/api/projects", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByText("Couldn't add this. Try again.")).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: "fairway" })).toBeChecked();
	});

	it("fails to read the repos in words", async () => {
		const h = await renderApp("/welcome/tools", "first_run");
		await screen.findByRole("link", { name: "Continue" });
		h.failNext("/api/repos", 502, "gh couldn't reach GitHub.");
		await h.router.navigate({ to: "/welcome/$step", params: { step: "repos" } });
		expect(await screen.findByRole("button", { name: "Check again" })).toBeInTheDocument();
	});
});

describe("FRReading", () => {
	it("shows each project as it's read, and a warning for the missing Sentry link", async () => {
		await renderApp("/welcome/reading", "reading");
		expect(await screen.findByRole("heading", { name: "Reading 3 projects" })).toBeInTheDocument();
		expect(screen.getByText("Reading open PRs")).toBeInTheDocument();
		expect(screen.getByText("2 open PRs · no errors · toolkit current")).toBeInTheDocument();
		expect(screen.getByText("2 open PRs · toolkit current")).toBeInTheDocument();
		expect(screen.getByText("Fairway has no Sentry project linked")).toBeInTheDocument();
		expect(screen.getByText("Gather joins the queue when it finishes.")).toBeInTheDocument();
	});

	it("opens the queue with the first-look banner", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/reading", "reading");
		await user.click(await screen.findByRole("button", { name: "Open your queue" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/first-look {}"));
		expect(h.mutations).toContain("POST /api/visit {}");
		await waitFor(() => expect(path(h)).toBe("/"));
	});

	it("waits until something has been read", async () => {
		await renderApp("/welcome/reading", "loading");
		expect(await screen.findByRole("button", { name: "Open your queue" })).toBeDisabled();
	});

	it("shows a failure without leaving", async () => {
		const user = userEvent.setup();
		const h = await renderApp("/welcome/reading", "reading");
		const open = await screen.findByRole("button", { name: "Open your queue" });
		h.failNext("/api/first-look", 500, "That failed.");
		await user.click(open);
		expect(await screen.findByText("Couldn't open this. Try again.")).toBeInTheDocument();
		expect(path(h)).toBe("/welcome/reading");
	});

	it("goes back to choosing when there's nothing to read", async () => {
		const h = await renderApp("/welcome/reading", "first_run");
		await waitFor(() => expect(path(h)).toBe("/welcome/repos"));
	});

	it("finishes reading what was just added", async () => {
		const user = userEvent.setup();
		await renderApp("/welcome/repos", "first_run");
		await user.click(await screen.findByRole("checkbox", { name: "fairway" }));
		await user.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByRole("heading", { name: "Reading 1 project" })).toBeInTheDocument();
		await waitFor(() => expect(screen.getByRole("heading", { name: "Read 1 project" })).toBeInTheDocument(), {
			timeout: 6000,
		});
		expect(screen.getByRole("button", { name: "Open your queue" })).toBeEnabled();
	}, 10_000);
});

describe("NLDescribe", () => {
	it("shows the form with the defaults", async () => {
		await renderApp(`${NEW}/describe`);
		expect(await screen.findByRole("heading", { name: "New project" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /Expo app/ })).toBeChecked();
		expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
		expect(screen.getByRole("link", { name: "Cancel" })).toBeInTheDocument();
	});

	it("needs a name, and focuses it", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/describe`);
		await user.click(await screen.findByRole("button", { name: "Continue" }));
		expect(await screen.findByText("Enter a name for the project.")).toBeInTheDocument();
		expect(screen.getByLabelText(/^Name/)).toHaveFocus();
		expect(h.mutations).toEqual([]);
	});

	it("refuses a taken name and keeps what was typed", async () => {
		const user = userEvent.setup();
		await renderApp(`${NEW}/describe`);
		await user.type(await screen.findByLabelText(/^Name/), "taken");
		await user.type(screen.getByLabelText(/What is it for/), "A sample");
		await user.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByText(/already has a repo with this name/)).toBeInTheDocument();
		expect(screen.getByLabelText(/^Name/)).toHaveFocus();
		expect(screen.getByLabelText(/What is it for/)).toHaveValue("A sample");
	});

	it("creates the run from the keyboard and moves on to approve", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/describe`);
		await user.type(await screen.findByLabelText(/^Name/), "caddie{Enter}");
		await waitFor(() => expect(h.mutations.join()).toMatch(/POST \/api\/new-project \{"name":"caddie"/));
		expect(await screen.findByRole("heading", { name: "Approve these changes" })).toBeInTheDocument();
		expect(h.router.state.location.search).toHaveProperty("run");
	});

	it("shows why creating failed and keeps the fields", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/describe`);
		await user.type(await screen.findByLabelText(/^Name/), "caddie");
		h.failNext("/api/new-project/check", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByText("Couldn't create this. That failed.")).toBeInTheDocument();
		expect(screen.getByLabelText(/^Name/)).toHaveValue("caddie");
	});
});

describe("NLApprove", () => {
	it("lists what changes, and approves", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/approve?run=1`, "new_project_runs");
		expect(await screen.findByText("Create the GitHub repo")).toBeInTheDocument();
		expect(screen.getByText("example-org/caddie · private")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Approve and create" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/new-project/1/approve {}"));
		expect(await screen.findByRole("heading", { name: "Building caddie" })).toBeInTheDocument();
		await waitFor(() => expect(path(h)).toBe(`${NEW}/scaffold`));
	});

	it("goes back with the fields filled in", async () => {
		const user = userEvent.setup();
		await renderApp(`${NEW}/approve?run=1`, "new_project_runs");
		await user.click(await screen.findByRole("link", { name: "Change something" }));
		await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue("caddie"));
		expect(screen.getByLabelText(/What is it for/)).toHaveValue("Tracks my clubs and how far each one goes.");
	});

	it("shows the failure and stays", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/approve?run=1`, "new_project_runs");
		const go = await screen.findByRole("button", { name: "Approve and create" });
		h.failNext("/api/new-project/1/approve", 500, "That failed.");
		await user.click(go);
		expect(await screen.findByText("Couldn't start this. Try again.")).toBeInTheDocument();
	});
});

describe("NLScaffold", () => {
	it("shows the log with Connect services off until it's green", async () => {
		await renderApp(`${NEW}/scaffold?run=6`, "new_project_runs");
		expect(await screen.findByRole("heading", { name: "Building caddie" })).toBeInTheDocument();
		expect(screen.getByText("Created example-org/caddie")).toBeInTheDocument();
		expect(screen.getByText(/Applying the Expo app template/)).toBeInTheDocument();
		expect(screen.getByText("Run the baseline")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Connect services" })).toBeDisabled();
		expect(screen.getByRole("link", { name: "Back to the queue" })).toBeInTheDocument();
	});

	it("runs the whole way for real through the demo connectors", async () => {
		const user = userEvent.setup();
		await renderApp(`${NEW}/describe`);
		await user.type(await screen.findByLabelText(/^Name/), "caddie{Enter}");
		await user.click(await screen.findByRole("button", { name: "Approve and create" }));
		const link = await screen.findByRole("link", { name: "Connect services" }, { timeout: 8000 });
		await user.click(link);
		expect(await screen.findByRole("heading", { name: "Connect services" })).toBeInTheDocument();
	}, 15_000);
});

describe("NLFailed", () => {
	it("shows the failed step, retries, and keeps going", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/failed?run=2`, "new_project_runs");
		expect(await screen.findByRole("heading", { name: "caddie couldn't be built" })).toBeInTheDocument();
		expect(
			screen.getByText("The template step failed. The repo and folder exist, so you can retry from here."),
		).toBeInTheDocument();
		expect(screen.getByText("pnpm install failed: registry timeout")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Retry this step" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/new-project/2/retry {}"));
		expect(await screen.findByRole("heading", { name: "Building caddie" })).toBeInTheDocument();
	});

	it("confirms by name before removing, and starts on the safe button", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/failed?run=2`, "new_project_runs");
		await user.click(await screen.findByRole("button", { name: "Remove what was created" }));
		expect(await screen.findByText(/the example-org\/caddie repo on GitHub/)).toBeInTheDocument();
		expect(h.mutations).toEqual([]);
		await waitFor(() => expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus());
		await user.click(screen.getByRole("button", { name: "Remove repo and folder" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/new-project/2/remove {}"));
		await waitFor(() => expect(path(h)).toBe("/projects"));
	});

	it("shows why removing failed", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/failed?run=2`, "new_project_runs");
		await user.click(await screen.findByRole("button", { name: "Remove what was created" }));
		h.failNext("/api/new-project/2/remove", 502, "GitHub needs the delete_repo scope.");
		await user.click(await screen.findByRole("button", { name: "Remove repo and folder" }));
		expect(
			await screen.findByText(/Couldn't remove this\. GitHub needs the delete_repo scope\./),
		).toBeInTheDocument();
	});
});

describe("NLBaseline", () => {
	it("explains the red baseline and starts a work order to fix it", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/baseline?run=3`, "new_project_runs");
		expect(await screen.findByRole("heading", { name: "The baseline is red" })).toBeInTheDocument();
		expect(screen.getByText("Baseline: tests")).toBeInTheDocument();
		expect(screen.getByText(/expected 200, got 500/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		await waitFor(() => expect(h.mutations.join()).toMatch(/POST \/api\/work-orders \{"project":"caddie"/));
		await waitFor(() => expect(path(h)).toMatch(/^\/work-orders\/\d+/));
	});

	it("can remove the project instead", async () => {
		await renderApp(`${NEW}/baseline?run=3`, "new_project_runs");
		expect(await screen.findByRole("button", { name: "Remove what was created" })).toBeInTheDocument();
	});

	it("can run the baseline again", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/baseline?run=3`, "new_project_runs");
		await user.click(await screen.findByRole("button", { name: "Run the baseline again" }));
		await waitFor(() => expect(h.mutations).toContain("POST /api/new-project/3/retry {}"));
	});

	it("reaches this state through a real failing baseline, with the project added", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/describe`);
		await user.type(await screen.findByLabelText(/^Name/), "fail-baseline{Enter}");
		await user.click(await screen.findByRole("button", { name: "Approve and create" }));
		expect(
			await screen.findByRole("heading", { name: "The baseline is red" }, { timeout: 8000 }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Start work order" })).toBeEnabled();
		await waitFor(() => expect(path(h)).toBe(`${NEW}/baseline`));
	}, 15_000);
});

describe("NLConnect", () => {
	it("connects one, skips one, and undoes it", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/connect?run=4`, "new_project_runs");
		await user.click(await screen.findByRole("button", { name: "Connect Sentry" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/new-project/4/connect {"service":"sentry"}'),
		);
		expect(await screen.findByText("Connected")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Skip EAS" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/new-project/4/service {"service":"eas","state":"skipped"}'),
		);
		expect(await screen.findByText("2 skipped services stay as reminders under Later.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Undo skipping EAS" }));
		expect(await screen.findByRole("button", { name: "Connect EAS" })).toBeInTheDocument();
	});

	it("shows a tool that isn't installed, already skipped, with its install command", async () => {
		await renderApp(`${NEW}/connect?run=4`, "new_project_runs");
		expect(await screen.findByText("brew install infisical")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Undo skipping Infisical" })).toBeInTheDocument();
	});

	it("shows why connecting failed in the row, and finishes", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/connect?run=4`, "new_project_runs");
		const connect = await screen.findByRole("button", { name: "Connect Sentry" });
		h.failNext("/api/new-project/4/connect", 502, "Sentry said no.");
		await user.click(connect);
		expect(await screen.findByText("Couldn't connect this. Sentry said no.")).toBeInTheDocument();
		await user.click(screen.getByRole("link", { name: "Finish" }));
		await waitFor(() => expect(path(h)).toBe(`${NEW}/done`));
	});
});

describe("NLDone", () => {
	it("starts the first work order from the idea", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/done?run=5`, "new_project_runs");
		expect(await screen.findByRole("heading", { name: "caddie is on the floor" })).toBeInTheDocument();
		const facts = screen.getByText("Services").closest("dl") as HTMLElement;
		expect(within(facts).getByText("Sentry, EAS")).toBeInTheDocument();
		expect(within(facts).getByText("Infisical. Reminder under Later.")).toBeInTheDocument();
		await user.type(screen.getByLabelText(/What should it build first/), "A list of my clubs");
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		await waitFor(() =>
			expect(h.mutations).toContain('POST /api/new-project/5/finish {"idea":"A list of my clubs"}'),
		);
		await waitFor(() => expect(path(h)).toMatch(/^\/work-orders\/\d+/));
	});

	it("needs an idea or a skip, and skip goes to the floor", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/done?run=5`, "new_project_runs");
		await user.click(await screen.findByRole("button", { name: "Start work order" }));
		expect(await screen.findByText("Describe the first change, or skip this for now.")).toBeInTheDocument();
		expect(screen.getByLabelText(/What should it build first/)).toHaveFocus();
		await user.click(screen.getByRole("button", { name: "Skip for now" }));
		await waitFor(() => expect(h.mutations).toContain('POST /api/new-project/5/finish {"idea":null}'));
		await waitFor(() => expect(path(h)).toBe("/floor"));
	});

	it("keeps the idea when finishing fails", async () => {
		const user = userEvent.setup();
		const h = await renderApp(`${NEW}/done?run=5`, "new_project_runs");
		await user.type(await screen.findByLabelText(/What should it build first/), "A list of my clubs");
		h.failNext("/api/new-project/5/finish", 500, "That failed.");
		await user.click(screen.getByRole("button", { name: "Start work order" }));
		expect(await screen.findByText("Couldn't finish this. Try again.")).toBeInTheDocument();
		expect(screen.getByLabelText(/What should it build first/)).toHaveValue("A list of my clubs");
	});
});

describe("the wizard's URL", () => {
	it("sends a step without a run back to Describe, and follows the run's real step", async () => {
		const h = await renderApp(`${NEW}/connect`);
		await waitFor(() => expect(path(h)).toBe(`${NEW}/describe`));
		const other = await renderApp(`${NEW}/done?run=2`, "new_project_runs");
		await waitFor(() => expect(path(other)).toBe(`${NEW}/failed`));
	});

	it("says so when the run is gone", async () => {
		await renderApp(`${NEW}/connect?run=99`);
		expect(await screen.findByRole("link", { name: "Start again" })).toBeInTheDocument();
	});
});
