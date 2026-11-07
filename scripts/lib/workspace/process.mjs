import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve, } from "node:path";
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function external(name) {
    if (isAbsolute(name))
        return (await exists(name)) ? { command: name, prefix: [] } : null;
    if (name === "pnpm" &&
        process.env.npm_execpath &&
        /^pnpm(?:\.c?js)?$/u.test(basename(process.env.npm_execpath)))
        return { command: process.execPath, prefix: [process.env.npm_execpath] };
    for (const folder of (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)) {
        const candidate = join(folder, process.platform === "win32" ? `${name}.exe` : name);
        if (await exists(candidate))
            return { command: candidate, prefix: [] };
        if (name === "pnpm" && process.platform === "win32") {
            // Resolve npm/Corepack's JavaScript entry rather than executing a .cmd
            // through a shell. Arguments stay separate even when paths have spaces.
            const installed = await packageBin(folder, "pnpm", "pnpm");
            if (installed)
                return installed;
            const corepack = await packageBin(folder, "corepack", "pnpm");
            if (corepack)
                return corepack;
        }
    }
    return null;
}
async function packageBin(root, packageName, binName) {
    let cursor = root;
    while (true) {
        const packageJson = join(cursor, "node_modules", packageName, "package.json");
        try {
            const parsed = JSON.parse(await readFile(packageJson, "utf8"));
            const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.[binName];
            if (bin)
                return {
                    command: process.execPath,
                    prefix: [resolve(dirname(packageJson), bin)],
                };
        }
        catch {
            // Continue toward the filesystem root.
        }
        const parent = dirname(cursor);
        if (parent === cursor)
            return null;
        cursor = parent;
    }
}
async function resolveTool(spec) {
    if (spec.tool === "convex")
        return packageBin(spec.packageRoot ?? spec.cwd, "convex", "convex");
    if (spec.tool === "pnpm") {
        const local = await packageBin(spec.packageRoot ?? spec.cwd, "pnpm", "pnpm");
        if (local)
            return local;
    }
    return external(spec.tool);
}
export const runWorkspaceCommand = async (spec) => {
    const executable = await resolveTool(spec);
    if (!executable)
        return { status: "missing" };
    const env = { ...process.env };
    for (const name of spec.removeEnv ?? [])
        delete env[name];
    return new Promise((done) => {
        let stdout = "";
        let diagnostic = "";
        let settled = false;
        let aborted = false;
        let timer;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            done(value);
        };
        const child = spawn(executable.command, [...executable.prefix, ...spec.args], {
            cwd: spec.cwd,
            env,
            shell: false,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
        });
        const abort = () => {
            if (aborted || settled)
                return;
            aborted = true;
            if (child.pid && process.platform === "win32") {
                const killer = spawn(join(process.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
                killer.on("error", () => child.kill("SIGKILL"));
                killer.on("close", (code) => {
                    if (code !== 0)
                        child.kill("SIGKILL");
                });
            }
            else if (child.pid) {
                try {
                    process.kill(-child.pid, "SIGKILL");
                }
                catch {
                    child.kill("SIGKILL");
                }
            }
            else
                child.kill("SIGKILL");
            // Wait for close before allowing another lifecycle step or releasing
            // its lock. A timeout must not leave an active child writer behind.
        };
        timer = setTimeout(abort, spec.timeoutMs ?? 10 * 60_000);
        timer.unref();
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (aborted || settled)
                return;
            stdout += chunk;
            if (stdout.length > 8 * 1024 * 1024)
                abort();
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            if (diagnostic.length < 128 * 1024)
                diagnostic += chunk;
        });
        child.stdin.on("error", () => undefined);
        child.on("error", (error) => finish({
            status: error.code === "ENOENT"
                ? "missing"
                : error.code === "EACCES"
                    ? "denied"
                    : "failed",
        }));
        child.on("close", (code) => {
            if (aborted)
                return finish({ status: "failed" });
            if (code === 0)
                return finish({ status: "ok", stdout });
            const safe = `${stdout}\n${diagnostic}`.toLowerCase();
            if (/deployment[^\n]*(?:does not exist|not found|could not find)|(?:does not exist|not found|could not find)[^\n]*deployment|no (?:local )?deployment found/u.test(safe))
                return finish({ status: "not-found" });
            if (/unauthenticated|authentication failed|not authorized|permission denied|forbidden/u.test(safe))
                return finish({ status: "denied" });
            return finish({ status: "failed" });
        });
        child.stdin.end(spec.input);
    });
};
