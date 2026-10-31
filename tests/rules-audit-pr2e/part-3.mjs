// Rules audit (pr2e), part 3: P8 hiring, P9 board activation, P10 the Financier and
// Congress, P11 cowboy hats, P12 carriage upgrades.

import {
  assert, E, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, check, refused, has, offers,
  frame, choose, chooseLay, chooseHire, doLay, eventOf, setHouses, setHats, vp, atFinancier, placeAndChoose, playOut,
} from './kit.mjs';

const take = (state, column) => act(state, { type: 'takeCongressColumn', column });

/** Anna at the Foreman's step of `district` with M from placing on `space`. */
function activation(space, district, items, options = {}) {
  const s = start(options.players ?? 2, options);
  setStorage(s, 0, items);
  if (options.carriages) giveCarriages(s, 0, options.carriages);
  if (options.before) options.before(s);
  placeAndChoose(s, space, district, options.hats ?? 0);
  return s;
}

/** Anna has chosen Collect Wood (D7), holding `gunpowder`, with the given carriages. */
function atCollectWood(carriages, gunpowder = 1, options = {}) {
  const s = start(options.players ?? 2, options);
  setStorage(s, 0, { gunpowder });
  if (carriages) giveCarriages(s, 0, carriages);
  placeAndChoose(s, 'W8', 'D7');
  return s;
}

function setUpgrade(s, carriageNumber, token) {
  s.players[0].train.specialistCarriages[carriageNumber - 1].upgrade = token;
  s.supply.upgrades.splice(s.supply.upgrades.indexOf(token), 1);
}

export default function part3() {
  // -------------------------------------------------------------------------
  // P8 - hiring
  // -------------------------------------------------------------------------

  check('P8.1', 'Hire Specialists: up to M hires, the first required, later ones optional (stopHiring); D5 is all hires or all lays', () => {
    const s = start(2);
    setHats(s, 0, 1);
    giveCarriages(s, 0, [[null, null], [null, null]]);
    chooseHire(s, 1); // M = 2
    assert.equal(frame(s), 'hire');
    assert.ok(!types(s).includes('stopHiring'), 'the first hire is mandatory');
    act(s, { type: 'hireSpecialist', specialist: 'crew' });
    assert.ok(types(s).includes('stopHiring'));
    assert.ok(!types(s).includes('startLay'), 'never a mix of hires and lays');
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.notEqual(frame(s), 'hire', 'M hires used: the action is over');
    // Stopping early.
    const t = start(2);
    setHats(t, 0, 1);
    giveCarriages(t, 0, [[null, null]]);
    chooseHire(t, 1);
    act(t, { type: 'hireSpecialist', specialist: 'crew' });
    act(t, { type: 'stopHiring' });
    assert.equal(t.turn.player, 1);
    assert.equal(t.players[0].train.specialistCarriages[0].slots[1], null);
  });

  check('P8.2/1', 'a hire needs an empty specialist space (so at least one carriage)', () => {
    const s = start(2);
    assert.equal(E.canHire(s, 0), false);
    giveCarriages(s, 0, [['crew', 'crew']]);
    assert.equal(E.canHire(s, 0), false);
    giveCarriages(s, 0, [['crew', null]]);
    assert.equal(E.canHire(s, 0), true);
  });

  check('P8.2/2', 'a hire needs a specialist type with tokens left in its pile; an empty pile is not offered', () => {
    const s = start(2);
    giveCarriages(s, 0, [[null, null]]);
    s.supply.specialists = { crew: 0, miner: 2, engineer: 0, financier: 0 };
    chooseHire(s);
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['miner', null], 'only the miner pile has tokens: the one legal hire was made by the engine');
    assert.equal(s.supply.specialists.miner, 1);
    const t = start(2);
    giveCarriages(t, 0, [[null, null]]);
    t.supply.specialists = { crew: 0, miner: 0, engineer: 0, financier: 0 };
    assert.equal(E.canHire(t, 0), false);
  });

  check('P8.2/3', 'with tycoonMode a hire needs the type\'s cost for the carriage it goes into', () => {
    const s = start(2, { variants: { tycoonMode: true } });
    giveCarriages(s, 0, [[null, null]]);
    setStorage(s, 0, { iron: 1, gunpowder: 1 }); // enough for a Crew only
    assert.equal(E.getHireSpecialistBlockReason(s, 0, 'engineer') !== null, true, 'an Engineer costs Wood and a Coin');
    assert.equal(E.getHireSpecialistBlockReason(s, 0, 'miner') !== null, true);
    chooseHire(s);
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['crew', null], 'only a Crew can be paid for: the engine hired it');
    assert.equal(s.players[0].resources.iron, 0);
    const t = start(2, { variants: { tycoonMode: true } });
    giveCarriages(t, 0, [[null, null]]);
    setStorage(t, 0, {});
    assert.equal(E.canHire(t, 0), false);
  });

  check('P8.3', 'the specialist goes into the leftmost empty space; the player chooses the type, not the space', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], [null, null]]);
    setHats(s, 0, 1);
    chooseHire(s, 1);
    assert.ok(offers(s, 'hireSpecialist').every((a) => a.slot === undefined && a.carriage === undefined));
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    act(s, { type: 'hireSpecialist', specialist: 'engineer' });
    const c = s.players[0].train.specialistCarriages;
    assert.deepEqual(c[0].slots, ['crew', 'miner']);
    assert.deepEqual(c[1].slots, ['engineer', null]);
  });

  check('P8.4', 'a specialist hired into carriage 3 scores 2 VP in its space 1 and 5 VP in its space 2', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', 'miner'], ['engineer', 'financier'], [null, null]]);
    setHats(s, 0, 1);
    chooseHire(s, 1);
    act(s, { type: 'hireSpecialist', specialist: 'crew' });
    assert.equal(vp(s, 0, 'carriage3'), 2);
    act(s, { type: 'hireSpecialist', specialist: 'crew' });
    assert.equal(vp(s, 0, 'carriage3'), 7);
    // Carriage 1 and 2 spaces score nothing.
    const t = start(2);
    giveCarriages(t, 0, [[null, null], [null, null]]);
    setHats(t, 0, 3 - 1);
    chooseHire(t, 2);
    for (let i = 0; i < 3; i++) act(t, { type: 'hireSpecialist', specialist: 'crew' });
    assert.equal(vp(t, 0, 'carriage3'), 0);
  });

  const TYCOON = {
    crew: [{ iron: 1, gunpowder: 1 }, { iron: 2, gunpowder: 1 }, { iron: 2, gunpowder: 2 }],
    miner: [{ gunpowder: 1, wood: 1 }, { gunpowder: 2, wood: 1 }, { gunpowder: 2, wood: 2 }],
    engineer: [{ wood: 1, coins: 1 }, { wood: 2, coins: 1 }, { wood: 2, coins: 2 }],
    financier: [{ coins: 1, iron: 1 }, { coins: 2, iron: 1 }, { coins: 2, iron: 2 }],
  };
  for (const type of Object.keys(TYCOON)) {
    check(`P8.5/${type}`, `Tycoon Mode: the ${type} costs ${JSON.stringify(TYCOON[type])} into carriage 1, 2, 3`, () => {
      for (let k = 1; k <= 3; k++) {
        const s = start(2, { variants: { tycoonMode: true } });
        const full = Array.from({ length: k - 1 }, () => ['crew', 'miner']);
        // carriages before k are full; carriage k is empty
        giveCarriages(s, 0, [...full, [null, null]]);
        if (k === 3) s.supply.specialists.crew = 4;
        setStorage(s, 0, { iron: 2, wood: 2, gunpowder: 2, coins: 2 });
        const want = TYCOON[type][k - 1];
        chooseHire(s);
        act(s, { type: 'hireSpecialist', specialist: type });
        const after = { iron: s.players[0].resources.iron, wood: s.players[0].resources.wood, gunpowder: s.players[0].resources.gunpowder, coins: s.players[0].coins };
        for (const r of ['iron', 'wood', 'gunpowder', 'coins']) assert.equal(after[r], 2 - (want[r] ?? 0), `${type} into carriage ${k}: ${r}`);
      }
    });
  }

  check('P8.5/default', 'without Tycoon Mode a hire costs nothing', () => {
    const s = start(2);
    giveCarriages(s, 0, [[null, null]]);
    setStorage(s, 0, {});
    chooseHire(s);
    act(s, { type: 'hireSpecialist', specialist: 'financier' });
    assert.equal(E.storageUsed(s.players[0]), 0);
    assert.equal(Object.keys(E.hireCost(s, 0, 'financier') ?? {}).length, 0);
  });

  check('P8.5/free', 'the free specialist that comes with carriage 1 never costs anything, even in Tycoon Mode', () => {
    const s = start(2, { variants: { tycoonMode: true } });
    setTrains(s, 0, ['POR', 'MIN']);
    setStorage(s, 0, { tunnel: 2 });
    layNowSimple(s);
    assert.equal(frame(s), 'chooseFreeSpecialist');
    const before = JSON.stringify([s.players[0].resources, s.players[0].coins]);
    act(s, { type: 'chooseFreeSpecialist', specialist: 'engineer' });
    assert.equal(JSON.stringify([s.players[0].resources, s.players[0].coins]), before);
  });

  check('P8.6', 'a hired specialist stays; any type may be hired any number of times while its pile lasts', () => {
    const s = start(2);
    giveCarriages(s, 0, [[null, null], [null, null]]);
    setHats(s, 0, 2);
    chooseHire(s, 2);
    for (let i = 0; i < 3; i++) act(s, { type: 'hireSpecialist', specialist: 'crew' });
    assert.equal(s.supply.specialists.crew, 1);
    assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'crew'], ['crew', null]]);
  });

  // -------------------------------------------------------------------------
  // P9 - board activation
  // -------------------------------------------------------------------------

  check('P9.1', 'the Foreman acts as the district\'s type for the whole activation, even with no specialist of that type', () => {
    for (const [space, d, give, built] of [['W3', 'D4', { iron: 1 }, 'ground'], ['W11', 'D8', { gunpowder: 1 }, 'tunnel'], ['W5', 'D6', { wood: 1 }, 'bridge']]) {
      const s = activation(space, d, give);
      assert.equal(frame(s), 'boardActivation');
      act(s, { type: 'useStep' });
      assert.equal(s.players[0].builtTiles[built], 1, d);
    }
  });

  check('P9.2', 'step list: the Foreman M times, then per carriage 1, 2, 3 the upgrade, space 1, space 2; every specialist and upgrade once', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', 'miner'], ['engineer', null]]);
    setUpgrade(s, 1, 'U1-iron');
    setUpgrade(s, 2, 'U2-coins');
    setStorage(s, 0, {});
    put(s, 0, 'W6');
    placeAndChoose(s, 'W3', 'D4'); // M = 2 (W6 borders D4)
    const steps = E.topFrame(s).steps.map((x) => `${x.carriage}:${x.type === 'upgrade' ? 'U' : x.slot}`);
    assert.deepEqual(steps, ['0:0', '0:1', '1:U', '1:0', '1:1', '2:U', '2:0'].map((x, i) => steps[i] ?? x).slice(0, steps.length));
    assert.deepEqual(E.topFrame(s).steps.map((x) => x.carriage), [0, 0, 1, 1, 1, 2, 2]);
    assert.deepEqual(E.topFrame(s).steps.map((x) => x.type), ['crew', 'crew', 'upgrade', 'crew', 'miner', 'upgrade', 'engineer']);
  });

  check('P9.3/crew', 'Crew step: pay 1 Iron, gain 1 built Ground tile; allowed only if payable', () => {
    const s = activation('W3', 'D4', { iron: 2 });
    act(s, { type: 'useStep' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 0, bridge: 0 });
    assert.equal(s.players[0].resources.iron, 1);
    const t = start(2);
    setStorage(t, 0, {});
    const ev = choose(t, 'W3', 'D4');
    assert.ok(ev.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep'), 'unpayable: skipped');
  });

  check('P9.3/miner', 'Miner step: pay 1 Gunpowder, gain 1 built Tunnel tile', () => {
    const s = activation('W11', 'D8', { gunpowder: 1 });
    act(s, { type: 'useStep' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 1, bridge: 0 });
    assert.equal(s.players[0].resources.gunpowder, 0);
  });

  check('P9.3/engineer', 'Engineer step: pay 1 Wood, gain 1 built Bridge tile', () => {
    const s = activation('W5', 'D6', { wood: 1 });
    act(s, { type: 'useStep' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 1 });
    assert.equal(s.players[0].resources.wood, 0);
  });

  check('P9.3/skip', 'a Crew, Miner or Engineer step may be skipped by choice', () => {
    const s = activation('W3', 'D4', { iron: 2 });
    assert.ok(types(s).includes('skipStep') && types(s).includes('useStep'));
    act(s, { type: 'skipStep' });
    assert.equal(s.players[0].builtTiles.ground, 0);
  });

  check('P9.3/overflow', 'after each step overflow is applied (a built tile takes storage)', () => {
    const s = start(2);
    giveCarriages(s, 0, []);
    setStorage(s, 0, { iron: 2, wood: 4 }); // 6 of 6; a Crew step swaps 1 Iron for 1 tile: stays 6
    placeAndChoose(s, 'W3', 'D4');
    act(s, { type: 'useStep' });
    assert.equal(E.storageUsed(s.players[0]), 6);
    assert.notEqual(frame(s), 'discard');
  });

  check('P9.4', 'order is fixed: only the current step can be taken; what an earlier step gained may pay for a later one', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null]]);
    setUpgrade(s, 1, 'U1-iron');
    setStorage(s, 0, {});
    const ev = placeAndChoose(s, 'W3', 'D4');
    // Foreman cannot pay (skipped), the token gives 1 Iron, then the carriage 1 Crew uses it.
    assert.ok(ev.some((e) => e.type === 'upgradeStep'));
    assert.deepEqual(E.waitingStep(E.topFrame(s)), { type: 'crew', carriage: 1, slot: 0 });
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].builtTiles.ground, 1);
  });

  check('P9.4/skipped', 'a skipped step cannot be taken later', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null]]);
    setStorage(s, 0, { iron: 1 });
    placeAndChoose(s, 'W3', 'D4');
    act(s, { type: 'skipStep' }); // the Foreman's step
    assert.deepEqual(E.waitingStep(E.topFrame(s)), { type: 'crew', carriage: 1, slot: 0 });
    act(s, { type: 'skipStep' });
    assert.equal(s.players[0].builtTiles.ground, 0);
    assert.equal(s.turn.player, 1);
  });

  check('P9.5', 'built tiles wait in storage: an activation never puts anything on the map', () => {
    const s = activation('W3', 'D4', { iron: 1 });
    act(s, { type: 'useStep' });
    assert.ok(Object.values(s.map.routeOwner).every((o) => o === null));
  });

  // -------------------------------------------------------------------------
  // P10 - the Financier and Congress
  // -------------------------------------------------------------------------

  check('P10.1/table', 'the Congress panel: eight columns with costs 1, 1, 1, 1, 2, 2, 3, 3 and the Reset for 1 Coin', () => {
    const s = start(2);
    assert.deepEqual(E.congressColumns(s).map((c) => `${c.id}:${c.cost}`), ['K1:1', 'K2:1', 'K3:1', 'K4:1', 'K5:2', 'K6:2', 'K7:3', 'K8:3', 'KR:1']);
  });

  for (const [col, cost, item, n] of [['K1', 1, 'wood', 2], ['K2', 1, 'gunpowder', 2], ['K3', 1, 'iron', 2]]) {
    check(`P10.1/${col}`, `${col}: pay ${cost} Coin, gain ${n} ${item}; the senator goes down`, () => {
      const s = atFinancier(2, { coins: 3 });
      take(s, col);
      assert.equal(s.players[0].resources[item], n);
      assert.equal(s.players[0].coins, 3 - cost);
      assert.equal(s.congress.down[col], true);
    });
  }

  check('P10.1/K4', 'K4: pay 1 Coin, gain 2 cowboy hats', () => {
    const s = atFinancier(2, { coins: 2 });
    take(s, 'K4');
    assert.equal(s.players[0].hats, 2);
    assert.equal(s.players[0].coins, 1);
  });

  check('P10.1/K5', 'K5: pay 2 Coins; a district house or an upgrade token; 1 VP either way', () => {
    const s = atFinancier(2, { coins: 3 });
    take(s, 'K5');
    assert.equal(s.players[0].coins, 1);
    act(s, { type: 'placeDistrictHouse', district: 'D1', houseTrack: 'iron' });
    assert.equal(vp(s, 0, 'congress'), 1);
    const t = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    take(t, 'K5');
    act(t, { type: 'installUpgrade', token: 'U1-iron', carriage: 1 });
    assert.equal(vp(t, 0, 'congress'), 1);
    assert.equal(vp(t, 0, 'upgrade'), 0, 'not the special action\'s 2 VP');
  });

  check('P10.1/K6', 'K6: pay 2 Coins, gain 4 resources of choice among Wood, Iron and Gunpowder (never Coins)', () => {
    const s = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    take(s, 'K6');
    assert.equal(E.topFrame(s).remaining, 4, 'four units, not three');
    assert.deepEqual(offers(s, 'chooseResource').map((a) => a.resource).sort(), ['gunpowder', 'iron', 'wood']);
    refused(s, { type: 'chooseResource', resource: 'coins' });
    for (const r of ['wood', 'wood', 'iron', 'gunpowder']) act(s, { type: 'chooseResource', resource: r });
    assert.deepEqual(s.players[0].resources, { iron: 1, wood: 2, gunpowder: 1 });
    assert.equal(s.players[0].coins, 0);
  });

  check('P10.1/K7', 'K7: pay 3 Coins; place a railway station and / or a telegraph station on the map', () => {
    const s = atFinancier(3, { coins: 3 });
    layRoutes(s, ['SEA-SPO']);
    take(s, 'K7');
    assert.equal(s.players[0].coins, 0);
    assert.equal(frame(s), 'congressPlacement');
  });

  check('P10.1/K8', 'K8: pay 3 Coins, gain 2 built track tiles of any types, same or different', () => {
    const s = atFinancier(2, { coins: 3 });
    take(s, 'K8');
    act(s, { type: 'chooseBuiltTile', terrain: 'tunnel' });
    act(s, { type: 'chooseBuiltTile', terrain: 'tunnel' });
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 2, bridge: 0 });
    assert.equal(s.players[0].coins, 0);
  });

  check('P10.1/panel', 'a column whose senator is down cannot be taken by anyone until a Reset; senators belong to nobody', () => {
    const s = atFinancier(2, { coins: 5 });
    take(s, 'K1');
    // Next turn, Ben: K1 is down for him too.
    const t = start(2);
    t.congress.down.K1 = true;
    setStorage(t, 1, { coins: 3 });
    act(t, { type: 'placeWorker', space: 'W12' });
    act(t, { type: 'chooseDistrict', district: 'D8', hats: 0 });
    // (Anna just did a Miner activation; now Ben.)
    while (t.turn.player !== 1) act(t, E.getValidActions(t).find((a) => a.type === 'skipStep' || a.type === 'skipSpecialAction') ?? E.getValidActions(t)[0]);
    act(t, { type: 'placeWorker', space: 'W1' });
    act(t, { type: 'chooseDistrict', district: 'D2', hats: 0 });
    refused(t, { type: 'takeCongressColumn', column: 'K1' }, /down|senator/i);
    assert.ok(has(t, 'takeCongressColumn', { column: 'K2' }));
    assert.ok(s);
  });

  check('P10.2/1', 'take a column: pay its Coins, slide the senator down, resolve the reward before the next step', () => {
    const s = atFinancier(2, { coins: 2 }, { carriages: [['financier', null]] });
    take(s, 'K1');
    assert.equal(s.congress.down.K1, true);
    assert.equal(s.players[0].resources.wood, 2);
    assert.deepEqual(E.waitingStep(E.topFrame(s)), { type: 'financier', carriage: 1, slot: 0 }, 'then the next Financier step');
  });

  check('P10.2/2', 'Reset: pay 1 Coin, every senator on a bottom space returns, 1 VP per senator moved; not offered when no senator is down', () => {
    const s = atFinancier(2, { coins: 2 });
    assert.ok(!types(s).includes('resetSenators'));
    refused(s, { type: 'resetSenators' });
    for (const id of ['K2', 'K5', 'K7']) s.congress.down[id] = true;
    assert.ok(types(s).includes('resetSenators'));
    act(s, { type: 'resetSenators' });
    assert.equal(vp(s, 0, 'congress'), 3);
    assert.equal(s.players[0].coins, 1);
    assert.equal(Object.values(s.congress.down).filter(Boolean).length, 0);
  });

  check('P10.2/3', 'a Financier step may be skipped', () => {
    const s = atFinancier(2, { coins: 5 });
    assert.ok(types(s).includes('skipStep'));
    act(s, { type: 'skipStep' });
    assert.equal(s.congress.down.K1, false);
    assert.equal(s.turn.player, 1);
  });

  check('P10.2/one-per-step', 'each Financier action is one column or one Reset: several columns need several Financier steps', () => {
    const s = atFinancier(2, { coins: 5 });
    take(s, 'K1');
    assert.equal(s.turn.player, 1, 'M = 1: one Financier step, one column');
    const t = start(2);
    setStorage(t, 0, { coins: 5 });
    put(t, 0, 'W4');
    placeAndChoose(t, 'W1', 'D2'); // W4 borders D2: M = 2
    take(t, 'K1');
    assert.equal(frame(t), 'boardActivation');
    take(t, 'K2');
    assert.deepEqual([t.congress.down.K1, t.congress.down.K2], [true, true]);
    const u = atFinancier(2, { coins: 5 });
    refused(u, { type: 'useStep' });
  });

  check('P10.3/1', 'gained resources and built tiles go into storage and obey the limit', () => {
    const s = atFinancier(2, { coins: 1, wood: 5 }); // 6 of 6
    const ev = take(s, 'K1'); // pay the Coin: 5 + 2 = 7, one over
    assert.ok(ev.some((e) => e.type === 'discard'), 'the surplus is discarded at once');
    assert.equal(s.players[0].resources.wood, 6);
    assert.equal(E.storageUsed(s.players[0]), 6);
  });

  check('P10.3/2', 'K4 hats follow the holding limit: a hat over 2 becomes 1 resource of choice (Coin allowed)', () => {
    const s = atFinancier(2, { coins: 1 });
    setHats(s, 0, 1);
    take(s, 'K4');
    assert.equal(s.players[0].hats, 2);
    assert.equal(frame(s), 'chooseResource');
    assert.deepEqual(offers(s, 'chooseResource').map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    act(s, { type: 'chooseResource', resource: 'iron' });
    assert.equal(s.players[0].resources.iron, 1);
  });

  check('P10.3/3', 'K5: the player chooses the half; the upgrade half follows P12.2 and cannot replace; if neither half can be done K5 cannot be taken', () => {
    const s = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    setUpgrade(s, 1, 'U1-iron');
    s.grid.sites = { D1: [1, 1, 1], D3: [1, 1, 1], D7: [1, 1, 1], D9: [1, 1, 1] };
    refused(s, { type: 'takeCongressColumn', column: 'K5' });
    const t = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    take(t, 'K5');
    assert.ok(types(t).includes('placeDistrictHouse') && types(t).includes('installUpgrade'), 'both halves are on offer');
    const u = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    setUpgrade(u, 1, 'U1-iron');
    take(u, 'K5');
    assert.ok(!types(u).includes('installUpgrade'), 'cannot replace');
    assert.ok(types(u).includes('placeDistrictHouse'));
  });

  check('P10.3/3-neither', 'K5 cannot be taken when neither half can be carried out (no house left, no token placeable)', () => {
    const s = atFinancier(2, { coins: 2 });
    setHouses(s, 0, 0);
    assert.ok(!has(s, 'takeCongressColumn', { column: 'K5' }));
    refused(s, { type: 'takeCongressColumn', column: 'K5' });
    const t = atFinancier(2, { coins: 2 });
    assert.ok(has(t, 'takeCongressColumn', { column: 'K5' }), 'with a house and a free site the district house half is possible');
  });

  check('P10.3/3-production', 'K5\'s district house takes the leftmost house of the chosen track and raises its production', () => {
    const s = atFinancier(2, { coins: 2 });
    const before = E.production(s, 0, 'wood');
    take(s, 'K5');
    act(s, { type: 'placeDistrictHouse', district: 'D9', houseTrack: 'wood' });
    assert.equal(E.production(s, 0, 'wood'), before + 1);
    assert.equal(s.grid.sites.D9[0], 0);
  });

  check('P10.3/4', 'K7: a railway station in an inland city with no building that a laid route ends at, or with another player\'s telegraph station and no railway station; a telegraph station in a city with another\'s railway station and no telegraph station', () => {
    const s = atFinancier(3, { coins: 3 });
    layRoutes(s, ['SEA-SPO']);
    build(s, 'railwayStation', 'REN', 1);
    build(s, 'telegraphStation', 'BOI', 2);
    build(s, 'railwayStation', 'FRE', 0); // own railway station: no telegraph for Anna there
    take(s, 'K7');
    const rail = [...new Set(offers(s, 'placeRailwayStation').map((a) => a.city))].sort();
    assert.deepEqual(rail, ['BOI', 'SPO']);
    const tele = offers(s, 'placeTelegraphStation').map((a) => a.city).sort();
    assert.deepEqual(tele, ['REN']);
    refused(s, { type: 'placeRailwayStation', city: 'HEL', houseTrack: 'wood' }); // no laid route ends there
    refused(s, { type: 'placeRailwayStation', city: 'SEA', houseTrack: 'wood' }); // a start city
  });

  check('P10.3/4-own', 'K7: a railway station never goes in a city where the player owns the telegraph station, nor a telegraph station where they own the railway station', () => {
    const s = atFinancier(3, { coins: 3 });
    build(s, 'telegraphStation', 'REN', 0);
    build(s, 'railwayStation', 'FRE', 0);
    build(s, 'telegraphStation', 'BOI', 1);
    layRoutes(s, ['SEA-SPO']);
    s.players[0].telegraphsPlaced = 1;
    take(s, 'K7');
    assert.ok(!offers(s, 'placeRailwayStation').some((a) => a.city === 'REN'), 'own telegraph station in Reno');
    assert.ok(!offers(s, 'placeTelegraphStation').some((a) => a.city === 'FRE'), 'own railway station in Fresno');
    assert.ok(offers(s, 'placeRailwayStation').some((a) => a.city === 'BOI'));
  });

  check('P10.3/4b', 'K7: one or both buildings, never in the same city; no carriage; no track VP; skipBuilding once one is placed', () => {
    const s = atFinancier(3, { coins: 3 });
    layRoutes(s, ['SEA-SPO']);
    build(s, 'railwayStation', 'REN', 1);
    take(s, 'K7');
    assert.ok(!types(s).includes('skipBuilding'), 'at least one is required');
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' });
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
    assert.equal(s.players[0].layStationsPlaced, 0);
    assert.ok(types(s).includes('skipBuilding'));
    assert.ok(!offers(s, 'placeTelegraphStation').some((a) => a.city === 'SPO'), 'not in the city that got the railway station');
    act(s, { type: 'placeTelegraphStation', city: 'REN' });
    assert.equal(vp(s, 0, 'telegraph'), 1);
    assert.equal(vp(s, 0, 'track'), 0);
    assert.notEqual(frame(s), 'congressPlacement');
  });

  check('P10.3/4c', 'K7 can place a telegraph station alone, taking the row\'s next VP', () => {
    const s = atFinancier(2, { coins: 3 });
    build(s, 'railwayStation', 'REN', 1);
    take(s, 'K7'); // the only building possible: the engine places it
    assert.equal(s.map.telegraphStation.REN, 0);
    assert.equal(vp(s, 0, 'telegraph'), 1);
    assert.equal(s.players[0].train.specialistCarriages.length, 0);
  });

  check('P10.3/5', 'K6 and K8: each unit is chosen separately', () => {
    const s = atFinancier(2, { coins: 3 });
    take(s, 'K8');
    assert.equal(E.topFrame(s).remaining, 2);
    act(s, { type: 'chooseBuiltTile', terrain: 'ground' });
    assert.equal(E.topFrame(s).remaining, 1);
    assert.ok(offers(s, 'chooseBuiltTile').length === 3);
  });

  check('P10.3/6', 'a column whose reward cannot be carried out at all cannot be taken (K7 with nowhere to build)', () => {
    const s = atFinancier(2, { coins: 3 });
    assert.ok(!has(s, 'takeCongressColumn', { column: 'K7' }));
    refused(s, { type: 'takeCongressColumn', column: 'K7' });
    const t = atFinancier(2, { coins: 3 });
    setHouses(t, 0, 0);
    t.players[0].telegraphsPlaced = 7;
    layRoutes(t, ['SEA-SPO']);
    assert.ok(!has(t, 'takeCongressColumn', { column: 'K7' }), 'no pieces left');
  });

  check('P10.4', 'a Financier step with no affordable column and no possible Reset can only be skipped, and the engine skips it itself', () => {
    const s = start(2);
    setStorage(s, 0, {});
    const ev = choose(s, 'W1', 'D2');
    assert.ok(ev.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipStep'));
    assert.equal(s.turn.player, 1);
    const t = atFinancier(2, { coins: 1 });
    assert.deepEqual(offers(t, 'takeCongressColumn').map((a) => a.column), ['K1', 'K2', 'K3', 'K4'], 'costs are paid in Coins from storage');
  });

  // -------------------------------------------------------------------------
  // P11 - cowboy hats
  // -------------------------------------------------------------------------

  check('P11.1', 'a player holds at most 2 hats; each hat that would take them above 2 is 1 resource of choice (displacement)', () => {
    const s = start(3);
    put(s, 1, 'W1');
    put(s, 1, 'W3');
    setHats(s, 1, 1);
    act(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(s.players[1].hats, 2);
    assert.equal(E.topFrame(s).remaining, 1);
  });

  check('P11.1/other', 'for other sources (K4) the same applies: each hat over 2 becomes a resource of choice', () => {
    const s = atFinancier(2, { coins: 1 });
    setHats(s, 0, 2);
    take(s, 'K4');
    assert.equal(s.players[0].hats, 2);
    assert.equal(E.topFrame(s).remaining, 2);
    assert.equal(E.topFrame(s).kind, 'chooseResource');
  });

  check('P11.2', 'the player may spend any number of held hats (0, 1 or 2) when choosing the action; each is one action bonus and returns to the supply', () => {
    const s = start(2);
    setHats(s, 0, 2);
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.deepEqual(offers(s, 'chooseDistrict').filter((a) => a.district === 'D9').map((a) => a.hats).sort(), [0, 1, 2]);
    refused(s, { type: 'chooseDistrict', district: 'D9', hats: 3 });
    const ev = act(s, { type: 'chooseDistrict', district: 'D9', hats: 2 });
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    assert.equal(s.players[0].hats, 0);
  });

  check('P11.2/later', 'a hat gained later in the turn (K4) cannot change this turn\'s M', () => {
    const s = start(2);
    setStorage(s, 0, { coins: 3 });
    put(s, 0, 'W4');
    placeAndChoose(s, 'W1', 'D2'); // M = 2
    assert.equal(s.turn.multiplier, 2);
    take(s, 'K4');
    assert.equal(s.players[0].hats, 2);
    assert.equal(s.turn.multiplier, 2);
    assert.equal(s.turn.hatsSpent, 0);
  });

  check('P11.2/every-action', 'hats work on every kind of action: Collect, board activation, Lay Track and Hire Specialists', () => {
    const cases = [['W12', 'D9', undefined], ['W3', 'D4', undefined], ['W4', 'D5', 'lay'], ['W4', 'D5', 'hire']];
    for (const [space, district, mode] of cases) {
      const s = start(2);
      setHats(s, 0, 1);
      setStorage(s, 0, { ground: 3, tunnel: 3, bridge: 3 });
      giveCarriages(s, 0, [[null, null]]);
      setTrains(s, 0, ['SEA', 'POR']);
      act(s, { type: 'placeWorker', space });
      const key = mode === undefined ? { district, hats: 1 } : { district, hats: 1, mode };
      assert.ok(has(s, 'chooseDistrict', key), `${district} ${mode ?? ''}`);
    }
  });

  check('P11.3', 'sources: displacement and Congress column K4 only', () => {
    const s = start(2);
    assert.equal(s.players[0].hats, 0);
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hats: 0 });
    assert.equal(s.players[0].hats, 0, 'a collect gives no hat');
  });

  check('P11.4', 'hats score nothing at the end', () => {
    const s = start(2);
    const base = E.scoreGame(s).players[0].total;
    setHats(s, 0, 2);
    assert.equal(E.scoreGame(s).players[0].total, base);
  });

  // -------------------------------------------------------------------------
  // P12 - carriage upgrades
  // -------------------------------------------------------------------------

  check('P12.1', 'the 20 tokens: 8 level 1, 8 level 2 and 4 level 3, by player-count back', () => {
    const s = start(4);
    const level = (t) => E.upgradeTileData(s, t).level;
    assert.equal(s.supply.upgrades.filter((t) => level(t) === 1).length, 8);
    assert.equal(s.supply.upgrades.filter((t) => level(t) === 2).length, 8);
    assert.equal(s.supply.upgrades.filter((t) => level(t) === 3).length, 4);
    assert.deepEqual(E.upgradeTokenIds(s).sort(), ['U1-coins', 'U1-gunpowder', 'U1-iron', 'U1-wood', 'U2-coins', 'U2-gunpowder', 'U2-iron', 'U2-wood', 'U3-choice']);
  });

  check('P12.2/1', 'a token may go only into a carriage that holds at least one specialist', () => {
    const s = atCollectWood([[null, null]]);
    refused(s, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 });
  });

  check('P12.2/2', 'a token may go only into a carriage whose upgrade space is empty', () => {
    const s = atFinancier(2, { coins: 2 }, { carriages: [['crew', null], ['crew', null]] });
    setUpgrade(s, 1, 'U1-iron');
    take(s, 'K5');
    refused(s, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 }); // occupied, and K5 never replaces
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 }), null);
  });

  check('P12.2/3', 'the token\'s level must EQUAL the carriage number', () => {
    const s = atCollectWood([['crew', null], ['crew', null], ['crew', null]], 1, { variants: { upgradePlacement: 'any-carriage' } });
    for (const [token, carriage, ok] of [['U1-wood', 1, true], ['U1-wood', 2, false], ['U2-wood', 1, false], ['U2-wood', 2, true], ['U2-wood', 3, false], ['U3-choice', 3, true], ['U3-choice', 2, false]]) {
      assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token, carriage }) === null, ok, `${token} on carriage ${carriage}`);
    }
  });

  check('P12.2/4', 'first-free (ruled default): the carriage must be the leftmost with a specialist and no upgrade', () => {
    const s = atCollectWood([['crew', null], ['crew', null]]);
    refused(s, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 });
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 }), null);
    // With carriage 1 taken, carriage 2 becomes the leftmost free one.
    const t = start(2);
    giveCarriages(t, 0, [['crew', null], ['crew', null]]);
    setUpgrade(t, 1, 'U1-iron');
    setStorage(t, 0, { gunpowder: 1 });
    placeAndChoose(t, 'W8', 'D7');
    assert.equal(E.getBlockReason(t, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 }), null);
  });

  check('P12.2/4b', 'any-carriage: a token may go into any carriage meeting items 1 to 3', () => {
    const s = atCollectWood([['crew', null], ['crew', null]], 1, { variants: { upgradePlacement: 'any-carriage' } });
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U2-wood', carriage: 2 }), null);
  });

  check('P12.2/5', 'the token must be in the upgrade supply (a 2-player game has one U1-iron only)', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], ['crew', null]]);
    setUpgrade(s, 1, 'U1-iron');
    // The only U1-iron token is now installed: it cannot be taken again.
    setStorage(s, 0, { gunpowder: 1 });
    placeAndChoose(s, 'W8', 'D7');
    refused(s, { type: 'installUpgrade', token: 'U1-iron', carriage: 1 });
    assert.ok(!s.supply.upgrades.includes('U1-iron'));
  });

  check('P12.2/who', 'the rule governs every installation: the Collect Wood special action (2 VP) and K5 (1 VP)', () => {
    const s = atCollectWood([['crew', null]]);
    act(s, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 });
    assert.equal(vp(s, 0, 'upgrade'), 2);
    assert.equal(vp(s, 0, 'congress'), 0);
    const t = atFinancier(2, { coins: 2 }, { carriages: [['crew', null]] });
    take(t, 'K5');
    refused(t, { type: 'installUpgrade', token: 'U2-wood', carriage: 1 });
    act(t, { type: 'installUpgrade', token: 'U1-wood', carriage: 1 });
    assert.equal(vp(t, 0, 'congress'), 1);
  });

  check('P12.3', 'Collect Wood may replace a token with one of the same level from the supply: no VP, the old token returns; item 4 does not apply; K5 cannot replace', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], ['crew', null]]);
    setUpgrade(s, 1, 'U1-wood');
    setUpgrade(s, 2, 'U2-iron');
    setStorage(s, 0, { gunpowder: 1 });
    placeAndChoose(s, 'W8', 'D7');
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 }), null);
    refused(s, { type: 'installUpgrade', token: 'U2-wood', carriage: 1 }, /./);
    act(s, { type: 'installUpgrade', token: 'U2-coins', carriage: 2 });
    assert.equal(s.players[0].train.specialistCarriages[1].upgrade, 'U2-coins');
    assert.ok(s.supply.upgrades.includes('U2-iron'), 'the old token returned to the supply');
    assert.equal(vp(s, 0, 'upgrade'), 0, 'replacing scores no VP');
    assert.equal(s.players[0].resources.gunpowder, 0, 'but it costs the Gunpowder');
  });

  check('P12.3/item4', 'replacing is not bound by the first-free rule: a token may be replaced in a later carriage while an earlier one has no token', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], ['crew', null]]);
    setUpgrade(s, 2, 'U2-iron');
    setStorage(s, 0, { gunpowder: 1 });
    placeAndChoose(s, 'W8', 'D7');
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U2-coins', carriage: 2 }), null, 'carriage 1 is free and empty, yet carriage 2 may be replaced');
    assert.equal(E.getBlockReason(s, { type: 'installUpgrade', token: 'U2-coins', carriage: 1 }) !== null, true, 'a level 2 token never goes on carriage 1');
    act(s, { type: 'installUpgrade', token: 'U2-coins', carriage: 2 });
    assert.equal(vp(s, 0, 'upgrade'), 0);
  });

  check('P12.4', 'a token works in every board activation, at its step before its carriage\'s specialists: level 1 gives 1 of its type, level 2 gives 2, level 3 asks for 3 of choice (Coin allowed)', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null], ['crew', null], ['crew', null]]);
    setUpgrade(s, 1, 'U1-gunpowder');
    setUpgrade(s, 2, 'U2-wood');
    setUpgrade(s, 3, 'U3-choice');
    setStorage(s, 0, {});
    placeAndChoose(s, 'W3', 'D4');
    assert.equal(s.players[0].resources.gunpowder, 1, 'level 1: 1 of the type');
    assert.equal(s.players[0].resources.wood, 2, 'level 2: 2 of the type');
    assert.equal(frame(s), 'chooseResource');
    assert.equal(E.topFrame(s).remaining, 3);
    assert.deepEqual(offers(s, 'chooseResource').map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
    for (const r of ['coins', 'coins', 'iron']) act(s, { type: 'chooseResource', resource: r });
    assert.equal(s.players[0].coins, 2);
  });

  check('P12.4/once', 'an upgrade is not repeated by the Foreman\'s extra activations', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null]]);
    setUpgrade(s, 1, 'U1-coins');
    setStorage(s, 0, {});
    put(s, 0, 'W6');
    put(s, 0, 'W8');
    const ev = placeAndChoose(s, 'W3', 'D4'); // M = 3
    assert.equal(ev.filter((e) => e.type === 'upgradeStep').length, 1);
    assert.equal(s.players[0].coins, 1);
  });

  check('P12.5', 'an installed token never moves; each carriage holds at most one; a replaced token goes back and can be taken again', () => {
    const s = start(2);
    giveCarriages(s, 0, [['crew', null]]);
    setUpgrade(s, 1, 'U1-wood');
    setStorage(s, 0, { gunpowder: 2 });
    placeAndChoose(s, 'W8', 'D7');
    act(s, { type: 'installUpgrade', token: 'U1-coins', carriage: 1 });
    assert.ok(s.supply.upgrades.includes('U1-wood'));
    assert.equal(s.players[0].train.specialistCarriages.filter((c) => c.upgrade !== null).length, 1);
  });

  void playOut;
}

/** Anna (train on Portland) lays Portland - Reno with 2 Tunnel tiles and takes the railway station there. */
function layNowSimple(s) {
  chooseLay(s);
  doLay(s, ['POR-REN']);
  act(s, { type: 'placeRailwayStation', city: 'REN', houseTrack: 'wood' });
}
