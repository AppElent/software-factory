import { readFileSync, writeFileSync } from 'node:fs';
import { c, mono, g, gates, m, muted, p, sec, h2, lnk, code, pri, btn, danger, dangerFill, iff, field, facts, banner, trail, board, logic, shell, dialog, refs, written, choice } from './lib.mjs';
import { pr, floor, allPass, mergeBtn, listHead, th, td, P, PD, PROJECTS } from './core2.mjs';

const sans = "font-family: 'IBM Plex Sans', system-ui, sans-serif";
const page = (inner) => `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">${inner}</div>`;
const filter = (id) => `<label for="${id}" style="color: ${c.muted}; font-size: 12px">Project</label><select id="${id}" value="{{pr}}" onChange="{{pickP}}">${PROJECTS.map((x) => `<option>${x}</option>`).join('')}</select>`;
const box = (id, label) => `<label style="display: flex; align-items: center; justify-content: center; width: 36px; min-height: 44px; flex: none; cursor: pointer"><input type="checkbox" aria-label="Select ${label}" checked="{{sel.${id}}}" onChange="{{tog.${id}}}"></label>`;
const spacer = '<span style="width: 36px; flex: none"></span>';
const bar = (inner) => `<div role="region" aria-label="Bulk actions" style="position: sticky; bottom: 16px; margin: auto 24px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; background: ${c.raised}; border: 1px solid ${c.ctl}; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4)">${inner}</div>`;
const barCount = `<span role="status" style="${mono}; font-size: 12px">{{n}} selected</span>${btn('Clear', { on: 'clear' })}`;
const end = (inner) => `<span style="margin-inline-start: auto; display: flex; flex-wrap: wrap; gap: 8px">${inner}</span>`;
const emptyFilter = `${iff('noneShown', `<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start"><p role="status" style="margin: 0">Nothing open in {{pr}}.</p>${btn('Show all projects', { on: 'allP' })}</div>`, 'false')}`;

/* Shared logic for the selectable, filterable lists. */
const listLogic = (rows, init, extra) => logic({ pr: 'All projects', sel: {}, gone: {}, ask: false, note: '', ...init }, `
    const R = ${JSON.stringify(rows.map((r) => [r.id, r.pr, r.k, r.label]))};
    const vis = {}, sel = {}, tog = {}, gc = {}, gv = {}; let shown = 0; const names = new Set();
    R.forEach(([id, pr, k]) => {
      const on = (s.pr === 'All projects' || s.pr === pr) && !s.gone[id];
      vis[id] = on; sel[id] = !!s.sel[id] && on;
      tog[id] = () => this.setState({ sel: { ...s.sel, [id]: !s.sel[id] } });
      gc[k] = (gc[k] || 0) + (on ? 1 : 0); gv[k] = gc[k] > 0;
      if (on) { shown++; names.add(pr); }
    });
    const chosen = R.filter(([id]) => sel[id]).map(([id, pr, k, label]) => ({ id, label, pr }));
    const n = chosen.length;
    const base = { pr: s.pr, vis, sel, tog, gc, gv, n, some: n > 0, chosen, ask: s.ask, shown,
      noneShown: shown === 0, allP: () => this.setState({ pr: 'All projects' }),
      pickP: (e) => this.setState({ pr: e.target.value }),
      clear: () => this.setState({ sel: {} }), askOn: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }),
      note: s.note, hasNote: !!s.note };
    ${extra}`);

/* ========== PULL REQUESTS: filter works; ready PRs can merge together ========== */
const prRow = (r, sel) => iff(`vis.${r.id}`, `<div style="display: flex; align-items: center">${sel && r.ready ? box(r.id, `PR ${r.num}`) : sel ? spacer : ''}<a class="row" href="${r.href}" style="flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g(r.gl)}${m(r.num, c.muted)}<span style="flex: 1 1 220px; min-width: 0; font-weight: 500; overflow-wrap: anywhere">${r.t}</span><span style="width: 88px; color: ${c.muted}">${r.pr}</span><span style="width: 56px">${gates(r.gt)}</span><span style="width: 88px; text-align: end">${m(r.size, c.muted)}</span><span style="width: 32px; text-align: end">${m(r.age, c.muted)}</span></a></div>`);
const prGroups = (rows, order, sel) => order.map(([k, name]) => iff(`gv.${k}`, `<section aria-label="${name}" style="display: flex; flex-direction: column; gap: 4px"><h2 class="sec">${name} · {{gc.${k}}}</h2>${rows.filter((r) => r.k === k).map((r) => prRow(r, sel)).join('')}</section>`)).join('');
const PR_ORDER = [['ready', 'Ready to merge'], ['failed', 'Gate failed'], ['run', 'Running'], ['rebase', 'Needs rebase'], ['stale', 'Stale']];
const pr1 = (id, k, href, gl, num, t, project, gt, size, age, ready) => ({ id, k, href, gl, num, t, pr: project, gt, size, age, ready, label: `${num} ${t} · ${project}` });
const OPEN = [
  pr1('a', 'ready', 'PRPassed.dc.html', 'pass', '#168', 'Sync toolkit standards', 'Foundry', 'pppp', '+214 −98', '1h'),
  pr1('b', 'failed', 'PRFailed.dc.html', 'fail', '#94', 'Course search empty state', 'Fairway', 'pppf', '+88 −12', '3h'),
  pr1('c', 'run', 'WORun211.dc.html', 'run', '#101', 'Retry failed sync once', 'Gather', 'prii', '+22 −9', '6m'),
  pr1('d', 'run', 'WORun211.dc.html', 'run', '#61', 'Daily score reset', 'Arcade Club', 'ppri', '+140 −6', '12m'),
  pr1('e', 'rebase', 'PRRebase.dc.html', 'idle', '#240', 'Export your data as JSON', 'Gather', 'iiii', '+402 −31', '18d'),
  pr1('f', 'rebase', 'PRRebase.dc.html', 'idle', '#118', 'Add support code for Foundry Ops', 'Foundry', 'iiii', '+96 −4', '40d'),
  pr1('g', 'stale', 'PRRebase.dc.html', 'idle', '#127', 'Provider-backed task lists', 'Gather', 'iiii', '+1204 −311', '87d'),
];
const prSub = "sub: shown + ' open in ' + names.size + (names.size === 1 ? ' project' : ' projects')";
board({
  file: 'PullRequests.dc.html', title: 'Pull requests', logic: listLogic(OPEN, {}, `return { ...base, ${prSub} };`),
  body: shell({ active: 'Pull requests', main: page(`${listHead('Pull requests', '{{sub}}', filter('pr-p'))}${prGroups(OPEN, PR_ORDER, false)}${emptyFilter}`) }),
});
const READY = [
  pr1('a', 'ready', 'PRPassed.dc.html', 'pass', '#168', 'Sync toolkit standards', 'Foundry', 'pppp', '+214 −98', '1h', true),
  pr1('h', 'ready', 'PRPassed.dc.html', 'pass', '#62', 'Sync toolkit standards', 'Arcade Club', 'pppp', '+96 −41', '9m', true),
  pr1('i', 'ready', 'PRPassed.dc.html', 'pass', '#31', 'Sync toolkit standards', 'satisfactory', 'pppp', '+302 −117', '7m', true),
  pr1('j', 'ready', 'PRPassed.dc.html', 'pass', '#12', 'Sync toolkit standards', 'roadmaps', 'pppp', '+188 −64', '4m', true),
  ...OPEN.slice(1),
];
const mergeLabel = "mergeLabel: 'Merge ' + n + (n === 1 ? ' PR' : ' PRs'), askTitle: 'Merge ' + n + (n === 1 ? ' PR?' : ' PRs?')";
const mergeDialog = iff('ask', dialog('bm', '{{askTitle}}', `<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px"><sc-for list="{{chosen}}" as="x" hint-placeholder-count="3"><li style="display: flex; align-items: center; gap: 8px">${gates('pppp')}<span style="overflow-wrap: anywhere">{{x.label}}</span></li></sc-for></ul>
  ${p("All 4 gates passed on each one. They merge one at a time and each ships to production as it merges. If one can't merge, it stays open and the rest continue. You can't undo a merge from here.")}
  <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${pri('{{mergeLabel}}', { href: 'PullRequestsBulkDone.dc.html' })}</div>`), 'false');
const prBulk = (file, title, init, top = '', rows = READY, sub = true) => board({
  file, title, logic: listLogic(rows, init, `return { ...base, ${prSub}, ${mergeLabel} };`),
  body: shell({
    active: 'Pull requests', overlay: mergeDialog,
    main: `${page(`${listHead('Pull requests', '{{sub}}', filter('pr-p'))}${top}${prGroups(rows, PR_ORDER, sub)}${emptyFilter}`)}${iff('some', bar(`${barCount}${end(pri('{{mergeLabel}}', { on: 'askOn' }))}`), 'true')}`,
  }),
});
prBulk('PullRequestsBulk.dc.html', 'Pull requests: several selected', { sel: { a: true, h: true, i: true } });
prBulk('PullRequestsBulkConfirm.dc.html', 'Pull requests: confirm merging', { sel: { a: true, h: true, i: true }, ask: true });
const AFTER = [
  pr1('j', 'ready', 'PRPassed.dc.html', 'pass', '#12', 'Sync toolkit standards', 'roadmaps', 'pppp', '+188 −64', '4m', true),
  ...OPEN.slice(1, 4),
  pr1('i', 'rebase', 'PRRebase.dc.html', 'idle', '#31', 'Sync toolkit standards', 'satisfactory', 'iiii', '+302 −117', '7m'),
  ...OPEN.slice(4),
];
prBulk('PullRequestsBulkDone.dc.html', 'Pull requests: merged, one blocked', {}, banner({ glyph: 'fail', role: 'status', title: "2 merged. #31 couldn't merge.", body: 'Foundry #168 and Arcade Club #62 are shipping now. satisfactory moved on while #31 waited, so it needs a rebase.', actions: `${btn('Start rebase work order', { href: 'PRRebase.dc.html' })}${btn('See the floor', { href: 'FloorBoard.dc.html' })}` }), AFTER);

/* ========== ERRORS: filter works; select to start work, snooze, or dismiss ========== */
const E = [
  { id: 'a', k: 'fairway', pr: 'Fairway', href: 'ErrorNew.dc.html', gl: 'err', t: "TypeError reading 'holes'", st: 'New', ev: '41 events', us: '14 users', age: '3h', label: "TypeError reading 'holes'" },
  { id: 'b', k: 'fairway', pr: 'Fairway', href: 'ErrorRegression.dc.html', gl: 'err', t: 'NetworkError fetching course list', st: 'Regression', ev: '12 events', us: '5 users', age: '1d', label: 'NetworkError fetching course list' },
  { id: 'c', k: 'gather', pr: 'Gather', href: 'ErrorSnoozed.dc.html', gl: 'idle', t: 'Task sync timed out', st: 'Snoozed', ev: '6 events', us: '2 users', age: '2d', label: 'Task sync timed out' },
];
const errRow = (r) => iff(`vis.${r.id}`, `<div style="display: flex; align-items: center">${box(r.id, r.t)}<a class="row" href="${r.href}" style="flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g(r.gl)}<span style="flex: 1 1 280px; min-width: 0; font-weight: 500; overflow-wrap: anywhere">${r.t}</span><span style="width: 96px; color: ${c.muted}; font-size: 12px">${r.st}</span><span style="width: 88px; text-align: end">${m(r.ev, c.muted)}</span><span style="width: 72px; text-align: end">${m(r.us, c.muted)}</span><span style="width: 32px; text-align: end">${m(r.age, c.muted)}</span></a></div>`);
const errGroup = (k, name) => iff(`gv.${k}`, `<section aria-label="${name}" style="display: flex; flex-direction: column; gap: 4px"><h2 class="sec">${name} · {{gc.${k}}}</h2>${E.filter((r) => r.k === k).map(errRow).join('')}</section>`);
const errExtra = `
    const hide = (word) => () => { const gone = { ...s.gone }; const last = []; chosen.forEach((x) => { gone[x.id] = true; last.push(x.id); }); this.setState({ gone, sel: {}, last, note: word + ' ' + n + (n === 1 ? ' error.' : ' errors.') }); };
    return { ...base, sub: shown + ' open in ' + names.size + (names.size === 1 ? ' project' : ' projects'),
      startLabel: n === 1 ? 'Start work order' : 'Start ' + n + ' work orders',
      snooze: hide('Snoozed'), dismiss: hide('Dismissed'),
      undo: () => { const gone = { ...s.gone }; (s.last || []).forEach((id) => { delete gone[id]; }); this.setState({ gone, note: '' }); } };`;
const errBoard = (file, title, init) => board({
  file, title, logic: listLogic(E, init, errExtra),
  body: shell({
    active: 'Errors',
    main: `${page(`${listHead('Errors', '{{sub}}', filter('er-p'))}${errGroup('fairway', 'Fairway')}${errGroup('gather', 'Gather')}${emptyFilter}
      <div role="status" style="min-height: 36px">${iff('hasNote', `<span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 12px">{{note}} ${btn('Undo', { on: 'undo' })}</span>`, 'false')}</div>
      ${p('7 other projects have no open errors. 3 have no Sentry yet. Checked 1 minute ago.', 'font-size: 12px')}`)}
      ${iff('some', bar(`${barCount}${end(`${btn('Snooze', { on: 'snooze' })}${btn('Dismiss', { on: 'dismiss' })}${pri('{{startLabel}}', { href: 'FloorBoard.dc.html' })}`)}`), 'false')}`,
  }),
});
errBoard('ErrorsList.dc.html', 'Errors', {});
errBoard('ErrorsBulk.dc.html', 'Errors: two selected', { sel: { a: true, b: true } });

/* ========== PROJECTS: select those behind and sync them together ========== */
const PX = P.map(([n, repo, w, pr2, e, tk, d], i) => ({ id: `p${i}`, n, repo, w, pr2, e, tk, d, behind: tk.includes('behind') }));
const BEHIND = PX.filter((x) => x.behind);
const projLogic = (init) => logic({ sel: {}, ask: false, done: null, ...init }, `
    const B = ${JSON.stringify(BEHIND.map((x) => [x.id, x.n, x.tk]))};
    const d = s.done || { ok: [], bad: [] };
    const sel = {}, tog = {}, idle = {}, started = {}, failed = {};
    B.forEach(([id]) => {
      started[id] = d.ok.includes(id); failed[id] = d.bad.includes(id); idle[id] = !started[id] && !failed[id];
      sel[id] = !!s.sel[id] && idle[id];
      tog[id] = () => this.setState({ sel: { ...s.sel, [id]: !s.sel[id] } });
    });
    const chosen = B.filter(([id]) => sel[id]).map(([id, n, tk]) => ({ id, n, tk }));
    const n = chosen.length; const left = B.filter(([id]) => idle[id]);
    const now = Math.min(n, 1); const wait = n - now;
    const okN = d.ok.length;
    const syncOne = {}; B.forEach(([id]) => { syncOne[id] = () => this.setState({ sel: { [id]: true }, ask: true }); });
    return { sel, tog, idle, started, failed, syncOne, chosen, n, some: n > 0, none: n === 0, ask: s.ask,
      canAll: n === 0 && left.length > 1, allLabel: 'Select ' + left.length + ' behind',
      selectAll: () => { const next = {}; left.forEach(([id]) => { next[id] = true; }); this.setState({ sel: next }); },
      clear: () => this.setState({ sel: {} }), askOn: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false, sel: n === 1 ? {} : s.sel }),
      syncLabel: 'Sync ' + n + (n === 1 ? ' project' : ' projects'),
      askTitle: n === 1 ? 'Sync ' + chosen[0].n + '?' : 'Start ' + n + ' sync work orders?',
      startLabel: n === 1 ? 'Start work order' : 'Start ' + n + ' work orders',
      slots: 'Each runs on its own worktree and opens a PR for you to merge. 1 agent slot is free, so ' + (wait ? now + ' starts now and ' + wait + (wait === 1 ? ' waits' : ' wait') + ' in Intake.' : 'it starts now.'),
      start: () => { const ids = chosen.map((x) => x.id); const prev = s.done || { ok: [], bad: [] }; this.setState({ ask: false, sel: {}, done: { ok: [...prev.ok, ...ids.filter((x) => x !== '${BEHIND.find((x) => x.n === 'labs').id}')], bad: [...prev.bad, ...ids.filter((x) => x === '${BEHIND.find((x) => x.n === 'labs').id}')] } }); },
      hasDone: !!s.done, hasBad: d.bad.length > 0,
      doneTitle: okN + (okN === 1 ? ' sync work order started' : ' sync work orders started') + (d.bad.length ? ", labs couldn't start" : ''),
      doneBody: (okN > 1 ? '1 is building and ' + (okN - 1) + (okN === 2 ? ' waits' : ' wait') + ' in Intake. ' : '') + 'Their PRs land in Pull requests.' + (d.bad.length ? " labs isn't in its folder on this Mac." : ''),
      sub: '12 projects · ' + left.length + ' behind on the toolkit' };`);
const projRow = (x) => {
  const tkCell = x.behind
    ? `${iff(`idle.${x.id}`, `<span style="display: inline-flex; align-items: center; gap: 8px">${g('idle', 14)}<span>${x.tk}</span>${btn('Sync', { on: `syncOne.${x.id}` })}</span>`)}${iff(`started.${x.id}`, `<a class="lnk" href="FloorBoard.dc.html" style="display: inline-flex; align-items: center; gap: 8px">${g('run', 14)}Sync started</a>`, 'false')}${iff(`failed.${x.id}`, `<a class="lnk" href="ProjectMissing.dc.html" style="display: inline-flex; align-items: center; gap: 8px">${g('fail', 14)}Folder missing</a>`, 'false')}`
    : `<span style="display: inline-flex; align-items: center; gap: 8px">${g('pass', 14)}<span>${x.tk}</span></span>`;
  return `<tr><td style="padding: 0 0 0 4px; border-block-end: 1px solid ${c.sub}; width: 36px">${x.behind ? iff(`idle.${x.id}`, box(x.id, x.n)) : ''}</td><th scope="row" style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; text-align: start; font-weight: 500; white-space: nowrap">${PD[x.n] ? lnk(x.n, PD[x.n]) : x.n}${x.n !== x.repo ? `<div style="${mono}; font-size: 12px; font-weight: 400; color: ${c.muted}">${x.repo}</div>` : ''}</th>${td(x.w, { end: 1, mono: 1 })}${td(x.pr2, { end: 1, mono: 1 })}${td(x.e, { end: 1, mono: 1 })}<td style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; white-space: nowrap">${tkCell}</td>${td(x.d, { muted: 1 })}</tr>`;
};
const projBoard = (file, title, init) => board({
  file, title, logic: projLogic(init),
  body: shell({
    active: 'Projects',
    overlay: iff('ask', dialog('bs', '{{askTitle}}', `<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px"><sc-for list="{{chosen}}" as="x" hint-placeholder-count="4"><li style="display: flex; gap: 8px"><span style="font-weight: 500">{{x.n}}</span><span style="color: ${c.muted}">{{x.tk}}</span></li></sc-for></ul>
      <p style="margin: 0; color: ${c.muted}">{{slots}}</p>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${pri('{{startLabel}}', { on: 'start' })}</div>`), 'false'),
    main: `${page(`${listHead('Projects', '{{sub}}', `${iff('canAll', btn('{{allLabel}}', { on: 'selectAll' }))}${iff('none', pri('New project', { href: 'NLDescribe.dc.html' }))}${iff('some', btn('New project', { href: 'NLDescribe.dc.html' }), 'false')}`)}
      ${iff('hasDone', banner({ glyph: 'run', role: 'status', title: '{{doneTitle}}', body: '{{doneBody}}', actions: `${iff('hasBad', btn('Fix labs', { href: 'ProjectMissing.dc.html' }), 'false')}${btn('See the floor', { href: 'FloorBoard.dc.html' })}` }), 'false')}
      <div style="overflow-x: auto"><table style="width: 100%; border-collapse: collapse; font-size: 13px">
        <thead><tr><th scope="col" style="border-block-end: 1px solid ${c.sub}; width: 36px"><span class="skip">Select</span></th>${th('Project')}${th('Work orders', 1)}${th('PRs', 1)}${th('Errors', 1)}${th('Toolkit')}${th('Last deploy')}</tr></thead>
        <tbody>${PX.map(projRow).join('')}</tbody>
      </table></div>`)}
      ${iff('some', bar(`${barCount}${end(pri('{{syncLabel}}', { on: 'askOn' }))}`), 'false')}`,
  }),
});
const ALL_BEHIND = Object.fromEntries(BEHIND.map((x) => [x.id, true]));
const LABS = BEHIND.find((x) => x.n === 'labs').id;
projBoard('Projects.dc.html', 'Projects', {});
projBoard('ProjectsBulk.dc.html', 'Projects: behind ones selected', { sel: ALL_BEHIND });
projBoard('ProjectsBulkConfirm.dc.html', 'Projects: confirm the sync', { sel: ALL_BEHIND, ask: true });
projBoard('ProjectsBulkDone.dc.html', 'Projects: sync started, one blocked', { done: { ok: BEHIND.filter((x) => x.id !== LABS).map((x) => x.id), bad: [LABS] } });

/* ========== PROJECT DETAIL ========== */
const pRow = (href, gl, ref, t, note, age = '') => `<a class="row" href="${href}" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g(gl)}${m(ref, c.muted)}<span style="flex: 1 1 220px; min-width: 0; font-weight: 500; overflow-wrap: anywhere">${t}</span><span style="color: ${c.muted}; font-size: 12px">${note}</span>${age ? `<span style="width: 32px; text-align: end">${m(age, c.muted)}</span>` : ''}</a>`;
const pSec = (title, inner) => `<section aria-label="${title}" style="display: flex; flex-direction: column; gap: 4px">${sec(title)}${inner}</section>`;
const quiet = (text, action = '') => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 44px; padding: 0 12px; color: ${c.muted}"><span>${text}</span>${action}</div>`;
const svc = (name, gl, st, action = '') => `<div style="display: flex; align-items: center; gap: 8px; min-height: 36px">${g(gl, 14)}<span style="flex: 1 1 0">${name}</span>${action || `<span style="color: ${c.muted}; font-size: 12px">${st}</span>`}</div>`;
const paneDiv = (inner) => `<div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">${inner}</div>`;

const projectLogic = (init) => logic({ paused: false, ask: false, merge: 'follow', cloning: false, cloned: false, ...init }, `
    if (s.cloning && !this.t) this.t = setTimeout(() => { this.t = null; this.setState({ cloning: false, cloned: true }); }, 1200);
    return { paused: s.paused, running: !s.paused, ask: s.ask, askOn: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }),
      pause: () => this.setState({ paused: true, ask: false }), resume: () => this.setState({ paused: false }),
      follow: s.merge === 'follow', always: s.merge === 'always', setFollow: () => this.setState({ merge: 'follow' }), setAlways: () => this.setState({ merge: 'always' }),
      needClone: !s.cloning && !s.cloned, cloning: s.cloning, cloned: s.cloned, busy: true, clone: () => this.setState({ cloning: true }) };`);

function project({ file, title, name, repo, path, status, top = '', sections, toolkit, deploy, services, numbers, overlay, init = {}, head, branch = 'main' }) {
  board({
    file, title, logic: projectLogic(init),
    body: shell({
      active: 'Projects', overlay,
      main: page(`${trail([['Projects', 'Projects.dc.html'], [name]])}
        <header style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px">
          <div style="flex: 1 1 320px; min-width: 0"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600; overflow-wrap: anywhere">${name}</h1><span style="color: ${c.muted}">${status}</span></div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px">${btn('Open in T3', { href: '#t3' })}${btn('GitHub', { href: `https://github.com/AppElent/${repo}` })}${head}</div>
        </header>
        ${iff('paused', banner({ glyph: 'idle', role: 'status', title: 'Paused', body: 'New work orders for this project wait in Intake. Work already running finishes.', actions: btn('Resume', { on: 'resume' }) }), 'false')}
        ${top}${sections}`),
      pane: `${facts([['Repo', lnk(`AppElent/${repo}`, `https://github.com/AppElent/${repo}`)], ['Folder', path, 1], ['Branch', branch, 1], ['Toolkit', toolkit], ['Last deploy', deploy]])}
        ${numbers ? paneDiv(`${sec('Last 30 days', 2)}${facts(numbers)}`) : ''}
        ${paneDiv(`${sec('Services', 2)}<div>${services}</div>`)}
        ${paneDiv(`<fieldset style="margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 4px"><legend class="sec" style="padding: 0; margin-block-end: 4px">Merging</legend>
          <label style="display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer"><input type="radio" name="mg" checked="{{follow}}" onChange="{{setFollow}}"><span>Follow ${lnk('Settings', 'SettingsApprovals.dc.html')}</span></label>
          <label style="display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer"><input type="radio" name="mg" checked="{{always}}" onChange="{{setAlways}}"><span>Always ask me</span></label></fieldset>`)}
        ${paneDiv(`${iff('running', btn('Pause project', { on: 'pause', grow: true }))}${danger('Remove from factory', { on: 'askOn', grow: true })}`)}`,
    }),
  });
}
const FAIR_SECTIONS = `${pSec('Work orders · 2', pRow('WOPlan.dc.html', 'ask', 'WO-214', "Fix TypeError reading 'holes'", 'Plan · waiting on you', '4m') + pRow('WOPlan.dc.html', 'idle', 'WO-215', 'Export rounds to CSV', 'Intake · idea'))}
  ${pSec('Pull requests · 1', pRow('PRFailed.dc.html', 'fail', '#94', 'Course search empty state', 'Preview failed', '3h'))}
  ${pSec('Errors · 2', pRow('ErrorNew.dc.html', 'err', 'FAIRWAY-W3', "TypeError reading 'holes'", 'New · 14 users', '3h') + pRow('ErrorRegression.dc.html', 'err', 'FAIRWAY-R1', 'NetworkError fetching course list', 'Regression · 5 users', '1d'))}
  ${pSec('Shipped recently', pRow('ErrorNew.dc.html', 'err', 'WO-206', 'Share a round with a link', 'Caused 1 error', '5h') + pRow('Health.dc.html', 'pass', 'WO-203', 'Faster course search', 'No new errors', '2d'))}`;
const FAIR_NUMBERS = [['Shipped', '11', 1], ['First try', '8 of 11', 1], ['Median to PR', '41m', 1], ['Cost per change', '$1.60', 1]];
const FAIR_SERVICES = svc('Sentry', 'pass', 'fairway-web') + svc('EAS', 'pass', 'Connected') + svc('Infisical', 'idle', '', btn('Connect', { href: 'NLConnect.dc.html' }));
const blockedRemove = iff('ask', dialog('rm', "Fairway can't be removed yet", `${p('It has 2 open work orders. Close them first, or pause the project so nothing new starts.')}
  <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${btn('See work orders', { href: 'FloorBoard.dc.html' })}${pri('Pause project', { on: 'pause' })}</div>`), 'false');
const fair = { name: 'Fairway', repo: 'golf-app', path: '~/Developer/golf-app', status: '1 plan and 2 errors need you', toolkit: 'Current', deploy: '5h ago · EAS', sections: FAIR_SECTIONS, numbers: FAIR_NUMBERS, services: FAIR_SERVICES, overlay: blockedRemove, head: pri('Start work order', { href: 'NewWorkOrder.dc.html' }) };
project({ ...fair, file: 'ProjectDetail.dc.html', title: 'Project: Fairway' });
project({ ...fair, file: 'ProjectPaused.dc.html', title: 'Project: paused', init: { paused: true } });
project({ ...fair, file: 'ProjectBlockedRemove.dc.html', title: "Project: can't remove yet", init: { ask: true } });

const QUIET_SECTIONS = `${pSec('Work orders', quiet('None open.'))}${pSec('Pull requests', quiet('None open.'))}
  ${pSec('Errors', quiet("Sentry isn't connected, so errors can't show here.", btn('Connect Sentry', { href: 'NLConnect.dc.html' })))}${pSec('Shipped recently', quiet('Nothing shipped through the factory yet.'))}`;
const QUIET_SERVICES = svc('Sentry', 'idle', '', btn('Connect', { href: 'NLConnect.dc.html' })) + svc('Deploys', 'idle', 'None set up') + svc('Infisical', 'idle', '', btn('Connect', { href: 'NLConnect.dc.html' }));
const quietProject = { name: 'roadmaps', repo: 'roadmaps', path: '~/Developer/roadmaps', status: 'Nothing open', toolkit: '69 days behind', deploy: 'None', sections: QUIET_SECTIONS, services: QUIET_SERVICES, head: btn('Start work order', { href: 'NewWorkOrder.dc.html' }),
  top: banner({ glyph: 'idle', title: '69 days behind on the toolkit', body: '14 standards changed in developer-tools since the last sync.', actions: pri('Start sync work order', { href: 'FloorBoard.dc.html' }) }),
  overlay: iff('ask', dialog('rm', 'Remove roadmaps from the factory?', `${p('The factory stops watching it. Your GitHub repo, local folder, and services stay as they are. You can add it back from Settings.')}
    <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${dangerFill('Remove project', { href: 'Projects.dc.html' })}</div>`), 'false') };
project({ ...quietProject, file: 'ProjectQuiet.dc.html', title: 'Project: nothing open, behind on the toolkit' });
project({ ...quietProject, file: 'ProjectRemove.dc.html', title: 'Project: confirm removal', init: { ask: true } });

project({
  file: 'ProjectMissing.dc.html', title: 'Project: folder missing', name: 'labs', repo: 'labs', path: '~/Developer/labs', status: "Work orders can't start", toolkit: '41 days behind', deploy: 'None', head: btn('Start work order', { href: 'NewWorkOrder.dc.html' }),
  top: `${iff('needClone', banner({ glyph: 'fail', role: 'alert', title: "labs isn't in its folder", body: 'It was at ~/Developer/labs and is gone now. Agents work from this copy, so nothing can start until it is back. The repo is safe on GitHub.', actions: `${pri('Clone it again', { on: 'clone' })}${btn('Change folder', { href: 'SettingsProjects.dc.html' })}` }))}
    ${iff('cloning', banner({ glyph: 'run', role: 'status', title: 'Cloning AppElent/labs', actions: btn('Cloning…', { disabled: 'busy' }) }), 'false')}
    ${iff('cloned', banner({ glyph: 'pass', role: 'status', title: 'labs is back', body: 'Now cloned to ~/Developer/labs. You can start work orders again.', actions: btn('Start sync work order', { href: 'FloorBoard.dc.html' }) }), 'false')}`,
  sections: `${pSec('Work orders', quiet('None open.'))}${pSec('Pull requests', quiet('None open.'))}${pSec('Errors', quiet("Sentry isn't connected."))}`,
  services: svc('Sentry', 'idle', '', btn('Connect', { href: 'NLConnect.dc.html' })) + svc('Deploys', 'idle', 'None set up'),
  overlay: iff('ask', dialog('rm', 'Remove labs from the factory?', `${p('The factory stops watching it. Your GitHub repo stays as it is. You can add it back from Settings.')}<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${dangerFill('Remove project', { href: 'Projects.dc.html' })}</div>`), 'false'),
});

/* ========== SETTINGS ========== */
const SECTIONS = [['Agents', 'SettingsAgents.dc.html'], ['Approvals', 'SettingsApprovals.dc.html'], ['Notifications', 'SettingsNotifications.dc.html'], ['Projects', 'SettingsProjects.dc.html'], ['Tools', 'SettingsTools.dc.html']];
function settings({ file, title, section, lead, body, logicSrc, overlay }) {
  board({
    file, title, logic: logicSrc,
    body: shell({
      active: 'Settings', overlay,
      main: page(`<h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Settings</h1>
        <div style="display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start">
          <nav aria-label="Settings sections" style="flex: 0 1 168px; min-width: 140px; display: flex; flex-direction: column; gap: 4px">${SECTIONS.map(([l, h]) => `<a class="nav" href="${h}"${l === section ? ' aria-current="page"' : ''} style="display: flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 6px; font-weight: ${l === section ? 600 : 400}; background: ${l === section ? c.active : 'transparent'}">${l}</a>`).join('')}</nav>
          <div style="flex: 1 1 480px; max-width: 820px; min-width: 0; display: flex; flex-direction: column; gap: 20px">
            <div style="display: flex; flex-direction: column; gap: 4px">${h2(section)}${lead ? p(lead, 'max-width: 62ch') : ''}</div>
            ${body}
          </div>
        </div>`),
    }),
  });
}
const saved = iff('saved', `<span role="status" style="display: inline-flex; align-items: center; gap: 8px; color: ${c.muted}; font-size: 12px">${g('pass', 14)}Saved</span>`, 'false');
const fieldErr = (hole, msg) => iff(hole, `<span style="color: ${c.fail}; font-size: 12px">${msg}</span>`, 'false');

/* Agents */
settings({
  file: 'SettingsAgents.dc.html', title: 'Settings: agents', section: 'Agents', lead: 'Changes save as you make them and apply to the next work order.',
  logicSrc: logic({ limit: '3', saved: false }, `
    const v = Number(s.limit); const bad = !Number.isInteger(v) || v < 1 || v > 8;
    return { limit: s.limit, bad, saved: s.saved && !bad, type: (e) => this.setState({ limit: e.target.value, saved: true }), mark: () => this.setState({ saved: true }) };`),
  body: `<div style="display: flex; flex-direction: column; gap: 16px; max-width: 480px">
      ${field('st-l', 'Agents at once', '<input id="st-l" type="text" inputmode="numeric" value="{{limit}}" onChange="{{type}}" aria-describedby="st-l-hint" style="width: 96px">', 'Work orders past this limit wait in Intake. From 1 to 8.')}
      ${fieldErr('bad', 'Enter a whole number from 1 to 8.')}
      ${choice('checkbox', 'st-h', 'Pause new work when Review is full', 'Review is full when as many PRs wait for you as agents at once. New work then waits in Intake until you review one.', { onChange: 'mark' })}
      ${field('st-r', 'Automatic retries', '<select id="st-r" onChange="{{mark}}" aria-describedby="st-r-hint" style="width: 96px"><option>0</option><option selected>1</option><option>2</option></select>', 'When a gate fails, the agent tries this many more times before it asks you.')}
      ${field('st-a', 'Agent', '<select id="st-a" onChange="{{mark}}" aria-describedby="st-a-hint" style="width: 240px"><option>Claude in T3</option><option>Codex in T3</option></select>', 'Used for new work orders. Each run gets its own worktree.')}
      ${field('st-s', 'Daily spend limit', '<input id="st-s" type="text" inputmode="decimal" value="$25" onChange="{{mark}}" aria-describedby="st-s-hint" style="width: 96px">', 'At this amount, new work waits until tomorrow. Running agents finish. Leave it empty for no limit.')}
      <div style="min-height: 20px">${saved}</div>
    </div>`,
});

/* Approvals: the merge rule lives here */
const appTd = (inner) => `<td style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; vertical-align: top">${inner}</td>`;
const planSel = (id, name, val) => `<select id="${id}" aria-label="Plan review for ${name}" onChange="{{mark}}" style="width: 104px"><option${val === 'Always' ? ' selected' : ''}>Always</option><option${val === 'Skip' ? ' selected' : ''}>Skip</option></select>`;
const typeRow = (name, id, plan, rec, merging) => `<tr><th scope="row" style="padding: 12px; border-block-end: 1px solid ${c.sub}; text-align: start; font-weight: 500; vertical-align: top; white-space: nowrap">${name}</th>${appTd(planSel(id, name, plan))}${appTd(rec)}${appTd(merging)}</tr>`;
settings({
  file: 'SettingsApprovals.dc.html', title: 'Settings: approvals', section: 'Approvals', lead: 'What needs your approval, by type of work. You approve every merge until you turn that off here.',
  logicSrc: logic({ on: false, ask: false, saved: false, runs: '10', pct: '80' }, `
    return { on: s.on, off: !s.on, ask: s.ask, saved: s.saved, runs: s.runs, pct: s.pct,
      runsBad: !(Number(s.runs) >= 5), pctBad: !(Number(s.pct) >= 50 && Number(s.pct) <= 100),
      typeRuns: (e) => this.setState({ runs: e.target.value, saved: true }), typePct: (e) => this.setState({ pct: e.target.value, saved: true }),
      mark: () => this.setState({ saved: true }), askOn: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }),
      turnOn: () => this.setState({ ask: false, on: true, saved: true }), turnOff: () => this.setState({ on: false, saved: true }) };`),
  overlay: iff('ask', dialog('al', 'Let bug fixes merge without you?', `${p('When all 4 gates pass, a bug-fix PR merges and ships without you. You still see it on the floor, and any new error goes back to Intake. If a bug fix causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.')}<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${pri('Turn on', { on: 'turnOn' })}</div>`), 'false'),
  body: `<section aria-label="By work type" style="display: flex; flex-direction: column; gap: 8px">
      <div style="overflow-x: auto"><table style="width: 100%; border-collapse: collapse"><thead><tr>${th('Work type')}${th('Plan review')}${th('First-try record')}${th('Merging')}</tr></thead><tbody>
        ${typeRow('Bug fix', 'pl-b', 'Always', m('12 of 14'), `${iff('off', `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><span>You merge. Qualifies.</span>${btn('Merge without me', { on: 'askOn' })}</div>`)}${iff('on', `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">${g('pass', 14)}<span>Merges without you</span>${btn('Turn off', { on: 'turnOff' })}</div>`, 'false')}`)}
        ${typeRow('Feature', 'pl-f', 'Always', m('5 of 9'), `<div>You merge</div>${muted('Needs 1 more run and 80% first try. Now 56%.')}`)}
        ${typeRow('Toolkit sync', 'pl-t', 'Skip', m('5 of 6'), `<div>You merge</div>${muted('Needs 4 more runs.')}`)}
        ${typeRow('Chore', 'pl-c', 'Skip', m('2 of 2'), `<div>You merge</div>${muted('Needs 8 more runs.')}`)}
      </tbody></table></div>
    </section>
    <section aria-label="When a work type qualifies" style="display: flex; flex-direction: column; gap: 12px">
      ${sec('When a work type qualifies')}
      <div style="display: flex; flex-wrap: wrap; gap: 16px">
        <div style="flex: 0 1 200px">${field('th-r', 'Finished runs, at least', '<input id="th-r" type="text" inputmode="numeric" value="{{runs}}" onChange="{{typeRuns}}" style="width: 96px">')}${fieldErr('runsBad', 'Enter 5 or more.')}</div>
        <div style="flex: 0 1 200px">${field('th-p', 'First try, at least (%)', '<input id="th-p" type="text" inputmode="numeric" value="{{pct}}" onChange="{{typePct}}" style="width: 96px">')}${fieldErr('pctBad', 'Enter 50 to 100.')}</div>
      </div>
      ${p('First try means every gate passed without a retry. A work type also needs no regressions in those runs: no error that came back after its fix shipped, and no new error traced to one of its PRs.', 'max-width: 62ch; font-size: 12px')}
      ${p('Qualifying changes nothing by itself. Merging stays yours until you turn it on. One regression turns it off again.', 'max-width: 62ch; font-size: 12px')}
    </section>
    <section aria-label="Projects that always ask you" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Projects that always ask you')}
      <p style="margin: 0; color: ${c.muted}">None. Set this on a ${lnk('project’s page', 'ProjectDetail.dc.html')}. Use it for projects with few tests, where passing gates prove less.</p>
    </section>
    <div style="min-height: 20px">${saved}</div>`,
});

/* Notifications */
const noteRow = (id, title, desc, on) => `<label style="display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; min-height: 44px; box-sizing: border-box; border-block-end: 1px solid ${c.sub}; cursor: pointer"><input type="checkbox" checked="{{chk.${id}}}" onChange="{{tog.${id}}}" style="margin-top: 2px"><span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-weight: 500">${title}</span><span style="color: ${c.muted}; font-size: 12px">${desc}</span></span></label>`;
const NOTES = [
  ['need', 'q', 'An agent asks a question', 'The work order waits until you answer.', 1], ['need', 'plan', 'A plan needs approval', 'Build starts after you approve.', 1],
  ['need', 'pr', 'A PR is ready to merge', 'All gates passed.', 1], ['need', 'gate', 'Gates fail after the retries', 'The agent has stopped trying.', 1],
  ['need', 'err', 'A new production error or a regression', 'Once per error, not once per event.', 1], ['need', 'ci', 'CI goes red on main', 'Once per project until it is green again.', 1],
  ['know', 'alone', 'A PR merges without you', 'Only when you turned that on in Approvals.', 1], ['know', 'ship', 'A work order ships', 'Merged and deployed.', 0], ['know', 'full', 'All agent slots are full', 'New work is waiting in Intake.', 0],
];
const notifLogic = (blocked) => logic({ chk: Object.fromEntries(NOTES.map((x) => [x[1], !!x[4]])), blocked, sent: false, front: true, saved: false, checking: false }, `
    if (s.checking && !this.t) this.t = setTimeout(() => { this.t = null; this.setState({ checking: false, blocked: false }); }, 1000);
    const tog = {}; Object.keys(s.chk).forEach((k) => { tog[k] = () => this.setState({ chk: { ...s.chk, [k]: !s.chk[k] }, saved: true }); });
    return { chk: s.chk, tog, saved: s.saved, blocked: s.blocked && !s.checking, checking: s.checking, allowed: !s.blocked, busy: true, front: s.front,
      flipFront: () => this.setState({ front: !s.front, saved: true }), sent: s.sent, test: () => this.setState({ sent: true }), recheck: () => this.setState({ checking: true }) };`);
const notifBody = (blockedHint) => `${iff('blocked', banner({ glyph: 'fail', role: 'alert', title: 'macOS is blocking notifications', body: 'Allow terminal-notifier in System Settings, under Notifications. Until then, everything still lands in the Queue.', actions: `${btn('Open System Settings', { href: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension' })}${btn('Check again', { on: 'recheck' })}` }), blockedHint)}
    ${iff('checking', banner({ glyph: 'run', role: 'status', title: 'Checking macOS', actions: btn('Checking…', { disabled: 'busy' }) }), 'false')}
    ${iff('allowed', `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">${g('pass')}<span style="font-weight: 500">macOS notifications are on</span>${btn('Send a test', { on: 'test' })}${iff('sent', `<span role="status" style="color: ${c.muted}; font-size: 12px">Sent. Nothing showed? Check Focus and System Settings.</span>`, 'false')}</div>`, blockedHint === 'true' ? 'false' : 'true')}
    <section aria-label="Needs you" style="display: flex; flex-direction: column">${sec('Needs you')}${NOTES.filter((x) => x[0] === 'need').map((x) => noteRow(x[1], x[2], x[3])).join('')}</section>
    <section aria-label="Just so you know" style="display: flex; flex-direction: column">${sec('Just so you know')}${NOTES.filter((x) => x[0] === 'know').map((x) => noteRow(x[1], x[2], x[3])).join('')}</section>
    <label style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; cursor: pointer"><input type="checkbox" checked="{{front}}" onChange="{{flipFront}}"><span>Only when Software Factory isn’t the tab you’re on</span></label>
    <p style="margin: 0; color: ${c.muted}; font-size: 12px; max-width: 62ch">Several events within a minute arrive as one. Focus and Do Not Disturb apply as usual. There’s no separate inbox: the Queue is the list of what needs you. ${lnk('See how they read', 'NotifSamples.dc.html')}</p>
    <div style="min-height: 20px">${saved}</div>`;
settings({ file: 'SettingsNotifications.dc.html', title: 'Settings: notifications', section: 'Notifications', lead: 'Sent by this Mac, even with the browser closed. Clicking one opens the item it names.', logicSrc: notifLogic(false), body: notifBody('false') });
settings({ file: 'SettingsNotifyBlocked.dc.html', title: 'Settings: notifications blocked by macOS', section: 'Notifications', lead: 'Sent by this Mac, even with the browser closed. Clicking one opens the item it names.', logicSrc: notifLogic(true), body: notifBody('true') });

const mock = (title, bodyText, href, where) => `<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
  <a class="card" href="${href}" style="display: flex; gap: 12px; padding: 12px; background: ${c.raised}; border: 1px solid ${c.ctl}; border-radius: 8px">
    <span aria-hidden="true" style="flex: none; width: 32px; height: 32px; border-radius: 6px; background: ${c.accent}; color: ${c.on}; display: flex; align-items: center; justify-content: center; font-weight: 600">SF</span>
    <span style="min-width: 0; display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: ${c.muted}">Software Factory</span><span style="font-weight: 600; overflow-wrap: anywhere">${title}</span><span style="overflow-wrap: anywhere">${bodyText}</span></span>
  </a>
  ${muted(`Opens ${where}`)}
</div>`;
board({
  file: 'NotifSamples.dc.html', title: 'Notifications: how they read',
  body: shell({
    active: 'Settings',
    main: page(`${trail([['Settings', 'SettingsAgents.dc.html'], ['Notifications', 'SettingsNotifications.dc.html'], ['How they read']])}
      <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">How notifications read</h1>
      <section aria-label="Needs you" style="display: flex; flex-direction: column; gap: 12px">${sec('Needs you')}<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px">
        ${mock('Foundry: agent asks a question', 'WO-212: Keep the old migration?', 'WOQuestion.dc.html', 'the question')}
        ${mock('Fairway: plan ready for you', "WO-214: Fix TypeError reading 'holes'", 'WOPlan.dc.html', 'the plan')}
        ${mock('Foundry: PR ready to merge', '#168 Sync toolkit standards. All 4 gates passed.', 'PRPassed.dc.html', 'the PR')}
        ${mock('Arcade Club: tests failed twice', 'WO-213: Flaky leaderboard test', 'WOFailed.dc.html', 'the work order')}
        ${mock('Fairway: new production error', "TypeError reading 'holes'. 14 users so far.", 'ErrorNew.dc.html', 'the error')}
        ${mock('Fairway: an error came back', 'NetworkError fetching course list. Its fix shipped 6 days ago.', 'ErrorRegression.dc.html', 'the error')}
        ${mock('Gather: CI red on main', 'Typecheck failed on f81c0de.', 'Queue.dc.html', 'the Queue, on that row')}
        ${mock('3 PRs ready to merge', 'Arcade Club, satisfactory, and roadmaps', 'PullRequestsBulk.dc.html', 'Pull requests')}
      </div></section>
      <section aria-label="Just so you know" style="display: flex; flex-direction: column; gap: 12px">${sec('Just so you know')}<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px">
        ${mock('Fairway: merged without you', "#96 Fix TypeError reading 'holes'. Shipping now.", 'PRFix.dc.html', 'the PR')}
        ${mock('Foundry: shipped', 'WO-208: Faster workout list', 'FloorBoard.dc.html', 'the floor')}
        ${mock('All 3 agents are busy', '2 work orders are waiting in Intake.', 'FloorLimit.dc.html', 'the floor')}
      </div></section>`),
  }),
});

/* Projects */
settings({
  file: 'SettingsProjects.dc.html', title: 'Settings: projects', section: 'Projects', lead: 'Which of your GitHub repos the factory can see, and where it keeps them.',
  logicSrc: logic({ rules: ['client-*'], draft: '', err: false, removed: '', saved: false }, `
    return { rules: s.rules.map((r) => ({ r, remove: () => this.setState({ rules: s.rules.filter((x) => x !== r), removed: r, saved: true }) })), draft: s.draft, err: s.err, removed: s.removed, hasRemoved: !!s.removed, none: s.rules.length === 0, saved: s.saved,
      type: (e) => this.setState({ draft: e.target.value, err: false }), mark: () => this.setState({ saved: true }),
      add: () => { const v = s.draft.trim(); if (!v) { this.setState({ err: true }); return; } this.setState({ rules: [...s.rules, v], draft: '', saved: true }); },
      undo: () => this.setState({ rules: [...s.rules, s.removed], removed: '' }) };`),
  body: `<div style="display: flex; flex-direction: column; gap: 16px; max-width: 560px">
      ${field('sp-f', 'Clone folder', '<input id="sp-f" type="text" value="~/Developer" onChange="{{mark}}" aria-describedby="sp-f-hint" style="width: 320px; max-width: 100%">', 'New clones go here. Projects already cloned stay where they are.')}
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px"><span>12 of 26 repos are in the factory.</span>${btn('Add projects', { href: 'FRRepos.dc.html' })}</div>
    </div>
    <section aria-label="Never touch" style="display: flex; flex-direction: column; gap: 8px; max-width: 560px">
      ${sec('Never touch')}
      ${p('Repos and folders that match are never cloned, read, or given to an agent. Use * as a wildcard.', 'font-size: 12px')}
      <ul style="margin: 0; padding: 0; list-style: none"><sc-for list="{{rules}}" as="x" hint-placeholder-count="1"><li style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-block-end: 1px solid ${c.sub}"><span style="${mono}; font-size: 12px; flex: 1 1 0; overflow-wrap: anywhere">{{x.r}}</span>${btn('Remove', { on: 'x.remove' })}</li></sc-for></ul>
      ${iff('none', p('Nothing is excluded, so the factory can see every repo.', 'font-size: 12px'), 'false')}
      ${iff('hasRemoved', `<span role="status" style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 12px">Removed {{removed}}. ${btn('Undo', { on: 'undo' })}</span>`, 'false')}
      <div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px"><div style="flex: 1 1 240px">${field('sp-r', 'Add a pattern', '<input id="sp-r" type="text" value="{{draft}}" onChange="{{type}}" placeholder="client-*" style="width: 100%">')}</div>${btn('Add', { on: 'add' })}</div>
      ${fieldErr('err', 'Enter a repo name or pattern.')}
    </section>
    <div style="min-height: 20px">${saved}</div>`,
});

/* Tools */
const toolRow = (name, purpose, gl, st, extra = '') => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-block-end: 1px solid ${c.sub}">${g(gl)}<span style="width: 136px; ${mono}; font-size: 12px">${name}</span><span style="flex: 1 1 200px; color: ${c.muted}">${purpose}</span><span>${st}</span>${extra ? `<div style="flex: 1 1 100%; padding-block: 8px">${extra}</div>` : ''}</div>`;
settings({
  file: 'SettingsTools.dc.html', title: 'Settings: tools', section: 'Tools', lead: 'The tools the factory runs on, checked when it starts and whenever you ask.',
  logicSrc: logic({ st: 'bad', restarting: false }, `
    if (s.st === 'checking' && !this.t) this.t = setTimeout(() => { this.t = null; this.setState({ st: 'good' }); }, 1000);
    return { bad: s.st === 'bad', checking: s.st === 'checking', good: s.st === 'good', busy: true, check: () => this.setState({ st: 'checking' }) };`),
  body: `<div>
      ${toolRow('gh', 'Pull requests and repos', 'pass', 'Signed in as AppElent')}
      ${toolRow('t3', 'Runs the agents', 'pass', 'Ready')}
      ${toolRow('sentry', 'Production errors', 'pass', 'Signed in')}
      ${toolRow('eas', 'App builds and deploys', 'pass', 'Signed in')}
      ${iff('bad', toolRow('wrangler', 'Cloudflare deploys', 'fail', 'Not signed in', `${code('wrangler login')}<div style="margin-block-start: 8px">${btn('Check again', { on: 'check' })}</div>`))}
      ${iff('checking', toolRow('wrangler', 'Cloudflare deploys', 'run', 'Checking', `${code('wrangler login')}<div style="margin-block-start: 8px">${btn('Checking…', { disabled: 'busy' })}</div>`), 'false')}
      ${iff('good', toolRow('wrangler', 'Cloudflare deploys', 'pass', 'Signed in'), 'false')}
      ${toolRow('infisical', 'Secrets for new projects', 'idle', 'Optional · not installed')}
      ${toolRow('terminal-notifier', 'macOS notifications', 'pass', 'Ready')}
    </div>
    <section aria-label="This Mac" style="display: flex; flex-direction: column; gap: 12px">
      ${sec('This Mac')}
      ${facts([['Service', 'Running at 127.0.0.1:4310', 1], ['Starts', 'At login'], ['Data', '~/Library/Application Support/Software Factory/factory.db', 1]])}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${btn('Restart service', { href: 'AppOffline.dc.html' })}${btn('Back up data', { href: '#backup' })}</div>
    </section>`,
});

/* ========== LONG TEXT ========== */
const LONG_NAME = 'Fairway Scorecards for Weekend Golf Societies and Long Tournaments';
const LONG_REPO = 'fairway-scorecards-for-weekend-golf-societies-and-long-tournaments';
project({
  ...fair, file: 'ProjectLong.dc.html', title: 'Long text: project', name: LONG_NAME, repo: LONG_REPO, path: `~/Developer/clients-and-side-projects/2026/${LONG_REPO}`, branch: 'release/2026-11-spring-season-scorecard-migration',
  sections: `${pSec('Work orders · 1', pRow('WOPlan.dc.html', 'ask', 'WO-214', "Fix TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round", 'Plan · waiting on you', '4m'))}
    ${pSec('Pull requests · 1', pRow('PRFailed.dc.html', 'fail', '#94', 'Show a helpful empty state with a clear-search action when a course search finds nothing in the selected region or season', 'Preview failed', '3h'))}`,
});
pr({
  file: 'PRLong.dc.html', title: 'Long text: PR', repo: LONG_REPO, num: 96, name: "Fix TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round", project: LONG_NAME, line: 'Bug fix', wo: 'WO-214', size: '+12046 −9981',
  state: 'All gates passed · ready to merge', stateG: 'pass', cost: '$12.58', age: '4m', gatesRows: allPass, primary: mergeBtn,
  summary: `<p style="margin: 0">Cached rounds now include their holes. Rounds cached before this change refetch once, which can take a moment on a slow connection, so the scorecard shows its loading state until the refetch finishes and then renders exactly as it did before.</p>`,
  files: [['packages/scorecards/src/features/shared-rounds/components/round-summary/RoundSummaryCard.integration.test.tsx', 18, 7], ['src/rounds/cache.ts', 2, 2]],
});
floor({
  file: 'FloorLong.dc.html', title: 'Long text: floor',
  extraBuild: { id: 'c21', ref: 'WO-1042', t: 'Show a helpful empty state with a clear-search action when a course search finds nothing in the selected region', pr: LONG_NAME, gl: 'run', note: 'Working', href: 'WORun211.dc.html', age: '114m' },
});

/* ========== NARROW ========== */
const OUT = new URL('../canvas/project/', import.meta.url);
export const NARROW = [['Queue', 'QueueNarrow'], ['FloorBoard', 'FloorNarrow'], ['ProjectDetail', 'ProjectNarrow'], ['PullRequestsBulk', 'PullRequestsNarrow'], ['SettingsApprovals', 'SettingsNarrow']];
// Queue and Floor come from earlier modules, so the copies are written at the end of the run.
export function writeNarrow() {
  for (const [from, to] of NARROW) {
    const src = readFileSync(new URL(`${from}.dc.html`, OUT), 'utf8');
    writeFileSync(new URL(`${to}.dc.html`, OUT), src.replace('"width":1440,"height":900', '"width":390,"height":844').replace(/<title>(.*?)<\/title>/, '<title>$1 at phone width</title>'));
    written.push(`${to}.dc.html`);
  }
}

/* ========== REFERENCES ========== */
refs('RefsProject.dc.html', 'Project references', [
  ['/_blob/582987e74100752d7dfe9e1f82e5943f', 'Mintlify: current status above recent updates, with a failure expanded in place', '9511b9c8-f3ab-4556-a398-6eb0bef0a2e4', 'current state first, history below, and a failure explained where it happened.'],
  ['/_blob/d6da695e1052b8dad5f2e7941494988b', 'Cofounder: what is live, what is pending, then a release timeline', '35bca31a-83de-4a12-86e6-86c641017d6f', 'pending work kept apart from what already shipped.'],
]);
refs('RefsSettings.dc.html', 'Settings references', [
  ['/_blob/56bc304c866ed55a659a6c442bfb7f6a', 'AirOps: notification events led by review needed and input needed', 'a33cf381-5620-42a5-8533-afa05089d716', 'events named by what you have to do, in one list.'],
  ['/_blob/ba58dc05276a832a9c7c1f3e253092a2', 'Snowflake: a quiet settings sub-navigation and short grouped sections', 'c31c4cd2-94e8-48e5-a39b-c908861695f6', 'a small sub-nav beside one column of grouped settings.'],
]);
refs('RefsBulk.dc.html', 'Bulk action references', [
  ['/_blob/bc48642e3583606c188b86ad2b0a6030', 'incident.io: a floating bar with the selected count, and a merge confirmation', '2511fe5a-7ac2-43ad-b0f9-a777f8f4f17f', 'the bar shows the count and a way out, and the dialog says what will not happen.'],
  ['/_blob/b49ff57a1cb7e7abc106284c46d7334c', 'Calendly: a selection bar with its actions, and a confirmation naming the count', '40804c9e-702d-41a4-8fbc-a1c7f070fc55', 'the dialog title repeats how many items it will change.'],
]);
