import { c, mono, g, m, muted, p, sec, h2, lnk, code, pri, btn, danger, iff, field, facts, banner, board, logic, setup, choice, refs } from './lib.mjs';

/* ========== FIRST RUN ========== */
const FR = ['Check your tools', 'Choose projects', 'Read projects', 'Open your queue'];
const toolRow = (name, role, glyph, state, fix = '') => `<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-block-end: 1px solid ${c.sub}">
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px">${g(glyph)}<span style="width: 80px; ${mono}; font-size: 12px">${name}</span><span style="flex: 1 1 240px; color: ${c.muted}">${role}</span><span style="font-weight: 500">${state}</span></div>
  ${fix ? `<div style="padding-inline-start: 28px">${fix}</div>` : ''}
</div>`;
const toolsLogic = logic({ st: 'bad' }, `
    if (s.st === 'checking' && !this.t) this.t = setTimeout(() => { this.t = null; this.setState({ st: 'good' }); }, 1000);
    return { bad: s.st === 'bad', checking: s.st === 'checking', good: s.st === 'good', busy: true, check: () => this.setState({ st: 'checking' }) };`);

board({
  file: 'FRTools.dc.html', title: 'First run: tools with a problem', logic: toolsLogic,
  body: setup({
    steps: FR, current: 0, title: 'Check your tools',
    lead: 'Software Factory runs on the tools you already use. Nothing has been changed on this Mac.',
    main: `<div>
        ${toolRow('gh', 'Pull requests and repos', 'pass', 'Signed in as AppElent')}
        ${toolRow('t3', 'Runs the agents', 'pass', 'Ready')}
        ${toolRow('sentry', 'Production errors', 'pass', 'Signed in')}
        ${iff('good', toolRow('eas', 'App builds and deploys', 'pass', 'Signed in'), 'false')}
        ${iff('bad', toolRow('eas', 'App builds and deploys', 'fail', 'Not signed in', code('eas login') + `<div style="margin-block-start: 8px; display: flex; gap: 8px">${btn('Check again', { on: 'check' })}</div>`))}
        ${iff('checking', toolRow('eas', 'App builds and deploys', 'run', 'Checking', code('eas login') + `<div style="margin-block-start: 8px">${btn('Checking…', { disabled: 'busy' })}</div>`), 'false')}
        ${toolRow('infisical', 'Secrets for new projects', 'idle', 'Not installed', `<span style="color: ${c.muted}; font-size: 12px">Optional. Without it, new projects skip the secrets step. Install it with </span>${m('brew install infisical')}`)}
        ${toolRow('terminal-notifier', 'macOS notifications', 'pass', 'Ready')}
      </div>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${pri('Continue', { href: 'FRRepos.dc.html' })}<span style="color: ${c.muted}; font-size: 12px">You can fix eas and infisical later. They show in Later on the queue.</span></div>`,
  }),
});
board({
  file: 'FRToolsBlocked.dc.html', title: 'First run: required tool missing',
  body: setup({
    steps: FR, current: 0, title: 'Check your tools',
    lead: 'Software Factory runs on the tools you already use. Nothing has been changed on this Mac.',
    main: `<div>
        ${toolRow('gh', 'Pull requests and repos', 'fail', 'Not signed in', code('gh auth login') + `<div style="margin-block-start: 8px"><span style="color: ${c.muted}; font-size: 12px">Required. Projects and PRs come from GitHub.</span></div>`)}
        ${toolRow('t3', 'Runs the agents', 'pass', 'Ready')}
        ${toolRow('sentry', 'Production errors', 'idle', 'Not signed in', `<span style="color: ${c.muted}; font-size: 12px">Optional. Without it, errors don't reach the queue.</span>`)}
        ${toolRow('eas', 'App builds and deploys', 'idle', 'Not signed in', `<span style="color: ${c.muted}; font-size: 12px">Optional. Without it, app deploys aren't tracked.</span>`)}
        ${toolRow('infisical', 'Secrets for new projects', 'idle', 'Not installed', `<span style="color: ${c.muted}; font-size: 12px">Optional. Without it, new projects skip the secrets step.</span>`)}
        ${toolRow('terminal-notifier', 'macOS notifications', 'pass', 'Ready')}
      </div>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${pri('Check again', { href: 'FRTools.dc.html' })}<span style="color: ${c.muted}; font-size: 12px">Sign in to gh to continue.</span></div>`,
  }),
});

const REPOS = [
  ['workouts', 'Foundry', '3 days ago', '~/Developer/workouts', true], ['golf-app', 'Fairway', '4 days ago', '~/Developer/golf-app', true],
  ['gather', 'Gather', '4 days ago', '~/Developer/gather', true], ['games', 'Arcade Club', '4 days ago', '', false],
  ['developer-tools', '', '1 day ago', '~/Developer/developer-tools', true], ['labs', '', '43 days ago', '', false],
  ['satisfactory', '', '69 days ago', '~/Developer/satisfactory', true], ['roadmaps', '', '69 days ago', '', false],
];
board({
  file: 'FRRepos.dc.html', title: 'First run: choose projects',
  logic: logic({ sel: {}, q: '', clone: {}, err: false }, `
    const repos = ${JSON.stringify(REPOS.map((r) => r[0].replace(/-/g, '_')))};
    const t = s.q.trim().toLowerCase();
    const show = {}, on = {}, flip = {}, clone = {}, cloning = {}, cloned = {}, notCloned = {};
    repos.forEach((r) => {
      show[r] = !t || r.replace(/_/g, '-').includes(t); on[r] = !!s.sel[r];
      flip[r] = () => this.setState({ sel: { ...s.sel, [r]: !s.sel[r] }, err: false });
      cloning[r] = s.clone[r] === 'busy'; cloned[r] = s.clone[r] === 'done'; notCloned[r] = !s.clone[r];
      clone[r] = () => { this.setState({ clone: { ...s.clone, [r]: 'busy' } }); setTimeout(() => this.setState((st) => ({ clone: { ...st.clone, [r]: 'done' } })), 1200); };
    });
    const n = Object.values(s.sel).filter(Boolean).length;
    const none = repos.every((r) => !show[r]);
    return { show, on, flip, clone, cloning, cloned, notCloned, none, q: s.q, err: s.err,
      count: n + ' of 26 selected', ready: n > 0, notReady: n === 0, busy: true,
      type: (e) => this.setState({ q: e.target.value }), fail: () => this.setState({ err: true }) };`),
  body: setup({
    steps: FR, current: 1, title: 'Choose projects',
    lead: "Everything starts off. Only the projects you turn on get read, and reading doesn't change anything.",
    main: `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">
        <input type="search" aria-label="Search repos" placeholder="Search 26 repos" value="{{q}}" onChange="{{type}}" style="flex: 1 1 240px">
        <span role="status" style="${mono}; font-size: 12px; color: ${c.muted}">{{count}}</span>
      </div>
      <div style="display: flex; flex-direction: column">
        ${REPOS.map(([r, prod, age, path, local]) => iff(`show.${r.replace(/-/g, '_')}`, `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; border-block-end: 1px solid ${c.sub}">
          <label style="flex: 1 1 240px; display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer"><input type="checkbox" checked="{{on.${r.replace(/-/g, '_')}}}" onChange="{{flip.${r.replace(/-/g, '_')}}}"><span style="font-weight: 500">${r}</span>${prod ? muted(prod) : ''}</label>
          ${muted(age)}
          ${local ? `<span style="width: 200px">${m(path, c.muted)}</span>` : `<span style="width: 200px; display: flex; align-items: center; gap: 8px">${iff(`notCloned.${r}`, `<span style="color: ${c.muted}; font-size: 12px">Not on this Mac</span>${btn('Clone', { on: `clone.${r}` })}`)}${iff(`cloning.${r}`, btn('Cloning…', { disabled: 'busy' }), 'false')}${iff(`cloned.${r}`, m(`~/Developer/${r}`, c.muted), 'false')}</span>`}
        </div>`)).join('\n')}
        ${iff('none', `<p style="margin: 0; padding: 12px 0; color: ${c.muted}">No repos match ‘{{q}}’.</p>`, 'false')}
      </div>
      ${banner({ title: '2 repos skipped before reading', body: 'client-work and client-archive match your exclude rule, so nothing in them was opened.' })}
      ${iff('err', `<p role="alert" style="margin: 0; color: ${c.fail}">Turn on at least one project to continue.</p>`, 'false')}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${iff('ready', pri('Continue', { href: 'FRReading.dc.html' }), 'false')}${iff('notReady', pri('Continue', { on: 'fail' }))}${btn('Back', { href: 'FRTools.dc.html' })}</div>`,
  }),
});

const readRow = (glyph, name, state) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; border-block-end: 1px solid ${c.sub}">${g(glyph)}<span style="width: 140px; font-weight: 500">${name}</span><span style="flex: 1 1 240px; color: ${c.muted}">${state}</span></div>`;
board({
  file: 'FRReading.dc.html', title: 'First run: reading projects',
  body: setup({
    steps: FR, current: 2, title: 'Reading 3 projects',
    lead: 'Reading only. No branches, no commits, no agents.',
    main: `<div role="status">
        ${readRow('pass', 'Foundry', '2 open PRs · no errors · toolkit current')}
        ${readRow('pass', 'Fairway', '2 open PRs · 1 production error · toolkit current')}
        ${readRow('run', 'Gather', 'Reading open PRs')}
      </div>
      ${banner({ glyph: 'idle', title: 'Fairway has no EAS project linked', body: "You can still see its PRs and errors. Its deploys won't be tracked until you connect it in Projects." })}
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${pri('Open your queue', { href: 'QueueFirst.dc.html' })}<span style="color: ${c.muted}; font-size: 12px">Gather joins the queue when it finishes.</span></div>`,
  }),
});

/* ========== NEW LINE ========== */
const NL = ['Describe', 'Approve changes', 'Scaffold', 'Connect services', 'First idea'];
const nlCrumbs = [['Projects', 'Projects.dc.html'], ['New project']];
const tpl = [['expo', 'Expo app', 'iOS, Android, and web from one codebase. EAS builds.'], ['vite', 'Vite web app', 'React with TanStack Router. Deploys to Cloudflare.'], ['node', 'Node service', 'Hono API. Deploys to Cloudflare Workers.'], ['bare', 'Toolkit only', 'Standards, CI, and agents setup with no app code.']];
board({
  file: 'NLDescribe.dc.html', title: 'New project: describe',
  logic: logic({ name: 'caddie', tpl: 'expo', vis: 'private', err: false }, `
    const taken = ['gather', 'workouts', 'golf-app', 'games'];
    const bad = taken.includes(s.name.trim().toLowerCase());
    const blank = !s.name.trim();
    const tplOn = {}, tplPick = {};
    ${JSON.stringify(tpl.map((t) => t[0]))}.forEach((k) => { tplOn[k] = s.tpl === k; tplPick[k] = () => this.setState({ tpl: k }); });
    return { name: s.name, bad, blank, ok: !bad && !blank, notOk: bad || blank, err: s.err && (bad || blank), taken: bad, tplOn, tplPick,
      priv: s.vis === 'private', pub: s.vis === 'public', pickPriv: () => this.setState({ vis: 'private' }), pickPub: () => this.setState({ vis: 'public' }),
      type: (e) => this.setState({ name: e.target.value, err: false }), fail: () => this.setState({ err: true }) };`),
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 0, title: 'New project',
    lead: 'Nothing is created until you approve the next step.',
    main: `${field('nl-n', 'Name', '<input id="nl-n" type="text" value="{{name}}" onChange="{{type}}" aria-describedby="nl-n-hint">', 'Becomes the repo name and the folder in ~/Developer.')}
      ${iff('taken', `<span style="color: ${c.fail}; font-size: 12px">AppElent already has a repo with this name. Choose another name.</span>`, 'false')}
      ${iff('blank', `<span style="color: ${c.fail}; font-size: 12px">Enter a name for the project.</span>`, 'false')}
      ${field('nl-d', 'What is it for?', '<textarea id="nl-d" rows="3" defaultValue="Keeps club distances and suggests a club for each shot."></textarea>', 'Agents read this as the project brief.')}
      <fieldset style="margin: 0; padding: 0; border: 0; display: flex; flex-direction: column"><legend style="font-weight: 500; padding: 0; margin-block-end: 4px">Toolkit template</legend>
        ${tpl.map(([k, t, d]) => choice('radio', 'tpl', t, d, { checked: `tplOn.${k}`, onChange: `tplPick.${k}` })).join('')}
      </fieldset>
      <fieldset style="margin: 0; padding: 0; border: 0; display: flex; flex-direction: column"><legend style="font-weight: 500; padding: 0; margin-block-end: 4px">Repo visibility</legend>
        ${choice('radio', 'vis', 'Private', 'Only you can see it.', { checked: 'priv', onChange: 'pickPriv' })}
        ${choice('radio', 'vis', 'Public', 'Anyone can see the code.', { checked: 'pub', onChange: 'pickPub' })}
      </fieldset>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${iff('ok', pri('Continue', { href: 'NLApprove.dc.html' }))}${iff('notOk', pri('Continue', { on: 'fail' }), 'false')}${btn('Cancel', { href: 'Projects.dc.html' })}</div>`,
  }),
});

const CHANGES = [['repo', 'Create the GitHub repo', 'AppElent/caddie · private'], ['dir', 'Create the local folder', '~/Developer/caddie'], ['tpl', 'Apply the Expo app template', 'From developer-tools, then the first commit on main'], ['t3', 'Add it to T3', 'So agents can open threads and worktrees here']];
board({
  file: 'NLApprove.dc.html', title: 'New project: approve changes',
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 1, title: 'Approve these changes',
    lead: 'These happen outside this app. Nothing has been created yet.',
    main: `<div style="display: flex; flex-direction: column">${CHANGES.map(([, t, d]) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 4px 0; border-block-end: 1px solid ${c.sub}">${g('gi')}<span style="flex: 1 1 240px; font-weight: 500">${t}</span>${m(d, c.muted)}</div>`).join('')}</div>
      ${p('Services come after the first green build, and you confirm each one then.')}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Approve and create', { href: 'NLScaffold.dc.html' })}${btn('Change something', { href: 'NLDescribe.dc.html' })}</div>`,
  }),
});

const prog = (gl, t, time = '', extra = '') => `<div style="display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; border-block-end: 1px solid ${c.sub}"><div style="display: flex; align-items: center; gap: 12px; min-height: 28px">${g(gl)}<span style="flex: 1 1 0">${t}</span>${time ? m(time, c.muted) : ''}</div>${extra}</div>`;
board({
  file: 'NLScaffold.dc.html', title: 'New project: scaffolding',
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 2, title: 'Building caddie',
    lead: 'You can leave this page. It keeps going, and the queue tells you when it needs you.',
    main: `<div role="status" style="display: flex; flex-direction: column">
        ${prog('pass', 'Created AppElent/caddie', '0:04')}${prog('pass', 'Created ~/Developer/caddie', '0:05')}${prog('pass', 'Applied the Expo app template', '0:48')}
        ${prog('run', 'Running the baseline: typecheck, tests, lint', '1:12')}${prog('idle', 'Add it to T3')}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Connect services', { href: 'NLConnect.dc.html' })}${btn('Back to the queue', { href: 'Queue.dc.html' })}</div>
      <p style="margin: 0; color: ${c.muted}; font-size: 12px">Prototype: Connect services turns on when the baseline is green. See the failures: ${lnk('scaffold failed', 'NLFailed.dc.html')}, ${lnk('baseline red', 'NLBaseline.dc.html')}.</p>`,
  }),
});
board({
  file: 'NLFailed.dc.html', title: 'New project: scaffold failed',
  logic: logic({ ask: false }, 'return { ask: s.ask, notAsk: !s.ask, askRm: () => this.setState({ ask: true }), keep: () => this.setState({ ask: false }) };'),
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 2, title: "caddie couldn't be built",
    lead: 'The template step failed. The repo and folder exist, so you can retry from here.',
    main: `<div style="display: flex; flex-direction: column">
        ${prog('pass', 'Created AppElent/caddie', '0:04')}${prog('pass', 'Created ~/Developer/caddie', '0:05')}
        ${prog('fail', 'Applied the Expo app template', '0:31', code('pnpm install failed\nERR_PNPM_FETCH_503 registry.npmjs.org: Service Unavailable'))}
        ${prog('idle', 'Run the baseline')}${prog('idle', 'Add it to T3')}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Retry this step', { href: 'NLScaffold.dc.html' })}${iff('notAsk', danger('Remove what was created', { on: 'askRm' }))}</div>
      ${iff('ask', `<div style="display: flex; flex-direction: column; gap: 8px; padding: 16px; background: ${c.surface}; border: 1px solid ${c.sub}; border-radius: 8px"><strong>Remove caddie?</strong>${p('This deletes the AppElent/caddie repo on GitHub and the ~/Developer/caddie folder. It can\'t be undone.')}<div style="display: flex; flex-wrap: wrap; gap: 8px">${btn('Keep it', { on: 'keep' })}${danger('Remove repo and folder', { href: 'Projects.dc.html' })}</div></div>`, 'false')}`,
  }),
});
board({
  file: 'NLBaseline.dc.html', title: 'New project: baseline red',
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 2, title: 'The baseline is red',
    lead: "The template built, but a check failed. An agent can fix it. The project won't take other work until the baseline is green.",
    main: `<div style="display: flex; flex-direction: column">
        ${prog('pass', 'Created AppElent/caddie', '0:04')}${prog('pass', 'Applied the Expo app template', '0:48')}
        ${prog('fail', 'Baseline: tests', '1:40', code("✕ app/index.test.tsx\n  Cannot find module 'expo-router/testing-library'"))}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Start work order', { href: 'WOPlan.dc.html' })}${btn('Open in T3', { href: '#t3' })}</div>`,
  }),
});

const SVC = [['sentry', 'Sentry', 'Create the project caddie and add its DSN to secrets', 'Errors reach the queue'], ['eas', 'EAS', 'Create the project and link it to the repo', 'Builds and deploys are tracked'], ['infisical', 'Infisical', 'Not installed on this Mac', 'Secrets stay out of the repo']];
board({
  file: 'NLConnect.dc.html', title: 'New project: connect services',
  logic: logic({ st: { infisical: 'skip' } }, `
    const ids = ['sentry', 'eas', 'infisical'];
    const open = {}, busy = {}, done = {}, skip = {}, go = {}, skipIt = {}, undo = {};
    ids.forEach((k) => {
      const v = s.st[k]; open[k] = !v; busy[k] = v === 'busy'; done[k] = v === 'done'; skip[k] = v === 'skip';
      go[k] = () => { this.setState({ st: { ...s.st, [k]: 'busy' } }); setTimeout(() => this.setState((x) => ({ st: { ...x.st, [k]: 'done' } })), 1000); };
      skipIt[k] = () => this.setState({ st: { ...s.st, [k]: 'skip' } });
      undo[k] = () => this.setState({ st: { ...s.st, [k]: undefined } });
    });
    const skipped = ids.filter((k) => s.st[k] === 'skip').length;
    return { open, busy, done, skip, go, skipIt, undo, disabled: true, any: skipped > 0, note: skipped + (skipped === 1 ? ' skipped service stays as a reminder under Later.' : ' skipped services stay as reminders under Later.') };`),
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 3, title: 'Connect services',
    lead: 'The baseline is green. Each of these creates something outside this app, so you confirm or skip each one.',
    main: `<div style="display: flex; flex-direction: column">
        ${SVC.map(([k, n, what, why]) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 60px; padding: 8px 0; border-block-end: 1px solid ${c.sub}">
          <div style="flex: 1 1 280px; min-width: 0"><div style="font-weight: 500">${n}</div>${muted(`${what}. ${why}.`)}</div>
          ${iff(`open.${k}`, `<span style="display: flex; gap: 8px">${btn(`Connect ${n}`, { on: `go.${k}` })}${btn('Skip', { on: `skipIt.${k}` })}</span>`, k === 'infisical' ? 'false' : 'true')}
          ${iff(`busy.${k}`, btn('Connecting…', { disabled: 'disabled' }), 'false')}
          ${iff(`done.${k}`, `<span style="display: flex; align-items: center; gap: 8px">${g('pass')}Connected</span>`, 'false')}
          ${iff(`skip.${k}`, `<span style="display: flex; align-items: center; gap: 8px">${g('idle')}Skipped${btn('Undo', { on: `undo.${k}` })}</span>`, k === 'infisical' ? 'true' : 'false')}
        </div>`).join('')}
      </div>
      ${iff('any', `<p role="status" style="margin: 0; color: ${c.muted}; font-size: 12px">{{note}}</p>`)}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${pri('Finish', { href: 'NLDone.dc.html' })}</div>`,
  }),
});
board({
  file: 'NLDone.dc.html', title: 'New project: running',
  logic: logic({ text: '', err: false }, `return { text: s.text, ready: !!s.text.trim(), notReady: !s.text.trim(), err: s.err,
      type: (e) => this.setState({ text: e.target.value, err: false }), fail: () => this.setState({ err: true }) };`),
  body: setup({
    crumbs: nlCrumbs, steps: NL, current: 4, title: 'caddie is on the floor',
    lead: 'The baseline is green and the project is open. All 4 gates are ready.',
    main: `${field('nl-i', 'What should it build first?', '<textarea id="nl-i" rows="3" value="{{text}}" onChange="{{type}}" placeholder="A screen that lists my clubs with their average distance"></textarea>', 'This becomes the first work order. It goes to Plan and waits for your approval.')}
      ${iff('err', `<span style="color: ${c.fail}; font-size: 12px">Describe the first change, or skip this for now.</span>`, 'false')}
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${iff('ready', pri('Start work order', { href: 'WOPlan.dc.html' }), 'false')}${iff('notReady', pri('Start work order', { on: 'fail' }))}${btn('Skip for now', { href: 'FloorBoard.dc.html' })}</div>
      ${facts([['Repo', lnk('AppElent/caddie', 'https://github.com/AppElent')], ['Folder', '~/Developer/caddie', 1], ['Services', 'Sentry, EAS'], ['Skipped', 'Infisical. Reminder under Later.']])}`,
  }),
});

/* ========== REFERENCES ========== */
refs('RefsWorkOrder.dc.html', 'Work order references', [
  ['/_blob/de9d49836d370c385f112a88d9ca2234', 'Browserbase: agent run with a step timeline and expandable input and output', 'ea823985-9a01-448b-816e-2e97782e435e', 'a run as a list of timed steps that expand to show detail. Informed Activity on the work order.'],
  ['/_blob/dae338b985cb9740fd17bd03cc1efc4b', 'Emergent: deployment steps with the current one highlighted and timed', 'dff53201-0975-445f-b0e1-75aa0353d9ba', 'a short fixed step list with a clear current step. Informed the stage rail and scaffold progress.'],
]);
refs('RefsPR.dc.html', 'PR review references', [
  ['/_blob/042441c192e187efbd63b43a341e9181', 'Graphite: PR page with Merge at the top and state cards in a right rail', '43724524-d851-43d4-8272-721c43f8f032', 'merge state and checks gathered in one rail beside the description. Informed the PR page layout.'],
  ['/_blob/e7ef817a33dab54e579cdaf543c49380', 'GitLab: merge box stating readiness right above the Merge button', 'b789ca62-550f-4b63-981f-35a051c94ad6', 'readiness stated in words next to the action. Informed the state line above Merge.'],
]);
refs('RefsHealth.dc.html', 'Health references', [
  ['/_blob/a5f26ea374ca81f368c43d4ca66e4afd', 'n8n: metric tiles that select the chart, with a breakdown table below', '5c36d73e-cc58-4041-bc47-c6eb9c1b2334', 'the tile is the control for the chart, and a table compares workflows. Informed tiles and By line.'],
  ['/_blob/5e8ab5c9b7b8841f76bfc509aed0c669', 'Graphite: insights with plain-word verdicts under each number', '36b81314-2a58-4164-84f8-6863620cd6b1', 'a number needs a verdict, and an honest message when there is too little data. Informed Health with too little data.'],
]);
refs('RefsCommand.dc.html', 'Command menu references', [
  ['/_blob/7bc905b840e4701963744ccc82b271ec', 'Magnific: grouped command menu with keyboard hints along the bottom', 'e22e26e2-f813-4f1e-beda-43c9ecf26419', 'groups with labels and a hint strip at the bottom. Informed the menu layout.'],
  ['/_blob/488be0a95e0d8ad3380523556dfdee6a', 'Superhuman: every command shows its own shortcut', '85dc5994-9360-428d-9092-7425e070ed7f', 'the menu teaches the shortcuts. Informed the keys on each row.'],
]);
refs('RefsFirstRun.dc.html', 'First run references', [
  ['/_blob/30c94ddaf85cb3e5f877a9a23d5cc94d', 'Graphite: choose repos to sync, with all off and a running count', 'a9947500-6b74-4c78-8455-0d528f3e7764', 'everything off by default, a live count, and Continue held back. Informed Choose projects.'],
  ['/_blob/f80eabcdda17404422dfd044b30f3bcd', 'Greptile: connect steps above a repo table', 'b195a122-32fb-4680-80b1-54ebcbd1f9c2', 'finished steps stay visible beside the current choice. Informed the step rail.'],
]);
refs('RefsNewLine.dc.html', 'New project references', [
  ['/_blob/ea0a4c2e219120438f830a9301844a31', 'GitLab: create from template as one plain form', 'af59f326-9fb9-4250-a6aa-eb87fd93d648', 'template, name, and visibility on one page with hints under fields. Informed Describe.'],
  ['/_blob/26d804e2d3129a487f375b8641bd229c', 'AWS Amplify: numbered step rail with Previous and Next', '53ae168c-f0dc-4365-872a-706e7f8f7e61', 'a persistent rail so you always know how much is left. Informed the setup layout.'],
]);
