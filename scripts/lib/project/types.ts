export type FeatureDeclaration = {
	version: number;
	steps?: number[];
	options?: Record<string, unknown>;
	[key: string]: unknown;
};

export type TargetKind = "web" | "mobile" | "core" | "backend";

export type TargetDeclaration = {
	path: string;
	kind?: TargetKind;
	scripts?: Record<string, string>;
	[key: string]: unknown;
};

export type AppelentManifest = {
	schemaVersion?: 1;
	/** Legacy feature-catalog metadata; accepted with a warning, drives nothing. */
	features?: Record<string, FeatureDeclaration>;
	targets?: Record<string, TargetDeclaration>;
	workspace?: Record<string, unknown>;
	envManifest?: string;
	guidelines?: unknown[] | Record<string, unknown>;
	[key: string]: unknown;
};

export type ManifestDocument = {
	path: string;
	source: string;
	manifest: AppelentManifest;
};
