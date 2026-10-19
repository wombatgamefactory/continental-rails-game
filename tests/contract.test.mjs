// contract.test.mjs - the engine contract, and the rules the skeleton implements.
//
// Semantics: permanently green; exits 1 on any failure.
//
// Part A checks the promises of docs/engine-contract.md that every later task
// builds on: one atomic decision at a time, the valid-action list and the
// block reasons and the mutators all agreeing, refusals leaving the state
// untouched, decisions by players who are not the active player.
//
// Part B has one or more behavioural checks per rule implemented so far
// (R3 setup, R5 the action grid, R6 gathering, the bonus actions of R7 that
// need no module, R8.5 storage, R14 hats, R19.3 to R19.5 game end, R20).
// The worked examples E1, E3, E4 and E9 of spec R22 are played out as written
// where the skeleton can. Expected numbers are read from the rules tables.
//
// Harness note: states are built with createGame and then adjusted by hand
// (a worker put on the grid, resources granted). The turn record is never
// replaced wholesale.

import assert from 'node:assert/strict';
import {
  createGame,
  getValidActions,
  applyAction,
  getBlockReason,
  getStructuralBlockReason,
  getDistrictActionBlockReason,
  getActionSpace,
  cloneState,
  hashState,
  isGameOver,
  scoreGame,
  addVp,
  actionKey,
  describeAction,
  describeDecision,
  previewMultipliers,
  topFrame,
  getConstants,
  production,
  storageUsed,
  storageCapacity,
  nextSpecialistSlot,
  hireCost,
  multiplierFor,
  adjacentWorkers,
  buildingTableVp,
  ACTIONS,
  FRAMES,
  MUTATORS,
  RESUME,
  DISTRICT_ACTION_RULES,
  DISTRICT_RESOLVERS,
  BONUS_ACTION_TYPES,
  STOP_ACTION_TYPES,
  SILENT,
  RULES,
  MAP,
  SPACE_DISTRICTS,
  isSpaceId,
} from '../src/engine/index.js';
import { gainItems } from '../src/engine/actions.js'; // an engine-internal helper, tested directly
import { BOT_LEVELS, getBot, botLevelIds } from '../src/bots/index.js';
import { handleBotRequest } from '../src/bots/bot-worker.js';
import { playGame, drive, makeSuite } from './helpers/play.mjs';

const suite = makeSuite('contract');
const NAMES = ['Anna', 'Ben', 'Cara', 'Dev'];

/**
 * A game past setup, seats in the order given, waiting at Anna's worker step.
 * No scoring card, and Legislative Agenda card 10 (Expansion Leader, the card
 * seed 1 drew before spec v4), unless options say otherwise: the worked
 * examples count resources and VP that a gather or per-slot bonus would change.
 */
function start(players, options = {}) {
  const state = createGame({
    players: NAMES.slice(0, players).map((name) => ({ name })),
    seed: options.seed ?? 1,
    shuffleSeats: false,
    variants: { startCompensation: 'none', scoringCard: 'none', legislativeAgendaCard: 10, ...(options.variants ?? {}) },
    constants: options.constants,
  });
  drive(
    state,
    (s) => s.phase === 'setup',
    (actions) =>
      actions.find((a) => a.track === (options.production ?? 'iron')) ??
      actions.find((a) => a.specialist === (options.specialist ?? 'crew')) ??
      actions[0],
  );
  return state;
}

/** Puts one of a player's workers on a worker space or (for a district id) a centre, by hand. */
function put(state, playerId, at) {
  const player = state.players[playerId];
  assert.ok(player.workersInSupply > 0, 'test set-up: no worker left to put on the grid');
  if (isSpaceId(at)) {
    assert.equal(state.grid.spaces[at], null);
    state.grid.spaces[at] = playerId;
  } else {
    assert.equal(state.grid.centres[at], null);
    state.grid.centres[at] = playerId;
  }
  player.workersInSupply -= 1;
}

function act(state, action) {
  return applyAction(state, action);
}

function types(state) {
  return [...new Set(getValidActions(state).map((a) => a.type))].sort();
}

function getDistrictBlock(state, district) {
  return getDistrictActionBlockReason(state, state.toAct, district);
}

function gathered(events) {
  return events.find((e) => e.type === 'gather');
}

/**
 * Finishes a worker step by choosing a district. Since the core rules most worker spaces
 * border two districts that can be chosen, so the choice is a real decision;
 * where the engine has already made it (one choosable district), nothing more
 * is done. Returns the events of both actions.
 */
function choose(state, events, district, hat = false) {
  const top = topFrame(state);
  if (top !== null && top.kind === 'chooseDistrict') return [...events, ...act(state, { type: 'chooseDistrict', district, hat })];
  return events;
}

/** Places a worker on `space`, then chooses `district`. */
function placeAndChoose(state, space, district, hat = false) {
  return choose(state, act(state, { type: 'placeWorker', space }), district, hat);
}

// =============================================================================
// Part A - the contract
// =============================================================================

suite.check('the tables that must agree do agree', () => {
  assert.deepEqual(Object.keys(MUTATORS).sort(), Object.keys(ACTIONS).sort(), 'ACTIONS (legality.js) and MUTATORS (actions.js)');
  assert.deepEqual(Object.keys(DISTRICT_RESOLVERS).sort(), Object.keys(DISTRICT_ACTION_RULES).sort(), 'DISTRICT_ACTION_RULES and DISTRICT_RESOLVERS');
  for (const kind of Object.keys(RESUME)) assert.ok(FRAMES[kind], `RESUME has "${kind}" but FRAMES does not`);
  for (const type of Object.values(BONUS_ACTION_TYPES)) assert.ok(ACTIONS[type], `bonus action type ${type}`);
  for (const bonus of Object.keys(BONUS_ACTION_TYPES)) assert.ok(RULES.BONUS_ACTIONS[bonus], `bonus action ${bonus}`);
  for (const [type, def] of Object.entries(ACTIONS)) {
    assert.ok(Array.isArray(def.params) && typeof def.block === 'function' && typeof def.space === 'function' && typeof def.describe === 'function', type);
    assert.match(def.rule, /^R\d/, `${type}: rule`);
  }
  assert.deepEqual(STOP_ACTION_TYPES, ['skipBonusAction', 'skipStep', 'closeCongress', 'stopLaying', 'skipBuilding', 'endFreeActions', 'skipEffect', 'declineFreeEntry']);
});

suite.check('getValidActions is exactly the set of actions whose block reason is null, and applyAction accepts each of them', () => {
  let states = 0;
  let offered = 0;
  for (const players of [2, 3, 4]) {
    for (let g = 0; g < 3; g++) {
      let n = 0;
      playGame(
        { playerCount: players, seed: `agree-${players}-${g}`, variants: { maxTurnsPerPlayer: 40, bonusActionLimit: g === 2 ? 'multiplied' : 'once-per-turn' } },
        {
          onDecision(state, actions) {
            n += 1;
            if (n % 7 !== 0) return;
            states += 1;
            const listed = actions.map(actionKey).sort();
            assert.equal(new Set(listed).size, listed.length, 'the list must not repeat an action');
            const legal = getActionSpace(state).filter((a) => getBlockReason(state, a) === null).map(actionKey).sort();
            assert.deepEqual(listed, legal, `decision "${topFrame(state).kind}": the list and the block reasons disagree`);
            const before = hashState(state);
            for (const action of actions) {
              const copy = cloneState(state);
              applyAction(copy, action, SILENT); // throws if refused
              assert.notEqual(hashState(copy), before, `${actionKey(action)} changed nothing`);
              offered += 1;
            }
            assert.equal(hashState(state), before);
          },
        },
      );
    }
  }
  assert.ok(states > 100 && offered > 400, `only ${states} states and ${offered} actions were checked`);
});

suite.check('every block reason is a sentence for the player: no code leaks, real numbers, a full stop', () => {
  let reasons = 0;
  const seen = new Set();
  for (const players of [2, 4]) {
    let n = 0;
    playGame(
      { playerCount: players, seed: `reasons-${players}`, variants: { maxTurnsPerPlayer: 30 } },
      {
        onDecision(state) {
          n += 1;
          if (n % 5 !== 0) return;
          for (const action of getActionSpace(state)) {
            for (const player of state.players.map((p) => p.id)) {
              const reason = getBlockReason(state, { ...action, player });
              if (reason === null) continue;
              reasons += 1;
              seen.add(reason.replace(/\d+/g, '#'));
              assert.equal(typeof reason, 'string');
              assert.ok(reason.length > 12, `too short: "${reason}"`);
              assert.match(reason, /[.]$/, `no full stop: "${reason}"`);
              assert.ok(!/undefined|NaN|\[object|null/.test(reason), `code leaked into: "${reason}"`);
            }
          }
        },
      },
    );
  }
  assert.ok(reasons > 1000);
  assert.ok(seen.size >= 25, `only ${seen.size} different reasons were seen`);
});

suite.check('an illegal action is refused with a reason and the state is left untouched', () => {
  const state = start(3);
  const before = hashState(state);
  const json = JSON.stringify(state);
  const refuse = (action, pattern) => {
    assert.throws(
      () => applyAction(state, action),
      (err) => {
        assert.equal(err.code, 'ILLEGAL_ACTION');
        assert.equal(err.reason, getBlockReason(state, action));
        assert.match(err.reason, pattern);
        return true;
      },
    );
    assert.equal(hashState(state), before);
    assert.equal(JSON.stringify(state), json);
  };
  refuse({ type: 'flyToTheMoon' }, /not an action/);
  refuse({ type: 'placeWorker' }, /needs `space`/);
  refuse({ type: 'placeWorker', space: 'W99' }, /not a worker space/);
  refuse({ type: 'discard', item: 'iron' }, /over capacity, and you hold 3 of 9/);
  refuse({ type: 'chooseDistrict', district: 'D1', hat: false }, /right after your worker step/);
  refuse({ type: 'placeWorker', space: 'W1', player: 1 }, /It is Anna's decision \(place, displace or remove a worker\), not yours/);
  refuse({ type: 'placeWorker', space: 'W1', player: 7 }, /no player 7/);
  refuse(null, /must be an object/);
  // The same action for the right player is fine, with or without `player`.
  assert.equal(getBlockReason(state, { type: 'placeWorker', space: 'W1', player: 0 }), null);
  applyAction(state, { type: 'placeWorker', space: 'W1', player: 0 });
  assert.notEqual(hashState(state), before);
});

suite.check('applyAction returns the events of the action, numbered by seq; SILENT returns null', () => {
  const state = start(2);
  const seq = state.seq;
  const events = act(state, { type: 'placeWorker', space: 'W1' });
  assert.equal(events[0].type, 'action');
  assert.equal(events[0].auto, false);
  assert.deepEqual(events[0].action, { type: 'placeWorker', space: 'W1' });
  assert.equal(events[0].player, 0);
  assert.equal(events[0].seq, seq + 1);
  assert.equal(events[0].text, 'Place a worker on W1');
  for (let i = 1; i < events.length; i++) assert.ok(events[i].seq >= events[i - 1].seq);
  assert.equal(events[events.length - 1].seq, state.seq);
  assert.equal(applyAction(state, getValidActions(state)[0], SILENT), null);
});

suite.check('a forced action is applied by the engine and marked auto (the auto-advance rule)', () => {
  // W6 lies between Ground Tracks and Lay Tracks / Move Train. With no route to
  // claim or move along, Lay Tracks cannot be chosen (R4.6.3), so with no hat
  // to spend there is one legal district: the engine chooses it.
  const state = start(2);
  const events = act(state, { type: 'placeWorker', space: 'W6' });
  const auto = events.filter((e) => e.type === 'action' && e.auto);
  assert.ok(auto.length >= 1, 'the only legal district must be chosen by the engine');
  assert.deepEqual(auto[0].action, { type: 'chooseDistrict', district: 'D4', hat: false });
  assert.equal(auto[0].player, 0);
  // Whatever is pending now is a real choice.
  assert.ok(getValidActions(state).length >= 2);
});

suite.check('the last railhead of a 4-player draft is forced, so the engine places it', () => {
  const state = createGame({ playerCount: 4, seed: 3, shuffleSeats: false });
  const west = MAP.westStartCities;
  // Reverse seat order: everybody starts in the west.
  for (let i = 0; i < 4; i++) {
    assert.equal(state.toAct, 3 - i, 'R3.5.1: first railheads in reverse seat order');
    act(state, { type: 'placeRailhead', city: west[i] });
  }
  let last = null;
  for (let seat = 0; seat < 3; seat++) {
    assert.equal(state.toAct, seat, 'R3.5.2: second railheads in seat order');
    assert.ok(getValidActions(state).every((a) => MAP.cityById[a.city].kind === 'east'), 'R3.5.2: the opposite side');
    last = act(state, getValidActions(state)[0]);
  }
  const forced = last.find((e) => e.type === 'action' && e.auto);
  assert.ok(forced, 'seat 4 had one start city left');
  assert.equal(forced.player, 3);
  assert.equal(forced.action.type, 'placeRailhead');
  assert.ok(state.players.every((p) => p.railheads.every((c) => c !== null)));
  assert.equal(topFrame(state).kind, 'setupProduction');
});

suite.check('actionKey, describeAction and describeDecision cover everything on offer', () => {
  const { state } = playGame({ playerCount: 3, seed: 'describe' }, { stopAfter: 90 });
  const actions = getValidActions(state);
  assert.equal(new Set(actions.map(actionKey)).size, actions.length);
  for (const a of actions) {
    const text = describeAction(state, a);
    assert.ok(typeof text === 'string' && text.length > 5 && !/undefined/.test(text), text);
    assert.equal(actionKey(a), actionKey(JSON.parse(JSON.stringify(a))));
  }
  const decision = describeDecision(state);
  assert.equal(decision.player, state.toAct);
  assert.equal(decision.kind, topFrame(state).kind);
  assert.ok(decision.prompt.startsWith(`${state.players[state.toAct].name}: `));
});

suite.check('the bot registry and the worker entry return legal actions and repeat for a seed', () => {
  assert.deepEqual(botLevelIds(), BOT_LEVELS.map((l) => l.id));
  assert.ok(botLevelIds().includes('random'));
  for (const level of BOT_LEVELS) {
    assert.ok(level.name.length > 0 && level.description.length > 0 && Number.isFinite(level.defaultTimeBudgetMs));
    assert.equal(typeof getBot(level.id).chooseAction, 'function');
  }
  assert.throws(() => getBot('grandmaster'), /Unknown bot level "grandmaster"/);

  const { state } = playGame({ playerCount: 4, seed: 'worker' }, { stopAfter: 70 });
  const before = JSON.stringify(state);
  const wire = JSON.parse(before); // what a Web Worker would receive
  const picks = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const reply = handleBotRequest({ id: seed, state: wire, level: 'random', seed, timeBudgetMs: 50 });
    assert.equal(reply.ok, true);
    assert.equal(reply.id, seed);
    assert.equal(getBlockReason(state, reply.action), null);
    assert.deepEqual(handleBotRequest({ id: seed, state: wire, level: 'random', seed }).action, reply.action, 'same seed, same move');
    picks.add(actionKey(reply.action));
  }
  assert.ok(picks.size > 1, 'different seeds should not all pick the same move');
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(wire), before, 'a bot must not change the state it is given');
  // Extra options reach the bot untouched, and cannot displace the RNG the worker makes for it.
  const seen = [];
  const random = getBot('random');
  const realChoose = random.chooseAction;
  random.chooseAction = (s, context) => {
    seen.push(context);
    return getValidActions(s)[0];
  };
  try {
    handleBotRequest({ state: wire, level: 'random', seed: 5, options: { jitter: 2, rng: 'not this' } }, () => 123);
  } finally {
    random.chooseAction = realChoose;
  }
  assert.equal(seen[0].jitter, 2);
  assert.equal(typeof seen[0].rng.s, 'number');
  assert.equal(seen[0].now(), 123);
  const bad = handleBotRequest({ id: 'x', state: wire, level: 'grandmaster', seed: 1 });
  assert.deepEqual([bad.id, bad.ok], ['x', false]);
  assert.match(bad.error, /Unknown bot level/);
  assert.equal(handleBotRequest({ state: wire, level: 'random' }).ok, false, 'a request without a seed is an error, not a silent default');
});

// =============================================================================
// Part B - the rules implemented so far
// =============================================================================

suite.check('R3.3 to R3.7: every player starts as the setup table says', () => {
  const K = RULES;
  for (const players of [2, 3, 4]) {
    const state = createGame({ playerCount: players, seed: 11, shuffleSeats: false });
    const compensation = new Array(players).fill(0);
    const chosenTrack = [];
    const chosenSpecialist = [];
    while (state.phase === 'setup') {
      const frame = topFrame(state);
      const actions = getValidActions(state);
      const pick = actions[(frame.player + actions.length - 1) % actions.length];
      if (pick.type === 'chooseStartingProduction') chosenTrack[frame.player] = pick.track;
      if (pick.type === 'chooseStartingSpecialist') chosenSpecialist[frame.player] = pick.specialist;
      if (pick.type === 'chooseResource') compensation[frame.player] += 1;
      applyAction(state, pick);
    }
    assert.deepEqual(compensation, K.SETUP.graduatedCompensation.slice(0, players), 'R3.7');
    assert.equal(state.turn.player, 0, 'R3.9: the start player takes the first turn');
    assert.equal(state.turn.number, 1);
    assert.equal(state.players.reduce((sum, p) => sum + p.workersInSupply, 0), 12, 'R3.3: 12 workers in play');
    for (const p of state.players) {
      assert.equal(p.workersInSupply, K.SETUP.workersByPlayerCount[players]);
      assert.equal(p.coins, K.SETUP.startingCoins);
      assert.equal(p.hats, K.SETUP.startingHats);
      assert.equal(storageUsed(p), 3 + compensation[p.id], 'starting resources plus compensation, in storage');
      assert.equal(storageCapacity(state, p.id), K.TRAIN.storagePerCarriage * K.SETUP.startingStorageCarriages);
      assert.deepEqual(p.builtTiles, { ground: 0, tunnel: 0, bridge: 0 });
      // R3.4: 11 houses, the "2" slot of the chosen track empty.
      for (const track of K.PLAYER_BOARD.houseTracks) {
        assert.equal(production(state, p.id, track), track === chosenTrack[p.id] ? 2 : 1, `production of ${track}`);
      }
      // R3.6: the free specialist sits in slot 1 of the level 1 carriage.
      assert.deepEqual(p.train.specialistCarriages, [{ slots: [chosenSpecialist[p.id], null] }]);
      assert.deepEqual(nextSpecialistSlot(p), { level: 1, slot: 2 });
      // R3.5: one railhead in the west and one in the east.
      assert.deepEqual(p.railheads.map((c) => MAP.cityById[c].kind).sort(), ['east', 'west']);
      assert.deepEqual(p.startCities, p.railheads);
      assert.equal(p.telegraphsPlaced, 0);
      assert.ok(Object.values(p.vp).every((v) => v === 0), 'R3.1.4: all scores start at 0');
    }
    const all = state.players.flatMap((p) => p.railheads);
    assert.equal(new Set(all).size, all.length, 'R3.5.3: a start city holds at most one railhead during the draft');
  }
});

suite.check('R3.2: seats are shuffled with the game RNG unless the order is fixed', () => {
  const players = NAMES.map((name) => ({ name }));
  const fixed = createGame({ players, seed: 1, shuffleSeats: false });
  assert.deepEqual(fixed.players.map((p) => p.name), NAMES);
  assert.deepEqual(fixed.players.map((p) => p.configIndex), [0, 1, 2, 3]);
  const orders = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const state = createGame({ players, seed });
    assert.deepEqual(state.players.map((p) => p.id), [0, 1, 2, 3]);
    assert.deepEqual(state.players.map((p) => NAMES[p.configIndex]), state.players.map((p) => p.name));
    orders.add(state.players.map((p) => p.name).join());
  }
  assert.ok(orders.size > 5);
  assert.throws(() => createGame({ playerCount: 5, seed: 1 }), /2 to 4 players; 5 were given/);
  assert.throws(() => createGame({ playerCount: 1, seed: 1 }), /2 to 4 players/);
});

suite.check('R3.5: block reasons of the railhead draft', () => {
  const state = createGame({ players: NAMES.map((name) => ({ name })), seed: 1, shuffleSeats: false });
  assert.match(getBlockReason(state, { type: 'placeRailhead', city: 'DEN' }), /Denver is an inland city: railheads start on one of the 8 start cities/);
  act(state, { type: 'placeRailhead', city: 'SEA' }); // Dev
  assert.match(getBlockReason(state, { type: 'placeRailhead', city: 'SEA' }), /Seattle already holds Dev's railhead/);
  act(state, { type: 'placeRailhead', city: 'OMA' }); // Cara
  act(state, { type: 'placeRailhead', city: 'POR' }); // Ben
  act(state, { type: 'placeRailhead', city: 'LAX' }); // Anna
  assert.equal(state.toAct, 0);
  assert.match(
    getBlockReason(state, { type: 'placeRailhead', city: 'SAC' }),
    /Your first railhead is on Los Angeles, a west start city, so your second must start on an east start city, not Sacramento/,
  );
  assert.equal(getBlockReason(state, { type: 'placeRailhead', city: 'MIN' }), null);
});

suite.check('E1 (R22): Gather Iron with M = 2, then the Hire Specialist bonus action', () => {
  const state = start(4, { production: 'iron', specialist: 'crew' });
  const anna = state.players[0];
  put(state, 0, 'W5'); // between Gather Iron and Bridge Tracks
  assert.equal(production(state, 0, 'iron'), 2);

  const events = placeAndChoose(state, 'W2', 'D3');
  const g = gathered(events);
  assert.deepEqual([g.item, g.production, g.multiplier, g.amount], ['iron', 2, 2, 4], 'yield = P x M = 2 x 2');
  assert.deepEqual(anna.resources, { iron: 5, wood: 1, gunpowder: 1 });
  assert.equal(storageUsed(anna), 7);

  assert.equal(topFrame(state).kind, 'bonusAction');
  assert.equal(topFrame(state).bonus, 'hire');
  // A Financier: 1 Coin fee + 1 Coin + 1 Iron, and she has 1 Coin.
  const fin = hireCost(state, 0, 'financier', 'bonusAction');
  assert.deepEqual(fin.cost, { coins: 2, iron: 1 });
  assert.match(
    getBlockReason(state, { type: 'hireSpecialist', specialist: 'financier' }),
    /Hiring a Financier into your level 1 carriage costs 2 Coins \+ 1 Iron and you have 1 Coin\./,
  );
  assert.ok(!getValidActions(state).some((a) => a.specialist === 'financier'));
  // A Crew: 1 Coin fee + 1 Iron + 1 Gunpowder. She pays it.
  act(state, { type: 'hireSpecialist', specialist: 'crew' });
  assert.equal(anna.coins, 0);
  assert.deepEqual(anna.resources, { iron: 4, wood: 1, gunpowder: 0 });
  assert.equal(storageUsed(anna), 5);
  assert.deepEqual(anna.train.specialistCarriages[0].slots, ['crew', 'crew']);
  assert.equal(state.supply.specialists.crew, RULES.TRAIN.specialistsPerType - 2 - 3, 'two for Anna, one each for the other three');
  // The turn is over: once per Gather action (R7.2), and no free actions in the core game.
  assert.equal(state.turn.player, 1);
  assert.equal(anna.turnsTaken, 1);
});

suite.check('E3 (R22): Gather Wood, then Buy Hat; no Buy Hat at the limit of 2', () => {
  const state = start(4);
  const cara = state.players[0];
  cara.hats = 1;
  state.turn.hatsAtStart = 1; // she held it when the turn began
  act(state, { type: 'placeWorker', space: 'W8' });
  assert.deepEqual(types(state), ['chooseDistrict'], 'with a hat to spend, the district choice is a real choice');
  const events = act(state, { type: 'chooseDistrict', district: 'D7', hat: false });
  assert.deepEqual([gathered(events).item, gathered(events).amount], ['wood', 1]);
  assert.equal(cara.resources.wood, 2);
  act(state, { type: 'buyHat' });
  assert.equal(cara.resources.gunpowder, 0, 'Buy Hat costs 1 Gunpowder');
  assert.equal(cara.hats, 2);

  // Later, holding 2 hats, she cannot take Buy Hat at all.
  const later = start(4);
  later.players[0].hats = RULES.HATS.hatLimit;
  const laterEvents = placeAndChoose(later, 'W8', 'D7');
  assert.match(getBlockReason(later, { type: 'buyHat', player: 0 }), /You already hold 2 cowboy hats, the limit/);
  // Skipping was the only thing left, so the engine did it and the turn passed.
  assert.ok(laterEvents.some((e) => e.type === 'action' && e.auto && e.action.type === 'skipBonusAction'));
  assert.equal(later.players[0].hats, 2);
  assert.equal(later.turn.player, 1);
});

suite.check('E4 (R22): Gather Coins, then Add Carriage; the new specialist carriage is level 2 and stays empty', () => {
  const state = start(4);
  const dev = state.players[0];
  const events = placeAndChoose(state, 'W12', 'D9');
  assert.deepEqual([gathered(events).item, gathered(events).amount], ['coins', 1]);
  assert.equal(dev.coins, RULES.SETUP.startingCoins + 1);
  assert.deepEqual(types(state), ['addCarriage', 'skipBonusAction']);
  act(state, { type: 'addCarriage', carriage: 'specialist' });
  assert.equal(dev.resources.wood, 0, 'Add Carriage costs 1 Wood');
  assert.deepEqual(dev.train.specialistCarriages, [{ slots: ['crew', null] }, { slots: [null, null] }]);
  assert.deepEqual(nextSpecialistSlot(dev), { level: 1, slot: 2 }, 'R8.6.1: the next hire still goes to the level 1 carriage');
  assert.equal(storageCapacity(state, 0), RULES.TRAIN.storagePerCarriage, 'a specialist carriage stores nothing');

  // A storage carriage adds 9 to capacity (R8.3), up to 3 of each kind (R7.6).
  const other = start(2);
  other.players[0].train.storageCarriages = RULES.TRAIN.maxStorageCarriages;
  placeAndChoose(other, 'W12', 'D9');
  assert.match(getBlockReason(other, { type: 'addCarriage', carriage: 'storage' }), /You already have 3 storage carriages, the most a train can have/);
  assert.equal(getBlockReason(other, { type: 'addCarriage', carriage: 'specialist' }), null);
  assert.match(getBlockReason(other, { type: 'addCarriage', carriage: 'dining' }), /not a kind of carriage/);
});

suite.check('R5.6: the multiplier counts your other workers on the spaces, the centre and neighbouring centres', () => {
  const state = start(2);
  // D1 (Gather Gunpowder): spaces W1, W3; neighbours D2 and D4.
  assert.equal(adjacentWorkers(state, 0, 'D1', null), 0);
  put(state, 0, 'W3');
  assert.equal(adjacentWorkers(state, 0, 'D1', null), 1, 'a worker on one of its spaces');
  put(state, 0, 'D4');
  assert.equal(adjacentWorkers(state, 0, 'D1', null), 2, 'a worker on the centre of a neighbour');
  put(state, 0, 'D9');
  assert.equal(adjacentWorkers(state, 0, 'D1', null), 2, 'D9 is not a neighbour of D1');
  put(state, 1, 'W1');
  assert.equal(adjacentWorkers(state, 0, 'D1', null), 2, 'R5.7: an opponent never changes your multiplier');
  assert.equal(adjacentWorkers(state, 0, 'D1', 'W3'), 1, 'R5.6.3: the worker used this turn is not counted');
  assert.deepEqual(multiplierFor(state, 0, 'D1', true, 'W3'), { multiplier: 3, adjacent: 1, hat: 1 });

  // Through the real flow: remove the worker from W3 and gather gunpowder.
  // R5.4.1 says the centre workers must go first, so take them off by hand.
  state.grid.centres.D9 = null;
  state.players[0].workersInSupply += 1;
  state.grid.centres.D4 = null;
  state.players[0].workersInSupply += 1;
  put(state, 0, 'W11'); // between Gather Wood and Tunnel Tracks: not adjacent to D1
  const events = choose(state, act(state, { type: 'removeWorker', from: 'W3' }), 'D1');
  assert.deepEqual([gathered(events).item, gathered(events).multiplier], ['gunpowder', 1], 'a removed worker is already off the grid');
});

suite.check('R5.3, R5.4: place and remove give the choice of the two bordering districts', () => {
  // W11 lies between Gather Wood (D7) and Tunnel Tracks (D8). Both can always be
  // chosen, so the choice is a real decision.
  const state = start(3);
  act(state, { type: 'placeWorker', space: 'W11' });
  assert.deepEqual(getValidActions(state).map((a) => a.district).sort(), ['D7', 'D8'], 'without a hat, one action per district');
  assert.equal(topFrame(state).kind, 'chooseDistrict');
  assert.deepEqual(SPACE_DISTRICTS.W11, ['D7', 'D8']);
  const events = act(state, { type: 'chooseDistrict', district: 'D7', hat: false });
  assert.equal(gathered(events).item, 'wood');
  assert.equal(state.players[0].resources.wood, 2);
  assert.equal(state.grid.spaces.W11, 0);
  assert.match(getBlockReason(state, { type: 'placeWorker', space: 'W11', player: 1 }), /W11 already holds Anna's worker/);

  // R4.6.3: a space next to Lay Tracks / Move Train gives only the other district while no claim or move is possible.
  const forced = start(3);
  assert.match(
    getBlockReason(forced, { type: 'chooseDistrict', district: 'D5', hat: false }),
    /right after your worker step/,
  );
  assert.match(
    getDistrictBlock(forced, 'D5'),
    /Lay Tracks \/ Move Train needs a legal claim or move, and you have neither: your railheads stand on .*no claimed route touches your railheads/,
  );
  assert.ok(getValidActions(forced).some((a) => a.space === 'W4'), 'W4 is usable: it also gives Lobby Congress');

  // No worker in supply: place and displace are out, remove is in.
  const none = start(4);
  for (const w of ['W1', 'W2', 'W3']) put(none, 0, w);
  assert.equal(none.players[0].workersInSupply, 0);
  assert.match(getBlockReason(none, { type: 'placeWorker', space: 'W8' }), /You have no worker in your supply: all 3 of your workers are on the action grid/);
  assert.deepEqual(types(none), ['removeWorker']);
  assert.match(getBlockReason(none, { type: 'removeWorker', from: 'W8' }), /You have no worker on W8/);
  choose(none, act(none, { type: 'removeWorker', from: 'W2' }), 'D3');
  assert.equal(none.players[0].workersInSupply, 1);
  assert.equal(none.grid.spaces.W2, null);
  assert.equal(none.players[0].resources.iron, 1 + 2 * 1, 'removed from W2: Gather Iron at production 2, M = 1');
});

suite.check('E9 (R22), R5.5: displacement returns the workers and pays hats, or a resource at the limit, in turn order', () => {
  const state = start(4);
  const [anna, ben, cara, dev] = state.players;
  // Gather Gunpowder (D1) is blocked by Dev (W1) and Ben (W3). Both hold 2 hats.
  put(state, 3, 'W1');
  put(state, 1, 'W3');
  ben.hats = 2;
  dev.hats = 2;
  assert.equal(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), null);

  const events = act(state, { type: 'displaceWorker', district: 'D1' });
  assert.equal(state.grid.centres.D1, 0);
  assert.equal(state.grid.spaces.W1, null);
  assert.equal(state.grid.spaces.W3, null);
  assert.equal(ben.workersInSupply, 3);
  assert.equal(dev.workersInSupply, 3);
  assert.deepEqual(events.filter((e) => e.type === 'workerReturned').map((e) => e.player).sort(), [1, 3]);

  // R5.5.3 / R14.1: the choice belongs to a player who is NOT the active player.
  assert.equal(state.turn.player, 0);
  assert.equal(state.toAct, 1, 'owners resolve in turn order from the active player\'s left: Ben first');
  assert.deepEqual(types(state), ['chooseResource']);
  assert.equal(topFrame(state).reason, 'hatLimit');
  assert.match(getBlockReason(state, { type: 'chooseResource', resource: 'coins' }), /Coins are not a resource/);
  assert.match(getBlockReason(state, { type: 'chooseResource', resource: 'wood', player: 0 }), /It is Ben's decision \(take 1 resource of your choice\), not yours/);
  act(state, { type: 'chooseResource', resource: 'wood' });
  assert.equal(ben.resources.wood, 2);
  assert.equal(ben.hats, 2);
  assert.equal(state.toAct, 3, 'then Dev');
  const after = act(state, { type: 'chooseResource', resource: 'iron' });
  assert.equal(dev.resources.iron, 2);

  // R5.5.4: Anna then takes the district's action. She has no hat, so it is forced.
  const g = gathered(after);
  assert.deepEqual([g.player, g.item, g.multiplier], [0, 'gunpowder', 1], 'the worker on the centre is the "1", not an adjacent worker');
  assert.equal(anna.resources.gunpowder, 2);
  assert.equal(cara.hats, 0, 'a player with no worker there gets nothing');
});

suite.check('E9 (R22): one owner of two returned workers with 1 hat gains a hat, then takes a resource; with no hat gains two', () => {
  const state = start(3);
  const [, ben] = state.players;
  put(state, 1, 'W1');
  put(state, 1, 'W3');
  ben.hats = 1;
  act(state, { type: 'displaceWorker', district: 'D1' });
  assert.equal(ben.hats, 2);
  assert.equal(state.toAct, 1);
  assert.equal(topFrame(state).remaining, 1);
  act(state, { type: 'chooseResource', resource: 'gunpowder' });
  assert.equal(ben.resources.gunpowder, 2);

  const fresh = start(3);
  put(fresh, 2, 'W10');
  put(fresh, 2, 'W12');
  act(fresh, { type: 'displaceWorker', district: 'D9' });
  assert.equal(fresh.players[2].hats, 2, 'two workers, two hats, no choice to make');
  assert.equal(fresh.players[0].coins, RULES.SETUP.startingCoins + 1, 'and the active player gathered Coins');
});

suite.check('R5.5.1: the four conditions of a displacement, each with its own reason', () => {
  const state = start(4);
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /Gather Gunpowder is not blocked: 2 of its 2 worker spaces are empty \(W1, W3\)/);
  put(state, 1, 'W1');
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /1 of its 2 worker spaces is empty \(W3\)/);
  put(state, 0, 'W3');
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /You have a worker on W3, a worker space of Gather Gunpowder/);
  state.grid.spaces.W3 = 2;
  state.players[0].workersInSupply += 1;
  state.players[2].workersInSupply -= 1;
  put(state, 0, 'D4');
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /Your worker on the centre of Ground Tracks is adjacent to Gather Gunpowder/);
  state.grid.centres.D4 = null;
  state.players[0].workersInSupply += 1;
  put(state, 3, 'D1');
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), /The centre of Gather Gunpowder already holds Dev's worker/);
  state.grid.centres.D1 = null;
  state.players[3].workersInSupply += 1;
  assert.equal(getBlockReason(state, { type: 'displaceWorker', district: 'D1' }), null);
  assert.match(getBlockReason(state, { type: 'displaceWorker', district: 'D5' }), /not blocked/);
});

suite.check('R5.4.1, R5.4.3, R5.6.2: a worker on a centre multiplies its neighbours and must be removed first', () => {
  const state = start(3);
  put(state, 0, 'D1'); // centre of Gather Gunpowder; D1 neighbours D2 and D4
  put(state, 0, 'W8'); // between Ground Tracks (D4) and Gather Wood (D7)
  assert.match(
    getBlockReason(state, { type: 'removeWorker', from: 'W8' }),
    /You have a worker on the centre of Gather Gunpowder; when you remove a worker it must be that one/,
  );
  assert.deepEqual(getValidActions(state).filter((a) => a.type === 'removeWorker'), [{ type: 'removeWorker', from: 'D1' }]);
  // Placing is still allowed (R4.5), and the centre worker multiplies its own district.
  const copy = cloneState(state);
  const placed = placeAndChoose(copy, 'W1', 'D1');
  assert.equal(gathered(placed).multiplier, 2, 'the centre worker is adjacent to its own district');
  // Removing it gives its district's action (R5.4.3).
  const removed = act(state, { type: 'removeWorker', from: 'D1' });
  assert.deepEqual([gathered(removed).item, gathered(removed).multiplier], ['gunpowder', 1]);
  assert.equal(state.grid.centres.D1, null);
});

suite.check('R5.4.4: a worker forced off the centre of a district whose action cannot be taken gives no action', () => {
  const state = start(4);
  const anna = state.players[0];
  // Anna's worker stands on the centre of Lay Tracks / Move Train, whose action she cannot take.
  put(state, 0, 'D5');
  put(state, 0, 'W1');
  put(state, 0, 'W2');
  assert.equal(anna.workersInSupply, 0);
  assert.deepEqual(getValidActions(state), [{ type: 'removeWorker', from: 'D5' }], 'R5.4.1 leaves exactly one legal move');
  // A single legal move would have been applied by the engine after a real
  // action; here the state was built by hand, so apply it.
  const before = JSON.stringify(anna.resources);
  const events = act(state, { type: 'removeWorker', from: 'D5' });
  const chosen = events.find((e) => e.type === 'districtChosen');
  assert.equal(chosen.district, 'none');
  assert.ok(events.some((e) => e.type === 'action' && e.auto && e.action.district === 'none' && e.action.hat === false));
  assert.equal(gathered(events), undefined, 'no district action is taken');
  assert.equal(JSON.stringify(anna.resources), before);
  assert.equal(anna.workersInSupply, 1);
  assert.equal(anna.turnsTaken, 1, 'the end-of-turn checks still happen');
  assert.equal(state.turn.player, 1);
});

suite.check('R14.2: only a hat held when the turn began can be spent; a spent hat adds 1 to M', () => {
  const state = start(2);
  const anna = state.players[0];
  // A hat gained during this turn (the turn began with none).
  anna.hats = 1;
  assert.equal(state.turn.hatsAtStart, 0);
  const copy = cloneState(state);
  act(copy, { type: 'placeWorker', space: 'W1' });
  assert.ok(getValidActions(copy).every((a) => a.hat === false), 'no choice offers the hat: it could not be spent');
  assert.equal(copy.players[0].hats, 1);
  // Asking directly, at the district step, gives the reason.
  // (Built by hand: the worker is on W1 and the district choice is pending.)
  const probe = cloneState(state);
  put(probe, 0, 'W1');
  probe.turn.worker = { via: 'place', at: 'W1' };
  probe.stack.pop();
  probe.stack.push({ kind: 'chooseDistrict', player: 0 });
  assert.match(
    getBlockReason(probe, { type: 'chooseDistrict', district: 'D1', hat: true }),
    /You held 0 cowboy hats when this turn began, and a hat gained during a turn cannot be spent in that turn/,
  );
  assert.equal(getBlockReason(probe, { type: 'chooseDistrict', district: 'D1', hat: false }), null);
  assert.match(getBlockReason(probe, { type: 'chooseDistrict', district: 'D7', hat: false }), /Your worker is on W1, which gives Gather Gunpowder or Lobby Congress, not Gather Wood/);
  assert.equal(getBlockReason(probe, { type: 'chooseDistrict', district: 'D2', hat: false }), null, 'W1 also gives Lobby Congress');
  assert.match(getBlockReason(probe, { type: 'chooseDistrict', district: 'none', hat: false }), /You must take a district action/);

  // Next turn the same hat was held at the start, so it can be spent.
  placeAndChoose(state, 'W1', 'D1'); // Anna gathers and may be offered a bonus
  drive(
    state,
    (s) => s.turn.player !== 0 || topFrame(s).kind !== 'workerStep',
    (actions) => actions.find((a) => a.type === 'skipBonusAction') ?? actions[0],
  );
  assert.equal(state.turn.hatsAtStart, 1);
  act(state, { type: 'placeWorker', space: 'W8' });
  assert.deepEqual(getValidActions(state).map((a) => [a.district, a.hat]), [['D4', false], ['D4', true], ['D7', false], ['D7', true]]);
  assert.deepEqual(previewMultipliers(state).filter((m) => m.district === 'D7').map((m) => [m.hat, m.multiplier]), [[false, 1], [true, 2]]);
  const wood = anna.resources.wood;
  const events = act(state, { type: 'chooseDistrict', district: 'D7', hat: true });
  assert.equal(gathered(events).multiplier, 2);
  assert.equal(anna.resources.wood, wood + 2);
  assert.equal(anna.hats, 0);
});

suite.check('R8.5.4: storage overflow is discarded at once, by choice, before the bonus action', () => {
  const state = start(2, { production: 'wood' });
  const anna = state.players[0];
  anna.resources = { iron: 4, wood: 2, gunpowder: 2 }; // 8 of 9
  placeAndChoose(state, 'W8', 'D7'); // Gather Wood: +2 at production 2
  assert.equal(storageUsed(anna), 10);
  assert.equal(topFrame(state).kind, 'discard');
  assert.equal(state.toAct, 0);
  assert.deepEqual(getValidActions(state).map((a) => a.item), ['iron', 'wood', 'gunpowder'], 'only what is held can be discarded');
  assert.match(getBlockReason(state, { type: 'discard', item: 'tunnel' }), /You have no built Tunnel tile to discard/);
  assert.match(describeDecision(state).prompt, /Anna: discard 1 item from storage \(you hold 10 of 9\)/);
  act(state, { type: 'discard', item: 'iron' });
  assert.equal(storageUsed(anna), 9);
  assert.equal(anna.resources.iron, 3);
  // Only now does the bonus action of Gather Wood come up (R7.1).
  assert.equal(topFrame(state).kind, 'bonusAction');
  assert.match(getBlockReason(state, { type: 'discard', item: 'iron' }), /You may discard only when your storage is over capacity, and you hold 9 of 9/);
});

suite.check('R8.5.4: an overflow on somebody else\'s turn is that player\'s own decision', () => {
  const state = start(3);
  const ben = state.players[1];
  put(state, 1, 'W1');
  put(state, 1, 'W3');
  ben.hats = 2;
  ben.resources = { iron: 3, wood: 3, gunpowder: 3 }; // 9 of 9
  ben.builtTiles.bridge = 0;
  act(state, { type: 'displaceWorker', district: 'D1' });
  assert.equal(state.turn.player, 0);
  assert.equal(state.toAct, 1);
  assert.equal(topFrame(state).remaining, 2, 'two hats owed at the limit: two resources of choice');
  act(state, { type: 'chooseResource', resource: 'iron' });
  assert.equal(topFrame(state).kind, 'discard', 'the overflow is settled before the second resource');
  assert.equal(state.toAct, 1);
  act(state, { type: 'discard', item: 'wood' });
  assert.equal(topFrame(state).kind, 'chooseResource');
  act(state, { type: 'chooseResource', resource: 'iron' });
  const last = act(state, { type: 'discard', item: 'wood' });
  assert.deepEqual(ben.resources, { iron: 5, wood: 1, gunpowder: 3 });
  assert.equal(storageUsed(ben), storageCapacity(state, 1));
  assert.equal(gathered(last).player, 0, 'and play returns to the active player, who takes the district action');
});

suite.check('R7.4, R8.6: hiring fills slots in order, respects the supply, and follows hireCostModel', () => {
  const K = RULES;
  const expected = {
    'fee-plus-table': { coins: 1 + 1, wood: 1 },
    'fee-only': { coins: 1 },
    'table-only': { coins: 1, wood: 1 },
  };
  for (const model of Object.keys(expected)) {
    const state = start(2, { variants: { hireCostModel: model } });
    const fee = model === 'table-only' ? {} : K.BONUS_ACTIONS.hire.cost;
    const table = model === 'fee-only' ? {} : K.TRAIN.hireCosts.engineer[0];
    const price = hireCost(state, 0, 'engineer', 'bonusAction');
    assert.deepEqual([price.fee, price.table, price.level], [fee, table, 1], model);
    assert.deepEqual(price.cost, expected[model], model);
    assert.deepEqual(hireCost(state, 0, 'engineer', 'free').cost, {}, 'R8.6.4');
    assert.deepEqual(hireCost(state, 0, 'engineer', 'table').cost, K.TRAIN.hireCosts.engineer[0]);
  }

  const state = start(2);
  const anna = state.players[0];
  anna.coins = 20;
  anna.resources = { iron: 1, wood: 3, gunpowder: 3 };
  state.supply.specialists.miner = 0;
  placeAndChoose(state, 'W2', 'D3'); // Gather Iron -> Hire Specialist
  assert.match(getBlockReason(state, { type: 'hireSpecialist', specialist: 'miner' }), /No Miner tiles are left in the supply \(all 12 are in trains\)/);
  assert.match(getBlockReason(state, { type: 'hireSpecialist', specialist: 'cook' }), /not a specialist type/);
  act(state, { type: 'hireSpecialist', specialist: 'engineer' });
  assert.deepEqual(anna.train.specialistCarriages[0].slots, ['crew', 'engineer']);
  assert.equal(nextSpecialistSlot(anna), null);
  assert.equal(hireCost(state, 0, 'crew', 'bonusAction'), null);

  // With every slot full the bonus action cannot be taken (R7.7, R8.6.1).
  const full = start(2);
  full.players[0].train.specialistCarriages[0].slots = ['crew', 'miner'];
  full.players[0].coins = 20;
  const probe = cloneState(full);
  probe.stack.pop();
  probe.stack.push({ kind: 'bonusAction', player: 0, bonus: 'hire', remaining: 1 });
  assert.match(getBlockReason(probe, { type: 'hireSpecialist', specialist: 'crew' }), /Every specialist slot in your train is full \(2 of 2\): add a specialist carriage before you hire/);
  // A level 2 carriage costs more (R8.6.3).
  probe.players[0].train.specialistCarriages.push({ slots: [null, null] });
  assert.equal(hireCost(probe, 0, 'crew', 'bonusAction').level, 2);
  assert.deepEqual(hireCost(probe, 0, 'crew', 'table').cost, K.TRAIN.hireCosts.crew[1]);
});

suite.check('R7.1, R7.2: a bonus action only at its own district, once-per-game marks it used', () => {
  const state = start(2);
  assert.match(getBlockReason(state, { type: 'buyHat' }), /Buy Hat can be taken only as the last part of a Gather action at the district that prints it/);
  placeAndChoose(state, 'W12', 'D9'); // Gather Coins -> Add Carriage
  assert.match(getBlockReason(state, { type: 'buyHat' }), /Buy Hat can be taken only as the last part of a Gather action/);
  assert.match(getBlockReason(state, { type: 'hireSpecialist', specialist: 'crew' }), /can be taken only as the last part/);
  assert.equal(getBlockReason(state, { type: 'skipBonusAction' }), null);
  act(state, { type: 'skipBonusAction' });
  assert.equal(state.turn.player, 1);

  const once = start(2, { variants: { bonusActionLimit: 'once-per-game' } });
  once.players[0].resources.wood = 5;
  placeAndChoose(once, 'W12', 'D9');
  act(once, { type: 'addCarriage', carriage: 'storage' });
  assert.equal(once.players[0].bonusActionsUsed.carriage, true);
  assert.match(getBlockReason(once, { type: 'addCarriage', carriage: 'storage', player: 0 }), /You have already taken Add Carriage this game/);
  // Gather Gunpowder prints Carriage Upgrade, which belongs to the carriage upgrades module (R7.3): off, no bonus is offered.
  const upgrade = start(2, { variants: { moduleCarriageUpgrades: false } });
  placeAndChoose(upgrade, 'W1', 'D1');
  assert.equal(upgrade.turn.player, 1);
  // On, the bonus is on offer (the engine skips it by itself only when no tile can be installed).
  const withUpgrades = start(2);
  withUpgrades.players[0].resources.iron = 3;
  placeAndChoose(withUpgrades, 'W1', 'D1');
  assert.equal(topFrame(withUpgrades).kind, 'bonusAction');
  assert.equal(topFrame(withUpgrades).bonus, 'upgrade');
});

suite.check('R19.3, R19.5: claimed routes trigger the end, and the round is played out', () => {
  const claim = (state, count) => {
    MAP.routeIds.slice(0, count).forEach((id) => {
      state.map.routeOwner[id] = 0;
    });
  };
  const playTurn = (state) => {
    const turn = state.turn.number;
    drive(state, (s) => s.turn.number === turn);
  };
  // Triggered on the start player's turn: everybody else still gets a turn.
  const a = start(3);
  claim(a, a.variants.endRoutesPerPlayer * 3);
  playTurn(a);
  assert.deepEqual(a.gameEnd, { reason: 'routes-claimed', triggeredBy: 0, triggeredOnTurn: 1 });
  assert.equal(isGameOver(a), false);
  playTurn(a);
  assert.equal(isGameOver(a), false);
  playTurn(a);
  assert.equal(isGameOver(a), true);
  assert.deepEqual(a.players.map((p) => p.turnsTaken), [1, 1, 1]);
  assert.equal(scoreGame(a).endReason, 'routes-claimed');

  // One route short: no trigger.
  const b = start(3);
  claim(b, b.variants.endRoutesPerPlayer * 3 - 1);
  playTurn(b);
  assert.equal(b.gameEnd, null);

  // Triggered on the last seat's own turn: the game ends when that turn ends.
  const c = start(2);
  playTurn(c);
  claim(c, c.variants.endRoutesPerPlayer * 2);
  playTurn(c);
  assert.equal(isGameOver(c), true);
  assert.deepEqual(c.gameEnd, { reason: 'routes-claimed', triggeredBy: 1, triggeredOnTurn: 2 });

  // Value 0 switches the trigger off.
  const d = start(2, { variants: { endRoutesPerPlayer: 0, maxTurnsPerPlayer: 3 } });
  claim(d, 40);
  playTurn(d);
  assert.equal(d.gameEnd, null);
});

suite.check('R20: VP by source, final scoring from the building table, and the tie-breaks in order', () => {
  const state = start(4, { variants: { maxTurnsPerPlayer: 1 } });
  const inland = MAP.inlandCities;
  // Ben has 3 buildings, Cara 1; nobody else has any.
  state.map.railwayStation[inland[0]] = 1;
  state.map.telegraphStation[inland[0]] = 1;
  state.map.railwayStation[inland[1]] = 1;
  state.map.telegraphStation[inland[2]] = 2;
  addVp(state, 0, 'track', buildingTableVp(state, 3), 'test'); // Anna ties Ben on VP
  assert.throws(() => addVp(state, 0, 'goals', 5, 'test'), /VP source "goals" is not in play/);

  // Mid-game, scoreGame projects the final sources without changing the state.
  const before = JSON.stringify(state);
  const projected = scoreGame(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(projected.final, false);
  assert.equal(projected.winner, null);
  assert.equal(projected.players[1].bySource.buildingsEnd, buildingTableVp(state, 3));
  assert.equal(state.players[1].vp.buildingsEnd, 0, 'nothing is written before the game ends');

  drive(state, () => true);
  const score = scoreGame(state);
  assert.equal(score.final, true);
  assert.equal(score.endReason, 'turn-limit');
  assert.equal(score.players[1].bySource.buildingsEnd, RULES.SCORING.buildingTable.rising[3]);
  assert.equal(score.players[2].bySource.buildingsEnd, RULES.SCORING.buildingTable.rising[1]);
  assert.equal(state.players[1].vp.buildingsEnd, RULES.SCORING.buildingTable.rising[3], 'final scoring is written into player.vp');
  assert.equal(score.players[0].total, score.players[1].total);
  // R20.5.1: tied on VP, Ben has more buildings.
  assert.deepEqual(score.ranking.slice(0, 2), [1, 0]);
  assert.equal(score.decidedBy, 'buildings');
  assert.equal(score.winner, 1);
  assert.deepEqual(score.players.map((p) => p.rank).sort(), [1, 2, 3, 4]);
  for (const p of score.players) assert.deepEqual(Object.keys(p.bySource), Object.keys(state.players[p.id].vp));

  // The other curve is read from the variant.
  const curve = start(2, { variants: { buildingScoreCurve: '2018' } });
  assert.equal(buildingTableVp(curve, 15), RULES.SCORING.buildingTable['2018'][15]);
  assert.notEqual(buildingTableVp(curve, 15), buildingTableVp(state, 15));
  assert.equal(buildingTableVp(curve, 99), RULES.SCORING.buildingTable['2018'][18], 'never past the end of the table');
});

suite.check('R20.5: the later tie-break steps - owned slots, then cargo, then turn order', () => {
  const tied = () => start(3, { variants: { maxTurnsPerPlayer: 1 } });
  const finish = (state) => {
    drive(state, () => true);
    return scoreGame(state);
  };
  // R20.5.2 - most slots in owned routes.
  const a = tied();
  a.map.routeOwner[MAP.routeIds[0]] = 2;
  const sa = finish(a);
  assert.equal(sa.winner, 2);
  assert.equal(sa.decidedBy, 'ownedSlots');
  assert.equal(sa.players[2].tieBreak.ownedSlots, MAP.routes[0].length);
  // R20.5.3 - most cargo.
  const b = tied();
  b.players[1].builtTiles.bridge = 4;
  const sb = finish(b);
  assert.equal(sb.winner, 1);
  assert.equal(sb.decidedBy, 'cargo');
  // R20.5.4 - closest to the start player.
  const c = tied();
  const sc = finish(c);
  const cargoes = sc.players.map((p) => p.tieBreak.cargo);
  if (cargoes.every((x) => x === cargoes[0])) {
    assert.equal(sc.decidedBy, 'turnOrder');
    assert.equal(sc.winner, 0);
  }
  assert.deepEqual(sc.players.map((p) => p.tieBreak.turnOrder), [0, 1, 2]);
});

suite.check('getStructuralBlockReason answers "could I, if it were my move?" and leaves timing aside', () => {
  const state = start(3);
  // It is Anna's worker step. Hiring belongs to a later moment of a Gather Iron action.
  const crew = { type: 'hireSpecialist', specialist: 'crew' };
  const financier = { type: 'hireSpecialist', specialist: 'financier' };
  assert.match(getBlockReason(state, crew), /can be taken only as the last part of a Gather action/);
  assert.equal(getStructuralBlockReason(state, crew), null, 'she could afford a Crew');
  assert.match(getStructuralBlockReason(state, financier), /costs 2 Coins \+ 1 Iron and you have 1 Coin/);
  // For a player whose decision it is not.
  const ben = { type: 'placeWorker', space: 'W1', player: 1 };
  assert.match(getBlockReason(state, ben), /It is Anna's decision/);
  assert.equal(getStructuralBlockReason(state, ben), null);
  assert.equal(getStructuralBlockReason(state, { type: 'placeWorker', space: 'W4', player: 1 }), null, 'W4 also gives Lobby Congress');
  assert.match(getStructuralBlockReason(state, { type: 'placeWorker', space: 'W99', player: 1 }), /not a worker space/);
  // Asking changes nothing, and the ordinary question still includes timing afterwards.
  assert.match(getBlockReason(state, crew), /can be taken only as the last part/);
});

suite.check('R8.5.4 with R14.1: a gain of resources and a hat settles the overflow before the hat\'s choice', () => {
  const state = start(3);
  const ben = state.players[1];
  ben.hats = RULES.HATS.hatLimit;
  ben.resources = { iron: 3, wood: 3, gunpowder: 2 }; // 8 of 9
  gainItems(state, 1, { gunpowder: 2, hats: 1 }, 'test');
  assert.equal(storageUsed(ben), 10);
  assert.deepEqual([topFrame(state).kind, state.toAct], ['discard', 1], 'the discard comes first');
  act(state, { type: 'discard', item: 'iron' });
  assert.deepEqual([topFrame(state).kind, state.toAct], ['chooseResource', 1], 'then the resource taken in place of the hat');
  act(state, { type: 'chooseResource', resource: 'wood' });
  assert.equal(topFrame(state).kind, 'discard', 'which overflows again');
  act(state, { type: 'discard', item: 'iron' });
  assert.deepEqual(ben.resources, { iron: 1, wood: 4, gunpowder: 4 });
  assert.equal(ben.hats, RULES.HATS.hatLimit);
  assert.equal(state.toAct, 0, 'and the decision returns to the active player');
});

suite.check('constants reach the rules: a higher hat limit, a bigger storage carriage', () => {
  const state = start(2, { constants: { HATS: { hatLimit: 4 }, TRAIN: { storagePerCarriage: 12 } } });
  assert.equal(getConstants(state).HATS.hatLimit, 4);
  assert.equal(storageCapacity(state, 0), 12);
  state.players[0].hats = 2;
  placeAndChoose(state, 'W8', 'D7');
  assert.equal(getBlockReason(state, { type: 'buyHat' }), null, 'two hats is no longer the limit');
  act(state, { type: 'buyHat' });
  assert.equal(state.players[0].hats, 3);
});

suite.finish();
