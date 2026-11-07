import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, writeFile, } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readWorkspacePolicy } from "./policy.mjs";
export function defaultWorkspaceStateRoot(environ = process.env) {
    if (platform() === "win32")
        return join(environ.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Appelent", "dev", "workspaces");
    if (platform() === "darwin")
        return join(homedir(), "Library", "Application Support", "Appelent", "dev", "workspaces");
    return join(environ.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "appelent", "dev", "workspaces");
}
function checkedId(id) {
    if (!/^[a-f0-9]{24}$/u.test(id))
        throw new Error("Invalid workspace id");
    return id;
}
export const ledgerPath = (stateRoot, id) => join(stateRoot, "ledgers", `${checkedId(id)}.json`);
const lockPath = (stateRoot, id) => join(stateRoot, "locks", `${checkedId(id)}.lock`);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]));
}
function safeRelativePath(value) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > 1024 ||
        isAbsolute(value) ||
        /^[A-Za-z]:[\\/]/u.test(value) ||
        value.includes("\0"))
        return false;
    const normalized = normalize(value);
    return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}
function validateLedger(value, id) {
    if (!isRecord(value) || value.schemaVersion !== 1)
        throw new Error("Workspace ledger is invalid");
    const workspace = value.workspace;
    if (!isRecord(workspace) ||
        workspace.id !== id ||
        typeof workspace.repositoryPath !== "string" ||
        workspace.repositoryPath.length === 0 ||
        workspace.repositoryPath.includes("\0") ||
        typeof workspace.worktreePath !== "string" ||
        workspace.worktreePath.length === 0 ||
        workspace.worktreePath.includes("\0") ||
        typeof workspace.repositoryFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(workspace.repositoryFingerprint) ||
        typeof workspace.hostFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(workspace.hostFingerprint))
        throw new Error("Workspace ledger is invalid");
    if (!["preparing", "ready", "failed", "cleaning", "clean"].includes(String(value.status)) ||
        !timestamp(value.createdAt) ||
        !timestamp(value.updatedAt) ||
        !isRecord(value.policy))
        throw new Error("Workspace ledger is invalid");
    const parsedPolicy = readWorkspacePolicy({
        workspace: value.policy,
    }, new Date(value.createdAt));
    if (parsedPolicy.findings.some((item) => item.level === "error") ||
        !isDeepStrictEqual(canonical(parsedPolicy.policy), canonical(value.policy)))
        throw new Error("Workspace ledger is invalid");
    if (!Array.isArray(value.resources) ||
        !Array.isArray(value.steps) ||
        !Array.isArray(value.generatedFiles))
        throw new Error("Workspace ledger is invalid");
    for (const resource of value.resources) {
        if (!isRecord(resource) ||
            !["convex-deployment", "convex-token", "process", "port"].includes(String(resource.kind)) ||
            typeof resource.id !== "string" ||
            resource.id.length === 0 ||
            resource.id.length > 512 ||
            /[\0\r\n]/u.test(resource.id) ||
            typeof resource.owned !== "boolean" ||
            ![
                "active",
                "removed",
                "retained",
                "pending-expiry",
                "inaccessible",
                "absent",
            ].includes(String(resource.status)) ||
            !["delete", "expiry", "stop", "release"].includes(String(resource.cleanup)) ||
            (resource.expiresAt !== undefined && !timestamp(resource.expiresAt)) ||
            (resource.metadata !== undefined &&
                (!isRecord(resource.metadata) ||
                    Object.values(resource.metadata).some((item) => typeof item !== "string" &&
                        typeof item !== "number" &&
                        typeof item !== "boolean"))))
            throw new Error("Workspace ledger is invalid");
    }
    const stepIds = new Set();
    for (const step of value.steps) {
        if (!isRecord(step) ||
            ![
                "prerequisites",
                "install",
                "build",
                "environment-source",
                "backend",
                "backend-environment",
                "scoped-credential",
                "push",
                "client-outputs",
                "seed",
                "readiness",
            ].includes(String(step.id)) ||
            stepIds.has(String(step.id)) ||
            !["pending", "complete", "failed", "skipped"].includes(String(step.status)) ||
            !Number.isSafeInteger(step.attempts) ||
            Number(step.attempts) < 0 ||
            !timestamp(step.updatedAt) ||
            (step.evidence !== undefined &&
                (!Array.isArray(step.evidence) ||
                    step.evidence.some((item) => typeof item !== "string"))))
            throw new Error("Workspace ledger is invalid");
        stepIds.add(String(step.id));
    }
    for (const file of value.generatedFiles)
        if (!isRecord(file) ||
            !safeRelativePath(file.path) ||
            typeof file.digest !== "string" ||
            !/^[a-f0-9]{64}$/u.test(file.digest) ||
            typeof file.createdByWorkspace !== "boolean" ||
            !["active", "removed", "modified", "missing"].includes(String(file.status)))
            throw new Error("Workspace ledger is invalid");
    if (value.appName !== undefined && typeof value.appName !== "string")
        throw new Error("Workspace ledger is invalid");
    if (value.readiness !== undefined) {
        const readiness = value.readiness;
        if (!isRecord(readiness) ||
            !["none", "local", "cloud"].includes(String(readiness.backend)) ||
            (readiness.reference !== undefined &&
                typeof readiness.reference !== "string") ||
            (readiness.publicHostname !== undefined &&
                typeof readiness.publicHostname !== "string") ||
            !Array.isArray(readiness.commands) ||
            readiness.commands.some((item) => typeof item !== "string"))
            throw new Error("Workspace ledger is invalid");
    }
    return value;
}
export async function readWorkspaceLedger(stateRoot, id) {
    checkedId(id);
    try {
        return validateLedger(JSON.parse(await readFile(ledgerPath(stateRoot, id), "utf8")), id);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw new Error("Workspace ledger is unreadable");
    }
}
export async function writeWorkspaceLedger(stateRoot, ledger) {
    validateLedger(ledger, ledger.workspace.id);
    const path = ledgerPath(stateRoot, ledger.workspace.id);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
        });
        await rename(temporary, path);
    }
    finally {
        await rm(temporary, { force: true }).catch(() => undefined);
    }
}
export class WorkspaceLockedError extends Error {
    constructor() {
        super("Workspace preparation is already running");
        this.name = "WorkspaceLockedError";
    }
}
export async function withWorkspaceLock(stateRoot, identity, task) {
    const path = lockPath(stateRoot, identity.id);
    await mkdir(dirname(path), { recursive: true });
    let handle;
    try {
        handle = await open(path, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify({
            schemaVersion: 1,
            workspaceId: identity.id,
            pid: process.pid,
            host: hostname(),
            createdAt: new Date().toISOString(),
        })}\n`);
    }
    catch (error) {
        if (error.code === "EEXIST")
            throw new WorkspaceLockedError();
        throw error;
    }
    try {
        return await task();
    }
    finally {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
    }
}
export async function listWorkspaceLedgers(stateRoot) {
    const folder = join(stateRoot, "ledgers");
    let names;
    try {
        names = await readdir(folder);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
    const ledgers = [];
    for (const name of names
        .filter((item) => /^[a-f0-9]{24}\.json$/u.test(item))
        .sort()) {
        const ledger = await readWorkspaceLedger(stateRoot, name.slice(0, -5));
        if (ledger)
            ledgers.push(ledger);
    }
    return ledgers;
}
