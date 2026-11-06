import type { EnvironmentIo } from "../env/types";
import type { AppelentManifest } from "../project/types";

export type WorkspaceMode = "none" | "local" | "cloud";

export type WorkspacePolicy = {
	backend: {
		mode: WorkspaceMode;
		project?: string;
		expiration: string;
		scopedCredential: boolean;
		push: boolean;
	};
	install: boolean;
	buildScripts: string[];
	seedScript?: string;
	outputs: {
		rootEnv: string;
		mobileEnv?: string;
		mobileUrlName: string;
	};
	ports: { web?: number; mobile?: number };
};

export type WorkspaceIdentity = {
	id: string;
	repositoryPath: string;
	worktreePath: string;
	repositoryFingerprint: string;
	hostFingerprint: string;
};

export type WorkspaceStepId =
	| "prerequisites"
	| "install"
	| "build"
	| "environment-source"
	| "backend"
	| "backend-environment"
	| "scoped-credential"
	| "push"
	| "client-outputs"
	| "seed"
	| "readiness";

export type WorkspaceStep = {
	id: WorkspaceStepId;
	status: "pending" | "complete" | "failed" | "skipped";
	attempts: number;
	updatedAt: string;
	evidence?: string[];
};

export type WorkspaceResource = {
	kind: "convex-deployment" | "convex-token" | "process" | "port";
	id: string;
	owned: boolean;
	status:
		| "active"
		| "removed"
		| "retained"
		| "pending-expiry"
		| "inaccessible"
		| "absent";
	cleanup: "delete" | "expiry" | "stop" | "release";
	expiresAt?: string;
	metadata?: Record<string, string | number | boolean>;
};

export type WorkspaceGeneratedFile = {
	path: string;
	digest: string;
	createdByWorkspace: boolean;
	status: "active" | "removed" | "modified" | "missing";
};

export type WorkspaceLedger = {
	schemaVersion: 1;
	workspace: WorkspaceIdentity;
	appName?: string;
	status: "preparing" | "ready" | "failed" | "cleaning" | "clean";
	createdAt: string;
	updatedAt: string;
	policy: WorkspacePolicy;
	steps: WorkspaceStep[];
	resources: WorkspaceResource[];
	generatedFiles: WorkspaceGeneratedFile[];
	readiness?: {
		backend: WorkspaceMode;
		reference?: string;
		publicHostname?: string;
		commands: string[];
	};
};

export type WorkspaceFinding = {
	level: "error" | "warning" | "note";
	code: string;
	message: string;
};

export type WorkspaceOperation = {
	action: "run" | "write" | "remove" | "stop" | "retain" | "reuse";
	target: string;
	detail?: string;
};

export type WorkspaceResult = {
	command: string;
	workspaceId?: string;
	status: "ready" | "clean" | "planned" | "failed";
	operations: WorkspaceOperation[];
	findings: WorkspaceFinding[];
	readiness?: WorkspaceLedger["readiness"];
};

export type WorkspaceCommandSpec = {
	tool: "git" | "pnpm" | "convex";
	args: readonly string[];
	cwd: string;
	packageRoot?: string;
	input?: string;
	removeEnv?: readonly string[];
	timeoutMs?: number;
};

export type WorkspaceCommandResult =
	| { status: "ok"; stdout: string }
	| {
			status: "missing" | "denied" | "not-found" | "failed";
			stdout?: string;
	  };

export type WorkspaceCommandRunner = (
	spec: WorkspaceCommandSpec,
) => Promise<WorkspaceCommandResult>;

export type WorkspaceDependencies = {
	runCommand?: WorkspaceCommandRunner;
	environ?: Readonly<Record<string, string | undefined>>;
	now?: () => Date;
	stateRoot?: string;
	identity?: WorkspaceIdentity;
	manifest?: AppelentManifest;
	prepareEnvironment?: (request: {
		root: string;
		manifestPath?: string;
	}) => Promise<{ exitCode: number }>;
	applyBackendEnvironment?: (request: {
		root: string;
		manifestPath?: string;
		reference: string;
		isolationRoot: string;
		runCommand: WorkspaceCommandRunner;
	}) => Promise<{ exitCode: number }>;
	isPortAvailable?: (port: number) => Promise<boolean>;
};

export type RunWorkspaceCliOptions = {
	root: string;
	manifestPath?: string;
	io?: EnvironmentIo;
	dependencies?: WorkspaceDependencies;
};
