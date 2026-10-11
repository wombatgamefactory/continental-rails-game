// bug-report.test.mjs - the bug reporter's pure parts, headless, and the replay tool.
//
// The capture module has no DOM access, so the same code that runs in the page
// runs here on a mid-game state. Checked:
//   - a capture changes nothing (hashState of the live game before and after);
//   - the report is plain JSON (a round trip changes nothing), holds the complete
//     state, and its replay record (config + the actions applied) rebuilds the
//     SAME hashState, by both routes (deserialise, and replay);
//   - the diagnostics: the reporter, the legal list, a block reason for an
//     illegal action, null for a legal one, and the two lists agree;
//   - one section forced to fail leaves the rest of the report intact;
//   - the caps hold for everything except gameState and replay;
//   - the ring buffers, the id, the file name and the local-archive eviction;
//   - tools/replay-bug-report.mjs refuses a truncated, wrong-schema or damaged
//     file cleanly, and flags a hash mismatch.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getValidActions,
  applyAction,
  SILENT,
  hashState,
  cloneState,
  replayGame,
  actionKey,
  getBlockReason,
} from '../src/engine/index.js';
import { playGame, makeSuite } from './helpers/play.mjs';
import { makeTempDir, removeTempDir, removeFile } from './helpers/tmp.mjs';
import {
  buildReport,
  capValue,
  CAPS,
  CATEGORIES,
  REPORT_SCHEMA_VERSION,
  makeReportId,
  slugOf,
  reportFileName,
  logEvent,
  logAction,
  resetLogs,
  getLogs,
  LOG_SIZES,
  addToArchive,
  pickReporter,
} from '../src/ui/bug-report-capture.js';
import {
  loadReport,
  DamagedReport,
  rebuildBothWays,
  recomputeReasons,
  compareWithStored,
  controlFindings,
  describeReport,
} from '../tools/replay-bug-report.mjs';

const suite = makeSuite('bug-report');
const here = path.dirname(fileURLToPath(import.meta.url));
// A folder of this process's own under the operating system's temp folder (see helpers/tmp.mjs).
const tmpDir = makeTempDir('cr-bug-report-test');
const tmpFile = (name) => path.join(tmpDir, name);
const toolPath = path.join(here, '..', 'tools', 'replay-bug-report.mjs');

const CONFIG3 = { players: [{ name: 'Anna', colour: '#c0392b' }, { name: 'Ben', colour: '#e07b00' }, { name: 'Cleo', colour: '#7d4fb8' }], seed: 'bugreport-1' };
const allHuman = (n) => Array.from({ length: n }, () => ({ human: true, level: null, label: 'Human' }));

/** A mid-game state with the actions that led to it. */
function midGame(stopAfter = 90, config = CONFIG3) {
  const played = playGame(config, { stopAfter, botSeed: 'b' });
  return { state: played.state, actions: played.actions };
}

function capture(state, actions, extra = {}, options = {}) {
  return buildReport(
    {
      state,
      seats: allHuman(state.players.length),
      replay: { actions, base: null },
      lastHumanActor: null,
      screen: 'game',
      words: { title: 'Cannot claim Denver - Kansas City', category: CATEGORIES[0], expected: 'to claim it', actual: 'a refusal' },
      environment: { url: 'http://localhost/?test=1', viewport: { width: 1440, height: 900 } },
      ...extra,
    },
    options
  );
}

// ---------------------------------------------------------------------------

suite.check('a capture changes nothing: hashState of the live game is the same before and after', () => {
  const { state, actions } = midGame();
  const before = hashState(state);
  const json = JSON.stringify(state);
  capture(state, actions);
  capture(state, actions, {}, { failSections: ['diagnostics'] });
  assert.equal(hashState(state), before);
  assert.equal(JSON.stringify(state), json, 'the live state is byte-for-byte unchanged');
});

suite.check('the report is plain JSON and holds the complete state', () => {
  const { state, actions } = midGame();
  const report = capture(state, actions);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.match(report.id, /^crbug-\d{8}-\d{6}-[a-z0-9]{4}$/);
  assert.deepEqual(report.gameState, JSON.parse(JSON.stringify(state)), 'gameState is the complete state');
  assert.equal(report.stateHash, hashState(state));
  assert.equal(report.words.category, CATEGORIES[0], 'the category is the verbatim label');
  assert.deepEqual(report.capture.sectionsWithErrors, [], 'no section failed');
  for (const key of ['schemaVersion', 'id', 'timestamp', 'build', 'environment', 'screen', 'words', 'table', 'gameState', 'stateHash', 'replay', 'diagnostics', 'actionLog', 'eventLog']) {
    assert.ok(key in report, `report has ${key}`);
  }
});

suite.check('the replay record rebuilds the same hash, by both routes', () => {
  const { state, actions } = midGame(120);
  assert.ok(actions.length > 20);
  assert.ok(state.seq > actions.length, 'forced actions were applied that are not in the list');
  const report = capture(state, actions);
  assert.equal(report.replay.actionCount, actions.length);
  assert.equal(report.replayCheck.ok, true, 'the capture itself checked the replay');
  const loaded = loadReport(JSON.stringify(report));
  const built = rebuildBothWays(loaded);
  assert.equal(built.ok, true, built.problems.join('; '));
  assert.equal(built.hashDeserialised, hashState(state));
  assert.equal(built.hashReplayed, hashState(state));
  assert.equal(hashState(replayGame(report.replay.config, report.replay.actions)), hashState(state));
});

suite.check('a long game: the state and the action list are never capped', () => {
  const played = playGame({ ...CONFIG3, seed: 'bugreport-long' }, { botSeed: 'b' });
  assert.ok(played.actions.length > CAPS.array, `the game needs more actions than the array cap (${played.actions.length})`);
  const report = capture(played.state, played.actions);
  assert.equal(report.replay.actions.length, played.actions.length, 'every action is in the replay record');
  assert.equal(report.replayCheck.ok, true);
  assert.deepEqual(report.gameState, JSON.parse(JSON.stringify(played.state)));
  assert.equal(report.diagnostics.actionSpace.skipped !== undefined, true, 'a finished game has no open action');
  assert.equal(rebuildBothWays(loadReport(JSON.stringify(report))).ok, true);
});

suite.check('a game that began from a loaded state replays from its base', () => {
  const first = midGame(40);
  const base = JSON.stringify(first.state);
  const state = JSON.parse(base);
  const applied = [];
  for (let i = 0; i < 12; i++) {
    const a = getValidActions(state)[0];
    applyAction(state, a, SILENT);
    applied.push(a);
  }
  const report = capture(state, applied, { replay: { actions: applied, base } });
  assert.equal(report.replay.origin, 'loaded-state');
  assert.equal(report.replayCheck.ok, true);
  assert.equal(rebuildBothWays(loadReport(JSON.stringify(report))).ok, true);
});

suite.check('diagnostics: the reporter, the legal list, a reason for an illegal action, null for a legal one', () => {
  const { state } = midGame(60);
  const actions = playGame(CONFIG3, { stopAfter: 60, botSeed: 'b' }).actions;
  const report = capture(state, actions);
  const d = report.diagnostics;
  assert.equal(d.reporter.player, state.toAct);
  assert.match(d.reporter.why, /must act now/);
  assert.equal(d.decision.player, state.toAct);
  const legal = getValidActions(state);
  assert.equal(d.legal.count, legal.length);
  assert.deepEqual(d.legal.actions.map((a) => a.key), legal.map(actionKey));
  assert.ok(d.legal.actions.every((a) => typeof a.text === 'string' && a.text.length > 0), 'every legal action is described');
  // an illegal action has a reason; a legal one has null (listed as legal)
  let blockedExample = null;
  for (const slot of Object.values(d.actionSpace.byType)) {
    for (const g of slot.blocked) if (blockedExample === null && g.actions.length > 0) blockedExample = { group: g, action: g.actions[0] };
  }
  assert.ok(blockedExample, 'some action is blocked');
  assert.equal(typeof blockedExample.group.now, 'string');
  assert.ok(blockedExample.group.now.length > 5);
  assert.equal(getBlockReason(state, { ...legal[0], player: state.toAct }), null);
  const legalKeys = Object.values(d.actionSpace.byType).flatMap((s) => s.legal.map((a) => a.key));
  assert.deepEqual([...legalKeys].sort(), legal.map(actionKey).sort(), 'the actions with a null reason are exactly the valid actions');
  assert.equal(d.actionSpace.agreement.ok, true, JSON.stringify(d.actionSpace.agreement));
  // the numbers a rules question turns on
  const p = d.players[state.toAct];
  for (const key of ['coins', 'hats', 'resources', 'builtTiles', 'storage', 'workers', 'productionPerTrack', 'railheads', 'routesOwned', 'buildings', 'vp']) assert.ok(key in p, `player numbers include ${key}`);
  assert.equal(typeof p.storage.capacity, 'number');
  assert.ok(Array.isArray(d.stack.frames) && d.stack.frames.length >= 1);
  assert.ok(d.score.players.length === 3);
  assert.ok(d.progress.milestones, 'milestone progress is there (module on by default)');
  assert.ok(typeof d.progress.milestones[0].progress[0].text === 'string');
});

suite.check('diagnostics: when a bot is to act the report is about the human who acted last', () => {
  const { state, actions } = midGame(61);
  const seats = state.players.map((p) => (p.id === 0 ? { human: true, level: null } : { human: false, level: 'medium' }));
  assert.notEqual(state.toAct, 0, 'a bot must be to act for this test (seed-dependent: adjust stopAfter)');
  const report = buildReport({ state, seats, replay: { actions, base: null }, lastHumanActor: 0, screen: 'game', words: {} });
  assert.equal(report.diagnostics.reporter.player, 0);
  assert.match(report.diagnostics.reporter.why, /acted last/);
  assert.equal(report.diagnostics.actionSpace.askedFor, 0);
  assert.equal(pickReporter(state, seats, null).player, 0, 'with no human having acted, the first human seat');
});

suite.check('the stored reasons agree with the current engine; a tampered one is a difference', () => {
  const { state, actions } = midGame(60);
  const report = capture(state, actions);
  const re = recomputeReasons(cloneState(state), report.diagnostics.reporter.player);
  const cmp = compareWithStored(report, re);
  assert.ok(cmp.checked > 20, `compared ${cmp.checked} actions`);
  assert.deepEqual(cmp.differences, []);
  const bad = JSON.parse(JSON.stringify(report));
  const firstType = Object.values(bad.diagnostics.actionSpace.byType).find((s) => s.blocked.length > 0);
  firstType.blocked[0].now = 'a reason the engine never gave';
  assert.ok(compareWithStored(bad, re).differences.length > 0);
});

suite.check('control findings: a disabled-looking control next to a null block reason is flagged', () => {
  const { state, actions } = midGame(60);
  const legal = getValidActions(state);
  const report = capture(state, actions, {
    controls: { items: [{ kind: 'action-button', key: actionKey(legal[0]), label: 'Do it', enabled: false }, { kind: 'action-button', key: 'skipBonusAction', label: 'Skip', enabled: true }] },
  });
  const findings = controlFindings(report, recomputeReasons(cloneState(state), state.toAct));
  assert.ok(findings.some((f) => /disabled/.test(f) && /UI bug/.test(f)), findings.join('\n'));
});

suite.check('a section forced to fail is marked { error } and the report still completes', () => {
  const { state, actions } = midGame(60);
  for (const name of ['diagnostics', 'table', 'replay', 'environment', 'gameState']) {
    const report = capture(state, actions, {}, { failSections: [name] });
    assert.equal(typeof report.id, 'string', `report completes with ${name} broken`);
    assert.equal(typeof report.capture.sectionsWithErrors[0], 'string');
    assert.ok(report.capture.sectionsWithErrors.includes(name));
    assert.ok(report[name] && typeof report[name].error === 'string' && /forced failure/.test(report[name].error), `${name} is { error }`);
    assert.ok(report.words.title, 'the player\'s words survive');
    if (name !== 'gameState') assert.deepEqual(report.gameState, JSON.parse(JSON.stringify(state)), 'the rest of the report is intact');
  }
  // inside diagnostics too: an engine failure in one part is contained in that part
  const report = buildReport({ state: { ...JSON.parse(JSON.stringify(state)), players: null }, seats: [], replay: { actions: [], base: null } });
  assert.equal(typeof report.id, 'string', 'even a broken state yields a report');
});

suite.check('no state at all (the setup screen) still gives a report', () => {
  const report = buildReport({ state: null, seats: [], screen: 'setup', setupForm: { playerCount: 2 }, words: { title: 'x' } });
  assert.equal(report.gameState, null);
  assert.equal(report.diagnostics, null);
  assert.equal(report.screen, 'setup');
  assert.equal(loadReport(JSON.stringify(report)).id, report.id);
  const text = describeReport(loadReport(JSON.stringify(report))).lines.join('\n');
  assert.match(text, /setup screen/);
});

suite.check('the caps hold for everything except gameState and replay', () => {
  const { state, actions } = midGame(60);
  const circular = { name: 'loop' };
  circular.self = circular;
  let deep = { end: true };
  for (let i = 0; i < 30; i++) deep = { deeper: deep };
  const fat = {
    huge: 'x'.repeat(100000),
    many: Array.from({ length: 5000 }, (_, i) => i),
    deep,
    circular,
    fn: () => 1,
    nan: NaN,
    inf: Infinity,
    undef: undefined,
    big: 10n,
    err: new Error('boom'),
  };
  const report = capture(state, actions, { ui: fat, environment: fat });
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report, 'stringify-safe');
  assert.ok(report.ui.huge.length < CAPS.string + 100, 'long string capped');
  assert.equal(report.ui.many.length, CAPS.array + 1, 'long array capped (plus its marker)');
  assert.ok(JSON.stringify(report.ui.deep).includes('depth cap'), 'deep nesting capped');
  assert.equal(report.ui.circular.self, '[circular]');
  assert.equal(report.ui.fn, '[function]');
  assert.equal(report.ui.nan, 'NaN');
  assert.equal(report.ui.big, '10');
  assert.equal(report.ui.err.error, 'boom');
  assert.equal(capValue({ a: [1, 2, 3] }, { depth: 1, array: 5, string: 5 }).a, '[array of 3, past the depth cap]');
  // ...but the replay actions and the state are complete
  assert.deepEqual(report.gameState, JSON.parse(JSON.stringify(state)));
  assert.equal(report.replay.actions.length, actions.length);
});

suite.check('the ring buffers keep the last 80 actions and the last 120 events; a logger never throws', () => {
  resetLogs();
  for (let i = 0; i < 200; i++) logEvent('refusal', `refusal number ${i}`);
  for (let i = 0; i < 100; i++) logAction({ seq: i, player: 0, text: `action ${i}`, how: 'human' });
  const circular = {};
  circular.me = circular;
  logEvent('error', 'circular data', circular);
  logEvent('error', undefined, 10n);
  logAction(circular);
  logAction(undefined);
  const logs = getLogs();
  assert.equal(logs.eventLog.length, LOG_SIZES.events);
  assert.equal(logs.actionLog.length, LOG_SIZES.actions);
  assert.match(logs.eventLog[0].text, /refusal number/);
  const { state, actions } = midGame(30);
  const report = capture(state, actions);
  assert.equal(report.eventLog.length, LOG_SIZES.events);
  assert.equal(report.actionLog.length, LOG_SIZES.actions);
  resetLogs();
});

suite.check('the id, the slug and the file name', () => {
  const fixed = new Date(2026, 9, 11, 14, 30, 15);
  const id = makeReportId(fixed, (bytes) => bytes.fill(0));
  assert.equal(id, 'crbug-20261011-143015-aaaa');
  assert.match(makeReportId(), /^crbug-\d{8}-\d{6}-[a-z0-9]{4}$/);
  assert.notEqual(makeReportId(fixed), makeReportId(fixed), 'a random suffix: two ids in the same second differ (1 in 1.7 million to collide)');
  assert.equal(slugOf('Cannot claim Denver - Kansas City!'), 'cannot-claim-denver-kansas-city');
  assert.equal(slugOf(''), 'report');
  assert.equal(slugOf('???'), 'report');
  assert.equal(reportFileName(id, 'Bots stuck'), 'continental-rails-bug-crbug-20261011-143015-aaaa-bots-stuck.json');
  assert.ok(!/\s/.test(reportFileName(id, 'a title with spaces')), 'no spaces in the file name');
});

suite.check('the local archive evicts the oldest beyond 20 reports or 4 MB, keeps the newest', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = addToArchive(list, { id: `r${i}`, text: 'x'.repeat(10) });
  assert.equal(list.length, 20);
  assert.equal(list[0].id, 'r5');
  assert.equal(list[19].id, 'r24');
  let big = [];
  for (let i = 0; i < 6; i++) big = addToArchive(big, { id: `b${i}`, text: 'y'.repeat(1000000) });
  assert.ok(big.length <= 4 && big.length >= 3, `bytes cap: ${big.length} kept`);
  assert.equal(big[big.length - 1].id, 'b5');
  const huge = addToArchive([{ id: 'old', text: 'z' }], { id: 'huge', text: 'h'.repeat(5000000) });
  assert.deepEqual(huge.map((e) => e.id), ['huge'], 'the newest is always kept');
  assert.equal(addToArchive([{ id: 'same', text: 'a' }], { id: 'same', text: 'b' }).length, 1, 'the same id replaces');
});

suite.check('the replay tool refuses a truncated, wrong-schema or damaged file cleanly', () => {
  const { state, actions } = midGame(50);
  const text = JSON.stringify(capture(state, actions));
  assert.throws(() => loadReport(text.slice(0, Math.floor(text.length / 2))), DamagedReport);
  assert.throws(() => loadReport(''), DamagedReport);
  assert.throws(() => loadReport('[1,2]'), DamagedReport);
  assert.throws(() => loadReport(JSON.stringify({ ...JSON.parse(text), schemaVersion: 99 })), /schema version 99/);
  const noState = JSON.parse(text);
  delete noState.gameState;
  assert.throws(() => loadReport(JSON.stringify(noState)), /gameState/);
  const brokenState = JSON.parse(text);
  brokenState.gameState = { error: 'boom' };
  assert.throws(() => loadReport(JSON.stringify(brokenState)), /boom/);
  const noReplay = JSON.parse(text);
  noReplay.replay = { error: 'forced' };
  assert.throws(() => loadReport(JSON.stringify(noReplay)), /replay record/);
  const wrongEngine = JSON.parse(text);
  wrongEngine.gameState.schemaVersion = 99;
  const built = rebuildBothWays(loadReport(JSON.stringify(wrongEngine)));
  assert.equal(built.ok, false);
  assert.match(built.problems.join(' '), /Could not load the stored state/);
});

suite.check('the replay tool, run as a command: exit codes, output, a mismatch and --action', () => {
  const { state, actions } = midGame(70);
  const report = capture(state, actions);
  const good = tmpFile('good.json');
  const trunc = tmpFile('trunc.json');
  const tampered = tmpFile('tampered.json');
  try {
    const text = JSON.stringify(report);
    fs.writeFileSync(good, text);
    fs.writeFileSync(trunc, text.slice(0, 500));
    const t = JSON.parse(text);
    t.replay.actions = t.replay.actions.slice(0, -3);
    t.replay.actionCount = t.replay.actions.length;
    fs.writeFileSync(tampered, JSON.stringify(t));

    const run = (...args) => spawnSync(process.execPath, [toolPath, ...args], { encoding: 'utf8' });
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    for (const needle of ['Report crbug-', 'The reporter', 'Cannot claim Denver', 'Decision pending', 'Legal actions now', 'Block reasons recomputed', 'agree']) {
      assert.ok(ok.stdout.includes(needle), `output mentions "${needle}"`);
    }
    const legal = getValidActions(state);
    const asked = run(good, `--action=${JSON.stringify(legal[0])}`);
    assert.equal(asked.status, 0);
    assert.match(asked.stdout, /block reason now:\s+null \(it is legal\)/);
    const refused = run(good, '--action={"type":"placeWorker","space":"NOPE"}');
    assert.equal(refused.status, 0);
    assert.match(refused.stdout, /block reason now:\s+(?!null)/);

    const bad = run(trunc);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /not valid JSON/);
    assert.equal(run(path.join(tmpDir, 'no-such-report.json')).status, 2);
    assert.equal(run().status, 2);

    const mismatch = run(tampered);
    assert.equal(mismatch.status, 3, 'a replay that does not reproduce the hash is exit 3');
    assert.match(mismatch.stdout, /MISMATCH/);
  } finally {
    for (const f of [good, trunc, tampered]) removeFile(f);
  }
});

suite.check('the source files hold no email address and no analytics id', () => {
  const dir = path.join(here, '..', 'src', 'ui');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text), `${f} contains an email address`);
    assert.ok(!/\bG-[A-Z0-9]{8,}\b/.test(text), `${f} contains an analytics id`);
  }
  const config = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.match(config, /BUG_REPORT_EMAIL: ''/);
  assert.match(config, /GA4_MEASUREMENT_ID: ''/);
});

removeTempDir(tmpDir); // best effort: a locked folder is left for the operating system
suite.finish();
