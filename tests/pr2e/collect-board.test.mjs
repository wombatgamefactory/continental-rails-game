// collect-board.test.mjs - Pacific Rails, second edition: collecting and the special
// actions (P6), storage (P7), hiring (P8) and board activation (P9), with worked
// examples E1, E2 (its part-1 steps) and E7 of P22.
//
// Semantics: permanently green; exits 1 on any failure.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { E, start, act, put, setStorage, build, giveCarriages, types, offered, vp, eventOf, placeAndChoose } from './rig.mjs';

const suite = makeSuite('pr2e collect-board');

// ---------------------------------------------------------------------------
// P6 - collecting
// ---------------------------------------------------------------------------

suite.check('P6.2, P6.5: production is 1 + houses removed from the track; the example board gives 1 Wood, 3 Iron, 3 Gunpowder, 2 Coins', () => {
  const state = start(2);
  const p = state.players[0];
  p.houses = { wood: 3, iron: 1, gunpowder: 1, coins: 2 };
  assert.deepEqual(['wood', 'iron', 'gunpowder', 'coins'].map((t) => E.production(state, 0, t)), [1, 3, 3, 2]);
});

suite.check('E1 (P22), P6.3, P6.7: Collect Iron with production 2, a district house and two action bonuses gives 5; the special action places a district house for 1 Wood and 2 VP', () => {
  const state = start(3); // Anna (Fay) leaves her Iron +1 space empty: Iron production 2
  const fay = state.players[0];
  state.grid.sites.D3[0] = 0; // one district house of hers on Collect Iron (from her Wood track)
  fay.houses.wood -= 1;
  fay.hats = 1;
  put(state, 0, 'W5'); // Collect Iron / Engineer
  giveCarriages(state, 0, [['crew', null]]); // carriage 1: storage 9
  setStorage(state, 0, { wood: 1, coins: 1, ground: 2 }); // 4 of 9
  assert.equal(E.storageCapacity(state, 0), 9);
  assert.equal(E.production(state, 0, 'iron'), 2);
  act(state, { type: 'placeWorker', space: 'W2' }); // Financier / Collect Iron
  const events = act(state, { type: 'chooseDistrict', district: 'D3', hats: 1 });
  assert.equal(eventOf(events, 'districtChosen').multiplier, 3, 'M = 1 + W5 + the hat');
  const gather = eventOf(events, 'gather');
  assert.deepEqual([gather.production, gather.districtHouses, gather.amount], [2, 1, 5], 'yield 2 + 1 + 2');
  assert.equal(fay.resources.iron, 5);
  assert.equal(E.storageUsed(fay), 9);
  // The special action: a district house on Collect Coins, from the Coin track.
  assert.equal(E.topFrame(state).kind, 'specialAction');
  assert.ok(offered(state, { type: 'placeDistrictHouse', district: 'D9', houseTrack: 'coins' }));
  assert.ok(offered(state, { type: 'skipSpecialAction' }));
  const coinsBefore = E.production(state, 0, 'coins');
  act(state, { type: 'placeDistrictHouse', district: 'D9', houseTrack: 'coins' });
  assert.equal(E.production(state, 0, 'coins'), coinsBefore + 1, 'P6.6.2: production rises at once');
  assert.equal(vp(state, 0, 'districtHouse'), 2);
  assert.equal(fay.resources.wood, 0, 'paid 1 Wood');
  assert.equal(E.storageUsed(fay), 8);
  assert.equal(state.grid.sites.D9[0], 0);
  assert.equal(E.districtHousesOn(state, 0, 'D9'), 1);
});

suite.check('P6.6.3: each district house of yours on a district adds 1 when you collect there; not another player\'s', () => {
  const state = start(2);
  state.grid.sites.D9 = [0, 1, 0];
  state.players[0].houses.wood -= 2;
  state.players[1].houses.wood -= 1;
  const events = placeAndChoose(state, 'W10', 'D9'); // Engineer / Collect Coins
  const gather = eventOf(events, 'gather');
  assert.equal(gather.amount, E.production(state, 0, 'coins') + 2);
});

suite.check('P6.6: a district house needs an empty site and a house; P6.6.4: district houses are not buildings', () => {
  const state = start(2);
  state.grid.sites.D1 = [1, 1, 1];
  state.players[1].houses.coins -= 3;
  setStorage(state, 0, { wood: 2 });
  placeAndChoose(state, 'W2', 'D3');
  assert.match(E.getBlockReason(state, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' }), /All 3 building sites of Collect Gunpowder are taken/);
  assert.match(E.getBlockReason(state, { type: 'placeDistrictHouse', district: 'D2', houseTrack: 'wood' }), /no building sites/);
  act(state, { type: 'placeDistrictHouse', district: 'D3', houseTrack: 'wood' });
  assert.equal(E.buildingCount(state, 0), 0, 'not a building (P1.4)');
  assert.equal(E.districtHouseCount(state, 0), 1);
});

suite.check('P6.7: Collect Gunpowder places a telegraph station for 1 Coin only in a city with another player\'s railway station, scoring the row', () => {
  const state = start(2);
  build(state, 'railwayStation', 'SPO', 1);
  build(state, 'railwayStation', 'REN', 0);
  setStorage(state, 0, { coins: 1 });
  placeAndChoose(state, 'W3', 'D1'); // Collect Gunpowder / Crew
  assert.equal(E.topFrame(state).kind, 'specialAction');
  const telegraphs = E.getValidActions(state).filter((a) => a.type === 'placeTelegraphStation').map((a) => a.city);
  assert.deepEqual(telegraphs, ['SPO']);
  assert.match(E.getBlockReason(state, { type: 'placeTelegraphStation', city: 'REN' }), /own the railway station in Reno/);
  assert.match(E.getBlockReason(state, { type: 'placeTelegraphStation', city: 'HEL' }), /only in a city with another player's railway station/);
  act(state, { type: 'placeTelegraphStation', city: 'SPO' });
  assert.equal(state.map.telegraphStation.SPO, 0);
  assert.equal(vp(state, 0, 'telegraph'), E.getConstants(state).PLAYER_BOARD.telegraphRowVp[0]);
  assert.equal(state.players[0].coins, 0);
});

suite.check('P6.7: Collect Coins places a railway station for 1 Iron in a city with another player\'s telegraph station; it brings no carriage (P16.5)', () => {
  const state = start(2);
  build(state, 'telegraphStation', 'HEL', 1);
  setStorage(state, 0, { iron: 1 });
  placeAndChoose(state, 'W12', 'D9'); // Miner / Collect Coins
  assert.equal(E.topFrame(state).kind, 'specialAction');
  assert.deepEqual([...new Set(E.getValidActions(state).filter((a) => a.type === 'placeRailwayStation').map((a) => a.city))], ['HEL']);
  act(state, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'gunpowder' });
  assert.equal(state.map.railwayStation.HEL, 0);
  assert.equal(state.players[0].train.specialistCarriages.length, 0, 'no carriage for a special-action station');
  assert.equal(state.players[0].layStationsPlaced, 0);
  assert.equal(state.players[0].resources.iron, 0, 'paid 1 Iron');
});

suite.check('P6.7: a special action that cannot be paid or carried out is not offered; the engine declines it', () => {
  const state = start(2);
  build(state, 'railwayStation', 'SPO', 1);
  setStorage(state, 0, {}); // no Coin
  const events = placeAndChoose(state, 'W3', 'D1');
  const forced = events.filter((e) => e.type === 'action' && e.auto).map((e) => e.action.type);
  assert.ok(forced.includes('skipSpecialAction'));
  // PART 2: Collect Wood's special action (the upgrade token) is not offered yet.
  const s2 = start(2);
  setStorage(s2, 0, { gunpowder: 3 });
  const ev2 = placeAndChoose(s2, 'W8', 'D7');
  assert.ok(ev2.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipSpecialAction'));
});

suite.check('P6.7: the special action is taken once, whatever M', () => {
  const state = start(2);
  build(state, 'railwayStation', 'SPO', 1);
  build(state, 'railwayStation', 'REN', 1);
  setStorage(state, 0, { coins: 1 }); // 1 + a yield of 4 fits in 6
  put(state, 0, 'W1');
  state.players[0].hats = 2;
  act(state, { type: 'placeWorker', space: 'W3' });
  act(state, { type: 'chooseDistrict', district: 'D1', hats: 2 });
  act(state, { type: 'placeTelegraphStation', city: 'SPO' });
  assert.notEqual(E.topFrame(state).kind, 'specialAction');
  assert.equal(state.players[0].telegraphsPlaced, 1);
});

// ---------------------------------------------------------------------------
// P7 - storage
// ---------------------------------------------------------------------------

suite.check('P7.2, P7.3, P7.6: capacity 6 + 3 per carriage; Coins count; an overflow is discarded at once, any item, Coins included', () => {
  const state = start(2);
  assert.equal(E.storageCapacity(state, 0), 6);
  giveCarriages(state, 0, [[null, null], [null, null]]);
  assert.equal(E.storageCapacity(state, 0), 12);
  giveCarriages(state, 0, []);
  setStorage(state, 0, { coins: 3, ground: 2, wood: 1 }); // 6 of 6
  placeAndChoose(state, 'W12', 'D9'); // collect Coins: overflow
  assert.equal(E.topFrame(state).kind, 'discard');
  assert.ok(offered(state, { type: 'discard', item: 'coins' }));
  assert.ok(offered(state, { type: 'discard', item: 'ground' }));
  assert.ok(!offered(state, { type: 'discard', item: 'iron' }), 'nothing to discard of a kind not held');
  while (E.topFrame(state).kind === 'discard') act(state, { type: 'discard', item: 'coins' });
  assert.equal(E.storageUsed(state.players[0]), 6);
});

suite.check('P7.6: an overflow on another player\'s turn is that player\'s own decision', () => {
  const state = start(3);
  put(state, 1, 'W1');
  put(state, 2, 'W3');
  state.players[1].hats = 2;
  setStorage(state, 1, { iron: 6 });
  state.players[0].hats = 1;
  act(state, { type: 'displaceWorker', district: 'D1' });
  act(state, { type: 'chooseResource', resource: 'wood' }); // Ben, at the hat limit
  assert.equal(E.topFrame(state).kind, 'discard');
  assert.equal(state.toAct, 1, 'Ben discards on Anna\'s turn');
  assert.match(E.getBlockReason(state, { type: 'discard', item: 'iron', player: 0 }), /only when your storage is over capacity/);
});

// ---------------------------------------------------------------------------
// P8 - hiring
// ---------------------------------------------------------------------------

suite.check('E7 (P22), P8.1, P8.3: up to M hires, the first one required, each into the leftmost empty space', () => {
  const state = start(2);
  giveCarriages(state, 0, [['crew', null], [null, null]]);
  put(state, 0, 'W4');
  put(state, 0, 'W6');
  act(state, { type: 'placeWorker', space: 'W7' });
  act(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'hire' });
  assert.equal(E.topFrame(state).kind, 'hire');
  assert.equal(E.topFrame(state).remaining, 3, 'M = 3');
  assert.ok(!types(state).includes('stopHiring'), 'the first hire must be made');
  act(state, { type: 'hireSpecialist', specialist: 'miner' });
  assert.deepEqual(state.players[0].train.specialistCarriages[0].slots, ['crew', 'miner']);
  assert.ok(types(state).includes('stopHiring'));
  act(state, { type: 'hireSpecialist', specialist: 'engineer' });
  assert.deepEqual(state.players[0].train.specialistCarriages[1].slots, ['engineer', null]);
  act(state, { type: 'stopHiring' });
  assert.equal(state.turn.player, 1, 'the action and the turn are over');
});

suite.check('P8.4: a specialist hired into carriage 3 scores 2 VP in space 1 and 5 VP in space 2', () => {
  const state = start(2);
  giveCarriages(state, 0, [['crew', 'crew'], ['miner', 'miner'], [null, null]]);
  put(state, 0, 'W4');
  act(state, { type: 'placeWorker', space: 'W6' });
  act(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'hire' });
  act(state, { type: 'hireSpecialist', specialist: 'engineer' });
  assert.equal(vp(state, 0, 'carriage3'), 2);
  act(state, { type: 'hireSpecialist', specialist: 'financier' });
  assert.equal(vp(state, 0, 'carriage3'), 7);
});

suite.check('P8.2, P3.1.6: a type whose pile is empty cannot be hired; hiring is free without Tycoon Mode', () => {
  const state = start(2);
  giveCarriages(state, 0, [[null, null]]);
  state.supply.specialists.crew = 0;
  setStorage(state, 0, {});
  placeAndChoose(state, 'W4', 'D5', 0, 'hire');
  assert.match(E.getBlockReason(state, { type: 'hireSpecialist', specialist: 'crew' }), /No Crew is left/);
  assert.ok(offered(state, { type: 'hireSpecialist', specialist: 'miner' }), 'free: nothing in storage is needed');
});

suite.check('E7 (P22), P8.5: Tycoon Mode charges by type and by the carriage the specialist goes into', () => {
  const state = start(2, { variants: { tycoonMode: true } });
  giveCarriages(state, 0, [['crew', null], [null, null]]);
  setStorage(state, 0, { gunpowder: 1, wood: 3, coins: 1 });
  put(state, 0, 'W4');
  act(state, { type: 'placeWorker', space: 'W6' });
  act(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'hire' });
  assert.deepEqual(E.hireCost(state, 0, 'miner'), { gunpowder: 1, wood: 1 });
  act(state, { type: 'hireSpecialist', specialist: 'miner' });
  assert.deepEqual(state.players[0].resources, { iron: 0, wood: 2, gunpowder: 0 });
  assert.deepEqual(E.hireCost(state, 0, 'engineer'), { wood: 2, coins: 1 }, 'carriage 2 prices');
  act(state, { type: 'hireSpecialist', specialist: 'engineer' });
  assert.deepEqual([state.players[0].resources.wood, state.players[0].coins], [0, 0]);
});

// ---------------------------------------------------------------------------
// P9 - board activation
// ---------------------------------------------------------------------------

suite.check('P9.2, P9.3: the Foreman M times, then each carriage\'s specialists once; each step pays 1 for 1 built tile', () => {
  const state = start(2);
  giveCarriages(state, 0, [['engineer', 'miner'], ['crew', null]]);
  setStorage(state, 0, { iron: 3, wood: 1, gunpowder: 1 });
  put(state, 0, 'W3'); // adjacent to Crew (D4)
  act(state, { type: 'placeWorker', space: 'W6' }); // Crew / Lay or Hire
  const events = act(state, { type: 'chooseDistrict', district: 'D4', hats: 0 });
  const frame = E.topFrame(state);
  assert.equal(frame.kind, 'boardActivation');
  assert.deepEqual(frame.steps.map((s) => `${s.type}:${s.carriage}`), ['crew:0', 'crew:0', 'engineer:1', 'miner:1', 'crew:2']);
  assert.equal(eventOf(events, 'boardActivation').steps, 5);
  for (let i = 0; i < 5; i++) act(state, { type: 'useStep' });
  assert.deepEqual(state.players[0].builtTiles, { ground: 3, tunnel: 1, bridge: 1 });
  assert.deepEqual(state.players[0].resources, { iron: 0, wood: 0, gunpowder: 0 });
});

suite.check('P9.3, P9.4: a step that cannot be paid is skipped by the engine; a skipped step does not come back', () => {
  const state = start(2);
  giveCarriages(state, 0, [['miner', 'crew']]);
  setStorage(state, 0, { iron: 1 });
  const events = placeAndChoose(state, 'W12', 'D8'); // Miner: Foreman as Miner, then Miner, then Crew
  const autoSkips = events.filter((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep');
  assert.equal(autoSkips.length, 2, 'the two Miner steps had no Gunpowder');
  assert.deepEqual(types(state), ['skipStep', 'useStep'], 'the Crew step can be paid');
  act(state, { type: 'skipStep' });
  assert.equal(state.turn.player, 1);
  assert.equal(state.players[0].resources.iron, 1);
});

suite.check('PART 2: a Financier step offers only skip, so the engine skips it', () => {
  const state = start(2);
  giveCarriages(state, 0, [['financier', null]]);
  setStorage(state, 0, { coins: 5 });
  const events = placeAndChoose(state, 'W1', 'D2');
  assert.equal(events.filter((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep').length, 2);
  assert.match(E.getStructuralBlockReason(state, { type: 'useStep' }) ?? 'none', /none|Financier|board activation/);
  assert.deepEqual(Object.values(state.congress.down), new Array(8).fill(false));
});

suite.finish();
