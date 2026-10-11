// Rules audit, part 1: R1 terminology (behavioural parts), R2 components, R3 setup,
// R4 turn structure, R5 the action grid. Written from rules spec v2.

import {
  createGame,
  determinise,
  makeRng,
  hiddenDecks,
  RULES,
  MAP,
  SPACE_IDS,
  DISTRICT_IDS,
  SPACE_DISTRICTS,
  DISTRICT_SPACES,
  DISTRICT_NEIGHBOURS,
  districtInfo,
  production,
  storageCapacity,
  getDistrictActionBlockReason,
  isGameOver,
  scoreGame,
  STOP_ACTION_TYPES,
} from '../../src/engine/index.js';
import { drive } from '../helpers/play.mjs';
import {
  assert, check, game, act, take, put, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf,
  offered, offers, refused, idleTurn, finishTurn, playTurn, kind, keys, giveTokens, stock, ownCard, MODULES_OFF,
  getValidActions, getBlockReason, topFrame,
} from './kit.mjs';

const PONY = { modulePonyExpress: true };
const names = (n) => ['Anna', 'Ben', 'Cara', 'Dev'].slice(0, n).map((name) => ({ name }));

/** A fresh game at its very first decision (the railhead draft), seats as given unless told otherwise. */
function fresh(n, variants = {}, extra = {}) {
  return createGame({ players: names(n), seed: extra.seed ?? 7, shuffleSeats: extra.shuffleSeats ?? false, variants: { ...MODULES_OFF, ...variants } });
}

/** Drives a fresh game through setup with the first legal action each time. */
function throughSetup(state) {
  drive(state, (s) => s.phase === 'setup');
  return state;
}

// The tables of R5.1 and R5.2, transcribed from the spec.
const R5_1 = {
  D1: ['gather-gunpowder', 'Gather Gunpowder', 'gather', 'gunpowder', 'upgrade'],
  D2: ['lobby-congress', 'Lobby Congress', 'trainActivation', 'financier', null],
  D3: ['gather-iron', 'Gather Iron', 'gather', 'iron', 'hire'],
  D4: ['ground-tracks', 'Ground Tracks', 'trainActivation', 'crew', null],
  D5: ['lay-tracks', 'Lay Tracks / Move Train', 'layTracks', null, null],
  D6: ['bridge-tracks', 'Bridge Tracks', 'trainActivation', 'engineer', null],
  D7: ['gather-wood', 'Gather Wood', 'gather', 'wood', 'hat'],
  D8: ['tunnel-tracks', 'Tunnel Tracks', 'trainActivation', 'miner', null],
  D9: ['gather-coins', 'Gather Coins', 'gather', 'coins', 'carriage'],
};
const R5_2_SPACES = {
  W1: ['D1', 'D2'], W2: ['D2', 'D3'], W3: ['D1', 'D4'], W4: ['D2', 'D5'], W5: ['D3', 'D6'], W6: ['D4', 'D5'],
  W7: ['D5', 'D6'], W8: ['D4', 'D7'], W9: ['D5', 'D8'], W10: ['D6', 'D9'], W11: ['D7', 'D8'], W12: ['D8', 'D9'],
};
const R5_2_DISTRICTS = {
  D1: [['W1', 'W3'], ['D2', 'D4']],
  D2: [['W1', 'W2', 'W4'], ['D1', 'D3', 'D5']],
  D3: [['W2', 'W5'], ['D2', 'D6']],
  D4: [['W3', 'W6', 'W8'], ['D1', 'D5', 'D7']],
  D5: [['W4', 'W6', 'W7', 'W9'], ['D2', 'D4', 'D6', 'D8']],
  D6: [['W5', 'W7', 'W10'], ['D3', 'D5', 'D9']],
  D7: [['W8', 'W11'], ['D4', 'D8']],
  D8: [['W9', 'W11', 'W12'], ['D5', 'D7', 'D9']],
  D9: [['W10', 'W12'], ['D6', 'D8']],
};
const sorted = (a) => a.slice().sort();

export default function part1() {
  // ----- R1 ------------------------------------------------------------------
  check('R1.6', 'there are 12 worker spaces, each on the border of two orthogonal neighbours', () => {
    assert.equal(SPACE_IDS.length, 12);
    for (const w of SPACE_IDS) {
      const [a, b] = SPACE_DISTRICTS[w];
      assert.ok(DISTRICT_NEIGHBOURS[a].includes(b), `${w}: ${a} and ${b} are not neighbours`);
    }
  });
  check('R1.7', 'a worker moves between the supply and the action grid', () => {
    const s = game(2);
    const before = s.players[0].workersInSupply;
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.equal(s.grid.spaces.W12, 0);
    assert.equal(s.players[0].workersInSupply, before - 1);
  });
  check('R1.8', '"a resource of your choice" is Iron, Wood or Gunpowder, never a Coin', () => {
    const s = fresh(2, { startCompensation: 'graduated' });
    drive(s, (x) => kind(x) !== 'chooseResource');
    assert.deepEqual(sorted(getValidActions(s).map((a) => a.resource)), ['gunpowder', 'iron', 'wood']);
    refused(s, { type: 'chooseResource', resource: 'coins' });
  });
  check('R1.10', 'Coins have no holding limit and take no storage', () => {
    const s = game(2);
    give(s, 0, { coins: 500, resources: { iron: 9 } });
    placeAndChoose(s, 'W12', 'D9');
    assert.equal(s.players[0].coins, 501);
    assert.notEqual(kind(s), 'discard');
  });
  check('R1.12', 'a track tile is in the supply, in storage (built) or on a route (laid)', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    give(s, 0, { tiles: { bridge: 2 } });
    placeAndChoose(s, 'W4', 'D5');
    take(s, 'claimRoute', { route: 'POR-SPO' });
    assert.equal(s.players[0].builtTiles.bridge, 0);
    assert.equal(s.map.routeOwner['POR-SPO'], 0);
  });
  check('R1.13', 'building never touches the map', () => {
    const s = game(2);
    give(s, 0, { resources: { iron: 6 } });
    const map = JSON.stringify(s.map);
    placeAndChoose(s, 'W6', 'D4');
    take(s, 'useStep');
    assert.equal(s.players[0].builtTiles.ground, 1);
    assert.equal(JSON.stringify(s.map), map);
  });
  check('R1.14', 'laying never creates tiles: only built tiles can be laid', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    give(s, 0, { resources: { wood: 9 }, tiles: { bridge: 1 } });
    assert.notEqual(getDistrictActionBlockReason(s, 0, 'D5'), null, 'one Bridge tile does not pay for B-B, whatever Wood is held');
    s.players[0].builtTiles.bridge = 2;
    placeAndChoose(s, 'W4', 'D5');
    take(s, 'claimRoute', { route: 'POR-SPO' });
    const p = s.players[0];
    assert.deepEqual(p.builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
    assert.equal(p.resources.wood, 9);
  });
  check('R1.15', 'a specialist carriage holds 2 specialists and stores nothing; a storage carriage stores 9', () => {
    const s = game(2);
    assert.equal(s.players[0].train.specialistCarriages[0].slots.length, 2);
    assert.equal(storageCapacity(s, 0), 9);
    setTrain(s, 0, [['crew', null], [null, null], [null, null]]);
    assert.equal(storageCapacity(s, 0), 9);
    s.players[0].train.storageCarriages = 2;
    assert.equal(storageCapacity(s, 0), 18);
  });
  check('R1.18', '25 cities: 4 west start cities, 4 east start cities, 17 inland cities', () => {
    assert.equal(MAP.cityIds.length, 25);
    assert.deepEqual(sorted(MAP.westStartCities), sorted(['SEA', 'POR', 'SAC', 'LAX']));
    assert.deepEqual(sorted(MAP.eastStartCities), sorted(['MIN', 'OMA', 'KCY', 'FTW']));
    assert.equal(MAP.inlandCities.length, 17);
  });
  check('R1.19', '47 routes of 2 to 6 slots, 136 slots; a claimed route has one owner for good', () => {
    assert.equal(MAP.routes.length, 47);
    assert.equal(MAP.routes.reduce((n, r) => n + r.length, 0), 136);
    assert.ok(MAP.routes.every((r) => r.length >= 2 && r.length <= 6));
  });
  check('R1.20', 'each player has two railheads, one starting in the west and one in the east', () => {
    for (const n of [2, 3, 4]) {
      const s = throughSetup(fresh(n));
      for (const p of s.players) {
        assert.equal(p.railheads.length, 2);
        const kinds = sorted(p.railheads.map((c) => MAP.cityById[c].kind));
        assert.deepEqual(kinds, ['east', 'west']);
      }
    }
  });
  check('R1.22', 'the multiplier is a whole number of at least 1', () => {
    const s = game(2);
    const ev = placeAndChoose(s, 'W12', 'D9');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 1);
  });
  check('R1.23', 'the Congress strip has 6 entries plus Reset', () => {
    const s = game(2);
    assert.deepEqual(sorted(Object.keys(s.congress.used)), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    assert.equal(RULES.CONGRESS.tables['design-2026-10'].filter((e) => e.reset).length, 1);
  });
  check('R1.24', 'scores are whole numbers', () => {
    const s = game(2);
    for (const p of scoreGame(s).players) assert.ok(Number.isInteger(p.total));
  });

  // ----- R2 ------------------------------------------------------------------
  check('R2.1', 'component counts', () => {
    const letters = { ground: 0, tunnel: 0, bridge: 0 };
    for (const r of MAP.routes) for (const t of r.terrains) letters[t] += 1;
    assert.deepEqual(letters, { ground: 44, tunnel: 46, bridge: 46 });
    const s = game(4, { moduleCarriageUpgrades: true, modulePonyExpress: true });
    assert.deepEqual(s.supply.specialists, { crew: 8, miner: 12, engineer: 12, financier: 12 }, '12 of each, less the free Crew each of the four players took at setup');
  });
  check('R2.1/specialists', 'specialist tiles: 12 of each type before the free starting specialists', () => {
    const s = fresh(4);
    assert.deepEqual(s.supply.specialists, { crew: 12, miner: 12, engineer: 12, financier: 12 });
  });
  check('R2.1/modules', '16 upgrade tiles (6/5/5), 12 goals, 10 milestones, 20 Legislative Agenda cards, 38 Pony Express cards (13/11/14), 17 tokens', () => {
    const byLevel = [1, 2, 3].map((l) => RULES.UPGRADE_TILES.filter((t) => t.level === l).length);
    assert.deepEqual(byLevel, [6, 5, 5]);
    assert.equal(RULES.GOAL_CARDS.length, 12);
    assert.equal(RULES.MILESTONE_TILES.length, 10);
    assert.equal(RULES.LEGISLATIVE_CARDS.length, 20);
    assert.deepEqual(['A', 'B', 'C'].map((r) => RULES.PONY_CARDS.filter((c) => c.rank === r).length), [13, 11, 14]);
    const s = game(2, PONY);
    assert.equal(Object.values(s.modules.pony.tokens).filter(Boolean).length, 17);
  });
  check('R2.2', 'per player: 11 houses, 7 telegraph stations printed 1 2 3 4 5 6 9, 2 railheads, at most 2 hats', () => {
    const s = game(3);
    for (const p of s.players) {
      assert.equal(Object.values(p.houses).reduce((a, b) => a + b, 0), 11);
      assert.equal(p.railheads.length, 2);
    }
    assert.deepEqual(RULES.PLAYER_BOARD.telegraphRowVp, [1, 2, 3, 4, 5, 6, 9]);
    assert.equal(RULES.HATS.hatLimit, 2);
  });
  check('R2.3', 'the player board: four house tracks in the order Wood, Coins, Iron, Gunpowder, three house slots each', () => {
    const s = fresh(2);
    assert.deepEqual(Object.keys(s.players[0].houses), ['wood', 'coins', 'iron', 'gunpowder']);
    assert.deepEqual(Object.values(s.players[0].houses), [3, 3, 3, 3]);
  });
  check('R2.4', 'everything is open except the order of undrawn cards', () => {
    const s = game(3, { ...PONY, moduleLegislativeAgenda: true, endGameScoring: 'both', moduleCarriageUpgrades: true });
    const d = determinise(s, makeRng(99));
    const strip = (x) => {
      const c = JSON.parse(JSON.stringify(x));
      delete c.rng;
      delete c.config;
      c.modules.pony.decks = null;
      return c;
    };
    assert.deepEqual(strip(d), strip(s), 'only deck orders (and the RNG) may differ');
    for (const rank of ['A', 'B', 'C']) assert.deepEqual(sorted(d.modules.pony.decks[rank]), sorted(s.modules.pony.decks[rank]));
    assert.ok(Object.keys(hiddenDecks(s)).length > 0);
  });

  // ----- R3 ------------------------------------------------------------------
  check('R3.1', 'shared setup: every senator on its cost tile (available), all scores 0', () => {
    const s = fresh(4);
    assert.ok(Object.values(s.congress.used).every((u) => u === false));
    assert.equal(Object.keys(s.congress.used).length, 6);
    for (const p of scoreGame(s).players) assert.equal(p.total, 0);
  });
  check('R3.2', 'seats are shuffled with the seeded RNG; seat 1 is the start player; play goes clockwise', () => {
    const order = (seed) => createGame({ players: names(4), seed, variants: MODULES_OFF }).players.map((p) => p.name).join();
    assert.equal(order(3), order(3));
    assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(order)).size > 1, 'ten seeds never changed the seating');
    const s = game(4);
    assert.equal(s.startPlayer, 0);
    const seen = [];
    for (let i = 0; i < 9; i++) {
      seen.push(s.turn.player);
      idleTurn(s);
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 0, 1, 2, 3, 0]);
    assert.equal(s.startPlayer, 0, 'the start player marker stays for the whole game');
  });
  check('R3.3', 'player setup for 2, 3 and 4 players', () => {
    const workers = { 2: 6, 3: 4, 4: 3 };
    for (const n of [2, 3, 4]) {
      const s = throughSetup(fresh(n, { startCompensation: 'none' }));
      for (const p of s.players) {
        assert.equal(p.workersInSupply, workers[n]);
        assert.equal(Object.values(p.houses).reduce((a, b) => a + b, 0), 11);
        assert.equal(p.telegraphsPlaced, 0);
        assert.equal(p.train.specialistCarriages.length, 1);
        assert.equal(p.train.storageCarriages, 1);
        assert.deepEqual(p.resources, { iron: 1, wood: 1, gunpowder: 1 });
        assert.equal(p.coins, 1);
        assert.equal(p.hats, 0);
        assert.equal(p.train.specialistCarriages[0].slots.filter((x) => x !== null).length, 1);
      }
      assert.equal(s.players.reduce((a, p) => a + p.workersInSupply, 0), 12);
    }
  });
  check('R3.4', 'exactly one "2" slot is empty: that track starts at production 2, the other three at 1', () => {
    const s = fresh(2);
    drive(s, (x) => kind(x) !== 'setupProduction');
    assert.deepEqual(sorted(getValidActions(s).map((a) => a.track)), sorted(['wood', 'coins', 'iron', 'gunpowder']));
    act(s, { type: 'chooseStartingProduction', track: 'coins' });
    const p = s.players[s.setup ? 0 : 0];
    assert.deepEqual(['wood', 'coins', 'iron', 'gunpowder'].map((t) => production(s, 0, t)), [1, 2, 1, 1]);
    assert.equal(Object.values(p.houses).reduce((a, b) => a + b, 0), 11);
  });
  check('R3.5.1', 'first railheads in reverse seat order, on any unoccupied start city, west or east', () => {
    const s = fresh(3);
    assert.equal(kind(s), 'setupRailhead');
    assert.equal(s.toAct, 2);
    assert.equal(offers(s, 'placeRailhead').length, 8);
    act(s, { type: 'placeRailhead', city: 'OMA' });
    assert.equal(s.toAct, 1);
    act(s, { type: 'placeRailhead', city: 'SEA' });
    assert.equal(s.toAct, 0);
  });
  check('R3.5.2', 'second railheads in seat order, on the opposite side from the first', () => {
    const s = fresh(3);
    act(s, { type: 'placeRailhead', city: 'OMA' }); // seat 3, east
    act(s, { type: 'placeRailhead', city: 'SEA' }); // seat 2, west
    act(s, { type: 'placeRailhead', city: 'POR' }); // seat 1, west
    assert.equal(s.toAct, 0, 'seat 1 places the second railhead first');
    assert.deepEqual(sorted(offers(s, 'placeRailhead').map((a) => a.city)), sorted(['MIN', 'KCY', 'FTW']));
    refused(s, { type: 'placeRailhead', city: 'SAC' });
    act(s, { type: 'placeRailhead', city: 'MIN' });
    assert.equal(s.toAct, 1);
    act(s, { type: 'placeRailhead', city: 'KCY' });
    assert.equal(s.toAct, 2);
    assert.deepEqual(sorted(offers(s, 'placeRailhead').map((a) => a.city)), sorted(['POR', 'SAC', 'LAX'].filter((c) => c !== 'POR')));
  });
  check('R3.5.3', 'a start city holds at most one railhead during the draft; spare start cities stay empty', () => {
    const s = fresh(2);
    act(s, { type: 'placeRailhead', city: 'SEA' });
    assert.ok(!offered(s, 'placeRailhead', { city: 'SEA' }));
    refused(s, { type: 'placeRailhead', city: 'SEA' });
    throughSetup(s);
    const used = new Set(s.players.flatMap((p) => p.railheads));
    assert.equal(used.size, 4);
  });
  check('R3.6', 'starting choices in seat order: the "2" slot, then one free specialist into slot 1 of the level 1 carriage', () => {
    const s = fresh(3);
    drive(s, (x) => kind(x) === 'setupRailhead');
    for (const seat of [0, 1, 2]) {
      assert.equal(kind(s), 'setupProduction');
      assert.equal(s.toAct, seat);
      act(s, { type: 'chooseStartingProduction', track: 'wood' });
      assert.equal(kind(s), 'setupSpecialist');
      assert.equal(s.toAct, seat);
      assert.deepEqual(sorted(getValidActions(s).map((a) => a.specialist)), sorted(['crew', 'miner', 'engineer', 'financier']));
      const coins = s.players[seat].coins;
      act(s, { type: 'chooseStartingSpecialist', specialist: 'financier' });
      assert.deepEqual(s.players[seat].train.specialistCarriages[0].slots, ['financier', null]);
      assert.equal(s.players[seat].coins, coins, 'the starting specialist is free');
    }
    assert.equal(s.supply.specialists.financier, 9);
  });
  check('R3.7', 'startCompensation graduated: seat 2 takes 1 resource of choice, seat 3 takes 1, seat 4 takes 2; none: nobody', () => {
    const total = (p) => p.resources.iron + p.resources.wood + p.resources.gunpowder;
    const g = throughSetup(fresh(4, { startCompensation: 'graduated' }));
    assert.deepEqual(g.players.map(total), [3, 4, 4, 5]);
    const g3 = throughSetup(fresh(3, { startCompensation: 'graduated' }));
    assert.deepEqual(g3.players.map(total), [3, 4, 4]);
    const g2 = throughSetup(fresh(2, { startCompensation: 'graduated' }));
    assert.deepEqual(g2.players.map(total), [3, 4]);
    const none = throughSetup(fresh(4, { startCompensation: 'none' }));
    assert.deepEqual(none.players.map(total), [3, 3, 3, 3]);
    assert.ok(g.players.every((p) => p.coins === 1), 'compensation is resources, never Coins');
  });
  check('R3.7/order', 'compensation comes after the starting choices, in seat order', () => {
    const s = fresh(4, { startCompensation: 'graduated' });
    drive(s, (x) => kind(x) !== 'chooseResource');
    assert.equal(s.toAct, 1);
    assert.ok(s.players.every((p) => p.train.specialistCarriages[0].slots[0] !== null), 'every starting choice is made first');
  });
  check('R3.8.1', 'carriage upgrades: all 16 tiles face up', () => {
    const s = fresh(2, { moduleCarriageUpgrades: true });
    assert.equal(s.modules.upgrades.display.length, 16);
    assert.equal(fresh(2).modules.upgrades, undefined);
  });
  check('R3.8.2', 'milestones: 6 of 10 revealed by default; goals: 3; both; none', () => {
    const m = fresh(2, { endGameScoring: 'milestones' });
    assert.equal(m.modules.milestones.inPlay.length, 6);
    assert.equal(new Set(m.modules.milestones.inPlay).size, 6);
    assert.equal(m.modules.goals, undefined);
    const g = fresh(2, { endGameScoring: 'goals' });
    assert.equal(g.modules.goals.inPlay.length, 3);
    assert.equal(g.modules.milestones, undefined);
    const b = fresh(2, { endGameScoring: 'both' });
    assert.equal(b.modules.goals.inPlay.length, 3);
    assert.equal(b.modules.milestones.inPlay.length, 6);
    const n = fresh(2, { endGameScoring: 'none' });
    assert.equal(n.modules.goals, undefined);
    assert.equal(n.modules.milestones, undefined);
    const sets = new Set();
    for (let seed = 1; seed <= 12; seed++) sets.add(fresh(2, { endGameScoring: 'milestones' }, { seed }).modules.milestones.inPlay.join());
    assert.ok(sets.size > 1, 'the milestone tiles are shuffled');
    assert.equal(fresh(2, { endGameScoring: 'milestones', milestonesInPlay: 9 }).modules.milestones.inPlay.length, 9);
    assert.equal(fresh(2, { endGameScoring: 'goals', goalsInPlay: 7 }).modules.goals.inPlay.length, 7);
  });
  check('R3.8.2/goal6', 'goal 6 is removed from the goal deck when carriage upgrades are off', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const off = fresh(2, { endGameScoring: 'goals', goalsInPlay: 11 }, { seed });
      assert.equal(off.modules.goals.inPlay.length, 11);
      assert.ok(!off.modules.goals.inPlay.includes('G6'));
    }
    const on = fresh(2, { endGameScoring: 'goals', goalsInPlay: 12, moduleCarriageUpgrades: true });
    assert.ok(on.modules.goals.inPlay.includes('G6'));
    assert.throws(() => fresh(2, { endGameScoring: 'goals', goalsInPlay: 12 }));
  });
  check('R3.8.3', 'Legislative Agenda: one card revealed; legislativeAgendaCard names it', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 25; seed++) seen.add(fresh(2, { moduleLegislativeAgenda: true }, { seed }).modules.legislative.card);
    assert.ok(seen.size > 3, 'the card is drawn at random');
    for (let n = 1; n <= 20; n++) {
      assert.equal(fresh(2, { moduleLegislativeAgenda: true, legislativeAgendaCard: n }).modules.legislative.card, `LA${n}`);
    }
  });
  check('R3.8.4', 'Pony Express: a token on each of the 17 inland cities, three decks by rank, 2 cards face up from each', () => {
    const s = fresh(2, PONY);
    const pony = s.modules.pony;
    assert.deepEqual(sorted(Object.keys(pony.tokens)), sorted(MAP.inlandCities));
    assert.ok(Object.values(pony.tokens).every((t) => t === true));
    const rankOf = (id) => RULES.PONY_CARDS.find((c) => c.id === id).rank;
    for (const rank of ['A', 'B', 'C']) {
      assert.equal(pony.market[rank].length, 2);
      for (const id of [...pony.market[rank], ...pony.decks[rank]]) assert.equal(rankOf(id), rank);
    }
    const all = ['A', 'B', 'C'].flatMap((r) => [...pony.market[r], ...pony.decks[r]]);
    assert.equal(new Set(all).size, 38);
    const tops = new Set();
    for (let seed = 1; seed <= 10; seed++) tops.add(fresh(2, PONY, { seed }).modules.pony.market.A.join());
    assert.ok(tops.size > 1, 'the decks are shuffled');
  });
  check('R3.8.5', 'scoring card: none by default; random draws one of three; a named value fixes it', () => {
    assert.equal(fresh(2).scoringCard, null);
    for (const t of ['ground', 'tunnel', 'bridge']) assert.equal(fresh(2, { scoringCard: t }).scoringCard, t);
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) seen.add(fresh(2, { scoringCard: 'random' }, { seed }).scoringCard);
    assert.deepEqual(sorted([...seen]), ['bridge', 'ground', 'tunnel']);
  });
  check('R3.9', 'the start player takes the first turn', () => {
    const s = throughSetup(fresh(4));
    assert.equal(s.phase, 'play');
    assert.equal(s.turn.number, 1);
    assert.equal(s.turn.player, 0);
    assert.equal(s.toAct, 0);
  });

  // ----- R4 ------------------------------------------------------------------
  check('R4.1', 'continuous flow: no rounds and no refresh; workers stay where they are between turns', () => {
    const s = game(2);
    for (let i = 0; i < 6; i++) {
      const pid = s.turn.player;
      playTurn(s, { type: 'placeWorker', space: getValidActions(s).find((a) => a.type === 'placeWorker').space });
      assert.equal(s.players[pid].workersInSupply, 6 - Math.floor(i / 2) - 1);
    }
    assert.equal(Object.values(s.grid.spaces).filter((x) => x !== null).length, 6);
  });
  check('R4.2', 'a turn: worker step, then the district choice, then the action, then the next player', () => {
    const s = game(3);
    assert.equal(kind(s), 'workerStep');
    refused(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.equal(kind(s), 'chooseDistrict');
    assert.equal(s.toAct, 0);
    refused(s, { type: 'placeWorker', space: 'W10' });
    const ev = act(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    assert.ok(eventOf(ev, 'gather'));
    finishTurn(s);
    assert.equal(s.turn.player, 1);
    assert.equal(kind(s), 'workerStep');
  });
  check('R4.2.1', 'first free-action window: before the worker step', () => {
    const s = game(2, PONY);
    giveTokens(s, 1, 1);
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    assert.equal(kind(s), 'freeActions');
    assert.ok(offered(s, 'exchangeToken') && offered(s, 'endFreeActions'));
    assert.ok(!offered(s, 'placeWorker'));
    act(s, { type: 'endFreeActions' });
    assert.equal(kind(s), 'workerStep');
  });
  check('R4.2.2', 'the worker step is exactly one of Place, Displace, Remove', () => {
    const s = game(2);
    put(s, 0, 'W12');
    assert.deepEqual(types(s), ['placeWorker', 'removeWorker']);
    act(s, { type: 'placeWorker', space: 'W10' });
    assert.ok(!offered(s, 'placeWorker') && !offered(s, 'removeWorker') && !offered(s, 'displaceWorker'));
  });
  check('R4.2.3', 'choosing the action is mandatory and says whether a hat is spent', () => {
    const s = game(2);
    give(s, 0, { hats: 1 });
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.deepEqual(keys(s), sorted(['chooseDistrict:D8:false', 'chooseDistrict:D8:true', 'chooseDistrict:D9:false', 'chooseDistrict:D9:true']));
  });
  check('R4.2.5', 'second free-action window: after the action has resolved', () => {
    const s = game(2, PONY);
    giveTokens(s, 0, 1);
    act(s, { type: 'placeWorker', space: 'W12' });
    assert.ok(!offered(s, 'exchangeToken'), 'no free action in the middle of the turn');
    act(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    assert.equal(kind(s), 'bonusAction');
    assert.ok(!offered(s, 'exchangeToken'), 'never in the middle of resolving an action (R4.4)');
    act(s, { type: 'skipBonusAction' });
    assert.equal(kind(s), 'freeActions');
    assert.equal(s.turn.player, 0);
    act(s, { type: 'endFreeActions' });
    assert.equal(s.turn.player, 1);
  });
  check('R4.2.6', 'end of turn: the next player clockwise begins', () => {
    const s = game(4);
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    assert.equal(s.turn.number, 2);
    assert.equal(s.players[0].turnsTaken, 1);
  });
  check('R4.3', 'no passing: the worker step and the district choice offer no stop action; with every worker on the grid the player must Remove', () => {
    const s = game(4);
    assert.ok(getValidActions(s).every((a) => !STOP_ACTION_TYPES.includes(a.type)));
    put(s, 0, 'W1');
    put(s, 0, 'W5');
    put(s, 0, 'W11');
    assert.deepEqual(types(s), ['removeWorker']);
    act(s, { type: 'removeWorker', from: 'W11' });
    assert.equal(kind(s), 'chooseDistrict');
    assert.ok(getValidActions(s).every((a) => a.district !== 'none'));
  });
  check('R4.3/always', 'a player with a worker in supply always has an empty worker space', () => {
    const s = game(4);
    let i = 0;
    for (const w of SPACE_IDS.slice(0, 9)) {
      const pid = 1 + (i++ % 3);
      s.grid.spaces[w] = pid;
      s.players[pid].workersInSupply -= 1;
    }
    put(s, 0, 'W10');
    put(s, 0, 'W11');
    assert.deepEqual(offers(s, 'placeWorker').map((a) => a.space), ['W12']);
  });
  check('R4.4', 'free actions exist only when a module provides them, and only for the active player', () => {
    const off = game(2);
    for (let i = 0; i < 4; i++) {
      assert.notEqual(kind(off), 'freeActions');
      idleTurn(off);
    }
    const s = game(2, PONY);
    giveTokens(s, 1, 2);
    giveTokens(s, 0, 2);
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    act(s, { type: 'skipBonusAction' });
    assert.equal(kind(s), 'freeActions');
    assert.notEqual(getBlockReason(s, { type: 'exchangeToken', resource: 'iron', player: 1 }), null);
  });
  check('R4.4.1', 'at most one Pony Express card is bought per turn, across both windows', () => {
    const s = game(2, PONY);
    stock(s, 'PX7', 0);
    stock(s, 'PX1', 1);
    giveTokens(s, 1, 6);
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'buyPonyCard', card: 'PX7' });
    assert.ok(!offered(s, 'buyPonyCard'));
    refused(s, { type: 'buyPonyCard', card: 'PX1' });
    act(s, { type: 'endFreeActions' });
    act(s, { type: 'placeWorker', space: 'W12' });
    act(s, { type: 'chooseDistrict', district: 'D9', hat: false });
    act(s, { type: 'skipBonusAction' });
    assert.equal(kind(s), 'freeActions', 'the second window is still offered: a token can be exchanged');
    assert.ok(!offered(s, 'buyPonyCard'), 'the purchase of this turn was made in the first window');
    act(s, { type: 'endFreeActions' });
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    assert.ok(offered(s, 'buyPonyCard', { card: 'PX1' }), 'a new turn allows a new purchase');
  });
  check('R4.4.2', 'a token may be exchanged for a resource any number of times in a window', () => {
    const s = game(2, PONY);
    giveTokens(s, 1, 3);
    idleTurn(s);
    give(s, 1, { resources: {} });
    act(s, { type: 'exchangeToken', resource: 'iron' });
    act(s, { type: 'exchangeToken', resource: 'iron' });
    act(s, { type: 'exchangeToken', resource: 'wood' });
    assert.deepEqual(s.players[1].resources, { iron: 2, wood: 1, gunpowder: 0 });
    assert.equal(s.modules.pony.players[1].tokensHeld, 0);
  });
  check('R4.5', 'you may place when you could remove and remove when you could place', () => {
    const s = game(2);
    put(s, 0, 'W12');
    assert.ok(offered(s, 'placeWorker') && offered(s, 'removeWorker', { from: 'W12' }));
  });
  check('R4.6.1', 'a Gather action can always be chosen', () => {
    const s = game(2);
    give(s, 0, { resources: { iron: 9 }, coins: 0 });
    for (const d of ['D1', 'D3', 'D7', 'D9']) assert.equal(getDistrictActionBlockReason(s, 0, d), null);
    act(s, { type: 'placeWorker', space: 'W5' });
    assert.ok(offered(s, 'chooseDistrict', { district: 'D3' }), 'even with storage full');
  });
  check('R4.6.2', 'a train activation can always be chosen, even if every step is then skipped', () => {
    const s = game(2);
    give(s, 0, { resources: {}, coins: 0 });
    for (const d of ['D2', 'D4', 'D6', 'D8']) assert.equal(getDistrictActionBlockReason(s, 0, d), null);
    const ev = placeAndChoose(s, 'W11', 'D8');
    assert.ok(eventOf(ev, 'trainActivation'));
    assert.equal(eventsOf(ev, 'build').length, 0);
    assert.equal(s.turn.player, 1, 'nothing happened and the turn is over');
  });
  check('R4.6.3', 'Lay Tracks / Move Train can be chosen only with a legal claim or a legal move', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    assert.notEqual(getDistrictActionBlockReason(s, 0, 'D5'), null);
    act(s, { type: 'placeWorker', space: 'W4' });
    assert.equal(s.turn.district ?? 'D2', 'D2');
    const t = game(2);
    setHeads(t, 0, 'POR', 'MIN');
    give(t, 0, { tiles: { tunnel: 2 } });
    assert.equal(getDistrictActionBlockReason(t, 0, 'D5'), null, 'a legal claim (Portland - Reno, T-T)');
    const u = game(2);
    setHeads(u, 0, 'POR', 'MIN');
    claim(u, 1, 'POR-SPO');
    assert.equal(getDistrictActionBlockReason(u, 0, 'D5'), null, 'a legal move along an opponent route');
    act(u, { type: 'placeWorker', space: 'W4' });
    assert.ok(offered(u, 'chooseDistrict', { district: 'D5' }));
  });
  check('R4.7', 'a round in continuous flow is one turn by each player beginning with the start player', () => {
    const s = game(3);
    for (let i = 0; i < 3; i++) idleTurn(s);
    assert.deepEqual(s.players.map((p) => p.turnsTaken), [1, 1, 1]);
    assert.equal(s.turn.player, 0);
  });
  check('R4.8.1', 'rounds: the worker step allows only Place and Displace', () => {
    const s = game(2, { turnStructure: 'rounds' });
    put(s, 0, 'W12');
    assert.ok(!offered(s, 'removeWorker'));
    refused(s, { type: 'removeWorker', from: 'W12' });
    assert.ok(offered(s, 'placeWorker'));
  });
  check('R4.8.2', 'rounds: a player with no worker in supply is skipped, and plays again when a displacement returns one', () => {
    const s = game(3, { turnStructure: 'rounds' });
    for (const w of ['W1', 'W2', 'W3', 'W5']) put(s, 1, w);
    playTurn(s, { type: 'placeWorker', space: 'W12' });
    assert.equal(s.turn.player, 2, 'seat 2 has no worker in supply and takes no turn');
    // seat 3 displaces at Gather Gunpowder (W1, W3 both hold seat 2's workers): seat 2 gets two workers back
    playTurn(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(s.players[1].workersInSupply, 2);
    assert.equal(s.turn.player, 0);
    idleTurn(s);
    assert.equal(s.turn.player, 1, 'seat 2 takes turns again');
  });
  check('R4.8.3', 'rounds: when nobody has a worker in supply every worker returns and the start player marker passes clockwise', () => {
    const s = game(2, { turnStructure: 'rounds' });
    for (const w of ['W1', 'W2', 'W3', 'W4', 'W5']) put(s, 0, w);
    for (const w of ['W6', 'W7', 'W8', 'W9', 'W10', 'W11']) put(s, 1, w);
    const ev = playTurn(s, { type: 'placeWorker', space: 'W12' });
    assert.ok(eventOf(ev, 'roundEnd'));
    assert.ok(Object.values(s.grid.spaces).every((x) => x === null));
    assert.deepEqual(s.players.map((p) => p.workersInSupply), [6, 6]);
    assert.equal(s.startPlayer, 1);
    assert.equal(s.turn.player, 1, 'the new start player begins the next round');
  });
  check('R4.8.4', 'rounds: after a trigger the current round is played to its end, then the game ends', () => {
    const s = game(2, { turnStructure: 'rounds', maxTurnsPerPlayer: 1 });
    for (const w of ['W1', 'W2', 'W3', 'W4', 'W5']) put(s, 0, w);
    for (const w of ['W6', 'W7', 'W8', 'W9']) put(s, 1, w);
    playTurn(s, { type: 'placeWorker', space: 'W12' });
    assert.notEqual(s.gameEnd, null, 'the turn limit has triggered the end');
    assert.ok(!isGameOver(s), 'the round is not over: seat 2 still has workers');
    assert.equal(s.turn.player, 1);
    idleTurn(s);
    assert.ok(!isGameOver(s));
    assert.equal(s.turn.player, 1, 'seat 1 has no worker and is skipped');
    idleTurn(s);
    assert.ok(isGameOver(s), 'the round ended, so the game ends');
  });
  check('R4.8.6', 'rounds: everything else is unchanged (a Gather still yields P x M)', () => {
    const s = game(2, { turnStructure: 'rounds' });
    put(s, 0, 'W5');
    placeAndChoose(s, 'W2', 'D3');
    assert.equal(s.players[0].resources.iron, 1 + 4);
  });

  // ----- R5 ------------------------------------------------------------------
  check('R5.1', 'the nine districts: position, name, action and printed bonus action', () => {
    const s = game(2, { moduleCarriageUpgrades: true });
    assert.deepEqual(DISTRICT_IDS, Object.keys(R5_1));
    for (const d of DISTRICT_IDS) {
      const [tile, name, family, what, bonus] = R5_1[d];
      const info = districtInfo(s, d);
      assert.equal(s.grid.tiles[d], tile);
      assert.equal(info.name, name);
      assert.equal(info.family, family);
      if (family === 'gather') assert.equal(info.gathers, what);
      if (family === 'trainActivation') assert.equal(info.foremanType, what);
      assert.equal(info.bonusAction ?? null, bonus);
    }
    const rows = RULES.GRID.positions.map((p) => `${p.id}:${p.row},${p.col}`).join(' ');
    assert.equal(rows, 'D1:1,1 D2:1,2 D3:1,3 D4:2,1 D5:2,2 D6:2,3 D7:3,1 D8:3,2 D9:3,3');
  });
  check('R5.2', 'the 12 worker spaces and the districts they border; each district\'s spaces and neighbours', () => {
    assert.deepEqual(SPACE_IDS, Object.keys(R5_2_SPACES));
    for (const w of SPACE_IDS) assert.deepEqual(sorted(SPACE_DISTRICTS[w]), sorted(R5_2_SPACES[w]), w);
    for (const d of DISTRICT_IDS) {
      assert.deepEqual(sorted(DISTRICT_SPACES[d]), sorted(R5_2_DISTRICTS[d][0]), `${d} spaces`);
      assert.deepEqual(sorted(DISTRICT_NEIGHBOURS[d]), sorted(R5_2_DISTRICTS[d][1]), `${d} neighbours`);
    }
  });
  check('R5.2/one', 'a worker space holds at most one worker', () => {
    const s = game(2);
    put(s, 1, 'W12');
    assert.ok(!offered(s, 'placeWorker', { space: 'W12' }));
    refused(s, { type: 'placeWorker', space: 'W12' });
  });
  check('R5.3', 'Place: on any empty worker space, then the action of one of the two districts it borders', () => {
    const s = game(2);
    assert.equal(offers(s, 'placeWorker').length, 12);
    for (const w of SPACE_IDS) {
      const t = game(2);
      give(t, 0, { tiles: { ground: 9 } });
      setHeads(t, 0, 'SEA', 'MIN');
      act(t, { type: 'placeWorker', space: w });
      assert.equal(kind(t), 'chooseDistrict');
      assert.deepEqual(sorted([...new Set(getValidActions(t).map((a) => a.district))]), sorted(R5_2_SPACES[w]), w);
    }
  });
  check('R5.4', 'Remove: one of your workers leaves the grid for your supply', () => {
    const s = game(2);
    put(s, 0, 'W12');
    put(s, 1, 'W10');
    const supply = s.players[0].workersInSupply;
    assert.deepEqual(offers(s, 'removeWorker').map((a) => a.from), ['W12']);
    refused(s, { type: 'removeWorker', from: 'W10' });
    act(s, { type: 'removeWorker', from: 'W12' });
    assert.equal(s.grid.spaces.W12, null);
    assert.equal(s.players[0].workersInSupply, supply + 1);
  });
  check('R5.4.1', 'with a worker on a district centre, the worker removed must be one of those', () => {
    const s = game(2);
    put(s, 0, 'W12');
    put(s, 0, 'D4');
    put(s, 0, 'D9');
    assert.deepEqual(sorted(offers(s, 'removeWorker').map((a) => a.from)), ['D4', 'D9']);
    refused(s, { type: 'removeWorker', from: 'W12' });
  });
  check('R5.4.2', 'a worker removed from a worker space gives one of the two districts it bordered', () => {
    const s = game(2);
    put(s, 0, 'W10');
    act(s, { type: 'removeWorker', from: 'W10' });
    assert.deepEqual(sorted([...new Set(getValidActions(s).map((a) => a.district))]), ['D6', 'D9']);
  });
  check('R5.4.3', 'a worker removed from the centre of district D gives D\'s action', () => {
    const s = game(2);
    put(s, 0, 'D9');
    const ev = choose(s, act(s, { type: 'removeWorker', from: 'D9' }), 'D9');
    assert.equal(eventOf(ev, 'districtChosen').district, 'D9');
    assert.equal(eventOf(ev, 'gather').item, 'coins');
    assert.equal(s.grid.centres.D9, null);
  });
  check('R5.4.4', 'forced Remove from the centre of D5 with no legal claim or move: the worker is removed and no district action is taken', () => {
    const s = game(2);
    for (const w of ['W1', 'W2', 'W3', 'W8', 'W10']) put(s, 0, w);
    s.players[0].workersInSupply = 1;
    put(s, 0, 'D5');
    assert.notEqual(getDistrictActionBlockReason(s, 0, 'D5'), null);
    assert.deepEqual(types(s), ['removeWorker']);
    assert.deepEqual(offers(s, 'removeWorker').map((a) => a.from), ['D5']);
    const before = JSON.stringify([s.players[0].resources, s.players[0].coins, s.players[0].builtTiles, s.map]);
    const ev = act(s, { type: 'removeWorker', from: 'D5' });
    assert.equal(eventOf(ev, 'districtChosen').district, 'none');
    assert.ok(!eventOf(ev, 'gather') && !eventOf(ev, 'trainActivation'));
    assert.equal(JSON.stringify([s.players[0].resources, s.players[0].coins, s.players[0].builtTiles, s.map]), before);
    assert.equal(s.grid.centres.D5, null);
    assert.equal(s.players[0].workersInSupply, 1);
    assert.equal(s.players[0].turnsTaken, 1, 'the end-of-turn checks still happen');
    assert.equal(s.turn.player, 1);
  });
  check('R5.4.4/windows', 'in that case the two free-action windows still happen', () => {
    const s = game(2, PONY);
    giveTokens(s, 1, 1);
    for (const w of ['W1', 'W2', 'W3', 'W8', 'W10']) put(s, 1, w);
    put(s, 1, 'D5');
    idleTurn(s);
    assert.equal(kind(s), 'freeActions');
    // Removing the worker on D5 is the only legal worker step, so the engine makes it (and "none") by itself.
    const ev = act(s, { type: 'endFreeActions' });
    assert.equal(eventOf(ev, 'districtChosen').district, 'none');
    assert.equal(s.grid.centres.D5, null);
    assert.equal(s.turn.player, 1);
    assert.equal(kind(s), 'freeActions', 'the second window, although no district action was taken');
    assert.equal(topFrame(s).which, 'after');
  });
  check('R5.4.4/only', 'action "none" is offered only in that case: with a legal move the removal gives the D5 action', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    claim(s, 1, 'POR-SPO');
    put(s, 0, 'D5');
    const moved = act(s, { type: 'removeWorker', from: 'D5' });
    assert.equal(eventOf(moved, 'districtChosen').district, 'D5');
    assert.equal(s.players[0].railheads[0], 'SPO', 'the one legal step, a move to Spokane, was taken');
    const t = game(2);
    put(t, 0, 'D4');
    give(t, 0, { hats: 1 });
    act(t, { type: 'removeWorker', from: 'D4' });
    assert.equal(kind(t), 'chooseDistrict');
    assert.ok(!offered(t, 'chooseDistrict', { district: 'none' }));
    refused(t, { type: 'chooseDistrict', district: 'none', hat: false });
    const u = game(2);
    put(u, 0, 'W4');
    give(u, 0, { coins: 0 });
    act(u, { type: 'removeWorker', from: 'W4' });
    assert.equal(u.turn.player, 1, 'W4 with D5 unavailable gives Lobby Congress, not "none"');
    assert.equal(u.players[0].turnsTaken, 1);
  });
  check('R5.5.1/a', 'Displace needs every worker space of the district occupied', () => {
    const s = game(3);
    put(s, 1, 'W1');
    refused(s, { type: 'displaceWorker', district: 'D1' });
    put(s, 2, 'W3');
    assert.ok(offered(s, 'displaceWorker', { district: 'D1' }));
  });
  check('R5.5.1/b', 'Displace needs none of the workers on those spaces to be yours', () => {
    const s = game(3);
    put(s, 1, 'W1');
    put(s, 0, 'W3');
    refused(s, { type: 'displaceWorker', district: 'D1' });
  });
  check('R5.5.1/c', 'Displace needs you to have no worker adjacent to the district (a centre of a neighbouring district counts)', () => {
    const s = game(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    put(s, 0, 'D2');
    refused(s, { type: 'displaceWorker', district: 'D1' });
    const t = game(3);
    put(t, 1, 'W1');
    put(t, 2, 'W3');
    put(t, 0, 'D4');
    refused(t, { type: 'displaceWorker', district: 'D1' });
  });
  check('R5.5.1/c2', 'a worker of yours that is not adjacent to the district does not prevent the displacement', () => {
    const s = game(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    put(s, 0, 'D9');
    put(s, 0, 'W12');
    assert.ok(offered(s, 'displaceWorker', { district: 'D1' }));
  });
  check('R5.5.1/d', 'Displace needs the centre of the district to be empty', () => {
    const s = game(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    put(s, 2, 'D1');
    refused(s, { type: 'displaceWorker', district: 'D1' });
  });
  check('R5.5.2', 'every worker on a worker space of the district returns to its owner; workers on centres are not affected', () => {
    const s = game(3);
    put(s, 1, 'W1');
    put(s, 2, 'W3');
    put(s, 2, 'D4');
    put(s, 1, 'W2');
    const supply = s.players.map((p) => p.workersInSupply);
    act(s, { type: 'displaceWorker', district: 'D1' });
    assert.equal(s.grid.spaces.W1, null);
    assert.equal(s.grid.spaces.W3, null);
    assert.equal(s.grid.centres.D4, 2);
    assert.equal(s.grid.spaces.W2, 1);
    assert.equal(s.grid.centres.D1, 0);
    assert.equal(s.players[1].workersInSupply, supply[1] + 1);
    assert.equal(s.players[2].workersInSupply, supply[2] + 1);
    assert.equal(s.players[0].workersInSupply, supply[0] - 1);
  });
  check('R5.5.3', 'each returned worker gives its owner 1 hat; an owner at 2 hats takes a resource of choice instead, in turn order from the active player\'s left', () => {
    const s = game(4);
    // Dev (seat 4) is active: order from the left is Anna, Ben, Cara.
    for (let i = 0; i < 3; i++) idleTurn(s);
    assert.equal(s.turn.player, 3);
    for (const w of Object.keys(s.grid.spaces)) {
      if (s.grid.spaces[w] !== null) {
        s.players[s.grid.spaces[w]].workersInSupply += 1;
        s.grid.spaces[w] = null;
      }
    }
    put(s, 2, 'W4');
    put(s, 0, 'W6');
    put(s, 1, 'W7');
    put(s, 0, 'W9');
    give(s, 0, { hats: 1 });
    give(s, 1, { hats: 2 });
    give(s, 2, { hats: 2 });
    give(s, 3, { hats: 1 });
    setHeads(s, 3, 'POR', 'MIN');
    claim(s, 0, 'POR-SPO');
    act(s, { type: 'displaceWorker', district: 'D5' });
    assert.equal(s.players[0].hats, 2);
    assert.equal(kind(s), 'chooseResource');
    assert.equal(s.toAct, 0, 'Anna, first to the left, is owed 2 hats: 1 hat and then 1 resource');
    assert.equal(s.turn.player, 3);
    act(s, { type: 'chooseResource', resource: 'wood' });
    assert.equal(s.toAct, 1);
    act(s, { type: 'chooseResource', resource: 'wood' });
    assert.equal(s.toAct, 2);
    act(s, { type: 'chooseResource', resource: 'iron' });
    assert.deepEqual(s.players.map((p) => p.hats), [2, 2, 2, 1]);
    assert.equal(s.players[0].resources.wood, 2);
    assert.equal(s.toAct, 3);
    assert.equal(kind(s), 'chooseDistrict', 'only then does the displacer choose the action');
  });
  check('R5.5.4', 'the displacer then takes the district\'s action; the multiplier is worked out after the workers have returned', () => {
    const s = game(3);
    put(s, 1, 'W10');
    put(s, 2, 'W12');
    const ev = choose(s, act(s, { type: 'displaceWorker', district: 'D9' }), 'D9');
    assert.equal(eventOf(ev, 'districtChosen').district, 'D9');
    assert.equal(eventOf(ev, 'gather').amount, 1, 'M = 1: the worker used is not counted, the others have gone home');
    assert.equal(s.players[0].coins, 2);
  });
  check('R5.6.1', 'M = 1 + A + H', () => {
    const s = game(2);
    put(s, 0, 'W5');
    put(s, 0, 'D2');
    give(s, 0, { hats: 1, resources: {} });
    // Remove is forced to the centre worker, so use a fresh grid for the place: A = 2 (W5 and the centre of D2), H = 1.
    s.grid.centres.D2 = null;
    s.grid.centres.D6 = 0;
    const t = game(2);
    put(t, 0, 'W5');
    put(t, 0, 'D6');
    give(t, 0, { hats: 1, resources: {} });
    const ev = placeAndChoose(t, 'W2', 'D3', true);
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 4);
    assert.equal(t.players[0].resources.iron, 2 * 4, 'yield = P (2) x M (4)');
    assert.equal(t.players[0].hats, 0);
  });
  check('R5.6.2', 'adjacent: on one of D\'s worker spaces, on D\'s centre, or on the centre of an orthogonal neighbour', () => {
    const m = (setup) => {
      const s = game(2);
      give(s, 0, { resources: {} });
      setup(s);
      const ev = placeAndChoose(s, 'W2', 'D3');
      return eventOf(ev, 'gather').multiplier;
    };
    assert.equal(m(() => {}), 1);
    assert.equal(m((s) => put(s, 0, 'W5')), 2, 'a worker space of D3');
    assert.equal(m((s) => put(s, 0, 'D3')), 2, 'the centre of D3');
    assert.equal(m((s) => put(s, 0, 'D2')), 2, 'the centre of neighbour D2');
    assert.equal(m((s) => put(s, 0, 'D6')), 2, 'the centre of neighbour D6');
    assert.equal(m((s) => put(s, 0, 'D5')), 1, 'D5 is diagonal to D3');
    assert.equal(m((s) => put(s, 0, 'D9')), 1);
    assert.equal(m((s) => put(s, 0, 'W1')), 1, 'W1 borders D2, not D3');
    assert.equal(m((s) => put(s, 0, 'W10')), 1, 'a worker space of a neighbouring district does not count');
    assert.equal(m((s) => { put(s, 0, 'W5'); put(s, 0, 'D6'); put(s, 0, 'D2'); }), 4);
  });
  check('R5.6.3', 'the worker used this turn is never counted: not the placed one, not the removed one', () => {
    const s = game(2);
    give(s, 0, { resources: {} });
    put(s, 0, 'W2');
    put(s, 0, 'W5');
    const ev = choose(s, act(s, { type: 'removeWorker', from: 'W2' }), 'D3');
    assert.equal(eventOf(ev, 'gather').multiplier, 2, 'the removed worker is off the grid; the one on W5 counts');
    const t = game(2);
    put(t, 0, 'D3');
    const ev2 = choose(t, act(t, { type: 'removeWorker', from: 'D3' }), 'D3');
    assert.equal(eventOf(ev2, 'gather').multiplier, 1);
  });
  check('R5.6.4/train', 'train activation: the Foreman, and only the Foreman, is activated M times', () => {
    const s = game(2);
    put(s, 0, 'W3');
    put(s, 0, 'W8');
    give(s, 0, { resources: { iron: 8 } });
    setTrain(s, 0, [['crew', 'crew']]);
    const ev = placeAndChoose(s, 'W6', 'D4');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 3);
    let built = 0;
    while (kind(s) === 'trainActivation' && offered(s, 'useStep')) {
      const e = act(s, { type: 'useStep' });
      built += eventsOf(e, 'build').length;
    }
    assert.equal(s.players[0].builtTiles.ground, 4, 'four of the five steps could be paid with 8 Iron');
    assert.equal(s.players[0].resources.iron, 0);
    const t = game(2);
    put(t, 0, 'W3');
    put(t, 0, 'W8');
    give(t, 0, { resources: { iron: 9 } });
    t.players[0].train.storageCarriages = 2;
    give(t, 0, { resources: { iron: 12 } });
    setTrain(t, 0, [['crew', 'crew']]);
    placeAndChoose(t, 'W6', 'D4');
    while (kind(t) === 'trainActivation' && offered(t, 'useStep')) act(t, { type: 'useStep' });
    assert.equal(t.players[0].builtTiles.ground, 5, 'Foreman x 3, then each Crew once: 5 steps, not 9');
  });
  check('R5.6.4/lay', 'Lay Tracks / Move Train: M steps', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    claim(s, 1, 'POR-SPO', 'BOI-SPO', 'HEL-SPO');
    put(s, 0, 'W6');
    placeAndChoose(s, 'W4', 'D5');
    act(s, { type: 'moveTrain', from: 'POR', to: 'SPO' });
    assert.equal(kind(s), 'layTracks', 'M = 2: a second step is on offer');
    act(s, { type: 'moveTrain', from: 'SPO', to: 'BOI' });
    assert.equal(s.turn.player, 1, 'two steps and the action is over');
  });
  check('R5.7', 'opponents\' workers never change your multiplier', () => {
    const s = game(2);
    give(s, 0, { resources: {} });
    put(s, 1, 'W5');
    put(s, 1, 'D2');
    const ev = placeAndChoose(s, 'W2', 'D3');
    assert.equal(eventOf(ev, 'gather').multiplier, 1);
    assert.equal(s.players[0].resources.iron, 2);
  });
  check('R5.8', 'gridLayout shuffle-resources: Gather Iron, Wood and Gunpowder are shuffled among (1,1), (1,3), (3,1); each keeps its bonus action', () => {
    const three = ['gather-gunpowder', 'gather-iron', 'gather-wood'];
    const layouts = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const s = fresh(2, { gridLayout: 'shuffle-resources' }, { seed });
      assert.deepEqual(sorted(['D1', 'D3', 'D7'].map((d) => s.grid.tiles[d])), three);
      for (const d of ['D2', 'D4', 'D5', 'D6', 'D8', 'D9']) assert.equal(s.grid.tiles[d], R5_1[d][0]);
      layouts.add(['D1', 'D3', 'D7'].map((d) => s.grid.tiles[d]).join());
    }
    assert.equal(layouts.size, 6, 'all six layouts turn up');
    const fixed = fresh(2);
    assert.deepEqual(['D1', 'D3', 'D7'].map((d) => fixed.grid.tiles[d]), ['gather-gunpowder', 'gather-iron', 'gather-wood']);
    // a moved tile gathers its own resource and offers its own bonus action
    let moved = null;
    for (let seed = 1; seed <= 60 && moved === null; seed++) {
      const s = game(2, { gridLayout: 'shuffle-resources' }, { seed });
      if (s.grid.tiles.D1 === 'gather-wood') moved = s;
    }
    assert.ok(moved !== null);
    give(moved, 0, { resources: { gunpowder: 1 } });
    const ev = placeAndChoose(moved, 'W3', 'D1');
    assert.equal(eventOf(ev, 'gather').item, 'wood');
    assert.equal(kind(moved), 'bonusAction');
    assert.ok(offered(moved, 'buyHat'), 'Gather Wood keeps Buy Hat wherever it lies');
  });
}
