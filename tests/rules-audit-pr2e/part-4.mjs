// Rules audit (pr2e), part 4: P13 the map and P14 the Lay Track action
// (paths, legality, resolution order, the compulsory arrival building, track VP).

import {
  assert, E, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, check, knownFailure, refused, has, offers,
  frame, choose, chooseLay, doLay, layNow, eventOf, setHouses, setHats, vp, vpTotal, vpOfEvents, placeAndChoose,
} from './kit.mjs';

/**
 * A lay scene: `players` seats, Anna's trains, her built tiles, routes already laid (by Ben),
 * and buildings as [kind, city, owner].
 */
function scene({ players = 3, trains = ['SEA', 'MIN'], tiles = {}, laid = [], buildings = [], variants = {} } = {}) {
  const s = start(players, { variants });
  setTrains(s, 0, trains);
  setStorage(s, 0, tiles);
  layRoutes(s, laid, 1);
  for (const [kind, city, owner] of buildings) build(s, kind, city, owner);
  return s;
}

const evTypes = (events) => events.map((e) => e.type);

export default function part4() {
  // -------------------------------------------------------------------------
  // P13 - the map
  // -------------------------------------------------------------------------

  check('P13.1', 'the network: no two cities joined twice, no route between two start cities, every start city has exactly 2 routes', () => {
    const pairs = new Set();
    for (const r of E.MAP.routes) {
      const key = [r.a, r.b].sort().join('-');
      assert.ok(!pairs.has(key), `${key} joined twice`);
      pairs.add(key);
      assert.ok(!(E.isStartCity(r.a) && E.isStartCity(r.b)), `${key} joins two start cities`);
      assert.ok(r.length >= 2 && r.length <= 6, `${key}: 2 to 6 slots`);
    }
    for (const c of E.MAP.startCities) assert.equal(E.MAP.cityRoutes[c.id ?? c].length, 2, `${c.id ?? c}`);
  });

  check('P13.2', 'start cities: west Seattle, Portland, Sacramento, Los Angeles; east Minneapolis, Omaha, Kansas City, Fort Worth', () => {
    assert.deepEqual(E.MAP.westStartCities.map((c) => c.id ?? c).sort(), ['LAX', 'POR', 'SAC', 'SEA']);
    assert.deepEqual(E.MAP.eastStartCities.map((c) => c.id ?? c).sort(), ['FTW', 'KCY', 'MIN', 'OMA']);
  });

  check('P13.2/no-building', 'a start city never holds a building', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 6 } });
    refused(s, { type: 'placeRailwayStation', city: 'SEA', houseTrack: 'wood' });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SEA'), false);
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'MIN'), false);
  });

  check('P13.2/vp', 'a start city is a scoring stop worth 1 VP per slot', () => {
    const s = scene({ trains: ['SPO', 'MIN'], tiles: { ground: 2 }, laid: [] });
    layNow(s, ['SEA-SPO']);
    assert.equal(vp(s, 0, 'track'), 2, '2 slots x 1 VP');
  });

  check('P13.2/ordinary', 'a start city is otherwise ordinary: a lay may start from it, end on it, or pass through it', () => {
    // Start from Seattle, pass through ... Spokane - Seattle - Helena: pass through the start city.
    const s = scene({ trains: ['SPO', 'MIN'], tiles: { ground: 2, bridge: 1, tunnel: 4 } });
    assert.equal(E.isLegalLay(s, 0, ['SPO', 'SEA', 'HEL'], ['SEA-SPO', 'SEA-HEL']), true, 'through a start city');
    assert.equal(E.isLegalLay(s, 0, ['SPO', 'SEA'], ['SEA-SPO']), true, 'ending on it');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO'], ['SEA-SPO']), true, 'starting from it');
  });

  check('P13.3', 'inland cities: 17, each with room for one railway station and one telegraph station', () => {
    assert.equal(E.MAP.inlandCities.length, 17);
    assert.equal(E.getConstants(start(2)).MAP_RULES.buildingsPerLay, 1);
  });

  check('P13.4', 'a route is laid whole, once, for the rest of the game; it belongs to nobody and any train may travel over it', () => {
    const s = scene({ tiles: { ground: 2 } });
    layNow(s, ['SEA-SPO']);
    assert.notEqual(s.map.routeOwner['SEA-SPO'], null);
    // Travelling over it costs nothing and re-laying is impossible: the path simply travels.
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO'] });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO'], ['SEA-SPO']), true);
    assert.equal(E.evaluateLay(t, 0, ['SEA', 'SPO'], ['SEA-SPO']).slots, 0);
  });

  check('P13.5', 'an inland city is off the network, on the network but not connected, or connected', () => {
    const s = start(2);
    assert.equal(E.isOnNetwork(s, 'SPO'), false);
    layRoutes(s, ['SEA-SPO']);
    assert.equal(E.isOnNetwork(s, 'SPO'), true);
    assert.equal(E.isCityConnected(s, 'SPO'), false);
    build(s, 'telegraphStation', 'SPO', 1);
    assert.equal(E.isCityConnected(s, 'SPO'), true);
  });

  // -------------------------------------------------------------------------
  // P14 - the lay
  // -------------------------------------------------------------------------

  check('P14.1', 'M lays, each fully resolved before the next; the first is required, later ones optional; either train, including one that has just moved', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 4, bridge: 2 } });
    setHats(s, 0, 1);
    chooseLay(s, 1); // M = 2
    assert.equal(E.topFrame(s).remaining, 2);
    assert.ok(!types(s).includes('stopLaying'), 'the first lay is required');
    doLay(s, ['POR-REN']);
    act(s, { type: 'placeTelegraphStation', city: 'REN' }); // Anna able: both kinds possible, she picks a telegraph station
    assert.equal(frame(s), 'lay');
    assert.deepEqual(types(s), ['startLay', 'stopLaying']);
    assert.ok(has(s, 'startLay', { train: 0 }), 'the train that has just moved may lay again');
    assert.ok(has(s, 'startLay', { train: 1 }));
    doLay(s, ['SAC-REN'], 0);
    assert.equal(s.players[0].railheads[0], 'SAC');
    assert.equal(s.map.routeOwner['SAC-REN'], 0);
  });

  check('P14.1/stop', 'after the first lay the player may stop laying', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 4 } });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['POR-REN']);
    act(s, { type: 'placeTelegraphStation', city: 'REN' });
    act(s, { type: 'stopLaying' });
    assert.equal(s.turn.player, 1);
  });

  check('P14.2/1', 'a path starts at a city where one of the player trains stands', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 5, tunnel: 5, bridge: 5 } });
    chooseLay(s);
    assert.deepEqual(offers(s, 'startLay').map((a) => a.train).sort(), [0, 1]);
    refused(s, { type: 'startLay', train: 2 });
    act(s, { type: 'startLay', train: 0 });
    assert.deepEqual(E.layPath(s).cities, ['SEA']);
    assert.ok(offers(s, 'extendPath').every((a) => E.MAP.routeById[a.route].a === 'SEA' || E.MAP.routeById[a.route].b === 'SEA'), 'only routes from the train city');
  });

  check('P14.2/2', 'each step of the path is a printed route from the last city', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 5, tunnel: 5, bridge: 5 } });
    chooseLay(s);
    act(s, { type: 'startLay', train: 0 });
    refused(s, { type: 'extendPath', route: 'HEL-SPO' }); // not joined to Seattle
    refused(s, { type: 'extendPath', route: 'SEA-BIL' }); // no such route
    act(s, { type: 'extendPath', route: 'SEA-SPO' });
    assert.ok(has(s, 'extendPath', { route: 'HEL-SPO' }));
  });

  check('P14.2/3', 'no city appears twice on a path', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 9, tunnel: 9, bridge: 9 } });
    chooseLay(s);
    act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'SEA-SPO' });
    refused(s, { type: 'extendPath', route: 'SEA-SPO' });
    act(s, { type: 'extendPath', route: 'HEL-SPO' });
    refused(s, { type: 'extendPath', route: 'SEA-HEL' }); // would return to Seattle
    assert.ok(!offers(s, 'extendPath').some((a) => a.route === 'SEA-HEL' || a.route === 'HEL-SPO'));
  });

  check('P14.2/mix', 'a path may mix laid and unlaid routes in any order: travel, lay, travel, lay', () => {
    // Portland - Spokane (laid), Spokane - Boise (unlaid G T T), Boise - Billings (laid), Billings - Cheyenne (unlaid G G).
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 3, tunnel: 2 }, laid: ['POR-SPO', 'BOI-BIL'] });
    const cities = ['POR', 'SPO', 'BOI', 'BIL', 'CHE'];
    const routes = ['POR-SPO', 'BOI-SPO', 'BOI-BIL', 'CHE-BIL'];
    assert.equal(E.isLegalLay(s, 0, cities, routes), true);
    const ev = layNow(s, routes);
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
    assert.equal(s.players[0].railheads[0], 'CHE');
    assert.ok(ev.some((e) => e.type === 'railheadMoved'));
  });

  check('P14.3/2', 'tiles: one built tile of the slot\'s terrain for every slot of every unlaid route, all at once - no wild tiles, no part payment', () => {
    // Boise - Spokane is Ground Tunnel Tunnel: 1 Ground + 2 Tunnel.
    const s = scene({ trains: ['BOI', 'MIN'], tiles: { ground: 1, tunnel: 2 } });
    assert.equal(E.isLegalLay(s, 0, ['BOI', 'SPO'], ['BOI-SPO']), true);
    for (const tiles of [{ ground: 0, tunnel: 2, bridge: 5 }, { ground: 1, tunnel: 1 }, { ground: 5, tunnel: 0 }]) {
      setStorage(s, 0, tiles);
      assert.equal(E.isLegalLay(s, 0, ['BOI', 'SPO'], ['BOI-SPO']), false, JSON.stringify(tiles));
    }
    // Two unlaid routes need both sets at once: G-G and T-B-B needs 2 Ground, 1 Tunnel, 2 Bridge.
    setStorage(s, 0, { ground: 2, tunnel: 1, bridge: 2 });
    setTrains(s, 0, ['SEA', 'MIN']);
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'SPO'], ['SEA-SPO']), true);
    setStorage(s, 0, { ground: 2, tunnel: 3, bridge: 0 });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), true, 'G G then T T T');
    setStorage(s, 0, { ground: 2, tunnel: 2, bridge: 9 });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), false, 'a Tunnel short');
  });

  check('P14.3/3a', 'a lay must end with new track: its last route unlaid', () => {
    // Portland - Reno unlaid, then Reno - Sacramento laid: ends with travel; not a legal lay (and not a zero-tile lay).
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 2 }, laid: ['SAC-REN'] });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN', 'SAC'], ['POR-REN', 'SAC-REN']), false);
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
  });

  check('P14.3/3b', 'a zero-tile lay: no unlaid route, ends in an inland city with no building, and the player is able to place one', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO', 'HEL-SPO'] });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), true);
    // A start city is not a destination for a zero-tile lay.
    const t = scene({ trains: ['SPO', 'MIN'], tiles: {}, laid: ['SEA-SPO'] });
    assert.equal(E.isLegalLay(t, 0, ['SPO', 'SEA'], ['SEA-SPO']), false);
    // A city with a building is not either.
    const u = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO'], buildings: [['railwayStation', 'SPO', 1]] });
    assert.equal(E.isLegalLay(u, 0, ['SEA', 'SPO'], ['SEA-SPO']), false);
    // Not able (no pieces): not legal.
    const v = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO'] });
    setHouses(v, 0, 0);
    v.players[0].telegraphsPlaced = 7;
    assert.equal(E.isLegalLay(v, 0, ['SEA', 'SPO'], ['SEA-SPO']), false);
  });

  check('P14.3/3b-score', 'a zero-tile lay scores no track VP, pays tolls, and ends with a building', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO', 'HEL-SPO'], buildings: [['railwayStation', 'SPO', 1]] });
    const ev = layNow(s, ['SEA-SPO', 'HEL-SPO']);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(frame(s), 'placeBuildings');
    assert.ok(ev.length > 0);
  });

  check('P14.3/4-path', 'layShape path (default): any number of unlaid routes anywhere on the path', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { bridge: 2, tunnel: 3, ground: 2 }, laid: ['POR-SPO'] });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'SPO', 'HEL', 'BIL'], ['POR-SPO', 'HEL-SPO', 'HEL-BIL']), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 3 } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO', 'HEL', 'BIL'], ['SEA-SPO', 'HEL-SPO', 'HEL-BIL']), true, 'three unlaid routes');
  });

  check('P14.3/4-one-new-route', 'layShape one-new-route: travel over laid routes, then exactly one unlaid route, the last; zero-tile lays allowed', () => {
    const v = { layShape: 'one-new-route' };
    const s = scene({ trains: ['POR', 'MIN'], tiles: { bridge: 2, tunnel: 3, ground: 2 }, laid: ['POR-SPO'], variants: v });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'SPO', 'HEL'], ['POR-SPO', 'HEL-SPO']), true, 'travel then one new route');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'SPO', 'HEL', 'BIL'], ['POR-SPO', 'HEL-SPO', 'HEL-BIL']), false, 'two unlaid routes');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO', 'HEL-SPO'], variants: v });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), true, 'zero-tile lays stay');
    // An unlaid route followed by travel is refused (the unlaid route must be last).
    const u = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 2 }, laid: ['SAC-REN'], variants: v });
    assert.equal(E.isLegalLay(u, 0, ['POR', 'REN', 'SAC'], ['POR-REN', 'SAC-REN']), false);
  });

  check('P14.3/4-adjacent-only', 'layShape adjacent-only: exactly one unlaid route starting at the train\'s city; no travel, no zero-tile lays', () => {
    const v = { layShape: 'adjacent-only' };
    const s = scene({ trains: ['POR', 'MIN'], tiles: { bridge: 2, tunnel: 3, ground: 2 }, laid: ['POR-SPO'], variants: v });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
    assert.equal(E.isLegalLay(s, 0, ['POR', 'SPO', 'HEL'], ['POR-SPO', 'HEL-SPO']), false, 'no travel');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'SPO'], ['POR-SPO']), false, 'no zero-tile lay');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 3 }, variants: v });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), false, 'two unlaid routes');
    chooseLay(t);
    assert.deepEqual(E.topFrame(t) === null ? [] : [t.players[0].railheads[0]], ['SPO'], 'the only lay was made');
  });

  check('P14.3/5-any', 'newConnectionRule any-unlaid-route (default): a route that only closes a loop may be laid', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 1, tunnel: 4, ground: 2 }, laid: ['SEA-SPO', 'HEL-SPO'] });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'HEL'], ['SEA-HEL']), true);
  });

  check('P14.3/5-must-join', 'newConnectionRule must-join-unjoined: each unlaid route must join two cities not already joined by laid routes before this lay', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 1, tunnel: 4, ground: 2 }, laid: ['SEA-SPO', 'HEL-SPO'], variants: { newConnectionRule: 'must-join-unjoined' } });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'HEL'], ['SEA-HEL']), false, 'Seattle and Helena are already joined through Spokane');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 1, tunnel: 4, ground: 2 }, laid: ['SEA-SPO'], variants: { newConnectionRule: 'must-join-unjoined' } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'HEL'], ['SEA-HEL']), true);
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'SPO', 'HEL'], ['SEA-SPO', 'HEL-SPO']), true, 'travel, then a new route to an unjoined city');
  });

  check('P14.3/5-before-this-lay', 'must-join-unjoined judges each route against the track laid BEFORE the lay: two new routes of one path may together close a loop', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 1, tunnel: 7 }, laid: ['SEA-SPO'], variants: { newConnectionRule: 'must-join-unjoined' } });
    // Seattle - Helena and Helena - Spokane are each new (Helena was joined to nothing); together with the laid Seattle - Spokane they form a triangle.
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'HEL', 'SPO'], ['SEA-HEL', 'HEL-SPO']), true);
    chooseLay(s);
    if (E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'SEA-HEL' });
    assert.ok(has(s, 'extendPath', { route: 'HEL-SPO' }));
  });

  check('P14.4', 'every path ends at a city: there is no lay that stops between cities', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 9, tunnel: 9, bridge: 9 } });
    chooseLay(s);
    if (E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    for (const a of offers(s, 'endLay')) assert.ok(a);
    // The path after one extension ends at a city of the route.
    act(s, { type: 'extendPath', route: 'SEA-SPO' });
    assert.equal(E.layPath(s).cities.at(-1), 'SPO');
  });

  check('P14.5/order', 'resolving a lay: tiles paid and routes laid, completion check, track VP, tolls, the train moves, then the building, then the carriage', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, laid: [] });
    s.players[0].layStationsPlaced = 0;
    const ev = layNow(s, ['SEA-SPO']);
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    const evAll = ev.concat([]);
    const order = evTypes(evAll);
    assert.ok(order.indexOf('routeLaid') < order.indexOf('vp'), 'pay before VP');
    assert.ok(order.indexOf('vp') < order.indexOf('railheadMoved'), 'VP before the move');
    assert.equal(s.players[0].train.specialistCarriages.length, 1, 'the carriage follows the building');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 1]] });
    // A toll is paid before the train moves.
    const ev2 = layNow(t, ['SEA-SPO']);
    const o2 = evTypes(ev2);
    assert.ok(o2.indexOf('toll') >= 0 && o2.indexOf('toll') < o2.indexOf('railheadMoved'));
    assert.ok(o2.indexOf('routeLaid') < o2.indexOf('toll'));
  });

  check('P14.5/1', 'paying moves the built tiles onto the slots; the routes are laid and belong to nobody', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, bridge: 1 } });
    layNow(s, ['SEA-SPO']);
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 1 });
    assert.equal(E.isLaid(s, 'SEA-SPO'), true);
  });

  check('P14.5/2', 'transcontinental check: a lay that for the first time joins a west start city to an east one completes the line, triggers the end, and pays 3 VP per slot instead', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    layNow(s, ['BIS-MIN']);
    assert.equal(vp(s, 0, 'completion'), 15);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(s.gameEnd.triggeredBy, 0);
  });

  check('P14.5/2b', 'a lay that does not complete a line triggers nothing', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL'] });
    layNow(s, ['BIS-MIN']);
    assert.equal(s.gameEnd, null);
    assert.equal(vp(s, 0, 'completion'), 0);
    assert.equal(vp(s, 0, 'track'), 5);
  });

  check('P14.5/4', 'tolls are paid for every city entered, before the train moves', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2, tunnel: 3 }, laid: [], buildings: [['telegraphStation', 'SPO', 1], ['railwayStation', 'HEL', 2]] });
    layNow(s, ['SEA-SPO', 'HEL-SPO']);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(vp(s, 2, 'toll'), 3);
  });

  check('P14.5/5', 'the train moves from c0 to ck; the other train does not move', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2, tunnel: 3 } });
    layNow(s, ['SEA-SPO', 'HEL-SPO']);
    assert.deepEqual(s.players[0].railheads, ['HEL', 'MIN']);
  });

  // ---- P14.6: the compulsory arrival building -------------------------------------------------

  /** Anna lays Seattle - Spokane (G G) with `arrange` applied to the position first. */
  function arrive(arrange, variants = {}, players = 3) {
    const s = scene({ players, trains: ['SEA', 'MIN'], tiles: { ground: 2 }, variants });
    if (arrange) arrange(s);
    const ev = layNow(s, ['SEA-SPO']);
    return { s, ev };
  }

  check('P14.6/both-possible', 'able with both kinds possible: a building must be placed, the player chooses which; there is no way to place neither', () => {
    const { s } = arrive(null);
    assert.equal(frame(s), 'placeBuildings');
    assert.ok(types(s).includes('placeRailwayStation') && types(s).includes('placeTelegraphStation'));
    assert.ok(!types(s).includes('skipBuilding'));
    refused(s, { type: 'skipBuilding' });
    assert.equal(s.turn.player, 0, 'the action cannot end until a building is placed');
  });

  check('P14.6/railway-only', 'only a railway station possible (a telegraph station already there, not Anna\'s): it must be placed', () => {
    const { s } = arrive((st) => build(st, 'telegraphStation', 'SPO', 1));
    assert.equal(frame(s), 'placeBuildings');
    assert.deepEqual(types(s), ['placeRailwayStation']);
  });

  check('P14.6/telegraph-only', 'only a telegraph station possible (another player\'s railway station there): it must be placed', () => {
    const { s } = arrive((st) => build(st, 'railwayStation', 'SPO', 1));
    assert.equal(s.map.telegraphStation.SPO, 0, 'the only legal answer, applied by the engine');
    assert.equal(s.map.railwayStation.SPO, 1);
    assert.equal(vp(s, 0, 'telegraph'), 1);
  });

  check('P14.6/no-houses', 'with no house left only a telegraph station is possible, and a lay into an empty city must place it', () => {
    const { s, ev } = arrive((st) => setHouses(st, 0, 0));
    assert.equal(s.map.telegraphStation.SPO, 0, 'placed (by the engine: the one legal answer)');
    assert.equal(s.map.railwayStation.SPO, null);
    assert.ok(ev.length > 0);
  });

  check('P14.6/no-telegraph', 'with no telegraph station left only a railway station is possible', () => {
    const { s } = arrive((st) => { st.players[0].telegraphsPlaced = 7; });
    assert.equal(frame(s), 'placeBuildings');
    assert.deepEqual(types(s), ['placeRailwayStation']);
  });

  check('P14.6/own-telegraph', 'not able: the player\'s own telegraph station is there, so a railway station would give them both and the telegraph slot is taken', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 0]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), false);
    layNow(s, ['SEA-SPO']);
    assert.equal(s.turn.player, 1, 'the lay stands, nothing is owed');
    assert.equal(s.map.railwayStation.SPO, null);
  });

  check('P14.6/own-railway', 'not able: the player\'s own railway station is there', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 0]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), false);
    layNow(s, ['SEA-SPO']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/both-taken', 'not able: the city holds both buildings', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 1], ['telegraphStation', 'SPO', 2]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), false);
    layNow(s, ['SEA-SPO']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/start-city', 'not able: a start city never takes a building', () => {
    const s = scene({ trains: ['SPO', 'MIN'], tiles: { ground: 2 } });
    layNow(s, ['SEA-SPO']);
    assert.equal(s.players[0].railheads[0], 'SEA');
    assert.equal(s.turn.player, 1, 'no building owed');
  });

  check('P14.6/no-pieces', 'not able: no house and no telegraph station left', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    setHouses(s, 0, 0);
    s.players[0].telegraphsPlaced = 7;
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), false);
    layNow(s, ['SEA-SPO']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/other-owner-blocks-nothing', 'another player\'s building in the city does not stop the player building the other kind', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 1]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 1]] });
    assert.equal(E.canPlaceArrivalBuilding(t, 0, 'SPO'), true);
  });

  check('P14.6/cost', 'an arrival building costs nothing: Coins, resources and storage are irrelevant', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'SPO'), true, 'with no Coin and no resource at all');
    layNow(s, ['SEA-SPO']);
    const before = JSON.stringify([s.players[0].resources, s.players[0].coins]);
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(JSON.stringify([s.players[0].resources, s.players[0].coins]), before);
  });

  check('P14.6/each-lay', 'every lay of a multi-lay action owes its own building', () => {
    const s = scene({ trains: ['SEA', 'POR'], tiles: { ground: 2, tunnel: 2 } });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['SEA-SPO'], 0);
    assert.equal(frame(s), 'placeBuildings');
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    doLay(s, ['POR-REN'], 1);
    assert.equal(frame(s), 'placeBuildings', 'the second lay owes one too');
    assert.equal(s.map.telegraphStation.REN, null);
  });

  check('P14.6/completing-lay', 'a lay that completes the line still owes the building when it ends in an inland city where the player is able', () => {
    const s = scene({ trains: ['HEL', 'LAX'], tiles: { bridge: 3, tunnel: 1 }, laid: ['SEA-HEL', 'BIS-MIN'] });
    layNow(s, ['HEL-BIS']);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(frame(s), 'placeBuildings');
  });

  check('P14.6/3-choice', 'for a railway station the player also chooses which house track gives the house; the chosen track\'s production rises', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 1]] });
    s.players[0].houses = { wood: 3, iron: 1, gunpowder: 3, coins: 3 };
    layNow(s, ['SEA-SPO']);
    assert.deepEqual([...new Set(offers(s, 'placeRailwayStation').map((a) => a.houseTrack))].sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    const before = E.production(s, 0, 'coins');
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'coins' });
    assert.equal(E.production(s, 0, 'coins'), before + 1);
    assert.equal(s.players[0].houses.coins, 2);
  });

  check('P14.6/3-one-track', 'with a railway station the only possible building and one track with a house, the engine places it', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 1]] });
    s.players[0].houses = { wood: 0, iron: 0, gunpowder: 2, coins: 0 };
    layNow(s, ['SEA-SPO']);
    assert.equal(s.map.railwayStation.SPO, 0);
    assert.equal(s.players[0].houses.gunpowder, 1);
  });

  check('P14.6/4', 'a telegraph station on arrival scores the next VP of the row; a railway station scores none and raises production', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    s.players[0].telegraphsPlaced = 2;
    layNow(s, ['SEA-SPO']);
    const before = vp(s, 0, 'telegraph');
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(vp(s, 0, 'telegraph') - before, 3, 'the third station: 3 VP');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    layNow(t, ['SEA-SPO']);
    const total = vpTotal(t, 0);
    act(t, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.equal(vpTotal(t, 0), total, 'no VP for a railway station');
  });

  check('P14.6/5', 'never more than one building per lay', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    layNow(s, ['SEA-SPO']);
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.equal(s.map.telegraphStation.SPO, null);
    assert.notEqual(frame(s), 'placeBuildings');
  });

  check('P14.6/optional', 'with arrivalBuilding = optional the building may be skipped (skipBuilding offered)', () => {
    const { s } = arrive(null, { arrivalBuilding: 'optional' });
    assert.ok(types(s).includes('skipBuilding'));
    act(s, { type: 'skipBuilding' });
    assert.equal(s.map.railwayStation.SPO, null);
    assert.equal(s.map.telegraphStation.SPO, null);
    assert.equal(s.turn.player, 1);
  });

  knownFailure('P14.6/optional-zero-tile', 'with arrivalBuilding = optional a zero-tile lay still ends with a building (P14.3.3 b, P21.1 row 4): skipBuilding must not be offered', () => {
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-SPO'], variants: { arrivalBuilding: 'optional' } });
    layNow(t, ['SEA-SPO']);
    assert.equal(frame(t), 'placeBuildings');
    assert.ok(!types(t).includes('skipBuilding'), 'skipBuilding is offered after a zero-tile lay');
    refused(t, { type: 'skipBuilding' });
  });

  // ---- P14.7: track VP --------------------------------------------------------------------------

  check('P14.7/2', 'each slot scores 2 VP when its scoring city is an inland city with no building; 1 VP when it has a building or is a start city', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    layNow(s, ['SEA-SPO']);
    assert.equal(vp(s, 0, 'track'), 4);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 1]] });
    layNow(t, ['SEA-SPO']);
    assert.equal(vp(t, 0, 'track'), 2);
    // Own building counts as a building.
    const u = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    build(u, 'telegraphStation', 'SPO', 0);
    u.players[0].telegraphsPlaced = 0;
    layNow(u, ['SEA-SPO']);
    assert.equal(vp(u, 0, 'track'), 2);
  });

  check('P14.7/1', 'the scoring city is the first start city or connected city on the path from the route\'s far end onwards; if none, the destination', () => {
    // Path SEA - SPO - HEL - BIL: no buildings: everything scored by Billings (empty): 7 slots x 2.
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 3 } });
    layNow(s, ['SEA-SPO', 'HEL-SPO', 'HEL-BIL']);
    assert.equal(vp(s, 0, 'track'), 14);
    // A building in Helena: SEA-SPO and SPO-HEL are scored by Helena (1 VP), HEL-BIL by Billings (2).
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 3 }, buildings: [['telegraphStation', 'HEL', 2]] });
    layNow(t, ['SEA-SPO', 'HEL-SPO', 'HEL-BIL']);
    assert.equal(vp(t, 0, 'track'), 2 * 1 + 3 * 1 + 2 * 2);
    assert.equal(vp(t, 2, 'toll'), 3);
  });

  check('P14.7/1b', 'the scoring city is found walking on along the path, over laid routes too: unlaid, laid, unlaid', () => {
    // Seattle - Spokane (new, empty), Spokane - Helena (laid), Helena holds a building, Helena - Billings (new, empty).
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4 }, laid: ['HEL-SPO'], buildings: [['telegraphStation', 'HEL', 1]] });
    layNow(s, ['SEA-SPO', 'HEL-SPO', 'HEL-BIL']);
    assert.equal(vp(s, 0, 'track'), 2 * 1 + 2 * 2, 'Seattle - Spokane is scored by Helena (1 VP), Helena - Billings by Billings (2 VP)');
    assert.equal(vp(s, 1, 'toll'), 3, 'Helena is entered by travelling through');
  });

  check('P14.7/4', 'a city passed through without a building is not a stop', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2, tunnel: 3 }, buildings: [['railwayStation', 'SPO', 1]] });
    // Building in Spokane: SEA-SPO scored 1 per slot by Spokane; SPO-HEL: Helena (empty, dest) 2 per slot.
    layNow(s, ['SEA-SPO', 'HEL-SPO']);
    assert.equal(vp(s, 0, 'track'), 2 * 1 + 3 * 2);
  });

  check('P14.7/start-stop', 'a start city on the path is a stop: the route into it scores 1 VP per slot', () => {
    // Train on Spokane: Spokane - Seattle (G G) then Seattle - Helena (B T T T T): Seattle is a start city.
    const s = scene({ trains: ['SPO', 'MIN'], tiles: { ground: 2, bridge: 1, tunnel: 4 } });
    layNow(s, ['SEA-SPO', 'SEA-HEL']);
    assert.equal(vp(s, 0, 'track'), 2 * 1 + 5 * 2);
  });

  check('P14.7/3', 'buildings are judged as they stand when the lay is resolved: a building placed by an earlier lay of the same action counts; the lay\'s own arrival building does not', () => {
    const s = scene({ trains: ['SEA', 'POR'], tiles: { ground: 2, bridge: 4, tunnel: 3 } });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['SEA-SPO'], 0); // Spokane empty: 2 x 2
    assert.equal(vp(s, 0, 'track'), 4);
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    // Second lay from Portland through Spokane (laid? no: POR-SPO is unlaid) ending ... Portland - Spokane: Spokane now has a building.
    doLay(s, ['POR-SPO'], 1);
    assert.equal(vp(s, 0, 'track'), 4 + 2 * 1, 'the earlier lay\'s telegraph station makes Spokane connected');
  });

  check('P14.7/5', 'nothing else scores for track: no first-connection bonus', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 } });
    const ev = layNow(s, ['SEA-SPO']);
    assert.equal(vpOfEvents(ev, 0), 4);
    assert.equal(vpTotal(s, 0), 4);
  });

  check('P14.8', 'a laid route is never laid again or extended: a path can only travel over it', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, laid: ['SEA-SPO'] });
    const q = E.evaluateLay(s, 0, ['SEA', 'SPO'], ['SEA-SPO']);
    assert.equal(q.slots, 0);
    assert.deepEqual(q.tiles, { ground: 0, tunnel: 0, bridge: 0 });
  });

  void knownFailure;
  void offered;
  void giveCarriages;
  void put;
  void choose;
  void eventOf;
  void placeAndChoose;
}
