// Rules audit (pr2e), part 5: P15 trains, P16 buildings on the map (carriages included),
// P17 tolls.

import {
  assert, E, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, check, knownFailure, refused, has, offers,
  frame, chooseLay, doLay, layNow, eventOf, setHouses, setHats, vp, vpTotal, atFinancier,
} from './kit.mjs';

function scene({ players = 3, trains = ['SEA', 'MIN'], tiles = {}, laid = [], buildings = [], variants = {} } = {}) {
  const s = start(players, { variants });
  setTrains(s, 0, trains);
  setStorage(s, 0, tiles);
  layRoutes(s, laid, 1);
  for (const [kind, city, owner] of buildings) build(s, kind, city, owner);
  return s;
}

/** Anna lays Seattle - Yakima (T), so that she arrives in Yakima. */
function arriveYakima(arrange, variants = {}) {
  const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, variants });
  if (arrange) arrange(s);
  layNow(s, ['SEA-YAK']);
  return s;
}

export default function part5() {
  // -------------------------------------------------------------------------
  // P15 - trains
  // -------------------------------------------------------------------------

  check('P15.1', 'two trains each, one in the west and one in the east after the draft', () => {
    for (const n of [2, 3, 4]) {
      const s = start(n);
      for (const p of s.players) {
        assert.equal(p.railheads.length, 2);
        const sides = p.railheads.map((c) => E.startSide(c)).sort();
        assert.deepEqual(sides, ['east', 'west']);
      }
    }
  });

  check('P15.2', 'a train moves only at the end of a lay, from the lay\'s start to its destination; no other action moves it', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2, bridge: 2 } });
    const before = s.players[0].railheads.slice();
    // A Collect action and a board activation move nothing.
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hats: 0 });
    assert.deepEqual(s.players[0].railheads, before);
    // A lay moves exactly the train that laid.
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2, bridge: 2 } });
    layNow(t, ['FAR-MIN'], 1);
    assert.deepEqual(t.players[0].railheads, ['SEA', 'FAR']);
    // No train-only action exists.
    assert.ok(!('moveTrain' in E.ACTIONS) && !('moveRailhead' in E.ACTIONS));
  });

  check('P15.2/zero-tile', 'travel without laying exists only as the zero-tile lay, which ends with a building', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'] });
    layNow(s, ['SEA-YAK']);
    assert.equal(s.players[0].railheads[0], 'YAK');
    assert.equal(frame(s), 'placeBuildings');
  });

  check('P15.3', 'any number of trains of any players may share a city; they never block a path', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
    setTrains(s, 1, ['YAK', 'MIN']);
    setTrains(s, 2, ['YAK', 'YAK'].map((c, i) => (i === 0 ? 'YAK' : 'FTW')));
    layNow(s, ['SEA-YAK']);
    assert.equal(s.players[0].railheads[0], 'YAK');
    assert.equal(E.railheadsAt(s, 'YAK').length, 3, 'Anna\'s train joins two others on Spokane');
    // A player's two trains on the same city.
    const t = scene({ trains: ['SEA', 'SEA'], tiles: { tunnel: 1 } });
    layNow(t, ['SEA-YAK']);
    assert.deepEqual(t.players[0].railheads, ['YAK', 'SEA'], 'the lay started from the first of two trains on one city');
  });

  check('P15.4', 'any laid route may be used whoever laid it; the price is the toll and 1 VP tiles to a connected city', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 2 }, laid: ['SEA-TDL'], buildings: [['railwayStation', 'TDL', 1], ['railwayStation', 'SPO', 2]] });
    const ev = layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 1, 'toll'), 3, 'Ben\'s building in The Dalles, which the train moved through');
    assert.equal(vp(s, 2, 'toll'), 3, 'Cara\'s in Spokane, where it ended');
    assert.equal(vp(s, 0, 'track'), 2 * 1, 'tiles leading to a connected city: 1 VP');
    assert.ok(ev.length > 0);
  });

  check('P15.5', 'a train with no legal lay cannot be used; a player with no legal lay cannot choose Lay Track', () => {
    const s = scene({ trains: ['LAX', 'FTW'], tiles: { ground: 5 } });
    // Fresno - Los Angeles needs a Bridge; Wichita - Fort Worth and Abilene - Fort Worth need Tunnels; Los Angeles - San Bernardino is one Ground: affordable.
    assert.equal(E.hasLegalLay(s, 0), true);
    chooseLay(s);
    assert.deepEqual(s.players[0].railheads, ['SBD', 'FTW'], 'only the Los Angeles train had a lay (Los Angeles - San Bernardino, 1 Ground): the engine made it');
    const t = scene({ trains: ['LAX', 'FTW'], tiles: {} });
    assert.equal(E.hasLegalLay(t, 0), false);
    assert.notEqual(E.getDistrictActionBlockReason(t, 0, 'D5', 'lay'), null);
  });

  // -------------------------------------------------------------------------
  // P16 - buildings
  // -------------------------------------------------------------------------

  check('P16.1/inland', 'buildings go only in the 27 inland cities', () => {
    const s = scene({ trains: ['POR', 'MIN'], tiles: { tunnel: 2 } });
    for (const c of E.MAP.startCities) assert.equal(E.canPlaceArrivalBuilding(s, 0, c.id ?? c), false);
    for (const c of E.MAP.inlandCities) assert.equal(E.canPlaceArrivalBuilding(s, 0, c.id ?? c), true);
    assert.equal(E.MAP.inlandCities.length, 27);
  });

  check('P16.1/one-each', 'at most one railway station and one telegraph station per city', () => {
    const s = arriveYakima((st) => build(st, 'railwayStation', 'YAK', 1));
    refused(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
  });

  check('P16.1/different-owners', 'the two buildings of a city belong to different players: a player may never own both', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 0]] });
    s.players[0].telegraphsPlaced = 1;
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    // The same holds for the special actions: Collect Coins into a city with Anna\'s own telegraph station.
    const t = start(2);
    build(t, 'telegraphStation', 'YAK', 0);
    setStorage(t, 0, { iron: 1 });
    put(t, 0, 'W10');
    act(t, { type: 'placeWorker', space: 'W12' });
    act(t, { type: 'chooseDistrict', district: 'D9', hats: 0 });
    assert.ok(!has(t, 'placeRailwayStation', { city: 'YAK' }));
  });

  check('P16.2/1-3', 'a railway station: the city has none and is not under the player\'s own telegraph station; the player chooses a track that still has a house and takes its leftmost house', () => {
    const s = arriveYakima((st) => build(st, 'telegraphStation', 'YAK', 1));
    s.players[0].houses = { wood: 3, iron: 0, gunpowder: 1, coins: 3 };
    assert.deepEqual([...new Set(offers(s, 'placeRailwayStation').map((a) => a.houseTrack))].sort(), ['coins', 'gunpowder', 'wood'], 'iron has no house left');
    refused(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'iron' });
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'gunpowder' });
    assert.equal(s.players[0].houses.gunpowder, 0);
  });

  check('P16.2/4-5', 'placing a railway station raises that track\'s production by 1 at once and scores no VP', () => {
    const s = arriveYakima((st) => build(st, 'telegraphStation', 'YAK', 1));
    const before = E.production(s, 0, 'iron');
    const total = vpTotal(s, 0);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'iron' });
    assert.equal(E.production(s, 0, 'iron'), before + 1);
    assert.equal(vpTotal(s, 0), total);
  });

  const TELE = [1, 2, 3, 4, 5, 6, 9];
  check('P16.3/row', 'a telegraph station is the bottom one of the row and scores 1, 2, 3, 4, 5, 6, 9 VP for the first to the seventh', () => {
    TELE.forEach((value, n) => {
      const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 } });
      s.players[0].telegraphsPlaced = n;
      setHouses(s, 0, 0); // only a telegraph station is possible: the engine places it
      layNow(s, ['SEA-YAK']);
      assert.equal(vp(s, 0, 'telegraph'), value, `station ${n + 1}`);
      assert.equal(s.players[0].telegraphsPlaced, n + 1);
    });
  });

  check('P16.3/none-left', 'with all seven telegraph stations placed no telegraph station can be placed', () => {
    const s = arriveYakima((st) => { st.players[0].telegraphsPlaced = 7; });
    assert.deepEqual(types(s), ['placeRailwayStation']);
    assert.equal(E.telegraphsLeft(s, 0), 0);
  });

  check('P16.3/1', 'a telegraph station: the city has none and the player does not own its railway station', () => {
    const s = start(2);
    build(s, 'railwayStation', 'YAK', 0);
    build(s, 'telegraphStation', 'REN', 1);
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'YAK'), false);
    assert.equal(E.canPlaceArrivalBuilding(s, 0, 'REN'), true, 'a railway station is possible there');
  });

  check('P16.4', 'buildings reach the map only by arrival after a lay, the Collect Gunpowder and Collect Coins special actions, and Congress K7: none are offered at an ordinary decision', () => {
    const s = start(2);
    assert.ok(!types(s).some((t) => /Station/.test(t)));
    act(s, { type: 'placeWorker', space: 'W3' });
    act(s, { type: 'chooseDistrict', district: 'D4', hats: 0 });
    assert.ok(!types(s).some((t) => /Station/.test(t)));
    refused(start(2), { type: 'placeTelegraphStation', city: 'YAK' });
    refused(start(2), { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
  });

  // ---- P16.5: carriages -----------------------------------------------------------------------

  for (const [n, carriages, capacity] of [[0, 1, 9], [1, 2, 12], [2, 3, 15], [3, 3, 15]]) {
    check(`P16.5/${n + 1}`, `the ${n + 1}${['st', 'nd', 'rd', 'th'][n]} railway station placed by Lay Track ${n < 3 ? `brings carriage ${n + 1}` : 'brings nothing'} (storage ${capacity})`, () => {
      const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
      if (n > 0) giveCarriages(s, 0, Array.from({ length: Math.min(n, 3) }, () => [null, null]));
      s.players[0].layStationsPlaced = n;
      layNow(s, ['SEA-YAK']);
      act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
      if (n === 0) {
        assert.equal(frame(s), 'chooseFreeSpecialist');
        act(s, { type: 'chooseFreeSpecialist', specialist: 'crew' });
      }
      assert.equal(s.players[0].train.specialistCarriages.length, carriages);
      assert.equal(E.storageCapacity(s, 0), capacity);
      assert.equal(s.players[0].layStationsPlaced, n + 1);
      assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.number), [1, 2, 3].slice(0, carriages));
    });
  }

  check('P16.5/free', 'carriage 1 comes with a free specialist of any type with tokens left, into its space 1; if every pile is empty, none', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    s.supply.specialists = { crew: 0, miner: 1, engineer: 0, financier: 2 };
    layNow(s, ['SEA-YAK']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.deepEqual(offers(s, 'chooseFreeSpecialist').map((a) => a.specialist).sort(), ['financier', 'miner']);
    act(s, { type: 'chooseFreeSpecialist', specialist: 'miner' });
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['miner', null]);
    assert.equal(s.supply.specialists.miner, 0);
    const t = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]] });
    t.supply.specialists = { crew: 0, miner: 0, engineer: 0, financier: 0 };
    layNow(t, ['SEA-YAK']);
    act(t, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(t.players[0].train.specialistCarriages.length, 1);
    assert.deepEqual(t.players[0].train.specialistCarriages[0].slots, [null, null]);
    assert.notEqual(frame(t), 'chooseFreeSpecialist');
  });

  check('P16.5/telegraph-instead', 'choosing a telegraph station instead (both kinds possible) takes no carriage; declining is impossible', () => {
    const s = arriveYakima(null);
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
    assert.equal(s.players[0].layStationsPlaced, 0);
  });

  check('P16.5/zero-tile', 'a railway station placed on arrival after a zero-tile lay counts towards carriages too', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-YAK'] });
    s.players[0].telegraphsPlaced = 7; // only a railway station is possible
    layNow(s, ['SEA-YAK']);
    assert.equal(vp(s, 0, 'track'), 0, 'no tile was laid');
    assert.deepEqual(types(s), ['placeRailwayStation']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(s.players[0].train.specialistCarriages.length, 1);
    assert.equal(s.players[0].layStationsPlaced, 1);
  });

  check('P16.5/forced', 'a player whose only possible building is a railway station must place it and so takes the carriage', () => {
    const s = arriveYakima((st) => build(st, 'telegraphStation', 'YAK', 1));
    assert.deepEqual(types(s), ['placeRailwayStation']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(s.players[0].train.specialistCarriages.length, 1);
  });

  check('P16.5/special', 'a railway station placed by a special action or Congress K7 neither gives a carriage nor counts', () => {
    const s = start(2);
    build(s, 'telegraphStation', 'YAK', 1);
    setStorage(s, 0, { iron: 1 });
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hats: 0 });
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
    assert.equal(s.players[0].layStationsPlaced, 0);
    const t = atFinancier(2, { coins: 3 });
    build(t, 'telegraphStation', 'REN', 1);
    act(t, { type: 'takeCongressColumn', column: 'K7' });
    act(t, { type: 'placeRailwayStation', city: 'REN', houseTrack: 'wood' });
    assert.equal(t.players[0].train.specialistCarriages.length, 0);
    assert.equal(t.players[0].layStationsPlaced, 0);
  });

  check('P16.5/tycoon-free', 'the free specialist of carriage 1 costs nothing in Tycoon Mode', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['telegraphStation', 'YAK', 1]], variants: { tycoonMode: true } });
    layNow(s, ['SEA-YAK']);
    act(s, { type: 'placeRailwayStation', city: 'YAK', houseTrack: 'wood' });
    act(s, { type: 'chooseFreeSpecialist', specialist: 'financier' });
    assert.equal(s.players[0].coins, 0, 'a Financier would cost 1 Coin and 1 Iron into carriage 1: none was paid');
    assert.equal(s.players[0].resources.iron, 0);
  });

  check('P16.6', 'buildings never move, are never removed and never change owner', () => {
    const s = arriveYakima(null);
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    const types_ = new Set(Object.keys(E.ACTIONS));
    for (const t of ['removeBuilding', 'moveBuilding', 'captureBuilding']) assert.ok(!types_.has(t));
    assert.equal(s.map.telegraphStation.YAK, 0);
  });

  check('P16.7', 'a player with no house left cannot place a railway station (or a district house); with no telegraph station left cannot place one', () => {
    const s = arriveYakima((st) => setHouses(st, 0, 0));
    assert.equal(s.map.telegraphStation.YAK, 0);
    const t = start(2);
    setHouses(t, 0, 0);
    setStorage(t, 0, { wood: 1 });
    act(t, { type: 'placeWorker', space: 'W2' });
    act(t, { type: 'chooseDistrict', district: 'D3', hats: 0 });
    assert.ok(!types(t).includes('placeDistrictHouse'));
    const u = start(2);
    build(u, 'railwayStation', 'YAK', 1);
    u.players[0].telegraphsPlaced = 7;
    setStorage(u, 0, { coins: 1 });
    act(u, { type: 'placeWorker', space: 'W1' });
    act(u, { type: 'chooseDistrict', district: 'D1', hats: 0 });
    assert.ok(!types(u).includes('placeTelegraphStation'));
  });

  // -------------------------------------------------------------------------
  // P17 - tolls
  // -------------------------------------------------------------------------

  check('P17.1', 'for every city the train enters (c1 to ck, the destination included) each building there owned by another player earns its owner 3 VP, railway and telegraph stations alike', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 }, buildings: [['railwayStation', 'TDL', 1], ['telegraphStation', 'SPO', 2]] });
    const ev = layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(vp(s, 2, 'toll'), 3);
    assert.deepEqual(ev.filter((e) => e.type === 'toll').map((e) => `${e.player}:${e.city}`).sort(), ['1:TDL', '2:SPO']);
  });

  check('P17.1/two-buildings', 'a city holding two other players\' buildings pays both owners', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 1], ['telegraphStation', 'YAK', 2]] });
    layNow(s, ['SEA-YAK']);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(vp(s, 2, 'toll'), 3);
    assert.equal(vp(s, 0, 'toll'), 0);
  });

  check('P17.1/same-owner-two-cities', 'one owner with buildings in two cities entered is paid for each', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { ground: 3, tunnel: 1, bridge: 1 }, buildings: [['railwayStation', 'TDL', 1], ['railwayStation', 'SPO', 1]] });
    layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 1, 'toll'), 6);
  });

  check('P17.2/1', 'the city the lay starts from takes no toll', () => {
    const s = scene({ trains: ['YAK', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 1], ['telegraphStation', 'YAK', 2]] });
    layNow(s, ['SEA-YAK']);
    assert.equal(vp(s, 1, 'toll'), 0);
    assert.equal(vp(s, 2, 'toll'), 0);
  });

  check('P17.2/2', 'a building pays at most once per lay, but once per lay of a multi-lay action', () => {
    const s = scene({ trains: ['SEA', 'TDL'], tiles: { tunnel: 2, bridge: 1 }, buildings: [['railwayStation', 'YAK', 1]] });
    setHats(s, 0, 1);
    chooseLay(s, 1);
    doLay(s, ['SEA-YAK'], 0);
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(s.map.telegraphStation.YAK, 0, 'the only possible building (Ben has the railway station): placed by the engine');
    doLay(s, ['YAK-TDL'], 1);
    assert.equal(vp(s, 1, 'toll'), 6, 'the second lay enters Yakima again');
  });

  check('P17.2/3', 'the player\'s own buildings pay nothing', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: { tunnel: 1 }, buildings: [['railwayStation', 'YAK', 0]] });
    layNow(s, ['SEA-YAK']);
    assert.equal(vpTotal(s, 0), 1, 'only the 1 track VP of a connected city');
    assert.equal(vp(s, 0, 'toll'), 0);
  });

  check('P17.2/4', 'the building the lay places at its destination pays nothing (not even to a later lay of the same action)', () => {
    const s = arriveYakima(null);
    act(s, { type: 'placeTelegraphStation', city: 'YAK' });
    for (const p of s.players) assert.equal(p.vp.toll, 0);
  });

  check('P17.2/5-zero', 'a zero-tile lay pays tolls', () => {
    const s = scene({ trains: ['SEA', 'MIN'], tiles: {}, laid: ['SEA-TDL', 'SPO-TDL'], buildings: [['railwayStation', 'TDL', 1]] });
    layNow(s, ['SEA-TDL', 'SPO-TDL']);
    assert.equal(vp(s, 1, 'toll'), 3);
  });

  check('P17.2/5-completion', 'the lay that completes the line pays tolls, and the owner is paid whoever lays', () => {
    const s = scene({ trains: ['GFA', 'LAX'], tiles: { bridge: 3, ground: 4 }, laid: ['SEA-YAK', 'YAK-SPO', 'SPO-GFA'], buildings: [['railwayStation', 'BIS', 1]] });
    layNow(s, ['GFA-BIS', 'FAR-BIS', 'FAR-MIN']);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(vp(s, 1, 'toll'), 3);
    assert.equal(vp(s, 0, 'completion'), (4 + 2 + 1) * 3, 'every slot of the lay at 3 VP');
  });

  check('P17.3', 'a start city never pays a toll (no building there)', () => {
    const s = scene({ trains: ['YAK', 'MIN'], tiles: { tunnel: 1 } });
    const ev = layNow(s, ['SEA-YAK']);
    assert.equal(ev.filter((e) => e.type === 'toll').length, 0);
  });

  void knownFailure;
  void eventOf;
}
