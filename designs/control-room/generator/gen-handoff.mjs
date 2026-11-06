import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = new URL('../canvas/project/', import.meta.url);
const files = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const decode = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const tidy = (b) => decode(b.replace(/\s+/g, ' ').replace(/( \| )+/g, ' | ').trim().replace(/^\| | \|$/g, '').trim());
const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i')); return m ? m[1] : null; };
export function parse(f) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const title = src.match(/<title>(.*?)<\/title>/)?.[1] ?? f;
  const afterHelmet = src.split('</helmet>')[1] ?? '';
  const tpl = afterHelmet.split('</x-dc>')[0];
  const script = src.match(/data-dc-script[^>]*>\n([\s\S]*?)<\/script>/)?.[1] ?? '';
  const state = script.match(/this\.state = (\{.*?\});/)?.[1] ?? null;
  const lines = []; const conds = []; let skip = 0; let buf = '';
  const flush = () => { const t = tidy(buf); if (t) lines.push(`${'  '.repeat(conds.length)}${t}`); buf = ''; };
  const push = (s) => { flush(); lines.push(`${'  '.repeat(conds.length)}${s}`); };
  const BLOCK = /^(div|p|h[1-6]|li|ul|ol|nav|main|aside|section|article|header|footer|dl|dt|dd|table|tr|td|th|thead|tbody|label|details|summary|pre|form|fieldset|legend)$/;
  for (const tok of tpl.split(/(<[^>]+>)/)) {
    if (!tok) continue;
    if (!tok.startsWith('<')) { if (!skip) buf += tok; continue; }
    const name = tok.match(/^<\/?\s*([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase() ?? '';
    const close = tok.startsWith('</');
    if (name === 'svg' || name === 'style') { if (close) skip--; else if (!tok.endsWith('/>')) skip++; continue; }
    if (skip) continue;
    if (name === 'sc-if') { flush(); if (close) { conds.pop(); } else { const v = attr(tok, 'value').replace(/[{}\s]/g, ''); lines.push(`${'  '.repeat(conds.length)}if ${v}:`); conds.push(v); } continue; }
    if (name === 'sc-for') { flush(); if (close) { conds.pop(); } else { const v = (attr(tok, 'list') ?? attr(tok, 'value') ?? '').replace(/[{}\s]/g, ''); lines.push(`${'  '.repeat(conds.length)}for ${attr(tok, 'as')} in ${v}:`); conds.push(v); } continue; }
    if (close && /^(span|strong|code|b|em|kbd|time)$/.test(name) && buf.trim()) { buf += ' | '; continue; }
    if (close) { if (name === 'a' || name === 'button') { const t = tidy(buf); buf = ''; const a = cur.pop(); push(`[${t}] ${a}`); } else if (BLOCK.test(name)) flush(); continue; }
    if (name === 'a' || name === 'button') { flush(); const href = attr(tok, 'href'); const on = attr(tok, 'onClick'); const dis = attr(tok, 'disabled'); cur.push(`${href ? `→ ${href.replace('.dc.html', '')}` : on ? `on ${on.replace(/[{}\s]/g, '')}` : '(inert)'}${dis ? ` disabled when ${dis.replace(/[{}\s]/g, '')}` : ''}`); continue; }
    if (BLOCK.test(name)) flush();
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = attr(tok, a); if (v) push(`(${a}: ${decode(v)})`); }
    if (name === 'input' || name === 'select' || name === 'textarea') { const ty = attr(tok, 'type') ?? name; const val = attr(tok, 'value'); const ch = attr(tok, 'checked'); const on = attr(tok, 'onChange'); push(`<${ty}${val ? ` value=${val}` : ''}${ch ? ` checked=${ch}` : ''}${on ? ` on ${on.replace(/[{}\s]/g, '')}` : ''}>`); }
    if (name === 'option') { flush(); }
    if (attr(tok, 'role') && !['img'].includes(attr(tok, 'role'))) push(`(role: ${attr(tok, 'role')})`);
  }
  flush();
  // strings living in logic
  const lits = [...script.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((x) => /[A-Za-z]{2}/.test(x) && (/\s/.test(x) || /^[A-Z]/.test(x)) && !/^(flex|inline|grid|block|none|#|\d)/.test(x));
  return { f, title, state, lines, script, lits: [...new Set(lits)] };
}
var cur = [];
const VARIANT = {
  QueueBack: 'Queue', QueueEmpty: 'Queue', QueueLimit: 'Queue', QueueLoading: 'Queue', QueueDegraded: 'Queue', QueueFirst: 'Queue',
  FloorLimit: 'FloorBoard', FloorReviewHold: 'FloorBoard', StopConfirm: 'FloorBoard', FloorStopped: 'FloorBoard', FloorLong: 'FloorBoard',
  ProjectPaused: 'ProjectDetail', ProjectBlockedRemove: 'ProjectDetail', ProjectLong: 'ProjectDetail', ProjectRemove: 'ProjectQuiet',
  ProjectsBulk: 'Projects', ProjectsBulkConfirm: 'Projects', ProjectsBulkDone: 'Projects',
  PullRequestsBulk: 'PullRequests', PullRequestsBulkConfirm: 'PullRequestsBulk', PullRequestsBulkDone: 'PullRequests', PullRequestsEmpty: 'PullRequests',
  ErrorsBulk: 'ErrorsList', ErrorsEmpty: 'ErrorsList', SettingsNotifyBlocked: 'SettingsNotifications', CmdKEmpty: 'CmdK',
  ErrorRegression: 'ErrorNew', ErrorSnoozed: 'ErrorNew', PRPassed: 'PRFix', PRFailed: 'PRFix', PRRebase: 'PRFix', PRLong: 'PRFix',
  WORunning: 'WOPlan', WOReady: 'WOPlan', WOQuestion: 'WOPlan', WOFailed: 'WOPlan', WOStopped: 'WOPlan', WORun211: 'WOPlan',
  HealthEarly: 'Health', FRToolsBlocked: 'FRTools', NLFailed: 'NLScaffold',
};
const SECTIONS = [
  ['Queue', ['Queue', 'QueueBack', 'QueueEmpty', 'QueueLimit', 'QueueLoading', 'QueueDegraded', 'AppOffline']],
  ['Error detail and new work', ['ErrorNew', 'ErrorRegression', 'ErrorSnoozed', 'NewWorkOrder']],
  ['Work order', ['WOPlan', 'WORunning', 'WOReady', 'WOQuestion', 'WOFailed', 'WOStopped', 'WORun211']],
  ['PR review', ['PRFix', 'PRPassed', 'PRFailed', 'PRRebase']],
  ['Floor', ['FloorBoard', 'FloorLimit', 'FloorReviewHold', 'StopConfirm', 'FloorStopped']],
  ['Health and command menu', ['Health', 'HealthEarly', 'CmdK', 'CmdKEmpty']],
  ['Project detail', ['ProjectDetail', 'ProjectPaused', 'ProjectBlockedRemove', 'ProjectQuiet', 'ProjectRemove', 'ProjectMissing']],
  ['Projects list and bulk sync', ['Projects', 'ProjectsBulk', 'ProjectsBulkConfirm', 'ProjectsBulkDone']],
  ['Pull requests list and bulk merge', ['PullRequests', 'PullRequestsEmpty', 'PullRequestsBulk', 'PullRequestsBulkConfirm', 'PullRequestsBulkDone']],
  ['Errors list and bulk', ['ErrorsList', 'ErrorsEmpty', 'ErrorsBulk']],
  ['Settings', ['SettingsAgents', 'SettingsApprovals', 'SettingsProjects', 'SettingsTools', 'SettingsNotifications', 'SettingsNotifyBlocked', 'NotifSamples']],
  ['Long text', ['ProjectLong', 'PRLong', 'FloorLong']],
  ['First run', ['FRTools', 'FRToolsBlocked', 'FRRepos', 'FRReading', 'QueueFirst']],
  ['New project', ['NLDescribe', 'NLApprove', 'NLScaffold', 'NLFailed', 'NLBaseline', 'NLConnect', 'NLDone']],
];
const scrub = (t) => t;
function clean(lines) {
  const out = []; let drop = 0; let inShell = false;
  for (const l of lines) {
    if (/^\s*\(title: \d+( events|.*)?\)$/.test(l)) continue;
    out.push(l);
  }
  // remove the shared shell block: from "[Skip to content]" through the Stop/Restart button
  const a = out.findIndex((l) => l.includes('[Skip to content]'));
  const b = out.findIndex((l) => /\[(Stop the line|Restart the line)\] →/.test(l));
  let shell = null;
  if (a >= 0 && b > a && out.slice(a, b).some((l) => l.includes('aria-label: Main'))) {
    shell = out.slice(a, b + 1);
    const status = shell.filter((l) => !l.startsWith('[') && !l.startsWith('(') && l !== 'Software Factory');
    const active = /Restart/.test(shell[shell.length - 1]) ? 'stopped' : 'running';
    out.splice(a, b - a + 1, `(shell: ${status.join(' · ')}; footer ${active === 'stopped' ? 'Restart the line' : 'Stop the line'})`);
  }
  return out;
}
if (process.argv[1].endsWith('gen-handoff.mjs')) {
  const out = process.argv[2];
  const all = {}; for (const f of files) if (!/^Refs|Narrow/.test(f)) { const b = parse(f); b.name = f.replace('.dc.html', ''); b.lines = clean(b.lines); all[b.name] = b; }
  const placed = new Set(SECTIONS.flatMap((x) => x[1]));
  const miss = Object.keys(all).filter((n) => !placed.has(n)); if (miss.length) throw new Error('unplaced ' + miss);
  const tmp = (n, t) => { const p = `${process.env.TMP_D}/${n}`; writeFileSync(p, t); return p; };
  let md = '';
  const seen = new Set();
  for (const [sec, names] of SECTIONS) {
    md += `\n## ${sec}\n`;
    for (const n of names) {
      if (seen.has(n)) continue; seen.add(n);
      const b = all[n]; if (!b) throw new Error('missing ' + n);
      md += `\n### ${n}: ${b.title}\n\n`;
      if (b.state) md += `Initial state: \`${b.state}\`\n\n`;
      const base = VARIANT[n] && all[VARIANT[n]];
      const body = b.lines.join('\n') + '\n';
      if (base) {
        const r = spawnSync('diff', ['-U0', tmp('a', base.lines.join('\n') + '\n'), tmp('b', body)], { encoding: 'utf8' });
        const d = r.stdout.split('\n').filter((l) => l && !/^(---|\+\+\+|@@)/.test(l));
        if (d.length === 0) md += `Same copy as ${VARIANT[n]}; differs only by its starting state above.\n`;
        else if (d.length > b.lines.length * 0.8) md += '```text\n' + body + '```\n';
        else md += `Changes from ${VARIANT[n]} (\`-\` removed, \`+\` added):\n\n` + '```diff\n' + d.join('\n') + '\n```\n';
      } else md += '```text\n' + body + '```\n';
      const baseLits = new Set(base ? base.lits : []);
      const extra = b.lits.filter((x) => !baseLits.has(x));
      if (extra.length) md += `\nStrings in logic:\n\n` + extra.map((x) => `- ${x}`).join('\n') + '\n';
    }
  }
  md = scrub(md);
  writeFileSync(out, md);
  console.log(Object.keys(all).length, 'boards', md.length, 'chars', md.split('\n').length, 'lines');
}
