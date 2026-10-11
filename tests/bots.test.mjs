// bots.test.mjs - the heuristic bot (Easy, Medium) and its rollout policy.
//
// What is asserted (web-board-game skill, "AI Bots": a stat that is printed
// but never asserted on is a bug that ships):
//   - every proposal of every level is one of getValidActions and is never
//     refused, over whole games at 2, 3 and 4 players and under non-default
//     variant mixes;
//   - the bot never changes the state it is given;
//   - the same seeds give the same game;
//   - the repeated-state guard refuses a move back to a recent layout, and
//     Medium never makes such a move;
//   - Medium beats Random and Medium beats Easy (loose thresholds; the full
//     measurement is tests/bots-strength.mjs, run by hand);
//   - Medium tables end by a real trigger, not by the turn limit;
//   - an unknown weight name is an error, not a silently neutral bot;
//   - every registered level answers within its budget, through the worker
//     entry the UI uses.

import assert from 'node:assert/strict';
import {
  createGame,
  getValidActions,
  applyAction,
  isGameOver,
  scoreGame,
  hashState,
  cloneState,
  actionKey,
  makeRng,
  forkRng,
  topFrame,
  SILENT,
  MAP,
} from '../src/engine/index.js';
import { getBot, BOT_LEVELS, botLevelIds } from '../src/bots/index.js';
import { handleBotRequest } from '../src/bots/bot-worker.js';
import {
  HEURISTIC_WEIGHTS,
  heuristicBot,
  heuristicPolicy,
  rolloutPolicy,
  rolloutBot,
  repeatGuard,
  resolveWeights,
  scoreValidActions,
  describePlan,
} from '../src/bots/heuristicBot.js';
import { makeSuite } from './helpers/play.mjs';

const suite = makeSuite('bots');
const DECISION_CAP = 20000;

/**
 * Plays one game. `bots` is one bot per CONFIG seat (so that a level keeps its
 * seat however the engine shuffles). Checks every proposal against the valid
 * list and, if asked, that the state is not changed by choosing.
 */
function play(config, bots, options = {}) {
  const state = createGame(config);
  const rng = makeRng(options.botSeed ?? `bots:${config.seed}`);
  const out = { state, decisions: 0, refusals: [], illegal: [], mutated: 0, keys: [], guardBreaks: 0, capHit: false };
  while (!isGameOver(state)) {
    if (out.decisions >= DECISION_CAP) {
      out.capHit = true;
      break;
    }
    const actor = state.toAct;
    const bot = bots[state.players[actor].configIndex % bots.length];
    const before = options.checkMutation ? hashState(state) : null;
    const action = bot.chooseAction(state, { rng: forkRng(rng), timeBudgetMs: 0, iterations: null, now: null, ...(options.context || {}) });
    if (before !== null && hashState(state) !== before) out.mutated += 1;
    const key = actionKey(action);
    const valid = getValidActions(state);
    if (!valid.some((a) => actionKey(a) === key)) out.illegal.push({ seed: config.seed, hash: hashState(state), action });
    // Guard (c): a move the guard refuses is made only when every legal action is such a move.
    if (action.type === 'moveTrain' && repeatGuard.wouldRepeat(state, action, actor) && repeatGuard.filter(state, valid, actor).length !== valid.length) {
      out.guardBreaks += 1;
    }
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

function tally(results) {
  const t = { games: results.length, refusals: 0, illegal: 0, mutated: 0, capHits: 0, guardBreaks: 0, reasons: {}, first: null };
  for (const r of results) {
    t.refusals += r.refusals.length;
    t.illegal += r.illegal.length;
    t.mutated += r.mutated;
    t.guardBreaks += r.guardBreaks;
    if (r.capHit) t.capHits += 1;
    if (t.first === null && (r.refusals.length > 0 || r.illegal.length > 0)) t.first = r.refusals[0] || r.illegal[0];
    if (r.score) t.reasons[r.score.endReason] = (t.reasons[r.score.endReason] || 0) + 1;
  }
  return t;
}

function assertClean(t, label) {
  assert.equal(t.refusals, 0, `${label}: the engine refused a proposal: ${JSON.stringify(t.first)}`);
  assert.equal(t.illegal, 0, `${label}: a proposal was not in getValidActions: ${JSON.stringify(t.first)}`);
  assert.equal(t.capHits, 0, `${label}: a game did not end`);
}

const medium = getBot('medium');
const easy = getBot('easy');
const random = getBot('random');
const summary = [];

// --- the registry -----------------------------------------------------------------

suite.check('the registry offers random, easy and medium, weakest first, each with a name and a one-line description', () => {
  const ids = botLevelIds();
  assert.deepEqual(ids.slice(0, 3), ['random', 'easy', 'medium']);
  for (const level of BOT_LEVELS) {
    assert.equal(typeof level.name, 'string');
    assert.ok(level.name.length > 0);
    assert.equal(typeof level.description, 'string');
    assert.ok(level.description.length > 10 && !level.description.includes('\n'), `${level.id}: a one-line description`);
    assert.equal(typeof getBot(level.id).chooseAction, 'function');
  }
  assert.equal(getBot('medium'), heuristicBot);
});

// --- legality, zero refusals, no mutation --------------------------------------------

const defaultRuns = {};
for (const n of [2, 3, 4]) {
  suite.check(`Medium, ${n} players, default variants: 24 games, every proposal legal, zero refusals, the state never changed`, () => {
    const results = [];
    for (let g = 0; g < 24; g++) results.push(play({ playerCount: n, seed: `bots-m${n}-${g}` }, [medium], { checkMutation: g < 6 }));
    const t = tally(results);
    defaultRuns[n] = t;
    assertClean(t, `medium ${n}p`);
    assert.equal(t.mutated, 0, 'chooseAction changed the state');
    assert.equal(t.guardBreaks, 0, 'Medium made a move the repeated-state guard refuses');
  });
  suite.check(`Easy, ${n} players: 12 games, every proposal legal, zero refusals, the state never changed`, () => {
    const results = [];
    for (let g = 0; g < 12; g++) results.push(play({ playerCount: n, seed: `bots-e${n}-${g}` }, [easy], { checkMutation: g < 3 }));
    const t = tally(results);
    assertClean(t, `easy ${n}p`);
    assert.equal(t.mutated, 0, 'chooseAction changed the state');
  });
  suite.check(`rollout policy, ${n} players: 20 games, every proposal legal, zero refusals, a real ending in most`, () => {
    const results = [];
    for (let g = 0; g < 20; g++) results.push(play({ playerCount: n, seed: `bots-r${n}-${g}` }, [rolloutBot], { checkMutation: g < 3 }));
    const t = tally(results);
    assertClean(t, `rollout ${n}p`);
    assert.equal(t.mutated, 0, 'rolloutPolicy changed the state');
    const real = t.games - (t.reasons['turn-limit'] || 0);
    assert.ok(real >= 16, `rollout ${n}p: only ${real} of ${t.games} games ended by a real trigger`);
  });
}

const VARIANT_MIXES = [
  { claimFrom: 'network' },
  { turnStructure: 'rounds' },
  { conversionRate: '1:1' },
  { conversionRate: 'iron-in-all' },
  { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false },
  { endGameScoring: 'both', layTrackClaims: 'per-railhead', congressTable: 'jan-2026', bonusActionLimit: 'multiplied' },
  { claimFrom: 'network', turnStructure: 'rounds', layTrackClaims: 'per-railhead', endGameScoring: 'goals' },
  {
    gameEndTrigger: 'any-crossing',
    upgradeVpTiming: 'on-install',
    specialistActivations: 'once',
    bothBuildingsSameOwner: false,
    gridLayout: 'shuffle-resources',
    scoringCard: 'random',
    bonusActionLimit: 'once-per-game',
    hireCostModel: 'fee-only',
    buildingScoreCurve: '2018',
    startCompensation: 'none',
    ponyOngoingCap: 0,
  },
  { endRoutesPerPlayer: 0, maxTurnsPerPlayer: 40, hireCostModel: 'table-only', goalsInPlay: 6, endGameScoring: 'goals' },
];

let variantGames = 0;
suite.check(`Medium, Easy and the rollout policy under ${VARIANT_MIXES.length} non-default variant mixes: every proposal legal, zero refusals`, () => {
  const all = [];
  VARIANT_MIXES.forEach((variants, v) => {
    for (const n of [2, 3, 4]) {
      for (let g = 0; g < 2; g++) {
        const seed = `bots-v${v}-${n}-${g}`;
        const r = play({ playerCount: n, seed, variants }, [medium], { checkMutation: g === 0 });
        assert.equal(r.refusals.length + r.illegal.length, 0, `medium, ${JSON.stringify(variants)}, seed ${seed}: ${JSON.stringify(r.refusals[0] || r.illegal[0])}`);
        assert.ok(!r.capHit, `medium, ${JSON.stringify(variants)}, seed ${seed}: the game did not end`);
        all.push(r);
      }
      all.push(play({ playerCount: n, seed: `bots-ve${v}-${n}`, variants }, [easy]));
      all.push(play({ playerCount: n, seed: `bots-vr${v}-${n}`, variants }, [rolloutBot]));
    }
  });
  const t = tally(all);
  variantGames = t.games;
  assertClean(t, 'variant mixes');
  assert.equal(t.mutated, 0, 'chooseAction changed the state');
});

// --- determinism ----------------------------------------------------------------------

suite.check('determinism: the same game seed and bot seed give the same choices; another bot seed is still a legal game', () => {
  for (const [level, bot] of [['medium', medium], ['easy', easy], ['rollout', rolloutBot]]) {
    const config = { playerCount: 3, seed: `bots-det-${level}` };
    const a = play(config, [bot], { botSeed: 'one' });
    const b = play(config, [bot], { botSeed: 'one' });
    assert.deepEqual(a.keys, b.keys, `${level}: two runs with the same seeds differ`);
    assert.equal(hashState(a.state), hashState(b.state));
    const c = play(config, [bot], { botSeed: 'two' });
    assert.equal(c.refusals.length, 0);
    if (level !== 'medium') assert.notDeepEqual(a.keys, c.keys, `${level} should use its random stream`);
  }
});

suite.check('determinism: Medium without jitter does not read its random stream, and gives the same answer on a clone', () => {
  const state = createGame({ playerCount: 4, seed: 'bots-clone' });
  for (let i = 0; i < 400 && !isGameOver(state); i++) {
    const a = heuristicPolicy(state, { rng: makeRng(`a${i}`) });
    const b = heuristicPolicy(state, { rng: makeRng(`b${i}`) });
    assert.equal(actionKey(a), actionKey(b), 'Medium depends on its rng without jitter');
    // A clone has no guard memory; outside a Lay Tracks decision that cannot matter.
    if (topFrame(state).kind !== 'layTracks') assert.equal(actionKey(heuristicPolicy(cloneState(state), {})), actionKey(a));
    applyAction(state, a, SILENT);
  }
});

// --- weights, jitter, describe ----------------------------------------------------------

suite.check('context.weights overrides a weight; an unknown name or a non-number throws, in resolveWeights and in chooseAction', () => {
  assert.equal(resolveWeights(undefined), HEURISTIC_WEIGHTS);
  assert.equal(resolveWeights({ biasCongress: 3 }).biasCongress, 3);
  assert.equal(resolveWeights({ biasCongress: 3 }).biasTunnel, HEURISTIC_WEIGHTS.biasTunnel);
  assert.throws(() => resolveWeights({ biasCongres: 3 }), /unknown weight "biasCongres"/);
  assert.throws(() => resolveWeights({ biasCongress: '3' }), /finite number/);
  const state = createGame({ playerCount: 2, seed: 'bots-weights' });
  assert.throws(() => medium.chooseAction(state, { rng: makeRng(1), weights: { nope: 1 } }), /unknown weight "nope"/);
  for (const name of Object.keys(HEURISTIC_WEIGHTS)) assert.equal(typeof HEURISTIC_WEIGHTS[name], 'number', name);
  // Archetypes play whole games legally.
  for (const weights of [{ biasCongress: 3 }, { biasTunnel: 2.5 }, { biasEngine: 3, biasUpgrades: 3 }, { biasCrossing: 0, biasBuildings: 2 }]) {
    const r = play({ playerCount: 3, seed: `bots-arch-${JSON.stringify(weights)}` }, [medium], { context: { weights, jitter: 0.3 } });
    assert.equal(r.refusals.length + r.illegal.length, 0, JSON.stringify(weights));
    assert.ok(!r.capHit);
  }
});

suite.check('scoreValidActions and describePlan read a position without changing it', () => {
  const state = createGame({ playerCount: 3, seed: 'bots-describe' });
  const rng = makeRng('d');
  let seen = 0;
  for (let i = 0; i < 300 && !isGameOver(state); i++) {
    const before = hashState(state);
    const scored = scoreValidActions(state);
    const plan = describePlan(state);
    assert.equal(hashState(state), before);
    assert.equal(scored.length, getValidActions(state).length);
    for (const s of scored) assert.ok(s.score === null || Number.isFinite(s.score));
    if (plan && plan.target1) seen += 1;
    applyAction(state, medium.chooseAction(state, { rng: forkRng(rng) }), SILENT);
  }
  assert.ok(seen > 100, 'the plan should name a target route in most decisions');
});

// --- the repeated-state guard -------------------------------------------------------------

suite.check('repeated-state guard: a move back to a remembered layout is refused, progress clears it, a clone has no memory', () => {
  // Find a Lay Tracks decision with a legal move.
  let state = null;
  let move = null;
  for (let g = 0; g < 40 && move === null; g++) {
    const s = createGame({ playerCount: 2, seed: `bots-guard-${g}` });
    const rng = makeRng(`g${g}`);
    for (let i = 0; i < 3000 && !isGameOver(s); i++) {
      if (topFrame(s).kind === 'layTracks') {
        const m = getValidActions(s).find((a) => a.type === 'moveTrain');
        if (m) {
          state = s;
          move = m;
          break;
        }
      }
      applyAction(s, medium.chooseAction(s, { rng: forkRng(rng) }), SILENT);
    }
  }
  assert.ok(move !== null, 'no Lay Tracks decision with a legal move was found');
  const pid = state.toAct;
  repeatGuard.reset(state);
  assert.equal(repeatGuard.wouldRepeat(state, move), false, 'nothing is remembered yet');
  const here = repeatGuard.fingerprint(state, pid);
  repeatGuard.note(state);
  // The railhead goes there (by hand: the test is of the guard, not of the engine) ...
  const at = state.players[pid].railheads.indexOf(move.from);
  state.players[pid].railheads[at] = move.to;
  assert.notEqual(repeatGuard.fingerprint(state, pid), here);
  repeatGuard.note(state);
  // ... and the move back would recreate the layout it started from.
  const back = { type: 'moveTrain', from: move.to, to: move.from };
  assert.equal(repeatGuard.wouldRepeat(state, back), true);
  assert.equal(repeatGuard.wouldRepeat(state, { type: 'stopLaying' }), false, 'only moves are guarded');
  const other = MAP.cityIds.find((c) => c !== move.from && c !== move.to && !state.players[pid].railheads.includes(c));
  assert.equal(repeatGuard.wouldRepeat(state, { type: 'moveTrain', from: move.to, to: other }), false, 'a move somewhere new is fine');
  assert.deepEqual(repeatGuard.filter(state, [back, { type: 'stopLaying' }]), [{ type: 'stopLaying' }]);
  assert.deepEqual(repeatGuard.filter(state, [back]), [back], 'with nothing else left the guard gives way (a legal action always comes back)');
  // The memory is per state object: a clone starts with none, and the state itself holds nothing of it.
  assert.equal(repeatGuard.wouldRepeat(cloneState(state), back), false);
  assert.ok(!JSON.stringify(state).includes(here));
  // Progress (a claimed route) makes the old layouts irrelevant.
  const free = MAP.routeIds.find((id) => state.map.routeOwner[id] === null);
  state.map.routeOwner[free] = pid;
  assert.equal(repeatGuard.wouldRepeat(state, back), false);
});

// --- strength, on small samples with loose thresholds --------------------------------------

function duel(levelA, botA, botB, games, tag) {
  let wins = 0;
  const results = [];
  for (let g = 0; g < games; g++) {
    // shuffleSeats false: config seat = seat, so alternating the config order alternates the seats.
    const bots = g % 2 === 0 ? [botA, botB] : [botB, botA];
    const r = play({ playerCount: 2, seed: `bots-${tag}-${g >> 1}`, shuffleSeats: false }, bots);
    results.push(r);
    const winnerConfig = r.state.players[r.score.winner].configIndex;
    if (bots[winnerConfig] === botA) wins += 1;
  }
  assertClean(tally(results), tag);
  return wins;
}

suite.check('Medium beats Random in at least 34 of 40 two-player games, seats alternated', () => {
  const wins = duel('medium', medium, random, 40, 'mr');
  summary.push(`Medium v Random ${wins}/40`);
  assert.ok(wins >= 34, `Medium won ${wins} of 40 against Random`);
});

suite.check('Medium beats Easy in at least 36 of 60 two-player games, seats alternated', () => {
  const wins = duel('medium', medium, easy, 60, 'me');
  summary.push(`Medium v Easy ${wins}/60`);
  assert.ok(wins >= 36, `Medium won ${wins} of 60 against Easy`);
});

suite.check('Easy beats Random in at least 24 of 30 two-player games, seats alternated', () => {
  const wins = duel('easy', easy, random, 30, 'er');
  summary.push(`Easy v Random ${wins}/30`);
  assert.ok(wins >= 24, `Easy won ${wins} of 30 against Random`);
});

suite.check('Medium tables end by a real trigger: at least 20 of the 24 default games at each player count', () => {
  for (const n of [2, 3, 4]) {
    const t = defaultRuns[n];
    assert.ok(t, `the ${n}-player run did not finish`);
    const real = t.games - (t.reasons['turn-limit'] || 0);
    summary.push(`${n}p ends ${JSON.stringify(t.reasons)}`);
    assert.ok(real >= 20, `${n} players: only ${real} of ${t.games} games ended by a real trigger: ${JSON.stringify(t.reasons)}`);
  }
});

// --- every level, through the worker entry, within its budget --------------------------------

suite.check('every registered level returns a legal action within its budget (through handleBotRequest, as the UI asks)', () => {
  // A few positions of different kinds: the draft, the opening, the middle of a game.
  const positions = [createGame({ playerCount: 4, seed: 'bots-budget' })];
  const mid = createGame({ playerCount: 3, seed: 'bots-budget-2' });
  const rng = makeRng('b');
  for (let i = 0; i < 260 && !isGameOver(mid); i++) {
    if (i === 30 || i === 120) positions.push(cloneState(mid));
    applyAction(mid, medium.chooseAction(mid, { rng: forkRng(rng) }), SILENT);
  }
  if (!isGameOver(mid)) positions.push(mid);
  const clock = () => Number(process.hrtime.bigint()) / 1e6;
  for (const level of BOT_LEVELS) {
    // A level that searches is asked once (its budget is seconds); the instant ones at every position.
    const asked = level.defaultTimeBudgetMs > 0 ? positions.slice(-1) : positions;
    for (const state of asked) {
      const before = hashState(state);
      // The first call of a level pays for JIT warm-up; time the second.
      handleBotRequest({ id: 0, state, level: level.id, seed: 7 }, clock);
      const t0 = clock();
      const reply = handleBotRequest({ id: 1, state, level: level.id, seed: 7 }, clock);
      const ms = clock() - t0;
      assert.equal(reply.ok, true, `${level.id}: ${reply.error}`);
      assert.ok(getValidActions(state).some((a) => actionKey(a) === actionKey(reply.action)), `${level.id}: not a legal action`);
      assert.equal(hashState(state), before, `${level.id} changed the state`);
      const budget = level.defaultTimeBudgetMs > 0 ? level.defaultTimeBudgetMs * 1.5 + 250 : 100;
      assert.ok(ms <= budget, `${level.id} took ${ms.toFixed(1)} ms; its budget allows ${budget} ms`);
    }
  }
  // An unknown weight reaches the caller as a failed reply, never as a neutral move.
  const bad = handleBotRequest({ id: 2, state: positions[0], level: 'medium', seed: 7, options: { weights: { typo: 2 } } }, clock);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown weight "typo"/);
});

// --- speed (printed; the hard figures are in tests/bots-strength.mjs) -------------------------

let speed = '';
suite.check('speed: Medium averages under 1 ms a decision and the rollout policy is several times faster', () => {
  const time = (policy, seeds) => {
    let ns = 0n;
    let count = 0;
    for (const seed of seeds) {
      const state = createGame({ playerCount: 4, seed });
      const rng = makeRng(`s:${seed}`);
      while (!isGameOver(state)) {
        const r = forkRng(rng);
        const t0 = process.hrtime.bigint();
        const a = policy(state, { rng: r });
        ns += process.hrtime.bigint() - t0;
        count += 1;
        applyAction(state, a, SILENT);
      }
    }
    return Number(ns) / count / 1000;
  };
  const seeds = ['bots-speed-1', 'bots-speed-2', 'bots-speed-3', 'bots-speed-4', 'bots-speed-5', 'bots-speed-6'];
  time(heuristicPolicy, seeds.slice(0, 2));
  time(rolloutPolicy, seeds.slice(0, 2));
  const m = time(heuristicPolicy, seeds);
  const r = time(rolloutPolicy, seeds);
  speed = `Medium ${m.toFixed(0)} us/decision, rollout ${r.toFixed(1)} us/decision`;
  assert.ok(m < 1000, `Medium averages ${m.toFixed(0)} microseconds a decision`);
  assert.ok(r * 3 < m, `the rollout policy (${r.toFixed(1)} us) should be at least three times faster than Medium (${m.toFixed(0)} us)`);
});

suite.finish(`${24 * 3 + 12 * 3 + 20 * 3 + variantGames} whole games without a refusal; ${summary.join('; ')}; ${speed}`);
