// state.js - the shape of the game state and everything that treats the state
// as a value: build it, copy it, hash it, hide what is hidden.
//
// THE STATE IS PLAIN JSON. Every value must survive
// JSON.parse(JSON.stringify(state)): objects, arrays, strings, finite numbers,
// booleans and null. The field list of this ruleset is in
// docs/engine-contract-pr2e.md, "State shape".
//
// `createInitialState` only builds the table as it is before anybody has
// decided anything. The public `createGame` (game.js) then runs the engine
// forward to the first decision.

import { RULES } from './rules.js';
import { resolveVariants } from './variants.js';
import { makeRng, cloneRng, forkRng, shuffle } from './rng.js';
import { MAP, DISTRICT_IDS, SPACE_IDS } from './board.js';

export const SCHEMA_VERSION = 1;

/** Identifies the ruleset and the map data in play; stored in the state so a save made elsewhere is refused. */
export const MAP_ID = 'route-map-v2';

/** The ruleset this engine plays, recorded in every state (`state.rules`). */
export const RULESET_ID = 'pr2e';

/**
 * Variant values that are legal (P21.1) but whose rules are not written yet.
 * createGame refuses them loudly instead of silently playing something else.
 * PART 2: `upgradePlacement` and `hatOverflow` only matter to the upgrade
 * tokens and Congress column K4, which are part 2; their values are accepted
 * because nothing in part 1 reads them.
 */
export const UNIMPLEMENTED_VARIANT_VALUES = {};

// ---------------------------------------------------------------------------
// Constants per game
// ---------------------------------------------------------------------------

const constantsCache = new Map();

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function kindOf(v) {
  if (Array.isArray(v)) return 'an array';
  if (v === null) return 'null';
  if (typeof v === 'object') return 'an object';
  return `a ${typeof v}`;
}

/**
 * An override must be of the same kind as the value of rules.js it replaces: a
 * finite number for a number, a string for a string, a boolean for a boolean,
 * and for a table (an array) an array of the same length whose elements are of
 * the same kind as the default's.
 */
function checkConstantKind(base, value, where) {
  if (kindOf(base) !== kindOf(value)) {
    throw new Error(`Constant "${where}" must be ${kindOf(base)} like its default in src/engine-pr2e/rules.js; ${JSON.stringify(value)} is ${kindOf(value)}.`);
  }
  if (typeof base === 'number' && !Number.isFinite(value)) {
    throw new Error(`Constant "${where}" must be a finite number; ${String(value)} is not.`);
  }
  if (Array.isArray(base)) {
    if (value.length !== base.length) {
      throw new Error(`Constant "${where}" must be an array of ${base.length} entries like its default in src/engine-pr2e/rules.js; ${value.length} were given.`);
    }
    for (let i = 0; i < base.length; i++) checkConstantKind(base[i], value[i], `${where}[${i}]`);
  }
}

/** Deep copy of `base` with `patch` laid over it. Arrays are replaced whole. Unknown keys are an error. */
function mergeConstants(base, patch, path) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(patch)) {
    const where = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      throw new Error(`Unknown constant "${where}". Check the spelling against src/engine-pr2e/rules.js.`);
    }
    const b = base[key];
    const p = patch[key];
    if (isPlainObject(b) && isPlainObject(p)) {
      out[key] = mergeConstants(b, p, where);
    } else if (isPlainObject(b) !== isPlainObject(p) || Array.isArray(b) !== Array.isArray(p)) {
      throw new Error(`Constant "${where}" has the wrong shape: expected ${Array.isArray(b) ? 'an array' : typeof b}.`);
    } else {
      checkConstantKind(b, p, where);
      out[key] = p;
    }
  }
  return out;
}

/**
 * The constants in force for this game: `RULES`, or `RULES` with the game's
 * `constantOverrides` laid over it. EVERY logic file reads tuning numbers
 * through this function, so a saved state replays with the numbers it was
 * played with.
 */
export function getConstants(state) {
  const key = state.constantsKey;
  if (key === null) return RULES;
  let merged = constantsCache.get(key);
  if (!merged) {
    merged = mergeConstants(RULES, state.constantOverrides, '');
    constantsCache.set(key, merged);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// The decision stack
// ---------------------------------------------------------------------------
//
// `state.stack` is the list of pending decisions; the LAST element is the one
// being asked now. `state.toAct` is always the `player` of that last element
// (or null when nothing is pending). Only these three functions touch the
// stack, so the two can never disagree.

/** The pending decision, or null. */
export function topFrame(state) {
  const n = state.stack.length;
  return n === 0 ? null : state.stack[n - 1];
}

/** Adds a decision on top. `frame` is plain JSON with `kind` and `player`. */
export function pushFrame(state, frame) {
  state.stack.push(frame);
  state.toAct = frame.player;
}

/** Removes the decision on top. */
export function popFrame(state) {
  state.stack.pop();
  const top = topFrame(state);
  state.toAct = top === null ? null : top.player;
}

// ---------------------------------------------------------------------------
// Building the initial state
// ---------------------------------------------------------------------------

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

function jsonClone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** The VP source ids in play (P20.1, P20.2), in report order. Every source is always in play in this ruleset. */
export function vpSourcesInPlay(constants, variants) {
  void variants;
  return constants.VP_SOURCES.map((s) => s.id);
}

/** Contract compatibility: this ruleset has no bonus actions (P24.4). */
export function bonusActionsInPlay() {
  return [];
}

/** Contract compatibility: no card of this ruleset is removed by a variant. */
export function cardRemoved() {
  return false;
}

function normalisePlayers(config, constants) {
  let list = config.players;
  if (!Array.isArray(list)) {
    const n = config.playerCount;
    if (!Number.isInteger(n)) {
      throw new Error('createGame needs config.players (an array) or config.playerCount (2 to 4).');
    }
    list = Array.from({ length: n }, () => ({}));
  }
  const { minPlayers, maxPlayers } = constants.SETUP;
  if (list.length < minPlayers || list.length > maxPlayers) {
    throw new Error(`Pacific Rails, second edition is for ${minPlayers} to ${maxPlayers} players; ${list.length} were given.`);
  }
  return list.map((p, i) => ({
    configIndex: i,
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : `Player ${i + 1}`,
    colour: typeof p.colour === 'string' ? p.colour : null,
  }));
}

/** P3.2, P7.1. A player as they sit down: no carriage, storage 6, 1 of each resource. */
function newPlayer(seatIndex, entry, playerCount, constants, variants) {
  const K = constants;
  const houses = {};
  // P3.3: every space filled for now; the setupProduction choice takes one house away.
  for (const track of K.PLAYER_BOARD.houseTracks) houses[track] = K.PLAYER_BOARD.houseSlotsPerTrack;
  const vp = {};
  for (const id of vpSourcesInPlay(K, variants)) vp[id] = 0;
  return {
    id: seatIndex,
    configIndex: entry.configIndex,
    name: entry.name,
    colour: entry.colour,
    coins: K.SETUP.startingCoins,
    hats: K.SETUP.startingHats,
    resources: { iron: 0, wood: 0, gunpowder: 0, ...K.SETUP.startingResources },
    builtTiles: { ground: 0, tunnel: 0, bridge: 0 },
    houses,
    telegraphsPlaced: 0,
    workersInSupply: K.SETUP.workersByPlayerCount[playerCount],
    // P7.4: carriages 1, 2, 3 in order; index = number - 1. None at the start (P7.1).
    train: { specialistCarriages: [] },
    railheads: new Array(K.PLAYER_BOARD.railheads).fill(null),
    startCities: new Array(K.PLAYER_BOARD.railheads).fill(null),
    // P16.5: railway stations placed by the Lay Track action (on arrival).
    layStationsPlaced: 0,
    turnsTaken: 0,
    vp,
  };
}

/** A fresh turn record. `player` null means no turn is running (setup, or the game is over). */
export function newTurn(number, player) {
  return {
    number,
    player,
    step: player === null ? null : 'start',
    worker: null,
    district: null,
    mode: null,
    hatsSpent: 0,
    multiplier: null,
    adjacent: null,
  };
}

/**
 * Builds the table before the first decision: seats (P3.4), player boards
 * (P3.2), the grid with its building sites (P5, P6.6), the map, the supplies
 * (P3.1.5, P3.1.6), the senators (P3.1.3). All randomness of setup is drawn
 * here, from the game's own RNG, before anybody chooses anything.
 *
 * Does NOT advance to the first decision: use `createGame` (game.js).
 *
 * @param {object} config see docs/engine-contract.md, "createGame"
 * @param {{ rng?: { s: number } }} [options] an RNG to start from, in place of `config.seed`
 */
export function createInitialState(config, options = {}) {
  if (config === null || typeof config !== 'object') throw new Error('createGame needs a config object.');

  const variants = resolveVariants(config.variants ?? {});
  for (const name of Object.keys(UNIMPLEMENTED_VARIANT_VALUES)) {
    if (UNIMPLEMENTED_VARIANT_VALUES[name].includes(variants[name])) {
      throw new Error(`Variant "${name}" = ${JSON.stringify(variants[name])} is not implemented yet.`);
    }
  }

  let constantOverrides = null;
  let constantsKey = null;
  if (config.constants !== undefined && config.constants !== null) {
    if (!isPlainObject(config.constants)) throw new Error('config.constants must be an object keyed by group name.');
    if (Object.keys(config.constants).length > 0) {
      constantOverrides = jsonClone(config.constants);
      mergeConstants(RULES, constantOverrides, ''); // validates names and shapes; throws on a typo
      constantsKey = JSON.stringify(constantOverrides);
      deepFreeze(constantOverrides);
    }
  }

  let rng;
  if (options.rng) rng = cloneRng(options.rng);
  else if (config.rngStart) rng = cloneRng(config.rngStart);
  else if (config.seed !== undefined && config.seed !== null) rng = makeRng(config.seed);
  else throw new Error('createGame needs config.seed (a number or a string) or options.rng.');
  const rngStart = cloneRng(rng);

  const state = {
    schemaVersion: SCHEMA_VERSION,
    rules: RULESET_ID,
    config: null,
    variants: deepFreeze(variants),
    constantOverrides,
    constantsKey,
    rng,
    seq: 0,
    phase: 'setup',
    setup: null,
    turn: newTurn(0, null),
    startPlayer: 0,
    stack: [],
    toAct: null,
    players: [],
    grid: null,
    map: null,
    supply: null,
    congress: null,
    goals: [],
    scoringCard: null,
    completion: null,
    gameEnd: null,
    modules: {},
  };
  const K = getConstants(state);

  // P3.4 - seats. Player id = seat index; seat 1 (id 0) is the first player.
  const entries = normalisePlayers(config, K);
  const asGiven = entries.map((entry) => ({ name: entry.name, colour: entry.colour }));
  if (config.shuffleSeats !== false) shuffle(rng, entries);
  const n = entries.length;
  state.players = entries.map((entry, i) => newPlayer(i, entry, n, K, variants));
  state.config = deepFreeze({
    playerCount: n,
    players: asGiven,
    seed: config.seed === undefined ? null : config.seed,
    rngStart,
    shuffleSeats: config.shuffleSeats !== false,
    mapId: MAP_ID,
  });

  // P5.1, P5.2, P6.6 - the action grid: worker spaces, centres and the building sites of the Collect districts.
  const tiles = { ...K.GRID.defaultTiles };
  const spaces = {};
  for (const w of SPACE_IDS) spaces[w] = null;
  const centres = {};
  for (const d of DISTRICT_IDS) centres[d] = null;
  const sites = {};
  for (const d of DISTRICT_IDS) {
    if (K.GRID.districtTiles[tiles[d]].family === 'collect') sites[d] = new Array(K.GRID.buildingSitesPerDistrict).fill(null);
  }
  state.grid = { tiles, spaces, centres, sites };

  // P13 - the map. `routeOwner` records who laid a route (statistics only: a laid route belongs to nobody, P13.4).
  const routeOwner = {};
  for (const id of MAP.routeIds) routeOwner[id] = null;
  const railwayStation = {};
  const telegraphStation = {};
  for (const id of MAP.inlandCities) {
    railwayStation[id] = null;
    telegraphStation[id] = null;
  }
  state.map = { routeOwner, railwayStation, telegraphStation };

  // P3.1.5, P3.1.6 - the limited supplies, filtered by player count.
  const specialists = {};
  for (const type of K.SPECIALIST_TYPES) specialists[type] = K.SUPPLY.specialistsPerTypeByPlayerCount[n];
  const upgrades = K.SUPPLY.upgradeTokens.filter((t) => t.minPlayers <= n).map((t) => t.id);
  state.supply = { specialists, upgrades };

  // P3.1.3 - a senator on the top space of every Congress column.
  const down = {};
  for (const column of K.CONGRESS.columns) down[column.id] = false;
  state.congress = { down };

  // P3.1.7 - PART 2: the goal tiles are revealed (and scored) in part 2; none is in play yet.

  // P3.3 then P3.5 - the starting production choice in seat order, then the train draft.
  state.setup = { step: 'production', index: 0 };
  return state;
}

// ---------------------------------------------------------------------------
// Copying, hashing, saving
// ---------------------------------------------------------------------------

function deepClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const n = v.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = deepClone(v[i]);
    return out;
  }
  const out = {};
  for (const k in v) out[k] = deepClone(v[k]);
  return out;
}

/**
 * A fast, independent copy of a state. Not a JSON round trip. `config`,
 * `variants` and `constantOverrides` never change after createGame (they are
 * frozen), so the copy SHARES them with the original.
 */
export function cloneState(state) {
  const out = {};
  for (const k in state) {
    if (k === 'config' || k === 'variants' || k === 'constantOverrides') out[k] = state[k];
    else out[k] = deepClone(state[k]);
  }
  return out;
}

let h1 = 0;
let h2 = 0;

function addInt(n) {
  h1 = Math.imul(h1 ^ n, 0x01000193);
  h2 = Math.imul(h2 ^ n, 0x85ebca6b);
  h2 ^= h2 >>> 13;
}

function addString(s) {
  for (let i = 0; i < s.length; i++) addInt(s.charCodeAt(i));
  addInt(0x1f);
}

function addValue(v) {
  if (v === null) {
    addInt(0x6e);
    return;
  }
  switch (typeof v) {
    case 'number':
      if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
        addInt(0x23);
        addInt(v | 0);
      } else {
        addString(String(v));
      }
      return;
    case 'string':
      addInt(0x22);
      addString(v);
      return;
    case 'boolean':
      addInt(v ? 0x74 : 0x66);
      return;
    case 'object':
      if (Array.isArray(v)) {
        addInt(0x5b);
        for (let i = 0; i < v.length; i++) addValue(v[i]);
        addInt(0x5d);
      } else {
        addInt(0x7b);
        for (const k in v) {
          addString(k);
          addValue(v[k]);
        }
        addInt(0x7d);
      }
      return;
    default:
      throw new Error(`hashState: the state holds a ${typeof v}, which is not plain JSON.`);
  }
}

/**
 * A 16-character hexadecimal fingerprint of the WHOLE state, including the
 * RNG. Two states with the same hash play out identically under the same
 * actions. Stable across a JSON round trip and across cloneState. `config`
 * (names and seed text) is left out: it cannot affect play.
 */
export function hashState(state) {
  h1 = 0x811c9dc5 | 0;
  h2 = 0x2f0b4a13 | 0;
  for (const k in state) {
    if (k === 'config' || k === 'constantOverrides') continue;
    addString(k);
    addValue(state[k]);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return a + b;
}

/**
 * The config that recreates this game from scratch: with the list of actions
 * the players took, `replayGame(getGameConfig(state), actions)` rebuilds the
 * state.
 */
export function getGameConfig(state) {
  const c = state.config;
  const config = {
    players: c.players.map((p) => ({ name: p.name, colour: p.colour })),
    seed: c.seed,
    rngStart: { s: c.rngStart.s },
    shuffleSeats: c.shuffleSeats,
    variants: { ...state.variants },
  };
  if (state.constantOverrides !== null) config.constants = jsonClone(state.constantOverrides);
  return config;
}

/** The state as JSON text. */
export function serialiseState(state) {
  return JSON.stringify(state);
}

/** A state from JSON text made by serialiseState. Refuses another schema, another ruleset or another map. */
export function deserialiseState(text) {
  const state = JSON.parse(text);
  if (state === null || typeof state !== 'object' || state.schemaVersion !== SCHEMA_VERSION || state.rules !== RULESET_ID) {
    throw new Error(`This save is not a Pacific Rails, second edition state of schema version ${SCHEMA_VERSION}.`);
  }
  if (state.config.mapId !== MAP_ID) {
    throw new Error(`This save was made on map "${state.config.mapId}"; this build plays "${MAP_ID}".`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Hidden information (P2.5)
// ---------------------------------------------------------------------------
//
// Everything is open. The goal tiles left in the box are never stored. The
// contract's convention stays: a hidden order would live in
// `state.modules.<id>.decks`; this ruleset has none, so `hiddenDecks` returns
// an empty list unless a test plants one.

/** Every hidden-order array in the state, for determinise and for tests. */
export function hiddenDecks(state) {
  const out = [];
  for (const id in state.modules) {
    const decks = state.modules[id].decks;
    if (decks) for (const name in decks) out.push(decks[name]);
  }
  return out;
}

/**
 * A copy of `state` in which everything a player cannot know is re-drawn at
 * random: every hidden deck is reshuffled and the game RNG is replaced.
 *
 * @param {object} state
 * @param {{ s: number }} rng the caller's own RNG (a bot's); it is advanced
 */
export function determinise(state, rng) {
  const copy = cloneState(state);
  for (const deck of hiddenDecks(copy)) shuffle(rng, deck);
  copy.rng = forkRng(rng);
  return copy;
}
