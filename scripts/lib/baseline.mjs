import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeProjectPath, atomicWrite } from './env/files.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
async function read(root, path) {
  await assertSafeProjectPath(root, path);
  try { return await readFile(join(root, path), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function object(text, path) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`Cannot safely merge ${path}; preserve it and adapt using the feature guide.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object: ${path}`);
  return value;
}

export async function planBaseline(kind, options = {}) {
  if (!['general', 'web', 'mobile'].includes(kind)) throw new Error('Unknown baseline');
  const root = await realpath(options.root ?? process.cwd());
  const files = new Map(), notes = [], reads = new Map();
  const inspect = async path => {
    if (!reads.has(path)) reads.set(path, await read(root, path));
    return reads.get(path);
  };
  const create = async (path, after) => {
    const before = await inspect(path);
    if (before === null) files.set(path, { path, before, after });
    else if (before !== after) notes.push(`Preserved ${path}; review the feature guide for required settings.`);
  };
  const packageText = await inspect('package.json');
  await create('.editorconfig', 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = tab\n');
  await create('.gitattributes', '* text=auto eol=lf\n');
  if (packageText === null) {
    if (kind !== 'general') throw new Error(`Scaffold the ${kind} app with its upstream framework first.`);
    notes.push('No package.json: repository text settings only; no Node or pnpm application tooling added.');
  } else {
    const pkg = object(packageText, 'package.json');
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const lock of ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
      if (await inspect(lock) !== null) throw new Error(`Resolve package-manager migration first: ${lock}`);
    }
    if (pkg.packageManager && !/^pnpm@/.test(pkg.packageManager)) throw new Error('Existing package manager is not pnpm; migrate deliberately.');
    if (!pkg.packageManager) {
      const version = options.pnpmVersion ?? execFileSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
      if (!/^\d+\.\d+\.\d+$/.test(version) || Number(version.split('.')[0]) < 11) throw new Error('Supply --pnpm-version with a reviewed pnpm 11+ version');
      pkg.packageManager = `pnpm@${version}`;
    }
    pkg.scripts ??= {};
    if (typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) throw new Error('Invalid package scripts');
    const script = (name, command) => {
      if (!Object.hasOwn(pkg.scripts, name)) pkg.scripts[name] = command;
      else if (pkg.scripts[name] !== command) notes.push(`Preserved existing ${name} script.`);
    };
    if (dependencies['@biomejs/biome']) {
      script('check', 'biome check .'); script('format', 'biome format --write .');
      await create('biome.json', json({ formatter: { indentStyle: 'tab' }, javascript: { formatter: { quoteStyle: 'double' } } }));
    } else notes.push('Choose and install a compatible @biomejs/biome release to enable check/format setup.');
    if (dependencies.typescript) script('typecheck', 'tsc --noEmit');
    else notes.push('TypeScript is not declared; preserve the language/tooling choice or install it before typecheck setup.');
    if (dependencies.vitest) script('test', 'vitest run');
    else notes.push('No Vitest dependency; keep the existing test runner or add one explicitly.');
    await create('pnpm-workspace.yaml', '# Start from docs/standards/baseline/templates/pnpm-workspace.yaml; give every allowBuilds entry a reason.\nminimumReleaseAge: 4320\nallowBuilds: {}\n');
    if (kind === 'web') {
      if (!dependencies['@tanstack/react-start'] || !dependencies.vite) throw new Error('Web baseline requires an existing TanStack Start + Vite scaffold.');
      script('dev', 'vite dev --port 3000 --host'); script('build', 'vite build');
      if (dependencies.wrangler) { script('deploy', 'pnpm build && wrangler deploy'); script('cf-typegen', 'wrangler types'); }
      else notes.push('Install a framework-compatible Wrangler and Cloudflare Vite plugin before deploying.');
      if (await inspect('wrangler.jsonc') === null && await inspect('wrangler.toml') === null && await inspect('wrangler.json') === null) {
        if (!options.name || !/^[a-z][a-z0-9-]{0,62}$/.test(options.name)) throw new Error('New Worker config requires --name <worker-name>');
        await create('wrangler.jsonc', json({ name: options.name, main: '@tanstack/react-start/server-entry', compatibility_date: new Date().toISOString().slice(0, 10), compatibility_flags: ['nodejs_compat'], observability: { enabled: true } }));
      } else notes.push('Preserved existing Wrangler configuration, environments, dates, bindings, and routes.');
      notes.push('Wire the Cloudflare Vite plugin and auth/backend providers using the web-baseline guide; source wiring is app-owned.');
    }
    if (kind === 'mobile') {
      if (!dependencies.expo || !dependencies['expo-router']) throw new Error('Mobile baseline requires an existing Expo Router scaffold; run it at the app target root.');
      script('start', 'expo start --dev-client'); script('ios', 'expo run:ios'); script('android', 'expo run:android');
      await create('eas.json', json({ cli: { appVersionSource: 'remote' }, build: { development: { developmentClient: true, distribution: 'internal' }, preview: { distribution: 'internal' }, production: { autoIncrement: true } } }));
      notes.push('Preserved app identifiers, routes, SDK versions, and native dependencies. Install expo-dev-client before using start. Build/device acceptance and OTA compatibility remain explicit.');
    }
    if (options.ci) {
      const roles = kind === 'mobile' ? ['check', 'typecheck', 'test'] : ['check', 'typecheck', 'test', 'build'];
      if (roles.some(role => !pkg.scripts[role])) throw new Error(`CI requires declared scripts: ${roles.join(', ')}`);
      await create('.github/workflows/ci.yml', `name: CI\non: [push, pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: pnpm\n      - run: pnpm install --frozen-lockfile\n${roles.map(role => `      - run: pnpm ${role}\n`).join('')}`);
    }
    const after = json(pkg);
    if (JSON.stringify(pkg) !== JSON.stringify(object(packageText, 'package.json'))) files.set('package.json', { path: 'package.json', before: packageText, after });
  }
  return { root, kind, files: [...files.values()], notes, reads };
}

export async function applyBaseline(plan) {
  // No long-lived ownership receipt: files become app-owned after this bounded setup.
  const lock = join(plan.root, '.appelent/baseline.lock');
  await assertSafeProjectPath(plan.root, '.appelent/baseline.lock');
  await mkdir(join(plan.root, '.appelent'), { recursive: true });
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('Baseline is locked; verify no setup is active before clearing it.'); throw error; }
  try {
    for (const [path, expected] of plan.reads) if (await read(plan.root, path) !== expected) throw new Error(`Changed since planning: ${path}`);
    for (const file of plan.files) {
      if (await read(plan.root, file.path) !== file.before) throw new Error(`Concurrent edit: ${file.path}`);
      await atomicWrite(plan.root, file.path, file.after);
    }
  } finally { await rm(lock, { recursive: true }); }
}

export async function baselineMain(kind, args = process.argv.slice(2)) {
  const options = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help') { console.log(`node scripts/baseline${kind === 'general' ? '' : `-${kind}`}.mjs [--path project] [--pnpm-version version] [--name worker] [--ci] [--apply|--dry-run]\nDefault: preview paths and remaining manual requirements; no dependencies installed.`); return; }
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`); seen.add(key);
    if (['--apply', '--dry-run', '--ci'].includes(key)) { options[key.slice(2)] = true; continue; }
    if (!['--path', '--pnpm-version', '--name'].includes(key) || !args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`Invalid option: ${key}`);
    options[{ '--path': 'root', '--pnpm-version': 'pnpmVersion', '--name': 'name' }[key]] = args[++i];
  }
  if (options.apply && options['dry-run']) throw new Error('Choose --apply or --dry-run');
  const plan = await planBaseline(kind, options);
  for (const file of plan.files) console.log(`${file.before === null ? 'ADD' : 'UPDATE'} ${file.path}`);
  for (const note of plan.notes) console.log(`REVIEW ${note}`);
  if (options.apply) { await applyBaseline(plan); console.log('Configuration written. Run project checks and complete the feature guide.'); }
  else console.log('Preview only. Use --apply to write this configuration.');
}
