import { writeFileSync } from 'node:fs';

const OUT = new URL('../canvas/project/', import.meta.url);

export const c = {
  canvas: '#0E1013', surface: '#121519', raised: '#1B2026', active: '#20252B',
  sub: '#23282E', ctl: '#2C3238', input: '#6B7480', text: '#E6E8EB', muted: '#9AA3AE',
  accent: '#F5A524', on: '#17120A', run: '#7AB8FF', pass: '#3DD6B0', fail: '#FF6B4A',
};
export const mono = "font-family: 'IBM Plex Mono', ui-monospace, monospace";
const sans = "font-family: 'IBM Plex Sans', system-ui, sans-serif";

/** Every board written, in order, so the canvas layout can be generated from the same list. */
export const written = [];

const HELMET = `<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
body{margin:0;background:${c.canvas};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
a{color:inherit;text-decoration:none}
.lnk{color:${c.text};text-decoration:underline;text-decoration-color:${c.input};text-underline-offset:2px}
.lnk:hover{text-decoration-color:${c.text}}
:focus-visible{outline:2px solid ${c.text};outline-offset:2px}
.row:hover,.nav:hover,.btn:hover{background:${c.raised} !important}
.card:hover{background:${c.active} !important}
.pri:hover{filter:brightness(1.08)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:8px;top:8px;z-index:10;background:${c.raised};padding:8px 12px;border-radius:6px}
.sec{margin:0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.muted}}
input,textarea,select{font:inherit;color:${c.text};background:${c.canvas};border:1px solid ${c.input};border-radius:6px;box-sizing:border-box}
input[type=text],input[type=search],select{height:36px;padding:0 10px}
textarea{padding:8px 10px;width:100%;resize:vertical}
input[type=radio],input[type=checkbox]{accent-color:${c.accent};width:16px;height:16px;margin:0;flex:none}
summary{cursor:pointer}
button:disabled{cursor:not-allowed}
@media (max-width:760px){
.sf-nav{flex:1 1 100% !important;max-width:none !important;flex-direction:row !important;align-items:center;overflow-x:auto;padding:8px 12px !important;border-inline-end:0 !important;border-block-end:1px solid ${c.sub}}
.sf-nav>a,.sf-foot a{flex:none;white-space:nowrap}
.sf-word,.sf-find{display:none !important}
.sf-foot{margin:0 !important;padding:0 !important;flex-direction:row !important;align-items:center}
.sf-foot>div{display:none}
.sf-pane{flex:1 1 100% !important;max-width:none !important;border-inline-start:0 !important;border-block-start:1px solid ${c.sub}}
main{flex:1 1 100% !important}
}
</style>
</helmet>`;

export function board({ file, title, body, logic = '', w = 1440, h = 900 }) {
  const script = logic || 'class Component extends DCLogic {\n  renderVals() { return {}; }\n}';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
${HELMET}
${body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
${script}
</script>
</body>
</html>
`;
  writeFileSync(new URL(file, OUT), html);
  written.push(file);
}

/** Build a DCLogic class from an initial state and a renderVals body. */
export const logic = (state, body, extra = '') => `class Component extends DCLogic {
  constructor(props) { super(props); this.state = ${JSON.stringify(state)}; }
${extra}
  renderVals() {
    const s = this.state;
${body}
  }
}`;

/* ---------- status glyphs: one SVG set, always next to text or inside a labeled group ---------- */
export function g(kind, size = 16) {
  const open = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" style="flex: none; display: block">`;
  const shapes = {
    ask: `<path d="M8 2 14 8 8 14 2 8Z" fill="${c.accent}"/>`,
    run: `<circle cx="8" cy="8" r="5.25" fill="none" stroke="${c.run}" stroke-width="1.5"/><path d="M8 2.75a5.25 5.25 0 0 1 0 10.5Z" fill="${c.run}"/>`,
    pass: `<circle cx="8" cy="8" r="5" fill="${c.pass}"/>`,
    fail: `<path d="M4 4l8 8M12 4l-8 8" stroke="${c.fail}" stroke-width="2" stroke-linecap="round"/>`,
    err: `<path d="M8 2.5 14 13H2Z" fill="${c.fail}"/>`,
    idle: `<circle cx="8" cy="8" r="4.5" fill="none" stroke="${c.muted}" stroke-width="1.5"/>`,
    gp: `<rect x="3" y="3" width="10" height="10" rx="1" fill="${c.pass}"/>`,
    gf: `<path d="M4 4l8 8M12 4l-8 8" stroke="${c.fail}" stroke-width="2" stroke-linecap="round"/>`,
    gr: `<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1" fill="none" stroke="${c.run}" stroke-width="1.5"/><rect x="8" y="3.75" width="4.25" height="8.5" fill="${c.run}"/>`,
    gi: `<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1" fill="none" stroke="${c.muted}" stroke-width="1.5"/>`,
  };
  return `${open}${shapes[kind]}</svg>`;
}

const GATE_NAMES = ['Typecheck', 'Tests', 'Lint', 'Preview'];
const GATE_WORD = { p: 'passed', f: 'failed', r: 'running', i: 'not started' };
const GATE_GLYPH = { p: 'gp', f: 'gf', r: 'gr', i: 'gi' };
/** Compact gates row, e.g. gates('ppfi'). Text alternative is the aria-label. */
export const gates = (code) => `<span role="img" aria-label="${[...code].map((x, i) => `${GATE_NAMES[i]} ${GATE_WORD[x]}`).join(', ')}" style="display: inline-flex; gap: 0">${[...code].map((x) => g(GATE_GLYPH[x], 14)).join('')}</span>`;

/* ---------- text ---------- */
export const m = (text, color = c.text) => `<span style="${mono}; font-size: 12px; color: ${color}">${text}</span>`;
export const muted = (text) => `<span style="color: ${c.muted}; font-size: 12px">${text}</span>`;
export const p = (text, extra = '') => `<p style="margin: 0; color: ${c.muted}; ${extra}">${text}</p>`;
export const sec = (text, level = 2) => `<h${level} class="sec">${text}</h${level}>`;
export const h2 = (text) => `<h2 style="margin: 0; font-size: 16px; line-height: 1.35; font-weight: 600">${text}</h2>`;
export const h3 = (text) => `<h3 style="margin: 0; font-size: 13px; font-weight: 600">${text}</h3>`;
export const lnk = (text, href) => `<a class="lnk" href="${href}">${text}</a>`;
export const code = (text) => `<pre style="margin: 0; padding: 12px; background: ${c.canvas}; border: 1px solid ${c.sub}; border-radius: 6px; ${mono}; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere">${text}</pre>`;

/* ---------- controls ---------- */
const btnBase = 'display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; padding: 0 12px; border-radius: 6px; font: inherit; white-space: nowrap; cursor: pointer';
const attrs = (o) => `${o.on ? ` onClick="{{${o.on}}}"` : ''}${o.disabled ? ` disabled="{{${o.disabled}}}"` : ''}`;
const tag = (label, o, cls, style) => (o.href
  ? `<a class="${cls}" href="${o.href}" style="${style}">${label}</a>`
  : `<button type="button" class="${cls}"${attrs(o)} style="${style}">${label}</button>`);

/** The one filled action per view. */
export const pri = (label, o = {}) => tag(label, o, 'pri', `${btnBase}; min-height: 44px; background: ${c.accent}; border: 0; color: ${c.on}; font-weight: 600; ${o.grow ? 'width: 100%' : ''}`);
export const btn = (label, o = {}) => tag(label, o, 'btn', `${btnBase}; min-height: 36px; background: transparent; border: 1px solid ${c.ctl}; color: ${c.text}; ${o.grow ? 'width: 100%' : ''}`);
export const danger = (label, o = {}) => tag(label, o, 'btn', `${btnBase}; min-height: 36px; background: transparent; border: 1px solid ${c.ctl}; color: ${c.fail}; font-weight: 500; ${o.grow ? 'width: 100%' : ''}`);
export const dangerFill = (label, o = {}) => tag(label, o, 'pri', `${btnBase}; min-height: 44px; background: ${c.fail}; border: 0; color: ${c.on}; font-weight: 600`);

export const iff = (hole, body, hint = 'true') => `<sc-if value="{{${hole}}}" hint-placeholder-val="{{${hint}}}">${body}</sc-if>`;

export const field = (id, label, control, hint = '') => `<div style="display: flex; flex-direction: column; gap: 4px">
  <label for="${id}" style="font-weight: 500">${label}</label>
  ${control}
  ${hint ? `<span id="${id}-hint" style="color: ${c.muted}; font-size: 12px">${hint}</span>` : ''}
</div>`;

/** Radio or checkbox with its label as one hit target. */
export const choice = (type, name, title, desc, o = {}) => `<label style="display: flex; gap: 8px; padding: 8px 12px; align-items: flex-start; border-radius: 6px; cursor: pointer">
  <input type="${type}" name="${name}"${o.checked ? ` checked="{{${o.checked}}}"` : ''}${o.onChange ? ` onChange="{{${o.onChange}}}"` : ''} style="margin-top: 2px">
  <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-weight: 500">${title}</span>${desc ? `<span style="color: ${c.muted}; font-size: 12px">${desc}</span>` : ''}</span>
</label>`;

/* ---------- blocks ---------- */
export const facts = (rows) => `<dl style="margin: 0; display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px 12px; font-size: 12px">${rows.map(([k, v, isMono]) => `<dt style="color: ${c.muted}">${k}</dt><dd style="margin: 0; ${isMono ? mono + '; overflow-wrap: anywhere' : ''}">${v}</dd>`).join('')}</dl>`;

export const banner = ({ glyph, title, body = '', actions = '', role = '' }) => `<div${role ? ` role="${role}"` : ''} style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 16px; background: ${c.surface}; border: 1px solid ${c.sub}; border-radius: 8px">
  ${glyph ? g(glyph) : ''}
  <div style="flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 2px"><strong style="font-weight: 600">${title}</strong>${body ? `<span style="color: ${c.muted}">${body}</span>` : ''}</div>
  ${actions ? `<div style="display: flex; flex-wrap: wrap; gap: 8px">${actions}</div>` : ''}
</div>`;

export const trail = (crumbs) => `<nav aria-label="Breadcrumb"><ol style="list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; color: ${c.muted}; font-size: 12px">${crumbs.map(([label, href], i) => `<li style="display: flex; gap: 4px">${i ? '<span aria-hidden="true">/</span>' : ''}${href ? `<a class="lnk" style="color: ${c.muted}" href="${href}">${label}</a>` : `<span aria-current="page">${label}</span>`}</li>`).join('')}</ol></nav>`;

export const sk = (w, h = 12) => `<div style="width: ${w}; height: ${h}px; border-radius: 4px; background: ${c.raised}"></div>`;

/** One-series histogram. Text alternative in aria-label; hover value in title. */
export const bars = (vals, { label, hi = () => false, height = 48, unit = '' }) => {
  const max = Math.max(...vals);
  return `<div role="img" aria-label="${label}" style="display: flex; align-items: flex-end; gap: 2px; height: ${height}px">${vals.map((v, i) => `<span title="${v}${unit}" style="flex: 1 1 0; height: ${Math.max(2, Math.round((v / max) * height))}px; border-radius: 2px 2px 0 0; background: ${hi(v, i) ? c.fail : c.input}"></span>`).join('')}</div>`;
};

/* ---------- application shell ---------- */
const NAV = [
  ['Queue', 'Queue.dc.html', '7'], ['Floor', 'FloorBoard.dc.html', '7'], ['Pull requests', 'PullRequests.dc.html', '7'],
  ['Errors', 'ErrorsList.dc.html', '3'], ['Projects', 'Projects.dc.html', '12'], ['Health', 'Health.dc.html', ''],
];

export function shell({ active, main, pane = '', stopped = false, status, counts = true, overlay = '' }) {
  const links = NAV.map(([label, href, n]) => {
    const on = label === active;
    return `<a class="nav" href="${href}"${on ? ' aria-current="page"' : ''} style="display: flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 6px; font-weight: ${on ? 600 : 400}; background: ${on ? c.active : 'transparent'}"><span>${label}</span>${counts && n ? `<span style="margin-inline-start: auto; ${mono}; font-size: 12px; color: ${c.muted}">${n}</span>` : ''}</a>`;
  }).join('\n      ');
  const st = status ?? (stopped ? ['Line stopped at 14:02', 'Synced 1m ago'] : ['2 of 3 agents working', 'Synced 1m ago']);
  return `<div style="position: relative; min-height: 900px; background: ${c.canvas}; color: ${c.text}; ${sans}; font-size: 13px; line-height: 1.4; display: flex; flex-wrap: wrap; align-items: stretch">
  <a class="skip" href="#main">Skip to content</a>
  <nav class="sf-nav" aria-label="Main" style="flex: 1 1 216px; max-width: 216px; min-width: 200px; box-sizing: border-box; background: ${c.surface}; border-inline-end: 1px solid ${c.sub}; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px">
    <div class="sf-word" style="padding: 4px 12px 16px; font-size: 16px; font-weight: 600">Software Factory</div>
    <a class="btn sf-find" href="CmdK.dc.html" style="min-height: 36px; display: flex; align-items: center; padding: 0 12px; margin-block-end: 12px; background: ${c.canvas}; border: 1px solid ${c.ctl}; border-radius: 6px; color: ${c.muted}; font-size: 12px">Search or run a command<span style="margin-inline-start: auto; ${mono}">⌘K</span></a>
      ${links}
    <div class="sf-foot" style="margin-block-start: auto; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">
      <a class="nav" href="SettingsAgents.dc.html"${active === 'Settings' ? ' aria-current="page"' : ''} style="display: flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 6px; font-weight: ${active === 'Settings' ? 600 : 400}; background: ${active === 'Settings' ? c.active : 'transparent'}">Settings</a>
      <div style="padding: 0 12px; color: ${c.muted}; font-size: 12px">${st.map((t) => `<div>${t}</div>`).join('')}</div>
      ${stopped ? btn('Restart the line', { href: 'FloorBoard.dc.html', grow: true }) : danger('Stop the line', { href: 'StopConfirm.dc.html', grow: true })}
    </div>
  </nav>
  <main id="main" style="flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column">
${main}
  </main>
${pane ? `  <aside class="sf-pane" aria-label="Details" style="flex: 1 1 340px; max-width: 380px; min-width: 300px; box-sizing: border-box; background: ${c.surface}; border-inline-start: 1px solid ${c.sub}; padding: 20px; display: flex; flex-direction: column; gap: 16px">
${pane}
  </aside>` : ''}
${overlay}
</div>`;
}

/** Modal over a dimmed ground. In the app: focus moves in, background is inert, Escape closes, focus returns. */
export const dialog = (id, title, body, width = 480) => `<div style="position: absolute; inset: 0; background: rgba(14, 16, 19, 0.78); display: flex; justify-content: center; align-items: flex-start; padding: 96px 16px 16px; box-sizing: border-box">
  <div role="dialog" aria-modal="true" aria-labelledby="${id}" style="width: 100%; max-width: ${width}px; background: ${c.raised}; border: 1px solid ${c.ctl}; border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); padding: 20px; display: flex; flex-direction: column; gap: 16px">
    <h2 id="${id}" style="margin: 0; font-size: 16px; line-height: 1.35; font-weight: 600">${title}</h2>
    ${body}
  </div>
</div>`;

/** Setup pages: wordmark, step rail, one column. Used by first run and new project. */
export function setup({ crumbs, steps, current, title, lead, main, aside = '' }) {
  const rail = steps.map((s, i) => {
    const done = i < current; const on = i === current;
    return `<li${on ? ' aria-current="step"' : ''} style="display: flex; align-items: center; gap: 8px; min-height: 32px; font-weight: ${on ? 600 : 400}; color: ${on || done ? c.text : c.muted}">${g(done ? 'pass' : on ? 'run' : 'idle')}<span>${s}</span></li>`;
  }).join('');
  return `<div style="min-height: 900px; background: ${c.canvas}; color: ${c.text}; ${sans}; font-size: 13px; line-height: 1.4; display: flex; flex-wrap: wrap; align-items: stretch">
  <a class="skip" href="#main">Skip to content</a>
  <div style="flex: 1 1 240px; max-width: 280px; box-sizing: border-box; background: ${c.surface}; border-inline-end: 1px solid ${c.sub}; padding: 20px 24px; display: flex; flex-direction: column; gap: 24px">
    <div style="font-size: 16px; font-weight: 600">Software Factory</div>
    <ol aria-label="Steps" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px">${rail}</ol>
  </div>
  <main id="main" style="flex: 999 1 560px; min-width: 0; box-sizing: border-box; padding: 32px 24px; display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; justify-content: center">
    <div style="flex: 1 1 560px; max-width: 720px; min-width: 0; display: flex; flex-direction: column; gap: 20px">
      ${crumbs ? trail(crumbs) : ''}
      <div style="display: flex; flex-direction: column; gap: 4px">
        <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">${title}</h1>
        ${lead ? p(lead, 'max-width: 62ch') : ''}
      </div>
      ${main}
    </div>
    ${aside}
  </main>
</div>`;
}

/** Reference sheet: each figure names its source and what it contributed. */
export function refs(file, title, items) {
  const w = 1440; const h = 620;
  const figs = items.map(([src, alt, url, cap]) => `<figure style="margin: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0">
    <img src="${src}" alt="${alt}" style="width: 100%; height: 480px; object-fit: contain; object-position: left top">
    <figcaption style="color: ${c.muted}"><a class="lnk" href="https://mobbin.com/screens/${url}?utm_source=claude&amp;utm_medium=ai-assistant&amp;utm_source_platform=mcp">${alt.split(':')[0]}</a>: ${cap}</figcaption>
  </figure>`).join('\n');
  board({ file, title, w, h, body: `<div style="width: ${w}px; height: ${h}px; box-sizing: border-box; padding: 24px; background: ${c.canvas}; color: ${c.text}; ${sans}; font-size: 13px; display: grid; grid-template-columns: repeat(${items.length}, minmax(0, 1fr)); gap: 24px">${figs}</div>` });
}
