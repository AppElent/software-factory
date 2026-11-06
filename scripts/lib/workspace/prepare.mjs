import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { runEnvCli } from "../env/cli.mjs";
import { assertSafeProjectPath } from "../env/files.mjs";
import { loadEnvironmentManifest } from "../env/manifest.mjs";
import { runProcess as runEnvironmentProcess } from "../env/process.mjs";
import { loadManifest, MANIFEST_FILE } from "../project/manifest.mjs";
import { digestText, readEnvValues, readProjectText } from "./dotenv.mjs";
import { resolveWorkspaceIdentity } from "./identity.mjs";
import { defaultWorkspaceStateRoot, readWorkspaceLedger, withWorkspaceLock, writeWorkspaceLedger, } from "./ledger.mjs";
import { readWorkspacePolicy } from "./policy.mjs";
import { runWorkspaceCommand } from "./process.mjs";
import { createScopedCredential, PROVIDER_ENV_REMOVALS, prepareBackend, pushBackend, writeClientOutputs, } from "./provider.mjs";
const STEP_IDS = [
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
];
async function available(port) {
    return new Promise((done) => {
        const server = createServer();
        server.unref();
        server.once("error", () => done(false));
        server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => done(true)));
    });
}
function newLedger(identity, policy, now) {
    return {
        schemaVersion: 1,
        workspace: identity,
        status: "preparing",
        createdAt: now,
        updatedAt: now,
        policy,
        steps: STEP_IDS.map((id) => ({
            id,
            status: "pending",
            attempts: 0,
            updatedAt: now,
        })),
        resources: [],
        generatedFiles: [],
    };
}
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function defaultPrepareEnvironment(request) {
    return runEnvCli(["apply", "local", "--only", "file", "--yes"], {
        root: request.root,
        manifestPath: request.manifestPath,
        io: { writeOut: () => undefined, writeErr: () => undefined },
    });
}
async function defaultApplyBackendEnvironment(request) {
    await mkdir(request.isolationRoot, { recursive: true });
    await writeFile(join(request.isolationRoot, "package.json"), `${JSON.stringify({ private: true, dependencies: { convex: "*" } })}\n`, { encoding: "utf8", mode: 0o600 });
    const manifest = await loadEnvironmentManifest(request.root, request.manifestPath);
    const selected = {
        ...manifest,
        placementsFor(environment, context) {
            return manifest.placementsFor(environment, context).map((placement) => placement.destination.kind === "convex"
                ? {
                    ...placement,
                    destination: {
                        kind: "convex",
                        target: request.reference,
                        deployment: request.reference,
                    },
                }
                : placement);
        },
    };
    const runner = async (spec) => {
        if (spec.tool !== "convex")
            return runEnvironmentProcess(spec);
        const result = await request.runCommand({
            tool: "convex",
            args: spec.args,
            cwd: request.isolationRoot,
            packageRoot: request.root,
            input: spec.input,
            removeEnv: [
                ...new Set([...(spec.removeEnv ?? []), ...PROVIDER_ENV_REMOVALS]),
            ],
        });
        if (result.status === "ok")
            return result;
        return {
            status: result.status === "missing" || result.status === "denied"
                ? result.status
                : "failed",
        };
    };
    return runEnvCli(["apply", "local", "--only", "convex", "--yes"], {
        root: request.root,
        manifest: selected,
        io: { writeOut: () => undefined, writeErr: () => undefined },
        dependencies: { runProcess: runner },
    });
}
export async function prepareWorkspace(options) {
    const dependencies = options.dependencies ?? {};
    const run = dependencies.runCommand ?? runWorkspaceCommand;
    const environ = dependencies.environ ?? process.env;
    const now = dependencies.now ?? (() => new Date());
    const stateRoot = dependencies.stateRoot ?? defaultWorkspaceStateRoot(environ);
    const manifest = dependencies.manifest ??
        (await loadManifest(join(options.root, MANIFEST_FILE))).manifest;
    const parsed = readWorkspacePolicy(manifest);
    const policy = options.policy ?? parsed.policy;
    const findings = [...parsed.findings];
    if (findings.some((item) => item.level === "error"))
        return {
            command: "prepare",
            status: "failed",
            operations: [],
            findings,
        };
    for (const path of [policy.outputs.rootEnv, policy.outputs.mobileEnv].filter((value) => Boolean(value)))
        await assertSafeProjectPath(options.root, path);
    const identity = dependencies.identity ??
        (await resolveWorkspaceIdentity(options.root, run));
    return withWorkspaceLock(stateRoot, identity, async () => {
        const ledger = (await readWorkspaceLedger(stateRoot, identity.id)) ??
            newLedger(identity, policy, now().toISOString());
        if (JSON.stringify(ledger.policy) !== JSON.stringify(policy))
            return {
                command: "prepare",
                workspaceId: identity.id,
                status: "failed",
                operations: [],
                findings: [
                    {
                        level: "error",
                        code: "workspace.policy.changed",
                        message: "Workspace policy changed; clean this workspace before preparing it again",
                    },
                ],
            };
        if (ledger.status === "ready") {
            const drift = [];
            for (const file of ledger.generatedFiles) {
                const text = await readProjectText(options.root, file.path);
                if (!text || digestText(text) !== file.digest)
                    drift.push({
                        level: "error",
                        code: "workspace.readiness.drift",
                        message: `${file.path} is missing or changed; clean before preparing again`,
                    });
            }
            if (policy.install && !(await exists(join(options.root, "node_modules"))))
                drift.push({
                    level: "error",
                    code: "workspace.readiness.dependencies",
                    message: "Installed dependencies are missing; clean before preparing again",
                });
            for (const resource of ledger.resources)
                if (resource.expiresAt &&
                    new Date(resource.expiresAt).getTime() <= now().getTime())
                    drift.push({
                        level: "error",
                        code: "workspace.readiness.expired",
                        message: `${resource.kind} lease has expired`,
                    });
            if (drift.length > 0)
                return {
                    command: "prepare",
                    workspaceId: identity.id,
                    status: "failed",
                    operations: [],
                    findings: drift,
                };
            return {
                command: "prepare",
                workspaceId: identity.id,
                status: "ready",
                operations: [{ action: "reuse", target: identity.id }],
                findings,
                readiness: ledger.readiness,
            };
        }
        const operations = [];
        if (ledger.status === "failed") {
            const drift = [];
            for (const file of ledger.generatedFiles) {
                const text = await readProjectText(options.root, file.path);
                if (!text || digestText(text) !== file.digest)
                    drift.push({
                        level: "error",
                        code: "workspace.resume.drift",
                        message: `${file.path} changed after an interrupted preparation; clean before resuming`,
                    });
            }
            if (drift.length > 0)
                return {
                    command: "prepare",
                    workspaceId: identity.id,
                    status: "failed",
                    operations,
                    findings: drift,
                };
        }
        ledger.status = "preparing";
        ledger.updatedAt = now().toISOString();
        await writeWorkspaceLedger(stateRoot, ledger);
        const initiallyPresent = new Map();
        for (const path of [
            policy.outputs.rootEnv,
            policy.outputs.mobileEnv,
        ].filter((value) => Boolean(value)))
            initiallyPresent.set(path, await exists(join(options.root, path)));
        const isManagedEnvironment = (text) => text.startsWith("# Generated by @appelent/dev env apply ") ||
            text.startsWith("# Generated by `pnpm run env:apply ");
        const syncGeneratedFiles = async (requireTracked) => {
            for (const [path, wasPresent] of initiallyPresent) {
                const previous = ledger.generatedFiles.find((item) => item.path === path);
                const text = await readProjectText(options.root, path);
                if (!text) {
                    if (requireTracked && previous)
                        throw new Error(`Tracked generated file disappeared: ${path}`);
                    continue;
                }
                if (!previous && wasPresent && !isManagedEnvironment(text))
                    continue;
                ledger.generatedFiles = [
                    ...ledger.generatedFiles.filter((item) => item.path !== path),
                    {
                        path,
                        digest: digestText(text),
                        createdByWorkspace: previous?.createdByWorkspace ?? !wasPresent,
                        status: "active",
                    },
                ];
            }
        };
        const step = async (id, task) => {
            const record = ledger.steps.find((item) => item.id === id);
            if (!record)
                throw new Error("Workspace ledger step is missing");
            if (record.status === "complete" || record.status === "skipped")
                return;
            record.attempts += 1;
            record.updatedAt = now().toISOString();
            try {
                const evidence = await task();
                await syncGeneratedFiles(true);
                record.status = "complete";
                record.evidence = evidence ?? [];
            }
            catch (error) {
                await syncGeneratedFiles(false);
                record.status = "failed";
                ledger.status = "failed";
                ledger.updatedAt = now().toISOString();
                await writeWorkspaceLedger(stateRoot, ledger);
                throw error;
            }
            ledger.updatedAt = now().toISOString();
            await writeWorkspaceLedger(stateRoot, ledger);
        };
        const refreshGeneratedFiles = async () => syncGeneratedFiles(false);
        const checkpoint = async (resource) => {
            ledger.resources = [
                ...ledger.resources.filter((item) => !(item.kind === resource.kind && item.id === resource.id)),
                resource,
            ];
            ledger.updatedAt = now().toISOString();
            await writeWorkspaceLedger(stateRoot, ledger);
        };
        let backendReference = ledger.resources.find((item) => item.kind === "convex-deployment")?.id;
        let publicUrl;
        let publicHostname;
        try {
            await step("prerequisites", async () => {
                const pnpm = await run({
                    tool: "pnpm",
                    args: ["--version"],
                    cwd: options.root,
                });
                if (pnpm.status !== "ok")
                    throw new Error(`pnpm prerequisite is ${pnpm.status}`);
                return [
                    "package manager available",
                    "registry access validated by install",
                ];
            });
            await step("install", async () => {
                if (!policy.install)
                    return ["disabled by policy"];
                const result = await run({
                    tool: "pnpm",
                    args: ["install"],
                    cwd: options.root,
                    removeEnv: PROVIDER_ENV_REMOVALS,
                });
                if (result.status !== "ok")
                    throw new Error(`Dependency installation failed (${result.status})`);
                operations.push({ action: "run", target: "pnpm install" });
            });
            if (policy.backend.mode !== "none") {
                const convex = await run({
                    tool: "convex",
                    args: ["--version"],
                    cwd: options.root,
                    removeEnv: PROVIDER_ENV_REMOVALS,
                });
                if (convex.status !== "ok")
                    throw new Error(`Convex prerequisite is ${convex.status}`);
            }
            await step("build", async () => {
                for (const script of policy.buildScripts) {
                    const result = await run({
                        tool: "pnpm",
                        args: ["run", script],
                        cwd: options.root,
                        removeEnv: PROVIDER_ENV_REMOVALS,
                    });
                    if (result.status !== "ok")
                        throw new Error(`Build prerequisite ${script} failed (${result.status})`);
                    operations.push({ action: "run", target: `pnpm run ${script}` });
                }
            });
            await step("environment-source", async () => {
                const result = await (dependencies.prepareEnvironment ?? defaultPrepareEnvironment)({ root: options.root, manifestPath: manifest.envManifest });
                if (result.exitCode !== 0)
                    throw new Error("Canonical environment preparation failed");
                for (const [path, wasPresent] of initiallyPresent) {
                    const text = await readProjectText(options.root, path);
                    if (!text)
                        continue;
                    const previous = ledger.generatedFiles.find((item) => item.path === path);
                    ledger.generatedFiles = [
                        ...ledger.generatedFiles.filter((item) => item.path !== path),
                        {
                            path,
                            digest: digestText(text),
                            createdByWorkspace: previous?.createdByWorkspace ?? !wasPresent,
                            status: "active",
                        },
                    ];
                }
                operations.push({
                    action: "write",
                    target: "local environment files",
                    detail: "captured canonical source",
                });
            });
            await step("backend", async () => {
                const backend = await prepareBackend({
                    root: options.root,
                    isolationRoot: join(stateRoot, "runtime", identity.id),
                    identity,
                    policy,
                    run,
                    editor: options.editor ?? "workspace",
                    now: now(),
                    existing: ledger.resources.find((item) => item.kind === "convex-deployment" && item.id === backendReference),
                    checkpoint,
                });
                if (backend) {
                    backendReference = backend.reference;
                    publicUrl = backend.publicUrl;
                    publicHostname = backend.publicHostname;
                    operations.push(backend.operation);
                }
                await refreshGeneratedFiles();
            });
            if (backendReference && !publicUrl) {
                const values = readEnvValues(await readProjectText(options.root, policy.outputs.rootEnv));
                publicUrl = values.VITE_CONVEX_URL ?? values.CONVEX_URL;
                if (publicUrl)
                    publicHostname = new URL(publicUrl).hostname;
            }
            await step("backend-environment", async () => {
                if (!backendReference)
                    return ["no backend selected"];
                const result = await (dependencies.applyBackendEnvironment ?? defaultApplyBackendEnvironment)({
                    root: options.root,
                    manifestPath: manifest.envManifest,
                    reference: backendReference,
                    isolationRoot: join(stateRoot, "runtime", identity.id, "env"),
                    runCommand: run,
                });
                if (result.exitCode !== 0)
                    throw new Error("Selected backend environment routing failed");
                operations.push({
                    action: "write",
                    target: `convex:${backendReference}`,
                    detail: "applied canonical backend values",
                });
                await refreshGeneratedFiles();
            });
            await step("scoped-credential", async () => {
                if (policy.backend.mode !== "cloud" ||
                    !policy.backend.scopedCredential ||
                    !backendReference)
                    return ["not requested"];
                const token = await createScopedCredential({
                    root: options.root,
                    isolationRoot: join(stateRoot, "runtime", identity.id),
                    policy,
                    identity,
                    reference: backendReference,
                    run,
                    checkpoint,
                });
                operations.push(token.operation);
                await refreshGeneratedFiles();
            });
            await step("push", async () => {
                if (policy.backend.mode !== "cloud" ||
                    !policy.backend.push ||
                    !backendReference)
                    return ["not requested"];
                await pushBackend(options.root, policy, run);
                operations.push({
                    action: "run",
                    target: `convex:${backendReference}`,
                    detail: "pushed functions once",
                });
            });
            await step("client-outputs", async () => {
                operations.push(...(await writeClientOutputs(options.root, policy, publicUrl)));
                await refreshGeneratedFiles();
            });
            await step("seed", async () => {
                if (!policy.seedScript)
                    return ["not requested"];
                if (!backendReference)
                    throw new Error("Seed requires a selected backend");
                const result = await run({
                    tool: "pnpm",
                    args: ["run", policy.seedScript],
                    cwd: options.root,
                    removeEnv: PROVIDER_ENV_REMOVALS,
                });
                if (result.status !== "ok")
                    throw new Error(`Seed failed (${result.status})`);
                operations.push({
                    action: "run",
                    target: `pnpm run ${policy.seedScript}`,
                });
            });
            await step("readiness", async () => {
                const checkPort = dependencies.isPortAvailable ?? available;
                for (const [role, port] of Object.entries(policy.ports)) {
                    if (port === undefined)
                        continue;
                    if (!(await checkPort(port)))
                        throw new Error(`${role} port ${port} is unavailable`);
                    await checkpoint({
                        kind: "port",
                        id: `${role}:${port}`,
                        owned: true,
                        status: "active",
                        cleanup: "release",
                        metadata: { role, port },
                    });
                }
                if (policy.backend.mode !== "none" && (!backendReference || !publicUrl))
                    throw new Error("Backend outputs are incomplete");
            });
            for (const path of initiallyPresent.keys()) {
                const text = await readProjectText(options.root, path);
                if (!text)
                    continue;
                ledger.generatedFiles = [
                    ...ledger.generatedFiles.filter((item) => item.path !== path),
                    {
                        path,
                        digest: digestText(text),
                        createdByWorkspace: ledger.generatedFiles.find((item) => item.path === path)
                            ?.createdByWorkspace ?? !initiallyPresent.get(path),
                        status: "active",
                    },
                ];
            }
            const commands = [];
            if (policy.backend.mode === "local")
                commands.push(`pnpm exec convex dev --env-file ${policy.outputs.rootEnv}`);
            if (policy.ports.web)
                commands.push(`pnpm dev -- --port ${policy.ports.web}`);
            if (policy.ports.mobile)
                commands.push(`pnpm exec expo start --port ${policy.ports.mobile}`);
            ledger.status = "ready";
            ledger.readiness = {
                backend: policy.backend.mode,
                reference: backendReference,
                publicHostname,
                commands,
            };
            ledger.updatedAt = now().toISOString();
            await writeWorkspaceLedger(stateRoot, ledger);
            return {
                command: "prepare",
                workspaceId: identity.id,
                status: "ready",
                operations,
                findings,
                readiness: ledger.readiness,
            };
        }
        catch {
            const failedStep = ledger.steps.find((item) => item.status === "failed")?.id ?? "unknown";
            return {
                command: "prepare",
                workspaceId: identity.id,
                status: "failed",
                operations,
                findings: [
                    ...findings,
                    {
                        level: "error",
                        code: `workspace.prepare.${failedStep}.failed`,
                        message: `Workspace preparation stopped at ${failedStep}; rerun to resume from the recorded step`,
                    },
                ],
            };
        }
    });
}
