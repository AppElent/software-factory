import { readFileSync, writeFileSync } from 'node:fs';
import { written } from './lib.mjs';
import './core1.mjs';
import './core2.mjs';
import { writeNarrow } from './core3.mjs';
import './journeys.mjs';

writeNarrow();

const canvasUrl = new URL('../canvas/project/canvas.json', import.meta.url);
const cv = JSON.parse(readFileSync(canvasUrl, 'utf8'));

const W = 1440; const H = 900; const STEP_X = W + 80; const STEP_Y = H + 400;
const LAYOUT = {
  core: {
    name: 'Core loop',
    rows: [
      ['The queue and every state of it', ['Queue', 'QueueBack', 'QueueEmpty', 'QueueLimit', 'QueueLoading', 'QueueDegraded', 'AppOffline']],
      ['Error detail and new work', ['ErrorNew', 'ErrorRegression', 'ErrorSnoozed', 'NewWorkOrder']],
      ['Work order, from plan to PR', ['WOPlan', 'WORunning', 'WOReady', 'WOQuestion', 'WOFailed', 'WOStopped', 'WORun211', 'RefsWorkOrder']],
      ['PR review', ['PRFix', 'PRPassed', 'PRFailed', 'PRRebase', 'RefsPR']],
      ['The floor and stopping the line', ['FloorBoard', 'FloorLimit', 'FloorReviewHold', 'StopConfirm', 'FloorStopped']],
      ['Empty lists', ['PullRequestsEmpty', 'ErrorsEmpty']],
      ['Health and the command menu', ['Health', 'HealthEarly', 'RefsHealth', 'CmdK', 'CmdKEmpty', 'RefsCommand']],
    ],
  },
  firstrun: { name: 'First run', rows: [['First run: tools, projects, first queue', ['FRTools', 'FRToolsBlocked', 'FRRepos', 'FRReading', 'QueueFirst', 'RefsFirstRun']]] },
  projects: {
    name: 'Projects and bulk',
    rows: [
      ['Project detail and every state of it', ['ProjectDetail', 'ProjectPaused', 'ProjectBlockedRemove', 'ProjectQuiet', 'ProjectRemove', 'ProjectMissing', 'RefsProject']],
      ['Sync several projects', ['Projects', 'ProjectsBulk', 'ProjectsBulkConfirm', 'ProjectsBulkDone', 'RefsBulk']],
      ['Merge several PRs, handle several errors', ['PullRequests', 'PullRequestsBulk', 'PullRequestsBulkConfirm', 'PullRequestsBulkDone', 'ErrorsList', 'ErrorsBulk']],
    ],
  },
  settings: {
    name: 'Settings',
    rows: [
      ['Settings', ['SettingsAgents', 'SettingsApprovals', 'SettingsProjects', 'SettingsTools', 'RefsSettings']],
      ['Notifications', ['SettingsNotifications', 'SettingsNotifyBlocked', 'NotifSamples']],
    ],
  },
  stress: {
    name: 'Long text and phone',
    rows: [
      ['Long names, titles, and paths', ['ProjectLong', 'PRLong', 'FloorLong']],
      ['At phone width', ['QueueNarrow', 'FloorNarrow', 'ProjectNarrow', 'PullRequestsNarrow', 'SettingsNarrow']],
    ],
  },
  newline: { name: 'New project', rows: [['New project: describe to first idea', ['NLDescribe', 'NLApprove', 'NLScaffold', 'NLFailed', 'NLBaseline', 'NLConnect', 'NLDone', 'RefsNewLine']]] },
};

const flows = cv.pages.findIndex((x) => x.id === 'flows');
const known = new Set(cv.pages.map((x) => x.id));
for (const pg of cv.pages) if (LAYOUT[pg.id]) pg.name = LAYOUT[pg.id].name;
const add = Object.entries(LAYOUT).filter(([id]) => !known.has(id)).map(([id, v]) => ({ id, name: v.name }));
cv.pages.splice(flows + 1, 0, ...add);
cv.launch = { view: 'canvas', page: 'projects' };

const placed = new Set();
for (const [pid, v] of Object.entries(LAYOUT)) {
  v.rows.forEach(([heading, names], r) => {
    const y = r * STEP_Y;
    cv.notes[`${pid}Row${r}`] = { x: 0, y: y - 300, text: heading, kind: 'title1', maxW: names.length * STEP_X - 80, page: pid };
    let x = 0;
    names.forEach((n) => {
      const file = `${n}.dc.html`;
      placed.add(file);
      const isRef = n.startsWith('Refs');
      const phone = n.endsWith('Narrow');
      cv.boards[file] = isRef
        ? { x, y, w: W, h: 620, title: 'References', page: pid }
        : { x, y, w: phone ? 390 : W, h: phone ? 844 : H, title: n, page: pid, expand: 'fill', is_interactive: true };
      x += (phone ? 390 : W) + 80;
      if (!cv.order.includes(file)) cv.order.push(file);
    });
  });
}
const missing = written.filter((f) => !placed.has(f));
if (missing.length) throw new Error(`Generated but not placed: ${missing.join(', ')}`);
const stray = [...placed].filter((f) => !written.includes(f));
if (stray.length) throw new Error(`Placed but not generated: ${stray.join(', ')}`);

cv.notes.protoSample = { x: -520, y: 0, w: 440, size: 'm', fill: 'gray', page: 'core', text: "Sample data. Repo names and PR numbers #127, #168, #240, #118 are real. Everything else is invented to show the layout. Start at Queue and press Play." };
cv.designSystems = [{ title: 'Software Factory', namespace: 'softwarefactory', artifact: 'https://claude.ai/artifact/Q7SJkZoNSh1Si9dNUHt4Ae', version: null, copiedAt: '2026-11-05T21:30:00Z' }];
writeFileSync(canvasUrl, `${JSON.stringify(cv, null, 2)}\n`);
writeFileSync(new URL('./manifest.json', import.meta.url), JSON.stringify(written));
console.log(written.length, 'boards');
