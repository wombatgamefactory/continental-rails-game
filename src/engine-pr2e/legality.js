// legality.js - what a player may do, and why not.
//
// The three layers of the legality ladder all rest on ONE set of functions,
// the `get...BlockReason` functions below:
//
//   1. getValidActions(state)        - the complete list of legal next actions
//                                      for the one player who must decide.
//   2. getBlockReason(state, action) - null if legal, else a sentence for the
//                                      player naming the FIRST blocker in
//                                      rules order, with real numbers.
//   3. applyAction (actions.js)      - refuses whatever layer 2 refuses.
//
// Layer 1 lists an action only if its block reason is null, and layer 3 asks
// the same function, so the list and the mutators cannot disagree.
//
// Writing a block-reason function: check the requirements in rules order; put
// the timing check ("it is not your decision") LAST; quote the numbers; write
// to the player as "you"; British English; end with a full stop.
//
// Rule numbers (P14.3) refer to the ruleset's rules text, not in this
// repository. Nothing here changes or copies the state.

import { getConstants, topFrame } from './state.js';
import { MAP, SPACE_IDS, DISTRICT_IDS, SPACE_DISTRICTS, DISTRICT_SPACES, isDistrictId, isSpaceId, startSide, otherEnd, isStartCity } from './board.js';
import {
  districtInfo,
  districtName,
  storageUsed,
  storageCapacity,
  storedCount,
  canPay,
  firstShortfall,
  formatCost,
  formatAmount,
  nextSpecialistSlot,
  hireCost,
  hasCentreWorker,
  workersOnGrid,
  multiplierFor,
  usedWorkerAt,
  accessDistricts,
  housesOnBoard,
  telegraphsLeft,
  emptySites,
  isEmptyInlandCity,
  tilesForRoutes,
  holdsTiles,
  wildSlotsOnPath,
  laidComponents,
  routeName,
  formatRouteCost,
  nextTelegraphVp,
  evaluateLay,
  isOnNetwork,
  upgradeTileData,
  upgradeTokenIds,
} from './queries.js';

// ---------------------------------------------------------------------------
// Small helpers for sentences
// ---------------------------------------------------------------------------

function nameOf(state, playerId) {
  return state.players[playerId].name;
}

/** "one of your workers" or "Ben's worker". */
function workerOf(state, viewerId, ownerId) {
  return viewerId === ownerId ? 'one of your workers' : `${nameOf(state, ownerId)}'s worker`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function listWithOr(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function cityName(city) {
  return MAP.cityById[city] ? MAP.cityById[city].name : String(city);
}

function tilesText(K, tiles) {
  const parts = [];
  for (const t of K.TERRAINS) if (tiles[t] > 0) parts.push(`${tiles[t]} ${K.NAMES[t]}`);
  if (tiles.wild > 0) parts.push(`${tiles.wild} ${tiles.wild === 1 ? 'tile' : 'tiles'} of any type`);
  return parts.length === 0 ? 'no tiles' : parts.join(' + ');
}

/**
 * P14.3.2, P14.9.2. Why a player cannot pay `need` (`{ ground, tunnel, bridge, wild }`):
 * the fixed tiles by terrain first, then the tiles of any type the wild slots
 * take. Null when they can.
 */
function whyCannotPayTiles(K, player, need) {
  if (holdsTiles(player, need)) return null;
  const b = player.builtTiles;
  if (b.ground >= need.ground && b.tunnel >= need.tunnel && b.bridge >= need.bridge) {
    const spare = b.ground - need.ground + (b.tunnel - need.tunnel) + (b.bridge - need.bridge);
    const lack = need.wild - spare;
    return `This lay also needs ${lack} more built ${lack === 1 ? 'tile' : 'tiles'} of any type for ${need.wild === 1 ? 'a wild slot' : `its ${need.wild} wild slots`}: after the fixed slots you have ${spare} spare.`;
  }
  return `This lay would need ${tilesText(K, need)} built tiles, and you hold ${heldTilesText(K, player)}.`;
}

function heldTilesText(K, player) {
  return `${player.builtTiles.ground} Ground, ${player.builtTiles.tunnel} Tunnel and ${player.builtTiles.bridge} Bridge`;
}

function shortfallSentence(state, what, cost, shortfall) {
  const K = getConstants(state);
  return `${what} costs ${formatCost(state, cost)} and you have ${formatAmount(K, shortfall.key, shortfall.have)}.`;
}

// ---------------------------------------------------------------------------
// Timing: whose decision is it, and which decision?
// ---------------------------------------------------------------------------

// True only inside getStructuralBlockReason, which asks "apart from whose
// decision it is, what stands in the way?".
let timingSuspended = false;

/**
 * The near-universal check, always called LAST by a block-reason function.
 * `accepts(frame)` says whether the pending decision is one in which the
 * action can be taken; `otherwise` is the sentence to give when it is not.
 */
function timingBlock(state, playerId, accepts, otherwise) {
  if (timingSuspended) return null;
  if (state.phase === 'ended') return 'The game is over.';
  const top = topFrame(state);
  if (top === null) return 'Nothing is waiting to be decided.';
  if (top.player !== playerId) {
    return `It is ${nameOf(state, top.player)}'s decision (${frameLabel(state, top)}), not yours.`;
  }
  if (!accepts(top)) return otherwise ?? `You cannot do that now: you must ${frameLabel(state, top)} first.`;
  return null;
}

const isKind = (kind) => (frame) => frame.kind === kind;

/** The pending frame if it is `playerId`'s and of `kind`, else null. */
function ownFrame(state, playerId, kind) {
  const top = topFrame(state);
  return top !== null && top.player === playerId && top.kind === kind ? top : null;
}

// ---------------------------------------------------------------------------
// The lay (P14): paths, and whether a lay can still be finished
// ---------------------------------------------------------------------------

/**
 * P14.6.2. Whether `playerId` is ABLE to place a building in `city` after a
 * lay: an inland city where a railway station is possible (none there, its
 * telegraph station not the player's, a house left on the player board) or a
 * telegraph station is possible (none there, its railway station not the
 * player's, a telegraph station left on the row). Nothing else matters.
 */
export function canPlaceArrivalBuilding(state, playerId, city) {
  if (!MAP.cityById[city] || isStartCity(city)) return false;
  const player = state.players[playerId];
  const rs = state.map.railwayStation[city];
  const ts = state.map.telegraphStation[city];
  if (rs === null && ts !== playerId && housesOnBoard(player) > 0) return true;
  if (ts === null && rs !== playerId && telegraphsLeft(state, playerId) > 0) return true;
  return false;
}

/** P14.3.3 b. A destination for a zero-tile lay: an inland city with no building where the player is able to build. */
function zeroTileTarget(state, playerId, city) {
  return isEmptyInlandCity(state, city) && canPlaceArrivalBuilding(state, playerId, city);
}

function isUnlaid(state, routeId) {
  return state.map.routeOwner[routeId] === null;
}

function unlaidCount(state, routes) {
  let n = 0;
  for (const id of routes) if (isUnlaid(state, id)) n += 1;
  return n;
}

/** P14.3.5. Whether an unlaid route may be laid under `newConnectionRule` (`comp`: the laid components, or null). */
function connectionAllowed(state, route, comp) {
  if (state.variants.newConnectionRule !== 'must-join-unjoined') return true;
  return comp[route.a] !== comp[route.b];
}

/** The cities reachable from `from` over laid routes without entering a city of `visited` (P15.4). Includes `from`. */
function laidReach(state, from, visited) {
  const seen = new Set([from]);
  const out = [from];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    for (const id of MAP.cityRoutes[c]) {
      if (isUnlaid(state, id)) continue;
      const o = otherEnd(MAP.routeById[id], c);
      if (seen.has(o) || visited.has(o)) continue;
      seen.add(o);
      out.push(o);
    }
  }
  return out;
}

/**
 * P14.3. Whether a path (cities c0..ck, routes) is a complete legal lay as it
 * stands: the tiles held, the shape (`layShape`), the connection rule, and
 * either a last route that is unlaid (a) or a zero-tile lay to an empty inland
 * city where the player is able to build (b).
 */
export function isLegalLay(state, playerId, cities, routes) {
  const k = routes.length;
  if (k === 0) return false;
  const player = state.players[playerId];
  if (!holdsTiles(player, tilesForRoutes(state, routes))) return false;
  const shape = state.variants.layShape;
  const unlaid = unlaidCount(state, routes);
  const comp = state.variants.newConnectionRule === 'must-join-unjoined' ? laidComponents(state) : null;
  for (const id of routes) if (isUnlaid(state, id) && !connectionAllowed(state, MAP.routeById[id], comp)) return false;
  const last = routes[k - 1];
  if (isUnlaid(state, last)) {
    if (shape === 'one-new-route') return unlaid === 1;
    if (shape === 'adjacent-only') return k === 1;
    return true;
  }
  // (b) a zero-tile lay.
  if (unlaid > 0 || shape === 'adjacent-only') return false;
  return zeroTileTarget(state, playerId, cities[k]);
}

/**
 * P4.7, P14.3. Whether a lay begun along `cities` / `routes` can still be
 * finished legally. Used to offer only extensions that do not lead into a dead
 * end, to offer `startLay`, and for P4.4.3.
 *
 * Why the check below is exact (with `layShape = path`): a finished lay needs
 * either a last unlaid route or a zero-tile destination. Let V be the cities on
 * the path so far and R the cities reachable from its last city over laid
 * routes without entering V. If an affordable unlaid route joins x in R to y
 * outside V, take a laid path from the last city to x; if y is not on it, add
 * the route; if y is on it, stop at y and lay the route from y to x instead.
 * Either way the lay ends with that unlaid route. Conversely any finish is of
 * that form. A zero-tile finish needs an empty inland city in R where the
 * player is able to build. More unlaid routes in the middle only cost tiles.
 */
export function canFinishLay(state, playerId, cities, routes) {
  const player = state.players[playerId];
  const committed = tilesForRoutes(state, routes);
  if (!holdsTiles(player, committed)) return false;
  const k = routes.length;
  if (k > 0 && isLegalLay(state, playerId, cities, routes)) return true;
  const shape = state.variants.layShape;
  const unlaid = unlaidCount(state, routes);
  const last = cities[k];
  if (shape === 'adjacent-only' && k > 0) return false;
  if (shape === 'one-new-route' && unlaid > 0) return false;
  const visited = new Set(cities);
  const reach = shape === 'adjacent-only' ? [last] : laidReach(state, last, visited);
  // (b) zero-tile finishes.
  if (unlaid === 0 && shape !== 'adjacent-only') {
    for (const c of reach) if (c !== cities[0] && zeroTileTarget(state, playerId, c)) return true;
  }
  // (a) one more unlaid route.
  const comp = state.variants.newConnectionRule === 'must-join-unjoined' ? laidComponents(state) : null;
  const need = { ground: 0, tunnel: 0, bridge: 0, wild: 0 };
  for (const x of reach) {
    for (const id of MAP.cityRoutes[x]) {
      if (!isUnlaid(state, id)) continue;
      const route = MAP.routeById[id];
      if (visited.has(otherEnd(route, x))) continue;
      if (!connectionAllowed(state, route, comp)) continue;
      need.ground = committed.ground + route.cost.ground;
      need.tunnel = committed.tunnel + route.cost.tunnel;
      need.bridge = committed.bridge + route.cost.bridge;
      need.wild = committed.wild + route.wild;
      if (holdsTiles(player, need)) return true;
    }
  }
  return false;
}

/** The distinct cities the player's trains stand on, with the first train index on each. */
function trainStarts(player) {
  const out = [];
  player.railheads.forEach((city, index) => {
    if (city !== null && !out.some((s) => s.city === city)) out.push({ city, index });
  });
  return out;
}

/** P4.4.3, P15.5. Whether the player has at least one legal lay from either train. */
export function hasLegalLay(state, playerId) {
  for (const s of trainStarts(state.players[playerId])) {
    if (canFinishLay(state, playerId, [s.city], [])) return true;
  }
  return false;
}

/**
 * The lay frame whose path is being built or resolved: the top frame when it is
 * a `lay`, or the `lay` frame under the `wildSlot` frames of an ended lay
 * (P14.9); null otherwise.
 */
function activeLayFrame(state) {
  const top = topFrame(state);
  if (top === null) return null;
  if (top.kind === 'lay') return top;
  if (top.kind === 'wildSlot') {
    for (let i = state.stack.length - 2; i >= 0; i--) if (state.stack[i].kind === 'lay') return state.stack[i];
  }
  return null;
}

/** The path of the lay being built (or, during its wild-slot questions, being resolved), or null. */
export function layPath(state) {
  const frame = activeLayFrame(state);
  return frame === null ? null : frame.path;
}

/** What the lay being built would score and pay if it ended now (for the UI): evaluateLay, or null. */
export function previewLay(state) {
  const frame = activeLayFrame(state);
  if (frame === null || frame.path === null) return null;
  return evaluateLay(state, frame.player, frame.path.cities, frame.path.routes);
}

/**
 * P14.9.3. The terrains the wild-slot decision on top of the stack offers, as
 * `{ terrain: spareCount }` for every tile type of which the player has a spare
 * tile: held, minus the fixed slots of the lay's unlaid routes, minus the tiles
 * already chosen for earlier wild slots of this lay. Null when no `wildSlot`
 * decision is pending.
 */
export function wildSlotSpare(state) {
  const top = topFrame(state);
  if (top === null || top.kind !== 'wildSlot') return null;
  const lay = activeLayFrame(state);
  if (lay === null || lay.path === null) return null;
  const K = getConstants(state);
  const player = state.players[top.player];
  const cost = tilesForRoutes(state, lay.path.routes);
  const out = {};
  for (const t of K.TERRAINS) {
    let chosen = 0;
    for (const f of lay.wildFills ?? []) if (f.terrain === t) chosen += 1;
    const spare = player.builtTiles[t] - cost[t] - chosen;
    if (spare >= 1) out[t] = spare;
  }
  return out;
}

// ---------------------------------------------------------------------------
// P8 - hiring
// ---------------------------------------------------------------------------

/** P8.2. Why this player cannot hire any specialist now (null when at least one hire is possible). */
function whyNoHire(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  if (player.train.specialistCarriages.length === 0) {
    return 'You cannot hire: you have no carriage yet. Your first railway station placed by Lay Track brings carriage 1.';
  }
  const spot = nextSpecialistSlot(player);
  if (spot === null) return 'You cannot hire: every specialist space of your carriages is full.';
  const left = K.SPECIALIST_TYPES.filter((t) => state.supply.specialists[t] > 0);
  if (left.length === 0) return 'You cannot hire: no specialist is left in the supply.';
  if (state.variants.tycoonMode) {
    const affordable = left.filter((t) => canPay(player, hireCost(state, playerId, t)));
    if (affordable.length === 0) {
      const t = left[0];
      const cost = hireCost(state, playerId, t);
      return `You cannot hire: in Tycoon Mode a ${K.NAMES[t]} into carriage ${spot.carriage} costs ${formatCost(state, cost)}, and you cannot pay for any specialist left in the supply.`;
    }
  }
  return null;
}

/** Whether the player can hire at least once (P4.4.4). */
export function canHire(state, playerId) {
  return whyNoHire(state, playerId) === null;
}

function whyNoLay(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const cities = trainStarts(player).map((s) => cityName(s.city));
  return `You cannot lay track: no lay can start from your trains (${cities.join(' and ')}) with the built tiles you hold (${heldTilesText(K, player)}).`;
}

// ---------------------------------------------------------------------------
// P4.4 - which district actions can be chosen
// ---------------------------------------------------------------------------

/**
 * One entry per district family: null when the action can be chosen, else a
 * sentence. `mode` is the D5 choice (`lay` or `hire`), or undefined for "either".
 *
 * THIS TABLE MUST HAVE THE SAME KEYS AS `DISTRICT_RESOLVERS` IN actions.js.
 */
export const DISTRICT_ACTION_RULES = {
  /** P4.4.1. A Collect action can always be chosen. */
  collect: () => null,
  /** P4.4.2. A board activation can always be chosen. */
  boardActivation: () => null,
  /** P4.4.3, P4.4.4. */
  layOrHire: (state, playerId, district, mode) => {
    if (mode === 'lay') return hasLegalLay(state, playerId) ? null : whyNoLay(state, playerId);
    if (mode === 'hire') return whyNoHire(state, playerId);
    if (hasLegalLay(state, playerId) || canHire(state, playerId)) return null;
    return `You can neither lay track nor hire: ${whyNoLay(state, playerId).replace(/^You cannot lay track: /, '')} ${whyNoHire(state, playerId)}`;
  },
};

/** P4.4. Whether the action of `district` can be chosen (with `mode` at D5): null, or why not. */
export function getDistrictActionBlockReason(state, playerId, district, mode) {
  if (!isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  const info = districtInfo(state, district);
  return DISTRICT_ACTION_RULES[info.family](state, playerId, district, mode);
}

function choosableAmong(state, playerId, districts) {
  return districts.filter((d) => getDistrictActionBlockReason(state, playerId, d) === null);
}

// ---------------------------------------------------------------------------
// Setup (P3.3, P3.5)
// ---------------------------------------------------------------------------

/** P3.5. Why this player cannot put a train on `city` in the draft. */
export function getPlaceRailheadBlockReason(state, playerId, city) {
  const c = MAP.cityById[city];
  if (!c) return `"${city}" is not a city on the map.`;
  if (c.kind === 'inland') {
    return `${c.name} is an inland city: trains start on one of the ${MAP.startCities.length} start cities.`;
  }
  const player = state.players[playerId];
  if (player.railheads.every((at) => at !== null)) return 'You have already placed both of your trains.';
  // P3.5.3 - during the draft a start city holds at most one train.
  for (const other of state.players) {
    if (other.railheads.includes(city)) {
      return other.id === playerId ? `${c.name} already holds your first train.` : `${c.name} already holds ${other.name}'s train.`;
    }
  }
  // P3.5.2 - the second train goes on the opposite side from the first.
  const first = player.railheads[0];
  if (first !== null && startSide(first) === c.kind) {
    const sameSide = c.kind === 'west' ? 'a west' : 'an east';
    const otherSide = c.kind === 'west' ? 'an east' : 'a west';
    return `Your first train is on ${MAP.cityById[first].name}, ${sameSide} start city, so your second must start on ${otherSide} start city, not ${c.name}.`;
  }
  return timingBlock(state, playerId, isKind('setupRailhead'));
}

/** P3.3. Why this player cannot leave the +1 space of `track` empty. */
export function getStartingProductionBlockReason(state, playerId, track) {
  const K = getConstants(state);
  if (!K.PLAYER_BOARD.houseTracks.includes(track)) {
    return `"${track}" is not a house track. The tracks are ${K.PLAYER_BOARD.houseTracks.join(', ')}.`;
  }
  return timingBlock(state, playerId, isKind('setupProduction'));
}

// ---------------------------------------------------------------------------
// Choices that any player may be asked for, on anybody's turn
// ---------------------------------------------------------------------------

/** P1.8, P5.5.3. Why this player cannot take 1 `resource` of their choice now. */
export function getChooseResourceBlockReason(state, playerId, resource) {
  const K = getConstants(state);
  if (!K.CHOICE_RESOURCES.includes(resource)) return `"${resource}" is not a resource: choose Wood, Iron, Gunpowder or a Coin.`;
  const top = ownFrame(state, playerId, 'chooseResource');
  if (top !== null && !top.allowed.includes(resource)) {
    return `You may take ${listWithOr(top.allowed.map((r) => K.NAMES[r]))} here, not ${K.NAMES[resource]}.`;
  }
  return timingBlock(state, playerId, isKind('chooseResource'), 'You are not owed a resource of your choice at the moment.');
}

/** P7.6. Why this player cannot discard 1 `item` (a resource, a Coin or a built tile type) now. */
export function getDiscardBlockReason(state, playerId, item) {
  const K = getConstants(state);
  if (!K.STORAGE_ITEMS.includes(item)) return `"${item}" is not something held in storage.`;
  const player = state.players[playerId];
  const used = storageUsed(player);
  const capacity = storageCapacity(state, playerId);
  if (used <= capacity) {
    return `You may discard only when your storage is over capacity, and you hold ${used} of ${capacity}.`;
  }
  if (storedCount(player, item) <= 0) {
    const label = K.TERRAINS.includes(item) ? `built ${K.NAMES[item]} tile` : K.NAMES[item];
    return `You have no ${label} to discard.`;
  }
  return timingBlock(state, playerId, isKind('discard'));
}

// ---------------------------------------------------------------------------
// The worker step (P4.2.1, P5.3 to P5.5)
// ---------------------------------------------------------------------------

function noWorkerInSupply(state) {
  const K = getConstants(state);
  const total = K.SETUP.workersByPlayerCount[state.players.length];
  return `You have no worker in your supply: all ${total} of your workers are on the action grid, so you must remove one.`;
}

const WORKER_STEP_OTHERWISE = 'You take your worker step once per turn, before choosing a district.';

/** P5.3. Why this player cannot place a worker on the worker space `space`. */
export function getPlaceWorkerBlockReason(state, playerId, space) {
  if (!isSpaceId(space)) return `"${space}" is not a worker space of the action grid.`;
  const player = state.players[playerId];
  if (player.workersInSupply <= 0) return noWorkerInSupply(state);
  const owner = state.grid.spaces[space];
  if (owner !== null) return `${space} already holds ${workerOf(state, playerId, owner)}.`;
  const districts = SPACE_DISTRICTS[space];
  if (choosableAmong(state, playerId, districts).length === 0) {
    const names = districts.map((d) => districtName(state, d));
    return `${space} lies between ${names[0]} and ${names[1]}, and you cannot take either action right now.`;
  }
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

/** P5.5.1, P5.5.5. Why this player cannot displace by placing a worker on the centre of `district`. */
export function getDisplaceWorkerBlockReason(state, playerId, district) {
  if (!isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  const player = state.players[playerId];
  const grid = state.grid;
  const dName = districtName(state, district);
  if (player.workersInSupply <= 0) return noWorkerInSupply(state);
  // P5.5.1 - every worker space of the district is occupied ...
  const spaces = DISTRICT_SPACES[district];
  const empty = spaces.filter((w) => grid.spaces[w] === null);
  if (empty.length > 0) {
    return `${dName} is not blocked: ${empty.length} of its ${spaces.length} worker spaces ${empty.length === 1 ? 'is' : 'are'} empty (${empty.join(', ')}), so place a worker there.`;
  }
  // ... by other players' workers, and you have no worker adjacent to it (its spaces or its centre, P5.6).
  const own = spaces.filter((w) => grid.spaces[w] === playerId);
  if (own.length > 0) return `You have a worker on ${own[0]}, a worker space of ${dName}, so you cannot displace there.`;
  if (grid.centres[district] === playerId) return `Your own worker is already on the centre of ${dName}.`;
  // P5.5.5 - you then take the district's action, so it must be one you can choose.
  const action = getDistrictActionBlockReason(state, playerId, district);
  if (action !== null) return action;
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

/** P5.4. Why this player cannot remove their worker from `from` (a worker space id or, for a centre, a district id). */
export function getRemoveWorkerBlockReason(state, playerId, from) {
  const onSpace = isSpaceId(from);
  const onCentre = isDistrictId(from);
  if (!onSpace && !onCentre) return `"${from}" is neither a worker space nor a district.`;
  const grid = state.grid;
  const there = onSpace ? grid.spaces[from] : grid.centres[from];
  if (there !== playerId) {
    return onSpace ? `You have no worker on ${from}.` : `You have no worker on the centre of ${districtName(state, from)}.`;
  }
  if (onSpace) {
    // P5.4.1 - a worker on a district centre must be the one removed.
    if (hasCentreWorker(state, playerId)) {
      const centres = workersOnGrid(state, playerId).centres.map((d) => districtName(state, d));
      return `You have a worker on the centre of ${listWithOr(centres)}; when you remove a worker it must be ${centres.length === 1 ? 'that one' : 'one of those'}.`;
    }
    // P5.4.2 with P4.4 - the removed worker must give an action that can be chosen.
    const districts = SPACE_DISTRICTS[from];
    if (choosableAmong(state, playerId, districts).length === 0) {
      const names = districts.map((d) => districtName(state, d));
      return `${from} lies between ${names[0]} and ${names[1]}, and you cannot take either action right now.`;
    }
  }
  // A centre worker can always be removed: it gives its district's action
  // (P5.4.3) or, if that cannot be chosen, no action at all (P5.4.4).
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

// ---------------------------------------------------------------------------
// Choosing the district, the hats and the D5 mode (P4.2.2, P5.7, P8.1, P11.2)
// ---------------------------------------------------------------------------

const CHOOSE_OTHERWISE = 'You choose a district right after your worker step, once per turn.';

/**
 * P4.2.2. Why this player cannot choose `district` (a district id, or 'none'
 * for the one case of P5.4.4), spending `hats` cowboy hats, with `mode`
 * (`lay` or `hire`) at Lay Track or Hire Specialists and no mode elsewhere.
 */
export function getChooseDistrictBlockReason(state, playerId, district, hats, mode) {
  if (district !== 'none' && !isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  if (!Number.isInteger(hats) || hats < 0) return 'Say how many cowboy hats you spend: `hats` must be a whole number, 0 or more.';
  if (mode !== undefined && mode !== null && mode !== 'lay' && mode !== 'hire') {
    return `"${mode}" is not a choice at Lay Track or Hire Specialists: the mode is "lay" or "hire".`;
  }
  // Which districts are on offer depends on this turn's worker, so here the timing check comes first.
  const timing = timingBlock(state, playerId, isKind('chooseDistrict'), CHOOSE_OTHERWISE);
  if (timing !== null) return timing;
  if (state.turn.player !== playerId || state.turn.worker === null) return CHOOSE_OTHERWISE;

  const worker = state.turn.worker;
  const fromCentre = isDistrictId(worker.at);
  if (district === 'none') {
    // P5.4.4 - only for a worker removed from the centre of a district whose action cannot be chosen.
    const forced = worker.via === 'remove' && fromCentre && getDistrictActionBlockReason(state, playerId, worker.at) !== null;
    if (!forced) {
      return 'You must take a district action: taking none is allowed only when the worker you had to remove stood on the centre of a district whose action you cannot take.';
    }
    if (hats > 0) return 'No district action is taken this turn, so there is nothing to spend a cowboy hat on.';
    if (mode !== undefined && mode !== null) return 'No district action is taken this turn, so there is no mode to choose.';
    return null;
  }
  const access = accessDistricts(state);
  if (!access.includes(district)) {
    const names = access.map((d) => districtName(state, d));
    const where = fromCentre ? `the centre of ${districtName(state, worker.at)}` : worker.at;
    return `Your worker ${worker.via === 'remove' ? 'came from' : 'is on'} ${where}, which gives ${listWithOr(names)}, not ${districtName(state, district)}.`;
  }
  const info = districtInfo(state, district);
  const hasMode = mode !== undefined && mode !== null;
  if (info.family === 'layOrHire' && !hasMode) {
    return `At ${info.name} you choose one of the two actions: say "lay" or "hire".`;
  }
  if (info.family !== 'layOrHire' && hasMode) {
    return `Only Lay Track or Hire Specialists asks for a mode; ${info.name} does not.`;
  }
  const action = getDistrictActionBlockReason(state, playerId, district, hasMode ? mode : undefined);
  if (action !== null) return action;
  // P11.2 - any number of the hats held.
  const held = state.players[playerId].hats;
  if (hats > held) return `You hold ${plural(held, 'cowboy hat', 'cowboy hats')}, so you cannot spend ${hats}.`;
  return null;
}

/** Whether the player could spend a cowboy hat on this turn's action (P11.2). For the UI's hat control. */
export function canSpendHat(state, playerId) {
  const top = topFrame(state);
  return top !== null && top.kind === 'chooseDistrict' && top.player === playerId && state.players[playerId].hats > 0;
}

// ---------------------------------------------------------------------------
// Special actions (P6.7) and buildings (P16)
// ---------------------------------------------------------------------------

const SPECIAL_LABEL = {
  telegraphStation: 'The Collect Gunpowder special action',
  districtHouse: 'The Collect Iron special action',
  upgrade: 'The Collect Wood special action',
  railwayStation: 'The Collect Coins special action',
};

/** The special action pending for this player, or null. */
function pendingSpecial(state, playerId) {
  const top = ownFrame(state, playerId, 'specialAction');
  return top === null ? null : top.special;
}

/** P6.7. The cost of the pending special action if the player cannot pay it, as a sentence; else null. */
function specialCostBlock(state, playerId, special) {
  const K = getConstants(state);
  const cost = K.GRID.specialActions[special].cost;
  const short = firstShortfall(state.players[playerId], cost);
  return short === null ? null : shortfallSentence(state, SPECIAL_LABEL[special], cost, short);
}

/** P16.1, P13.2.2. Buildings go only in inland cities. */
function buildingCityBlock(city) {
  const c = MAP.cityById[city];
  if (!c) return `"${city}" is not a city on the map.`;
  if (c.kind !== 'inland') return `${c.name} is a start city: buildings go only in inland cities.`;
  return null;
}

/** The terms of the pending decision for a building (P14.6, P6.7): null, or why not. Timing included. */
function buildingTerms(state, playerId, kind, city) {
  if (timingSuspended) return null;
  const top = topFrame(state);
  if (top !== null && top.player === playerId) {
    if (top.kind === 'placeBuildings') {
      if (city !== top.city) return `Your train arrived in ${cityName(top.city)}: the building of this lay goes there, not in ${cityName(city)}.`;
      return null;
    }
    if (top.kind === 'congressPlacement' && top.column === 'K7') {
      // P10.3.4 - one of each kind at most, each under its own city condition.
      if (top.placed[kind]) return `You have already placed a ${kind === 'railwayStation' ? 'railway station' : 'telegraph station'} with Congress column K7.`;
      if (kind === 'railwayStation' && !k7RailwayCity(state, playerId, city)) {
        return `Congress column K7 places a railway station only in a city with no building that a laid route reaches, or in a city with another player's telegraph station; ${cityName(city)} is neither.`;
      }
      if (kind === 'telegraphStation' && !k7TelegraphCity(state, playerId, city)) {
        return `Congress column K7 places a telegraph station only in a city with another player's railway station, and ${cityName(city)} has none.`;
      }
      return null;
    }
    if (top.kind === 'specialAction' && top.special === kind) {
      const map = state.map;
      if (kind === 'telegraphStation' && map.railwayStation[city] === null) {
        return `${SPECIAL_LABEL[kind]} places a telegraph station only in a city with another player's railway station, and ${cityName(city)} has none.`;
      }
      if (kind === 'railwayStation' && map.telegraphStation[city] === null) {
        return `${SPECIAL_LABEL[kind]} places a railway station only in a city with another player's telegraph station, and ${cityName(city)} has none.`;
      }
      return specialCostBlock(state, playerId, kind);
    }
  }
  const what = kind === 'railwayStation' ? 'a railway station' : 'a telegraph station';
  return timingBlock(state, playerId, () => false, `You can place ${what} only at the end of a lay, by a special action that places one, or with Congress column K7.`);
}

/** P10.3.4. Whether `city` meets K7's city condition for this player's railway station (the P16 rules are checked apart). */
function k7RailwayCity(state, playerId, city) {
  const rs = state.map.railwayStation[city];
  const ts = state.map.telegraphStation[city];
  if (rs !== null) return false;
  if (ts === null) return isOnNetwork(state, city);
  return ts !== playerId;
}

/** P10.3.4. Whether `city` meets K7's city condition for this player's telegraph station. */
function k7TelegraphCity(state, playerId, city) {
  const rs = state.map.railwayStation[city];
  return rs !== null && rs !== playerId && state.map.telegraphStation[city] === null;
}

/** P10.3.4. Whether this player can place a building of `kind` with K7 anywhere now. */
function k7Possible(state, playerId, kind) {
  if (kind === 'railwayStation') {
    if (housesOnBoard(state.players[playerId]) === 0) return false;
    return MAP.inlandCities.some((c) => k7RailwayCity(state, playerId, c));
  }
  if (telegraphsLeft(state, playerId) <= 0) return false;
  return MAP.inlandCities.some((c) => k7TelegraphCity(state, playerId, c));
}

/** P6.6. Whether this player can place a district house anywhere now. */
function districtHousePossible(state, playerId) {
  return housesOnBoard(state.players[playerId]) > 0 && emptySites(state).length > 0;
}

/** P16.2. Why this player cannot place a railway station in `city`, taking the leftmost house of `houseTrack`. */
export function getPlaceRailwayStationBlockReason(state, playerId, city, houseTrack) {
  const K = getConstants(state);
  const where = buildingCityBlock(city);
  if (where !== null) return where;
  if (!K.PLAYER_BOARD.houseTracks.includes(houseTrack)) return `"${houseTrack}" is not a house track.`;
  const map = state.map;
  const owner = map.railwayStation[city];
  if (owner !== null) return `${cityName(city)} already holds ${owner === playerId ? 'your' : `${nameOf(state, owner)}'s`} railway station.`;
  if (map.telegraphStation[city] === playerId) {
    return `You own the telegraph station in ${cityName(city)}, and one player may never own both buildings of a city.`;
  }
  const player = state.players[playerId];
  if (housesOnBoard(player) === 0) return 'You have no house left on your player board to place as a railway station.';
  if (player.houses[houseTrack] <= 0) return `Your ${K.NAMES[houseTrack]} track has no house left; take one from another track.`;
  return buildingTerms(state, playerId, 'railwayStation', city);
}

/** P16.3. Why this player cannot place the bottom telegraph station of their row in `city`. */
export function getPlaceTelegraphStationBlockReason(state, playerId, city) {
  const where = buildingCityBlock(city);
  if (where !== null) return where;
  const map = state.map;
  const owner = map.telegraphStation[city];
  if (owner !== null) return `${cityName(city)} already holds ${owner === playerId ? 'your' : `${nameOf(state, owner)}'s`} telegraph station.`;
  if (map.railwayStation[city] === playerId) {
    return `You own the railway station in ${cityName(city)}, and one player may never own both buildings of a city.`;
  }
  if (telegraphsLeft(state, playerId) <= 0) {
    const K = getConstants(state);
    return `Your telegraph row is empty: all ${K.PLAYER_BOARD.telegraphRowVp.length} of your telegraph stations are on the map.`;
  }
  return buildingTerms(state, playerId, 'telegraphStation', city);
}

/** P6.6, P6.7. Why this player cannot place a district house on a building site of `district`, from `houseTrack`. */
export function getPlaceDistrictHouseBlockReason(state, playerId, district, houseTrack) {
  const K = getConstants(state);
  if (!isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  const sites = state.grid.sites[district];
  if (!sites) return `${districtName(state, district)} has no building sites: only the four Collect districts do.`;
  if (!K.PLAYER_BOARD.houseTracks.includes(houseTrack)) return `"${houseTrack}" is not a house track.`;
  if (!sites.includes(null)) return `All ${sites.length} building sites of ${districtName(state, district)} are taken.`;
  const player = state.players[playerId];
  if (housesOnBoard(player) === 0) return 'You have no house left on your player board.';
  if (player.houses[houseTrack] <= 0) return `Your ${K.NAMES[houseTrack]} track has no house left; take one from another track.`;
  if (timingSuspended) return null;
  if (pendingSpecial(state, playerId) === 'districtHouse') return specialCostBlock(state, playerId, 'districtHouse');
  // P10.3.3 - Congress column K5: free.
  const k5 = ownFrame(state, playerId, 'congressPlacement');
  if (k5 !== null && k5.column === 'K5') return null;
  return timingBlock(state, playerId, () => false, 'You can place a district house only with the Collect Iron special action or Congress column K5.');
}

/**
 * P12.2, P12.3. The structural terms of putting upgrade token `token` in the
 * player's carriage number `carriage`: null, or why not. With `allowReplace`
 * a carriage that already holds a token of the same level may have it replaced
 * (the Collect Wood special action only).
 */
function installTerms(state, playerId, token, carriage, allowReplace) {
  const K = getConstants(state);
  const data = upgradeTileData(state, token);
  if (data === null) return `"${token}" is not an upgrade token.`;
  if (!Number.isInteger(carriage) || carriage < 1 || carriage > K.PLAYER_BOARD.maxCarriages) return `"${carriage}" is not a carriage number: say 1, 2 or 3.`;
  const carriages = state.players[playerId].train.specialistCarriages;
  const c = carriages[carriage - 1];
  if (!c) return `You have no carriage ${carriage}.`;
  // P12.2.1 - the carriage holds at least one specialist.
  if (!c.slots.some((s) => s !== null)) return `Carriage ${carriage} holds no specialist, so it cannot take an upgrade token.`;
  // P12.2.3 - the token's level equals the carriage's number.
  if (data.level !== carriage) return `A level ${data.level} token goes only on carriage ${data.level}, not on carriage ${carriage}.`;
  if (c.upgrade !== null) {
    // P12.3 - replacing, with a token of the same level.
    if (!allowReplace) return `Carriage ${carriage} already holds an upgrade token${state.toAct === playerId && topFrame(state)?.kind === 'congressPlacement' ? ', and Congress column K5 cannot replace one' : ''}.`;
    if (c.upgrade === token) return `Carriage ${carriage} already holds that same token; replacing it with an identical one would change nothing.`;
  } else if (state.variants.upgradePlacement === 'first-free') {
    // P12.2.4 - the leftmost carriage with a specialist and no token.
    const first = carriages.find((x) => x.upgrade === null && x.slots.some((s) => s !== null));
    if (first && first.number !== carriage) return `A new upgrade token goes in your leftmost carriage with a specialist and no token: carriage ${first.number}.`;
  }
  // P12.2.5 - the token is in the supply.
  if (!state.supply.upgrades.includes(token)) return `No ${token} token is left in the upgrade supply.`;
  return null;
}

/** P12.2, P12.3. Whether the player could install (or, with `allowReplace`, replace) any upgrade token now. */
function upgradePossible(state, playerId, allowReplace) {
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    for (const token of new Set(state.supply.upgrades)) {
      if (installTerms(state, playerId, token, carriage.number, allowReplace) === null) return true;
    }
  }
  return false;
}

/** P12.2, P12.3. Why this player cannot install upgrade token `token` in carriage number `carriage` (or replace the one there). */
export function getInstallUpgradeBlockReason(state, playerId, token, carriage) {
  const top = topFrame(state);
  const atCollectWood = top !== null && top.player === playerId && top.kind === 'specialAction' && top.special === 'upgrade';
  // Replacing belongs to the Collect Wood special action; asked ahead of time, it is allowed structurally.
  const terms = installTerms(state, playerId, token, carriage, timingSuspended || atCollectWood);
  if (terms !== null) return terms;
  if (timingSuspended) return null;
  if (atCollectWood) return specialCostBlock(state, playerId, 'upgrade');
  if (top !== null && top.player === playerId && top.kind === 'congressPlacement' && top.column === 'K5') return null;
  return timingBlock(state, playerId, () => false, 'You can install an upgrade token only with the Collect Wood special action or Congress column K5.');
}

/** P6.7. Why this player cannot decline the special action now. */
export function getSkipSpecialActionBlockReason(state, playerId) {
  return timingBlock(state, playerId, isKind('specialAction'), 'There is no special action to decline: it comes right after a Collect action.');
}

/** P14.6.1. Why this player cannot place no building after the lay. */
export function getSkipBuildingBlockReason(state, playerId) {
  const top = ownFrame(state, playerId, 'placeBuildings');
  if (top !== null && !top.optional) {
    return `You are able to build in ${cityName(top.city)}, so you must place one building there.`;
  }
  // P10.3.4 - Congress column K7 places one or both buildings: the second may be declined.
  const k7 = ownFrame(state, playerId, 'congressPlacement');
  if (k7 !== null) {
    if (k7.column !== 'K7') return 'Congress column K5 must be carried out: place a district house or install an upgrade token.';
    if (!k7.placed.railwayStation && !k7.placed.telegraphStation) return 'Congress column K7 places at least one building: place one before you stop.';
    return null;
  }
  return timingBlock(state, playerId, isKind('placeBuildings'), 'There is no building to decline: it comes only at the end of a lay or after a building of Congress column K7.');
}

/** The special actions possible for this player now, by kind, for the UI and the bots. */
export function specialActionPossible(state, playerId, special) {
  const top = ownFrame(state, playerId, 'specialAction');
  if (top === null || top.special !== special) return false;
  return FRAMES.specialAction.list(state, top).some((a) => !ACTIONS[a.type].stop);
}

// ---------------------------------------------------------------------------
// Hiring (P8) and the free specialist (P16.5)
// ---------------------------------------------------------------------------

/** P8.2. Why this player cannot hire a specialist of `specialist` now. */
export function getHireSpecialistBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  const player = state.players[playerId];
  if (player.train.specialistCarriages.length === 0) {
    return 'You have no carriage yet, so no specialist space. Your first railway station placed by Lay Track brings carriage 1.';
  }
  const spot = nextSpecialistSlot(player);
  if (spot === null) return 'Every specialist space of your carriages is full.';
  if (state.supply.specialists[specialist] <= 0) return `No ${K.NAMES[specialist]} is left in the supply.`;
  const cost = hireCost(state, playerId, specialist);
  const short = firstShortfall(player, cost);
  if (short !== null) return shortfallSentence(state, `In Tycoon Mode a ${K.NAMES[specialist]} into carriage ${spot.carriage}`, cost, short);
  const top = ownFrame(state, playerId, 'hire');
  if (top !== null && top.remaining <= 0) return 'You have made every hire this action allows.';
  return timingBlock(state, playerId, isKind('hire'), 'You can hire only with the Hire Specialists action of Lay Track or Hire Specialists.');
}

/** P8.1. Why this player cannot stop hiring now. */
export function getStopHiringBlockReason(state, playerId) {
  const top = ownFrame(state, playerId, 'hire');
  if (top !== null && top.taken === 0) return 'Choosing Hire Specialists commits you to at least one hire.';
  return timingBlock(state, playerId, isKind('hire'), 'You are not hiring at the moment.');
}

/** P16.5.1. Why this player cannot take a free `specialist` into carriage 1. */
export function getChooseFreeSpecialistBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  if (state.supply.specialists[specialist] <= 0) return `No ${K.NAMES[specialist]} is left in the supply.`;
  return timingBlock(state, playerId, isKind('chooseFreeSpecialist'), 'A free specialist comes only with carriage 1.');
}

// ---------------------------------------------------------------------------
// Board activation (P9)
// ---------------------------------------------------------------------------

const PRODUCING_STEPS = ['crew', 'miner', 'engineer'];

/** The step a boardActivation frame is waiting at, or null. */
export function waitingStep(frame) {
  if (!frame || frame.kind !== 'boardActivation') return null;
  return frame.steps[frame.index] ?? null;
}

/** "the Foreman (as a Crew)", "your Miner in carriage 2". */
export function describeStep(state, step) {
  const K = getConstants(state);
  if (step.type === 'upgrade') return `the upgrade token in carriage ${step.carriage}`;
  if (step.carriage === 0) return `the Foreman (as ${K.NAMES[step.type] === 'Engineer' ? 'an' : 'a'} ${K.NAMES[step.type]})`;
  return `your ${K.NAMES[step.type]} in carriage ${step.carriage}`;
}

/** P9.3. Why this player cannot use the current Crew, Miner or Engineer step. */
export function getUseStepBlockReason(state, playerId) {
  const K = getConstants(state);
  const frame = ownFrame(state, playerId, 'boardActivation');
  if (frame !== null) {
    const step = waitingStep(frame);
    if (step === null) return 'Your board activation has no step left.';
    if (!PRODUCING_STEPS.includes(step.type)) {
      // P10.2 - a Financier step takes a Congress column or a Reset instead.
      return `${describeStep(state, step)} takes a Congress column or a Reset (or is skipped); it builds no tile.`;
    }
    const recipe = K.ACTIVATION.recipes[step.type];
    const short = firstShortfall(state.players[playerId], recipe.cost);
    if (short !== null) return shortfallSentence(state, `Using ${describeStep(state, step)} to build a ${K.NAMES[recipe.builds]} tile`, recipe.cost, short);
  }
  return timingBlock(state, playerId, isKind('boardActivation'), 'You can use a step only during a board activation.');
}

/** P9.3. Why this player cannot skip the current step. */
export function getSkipStepBlockReason(state, playerId) {
  return timingBlock(state, playerId, isKind('boardActivation'), 'You can skip a step only during a board activation.');
}

// ---------------------------------------------------------------------------
// The Financier and Congress (P10)
// ---------------------------------------------------------------------------

/**
 * The Continental Rails Congress strip the shared page draws: empty for this
 * ruleset, whose panel has another shape (the page's strip reads fields this
 * state does not have). This ruleset's panel is `congressColumns` (queries.js).
 */
export function congressTable(state) {
  void state;
  return [];
}

/** P10.1, P10.2.2. The Coin cost of a Congress column or of the Reset (`{ cost }` or a column id). */
export function congressCoinCost(state, playerId, entry) {
  void playerId;
  const K = getConstants(state);
  const id = typeof entry === 'string' ? entry : entry && entry.id;
  if (id === 'KR') return K.CONGRESS.resetCost;
  const column = K.CONGRESS.columns.find((c) => c.id === id);
  if (column) return column.cost;
  return entry && typeof entry.cost === 'number' ? entry.cost : 0;
}

/** Whether any senator is down (P10.2.2). */
export function anySenatorUsed(state) {
  for (const id in state.congress.down) if (state.congress.down[id]) return true;
  return false;
}

/** Whether the pending decision is `playerId`'s activation waiting at a Financier step. */
function atFinancierStep(state, playerId) {
  const frame = ownFrame(state, playerId, 'boardActivation');
  const step = waitingStep(frame);
  return step !== null && step.type === 'financier';
}

const FINANCIER_OTHERWISE = 'Congress columns and the Reset are taken only at a Financier step of a board activation.';

/** P10.3.6. Why the reward of a column cannot be carried out at all now, or null. */
function congressRewardBlock(state, playerId, column) {
  const player = state.players[playerId];
  if (column.reward === 'hats' && state.variants.hatOverflow === 'lost' && player.hats >= getConstants(state).HATS.hatLimit) {
    return `You already hold ${player.hats} cowboy hats, and with hatOverflow "lost" column ${column.id} would give you nothing.`;
  }
  if (column.reward === 'districtHouseOrUpgrade' && !districtHousePossible(state, playerId) && !upgradePossible(state, playerId, false)) {
    return `Column ${column.id} needs a district house you can place or an upgrade token you can install, and you can do neither.`;
  }
  if (column.reward === 'buildings' && !k7Possible(state, playerId, 'railwayStation') && !k7Possible(state, playerId, 'telegraphStation')) {
    return `Column ${column.id} needs a railway station or a telegraph station you can place, and there is nowhere you can.`;
  }
  return null;
}

/** P10.2.1. Why this player cannot take Congress column `columnId` (K1 to K8) now. */
export function getTakeCongressColumnBlockReason(state, playerId, columnId) {
  const K = getConstants(state);
  const column = K.CONGRESS.columns.find((c) => c.id === columnId);
  if (!column) return `"${columnId}" is not a Congress column. The columns are K1 to K8.`;
  if (!(columnId in state.congress.down)) return `Column ${columnId} is not on the Congress panel in this game: it has ${Object.keys(state.congress.down).length} senators.`;
  if (state.congress.down[columnId]) return `The senator of column ${columnId} is down: nobody can take it until a Reset.`;
  const cost = { coins: column.cost };
  const short = firstShortfall(state.players[playerId], cost);
  if (short !== null) return shortfallSentence(state, `Column ${columnId}`, cost, short);
  const reward = congressRewardBlock(state, playerId, column);
  if (reward !== null) return reward;
  if (timingSuspended) return null;
  if (atFinancierStep(state, playerId)) return null;
  return timingBlock(state, playerId, () => false, FINANCIER_OTHERWISE);
}

/** P10.2.2. Why this player cannot Reset the senators now. */
export function getResetSenatorsBlockReason(state, playerId) {
  const K = getConstants(state);
  if (!anySenatorUsed(state)) return 'No senator is down, so a Reset would do nothing.';
  const cost = { coins: K.CONGRESS.resetCost };
  const short = firstShortfall(state.players[playerId], cost);
  if (short !== null) return shortfallSentence(state, 'The Reset', cost, short);
  if (timingSuspended) return null;
  if (atFinancierStep(state, playerId)) return null;
  return timingBlock(state, playerId, () => false, FINANCIER_OTHERWISE);
}

/** P10.3.5. Why this player cannot take 1 built tile of `terrain` now (Congress column K8). */
export function getChooseBuiltTileBlockReason(state, playerId, terrain) {
  const K = getConstants(state);
  if (!K.TERRAINS.includes(terrain)) return `"${terrain}" is not a kind of track tile: choose Ground, Tunnel or Bridge.`;
  return timingBlock(state, playerId, isKind('chooseBuiltTile'), 'You are not owed a built tile of your choice at the moment.');
}

// ---------------------------------------------------------------------------
// The lay (P14)
// ---------------------------------------------------------------------------

const LAY_OTHERWISE = 'You can do that only during a Lay Track action.';

/** P14.1. Why this player cannot start a lay from train `train` (0 or 1). */
export function getStartLayBlockReason(state, playerId, train) {
  const K = getConstants(state);
  if (!Number.isInteger(train) || train < 0 || train >= K.PLAYER_BOARD.railheads) return `"${train}" is not one of your trains: say 0 or 1.`;
  const player = state.players[playerId];
  const city = player.railheads[train];
  if (city === null) return 'That train is not on the map yet.';
  const first = player.railheads.indexOf(city);
  if (first !== train) return `Both your trains stand on ${cityName(city)}; start the lay from your first train there.`;
  const frame = ownFrame(state, playerId, 'lay');
  if (frame !== null) {
    if (frame.path !== null) return 'You are already building a lay: extend it or end it first.';
    if (frame.remaining <= 0) return 'You have made every lay this action allows.';
  }
  if (!canFinishLay(state, playerId, [city], [])) {
    return `No lay can start from ${cityName(city)} with the built tiles you hold (${heldTilesText(K, player)}).`;
  }
  return timingBlock(state, playerId, isKind('lay'), LAY_OTHERWISE);
}

/** P14.2, P14.3, P4.7. Why this player cannot extend the lay being built along `route`. */
export function getExtendPathBlockReason(state, playerId, routeId) {
  const K = getConstants(state);
  const route = MAP.routeById[routeId];
  if (!route) return `"${routeId}" is not a route on the map.`;
  const frame = ownFrame(state, playerId, 'lay');
  if (frame === null || frame.path === null) {
    if (timingSuspended) return null;
    if (frame !== null) return 'Start a lay from one of your trains first.';
    return timingBlock(state, playerId, () => false, LAY_OTHERWISE);
  }
  const { cities, routes } = frame.path;
  const last = cities[cities.length - 1];
  if (route.a !== last && route.b !== last) return `The lay has reached ${cityName(last)}, and ${routeName(route)} does not start there.`;
  const next = otherEnd(route, last);
  if (cities.includes(next)) return `The lay has already passed through ${cityName(next)}: a path enters no city twice.`;
  const unlaid = state.map.routeOwner[route.id] === null;
  const shape = state.variants.layShape;
  if (shape === 'adjacent-only' && (routes.length > 0 || !unlaid)) {
    return 'With the lay shape "adjacent-only" a lay is one unlaid route starting at your train.';
  }
  if (shape === 'one-new-route' && unlaidCount(state, routes) > 0) {
    return 'With the lay shape "one-new-route" the lay ends with its one new route: end it now.';
  }
  if (unlaid) {
    if (state.variants.newConnectionRule === 'must-join-unjoined' && !connectionAllowed(state, route, laidComponents(state))) {
      return `${routeName(route)} would only close a loop: laid routes already join ${cityName(route.a)} and ${cityName(route.b)}.`;
    }
    const short = whyCannotPayTiles(K, state.players[playerId], tilesForRoutes(state, [...routes, route.id]));
    if (short !== null) return short;
  }
  if (!canFinishLay(state, playerId, [...cities, next], [...routes, route.id])) {
    return `From ${cityName(next)} this lay could not be finished: no affordable unlaid route and no empty city to build in is reachable from there.`;
  }
  return null;
}

/** P14.3, P14.5. Why this player cannot end the lay being built here. */
export function getEndLayBlockReason(state, playerId) {
  const frame = ownFrame(state, playerId, 'lay');
  if (frame === null || frame.path === null) {
    if (timingSuspended) return null;
    if (frame !== null) return 'Start a lay from one of your trains first.';
    return timingBlock(state, playerId, () => false, LAY_OTHERWISE);
  }
  const { cities, routes } = frame.path;
  if (routes.length === 0) return 'The lay has not left its train\'s city yet: extend it along a route.';
  if (!isLegalLay(state, playerId, cities, routes)) {
    const last = cities[cities.length - 1];
    if (unlaidCount(state, routes) > 0) return `A lay must end with a route it lays, and the last route into ${cityName(last)} is already laid: extend it.`;
    return `A lay that lays nothing must end in an inland city with no building where you can build, and ${cityName(last)} is not one: extend it.`;
  }
  return null;
}

/** P14.1. Why this player cannot stop laying now. */
export function getStopLayingBlockReason(state, playerId) {
  const frame = ownFrame(state, playerId, 'lay');
  if (frame !== null) {
    if (frame.path !== null) return 'Finish the lay you are building first.';
    if (frame.taken === 0) return 'Choosing Lay Track commits you to at least one lay.';
  }
  return timingBlock(state, playerId, isKind('lay'), 'You are not laying track at the moment.');
}

/**
 * P14.9. Why this player cannot fill the pending wild slot with a `terrain` tile:
 * it is not a tile type, or they have no spare tile of it (after the lay's fixed
 * slots and the tiles already chosen for earlier wild slots).
 */
export function getFillWildSlotBlockReason(state, playerId, terrain) {
  const K = getConstants(state);
  if (!K.TERRAINS.includes(terrain)) return `"${terrain}" is not a kind of track tile: choose Ground, Tunnel or Bridge.`;
  const frame = ownFrame(state, playerId, 'wildSlot');
  if (frame === null) {
    if (timingSuspended) return null;
    return timingBlock(state, playerId, () => false, 'There is no wild slot waiting for a tile.');
  }
  const spare = wildSlotSpare(state);
  if (spare === null || !(terrain in spare)) {
    const held = state.players[playerId].builtTiles[terrain];
    return `You have no spare built ${K.NAMES[terrain]} tile for this wild slot: you hold ${held}, and the lay's fixed slots and your earlier choices use them all.`;
  }
  return timingBlock(state, playerId, isKind('wildSlot'), 'There is no wild slot waiting for a tile.');
}

// ---------------------------------------------------------------------------
// The action table
// ---------------------------------------------------------------------------

/**
 * One entry per action type.
 *   params    required parameters; `optional` lists parameters that may be absent
 *   rule      rule numbers
 *   block     (state, playerId, action) => reason or null
 *   space     (state) => every well-formed action of this type
 *   describe  (state, action) => a short imperative phrase
 *   stop      true for an explicit stop action
 *
 * THIS TABLE MUST HAVE THE SAME KEYS AS `MUTATORS` IN actions.js.
 */
export const ACTIONS = {
  placeRailhead: {
    params: ['city'],
    rule: 'P3.5',
    block: (state, pid, a) => getPlaceRailheadBlockReason(state, pid, a.city),
    space: () => MAP.cityIds.map((city) => ({ type: 'placeRailhead', city })),
    describe: (state, a) => `Put a train on ${cityName(a.city)}`,
  },
  chooseStartingProduction: {
    params: ['track'],
    rule: 'P3.3',
    block: (state, pid, a) => getStartingProductionBlockReason(state, pid, a.track),
    space: (state) => getConstants(state).PLAYER_BOARD.houseTracks.map((track) => ({ type: 'chooseStartingProduction', track })),
    describe: (state, a) => `Leave the +1 house space of the ${getConstants(state).NAMES[a.track]} track empty (production 2)`,
  },
  chooseResource: {
    params: ['resource'],
    rule: 'P1.8, P5.5.3',
    block: (state, pid, a) => getChooseResourceBlockReason(state, pid, a.resource),
    space: (state) => getConstants(state).CHOICE_RESOURCES.map((resource) => ({ type: 'chooseResource', resource })),
    describe: (state, a) => `Take 1 ${getConstants(state).NAMES[a.resource]}`,
  },
  discard: {
    params: ['item'],
    rule: 'P7.6',
    block: (state, pid, a) => getDiscardBlockReason(state, pid, a.item),
    space: (state) => getConstants(state).STORAGE_ITEMS.map((item) => ({ type: 'discard', item })),
    describe: (state, a) => {
      const K = getConstants(state);
      return K.TERRAINS.includes(a.item) ? `Discard 1 built ${K.NAMES[a.item]} tile` : `Discard 1 ${K.NAMES[a.item]}`;
    },
  },
  placeWorker: {
    params: ['space'],
    rule: 'P5.3',
    block: (state, pid, a) => getPlaceWorkerBlockReason(state, pid, a.space),
    space: () => SPACE_IDS.map((space) => ({ type: 'placeWorker', space })),
    describe: (state, a) => `Place a worker on ${a.space}`,
  },
  displaceWorker: {
    params: ['district'],
    rule: 'P5.5',
    block: (state, pid, a) => getDisplaceWorkerBlockReason(state, pid, a.district),
    space: () => DISTRICT_IDS.map((district) => ({ type: 'displaceWorker', district })),
    describe: (state, a) => `Displace: put a worker on the centre of ${districtName(state, a.district)}`,
  },
  removeWorker: {
    params: ['from'],
    rule: 'P5.4',
    block: (state, pid, a) => getRemoveWorkerBlockReason(state, pid, a.from),
    space: () => [...SPACE_IDS, ...DISTRICT_IDS].map((from) => ({ type: 'removeWorker', from })),
    describe: (state, a) => (isSpaceId(a.from) ? `Remove your worker from ${a.from}` : `Remove your worker from the centre of ${districtName(state, a.from)}`),
  },
  chooseDistrict: {
    params: ['district', 'hats'],
    optional: ['mode'],
    rule: 'P4.2.2, P5.7, P8.1, P11.2',
    block: (state, pid, a) => getChooseDistrictBlockReason(state, pid, a.district, a.hats, a.mode),
    space: (state) => {
      const max = getConstants(state).HATS.hatLimit;
      const out = [{ type: 'chooseDistrict', district: 'none', hats: 0 }];
      for (const district of DISTRICT_IDS) {
        const layOrHire = districtInfo(state, district).family === 'layOrHire';
        for (let hats = 0; hats <= max; hats++) {
          if (layOrHire) {
            out.push({ type: 'chooseDistrict', district, hats, mode: 'lay' });
            out.push({ type: 'chooseDistrict', district, hats, mode: 'hire' });
          } else out.push({ type: 'chooseDistrict', district, hats });
        }
      }
      return out;
    },
    describe: (state, a) => {
      if (a.district === 'none') return 'Take no district action this turn';
      const name = a.mode === 'lay' ? 'Lay Track' : a.mode === 'hire' ? 'Hire Specialists' : districtName(state, a.district);
      return `Take ${name}${a.hats > 0 ? `, spending ${plural(a.hats, 'cowboy hat', 'cowboy hats')}` : ''}`;
    },
  },
  useStep: {
    params: [],
    rule: 'P9.3',
    block: (state, pid) => getUseStepBlockReason(state, pid),
    space: () => [{ type: 'useStep' }],
    describe: (state) => {
      const step = waitingStep(topFrame(state));
      if (!step || !PRODUCING_STEPS.includes(step.type)) return 'Use this step';
      const K = getConstants(state);
      const recipe = K.ACTIVATION.recipes[step.type];
      return `Use ${describeStep(state, step)}: pay ${formatCost(state, recipe.cost)}, build 1 ${K.NAMES[recipe.builds]} tile`;
    },
  },
  skipStep: {
    params: [],
    rule: 'P9.3',
    stop: true,
    block: (state, pid) => getSkipStepBlockReason(state, pid),
    space: () => [{ type: 'skipStep' }],
    describe: (state) => {
      const step = waitingStep(topFrame(state));
      return step ? `Skip ${describeStep(state, step)}` : 'Skip this step';
    },
  },
  skipSpecialAction: {
    params: [],
    rule: 'P6.7',
    stop: true,
    block: (state, pid) => getSkipSpecialActionBlockReason(state, pid),
    space: () => [{ type: 'skipSpecialAction' }],
    describe: () => 'Take no special action',
  },
  placeTelegraphStation: {
    params: ['city'],
    rule: 'P16.3, P14.6, P6.7',
    block: (state, pid, a) => getPlaceTelegraphStationBlockReason(state, pid, a.city),
    space: () => MAP.inlandCities.map((city) => ({ type: 'placeTelegraphStation', city })),
    describe: (state, a) => {
      const vp = nextTelegraphVp(state, state.toAct ?? 0);
      return `Place a telegraph station in ${cityName(a.city)}${vp !== null ? ` (${vp} VP)` : ''}`;
    },
  },
  placeRailwayStation: {
    params: ['city', 'houseTrack'],
    rule: 'P16.2, P14.6, P6.7',
    block: (state, pid, a) => getPlaceRailwayStationBlockReason(state, pid, a.city, a.houseTrack),
    space: (state) => {
      const out = [];
      for (const city of MAP.inlandCities) {
        for (const houseTrack of getConstants(state).PLAYER_BOARD.houseTracks) out.push({ type: 'placeRailwayStation', city, houseTrack });
      }
      return out;
    },
    describe: (state, a) => `Place a railway station in ${cityName(a.city)}, from your ${getConstants(state).NAMES[a.houseTrack]} track`,
  },
  placeDistrictHouse: {
    params: ['district', 'houseTrack'],
    rule: 'P6.6, P6.7',
    block: (state, pid, a) => getPlaceDistrictHouseBlockReason(state, pid, a.district, a.houseTrack),
    space: (state) => {
      const out = [];
      for (const district of DISTRICT_IDS) {
        for (const houseTrack of getConstants(state).PLAYER_BOARD.houseTracks) out.push({ type: 'placeDistrictHouse', district, houseTrack });
      }
      return out;
    },
    describe: (state, a) => `Place a district house on ${districtName(state, a.district)}, from your ${getConstants(state).NAMES[a.houseTrack]} track`,
  },
  skipBuilding: {
    params: [],
    rule: 'P14.6',
    stop: true,
    block: (state, pid) => getSkipBuildingBlockReason(state, pid),
    space: () => [{ type: 'skipBuilding' }],
    describe: () => 'Place no building',
  },
  hireSpecialist: {
    params: ['specialist'],
    rule: 'P8',
    block: (state, pid, a) => getHireSpecialistBlockReason(state, pid, a.specialist),
    space: (state) => getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'hireSpecialist', specialist })),
    describe: (state, a) => `Hire a ${getConstants(state).NAMES[a.specialist]}`,
  },
  stopHiring: {
    params: [],
    rule: 'P8.1',
    stop: true,
    block: (state, pid) => getStopHiringBlockReason(state, pid),
    space: () => [{ type: 'stopHiring' }],
    describe: () => 'Stop hiring',
  },
  chooseFreeSpecialist: {
    params: ['specialist'],
    rule: 'P16.5.1',
    block: (state, pid, a) => getChooseFreeSpecialistBlockReason(state, pid, a.specialist),
    space: (state) => getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'chooseFreeSpecialist', specialist })),
    describe: (state, a) => `Take a free ${getConstants(state).NAMES[a.specialist]} into carriage 1`,
  },
  startLay: {
    params: ['train'],
    rule: 'P14.1, P14.2',
    block: (state, pid, a) => getStartLayBlockReason(state, pid, a.train),
    space: (state) => Array.from({ length: getConstants(state).PLAYER_BOARD.railheads }, (_, train) => ({ type: 'startLay', train })),
    describe: (state, a) => {
      const pid = state.toAct ?? 0;
      const city = state.players[pid].railheads[a.train];
      return `Start a lay from your train on ${city === null ? 'no city' : cityName(city)}`;
    },
  },
  extendPath: {
    params: ['route'],
    rule: 'P14.2, P14.3, P4.7',
    block: (state, pid, a) => getExtendPathBlockReason(state, pid, a.route),
    space: () => MAP.routeIds.map((route) => ({ type: 'extendPath', route })),
    describe: (state, a) => {
      const route = MAP.routeById[a.route];
      if (!route) return `Extend the lay along ${a.route}`;
      const path = layPath(state);
      const from = path ? path.cities[path.cities.length - 1] : route.a;
      const to = from === route.a ? route.b : route.a;
      return state.map.routeOwner[route.id] === null
        ? `Lay ${cityName(from)} - ${cityName(to)} (${formatRouteCost(state, route)})`
        : `Travel ${cityName(from)} - ${cityName(to)} over laid track`;
    },
  },
  endLay: {
    params: [],
    rule: 'P14.5',
    block: (state, pid) => getEndLayBlockReason(state, pid),
    space: () => [{ type: 'endLay' }],
    describe: (state) => {
      const path = layPath(state);
      return path ? `End the lay in ${cityName(path.cities[path.cities.length - 1])}` : 'End the lay';
    },
  },
  stopLaying: {
    params: [],
    rule: 'P14.1',
    stop: true,
    block: (state, pid) => getStopLayingBlockReason(state, pid),
    space: () => [{ type: 'stopLaying' }],
    describe: () => 'Stop laying track',
  },
  fillWildSlot: {
    params: ['terrain'],
    rule: 'P14.9',
    block: (state, pid, a) => getFillWildSlotBlockReason(state, pid, a.terrain),
    space: (state) => getConstants(state).TERRAINS.map((terrain) => ({ type: 'fillWildSlot', terrain })),
    describe: (state, a) => {
      const top = topFrame(state);
      const where = top !== null && top.kind === 'wildSlot' && MAP.routeById[top.route] ? ` of ${routeName(MAP.routeById[top.route])}` : '';
      return `Fill the wild slot${where} with a built ${getConstants(state).NAMES[a.terrain]} tile`;
    },
  },
  takeCongressColumn: {
    params: ['column'],
    rule: 'P10.2.1, P10.3',
    block: (state, pid, a) => getTakeCongressColumnBlockReason(state, pid, a.column),
    space: (state) => getConstants(state).CONGRESS.columns.map((c) => ({ type: 'takeCongressColumn', column: c.id })),
    describe: (state, a) => {
      const column = getConstants(state).CONGRESS.columns.find((c) => c.id === a.column);
      return column ? `Take Congress column ${a.column} (${formatCost(state, { coins: column.cost })}): ${CONGRESS_TEXT[column.reward](state, column)}` : `Take Congress column ${a.column}`;
    },
  },
  resetSenators: {
    params: [],
    rule: 'P10.2.2',
    block: (state, pid) => getResetSenatorsBlockReason(state, pid),
    space: () => [{ type: 'resetSenators' }],
    describe: (state) => {
      const down = Object.values(state.congress.down).filter(Boolean).length;
      return `Reset the senators (${formatCost(state, { coins: getConstants(state).CONGRESS.resetCost })}): ${plural(down, 'senator returns', 'senators return')}, ${down} VP`;
    },
  },
  installUpgrade: {
    params: ['token', 'carriage'],
    rule: 'P12.2, P12.3, P6.7, P10.3.3',
    block: (state, pid, a) => getInstallUpgradeBlockReason(state, pid, a.token, a.carriage),
    space: (state) => {
      const out = [];
      for (const token of upgradeTokenIds(state)) for (let carriage = 1; carriage <= getConstants(state).PLAYER_BOARD.maxCarriages; carriage++) out.push({ type: 'installUpgrade', token, carriage });
      return out;
    },
    describe: (state, a) => {
      const pid = state.toAct ?? 0;
      const c = state.players[pid].train.specialistCarriages[a.carriage - 1];
      const verb = c && c.upgrade !== null ? `Replace the ${c.upgrade} token of carriage ${a.carriage} with` : `Install in carriage ${a.carriage}`;
      return `${verb} the upgrade token ${a.token} (${upgradeText(state, a.token)})`;
    },
  },
  chooseBuiltTile: {
    params: ['terrain'],
    rule: 'P10.3.5',
    block: (state, pid, a) => getChooseBuiltTileBlockReason(state, pid, a.terrain),
    space: (state) => getConstants(state).TERRAINS.map((terrain) => ({ type: 'chooseBuiltTile', terrain })),
    describe: (state, a) => `Take 1 built ${getConstants(state).NAMES[a.terrain]} tile`,
  },
};

/** What an upgrade token gives, in words (P12.1). */
function upgradeText(state, token) {
  const K = getConstants(state);
  const data = upgradeTileData(state, token);
  if (data === null) return 'unknown';
  const n = K.UPGRADES.yield[data.level - 1];
  return data.gives === 'choice' ? `${n} resources of your choice each activation` : `${formatAmount(K, data.gives, n)} each activation`;
}

/** P10.1. The reward of a Congress column, in words. */
const CONGRESS_TEXT = {
  gain: (state, c) => Object.entries(c.items).map(([k, n]) => formatAmount(getConstants(state), k, n)).join(' + '),
  hats: (state, c) => `${c.count} cowboy hats`,
  districtHouseOrUpgrade: (state, c) => `a district house or an upgrade token, and ${c.vp} VP`,
  choice: (state, c) => `${c.count} resources of your choice (not Coins)`,
  buildings: () => 'a railway station and / or a telegraph station',
  builtTiles: (state, c) => `${c.count} built tiles of your choice`,
};

/**
 * The "stop / skip / done" action types. When one of these is applied
 * automatically (it was the only legal action) it means "there was nothing
 * to do here"; a log may leave such events out.
 */
export const STOP_ACTION_TYPES = Object.keys(ACTIONS).filter((type) => ACTIONS[type].stop === true);

/** Contract compatibility: this ruleset has no bonus actions (P24.4). */
export const BONUS_ACTION_TYPES = {};

// ---------------------------------------------------------------------------
// The decision table
// ---------------------------------------------------------------------------
//
// One entry per kind of pending decision (frame on `state.stack`).
//   label - (state, frame) => what the player is being asked, as a verb phrase
//   list  - (state, frame) => the COMPLETE list of legal actions; every action
//           returned has been passed by its block-reason function.

function keepLegal(state, playerId, candidates) {
  const out = [];
  for (const action of candidates) {
    if (ACTIONS[action.type].block(state, playerId, action) === null) out.push(action);
  }
  return out;
}

export const FRAMES = {
  /** P3.3. */
  setupProduction: {
    label: () => 'choose the house track whose +1 space starts empty',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseStartingProduction.space(state)),
  },
  /** P3.5. */
  setupRailhead: {
    label: (state, frame) => (state.players[frame.player].railheads[0] === null ? 'place your first train' : 'place your second train'),
    list: (state, frame) => keepLegal(state, frame.player, MAP.startCities.map((city) => ({ type: 'placeRailhead', city }))),
  },
  /** P5.5.3, P11.1. Frame: { remaining, reason, allowed }. */
  chooseResource: {
    label: (state, frame) => `choose ${frame.remaining === 1 ? 'a resource' : `${frame.remaining} resources`}`,
    list: (state, frame) => keepLegal(state, frame.player, frame.allowed.map((resource) => ({ type: 'chooseResource', resource }))),
  },
  /** P7.6. */
  discard: {
    label: (state, frame) => `discard down to your storage capacity of ${storageCapacity(state, frame.player)}`,
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.discard.space(state)),
  },
  /** P4.2.1. */
  workerStep: {
    label: () => 'place, displace or remove a worker',
    list: (state, frame) => {
      const pid = frame.player;
      const candidates = [];
      const player = state.players[pid];
      if (player.workersInSupply > 0) {
        for (const space of SPACE_IDS) if (state.grid.spaces[space] === null) candidates.push({ type: 'placeWorker', space });
        for (const district of DISTRICT_IDS) candidates.push({ type: 'displaceWorker', district });
      }
      const mine = workersOnGrid(state, pid);
      for (const space of mine.spaces) candidates.push({ type: 'removeWorker', from: space });
      for (const district of mine.centres) candidates.push({ type: 'removeWorker', from: district });
      return keepLegal(state, pid, candidates);
    },
  },
  /** P4.2.2. */
  chooseDistrict: {
    label: () => 'choose the district whose action you take',
    list: (state, frame) => {
      const pid = frame.player;
      const candidates = [{ type: 'chooseDistrict', district: 'none', hats: 0 }];
      const held = state.players[pid].hats;
      for (const district of accessDistricts(state)) {
        const layOrHire = districtInfo(state, district).family === 'layOrHire';
        for (let hats = 0; hats <= held; hats++) {
          if (layOrHire) {
            candidates.push({ type: 'chooseDistrict', district, hats, mode: 'lay' });
            candidates.push({ type: 'chooseDistrict', district, hats, mode: 'hire' });
          } else candidates.push({ type: 'chooseDistrict', district, hats });
        }
      }
      return keepLegal(state, pid, candidates);
    },
  },
  /** P6.7. Frame: { district, special }. */
  specialAction: {
    label: (state, frame) => `take the special action of ${districtName(state, frame.district)}, or decline it`,
    list: (state, frame) => {
      const K = getConstants(state);
      const candidates = [];
      if (frame.special === 'telegraphStation') {
        for (const city of MAP.inlandCities) candidates.push({ type: 'placeTelegraphStation', city });
      } else if (frame.special === 'railwayStation') {
        for (const city of MAP.inlandCities) for (const houseTrack of K.PLAYER_BOARD.houseTracks) candidates.push({ type: 'placeRailwayStation', city, houseTrack });
      } else if (frame.special === 'districtHouse') {
        for (const { district } of emptySites(state)) {
          for (const houseTrack of K.PLAYER_BOARD.houseTracks) {
            if (!candidates.some((c) => c.district === district && c.houseTrack === houseTrack)) candidates.push({ type: 'placeDistrictHouse', district, houseTrack });
          }
        }
      }
      else if (frame.special === 'upgrade') {
        // P12.2, P12.3 - install a token from the supply, or replace one of yours.
        for (const carriage of state.players[frame.player].train.specialistCarriages) {
          for (const token of new Set(state.supply.upgrades)) candidates.push({ type: 'installUpgrade', token, carriage: carriage.number });
        }
      }
      candidates.push({ type: 'skipSpecialAction' });
      return keepLegal(state, frame.player, candidates);
    },
  },
  /** P9. Frame: { foreman, steps: [{ type, carriage, slot }], index, cause }. */
  boardActivation: {
    label: (state, frame) => {
      const step = waitingStep(frame);
      return step ? `use or skip ${describeStep(state, step)}` : 'finish your board activation';
    },
    list: (state, frame) => {
      const step = waitingStep(frame);
      if (step !== null && step.type === 'financier') {
        // P10.2 - one Financier action: a column, a Reset, or skip.
        return keepLegal(state, frame.player, [...ACTIONS.takeCongressColumn.space(state), { type: 'resetSenators' }, { type: 'skipStep' }]);
      }
      return keepLegal(state, frame.player, [{ type: 'useStep' }, { type: 'skipStep' }]);
    },
  },
  /** P10.3.3, P10.3.4. Frame: { column: 'K5' | 'K7', placed: { railwayStation, telegraphStation } }. */
  congressPlacement: {
    label: (state, frame) =>
      frame.column === 'K5'
        ? 'place a district house or install an upgrade token (Congress column K5)'
        : frame.placed.railwayStation || frame.placed.telegraphStation
          ? 'place the other building of Congress column K7, or stop'
          : 'place a railway station or a telegraph station (Congress column K7)',
    list: (state, frame) => {
      const K = getConstants(state);
      const pid = frame.player;
      const candidates = [];
      if (frame.column === 'K5') {
        for (const { district } of emptySites(state)) {
          for (const houseTrack of K.PLAYER_BOARD.houseTracks) {
            if (!candidates.some((c) => c.district === district && c.houseTrack === houseTrack)) candidates.push({ type: 'placeDistrictHouse', district, houseTrack });
          }
        }
        for (const carriage of state.players[pid].train.specialistCarriages) {
          for (const token of new Set(state.supply.upgrades)) candidates.push({ type: 'installUpgrade', token, carriage: carriage.number });
        }
      } else {
        for (const city of MAP.inlandCities) {
          for (const houseTrack of K.PLAYER_BOARD.houseTracks) candidates.push({ type: 'placeRailwayStation', city, houseTrack });
          candidates.push({ type: 'placeTelegraphStation', city });
        }
        candidates.push({ type: 'skipBuilding' });
      }
      return keepLegal(state, pid, candidates);
    },
  },
  /** P10.3.5. Frame: { remaining, cause }. */
  chooseBuiltTile: {
    label: (state, frame) => `choose ${frame.remaining === 1 ? 'a built tile' : `${frame.remaining} built tiles`}`,
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseBuiltTile.space(state)),
  },
  /** P8. Frame: { remaining, taken }. */
  hire: {
    label: (state, frame) => (frame.taken === 0 ? 'hire a specialist' : `hire another specialist (${frame.remaining} more allowed), or stop`),
    list: (state, frame) => keepLegal(state, frame.player, [...ACTIONS.hireSpecialist.space(state), { type: 'stopHiring' }]),
  },
  /** P16.5.1. */
  chooseFreeSpecialist: {
    label: () => 'choose the free specialist that comes with carriage 1',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseFreeSpecialist.space(state)),
  },
  /** P14. Frame: { remaining, taken, path: null | { train, cities, routes } }. */
  lay: {
    label: (state, frame) => {
      if (frame.path === null) return frame.taken === 0 ? 'start a lay from one of your trains' : `start another lay (${frame.remaining} more allowed), or stop`;
      return `extend the lay from ${cityName(frame.path.cities[frame.path.cities.length - 1])}, or end it there`;
    },
    list: (state, frame) => {
      const pid = frame.player;
      const candidates = [];
      if (frame.path === null) {
        for (const s of trainStarts(state.players[pid])) candidates.push({ type: 'startLay', train: s.index });
        candidates.push({ type: 'stopLaying' });
      } else {
        const last = frame.path.cities[frame.path.cities.length - 1];
        for (const route of MAP.cityRoutes[last]) candidates.push({ type: 'extendPath', route });
        candidates.push({ type: 'endLay' });
      }
      return keepLegal(state, pid, candidates);
    },
  },
  /**
   * P14.9. Frame: { route, slot, remaining, cause: 'lay' }. One per wild slot on the
   * ended lay's unlaid routes, the first the train passes on top; `remaining` is how
   * many more come after this one. The lay frame under them keeps the path and the
   * choices so far (`wildFills`).
   */
  wildSlot: {
    label: (state, frame) => {
      const route = MAP.routeById[frame.route];
      return `choose the built tile for the wild slot of ${route ? routeName(route) : frame.route}${frame.remaining > 0 ? ` (${plural(frame.remaining, 'more wild slot', 'more wild slots')} after it)` : ''}`;
    },
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.fillWildSlot.space(state)),
  },
  /** P14.6. Frame: { city, optional, cause }. */
  placeBuildings: {
    label: (state, frame) => `place a building in ${cityName(frame.city)}`,
    list: (state, frame) => {
      const K = getConstants(state);
      const candidates = [];
      for (const houseTrack of K.PLAYER_BOARD.houseTracks) candidates.push({ type: 'placeRailwayStation', city: frame.city, houseTrack });
      candidates.push({ type: 'placeTelegraphStation', city: frame.city });
      candidates.push({ type: 'skipBuilding' });
      return keepLegal(state, frame.player, candidates);
    },
  },
};

/** What the pending decision asks, as a verb phrase ("place your first train"). */
export function frameLabel(state, frame) {
  const def = FRAMES[frame.kind];
  return def ? def.label(state, frame) : frame.kind;
}

// ---------------------------------------------------------------------------
// The public functions
// ---------------------------------------------------------------------------

/**
 * LAYER 1. The complete list of legal next actions, all for the one player
 * `state.toAct`. Empty only when the game is over. On a state that came from
 * createGame or applyAction the list never has exactly one entry: a forced
 * action is applied by the engine itself. Returns fresh objects.
 */
export function getValidActions(state) {
  if (state.phase === 'ended') return [];
  const frame = topFrame(state);
  if (frame === null) return [];
  return FRAMES[frame.kind].list(state, frame);
}

/**
 * LAYER 2. Why `action` cannot be taken now: a sentence for the player, or
 * null when the action is legal. Asked for `action.player` if present, else
 * for `state.toAct`.
 */
export function getBlockReason(state, action) {
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return 'An action must be an object with a `type`.';
  }
  const def = ACTIONS[action.type];
  if (!def) return `"${action.type}" is not an action of this game.`;
  for (const param of def.params) {
    if (action[param] === undefined || action[param] === null) return `The action "${action.type}" needs \`${param}\`.`;
  }
  let playerId = action.player;
  if (playerId === undefined || playerId === null) {
    if (state.toAct === null) return 'The game is over.';
    playerId = state.toAct;
  } else if (!Number.isInteger(playerId) || playerId < 0 || playerId >= state.players.length) {
    return `There is no player ${JSON.stringify(playerId)} in this game.`;
  }
  return def.block(state, playerId, action);
}

/**
 * As getBlockReason, but leaving aside whose decision it is and which
 * decision is pending: "if it were my move of the right kind, could I?".
 */
export function getStructuralBlockReason(state, action) {
  timingSuspended = true;
  try {
    return getBlockReason(state, action);
  } finally {
    timingSuspended = false;
  }
}

/** Every well-formed action of every type, legal or not. For diagnostics and tests, not for bots. */
export function getActionSpace(state) {
  const out = [];
  for (const type of Object.keys(ACTIONS)) {
    for (const action of ACTIONS[type].space(state)) out.push(action);
  }
  return out;
}

/** A canonical text key for an action: equal actions give equal keys. Optional parameters appear only when present. */
export function actionKey(action) {
  const def = ACTIONS[action.type];
  if (!def) return action.type;
  let key = action.type;
  for (const param of def.params) key += `:${action[param]}`;
  if (def.optional) {
    for (const param of def.optional) if (action[param] !== undefined && action[param] !== null) key += `:${param}=${action[param]}`;
  }
  return key;
}

/** A short imperative phrase for an action, for buttons and logs ("Place a worker on W4"). */
export function describeAction(state, action) {
  const def = ACTIONS[action.type];
  return def ? def.describe(state, action) : action.type;
}

/** What is being asked, and of whom: `{ player, kind, prompt }`, or null when the game is over. */
export function describeDecision(state) {
  const frame = topFrame(state);
  if (state.phase === 'ended' || frame === null) return null;
  return { player: frame.player, kind: frame.kind, prompt: `${nameOf(state, frame.player)}: ${frameLabel(state, frame)}` };
}

/**
 * For the district choice: M for each choice on offer, as
 * `[{ district, hats, mode, hat, multiplier, adjacent }]` (`hat` is
 * `hats > 0`, for readers written for one hat). P5.7.
 */
export function previewMultipliers(state) {
  const frame = topFrame(state);
  if (frame === null || frame.kind !== 'chooseDistrict') return [];
  const exclude = usedWorkerAt(state);
  return getValidActions(state)
    .filter((a) => a.district !== 'none')
    .map((a) => {
      const m = multiplierFor(state, frame.player, a.district, a.hats, exclude);
      return { district: a.district, hats: a.hats, mode: a.mode ?? null, hat: a.hats > 0, multiplier: m.multiplier, adjacent: m.adjacent };
    });
}
