import { access, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertSafeProjectPath } from "../env/files.mjs";
import { digestText, readProjectText } from "./dotenv.mjs";
import { resolveWorkspaceIdentity } from "./identity.mjs";
import { defaultWorkspaceStateRoot, listWorkspaceLedgers, readWorkspaceLedger, withWorkspaceLock, writeWorkspaceLedger, } from "./ledger.mjs";
import { runWorkspaceCommand } from "./process.mjs";
import { cleanupProviderResource } from "./provider.mjs";
async function pathState(path) {
    try {
        await access(path);
        return "exists";
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "ENOTDIR")
            return "missing";
        return "inaccessible";
    }
}
function safeRuntimePath(stateRoot, id) {
    if (!/^[a-f0-9]{24}$/u.test(id))
        throw new Error("Invalid workspace id");
    const path = resolve(stateRoot, "runtime", id);
    const fromRoot = relative(resolve(stateRoot), path);
    if (fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        isAbsolute(fromRoot))
        throw new Error("Unsafe runtime path");
    return path;
}
async function cleanLedger(ledger, stateRoot, dependencies) {
    const run = dependencies.runCommand ?? runWorkspaceCommand;
    const findings = [];
    const operations = [];
    return withWorkspaceLock(stateRoot, ledger.workspace, async () => {
        const fresh = await readWorkspaceLedger(stateRoot, ledger.workspace.id);
        if (!fresh)
            throw new Error("Workspace ledger disappeared while acquiring its lock");
        ledger = fresh;
        const fail = (code, message) => ({
            command: "clean",
            workspaceId: ledger.workspace.id,
            status: "failed",
            operations: [],
            findings: [{ level: "error", code, message }],
        });
        if ((await pathState(ledger.workspace.worktreePath)) === "inaccessible")
            return fail("workspace.worktree.inaccessible", "Workspace checkout is inaccessible; resources were retained");
        try {
            const actual = dependencies.identity ??
                (await resolveWorkspaceIdentity((await pathState(ledger.workspace.worktreePath)) === "exists"
                    ? ledger.workspace.worktreePath
                    : ledger.workspace.repositoryPath, run));
            const normalized = (path) => process.platform === "win32"
                ? resolve(path).toLowerCase()
                : resolve(path);
            if (actual.repositoryFingerprint !==
                ledger.workspace.repositoryFingerprint ||
                actual.hostFingerprint !== ledger.workspace.hostFingerprint ||
                normalized(actual.repositoryPath) !==
                    normalized(ledger.workspace.repositoryPath) ||
                ((await pathState(ledger.workspace.worktreePath)) === "exists" &&
                    actual.id !== ledger.workspace.id))
                return fail("workspace.identity.mismatch", "Recorded workspace identity could not be verified; resources were retained");
        }
        catch {
            return fail("workspace.identity.unavailable", "Repository identity is unavailable; resources were retained for retry");
        }
        ledger.status = "cleaning";
        ledger.updatedAt = (dependencies.now?.() ?? new Date()).toISOString();
        await writeWorkspaceLedger(stateRoot, ledger);
        const worktreeState = await pathState(ledger.workspace.worktreePath);
        const repositoryState = await pathState(ledger.workspace.repositoryPath);
        const worktreePresent = worktreeState === "exists";
        const repositoryPresent = repositoryState === "exists";
        if (worktreeState === "inaccessible")
            findings.push({
                level: "error",
                code: "workspace.worktree.inaccessible",
                message: "Workspace checkout is inaccessible; resources were retained",
            });
        if (!repositoryPresent)
            findings.push({
                level: "error",
                code: "workspace.repository.missing",
                message: "Parent repository is missing; provider ownership is retained for manual resolution",
            });
        if (repositoryPresent && worktreeState !== "inaccessible") {
            const order = {
                "convex-token": 0,
                process: 1,
                port: 2,
                "convex-deployment": 3,
            };
            for (const resource of [...ledger.resources].sort((a, b) => order[a.kind] - order[b.kind])) {
                const updated = await cleanupProviderResource(worktreePresent
                    ? ledger.workspace.worktreePath
                    : ledger.workspace.repositoryPath, join(safeRuntimePath(stateRoot, ledger.workspace.id), "cleanup"), resource, run, dependencies.now?.() ?? new Date());
                ledger.resources = ledger.resources.map((item) => item.kind === resource.kind && item.id === resource.id
                    ? updated
                    : item);
                operations.push({
                    action: updated.status === "removed" || updated.status === "absent"
                        ? "remove"
                        : "retain",
                    target: `${updated.kind}:${updated.id}`,
                    detail: updated.status,
                });
                ledger.updatedAt = (dependencies.now?.() ?? new Date()).toISOString();
                await writeWorkspaceLedger(stateRoot, ledger);
            }
        }
        for (const file of ledger.generatedFiles) {
            if (!file.createdByWorkspace || file.status !== "active")
                continue;
            if (!worktreePresent) {
                file.status = "missing";
                continue;
            }
            try {
                await assertSafeProjectPath(ledger.workspace.worktreePath, file.path);
                const current = await readProjectText(ledger.workspace.worktreePath, file.path);
                if (!current)
                    file.status = "missing";
                else if (digestText(current) !== file.digest) {
                    file.status = "modified";
                    findings.push({
                        level: "warning",
                        code: "workspace.file.modified",
                        message: `${file.path} was modified and was retained`,
                    });
                }
                else {
                    await rm(join(ledger.workspace.worktreePath, file.path));
                    file.status = "removed";
                    operations.push({ action: "remove", target: file.path });
                }
            }
            catch {
                findings.push({
                    level: "error",
                    code: "workspace.file.unavailable",
                    message: `${file.path} could not be verified and was retained`,
                });
            }
        }
        const pending = ledger.resources.filter((item) => item.owned && !["removed", "absent"].includes(item.status));
        for (const resource of pending)
            findings.push({
                level: resource.status === "pending-expiry" ? "warning" : "error",
                code: `workspace.resource.${resource.status}`,
                message: `${resource.kind}:${resource.id} remains ${resource.status}`,
            });
        if (pending.length === 0 &&
            !findings.some((item) => item.level === "error")) {
            try {
                await assertSafeProjectPath(stateRoot, `runtime/${ledger.workspace.id}`);
                await rm(safeRuntimePath(stateRoot, ledger.workspace.id), {
                    recursive: true,
                    force: true,
                });
            }
            catch {
                findings.push({
                    level: "error",
                    code: "workspace.runtime.unavailable",
                    message: "Local recovery data could not be safely removed; retained for retry",
                });
            }
        }
        ledger.status =
            pending.length === 0 && !findings.some((item) => item.level === "error")
                ? "clean"
                : "failed";
        ledger.updatedAt = (dependencies.now?.() ?? new Date()).toISOString();
        await writeWorkspaceLedger(stateRoot, ledger);
        return {
            command: "clean",
            workspaceId: ledger.workspace.id,
            status: ledger.status === "clean" ? "clean" : "failed",
            operations,
            findings,
        };
    });
}
export async function cleanWorkspace(options) {
    const dependencies = options.dependencies ?? {};
    const run = dependencies.runCommand ?? runWorkspaceCommand;
    const stateRoot = dependencies.stateRoot ?? defaultWorkspaceStateRoot(dependencies.environ);
    const identity = dependencies.identity ??
        (await resolveWorkspaceIdentity(options.root, run));
    const id = options.workspaceId ?? identity.id;
    const ledger = await readWorkspaceLedger(stateRoot, id);
    if (ledger &&
        options.workspaceId &&
        ledger.workspace.repositoryFingerprint !== identity.repositoryFingerprint)
        return {
            command: "clean",
            workspaceId: id,
            status: "failed",
            operations: [],
            findings: [
                {
                    level: "error",
                    code: "workspace.identity.mismatch",
                    message: "The requested workspace does not belong to this repository",
                },
            ],
        };
    if (!ledger)
        return {
            command: "clean",
            workspaceId: id,
            status: "clean",
            operations: [],
            findings: [
                {
                    level: "note",
                    code: "workspace.absent",
                    message: "No workspace resources are recorded",
                },
            ],
        };
    return cleanLedger(ledger, stateRoot, dependencies);
}
export async function gcWorkspaces(options) {
    const dependencies = options.dependencies ?? {};
    const stateRoot = dependencies.stateRoot ?? defaultWorkspaceStateRoot(dependencies.environ);
    const ledgers = await listWorkspaceLedgers(stateRoot);
    const stale = [];
    const inaccessible = [];
    for (const ledger of ledgers) {
        const state = await pathState(ledger.workspace.worktreePath);
        if (state === "missing" && ledger.status !== "clean")
            stale.push(ledger);
        else if (state === "inaccessible")
            inaccessible.push(ledger);
    }
    const operations = stale.map((ledger) => ({
        action: options.apply ? "remove" : "retain",
        target: ledger.workspace.id,
        detail: options.apply
            ? "reconcile stale workspace"
            : "would reconcile stale workspace",
    }));
    const findings = inaccessible.map((ledger) => ({
        level: "error",
        code: "workspace.worktree.inaccessible",
        message: `Workspace ${ledger.workspace.id} is inaccessible; retained for retry`,
    }));
    let cleanupFailed = false;
    if (options.apply) {
        for (const ledger of stale) {
            try {
                const result = await cleanLedger(ledger, stateRoot, dependencies);
                findings.push(...result.findings);
                if (result.status === "failed")
                    cleanupFailed = true;
            }
            catch {
                cleanupFailed = true;
                findings.push({
                    level: "error",
                    code: "workspace.cleanup.unavailable",
                    message: `Workspace ${ledger.workspace.id} could not be reconciled; retained for retry`,
                });
            }
        }
    }
    return {
        command: options.apply ? "gc apply" : "gc dry-run",
        status: cleanupFailed || findings.some((item) => item.level === "error")
            ? "failed"
            : "planned",
        operations,
        findings,
    };
}
