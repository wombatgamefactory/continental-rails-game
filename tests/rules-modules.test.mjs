// rules-modules.test.mjs - the four add-on modules, one or more behavioural
// checks for every card effect type, every trigger, every upgrade tile, every
// goal and milestone metric.
//
// Semantics: permanently green; exits 1 on any failure.
//
//   R15            carriage upgrades: the display, the bonus action, the level rule,
//                  the upgrade step, per-tile VP at the end, upgradeVpTiming
//   R16            milestones and goals: metrics, claiming, placement, ties, 2 players
//   R17            the 20 Legislative Agenda cards
//   R18            Pony Express: tokens, the market, buying, the 38 cards, the cap
//   R4.4, R14.2    the free-action opportunities
//   R22 E2, E5     the worked examples that involve a module
//   "off means absent" for each module
//
// Expected numbers are read from rules.js. A state is built with createGame (via
// tests/helpers/modules.mjs, which switches every module off first) and
// adjusted by hand; the action under test always goes through applyAction.

import assert from 'node:assert/strict';
import {
  getValidActions,
  getBlockReason,
  getStructuralBlockReason,
  getActionSpace,
  scoreGame,
  topFrame,
  production,
  describeProgress,
  describeAction,
  describeDecision,
  evaluateCondition,
  metricValue,
  goalStandings,
  goalsInPlay,
  finalSourceValues,
  determinise,
  hiddenDecks,
  cloneState,
  hashState,
  ownedSlots,
  RULES,
  MAP,
  SPACE_IDS,
  SPACE_DISTRICTS,
  STOP_ACTION_TYPES,
  ACTIONS,
  EFFECT_HANDLERS,
  STANDING_EFFECT_TYPES,
} from '../src/engine/index.js';
import { makeSuite, drive } from './helpers/play.mjs';
import { makeRng } from '../src/engine/index.js';
import {
  startWith,
  UPGRADES,
  MILESTONES,
  GOALS,
  PONY,
  legislative,
  ALL_ON,
  kind,
  keys,
  giveTokens,
  stock,
  ownCard,
  installTile,
  gatherCoinsTurn,
  gatherTurn,
  vpOf,
  maybeTake,
  put,
  act,
  take,
  give,
  setTrain,
  setHeads,
  claim,
  placeAndChoose,
  types,
} from './helpers/modules.mjs';
import { eventOf, eventsOf, choose } from './helpers/rig.mjs';
import { setActObserver } from './helpers/rig.mjs';

const takenTypes = new Set();
const emittedTypes = new Set();
setActObserver((action, events) => {
  takenTypes.add(action.type);
  for (const e of events) {
    emittedTypes.add(e.type);
    if (e.type === 'action') takenTypes.add(e.action.type);
  }
});

const suite = makeSuite('rules-modules');
const K = RULES;

// Coverage of the effect handlers by THIS suite: every handler is wrapped (the engine looks a handler up by name every
// time it runs one), and at the end the suite asserts that each effect type ran, and that the effect of every
// Legislative Agenda card and of every Pony Express card that has a trigger or a one-off effect ran at least once.
const ran = { types: new Set(), causes: new Set() };
for (const type of Object.keys(EFFECT_HANDLERS)) {
  const original = EFFECT_HANDLERS[type];
  EFFECT_HANDLERS[type] = function wrapped(state, playerId, effect, ctx) {
    ran.types.add(type);
    if (ctx && ctx.cause) ran.causes.add(ctx.cause);
    return original(state, playerId, effect, ctx);
  };
}

/** A worker space that borders `district` (and another district), for taking that district's action. */
function spaceFor(district) {
  return SPACE_IDS.find((w) => SPACE_DISTRICTS[w].includes(district));
}

/** A fresh upgrades game; Anna's train is `carriages` ([[slot1, slot2], ...]); she holds exactly `resources` and `coins`. */
function upgradeGame(carriages, resources = {}, extra = {}) {
  const state = startWith(2, { ...UPGRADES, ...extra });
  setTrain(state, 0, carriages);
  give(state, 0, { resources, coins: 0 });
  return state;
}

/** Anna takes a district's action alone (M = 1) and everything the engine asks is answered by `answer`; returns all events. */
function activate(state, district, answer = null) {
  const events = placeAndChoose(state, spaceFor(district), district);
  let guard = 0;
  while (state.turn.number === 1 && guard++ < 50) {
    const a = answer ? answer(state, getValidActions(state)) : null;
    events.push(...act(state, a ?? getValidActions(state)[0]));
  }
  return events;
}
/** An answer policy: use every step you can, skip the rest, never take Congress entries. */
const USE_ALL = (state, actions) =>
  actions.find((a) => a.type === 'useStep') ?? actions.find((a) => a.type === 'closeCongress') ?? actions.find((a) => a.type === 'skipStep') ?? null;

// =====================================================================================
// R15 - carriage upgrades
// =====================================================================================

suite.check('R3.8.1, R15.1: all 16 tiles are on display at setup; with the module off nothing of it exists', () => {
  const on = startWith(3, UPGRADES);
  assert.deepEqual(on.modules.upgrades.display, K.UPGRADE_TILES.map((t) => t.id));
  assert.equal(on.modules.upgrades.installed.length, 3);
  assert.ok(on.modules.upgrades.installed.every((slots) => slots.length === K.TRAIN.maxSpecialistCarriages && slots.every((t) => t === null)));
  for (const p of on.players) {
    assert.equal(p.vp.upgrades, 0);
    assert.equal(p.bonusActionsUsed.upgrade, false);
  }
  const off = startWith(3);
  assert.deepEqual(off.modules, {});
  for (const p of off.players) {
    assert.ok(!('upgrades' in p.vp) && !('upgrade' in p.bonusActionsUsed));
  }
  // The bonus action does not exist: Gather Gunpowder prints it, and nothing is offered after it.
  placeAndChoose(off, 'W1', 'D1');
  assert.equal(off.turn.player, 1);
  assert.equal(getBlockReason(off, { type: 'installUpgrade', tile: 'U1-vp', level: 1, player: 0 }), 'Carriage upgrades are not in play in this game.');
  assert.deepEqual(getActionSpace(off).filter((a) => a.type === 'installUpgrade'), []);
});

suite.check('R7.3, R15.3: the install conditions, each with its own sentence', () => {
  const state = startWith(2, UPGRADES);
  setTrain(state, 0, [['miner', null]]);
  give(state, 0, { resources: { iron: 3 } });
  placeAndChoose(state, 'W1', 'D1'); // Gather Gunpowder: the Carriage Upgrade bonus action
  assert.equal(kind(state), 'bonusAction');
  const why = (tile, level) => getBlockReason(state, { type: 'installUpgrade', tile, level });
  assert.equal(why('U1-wood', 1), null);
  assert.match(why('U2-vp', 1), /Advanced Engine is a level 2 tile and fits only a level 2 carriage or higher; this carriage is level 1/);
  assert.match(why('U1-wood', 2), /You have 1 specialist carriage, so there is no level 2 carriage/);
  assert.match(why('nonsense', 1), /is not one of the upgrade tiles/);
  assert.match(why('U1-wood', 4), /carriage level is a whole number from 1 to 3/);
  setTrain(state, 0, [[null, null]]);
  assert.match(why('U1-wood', 1), /level 1 carriage holds no specialist/);
  setTrain(state, 0, [['miner', null]]);
  state.players[0].resources.iron = 0;
  assert.match(why('U1-wood', 1), /Carriage Upgrade costs 1 Iron and you have 0 Iron/);
  state.players[0].resources.iron = 3;
  state.modules.upgrades.display.splice(state.modules.upgrades.display.indexOf('U1-wood'), 1);
  assert.match(why('U1-wood', 1), /has already been taken from the display/);
  installTile(state, 0, 1, 'U1-iron');
  assert.match(why('U1-coin', 1), /level 1 carriage already carries Iron Supply/);
  // Not at the right moment: asked structurally, with no bonus action pending.
  const quiet = startWith(2, UPGRADES);
  setTrain(quiet, 0, [['miner', null]]);
  assert.equal(getStructuralBlockReason(quiet, { type: 'installUpgrade', tile: 'U1-wood', level: 1 }), null);
  assert.match(getBlockReason(quiet, { type: 'installUpgrade', tile: 'U1-wood', level: 1 }), /only as the last part of a Gather action/);
});

suite.check('R15.3.3: a tile of level L fits a carriage of level L or higher, for every tile and every carriage', () => {
  const state = startWith(2, UPGRADES);
  setTrain(state, 0, [['crew', null], ['crew', null], ['crew', null]]);
  give(state, 0, { resources: { iron: 5 } });
  for (const tile of K.UPGRADE_TILES) {
    for (const level of [1, 2, 3]) {
      const reason = getStructuralBlockReason(state, { type: 'installUpgrade', tile: tile.id, level });
      if (tile.level <= level) assert.equal(reason, null, `${tile.id} should fit the level ${level} carriage`);
      else assert.match(reason, /fits only a level/, `${tile.id} must not fit the level ${level} carriage`);
    }
  }
});

suite.check('R7.3, R15.4: installing pays 1 Iron, takes the tile from the display for good, and has no immediate effect', () => {
  const state = startWith(2, UPGRADES);
  setTrain(state, 0, [['miner', null]]);
  give(state, 0, { resources: { iron: 2 }, coins: 0 });
  const vpBefore = state.players[0].vp.upgrades;
  placeAndChoose(state, 'W1', 'D1');
  assert.ok(keys(state).includes('installUpgrade:U1-gunpowder:1'));
  assert.ok(!keys(state).some((k) => k.endsWith(':2') || k.endsWith(':3')), 'only the level 1 carriage exists');
  const events = act(state, { type: 'installUpgrade', tile: 'U1-gunpowder', level: 1 });
  assert.equal(state.players[0].resources.iron, 1);
  assert.equal(state.modules.upgrades.installed[0][0], 'U1-gunpowder');
  assert.ok(!state.modules.upgrades.display.includes('U1-gunpowder'));
  assert.equal(state.modules.upgrades.display.length, K.UPGRADE_TILES.length - 1);
  const e = eventOf(events, 'upgradeInstalled');
  assert.deepEqual([e.player, e.tile, e.level], [0, 'U1-gunpowder', 1]);
  assert.equal(state.players[0].vp.upgrades, vpBefore);
  assert.equal(state.turn.player, 1);
  // The tile is gone for everybody (R15.4: first come, first served).
  assert.match(getBlockReason(state, { type: 'installUpgrade', tile: 'U1-gunpowder', level: 1, player: 1 }), /already been taken|only as the last part/);
});

suite.check('R7.7: with no tile and carriage that fit, or no Iron, the bonus action is skipped by the engine', () => {
  const state = startWith(2, UPGRADES);
  setTrain(state, 0, [[null, null]]); // no specialist anywhere: nothing can be installed
  give(state, 0, { resources: { iron: 3 } });
  placeAndChoose(state, 'W1', 'D1');
  assert.equal(state.turn.player, 1, 'no legal install: the bonus action is skipped by the engine');
});

suite.check('R7.2: bonusActionLimit once-per-game marks the Carriage Upgrade used', () => {
  const state = startWith(2, { ...UPGRADES, bonusActionLimit: 'once-per-game' });
  setTrain(state, 0, [['crew', 'crew']]);
  give(state, 0, { resources: { iron: 3 } });
  placeAndChoose(state, 'W1', 'D1');
  act(state, { type: 'installUpgrade', tile: 'U1-wood', level: 1 });
  assert.equal(state.players[0].bonusActionsUsed.upgrade, true);
  assert.match(getBlockReason(state, { type: 'installUpgrade', tile: 'U1-coin', level: 1, player: 0 }), /already taken Carriage Upgrade this game/);
});

// --- what each tile does at its step -------------------------------------------------------

const GAINS = {
  'U1-wood': ['wood', 1],
  'U1-iron': ['iron', 1],
  'U1-gunpowder': ['gunpowder', 1],
  'U1-coin': ['coins', 1],
};

suite.check('R15.2, R15.5.1: every tile does its effect at its step, in every activation, for its owner', () => {
  for (const tile of K.UPGRADE_TILES) {
    const carriages = [['crew', null], ['crew', null], ['crew', null]].slice(0, tile.level);
    const state = upgradeGame(carriages);
    installTile(state, 0, tile.level, tile.id);
    const hats = state.players[0].hats;
    const before = JSON.parse(JSON.stringify({ r: state.players[0].resources, c: state.players[0].coins, t: state.players[0].builtTiles }));
    const events = activate(state, 'D4', USE_ALL); // Ground Tracks; no Iron, so every Crew step is a forced skip
    const steps = eventsOf(events, 'upgradeStep');
    const p = state.players[0];
    if (tile.effects[0].type === 'vpPerBuilt') {
      // Worked out at the end of the activation from what was BUILT: nothing was built here.
      assert.equal(steps.length, 1, `${tile.id}: the step is in the list`);
      assert.equal(p.vp.upgrades, 0, `${tile.id}: nothing built, nothing scored`);
      continue;
    }
    assert.equal(steps.length, 1, `${tile.id}: one upgrade step per activation`);
    assert.equal(steps[0].tile, tile.id);
    const effect = tile.effects[0];
    if (effect.type === 'vp') {
      assert.equal(p.vp.upgrades, effect.amount, `${tile.id}: VP`);
      assert.deepEqual(vpOf(events, 0), { upgrades: effect.amount }, `${tile.id}: booked to the upgrades source and nothing else`);
    } else if (effect.type === 'gain' && effect.items.hats) {
      assert.equal(p.hats, hats + effect.items.hats, `${tile.id}: hat`);
      assert.equal(p.vp.upgrades, 0);
    } else if (effect.type === 'gain') {
      const [key, n] = GAINS[tile.id];
      const had = key === 'coins' ? before.c : before.r[key];
      assert.equal(key === 'coins' ? p.coins : p.resources[key], had + n, `${tile.id}: ${key}`);
      assert.equal(p.vp.upgrades, 0);
    } else if (effect.type === 'gainBuiltTile') {
      assert.equal(p.builtTiles[effect.terrain], before.t[effect.terrain] + effect.count, `${tile.id}: built ${effect.terrain}`);
      const gain = eventsOf(events, 'gain').find((e) => e.cause === `upgrade:${tile.id}`);
      assert.equal(gain.built, true, 'a BUILT tile goes to storage, never onto the map');
    }
  }
});

suite.check('R15.5.2: a per-tile tile scores 1 VP for each tile of its type BUILT in the activation, and only those', () => {
  const cases = [
    ['U2-ground', 'D4', { iron: 2 }, 'ground'],
    ['U2-tunnel', 'D8', { gunpowder: 2 }, 'tunnel'],
    ['U2-bridge', 'D6', { wood: 2 }, 'bridge'],
  ];
  for (const [id, district, resources, terrain] of cases) {
    const state = upgradeGame([['crew', null], ['crew', null]], resources);
    installTile(state, 0, 2, id);
    const events = activate(state, district, USE_ALL);
    assert.equal(state.players[0].builtTiles[terrain], 1, `${id}: the Foreman built one`);
    assert.deepEqual(vpOf(events, 0), { upgrades: 1 }, `${id}: 1 VP per ${terrain} built`);
  }
  // A tile of another type does not score: Ground built at Ground Tracks, the Bridge tile is silent.
  const other = upgradeGame([['crew', null], ['crew', null]], { iron: 2 });
  installTile(other, 0, 2, 'U2-bridge');
  activate(other, 'D4', USE_ALL);
  assert.equal(other.players[0].vp.upgrades, 0);
  // Tiles gained from another upgrade tile do not count (R15.5.2): U3-ground gives a Ground tile, U2-ground still scores 1.
  const gained = upgradeGame([['crew', null], ['crew', null], ['crew', null]], { iron: 2 });
  installTile(gained, 0, 2, 'U2-ground');
  installTile(gained, 0, 3, 'U3-ground');
  activate(gained, 'D4', USE_ALL);
  assert.equal(gained.players[0].builtTiles.ground, 2, 'one built by the Foreman, one gained from U3-ground');
  assert.equal(gained.players[0].vp.upgrades, 1, 'only the tile the Foreman BUILT scores');
});

suite.check('R9.4.2, R15.5: the tile step sits before its carriage, once per activation however often the Foreman acts', () => {
  const state = upgradeGame([['crew', null]], { iron: 4 });
  installTile(state, 0, 1, 'U1-iron');
  put(state, 0, 'W5'); // between Ground Tracks (D4)? any adjacent worker raises M: use W6, which borders D4 and D5
  state.grid.spaces.W5 = null;
  state.players[0].workersInSupply += 1;
  const next = SPACE_IDS.filter((w) => SPACE_DISTRICTS[w].includes('D4'));
  put(state, 0, next[0]);
  placeAndChoose(state, next[1], 'D4'); // one worker already adjacent: M = 2
  const frame = topFrame(state);
  assert.deepEqual(
    frame.steps.map((s) => (s.type === 'upgrade' ? 'tile' : s.level === 0 ? 'foreman' : `${s.type}${s.level}`)),
    ['crew', 'crew', 'tile', 'crew1'].map((x) => (x === 'crew' ? 'foreman' : x)),
    'Foreman twice (M = 2), the tile once, then the level 1 specialist',
  );
  assert.equal(frame.steps[0].type, 'crew');
});

suite.check('R15.6: upgradeVpTiming = on-install scores the three VP tiles once, at installation, and not in activations', () => {
  const state = startWith(2, { ...UPGRADES, upgradeVpTiming: 'on-install' });
  setTrain(state, 0, [['crew', null]]);
  give(state, 0, { resources: { iron: 1 }, coins: 0 });
  placeAndChoose(state, 'W1', 'D1');
  const events = act(state, { type: 'installUpgrade', tile: 'U1-vp', level: 1 });
  assert.deepEqual(vpOf(events, 0), { upgrades: 2 }, 'scored at once, to the upgrades source');
  assert.equal(state.players[0].vp.upgrades, 2);
  // Ben takes a turn, then Anna: the tile adds no step and no VP in an activation.
  gatherCoinsTurn(state);
  assert.equal(state.turn.player, 0);
  give(state, 0, { resources: { iron: 4 } }); // a Crew step that can be paid is a real decision, so the activation stays pending
  placeAndChoose(state, spaceFor('D4'), 'D4');
  const frame = topFrame(state);
  assert.ok(!frame.steps.some((s) => s.type === 'upgrade'), 'the VP tile has no step');
  drive(state, (s) => s.turn.player === 0, (actions) => actions.find((a) => a.type === 'skipStep') ?? actions.find((a) => a.type === 'closeCongress') ?? actions[0]);
  assert.equal(state.players[0].vp.upgrades, 2, 'not scored again');
  // The other 13 tiles are not affected: U1-wood still gives its Wood at its step.
  const other = startWith(2, { ...UPGRADES, upgradeVpTiming: 'on-install' });
  setTrain(other, 0, [['crew', null]]);
  installTile(other, 0, 1, 'U1-wood');
  give(other, 0, { resources: { iron: 4 }, coins: 0 });
  placeAndChoose(other, spaceFor('D4'), 'D4');
  assert.ok(topFrame(other).steps.some((s) => s.type === 'upgrade'), 'U1-wood keeps its step');
});

suite.check('R15.2 U3-hat, R14.2: a hat gained from a tile cannot be spent in the turn it was gained', () => {
  const state = upgradeGame([['crew', null], ['crew', null], ['crew', null]]);
  installTile(state, 0, 3, 'U3-hat');
  activate(state, 'D4', USE_ALL);
  assert.equal(state.players[1].hats, 0);
  // Anna now holds a hat; it is spendable from her next turn.
  assert.equal(state.players[0].hats, 1);
});

suite.check('R22 E2: Carriage Upgrade at Gather Gunpowder with a hat and a Miner; the tile then works in every activation', () => {
  const state = startWith(2, UPGRADES);
  // Ben (seat 2): 1 hat, 2 Iron, a Miner in his level 1 carriage, a worker on W1.
  give(state, 1, { resources: { iron: 2 }, hats: 1, coins: 1 });
  setTrain(state, 1, [['miner', null]]);
  put(state, 1, 'W1');
  gatherCoinsTurn(state); // Anna's turn
  assert.equal(state.turn.player, 1);
  assert.equal(production(state, 1, 'gunpowder'), 1);
  const events = act(state, { type: 'removeWorker', from: 'W1' });
  void events;
  const chosen = act(state, { type: 'chooseDistrict', district: 'D1', hat: true });
  const gather = eventOf(chosen, 'gather');
  assert.equal(gather.multiplier, 2, 'M = 1 + 0 + 1');
  assert.equal(gather.amount, 2, 'yield 1 x 2');
  assert.equal(state.players[1].resources.gunpowder, 2);
  assert.equal(kind(state), 'bonusAction');
  act(state, { type: 'installUpgrade', tile: 'U1-gunpowder', level: 1 });
  assert.equal(state.players[1].resources.iron, 1, 'paid 1 Iron');
  assert.equal(state.modules.upgrades.installed[1][0], 'U1-gunpowder');
  assert.ok(!state.modules.upgrades.display.includes('U1-gunpowder'));
  // "From now on every one of his train activations gains 1 Gunpowder just before his level 1 specialists act."
  gatherCoinsTurn(state); // Ben's turn is over; Anna's turn
  assert.equal(state.turn.player, 1);
  placeAndChoose(state, spaceFor('D8'), 'D8'); // Ben: Tunnel Tracks, the Foreman acts as a Miner
  const stepTypes = topFrame(state).steps.map((s) => s.type);
  assert.deepEqual(stepTypes, ['miner', 'upgrade', 'miner'], 'Foreman, the tile, then the Miner');
});

suite.check('R22 E5 with its real upgrade tile: Eve builds 3 Bridge tiles and 1 Ground tile; nothing reaches the map', () => {
  const state = startWith(2, UPGRADES);
  setTrain(state, 0, [['engineer', 'crew'], ['engineer', null]]);
  installTile(state, 0, 1, 'U1-wood');
  give(state, 0, { resources: { wood: 5, iron: 2 }, coins: 0 });
  // One worker already on W10 (between Bridge Tracks and Gather Coins).
  assert.deepEqual(SPACE_DISTRICTS.W10, ['D6', 'D9']);
  put(state, 0, 'W10');
  assert.deepEqual(SPACE_DISTRICTS.W7, ['D5', 'D6']);
  placeAndChoose(state, 'W7', 'D6');
  const frame = topFrame(state);
  assert.equal(state.turn.multiplier, 2, 'M = 1 + 1');
  assert.deepEqual(
    frame.steps.map((s) => (s.level === 0 ? 'Foreman' : s.type === 'upgrade' ? 'tile' : `${s.type}${s.level}`)),
    ['Foreman', 'Foreman', 'tile', 'engineer1', 'crew1', 'engineer2', 'engineer2'],
  );
  const p = state.players[0];
  take(state, 'useStep'); // Foreman: 2 Wood -> 1 Bridge
  assert.deepEqual([p.resources.wood, p.builtTiles.bridge], [3, 1]);
  take(state, 'useStep'); // Foreman again (1 Wood, 2 Bridge) ...
  // ... and the tile step is not a decision: its Wood arrives by itself.
  assert.equal(frame.steps[frame.index].type, 'engineer');
  assert.deepEqual([p.resources.wood, p.resources.iron, p.builtTiles.bridge], [2, 2, 2], 'U1-wood gave 1 Wood (storage: 2 Wood, 2 Iron, 2 Bridge)');
  take(state, 'useStep'); // Engineer, level 1
  assert.deepEqual([p.resources.wood, p.builtTiles.bridge], [0, 3]);
  take(state, 'useStep'); // Crew, level 1: 2 Iron -> 1 Ground
  assert.deepEqual([p.resources.iron, p.builtTiles.ground], [0, 1]);
  // The level 2 Engineer has no Wood: both steps are skipped by the engine.
  assert.equal(state.turn.number, 2, 'the turn is over');
  assert.deepEqual({ ...p.builtTiles }, { ground: 1, tunnel: 0, bridge: 3 });
  assert.equal(Object.values(state.map.routeOwner).filter((o) => o !== null).length, 0, 'nothing has been put on the map');
  assert.equal(p.vp.upgrades, 0);
});

suite.check('R15: with upgrades off, goal 6 is not used and the upgrade slot is ignored', () => {
  const state = startWith(2, { endGameScoring: 'goals', goalsInPlay: 11 });
  assert.ok(!state.modules.goals.inPlay.includes('G6'));
  assert.equal(state.modules.goals.inPlay.length, 11);
  const withModule = startWith(2, { ...UPGRADES, endGameScoring: 'goals', goalsInPlay: 12 });
  assert.ok(withModule.modules.goals.inPlay.includes('G6'));
});

// =====================================================================================
// R16 - milestones and goals
// =====================================================================================

/** Buildings by hand: `put<Kind>(state, player, city)`. The pieces on the player boards are not adjusted: these are scenery for the metrics. */
const rail = (state, p, city) => {
  state.map.railwayStation[city] = p;
};
const tele = (state, p, city) => {
  state.map.telegraphStation[city] = p;
};

/** Routes (any, in map order) whose slots of `terrain` add up to at least `n`, most first. */
function routesWith(terrain, n) {
  const picked = [];
  let sum = 0;
  for (const r of MAP.routes.slice().sort((a, b) => b.cost[terrain] - a.cost[terrain])) {
    if (sum >= n) break;
    picked.push(r.id);
    sum += r.cost[terrain];
  }
  assert.ok(sum >= n);
  return picked;
}

/** The shortest chain of routes (any owners) from city `a` to city `b`, as route ids. */
function chainBetween(a, b) {
  const prev = { [a]: null };
  const queue = [a];
  while (queue.length > 0) {
    const city = queue.shift();
    if (city === b) break;
    for (const id of MAP.cityRoutes[city]) {
      const r = MAP.routeById[id];
      const next = r.a === city ? r.b : r.a;
      if (next in prev) continue;
      prev[next] = { city, route: id };
      queue.push(next);
    }
  }
  const out = [];
  for (let c = b; prev[c] !== null; c = prev[c].city) out.unshift(prev[c].route);
  return out;
}

/** How to bring player 0 to the condition of each milestone by hand. */
const MILESTONE_SETUP = {
  MS1: (s) => {
    MAP.inlandCities.slice(0, 3).forEach((c) => rail(s, 0, c));
    MAP.inlandCities.slice(3, 5).forEach((c) => tele(s, 0, c));
  },
  MS2: (s) => claim(s, 0, ...routesWith('tunnel', 6)),
  MS3: (s) => claim(s, 0, ...routesWith('bridge', 6)),
  MS4: (s) => claim(s, 0, ...routesWith('ground', 6)),
  MS5: (s) => claim(s, 0, 'ELP-FTW'),
  MS6: (s) => claim(s, 0, ...MAP.routeIds.slice(0, 6)),
  MS7: (s) => {
    setHeads(s, 0, 'SEA', 'MIN');
    claim(s, 1, ...chainBetween('SEA', 'MIN')); // routes of ANY owner join them (R16.8 MS7)
  },
  MS8: (s) => setTrain(s, 0, [['crew', 'miner'], ['engineer', 'financier']]),
  MS9: (s) => {
    setTrain(s, 0, [['crew', null], [null, null], [null, null]]);
    s.players[0].train.storageCarriages = 2;
  },
  MS10: (s) => MAP.inlandCities.slice(0, 4).forEach((c) => tele(s, 0, c)),
};

suite.check('R3.8.2, R16.7: milestonesInPlay tiles are revealed at setup, the rest never exist; goals likewise', () => {
  for (const n of [1, 6, 10]) {
    const state = startWith(2, { ...MILESTONES, milestonesInPlay: n });
    assert.equal(state.modules.milestones.inPlay.length, n);
    assert.deepEqual(Object.keys(state.modules.milestones.claimedBy).sort(), state.modules.milestones.inPlay.slice().sort());
    assert.ok(Object.values(state.modules.milestones.claimedBy).every((c) => c === null));
    assert.equal(state.modules.goals, undefined, 'endGameScoring = milestones: no goals');
  }
  const different = new Set();
  for (let i = 0; i < 20; i++) different.add(startWith(2, { ...MILESTONES }, { seed: i }).modules.milestones.inPlay.join());
  assert.ok(different.size > 5, 'the milestones are drawn at random from the seed');
  for (const n of [1, 3, 12]) {
    const state = startWith(2, { ...GOALS, ...UPGRADES, goalsInPlay: n });
    assert.equal(state.modules.goals.inPlay.length, n);
    assert.equal(state.modules.milestones, undefined, 'endGameScoring = goals: no milestones');
  }
  const both = startWith(2, { endGameScoring: 'both' });
  assert.ok(both.modules.goals && both.modules.milestones);
  assert.equal(both.modules.goals.inPlay.length, 3);
  assert.equal(both.modules.milestones.inPlay.length, 6);
  const none = startWith(2, { endGameScoring: 'none' });
  assert.deepEqual(none.modules, {});
  for (const p of none.players) assert.ok(!('milestones' in p.vp) && !('goals' in p.vp));
});

suite.check('R16.8, R16.9: each of the ten milestones is claimed at the end of the turn by the player who meets it, for its VP', () => {
  for (const tile of K.MILESTONE_TILES) {
    const state = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
    assert.equal(describeProgress(state, 0, tile).met, false, `${tile.id}: not met on a fresh board`);
    MILESTONE_SETUP[tile.id](state);
    assert.equal(evaluateCondition(state, 0, tile.condition), true, `${tile.id}: the set-up meets the condition`);
    assert.equal(state.modules.milestones.claimedBy[tile.id], null, 'nothing is claimed in the middle of a turn');
    const events = gatherCoinsTurn(state);
    assert.equal(state.modules.milestones.claimedBy[tile.id], 0, `${tile.id}: claimed by Anna`);
    const claim = eventsOf(events, 'milestoneClaimed').find((e) => e.milestone === tile.id);
    assert.deepEqual([claim.player, claim.vp], [0, tile.vp]);
    assert.equal(vpOf(events, 0).milestones >= tile.vp, true);
    assert.equal(state.players[0].vp.milestones >= tile.vp, true);
    // Base sources hold base values only (R20.1): the claim touched no other source.
    assert.equal(state.players[0].vp.track, 0);
  }
});

suite.check('R16.8 MS7: the two starting cities joined by routes of any owner (here only Ben\'s) counts for Anna', () => {
  const state = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
  setHeads(state, 0, 'SEA', 'MIN');
  const chain = chainBetween('SEA', 'MIN');
  claim(state, 1, ...chain.slice(0, -1));
  const tile = K.MILESTONE_TILES.find((t) => t.id === 'MS7');
  assert.equal(describeProgress(state, 0, tile).met, false, 'one route short');
  assert.match(describeProgress(state, 0, tile).text, /not yet joined/);
  claim(state, 0, chain[chain.length - 1]);
  assert.equal(describeProgress(state, 0, tile).met, true);
  assert.match(describeProgress(state, 0, tile).text, /are joined/);
  assert.equal(describeProgress(state, 1, tile).met, false, 'Ben\'s starting cities are different ones');
});

suite.check('R16.9: the active player wins a tie; otherwise the next player in turn order; every player is checked, not only the active one', () => {
  const full = [['crew', 'miner'], ['engineer', 'financier']];
  // Both meet MS8 at the end of Anna's turn: Anna, the active player, claims it.
  const a = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
  MILESTONE_SETUP.MS8(a);
  setTrain(a, 1, full);
  gatherCoinsTurn(a);
  assert.equal(a.modules.milestones.claimedBy.MS8, 0);
  // Only Ben meets it: he claims it at the end of ANNA's turn.
  const b = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
  setTrain(b, 1, full);
  const events = gatherCoinsTurn(b);
  assert.equal(b.modules.milestones.claimedBy.MS8, 1);
  assert.equal(eventOf(events, 'milestoneClaimed').player, 1);
  assert.equal(b.players[1].vp.milestones, K.MILESTONE_TILES.find((t) => t.id === 'MS8').vp);
  assert.equal(b.players[0].vp.milestones, 0);
  // Three players, Ben active; Anna and Cara both meet it: the first after Ben in turn order is Cara.
  const c = startWith(3, { ...MILESTONES, milestonesInPlay: 10 });
  setTrain(c, 0, full);
  setTrain(c, 2, full);
  gatherCoinsTurn(c); // Anna's turn: Anna is active and claims it
  assert.equal(c.modules.milestones.claimedBy.MS8, 0);
  const d = startWith(3, { ...MILESTONES, milestonesInPlay: 10 });
  setTrain(d, 0, full);
  setTrain(d, 2, full);
  d.players[0].train.specialistCarriages = [{ slots: ['crew', null] }]; // Anna does not meet it after all
  setTrain(d, 1, [['crew', null]]);
  gatherCoinsTurn(d); // Anna's turn, Anna does not meet it; Cara does
  assert.equal(d.modules.milestones.claimedBy.MS8, 2);
  const e = startWith(3, { ...MILESTONES, milestonesInPlay: 10 });
  gatherCoinsTurn(e); // Anna's turn over
  setTrain(e, 0, full);
  setTrain(e, 2, full);
  gatherCoinsTurn(e); // Ben's turn: Ben does not meet it; Anna and Cara do, and Cara is first after Ben
  assert.equal(e.modules.milestones.claimedBy.MS8, 2);
});

suite.check('R16.9: one player may claim several tiles in one check; a claimed tile is never claimed again', () => {
  const state = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
  MILESTONE_SETUP.MS8(state);
  MILESTONE_SETUP.MS10(state);
  MILESTONE_SETUP.MS1(state);
  const events = gatherCoinsTurn(state);
  const claimed = eventsOf(events, 'milestoneClaimed').map((e) => e.milestone);
  assert.deepEqual(claimed, ['MS1', 'MS8', 'MS10'], 'in id order, all in the same check');
  const vp = state.players[0].vp.milestones;
  assert.equal(vp, ['MS1', 'MS8', 'MS10'].reduce((n, id) => n + K.MILESTONE_TILES.find((t) => t.id === id).vp, 0));
  gatherCoinsTurn(state); // Ben
  gatherCoinsTurn(state); // Anna again: still true, nothing new
  assert.equal(state.players[0].vp.milestones, vp);
});

suite.check('R16.9, R19.6: milestones are claimed in the final round too, before the game ends', () => {
  const state = startWith(2, { ...MILESTONES, milestonesInPlay: 10, maxTurnsPerPlayer: 1 });
  MILESTONE_SETUP.MS8(state);
  gatherCoinsTurn(state); // Anna's first turn: the limit triggers the end, Ben still plays his turn
  assert.notEqual(state.gameEnd, null);
  assert.equal(state.modules.milestones.claimedBy.MS8, 0);
  setTrain(state, 1, [['crew', 'miner'], ['engineer', 'financier']]);
  setTrain(state, 0, [['crew', null]]);
  gatherCoinsTurn(state); // Ben's turn, the last: he claims a tile that is still open (MS8 is Anna's already)
  assert.equal(state.phase, 'ended');
});

suite.check('describeProgress: the text the UI shows, for milestones and goals', () => {
  const state = startWith(2, { ...MILESTONES, milestonesInPlay: 10 });
  const tile = (id) => K.MILESTONE_TILES.find((t) => t.id === id);
  claim(state, 0, 'POR-REN', 'SAC-REN'); // 2 + 2 tunnel slots
  assert.deepEqual(describeProgress(state, 0, tile('MS2')), { known: true, value: 4, target: 6, met: false, text: '4 of 6 Tunnel slots' });
  assert.equal(describeProgress(state, 0, tile('MS6')).text, '2 of 6 routes owned');
  assert.equal(describeProgress(state, 0, tile('MS1')).text, '0 of 5 buildings on the map');
  assert.equal(describeProgress(state, 0, tile('MS9')).text, '2 of 5 carriages');
  assert.equal(describeProgress(state, 0, tile('MS5')).text, '2 of 5 slots in your longest route');
  assert.equal(describeProgress(state, 0, tile('MS3')).text, '0 of 6 Bridge slots');
  assert.equal(describeProgress(state, 1, tile('MS2')).value, 0, 'Ben owns none of them');
  const goal = K.GOAL_CARDS.find((g) => g.id === 'G5');
  const p = describeProgress(state, 0, goal);
  assert.deepEqual([p.known, p.value, p.target, p.met, p.text], [true, 2, null, false, '2 carriages']);
  assert.equal(describeProgress(state, 0, { metric: 'nonsense', op: '>=', value: 1 }).text, 'Not tracked');
});

// --- goals ------------------------------------------------------------------------------------

/** [setup, expected value for the player] for every goal; player 0 unless stated. */
const GOAL_SETUP = {
  G1: [(s) => { rail(s, 0, 'SPO'); rail(s, 0, 'REN'); tele(s, 0, 'SPO'); }, 2],
  G2: [(s) => { rail(s, 0, 'SPO'); tele(s, 0, 'HEL'); rail(s, 0, 'FRE'); rail(s, 0, 'SLC'); }, 1],
  G3: [(s) => { rail(s, 0, 'SPO'); tele(s, 0, 'SPO'); rail(s, 0, 'BIL'); }, 2],
  G4: [(s) => setTrain(s, 0, [['crew', 'crew'], ['crew', 'miner']]), 3],
  G5: [(s) => { setTrain(s, 0, [['crew', null], [null, null], [null, null]]); s.players[0].train.storageCarriages = 1; }, 4],
  G6: [(s) => { installTile(s, 0, 1, 'U1-vp'); installTile(s, 0, 2, 'U2-vp'); }, 2],
  G7: [(s) => setTrain(s, 0, [['crew', 'miner'], ['engineer', 'financier'], ['crew', null]]), 1],
  G8: [(s) => setTrain(s, 0, [['crew', 'miner'], ['engineer', null]]), 3],
  G9: [(s) => { tele(s, 0, 'SPO'); rail(s, 1, 'SPO'); tele(s, 0, 'REN'); rail(s, 0, 'REN'); }, 1],
  G10: [(s) => give(s, 0, { resources: { iron: 2, wood: 1 }, tiles: { ground: 1 } }), 4],
  G11: [(s) => ['SPO', 'REN', 'FRE'].forEach((c) => tele(s, 0, c)), 3],
  G12: [(s) => { rail(s, 0, 'SPO'); tele(s, 0, 'SPO'); rail(s, 0, 'REN'); }, 2],
};

suite.check('R16.5: each of the 12 goals measures what it says, and describeProgress reads it back', () => {
  for (const goal of K.GOAL_CARDS) {
    const state = startWith(2, { ...GOALS, ...UPGRADES, goalsInPlay: 12 });
    const [setup, expected] = GOAL_SETUP[goal.id];
    setup(state);
    const standing = goalStandings(state, goal);
    assert.equal(standing.values[0], expected, `${goal.id} (${goal.name})`);
    const progress = describeProgress(state, 0, goal);
    assert.equal(progress.value, expected);
    assert.match(progress.text, new RegExp(`^${expected} `), goal.id);
    assert.equal(goalsInPlay(state).length, 12);
  }
  // Every metric the goals use is covered by this table.
  assert.deepEqual(Object.keys(GOAL_SETUP).sort(), K.GOAL_CARDS.map((g) => g.id).sort());
});

suite.check('R16.5 goal 2 and 3: the regions and the junction cities are the ones of R16.6', () => {
  const state = startWith(2, { ...GOALS, goalsInPlay: 11 });
  const g2 = K.GOAL_CARDS.find((g) => g.id === 'G2');
  const g3 = K.GOAL_CARDS.find((g) => g.id === 'G3');
  // Reno, Salt Lake City, Denver and North Platte are in neither region (R16.6.2).
  ['REN', 'SLC', 'DEN', 'NPL'].forEach((c) => rail(state, 0, c));
  assert.equal(goalStandings(state, g2).values[0], 0);
  rail(state, 0, 'SPO'); // north
  assert.equal(goalStandings(state, g2).values[0], 0, 'north alone is not enough');
  rail(state, 0, 'ELP'); // south
  assert.equal(goalStandings(state, g2).values[0], 1);
  // Junction cities: Reno, Salt Lake City, Denver and Spokane, El Paso count; North Platte does not.
  assert.equal(goalStandings(state, g3).values[0], 5);
  rail(state, 0, 'BIL');
  assert.equal(goalStandings(state, g3).values[0], 5, 'Billings is not a junction city');
});

/** Gives each player a train with this many specialists (G8 measure). */
function specialistsOf(state, counts) {
  counts.forEach((n, p) => {
    const slots = Array.from({ length: n }, () => 'crew');
    const carriages = [];
    for (let i = 0; i < slots.length; i += 2) carriages.push([slots[i], slots[i + 1] ?? null]);
    if (carriages.length === 0) carriages.push([null, null]);
    setTrain(state, p, carriages);
  });
}
const G8 = K.GOAL_CARDS.find((g) => g.id === 'G8');

suite.check('R16.3, R16.4: first place 10 VP, second 5 VP, the rest nothing', () => {
  const state = startWith(4, { ...GOALS, goalsInPlay: 11 });
  specialistsOf(state, [4, 3, 2, 1]);
  assert.deepEqual(goalStandings(state, G8).awards, [K.SCORING.goalVp[0], K.SCORING.goalVp[1], 0, 0]);
  assert.deepEqual(goalStandings(state, G8).places, [0, 1, 2, 3]);
});

suite.check('R16.4.1, R16.4.2: players tied for a place each score its full value, and second place still goes to the next-best measure', () => {
  const [first, second] = K.SCORING.goalVp;
  const state = startWith(4, { ...GOALS, goalsInPlay: 11 });
  specialistsOf(state, [3, 3, 2, 1]); // two tie for first
  assert.deepEqual(goalStandings(state, G8).awards, [first, first, second, 0]);
  specialistsOf(state, [3, 2, 2, 1]); // two tie for second
  assert.deepEqual(goalStandings(state, G8).awards, [first, second, second, 0]);
  specialistsOf(state, [3, 3, 3, 1]); // three tie for first
  assert.deepEqual(goalStandings(state, G8).awards, [first, first, first, second]);
  specialistsOf(state, [2, 2, 2, 2]); // everybody ties
  assert.deepEqual(goalStandings(state, G8).awards, [first, first, first, first]);
});

suite.check('R16.4.3: on a "most" goal a measure of 0 scores nothing, whatever the rank', () => {
  const [first, second] = K.SCORING.goalVp;
  const state = startWith(4, { ...GOALS, goalsInPlay: 11 });
  // The starting specialists are chosen in setup; empty every train by hand.
  for (const p of state.players) setTrain(state, p.id, [[null, null]]);
  assert.deepEqual(goalStandings(state, G8).awards, [0, 0, 0, 0], 'all at 0: nobody scores');
  specialistsOf(state, [2, 0, 0, 0]);
  assert.deepEqual(goalStandings(state, G8).awards, [first, 0, 0, 0], 'second place is a tie at 0: nothing');
  specialistsOf(state, [2, 1, 0, 0]);
  assert.deepEqual(goalStandings(state, G8).awards, [first, second, 0, 0]);
});

suite.check('R16.4.4: with 2 players only first place is awarded', () => {
  const first = K.SCORING.goalVp[0];
  const state = startWith(2, { ...GOALS, goalsInPlay: 11 });
  specialistsOf(state, [3, 1]);
  assert.deepEqual(goalStandings(state, G8).awards, [first, 0]);
  specialistsOf(state, [2, 2]);
  assert.deepEqual(goalStandings(state, G8).awards, [first, first], 'a tie for first: both score it');
});

suite.check('R16.5 goal 10: the FEWEST cargo ranks first, and 0 is a fine score there', () => {
  const [first, second] = K.SCORING.goalVp;
  const g10 = K.GOAL_CARDS.find((g) => g.id === 'G10');
  const state = startWith(3, { ...GOALS, goalsInPlay: 11 });
  give(state, 0, { resources: { iron: 4 }, tiles: { ground: 1 } });
  give(state, 1, { resources: {}, tiles: {} });
  give(state, 2, { resources: { wood: 2 } });
  assert.deepEqual(goalStandings(state, g10).values, [5, 0, 2]);
  assert.deepEqual(goalStandings(state, g10).awards, [0, first, second]);
});

suite.check('R20.2.2: goals are scored in final scoring only, to the goals source, and added to the total', () => {
  const state = startWith(3, { ...GOALS, goalsInPlay: 11, maxTurnsPerPlayer: 1 });
  specialistsOf(state, [3, 2, 1]);
  for (const p of state.players) assert.equal(p.vp.goals, 0, 'nothing happens during play');
  const projected = scoreGame(state).players.map((p) => p.bySource.goals);
  assert.ok(projected[0] > projected[2], 'the projection ranks the players');
  assert.equal(state.players[0].vp.goals, 0, 'asking changed nothing');
  // The trains stay as they are for the single turn each player takes.
  gatherCoinsTurn(state);
  gatherCoinsTurn(state);
  gatherCoinsTurn(state);
  assert.equal(state.phase, 'ended');
  const expected = state.players.map((p) => goalsInPlay(state).reduce((sum, goal) => sum + goalStandings(state, goal).awards[p.id], 0));
  assert.ok(expected.some((v) => v > 0));
  const score = scoreGame(state);
  assert.deepEqual(state.players.map((p) => p.vp.goals), expected);
  assert.deepEqual(score.players.map((p) => p.bySource.goals), expected);
  for (const p of score.players) assert.equal(p.total, Object.values(p.bySource).reduce((a, b) => a + b, 0));
});

suite.check('goals and milestones need nothing from each other: both together', () => {
  const state = startWith(2, { endGameScoring: 'both', goalsInPlay: 2, milestonesInPlay: 3 });
  assert.equal(state.modules.goals.inPlay.length, 2);
  assert.equal(state.modules.milestones.inPlay.length, 3);
  for (const p of state.players) assert.ok('goals' in p.vp && 'milestones' in p.vp);
});

// =====================================================================================
// R17 - the Legislative Agenda
// =====================================================================================

const LA = (n) => K.LEGISLATIVE_CARDS.find((c) => c.number === n);

/** The city of the route that is not `from`. */
const otherCity = (route, from) => (route.a === from ? route.b : route.a);

/** A route with exactly one end a start city, matching `pred`, as `{ route, from }`; `from` is the start city. */
function startRoute(pred) {
  for (const r of MAP.routes) {
    const aStart = MAP.cityById[r.a].kind !== 'inland';
    const bStart = MAP.cityById[r.b].kind !== 'inland';
    if (aStart === bStart) continue;
    if (pred(r)) return { route: r, from: aStart ? r.a : r.b };
  }
  throw new Error('no such route');
}

/** Puts a railhead on `city` (the other on a far start city) for the player to act from. */
function headsAt(state, pid, city) {
  const side = MAP.cityById[city].kind;
  if (side === 'west') setHeads(state, pid, city, 'MIN');
  else if (side === 'east') setHeads(state, pid, 'SEA', city);
  else setHeads(state, pid, city, 'MIN');
}

/**
 * The current player takes Lay Tracks / Move Train and claims `routeId` from `from`
 * (the tiles are handed to them first). `m` = 2 puts a worker next to the district for a
 * second step. Buildings that are offered are answered by `building(state)`; the default
 * declines. Returns all the events.
 */
function claimTurn(state, routeId, from, { m = 1, building = null } = {}) {
  while (kind(state) === 'freeActions') act(state, { type: 'endFreeActions' }); // the previous turn's opportunity
  const pid = state.toAct;
  const route = MAP.routeById[routeId];
  headsAt(state, pid, from);
  const p = state.players[pid];
  for (const t of K.TERRAINS) p.builtTiles[t] += route.cost[t];
  const free = SPACE_IDS.filter((w) => SPACE_DISTRICTS[w].includes('D5') && state.grid.spaces[w] === null);
  if (m === 2) put(state, pid, free[0]);
  const events = placeAndChoose(state, m === 2 ? free[1] : free[0], 'D5');
  // With exactly one legal action the engine has already claimed the route (the auto-advance rule).
  if (state.map.routeOwner[routeId] === null) events.push(...act(state, { type: 'claimRoute', route: routeId, from }));
  events.push(...finishLaying(state, pid, building));
  return events;
}

/** Answers the buildings and the end of a Lay Tracks action until the turn passes (or a decision of another kind is pending). */
function finishLaying(state, pid, building = null) {
  const events = [];
  for (let guard = 0; guard < 20; guard++) {
    const k = kind(state);
    if (k === 'placeBuildings') {
      const step = building ? building(state) : null;
      events.push(...act(state, step ?? { type: 'skipBuilding' }));
    } else if (k === 'layTracks') {
      events.push(...act(state, { type: 'stopLaying' }));
    } else break;
  }
  return events;
}

const placeTelegraph = (city) => () => ({ type: 'placeTelegraphStation', city });
const placeRailway = (city, houseTrack = 'iron') => () => ({ type: 'placeRailwayStation', city, houseTrack });

/** The chain of routes from the nearest west start city to the nearest east start city. */
function crossing() {
  let best = null;
  for (const w of MAP.westStartCities) {
    for (const e of MAP.eastStartCities) {
      const chain = chainBetween(w, e);
      if (best === null || chain.length < best.chain.length) best = { chain, west: w, east: e };
    }
  }
  return best;
}

/** Brings the player to the point where their next claim completes a transcontinental line; returns { routeId, from }. */
function almostCrossing(state, pid) {
  const { chain } = crossing();
  const last = chain[chain.length - 1];
  claim(state, pid, ...chain.slice(0, -1));
  // The city the last route is claimed from: the end that the previous routes reach.
  const prior = MAP.routeById[chain[chain.length - 2]];
  const shared = [prior.a, prior.b].find((c) => c === MAP.routeById[last].a || c === MAP.routeById[last].b);
  return { routeId: last, from: shared };
}

suite.check('R3.8.3, R17.1: one card is in force, drawn from the seed or named by legislativeAgendaCard; the others never exist', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const state = startWith(2, { moduleLegislativeAgenda: true }, { seed });
    assert.match(state.modules.legislative.card, /^LA\d+$/);
    assert.deepEqual(state.modules.legislative.used, {});
    assert.deepEqual(Object.keys(state.modules.legislative).sort(), ['card', 'used'], 'no other card is stored (R2.4)');
    seen.add(state.modules.legislative.card);
  }
  assert.ok(seen.size >= 12, `the card is drawn at random: ${seen.size} different cards in 60 games`);
  for (const card of K.LEGISLATIVE_CARDS) {
    assert.equal(startWith(2, legislative(card.number)).modules.legislative.card, card.id);
  }
  const off = startWith(2);
  assert.equal(off.modules.legislative, undefined);
  for (const p of off.players) assert.ok(!('legislative' in p.vp));
});

suite.check('R17.2: cards 1 to 3 are retired (the scoring card does their job); naming one is refused, and a random draw never finds one', () => {
  for (const number of [1, 2, 3]) assert.throws(() => startWith(2, legislative(number)), /4 to 20/);
  for (let seed = 1; seed <= 60; seed++) {
    const card = startWith(2, { moduleLegislativeAgenda: true }, { seed }).modules.legislative.card;
    assert.ok(!['LA1', 'LA2', 'LA3'].includes(card), card);
  }
});

suite.check('R17.1, R17.2: the card applies to every player equally (here Ben, in seat 2)', () => {
  const state = startWith(2, legislative(9)); // a first connection scores +3 VP
  gatherCoinsTurn(state);
  const events = claimTurn(state, 'SEA-SPO', 'SEA');
  assert.equal(vpOf(events, 1).legislative, 3);
  assert.equal(state.players[1].vp.legislative, 3);
  assert.equal(state.players[0].vp.legislative, 0);
});

suite.check('R17.3 card 4, R19.2: the completion bonus is 10 VP higher; the 10 are booked to legislative, the 25 + 3 per slot to completion', () => {
  const state = startWith(2, legislative(4));
  const { routeId, from } = almostCrossing(state, 0);
  const route = MAP.routeById[routeId];
  const events = claimTurn(state, routeId, from);
  const vp = vpOf(events, 0);
  assert.equal(vp.completion, K.SCORING.completionVp + K.SCORING.completionVpPerSlot * route.length);
  assert.equal(vp.legislative, 10);
  assert.equal(state.gameEnd.reason, 'transcontinental');
});

suite.check('R17.3 cards 5, 6, R11.10: whole-action bonuses are worked out once, when the Lay Tracks action ends', () => {
  // Card 5: slots of at least 2 different terrains in one action. A single mixed route qualifies; a single-terrain route does not.
  const mixed = startWith(2, legislative(5));
  assert.equal(vpOf(claimTurn(mixed, 'SEA-HEL', 'SEA'), 0).legislative, 3, 'a Bridge and four Tunnel slots: two terrains');
  const plain = startWith(2, legislative(5));
  assert.equal(vpOf(claimTurn(plain, 'SEA-SPO', 'SEA'), 0).legislative ?? 0, 0, 'Ground only: nothing');
  // Two steps, one terrain each: 2 terrains in the whole action.
  const two = startWith(2, legislative(5));
  const e2 = claimTurn(two, 'SEA-SPO', 'SEA', { m: 2 });
  assert.equal(vpOf(e2, 0).legislative ?? 0, 0, 'the action stopped after one claim');
  const split = startWith(2, legislative(5));
  headsAt(split, 0, 'SEA');
  give(split, 0, { tiles: { ground: 2, bridge: 2 } });
  put(split, 0, 'W6');
  placeAndChoose(split, 'W7', 'D5');
  act(split, { type: 'claimRoute', route: 'SEA-SPO', from: 'SEA' });
  finishBuildings(split);
  const events = act(split, { type: 'claimRoute', route: 'POR-SPO', from: 'SPO' }).concat(finishLaying(split, 0));
  assert.equal(vpOf(events, 0).legislative, 3, 'Ground (card route 1) and Bridge (route 2) in one action: 3 VP once');
  // Card 6: 5 or more slots in one action. A single 5-slot route qualifies.
  const five = startWith(2, legislative(6));
  assert.equal(vpOf(claimTurn(five, 'SEA-HEL', 'SEA'), 0).legislative, 5);
  const four = startWith(2, legislative(6));
  assert.equal(vpOf(claimTurn(four, 'SEA-SPO', 'SEA'), 0).legislative ?? 0, 0, '2 slots: nothing');
});

/** Declines the building offered after a claim, if one is. */
function finishBuildings(state) {
  while (kind(state) === 'placeBuildings') act(state, { type: 'skipBuilding' });
}

suite.check('R17.3 cards 7, 8: a building in a city with another player\'s building / in a junction city', () => {
  // Card 7: Ben already has a telegraph station in Spokane; Anna places a railway station there.
  const seven = startWith(2, legislative(7));
  tele(seven, 1, 'SPO');
  let events = claimTurn(seven, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') });
  assert.equal(vpOf(events, 0).legislative, 5);
  const alone = startWith(2, legislative(7));
  events = claimTurn(alone, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') });
  assert.equal(vpOf(events, 0).legislative ?? 0, 0, 'no building of another player there: nothing');
  // Card 8: Spokane is a junction city; Dodge City is not.
  const eight = startWith(2, legislative(8));
  events = claimTurn(eight, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.equal(vpOf(events, 0).legislative, 2);
  const quiet = startWith(2, legislative(8));
  events = claimTurn(quiet, 'KCY-DOD', 'KCY', { building: placeTelegraph('DOD') });
  assert.equal(vpOf(events, 0).legislative ?? 0, 0, 'Dodge City is not a junction city');
  // No building placed, no bonus.
  const skip = startWith(2, legislative(8));
  assert.equal(vpOf(claimTurn(skip, 'SEA-SPO', 'SEA'), 0).legislative ?? 0, 0);
});

suite.check('R17.3 card 9: a first connection scores +3 VP, booked to legislative; a city already connected does not', () => {
  const state = startWith(2, legislative(9));
  let events = claimTurn(state, 'SEA-SPO', 'SEA');
  assert.deepEqual([vpOf(events, 0).firstConnection, vpOf(events, 0).legislative], [K.SCORING.firstConnectionVp, 3]);
  gatherCoinsTurn(state);
  events = claimTurn(state, 'POR-SPO', 'POR'); // Anna again: Spokane is connected already
  assert.equal(vpOf(events, 0).firstConnection ?? 0, 0);
  assert.equal(vpOf(events, 0).legislative ?? 0, 0);
});

suite.check('R17.3 card 10: the first player to have 5 buildings gains 10 VP at once, once per game', () => {
  const state = startWith(2, legislative(10));
  ['REN', 'FRE', 'HEL', 'BOI'].forEach((c) => tele(state, 0, c)); // 4 buildings by hand
  state.players[0].telegraphsPlaced = 4;
  const events = claimTurn(state, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.equal(vpOf(events, 0).legislative, 10);
  assert.equal(state.modules.legislative.used.LA10, true);
  // Ben reaches 5 buildings later: nothing. Anna's sixth: nothing.
  ['LVG', 'PHX', 'BIL', 'SLC'].forEach((c) => rail(state, 1, c));
  claimTurn(state, 'LAX-FRE', 'LAX', { building: placeRailway('FRE') });
  assert.equal(state.players[1].vp.legislative, 0);
});

suite.check('R17.3 cards 11 to 14: each Gather action of that resource gives +1 after multiplying, to every player', () => {
  const cases = [
    [11, 'D3', 'iron', 'resources'],
    [12, 'D7', 'wood', 'resources'],
    [13, 'D1', 'gunpowder', 'resources'],
    [14, 'D9', 'coins', 'coins'],
  ];
  for (const [number, district, item, where] of cases) {
    for (const who of [0, 1]) {
      const state = startWith(2, legislative(number));
      if (who === 1) gatherTurn(state, district === 'D9' ? 'D7' : 'D9'); // Anna takes a turn elsewhere
      const p = state.players[who];
      const before = where === 'coins' ? p.coins : p.resources[item];
      const spaces = SPACE_IDS.filter((w) => SPACE_DISTRICTS[w].includes(district));
      put(state, who, spaces[0]);
      const events = placeAndChoose(state, spaces[1], district);
      if (kind(state) === 'bonusAction') act(state, { type: 'skipBonusAction' });
      const g = eventOf(events, 'gather');
      assert.equal(g.multiplier, 2, 'M = 2 with one worker next to the district');
      const after = where === 'coins' ? p.coins : p.resources[item];
      assert.equal(after - before, g.production * 2 + 1, `card ${number}: the +1 is flat, added after multiplying (player ${who})`);
    }
  }
  // Only that resource: card 11 does nothing for Gather Wood.
  const state = startWith(2, legislative(11));
  const before = state.players[0].resources.wood;
  placeAndChoose(state, 'W8', 'D7');
  if (kind(state) === 'bonusAction') act(state, { type: 'skipBonusAction' });
  assert.equal(state.players[0].resources.wood - before, production(state, 0, 'wood'));
});

suite.check('R17.3 cards 15 to 17: telegraph +3 VP, railway +3 VP, railway +2 resources of your choice', () => {
  const t = startWith(2, legislative(15));
  let events = claimTurn(t, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.equal(vpOf(events, 0).legislative, 3);
  assert.equal(vpOf(events, 0).telegraph, 1, 'the telegraph row VP are the base');
  const tr = startWith(2, legislative(15));
  assert.equal(vpOf(claimTurn(tr, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') }), 0).legislative ?? 0, 0, 'a railway station is not a telegraph station');
  const r = startWith(2, legislative(16));
  events = claimTurn(r, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') });
  assert.equal(vpOf(events, 0).legislative, 3);
  assert.equal(vpOf(claimTurn(startWith(2, legislative(16)), 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') }), 0).legislative ?? 0, 0);
  const g = startWith(2, legislative(17));
  const before = { ...g.players[0].resources };
  claimTurn(g, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') });
  assert.equal(kind(g), 'chooseResource', 'two resources of your choice');
  assert.equal(topFrame(g).remaining, 2);
  take(g, 'chooseResource', { resource: 'iron' });
  take(g, 'chooseResource', { resource: 'wood' });
  assert.equal(g.players[0].resources.iron, before.iron + 1);
  assert.equal(g.players[0].resources.wood, before.wood + 1);
  assert.equal(g.turn.player, 1);
});

suite.check('R17.3 cards 18, 19: a resource of choice after the Hire Specialist / Add Carriage BONUS ACTION, not after Congress C4', () => {
  const hire = startWith(2, legislative(18));
  give(hire, 0, { resources: { iron: 3, gunpowder: 3 }, coins: 3 });
  placeAndChoose(hire, 'W2', 'D3'); // Gather Iron: Hire Specialist
  take(hire, 'hireSpecialist', { specialist: 'crew' });
  assert.equal(kind(hire), 'chooseResource');
  assert.equal(topFrame(hire).remaining, 1);
  take(hire, 'chooseResource', { resource: 'wood' });
  assert.equal(hire.turn.player, 1);

  const carriage = startWith(2, legislative(19));
  give(carriage, 0, { resources: { wood: 3 } });
  placeAndChoose(carriage, 'W12', 'D9'); // Gather Coins: Add Carriage
  take(carriage, 'addCarriage', { carriage: 'storage' });
  assert.equal(kind(carriage), 'chooseResource');
  assert.equal(topFrame(carriage).remaining, 2);

  // Congress entry C4 adds a carriage for free: card 19 does not apply.
  const c4 = startWith(2, legislative(19));
  setTrain(c4, 0, [['financier', null]]);
  give(c4, 0, { coins: 5 });
  placeAndChoose(c4, 'W2', 'D2'); // Lobby Congress: the Foreman and the Financier give 2 lobby points
  take(c4, 'closeCongress'); // keep the first point for the second step
  take(c4, 'takeCongressEntry', { entry: 'C4' });
  assert.equal(kind(c4), 'addCarriage');
  take(c4, 'addCarriage', { carriage: 'storage' });
  assert.notEqual(kind(c4), 'chooseResource', 'no resources of choice for a free carriage');
});

suite.check('R17.3 card 20: once per activation, right after an entry, one other entry of the same tier for free', () => {
  const state = startWith(2, legislative(20));
  setTrain(state, 0, [['financier', null]]);
  give(state, 0, { coins: 5, resources: {} });
  placeAndChoose(state, 'W2', 'D2');
  // The Foreman (a Financier at Lobby Congress) gives 1 lobby point; the window is open.
  assert.equal(topFrame(state).lobby, 1);
  const events = take(state, 'takeCongressEntry', { entry: 'C1' }); // tier 1: 1 lobby point, 1 Coin
  assert.equal(state.players[0].coins, 4);
  assert.equal(kind(state), 'freeCongress');
  assert.deepEqual(keys(state), ['declineFreeEntry', 'takeCongressEntry:C2', 'takeCongressEntry:CR'], 'C1 is the one just taken; Reset is a tier 1 entry');
  assert.equal(eventOf(events, 'congressEntry').free, false);
  const free = take(state, 'takeCongressEntry', { entry: 'C2' });
  assert.equal(eventOf(free, 'congressEntry').free, true);
  assert.equal(eventOf(free, 'congressEntry').coins, 0, 'no Coins');
  assert.equal(state.players[0].coins, 4, 'no Coins were paid');
  assert.equal(state.players[0].resources.iron, 2, 'the benefit of C2');
  assert.equal(state.congress.used.C2, true);
  // The Financier step: a second paid entry (Reset) in the same activation gets no free one.
  while (kind(state) === 'trainActivation' && !topFrame(state).congress) take(state, 'skipStep');
  assert.equal(topFrame(state).lobby, 1, 'the Financier step added a lobby point');
  take(state, 'takeCongressEntry', { entry: 'CR' });
  assert.notEqual(kind(state), 'freeCongress', 'once per train activation');
});

suite.check('R17.3 card 20: declining the free entry is a stop action; it is offered again after the next entry', () => {
  const state = startWith(2, legislative(20));
  setTrain(state, 0, [['financier', null]]);
  give(state, 0, { coins: 5, resources: {} });
  placeAndChoose(state, 'W2', 'D2');
  take(state, 'takeCongressEntry', { entry: 'C1' });
  assert.ok(STOP_ACTION_TYPES.includes('declineFreeEntry'));
  take(state, 'declineFreeEntry');
  assert.equal(state.congress.used.C2, false);
  assert.notEqual(kind(state), 'freeCongress');
  assert.equal(state.players[0].coins, 4);
});

// =====================================================================================
// R18 - Pony Express: tokens, the market, the free actions of R4.4
// =====================================================================================

const pony = (players = 2, variants = {}, options = {}) => startWith(players, { ...PONY, ...variants }, options);
const cardOf = (id) => K.PONY_CARDS.find((c) => c.id === id);
const costOf = (id) => K.PONY.costs[cardOf(id).rank];
const P = (n) => `PX${n}`;

/**
 * Brings the state to a free-action opportunity of player `pid` with `cardId` face up and
 * the tokens to buy it (or `tokens`). The current player's turn is a Gather Coins; if `pid`
 * is the player whose turn it is, the opportunity is the one AFTER the turn, otherwise the
 * next player's first one.
 */
function offer(state, cardId, { pid = 0, tokens = null } = {}) {
  if (cardId) stock(state, cardId);
  const have = tokens ?? (cardId ? costOf(cardId) : 0);
  giveTokens(state, pid, have);
  gatherCoinsTurn(state);
  assert.equal(kind(state), 'freeActions', 'a free-action opportunity is open');
  assert.equal(topFrame(state).player, pid);
}

/** `offer`, then buys the card. Returns the events of the purchase. */
function buy(state, cardId, options = {}) {
  offer(state, cardId, options);
  return act(state, { type: 'buyPonyCard', card: cardId });
}

suite.check('R3.8.4, R18.2: a token on each of the 17 inland cities, three decks by rank, two cards of each rank face up', () => {
  const state = pony(3);
  const m = state.modules.pony;
  assert.deepEqual(Object.keys(m.tokens).sort(), MAP.inlandCities.slice().sort());
  assert.equal(Object.values(m.tokens).filter(Boolean).length, 17);
  for (const city of MAP.startCities) assert.ok(!(city in m.tokens), 'start cities hold no token (R11.2.3)');
  assert.deepEqual(Object.keys(m.decks), ['A', 'B', 'C']);
  assert.deepEqual(Object.keys(m.market), ['A', 'B', 'C']);
  for (const rank of ['A', 'B', 'C']) assert.equal(m.market[rank].length, K.PONY.marketPerRank);
  const all = [...Object.values(m.decks).flat(), ...Object.values(m.market).flat()];
  assert.equal(new Set(all).size, 38, 'every card is in exactly one place');
  assert.deepEqual(['A', 'B', 'C'].map((r) => m.decks[r].length + m.market[r].length), [13, 11, 14]);
  for (const rank of ['A', 'B', 'C']) for (const id of [...m.decks[rank], ...m.market[rank]]) assert.equal(cardOf(id).rank, rank);
  assert.deepEqual(m.players, [0, 1, 2].map(() => ({ tokensHeld: 0, tokensCollected: 0, ongoing: [], endgame: [] })));
  assert.deepEqual(m.turn, { purchases: 0, usedCards: [], doubled: null });
  for (const p of state.players) assert.ok('ponyCards' in p.vp && 'ponyEnd' in p.vp);
  // The decks are shuffled from the game seed: different seeds, different orders and markets.
  const orders = new Set();
  for (let seed = 0; seed < 20; seed++) orders.add(JSON.stringify(pony(2, {}, { seed }).modules.pony.decks));
  assert.ok(orders.size >= 15, `${orders.size} different deck orders in 20 games`);
  assert.equal(JSON.stringify(pony(2, {}, { seed: 7 }).modules.pony.decks), JSON.stringify(pony(2, {}, { seed: 7 }).modules.pony.decks), 'the same seed gives the same decks');
  // R11.11.6, R13.7: cards removed from their decks.
  const network = pony(2, { claimFrom: 'network' }).modules.pony;
  const inNetwork = [...Object.values(network.decks).flat(), ...Object.values(network.market).flat()];
  assert.equal(inNetwork.length, 36);
  assert.ok(!inNetwork.includes('PX3') && !inNetwork.includes('PX14'));
  const sameOwner = pony(2, { bothBuildingsSameOwner: false }).modules.pony;
  const inSame = [...Object.values(sameOwner.decks).flat(), ...Object.values(sameOwner.market).flat()];
  assert.equal(inSame.length, 37);
  assert.ok(!inSame.includes('PX31'));
});

suite.check('R2.4, contract section 7: the three deck orders are hidden and determinise reshuffles them; the market is open and stays', () => {
  const state = pony(3, {}, { seed: 'hidden-pony' });
  assert.equal(hiddenDecks(state).length, 3);
  const before = JSON.stringify(state);
  const copy = determinise(state, makeRng('bot'));
  assert.equal(JSON.stringify(state), before, 'the real state is untouched');
  assert.deepEqual(copy.modules.pony.market, state.modules.pony.market, 'what is face up is not hidden');
  for (const rank of ['A', 'B', 'C']) {
    assert.deepEqual(copy.modules.pony.decks[rank].slice().sort(), state.modules.pony.decks[rank].slice().sort());
  }
  assert.notDeepEqual(copy.modules.pony.decks, state.modules.pony.decks, 'the orders change');
  assert.deepEqual(determinise(state, makeRng('bot')), copy, 'same bot seed, same determinisation');
  // Nothing else of any module is a hidden order: goals, milestones and the agenda card are revealed or not stored.
  const everything = startWith(3, ALL_ON(5));
  assert.equal(hiddenDecks(everything).length, 3);
  assert.deepEqual(Object.keys(everything.modules.legislative).sort(), ['card', 'used']);
});

suite.check('R11.5.4, R18.3: the first connection to an inland city takes its token; a start city or a connected city gives none', () => {
  const state = pony(2);
  const events = claimTurn(state, 'SEA-SPO', 'SEA');
  const t = eventOf(events, 'ponyToken');
  assert.deepEqual([t.player, t.city], [0, 'SPO']);
  assert.deepEqual([state.modules.pony.players[0].tokensHeld, state.modules.pony.players[0].tokensCollected], [1, 1]);
  assert.equal(state.modules.pony.tokens.SPO, false);
  assert.equal(Object.values(state.modules.pony.tokens).filter(Boolean).length, 16);
  // Ben claims into Spokane too: it is connected already.
  const again = claimTurn(state, 'POR-SPO', 'POR');
  assert.equal(eventOf(again, 'ponyToken'), undefined);
  assert.equal(state.modules.pony.players[1].tokensHeld, 0);
  // A claim into a start city has no first connection and no token.
  const start = pony(2);
  const route = MAP.routes.find((r) => r.id === 'BIS-MIN');
  headsAt(start, 0, 'BIS');
  give(start, 0, { tiles: route.cost });
  const e = claimTurn(start, 'BIS-MIN', 'BIS');
  assert.equal(eventOf(e, 'ponyToken'), undefined);
  assert.equal(start.modules.pony.players[0].tokensHeld, 0);
});

suite.check('R18.1: with Pony Express off a first connection still scores its VP and there is no token', () => {
  const state = startWith(2);
  const events = claimTurn(state, 'SEA-SPO', 'SEA');
  assert.equal(vpOf(events, 0).firstConnection, K.SCORING.firstConnectionVp);
  assert.equal(eventOf(events, 'ponyToken'), undefined);
  assert.equal(state.modules.pony, undefined);
});

suite.check('R4.4, R18.4: free actions are asked only when the player has one; a token is exchanged for a resource of choice, any number of times', () => {
  const none = pony(2);
  gatherCoinsTurn(none); // no tokens, no cards: no opportunity is asked, either side of the turn
  assert.equal(none.turn.player, 1);
  assert.equal(kind(none), 'workerStep');

  const state = pony(2);
  giveTokens(state, 0, 2, 5);
  give(state, 0, { resources: {}, coins: 0 });
  gatherCoinsTurn(state);
  assert.equal(kind(state), 'freeActions');
  assert.equal(topFrame(state).which, 'after');
  assert.deepEqual(keys(state).filter((k) => !k.startsWith('buyPonyCard')), ['endFreeActions', 'exchangeToken:gunpowder', 'exchangeToken:iron', 'exchangeToken:wood']);
  const e = take(state, 'exchangeToken', { resource: 'wood' });
  assert.equal(state.players[0].resources.wood, 1);
  assert.deepEqual([state.modules.pony.players[0].tokensHeld, state.modules.pony.players[0].tokensCollected], [1, 5], 'collected is a count over the whole game');
  assert.equal(eventOf(e, 'tokenExchanged').resource, 'wood');
  assert.equal(kind(state), 'freeActions', 'the opportunity stays open while there is something to do');
  take(state, 'exchangeToken', { resource: 'iron' });
  assert.equal(state.players[0].resources.iron, 1);
  // Nothing is left to do (no token, no card): the opportunity closes by itself.
  assert.equal(state.turn.player, 1);
  assert.equal(kind(state), 'workerStep');
});

suite.check('R18.4: returning a token needs a token and a resource (not Coins)', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX28'); // a card with an ability keeps the opportunity open with no token
  give(state, 0, { resources: {}, coins: 0 });
  gatherCoinsTurn(state);
  assert.equal(kind(state), 'freeActions');
  assert.equal(state.modules.pony.players[0].tokensHeld, 0);
  assert.equal(getBlockReason(state, { type: 'exchangeToken', resource: 'wood' }), 'You hold no Pony Express token to return.');
  assert.match(getBlockReason(state, { type: 'exchangeToken', resource: 'coins' }), /Coins are not a resource/);
  assert.match(getBlockReason(state, { type: 'exchangeToken', resource: 'steel' }), /"steel" is not a resource/);
  assert.ok(!keys(state).some((k) => k.startsWith('exchangeToken')));
});

suite.check('R17.3 card 18 with a card: a hire made by a Pony Express card is NOT the Hire Specialist bonus action', () => {
  const state = pony(2, legislative(18));
  give(state, 0, { resources: {}, coins: 0 });
  buy(state, 'PX6');
  take(state, 'hireSpecialist', { specialist: 'crew' });
  assert.notEqual(kind(state), 'chooseResource', 'no resource of choice for a hire made by a card');
  // ... while the bonus action itself still gives one (checked above).
  const fee = pony(2, legislative(18));
  give(fee, 0, { resources: { iron: 3, gunpowder: 3 }, coins: 3 });
  placeAndChoose(fee, 'W2', 'D3');
  take(fee, 'hireSpecialist', { specialist: 'crew' });
  assert.equal(kind(fee), 'chooseResource');
});

suite.check('R4.4: the first opportunity comes before the worker step, the second after the district action; endFreeActions leaves it', () => {
  const state = pony(2);
  giveTokens(state, 1, 1);
  gatherCoinsTurn(state); // Anna's turn, no tokens: no opportunity
  assert.equal(state.turn.player, 1);
  assert.equal(kind(state), 'freeActions');
  assert.deepEqual([topFrame(state).which, state.turn.step], ['before', 'freeBefore']);
  assert.ok(keys(state).includes('endFreeActions'));
  assert.equal(describeDecision(state).kind, 'freeActions');
  assert.match(describeDecision(state).prompt, /Ben: take free actions before your worker step/);
  take(state, 'endFreeActions');
  assert.equal(kind(state), 'workerStep');
  placeAndChoose(state, 'W8', 'D7');
  if (kind(state) === 'bonusAction') act(state, { type: 'skipBonusAction' });
  assert.equal(kind(state), 'freeActions');
  assert.equal(topFrame(state).which, 'after');
  take(state, 'endFreeActions');
  assert.equal(state.turn.player, 0, 'a turn cannot end with the opportunity pending: it ends when it is left');
});

suite.check('R18.5, R18.6: buying - the first blocker is named, with the numbers', () => {
  const state = pony(2);
  giveTokens(state, 0, 1);
  stock(state, 'PX7'); // Mail Delivery Contract, rank A, 2 tokens
  gatherCoinsTurn(state);
  const why = (card, player = 0) => getBlockReason(state, { type: 'buyPonyCard', card, player });
  assert.match(why('PX7'), /Mail Delivery Contract \(card 7\) is a rank A card and costs 2 tokens, and you hold 1/);
  assert.match(why('PX99'), /"PX99" is not a Pony Express card/);
  const rankA = state.modules.pony.decks.A[0];
  assert.match(why(rankA), /is not face up in the market/);
  assert.match(why('PX7', 1), /only by the player whose turn it is/);
  state.modules.pony.players[0].tokensHeld = 9;
  assert.equal(why('PX7'), null);
  act(state, { type: 'buyPonyCard', card: 'PX7' });
  // A second purchase in the same turn, in either opportunity (R4.4.1).
  const other = state.modules.pony.market.A.find((id) => id !== null);
  assert.match(getBlockReason(state, { type: 'buyPonyCard', card: other }), /already bought a card this turn: at most 1 card per turn/);
  assert.ok(!keys(state).some((k) => k.startsWith('buyPonyCard')));
  assert.equal(describeAction(state, { type: 'buyPonyCard', card: other }).startsWith('Buy '), true);
});

suite.check('R18.5: the tokens go back to the box, the empty place is refilled from the same deck, and an empty deck leaves the place empty', () => {
  const state = pony(2);
  stock(state, 'PX7');
  const m = state.modules.pony;
  const deckBefore = m.decks.A.length;
  const topOfDeck = m.decks.A[m.decks.A.length - 1];
  giveTokens(state, 0, 5, 5);
  gatherCoinsTurn(state);
  const events = act(state, { type: 'buyPonyCard', card: 'PX7' });
  assert.equal(m.players[0].tokensHeld, 3, '2 tokens paid');
  assert.equal(m.players[0].tokensCollected, 5, 'collected does not go down');
  assert.equal(m.decks.A.length, deckBefore - 1);
  assert.equal(m.market.A[0], topOfDeck, 'the top card of the same deck takes the place');
  assert.deepEqual([eventOf(events, 'ponyMarketRefill').rank, eventOf(events, 'ponyMarketRefill').card], ['A', topOfDeck]);
  assert.equal(eventOf(events, 'ponyCardBought').cost, 2);
  // An empty deck.
  const dry = pony(2);
  stock(dry, 'PX7');
  dry.modules.pony.decks.A.length = 0;
  giveTokens(dry, 0, 2);
  gatherCoinsTurn(dry);
  act(dry, { type: 'buyPonyCard', card: 'PX7' });
  assert.equal(dry.modules.pony.market.A[0], null);
  assert.equal(dry.modules.pony.market.A.filter((c) => c !== null).length, 1);
});

suite.check('R18.6, ponyOngoingCap: a player at the cap cannot buy another ongoing card; immediate and endgame cards do not count; 0 means no cap', () => {
  for (const [cap, held] of [[2, 2], [1, 1], [3, 3]]) {
    const state = pony(2, { ponyOngoingCap: cap });
    for (let i = 0; i < held; i++) ownCard(state, 0, ['PX20', 'PX21', 'PX36'][i]);
    stock(state, 'PX16'); // ongoing, rank B
    stock(state, 'PX7'); // immediate
    stock(state, 'PX38'); // endgame
    giveTokens(state, 0, 10);
    gatherCoinsTurn(state);
    assert.match(getBlockReason(state, { type: 'buyPonyCard', card: 'PX16' }), new RegExp(`you already hold ${held}, the most allowed in this game \\(ponyOngoingCap = ${cap}\\)`));
    assert.equal(getBlockReason(state, { type: 'buyPonyCard', card: 'PX7' }), null);
    assert.equal(getBlockReason(state, { type: 'buyPonyCard', card: 'PX38' }), null, 'endgame cards do not count towards the cap');
    assert.ok(!keys(state).includes('buyPonyCard:PX16'));
  }
  const free = pony(2, { ponyOngoingCap: 0 });
  for (const id of ['PX20', 'PX21', 'PX36', 'PX37', 'PX30']) ownCard(free, 0, id);
  stock(free, 'PX16');
  giveTokens(free, 0, 10);
  gatherCoinsTurn(free);
  assert.equal(getBlockReason(free, { type: 'buyPonyCard', card: 'PX16' }), null, '0 = no cap');
  act(free, { type: 'buyPonyCard', card: 'PX16' });
  assert.equal(free.modules.pony.players[0].ongoing.length, 6);
  assert.deepEqual(free.modules.pony.players[0].ongoing.slice(-1), ['PX16']);
});

suite.check('R18.6, R7.7: an immediate card of which no part can be carried out cannot be bought', () => {
  const state = pony(2);
  // Anna: no legal move or claim, a full train, no resources, no cities on her routes, 3 of each carriage.
  setTrain(state, 0, [['crew', 'crew'], ['crew', 'crew'], ['crew', 'crew']]);
  state.players[0].train.storageCarriages = 3;
  give(state, 0, { resources: {}, coins: 0 });
  giveTokens(state, 0, 40);
  gatherCoinsTurn(state);
  const reasonOf = (id) => {
    stock(state, id);
    return getBlockReason(state, { type: 'buyPonyCard', card: id });
  };
  const reasons = {};
  for (const id of ['PX2', 'PX3', 'PX5', 'PX6', 'PX11', 'PX12', 'PX17', 'PX27', 'PX9']) {
    reasons[id] = reasonOf(id);
    assert.notEqual(reasons[id], null, `${id} cannot be carried out`);
    assert.ok(reasons[id].endsWith('.'));
  }
  assert.match(reasons.PX2, /adds a storage carriage, and you already have 3/);
  assert.match(reasons.PX3, /none of your railheads can move/);
  assert.match(reasons.PX5, /cannot claim any route/);
  assert.match(reasons.PX6, /every specialist slot in your train is full \(6 of 6\)/);
  assert.match(reasons.PX11, /returns resources from your storage, and you have none/);
  assert.match(reasons.PX12, /you have none yet/);
  assert.match(reasons.PX17, /adds a specialist carriage, and you already have 3/);
  assert.match(reasons.PX9, /your train already has the most it can: 3 specialist carriages and 3 storage carriages/);
  assert.match(reasons.PX27, /every specialist slot in your train is full/);
  // Card 33 needs a specialist in the train; card 13 needs an available tier 1 entry.
  assert.equal(reasonOf('PX33'), null);
  setTrain(state, 0, [[null, null]]);
  assert.match(reasonOf('PX33'), /you have no specialist in your train/);
  assert.equal(reasonOf('PX13'), null, 'C1 and C2 are tier 1 entries and available');
});

suite.check('R14.2: a hat gained from a Pony Express card in the first opportunity cannot be spent that turn', () => {
  const state = pony(2);
  stock(state, 'PX8'); // Versatile Rider: a cowboy hat is one of its options
  giveTokens(state, 1, costOf('PX8'));
  gatherCoinsTurn(state); // Anna's turn; Ben's first opportunity opens
  assert.equal(state.turn.player, 1);
  assert.equal(state.players[1].hats, 0);
  act(state, { type: 'buyPonyCard', card: 'PX8' });
  assert.equal(kind(state), 'chooseOption');
  take(state, 'chooseOption', { option: 2 }); // 1 cowboy hat
  assert.equal(state.players[1].hats, 1, 'Ben holds the hat');
  assert.equal(kind(state), 'workerStep', 'no token left: the opportunity closed by itself');
  act(state, { type: 'placeWorker', space: 'W8' });
  assert.equal(kind(state), 'chooseDistrict');
  assert.ok(!getValidActions(state).some((a) => a.hat === true), 'no district can be chosen with the hat');
  assert.match(getBlockReason(state, { type: 'chooseDistrict', district: 'D7', hat: true }), /gained during a turn cannot be spent in that turn/);
  // The hat held at the START of a turn can be spent: on Ben's next turn it can.
  act(state, { type: 'chooseDistrict', district: 'D7', hat: false });
  if (kind(state) === 'bonusAction') act(state, { type: 'skipBonusAction' });
  while (kind(state) === 'freeActions') act(state, { type: 'endFreeActions' });
  gatherCoinsTurn(state); // Anna
  assert.equal(state.turn.player, 1);
  while (kind(state) === 'freeActions') act(state, { type: 'endFreeActions' });
  act(state, { type: 'placeWorker', space: 'W9' });
  assert.ok(getValidActions(state).some((a) => a.hat === true), 'the hat held at the start of the turn can be spent');
});

suite.check('R4.8.5, R18.8: the once-per-turn abilities (cards 14 and 28) are once per turn in continuous flow and once per round with rounds; card 21 gives +1 on every Gather in both', () => {
  // --- card 14 (Overland Route): a Move Train step in an opportunity ---------------------------
  for (const turnStructure of ['continuous', 'rounds']) {
    const state = pony(2, { turnStructure });
    ownCard(state, 0, 'PX14');
    claim(state, 1, 'SEA-SPO', 'POR-SPO');
    setHeads(state, 0, 'SEA', 'MIN');
    giveTokens(state, 0, 1); // a token to exchange, so that the opportunity is asked; the ability is what we look at
    gatherCoinsTurn(state);
    assert.equal(kind(state), 'freeActions');
    assert.ok(keys(state).includes('usePonyCard:PX14'));
    const used = take(state, 'usePonyCard', { card: 'PX14' });
    assert.equal(eventOf(used, 'ponyCardUsed').card, 'PX14');
    assert.equal(kind(state), 'layTracks');
    assert.ok(getValidActions(state).every((a) => a.type === 'moveTrain'), 'only Move Train steps');
    act(state, { type: 'moveTrain', from: 'SEA', to: 'SPO' });
    if (kind(state) === 'placeBuildings') act(state, { type: 'skipBuilding' }); // the paid building on arrival (R12.4)
    assert.equal(kind(state), 'freeActions', 'one step, then back to the opportunity');
    assert.ok(!keys(state).includes('usePonyCard:PX14'), 'used for this turn / this round');
    assert.match(
      getBlockReason(state, { type: 'usePonyCard', card: 'PX14' }),
      new RegExp(`already used Overland Route [(]card 14[)] this ${turnStructure === 'rounds' ? 'round' : 'turn'}`),
    );
    assert.deepEqual(state.modules.pony.roundUsed, turnStructure === 'rounds' ? ['PX14'] : []);
    // Play on, giving Anna a token at every decision so that her opportunities are asked, until the round ends (rounds)
    // or until her next turn (continuous). Is the ability on offer in her NEXT turn? Only in continuous flow.
    let offeredBeforeRoundEnd = false;
    let offeredAfterRoundEnd = false;
    let seenBen = false;
    for (let guard = 0; guard < 400 && !offeredAfterRoundEnd; guard++) {
      giveTokens(state, 0, 1);
      const top = topFrame(state);
      if (top.kind === 'freeActions' && top.player === 0 && keys(state).includes('usePonyCard:PX14')) {
        if (state.startPlayer === 0) offeredBeforeRoundEnd = true;
        else offeredAfterRoundEnd = true;
        if (turnStructure === 'continuous') break;
      }
      if (state.turn.player === 1) seenBen = true;
      const actions = getValidActions(state);
      act(state, actions.find((a) => a.type === 'endFreeActions') ?? actions.find((a) => a.type !== 'usePonyCard') ?? actions[0]);
    }
    assert.ok(seenBen);
    if (turnStructure === 'continuous') {
      assert.equal(offeredBeforeRoundEnd, true, 'continuous: Overland Route is usable again in the next turn');
    } else {
      assert.equal(offeredBeforeRoundEnd, false, 'rounds: not again before the round is over');
      assert.equal(offeredAfterRoundEnd, true, 'rounds: usable again once the round has ended');
    }
  }
  // --- card 21 (Efficient Operations): +1 on every Gather, whatever the structure ----------------
  for (const turnStructure of ['continuous', 'rounds']) {
    const state = pony(2, { turnStructure });
    ownCard(state, 0, 'PX21');
    for (let turn = 0; turn < 2; turn++) {
      const events = gatherTurn(state, 'D9'); // Anna
      const g = eventOf(events, 'gather');
      const extra = events.filter((e) => e.type === 'gain' && e.cause === 'pony:PX21');
      assert.equal(extra.length, 1, `${turnStructure}: +1 on Gather number ${turn + 1}`);
      assert.deepEqual([extra[0].item, extra[0].amount], [g.item, 1]);
      gatherTurn(state, 'D9'); // Ben
    }
  }
  // --- card 28 (Frontier Mastery): once per turn / round --------------------------------------
  for (const turnStructure of ['continuous', 'rounds']) {
    const state = pony(2, { turnStructure });
    ownCard(state, 0, 'PX28');
    give(state, 0, { resources: { wood: 3 }, hats: 0 });
    gatherCoinsTurn(state);
    assert.equal(kind(state), 'freeActions');
    take(state, 'usePonyCard', { card: 'PX28' });
    assert.equal(kind(state), 'bonusAction');
    assert.equal(topFrame(state).bonus, 'any');
    const usedList = () => (turnStructure === 'rounds' ? state.modules.pony.roundUsed : state.modules.pony.turn.usedCards);
    assert.deepEqual(usedList(), ['PX28'], 'the ability is spent when it is used');
    take(state, 'buyHat');
    assert.equal(state.players[0].hats, 1);
    assert.equal(state.players[0].resources.gunpowder, 0, 'no printed cost: the hat was bought with no Gunpowder at all');
    assert.ok(!(kind(state) === 'freeActions' && keys(state).includes('usePonyCard:PX28')));
    // Continuous flow: the next turn starts afresh. Rounds: still spent until the round ends.
    assert.deepEqual(usedList(), turnStructure === 'rounds' ? ['PX28'] : []);
  }
});

// =====================================================================================
// R18.7 - the 38 cards, by effect type
// =====================================================================================

/** Takes `n` resources of the given kind through the chooseResource decision. */
function takeResources(state, resource, n) {
  for (let i = 0; i < n; i++) take(state, 'chooseResource', { resource });
}

suite.check('R18.7 cards 1, 18: resources of your choice, one per action', () => {
  for (const [id, n] of [['PX1', 3], ['PX18', 5]]) {
    const state = pony(2);
    give(state, 0, { resources: {} });
    const events = buy(state, id);
    assert.equal(eventOf(events, 'ponyCardBought').kind, 'immediate');
    assert.equal(kind(state), 'chooseResource');
    assert.equal(topFrame(state).remaining, n);
    takeResources(state, 'iron', n - 1);
    take(state, 'chooseResource', { resource: 'wood' });
    assert.deepEqual([state.players[0].resources.iron, state.players[0].resources.wood], [n - 1, 1]);
    assert.ok(!state.modules.pony.players[0].ongoing.includes(id), 'an immediate card is discarded after it resolves');
    assert.equal(state.modules.pony.players[0].tokensHeld, 0);
  }
});

suite.check('R18.7 cards 4, 19: built tiles of your choice; card 4 wants two DIFFERENT types', () => {
  const four = pony(2);
  give(four, 0, { resources: {}, tiles: {} });
  buy(four, 'PX4');
  assert.equal(kind(four), 'chooseBuiltTile');
  assert.equal(keys(four).join(), 'chooseBuiltTile:bridge,chooseBuiltTile:ground,chooseBuiltTile:tunnel');
  take(four, 'chooseBuiltTile', { terrain: 'ground' });
  assert.deepEqual(keys(four), ['chooseBuiltTile:bridge', 'chooseBuiltTile:tunnel'], 'Ground is no longer on offer');
  assert.match(getBlockReason(four, { type: 'chooseBuiltTile', terrain: 'ground' }), /different types.*already took Ground/);
  take(four, 'chooseBuiltTile', { terrain: 'bridge' });
  assert.deepEqual({ ...four.players[0].builtTiles }, { ground: 1, tunnel: 0, bridge: 1 });

  const nineteen = pony(2);
  give(nineteen, 0, { resources: {}, tiles: {} });
  buy(nineteen, 'PX19');
  assert.equal(topFrame(nineteen).remaining, 3);
  for (let i = 0; i < 3; i++) take(nineteen, 'chooseBuiltTile', { terrain: 'tunnel' });
  assert.equal(nineteen.players[0].builtTiles.tunnel, 3, 'the same type three times is allowed');
});

suite.check('R18.7 cards 8, 23: choose one of three - 2 built tiles, or 3 resources, or 1 cowboy hat', () => {
  for (const id of ['PX8', 'PX23']) {
    const options = [];
    for (let option = 0; option < 3; option++) {
      const state = pony(2);
      give(state, 0, { resources: {}, tiles: {}, hats: 0 });
      buy(state, id);
      assert.equal(kind(state), 'chooseOption');
      assert.equal(topFrame(state).options.length, 3);
      options.push(topFrame(state).options.map((o) => o.text));
      assert.deepEqual(keys(state), ['chooseOption:0', 'chooseOption:1', 'chooseOption:2']);
      take(state, 'chooseOption', { option });
      if (option === 0) {
        assert.equal(topFrame(state).kind, 'chooseBuiltTile');
        take(state, 'chooseBuiltTile', { terrain: 'bridge' });
        take(state, 'chooseBuiltTile', { terrain: 'ground' });
        assert.deepEqual({ ...state.players[0].builtTiles }, { ground: 1, tunnel: 0, bridge: 1 });
      } else if (option === 1) {
        takeResources(state, 'gunpowder', 3);
        assert.equal(state.players[0].resources.gunpowder, 3);
      } else {
        assert.equal(state.players[0].hats, 1);
      }
    }
    assert.deepEqual(options[0], ['Gain 2 built track tiles of your choice', 'Gain 3 resources of your choice', 'Gain 1 cowboy hat']);
  }
});

suite.check('R18.7 cards 2, 17: carriages for free, each only if under its limit', () => {
  const two = pony(2);
  buy(two, 'PX2');
  assert.equal(two.players[0].train.storageCarriages, 2);
  const seventeen = pony(2);
  buy(seventeen, 'PX17');
  assert.deepEqual([seventeen.players[0].train.specialistCarriages.length, seventeen.players[0].train.storageCarriages], [2, 2]);
  const capped = pony(2);
  capped.players[0].train.storageCarriages = 3;
  buy(capped, 'PX17');
  assert.deepEqual([capped.players[0].train.specialistCarriages.length, capped.players[0].train.storageCarriages], [2, 3], 'only the carriage that fits');
});

suite.check('R18.7 cards 6, 27: hire for free (R8.6.4); card 27 up to 2, and "up to" can be stopped', () => {
  const six = pony(2);
  give(six, 0, { resources: {}, coins: 0 });
  buy(six, 'PX6');
  assert.equal(kind(six), 'hireSpecialist');
  assert.deepEqual(keys(six), ['hireSpecialist:crew', 'hireSpecialist:engineer', 'hireSpecialist:financier', 'hireSpecialist:miner'], 'a free hire: no skip');
  const coins = six.players[0].coins;
  const events = take(six, 'hireSpecialist', { specialist: 'financier' });
  assert.deepEqual(six.players[0].train.specialistCarriages[0].slots, ['crew', 'financier'], 'into the next free slot (R8.6.1)');
  assert.equal(six.players[0].coins, coins, 'no fee and no hire cost');
  assert.equal(eventOf(events, 'pay'), undefined);
  assert.equal(eventOf(events, 'hire').cause, 'pony:PX6');

  const twentySeven = pony(2);
  setTrain(twentySeven, 0, [['crew', null], [null, null]]);
  give(twentySeven, 0, { resources: {}, coins: 0 });
  buy(twentySeven, 'PX27');
  assert.ok(keys(twentySeven).includes('skipEffect'), 'up to 2: may stop');
  take(twentySeven, 'hireSpecialist', { specialist: 'miner' });
  take(twentySeven, 'hireSpecialist', { specialist: 'engineer' });
  assert.deepEqual(twentySeven.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'miner'], ['engineer', null]]);
  assert.equal(twentySeven.turn.player, 1, 'two hires made: the card is over');
  const stopped = pony(2);
  setTrain(stopped, 0, [['crew', null], [null, null]]);
  buy(stopped, 'PX27');
  take(stopped, 'hireSpecialist', { specialist: 'miner' });
  take(stopped, 'skipEffect');
  assert.deepEqual(stopped.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'miner'], [null, null]]);
  // A stop action exists only while a hire (or another optional part) is pending.
  assert.match(getBlockReason(stopped, { type: 'skipEffect' }), /does not apply now|You cannot do that now|no optional part/);
});

suite.check('R18.7 card 9: a carriage and a hire at its hire cost without the fee, either order, either part skippable', () => {
  const state = pony(2);
  setTrain(state, 0, [['crew', null]]);
  give(state, 0, { resources: { iron: 4, gunpowder: 4 }, coins: 3 });
  buy(state, 'PX9');
  assert.equal(kind(state), 'chooseOption');
  assert.deepEqual(topFrame(state).options.map((o) => o.text), [
    'Add a carriage of your choice, then Hire a specialist, paying its hire cost',
    'Hire a specialist, paying its hire cost, then Add a carriage of your choice',
  ]);
  take(state, 'chooseOption', { option: 0 });
  assert.equal(kind(state), 'addCarriage');
  assert.ok(keys(state).includes('skipEffect'), 'the carriage part may be skipped');
  take(state, 'addCarriage', { carriage: 'storage' });
  assert.equal(state.players[0].train.storageCarriages, 2);
  assert.equal(kind(state), 'hireSpecialist');
  assert.ok(keys(state).includes('skipEffect'));
  const coins = state.players[0].coins;
  take(state, 'hireSpecialist', { specialist: 'crew' });
  assert.deepEqual(state.players[0].resources, { iron: 3, wood: 0, gunpowder: 3 }, 'the hire cost of a Crew: 1 Iron + 1 Gunpowder');
  assert.equal(state.players[0].coins, coins, 'no 1-Coin fee');
  // The other order, skipping both parts.
  const skipping = pony(2);
  buy(skipping, 'PX9');
  take(skipping, 'chooseOption', { option: 1 });
  assert.equal(kind(skipping), 'hireSpecialist');
  take(skipping, 'skipEffect');
  assert.equal(kind(skipping), 'addCarriage');
  take(skipping, 'skipEffect');
  assert.equal(skipping.players[0].train.storageCarriages, 1);
  // With the specialist slots full, a new specialist carriage unlocks the hire: carriage first.
  const full = pony(2);
  setTrain(full, 0, [['crew', 'crew']]);
  give(full, 0, { resources: { iron: 3, gunpowder: 3 } });
  buy(full, 'PX9');
  take(full, 'chooseOption', { option: 0 });
  take(full, 'addCarriage', { carriage: 'specialist' });
  assert.equal(kind(full), 'hireSpecialist');
  take(full, 'hireSpecialist', { specialist: 'crew' });
  assert.deepEqual(full.players[0].train.specialistCarriages.map((c) => c.slots), [['crew', 'crew'], ['crew', null]]);
});

suite.check('R18.7 cards 10, 22: activate the train now with M = 1, the Foreman as a type of your choice', () => {
  for (const id of ['PX10', 'PX22']) {
    const state = pony(2, { moduleCarriageUpgrades: true });
    setTrain(state, 0, [['crew', 'miner']]);
    installTile(state, 0, 1, 'U1-gunpowder');
    give(state, 0, { resources: { iron: 2, gunpowder: 4 }, coins: 0 });
    buy(state, id);
    assert.equal(kind(state), 'chooseForemanType');
    assert.deepEqual(keys(state), ['chooseForemanType:crew', 'chooseForemanType:engineer', 'chooseForemanType:financier', 'chooseForemanType:miner']);
    take(state, 'chooseForemanType', { specialist: 'miner' });
    const frame = topFrame(state);
    assert.equal(frame.kind, 'trainActivation');
    assert.equal(frame.cause, `pony:${id}`);
    assert.deepEqual(frame.steps.map((s) => (s.level === 0 ? 'foreman-' + s.type : s.type)), ['foreman-miner', 'upgrade', 'crew', 'miner'], 'M = 1; the upgrade tile is in the list');
    take(state, 'useStep'); // Foreman as a Miner: 2 Gunpowder -> 1 Tunnel
    assert.equal(state.players[0].builtTiles.tunnel, 1);
    take(state, 'useStep'); // Crew
    assert.equal(state.players[0].builtTiles.ground, 1);
  }
});

suite.check('R18.7 card 11: return up to 3 resources and take the same number of your choice', () => {
  const state = pony(2);
  give(state, 0, { resources: { iron: 2, wood: 1 } });
  buy(state, 'PX11');
  assert.equal(kind(state), 'exchange');
  assert.deepEqual(keys(state), ['returnResource:gunpowder'.replace('gunpowder', 'iron'), 'returnResource:wood', 'skipEffect'].sort());
  take(state, 'returnResource', { resource: 'iron' });
  take(state, 'returnResource', { resource: 'iron' });
  assert.deepEqual(state.players[0].resources, { iron: 0, wood: 1, gunpowder: 0 });
  take(state, 'skipEffect'); // enough: 2 given back
  assert.equal(kind(state), 'chooseResource');
  assert.equal(topFrame(state).remaining, 2);
  takeResources(state, 'gunpowder', 2);
  assert.deepEqual(state.players[0].resources, { iron: 0, wood: 1, gunpowder: 2 });
  // Giving back the most (3) ends the first half by itself.
  const full = pony(2);
  give(full, 0, { resources: { iron: 4 } });
  buy(full, 'PX11');
  for (let i = 0; i < 3; i++) take(full, 'returnResource', { resource: 'iron' });
  assert.equal(topFrame(full).kind, 'chooseResource');
  assert.equal(topFrame(full).remaining, 3);
});

suite.check('R18.7 card 12: 1 VP for each inland city that is an end of a route you own, booked to ponyCards', () => {
  const state = pony(2);
  claim(state, 0, 'POR-SPO', 'SEA-SPO', 'POR-REN'); // Spokane (twice), Reno: 2 inland cities
  const events = buy(state, 'PX12');
  assert.deepEqual(vpOf(events, 0), { ponyCards: 2 });
  assert.equal(state.players[0].vp.ponyCards, 2);
});

suite.check('R18.7 cards 7: 5 VP are booked to ponyCards (R20.1), not to a base source', () => {
  const state = pony(2);
  const events = buy(state, 'PX7');
  assert.deepEqual(vpOf(events, 0), { ponyCards: 5 });
  assert.equal(state.players[0].vp.track, 0);
});

suite.check('R18.7 cards 13, 24: up to 2 available tier 1 Congress entries, without lobby points or Coins', () => {
  for (const id of ['PX13', 'PX24']) {
    const state = pony(2);
    give(state, 0, { resources: {}, coins: 0 });
    buy(state, id);
    assert.equal(kind(state), 'freeCongress');
    assert.deepEqual(keys(state), ['skipEffect', 'takeCongressEntry:C1', 'takeCongressEntry:C2'], 'Reset has nothing to return yet');
    const coins = state.players[0].coins;
    const first = take(state, 'takeCongressEntry', { entry: 'C1' });
    assert.equal(eventOf(first, 'congressEntry').free, true);
    assert.equal(state.players[0].coins, coins, 'no Coins paid');
    assert.equal(state.players[0].resources.wood, 2);
    assert.deepEqual(keys(state), ['skipEffect', 'takeCongressEntry:C2', 'takeCongressEntry:CR'], 'Reset is a tier 1 entry and now has a senator to return');
    take(state, 'takeCongressEntry', { entry: 'C2' });
    assert.equal(state.players[0].resources.iron, 2);
    assert.equal(state.turn.player, 1, 'two entries taken: the card is over');
    assert.equal(state.congress.used.C1 && state.congress.used.C2, true);
  }
  // Stopping after one.
  const state = pony(2);
  buy(state, 'PX13');
  take(state, 'takeCongressEntry', { entry: 'C1' });
  take(state, 'skipEffect');
  assert.equal(state.congress.used.C2, false);
});

suite.check('R18.7 card 3: up to 2 Move Train steps now (and only moves); card 5: 1 claim step, a Lay Tracks action of its own (R11.10)', () => {
  const three = pony(2);
  claim(three, 1, 'SEA-SPO', 'POR-SPO');
  setHeads(three, 0, 'SEA', 'MIN');
  give(three, 0, { tiles: { ground: 2, bridge: 2 } });
  buy(three, 'PX3');
  assert.equal(kind(three), 'layTracks');
  assert.equal(topFrame(three).steps, 2);
  assert.ok(getValidActions(three).every((a) => a.type === 'moveTrain'), 'a claim is not offered although the tiles are held');
  act(three, { type: 'moveTrain', from: 'SEA', to: 'SPO' });
  if (kind(three) === 'placeBuildings') act(three, { type: 'skipBuilding' });
  assert.ok(keys(three).includes('stopLaying'), 'up to 2: may stop after one');
  act(three, { type: 'moveTrain', from: 'SPO', to: 'POR' });
  if (kind(three) === 'placeBuildings') act(three, { type: 'skipBuilding' });
  assert.notEqual(kind(three), 'layTracks', 'two steps taken: over');
  assert.equal(three.players[0].railheads[0], 'POR');

  const five = pony(2, legislative(6));
  give(five, 0, { tiles: MAP.routeById['SEA-HEL'].cost });
  setHeads(five, 0, 'SEA', 'MIN');
  const events = buy(five, 'PX5');
  assert.equal(five.map.routeOwner['SEA-HEL'], 0, 'the one claim was made (the only legal one, so the engine took it)');
  finishLaying(five, 0);
  assert.equal(vpOf(events.concat([]), 0).legislative, undefined);
  assert.equal(five.players[0].vp.legislative, 5, 'card 6 of the Legislative Agenda: 5 slots in one Lay Tracks action - the card\'s own');
});

suite.check('R18.7 card 15: at the start of each of your train activations one specialist is activated one extra time', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX15');
  setTrain(state, 0, [['crew', 'miner'], ['engineer', null]]);
  give(state, 0, { resources: { iron: 6 } });
  placeAndChoose(state, spaceFor('D4'), 'D4');
  assert.equal(kind(state), 'chooseExtraActivation');
  assert.equal(keys(state).length, 3, 'one per specialist in the train: the Foreman is not one');
  assert.ok(!keys(state).some((k) => k.includes(':0')));
  take(state, 'chooseExtraActivation', { level: 2, slot: 1 });
  const steps = topFrame(state).steps.map((s) => `${s.type}${s.level}`);
  assert.deepEqual(steps, ['crew0', 'crew1', 'miner1', 'engineer2', 'engineer2', 'engineer2'], 'the level 2 Engineer acts 2 + 1 times');
  // It is asked in every activation; with a single specialist the choice is made by the engine.
  const lone = pony(2);
  ownCard(lone, 0, 'PX15');
  give(lone, 0, { resources: { iron: 6 } });
  const events = placeAndChoose(lone, spaceFor('D4'), 'D4');
  assert.deepEqual(topFrame(lone).steps.map((s) => `${s.type}${s.level}`), ['crew0', 'crew1', 'crew1']);
  assert.equal(events.filter((e) => e.type === 'action' && e.action.type === 'chooseExtraActivation' && e.auto).length, 1);
  // No specialist: nothing to choose.
  const none = pony(2);
  ownCard(none, 0, 'PX15');
  setTrain(none, 0, [[null, null]]);
  give(none, 0, { resources: { iron: 6 } });
  placeAndChoose(none, spaceFor('D4'), 'D4');
  assert.equal(topFrame(none).kind, 'trainActivation');
});

suite.check('R18.7 card 16: a telegraph station gives 2 resources of your choice', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX16');
  give(state, 0, { resources: {} });
  claimTurn(state, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.equal(kind(state), 'chooseResource');
  assert.equal(topFrame(state).remaining, 2);
  takeResources(state, 'wood', 2);
  assert.equal(state.players[0].resources.wood, 2);
  // A railway station gives nothing.
  const rail2 = pony(2);
  ownCard(rail2, 0, 'PX16');
  claimTurn(rail2, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') });
  assert.notEqual(kind(rail2), 'chooseResource');
});

suite.check('R18.7 cards 20, 37: Congress prices - the first entry of an activation 1 Coin cheaper; tier 1 entries cost 0 Coins', () => {
  const run = (cards) => {
    const state = pony(2);
    for (const id of cards) ownCard(state, 0, id);
    setTrain(state, 0, [['financier', null]]);
    give(state, 0, { coins: 5, resources: {} });
    placeAndChoose(state, 'W2', 'D2'); // the Foreman is a Financier: 1 lobby point, the window is open
    const paid = [];
    let c = state.players[0].coins;
    take(state, 'takeCongressEntry', { entry: 'C1' });
    paid.push(c - state.players[0].coins);
    c = state.players[0].coins;
    // The Financier step: 1 more lobby point.
    take(state, 'takeCongressEntry', { entry: 'C2' });
    paid.push(c - state.players[0].coins);
    return paid;
  };
  assert.deepEqual(run([]), [1, 1], 'no card: 1 Coin each');
  assert.deepEqual(run(['PX20']), [0, 1], 'card 20: the first entry costs 1 less, the second the full price');
  assert.deepEqual(run(['PX37']), [0, 0], 'card 37: tier 1 entries cost 0 Coins');
  assert.deepEqual(run(['PX20', 'PX37']), [0, 0], 'never below 0');
  // Tier 2 is not tier 1: C3 still costs 2 Coins (lobby points: Foreman + Financier). Card 37 only touches tier 1 (and says the lobby point stays).
  const tier2 = pony(2);
  ownCard(tier2, 0, 'PX37');
  setTrain(tier2, 0, [['financier', null]]);
  give(tier2, 0, { coins: 5, resources: {} });
  placeAndChoose(tier2, 'W2', 'D2');
  take(tier2, 'closeCongress');
  take(tier2, 'takeCongressEntry', { entry: 'C3' });
  assert.equal(tier2.players[0].coins, 3, 'C3 cost its 2 Coins');
  const lobby = pony(2);
  ownCard(lobby, 0, 'PX37');
  setTrain(lobby, 0, [[null, null]]);
  give(lobby, 0, { coins: 5 });
  placeAndChoose(lobby, 'W2', 'D2');
  assert.equal(topFrame(lobby).lobby, 1);
  const coinsBefore = lobby.players[0].coins;
  assert.match(describeAction(lobby, { type: 'takeCongressEntry', entry: 'C1' }), /\(1 lobby point \+ 0 Coins\)/, 'the price on the button');
  take(lobby, 'takeCongressEntry', { entry: 'C1' });
  assert.equal(lobby.players[0].coins, coinsBefore, 'no Coins');
  assert.equal(lobby.turn.player, 1, 'the lobby point was spent: the activation is over');
});

suite.check('R18.7 card 21, 36: +1 after multiplying (card 21), production P one higher on all four tracks so the bonus IS multiplied (card 36)', () => {
  const plain = pony(2);
  const base = production(plain, 0, 'iron');
  const withCard = pony(2);
  ownCard(withCard, 0, 'PX36');
  for (const track of ['wood', 'coins', 'iron', 'gunpowder']) assert.equal(production(withCard, 0, track), production(plain, 0, track) + 1);
  assert.equal(production(withCard, 1, 'iron'), base, 'only the owner');
  // M = 2 (a worker next to Gather Iron): (P + 1) x 2.
  const spaces = SPACE_IDS.filter((w) => SPACE_DISTRICTS[w].includes('D3'));
  put(withCard, 0, spaces[0]);
  const events = placeAndChoose(withCard, spaces[1], 'D3');
  const g = eventOf(events, 'gather');
  assert.deepEqual([g.production, g.multiplier, g.amount], [base + 1, 2, (base + 1) * 2]);
});

suite.check('R18.7 cards 25, 29, 35: completion +10, first connection +3, +3 per slot of that route - all booked to ponyCards and adding up with the Legislative Agenda (R18.9)', () => {
  const crossing25 = pony(2);
  ownCard(crossing25, 0, 'PX25');
  const { routeId, from } = almostCrossing(crossing25, 0);
  const done = claimTurn(crossing25, routeId, from);
  assert.equal(vpOf(done, 0).ponyCards, 10);
  assert.equal(vpOf(done, 0).completion, K.SCORING.completionVp + K.SCORING.completionVpPerSlot * MAP.routeById[routeId].length);

  const state = pony(2, legislative(9));
  ownCard(state, 0, 'PX29');
  ownCard(state, 0, 'PX35');
  const events = claimTurn(state, 'SEA-SPO', 'SEA');
  const vp = vpOf(events, 0);
  assert.equal(vp.firstConnection, 5, 'the base stays 5');
  assert.equal(vp.legislative, 3, 'card 9 of the Legislative Agenda');
  assert.equal(vp.ponyCards, 3 + 3 * MAP.routeById['SEA-SPO'].length, 'card 29 (+3) and card 35 (+3 per slot of the route)');
  // The cards belong to their owner: Ben gets nothing from them.
  assert.equal(state.players[1].vp.ponyCards, 0);
});

suite.check('R18.7 card 26: tolls paid to you are 5 VP instead of 3 (the 3 stay in toll, the 2 more are ponyCards)', () => {
  const state = pony(2);
  ownCard(state, 1, 'PX26');
  rail(state, 1, 'SPO');
  const events = claimTurn(state, 'SEA-SPO', 'SEA');
  assert.deepEqual(vpOf(events, 1), { toll: K.SCORING.tollVp, ponyCards: 5 - K.SCORING.tollVp });
  assert.equal(state.players[1].vp.toll + state.players[1].vp.ponyCards, 5);
  // Without the card: 3.
  const bare = pony(2);
  rail(bare, 1, 'SPO');
  assert.deepEqual(vpOf(claimTurn(bare, 'SEA-SPO', 'SEA'), 1), { toll: 3 });
});

suite.check('R18.7 card 28: any one bonus action, at no printed cost, outside the limit of R7.2; a hire still pays its hire cost', () => {
  const state = pony(2, { ...UPGRADES, bonusActionLimit: 'once-per-game' });
  ownCard(state, 0, 'PX28');
  setTrain(state, 0, [['crew', null]]);
  give(state, 0, { resources: { iron: 2, gunpowder: 2 }, coins: 0, hats: 0 });
  gatherCoinsTurn(state);
  take(state, 'usePonyCard', { card: 'PX28' });
  assert.equal(kind(state), 'bonusAction');
  const offered = keys(state);
  assert.ok(offered.includes('buyHat') && offered.includes('addCarriage:storage') && offered.includes('hireSpecialist:crew') && offered.includes('installUpgrade:U1-wood:1'));
  assert.ok(!offered.includes('skipBonusAction'), 'the player has committed to a bonus action');
  assert.match(getBlockReason(state, { type: 'skipBonusAction', player: 0 }), /You have used Frontier Mastery/);
  const coinsBefore = state.players[0].coins;
  const events = take(state, 'hireSpecialist', { specialist: 'crew' });
  assert.deepEqual(state.players[0].resources, { iron: 1, wood: 0, gunpowder: 1 }, 'the hire cost of a Crew, but no 1-Coin fee (the printed cost)');
  assert.equal(state.players[0].coins, coinsBefore, 'the Coin fee was not charged');
  assert.equal(eventOf(events, 'hire').cause, 'pony:PX28');
  assert.deepEqual({ ...state.players[0].bonusActionsUsed }, { upgrade: false, hire: false, hat: false, carriage: false }, 'does not count towards bonusActionLimit, and marks nothing');
  // An upgrade installed this way costs no Iron.
  const up = pony(2, UPGRADES);
  ownCard(up, 0, 'PX28');
  give(up, 0, { resources: {}, coins: 0 });
  gatherCoinsTurn(up);
  take(up, 'usePonyCard', { card: 'PX28' });
  take(up, 'installUpgrade', { tile: 'U1-wood', level: 1 });
  assert.equal(up.modules.upgrades.installed[0][0], 'U1-wood');
  assert.equal(up.players[0].resources.iron, 0);
});

suite.check('R18.7 card 30: Reset gives 2 VP per senator returned instead of 1 (the base 1 in congress, the other in ponyCards)', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX30');
  setTrain(state, 0, [['crew', null]]);
  give(state, 0, { coins: 3, resources: {} });
  state.congress.used.C1 = true;
  state.congress.used.C3 = true;
  state.congress.used.C5 = true;
  placeAndChoose(state, 'W2', 'D2');
  const events = take(state, 'takeCongressEntry', { entry: 'CR' });
  assert.equal(eventOf(events, 'senatorsReset').count, 3);
  assert.deepEqual(vpOf(events, 0), { congress: 3, ponyCards: 3 });
  assert.ok(Object.values(state.congress.used).every((u) => !u));
});

suite.check('R18.7 card 32: each train activation the owner chooses what the Foreman acts as', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX32');
  setTrain(state, 0, [[null, null]]);
  give(state, 0, { resources: { iron: 4 }, coins: 0 });
  placeAndChoose(state, spaceFor('D4'), 'D4'); // Ground Tracks would make the Foreman a Crew
  assert.equal(kind(state), 'chooseForemanType');
  assert.equal(keys(state).length, 4);
  take(state, 'chooseForemanType', { specialist: 'financier' });
  assert.equal(state.players[0].builtTiles.ground, 0, 'the Foreman acted as a Financier, not as a Crew');
  // Without the card the district decides.
  const plain = pony(2);
  give(plain, 0, { resources: { iron: 4 } });
  placeAndChoose(plain, spaceFor('D4'), 'D4');
  assert.equal(topFrame(plain).kind, 'trainActivation');
});

suite.check('R18.7 card 33: until the end of this turn each specialist of the chosen type is activated twice as often; the Foreman is not affected', () => {
  const state = pony(2);
  stock(state, 'PX33');
  setTrain(state, 1, [['crew', 'miner'], ['crew', null]]);
  give(state, 1, { resources: { iron: 20, gunpowder: 20 } });
  giveTokens(state, 1, 5);
  gatherCoinsTurn(state); // Ben's first opportunity
  act(state, { type: 'buyPonyCard', card: 'PX33' });
  assert.equal(kind(state), 'chooseSpecialistType');
  assert.deepEqual(keys(state), ['chooseSpecialistType:crew', 'chooseSpecialistType:miner'], 'only the types in the train');
  take(state, 'chooseSpecialistType', { specialist: 'crew' });
  assert.equal(state.modules.pony.turn.doubled, 'crew');
  assert.equal(kind(state), 'workerStep', 'no token left: the opportunity closed by itself');
  placeAndChoose(state, spaceFor('D4'), 'D4');
  const steps = topFrame(state).steps.map((s) => `${s.type}${s.level}`);
  const count = (x) => steps.filter((s) => s === x).length;
  assert.equal(count('crew0'), 1, 'the Foreman is not doubled');
  assert.equal(count('crew1'), 2, 'level 1: 1 x 2');
  assert.equal(count('crew2'), 4, 'level 2: 2 x 2');
  assert.equal(count('miner1'), 1, 'another type: as normal');
  // It lasts until the end of the turn only.
  drive(state, (s) => s.turn.player === 1, (actions) => actions.find((a) => a.type === 'skipStep') ?? actions.find((a) => a.type === 'closeCongress') ?? actions.find((a) => a.type === 'endFreeActions') ?? actions[0]);
  assert.equal(state.modules.pony.turn.doubled, null);
});

suite.check('R18.7 card 34: the telegraph row VP are doubled (the printed VP stay in telegraph, the doubling is ponyCards)', () => {
  const state = pony(2);
  ownCard(state, 0, 'PX34');
  const events = claimTurn(state, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.deepEqual([vpOf(events, 0).telegraph, vpOf(events, 0).ponyCards], [1, 1]);
  // The second telegraph station prints 2, so the doubling adds 2.
  const again = pony(2);
  ownCard(again, 0, 'PX34');
  again.players[0].telegraphsPlaced = 1;
  const e = claimTurn(again, 'SEA-SPO', 'SEA', { building: placeTelegraph('SPO') });
  assert.deepEqual([vpOf(e, 0).telegraph, vpOf(e, 0).ponyCards], [2, 2]);
  // A railway station scores nothing, doubled or not.
  const rail3 = pony(2);
  ownCard(rail3, 0, 'PX34');
  assert.equal(vpOf(claimTurn(rail3, 'SEA-SPO', 'SEA', { building: placeRailway('SPO') }), 0).ponyCards ?? 0, 0);
});

suite.check('R18.7 cards 31, 38 and R18.10: endgame cards and the tokens still held score in final scoring, booked to ponyEnd', () => {
  const state = pony(2, { maxTurnsPerPlayer: 1 });
  ownCard(state, 0, 'PX31');
  ownCard(state, 0, 'PX38');
  // Both buildings of Spokane and Reno are Anna's: 2 cities. 4 tokens collected, 3 still held.
  ['SPO', 'REN'].forEach((c) => { rail(state, 0, c); tele(state, 0, c); });
  giveTokens(state, 0, 3, 4);
  giveTokens(state, 1, 2, 2);
  const projected = finalSourceValues(state, 0).ponyEnd;
  assert.equal(projected, 3 * K.SCORING.ponyTokenEndVp + 2 * 5 + 4 * 3);
  assert.equal(state.players[0].vp.ponyEnd, 0, 'nothing during play');
  // The ability to exchange keeps tokens: end the opportunities at once.
  while (state.phase !== 'ended') {
    if (kind(state) === 'freeActions') act(state, { type: 'endFreeActions' });
    else gatherCoinsTurn(state);
  }
  assert.equal(state.players[0].vp.ponyEnd, projected);
  assert.equal(state.players[1].vp.ponyEnd, 2 * K.SCORING.ponyTokenEndVp, '1 VP per token held, no endgame card');
  const score = scoreGame(state);
  assert.equal(score.players[0].bySource.ponyEnd, projected);
});

suite.check('R18.7: cards 3 and 14 are not in a game with claimFrom = network, card 31 not with bothBuildingsSameOwner = false', () => {
  for (let seed = 0; seed < 20; seed++) {
    const network = pony(2, { claimFrom: 'network' }, { seed }).modules.pony;
    const same = pony(2, { bothBuildingsSameOwner: false }, { seed }).modules.pony;
    const ids = (m) => [...Object.values(m.decks).flat(), ...Object.values(m.market).flat()];
    assert.ok(!ids(network).includes('PX3') && !ids(network).includes('PX14'));
    assert.ok(!ids(same).includes('PX31'));
  }
});

suite.check('R10.1 C6 (the placeBuildings effect, with the chooseOne of cards 8 and 23): buildings in a connected city, or 3 VP', () => {
  const state = startWith(2);
  claim(state, 1, 'SEA-SPO'); // Spokane is a connected city
  setTrain(state, 0, [['financier', 'financier']]);
  give(state, 0, { coins: 5, resources: {} });
  placeAndChoose(state, 'W2', 'D2'); // the Foreman, then two Financiers: 3 lobby points in all
  take(state, 'closeCongress');
  take(state, 'closeCongress');
  take(state, 'takeCongressEntry', { entry: 'C6' });
  assert.equal(kind(state), 'chooseOption');
  assert.deepEqual(keys(state), ['chooseOption:0', 'chooseOption:1']);
  take(state, 'chooseOption', { option: 0 });
  assert.equal(kind(state), 'placeBuildings');
  take(state, 'placeTelegraphStation', { city: 'SPO' });
  assert.equal(state.map.telegraphStation.SPO, 0);
});

// =====================================================================================
// Coverage: what this suite exercised
// =====================================================================================

suite.check('every effect type with a handler ran in this suite, and so did the effect of every card that has one', () => {
  const never = Object.keys(EFFECT_HANDLERS).filter((type) => !ran.types.has(type));
  assert.deepEqual(never, [], `effect types never run: ${never.join(', ')}`);
  // Legislative Agenda cards: every trigger effect.
  const missingLA = K.LEGISLATIVE_CARDS.filter((c) => !ran.causes.has(`legislative:${c.id}`)).map((c) => c.id);
  assert.deepEqual(missingLA, [], `Legislative Agenda cards whose effect never ran: ${missingLA.join(', ')}`);
  // Pony Express: immediate cards run their effects at once; ongoing cards with triggers or abilities when their event happens.
  const missingPX = K.PONY_CARDS.filter((c) => c.effects.some((e) => !STANDING_EFFECT_TYPES.includes(e.type) || e.type === 'trigger' || e.type === 'oncePerTurn'))
    .filter((c) => !ran.causes.has(`pony:${c.id}`))
    .map((c) => c.id);
  assert.deepEqual(missingPX, [], `Pony Express cards whose effect never ran: ${missingPX.join(', ')}`);
  // Upgrade tiles: every tile with a one-off effect ran it at its step.
  const missingU = K.UPGRADE_TILES.filter((t) => !ran.causes.has(`upgrade:${t.id}`)).map((t) => t.id);
  assert.deepEqual(missingU, [], `upgrade tiles whose effect never ran: ${missingU.join(', ')}`);
});

suite.check('every module action type was taken in this suite, and every module event type was emitted', () => {
  assert.ok(STOP_ACTION_TYPES.includes('endFreeActions'));
  for (const type of ['installUpgrade', 'buyPonyCard', 'exchangeToken', 'usePonyCard', 'endFreeActions', 'skipEffect', 'returnResource', 'chooseForemanType', 'chooseSpecialistType', 'chooseExtraActivation', 'declineFreeEntry']) {
    assert.ok(takenTypes.has(type), `${type} was never applied in rules-modules`);
  }
  for (const type of ['upgradeInstalled', 'upgradeStep', 'milestoneClaimed', 'ponyToken', 'ponyCardBought', 'ponyMarketRefill', 'tokenExchanged', 'ponyCardUsed', 'resourceReturned', 'foremanType', 'extraActivation', 'activationsDoubled']) {
    assert.ok(emittedTypes.has(type), `${type} was never emitted in rules-modules`);
  }
});

suite.finish();
