import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type {
	AutomationsResponse,
	EnvironmentsResponse,
	ErrorDetail,
	ErrorItem,
	FloorResponse,
	HealthResponse,
	IssuesResponse,
	ModesResponse,
	NewProjectRun,
	PrDetail,
	Project,
	ProjectDetail,
	ProjectEnvironmentsResponse,
	PullRequest,
	QueueResponse,
	ReadingResponse,
	RepoListResponse,
	SecurityResponse,
	Settings,
	ShellResponse,
	ToolStatus,
	VersionsResponse,
	WorkOrder,
} from "../shared/types.ts";
import { ApiFailure, api } from "./api.ts";

/** Query keys. The first part matches the keys the service publishes over /api/events. */
export const useShell = () =>
	useQuery({
		queryKey: ["shell"],
		queryFn: () => api.get<ShellResponse>("/api/shell"),
		refetchInterval: 30_000,
	});
export const useQueue = () =>
	useQuery({ queryKey: ["queue"], queryFn: () => api.get<QueueResponse>("/api/queue") });
/** `?projects=a,b`, or nothing for every project. */
const only = (projects: string[], first = "?") =>
	projects.length ? `${first}projects=${projects.map(encodeURIComponent).join(",")}` : "";

export const useFloor = (projects: string[] = []) =>
	useQuery({
		queryKey: ["floor", projects.join(",")],
		queryFn: () => api.get<FloorResponse>(`/api/floor${only(projects)}`),
	});
export const useWorkOrders = () =>
	useQuery({ queryKey: ["work-orders"], queryFn: () => api.get<WorkOrder[]>("/api/work-orders") });
export const useWorkOrder = (id: number) =>
	useQuery({
		queryKey: ["work-order", String(id)],
		queryFn: () => api.get<WorkOrder>(`/api/work-orders/${id}`),
	});
export const usePrs = (projects: string[] = []) =>
	useQuery({
		queryKey: ["prs", projects.join(",")],
		queryFn: () => api.get<PullRequest[]>(`/api/prs${only(projects)}`),
	});
export const usePr = (project: string, number: number) =>
	useQuery({
		queryKey: ["pr", project, String(number)],
		queryFn: () => api.get<PrDetail>(`/api/prs/${encodeURIComponent(project)}/${number}`),
	});
export interface ErrorsResponse {
	errors: ErrorItem[];
	checkedAt: string | null;
	withoutSentry: number;
	quiet: number;
}
export const useVersions = () =>
	useQuery({
		queryKey: ["versions"],
		queryFn: () => api.get<VersionsResponse>("/api/versions"),
		refetchInterval: 30_000,
	});
export const useAutomations = () =>
	useQuery({
		queryKey: ["automations"],
		queryFn: () => api.get<AutomationsResponse>("/api/automations"),
	});
export const useEnvironments = () =>
	useQuery({
		queryKey: ["environments"],
		queryFn: () => api.get<EnvironmentsResponse>("/api/environments"),
		// A quiet deploy command sends nothing, and the clock still moves.
		refetchInterval: 15_000,
	});
export const useProjectEnvironments = (slug: string) =>
	useQuery({
		queryKey: ["project-environments", slug],
		queryFn: () =>
			api.get<ProjectEnvironmentsResponse>(`/api/projects/${encodeURIComponent(slug)}/environments`),
		refetchInterval: 15_000,
	});
export const useIssues = (projects: string[] = []) =>
	useQuery({
		queryKey: ["issues", projects.join(",")],
		queryFn: () => api.get<IssuesResponse>(`/api/issues${only(projects)}`),
	});
export const useErrors = (projects: string[] = []) =>
	useQuery({
		queryKey: ["errors", projects.join(",")],
		queryFn: () => api.get<ErrorsResponse>(`/api/errors${only(projects)}`),
	});
export const useError = (id: string) =>
	useQuery({
		queryKey: ["error", id],
		queryFn: () => api.get<ErrorDetail>(`/api/errors/${encodeURIComponent(id)}`),
	});
export const useProjects = () =>
	useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/api/projects") });
export const useProject = (slug: string) =>
	useQuery({
		queryKey: ["project", slug],
		queryFn: () => api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}`),
	});
export const useHealth = (projects: string[] = []) =>
	useQuery({
		queryKey: ["health", projects.join(",")],
		queryFn: () => api.get<HealthResponse>(`/api/health?window=14d${only(projects, "&")}`),
	});
export const useSecurity = () =>
	useQuery({ queryKey: ["security"], queryFn: () => api.get<SecurityResponse>("/api/security") });
export const useSettings = () =>
	useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
export const useModes = () =>
	useQuery({ queryKey: ["modes"], queryFn: () => api.get<ModesResponse>("/api/modes") });
export const useTools = () =>
	useQuery({ queryKey: ["tools"], queryFn: () => api.get<ToolStatus[]>("/api/tools") });
export const useRepos = (enabled = true) =>
	useQuery({ queryKey: ["repos"], queryFn: () => api.get<RepoListResponse>("/api/repos"), enabled });
export const useReading = () =>
	useQuery({
		queryKey: ["reading"],
		queryFn: () => api.get<ReadingResponse>("/api/reading"),
		refetchInterval: 2000,
	});
export const useNewProject = (id: number) =>
	useQuery({
		queryKey: ["new-project", String(id)],
		queryFn: () => api.get<NewProjectRun>(`/api/new-project/${id}`),
	});

/**
 * Runs a mutation and refreshes everything after it, so the page doesn't wait for the next event.
 * `error` holds the service's words. Show it with <InlineError>, keeping the input as it was.
 */
export function useAction<A = void, R = unknown>(
	fn: (arg: A) => Promise<R>,
	opts: { onSuccess?: (r: R, arg: A) => void } = {},
) {
	const client = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const m = useMutation({
		mutationFn: fn,
		onMutate: () => setError(null),
		onSuccess: (r, arg) => {
			void client.invalidateQueries();
			opts.onSuccess?.(r, arg);
		},
		onError: (e) => setError(e instanceof ApiFailure ? e.message : "Something went wrong."),
	});
	const run = useCallback((arg: A) => m.mutateAsync(arg).catch(() => undefined), [m.mutateAsync]);
	return { run, pending: m.isPending, error, clearError: useCallback(() => setError(null), []) };
}
