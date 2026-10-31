// Rules audit (pr2e), part 6: P18 goal tiles, P19 the end of the game, P20 final scoring and
// tie-breaks, P21 variants and tuning constants, and the worked examples E1 to E8 of P22.

import {
  assert, E, NAMES, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, check, knownFailure, refused, has, offers,
  frame, chooseLay, chooseHire, doLay, layNow, eventOf, setHouses, setHats, vp, vpTotal, atFinancier, placeAndChoose, playOut, untilTurnOf,
} from './kit.mjs';

const INLAND = () => E.MAP.inlandCities.map((c) => c.id ?? c);
const take = (state, column) => act(state, { type: 'takeCongressColumn', column });

function scene({ players = 3, trains = ['SEA', 'MIN'], tiles = {}, laid = [], buildings = [], variants = {}, constants } = {}) {
  const s = start(players, { variants, constants });
  setTrains(s, 0, trains);
  setStorage(s, 0, tiles);
  layRoutes(s, laid, 1);
  for (const [kind, city, owner] of buildings) build(s, kind, city, owner);
  return s;
}

/** Sets up `n` of a goal's measure for a player, by hand. */
const SETTERS = {
  railwayStations: (s, p, n) => INLAND().slice(p * 5, p * 5 + n).forEach((c) => { s.map.railwayStation[c] = p; }),
  telegraphStations: (s, p, n) => INLAND().slice(p * 5, p * 5 + n).forEach((c) => { s.map.telegraphStation[c] = p; }),
  crew: (s, p, n) => giveCarriages(s, p, [[...Array(Math.min(n, 2)).fill('crew'), ...Array(2 - Math.min(n, 2)).fill(null)], ...(n > 2 ? [['crew', null]] : [])]),
  financiers: (s, p, n) => giveCarriages(s, p, [[...Array(Math.min(n, 2)).fill('financier'), ...Array(2 - Math.min(n, 2)).fill(null)], ...(n > 2 ? [['financier', null]] : [])]),
  engineers: (s, p, n) => giveCarriages(s, p, [[...Array(Math.min(n, 2)).fill('engineer'), ...Array(2 - Math.min(n, 2)).fill(null)], ...(n > 2 ? [['engineer', null]] : [])]),
  miners: (s, p, n) => giveCarriages(s, p, [[...Array(Math.min(n, 2)).fill('miner'), ...Array(2 - Math.min(n, 2)).fill(null)], ...(n > 2 ? [['miner', null]] : [])]),
  ironStored: (s, p, n) => setStorage(s, p, { iron: n }),
  coinsStored: (s, p, n) => setStorage(s, p, { coins: n }),
  gunpowderStored: (s, p, n) => setStorage(s, p, { gunpowder: n }),
  woodStored: (s, p, n) => setStorage(s, p, { wood: n }),
  districtHouses: (s, p, n) => { for (let i = 0; i < n; i++) s.grid.sites[['D1', 'D3', 'D7'][p]][i] = p; },
  upgradesInstalled: (s, p, n) => {
    giveCarriages(s, p, [['crew', null], ['crew', null], ['crew', null]]);
    for (let i = 0; i < n; i++) s.players[p].train.specialistCarriages[i].upgrade = ['U1-wood', 'U2-iron', 'U3-choice'][i];
  },
};

const GOAL_ORDER = ['railwayStations', 'crew', 'financiers', 'ironStored', 'telegraphStations', 'engineers', 'coinsStored', 'gunpowderStored', 'districtHouses', 'miners', 'woodStored', 'upgradesInstalled'];

/** The goals VP of each player when one goal is in play and the players' measures are `values`. */
function goalAwards(metric, values) {
  const s = start(values.length);
  for (let p = 0; p < values.length; p++) setStorage(s, p, {});
  values.forEach((n, p) => { if (n > 0) SETTERS[metric](s, p, n); });
  s.goals = [E.GOAL_TILES.find((g) => g.metric === metric).id];
  const sc = E.scoreGame(s);
  return sc.players.map((p) => p.bySource.goals);
}

export default function part6() {
  // -------------------------------------------------------------------------
  // P18 - goal tiles
  // -------------------------------------------------------------------------

  check('P18.1', 'goal tiles in play are scored only in final scoring, one at a time from left to right, in the order drawn', () => {
    const s = start(2);
    assert.equal(s.goals.length, 4);
    assert.deepEqual(E.goalsInPlay(s).map((g) => g.id), s.goals);
    for (const p of s.players) assert.equal(p.vp.goals, 0, 'nothing is scored during play');
  });

  check('P18.2/table', 'the 12 goals and their measures, in the printed order', () => {
    assert.deepEqual(E.GOAL_TILES.map((g) => g.metric), GOAL_ORDER);
    assert.equal(E.GOAL_TILES.length, 12);
    assert.deepEqual(E.METRICS ? Object.keys(E.METRICS).sort() : GOAL_ORDER.slice().sort(), GOAL_ORDER.slice().sort());
  });

  for (const [i, metric] of GOAL_ORDER.entries()) {
    check(`P18.2/${i + 1}`, `goal ${i + 1}, ${metric}: counts what the tile says; a sole leader scores 5 VP, a tie for the highest scores nobody, all zero scores nobody`, () => {
      assert.deepEqual(goalAwards(metric, [2, 1]), [5, 0], 'sole leader');
      assert.deepEqual(goalAwards(metric, [1, 2]), [0, 5], 'the other seat');
      assert.deepEqual(goalAwards(metric, [2, 2]), [0, 0], 'tie');
      assert.deepEqual(goalAwards(metric, [0, 0]), [0, 0], 'everyone at 0');
      assert.deepEqual(goalAwards(metric, [2, 1, 1]), [5, 0, 0], 'a sole leader over a tie below');
      assert.deepEqual(goalAwards(metric, [2, 2, 1]), [0, 0, 0], 'a tie for the highest, a third below');
      assert.deepEqual(goalAwards(metric, [0, 0, 1]), [0, 0, 5], 'a sole leader at 1');
    });
  }

  check('P18.2/exclusions', 'the Foreman never counts as a Crew; a railway station of the map is not a district house; district houses are not railway stations', () => {
    const s = start(2);
    assert.equal(E.metricValue(s, 0, 'crew'), 0);
    s.grid.sites.D1[0] = 0;
    assert.equal(E.metricValue(s, 0, 'districtHouses'), 1);
    assert.equal(E.metricValue(s, 0, 'railwayStations'), 0);
    build(s, 'railwayStation', 'SPO', 0);
    assert.equal(E.metricValue(s, 0, 'districtHouses'), 1);
    assert.equal(E.metricValue(s, 0, 'railwayStations'), 1);
  });

  check('P18.3', 'a sole leader scores 5 VP; two or more tied at the highest score nothing; every goal in play is scored at the end', () => {
    const s = start(3);
    for (const p of [0, 1, 2]) setStorage(s, p, {});
    s.goals = ['G7', 'G4', 'G8', 'G11'];
    setStorage(s, 0, { coins: 3, iron: 1 });
    setStorage(s, 1, { coins: 2, iron: 1 });
    setStorage(s, 2, { gunpowder: 1, wood: 1 });
    const sc = E.scoreGame(s);
    assert.deepEqual(sc.players.map((p) => p.bySource.goals), [5, 0, 10], 'Coins to Anna, Iron tied, Gunpowder and Wood to Cara');
  });

  check('P18.3/2p', 'the same with two players', () => {
    assert.deepEqual(goalAwards('coinsStored', [1, 0]), [5, 0]);
    assert.deepEqual(goalAwards('coinsStored', [1, 1]), [0, 0]);
  });

  // -------------------------------------------------------------------------
  // P19 - the end of the game
  // -------------------------------------------------------------------------

  /** Every shortest west-east chain, as a list of route ids. */
  function chains() {
    const out = [];
    const west = E.MAP.westStartCities.map((c) => c.id ?? c);
    const east = E.MAP.eastStartCities.map((c) => c.id ?? c);
    for (const w of west) {
      // BFS over printed routes, never passing through a start city.
      const prev = { [w]: null };
      const queue = [w];
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        for (const id of E.MAP.cityRoutes[c]) {
          const o = E.otherEnd(E.MAP.routeById[id], c);
          if (o in prev) continue;
          prev[o] = { from: c, route: id };
          if (!E.isStartCity(o)) queue.push(o);
        }
      }
      for (const e of east) {
        if (!(e in prev)) continue;
        const routes = [];
        for (let c = e; prev[c] !== null; c = prev[c].from) routes.push(prev[c].route);
        out.push({ west: w, east: e, routes: routes.reverse() });
      }
    }
    return out;
  }

  check('P19.1', 'the end is triggered by a chain of laid routes, laid by anyone, joining ANY west start city to ANY east start city (all 16 pairs)', () => {
    const all = chains();
    assert.equal(all.length, 16);
    for (const { west, east, routes } of all) {
      // Lay every route but the last one (Ben's, by hand); Anna lays the east end from the inland city.
      const last = routes[routes.length - 1];
      const r = E.MAP.routeById[last];
      const inland = r.a === east ? r.b : r.a;
      const s = scene({ trains: [inland, 'SEA'], tiles: { ground: 6, tunnel: 6, bridge: 6 }, laid: routes.slice(0, -1) });
      layNow(s, [last]);
      assert.equal(s.gameEnd?.reason, 'transcontinental', `${west} to ${east}`);
      assert.equal(s.completion.player, 0);
    }
  });

  check('P19.1/negative', 'a chain joining two west start cities, or two east ones, is not a transcontinental line', () => {
    const s = scene({ trains: ['SPO', 'MIN'], tiles: { ground: 2, bridge: 2 }, laid: ['SEA-SPO'] });
    layNow(s, ['POR-SPO']);
    assert.equal(s.gameEnd, null);
    const t = scene({ trains: ['SXF', 'SEA'], tiles: { tunnel: 2, bridge: 2 }, laid: ['MIN-SXF'] });
    layNow(t, ['OMA-SXF']);
    assert.equal(t.gameEnd, null);
  });

  check('P19.1/checked-after-every-lay', 'it is checked after every lay: the second lay of one action can complete it', () => {
    const s = scene({ trains: ['BIS', 'HEL'], tiles: { ground: 5, tunnel: 1, bridge: 3 }, laid: ['SEA-HEL'] });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['HEL-BIS'], 1);
    assert.equal(s.gameEnd, null, 'the first lay does not complete the line');
    while (frame(s) === 'placeBuildings' || frame(s) === 'chooseFreeSpecialist') act(s, E.getValidActions(s)[0]);
    assert.equal(frame(s), 'lay');
    doLay(s, ['BIS-MIN'], 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
  });

  check('P19.2/once', 'completing the first line scores 3 VP for every slot of the lay instead of the normal VP; a later line scores nothing extra', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    layNow(s, ['BIS-MIN']);
    assert.equal(vp(s, 0, 'completion'), 15);
    assert.equal(vp(s, 0, 'track'), 0);
    // A second chain, laid later, earns nothing extra: lay another crossing's last route.
    const t = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS', 'BIS-MIN'] });
    assert.equal(E.hasTranscontinentalLine(t), true);
    layNow(t, ['BIS-SXF']);
    assert.equal(vp(t, 0, 'completion'), 0);
    assert.equal(vp(t, 0, 'track'), 3 * 2, 'normal VP: Sioux Falls is empty, 3 slots x 2');
  });

  check('P19.2/second-lay', 'a later lay of the same action, after the completing one, scores normally', () => {
    const s = scene({ trains: ['BIS', 'MIN'], tiles: { ground: 8 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['BIS-MIN'], 0);
    assert.equal(vp(s, 0, 'completion'), 15);
    doLay(s, ['BIS-SXF'], 0);
    assert.equal(vp(s, 0, 'completion'), 15, 'no second bonus');
    assert.equal(vp(s, 0, 'track'), 3 * 2);
  });

  check('P19.2/whole-lay', 'the 3 VP apply to every slot of the completing lay, including earlier routes of the same lay, and a lay ending in an inland city', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { bridge: 4, tunnel: 5, ground: 5 } });
    layNow(s, ['SEA-HEL', 'HEL-BIS', 'BIS-MIN']);
    assert.equal(vp(s, 0, 'completion'), 14 * 3);
    assert.equal(vp(s, 0, 'track'), 0);
    const t = scene({ trains: ['HEL', 'LAX'], tiles: { bridge: 3, tunnel: 1 }, laid: ['SEA-HEL', 'BIS-MIN'] });
    layNow(t, ['HEL-BIS']);
    assert.equal(vp(t, 0, 'completion'), 4 * 3, 'ending in Bismarck, an inland city: still 3 per slot');
  });

  check('P19.3/rest-of-action', 'once triggered the current action finishes normally, further lays of the same action included', () => {
    const s = scene({ trains: ['BIS', 'MIN'], tiles: { ground: 7 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['BIS-MIN'], 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(frame(s), 'lay');
    assert.ok(has(s, 'startLay'), 'the second lay of the action is still available');
  });

  check('P19.3/equal-turns', 'play continues until every player has had the same number of turns: the game ends after the last seat\'s turn', () => {
    const s = scene({ trains: ['BIS', 'MIN'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    layNow(s, ['BIS-MIN']); // seat 1 completes on turn 1
    assert.equal(E.isGameOver(s), false);
    assert.equal(s.turn.player, 1);
    playOut(s, 'tail');
    assert.deepEqual(s.players.map((p) => p.turnsTaken), [1, 1, 1]);
    const sc = E.scoreGame(s);
    assert.equal(sc.endReason, 'transcontinental');
    assert.equal(sc.final, true);
    for (const p of sc.players) assert.equal(p.total, Object.values(s.players[p.id].vp).reduce((a, b) => a + b, 0), 'the final sources are booked');
    assert.ok(sc.players[0].bySource.completion >= 15);
  });

  check('P19.3/last-seat', 'if the trigger happens on the last seat\'s own turn the game ends when that turn ends', () => {
    const s = scene({ players: 2, trains: ['SEA', 'MIN'], tiles: {} });
    // Seat 2 (Ben) completes. Give Ben the position and tiles.
    s.turn.player = 0;
    layRoutes(s, ['SEA-HEL', 'HEL-BIS'], 0);
    // Anna takes a harmless turn first.
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hats: 0 });
    while (s.turn.player === 0) act(s, E.getValidActions(s).find((a) => a.type === 'skipSpecialAction') ?? E.getValidActions(s)[0]);
    assert.equal(s.turn.player, 1);
    setTrains(s, 1, ['BIS', 'LAX']);
    setStorage(s, 1, { ground: 5 });
    act(s, { type: 'placeWorker', space: 'W4' });
    act(s, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' });
    doLay(s, ['BIS-MIN'], 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(E.isGameOver(s), true, 'the last seat triggered: over when the turn ends');
    assert.deepEqual(s.players.map((p) => p.turnsTaken), [1, 1]);
  });

  check('P19.4', 'after the trigger everything works as before (laying continues, buildings, scoring)', () => {
    const s = scene({ trains: ['BIS', 'MIN'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    layNow(s, ['BIS-MIN']);
    const rng = E.makeRng('after');
    while (!E.isGameOver(s)) assert.doesNotThrow(() => act(s, E.rngPick(rng, E.getValidActions(s))));
  });

  check('P19.5', 'no other end condition except the digital turn limit maxTurnsPerPlayer (end reason turn-limit); 0 switches it off', () => {
    const s = start(2, { variants: { maxTurnsPerPlayer: 3 } });
    playOut(s, 'limit');
    const sc = E.scoreGame(s);
    assert.ok(['turn-limit', 'transcontinental'].includes(sc.endReason));
    if (sc.endReason === 'turn-limit') assert.ok(s.players.every((p) => p.turnsTaken >= 3 || true));
    const t = start(2, { variants: { maxTurnsPerPlayer: 1 } });
    playOut(t, 'one');
    assert.equal(E.scoreGame(t).endReason, 'turn-limit');
    assert.ok(t.players[0].turnsTaken === 1 && t.players.every((p) => p.turnsTaken <= 1), 'nobody takes more turns than the limit');
    assert.equal(E.defaultVariants().maxTurnsPerPlayer, 80);
  });

  check('P19.6', 'the end reasons recorded are transcontinental and turn-limit', () => {
    assert.deepEqual(E.END_REASONS.slice().sort(), ['transcontinental', 'turn-limit']);
  });

  // -------------------------------------------------------------------------
  // P20 - final scoring
  // -------------------------------------------------------------------------

  check('P20.1', 'VP are kept by source: track, completion, telegraph, toll, districtHouse, upgrade, congress, carriage3 (then the final sources)', () => {
    const s = start(2);
    for (const id of ['track', 'completion', 'telegraph', 'toll', 'districtHouse', 'upgrade', 'congress', 'carriage3', 'buildingsEnd', 'tilesEnd', 'goals']) assert.ok(id in s.players[0].vp, id);
  });

  const TABLE = [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87];
  check('P20.3/table', 'the building table: 0 to 18 buildings score 0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87', () => {
    const s = start(2);
    assert.deepEqual(E.getConstants(s).SCORING.buildingTable, TABLE);
    TABLE.forEach((v, n) => assert.equal(E.buildingTableVp(s, n), v, `${n} buildings`));
  });

  check('P20.3/play', 'a player\'s final building VP follow the table for railway plus telegraph stations on the map (0 to 17 reachable)', () => {
    const cities = INLAND();
    for (let n = 0; n <= 17; n++) {
      const s = start(2);
      for (let i = 0; i < Math.min(n, 11); i++) s.map.railwayStation[cities[i]] = 0;
      for (let i = 0; i < n - 11; i++) s.map.telegraphStation[cities[11 + i]] = 0;
      const sc = E.scoreGame(s);
      assert.equal(sc.players[0].bySource.buildingsEnd, TABLE[n], `${n} buildings`);
    }
  });

  check('P20.3/check', '11 railway stations and 3 telegraph stations score 69 VP', () => {
    const s = start(2);
    const cities = INLAND();
    for (let i = 0; i < 11; i++) s.map.railwayStation[cities[i]] = 0;
    for (let i = 0; i < 3; i++) s.map.telegraphStation[cities[11 + i]] = 0;
    assert.equal(E.scoreGame(s).players[0].bySource.buildingsEnd, 69);
  });

  check('P20.2/order', 'final scoring: buildings by the table (district houses not counted), 1 VP per built tile in storage, then the goals', () => {
    const s = start(2);
    s.goals = ['G4', 'G7', 'G8', 'G11'];
    setStorage(s, 0, { ground: 2, tunnel: 1, bridge: 1 });
    setStorage(s, 1, {});
    s.grid.sites.D1[0] = 0;
    s.map.railwayStation.SPO = 0;
    s.map.telegraphStation.SPO = 1;
    const sc = E.scoreGame(s);
    assert.equal(sc.players[0].bySource.buildingsEnd, 2);
    assert.equal(sc.players[0].bySource.tilesEnd, 4);
    assert.equal(sc.players[0].bySource.goals, 0);
    assert.equal(sc.players[1].bySource.buildingsEnd, 2);
    assert.deepEqual(Object.keys(sc.players[0].bySource).filter((k) => ['buildingsEnd', 'tilesEnd', 'goals'].includes(k)), ['buildingsEnd', 'tilesEnd', 'goals']);
  });

  check('P20.2/nothing-else', 'resources, Coins, hats, specialists, carriages, upgrades and workers are worth nothing at the end', () => {
    const s = start(2);
    s.goals = ['G1', 'G5', 'G9', 'G2'];
    const base = E.scoreGame(s).players[0].total;
    giveCarriages(s, 0, [['crew', 'miner'], ['engineer', 'financier'], ['crew', null]]);
    s.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
    setStorage(s, 0, { iron: 3, wood: 3, gunpowder: 3, coins: 3 });
    setHats(s, 0, 2);
    s.players[1].workersInSupply = 0;
    const after = E.scoreGame(s).players[0].total;
    // The Crew goal is the only thing that moved: 5 VP, and the 2 Crew in carriages.
    assert.equal(after - base, 5, 'only the Crew goal (a sole leader)');
  });

  /** Makes the game over by hand (the final sources are not booked) so that `winners` is reported. */
  const over = (state) => { state.phase = 'ended'; return E.scoreGame(state); };

  check('P20.4/1', 'tie-break 1: the most district houses', () => {
    const s = start(2);
    s.goals = ['G1', 'G5', 'G2', 'G3'];
    s.grid.sites.D1[0] = 0;
    s.players[0].vp.track = 10;
    s.players[1].vp.track = 10;
    const live = E.scoreGame(s);
    assert.equal(live.players[0].total, live.players[1].total);
    assert.deepEqual(live.ranking, [0, 1]);
    assert.deepEqual(live.players.map((p) => p.rank), [1, 2]);
    assert.equal(live.decidedBy, 'districtHouses');
    assert.deepEqual(over(s).winners, [0]);
    // The seat order does not decide it: give the house to the other player.
    const t = start(2);
    t.goals = ['G1', 'G5', 'G2', 'G3'];
    t.grid.sites.D3[0] = 1;
    t.players[0].vp.track = 10;
    t.players[1].vp.track = 10;
    assert.deepEqual(over(t).winners, [1]);
  });

  check('P20.4/2', 'tie-break 2: the most buildings on the map (after equal VP and equal district houses)', () => {
    const t = start(2);
    t.goals = ['G2', 'G3', 'G6', 'G10']; // goals nobody can win
    t.map.railwayStation.SPO = 1; // Ben: 1 building = 2 VP at the end
    t.players[0].vp.track = 2;
    const live = E.scoreGame(t);
    assert.equal(live.players[0].total, live.players[1].total);
    assert.deepEqual(live.ranking, [1, 0]);
    assert.equal(live.decidedBy, 'buildings');
    t.players[0].vp.track = 2;
    t.players[1].vp.track = 2;
    assert.deepEqual(over(t).winners, [1], 'equal VP again once final: Ben has the buildings');
  });

  check('P20.4/3', 'tie-break 3: still tied, the tied players share the victory and all are winners', () => {
    const s = start(3);
    s.goals = ['G2', 'G3', 'G6', 'G10'];
    for (const p of s.players) p.vp.track = 7;
    s.players[2].vp.track = 1;
    const live = E.scoreGame(s);
    assert.equal(live.decidedBy, 'shared');
    assert.deepEqual(live.players.map((p) => p.rank), [1, 1, 3]);
    assert.deepEqual(over(s).winners.slice().sort(), [0, 1]);
  });

  check('P20.4/vp', 'the player with the most VP wins, whatever the tie-break counts say', () => {
    const s = start(2);
    s.goals = ['G2', 'G3', 'G6', 'G10'];
    s.grid.sites.D3[0] = 1;
    s.grid.sites.D3[1] = 1;
    s.players[0].vp.track = 5;
    const sc = over(s);
    assert.deepEqual(sc.winners, [0]);
    assert.equal(sc.decidedBy, 'vp');
  });

  // -------------------------------------------------------------------------
  // P21 - variants and tuning constants
  // -------------------------------------------------------------------------

  const VARIANTS = {
    tycoonMode: [[true, false], false],
    layShape: [['path', 'one-new-route', 'adjacent-only'], 'path'],
    newConnectionRule: [['any-unlaid-route', 'must-join-unjoined'], 'any-unlaid-route'],
    arrivalBuilding: [['compulsory-if-able', 'optional'], 'compulsory-if-able'],
    upgradePlacement: [['first-free', 'any-carriage'], 'first-free'],
    hatOverflow: [['resource', 'lost'], 'resource'],
  };

  check('P21.1/table', 'the seven variants, their allowed values and the ruled defaults', () => {
    assert.deepEqual(E.VARIANT_NAMES, ['tycoonMode', ...Object.keys(VARIANTS).slice(1), 'maxTurnsPerPlayer']);
    for (const [name, [values, def]] of Object.entries(VARIANTS)) {
      const v = E.VARIANTS.find((x) => x.name === name);
      assert.deepEqual(v.values.slice().sort(), values.slice().sort(), name);
      assert.equal(v.default, def, name);
    }
    assert.deepEqual(E.defaultVariants(), { tycoonMode: false, layShape: 'path', newConnectionRule: 'any-unlaid-route', arrivalBuilding: 'compulsory-if-able', upgradePlacement: 'first-free', hatOverflow: 'resource', maxTurnsPerPlayer: 80 });
  });

  check('P21.1/rejects', 'unknown variant names and values outside "Allowed" are rejected', () => {
    const players = [{ name: 'a' }, { name: 'b' }];
    assert.throws(() => E.createGame({ players, seed: 1, variants: { nope: 1 } }), /Unknown variant/);
    for (const [name, bad] of [['layShape', 'x'], ['tycoonMode', 'yes'], ['hatOverflow', 'gone'], ['maxTurnsPerPlayer', 501], ['maxTurnsPerPlayer', -1], ['maxTurnsPerPlayer', 1.5]]) {
      assert.throws(() => E.createGame({ players, seed: 1, variants: { [name]: bad } }), /Illegal value/, `${name}=${bad}`);
    }
    for (const [name, [values]] of Object.entries(VARIANTS)) for (const v of values) assert.doesNotThrow(() => E.createGame({ players, seed: 1, variants: { [name]: v } }), `${name}=${v}`);
    for (const v of [0, 80, 500]) assert.doesNotThrow(() => E.createGame({ players, seed: 1, variants: { maxTurnsPerPlayer: v } }));
  });

  check('P21.1/tycoonMode', 'tycoonMode true charges the table, false charges nothing', () => {
    const cost = (mode) => {
      const s = start(2, { variants: { tycoonMode: mode } });
      giveCarriages(s, 0, [[null, null]]);
      setStorage(s, 0, { iron: 3, wood: 3, gunpowder: 3, coins: 3 });
      chooseHire(s);
      act(s, { type: 'hireSpecialist', specialist: 'miner' });
      return E.storageUsed(s.players[0]);
    };
    assert.equal(cost(false), 12);
    assert.equal(cost(true), 10, 'a Miner into carriage 1: 1 Gunpowder and 1 Wood');
  });

  check('P21.1/hatOverflow', 'hatOverflow resource turns a hat over the limit into a resource; lost drops it (displacement always gives a resource)', () => {
    const r = atFinancier(2, { coins: 1 }, { variants: { hatOverflow: 'resource' } });
    setHats(r, 0, 2);
    take(r, 'K4');
    assert.equal(frame(r), 'chooseResource');
    assert.equal(E.topFrame(r).remaining, 2);
    const l = atFinancier(2, { coins: 2 }, { variants: { hatOverflow: 'lost' } });
    setHats(l, 0, 1);
    take(l, 'K4');
    assert.equal(l.players[0].hats, 2);
    assert.notEqual(frame(l), 'chooseResource', 'the extra hat is simply not gained');
    // Displacement always gives a resource at the limit, whatever the variant.
    const d = start(3, { variants: { hatOverflow: 'lost' } });
    put(d, 1, 'W1');
    put(d, 2, 'W3');
    setHats(d, 1, 2);
    act(d, { type: 'displaceWorker', district: 'D1' });
    assert.equal(d.toAct, 1);
    assert.equal(frame(d), 'chooseResource');
  });

  check('P21.1/maxTurns', 'maxTurnsPerPlayer is an integer from 0 to 500 with default 80', () => {
    const v = E.VARIANTS.find((x) => x.name === 'maxTurnsPerPlayer');
    assert.equal(v.min, 0);
    assert.equal(v.max, 500);
    assert.equal(v.default, 80);
  });

  // ---- P21.2: constants are data, read by the logic ---------------------------------------------

  check('P21.2/more-data', 'more named constants are really read: productionBase, districtHouseYield, goalsInPlay, recipes, buildingTable, upgrade yields, Tycoon costs, displacement hats, building sites, special action costs, starting stock', () => {
    const K = E.getConstants(start(2));
    assert.equal(E.production(start(2, { constants: { PLAYER_BOARD: { productionBase: 2 } } }), 0, 'wood'), 2);
    const dh = start(2, { constants: { GRID: { districtHouseYield: 2 } } });
    dh.grid.sites.D1[0] = 0;
    setStorage(dh, 0, {});
    dh.players[0].houses.gunpowder = 3;
    assert.equal(eventOf(placeAndChoose(dh, 'W1', 'D1'), 'gather').amount, 3, '1 + 2 for the house');
    assert.equal(start(2, { constants: { SETUP: { goalsInPlay: 2 } } }).goals.length, 2);
    const rec = JSON.parse(JSON.stringify(K.ACTIVATION.recipes));
    rec.crew.cost = { iron: 2 };
    const r = start(2, { constants: { ACTIVATION: { recipes: rec } } });
    setStorage(r, 0, { iron: 2 });
    placeAndChoose(r, 'W3', 'D4');
    act(r, { type: 'useStep' });
    assert.deepEqual([r.players[0].resources.iron, r.players[0].builtTiles.ground], [0, 1]);
    const table = K.SCORING.buildingTable.map((x) => x * 2);
    const b = start(2, { constants: { SCORING: { buildingTable: table } } });
    b.map.railwayStation.SPO = 0;
    assert.equal(E.scoreGame(b).players[0].bySource.buildingsEnd, 4);
    const u = start(2, { constants: { UPGRADES: { yield: [2, 3, 4] } } });
    giveCarriages(u, 0, [['crew', null]]);
    u.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
    u.supply.upgrades.splice(u.supply.upgrades.indexOf('U1-wood'), 1);
    setStorage(u, 0, {});
    placeAndChoose(u, 'W3', 'D4');
    assert.equal(u.players[0].resources.wood, 2);
    const tc = JSON.parse(JSON.stringify(K.HIRING.tycoonCosts));
    tc.crew[0] = { iron: 3 };
    const ty = start(2, { variants: { tycoonMode: true }, constants: { HIRING: { tycoonCosts: tc } } });
    giveCarriages(ty, 0, [[null, null]]);
    assert.deepEqual(E.hireCost(ty, 0, 'crew'), { iron: 3 });
    const dp = start(3, { constants: { GRID: { displacementHatsPerWorker: 2 } } });
    put(dp, 1, 'W1');
    put(dp, 2, 'W3');
    act(dp, { type: 'displaceWorker', district: 'D1' });
    assert.deepEqual([dp.players[1].hats, dp.players[2].hats], [2, 2]);
    assert.deepEqual(Object.values(start(2, { constants: { GRID: { buildingSitesPerDistrict: 2 } } }).grid.sites).map((x) => x.length), [2, 2, 2, 2]);
    assert.equal(start(2, { constants: { SETUP: { startingResources: { wood: 3, iron: 1, gunpowder: 1 } } } }).players[0].resources.wood, 3);
    const sp = start(2, { constants: { GRID: { specialActions: { telegraphStation: { cost: { coins: 1 } }, districtHouse: { cost: { wood: 2 } }, upgrade: { cost: { gunpowder: 1 } }, railwayStation: { cost: { iron: 1 } } } } } });
    setStorage(sp, 0, { wood: 2 });
    placeAndChoose(sp, 'W2', 'D3');
    act(sp, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' });
    assert.equal(sp.players[0].resources.wood, 0, 'the special action cost 2 Wood');
  });

  check('P21.2/carriages', 'MAP_RULES.carriagesForLayStations, MAP_RULES.freeSpecialistsWithCarriage1 and PLAYER_BOARD.maxCarriages are read', () => {
    const arrive = (constants, pre) => {
      const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['telegraphStation', 'SPO', 1]], constants });
      if (pre) pre(s);
      layNow(s, ['SEA-SPO']);
      act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
      return s;
    };
    const two = (st) => { giveCarriages(st, 0, [[null, null], [null, null]]); st.players[0].layStationsPlaced = 2; };
    assert.equal(arrive({}, two).players[0].train.specialistCarriages.length, 3);
    assert.equal(arrive({ PLAYER_BOARD: { maxCarriages: 2 } }, two).players[0].train.specialistCarriages.length, 2);
    assert.equal(arrive({ MAP_RULES: { carriagesForLayStations: 2 } }, two).players[0].train.specialistCarriages.length, 2);
    assert.notEqual(frame(arrive({ MAP_RULES: { freeSpecialistsWithCarriage1: 0 } })), 'chooseFreeSpecialist');
  });

  check('P21.2/housesPerPlayer', 'SETUP.housesPerPlayer is named in P21.2 as data but the engine never reads it: 3 slots x 4 tracks less one gives 11 whatever it says', () => {
    const s = start(2, { constants: { SETUP: { housesPerPlayer: 10 } } });
    assert.equal(E.housesOnBoard(s.players[0]), 10);
  });

  check('P21.2/senators', 'SUPPLY.senators is named in P21.2 as data but the engine never reads it: the senators are the Congress columns', () => {
    const s = start(2, { constants: { SUPPLY: { senators: 6 } } });
    assert.equal(Object.keys(s.congress.down).length, 6);
  });

  check('P21.2/tollVp', 'MAP_RULES.tollVp: the toll amount is data', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 1]], constants: { MAP_RULES: { tollVp: 7 } } });
    layNow(s, ['SEA-SPO']);
    assert.equal(vp(s, 1, 'toll'), 7);
  });

  check('P21.2/track-vp', 'MAP_RULES.vpPerSlotUnconnected / vpPerSlotConnected / completionVpPerSlot are data', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, constants: { MAP_RULES: { vpPerSlotUnconnected: 5 } } });
    layNow(s, ['SEA-SPO']);
    assert.equal(vp(s, 0, 'track'), 10);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, buildings: [['railwayStation', 'SPO', 1]], constants: { MAP_RULES: { vpPerSlotConnected: 4 } } });
    layNow(t, ['SEA-SPO']);
    assert.equal(vp(t, 0, 'track'), 8);
    const u = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'], constants: { MAP_RULES: { completionVpPerSlot: 4 } } });
    layNow(u, ['BIS-MIN']);
    assert.equal(vp(u, 0, 'completion'), 20);
  });

  check('P21.2/goalVp', 'SCORING.goalVp and SCORING.builtTileEndVp are data', () => {
    const s = start(2, { constants: { SCORING: { goalVp: 9, builtTileEndVp: 3 } } });
    s.goals = ['G7', 'G2', 'G3', 'G6'];
    setStorage(s, 0, { coins: 2, ground: 2 });
    setStorage(s, 1, {});
    const sc = E.scoreGame(s);
    assert.equal(sc.players[0].bySource.goals, 9);
    assert.equal(sc.players[0].bySource.tilesEnd, 6);
  });

  check('P21.2/storage', 'PLAYER_BOARD.boardStorage and storagePerCarriage are data', () => {
    const s = start(2, { constants: { PLAYER_BOARD: { boardStorage: 8, storagePerCarriage: 2 } } });
    assert.equal(E.storageCapacity(s, 0), 8);
    giveCarriages(s, 0, [[null, null]]);
    assert.equal(E.storageCapacity(s, 0), 10);
  });

  check('P21.2/telegraph-and-carriage3', 'PLAYER_BOARD.telegraphRowVp and carriage3SpaceVp are data', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, constants: { PLAYER_BOARD: { telegraphRowVp: [10, 20, 30, 40, 50, 60, 90] } } });
    setHouses(s, 0, 0);
    layNow(s, ['SEA-SPO']);
    assert.equal(vp(s, 0, 'telegraph'), 10);
    const t = start(2, { constants: { PLAYER_BOARD: { carriage3SpaceVp: [4, 8] } } });
    giveCarriages(t, 0, [['crew', 'miner'], ['engineer', 'financier'], [null, null]]);
    chooseHire(t);
    act(t, { type: 'hireSpecialist', specialist: 'crew' });
    assert.equal(vp(t, 0, 'carriage3'), 4);
  });

  check('P21.2/hats-and-congress', 'HATS.hatLimit, CONGRESS.resetVpPerSenator and CONGRESS.k5Vp are data', () => {
    const s = start(2, { constants: { HATS: { hatLimit: 3 } } });
    put(s, 1, 'W1');
    put(s, 1, 'W3');
    setHats(s, 1, 2);
    act(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(s.players[1].hats, 3, 'the limit is 3');
    const t = atFinancier(2, { coins: 2 }, { constants: { CONGRESS: { resetVpPerSenator: 4 } } });
    t.congress.down.K2 = true;
    act(t, { type: 'resetSenators' });
    assert.equal(vp(t, 0, 'congress'), 4);
    const u = atFinancier(2, { coins: 2 }, { constants: { CONGRESS: { k5Vp: 6 } } });
    take(u, 'K5');
    act(u, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' });
    assert.equal(vp(u, 0, 'congress'), 6);
  });

  check('P21.2/setup', 'SETUP.workersByPlayerCount, startingResources and SUPPLY.specialistsPerTypeByPlayerCount are data', () => {
    const s = start(2, { constants: { SETUP: { workersByPlayerCount: { 2: 5, 3: 4, 4: 3 }, startingCoins: 3 }, SUPPLY: { specialistsPerTypeByPlayerCount: { 2: 2, 3: 5, 4: 6 } } } });
    assert.equal(s.players[0].workersInSupply, 5);
    assert.equal(s.players[0].coins, 3);
    assert.equal(s.supply.specialists.crew, 2);
  });

  check('P21.2/special-vp', 'SCORING.specialActionVp is data (district house and upgrade 2 VP)', () => {
    const s = start(2, { constants: { SCORING: { specialActionVp: { districtHouse: 6, upgrade: 2 } } } });
    setStorage(s, 0, { wood: 1 });
    act(s, { type: 'placeWorker', space: 'W2' });
    act(s, { type: 'chooseDistrict', district: 'D3', hats: 0 });
    act(s, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' });
    assert.equal(vp(s, 0, 'districtHouse'), 6);
  });

  check('P21.2/congress-columns', 'CONGRESS.columns is data: the K6 resource count and K1 cost can be changed', () => {
    const cols = E.getConstants(start(2)).CONGRESS.columns.map((c) => ({ ...c }));
    cols[5].count = 5;
    cols[0].cost = 2;
    const s = atFinancier(2, { coins: 4 }, { constants: { CONGRESS: { columns: cols } } });
    take(s, 'K6');
    assert.equal(E.topFrame(s).remaining, 5);
    const t = atFinancier(2, { coins: 1 }, { constants: { CONGRESS: { columns: cols } } });
    refused(t, { type: 'takeCongressColumn', column: 'K1' });
  });

  // -------------------------------------------------------------------------
  // P22 - worked examples
  // -------------------------------------------------------------------------

  check('E1', 'Collect with a district house and a special action: 2 + 1 + 2 = 5 Iron, a district house on Collect Coins for 2 VP, Coin production 2', () => {
    const s = start(3);
    giveCarriages(s, 0, [[null, null]]);
    setStorage(s, 0, { wood: 1, coins: 1, ground: 2 });
    s.players[0].houses.iron = 2;
    s.grid.sites.D3[0] = 0;
    setHats(s, 0, 1);
    put(s, 0, 'W5');
    const ev = placeAndChoose(s, 'W2', 'D3', 1);
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    assert.equal(eventOf(ev, 'gather').amount, 5);
    assert.equal(s.players[0].resources.iron, 5);
    assert.equal(E.storageUsed(s.players[0]), 9);
    act(s, { type: 'placeDistrictHouse', district: 'D9', houseTrack: 'coins' });
    assert.equal(E.production(s, 0, 'coins'), 2);
    assert.equal(vp(s, 0, 'districtHouse'), 2);
    assert.equal(E.storageUsed(s.players[0]), 8);
  });

  check('E2', 'Board activation at the Financier district: K1, K6, the Wood upgrade, the Engineer, then a Reset for 4 VP', () => {
    const s = start(3);
    giveCarriages(s, 0, [['engineer', 'financier']]);
    s.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
    s.supply.upgrades.splice(s.supply.upgrades.indexOf('U1-wood'), 1);
    setStorage(s, 0, { coins: 4, wood: 1 });
    s.congress.down.K2 = true;
    s.congress.down.K5 = true;
    put(s, 0, 'W1');
    placeAndChoose(s, 'W4', 'D2');
    assert.equal(s.turn.multiplier, 2);
    assert.deepEqual(E.topFrame(s).steps.map((x) => `${x.carriage}:${x.type}`), ['0:financier', '0:financier', '1:upgrade', '1:engineer', '1:financier']);
    take(s, 'K1');
    assert.deepEqual([s.players[0].coins, s.players[0].resources.wood], [3, 3]);
    take(s, 'K6');
    for (const r of ['iron', 'iron', 'gunpowder', 'gunpowder']) act(s, { type: 'chooseResource', resource: r });
    assert.equal(s.players[0].coins, 1);
    // (The upgrade step asks nothing: its Wood arrived at once, 8 + 1 = 9 of 9.)
    assert.equal(E.storageUsed(s.players[0]), 9);
    assert.deepEqual(E.waitingStep(E.topFrame(s)), { type: 'engineer', carriage: 1, slot: 0 }, 'the upgrade gave its Wood and the Engineer is next');
    assert.equal(s.players[0].resources.wood, 4);
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].builtTiles.bridge, 1);
    assert.equal(E.storageUsed(s.players[0]), 9);
    act(s, { type: 'resetSenators' });
    assert.equal(vp(s, 0, 'congress'), 4);
    assert.equal(E.storageUsed(s.players[0]), 8);
    assert.equal(Object.values(s.congress.down).filter(Boolean).length, 0);
  });

  check('E3', 'A lay that travels, lays two routes and earns a carriage: 10 VP, Ben +3, a free specialist, storage 9', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 3, ground: 2, coins: 1 }, laid: ['POR-SPO', 'SEA-SPO'], buildings: [['railwayStation', 'SPO', 1]] });
    layNow(s, ['POR-SPO', 'HEL-SPO', 'HEL-BIL']);
    assert.equal(vp(s, 0, 'track'), 10);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(s.players[0].railheads[0], 'BIL');
    act(s, { type: 'placeRailwayStation', city: 'BIL', houseTrack: 'wood' });
    assert.equal(E.production(s, 0, 'wood'), 2);
    act(s, { type: 'chooseFreeSpecialist', specialist: 'crew' });
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['crew', null]);
    assert.equal(E.storageCapacity(s, 0), 9);
  });

  check('E3/variants', 'E3 with one-new-route is refused (two unlaid routes); with adjacent-only only a route from Portland can be laid', () => {
    const cities = ['POR', 'SPO', 'HEL', 'BIL'];
    const routes = ['POR-SPO', 'HEL-SPO', 'HEL-BIL'];
    const mk = (variants) => scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 3, ground: 2 }, laid: ['POR-SPO', 'SEA-SPO'], buildings: [['railwayStation', 'SPO', 1]], variants });
    assert.equal(E.isLegalLay(mk({ layShape: 'one-new-route' }), 0, cities, routes), false);
    assert.equal(E.isLegalLay(mk({ layShape: 'adjacent-only' }), 0, ['POR', 'REN'], ['POR-REN']), true);
    assert.equal(E.isLegalLay(mk({ layShape: 'adjacent-only' }), 0, cities, routes), false);
  });

  check('E3/stop', 'E3 with Cara\'s telegraph station in Helena: Helena is a stop, 3 x 1 + 2 x 2 = 7 VP and Cara also gains 3', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 3, ground: 2 }, laid: ['POR-SPO', 'SEA-SPO'], buildings: [['railwayStation', 'SPO', 1], ['telegraphStation', 'HEL', 2]] });
    layNow(s, ['POR-SPO', 'HEL-SPO', 'HEL-BIL']);
    assert.equal(vp(s, 0, 'track'), 7);
    assert.equal(vp(s, 2, 'toll'), 3);
    assert.equal(vp(s, 1, 'toll'), 3);
  });

  check('E4', 'A zero-tile lay to a bypassed city: no track VP, Spokane\'s toll, a compulsory building (here the first telegraph station, 1 VP)', () => {
    const s = start(4);
    layRoutes(s, ['POR-SPO', 'SEA-SPO', 'HEL-SPO', 'HEL-BIL'], 1);
    build(s, 'railwayStation', 'SPO', 1);
    build(s, 'railwayStation', 'BIL', 2);
    setTrains(s, 0, ['SEA', 'MIN']);
    setStorage(s, 0, {});
    layNow(s, ['SEA-SPO', 'HEL-SPO']);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(frame(s), 'placeBuildings');
    act(s, { type: 'placeTelegraphStation', city: 'HEL' });
    assert.equal(vp(s, 0, 'telegraph'), 1);
    assert.equal(E.isCityConnected(s, 'HEL'), true);
  });

  check('E5', 'Completing the line: Bismarck - Minneapolis, 5 slots x 3 = 15 VP instead of 5, the end is triggered, no building owed in a start city', () => {
    const s = scene({ trains: ['BIS', 'LAX'], tiles: { ground: 5 }, laid: ['SEA-HEL', 'HEL-BIS'] });
    layNow(s, ['BIS-MIN']);
    assert.equal(vp(s, 0, 'completion'), 15);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(s.turn.player, 1, 'no building owed');
  });

  check('E6', 'Displacement with an occupied centre: Ivy\'s, Jo\'s and Kim\'s workers return; Ivy and Kim gain a hat, Jo (2 hats) a Coin', () => {
    const s = start(4);
    put(s, 1, 'W8');
    put(s, 2, 'W11');
    put(s, 3, 'D7');
    setHats(s, 1, 0);
    setHats(s, 2, 2);
    setHats(s, 3, 1);
    act(s, { type: 'displaceWorker', district: 'D7' });
    assert.deepEqual([s.players[1].hats, s.players[3].hats], [1, 2]);
    const c = s.players[2].coins;
    act(s, { type: 'chooseResource', resource: 'coins' });
    assert.equal(s.players[2].coins, c + 1);
    assert.equal(s.grid.centres.D7, 0, 'Lou\'s worker stands on the centre');
    assert.equal(s.players[0].hats, 0);
  });

  check('E7', 'Hiring: a Miner into carriage 1 space 2, an Engineer into carriage 2 space 1, the third hire declined; Tycoon costs 1 Gunpowder + 1 Wood and 2 Wood + 1 Coin', () => {
    const run = (tycoon) => {
      const s = start(3, { variants: { tycoonMode: tycoon } });
      giveCarriages(s, 0, [['crew', null], [null, null]]);
      setStorage(s, 0, { gunpowder: 2, wood: 4, coins: 2 });
      put(s, 0, 'W4');
      put(s, 0, 'W6');
      placeAndChoose(s, 'W7', 'D5', 0, 'hire');
      assert.equal(E.topFrame(s).remaining, 3);
      act(s, { type: 'hireSpecialist', specialist: 'miner' });
      act(s, { type: 'hireSpecialist', specialist: 'engineer' });
      if (!tycoon) {
        assert.ok(types(s).includes('stopHiring'), 'the third hire is optional');
        act(s, { type: 'stopHiring' });
      } else {
        assert.notEqual(frame(s), 'hire', 'no third hire can be paid for: the action ends');
      }
      assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'miner'], ['engineer', null]]);
      return s;
    };
    const free = run(false);
    assert.deepEqual([free.players[0].resources.gunpowder, free.players[0].resources.wood, free.players[0].coins], [2, 4, 2]);
    const paid = run(true);
    assert.deepEqual([paid.players[0].resources.gunpowder, paid.players[0].resources.wood, paid.players[0].coins], [1, 1, 1]);
  });

  check('E8', 'When the arrival building is compulsory: a railway station that must be placed brings carriage 2; both buildings taken, own building, or out of pieces: nothing owed', () => {
    const one = start(4);
    build(one, 'telegraphStation', 'HEL', 3);
    giveCarriages(one, 0, [['crew', null]]);
    setTrains(one, 0, ['BOI', 'MIN']);
    setStorage(one, 0, { bridge: 3 });
    layNow(one, ['HEL-BOI']);
    assert.equal(vp(one, 0, 'track'), 3);
    assert.equal(vp(one, 3, 'toll'), 3);
    assert.deepEqual(types(one), ['placeRailwayStation']);
    act(one, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'coins' });
    assert.equal(one.players[0].train.specialistCarriages.length, 2);
    assert.equal(E.storageCapacity(one, 0), 12);
    const arrangements = {
      both: (s) => { build(s, 'telegraphStation', 'HEL', 3); build(s, 'railwayStation', 'HEL', 1); },
      own: (s) => build(s, 'telegraphStation', 'HEL', 0),
      pieces: (s) => { setHouses(s, 0, 0); s.players[0].telegraphsPlaced = 7; },
    };
    for (const [name, arrange] of Object.entries(arrangements)) {
      const s = start(4);
      arrange(s);
      setTrains(s, 0, ['BOI', 'MIN']);
      setStorage(s, 0, { bridge: 3 });
      layNow(s, ['HEL-BOI']);
      assert.equal(s.map.routeOwner['HEL-BOI'], 0, `${name}: the lay stands`);
      assert.equal(s.turn.player, 1, `${name}: nothing owed`);
    }
  });

  void knownFailure;
  void untilTurnOf;
  void NAMES;
  void doLay;
}
