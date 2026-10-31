// Shared runner and set-up helpers of the second edition's rules audit
// (tests/pr2e/rules-audit-pr2e.test.mjs). Not a suite: tests/run-all.mjs runs only *.test.mjs.
//
// Written from the ruleset's rules text (rule numbers P3 to P21), not from the engine and
// not from the engine's own suites. A state is built with createGame (through the pr2e
// rig) and adjusted by hand; the behaviour under test always goes through applyAction.
// Expected values are the rules' own numbers, written here as literals.

import assert from 'node:assert/strict';
import { E, NAMES, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, vp, eventOf, placeAndChoose, clearGrid } from '../pr2e/rig.mjs';

export { assert, E, NAMES, start, act, put, setStorage, layRoutes, build, giveCarriages, setTrains, types, offered, vp, eventOf, placeAndChoose, clearGrid };

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: [], known: [], knownFixed: [], skipped: [], ids: [], passedIds: [] };

/** One named check. `id` is the rule number (a suffix after "/" separates several checks of one rule). */
export function check(id, title, fn) {
  results.ids.push(id);
  try {
    fn();
    results.passed += 1;
    results.passedIds.push(id);
  } catch (err) {
    results.failed.push(id);
    const message = String(err && err.message ? err.message : err).split('\n').slice(0, 12).join('\n       ');
    process.stdout.write(`  FAIL ${id} - ${title}\n       ${message}\n`);
    if (process.env.TEST_STACK && err && err.stack) process.stdout.write(`${err.stack.split('\n').slice(0, 8).join('\n')}\n`);
  }
}

/**
 * A check of a rule the engine is known to break. It is expected to FAIL; the suite stays green
 * and the failure is listed. When the engine is fixed the check passes, and the suite goes red
 * until the check is moved to `check` (so a fixed engine is noticed).
 */
export function knownFailure(id, title, fn) {
  results.ids.push(id);
  try {
    fn();
    results.knownFixed.push(id);
    process.stdout.write(`  FIXED ${id} - ${title}: this known failure now passes; move it to check()\n`);
  } catch (err) {
    const message = String(err && err.message ? err.message : err).split('\n').slice(0, 6).join(' | ');
    results.known.push({ id, title, message });
  }
}

/** A check that is deliberately not run: the rules text is ambiguous (see docs/rules-audit-report-pr2e.md). */
export function skip(id, title, reason) {
  results.skipped.push({ id, title, reason });
}

export function finish() {
  const total = results.passed + results.failed.length;
  if (process.env.AUDIT_LIST) {
    process.stdout.write(`${results.ids.join('\n')}\n`);
    for (const s of results.skipped) process.stdout.write(`SKIP ${s.id} - ${s.title}: ${s.reason}\n`);
  }
  if (process.env.AUDIT_JSON) {
    process.stdout.write(`AUDIT_JSON ${JSON.stringify({ passed: results.passedIds, failed: results.failed, known: results.known.map((k) => k.id), skipped: results.skipped })}
`);
  }
  for (const k of results.known) process.stdout.write(`  KNOWN FAILURE ${k.id} - ${k.title}\n       ${k.message}\n`);
  process.stdout.write(`rules-audit-pr2e: ${results.passed}/${total} checks passed (${results.known.length} known failures, ${results.skipped.length} skipped)\n`);
  process.exit(results.failed.length === 0 && results.knownFixed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts that the engine refuses `action` (and leaves the state untouched). */
export function refused(state, action, pattern) {
  const before = JSON.stringify(state);
  const reason = E.getBlockReason(state, action);
  assert.notEqual(reason, null, `expected ${E.actionKey(action)} to be blocked`);
  if (pattern) assert.match(reason, pattern);
  assert.throws(() => E.applyAction(state, action), (err) => err.code === 'ILLEGAL_ACTION');
  assert.equal(JSON.stringify(state), before, 'a refused action must leave the state untouched');
}

/** Whether `a` of type `type` with the given fields is on offer. */
export function has(state, type, match = {}) {
  return E.getValidActions(state).some((a) => a.type === type && Object.keys(match).every((k) => a[k] === match[k]));
}

/** The offered actions of one type. */
export function offers(state, type) {
  return E.getValidActions(state).filter((a) => a.type === type);
}

export function frame(state) {
  const top = E.topFrame(state);
  return top === null ? null : top.kind;
}

/** Anna (player 0) places on `space`, chooses `district` and `hats`/`mode`. Returns the events. */
export function choose(state, space, district, hats = 0, mode = undefined) {
  return placeAndChoose(state, space, district, hats, mode);
}

/** Anna starts a Lay Track action (W4 / D5), spending `hats`. */
export function chooseLay(state, hats = 0) {
  return choose(state, 'W4', 'D5', hats, 'lay');
}

/** Anna starts a Hire Specialists action (W4 / D5), spending `hats`. */
export function chooseHire(state, hats = 0) {
  return choose(state, 'W4', 'D5', hats, 'hire');
}

/**
 * Plays one lay along `routes` from train `train`, doing only the steps the engine has not done
 * itself (it applies a forced step on its own). Returns the events.
 */
export function doLay(state, routes, train = 0) {
  const events = [];
  let top = E.topFrame(state);
  if (top.kind === 'lay' && top.path === null) events.push(...act(state, { type: 'startLay', train }));
  for (const route of routes) {
    top = E.topFrame(state);
    if (top === null || top.kind !== 'lay' || top.path === null) break;
    if (top.path.routes.includes(route)) continue;
    events.push(...act(state, { type: 'extendPath', route }));
  }
  top = E.topFrame(state);
  if (top !== null && top.kind === 'lay' && top.path !== null) events.push(...act(state, { type: 'endLay' }));
  return events;
}

/** Anna chooses Lay Track and lays along `routes` from `train`; returns the events. */
export function layNow(state, routes, train = 0, hats = 0) {
  const events = chooseLay(state, hats);
  events.push(...doLay(state, routes, train));
  return events;
}

/** Anna at the Foreman's Financier step (W1 / D2), holding `items`. */
export function atFinancier(players = 2, items = { coins: 5 }, options = {}) {
  const state = start(players, options);
  setStorage(state, 0, items);
  if (options.carriages) giveCarriages(state, 0, options.carriages);
  placeAndChoose(state, 'W1', 'D2');
  return state;
}

/** Plays the rest of the game with a seeded random policy (every legal action is a legal play). */
export function playOut(state, seed = 'audit') {
  const rng = E.makeRng(seed);
  for (let i = 0; !E.isGameOver(state); i++) {
    assert.ok(i < 20000, 'playOut: the game does not end');
    E.applyAction(state, E.rngPick(rng, E.getValidActions(state)));
  }
}

/** Plays until `turn.player` is `playerId` at a fresh worker step, by random legal actions. */
export function untilTurnOf(state, playerId, seed = 'until') {
  const rng = E.makeRng(seed);
  for (let i = 0; state.turn.player !== playerId || E.topFrame(state)?.kind !== 'workerStep'; i++) {
    assert.ok(i < 5000 && !E.isGameOver(state), 'untilTurnOf: never comes up');
    E.applyAction(state, E.rngPick(rng, E.getValidActions(state)));
  }
}

/** Total VP booked so far by a player. */
export function vpTotal(state, playerId) {
  let n = 0;
  for (const k in state.players[playerId].vp) n += state.players[playerId].vp[k];
  return n;
}

/** The sum of the `vp` events of a list for one player. */
export function vpOfEvents(events, playerId) {
  let n = 0;
  for (const e of events) if (e.type === 'vp' && e.player === playerId) n += e.amount;
  return n;
}

/** Empties a player's house tracks to `n` houses each (or the map `{ wood, iron, gunpowder, coins }`). */
export function setHouses(state, playerId, houses) {
  const h = typeof houses === 'number' ? { wood: houses, iron: houses, gunpowder: houses, coins: houses } : houses;
  state.players[playerId].houses = { ...h };
}

/** Gives a player `n` cowboy hats by hand. */
export function setHats(state, playerId, n) {
  state.players[playerId].hats = n;
}

/** Adds up the vp of every source of a player. */
export function bySource(state, playerId) {
  return { ...state.players[playerId].vp };
}
