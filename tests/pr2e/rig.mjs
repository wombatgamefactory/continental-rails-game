// rig.mjs - set-up helpers for the second edition's rule suites (tests/pr2e/*.test.mjs).
//
// Not a suite. These suites test the pr2e engine's own rules, so they take the
// engine from the registry by id, whatever TEST_RULES says. States are built
// with createGame and then adjusted by hand (a worker on the grid, resources
// granted, a route laid); the turn record is never replaced wholesale.

import assert from 'node:assert/strict';
import { getRuleset } from '../../src/rulesets/index.js';

export const E = getRuleset('pr2e').engine;
export const NAMES = ['Anna', 'Ben', 'Cara', 'Dev'];

/**
 * A game past setup, seats in the order given, waiting at Anna's worker step.
 * `production`: the house track each player leaves short (default 'iron' for all).
 * `trains`: per player `[firstCity, secondCity]`; by default the first legal choices.
 */
export function start(players, options = {}) {
  const state = E.createGame({
    players: NAMES.slice(0, players).map((name) => ({ name })),
    seed: options.seed ?? 1,
    shuffleSeats: false,
    variants: options.variants ?? {},
    constants: options.constants,
  });
  for (let guard = 0; state.phase === 'setup'; guard++) {
    assert.ok(guard < 100, 'setup did not finish');
    const top = E.topFrame(state);
    const actions = E.getValidActions(state);
    let action = actions[0];
    if (top.kind === 'setupProduction') {
      const track = Array.isArray(options.production) ? options.production[top.player] : (options.production ?? 'iron');
      action = actions.find((a) => a.track === track);
    } else if (top.kind === 'setupRailhead' && options.trains) {
      const which = state.players[top.player].railheads[0] === null ? 0 : 1;
      action = actions.find((a) => a.city === options.trains[top.player][which]) ?? action;
    }
    E.applyAction(state, action);
  }
  return state;
}

/** Applies an action and returns its events. */
export function act(state, action) {
  return E.applyAction(state, action);
}

/** Puts one of a player's workers on a worker space or (for a district id) a centre, by hand. */
export function put(state, playerId, at) {
  const player = state.players[playerId];
  assert.ok(player.workersInSupply > 0, 'test set-up: no worker left to put on the grid');
  if (E.isSpaceId(at)) {
    assert.equal(state.grid.spaces[at], null);
    state.grid.spaces[at] = playerId;
  } else {
    assert.equal(state.grid.centres[at], null);
    state.grid.centres[at] = playerId;
  }
  player.workersInSupply -= 1;
}

/** Sets a player's storage: `{ iron, wood, gunpowder, coins, ground, tunnel, bridge }` (missing keys become 0). */
export function setStorage(state, playerId, items) {
  const p = state.players[playerId];
  p.resources = { iron: items.iron ?? 0, wood: items.wood ?? 0, gunpowder: items.gunpowder ?? 0 };
  p.coins = items.coins ?? 0;
  p.builtTiles = { ground: items.ground ?? 0, tunnel: items.tunnel ?? 0, bridge: items.bridge ?? 0 };
}

/** Lays routes by hand (recorded as laid by `by`, statistics only). */
export function layRoutes(state, routeIds, by = 0) {
  for (const id of routeIds) {
    assert.ok(E.MAP.routeById[id], `no route ${id}`);
    state.map.routeOwner[id] = by;
  }
}

/** Places a building by hand, keeping the player's pieces consistent. */
export function build(state, kind, city, playerId, houseTrack = 'wood') {
  if (kind === 'railwayStation') {
    state.players[playerId].houses[houseTrack] -= 1;
    state.map.railwayStation[city] = playerId;
  } else {
    state.players[playerId].telegraphsPlaced += 1;
    state.map.telegraphStation[city] = playerId;
  }
}

/** Gives a player carriages by hand: `slots` per carriage, e.g. [['crew', null], [null, null]]. Counts them as earned by lay stations. */
export function giveCarriages(state, playerId, slots) {
  const p = state.players[playerId];
  p.train.specialistCarriages = slots.map((s, i) => ({ number: i + 1, slots: s.slice(), upgrade: null }));
  for (const s of slots) for (const x of s) if (x !== null) state.supply.specialists[x] -= 1;
  p.layStationsPlaced = Math.max(p.layStationsPlaced, slots.length);
}

/** Moves a player's trains by hand. */
export function setTrains(state, playerId, cities) {
  state.players[playerId].railheads = cities.slice();
}

/** The kinds of the actions on offer, sorted and unique. */
export function types(state) {
  return [...new Set(E.getValidActions(state).map((a) => a.type))].sort();
}

/** Whether an action equal to `action` (by key) is on offer. */
export function offered(state, action) {
  const key = E.actionKey(action);
  return E.getValidActions(state).some((a) => E.actionKey(a) === key);
}

/** Total VP of one source for one player. */
export function vp(state, playerId, source) {
  return state.players[playerId].vp[source];
}

/** The first event of a type. */
export function eventOf(events, type) {
  return events.find((e) => e.type === type);
}

/** Places a worker and chooses the district (and mode), unless the engine already chose it. Returns the events. */
export function placeAndChoose(state, space, district, hats = 0, mode = undefined) {
  const events = act(state, { type: 'placeWorker', space });
  const top = E.topFrame(state);
  if (top !== null && top.kind === 'chooseDistrict') {
    const action = { type: 'chooseDistrict', district, hats };
    if (mode !== undefined) action.mode = mode;
    events.push(...act(state, action));
  }
  return events;
}

/** Empties the grid (by hand) and gives every worker back. */
export function clearGrid(state) {
  const K = E.getConstants(state);
  for (const w in state.grid.spaces) state.grid.spaces[w] = null;
  for (const d in state.grid.centres) state.grid.centres[d] = null;
  for (const p of state.players) p.workersInSupply = K.SETUP.workersByPlayerCount[state.players.length];
}
