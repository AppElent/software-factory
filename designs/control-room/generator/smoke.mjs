import { readFileSync } from 'node:fs';
const dir = new URL('../canvas/project/', import.meta.url);
const files = JSON.parse(readFileSync('manifest.json', 'utf8'));
class DCLogic { constructor(props) { this.props = props; this.state = {}; } setState(n) { this.state = { ...this.state, ...n }; this.vals = this.renderVals(); } }
const look = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
let bad = 0, fired = 0;
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const sm = src.match(/data-dc-script[^>]*>\n([\s\S]*?)<\/script>/); const tpl = src.split('data-dc-script')[0];
  let C; try { C = new Function('DCLogic', 'setTimeout', `${sm[1]}\nreturn Component;`)(DCLogic, () => 1); } catch (e) { console.log(f, 'SYNTAX', e.message); bad++; continue; }
  const inst = new C({}); let v;
  try { v = inst.renderVals(); } catch (e) { console.log(f, 'RENDER', e.message); bad++; continue; }
  const loops = new Set([...tpl.matchAll(/as="(\w+)"/g)].map((m) => m[1]));
  const holes = [...new Set([...tpl.matchAll(/\{\{\s*([\w$.]+)\s*\}\}/g)].map((m) => m[1]))].filter((h) => !['true', 'false'].includes(h) && !loops.has(h.split('.')[0]));
  for (const h of holes) if (look(v, h) === undefined) { console.log(f, 'undefined hole', h); bad++; }
  // fire every handler once on a fresh instance, then re-render
  const handlers = [...tpl.matchAll(/on(?:Click|Change)="\{\{\s*([\w.]+)\s*\}\}"/g)].map((m) => m[1]).filter((h) => !loops.has(h.split('.')[0]));
  for (const h of new Set(handlers)) {
    const i2 = new C({}); const vals = i2.renderVals(); const fn = look(vals, h);
    if (typeof fn !== 'function') { console.log(f, 'not a function', h); bad++; continue; }
    try { fn({ target: { value: '5' } }); i2.renderVals(); fired++; } catch (e) { console.log(f, 'HANDLER', h, e.message); bad++; }
  }
}
console.log(bad ? `${bad} problems` : 'logic clean', '· handlers fired', fired);
