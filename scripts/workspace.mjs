#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkspaceCli } from './lib/workspace/cli.mjs';
export { runWorkspaceCli };

// Run from the project root, or pass --path before the original command/options.
export async function main(args = process.argv.slice(2)) {
  let root = process.cwd();
  const index = args.indexOf('--path');
  if (index !== -1) {
    if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error('--path requires a project directory');
    args = [...args]; root = resolve(args[index + 1]); args.splice(index, 2);
  }
  return runWorkspaceCli(args, { root: await realpath(root) });
}
if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().then(result => { process.exitCode = result.exitCode; }).catch(() => {
    console.error('workspace failed before completion; check project path and configuration.'); process.exitCode = 1;
  });
}
