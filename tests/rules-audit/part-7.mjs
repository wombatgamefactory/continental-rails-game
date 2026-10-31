// Rules audit, part 7: the wild slot (R1.25, R11.4.3, R11.9, R11.10, R11.12, R16.8, R17.3, R19.2, R21.3 row 26).
// Written from rules spec v9 (route map v3, 31/10/2026). The three wild slots are on Spokane-Helena (T B W),
// Billings-Denver (T W) and Billings-Bismarck (W B T). A wild slot takes one built tile of any terrain; the
// player who lays the route chooses it, before anything else of the claim happens, and only when more than one
// terrain could go there (otherwise the engine fills it).

import {
  MAP, RULES, cloneState, hashState, serialiseState, deserialiseState, describeDecision, describeAction, canAffordRoute,
  routeShortfall, formatRouteCost, getBlockReason, getStructuralBlockReason, metricValue, ownedSlots, getVariantDef, resolveVariants,
} from '../../src/engine/index.js';
import {
  assert, check, game, act, put, give, setHeads, claim, placeAndChoose, eventOf, vpBySource,
  offered, refused, kind, getValidActions, topFrame, finishTurn,
} from './kit.mjs';

const sorted = (a) => a.slice().sort();

/** Seat 1 with railheads on `west` and `east`, holding exactly `tiles` (and room for them). */
function holdGame(west, east, tiles, variants = {}, players = 2) {
  const s = game(players, variants);
  setHeads(s, 0, west, east);
  s.players[0].train.storageCarriages = 3;
  give(s, 0, { resources: {}, tiles: { ground: 0, tunnel: 0, bridge: 0, ...tiles } });
  return s;
}

/** Takes the Lay Tracks / Move Train action with M = 1 + `extra`. */
function lay(s, extra = 0) {
  const pid = s.turn.player;
  const spare = ['W6', 'W7', 'W9'];
  for (let i = 0; i < extra; i++) put(s, pid, spare[i]);
  return placeAndChoose(s, 'W4', 'D5');
}

const SPO_HEL = { type: 'claimRoute', route: 'SPO-HEL', from: 'SPO' };

export default function part7() {
  check('R1.25/data', 'three wild slots, one each on Spokane-Helena, Billings-Denver and Billings-Bismarck; the letter is W and wild is no tile type', () => {
    const wild = MAP.routes.filter((r) => r.wild > 0);
    assert.deepEqual(wild.map((r) => r.id), ['SPO-HEL', 'BIL-DEN', 'BIL-BIS']);
    assert.deepEqual(wild.map((r) => r.terrains.join(' ')), ['tunnel bridge wild', 'tunnel wild', 'wild bridge tunnel']);
    assert.deepEqual(wild.map((r) => r.wildSlots), [[2], [1], [0]], 'the index of the wild slot, counted from the first city');
    assert.equal(RULES.TERRAIN_BY_LETTER.W, 'wild');
    assert.ok(!RULES.TERRAINS.includes('wild') && !RULES.STORAGE_ITEMS.includes('wild'));
    for (const r of MAP.routes) assert.ok(!('wild' in r.cost), 'cost has only the three tile types');
    assert.deepEqual(MAP.routeById['SPO-HEL'].cost, { ground: 0, tunnel: 1, bridge: 1 });
    assert.equal(MAP.routeById['SPO-HEL'].length, 3, 'a wild slot is a slot');
    assert.equal(RULES.NAMES.wild, 'any tile');
  });
  check('R1.25/not-a-tile', 'there are no wild tiles: wild is refused as a tile, a scoring card and a variant value', () => {
    const s = game(2);
    assert.throws(() => game(2, { scoringCard: 'wild' }));
    assert.notEqual(getBlockReason(s, { type: 'chooseBuiltTile', terrain: 'wild' }), null);
    assert.notEqual(getBlockReason(s, { type: 'fillWildSlot', terrain: 'wild' }), null);
    assert.match(getBlockReason(s, { type: 'fillWildSlot', terrain: 'wild' }), /Ground, Tunnel or Bridge/);
    assert.throws(() => game(2, { wildSlotTerrain: 'wild' }));
  });
  check('R21.3/26', 'variant wildSlotTerrain: tile-terrain (default) or no-terrain, nothing else', () => {
    const def = getVariantDef('wildSlotTerrain');
    assert.deepEqual(def.values, ['tile-terrain', 'no-terrain']);
    assert.equal(def.default, 'tile-terrain');
    assert.equal(resolveVariants({}).wildSlotTerrain, 'tile-terrain');
    assert.equal(resolveVariants({ wildSlotTerrain: 'no-terrain' }).wildSlotTerrain, 'no-terrain');
    assert.throws(() => resolveVariants({ wildSlotTerrain: 'any' }));
  });

  // ----- R11.4.3 / R11.12.2: can the route be paid? ---------------------------
  check('R11.4.3/wild', 'a route with a wild slot needs its fixed tiles and one more tile of any type; part payment is not allowed', () => {
    const poor = holdGame('SPO', 'MIN', { tunnel: 1, bridge: 1 });
    lay(poor);
    assert.ok(!offered(poor, 'claimRoute', { route: 'SPO-HEL' }), '1 Tunnel + 1 Bridge pay only the printed slots');
    refused(poor, SPO_HEL);
    for (const tiles of [{ tunnel: 2, bridge: 1 }, { tunnel: 1, bridge: 2 }, { tunnel: 1, bridge: 1, ground: 1 }]) {
      const rich = holdGame('SPO', 'MIN', tiles);
      lay(rich);
      assert.ok(offered(rich, 'claimRoute', { route: 'SPO-HEL', from: 'SPO' }), JSON.stringify(tiles));
    }
    // The fixed slots come first: 3 Ground and nothing else cannot pay the Tunnel and the Bridge.
    const wrong = holdGame('SPO', 'MIN', { ground: 3 });
    lay(wrong);
    assert.ok(!offered(wrong, 'claimRoute', { route: 'SPO-HEL' }));
  });
  check('R11.12.2/formula', 'the test is: each terrain covers its fixed slots and the tiles left over, over all three terrains, cover the wild slots', () => {
    const route = MAP.routeById['BIL-DEN']; // T W
    for (let g = 0; g <= 2; g++) {
      for (let t = 0; t <= 2; t++) {
        for (let b = 0; b <= 2; b++) {
          const p = { builtTiles: { ground: g, tunnel: t, bridge: b } };
          const want = t >= 1 && g + (t - 1) + b >= 1;
          assert.equal(canAffordRoute(p, route), want, `${g}/${t}/${b}`);
          const s = holdGame('BIL', 'MIN', { ground: g, tunnel: t, bridge: b });
          assert.equal(getStructuralBlockReason(s, { type: 'claimRoute', route: 'BIL-DEN', from: 'BIL' }) === null, want, `legal ${g}/${t}/${b}`);
        }
      }
    }
  });
  check('R11.12.2/reason', 'the block reason says how many more tiles of any type the wild slot needs', () => {
    const s = holdGame('SPO', 'MIN', { tunnel: 1, bridge: 1 });
    assert.equal(getStructuralBlockReason(s, SPO_HEL), 'Spokane - Helena also needs 1 more built tile of any type for its wild slot.');
    const none = holdGame('SPO', 'MIN', { bridge: 1 });
    assert.match(getStructuralBlockReason(none, SPO_HEL), /needs 1 Tunnel \+ 1 Bridge \+ 1 any tile in built tiles, and you hold 0 of the 1 built Tunnel/);
    assert.equal(formatRouteCost(none, MAP.routeById['SPO-HEL']), '1 Tunnel + 1 Bridge + 1 any tile');
    assert.deepEqual(routeShortfall({ builtTiles: { ground: 0, tunnel: 1, bridge: 1 } }, MAP.routeById['SPO-HEL']), { terrain: 'wild', need: 1, have: 0 });
  });

  // ----- R11.12.3 to R11.12.5: the decision ------------------------------------
  check('R11.12.4/forced', 'with a spare tile of only one terrain the engine fills the wild slot itself, as an automatic action', () => {
    const s = holdGame('SPO', 'MIN', { tunnel: 2, bridge: 1 });
    lay(s);
    const ev = act(s, SPO_HEL);
    assert.notEqual(kind(s), 'wildSlot', 'the slot was filled, no question is left');
    const fills = ev.filter((e) => e.type === 'action' && e.action.type === 'fillWildSlot');
    assert.equal(fills.length, 1);
    assert.equal(fills[0].auto, true);
    assert.deepEqual(fills[0].action, { type: 'fillWildSlot', terrain: 'tunnel' });
    assert.deepEqual(s.map.wildFill['SPO-HEL'], [{ slot: 2, terrain: 'tunnel' }]);
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
    assert.equal(s.map.routeOwner['SPO-HEL'], 0);
  });
  check('R11.12.3/frame', 'with spare tiles of two or more terrains the claim pushes a wildSlot frame offering one fillWildSlot per such terrain, and nothing of the claim happens yet', () => {
    const s = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 });
    lay(s);
    const before = { vp: { ...s.players[0].vp }, heads: [...s.players[0].railheads], tiles: { ...s.players[0].builtTiles } };
    act(s, SPO_HEL);
    const top = topFrame(s);
    assert.equal(top.kind, 'wildSlot');
    assert.equal(top.player, 0);
    assert.equal(top.route, 'SPO-HEL');
    assert.equal(top.slot, 2);
    assert.equal(top.from, 'SPO');
    assert.equal(top.cause, 'claim');
    assert.deepEqual(sorted(getValidActions(s).map((a) => `${a.type}:${a.terrain}`)), ['fillWildSlot:ground', 'fillWildSlot:tunnel'], 'no Bridge: the one Bridge tile is needed for the printed slot');
    assert.equal(s.map.routeOwner['SPO-HEL'], null, 'not laid yet');
    assert.deepEqual(s.players[0].builtTiles, before.tiles, 'no tile has moved');
    assert.deepEqual(s.players[0].vp, before.vp, 'no VP yet');
    assert.deepEqual(s.players[0].railheads, before.heads, 'the train has not moved');
    assert.equal(describeDecision(s).kind, 'wildSlot');
    assert.match(describeDecision(s).prompt, /Anna: choose which built tile fills the wild slot of Spokane - Helena/);
    assert.equal(describeAction(s, { type: 'fillWildSlot', terrain: 'ground' }), 'Fill the wild slot of Spokane - Helena with a built Ground tile');
    refused(s, { type: 'stopLaying' });
    refused(s, SPO_HEL);
    refused(s, { type: 'fillWildSlot', terrain: 'bridge' });
  });
  check('R11.12.5/resolve', 'after the choice the claim resolves in full: tiles paid, wildFill recorded, track VP, the train advances, routeClaimed says what was paid', () => {
    const s = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 });
    lay(s);
    const ev = [...act(s, SPO_HEL)];
    ev.push(...act(s, { type: 'fillWildSlot', terrain: 'ground' }));
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 1, bridge: 0 });
    assert.deepEqual(s.map.wildFill, { 'SPO-HEL': [{ slot: 2, terrain: 'ground' }] });
    assert.equal(s.map.routeOwner['SPO-HEL'], 0);
    assert.equal(s.players[0].railheads[0], 'HEL');
    const claimed = eventOf(ev, 'routeClaimed');
    assert.deepEqual(claimed.cost, { ground: 1, tunnel: 1, bridge: 1 }, 'the tiles actually paid, the wild fill included');
    assert.deepEqual(claimed.wild, [{ slot: 2, terrain: 'ground' }]);
    assert.equal(claimed.slots, 3);
    assert.deepEqual(vpBySource(ev, 0), { track: 3, firstConnection: 5 });
    // The order of events: the claim, the fill, then everything the claim does.
    const order = ev.filter((e) => e.type === 'action' || e.type === 'routeClaimed').map((e) => (e.type === 'action' ? e.action.type : e.type));
    assert.deepEqual(order, ['claimRoute', 'fillWildSlot', 'routeClaimed']);
  });
  check('R11.12.5/plain', 'a route without a wild slot has an empty wild list and no wildFill entry', () => {
    const s = holdGame('POR', 'MIN', { bridge: 1 });
    const ev = lay(s);
    const claimed = eventOf(ev, 'routeClaimed') ?? eventOf(act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' }), 'routeClaimed');
    assert.deepEqual(claimed.cost, { ground: 0, tunnel: 0, bridge: 1 });
    assert.deepEqual(claimed.wild, []);
    assert.deepEqual(s.map.wildFill, {});
  });
  check('R11.12.1/step', 'the step is spent when the claim is chosen: a later answer does not use another, and with M = 1 the action ends after the building', () => {
    const s = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 });
    lay(s);
    act(s, SPO_HEL);
    act(s, { type: 'fillWildSlot', terrain: 'tunnel' });
    if (kind(s) === 'placeBuildings') act(s, { type: 'skipBuilding' });
    assert.equal(s.turn.player, 1, 'one step with M = 1');
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
  });
  check('R11.12.1/everywhere', 'every kind of claim goes through the same question: per-railhead claims and network mode', () => {
    const rh = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 }, { layTrackClaims: 'per-railhead' });
    lay(rh);
    act(rh, SPO_HEL);
    assert.equal(kind(rh), 'wildSlot');
    act(rh, { type: 'fillWildSlot', terrain: 'ground' });
    assert.equal(rh.map.routeOwner['SPO-HEL'], 0);
    const net = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 }, { claimFrom: 'network' });
    lay(net);
    act(net, SPO_HEL);
    assert.equal(kind(net), 'wildSlot');
    act(net, { type: 'fillWildSlot', terrain: 'tunnel' });
    assert.equal(net.map.routeOwner['SPO-HEL'], 0);
    assert.deepEqual(net.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
  });
  check('R11.12.3/refuse', 'a fill is refused when no tile of that terrain is spare, or when no wild slot is being asked about', () => {
    const s = holdGame('SPO', 'MIN', { ground: 0, tunnel: 2, bridge: 2 });
    lay(s);
    act(s, SPO_HEL);
    // Spare: 1 Tunnel and 1 Bridge (Ground none): a real choice.
    assert.equal(kind(s), 'wildSlot');
    refused(s, { type: 'fillWildSlot', terrain: 'ground' });
    assert.match(getBlockReason(s, { type: 'fillWildSlot', terrain: 'ground' }), /no built Ground tile to spare for the wild slot of Spokane - Helena/);
    const idle = game(2);
    assert.match(getBlockReason(idle, { type: 'fillWildSlot', terrain: 'ground' }), /not being asked which tile fills a wild slot/);
  });
  check('R11.12.5/saved', 'a game saved while the wild slot is being asked loads, goes on and ends in the same state as the one that was not saved', () => {
    const s = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 });
    lay(s);
    act(s, SPO_HEL);
    assert.equal(kind(s), 'wildSlot');
    const loaded = deserialiseState(serialiseState(s));
    const copy = cloneState(s);
    assert.equal(hashState(loaded), hashState(s));
    assert.equal(hashState(copy), hashState(s));
    for (const t of [s, loaded, copy]) {
      act(t, { type: 'fillWildSlot', terrain: 'tunnel' });
      finishTurn(t);
    }
    assert.equal(hashState(loaded), hashState(s));
    assert.equal(hashState(copy), hashState(s));
    assert.deepEqual(loaded.map.wildFill, { 'SPO-HEL': [{ slot: 2, terrain: 'tunnel' }] });
  });

  // ----- R11.9, R11.10, R16.8, R17.3: what a filled wild slot counts as ------------
  check('R11.9/wild', 'scoring card: a wild slot scores 3 VP if its tile is of the card\'s terrain, else 1; under no-terrain always 1', () => {
    const track = (tile, variants) => {
      const s = holdGame('SPO', 'MIN', { tunnel: 2, bridge: 2, ground: 1 }, { scoringCard: 'tunnel', ...variants });
      lay(s);
      const ev = [...act(s, SPO_HEL)];
      ev.push(...act(s, { type: 'fillWildSlot', terrain: tile }));
      return vpBySource(ev, 0).track;
    };
    assert.equal(track('tunnel', {}), 3 + 1 + 3, 'Tunnel card, Tunnel tile on the wild slot: 7');
    assert.equal(track('ground', {}), 3 + 1 + 1, 'a Ground tile: 5');
    assert.equal(track('bridge', {}), 3 + 1 + 1);
    assert.equal(track('tunnel', { wildSlotTerrain: 'no-terrain' }), 5, 'no-terrain: the base 1 VP');
    assert.equal(track('ground', { wildSlotTerrain: 'no-terrain' }), 5);
  });
  check('R16.8/wild', 'milestone totals: a wild slot counts for its tile\'s terrain (tile-terrain) or for none (no-terrain), and always as a slot', () => {
    const lay1 = (variants) => {
      const s = holdGame('SPO', 'MIN', { ground: 1, tunnel: 2, bridge: 1 }, variants);
      lay(s);
      act(s, SPO_HEL);
      act(s, { type: 'fillWildSlot', terrain: 'tunnel' });
      return s;
    };
    const a = lay1({});
    assert.equal(metricValue(a, 0, 'ownSlots', { terrain: 'tunnel' }), 2);
    assert.equal(metricValue(a, 0, 'ownSlots', { terrain: 'bridge' }), 1);
    assert.equal(metricValue(a, 0, 'ownSlots', { terrain: 'ground' }), 0);
    assert.equal(metricValue(a, 0, 'ownSlots'), 3);
    assert.equal(metricValue(a, 0, 'longestOwnRoute'), 3);
    const b = lay1({ wildSlotTerrain: 'no-terrain' });
    assert.equal(metricValue(b, 0, 'ownSlots', { terrain: 'tunnel' }), 1);
    assert.equal(metricValue(b, 0, 'ownSlots'), 3, 'still a slot');
    assert.equal(ownedSlots(b, 0), 3, 'tie-break 2 counts it as one slot under either value');
    assert.equal(ownedSlots(a, 0), 3);
  });
  check('R17.3/5-wild', 'card 5: the terrain of a wild slot\'s tile is one of the terrains laid; under no-terrain it adds none', () => {
    const run = (variants) => {
      const s = holdGame('BIL', 'MIN', { tunnel: 2, bridge: 1 }, { moduleLegislativeAgenda: true, legislativeAgendaCard: 5, ...variants });
      lay(s);
      const ev = [...act(s, { type: 'claimRoute', route: 'BIL-DEN', from: 'BIL' })];
      ev.push(...act(s, { type: 'fillWildSlot', terrain: 'bridge' }));
      if (kind(s) === 'placeBuildings') ev.push(...act(s, { type: 'skipBuilding' }));
      return vpBySource(ev, 0).legislative ?? 0;
    };
    assert.equal(run({}), 3, 'Tunnel and a Bridge tile: two terrains');
    assert.equal(run({ wildSlotTerrain: 'no-terrain' }), 0, 'only Tunnel counts');
  });
  check('R17.3/6-wild', 'card 6: a wild slot is a slot of the action\'s total under either value', () => {
    for (const variants of [{}, { wildSlotTerrain: 'no-terrain' }]) {
      const s = holdGame('SPO', 'MIN', { ground: 2, tunnel: 4, bridge: 1 }, { moduleLegislativeAgenda: true, legislativeAgendaCard: 6, ...variants });
      lay(s, 1); // M = 2
      const ev = [...act(s, SPO_HEL)];
      ev.push(...act(s, { type: 'fillWildSlot', terrain: 'tunnel' }));
      if (kind(s) === 'placeBuildings') ev.push(...act(s, { type: 'skipBuilding' }));
      ev.push(...act(s, { type: 'claimRoute', route: 'HEL-BOI', from: 'HEL' }));
      if (kind(s) === 'placeBuildings') ev.push(...act(s, { type: 'skipBuilding' }));
      // 3 slots (T B + wild) and 2 slots (T T) = 5 slots in one action.
      assert.equal(vpBySource(ev, 0).legislative, 5, JSON.stringify(variants));
    }
  });
  check('R19.2/wild', 'the completion bonus is 3 VP per slot of the route just laid, a wild slot included: 25 + 3 x 3 = 34', () => {
    const s = holdGame('SPO', 'KCY', { tunnel: 1, bridge: 1, ground: 1 });
    claim(s, 0, 'TDL-POR', 'SPO-TDL', 'HEL-DEN', 'DEN-PUE', 'PUE-DOD', 'DOD-WIC', 'WIC-KCY');
    s.players[0].startCities = ['POR', 'KCY'];
    lay(s);
    const ev = [...act(s, SPO_HEL)];
    if (kind(s) === 'wildSlot') ev.push(...act(s, { type: 'fillWildSlot', terrain: 'ground' }));
    assert.equal(vpBySource(ev, 0).completion, 25 + 3 * 3);
    assert.equal(s.gameEnd.reason, 'transcontinental');
  });

  // ----- the map data the board draws --------------------------------------------
  check('R16.6/computed', 'junction cities and regions are worked out from the data and the constants, not from stored lists', () => {
    const four = MAP.inlandCities.filter((id) => MAP.cityRoutes[id].length >= 4);
    assert.equal(four.length, 21, 'a lower threshold gives a different set from the same data');
    assert.equal(Object.keys(MAP).includes('junctionCities'), false, 'no stored list in the map tables');
    assert.equal(Object.keys(MAP).includes('regions'), false);
    assert.deepEqual(MAP.board, { w: 600, h: 350 });
  });
}
