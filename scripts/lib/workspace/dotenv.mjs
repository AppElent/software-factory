import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeProjectPath, atomicWrite, parseEnvText } from "../env/files.mjs";
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u;
export async function readProjectText(root, path) {
    await assertSafeProjectPath(root, path);
    try {
        return await readFile(join(root, path), "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "";
        throw error;
    }
}
export function removeEnvNames(text, names) {
    return text
        .split(/(?<=\n)/u)
        .filter((line) => {
        const match = ASSIGNMENT.exec(line);
        return !match || !names.has(match[1] ?? "");
    })
        .join("");
}
function quote(value) {
    if (/^[A-Za-z0-9_./:@%+,-]+$/u.test(value))
        return value;
    if (!value.includes("'"))
        return `'${value}'`;
    throw new Error("Workspace output cannot be represented safely in dotenv syntax");
}
export function setEnvName(text, name, value) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
        throw new Error("Invalid workspace output name");
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const filtered = removeEnvNames(text, new Set([name]));
    const separator = filtered.length > 0 && !filtered.endsWith("\n") ? newline : "";
    return `${filtered}${separator}${name}=${quote(value)}${newline}`;
}
export async function writeProjectText(root, path, text) {
    await atomicWrite(root, path, text);
}
export function readEnvValues(text) {
    return text
        ? parseEnvText(text)
        : Object.create(null);
}
export function digestText(text) {
    return createHash("sha256").update(text).digest("hex");
}
