// Rules audit, part 3: R11 the map and Lay Tracks, R12 Move Train, R13 railway
// stations and telegraph stations, R14 cowboy hats. Written from rules spec v2.

import { MAP, RULES, production, isCityConnected, scoreGame, getDistrictActionBlockReason } from '../../src/engine/index.js';
import {
  assert, check, game, act, take, put, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource,
  offered, offers, refused, idleTurn, idleUntil, finishTurn, playTurn, goTo, kind, keys, giveTokens, stock, ownCard, building,
  getValidActions, topFrame, vpTotal, vpOfEvents,
} from './kit.mjs';

const PONY = { modulePonyExpress: true };
const legislative = (n) => ({ moduleLegislativeAgenda: true, legislativeAgendaCard: n });
const sorted = (a) => a.slice().sort();
const TILES = { ground: 9, tunnel: 9, bridge: 9 };

/** Seat 1 with railheads on `west` and `east`, plenty of built tiles and three storage carriages. */
function layGame(west = 'POR', east = 'MIN', variants = {}, players = 2) {
  const s = game(players, variants);
  setHeads(s, 0, west, east);
  s.players[0].train.storageCarriages = 3;
  give(s, 0, { resources: {}, tiles: TILES });
  return s;
}

/** Takes the Lay Tracks / Move Train action with M = 1 + `extra` (extra workers of seat 1 next to D5). */
function lay(s, extra = 0) {
  const pid = s.turn.player;
  const spare = ['W6', 'W7', 'W9'];
  for (let i = 0; i < extra; i++) put(s, pid, spare[i]);
  return placeAndChoose(s, 'W4', 'D5');
}

/** Applies `action` if it is on offer and adds its events; if the engine already made it (a forced step), does nothing. */
function step(s, events, action) {
  if (getValidActions(s).some((a) => Object.keys(action).every((k) => a[k] === action[k]))) events.push(...act(s, action));
  return events;
}

export default function part3() {
  // ----- R11 -----------------------------------------------------------------
  check('R11.1', 'no two cities are joined by more than one route, no route joins two start cities, every start city has exactly 2 routes', () => {
    const pairs = new Set(MAP.routes.map((r) => sorted([r.a, r.b]).join()));
    assert.equal(pairs.size, 65);
    for (const r of MAP.routes) assert.ok(MAP.cityById[r.a].kind === 'inland' || MAP.cityById[r.b].kind === 'inland', r.id);
    for (const c of MAP.startCities) assert.equal(MAP.cityRoutes[c].length, 2, c);
  });
  check('R11.2.1', 'a start city holds any number of railheads once the game has begun', () => {
    const s = layGame('TDL', 'MIN');
    setHeads(s, 1, 'SEA', 'OMA');
    const ev = lay(s);
    step(s, ev, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' });
    assert.equal(s.players[0].railheads[0], 'SEA');
    assert.equal(s.players[1].railheads[0], 'SEA');
  });
  check('R11.2.2', 'a start city never holds a building', () => {
    const s = layGame('TDL', 'MIN');
    const ev = lay(s);
    step(s, ev, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' });
    assert.notEqual(kind(s), 'placeBuildings', 'no building is offered on arriving in Seattle');
    assert.equal(s.turn.player, 1);
    assert.ok(!('SEA' in s.map.railwayStation) && !('SEA' in s.map.telegraphStation));
  });
  check('R11.2.3', 'a start city never holds a Pony Express token', () => {
    const s = game(2, PONY);
    for (const c of MAP.startCities) assert.ok(!s.modules.pony.tokens[c]);
  });
  check('R11.2.4', 'a start city never gives a first-connection bonus', () => {
    const s = layGame('TDL', 'MIN', PONY);
    const ev = lay(s);
    step(s, ev, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' });
    assert.deepEqual(vpBySource(ev, 0), { track: 3 });
    assert.equal(s.modules.pony.players[0].tokensHeld, 0);
  });
  check('R11.2.5', 'a start city counts as a connected city from the start of the game', () => {
    const s = game(2);
    for (const c of MAP.startCities) assert.equal(isCityConnected(s, c), true);
    for (const c of MAP.inlandCities) assert.equal(isCityConnected(s, c), false);
  });
  check('R11.2.6', 'otherwise a start city is ordinary: anyone may claim into it, move through it or stop on it', () => {
    const s = layGame('TDL', 'MIN');
    setHeads(s, 1, 'SEA', 'OMA');
    claim(s, 1, 'SEA-TDL', 'SEA-YAK'); // Seattle has just these two routes: The Dalles - Seattle - Yakima
    lay(s);
    assert.ok(offered(s, 'moveTrain', { from: 'TDL', to: 'SEA' }), 'stop on another player\'s starting city');
    assert.ok(offered(s, 'moveTrain', { from: 'TDL', to: 'YAK' }), 'move through it');
    act(s, { type: 'moveTrain', from: 'TDL', to: 'YAK' });
    assert.equal(s.players[0].railheads[0], 'YAK');
  });
  check('R11.3', 'the D5 action gives M steps, each a claim or a move; at least one step; the player may stop after any step', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    lay(s, 1); // M = 2
    assert.deepEqual(types(s), ['claimRoute', 'moveTrain'], 'no stop before the first step');
    refused(s, { type: 'stopLaying' });
    act(s, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.equal(kind(s), 'layTracks');
    assert.ok(offered(s, 'stopLaying'), 'may stop after any step');
    assert.ok(offered(s, 'claimRoute', { route: 'TDL-BOI', from: 'TDL' }), 'the moved railhead is in force for the next step');
    act(s, { type: 'stopLaying' });
    assert.equal(s.turn.player, 1);
  });
  check('R11.3/chain', 'steps resolve one after another: a new connection is in force for the next step', () => {
    const s = layGame();
    const ev = lay(s, 1); // M = 2
    step(s, ev, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    step(s, ev, { type: 'skipBuilding' });
    assert.ok(offered(s, 'claimRoute', { route: 'SEA-TDL', from: 'TDL' }));
    act(s, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' });
    assert.equal(s.map.routeOwner['SEA-TDL'], 0);
    assert.equal(s.turn.player, 1, 'two steps with M = 2');
  });
  check('R11.3/one', 'with M = 1 the action is one claim or one move, never both', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    lay(s);
    assert.ok(offered(s, 'claimRoute') && offered(s, 'moveTrain'));
    act(s, { type: 'claimRoute', route: 'POR-REN', from: 'POR' });
    assert.ok(!offered(s, 'moveTrain') && !offered(s, 'claimRoute'));
    if (kind(s) === 'placeBuildings') act(s, { type: 'skipBuilding' });
    assert.equal(s.turn.player, 1);
  });
  check('R11.3/per-railhead', 'layTrackClaims per-railhead: each railhead up to M claims, and separately up to M moves in total', () => {
    const s = layGame('POR', 'MIN', { layTrackClaims: 'per-railhead' });
    lay(s); // M = 1
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    act(s, { type: 'skipBuilding' });
    assert.equal(kind(s), 'layTracks');
    assert.ok(!offered(s, 'claimRoute', { route: 'SEA-TDL', from: 'TDL' }), 'that railhead has used its one claim');
    assert.ok(offered(s, 'claimRoute', { route: 'FAR-MIN', from: 'MIN' }), 'the other railhead still has its claim');
    act(s, { type: 'claimRoute', route: 'FAR-MIN', from: 'MIN' });
    act(s, { type: 'skipBuilding' });
    assert.equal(s.turn.player, 0, 'and one move is still to come');
    assert.deepEqual(sorted([...new Set(types(s))]), ['moveTrain', 'stopLaying']);
    act(s, { type: 'moveTrain', from: 'TDL', to: 'POR' });
    assert.equal(s.turn.player, 1, 'M = 1: one move in total');
  });
  check('R11.3/per-railhead-network', 'layTrackClaims per-railhead in network mode gives 2 x M claims', () => {
    const s = layGame('POR', 'MIN', { layTrackClaims: 'per-railhead', claimFrom: 'network' });
    give(s, 0, { coins: 0, tiles: TILES });
    lay(s);
    for (const route of ['TDL-POR', 'POR-REN']) {
      act(s, { type: 'claimRoute', route, from: 'POR' });
      if (kind(s) === 'placeBuildings') act(s, { type: 'skipBuilding' });
    }
    assert.equal(s.turn.player, 1, 'exactly two claims with M = 1');
    assert.deepEqual([s.map.routeOwner['TDL-POR'], s.map.routeOwner['POR-REN']], [0, 0]);
  });
  check('R11.4.1', 'only an unclaimed route can be claimed', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    lay(s);
    assert.ok(!offered(s, 'claimRoute', { route: 'TDL-POR' }));
    refused(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
  });
  check('R11.4.2', 'one of the player\'s two railheads must stand on an end of the route', () => {
    const s = layGame();
    lay(s);
    assert.deepEqual(sorted(offers(s, 'claimRoute').map((a) => a.route)), sorted(['TDL-POR', 'POR-REN', 'FAR-MIN', 'MIN-SXC']));
    refused(s, { type: 'claimRoute', route: 'SEA-TDL', from: 'SEA' });
    refused(s, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' });
  });
  check('R11.4.3', 'storage must hold a built tile of the right terrain for every slot: no wild tiles, no part payment', () => {
    const s = game(2);
    setHeads(s, 0, 'SPO', 'MIN');
    s.players[0].train.storageCarriages = 3;
    give(s, 0, { resources: { iron: 9, wood: 9 }, tiles: { ground: 1, tunnel: 2, bridge: 9 } });
    lay(s);
    assert.ok(!offered(s, 'claimRoute', { route: 'SPO-GFA' }), 'T-B-T-T needs 3 Tunnel and 1 Bridge: 9 Bridge cannot stand in for the third Tunnel');
    assert.ok(!offered(s, 'claimRoute', { route: 'SPO-TDL' }), 'G-G needs 2 Ground');
    refused(s, { type: 'claimRoute', route: 'SPO-GFA', from: 'SPO' });
    s.players[0].builtTiles.tunnel = 3;
    act(s, { type: 'claimRoute', route: 'SPO-GFA', from: 'SPO' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 8 });
  });
  check('R11.5.1', 'Pay: the built tiles leave storage and the route is owned by the claimer', () => {
    const s = layGame();
    lay(s);
    act(s, { type: 'claimRoute', route: 'POR-REN', from: 'POR' }); // Bridge, Tunnel, Ground
    assert.deepEqual(s.players[0].builtTiles, { ground: 8, tunnel: 8, bridge: 8 });
    assert.equal(s.map.routeOwner['POR-REN'], 0);
  });
  check('R11.5.2', 'Track VP: 1 VP per slot of the route', () => {
    for (const [west, route, slots] of [['POR', 'TDL-POR', 1], ['SEA', 'SEA-TDL', 3], ['SPO', 'SPO-GFA', 4]]) { // the longest routes of the map have 4 slots
      const s = layGame(west, 'MIN');
      lay(s);
      const ev = act(s, { type: 'claimRoute', route, from: west });
      assert.equal(vpBySource(ev, 0).track, slots);
      assert.equal(s.players[0].vp.track, slots);
    }
  });
  check('R11.5.3', 'Advance: the railhead used moves from X to Y', () => {
    const s = layGame();
    lay(s);
    act(s, { type: 'claimRoute', route: 'MIN-SXC', from: 'MIN' });
    assert.deepEqual(s.players[0].railheads, ['POR', 'SXC']);
  });
  check('R11.5.4', 'First connection: 5 VP if Y is an inland city that was not connected before this claim, and only then', () => {
    const s = layGame('POR', 'MIN', {}, 2);
    setHeads(s, 1, 'SEA', 'OMA');
    give(s, 1, { tiles: { ground: 1, tunnel: 1, bridge: 1 } });
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(vpBySource(ev, 0), { track: 1, firstConnection: 5 });
    finishTurn(s);
    const second = placeAndChoose(s, 'W6', 'D5'); // Ben: Seattle - The Dalles
    step(s, second, { type: 'claimRoute', route: 'SEA-TDL', from: 'SEA' });
    assert.deepEqual(vpBySource(second, 1), { track: 3 }, 'The Dalles was already a connected city');
  });
  check('R11.5.4/token', 'with Pony Express the first connection also takes the token from Y', () => {
    const s = layGame('POR', 'MIN', PONY);
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.equal(s.modules.pony.tokens.TDL, false);
    assert.deepEqual(s.modules.pony.players[0], { ...s.modules.pony.players[0], tokensHeld: 1, tokensCollected: 1 });
  });
  check('R11.5.5', 'Toll: if Y holds a railway station owned by another player, that player gains 3 VP', () => {
    const s = layGame();
    building(s, 1, 'railwayStation', 'TDL');
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(vpBySource(ev, 1), { toll: 3 });
    assert.equal(vpBySource(ev, 0).toll, undefined);
    const own = layGame();
    building(own, 0, 'railwayStation', 'TDL');
    lay(own);
    const ev2 = act(own, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.equal(eventsOf(ev2, 'vp').filter((e) => e.source === 'toll').length, 0, 'your own railway station takes no toll');
  });
  check('R11.5/order', 'a claim resolves in order: pay, track VP, advance, first connection, toll, then the optional building', () => {
    const s = layGame();
    s.map.railwayStation.TDL = 1; // a station in a city no route reaches yet (set by hand)
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(eventsOf(ev, 'vp').map((e) => `${e.player}:${e.source}:${e.amount}`), ['0:track:1', '0:firstConnection:5', '1:toll:3']);
    assert.equal(kind(s), 'placeBuildings', 'the building comes after the toll: the claimer cannot dodge it');
    assert.equal(s.players[0].railheads[0], 'TDL');
  });
  check('R11.5.6', 'Transcontinental check: after the toll and before the building', () => {
    // Portland to Minneapolis: TDL-POR, SPO-TDL, SPO-GFA, GFA-BIS, FAR-BIS, FAR-MIN. GFA-BIS (4 slots) closes the line.
    const s = layGame('GFA', 'OMA');
    claim(s, 0, 'TDL-POR', 'SPO-TDL', 'SPO-GFA', 'FAR-BIS', 'FAR-MIN');
    building(s, 1, 'railwayStation', 'BIS');
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'GFA-BIS', from: 'GFA' });
    assert.deepEqual(eventsOf(ev, 'vp').map((e) => `${e.player}:${e.source}:${e.amount}`), ['0:track:4', '1:toll:3', '0:completion:37']);
    assert.equal(kind(s), 'placeBuildings');
    assert.equal(s.gameEnd.reason, 'transcontinental');
  });
  check('R11.5.7', 'Building: the player may place one building in Y for free', () => {
    const s = layGame();
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.equal(kind(s), 'placeBuildings');
    const coins = s.players[0].coins;
    act(s, { type: 'placeTelegraphStation', city: 'TDL' });
    assert.equal(s.players[0].coins, coins);
    assert.equal(s.map.telegraphStation.TDL, 0);
  });
  check('R11.5.8', 'the slots of every claim of the action are added together (used by whole-action bonuses)', () => {
    const s = layGame('POR', 'MIN', legislative(6));
    const ev = lay(s, 1); // M = 2
    ev.push(...act(s, { type: 'claimRoute', route: 'POR-REN', from: 'POR' })); // 3 slots
    ev.push(...act(s, { type: 'skipBuilding' }));
    ev.push(...act(s, { type: 'claimRoute', route: 'BOI-REN', from: 'REN' })); // 2 slots: 5 in the action
    ev.push(...finishTurn(s));
    assert.equal(vpBySource(ev, 0).legislative, 5);
  });
  check('R11.6', 'a route is claimed whole, never changes owner, and nobody else can ever claim it', () => {
    const s = layGame();
    setHeads(s, 1, 'TDL', 'OMA');
    give(s, 1, { tiles: { bridge: 5 } });
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    finishTurn(s);
    placeAndChoose(s, 'W6', 'D5');
    assert.equal(kind(s), 'layTracks');
    assert.ok(!offered(s, 'claimRoute', { route: 'TDL-POR' }));
    refused(s, { type: 'claimRoute', route: 'TDL-POR', from: 'TDL' });
    assert.equal(s.map.routeOwner['TDL-POR'], 0);
  });
  check('R11.7', 'any claim is legal: it need not make a new connection, and the building is optional', () => {
    const s = layGame('TDL', 'MIN');
    claim(s, 1, 'TDL-POR', 'BOI-REN'); // The Dalles and Boise are both connected already
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'TDL-BOI', from: 'TDL' });
    assert.deepEqual(vpBySource(ev, 0), { track: 2 });
    assert.ok(offered(s, 'skipBuilding'));
  });
  check('R11.8', 'a railhead on a city with no unclaimed route cannot claim: it must be moved first', () => {
    const s = layGame('POR', 'MIN');
    claim(s, 1, 'TDL-POR', 'POR-REN');
    lay(s);
    assert.ok(!offers(s, 'claimRoute').some((a) => a.from === 'POR'));
    assert.ok(offered(s, 'moveTrain', { from: 'POR', to: 'TDL' }));
  });
  check('R11.9', 'scoring card: every slot of its terrain scores 3 VP when laid, every other slot the base 1, all booked to track', () => {
    // SPO-GFA is T-B-T-T (3 Tunnel, 1 Bridge); GFA-BIS is G-B-G-B (2 Ground, 2 Bridge).
    const table = [
      ['SPO', 'SPO-GFA', { tunnel: 3 * 3 + 1, ground: 4, bridge: 3 + 3, none: 4 }],
      ['GFA', 'GFA-BIS', { tunnel: 4, ground: 2 * 3 + 2, bridge: 2 * 3 + 2, none: 4 }],
    ];
    for (const [head, route, expected] of table) {
      for (const card of ['tunnel', 'ground', 'bridge', 'none']) {
        const s = layGame(head, 'MIN', { scoringCard: card });
        lay(s);
        const vp = vpBySource(act(s, { type: 'claimRoute', route, from: head }), 0);
        assert.equal(vp.track, expected[card], `${route} with the ${card} card`);
        assert.equal(vp.legislative ?? 0, 0, 'nothing else adds to a slot');
      }
    }
    assert.ok(['ground', 'tunnel', 'bridge'].includes(game(2, { scoringCard: 'random' }).scoringCard));
  });
  check('R11.10', 'whole-action bonuses are checked once, when the action ends, on all its claims together', () => {
    const s = layGame('POR', 'MIN', legislative(6));
    const ev = lay(s, 2); // M = 3
    ev.push(...act(s, { type: 'claimRoute', route: 'POR-REN', from: 'POR' })); // 3 slots
    ev.push(...act(s, { type: 'skipBuilding' }));
    ev.push(...act(s, { type: 'claimRoute', route: 'REN-TON', from: 'REN' })); // 2 slots
    assert.equal(vpBySource(ev, 0).legislative, undefined, 'not yet: the action has not ended');
    ev.push(...act(s, { type: 'skipBuilding' }));
    ev.push(...act(s, { type: 'claimRoute', route: 'TON-PHX', from: 'TON' })); // 3 slots
    ev.push(...finishTurn(s));
    assert.equal(vpBySource(ev, 0).legislative, 5, '8 slots in one action score the bonus once');
    const t = layGame('POR', 'MIN', legislative(6));
    const few = lay(t, 1);
    few.push(...act(t, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' })); // 1 slot
    few.push(...act(t, { type: 'skipBuilding' }));
    few.push(...act(t, { type: 'claimRoute', route: 'SEA-TDL', from: 'TDL' })); // 3 slots
    few.push(...finishTurn(t));
    assert.equal(vpBySource(few, 0).legislative, undefined, '4 slots are not enough');
  });
  const NET = { claimFrom: 'network' };
  check('R11.11.1', 'network mode: railheads never move', () => {
    const s = layGame('POR', 'MIN', NET);
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(s.players[0].railheads, ['POR', 'MIN']);
  });
  check('R11.11.2', 'network mode: the network is the two starting cities plus every end of a route the player owns', () => {
    const s = layGame('POR', 'MIN', NET);
    claim(s, 0, 'TDL-POR');
    claim(s, 1, 'POR-REN');
    lay(s);
    const from = new Set(offers(s, 'claimRoute').map((a) => a.from));
    assert.deepEqual(sorted([...from]), ['MIN', 'TDL'], 'The Dalles is in the network; Reno (an opponent route) is not; Portland has no unclaimed route left');
  });
  check('R11.11.3', 'network mode: a claim needs the route unclaimed, an end in the network, and the tiles', () => {
    const s = layGame('POR', 'MIN', NET);
    lay(s);
    assert.deepEqual(sorted(offers(s, 'claimRoute').map((a) => a.route)), sorted(['TDL-POR', 'POR-REN', 'FAR-MIN', 'MIN-SXC']));
    refused(s, { type: 'claimRoute', route: 'SEA-TDL', from: 'SEA' });
    const t = layGame('POR', 'MIN', NET);
    give(t, 0, { tiles: { bridge: 1 } });
    lay(t);
    assert.equal(t.map.routeOwner['TDL-POR'], 0, 'the only route the tiles pay for');
  });
  check('R11.11.4', 'network mode: the arrival city is the end that was not in the network; with both ends in it there is no arrival, first connection, toll or building', () => {
    const s = layGame('POR', 'MIN', NET);
    building(s, 1, 'railwayStation', 'REN');
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'POR-REN', from: 'POR' });
    assert.deepEqual(vpBySource(ev, 0), { track: 3, firstConnection: 5 });
    assert.deepEqual(vpBySource(ev, 1), { toll: 3 }, 'arriving in Reno pays the toll (R11.5.5)');
    assert.equal(kind(s), 'placeBuildings');
    const t = layGame('POR', 'MIN', NET);
    claim(t, 0, 'TDL-POR', 'POR-REN', 'BOI-REN'); // The Dalles, Portland, Reno and Boise are all in the network
    t.map.railwayStation.TDL = 1;
    t.map.railwayStation.BOI = 1;
    give(t, 0, { coins: 0, tiles: TILES });
    lay(t);
    const ev2 = act(t, { type: 'claimRoute', route: 'TDL-BOI', from: getValidActions(t).find((a) => a.route === 'TDL-BOI').from });
    assert.deepEqual(vpBySource(ev2, 0), { track: 2 });
    assert.deepEqual(vpBySource(ev2, 1), {});
    assert.notEqual(kind(t), 'placeBuildings');
  });
  check('R11.11.5', 'network mode: no Move Train; a step may be a station step: 2 Coins for one building in an inland city of the network', () => {
    const s = layGame('POR', 'MIN', NET);
    claim(s, 0, 'TDL-POR');
    claim(s, 1, 'POR-REN');
    give(s, 0, { coins: 2, tiles: TILES });
    lay(s);
    assert.ok(!offered(s, 'moveTrain'));
    refused(s, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.ok(offered(s, 'placeTelegraphStation', { city: 'TDL' }));
    assert.ok(!offered(s, 'placeTelegraphStation', { city: 'REN' }), 'Reno is not in the network');
    refused(s, { type: 'placeTelegraphStation', city: 'REN' });
    act(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'coins' });
    assert.equal(s.players[0].coins, 0);
    assert.equal(s.map.railwayStation.TDL, 0);
    assert.equal(s.turn.player, 1, 'the station step was the one step of the action');
    const poor = layGame('POR', 'MIN', NET);
    claim(poor, 0, 'TDL-POR');
    give(poor, 0, { coins: 1, tiles: TILES });
    lay(poor);
    assert.ok(!offered(poor, 'placeTelegraphStation'));
  });
  check('R11.11.6', 'network mode: Pony Express cards 3 and 14 are removed from their decks', () => {
    const s = game(2, { ...NET, ...PONY });
    const pony = s.modules.pony;
    const all = ['A', 'B', 'C'].flatMap((r) => [...pony.market[r], ...pony.decks[r]]);
    assert.equal(all.length, 36);
    assert.ok(!all.includes('PX3') && !all.includes('PX14'));
  });

  // ----- R12 -----------------------------------------------------------------
  check('R12.1', 'Move Train is a step of the D5 action when claimFrom is railhead', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    lay(s);
    assert.ok(offered(s, 'moveTrain', { from: 'POR', to: 'TDL' }));
  });
  check('R12.2', 'a legal move: any city joined to the railhead by a chain of claimed routes of any owners, at any distance', () => {
    const s = layGame('POR', 'MIN', {}, 3);
    claim(s, 1, 'TDL-POR', 'SPO-TDL');
    claim(s, 2, 'SPO-BOI', 'BOI-SLC');
    claim(s, 0, 'SLC-TON');
    lay(s);
    assert.deepEqual(sorted(offers(s, 'moveTrain').filter((a) => a.from === 'POR').map((a) => a.to)), sorted(['TDL', 'SPO', 'BOI', 'SLC', 'TON']));
    refused(s, { type: 'moveTrain', from: 'POR', to: 'POR' });
    refused(s, { type: 'moveTrain', from: 'POR', to: 'REN' });
    act(s, { type: 'moveTrain', from: 'POR', to: 'TON' });
    assert.equal(s.players[0].railheads[0], 'TON');
  });
  check('R12.3.1/tolls', 'the path enters the fewest cities holding another player\'s railway station, even if it is longer', () => {
    const s = layGame('SPO', 'MIN', {}, 3);
    claim(s, 1, 'SPO-BOI', 'BOI-SLC'); // Spokane - Boise - Salt Lake City: 2 routes
    claim(s, 2, 'SPO-GFA', 'GFA-HEL', 'HEL-DEN', 'DEN-SLC'); // the long way round: 4 routes
    building(s, 1, 'railwayStation', 'BOI');
    const ev = lay(s);
    step(s, ev, { type: 'moveTrain', from: 'SPO', to: 'SLC' });
    assert.equal(s.players[0].railheads[0], 'SLC');
    assert.deepEqual(vpBySource(ev, 1), {}, 'the path avoids Boise');
  });
  check('R12.3.1/routes', 'ties on tolls are broken by the fewest routes', () => {
    const s = layGame('SPO', 'MIN', {}, 3);
    claim(s, 1, 'SPO-BOI', 'BOI-SLC');
    claim(s, 2, 'SPO-GFA', 'GFA-HEL', 'HEL-DEN', 'DEN-SLC');
    building(s, 1, 'railwayStation', 'BOI');
    building(s, 2, 'railwayStation', 'DEN');
    lay(s);
    const ev = act(s, { type: 'moveTrain', from: 'SPO', to: 'SLC' });
    assert.deepEqual([vpBySource(ev, 1), vpBySource(ev, 2)], [{ toll: 3 }, {}], 'one toll either way: the 2-route path through Boise is taken');
  });
  check('R12.3.1/alphabetical', 'then by the path whose list of city ids comes first alphabetically', () => {
    const s = layGame('BOI', 'MIN', {}, 3);
    claim(s, 1, 'BOI-SLC', 'SLC-TON'); // BOI, SLC, TON
    claim(s, 2, 'BOI-REN', 'REN-TON'); // BOI, REN, TON: first alphabetically
    building(s, 1, 'railwayStation', 'SLC');
    building(s, 2, 'railwayStation', 'REN');
    lay(s);
    const ev = act(s, { type: 'moveTrain', from: 'BOI', to: 'TON' });
    assert.deepEqual([vpBySource(ev, 1), vpBySource(ev, 2)], [{}, { toll: 3 }]);
    const t = layGame('REN', 'MIN', {}, 3);
    claim(t, 1, 'BOI-REN', 'BOI-SLC'); // REN, BOI, SLC: first alphabetically
    claim(t, 2, 'REN-TON', 'SLC-TON'); // REN, TON, SLC
    building(t, 1, 'railwayStation', 'BOI');
    building(t, 2, 'railwayStation', 'TON');
    lay(t);
    const ev2 = act(t, { type: 'moveTrain', from: 'REN', to: 'SLC' });
    assert.deepEqual([vpBySource(ev2, 1), vpBySource(ev2, 2)], [{ toll: 3 }, {}]);
  });
  check('R12.3.2', 'each city entered that holds another player\'s railway station pays its owner 3 VP, the destination included, once per move', () => {
    const s = layGame('POR', 'MIN', {}, 3);
    claim(s, 1, 'TDL-POR', 'TDL-BOI', 'BOI-SLC');
    building(s, 1, 'railwayStation', 'TDL');
    building(s, 2, 'railwayStation', 'BOI');
    building(s, 2, 'railwayStation', 'SLC');
    building(s, 0, 'telegraphStation', 'BOI');
    lay(s);
    const ev = act(s, { type: 'moveTrain', from: 'POR', to: 'SLC' });
    assert.deepEqual([vpBySource(ev, 1), vpBySource(ev, 2)], [{ toll: 3 }, { toll: 6 }]);
  });
  check('R12.3.3', 'the toll comes from the bank: the moving player loses nothing', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    building(s, 1, 'railwayStation', 'TDL');
    s.players[0].vp.track = 4;
    const before = [vpTotal(s, 0), s.players[0].coins];
    const ev = lay(s);
    step(s, ev, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.deepEqual([vpTotal(s, 0), s.players[0].coins], before);
    assert.equal(s.players[1].vp.toll, 3);
  });
  check('R12.4', 'after a move the player may pay 2 Coins to place one building in the destination, if it is an inland city with room', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    give(s, 0, { coins: 3, tiles: {} });
    const ev = lay(s);
    step(s, ev, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.equal(kind(s), 'placeBuildings');
    assert.ok(offered(s, 'skipBuilding'));
    act(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'iron' });
    assert.equal(s.players[0].coins, 1);
    assert.equal(s.map.railwayStation.TDL, 0);
    assert.equal(s.turn.player, 1, 'one building per move');
    const poor = layGame();
    claim(poor, 1, 'TDL-POR');
    give(poor, 0, { coins: 1, tiles: {} });
    lay(poor);
    assert.equal(poor.players[0].railheads[0], 'TDL');
    assert.equal(poor.turn.player, 1, 'with 1 Coin no building is on offer');
    const start = layGame('TDL', 'MIN');
    claim(start, 1, 'TDL-POR');
    give(start, 0, { coins: 5, tiles: {} });
    lay(start);
    assert.equal(start.players[0].railheads[0], 'POR');
    assert.equal(start.turn.player, 1, 'a start city takes no building');
  });
  check('R12.5', 'any number of railheads may share a city, including a player\'s own two', () => {
    const s = layGame('POR', 'MIN', {}, 2);
    setHeads(s, 1, 'SEA', 'OMA');
    s.players[1].railheads = ['SXC', 'OMA'];
    // Portland to Sioux City by TDL-POR, SPO-TDL, SPO-GFA, GFA-BIS, BIS-SXC; Minneapolis to Sioux City by MIN-SXC
    claim(s, 1, 'MIN-SXC', 'TDL-POR', 'SPO-TDL', 'SPO-GFA', 'GFA-BIS', 'BIS-SXC');
    give(s, 0, { coins: 0, tiles: {} });
    lay(s);
    act(s, { type: 'moveTrain', from: 'POR', to: 'SXC' });
    assert.deepEqual(s.players[0].railheads, ['SXC', 'MIN']);
    idleUntil(s, 0);
    choose(s, act(s, { type: 'removeWorker', from: 'W4' }), 'D5');
    act(s, { type: 'moveTrain', from: 'MIN', to: 'SXC' });
    assert.deepEqual(s.players[0].railheads, ['SXC', 'SXC']);
    assert.equal(s.players[1].railheads[0], 'SXC');
  });
  check('R12.6', 'a railhead on a city that no claimed route touches cannot move', () => {
    const s = layGame('POR', 'MIN');
    claim(s, 1, 'SEA-TDL');
    lay(s);
    assert.ok(!offered(s, 'moveTrain'));
    refused(s, { type: 'moveTrain', from: 'POR', to: 'TDL' });
  });

  // ----- R13 -----------------------------------------------------------------
  check('R13.1', 'buildings go only in inland cities; each has room for exactly one railway station and one telegraph station', () => {
    const s = layGame();
    assert.deepEqual(sorted(Object.keys(s.map.railwayStation)), sorted(MAP.inlandCities));
    assert.deepEqual(sorted(Object.keys(s.map.telegraphStation)), sorted(MAP.inlandCities));
    building(s, 1, 'railwayStation', 'TDL');
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(s, 'placeRailwayStation'), 'The Dalles already has its railway station');
    assert.ok(offered(s, 'placeTelegraphStation', { city: 'TDL' }), 'the telegraph station sits under it');
    refused(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'wood' });
  });
  check('R13.2', 'placing a railway station: the leftmost house of a chosen track that still has one; production rises by 1 at once; no VP', () => {
    const s = layGame();
    s.players[0].houses.gunpowder = 0;
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(sorted(offers(s, 'placeRailwayStation').map((a) => a.houseTrack)), ['coins', 'iron', 'wood'], 'R13.2.3: a track that still has a house');
    refused(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'gunpowder' });
    const p = production(s, 0, 'wood');
    const ev = act(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'wood' });
    assert.equal(s.players[0].houses.wood, 2);
    assert.equal(production(s, 0, 'wood'), p + 1, 'R13.2.4');
    assert.equal(s.map.railwayStation.TDL, 0);
    assert.equal(eventsOf(ev, 'vp').length, 0, 'R13.2.5: no VP by itself');
  });
  check('R13.2.1', 'a railway station needs a city with no railway station', () => {
    const s = layGame();
    building(s, 0, 'railwayStation', 'TDL');
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(s, 'placeRailwayStation'));
  });
  check('R13.2.2', 'a railway station needs a house left on the player board', () => {
    const s = layGame();
    s.players[0].houses = { wood: 0, coins: 0, iron: 0, gunpowder: 0 };
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(s, 'placeRailwayStation'));
    assert.ok(offered(s, 'placeTelegraphStation'));
  });
  check('R13.3', 'placing a telegraph station scores the VP printed on the slot it leaves: 1, 2, 3, 4, 5, 6, 9', () => {
    const scored = [];
    for (let k = 0; k < 7; k++) {
      const s = layGame();
      s.players[0].telegraphsPlaced = k;
      lay(s);
      act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
      const ev = act(s, { type: 'placeTelegraphStation', city: 'TDL' });
      scored.push(vpBySource(ev, 0).telegraph);
      assert.equal(s.players[0].telegraphsPlaced, k + 1);
      assert.equal(s.map.telegraphStation.TDL, 0);
    }
    assert.deepEqual(scored, [1, 2, 3, 4, 5, 6, 9]);
  });
  check('R13.3.1', 'a telegraph station needs a city with no telegraph station', () => {
    const s = layGame();
    building(s, 1, 'telegraphStation', 'TDL');
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(s, 'placeTelegraphStation'));
    refused(s, { type: 'placeTelegraphStation', city: 'TDL' });
  });
  check('R13.3.2', 'a telegraph station needs one left on the telegraph row', () => {
    const s = layGame();
    s.players[0].telegraphsPlaced = 7;
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(s, 'placeTelegraphStation'));
    assert.ok(offered(s, 'placeRailwayStation'));
  });
  check('R13.4', 'free building on arrival by a claim: a railway station or a telegraph station, one per claim, optional, on every arrival with room', () => {
    const s = layGame();
    claim(s, 1, 'SEA-TDL'); // The Dalles is already connected: the building is not limited to first connections
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(sorted([...new Set(types(s))]), ['placeRailwayStation', 'placeTelegraphStation', 'skipBuilding']);
    assert.ok(getValidActions(s).every((a) => a.city === undefined || a.city === 'TDL'));
    act(s, { type: 'placeTelegraphStation', city: 'TDL' });
    assert.equal(s.turn.player, 1, 'one building per claim');
    assert.equal(s.map.railwayStation.TDL, null);
  });
  check('R13.5', 'paid building on arrival by a move: 2 Coins, one building per move', () => {
    const s = layGame();
    claim(s, 1, 'TDL-POR');
    give(s, 0, { coins: 4, tiles: {} });
    const ev = lay(s);
    step(s, ev, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    act(s, { type: 'placeTelegraphStation', city: 'TDL' });
    assert.equal(s.players[0].coins, 2);
    assert.equal(s.turn.player, 1);
    assert.equal(s.map.railwayStation.TDL, null);
  });
  check('R13.6', 'retired in v8: Congress entry C6 places no building; buildings reach the map only on arrival (R13.4, R13.5)', () => {
    const s = game(3);
    setTrain(s, 0, [['financier', 'financier']]);
    give(s, 0, { coins: 3, resources: {} });
    claim(s, 1, 'TDL-POR', 'POR-REN'); // connected inland cities with room, where C6 once placed buildings
    placeAndChoose(s, 'W1', 'D2');
    while (topFrame(s).lobby < 3) act(s, { type: 'closeCongress' });
    const ev = act(s, { type: 'takeCongressEntry', entry: 'C6' });
    assert.equal(kind(s), 'chooseResource', 'resources of choice, not a choice between options');
    for (let guard = 0; guard < 10 && kind(s) === 'chooseResource'; guard++) {
      assert.ok(!offered(s, 'placeRailwayStation') && !offered(s, 'placeTelegraphStation'));
      ev.push(...act(s, { type: 'chooseResource', resource: 'iron' }));
    }
    assert.equal(s.players[0].resources.iron, 6);
    assert.equal(eventsOf(ev, 'buildingPlaced').length, 0);
    assert.ok(Object.values(s.map.railwayStation).every((o) => o === null) && Object.values(s.map.telegraphStation).every((o) => o === null), 'the map has no building');
    assert.ok(!s.stack.some((f) => f.kind === 'placeBuildings' || f.kind === 'chooseOption'));
    assert.deepEqual(vpBySource(ev, 0), {}, 'and no VP');
  });
  check('R13.7', 'bothBuildingsSameOwner: by default one player may own both buildings of a city; false forbids it', () => {
    const s = layGame();
    building(s, 0, 'telegraphStation', 'TDL');
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(offered(s, 'placeRailwayStation', { city: 'TDL' }));
    const t = layGame('POR', 'MIN', { bothBuildingsSameOwner: false });
    building(t, 0, 'telegraphStation', 'TDL');
    const ev = lay(t);
    step(t, ev, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(t, 'placeRailwayStation'));
    const u = layGame('POR', 'MIN', { bothBuildingsSameOwner: false });
    building(u, 1, 'telegraphStation', 'TDL');
    lay(u);
    act(u, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(offered(u, 'placeRailwayStation', { city: 'TDL' }), 'the two buildings must belong to different players');
    const v = layGame('POR', 'MIN', { bothBuildingsSameOwner: false });
    building(v, 0, 'railwayStation', 'TDL');
    lay(v);
    act(v, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.ok(!offered(v, 'placeTelegraphStation'));
  });
  check('R13.8', 'buildings never move, are never removed and never change owner', () => {
    const s = layGame();
    lay(s);
    act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    act(s, { type: 'placeRailwayStation', city: 'TDL', houseTrack: 'wood' });
    for (let i = 0; i < 6; i++) idleTurn(s);
    assert.equal(s.map.railwayStation.TDL, 0);
    assert.equal(s.players[0].houses.wood, 2);
  });
  check('R13.9', 'the toll: 3 VP from the bank whenever a railhead enters a city with another player\'s railway station; telegraph stations take no toll', () => {
    const s = layGame();
    building(s, 1, 'telegraphStation', 'TDL');
    lay(s);
    const ev = act(s, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(vpBySource(ev, 1), {});
    const t = layGame();
    claim(t, 1, 'TDL-POR');
    building(t, 1, 'telegraphStation', 'TDL');
    const ev2 = lay(t);
    step(t, ev2, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.equal(t.players[0].railheads[0], 'TDL');
    assert.deepEqual(vpBySource(ev2, 1), {});
    assert.equal(RULES.SCORING.tollVp, 3);
  });
  check('R13.10', 'no house left: no railway station; no telegraph station left: none; there is no other limit', () => {
    const s = layGame();
    s.players[0].houses = { wood: 0, coins: 0, iron: 0, gunpowder: 0 };
    s.players[0].telegraphsPlaced = 7;
    const ev = lay(s);
    step(s, ev, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.notEqual(kind(s), 'placeBuildings');
    const t = layGame();
    t.players[0].houses = { wood: 0, coins: 0, iron: 1, gunpowder: 0 };
    t.players[0].telegraphsPlaced = 6;
    lay(t);
    act(t, { type: 'claimRoute', route: 'TDL-POR', from: 'POR' });
    assert.deepEqual(sorted(getValidActions(t).map((a) => a.type)), ['placeRailwayStation', 'placeTelegraphStation', 'skipBuilding']);
  });

  // ----- R14 -----------------------------------------------------------------
  check('R14.1', 'a player holds at most 2 hats; a hat gained while holding 2 becomes 1 resource of choice, whatever the source', () => {
    // displacement
    const s = game(3);
    put(s, 1, 'W10');
    put(s, 2, 'W12');
    give(s, 1, { hats: 2 });
    give(s, 2, { hats: 1 });
    act(s, { type: 'displaceWorker', district: 'D9' });
    assert.equal(kind(s), 'chooseResource');
    assert.equal(s.toAct, 1);
    act(s, { type: 'chooseResource', resource: 'gunpowder' });
    assert.deepEqual([s.players[1].hats, s.players[1].resources.gunpowder, s.players[2].hats], [2, 2, 2]);
    assert.equal(RULES.HATS.hatLimit, 2);
  });
  check('R14.2', 'at step 3 the player may spend 1 hat to add 1 to M; it works on any district action', () => {
    const g = game(2);
    give(g, 0, { hats: 2, resources: {} });
    placeAndChoose(g, 'W2', 'D3', true);
    assert.equal(g.players[0].resources.iron, 4, 'Gather: P 2 x M 2');
    assert.equal(g.players[0].hats, 1, 'at most 1 hat per turn');
    const t = game(2);
    give(t, 0, { hats: 1, resources: { iron: 4 } });
    setTrain(t, 0, [[null, null]]);
    placeAndChoose(t, 'W6', 'D4', true);
    act(t, { type: 'useStep' });
    act(t, { type: 'useStep' });
    assert.equal(t.players[0].builtTiles.ground, 2, 'train activation: the Foreman acts twice');
    const l = layGame();
    claim(l, 1, 'TDL-POR', 'SPO-TDL');
    give(l, 0, { hats: 1, tiles: {} });
    placeAndChoose(l, 'W4', 'D5', true);
    act(l, { type: 'moveTrain', from: 'POR', to: 'TDL' });
    assert.equal(kind(l), 'layTracks', 'Lay Tracks / Move Train: two steps');
  });
  check('R14.2/declared', 'the hat is declared with the district choice, not later', () => {
    const s = game(2);
    give(s, 0, { hats: 1 });
    placeAndChoose(s, 'W11', 'D7', false);
    assert.equal(s.players[0].hats, 1);
    assert.equal(s.players[0].resources.wood, 2);
    assert.ok(getValidActions(s).every((a) => a.type !== 'chooseDistrict'));
  });
  check('R14.2/hat-timing', 'a hat gained during the current turn cannot be spent in that turn; a hat held when the turn began can', () => {
    const s = game(2, PONY);
    stock(s, 'PX8');
    giveTokens(s, 1, 2);
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'buyPonyCard', card: 'PX8' });
    const hat = topFrame(s).options.findIndex((o) => o.effects.some((e) => e.type === 'gain' && e.items.hats === 1));
    act(s, { type: 'chooseOption', option: hat });
    assert.equal(s.players[1].hats, 1);
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.ok(!offered(s, 'chooseDistrict', { hat: true }), 'bought in the first window of this turn');
    refused(s, { type: 'chooseDistrict', district: 'D9', hat: true });
    playTurn(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    idleUntil(s, 1);
    choose(s, act(s, { type: 'removeWorker', from: 'W12' }), 'D9', true);
    assert.equal(s.players[1].hats, 0, 'on the next turn the hat can be spent');
    // one hat at the start of the turn plus one gained in the first window: one can be spent
    const t = game(2, PONY);
    stock(t, 'PX8');
    giveTokens(t, 1, 2);
    give(t, 1, { hats: 1 });
    idleTurn(t);
    act(t, { type: 'buyPonyCard', card: 'PX8' });
    act(t, { type: 'chooseOption', option: topFrame(t).options.findIndex((o) => o.effects.some((e) => e.type === 'gain')) });
    if (kind(t) === 'freeActions') act(t, { type: 'endFreeActions' });
    act(t, { type: 'placeWorker', space: 'W12' });
    assert.ok(offered(t, 'chooseDistrict', { district: 'D9', hat: true }));
  });
  check('R14.2/displaced', 'a hat received on another player\'s turn is held when your own turn begins and can be spent then', () => {
    const s = game(3);
    put(s, 1, 'W10');
    put(s, 2, 'W12');
    playTurn(s, { type: 'displaceWorker', district: 'D9' });
    assert.equal(s.players[1].hats, 1);
    assert.equal(s.turn.player, 1);
    act(s, { type: 'placeWorker', space: 'W11' });
    assert.ok(offered(s, 'chooseDistrict', { district: 'D7', hat: true }));
  });
  check('R14.3', 'sources of hats: displacement, Buy Hat, Congress entry C3 (upgrade tiles and Pony Express cards: R15.2, R18.7)', () => {
    const s = game(2);
    placeAndChoose(s, 'W11', 'D7');
    act(s, { type: 'buyHat' });
    assert.equal(s.players[0].hats, 1);
  });
  check('R14.4', 'hats are worth nothing at the end of the game', () => {
    const a = game(2);
    const b = game(2);
    give(b, 0, { hats: 2 });
    assert.equal(scoreGame(a).players[0].total, scoreGame(b).players[0].total);
    assert.deepEqual(scoreGame(a).ranking, scoreGame(b).ranking);
  });
}
