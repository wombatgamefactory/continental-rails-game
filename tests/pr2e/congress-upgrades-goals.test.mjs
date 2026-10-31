// congress-upgrades-goals.test.mjs - Pacific Rails, second edition: the Financier and
// Congress (P10), cowboy hats from every source (P11), carriage upgrades (P12) and the
// goal tiles (P18), with worked example E2 of P22.
//
// Semantics: permanently green; exits 1 on any failure. Every Congress column, the
// Reset, every upgrade level and every goal measure is exercised.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { E, start, act, put, setStorage, layRoutes, build, giveCarriages, types, offered, vp, eventOf, placeAndChoose } from './rig.mjs';

const suite = makeSuite('pr2e congress-upgrades-goals');

/** Anna at the Foreman's Financier step (she places on W1 and takes the Financier district), holding `items`. */
function atFinancier(players = 2, items = { coins: 5 }, options = {}) {
  const state = start(players, options);
  setStorage(state, 0, items);
  if (options.carriages) giveCarriages(state, 0, options.carriages);
  placeAndChoose(state, 'W1', 'D2');
  return state;
}

function take(state, column) {
  return act(state, { type: 'takeCongressColumn', column });
}

// ---------------------------------------------------------------------------
// P10 - the Financier and Congress
// ---------------------------------------------------------------------------

suite.check('P10.1, P10.2: a Financier step offers the affordable columns, the Reset when a senator is down, or skip', () => {
  const state = atFinancier(2, { coins: 1 });
  assert.equal(E.topFrame(state).kind, 'boardActivation');
  const cols = E.getValidActions(state).filter((a) => a.type === 'takeCongressColumn').map((a) => a.column);
  assert.deepEqual(cols, ['K1', 'K2', 'K3', 'K4'], 'one Coin buys only the 1-Coin columns (K5 / K6 cost 2, K7 / K8 cost 3)');
  assert.ok(!types(state).includes('resetSenators'), 'no senator down: no Reset (P10.2.2)');
  assert.match(E.getBlockReason(state, { type: 'resetSenators' }), /No senator is down/);
  assert.match(E.getBlockReason(state, { type: 'takeCongressColumn', column: 'K7' }), /Column K7 costs 3 Coins and you have 1 Coin/);
  assert.ok(types(state).includes('skipStep'));
  assert.match(E.getBlockReason(state, { type: 'useStep' }), /takes a Congress column or a Reset/);
});

suite.check('P10.3: K1, K2, K3 give 2 Wood, 2 Gunpowder, 2 Iron for 1 Coin; the senator goes down and nobody can take the column again', () => {
  for (const [column, item] of [['K1', 'wood'], ['K2', 'gunpowder'], ['K3', 'iron']]) {
    const state = atFinancier(2, { coins: 2 });
    const events = take(state, column);
    assert.equal(state.players[0].resources[item], 2, column);
    assert.equal(state.players[0].coins, 1);
    assert.equal(state.congress.down[column], true);
    assert.equal(eventOf(events, 'congressEntry').entry, column);
    assert.match(E.getStructuralBlockReason(state, { type: 'takeCongressColumn', column, player: 1 }), /senator of column .* is down/);
  }
});

suite.check('P10.3.2, P11.1: K4 gives 2 hats; over the limit each extra hat is a resource of choice (Coin allowed), or lost with hatOverflow = lost', () => {
  const state = atFinancier(2, { coins: 1 });
  state.players[0].hats = 1;
  take(state, 'K4');
  assert.equal(state.players[0].hats, 2);
  assert.equal(E.topFrame(state).kind, 'chooseResource');
  assert.deepEqual(E.getValidActions(state).map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
  act(state, { type: 'chooseResource', resource: 'coins' });
  assert.equal(state.players[0].coins, 1);
  const lost = atFinancier(2, { coins: 2 }, { variants: { hatOverflow: 'lost' } });
  lost.players[0].hats = 1;
  const events = take(lost, 'K4');
  assert.equal(lost.players[0].hats, 2);
  assert.notEqual(E.topFrame(lost)?.kind, 'chooseResource', 'the extra hat is simply lost');
  assert.equal(eventOf(events, 'hatLimit').resourcesOwed, 0);
  // With `lost` and 2 hats already, K4 would give nothing, so it cannot be taken (P10.3.6).
  const full = atFinancier(2, { coins: 2 }, { variants: { hatOverflow: 'lost' } });
  full.players[0].hats = 2;
  assert.match(E.getBlockReason(full, { type: 'takeCongressColumn', column: 'K4' }), /would give you nothing/);
});

suite.check('P11.2: hats gained during a turn (K4) are spent at a later district choice, each for one action bonus', () => {
  const state = atFinancier(2, { coins: 1 });
  take(state, 'K4');
  assert.equal(state.players[0].hats, 2);
  // Anna's next turn: both hats on one action.
  const rng = E.makeRng('hats');
  while (state.turn.player !== 0) act(state, E.rngPick(rng, E.getValidActions(state)));
  act(state, { type: 'placeWorker', space: 'W12' });
  assert.ok(offered(state, { type: 'chooseDistrict', district: 'D9', hats: 2 }));
  const ev = act(state, { type: 'chooseDistrict', district: 'D9', hats: 2 });
  assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
});

suite.check('P10.3.3: K5 places a district house (free) or installs an upgrade token, and either way gives 1 VP; it cannot replace', () => {
  const state = atFinancier(2, { coins: 2 });
  take(state, 'K5');
  assert.equal(E.topFrame(state).kind, 'congressPlacement');
  assert.deepEqual(types(state), ['placeDistrictHouse'], 'no carriage: only the district house half');
  act(state, { type: 'placeDistrictHouse', district: 'D7', houseTrack: 'wood' });
  assert.equal(state.grid.sites.D7[0], 0);
  assert.equal(vp(state, 0, 'congress'), 1);
  assert.equal(vp(state, 0, 'districtHouse'), 0, 'not the special action\'s 2 VP');
  // The upgrade half, into the first free carriage; no replacing.
  const s2 = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
  s2.players[0].train.specialistCarriages[0].upgrade = 'U1-iron';
  s2.supply.upgrades.splice(s2.supply.upgrades.indexOf('U1-iron'), 1);
  s2.grid.sites.D1 = [1, 1, 1];
  s2.grid.sites.D3 = [1, 1, 1];
  s2.grid.sites.D7 = [1, 1, 1];
  s2.grid.sites.D9 = [1, 1, 1];
  assert.match(E.getBlockReason(s2, { type: 'takeCongressColumn', column: 'K5' }), /neither/);
  const s3 = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
  take(s3, 'K5');
  act(s3, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 });
  assert.equal(s3.players[0].train.specialistCarriages[0].upgrade, 'U1-coins');
  assert.equal(vp(s3, 0, 'congress'), 1);
  assert.equal(vp(s3, 0, 'upgrade'), 0);
});

suite.check('P10.3.5: K6 gives 4 resources of choice, never Coins', () => {
  const state = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
  take(state, 'K6');
  assert.equal(E.topFrame(state).kind, 'chooseResource');
  assert.deepEqual(E.getValidActions(state).map((a) => a.resource).sort(), ['gunpowder', 'iron', 'wood']);
  assert.match(E.getBlockReason(state, { type: 'chooseResource', resource: 'coins' }), /not Coin/);
  for (const r of ['iron', 'iron', 'wood', 'gunpowder']) act(state, { type: 'chooseResource', resource: r });
  assert.deepEqual(state.players[0].resources, { iron: 2, wood: 1, gunpowder: 1 });
});

suite.check('P10.3.4: K7 places a railway station (empty city on the network, or with another\'s telegraph station) and / or a telegraph station (with another\'s railway station); no carriage', () => {
  const state = atFinancier(3, { coins: 3 });
  layRoutes(state, ['SEA-TDL']);
  build(state, 'railwayStation', 'REN', 1);
  build(state, 'telegraphStation', 'BOI', 2);
  take(state, 'K7');
  assert.equal(E.topFrame(state).kind, 'congressPlacement');
  const rail = [...new Set(E.getValidActions(state).filter((a) => a.type === 'placeRailwayStation').map((a) => a.city))].sort();
  assert.deepEqual(rail, ['BOI', 'TDL'], 'The Dalles (empty, a laid route ends there) and Boise (Cara\'s telegraph station)');
  const tele = E.getValidActions(state).filter((a) => a.type === 'placeTelegraphStation').map((a) => a.city);
  assert.deepEqual(tele, ['REN'], 'Reno (Ben\'s railway station)');
  assert.match(E.getBlockReason(state, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'wood' }), /only in a city with no building that a laid route reaches/);
  assert.match(E.getBlockReason(state, { type: 'skipBuilding' }), /at least one building/);
  act(state, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'wood' });
  assert.equal(state.players[0].train.specialistCarriages.length, 0, 'P16.5: no carriage for a K7 station');
  assert.equal(state.players[0].layStationsPlaced, 0);
  assert.ok(types(state).includes('skipBuilding') && types(state).includes('placeTelegraphStation'));
  act(state, { type: 'placeTelegraphStation', city: 'REN' });
  assert.equal(vp(state, 0, 'telegraph'), 1);
  assert.notEqual(E.topFrame(state)?.kind, 'congressPlacement', 'both placed: the reward is done');
  // Nowhere to build: K7 cannot be taken.
  const none = atFinancier(2, { coins: 3 });
  assert.match(E.getBlockReason(none, { type: 'takeCongressColumn', column: 'K7' }), /nowhere you can/);
});

suite.check('P10.3.5: K8 gives 2 built tiles of any types, chosen one at a time', () => {
  const state = atFinancier(2, { coins: 3 });
  take(state, 'K8');
  assert.equal(E.topFrame(state).kind, 'chooseBuiltTile');
  act(state, { type: 'chooseBuiltTile', terrain: 'bridge' });
  act(state, { type: 'chooseBuiltTile', terrain: 'tunnel' });
  assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 1, bridge: 1 });
  assert.match(E.getBlockReason(state, { type: 'chooseBuiltTile', terrain: 'ground' }), /not owed a built tile/);
});

suite.check('P10.2.2: the Reset costs 1 Coin, returns every senator that is down and scores 1 VP each', () => {
  const state = atFinancier(2, { coins: 2 });
  for (const id of ['K2', 'K5', 'K6']) state.congress.down[id] = true;
  assert.ok(types(state).includes('resetSenators'));
  const events = act(state, { type: 'resetSenators' });
  assert.equal(eventOf(events, 'senatorsReset').count, 3);
  assert.equal(vp(state, 0, 'congress'), 3);
  assert.equal(state.players[0].coins, 1);
  assert.deepEqual(Object.values(state.congress.down), new Array(8).fill(false));
});

suite.check('E2 (P22): Foreman twice as a Financier (K1, then K6), the Wood upgrade, the Engineer, then the Financier resets four senators', () => {
  const state = start(3);
  giveCarriages(state, 0, [['engineer', 'financier']]);
  state.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
  state.supply.upgrades.splice(state.supply.upgrades.indexOf('U1-wood'), 1);
  for (const id of ['K2', 'K5']) state.congress.down[id] = true;
  setStorage(state, 0, { coins: 4, wood: 1 });
  put(state, 0, 'W1');
  act(state, { type: 'placeWorker', space: 'W4' }); // Financier / Lay or Hire: only the Financier can be chosen, so the engine chose it
  assert.deepEqual(E.topFrame(state).steps.map((s) => `${s.type}:${s.carriage}`), ['financier:0', 'financier:0', 'upgrade:1', 'engineer:1', 'financier:1']);
  take(state, 'K1');
  assert.deepEqual([state.players[0].coins, state.players[0].resources.wood], [3, 3]);
  take(state, 'K6');
  for (const r of ['iron', 'iron', 'gunpowder', 'gunpowder']) act(state, { type: 'chooseResource', resource: r });
  assert.equal(state.players[0].coins, 1);
  // The upgrade step gave 1 Wood by itself; now the Engineer.
  assert.equal(state.players[0].resources.wood, 4);
  assert.equal(E.storageUsed(state.players[0]), 9);
  act(state, { type: 'useStep' });
  assert.equal(state.players[0].builtTiles.bridge, 1);
  // The Financier: four senators down (K1, K2, K5, K6); the Reset scores 4 VP.
  act(state, { type: 'resetSenators' });
  assert.equal(vp(state, 0, 'congress'), 4);
  assert.equal(E.storageUsed(state.players[0]), 8);
});

// ---------------------------------------------------------------------------
// P12 - carriage upgrades
// ---------------------------------------------------------------------------

/** Anna at the Collect Wood special action, holding `gunpowder`, with `carriages`. */
function atCollectWood(players, carriages, gunpowder = 1, variants = {}) {
  const state = start(players, { variants });
  giveCarriages(state, 0, carriages);
  setStorage(state, 0, { gunpowder });
  placeAndChoose(state, 'W8', 'D7'); // Crew / Collect Wood
  return state;
}

suite.check('P3.1.5, P12.1: the upgrade supply has 10, 15 or 20 tokens by player count, with the right levels', () => {
  const count = (s, level) => s.supply.upgrades.filter((t) => E.upgradeTileData(s, t).level === level).length;
  for (const [players, l1, l2, l3] of [[2, 4, 4, 2], [3, 6, 6, 3], [4, 8, 8, 4]]) {
    const s = start(players);
    assert.deepEqual([count(s, 1), count(s, 2), count(s, 3)], [l1, l2, l3], `${players} players`);
  }
});

suite.check('P6.7, P12.2: Collect Wood installs a token for 1 Gunpowder and 2 VP; the level equals the carriage number; first-free', () => {
  const state = atCollectWood(2, [['crew', null], ['miner', null]]);
  assert.equal(E.topFrame(state).kind, 'specialAction');
  const offers = E.getValidActions(state).filter((a) => a.type === 'installUpgrade');
  assert.ok(offers.every((a) => a.carriage === 1 && a.token.startsWith('U1-')), 'P12.2.3, P12.2.4: level 1 tokens on carriage 1 only');
  assert.match(E.getBlockReason(state, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 }), /leftmost carriage with a specialist and no token: carriage 1/);
  assert.match(E.getBlockReason(state, { type: 'installUpgrade', token: 'U2-wood', carriage: 1 }), /A level 2 token goes only on carriage 2/);
  act(state, { type: 'installUpgrade', token: 'U1-gunpowder', carriage: 1 });
  assert.equal(state.players[0].train.specialistCarriages[0].upgrade, 'U1-gunpowder');
  assert.equal(vp(state, 0, 'upgrade'), 2);
  assert.equal(state.players[0].resources.gunpowder, 0, 'paid 1 Gunpowder');
  assert.ok(!state.supply.upgrades.includes('U1-gunpowder'), 'the only U1-gunpowder of a 2-player game left the supply');
});

suite.check('P12.2.4: with upgradePlacement = any-carriage a token may go on any carriage meeting the other conditions', () => {
  const state = atCollectWood(2, [['crew', null], ['miner', null]], 1, { upgradePlacement: 'any-carriage' });
  assert.equal(E.getBlockReason(state, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 }), null);
});

suite.check('P12.2.1: a carriage with no specialist takes no token', () => {
  const state = atCollectWood(2, [[null, null]]);
  assert.match(E.getStructuralBlockReason(state, { type: 'installUpgrade', token: 'U1-wood', carriage: 1, player: 0 }), /holds no specialist/);
});

suite.check('P12.3: Collect Wood may replace a token with another of the same level, scoring nothing; the old one returns to the supply', () => {
  const state = atCollectWood(2, [['crew', null]]);
  state.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
  state.supply.upgrades.splice(state.supply.upgrades.indexOf('U1-wood'), 1);
  // (the special action frame was pushed before the token was placed by hand; the offer is read live)
  assert.equal(E.getBlockReason(state, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 }), null);
  assert.match(E.getBlockReason(state, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 }), /same token|No U1-wood/);
  act(state, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 });
  assert.equal(state.players[0].train.specialistCarriages[0].upgrade, 'U1-coins');
  assert.ok(state.supply.upgrades.includes('U1-wood'));
  assert.equal(vp(state, 0, 'upgrade'), 0, 'replacing scores no VP');
});

suite.check('P12.4: in an activation each token acts once, before its carriage\'s specialists: level 1 gives 1, level 2 gives 2, level 3 asks for 3 of choice', () => {
  const state = start(2);
  giveCarriages(state, 0, [['crew', null], ['crew', null], ['crew', null]]);
  const carriages = state.players[0].train.specialistCarriages;
  for (const [i, token] of ['U1-iron', 'U2-gunpowder', 'U3-choice'].entries()) {
    carriages[i].upgrade = token;
    state.supply.upgrades.splice(state.supply.upgrades.indexOf(token), 1);
  }
  setStorage(state, 0, {});
  put(state, 0, 'W3');
  act(state, { type: 'placeWorker', space: 'W6' });
  const events = act(state, { type: 'chooseDistrict', district: 'D4', hats: 0 }); // Crew, M = 2
  // The Foreman twice cannot be paid (no Iron) - skipped; then the U1-iron token gives 1 Iron: the carriage 1 Crew can use it.
  assert.ok(events.some((e) => e.type === 'upgradeStep' && e.level === 1 && e.amount === 1));
  assert.equal(state.players[0].resources.iron, 1);
  act(state, { type: 'useStep' });
  // Level 2: 2 Gunpowder at once.
  assert.equal(state.players[0].resources.gunpowder, 2);
  // Carriage 2's Crew: no Iron left, skipped by the engine; then the level 3 token asks for 3 of choice.
  assert.equal(E.topFrame(state).kind, 'chooseResource');
  assert.equal(E.topFrame(state).remaining, 3);
  assert.deepEqual(E.getValidActions(state).map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
  act(state, { type: 'chooseResource', resource: 'iron' });
  act(state, { type: 'chooseResource', resource: 'coins' });
  act(state, { type: 'chooseResource', resource: 'wood' });
  // Carriage 3's Crew can now use that Iron.
  assert.deepEqual(E.waitingStep(E.topFrame(state)), { type: 'crew', carriage: 3, slot: 0 });
  act(state, { type: 'useStep' });
  assert.equal(state.players[0].builtTiles.ground, 2);
});

// ---------------------------------------------------------------------------
// P18 - the goal tiles
// ---------------------------------------------------------------------------

suite.check('P3.1.7, P18.1: 4 of the 12 goal tiles are drawn at setup with the game RNG, in order; the rest are not stored', () => {
  const seen = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const s = start(3, { seed });
    assert.equal(s.goals.length, 4);
    s.goals.forEach((g) => seen.add(g));
    assert.deepEqual(E.goalsInPlay(s).map((g) => g.id), s.goals);
  }
  assert.equal(seen.size, 12);
  assert.deepEqual(start(3, { seed: 7 }).goals, start(3, { seed: 7 }).goals, 'the same seed, the same goals');
});

suite.check('P18.2: each of the 12 measures counts what its goal says', () => {
  const state = start(2);
  const p = 0;
  build(state, 'railwayStation', 'SPO', p);
  build(state, 'railwayStation', 'REN', p);
  build(state, 'telegraphStation', 'HEL', p);
  giveCarriages(state, p, [['crew', 'financier'], ['engineer', 'miner'], ['crew', null]]);
  state.players[p].train.specialistCarriages[0].upgrade = 'U1-wood';
  setStorage(state, p, { iron: 1, coins: 2, gunpowder: 3, wood: 4 });
  setStorage(state, 1, {});
  state.grid.sites.D3[0] = p;
  const expected = { railwayStations: 2, crew: 2, financiers: 1, ironStored: 1, telegraphStations: 1, engineers: 1, coinsStored: 2, gunpowderStored: 3, districtHouses: 1, miners: 1, woodStored: 4, upgradesInstalled: 1 };
  for (const goal of E.GOAL_TILES) {
    assert.equal(E.metricValue(state, p, goal.metric), expected[goal.metric], `${goal.id} ${goal.metric}`);
    assert.equal(E.metricValue(state, 1, goal.metric), 0, `${goal.id} for Ben`);
    assert.equal(E.describeProgress(state, p, goal).known, true);
  }
  assert.equal(E.describeProgress(state, p, E.GOAL_TILES[0]).text, '2 railway stations');
});

suite.check('P18.3: a goal pays 5 VP to a sole leader; a tie for the highest, or nobody above 0, pays nobody; scored left to right at the end', () => {
  const state = start(3);
  const goal = E.GOAL_TILES.find((g) => g.metric === 'coinsStored');
  setStorage(state, 0, { coins: 3 });
  setStorage(state, 1, { coins: 2 });
  setStorage(state, 2, { coins: 0 });
  assert.deepEqual(E.goalStandings(state, goal).awards, [5, 0, 0]);
  setStorage(state, 1, { coins: 3 });
  assert.deepEqual(E.goalStandings(state, goal).awards, [0, 0, 0], 'tie for the highest');
  for (const pid of [0, 1, 2]) setStorage(state, pid, {});
  assert.deepEqual(E.goalStandings(state, goal).awards, [0, 0, 0], 'everybody 0');
  // Final scoring books the goals in play.
  state.goals = ['G7', 'G4', 'G8', 'G11'];
  setStorage(state, 2, { coins: 1, iron: 1 });
  const score = E.scoreGame(state);
  assert.equal(score.players[2].bySource.goals, 10, 'sole leader of Coins and of Iron');
});

suite.finish();
