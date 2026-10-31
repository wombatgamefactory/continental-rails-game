// state.js - the shape of the game state and everything that treats the state
// as a value: build it, copy it, hash it, hide what is hidden.
//
// THE STATE IS PLAIN JSON. Every value must survive
// JSON.parse(JSON.stringify(state)): objects, arrays, strings, finite numbers,
// booleans and null. Never undefined, never a function, a Date, a Map, a Set
// or a class instance. Undo, saved games, bug reports, replay and the Web
// Worker hand-off all depend on it. The full field list is in
// docs/engine-contract.md, "State shape".
//
// `createInitialState` only builds the table as it is before anybody has
// decided anything. The public `createGame` (game.js) then runs the engine
// forward to the first decision.

import { RULES } from './rules.js';
import { resolveVariants, activeModules } from './variants.js';
import { makeRng, cloneRng, forkRng, shuffle, rngPick } from './rng.js';
import { MAP, DISTRICT_IDS, SPACE_IDS } from './board.js';

export const SCHEMA_VERSION = 1;

/** Identifies the map data in play; stored in the state so a save made on another map is refused. */
export const MAP_ID = 'route-map-v2';

/**
 * Variant values that are legal (spec R21.3) but whose rules are not written
 * yet. createGame refuses them loudly instead of silently playing something
 * else. Empty: every variant value is implemented. It may be used again for a value whose rules are not written yet.
 */
export const UNIMPLEMENTED_VARIANT_VALUES = {
  // (none: turnStructure = rounds is implemented, R4.8)
};

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
 * the same kind as the default's. A game never plays with `'x'` as a number.
 */
function checkConstantKind(base, value, where) {
  if (kindOf(base) !== kindOf(value)) {
    throw new Error(`Constant "${where}" must be ${kindOf(base)} like its default in src/engine/rules.js; ${JSON.stringify(value)} is ${kindOf(value)}.`);
  }
  if (typeof base === 'number' && !Number.isFinite(value)) {
    throw new Error(`Constant "${where}" must be a finite number; ${String(value)} is not.`);
  }
  if (Array.isArray(base)) {
    if (value.length !== base.length) {
      throw new Error(`Constant "${where}" must be an array of ${base.length} entries like its default in src/engine/rules.js; ${value.length} were given.`);
    }
    for (let i = 0; i < base.length; i++) checkConstantKind(base[i], value[i], `${where}[${i}]`);
  }
}

/** Deep copy of `base` with `patch` laid over it. Arrays are replaced whole. Unknown keys are an error. An override of another kind than its default is an error. */
function mergeConstants(base, patch, path) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(patch)) {
    const where = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      throw new Error(`Unknown constant "${where}". Check the spelling against src/engine/rules.js.`);
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
 *
 * Note for simulators: patching the exported objects of rules.js directly
 * also works for games without overrides, but is not recorded in the state.
 * Prefer `config.constants`.
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

/** The VP source ids in play for a set of variants, in the order of R20.1 and R20.2. */
export function vpSourcesInPlay(constants, variants) {
  const on = activeModules(variants);
  return constants.VP_SOURCES.filter((s) => s.module === null || on[s.module]).map((s) => s.id);
}

/** The bonus action ids that exist for a set of variants (R7.3: the upgrade bonus needs its module). */
export function bonusActionsInPlay(constants, variants) {
  const on = activeModules(variants);
  return Object.keys(constants.BONUS_ACTIONS).filter((id) => {
    const m = constants.BONUS_ACTIONS[id].module;
    return m === null || on[m];
  });
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
    throw new Error(
      `Continental Rails is for ${minPlayers} to ${maxPlayers} players; ${list.length} were given.`,
    );
  }
  return list.map((p, i) => ({
    configIndex: i,
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : `Player ${i + 1}`,
    colour: typeof p.colour === 'string' ? p.colour : null,
  }));
}

function newPlayer(seatIndex, entry, playerCount, constants, variants) {
  const K = constants;
  const houses = {};
  for (const track of K.PLAYER_BOARD.houseTracks) houses[track] = K.PLAYER_BOARD.houseSlotsPerTrack;
  const vp = {};
  for (const id of vpSourcesInPlay(K, variants)) vp[id] = 0;
  const bonusActionsUsed = {};
  for (const id of bonusActionsInPlay(K, variants)) bonusActionsUsed[id] = false;
  const specialistCarriages = [];
  for (let i = 0; i < K.SETUP.startingSpecialistCarriages; i++) {
    specialistCarriages.push({ slots: new Array(K.TRAIN.specialistSlotsPerCarriage).fill(null) });
  }
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
    train: {
      specialistCarriages,
      storageCarriages: K.SETUP.startingStorageCarriages,
    },
    railheads: new Array(K.PLAYER_BOARD.railheads).fill(null),
    startCities: new Array(K.PLAYER_BOARD.railheads).fill(null),
    bonusActionsUsed,
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
    hatsAtStart: 0,
    worker: null,
    district: null,
    hatSpent: false,
    multiplier: null,
    adjacent: null,
  };
}

/** Whether a card's `removedWhen` (a variant value that takes it out of its deck) applies in this game. */
export function cardRemoved(card, variants) {
  if (!card.removedWhen) return false;
  return Object.entries(card.removedWhen).every(([name, value]) => variants[name] === value);
}

/**
 * R3.8. Builds `state.modules.<id>` for each module that is on. Hidden orders
 * (the three Pony Express decks) go under `decks` (contract section 7). Cards
 * that are never drawn after setup (unrevealed goals, milestones and
 * Legislative Agenda cards) are not stored at all.
 */
function setupModules(state, rng, K) {
  const v = state.variants;
  const on = activeModules(v);
  const sortedBy = (table, ids) => {
    const order = new Map(table.map((entry, i) => [entry.id, i]));
    return ids.slice().sort((a, b) => order.get(a) - order.get(b));
  };

  // R3.8.1 - all 16 upgrade tiles face up; nobody has installed one.
  if (on.upgrades) {
    state.modules.upgrades = {
      display: K.UPGRADE_TILES.map((t) => t.id),
      installed: state.players.map(() => new Array(K.TRAIN.maxSpecialistCarriages).fill(null)),
    };
  }
  // R3.8.2 - milestones: shuffle the tiles, reveal `milestonesInPlay`.
  if (on.milestones) {
    const shuffled = shuffle(rng, K.MILESTONE_TILES.map((t) => t.id));
    const inPlay = sortedBy(K.MILESTONE_TILES, shuffled.slice(0, v.milestonesInPlay));
    const claimedBy = {};
    for (const id of inPlay) claimedBy[id] = null;
    state.modules.milestones = { inPlay, claimedBy };
  }
  // R3.8.2 - goals: goal 6 leaves the deck when carriage upgrades are off.
  if (on.goals) {
    const eligible = K.GOAL_CARDS.filter((g) => g.requiresModule === null || on[g.requiresModule]).map((g) => g.id);
    const shuffled = shuffle(rng, eligible);
    state.modules.goals = { inPlay: sortedBy(K.GOAL_CARDS, shuffled.slice(0, v.goalsInPlay)) };
  }
  // R3.8.3 - one Legislative Agenda card, drawn or named by `legislativeAgendaCard`.
  if (on.legislative) {
    const card =
      v.legislativeAgendaCard === 'random'
        ? rngPick(rng, K.LEGISLATIVE_CARDS)
        : K.LEGISLATIVE_CARDS.find((c) => c.number === v.legislativeAgendaCard);
    state.modules.legislative = { card: card.id, used: {} };
  }
  // R3.8.4, R18.2 - a token on every inland city, three shuffled decks, two cards of each rank face up.
  if (on.pony) {
    const tokens = {};
    for (const city of MAP.inlandCities) tokens[city] = true;
    const decks = {};
    const market = {};
    for (const rank of K.PONY.ranks) {
      const ids = K.PONY_CARDS.filter((c) => c.rank === rank && !cardRemoved(c, v)).map((c) => c.id);
      decks[rank] = shuffle(rng, ids);
      market[rank] = [];
      for (let i = 0; i < K.PONY.marketPerRank; i++) market[rank].push(decks[rank].length > 0 ? decks[rank].pop() : null);
    }
    state.modules.pony = {
      decks,
      market,
      tokens,
      players: state.players.map(() => ({ tokensHeld: 0, tokensCollected: 0, ongoing: [], endgame: [] })),
      turn: { purchases: 0, usedCards: [], doubled: null },
      roundUsed: [],
    };
  }
}

/**
 * Builds the table before the first decision: seats (R3.2), player boards
 * (R3.3), the scoring card (R3.8.5), the grid (R5.1, R5.8), the map, the
 * Congress strip (R3.1.2). All randomness of setup is drawn here, from the
 * game's own RNG, before anybody chooses anything.
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
      throw new Error(
        `Variant "${name}" = ${JSON.stringify(variants[name])} is not implemented yet (see docs/engine-todo.md).`,
      );
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
    scoringCard: null,
    completion: null,
    gameEnd: null,
    modules: {},
  };
  const K = getConstants(state);

  // R3.2 - seats. Player id = seat index; seat 1 (id 0) is the start player.
  const entries = normalisePlayers(config, K);
  const asGiven = entries.map((entry) => ({ name: entry.name, colour: entry.colour }));
  if (config.shuffleSeats !== false) shuffle(rng, entries);
  const n = entries.length;
  state.players = entries.map((entry, i) => newPlayer(i, entry, n, K, variants));
  // A record of how the game was created, enough to create it again
  // (getGameConfig). Play never reads it.
  state.config = deepFreeze({
    playerCount: n,
    players: asGiven,
    seed: config.seed === undefined ? null : config.seed,
    rngStart,
    shuffleSeats: config.shuffleSeats !== false,
    mapId: MAP_ID,
  });

  // R3.8.5, R11.9 - the scoring card. Drawn before the grid, so that shuffling
  // the grid (gridLayout) never changes which card a seed draws.
  if (variants.scoringCard === 'random') state.scoringCard = rngPick(rng, K.TERRAINS);
  else if (variants.scoringCard !== 'none') state.scoringCard = variants.scoringCard;

  // R5.1, R5.8 - the action grid.
  const tiles = { ...K.GRID.defaultTiles };
  if (variants.gridLayout === 'shuffle-resources') {
    const positions = K.GRID.shufflePositions;
    const shuffled = shuffle(rng, positions.map((d) => tiles[d]));
    positions.forEach((d, i) => {
      tiles[d] = shuffled[i];
    });
  }
  const spaces = {};
  for (const w of SPACE_IDS) spaces[w] = null;
  const centres = {};
  for (const d of DISTRICT_IDS) centres[d] = null;
  state.grid = { tiles, spaces, centres };

  // R11.1 - the map. Buildings exist only in inland cities (R13.1).
  const routeOwner = {};
  for (const id of MAP.routeIds) routeOwner[id] = null;
  const railwayStation = {};
  const telegraphStation = {};
  for (const id of MAP.inlandCities) {
    railwayStation[id] = null;
    telegraphStation[id] = null;
  }
  state.map = { routeOwner, railwayStation, telegraphStation };

  // R2.1 - the limited supply of specialist tiles.
  const specialists = {};
  for (const type of K.SPECIALIST_TYPES) specialists[type] = K.TRAIN.specialistsPerType;
  state.supply = { specialists };

  // R3.1.2, R10.2 - one senator per entry, all on their cost tiles ("available").
  const used = {};
  for (const entry of K.CONGRESS.tables[variants.congressTable]) {
    if (!entry.reset) used[entry.id] = false;
  }
  state.congress = { used };

  // R3.8.1 to R3.8.4 - module setup. Drawn from the game RNG AFTER every core
  // draw above, so a module being on or off never changes seats, grid or
  // scoring card. A module that is off leaves no key in state.modules.
  setupModules(state, rng, K);

  // R3.5 - the railhead draft comes first: reverse seat order.
  state.setup = { step: 'railheadFirst', index: n - 1, part: null };
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
 * A fast, independent copy of a state. Not a JSON round trip.
 *
 * `config`, `variants` and `constantOverrides` never change after createGame
 * (they are frozen), so the copy SHARES them with the original. Everything
 * else is copied all the way down.
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
 * RNG and the hidden deck orders. Two states with the same hash will play out
 * identically under the same actions. Stable across a JSON round trip and
 * across cloneState.
 *
 * Not included: `config` (names and seed text), which cannot affect play.
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
 * state. Works at any point of the game and after a save. The RNG the game
 * started from is carried as `rngStart`, so it works however the game was
 * seeded.
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

/** A state from JSON text made by serialiseState. Refuses another schema or another map. */
export function deserialiseState(text) {
  const state = JSON.parse(text);
  if (state === null || typeof state !== 'object' || state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`This save is not a Continental Rails state of schema version ${SCHEMA_VERSION}.`);
  }
  if (state.config.mapId !== MAP_ID) {
    throw new Error(`This save was made on map "${state.config.mapId}"; this build plays "${MAP_ID}".`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Hidden information (R2.4)
// ---------------------------------------------------------------------------
//
// Everything is open except the ORDER of undrawn cards. The convention that
// makes this checkable: a module keeps its undrawn cards in
// `state.modules.<id>.decks`, an object of arrays, `{ deckName: [cardId, ...] }`.
// The next card to draw is the LAST element (`deck.pop()`). Nothing else in
// the state is hidden, and no hidden order may be stored anywhere else.
// Cards left over after setup that can never be drawn (unused goals,
// milestones, Legislative Agenda cards) are not stored at all.

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
 * What is open stays exactly as it is.
 *
 * A bot that looks ahead MUST search on determinised copies and never on the
 * real state, or it will read the true deck order.
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
