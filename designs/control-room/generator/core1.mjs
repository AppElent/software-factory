import { c, mono, g, gates, m, muted, p, sec, h2, h3, lnk, code, pri, btn, danger, iff, field, facts, banner, trail, sk, bars, board, logic, shell, dialog, choice } from './lib.mjs';

const WOFIX = 'WOPlan.dc.html';

/* ========== QUEUE ========== */
const ROWS = [
  { id: 'r1', sect: 'need', glyph: 'err', project: 'Fairway', title: "TypeError reading 'holes'", meta: 'Production error · 14 users', age: '3h' },
  { id: 'r2', sect: 'need', glyph: 'ask', project: 'Foundry', title: 'Agent asks: keep the old migration?', meta: 'WO-212 · Build', age: '8m' },
  { id: 'r3', sect: 'need', glyph: 'fail', project: 'Gather', title: 'CI red on main: typecheck', meta: 'GitHub Actions', age: '22m' },
  { id: 'r4', sect: 'need', glyph: 'pass', project: 'Foundry', title: '#168 Sync toolkit standards', meta: 'All gates passed · ready to merge', age: '1h' },
  { id: 'r5', sect: 'later', glyph: 'idle', project: 'Gather', title: '#127 Provider-backed task lists', meta: 'Stale · no activity', age: '87d' },
  { id: 'r6', sect: 'later', glyph: 'idle', project: 'Gather', title: '#240 Export your data as JSON', meta: 'Needs rebase', age: '18d' },
  { id: 'r7', sect: 'later', glyph: 'idle', project: 'Arcade Club', title: 'Toolkit is behind', meta: 'Sync available', age: '4d' },
];

const qRow = (r, long) => iff(`show.${r.id}`, `<button type="button" class="row" aria-pressed="{{on.${r.id}}}" onClick="{{pick.${r.id}}}" style="width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; box-sizing: border-box; border: 0; border-radius: 6px; background: {{bg.${r.id}}}; box-shadow: {{mark.${r.id}}}; color: ${c.text}; font: inherit; text-align: start; cursor: pointer">
  ${g(r.glyph)}
  <span style="width: 88px; color: ${c.muted}">${r.project}</span>
  <span style="flex: 1 1 220px; min-width: 0; font-weight: ${r.sect === 'need' ? 500 : 400}; overflow-wrap: anywhere">${long && r.id === 'r1' ? "TypeError: Cannot read properties of undefined (reading 'holes') in RoundSummaryCard while rendering the scorecard for a shared round" : r.title}</span>
  <span style="color: ${c.muted}; font-size: 12px">${r.meta}</span>
  <span style="width: 32px; text-align: end; ${mono}; font-size: 12px; color: ${c.muted}">${r.age}</span>
</button>`);

const STAGES = [['Intake', '4'], ['Plan', '1'], ['Build', '2/3'], ['Verify', '1/3'], ['Review', '3'], ['Ship', '0'], ['Observe', '3']];
const stageStrip = (stages = STAGES) => `<nav aria-label="Stages" style="margin-block-start: 16px; overflow-x: auto"><div style="display: grid; grid-template-columns: repeat(7, minmax(84px, 1fr)); border: 1px solid ${c.sub}; border-radius: 6px">
  ${stages.map(([l, n], i) => `<a class="nav" href="FloorBoard.dc.html" style="padding: 8px 12px; border-inline-start: ${i ? `1px solid ${c.sub}` : '0'}"><div style="color: ${c.muted}; font-size: 12px">${l}</div><div style="${mono}; font-size: 16px; font-weight: 500; line-height: 1.25; margin-block-start: 2px">${n}</div></a>`).join('')}
</div></nav>`;

const errStats = `<div style="display: flex; flex-wrap: wrap; gap: 4px 16px">${m('41 events')}${m('14 users')}${m('first seen 3h ago')}</div>`;
const errBars = bars([4, 4, 6, 4, 4, 6, 4, 4, 6, 4, 6, 8, 14, 26, 40, 34], { label: 'Events over the last 24 hours, rising sharply in the last 4 hours', hi: (_, i) => i > 11, unit: ' events' });

const paneHead = (ctx, title) => `<div>${muted(ctx)}${h2(title).replace('margin: 0', 'margin: 4px 0 0')}</div>`;
const secondary = (a, b) => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">${a}${b}</div>`;
const snooze = secondary(btn('Snooze', { on: 'snooze' }), btn('Dismiss', { on: 'dismiss' }));

const paneOf = (limit) => ({
  r1: `${paneHead('Fairway · production · fairway-web', "TypeError: Cannot read properties of undefined (reading 'holes')")}
    <div style="display: flex; flex-direction: column; gap: 8px">${errBars}${errStats}</div>
    ${facts([['First release', 'a1b2c3d', 1], ['Likely source', 'src/rounds/score.ts:42', 1], ['In that release', '2 merged PRs']])}
    <div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">
      ${h3('Bug fix')}
      ${limit
    ? p('All 3 agent slots are busy. This waits in Intake and starts when a slot opens.', 'font-size: 12px') + pri('Add to Intake', { href: 'FloorLimit.dc.html', grow: true })
    : p("Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. It won't merge.", 'font-size: 12px') + pri('Start work order', { href: WOFIX, grow: true })}
      ${snooze}
      ${btn('Open full error', { href: 'ErrorNew.dc.html', grow: true })}
    </div>`,
  r2: `${paneHead('Foundry · WO-212 · Build · waiting 8m', 'Keep the old migration?')}
    ${p('Migration 0042 still reads <code style="' + mono + '; font-size: 12px">sets_old</code>. Removing the table breaks a fresh install unless 0042 goes too.')}
    ${pri('Answer', { href: 'WOQuestion.dc.html', grow: true })}
    ${btn('Open work order', { href: 'WOQuestion.dc.html', grow: true })}`,
  r3: `${paneHead('Gather · main · GitHub Actions', 'CI red on main: typecheck')}
    ${code("src/tasks/sync.ts(88,14): error TS2345:\nArgument of type 'string | undefined' is not\nassignable to parameter of type 'string'.")}
    ${facts([['Commit', 'f81c0de', 1], ['Red for', '22 minutes'], ['Blocks', '3 open PRs']])}
    ${pri(limit ? 'Add to Intake' : 'Start work order', { href: WOFIX, grow: true })}
    ${snooze}`,
  r4: `${paneHead('Foundry · PR #168 · Toolkit sync', 'Sync toolkit standards')}
    <div style="display: flex; align-items: center; gap: 8px">${gates('pppp')}${muted('All 4 gates passed')}</div>
    ${facts([['Size', '+214 −98 · 11 files', 1], ['Work order', 'WO-207'], ['Cost', '$0.62', 1]])}
    ${pri('Review PR', { href: 'PRPassed.dc.html', grow: true })}
    ${snooze}`,
  r5: `${paneHead('Gather · PR #127 · stale 87 days', 'Provider-backed task lists')}
    ${p('No commits or comments for 87 days. It conflicts with main in 6 files.')}
    ${pri('Start rebase work order', { href: 'PRRebase.dc.html', grow: true })}
    ${snooze}`,
  r6: `${paneHead('Gather · PR #240 · needs rebase', 'Export your data as JSON')}
    ${p('Gates passed 18 days ago. main moved on, so they need to run again after a rebase.')}
    ${pri('Start rebase work order', { href: 'PRRebase.dc.html', grow: true })}
    ${snooze}`,
  r7: `${paneHead('Arcade Club · 4 days behind', 'Toolkit is behind')}
    ${p('6 standards changed in developer-tools since the last sync.')}
    ${pri('Start sync work order', { href: 'FloorBoard.dc.html', grow: true })}
    ${snooze}`,
});

const queueLogic = (extraState = {}) => logic({ sel: 'r1', gone: {}, note: '', ...extraState }, `
    const ids = ${JSON.stringify(ROWS.map((r) => r.id))};
    const need = ${JSON.stringify(ROWS.filter((r) => r.sect === 'need').map((r) => r.id))};
    const on = {}, bg = {}, mark = {}, pick = {}, show = {}, pane = {};
    ids.forEach((id) => {
      on[id] = s.sel === id; pane[id] = s.sel === id; show[id] = !s.gone[id];
      bg[id] = s.sel === id ? '${c.raised}' : 'transparent';
      mark[id] = s.sel === id ? 'inset 2px 0 0 ${c.text}' : 'none';
      pick[id] = () => this.setState({ sel: id });
    });
    const hide = (msg) => () => {
      const gone = { ...s.gone, [s.sel]: true };
      this.setState({ gone, last: s.sel, note: msg, sel: ids.find((i) => !gone[i]) || '' });
    };
    const left = need.filter((i) => !s.gone[i]).length;
    const later = ids.length - need.length - ids.filter((i) => s.gone[i] && !need.includes(i)).length;
    return { on, bg, mark, pick, show, pane,
      summary: left + ' need you · ' + later + ' can wait',
      hasNote: !!s.note, note: s.note,
      snooze: hide('Snoozed until tomorrow at 09:00.'),
      dismiss: hide('Dismissed. It comes back only if it gets worse.'),
      undo: () => { const gone = { ...s.gone }; delete gone[s.last]; this.setState({ gone, sel: s.last, note: '' }); },
      closeBack: () => this.setState({ back: false }), back: s.back };`);

function queueBoard({ file, title, top = '', limit = false, long = false, status, stages }) {
  const panes = paneOf(limit);
  const main = `<header style="padding: 16px 24px 0">
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">
        <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Queue</h1>
        <span style="color: ${c.muted}">{{summary}}</span>
        <span style="margin-inline-start: auto">${btn('New work order', { href: 'NewWorkOrder.dc.html' })}</span>
      </div>
      ${top ? `<div style="margin-block-start: 16px">${top}</div>` : ''}
      ${stageStrip(stages)}
    </header>
    <section aria-label="Needs you" style="padding: 20px 24px 0; display: flex; flex-direction: column; gap: 4px">
      ${sec('Needs you')}
      ${ROWS.filter((r) => r.sect === 'need').map((r) => qRow(r, long)).join('\n')}
    </section>
    <section aria-label="Later" style="padding: 20px 24px 0; display: flex; flex-direction: column; gap: 4px">
      ${sec('Later')}
      ${ROWS.filter((r) => r.sect === 'later').map((r) => qRow(r)).join('\n')}
    </section>
    <div role="status" style="padding: 12px 24px 0; min-height: 36px">${iff('hasNote', `<span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 12px">{{note}} ${btn('Undo', { on: 'undo' })}</span>`, 'false')}</div>
    <footer style="margin-block-start: auto; padding: 16px 24px; display: flex; flex-wrap: wrap; gap: 16px; color: ${c.muted}; font-size: 12px">
      ${[['j k', 'move'], ['↵', 'open'], ['w', 'start work order'], ['s', 'snooze'], ['d', 'dismiss']].map(([k, v]) => `<span><b style="${mono}; font-weight: 500; color: ${c.text}">${k}</b> ${v}</span>`).join('')}
    </footer>`;
  const pane = ROWS.map((r) => iff(`pane.${r.id}`, `<div style="display: flex; flex-direction: column; gap: 16px">${panes[r.id]}</div>`, r.id === 'r1' ? 'true' : 'false')).join('\n');
  board({ file, title, logic: queueLogic(), body: shell({ active: 'Queue', main, pane, status }) });
}

queueBoard({ file: 'Queue.dc.html', title: 'Queue' });

queueBoard({
  file: 'QueueBack.dc.html', title: 'Queue: back after time away',
  top: banner({
    title: 'Since yesterday at 18:20',
    body: '3 shipped · 1 gate failed and needs you · 2 new errors · $4.10 spent',
    actions: btn('See numbers', { href: 'Health.dc.html' }),
  }),
});

queueBoard({
  file: 'QueueLimit.dc.html', title: 'Queue: agents at limit', limit: true,
  status: ['3 of 3 agents working', 'Synced 1m ago'],
  stages: [['Intake', '4'], ['Plan', '1'], ['Build', '3/3'], ['Verify', '1/3'], ['Review', '3'], ['Ship', '0'], ['Observe', '3']],
});

queueBoard({
  file: 'QueueDegraded.dc.html', title: 'Queue: Sentry unreachable',
  long: true,
  top: banner({
    glyph: 'fail', role: 'alert',
    title: 'Sentry is out of date: errors are from 38 minutes ago',
    body: 'The sentry token expired. Run <code style="' + mono + '; font-size: 12px">sentry auth login</code>, then check again. GitHub and T3 are fine.',
    actions: btn('Check again', { href: 'Queue.dc.html' }),
  }),
  status: ['2 of 3 agents working', 'GitHub synced 1m ago', 'Sentry synced 38m ago'],
});

queueBoard({
  file: 'QueueFirst.dc.html', title: 'Queue: first look',
  top: banner({
    glyph: 'pass',
    title: 'Your first queue, ranked from 3 projects',
    body: 'Production errors first, then agents waiting on you, red builds, and ready PRs. Start with the top item.',
  }),
  status: ['No agents working yet', 'Synced just now'],
  stages: [['Intake', '0'], ['Plan', '0'], ['Build', '0/3'], ['Verify', '0/3'], ['Review', '3'], ['Ship', '0'], ['Observe', '1']],
});

/* Empty: nothing needs you */
board({
  file: 'QueueEmpty.dc.html', title: 'Queue: nothing needs you',
  body: shell({
    active: 'Queue',
    main: `<header style="padding: 16px 24px 0">
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">
        <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Queue</h1>
        <span style="color: ${c.muted}">0 need you · 2 can wait</span>
      </div>
      ${stageStrip([['Intake', '2'], ['Plan', '0'], ['Build', '2/3'], ['Verify', '0/3'], ['Review', '0'], ['Ship', '1'], ['Observe', '3']])}
    </header>
    <section aria-label="Needs you" style="padding: 48px 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 560px">
      ${h2('Nothing needs you')}
      ${p('2 agents are working and 1 change is shipping. New errors, questions, and ready PRs land here. The next check runs in 4 minutes.')}
      <div style="margin-block-start: 8px; display: flex; flex-wrap: wrap; gap: 8px">${pri('New work order', { href: 'NewWorkOrder.dc.html' })}${btn('See the floor', { href: 'FloorBoard.dc.html' })}</div>
    </section>
    <section aria-label="Later" style="padding: 0 24px; display: flex; flex-direction: column; gap: 4px">
      ${sec('Later')}
      <a class="row" href="PRRebase.dc.html" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g('idle')}<span style="width: 88px; color: ${c.muted}">Gather</span><span style="flex: 1 1 220px">#240 Export your data as JSON</span>${muted('Needs rebase')}${m('18d', c.muted)}</a>
      <a class="row" href="Projects.dc.html" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g('idle')}<span style="width: 88px; color: ${c.muted}">Arcade Club</span><span style="flex: 1 1 220px">Toolkit is behind</span>${muted('Sync available')}${m('4d', c.muted)}</a>
    </section>`,
  }),
});

/* Loading: matches the queue's shape, nav stays usable */
const skRow = (w) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px">${sk('16px', 16)}${sk('88px')}${sk(w)}<span style="margin-inline-start: auto">${sk('32px')}</span></div>`;
board({
  file: 'QueueLoading.dc.html', title: 'Queue: loading',
  body: shell({
    active: 'Queue', counts: false, status: ['Checking GitHub and Sentry'],
    main: `<div aria-busy="true"><header style="padding: 16px 24px 0"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Queue</h1>
      <div style="margin-block-start: 16px; height: 60px; border: 1px solid ${c.sub}; border-radius: 6px; display: grid; grid-template-columns: repeat(7, minmax(84px, 1fr)); align-items: center; padding-inline: 12px">${Array(7).fill(sk('48px', 24)).join('')}</div></header>
      <section aria-label="Needs you" style="padding: 20px 24px 0">${sec('Needs you')}${skRow('44%')}${skRow('36%')}${skRow('40%')}${skRow('32%')}</section>
      <section aria-label="Later" style="padding: 20px 24px 0">${sec('Later')}${skRow('38%')}${skRow('34%')}</section>
      <p role="status" style="padding: 12px 24px; margin: 0; color: ${c.muted}">Reading 12 projects</p></div>`,
    pane: `${sk('60%')}${sk('90%', 20)}${sk('100%', 48)}${sk('70%')}${sk('100%', 44)}`,
  }),
});

/* The local service isn't running: shared route failure */
board({
  file: 'AppOffline.dc.html', title: 'Factory not running',
  body: `<div style="min-height: 900px; background: ${c.canvas}; color: ${c.text}; font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 13px; line-height: 1.4; display: flex; justify-content: center; padding: 96px 24px; box-sizing: border-box">
    <main style="max-width: 560px; display: flex; flex-direction: column; gap: 16px; align-items: flex-start">
      <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">The factory isn't running</h1>
      ${p("This page can't reach the local service on port 4310. Agents already working in T3 keep going, but nothing new starts and nothing here updates. Start the service, then check again.")}
      ${code('launchctl kickstart gui/$UID/com.appelent.software-factory')}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Check again', { href: 'Queue.dc.html' })}</div>
    </main></div>`,
});

/* ========== ERROR DETAIL ========== */
function errorBoard({ file, title, state, note, rail, stateGlyph = 'err' }) {
  const frames = `src/rounds/score.ts:42    const total = round.holes.reduce(addScore, 0)
src/rounds/RoundSummaryCard.tsx:18
src/rounds/RoundPage.tsx:61
node_modules/react-dom/client.js:8234`;
  board({
    file, title,
    logic: logic({ snoozed: false }, 'return {};'),
    body: shell({
      active: 'Errors',
      main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">
        ${trail([['Errors', 'ErrorsList.dc.html'], ['Fairway', 'ErrorsList.dc.html'], ["TypeError reading 'holes'"]])}
        <div>
          <div style="display: flex; align-items: center; gap: 8px; color: ${c.muted}; font-size: 12px">${g(stateGlyph, 14)}<span>${state}</span></div>
          <h1 style="margin: 4px 0 0; font-size: 20px; line-height: 1.2; font-weight: 600; overflow-wrap: anywhere">TypeError: Cannot read properties of undefined (reading 'holes')</h1>
        </div>
        ${note || ''}
        <section aria-label="Event history" style="display: flex; flex-direction: column; gap: 8px">
          ${sec('Last 24 hours')}
          ${bars([4, 4, 6, 4, 4, 6, 4, 4, 6, 4, 6, 8, 14, 26, 40, 34, 8, 6, 22, 30, 28, 12, 10, 14], { label: 'Events over the last 24 hours, rising sharply in the last 8 hours', hi: (_, i) => i > 11, height: 72, unit: ' events' })}
          ${errStats}
        </section>
        <section aria-label="Stack trace" style="display: flex; flex-direction: column; gap: 8px">
          ${sec('Stack trace')}
          ${code(frames)}
        </section>
        <section aria-label="Likely cause" style="display: flex; flex-direction: column; gap: 8px">
          ${sec('In release a1b2c3d')}
          ${[['#92', 'Share a round with a link', '+312 −40'], ['#93', 'Cache finished rounds', '+88 −12']].map(([n, t, sz]) => `<a class="row" href="https://github.com/AppElent/golf-app/pulls" style="display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; min-height: 36px; padding: 4px 12px; border-radius: 6px">${m(n, c.muted)}<span style="flex: 1 1 220px">${t}</span>${m(sz, c.muted)}</a>`).join('')}
        </section>
      </div>`,
      pane: rail,
    }),
  });
}
const errFacts = facts([['Project', 'Fairway'], ['Environment', 'production'], ['First release', 'a1b2c3d', 1], ['Likely source', 'src/rounds/score.ts:42', 1], ['Sentry issue', 'FAIRWAY-W3', 1]]);
const sentry = btn('Open in Sentry', { href: 'https://sentry.io', grow: true });

errorBoard({
  file: 'ErrorNew.dc.html', title: 'Error: new', state: 'New · first seen 3h ago',
  rail: `${errFacts}<div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">
    ${h3('Bug fix')}${p("Runs in a T3 thread on a new worktree. Opens a PR after the gates pass. It won't merge.", 'font-size: 12px')}
    ${pri('Start work order', { href: WOFIX, grow: true })}${secondary(btn('Snooze', { href: 'ErrorSnoozed.dc.html' }), btn('Dismiss', { href: 'ErrorsList.dc.html' }))}${sentry}</div>`,
});
errorBoard({
  file: 'ErrorRegression.dc.html', title: 'Error: regression', state: 'Regression · came back 3h ago',
  note: banner({ glyph: 'err', title: 'This came back after a fix', body: `WO-198 fixed it on 28 October in PR #88. It returned in release a1b2c3d.`, actions: btn('Open PR #88', { href: 'https://github.com/AppElent/golf-app/pulls' }) }),
  rail: `${errFacts}<div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">
    ${h3('Bug fix')}${p('The new work order gets the old fix and its PR as context, so the agent starts from what already failed.', 'font-size: 12px')}
    ${pri('Start work order', { href: WOFIX, grow: true })}${secondary(btn('Snooze', { href: 'ErrorSnoozed.dc.html' }), btn('Dismiss', { href: 'ErrorsList.dc.html' }))}${sentry}</div>`,
});
errorBoard({
  file: 'ErrorSnoozed.dc.html', title: 'Error: snoozed', state: 'Snoozed until tomorrow at 09:00', stateGlyph: 'idle',
  note: banner({ glyph: 'idle', title: 'Snoozed until tomorrow at 09:00', body: 'It returns to the queue sooner if it reaches 100 events or reaches users in a new release.' }),
  rail: `${errFacts}<div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px; display: flex; flex-direction: column; gap: 8px">
    ${h3('Bug fix')}${p('You can start a fix while it is snoozed.', 'font-size: 12px')}
    ${pri('Start work order', { href: WOFIX, grow: true })}${btn('Unsnooze', { href: 'ErrorNew.dc.html', grow: true })}${sentry}</div>`,
});

/* ========== NEW WORK ORDER ========== */
const nwLogic = logic({ text: '', err: false, line: 'bug' }, `
    const lines = ['bug', 'feature', 'chore'];
    const on = {}, pick = {};
    lines.forEach((l) => { on[l] = s.line === l; pick[l] = () => this.setState({ line: l }); });
    return { text: s.text, on, pick, err: s.err, ready: !!s.text.trim(), notReady: !s.text.trim(),
      type: (e) => this.setState({ text: e.target.value, err: false }),
      fail: () => this.setState({ err: true }) };`);
board({
  file: 'NewWorkOrder.dc.html', title: 'New work order', logic: nwLogic,
  body: shell({
    active: 'Queue',
    main: `<div style="padding: 16px 24px"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Queue</h1></div>`,
    overlay: dialog('nw', 'New work order', `
      ${field('nw-p', 'Project', `<select id="nw-p"><option>Fairway</option><option>Foundry</option><option>Gather</option><option>Arcade Club</option></select>`)}
      ${field('nw-t', 'What should change?', `<textarea id="nw-t" rows="4" value="{{text}}" onChange="{{type}}" placeholder="Add a weekly summary to the workout history page"></textarea>`)}
      ${iff('err', `<span style="color: ${c.fail}; font-size: 12px">Describe the change so the agent can plan it.</span>`, 'false')}
      <fieldset style="margin: 0; padding: 0; border: 0; display: flex; flex-direction: column"><legend style="font-weight: 500; padding: 0; margin-block-end: 4px">Work type</legend>
        ${choice('radio', 'line', 'Bug fix', 'You approve the plan. It builds, checks, and opens a PR.', { checked: 'on.bug', onChange: 'pick.bug' })}
        ${choice('radio', 'line', 'Feature', 'Same steps, with a longer plan to read first.', { checked: 'on.feature', onChange: 'pick.feature' })}
        ${choice('radio', 'line', 'Chore', 'Skips the plan. For small, safe changes.', { checked: 'on.chore', onChange: 'pick.chore' })}
      </fieldset>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { href: 'Queue.dc.html' })}${iff('ready', pri('Start work order', { href: WOFIX }), 'false')}${iff('notReady', pri('Start work order', { on: 'fail' }))}</div>`, 520),
  }),
});
