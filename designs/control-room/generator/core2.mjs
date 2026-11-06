import { c, mono, g, gates, m, muted, p, sec, h2, h3, lnk, code, pri, btn, danger, dangerFill, iff, field, facts, banner, trail, board, logic, shell, dialog, choice } from './lib.mjs';

const secondary = (a, b) => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">${a}${b}</div>`;

/* ========== WORK ORDER ========== */
const STAGES = ['Intake', 'Plan', 'Build', 'Verify', 'Review', 'Ship', 'Observe'];
const rail = (current, mark = 'run') => `<ol aria-label="Stages" style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(84px, 1fr)); border: 1px solid ${c.sub}; border-radius: 6px; overflow-x: auto">
  ${STAGES.map((s, i) => { const at = STAGES.indexOf(current); const on = i === at; return `<li${on ? ' aria-current="step"' : ''} style="display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 12px; border-inline-start: ${i ? `1px solid ${c.sub}` : '0'}; background: ${on ? c.raised : 'transparent'}; font-weight: ${on ? 600 : 400}; color: ${i <= at ? c.text : c.muted}">${g(i < at ? 'pass' : on ? mark : 'idle', 14)}<span>${s}</span></li>`; }).join('')}
</ol>`;
const step = (glyph, text, time, detail = '') => {
  const head = `${g(glyph)}<span style="flex: 1 1 0; min-width: 0">${text}</span>${m(time, c.muted)}`;
  return detail
    ? `<details style="border-radius: 6px"><summary style="display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 8px; list-style: none">${head}</summary><div style="padding: 4px 8px 8px 36px">${code(detail)}</div></details>`
    : `<div style="display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 8px">${head}</div>`;
};
const gateList = (rows) => `<div style="display: flex; flex-direction: column; gap: 8px">${sec('Gates', 3)}${rows.map(([gl, n, r]) => `<div style="display: flex; align-items: center; gap: 8px">${g(gl, 14)}<span>${n}</span><span style="margin-inline-start: auto; color: ${c.muted}; font-size: 12px">${r}</span></div>`).join('')}</div>`;
const G = { none: [['gi', 'Typecheck', 'Not started'], ['gi', 'Tests', 'Not started'], ['gi', 'Lint', 'Not started'], ['gi', 'Preview', 'Not started']] };
const runFacts = (o) => facts([['Agent', o.agent ?? 'Claude in T3'], ['Worktree', o.tree, 1], ['Time', o.time, 1], ['Cost so far', o.cost, 1]]);

function wo({ file, title, id, name, project, stage, mark, state, body, logicSrc, gatesRows = G.none, tree, time, cost, actions, stopped, active = 'Floor' }) {
  board({
    file, title, logic: logicSrc,
    body: shell({
      active, stopped,
      main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 16px">
        ${trail([['Floor', stopped ? 'FloorStopped.dc.html' : 'FloorBoard.dc.html'], [id]])}
        <div>
          ${muted(`${project} · ${id} · Bug fix`)}
          <h1 style="margin: 4px 0 0; font-size: 20px; line-height: 1.2; font-weight: 600">${name}</h1>
        </div>
        ${rail(stage, mark)}
        ${body}
      </div>`,
      pane: `<div role="status" style="display: flex; align-items: center; gap: 8px; font-weight: 500">${g(mark, 16)}<span>${state}</span></div>
        ${actions}
        <div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px">${gateList(gatesRows)}</div>
        <div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px">${runFacts({ tree, time, cost })}</div>`,
    }),
  });
}

const FIX = { id: 'WO-214', name: "Fix TypeError reading 'holes'", project: 'Fairway', tree: 'wo-214-holes-typeerror' };

wo({
  ...FIX, file: 'WOPlan.dc.html', title: 'Work order: approve plan', stage: 'Plan', mark: 'ask', state: 'Plan ready for you', time: '2m 10s', cost: '$0.12',
  logicSrc: logic({ change: false, sent: false, text: '' }, `return { change: s.change, sent: s.sent, idle: !s.sent,
      toggle: () => this.setState({ change: !s.change }),
      send: () => this.setState({ sent: true, change: false }) };`),
  body: `<section aria-label="Plan" style="display: flex; flex-direction: column; gap: 12px; max-width: 72ch">
      ${h2('Plan')}
      ${p("Shared rounds load without their holes, because the cache added in PR #93 stores the round summary only. <code style=\"" + mono + "; font-size: 12px\">score.ts</code> then reads <code style=\"" + mono + "; font-size: 12px\">round.holes</code> on a summary.")}
      <ol style="margin: 0; padding-inline-start: 20px; display: flex; flex-direction: column; gap: 4px">
        <li>Add a failing test that scores a round loaded from the share link.</li>
        <li>Store holes with the cached round in <code style="${mono}; font-size: 12px">src/rounds/cache.ts</code>.</li>
        <li>Handle rounds already cached without holes by fetching them again.</li>
        <li>Open a PR. Mark the Sentry issue as fixed in the next release.</li>
      </ol>
      ${facts([['Files', 'src/rounds/cache.ts, score.ts, cache.test.ts', 1], ['Risk', 'Low. No schema change, and cached rounds refill themselves.'], ['Estimate', '$0.60 · about 25 minutes', 1], ['Out of scope', 'The share link flow itself.']])}
    </section>
    ${iff('change', `<div style="display: flex; flex-direction: column; gap: 8px; max-width: 72ch">${field('wo-c', 'What should change?', '<textarea id="wo-c" rows="3" placeholder="Don\'t refetch. Clear the old cache entries instead."></textarea>', 'The agent rewrites the plan and asks you again.')}<div>${btn('Send to agent', { on: 'send' })}</div></div>`, 'false')}
    ${iff('sent', `<p role="status" style="margin: 0; display: flex; gap: 8px; align-items: center">${g('run')}Agent is rewriting the plan. You'll see it here and in the queue.</p>`, 'false')}`,
  actions: `${pri('Approve plan', { href: 'WORunning.dc.html', grow: true })}
    ${secondary(btn('Change plan', { on: 'toggle' }), btn('Reject plan', { href: 'Queue.dc.html' }))}
    ${btn('Open in T3', { href: '#t3', grow: true })}`,
});

const buildLog = `✓ wrote src/rounds/cache.test.ts
✓ test fails as expected: round.holes is undefined
→ editing src/rounds/cache.ts
  storing holes with the cached round`;
const buildBody = `<section aria-label="Activity" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Activity')}
      ${step('pass', 'Plan approved by you', '14:02')}
      ${step('pass', 'Created worktree and branch', '14:02')}
      ${step('pass', 'Wrote a failing test', '14:06', '✕ scores a round loaded from the share link\n  TypeError: Cannot read properties of undefined (reading \'holes\')')}
      ${step('run', 'Editing src/rounds/cache.ts', 'now')}
      ${step('idle', 'Run the gates', 'next')}
      ${step('idle', 'Open a PR', 'next')}
    </section>
    <section aria-label="Live output" style="display: flex; flex-direction: column; gap: 8px">
      <div style="display: flex; align-items: center; gap: 8px">${sec('Live output')}<span style="margin-inline-start: auto">${btn('Open in T3', { href: '#t3' })}</span></div>
      ${code(buildLog)}
    </section>`;
const stopThis = danger('Stop this work order', { on: 'askStop', grow: true });
const stopLogic = logic({ ask: false, stopped: false }, `return { ask: s.ask, stopped: s.stopped, notAsk: !s.ask,
      askStop: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }),
      stop: () => this.setState({ ask: false, stopped: true }) };`);
const stopConfirm = `${iff('notAsk', stopThis)}${iff('ask', `<div style="display: flex; flex-direction: column; gap: 8px"><strong>Stop this work order?</strong>${p('The agent stops at its next step. The worktree and branch stay, so you can restart or take over in T3.', 'font-size: 12px')}${secondary(btn('Keep running', { on: 'keep' }), danger('Stop work order', { on: 'stop' }))}</div>`, 'false')}${iff('stopped', `<p role="status" style="margin: 0; color: ${c.muted}; font-size: 12px">Stopping at the agent's next step.</p>`, 'false')}`;

wo({
  ...FIX, file: 'WORunning.dc.html', title: 'Work order: running', stage: 'Build', mark: 'run', state: 'Agent working · 6m', time: '8m 40s', cost: '$0.31',
  logicSrc: stopLogic, body: buildBody + `<p style="margin: 0; color: ${c.muted}; font-size: 12px">Prototype only: ${lnk('jump ahead to when the agent finishes', 'WOReady.dc.html')}</p>`, actions: stopConfirm,
});
wo({
  ...FIX, file: 'WOReady.dc.html', title: 'Work order: PR ready', stage: 'Review', mark: 'pass', state: 'PR #96 ready for you', time: '24m', cost: '$0.58',
  gatesRows: [['gp', 'Typecheck', 'Passed'], ['gp', 'Tests', '180 passed'], ['gp', 'Lint', 'Passed'], ['gp', 'Preview', 'Passed']],
  body: `<section aria-label="Activity" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Activity')}
      ${step('pass', 'Plan approved by you', '14:02')}
      ${step('pass', 'Wrote a failing test', '14:06')}
      ${step('pass', 'Stored holes with the cached round', '14:14')}
      ${step('pass', 'All 4 gates passed on the first try', '14:22')}
      ${step('pass', 'Opened PR #96', '14:26')}
    </section>`,
  actions: `${pri('Review PR', { href: 'PRFix.dc.html', grow: true })}${btn('Open in T3', { href: '#t3', grow: true })}`,
});
wo({
  id: 'WO-211', name: 'Task sync retries twice', project: 'Gather', tree: 'wo-211-sync-retries',
  file: 'WORun211.dc.html', title: 'Work order: running (WO-211)', stage: 'Build', mark: 'run', state: 'Agent working · 12m', time: '14m', cost: '$0.54',
  logicSrc: stopLogic, body: buildBody.replaceAll('src/rounds/cache', 'src/tasks/sync').replace("round.holes is undefined", 'retry ran 2 times').replace("TypeError: Cannot read properties of undefined (reading \\'holes\\')", 'expected 1 retry, got 2').replace('scores a round loaded from the share link', 'retries a failed sync once'), actions: stopConfirm,
});

wo({
  id: 'WO-212', name: 'Remove legacy set table', project: 'Foundry', tree: 'wo-212-remove-set-table',
  file: 'WOQuestion.dc.html', title: 'Work order: agent question', stage: 'Build', mark: 'ask', state: 'Waiting for your answer · 8m', time: '19m', cost: '$0.74',
  logicSrc: logic({ q: 'a', done: false }, `return { qa: s.q === 'a', qb: s.q === 'b', qc: s.q === 'c', done: s.done, open: !s.done,
      pa: () => this.setState({ q: 'a' }), pb: () => this.setState({ q: 'b' }), pc: () => this.setState({ q: 'c' }),
      send: () => this.setState({ done: true }) };`),
  body: `${iff('open', `<section aria-label="Agent question" style="display: flex; flex-direction: column; gap: 12px; max-width: 72ch">
      ${h2('Keep the old migration?')}
      ${p('Migration 0042 still reads <code style="' + mono + '; font-size: 12px">sets_old</code>. Removing the table breaks a fresh install unless 0042 goes too. Production already ran 0042.')}
      <fieldset style="margin: 0; padding: 0; border: 0; display: flex; flex-direction: column"><legend class="sec" style="padding: 0; margin-block-end: 4px">Your answer</legend>
        ${choice('radio', 'q', 'Squash 0001 to 0042 into a new baseline', "The agent's suggestion. Fresh installs skip the old table. Production is unaffected.", { checked: 'qa', onChange: 'pa' })}
        ${choice('radio', 'q', 'Keep 0042 and add 0043 to drop the table', 'Safest and smallest. Every install still creates the table first, then drops it.', { checked: 'qb', onChange: 'pb' })}
        ${choice('radio', 'q', 'Stop here and leave the table', 'Closes the work order without changes.', { checked: 'qc', onChange: 'pc' })}
      </fieldset>
      ${field('q-n', 'Add a note (optional)', '<textarea id="q-n" rows="2"></textarea>')}
    </section>`)}
    ${iff('done', `<p role="status" style="margin: 0; display: flex; gap: 8px; align-items: center">${g('run')}Answer sent. The agent is continuing. ${lnk('Back to the queue', 'Queue.dc.html')}</p>`, 'false')}
    <section aria-label="Activity" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Activity')}
      ${step('pass', 'Plan approved by you', '13:30')}
      ${step('pass', 'Removed models and queries for sets_old', '13:42')}
      ${step('ask', 'Asked a question', '13:49')}
    </section>`,
  actions: `${iff('open', pri('Answer', { on: 'send', grow: true }))}${btn('Open in T3', { href: '#t3', grow: true })}`,
});

wo({
  id: 'WO-213', name: 'Flaky leaderboard test', project: 'Arcade Club', tree: 'wo-213-flaky-leaderboard',
  file: 'WOFailed.dc.html', title: 'Work order: gate failed', stage: 'Verify', mark: 'fail', state: 'Tests failed twice', time: '31m', cost: '$1.12',
  gatesRows: [['gp', 'Typecheck', 'Passed'], ['gf', 'Tests', 'Failed twice'], ['gi', 'Lint', 'Not started'], ['gi', 'Preview', 'Not started']],
  logicSrc: logic({ ask: false }, 'return { ask: s.ask, notAsk: !s.ask, askClose: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }) };'),
  body: `${banner({ glyph: 'fail', title: 'The agent tried once more and the same test failed', body: 'It stops after one retry so it can\'t keep spending. Your call on what happens next.' })}
    <section aria-label="Failure" style="display: flex; flex-direction: column; gap: 8px">
      ${sec('Tests · 2 failed, 214 passed')}
      ${code("✕ leaderboard › orders ties by time\n  expected ['ana', 'bo'] to equal ['bo', 'ana']\n  src/leaderboard/rank.test.ts:58\n✕ leaderboard › keeps rank after refresh\n  src/leaderboard/rank.test.ts:91")}
    </section>
    <section aria-label="Retry" style="display: flex; flex-direction: column; gap: 8px; max-width: 72ch">
      ${field('r-n', 'Tell the agent what to try', '<textarea id="r-n" rows="3" placeholder="The tie break should use finishedAt, not createdAt."></textarea>', 'Your note goes into the next attempt. This counts as a new retry.')}
    </section>
    <section aria-label="Activity" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Activity')}
      ${step('pass', 'Build finished', '13:12')}
      ${step('fail', 'Tests failed', '13:15')}
      ${step('fail', 'Retry failed the same way', '13:24')}
    </section>`,
  actions: `${pri('Retry with this note', { href: 'FloorBoard.dc.html', grow: true })}${btn('Take over in T3', { href: '#t3', grow: true })}
    ${iff('notAsk', danger('Close work order', { on: 'askClose', grow: true }))}
    ${iff('ask', `<div style="display: flex; flex-direction: column; gap: 8px"><strong>Close WO-213?</strong>${p('This deletes the worktree and the branch. The original error stays in the queue.', 'font-size: 12px')}${secondary(btn('Keep it', { on: 'keep' }), danger('Close work order', { href: 'FloorBoard.dc.html' }))}</div>`, 'false')}`,
});

wo({
  id: 'WO-211', name: 'Task sync retries twice', project: 'Gather', tree: 'wo-211-sync-retries', stopped: true,
  file: 'WOStopped.dc.html', title: 'Work order: stopped', stage: 'Build', mark: 'idle', state: 'Stopped with the line at 14:02', time: '14m', cost: '$0.54',
  body: `${banner({ glyph: 'idle', title: 'The line is stopped', body: 'This agent finished its step and stopped. It picks up from here when the line restarts. Its worktree and branch are untouched.' })}
    <section aria-label="Activity" style="display: flex; flex-direction: column; gap: 4px">
      ${sec('Activity')}
      ${step('pass', 'Wrote a failing test', '13:50')}
      ${step('pass', 'Edited src/tasks/sync.ts', '13:59')}
      ${step('idle', 'Stopped before running the gates', '14:02')}
    </section>`,
  actions: `${pri('Restart the line', { href: 'FloorBoard.dc.html', grow: true })}${btn('Take over in T3', { href: '#t3', grow: true })}`,
});

/* ========== PR REVIEW ========== */
const fileRow = (f, a, d) => `<div style="display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; min-height: 32px; padding: 0 12px">${m(f)}<span style="margin-inline-start: auto">${m(`+${a} −${d}`, c.muted)}</span></div>`;
const prLogic = logic({ st: 'idle', changes: false, closing: false }, `
    if (s.st === 'merging' && !this.t) this.t = setTimeout(() => { this.t = null; this.setState({ st: 'merged' }); }, 1200);
    return { idle: s.st === 'idle', merging: s.st === 'merging', merged: s.st === 'merged', notMerged: s.st !== 'merged',
      busy: true, changes: s.changes, notClosing: !s.closing, closing: s.closing,
      merge: () => this.setState({ st: 'merging' }),
      toggle: () => this.setState({ changes: !s.changes }),
      askClose: () => this.setState({ closing: true }), keep: () => this.setState({ closing: false }) };`);

export function pr({ file, title, repo, num, name, project, line, wo: woId, summary, files, gatesRows, primary, state, stateG, note = '', size, cost, age }) {
  board({
    file, title, logic: prLogic,
    body: shell({
      active: 'Pull requests',
      main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 16px">
        ${trail([['Pull requests', 'PullRequests.dc.html'], [`#${num}`]])}
        <div>${muted(`${project} · PR #${num} · ${line}`)}<h1 style="margin: 4px 0 0; font-size: 20px; line-height: 1.2; font-weight: 600">${name}</h1></div>
        ${note}
        ${iff('changes', `<div style="display: flex; flex-direction: column; gap: 8px; max-width: 72ch">${field('pr-c', 'What should change?', '<textarea id="pr-c" rows="3"></textarea>', 'The agent pushes to this PR and the gates run again.')}<div>${btn('Send to agent', { href: 'FloorBoard.dc.html' })}</div></div>`, 'false')}
        <section aria-label="Summary" style="display: flex; flex-direction: column; gap: 8px; max-width: 72ch">${sec('What changed')}${summary}</section>
        <section aria-label="Files" style="display: flex; flex-direction: column; gap: 4px">
          <div style="display: flex; align-items: center; gap: 8px">${sec(`Files · ${size}`)}<span style="margin-inline-start: auto">${btn('Open diff on GitHub', { href: `https://github.com/AppElent/${repo}/pull/${num}/files` })}</span></div>
          ${files.map((f) => fileRow(...f)).join('')}
        </section>
      </div>`,
      pane: `<div style="display: flex; align-items: center; gap: 8px; font-weight: 500">${g(stateG)}<span>${state}</span></div>
        ${iff('notMerged', primary)}
        ${iff('merged', `<p role="status" style="margin: 0">Merged. Shipping to production now. ${lnk('See the floor', 'FloorBoard.dc.html')}</p>`, 'false')}
        ${iff('notMerged', `<div style="display: flex; flex-direction: column; gap: 8px">
          ${btn('Request changes', { on: 'toggle', grow: true })}
          ${iff('notClosing', danger('Close PR', { on: 'askClose', grow: true }))}
          ${iff('closing', `<div style="display: flex; flex-direction: column; gap: 8px"><strong>Close PR #${num}?</strong>${p('The branch stays on GitHub. The work order closes.', 'font-size: 12px')}${secondary(btn('Keep it', { on: 'keep' }), danger('Close PR', { href: 'PullRequests.dc.html' }))}</div>`, 'false')}
        </div>`)}
        <div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px">${gateList(gatesRows)}</div>
        <div style="border-block-start: 1px solid ${c.sub}; padding-block-start: 16px">${facts([['Work order', woId], ['Cost', cost, 1], ['Age', age, 1], ['On GitHub', lnk(`AppElent/${repo}#${num}`, `https://github.com/AppElent/${repo}/pull/${num}`)]])}</div>`,
    }),
  });
}
export const allPass = [['gp', 'Typecheck', 'Passed'], ['gp', 'Tests', '216 passed'], ['gp', 'Lint', 'Passed'], ['gp', 'Preview', 'Passed']];
export const mergeBtn = `${iff('idle', pri('Merge', { on: 'merge', grow: true }))}${iff('merging', pri('Merging…', { disabled: 'busy', grow: true }), 'false')}`;

pr({
  file: 'PRPassed.dc.html', title: 'PR review: all gates passed', repo: 'workouts', num: 168, name: 'Sync toolkit standards', project: 'Foundry', line: 'Toolkit sync', wo: 'WO-207', size: '+214 −98',
  state: 'All gates passed · ready to merge', stateG: 'pass', cost: '$0.62', age: '1h', gatesRows: allPass, primary: mergeBtn,
  summary: `<p style="margin: 0">Brings Foundry up to the current developer-tools standards. Biome config moves to the shared preset. No app code changed.</p><ul style="margin: 0; padding-inline-start: 20px; color: ${c.muted}"><li>Replaces 3 local rules with the shared preset</li><li>Updates the CI workflow to the shared action</li></ul>`,
  files: [['biome.json', 12, 48], ['.github/workflows/ci.yml', 34, 40], ['docs/standards/README.md', 168, 10]],
});
pr({
  file: 'PRFix.dc.html', title: 'PR review: the fix', repo: 'golf-app', num: 96, name: "Fix TypeError reading 'holes'", project: 'Fairway', line: 'Bug fix', wo: 'WO-214', size: '+46 −9',
  state: 'All gates passed · ready to merge', stateG: 'pass', cost: '$0.58', age: '4m', gatesRows: allPass, primary: mergeBtn,
  summary: `<p style="margin: 0">Cached rounds now include their holes. Rounds cached before this change refetch once.</p><ul style="margin: 0; padding-inline-start: 20px; color: ${c.muted}"><li>Adds a test that loads a round from a share link</li><li>Follows the approved plan with no changes</li></ul>`,
  files: [['src/rounds/cache.ts', 18, 7], ['src/rounds/score.ts', 2, 2], ['src/rounds/cache.test.ts', 26, 0]],
});
pr({
  file: 'PRFailed.dc.html', title: 'PR review: gate failed', repo: 'golf-app', num: 94, name: 'Course search empty state', project: 'Fairway', line: 'Feature', wo: 'WO-209', size: '+88 −12',
  state: "Preview failed · can't merge yet", stateG: 'fail', cost: '$1.40', age: '3h',
  gatesRows: [['gp', 'Typecheck', 'Passed'], ['gp', 'Tests', '180 passed'], ['gp', 'Lint', 'Passed'], ['gf', 'Preview', 'Failed']],
  primary: pri('Send back to the agent', { href: 'FloorBoard.dc.html', grow: true }),
  note: banner({ glyph: 'fail', title: 'Preview build failed', body: 'The build can\'t find <code style="' + mono + '; font-size: 12px">EXPO_PUBLIC_MAPS_KEY</code>. Merge stays off until the gate passes.', actions: btn('Open the log', { href: 'https://github.com/AppElent/golf-app/actions' }) }),
  summary: `<p style="margin: 0">Shows a message and a clear-search action when a course search finds nothing.</p>`,
  files: [['src/courses/SearchResults.tsx', 62, 12], ['src/courses/SearchResults.test.tsx', 26, 0]],
});
pr({
  file: 'PRRebase.dc.html', title: 'PR review: needs rebase', repo: 'gather', num: 240, name: 'Export your data as JSON', project: 'Gather', line: 'Feature', wo: 'WO-188', size: '+402 −31',
  state: 'Needs rebase · 18 days behind', stateG: 'idle', cost: '$2.15', age: '18d',
  gatesRows: [['gi', 'Typecheck', 'Out of date'], ['gi', 'Tests', 'Out of date'], ['gi', 'Lint', 'Out of date'], ['gi', 'Preview', 'Out of date']],
  primary: pri('Start rebase work order', { href: 'FloorBoard.dc.html', grow: true }),
  note: banner({ glyph: 'idle', title: 'main moved 41 commits ahead', body: 'The gates passed 18 days ago, so they no longer count. 3 files conflict. A rebase work order resolves them and runs the gates again.' }),
  summary: `<p style="margin: 0">Adds an export button in settings that downloads all your lists as a JSON file.</p>`,
  files: [['src/settings/ExportData.tsx', 180, 4], ['src/data/export.ts', 150, 0], ['src/data/export.test.ts', 72, 27]],
});

/* ========== FLOOR ========== */
const CARDS = [
  { id: 'c1', col: 'Intake', ref: 'WO-215', t: 'Export rounds to CSV', pr: 'Fairway', gl: 'idle', note: 'Idea · waiting', href: 'WOPlan.dc.html' },
  { id: 'c2', col: 'Intake', ref: 'WO-216', t: 'Daily score reset', pr: 'Arcade Club', gl: 'idle', note: 'Idea · waiting', href: 'WOPlan.dc.html' },
  { id: 'c3', col: 'Intake', ref: 'WO-217', t: 'Sync toolkit standards', pr: 'Arcade Club', gl: 'idle', note: 'Waiting', href: 'WOPlan.dc.html' },
  { id: 'c4', col: 'Intake', ref: 'WO-218', t: 'Fix typecheck on main', pr: 'Gather', gl: 'idle', note: 'Waiting', href: 'WOPlan.dc.html' },
  { id: 'c5', col: 'Plan', ref: 'WO-214', t: "Fix TypeError reading 'holes'", pr: 'Fairway', gl: 'ask', note: 'Approve plan', href: 'WOPlan.dc.html' },
  { id: 'c6', col: 'Build', ref: 'WO-212', t: 'Remove legacy set table', pr: 'Foundry', gl: 'ask', note: 'Agent asks a question', href: 'WOQuestion.dc.html', age: '19m' },
  { id: 'c7', col: 'Build', ref: 'WO-211', t: 'Task sync retries twice', pr: 'Gather', gl: 'run', note: 'Working', href: 'WORun211.dc.html', age: '14m', stopHref: 'WOStopped.dc.html' },
  { id: 'c8', col: 'Verify', ref: 'WO-213', t: 'Flaky leaderboard test', pr: 'Arcade Club', gl: 'fail', note: 'Tests failed twice', href: 'WOFailed.dc.html', gates: 'pfii', age: '31m' },
  { id: 'c9', col: 'Review', ref: '#168', t: 'Sync toolkit standards', pr: 'Foundry', gl: 'pass', note: 'Ready to merge', href: 'PRPassed.dc.html', gates: 'pppp', age: '1h' },
  { id: 'c10', col: 'Review', ref: '#94', t: 'Course search empty state', pr: 'Fairway', gl: 'fail', note: 'Preview failed', href: 'PRFailed.dc.html', gates: 'pppf', age: '3h' },
  { id: 'c11', col: 'Review', ref: '#240', t: 'Export your data as JSON', pr: 'Gather', gl: 'idle', note: 'Needs rebase', href: 'PRRebase.dc.html', gates: 'iiii', age: '18d' },
  { id: 'c12', col: 'Observe', ref: 'WO-208', t: 'Faster workout list', pr: 'Foundry', gl: 'pass', note: 'Shipped 2h ago · no new errors', href: 'Health.dc.html' },
  { id: 'c13', col: 'Observe', ref: 'FAIRWAY-W3', t: "TypeError reading 'holes'", pr: 'Fairway', gl: 'err', note: '14 users', href: 'ErrorNew.dc.html' },
  { id: 'c14', col: 'Observe', ref: 'WO-206', t: 'Share a round with a link', pr: 'Fairway', gl: 'err', note: 'Shipped 5h ago · caused 1 error', href: 'ErrorNew.dc.html' },
];
export const PROJECTS = ['All projects', 'Arcade Club', 'Fairway', 'Foundry', 'Gather'];
const floorLogic = logic({ pr: 'All projects' }, `
    const cards = ${JSON.stringify(CARDS.map((x) => [x.id, x.pr]))};
    const vis = {};
    cards.forEach(([id, pr]) => { vis[id] = s.pr === 'All projects' || s.pr === pr; });
    return { vis, pick: (e) => this.setState({ pr: e.target.value }) };`);

export function floor({ file, title, limits = {}, top = '', stopped = false, extraBuild, status }) {
  const COLS = [['Intake', '4'], ['Plan', '1'], ['Build', limits.Build ?? '2/3'], ['Verify', '1/3'], ['Review', limits.Review ?? '3'], ['Ship', '0'], ['Observe', '3']];
  const card = (x) => iff(`vis.${x.id}`, `<a class="card" href="${stopped && x.stopHref ? x.stopHref : x.href}" style="display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: ${c.raised}; border-radius: 6px">
      <div style="display: flex; align-items: center; gap: 8px">${m(x.ref, c.muted)}${x.age ? `<span style="margin-inline-start: auto">${m(x.age, c.muted)}</span>` : ''}</div>
      <div style="font-weight: 500; overflow-wrap: anywhere">${x.t}</div>
      ${muted(x.pr)}
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block-start: 4px">${g(x.gl, 14)}<span style="font-size: 12px; color: ${c.muted}">${stopped && x.gl === 'run' ? 'Finishing its step' : x.note}</span>${x.gates ? `<span style="margin-inline-start: auto">${gates(x.gates)}</span>` : ''}</div>
    </a>`);
  const cols = COLS.map(([name, load]) => {
    const [n, max] = load.split('/');
    const full = max && n === max;
    const list = CARDS.filter((x) => x.col === name);
    const extra = name === 'Build' && extraBuild ? [extraBuild] : [];
    return `<section aria-label="${name}" style="min-width: 0; display: flex; flex-direction: column; gap: 8px">
      <div style="display: flex; align-items: center; gap: 8px; min-height: 28px"><h2 class="sec">${name}</h2><span style="margin-inline-start: auto; display: inline-flex; align-items: center; gap: 4px; ${mono}; font-size: 12px; color: ${c.muted}">${full ? `${g('ask', 12)}<span>Full </span>` : ''}${load}</span></div>
      ${[...list, ...extra].map(card).join('\n')}
      ${list.length + extra.length === 0 ? `<p style="margin: 0; padding: 8px 12px; color: ${c.muted}; font-size: 12px">Nothing here</p>` : ''}
    </section>`;
  }).join('\n');
  const logicSrc = extraBuild ? floorLogic.replace('const vis = {};', `const vis = { ${extraBuild.id}: true };`) : floorLogic;
  board({
    file, title, logic: logicSrc,
    body: shell({
      active: 'Floor', stopped, status,
      main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 16px">
        <header style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">
          <h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Floor</h1>
          <a class="lnk" href="Health.dc.html" style="color: ${c.muted}; font-size: 12px">6 shipped today · 4 of 6 first try · 38m median to PR · $1.80 per change</a>
          <span style="margin-inline-start: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><label for="fl-p" style="color: ${c.muted}; font-size: 12px">Project</label><select id="fl-p" onChange="{{pick}}">${PROJECTS.map((x) => `<option>${x}</option>`).join('')}</select>${btn('New work order', { href: 'NewWorkOrder.dc.html' })}</span>
        </header>
        ${top}
        <div style="overflow-x: auto; padding-block-end: 8px"><div style="display: grid; grid-template-columns: ${COLS.map(([name]) => (CARDS.some((x) => x.col === name) || (name === 'Build' && extraBuild) ? 'minmax(140px, 1fr)' : 'minmax(88px, 0.5fr)')).join(' ')}; gap: 8px; align-items: start">${cols}</div></div>
      </div>`,
    }),
  });
}

floor({ file: 'FloorBoard.dc.html', title: 'Floor' });
floor({
  file: 'FloorLimit.dc.html', title: 'Floor: at limit', limits: { Build: '3/3' },
  status: ['3 of 3 agents working', 'Synced 1m ago'],
  extraBuild: { id: 'c20', ref: 'WO-219', t: 'Weekly summary', pr: 'Foundry', gl: 'run', note: 'Working', href: 'WORun211.dc.html', age: '3m' },
  top: banner({ glyph: 'ask', title: 'Build is full', body: 'Work orders wait in Intake and start when a slot opens.' }),
});
floor({
  file: 'FloorReviewHold.dc.html', title: 'Floor: paused for review', limits: { Review: '3/3' },
  top: banner({ glyph: 'ask', title: 'Review is full', body: 'New work waits in Intake until you review a PR. You turned this on in Settings.', actions: `${btn('Review PRs', { href: 'PullRequests.dc.html' })}${btn('Change this', { href: 'SettingsAgents.dc.html' })}` }),
});
floor({
  file: 'FloorStopped.dc.html', title: 'Floor: line stopped', stopped: true,
  top: banner({
    glyph: 'fail', role: 'alert', title: 'Line stopped at 14:02',
    body: 'Nothing new starts. 2 agents are finishing the step they’re on, then they hold. PRs and errors keep updating.',
    actions: pri('Restart the line', { href: 'FloorBoard.dc.html' }),
  }),
});
const stopBody = `${p('Agents already working finish the step they’re on, then hold. Their worktrees stay as they are. To stop one right away, open it in T3. Nothing new starts until you restart.')}
  ${facts([['Agents affected', 'WO-211, WO-212'], ['Waiting', '4 in Intake, 1 in Plan'], ['Not affected', 'Merged PRs and deploys already running']])}
  <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { href: 'FloorBoard.dc.html' })}${dangerFill('Stop the line', { href: 'FloorStopped.dc.html' })}</div>`;
board({
  file: 'StopConfirm.dc.html', title: 'Stop the line: confirm',
  body: shell({ active: 'Floor', main: `<div style="padding: 16px 24px"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Floor</h1></div>`, overlay: dialog('st', 'Stop the line?', stopBody) }),
});

/* ========== PULL REQUESTS ========== */
const prRow = (href, gl, num, t, pr2, gt, size, age) => `<a class="row" href="${href}" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g(gl)}${m(num, c.muted)}<span style="flex: 1 1 220px; min-width: 0; font-weight: 500">${t}</span><span style="width: 88px; color: ${c.muted}">${pr2}</span><span style="width: 56px">${gt}</span><span style="width: 88px; text-align: end">${m(size, c.muted)}</span><span style="width: 32px; text-align: end">${m(age, c.muted)}</span></a>`;
const group = (name, n, rows) => `<section aria-label="${name}" style="display: flex; flex-direction: column; gap: 4px">${sec(`${name} · ${n}`)}${rows.join('')}</section>`;
export const listHead = (title, sub, right = '') => `<header style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">${title}</h1><span style="color: ${c.muted}">${sub}</span><span style="margin-inline-start: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px">${right}</span></header>`;
const projectFilter = (id) => `<label for="${id}" style="color: ${c.muted}; font-size: 12px">Project</label><select id="${id}">${PROJECTS.map((x) => `<option>${x}</option>`).join('')}</select>`;

board({
  file: 'PullRequestsEmpty.dc.html', title: 'Pull requests: none open',
  body: shell({
    active: 'Pull requests', counts: false,
    main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">${listHead('Pull requests', '0 open')}
      <div style="padding-block-start: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; max-width: 560px">${h2('No open pull requests')}${p('PRs from your work orders and from anyone else on GitHub show up here, grouped by what they need.')}<div style="margin-block-start: 8px">${pri('New work order', { href: 'NewWorkOrder.dc.html' })}</div></div></div>`,
  }),
});

/* ========== ERRORS ========== */
const errRow = (href, gl, t, state, ev, us, age) => `<a class="row" href="${href}" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 6px 12px; border-radius: 6px">${g(gl)}<span style="flex: 1 1 280px; min-width: 0; font-weight: 500; overflow-wrap: anywhere">${t}</span><span style="width: 96px; color: ${c.muted}; font-size: 12px">${state}</span><span style="width: 88px; text-align: end">${m(ev, c.muted)}</span><span style="width: 72px; text-align: end">${m(us, c.muted)}</span><span style="width: 32px; text-align: end">${m(age, c.muted)}</span></a>`;
board({
  file: 'ErrorsEmpty.dc.html', title: 'Errors: none open',
  body: shell({
    active: 'Errors', counts: false,
    main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">${listHead('Errors', '0 open')}
      <div style="padding-block-start: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; max-width: 560px">${h2('No open errors')}${p('Sentry reports nothing new in 9 connected projects. Checked 1 minute ago.')}<p style="margin: 0; color: ${c.muted}">3 projects have no Sentry yet. ${lnk('Connect them in Projects', 'Projects.dc.html')}</p></div></div>`,
  }),
});

/* ========== PROJECTS ========== */
export const PD = { Fairway: 'ProjectDetail.dc.html', labs: 'ProjectMissing.dc.html', roadmaps: 'ProjectQuiet.dc.html' };
export const P = [
  ['Fairway', 'golf-app', '2', '1', '2', 'Current', '5h ago · EAS'], ['Foundry', 'workouts', '1', '2', '0', 'Current', '2h ago · EAS'],
  ['Gather', 'gather', '2', '3', '1', 'Current', '1d ago · Cloudflare'], ['Arcade Club', 'games', '3', '1', '0', '4 days behind', '3d ago · Cloudflare'],
  ['developer-tools', 'developer-tools', '0', '0', '–', 'Source', '–'], ['labs', 'labs', '0', '0', '–', '41 days behind', '–'],
  ['satisfactory', 'satisfactory', '0', '0', '0', '69 days behind', '69d ago · Cloudflare'], ['roadmaps', 'roadmaps', '0', '0', '–', '69 days behind', '–'],
  ['appelent-skills', 'appelent-skills', '0', '0', '–', 'Current', '–'], ['appelent-packages', 'appelent-packages', '0', '0', '–', 'Current', '–'],
  ['agent-plugins', 'agent-plugins', '0', '0', '–', 'Current', '–'], ['workout-tracker', 'workout-tracker', '0', '0', '–', 'Current', '–'],
];
export const th = (t, end) => `<th scope="col" style="padding: 8px 12px; text-align: ${end ? 'end' : 'start'}; font-weight: 500; color: ${c.muted}; font-size: 12px; border-block-end: 1px solid ${c.sub}; white-space: nowrap">${t}</th>`;
export const td = (t, o = {}) => `<td style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; ${o.end ? 'text-align: end;' : ''} ${o.mono ? `${mono}; font-size: 12px;` : ''} ${o.muted ? `color: ${c.muted};` : ''} white-space: nowrap">${t}</td>`;

/* ========== HEALTH ========== */
const SERIES = {
  shipped: { label: 'Shipped', value: '31', sub: 'last 14 days', vals: [1, 2, 3, 2, 0, 0, 3, 4, 2, 3, 1, 0, 4, 6], unit: 'changes' },
  first: { label: 'First-try', value: '71%', sub: '22 of 31', vals: [100, 50, 67, 50, 0, 0, 67, 75, 100, 67, 100, 0, 75, 67], unit: '%' },
  time: { label: 'Median to PR', value: '38m', sub: 'was 52m', vals: [61, 55, 48, 52, 0, 0, 44, 41, 39, 47, 36, 0, 35, 38], unit: 'm' },
  cost: { label: 'Cost per change', value: '$1.80', sub: 'was $2.40', vals: [2.8, 2.5, 2.2, 2.6, 0, 0, 2.1, 1.9, 1.6, 2.0, 1.7, 0, 1.9, 1.8], unit: '$' },
};
const DAYS = ['23 Oct', '24 Oct', '25 Oct', '26 Oct', '27 Oct', '28 Oct', '29 Oct', '30 Oct', '31 Oct', '1 Nov', '2 Nov', '3 Nov', '4 Nov', '5 Nov'];
const healthLogic = logic({ tab: 'shipped', ask: false, on: false }, `
    const S = ${JSON.stringify(SERIES)}; const D = ${JSON.stringify(DAYS)};
    const cur = S[s.tab]; const max = Math.max(...cur.vals);
    const fmt = (v) => cur.unit === '$' ? '$' + v.toFixed(2) : cur.unit === '%' ? v + '%' : cur.unit === 'm' ? v + 'm' : String(v);
    const tabs = {}, press = {}, ring = {};
    Object.keys(S).forEach((k) => { tabs[k] = () => this.setState({ tab: k }); press[k] = s.tab === k; ring[k] = s.tab === k ? '${c.raised}' : 'transparent'; });
    return { tabs, press, ring, title: cur.label + ' per day', ask: s.ask, alone: s.on, notAlone: !s.on,
      askOn: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }), turnOn: () => this.setState({ ask: false, on: true }),
      summary: cur.label + ', last 14 days. Latest ' + fmt(cur.vals[13]) + '. Highest ' + fmt(max) + '.',
      bars: cur.vals.map((v, i) => ({ h: Math.max(2, Math.round((v / max) * 160)) + 'px', tip: D[i] + ': ' + fmt(v), day: D[i], val: fmt(v), tick: i % 3 === 0 ? D[i] : '' })) };`);
const tile = (k, s) => `<button type="button" class="btn" aria-pressed="{{press.${k}}}" onClick="{{tabs.${k}}}" style="flex: 1 1 160px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 16px; background: {{ring.${k}}}; border: 1px solid ${c.sub}; border-radius: 6px; color: ${c.text}; font: inherit; text-align: start; cursor: pointer"><span style="color: ${c.muted}; font-size: 12px">${s.label}</span><span style="${mono}; font-size: 16px; font-weight: 500; line-height: 1.25">${s.value}</span><span style="color: ${c.muted}; font-size: 12px">${s.sub}</span></button>`;
const LINES = [['Bug fix', '14', '12 of 14', '31m', '$1.40', 'Qualifies'], ['Feature', '9', '5 of 9', '54m', '$3.10', 'Needs you'], ['Toolkit sync', '6', '5 of 6', '12m', '$0.60', 'Needs you'], ['Chore', '2', '–', '9m', '$0.30', 'Too few runs']];
board({
  file: 'Health.dc.html', title: 'Health', logic: healthLogic,
  body: shell({
    active: 'Health',
    overlay: iff('ask', dialog('al', 'Let bug fixes merge without you?', `${p('When all 4 gates pass, a bug-fix PR merges and ships without you. You still see it on the floor, and any new error goes back to Intake. If a bug fix causes a regression, this turns off and you merge again. Projects set to always ask you are not affected.')}<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${btn('Cancel', { on: 'keep' })}${pri('Turn on', { on: 'turnOn' })}</div>`), 'false'),
    main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">
      ${listHead('Health', 'Last 14 days', '')}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${Object.entries(SERIES).map(([k, s]) => tile(k, s)).join('')}</div>
      <section aria-label="Chart" style="display: flex; flex-direction: column; gap: 8px">
        ${sec('{{title}}')}
        <div role="img" aria-label="{{summary}}" style="display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 2px; align-items: end; height: 160px; border-block-end: 1px solid ${c.sub}">
          <sc-for list="{{bars}}" as="b" hint-placeholder-count="14"><span title="{{b.tip}}" style="display: block; height: {{b.h}}; background: ${c.input}; border-radius: 4px 4px 0 0"></span></sc-for>
        </div>
        <div aria-hidden="true" style="display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 2px; color: ${c.muted}; font-size: 12px"><sc-for list="{{bars}}" as="b" hint-placeholder-count="14"><span style="white-space: nowrap">{{b.tick}}</span></sc-for></div>
        <p style="margin: 0; color: ${c.muted}; font-size: 12px">{{summary}}</p>
        <details><summary style="color: ${c.muted}; font-size: 12px">Show daily numbers</summary><table style="margin-block-start: 8px; border-collapse: collapse; font-size: 12px"><tbody><sc-for list="{{bars}}" as="b" hint-placeholder-count="14"><tr><th scope="row" style="padding: 2px 16px 2px 0; text-align: start; font-weight: 400; color: ${c.muted}">{{b.day}}</th><td style="${mono}; text-align: end">{{b.val}}</td></tr></sc-for></tbody></table></details>
      </section>
      <section aria-label="By work type" style="display: flex; flex-direction: column; gap: 8px">
        ${sec('By work type')}
        <div style="overflow-x: auto"><table style="width: 100%; border-collapse: collapse"><thead><tr>${th('Work type')}${th('Runs', 1)}${th('First try', 1)}${th('Median to PR', 1)}${th('Cost per change', 1)}${th('Merging')}</tr></thead>
        <tbody>${LINES.map(([n, r, f, t, co, tr]) => `<tr><th scope="row" style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; text-align: start; font-weight: 500">${n}</th>${td(r, { end: 1, mono: 1 })}${td(f, { end: 1, mono: 1 })}${td(t, { end: 1, mono: 1 })}${td(co, { end: 1, mono: 1 })}<td style="padding: 8px 12px; border-block-end: 1px solid ${c.sub}; white-space: nowrap">${tr === 'Qualifies' ? `<span style="display: inline-flex; align-items: center; gap: 8px">${g('pass', 14)}${iff('notAlone', `<span>Can merge without you</span>${btn('Turn on', { on: 'askOn' })}`)}${iff('alone', '<span>Merges without you</span>', 'false')}</span>` : `<span style="color: ${c.muted}">${tr}</span>`}</td></tr>`).join('')}</tbody></table></div>
        <p style="margin: 0; color: ${c.muted}; font-size: 12px">A work type qualifies after 10 runs with at least 80% passing every gate on the first try and no regressions. Nothing changes until you turn it on. ${lnk('Change this in Settings', 'SettingsApprovals.dc.html')}</p>
      </section>
    </div>`,
  }),
});
board({
  file: 'HealthEarly.dc.html', title: 'Health: too little data',
  body: shell({
    active: 'Health',
    main: `<div style="padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 20px">
      ${listHead('Health', '3 work orders so far', '')}
      ${banner({ title: 'Too little data to trust yet', body: 'Numbers show after 10 finished work orders, because 3 runs can swing from 100% to 33% on one failure. 7 to go.', actions: btn('See finished work orders', { href: 'FloorBoard.dc.html' }) })}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${['Shipped', 'First-try', 'Median to PR', 'Cost per change'].map((l, i) => `<div style="flex: 1 1 160px; display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border: 1px solid ${c.sub}; border-radius: 6px"><span style="color: ${c.muted}; font-size: 12px">${l}</span><span style="${mono}; font-size: 16px; font-weight: 500; line-height: 1.25">${i === 0 ? '3' : '–'}</span><span style="color: ${c.muted}; font-size: 12px">${i === 0 ? 'so far' : 'Not enough runs'}</span></div>`).join('')}</div>
      ${p('Until then, every merge waits for you.')}
    </div>`,
  }),
});

/* ========== COMMAND MENU ========== */
const CMD = [
  ['Go to', 'Queue', 'Queue.dc.html', 'g q'], ['Go to', 'Floor', 'FloorBoard.dc.html', 'g f'], ['Go to', 'Pull requests', 'PullRequests.dc.html', 'g p'],
  ['Go to', 'Errors', 'ErrorsList.dc.html', 'g e'], ['Go to', 'Projects', 'Projects.dc.html', 'g o'], ['Go to', 'Health', 'Health.dc.html', 'g h'],
  ['Actions', 'New work order', 'NewWorkOrder.dc.html', 'n'], ['Actions', 'New project', 'NLDescribe.dc.html', ''], ['Actions', 'Sync 4 projects behind on the toolkit', 'ProjectsBulk.dc.html', ''], ['Go to', 'Settings', 'SettingsAgents.dc.html', 'g s'], ['Actions', 'Stop the line', 'StopConfirm.dc.html', ''],
  ['Work', 'WO-212 Remove legacy set table', 'WOQuestion.dc.html', ''], ['Work', 'WO-214 Fix TypeError reading holes', 'WOPlan.dc.html', ''],
  ['Work', '#168 Sync toolkit standards', 'PRPassed.dc.html', ''], ['Work', '#240 Export your data as JSON', 'PRRebase.dc.html', ''],
];
const cmdItem = (i, [, label, href, key]) => iff(`vis.i${i}`, `<a class="row" href="${href}" style="display: flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 6px"><span>${label}</span>${key ? `<span style="margin-inline-start: auto; ${mono}; font-size: 12px; color: ${c.muted}">${key}</span>` : ''}</a>`);
const cmdBody = (q) => {
  const groups = ['Go to', 'Actions', 'Work'];
  const list = groups.map((gr) => iff(`gv.${gr.replace(' ', '')}`, `<div style="display: flex; flex-direction: column"><div class="sec" style="padding: 8px 12px 4px">${gr}</div>${CMD.map((x, i) => (x[0] === gr ? cmdItem(i, x) : '')).join('')}</div>`)).join('');
  return { list, q };
};
function cmdBoard(file, title, q) {
  const { list } = cmdBody(q);
  board({
    file, title,
    logic: logic({ q }, `
    const items = ${JSON.stringify(CMD.map((x) => [x[0], x[1]]))};
    const t = s.q.trim().toLowerCase();
    const vis = {}, gv = {}; let any = false;
    items.forEach(([gr, l], i) => { const on = !t || l.toLowerCase().includes(t); vis['i' + i] = on; if (on) { gv[gr.replace(' ', '')] = true; any = true; } });
    return { q: s.q, vis, gv, none: !any, some: any, type: (e) => this.setState({ q: e.target.value }), clear: () => this.setState({ q: '' }) };`),
    body: shell({
      active: 'Queue',
      main: `<div style="padding: 16px 24px"><h1 style="margin: 0; font-size: 20px; line-height: 1.2; font-weight: 600">Queue</h1></div>`,
      overlay: `<div style="position: absolute; inset: 0; background: rgba(14, 16, 19, 0.78); display: flex; justify-content: center; align-items: flex-start; padding: 96px 16px 16px; box-sizing: border-box">
        <div role="dialog" aria-modal="true" aria-label="Search or run a command" style="width: 100%; max-width: 560px; background: ${c.raised}; border: 1px solid ${c.ctl}; border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; overflow: hidden">
          <div style="padding: 12px; border-block-end: 1px solid ${c.sub}"><input type="search" aria-label="Search or run a command" placeholder="Search or run a command" value="{{q}}" onChange="{{type}}" style="width: 100%"></div>
          <div style="padding: 4px; max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px">
            ${iff('some', list, q ? 'false' : 'true')}
            ${iff('none', `<div style="padding: 20px 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start"><p role="status" style="margin: 0">No results for ‘{{q}}’.</p><div style="display: flex; flex-wrap: wrap; gap: 8px">${btn('New work order from this', { href: 'NewWorkOrder.dc.html' })}${btn('Clear search', { on: 'clear' })}</div></div>`, q ? 'true' : 'false')}
          </div>
          <div style="padding: 8px 12px; border-block-start: 1px solid ${c.sub}; display: flex; flex-wrap: wrap; gap: 16px; color: ${c.muted}; font-size: 12px">
            ${[['↑ ↓', 'move'], ['↵', 'open'], ['esc', 'close']].map(([k, v]) => `<span><b style="${mono}; font-weight: 500; color: ${c.text}">${k}</b> ${v}</span>`).join('')}
          </div>
        </div>
      </div>`,
    }),
  });
}
cmdBoard('CmdK.dc.html', 'Command menu', '');
cmdBoard('CmdKEmpty.dc.html', 'Command menu: no results', 'deploy gather');
