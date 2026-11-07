import { join } from "node:path";
import { assertSafeProjectPath } from "./files.mjs";
function mapFailure(status) {
    return {
        status: status === "failed" ? "unavailable" : status,
        names: [],
        values: null,
    };
}
function convexCommand(destination, verb, name) {
    if (destination.target === "preview-default") {
        const args = ["env", "default", verb];
        if (name)
            args.push(name);
        args.push("--type", "preview");
        if (destination.project)
            args.push("--project", destination.project);
        return args;
    }
    const target = destination.deployment ??
        (destination.target === "production" ? "prod" : destination.target);
    const args = ["env", verb];
    if (name)
        args.push(name);
    args.push("--deployment", target);
    return args;
}
function githubArgs(config, destination) {
    const args = destination.scope === "repo" ? [] : ["--env", destination.scope];
    if (config.github?.repository)
        args.push("--repo", config.github.repository);
    return args;
}
export async function readRemoteDestination(request) {
    const { destination, runProcess } = request;
    if (destination.kind === "convex") {
        const result = await runProcess({
            tool: "convex",
            args: [...convexCommand(destination, "list"), "--names-only"],
            cwd: request.root,
            removeEnv: ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"],
        });
        if (result.status !== "ok")
            return mapFailure(result.status);
        return {
            status: "ok",
            names: result.stdout
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            values: null,
        };
    }
    if (destination.kind === "worker") {
        const result = await runProcess({
            tool: "wrangler",
            args: [
                "secret",
                "list",
                "--name",
                destination.worker,
                "--format",
                "json",
            ],
            cwd: request.root,
        });
        if (result.status !== "ok")
            return mapFailure(result.status);
        try {
            const start = result.stdout.indexOf("[");
            const parsed = JSON.parse(start >= 0 ? result.stdout.slice(start) : "[]");
            return {
                status: "ok",
                names: parsed.flatMap((item) => typeof item.name === "string" ? [item.name] : []),
                values: null,
            };
        }
        catch {
            return { status: "unavailable", names: [], values: null };
        }
    }
    if (destination.kind === "github") {
        if (request.ci) {
            // The job holds the values, so public ones can be compared with the source.
            const names = request.expectedNames.filter((name) => Boolean(request.environ[name]));
            return { status: "ok", names, values: Object.fromEntries(names.map((name) => [name, request.environ[name]])) };
        }
        const scope = githubArgs(request.manifest.ENV_CONFIG, destination);
        const [secrets, variables] = await Promise.all([
            runProcess({
                tool: "gh",
                args: ["secret", "list", ...scope, "--json", "name"],
                cwd: request.root,
            }),
            runProcess({
                tool: "gh",
                args: ["variable", "list", ...scope, "--json", "name,value"],
                cwd: request.root,
            }),
        ]);
        if (secrets.status !== "ok" || variables.status !== "ok")
            return mapFailure(secrets.status === "denied" || variables.status === "denied"
                ? "denied"
                : secrets.status === "missing" || variables.status === "missing"
                    ? "missing"
                    : "failed");
        try {
            const secretRows = secrets.status === "ok"
                ? JSON.parse(secrets.stdout)
                : [];
            const variableRows = variables.status === "ok"
                ? JSON.parse(variables.stdout)
                : [];
            return {
                status: "ok",
                names: [
                    ...secretRows.map((row) => row.name),
                    ...variableRows.map((row) => row.name),
                ],
                values: Object.fromEntries(variableRows.map((row) => [row.name, row.value])),
            };
        }
        catch {
            return { status: "unavailable", names: [], values: null };
        }
    }
    const mobilePath = request.manifest.ENV_CONFIG.mobile?.path;
    if (mobilePath)
        await assertSafeProjectPath(request.root, mobilePath);
    const cwd = mobilePath ? join(request.root, mobilePath) : request.root;
    const result = await runProcess({
        tool: "eas",
        args: [
            "env:list",
            "--environment",
            destination.environment,
            "--format",
            "short",
        ],
        cwd,
    });
    if (result.status !== "ok")
        return mapFailure(result.status);
    const output = result.stdout.replace(/\\x1b\\[[0-9;]*m/g, "").trim();
    if (!output || /no (?:environment )?variables found/i.test(output)) {
        return { status: "ok", names: [], values: null };
    }
    const names = request.expectedNames.filter((name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|\\s)${escaped}(\\s*=|\\s{2,}|$)`, "m").test(output);
    });
    if (names.length === 0) {
        return { status: "unavailable", names: [], values: null };
    }
    return { status: "ok", names, values: null };
}
export async function writeRemotePlacement(root, config, placement, value, runProcess) {
    const destination = placement.destination;
    if (destination.kind === "file")
        return "ok";
    let result;
    if (destination.kind === "convex")
        result = await runProcess({
            tool: "convex",
            args: convexCommand(destination, "set", placement.name),
            cwd: root,
            input: value,
            removeEnv: ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"],
        });
    else if (destination.kind === "worker")
        result = await runProcess({
            tool: "wrangler",
            args: ["secret", "bulk", "--name", destination.worker],
            cwd: root,
            input: JSON.stringify({ [placement.name]: value }),
        });
    else if (destination.kind === "github")
        result = await runProcess({
            tool: "gh",
            args: [
                placement.entry.secret ? "secret" : "variable",
                "set",
                placement.name,
                ...githubArgs(config, destination),
            ],
            cwd: root,
            input: value,
        });
    else {
        if (config.mobile?.path)
            await assertSafeProjectPath(root, config.mobile.path);
        result = await runProcess({
            tool: "eas",
            args: [
                "env:create",
                "--name",
                placement.name,
                "--value",
                value,
                "--environment",
                destination.environment,
                "--visibility",
                placement.entry.secret ? "secret" : "plaintext",
                "--non-interactive",
                "--force",
            ],
            cwd: config.mobile?.path ? join(root, config.mobile.path) : root,
        });
    }
    return result.status === "ok" ? "ok" : "failed";
}
export async function removeRemoteName(root, config, destination, name, runProcess) {
    void config;
    let result;
    if (destination.kind === "convex")
        result = await runProcess({
            tool: "convex",
            args: convexCommand(destination, "remove", name),
            cwd: root,
            removeEnv: ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"],
        });
    else if (destination.kind === "worker")
        result = await runProcess({
            tool: "wrangler",
            args: ["secret", "delete", name, "--name", destination.worker, "--force"],
            cwd: root,
        });
    else
        return "failed";
    return result.status === "ok" ? "ok" : "failed";
}
