import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeProjectPath, atomicWrite } from "./files.mjs";
import { destinationLabel } from "./manifest.mjs";
export const OWNERSHIP_PATH = ".appelent/env-state.json";
export async function readOwnership(root) {
    await assertSafeProjectPath(root, OWNERSHIP_PATH);
    let text;
    try {
        text = await readFile(join(root, OWNERSHIP_PATH), "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { schemaVersion: 1, records: [] };
        throw new Error("Environment ownership state could not be read");
    }
    const state = JSON.parse(text);
    if (state?.schemaVersion !== 1 ||
        !Array.isArray(state.records) ||
        state.records.some((record) => !record ||
            typeof record.app !== "string" ||
            typeof record.environment !== "string" ||
            typeof record.destination !== "string" ||
            !Array.isArray(record.names) ||
            record.names.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))))
        throw new Error("Environment ownership state is invalid");
    return state;
}
export async function writeOwnership(root, state) {
    await atomicWrite(root, OWNERSHIP_PATH, `${JSON.stringify(state, null, 2)}\n`);
}
export function recordWritten(state, app, environment, destination, names) {
    let record = state.records.find((item) => item.app === app &&
        item.environment === environment &&
        item.destination === destination);
    if (!record) {
        record = { app, environment, destination, names: [] };
        state.records.push(record);
    }
    record.names = [...new Set([...record.names, ...names])].sort();
}
export function recordRemoved(state, app, environment, destination, name) {
    for (const record of state.records)
        if (record.app === app &&
            record.environment === environment &&
            record.destination === destination)
            record.names = record.names.filter((value) => value !== name);
}
/** Only prior successful writes prove ownership. Active routes and other owners win. */
export function planOwnedRemovals(manifest, environment, placements, state, prNumber) {
    const destinations = new Set(placements
        .filter((item) => ["file", "convex", "worker"].includes(item.destination.kind))
        .map((item) => destinationLabel(item.destination)));
    const active = new Set();
    for (const target of manifest.ENVIRONMENTS)
        for (const placement of manifest.placementsFor(target, { prNumber }))
            active.add(`${destinationLabel(placement.destination)}\0${placement.name}`);
    const operations = [];
    for (const record of state.records) {
        if (record.app !== manifest.ENV_CONFIG.appName ||
            record.environment !== environment ||
            !destinations.has(record.destination))
            continue;
        for (const name of record.names) {
            if (active.has(`${record.destination}\0${name}`))
                continue;
            if (state.records.some((other) => other !== record &&
                other.destination === record.destination &&
                other.names.includes(name)))
                continue;
            operations.push({
                action: "remove",
                destination: record.destination,
                name,
            });
        }
    }
    return operations;
}
