/**
 * The shared environment model. A manifest that omits CONSUMERS, the source
 * mapping, or placementsFor gets these defaults, so every app routes the same
 * consumer to the same destination. ENV_CONFIG.routes overrides single cells.
 */
export const STANDARD_ENVIRONMENTS = ["local", "dev", "preview", "staging", "production"];
export const STANDARD_SOURCE = {
    local: "dev",
    dev: "dev",
    preview: "staging",
    staging: "prod",
    production: "prod",
};
export const STANDARD_CONSUMERS = [
    "vite-build",
    "local-tooling",
    "worker-runtime",
    "convex-functions",
    "workflow",
    "expo-build",
    "eas-tooling",
    "expo-local",
];
/** GitHub repository scope holds preview values; the prefix keeps them from shadowing Environment values. */
export const REPO_SCOPE_PREFIX = "PREVIEW_";
const DEPLOYED = new Set(["dev", "staging", "production"]);
// The installed preview app is long-lived like staging, so EAS preview is written from staging.
const EAS = { local: "development", dev: "development", staging: "preview", production: "production" };
function workerName(config, environment, context) {
    const name = config.worker?.name;
    if (!name)
        return null;
    const explicit = config.worker?.names?.[environment];
    if (explicit)
        return explicit;
    if (environment === "production")
        return name;
    if (environment === "preview")
        return context?.prNumber ? `${name}-pr-${context.prNumber}` : null;
    return `${name}-${environment}`;
}
function github(environment) {
    if (environment === "preview")
        return { kind: "github", scope: "repo" };
    return DEPLOYED.has(environment) ? { kind: "github", scope: environment } : null;
}
export function standardDestination(config, consumer, environment, context) {
    const override = config.routes?.[consumer];
    if (override && Object.hasOwn(override, environment))
        return override[environment] ?? null;
    const mobile = config.mobile?.path ?? "apps/mobile";
    switch (consumer) {
        case "vite-build":
            return environment === "local" ? { kind: "file", path: ".env.local" } : github(environment);
        case "local-tooling":
            return environment === "local" ? { kind: "file", path: ".env.local" } : null;
        case "worker-runtime": {
            if (environment === "local")
                return { kind: "file", path: ".dev.vars" };
            const worker = workerName(config, environment, context);
            return worker ? { kind: "worker", worker } : null;
        }
        case "convex-functions": {
            if (environment === "local")
                return config.convex?.deployments?.dev
                    ? { kind: "convex", target: "dev", deployment: config.convex.deployments.dev }
                    : { kind: "convex", target: "dev" };
            if (environment === "preview")
                return config.convex?.project
                    ? { kind: "convex", target: "preview-default", project: config.convex.project }
                    : null;
            const deployment = config.convex?.deployments?.[environment];
            return deployment ? { kind: "convex", target: environment, deployment } : null;
        }
        case "workflow":
            return environment === "local" ? null : github(environment);
        case "expo-build":
        case "eas-tooling":
            return EAS[environment] ? { kind: "eas", environment: EAS[environment] } : null;
        case "expo-local":
            return environment === "local" ? { kind: "file", path: `${mobile}/.env.local` } : null;
        default:
            return null;
    }
}
export function standardPlacements(manifest, environment, context = {}) {
    const placements = [];
    for (const entry of manifest.ENTRIES) {
        for (const consumer of manifest.CONSUMERS) {
            const landing = entry.lands[consumer];
            if (!landing || !landing.environments.includes(environment))
                continue;
            const destination = standardDestination(manifest.ENV_CONFIG, consumer, environment, context);
            if (!destination)
                continue;
            const repoScope = destination.kind === "github" && destination.scope === "repo";
            placements.push({
                entry,
                consumer,
                environment,
                name: repoScope ? `${REPO_SCOPE_PREFIX}${landing.name}` : landing.name,
                // The name a process reads (exec, CI job env); differs from name only in repository scope.
                variable: landing.name,
                destination,
                suppliedBy: landing.suppliedIn?.[environment] ?? null,
            });
        }
    }
    return placements;
}
/** Fills omitted exports with the shared model. Explicit exports win, so custom manifests keep working. */
export function resolveEnvironmentManifest(loaded) {
    if (!loaded || typeof loaded !== "object" || !loaded.ENV_CONFIG || typeof loaded.ENV_CONFIG !== "object")
        return loaded;
    const config = loaded.ENV_CONFIG;
    const source = config.source && typeof config.source === "object" ? config.source : {};
    const resolved = {
        ...loaded,
        ENV_CONFIG: {
            ...config,
            source: { ...source, environments: { ...STANDARD_SOURCE, ...(source.environments ?? {}) } },
        },
        CONSUMERS: loaded.CONSUMERS ?? STANDARD_CONSUMERS,
    };
    resolved.placementsFor =
        typeof loaded.placementsFor === "function"
            ? loaded.placementsFor
            : (environment, context) => standardPlacements(resolved, environment, context);
    return resolved;
}
