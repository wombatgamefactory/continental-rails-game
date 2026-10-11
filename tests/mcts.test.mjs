// mcts.test.mjs - the search bots (Hard, Expert): src/bots/mctsBot.js.
//
// Semantics: permanently green; exits 1 on any failure. Small iteration
// allowances keep it to well under a minute; STRENGTH is not tested here
// (tests/mcts-strength.mjs, run by hand).
//
// What is checked:
//  1. Only legal moves, and an untouched state, at every decision of 20 full
//     games: 2, 3 and 4 players, default rules and four non-default mixes
//     (claimFrom = network, turnStructure = rounds, every module off, and a
//     mix of the Lay Tracks, Congress and conversion variants).
//  2. Determinism: the same state, seed and iteration allowance give the same
//     move and the same search statistics.
//  3. Hidden information: scrambling the hidden deck orders and the game RNG
//     of the root position changes NOTHING about the search (same move, same
//     visit counts), because the search starts from `blindCopy`.
//  4. Fallback: with no budget the bot plays exactly Medium's choice.
//  5. The injected clock: the bot stops promptly when the clock passes the
//     budget, and never reads a clock of its own.
//  6. Decisions that fall to a player who is not the active player.
//  7. The registry and the worker entry.

import assert from 'node:assert/strict';
import {
  createGame,
  getValidActions,
  applyAction,
  isGameOver,
  hashState,
  cloneState,
  hiddenDecks,
  actionKey,
  topFrame,
  makeRng,
  forkRng,
  shuffle,
  SILENT,
} from '../src/engine/index.js';
import { getBot, BOT_LEVELS, botLevelIds } from '../src/bots/index.js';
import { heuristicBot } from '../src/bots/heuristicBot.js';
import { search, blindCopy, decisionShare, resolveSettings, MCTS_SETTINGS } from '../src/bots/mctsBot.js';
import { handleBotRequest } from '../src/bots/bot-worker.js';
import { makeSuite } from './helpers/play.mjs';

const suite = makeSuite('mcts');
const started = performance.now();

/** Every decision is searched, with a tiny allowance, and playouts switch to the cheap policy after two turns. */
const TEST_SHARES = {
  shareFreeBefore: 1,
  shareWorker: 1,
  shareDistrict: 1,
  shareLayTracks: 1,
  shareBuilding: 1,
  shareFollowUp: 1,
  shareOffTurn: 1,
  shareSetup: 1,
  minIterations: 1,
};
const CHEAP = { ...TEST_SHARES, mediumTurns: 2 };

const keysOf = (state) => new Set(getValidActions(state).map(actionKey));

/**
 * Plays a whole game. `seats[i]` is 'search', 'hard' (through the registry),
 * 'medium' or 'random'. Checks every proposal of a search seat for legality
 * and that the state is left as it was.
 */
function playChecked(config, seats, iterations, mcts, tally) {
  const state = createGame(config);
  const rngs = seats.map((_, seat) => makeRng(`t:${config.seed}:${seat}`));
  let decisions = 0;
  while (!isGameOver(state)) {
    assert.ok(decisions < 20000, 'the game did not end');
    const seat = state.toAct;
    const kind = seats[state.players[seat].configIndex];
    const rng = forkRng(rngs[seat]);
    let action;
    if (kind === 'search' || kind === 'hard') {
      const before = hashState(state);
      const legal = keysOf(state);
      if (kind === 'search') {
        const found = search(state, { rng, iterations, mcts, now: null });
        action = found.action;
        tally.calls += 1;
        if (found.searched) {
          tally.searched += 1;
          const frame = topFrame(state);
          tally.kinds[frame.kind] = (tally.kinds[frame.kind] || 0) + 1;
          if (state.phase === 'play' && state.turn.player !== seat) tally.offTurn += 1;
        }
      } else {
        action = getBot('hard').chooseAction(state, { rng, iterations, mcts, timeBudgetMs: null, now: null });
        tally.calls += 1;
      }
      assert.ok(legal.has(actionKey(action)), `seed ${config.seed}: ${JSON.stringify(action)} is not in the legal list (hash ${before})`);
      assert.equal(hashState(state), before, `seed ${config.seed}: the bot changed the state`);
    } else {
      action = getBot(kind).chooseAction(state, { rng, timeBudgetMs: 0, iterations: null, now: null });
    }
    applyAction(state, action, SILENT); // throws on a refusal, which fails the check
    decisions += 1;
  }
  tally.games += 1;
  return state;
}

// --- 1. legal moves over full games ---------------------------------------------

const tally = { games: 0, calls: 0, searched: 0, offTurn: 0, kinds: {} };
const short = { maxTurnsPerPlayer: 30 };
const TABLES = [
  // players, seats, variants
  [2, ['search', 'medium'], {}],
  [2, ['medium', 'search'], {}],
  [2, ['search', 'random'], short],
  [2, ['search', 'search'], {}],
  [2, ['hard', 'medium'], {}],
  [2, ['medium', 'search'], {}],
  [3, ['search', 'medium', 'medium'], {}],
  [3, ['medium', 'search', 'random'], short],
  [3, ['medium', 'medium', 'search'], {}],
  [3, ['hard', 'medium', 'search'], {}],
  [3, ['search', 'medium', 'medium'], {}],
  [4, ['search', 'medium', 'medium', 'medium'], {}],
  [4, ['medium', 'search', 'random', 'medium'], short],
  [4, ['medium', 'medium', 'search', 'medium'], {}],
  [4, ['medium', 'hard', 'medium', 'search'], {}],
  [4, ['medium', 'medium', 'medium', 'search'], {}],
  [2, ['search', 'medium'], { claimFrom: 'network' }],
  [3, ['medium', 'search', 'medium'], { turnStructure: 'rounds' }],
  [2, ['search', 'medium'], { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false }],
  [4, ['medium', 'medium', 'search', 'medium'], { layTrackClaims: 'per-railhead', congressTable: 'jan-2026', conversionRate: '1:1', endGameScoring: 'both', scoringCard: 'random' }],
];

TABLES.forEach(([players, seats, variants], i) => {
  const names = Object.keys(variants).length > 0 ? ` ${JSON.stringify(variants)}` : '';
  suite.check(`game ${i + 1}: ${players} players (${seats.join(', ')})${names}: only legal moves, state untouched`, () => {
    playChecked({ playerCount: players, seed: `mcts-${i}`, variants, shuffleSeats: false }, seats, 2, CHEAP, tally);
  });
});

suite.check('the 20 games really searched: most decisions, several kinds, and some outside the bot\'s own turn', () => {
  assert.equal(tally.games, TABLES.length, 'a game did not finish');
  assert.ok(tally.searched > 1000, `only ${tally.searched} searched decisions`);
  for (const kind of ['workerStep', 'chooseDistrict', 'trainActivation', 'layTracks', 'placeBuildings', 'setupRailhead']) {
    assert.ok((tally.kinds[kind] || 0) > 0, `no ${kind} decision was searched`);
  }
  assert.ok(tally.offTurn > 0, 'no decision outside the active player\'s turn was searched');
});

// --- positions for the checks below -------------------------------------------------

/** States of a Medium game: every `every`-th decision, and every decision that falls to a non-active player. */
function positions(config, every) {
  const state = createGame(config);
  const rng = makeRng(`pos:${config.seed}`);
  const list = [];
  const offTurn = [];
  let lastWorkerStep = null;
  let n = 0;
  while (!isGameOver(state)) {
    if (n % every === 0) list.push(cloneState(state));
    if (state.phase === 'play' && state.turn.player !== state.toAct) offTurn.push(cloneState(state));
    if (state.phase === 'play' && topFrame(state).kind === 'workerStep') lastWorkerStep = cloneState(state);
    applyAction(state, heuristicBot.chooseAction(state, { rng: forkRng(rng), jitter: 0.01 }), SILENT);
    n += 1;
  }
  return { list, offTurn, lastWorkerStep };
}

const sample2 = positions({ playerCount: 2, seed: 'pos-a' }, 23);
const sample4 = positions({ playerCount: 4, seed: 'pos-b' }, 61);
const SAMPLE = [...sample2.list, ...sample4.list];
const summary = (found) => ({ action: found.action, searched: found.searched, iterations: found.iterations, children: found.children.map((c) => [c.key, c.visits, c.mean]) });

// --- 2. determinism --------------------------------------------------------------------

suite.check(`determinism: the same state, seed and allowance give the same move and statistics (${SAMPLE.length} positions)`, () => {
  let differentSeedDiffers = 0;
  for (const state of SAMPLE) {
    const a = summary(search(state, { rng: makeRng('d1'), iterations: 6, mcts: CHEAP }));
    const b = summary(search(cloneState(state), { rng: makeRng('d1'), iterations: 6, mcts: CHEAP }));
    assert.deepEqual(a, b);
    assert.equal(a.searched, true);
    const c = summary(search(state, { rng: makeRng('d2'), iterations: 6, mcts: CHEAP }));
    if (JSON.stringify(c) !== JSON.stringify(a)) differentSeedDiffers += 1;
  }
  assert.ok(differentSeedDiffers > 0, 'the bot stream has no effect at all: the seed is not being used');
});

suite.check('determinism through the registry: getBot("hard") and getBot("expert") repeat themselves', () => {
  const state = sample2.list[3];
  for (const level of ['hard', 'expert']) {
    const one = getBot(level).chooseAction(state, { rng: makeRng(7), iterations: 40, timeBudgetMs: null, now: null });
    const two = getBot(level).chooseAction(state, { rng: makeRng(7), iterations: 40, timeBudgetMs: null, now: null });
    assert.deepEqual(one, two);
    assert.ok(keysOf(state).has(actionKey(one)));
  }
});

// --- 3. hidden information ---------------------------------------------------------------

suite.check('hidden information: scrambling the hidden deck orders and the game RNG changes nothing about the search', () => {
  let scrambled = 0;
  for (const state of SAMPLE) {
    const other = cloneState(state);
    const scrambler = makeRng(`scramble:${hashState(state)}`);
    let moved = false;
    for (const deck of hiddenDecks(other)) {
      const was = deck.join(',');
      shuffle(scrambler, deck);
      if (deck.join(',') !== was) moved = true;
    }
    other.rng = { s: 987654321 };
    assert.notEqual(hashState(other), hashState(state), 'the scramble did not change the state');
    if (moved) scrambled += 1;
    const a = summary(search(state, { rng: makeRng('h'), iterations: 6, mcts: CHEAP }));
    const b = summary(search(other, { rng: makeRng('h'), iterations: 6, mcts: CHEAP }));
    assert.deepEqual(b, a, 'the search depends on a hidden order');
    assert.ok(keysOf(other).has(actionKey(b.action)));
    // By construction: the copy the search starts from is the same for both.
    assert.equal(hashState(blindCopy(other)), hashState(blindCopy(state)));
  }
  assert.ok(scrambled >= SAMPLE.length / 2, `only ${scrambled} of ${SAMPLE.length} positions had a deck order to scramble`);
});

suite.check('hidden information: blindCopy leaves the original alone and keeps everything open', () => {
  const state = sample2.list[4];
  const before = hashState(state);
  const blind = blindCopy(state);
  assert.equal(hashState(state), before);
  assert.deepEqual(blind.players, state.players);
  assert.deepEqual(blind.map, state.map);
  assert.deepEqual(blind.grid, state.grid);
  assert.deepEqual(blind.stack, state.stack);
  if (state.modules.pony) assert.deepEqual(blind.modules.pony.market, state.modules.pony.market);
  for (const deck of hiddenDecks(blind)) assert.deepEqual(deck, deck.slice().sort());
});

// --- 4. fallback ----------------------------------------------------------------------------

suite.check('no budget: the bot plays exactly Medium\'s choice (timeBudgetMs 0, iterations 0, an allowance below the minimum)', () => {
  for (const state of SAMPLE) {
    const medium = heuristicBot.chooseAction(state, { rng: makeRng('f') });
    for (const context of [{ timeBudgetMs: 0, iterations: null, now: null }, { timeBudgetMs: 0, iterations: null, now: () => 0 }, { iterations: 0 }, { iterations: 3 }]) {
      const found = search(state, { ...context, rng: makeRng('f') });
      assert.equal(found.searched, false);
      assert.deepEqual(found.action, medium);
      for (const level of ['hard', 'expert']) assert.deepEqual(getBot(level).chooseAction(state, { ...context, rng: makeRng('f') }), medium);
    }
  }
});

// --- 5. the injected clock --------------------------------------------------------------------

suite.check('the clock: a clock that jumps past the budget stops the search at once (Medium\'s choice comes back)', () => {
  for (const state of SAMPLE.slice(0, 12)) {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 1e9;
    };
    const found = search(state, { rng: makeRng('c'), timeBudgetMs: 1500, iterations: null, now });
    assert.equal(found.searched, false);
    assert.equal(found.iterations, 0);
    assert.ok(calls <= 2, `the clock was read ${calls} times`);
    assert.deepEqual(found.action, heuristicBot.chooseAction(state, { rng: makeRng('c') }));
  }
});

suite.check('the clock: the search runs while the clock allows and no longer', () => {
  const state = sample2.list[5];
  const share = decisionShare(state);
  let t = 0;
  const now = () => {
    t += 10; // every reading is 10 ms later than the last
    return t;
  };
  const budget = 400 / share; // 400 ms for this decision: at most 40 readings
  const found = search(state, { rng: makeRng('c2'), timeBudgetMs: budget, iterations: null, now, mcts: { earlyExit: false, mediumTurns: 2 } });
  assert.equal(found.searched, true);
  assert.equal(found.reason, 'time spent');
  assert.ok(found.iterations >= 30 && found.iterations <= 40, `${found.iterations} iterations`);
  assert.ok(keysOf(state).has(actionKey(found.action)));
});

suite.check('no clock and no iterations: the level\'s own allowance is used, scaled by the time asked for (reproducible)', () => {
  const state = sample2.lastWorkerStep; // late in the game, so the playouts are short
  assert.ok(state, 'no worker step in the sample game');
  const context =() => ({ rng: makeRng('n'), timeBudgetMs: MCTS_SETTINGS.hardTimeBudgetMs / 5, iterations: null, now: null, mcts: { earlyExit: false } });
  const a = search(state, context());
  const b = search(state, context());
  assert.equal(a.iterations, Math.floor((MCTS_SETTINGS.hardIterations / 5) * decisionShare(state)));
  assert.deepEqual(summary(a), summary(b));
});

// --- 6. decisions of a player who is not the active player -------------------------------------

suite.check('decisions outside the bot\'s own turn are searched, legal and given the small share', () => {
  const offTurn = [...sample2.offTurn, ...sample4.offTurn];
  assert.ok(offTurn.length >= 3, `only ${offTurn.length} such positions in the sample games`);
  for (const state of offTurn) {
    assert.notEqual(state.toAct, state.turn.player);
    assert.equal(decisionShare(state), MCTS_SETTINGS.shareOffTurn);
    const before = hashState(state);
    const found = search(state, { rng: makeRng('o'), iterations: 4, mcts: CHEAP });
    assert.equal(found.searched, true);
    assert.ok(keysOf(state).has(actionKey(found.action)));
    assert.equal(hashState(state), before);
    // With the real shares and a small allowance the bot does not search here at all.
    assert.equal(search(state, { rng: makeRng('o'), iterations: 60 }).searched, false);
  }
});

// --- 7. the registry, the settings, the worker entry -------------------------------------------

suite.check('the registry lists random, easy, medium, hard, expert with the per-turn budgets', () => {
  assert.deepEqual(botLevelIds(), ['random', 'easy', 'medium', 'hard', 'expert']);
  const byId = Object.fromEntries(BOT_LEVELS.map((level) => [level.id, level]));
  assert.equal(byId.hard.defaultTimeBudgetMs, 1500);
  assert.equal(byId.expert.defaultTimeBudgetMs, 6000);
  for (const level of BOT_LEVELS) {
    assert.ok(typeof level.name === 'string' && level.name.length > 0);
    assert.ok(typeof level.description === 'string' && level.description.length > 20);
    assert.ok(!/house/i.test(level.description));
  }
});

suite.check('the shares of a typical turn add up to about one allowance', () => {
  const S = MCTS_SETTINGS;
  const typical = S.shareFreeBefore + S.shareWorker + S.shareDistrict + 3 * S.shareFollowUp;
  assert.ok(typical > 0.8 && typical < 1.3, `a typical turn takes ${typical} of the allowance`);
  assert.throws(() => resolveSettings({ explorashun: 1 }), /unknown setting/);
  assert.equal(resolveSettings(null), MCTS_SETTINGS);
});

suite.check('the worker entry answers for hard and expert, with a clock and with an iteration allowance', () => {
  const state = sample2.list[6];
  const legal = keysOf(state);
  const fixed = handleBotRequest({ id: 1, state, level: 'hard', seed: 5, iterations: 30 }, null);
  assert.equal(fixed.ok, true, fixed.error);
  assert.ok(legal.has(actionKey(fixed.action)));
  let t = 0;
  const timed = handleBotRequest({ id: 2, state, level: 'expert', seed: 5, timeBudgetMs: 200 }, () => (t += 20));
  assert.equal(timed.ok, true, timed.error);
  assert.ok(legal.has(actionKey(timed.action)));
});

suite.finish(`${tally.games} games, ${tally.searched} searched decisions (${tally.offTurn} outside the bot's own turn), ${((performance.now() - started) / 1000).toFixed(1)} s`);
