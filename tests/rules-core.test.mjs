// rules-core.test.mjs - the core rules, one or more behavioural checks each.
//
// Semantics: permanently green; exits 1 on any failure.
//
// Covered here (the rules tests/contract.test.mjs does not already cover):
//   R4.6.2, R4.6.3, R4.8   which districts can be chosen; rounds
//   R8.8, R9               train activation: the step list, the recipes, use or skip
//   R10                    Lobby Congress: lobby points, entries, senators, Reset, both tables
//   R11, R12               Lay Tracks / Move Train: claims, steps, moves, paths and tolls
//   R11.11                 claimFrom = network
//   R13                    railway stations and telegraph stations
//   R19.1, R19.2, R19.7    the transcontinental line and its bonus
//   R20.1                  VP by source
//   Worked examples E5, E6, E7, E8 and E10 of spec R22, with their numbers.
//
// Expected numbers are read from rules.js. A state is built with createGame
// and adjusted by hand; the action under test always goes through applyAction.

import assert from 'node:assert/strict';
import {
  getValidActions,
  getBlockReason,
  getStructuralBlockReason,
  getDistrictActionBlockReason,
  getActionSpace,
  cloneState,
  scoreGame,
  isGameOver,
  topFrame,
  production,
  storageUsed,
  moveTrainPath,
  hasTranscontinentalLine,
  nextTelegraphVp,
  buildingCount,
  ownedSlots,
  railwayStationCount,
  describeAction,
  describeDecision,
  RULES,
  MAP,
  STOP_ACTION_TYPES,
  UNIMPLEMENTED_VARIANT_VALUES,
} from '../src/engine/index.js';
import { makeSuite, drive } from './helpers/play.mjs';
import {
  start,
  put,
  act,
  types,
  eventOf,
  eventsOf,
  vpBySource,
  choose,
  placeAndChoose,
  take,
  setHeads,
  give,
  setTrain,
  claim,
} from './helpers/rig.mjs';

const suite = makeSuite('rules-core');
const K = RULES;

/** Anna takes a district through a worker space (the engine chooses the district if only one can be). */
function turnAt(state, space, district, hat = false) {
  return placeAndChoose(state, space, district, hat);
}

/** Takes `useStep` or `skipStep` (or whatever `pick` returns) until the top decision is no longer a use-or-skip step. */
function runSteps(state, pick = 'useStep') {
  const events = [];
  while (topFrame(state) !== null && topFrame(state).kind === 'trainActivation' && !topFrame(state).congress) {
    const actions = getValidActions(state);
    const chosen = actions.find((a) => a.type === pick) ?? actions.find((a) => a.type === 'skipStep');
    events.push(...act(state, chosen));
  }
  return events;
}

/** A fixed-order list of the steps of an activation frame: 'engineer@0' is the Foreman acting as an Engineer. */
function stepList(frame) {
  return frame.steps.map((s) => `${s.type}@${s.level}`);
}

// =============================================================================
// R4.6, R9.1, R9.2 - which districts, and what the Foreman is
// =============================================================================

suite.check('R4.6.2, R9.1, R9.2: a train activation can always be chosen, and the Foreman takes the district\'s type', () => {
  const cases = [
    ['W8', 'D4', 'crew'],
    ['W11', 'D8', 'miner'],
    ['W5', 'D6', 'engineer'],
    ['W1', 'D2', 'financier'],
  ];
  for (const [space, district, foreman] of cases) {
    const state = start(3);
    give(state, 0, { resources: {}, coins: 0 }); // nothing at all: every step is unpayable
    setTrain(state, 0, [[null, null]]);
    assert.equal(getDistrictActionBlockReason(state, 0, district), null, `${district} is always choosable`);
    const events = turnAt(state, space, district);
    const started = eventOf(events, 'trainActivation');
    assert.equal(started.foreman, foreman, `R9.2: ${district}`);
    assert.equal(started.steps, 1, 'only the Foreman, once (M = 1)');
    assert.equal(state.turn.player, 1, 'with nothing to pay with, the whole activation was automatic');
  }
});

suite.check('R4.6.3: Lay Tracks / Move Train can be chosen only with a legal claim or move, and the reason says why', () => {
  const state = start(3);
  setHeads(state, 0, 'SEA', 'MIN');
  give(state, 0, { tiles: {} });
  const reason = getDistrictActionBlockReason(state, 0, 'D5');
  assert.match(
    reason,
    /Lay Tracks \/ Move Train needs a legal claim or move, and you have neither: your railheads stand on Seattle or Minneapolis; the shortest unclaimed route there is Seattle - Spokane, which needs 2 Ground in built tiles, and you hold 0 of the 2 built Ground you need; and no claimed route touches your railheads/,
  );
  // W6 lies between Ground Tracks and Lay Tracks: the engine takes the only district that can be chosen.
  const events = act(state, { type: 'placeWorker', space: 'W6' });
  assert.equal(eventOf(events, 'districtChosen').district, 'D4');
  // With the tiles for Seattle - Spokane (two Ground) Lay Tracks can be chosen.
  const ready = start(3);
  setHeads(ready, 0, 'SEA', 'MIN');
  give(ready, 0, { tiles: { ground: 2 } });
  assert.equal(getDistrictActionBlockReason(ready, 0, 'D5'), null);
  act(ready, { type: 'placeWorker', space: 'W6' });
  assert.deepEqual(getValidActions(ready).map((a) => `${a.district}:${a.hat}`), ['D4:false', 'D5:false']);
  // A route that is claimed by anybody makes a move possible, even with no tiles.
  const mover = start(3);
  setHeads(mover, 0, 'SEA', 'MIN');
  claim(mover, 1, 'SEA-SPO');
  assert.equal(getDistrictActionBlockReason(mover, 0, 'D5'), null, 'R12.2: a chain of claimed routes of any owner');
});

// =============================================================================
// R8.8, R9 - train activation
// =============================================================================

suite.check('R8.8, R9.4.3, R9.7: every conversionRate pays its recipe for one built tile; the Foreman always matches', () => {
  for (const rate of Object.keys(K.TRAIN.recipes)) {
    const recipes = K.TRAIN.recipes[rate];
    const cases = [
      ['W8', 'D4', 'crew'],
      ['W11', 'D8', 'miner'],
      ['W5', 'D6', 'engineer'],
    ];
    for (const [space, district, who] of cases) {
      const state = start(2, { variants: { conversionRate: rate } });
      give(state, 0, { resources: { iron: 3, wood: 3, gunpowder: 3 } });
      setTrain(state, 0, [[null, null]]); // R9.7: no specialist at all, the Foreman builds
      turnAt(state, space, district);
      assert.equal(topFrame(state).kind, 'trainActivation');
      assert.equal(getBlockReason(state, { type: 'useStep' }), null);
      const recipe = recipes[who];
      const events = take(state, 'useStep');
      const before = { iron: 3, wood: 3, gunpowder: 3 };
      for (const key of Object.keys(recipe.cost)) before[key] -= recipe.cost[key];
      assert.deepEqual(state.players[0].resources, before, `${rate}: ${who} pays ${JSON.stringify(recipe.cost)}`);
      assert.equal(state.players[0].builtTiles[recipe.output], 1, `${rate}: ${who} makes one ${recipe.output} tile`);
      assert.equal(eventOf(events, 'build').terrain, recipe.output);
      assert.equal(state.turn.player, 1, 'the activation is over: nothing is put on the map (R9.6)');
      assert.equal(claimedCount(state), 0);
    }
  }
});

function claimedCount(state) {
  return Object.values(state.map.routeOwner).filter((o) => o !== null).length;
}

suite.check('R8.8: a step that cannot be paid cannot be used, and the engine skips it by itself', () => {
  // Two Iron pay for one Crew step at 2:1. Foreman, then a Crew: the Foreman can be used, the Crew then cannot.
  const state = start(2);
  give(state, 0, { resources: { iron: 2, wood: 0, gunpowder: 0 } });
  setTrain(state, 0, [['crew', null]]);
  turnAt(state, 'W8', 'D4');
  assert.deepEqual(types(state), ['skipStep', 'useStep']);
  assert.equal(describeAction(state, { type: 'useStep' }), 'Use your Foreman (acting as a Crew): pay 2 Iron for 1 built Ground tile');
  assert.equal(describeAction(state, { type: 'skipStep' }), 'Skip your Foreman (acting as a Crew)');
  const events = take(state, 'useStep');
  assert.equal(state.players[0].resources.iron, 0);
  // The Crew in the carriage has nothing to pay with: the engine skipped it.
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep'));
  assert.equal(state.turn.player, 1);
  // With nothing to pay with at all, the whole activation is automatic.
  const poor = start(2);
  give(poor, 0, { resources: { iron: 1, wood: 1, gunpowder: 1 } });
  setTrain(poor, 0, [['miner', 'engineer']]);
  const run = turnAt(poor, 'W11', 'D8');
  assert.equal(poor.turn.player, 1);
  assert.equal(run.filter((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep').length, 3);
  // The sentence for a step that cannot be paid names the cost and the holding. The Foreman can pay
  // here, the Miner behind it cannot: skipping the first leaves the engine to skip the second.
  const iron = start(2, { variants: { conversionRate: 'iron-in-all' } });
  give(iron, 0, { resources: { iron: 2, wood: 0, gunpowder: 0 } });
  setTrain(iron, 0, [['miner', null]]);
  turnAt(iron, 'W8', 'D4'); // the Foreman as a Crew pays 2 Iron: a real choice
  assert.equal(getBlockReason(iron, { type: 'useStep' }), null);
  assert.match(
    getBlockReason(iron, { type: 'takeCongressEntry', entry: 'C1' }),
    /Entry C1 is tier 1, which takes 1 lobby point, and you hold 0/,
  );
  take(iron, 'skipStep');
  assert.equal(iron.turn.player, 1, 'the Miner needs a Gunpowder she does not have');
});

suite.check('E5 (R22): the step list of a train activation, M = 2, use and skip; nothing reaches the map', () => {
  const state = start(4);
  const eve = state.players[0];
  setTrain(state, 0, [['engineer', 'crew'], ['engineer', null]]);
  // The spec's U1-wood tile (a module) would add 1 Wood at step 5; its Wood is given up front instead,
  // so the numbers of E5 come out the same: 5 + 1 Wood, 2 Iron.
  give(state, 0, { resources: { iron: 2, wood: 6, gunpowder: 0 } });
  put(state, 0, 'W10'); // between Bridge Tracks and Gather Coins
  const events = turnAt(state, 'W7', 'D6'); // M = 1 + 1
  assert.equal(eventOf(events, 'districtChosen').multiplier, 2);
  const frame = topFrame(state);
  assert.equal(frame.kind, 'trainActivation');
  assert.equal(frame.foreman, 'engineer');
  assert.deepEqual(stepList(frame), [
    'engineer@0', 'engineer@0', // the Foreman, twice (M = 2)
    'engineer@1', 'crew@1', // level 1 carriage: slot 1, slot 2
    'engineer@2', // level 2 carriage: the Engineer acts once, like every specialist (R9.3)
  ]);
  const run = runSteps(state, 'useStep');
  assert.deepEqual(eve.builtTiles, { ground: 1, tunnel: 0, bridge: 3 });
  assert.deepEqual(eve.resources, { iron: 0, wood: 0, gunpowder: 0 });
  assert.equal(storageUsed(eve), 4, '3 Bridge and 1 Ground');
  const skipped = run.filter((x) => x.type === 'action' && x.auto && x.action.type === 'skipStep');
  assert.equal(skipped.length, 1, 'the level 2 Engineer has no Wood: its step was skipped by the engine');
  assert.equal(eventsOf(run, 'build').length, 4);
  assert.equal(claimedCount(state), 0, 'R9.6: nothing has been put on the map');
  assert.equal(state.turn.player, 1);
});

suite.check('R9.3: specialistActivations = once makes every specialist act once; by-level is 1, 2, 3', () => {
  for (const mode of ['by-level', 'once']) {
    const state = start(2, { variants: { specialistActivations: mode } });
    setTrain(state, 0, [['crew', 'miner'], ['crew', 'miner'], ['crew', 'miner']]);
    give(state, 0, { resources: { iron: 9, wood: 0, gunpowder: 0 } });
    turnAt(state, 'W8', 'D4');
    const perLevel = mode === 'once' ? [1, 1, 1] : K.TRAIN.activationsByLevel;
    const expected = ['crew@0'];
    perLevel.forEach((times, i) => {
      for (const t of ['crew', 'miner']) for (let n = 0; n < times; n++) expected.push(`${t}@${i + 1}`);
    });
    assert.deepEqual(stepList(topFrame(state)), expected, mode);
  }
});

suite.check('R9.5: a skipped step cannot be taken later; gains pay for later steps', () => {
  const state = start(2);
  setTrain(state, 0, [['crew', null]]);
  give(state, 0, { resources: { iron: 4, wood: 0, gunpowder: 0 }, coins: 5 });
  turnAt(state, 'W8', 'D4');
  take(state, 'skipStep'); // the Foreman: skipped
  assert.equal(state.players[0].resources.iron, 4);
  take(state, 'useStep'); // the Crew
  assert.deepEqual(state.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
  assert.equal(state.turn.player, 1, 'no step list entry is revisited');
});

suite.check('R8.5.4: using a step never overflows storage, since a recipe pays at least what it makes', () => {
  const state = start(2, { variants: { conversionRate: '1:1' } });
  setTrain(state, 0, [[null, null]]);
  give(state, 0, { resources: { iron: 9, wood: 0, gunpowder: 0 } });
  turnAt(state, 'W8', 'D4');
  take(state, 'useStep'); // 1 Iron becomes 1 tile: still 9 of 9
  assert.equal(state.turn.player, 1);
  assert.equal(storageUsed(state.players[0]), 9);
});

suite.check('auto-advance: a forced use-or-skip is applied by the engine, so a decision always has two or more actions', () => {
  const state = start(3);
  setTrain(state, 0, [['crew', 'crew']]);
  give(state, 0, { resources: { iron: 3, wood: 0, gunpowder: 0 } });
  const events = turnAt(state, 'W8', 'D4');
  // Foreman: 2 Iron available -> a real choice.
  assert.deepEqual(types(state), ['skipStep', 'useStep']);
  const after = take(state, 'useStep');
  // Iron 1: both Crews cannot pay; both were skipped automatically.
  assert.equal(after.filter((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep').length, 2);
  assert.ok(STOP_ACTION_TYPES.includes('skipStep'));
  assert.ok(events.length > 0);
  assert.equal(state.turn.player, 1);
});

// =============================================================================
// R10 - Lobby Congress
// =============================================================================

/** Anna at Lobby Congress with the given carriages and Coins, M = 1, waiting at her first window or step. */
function congressTurn(carriages, coins, options = {}) {
  const state = start(options.players ?? 3, { variants: options.variants });
  setTrain(state, 0, carriages);
  give(state, 0, { resources: options.resources ?? {}, coins });
  turnAt(state, 'W4', 'D2'); // between Lobby Congress and Lay Tracks; Lay Tracks cannot be chosen, so D2
  return state;
}

suite.check('E6 (R22): lobby points from the Foreman and a Financier buy entry C3; lobby points are kept between steps', () => {
  const state = congressTurn([['financier', 'miner']], 4);
  const finn = state.players[0];
  assert.deepEqual(stepList(topFrame(state)), ['financier@0', 'financier@1', 'miner@1']);
  // After the Foreman: 1 lobby point. C1 and C2 can be taken; Reset cannot (nothing is used).
  assert.equal(topFrame(state).lobby, K.CONGRESS.lobbyPointsPerFinancierStep);
  assert.deepEqual(getValidActions(state).map((a) => a.entry ?? a.type), ['C1', 'C2', 'closeCongress']);
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'CR' }), /Reset has nothing to return: no senator has been used yet/);
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C3' }), /Entry C3 is tier 2, which takes 2 lobby points, and you hold 1/);
  take(state, 'closeCongress');
  // After the Financier: 2 lobby points; C3 is now on offer.
  assert.equal(topFrame(state).lobby, 2);
  assert.ok(getValidActions(state).some((a) => a.entry === 'C3'));
  const events = take(state, 'takeCongressEntry', { entry: 'C3' });
  const c3 = K.CONGRESS.tables['design-2026-10'].find((e) => e.id === 'C3');
  assert.equal(finn.coins, 4 - c3.coinCost);
  assert.deepEqual(finn.resources, { iron: 0, wood: 0, gunpowder: 2 });
  assert.equal(finn.hats, 1);
  assert.equal(state.congress.used.C3, true, 'R10.2: the senator slid down');
  assert.equal(eventOf(events, 'congressEntry').entry, 'C3');
  assert.equal(topFrame(state).lobby, 0);
  // The Miner: pays 2 Gunpowder for a Tunnel tile.
  take(state, 'useStep');
  assert.equal(finn.builtTiles.tunnel, 1);
  assert.equal(finn.resources.gunpowder, 0);
  assert.equal(state.turn.player, 1);
  // R10.2: C3 stays used for everybody until a Reset.
  const ben = state.players[1];
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C3', player: 1 }), /Entry C3 is used: its senator is on the benefit tile/);
  assert.equal(ben.coins, K.SETUP.startingCoins);
});

suite.check('E6 (R22): the other way - C1 after the first lobby point and C2 after the second', () => {
  const state = congressTurn([['financier', 'miner']], 4);
  const finn = state.players[0];
  take(state, 'takeCongressEntry', { entry: 'C1' }); // tier 1, 1 Coin: 2 Wood
  assert.equal(finn.resources.wood, 2);
  // No lobby point is left, so the window closes by itself and the Financier step follows.
  assert.equal(topFrame(state).lobby, 1, 'the Financier step has run and given the second point');
  assert.equal(topFrame(state).index, 2);
  take(state, 'takeCongressEntry', { entry: 'C2' }); // 2 Iron
  assert.equal(finn.resources.iron, 2);
  assert.equal(finn.coins, 4 - 2 * K.CONGRESS.tables['design-2026-10'][0].coinCost);
  assert.deepEqual([state.congress.used.C1, state.congress.used.C2, state.congress.used.C3], [true, true, false]);
  // The Miner has no Gunpowder: skipped, and the turn ends.
  assert.equal(state.turn.player, 1);
});

suite.check('R10.3, R9.4.4: Financiers in any activation give lobby points; points unspent at the end are lost', () => {
  const state = start(3);
  setTrain(state, 0, [['financier', null]]);
  give(state, 0, { resources: { iron: 0, wood: 0, gunpowder: 0 }, coins: 0 });
  const events = turnAt(state, 'W8', 'D4'); // Ground Tracks: the Financier specialist still gives a lobby point
  assert.equal(eventsOf(events, 'lobbyPoint').length, 1, 'R10.3: a Financier in a track-district activation');
  const lost = eventOf(events, 'lobbyPointsLost');
  assert.equal(lost.amount, 1, 'with no Coins nothing could be taken, and the point is lost at the end');
  assert.equal(state.turn.player, 1);
});

/** Closes Congress windows until one is open with exactly `lobby` points in hand. */
function toWindow(state, lobby) {
  for (let i = 0; i < 20; i++) {
    const top = topFrame(state);
    if (top.kind === 'trainActivation' && top.congress && top.lobby === lobby) return;
    take(state, 'closeCongress');
  }
  throw new Error(`no Congress window with ${lobby} lobby points came up`);
}

suite.check('R10.4, R10.5: an entry costs lobby points equal to its tier AND Coins; the block reasons carry the numbers', () => {
  const c = K.CONGRESS.tables['design-2026-10'];
  const state = congressTurn([['financier', 'financier']], 1);
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C3' }), /Entry C3 is tier 2, which takes 2 lobby points, and you hold 1/);
  // Coins: 1 Coin pays for a tier 1 entry only.
  toWindow(state, 2);
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C3' }), /Entry C3 costs 2 Coins and you have 1/);
  assert.equal(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C2' }), null);
  take(state, 'takeCongressEntry', { entry: 'C2' });
  assert.equal(state.players[0].coins, 1 - c.find((e) => e.id === 'C2').coinCost);
  // Only the tier was spent: 2 points - 1 = 1 left, but with 0 Coins nothing more can be bought, so the window closed
  // and the point is lost at the end of the activation.
  assert.equal(state.turn.player, 1);
  assert.equal(state.players[0].coins, 0);
});

suite.check("R10.1 C4: a free carriage of the player's choice; the entry cannot be taken with a full train", () => {
  const state = congressTurn([['financier', 'financier']], 6);
  toWindow(state, 2);
  const events = take(state, 'takeCongressEntry', { entry: 'C4' });
  assert.equal(topFrame(state).kind, 'addCarriage', 'the choice is its own decision');
  assert.equal(state.players[0].coins, 6 - K.CONGRESS.tables['design-2026-10'].find((e) => e.id === 'C4').coinCost);
  assert.deepEqual(types(state), ['addCarriage']);
  assert.equal(describeDecision(state).prompt, 'Anna: add a carriage, a specialist or a storage carriage, for free');
  act(state, { type: 'addCarriage', carriage: 'storage' });
  assert.equal(state.players[0].train.storageCarriages, 2, 'R8.7: a storage carriage');
  assert.equal(state.players[0].resources.wood, 0, 'free: no Wood paid');
  assert.ok(events.some((e) => e.type === 'congressEntry' && e.entry === 'C4'));
  // A train with 3 of each kind cannot take the entry at all (R10.5).
  const full = congressTurn([['financier', 'financier']], 6);
  full.players[0].train.storageCarriages = K.TRAIN.maxStorageCarriages;
  full.players[0].train.specialistCarriages = [
    { slots: ['financier', 'financier'] },
    { slots: [null, null] },
    { slots: [null, null] },
  ];
  toWindow(full, 2);
  assert.match(getBlockReason(full, { type: 'takeCongressEntry', entry: 'C4' }), /C4 adds a carriage, and your train already has the most it can: 3 specialist carriages and 3 storage carriages/);
  assert.ok(!getValidActions(full).some((a) => a.entry === 'C4'));
  // With only one kind possible the engine chooses it.
  const one = congressTurn([['financier', 'financier']], 6);
  one.players[0].train.storageCarriages = K.TRAIN.maxStorageCarriages;
  toWindow(one, 2);
  take(one, 'takeCongressEntry', { entry: 'C4' });
  assert.equal(one.players[0].train.specialistCarriages.length, 2, 'only a specialist carriage was possible, so it was added');
});

suite.check('R10.1 C5 and C6, R13.6: the tier 3 entries - tiles of choice, then the buildings or 3 VP', () => {
  // Three lobby points: the Foreman and two level 1 Financiers.
  const mk = () => {
    const state = congressTurn([['financier', 'financier']], 6);
    toWindow(state, 3);
    return state;
  };
  const state = mk();
  assert.match(getBlockReason(congressTurn([['financier', 'financier']], 6), { type: 'takeCongressEntry', entry: 'C5' }), /tier 3, which takes 3 lobby points, and you hold 1/);
  const c5 = cloneState(state);
  take(c5, 'takeCongressEntry', { entry: 'C5' });
  assert.equal(topFrame(c5).kind, 'chooseBuiltTile');
  assert.equal(topFrame(c5).remaining, 2);
  assert.deepEqual(types(c5), ['chooseBuiltTile']);
  take(c5, 'chooseBuiltTile', { terrain: 'bridge' });
  take(c5, 'chooseBuiltTile', { terrain: 'ground' });
  assert.deepEqual(c5.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 1 });
  assert.equal(c5.players[0].coins, 6 - 3);

  // C6 with nowhere to build: the 3 VP are all that is left, so the engine takes them.
  const c6 = cloneState(state);
  const events = take(c6, 'takeCongressEntry', { entry: 'C6' });
  assert.equal(vpBySource(events, 0).congress, 3, 'R20.1: the 3 VP option of C6 is booked to congress');
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'chooseOption' && e.action.option === 1));

  // C6 with a connected inland city: a real choice, and both buildings may go in the same city.
  const c6b = cloneState(state);
  claim(c6b, 1, 'POR-SPO');
  take(c6b, 'takeCongressEntry', { entry: 'C6' });
  assert.equal(topFrame(c6b).kind, 'chooseOption');
  assert.deepEqual(getValidActions(c6b).map((a) => a.option), [0, 1]);
  assert.match(describeAction(c6b, { type: 'chooseOption', option: 1 }), /Gain 3 VP/);
  assert.match(describeAction(c6b, { type: 'chooseOption', option: 0 }), /Place up to 1 railway station and up to 1 telegraph station/);
  take(c6b, 'chooseOption', { option: 0 });
  assert.equal(topFrame(c6b).kind, 'placeBuildings');
  const offered = getValidActions(c6b).filter((a) => a.city);
  assert.ok(offered.every((a) => a.city === 'SPO'), 'only the connected inland city has room');
  take(c6b, 'placeRailwayStation', { city: 'SPO', houseTrack: 'wood' });
  take(c6b, 'placeTelegraphStation', { city: 'SPO' });
  assert.equal(c6b.map.railwayStation.SPO, 0);
  assert.equal(c6b.map.telegraphStation.SPO, 0);
  assert.equal(c6b.players[0].vp.telegraph, K.PLAYER_BOARD.telegraphRowVp[0]);
  assert.equal(c6b.players[0].vp.congress, 0, 'the buildings option scores no Congress VP');
  assert.equal(c6b.players[0].vp.firstConnection, 0, 'R13.6: no first connection');
  assert.equal(c6b.players[0].vp.toll, 0, 'R13.6: no toll');
  // Placing only one of the two is allowed.
  const c6d = cloneState(state);
  claim(c6d, 1, 'POR-SPO');
  take(c6d, 'takeCongressEntry', { entry: 'C6' });
  take(c6d, 'chooseOption', { option: 0 });
  take(c6d, 'placeTelegraphStation', { city: 'SPO' });
  assert.ok(getValidActions(c6d).every((a) => a.type !== 'placeTelegraphStation'), 'the one telegraph station has been placed');
  take(c6d, 'skipBuilding');
  assert.equal(c6d.map.railwayStation.SPO, null);
  // The 3 VP instead:
  const c6c = cloneState(state);
  claim(c6c, 1, 'POR-SPO');
  take(c6c, 'takeCongressEntry', { entry: 'C6' });
  take(c6c, 'chooseOption', { option: 1 });
  assert.equal(c6c.players[0].vp.congress, 3);
});

suite.check('R10.6: Reset needs a used entry, costs a lobby point and a Coin, returns every senator, and scores 1 VP each', () => {
  const state = congressTurn([['financier', 'financier'], ['financier', null]], 9);
  take(state, 'takeCongressEntry', { entry: 'C1' }); // the Foreman's point
  take(state, 'takeCongressEntry', { entry: 'C2' }); // the first Financier's point
  assert.deepEqual([state.congress.used.C1, state.congress.used.C2], [true, true]);
  assert.match(getBlockReason(state, { type: 'takeCongressEntry', entry: 'C1' }), /Entry C1 is used/);
  // The second Financier's point: Reset is now possible.
  assert.equal(topFrame(state).lobby, 1);
  assert.ok(getValidActions(state).some((a) => a.entry === 'CR'));
  const coins = state.players[0].coins;
  const events = take(state, 'takeCongressEntry', { entry: 'CR' });
  assert.equal(eventOf(events, 'senatorsReset').count, 2);
  assert.equal(vpBySource(events, 0).congress, 2 * K.CONGRESS.resetVpPerSenator);
  assert.equal(state.players[0].coins, coins - 1);
  assert.deepEqual(Object.values(state.congress.used).filter(Boolean), [], 'every senator is back on its cost tile');
});

suite.check('R10.1 congressTable = jan-2026: seven entries J1 to J7 plus Reset, with their own benefits', () => {
  const table = K.CONGRESS.tables['jan-2026'];
  assert.equal(table.filter((e) => !e.reset).length, 7);
  const state = congressTurn([['financier', 'financier'], ['financier', 'financier']], 20, { variants: { congressTable: 'jan-2026' } });
  assert.deepEqual(Object.keys(state.congress.used), ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7']);
  assert.ok(getValidActions(state).some((a) => a.entry === 'J1'));
  assert.ok(!getValidActions(state).some((a) => a.entry === 'C1'));
  take(state, 'takeCongressEntry', { entry: 'J3' }); // 2 cowboy hats
  assert.equal(state.players[0].hats, 2);
  toWindow(state, 2);
  take(state, 'takeCongressEntry', { entry: 'J4' }); // 4 resources of choice, one per action
  assert.equal(topFrame(state).kind, 'chooseResource');
  assert.equal(topFrame(state).remaining, 4);
  for (let i = 0; i < 4; i++) take(state, 'chooseResource', { resource: i % 2 === 0 ? 'iron' : 'wood' });
  assert.deepEqual([state.players[0].resources.iron, state.players[0].resources.wood], [2, 2]);
  // J5: 2 built tiles of choice at tier 2.
  const j5 = congressTurn([['financier', 'financier']], 20, { variants: { congressTable: 'jan-2026' } });
  toWindow(j5, 2);
  take(j5, 'takeCongressEntry', { entry: 'J5' });
  take(j5, 'chooseBuiltTile', { terrain: 'tunnel' });
  take(j5, 'chooseBuiltTile', { terrain: 'tunnel' });
  assert.equal(j5.players[0].builtTiles.tunnel, 2);
});

suite.check('R10.1 congressTable = jan-2026: every entry does what the table says (J1 to J7)', () => {
  const rich = () => {
    // Four level 1 Financiers' worth of points: the Foreman, two level 1 Financiers and a level 2 Financier twice.
    const state = congressTurn([['financier', 'financier'], ['financier', 'financier']], 40, { variants: { congressTable: 'jan-2026' } });
    return state;
  };
  const check = {
    J1: (st) => assert.equal(st.players[0].resources.wood, 1, 'gain 1 Wood'),
    J2: (st) => assert.equal(st.players[0].resources.iron, 2, 'gain 2 Iron'),
    J3: (st) => assert.equal(st.players[0].hats, 2, 'gain 2 cowboy hats'),
    J4: (st) => {
      assert.equal(topFrame(st).kind, 'chooseResource');
      assert.equal(topFrame(st).remaining, 4);
    },
    J5: (st) => {
      assert.equal(topFrame(st).kind, 'chooseBuiltTile');
      assert.equal(topFrame(st).remaining, 2);
    },
    J6: (st) => {
      assert.equal(topFrame(st).kind, 'chooseResource');
      assert.equal(topFrame(st).remaining, 6);
    },
    J7: (st) => {
      assert.equal(topFrame(st).kind, 'chooseBuiltTile');
      assert.equal(topFrame(st).remaining, 3);
    },
  };
  for (const entry of K.CONGRESS.tables['jan-2026'].filter((e) => !e.reset)) {
    const state = rich();
    // Keep closing windows until the tier is in hand (J6 and J7 are tier 3).
    for (let i = 0; i < 10 && !getValidActions(state).some((a) => a.entry === entry.id); i++) take(state, 'closeCongress');
    const coins = state.players[0].coins;
    take(state, 'takeCongressEntry', { entry: entry.id });
    assert.equal(state.players[0].coins, coins - entry.coinCost, `${entry.id} costs ${entry.coinCost} Coins`);
    assert.equal(state.congress.used[entry.id], true);
    check[entry.id](state);
  }
});

suite.check('R14.1, R14.3 with C3: a hat at the limit becomes a resource of choice, after any overflow is settled', () => {
  const state = congressTurn([['financier', 'financier']], 9);
  give(state, 0, { hats: K.HATS.hatLimit, resources: { iron: 4, wood: 3, gunpowder: 1 } }); // 8 of 9
  toWindow(state, 2);
  take(state, 'takeCongressEntry', { entry: 'C3' }); // 2 Gunpowder + 1 hat: 10 of 9 once the Gunpowder is in
  assert.equal(state.players[0].hats, K.HATS.hatLimit);
  assert.equal(topFrame(state).kind, 'discard', 'the Gunpowder overflows storage first');
  take(state, 'discard', { item: 'iron' });
  assert.equal(topFrame(state).kind, 'chooseResource', 'then the resource owed in place of the hat');
  assert.equal(describeDecision(state).prompt, 'Anna: take 1 resource of your choice');
  take(state, 'chooseResource', { resource: 'wood' });
  assert.equal(topFrame(state).kind, 'discard', 'which overflows again');
  take(state, 'discard', { item: 'iron' });
  assert.equal(state.players[0].hats, K.HATS.hatLimit);
});

// =============================================================================
// R11 - Lay Tracks
// =============================================================================

/** Anna at Lay Tracks with M steps, her railheads and tiles given. Returns the state waiting at the layTracks frame. */
function layTurn(options = {}) {
  const state = start(options.players ?? 3, { variants: options.variants });
  const heads = options.heads ?? ['POR', 'OMA'];
  setHeads(state, 0, heads[0], heads[1]);
  give(state, 0, {
    resources: options.resources ?? {},
    tiles: options.tiles ?? { bridge: 2, tunnel: 2, ground: 1 },
    coins: options.coins ?? 0,
    hats: options.hats ?? 0,
  });
  for (const spec of options.claimed ?? []) claim(state, spec[0], ...spec.slice(1));
  for (const at of options.adjacent ?? []) put(state, 0, at);
  placeAndChoose(state, options.space ?? 'W6', 'D5', options.hat ?? false);
  return state;
}

suite.check('E7 (R22): a claim resolves in order - tiles, track VP, advance, first connection, toll, building', () => {
  const state = layTurn({ heads: ['POR', 'OMA'] });
  const gus = state.players[0];
  const frame = topFrame(state);
  assert.equal(frame.kind, 'layTracks');
  assert.equal(frame.steps, 1, 'M = 1: one claim or one move, never both (R11.3)');
  // From Portland: Portland - Spokane (B, B) or Portland - Reno (T, T); he has the tiles for either.
  const claims = getValidActions(state).filter((a) => a.type === 'claimRoute' && a.from === 'POR').map((a) => a.route).sort();
  assert.deepEqual(claims, ['POR-REN', 'POR-SPO']);
  assert.ok(!getValidActions(state).some((a) => a.type === 'stopLaying'), 'at least one step must be taken (R11.3)');
  const alt = cloneState(state);

  const events = take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(state.map.routeOwner['POR-SPO'], 0, 'R11.5.1: the route is his');
  assert.deepEqual(gus.builtTiles, { ground: 1, tunnel: 2, bridge: 0 }, 'R11.5.1: two Bridge tiles went onto the slots');
  assert.equal(gus.railheads[0], 'SPO', 'R11.5.3: the railhead advanced');
  assert.deepEqual(vpBySource(events, 0), { track: 2, firstConnection: K.SCORING.firstConnectionVp }, 'R11.5.2, R11.5.4');
  assert.equal(topFrame(state).kind, 'placeBuildings', 'R11.5.7: a free building in Spokane');
  assert.deepEqual(
    getValidActions(state).filter((a) => a.type === 'placeRailwayStation').map((a) => a.houseTrack).sort(),
    ['coins', 'gunpowder', 'iron', 'wood'],
  );
  const placed = take(state, 'placeTelegraphStation', { city: 'SPO' });
  assert.equal(vpBySource(placed, 0).telegraph, K.PLAYER_BOARD.telegraphRowVp[0], 'the leftmost telegraph station scores its printed VP');
  assert.equal(gus.vp.track + gus.vp.firstConnection + gus.vp.telegraph, 2 + 5 + 1, 'E7: 8 VP for the turn');
  assert.deepEqual(gus.builtTiles, { ground: 1, tunnel: 2, bridge: 0 }, 'storage: 2 Tunnel, 1 Ground');
  assert.equal(state.turn.player, 1, 'the action ended with its one step');

  // The railway station instead: 7 VP, and the leftmost house of the chosen track leaves the board.
  const ironBefore = production(alt, 0, 'iron');
  take(alt, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(alt, 'placeRailwayStation', { city: 'SPO', houseTrack: 'iron' });
  assert.equal(alt.players[0].vp.track + alt.players[0].vp.firstConnection + alt.players[0].vp.telegraph, 7);
  assert.equal(production(alt, 0, 'iron'), ironBefore + 1, 'R13.2.4: Iron production rose by 1 at once');
  assert.equal(alt.map.railwayStation.SPO, 0);

  // Later Hal, whose railhead is on Seattle, claims Seattle - Spokane (G, G).
  const hal = start(3);
  setHeads(hal, 1, 'SEA', 'KCY');
  claim(hal, 0, 'POR-SPO');
  hal.map.telegraphStation.SPO = 0;
  give(hal, 0, { tiles: {} });
  give(hal, 1, { tiles: { ground: 2 } });
  drive(hal, (s) => s.turn.player === 0); // Anna's turn passes
  placeAndChoose(hal, 'W6', 'D5');
  const halEvents = take(hal, 'claimRoute', { route: 'SEA-SPO', from: 'SEA' });
  assert.deepEqual(vpBySource(halEvents, 1), { track: 2 }, 'no first connection (Spokane is connected), no toll (no railway station)');
  assert.equal(topFrame(hal).kind, 'placeBuildings', 'and a railway station may be placed for free');
});

suite.check('R11.4, R11.6: a claim needs an unclaimed route, a railhead at an end and the tiles, and says which is missing', () => {
  const state = layTurn({ claimed: [[1, 'POR-REN']], tiles: { bridge: 1, tunnel: 2, ground: 0 } });
  const block = (route, from) => getBlockReason(state, { type: 'claimRoute', route, from });
  assert.match(block('POR-REN', 'POR'), /Portland - Reno is already claimed by Ben, and routes are exclusive/);
  assert.match(block('SEA-SPO', 'SEA'), /None of your railheads stands on Seattle: yours stand on Portland or Omaha/);
  assert.match(block('POR-SPO', 'POR'), /Portland - Spokane needs 2 Bridge in built tiles, and you hold 1 of the 2 built Bridge you need/);
  assert.match(block('POR-SPO', 'SPO'), /None of your railheads stands on Spokane/);
  assert.match(block('POR-SPO', 'SEA'), /Portland - Spokane does not touch Seattle/);
  assert.match(block('NOPE', 'POR'), /not a route of the map/);
  assert.equal(block('OMA-SXF', 'OMA'), null);
  // The routes of a railhead whose neighbours are all claimed cannot be claimed (R11.8); the railhead must move first.
  assert.equal(getStructuralBlockReason(state, { type: 'claimRoute', route: 'OMA-SXF', from: 'OMA' }), null);
});

suite.check('R11.3: M steps, each a claim or a move; the result of one step is in force for the next; stop after any step', () => {
  // M = 2: one adjacent worker.
  const state = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2, ground: 1 } });
  const frame = topFrame(state);
  assert.equal(frame.steps, 2);
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'skipBuilding');
  assert.equal(topFrame(state).kind, 'layTracks');
  assert.equal(topFrame(state).steps, 1);
  assert.equal(topFrame(state).taken, 1);
  // Now at Spokane (the railhead moved): a move back along Portland - Spokane, or a claim from Spokane (no tiles for Bridge now).
  assert.ok(getValidActions(state).some((a) => a.type === 'moveTrain' && a.from === 'SPO' && a.to === 'POR'));
  assert.ok(getValidActions(state).some((a) => a.type === 'stopLaying'));
  assert.ok(getValidActions(state).some((a) => a.type === 'claimRoute' && a.from === 'OMA'));
  take(state, 'stopLaying');
  assert.equal(state.turn.player, 1);
  assert.equal(state.players[0].turnsTaken, 1);
});

suite.check('R11.3: the action ends by itself when its last step is taken', () => {
  const state = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2 } });
  assert.equal(topFrame(state).steps, 2);
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'skipBuilding');
  take(state, 'claimRoute', { route: 'OMA-SXF', from: 'OMA' });
  take(state, 'skipBuilding');
  assert.equal(state.turn.player, 1, 'two steps for M = 2: nothing left to ask');
  assert.equal(state.players[0].railheads[0], 'SPO');
  assert.equal(state.players[0].railheads[1], 'SXF');
});

suite.check('R11.5.5, R13.9: entering a city with another player\'s railway station pays its owner the toll', () => {
  const state = layTurn();
  state.map.railwayStation.SPO = 1;
  const events = take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.deepEqual(vpBySource(events, 1), { toll: K.SCORING.tollVp });
  assert.equal(state.players[1].vp.toll, K.SCORING.tollVp);
  assert.equal(eventOf(events, 'toll').city, 'SPO');
  // The owner entering their own station pays nothing.
  const own = layTurn();
  own.map.railwayStation.SPO = 0;
  const ownEvents = take(own, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(vpBySource(ownEvents, 0).toll, undefined);
});

suite.check('R11.9: the scoring card adds 2 VP to every slot of its terrain (3 in all), booked to track', () => {
  const state = layTurn({ variants: { scoringCard: 'bridge' } });
  assert.equal(state.scoringCard, 'bridge');
  const events = take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(vpBySource(events, 0).track, 2 * (K.SCORING.vpPerSlot + K.SCORING.scoringCardVpPerSlot));
  const plain = layTurn();
  assert.equal(vpBySource(take(plain, 'claimRoute', { route: 'POR-SPO', from: 'POR' }), 0).track, 2 * K.SCORING.vpPerSlot);
  // Ground slots stay at 1 VP under the Bridge card.
  const g = layTurn({ tiles: { ground: 2, bridge: 2 }, heads: ['SEA', 'MIN'], variants: { scoringCard: 'bridge' } });
  assert.equal(vpBySource(take(g, 'claimRoute', { route: 'SEA-SPO', from: 'SEA' }), 0).track, 2);
});

suite.check('R11.10: the running totals of the action are kept in the frame (for the Pony Express cards)', () => {
  const state = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2 }, heads: ['POR', 'OMA'] });
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'skipBuilding');
  take(state, 'claimRoute', { route: 'OMA-SXF', from: 'OMA' });
  assert.equal(topFrame(state).kind, 'placeBuildings', 'a building is offered in Sioux Falls');
  const totals = topFrame(state) && state.stack[state.stack.length - 2].totals;
  assert.deepEqual(totals, { routes: 2, slots: { ground: 0, tunnel: 2, bridge: 2 } });
});

suite.check('layTrackClaims = per-railhead: each railhead gets M claims, and M moves in all', () => {
  const state = layTurn({ variants: { layTrackClaims: 'per-railhead' }, tiles: { bridge: 2, tunnel: 2, ground: 0 } });
  const frame = topFrame(state);
  assert.deepEqual([frame.claimsLeft, frame.movesLeft], [[1, 1], 1]);
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'skipBuilding');
  assert.deepEqual(topFrame(state).claimsLeft, [0, 1], 'the western railhead has used its claim');
  assert.match(getBlockReason(state, { type: 'claimRoute', route: 'SPO-REN', from: 'SPO' }), /needs 3 Bridge|you hold/);
  take(state, 'claimRoute', { route: 'OMA-SXF', from: 'OMA' });
  take(state, 'skipBuilding');
  // Both railheads have claimed; one move is left.
  assert.deepEqual(topFrame(state).claimsLeft, [0, 0]);
  assert.ok(getValidActions(state).some((a) => a.type === 'moveTrain'));
  assert.ok(!getValidActions(state).some((a) => a.type === 'claimRoute'));
  take(state, 'stopLaying');
  assert.equal(state.turn.player, 1);
});

// =============================================================================
// R11.11 - claimFrom = network
// =============================================================================

suite.check('R11.11: in network mode a claim needs only an end in the network; there is no Move Train; a station step costs 2 Coins', () => {
  const state = layTurn({ variants: { claimFrom: 'network' }, adjacent: ['W9'], tiles: { bridge: 2, ground: 1, tunnel: 0 }, coins: 5 });
  const frame = topFrame(state);
  assert.equal(frame.steps, 2);
  assert.ok(!getValidActions(state).some((a) => a.type === 'moveTrain'));
  assert.match(getBlockReason(state, { type: 'moveTrain', from: 'POR', to: 'SPO' }), /There is no Move Train in network mode/);
  // Station steps are on offer only in cities of the network (the two start cities hold no buildings).
  assert.ok(!getValidActions(state).some((a) => a.type === 'placeTelegraphStation'));
  const events = take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.deepEqual(state.players[0].railheads, ['POR', 'OMA'], 'R11.11.1: railheads never move');
  assert.equal(vpBySource(events, 0).firstConnection, K.SCORING.firstConnectionVp);
  take(state, 'skipBuilding');
  // Spokane is now in the network: a station step is possible there, and only there.
  const second = getValidActions(state);
  assert.ok(second.some((a) => a.type === 'placeTelegraphStation' && a.city === 'SPO'));
  assert.ok(!second.some((a) => a.type === 'placeTelegraphStation' && a.city === 'SXF'), 'not in the network');
  const coins = state.players[0].coins;
  take(state, 'placeTelegraphStation', { city: 'SPO' });
  assert.equal(state.players[0].coins, coins - K.MAP_RULES.stationStepCost.coins, 'R11.11.5: 2 Coins');
  assert.equal(state.turn.player, 1, 'the station step was the second step');
});

suite.check('R11.11.3, R11.11.4: a claim between two cities already in the network has no arrival city', () => {
  const state = start(3, { variants: { claimFrom: 'network' } });
  setHeads(state, 0, 'POR', 'OMA');
  claim(state, 0, 'POR-REN', 'POR-SPO'); // Reno and Spokane are in the network
  give(state, 0, { tiles: { bridge: 3, tunnel: 2 } });
  placeAndChoose(state, 'W6', 'D5');
  assert.match(
    getBlockReason(state, { type: 'claimRoute', route: 'SPO-REN', from: 'REN' }),
    /Both ends of Spokane - Reno are already in your network, so name the claim from Spokane/,
  );
  const ev = take(state, 'claimRoute', { route: 'SPO-REN', from: 'SPO' });
  assert.equal(eventOf(ev, 'routeClaimed').to, null);
  assert.deepEqual(vpBySource(ev, 0), { track: 3 }, 'no first connection, no toll');
  assert.equal(state.turn.player, 1, 'and no building was offered');
});

suite.check('R11.11.1, R11.3: in network mode the action ends by itself when no claim or station step is left', () => {
  const state = layTurn({ variants: { claimFrom: 'network' }, adjacent: ['W9'], tiles: { bridge: 2, tunnel: 0, ground: 1 }, coins: 1 });
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  const events = take(state, 'skipBuilding');
  // One step is left, but with 1 Coin no station step can be paid and no tiles remain: only "stop" is legal.
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'stopLaying'));
  assert.equal(state.turn.player, 1);
});

// =============================================================================
// R12 - Move Train
// =============================================================================

suite.check('E8 (R22): Move Train takes the least-toll path, pays Hal the toll, and 2 Coins buy a railway station on arrival', () => {
  const state = start(3);
  setHeads(state, 0, 'POR', 'OMA');
  state.players[0].railheads[0] = 'SPO'; // Gus's railhead is on Spokane
  claim(state, 0, 'POR-SPO');
  claim(state, 1, 'BOI-SPO', 'BOI-SLC');
  state.map.railwayStation.BOI = 1;
  state.map.telegraphStation.SLC = 1;
  give(state, 0, { coins: 3, tiles: {} });
  const path = moveTrainPath(state, 0, 'SPO', 'SLC');
  assert.deepEqual(path.cities, ['SPO', 'BOI', 'SLC']);
  assert.deepEqual(path.tollCities, ['BOI']);
  placeAndChoose(state, 'W6', 'D5');
  assert.equal(topFrame(state).steps, 1);
  const moves = getValidActions(state).filter((a) => a.type === 'moveTrain' && a.from === 'SPO').map((a) => a.to).sort();
  assert.deepEqual(moves, ['BOI', 'POR', 'SLC']);
  const hal = state.players[1].vp.toll;
  const events = take(state, 'moveTrain', { from: 'SPO', to: 'SLC' });
  assert.equal(state.players[1].vp.toll, hal + K.SCORING.tollVp, 'Boise is entered: Hal gains 3 VP');
  assert.equal(vpBySource(events, 0).toll, undefined, 'the mover loses nothing and gains nothing (R12.3.3)');
  assert.equal(state.players[0].railheads[0], 'SLC');
  assert.equal(topFrame(state).kind, 'placeBuildings', 'R12.4: a building for 2 Coins');
  assert.deepEqual(topFrame(state).cost, K.MAP_RULES.moveBuildCost);
  const ironBefore = production(state, 0, 'iron');
  take(state, 'placeRailwayStation', { city: 'SLC', houseTrack: 'iron' });
  assert.equal(state.players[0].coins, 3 - K.MAP_RULES.moveBuildCost.coins);
  assert.equal(production(state, 0, 'iron'), ironBefore + 1, 'his Iron production rises by 1');
  assert.equal(state.map.railwayStation.SLC, 0);
  assert.equal(state.turn.player, 1);
});

suite.check('R12.3: fewest tolls first, then fewest routes, then the alphabetically first list of city ids', () => {
  const state = start(3);
  // A diamond Spokane - (Boise | Reno) - Salt Lake City: two chains of 2 routes.
  claim(state, 1, 'BOI-SPO', 'REN-SLC', 'BOI-SLC', 'SPO-REN');
  assert.deepEqual(moveTrainPath(state, 0, 'SPO', 'SLC').cities, ['SPO', 'BOI', 'SLC'], 'tie: B comes before R');
  // A toll on Boise makes the Reno chain better.
  state.map.railwayStation.BOI = 1;
  assert.deepEqual(moveTrainPath(state, 0, 'SPO', 'SLC').cities, ['SPO', 'REN', 'SLC']);
  assert.deepEqual(moveTrainPath(state, 1, 'SPO', 'SLC').cities, ['SPO', 'BOI', 'SLC'], 'the owner pays no toll to herself');
  // Fewer tolls beat fewer routes: Helena -> Cheyenne direct via Billings has a toll, the long way round has none.
  const s2 = start(3);
  claim(s2, 1, 'HEL-BIL', 'CHE-BIL', 'HEL-BOI', 'BOI-SLC', 'CHE-SLC');
  assert.deepEqual(moveTrainPath(s2, 0, 'HEL', 'CHE').cities, ['HEL', 'BIL', 'CHE']);
  s2.map.railwayStation.BIL = 1;
  assert.deepEqual(moveTrainPath(s2, 0, 'HEL', 'CHE').cities, ['HEL', 'BOI', 'SLC', 'CHE']);
  // A city is counted once per move, and the destination counts.
  s2.map.railwayStation.CHE = 1;
  assert.deepEqual(moveTrainPath(s2, 0, 'HEL', 'CHE').tollCities, ['CHE']);
  assert.equal(moveTrainPath(s2, 0, 'HEL', 'MIN'), null, 'not joined by claimed routes');
  assert.equal(moveTrainPath(s2, 0, 'HEL', 'HEL'), null);
});

suite.check('R12.2, R12.5, R12.6: a legal move needs a chain of claimed routes; railheads may share a city', () => {
  const state = layTurn({ tiles: { bridge: 1, ground: 1 }, claimed: [[1, 'POR-SPO']], heads: ['POR', 'OMA'] });
  assert.match(getBlockReason(state, { type: 'moveTrain', from: 'OMA', to: 'SXF' }), /No claimed route touches Omaha, so a railhead there cannot move/);
  assert.match(getBlockReason(state, { type: 'moveTrain', from: 'POR', to: 'REN' }), /No chain of claimed routes joins Portland to Reno/);
  assert.match(getBlockReason(state, { type: 'moveTrain', from: 'POR', to: 'POR' }), /already on Portland/);
  assert.match(getBlockReason(state, { type: 'moveTrain', from: 'SEA', to: 'SPO' }), /None of your railheads stands on Seattle/);
  assert.equal(getBlockReason(state, { type: 'moveTrain', from: 'POR', to: 'SPO' }), null);
  const events = take(state, 'moveTrain', { from: 'POR', to: 'SPO' });
  assert.equal(eventOf(events, 'railheadMoved').to, 'SPO');
  assert.equal(state.turn.player, 1);
});

suite.check('R12.5: both of a player\'s railheads, and other players\' railheads, may stand on the same city', () => {
  const state = layTurn({ tiles: { bridge: 3, ground: 1 }, claimed: [[1, 'POR-SPO']] });
  state.players[0].railheads = ['POR', 'POR'];
  state.players[1].railheads = ['POR', 'SEA'];
  const keys = getValidActions(state).map((a) => JSON.stringify(a));
  assert.equal(new Set(keys).size, keys.length, 'one move from Portland, not two');
  assert.deepEqual(getValidActions(state).filter((a) => a.type === 'moveTrain').map((a) => a.to), ['SPO']);
  take(state, 'moveTrain', { from: 'POR', to: 'SPO' });
  assert.deepEqual(state.players[0].railheads, ['SPO', 'POR'], 'one railhead moved, the other stayed');
});

// =============================================================================
// R13 - buildings
// =============================================================================

suite.check('R13.1 to R13.3, R13.10: one railway station and one telegraph station per inland city; start cities hold none', () => {
  const state = layTurn();
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'placeRailwayStation', { city: 'SPO', houseTrack: 'wood' });
  assert.equal(state.players[0].houses.wood, 2);
  assert.equal(production(state, 0, 'wood'), 2);
  const b = (action) => getBlockReason(state, { ...action, player: 0 });
  assert.match(b({ type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' }), /You already have a railway station in Spokane/);
  assert.match(b({ type: 'placeRailwayStation', city: 'SEA', houseTrack: 'iron' }), /Seattle is a start city: buildings go only in the 17 inland cities/);
  assert.match(b({ type: 'placeTelegraphStation', city: 'MIN' }), /Minneapolis is a start city/);
  // The no-house case and the empty track.
  const bare = layTurn();
  bare.players[0].houses = { wood: 0, coins: 0, iron: 0, gunpowder: 0 };
  take(bare, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.match(getBlockReason(bare, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' }), /You have no house left on your player board to place as a railway station/);
  const track = layTurn();
  track.players[0].houses.iron = 0;
  take(track, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.match(getBlockReason(track, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' }), /Your Iron track has no house left to take: choose a track that still has one/);
  assert.equal(getBlockReason(track, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), null);
  // Skipping is always possible, and only one building comes with a claim (R13.4).
  const one = layTurn();
  take(one, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(one, 'placeTelegraphStation', { city: 'SPO' });
  assert.equal(one.map.railwayStation.SPO, null);
  assert.equal(one.turn.player, 1);
});

suite.check('R13.3: the telegraph row scores 1, 2, 3, 4, 5, 6, 9 from the left; with the row empty none can be placed', () => {
  const row = K.PLAYER_BOARD.telegraphRowVp;
  for (let placed = 0; placed < row.length; placed++) {
    const state = layTurn();
    state.players[0].telegraphsPlaced = placed;
    assert.equal(nextTelegraphVp(state, 0), row[placed]);
    take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
    const events = take(state, 'placeTelegraphStation', { city: 'SPO' });
    assert.equal(vpBySource(events, 0).telegraph, row[placed], `telegraph station number ${placed + 1}`);
    assert.equal(state.players[0].telegraphsPlaced, placed + 1);
  }
  const empty = layTurn();
  empty.players[0].telegraphsPlaced = row.length;
  take(empty, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.match(getBlockReason(empty, { type: 'placeTelegraphStation', city: 'SPO' }), /You have placed all 7 of your telegraph stations/);
});

suite.check('R13.7: with bothBuildingsSameOwner = false the two buildings of a city belong to different players', () => {
  const reason = (state, action) => getBlockReason(state, { ...action, player: 0 });
  // Anna owns the telegraph station in Spokane and arrives there: no railway station may follow, so nothing is offered.
  const state = layTurn({ variants: { bothBuildingsSameOwner: false } });
  state.map.telegraphStation.SPO = 0;
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(state.turn.player, 1, 'no building could be placed, so none was offered');
  assert.match(
    reason(state, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }),
    /In this game the railway station and the telegraph station of a city must belong to different players, and the telegraph station in Spokane is yours/,
  );
  // By default one player may own both.
  const open = layTurn();
  open.map.telegraphStation.SPO = 0;
  take(open, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(topFrame(open).kind, 'placeBuildings');
  assert.equal(getBlockReason(open, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), null);
  // Another player's telegraph station does not stop the railway station in either mode.
  const other = layTurn({ variants: { bothBuildingsSameOwner: false } });
  other.map.telegraphStation.SPO = 1;
  take(other, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(getBlockReason(other, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), null);
  assert.match(getBlockReason(other, { type: 'placeTelegraphStation', city: 'SPO' }), /Spokane already has Ben's telegraph station/);
  // And the mirror: a railway station of one's own blocks the telegraph station.
  const mirror = layTurn({ variants: { bothBuildingsSameOwner: false } });
  mirror.map.railwayStation.SPO = 0;
  take(mirror, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(mirror.turn.player, 1);
  assert.match(reason(mirror, { type: 'placeTelegraphStation', city: 'SPO' }), /must belong to different players, and the railway station in Spokane is yours/);
});

suite.check('R13.4: a building comes free on every arrival in an inland city with room, not only a first connection', () => {
  const state = layTurn();
  claim(state, 1, 'SEA-SPO'); // Spokane is already connected
  const events = take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(vpBySource(events, 0).firstConnection, undefined);
  assert.equal(topFrame(state).kind, 'placeBuildings');
  // A start city never offers one (R11.2.2), and scores no first connection (R11.2.4).
  const edge = layTurn({ tiles: { bridge: 2, ground: 1 }, heads: ['SXF', 'OMA'] });
  const arrived = take(edge, 'claimRoute', { route: 'MIN-SXF', from: 'SXF' });
  assert.equal(eventOf(arrived, 'routeClaimed').to, 'MIN');
  assert.deepEqual(vpBySource(arrived, 0), { track: 2 });
  assert.equal(edge.turn.player, 1, 'Minneapolis is a start city: no building is offered');
  // Nor when the player cannot place one: the offer is skipped, not asked.
  const bare = layTurn();
  bare.players[0].telegraphsPlaced = K.PLAYER_BOARD.telegraphRowVp.length;
  bare.players[0].houses = { wood: 0, coins: 0, iron: 0, gunpowder: 0 };
  take(bare, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(bare.turn.player, 1);
});

// =============================================================================
// R19 - the end of the game
// =============================================================================

suite.check('E10 (R22): the first transcontinental line pays 25 + 3 per slot and triggers the end; the last seat plays on', () => {
  const state = start(4);
  const mia = state.players[0];
  // Seat 3 is Mia in the spec; any seat will do. Mia owns Seattle - Helena and Helena - Bismarck, and is at Bismarck.
  claim(state, 0, 'SEA-HEL', 'HEL-BIS');
  // 16 more routes are claimed by others, so 19 are claimed in all; none joins the coasts.
  const others = MAP.routes.map((r) => r.id).filter((id) => state.map.routeOwner[id] === null && id !== 'BIS-MIN' && !id.startsWith('LAX') && !id.startsWith('ELP-FTW'));
  claim(state, 1, ...others.slice(0, 16));
  assert.equal(Object.values(state.map.routeOwner).filter((o) => o !== null).length, 18);
  claim(state, 1, others[16]);
  setHeads(state, 0, 'SEA', 'MIN');
  mia.railheads = ['SEA', 'BIS'];
  give(state, 0, { tiles: { ground: 5 } });
  assert.ok(!hasTranscontinentalLine(state, 0));
  placeAndChoose(state, 'W6', 'D5');
  const events = take(state, 'claimRoute', { route: 'BIS-MIN', from: 'BIS' });
  const vp = vpBySource(events, 0);
  assert.equal(vp.track, 5, 'five slots');
  assert.equal(vp.completion, K.SCORING.completionVp + K.SCORING.completionVpPerSlot * 5, 'E10: 25 + 3 x 5 = 40 VP');
  assert.equal(vp.firstConnection, undefined, 'Minneapolis is a start city');
  assert.equal(vp.track + vp.completion, 45, 'E10: the turn scores 45 VP');
  assert.deepEqual(state.completion, { player: 0, turn: 1, route: 'BIS-MIN' });
  assert.deepEqual(state.gameEnd, { reason: 'transcontinental', triggeredBy: 0, triggeredOnTurn: 1 });
  assert.ok(eventOf(events, 'gameEndTriggered'));
  assert.equal(isGameOver(state), false);
  // The other three seats each take one more turn (seat 1 started; the round is Anna, Ben, Cara, Dev).
  drive(state, (s) => !isGameOver(s) && s.turn.player !== 3);
  assert.equal(isGameOver(state), false, 'the last seat has not played yet');
  drive(state, () => true);
  assert.equal(isGameOver(state), true);
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [1, 1, 1, 1]);
  assert.equal(scoreGame(state).endReason, 'transcontinental');
});

suite.check('R19.2: the bonus is paid once per game; a second line later scores nothing extra', () => {
  const state = start(4);
  claim(state, 0, 'SEA-HEL', 'HEL-BIS');
  claim(state, 3, 'LAX-PHX', 'PHX-ELP');
  setHeads(state, 0, 'SEA', 'MIN');
  state.players[0].railheads = ['SEA', 'BIS'];
  setHeads(state, 3, 'LAX', 'FTW');
  state.players[3].railheads = ['LAX', 'ELP'];
  give(state, 0, { tiles: { ground: 5 } });
  give(state, 3, { tiles: { ground: 5 } });
  placeAndChoose(state, 'W6', 'D5');
  take(state, 'claimRoute', { route: 'BIS-MIN', from: 'BIS' });
  assert.equal(state.players[0].vp.completion, 40);
  // Dev completes Los Angeles - Fort Worth on the last turn of the round.
  drive(state, (s) => s.turn.player !== 3, (actions) => actions.find((a) => a.type === 'placeWorker') ?? actions[0]);
  assert.equal(state.turn.player, 3);
  placeAndChoose(state, 'W7', 'D5');
  assert.ok(hasTranscontinentalLine(state, 3) === false);
  const events = take(state, 'claimRoute', { route: 'ELP-FTW', from: 'ELP' });
  assert.ok(hasTranscontinentalLine(state, 3), 'Dev\'s routes do join the coasts now');
  assert.equal(vpBySource(events, 3).completion, undefined, 'but the bonus is paid once per game');
  assert.equal(state.players[3].vp.completion, 0);
  assert.equal(eventsOf(events, 'gameEndTriggered').length, 0);
  assert.equal(state.completion.player, 0);
});

suite.check('R19.1 against R19.7: own-crossing needs one player\'s own routes; any-crossing counts every claimed route', () => {
  for (const [mode, expected] of [['own-crossing', false], ['any-crossing', true]]) {
    const state = start(3, { variants: { gameEndTrigger: mode } });
    claim(state, 1, 'SEA-HEL');
    claim(state, 2, 'HEL-BIS');
    setHeads(state, 0, 'SEA', 'MIN');
    state.players[0].railheads = ['SEA', 'BIS'];
    give(state, 0, { tiles: { ground: 5 } });
    placeAndChoose(state, 'W6', 'D5');
    const events = take(state, 'claimRoute', { route: 'BIS-MIN', from: 'BIS' });
    assert.equal(vpBySource(events, 0).completion !== undefined, expected, mode);
    assert.equal(state.gameEnd !== null, expected, mode);
    if (expected) assert.equal(state.gameEnd.reason, 'transcontinental');
  }
  // The west-to-east chain may use any start cities: Los Angeles to Kansas City.
  const free = start(3);
  claim(free, 0, 'LAX-PHX', 'PHX-ELP', 'ELP-DOD');
  assert.equal(hasTranscontinentalLine(free, 0), false);
  claim(free, 0, 'KCY-DOD');
  assert.equal(hasTranscontinentalLine(free, 0), true);
  assert.equal(hasTranscontinentalLine(free, 1), false);
});

suite.check('R19.2 with R19.6: a line completed after the end was triggered still scores; the end is not triggered twice', () => {
  const state = start(3);
  state.gameEnd = { reason: 'routes-claimed', triggeredBy: 2, triggeredOnTurn: 0 };
  claim(state, 0, 'SEA-HEL', 'HEL-BIS');
  state.players[0].railheads = ['SEA', 'BIS'];
  setHeads(state, 0, 'SEA', 'MIN');
  state.players[0].railheads = ['SEA', 'BIS'];
  give(state, 0, { tiles: { ground: 5 } });
  placeAndChoose(state, 'W6', 'D5');
  const events = take(state, 'claimRoute', { route: 'BIS-MIN', from: 'BIS' });
  assert.equal(vpBySource(events, 0).completion, 40);
  assert.equal(state.gameEnd.reason, 'routes-claimed', 'the earlier trigger stands');
  assert.equal(eventsOf(events, 'gameEndTriggered').length, 0);
});

// =============================================================================
// R4.8 - rounds
// =============================================================================

suite.check('R4.8: with rounds there is no Remove; a round ends when every worker is placed; workers return and the marker passes', () => {
  const state = start(2, { variants: { turnStructure: 'rounds' } });
  assert.deepEqual(UNIMPLEMENTED_VARIANT_VALUES, {}, 'rounds is implemented');
  assert.ok(!types(state).includes('removeWorker'));
  assert.match(getBlockReason(state, { type: 'removeWorker', from: 'W1' }), /With rounds you cannot remove a worker/);
  assert.equal(describeDecision(state).prompt, 'Anna: place or displace a worker');
  assert.equal(state.startPlayer, 0);
  let turns = 0;
  const events = [];
  while (state.startPlayer === 0) {
    events.push(...drive(state, (s) => s.turn.number === turns + 1 && !isGameOver(s), (actions) => actions.find((a) => a.type === 'placeWorker') ?? actions.find((a) => a.type !== 'displaceWorker') ?? actions[0]));
    turns += 1;
    if (turns > 40) throw new Error('the round never ended');
  }
  assert.equal(turns, 12, 'two players, six workers each');
  assert.equal(eventOf(events, 'roundEnd').startPlayer, 1);
  assert.equal(state.startPlayer, 1, 'R4.8.3: the start player marker passed one seat clockwise');
  assert.equal(state.turn.player, 1, 'and the new start player begins');
  assert.deepEqual(state.players.map((p) => p.workersInSupply), [6, 6]);
  assert.ok(Object.values(state.grid.spaces).every((o) => o === null));
});

suite.check('R4.8.2: a player with no worker in supply is skipped', () => {
  const state = start(3, { variants: { turnStructure: 'rounds' } });
  // Ben has put all four of his workers out already.
  for (const w of ['W2', 'W3', 'W9', 'W12']) put(state, 1, w);
  assert.equal(state.players[1].workersInSupply, 0);
  placeAndChoose(state, 'W1', 'D1');
  drive(state, (s) => s.turn.player === 0 && s.turn.number === 1, (actions) => actions.find((a) => a.type === 'skipBonusAction') ?? actions[0]);
  assert.equal(state.turn.player, 2, 'Cara plays next: Ben has nothing to place');
  assert.equal(state.players[1].turnsTaken, 0);
});

suite.check('R4.8.4: once the end is triggered with rounds, the round is played to its end', () => {
  const state = start(2, { variants: { turnStructure: 'rounds', maxTurnsPerPlayer: 3 } });
  let guard = 0;
  while (!isGameOver(state)) {
    drive(state, (s) => !isGameOver(s) && s.stack.length > 0, (actions) => actions.find((a) => a.type === 'placeWorker') ?? actions.find((a) => a.type !== 'displaceWorker') ?? actions[0]);
    if (++guard > 100) throw new Error('the game never ended');
  }
  assert.equal(state.gameEnd.reason, 'turn-limit');
  assert.equal(state.gameEnd.triggeredOnTurn, 5, 'Anna took her third turn on turn 5');
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [6, 6], 'but the round went on until every worker was placed');
  // R20.5.4 with rounds (contract question 5): turn order is measured from the start player of the final round.
  const order = scoreGame(state).players.map((p) => p.tieBreak.turnOrder);
  assert.equal(order[state.startPlayer], 0, 'the holder of the marker counts as closest');
  assert.equal(state.startPlayer, 0, 'the game ended at the end of the first round, before the marker passed');
});

// =============================================================================
// R5.4.4 and R20 - the real case, and VP by source
// =============================================================================

suite.check('R5.4.4: a centre worker of Lay Tracks is forced off with no action when no claim or move exists, and gives the action when one does', () => {
  const stuck = start(4);
  put(stuck, 0, 'D5');
  put(stuck, 0, 'W1');
  put(stuck, 0, 'W2');
  assert.deepEqual(getValidActions(stuck), [{ type: 'removeWorker', from: 'D5' }]);
  const events = act(stuck, { type: 'removeWorker', from: 'D5' });
  assert.equal(eventOf(events, 'districtChosen').district, 'none');
  assert.equal(stuck.turn.player, 1);
  // With the tiles for a route, the same removal gives Lay Tracks.
  const live = start(4);
  setHeads(live, 0, 'SEA', 'MIN');
  give(live, 0, { tiles: { ground: 2, bridge: 2 } });
  put(live, 0, 'D5');
  put(live, 0, 'W1');
  put(live, 0, 'W2');
  act(live, { type: 'removeWorker', from: 'D5' });
  assert.equal(topFrame(live).kind, 'layTracks');
  assert.equal(topFrame(live).steps, 1, 'the removed worker is not counted for M');
});

suite.check('R20.1: every VP source of the core game is booked as it is scored, and the totals add up', () => {
  const state = layTurn();
  state.map.railwayStation.SPO = 1;
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'placeTelegraphStation', { city: 'SPO' });
  const [anna, ben] = state.players;
  assert.deepEqual(
    { track: anna.vp.track, first: anna.vp.firstConnection, tele: anna.vp.telegraph, completion: anna.vp.completion, toll: anna.vp.toll, congress: anna.vp.congress },
    { track: 2, first: 5, tele: 1, completion: 0, toll: 0, congress: 0 },
  );
  assert.equal(ben.vp.toll, K.SCORING.tollVp);
  const score = scoreGame(state);
  // scoreGame projects the buildings table onto the position: one building each (Ben's railway station was put there by hand).
  assert.equal(score.players[0].total, 8 + K.SCORING.buildingTable.rising[1]);
  assert.equal(score.players[1].total, K.SCORING.tollVp + K.SCORING.buildingTable.rising[1]);
  assert.deepEqual(Object.keys(score.players[0].bySource).slice(0, 6), ['track', 'firstConnection', 'completion', 'telegraph', 'toll', 'congress']);
});

suite.check('R20.2.1: buildings are scored once from the table at the end, with either buildingScoreCurve', () => {
  for (const curve of ['rising', '2018']) {
    const state = start(2, { variants: { buildingScoreCurve: curve, maxTurnsPerPlayer: 1 } });
    for (const city of MAP.inlandCities.slice(0, 7)) {
      state.map.railwayStation[city] = 0;
      state.map.telegraphStation[city] = 0;
    }
    assert.equal(buildingCount(state, 0), 14);
    assert.equal(railwayStationCount(state, 0), 7);
    drive(state, () => true);
    assert.equal(state.players[0].vp.buildingsEnd, K.SCORING.buildingTable[curve][14], curve);
  }
  assert.notEqual(K.SCORING.buildingTable.rising[16], K.SCORING.buildingTable['2018'][16]);
  assert.ok(ownedSlots(start(2), 0) === 0);
});

// =============================================================================
// Contract promises for the new actions
// =============================================================================

suite.check('every legal action of the new decisions is listed, and every listed action is accepted (brute force over the action space)', () => {
  const states = [];
  const a = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2, ground: 1 } });
  states.push(a);
  const b = cloneState(a);
  take(b, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  states.push(b); // placeBuildings
  const c = cloneState(b);
  take(c, 'skipBuilding');
  states.push(c); // layTracks after a step
  states.push(congressTurn([['financier', 'financier']], 6));
  const net = layTurn({ variants: { claimFrom: 'network' }, adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2 }, coins: 4 });
  take(net, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(net, 'skipBuilding');
  states.push(net);
  for (const s of states) {
    const listed = getValidActions(s).map((x) => JSON.stringify(x)).sort();
    const legal = getActionSpace(s).filter((x) => getBlockReason(s, x) === null).map((x) => JSON.stringify(x)).sort();
    assert.deepEqual(listed, legal, `decision "${topFrame(s).kind}"`);
    assert.ok(listed.length >= 2, 'a real choice');
    for (const x of getValidActions(s)) {
      const copy = cloneState(s);
      act(copy, x);
    }
  }
});


// =============================================================================
// Edges: variants together, offers that are skipped, and the wording
// =============================================================================

suite.check('layTrackClaims = per-railhead with claimFrom = network: 2 x M steps in one pool, claims and station steps alike', () => {
  const state = layTurn({
    variants: { claimFrom: 'network', layTrackClaims: 'per-railhead' },
    tiles: { bridge: 2, tunnel: 2, ground: 0 },
    coins: 4,
  });
  assert.equal(topFrame(state).steps, 2 * 1, 'R11.3: 2 x M claims');
  assert.equal(topFrame(state).claimsLeft, undefined);
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  take(state, 'skipBuilding');
  take(state, 'claimRoute', { route: 'OMA-SXF', from: 'OMA' });
  take(state, 'skipBuilding');
  assert.equal(state.turn.player, 1, 'both claims taken, nothing left');
});

suite.check('R12.4, R13.5: a building after a move is offered only if the 2 Coins can be paid and there is room', () => {
  const build = (coins) => {
    const state = layTurn({ tiles: { bridge: 1, ground: 1 }, claimed: [[1, 'POR-SPO']], coins });
    return take(state, 'moveTrain', { from: 'POR', to: 'SPO' }) && state;
  };
  assert.equal(topFrame(build(K.MAP_RULES.moveBuildCost.coins)).kind, 'placeBuildings');
  assert.equal(build(K.MAP_RULES.moveBuildCost.coins - 1).turn.player, 1, 'with 1 Coin nothing is offered');
  // A move to a start city offers nothing either.
  const back = layTurn({ tiles: { bridge: 1, ground: 1 }, claimed: [[1, 'POR-SPO']], coins: 5 });
  back.players[0].railheads[0] = 'SPO';
  take(back, 'moveTrain', { from: 'SPO', to: 'POR' });
  assert.equal(back.turn.player, 1);
});

suite.check('R5.5.4 with R4.6.3: a displacement onto Lay Tracks / Move Train is refused when no claim or move exists', () => {
  const state = start(4);
  put(state, 1, 'W4');
  put(state, 2, 'W6');
  put(state, 3, 'W7');
  put(state, 1, 'W9');
  state.players[1].workersInSupply += 0;
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D5' }), /Lay Tracks \/ Move Train needs a legal claim or move, and you have neither/);
  // With the tiles for a route, the same displacement is legal.
  setHeads(state, 0, 'SEA', 'MIN');
  give(state, 0, { tiles: { ground: 2 } });
  assert.equal(getBlockReason(state, { type: 'displaceWorker', district: 'D5' }), null);
});

suite.check('R14.2 with R5.6.4: a spent cowboy hat gives Lay Tracks one more step', () => {
  const state = layTurn({ hats: 1, hat: true, tiles: { bridge: 2, tunnel: 2 } });
  assert.equal(topFrame(state).steps, 2);
  assert.equal(state.players[0].hats, 0);
  assert.equal(state.turn.multiplier, 2);
});

suite.check('R8.7, R7.2: a free carriage from Congress does not use up the Add Carriage bonus action', () => {
  const state = congressTurn([['financier', 'financier']], 6, { variants: { bonusActionLimit: 'once-per-game' } });
  toWindow(state, 2);
  take(state, 'takeCongressEntry', { entry: 'C4' });
  take(state, 'addCarriage', { carriage: 'storage' });
  assert.equal(state.players[0].bonusActionsUsed.carriage, false);
  assert.equal(state.players[0].resources.wood, 0, 'nothing was paid');
});

suite.check('R11.3: stopping needs at least one step, and the sentence says so', () => {
  const state = layTurn({ adjacent: ['W9'] });
  assert.match(getBlockReason(state, { type: 'stopLaying' }), /You must take at least one step, a claim or a move, before you stop/);
  assert.match(getBlockReason(state, { type: 'skipBuilding' }), /There is no building on offer to decline|not yours|right now/);
  assert.match(getBlockReason(state, { type: 'closeCongress' }), /There are no Congress entries on offer to leave/);
  assert.match(getBlockReason(state, { type: 'skipStep' }), /only while you are in a train activation/);
  assert.match(getBlockReason(state, { type: 'chooseBuiltTile', terrain: 'ground' }), /not owed a built track tile/);
  assert.match(getBlockReason(state, { type: 'chooseBuiltTile', terrain: 'steel' }), /not a kind of track tile/);
  assert.match(getBlockReason(state, { type: 'chooseOption', option: -1 }), /options count from 0/);
  assert.match(getBlockReason(state, { type: 'placeTelegraphStation', city: 'SPO' }), /You can place a building only when the rules offer one/);
});

suite.check('describeAction and describeDecision speak plainly for every new action and decision', () => {
  const state = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2, ground: 1 } });
  assert.equal(describeDecision(state).prompt, 'Anna: claim a route or move your train (2 steps left)');
  assert.equal(describeAction(state, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }), 'Claim Portland - Spokane (2 Bridge) from Portland');
  assert.equal(describeAction(state, { type: 'moveTrain', from: 'POR', to: 'SPO' }), 'Move your railhead from Portland to Spokane');
  assert.equal(describeAction(state, { type: 'stopLaying' }), 'Stop: take no more steps');
  take(state, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  assert.equal(describeDecision(state).prompt, 'Anna: place a building in Spokane, for free, or none');
  assert.equal(
    describeAction(state, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' }),
    'Place a railway station in Spokane, taking the leftmost house from your Iron track',
  );
  assert.equal(describeAction(state, { type: 'placeTelegraphStation', city: 'SPO' }), `Place a telegraph station in Spokane (+${K.PLAYER_BOARD.telegraphRowVp[0]} VP)`);
  assert.equal(describeAction(state, { type: 'skipBuilding' }), 'Place no (more) buildings');
  const c = congressTurn([['financier', 'miner']], 4);
  assert.equal(describeAction(c, { type: 'takeCongressEntry', entry: 'C1' }), 'Take Congress entry C1 (1 lobby point + 1 Coin): Gain 2 Wood');
  assert.equal(describeDecision(c).prompt, 'Anna: take Lobby Congress entries with your 1 lobby point, or carry on');
  assert.equal(describeAction(c, { type: 'closeCongress' }), 'Take no (more) Congress entries for now');
  assert.equal(describeAction(c, { type: 'chooseBuiltTile', terrain: 'tunnel' }), 'Take 1 built Tunnel tile');
});

suite.check('terminology: no player-facing sentence of the core rules calls anything on the map or the grid a house', () => {
  const sentences = [];
  const grab = (state, players) => {
    for (const action of getActionSpace(state)) {
      for (const player of players) {
        const reason = getBlockReason(state, { ...action, player });
        if (reason !== null) sentences.push(reason);
      }
    }
    for (const action of getValidActions(state)) sentences.push(describeAction(state, action));
    sentences.push(describeDecision(state).prompt);
  };
  const lay = layTurn({ adjacent: ['W9'], tiles: { bridge: 2, tunnel: 2, ground: 1 } });
  grab(lay, [0, 1]);
  take(lay, 'claimRoute', { route: 'POR-SPO', from: 'POR' });
  grab(lay, [0, 1]);
  const c = congressTurn([['financier', 'financier']], 6);
  grab(c, [0, 1]);
  for (const text of sentences) {
    assert.ok(!/steel/i.test(text), text);
    // "house" is the player-board piece only: never on the map, a city or a district.
    if (/house/i.test(text)) assert.match(text, /player board|track|house left|leftmost house/i, text);
    assert.ok(!/null|undefined|NaN/.test(text), text);
  }
  assert.ok(sentences.length > 100);
});

suite.finish();
