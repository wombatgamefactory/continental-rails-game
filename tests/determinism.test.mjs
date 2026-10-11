// determinism.test.mjs - a game is a pure function of (config, seed, actions).
//
// Semantics: permanently green; exits 1 on any failure.

import assert from 'node:assert/strict';
import {
  createGame,
  replayGame,
  getGameConfig,
  hashState,
  cloneState,
  determinise,
  hiddenDecks,
  makeRng,
  rngNext,
  forkRng,
  shuffle,
  getValidActions,
  applyAction,
  isGameOver,
} from '../src/engine/index.js';
import { playGame, makeSuite } from './helpers/play.mjs';

const suite = makeSuite('determinism');

for (const players of [2, 3, 4]) {
  suite.check(`${players}p: the same seed gives the same game, hash for hash`, () => {
    const config = { playerCount: players, seed: `det-${players}` };
    const a = playGame(config, { botSeed: 'bots-A' });
    const b = playGame(config, { botSeed: 'bots-A' });
    assert.equal(a.refusals.length + b.refusals.length, 0);
    assert.equal(a.decisions, b.decisions);
    assert.deepEqual(a.actions, b.actions);
    assert.equal(hashState(a.state), hashState(b.state));
    assert.deepEqual(a.state, b.state);
  });

  suite.check(`${players}p: different seeds give different games`, () => {
    const hashes = new Set();
    const starts = new Set();
    for (let i = 0; i < 12; i++) {
      const config = { playerCount: players, seed: i };
      starts.add(hashState(createGame(config)));
      hashes.add(hashState(playGame(config, { botSeed: 'same-bots' }).state));
    }
    assert.equal(starts.size, 12, 'consecutive integer seeds must give different starting states');
    assert.equal(hashes.size, 12, 'consecutive integer seeds must give different final states');
  });

  suite.check(`${players}p: the list of actions replays to the same state`, () => {
    const config = { playerCount: players, seed: `replay-${players}`, variants: { maxTurnsPerPlayer: 30 } };
    const played = playGame(config);
    const replayed = replayGame(config, played.actions);
    assert.equal(isGameOver(replayed), true);
    assert.equal(hashState(replayed), hashState(played.state));
    assert.deepEqual(replayed, played.state);
  });

  suite.check(`${players}p: bot randomness never changes the game's own shuffles`, () => {
    const config = { playerCount: players, seed: `streams-${players}`, variants: { gridLayout: 'shuffle-resources' } };
    const a = playGame(config, { botSeed: 'one', stopAfter: 60 });
    const b = playGame(config, { botSeed: 'two', stopAfter: 60 });
    // Different bots, so different play ...
    assert.notDeepEqual(a.actions, b.actions);
    // ... but the same seating, the same grid, and the game RNG in the same place.
    assert.deepEqual(a.state.players.map((p) => p.configIndex), b.state.players.map((p) => p.configIndex));
    assert.deepEqual(a.state.grid.tiles, b.state.grid.tiles);
    assert.deepEqual(a.state.rng, b.state.rng);
  });
}

suite.check('replay and determinism hold under the variants that change how a game is played', () => {
  const sets = [
    { turnStructure: 'rounds', maxTurnsPerPlayer: 30 },
    { claimFrom: 'network', layTrackClaims: 'per-railhead', maxTurnsPerPlayer: 30 },
    { congressTable: 'jan-2026', scoringCard: 'random', maxTurnsPerPlayer: 30 },
  ];
  for (const [i, variants] of sets.entries()) {
    const config = { playerCount: 3, seed: `t8-det-${i}`, variants };
    const a = playGame(config, { botSeed: 'x' });
    const b = playGame(config, { botSeed: 'x' });
    assert.equal(hashState(a.state), hashState(b.state));
    const replayed = replayGame(config, a.actions);
    assert.equal(hashState(replayed), hashState(a.state));
    assert.deepEqual(replayed, a.state);
    const recreated = replayGame(getGameConfig(a.state), a.actions);
    assert.equal(hashState(recreated), hashState(a.state));
  }
});

suite.check('createGame does not advance or keep the RNG it is given', () => {
  const rng = makeRng('given');
  const before = rng.s;
  const a = createGame({ playerCount: 3 }, { rng });
  assert.equal(rng.s, before, 'the caller RNG must not be advanced');
  const b = createGame({ playerCount: 3 }, { rng });
  assert.equal(hashState(a), hashState(b));
  assert.notEqual(a.rng, rng, 'the state must hold its own copy');
});

suite.check('getGameConfig recreates a game from its own state, however it was seeded', () => {
  const players = [{ name: 'Anna', colour: '#a00' }, { name: 'Ben' }, { name: 'Cara' }];
  const settings = { variants: { maxTurnsPerPlayer: 20, gridLayout: 'shuffle-resources' }, constants: { HATS: { hatLimit: 3 } } };
  for (const make of [
    () => createGame({ players, seed: 'recreate', ...settings }),
    () => createGame({ players, ...settings }, { rng: makeRng('given-rng') }),
  ]) {
    const played = playGame(null, { state: make(), botSeed: 'r' });
    // From the final state alone (after a save), plus the actions taken.
    const saved = JSON.parse(JSON.stringify(played.state));
    const config = getGameConfig(saved);
    assert.deepEqual(config.players, [{ name: 'Anna', colour: '#a00' }, { name: 'Ben', colour: null }, { name: 'Cara', colour: null }]);
    const again = replayGame(config, played.actions);
    assert.equal(hashState(again), hashState(played.state));
    assert.deepEqual(again.players.map((p) => p.name), played.state.players.map((p) => p.name));
    assert.deepEqual(getGameConfig(again), config);
  }
});

suite.check('createGame refuses to start without a seed', () => {
  assert.throws(() => createGame({ playerCount: 2 }), /seed/);
});

suite.check('the RNG is a plain JSON value and repeats from its state', () => {
  const rng = makeRng(42);
  rngNext(rng);
  const saved = JSON.parse(JSON.stringify(rng));
  const next = [rngNext(rng), rngNext(rng), rngNext(rng)];
  assert.deepEqual([rngNext(saved), rngNext(saved), rngNext(saved)], next);
  for (const x of next) assert.ok(x >= 0 && x < 1);
  assert.deepEqual(shuffle(makeRng(7), [1, 2, 3, 4, 5, 6]), shuffle(makeRng(7), [1, 2, 3, 4, 5, 6]));
  assert.notDeepEqual(forkRng(makeRng(1)), forkRng(makeRng(2)));
});

suite.check('hashState is stable under cloneState and a JSON round trip, and moves when the state moves', () => {
  const { state } = playGame({ playerCount: 4, seed: 'hash' }, { stopAfter: 150 });
  const h = hashState(state);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(hashState(cloneState(state)), h);
  assert.equal(hashState(JSON.parse(JSON.stringify(state))), h);
  const moved = cloneState(state);
  moved.players[0].coins += 1;
  assert.notEqual(hashState(moved), h);
  const next = cloneState(state);
  applyAction(next, getValidActions(next)[0]);
  assert.notEqual(hashState(next), h);
});

suite.check('determinise reshuffles only what is hidden (the three Pony Express decks) and leaves the original alone', () => {
  const { state } = playGame({ playerCount: 3, seed: 'hidden', variants: { endGameScoring: 'both' } }, { stopAfter: 80 });
  const before = JSON.stringify(state);
  const copy = determinise(state, makeRng('bot'));
  assert.equal(JSON.stringify(state), before, 'determinise must not change the real state');
  assert.equal(hiddenDecks(copy).length, 3, 'the Pony Express decks are the only hidden orders of the game');
  for (const rank of ['A', 'B', 'C']) {
    assert.deepEqual(copy.modules.pony.decks[rank].slice().sort(), state.modules.pony.decks[rank].slice().sort(), 'the same cards');
  }
  assert.notDeepEqual(copy.modules.pony.decks, state.modules.pony.decks, 'the hidden orders change');
  assert.notDeepEqual(copy.rng, state.rng, 'the game RNG is hidden too');
  // Everything open is identical: the market, the tokens, what players hold, the other modules.
  const strip = (s) => ({ ...s, rng: null, modules: { ...s.modules, pony: { ...s.modules.pony, decks: null } } });
  assert.deepEqual(strip(copy), strip(state));
  assert.deepEqual(copy.modules.pony.market, state.modules.pony.market);
  // Same bot seed, same determinisation.
  assert.deepEqual(determinise(state, makeRng('bot')), copy);
  // A module that is off has no deck to hide.
  const off = playGame({ playerCount: 3, seed: 'hidden', variants: { modulePonyExpress: false } }, { stopAfter: 80 }).state;
  assert.equal(hiddenDecks(off).length, 0);
  assert.deepEqual(determinise(off, makeRng('bot')).modules, off.modules);
});

suite.check('the contract convention holds for any module: every array under a `decks` key is reshuffled, nothing else', () => {
  const state = createGame({ playerCount: 2, seed: 'convention', variants: { modulePonyExpress: false } });
  state.modules.testModule = { decks: { A: Array.from({ length: 30 }, (_, i) => `card-${i}`) }, open: [1, 2, 3] };
  const copy = determinise(state, makeRng('bot'));
  assert.equal(hiddenDecks(copy).length, 1);
  assert.notDeepEqual(copy.modules.testModule.decks.A, state.modules.testModule.decks.A);
  assert.deepEqual(copy.modules.testModule.open, [1, 2, 3]);
});

suite.check('the modules are part of the hash: a change to ANY module field changes hashState', () => {
  const { state } = playGame(
    { playerCount: 3, seed: 'hash-modules', variants: { endGameScoring: 'both', legislativeAgendaCard: 10 } },
    { stopAfter: 150 },
  );
  const h = hashState(state);
  const changes = {
    'upgrades.display': (s) => s.modules.upgrades.display.pop(),
    'upgrades.installed': (s) => { s.modules.upgrades.installed[0][0] = 'U1-vp'; },
    'milestones.inPlay': (s) => s.modules.milestones.inPlay.pop(),
    'milestones.claimedBy': (s) => { s.modules.milestones.claimedBy[s.modules.milestones.inPlay[0]] = 1; },
    'goals.inPlay': (s) => s.modules.goals.inPlay.pop(),
    'legislative.card': (s) => { s.modules.legislative.card = 'LA11'; },
    'legislative.used': (s) => { s.modules.legislative.used.LA10 = true; },
    'pony.decks': (s) => s.modules.pony.decks.A.reverse(),
    'pony.market': (s) => { s.modules.pony.market.B[0] = null; },
    'pony.tokens': (s) => { s.modules.pony.tokens.SPO = !s.modules.pony.tokens.SPO; },
    'pony.players.tokensHeld': (s) => { s.modules.pony.players[1].tokensHeld += 1; },
    'pony.players.tokensCollected': (s) => { s.modules.pony.players[1].tokensCollected += 1; },
    'pony.players.ongoing': (s) => s.modules.pony.players[0].ongoing.push('PX14'),
    'pony.players.endgame': (s) => s.modules.pony.players[0].endgame.push('PX31'),
    'pony.turn.purchases': (s) => { s.modules.pony.turn.purchases += 1; },
    'pony.turn.usedCards': (s) => s.modules.pony.turn.usedCards.push('PX14'),
    'pony.turn.doubled': (s) => { s.modules.pony.turn.doubled = 'crew'; },
    'pony.roundUsed': (s) => s.modules.pony.roundUsed.push('PX28'),
    'player.vp.upgrades': (s) => { s.players[0].vp.upgrades += 1; },
  };
  for (const [name, change] of Object.entries(changes)) {
    const copy = cloneState(state);
    change(copy);
    assert.notEqual(hashState(copy), h, `${name} is not in the hash`);
  }
  // And every key of state.modules is covered by this table.
  for (const id of Object.keys(state.modules)) {
    assert.ok(Object.keys(changes).some((k) => k.startsWith(id)), `module ${id} has no hash check`);
  }
});

for (const players of [2, 3, 4]) {
  suite.check(`${players}p, all modules on: the same seed, the same game; the action list replays; bot randomness never changes the module setup`, () => {
    const variants = { endGameScoring: 'both', goalsInPlay: 5, milestonesInPlay: 7 };
    const config = { playerCount: players, seed: `det-modules-${players}`, variants };
    const a = playGame(config, { botSeed: 'A' });
    const b = playGame(config, { botSeed: 'A' });
    assert.deepEqual(a.actions, b.actions);
    assert.equal(hashState(a.state), hashState(b.state));
    const replayed = replayGame(getGameConfig(a.state), a.actions);
    assert.equal(hashState(replayed), hashState(a.state));
    const c = playGame(config, { botSeed: 'C' });
    assert.deepEqual(c.state.modules.legislative.card, a.state.modules.legislative.card, 'the agenda card comes from the game seed, not from the bots');
    assert.deepEqual(c.state.modules.goals, a.state.modules.goals);
    assert.deepEqual(c.state.modules.milestones.inPlay, a.state.modules.milestones.inPlay);
    // Setup (before the first action) does not depend on the bots at all, and the module setup is part of it.
    const s1 = createGame(config);
    const s2 = createGame(config);
    assert.deepEqual(s1.modules, s2.modules);
    assert.equal(s1.modules.milestones.inPlay.length, 7);
    assert.equal(s1.modules.goals.inPlay.length, 5);
  });
}

suite.finish();
