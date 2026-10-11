// queries.js - every pure read over the game state.
//
// A function belongs here if it takes the state (and ids) and returns data,
// changes nothing, and answers a question about the POSITION: counts, sums,
// who is next to what. Questions about what a player MAY DO belong in
// legality.js. Nothing like either may live in src/ui.
//
// No function here copies the state.

import { getConstants } from './state.js';
import { TERRAINS } from './rules.js';
import {
  MAP,
  SPACE_IDS,
  DISTRICT_IDS,
  SPACE_DISTRICTS,
  DISTRICT_SPACES,
  DISTRICT_NEIGHBOURS,
  otherEnd,
  cityRegion,
} from './board.js';

// ---------------------------------------------------------------------------
// Players and turn order
// ---------------------------------------------------------------------------

export function getPlayer(state, playerId) {
  return state.players[playerId];
}

export function playerName(state, playerId) {
  return state.players[playerId].name;
}

/** The player whose turn it is (R4.2), or null during setup and after the game. */
export function activePlayerId(state) {
  return state.turn.player;
}

/** The next player clockwise (R3.2). */
export function nextPlayerId(state, playerId) {
  return (playerId + 1) % state.players.length;
}

/** The other players in turn order, starting from the left of `playerId` (R5.5.3). */
export function playersAfter(state, playerId) {
  const n = state.players.length;
  const out = [];
  for (let i = 1; i < n; i++) out.push((playerId + i) % n);
  return out;
}

/** The seat that plays last in a round (R19.5): the one before the start player. */
export function lastSeatId(state) {
  const n = state.players.length;
  return (state.startPlayer + n - 1) % n;
}

// ---------------------------------------------------------------------------
// The player board: houses and production (R6.2)
// ---------------------------------------------------------------------------

/**
 * R6.2. Production P of one house track: 1 + the number of empty house slots
 * on it. Pony Express card 36 (`productionBonus`) makes P higher by its amount
 * on all four tracks, so the bonus is multiplied by M (R6.4.2, R18.7 card 36).
 */
export function production(state, playerId, track) {
  const K = getConstants(state);
  const player = state.players[playerId];
  let p = K.PLAYER_BOARD.baseProduction + (K.PLAYER_BOARD.houseSlotsPerTrack - player.houses[track]);
  const bonus = ponyModifier(state, playerId, 'productionBonus');
  if (bonus !== null) p += bonus.amount;
  return p;
}

/** Houses still on the player board, all four tracks together. */
export function housesOnBoard(player) {
  let n = 0;
  for (const track in player.houses) n += player.houses[track];
  return n;
}

// ---------------------------------------------------------------------------
// Storage (R8.5)
// ---------------------------------------------------------------------------

/** R8.5.2. Units of storage in use: each resource and each BUILT tile takes 1. */
export function storageUsed(player) {
  const r = player.resources;
  const t = player.builtTiles;
  return r.iron + r.wood + r.gunpowder + t.ground + t.tunnel + t.bridge;
}

/** R8.5.1. Capacity: 9 per storage carriage. */
export function storageCapacity(state, playerId) {
  return getConstants(state).TRAIN.storagePerCarriage * state.players[playerId].train.storageCarriages;
}

/** How far over capacity a player is (0 when within it). R8.5.4. */
export function storageOverflow(state, playerId) {
  const over = storageUsed(state.players[playerId]) - storageCapacity(state, playerId);
  return over > 0 ? over : 0;
}

/** How many of one storage item (a resource or a built tile type) a player holds. */
export function storedCount(player, item) {
  return item in player.resources ? player.resources[item] : player.builtTiles[item];
}

/** R16.5 goal 10, R20.5.3. Iron + Wood + Gunpowder + built tiles. Same number as storageUsed. */
export function cargo(player) {
  return storageUsed(player);
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------
//
// A cost is `{ iron?, wood?, gunpowder?, coins? }`.

function held(player, key) {
  return key === 'coins' ? player.coins : player.resources[key];
}

/** Whether a player holds everything a cost asks for. */
export function canPay(player, cost) {
  for (const key in cost) {
    if (held(player, key) < cost[key]) return false;
  }
  return true;
}

/** The first part of a cost the player cannot cover, as `{ key, need, have }`, or null. */
export function firstShortfall(player, cost) {
  for (const key in cost) {
    const have = held(player, key);
    if (have < cost[key]) return { key, need: cost[key], have };
  }
  return null;
}

/** Two costs added together. */
export function addCosts(a, b) {
  const out = { ...a };
  for (const key in b) out[key] = (out[key] ?? 0) + b[key];
  return out;
}

/** "1 Coin + 2 Iron" for player-facing text; "nothing" for an empty cost. */
export function formatCost(state, cost) {
  const K = getConstants(state);
  const parts = [];
  for (const key in cost) {
    if (cost[key] > 0) parts.push(formatAmount(K, key, cost[key]));
  }
  return parts.length === 0 ? 'nothing' : parts.join(' + ');
}

/** "1 Coin", "2 Coins", "3 Iron", "1 cowboy hat". */
export function formatAmount(K, key, n) {
  if (key === 'coins') return `${n} ${n === 1 ? 'Coin' : 'Coins'}`;
  if (key === 'hats') return `${n} ${n === 1 ? 'cowboy hat' : 'cowboy hats'}`;
  return `${n} ${K.NAMES[key]}`;
}

// ---------------------------------------------------------------------------
// The train (R8)
// ---------------------------------------------------------------------------

/** Number of specialist carriages; also the level of the newest one (R8.2.1). */
export function specialistCarriageCount(player) {
  return player.train.specialistCarriages.length;
}

/** R16.5 goal 5. Carriages of both kinds. */
export function carriageCount(player) {
  return player.train.specialistCarriages.length + player.train.storageCarriages;
}

/**
 * R8.6.1. Where the next hired specialist must go: the lowest-level carriage
 * with an empty slot, slot 1 before slot 2. Returns `{ level, slot }` (both
 * counted from 1) or null when every slot is full.
 */
export function nextSpecialistSlot(player) {
  const carriages = player.train.specialistCarriages;
  for (let c = 0; c < carriages.length; c++) {
    const slots = carriages[c].slots;
    for (let s = 0; s < slots.length; s++) {
      if (slots[s] === null) return { level: c + 1, slot: s + 1 };
    }
  }
  return null;
}

/** Specialists in the train by type, `{ crew, miner, engineer, financier }`. The Foreman is not counted. */
export function specialistCounts(state, playerId) {
  const out = {};
  for (const type of getConstants(state).SPECIALIST_TYPES) out[type] = 0;
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    for (const s of carriage.slots) if (s !== null) out[s] += 1;
  }
  return out;
}

/** Total slots and filled slots across a player's specialist carriages. */
export function specialistSlotUse(player) {
  let total = 0;
  let filled = 0;
  for (const carriage of player.train.specialistCarriages) {
    for (const s of carriage.slots) {
      total += 1;
      if (s !== null) filled += 1;
    }
  }
  return { total, filled };
}

/**
 * R8.6.3 with R7.4. What hiring `specialist` costs this player now.
 *   mode 'bonusAction' - the Hire Specialist bonus action: variant `hireCostModel`
 *                        decides between fee + table, fee only, table only.
 *   mode 'table'       - the hire cost only, no fee (Pony Express card 9).
 *   mode 'free'        - nothing (R8.6.4).
 * Returns `{ cost, fee, table, level }`, or null when no slot is empty.
 */
export function hireCost(state, playerId, specialist, mode) {
  const K = getConstants(state);
  const where = nextSpecialistSlot(state.players[playerId]);
  if (where === null) return null;
  let fee = {};
  let table = {};
  if (mode === 'bonusAction') {
    const model = state.variants.hireCostModel;
    if (model !== 'table-only') fee = K.BONUS_ACTIONS.hire.cost;
    if (model !== 'fee-only') table = K.TRAIN.hireCosts[specialist][where.level - 1];
  } else if (mode === 'table') {
    table = K.TRAIN.hireCosts[specialist][where.level - 1];
  }
  return { cost: addCosts(fee, table), fee, table, level: where.level };
}

// ---------------------------------------------------------------------------
// The action grid (R5)
// ---------------------------------------------------------------------------

/** The district tile lying on a grid position, for example 'gather-iron' (R5.1, R5.8). */
export function districtTileId(state, district) {
  return state.grid.tiles[district];
}

/** The rules data of the district tile on a position: `{ name, family, gathers?, foremanType?, bonusAction? }`. */
export function districtInfo(state, district) {
  return getConstants(state).GRID.districtTiles[state.grid.tiles[district]];
}

/** The printed name of the district on a position, for example "Gather Iron". */
export function districtName(state, district) {
  return districtInfo(state, district).name;
}

/** Where a player's workers stand: `{ spaces: ['W4', ...], centres: ['D5', ...] }`. */
export function workersOnGrid(state, playerId) {
  const spaces = [];
  const centres = [];
  for (const w of SPACE_IDS) if (state.grid.spaces[w] === playerId) spaces.push(w);
  for (const d of DISTRICT_IDS) if (state.grid.centres[d] === playerId) centres.push(d);
  return { spaces, centres };
}

/** Whether a player has at least one worker on a district centre (R5.4.1). */
export function hasCentreWorker(state, playerId) {
  for (const d of DISTRICT_IDS) if (state.grid.centres[d] === playerId) return true;
  return false;
}

/**
 * R5.6.2. The grid locations from which a worker is adjacent to `district`:
 * the district's worker spaces, its centre, and the centres of its orthogonal
 * neighbours. Returns ids ('W4', 'D5', ...).
 */
export function adjacencyLocations(district) {
  return [...DISTRICT_SPACES[district], district, ...DISTRICT_NEIGHBOURS[district]];
}

/**
 * R5.6.1 to R5.6.3. A: how many of a player's workers are adjacent to
 * `district`, not counting the worker at `excludeAt` (the worker used this
 * turn: a space id, a district id for a centre, or null after a Remove).
 */
export function adjacentWorkers(state, playerId, district, excludeAt) {
  const grid = state.grid;
  let count = 0;
  for (const w of DISTRICT_SPACES[district]) {
    if (grid.spaces[w] === playerId && w !== excludeAt) count += 1;
  }
  if (grid.centres[district] === playerId && district !== excludeAt) count += 1;
  for (const d of DISTRICT_NEIGHBOURS[district]) {
    if (grid.centres[d] === playerId && d !== excludeAt) count += 1;
  }
  return count;
}

/**
 * R5.6.1. M = 1 + A + H for a player choosing `district`.
 * Returns `{ multiplier, adjacent, hat }` so callers can show the arithmetic.
 */
export function multiplierFor(state, playerId, district, spendHat, excludeAt) {
  const K = getConstants(state);
  const adjacent = adjacentWorkers(state, playerId, district, excludeAt);
  const hat = spendHat ? K.HATS.multiplierPerHat : 0;
  return { multiplier: K.GRID.baseMultiplier + adjacent + hat, adjacent, hat };
}

/** The districts the worker used this turn gives access to (R5.3, R5.4.2, R5.4.3, R5.5.4). */
export function accessDistricts(state) {
  const worker = state.turn.worker;
  if (worker === null) return [];
  if (worker.at in SPACE_DISTRICTS) return SPACE_DISTRICTS[worker.at];
  return [worker.at];
}

// ---------------------------------------------------------------------------
// The map (R1.21, R11, R13, R20.5)
// ---------------------------------------------------------------------------

/** Number of claimed routes on the map (R19.3). */
export function claimedRouteCount(state) {
  let n = 0;
  const owner = state.map.routeOwner;
  const ids = MAP.routeIds;
  for (let i = 0; i < ids.length; i++) if (owner[ids[i]] !== null) n += 1;
  return n;
}

/** R1.21. A city is connected if a claimed route touches it; start cities always are. */
export function isCityConnected(state, cityId) {
  if (MAP.cityById[cityId].kind !== 'inland') return true;
  for (const routeId of MAP.cityRoutes[cityId]) {
    if (state.map.routeOwner[routeId] !== null) return true;
  }
  return false;
}

/** Ids of the routes a player owns. */
export function ownedRoutes(state, playerId) {
  const out = [];
  const owner = state.map.routeOwner;
  for (const id in owner) if (owner[id] === playerId) out.push(id);
  return out;
}

/** R20.5.2. Slots in the routes a player owns. */
export function ownedSlots(state, playerId) {
  let n = 0;
  const owner = state.map.routeOwner;
  for (const id in owner) if (owner[id] === playerId) n += MAP.routeById[id].length;
  return n;
}

/** Number of a player's railway stations on the map. */
export function railwayStationCount(state, playerId) {
  let n = 0;
  const at = state.map.railwayStation;
  for (const city in at) if (at[city] === playerId) n += 1;
  return n;
}

/** Number of a player's telegraph stations on the map. */
export function telegraphStationCount(state, playerId) {
  let n = 0;
  const at = state.map.telegraphStation;
  for (const city in at) if (at[city] === playerId) n += 1;
  return n;
}

/** R20.2.1. A player's buildings on the map: railway stations plus telegraph stations. */
export function buildingCount(state, playerId) {
  return railwayStationCount(state, playerId) + telegraphStationCount(state, playerId);
}

/** Who has a railhead on a city: a list of player ids (a player appears twice if both are there). */
export function railheadsAt(state, cityId) {
  const out = [];
  for (const p of state.players) {
    for (const at of p.railheads) if (at === cityId) out.push(p.id);
  }
  return out;
}

/** R11.4.3. The route's cost in built tiles by terrain, for example `{ ground: 1, tunnel: 2, bridge: 0 }`. */
export function routeCost(routeId) {
  return MAP.routeById[routeId].cost;
}

/**
 * R11.4.3. The first terrain of a route for which the player holds too few
 * BUILT tiles, as `{ terrain, need, have }`, or null when the route can be paid.
 */
export function routeShortfall(player, route) {
  for (const terrain of TERRAINS) {
    const need = route.cost[terrain];
    if (need > 0 && player.builtTiles[terrain] < need) return { terrain, need, have: player.builtTiles[terrain] };
  }
  return null;
}

/** R11.4.3. Whether the player's built tiles pay for every slot of the route. */
export function canAffordRoute(player, route) {
  return routeShortfall(player, route) === null;
}

/** "Seattle - Spokane": a route by the names of its two end cities. */
export function routeName(route) {
  return `${MAP.cityById[route.a].name} - ${MAP.cityById[route.b].name}`;
}

/** "2 Bridge" or "1 Ground + 2 Tunnel": what a route asks for, in built tiles. */
export function formatRouteCost(state, route) {
  const K = getConstants(state);
  const parts = [];
  for (const terrain of TERRAINS) {
    if (route.cost[terrain] > 0) parts.push(`${route.cost[terrain]} ${K.NAMES[terrain]}`);
  }
  return parts.join(' + ');
}

/**
 * R11.11.2. The player's network in `claimFrom = network`: the two cities
 * where their railheads started plus every city that is an end of a route
 * they own. City ids, each once.
 */
export function networkCities(state, playerId) {
  const out = [];
  const add = (c) => {
    if (c !== null && !out.includes(c)) out.push(c);
  };
  for (const c of state.players[playerId].startCities) add(c);
  const owner = state.map.routeOwner;
  for (const id in owner) {
    if (owner[id] === playerId) {
      add(MAP.routeById[id].a);
      add(MAP.routeById[id].b);
    }
  }
  return out;
}

/** R13.9. Whether the city holds a railway station owned by a player other than `playerId` (entering it pays a toll). */
export function hasOpponentRailwayStation(state, cityId, playerId) {
  const owner = state.map.railwayStation[cityId];
  return owner !== undefined && owner !== null && owner !== playerId;
}

/**
 * R12.2. The cities joined to `from` by a chain of claimed routes (of any
 * owners), `from` itself left out. City ids in map order.
 */
export function reachableCities(state, from) {
  const seen = new Set([from]);
  const queue = [from];
  const owner = state.map.routeOwner;
  while (queue.length > 0) {
    const city = queue.pop();
    for (const routeId of MAP.cityRoutes[city]) {
      if (owner[routeId] === null) continue;
      const next = otherEnd(MAP.routeById[routeId], city);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(from);
  return MAP.cityIds.filter((c) => seen.has(c));
}

/** Whether any claimed route touches the city (R12.6: otherwise a railhead there cannot move). */
export function touchesClaimedRoute(state, cityId) {
  for (const routeId of MAP.cityRoutes[cityId]) if (state.map.routeOwner[routeId] !== null) return true;
  return false;
}

/**
 * R12.3. The path Move Train takes from `from` to `to`, worked out for the
 * player: among all chains of claimed routes, the one that enters the fewest
 * cities holding a railway station owned by ANOTHER player (every city after
 * `from`, `to` included); ties go to the fewest routes, then to the path whose
 * list of city ids, in order, comes first alphabetically.
 *
 * Returns `{ cities, routes, tollCities }` (`cities` starts with `from` and
 * ends with `to`; `tollCities` are the cities entered that hold another
 * player's railway station, each once), or null when `to` cannot be reached.
 */
export function moveTrainPath(state, playerId, from, to) {
  if (from === to) return null;
  const owner = state.map.routeOwner;
  // Cost of entering a city, as [tolls, routes].
  const enterTolls = (city) => (hasOpponentRailwayStation(state, city, playerId) ? 1 : 0);
  const INF = [Infinity, Infinity];
  const better = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  // toTarget[v] = cheapest [tolls, routes] from v to `to`, counting the cities
  // entered after v. A small graph (25 cities): relax until nothing changes.
  const toTarget = {};
  for (const c of MAP.cityIds) toTarget[c] = INF;
  toTarget[to] = [0, 0];
  for (let changed = true; changed; ) {
    changed = false;
    for (const routeId of MAP.routeIds) {
      if (owner[routeId] === null) continue;
      const r = MAP.routeById[routeId];
      for (const [v, w] of [[r.a, r.b], [r.b, r.a]]) {
        const via = toTarget[w];
        if (via[0] === Infinity) continue;
        const cand = [via[0] + enterTolls(w), via[1] + 1];
        if (better(cand, toTarget[v])) {
          toTarget[v] = cand;
          changed = true;
        }
      }
    }
  }
  if (toTarget[from][0] === Infinity) return null;
  // Walk from `from`, always to the alphabetically first neighbour that keeps the optimum.
  const cities = [from];
  const routes = [];
  const tollCities = [];
  let here = from;
  while (here !== to) {
    let pick = null;
    let pickRoute = null;
    for (const routeId of MAP.cityRoutes[here]) {
      if (owner[routeId] === null) continue;
      const w = otherEnd(MAP.routeById[routeId], here);
      const via = toTarget[w];
      if (via[0] === Infinity) continue;
      if (via[0] + enterTolls(w) !== toTarget[here][0] || via[1] + 1 !== toTarget[here][1]) continue;
      if (pick === null || w < pick) {
        pick = w;
        pickRoute = routeId;
      }
    }
    cities.push(pick);
    routes.push(pickRoute);
    if (enterTolls(pick) === 1) tollCities.push(pick);
    here = pick;
  }
  return { cities, routes, tollCities };
}

/**
 * R19.1, R19.7. Whether a transcontinental line exists for this player on the
 * current map: with `gameEndTrigger = own-crossing`, a chain of routes ALL
 * owned by the player joining any west start city to any east start city;
 * with `any-crossing`, a chain of claimed routes of any owners (the player is
 * then ignored).
 */
export function hasTranscontinentalLine(state, playerId) {
  const own = state.variants.gameEndTrigger === 'own-crossing';
  const owner = state.map.routeOwner;
  const seen = new Set(MAP.westStartCities);
  const queue = MAP.westStartCities.slice();
  while (queue.length > 0) {
    const city = queue.pop();
    for (const routeId of MAP.cityRoutes[city]) {
      const o = owner[routeId];
      if (o === null || (own && o !== playerId)) continue;
      const next = otherEnd(MAP.routeById[routeId], city);
      if (seen.has(next)) continue;
      if (MAP.cityById[next].kind === 'east') return true;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** R13.1, R13.2.1, R13.3.1. Which buildings can still go into an inland city: `{ railwayStation, telegraphStation }`. */
export function buildingRoom(state, cityId) {
  const at = state.map.railwayStation;
  if (!(cityId in at)) return { railwayStation: false, telegraphStation: false };
  return { railwayStation: at[cityId] === null, telegraphStation: state.map.telegraphStation[cityId] === null };
}

/** R13.3.3. The VP the player's next telegraph station would score, or null when the row is empty (R13.10). */
export function nextTelegraphVp(state, playerId) {
  const row = getConstants(state).PLAYER_BOARD.telegraphRowVp;
  const placed = state.players[playerId].telegraphsPlaced;
  return placed < row.length ? row[placed] : null;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/** A player's VP so far: the sum of `player.vp` over every source in play. */
export function totalVp(player) {
  let n = 0;
  for (const source in player.vp) n += player.vp[source];
  return n;
}

// ---------------------------------------------------------------------------
// Module reads. Every one is false, null, 0 or empty when its module is
// off: a module that is off has no key in `state.modules` (contract section 11).
// ---------------------------------------------------------------------------

const cardIndexes = new WeakMap();

/** A Map from id to entry for one of the data tables of rules.js (cached per table object). */
export function cardIndex(table) {
  let index = cardIndexes.get(table);
  if (index === undefined) {
    index = new Map();
    for (const entry of table) index.set(entry.id, entry);
    cardIndexes.set(table, index);
  }
  return index;
}

/** The upgrade tile record for an id, or undefined. */
export function upgradeTileData(state, tileId) {
  return cardIndex(getConstants(state).UPGRADE_TILES).get(tileId);
}

/** The Pony Express card record for an id, or undefined. */
export function ponyCardData(state, cardId) {
  return cardIndex(getConstants(state).PONY_CARDS).get(cardId);
}

/** R15.4. The tile ids installed in a player's train (empty without the module). */
export function installedUpgrades(state, playerId) {
  const m = state.modules.upgrades;
  if (m === undefined) return [];
  return m.installed[playerId].filter((t) => t !== null);
}

/** R15.2, R15.5.1. The tile installed in the player's specialist carriage of `level`, or null. */
export function upgradeTileAt(state, playerId, level) {
  const m = state.modules.upgrades;
  if (m === undefined) return null;
  return m.installed[playerId][level - 1] ?? null;
}

/**
 * R15.5.1, R15.6. The tile whose STEP belongs in the step list of an
 * activation for this carriage: the installed tile, except a `vpTile` when
 * `upgradeVpTiming = on-install` (those score once, at installation, and do
 * nothing afterwards). Returns the tile record or null.
 */
export function activationTile(state, playerId, level) {
  const id = upgradeTileAt(state, playerId, level);
  if (id === null) return null;
  const tile = upgradeTileData(state, id);
  if (tile.vpTile && state.variants.upgradeVpTiming === 'on-install') return null;
  return tile;
}

/** R17.1. The Legislative Agenda card in force, or null. */
export function legislativeCardData(state) {
  const m = state.modules.legislative;
  if (m === undefined) return null;
  return cardIndex(getConstants(state).LEGISLATIVE_CARDS).get(m.card);
}

/** The ids of the ongoing Pony Express cards a player holds. */
export function ponyOngoing(state, playerId) {
  const m = state.modules.pony;
  return m === undefined ? [] : m.players[playerId].ongoing;
}

/**
 * R17, R18. The standing effects that apply to `playerId`'s events: those of
 * the Legislative Agenda card (it applies to everyone, R17.1) and of the
 * ongoing Pony Express cards the player owns (R18.9: to their owner only).
 * Each entry is `{ source: 'legislative' | 'pony', card, effect }`.
 */
export function standingEffects(state, playerId) {
  const out = [];
  const leg = legislativeCardData(state);
  if (leg !== null) for (const effect of leg.effects) out.push({ source: 'legislative', card: leg, effect });
  const owned = ponyOngoing(state, playerId);
  if (owned.length > 0) {
    const index = cardIndex(getConstants(state).PONY_CARDS);
    for (const id of owned) {
      const card = index.get(id);
      for (const effect of card.effects) out.push({ source: 'pony', card, effect });
    }
  }
  return out;
}

/** R18.7. The `modifier` effect of kind `what` on an ongoing card the player owns, or null. */
export function ponyModifier(state, playerId, what) {
  const owned = ponyOngoing(state, playerId);
  if (owned.length === 0) return null;
  const index = cardIndex(getConstants(state).PONY_CARDS);
  for (const id of owned) {
    for (const effect of index.get(id).effects) {
      if (effect.type === 'modifier' && effect.what === what) return effect;
    }
  }
  return null;
}

/** R18.8. The once-per-turn abilities of the ongoing cards a player owns: `[{ card, effect }]`. */
export function ponyAbilities(state, playerId) {
  const owned = ponyOngoing(state, playerId);
  const out = [];
  if (owned.length === 0) return out;
  const index = cardIndex(getConstants(state).PONY_CARDS);
  for (const id of owned) {
    for (const effect of index.get(id).effects) if (effect.type === 'oncePerTurn') out.push({ card: index.get(id), effect });
  }
  return out;
}

/** R18.3. Tokens a player holds and has collected in the whole game (0 without the module). */
export function ponyTokens(state, playerId) {
  const m = state.modules.pony;
  if (m === undefined) return { held: 0, collected: 0 };
  return { held: m.players[playerId].tokensHeld, collected: m.players[playerId].tokensCollected };
}

/** R16.5 goal 7, R16.8 MS8. The smallest of the player's counts of the four specialist types. */
export function completeSpecialistSets(state, playerId) {
  let crew = 0;
  let miner = 0;
  let engineer = 0;
  let financier = 0;
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    for (const s of carriage.slots) {
      if (s === 'crew') crew += 1;
      else if (s === 'miner') miner += 1;
      else if (s === 'engineer') engineer += 1;
      else if (s === 'financier') financier += 1;
    }
  }
  return Math.min(crew, miner, engineer, financier);
}

/** R16.5 goal 4. The largest number of specialists of one type in the train. */
export function maxSpecialistsOneType(state, playerId) {
  return Math.max(...Object.values(specialistCounts(state, playerId)));
}

/** R16.5 goal 8. Specialists in the train; the Foreman is not counted. */
export function specialistTotal(state, playerId) {
  let n = 0;
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    for (const s of carriage.slots) if (s !== null) n += 1;
  }
  return n;
}

/** R16.8 MS2 to MS4. Slots of one terrain (or of all terrains, with no terrain given) in the routes a player owns. */
export function ownedSlotsOf(state, playerId, terrain) {
  let n = 0;
  const owner = state.map.routeOwner;
  const routes = MAP.routes;
  const all = terrain === undefined || terrain === null;
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (owner[route.id] === playerId) n += all ? route.length : route.cost[terrain];
  }
  return n;
}

/** R16.8 MS6. How many routes a player owns. */
export function ownedRouteCount(state, playerId) {
  let n = 0;
  const owner = state.map.routeOwner;
  const ids = MAP.routeIds;
  for (let i = 0; i < ids.length; i++) if (owner[ids[i]] === playerId) n += 1;
  return n;
}

/** R16.8 MS5. The length in slots of the longest route a player owns (0 for none). */
export function longestOwnRoute(state, playerId) {
  let best = 0;
  const owner = state.map.routeOwner;
  const routes = MAP.routes;
  for (let i = 0; i < routes.length; i++) {
    if (owner[routes[i].id] === playerId && routes[i].length > best) best = routes[i].length;
  }
  return best;
}

/** R16.8 MS7. Whether the two cities where the player's railheads started are joined by a chain of claimed routes of any owners. */
export function startCitiesJoined(state, playerId) {
  const [a, b] = state.players[playerId].startCities;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return reachableCities(state, a).includes(b);
}

/** R18.7 card 12. Inland cities that are an end of at least one route the player owns. */
export function inlandCitiesOnOwnRoutes(state, playerId) {
  const seen = new Set();
  const owner = state.map.routeOwner;
  for (const id in owner) {
    if (owner[id] !== playerId) continue;
    const route = MAP.routeById[id];
    for (const city of [route.a, route.b]) if (MAP.cityById[city].kind === 'inland') seen.add(city);
  }
  return seen.size;
}

/** R18.7 card 31. Inland cities in which the player owns both the railway station and the telegraph station. */
export function citiesWithBothOwnBuildings(state, playerId) {
  let n = 0;
  for (const city in state.map.railwayStation) {
    if (state.map.railwayStation[city] === playerId && state.map.telegraphStation[city] === playerId) n += 1;
  }
  return n;
}

/** R16.5 goal 12. Inland cities holding at least one of the player's buildings. */
export function citiesWithOwnBuilding(state, playerId) {
  let n = 0;
  for (const city in state.map.railwayStation) {
    if (state.map.railwayStation[city] === playerId || state.map.telegraphStation[city] === playerId) n += 1;
  }
  return n;
}

/** R16.5 goal 9. The player's telegraph stations in cities whose railway station belongs to another player. */
export function telegraphsWithOpponentRailway(state, playerId) {
  let n = 0;
  for (const city in state.map.telegraphStation) {
    const rail = state.map.railwayStation[city];
    if (state.map.telegraphStation[city] === playerId && rail !== null && rail !== playerId) n += 1;
  }
  return n;
}

/** R17.3 card 7. Whether a city holds a building that belongs to a player other than `playerId`. */
export function cityHasOpponentBuilding(state, cityId, playerId) {
  const rail = state.map.railwayStation[cityId];
  const tele = state.map.telegraphStation[cityId];
  return (rail !== undefined && rail !== null && rail !== playerId) || (tele !== undefined && tele !== null && tele !== playerId);
}

const junctionCache = new Map();

/** R16.6.1. Whether a city is a junction city under the map rules in force. */
export function isJunctionCity(state, cityId) {
  const min = getConstants(state).MAP_RULES.junctionMinRoutes;
  let set = junctionCache.get(min);
  if (set === undefined) {
    set = new Set(MAP.inlandCities.filter((id) => MAP.cityRoutes[id].length >= min));
    junctionCache.set(min, set);
  }
  return set.has(cityId);
}

/** R16.5 goal 2. The smaller of the player's buildings in North region cities and in South region cities (R16.6.2). */
export function minNorthSouthBuildings(state, playerId) {
  const rules = getConstants(state).MAP_RULES;
  let north = 0;
  let south = 0;
  for (const city in state.map.railwayStation) {
    const region = cityRegion(city, rules);
    if (region !== 'north' && region !== 'south') continue;
    let n = 0;
    if (state.map.railwayStation[city] === playerId) n += 1;
    if (state.map.telegraphStation[city] === playerId) n += 1;
    if (region === 'north') north += n;
    else south += n;
  }
  return Math.min(north, south);
}

/** R16.5 goal 3. The player's buildings in junction cities. */
export function buildingsInJunctionCities(state, playerId) {
  let n = 0;
  for (const city in state.map.railwayStation) {
    if (!isJunctionCity(state, city)) continue;
    if (state.map.railwayStation[city] === playerId) n += 1;
    if (state.map.telegraphStation[city] === playerId) n += 1;
  }
  return n;
}
