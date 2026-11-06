import { readFileSync, existsSync } from 'node:fs';
const dir = new URL('../canvas/project/', import.meta.url);
const files = JSON.parse(readFileSync('manifest.json', 'utf8'));
let bad = 0; const inbound = {};
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const [tpl, script = ''] = src.split('data-dc-script');
  const loopVars = new Set([...tpl.matchAll(/as="(\w+)"/g)].map((m) => m[1]));
  const roots = new Set([...tpl.matchAll(/\{\{\s*([\w$.]+)\s*\}\}/g)].map((m) => m[1].split('.')[0]));
  for (const r of roots) {
    if (r === 'true' || r === 'false' || loopVars.has(r)) continue;
    if (!new RegExp(`\\b${r}\\b`).test(script)) { console.log(f, 'hole not in logic:', r); bad++; }
  }
  for (const m of tpl.matchAll(/href="([^"#:]+\.dc\.html)"/g)) {
    (inbound[m[1]] ??= new Set()).add(f);
    if (!existsSync(new URL(m[1], dir))) { console.log(f, 'dead link:', m[1]); bad++; }
  }
  if (/<a\b[^>]*>(?:(?!<\/a>).)*<button/s.test(tpl.replace(/<helmet>.*?<\/helmet>/s, ''))) { console.log(f, 'button inside a link'); bad++; }
  if (/href="#"/.test(tpl)) { console.log(f, 'empty link'); bad++; }
  const untwo = [...tpl.matchAll(/<h1\b/g)].length; if (!f.startsWith('Refs') && untwo !== 1) { console.log(f, 'h1 count', untwo); bad++; }
  const prim = (tpl.match(/class="pri"/g) || []).length;
  if (prim > 3) console.log(f, 'filled actions in markup:', prim);
  if (/—/.test(tpl)) { console.log(f, 'em dash'); bad++; }
  if (/\bfont-size: (?:[0-9]|1[01])px/.test(tpl)) { console.log(f, 'below 12px'); bad++; }
}
const orphans = files.filter((f) => !f.startsWith('Refs') && !inbound[f]);
console.log('no inbound link:', orphans.join(', ') || 'none');
console.log(bad ? `${bad} problems` : 'clean', '·', files.length, 'boards');
