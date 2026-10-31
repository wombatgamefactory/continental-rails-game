// Rules audit (pr2e), part 9: the wild slot (P1.16, P14.3 item 2, P14.9, P14.7 item 2, P19.2, P21.1 row 8)
// and the worked example E9. Written from the rules text: three tan slots of route map v3 take ONE built
// tile of ANY terrain; the player chooses, when ending the lay, only when the choice is real.

import { assert, E, start, act, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, check, refused, has, offers, frame, chooseLay, doLay, layNow, vp } from './kit.mjs';

/** Gus (player 0) on Denver with 3 Tunnel, 2 Bridge, 1 Ground and carriage 1; Billings and Bismarck are off the network (E9). */
function e9(tiles = { tunnel: 3, bridge: 2, ground: 1 }, variants = {}) {
  const s = start(3, { variants });
  giveCarriages(s, 0, [['crew', null]]);
  setTrains(s, 0, ['DEN', 'MIN']);
  setStorage(s, 0, tiles);
  return s;
}

/** Denver - Billings - Bismarck, built route by route, up to `endLay` (taken by the engine when it is the only answer). */
function endE9(s) {
  const events = chooseLay(s);
  events.push(...act(s, { type: 'startLay', train: 0 }));
  events.push(...act(s, { type: 'extendPath', route: 'BIL-DEN' }));
  events.push(...act(s, { type: 'extendPath', route: 'BIL-BIS' }));
  const top = E.topFrame(s);
  if (top.kind === 'lay' && top.path !== null) events.push(...act(s, { type: 'endLay' }));
  return events;
}

export default function part9() {
  check('P1.16/wild', 'a wild slot is a kind of SLOT, not of tile: three of them (Spokane - Helena, Billings - Denver, Billings - Bismarck), each on a route with at most one; every track tile is still Ground, Tunnel or Bridge', () => {
    const wild = E.MAP.routes.filter((r) => r.terrains.includes('wild'));
    assert.deepEqual(wild.map((r) => r.id).sort(), ['BIL-BIS', 'BIL-DEN', 'SPO-HEL']);
    for (const r of wild) assert.equal(r.terrains.filter((t) => t === 'wild').length, 1, r.id);
    assert.deepEqual(E.TERRAINS, ['ground', 'tunnel', 'bridge']);
    assert.ok(!E.STORAGE_ITEMS.includes('wild'));
    const s = start(2);
    assert.deepEqual(Object.keys(s.players[0].builtTiles).sort(), ['bridge', 'ground', 'tunnel']);
    assert.equal(E.mapSlotTotals().wild, 3);
  });

  check('P14.3/2-wild', 'tiles: each wild slot needs one MORE built tile of any terrain, after the fixed slots: a path of G-G and T-B-W needs 2 Ground, 1 Tunnel, 1 Bridge and a fifth tile of any terrain', () => {
    const cities = ['TDL', 'SPO', 'HEL'];
    const routes = ['SPO-TDL', 'SPO-HEL'];
    const mk = (tiles) => { const s = start(2); setTrains(s, 0, ['TDL', 'MIN']); setStorage(s, 0, tiles); return s; };
    assert.equal(E.isLegalLay(mk({ ground: 2, tunnel: 1, bridge: 1 }), 0, cities, routes), false, 'four tiles: no fifth');
    for (const extra of ['ground', 'tunnel', 'bridge']) {
      const tiles = { ground: 2, tunnel: 1, bridge: 1 };
      tiles[extra] += 1;
      assert.equal(E.isLegalLay(mk(tiles), 0, cities, routes), true, `a fifth tile of ${extra}`);
    }
    assert.equal(E.isLegalLay(mk({ ground: 1, tunnel: 1, bridge: 5 }), 0, cities, routes), false, 'a Ground short, however many spare tiles of another kind');
    assert.equal(E.isLegalLay(mk({ ground: 5, tunnel: 0, bridge: 5 }), 0, cities, routes), false, 'a Tunnel short');
  });

  check('P14.9/1-when', 'the player chooses when ending the lay: nothing of P14.5 (paying, VP, tolls, the train\'s move, the building) happens before the last wild slot has its tile', () => {
    const s = e9();
    const before = JSON.stringify({ tiles: s.players[0].builtTiles, vp: s.players[0].vp });
    endE9(s);
    assert.equal(frame(s), 'wildSlot');
    assert.equal(JSON.stringify({ tiles: s.players[0].builtTiles, vp: s.players[0].vp }), before);
    assert.equal(s.map.routeOwner['BIL-DEN'], null);
    assert.equal(s.map.routeOwner['BIL-BIS'], null);
    assert.equal(s.players[0].railheads[0], 'DEN');
    act(s, { type: 'fillWildSlot', terrain: 'ground' });
    assert.equal(frame(s), 'wildSlot', 'still asking: the second wild slot');
    assert.equal(s.map.routeOwner['BIL-DEN'], null, 'not resolved after the first answer');
    assert.equal(s.players[0].railheads[0], 'DEN');
    act(s, { type: 'fillWildSlot', terrain: 'bridge' });
    assert.equal(s.map.routeOwner['BIL-DEN'], 0);
    assert.equal(s.players[0].railheads[0], 'BIS');
  });

  check('P14.9/1-travelled', 'wild slots on routes the path only travels over are already filled and are not asked about', () => {
    const s = e9({ tunnel: 2, bridge: 1, ground: 1 });
    layRoutes(s, ['BIL-DEN'], 1);
    chooseLay(s);
    act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'BIL-DEN' });
    act(s, { type: 'extendPath', route: 'BIL-BIS' });
    const top = E.topFrame(s);
    if (top.kind === 'lay') act(s, { type: 'endLay' });
    assert.equal(frame(s), 'wildSlot');
    assert.equal(E.topFrame(s).route, 'BIL-BIS');
    assert.equal(E.topFrame(s).remaining, 0);
  });

  check('P14.9/2-legality', 'extendPath is offered only if some finished lay from it can pay its fixed slots by terrain and have enough tiles left for the wild slots; the block reason says so', () => {
    const s = start(2);
    setTrains(s, 0, ['HEL', 'MIN']);
    setStorage(s, 0, { tunnel: 1, bridge: 1 });
    chooseLay(s);
    if (E.topFrame(s).path === null) act(s, { type: 'startLay', train: 0 });
    // Helena - Spokane (T B W) needs a third tile; Helena - Denver (T) is affordable.
    assert.equal(offered(s, { type: 'extendPath', route: 'SPO-HEL' }), false);
    assert.match(E.getBlockReason(s, { type: 'extendPath', route: 'SPO-HEL' }), /also needs 1 more built tile of any type for a wild slot/);
    assert.ok(offered(s, { type: 'extendPath', route: 'HEL-DEN' }));
    // Two wild routes together need two spare tiles, not one.
    const t = e9({ tunnel: 3, bridge: 1, ground: 0 });
    assert.equal(E.isLegalLay(t, 0, ['DEN', 'BIL', 'BIS'], ['BIL-DEN', 'BIL-BIS']), false, 'fixed T + B T = 2 Tunnel 1 Bridge; one spare Tunnel for two wild slots');
    const u = e9({ tunnel: 3, bridge: 1, ground: 1 });
    assert.equal(E.isLegalLay(u, 0, ['DEN', 'BIL', 'BIS'], ['BIL-DEN', 'BIL-BIS']), true);
  });

  check('P14.9/3-frame', 'the decision: endLay pushes one wildSlot frame per wild slot, in the order the train passes them; fillWildSlot is offered for each terrain with a spare tile; there is no stop action', () => {
    const s = e9();
    endE9(s);
    assert.equal(s.stack.filter((f) => f.kind === 'wildSlot').length, 2);
    let top = E.topFrame(s);
    assert.deepEqual({ route: top.route, slot: top.slot, remaining: top.remaining, cause: top.cause, player: top.player }, { route: 'BIL-DEN', slot: 1, remaining: 1, cause: 'lay', player: 0 });
    assert.deepEqual(offers(s, 'fillWildSlot').map((a) => a.terrain).sort(), ['bridge', 'ground', 'tunnel']);
    assert.ok(types(s).every((t) => t === 'fillWildSlot'), 'nothing else, no stop');
    refused(s, { type: 'endLay' });
    refused(s, { type: 'extendPath', route: 'BIL-BIS' });
    refused(s, { type: 'stopLaying' });
    act(s, { type: 'fillWildSlot', terrain: 'ground' });
    top = E.topFrame(s);
    assert.deepEqual({ route: top.route, slot: top.slot, remaining: top.remaining }, { route: 'BIL-BIS', slot: 0, remaining: 0 });
    assert.deepEqual(offers(s, 'fillWildSlot').map((a) => a.terrain).sort(), ['bridge', 'tunnel'], 'the only Ground is spent');
    refused(s, { type: 'fillWildSlot', terrain: 'ground' }, /no spare built Ground tile/);
    refused(s, { type: 'fillWildSlot', terrain: 'wild' });
  });

  check('P14.9/3-order', 'the order follows the train, route by route, and within a route in the direction of travel: the slot is counted from the route\'s first city', () => {
    const s = e9();
    setTrains(s, 0, ['BIS', 'MIN']);
    layRoutes(s, ['GFA-BIS', 'GFA-BIL'], 1);
    chooseLay(s);
    act(s, { type: 'startLay', train: 0 });
    act(s, { type: 'extendPath', route: 'BIL-BIS' });
    act(s, { type: 'extendPath', route: 'BIL-DEN' });
    const top = E.topFrame(s);
    if (top.kind === 'lay') act(s, { type: 'endLay' });
    assert.deepEqual([E.topFrame(s).route, E.topFrame(s).slot, E.topFrame(s).remaining], ['BIL-BIS', 0, 1]);
    act(s, { type: 'fillWildSlot', terrain: 'tunnel' });
    assert.deepEqual([E.topFrame(s).route, E.topFrame(s).slot, E.topFrame(s).remaining], ['BIL-DEN', 1, 0]);
  });

  check('P14.9/4-auto', 'a wildSlot decision with exactly one legal terrain is applied by the engine itself (auto), so the choice reaches the player only when two or more kinds are spare', () => {
    const s = e9({ tunnel: 2, bridge: 1, ground: 3 });
    const events = endE9(s);
    const fills = events.filter((e) => e.type === 'action' && e.action.type === 'fillWildSlot');
    assert.deepEqual(fills.map((e) => [e.auto, e.action.terrain]), [[true, 'ground'], [true, 'ground']]);
    assert.notEqual(frame(s), 'wildSlot');
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
    // Exactly enough tiles and no choice at all: every wild slot is forced.
    const t = e9({ tunnel: 2, bridge: 1, ground: 2 });
    const ev = endE9(t);
    assert.equal(ev.filter((e) => e.type === 'action' && e.action.type === 'fillWildSlot' && e.auto).length, 2);
  });

  check('P14.9/5-record', 'what is recorded: map.wildFill, the routeLaid cost (tiles actually paid, wild fills included) and wild list, the lay summary wild; each fill is its own action event, before the lay\'s events', () => {
    const s = e9();
    endE9(s);
    act(s, { type: 'fillWildSlot', terrain: 'tunnel' });
    const ev = act(s, { type: 'fillWildSlot', terrain: 'bridge' });
    assert.deepEqual(s.map.wildFill, { 'BIL-DEN': [{ slot: 1, terrain: 'tunnel' }], 'BIL-BIS': [{ slot: 0, terrain: 'bridge' }] });
    const den = ev.find((e) => e.type === 'routeLaid' && e.route === 'BIL-DEN');
    const bis = ev.find((e) => e.type === 'routeLaid' && e.route === 'BIL-BIS');
    assert.deepEqual(den.cost, { ground: 0, tunnel: 2, bridge: 0 });
    assert.deepEqual(bis.cost, { ground: 0, tunnel: 1, bridge: 2 });
    assert.deepEqual(den.wild, [{ slot: 1, terrain: 'tunnel' }]);
    assert.deepEqual(bis.wild, [{ slot: 0, terrain: 'bridge' }]);
    assert.deepEqual(ev.find((e) => e.type === 'lay').wild, [{ route: 'BIL-DEN', slot: 1, terrain: 'tunnel' }, { route: 'BIL-BIS', slot: 0, terrain: 'bridge' }]);
    const iFill = ev.findIndex((e) => e.type === 'action' && e.action.type === 'fillWildSlot');
    assert.ok(iFill >= 0 && iFill < ev.findIndex((e) => e.type === 'routeLaid'));
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 }, '3 Tunnel and 2 Bridge paid (2 Tunnel + 1 Bridge fixed, plus the Tunnel and the Bridge chosen); the Ground is left');
  });

  check('P14.9/6-terrain', 'wildSlotTerrain (P21.1 row 8): both values play the same game in this ruleset, because no rule reads the terrain of a laid slot', () => {
    const outcomes = [];
    for (const value of ['tile-terrain', 'no-terrain']) {
      const s = e9(undefined, { wildSlotTerrain: value });
      endE9(s);
      act(s, { type: 'fillWildSlot', terrain: 'ground' });
      act(s, { type: 'fillWildSlot', terrain: 'bridge' });
      outcomes.push(JSON.stringify({ vp: s.players.map((p) => p.vp), tiles: s.players[0].builtTiles, fills: s.map.wildFill, trains: s.players[0].railheads }));
    }
    assert.equal(outcomes[0], outcomes[1]);
  });

  check('P14.7/2-wild', 'a wild slot scores like any slot: 2 VP into an unconnected city, 1 VP otherwise, whatever tile fills it (E9: 2 x 2 + 3 x 2 = 10)', () => {
    for (const first of ['ground', 'tunnel', 'bridge']) {
      const s = e9();
      endE9(s);
      act(s, { type: 'fillWildSlot', terrain: first });
      if (frame(s) === 'wildSlot') act(s, { type: 'fillWildSlot', terrain: E.getValidActions(s)[0].terrain });
      assert.equal(vp(s, 0, 'track'), 10, first);
    }
    const t = e9();
    build(t, 'telegraphStation', 'BIS', 1);
    endE9(t);
    act(t, { type: 'fillWildSlot', terrain: 'ground' });
    act(t, { type: 'fillWildSlot', terrain: 'bridge' });
    assert.equal(vp(t, 0, 'track'), 5 * 1, 'Bismarck has a building: 5 slots x 1 VP, wild ones included');
    assert.equal(vp(t, 1, 'toll'), 3);
  });

  check('P19.2/wild', 'the completion VP are 3 per slot of the completing lay, a wild slot included (6 slots x 3 = 18)', () => {
    const s = start(3);
    layRoutes(s, ['SEA-YAK', 'YAK-SPO', 'SPO-GFA', 'GFA-BIL'], 2);
    setTrains(s, 0, ['BIL', 'LAX']);
    setStorage(s, 0, { ground: 3, bridge: 2, tunnel: 1 });
    layNow(s, ['BIL-BIS', 'FAR-BIS', 'FAR-MIN']);
    assert.equal(vp(s, 0, 'completion'), 18);
    assert.equal(s.completion.slots, 6);
    assert.equal(vp(s, 0, 'track'), 0);
  });

  check('P14.9/save', 'a game saved while a wild slot is waiting loads into the same decision and goes on', () => {
    const s = e9();
    endE9(s);
    act(s, { type: 'fillWildSlot', terrain: 'ground' });
    const loaded = E.deserialiseState(E.serialiseState(s));
    assert.equal(E.hashState(loaded), E.hashState(s));
    assert.equal(frame(loaded), 'wildSlot');
    assert.deepEqual(offers(loaded, 'fillWildSlot').map((a) => a.terrain).sort(), ['bridge', 'tunnel']);
    act(loaded, { type: 'fillWildSlot', terrain: 'tunnel' });
    assert.equal(loaded.map.routeOwner['BIL-BIS'], 0);
    assert.equal(loaded.players[0].railheads[0], 'BIS');
  });

  check('E9', 'Wild slots in a lay: Denver - Billings - Bismarck with 3 Tunnel, 2 Bridge, 1 Ground: asked Ground then Bridge, pays 2 Tunnel, 1 Bridge, the Ground and the Bridge, keeps 1 Tunnel, 10 VP', () => {
    const s = e9();
    endE9(s);
    assert.equal(frame(s), 'wildSlot');
    assert.deepEqual([E.topFrame(s).route, E.topFrame(s).slot, E.topFrame(s).remaining], ['BIL-DEN', 1, 1]);
    assert.deepEqual(offers(s, 'fillWildSlot').map((a) => a.terrain).sort(), ['bridge', 'ground', 'tunnel']);
    act(s, { type: 'fillWildSlot', terrain: 'ground' });
    assert.deepEqual([E.topFrame(s).route, E.topFrame(s).slot, E.topFrame(s).remaining], ['BIL-BIS', 0, 0]);
    assert.deepEqual(offers(s, 'fillWildSlot').map((a) => a.terrain).sort(), ['bridge', 'tunnel']);
    act(s, { type: 'fillWildSlot', terrain: 'bridge' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 1, bridge: 0 });
    assert.equal(vp(s, 0, 'track'), 10);
    assert.equal(s.players[0].railheads[0], 'BIS');
    assert.equal(frame(s), 'placeBuildings', 'and the arrival building (P14.6) follows');
    // Had he held 2 Tunnel, 1 Bridge and 3 Ground, his only spare kind would be Ground: nothing asked.
    const t = e9({ tunnel: 2, bridge: 1, ground: 3 });
    endE9(t);
    assert.equal(frame(t), 'placeBuildings');
    assert.deepEqual(t.map.wildFill, { 'BIL-DEN': [{ slot: 1, terrain: 'ground' }], 'BIL-BIS': [{ slot: 0, terrain: 'ground' }] });
    void has;
    void doLay;
  });
}
