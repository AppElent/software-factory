#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeProjectPath } from './lib/env/files.mjs';
import { manifestWarnings, validateManifest } from './lib/project/manifest.mjs';

export async function checkProject(root) {
  root = await realpath(root);
  const findings = [];
  const add = (level, message) => findings.push({ level, message });
  const read = async path => {
    await assertSafeProjectPath(root, path);
    try { return await readFile(resolve(root, path), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const [major, minor] = process.versions.node.split('.').map(Number);
  add(major > 22 || (major === 22 && minor >= 15) ? 'pass' : 'fail', 'Toolkit requires Node 22.15+');
  const text = await read('package.json');
  if (text) {
    const pkg = JSON.parse(text);
    add(/^pnpm@/.test(pkg.packageManager ?? '') ? 'pass' : 'warn', 'Declare a pinned pnpm packageManager for JavaScript/TypeScript projects');
    for (const role of ['check', 'typecheck', 'test']) add(pkg.scripts?.[role] ? 'pass' : 'warn', `Package script: ${role}`);
    for (const lock of ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']) if (await read(lock) !== null) add('warn', `Review package-manager ownership: ${lock}`);
  } else add('info', 'No package.json; no JavaScript baseline assumed');
  for (const path of ['CODING_STANDARDS.md', 'DESIGN_SYSTEM.md', 'docs/standards/documentation.md']) add(await read(path) === null ? 'warn' : 'pass', `Toolkit routing: ${path}`);
  const appelent = await read('appelent.json');
  if (appelent !== null) {
    try {
      const manifest = validateManifest(JSON.parse(appelent));
      const warnings = manifestWarnings(manifest);
      for (const warning of warnings) add('warn', `appelent.json: ${warning}`);
      if (!warnings.length) add('pass', 'appelent.json matches the current schema');
    } catch (error) { add('fail', error.issues ? error.message : 'Invalid appelent.json: file is not valid JSON'); }
  }
  if (await read('env.manifest.ts') !== null) add('info', 'Environment manifest exists; use env.mjs check for trusted execution and validation');
  add('info', 'Read-only file checks; no app code, dotenv values, providers, builds, or live acceptance were inspected');
  return { ok: !findings.some(x => x.level === 'fail'), findings };
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let root = process.cwd(), json = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true;
      else if (args[i] === '--path' && args[i + 1] && !args[i + 1].startsWith('-')) root = args[++i];
      else if (args[i] === '--help') { console.log('node scripts/check-project.mjs [--path project] [--json]'); process.exit(0); }
      else throw new Error('Invalid arguments');
    }
    const result = await checkProject(root);
    console.log(json ? JSON.stringify(result, null, 2) : result.findings.map(x => `${x.level}: ${x.message}`).join('\n'));
    process.exitCode = result.ok ? 0 : 1;
  } catch { console.error('Project check failed; inspect project path and metadata.'); process.exitCode = 1; }
}
