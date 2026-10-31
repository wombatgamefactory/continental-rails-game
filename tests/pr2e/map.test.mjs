// map.test.mjs - Pacific Rails, second edition: the map and the Lay Track action
// (P13, P14), trains (P15), buildings and carriages (P16), tolls (P17), with
// worked examples E3, E4, E5, E8 and E9 of P22 played on the real route map (route map v3),
// and the wild slot of P14.9.
//
// Semantics: permanently green; exits 1 on any failure.
//
// The engine applies a forced step itself (a lay with one way on is extended,
// a lay that can only end is ended), so `doLay` below takes the routes of the
// intended path and does only the steps that are still real choices.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { E, start, act, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, vp } from './rig.mjs';

const suite = makeSuite('pr2e map');

/** Anna places a worker on W4 and chooses Lay Track (spending `hats`). Returns the events. */
function chooseLay(state, hats = 0) {
  const events = act(state, { type: 'placeWorker', space: 'W4' });
  if (E.topFrame(state).kind === 'chooseDistrict') events.push(...act(state, { type: 'chooseDistrict', district: 'D5', hats, mode: 'lay' }));
  return events;
}

/** Plays one lay along `routes` from train `train`, doing only the steps the engine has not done itself. Returns the events. */
function doLay(state, routes, train = 0) {
  const events = [];
  let top = E.topFrame(state);
  if (top.kind === 'lay' && top.path === null) events.push(...act(state, { type: 'startLay', train }));
  for (const route of routes) {
    top = E.topFrame(state);
    if (top === null || top.kind !== 'lay' || top.path === null) break; // the engine ended the lay itself
    if (top.path.routes.includes(route)) continue;
    events.push(...act(state, { type: 'extendPath', route }));
  }
  top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path !== null) events.push(...act(state, { type: 'endLay' }));
  return events;
}

/** The E3 position: Ann (player 0) on Portland with 3 Ground, 1 Tunnel, 1 Bridge, 1 Coin; The Dalles holds Ben's railway station. */
function e3(players = 3, variants = {}) {
  const state = start(players, { variants });
  setTrains(state, 0, ['POR', 'MIN']);
  layRoutes(state, ['TDL-POR', 'SEA-TDL'], 1);
  build(state, 'railwayStation', 'TDL', 1);
  setStorage(state, 0, { ground: 3, tunnel: 1, bridge: 1, coins: 1 });
  return state;
}

suite.check('P13.1, P1.15, P1.16: route map v3 - 35 cities (27 inland), 65 routes, 134 slots (G 46, T 44, B 41, wild 3), 600 x 350 mm', () => {
  assert.equal(E.MAP.cities.length, 35);
  assert.equal(E.MAP.inlandCities.length, 27);
  assert.equal(E.MAP.westStartCities.length, 4);
  assert.equal(E.MAP.eastStartCities.length, 4);
  assert.equal(E.MAP.routes.length, 65);
  assert.deepEqual(E.mapSlotTotals(), { ground: 46, tunnel: 44, bridge: 41, wild: 3 });
  assert.deepEqual(E.MAP.board, { w: 600, h: 350 });
  assert.equal(E.MAP.labels.length, 35, 'a label per city, for the page');
  assert.ok(E.MAP.cityStyle.inland.r > 0 && E.MAP.cityStyle.start.r > 0);
  const lengths = {};
  for (const r of E.MAP.routes) lengths[r.length] = (lengths[r.length] ?? 0) + 1;
  assert.deepEqual(lengths, { 1: 16, 2: 31, 3: 16, 4: 2 });
  assert.equal(E.MAP.routes.filter((r) => r.line === false).length, 30, 'the art draws no black line on 30 routes (page only)');
  // Every start city has exactly two routes: one of 1 slot, one of 3 slots (P13.1).
  for (const c of E.MAP.startCities) {
    const lens = E.MAP.cityRoutes[c].map((id) => E.MAP.routeById[id].length).sort();
    assert.deepEqual(lens, [1, 3], c);
  }
  // The wild slots: three routes, one wild slot each; `cost` holds only the three tile types (P14.9).
  const wildRoutes = E.MAP.routes.filter((r) => r.wild > 0).map((r) => r.id).sort();
  assert.deepEqual(wildRoutes, ['BIL-BIS', 'BIL-DEN', 'SPO-HEL']);
  for (const r of E.MAP.routes) {
    assert.deepEqual(Object.keys(r.cost).sort(), ['bridge', 'ground', 'tunnel'], r.id);
    assert.equal(r.cost.ground + r.cost.tunnel + r.cost.bridge + r.wild, r.length, r.id);
    assert.equal(r.slots.length, r.length);
  }
  assert.deepEqual(E.MAP.routeById['SPO-HEL'].terrains, ['tunnel', 'bridge', 'wild']);
  assert.deepEqual(E.MAP.routeById['SPO-HEL'].cost, { ground: 0, tunnel: 1, bridge: 1 });
  assert.equal(E.MAP.routeById['SPO-HEL'].slots[2].terrain, 'wild');
  assert.equal(E.MAP.cityRoutes.TDL.length, 5);
  // The 12 cities with 5 routes (spec Appendix A.3).
  assert.deepEqual(E.MAP.cityIds.filter((c) => E.MAP.cityRoutes[c].length === 5).sort(), ['BIS', 'BOI', 'DEN', 'DOD', 'FRE', 'NPL', 'SFE', 'SPO', 'SXC', 'TDL', 'TON', 'WIC']);
  // At most 49 of one tile type on the map at once (46 Ground slots + 3 wild): the 70 tiles never run short (P2.4).
  assert.equal(E.mapSlotTotals().ground + E.mapSlotTotals().wild, 49);
  // Every route is a printed chain between two cities with no duplicates; ids are `a-b` as in the data.
  assert.equal(new Set(E.MAP.routeIds).size, 65);
  assert.ok(E.MAP.routeById['TDL-POR'] && E.MAP.routeById['SPO-TDL'] && E.MAP.routeById['FAR-MIN']);
  assert.equal(E.MAP_ID, 'route-map-v3');
});

suite.check('P14.9.2: a route\'s wild slots are paid from tiles left over after the fixed slots (routeShortfall, canAffordRoute, holdsTiles)', () => {
  const route = E.MAP.routeById['SPO-HEL']; // T B W
  const p = (g, t, b) => ({ builtTiles: { ground: g, tunnel: t, bridge: b } });
  assert.equal(E.canAffordRoute(p(0, 1, 1), route), false, 'fixed slots alone are not enough');
  assert.deepEqual(E.routeShortfall(p(0, 1, 1), route), { ground: 0, tunnel: 0, bridge: 0, wild: 1 });
  assert.equal(E.canAffordRoute(p(1, 1, 1), route), true, 'a spare Ground takes the wild slot');
  assert.equal(E.canAffordRoute(p(0, 2, 1), route), true, 'a spare Tunnel takes it too');
  assert.equal(E.canAffordRoute(p(0, 0, 2), route), false, 'a spare Bridge does not stand in for the missing Tunnel');
  assert.deepEqual(E.routeShortfall(p(0, 0, 2), route), { ground: 0, tunnel: 1, bridge: 0, wild: 0 }, 'the Bridge is spare for the wild slot; only the Tunnel is missing');
  assert.equal(E.formatRouteCost(start(2), route), '1 Tunnel + 1 Bridge + 1 tile of any type');
  const tiles = E.tilesForRoutes(start(2), ['SPO-HEL', 'BIL-DEN']);
  assert.deepEqual(tiles, { ground: 0, tunnel: 2, bridge: 1, wild: 2 });
  assert.equal(E.holdsTiles(p(0, 2, 1), tiles), false, 'no tile left over for the wild slots');
  assert.equal(E.holdsTiles(p(0, 2, 3), tiles), true);
  assert.equal(E.holdsTiles(p(1, 3, 1), tiles), true);
});

suite.check('E3 (P22), P14.2 to P14.7, P14.9, P16.5: travel, lay two routes (one with a wild slot the engine fills), 10 VP, Ben\'s toll, a compulsory building and carriage 1', () => {
  const state = e3();
  chooseLay(state);
  assert.equal(E.topFrame(state).kind, 'lay');
  assert.ok(offered(state, { type: 'startLay', train: 0 }));
  act(state, { type: 'startLay', train: 0 });
  assert.deepEqual(E.topFrame(state).path.cities, ['POR']);
  assert.ok(offered(state, { type: 'extendPath', route: 'TDL-POR' }), 'travel over the laid route');
  assert.ok(offered(state, { type: 'extendPath', route: 'POR-REN' }), 'or lay Portland - Reno');
  const events = doLay(state, ['TDL-POR', 'SPO-TDL', 'SPO-HEL']);
  // P14.9.4: her only spare tile is Ground, so the engine fills the wild slot itself (auto), after endLay.
  const fill = events.find((e) => e.type === 'action' && e.action.type === 'fillWildSlot');
  assert.ok(fill && fill.auto === true && fill.action.terrain === 'ground');
  assert.ok(events.indexOf(fill) > events.findIndex((e) => e.type === 'action' && e.action.type === 'endLay'));
  assert.ok(events.indexOf(fill) < events.findIndex((e) => e.type === 'routeLaid'), 'the fill comes before P14.5.1');
  assert.deepEqual(state.map.wildFill, { 'SPO-HEL': [{ slot: 2, terrain: 'ground' }] });
  assert.equal(vp(state, 0, 'track'), 10, '2 slots x 2 + 3 slots x 2 (Spokane has no building: not a stop; the wild slot scores like any slot)');
  assert.equal(vp(state, 1, 'toll'), 3, 'Ben\'s railway station in The Dalles');
  assert.ok(events.some((e) => e.type === 'toll' && e.player === 1 && e.city === 'TDL'));
  assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
  assert.equal(state.map.routeOwner['SPO-TDL'], 0);
  assert.equal(state.map.routeOwner['SPO-HEL'], 0);
  const hel = events.find((e) => e.type === 'routeLaid' && e.route === 'SPO-HEL');
  assert.deepEqual(hel.cost, { ground: 1, tunnel: 1, bridge: 1 }, 'routeLaid.cost is the tiles actually paid, the wild fill included');
  assert.deepEqual(hel.wild, [{ slot: 2, terrain: 'ground' }]);
  assert.deepEqual(events.find((e) => e.type === 'routeLaid' && e.route === 'SPO-TDL').wild, []);
  assert.deepEqual(events.find((e) => e.type === 'lay').wild, [{ route: 'SPO-HEL', slot: 2, terrain: 'ground' }]);
  assert.equal(state.players[0].railheads[0], 'HEL', 'P14.5.5: the train moved');
  // P14.6: able (both kinds possible), so a building must be placed; no skip.
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  assert.ok(!types(state).includes('skipBuilding'));
  assert.ok(types(state).includes('placeTelegraphStation') && types(state).includes('placeRailwayStation'));
  assert.match(E.getBlockReason(state, { type: 'skipBuilding' }), /must place one building/);
  const woodBefore = E.production(state, 0, 'wood');
  act(state, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'wood' });
  assert.equal(E.production(state, 0, 'wood'), woodBefore + 1);
  // P16.5: the first railway station placed by Lay Track brings carriage 1 and a free specialist.
  assert.equal(state.players[0].train.specialistCarriages.length, 1);
  assert.equal(E.topFrame(state).kind, 'chooseFreeSpecialist');
  act(state, { type: 'chooseFreeSpecialist', specialist: 'crew' });
  assert.deepEqual(state.players[0].train.specialistCarriages[0].slots, ['crew', null]);
  assert.equal(E.storageCapacity(state, 0), 9);
  assert.equal(state.players[0].layStationsPlaced, 1);
  assert.equal(state.turn.player, 1, 'the action (M = 1) and the turn are over');
});

suite.check('E3 variant (P22), P14.7, P17.1: had Cara a telegraph station in Spokane, 2 x 1 + 3 x 2 = 8 VP and Cara also gains 3', () => {
  const state = e3();
  build(state, 'telegraphStation', 'SPO', 2);
  chooseLay(state);
  doLay(state, ['TDL-POR', 'SPO-TDL', 'SPO-HEL']);
  assert.equal(vp(state, 0, 'track'), 8);
  assert.equal(vp(state, 1, 'toll'), 3);
  assert.equal(vp(state, 2, 'toll'), 3);
});

suite.check('P14.3.4: with layShape one-new-route the E3 path is refused (two unlaid routes); adjacent-only allows no travel', () => {
  const one = e3(3, { layShape: 'one-new-route' });
  const cities = ['POR', 'TDL', 'SPO', 'HEL'];
  const routes = ['TDL-POR', 'SPO-TDL', 'SPO-HEL'];
  assert.equal(E.isLegalLay(one, 0, cities, routes), false);
  assert.equal(E.isLegalLay(e3(), 0, cities, routes), true, 'legal with the ruled `path`');
  assert.equal(E.isLegalLay(one, 0, cities.slice(0, 3), routes.slice(0, 2)), true, 'travel, then one new route');
  chooseLay(one);
  act(one, { type: 'startLay', train: 0 });
  act(one, { type: 'extendPath', route: 'TDL-POR' });
  const events = act(one, { type: 'extendPath', route: 'SPO-TDL' });
  // After its one new route the lay can only end: the engine ends it at Spokane.
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'endLay'));
  assert.equal(one.players[0].railheads[0], 'SPO');

  const adj = e3(3, { layShape: 'adjacent-only' });
  assert.equal(E.isLegalLay(adj, 0, ['POR', 'TDL', 'SPO'], ['TDL-POR', 'SPO-TDL']), false, 'no travel');
  assert.equal(E.isLegalLay(adj, 0, ['POR', 'REN'], ['POR-REN']), true, 'one unlaid route from the train');
  chooseLay(adj);
  act(adj, { type: 'startLay', train: 0 });
  assert.equal(adj.players[0].railheads[0], 'REN', 'the only lay from Portland: Portland - Reno (B T G), made by the engine');
  assert.equal(adj.map.routeOwner['TDL-POR'], 1, 'the laid route was not travelled');
});

suite.check('P14.3.5: with must-join-unjoined a route that only closes a loop is refused; by default it is allowed', () => {
  for (const rule of ['any-unlaid-route', 'must-join-unjoined']) {
    const state = start(2, { variants: { newConnectionRule: rule } });
    setTrains(state, 0, ['SEA', 'MIN']);
    layRoutes(state, ['SEA-TDL', 'YAK-TDL']);
    setStorage(state, 0, { tunnel: 4, bridge: 1 });
    assert.equal(E.isLegalLay(state, 0, ['SEA', 'YAK'], ['SEA-YAK']), rule === 'any-unlaid-route', rule);
    chooseLay(state);
    // (the engine may already have started or travelled: put the lay at Seattle by hand)
    E.topFrame(state).path = { train: 0, cities: ['SEA'], routes: [] };
    if (rule === 'any-unlaid-route') {
      assert.ok(offered(state, { type: 'extendPath', route: 'SEA-YAK' }));
    } else {
      assert.match(E.getBlockReason(state, { type: 'extendPath', route: 'SEA-YAK' }), /close a loop/);
      assert.equal(state.map.routeOwner['SEA-YAK'], null, 'Seattle - Yakima was never laid');
    }
  }
});

suite.check('E4 (P22), P14.3.3 b, P4.7: a zero-tile lay to a bypassed city scores nothing, pays the toll and must build; dead ends are never offered', () => {
  const state = start(4);
  layRoutes(state, ['TDL-POR', 'SEA-TDL', 'SPO-TDL', 'SPO-HEL'], 1);
  build(state, 'railwayStation', 'TDL', 1); // Ben
  build(state, 'railwayStation', 'HEL', 2); // (Ann, from E3)
  setTrains(state, 0, ['SEA', 'MIN']); // Dan's part, played by player 0
  setStorage(state, 0, {});
  assert.equal(E.hasLegalLay(state, 0), true);
  assert.equal(E.canFinishLay(state, 0, ['SEA', 'TDL', 'SPO', 'HEL'], ['SEA-TDL', 'SPO-TDL', 'SPO-HEL']), false, 'Helena has a building: a dead end');
  assert.equal(E.canFinishLay(state, 0, ['SEA', 'TDL', 'POR'], ['SEA-TDL', 'TDL-POR']), false, 'a start city is no zero-tile destination');
  const events = chooseLay(state);
  // From Seattle the only lay is Seattle - The Dalles - Spokane: the engine builds it (no other choice).
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'extendPath' && e.action.route === 'SPO-TDL'));
  assert.equal(vp(state, 0, 'track'), 0, 'no tiles, no track VP');
  assert.equal(vp(state, 1, 'toll'), 3, 'Ben\'s toll in The Dalles');
  assert.equal(state.players[0].railheads[0], 'SPO');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  act(state, { type: 'placeTelegraphStation', city: 'SPO' });
  assert.equal(vp(state, 0, 'telegraph'), 1);
  assert.equal(E.isCityConnected(state, 'SPO'), true, 'P1.18: Spokane is now connected');
});

suite.check('E5 (P22), P19.1 to P19.3: completing the line scores 3 VP per slot instead of 1, triggers the end, and the round is played out', () => {
  const state = start(3);
  layRoutes(state, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIS'], 2);
  setTrains(state, 0, ['BIS', 'LAX']);
  setStorage(state, 0, { ground: 2, bridge: 1 });
  chooseLay(state);
  doLay(state, ['FAR-BIS', 'FAR-MIN']);
  assert.equal(vp(state, 0, 'completion'), 9, '3 slots x 3');
  assert.equal(vp(state, 0, 'track'), 0, 'instead of, not as well as');
  assert.deepEqual(state.gameEnd, { reason: 'transcontinental', triggeredBy: 0, triggeredOnTurn: 1 });
  assert.equal(state.completion.player, 0);
  assert.equal(state.completion.slots, 3);
  assert.equal(state.map.routeOwner['FAR-MIN'], 0);
  assert.equal(E.isGameOver(state), false, 'the round is finished first');
  assert.equal(state.turn.player, 1, 'no building owed: a start city never makes a player able (P14.6.2)');
  // Ben and Cara play their turns; then the game ends.
  const rng = E.makeRng('e5');
  while (!E.isGameOver(state)) act(state, E.rngPick(rng, E.getValidActions(state)));
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [1, 1, 1]);
  assert.equal(E.scoreGame(state).endReason, 'transcontinental');
});

suite.check('P19.2, P14.9: the completion VP count a wild slot like any other slot (6 slots x 3 = 18)', () => {
  const state = start(3);
  layRoutes(state, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIL'], 2);
  setTrains(state, 0, ['BIL', 'LAX']);
  setStorage(state, 0, { ground: 3, bridge: 2, tunnel: 1 }); // fixed: B T, G B, G; one Ground spare for the wild slot
  chooseLay(state);
  const events = doLay(state, ['BIL-BIS', 'FAR-BIS', 'FAR-MIN']);
  assert.equal(vp(state, 0, 'completion'), 18);
  assert.equal(state.completion.slots, 6);
  assert.deepEqual(state.map.wildFill, { 'BIL-BIS': [{ slot: 0, terrain: 'ground' }] });
  assert.ok(events.some((e) => e.type === 'action' && e.action.type === 'fillWildSlot' && e.auto));
  assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
});

suite.check('E8 (P22), P14.6.2: only a railway station possible, so it must be placed, bringing carriage 2', () => {
  const state = start(4);
  build(state, 'telegraphStation', 'SPO', 3); // Dan's
  giveCarriages(state, 0, [['crew', null]]); // Ben's part, played by player 0: carriage 1 already
  setTrains(state, 0, ['BOI', 'MIN']);
  setStorage(state, 0, { tunnel: 1 });
  chooseLay(state);
  doLay(state, ['SPO-BOI']);
  assert.equal(vp(state, 0, 'track'), 1, 'Spokane is connected: 1 x 1 VP');
  assert.equal(vp(state, 3, 'toll'), 3, 'Dan\'s telegraph station');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  assert.deepEqual(types(state), ['placeRailwayStation'], 'no telegraph station (Spokane has one), no skip');
  act(state, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'coins' });
  assert.equal(state.players[0].train.specialistCarriages.length, 2);
  assert.equal(E.storageCapacity(state, 0), 12);
});

suite.check('E8 (P22), P14.6.2: not able (both buildings taken, own building blocks the other kind, out of pieces): no building, the lay stands', () => {
  const cases = {
    both: (s) => {
      build(s, 'telegraphStation', 'SPO', 3);
      build(s, 'railwayStation', 'SPO', 1);
    },
    own: (s) => build(s, 'telegraphStation', 'SPO', 0),
    pieces: (s) => {
      s.players[0].houses = { wood: 0, iron: 0, gunpowder: 0, coins: 0 };
      s.players[0].telegraphsPlaced = 7;
    },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const state = start(4);
    arrange(state);
    setTrains(state, 0, ['BOI', 'MIN']);
    setStorage(state, 0, { tunnel: 1 });
    assert.equal(E.canPlaceArrivalBuilding(state, 0, 'SPO'), false, name);
    chooseLay(state);
    doLay(state, ['SPO-BOI']);
    assert.equal(state.map.routeOwner['SPO-BOI'], 0, `${name}: the lay stands`);
    assert.equal(state.turn.player, 1, `${name}: nothing is owed, the turn is over`);
  }
});

suite.check('P14.6 with arrivalBuilding = optional: the building may be skipped', () => {
  const state = e3(3, { arrivalBuilding: 'optional' });
  chooseLay(state);
  doLay(state, ['POR-REN']);
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  assert.ok(types(state).includes('skipBuilding'));
  act(state, { type: 'skipBuilding' });
  assert.equal(state.map.railwayStation.REN, null);
  // P14.3.3 b: a zero-tile lay always ends with a building, even with `optional`.
  const zero = start(2, { variants: { arrivalBuilding: 'optional' } });
  layRoutes(zero, ['SEA-TDL']);
  setTrains(zero, 0, ['SEA', 'MIN']);
  setStorage(zero, 0, {});
  chooseLay(zero);
  assert.equal(E.topFrame(zero).kind, 'placeBuildings');
  assert.ok(!types(zero).includes('skipBuilding'));
  assert.match(E.getBlockReason(zero, { type: 'skipBuilding' }), /must place one building/);
});

suite.check('P14.1: M lays, each resolved before the next; the first is required, later ones optional; either train', () => {
  const state = e3();
  state.players[0].hats = 1;
  chooseLay(state, 1); // M = 2
  assert.equal(E.topFrame(state).remaining, 2);
  assert.ok(!types(state).includes('stopLaying'), 'the first lay must be made');
  doLay(state, ['POR-REN']);
  act(state, { type: 'placeTelegraphStation', city: 'REN' });
  assert.equal(E.topFrame(state).kind, 'lay');
  assert.deepEqual(types(state).sort(), ['startLay', 'stopLaying']);
  doLay(state, ['FAR-MIN'], 1);
  assert.equal(state.players[0].railheads[1], 'FAR');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
});

suite.check('P14.3.2: a lay needs every tile of its unlaid routes, by terrain, all at once', () => {
  const state = e3();
  state.players[0].builtTiles = { ground: 2, tunnel: 2, bridge: 3 };
  chooseLay(state);
  assert.deepEqual(types(state), ['startLay'], 'both trains can lay now (Fargo - Minneapolis is G)');
  act(state, { type: 'startLay', train: 0 });
  act(state, { type: 'extendPath', route: 'TDL-POR' });
  act(state, { type: 'extendPath', route: 'SPO-TDL' });
  assert.equal(E.topFrame(state).path.cities.at(-1), 'SPO');
  assert.match(E.getBlockReason(state, { type: 'extendPath', route: 'SPO-GFA' }), /would need 2 Ground \+ 3 Tunnel \+ 1 Bridge built tiles, and you hold 2 Ground, 2 Tunnel and 3 Bridge/);
  assert.ok(offered(state, { type: 'extendPath', route: 'SPO-BOI' }), 'a single Tunnel is affordable');
});

suite.check('P14.9.2, P4.7: a wild slot needs one more tile of any type; extendPath is offered only if that is held (with the sentence for it)', () => {
  const state = e3();
  state.players[0].builtTiles = { ground: 2, tunnel: 1, bridge: 1 }; // after SPO-TDL (G G): T B left, nothing spare
  chooseLay(state);
  act(state, { type: 'startLay', train: 0 });
  act(state, { type: 'extendPath', route: 'TDL-POR' });
  act(state, { type: 'extendPath', route: 'SPO-TDL' });
  assert.equal(offered(state, { type: 'extendPath', route: 'SPO-HEL' }), false);
  assert.match(E.getBlockReason(state, { type: 'extendPath', route: 'SPO-HEL' }), /also needs 1 more built tile of any type for a wild slot/);
  assert.equal(E.isLegalLay(state, 0, ['POR', 'TDL', 'SPO', 'HEL'], ['TDL-POR', 'SPO-TDL', 'SPO-HEL']), false);
  assert.equal(E.canFinishLay(state, 0, ['POR', 'TDL', 'SPO', 'HEL'], ['TDL-POR', 'SPO-TDL', 'SPO-HEL']), false);
  // One more tile of any type makes it legal, whichever type.
  for (const extra of ['ground', 'tunnel', 'bridge']) {
    const t = e3();
    t.players[0].builtTiles = { ground: 2, tunnel: 1, bridge: 1 };
    t.players[0].builtTiles[extra] += 1;
    assert.equal(E.isLegalLay(t, 0, ['POR', 'TDL', 'SPO', 'HEL'], ['TDL-POR', 'SPO-TDL', 'SPO-HEL']), true, extra);
    assert.equal(E.canFinishLay(t, 0, ['POR', 'TDL', 'SPO'], ['TDL-POR', 'SPO-TDL']), true, extra);
  }
});

/** E9 (P22): Gus (player 0) on Denver with 3 Tunnel, 2 Bridge, 1 Ground; Billings and Bismarck are off the network. */
function e9(storage = { tunnel: 3, bridge: 2, ground: 1 }, variants = {}) {
  const state = start(3, { variants });
  giveCarriages(state, 0, [['crew', null]]);
  setTrains(state, 0, ['DEN', 'MIN']);
  setStorage(state, 0, storage);
  return state;
}

/** Ends the lay being built if the engine has not ended it itself (it does when `endLay` is the only legal action). Returns the events. */
function finishLay(state) {
  const top = E.topFrame(state);
  return top !== null && top.kind === 'lay' && top.path !== null ? act(state, { type: 'endLay' }) : [];
}

/** Plays Denver - Billings - Bismarck up to and including `endLay` (the engine may take that step itself). Returns the events. */
function endE9Lay(state) {
  const events = chooseLay(state);
  events.push(...act(state, { type: 'startLay', train: 0 }));
  events.push(...act(state, { type: 'extendPath', route: 'BIL-DEN' }));
  events.push(...act(state, { type: 'extendPath', route: 'BIL-BIS' }));
  events.push(...finishLay(state));
  return events;
}

suite.check('E9 (P22), P14.9: two wild slots in one lay - endLay asks one wildSlot decision per slot, in path order, with the spare terrains on offer', () => {
  const state = e9();
  endE9Lay(state);
  // Nothing of P14.5 has happened yet.
  assert.equal(state.map.routeOwner['BIL-DEN'], null);
  assert.equal(state.players[0].railheads[0], 'DEN');
  assert.deepEqual(state.players[0].builtTiles, { ground: 1, tunnel: 3, bridge: 2 });
  let top = E.topFrame(state);
  assert.equal(top.kind, 'wildSlot');
  assert.deepEqual({ route: top.route, slot: top.slot, remaining: top.remaining, cause: top.cause }, { route: 'BIL-DEN', slot: 1, remaining: 1, cause: 'lay' });
  assert.equal(state.stack.filter((f) => f.kind === 'wildSlot').length, 2, 'one frame per wild slot');
  assert.deepEqual(E.getValidActions(state).map((a) => `${a.type}:${a.terrain}`).sort(), ['fillWildSlot:bridge', 'fillWildSlot:ground', 'fillWildSlot:tunnel']);
  assert.deepEqual(E.wildSlotSpare(state), { tunnel: 1, bridge: 1, ground: 1 });
  assert.deepEqual(E.layPath(state).cities, ['DEN', 'BIL', 'BIS'], 'the path stays readable while the slots are asked');
  assert.equal(E.previewLay(state).tiles.wild, 2);
  // Nothing else is accepted while a wild slot is waiting.
  assert.notEqual(E.getBlockReason(state, { type: 'endLay' }), null);
  assert.ok(types(state).every((t) => t === 'fillWildSlot'));
  const events1 = act(state, { type: 'fillWildSlot', terrain: 'ground' });
  assert.ok(events1.some((e) => e.type === 'action' && e.action.type === 'fillWildSlot' && e.auto === false));
  top = E.topFrame(state);
  assert.equal(top.kind, 'wildSlot');
  assert.deepEqual({ route: top.route, slot: top.slot, remaining: top.remaining }, { route: 'BIL-BIS', slot: 0, remaining: 0 });
  assert.deepEqual(E.wildSlotSpare(state), { tunnel: 1, bridge: 1 }, 'the Ground is used');
  assert.match(E.getBlockReason(state, { type: 'fillWildSlot', terrain: 'ground' }), /no spare built Ground tile/);
  const events2 = act(state, { type: 'fillWildSlot', terrain: 'bridge' });
  // P14.5 now runs: 2 Tunnel, 1 Bridge, the Ground and the Bridge are paid; he keeps 1 Tunnel.
  assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 1, bridge: 0 });
  assert.equal(vp(state, 0, 'track'), 10, '2 x 2 + 3 x 2, the wild slots scoring like any slot');
  assert.deepEqual(state.map.wildFill, { 'BIL-DEN': [{ slot: 1, terrain: 'ground' }], 'BIL-BIS': [{ slot: 0, terrain: 'bridge' }] });
  assert.deepEqual(events2.find((e) => e.type === 'routeLaid' && e.route === 'BIL-DEN').cost, { ground: 1, tunnel: 1, bridge: 0 });
  assert.deepEqual(events2.find((e) => e.type === 'routeLaid' && e.route === 'BIL-BIS').cost, { ground: 0, tunnel: 1, bridge: 2 });
  assert.deepEqual(events2.find((e) => e.type === 'lay').wild, [{ route: 'BIL-DEN', slot: 1, terrain: 'ground' }, { route: 'BIL-BIS', slot: 0, terrain: 'bridge' }]);
  assert.equal(state.players[0].railheads[0], 'BIS');
  assert.equal(E.topFrame(state).kind, 'placeBuildings', 'the arrival building follows the lay, as before');
  assert.equal(E.topFrame(state).city, 'BIS');
  assert.equal(E.layPath(state), null);
  assert.equal(state.stack.some((f) => f.kind === 'lay' && 'wildFills' in f), false, 'the choices are cleared once the lay is resolved');
});

suite.check('E9 (P22), P14.9.4: with a spare tile of one terrain only, the engine fills every wild slot itself and asks nothing', () => {
  const state = e9({ tunnel: 2, bridge: 1, ground: 3 });
  const events = endE9Lay(state);
  const fills = events.filter((e) => e.type === 'action' && e.action.type === 'fillWildSlot');
  assert.deepEqual(fills.map((e) => [e.auto, e.action.terrain]), [[true, 'ground'], [true, 'ground']]);
  assert.equal(E.topFrame(state).kind, 'placeBuildings', 'no wildSlot decision reached the player');
  assert.deepEqual(state.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
  assert.equal(vp(state, 0, 'track'), 10);
});

suite.check('P14.9.3: a path that travels over a laid wild route is not asked about it; two wild routes are asked in the order the train passes them (slot counted from the route\'s first city)', () => {
  // BIL-DEN is already laid: Gus only travels over it.
  const travel = e9({ tunnel: 2, bridge: 1, ground: 1 });
  layRoutes(travel, ['BIL-DEN'], 1);
  chooseLay(travel);
  act(travel, { type: 'startLay', train: 0 });
  act(travel, { type: 'extendPath', route: 'BIL-DEN' });
  act(travel, { type: 'extendPath', route: 'BIL-BIS' });
  finishLay(travel);
  assert.equal(E.topFrame(travel).kind, 'wildSlot');
  assert.deepEqual([E.topFrame(travel).route, E.topFrame(travel).remaining], ['BIL-BIS', 0], 'one question, for the unlaid route only');
  // The other way round (Bismarck to Denver): the same two routes, in the order the train passes them.
  const back = e9({ tunnel: 3, bridge: 2, ground: 1 });
  setTrains(back, 0, ['BIS', 'MIN']);
  layRoutes(back, ['GFA-BIS', 'GFA-BIL'], 1);
  chooseLay(back);
  act(back, { type: 'startLay', train: 0 });
  act(back, { type: 'extendPath', route: 'BIL-BIS' });
  act(back, { type: 'extendPath', route: 'BIL-DEN' });
  finishLay(back);
  const top = E.topFrame(back);
  assert.deepEqual([top.route, top.slot, top.remaining], ['BIL-BIS', 0, 1], 'Bismarck - Billings first; its wild slot is the one at the Billings end of the route data (index 0)');
  act(back, { type: 'fillWildSlot', terrain: 'ground' });
  const next = E.topFrame(back);
  assert.deepEqual([next.route, next.slot, next.remaining], ['BIL-DEN', 1, 0]);
});

suite.check('P14.9.5, P4.7: a game saved while a wild slot is waiting loads and goes on; wildSlotTerrain changes nothing in this ruleset (P14.9.6)', () => {
  const outcomes = [];
  for (const value of ['tile-terrain', 'no-terrain']) {
    const state = e9(undefined, { wildSlotTerrain: value });
    endE9Lay(state);
    const loaded = E.deserialiseState(E.serialiseState(state));
    assert.equal(E.topFrame(loaded).kind, 'wildSlot');
    assert.equal(E.hashState(loaded), E.hashState(state));
    act(loaded, { type: 'fillWildSlot', terrain: 'tunnel' });
    act(loaded, { type: 'fillWildSlot', terrain: 'bridge' });
    outcomes.push({ tiles: loaded.players[0].builtTiles, track: vp(loaded, 0, 'track'), fills: loaded.map.wildFill });
    assert.equal(loaded.variants.wildSlotTerrain, value);
  }
  assert.deepEqual(outcomes[0], outcomes[1], 'both values play the same game');
});

suite.check('P14.9.2: every wildSlot answer on offer leaves the lay payable (no dead end), whatever the first answer', () => {
  // Exactly enough for the E9 lay: the fixed slots take 2 Tunnel + 1 Bridge; of 3 Tunnel, 1 Bridge, 1 Ground that leaves
  // 1 Tunnel + 1 Ground for the two wild slots. Only those two are offered, and either answer leaves the other payable.
  const tight = e9({ tunnel: 3, bridge: 1, ground: 1 });
  endE9Lay(tight);
  assert.deepEqual(E.getValidActions(tight).map((a) => a.terrain).sort(), ['ground', 'tunnel'], 'no spare Bridge: not offered');
  for (const first of ['tunnel', 'ground']) {
    const state = e9({ tunnel: 3, bridge: 1, ground: 1 });
    endE9Lay(state);
    assert.ok(offered(state, { type: 'fillWildSlot', terrain: first }), first);
    act(state, { type: 'fillWildSlot', terrain: first });
    // The other kind is now the only spare tile: the engine fills the second slot itself and the lay resolves.
    assert.equal(E.topFrame(state).kind, 'placeBuildings', first);
    assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 }, first);
    assert.equal(state.map.routeOwner['BIL-BIS'], 0);
  }
});

suite.check('P15.3: trains share cities and never block; with both trains on one city the lay starts from the first', () => {
  const state = e3();
  setTrains(state, 0, ['POR', 'POR']);
  setTrains(state, 1, ['POR', 'SPO']);
  chooseLay(state);
  assert.match(E.getStructuralBlockReason(state, { type: 'startLay', train: 1 }), /Both your trains stand on Portland/);
  assert.equal(E.topFrame(state).path.cities[0], 'POR', 'the lay began (one choice)');
  assert.equal(E.topFrame(state).path.train, 0);
});

suite.check('P16.1: one railway station and one telegraph station per inland city, never one owner for both; no building in a start city', () => {
  const state = e3();
  chooseLay(state);
  doLay(state, ['POR-REN']);
  assert.match(E.getBlockReason(state, { type: 'placeRailwayStation', city: 'SEA', houseTrack: 'wood' }), /start city/);
  act(state, { type: 'placeTelegraphStation', city: 'REN' });
  assert.match(E.getStructuralBlockReason(state, { type: 'placeRailwayStation', city: 'REN', houseTrack: 'wood', player: 0 }), /own the telegraph station in Reno/);
  assert.match(E.getStructuralBlockReason(state, { type: 'placeTelegraphStation', city: 'REN', player: 1 }), /already holds Anna's telegraph station/);
});

suite.check('P16.5: only the 1st to 3rd railway stations placed by Lay Track bring carriages; the 4th brings nothing', () => {
  const state = start(2);
  giveCarriages(state, 0, [['crew', 'crew'], [null, null], [null, null]]);
  state.players[0].layStationsPlaced = 3;
  setTrains(state, 0, ['POR', 'MIN']);
  setStorage(state, 0, { bridge: 1 });
  chooseLay(state);
  doLay(state, ['TDL-POR']);
  act(state, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'wood' });
  assert.equal(state.players[0].train.specialistCarriages.length, 3);
  assert.equal(state.players[0].layStationsPlaced, 4);
});

suite.check('P17: every city entered pays each other player\'s building there, both kinds; the start city and your own buildings pay nothing', () => {
  const state = e3();
  build(state, 'telegraphStation', 'TDL', 2); // The Dalles: Ben's railway station and Cara's telegraph station
  build(state, 'railwayStation', 'SPO', 0); // Anna's own: no toll, and it makes Spokane a scoring stop
  build(state, 'railwayStation', 'BOI', 1); // never entered: no toll
  chooseLay(state);
  const events = doLay(state, ['TDL-POR', 'SPO-TDL', 'SPO-HEL']);
  const tolls = events.filter((e) => e.type === 'toll').map((e) => `${e.player}:${e.city}`).sort();
  assert.deepEqual(tolls, ['1:TDL', '2:TDL']);
  assert.equal(vp(state, 0, 'toll'), 0);
  assert.equal(vp(state, 0, 'track'), 2 * 1 + 3 * 2, 'Spokane (Anna\'s railway station) is a stop: 1 VP per slot; Helena 2');
});

suite.check('P13.4, P14.8: a laid route is never laid again: travelling over it costs no tiles', () => {
  const state = e3();
  chooseLay(state);
  doLay(state, ['TDL-POR', 'SPO-TDL']);
  assert.deepEqual(state.players[0].builtTiles, { ground: 1, tunnel: 1, bridge: 1 });
  assert.equal(state.map.routeOwner['TDL-POR'], 1, 'the travelled route is unchanged');
});

suite.check('P15.4, P15.5: either train can use anybody\'s track; a train with no legal lay is simply not offered', () => {
  const state = e3();
  setTrains(state, 0, ['SEA', 'FTW']);
  setStorage(state, 0, { ground: 2 });
  chooseLay(state);
  // Fort Worth has no affordable route; Seattle reaches The Dalles over Ben's track, then Spokane.
  assert.equal(state.players[0].railheads[0], 'SPO', 'the lay started at Seattle (the engine made it: the only one)');
  assert.equal(state.map.routeOwner['SPO-TDL'], 0);
});

suite.check('P10.1, P3.1.3: the Congress panel starts with all eight senators up', () => {
  const state = start(2);
  assert.deepEqual(state.congress.down, { K1: false, K2: false, K3: false, K4: false, K5: false, K6: false, K7: false, K8: false });
  assert.deepEqual(E.congressColumns(state).map((c) => `${c.id}:${c.cost}`), ['K1:1', 'K2:1', 'K3:1', 'K4:1', 'K5:2', 'K6:2', 'K7:3', 'K8:3', 'KR:1']);
  assert.deepEqual(E.congressTable(state), [], 'the shared page\'s Continental Rails strip shows nothing for this ruleset');
});

suite.finish();
