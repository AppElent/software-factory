#!/usr/bin/env node
// Standalone bootstrap: only Node built-ins and authenticated gh are required.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'AppElent/developer-tools';
export const hash = value => createHash('sha256').update(value).digest('hex');
const receiptPath = '.appelent/devtools.json';
const journalPath = '.appelent/devtools-pending.json';
const lockPath = '.appelent/devtools.lock';
const start = '<!-- appelent-guidelines:start -->';
const end = '<!-- appelent-guidelines:end -->';
const standardsStart = '<!-- appelent-standards:start -->';
const standardsEnd = '<!-- appelent-standards:end -->';
const standardsPaths = ['CODING_STANDARDS.md', 'DESIGN_SYSTEM.md'];
const block = `${start}\nBefore implementing or reviewing code, read CODING_STANDARDS.md.\nFor UI work, also read DESIGN_SYSTEM.md. Follow their task-specific links.\n${end}`;
const claudeBlock = `${start}\nRead [AGENTS.md](AGENTS.md).\n${end}`;
// Retired: pointed at the appelent plugin and appelent-packages feature catalog.
const retiredStart = '<!-- appelent-managed:start -->';
const retiredEnd = '<!-- appelent-managed:end -->';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function safePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.\/-]+$/.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ||
      path.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error(`Unsafe path: ${String(path)}`);
  return path;
}

function allowed(path, scope = 'project') {
  safePath(path);
  const skill = /^(\.agents|\.claude)\/skills\/[a-z0-9][a-z0-9-]*\//.test(path);
  // docs/features and docs/guidelines/shared are retired; they stay allowed so older receipts still load and their files are removed.
  if (skill || (scope === 'project' && (/^(scripts|docs\/features|docs\/guidelines\/shared|docs\/standards)\//.test(path) ||
      /^docs\/(adr|contracts|records|runbooks)\/\.template\.md$/.test(path) ||
      ['CODING_STANDARDS.md', 'DESIGN_SYSTEM.md'].includes(path)))) return;
  throw new Error(`Unsupported destination: ${path}`);
}

export function metadata(content, path) {
  const front = content.match(/^---\n([\s\S]*?)\n---\n/);
  const version = front?.[1].match(/^version: (\d+\.\d+\.\d+)$/m)?.[1] ??
    (path.endsWith('/SKILL.md') ? front?.[1].match(/^metadata:\n  version: (\d+\.\d+\.\d+)$/m)?.[1] : undefined);
  const description = front?.[1].match(/^description: (.+)$/m)?.[1];
  if (!version || !description?.trim()) throw new Error(`Invalid Markdown frontmatter: ${path}`);
  return { version, description };
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== 2 || manifest.repository !== repository ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 2000)
    throw new Error('Unsupported distribution manifest; obtain a current reviewed sync script.');
  const destinations = new Set(), sources = new Map();
  for (const entry of manifest.files) {
    safePath(entry.source); allowed(entry.destination);
    if (/^(\.agents|\.claude)\/skills\//.test(entry.destination)) throw new Error('Skills must be installed with npx skills, outside toolkit distribution');
    if (standardsPaths.includes(entry.destination) ? entry.ownership !== 'block' : entry.ownership !== undefined) throw new Error(`Invalid ownership: ${entry.destination}`);
    const key = entry.destination.toLowerCase();
    if (destinations.has(key) || !digest(entry.sha256)) throw new Error(`Invalid or duplicate entry: ${entry.destination}`);
    destinations.add(key);
    if (sources.has(entry.source) && sources.get(entry.source) !== entry.sha256) throw new Error('Inconsistent source hash');
    sources.set(entry.source, entry.sha256);
    if (entry.source.endsWith('.md') && !/^\d+\.\d+\.\d+$/.test(entry.version ?? '')) throw new Error('Missing Markdown version');
  }
  for (const path of destinations) {
    const parts = path.split('/');
    while (parts.length > 1) { parts.pop(); if (destinations.has(parts.join('/'))) throw new Error('Overlapping destinations'); }
  }
  if (!standardsPaths.every(path => manifest.files.some(entry => entry.destination === path))) throw new Error('Manifest must include both project standards blocks');
  return manifest;
}

async function inspect(root, path) {
  safePath(path);
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = await lstat(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
      throw new Error(`Unsafe filesystem entry: ${path}`);
  }
  return readFile(current, 'utf8');
}

async function atomic(root, path, value) {
  await inspect(root, path);
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, value, { flag: 'wx', mode: 0o644 }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
}

export function extractBlock(text, first = start, last = end) {
  if (text === null) return null;
  const a = text.indexOf(first), b = text.indexOf(last);
  if (a === -1 && b === -1) return null;
  if (a < 0 || b < a || text.indexOf(first, a + 1) !== -1 || text.indexOf(last, b + 1) !== -1)
    throw new Error('Malformed managed block');
  return text.slice(a, b + last.length);
}

/** Drops the retired appelent-managed block and the blank lines around it. */
export function removeRetiredBlock(text) {
  const retired = extractBlock(text, retiredStart, retiredEnd);
  if (!retired) return text;
  const at = text.indexOf(retired);
  const before = text.slice(0, at).replace(/\n+$/, ''), after = text.slice(at + retired.length).replace(/^\n+/, '');
  return before && after ? `${before}\n\n${after}` : before ? `${before}\n` : after;
}

function parseReceipt(text, scope) {
  if (text === null) return { files: {}, blocks: {} };
  const receipt = JSON.parse(text);
  if (receipt.schemaVersion !== 1 || receipt.repository !== repository || receipt.scope !== scope ||
      !receipt.files || Array.isArray(receipt.files)) throw new Error('Invalid receipt or different installation scope');
  for (const [path, entry] of Object.entries(receipt.files)) { allowed(path, scope); if (!digest(entry.sha256)) throw new Error('Invalid receipt hash'); }
  for (const [path, value] of Object.entries(receipt.blocks ?? {})) {
    if (scope !== 'project' || !['AGENTS.md', 'CLAUDE.md', ...standardsPaths].includes(path) || !digest(value)) throw new Error('Invalid block receipt');
  }
  return receipt;
}

function github(endpoint, raw = false) {
  try {
    return execFileSync('gh', ['api', '--hostname', 'github.com', endpoint, '-H',
      `Accept: ${raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}`],
    { encoding: 'utf8', maxBuffer: 5_000_000, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('GitHub read failed. Check gh authentication, repository access, and ref.'); }
}

export async function sync(options = {}) {
  if (options.scope || options.agents || options.skillScope) throw new Error('Skills are installed separately with npx skills; scope and agent options are no longer supported.');
  const scope = 'project';
  const root = await realpath(options.root ?? process.cwd());
  const log = options.log ?? console.log;
  const receiptText = await inspect(root, receiptPath);
  const previous = parseReceipt(receiptText, scope);
  // Transfer former skill copies to the external installer without touching them.
  for (const path of Object.keys(previous.files)) {
    if (/^(\.agents|\.claude)\/skills\//.test(path)) {
      log(`UNMANAGE ${path}; preserved for npx skills.`);
      delete previous.files[path];
    }
  }
  const pending = await inspect(root, journalPath);
  if (pending !== null) throw new Error('Interrupted update: run with --recover to restore prior files, then retry.');
  if (options.check) {
    if (!receiptText) throw new Error('No toolkit installation receipt');
    const drift = [];
    for (const [path, entry] of Object.entries(previous.files)) {
      const content = await inspect(root, path);
      if (content === null || hash(content) !== entry.sha256) drift.push(path);
    }
    for (const [path, expected] of Object.entries(previous.blocks ?? {})) {
      const text = await inspect(root, path);
      const content = standardsPaths.includes(path) ? extractBlock(text, standardsStart, standardsEnd) : extractBlock(text);
      if (content === null || hash(content) !== expected) drift.push(path);
    }
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      const text = await inspect(root, path);
      if (text !== null && removeRetiredBlock(text) !== text) drift.push(`${path} (retired appelent-managed block; run sync to remove it)`);
    }
    if (drift.length) throw new Error(`Local drift:\n${drift.join('\n')}`);
    log('Installed toolkit matches its receipt (offline).'); return;
  }
  const ref = options.ref ?? previous.ref ?? 'main';
  let get, commit;
  if (options.source) {
    const source = await realpath(options.source);
    get = async path => { const content = await inspect(source, path); if (content === null) throw new Error(`Missing source: ${path}`); return content; };
    commit = 'local';
  } else {
    commit = JSON.parse(github(`repos/${repository}/commits/${encodeURIComponent(ref)}`)).sha;
    if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Invalid GitHub revision');
    get = async path => github(`repos/${repository}/contents/${path}?ref=${commit}`, true);
  }
  const manifestText = await get('distribution.json');
  const manifest = validateManifest(JSON.parse(manifestText));
  const selected = manifest.files;
  const cache = new Map(), desired = new Map(), standards = new Map();
  let bytes = 0;
  for (const entry of selected) {
    if (!cache.has(entry.source)) {
      const text = await get(entry.source);
      bytes += Buffer.byteLength(text);
      if (bytes > 20_000_000) throw new Error('Distribution exceeds 20 MB');
      if (hash(text) !== entry.sha256) throw new Error(`Hash mismatch: ${entry.source}`);
      if (entry.source.endsWith('.md') && metadata(text, entry.source).version !== entry.version) throw new Error('Version mismatch');
      cache.set(entry.source, text);
    }
    const text = cache.get(entry.source);
    if (entry.ownership === 'block') {
      const managed = extractBlock(text, standardsStart, standardsEnd);
      if (!managed) throw new Error(`Missing standards block: ${entry.source}`);
      standards.set(entry.destination, { text, managed });
    } else desired.set(entry.destination, text);
  }
  // A legacy receipt can establish ownership, but is retained as historical evidence.
  if (!receiptText && scope === 'project') {
    const legacyText = await inspect(root, '.appelent/guidelines.json');
    if (legacyText) {
      const legacy = JSON.parse(legacyText);
      if (legacy.schemaVersion !== 1 || !legacy.files) throw new Error('Invalid legacy guideline receipt');
      for (const [path, sha256] of Object.entries(legacy.files)) {
        allowed(path); if (!digest(sha256)) throw new Error('Invalid legacy hash');
        previous.files[path] = { sha256 };
      }
      previous.blocks = { 'AGENTS.md': legacy.agentsBlockHash, 'CLAUDE.md': legacy.claudeBlockHash };
    }
  }
  const operations = [], conflicts = [], observed = new Map();
  const next = { schemaVersion: 1, repository, scope, ref, commit, manifestHash: hash(manifestText), files: {}, blocks: {} };
  for (const path of new Set([...Object.keys(previous.files), ...desired.keys()])) {
    if (standardsPaths.includes(path)) continue;
    const current = await inspect(root, path), value = desired.get(path) ?? null;
    observed.set(path, current);
    const old = previous.files[path];
    // A bootstrap copied into place already matches; exact content needs no overwrite.
    if (current !== value && (old ? current === null || hash(current) !== old.sha256 : current !== null)) conflicts.push(path);
    if (value !== null) {
      next.files[path] = { sha256: hash(value), ...(path.endsWith('.md') ? { version: metadata(value, path).version } : {}) };
      const oldVersion = old?.version, newVersion = next.files[path].version;
      if (oldVersion && oldVersion !== newVersion) log(`${path}: ${oldVersion} -> ${newVersion}; review migration notes if used.`);
    }
    if (current !== value) operations.push({ path, before: current, after: value });
  }
  if (scope === 'project') {
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      const agentBlock = path === 'CLAUDE.md' ? claudeBlock : block;
      const original = await inspect(root, path), current = original === null ? null : removeRetiredBlock(original);
      const oldBlock = extractBlock(current);
      observed.set(path, original);
      if (current !== original) log(`${path}: removing the retired appelent-managed block.`);
      if (oldBlock && hash(oldBlock) !== previous.blocks?.[path] && oldBlock !== agentBlock) conflicts.push(path);
      if (!oldBlock && previous.blocks?.[path]) conflicts.push(path);
      const value = oldBlock ? current.replace(oldBlock, agentBlock) : `${current ?? ''}${current ? '\n' : ''}${agentBlock}\n`;
      if (value !== original) operations.push({ path, before: original, after: value });
      next.blocks[path] = hash(agentBlock);
    }
    for (const [path, { text, managed }] of standards) {
      const current = await inspect(root, path);
      const oldBlock = extractBlock(current, standardsStart, standardsEnd);
      observed.set(path, current);
      const oldFile = previous.files[path];
      // A former whole-file receipt may be adopted only if unchanged.
      if (oldFile && (current === null || hash(current) !== oldFile.sha256)) conflicts.push(path);
      if (oldBlock && hash(oldBlock) !== previous.blocks?.[path] && oldBlock !== managed) conflicts.push(path);
      if (!oldBlock && previous.blocks?.[path]) conflicts.push(path);
      const value = current === null ? text : oldBlock ? current.replace(oldBlock, managed) : `${current}${current.endsWith('\n') ? '\n' : '\n\n'}${managed}\n`;
      if (value !== current) operations.push({ path, before: current, after: value });
      next.blocks[path] = hash(managed);
    }
  }

  log(`Source: ${repository}@${commit}; ${selected.length} distributed files`);
  for (const op of operations) log(`${op.after === null ? 'REMOVE' : op.before === null ? 'ADD' : 'UPDATE'} ${op.path}`);
  if (conflicts.length) throw new Error(`CONFLICT: preserve and reconcile local files before retrying:\n${conflicts.join('\n')}`);
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  if (receiptText !== nextText) operations.push({ path: receiptPath, before: receiptText, after: nextText });
  if (options.dryRun) { log('Preview only; no project files changed.'); return; }
  if (!operations.length) { log('Already current.'); return; }
  await withLock(root, async () => {
    for (const [path, value] of [...observed, [receiptPath, receiptText], [journalPath, null]]) {
      if (await inspect(root, path) !== value) throw new Error(`File changed during planning: ${path}`);
    }
    await atomic(root, journalPath, JSON.stringify({ schemaVersion: 1, scope, operations }));
    for (const op of operations) {
      if (await inspect(root, op.path) !== op.before) throw new Error(`Concurrent edit: ${op.path}; recover before retrying`);
      if (op.after === null) await rm(join(root, op.path));
      else await atomic(root, op.path, op.after);
    }
    await rm(join(root, journalPath));
  });
  log('Toolkit updated. Application migrations and script execution remain separate.');
}

async function withLock(root, action) {
  await inspect(root, receiptPath);
  await mkdir(join(root, '.appelent'), { recursive: true });
  try { await mkdir(join(root, lockPath)); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Toolkit update is locked. Verify no sync is running before removing .appelent/devtools.lock.');
    throw error;
  }
  try { await action(); } finally { await rm(join(root, lockPath), { recursive: true }); }
}

export async function recover(root) {
  root = await realpath(root);
  await withLock(root, async () => {
    const text = await inspect(root, journalPath);
    if (text === null) throw new Error('No interrupted update');
    const journal = JSON.parse(text);
    if (journal.schemaVersion !== 1 || !['project', 'user'].includes(journal.scope) || !Array.isArray(journal.operations)) throw new Error('Invalid recovery journal');
    const seen = new Set();
    for (const op of journal.operations) {
      if (op.path !== receiptPath && !(journal.scope === 'project' && ['AGENTS.md', 'CLAUDE.md', 'docs/guidelines/project-coding.md', 'docs/guidelines/project-design.md'].includes(op.path))) allowed(op.path, journal.scope);
      if (seen.has(op.path) || ![op.before, op.after].every(x => x === null || typeof x === 'string')) throw new Error('Invalid recovery operation');
      seen.add(op.path);
      const current = await inspect(root, op.path);
      if (current !== op.before && current !== op.after) throw new Error(`Recovery conflict: ${op.path}; preserve and reconcile the concurrent edit.`);
    }
    for (const op of [...journal.operations].reverse()) {
      const current = await inspect(root, op.path);
      if (current !== op.before && current !== op.after) throw new Error(`Recovery conflict: ${op.path}`);
      if (op.before === null) await rm(join(root, op.path), { force: true });
      else await atomic(root, op.path, op.before);
    }
    await rm(join(root, journalPath));
  });
}

async function main() {
  const args = process.argv.slice(2), options = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') {
      console.log('Sync the complete AppElent toolkit. Node 22.15+ and authenticated gh required.\nOptions: --path <root>, --ref <ref> (retained; use main to reset), --dry-run, --check (offline),\n--source <local-checkout> (development), --recover.\nInstall skills separately with npx skills.'); return;
    }
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (['--dry-run', '--check', '--recover'].includes(flag)) { options[{ '--dry-run': 'dryRun', '--check': 'check', '--recover': 'recover' }[flag]] = true; continue; }
    if (!['--path', '--ref', '--source'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i]; if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}`);
    options[{ '--path': 'root', '--ref': 'ref', '--source': 'source' }[flag]] = value;
  }
  if ((options.check || options.recover) && (options.source || options.ref || options.dryRun || (options.check && options.recover))) throw new Error('Check/recovery cannot be combined with update options');
  if (options.recover) await recover(options.root ?? process.cwd());
  else await sync(options);
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
