import { mkdir, readFile, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeProjectPath, atomicWrite, parseEnvText, readOwnedFile, renderGeneratedEnv, } from "./files.mjs";
import { destinationLabel, renderEnvironmentExample, validateEnvironmentManifest, } from "./manifest.mjs";
import { planOwnedRemovals, readOwnership, recordRemoved, recordWritten, writeOwnership, } from "./ownership.mjs";
import { planEnvironment, selectPlacements } from "./planning.mjs";
import { readRemoteDestination, removeRemoteName, writeRemotePlacement, } from "./providers.mjs";
async function readFileState(root, path) {
    try {
        const file = await readOwnedFile(root, path);
        return {
            status: "ok",
            names: Object.keys(file.owned ? file.values : parseEnvText(file.text)),
            values: file.owned ? file.values : parseEnvText(file.text),
        };
    }
    catch (error) {
        const code = error.code;
        return {
            status: code === "EACCES" || code === "EPERM" ? "denied" : "unavailable",
            names: [],
            values: null,
        };
    }
}
export async function checkEnvironment(request) {
    const planned = planEnvironment(request.manifest, request.environment, request.source, request.options);
    const findings = [...planned.plan.findings];
    if (request.options.only === "infisical")
        return { findings, operations: planned.plan.operations };
    const cache = new Map();
    const expectedByDestination = new Map();
    for (const placement of planned.placements) {
        const label = destinationLabel(placement.destination);
        const names = expectedByDestination.get(label) ?? [];
        names.push(placement.name);
        expectedByDestination.set(label, names);
    }
    for (const placement of planned.placements) {
        const label = destinationLabel(placement.destination);
        if (placement.suppliedBy)
            continue;
        let state = cache.get(label);
        if (!state) {
            state =
                placement.destination.kind === "file"
                    ? await readFileState(request.root, placement.destination.path)
                    : await readRemoteDestination({
                        root: request.root,
                        manifest: request.manifest,
                        destination: placement.destination,
                        runProcess: request.runProcess,
                        ci: request.options.ci,
                        environ: request.options.environ,
                        expectedNames: expectedByDestination.get(label) ?? [],
                    });
            cache.set(label, state);
        }
        if (state.status !== "ok") {
            findings.push({
                level: "error",
                code: `destination.${state.status}`,
                message: `${label}: ${state.status}`,
            });
            continue;
        }
        if (!state.names.includes(placement.name)) {
            findings.push({
                level: placement.entry.optional ? "warning" : "error",
                code: "destination.missing",
                message: `${label}/${placement.name}: missing (${placement.entry.key})${placement.entry.optional ? " (optional)" : ""}`,
            });
            continue;
        }
        if (state.values === null) {
            findings.push({
                level: "note",
                code: "destination.names-only",
                message: `${label}/${placement.name}: provider confirms the name only; value equality is not available`,
            });
        }
        const expected = request.source.values[placement.entry.infisicalKey];
        const found = state.values?.[placement.name];
        if (!placement.entry.secret &&
            expected !== undefined &&
            found !== undefined &&
            expected !== found)
            findings.push({
                level: "error",
                code: "destination.differs",
                message: `${label}/${placement.name}: differs from canonical source (${placement.entry.key})`,
            });
    }
    return { findings, operations: planned.plan.operations };
}
/**
 * CI without canonical-source credentials: the job environment is all there is.
 * Checks that every GitHub-routed name is set; values are not compared and other
 * destinations are not contacted.
 */
export function checkJobEnvironment(manifest, environment, environ, options = {}) {
    const findings = [
        {
            level: "note",
            code: "source.skipped",
            message: "No INFISICAL_TOKEN: checked names in the job environment only; values were not compared",
        },
    ];
    const skipped = new Set();
    for (const placement of selectPlacements(manifest, environment, options)) {
        if (placement.suppliedBy)
            continue;
        const label = destinationLabel(placement.destination);
        if (placement.destination.kind !== "github") {
            skipped.add(label);
            continue;
        }
        if (environ[placement.name])
            continue;
        findings.push({
            level: placement.entry.optional ? "warning" : "error",
            code: "destination.missing",
            message: `${label}/${placement.name}: missing from the job environment (${placement.entry.key})${placement.entry.optional ? " (optional)" : ""}`,
        });
    }
    for (const label of skipped)
        findings.push({
            level: "note",
            code: "destination.skipped",
            message: `${label}: not checked without canonical-source credentials`,
        });
    return findings;
}
const expandsDotenv = (consumer) => consumer === "vite-build" || consumer === "expo-local";
async function applyWithOwnership(request, state) {
    const planned = planEnvironment(request.manifest, request.environment, request.source, request.options);
    const findings = [...planned.plan.findings];
    if (findings.some((item) => item.level === "error") ||
        request.options.only === "infisical")
        return { findings, operations: [] };
    const removals = request.options.prune
        ? planOwnedRemovals(request.manifest, request.environment, planned.placements, state, request.options.prNumber)
        : [];
    const operations = [...planned.plan.operations, ...removals];
    const groups = new Map();
    for (const placement of planned.placements) {
        if (placement.destination.kind !== "file")
            continue;
        const group = groups.get(placement.destination.path) ?? [];
        group.push(placement);
        groups.set(placement.destination.path, group);
    }
    const files = [];
    // Read, render, and validate every file before any destination mutation.
    for (const [path, placements] of groups) {
        try {
            const existing = await readOwnedFile(request.root, path);
            const writable = placements.filter((item) => !item.suppliedBy &&
                request.source.values[item.entry.infisicalKey] !== undefined &&
                request.source.values[item.entry.infisicalKey] !== "");
            const removedNames = removals
                .filter((item) => item.destination === path)
                .map((item) => item.name);
            if (writable.length === 0 && removedNames.length === 0)
                continue;
            if (existing.exists && !existing.owned) {
                findings.push({
                    level: "error",
                    code: "file.human-owned",
                    message: `${path}: existing file is not generated`,
                });
                continue;
            }
            const next = Object.assign(Object.create(null), existing.values);
            for (const placement of writable)
                next[placement.name] =
                    request.source.values[placement.entry.infisicalKey] ?? "";
            for (const name of removedNames)
                delete next[name];
            const expand = placements.some((item) => expandsDotenv(item.consumer));
            if (expand) {
                const conflicting = Object.entries(next).find(([name, value]) => {
                    if (!value.includes("$"))
                        return false;
                    const consumers = placements
                        .filter((item) => item.name === name)
                        .map((item) => item.consumer);
                    return (consumers.length === 0 ||
                        consumers.some((consumer) => !expandsDotenv(consumer)));
                });
                if (conflicting) {
                    findings.push({
                        level: "error",
                        code: "file.dotenv-expand-conflict",
                        message: `${path}/${conflicting[0]}: literal dollar syntax cannot be represented for both expanding and non-expanding consumers`,
                    });
                    continue;
                }
            }
            const content = renderGeneratedEnv(`@appelent/dev env apply ${request.environment}`, next, { expand });
            files.push({
                path,
                content,
                changed: content !== existing.text,
                writtenNames: writable.map((item) => item.name),
                removedNames,
            });
        }
        catch {
            findings.push({
                level: "error",
                code: "file.invalid",
                message: `${path}: cannot safely read or render destination`,
            });
        }
    }
    if (findings.some((item) => item.level === "error"))
        return { findings, operations };
    const app = request.manifest.ENV_CONFIG.appName;
    for (const file of files) {
        if (file.changed)
            await atomicWrite(request.root, file.path, file.content);
        recordWritten(state, app, request.environment, file.path, file.writtenNames);
        for (const name of file.removedNames)
            recordRemoved(state, app, request.environment, file.path, name);
        await writeOwnership(request.root, state);
    }
    const seen = new Set();
    for (const placement of planned.placements) {
        if (placement.destination.kind === "file" || placement.suppliedBy)
            continue;
        const value = request.source.values[placement.entry.infisicalKey];
        if (value === undefined || value === "")
            continue;
        const label = destinationLabel(placement.destination);
        const slot = `${label}\0${placement.name}`;
        if (seen.has(slot))
            continue;
        seen.add(slot);
        if ((await writeRemotePlacement(request.root, request.manifest.ENV_CONFIG, placement, value, request.runProcess)) !== "ok") {
            findings.push({
                level: "error",
                code: "destination.write-failed",
                message: `${label}/${placement.name}: write failed`,
            });
            continue;
        }
        recordWritten(state, app, request.environment, label, [placement.name]);
        await writeOwnership(request.root, state);
    }
    if (!findings.some((item) => item.level === "error"))
        for (const removal of removals) {
            const destination = planned.placements.find((item) => destinationLabel(item.destination) === removal.destination)?.destination;
            if (!destination || destination.kind === "file")
                continue;
            if ((await removeRemoteName(request.root, request.manifest.ENV_CONFIG, destination, removal.name, request.runProcess)) !== "ok") {
                findings.push({
                    level: "error",
                    code: "prune.failed",
                    message: `${removal.destination}/${removal.name}: removal failed`,
                });
                continue;
            }
            recordRemoved(state, app, request.environment, removal.destination, removal.name);
            await writeOwnership(request.root, state);
        }
    return { findings, operations };
}
export async function applyEnvironment(request) {
    // Serialize local ownership updates. An interrupted run leaves a visible lock;
    // the operator must establish no apply is active before removing it.
    const lockPath = ".appelent/env.lock";
    await assertSafeProjectPath(request.root, lockPath);
    await mkdir(join(request.root, ".appelent"), { recursive: true });
    try {
        await mkdir(join(request.root, lockPath));
    }
    catch (error) {
        const locked = error.code === "EEXIST";
        return {
            findings: [
                {
                    level: "error",
                    code: locked ? "ownership.locked" : "ownership.unavailable",
                    message: locked
                        ? "Environment apply is locked; verify no apply is active before removing .appelent/env.lock"
                        : "Cannot create the environment apply lock",
                },
            ],
            operations: [],
        };
    }
    try {
        return await applyWithOwnership(request, await readOwnership(request.root));
    }
    finally {
        await rmdir(join(request.root, lockPath));
    }
}
export async function checkManifestAndExample(root, manifest) {
    const findings = validateEnvironmentManifest(manifest);
    let current = null;
    try {
        current = await readFile(join(root, ".env.example"), "utf8");
    }
    catch {
        /* missing is stale */
    }
    if (current !== renderEnvironmentExample(manifest))
        findings.push({
            level: "error",
            code: "example.stale",
            message: ".env.example is stale; run env generate",
        });
    return findings;
}
