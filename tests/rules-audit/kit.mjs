// Shared runner and set-up helpers of the rules audit (tests/rules-audit.test.mjs).
// Not a suite: tests/run-all.mjs runs only tests/*.test.mjs.
//
// A state is built with createGame (through rig.start, every module off unless a
// check switches one on) and adjusted by hand; the behaviour under test always
// goes through applyAction. Expected values are the spec's, written here as
// literals from rules spec v2, or read from rules.js where the spec names a
// tuning constant (R21.4).

import assert from 'node:assert/strict';
import {
  getValidActions,
  applyAction,
  getBlockReason,
  topFrame,
  actionKey,
  isGameOver,
  SPACE_IDS,
  SPACE_DISTRICTS,
  STOP_ACTION_TYPES,
} from '../../src/engine/index.js';
import { start, put, act, take, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource, MODULES_OFF } from '../helpers/rig.mjs';
import { giveTokens, stock, ownCard, installTile, kind, keys, maybeTake } from '../helpers/modules.mjs';

export { assert, start, put, act, take, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource, MODULES_OFF };
export { giveTokens, stock, ownCard, installTile, kind, keys, maybeTake };

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: [], skipped: [], ids: [] };

/** One named check. `id` is the spec rule number (with a suffix after "/" when a rule has several checks). */
export function check(id, title, fn) {
  results.ids.push(id);
  try {
    fn();
    results.passed += 1;
  } catch (err) {
    results.failed.push(id);
    const message = String(err && err.message ? err.message : err).split('\n').slice(0, 12).join('\n       ');
    process.stdout.write(`  FAIL ${id} - ${title}\n       ${message}\n`);
    if (process.env.TEST_STACK && err && err.stack) process.stdout.write(`${err.stack.split('\n').slice(0, 8).join('\n')}\n`);
  }
}

/** A check that is deliberately not run: the spec is ambiguous or contradicts itself (see docs/rules-audit-report.md). */
export function skip(id, title, reason) {
  results.skipped.push({ id, title, reason });
}

export function finish() {
  const total = results.passed + results.failed.length;
  if (process.env.AUDIT_LIST) {
    process.stdout.write(`${results.ids.join('\n')}\n`);
    for (const s of results.skipped) process.stdout.write(`SKIP ${s.id} - ${s.title}: ${s.reason}\n`);
  }
  process.stdout.write(`rules-audit: ${results.passed}/${total} checks passed (${results.skipped.length} skipped)\n`);
  process.exit(results.failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Set-up and driving helpers
// ---------------------------------------------------------------------------

/** A game past setup at seat 1's worker step: every module off, no start compensation, seats as given. */
export function game(players = 2, variants = {}, options = {}) {
  return start(players, { ...options, variants });
}

/** Total VP a player has booked so far. */
export function vpTotal(state, playerId) {
  let n = 0;
  for (const k in state.players[playerId].vp) n += state.players[playerId].vp[k];
  return n;
}

/** Whether an action of `type` matching `match` is on offer. */
export function offered(state, type, match = {}) {
  return getValidActions(state).some((a) => a.type === type && Object.keys(match).every((k) => a[k] === match[k]));
}

/** The offered actions of one type. */
export function offers(state, type) {
  return getValidActions(state).filter((a) => a.type === type);
}

/** Asserts that the engine refuses `action` (and leaves the state untouched). */
export function refused(state, action) {
  const before = JSON.stringify(state);
  assert.notEqual(getBlockReason(state, action), null, `expected ${actionKey(action)} to be blocked`);
  assert.throws(() => applyAction(state, action), (err) => err.code === 'ILLEGAL_ACTION');
  assert.equal(JSON.stringify(state), before, 'a refused action must leave the state untouched');
}

/**
 * Finishes the turn in progress by taking stop actions (skip, close, end, stop)
 * and, for a forced discard or choice, the first action on offer. Returns the events.
 */
export function finishTurn(state) {
  const turn = state.turn.number;
  const events = [];
  for (let i = 0; !isGameOver(state) && state.turn.number === turn; i++) {
    assert.ok(i < 500, 'finishTurn: the turn does not end');
    const list = getValidActions(state);
    const stop = list.find((a) => STOP_ACTION_TYPES.includes(a.type));
    events.push(...applyAction(state, stop ?? list[0]));
  }
  return events;
}

/** Applies the given actions within the turn in progress, then finishes that turn if it is still running. Returns the events. */
export function playTurn(state, ...actions) {
  const turn = state.turn.number;
  const events = [];
  for (const action of actions) {
    assert.equal(state.turn.number, turn, 'playTurn: the turn ended before every action was taken');
    events.push(...applyAction(state, action));
  }
  if (!isGameOver(state) && state.turn.number === turn) events.push(...finishTurn(state));
  return events;
}

const IDLE_DISTRICTS = ['D4', 'D6', 'D8'];
const IDLE_SPACES = ['W6', 'W7', 'W9', 'W8', 'W11', 'W12', 'W10', 'W3', 'W5'];

/**
 * A turn that changes as little as possible: the player to act removes one of
 * their workers (or places one) next to a track district and takes a train
 * activation in which every step is skipped. Returns the events.
 */
export function idleTurn(state) {
  const pid = state.turn.player;
  assert.equal(state.toAct, pid, 'idleTurn: the active player must be the one to act');
  if (kind(state) === 'freeActions') applyAction(state, { type: 'endFreeActions' });
  const turn = state.turn.number;
  let events;
  let space = IDLE_SPACES.find((w) => state.grid.spaces[w] === pid && offered(state, 'removeWorker', { from: w }));
  if (space !== undefined) {
    events = applyAction(state, { type: 'removeWorker', from: space });
  } else {
    space = IDLE_SPACES.find((w) => offered(state, 'placeWorker', { space: w })) ?? (getValidActions(state).find((a) => a.type === 'placeWorker') ?? {}).space;
    assert.ok(space !== undefined, 'idleTurn: no worker space to use');
    events = applyAction(state, { type: 'placeWorker', space });
  }
  if (state.turn.number === turn && kind(state) === 'chooseDistrict') {
    const district = SPACE_DISTRICTS[space].find((d) => IDLE_DISTRICTS.includes(d)) ?? getValidActions(state)[0].district;
    events.push(...applyAction(state, { type: 'chooseDistrict', district, hat: false }));
  }
  if (!isGameOver(state) && state.turn.number === turn) events.push(...finishTurn(state));
  return events;
}

/** Plays idle turns until it is `playerId`'s turn (at their first decision). */
export function idleUntil(state, playerId) {
  for (let i = 0; state.turn.player !== playerId; i++) {
    assert.ok(i < 50 && !isGameOver(state), 'idleUntil: the player never comes up');
    idleTurn(state);
  }
}

/** The first empty worker space bordering `district`. */
export function freeSpaceOf(state, district) {
  const w = SPACE_IDS.find((s) => state.grid.spaces[s] === null && SPACE_DISTRICTS[s].includes(district));
  assert.ok(w !== undefined, `no free worker space at ${district}`);
  return w;
}

/** The active player places a worker next to `district` and takes its action. Returns the events. */
export function goTo(state, district, hat = false) {
  return placeAndChoose(state, freeSpaceOf(state, district), district, hat);
}

/** Places a building on the map by hand, taking the piece from the owner's player board. */
export function building(state, playerId, kindOf, city, houseTrack = 'wood') {
  if (kindOf === 'railwayStation') {
    assert.equal(state.map.railwayStation[city], null);
    state.map.railwayStation[city] = playerId;
    state.players[playerId].houses[houseTrack] -= 1;
  } else {
    assert.equal(state.map.telegraphStation[city], null);
    state.map.telegraphStation[city] = playerId;
    state.players[playerId].telegraphsPlaced += 1;
  }
}

/** The sum of the `vp` events of a list for one player. */
export function vpOfEvents(events, playerId) {
  let n = 0;
  for (const e of events) if (e.type === 'vp' && e.player === playerId) n += e.amount;
  return n;
}

export { getValidActions, applyAction, getBlockReason, topFrame, actionKey, isGameOver };
