import { readFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
export const MANIFEST_FILE = "appelent.json";
export const CURRENT_SCHEMA_VERSION = 1;
export class ManifestValidationError extends Error {
    issues;
    constructor(issues) {
        super(`Invalid ${MANIFEST_FILE}: ${issues.join("; ")}`);
        this.issues = issues;
        this.name = "ManifestValidationError";
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasControlCharacters(value) {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    });
}
export function isSafeProjectPath(value) {
    if (value.length === 0 ||
        hasControlCharacters(value) ||
        isAbsolute(value) ||
        /^[A-Za-z]:/u.test(value) ||
        posix.isAbsolute(value.replaceAll("\\", "/")) ||
        win32.isAbsolute(value)) {
        return false;
    }
    const segments = value.replaceAll("\\", "/").split("/");
    for (const segment of segments) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..")
            return false;
    }
    return true;
}
export function resolveProjectPath(root, value) {
    if (!isSafeProjectPath(value))
        return null;
    const candidate = resolve(root, value.replaceAll("\\", "/"));
    const fromRoot = relative(root, candidate);
    if (fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        isAbsolute(fromRoot)) {
        return null;
    }
    return candidate;
}
export function validateManifest(value) {
    const issues = [];
    if (!isRecord(value)) {
        throw new ManifestValidationError(["root must be an object"]);
    }
    if (value.schemaVersion !== undefined &&
        value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        issues.push(`schemaVersion must be ${CURRENT_SCHEMA_VERSION}`);
    }
    if (value.features !== undefined && !isRecord(value.features)) {
        issues.push("features must be an object");
    }
    else if (value.features !== undefined) {
        for (const [name, feature] of Object.entries(value.features)) {
            const at = `features.${name}`;
            if (!isRecord(feature)) {
                issues.push(`${at} must be an object`);
                continue;
            }
            if (!Number.isInteger(feature.version) || Number(feature.version) < 1) {
                issues.push(`${at}.version must be a positive integer`);
            }
            if (feature.steps !== undefined) {
                if (!Array.isArray(feature.steps) ||
                    feature.steps.some((step) => !Number.isInteger(step) || Number(step) < 1) ||
                    new Set(feature.steps).size !== feature.steps.length) {
                    issues.push(`${at}.steps must contain unique positive integers`);
                }
            }
            if (feature.options !== undefined && !isRecord(feature.options)) {
                issues.push(`${at}.options must be an object`);
            }
        }
    }
    if (value.targets !== undefined) {
        if (!isRecord(value.targets)) {
            issues.push("targets must be an object");
        }
        else {
            const kinds = new Set(["web", "mobile", "core", "backend"]);
            for (const [name, target] of Object.entries(value.targets)) {
                const at = `targets.${name}`;
                if (!isRecord(target)) {
                    issues.push(`${at} must be an object`);
                    continue;
                }
                if (typeof target.path !== "string" ||
                    !isSafeProjectPath(target.path)) {
                    issues.push(`${at}.path must stay inside the project`);
                }
                if (target.kind !== undefined &&
                    (typeof target.kind !== "string" || !kinds.has(target.kind))) {
                    issues.push(`${at}.kind is not supported`);
                }
                if (target.scripts !== undefined) {
                    if (!isRecord(target.scripts)) {
                        issues.push(`${at}.scripts must be an object`);
                    }
                    else if (Object.values(target.scripts).some((script) => typeof script !== "string" || script.length === 0)) {
                        issues.push(`${at}.scripts values must be non-empty script names`);
                    }
                }
            }
        }
    }
    if (value.workspace !== undefined && !isRecord(value.workspace)) {
        issues.push("workspace must be an object");
    }
    if (value.envManifest !== undefined &&
        (typeof value.envManifest !== "string" ||
            !isSafeProjectPath(value.envManifest) ||
            !value.envManifest.endsWith(".ts"))) {
        issues.push("envManifest must be a TypeScript path inside the project");
    }
    if (value.guidelines !== undefined &&
        !Array.isArray(value.guidelines) &&
        !isRecord(value.guidelines)) {
        issues.push("guidelines must be an array or object");
    }
    if (issues.length > 0)
        throw new ManifestValidationError(issues);
    return value;
}
/** Non-blocking findings for a valid manifest. */
export function manifestWarnings(manifest) {
    return manifest.features === undefined
        ? []
        : [
            "features is legacy metadata from the retired feature catalog and drives nothing; remove it. Current keys: schemaVersion, workspace, envManifest (see standards/workspaces.md)",
        ];
}
export async function loadManifest(path) {
    const source = await readFile(path, "utf8");
    let value;
    try {
        value = JSON.parse(source);
    }
    catch {
        throw new ManifestValidationError(["file is not valid JSON"]);
    }
    return { path, source, manifest: validateManifest(value) };
}
export function planManifestMigration(manifest, options = {}) {
    const operations = [];
    if (manifest.schemaVersion === undefined) {
        operations.push({
            id: "add-schema-version",
            description: `Add schemaVersion ${CURRENT_SCHEMA_VERSION}`,
        });
    }
    if (manifest.targets === undefined) {
        operations.push({
            id: "declare-targets",
            description: "Review detected package targets and declare the supported ones",
        });
    }
    if (manifest.envManifest === undefined && options.envManifestDetected) {
        operations.push({
            id: "declare-env-manifest",
            description: "Record the existing environment manifest path",
        });
    }
    return operations;
}
