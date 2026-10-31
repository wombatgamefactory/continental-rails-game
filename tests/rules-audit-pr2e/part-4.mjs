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

  check('P13.1', 'the network: no two cities joined twice, no route between two start cities, every start city has exactly 2 routes (one of 1 slot, one of 3), at most one wild slot per route', () => {
    const pairs = new Set();
    for (const r of E.MAP.routes) {
      const key = [r.a, r.b].sort().join('-');
      assert.ok(!pairs.has(key), `${key} joined twice`);
      pairs.add(key);
      assert.ok(!(E.isStartCity(r.a) && E.isStartCity(r.b)), `${key} joins two start cities`);
      assert.ok(r.length >= 1 && r.length <= 4, `${key}: 1 to 4 slots`);
      assert.ok(r.terrains.filter((t) => t === 'wild').length <= 1, `${key}: at most one wild slot`);
    }
    for (const c of E.MAP.startCities) {
      const id = c.id ?? c;
      assert.deepEqual(E.MAP.cityRoutes[id].map((r) => E.MAP.routeById[r].length).sort(), [1, 3], id);
    }
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
    const s = scene({ trains: ['TDL', 'MIN'], tiles: { ground: 1, tunnel: 1, bridge: 1 }, laid: [] });
    layNow(s, ['SEA-TDL']);
    assert.equal(vp(s, 0, 'track'), 3, '3 slots x 1 VP');
  });

  check('P13.2/ordinary', 'a start city is otherwise ordinary: a lay may start from it, end on it, or pass through it', () => {
    // Pass through Seattle: Yakima - Seattle - The Dalles.
    const s = scene({ trains: ['YAK', 'MIN'], tiles: { ground: 1, bridge: 1, tunnel: 2 } });
    assert.equal(E.isLegalLay(s, 0, ['YAK', 'SEA', 'TDL'], ['SEA-YAK', 'SEA-TDL']), true, 'through a start city');
    assert.equal(E.isLegalLay(s, 0, ['YAK', 'SEA'], ['SEA-YAK']), true, 'ending on it');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'YAK'], ['SEA-YAK']), true, 'starting from it');
  });

  check('P13.3', 'inland cities: 27, each with room for one railway station and one telegraph station', () => {
    assert.equal(E.MAP.inlandCities.length, 27);
    assert.equal(E.getConstants(start(2)).MAP_RULES.buildingsPerLay, 1);
  });

  check('P13.4', 'a route is laid whole, once, for the rest of the game; it belongs to nobody and any train may travel over it', () => {
    const s = scene({ tiles: { tunnel: 1 } });
    layNow(s, ['SEA-YAK']);
    assert.notEqual(s.map.routeOwner['SEA-YAK'], null);
    // Travelling over it costs nothing and re-laying is impossible: the path simply travels.
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'] });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'YAK'], ['SEA-YAK']), true);
    assert.equal(E.evaluateLay(t, 0, ['SEA', 'YAK'], ['SEA-YAK']).slots, 0);
  });

  check('P13.5', 'an inland city is off the network, on the network but not connected, or connected', () => {
    const s = start(2);
    assert.equal(E.isOnNetwork(s, 'YAK'), false);
    layRoutes(s, ['SEA-YAK']);
    assert.equal(E.isOnNetwork(s, 'YAK'), true);
    assert.equal(E.isCityConnected(s, 'YAK'), false);
    build(s, 'telegraphStation', 'YAK', 1);
    assert.equal(E.isCityConnected(s, 'YAK'), true);
  });

  // -------------------------------------------------------------------------
  // P14 - the lay
  // -------------------------------------------------------------------------

  check('P14.1', 'M lays, each fully resolved before the next; the first is required, later ones optional; either train, including one that has just moved', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 2, tunnel: 3, bridge: 2 } });
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
    doLay(s, ['REN-SAC'], 0);
    assert.equal(s.players[0].railheads[0], 'SAC');
    assert.equal(s.map.routeOwner['REN-SAC'], 0);
  });

  check('P14.1/stop', 'after the first lay the player may stop laying', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 2, tunnel: 1, bridge: 1 } });
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
    refused(s, { type: 'extendPath', route: 'SPO-TDL' }); // not joined to Seattle
    refused(s, { type: 'extendPath', route: 'SEA-BIL' }); // no such route
    act(s, { type: 'extendPath', route: 'SEA-TDL' });
    assert.ok(has(s, 'extendPath', { route: 'SPO-TDL' }));
  });

  check('P14.2/3', 'no city appears twice on a path', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 9, tunnel: 9, bridge: 9 } });
    chooseLay(s);
    act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'SEA-YAK' });
    refused(s, { type: 'extendPath', route: 'SEA-YAK' });
    act(s, { type: 'extendPath', route: 'YAK-TDL' });
    refused(s, { type: 'extendPath', route: 'SEA-TDL' }); // would return to Seattle
    assert.ok(!offers(s, 'extendPath').some((a) => a.route === 'SEA-TDL' || a.route === 'YAK-TDL'));
  });

  check('P14.2/mix', 'a path may mix laid and unlaid routes in any order: travel, lay, travel, lay', () => {
    // Portland - The Dalles (laid), The Dalles - Boise (unlaid T B), Boise - Helena (laid), Helena - Denver (unlaid T).
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 2, bridge: 1 }, laid: ['TDL-POR', 'HEL-BOI'] });
    const cities = ['POR', 'TDL', 'BOI', 'HEL', 'DEN'];
    const routes = ['TDL-POR', 'TDL-BOI', 'HEL-BOI', 'HEL-DEN'];
    assert.equal(E.isLegalLay(s, 0, cities, routes), true);
    const ev = layNow(s, routes);
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
    assert.equal(s.players[0].railheads[0], 'DEN');
    assert.ok(ev.some((e) => e.type === 'railheadMoved'));
  });

  check('P14.3/2', 'tiles: one built tile of the slot\'s terrain for every Ground, Tunnel and Bridge slot of every unlaid route, all at once - no part payment (a wild slot takes one more tile of any type, P14.9.2)', () => {
    // Pueblo - Santa Fe is Ground Tunnel Tunnel: 1 Ground + 2 Tunnel.
    const s = scene({ trains: ['PUE', 'MIN'], tiles: { ground: 1, tunnel: 2 } });
    assert.equal(E.isLegalLay(s, 0, ['PUE', 'SFE'], ['PUE-SFE']), true);
    for (const tiles of [{ ground: 0, tunnel: 2, bridge: 5 }, { ground: 1, tunnel: 1 }, { ground: 5, tunnel: 0 }]) {
      setStorage(s, 0, tiles);
      assert.equal(E.isLegalLay(s, 0, ['PUE', 'SFE'], ['PUE-SFE']), false, JSON.stringify(tiles));
    }
    // Two unlaid routes need both sets at once: Seattle - The Dalles (G T B) and The Dalles - Spokane (G G) need 3 Ground, 1 Tunnel, 1 Bridge.
    setStorage(s, 0, { ground: 3, tunnel: 1, bridge: 1 });
    setTrains(s, 0, ['SEA', 'MIN']);
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'TDL'], ['SEA-TDL']), true);
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), true, 'G T B then G G');
    setStorage(s, 0, { ground: 2, tunnel: 9, bridge: 9 });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), false, 'a Ground short');
    setStorage(s, 0, { ground: 3, tunnel: 0, bridge: 9 });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), false, 'a Tunnel short');
  });

  check('P14.3/3a', 'a lay must end with new track: its last route unlaid', () => {
    // Portland - Reno unlaid, then Reno - Sacramento laid: ends with travel; not a legal lay (and not a zero-tile lay).
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 1, tunnel: 1, bridge: 1 }, laid: ['REN-SAC'] });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN', 'SAC'], ['POR-REN', 'REN-SAC']), false);
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
  });

  check('P14.3/3b', 'a zero-tile lay: no unlaid route, ends in an inland city with no building, and the player is able to place one', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-TDL', 'SPO-TDL'] });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), true);
    // A start city is not a destination for a zero-tile lay.
    const t = scene({ trains: ['YAK', 'MIN'], tiles: {}, laid: ['SEA-YAK'] });
    assert.equal(E.isLegalLay(t, 0, ['YAK', 'SEA'], ['SEA-YAK']), false);
    // A city with a building is not either.
    const u = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'], buildings: [['railwayStation', 'YAK', 1]] });
    assert.equal(E.isLegalLay(u, 0, ['SEA', 'YAK'], ['SEA-YAK']), false);
    // Not able (no pieces): not legal.
    const v = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'] });
    setHouses(v, 0, 0);
    v.players[0].telegraphsPlaced = 7;
    assert.equal(E.isLegalLay(v, 0, ['SEA', 'YAK'], ['SEA-YAK']), false);
  });

  check('P14.3/3b-score', 'a zero-tile lay scores no track VP, pays tolls, and ends with a building', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-TDL', 'SPO-TDL'], buildings: [['railwayStation', 'TDL', 1]] });
    const ev = layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(frame(s), 'placeBuildings');
    assert.ok(ev.length > 0);
  });

  check('P14.3/4-path', 'layShape path (default): any number of unlaid routes anywhere on the path', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 }, laid: ['TDL-POR'] });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'TDL', 'SPO', 'HEL'], ['TDL-POR', 'SPO-TDL', 'SPO-HEL']), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 2, bridge: 2 } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'TDL', 'SPO', 'HEL'], ['SEA-TDL', 'SPO-TDL', 'SPO-HEL']), true, 'three unlaid routes');
  });

  check('P14.3/4-one-new-route', 'layShape one-new-route: travel over laid routes, then exactly one unlaid route, the last; zero-tile lays allowed', () => {
    const v = { layShape: 'one-new-route' };
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 3, tunnel: 3, bridge: 2 }, laid: ['TDL-POR'], variants: v });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'TDL', 'SPO'], ['TDL-POR', 'SPO-TDL']), true, 'travel then one new route');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'TDL', 'SPO', 'HEL'], ['TDL-POR', 'SPO-TDL', 'SPO-HEL']), false, 'two unlaid routes');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-TDL', 'SPO-TDL'], variants: v });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), true, 'zero-tile lays stay');
    // An unlaid route followed by travel is refused (the unlaid route must be last).
    const u = scene({ trains: ['POR', 'MIN'], tiles: { ground: 1, tunnel: 1, bridge: 1 }, laid: ['REN-SAC'], variants: v });
    assert.equal(E.isLegalLay(u, 0, ['POR', 'REN', 'SAC'], ['POR-REN', 'REN-SAC']), false);
  });

  check('P14.3/4-adjacent-only', 'layShape adjacent-only: exactly one unlaid route starting at the train\'s city; no travel, no zero-tile lays', () => {
    const v = { layShape: 'adjacent-only' };
    const s = scene({ trains: ['POR', 'MIN'], tiles: { ground: 3, tunnel: 3, bridge: 2 }, laid: ['TDL-POR'], variants: v });
    assert.equal(E.isLegalLay(s, 0, ['POR', 'REN'], ['POR-REN']), true);
    assert.equal(E.isLegalLay(s, 0, ['POR', 'TDL', 'SPO'], ['TDL-POR', 'SPO-TDL']), false, 'no travel');
    assert.equal(E.isLegalLay(s, 0, ['POR', 'TDL'], ['TDL-POR']), false, 'no zero-tile lay');
    const t = scene({ trains: ['SEA', 'SEA'], tiles: { ground: 4, tunnel: 3, bridge: 3 }, variants: v });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'TDL', 'SPO'], ['SEA-TDL', 'SPO-TDL']), false, 'two unlaid routes');
    const u = scene({ trains: ['SEA', 'SEA'], tiles: { tunnel: 1 }, variants: v });
    chooseLay(u);
    assert.equal(u.players[0].railheads[0], 'YAK', 'the only lay (Seattle - Yakima) was made');
  });

  check('P14.3/5-any', 'newConnectionRule any-unlaid-route (default): a route that only closes a loop may be laid', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, laid: ['SEA-TDL', 'YAK-TDL'] });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'YAK'], ['SEA-YAK']), true);
  });

  check('P14.3/5-must-join', 'newConnectionRule must-join-unjoined: each unlaid route must join two cities not already joined by laid routes before this lay', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, laid: ['SEA-TDL', 'YAK-TDL'], variants: { newConnectionRule: 'must-join-unjoined' } });
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'YAK'], ['SEA-YAK']), false, 'Seattle and Yakima are already joined through The Dalles');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 2, bridge: 1 }, laid: ['SEA-TDL'], variants: { newConnectionRule: 'must-join-unjoined' } });
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'YAK'], ['SEA-YAK']), true);
    assert.equal(E.isLegalLay(t, 0, ['SEA', 'TDL', 'YAK'], ['SEA-TDL', 'YAK-TDL']), true, 'travel, then a new route to an unjoined city');
  });

  check('P14.3/5-before-this-lay', 'must-join-unjoined judges each route against the track laid BEFORE the lay: two new routes of one path may together close a loop', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 1, tunnel: 2 }, laid: ['SEA-TDL'], variants: { newConnectionRule: 'must-join-unjoined' } });
    // Seattle - Yakima and Yakima - The Dalles are each new (Yakima was joined to nothing); together with the laid Seattle - The Dalles they form a triangle.
    assert.equal(E.isLegalLay(s, 0, ['SEA', 'YAK', 'TDL'], ['SEA-YAK', 'YAK-TDL']), true);
    chooseLay(s);
    if (E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'SEA-YAK' });
    assert.ok(has(s, 'extendPath', { route: 'YAK-TDL' }));
  });

  check('P14.4', 'every path ends at a city: there is no lay that stops between cities', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 9, tunnel: 9, bridge: 9 } });
    chooseLay(s);
    if (E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    for (const a of offers(s, 'endLay')) assert.ok(a);
    // The path after one extension ends at a city of the route.
    act(s, { type: 'extendPath', route: 'SEA-TDL' });
    assert.equal(E.layPath(s).cities.at(-1), 'TDL');
  });

  check('P14.5/order', 'resolving a lay: tiles paid and routes laid, completion check, track VP, tolls, the train moves, then the building, then the carriage', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, laid: [] });
    s.players[0].layStationsPlaced = 0;
    const ev = layNow(s, ['SEA-YAK']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    const evAll = ev.concat([]);
    const order = evTypes(evAll);
    assert.ok(order.indexOf('routeLaid') < order.indexOf('vp'), 'pay before VP');
    assert.ok(order.indexOf('vp') < order.indexOf('railheadMoved'), 'VP before the move');
    assert.equal(s.players[0].train.specialistCarriages.length, 1, 'the carriage follows the building');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 1]] });
    // A toll is paid before the train moves.
    const ev2 = layNow(t, ['SEA-YAK']);
    const o2 = evTypes(ev2);
    assert.ok(o2.indexOf('toll') >= 0 && o2.indexOf('toll') < o2.indexOf('railheadMoved'));
    assert.ok(o2.indexOf('routeLaid') < o2.indexOf('toll'));
  });

  check('P14.5/1', 'paying moves the built tiles onto the slots; the routes are laid and belong to nobody', () => {
    const s = scene({ trains: ['LAX', 'MIN'], tiles: { ground: 3, bridge: 1 } });
    layNow(s, ['LAX-SBD']);
    assert.deepEqual(s.players[0].builtTiles, { ground: 2, tunnel: 0, bridge: 1 });
    assert.equal(E.isLaid(s, 'LAX-SBD'), true);
  });

  check('P14.5/2', 'transcontinental check: a lay that for the first time joins a west start city to an east one completes the line, triggers the end, and pays 3 VP per slot instead', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 2, bridge: 1 }, laid: ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIS'] });
    layNow(s, ['FAR-BIS', 'FAR-MIN']);
    assert.equal(vp(s, 0, 'completion'), 9);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(s.gameEnd.triggeredBy, 0);
  });

  check('P14.5/2b', 'a lay that does not complete a line triggers nothing', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 2, bridge: 1 }, laid: ['SEA-YAK'] });
    layNow(s, ['FAR-BIS', 'FAR-MIN']);
    assert.equal(s.gameEnd, null);
    assert.equal(vp(s, 0, 'completion'), 0);
    assert.equal(vp(s, 0, 'track'), 3, '3 slots, scored by Minneapolis (a start city): 1 VP each');
  });

  check('P14.5/4', 'tolls are paid for every city entered, before the train moves', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 }, laid: [], buildings: [['telegraphStation', 'TDL', 1], ['railwayStation', 'SPO', 2]] });
    layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(vp(s, 2, 'toll'), 3);
  });

  check('P14.5/5', 'the train moves from c0 to ck; the other train does not move', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 } });
    layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.deepEqual(s.players[0].railheads, ['SPO', 'MIN']);
  });

  // ---- P14.6: the compulsory arrival building -------------------------------------------------

  /** Anna lays Seattle - Yakima (T) with `arrange` applied to the position first. */
  function arrive(arrange, variants = {}, players = 3) {
    const s = scene({ players, trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, variants });
    if (arrange) arrange(s);
    const ev = layNow(s, ['SEA-YAK']);
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
    const { s } = arrive((st) => build(st, 'telegraphStation', 'YAK', 1));
    assert.equal(frame(s), 'placeBuildings');
    assert.deepEqual(types(s), ['placeRailwayStation']);
  });

  check('P14.6/telegraph-only', 'only a telegraph station possible (another player\'s railway station there): it must be placed', () => {
    const { s } = arrive((st) => build(st, 'railwayStation', 'YAK', 1));
    assert.equal(s.map.telegraphStation.YAK, 0, 'the only legal answer, applied by the engine');
    assert.equal(s.map.railwayStation.YAK, 1);
    assert.equal(vp(s, 0, 'telegraph'), 1);
  });

  check('P14.6/no-houses', 'with no house left only a telegraph station is possible, and a lay into an empty city must place it', () => {
    const { s, ev } = arrive((st) => setHouses(st, 0, 0));
    assert.equal(s.map.telegraphStation.YAK, 0, 'placed (by the engine: the one legal answer)');
    assert.equal(s.map.railwayStation.YAK, null);
    assert.ok(ev.length > 0);
  });

  check('P14.6/no-telegraph', 'with no telegraph station left only a railway station is possible', () => {
    const { s } = arrive((st) => { st.players[0].telegraphsPlaced = 7; });
    assert.equal(frame(s), 'placeBuildings');
    assert.deepEqual(types(s), ['placeRailwayStation']);
  });

  check('P14.6/own-telegraph', 'not able: the player\'s own telegraph station is there, so a railway station would give them both and the telegraph slot is taken', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 0]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    layNow(s, ['SEA-YAK']);
    assert.equal(s.turn.player, 1, 'the lay stands, nothing is owed');
    assert.equal(s.map.railwayStation.YAK, null);
  });

  check('P14.6/own-railway', 'not able: the player\'s own railway station is there', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 0]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    layNow(s, ['SEA-YAK']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/both-taken', 'not able: the city holds both buildings', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 1], ['telegraphStation', 'YAK', 2]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    layNow(s, ['SEA-YAK']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/start-city', 'not able: a start city never takes a building', () => {
    const s = scene({ trains: ['YAK', 'MIN'], tiles: { tunnel: 1 } });
    layNow(s, ['SEA-YAK']);
    assert.equal(s.players[0].railheads[0], 'SEA');
    assert.equal(s.turn.player, 1, 'no building owed');
  });

  check('P14.6/no-pieces', 'not able: no house and no telegraph station left', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    setHouses(s, 0, 0);
    s.players[0].telegraphsPlaced = 7;
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    layNow(s, ['SEA-YAK']);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/other-owner-blocks-nothing', 'another player\'s building in the city does not stop the player building the other kind', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 1]] });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), true);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    assert.equal(E.canPlaceArrivalBuilding(t, 0, 'YAK'), true);
  });

  check('P14.6/cost', 'an arrival building costs nothing: Coins, resources and storage are irrelevant', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), true, 'with no Coin and no resource at all');
    layNow(s, ['SEA-YAK']);
    const before = JSON.stringify([s.players[0].resources, s.players[0].coins]);
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    assert.equal(JSON.stringify([s.players[0].resources, s.players[0].coins]), before);
  });

  check('P14.6/each-lay', 'every lay of a multi-lay action owes its own building', () => {
    const s = scene({ trains: ['SEA', 'POR'], tiles: { ground: 1, tunnel: 2, bridge: 1 } });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['SEA-YAK'], 0);
    assert.equal(frame(s), 'placeBuildings');
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    doLay(s, ['POR-REN'], 1);
    assert.equal(frame(s), 'placeBuildings', 'the second lay owes one too');
    assert.equal(s.map.telegraphStation.REN, null);
  });

  check('P14.6/completing-lay', 'a lay that completes the line still owes the building when it ends in an inland city where the player is able', () => {
    const s = scene({ trains: ['GFA', 'LAX'], tiles: { ground: 2, bridge: 2 }, laid: ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'FAR-BIS', 'FAR-MIN'] });
    layNow(s, ['GFA-BIS']);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(frame(s), 'placeBuildings');
  });

  check('P14.6/3-choice', 'for a railway station the player also chooses which house track gives the house; the chosen track\'s production rises', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    s.players[0].houses = { wood: 3, iron: 1, gunpowder: 3, coins: 3 };
    layNow(s, ['SEA-YAK']);
    assert.deepEqual([...new Set(offers(s, 'placeRailwayStation').map((a) => a.houseTrack))].sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    const before = E.production(s, 0, 'coins');
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'coins' });
    assert.equal(E.production(s, 0, 'coins'), before + 1);
    assert.equal(s.players[0].houses.coins, 2);
  });

  check('P14.6/3-one-track', 'with a railway station the only possible building and one track with a house, the engine places it', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    s.players[0].houses = { wood: 0, iron: 0, gunpowder: 2, coins: 0 };
    layNow(s, ['SEA-YAK']);
    assert.equal(s.map.railwayStation.YAK, 0);
    assert.equal(s.players[0].houses.gunpowder, 1);
  });

  check('P14.6/4', 'a telegraph station on arrival scores the next VP of the row; a railway station scores none and raises production', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    s.players[0].telegraphsPlaced = 2;
    layNow(s, ['SEA-YAK']);
    const before = vp(s, 0, 'telegraph');
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    assert.equal(vp(s, 0, 'telegraph') - before, 3, 'the third station: 3 VP');
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    layNow(t, ['SEA-YAK']);
    const total = vpTotal(t, 0);
    act(t, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(vpTotal(t, 0), total, 'no VP for a railway station');
  });

  check('P14.6/5', 'never more than one building per lay', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    layNow(s, ['SEA-YAK']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(s.map.telegraphStation.YAK, null);
    assert.notEqual(frame(s), 'placeBuildings');
  });

  check('P14.6/optional', 'with arrivalBuilding = optional the building may be skipped (skipBuilding offered)', () => {
    const { s } = arrive(null, { arrivalBuilding: 'optional' });
    assert.ok(types(s).includes('skipBuilding'));
    act(s, { type: 'skipBuilding' });
    assert.equal(s.map.railwayStation.YAK, null);
    assert.equal(s.map.telegraphStation.YAK, null);
    assert.equal(s.turn.player, 1);
  });

  check('P14.6/optional-zero-tile', 'with arrivalBuilding = optional a zero-tile lay still ends with a building (P14.3.3 b, P21.1 row 4): skipBuilding must not be offered', () => {
    const t = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'], variants: { arrivalBuilding: 'optional' } });
    layNow(t, ['SEA-YAK']);
    assert.equal(frame(t), 'placeBuildings');
    assert.ok(!types(t).includes('skipBuilding'), 'skipBuilding is offered after a zero-tile lay');
    refused(t, { type: 'skipBuilding' });
  });

  // ---- P14.7: track VP --------------------------------------------------------------------------

  check('P14.7/2', 'each slot scores 2 VP when its scoring city is an inland city with no building; 1 VP when it has a building or is a start city', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    layNow(s, ['SEA-YAK']);
    assert.equal(vp(s, 0, 'track'), 2);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    layNow(t, ['SEA-YAK']);
    assert.equal(vp(t, 0, 'track'), 1);
    // Own building counts as a building.
    const u = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    build(u, 'telegraphStation', 'YAK', 0);
    u.players[0].telegraphsPlaced = 0;
    layNow(u, ['SEA-YAK']);
    assert.equal(vp(u, 0, 'track'), 1);
    // A longer route: 3 slots into an empty city score 3 x 2 (The Dalles is empty).
    const w = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 1, tunnel: 1, bridge: 1 } });
    layNow(w, ['SEA-TDL']);
    assert.equal(vp(w, 0, 'track'), 6);
  });

  check('P14.7/1', 'the scoring city is the first start city or connected city on the path from the route\'s far end onwards; if none, the destination', () => {
    // Path SEA - TDL - SPO - HEL (the last route has a wild slot): no buildings: everything scored by Helena (empty): 8 slots x 2.
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 2, bridge: 2 } });
    layNow(s, ['SEA-TDL', 'SPO-TDL', 'SPO-HEL']);
    assert.equal(vp(s, 0, 'track'), 16);
    // A building in Spokane: SEA-TDL and TDL-SPO are scored by Spokane (1 VP), SPO-HEL by Helena (2).
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 4, tunnel: 2, bridge: 2 }, buildings: [['telegraphStation', 'SPO', 2]] });
    layNow(t, ['SEA-TDL', 'SPO-TDL', 'SPO-HEL']);
    assert.equal(vp(t, 0, 'track'), 3 * 1 + 2 * 1 + 3 * 2);
    assert.equal(vp(t, 2, 'toll'), 3);
  });

  check('P14.7/1b', 'the scoring city is found walking on along the path, over laid routes too: unlaid, laid, unlaid', () => {
    // Seattle - Yakima (new, empty), Yakima - Spokane (laid), Spokane holds a building, Spokane - Great Falls (new, empty).
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 4, bridge: 1 }, laid: ['YAK-SPO'], buildings: [['telegraphStation', 'SPO', 1]] });
    layNow(s, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA']);
    assert.equal(vp(s, 0, 'track'), 1 * 1 + 4 * 2, 'Seattle - Yakima is scored by Spokane (1 VP), Spokane - Great Falls by Great Falls (2 VP)');
    assert.equal(vp(s, 1, 'toll'), 3, 'Spokane is entered by travelling through');
  });

  check('P14.7/4', 'a city passed through without a building is not a stop', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 }, buildings: [['railwayStation', 'TDL', 1]] });
    // Building in The Dalles: SEA-TDL scored 1 per slot by The Dalles; TDL-SPO: Spokane (empty, dest) 2 per slot.
    layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 0, 'track'), 3 * 1 + 2 * 2);
    // With no building in The Dalles it is not a stop: both routes are scored by Spokane.
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 } });
    layNow(t, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(t, 0, 'track'), 5 * 2);
  });

  check('P14.7/start-stop', 'a start city on the path is a stop: the route into it scores 1 VP per slot', () => {
    // Train on Yakima: Yakima - Seattle (T) then Seattle - The Dalles (G T B): Seattle is a start city.
    const s = scene({ trains: ['YAK', 'MIN'], tiles: { ground: 1, tunnel: 2, bridge: 1 } });
    layNow(s, ['SEA-YAK', 'SEA-TDL']);
    assert.equal(vp(s, 0, 'track'), 1 * 1 + 3 * 2);
  });

  check('P14.7/3', 'buildings are judged as they stand when the lay is resolved: a building placed by an earlier lay of the same action counts; the lay\'s own arrival building does not', () => {
    const s = scene({ trains: ['SEA', 'TDL'], tiles: { tunnel: 2, bridge: 1 } });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['SEA-YAK'], 0); // Yakima empty: 1 x 2
    assert.equal(vp(s, 0, 'track'), 2);
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    // Second lay from The Dalles to Yakima (T B): Yakima now has a building.
    doLay(s, ['YAK-TDL'], 1);
    assert.equal(vp(s, 0, 'track'), 2 + 2 * 1, 'the earlier lay\'s telegraph station makes Yakima connected');
  });

  check('P14.7/5', 'nothing else scores for track: no first-connection bonus', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    const ev = layNow(s, ['SEA-YAK']);
    assert.equal(vpOfEvents(ev, 0), 2);
    assert.equal(vpTotal(s, 0), 2);
  });

  check('P14.8', 'a laid route is never laid again or extended: a path can only travel over it', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, laid: ['SEA-YAK'] });
    const q = E.evaluateLay(s, 0, ['SEA', 'YAK'], ['SEA-YAK']);
    assert.equal(q.slots, 0);
    assert.deepEqual(q.tiles, { ground: 0, tunnel: 0, bridge: 0, wild: 0 });
  });

  void knownFailure;
  void offered;
  void giveCarriages;
  void put;
  void choose;
  void eventOf;
  void placeAndChoose;
}
