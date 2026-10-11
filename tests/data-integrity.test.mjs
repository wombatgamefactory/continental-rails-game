// data-integrity.test.mjs - the module data against the module code.
//
// Semantics: permanently green; exits 1 on any failure.
//
// tests/rules-data.test.mjs checks the SHAPE of the data tables (counts, ids,
// the words of the effect vocabulary) and needs no module code. This suite
// walks the same data and checks it against the code that must run it, so that
// a typo in a table fails here and not in the middle of a game:
//
//   - ids are unique, in every table and across the cards of one deck;
//   - every metric a goal, milestone, condition or per-unit effect names is
//     known to the interpreter of conditions.js, and the interpreter holds no
//     metric the data never names;
//   - every effect type any card or tile uses has a handler (EFFECT_HANDLERS)
//     or is a standing rule with a reader; every trigger event has a firing
//     site; every modifier has a reader;
//   - the data survives a JSON round trip unchanged;
//   - on a fresh board no milestone is claimable and no goal has a leader, for
//     2, 3 and 4 players.

import assert from 'node:assert/strict';
import {
  RULES,
  EFFECT_TYPES,
  TRIGGER_EVENTS,
  MODIFIER_KINDS,
  CONDITION_OPS,
  METRIC_NAMES,
  METRICS,
  EFFECT_HANDLERS,
  STANDING_EFFECT_TYPES,
  TRIGGER_SITES,
  MODIFIER_READERS,
  createGame,
  evaluateCondition,
  describeProgress,
  metricValue,
  goalStandings,
  goalsInPlay,
  cardRemoved,
  scoreGame,
} from '../src/engine/index.js';
import { makeSuite } from './helpers/play.mjs';

const suite = makeSuite('data-integrity');

const TABLES = {
  UPGRADE_TILES: RULES.UPGRADE_TILES,
  GOAL_CARDS: RULES.GOAL_CARDS,
  MILESTONE_TILES: RULES.MILESTONE_TILES,
  LEGISLATIVE_CARDS: RULES.LEGISLATIVE_CARDS,
  PONY_CARDS: RULES.PONY_CARDS,
};

/** Every effect object reachable from a table entry: its `effects` and every effect nested inside them (the option branches included). */
function collectEffects(list, where, out = []) {
  for (const effect of list) {
    out.push({ effect, where });
    if (effect.effect) collectEffects([effect.effect], `${where} -> effect`, out);
    if (effect.options) effect.options.forEach((opt, i) => collectEffects(opt, `${where} option ${i + 1}`, out));
  }
  return out;
}

/** All effects of the five module tables and of both Congress tables. */
function allEffects() {
  const out = [];
  for (const [name, table] of Object.entries(TABLES)) {
    for (const entry of table) if (entry.effects) collectEffects(entry.effects, `${name} ${entry.id}`, out);
  }
  for (const [name, table] of Object.entries(RULES.CONGRESS.tables)) {
    for (const entry of table) collectEffects(entry.effects, `Congress ${name} ${entry.id}`, out);
  }
  return out;
}

suite.check('ids are unique in every table, and card numbers are unique in a deck', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    const ids = table.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids`);
    const numbers = table.filter((e) => e.number !== undefined).map((e) => e.number);
    assert.equal(new Set(numbers).size, numbers.length, `${name}: duplicate numbers`);
  }
  const all = Object.values(TABLES).flatMap((t) => t.map((e) => e.id));
  assert.equal(new Set(all).size, all.length, 'an id is used in two tables');
  for (const [name, table] of Object.entries(RULES.CONGRESS.tables)) {
    assert.equal(new Set(table.map((e) => e.id)).size, table.length, `Congress ${name}: duplicate entry ids`);
  }
});

suite.check('every metric the data names is known to the interpreter, and the interpreter has no metric nobody names', () => {
  const named = new Set();
  for (const goal of RULES.GOAL_CARDS) named.add(goal.metric);
  for (const tile of RULES.MILESTONE_TILES) named.add(tile.condition.metric);
  for (const { effect } of allEffects()) {
    if (effect.condition) named.add(effect.condition.metric);
    if ((effect.type === 'vpPer' || effect.type === 'endVpPer') && effect.metric) named.add(effect.metric);
  }
  for (const metric of named) {
    assert.ok(Object.prototype.hasOwnProperty.call(METRICS, metric), `the data names the metric "${metric}", which conditions.js does not know`);
    assert.ok(METRIC_NAMES.includes(metric), `"${metric}" is missing from METRIC_NAMES`);
  }
  assert.deepEqual(Object.keys(METRICS).sort(), METRIC_NAMES.slice().sort(), 'METRICS and METRIC_NAMES must list the same metrics');
  for (const metric of METRIC_NAMES) assert.ok(named.has(metric), `METRIC_NAMES lists "${metric}", which no card, goal or milestone uses`);
});

suite.check('an unknown metric, operator or condition is false, never true', () => {
  const state = createGame({ playerCount: 2, seed: 1 });
  for (const op of CONDITION_OPS) {
    assert.equal(evaluateCondition(state, 0, { metric: 'noSuchMetric', op, value: 0 }), false);
    assert.equal(evaluateCondition(state, 0, { metric: 'hasOwnProperty', op, value: 0 }), false);
  }
  assert.equal(evaluateCondition(state, 0, { metric: 'carriages', op: 'roughly', value: 0 }), false);
  assert.equal(evaluateCondition(state, 0, { metric: 'carriages', op: '>=', value: 'two' }), false);
  assert.equal(evaluateCondition(state, 0, undefined), false);
  assert.equal(metricValue(state, 0, 'noSuchMetric'), null);
  // A metric that needs the event it is about answers "unknown" without one.
  assert.equal(metricValue(state, 0, 'cityIsJunction'), null);
  assert.equal(evaluateCondition(state, 0, { metric: 'cityIsJunction', op: '>=', value: 0 }), false);
  assert.equal(describeProgress(state, 0, { metric: 'noSuchMetric', op: '>=', value: 1 }).known, false);
  assert.equal(describeProgress(state, 0, null).known, false);
});

suite.check('every effect type used by a card or tile has a handler; every handler or standing type is in the vocabulary', () => {
  const known = new Set([...Object.keys(EFFECT_HANDLERS), ...STANDING_EFFECT_TYPES]);
  for (const { effect, where } of allEffects()) {
    assert.ok(known.has(effect.type), `${where}: the effect type "${effect.type}" has no handler`);
  }
  assert.deepEqual([...known].sort(), EFFECT_TYPES.slice().sort(), 'handlers plus standing types must be exactly the vocabulary');
  for (const type of Object.keys(EFFECT_HANDLERS)) assert.ok(!STANDING_EFFECT_TYPES.includes(type), `${type} is both a handler and a standing rule`);
  const used = new Set(allEffects().map((e) => e.effect.type));
  for (const type of EFFECT_TYPES) assert.ok(used.has(type), `the vocabulary has "${type}", which no card, tile or Congress entry uses`);
});

suite.check('every trigger event has a firing site, every modifier a reader, and the limits are ones the code knows', () => {
  const events = new Set();
  const mods = new Set();
  for (const { effect, where } of allEffects()) {
    if (effect.type === 'trigger') {
      events.add(effect.on);
      assert.ok(Object.prototype.hasOwnProperty.call(TRIGGER_SITES, effect.on), `${where}: trigger "${effect.on}" has no firing site`);
      assert.ok(['oncePerGame', 'oncePerActivation', undefined].includes(effect.limit), `${where}: unknown limit "${effect.limit}"`);
    }
    if (effect.type === 'modifier') {
      mods.add(effect.what);
      assert.ok(Object.prototype.hasOwnProperty.call(MODIFIER_READERS, effect.what), `${where}: modifier "${effect.what}" has no reader`);
      assert.ok(['firstPerActivation', undefined].includes(effect.limit), `${where}: unknown limit "${effect.limit}"`);
    }
    if (effect.type === 'untilEndOfTurn') {
      mods.add(effect.modifier.what);
      assert.ok(Object.prototype.hasOwnProperty.call(MODIFIER_READERS, effect.modifier.what), `${where}: modifier "${effect.modifier.what}" has no reader`);
    }
  }
  assert.deepEqual(Object.keys(TRIGGER_SITES).sort(), TRIGGER_EVENTS.slice().sort(), 'TRIGGER_SITES and TRIGGER_EVENTS must list the same events');
  assert.deepEqual(Object.keys(MODIFIER_READERS).sort(), MODIFIER_KINDS.slice().sort(), 'MODIFIER_READERS and MODIFIER_KINDS must list the same modifiers');
  for (const event of TRIGGER_EVENTS) assert.ok(events.has(event), `the trigger event "${event}" is used by no card`);
  for (const kind of MODIFIER_KINDS) assert.ok(mods.has(kind), `the modifier "${kind}" is used by no card`);
  // `oncePerGame` is kept in the Legislative Agenda state, so only a Legislative Agenda card may use it.
  for (const card of RULES.PONY_CARDS) {
    for (const { effect } of collectEffects(card.effects, card.id)) assert.notEqual(effect.limit, 'oncePerGame', `${card.id} uses oncePerGame, which only the Legislative Agenda supports`);
  }
});

suite.check('the effects of one trigger are the kinds that make sense inside it', () => {
  const INSIDE_ONLY = ['gainGathered', 'vpPerSlot', 'extraActivations', 'freeCongressSameTier', 'bonusAction'];
  for (const table of ['LEGISLATIVE_CARDS', 'PONY_CARDS']) {
    for (const card of RULES[table]) {
      for (const effect of card.effects) {
        if (INSIDE_ONLY.includes(effect.type)) assert.fail(`${card.id}: "${effect.type}" may appear only inside a trigger or an oncePerTurn`);
      }
    }
  }
  // Legislative Agenda cards hold standing triggers and nothing else (R17.1: a rule in force all game).
  for (const card of RULES.LEGISLATIVE_CARDS) for (const e of card.effects) assert.equal(e.type, 'trigger', `${card.id}: a Legislative Agenda card holds triggers`);
  // Ongoing cards hold standing rules, endgame cards an endVpPer, immediate cards one-off effects.
  for (const card of RULES.PONY_CARDS) {
    for (const e of card.effects) {
      if (card.kind === 'ongoing') assert.ok(STANDING_EFFECT_TYPES.includes(e.type), `${card.id}: an ongoing card holds standing rules, not "${e.type}"`);
      if (card.kind === 'endgame') assert.equal(e.type, 'endVpPer', `${card.id}`);
      if (card.kind === 'immediate') assert.ok(!STANDING_EFFECT_TYPES.includes(e.type), `${card.id}: an immediate card holds one-off effects, not "${e.type}"`);
    }
  }
});

suite.check('the tables survive a JSON round trip unchanged', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    assert.deepEqual(JSON.parse(JSON.stringify(table)), table, `${name} is not plain JSON`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(RULES)), RULES, 'RULES is not plain JSON');
});

suite.check('upgrade tiles: 16, the levels 6 + 5 + 5, effects the step code can run', () => {
  const tiles = RULES.UPGRADE_TILES;
  assert.equal(tiles.length, 16);
  assert.deepEqual([1, 2, 3].map((l) => tiles.filter((t) => t.level === l).length), [6, 5, 5]);
  for (const tile of tiles) {
    for (const e of tile.effects) {
      assert.ok(['vp', 'gain', 'gainBuiltTile', 'vpPerBuilt'].includes(e.type), `${tile.id}: ${e.type}`);
    }
    // The three VP tiles are exactly those `upgradeVpTiming` is about (R15.6).
    assert.equal(tile.vpTile === true, tile.effects.length === 1 && tile.effects[0].type === 'vp', `${tile.id}: vpTile flag`);
  }
});

suite.check('Pony Express: 13 + 11 + 14 cards by rank, and removedWhen names real variants', () => {
  const cards = RULES.PONY_CARDS;
  assert.deepEqual(['A', 'B', 'C'].map((r) => cards.filter((c) => c.rank === r).length), [13, 11, 14]);
  for (const c of cards) {
    if (!c.removedWhen) continue;
    for (const [name, value] of Object.entries(c.removedWhen)) {
      assert.ok(name === 'claimFrom' || name === 'bothBuildingsSameOwner', `${c.id}: removedWhen "${name}"`);
      assert.notEqual(value, undefined);
    }
  }
  const removedNetwork = cards.filter((c) => cardRemoved(c, { claimFrom: 'network', bothBuildingsSameOwner: true })).map((c) => c.number);
  assert.deepEqual(removedNetwork, [3, 14], 'R11.11.6: cards 3 and 14 are removed in network mode');
  const removedSame = cards.filter((c) => cardRemoved(c, { claimFrom: 'railhead', bothBuildingsSameOwner: false })).map((c) => c.number);
  assert.deepEqual(removedSame, [31], 'R13.7: card 31 is removed when bothBuildingsSameOwner is false');
  assert.deepEqual(cards.filter((c) => cardRemoved(c, { claimFrom: 'railhead', bothBuildingsSameOwner: true })), []);
});

// --- a fresh board ----------------------------------------------------------------------------

const EVERYTHING = { endGameScoring: 'both', goalsInPlay: 12, milestonesInPlay: 10 };

suite.check('on a fresh board no milestone is claimable, for 2, 3 and 4 players', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 0; seed < 8; seed++) {
      const state = createGame({ playerCount: players, seed: `fresh-${players}-${seed}`, variants: EVERYTHING });
      assert.equal(state.modules.milestones.inPlay.length, 10);
      for (const id of state.modules.milestones.inPlay) {
        const tile = RULES.MILESTONE_TILES.find((t) => t.id === id);
        for (const p of state.players) {
          assert.equal(evaluateCondition(state, p.id, tile.condition), false, `${id} is already met by ${p.name} in a ${players}-player game`);
          assert.equal(describeProgress(state, p.id, tile).met, false);
        }
        assert.equal(state.modules.milestones.claimedBy[id], null);
      }
      for (const p of state.players) assert.equal(p.vp.milestones, 0);
    }
  }
});

suite.check('on a fresh board no goal has a leader: every player stands the same, for 2, 3 and 4 players', () => {
  const paysEveryone = new Set();
  for (const players of [2, 3, 4]) {
    for (let seed = 0; seed < 8; seed++) {
      const state = createGame({ playerCount: players, seed: `fresh-${players}-${seed}`, variants: EVERYTHING });
      assert.equal(goalsInPlay(state).length, 12);
      for (const goal of goalsInPlay(state)) {
        const standing = goalStandings(state, goal);
        assert.ok(standing.values.every((v) => v === standing.values[0]), `${goal.id} already separates the players: ${standing.values.join(', ')}`);
        assert.ok(standing.awards.every((a) => a === standing.awards[0]), `${goal.id} already favours a player`);
        if (standing.awards[0] > 0) paysEveryone.add(goal.id);
        // The progress text is available for every goal and every player.
        for (const p of state.players) assert.equal(describeProgress(state, p.id, goal).known, true, goal.id);
      }
    }
  }
  // Goals whose measure is not 0 at the start (cargo, carriages) pay every player alike (a tie for first): a symmetry, not a lead.
  // The specialist goals read 0 until the starting specialists are chosen (R3.6).
  assert.deepEqual([...paysEveryone].sort(), ['G10', 'G5']);
});

suite.check('a fresh game with every module on has the final-scoring sources in rule order and no VP', () => {
  const state = createGame({ playerCount: 3, seed: 'fresh-score', variants: EVERYTHING });
  const score = scoreGame(state);
  for (const p of score.players) {
    assert.deepEqual(Object.keys(p.bySource), RULES.VP_SOURCES.map((s) => s.id));
  }
});

suite.finish();
