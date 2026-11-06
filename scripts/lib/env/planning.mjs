import { destinationLabel } from "./manifest.mjs";
export function selectPlacements(manifest, environment, options = {}) {
    const all = manifest.placementsFor(environment, {
        prNumber: options.prNumber,
    });
    if (!options.only || options.only === "infisical")
        return options.only === "infisical" ? [] : all;
    return all.filter((placement) => placement.destination.kind === options.only);
}
/** Pure, redacted plan. Source values affect readiness but never appear in its result. */
export function planEnvironment(manifest, environment, source, options = {}) {
    const all = manifest.placementsFor(environment, {
        prNumber: options.prNumber,
    });
    const placements = selectPlacements(manifest, environment, options);
    const relevant = options.only === "infisical" ? all : placements;
    const findings = [];
    const operations = [];
    const byEntry = new Map();
    for (const placement of relevant) {
        const list = byEntry.get(placement.entry.key) ?? [];
        list.push(placement);
        byEntry.set(placement.entry.key, list);
    }
    for (const [key, entryPlacements] of byEntry) {
        const entry = entryPlacements[0]?.entry;
        if (!entry)
            continue;
        const allSupplied = entryPlacements.every((placement) => placement.suppliedBy);
        const hasValue = Object.hasOwn(source.values, entry.infisicalKey) &&
            source.values[entry.infisicalKey] !== "";
        if (!allSupplied && !hasValue) {
            findings.push({
                level: entry.optional ? "warning" : "error",
                code: entry.optional
                    ? "source.optional-missing"
                    : "source.required-missing",
                message: `${key}: canonical source value is ${Object.hasOwn(source.values, entry.infisicalKey) ? "empty" : "missing"}${entry.optional ? " (optional)" : ""}`,
            });
        }
    }
    for (const override of source.overrides)
        findings.push({
            level: "note",
            code: "source.override",
            message: `${override.to} overrides ${override.from}/${override.name}`,
        });
    const declared = new Set(manifest.ENTRIES.map((entry) => entry.infisicalKey));
    const mostSpecific = manifest.ENV_CONFIG.source.paths.at(-1);
    if (mostSpecific)
        for (const name of Object.keys(source.folders[mostSpecific] ?? {}).sort()) {
            if (!declared.has(name))
                findings.push({
                    level: "warning",
                    code: "source.undeclared",
                    message: `${mostSpecific}/${name}: not declared in the manifest`,
                });
        }
    for (const placement of placements) {
        if (placement.suppliedBy) {
            findings.push({
                level: "note",
                code: "placement.supplied",
                message: `${destinationLabel(placement.destination)}/${placement.name}: supplied by ${placement.suppliedBy}`,
            });
            continue;
        }
        const value = source.values[placement.entry.infisicalKey];
        if (value === undefined || value === "")
            continue;
        operations.push({
            action: "write",
            destination: destinationLabel(placement.destination),
            name: placement.name,
            entry: placement.entry.key,
            secret: placement.entry.secret,
        });
    }
    return {
        plan: {
            app: manifest.ENV_CONFIG.appName,
            environment,
            operations,
            findings,
        },
        placements,
    };
}
/** Child-process variables for exec. Values stay in the returned object only. */
export function execVariables(placements, source) {
    const env = Object.create(null);
    const findings = [];
    for (const placement of placements) {
        if (placement.suppliedBy)
            continue;
        const value = source.values[placement.entry.infisicalKey];
        if (value === undefined || value === "")
            continue;
        if (Object.hasOwn(env, placement.name) && env[placement.name] !== value) {
            findings.push({
                level: "error",
                code: "exec.collision",
                message: `${placement.name}: selected placements disagree; narrow them with --only`,
            });
            continue;
        }
        env[placement.name] = value;
    }
    return { env: { ...env }, findings };
}
