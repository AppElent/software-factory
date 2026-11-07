import { isSafeProjectPath } from "../project/manifest.mjs";
const PROJECT = /^[A-Za-z0-9-]+:[A-Za-z0-9-]+$/u;
const SCRIPT = /^[A-Za-z0-9:_-]+$/u;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function workspaceExpiryAt(expiration, now = new Date()) {
    const relative = /^in ([1-9][0-9]*) (hour|hours|day|days)$/u.exec(expiration);
    if (relative) {
        const count = Number(relative[1]);
        const hours = relative[2]?.startsWith("day") ? count * 24 : count;
        if (hours > 0 && hours <= 24 * 30)
            return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
        return null;
    }
    const absolute = new Date(expiration);
    const delta = absolute.getTime() - now.getTime();
    return Number.isFinite(delta) &&
        delta > 0 &&
        delta <= 30 * 24 * 60 * 60 * 1000
        ? absolute.toISOString()
        : null;
}
export function readWorkspacePolicy(manifest, now = new Date()) {
    const findings = [];
    const raw = manifest.workspace;
    if (raw !== undefined && !isRecord(raw))
        findings.push({
            level: "error",
            code: "workspace.shape",
            message: "workspace must be an object",
        });
    const value = isRecord(raw) ? raw : {};
    if (value.backend !== undefined && !isRecord(value.backend))
        findings.push({
            level: "error",
            code: "workspace.backend",
            message: "workspace.backend must be an object",
        });
    if (value.outputs !== undefined && !isRecord(value.outputs))
        findings.push({
            level: "error",
            code: "workspace.outputs",
            message: "workspace.outputs must be an object",
        });
    if (value.ports !== undefined && !isRecord(value.ports))
        findings.push({
            level: "error",
            code: "workspace.ports",
            message: "workspace.ports must be an object",
        });
    const backend = isRecord(value.backend) ? value.backend : {};
    const outputs = isRecord(value.outputs) ? value.outputs : {};
    const ports = isRecord(value.ports) ? value.ports : {};
    const mode = backend.mode ?? "none";
    if (!["none", "local", "cloud"].includes(String(mode)))
        findings.push({
            level: "error",
            code: "workspace.backend.mode",
            message: "workspace.backend.mode must be none, local, or cloud",
        });
    const project = typeof backend.project === "string" ? backend.project : undefined;
    if (mode !== "none" && (!project || !PROJECT.test(project)))
        findings.push({
            level: "error",
            code: "workspace.backend.project",
            message: "Local and cloud workspaces require a team:project reference",
        });
    if (mode === "cloud" &&
        (typeof (backend.expiration ?? "in 5 days") !== "string" ||
            workspaceExpiryAt(String(backend.expiration ?? "in 5 days"), now) ===
                null))
        findings.push({
            level: "error",
            code: "workspace.backend.expiration",
            message: "Cloud expiration must be a future ISO timestamp or in N hours/days, at most 30 days",
        });
    for (const name of ["scopedCredential", "push"])
        if (backend[name] !== undefined && typeof backend[name] !== "boolean")
            findings.push({
                level: "error",
                code: `workspace.backend.${name}`,
                message: `workspace.backend.${name} must be boolean`,
            });
    if (value.install !== undefined && typeof value.install !== "boolean")
        findings.push({
            level: "error",
            code: "workspace.install",
            message: "workspace.install must be boolean",
        });
    if (value.buildScripts !== undefined &&
        (!Array.isArray(value.buildScripts) ||
            value.buildScripts.some((item) => typeof item !== "string" || !SCRIPT.test(item))))
        findings.push({
            level: "error",
            code: "workspace.buildScripts",
            message: "workspace.buildScripts must contain package script names",
        });
    if (value.seedScript !== undefined &&
        (typeof value.seedScript !== "string" || !SCRIPT.test(value.seedScript)))
        findings.push({
            level: "error",
            code: "workspace.seedScript",
            message: "workspace.seedScript must be a package script name",
        });
    const safeOutput = (name, fallback) => {
        const candidate = outputs[name] ?? fallback;
        if (candidate === undefined)
            return undefined;
        if (typeof candidate !== "string" || !isSafeProjectPath(candidate)) {
            findings.push({
                level: "error",
                code: `workspace.outputs.${name}`,
                message: `workspace.outputs.${name} must stay inside the project`,
            });
            return fallback;
        }
        return candidate;
    };
    const mobileUrlName = outputs.mobileUrlName ?? "EXPO_PUBLIC_CONVEX_URL";
    if (typeof mobileUrlName !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(mobileUrlName))
        findings.push({
            level: "error",
            code: "workspace.outputs.mobileUrlName",
            message: "workspace.outputs.mobileUrlName must be an environment name",
        });
    const port = (name) => {
        const candidate = ports[name];
        if (candidate === undefined)
            return undefined;
        if (!Number.isInteger(candidate) ||
            Number(candidate) < 1024 ||
            Number(candidate) > 65535) {
            findings.push({
                level: "error",
                code: `workspace.ports.${name}`,
                message: `${name} port must be an integer from 1024 through 65535`,
            });
            return undefined;
        }
        return Number(candidate);
    };
    return {
        policy: {
            backend: {
                mode: ["none", "local", "cloud"].includes(String(mode))
                    ? mode
                    : "none",
                project,
                expiration: typeof backend.expiration === "string"
                    ? backend.expiration
                    : "in 5 days",
                scopedCredential: backend.scopedCredential !== false,
                push: backend.push !== false,
            },
            install: value.install !== false,
            buildScripts: Array.isArray(value.buildScripts)
                ? value.buildScripts.filter((item) => typeof item === "string")
                : [],
            seedScript: typeof value.seedScript === "string" ? value.seedScript : undefined,
            outputs: {
                rootEnv: safeOutput("rootEnv", ".env.local") ?? ".env.local",
                mobileEnv: safeOutput("mobileEnv"),
                mobileUrlName: typeof mobileUrlName === "string"
                    ? mobileUrlName
                    : "EXPO_PUBLIC_CONVEX_URL",
            },
            ports: { web: port("web"), mobile: port("mobile") },
        },
        findings,
    };
}
