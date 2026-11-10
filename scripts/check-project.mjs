#!/usr/bin/env node
import { readFile, readdir, realpath } from 'node:fs/promises';
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
  if (text) {
    for (const path of await packagePaths(root, read, add)) {
      let pkg;
      try { pkg = JSON.parse(await read(path)); } catch (error) { add('warn', `${path}: ${unreadable(error, 'JSON')}`); continue; }
      if (!pkg || typeof pkg !== 'object') { add('warn', `${path}: not a JSON object`); continue; }
      for (const problem of dependencyProblems(pkg)) add('warn', `${path}: ${problem}`);
    }
    await checkCi(read, add);
  }
  for (const path of await wranglerPaths(root, read, add)) {
    let config;
    try { config = parseJsonc(await read(path)); } catch (error) { add('warn', `${path}: ${unreadable(error, 'JSONC')}`); continue; }
    const names = Object.keys(config?.env ?? {}).filter(name => !WRANGLER_ENVIRONMENTS.has(name));
    add(names.length ? 'warn' : 'pass', names.length ? `${path}: Wrangler environments ${names.join(', ')} are not dev, staging, or pr` : `${path}: Wrangler environments use the standard names`);
  }
  let toml = [];
  try { toml = [...await read('wrangler.toml') !== null ? ['wrangler.toml'] : [], ...await childPaths(root, read, add, 'wrangler.toml')]; }
  catch (error) { add('warn', `wrangler.toml: ${unreadable(error, 'TOML')}`); }
  for (const path of toml) add('warn', `${path}: use wrangler.jsonc; environments in TOML are not checked`);
  add('info', 'Read-only file checks of package, CI, and Wrangler metadata; no app code, dotenv values, providers, builds, or live acceptance were inspected');
  return { ok: !findings.some(x => x.level === 'fail'), findings };
}

const WRANGLER_ENVIRONMENTS = new Set(['dev', 'staging', 'pr']);
const WORKSPACE_DIRS = ['apps', 'packages'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const LOCAL_SPEC = /^(workspace|catalog|link|file|portal):/;
const DIST_TAG = /^[A-Za-z][\w.-]*$/;

// A parse error means the file is broken; anything else (a symlink, a directory) means it was not read.
function unreadable(error, format) {
  return error instanceof SyntaxError ? `not valid ${format}` : `could not be read (${error.code ?? error.message})`;
}

async function childPaths(root, read, add, file) {
  const paths = [];
  for (const directory of WORKSPACE_DIRS) {
    let entries = [];
    try { entries = await readdir(resolve(root, directory), { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') add('warn', `${directory}/: could not be listed (${error.code ?? error.message})`); continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) { if (file === 'package.json') add('info', `${directory}/${entry.name}: symlinked workspace not checked`); continue; }
      if (!entry.isDirectory()) continue;
      const path = `${directory}/${entry.name}/${file}`;
      try { if (await read(path) !== null) paths.push(path); }
      catch (error) { add('warn', `${path}: ${unreadable(error, 'JSON')}`); }
    }
  }
  return paths;
}

async function packagePaths(root, read, add) {
  return ['package.json', ...await childPaths(root, read, add, 'package.json')];
}

async function wranglerPaths(root, read, add) {
  const paths = [];
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    try { if (await read(file) !== null) paths.push(file); } catch (error) { add('warn', `${file}: ${unreadable(error, 'JSONC')}`); }
    paths.push(...await childPaths(root, read, add, file));
  }
  return paths;
}

export function dependencyProblems(pkg) {
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || LOCAL_SPEC.test(spec)) continue;
      const range = spec.trim();
      if (name === '@typescript/native') problems.push(`${name} is not allowed; use typescript ~6.0.x`);
      else if (range.startsWith('npm:')) problems.push(`${name} is an npm alias (${range}); depend on the package directly`);
      else if (field === 'peerDependencies' && range === '*') continue;
      else if (range === '' || range === '*' || DIST_TAG.test(range)) problems.push(`${name} uses a floating range or dist-tag (${range || 'empty'}); pin a version or semver range`);
      else if (name === 'typescript' && !/^~?6\.0(\.(\d+|[xX*]))?$/.test(range)) problems.push(`typescript is ${range}; use a 6.0 range such as ~6.0.3`);
    }
  }
  return problems;
}

async function checkCi(read, add) {
  let path = '.github/workflows/ci.yml', ci;
  try {
    ci = await read(path);
    if (ci === null) { path = '.github/workflows/ci.yaml'; ci = await read(path); }
  } catch (error) { add('warn', `${path}: ${unreadable(error, 'YAML')}`); return; }
  if (ci === null) { add('warn', 'CI: .github/workflows/ci.yml is missing'); return; }
  const check = workflowJobSettings(ci).get('check');
  if (!check) { add('warn', `CI: no block-style job named check in ${path} (the required status check)`); return; }
  const name = check.name?.replace(/^(['"])(.*)\1$/, '$2');
  if (name !== undefined && name !== 'check') add('warn', `CI: the check job sets name "${name}"; the ruleset matches the reported name, so remove it`);
  if ('strategy' in check) add('warn', 'CI: the check job has a strategy; a matrix renames the status check, so move it to another job');
  if ((name === undefined || name === 'check') && !('strategy' in check)) add('pass', `CI: ${path} has a job named check (the required status check)`);
}

// Top-level jobs under `jobs:` with their direct settings as raw strings; enough for the
// shared CI template's block style. Flow-style YAML is not understood.
export function workflowJobSettings(yaml) {
  const jobs = new Map();
  let inJobs = false, indent = null, job = null, childIndent = null;
  for (const line of yaml.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) { inJobs = /^jobs:\s*(#.*)?$/.test(line); indent = null; job = null; continue; }
    if (!inJobs) continue;
    const width = line.length - line.trimStart().length;
    indent ??= width;
    if (width === indent) {
      const match = /^\s*(['"]?)([A-Za-z0-9_-]+)\1:\s*(#.*)?$/.exec(line);
      job = match ? match[2] : null; childIndent = null;
      if (job) jobs.set(job, {});
    } else if (job && width > indent) {
      childIndent ??= width;
      const setting = width === childIndent && /^\s*([A-Za-z0-9_-]+):\s*((?:"[^"]*"|'[^']*'|[^\s#'"]|\s+(?!#|$))*)\s*(#.*)?$/.exec(line);
      if (setting) jobs.get(job)[setting[1]] = setting[2].trimEnd();
    }
  }
  return jobs;
}

export function workflowJobs(yaml) {
  return [...workflowJobSettings(yaml).keys()];
}

// JSON with comments and trailing commas, as Wrangler accepts it. Strings are kept intact.
export function parseJsonc(text) {
  text = text.replace(/^\uFEFF/, '');
  let out = '', i = 0;
  const skipSpaceAndComments = j => {
    for (;;) {
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text.startsWith('//', j)) { while (j < text.length && text[j] !== '\n') j++; }
      else if (text.startsWith('/*', j)) { const end = text.indexOf('*/', j + 2); j = end === -1 ? text.length : end + 2; }
      else return j;
    }
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === ',') {
      const next = text[skipSpaceAndComments(i + 1)];
      if (next !== '}' && next !== ']') out += char;
      i++;
    } else { out += char; i++; }
  }
  return JSON.parse(out);
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let root = process.cwd(), json = false, strict = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true;
      else if (args[i] === '--strict') strict = true;
      else if (args[i] === '--path' && args[i + 1] && !args[i + 1].startsWith('-')) root = args[++i];
      else if (args[i] === '--help') { console.log('node scripts/check-project.mjs [--path project] [--json] [--strict]  (--strict fails on warnings too)'); process.exit(0); }
      else throw new Error('Invalid arguments');
    }
    const result = await checkProject(root);
    console.log(json ? JSON.stringify(result, null, 2) : result.findings.map(x => `${x.level}: ${x.message}`).join('\n'));
    process.exitCode = result.ok && !(strict && result.findings.some(x => x.level === 'warn')) ? 0 : 1;
  } catch { console.error('Project check failed; inspect project path and metadata.'); process.exitCode = 1; }
}
