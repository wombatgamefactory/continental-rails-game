// setup-turn.test.mjs - Pacific Rails, second edition: setup (P3), the turn (P4),
// the action grid, displacement and action bonuses (P5), cowboy hats (P11.1, P11.2).
//
// Semantics: permanently green; exits 1 on any failure. Expected numbers are
// read from the engine's rules tables (getConstants) wherever they are data.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { E, start, act, put, setStorage, types, offered, eventOf, placeAndChoose, giveCarriages } from './rig.mjs';

const suite = makeSuite('pr2e setup-turn');

// ---------------------------------------------------------------------------
// P3 - setup
// ---------------------------------------------------------------------------

suite.check('P3.1, P3.2: every player starts with no carriage, storage 6, 1 of each resource and a Coin, and the workers of the player count', () => {
  for (const players of [2, 3, 4]) {
    const state = start(players);
    const K = E.getConstants(state);
    for (const p of state.players) {
      assert.equal(p.train.specialistCarriages.length, 0, 'P7.1: no carriage');
      assert.equal(E.storageCapacity(state, p.id), K.PLAYER_BOARD.boardStorage);
      assert.equal(E.storageCapacity(state, p.id), 6);
      assert.deepEqual(p.resources, { iron: 1, wood: 1, gunpowder: 1 });
      assert.equal(p.coins, 1);
      assert.equal(E.storageUsed(p), 4, 'P7.3: the Coin takes storage too');
      assert.equal(p.hats, 0);
      assert.equal(p.workersInSupply, { 2: 6, 3: 4, 4: 3 }[players]);
      assert.equal(E.housesOnBoard(p), 11, 'P3.3: 11 houses');
      assert.equal(p.telegraphsPlaced, 0);
      assert.ok(p.railheads.every((c) => c !== null));
    }
    for (const t of K.SPECIALIST_TYPES) assert.equal(state.supply.specialists[t], { 2: 4, 3: 5, 4: 6 }[players], 'P3.1.6');
    assert.equal(state.supply.upgrades.length, { 2: 10, 3: 15, 4: 20 }[players], 'P3.1.5');
    assert.deepEqual(Object.values(state.congress.down), new Array(8).fill(false), 'P3.1.3: 8 senators up');
    assert.deepEqual(state.modules, {}, 'no module of Continental Rails');
    assert.deepEqual(E.goalsInPlay(state), [], 'PART 2: goals');
  }
});

suite.check('P3.3: each player in seat order leaves one +1 space empty, before the draft; that track produces 2', () => {
  const state = E.createGame({ players: [{ name: 'Anna' }, { name: 'Ben' }, { name: 'Cara' }], seed: 5, shuffleSeats: false });
  const order = [];
  while (E.topFrame(state).kind === 'setupProduction') {
    order.push(state.toAct);
    const track = ['wood', 'coins', 'gunpowder'][state.toAct];
    act(state, { type: 'chooseStartingProduction', track });
  }
  assert.deepEqual(order, [0, 1, 2], 'seat order');
  assert.equal(E.topFrame(state).kind, 'setupRailhead', 'then the draft');
  assert.equal(E.production(state, 0, 'wood'), 2);
  assert.equal(E.production(state, 0, 'iron'), 1);
  assert.equal(E.production(state, 1, 'coins'), 2);
  assert.equal(E.production(state, 2, 'gunpowder'), 2);
  assert.equal(state.players[0].houses.wood, 2);
});

suite.check('P3.5: trains in reverse seat order, then in seat order on the opposite side; one train per start city in the draft', () => {
  const state = E.createGame({ playerCount: 3, seed: 6, shuffleSeats: false });
  while (E.topFrame(state).kind === 'setupProduction') act(state, E.getValidActions(state)[0]);
  assert.equal(state.toAct, 2, 'P3.5.1: last seat first');
  assert.match(E.getBlockReason(state, { type: 'placeRailhead', city: 'SPO' }), /inland city/);
  act(state, { type: 'placeRailhead', city: 'SEA' });
  assert.equal(state.toAct, 1);
  assert.match(E.getBlockReason(state, { type: 'placeRailhead', city: 'SEA' }), /already holds Player 3's train/);
  act(state, { type: 'placeRailhead', city: 'MIN' });
  act(state, { type: 'placeRailhead', city: 'POR' });
  assert.equal(state.toAct, 0, 'P3.5.2: then seat order');
  assert.match(E.getBlockReason(state, { type: 'placeRailhead', city: 'LAX' }), /opposite|second must start on an east/);
  assert.ok(E.getValidActions(state).every((a) => E.MAP.cityById[a.city].kind === 'east'));
  act(state, { type: 'placeRailhead', city: 'OMA' });
  act(state, { type: 'placeRailhead', city: 'SAC' }); // Ben, west
  act(state, { type: 'placeRailhead', city: 'KCY' }); // Cara, east
  assert.equal(state.phase, 'play');
  assert.equal(state.turn.player, 0, 'P3.6: seat 1 begins');
  assert.equal(E.topFrame(state).kind, 'workerStep');
  for (const p of state.players) assert.notEqual(E.startSide(p.railheads[0]), E.startSide(p.railheads[1]));
});

suite.check('P3.4: seats are shuffled with the game RNG unless the order is fixed', () => {
  const players = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
  const orders = new Set();
  for (let seed = 0; seed < 12; seed++) orders.add(E.createGame({ players, seed }).players.map((p) => p.name).join(''));
  assert.ok(orders.size > 3);
  assert.equal(E.createGame({ players, seed: 1, shuffleSeats: false }).players.map((p) => p.name).join(''), 'ABCD');
});

// ---------------------------------------------------------------------------
// P4 - the turn
// ---------------------------------------------------------------------------

suite.check('P4.2: a turn is a worker step, then the district choice; P4.3: with every worker out you must remove', () => {
  const state = start(4); // 3 workers each
  for (const at of ['W1', 'W5', 'W12']) put(state, 0, at);
  assert.deepEqual(types(state), ['removeWorker']);
  assert.match(E.getBlockReason(state, { type: 'placeWorker', space: 'W2' }), /no worker in your supply/);
});

suite.check('P4.4: Lay Track needs a legal lay and Hire Specialists needs a hire; with neither, D5 cannot be chosen', () => {
  const state = start(2);
  assert.match(E.getDistrictActionBlockReason(state, 0, 'D5'), /neither lay track nor hire/);
  assert.match(E.getDistrictActionBlockReason(state, 0, 'D5', 'hire'), /no carriage yet/);
  assert.match(E.getDistrictActionBlockReason(state, 0, 'D5', 'lay'), /no lay can start/);
  // A carriage with a free space makes hiring possible.
  giveCarriages(state, 0, [['crew', null]]);
  assert.equal(E.getDistrictActionBlockReason(state, 0, 'D5', 'hire'), null);
  assert.notEqual(E.getDistrictActionBlockReason(state, 0, 'D5', 'lay'), null);
  act(state, { type: 'placeWorker', space: 'W4' });
  assert.ok(offered(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'hire' }));
  assert.ok(!offered(state, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' }));
  assert.match(E.getBlockReason(state, { type: 'chooseDistrict', district: 'D5', hats: 0 }), /say "lay" or "hire"/);
  assert.match(E.getBlockReason(state, { type: 'chooseDistrict', district: 'D2', hats: 0, mode: 'lay' }), /Only Lay Track or Hire Specialists asks for a mode/);
});

// ---------------------------------------------------------------------------
// P5 - the action grid
// ---------------------------------------------------------------------------

suite.check('P5.1: the nine districts and what they do', () => {
  const state = start(2);
  const names = E.DISTRICT_IDS.map((d) => E.districtName(state, d));
  assert.deepEqual(names, ['Collect Gunpowder', 'Financier', 'Collect Iron', 'Crew', 'Lay Track or Hire Specialists', 'Engineer', 'Collect Wood', 'Miner', 'Collect Coins']);
  assert.deepEqual(Object.keys(state.grid.sites), ['D1', 'D3', 'D7', 'D9'], 'P6.6: building sites on the four Collect districts');
  for (const d of Object.keys(state.grid.sites)) assert.equal(state.grid.sites[d].length, 3);
});

suite.check('P5.3, P5.4.2: placing or removing at a worker space gives the choice of its two districts', () => {
  const state = start(2);
  act(state, { type: 'placeWorker', space: 'W1' }); // Collect Gunpowder / Financier
  const districts = new Set(E.getValidActions(state).map((a) => a.district));
  assert.deepEqual([...districts].sort(), ['D1', 'D2']);
  assert.match(E.getBlockReason(state, { type: 'chooseDistrict', district: 'D3', hats: 0 }), /gives Collect Gunpowder or Financier, not Collect Iron/);
  // Removal from a space: also both districts.
  const s2 = start(2);
  put(s2, 0, 'W2');
  act(s2, { type: 'removeWorker', from: 'W2' });
  assert.deepEqual([...new Set(E.getValidActions(s2).map((a) => a.district))].sort(), ['D2', 'D3']);
  assert.equal(s2.players[0].workersInSupply, 6);
});

suite.check('P5.4.1, P5.4.3: a worker on a centre must be the one removed, and gives only its district', () => {
  const state = start(2);
  put(state, 0, 'W1');
  put(state, 0, 'D7');
  assert.match(E.getBlockReason(state, { type: 'removeWorker', from: 'W1' }), /centre of Collect Wood; when you remove a worker it must be that one/);
  const events = act(state, { type: 'removeWorker', from: 'D7' });
  // Only Collect Wood, with no hat: the engine chose it.
  assert.equal(eventOf(events, 'districtChosen').district, 'D7');
  assert.equal(eventOf(events, 'districtChosen').multiplier, 1, 'the removed worker gives no bonus; W1 is not adjacent to Collect Wood');
});

suite.check('P5.4.4: forced off the centre of Lay Track or Hire Specialists with neither possible, the player takes no action', () => {
  const state = start(2);
  put(state, 0, 'D5');
  for (const w of ['W1', 'W2', 'W3', 'W5', 'W8', 'W10', 'W11', 'W12', 'W4', 'W6', 'W7', 'W9']) {
    if (state.grid.spaces[w] === null && state.players[0].workersInSupply > 0) put(state, 0, w);
  }
  // Every worker is out (6), one of them on the centre of D5: remove it, for no action.
  assert.deepEqual(types(state), ['removeWorker']);
  const events = act(state, { type: 'removeWorker', from: 'D5' });
  const forced = events.filter((e) => e.type === 'action' && e.auto).map((e) => e.action);
  assert.deepEqual(forced[0], { type: 'chooseDistrict', district: 'none', hats: 0 });
  assert.equal(state.turn.player, 1, 'the turn passed with no action');
});

suite.check('P5.5: displacing returns the workers on the spaces AND on the centre; P5.5.3: hats, or a resource of choice (Coin allowed) at the limit, in turn order', () => {
  // E6 (P22): Collect Wood (D7) spaces W8, W11 held by Ivy and Jo; Kim on its centre. Lou displaces.
  const state = start(4); // Anna = Lou (0), Ben = Ivy (1), Cara = Jo (2), Dev = Kim (3)
  put(state, 1, 'W8');
  put(state, 2, 'W11');
  put(state, 3, 'D7');
  state.players[1].hats = 0;
  state.players[2].hats = 2;
  state.players[3].hats = 1;
  setStorage(state, 2, { coins: 1 });
  const events = act(state, { type: 'displaceWorker', district: 'D7' });
  const returned = events.filter((e) => e.type === 'workerReturned');
  assert.deepEqual(returned.map((e) => e.player).sort(), [1, 2, 3], 'the centre worker returns too');
  assert.equal(state.grid.centres.D7, 0);
  assert.equal(state.grid.spaces.W8, null);
  assert.equal(state.players[1].hats, 1, 'Ivy gains a hat');
  assert.equal(state.players[3].hats, 2, 'Kim gains a hat (now 2)');
  // Jo, at the limit, is asked for a resource of her choice: Coin is allowed.
  assert.equal(state.toAct, 2);
  assert.equal(E.topFrame(state).kind, 'chooseResource');
  assert.deepEqual(E.getValidActions(state).map((a) => a.resource).sort(), ['coins', 'gunpowder', 'iron', 'wood']);
  const after = act(state, { type: 'chooseResource', resource: 'coins' });
  assert.equal(state.players[2].coins, 2);
  // Then Lou takes Collect Wood with M = 1 (P5.5.4: no other worker adjacent, no hat): the only choice, so the engine made it.
  assert.equal(eventOf(after, 'districtChosen').district, 'D7');
  assert.equal(eventOf(after, 'districtChosen').multiplier, 1);
  // With a hat Lou would have had the choice of M = 2 (P5.5.4).
  const again = start(4);
  put(again, 1, 'W8');
  put(again, 2, 'W11');
  again.players[0].hats = 1;
  act(again, { type: 'displaceWorker', district: 'D7' });
  assert.deepEqual(E.getValidActions(again).map((a) => a.hats).sort(), [0, 1]);
});

suite.check('P5.5.3: compensation is asked in turn order from the active player\'s left', () => {
  const state = start(4);
  put(state, 3, 'W1');
  put(state, 1, 'W3');
  state.players[1].hats = 2;
  state.players[3].hats = 2;
  state.players[0].hats = 1; // so that Anna's district choice is a real decision afterwards
  // D1's spaces: W1 (Dev), W3 (Ben). Anna displaces: Ben (left of Anna) is asked before Dev.
  act(state, { type: 'displaceWorker', district: 'D1' });
  assert.equal(state.toAct, 1);
  act(state, { type: 'chooseResource', resource: 'wood' });
  assert.equal(state.toAct, 3);
  act(state, { type: 'chooseResource', resource: 'iron' });
  assert.equal(state.toAct, 0);
});

suite.check('P5.5.1: displacing needs every space held by OTHER players and no worker of yours adjacent (its spaces or centre)', () => {
  const state = start(3);
  put(state, 1, 'W1');
  assert.match(E.getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /not blocked: 1 of its 2 worker spaces is empty \(W3\)/);
  put(state, 0, 'W3');
  assert.match(E.getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /You have a worker on W3/);
  // A worker on a NEIGHBOURING centre is not adjacent in this ruleset (P5.6): it does not block.
  const s2 = start(3);
  put(s2, 1, 'W1');
  put(s2, 2, 'W3');
  put(s2, 0, 'D2');
  // (D2's centre worker must be removed first, so displace is checked structurally.)
  assert.equal(E.getStructuralBlockReason(s2, { type: 'displaceWorker', district: 'D1' }), null);
  const s3 = start(3);
  put(s3, 1, 'W1');
  put(s3, 2, 'W3');
  assert.equal(E.getBlockReason(s3, { type: 'displaceWorker', district: 'D1' }), null, 'two other players on both spaces: legal');
});

suite.check('P5.6, P5.7: M counts your other workers on the district\'s spaces and its own centre only; hats add 1 each (P11.2)', () => {
  const state = start(2);
  put(state, 0, 'W3'); // D1 / D4
  put(state, 0, 'D4'); // centre of Crew: adjacent to Crew only
  put(state, 1, 'W8');
  state.players[0].hats = 2;
  // The centre worker must be removed first if Anna removes, so she places on W1 (D1 / D2).
  act(state, { type: 'placeWorker', space: 'W1' });
  const preview = E.previewMultipliers(state);
  const m = (district, hats) => preview.find((p) => p.district === district && p.hats === hats).multiplier;
  assert.equal(m('D1', 0), 2, 'W3 is adjacent to Collect Gunpowder; the placed worker is not counted');
  assert.equal(m('D2', 0), 1, 'the centre of Crew is not adjacent to Financier');
  assert.equal(m('D1', 2), 4, 'two hats');
  act(state, { type: 'chooseDistrict', district: 'D1', hats: 2 });
  assert.equal(state.turn.multiplier, 4);
  assert.equal(state.players[0].hats, 0, 'P11.2: spent hats return to the supply');
});

suite.check('P11.1: hats are held to 2; a third from displacement becomes a resource of choice', () => {
  const state = start(3);
  put(state, 1, 'W1');
  put(state, 1, 'W3');
  state.players[1].hats = 1;
  act(state, { type: 'displaceWorker', district: 'D1' });
  // Ben had 1 hat and two workers returned: one hat (now 2), then one resource.
  assert.equal(state.players[1].hats, 2);
  assert.equal(E.topFrame(state).kind, 'chooseResource');
  assert.equal(E.topFrame(state).remaining, 1);
});

suite.check('P4.5: a player may remove while able to place, and place while able to remove', () => {
  const state = start(2);
  put(state, 0, 'W12');
  const t = types(state);
  assert.ok(t.includes('placeWorker') && t.includes('removeWorker'));
});

suite.check('a removal gives the district\'s action with no adjacency from the removed worker (P5.7.1)', () => {
  const state = start(2);
  put(state, 0, 'W1');
  put(state, 0, 'W3');
  act(state, { type: 'removeWorker', from: 'W1' });
  const preview = E.previewMultipliers(state);
  assert.equal(preview.find((p) => p.district === 'D1' && p.hats === 0).multiplier, 2, 'W3 counts, the removed worker does not');
  assert.equal(eventOf(placeAndChoose(start(2), 'W1', 'D1'), 'districtChosen').multiplier, 1);
});

suite.finish();
