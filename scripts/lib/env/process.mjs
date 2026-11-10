import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function resolveExternal(name) {
    if (isAbsolute(name))
        return (await exists(name)) ? { command: name, prefix: [] } : null;
    const extensions = process.platform === "win32" ? [".exe", ""] : [""];
    for (const folder of (process.env.PATH ?? "").split(delimiter))
        for (const extension of extensions) {
            const candidate = join(folder, `${name}${extension}`);
            if (await exists(candidate))
                return { command: candidate, prefix: [] };
        }
    return null;
}
const packageByTool = {
    convex: "convex",
    wrangler: "wrangler",
    eas: "eas-cli",
};
async function resolvePackageBin(root, tool) {
    let cursor = root;
    while (true) {
        const packageName = packageByTool[tool];
        const packageJson = join(cursor, "node_modules", packageName, "package.json");
        try {
            const parsed = JSON.parse(await readFile(packageJson, "utf8"));
            const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.[tool];
            if (bin)
                return {
                    command: process.execPath,
                    prefix: [resolve(dirname(packageJson), bin)],
                };
        }
        catch {
            /* continue toward root */
        }
        const parent = dirname(cursor);
        if (parent === cursor)
            return null;
        cursor = parent;
    }
}
async function resolveTool(spec) {
    if (spec.tool === "convex" || spec.tool === "wrangler" || spec.tool === "eas")
        return resolvePackageBin(spec.cwd, spec.tool);
    return resolveExternal(spec.tool);
}
export const runProcess = async (spec) => {
    const executable = await resolveTool(spec);
    if (!executable)
        return { status: "missing" };
    const childEnv = { ...process.env };
    for (const name of spec.removeEnv ?? [])
        delete childEnv[name];
    return new Promise((done) => {
        const maximumOutput = 8 * 1024 * 1024;
        let stdout = "";
        let settled = false;
        let aborted = false;
        let timer;
        let killTimer;
        let groupTimer;
        let killed = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(killTimer);
            clearTimeout(groupTimer);
            done(result);
        };
        const child = spawn(executable.command, [...executable.prefix, ...spec.args], {
            cwd: spec.cwd,
            env: childEnv,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            detached: process.platform !== "win32",
        });
        // Signal the provider's whole process tree: a subprocess it started
        // could otherwise keep writing remote settings after the lock is released.
        const signalTree = (signal) => {
            if (!child.pid)
                return void child.kill(signal);
            if (process.platform === "win32") {
                const killer = spawn(join(process.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
                killer.on("error", () => child.kill("SIGKILL"));
                killer.on("close", (code) => {
                    if (code !== 0)
                        child.kill("SIGKILL");
                });
                return;
            }
            try {
                process.kill(-child.pid, signal);
            }
            catch {
                child.kill(signal);
            }
        };
        // Resolve on `close`, once the tree has exited and released its pipes.
        // Windows has no SIGTERM for console processes, so it stops the tree at once.
        const abort = () => {
            if (aborted || settled)
                return;
            aborted = true;
            clearTimeout(timer);
            if (process.platform === "win32")
                return signalTree("SIGKILL");
            signalTree("SIGTERM");
            killTimer = setTimeout(() => {
                signalTree("SIGKILL");
                killed = true;
            }, spec.terminationGraceMs ?? 5_000);
        };
        timer = setTimeout(abort, spec.timeoutMs ?? 120_000);
        timer.unref();
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (aborted || settled)
                return;
            stdout += chunk;
            if (stdout.length > maximumOutput)
                abort();
        });
        child.stderr.resume();
        child.stdin.on("error", () => {
            // EPIPE is expected when a provider exits before consuming all input.
        });
        child.on("error", (error) => finish({
            status: error.code === "ENOENT"
                ? "missing"
                : error.code === "EACCES"
                    ? "denied"
                    : "failed",
        }));
        // A descendant with its own stdio can outlive the provider's pipes, so an
        // aborted run also waits until the group is empty or has received
        // SIGKILL. Nothing runs after SIGKILL; what remains may be a zombie that
        // a container's PID 1 never reaps.
        const groupAlive = () => {
            try {
                process.kill(-child.pid, 0);
                return true;
            }
            catch {
                return false;
            }
        };
        const finishAborted = () => {
            if (process.platform !== "win32" && child.pid && !killed && groupAlive()) {
                groupTimer = setTimeout(finishAborted, 50);
                return;
            }
            finish({ status: "failed" });
        };
        child.on("close", (code) => {
            if (aborted)
                return finishAborted();
            finish(code === 0 ? { status: "ok", stdout } : { status: "failed" });
        });
        child.stdin.end(spec.input);
    });
};
/** Runs a user command with inherited stdio and returns its exit code. */
export const runCommand = (spec) => new Promise((done) => {
    const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        shell: false,
        stdio: "inherit",
    });
    child.on("error", (error) => done({ exitCode: error.code === "ENOENT" ? 127 : 1 }));
    child.on("close", (code, signal) => done({ exitCode: code ?? (signal ? 1 : 0) }));
});
