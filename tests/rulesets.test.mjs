// rulesets.test.mjs - the ruleset registry, and every ruleset meeting the engine contract.
//
// Semantics: permanently green; exits 1 on any failure.
//
// Checked:
//   - the registry (src/rulesets/index.js): the ids, the names, the default, the
//     lookup and its refusal of an unknown id; every entry's engine exports what
//     the contract requires, its variants and constants are its engine's, its
//     policies and its five bot levels are built against ITS engine;
//   - the bots of each ruleset play a whole game of that ruleset, through
//     getBot(level, rules) and through the worker entry (`rules` in the request);
//   - the set-up page: choosing a ruleset (from the address, and by the
//     selector's click) makes it the page's active ruleset and the game is
//     created with that ruleset's engine; the variants panel lists that
//     ruleset's variants; the address carries `rules=`;
//   - the contract-level suites run against every ruleset other than the
//     default: contract, determinism and purity in full, smoke with a quarter of
//     the random games (TEST_SMOKE_SCALE=0.25). npm test runs them for the
//     default ruleset on their own.
//
// The Continental Rails rule checks inside those suites (Part B of contract,
// the module checks of determinism and purity, the smoke suite's variants,
// builder and counters) are guarded by the ruleset id and run only for
// `continental`; another ruleset gets the contract part plus its own checks
// (smoke runs tests/<id>/smoke-<id>.mjs; the second edition's rule suites are
// in tests/pr2e/).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  RULESETS,
  DEFAULT_RULESET_ID,
  REQUIRED_ENGINE_EXPORTS,
  getRuleset,
  getEngine,
  isRulesetId,
  rulesetIds,
} from '../src/rulesets/index.js';
import { BOT_LEVELS, getBot } from '../src/bots/index.js';
import { handleBotRequest } from '../src/bots/bot-worker.js';
import { makeSuite } from './helpers/play.mjs';

const suite = makeSuite('rulesets');
const here = dirname(fileURLToPath(import.meta.url));
const started = performance.now();

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

suite.check('the registry holds Continental Rails (the default) and Pacific Rails, second edition', () => {
  assert.deepEqual(rulesetIds(), ['continental', 'pr2e']);
  assert.equal(DEFAULT_RULESET_ID, 'continental');
  assert.equal(getRuleset('continental').name, 'Continental Rails');
  assert.equal(getRuleset('pr2e').name, 'Pacific Rails, second edition');
  assert.equal(getRuleset().id, 'continental', 'no id means the default');
  assert.equal(getRuleset(null).id, 'continental');
  assert.equal(getRuleset(getRuleset('pr2e')), getRuleset('pr2e'), 'an entry is returned as it is');
  assert.throws(() => getRuleset('pr3e'), /Unknown rules "pr3e". The rules are: continental, pr2e/);
  assert.equal(isRulesetId('pr2e'), true);
  assert.equal(isRulesetId('PR2E'), false);
  assert.equal(getEngine('pr2e'), getRuleset('pr2e').engine);
});

suite.check('each ruleset has its own engine, meeting the required exports, with its variants and constants', () => {
  const engines = new Set();
  for (const r of RULESETS) {
    for (const key of REQUIRED_ENGINE_EXPORTS) assert.notEqual(r.engine[key], undefined, `${r.id}: ${key}`);
    assert.equal(r.variants, r.engine.VARIANTS);
    assert.equal(r.constants, r.engine.RULES);
    assert.match(r.engineDir, /^src\/engine/);
    assert.ok(r.description.length > 20);
    assert.equal(typeof r.ui.views, 'object');
    engines.add(r.engine);
  }
  assert.equal(engines.size, RULESETS.length, 'no two rulesets share an engine');
  // Separate engines share no module state: the pr2e engine's tables are other objects.
  assert.notEqual(getEngine('pr2e').RULES, getEngine('continental').RULES);
  assert.notEqual(getEngine('pr2e').MAP, getEngine('continental').MAP);
  assert.notEqual(getEngine('pr2e').createGame, getEngine('continental').createGame);
});

suite.check('policies, search and bots are built per ruleset, once, against that ruleset\'s engine', () => {
  const c = getRuleset('continental');
  const p = getRuleset('pr2e');
  assert.equal(c.policies, c.policies, 'built once and kept');
  assert.notEqual(c.policies, p.policies);
  assert.notEqual(c.search, p.search);
  for (const r of RULESETS) {
    for (const level of BOT_LEVELS) {
      assert.equal(typeof r.getBot(level.id).chooseAction, 'function', `${r.id} ${level.id}`);
      assert.equal(getBot(level.id, r.id), r.getBot(level.id));
    }
    assert.equal(r.getBot('medium'), r.policies.heuristicBot);
    assert.equal(r.getBot('easy'), r.policies.easyBot);
    assert.equal(r.getBot('hard'), r.search.hardBot);
    assert.throws(() => r.getBot('grandmaster'), /Unknown bot level/);
  }
  assert.equal(getBot('medium'), c.getBot('medium'), 'getBot without rules is the default ruleset');
  assert.throws(() => getBot('medium', 'nope'), /Unknown rules "nope"/);
});

suite.check('a ruleset\'s bots play a whole game of that ruleset, refused nothing', () => {
  for (const r of RULESETS) {
    const E = r.engine;
    const state = E.createGame({ playerCount: 3, seed: `rulesets-${r.id}` });
    const bots = [r.getBot('medium'), r.getBot('easy'), r.getBot('random')];
    const rng = E.makeRng(`rulesets-bots-${r.id}`);
    let decisions = 0;
    while (!E.isGameOver(state)) {
      assert.ok(decisions < 20000, `${r.id}: decision cap`);
      const action = bots[state.toAct].chooseAction(state, { rng: E.forkRng(rng), timeBudgetMs: 0, iterations: null, now: null });
      assert.equal(E.getBlockReason(state, action), null, `${r.id}: a bot proposed an illegal action`);
      E.applyAction(state, action, E.SILENT);
      decisions += 1;
    }
    assert.ok(E.scoreGame(state).players.every((pl) => Number.isFinite(pl.total)));
  }
});

suite.check('the search levels play a ruleset\'s position with that ruleset\'s policies', () => {
  for (const r of RULESETS) {
    const E = r.engine;
    const state = E.createGame({ playerCount: 2, seed: `search-${r.id}` });
    const result = r.search.search(state, { rng: E.makeRng('s'), iterations: 40, mcts: { minIterations: 2, maxPlayoutTurns: 4 } });
    assert.equal(E.getBlockReason(state, result.action), null, r.id);
  }
});

suite.check('the worker entry plays the ruleset named in the request, and refuses an unknown one', () => {
  for (const r of RULESETS) {
    const state = JSON.parse(JSON.stringify(r.engine.createGame({ playerCount: 2, seed: `worker-${r.id}` })));
    for (const level of ['random', 'easy', 'medium']) {
      const reply = handleBotRequest({ id: level, state, level, seed: 3, rules: r.id });
      assert.equal(reply.ok, true, `${r.id} ${level}: ${reply.error}`);
      assert.equal(r.engine.getBlockReason(state, reply.action), null);
    }
  }
  const state = JSON.parse(JSON.stringify(getEngine().createGame({ playerCount: 2, seed: 'worker-none' })));
  assert.equal(handleBotRequest({ state, level: 'random', seed: 1 }).ok, true, 'no rules in the request means the default');
  const bad = handleBotRequest({ id: 'x', state, level: 'random', seed: 1, rules: 'pr3e' });
  assert.deepEqual([bad.ok, /Unknown rules "pr3e"/.test(bad.error)], [false, true]);
});

// ---------------------------------------------------------------------------
// The set-up page: the chosen ruleset creates a game with that engine
// ---------------------------------------------------------------------------

const setup = await import('../src/ui/setup.js');
const active = await import('../src/ui/active-ruleset.js');
const panel = await import('../src/ui/variants-panel.js');

/** A stand-in for the set-up screen's root and a clicked element, enough for handleSetupEvent. */
function click(setupValue) {
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const el = { dataset: { setup: setupValue }, disabled: false };
  const target = { closest: (sel) => (sel === '[data-setup]' ? el : null) };
  return { root, result: setup.handleSetupEvent(root, target, 'click') };
}

suite.check('set-up page: ?rules=pr2e makes the second edition active, and the game is created with its engine', () => {
  const extras = setup.applyQuery('?rules=pr2e&bots=random,medium&seed=9');
  assert.equal(extras.error, null);
  assert.equal(setup.getForm().rules, 'pr2e');
  assert.equal(active.activeRulesetId(), 'pr2e');
  const { config, rules } = setup.buildGame();
  assert.equal(rules, 'pr2e');
  active.useRuleset(rules); // what main.js startGame does
  const state = active.createGame(config);
  assert.equal(active.createGame, getEngine('pr2e').createGame, 'the page creates games with the pr2e engine');
  assert.equal(active.getValidActions, getEngine('pr2e').getValidActions);
  assert.equal(getEngine('pr2e').getBlockReason(state, active.getValidActions(state)[0]), null);
  assert.equal(setup.buildDemoGame().rules, 'pr2e', 'the demo game uses the chosen rules too');
});

suite.check('set-up page: the selector switches the rules both ways, and the variants panel follows', () => {
  const { root } = click('rules:continental');
  assert.equal(setup.getForm().rules, 'continental');
  assert.equal(active.activeRulesetId(), 'continental');
  assert.equal(active.createGame, getEngine('continental').createGame);
  assert.match(root.innerHTML, /data-setup="rules:pr2e"/, 'the selector is drawn');
  assert.match(root.innerHTML, /data-rules="continental" aria-pressed="true"/);
  assert.ok(root.innerHTML.indexOf('data-field="rules-chooser"') < root.innerHTML.indexOf('class="seats"'), 'the selector comes before the seats');
  assert.ok(root.innerHTML.indexOf('data-field="rules-chooser"') < root.innerHTML.indexOf('setup__count'), 'and before the player count');
  assert.equal(root.innerHTML.match(/class="vrow\b/g) === null, true, 'the variant rows are folded until asked for');
  const after = click('rules:pr2e');
  assert.equal(setup.getForm().rules, 'pr2e');
  assert.equal(active.activeRulesetId(), 'pr2e');
  assert.match(after.root.innerHTML, /data-rules="pr2e" aria-pressed="true"/);
  assert.equal(active.VARIANTS, getEngine('pr2e').VARIANTS, 'the variants panel reads the pr2e variants table');
  assert.equal(panel.variantGroups().flatMap((g) => g.defs).length, getEngine('pr2e').VARIANTS.length);
  const { config } = setup.buildGame();
  const state = active.createGame(config);
  assert.equal(state.players.length, 2);
  click('rules:continental');
});

suite.check('set-up page: an unknown ?rules= is refused with a message and the default stays', () => {
  click('rules:continental');
  const extras = setup.applyQuery('?rules=pr3e');
  assert.match(extras.error, /Unknown rules "pr3e"/);
  assert.equal(setup.getForm().rules, 'continental');
  assert.equal(active.activeRulesetId(), 'continental');
});

suite.check('set-up page: switching rules keeps the variant overrides the new rules also have', () => {
  click('rules:continental');
  setup.applyQuery('?variants=conversionRate=1:1,maxTurnsPerPlayer=30');
  assert.deepEqual(setup.getForm().variants, { conversionRate: '1:1', maxTurnsPerPlayer: 30 });
  click('rules:pr2e');
  // The second edition has its own variants: the turn limit is shared, the conversion rate is not (P21.1).
  assert.deepEqual(setup.getForm().variants, { maxTurnsPerPlayer: 30 }, 'only the override both rulesets have is kept');
  click('rules:continental');
  setup.getForm().variants = {};
});

// ---------------------------------------------------------------------------
// Bug reports carry the ruleset, and the replay tool rebuilds with its engine
// ---------------------------------------------------------------------------

const capture = await import('../src/ui/bug-report-capture.js');
const replayTool = await import('../tools/replay-bug-report.mjs');

suite.check('a bug report of a pr2e game names its rules, and the replay tool rebuilds it with the pr2e engine', () => {
  active.useRuleset('pr2e'); // what main.js does when a pr2e game begins
  const E = getEngine('pr2e');
  const state = E.createGame({ playerCount: 2, seed: 'bug-pr2e' });
  const rng = E.makeRng('bug-pr2e-bots');
  const actions = [];
  for (let i = 0; i < 60 && !E.isGameOver(state); i++) {
    const action = E.rngPick(rng, E.getValidActions(state));
    actions.push(action);
    E.applyAction(state, action, E.SILENT);
  }
  const report = capture.buildReport({ rules: 'pr2e', state, seats: [{ human: true, name: 'A' }, { human: false, level: 'random', name: 'B' }], replay: { actions, base: null }, screen: 'game', words: {} });
  assert.deepEqual(report.rules, { id: 'pr2e', name: 'Pacific Rails, second edition' });
  assert.equal(report.replayCheck.ok, true, 'the capture replays the pr2e game to the same hash');
  active.useRuleset('continental'); // the tool must not depend on what the page had active
  const loaded = replayTool.loadReport(JSON.stringify(report));
  assert.equal(replayTool.rulesOf(loaded), 'pr2e');
  const out = replayTool.describeReport(loaded);
  assert.equal(out.exitCode, 0, out.lines.join('\n'));
  assert.ok(out.lines.includes('Rules: Pacific Rails, second edition (pr2e)'));
  const unknown = { ...report, rules: { id: 'pr3e', name: 'x' } };
  assert.throws(() => replayTool.loadReport(JSON.stringify(unknown)), /names rules "pr3e"/);
  const old = { ...report };
  delete old.rules;
  assert.equal(replayTool.rulesOf(old), 'continental', 'a report made before rulesets existed is Continental Rails');
  replayTool.useRules('continental');
});

// ---------------------------------------------------------------------------
// The contract-level suites against every other ruleset
// ---------------------------------------------------------------------------

const SUITES = ['contract', 'determinism', 'purity', 'smoke'];
const runs = [];
for (const r of RULESETS) {
  if (r.id === DEFAULT_RULESET_ID) continue; // npm test runs them for the default
  for (const name of SUITES) {
    const t0 = performance.now();
    const env = { ...process.env, TEST_RULES: r.id };
    if (name === 'smoke') env.TEST_SMOKE_SCALE = '0.25';
    const out = spawnSync(process.execPath, [join(here, `${name}.test.mjs`)], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const summary = (out.stdout || '').split('\n').filter((l) => l.startsWith(name)).pop() ?? '';
    runs.push(`${name}[${r.id}] ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    suite.check(`${name}.test.mjs passes against ${r.name} (${r.id})`, () => {
      assert.equal(out.status, 0, `exit ${out.status}\n${(out.stdout || '').split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 12).join('\n')}\n${(out.stderr || '').slice(0, 2000)}`);
      assert.match(summary, new RegExp(`\\[rules: ${r.id}\\]`), 'the suite ran against that ruleset');
    });
  }
}

suite.finish(`${runs.join(', ')}; ${((performance.now() - started) / 1000).toFixed(1)} s`);
