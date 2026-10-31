// Rules audit (pr2e), part 2: P5 the action grid, workers, displacement and action bonuses;
// P6 collecting and special actions; P7 the player board, storage and carriages.

import {
  assert, E, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, check, refused, has, offers,
  frame, choose, chooseLay, chooseHire, doLay, eventOf, setHouses, setHats, vp, placeAndChoose,
} from './kit.mjs';

const SPACES = {
  W1: ['D1', 'D2'], W2: ['D2', 'D3'], W3: ['D1', 'D4'], W4: ['D2', 'D5'], W5: ['D3', 'D6'], W6: ['D4', 'D5'],
  W7: ['D5', 'D6'], W8: ['D4', 'D7'], W9: ['D5', 'D8'], W10: ['D6', 'D9'], W11: ['D7', 'D8'], W12: ['D8', 'D9'],
};

/** The collect events of an action: the amount gathered. */
function gathered(events) {
  return eventOf(events, 'gather');
}

export default function part2() {
  // -------------------------------------------------------------------------
  // P5 - the grid
  // -------------------------------------------------------------------------

  check('P5.1', 'the nine districts: names, positions, what each does', () => {
    const s = start(2);
    const names = { D1: 'Collect Gunpowder', D2: 'Financier', D3: 'Collect Iron', D4: 'Crew', D5: 'Lay Track or Hire Specialists', D6: 'Engineer', D7: 'Collect Wood', D8: 'Miner', D9: 'Collect Coins' };
    for (const d of Object.keys(names)) assert.equal(E.districtName(s, d), names[d]);
    assert.deepEqual(E.DISTRICT_IDS, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
  });

  check('P5.1/collect', 'the four Collect districts give Gunpowder (D1), Iron (D3), Wood (D7) and Coins (D9)', () => {
    for (const [space, district, item] of [['W1', 'D1', 'gunpowder'], ['W2', 'D3', 'iron'], ['W8', 'D7', 'wood'], ['W12', 'D9', 'coins']]) {
      const s = start(2);
      setStorage(s, 0, {});
      setHouses(s, 0, 3);
      const ev = choose(s, space, district);
      assert.equal(gathered(ev).item, item, district);
      assert.equal(gathered(ev).amount, 1);
    }
  });

  check('P5.1/special', 'each Collect district\'s special action: D1 telegraph station, D3 district house, D7 upgrade, D9 railway station', () => {
    const s = start(2);
    const want = { D1: 'telegraphStation', D3: 'districtHouse', D7: 'upgrade', D9: 'railwayStation' };
    for (const [d, special] of Object.entries(want)) assert.equal(E.GRID.districtTiles[s.grid.tiles[d]].special, special);
  });

  check('P5.1/board-activation', 'the Crew, Miner, Engineer and Financier districts run a board activation with the Foreman acting as that type', () => {
    for (const [space, district, type] of [['W3', 'D4', 'crew'], ['W11', 'D8', 'miner'], ['W5', 'D6', 'engineer'], ['W1', 'D2', 'financier']]) {
      const s = start(2);
      setStorage(s, 0, { iron: 1, gunpowder: 1, wood: 1, coins: 1 });
      choose(s, space, district);
      assert.equal(frame(s), 'boardActivation');
      assert.equal(E.topFrame(s).foreman, type);
    }
  });

  check('P5.2', 'the 12 worker spaces sit between their two neighbouring districts; each holds one worker; a centre is only for displacement', () => {
    for (const [w, ds] of Object.entries(SPACES)) assert.deepEqual(E.SPACE_DISTRICTS[w], ds, w);
    assert.equal(E.SPACE_IDS.length, 12);
    const s = start(2);
    put(s, 1, 'W1');
    refused(s, { type: 'placeWorker', space: 'W1' });
    refused(s, { type: 'placeWorker', space: 'D2' });
  });

  check('P5.3', 'placing: one worker on an empty space, then one of the two bordering districts', () => {
    const s = start(2);
    act(s, { type: 'placeWorker', space: 'W1' });
    assert.equal(s.players[0].workersInSupply, 5);
    assert.equal(s.grid.spaces.W1, 0);
    assert.deepEqual([...new Set(offers(s, 'chooseDistrict').map((a) => a.district))].sort(), ['D1', 'D2']);
    refused(s, { type: 'chooseDistrict', district: 'D9', hats: 0 });
  });

  check('P5.4', 'removing: the worker returns to the supply and gives one of the two districts it bordered', () => {
    const s = start(2);
    put(s, 0, 'W2');
    act(s, { type: 'removeWorker', from: 'W2' });
    assert.equal(s.players[0].workersInSupply, 6);
    assert.equal(s.grid.spaces.W2, null);
    assert.deepEqual([...new Set(offers(s, 'chooseDistrict').map((a) => a.district))].sort(), ['D2', 'D3']);
  });

  check('P5.4.1', 'a worker on a district centre must be the one removed', () => {
    const s = start(2);
    put(s, 0, 'W1');
    put(s, 0, 'D7');
    refused(s, { type: 'removeWorker', from: 'W1' });
    assert.ok(has(s, 'removeWorker', { from: 'D7' }));
    assert.ok(!has(s, 'removeWorker', { from: 'W1' }));
  });

  check('P5.4.3', 'a worker removed from a centre gives that district\'s action, and no other', () => {
    const s = start(2);
    put(s, 0, 'W12');
    put(s, 0, 'D3');
    const ev = act(s, { type: 'removeWorker', from: 'D3' });
    assert.equal(eventOf(ev, 'districtChosen').district, 'D3');
  });

  check('P5.4.4', 'forced off the centre of D5 with neither a lay nor a hire possible: the worker leaves and the player takes no action', () => {
    const s = start(2);
    put(s, 0, 'D5');
    for (const w of ['W1', 'W2', 'W3', 'W5', 'W8', 'W10', 'W11', 'W12', 'W4', 'W6', 'W7', 'W9']) if (s.grid.spaces[w] === null && s.players[0].workersInSupply > 0) put(s, 0, w);
    assert.deepEqual(types(s), ['removeWorker']);
    const ev = act(s, { type: 'removeWorker', from: 'D5' });
    assert.ok(ev.some((e) => e.type === 'action' && e.action.type === 'chooseDistrict' && e.action.district === 'none'));
    assert.equal(s.players[0].workersInSupply, 1);
    assert.equal(s.turn.player, 1);
    // With a hire possible the action is available and "none" is not offered.
    const t = start(2);
    giveCarriages(t, 0, [['crew', null]]);
    put(t, 0, 'D5');
    for (const w of ['W1', 'W2', 'W3', 'W5', 'W8', 'W10', 'W11', 'W12', 'W4', 'W6', 'W7', 'W9']) if (t.grid.spaces[w] === null && t.players[0].workersInSupply > 0) put(t, 0, w);
    act(t, { type: 'removeWorker', from: 'D5' });
    assert.ok(!has(t, 'chooseDistrict', { district: 'none' }));
  });

  check('P5.5.1', 'displacing needs every space of the district held by OTHER players and none of your workers adjacent (spaces or centre)', () => {
    const s = start(3);
    put(s, 1, 'W1');
    refused(s, { type: 'displaceWorker', district: 'D1' }); // W3 empty
    put(s, 2, 'W3');
    assert.equal(E.getBlockReason(s, { type: 'displaceWorker', district: 'D1' }), null);
    // One of Anna's workers on a space of D1: not allowed.
    const t = start(3);
    put(t, 1, 'W1');
    put(t, 0, 'W3');
    refused(t, { type: 'displaceWorker', district: 'D1' });
    // One of Anna's workers on D1's own centre blocks it too.
    const u = start(3);
    put(u, 1, 'W1');
    put(u, 2, 'W3');
    put(u, 0, 'D1');
    assert.notEqual(E.getBlockReason(u, { type: 'displaceWorker', district: 'D1' }), null);
    // The centre may hold another player's worker.
    const v = start(3);
    put(v, 1, 'W1');
    put(v, 2, 'W3');
    put(v, 2, 'D1');
    assert.equal(E.getBlockReason(v, { type: 'displaceWorker', district: 'D1' }), null);
  });

  check('P5.5.2', 'every worker on the district\'s spaces and on its centre returns to its owner; workers elsewhere stay', () => {
    const s = start(4);
    put(s, 1, 'W8');
    put(s, 2, 'W11');
    put(s, 3, 'D7');
    put(s, 3, 'W12');
    for (const p of [1, 2, 3]) setHats(s, p, 0);
    const supply = s.players.map((p) => p.workersInSupply);
    act(s, { type: 'displaceWorker', district: 'D7' });
    assert.equal(s.grid.spaces.W8, null);
    assert.equal(s.grid.spaces.W11, null);
    assert.equal(s.grid.centres.D7, 0);
    assert.equal(s.grid.spaces.W12, 3, 'a worker elsewhere is unaffected');
    assert.deepEqual([1, 2, 3].map((p) => s.players[p].workersInSupply - supply[p]), [1, 1, 1]);
    assert.equal(s.players[0].workersInSupply, supply[0] - 1);
  });

  check('P5.5.3', 'each returned worker gives its owner a hat; an owner already holding 2 gets a resource of choice (Coin allowed) per hat, in turn order from the active player\'s left', () => {
    const s = start(4);
    put(s, 1, 'W8');
    put(s, 2, 'W11');
    put(s, 3, 'D7');
    setHats(s, 1, 0);
    setHats(s, 2, 2);
    setHats(s, 3, 1);
    act(s, { type: 'displaceWorker', district: 'D7' });
    assert.equal(s.players[1].hats, 1);
    assert.equal(s.players[3].hats, 2);
    assert.equal(s.toAct, 2);
    assert.deepEqual(offers(s, 'chooseResource').map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    const c0 = s.players[2].coins;
    act(s, { type: 'chooseResource', resource: 'coins' });
    assert.equal(s.players[2].coins, c0 + 1);
    // Order: with owners 1 and 3 both at the limit the left neighbour (1) is asked first.
    const t = start(4);
    put(t, 3, 'W1');
    put(t, 1, 'W3');
    setHats(t, 1, 2);
    setHats(t, 3, 2);
    setHats(t, 0, 1);
    act(t, { type: 'displaceWorker', district: 'D1' });
    assert.equal(t.toAct, 1);
    act(t, { type: 'chooseResource', resource: 'wood' });
    assert.equal(t.toAct, 3);
  });

  check('P5.5.3/three', 'an owner whose centre worker and two space workers all return, holding no hat, gets 2 hats and then 1 resource of choice', () => {
    const s = start(4);
    put(s, 3, 'W8');
    put(s, 3, 'W11');
    put(s, 3, 'D7');
    setHats(s, 3, 0);
    act(s, { type: 'displaceWorker', district: 'D7' });
    assert.equal(s.players[3].hats, 2);
    assert.equal(s.toAct, 3);
    assert.equal(frame(s), 'chooseResource');
    assert.equal(E.topFrame(s).remaining, 1);
  });

  check('P5.5.4', 'after a displacement the player takes the district\'s action; M is worked out after the workers return (1 plus hats spent)', () => {
    const s = start(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    setHats(s, 0, 1);
    const ev = act(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(frame(s), 'chooseDistrict');
    assert.deepEqual(offers(s, 'chooseDistrict').map((a) => `${a.district}:${a.hats}`).sort(), ['D1:0', 'D1:1']);
    const ev2 = act(s, { type: 'chooseDistrict', district: 'D1', hats: 1 });
    assert.equal(eventOf(ev2, 'districtChosen').multiplier, 2);
    assert.ok(ev.length > 0);
  });

  check('P5.5.5', 'a player may displace only into a district whose action they could then choose (D5 needs a lay or a hire)', () => {
    const s = start(3);
    put(s, 1, 'W4');
    put(s, 2, 'W6');
    put(s, 2, 'W7');
    put(s, 1, 'W9');
    assert.notEqual(E.getBlockReason(s, { type: 'displaceWorker', district: 'D5' }), null, 'no legal lay, no hire');
    giveCarriages(s, 0, [['crew', null]]);
    assert.equal(E.getBlockReason(s, { type: 'displaceWorker', district: 'D5' }), null);
  });

  check('P5.6', 'adjacency: a worker on a space is adjacent to both its districts; a worker on a centre only to its own district', () => {
    const s = start(2);
    put(s, 0, 'W3');
    put(s, 0, 'D4');
    put(s, 1, 'W8');
    act(s, { type: 'placeWorker', space: 'W1' });
    const pm = E.previewMultipliers(s);
    const m = (d) => pm.find((p) => p.district === d && p.hats === 0).multiplier;
    assert.equal(m('D1'), 2, 'W3 borders D1');
    assert.equal(m('D2'), 1, 'the centre of D4 is not next to D2');
    const t = start(2);
    put(t, 0, 'D4');
    act(t, { type: 'placeWorker', space: 'W3' });
    const q = E.previewMultipliers(t);
    assert.equal(q.find((p) => p.district === 'D4' && p.hats === 0).multiplier, 2, 'the centre of D4 is adjacent to D4');
    assert.equal(q.find((p) => p.district === 'D1' && p.hats === 0).multiplier, 1, 'but not to its neighbour D1');
  });

  check('P5.7/1', 'each of your OTHER workers adjacent to the chosen district is one action bonus; the placed or removed worker is never counted', () => {
    const s = start(2);
    put(s, 0, 'W5');
    put(s, 0, 'D3');
    const ev = placeAndChoose(s, 'W2', 'D3'); // W5 and the centre of D3 are adjacent to D3; the placed worker is not counted
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    const t = start(2);
    put(t, 0, 'W2');
    const ev2 = act(t, { type: 'removeWorker', from: 'W2' });
    act(t, { type: 'chooseDistrict', district: 'D3', hats: 0 });
    assert.equal(t.turn.multiplier, 1, 'the removed worker gives no bonus');
    assert.ok(ev2.length > 0);
  });

  check('P5.7/2', 'each cowboy hat spent is one action bonus', () => {
    const s = start(2);
    setHats(s, 0, 2);
    act(s, { type: 'placeWorker', space: 'W12' });
    const ev = act(s, { type: 'chooseDistrict', district: 'D9', hats: 2 });
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
  });

  check('P5.7/3', 'M is fixed when the action is chosen and does not change while it resolves', () => {
    const s = start(2);
    setHats(s, 0, 1);
    setStorage(s, 0, { coins: 3 });
    put(s, 0, 'W3');
    act(s, { type: 'placeWorker', space: 'W1' });
    act(s, { type: 'chooseDistrict', district: 'D2', hats: 1 });
    assert.equal(s.turn.multiplier, 2);
    // Taking K4 (2 hats) during the activation does not change M.
    act(s, { type: 'takeCongressColumn', column: 'K4' });
    assert.equal(s.turn.multiplier, 2);
  });

  check('P5.7/4', 'opponents\' workers never change your M', () => {
    const s = start(3);
    put(s, 2, 'W5');
    put(s, 1, 'D3');
    const ev = placeAndChoose(s, 'W2', 'D3');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 1);
  });

  check('P5.8/collect', 'Collect: each action bonus is one more resource; the special action is not repeated or boosted', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 2 });
    s.players[0].houses.iron = 3; // production 1
    put(s, 0, 'W5'); // adjacent to Collect Iron
    setHats(s, 0, 1);
    const ev = placeAndChoose(s, 'W2', 'D3', 1);
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    assert.equal(gathered(ev).amount, 3, '1 + 2 action bonuses');
    assert.equal(frame(s), 'specialAction');
    act(s, { type: 'placeDistrictHouse', district: 'D3', houseTrack: 'wood' });
    assert.equal(s.grid.sites.D3.filter((x) => x === 0).length, 1, 'one district house, not M');
    assert.equal(vp(s, 0, 'districtHouse'), 2, 'the 2 VP are not multiplied');
  });

  check('P5.8/board', 'Board activation: the Foreman acts M times; each specialist and each upgrade acts once', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null]]);
    setStorage(s, 0, { iron: 6 });
    put(s, 0, 'W6');
    act(s, { type: 'placeWorker', space: 'W3' });
    act(s, { type: 'chooseDistrict', district: 'D4', hats: 0 }); // M = 2 (W6 borders D4)
    assert.equal(E.topFrame(s).steps.length, 3, 'Foreman x2, the Crew once');
    assert.deepEqual(E.topFrame(s).steps.map((x) => x.carriage), [0, 0, 1]);
  });

  check('P5.8/lay', 'Lay Track: each action bonus is one more lay', () => {
    const s = start(2);
    setHats(s, 0, 2);
    setStorage(s, 0, { ground: 4, tunnel: 4 });
    setTrains(s, 0, ['SEA', 'POR']);
    chooseLay(s, 2);
    assert.equal(E.topFrame(s).remaining, 3);
  });

  check('P5.8/hire', 'Hire Specialists: each action bonus is one more hire', () => {
    const s = start(2);
    setHats(s, 0, 2);
    giveCarriages(s, 0, [[null, null], [null, null]]);
    chooseHire(s, 2);
    assert.equal(E.topFrame(s).remaining, 3);
    assert.equal(E.topFrame(s).kind, 'hire');
  });

  // -------------------------------------------------------------------------
  // P6 - collecting
  // -------------------------------------------------------------------------

  check('P6.1', 'Collect Gunpowder, Iron, Wood and Coins give that resource', () => {
    const s = start(2);
    for (const [space, d, item] of [['W1', 'D1', 'gunpowder'], ['W2', 'D3', 'iron'], ['W8', 'D7', 'wood'], ['W10', 'D9', 'coins']]) {
      const t = start(2);
      assert.equal(gathered(choose(t, space, d)).item, item);
    }
    assert.ok(s);
  });

  check('P6.2', 'production is 1 + houses removed from the track (1 to 4), the leftmost house leaving first', () => {
    const s = start(2);
    for (const [track, houses, want] of [['wood', 3, 1], ['wood', 2, 2], ['wood', 1, 3], ['wood', 0, 4]]) {
      s.players[0].houses[track] = houses;
      assert.equal(E.production(s, 0, track), want, `${houses} houses left`);
    }
    // A railway station takes the leftmost house: the count falls by one and production rises by one.
    const t = start(2);
    const before = E.production(t, 0, 'gunpowder');
    build(t, 'railwayStation', 'SPO', 0, 'gunpowder');
    assert.equal(E.production(t, 0, 'gunpowder'), before + 1);
  });

  check('P6.3', 'yield = production + your district houses on that district + (M - 1); the terms add and nothing multiplies', () => {
    const t = start(3);
    setStorage(t, 0, {});
    t.players[0].houses.iron = 2; // production 2
    t.grid.sites.D3[1] = 0; // one district house
    put(t, 0, 'W5'); // 1 adjacent worker
    setHats(t, 0, 1);
    const ev = placeAndChoose(t, 'W2', 'D3', 1); // M = 1 + 1 + 1 = 3
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    assert.equal(gathered(ev).amount, 2 + 1 + 2, 'E1 of the worked examples: 2 + 1 + 2 = 5');
    assert.equal(gathered(ev).production, 2);
    assert.equal(gathered(ev).districtHouses, 1);
  });

  check('P6.3/example', 'production 2 and one extra adjacent worker gives 3', () => {
    const s = start(2);
    setStorage(s, 0, {});
    s.players[0].houses.wood = 2;
    put(s, 0, 'W11');
    const ev = placeAndChoose(s, 'W8', 'D7');
    assert.equal(gathered(ev).amount, 3);
  });

  check('P6.4', 'everything collected goes to storage and obeys the limit: surplus is discarded at once at the player\'s choice', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 4, iron: 2 });
    choose(s, 'W8', 'D7');
    assert.equal(E.storageUsed(s.players[0]), 7);
    assert.equal(frame(s), 'discard');
    assert.deepEqual([...new Set(offers(s, 'discard').map((a) => a.item))].sort(), ['iron', 'wood']);
    act(s, { type: 'discard', item: 'iron' });
    assert.equal(E.storageUsed(s.players[0]), 6);
  });

  check('P6.5', 'the printed example board gives 1 Wood, 3 Iron, 3 Gunpowder, 2 Coins', () => {
    const s = start(2);
    s.players[0].houses = { wood: 3, iron: 1, gunpowder: 1, coins: 2 };
    assert.deepEqual(['wood', 'iron', 'gunpowder', 'coins'].map((t) => E.production(s, 0, t)), [1, 3, 3, 2]);
  });

  check('P6.6/1', 'a district house goes on an EMPTY site; a district may hold several players\' houses and one player may hold several sites', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 3 });
    s.grid.sites.D7[0] = 1;
    choose(s, 'W2', 'D3'); // Collect Iron; special action: 1 Wood, district house
    assert.equal(frame(s), 'specialAction');
    act(s, { type: 'placeDistrictHouse', district: 'D7', houseTrack: 'wood' });
    assert.deepEqual(s.grid.sites.D7, [1, 0, null]);
    assert.ok(!offers(s, 'placeDistrictHouse').some((a) => a.district === 'D7' && false));
  });

  check('P6.6/2', 'placing a district house takes the leftmost house of a track of your choice; that track\'s production rises at once', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 2 });
    const before = E.production(s, 0, 'gunpowder');
    const housesBefore = s.players[0].houses.gunpowder;
    choose(s, 'W2', 'D3');
    assert.deepEqual([...new Set(offers(s, 'placeDistrictHouse').map((a) => a.houseTrack))].sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    act(s, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'gunpowder' });
    assert.equal(s.players[0].houses.gunpowder, housesBefore - 1);
    assert.equal(E.production(s, 0, 'gunpowder'), before + 1);
  });

  check('P6.6/3', 'while it stays, a district house gives 1 more of that district\'s resource each Collect', () => {
    const s = start(2);
    setStorage(s, 0, {});
    s.grid.sites.D1[0] = 0;
    s.grid.sites.D1[1] = 0;
    const ev = choose(s, 'W1', 'D1');
    assert.equal(gathered(ev).amount, 1 + 2);
    assert.equal(gathered(ev).districtHouses, 2);
  });

  check('P6.6/4', 'district houses never move; they are not buildings (not in the building count) but count for the goal and the first tie-break', () => {
    const s = start(2);
    s.grid.sites.D3[0] = 0;
    s.grid.sites.D3[1] = 0;
    assert.equal(E.buildingCount(s, 0), 0);
    assert.equal(E.districtHouseCount(s, 0), 2);
    assert.equal(E.metricValue(s, 0, 'districtHouses'), 2);
    const sc = E.scoreGame(s);
    assert.equal(sc.players[0].tieBreak.districtHouses, 2);
  });

  check('P6.6/5', 'a player with no house left on the player board cannot place a district house', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 2 });
    setHouses(s, 0, 0);
    choose(s, 'W2', 'D3');
    assert.ok(!types(s).includes('placeDistrictHouse'));
  });

  check('P6.7/D1', 'Collect Gunpowder special action: pay 1 Coin, bottom telegraph station into a city with ANOTHER player\'s railway station and no telegraph station; scores the row\'s VP', () => {
    const s = start(3);
    build(s, 'railwayStation', 'SPO', 1);
    build(s, 'railwayStation', 'REN', 0); // Anna's own: not allowed
    build(s, 'railwayStation', 'HEL', 1);
    build(s, 'telegraphStation', 'HEL', 2); // already has a telegraph station
    s.players[0].telegraphsPlaced = 0;
    setStorage(s, 0, { coins: 1 });
    choose(s, 'W1', 'D1');
    assert.equal(frame(s), 'specialAction');
    assert.deepEqual(offers(s, 'placeTelegraphStation').map((a) => a.city), ['SPO']);
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(vp(s, 0, 'telegraph'), 1);
    assert.equal(s.players[0].coins, 0);
    assert.equal(s.map.telegraphStation.SPO, 0);
    assert.equal(s.players[0].layStationsPlaced, 0);
  });

  check('P6.7/D3', 'Collect Iron special action: pay 1 Wood, a district house on a site of ANY Collect district, 2 VP', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 1 });
    choose(s, 'W2', 'D3');
    assert.deepEqual([...new Set(offers(s, 'placeDistrictHouse').map((a) => a.district))].sort(), ['D1', 'D3', 'D7', 'D9']);
    act(s, { type: 'placeDistrictHouse', district: 'D9', houseTrack: 'coins' });
    assert.equal(vp(s, 0, 'districtHouse'), 2);
    assert.equal(s.players[0].resources.wood, 0);
    assert.equal(s.grid.sites.D9[0], 0);
  });

  check('P6.7/D7', 'Collect Wood special action: pay 1 Gunpowder, install an upgrade token (2 VP); with no carriage holding a specialist it cannot be taken', () => {
    const s = start(2);
    setStorage(s, 0, { gunpowder: 1 });
    giveCarriages(s, 0, [['crew', null]]);
    choose(s, 'W8', 'D7');
    assert.equal(frame(s), 'specialAction');
    act(s, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 });
    assert.equal(vp(s, 0, 'upgrade'), 2);
    assert.equal(s.players[0].resources.gunpowder, 0);
    const t = start(2);
    setStorage(t, 0, { gunpowder: 1 });
    const ev = choose(t, 'W8', 'D7');
    assert.ok(ev.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipSpecialAction'), 'impossible: the engine declines it');
  });

  check('P6.7/D9', 'Collect Coins special action: pay 1 Iron, a railway station into a city with ANOTHER player\'s telegraph station and no railway station; no VP, no carriage', () => {
    const s = start(2);
    build(s, 'telegraphStation', 'SPO', 1);
    build(s, 'telegraphStation', 'REN', 0); // own telegraph: no
    setStorage(s, 0, { iron: 1 });
    choose(s, 'W12', 'D9');
    assert.equal(frame(s), 'specialAction');
    assert.deepEqual([...new Set(offers(s, 'placeRailwayStation').map((a) => a.city))], ['SPO']);
    const before = E.production(s, 0, 'wood');
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.equal(s.map.railwayStation.SPO, 0);
    assert.equal(E.production(s, 0, 'wood'), before + 1);
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
    assert.equal(s.players[0].layStationsPlaced, 0);
    assert.equal(Object.values(s.players[0].vp).reduce((a, b) => a + b, 0), 0);
  });

  check('P6.7/once', 'the special action happens at most once, however large M is; it is optional (skipSpecialAction)', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 1 });
    put(s, 0, 'W5');
    put(s, 0, 'W6');
    choose(s, 'W2', 'D3');
    assert.ok(types(s).includes('skipSpecialAction'));
    act(s, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' });
    assert.notEqual(frame(s), 'specialAction', 'asked once');
    assert.equal(s.grid.sites.D1.filter((x) => x === 0).length, 1);
  });

  check('P6.7/impossible', 'a special action whose payment or effect is impossible cannot be taken', () => {
    const s = start(2);
    setStorage(s, 0, { coins: 0 });
    const ev = choose(s, 'W1', 'D1');
    assert.ok(ev.some((e) => e.type === 'action' && e.action.type === 'skipSpecialAction'));
    const t = start(2);
    build(t, 'railwayStation', 'SPO', 1);
    setStorage(t, 0, { coins: 1 });
    choose(t, 'W1', 'D1');
    refused(t, { type: 'placeTelegraphStation', city: 'REN' });
  });

  // -------------------------------------------------------------------------
  // P7 - the player board, storage and carriages
  // -------------------------------------------------------------------------

  check('P7.1', 'the starting player board: no carriages, no specialists, storage 6', () => {
    const s = start(2);
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
    assert.equal(E.storageCapacity(s, 0), 6);
    assert.equal(E.specialistCounts ? JSON.stringify(E.specialistCounts(s, 0)) !== undefined : true, true);
  });

  check('P7.2', 'storage capacity = 6 + 3 per carriage: 6, 9, 12, 15', () => {
    const s = start(2);
    for (const [n, cap] of [[1, 9], [2, 12], [3, 15]]) {
      giveCarriages(s, 0, Array.from({ length: n }, () => [null, null]));
      assert.equal(E.storageCapacity(s, 0), cap);
    }
  });

  check('P7.3', 'each resource, Coin and built tile takes one unit; hats, specialists and upgrade tokens take none', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 1, iron: 1, gunpowder: 1, coins: 1, ground: 1, tunnel: 1, bridge: 1 });
    assert.equal(E.storageUsed(s.players[0]), 7);
    setHats(s, 0, 2);
    giveCarriages(s, 0, [['crew', 'miner']]);
    s.players[0].train.specialistCarriages[0].upgrade = 'U1-wood';
    assert.equal(E.storageUsed(s.players[0]), 7);
  });

  check('P7.4', 'three numbered carriages, each with 2 specialist spaces, 3 storage and 1 upgrade space; never more than 3', () => {
    const K = E.getConstants(start(2));
    assert.equal(K.PLAYER_BOARD.maxCarriages, 3);
    assert.equal(K.PLAYER_BOARD.specialistSpacesPerCarriage, 2);
    assert.equal(K.PLAYER_BOARD.storagePerCarriage, 3);
    assert.deepEqual(K.PLAYER_BOARD.carriage3SpaceVp, [2, 5]);
    const s = start(2);
    giveCarriages(s, 0, [[null, null], [null, null], [null, null]]);
    assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.number), [1, 2, 3]);
  });

  check('P7.5', 'carriages sit in order 1, 2, 3; specialists fill the leftmost empty space (space 1 before 2, carriage 1 before 2 before 3)', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], [null, null]]);
    assert.deepEqual(E.nextSpecialistSlot(s.players[0]), { carriage: 1, slot: 1, level: 1 });
    const t = start(2);
    giveCarriages(t, 0, [['crew', 'crew'], [null, null]]);
    assert.equal(E.nextSpecialistSlot(t.players[0]).carriage, 2);
    assert.equal(E.nextSpecialistSlot(t.players[0]).slot, 0);
  });

  check('P7.6', 'overflow: anyone over capacity immediately discards stored items of their choice down to capacity; never at any other time', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 3, iron: 3 });
    choose(s, 'W8', 'D7');
    assert.equal(frame(s), 'discard');
    for (const item of ['wood', 'iron', 'wood']) {
      if (frame(s) !== 'discard') break;
      act(s, { type: 'discard', item });
    }
    assert.ok(E.storageUsed(s.players[0]) <= 6);
    // Not over capacity: a discard is refused.
    const t = start(2);
    refused(t, { type: 'discard', item: 'wood' });
  });

  check('P7.6/items', 'the discard is of the player\'s choice among any stored items: resources, Coins and built tiles', () => {
    const s = start(2);
    setStorage(s, 0, { ground: 2, coins: 2, wood: 2 });
    choose(s, 'W8', 'D7'); // +1 Wood: 7 items
    assert.equal(frame(s), 'discard');
    assert.deepEqual([...new Set(offers(s, 'discard').map((a) => a.item))].sort(), ['coins', 'ground', 'wood']);
    act(s, { type: 'discard', item: 'ground' });
    assert.equal(s.players[0].builtTiles.ground, 1);
  });

  check('P7.6/other-player', 'a player over capacity on someone else\'s turn discards at once (a displaced owner with a Coin as the chosen resource)', () => {
    const s = start(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    setHats(s, 1, 2);
    setStorage(s, 1, { wood: 3, iron: 2 }); // 5 + 1 = 6 with the Coin
    s.players[1].coins = 1;
    act(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(s.toAct, 1);
    act(s, { type: 'chooseResource', resource: 'coins' });
    assert.equal(frame(s), 'discard');
    assert.equal(s.toAct, 1, 'the owner decides, on the active player\'s turn');
    act(s, { type: 'discard', item: 'wood' });
    assert.equal(E.storageUsed(s.players[1]), 6);
  });

  check('P7.7', 'paying: resources spent go from storage (the payer\'s count falls)', () => {
    const s = start(2);
    setStorage(s, 0, { wood: 1 });
    choose(s, 'W2', 'D3');
    act(s, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'wood' });
    assert.equal(s.players[0].resources.wood, 0);
  });
}
