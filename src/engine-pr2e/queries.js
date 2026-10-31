// queries.js - every pure read over the game state.
//
// A function belongs here if it takes the state (and ids) and returns data,
// changes nothing, and answers a question about the POSITION: counts, sums,
// who is next to what, what a path costs and scores. Questions about what a
// player MAY DO belong in legality.js. Nothing like either may live in src/ui.
//
// No function here copies the state.

import { getConstants } from './state.js';
import { MAP, SPACE_IDS, DISTRICT_IDS, SPACE_DISTRICTS, DISTRICT_SPACES, otherEnd, isStartCity } from './board.js';

// ---------------------------------------------------------------------------
// Players and turn order
// ---------------------------------------------------------------------------

export function getPlayer(state, playerId) {
  return state.players[playerId];
}

export function playerName(state, playerId) {
  return state.players[playerId].name;
}

/** The player whose turn it is (P4.2), or null during setup and after the game. */
export function activePlayerId(state) {
  return state.turn.player;
}

/** The next player clockwise (P3.4). */
export function nextPlayerId(state, playerId) {
  return (playerId + 1) % state.players.length;
}

/** The other players in turn order, starting from the left of `playerId` (P5.5.3). */
export function playersAfter(state, playerId) {
  const n = state.players.length;
  const out = [];
  for (let i = 1; i < n; i++) out.push((playerId + i) % n);
  return out;
}

/** The seat that plays last (P19.3): the one before the first player. */
export function lastSeatId(state) {
  const n = state.players.length;
  return (state.startPlayer + n - 1) % n;
}

// ---------------------------------------------------------------------------
// The player board: houses and production (P6.2)
// ---------------------------------------------------------------------------

/** P6.2. Production of one house track: 1 + the houses removed from it (1 to 4). */
export function production(state, playerId, track) {
  const K = getConstants(state);
  const player = state.players[playerId];
  return K.PLAYER_BOARD.productionBase + (K.PLAYER_BOARD.houseSlotsPerTrack - player.houses[track]);
}

/** Houses still on the player board, all four tracks together. */
export function housesOnBoard(player) {
  let n = 0;
  for (const track in player.houses) n += player.houses[track];
  return n;
}

/** The house tracks that still hold a house (P16.2.3, P6.6.2). */
export function tracksWithHouses(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  return K.PLAYER_BOARD.houseTracks.filter((t) => player.houses[t] > 0);
}

/** Telegraph stations still on the telegraph row (P16.3). */
export function telegraphsLeft(state, playerId) {
  return getConstants(state).PLAYER_BOARD.telegraphRowVp.length - state.players[playerId].telegraphsPlaced;
}

/** P16.3.3. VP of the next telegraph station from the row, or null when the row is empty. */
export function nextTelegraphVp(state, playerId) {
  const row = getConstants(state).PLAYER_BOARD.telegraphRowVp;
  const n = state.players[playerId].telegraphsPlaced;
  return n < row.length ? row[n] : null;
}

// ---------------------------------------------------------------------------
// Storage (P7)
// ---------------------------------------------------------------------------

/** P7.3. Units of storage in use: each resource, each Coin and each built tile takes 1. */
export function storageUsed(player) {
  const r = player.resources;
  const t = player.builtTiles;
  return r.iron + r.wood + r.gunpowder + player.coins + t.ground + t.tunnel + t.bridge;
}

/** P7.2. Capacity: 6 on the player board plus 3 per carriage. */
export function storageCapacity(state, playerId) {
  const K = getConstants(state);
  return K.PLAYER_BOARD.boardStorage + K.PLAYER_BOARD.storagePerCarriage * state.players[playerId].train.specialistCarriages.length;
}

/** How far over capacity a player is (0 when within it). P7.6. */
export function storageOverflow(state, playerId) {
  const over = storageUsed(state.players[playerId]) - storageCapacity(state, playerId);
  return over > 0 ? over : 0;
}

/** How many of one storage item (a resource, `coins` or a built tile type) a player holds. */
export function storedCount(player, item) {
  if (item === 'coins') return player.coins;
  return item in player.resources ? player.resources[item] : player.builtTiles[item];
}

/** Everything in storage (P7.3). Same number as storageUsed. */
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

/** Whether a player holds everything a cost asks for (P7.7). */
export function canPay(player, cost) {
  for (const key in cost) {
    if (held(player, key) < cost[key]) return false;
  }
  return true;
}

/** The first item of a cost the player is short of: `{ key, need, have }`, or null. */
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

/** "1 Coin", "2 Coins", "3 Iron", "1 cowboy hat", "2 Ground tiles". */
export function formatAmount(K, key, n) {
  if (key === 'coins') return `${n} ${n === 1 ? 'Coin' : 'Coins'}`;
  if (key === 'hats') return `${n} ${n === 1 ? 'cowboy hat' : 'cowboy hats'}`;
  if (K.TERRAINS.includes(key)) return `${n} ${K.NAMES[key]} ${n === 1 ? 'tile' : 'tiles'}`;
  return `${n} ${K.NAMES[key]}`;
}

// ---------------------------------------------------------------------------
// Carriages and specialists (P7.4, P8)
// ---------------------------------------------------------------------------

/** Carriages the player has (0 to 3). */
export function carriageCount(player) {
  return player.train.specialistCarriages.length;
}

/** Contract name: the same as carriageCount (every carriage of this ruleset has specialist spaces). */
export function specialistCarriageCount(player) {
  return carriageCount(player);
}

/** P8.3. The leftmost empty specialist space: `{ carriage, slot }` (carriage = its number), or null. */
export function nextSpecialistSlot(player) {
  const carriages = player.train.specialistCarriages;
  for (let i = 0; i < carriages.length; i++) {
    const slots = carriages[i].slots;
    for (let s = 0; s < slots.length; s++) if (slots[s] === null) return { carriage: carriages[i].number, slot: s, level: carriages[i].number };
  }
  return null;
}

/** Specialists of each type in the player's carriages. */
export function specialistCounts(state, playerId) {
  const out = {};
  for (const type of getConstants(state).SPECIALIST_TYPES) out[type] = 0;
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    for (const s of carriage.slots) if (s !== null) out[s] += 1;
  }
  return out;
}

/** `{ used, total }` specialist spaces. */
export function specialistSlotUse(player) {
  let used = 0;
  let total = 0;
  for (const carriage of player.train.specialistCarriages) {
    for (const s of carriage.slots) {
      total += 1;
      if (s !== null) used += 1;
    }
  }
  return { used, total };
}

/**
 * P8.5. What hiring a specialist of `specialist` costs this player now: nothing,
 * or with `tycoonMode` the cost for the carriage it would go into. `mode` is
 * accepted for the contract's signature and ignored.
 */
export function hireCost(state, playerId, specialist, mode) {
  void mode;
  if (!state.variants.tycoonMode) return {};
  const spot = nextSpecialistSlot(state.players[playerId]);
  if (spot === null) return {};
  return { ...getConstants(state).HIRING.tycoonCosts[specialist][spot.carriage - 1] };
}

// ---------------------------------------------------------------------------
// The action grid (P5)
// ---------------------------------------------------------------------------

/** The district on a position (P5.1), for example `collect-iron`. */
export function districtTileId(state, district) {
  return state.grid.tiles[district];
}

/** The data of the district on a position. */
export function districtInfo(state, district) {
  return getConstants(state).GRID.districtTiles[state.grid.tiles[district]];
}

/** The printed name of the district on a position, for example "Collect Iron". */
export function districtName(state, district) {
  return districtInfo(state, district).name;
}

/** Where a player's workers stand: `{ spaces: ['W4'], centres: ['D7'] }`. */
export function workersOnGrid(state, playerId) {
  const spaces = [];
  const centres = [];
  for (const w of SPACE_IDS) if (state.grid.spaces[w] === playerId) spaces.push(w);
  for (const d of DISTRICT_IDS) if (state.grid.centres[d] === playerId) centres.push(d);
  return { spaces, centres };
}

/** Whether the player has a worker on a district centre (P5.4.1). */
export function hasCentreWorker(state, playerId) {
  for (const d of DISTRICT_IDS) if (state.grid.centres[d] === playerId) return true;
  return false;
}

/** P5.6. The locations adjacent to a district: its worker spaces and its OWN centre (never a neighbour's). */
export function adjacencyLocations(district) {
  return [...DISTRICT_SPACES[district], district];
}

/**
 * P5.6, P5.7.1. The player's workers adjacent to `district`, leaving out the
 * one at `excludeAt` (the worker used this turn).
 */
export function adjacentWorkers(state, playerId, district, excludeAt) {
  let n = 0;
  for (const w of DISTRICT_SPACES[district]) {
    if (w !== excludeAt && state.grid.spaces[w] === playerId) n += 1;
  }
  if (district !== excludeAt && state.grid.centres[district] === playerId) n += 1;
  return n;
}

/** P5.7. `{ multiplier: M, adjacent }` for a district with `hats` cowboy hats spent. */
export function multiplierFor(state, playerId, district, hats, excludeAt) {
  const adjacent = adjacentWorkers(state, playerId, district, excludeAt);
  const spent = typeof hats === 'number' ? hats : hats ? 1 : 0;
  return { multiplier: getConstants(state).GRID.baseMultiplier + adjacent + spent, adjacent };
}

/** The worker used this turn, as the location to leave out of the adjacency count (P5.7.1). */
export function usedWorkerAt(state) {
  const w = state.turn.worker;
  if (w === null || w.via === 'remove') return null;
  return w.at;
}

/** P5.3 to P5.5. The districts the turn's worker gives access to. */
export function accessDistricts(state) {
  const w = state.turn.worker;
  if (w === null) return [];
  if (w.via === 'displace') return [w.at];
  if (SPACE_DISTRICTS[w.at]) return SPACE_DISTRICTS[w.at].slice();
  return [w.at];
}

/** P6.6. A player's district houses on one district's building sites. */
export function districtHousesOn(state, playerId, district) {
  const sites = state.grid.sites[district];
  if (!sites) return 0;
  let n = 0;
  for (const s of sites) if (s === playerId) n += 1;
  return n;
}

/** P6.6.4, P20.4.1. All a player's district houses. */
export function districtHouseCount(state, playerId) {
  let n = 0;
  for (const d in state.grid.sites) n += districtHousesOn(state, playerId, d);
  return n;
}

/** P6.6.1. The empty building sites, as `[{ district, index }]`. */
export function emptySites(state) {
  const out = [];
  for (const d in state.grid.sites) {
    state.grid.sites[d].forEach((s, index) => {
      if (s === null) out.push({ district: d, index });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The map (P13 to P17)
// ---------------------------------------------------------------------------

/** Whether a route is laid (P13.4). */
export function isLaid(state, routeId) {
  return state.map.routeOwner[routeId] !== null;
}

/** Laid routes on the map. */
export function laidRouteCount(state) {
  let n = 0;
  for (const id of MAP.routeIds) if (state.map.routeOwner[id] !== null) n += 1;
  return n;
}

/** Contract name for laidRouteCount. */
export function claimedRouteCount(state) {
  return laidRouteCount(state);
}

/** P1.18. A connected city: an inland city holding at least one building. Start cities never are. */
export function isCityConnected(state, cityId) {
  if (isStartCity(cityId)) return false;
  return state.map.railwayStation[cityId] !== null || state.map.telegraphStation[cityId] !== null;
}

/** Whether an inland city holds no building (P14.3.3 b). False for a start city. */
export function isEmptyInlandCity(state, cityId) {
  if (isStartCity(cityId)) return false;
  return state.map.railwayStation[cityId] === null && state.map.telegraphStation[cityId] === null;
}

/** P13.5. Whether a laid route ends in a city ("on the network"). */
export function isOnNetwork(state, cityId) {
  for (const id of MAP.cityRoutes[cityId]) if (state.map.routeOwner[id] !== null) return true;
  return false;
}

/** Routes a player laid (statistics only; nobody owns track, P13.4). */
export function ownedRoutes(state, playerId) {
  const out = [];
  for (const id of MAP.routeIds) if (state.map.routeOwner[id] === playerId) out.push(id);
  return out;
}

/** Slots in the routes a player laid (statistics only). */
export function ownedSlots(state, playerId) {
  let n = 0;
  for (const r of MAP.routes) if (state.map.routeOwner[r.id] === playerId) n += r.length;
  return n;
}

export function railwayStationCount(state, playerId) {
  let n = 0;
  for (const c of MAP.inlandCities) if (state.map.railwayStation[c] === playerId) n += 1;
  return n;
}

export function telegraphStationCount(state, playerId) {
  let n = 0;
  for (const c of MAP.inlandCities) if (state.map.telegraphStation[c] === playerId) n += 1;
  return n;
}

/** P20.2.1. Railway plus telegraph stations on the map (district houses do not count). */
export function buildingCount(state, playerId) {
  return railwayStationCount(state, playerId) + telegraphStationCount(state, playerId);
}

/** The trains on a city: `[{ player, railhead }]`. */
export function railheadsAt(state, cityId) {
  const out = [];
  for (const p of state.players) {
    p.railheads.forEach((c, i) => {
      if (c === cityId) out.push({ player: p.id, railhead: i });
    });
  }
  return out;
}

/** P14.3.2. Built tiles one route needs, by terrain. */
export function routeCost(routeId) {
  return MAP.routeById[routeId].cost;
}

/** P14.3.2. What a player lacks to lay one route: `{ ground, tunnel, bridge }` (all 0 = affordable). */
export function routeShortfall(player, route) {
  const out = { ground: 0, tunnel: 0, bridge: 0 };
  for (const t in route.cost) {
    const lack = route.cost[t] - player.builtTiles[t];
    if (lack > 0) out[t] = lack;
  }
  return out;
}

/** Whether a player holds the built tiles for one route on its own. */
export function canAffordRoute(player, route) {
  for (const t in route.cost) if (player.builtTiles[t] < route.cost[t]) return false;
  return true;
}

/** "Seattle - Spokane". */
export function routeName(route) {
  return `${MAP.cityById[route.a].name} - ${MAP.cityById[route.b].name}`;
}

/** "2 Ground + 1 Tunnel" for a route's tiles. */
export function formatRouteCost(state, route) {
  const K = getConstants(state);
  const parts = [];
  for (const t of K.TERRAINS) if (route.cost[t] > 0) parts.push(`${route.cost[t]} ${K.NAMES[t]}`);
  return parts.join(' + ');
}

/** P14.3.2. The built tiles every unlaid route of a list of routes needs. */
export function tilesForRoutes(state, routeIds) {
  const out = { ground: 0, tunnel: 0, bridge: 0 };
  for (const id of routeIds) {
    if (state.map.routeOwner[id] !== null) continue;
    const cost = MAP.routeById[id].cost;
    out.ground += cost.ground;
    out.tunnel += cost.tunnel;
    out.bridge += cost.bridge;
  }
  return out;
}

/** Whether a player holds `tiles` (`{ ground, tunnel, bridge }`) all at once. */
export function holdsTiles(player, tiles) {
  return player.builtTiles.ground >= tiles.ground && player.builtTiles.tunnel >= tiles.tunnel && player.builtTiles.bridge >= tiles.bridge;
}

/** The route joining two cities, or null (no two cities share more than one route, P13.1). */
export function routeBetween(a, b) {
  for (const id of MAP.cityRoutes[a]) {
    const r = MAP.routeById[id];
    if (otherEnd(r, a) === b) return r;
  }
  return null;
}

/**
 * The laid components: `{ cityId: componentNumber }` over the laid routes as
 * they stand. For P14.3.5 (`must-join-unjoined`) and P19.1.
 */
export function laidComponents(state) {
  const comp = {};
  let next = 0;
  for (const start of MAP.cityIds) {
    if (comp[start] !== undefined) continue;
    comp[start] = next;
    const stack = [start];
    while (stack.length > 0) {
      const c = stack.pop();
      for (const id of MAP.cityRoutes[c]) {
        if (state.map.routeOwner[id] === null) continue;
        const o = otherEnd(MAP.routeById[id], c);
        if (comp[o] === undefined) {
          comp[o] = next;
          stack.push(o);
        }
      }
    }
    next += 1;
  }
  return comp;
}

/** P19.1. Whether a chain of laid routes joins any west start city to any east start city. */
export function hasTranscontinentalLine(state) {
  const comp = laidComponents(state);
  const west = new Set(MAP.westStartCities.map((c) => comp[c]));
  return MAP.eastStartCities.some((c) => west.has(comp[c]));
}

/**
 * P14.7. The scoring city of the i-th route of a path (cities c0..ck, the
 * route from c(i-1) to c(i)): the first city from c(i) on that is a start
 * city or a connected city, else the destination ck. Buildings as they stand.
 */
export function scoringCityIndex(state, cities, i) {
  for (let j = i; j < cities.length; j++) {
    const c = cities[j];
    if (isStartCity(c) || isCityConnected(state, c)) return j;
  }
  return cities.length - 1;
}

/**
 * P14.7, P19.2, P17. What resolving a lay along `cities` / `routes` would do
 * now, without doing it: the tiles it pays, each unlaid route's VP per slot,
 * the track VP, whether it completes the first transcontinental line (and the
 * VP that pays instead), and the tolls `[{ owner, city, kind }]`.
 */
export function evaluateLay(state, playerId, cities, routes) {
  const K = getConstants(state);
  const tiles = tilesForRoutes(state, routes);
  const segments = [];
  let slots = 0;
  let trackVp = 0;
  for (let i = 0; i < routes.length; i++) {
    const route = MAP.routeById[routes[i]];
    if (state.map.routeOwner[route.id] !== null) continue;
    const j = scoringCityIndex(state, cities, i + 1);
    const scoring = cities[j];
    const perSlot = isEmptyInlandCity(state, scoring) ? K.MAP_RULES.vpPerSlotUnconnected : K.MAP_RULES.vpPerSlotConnected;
    segments.push({ route: route.id, scoringCity: scoring, perSlot, slots: route.length });
    slots += route.length;
    trackVp += perSlot * route.length;
  }
  let completes = false;
  if (state.completion === null && slots > 0 && !hasTranscontinentalLine(state)) {
    // Would the line exist with these routes laid too?
    const comp = laidComponents(state);
    const parent = {};
    const find = (x) => {
      while (parent[x] !== undefined && parent[x] !== x) x = parent[x];
      return x;
    };
    for (const id of routes) {
      if (state.map.routeOwner[id] !== null) continue;
      const r = MAP.routeById[id];
      const a = find(comp[r.a]);
      const b = find(comp[r.b]);
      if (a !== b) parent[a] = b;
    }
    const west = new Set(MAP.westStartCities.map((c) => find(comp[c])));
    completes = MAP.eastStartCities.some((c) => west.has(find(comp[c])));
  }
  const completionVp = completes ? K.MAP_RULES.completionVpPerSlot * slots : 0;
  const tolls = [];
  for (let i = 1; i < cities.length; i++) {
    const c = cities[i];
    if (isStartCity(c)) continue;
    const rs = state.map.railwayStation[c];
    const ts = state.map.telegraphStation[c];
    if (rs !== null && rs !== playerId) tolls.push({ owner: rs, city: c, kind: 'railwayStation' });
    if (ts !== null && ts !== playerId) tolls.push({ owner: ts, city: c, kind: 'telegraphStation' });
  }
  return { tiles, segments, slots, trackVp: completes ? 0 : trackVp, completes, completionVp, tolls, tollVp: tolls.length * K.MAP_RULES.tollVp };
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** A player's VP so far, all sources. */
export function totalVp(player) {
  let n = 0;
  for (const k in player.vp) n += player.vp[k];
  return n;
}

// ---------------------------------------------------------------------------
// Upgrade tokens (P12) and Congress (P10)
// ---------------------------------------------------------------------------

/** P12.1. The data of an upgrade token id (`{ id, level, gives, minPlayers }`), or null. */
export function upgradeTileData(state, tileId) {
  return getConstants(state).SUPPLY.upgradeTokens.find((t) => t.id === tileId) ?? null;
}

/** The distinct upgrade token ids of the game (identical tokens share an id, P12.1). */
export function upgradeTokenIds(state) {
  return [...new Set(getConstants(state).SUPPLY.upgradeTokens.map((t) => t.id))];
}

/** P12.5. The upgrade token ids installed in a player's carriages, left to right. */
export function installedUpgrades(state, playerId) {
  return state.players[playerId].train.specialistCarriages.map((c) => c.upgrade).filter((u) => u !== null);
}

/** The id of the token in the player's carriage number `level`, or null. */
export function upgradeTileAt(state, playerId, level) {
  const c = state.players[playerId].train.specialistCarriages[level - 1];
  return c && c.upgrade !== null ? c.upgrade : null;
}

/** P10.1. The Congress panel: each column with its cost, reward and whether its senator is down, then the Reset. */
export function congressColumns(state) {
  const K = getConstants(state);
  return [
    ...K.CONGRESS.columns.map((c) => ({ ...c, down: state.congress.down[c.id] === true, reset: false })),
    { id: 'KR', cost: K.CONGRESS.resetCost, reward: 'reset', down: false, reset: true },
  ];
}

// ---------------------------------------------------------------------------
// Reads the shared page asks of every engine. This ruleset has no cards, no
// Move Train and no Continental Rails Congress strip, so each answers "nothing".
// ---------------------------------------------------------------------------

/** No card tables in this ruleset. */
export function cardIndex(table) {
  const out = {};
  if (Array.isArray(table)) for (const entry of table) out[entry.id] = entry;
  return out;
}

/** No Pony Express in this ruleset. */
export function ponyCardData() {
  return null;
}

/** No Pony Express in this ruleset. */
export function ponyOngoing() {
  return [];
}

/** No Legislative Agenda in this ruleset. */
export function legislativeCardData() {
  return null;
}

/** No Move Train in this ruleset (P15.2): trains move only in a lay. */
export function moveTrainPath() {
  return null;
}
