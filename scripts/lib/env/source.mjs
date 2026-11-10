import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeProjectPath } from "./files.mjs";
import { selectPlacements } from "./planning.mjs";
export class EnvironmentSourceError extends Error {
    kind;
    constructor(message, kind) {
        super(message);
        this.kind = kind;
        this.name = "EnvironmentSourceError";
    }
}
function safeRecord() {
    return Object.create(null);
}
function addValue(result, key, value) {
    if (typeof key !== "string" ||
        key.length === 0 ||
        typeof value !== "string") {
        throw new EnvironmentSourceError("Infisical export returned a malformed key or value", "invalid");
    }
    if (Object.hasOwn(result, key)) {
        throw new EnvironmentSourceError("Infisical export returned a duplicate key", "invalid");
    }
    Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}
export function normalizeInfisicalExport(parsed) {
    const result = safeRecord();
    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (!item || typeof item !== "object") {
                throw new EnvironmentSourceError("Infisical export returned an unsupported JSON shape", "invalid");
            }
            const row = item;
            addValue(result, row.secretKey ?? row.key, row.secretValue ?? row.value);
        }
        return result;
    }
    if (parsed && typeof parsed === "object") {
        for (const [key, raw] of Object.entries(parsed)) {
            const value = raw && typeof raw === "object" && Object.hasOwn(raw, "value")
                ? raw.value
                : raw;
            addValue(result, key, value);
        }
        return result;
    }
    throw new EnvironmentSourceError("Infisical export returned an unsupported JSON shape", "invalid");
}
export function mergeSourceFolders(folders) {
    const values = safeRecord();
    const byFolder = Object.create(null);
    const owner = new Map();
    const overrides = [];
    for (const folder of folders) {
        byFolder[folder.path] = { ...folder.values };
        for (const [name, value] of Object.entries(folder.values)) {
            const previous = owner.get(name);
            if (previous !== undefined)
                overrides.push({ name, from: previous, to: folder.path });
            values[name] = value;
            owner.set(name, folder.path);
        }
    }
    return { values, folders: byFolder, overrides };
}
/** Backwards-compatible two-folder helper used by Gather's legacy tests. */
export function mergeInfisicalFolders(rootValues, appValues) {
    const merged = mergeSourceFolders([
        { path: "/", values: rootValues },
        { path: "/app", values: appValues },
    ]);
    return {
        values: { ...merged.values },
        overrides: merged.overrides.map((item) => item.name).sort(),
    };
}
export async function readInfisicalConfig(root) {
    let text;
    try {
        await assertSafeProjectPath(root, ".infisical.json");
        text = await readFile(join(root, ".infisical.json"), "utf8");
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT") {
            throw new EnvironmentSourceError("Missing .infisical.json", "missing");
        }
        if (code === "EACCES" || code === "EPERM") {
            throw new EnvironmentSourceError("Cannot read .infisical.json", "denied");
        }
        throw new EnvironmentSourceError("Cannot read .infisical.json", "unavailable");
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new EnvironmentSourceError("Invalid .infisical.json", "invalid");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new EnvironmentSourceError("Invalid .infisical.json", "invalid");
    }
    const config = parsed;
    const projectId = config.projectId ?? config.workspaceId;
    if (typeof projectId !== "string" || projectId.trim().length === 0) {
        throw new EnvironmentSourceError("Invalid .infisical.json: expected workspaceId or projectId", "invalid");
    }
    return config;
}
export async function loadInfisicalSource(request) {
    const config = await readInfisicalConfig(request.root);
    const slug = request.manifest.ENV_CONFIG.source.environments[request.environment];
    if (!slug) {
        throw new EnvironmentSourceError("The manifest has no source environment mapping for the selected environment", "invalid");
    }
    const projectId = String(config.projectId ?? config.workspaceId);
    const folders = [];
    for (const path of request.manifest.ENV_CONFIG.source.paths) {
        const result = await request.runProcess({
            tool: "infisical",
            args: [
                "export",
                "--format=json",
                `--env=${slug}`,
                `--path=${path}`,
                `--projectId=${projectId}`,
                "--silent",
            ],
            cwd: request.root,
        });
        if (result.status !== "ok") {
            throw new EnvironmentSourceError(`Infisical source ${path} is ${result.status}`, result.status === "missing"
                ? "missing"
                : result.status === "denied"
                    ? "denied"
                    : "unavailable");
        }
        let parsed;
        try {
            parsed = JSON.parse(result.stdout);
        }
        catch {
            throw new EnvironmentSourceError(`Infisical source ${path} returned invalid JSON`, "invalid");
        }
        folders.push({ path, values: normalizeInfisicalExport(parsed) });
    }
    return mergeSourceFolders(folders);
}
/**
 * Source values read from the job environment under their variable names, for
 * `apply --ci` without canonical-source credentials. A workflow maps each value it
 * needs onto its variable name (unprefixed in repository scope); anything unset is
 * treated as missing.
 */
export function jobEnvironmentSource(manifest, environment, environ, options = {}) {
    const values = safeRecord();
    for (const placement of selectPlacements(manifest, environment, options)) {
        const value = environ[placement.variable ?? placement.name];
        if (value && !Object.hasOwn(values, placement.entry.infisicalKey))
            values[placement.entry.infisicalKey] = value;
    }
    return { values, folders: safeRecord(), overrides: [] };
}
