import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { EnvironmentsScreen, ProjectEnvironmentsScreen } from "./screens/environments.tsx";
import { ErrorDetailScreen } from "./screens/error-detail.tsx";
import { ErrorsScreen } from "./screens/errors.tsx";
import { FloorScreen } from "./screens/floor.tsx";
import { HealthScreen } from "./screens/health.tsx";
import { IssuesScreen } from "./screens/issues.tsx";
import { NewProjectScreen } from "./screens/new-project.tsx";
import { NotificationSamplesScreen } from "./screens/notification-samples.tsx";
import { PrReviewScreen } from "./screens/pr-review.tsx";
import { ProjectDetailScreen } from "./screens/project-detail.tsx";
import { ProjectsScreen } from "./screens/projects.tsx";
import { PullRequestsScreen } from "./screens/prs.tsx";
import { QueueScreen } from "./screens/queue.tsx";
import { SettingsScreen } from "./screens/settings.tsx";
import { WelcomeScreen } from "./screens/welcome.tsx";
import { WorkOrderScreen } from "./screens/work-order.tsx";
import { Root, SetupOutlet, ShellOutlet } from "./shell.tsx";

/** Search params every route shares: the new work order dialog can open over any page. */
const rootSearch = z.object({
	new: z.literal("work-order").optional(),
	newProject: z.string().optional(),
	newText: z.string().optional(),
});
const projectFilter = z.object({ project: z.string().optional() });

const rootRoute = createRootRoute({ component: Root, validateSearch: rootSearch });

const shell = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: ShellOutlet });
const setup = createRoute({ getParentRoute: () => rootRoute, id: "setup", component: SetupOutlet });

const queue = createRoute({
	getParentRoute: () => shell,
	path: "/",
	component: QueueScreen,
	validateSearch: z.object({ select: z.string().optional() }),
});
const floor = createRoute({
	getParentRoute: () => shell,
	path: "/floor",
	component: FloorScreen,
	validateSearch: projectFilter,
});
const prs = createRoute({
	getParentRoute: () => shell,
	path: "/prs",
	component: PullRequestsScreen,
	validateSearch: projectFilter,
});
const prReview = createRoute({
	getParentRoute: () => shell,
	path: "/prs/$project/$number",
	component: PrReviewScreen,
});
const issues = createRoute({
	getParentRoute: () => shell,
	path: "/issues",
	component: IssuesScreen,
	validateSearch: projectFilter.extend({ select: z.string().optional() }),
});
const errors = createRoute({
	getParentRoute: () => shell,
	path: "/errors",
	component: ErrorsScreen,
	validateSearch: projectFilter.extend({ dismissed: z.string().optional() }),
});
const errorDetail = createRoute({
	getParentRoute: () => shell,
	path: "/errors/$id",
	component: ErrorDetailScreen,
});
const environments = createRoute({
	getParentRoute: () => shell,
	path: "/environments",
	component: EnvironmentsScreen,
	validateSearch: z.object({ select: z.string().optional() }),
});
const projectEnvironments = createRoute({
	getParentRoute: () => shell,
	path: "/projects/$slug/environments",
	component: ProjectEnvironmentsScreen,
	validateSearch: z.object({ edit: z.boolean().optional() }),
});
const workOrder = createRoute({
	getParentRoute: () => shell,
	path: "/work-orders/$id",
	component: WorkOrderScreen,
});
const projects = createRoute({ getParentRoute: () => shell, path: "/projects", component: ProjectsScreen });
const projectDetail = createRoute({
	getParentRoute: () => shell,
	path: "/projects/$slug",
	component: ProjectDetailScreen,
});
const health = createRoute({ getParentRoute: () => shell, path: "/health", component: HealthScreen });
const settingsIndex = createRoute({
	getParentRoute: () => shell,
	path: "/settings",
	beforeLoad: () => {
		throw redirect({ to: "/settings/$section", params: { section: "agents" } });
	},
});
const settings = createRoute({
	getParentRoute: () => shell,
	path: "/settings/$section",
	component: SettingsScreen,
});
const samples = createRoute({
	getParentRoute: () => shell,
	path: "/settings/notifications/samples",
	component: NotificationSamplesScreen,
});

const welcome = createRoute({
	getParentRoute: () => setup,
	path: "/welcome/$step",
	component: WelcomeScreen,
});
const newProject = createRoute({
	getParentRoute: () => setup,
	path: "/projects/new/$step",
	component: NewProjectScreen,
	validateSearch: z.object({ run: z.coerce.number().optional() }),
});

export const routeTree = rootRoute.addChildren([
	shell.addChildren([
		queue,
		floor,
		prs,
		prReview,
		issues,
		errors,
		errorDetail,
		environments,
		projectEnvironments,
		workOrder,
		projects,
		projectDetail,
		health,
		settingsIndex,
		settings,
		samples,
	]),
	setup.addChildren([welcome, newProject]),
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
