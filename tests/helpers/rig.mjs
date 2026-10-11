// Shared set-up helpers for the rules suites (rules-core and, later, the module
// and audit suites). Not a suite: tests/run-all.mjs runs only tests/*.test.mjs.
//
// The convention of tests/contract.test.mjs is kept: a state is built with
// createGame and then adjusted by hand (workers put on the grid, tiles granted,
// railheads set). The turn record and the decision stack are never replaced
// wholesale; the action under test is always taken through applyAction.

import assert from 'node:assert/strict';
import {
  createGame,
  getValidActions,
  applyAction,
  topFrame,
  actionKey,
  isSpaceId,
} from '../../src/engine/index.js';
import { drive } from './play.mjs';

export const NAMES = ['Anna', 'Ben', 'Cara', 'Dev'];

/**
 * The four add-on modules switched off. The core suites build their states with
 * these so that they test the core rules and nothing else (a module being on
 * adds free-action opportunities, tokens and card bonuses to a turn). The module
 * suites turn the modules they test on again through `options.variants`.
 */
export const MODULES_OFF = Object.freeze({
  moduleCarriageUpgrades: false,
  endGameScoring: 'none',
  moduleLegislativeAgenda: false,
  modulePonyExpress: false,
});

/**
 * A game past setup, seats in the order given, waiting at Anna's worker step.
 * Everybody has the same free specialist and the same "2" house track unless
 * options say otherwise.
 */
export function start(players, options = {}) {
  const state = createGame({
    players: NAMES.slice(0, players).map((name) => ({ name })),
    seed: options.seed ?? 1,
    shuffleSeats: false,
    variants: { startCompensation: 'none', ...MODULES_OFF, ...(options.variants ?? {}) },
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
export function put(state, playerId, at) {
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

let actObserver = null;

/** A suite may watch every action that `act` applies: `observer(action, events)`. */
export function setActObserver(observer) {
  actObserver = observer;
}

/** Applies an action and returns its events. */
export function act(state, action) {
  const events = applyAction(state, action);
  if (actObserver !== null) actObserver(action, events);
  return events;
}

/** The action types on offer, sorted and without repeats. */
export function types(state) {
  return [...new Set(getValidActions(state).map((a) => a.type))].sort();
}

/** The first event of a type, or undefined. */
export function eventOf(events, type) {
  return events.find((e) => e.type === type);
}

/** Every event of a type. */
export function eventsOf(events, type) {
  return events.filter((e) => e.type === type);
}

/** The `vp` events of a list, as { source: total }. */
export function vpBySource(events, playerId) {
  const out = {};
  for (const e of events) {
    if (e.type === 'vp' && (playerId === undefined || e.player === playerId)) out[e.source] = (out[e.source] ?? 0) + e.amount;
  }
  return out;
}

/** Finishes a worker step by choosing `district`, unless the engine already did. Returns the events of both. */
export function choose(state, events, district, hat = false) {
  const top = topFrame(state);
  if (top !== null && top.kind === 'chooseDistrict') return [...events, ...act(state, { type: 'chooseDistrict', district, hat })];
  return events;
}

/** Places a worker on `space`, then chooses `district`. */
export function placeAndChoose(state, space, district, hat = false) {
  return choose(state, act(state, { type: 'placeWorker', space }), district, hat);
}

/** Takes the first offered action of `type` matching `match` (an object of fields). Throws, listing the options, if there is none. */
export function take(state, type, match = {}) {
  const actions = getValidActions(state);
  const found = actions.find((a) => a.type === type && Object.keys(match).every((k) => a[k] === match[k]));
  if (!found) {
    throw new Error(`no ${type} ${JSON.stringify(match)} on offer; the list is: ${actions.map(actionKey).join(', ')}`);
  }
  return act(state, found);
}

/** Sets both railheads of a player (the cities they also started on, for network mode). */
export function setHeads(state, playerId, west, east) {
  const p = state.players[playerId];
  p.railheads = [west, east];
  p.startCities = [west, east];
}

/** Gives a player storage contents by hand (replaces the named fields only). */
export function give(state, playerId, gifts) {
  const p = state.players[playerId];
  if (gifts.resources) p.resources = { iron: 0, wood: 0, gunpowder: 0, ...gifts.resources };
  if (gifts.tiles) p.builtTiles = { ground: 0, tunnel: 0, bridge: 0, ...gifts.tiles };
  if (gifts.coins !== undefined) p.coins = gifts.coins;
  if (gifts.hats !== undefined) {
    p.hats = gifts.hats;
    if (state.turn.player === playerId) state.turn.hatsAtStart = gifts.hats;
  }
}

/** Sets a player's specialist carriages: `[['financier', 'miner'], ['crew', null]]`. */
export function setTrain(state, playerId, carriages) {
  const p = state.players[playerId];
  p.train.specialistCarriages = carriages.map((slots) => ({ slots: slots.slice() }));
}

/** Marks routes as claimed by a player by hand (no tiles, no VP): scenery for a test. */
export function claim(state, playerId, ...routeIds) {
  for (const id of routeIds) {
    assert.equal(state.map.routeOwner[id], null, `test set-up: ${id} is already claimed`);
    state.map.routeOwner[id] = playerId;
  }
}
