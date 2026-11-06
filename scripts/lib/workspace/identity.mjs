import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
function normalizeIdentityPath(value) {
    const normalized = resolve(value).replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
async function gitPath(root, args, run) {
    const result = await run({ tool: "git", args, cwd: root });
    if (result.status !== "ok" || !result.stdout.trim())
        throw new Error("Git workspace identity is unavailable");
    return result.stdout.trim().split(/\r?\n/u)[0] ?? "";
}
export async function resolveWorkspaceIdentity(root, run) {
    const worktreeRaw = await gitPath(root, ["rev-parse", "--show-toplevel"], run);
    const commonRaw = await gitPath(root, ["rev-parse", "--git-common-dir"], run);
    const worktreePath = await realpath(isAbsolute(worktreeRaw) ? worktreeRaw : resolve(root, worktreeRaw));
    const commonPath = await realpath(isAbsolute(commonRaw) ? commonRaw : resolve(root, commonRaw));
    const repositoryPath = commonPath.endsWith(".git")
        ? dirname(commonPath)
        : commonPath;
    const repositoryFingerprint = createHash("sha256")
        .update(normalizeIdentityPath(repositoryPath))
        .digest("hex");
    const hostFingerprint = createHash("sha256")
        .update(`${hostname()}\0${userInfo().username}`)
        .digest("hex");
    const id = createHash("sha256")
        .update(`${hostFingerprint}\0${repositoryFingerprint}\0${normalizeIdentityPath(worktreePath)}`)
        .digest("hex")
        .slice(0, 24);
    return {
        id,
        repositoryPath,
        worktreePath,
        repositoryFingerprint,
        hostFingerprint,
    };
}
export function deriveDeploymentReference(identity, editor = "workspace") {
    const clean = (value, max) => {
        const text = value
            .toLowerCase()
            .replace(/[^a-z0-9-]+/gu, "-")
            .replace(/-+/gu, "-")
            .replace(/^-|-$/gu, "") || "workspace";
        return text.length <= max
            ? text
            : `${text.slice(0, max - 9).replace(/-$/u, "")}-${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
    };
    return `dev/${clean(editor, 24)}/${clean(identity.id, 48)}`;
}
