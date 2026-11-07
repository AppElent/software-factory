import { join } from "node:path";
import { loadManifest, MANIFEST_FILE } from "../project/manifest.mjs";
import { cleanWorkspace, gcWorkspaces } from "./cleanup.mjs";
import { readWorkspacePolicy, workspaceExpiryAt } from "./policy.mjs";
import { prepareWorkspace } from "./prepare.mjs";
function bool(value) {
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return undefined;
}
function parse(args) {
    const parsed = {
        json: false,
        dryRun: false,
        apply: false,
        help: false,
    };
    const positional = [];
    for (let index = 0; index < args.length; index += 1) {
        const raw = args[index] ?? "";
        const equal = raw.indexOf("=");
        const option = equal >= 0 ? raw.slice(0, equal) : raw;
        const inline = equal >= 0 ? raw.slice(equal + 1) : undefined;
        const value = () => inline ?? args[++index];
        switch (option) {
            case "--json":
                parsed.json = true;
                break;
            case "--dry-run":
                parsed.dryRun = true;
                break;
            case "--apply":
                parsed.apply = true;
                break;
            case "--help":
            case "-h":
                parsed.help = true;
                break;
            case "--editor":
                parsed.editor = value();
                break;
            case "--backend":
            case "--convex": {
                const candidate = value();
                if (candidate === "none" ||
                    candidate === "local" ||
                    candidate === "cloud")
                    parsed.backend = candidate;
                else
                    parsed.error = "--backend must be none, local, or cloud";
                break;
            }
            case "--project":
                parsed.project = value();
                break;
            case "--expiration":
                parsed.expiration = value();
                break;
            case "--days": {
                const days = Number(value());
                if (!Number.isSafeInteger(days) || days < 1 || days > 30)
                    parsed.error = "--days must be from 1 through 30";
                else
                    parsed.expiration = `in ${days} ${days === 1 ? "day" : "days"}`;
                break;
            }
            case "--install":
                parsed.install = bool(value());
                if (parsed.install === undefined)
                    parsed.error = "--install must be true or false";
                break;
            case "--push":
                parsed.push = bool(value());
                if (parsed.push === undefined)
                    parsed.error = "--push must be true or false";
                break;
            case "--scoped-key":
                parsed.scopedCredential = bool(value());
                if (parsed.scopedCredential === undefined)
                    parsed.error = "--scoped-key must be true or false";
                break;
            case "--seed":
                parsed.seed = bool(value());
                if (parsed.seed === undefined)
                    parsed.error = "--seed must be true or false";
                break;
            case "--web-port":
                parsed.webPort = Number(value());
                break;
            case "--mobile-port":
                parsed.mobilePort = Number(value());
                break;
            default:
                if (raw.startsWith("-"))
                    parsed.error = `Unsupported option ${raw}`;
                else
                    positional.push(raw);
        }
    }
    parsed.command = positional[0];
    if (positional.length > 1)
        parsed.error = "Too many positional arguments";
    return parsed;
}
function usage() {
    return [
        "Usage:",
        "  node scripts/workspace.mjs prepare [--backend none|local|cloud] [--project team:project] [--editor host] [--dry-run] [--json]",
        "  node scripts/workspace.mjs clean [--json]",
        "  node scripts/workspace.mjs gc (--dry-run|--apply) [--json]",
    ].join("\n");
}
function failed(command, code, message) {
    return {
        command,
        status: "failed",
        operations: [],
        findings: [{ level: "error", code, message }],
    };
}
function overridePolicy(policy, parsed) {
    return {
        ...policy,
        backend: {
            ...policy.backend,
            ...(parsed.backend === undefined ? {} : { mode: parsed.backend }),
            ...(parsed.project === undefined ? {} : { project: parsed.project }),
            ...(parsed.expiration === undefined
                ? {}
                : { expiration: parsed.expiration }),
            ...(parsed.push === undefined ? {} : { push: parsed.push }),
            ...(parsed.scopedCredential === undefined
                ? {}
                : { scopedCredential: parsed.scopedCredential }),
        },
        ...(parsed.install === undefined ? {} : { install: parsed.install }),
        ...(parsed.seed === false ? { seedScript: undefined } : {}),
        ports: {
            ...policy.ports,
            ...(parsed.webPort === undefined ? {} : { web: parsed.webPort }),
            ...(parsed.mobilePort === undefined ? {} : { mobile: parsed.mobilePort }),
        },
    };
}
function emit(options, json, result, exitCode) {
    const io = options.io ?? {
        writeOut: (value) => process.stdout.write(value),
        writeErr: (value) => process.stderr.write(value),
    };
    if (json)
        io.writeOut(`${JSON.stringify({ schemaVersion: 1, command: "workspace", ok: exitCode === 0, exitCode, projectRoot: options.root, result }, null, 2)}\n`);
    else {
        const lines = [`workspace ${result.command}: ${result.status}`];
        for (const operation of result.operations)
            lines.push(`  ${operation.action} ${operation.target}${operation.detail ? ` — ${operation.detail}` : ""}`);
        for (const finding of result.findings)
            lines.push(`  ${finding.level === "error" ? "✗" : finding.level === "warning" ? "!" : "·"} ${finding.message}`);
        io[result.findings.some((item) => item.level === "error")
            ? "writeErr"
            : "writeOut"](`${lines.join("\n")}\n`);
    }
}
export async function runWorkspaceCli(args, options) {
    const parsed = parse(args);
    const finish = (result, code) => {
        emit(options, parsed.json, result, code);
        return { exitCode: code };
    };
    if (parsed.help || args.length === 0)
        return finish({
            command: "help",
            status: "planned",
            operations: [],
            findings: [{ level: "note", code: "usage", message: usage() }],
        }, 0);
    if (parsed.error ||
        !parsed.command ||
        !["prepare", "clean", "gc"].includes(parsed.command))
        return finish(failed(parsed.command ?? "unknown", "usage", parsed.error ?? "Expected prepare, clean, or gc"), 2);
    try {
        if (parsed.command === "gc") {
            if (parsed.apply === parsed.dryRun)
                return finish(failed("gc", "usage", "gc requires exactly one of --dry-run or --apply"), 2);
            const result = await gcWorkspaces({
                apply: parsed.apply,
                dependencies: options.dependencies,
            });
            return finish(result, result.status === "failed" ? 1 : 0);
        }
        if (parsed.command === "clean") {
            if (parsed.apply || parsed.dryRun)
                return finish(failed("clean", "usage", "clean does not accept --apply or --dry-run"), 2);
            const result = await cleanWorkspace({
                root: options.root,
                dependencies: options.dependencies,
            });
            return finish(result, result.status === "failed" ? 1 : 0);
        }
        const manifest = options.dependencies?.manifest ??
            (await loadManifest(join(options.root, MANIFEST_FILE))).manifest;
        const read = readWorkspacePolicy(manifest);
        if (read.findings.some((item) => item.level === "error"))
            return finish({
                command: "prepare",
                status: "failed",
                operations: [],
                findings: read.findings,
            }, 1);
        const policy = overridePolicy(read.policy, parsed);
        const portFindings = [];
        for (const [name, port] of Object.entries(policy.ports))
            if (port !== undefined &&
                (!Number.isInteger(port) || port < 1024 || port > 65535))
                portFindings.push({
                    level: "error",
                    code: `workspace.ports.${name}`,
                    message: `${name} port must be from 1024 through 65535`,
                });
        if (policy.backend.mode === "cloud" &&
            workspaceExpiryAt(policy.backend.expiration) === null)
            portFindings.push({
                level: "error",
                code: "workspace.backend.expiration",
                message: "Cloud expiration must be a future ISO timestamp or in N hours/days, at most 30 days",
            });
        if (policy.backend.mode !== "none" && !policy.backend.project)
            portFindings.push({
                level: "error",
                code: "workspace.backend.project",
                message: "Selected backend mode requires --project or workspace.backend.project",
            });
        if (parsed.seed === true && !policy.seedScript)
            portFindings.push({
                level: "error",
                code: "workspace.seedScript",
                message: "--seed=true requires workspace.seedScript",
            });
        if (portFindings.length > 0)
            return finish({
                command: "prepare",
                status: "failed",
                operations: [],
                findings: portFindings,
            }, 2);
        if (parsed.dryRun) {
            const operations = [
                ...(policy.install
                    ? [{ action: "run", target: "pnpm install" }]
                    : []),
                ...policy.buildScripts.map((script) => ({
                    action: "run",
                    target: `pnpm run ${script}`,
                })),
                {
                    action: "write",
                    target: "local environment files",
                    detail: "captured canonical source",
                },
                ...(policy.backend.mode === "none"
                    ? []
                    : [
                        {
                            action: "write",
                            target: `${policy.backend.mode} isolated backend`,
                        },
                    ]),
            ];
            return finish({
                command: "prepare dry-run",
                status: "planned",
                operations,
                findings: [],
            }, 0);
        }
        const result = await prepareWorkspace({
            root: options.root,
            manifestPath: options.manifestPath,
            editor: parsed.editor,
            policy,
            dependencies: { ...options.dependencies, manifest },
        });
        return finish(result, result.status === "failed" ? 1 : 0);
    }
    catch {
        return finish(failed(parsed.command, `workspace.${parsed.command}.failed`, `Workspace ${parsed.command} could not complete`), 1);
    }
}
