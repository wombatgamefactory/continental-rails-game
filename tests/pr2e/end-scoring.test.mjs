// end-scoring.test.mjs - Pacific Rails, second edition: the end of the game (P19),
// final scoring and tie-breaks (P20), variants and constants (P21).
//
// Semantics: permanently green; exits 1 on any failure.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { E, start, act, setStorage, layRoutes, build, setTrains, clearGrid } from './rig.mjs';

const suite = makeSuite('pr2e end-scoring');

/** The active player (on Bismarck with 2 Ground and 1 Bridge, Seattle to Bismarck laid) lays Bismarck - Fargo - Minneapolis (3 slots, 9 VP). */
function completeLine(state, pid) {
  clearGrid(state);
  layRoutes(state, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIS']);
  setTrains(state, pid, ['BIS', 'LAX']);
  setStorage(state, pid, { ground: 2, bridge: 1 });
  act(state, { type: 'placeWorker', space: 'W4' });
  act(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' });
  let top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path === null) act(state, { type: 'startLay', train: 0 });
  top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path.routes.length === 0) act(state, { type: 'extendPath', route: 'FAR-BIS' });
  top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path.routes.length === 1) act(state, { type: 'extendPath', route: 'FAR-MIN' });
  top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path !== null) act(state, { type: 'endLay' });
}

function playOut(state, seed = 'out') {
  const rng = E.makeRng(seed);
  for (let n = 0; !E.isGameOver(state); n++) {
    assert.ok(n < 20000, 'the game did not end');
    act(state, E.rngPick(rng, E.getValidActions(state)));
  }
  return state;
}

// ---------------------------------------------------------------------------
// P19 - the end
// ---------------------------------------------------------------------------

suite.check('P19.5: the safety stop ends a game after maxTurnsPerPlayer turns each, with end reason turn-limit; equal turns', () => {
  const state = playOut(start(3, { variants: { maxTurnsPerPlayer: 5 } }));
  assert.equal(state.gameEnd.reason, 'turn-limit');
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [5, 5, 5]);
  assert.equal(E.scoreGame(state).final, true);
});

suite.check('P19.3: the end triggered on the last seat\'s own turn ends the game when that turn ends', () => {
  const state = start(2);
  // Anna plays a turn, then Ben (the last seat) completes the line.
  const rng = E.makeRng('p19');
  while (state.turn.player === 0) act(state, E.rngPick(rng, E.getValidActions(state)));
  completeLine(state, 1);
  assert.equal(E.isGameOver(state), true, 'the game ended with Ben\'s turn');
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [1, 1]);
  assert.equal(state.gameEnd.reason, 'transcontinental');
});

suite.check('P19.2: the completion VP are paid once; a later line scores nothing extra', () => {
  const state = start(3);
  layRoutes(state, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIS', 'FAR-BIS', 'FAR-MIN']);
  state.completion = { player: 2, turn: 0, route: 'FAR-MIN', routes: ['FAR-BIS', 'FAR-MIN'], slots: 3 };
  state.gameEnd = { reason: 'transcontinental', triggeredBy: 2, triggeredOnTurn: 0 };
  // Another line: Los Angeles - San Bernardino - Las Vegas - Phoenix - Santa Fe - El Paso - Amarillo - Abilene - Fort Worth, Anna lays the last route.
  layRoutes(state, ['LAX-SBD', 'SBD-LVG', 'LVG-PHX', 'SFE-PHX', 'SFE-ELP', 'ELP-AMA', 'AMA-ABI']);
  setTrains(state, 0, ['ABI', 'SEA']);
  setStorage(state, 0, { tunnel: 1 });
  const r = E.evaluateLay(state, 0, ['ABI', 'FTW'], ['ABI-FTW']);
  assert.equal(r.completes, false);
  assert.equal(r.trackVp, 1, 'ordinary track VP (a start city: 1 per slot)');
});

suite.check('P19.2 with P19.5: a first line completed after the turn limit has triggered the end still pays, and the reason stays', () => {
  const state = start(2, { variants: { maxTurnsPerPlayer: 1 } });
  const rng = E.makeRng('p19b');
  while (state.turn.player === 0) act(state, E.rngPick(rng, E.getValidActions(state)));
  assert.equal(state.gameEnd.reason, 'turn-limit');
  completeLine(state, 1);
  assert.equal(state.players[1].vp.completion, 9);
  assert.equal(state.gameEnd.reason, 'turn-limit');
  assert.equal(E.isGameOver(state), true);
});

// ---------------------------------------------------------------------------
// P20 - final scoring
// ---------------------------------------------------------------------------

suite.check('P20.2, P20.3: buildings from the table (district houses do not count), 1 VP per built tile; nothing else scores', () => {
  const state = start(2, { variants: { maxTurnsPerPlayer: 1 } });
  const table = E.getConstants(state).SCORING.buildingTable;
  assert.deepEqual(table, [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87]);
  assert.equal(E.buildingTableVp(state, 14), 69, '11 railway stations and 3 telegraph stations: 69 VP (P20.3)');
  for (const city of ['SPO', 'REN', 'HEL']) build(state, 'railwayStation', city, 0);
  build(state, 'telegraphStation', 'BOI', 0);
  state.grid.sites.D1[0] = 0; // a district house: not a building
  state.players[0].houses.coins -= 1;
  setStorage(state, 0, { ground: 1, tunnel: 1, coins: 3 });
  const live = E.scoreGame(state);
  assert.equal(live.final, false);
  assert.equal(live.players[0].bySource.buildingsEnd, table[4]);
  assert.equal(live.players[0].bySource.tilesEnd, 2);
  const goalVp = E.goalsInPlay(state).reduce((a, g) => a + E.goalStandings(state, g).awards[0], 0);
  assert.equal(live.players[0].bySource.goals, goalVp, 'P20.2.3: the goals as they stand');
  playOut(state, 'p20');
  const score = E.scoreGame(state);
  const p = score.players[0];
  assert.equal(p.bySource.buildingsEnd, table[E.buildingCount(state, 0)]);
  const t = state.players[0].builtTiles;
  assert.equal(p.bySource.tilesEnd, t.ground + t.tunnel + t.bridge);
  assert.equal(Object.values(p.bySource).reduce((a, b) => a + b, 0), p.total);
});

suite.check('P20.4: ties broken by district houses, then buildings; still tied, the victory is shared', () => {
  const state = start(3, { variants: { maxTurnsPerPlayer: 1 } });
  playOut(state, 'tie');
  // Make all three equal on VP by hand, then vary the tie-breaks.
  for (const p of state.players) for (const k in p.vp) p.vp[k] = 0;
  for (const p of state.players) p.vp.track = 10;
  for (const d in state.grid.sites) state.grid.sites[d] = [null, null, null];
  for (const c of E.MAP.inlandCities) {
    state.map.railwayStation[c] = null;
    state.map.telegraphStation[c] = null;
  }
  let score = E.scoreGame(state);
  assert.equal(score.decidedBy, 'shared');
  assert.deepEqual(score.winners, [0, 1, 2]);
  assert.deepEqual(score.players.map((p) => p.rank), [1, 1, 1]);
  assert.equal(score.winner, score.ranking[0]);
  state.map.railwayStation.SPO = 2;
  score = E.scoreGame(state);
  assert.equal(score.decidedBy, 'buildings');
  assert.deepEqual(score.winners, [2]);
  state.grid.sites.D3[0] = 1;
  score = E.scoreGame(state);
  assert.equal(score.decidedBy, 'districtHouses', 'district houses come first (P20.4.1)');
  assert.deepEqual(score.winners, [1]);
  assert.deepEqual(score.players.map((p) => p.rank), [3, 1, 2]);
});

// ---------------------------------------------------------------------------
// P21 - variants and constants
// ---------------------------------------------------------------------------

suite.check('P21.1: the eight variants by name, with the ruled defaults; unknown names and values are refused', () => {
  assert.deepEqual(E.defaultVariants(), {
    tycoonMode: false,
    layShape: 'path',
    newConnectionRule: 'any-unlaid-route',
    arrivalBuilding: 'compulsory-if-able',
    upgradePlacement: 'first-free',
    hatOverflow: 'resource',
    maxTurnsPerPlayer: 80,
    wildSlotTerrain: 'tile-terrain',
  });
  assert.equal(E.VARIANTS.length, 8);
  assert.throws(() => E.resolveVariants({ wildSlotTerrain: 'any' }), /Illegal value "any" for variant "wildSlotTerrain"/);
  assert.equal(E.resolveVariants({ wildSlotTerrain: 'no-terrain' }).wildSlotTerrain, 'no-terrain');
  assert.throws(() => E.resolveVariants({ conversionRate: '1:1' }), /Unknown variant "conversionRate"/);
  assert.throws(() => E.resolveVariants({ layShape: 'zigzag' }), /Illegal value "zigzag" for variant "layShape"/);
  assert.throws(() => E.resolveVariants({ maxTurnsPerPlayer: '30' }), /Illegal value/);
  assert.equal(E.parseVariantValue('tycoonMode', 'true'), true);
  assert.equal(E.parseVariantValue('maxTurnsPerPlayer', '30'), 30);
  assert.deepEqual(E.nonDefaultVariants(E.resolveVariants({ tycoonMode: true })), { tycoonMode: true });
  assert.deepEqual(E.activeModules(E.defaultVariants()), { upgrades: false, milestones: false, goals: false, legislative: false, pony: false });
  for (const def of E.VARIANTS) assert.match(def.rule, /^P\d/);
});

suite.check('P21.2: every constant is named data; overrides are recorded and reach the rules', () => {
  for (const path of Object.keys(E.P21_2_CONSTANTS)) {
    const [group] = path.split('.');
    assert.ok(E.RULES[group], `group ${group} of ${path}`);
  }
  const state = start(2, { constants: { MAP_RULES: { tollVp: 5 }, PLAYER_BOARD: { boardStorage: 8 } } });
  assert.equal(E.storageCapacity(state, 0), 8);
  assert.deepEqual(E.getGameConfig(state).constants, { MAP_RULES: { tollVp: 5 }, PLAYER_BOARD: { boardStorage: 8 } });
  assert.throws(() => start(2, { constants: { MAP_RULES: { tollVP: 5 } } }), /Unknown constant "MAP_RULES.tollVP"/);
  assert.throws(() => start(2, { constants: { MAP_RULES: { tollVp: 'x' } } }), /must be a number/);
  // The toll override is used.
  const s2 = start(3, { constants: { MAP_RULES: { tollVp: 5 } } });
  layRoutes(s2, ['TDL-POR']);
  build(s2, 'railwayStation', 'TDL', 1);
  const r = E.evaluateLay(s2, 0, ['POR', 'TDL', 'SPO'], ['TDL-POR', 'SPO-TDL']);
  assert.equal(r.tollVp, 5);
});

suite.check('P21.2: SETUP.housesPerPlayer and SUPPLY.senators drive the setup (houses left after the +1 choice; columns on the Congress panel)', () => {
  const ten = start(2, { constants: { SETUP: { housesPerPlayer: 10 } }, production: 'wood' });
  assert.equal(E.housesOnBoard(ten.players[0]), 10);
  assert.equal(ten.players[0].houses.wood, 1, 'both houses leave the chosen track first');
  assert.equal(E.housesOnBoard(start(2).players[0]), 11, 'the printed 11');
  const six = start(2, { constants: { SUPPLY: { senators: 6 } } });
  assert.deepEqual(Object.keys(six.congress.down), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.deepEqual(E.congressColumns(six).map((c) => c.id), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'KR']);
  assert.match(E.getStructuralBlockReason(six, { type: 'takeCongressColumn', column: 'K7', player: 0 }), /not on the Congress panel in this game: it has 6 senators/);
});

suite.check('serialised states name their ruleset: a pr2e save is refused by nothing else and refuses a foreign state', () => {
  const state = start(2);
  assert.equal(state.rules, 'pr2e');
  const text = E.serialiseState(state);
  assert.equal(E.hashState(E.deserialiseState(text)), E.hashState(state));
  const foreign = JSON.parse(text);
  delete foreign.rules;
  assert.throws(() => E.deserialiseState(JSON.stringify(foreign)), /not a Pacific Rails, second edition state/);
});

suite.finish();
