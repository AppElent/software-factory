export type EnvironmentName = string;

export type FileDestination = { kind: "file"; path: string };
export type ConvexDestination = {
	kind: "convex";
	target: "dev" | "preview-default" | "staging" | "production" | string;
	/** Concrete deployment/reference. When omitted, target is passed explicitly. */
	deployment?: string;
	/** Required to make project-level defaults independent of the current checkout. */
	project?: string;
};
export type WorkerDestination = { kind: "worker"; worker: string };
export type GithubDestination = {
	kind: "github";
	scope: "repo" | string;
};
export type EasDestination = { kind: "eas"; environment: string };

export type EnvironmentDestination =
	| FileDestination
	| ConvexDestination
	| WorkerDestination
	| GithubDestination
	| EasDestination;

export type EnvironmentLanding = {
	name: string;
	environments: readonly string[];
	suppliedIn?: Readonly<Record<string, string>>;
};

export type EnvironmentEntry = {
	key: string;
	infisicalKey: string;
	description?: string;
	optional?: boolean;
	secret: boolean;
	lands: Readonly<Record<string, EnvironmentLanding | undefined>>;
};

export type EnvironmentPlacement = {
	entry: EnvironmentEntry;
	consumer: string;
	environment: string;
	/** Name at the destination. */
	name: string;
	/** Name a process reads (exec, CI job env); defaults to name. */
	variable?: string;
	destination: EnvironmentDestination;
	suppliedBy: string | null;
};

/** Shared model: local, dev, preview, staging, production. */
export type StandardEnvironment = "local" | "dev" | "preview" | "staging" | "production";
export type StandardConsumer =
	| "vite-build"
	| "local-tooling"
	| "worker-runtime"
	| "convex-functions"
	| "workflow"
	| "expo-build"
	| "eas-tooling"
	| "expo-local";

export type EnvironmentConfig = {
	appName: string;
	source: {
		/** Merged over the standard map (local/dev → dev, preview/staging → staging, production → prod), so a standard environment never lacks a mapping. */
		environments?: Readonly<Record<string, string>>;
		/** Ordered from least specific to most specific; later folders win. */
		paths: readonly string[];
	};
	/** Convex team:project for preview defaults, and the pinned deployed deployments. */
	convex?: {
		project?: string;
		deployments?: Partial<Record<"dev" | "staging" | "production", string>>;
	};
	/** Worker name; dev and staging get `<name>-<environment>`, previews `<name>-pr-<n>`. */
	worker?: { name: string; names?: Readonly<Record<string, string>> };
	mobile?: { path: string };
	github?: { repository?: string };
	/** Replace one standard destination; null drops it. Record why in CODING_STANDARDS.md. */
	routes?: Readonly<
		Record<string, Readonly<Record<string, EnvironmentDestination | null>>>
	>;
};

export type EnvironmentManifest = {
	ENV_CONFIG: EnvironmentConfig;
	ENVIRONMENTS: readonly string[];
	/** Defaults to the standard consumers. */
	CONSUMERS?: readonly string[];
	ENTRIES: readonly EnvironmentEntry[];
	/** Defaults to the standard routing. */
	placementsFor?(
		environment: string,
		context?: { prNumber?: string },
	): EnvironmentPlacement[];
};

export type SourceValues = {
	values: Readonly<Record<string, string>>;
	folders: Readonly<Record<string, Readonly<Record<string, string>>>>;
	overrides: readonly { name: string; from: string; to: string }[];
};

export type ProcessSpec = {
	tool: "infisical" | "convex" | "wrangler" | "gh" | "eas";
	args: readonly string[];
	cwd: string;
	input?: string;
	/** Names removed from the inherited environment before execution. */
	removeEnv?: readonly string[];
	/** Milliseconds before the provider is terminated; defaults to two minutes. */
	timeoutMs?: number;
	/** Milliseconds between SIGTERM and SIGKILL after a timeout; defaults to five seconds. */
	terminationGraceMs?: number;
};

export type ProcessResult =
	| { status: "ok"; stdout: string }
	| { status: "missing" | "denied" | "failed"; diagnostic?: string };

export type ProcessRunner = (spec: ProcessSpec) => Promise<ProcessResult>;

/** exec's child command: inherited stdio, source values added to the environment. */
export type CommandRunner = (spec: {
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
}) => Promise<{ exitCode: number }>;

export type EnvironmentIo = {
	writeOut(value: string): void;
	writeErr(value: string): void;
};

export type EnvironmentDependencies = {
	runProcess?: ProcessRunner;
	/** Tests/workspace preparation may provide already-captured source values. */
	loadSource?: (request: {
		root: string;
		environment: string;
		manifest: EnvironmentManifest;
		runProcess: ProcessRunner;
	}) => Promise<SourceValues>;
	runCommand?: CommandRunner;
	confirm?: (question: string) => Promise<string>;
	environ?: Readonly<Record<string, string | undefined>>;
};

export type RunEnvOptions = {
	root: string;
	manifest?: EnvironmentManifest;
	/** Absolute or root-relative trusted TypeScript manifest path. */
	manifestPath?: string;
	io?: EnvironmentIo;
	dependencies?: EnvironmentDependencies;
};

export type EnvironmentFinding = {
	level: "error" | "warning" | "note";
	code: string;
	message: string;
};

export type EnvironmentOperation = {
	action: "write" | "remove";
	destination: string;
	name?: string;
	entry?: string;
	secret?: boolean;
};

export type EnvironmentPlan = {
	app: string;
	environment: string;
	operations: EnvironmentOperation[];
	findings: EnvironmentFinding[];
};
