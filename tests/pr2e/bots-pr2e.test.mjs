// bots-pr2e.test.mjs - Pacific Rails, second edition: the five bot levels.
//
// What is asserted:
//   - every proposal of Medium and Easy is one of getValidActions and is never
//     refused, over whole games at 2, 3 and 4 players and under non-default
//     variants, and the bot never changes the state it is given;
//   - every level (Random, Easy, Medium, Hard, Expert) plays a whole game to its end;
//   - the same seeds give the same game (the heuristic levels and the search levels
//     at a fixed iteration allowance);
//   - the scores handed to the search are aligned with the legal actions;
//   - Easy beats Random and Medium beats Easy over a small sample (loose thresholds;
//     the full measurement is `node sim/sim.mjs --rules=pr2e ...`, see docs/bots.md);
//   - Medium tables end by the transcontinental line, not by the turn limit;
//   - an unknown weight name is an error, not a silently neutral bot.
//
// Semantics: permanently green; exits 1 on any failure.

import assert from 'node:assert/strict';
import { getRuleset } from '../../src/rulesets/index.js';
import { PR2E_WEIGHTS, resolvePr2eWeights } from '../../src/bots/pr2e/heuristicBot-pr2e.js';
import { makeSuite } from '../helpers/play.mjs';

const suite = makeSuite('pr2e bots');
const ruleset = getRuleset('pr2e');
const E = ruleset.engine;
const { createGame, getValidActions, applyAction, isGameOver, scoreGame, hashState, actionKey, makeRng, forkRng, SILENT } = E;
const policies = ruleset.policies;
const DECISION_CAP = 20000;

/**
 * Plays one game. `bots` is one bot per CONFIG seat. Checks every proposal against the valid list and, if asked,
 * that the state is not changed by choosing.
 */
function play(config, bots, options = {}) {
  const state = createGame(config);
  const rng = makeRng(options.botSeed ?? `pr2e-bots:${config.seed}`);
  const out = { state, decisions: 0, refusals: [], illegal: [], mutated: 0, keys: [], capHit: false };
  while (!isGameOver(state)) {
    if (out.decisions >= DECISION_CAP) {
      out.capHit = true;
      break;
    }
    const actor = state.toAct;
    const bot = bots[state.players[actor].configIndex % bots.length];
    const before = options.checkMutation ? hashState(state) : null;
    const action = bot.chooseAction(state, { rng: forkRng(rng), timeBudgetMs: 0, iterations: options.iterations ?? null, now: null, ...(options.context || {}) });
    if (before !== null && hashState(state) !== before) out.mutated += 1;
    const key = actionKey(action);
    if (!getValidActions(state).some((a) => actionKey(a) === key)) out.illegal.push({ seed: config.seed, hash: hashState(state), action });
    try {
      applyAction(state, action, SILENT);
    } catch (err) {
      out.refusals.push({ seed: config.seed, hash: hashState(state), action, message: err.message });
      break;
    }
    out.keys.push(key);
    out.decisions += 1;
  }
  out.score = isGameOver(state) ? scoreGame(state) : null;
  return out;
}

function assertClean(results, label) {
  for (const r of results) {
    assert.equal(r.refusals.length, 0, `${label}: the engine refused a proposal: ${JSON.stringify(r.refusals[0])}`);
    assert.equal(r.illegal.length, 0, `${label}: a proposal was not in getValidActions: ${JSON.stringify(r.illegal[0])}`);
    assert.equal(r.mutated, 0, `${label}: choosing changed the state`);
    assert.ok(!r.capHit, `${label}: a game did not end`);
  }
}

const random = ruleset.getBot('random');
const easy = ruleset.getBot('easy');
const medium = ruleset.getBot('medium');

suite.check('the registry gives pr2e its own heuristic policies (not a stand-in), with everything the search reads', () => {
  assert.ok(!policies.standIn, 'the pr2e policies are still the temporary stand-in');
  for (const key of ['heuristicBot', 'easyBot', 'heuristicPolicy', 'rolloutPolicy', 'scoreValidActions', 'repeatGuard', 'decisionShare', 'pipelineValue']) {
    assert.ok(policies[key] !== undefined, `the policies lack ${key}`);
  }
  assert.equal(ruleset.getBot('medium'), policies.heuristicBot);
  assert.equal(ruleset.getBot('easy'), policies.easyBot);
});

for (const n of [2, 3, 4]) {
  suite.check(`Medium, ${n} players, default variants: 10 games, every proposal legal, zero refusals, the state never changed`, () => {
    const results = [];
    for (let g = 0; g < 10; g++) results.push(play({ playerCount: n, seed: `pm-${n}-${g}` }, [medium], { checkMutation: true, context: { jitter: 0.05 } }));
    assertClean(results, `Medium ${n}p`);
  });
  suite.check(`Easy, ${n} players: 6 games, every proposal legal, zero refusals, the state never changed`, () => {
    const results = [];
    for (let g = 0; g < 6; g++) results.push(play({ playerCount: n, seed: `pe-${n}-${g}` }, [easy, medium], { checkMutation: true }));
    assertClean(results, `Easy ${n}p`);
  });
}

const VARIANT_MIXES = [
  { layShape: 'one-new-route' },
  { layShape: 'adjacent-only', maxTurnsPerPlayer: 30 },
  { newConnectionRule: 'must-join-unjoined' },
  { tycoonMode: true },
  { arrivalBuilding: 'optional' },
  { upgradePlacement: 'any-carriage', hatOverflow: 'lost' },
];
suite.check(`Medium and Easy under ${VARIANT_MIXES.length} non-default variant mixes: every proposal legal, zero refusals`, () => {
  const results = [];
  VARIANT_MIXES.forEach((variants, i) => {
    for (let g = 0; g < 3; g++) results.push(play({ playerCount: 2 + (g % 3), seed: `pv-${i}-${g}`, variants }, [medium, easy]));
  });
  assertClean(results, 'variants');
});

suite.check('Random, Easy and Medium play 3 whole games each at 2 players, and Hard and Expert one game each at a small fixed allowance', () => {
  const capped = { maxTurnsPerPlayer: 12 };
  for (const [name, bot] of [['random', random], ['easy', easy], ['medium', medium]]) {
    const results = [];
    for (let g = 0; g < 3; g++) results.push(play({ playerCount: 2, seed: `levels-${name}-${g}`, variants: capped }, [bot]));
    assertClean(results, name);
    for (const r of results) assert.ok(r.score.final, `${name}: the game did not reach final scoring`);
  }
  for (const level of ['hard', 'expert']) {
    const r = play({ playerCount: 2, seed: `levels-${level}`, variants: { maxTurnsPerPlayer: 8 } }, [ruleset.getBot(level), medium], { iterations: level === 'hard' ? 40 : 48 });
    assertClean([r], level);
    assert.ok(r.score.final, `${level}: the game did not reach final scoring`);
  }
});

suite.check('the same seeds give the same game: Easy and Medium, and Hard at a fixed allowance', () => {
  for (const [label, bots, iterations, variants] of [
    ['medium', [medium], null, {}],
    ['easy', [easy, medium], null, {}],
    ['hard', [ruleset.getBot('hard'), medium], 40, { maxTurnsPerPlayer: 6 }],
  ]) {
    const a = play({ playerCount: 2, seed: `det-${label}`, variants }, bots, { iterations, context: { jitter: 0.05 } });
    const b = play({ playerCount: 2, seed: `det-${label}`, variants }, bots, { iterations, context: { jitter: 0.05 } });
    assert.equal(hashState(a.state), hashState(b.state), `${label}: two runs of one seed ended in different states`);
    assert.deepEqual(a.keys, b.keys, `${label}: two runs of one seed chose different actions`);
  }
});

suite.check('scoreValidActions lines up with the legal actions at every decision of a game, and does not change the state', () => {
  const state = createGame({ playerCount: 3, seed: 'scores' });
  const rng = makeRng('scores-bot');
  let decisions = 0;
  while (!isGameOver(state)) {
    const legal = getValidActions(state);
    const before = hashState(state);
    const scored = policies.scoreValidActions(state);
    assert.equal(hashState(state), before, 'scoring changed the state');
    assert.equal(scored.length, legal.length, 'one score per legal action');
    scored.forEach((entry, i) => {
      assert.equal(actionKey(entry.action), actionKey(legal[i]), 'scores come in the order of the legal actions');
      assert.ok(entry.score === null || Number.isFinite(entry.score), 'a score is a finite number or null');
    });
    applyAction(state, medium.chooseAction(state, { rng: forkRng(rng) }), SILENT);
    decisions += 1;
    assert.ok(decisions < DECISION_CAP, 'the game did not end');
  }
});

suite.check('Easy beats Random: 24 games at 2 players, seats alternating, at least 80% won by Easy', () => {
  let wins = 0;
  const N = 24;
  for (let g = 0; g < N; g++) {
    // config seat 0 plays Easy in even games, seat 1 in odd games; the engine keeps seat order by shuffleSeats=false
    const bots = g % 2 === 0 ? [easy, random] : [random, easy];
    const r = play({ playerCount: 2, seed: `easy-random-${g}`, shuffleSeats: false, variants: { maxTurnsPerPlayer: 60 } }, bots, { context: { jitter: 0.05 } });
    const winner = r.score.winner;
    if (r.state.players[winner].configIndex === (g % 2 === 0 ? 0 : 1)) wins += 1;
  }
  assert.ok(wins >= 0.8 * N, `Easy won ${wins} of ${N} against Random`);
});

suite.check('Medium beats Easy: 40 games at 2 players, seats alternating, more than 60% won by Medium', () => {
  let wins = 0;
  const N = 40;
  for (let g = 0; g < N; g++) {
    const bots = g % 2 === 0 ? [medium, easy] : [easy, medium];
    const r = play({ playerCount: 2, seed: `medium-easy-${g}`, shuffleSeats: false }, bots, { context: { jitter: 0.05 } });
    if (r.state.players[r.score.winner].configIndex === (g % 2 === 0 ? 0 : 1)) wins += 1;
  }
  assert.ok(wins > 0.6 * N, `Medium won ${wins} of ${N} against Easy`);
});

suite.check('Medium tables end by the transcontinental line, not the turn limit (2, 3 and 4 players, 12 games each)', () => {
  for (const n of [2, 3, 4]) {
    let line = 0;
    const N = 12;
    for (let g = 0; g < N; g++) {
      const r = play({ playerCount: n, seed: `ends-${n}-${g}` }, [medium], { context: { jitter: 0.05 } });
      if (r.score.endReason === 'transcontinental') line += 1;
    }
    assert.ok(line >= 0.9 * N, `${n} players: only ${line} of ${N} Medium games ended by the line`);
  }
});

suite.check('an unknown weight name is an error, and a known one overrides', () => {
  assert.throws(() => resolvePr2eWeights({ notAWeight: 1 }), /unknown weight/);
  assert.throws(() => resolvePr2eWeights({ coin: 'lots' }), /finite number/);
  assert.equal(resolvePr2eWeights(undefined), PR2E_WEIGHTS);
  assert.equal(resolvePr2eWeights({ coin: 2 }).coin, 2);
  const state = createGame({ playerCount: 2, seed: 'weights' });
  assert.throws(() => medium.chooseAction(state, { rng: makeRng('w'), weights: { notAWeight: 1 } }), /unknown weight/);
});

suite.check('Medium averages under a millisecond a decision', () => {
  const state = createGame({ playerCount: 2, seed: 'speed' });
  const rng = makeRng('speed-bot');
  let ns = 0n;
  let count = 0;
  while (!isGameOver(state)) {
    const t0 = process.hrtime.bigint();
    const a = policies.heuristicPolicy(state, { rng: forkRng(rng) });
    ns += process.hrtime.bigint() - t0;
    count += 1;
    applyAction(state, a, SILENT);
  }
  const us = Number(ns) / count / 1000;
  assert.ok(us < 1000, `Medium averages ${us.toFixed(0)} microseconds a decision`);
});

// ---------------------------------------------------------------------------
// Wild slots (P14.9): the bots plan through them and choose the fill
// ---------------------------------------------------------------------------

/** A game at Anna's worker step with her trains and tiles set by hand (no worker on the grid, seats in order). */
function wildStart(tiles, trains, laid = []) {
  const state = createGame({ players: [{ name: 'Anna' }, { name: 'Ben' }], seed: 'wild-bots', shuffleSeats: false });
  while (state.phase === 'setup') applyAction(state, getValidActions(state)[0], SILENT);
  state.players[0].railheads = trains.slice();
  state.players[0].resources = { iron: 0, wood: 0, gunpowder: 0 };
  state.players[0].coins = 0;
  state.players[0].builtTiles = { ground: 0, tunnel: 0, bridge: 0, ...tiles };
  for (const id of laid) state.map.routeOwner[id] = 1;
  return state;
}

/** Medium plays Anna's decisions until her turn is over. Returns the actions it took. */
function playTurn(state, seed) {
  const rng = makeRng(seed);
  const taken = [];
  for (let n = 0; state.toAct === 0 && !isGameOver(state) && n < 200; n++) {
    const a = policies.heuristicPolicy(state, { rng: forkRng(rng) });
    taken.push(actionKey(a));
    applyAction(state, a, SILENT);
  }
  return taken;
}

suite.check('Medium lays a route with a wild slot when its tiles pay the fixed slots and one more tile of any kind', () => {
  // Spokane - Helena is Tunnel, Bridge and a wild slot. One Tunnel, one Bridge and one Ground pay it exactly.
  const state = wildStart({ tunnel: 1, bridge: 1, ground: 1 }, ['SPO', 'SPO'], ['SEA-YAK', 'YAK-SPO']);
  applyAction(state, { type: 'placeWorker', space: 'W4' }, SILENT);
  applyAction(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' }, SILENT);
  const taken = playTurn(state, 'wild-lay');
  assert.notEqual(state.map.routeOwner['SPO-HEL'], null, `the wild route was laid: ${taken.join(' ')}`);
  assert.deepEqual(state.map.wildFill['SPO-HEL'], [{ slot: 2, terrain: 'ground' }], 'the only spare tile was Ground');
});

suite.check('Medium does not plan a path its tiles cannot pay: a wild slot needs a tile beyond the fixed slots', () => {
  const state = wildStart({ tunnel: 1, bridge: 1 }, ['SPO', 'SPO'], ['SEA-YAK', 'YAK-SPO']);
  assert.equal(E.hasLegalLay(state, 0), true, 'Spokane - Boise (one Tunnel) is still possible');
  applyAction(state, { type: 'placeWorker', space: 'W4' }, SILENT);
  applyAction(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' }, SILENT);
  const taken = playTurn(state, 'wild-no');
  assert.equal(state.map.routeOwner['SPO-HEL'], null, taken.join(' '));
});

suite.check('the wildSlot decision: Medium scores every terrain, spends the one with the most spare tiles, and is deterministic', () => {
  // Denver - Billings - Bismarck: the fixed slots take 2 Tunnel and 1 Bridge; 3 Tunnel, 2 Bridge and 5 Ground leave 1, 1 and 5 spare.
  const state = wildStart({ tunnel: 3, bridge: 2, ground: 5 }, ['DEN', 'DEN']);
  applyAction(state, { type: 'placeWorker', space: 'W4' }, SILENT);
  applyAction(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' }, SILENT);
  for (const route of ['BIL-DEN', 'BIL-BIS']) {
    if (E.topFrame(state).kind === 'lay' && E.topFrame(state).path === null) applyAction(state, { type: 'startLay', train: 0 }, SILENT);
    applyAction(state, { type: 'extendPath', route }, SILENT);
  }
  if (E.topFrame(state).kind === 'lay') applyAction(state, { type: 'endLay' }, SILENT);
  assert.equal(E.topFrame(state).kind, 'wildSlot');
  const scored = policies.scoreValidActions(state);
  assert.deepEqual(scored.map((x) => x.action.terrain).sort(), ['bridge', 'ground', 'tunnel']);
  assert.ok(scored.every((x) => typeof x.score === 'number'), 'every fill has a score');
  const pick = (seed) => policies.heuristicPolicy(state, { rng: makeRng(seed) });
  assert.equal(pick('a').terrain, 'ground', 'Ground has the most spare tiles');
  assert.equal(actionKey(pick('a')), actionKey(pick('a')));
  // Easy and the rollout policy also answer with a legal fill.
  for (const f of [policies.easyBot.chooseAction(state, { rng: makeRng('e') }), policies.rolloutPolicy(state, { rng: makeRng('r') })]) {
    assert.ok(getValidActions(state).some((a) => actionKey(a) === actionKey(f)), actionKey(f));
  }
});

suite.check('Medium and Easy play whole games in which wild slots are laid: the fills they choose are always legal (every game of 3 and 4 players here ends by the line)', () => {
  let wildLaid = 0;
  for (const players of [3, 4]) {
    for (let seed = 1; seed <= 6; seed++) {
      const config = { playerCount: players, seed: `wild-${players}-${seed}` };
      const r = play(config, [policies.heuristicBot, policies.easyBot], { botSeed: `wb-${seed}` });
      assert.equal(r.refusals.length, 0, JSON.stringify(r.refusals[0]));
      assert.equal(r.illegal.length, 0);
      assert.equal(r.capHit, false);
      wildLaid += Object.keys(r.state.map.wildFill).length;
    }
  }
  assert.ok(wildLaid > 0, 'at least one wild slot was laid in 12 games');
});

suite.finish();
