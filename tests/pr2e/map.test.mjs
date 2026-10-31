// map.test.mjs - Pacific Rails, second edition: the map and the Lay Track action
// (P13, P14), trains (P15), buildings and carriages (P16), tolls (P17), with
// worked examples E3, E4, E5 and E8 of P22 played on the real route map.
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

/** The E3 position: Ann (player 0) on Portland with 3 Tunnel, 2 Ground, 1 Coin; Spokane holds Ben's railway station. */
function e3(players = 3, variants = {}) {
  const state = start(players, { variants });
  setTrains(state, 0, ['POR', 'MIN']);
  layRoutes(state, ['POR-SPO', 'SEA-SPO'], 1);
  build(state, 'railwayStation', 'SPO', 1);
  setStorage(state, 0, { tunnel: 3, ground: 2, coins: 1 });
  return state;
}

suite.check('E3 (P22), P14.2 to P14.7, P16.5: travel, lay two routes, 10 VP, Ben\'s toll, a compulsory building and carriage 1', () => {
  const state = e3();
  chooseLay(state);
  assert.equal(E.topFrame(state).kind, 'lay');
  assert.deepEqual(E.topFrame(state).path.cities, ['POR'], 'only the train on Portland can lay: the engine started there');
  assert.ok(offered(state, { type: 'extendPath', route: 'POR-SPO' }), 'travel over the laid route');
  assert.ok(offered(state, { type: 'extendPath', route: 'POR-REN' }), 'or lay Portland - Reno');
  const events = doLay(state, ['POR-SPO', 'HEL-SPO', 'HEL-BIL']);
  assert.equal(vp(state, 0, 'track'), 10, '3 slots x 2 + 2 slots x 2 (Helena has no building: not a stop)');
  assert.equal(vp(state, 1, 'toll'), 3, 'Ben\'s railway station in Spokane');
  assert.ok(events.some((e) => e.type === 'toll' && e.player === 1 && e.city === 'SPO'));
  assert.deepEqual(state.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
  assert.equal(state.map.routeOwner['HEL-SPO'], 0);
  assert.equal(state.map.routeOwner['HEL-BIL'], 0);
  assert.equal(state.players[0].railheads[0], 'BIL', 'P14.5.5: the train moved');
  // P14.6: able (both kinds possible), so a building must be placed; no skip.
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  assert.ok(!types(state).includes('skipBuilding'));
  assert.ok(types(state).includes('placeTelegraphStation') && types(state).includes('placeRailwayStation'));
  assert.match(E.getBlockReason(state, { type: 'skipBuilding' }), /must place one building/);
  const woodBefore = E.production(state, 0, 'wood');
  act(state, { type: 'placeRailwayStation', city: 'BIL', houseTrack: 'wood' });
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

suite.check('E3 variant (P22), P14.7, P17.1: had Cara a telegraph station in Helena, 3 x 1 + 2 x 2 = 7 VP and Cara also gains 3', () => {
  const state = e3();
  build(state, 'telegraphStation', 'HEL', 2);
  chooseLay(state);
  doLay(state, ['POR-SPO', 'HEL-SPO', 'HEL-BIL']);
  assert.equal(vp(state, 0, 'track'), 7);
  assert.equal(vp(state, 1, 'toll'), 3);
  assert.equal(vp(state, 2, 'toll'), 3);
});

suite.check('P14.3.4: with layShape one-new-route the E3 path is refused (two unlaid routes); adjacent-only allows no travel', () => {
  const one = e3(3, { layShape: 'one-new-route' });
  const cities = ['POR', 'SPO', 'HEL', 'BIL'];
  const routes = ['POR-SPO', 'HEL-SPO', 'HEL-BIL'];
  assert.equal(E.isLegalLay(one, 0, cities, routes), false);
  assert.equal(E.isLegalLay(e3(), 0, cities, routes), true, 'legal with the ruled `path`');
  assert.equal(E.isLegalLay(one, 0, cities.slice(0, 3), routes.slice(0, 2)), true, 'travel, then one new route');
  chooseLay(one);
  act(one, { type: 'extendPath', route: 'POR-SPO' });
  const events = act(one, { type: 'extendPath', route: 'HEL-SPO' });
  // After its one new route the lay can only end: the engine ends it at Helena.
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'endLay'));
  assert.equal(one.players[0].railheads[0], 'HEL');

  const adj = e3(3, { layShape: 'adjacent-only' });
  assert.equal(E.isLegalLay(adj, 0, ['POR', 'SPO', 'HEL'], ['POR-SPO', 'HEL-SPO']), false, 'no travel');
  assert.equal(E.isLegalLay(adj, 0, ['POR', 'REN'], ['POR-REN']), true, 'one unlaid route from the train');
  chooseLay(adj);
  assert.equal(adj.players[0].railheads[0], 'REN', 'the only lay: Portland - Reno (T T), made by the engine');
});

suite.check('P14.3.5: with must-join-unjoined a route that only closes a loop is refused; by default it is allowed', () => {
  for (const rule of ['any-unlaid-route', 'must-join-unjoined']) {
    const state = start(2, { variants: { newConnectionRule: rule } });
    setTrains(state, 0, ['SEA', 'MIN']);
    layRoutes(state, ['SEA-SPO', 'HEL-SPO']);
    setStorage(state, 0, { bridge: 1, tunnel: 4 });
    assert.equal(E.isLegalLay(state, 0, ['SEA', 'HEL'], ['SEA-HEL']), rule === 'any-unlaid-route', rule);
    chooseLay(state);
    if (rule === 'any-unlaid-route') {
      assert.ok(offered(state, { type: 'extendPath', route: 'SEA-HEL' }));
    } else {
      assert.equal(state.map.routeOwner['SEA-HEL'], null, 'Seattle - Helena was never laid');
    }
  }
});

suite.check('E4 (P22), P14.3.3 b, P4.7: a zero-tile lay to a bypassed city scores nothing, pays the toll and must build; dead ends are never offered', () => {
  const state = start(4);
  layRoutes(state, ['POR-SPO', 'SEA-SPO', 'HEL-SPO', 'HEL-BIL'], 1);
  build(state, 'railwayStation', 'SPO', 1); // Ben
  build(state, 'railwayStation', 'BIL', 2); // (Ann, from E3)
  setTrains(state, 0, ['SEA', 'MIN']); // Dan's part, played by player 0
  setStorage(state, 0, {});
  assert.equal(E.hasLegalLay(state, 0), true);
  assert.equal(E.canFinishLay(state, 0, ['SEA', 'SPO', 'HEL', 'BIL'], ['SEA-SPO', 'HEL-SPO', 'HEL-BIL']), false, 'Billings has a building: a dead end');
  assert.equal(E.canFinishLay(state, 0, ['SEA', 'SPO', 'POR'], ['SEA-SPO', 'POR-SPO']), false, 'a start city is no zero-tile destination');
  const events = chooseLay(state);
  // From Seattle the only lay is Seattle - Spokane - Helena: the engine builds it (no other choice).
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.type === 'extendPath' && e.action.route === 'HEL-SPO'));
  assert.equal(vp(state, 0, 'track'), 0, 'no tiles, no track VP');
  assert.equal(vp(state, 1, 'toll'), 3, 'Ben\'s toll in Spokane');
  assert.equal(state.players[0].railheads[0], 'HEL');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  act(state, { type: 'placeTelegraphStation', city: 'HEL' });
  assert.equal(vp(state, 0, 'telegraph'), 1);
  assert.equal(E.isCityConnected(state, 'HEL'), true, 'P1.18: Helena is now connected');
});

suite.check('E5 (P22), P19.1 to P19.3: completing the line scores 3 VP per slot instead of 1, triggers the end, and the round is played out', () => {
  const state = start(3);
  layRoutes(state, ['SEA-HEL', 'HEL-BIS'], 2);
  setTrains(state, 0, ['BIS', 'LAX']);
  setStorage(state, 0, { ground: 5 });
  chooseLay(state);
  doLay(state, ['BIS-MIN']);
  assert.equal(vp(state, 0, 'completion'), 15, '5 slots x 3');
  assert.equal(vp(state, 0, 'track'), 0, 'instead of, not as well as');
  assert.deepEqual(state.gameEnd, { reason: 'transcontinental', triggeredBy: 0, triggeredOnTurn: 1 });
  assert.equal(state.completion.player, 0);
  assert.equal(state.completion.slots, 5);
  assert.equal(state.map.routeOwner['BIS-MIN'], 0);
  assert.equal(E.isGameOver(state), false, 'the round is finished first');
  assert.equal(state.turn.player, 1, 'no building owed: a start city never makes a player able (P14.6.2)');
  // Ben and Cara play their turns; then the game ends.
  const rng = E.makeRng('e5');
  while (!E.isGameOver(state)) act(state, E.rngPick(rng, E.getValidActions(state)));
  assert.deepEqual(state.players.map((p) => p.turnsTaken), [1, 1, 1]);
  assert.equal(E.scoreGame(state).endReason, 'transcontinental');
});

suite.check('E8 (P22), P14.6.2: only a railway station possible, so it must be placed, bringing carriage 2', () => {
  const state = start(4);
  build(state, 'telegraphStation', 'HEL', 3); // Dan's
  giveCarriages(state, 0, [['crew', null]]); // Ben's part, played by player 0: carriage 1 already
  setTrains(state, 0, ['BOI', 'MIN']);
  setStorage(state, 0, { bridge: 3 });
  chooseLay(state);
  doLay(state, ['HEL-BOI']);
  assert.equal(vp(state, 0, 'track'), 3, 'Helena is connected: 3 x 1 VP');
  assert.equal(vp(state, 3, 'toll'), 3, 'Dan\'s telegraph station');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
  assert.deepEqual(types(state), ['placeRailwayStation'], 'no telegraph station (Helena has one), no skip');
  act(state, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'coins' });
  assert.equal(state.players[0].train.specialistCarriages.length, 2);
  assert.equal(E.storageCapacity(state, 0), 12);
});

suite.check('E8 (P22), P14.6.2: not able (both buildings taken, own building blocks the other kind, out of pieces): no building, the lay stands', () => {
  const cases = {
    both: (s) => {
      build(s, 'telegraphStation', 'HEL', 3);
      build(s, 'railwayStation', 'HEL', 1);
    },
    own: (s) => build(s, 'telegraphStation', 'HEL', 0),
    pieces: (s) => {
      s.players[0].houses = { wood: 0, iron: 0, gunpowder: 0, coins: 0 };
      s.players[0].telegraphsPlaced = 7;
    },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const state = start(4);
    arrange(state);
    setTrains(state, 0, ['BOI', 'MIN']);
    setStorage(state, 0, { bridge: 3 });
    assert.equal(E.canPlaceArrivalBuilding(state, 0, 'HEL'), false, name);
    chooseLay(state);
    doLay(state, ['HEL-BOI']);
    assert.equal(state.map.routeOwner['HEL-BOI'], 0, `${name}: the lay stands`);
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
});

suite.check('P14.1: M lays, each resolved before the next; the first is required, later ones optional; either train', () => {
  const state = e3();
  state.players[0].hats = 1;
  state.players[0].builtTiles.bridge = 2; // for Minneapolis - Sioux Falls (B B)
  chooseLay(state, 1); // M = 2
  assert.equal(E.topFrame(state).remaining, 2);
  assert.ok(!types(state).includes('stopLaying'), 'the first lay must be made');
  doLay(state, ['POR-REN']);
  act(state, { type: 'placeTelegraphStation', city: 'REN' });
  assert.equal(E.topFrame(state).kind, 'lay');
  assert.deepEqual(types(state).sort(), ['startLay', 'stopLaying']);
  doLay(state, ['MIN-SXF'], 1);
  assert.equal(state.players[0].railheads[1], 'SXF');
  assert.equal(E.topFrame(state).kind, 'placeBuildings');
});

suite.check('P14.3.2: a lay needs every tile of its unlaid routes, by terrain, all at once', () => {
  const state = e3();
  state.players[0].builtTiles = { ground: 2, tunnel: 2, bridge: 3 };
  chooseLay(state);
  assert.deepEqual(types(state), ['startLay'], 'both trains can lay now (Minneapolis - Sioux Falls is B B)');
  act(state, { type: 'startLay', train: 0 });
  act(state, { type: 'extendPath', route: 'POR-SPO' });
  assert.equal(E.topFrame(state).path.cities.at(-1), 'SPO');
  assert.match(E.getBlockReason(state, { type: 'extendPath', route: 'HEL-SPO' }), /would need 3 Tunnel built tiles, and you hold 2 Ground, 2 Tunnel and 3 Bridge/);
  assert.ok(offered(state, { type: 'extendPath', route: 'SPO-REN' }), 'B B B is affordable');
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
  setStorage(state, 0, { tunnel: 2 });
  chooseLay(state);
  doLay(state, ['POR-REN']);
  act(state, { type: 'placeRailwayStation', city: 'REN', houseTrack: 'wood' });
  assert.equal(state.players[0].train.specialistCarriages.length, 3);
  assert.equal(state.players[0].layStationsPlaced, 4);
});

suite.check('P17: every city entered pays each other player\'s building there, both kinds; the start city and your own buildings pay nothing', () => {
  const state = e3();
  build(state, 'telegraphStation', 'SPO', 2); // Spokane: Ben's railway station and Cara's telegraph station
  build(state, 'railwayStation', 'HEL', 0); // Anna's own: no toll, and it makes Helena a scoring stop
  build(state, 'railwayStation', 'BOI', 1); // never entered: no toll
  chooseLay(state);
  const events = doLay(state, ['POR-SPO', 'HEL-SPO', 'HEL-BIL']);
  const tolls = events.filter((e) => e.type === 'toll').map((e) => `${e.player}:${e.city}`).sort();
  assert.deepEqual(tolls, ['1:SPO', '2:SPO']);
  assert.equal(vp(state, 0, 'toll'), 0);
  assert.equal(vp(state, 0, 'track'), 3 * 1 + 2 * 2, 'Helena (Anna\'s railway station) is a stop: 1 VP per slot; Billings 2');
});

suite.check('P13.4, P14.8: a laid route is never laid again: travelling over it costs no tiles', () => {
  const state = e3();
  chooseLay(state);
  doLay(state, ['POR-SPO', 'HEL-SPO']);
  assert.deepEqual(state.players[0].builtTiles, { ground: 2, tunnel: 0, bridge: 0 });
  assert.equal(state.map.routeOwner['POR-SPO'], 1, 'the travelled route is unchanged');
});

suite.check('P15.4, P15.5: either train can use anybody\'s track; a train with no legal lay is simply not offered', () => {
  const state = e3();
  setTrains(state, 0, ['SEA', 'FTW']);
  chooseLay(state);
  // Fort Worth has no affordable route; Seattle reaches Spokane over Ben's track, then Helena.
  assert.equal(E.topFrame(state).path.cities[0], 'SEA');
});

suite.check('P10 / E2 (P22) part 1: the Congress panel starts with all senators up; the Financier action is part 2', () => {
  const state = start(2);
  assert.deepEqual(state.congress.down, { K1: false, K2: false, K3: false, K4: false, K5: false, K6: false, K7: false, K8: false });
  assert.deepEqual(E.congressTable(state), []);
});

suite.finish();
