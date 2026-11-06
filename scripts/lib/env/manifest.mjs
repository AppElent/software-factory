import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { assertSafeProjectPath } from "./files.mjs";
export function destinationLabel(destination) {
    switch (destination.kind) {
        case "file":
            return destination.path;
        case "convex":
            return `convex:${destination.project ? `${destination.project}:` : ""}${destination.deployment ?? destination.target}`;
        case "worker":
            return `worker:${destination.worker}`;
        case "github":
            return `github:${destination.scope}`;
        case "eas":
            return `eas:${destination.environment}`;
    }
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object";
}
export async function loadEnvironmentManifest(root, manifestPath) {
    const selected = resolve(root, manifestPath ?? join(root, "env.manifest.ts"));
    if (relative(root, selected).startsWith(".."))
        throw new Error("Environment manifest path must stay within the project root");
    await assertSafeProjectPath(root, relative(root, selected));
    const source = await readFile(selected, "utf8");
    const outputText = stripTypeScriptTypes(source, { mode: "strip" });
    try {
        const encoded = Buffer.from(`${outputText}\n//# sourceURL=${selected}`).toString("base64");
        const loaded = (await import(`data:text/javascript;base64,${encoded}`));
        if (!isRecord(loaded))
            throw new Error("missing exports");
        return loaded;
    }
    catch {
        throw new Error("Environment manifest could not be imported; runtime imports are unsupported");
    }
}
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
function validateEnvironmentManifestUnsafe(manifest) {
    const findings = [];
    if (!isRecord(manifest.ENV_CONFIG) || !nonEmpty(manifest.ENV_CONFIG.appName))
        findings.push({
            level: "error",
            code: "config.app",
            message: "ENV_CONFIG.appName is required",
        });
    if (!Array.isArray(manifest.ENVIRONMENTS) ||
        manifest.ENVIRONMENTS.length === 0) {
        findings.push({
            level: "error",
            code: "manifest.environments",
            message: "ENVIRONMENTS must not be empty",
        });
        return findings;
    }
    if (!Array.isArray(manifest.CONSUMERS) ||
        !Array.isArray(manifest.ENTRIES) ||
        typeof manifest.placementsFor !== "function") {
        findings.push({
            level: "error",
            code: "manifest.exports",
            message: "Manifest exports are incomplete",
        });
        return findings;
    }
    const envSet = new Set(manifest.ENVIRONMENTS);
    for (const environment of manifest.ENVIRONMENTS) {
        if (!nonEmpty(manifest.ENV_CONFIG?.source?.environments?.[environment]))
            findings.push({
                level: "error",
                code: "source.mapping",
                message: `${environment}: source mapping is missing`,
            });
    }
    const paths = manifest.ENV_CONFIG?.source?.paths;
    if (!Array.isArray(paths) ||
        paths.length === 0 ||
        paths.some((path) => !nonEmpty(path) || !path.startsWith("/")))
        findings.push({
            level: "error",
            code: "source.paths",
            message: "Source paths must be non-empty absolute Infisical folders",
        });
    const keys = new Set();
    const sourceKeys = new Set();
    for (const entry of manifest.ENTRIES) {
        if (!nonEmpty(entry.key) || !nonEmpty(entry.infisicalKey)) {
            findings.push({
                level: "error",
                code: "entry.metadata",
                message: "Every entry needs key and infisicalKey",
            });
            continue;
        }
        if (typeof entry.secret !== "boolean")
            findings.push({
                level: "error",
                code: "entry.secret",
                message: `${entry.key}: secret must be boolean`,
            });
        if (keys.has(entry.key) || sourceKeys.has(entry.infisicalKey))
            findings.push({
                level: "error",
                code: "entry.duplicate",
                message: `${entry.key}: entry/source keys must be unique`,
            });
        keys.add(entry.key);
        sourceKeys.add(entry.infisicalKey);
        const landings = Object.entries(entry.lands).filter((item) => item[1]);
        if (landings.length === 0)
            findings.push({
                level: "error",
                code: "entry.unrouted",
                message: `${entry.key}: declares no consumer`,
            });
        for (const [consumer, landing] of landings) {
            if (!landing ||
                !nonEmpty(landing.name) ||
                !/^[A-Za-z_][A-Za-z0-9_]*$/.test(landing.name) ||
                !Array.isArray(landing.environments) ||
                landing.environments.length === 0 ||
                !manifest.CONSUMERS.includes(consumer)) {
                findings.push({
                    level: "error",
                    code: "landing.invalid",
                    message: `${entry.key}.${consumer}: invalid landing`,
                });
                continue;
            }
            if (entry.secret &&
                (landing.name.startsWith("VITE_") ||
                    landing.name.startsWith("EXPO_PUBLIC_") ||
                    consumer === "vite-build" ||
                    consumer === "expo-build" ||
                    consumer === "expo-local"))
                findings.push({
                    level: "error",
                    code: "landing.public-secret",
                    message: `${entry.key}.${consumer}: secret value has a public client route`,
                });
            if (consumer === "vite-build" && !landing.name.startsWith("VITE_"))
                findings.push({
                    level: "error",
                    code: "landing.client-prefix",
                    message: `${entry.key}.${consumer}: client name must start with VITE_`,
                });
            if ((consumer === "expo-build" || consumer === "expo-local") &&
                !landing.name.startsWith("EXPO_PUBLIC_"))
                findings.push({
                    level: "error",
                    code: "landing.client-prefix",
                    message: `${entry.key}.${consumer}: client name must start with EXPO_PUBLIC_`,
                });
            for (const environment of landing.environments)
                if (!envSet.has(environment))
                    findings.push({
                        level: "error",
                        code: "landing.environment",
                        message: `${entry.key}.${consumer}: unknown environment ${environment}`,
                    });
            for (const environment of Object.keys(landing.suppliedIn ?? {}))
                if (!landing.environments.includes(environment))
                    findings.push({
                        level: "error",
                        code: "landing.supplied",
                        message: `${entry.key}.${consumer}: suppliedIn environment is not routed`,
                    });
        }
    }
    for (const environment of manifest.ENVIRONMENTS) {
        let placements;
        try {
            placements = manifest.placementsFor(environment, { prNumber: "0" });
        }
        catch {
            findings.push({
                level: "error",
                code: "placements.failed",
                message: `${environment}: placementsFor failed`,
            });
            continue;
        }
        if (!Array.isArray(placements)) {
            findings.push({
                level: "error",
                code: "placements.invalid",
                message: `${environment}: placementsFor must return an array`,
            });
            continue;
        }
        const slots = new Map();
        for (const placement of placements) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(placement.name) ||
                !manifest.CONSUMERS.includes(placement.consumer)) {
                findings.push({
                    level: "error",
                    code: "placement.invalid",
                    message: `${environment}: placement name or consumer is invalid`,
                });
                continue;
            }
            const slot = `${destinationLabel(placement.destination)}/${placement.name}`;
            const prior = slots.get(slot);
            if (prior && prior !== placement.entry.key)
                findings.push({
                    level: "error",
                    code: "placement.collision",
                    message: `${slot}: claimed by ${prior} and ${placement.entry.key}`,
                });
            slots.set(slot, placement.entry.key);
        }
    }
    return findings;
}
export function validateEnvironmentManifest(manifest) {
    try {
        return validateEnvironmentManifestUnsafe(manifest);
    }
    catch {
        return [
            {
                level: "error",
                code: "manifest.malformed",
                message: "Environment manifest contains malformed nested data",
            },
        ];
    }
}
export function renderEnvironmentExample(manifest) {
    const lines = [
        "# Generated by @appelent/dev env generate — do not edit by hand.",
        "#",
        `# Canonical source keys for ${manifest.ENV_CONFIG.appName}.`,
        `# Infisical folders, in override order: ${manifest.ENV_CONFIG.source.paths.join(", ")}`,
        "# Routing source of truth: env.manifest.ts",
        "",
    ];
    for (const entry of manifest.ENTRIES) {
        if (entry.description)
            lines.push(`# ${entry.description}`);
        lines.push(`# Infisical: ${entry.infisicalKey}`);
        for (const [consumer, landing] of Object.entries(entry.lands))
            if (landing)
                lines.push(`#   ${landing.name} (${consumer}: ${landing.environments.join(", ")})`);
        lines.push(`#   ${entry.secret ? "secret" : "published"}, ${entry.optional ? "optional" : "required"}`, `${entry.infisicalKey}=`, "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
}
