// Rules audit, part 2: R6 gathering, R7 the four bonus actions, R8 the train,
// R9 train activation, R10 Lobby Congress. Written from rules spec v2.

import { RULES, production, storageCapacity, storageOverflow, storageUsed, getBlockReason as blockReason } from '../../src/engine/index.js';
import {
  assert, check, game, act, take, put, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource,
  offered, offers, refused, idleTurn, idleUntil, finishTurn, playTurn, goTo, kind, keys, giveTokens, stock, ownCard, installTile,
  getValidActions, topFrame, vpTotal,
} from './kit.mjs';

const PONY = { modulePonyExpress: true };
const UPGRADES = { moduleCarriageUpgrades: true };
const legislative = (n) => ({ moduleLegislativeAgenda: true, legislativeAgendaCard: n });
const sorted = (a) => a.slice().sort();
const held = (p) => ({ ...p.resources, coins: p.coins });

/** Seat 1 in a Lobby Congress activation with 7 lobby points to come (Foreman, two level 1 and two level 2 Financiers). */
function lobbyGame(variants = {}, players = 2, coins = 20, train = [['financier', 'financier'], ['financier', 'financier']]) {
  const s = game(players, variants);
  setTrain(s, 0, train);
  give(s, 0, { coins, resources: {} });
  s.players[0].train.storageCarriages = 3;
  placeAndChoose(s, 'W1', 'D2');
  return s;
}

/** Lets Financier steps go by (closing each Congress window) until `n` lobby points are in hand. */
function waitLobby(s, n) {
  while (kind(s) === 'trainActivation' && topFrame(s).lobby < n) act(s, { type: 'closeCongress' });
  assert.equal(kind(s), 'trainActivation');
  assert.equal(topFrame(s).lobby, n);
}

/** Trains whose Lobby Congress activation gives exactly 2, 3 or 4 lobby points (the Foreman included). */
const POINTS = { 2: [['financier', null]], 3: [['financier', 'financier']], 4: [['financier', 'financier'], ['financier', null]] };

/**
 * Takes `entry` in the LAST Congress window of an activation that gives exactly `tier + 1` lobby points,
 * answers the benefit's decisions with `answer(state)`, and returns the events. If the entry cost `tier`
 * lobby points, exactly 1 is left to be lost when the activation ends (R9.4.4).
 */
function takeAtTier(entry, tier, answer = null, variants = {}, prepare = null) {
  const s = lobbyGame(variants, 2, 20, POINTS[tier + 1]);
  if (prepare) prepare(s);
  waitLobby(s, tier + 1);
  const coins = s.players[0].coins;
  const events = act(s, { type: 'takeCongressEntry', entry });
  for (let i = 0; i < 20 && s.turn.player === 0 && kind(s) !== 'trainActivation'; i++) events.push(...act(s, answer(s)));
  if (s.turn.player === 0) events.push(...finishTurn(s));
  assert.equal(eventOf(events, 'lobbyPointsLost').amount, 1, `${entry} must cost ${tier} lobby points`);
  return { s, events, coinsPaid: coins - s.players[0].coins };
}

export default function part2() {
  // ----- R6 ------------------------------------------------------------------
  check('R6.1', 'the four Gather districts give Gunpowder (D1), Iron (D3), Wood (D7) and Coins (D9)', () => {
    for (const [d, item] of [['D1', 'gunpowder'], ['D3', 'iron'], ['D7', 'wood'], ['D9', 'coins']]) {
      const s = game(2);
      give(s, 0, { resources: {}, coins: 0 });
      goTo(s, d);
      const got = held(s.players[0]);
      const p = item === 'iron' ? 2 : 1;
      assert.deepEqual(got, { iron: 0, wood: 0, gunpowder: 0, coins: 0, [item]: p }, d);
    }
  });
  check('R6.2', 'production P = 1 + empty house slots on the track, from 1 to 4', () => {
    const s = game(2);
    for (const track of ['wood', 'coins', 'iron', 'gunpowder']) {
      for (const houses of [3, 2, 1, 0]) {
        s.players[0].houses[track] = houses;
        assert.equal(production(s, 0, track), 1 + (3 - houses));
      }
    }
  });
  check('R6.3', 'a Gather action yields P x M', () => {
    const s = game(2);
    give(s, 0, { resources: {} });
    s.players[0].houses.wood = 0; // P = 4
    put(s, 0, 'W8'); // adjacent to Gather Wood: M = 2
    placeAndChoose(s, 'W11', 'D7');
    assert.equal(s.players[0].resources.wood, 8);
  });
  for (const [n, district, item] of [[11, 'D3', 'iron'], [12, 'D7', 'wood'], [13, 'D1', 'gunpowder'], [14, 'D9', 'coins']]) {
    check(`R6.4.1/${n}`, `Legislative Agenda card ${n}: +1 ${item} per Gather action, added after multiplying, for every player`, () => {
      for (const pid of [0, 1]) {
        const s = game(2, legislative(n));
        if (pid === 1) idleTurn(s);
        give(s, pid, { resources: {}, coins: 0 });
        put(s, pid, `D${district.slice(1)}`); // own worker on the centre: A = 1, so M = 2
        const p = production(s, pid, item === 'coins' ? 'coins' : item);
        placeAndChoose(s, district === 'D9' ? 'W12' : district === 'D3' ? 'W2' : district === 'D7' ? 'W11' : 'W1', district);
        assert.equal(held(s.players[pid])[item], p * 2 + 1);
      }
      // another Gather district gets nothing extra
      const t = game(2, legislative(n));
      give(t, 0, { resources: {}, coins: 0 });
      const other = district === 'D9' ? 'D7' : 'D9';
      goTo(t, other);
      assert.equal(held(t.players[0])[other === 'D9' ? 'coins' : 'wood'], 1);
    });
  }
  check('R6.4.2', 'Pony Express card 21 adds 1 after multiplying; card 36 raises P by 1, so its bonus is multiplied', () => {
    const run = (cards) => {
      const s = game(2, PONY);
      for (const c of cards) ownCard(s, 0, c);
      give(s, 0, { resources: {} });
      put(s, 0, 'W5'); // M = 2 at Gather Iron
      placeAndChoose(s, 'W2', 'D3');
      return s.players[0].resources.iron;
    };
    assert.equal(run([]), 4);
    assert.equal(run(['PX21']), 5);
    assert.equal(run(['PX36']), 6);
    assert.equal(run(['PX21', 'PX36']), 7);
  });
  check('R6.5', 'gathered resources go into storage and obey its limit; Coins are simply added', () => {
    const s = game(2);
    s.players[0].houses.iron = 0; // P = 4
    put(s, 0, 'W5'); // M = 2: 8 Iron on top of 3 stored items, capacity 9
    placeAndChoose(s, 'W2', 'D3');
    assert.equal(kind(s), 'discard');
    assert.equal(s.toAct, 0);
    assert.equal(storageOverflow(s, 0), 2);
    act(s, { type: 'discard', item: 'wood' });
    act(s, { type: 'discard', item: 'iron' });
    assert.notEqual(kind(s), 'discard');
    assert.equal(storageUsed(s.players[0]), 9);
    assert.deepEqual(s.players[0].resources, { iron: 8, wood: 0, gunpowder: 1 });
  });
  check('R6.6', 'after the yield the player may take the bonus action printed on that district', () => {
    const s = game(2);
    placeAndChoose(s, 'W11', 'D7');
    assert.equal(kind(s), 'bonusAction');
    assert.equal(s.players[0].resources.wood, 2, 'the yield is already in storage');
    assert.deepEqual(types(s), ['buyHat', 'skipBonusAction']);
  });
  check('R6.7', 'production is raised only by removing houses: gathering leaves it unchanged', () => {
    const s = game(2);
    goTo(s, 'D9');
    finishTurn(s);
    assert.deepEqual(['wood', 'coins', 'iron', 'gunpowder'].map((t) => production(s, 0, t)), [1, 1, 2, 1]);
  });

  // ----- R7 ------------------------------------------------------------------
  check('R7.1', 'a bonus action is the optional last part of a Gather at its own district; what was just gathered may pay for it', () => {
    const s = game(2);
    give(s, 0, { resources: { gunpowder: 1 }, coins: 1 }); // no Iron before the Gather
    refused(s, { type: 'hireSpecialist', specialist: 'crew' });
    placeAndChoose(s, 'W2', 'D3'); // gather 2 Iron
    assert.equal(kind(s), 'bonusAction');
    assert.ok(!offered(s, 'buyHat') && !offered(s, 'addCarriage'), 'only the bonus action printed on this district');
    assert.ok(offered(s, 'skipBonusAction'), 'it is optional');
    act(s, { type: 'hireSpecialist', specialist: 'crew' }); // 1 Coin and nothing else (R7.4)
    assert.deepEqual(held(s.players[0]), { iron: 2, wood: 0, gunpowder: 1, coins: 0 });
    const t = game(2);
    placeAndChoose(t, 'W2', 'D2');
    assert.notEqual(kind(t), 'bonusAction', 'no bonus action after a district that is not a Gather');
  });
  check('R7.2/once-per-turn', 'default: at most once per Gather action whatever M is; no limit across the game', () => {
    const s = game(2);
    give(s, 0, { resources: { gunpowder: 3 } });
    put(s, 0, 'W8');
    placeAndChoose(s, 'W11', 'D7'); // M = 2
    act(s, { type: 'buyHat' });
    assert.equal(s.players[0].hats, 1);
    assert.equal(s.turn.player, 1, 'one bonus action and the turn is over');
    idleUntil(s, 0);
    choose(s, act(s, { type: 'removeWorker', from: 'W11' }), 'D7');
    assert.ok(offered(s, 'buyHat'), 'the same bonus action again on a later turn');
  });
  check('R7.2/once-per-game', 'once-per-game: each player may take each bonus action once in the whole game', () => {
    const s = game(2, { bonusActionLimit: 'once-per-game' });
    give(s, 0, { resources: { gunpowder: 3, wood: 3 } });
    placeAndChoose(s, 'W11', 'D7');
    act(s, { type: 'buyHat' });
    idleUntil(s, 0);
    choose(s, act(s, { type: 'removeWorker', from: 'W11' }), 'D7');
    assert.ok(s.turn.player !== 0 || !offered(s, 'buyHat'), 'Buy Hat was used up');
    idleUntil(s, 0);
    placeAndChoose(s, 'W12', 'D9');
    assert.ok(offered(s, 'addCarriage'), 'the other bonus actions are still unused');
    act(s, { type: 'skipBonusAction' });
    assert.equal(s.turn.player, 1);
    give(s, 1, { resources: { gunpowder: 2 } });
    placeAndChoose(s, 'W8', 'D7');
    assert.ok(offered(s, 'buyHat'), 'the limit is per player');
  });
  check('R7.2/multiplied', 'multiplied: up to M times per Gather action, paying each time', () => {
    const s = game(2, { bonusActionLimit: 'multiplied' });
    give(s, 0, { resources: { gunpowder: 5 } });
    put(s, 0, 'W8');
    placeAndChoose(s, 'W11', 'D7'); // M = 2
    act(s, { type: 'buyHat' });
    assert.equal(kind(s), 'bonusAction', 'a second one is on offer');
    assert.equal(s.turn.player, 0);
    act(s, { type: 'buyHat' });
    assert.equal(s.players[0].hats, 2);
    assert.equal(s.players[0].resources.gunpowder, 3);
    assert.equal(s.turn.player, 1, 'M = 2 gives two, not three');
  });
  check('R7.3', 'Carriage Upgrade at Gather Gunpowder: 1 Iron, take a tile from the display and install it', () => {
    const s = game(2, UPGRADES);
    placeAndChoose(s, 'W1', 'D1');
    assert.equal(kind(s), 'bonusAction');
    const tiles = offers(s, 'installUpgrade');
    assert.deepEqual(sorted(tiles.map((a) => a.tile)), sorted(['U1-vp', 'U1-wood', 'U1-iron', 'U1-coin', 'U1-gunpowder', 'U1-hat']));
    assert.ok(tiles.every((a) => a.level === 1));
    act(s, { type: 'installUpgrade', tile: 'U1-gunpowder', level: 1 });
    assert.equal(s.players[0].resources.iron, 0);
    assert.ok(!s.modules.upgrades.display.includes('U1-gunpowder'));
    assert.equal(s.modules.upgrades.installed[0][0], 'U1-gunpowder');
  });
  check('R7.3/off', 'with the module off the Carriage Upgrade bonus action does not exist', () => {
    const s = game(2);
    placeAndChoose(s, 'W1', 'D1');
    assert.equal(s.turn.player, 1, 'no bonus action is offered at Gather Gunpowder');
    assert.equal(s.players[0].resources.iron, 1);
  });
  check('R7.3/none', 'with no legal tile-and-carriage pair the bonus action cannot be taken', () => {
    const s = game(2, UPGRADES);
    installTile(s, 0, 1, 'U1-vp'); // the only carriage already carries a tile
    placeAndChoose(s, 'W1', 'D1');
    assert.equal(s.turn.player, 1);
    const t = game(2, UPGRADES);
    give(t, 0, { resources: { iron: 0 } });
    placeAndChoose(t, 'W1', 'D1');
    assert.equal(t.turn.player, 1, 'no Iron, no upgrade');
  });
  check('R7.4', 'Hire Specialist at Gather Iron: 1 Coin and nothing else; hireCostModel fee-plus-table and table-only', () => {
    const run = (model) => {
      const s = game(2, { hireCostModel: model });
      give(s, 0, { resources: { iron: 0, gunpowder: 2, wood: 0 }, coins: 3 });
      placeAndChoose(s, 'W2', 'D3'); // + 2 Iron
      act(s, { type: 'hireSpecialist', specialist: 'crew' });
      assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['crew', 'crew']);
      return held(s.players[0]);
    };
    assert.deepEqual(run('fee-plus-table'), { iron: 1, wood: 0, gunpowder: 1, coins: 2 });
    assert.deepEqual(run('fee-only'), { iron: 2, wood: 0, gunpowder: 2, coins: 2 });
    assert.deepEqual(run('table-only'), { iron: 1, wood: 0, gunpowder: 1, coins: 3 });
  });
  check('R7.5', 'Buy Hat at Gather Wood: 1 Gunpowder for 1 hat; not for a player who holds 2 hats', () => {
    const s = game(2);
    give(s, 0, { hats: 1 });
    placeAndChoose(s, 'W11', 'D7');
    act(s, { type: 'buyHat' });
    assert.equal(s.players[0].hats, 2);
    assert.equal(s.players[0].resources.gunpowder, 0);
    const t = game(2);
    give(t, 0, { hats: 2 });
    act(t, { type: 'placeWorker', space: 'W11' });
    act(t, { type: 'chooseDistrict', district: 'D7', hat: false });
    assert.equal(t.turn.player, 1, 'holding 2 hats, Buy Hat cannot be taken at all');
    assert.equal(t.players[0].resources.gunpowder, 1);
  });
  check('R7.6', 'Add Carriage at Gather Coins: 1 Wood for one carriage of your choice; not with 3 of each', () => {
    const s = game(2);
    placeAndChoose(s, 'W12', 'D9');
    assert.deepEqual(sorted(offers(s, 'addCarriage').map((a) => a.carriage)), ['specialist', 'storage']);
    act(s, { type: 'addCarriage', carriage: 'storage' });
    assert.equal(s.players[0].resources.wood, 0);
    assert.equal(s.players[0].train.storageCarriages, 2);
    const t = game(2);
    setTrain(t, 0, [['crew', null], [null, null], [null, null]]);
    placeAndChoose(t, 'W12', 'D9');
    assert.deepEqual(offers(t, 'addCarriage').map((a) => a.carriage), ['storage']);
    const u = game(2);
    setTrain(u, 0, [['crew', null], [null, null], [null, null]]);
    u.players[0].train.storageCarriages = 3;
    placeAndChoose(u, 'W12', 'D9');
    assert.equal(u.turn.player, 1, 'with 3 of each the bonus action cannot be taken');
  });
  check('R7.7', 'a bonus action whose cost cannot be paid in full cannot be taken', () => {
    const s = game(2);
    give(s, 0, { resources: { wood: 0, iron: 1, gunpowder: 1 } });
    placeAndChoose(s, 'W12', 'D9');
    assert.equal(s.turn.player, 1);
    assert.equal(s.players[0].train.storageCarriages, 1);
    const t = game(2);
    give(t, 0, { coins: 0 });
    placeAndChoose(t, 'W2', 'D3'); // no Coin, no hire
    assert.equal(t.turn.player, 1);
    const u = game(2, { hireCostModel: 'fee-plus-table' });
    give(u, 0, { resources: { iron: 0, wood: 1, gunpowder: 1 }, coins: 1 });
    placeAndChoose(u, 'W2', 'D3'); // 2 Iron; a Financier needs 2 Coins in all
    assert.ok(!offered(u, 'hireSpecialist', { specialist: 'financier' }));
    assert.ok(offered(u, 'hireSpecialist', { specialist: 'crew' }));
  });

  // ----- R8 ------------------------------------------------------------------
  check('R8.1', 'starting train: engine, one specialist carriage, one storage carriage', () => {
    const s = game(4);
    for (const p of s.players) assert.deepEqual([p.train.specialistCarriages.length, p.train.storageCarriages], [1, 1]);
  });
  check('R8.2.1', 'at most 3 specialist carriages, levelled 1, 2, 3 in the order they joined', () => {
    const s = game(2, { hireCostModel: 'table-only' });
    setTrain(s, 0, [['crew', 'crew']]);
    placeAndChoose(s, 'W12', 'D9');
    act(s, { type: 'addCarriage', carriage: 'specialist' });
    assert.equal(s.players[0].train.specialistCarriages.length, 2);
    idleUntil(s, 0);
    placeAndChoose(s, 'W2', 'D3'); // + 2 Iron
    const before = held(s.players[0]);
    act(s, { type: 'hireSpecialist', specialist: 'crew' });
    const after = held(s.players[0]);
    assert.deepEqual([before.iron - after.iron, before.gunpowder - after.gunpowder], [2, 1], 'the second carriage is level 2');
    assert.deepEqual(s.players[0].train.specialistCarriages[1].slots, ['crew', null]);
  });
  check('R8.3', 'at most 3 storage carriages; each adds 9 to capacity', () => {
    const s = game(2);
    assert.equal(storageCapacity(s, 0), 9);
    s.players[0].train.storageCarriages = 2;
    placeAndChoose(s, 'W12', 'D9');
    act(s, { type: 'addCarriage', carriage: 'storage' });
    assert.equal(storageCapacity(s, 0), 27);
    idleUntil(s, 0);
    give(s, 0, { resources: { wood: 2 } });
    choose(s, act(s, { type: 'removeWorker', from: 'W12' }), 'D9');
    assert.deepEqual(offers(s, 'addCarriage').map((a) => a.carriage), ['specialist']);
  });
  check('R8.4', 'order of the train: Foreman, then specialist carriage level 1, level 2, level 3', () => {
    const s = game(2);
    setTrain(s, 0, [['crew', null], ['miner', null], ['engineer', null]]);
    s.players[0].train.storageCarriages = 2;
    give(s, 0, { resources: { iron: 4, gunpowder: 4, wood: 6 } });
    const ev = placeAndChoose(s, 'W6', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
    assert.deepEqual(
      eventsOf(ev, 'build').map((e) => `${e.level}:${e.terrain}`),
      ['0:ground', '1:ground', '2:tunnel', '3:bridge'],
    );
  });
  check('R8.5.1', 'storage capacity is 9 x storage carriages: 9 at the start, 27 at most', () => {
    const s = game(2);
    for (const n of [1, 2, 3]) {
      s.players[0].train.storageCarriages = n;
      assert.equal(storageCapacity(s, 0), 9 * n);
    }
  });
  check('R8.5.2', 'each Iron, Wood, Gunpowder and each built track tile takes 1 unit', () => {
    const s = game(2);
    give(s, 0, { resources: { iron: 2, wood: 1, gunpowder: 1 }, tiles: { ground: 2, tunnel: 2, bridge: 1 } });
    assert.equal(storageUsed(s.players[0]), 9);
    assert.equal(storageOverflow(s, 0), 0);
    placeAndChoose(s, 'W1', 'D1'); // + 1 Gunpowder
    assert.equal(kind(s), 'discard');
    assert.equal(storageOverflow(s, 0), 1);
  });
  check('R8.5.3', 'Coins, cowboy hats and Pony Express tokens take no capacity', () => {
    const s = game(2, PONY);
    give(s, 0, { resources: { iron: 9 }, coins: 40, hats: 2 });
    giveTokens(s, 0, 6);
    assert.equal(storageOverflow(s, 0), 0);
    placeAndChoose(s, 'W12', 'D9');
    assert.notEqual(kind(s), 'discard');
  });
  check('R8.5.4', 'overflow: at once the player discards stored items of their choice, old or new, resources or built tiles, down to capacity', () => {
    const s = game(2);
    give(s, 0, { resources: { iron: 3, wood: 2 }, tiles: { ground: 2, tunnel: 2 } });
    put(s, 0, 'W3'); // M = 2 at Gather Gunpowder
    placeAndChoose(s, 'W1', 'D1'); // + 2 Gunpowder: 11 of 9
    assert.equal(kind(s), 'discard');
    assert.deepEqual(sorted(getValidActions(s).map((a) => a.item)), sorted(['iron', 'wood', 'gunpowder', 'ground', 'tunnel']));
    assert.ok(getValidActions(s).every((a) => a.type === 'discard'), 'the discard is not optional');
    const vp = vpTotal(s, 0);
    const coins = s.players[0].coins;
    act(s, { type: 'discard', item: 'ground' });
    assert.equal(kind(s), 'discard');
    act(s, { type: 'discard', item: 'gunpowder' });
    assert.notEqual(kind(s), 'discard');
    assert.equal(storageUsed(s.players[0]), 9);
    assert.equal(s.players[0].builtTiles.ground, 1);
    assert.deepEqual([vpTotal(s, 0), s.players[0].coins], [vp, coins], 'nothing is gained for a discard');
  });
  check('R8.5.4/other', 'overflow applies to a player on another player\'s turn', () => {
    const s = game(3);
    put(s, 1, 'W10');
    put(s, 2, 'W12');
    give(s, 1, { hats: 2, resources: { iron: 9 } });
    act(s, { type: 'displaceWorker', district: 'D9' });
    assert.equal(kind(s), 'chooseResource');
    assert.equal(s.toAct, 1);
    act(s, { type: 'chooseResource', resource: 'wood' });
    assert.equal(kind(s), 'discard', 'Ben is over capacity on Anna\'s turn and discards at once');
    assert.equal(s.toAct, 1);
    assert.equal(s.turn.player, 0);
    act(s, { type: 'discard', item: 'iron' });
    assert.deepEqual(s.players[1].resources, { iron: 8, wood: 1, gunpowder: 0 });
    assert.notEqual(s.toAct, 1);
  });
  check('R8.5.5', 'a player may not discard at any other time', () => {
    const s = game(2);
    assert.ok(!offered(s, 'discard'));
    refused(s, { type: 'discard', item: 'iron' });
    give(s, 0, { resources: { iron: 9 } });
    refused(s, { type: 'discard', item: 'iron' });
  });
  check('R8.5.6', 'all resources and built tiles are one pool across the storage carriages', () => {
    const s = game(2);
    s.players[0].train.storageCarriages = 2;
    give(s, 0, { resources: { iron: 17 } });
    placeAndChoose(s, 'W1', 'D1');
    assert.notEqual(kind(s), 'discard', '18 items of any mix fit two storage carriages');
    assert.equal(storageUsed(s.players[0]), 18);
  });
  check('R8.6.1', 'a new specialist goes to the lowest-level carriage with an empty slot, slot 1 before slot 2; no empty slot, no hire', () => {
    const s = game(2, { hireCostModel: 'fee-only' });
    setTrain(s, 0, [[null, null], [null, null]]);
    give(s, 0, { coins: 9 });
    const where = [];
    for (let i = 0; i < 4; i++) {
      idleUntil(s, 0);
      if (s.grid.spaces.W2 === 0) choose(s, act(s, { type: 'removeWorker', from: 'W2' }), 'D3');
      else placeAndChoose(s, 'W2', 'D3');
      if (kind(s) === 'discard') finishDiscards(s);
      const ev = act(s, { type: 'hireSpecialist', specialist: 'miner' });
      where.push(`${eventOf(ev, 'hire').level}.${eventOf(ev, 'hire').slot}`);
    }
    assert.deepEqual(where, ['1.1', '1.2', '2.1', '2.2']);
    idleUntil(s, 0);
    give(s, 0, { resources: {} });
    placeAndChoose(s, 'W5', 'D3');
    assert.ok(s.turn.player === 1 || !offered(s, 'hireSpecialist'), 'every slot is full: no hire');
  });
  check('R8.6.2', 'a specialist type whose tiles have run out cannot be hired', () => {
    const s = game(2, { hireCostModel: 'fee-only' });
    s.supply.specialists.financier = 0;
    placeAndChoose(s, 'W2', 'D3');
    assert.deepEqual(sorted(offers(s, 'hireSpecialist').map((a) => a.specialist)), ['crew', 'engineer', 'miner']);
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.equal(s.supply.specialists.miner, 11);
  });
  const R8_6_3 = {
    crew: [{ iron: 1, gunpowder: 1 }, { iron: 2, gunpowder: 1 }, { iron: 2, gunpowder: 2 }],
    miner: [{ gunpowder: 1, wood: 1 }, { gunpowder: 2, wood: 1 }, { gunpowder: 2, wood: 2 }],
    engineer: [{ wood: 1, coins: 1 }, { wood: 2, coins: 1 }, { wood: 2, coins: 2 }],
    financier: [{ coins: 1, iron: 1 }, { coins: 2, iron: 1 }, { coins: 2, iron: 2 }],
  };
  for (const type of Object.keys(R8_6_3)) {
    check(`R8.6.3/${type}`, `hire cost of a ${type} at carriage levels 1, 2 and 3`, () => {
      const trains = [[[null, null]], [['crew', 'crew'], [null, null]], [['crew', 'crew'], ['crew', 'crew'], [null, null]]];
      trains.forEach((train, i) => {
        const s = game(2, { hireCostModel: 'table-only' });
        setTrain(s, 0, train);
        s.players[0].train.storageCarriages = 3;
        give(s, 0, { resources: { iron: 4, wood: 4, gunpowder: 4 }, coins: 5 });
        placeAndChoose(s, 'W2', 'D3');
        const before = held(s.players[0]);
        act(s, { type: 'hireSpecialist', specialist: type });
        const after = held(s.players[0]);
        const paid = {};
        for (const k of Object.keys(before)) if (before[k] !== after[k]) paid[k] = before[k] - after[k];
        assert.deepEqual(paid, R8_6_3[type][i], `${type}, level ${i + 1}`);
      });
    });
  }
  check('R8.6.4', '"hire for free": no fee and no hire cost, but the slot rule and the supply still apply', () => {
    const s = game(2, PONY);
    stock(s, 'PX6');
    giveTokens(s, 1, 2);
    s.supply.specialists.miner = 0;
    idleTurn(s);
    const before = held(s.players[1]);
    act(s, { type: 'buyPonyCard', card: 'PX6' });
    assert.equal(kind(s), 'hireSpecialist');
    assert.ok(!offered(s, 'hireSpecialist', { specialist: 'miner' }));
    const ev = act(s, { type: 'hireSpecialist', specialist: 'financier' });
    assert.deepEqual(held(s.players[1]), before);
    assert.deepEqual([eventOf(ev, 'hire').level, eventOf(ev, 'hire').slot], [1, 2]);
  });
  check('R8.6.5', 'a hired specialist never moves and is never removed', () => {
    const s = game(2, { hireCostModel: 'fee-only' });
    placeAndChoose(s, 'W2', 'D3');
    act(s, { type: 'hireSpecialist', specialist: 'financier' });
    for (let i = 0; i < 6; i++) idleTurn(s);
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['crew', 'financier']);
  });
  check('R8.7', 'a new specialist carriage may be added before the earlier ones are full, but stays empty until they are', () => {
    const s = game(2, { hireCostModel: 'fee-only' });
    give(s, 0, { coins: 3 });
    placeAndChoose(s, 'W12', 'D9');
    act(s, { type: 'addCarriage', carriage: 'specialist' });
    assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', null], [null, null]]);
    idleUntil(s, 0);
    placeAndChoose(s, 'W2', 'D3');
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.deepEqual(s.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'miner'], [null, null]]);
  });
  const R8_8 = {
    '1:1': { crew: { iron: 1 }, miner: { gunpowder: 1 }, engineer: { wood: 1 } },
    '2:1': { crew: { iron: 2 }, miner: { gunpowder: 2 }, engineer: { wood: 2 } },
    'iron-in-all': { crew: { iron: 2 }, miner: { gunpowder: 1, iron: 1 }, engineer: { wood: 1, iron: 1 } },
  };
  const OUTPUT = { crew: ['D4', 'ground', 'W8'], miner: ['D8', 'tunnel', 'W11'], engineer: ['D6', 'bridge', 'W10'] };
  for (const rate of Object.keys(R8_8)) {
    check(`R8.8/${rate}`, `conversionRate ${rate}: what a Crew, Miner and Engineer pay for one built tile; a Financier pays nothing`, () => {
      for (const type of ['crew', 'miner', 'engineer']) {
        const [district, terrain, space] = OUTPUT[type];
        const s = game(2, { conversionRate: rate });
        setTrain(s, 0, [[null, null]]);
        give(s, 0, { resources: { iron: 3, wood: 3, gunpowder: 3 } });
        placeAndChoose(s, space, district);
        act(s, { type: 'useStep' });
        const r = s.players[0].resources;
        const paid = {};
        for (const k of ['iron', 'wood', 'gunpowder']) if (r[k] !== 3) paid[k] = 3 - r[k];
        assert.deepEqual(paid, R8_8[rate][type], type);
        assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0, [terrain]: 1 });
        // one short of the cost: the step cannot be used
        const t = game(2, { conversionRate: rate });
        setTrain(t, 0, [[null, null]]);
        const cost = R8_8[rate][type];
        const first = Object.keys(cost)[0];
        give(t, 0, { resources: { iron: 3, wood: 3, gunpowder: 3, [first]: cost[first] - 1 } });
        placeAndChoose(t, space, district);
        assert.equal(t.turn.player, 1, `${type}: the step is skipped when the cost cannot be paid`);
        assert.equal(t.players[0].builtTiles[terrain], 0);
      }
      const f = game(2, { conversionRate: rate });
      setTrain(f, 0, [[null, null]]);
      give(f, 0, { resources: {}, coins: 0 });
      const ev = placeAndChoose(f, 'W1', 'D2');
      assert.equal(eventsOf(ev, 'lobbyPoint').length, 1);
    });
  }

  // ----- R9 ------------------------------------------------------------------
  check('R9.1', 'a train activation happens at Ground Tracks, Tunnel Tracks, Bridge Tracks and Lobby Congress, and nowhere else on the grid', () => {
    const count = (d) => {
      const s = game(2);
      give(s, 0, { coins: 0, tiles: { tunnel: 2 } });
      setHeads(s, 0, 'POR', 'MIN');
      return eventsOf(goTo(s, d), 'trainActivation').length;
    };
    assert.deepEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'].map(count), [0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });
  check('R9.2', 'the Foreman acts as a Crew at D4, a Miner at D8, an Engineer at D6 and a Financier at D2', () => {
    for (const [d, terrain] of [['D4', 'ground'], ['D8', 'tunnel'], ['D6', 'bridge']]) {
      const s = game(2);
      setTrain(s, 0, [[null, null]]);
      give(s, 0, { resources: { iron: 2, wood: 2, gunpowder: 2 } });
      goTo(s, d);
      const ev = act(s, { type: 'useStep' });
      assert.deepEqual([eventOf(ev, 'build').terrain, eventOf(ev, 'build').level], [terrain, 0]);
    }
    const s = game(2);
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { coins: 0 });
    assert.equal(eventsOf(goTo(s, 'D2'), 'lobbyPoint').length, 1);
  });
  check('R9.3', 'activations per piece: Foreman M, every specialist 1 whatever its level; by-level gives 1, 2, 3', () => {
    const builds = (variants) => {
      const s = game(2, variants);
      setTrain(s, 0, [['crew', null], ['crew', null], ['crew', null]]);
      s.players[0].train.storageCarriages = 3;
      give(s, 0, { resources: { iron: 20 } });
      put(s, 0, 'W3'); // M = 2
      placeAndChoose(s, 'W6', 'D4');
      while (kind(s) === 'trainActivation' && s.turn.player === 0) act(s, { type: 'useStep' });
      return s.players[0].builtTiles.ground;
    };
    assert.equal(builds({}), 2 + 1 + 1 + 1);
    assert.equal(builds({ specialistActivations: 'by-level' }), 2 + 1 + 2 + 3);
  });
  check('R9.4.2', 'the step list: Foreman M times, then for each carriage in level order slot 1 and then slot 2, each repeated as R9.3 says', () => {
    const run = (variants) => {
      const s = game(2, variants);
      setTrain(s, 0, [['engineer', 'crew'], ['crew', 'engineer']]);
      s.players[0].train.storageCarriages = 2;
      give(s, 0, { resources: { iron: 10, wood: 6 } });
      put(s, 0, 'W3'); // M = 2
      const ev = placeAndChoose(s, 'W6', 'D4');
      const steps = eventOf(ev, 'trainActivation').steps;
      while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
      return [steps, eventsOf(ev, 'build').map((e) => `${e.level}:${e.terrain}`)];
    };
    assert.deepEqual(run({}), [2 + 1 + 1 + 1 + 1, ['0:ground', '0:ground', '1:bridge', '1:ground', '2:ground', '2:bridge']]);
    assert.deepEqual(run({ specialistActivations: 'by-level' }),
      [2 + 1 + 1 + 2 + 2, ['0:ground', '0:ground', '1:bridge', '1:ground', '2:ground', '2:ground', '2:bridge', '2:bridge']]);
  });
  check('R9.4.3/use', 'a Crew, Miner or Engineer step: use (pay, take 1 built tile) or skip; use only if the cost can be paid', () => {
    const s = game(2);
    setTrain(s, 0, [['crew', 'crew']]);
    give(s, 0, { resources: { iron: 4 } });
    placeAndChoose(s, 'W6', 'D4');
    assert.deepEqual(types(s), ['skipStep', 'useStep']);
    act(s, { type: 'skipStep' }); // the Foreman
    assert.deepEqual([s.players[0].resources.iron, s.players[0].builtTiles.ground], [4, 0], 'on skip nothing happens');
    act(s, { type: 'useStep' });
    assert.deepEqual([s.players[0].resources.iron, s.players[0].builtTiles.ground], [2, 1]);
    act(s, { type: 'useStep' });
    assert.deepEqual([s.players[0].resources.iron, s.players[0].builtTiles.ground], [0, 2]);
    assert.equal(s.turn.player, 1);
  });
  check('R9.4.3/financier', 'a Financier step adds 1 lobby point with no cost and no choice', () => {
    const s = game(2);
    setTrain(s, 0, [['financier', 'financier']]);
    give(s, 0, { coins: 0 });
    const ev = placeAndChoose(s, 'W1', 'D2');
    assert.deepEqual(eventsOf(ev, 'lobbyPoint').map((e) => e.total), [1, 2, 3]);
    assert.equal(eventsOf(ev, 'pay').length, 0);
    assert.equal(s.turn.player, 1, 'no decision was asked');
  });
  check('R9.4.3/overflow', 'storage overflow is applied after the step that caused it, before the next step', () => {
    const s = lobbyGame();
    s.players[0].train.storageCarriages = 1;
    give(s, 0, { resources: { iron: 8 } });
    act(s, { type: 'takeCongressEntry', entry: 'C1' }); // 2 Wood: 10 of 9
    assert.equal(kind(s), 'discard');
    assert.equal(s.toAct, 0);
    const ev = act(s, { type: 'discard', item: 'iron' });
    assert.equal(eventsOf(ev, 'lobbyPoint').length, 1, 'only then does the next Financier step run');
    assert.equal(kind(s), 'trainActivation');
  });
  check('R9.4.3/congress', 'after a step, with at least 1 lobby point, the player may take Congress entries or keep the points for later steps', () => {
    const s = lobbyGame();
    assert.equal(topFrame(s).lobby, 1);
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C1', 'C2']);
    act(s, { type: 'closeCongress' });
    assert.equal(topFrame(s).lobby, 2, 'the point was kept and the next Financier added one');
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C1', 'C2', 'C3', 'C4']);
  });
  check('R9.4.4', 'one last chance after the step list, then remaining lobby points are lost', () => {
    const s = game(2);
    setTrain(s, 0, [['miner', 'financier']]);
    give(s, 0, { coins: 5, resources: {} });
    const ev = placeAndChoose(s, 'W1', 'D2');
    act(s, { type: 'closeCongress' }); // after the Foreman; the Miner step is skipped (no Gunpowder)
    if (topFrame(s).lobby === 1) ev.push(...act(s, { type: 'closeCongress' })); // the window after the skipped Miner step
    assert.equal(kind(s), 'trainActivation');
    assert.equal(topFrame(s).lobby, 2, 'the step list is finished and the last chance is offered');
    assert.ok(offered(s, 'takeCongressEntry', { entry: 'C3' }));
    const end = act(s, { type: 'closeCongress' });
    assert.equal(eventOf(end, 'lobbyPointsLost').amount, 2);
    assert.equal(s.turn.player, 1);
    // the next activation starts from 0 lobby points (R9.4.1)
    idleUntil(s, 0);
    choose(s, act(s, { type: 'removeWorker', from: 'W1' }), 'D2');
    assert.equal(topFrame(s).lobby, 1);
  });
  check('R9.5', 'steps cannot be reordered and a skipped step cannot be taken later; resources gained in the activation pay for later steps', () => {
    const s = game(2);
    setTrain(s, 0, [['financier', 'miner']]);
    give(s, 0, { coins: 4, resources: {} });
    placeAndChoose(s, 'W1', 'D2');
    act(s, { type: 'closeCongress' });
    act(s, { type: 'takeCongressEntry', entry: 'C3' }); // 2 Gunpowder and a hat
    if (kind(s) === 'trainActivation' && topFrame(s).congress) act(s, { type: 'closeCongress' });
    assert.ok(offered(s, 'useStep'), 'the Miner can now pay with the Gunpowder just gained');
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].builtTiles.tunnel, 1);
    const t = game(2);
    setTrain(t, 0, [['crew', null]]);
    give(t, 0, { resources: { iron: 2 } });
    placeAndChoose(t, 'W6', 'D4');
    act(t, { type: 'skipStep' }); // the Foreman
    act(t, { type: 'skipStep' }); // the Crew
    assert.equal(t.turn.player, 1, 'the skipped steps are gone');
    assert.equal(t.players[0].builtTiles.ground, 0);
  });
  check('R9.6', 'built tiles stay on the train: an activation puts nothing on the map and Lay Tracks builds nothing', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    give(s, 0, { resources: { wood: 4 } });
    placeAndChoose(s, 'W7', 'D6');
    act(s, { type: 'useStep' });
    finishTurn(s);
    assert.ok(Object.values(s.map.routeOwner).every((o) => o === null));
    assert.equal(s.players[0].builtTiles.bridge, 1);
    idleUntil(s, 0);
    s.players[0].builtTiles.bridge = 2;
    choose(s, act(s, { type: 'removeWorker', from: 'W7' }), 'D5');
    if (kind(s) === 'layTracks') act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' });
    assert.equal(s.map.routeOwner['POR-SPO'], 0);
    assert.deepEqual(s.players[0].builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
  });
  check('R9.7', 'with no specialist that matches the district the player still builds through the Foreman', () => {
    const s = game(2);
    setTrain(s, 0, [['financier', null]]);
    give(s, 0, { resources: { gunpowder: 2 }, coins: 0 });
    placeAndChoose(s, 'W11', 'D8');
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].builtTiles.tunnel, 1);
  });

  // ----- R10 -----------------------------------------------------------------
  const R10_1 = [['C1', 1, 1], ['C2', 1, 1], ['C3', 2, 2], ['C4', 2, 2], ['C5', 3, 3], ['C6', 3, 3], ['CR', 1, 1]];
  check('R10.1', 'the Congress strip: tier and Coin cost of C1 to C6 and Reset', () => {
    const s = game(2);
    void s;
    assert.deepEqual(RULES.CONGRESS.tables['design-2026-10'].map((e) => [e.id, e.tier, e.coinCost]), R10_1);
  });
  check('R10.1/C1', 'C1: 1 lobby point and 1 Coin for 2 Wood', () => {
    const { s, coinsPaid } = takeAtTier('C1', 1);
    assert.deepEqual(held(s.players[0]), { iron: 0, wood: 2, gunpowder: 0, coins: 19 });
    assert.equal(coinsPaid, 1);
  });
  check('R10.1/C2', 'C2: 1 lobby point and 1 Coin for 2 Iron', () => {
    const { s } = takeAtTier('C2', 1);
    assert.deepEqual(held(s.players[0]), { iron: 2, wood: 0, gunpowder: 0, coins: 19 });
  });
  check('R10.1/C3', 'C3: 2 lobby points and 2 Coins for 2 Gunpowder and 1 cowboy hat', () => {
    const { s } = takeAtTier('C3', 2);
    assert.deepEqual(held(s.players[0]), { iron: 0, wood: 0, gunpowder: 2, coins: 18 });
    assert.equal(s.players[0].hats, 1);
  });
  check('R10.1/C4', 'C4: 2 lobby points and 2 Coins to add 1 carriage of either kind for free', () => {
    let asked = null;
    const { s } = takeAtTier('C4', 2, (x) => {
      asked = [kind(x), sorted(offers(x, 'addCarriage').map((a) => a.carriage))];
      return { type: 'addCarriage', carriage: 'specialist' };
    }, {}, (x) => { x.players[0].train.storageCarriages = 2; });
    assert.deepEqual(asked, ['addCarriage', ['specialist', 'storage']]);
    assert.equal(s.players[0].train.specialistCarriages.length, 2);
    assert.equal(s.players[0].train.storageCarriages, 2);
    assert.deepEqual(held(s.players[0]), { iron: 0, wood: 0, gunpowder: 0, coins: 18 });
  });
  check('R10.1/C5', 'C5: 3 lobby points and 3 Coins for 2 built track tiles, any types, same or different', () => {
    for (const pick of [['bridge', 'bridge'], ['ground', 'tunnel']]) {
      const s = lobbyGame();
      waitLobby(s, 3);
      act(s, { type: 'takeCongressEntry', entry: 'C5' });
      assert.equal(kind(s), 'chooseBuiltTile');
      assert.deepEqual(sorted(getValidActions(s).map((a) => a.terrain)), ['bridge', 'ground', 'tunnel']);
      act(s, { type: 'chooseBuiltTile', terrain: pick[0] });
      act(s, { type: 'chooseBuiltTile', terrain: pick[1] });
      const want = { ground: 0, tunnel: 0, bridge: 0 };
      for (const t of pick) want[t] += 1;
      assert.deepEqual(s.players[0].builtTiles, want);
      assert.equal(s.players[0].coins, 17);
      assert.equal(kind(s), 'trainActivation');
    }
  });
  check('R10.1/C6', 'C6: 3 lobby points and 3 Coins to place up to 1 railway station and up to 1 telegraph station, or gain 3 VP', () => {
    const s = lobbyGame();
    claim(s, 1, 'POR-SPO');
    waitLobby(s, 3);
    act(s, { type: 'takeCongressEntry', entry: 'C6' });
    assert.equal(kind(s), 'chooseOption');
    assert.equal(getValidActions(s).length, 2);
    const vpOption = topFrame(s).options.findIndex((o) => o.effects.some((e) => e.type === 'vp'));
    const ev = act(s, { type: 'chooseOption', option: vpOption });
    assert.deepEqual(vpBySource(ev, 0), { congress: 3 });
    assert.equal(s.players[0].coins, 17);
  });
  check('R10.1/CR', 'Reset: 1 lobby point and 1 Coin', () => {
    const { s, coinsPaid } = takeAtTier('CR', 1, null, {}, (x) => { x.congress.used.C5 = true; });
    assert.equal(coinsPaid, 1);
    assert.equal(s.congress.used.C5, false);
  });
  check('R10.1/jan-2026', 'congressTable jan-2026: seven entries on seven senators, plus Reset', () => {
    const rows = RULES.CONGRESS.tables['jan-2026'].map((e) => [e.tier, e.coinCost, JSON.stringify(e.effects)]);
    const s = game(2, { congressTable: 'jan-2026' });
    assert.equal(Object.keys(s.congress.used).length, 7);
    assert.equal(rows.length, 8);
    assert.deepEqual(rows.map((r) => [r[0], r[1]]), [[1, 1], [1, 1], [1, 1], [2, 2], [2, 2], [3, 3], [3, 3], [1, 1]]);
    const gains = (entryIndex, lobby) => {
      const g = lobbyGame({ congressTable: 'jan-2026' });
      waitLobby(g, lobby);
      const id = RULES.CONGRESS.tables['jan-2026'][entryIndex].id;
      act(g, { type: 'takeCongressEntry', entry: id });
      let choices = 0;
      while (kind(g) === 'chooseResource' || kind(g) === 'chooseBuiltTile') {
        act(g, getValidActions(g)[0]);
        choices += 1;
      }
      const p = g.players[0];
      return { resources: p.resources.iron + p.resources.wood + p.resources.gunpowder, wood: p.resources.wood, iron: p.resources.iron, hats: p.hats, tiles: p.builtTiles.ground + p.builtTiles.tunnel + p.builtTiles.bridge, choices, coins: 20 - p.coins };
    };
    assert.deepEqual(gains(0, 1), { resources: 1, wood: 1, iron: 0, hats: 0, tiles: 0, choices: 0, coins: 1 });
    assert.deepEqual(gains(1, 1), { resources: 2, wood: 0, iron: 2, hats: 0, tiles: 0, choices: 0, coins: 1 });
    assert.deepEqual(gains(2, 1), { resources: 0, wood: 0, iron: 0, hats: 2, tiles: 0, choices: 0, coins: 1 });
    const four = gains(3, 2);
    assert.deepEqual([four.resources, four.choices, four.coins], [4, 4, 2]);
    const two = gains(4, 2);
    assert.deepEqual([two.tiles, two.choices, two.coins], [2, 2, 2]);
    const six = gains(5, 3);
    assert.deepEqual([six.resources, six.choices, six.coins], [6, 6, 3]);
    const three = gains(6, 3);
    assert.deepEqual([three.tiles, three.choices, three.coins], [3, 3, 3]);
  });
  check('R10.2', 'a taken entry is used and nobody can take it until a Reset; Reset is available whenever an entry is used', () => {
    const s = lobbyGame();
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'CR' }), 'Reset is not available while no entry is used');
    act(s, { type: 'takeCongressEntry', entry: 'C1' });
    assert.equal(s.congress.used.C1, true);
    waitLobby(s, 1);
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'C1' }));
    assert.ok(offered(s, 'takeCongressEntry', { entry: 'CR' }));
    finishTurn(s);
    // the strip is shared: Ben cannot take C1 either
    setTrain(s, 1, [['financier', null]]);
    give(s, 1, { coins: 5 });
    placeAndChoose(s, 'W2', 'D2');
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C2', 'CR']);
    refused(s, { type: 'takeCongressEntry', entry: 'C1' });
  });
  check('R10.3', 'lobby points come only from Financier steps, including a Financier specialist in an activation started at a track district', () => {
    const s = game(2);
    setTrain(s, 0, [['financier', null]]);
    give(s, 0, { coins: 3, resources: {} });
    const ev = placeAndChoose(s, 'W6', 'D4');
    assert.equal(eventsOf(ev, 'lobbyPoint').length, 1);
    assert.equal(kind(s), 'trainActivation');
    act(s, { type: 'takeCongressEntry', entry: 'C2' });
    assert.equal(s.players[0].resources.iron, 2);
    const t = game(2);
    give(t, 0, { coins: 3 });
    const none = placeAndChoose(t, 'W6', 'D4');
    assert.equal(eventsOf(none, 'lobbyPoint').length, 0, 'a Crew Foreman and a Crew give no lobby point');
  });
  check('R10.4.1', 'an entry costs lobby points equal to its tier', () => {
    const s = lobbyGame();
    assert.equal(topFrame(s).lobby, 1);
    refused(s, { type: 'takeCongressEntry', entry: 'C3' });
    refused(s, { type: 'takeCongressEntry', entry: 'C5' });
    takeAtTier('C5', 3, (x) => getValidActions(x)[0]);
    takeAtTier('C6', 3, (x) => getValidActions(x)[0]);
  });
  check('R10.4.2', 'an entry costs Coins equal to its coin cost', () => {
    const s = lobbyGame({}, 2, 2);
    waitLobby(s, 3);
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C1', 'C2', 'C3', 'C4']);
    refused(s, { type: 'takeCongressEntry', entry: 'C5' });
    act(s, { type: 'takeCongressEntry', entry: 'C3' });
    assert.equal(s.players[0].coins, 0);
    assert.ok(!offered(s, 'takeCongressEntry'), 'no Coins left: nothing can be taken');
  });
  check('R10.4.3', 'the senator slides down when an entry is taken, but not for Reset', () => {
    const s = lobbyGame();
    act(s, { type: 'takeCongressEntry', entry: 'C2' });
    assert.deepEqual(Object.keys(s.congress.used).filter((k) => s.congress.used[k]), ['C2']);
    assert.ok(!('CR' in s.congress.used));
  });
  check('R10.4.4', 'the benefit is resolved completely before anything else happens', () => {
    const s = lobbyGame();
    waitLobby(s, 3);
    act(s, { type: 'takeCongressEntry', entry: 'C5' });
    assert.deepEqual(types(s), ['chooseBuiltTile']);
    act(s, { type: 'chooseBuiltTile', terrain: 'ground' });
    assert.deepEqual(types(s), ['chooseBuiltTile']);
  });
  check('R10.5', 'several entries in one activation; an entry whose benefit cannot be carried out at all cannot be taken; C6 can always be taken for 3 VP', () => {
    const s = lobbyGame();
    setTrain(s, 0, [['financier', 'financier'], ['financier', 'financier'], [null, null]]); // 3 specialist + 3 storage carriages
    act(s, { type: 'takeCongressEntry', entry: 'C1' });
    waitLobby(s, 1);
    act(s, { type: 'takeCongressEntry', entry: 'C2' });
    assert.deepEqual(held(s.players[0]), { iron: 2, wood: 2, gunpowder: 0, coins: 18 });
    waitLobby(s, 3);
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'C4' }), 'C4 with 3 carriages of each kind');
    refused(s, { type: 'takeCongressEntry', entry: 'C4' });
    // no connected inland city anywhere: C6 still gives its 3 VP
    const ev = act(s, { type: 'takeCongressEntry', entry: 'C6' });
    if (kind(s) === 'chooseOption') ev.push(...act(s, getValidActions(s)[0]));
    assert.deepEqual(vpBySource(ev, 0), { congress: 3 });
  });
  check('R10.6', 'Reset: every used senator returns and the player gains 1 VP per senator moved; not when no entry is used', () => {
    const s = lobbyGame();
    refused(s, { type: 'takeCongressEntry', entry: 'CR' });
    s.congress.used.C2 = true;
    s.congress.used.C4 = true;
    s.congress.used.C6 = true;
    const ev = act(s, { type: 'takeCongressEntry', entry: 'CR' });
    assert.ok(Object.values(s.congress.used).every((u) => u === false));
    assert.deepEqual(vpBySource(ev, 0), { congress: 3 });
    assert.equal(s.players[0].coins, 19);
    waitLobby(s, 1);
    assert.ok(!offered(s, 'takeCongressEntry', { entry: 'CR' }));
    assert.ok(offered(s, 'takeCongressEntry', { entry: 'C2' }), 'the returned entries are available again');
  });
  check('R10.7', 'benefits go to storage; the hat of C3 follows the hat limit', () => {
    const s = lobbyGame();
    give(s, 0, { hats: 2 });
    waitLobby(s, 2);
    act(s, { type: 'takeCongressEntry', entry: 'C3' });
    assert.equal(kind(s), 'chooseResource', 'holding 2 hats: 1 resource of choice instead');
    act(s, { type: 'chooseResource', resource: 'iron' });
    assert.equal(s.players[0].hats, 2);
    assert.deepEqual(s.players[0].resources, { iron: 1, wood: 0, gunpowder: 2 });
  });
}

function finishDiscards(s) {
  while (kind(s) === 'discard') act(s, getValidActions(s)[0]);
}
