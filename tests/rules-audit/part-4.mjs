// Rules audit, part 4: R15 carriage upgrades, R16 goals and milestones,
// R17 Legislative Agenda, R18 Pony Express. Written from rules spec v2.

import { RULES, MAP, scoreGame, goalStandings, isJunctionCity, cityRegion, production, storageCapacity } from '../../src/engine/index.js';
import {
  assert, check, game, act, take, put, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource,
  offered, offers, refused, idleTurn, idleUntil, finishTurn, playTurn, goTo, kind, keys, giveTokens, stock, ownCard, installTile, building,
  getValidActions, topFrame, vpTotal,
} from './kit.mjs';

const PONY = { modulePonyExpress: true };
const UPGRADES = { moduleCarriageUpgrades: true };
const legislative = (n) => ({ moduleLegislativeAgenda: true, legislativeAgendaCard: n });
const sorted = (a) => a.slice().sort();
const held = (p) => ({ ...p.resources, coins: p.coins });
const TILES = { ground: 9, tunnel: 9, bridge: 9 };

/** Seat 1 with railheads set, plenty of built tiles, three storage carriages. */
function layGame(west = 'POR', east = 'MIN', variants = {}, players = 2) {
  const s = game(players, variants);
  setHeads(s, 0, west, east);
  s.players[0].train.storageCarriages = 3;
  give(s, 0, { resources: {}, tiles: TILES });
  return s;
}
const lay = (s) => placeAndChoose(s, 'W4', 'D5');

/** Seat 1 claims `route` from `from` in a Lay Tracks action and returns the events up to the building decision. */
function claimNow(s, route, from) {
  const ev = lay(s);
  if (offered(s, 'claimRoute', { route })) ev.push(...act(s, { type: 'claimRoute', route, from }));
  return ev;
}

/** Seat 1 in a Lobby Congress activation that gives 5 lobby points (Foreman, two level 1 Financiers, one level 2). */
function lobbyGame(variants = {}, coins = 20) {
  const s = game(2, variants);
  setTrain(s, 0, [['financier', 'financier'], ['financier', null]]);
  give(s, 0, { coins, resources: {} });
  s.players[0].train.storageCarriages = 3;
  placeAndChoose(s, 'W1', 'D2');
  return s;
}
function waitLobby(s, n) {
  while (kind(s) === 'trainActivation' && topFrame(s).lobby < n) act(s, { type: 'closeCongress' });
  assert.equal(topFrame(s).lobby, n);
}

/** Seat 2 (Ben) buys `cardId` in the first free-action window of his turn. `prep(state)` runs before that turn starts. */
function buyer(cardId, prep = null, variants = {}, tokens = 5) {
  const s = game(2, { ...PONY, ...variants });
  stock(s, cardId);
  giveTokens(s, 1, tokens);
  if (prep) prep(s);
  idleTurn(s);
  assert.equal(kind(s), 'freeActions');
  assert.equal(s.toAct, 1);
  const ev = act(s, { type: 'buyPonyCard', card: cardId });
  return { s, ev };
}

/** Answers every pending choice of resources or built tiles with the first option. Returns how many were asked. */
function takeChoices(s, ev = []) {
  let n = 0;
  while (kind(s) === 'chooseResource' || kind(s) === 'chooseBuiltTile') {
    ev.push(...act(s, getValidActions(s)[0]));
    n += 1;
  }
  return n;
}
const stored = (p) => p.resources.iron + p.resources.wood + p.resources.gunpowder;
const tilesOf = (p) => p.builtTiles.ground + p.builtTiles.tunnel + p.builtTiles.bridge;

// R15.2, transcribed from the spec: id, level, what one activation gives.
const R15_2 = [
  ['U1-vp', 1, { vp: 2 }], ['U1-wood', 1, { wood: 1 }], ['U1-iron', 1, { iron: 1 }], ['U1-coin', 1, { coins: 1 }],
  ['U1-gunpowder', 1, { gunpowder: 1 }], ['U1-hat', 1, { hats: 1 }],
  ['U2-vp', 2, { vp: 3 }], ['U2-bridge', 2, { perBuilt: 'bridge' }], ['U2-tunnel', 2, { perBuilt: 'tunnel' }], ['U2-ground', 2, { perBuilt: 'ground' }],
  ['U2-hat', 2, { hats: 1 }],
  ['U3-vp', 3, { vp: 4 }], ['U3-bridge', 3, { tile: 'bridge' }], ['U3-tunnel', 3, { tile: 'tunnel' }], ['U3-ground', 3, { tile: 'ground' }],
  ['U3-hat', 3, { hats: 1 }],
];
const BUILD_AT = { ground: ['D4', 'crew', 'iron'], tunnel: ['D8', 'miner', 'gunpowder'], bridge: ['D6', 'engineer', 'wood'] };

// R16.8, transcribed from the spec: id, VP, a state that just meets the condition, a state one short of it.
const ROUTE_SETS = {
  MS2: [['POR-REN', 'SAC-REN', 'SAC-FRE'], ['POR-REN', 'SAC-REN', 'BOI-SLC']], // Tunnel slots 6 / 5
  MS3: [['POR-SPO', 'SPO-REN', 'OMA-NPL'], ['POR-SPO', 'SPO-REN']], // Bridge slots 6 / 5
  MS4: [['SEA-SPO', 'HEL-BIL', 'CHE-BIL'], ['SEA-SPO', 'HEL-BIL', 'CHE-SLC']], // Ground slots 6 / 5
  MS5: [['SEA-HEL'], ['HEL-BIS']], // longest route 5 / 4
  MS6: [['SEA-SPO', 'POR-SPO', 'POR-REN', 'SAC-REN', 'SAC-FRE', 'LAX-FRE'], ['SEA-SPO', 'POR-SPO', 'POR-REN', 'SAC-REN', 'SAC-FRE']], // 6 / 5 routes
};
const R16_8 = {
  MS1: [6, (s) => { for (const c of ['SPO', 'BOI']) building(s, 0, 'railwayStation', c); for (const c of ['SPO', 'BOI', 'REN']) building(s, 0, 'telegraphStation', c); },
    (s) => { for (const c of ['SPO', 'BOI']) building(s, 0, 'railwayStation', c); for (const c of ['SPO', 'BOI']) building(s, 0, 'telegraphStation', c); }],
  MS2: [6, (s) => claim(s, 0, ...ROUTE_SETS.MS2[0]), (s) => claim(s, 0, ...ROUTE_SETS.MS2[1])],
  MS3: [6, (s) => claim(s, 0, ...ROUTE_SETS.MS3[0]), (s) => claim(s, 0, ...ROUTE_SETS.MS3[1])],
  MS4: [6, (s) => claim(s, 0, ...ROUTE_SETS.MS4[0]), (s) => claim(s, 0, ...ROUTE_SETS.MS4[1])],
  MS5: [5, (s) => claim(s, 0, ...ROUTE_SETS.MS5[0]), (s) => claim(s, 0, ...ROUTE_SETS.MS5[1])],
  MS6: [7, (s) => claim(s, 0, ...ROUTE_SETS.MS6[0]), (s) => claim(s, 0, ...ROUTE_SETS.MS6[1])],
  MS7: [7, (s) => { setHeads(s, 0, 'POR', 'MIN'); claim(s, 1, 'POR-SPO', 'HEL-SPO', 'HEL-BIS', 'BIS-MIN'); },
    (s) => { setHeads(s, 0, 'POR', 'MIN'); claim(s, 1, 'POR-SPO', 'HEL-SPO', 'HEL-BIS'); }],
  MS8: [6, (s) => setTrain(s, 0, [['crew', 'miner'], ['engineer', 'financier']]), (s) => setTrain(s, 0, [['crew', 'miner'], ['engineer', 'crew']])],
  MS9: [5, (s) => { setTrain(s, 0, [['crew', null], [null, null]]); s.players[0].train.storageCarriages = 3; },
    (s) => { setTrain(s, 0, [['crew', null], [null, null]]); s.players[0].train.storageCarriages = 2; }],
  MS10: [6, (s) => { for (const c of ['SPO', 'BOI', 'REN', 'FRE']) building(s, 0, 'telegraphStation', c); },
    (s) => { for (const c of ['SPO', 'BOI', 'REN']) building(s, 0, 'telegraphStation', c); building(s, 0, 'railwayStation', 'FRE'); }],
};

function milestoneGame(ids, players = 2) {
  const s = game(players, { endGameScoring: 'milestones' });
  s.modules.milestones.inPlay = ids.slice();
  s.modules.milestones.claimedBy = Object.fromEntries(ids.map((id) => [id, null]));
  return s;
}

function goalGame(numbers, players = 2, variants = {}) {
  const s = game(players, { endGameScoring: 'goals', ...variants });
  s.modules.goals.inPlay = numbers.map((n) => `G${n}`);
  return s;
}
const goal = (n) => RULES.GOAL_CARDS.find((g) => g.number === n);
const goalVp = (s) => scoreGame(s).players.map((p) => p.bySource.goals);

export default function part4() {
  // ----- R15 -----------------------------------------------------------------
  check('R15.1', 'module off: no upgrade tiles are set out and the upgrade slot of a carriage is ignored', () => {
    const s = game(2);
    assert.equal(s.modules.upgrades, undefined);
    assert.ok(!('upgrades' in s.players[0].vp));
    const ev = placeAndChoose(s, 'W6', 'D4');
    assert.equal(eventsOf(ev, 'upgradeStep').length, 0);
  });
  for (const [id, level, gives] of R15_2) {
    check(`R15.2/${id}`, `upgrade tile ${id} (level ${level}): ${JSON.stringify(gives)} each time its step is reached`, () => {
      const data = RULES.UPGRADE_TILES.find((t) => t.id === id);
      assert.equal(data.level, level);
      const terrain = gives.perBuilt ?? null;
      const [district, specialist, resource] = terrain ? BUILD_AT[terrain] : ['D4', 'crew', 'iron'];
      const s = game(2, UPGRADES);
      const train = [];
      for (let l = 1; l <= level; l++) train.push([l === 1 ? specialist : null, null]);
      train[level - 1][0] = specialist;
      setTrain(s, 0, train);
      installTile(s, 0, level, id);
      s.players[0].train.storageCarriages = 3;
      give(s, 0, { resources: terrain ? { [resource]: 4 } : {}, coins: 0 });
      const before = { ...held(s.players[0]), hats: s.players[0].hats, tiles: { ...s.players[0].builtTiles } };
      const ev = goTo(s, district);
      let built = 0;
      while (kind(s) === 'trainActivation' && s.turn.player === 0 && built < 2) {
        ev.push(...act(s, { type: 'useStep' }));
        built += 1;
      }
      if (s.turn.player === 0) ev.push(...finishTurn(s));
      const p = s.players[0];
      const vp = vpBySource(ev, 0);
      if (gives.vp) assert.deepEqual(vp, { upgrades: gives.vp });
      else if (gives.perBuilt) {
        assert.equal(built, 2);
        assert.deepEqual(vp, { upgrades: 2 }, '1 VP for each tile of that type built in the activation');
      } else assert.deepEqual(vp, {});
      for (const k of ['iron', 'wood', 'gunpowder', 'coins']) {
        if (!terrain) assert.equal(held(p)[k] - before[k], gives[k] ?? 0, k);
      }
      assert.equal(p.hats - before.hats, gives.hats ?? 0);
      if (!terrain) {
        for (const t of ['ground', 'tunnel', 'bridge']) assert.equal(p.builtTiles[t] - before.tiles[t], gives.tile === t ? 1 : 0, t);
      }
    });
  }
  check('R15.3.1', 'a tile may be installed only in a carriage that holds at least one specialist', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['crew', null], [null, null]]);
    placeAndChoose(s, 'W1', 'D1');
    assert.ok(offers(s, 'installUpgrade').every((a) => a.level === 1));
    refused(s, { type: 'installUpgrade', tile: 'U1-wood', level: 2 });
  });
  check('R15.3.2', 'a tile may be installed only in an empty upgrade slot', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['crew', null], ['crew', null]]);
    installTile(s, 0, 1, 'U1-vp');
    placeAndChoose(s, 'W1', 'D1');
    assert.ok(offers(s, 'installUpgrade').length > 0);
    assert.ok(offers(s, 'installUpgrade').every((a) => a.level === 2));
    refused(s, { type: 'installUpgrade', tile: 'U1-wood', level: 1 });
  });
  check('R15.3.3', 'the tile\'s level must be at most the carriage\'s level', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['crew', null], ['crew', null], ['crew', null]]);
    placeAndChoose(s, 'W1', 'D1');
    const levelOf = (id) => Number(id[1]);
    for (const a of offers(s, 'installUpgrade')) assert.ok(levelOf(a.tile) <= a.level, `${a.tile} in level ${a.level}`);
    const at = (l) => sorted([...new Set(offers(s, 'installUpgrade').filter((a) => a.level === l).map((a) => levelOf(a.tile)))]);
    assert.deepEqual([at(1), at(2), at(3)], [[1], [1, 2], [1, 2, 3]]);
    refused(s, { type: 'installUpgrade', tile: 'U3-hat', level: 2 });
    refused(s, { type: 'installUpgrade', tile: 'U2-hat', level: 1 });
    assert.equal(offers(s, 'installUpgrade').length, 6 + 11 + 16);
  });
  check('R15.3.4', 'the tile must still be in the display; installing has no immediate effect', () => {
    const s = game(2, UPGRADES);
    installTile(s, 1, 1, 'U1-vp');
    placeAndChoose(s, 'W1', 'D1');
    assert.ok(!offered(s, 'installUpgrade', { tile: 'U1-vp' }));
    refused(s, { type: 'installUpgrade', tile: 'U1-vp', level: 1 });
    const ev = act(s, { type: 'installUpgrade', tile: 'U1-hat', level: 1 });
    assert.equal(s.players[0].hats, 0);
    assert.equal(eventsOf(ev, 'vp').length, 0);
  });
  check('R15.4', 'an installed tile is never moved, replaced or removed; tiles are first come, first served and are not refilled', () => {
    const s = game(2, UPGRADES);
    placeAndChoose(s, 'W1', 'D1');
    act(s, { type: 'installUpgrade', tile: 'U1-iron', level: 1 });
    assert.equal(s.modules.upgrades.display.length, 15);
    give(s, 1, { resources: { iron: 2 } });
    placeAndChoose(s, 'W3', 'D1');
    assert.ok(!offered(s, 'installUpgrade', { tile: 'U1-iron' }), 'Ben cannot take the tile Anna installed');
    act(s, { type: 'skipBonusAction' });
    give(s, 0, { resources: { iron: 2 } });
    choose(s, act(s, { type: 'removeWorker', from: 'W1' }), 'D1');
    assert.equal(s.turn.player, 1, 'Anna\'s only carriage already carries a tile: no second install');
    assert.equal(s.modules.upgrades.installed[0][0], 'U1-iron');
  });
  check('R15.5', 'a tile works in every activation of its owner, after the previous carriage and before the specialists of its own carriage; M does not repeat it', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['crew', null], ['crew', null]]);
    installTile(s, 0, 2, 'U1-iron');
    give(s, 0, { resources: { iron: 5 } });
    const ev = placeAndChoose(s, 'W6', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
    // Foreman 5 -> 3, level 1 Crew 3 -> 1, tile + 1 = 2, level 2 Crew 2 -> 0, its second activation cannot pay.
    assert.equal(s.players[0].builtTiles.ground, 3);
    assert.equal(s.players[0].resources.iron, 0);
    const t = game(2, UPGRADES);
    installTile(t, 0, 1, 'U1-vp');
    put(t, 0, 'W3');
    put(t, 0, 'W8');
    const ev2 = placeAndChoose(t, 'W6', 'D4'); // M = 3
    assert.deepEqual(vpBySource(ev2, 0), { upgrades: 2 }, 'once per activation, whatever M is');
    // every activation, including the next one
    idleUntil(t, 0);
    const again = choose(t, act(t, { type: 'removeWorker', from: 'W6' }), 'D4');
    assert.equal(vpBySource(again, 0).upgrades, 2);
    // not in another player's activation
    const u = game(2, UPGRADES);
    installTile(u, 0, 1, 'U1-vp');
    idleTurn(u);
    const other = placeAndChoose(u, 'W7', 'D6');
    assert.deepEqual(vpBySource(other, 0), {});
  });
  check('R15.5.1', 'items gained from a tile follow the storage limit and the hat limit', () => {
    const s = game(2, UPGRADES);
    installTile(s, 0, 1, 'U1-hat');
    give(s, 0, { hats: 2, resources: { wood: 8, iron: 1 } });
    placeAndChoose(s, 'W6', 'D4');
    assert.equal(kind(s), 'chooseResource');
    act(s, { type: 'chooseResource', resource: 'wood' });
    assert.equal(kind(s), 'discard');
    act(s, { type: 'discard', item: 'wood' });
    assert.equal(s.players[0].hats, 2);
  });
  check('R15.5.2', 'vpPerBuilt counts only tiles the Foreman and specialists built: not tiles from a Congress entry or another upgrade tile', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['crew', 'financier'], ['financier', null], ['financier', null]]);
    installTile(s, 0, 2, 'U2-ground');
    installTile(s, 0, 3, 'U3-ground');
    s.players[0].train.storageCarriages = 3;
    give(s, 0, { resources: { iron: 4 }, coins: 10 });
    const ev = placeAndChoose(s, 'W6', 'D4');
    ev.push(...act(s, { type: 'useStep' })); // Foreman: 1 Ground built
    ev.push(...act(s, { type: 'useStep' })); // Crew: 1 Ground built
    while (topFrame(s).lobby < 3) ev.push(...act(s, { type: 'closeCongress' }));
    ev.push(...act(s, { type: 'takeCongressEntry', entry: 'C5' }));
    ev.push(...act(s, { type: 'chooseBuiltTile', terrain: 'ground' }));
    ev.push(...act(s, { type: 'chooseBuiltTile', terrain: 'ground' }));
    ev.push(...finishTurn(s));
    assert.equal(s.players[0].builtTiles.ground, 5, '2 built, 2 from Congress, 1 from the level 3 tile');
    assert.equal(vpBySource(ev, 0).upgrades, 2);
  });
  check('R15.6', 'upgradeVpTiming on-install: the three VP tiles score once when installed and do nothing afterwards; the other tiles are unaffected', () => {
    const s = game(2, { ...UPGRADES, upgradeVpTiming: 'on-install' });
    placeAndChoose(s, 'W1', 'D1');
    const ev = act(s, { type: 'installUpgrade', tile: 'U1-vp', level: 1 });
    assert.deepEqual(vpBySource(ev, 0), { upgrades: 2 });
    idleUntil(s, 0);
    const later = goTo(s, 'D4');
    assert.deepEqual(vpBySource(later, 0), {});
    const t = game(2, { ...UPGRADES, upgradeVpTiming: 'on-install' });
    installTile(t, 0, 1, 'U1-wood');
    placeAndChoose(t, 'W6', 'D4');
    assert.equal(t.players[0].resources.wood, 2);
    const d = game(2, UPGRADES);
    placeAndChoose(d, 'W1', 'D1');
    assert.deepEqual(vpBySource(act(d, { type: 'installUpgrade', tile: 'U1-vp', level: 1 }), 0), {}, 'per-activation (default): nothing on installing');
  });

  // ----- R16 -----------------------------------------------------------------
  check('R16.1', 'endGameScoring: milestones by default; goals, both and none are available', () => {
    const d = game(2, { endGameScoring: 'milestones' });
    assert.deepEqual(['milestones' in d.players[0].vp, 'goals' in d.players[0].vp], [true, false]);
    const g = game(2, { endGameScoring: 'goals' });
    assert.deepEqual(['milestones' in g.players[0].vp, 'goals' in g.players[0].vp], [false, true]);
    const b = game(2, { endGameScoring: 'both' });
    assert.deepEqual(['milestones' in b.players[0].vp, 'goals' in b.players[0].vp], [true, true]);
    const n = game(2, { endGameScoring: 'none' });
    assert.deepEqual(['milestones' in n.players[0].vp, 'goals' in n.players[0].vp], [false, false]);
  });
  check('R16.2', 'goals are scored once, in final scoring; nothing about them happens during play', () => {
    const s = goalGame([1], 2, { maxTurnsPerPlayer: 2 });
    building(s, 0, 'railwayStation', 'SPO');
    for (let i = 0; i < 3; i++) idleTurn(s);
    assert.deepEqual(s.players.map((p) => p.vp.goals), [0, 0]);
    idleTurn(s);
    assert.equal(s.phase, 'ended');
    assert.deepEqual(s.players.map((p) => p.vp.goals), [10, 0]);
  });
  check('R16.3', 'first place scores 10 VP, second place 5 VP, third and fourth nothing', () => {
    const s = goalGame([11], 4);
    for (const c of ['SPO', 'BOI', 'REN', 'FRE']) building(s, 2, 'telegraphStation', c);
    for (const c of ['HEL', 'BIL', 'CHE']) building(s, 0, 'telegraphStation', c);
    for (const c of ['DEN', 'ELP']) building(s, 3, 'telegraphStation', c);
    building(s, 1, 'telegraphStation', 'SXF');
    assert.deepEqual(goalVp(s), [5, 0, 10, 0]);
  });
  check('R16.4.1', 'all players tied for a place each score that place\'s full value', () => {
    const s = goalGame([11], 4);
    for (const c of ['SPO', 'BOI', 'REN']) building(s, 0, 'telegraphStation', c);
    for (const c of ['HEL', 'BIL']) building(s, 1, 'telegraphStation', c);
    for (const c of ['DEN', 'ELP']) building(s, 2, 'telegraphStation', c);
    building(s, 3, 'telegraphStation', 'SXF');
    assert.deepEqual(goalVp(s), [10, 5, 5, 0]);
  });
  check('R16.4.2', 'two or more tied for first each score 10 VP and second place still goes to the next-best measure', () => {
    const s = goalGame([11], 4);
    for (const c of ['SPO', 'BOI']) building(s, 0, 'telegraphStation', c);
    for (const c of ['HEL', 'BIL']) building(s, 1, 'telegraphStation', c);
    building(s, 2, 'telegraphStation', 'DEN');
    assert.deepEqual(goalVp(s), [10, 10, 5, 0]);
  });
  check('R16.4.3', 'on a "most" goal a player whose measure is 0 scores nothing, whatever their rank', () => {
    const s = goalGame([11], 4);
    building(s, 0, 'telegraphStation', 'SPO');
    assert.deepEqual(goalVp(s), [10, 0, 0, 0], 'the three at 0 are "second" but score nothing');
    const none = goalGame([11], 3);
    assert.deepEqual(goalVp(none), [0, 0, 0]);
  });
  check('R16.4.4', 'in a 2-player game only first place is awarded', () => {
    const s = goalGame([11], 2);
    for (const c of ['SPO', 'BOI']) building(s, 0, 'telegraphStation', c);
    building(s, 1, 'telegraphStation', 'DEN');
    assert.deepEqual(goalVp(s), [10, 0]);
    const tie = goalGame([11], 2);
    building(tie, 0, 'telegraphStation', 'SPO');
    building(tie, 1, 'telegraphStation', 'DEN');
    assert.deepEqual(goalVp(tie), [10, 10]);
  });
  const R16_5 = {
    1: ['railwayStations', 'most', (s) => { building(s, 0, 'railwayStation', 'SPO'); building(s, 0, 'railwayStation', 'BOI'); building(s, 0, 'telegraphStation', 'REN'); building(s, 1, 'railwayStation', 'REN'); }, [2, 1]],
    2: ['minNorthSouthBuildings', 'most', (s) => {
      building(s, 0, 'railwayStation', 'SPO'); building(s, 0, 'telegraphStation', 'SPO'); building(s, 0, 'railwayStation', 'HEL'); // North 3
      building(s, 0, 'telegraphStation', 'FRE'); building(s, 0, 'railwayStation', 'DOD'); // South 2
      building(s, 0, 'railwayStation', 'REN'); building(s, 0, 'telegraphStation', 'DEN'); // neither region
      building(s, 1, 'railwayStation', 'BIS'); building(s, 1, 'telegraphStation', 'CHE'); // North only
    }, [2, 0]],
    3: ['buildingsInJunctionCities', 'most', (s) => {
      building(s, 0, 'railwayStation', 'SPO'); building(s, 0, 'telegraphStation', 'SPO'); building(s, 0, 'railwayStation', 'SXF');
      building(s, 0, 'railwayStation', 'LVG'); building(s, 0, 'telegraphStation', 'NPL'); // not junction cities
      building(s, 1, 'telegraphStation', 'DEN');
    }, [3, 1]],
    4: ['maxSpecialistsOneType', 'most', (s) => { setTrain(s, 0, [['crew', 'crew'], ['miner', 'crew']]); setTrain(s, 1, [['crew', 'miner'], ['engineer', 'financier']]); }, [3, 1]],
    5: ['carriages', 'most', (s) => { setTrain(s, 0, [['crew', null], [null, null]]); s.players[0].train.storageCarriages = 3; }, [5, 2]],
    6: ['upgradesInstalled', 'most', (s) => { installTile(s, 0, 1, 'U1-vp'); installTile(s, 0, 2, 'U1-wood'); installTile(s, 1, 1, 'U1-hat'); }, [2, 1]],
    7: ['completeSpecialistSets', 'most', (s) => { setTrain(s, 0, [['crew', 'miner'], ['engineer', 'financier'], ['crew', 'miner']]); setTrain(s, 1, [['crew', 'miner'], ['engineer', 'crew']]); }, [1, 0]],
    8: ['specialists', 'most', (s) => { setTrain(s, 0, [['crew', 'miner'], ['engineer', null]]); }, [3, 1]],
    9: ['telegraphsWithOpponentRailway', 'most', (s) => {
      building(s, 0, 'telegraphStation', 'SPO'); building(s, 1, 'railwayStation', 'SPO'); // counts
      building(s, 0, 'telegraphStation', 'BOI'); building(s, 0, 'railwayStation', 'BOI'); // own railway station
      building(s, 0, 'telegraphStation', 'REN'); // no railway station
    }, [1, 0]],
    10: ['cargo', 'fewest', (s) => {
      give(s, 0, { resources: { iron: 2, wood: 1 }, tiles: { ground: 1, bridge: 2 }, coins: 30, hats: 2 });
      give(s, 1, { resources: { iron: 1 }, tiles: {}, coins: 0 });
    }, [6, 1]],
    11: ['telegraphStations', 'most', (s) => { for (const c of ['SPO', 'BOI', 'REN']) building(s, 0, 'telegraphStation', c); building(s, 0, 'railwayStation', 'FRE'); }, [3, 0]],
    12: ['citiesWithOwnBuilding', 'most', (s) => {
      building(s, 0, 'railwayStation', 'SPO'); building(s, 0, 'telegraphStation', 'SPO'); building(s, 0, 'railwayStation', 'BOI');
      building(s, 1, 'telegraphStation', 'BOI'); building(s, 1, 'telegraphStation', 'REN'); building(s, 1, 'railwayStation', 'FRE');
    }, [2, 3]],
  };
  for (const n of Object.keys(R16_5).map(Number)) {
    const [metric, direction, setup, values] = R16_5[n];
    check(`R16.5/${n}`, `goal ${n}: ${goal(n).name} - the measure and its direction`, () => {
      assert.deepEqual([goal(n).metric, goal(n).direction], [metric, direction]);
      const s = goalGame([n], 2, n === 6 ? UPGRADES : {});
      setup(s);
      const standing = goalStandings(s, goal(n));
      assert.deepEqual(standing.values, values);
      const better = direction === 'most' ? values[0] > values[1] : values[0] < values[1];
      assert.deepEqual(goalVp(s), better ? [10, 0] : [0, 10]);
    });
  }
  check('R16.5/10-tokens', 'goal 10 does not count Coins, hats or Pony Express tokens', () => {
    const s = goalGame([10], 2, PONY);
    give(s, 0, { resources: {}, tiles: {}, coins: 50, hats: 2 });
    giveTokens(s, 0, 9);
    assert.equal(goalStandings(s, goal(10)).values[0], 0);
    assert.deepEqual(goalVp(s), [10, 0], 'on a "fewest" goal the smallest measure ranks first');
  });
  check('R16.6.1', 'junction cities: the 10 inland cities with 5 or more printed routes', () => {
    const want = ['SPO', 'REN', 'FRE', 'HEL', 'BOI', 'SLC', 'CHE', 'DEN', 'ELP', 'SXF'];
    const s = game(2);
    assert.deepEqual(sorted(MAP.cityIds.filter((c) => isJunctionCity(s, c))), sorted(want));
    for (const c of want) assert.ok(MAP.cityRoutes[c].length >= 5);
  });
  check('R16.6.2', 'North region: 7 inland cities; South region: 6; Reno, Salt Lake City, Denver and North Platte in neither', () => {
    const region = (r) => sorted(MAP.inlandCities.filter((c) => cityRegion(c, RULES.MAP_RULES) === r));
    assert.deepEqual(region('north'), sorted(['SPO', 'HEL', 'BOI', 'BIL', 'BIS', 'CHE', 'SXF']));
    assert.deepEqual(region('south'), sorted(['FRE', 'LVG', 'PHX', 'SFE', 'ELP', 'DOD']));
    const rest = MAP.inlandCities.filter((c) => !['north', 'south'].includes(cityRegion(c, RULES.MAP_RULES)));
    assert.deepEqual(sorted(rest), sorted(['REN', 'SLC', 'DEN', 'NPL']));
  });
  check('R16.7', 'a milestone is claimed by one player only, the first to meet its condition, who scores its VP at once and keeps it', () => {
    const s = milestoneGame(['MS9']);
    R16_8.MS9[1](s);
    const ev = idleTurn(s);
    assert.equal(s.modules.milestones.claimedBy.MS9, 0);
    assert.deepEqual(vpBySource(ev, 0), { milestones: 5 });
    setTrain(s, 1, [['crew', null], [null, null]]);
    s.players[1].train.storageCarriages = 3;
    const later = idleTurn(s);
    assert.equal(s.modules.milestones.claimedBy.MS9, 0, 'Ben meets it later and gets nothing');
    assert.deepEqual(vpBySource(later, 1), {});
    assert.deepEqual(vpBySource(later, 0), {}, 'and Anna does not score it twice');
  });
  for (const id of Object.keys(R16_8)) {
    const [vp, meets, short] = R16_8[id];
    check(`R16.8/${id}`, `milestone ${id}: its condition and its ${vp} VP`, () => {
      const s = milestoneGame([id]);
      meets(s);
      const ev = idleTurn(s);
      assert.equal(s.modules.milestones.claimedBy[id], 0);
      assert.deepEqual(vpBySource(ev, 0), { milestones: vp });
      const t = milestoneGame([id]);
      short(t);
      idleTurn(t);
      idleTurn(t);
      assert.equal(t.modules.milestones.claimedBy[id], null, 'one short of the condition claims nothing');
    });
  }
  check('R16.9', 'milestones are checked at the end of every turn for every player, not only the active one', () => {
    const s = milestoneGame(['MS9']);
    setTrain(s, 1, [['crew', null], [null, null]]);
    s.players[1].train.storageCarriages = 3;
    const ev = idleTurn(s); // Anna's turn
    assert.equal(s.modules.milestones.claimedBy.MS9, 1);
    assert.deepEqual(vpBySource(ev, 1), { milestones: 5 });
  });
  check('R16.9/several', 'if several players meet a condition the active player claims it if among them, otherwise the first of them in turn order after the active player', () => {
    const ready = (s, pid) => {
      setTrain(s, pid, [['crew', null], [null, null]]);
      s.players[pid].train.storageCarriages = 3;
    };
    const a = milestoneGame(['MS9'], 4);
    idleTurn(a);
    idleTurn(a); // Cara (seat 3) is active
    ready(a, 0);
    ready(a, 3);
    idleTurn(a);
    assert.equal(a.modules.milestones.claimedBy.MS9, 3, 'Dev comes before Anna in turn order after Cara');
    const b = milestoneGame(['MS9'], 4);
    idleTurn(b);
    idleTurn(b);
    ready(b, 1);
    ready(b, 2);
    ready(b, 3);
    idleTurn(b);
    assert.equal(b.modules.milestones.claimedBy.MS9, 2, 'the active player is among them');
  });
  check('R16.9/many', 'a player may claim several tiles in one check', () => {
    const s = milestoneGame(['MS5', 'MS8', 'MS9']);
    R16_8.MS5[1](s);
    setTrain(s, 0, [['crew', 'miner'], ['engineer', 'financier']]);
    s.players[0].train.storageCarriages = 3;
    const ev = idleTurn(s);
    assert.deepEqual(s.modules.milestones.claimedBy, { MS5: 0, MS8: 0, MS9: 0 });
    assert.deepEqual(vpBySource(ev, 0), { milestones: 5 + 6 + 5 });
  });

  // ----- R17 -----------------------------------------------------------------
  check('R17.1', 'one card stays in force for the whole game and changes a rule for every player equally', () => {
    const s = game(2, legislative(16));
    for (let i = 0; i < 6; i++) idleTurn(s);
    assert.equal(s.modules.legislative.card, 'LA16');
    for (const pid of [0, 1]) {
      const t = game(2, legislative(16));
      if (pid === 1) idleTurn(t);
      setHeads(t, pid, 'POR', 'OMA');
      give(t, pid, { tiles: { bridge: 2 } });
      const ev = placeAndChoose(t, 'W4', 'D5');
      if (offered(t, 'claimRoute', { route: 'POR-SPO' })) ev.push(...act(t, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
      ev.push(...act(t, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }));
      assert.equal(vpBySource(ev, pid).legislative, 3);
    }
  });
  check('R17.2', 'the deck has 20 cards', () => {
    assert.deepEqual(RULES.LEGISLATIVE_CARDS.map((c) => c.number), Array.from({ length: 20 }, (_, i) => i + 1));
  });
  for (const [n, terrain, perRoute] of [[1, 'tunnel', { 'BOI-SPO': 2, 'POR-SPO': 0 }], [2, 'bridge', { 'BOI-SPO': 0, 'POR-SPO': 2 }], [3, 'ground', { 'BOI-SPO': 1, 'POR-SPO': 0 }]]) {
    check(`R17.3/${n}`, `card ${n}: each ${terrain} slot laid scores +1 VP`, () => {
      for (const [route, from] of [['BOI-SPO', 'SPO'], ['POR-SPO', 'SPO']]) {
        const s = layGame('SPO', 'MIN', legislative(n));
        claim(s, 1, 'SEA-SPO', 'HEL-BOI'); // no first connection either way
        const ev = claimNow(s, route, from);
        const vp = vpBySource(ev, 0);
        assert.equal(vp.track, MAP.routeById[route].length, 'the base stays 1 VP per slot');
        assert.equal(vp.legislative ?? 0, perRoute[route], route);
      }
    });
  }
  check('R17.3/4', 'card 4: the completion bonus is 10 VP higher', () => {
    const s = layGame('HEL', 'OMA', legislative(4));
    claim(s, 0, 'SEA-HEL', 'BIS-MIN');
    const ev = claimNow(s, 'HEL-BIS', 'HEL');
    const vp = vpBySource(ev, 0);
    assert.deepEqual([vp.completion, vp.legislative], [25 + 3 * 4, 10]);
  });
  check('R17.3/5', 'card 5: 3 VP when the slots laid in one Lay Tracks action include at least 2 different terrains; a single mixed route qualifies', () => {
    const run = (route, from, west) => {
      const s = layGame(west, 'MIN', legislative(5));
      const ev = claimNow(s, route, from);
      ev.push(...finishTurn(s));
      return vpBySource(ev, 0).legislative ?? 0;
    };
    assert.equal(run('BOI-SPO', 'SPO', 'SPO'), 3);
    assert.equal(run('POR-SPO', 'POR', 'POR'), 0);
    const s = layGame('POR', 'MIN', legislative(5));
    put(s, 0, 'W6'); // M = 2
    const ev = lay(s);
    ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    ev.push(...act(s, { type: 'skipBuilding' }));
    ev.push(...act(s, { type: 'claimRoute', route: 'SEA-SPO', from: 'SPO' }));
    ev.push(...finishTurn(s));
    assert.equal(vpBySource(ev, 0).legislative, 3, 'Bridge and Ground across two routes of one action, scored once');
  });
  check('R17.3/6', 'card 6: 5 VP when 5 or more slots are laid in one Lay Tracks action; a single 5-slot route qualifies', () => {
    const run = (route, from, west) => {
      const s = layGame(west, 'MIN', legislative(6));
      const ev = claimNow(s, route, from);
      ev.push(...finishTurn(s));
      return vpBySource(ev, 0).legislative ?? 0;
    };
    assert.equal(run('SEA-HEL', 'SEA', 'SEA'), 5);
    assert.equal(run('HEL-BIS', 'HEL', 'HEL'), 0, '4 slots');
  });
  check('R17.3/7', 'card 7: 5 VP for placing a building in a city that already holds another player\'s building', () => {
    const run = (setup) => {
      const s = layGame('POR', 'MIN', legislative(7));
      setup(s);
      claimNow(s, 'POR-SPO', 'POR');
      return vpBySource(act(s, { type: 'placeTelegraphStation', city: 'SPO' }), 0).legislative ?? 0;
    };
    assert.equal(run((s) => building(s, 1, 'railwayStation', 'SPO')), 5);
    assert.equal(run(() => {}), 0);
    assert.equal(run((s) => building(s, 0, 'railwayStation', 'SPO')), 0, 'your own building does not count');
  });
  check('R17.3/8', 'card 8: 2 VP for placing a building in a junction city, every time', () => {
    const s = layGame('POR', 'MIN', legislative(8));
    claimNow(s, 'POR-SPO', 'POR');
    assert.equal(vpBySource(act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), 0).legislative, 2);
    idleTurn(s);
    setHeads(s, 0, 'SEA', 'MIN');
    choose(s, act(s, { type: 'removeWorker', from: 'W4' }), 'D5');
    if (offered(s, 'claimRoute', { route: 'SEA-SPO' })) act(s, { type: 'claimRoute', route: 'SEA-SPO', from: 'SEA' });
    assert.equal(vpBySource(act(s, { type: 'placeTelegraphStation', city: 'SPO' }), 0).legislative, 2, 'not a single first-come prize');
    const t = layGame('LAX', 'MIN', legislative(8));
    t.players[0].railheads = ['FRE', 'MIN'];
    claimNow(t, 'LVG-FRE', 'FRE');
    assert.equal(vpBySource(act(t, { type: 'placeTelegraphStation', city: 'LVG' }), 0).legislative ?? 0, 0, 'Las Vegas is not a junction city');
  });
  check('R17.3/9', 'card 9: a first connection scores +3 VP (8 instead of 5)', () => {
    const s = layGame('POR', 'MIN', legislative(9));
    const vp = vpBySource(claimNow(s, 'POR-SPO', 'POR'), 0);
    assert.deepEqual([vp.firstConnection, vp.legislative], [5, 3]);
  });
  check('R17.3/10', 'card 10: the first player to have 5 buildings on the map gains 10 VP at once; once per game', () => {
    const s = layGame('POR', 'MIN', legislative(10));
    for (const c of ['BOI', 'REN']) building(s, 0, 'railwayStation', c);
    for (const c of ['BOI', 'REN']) building(s, 0, 'telegraphStation', c);
    for (const c of ['HEL', 'BIL']) building(s, 1, 'railwayStation', c);
    for (const c of ['HEL', 'BIL']) building(s, 1, 'telegraphStation', c);
    claimNow(s, 'POR-SPO', 'POR');
    assert.equal(vpBySource(act(s, { type: 'placeTelegraphStation', city: 'SPO' }), 0).legislative, 10);
    setHeads(s, 1, 'SEA', 'OMA');
    give(s, 1, { tiles: { ground: 2 } });
    const ev = placeAndChoose(s, 'W6', 'D5');
    if (offered(s, 'claimRoute')) ev.push(...act(s, { type: 'claimRoute', route: 'SEA-SPO', from: 'SEA' }));
    ev.push(...act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'coins' }));
    assert.deepEqual(vpBySource(ev, 1), { track: 2 }, 'Ben reaches 5 buildings second and gets nothing');
    const four = layGame('POR', 'MIN', legislative(10));
    for (const c of ['BOI', 'REN', 'HEL']) building(four, 0, 'telegraphStation', c);
    claimNow(four, 'POR-SPO', 'POR');
    assert.equal(vpBySource(act(four, { type: 'placeTelegraphStation', city: 'SPO' }), 0).legislative ?? 0, 0, 'the fourth building is not the fifth');
  });
  for (const [n, district, item] of [[11, 'D3', 'iron'], [12, 'D7', 'wood'], [13, 'D1', 'gunpowder'], [14, 'D9', 'coins']]) {
    check(`R17.3/${n}`, `card ${n}: each Gather ${item} action gives +1, flat`, () => {
      const s = game(2, legislative(n));
      give(s, 0, { resources: {}, coins: 0 });
      goTo(s, district);
      assert.equal(held(s.players[0])[item], production(s, 0, item) + 1);
    });
  }
  check('R17.3/15', 'card 15: placing a telegraph station gains 3 VP as well as the telegraph row VP', () => {
    const s = layGame('POR', 'MIN', legislative(15));
    s.players[0].telegraphsPlaced = 3;
    claimNow(s, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(act(s, { type: 'placeTelegraphStation', city: 'SPO' }), 0), { telegraph: 4, legislative: 3 });
    const t = layGame('POR', 'MIN', legislative(15));
    claimNow(t, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(act(t, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), 0), {});
  });
  check('R17.3/16', 'card 16: placing a railway station gains 3 VP', () => {
    const s = layGame('POR', 'MIN', legislative(16));
    claimNow(s, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' }), 0), { legislative: 3 });
    const t = layGame('POR', 'MIN', legislative(16));
    claimNow(t, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(act(t, { type: 'placeTelegraphStation', city: 'SPO' }), 0), { telegraph: 1 });
  });
  check('R17.3/17', 'card 17: placing a railway station gains 2 resources of your choice', () => {
    const s = layGame('POR', 'MIN', legislative(17));
    claimNow(s, 'POR-SPO', 'POR');
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.equal(kind(s), 'chooseResource');
    assert.equal(takeChoices(s), 2);
    assert.equal(stored(s.players[0]), 2);
    const t = layGame('POR', 'MIN', legislative(17));
    claimNow(t, 'POR-SPO', 'POR');
    act(t, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.notEqual(kind(t), 'chooseResource');
  });
  check('R17.3/18', 'card 18: hiring with the Hire Specialist bonus action gains 1 resource of your choice; not for hires made by cards', () => {
    const s = game(2, { ...legislative(18), hireCostModel: 'fee-only' });
    placeAndChoose(s, 'W2', 'D3');
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.equal(kind(s), 'chooseResource');
    assert.equal(takeChoices(s), 1);
    const { s: t } = buyer('PX6', null, legislative(18));
    act(t, { type: 'hireSpecialist', specialist: 'miner' });
    assert.notEqual(kind(t), 'chooseResource');
  });
  check('R17.3/19', 'card 19: adding a carriage with the Add Carriage bonus action gains 2 resources of your choice; not for Congress entry C4', () => {
    const s = game(2, legislative(19));
    placeAndChoose(s, 'W12', 'D9');
    act(s, { type: 'addCarriage', carriage: 'storage' });
    assert.equal(kind(s), 'chooseResource');
    assert.equal(takeChoices(s), 2);
    const c = lobbyGame(legislative(19));
    c.players[0].train.storageCarriages = 2;
    waitLobby(c, 2);
    act(c, { type: 'takeCongressEntry', entry: 'C4' });
    act(c, { type: 'addCarriage', carriage: 'storage' });
    assert.notEqual(kind(c), 'chooseResource');
  });
  check('R17.3/20', 'card 20: once per train activation, right after taking a Congress entry, one other available entry of the same tier may be taken free; Reset counts as tier 1', () => {
    const s = lobbyGame(legislative(20));
    act(s, { type: 'takeCongressEntry', entry: 'C1' });
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C2', 'CR'], 'the other tier 1 entries; C1 itself is used');
    assert.ok(getValidActions(s).some((a) => a.type !== 'takeCongressEntry'), 'it is optional');
    const coins = s.players[0].coins;
    act(s, { type: 'takeCongressEntry', entry: 'C2' });
    assert.equal(s.players[0].coins, coins, 'no Coins');
    assert.deepEqual(held(s.players[0]), { iron: 2, wood: 2, gunpowder: 0, coins: 19 });
    assert.deepEqual([s.congress.used.C1, s.congress.used.C2], [true, true]);
    waitLobby(s, 2); // the free entry cost no lobby point: Foreman 1 - 1 = 0, then two more Financier steps
    act(s, { type: 'takeCongressEntry', entry: 'C3' });
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'C4' }) || topFrame(s).kind === 'trainActivation', 'only once per train activation');
    assert.equal(s.congress.used.C4, false);
    assert.equal(s.players[0].coins, 17);
    // a tier 2 entry gives a free tier 2 entry, not a tier 1 or 3
    const t = lobbyGame(legislative(20));
    t.players[0].train.storageCarriages = 2;
    waitLobby(t, 2);
    act(t, { type: 'takeCongressEntry', entry: 'C3' });
    assert.deepEqual(offers(t, 'takeCongressEntry').map((a) => a.entry), ['C4']);
  });

  // ----- R18 -----------------------------------------------------------------
  check('R18.1', 'module off: no tokens, no cards, no market; a first connection still scores its VP', () => {
    const s = layGame();
    assert.equal(s.modules.pony, undefined);
    assert.deepEqual(vpBySource(claimNow(s, 'POR-SPO', 'POR'), 0), { track: 2, firstConnection: 5 });
  });
  check('R18.2', 'setup: a token on each inland city and 2 cards face up from each of the three decks', () => {
    const s = game(2, PONY);
    assert.equal(Object.keys(s.modules.pony.tokens).length, 17);
    assert.deepEqual(['A', 'B', 'C'].map((r) => s.modules.pony.market[r].filter(Boolean).length), [2, 2, 2]);
  });
  check('R18.3', 'the player who makes the first connection to an inland city takes its token; held and collected are counted separately', () => {
    const s = layGame('POR', 'MIN', PONY);
    claimNow(s, 'POR-SPO', 'POR');
    finishTurn(s);
    assert.deepEqual([s.modules.pony.players[0].tokensHeld, s.modules.pony.players[0].tokensCollected], [1, 1]);
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'exchangeToken', resource: 'iron' });
    assert.deepEqual([s.modules.pony.players[0].tokensHeld, s.modules.pony.players[0].tokensCollected], [0, 1]);
    // a later claim into the same city finds no token
    const t = layGame('SEA', 'MIN', PONY);
    claim(t, 1, 'POR-SPO');
    t.modules.pony.tokens.SPO = false;
    claimNow(t, 'SEA-SPO', 'SEA');
    assert.equal(t.modules.pony.players[0].tokensHeld, 0);
  });
  check('R18.4', 'as a free action the active player returns 1 held token and gains 1 resource of choice into storage', () => {
    const s = game(2, PONY);
    giveTokens(s, 1, 2);
    idleTurn(s);
    assert.deepEqual(sorted(offers(s, 'exchangeToken').map((a) => a.resource)), ['gunpowder', 'iron', 'wood']);
    act(s, { type: 'exchangeToken', resource: 'gunpowder' });
    assert.equal(s.players[1].resources.gunpowder, 2);
    assert.equal(s.modules.pony.players[1].tokensHeld, 1);
    refused(s, { type: 'exchangeToken', resource: 'coins' });
  });
  check('R18.5.1', 'only a face-up card can be bought', () => {
    const s = game(2, PONY);
    giveTokens(s, 1, 9);
    idleTurn(s);
    const faceUp = sorted(['A', 'B', 'C'].flatMap((r) => s.modules.pony.market[r]));
    const buyable = offers(s, 'buyPonyCard').map((a) => a.card);
    assert.ok(buyable.length > 0 && buyable.every((c) => faceUp.includes(c)));
    refused(s, { type: 'buyPonyCard', card: s.modules.pony.decks.A[0] });
  });
  check('R18.5.2', 'a card costs tokens by rank: A 2, B 3, C 5', () => {
    for (const [card, cost] of [['PX7', 2], ['PX18', 3], ['PX38', 5]]) {
      const { s } = buyer(card, null, {}, cost);
      assert.equal(s.modules.pony.players[1].tokensHeld, 0, card);
      const t = game(2, PONY);
      stock(t, card);
      giveTokens(t, 1, cost - 1);
      idleTurn(t);
      assert.ok(!offered(t, 'buyPonyCard', { card }), `${card} with ${cost - 1} tokens`);
    }
  });
  check('R18.5.4', 'the empty market place is refilled from the deck of the same rank; if that deck is empty it stays empty', () => {
    const s = game(2, PONY);
    stock(s, 'PX7');
    giveTokens(s, 1, 4);
    const next = s.modules.pony.decks.A[s.modules.pony.decks.A.length - 1];
    idleTurn(s);
    act(s, { type: 'buyPonyCard', card: 'PX7' });
    assert.ok(s.modules.pony.market.A.includes(next));
    assert.ok(!s.modules.pony.market.A.includes('PX7'));
    const t = game(2, PONY);
    stock(t, 'PX7');
    giveTokens(t, 1, 4);
    t.modules.pony.decks.A = [];
    idleTurn(t);
    act(t, { type: 'buyPonyCard', card: 'PX7' });
    assert.equal(t.modules.pony.market.A.filter((c) => c === null).length, 1);
  });
  check('R18.6', 'immediate: resolved and discarded; ongoing: kept, lasting from now; endgame: kept for final scoring', () => {
    const a = buyer('PX7').s;
    assert.deepEqual([a.modules.pony.players[1].ongoing, a.modules.pony.players[1].endgame], [[], []]);
    const b = buyer('PX21').s;
    assert.deepEqual(b.modules.pony.players[1].ongoing, ['PX21']);
    const c = buyer('PX38').s;
    assert.deepEqual(c.modules.pony.players[1].endgame, ['PX38']);
  });
  check('R18.6/cap', 'at most ponyOngoingCap ongoing cards (default 2; 0 = no cap); endgame cards do not count', () => {
    const blocked = (variants) => {
      const s = game(2, { ...PONY, ...variants });
      ownCard(s, 1, 'PX21');
      ownCard(s, 1, 'PX29');
      stock(s, 'PX36');
      stock(s, 'PX38', 1);
      giveTokens(s, 1, 10);
      idleTurn(s);
      return [offered(s, 'buyPonyCard', { card: 'PX36' }), offered(s, 'buyPonyCard', { card: 'PX38' })];
    };
    assert.deepEqual(blocked({}), [false, true]);
    assert.deepEqual(blocked({ ponyOngoingCap: 0 }), [true, true]);
    assert.deepEqual(blocked({ ponyOngoingCap: 3 }), [true, true]);
    const one = game(2, { ...PONY, ponyOngoingCap: 1 });
    ownCard(one, 1, 'PX21');
    stock(one, 'PX36');
    giveTokens(one, 1, 10);
    idleTurn(one);
    assert.ok(!offered(one, 'buyPonyCard', { card: 'PX36' }));
  });
  check('R18.6/none', 'an immediate card of which no part can be carried out cannot be bought', () => {
    const s = game(2, PONY);
    stock(s, 'PX2');
    giveTokens(s, 1, 5);
    s.players[1].train.storageCarriages = 3;
    idleTurn(s);
    assert.ok(!offered(s, 'buyPonyCard', { card: 'PX2' }));
    refused(s, { type: 'buyPonyCard', card: 'PX2' });
  });

  // R18.7, the 38 cards.
  check('R18.7/1', 'card 1 Fresh Horses: gain 3 resources of your choice', () => {
    const { s } = buyer('PX1');
    const before = stored(s.players[1]);
    assert.equal(takeChoices(s), 3);
    assert.equal(stored(s.players[1]), before + 3);
  });
  check('R18.7/2', 'card 2 Saddle Bags: add 1 storage carriage for free', () => {
    const { s } = buyer('PX2');
    assert.equal(s.players[1].train.storageCarriages, 2);
    assert.deepEqual(held(s.players[1]), { iron: 1, wood: 1, gunpowder: 1, coins: 1 });
  });
  check('R18.7/3', 'card 3 Swift Passage: up to 2 Move Train steps now', () => {
    const prep = (s) => {
      setHeads(s, 1, 'POR', 'OMA');
      claim(s, 0, 'POR-SPO', 'HEL-SPO', 'HEL-BIL');
    };
    const { s } = buyer('PX3', prep);
    assert.equal(kind(s), 'layTracks');
    assert.ok(getValidActions(s).every((a) => a.type === 'moveTrain'), 'moves only, and at least one');
    act(s, { type: 'moveTrain', from: 'POR', to: 'SPO' });
    assert.ok(offered(s, 'stopLaying'), '"up to" 2');
    act(s, { type: 'moveTrain', from: 'SPO', to: 'BIL' });
    assert.notEqual(kind(s), 'layTracks', 'two steps and no more');
    assert.equal(s.players[1].railheads[0], 'BIL');
    assert.equal(s.turn.player, 1, 'the turn goes on');
  });
  check('R18.7/4', 'card 4 Frontier Scout: 2 built track tiles of two different types', () => {
    const { s } = buyer('PX4');
    assert.equal(kind(s), 'chooseBuiltTile');
    act(s, { type: 'chooseBuiltTile', terrain: 'tunnel' });
    assert.deepEqual(sorted(getValidActions(s).map((a) => a.terrain)), ['bridge', 'ground']);
    refused(s, { type: 'chooseBuiltTile', terrain: 'tunnel' });
    act(s, { type: 'chooseBuiltTile', terrain: 'ground' });
    assert.deepEqual(s.players[1].builtTiles, { ground: 1, tunnel: 1, bridge: 0 });
  });
  check('R18.7/5', 'card 5 Quick Route: 1 claim step now, a Lay Tracks action of its own for whole-action bonuses', () => {
    const prep = (s) => {
      setHeads(s, 1, 'SEA', 'OMA');
      give(s, 1, { tiles: { bridge: 1, tunnel: 4, ground: 2 }, resources: {} });
    };
    const { s, ev } = buyer('PX5', prep, legislative(6));
    assert.ok(getValidActions(s).every((a) => a.type === 'claimRoute'), 'a claim, not a move');
    ev.push(...act(s, { type: 'claimRoute', route: 'SEA-HEL', from: 'SEA' }));
    ev.push(...act(s, { type: 'skipBuilding' }));
    assert.deepEqual(vpBySource(ev, 1), { track: 5, firstConnection: 5, legislative: 5 }, 'the 5-slot bonus is scored when the card\'s own action ends');
    assert.equal(s.turn.player, 1);
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    assert.equal(kind(s), 'workerStep', 'the turn\'s own worker step is still to come');
  });
  check('R18.7/6', 'card 6 Frontier Recruitment: hire 1 specialist for free', () => {
    const { s } = buyer('PX6');
    assert.equal(kind(s), 'hireSpecialist');
    assert.ok(getValidActions(s).every((a) => a.type === 'hireSpecialist'), 'the hire is not optional');
    act(s, { type: 'hireSpecialist', specialist: 'engineer' });
    assert.deepEqual(s.players[1].train.specialistCarriages[0].slots, ['crew', 'engineer']);
    assert.deepEqual(held(s.players[1]), { iron: 1, wood: 1, gunpowder: 1, coins: 1 });
  });
  check('R18.7/7', 'card 7 Mail Delivery Contract: gain 5 VP', () => {
    const { ev } = buyer('PX7');
    assert.deepEqual(vpBySource(ev, 1), { ponyCards: 5 });
  });
  for (const n of [8, 23]) {
    check(`R18.7/${n}`, `card ${n} Versatile Rider: choose one of 2 built tiles of choice, 3 resources of choice, or 1 cowboy hat`, () => {
      const pick = (find) => {
        const { s } = buyer(`PX${n}`);
        assert.equal(kind(s), 'chooseOption');
        assert.equal(getValidActions(s).length, 3);
        act(s, { type: 'chooseOption', option: topFrame(s).options.findIndex((o) => o.effects.some(find)) });
        const asked = takeChoices(s);
        const p = s.players[1];
        return [tilesOf(p), stored(p) - 3, p.hats, asked];
      };
      assert.deepEqual(pick((e) => e.type === 'gainBuiltTilesChoice'), [2, 0, 0, 2]);
      assert.deepEqual(pick((e) => e.type === 'gainChoice'), [0, 3, 0, 3]);
      assert.deepEqual(pick((e) => e.type === 'gain'), [0, 0, 1, 0]);
    });
  }
  check('R18.7/9', 'card 9 Rapid Expansion: add 1 carriage of choice for free and hire 1 specialist for its hire cost without the fee; either order; either part may be skipped', () => {
    const { s } = buyer('PX9');
    assert.equal(kind(s), 'chooseOption');
    assert.equal(getValidActions(s).length, 2, 'either order');
    const hireFirst = topFrame(s).options.findIndex((o) => o.effects[0].type === 'hire');
    act(s, { type: 'chooseOption', option: hireFirst });
    assert.equal(kind(s), 'hireSpecialist');
    assert.ok(offered(s, 'skipEffect'));
    act(s, { type: 'hireSpecialist', specialist: 'crew' }); // level 1: 1 Iron + 1 Gunpowder, no Coin
    assert.deepEqual(held(s.players[1]), { iron: 0, wood: 1, gunpowder: 0, coins: 1 });
    assert.equal(kind(s), 'addCarriage');
    assert.ok(offered(s, 'skipEffect'));
    act(s, { type: 'addCarriage', carriage: 'specialist' });
    assert.equal(s.players[1].train.specialistCarriages.length, 2);
    assert.equal(s.players[1].resources.wood, 1, 'the carriage is free');
    const t = buyer('PX9').s;
    act(t, { type: 'chooseOption', option: 0 });
    act(t, { type: 'skipEffect' });
    act(t, { type: 'skipEffect' });
    assert.equal(kind(t) === 'hireSpecialist' || kind(t) === 'addCarriage', false, 'both parts skipped');
  });
  for (const n of [10, 22]) {
    check(`R18.7/${n}`, `card ${n} Double Time: activate your train now with M = 1; you choose the Foreman's type`, () => {
      const prep = (s) => {
        give(s, 1, { resources: { gunpowder: 4 }, coins: 0 });
        put(s, 1, 'D8'); // a worker of Ben's next to Tunnel Tracks: irrelevant, M is 1 for a card
        s.grid.centres.D8 = null;
        s.players[1].workersInSupply += 1;
      };
      const { s, ev } = buyer(`PX${n}`, prep);
      assert.equal(kind(s), 'chooseForemanType');
      assert.deepEqual(sorted(getValidActions(s).map((a) => a.specialist)), ['crew', 'engineer', 'financier', 'miner']);
      ev.push(...act(s, { type: 'chooseForemanType', specialist: 'miner' }));
      assert.equal(eventOf(ev, 'trainActivation').steps, 2, 'the Foreman once, the Crew once');
      ev.push(...act(s, { type: 'useStep' }));
      assert.equal(s.players[1].builtTiles.tunnel, 1);
      assert.equal(s.turn.player, 1);
    });
  }
  check('R18.7/11', 'card 11 Frontier Trade: return up to 3 resources and gain the same number of your choice', () => {
    const { s } = buyer('PX11', (x) => give(x, 1, { resources: { iron: 4 } }));
    assert.equal(kind(s), 'exchange');
    act(s, { type: 'returnResource', resource: 'iron' });
    act(s, { type: 'returnResource', resource: 'iron' });
    assert.ok(offered(s, 'skipEffect'), '"up to" 3');
    act(s, { type: 'returnResource', resource: 'iron' });
    assert.equal(kind(s), 'chooseResource', 'three is the most');
    for (let i = 0; i < 3; i++) act(s, { type: 'chooseResource', resource: 'wood' });
    assert.deepEqual(s.players[1].resources, { iron: 1, wood: 3, gunpowder: 0 });
    assert.notEqual(kind(s), 'chooseResource');
    const two = buyer('PX11', (x) => give(x, 1, { resources: { iron: 4 } })).s;
    act(two, { type: 'returnResource', resource: 'iron' });
    act(two, { type: 'skipEffect' });
    assert.equal(takeChoices(two), 1);
  });
  check('R18.7/12', 'card 12 Frontier Legend: 1 VP for each inland city that is an end of a route you own', () => {
    const { ev } = buyer('PX12', (s) => {
      claim(s, 1, 'POR-SPO', 'SPO-REN', 'SEA-SPO'); // inland ends: Spokane, Reno
      claim(s, 0, 'BOI-SPO');
    });
    assert.deepEqual(vpBySource(ev, 1), { ponyCards: 2 });
  });
  for (const n of [13, 24]) {
    check(`R18.7/${n}`, `card ${n} Congressional Courier: take up to 2 available tier 1 Congress entries without lobby points or Coins`, () => {
      const { s, ev } = buyer(`PX${n}`, (x) => { x.congress.used.C1 = true; x.congress.used.C5 = true; give(x, 1, { coins: 0, resources: {} }); });
      assert.equal(kind(s), 'freeCongress');
      assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C2', 'CR'], 'tier 1, available');
      assert.ok(offered(s, 'skipEffect'), '"up to" 2');
      ev.push(...act(s, { type: 'takeCongressEntry', entry: 'C2' }));
      assert.equal(s.players[1].resources.iron, 2);
      ev.push(...act(s, { type: 'takeCongressEntry', entry: 'CR' }));
      assert.deepEqual(vpBySource(ev, 1), { congress: 3 }, 'Reset returns C1, C2 and C5');
      assert.notEqual(kind(s), 'freeCongress', 'two entries and no more');
      assert.equal(s.players[1].coins, 0);
    });
  }
  check('R18.7/14', 'card 14 Overland Route: once per turn, in a free-action window, 1 Move Train step', () => {
    const s = game(2, PONY);
    ownCard(s, 1, 'PX14');
    setHeads(s, 1, 'POR', 'OMA');
    claim(s, 0, 'POR-SPO', 'HEL-SPO');
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'usePonyCard', card: 'PX14' });
    act(s, { type: 'moveTrain', from: 'POR', to: 'HEL' });
    assert.equal(s.players[1].railheads[0], 'HEL');
    assert.notEqual(kind(s), 'layTracks', 'one step');
    assert.ok(!offered(s, 'usePonyCard', { card: 'PX14' }));
  });
  check('R18.7/15', 'card 15 Pioneer\'s Knowledge: at the start of each activation one chosen specialist (not the Foreman) is activated 1 extra time', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX15');
    setTrain(s, 0, [['crew', 'engineer']]);
    give(s, 0, { resources: { iron: 6, wood: 3 } });
    const ev = placeAndChoose(s, 'W6', 'D4');
    assert.equal(kind(s), 'chooseExtraActivation');
    assert.deepEqual(sorted(getValidActions(s).map((a) => `${a.level}.${a.slot}`)), ['1.1', '1.2']);
    ev.push(...act(s, { type: 'chooseExtraActivation', level: 1, slot: 1 }));
    while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
    assert.deepEqual(eventsOf(ev, 'build').map((e) => `${e.level}:${e.terrain}`), ['0:ground', '1:ground', '1:ground', '1:bridge']);
  });
  check('R18.7/16', 'card 16 Express Mail Contract: placing a telegraph station gains 2 resources of your choice', () => {
    const s = layGame('POR', 'MIN', PONY);
    ownCard(s, 0, 'PX16');
    claimNow(s, 'POR-SPO', 'POR');
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(takeChoices(s), 2);
    const t = layGame('POR', 'MIN', PONY);
    ownCard(t, 0, 'PX16');
    claimNow(t, 'POR-SPO', 'POR');
    act(t, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.notEqual(kind(t), 'chooseResource');
  });
  check('R18.7/17', 'card 17 Frontier Expansion: add 1 specialist carriage and 1 storage carriage for free, each only if under its limit', () => {
    const { s } = buyer('PX17');
    assert.deepEqual([s.players[1].train.specialistCarriages.length, s.players[1].train.storageCarriages], [2, 2]);
    assert.equal(s.players[1].resources.wood, 1);
    const { s: t } = buyer('PX17', (x) => setTrain(x, 1, [['crew', null], [null, null], [null, null]]));
    assert.deepEqual([t.players[1].train.specialistCarriages.length, t.players[1].train.storageCarriages], [3, 2]);
  });
  check('R18.7/18', 'card 18 Bulk Shipment: gain 5 resources of your choice', () => {
    const { s } = buyer('PX18');
    assert.equal(takeChoices(s), 5);
    assert.equal(stored(s.players[1]), 8);
  });
  check('R18.7/19', 'card 19 Track Stockpile: gain 3 built track tiles of your choice', () => {
    const { s } = buyer('PX19');
    for (let i = 0; i < 3; i++) act(s, { type: 'chooseBuiltTile', terrain: 'bridge' });
    assert.deepEqual(s.players[1].builtTiles, { ground: 0, tunnel: 0, bridge: 3 });
    assert.notEqual(kind(s), 'chooseBuiltTile');
  });
  check('R18.7/20', 'card 20 Congressional Favor: the first Congress entry of each activation costs 1 Coin less, not below 0', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX20');
    setTrain(s, 0, [['financier', 'financier'], ['financier', null]]);
    give(s, 0, { coins: 10, resources: {} });
    placeAndChoose(s, 'W1', 'D2');
    waitLobby(s, 2);
    act(s, { type: 'takeCongressEntry', entry: 'C3' });
    assert.equal(s.players[0].coins, 9, 'tier 2 for 1 Coin');
    waitLobby(s, 1);
    act(s, { type: 'takeCongressEntry', entry: 'C1' });
    assert.equal(s.players[0].coins, 8, 'the second entry costs its full Coin');
    const t = game(2, PONY);
    ownCard(t, 0, 'PX20');
    setTrain(t, 0, [[null, null]]);
    give(t, 0, { coins: 0, resources: {} });
    placeAndChoose(t, 'W1', 'D2');
    assert.ok(offered(t, 'takeCongressEntry', { entry: 'C1' }), 'a tier 1 entry for 0 Coins');
    act(t, { type: 'takeCongressEntry', entry: 'C1' });
    assert.equal(t.players[0].coins, 0);
  });
  check('R18.7/21', 'card 21 Efficient Operations: each of your Gather actions gives +1 of what you gathered, added after multiplying', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX21');
    put(s, 0, 'W10');
    placeAndChoose(s, 'W12', 'D9'); // Coins: P 1 x M 2 + 1
    assert.equal(s.players[0].coins, 1 + 3);
    act(s, { type: 'skipBonusAction' });
    give(s, 1, { resources: {} });
    goTo(s, 'D7');
    assert.equal(s.players[1].resources.wood, 1, 'the owner only');
  });
  check('R18.7/25', 'card 25 Transcontinental Express: +10 VP if you complete the transcontinental line', () => {
    const s = layGame('HEL', 'OMA', PONY);
    ownCard(s, 0, 'PX25');
    claim(s, 0, 'SEA-HEL', 'BIS-MIN');
    s.modules.pony.tokens.BIS = false;
    const vp = vpBySource(claimNow(s, 'HEL-BIS', 'HEL'), 0);
    assert.deepEqual([vp.completion, vp.ponyCards], [37, 10]);
  });
  check('R18.7/26', 'card 26 Master Network: tolls paid to you are 5 VP instead of 3', () => {
    const s = layGame('POR', 'MIN', PONY);
    ownCard(s, 1, 'PX26');
    building(s, 1, 'railwayStation', 'SPO');
    const ev = claimNow(s, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(ev, 1), { toll: 3, ponyCards: 2 });
    const mine = layGame('POR', 'MIN', { ...PONY }, 3);
    ownCard(mine, 0, 'PX26'); // the mover owns the card: the station owner still gets 3
    building(mine, 1, 'railwayStation', 'SPO');
    assert.deepEqual(vpBySource(claimNow(mine, 'POR-SPO', 'POR'), 1), { toll: 3 });
  });
  check('R18.7/27', 'card 27 Experienced Crew: hire up to 2 specialists for free', () => {
    const { s } = buyer('PX27', (x) => setTrain(x, 1, [['crew', null], [null, null]]));
    act(s, { type: 'hireSpecialist', specialist: 'financier' });
    assert.ok(offered(s, 'skipEffect'), '"up to" 2');
    act(s, { type: 'hireSpecialist', specialist: 'financier' });
    assert.deepEqual(s.players[1].train.specialistCarriages.map((c) => c.slots), [['crew', 'financier'], ['financier', null]]);
    assert.deepEqual(held(s.players[1]), { iron: 1, wood: 1, gunpowder: 1, coins: 1 });
    assert.notEqual(kind(s), 'hireSpecialist');
  });
  check('R18.7/28', 'card 28 Frontier Mastery: once per turn any one bonus action without being at its district or paying its printed cost; a hire still pays its hire cost; outside bonusActionLimit', () => {
    const s = game(2, { ...PONY, bonusActionLimit: 'once-per-game' });
    ownCard(s, 1, 'PX28');
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'usePonyCard', card: 'PX28' });
    assert.deepEqual(sorted([...new Set(types(s))]), ['addCarriage', 'buyHat', 'hireSpecialist']);
    act(s, { type: 'buyHat' });
    assert.equal(s.players[1].hats, 1);
    assert.equal(s.players[1].resources.gunpowder, 1, 'no printed cost');
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    placeAndChoose(s, 'W11', 'D7');
    assert.ok(offered(s, 'buyHat'), 'the real Buy Hat is still unused in a once-per-game game');
    const t = game(2, PONY);
    ownCard(t, 1, 'PX28');
    idleTurn(t);
    act(t, { type: 'usePonyCard', card: 'PX28' });
    act(t, { type: 'hireSpecialist', specialist: 'crew' });
    assert.deepEqual(held(t.players[1]), { iron: 0, wood: 1, gunpowder: 0, coins: 1 }, 'the hire cost, not the 1-Coin fee');
  });
  check('R18.7/29', 'card 29 Rails and Riders: your first connections score +3 VP', () => {
    const s = layGame('POR', 'MIN', PONY);
    ownCard(s, 0, 'PX29');
    const vp = vpBySource(claimNow(s, 'POR-SPO', 'POR'), 0);
    assert.deepEqual([vp.firstConnection, vp.ponyCards], [5, 3]);
  });
  check('R18.7/30', 'card 30 Political Influence: Reset gives 2 VP per senator returned instead of 1', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX30');
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { coins: 1 });
    for (const id of ['C2', 'C4', 'C6']) s.congress.used[id] = true;
    const ev = placeAndChoose(s, 'W1', 'D2');
    if (offered(s, 'takeCongressEntry', { entry: 'CR' })) ev.push(...act(s, { type: 'takeCongressEntry', entry: 'CR' }));
    assert.deepEqual(vpBySource(ev, 0), { congress: 3, ponyCards: 3 });
  });
  check('R18.7/31', 'card 31 Territory Baron: at the end 5 VP for each city where you own both buildings; removed if bothBuildingsSameOwner is false', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX31');
    for (const c of ['SPO', 'BOI']) {
      building(s, 0, 'railwayStation', c);
      building(s, 0, 'telegraphStation', c);
    }
    building(s, 0, 'railwayStation', 'REN');
    building(s, 1, 'telegraphStation', 'REN');
    assert.equal(scoreGame(s).players[0].bySource.ponyEnd, 10);
    const off = game(2, { ...PONY, bothBuildingsSameOwner: false });
    const all = ['A', 'B', 'C'].flatMap((r) => [...off.modules.pony.market[r], ...off.modules.pony.decks[r]]);
    assert.ok(!all.includes('PX31'));
    assert.equal(all.length, 37);
  });
  check('R18.7/32', 'card 32 Master Engineer: you choose which of the four types your Foreman acts as', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX32');
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { resources: { wood: 2 } });
    placeAndChoose(s, 'W6', 'D4');
    assert.equal(kind(s), 'chooseForemanType');
    act(s, { type: 'chooseForemanType', specialist: 'engineer' });
    act(s, { type: 'useStep' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 1 });
  });
  check('R18.7/33', 'card 33 Specialist Mastery: until the end of this turn each specialist of one chosen type is activated twice as many times; the Foreman is not affected', () => {
    const prep = (s) => {
      setTrain(s, 1, [['crew', 'miner'], ['crew', null]]);
      s.players[1].train.storageCarriages = 3;
      give(s, 1, { resources: { iron: 20 } });
    };
    const { s } = buyer('PX33', prep);
    assert.equal(kind(s), 'chooseSpecialistType');
    assert.deepEqual(sorted(getValidActions(s).map((a) => a.specialist)), ['crew', 'miner'], 'a type in the train');
    act(s, { type: 'chooseSpecialistType', specialist: 'crew' });
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    const ev = placeAndChoose(s, 'W8', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 1) ev.push(...act(s, { type: 'useStep' }));
    assert.equal(s.players[1].builtTiles.ground, 1 + 2 + 4, 'Foreman 1, level 1 Crew 2, level 2 Crew 4');
    idleUntil(s, 1);
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    give(s, 1, { resources: { iron: 20 }, tiles: {} });
    const next = choose(s, act(s, { type: 'removeWorker', from: 'W8' }), 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 1) next.push(...act(s, { type: 'useStep' }));
    assert.equal(s.players[1].builtTiles.ground, 1 + 1 + 2, 'the next turn is back to normal');
  });
  check('R18.7/34', 'card 34 Telegraph Tycoon: the telegraph row VP of your placements are doubled', () => {
    const s = layGame('POR', 'MIN', PONY);
    ownCard(s, 0, 'PX34');
    s.players[0].telegraphsPlaced = 6;
    claimNow(s, 'POR-SPO', 'POR');
    assert.deepEqual(vpBySource(act(s, { type: 'placeTelegraphStation', city: 'SPO' }), 0), { telegraph: 9, ponyCards: 9 });
  });
  check('R18.7/35', 'card 35 Track Master: when your claim makes a first connection every slot of that route scores +3 VP', () => {
    const s = layGame('SPO', 'MIN', PONY);
    ownCard(s, 0, 'PX35');
    const vp = vpBySource(claimNow(s, 'BOI-SPO', 'SPO'), 0);
    assert.deepEqual([vp.track, vp.firstConnection, vp.ponyCards], [3, 5, 9]);
    const t = layGame('SPO', 'MIN', PONY);
    ownCard(t, 0, 'PX35');
    claim(t, 1, 'HEL-BOI');
    assert.equal(vpBySource(claimNow(t, 'BOI-SPO', 'SPO'), 0).ponyCards, undefined, 'no first connection, no bonus');
  });
  check('R18.7/36', 'card 36 Production Mastery: production is 1 higher on all four tracks', () => {
    const s = game(2, PONY);
    const before = ['wood', 'coins', 'iron', 'gunpowder'].map((t) => production(s, 0, t));
    ownCard(s, 0, 'PX36');
    assert.deepEqual(['wood', 'coins', 'iron', 'gunpowder'].map((t) => production(s, 0, t)), before.map((p) => p + 1));
    assert.deepEqual(['wood', 'coins', 'iron', 'gunpowder'].map((t) => production(s, 1, t)), before);
  });
  check('R18.7/37', 'card 37 Congressional Control: tier 1 entries cost you 0 Coins but still 1 lobby point', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX37');
    setTrain(s, 0, [['financier', 'financier']]);
    give(s, 0, { coins: 2, resources: {} });
    s.congress.used.C6 = true;
    placeAndChoose(s, 'W1', 'D2');
    assert.equal(topFrame(s).lobby, 1);
    act(s, { type: 'takeCongressEntry', entry: 'C1' });
    assert.equal(s.players[0].coins, 2);
    waitLobby(s, 1);
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'C3' }), 'the first entry did cost its lobby point');
    act(s, { type: 'takeCongressEntry', entry: 'CR' });
    assert.equal(s.players[0].coins, 2, 'Reset is a tier 1 entry');
    waitLobby(s, 1);
    act(s, { type: 'closeCongress' });
    assert.equal(s.players[0].coins, 2);
    const t = game(2, PONY);
    ownCard(t, 0, 'PX37');
    setTrain(t, 0, [['financier', null]]);
    give(t, 0, { coins: 1, resources: {} });
    placeAndChoose(t, 'W1', 'D2');
    waitLobby(t, 2);
    assert.ok(!offered(t, 'takeCongressEntry', { entry: 'C3' }), 'tier 2 still costs 2 Coins');
  });
  check('R18.7/38', 'card 38 Pony Express Legacy: at the end 3 VP for each token collected during the game, spent or not', () => {
    const s = game(2, PONY);
    ownCard(s, 0, 'PX38');
    giveTokens(s, 0, 1, 4);
    assert.equal(scoreGame(s).players[0].bySource.ponyEnd, 1 + 12);
  });
  check('R18.8', 'cards 14 and 28: once in each of the owner\'s turns, in either window, including the turn the card was bought', () => {
    const s = game(2, PONY);
    stock(s, 'PX28');
    giveTokens(s, 1, 6);
    idleTurn(s);
    act(s, { type: 'buyPonyCard', card: 'PX28' });
    assert.ok(offered(s, 'usePonyCard', { card: 'PX28' }), 'usable in the turn it was bought');
    act(s, { type: 'endFreeActions' });
    placeAndChoose(s, 'W12', 'D9');
    act(s, { type: 'skipBonusAction' });
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'usePonyCard', card: 'PX28' }); // in the second window
    act(s, { type: 'buyHat' });
    assert.ok(!offered(s, 'usePonyCard', { card: 'PX28' }), 'once per turn');
    if (s.turn.player === 1) finishTurn(s);
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    assert.ok(offered(s, 'usePonyCard', { card: 'PX28' }), 'again on the next turn');
  });
  check('R18.8/rounds', 'with turnStructure rounds the limit of cards 14 and 28 is once per round', () => {
    const s = game(2, { ...PONY, turnStructure: 'rounds' });
    ownCard(s, 1, 'PX28');
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    act(s, { type: 'usePonyCard', card: 'PX28' });
    act(s, { type: 'buyHat' });
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    playTurn(s, { type: 'placeWorker', space: 'W12' });
    idleTurn(s);
    assert.equal(s.turn.player, 1, 'a later turn of the same round');
    assert.ok(!offered(s, 'usePonyCard', { card: 'PX28' }));
    // play the round out: 6 workers each
    for (let i = 0; i < 40 && s.startPlayer === 0; i++) idleTurn(s);
    assert.equal(s.startPlayer, 1, 'a new round has begun');
    for (let i = 0; i < 3 && !(s.turn.player === 1 && kind(s) === 'freeActions'); i++) idleTurn(s);
    assert.ok(offered(s, 'usePonyCard', { card: 'PX28' }), 'usable again in the new round');
  });
  check('R18.9', 'ongoing cards apply to their owner only; two bonuses on the same event add up', () => {
    const s = layGame('POR', 'MIN', { ...PONY, ...legislative(9) });
    ownCard(s, 0, 'PX29');
    const vp = vpBySource(claimNow(s, 'POR-SPO', 'POR'), 0);
    assert.deepEqual([vp.firstConnection, vp.legislative, vp.ponyCards], [5, 3, 3]);
    const t = layGame('POR', 'MIN', PONY);
    ownCard(t, 1, 'PX29');
    assert.equal(vpBySource(claimNow(t, 'POR-SPO', 'POR'), 0).ponyCards, undefined, 'Ben\'s card does nothing for Anna');
  });
  check('R18.10', 'at the end of the game each token still held is worth 1 VP', () => {
    const s = game(2, { ...PONY, maxTurnsPerPlayer: 1 });
    giveTokens(s, 0, 3, 5);
    assert.equal(scoreGame(s).players[0].bySource.ponyEnd, 3);
    idleTurn(s);
    idleTurn(s);
    assert.equal(s.phase, 'ended');
    assert.equal(s.players[0].vp.ponyEnd, 3);
  });
}
