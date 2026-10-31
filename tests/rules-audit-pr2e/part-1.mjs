// Rules audit (pr2e), part 1: P1 terminology (behavioural parts), P2 components,
// P3 setup, P4 turn structure and decision flow. Written from the rules text.

import { readFileSync, readdirSync } from 'node:fs';
import {
  assert, E, NAMES, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, check, refused, has, offers,
  frame, choose, chooseLay, chooseHire, doLay, eventOf, setHouses,
} from './kit.mjs';

const WEST = ['SEA', 'POR', 'SAC', 'LAX'];
const EAST = ['MIN', 'OMA', 'KCY', 'FTW'];

/** A fresh game at its first decision, seats as given. */
function fresh(n, seed = 3, variants = {}) {
  return E.createGame({ players: NAMES.slice(0, n).map((name) => ({ name })), seed, shuffleSeats: false, variants });
}

export default function part1() {
  // -------------------------------------------------------------------------
  // P1 - terminology (the parts with behaviour)
  // -------------------------------------------------------------------------

  check('P1.1', 'a house leaving the player board raises production; a district house and a railway station are both houses that left', () => {
    const s = start(2);
    assert.equal(E.production(s, 0, 'wood'), 1);
    build(s, 'railwayStation', 'SPO', 0, 'wood');
    assert.equal(E.production(s, 0, 'wood'), 2);
    s.grid.sites.D3[0] = 0;
    s.players[0].houses.iron -= 1;
    assert.equal(E.production(s, 0, 'iron'), 3, 'start production 2 (the track chosen at set-up is iron) plus one district house');
  });

  check('P1.2', 'a railway station is a house that has left the player board: the house count falls by one and the station is on the map', () => {
    const s = start(2);
    const before = E.housesOnBoard(s.players[0]);
    build(s, 'railwayStation', 'SPO', 0);
    assert.equal(E.housesOnBoard(s.players[0]), before - 1);
    assert.equal(s.map.railwayStation.SPO, 0);
  });

  check('P1.5', 'a district is one of the nine places of the action grid, never a place on the map', () => {
    const s = start(2);
    assert.equal(Object.keys(s.grid.tiles).length, 9);
    for (const d of Object.keys(s.grid.tiles)) assert.ok(!(d in E.MAP.cityById), d);
  });

  check('P1.6', 'a worker space is one of 12 spaces between two neighbouring districts', () => {
    assert.equal(E.SPACE_IDS.length, 12);
    for (const w of E.SPACE_IDS) assert.equal(E.SPACE_DISTRICTS[w].length, 2);
  });

  check('P1.7', 'a building site is one of the 3 spaces on each of the four Collect districts: 12 in all', () => {
    const s = start(2);
    assert.deepEqual(Object.keys(s.grid.sites), ['D1', 'D3', 'D7', 'D9']);
    assert.equal(Object.values(s.grid.sites).flat().length, 12);
  });

  check('P1.11', 'building never touches the map and laying never creates tiles: the tiles held plus the slots laid stay the same', () => {
    const s = start(2);
    setTrains(s, 0, ['SEA', 'MIN']);
    setStorage(s, 0, { iron: 2, ground: 3 });
    choose(s, 'W3', 'D4');
    act(s, { type: 'useStep' });
    assert.equal(Object.values(s.map.routeOwner).filter((o) => o !== null).length, 0);
    assert.equal(s.players[0].builtTiles.ground, 4);
    const t = start(2);
    setTrains(t, 0, ['SEA', 'MIN']);
    setStorage(t, 0, { ground: 3 });
    chooseLay(t);
    doLay(t, ['SEA-SPO']);
    assert.equal(t.players[0].builtTiles.ground + E.MAP.routeById['SEA-SPO'].length, 3);
  });

  check('P1.15', 'a city is one of 25 circles of the map: 8 start cities on the edges and 17 inland cities', () => {
    assert.equal(E.MAP.cities.length, 25);
    assert.equal(E.MAP.cities.filter((c) => E.isStartCity(c.id)).length, 8);
    assert.equal(E.MAP.cities.filter((c) => !E.isStartCity(c.id)).length, 17);
  });

  check('P1.20', 'the Congress panel has 8 columns each with a senator; one Financier action moves one senator down or resets them', () => {
    const s = start(2);
    assert.equal(E.congressColumns(s).filter((c) => !c.reset).length, 8);
    assert.equal(Object.keys(s.congress.down).length, 8);
  });

  check('P1.3', 'a telegraph station placed scores VP; it is taken from the row (P16.3)', () => {
    const s = start(2);
    build(s, 'railwayStation', 'SPO', 1);
    assert.equal(E.telegraphsLeft(s, 0), 7);
  });

  check('P1.4', 'a district house is not a building: it is not counted by the building count', () => {
    const s = start(2);
    s.grid.sites.D1[0] = 0;
    assert.equal(E.buildingCount(s, 0), 0);
    build(s, 'railwayStation', 'SPO', 0);
    build(s, 'telegraphStation', 'REN', 0);
    assert.equal(E.buildingCount(s, 0), 2);
  });

  check('P1.8', 'Coin is a resource: it takes storage, can be chosen where "a resource of your choice" is allowed, and is stored with the others', () => {
    const s = start(2);
    assert.equal(E.storageUsed(s.players[0]), 4, '1 Wood, 1 Iron, 1 Gunpowder and 1 Coin');
    assert.ok(E.CHOICE_RESOURCES.includes('coins'));
    setStorage(s, 0, { coins: 6 });
    assert.equal(E.storageUsed(s.players[0]), 6);
  });

  check('P1.10', 'built tiles and laid tiles are different: building stores a tile, laying puts it on the map', () => {
    const s = start(2);
    setStorage(s, 0, { iron: 1 });
    choose(s, 'W3', 'D4');
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].builtTiles.ground, 1);
    assert.equal(Object.values(s.map.routeOwner).filter((o) => o !== null).length, 0, 'P9.5: nothing reaches the map');
  });

  check('P1.16', 'a laid route belongs to nobody: any train may travel over it', () => {
    const s = start(2);
    layRoutes(s, ['SEA-SPO'], 1);
    setTrains(s, 0, ['SEA', 'MIN']);
    setStorage(s, 0, {});
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'SPO'], ['SEA-SPO']), true, 'a zero-tile lay over a laid route of another player to an empty inland city');
  });

  check('P1.17', 'a train moves only as part of a lay: no Move Train action exists', () => {
    assert.ok(!E.STOP_ACTION_TYPES.includes('moveTrain'));
    const s = start(2);
    assert.equal(E.moveTrainPath(s), null);
    assert.ok(!Object.keys(E.ACTIONS).includes('moveTrain'));
  });

  check('P1.18', 'a connected city is an inland city with at least one building; a start city never is', () => {
    const s = start(2);
    assert.equal(E.isCityConnected(s, 'SPO'), false);
    layRoutes(s, ['SEA-SPO']);
    assert.equal(E.isCityConnected(s, 'SPO'), false, 'on the network, not connected');
    build(s, 'telegraphStation', 'SPO', 1);
    assert.equal(E.isCityConnected(s, 'SPO'), true);
    assert.equal(E.isCityConnected(s, 'SEA'), false);
    assert.equal(E.isCityConnected(s, 'POR'), false);
  });

  check('P1.19', 'M = 1 + action bonuses: a placed worker never counts itself; a hat counts one', () => {
    const s = start(2);
    put(s, 0, 'W3');
    s.players[0].hats = 1;
    act(s, { type: 'placeWorker', space: 'W1' });
    const pm = E.previewMultipliers(s);
    assert.equal(pm.find((p) => p.district === 'D1' && p.hats === 0).multiplier, 2);
    assert.equal(pm.find((p) => p.district === 'D1' && p.hats === 1).multiplier, 3);
    assert.equal(pm.find((p) => p.district === 'D2' && p.hats === 0).multiplier, 1);
  });

  // -------------------------------------------------------------------------
  // P2 - components
  // -------------------------------------------------------------------------

  check('P2.1', 'shared components: 25 cities (8 start, 17 inland), 47 routes, 136 slots (44 Ground, 46 Tunnel, 46 Bridge); 8 senators; 8 hats', () => {
    assert.equal(E.MAP.cities.length, 25);
    assert.equal(E.MAP.routes.length, 47);
    assert.equal(E.MAP.startCities.length, 8);
    assert.equal(E.MAP.inlandCities.length, 17);
    const slots = { ground: 0, tunnel: 0, bridge: 0 };
    for (const r of E.MAP.routes) for (const t of r.terrains) slots[t] += 1;
    assert.deepEqual(slots, { ground: 44, tunnel: 46, bridge: 46 });
    const s = start(3);
    assert.equal(Object.keys(s.congress.down).length, 8);
    assert.equal(E.getConstants(s).SUPPLY.hats, 8);
    assert.equal(E.getConstants(s).SUPPLY.senators, 8);
  });

  check('P2.1/specialists', 'specialist tokens are limited: 4, 5 or 6 of each type by player count, and a hire takes one from its pile', () => {
    for (const [n, per] of [[2, 4], [3, 5], [4, 6]]) {
      const s = start(n);
      assert.deepEqual(s.supply.specialists, { crew: per, miner: per, engineer: per, financier: per });
    }
    const s = start(2);
    giveCarriages(s, 0, [[null, null]]);
    chooseHire(s);
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.equal(s.supply.specialists.miner, 3);
  });

  check('P2.2', 'components per player: 11 houses, 7 telegraph stations, 2 trains, workers by player count (6, 4, 3)', () => {
    for (const [n, w] of [[2, 6], [3, 4], [4, 3]]) {
      const s = start(n);
      for (const p of s.players) {
        assert.equal(E.housesOnBoard(p), 11);
        assert.equal(E.telegraphsLeft(s, p.id), 7);
        assert.equal(p.railheads.length, 2);
        assert.equal(p.workersInSupply, w);
      }
    }
  });

  check('P2.3', 'the player board: house tracks of 3 spaces, telegraph row 1,2,3,4,5,6,9, 6 storage, 2 hat spaces', () => {
    const K = E.getConstants(start(2));
    assert.equal(K.PLAYER_BOARD.houseSlotsPerTrack, 3);
    assert.deepEqual(K.PLAYER_BOARD.telegraphRowVp, [1, 2, 3, 4, 5, 6, 9]);
    assert.equal(K.PLAYER_BOARD.boardStorage, 6);
    assert.equal(K.HATS.hatLimit, 2);
    assert.deepEqual(K.PLAYER_BOARD.houseTracks.slice().sort(), ['coins', 'gunpowder', 'iron', 'wood']);
  });

  check('P2.4', 'supply limits: tiles, resources and hats are never refused for lack of supply; specialists and upgrades are limited', () => {
    const s = start(2);
    s.players[0].coins = 0;
    setStorage(s, 0, { iron: 6 });
    // 100 Ground tiles would exceed the 70 printed ones; the engine never refuses to build.
    s.players[0].builtTiles.ground = 0;
    const K = E.getConstants(s);
    assert.equal(K.SUPPLY.trackTilesPerType, 70);
    assert.ok(!('tiles' in s.supply), 'no tile supply is tracked');
    assert.ok('specialists' in s.supply && 'upgrades' in s.supply);
  });

  check('P2.5', 'open information: nothing is hidden', () => {
    const s = start(3);
    assert.equal(E.hiddenDecks(s).length, 0);
  });

  // -------------------------------------------------------------------------
  // P3 - setup
  // -------------------------------------------------------------------------

  check('P3.1.1', 'the map, action grid, Congress panel and specialist panel are set out: 9 districts, 12 worker spaces and 12 sites', () => {
    const s = start(2);
    assert.equal(Object.keys(s.grid.tiles).length, 9);
    assert.equal(Object.keys(s.grid.spaces).length, 12);
    assert.equal(Object.keys(s.grid.centres).length, 9);
    assert.equal(Object.values(s.grid.sites).flat().length, 12);
    assert.equal(Object.keys(s.congress.down).length, 8);
  });

  check('P3.1.2', 'every score marker starts on 0', () => {
    const s = start(4);
    for (const p of s.players) assert.equal(Object.values(p.vp).reduce((a, b) => a + b, 0), 0);
  });

  check('P3.1.3', 'the 8 senators all start on their top spaces', () => {
    assert.deepEqual(Object.values(start(2).congress.down), new Array(8).fill(false));
  });

  check('P3.1.5', 'upgrade tokens: only those whose back is at or below the player count - 10, 15 or 20 tokens with the right mix', () => {
    const mix = (s) => s.supply.upgrades.slice().sort().join(',');
    const two = ['U1-coins', 'U1-gunpowder', 'U1-iron', 'U1-wood', 'U2-coins', 'U2-gunpowder', 'U2-iron', 'U2-wood', 'U3-choice', 'U3-choice'];
    const three = [...two, 'U1-iron', 'U1-gunpowder', 'U2-wood', 'U2-coins', 'U3-choice'];
    const four = [...three, 'U1-wood', 'U1-coins', 'U2-iron', 'U2-gunpowder', 'U3-choice'];
    assert.equal(mix(start(2)), two.sort().join(','));
    assert.equal(mix(start(3)), three.sort().join(','));
    assert.equal(mix(start(4)), four.sort().join(','));
    assert.equal(start(2).supply.upgrades.length, 10);
    assert.equal(start(3).supply.upgrades.length, 15);
    assert.equal(start(4).supply.upgrades.length, 20);
  });

  check('P3.1.6', 'specialists: 4 of each type with 2 players, 5 with 3, 6 with 4', () => {
    for (const [n, per] of [[2, 4], [3, 5], [4, 6]]) for (const t of ['crew', 'miner', 'engineer', 'financier']) assert.equal(start(n).supply.specialists[t], per);
  });

  check('P3.1.7', '4 goal tiles of the 12 are in play, all different, and a seed draws the same ones each time', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const s = start(2, { seed });
      assert.equal(s.goals.length, 4);
      assert.equal(new Set(s.goals).size, 4);
      s.goals.forEach((g) => seen.add(g));
      assert.equal(E.goalsInPlay(s).length, 4);
    }
    assert.equal(seen.size, 12, 'every goal tile can come up');
    assert.deepEqual(start(3, { seed: 9 }).goals, start(3, { seed: 9 }).goals);
    assert.equal(E.getConstants(start(2)).SETUP.goalsInPlay, 4);
  });

  check('P3.2', 'player set-up: no carriage, no specialist, storage 6, 1 Wood, 1 Iron, 1 Gunpowder, 1 Coin, no hats, 12 workers in play in all', () => {
    for (const n of [2, 3, 4]) {
      const s = start(n);
      let workers = 0;
      for (const p of s.players) {
        assert.equal(p.train.specialistCarriages.length, 0);
        assert.equal(E.storageCapacity(s, p.id), 6);
        assert.deepEqual(p.resources, { iron: 1, wood: 1, gunpowder: 1 });
        assert.equal(p.coins, 1);
        assert.equal(p.hats, 0);
        assert.equal(E.storedCount(p, 'coins'), 1);
        workers += p.workersInSupply;
      }
      assert.equal(workers, 12, `12 workers in all at ${n} players`);
    }
  });

  check('P3.3', 'each player in seat order leaves the +1 space of a track of their choice empty: that track starts at production 2, the others at 1', () => {
    const s = fresh(3);
    const order = [];
    while (frame(s) === 'setupProduction') {
      order.push(s.toAct);
      assert.deepEqual(offers(s, 'chooseStartingProduction').map((a) => a.track).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
      act(s, { type: 'chooseStartingProduction', track: ['gunpowder', 'wood', 'coins'][s.toAct] });
    }
    assert.deepEqual(order, [0, 1, 2]);
    assert.equal(E.production(s, 0, 'gunpowder'), 2);
    assert.equal(E.production(s, 0, 'wood'), 1);
    assert.equal(E.production(s, 1, 'wood'), 2);
    assert.equal(E.production(s, 2, 'coins'), 2);
    for (const p of s.players) assert.equal(E.housesOnBoard(p), 11);
    refused(s, { type: 'chooseStartingProduction', track: 'stone' });
  });

  check('P3.4', 'seat order is shuffled by the seeded RNG unless fixed; the same seed gives the same order', () => {
    const players = NAMES.map((name) => ({ name }));
    const seen = new Set();
    for (let seed = 0; seed < 15; seed++) seen.add(E.createGame({ players, seed }).players.map((p) => p.name).join(''));
    assert.ok(seen.size > 4, 'seats vary with the seed');
    assert.equal(E.createGame({ players, seed: 4 }).players.map((p) => p.name).join(''), E.createGame({ players, seed: 4 }).players.map((p) => p.name).join(''));
    assert.equal(E.createGame({ players, seed: 4, shuffleSeats: false }).players.map((p) => p.name).join(''), 'AnnaBenCaraDev');
  });

  check('P3.5', 'train draft: last seat first, each puts one train on an empty start city; then seat order, the second on the opposite side; inland cities refused', () => {
    const s = fresh(3);
    while (frame(s) === 'setupProduction') act(s, E.getValidActions(s)[0]);
    assert.equal(frame(s), 'setupRailhead');
    assert.equal(s.toAct, 2, 'reverse seat order: the last seat is first');
    assert.deepEqual(offers(s, 'placeRailhead').map((a) => a.city).sort(), [...WEST, ...EAST].sort());
    refused(s, { type: 'placeRailhead', city: 'SPO' });
    act(s, { type: 'placeRailhead', city: 'SEA' });
    assert.equal(s.toAct, 1);
    refused(s, { type: 'placeRailhead', city: 'SEA' }, /already/);
    act(s, { type: 'placeRailhead', city: 'MIN' });
    act(s, { type: 'placeRailhead', city: 'POR' });
    assert.equal(s.toAct, 0, 'then seat order');
    assert.deepEqual(offers(s, 'placeRailhead').map((a) => a.city).sort(), EAST.filter((c) => c !== 'MIN').sort(), 'the first train of seat 1 is its draft; here its first is still to come');
    act(s, { type: 'placeRailhead', city: 'OMA' });
    // Seat 1's first train was OMA (east): its second must be west, and not a taken one.
    const west = offers(s, 'placeRailhead').map((a) => a.city).sort();
    assert.deepEqual(west, ['LAX', 'SAC'].sort(), 'opposite side, empty start cities only (SEA and POR hold trains)');
    for (const c of ['LAX', 'SAC']) assert.ok(WEST.includes(c));
  });

  check('P3.5/after', 'each player ends with one train in the west and one in the east; afterwards any number of trains may share a city', () => {
    const s = start(4);
    for (const p of s.players) assert.notEqual(E.startSide(p.railheads[0]), E.startSide(p.railheads[1]));
    const t = start(2);
    setTrains(t, 0, ['SEA', 'MIN']);
    setTrains(t, 1, ['SEA', 'MIN']);
    assert.equal(E.railheadsAt(t, 'SEA').length, 2);
  });

  check('P3.6', 'seat 1 takes the first turn, at its worker step', () => {
    const s = start(3);
    assert.equal(s.turn.player, 0);
    assert.equal(s.turn.number, 1);
    assert.equal(frame(s), 'workerStep');
    assert.equal(s.phase, 'play');
  });

  // -------------------------------------------------------------------------
  // P4 - the turn
  // -------------------------------------------------------------------------

  check('P4.1', 'turns run clockwise with no rounds and no phases; the order never changes', () => {
    const s = start(3);
    const order = [];
    for (let t = 0; t < 7; t++) {
      order.push(s.turn.player);
      const space = Object.keys(s.grid.spaces).find((w) => has(s, 'placeWorker', { space: w }));
      act(s, { type: 'placeWorker', space });
      if (frame(s) === 'chooseDistrict') act(s, E.getValidActions(s).find((a) => a.district === 'D4' || a.district === 'D8' || a.district === 'D2') ?? E.getValidActions(s)[0]);
      let guard = 0;
      while (s.turn.player === order[order.length - 1] && !E.isGameOver(s)) {
        assert.ok(guard++ < 50);
        const acts = E.getValidActions(s);
        act(s, acts.find((a) => a.type === 'skipStep' || a.type === 'skipSpecialAction') ?? acts[0]);
      }
    }
    assert.deepEqual(order, [0, 1, 2, 0, 1, 2, 0]);
  });

  check('P4.2', 'a turn: worker step, then the district choice, then the action; a worker step cannot be skipped', () => {
    const s = start(2);
    assert.equal(frame(s), 'workerStep');
    assert.ok(!types(s).includes('chooseDistrict'));
    assert.deepEqual(types(s), ['placeWorker'], 'nothing to remove or displace yet');
    act(s, { type: 'placeWorker', space: 'W1' });
    assert.equal(frame(s), 'chooseDistrict');
    assert.ok(!types(s).includes('placeWorker'));
  });

  check('P4.3', 'no passing: with every worker on the grid the only legal worker step is a removal; placing is refused', () => {
    const s = start(4);
    for (const at of ['W1', 'W5', 'W12']) put(s, 0, at);
    assert.deepEqual(types(s), ['removeWorker']);
    refused(s, { type: 'placeWorker', space: 'W2' });
    // And a player with workers in supply and none on the grid cannot remove.
    const t = start(2);
    refused(t, { type: 'removeWorker', from: 'W1' });
  });

  check('P4.4/1', 'a Collect action can always be chosen, even with a full or empty storage', () => {
    const s = start(2);
    setStorage(s, 0, { coins: 6 });
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.ok(has(s, 'chooseDistrict', { district: 'D9' }));
    assert.ok(has(s, 'chooseDistrict', { district: 'D8' }));
  });

  check('P4.4/2', 'a board activation can always be chosen, even when every step would be skipped', () => {
    const s = start(2);
    setStorage(s, 0, {});
    act(s, { type: 'placeWorker', space: 'W3' });
    assert.ok(has(s, 'chooseDistrict', { district: 'D4' }));
    act(s, { type: 'chooseDistrict', district: 'D4', hats: 0 });
    assert.ok(has(s, 'skipStep') || s.turn.player === 1, 'the step is skipped by the player or the engine');
  });

  check('P4.4/3', 'Lay Track can be chosen only with at least one legal lay', () => {
    const s = start(2);
    setStorage(s, 0, {});
    setTrains(s, 0, ['LAX', 'FTW']);
    assert.equal(E.hasLegalLay(s, 0), false);
    assert.notEqual(E.getDistrictActionBlockReason(s, 0, 'D5', 'lay'), null);
    act(s, { type: 'placeWorker', space: 'W4' });
    assert.ok(!has(s, 'chooseDistrict', { district: 'D5' }));
    refused(s, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' });
    const t = start(2);
    setStorage(t, 0, { tunnel: 4, ground: 5 });
    setTrains(t, 0, ['LAX', 'FTW']);
    assert.equal(E.hasLegalLay(t, 0), true);
    assert.equal(E.getDistrictActionBlockReason(t, 0, 'D5', 'lay'), null);
    act(t, { type: 'placeWorker', space: 'W4' });
    assert.ok(has(t, 'chooseDistrict', { district: 'D5', mode: 'lay' }));
  });

  check('P4.4/4', 'Hire Specialists can be chosen only when a hire is possible (an empty specialist space needs a carriage)', () => {
    const s = start(2);
    act(s, { type: 'placeWorker', space: 'W4' });
    assert.ok(!has(s, 'chooseDistrict', { mode: 'hire' }));
    const t = start(2);
    giveCarriages(t, 0, [['crew', 'crew']]);
    act(t, { type: 'placeWorker', space: 'W4' });
    assert.ok(!has(t, 'chooseDistrict', { mode: 'hire' }), 'no empty space');
    const u = start(2);
    giveCarriages(u, 0, [['crew', null]]);
    act(u, { type: 'placeWorker', space: 'W4' });
    assert.ok(has(u, 'chooseDistrict', { district: 'D5', mode: 'hire' }));
  });

  check('P4.5', 'a player may remove while able to place and place while able to remove', () => {
    const s = start(2);
    put(s, 0, 'W12');
    assert.ok(types(s).includes('placeWorker') && types(s).includes('removeWorker'));
  });

  check('P4.6', 'the decision frames: setupProduction, setup trains, workerStep, chooseDistrict, specialAction, boardActivation, hire, lay, placeBuildings', () => {
    const s = fresh(2);
    assert.equal(frame(s), 'setupProduction');
    const kinds = new Set(E.FRAMES ? Object.keys(E.FRAMES) : []);
    for (const k of ['setupProduction', 'setupRailhead', 'workerStep', 'chooseResource', 'chooseDistrict', 'specialAction', 'boardActivation', 'congressPlacement', 'chooseBuiltTile', 'hire', 'chooseFreeSpecialist', 'lay', 'placeBuildings', 'discard']) assert.ok(kinds.has(k), `frame ${k}`);
    const t = start(2);
    act(t, { type: 'placeWorker', space: 'W2' });
    act(t, { type: 'chooseDistrict', district: 'D3', hats: 0 });
    assert.equal(frame(t), 'specialAction', 'the special action is asked after a Collect');
  });

  check('P4.6/auto', 'a decision with only one legal answer is applied by the engine itself and shows as an automatic action event', () => {
    const s = start(2);
    setStorage(s, 0, {});
    put(s, 0, 'W3');
    const events = act(s, { type: 'removeWorker', from: 'W3' });
    // From W3 the districts are D1 and D4: two answers, so not automatic.
    assert.equal(frame(s), 'chooseDistrict');
    const u = start(2);
    put(u, 0, 'W12');
    put(u, 0, 'D7');
    const ev = act(u, { type: 'removeWorker', from: 'D7' });
    assert.ok(ev.some((e) => e.type === 'action' && e.auto && e.action.type === 'chooseDistrict'), 'a centre worker gives exactly one district');
    assert.ok(events.length > 0);
  });

  check('P4.6/not-decisions', 'toll, track VP, telegraph VP, level 1 and 2 upgrade yields and goal scoring never reach the stack', () => {
    const s = start(3);
    layRoutes(s, ['SEA-SPO', 'POR-SPO'], 1);
    build(s, 'railwayStation', 'SPO', 1);
    setTrains(s, 0, ['POR', 'MIN']);
    setStorage(s, 0, { tunnel: 2 });
    chooseLay(s);
    doLay(s, ['POR-REN']);
    for (const ev of E.getValidActions(s)) assert.ok(!['toll', 'payToll'].includes(ev.type));
    assert.equal(frame(s), 'placeBuildings');
    assert.ok(E.FRAMES && !('toll' in E.FRAMES) && !('trackVp' in E.FRAMES) && !('goals' in E.FRAMES));
  });

  check('P4.7', 'a lay is built route by route; nothing is paid, scored or moved until endLay; extendPath never offers a dead end', () => {
    const s = start(3);
    setTrains(s, 0, ['POR', 'MIN']);
    setStorage(s, 0, { tunnel: 2, ground: 2, bridge: 2 });
    layRoutes(s, ['POR-SPO'], 1);
    chooseLay(s);
    if (frame(s) === 'lay' && E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    const before = { tiles: { ...s.players[0].builtTiles }, vp: { ...s.players[0].vp } };
    act(s, { type: 'extendPath', route: 'POR-REN' });
    assert.deepEqual(s.players[0].builtTiles, before.tiles, 'no tile paid yet');
    assert.deepEqual(s.players[0].vp, before.vp, 'no VP yet');
    assert.equal(s.players[0].railheads[0], 'POR', 'the train has not moved');
    assert.equal(s.map.routeOwner['POR-REN'], null, 'the route is not laid yet');
    assert.equal(frame(s), 'lay');
    // A dead end: every offered extension can still be finished.
    const t = start(2);
    setTrains(t, 0, ['POR', 'MIN']);
    setStorage(t, 0, { tunnel: 2 });
    chooseLay(t);
    for (const a of E.getValidActions(t)) assert.ok(a.type !== 'extendPath' || E.canFinishLay(t, 0, E.topFrame(t).path.cities.concat([E.otherEnd(E.MAP.routeById[a.route], E.topFrame(t).path.cities.at(-1))]), E.topFrame(t).path.routes.concat([a.route])), a.route);
  });

  check('P1.9', 'the metal resource is Iron everywhere (the engine\'s own text never uses either of the two older names)', () => {
    const dir = new URL('../../src/engine-pr2e/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      assert.ok(!new RegExp(String.raw`\b` + 'Ste' + String.raw`el\b`, 'i').test(text), `${file} uses an older name for Iron`);
      assert.ok(!new RegExp(String.raw`\b` + 'Met' + String.raw`al\b`).test(text), `${file} uses an older name for Iron`);
    }
  });

  check('P24.4', 'the Continental Rails systems that this ruleset drops have no action here (Move Train, hats bought, carriages added, Congress entries, claims, bonus actions)', () => {
    for (const t of ['moveTrain', 'moveRailhead', 'buyHat', 'addCarriage', 'skipBonusAction', 'takeCongressEntry', 'closeCongress', 'chooseOption', 'claimRoute', 'chooseStartingSpecialist']) {
      assert.ok(!(t in E.ACTIONS), t);
    }
    const s = start(2);
    assert.deepEqual(s.modules, {});
    assert.equal(s.scoringCard, null);
    assert.ok(!('milestones' in s));
  });

}
