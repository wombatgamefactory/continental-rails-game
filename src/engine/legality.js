// legality.js - what a player may do, and why not.
//
// The three layers of the legality ladder all rest on ONE set of functions,
// the `get...BlockReason` functions below:
//
//   1. getValidActions(state)        - the complete list of legal next actions
//                                      for the one player who must decide.
//   2. getBlockReason(state, action) - null if legal, else a sentence for the
//                                      player naming the FIRST blocker in
//                                      rulebook order, with real numbers.
//   3. applyAction (actions.js)      - refuses whatever layer 2 refuses.
//
// Layer 1 lists an action only if its block reason is null, and layer 3 asks
// the same function, so the list and the mutators cannot disagree.
//
// Writing a block-reason function:
//   - check the requirements in the order the rulebook states them;
//   - put the timing check ("it is not your decision") LAST, or it hides
//     every structural reason from a player who is asking ahead of time;
//   - quote the numbers ("costs 2 Coins + 1 Iron and you have 1 Coin");
//   - write to the player as "you"; British English.
//
// Nothing here changes or copies the state.

import { getConstants, topFrame, bonusActionsInPlay } from './state.js';
import { metricValue } from './conditions.js';
import {
  MAP,
  SPACE_IDS,
  DISTRICT_IDS,
  SPACE_DISTRICTS,
  DISTRICT_SPACES,
  DISTRICT_NEIGHBOURS,
  isDistrictId,
  isSpaceId,
  startSide,
} from './board.js';
import {
  districtInfo,
  districtName,
  storageUsed,
  storageCapacity,
  storageOverflow,
  storedCount,
  firstShortfall,
  formatCost,
  formatAmount,
  nextSpecialistSlot,
  specialistSlotUse,
  hireCost,
  hasCentreWorker,
  workersOnGrid,
  multiplierFor,
  accessDistricts,
  housesOnBoard,
  canAffordRoute,
  routeShortfall,
  routeName,
  formatRouteCost,
  networkCities,
  reachableCities,
  touchesClaimedRoute,
  isCityConnected,
  buildingRoom,
  nextTelegraphVp,
  upgradeTileData,
  ponyCardData,
  ponyModifier,
  ponyOngoing,
  ponyAbilities,
  specialistCounts,
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

// ---------------------------------------------------------------------------
// R4.6 - which district actions can be chosen
// ---------------------------------------------------------------------------

/**
 * One entry per district family whose action is implemented, giving the rule
 * of R4.6 for it: null when the action can be chosen, else a sentence.
 *
 * THIS TABLE MUST HAVE THE SAME KEYS AS `DISTRICT_RESOLVERS` IN actions.js.
 * A family in one and not the other is either a district that can be chosen
 * and then does nothing, or an action nobody can ever choose
 * (tests/contract.test.mjs checks the two agree).
 *
 * To add a district family (contract section 19): one entry here, the same
 * key in DISTRICT_RESOLVERS.
 */
export const DISTRICT_ACTION_RULES = {
  /** R4.6.1. A Gather action can always be chosen. */
  gather: () => null,
  /** R4.6.2. A train activation can always be chosen, even if every step is then skipped. */
  trainActivation: () => null,
  /** R4.6.3. Lay Tracks / Move Train needs at least one legal claim (R11.4) or one legal move (R12.2). */
  layTracks: (state, playerId) => {
    if (hasLegalClaim(state, playerId) || hasLegalMove(state, playerId)) return null;
    return whyNoLayStep(state, playerId);
  },
};

/**
 * R11.4, R11.11.3. Whether the player could claim any route right now,
 * leaving aside how many steps an action would give (R4.6.3).
 */
export function hasLegalClaim(state, playerId) {
  const player = state.players[playerId];
  const owner = state.map.routeOwner;
  if (state.variants.claimFrom === 'network') {
    const net = networkCities(state, playerId);
    for (const route of MAP.routes) {
      if (owner[route.id] !== null) continue;
      if (!net.includes(route.a) && !net.includes(route.b)) continue;
      if (canAffordRoute(player, route)) return true;
    }
    return false;
  }
  for (const city of player.railheads) {
    if (city === null) continue; // the draft (R3.5) has not placed this railhead yet
    for (const id of MAP.cityRoutes[city]) {
      if (owner[id] === null && canAffordRoute(player, MAP.routeById[id])) return true;
    }
  }
  return false;
}

/** R12.2, R12.6. Whether a railhead of the player stands on a city that a claimed route touches. Never in network mode (R11.11.5). */
export function hasLegalMove(state, playerId) {
  if (state.variants.claimFrom === 'network') return false;
  return state.players[playerId].railheads.some((city) => city !== null && touchesClaimedRoute(state, city));
}

/** R4.6.3. The sentence for a player who can neither claim nor move. */
function whyNoLayStep(state, playerId) {
  const player = state.players[playerId];
  const K = getConstants(state);
  const network = state.variants.claimFrom === 'network';
  const cities = network ? networkCities(state, playerId) : [...new Set(player.railheads)].filter((c) => c !== null);
  const where = cities.map((c) => MAP.cityById[c].name);
  // The cheapest unclaimed route that touches those cities, to say what is missing.
  let best = null;
  for (const city of cities) {
    for (const id of MAP.cityRoutes[city]) {
      if (state.map.routeOwner[id] !== null) continue;
      const route = MAP.routeById[id];
      const short = routeShortfall(player, route);
      const score = route.length;
      if (best === null || score < best.score) best = { route, short, score };
    }
  }
  let claim;
  if (best === null) {
    claim = `every route at ${listWithOr(where)} is already claimed`;
  } else {
    const s = best.short;
    claim = `the shortest unclaimed route there is ${routeName(best.route)}, which needs ${formatRouteCost(state, best.route)} in built tiles, and you hold ${s.have} of the ${s.need} built ${K.NAMES[s.terrain]} you need`;
  }
  const move = network
    ? 'and there is no Move Train in network mode'
    : 'and no claimed route touches your railheads, so there is nothing to move along';
  return `Lay Tracks / Move Train needs a legal claim or move, and you have neither: ${network ? 'your network is' : 'your railheads stand on'} ${listWithOr(where)}; ${claim}; ${move}.`;
}

/**
 * R4.6. Why the action of a district cannot be chosen by this player right
 * now, whatever worker gives access to it; null when it can.
 */
export function getDistrictActionBlockReason(state, playerId, district) {
  if (!isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  const info = districtInfo(state, district);
  const rule = DISTRICT_ACTION_RULES[info.family];
  if (!rule) return `${info.name} cannot be chosen yet: its action is not implemented in this build.`;
  return rule(state, playerId, district);
}

function choosableAmong(state, playerId, districts) {
  return districts.filter((d) => getDistrictActionBlockReason(state, playerId, d) === null);
}

// ---------------------------------------------------------------------------
// Setup (R3.5 to R3.7)
// ---------------------------------------------------------------------------

/** R3.5. Why this player cannot put a railhead on `city` in the draft. */
export function getPlaceRailheadBlockReason(state, playerId, city) {
  const c = MAP.cityById[city];
  if (!c) return `"${city}" is not a city on the map.`;
  if (c.kind === 'inland') {
    return `${c.name} is an inland city: railheads start on one of the ${MAP.startCities.length} start cities.`;
  }
  const player = state.players[playerId];
  if (player.railheads.every((at) => at !== null)) {
    return `You have already placed both of your railheads.`;
  }
  // R3.5.3 - a start city holds at most one railhead during the draft.
  for (const other of state.players) {
    if (other.railheads.includes(city)) {
      return other.id === playerId
        ? `${c.name} already holds your first railhead.`
        : `${c.name} already holds ${other.name}'s railhead.`;
    }
  }
  // R3.5.2 - the second railhead goes on the opposite side from the first.
  const first = player.railheads[0];
  if (first !== null && startSide(first) === c.kind) {
    const sameSide = c.kind === 'west' ? 'a west' : 'an east';
    const otherSide = c.kind === 'west' ? 'an east' : 'a west';
    return `Your first railhead is on ${MAP.cityById[first].name}, ${sameSide} start city, so your second must start on ${otherSide} start city, not ${c.name}.`;
  }
  return timingBlock(state, playerId, isKind('setupRailhead'));
}

/** R3.4, R3.6(a). Why this player cannot leave the "2" slot of `track` empty. */
export function getStartingProductionBlockReason(state, playerId, track) {
  const K = getConstants(state);
  if (!K.PLAYER_BOARD.houseTracks.includes(track)) {
    return `"${track}" is not a house track. The tracks are ${K.PLAYER_BOARD.houseTracks.join(', ')}.`;
  }
  return timingBlock(state, playerId, isKind('setupProduction'));
}

/** R3.6(b). Why this player cannot take `specialist` as their free starting specialist. */
export function getStartingSpecialistBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  if (state.supply.specialists[specialist] <= 0) {
    return `No ${K.NAMES[specialist]} tiles are left in the supply (all ${K.TRAIN.specialistsPerType} are in trains).`;
  }
  return timingBlock(state, playerId, isKind('setupSpecialist'));
}

// ---------------------------------------------------------------------------
// Choices that any player may be asked for, on anybody's turn
// ---------------------------------------------------------------------------

/** R1.8. Why this player cannot take 1 `resource` of their choice now. */
export function getChooseResourceBlockReason(state, playerId, resource) {
  const K = getConstants(state);
  if (resource === 'coins') return 'Coins are not a resource: choose Iron, Wood or Gunpowder.';
  if (!K.RESOURCES.includes(resource)) return `"${resource}" is not a resource: choose Iron, Wood or Gunpowder.`;
  return timingBlock(
    state,
    playerId,
    isKind('chooseResource'),
    'You are not owed a resource of your choice at the moment.',
  );
}

/** R8.5.4, R8.5.5. Why this player cannot discard 1 `item` (a resource or a built tile type) now. */
export function getDiscardBlockReason(state, playerId, item) {
  const K = getConstants(state);
  if (!K.STORAGE_ITEMS.includes(item)) return `"${item}" is not something held in storage.`;
  const player = state.players[playerId];
  const used = storageUsed(player);
  const capacity = storageCapacity(state, playerId);
  // R8.5.5 - a player may not discard at any other time.
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
// The worker step (R4.2 step 2, R5.3 to R5.5)
// ---------------------------------------------------------------------------

function noWorkerInSupply(state, playerId) {
  const K = getConstants(state);
  const total = K.SETUP.workersByPlayerCount[state.players.length];
  return `You have no worker in your supply: all ${total} of your workers are on the action grid, so you must remove one.`;
}

const WORKER_STEP_OTHERWISE = 'You take your worker step once per turn, before choosing a district.';

/** R5.3. Why this player cannot place a worker on the worker space `space`. */
export function getPlaceWorkerBlockReason(state, playerId, space) {
  if (!isSpaceId(space)) return `"${space}" is not a worker space of the action grid.`;
  const player = state.players[playerId];
  if (player.workersInSupply <= 0) return noWorkerInSupply(state, playerId);
  const owner = state.grid.spaces[space];
  if (owner !== null) return `${space} already holds ${workerOf(state, playerId, owner)}.`;
  // R4.6 - the worker must give access to at least one action that can be taken.
  const districts = SPACE_DISTRICTS[space];
  if (choosableAmong(state, playerId, districts).length === 0) {
    const names = districts.map((d) => districtName(state, d));
    return `${space} lies between ${names[0]} and ${names[1]}, and you cannot take either action right now.`;
  }
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

/** R5.5.1. Why this player cannot displace by placing a worker on the centre of `district`. */
export function getDisplaceWorkerBlockReason(state, playerId, district) {
  if (!isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  const player = state.players[playerId];
  const grid = state.grid;
  const dName = districtName(state, district);
  if (player.workersInSupply <= 0) return noWorkerInSupply(state, playerId);
  // R5.5.1, first condition: every worker space of the district is occupied.
  const spaces = DISTRICT_SPACES[district];
  const empty = spaces.filter((w) => grid.spaces[w] === null);
  if (empty.length > 0) {
    return `${dName} is not blocked: ${empty.length} of its ${spaces.length} worker spaces ${empty.length === 1 ? 'is' : 'are'} empty (${empty.join(', ')}), so place a worker there.`;
  }
  // Second: none of the workers on those spaces is yours.
  const own = spaces.filter((w) => grid.spaces[w] === playerId);
  if (own.length > 0) {
    return `You have a worker on ${own[0]}, a worker space of ${dName}, so you cannot displace there.`;
  }
  // Third: you have no worker adjacent to the district (R5.6.2).
  if (grid.centres[district] === playerId) {
    return `Your own worker is already on the centre of ${dName}.`;
  }
  for (const d of DISTRICT_NEIGHBOURS[district]) {
    if (grid.centres[d] === playerId) {
      return `Your worker on the centre of ${districtName(state, d)} is adjacent to ${dName}, so you cannot displace there.`;
    }
  }
  // Fourth: the centre is empty.
  if (grid.centres[district] !== null) {
    return `The centre of ${dName} already holds ${workerOf(state, playerId, grid.centres[district])}.`;
  }
  // R5.5.4 with R4.6 - you then take the district's action, so it must be one you can take.
  const action = getDistrictActionBlockReason(state, playerId, district);
  if (action !== null) return action;
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

/** R5.4. Why this player cannot remove their worker from `from` (a worker space id or, for a centre, a district id). */
export function getRemoveWorkerBlockReason(state, playerId, from) {
  const onSpace = isSpaceId(from);
  const onCentre = isDistrictId(from);
  if (!onSpace && !onCentre) return `"${from}" is neither a worker space nor a district.`;
  // R4.8.1 - with rounds the worker step is Place or Displace only.
  if (state.variants.turnStructure === 'rounds') {
    return 'With rounds you cannot remove a worker: place or displace one, and every worker comes back when the round ends.';
  }
  const grid = state.grid;
  const there = onSpace ? grid.spaces[from] : grid.centres[from];
  if (there !== playerId) {
    return onSpace ? `You have no worker on ${from}.` : `You have no worker on the centre of ${districtName(state, from)}.`;
  }
  if (onSpace) {
    // R5.4.1 - a worker on a district centre must be removed first.
    if (hasCentreWorker(state, playerId)) {
      const centres = workersOnGrid(state, playerId).centres.map((d) => districtName(state, d));
      return `You have a worker on the centre of ${listWithOr(centres)}; when you remove a worker it must be ${centres.length === 1 ? 'that one' : 'one of those'}.`;
    }
    // R5.4.2 with R4.6 - the removed worker must give access to an action that can be taken.
    const districts = SPACE_DISTRICTS[from];
    if (choosableAmong(state, playerId, districts).length === 0) {
      const names = districts.map((d) => districtName(state, d));
      return `${from} lies between ${names[0]} and ${names[1]}, and you cannot take either action right now.`;
    }
  }
  // A centre worker can always be removed: it gives its district's action
  // (R5.4.3) or, if that cannot be chosen, no action at all (R5.4.4).
  return timingBlock(state, playerId, isKind('workerStep'), WORKER_STEP_OTHERWISE);
}

// ---------------------------------------------------------------------------
// Choosing the district and the cowboy hat (R4.2 step 3, R4.6, R14.2)
// ---------------------------------------------------------------------------

/** R14.2. Why this player cannot spend a cowboy hat on this turn's district action. */
export function getSpendHatBlockReason(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const turn = state.turn;
  if (turn.player !== playerId) return 'A cowboy hat can be spent only on your own turn, when you choose your district.';
  if (player.hats <= 0) return 'You have no cowboy hat to spend.';
  if (turn.hatSpent || K.HATS.hatsPerTurn < 1) {
    return `You have already spent a cowboy hat this turn (at most ${K.HATS.hatsPerTurn} per turn).`;
  }
  if (turn.hatsAtStart <= 0) {
    return `You held 0 cowboy hats when this turn began, and a hat gained during a turn cannot be spent in that turn.`;
  }
  return null;
}

/**
 * R4.2 step 3. Why this player cannot choose `district` (a district id, or
 * 'none' for the one case of R5.4.4), spending a cowboy hat if `hat` is true.
 */
export function getChooseDistrictBlockReason(state, playerId, district, hat) {
  if (district !== 'none' && !isDistrictId(district)) return `"${district}" is not a district of the action grid.`;
  if (typeof hat !== 'boolean') return 'Say whether you spend a cowboy hat: `hat` must be true or false.';
  // Which districts are on offer depends on this turn's worker, so here the
  // timing check has to come first.
  const timing = timingBlock(
    state,
    playerId,
    isKind('chooseDistrict'),
    'You choose a district right after your worker step, once per turn.',
  );
  if (timing !== null) return timing;
  if (state.turn.player !== playerId || state.turn.worker === null) {
    return 'You choose a district right after your worker step, once per turn.';
  }

  const worker = state.turn.worker;
  const access = accessDistricts(state);
  const fromCentre = isDistrictId(worker.at);
  if (district === 'none') {
    // R5.4.4 - only for a worker removed from the centre of a district whose action cannot be chosen.
    const forced = worker.via === 'remove' && fromCentre && getDistrictActionBlockReason(state, playerId, worker.at) !== null;
    if (!forced) {
      return `You must take a district action: taking none is allowed only when the worker you had to remove stood on the centre of a district whose action you cannot take.`;
    }
    if (hat) return 'No district action is taken this turn, so there is nothing to spend a cowboy hat on.';
    return null;
  }
  if (!access.includes(district)) {
    const names = access.map((d) => districtName(state, d));
    const where = fromCentre ? `the centre of ${districtName(state, worker.at)}` : worker.at;
    return `Your worker ${worker.via === 'remove' ? 'came from' : 'is on'} ${where}, which gives ${listWithOr(names)}, not ${districtName(state, district)}.`;
  }
  const action = getDistrictActionBlockReason(state, playerId, district);
  if (action !== null) return action;
  if (hat) return getSpendHatBlockReason(state, playerId);
  return null;
}

// ---------------------------------------------------------------------------
// The bonus actions (R6.6, R7)
// ---------------------------------------------------------------------------

/**
 * The action type that carries out each implemented bonus action (R7.3 to
 * R7.6). A bonus action that is in play (`bonusActionsInPlay`) but not listed
 * here is not offered.
 */
export const BONUS_ACTION_TYPES = {
  upgrade: 'installUpgrade',
  hat: 'buyHat',
  carriage: 'addCarriage',
  hire: 'hireSpecialist',
};

/** Whether a bonus action exists in this game and is implemented. */
export function isBonusActionAvailable(state, bonus) {
  if (!Object.prototype.hasOwnProperty.call(BONUS_ACTION_TYPES, bonus)) return false;
  return bonusActionsInPlay(getConstants(state), state.variants).includes(bonus);
}

// True only inside the functions that ask "could this bonus action be taken
// on the terms of Pony Express card 28?" before any such decision is pending.
let assumeFreeBonus = false;

/**
 * The terms a bonus action is taken on right now: `free` is true while the
 * player is in the `bonusAction` decision of Pony Express card 28 (R18.7: any
 * of the four, at no printed cost, outside the limit of R7.2).
 */
function bonusIsFree(state, playerId) {
  if (assumeFreeBonus) return true;
  const top = topFrame(state);
  return top !== null && top.kind === 'bonusAction' && top.player === playerId && top.free === true;
}

/** R7.2. The limit on how often a bonus action may be taken, as a block reason or null. */
function bonusLimitBlock(state, playerId, bonus) {
  const K = getConstants(state);
  if (bonusIsFree(state, playerId)) return null; // R18.7 card 28: does not count towards bonusActionLimit
  if (state.variants.bonusActionLimit === 'once-per-game' && state.players[playerId].bonusActionsUsed[bonus]) {
    return `You have already taken ${K.BONUS_ACTIONS[bonus].name} this game, and in this variant each bonus action can be taken once per game.`;
  }
  return null;
}

/** R7.1. A bonus action is the last part of a Gather action at the district that prints it (or the free choice of card 28). */
function bonusTimingBlock(state, playerId, bonus) {
  const K = getConstants(state);
  return timingBlock(
    state,
    playerId,
    (frame) => frame.kind === 'bonusAction' && (frame.bonus === bonus || frame.bonus === 'any'),
    `${K.BONUS_ACTIONS[bonus].name} can be taken only as the last part of a Gather action at the district that prints it.`,
  );
}

/** The printed cost of a bonus action, or nothing when it is free (card 28). */
function bonusCost(state, playerId, bonus) {
  return bonusIsFree(state, playerId) ? {} : getConstants(state).BONUS_ACTIONS[bonus].cost;
}

function shortfallSentence(state, what, cost, shortfall) {
  const K = getConstants(state);
  return `${what} costs ${formatCost(state, cost)} and you have ${formatAmount(K, shortfall.key, shortfall.have)}.`;
}

/** R7.5. Why this player cannot take the Buy Hat bonus action. */
export function getBuyHatBlockReason(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const limit = bonusLimitBlock(state, playerId, 'hat');
  if (limit !== null) return limit;
  const cost = bonusCost(state, playerId, 'hat');
  const short = firstShortfall(player, cost);
  if (short !== null) return shortfallSentence(state, K.BONUS_ACTIONS.hat.name, cost, short);
  if (player.hats >= K.HATS.hatLimit) {
    return `You already hold ${plural(player.hats, 'cowboy hat', 'cowboy hats')}, the limit, so you cannot buy another.`;
  }
  return bonusTimingBlock(state, playerId, 'hat');
}

/** R7.6, R8.7. Why this player cannot add a carriage of kind `carriage` ('specialist' or 'storage'). */
export function getAddCarriageBlockReason(state, playerId, carriage) {
  const K = getConstants(state);
  if (carriage !== 'specialist' && carriage !== 'storage') {
    return `"${carriage}" is not a kind of carriage: choose specialist or storage.`;
  }
  const player = state.players[playerId];
  // R8.7 - the same action serves the bonus action (paid) and a free carriage
  // (Congress entry C4, cards): a pending `addCarriage` frame means free.
  const top = topFrame(state);
  // A pending `addCarriage` decision (Congress C4, a card) is free; so is the choice of card 28.
  const freeFrame = top !== null && top.kind === 'addCarriage' && top.player === playerId;
  const free = freeFrame || bonusIsFree(state, playerId);
  if (!free) {
    const limit = bonusLimitBlock(state, playerId, 'carriage');
    if (limit !== null) return limit;
    const cost = bonusCost(state, playerId, 'carriage');
    const short = firstShortfall(player, cost);
    if (short !== null) return shortfallSentence(state, K.BONUS_ACTIONS.carriage.name, cost, short);
  }
  const have = carriage === 'specialist' ? player.train.specialistCarriages.length : player.train.storageCarriages;
  const max = carriage === 'specialist' ? K.TRAIN.maxSpecialistCarriages : K.TRAIN.maxStorageCarriages;
  if (have >= max) {
    return `You already have ${have} ${carriage} carriages, the most a train can have.`;
  }
  if (freeFrame) return timingBlock(state, playerId, isKind('addCarriage'));
  return bonusTimingBlock(state, playerId, 'carriage');
}

/**
 * R7.4, R8.6, R8.6.4. Why this player cannot hire a `specialist`: with the
 * Hire Specialist bonus action, in a `hireSpecialist` decision of a card
 * (free, or the hire cost without the fee, per the frame) or on the terms of
 * card 28 (the hire cost without the fee).
 */
export function getHireSpecialistBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  const player = state.players[playerId];
  const frame = ownFrame(state, playerId, 'hireSpecialist');
  const mode = frame !== null ? (frame.free ? 'free' : 'table') : bonusIsFree(state, playerId) ? 'table' : 'bonusAction';
  if (mode === 'bonusAction') {
    const limit = bonusLimitBlock(state, playerId, 'hire');
    if (limit !== null) return limit;
  }
  // R8.6.1 - the lowest-level carriage with an empty slot; no slot, no hire.
  const where = nextSpecialistSlot(player);
  if (where === null) {
    const use = specialistSlotUse(player);
    return `Every specialist slot in your train is full (${use.filled} of ${use.total}): add a specialist carriage before you hire.`;
  }
  // R8.6.2 - the type must still be in the supply.
  if (state.supply.specialists[specialist] <= 0) {
    return `No ${K.NAMES[specialist]} tiles are left in the supply (all ${K.TRAIN.specialistsPerType} are in trains).`;
  }
  // R7.4 and R8.6.3 - the fee and the hire cost, as the variant `hireCostModel` says; R8.6.4 - free.
  const price = hireCost(state, playerId, specialist, mode);
  const short = firstShortfall(player, price.cost);
  if (short !== null) {
    return shortfallSentence(state, `Hiring a ${K.NAMES[specialist]} into your level ${price.level} carriage`, price.cost, short);
  }
  if (frame !== null) return timingBlock(state, playerId, isKind('hireSpecialist'));
  return bonusTimingBlock(state, playerId, 'hire');
}

/** R7.1. Why this player cannot decline the bonus action (they can, whenever one is on offer). */
export function getSkipBonusActionBlockReason(state, playerId) {
  // Card 28 is used by choosing the bonus action: once the player has committed, only a bonus action follows.
  if (bonusIsFree(state, playerId) && !assumeFreeBonus) {
    return 'You have used Frontier Mastery: take one of the bonus actions on offer.';
  }
  return timingBlock(state, playerId, isKind('bonusAction'), 'No bonus action is on offer to decline.');
}

/**
 * R7.3, R15.3. Why this player cannot install upgrade tile `tile` in their
 * specialist carriage of level `level`. The bonus action costs 1 Iron and
 * counts towards R7.2 (neither on the terms of card 28).
 */
export function getInstallUpgradeBlockReason(state, playerId, tile, level) {
  const K = getConstants(state);
  const m = state.modules.upgrades;
  if (m === undefined) return 'Carriage upgrades are not in play in this game.';
  const data = typeof tile === 'string' ? upgradeTileData(state, tile) : undefined;
  if (data === undefined) return `"${tile}" is not one of the upgrade tiles.`;
  if (!Number.isInteger(level) || level < 1 || level > K.TRAIN.maxSpecialistCarriages) {
    return `A carriage level is a whole number from 1 to ${K.TRAIN.maxSpecialistCarriages}, not "${level}".`;
  }
  const player = state.players[playerId];
  // R7.2, R7.3 - the limit and the cost of the bonus action come first.
  const limit = bonusLimitBlock(state, playerId, 'upgrade');
  if (limit !== null) return limit;
  const cost = bonusCost(state, playerId, 'upgrade');
  const short = firstShortfall(player, cost);
  if (short !== null) return shortfallSentence(state, K.BONUS_ACTIONS.upgrade.name, cost, short);
  // R15.3.4 - the tile is still in the display.
  if (!m.display.includes(tile)) {
    return `${data.name} (${tile}) has already been taken from the display: tiles are first come, first served and are not refilled.`;
  }
  // R15.3 - the carriage must exist, hold a specialist, have its upgrade slot empty, and be of at least the tile's level.
  const carriages = player.train.specialistCarriages;
  if (level > carriages.length) {
    return `You have ${plural(carriages.length, 'specialist carriage', 'specialist carriages')}, so there is no level ${level} carriage to install a tile in.`;
  }
  const carriage = carriages[level - 1];
  if (!carriage.slots.some((s) => s !== null)) {
    return `Your level ${level} carriage holds no specialist, and a tile can be installed only in a carriage with at least one.`;
  }
  const there = m.installed[playerId][level - 1];
  if (there !== null) {
    return `Your level ${level} carriage already carries ${upgradeTileData(state, there).name} (${there}); an installed tile is never replaced.`;
  }
  if (data.level > level) {
    return `${data.name} is a level ${data.level} tile and fits only a level ${data.level} carriage or higher; this carriage is level ${level}.`;
  }
  return bonusTimingBlock(state, playerId, 'upgrade');
}

// ---------------------------------------------------------------------------
// Train activation (R9) and Lobby Congress (R10)
// ---------------------------------------------------------------------------

/** The pending decision, if it is a `kind` frame asked of this player. */
function ownFrame(state, playerId, kind) {
  const top = topFrame(state);
  return top !== null && top.kind === kind && top.player === playerId ? top : null;
}

/** The three step types that produce a built tile (R8.8). A Financier step has no choice (R9.4.3). */
const PRODUCING_STEPS = ['crew', 'miner', 'engineer'];

/**
 * R9.4.3. The Crew, Miner or Engineer step an activation frame is waiting on
 * (use or skip), or null when the frame is between steps or asking about Congress.
 */
export function waitingStep(frame) {
  if (frame.congress || frame.index >= frame.steps.length) return null;
  const step = frame.steps[frame.index];
  return PRODUCING_STEPS.includes(step.type) ? step : null;
}

/** "Foreman (acting as a Crew)" or "level 2 Engineer": a step of a train activation, for sentences. */
export function describeStep(state, step) {
  const K = getConstants(state);
  if (step.type === 'upgrade') return `level ${step.level} upgrade tile`;
  if (step.level === 0) return `Foreman (acting as ${/^[aeiou]/i.test(K.NAMES[step.type]) ? 'an' : 'a'} ${K.NAMES[step.type]})`;
  return `level ${step.level} ${K.NAMES[step.type]}`;
}

/** R9.4.3, R8.8. Why this player cannot use the Crew, Miner or Engineer step they are on. */
export function getUseStepBlockReason(state, playerId) {
  const K = getConstants(state);
  const frame = ownFrame(state, playerId, 'trainActivation');
  const step = frame === null ? null : waitingStep(frame);
  if (step !== null) {
    const recipe = K.TRAIN.recipes[state.variants.conversionRate][step.type];
    const short = firstShortfall(state.players[playerId], recipe.cost);
    if (short !== null) {
      return `Your ${describeStep(state, step)} makes 1 built ${K.NAMES[recipe.output]} tile for ${formatCost(state, recipe.cost)}, and you have ${formatAmount(K, short.key, short.have)}.`;
    }
  }
  return timingBlock(
    state,
    playerId,
    (f) => f.kind === 'trainActivation' && waitingStep(f) !== null,
    'You can use or skip a Crew, Miner or Engineer step only while you are in a train activation.',
  );
}

/** R9.4.3. Why this player cannot skip the Crew, Miner or Engineer step they are on. */
export function getSkipStepBlockReason(state, playerId) {
  return timingBlock(
    state,
    playerId,
    (f) => f.kind === 'trainActivation' && waitingStep(f) !== null,
    'You can use or skip a Crew, Miner or Engineer step only while you are in a train activation.',
  );
}

/** R10.1. The Congress table in play. */
export function congressTable(state) {
  return getConstants(state).CONGRESS.tables[state.variants.congressTable];
}

/**
 * R10.4.2. Coins an entry costs this player. Pony Express card 37
 * (`congressCoinCost`: tier 1 entries cost 0) and card 20
 * (`congressCoinDiscount`: the first entry of an activation costs 1 less, not
 * below 0) apply here (R18.7). The discount reads the activation being asked
 * (`frame.entries` counts the entries already taken in it).
 */
export function congressCoinCost(state, playerId, entry) {
  let cost = entry.coinCost;
  const control = ponyModifier(state, playerId, 'congressCoinCost');
  if (control !== null && entry.tier === control.tier) cost = control.value;
  const discount = ponyModifier(state, playerId, 'congressCoinDiscount');
  if (discount !== null) {
    const frame = ownFrame(state, playerId, 'trainActivation');
    if (frame !== null && frame.entries === 0) cost = Math.max(0, cost - discount.amount);
  }
  return cost;
}

/** R10.6. Whether any senator is on a benefit tile (so Reset has something to return). */
export function anySenatorUsed(state) {
  for (const id in state.congress.used) if (state.congress.used[id]) return true;
  return false;
}

/**
 * R10.5. A sentence if the entry's benefit could not be carried out at all
 * (the entry then cannot be taken), else null. C6 can always be taken for its 3 VP.
 */
function congressBenefitBlock(state, playerId, entry) {
  const K = getConstants(state);
  const player = state.players[playerId];
  for (const effect of entry.effects) {
    if (effect.type === 'addCarriage' && effect.carriage === 'choice') {
      const s = player.train.specialistCarriages.length;
      const t = player.train.storageCarriages;
      if (s >= K.TRAIN.maxSpecialistCarriages && t >= K.TRAIN.maxStorageCarriages) {
        return `${entry.id} adds a carriage, and your train already has the most it can: ${s} specialist carriages and ${t} storage carriages.`;
      }
    }
  }
  return null;
}

/** R10.4 to R10.6. Why this player cannot take Congress entry `entryId` now. */
export function getTakeCongressEntryBlockReason(state, playerId, entryId) {
  const table = congressTable(state);
  const entry = table.find((e) => e.id === entryId);
  if (!entry) return `"${entryId}" is not an entry of the Congress strip in play (${table.map((e) => e.id).join(', ')}).`;
  // R10.2 - a used entry stays used until a Reset.
  if (entry.reset) {
    if (!anySenatorUsed(state)) return 'Reset has nothing to return: no senator has been used yet.';
  } else if (state.congress.used[entry.id]) {
    return `Entry ${entry.id} is used: its senator is on the benefit tile and stays there until somebody takes Reset.`;
  }
  // A free entry (Pony Express cards 13 and 24, Legislative Agenda card 20, R17.3, R18.7):
  // no lobby points and no Coins, but the tier is fixed and the entry just taken is excluded.
  const freeFrame = ownFrame(state, playerId, 'freeCongress');
  if (freeFrame !== null) {
    if (entry.tier !== freeFrame.tier) {
      return `Entry ${entry.id} is tier ${entry.tier}; this free entry must be tier ${freeFrame.tier}.`;
    }
    if (freeFrame.exclude === entry.id) {
      return `Entry ${entry.id} is the one you have just taken: take a different tier ${freeFrame.tier} entry.`;
    }
    const benefit = congressBenefitBlock(state, playerId, entry);
    if (benefit !== null) return benefit;
    return timingBlock(state, playerId, isKind('freeCongress'));
  }
  // R10.4.1 - lobby points equal to the tier. The count lives in the pending
  // activation; with none pending (getStructuralBlockReason) only timing is left to say.
  const frame = ownFrame(state, playerId, 'trainActivation');
  if (frame !== null && frame.lobby < entry.tier) {
    return `Entry ${entry.id} is tier ${entry.tier}, which takes ${plural(entry.tier, 'lobby point', 'lobby points')}, and you hold ${frame.lobby}.`;
  }
  // R10.4.2 - Coins equal to the coin cost.
  const player = state.players[playerId];
  const coins = congressCoinCost(state, playerId, entry);
  if (player.coins < coins) {
    return `Entry ${entry.id} costs ${plural(coins, 'Coin', 'Coins')} and you have ${player.coins}.`;
  }
  // R10.5 - a benefit that cannot be carried out at all.
  const benefit = congressBenefitBlock(state, playerId, entry);
  if (benefit !== null) return benefit;
  return timingBlock(
    state,
    playerId,
    (f) => f.kind === 'trainActivation' && f.congress,
    'You can take a Congress entry only during a train activation, after a step, while you hold lobby points.',
  );
}

/** R9.4.3. Why this player cannot stop taking Congress entries for now. */
export function getCloseCongressBlockReason(state, playerId) {
  return timingBlock(
    state,
    playerId,
    (f) => f.kind === 'trainActivation' && f.congress,
    'There are no Congress entries on offer to leave.',
  );
}

/** R10.7. Why this player cannot gain a built tile of `terrain` now (Congress C5 and the like). */
export function getChooseBuiltTileBlockReason(state, playerId, terrain) {
  const K = getConstants(state);
  if (!K.TERRAINS.includes(terrain)) return `"${terrain}" is not a kind of track tile: choose Ground, Tunnel or Bridge.`;
  // R18.7 card 4: two tiles of two DIFFERENT types.
  const frame = ownFrame(state, playerId, 'chooseBuiltTile');
  if (frame !== null && frame.distinct && frame.taken.includes(terrain)) {
    return `This card gives built tiles of different types, and you already took ${K.NAMES[terrain]}: choose another type.`;
  }
  return timingBlock(
    state,
    playerId,
    isKind('chooseBuiltTile'),
    'You are not owed a built track tile of your choice at the moment.',
  );
}

/**
 * R10.1 C6. Whether one option of a `chooseOption` decision can be carried
 * out: a building option needs somewhere to put a building (R10.5).
 */
function optionBlock(state, playerId, frame, index) {
  const effects = frame.options[index].effects;
  for (const effect of effects) {
    if (effect.type === 'placeBuildings') {
      const ctx = { scope: 'connected', city: null, cost: {}, left: effect.railwayStation + effect.telegraphStation, allow: { railwayStation: effect.railwayStation, telegraphStation: effect.telegraphStation } };
      if (!canPlaceAnyBuilding(state, playerId, ctx)) {
        return 'You cannot place a building anywhere: no connected inland city has room for one you can place. Take the other option.';
      }
    }
  }
  return null;
}

/** R10.1 C6. Why this player cannot pick option number `option` (from 0) now. */
export function getChooseOptionBlockReason(state, playerId, option) {
  if (!Number.isInteger(option) || option < 0) return `"${option}" is not an option number: options count from 0.`;
  const frame = ownFrame(state, playerId, 'chooseOption');
  if (frame !== null) {
    if (option >= frame.options.length) {
      return `There are only ${frame.options.length} options to choose from, numbered 0 to ${frame.options.length - 1}.`;
    }
    const block = optionBlock(state, playerId, frame, option);
    if (block !== null) return block;
  }
  return timingBlock(state, playerId, isKind('chooseOption'), 'You are not being offered a choice between options at the moment.');
}

// ---------------------------------------------------------------------------
// Lay Tracks / Move Train (R11, R12)
// ---------------------------------------------------------------------------

function cityNameOf(city) {
  return MAP.cityById[city] ? MAP.cityById[city].name : String(city);
}

/**
 * R11.3. The railhead a step would use, or -1 if the action allows no such
 * step: the index in `player.railheads`. With `per-step` (and in network
 * mode) any railhead on `city` will do while steps remain; with
 * `per-railhead` the railhead needs claims left, and if both stand on
 * `city` the one with more claims left is used.
 */
export function claimRailheadIndex(state, frame, city) {
  const heads = state.players[frame.player].railheads;
  if (frame.steps !== undefined) {
    if (frame.steps <= 0) return -1;
    if (state.variants.claimFrom === 'network') return 0;
    return heads.indexOf(city);
  }
  let best = -1;
  for (let i = 0; i < heads.length; i++) {
    if (heads[i] === city && frame.claimsLeft[i] > 0 && (best === -1 || frame.claimsLeft[i] > frame.claimsLeft[best])) best = i;
  }
  return best;
}

/** R11.3. The railhead a move would use, or -1 if the action allows no more moves. */
export function moveRailheadIndex(state, frame, city) {
  if (frame.steps !== undefined) {
    if (frame.steps <= 0) return -1;
  } else if (frame.movesLeft <= 0) {
    return -1;
  }
  return state.players[frame.player].railheads.indexOf(city);
}

/** R11.4, R11.11.3, R11.6. Why this player cannot claim route `routeId`, standing on / working from `from`. */
export function getClaimRouteBlockReason(state, playerId, routeId, from) {
  const route = MAP.routeById[routeId];
  if (!route) return `"${routeId}" is not a route of the map.`;
  if (!MAP.cityById[from]) return `"${from}" is not a city on the map.`;
  if (route.a !== from && route.b !== from) {
    return `${routeName(route)} does not touch ${cityNameOf(from)}.`;
  }
  const player = state.players[playerId];
  const owner = state.map.routeOwner[routeId];
  // R11.4.1 - the route is unclaimed (R11.6: routes are exclusive).
  if (owner !== null) {
    return owner === playerId
      ? `You have already claimed ${routeName(route)}.`
      : `${routeName(route)} is already claimed by ${nameOf(state, owner)}, and routes are exclusive.`;
  }
  const network = state.variants.claimFrom === 'network';
  if (network) {
    // R11.11.3 - at least one end is in the player's network.
    const net = networkCities(state, playerId);
    if (!net.includes(route.a) && !net.includes(route.b)) {
      return `Neither end of ${routeName(route)} is in your network (${net.map(cityNameOf).join(', ')}).`;
    }
    if (!net.includes(from)) return `${cityNameOf(from)} is not in your network, so you cannot claim from there.`;
    if (net.includes(route.a) && net.includes(route.b) && from !== route.a) {
      return `Both ends of ${routeName(route)} are already in your network, so name the claim from ${cityNameOf(route.a)}, the route's first end.`;
    }
  } else if (!player.railheads.includes(from)) {
    // R11.4.2 - one of the player's railheads stands on an end of the route.
    const heads = [...new Set(player.railheads)].filter((c) => c !== null).map(cityNameOf);
    return `None of your railheads stands on ${cityNameOf(from)}: yours ${heads.length === 1 ? 'stands' : 'stand'} on ${listWithOr(heads)}.`;
  }
  // R11.4.3 - a built tile of the right terrain for every slot.
  const short = routeShortfall(player, route);
  if (short !== null) {
    const K = getConstants(state);
    return `${routeName(route)} needs ${formatRouteCost(state, route)} in built tiles, and you hold ${short.have} of the ${short.need} built ${K.NAMES[short.terrain]} you need.`;
  }
  const frame = ownFrame(state, playerId, 'layTracks');
  if (frame !== null && frame.only === 'move') return 'This step is a Move Train step (a card gives you only moves): you cannot claim a route with it.';
  if (frame !== null && claimRailheadIndex(state, frame, from) < 0) {
    return frame.steps !== undefined
      ? 'You have used every step of this Lay Tracks / Move Train action.'
      : `The railhead on ${cityNameOf(from)} has no claims left in this action.`;
  }
  return timingBlock(
    state,
    playerId,
    isKind('layTracks'),
    'You can claim a route only as a step of the Lay Tracks / Move Train action.',
  );
}

/** R12.2, R12.6. Why this player cannot move their railhead from `from` to `to`. */
export function getMoveTrainBlockReason(state, playerId, from, to) {
  if (!MAP.cityById[from]) return `"${from}" is not a city on the map.`;
  if (!MAP.cityById[to]) return `"${to}" is not a city on the map.`;
  if (state.variants.claimFrom === 'network') {
    return 'There is no Move Train in network mode: railheads never move.';
  }
  const player = state.players[playerId];
  if (!player.railheads.includes(from)) {
    const heads = [...new Set(player.railheads)].filter((c) => c !== null).map(cityNameOf);
    return `None of your railheads stands on ${cityNameOf(from)}: yours ${heads.length === 1 ? 'stands' : 'stand'} on ${listWithOr(heads)}.`;
  }
  if (from === to) return `Your railhead is already on ${cityNameOf(to)}: choose a different destination.`;
  if (!touchesClaimedRoute(state, from)) {
    return `No claimed route touches ${cityNameOf(from)}, so a railhead there cannot move.`;
  }
  if (!reachableCities(state, from).includes(to)) {
    return `No chain of claimed routes joins ${cityNameOf(from)} to ${cityNameOf(to)}.`;
  }
  const frame = ownFrame(state, playerId, 'layTracks');
  if (frame !== null && frame.only === 'claim') return 'This step is a claim (a card gives you only a claim): you cannot move your train with it.';
  if (frame !== null && moveRailheadIndex(state, frame, from) < 0) {
    return frame.steps !== undefined
      ? 'You have used every step of this Lay Tracks / Move Train action.'
      : 'You have used every move of this Lay Tracks / Move Train action.';
  }
  return timingBlock(
    state,
    playerId,
    isKind('layTracks'),
    'You can move your train only as a step of the Lay Tracks / Move Train action.',
  );
}

/** R11.3. Why this player cannot end the Lay Tracks / Move Train action now. */
export function getStopLayingBlockReason(state, playerId) {
  const frame = ownFrame(state, playerId, 'layTracks');
  if (frame !== null && frame.taken < 1) {
    return 'You must take at least one step, a claim or a move, before you stop.';
  }
  return timingBlock(state, playerId, isKind('layTracks'), 'You are not in a Lay Tracks / Move Train action.');
}

// ---------------------------------------------------------------------------
// Buildings (R13)
// ---------------------------------------------------------------------------

/**
 * Where, how many and at what price buildings may be placed right now:
 *   { scope: 'city' | 'connected' | 'network', city, cost, left, allow: { railwayStation, telegraphStation } }
 * from the pending `placeBuildings` decision (free building on arrival R13.4,
 * paid building after a move R13.5, Congress C6 R13.6), or from a Lay Tracks
 * action in network mode (the station step, R11.11.5). Null when no such
 * decision is pending.
 */
export function placementContext(state, playerId) {
  const top = topFrame(state);
  if (top === null || top.player !== playerId) return null;
  if (top.kind === 'placeBuildings') {
    return { scope: top.scope, city: top.city, cost: top.cost, left: top.left, allow: top.allow };
  }
  if (top.kind === 'layTracks' && state.variants.claimFrom === 'network' && !top.only) {
    return {
      scope: 'network',
      city: null,
      cost: getConstants(state).MAP_RULES.stationStepCost,
      left: top.steps > 0 ? 1 : 0,
      allow: { railwayStation: 1, telegraphStation: 1 },
    };
  }
  return null;
}

/** The part of a building's block reason that is the same for both kinds: the city and where this occasion allows it. */
function placementWhereBlock(state, playerId, city, ctx) {
  const c = MAP.cityById[city];
  if (!c) return `"${city}" is not a city on the map.`;
  if (c.kind !== 'inland') {
    return `${c.name} is a start city: buildings go only in the ${MAP.inlandCities.length} inland cities.`;
  }
  if (ctx === null) return null;
  if (ctx.scope === 'city' && city !== ctx.city) {
    return `You may place a building only in ${cityNameOf(ctx.city)} on this occasion, not in ${c.name}.`;
  }
  if (ctx.scope === 'connected' && !isCityConnected(state, city)) {
    return `${c.name} is not a connected city: no claimed route reaches it, and this benefit places buildings only in connected cities.`;
  }
  if (ctx.scope === 'network' && !networkCities(state, playerId).includes(city)) {
    return `${c.name} is not in your network, and a station step places a building only in a city of your network.`;
  }
  return null;
}

/** The part after the kind-specific checks: what this occasion still allows and costs. */
function placementLimitBlock(state, playerId, kind, ctx) {
  if (ctx === null) return null;
  const K = getConstants(state);
  if (ctx.left <= 0 || ctx.allow[kind] <= 0) {
    return ctx.left <= 0
      ? 'You have placed every building this occasion allows.'
      : `You have already placed the ${K.NAMES[kind]} this occasion allows.`;
  }
  const short = firstShortfall(state.players[playerId], ctx.cost);
  if (short !== null) {
    return `Placing a building here costs ${formatCost(state, ctx.cost)} and you have ${formatAmount(K, short.key, short.have)}.`;
  }
  return null;
}

const PLACE_TIMING = {
  accepts: (frame, state) => frame.kind === 'placeBuildings' || (frame.kind === 'layTracks' && state.variants.claimFrom === 'network' && !frame.only),
  otherwise: 'You can place a building only when the rules offer one: on arriving by a claim or a move, with Congress entry C6, or as a station step in network mode.',
};

function placementTiming(state, playerId) {
  return timingBlock(state, playerId, (frame) => PLACE_TIMING.accepts(frame, state), PLACE_TIMING.otherwise);
}

/** R13.2, R13.7, R13.10. Why this player cannot place a railway station in `city`, taking a house from `houseTrack`. */
export function getPlaceRailwayStationBlockReason(state, playerId, city, houseTrack) {
  const K = getConstants(state);
  const where = placementWhereBlock(state, playerId, city, placementContext(state, playerId));
  if (where !== null && (!MAP.cityById[city] || MAP.cityById[city].kind !== 'inland')) return where;
  const name = cityNameOf(city);
  const player = state.players[playerId];
  // R13.2.1 - no railway station there already.
  const there = state.map.railwayStation[city];
  if (there !== null) {
    return there === playerId ? `You already have a railway station in ${name}.` : `${name} already has ${nameOf(state, there)}'s railway station.`;
  }
  // R13.7 - with bothBuildingsSameOwner off, the two buildings of a city belong to different players.
  if (!state.variants.bothBuildingsSameOwner && state.map.telegraphStation[city] === playerId) {
    return `In this game the railway station and the telegraph station of a city must belong to different players, and the telegraph station in ${name} is yours.`;
  }
  // R13.2.2, R13.10 - a house left on the player board.
  if (housesOnBoard(player) <= 0) return 'You have no house left on your player board to place as a railway station.';
  // R13.2.3 - the leftmost house of a track that still has one.
  if (!K.PLAYER_BOARD.houseTracks.includes(houseTrack)) {
    return `"${houseTrack}" is not a house track. The tracks are ${K.PLAYER_BOARD.houseTracks.join(', ')}.`;
  }
  if (player.houses[houseTrack] <= 0) {
    return `Your ${K.NAMES[houseTrack] ?? houseTrack} track has no house left to take: choose a track that still has one.`;
  }
  if (where !== null) return where;
  const ctx = placementContext(state, playerId);
  const limit = placementLimitBlock(state, playerId, 'railwayStation', ctx);
  if (limit !== null) return limit;
  return placementTiming(state, playerId);
}

/** R13.3, R13.7, R13.10. Why this player cannot place a telegraph station in `city`. */
export function getPlaceTelegraphStationBlockReason(state, playerId, city) {
  const ctx = placementContext(state, playerId);
  const where = placementWhereBlock(state, playerId, city, ctx);
  if (where !== null && (!MAP.cityById[city] || MAP.cityById[city].kind !== 'inland')) return where;
  const name = cityNameOf(city);
  // R13.3.1 - no telegraph station there already.
  const there = state.map.telegraphStation[city];
  if (there !== null) {
    return there === playerId ? `You already have a telegraph station in ${name}.` : `${name} already has ${nameOf(state, there)}'s telegraph station.`;
  }
  if (!state.variants.bothBuildingsSameOwner && state.map.railwayStation[city] === playerId) {
    return `In this game the railway station and the telegraph station of a city must belong to different players, and the railway station in ${name} is yours.`;
  }
  // R13.3.2, R13.10 - a telegraph station left on the row.
  if (nextTelegraphVp(state, playerId) === null) {
    return `You have placed all ${getConstants(state).PLAYER_BOARD.telegraphStations} of your telegraph stations.`;
  }
  if (where !== null) return where;
  const limit = placementLimitBlock(state, playerId, 'telegraphStation', ctx);
  if (limit !== null) return limit;
  return placementTiming(state, playerId);
}

/** R13.4 to R13.6. Why this player cannot decline to place a (further) building. */
export function getSkipBuildingBlockReason(state, playerId) {
  return timingBlock(state, playerId, isKind('placeBuildings'), 'There is no building on offer to decline.');
}

/** Whether, setting timing aside, the player could place at least one building under `ctx`. */
export function canPlaceAnyBuilding(state, playerId, ctx) {
  const K = getConstants(state);
  const cities = ctx.scope === 'city' ? [ctx.city] : MAP.inlandCities;
  const player = state.players[playerId];
  if (ctx.left <= 0) return false;
  if (firstShortfall(player, ctx.cost) !== null) return false;
  for (const city of cities) {
    if (placementWhereBlock(state, playerId, city, ctx) !== null) continue;
    const room = buildingRoom(state, city);
    if (ctx.allow.telegraphStation > 0 && room.telegraphStation && nextTelegraphVp(state, playerId) !== null) {
      if (state.variants.bothBuildingsSameOwner || state.map.railwayStation[city] !== playerId) return true;
    }
    if (ctx.allow.railwayStation > 0 && room.railwayStation && housesOnBoard(player) > 0) {
      if (state.variants.bothBuildingsSameOwner || state.map.telegraphStation[city] !== playerId) {
        for (const track of K.PLAYER_BOARD.houseTracks) if (player.houses[track] > 0) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pony Express (R18), the free actions of R4.4 and the decisions cards create
// ---------------------------------------------------------------------------

const PONY_OFF = 'Pony Express is not in play in this game.';

/** "Quick Route (card 5)": how a card is named in a sentence. */
function cardName(card) {
  return `${card.name} (card ${card.number})`;
}

/** R18.4, R18.5. Free actions are the active player's only. */
function notActivePlayerBlock(state, playerId) {
  if (state.turn.player !== playerId) return 'Free actions can be taken only by the player whose turn it is.';
  return null;
}

/** Whether the card's once-per-turn ability has been used in the period it is limited to (R18.8). */
function abilityUsed(state, cardId) {
  const m = state.modules.pony;
  return (state.variants.turnStructure === 'rounds' ? m.roundUsed : m.turn.usedCards).includes(cardId);
}

/** Specialists of each type in the train, as a sentence part: "no specialist". */
function hasAnySpecialist(state, playerId) {
  return Object.values(specialistCounts(state, playerId)).some((n) => n > 0);
}

/**
 * R18.6, R7.7. Why ONE effect of an immediate card cannot be carried out by
 * this player at all, or null when it can. A card is refused only when every
 * part is blocked.
 */
function cardPartBlock(state, playerId, card, effect) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const name = cardName(card);
  switch (effect.type) {
    case 'addCarriage': {
      const s = player.train.specialistCarriages.length;
      const t = player.train.storageCarriages;
      const canS = s < K.TRAIN.maxSpecialistCarriages;
      const canT = t < K.TRAIN.maxStorageCarriages;
      if (effect.carriage === 'specialist' && !canS) return `${name} adds a specialist carriage, and you already have ${s}, the most a train can have.`;
      if (effect.carriage === 'storage' && !canT) return `${name} adds a storage carriage, and you already have ${t}, the most a train can have.`;
      if (effect.carriage === 'choice' && !canS && !canT) {
        return `${name} adds a carriage, and your train already has the most it can: ${s} specialist carriages and ${t} storage carriages.`;
      }
      return null;
    }
    case 'hire': {
      if (nextSpecialistSlot(player) === null) {
        const use = specialistSlotUse(player);
        return `${name} hires a specialist, and every specialist slot in your train is full (${use.filled} of ${use.total}).`;
      }
      const mode = effect.free ? 'free' : effect.fee === false ? 'table' : 'bonusAction';
      for (const type of K.SPECIALIST_TYPES) {
        if (state.supply.specialists[type] > 0 && firstShortfall(player, hireCost(state, playerId, type, mode).cost) === null) return null;
      }
      return effect.free
        ? `${name} hires a specialist, and no specialist tile is left in the supply.`
        : `${name} hires a specialist for its hire cost, and you cannot pay the hire cost of any specialist that is left.`;
    }
    case 'steps':
      if (effect.move !== undefined && !hasLegalMove(state, playerId)) {
        return `${name} gives you Move Train steps, and none of your railheads can move: ${state.variants.claimFrom === 'network' ? 'there is no Move Train in network mode' : 'no claimed route touches either of them'}.`;
      }
      if (effect.claim !== undefined && !hasLegalClaim(state, playerId)) {
        return `${name} gives you a claim step, and with the built tiles you hold you cannot claim any route.`;
      }
      return null;
    case 'exchange':
      if (K.RESOURCES.every((r) => player.resources[r] === 0)) return `${name} returns resources from your storage, and you have none.`;
      return null;
    case 'vpPer':
      if ((metricValue(state, playerId, effect.metric, null, null) ?? 0) < 1) {
        return `${name} scores VP for each inland city on your routes, and you have none yet.`;
      }
      return null;
    case 'freeCongress':
      if (!congressTable(state).some((e) => e.tier === effect.tier && freeEntryBlock(state, playerId, e, null) === null)) {
        return `${name} takes tier ${effect.tier} Congress entries, and none is available.`;
      }
      return null;
    case 'untilEndOfTurn':
      if (!hasAnySpecialist(state, playerId)) return `${name} doubles one specialist type, and you have no specialist in your train.`;
      return null;
    default:
      return null; // vp, gain, gainChoice, gainBuiltTilesChoice, chooseOne, activateTrain: always possible
  }
}

/** R18.6. Whether one effect of an immediate card can be carried out now (for the order choice of card 9). */
export function cardPartFeasible(state, playerId, card, effect) {
  return cardPartBlock(state, playerId, card, effect) === null;
}

/** R18.6. Why an immediate card has no part this player can carry out, or null. */
function immediateCardBlock(state, playerId, card) {
  let first = null;
  for (const effect of card.effects) {
    const block = cardPartBlock(state, playerId, card, effect);
    if (block === null) return null;
    if (first === null) first = block;
  }
  return first;
}

/** R10.5, R17.3 card 20, R18.7 cards 13 and 24. Why an entry cannot be taken as a free entry, or null. */
function freeEntryBlock(state, playerId, entry, exclude) {
  if (entry.reset) {
    if (!anySenatorUsed(state)) return 'Reset has nothing to return: no senator has been used yet.';
  } else if (state.congress.used[entry.id]) {
    return `Entry ${entry.id} is used: its senator is on the benefit tile and stays there until somebody takes Reset.`;
  }
  if (exclude === entry.id) return `Entry ${entry.id} is the one just taken.`;
  return congressBenefitBlock(state, playerId, entry);
}

/** R18.5, R18.6. Why this player cannot buy the face-up Pony Express card `cardId`. */
export function getBuyPonyCardBlockReason(state, playerId, cardId) {
  const K = getConstants(state);
  const m = state.modules.pony;
  if (m === undefined) return PONY_OFF;
  const card = typeof cardId === 'string' ? ponyCardData(state, cardId) : undefined;
  if (card === undefined) return `"${cardId}" is not a Pony Express card.`;
  // R18.5.1 - one of the face-up cards.
  if (!m.market[card.rank].includes(card.id)) return `${cardName(card)} is not face up in the market.`;
  const notActive = notActivePlayerBlock(state, playerId);
  if (notActive !== null) return notActive;
  // R4.4.1, R18.5 - at most one purchase per turn, across both opportunities.
  if (m.turn.purchases >= K.PONY.purchasesPerTurn) {
    return `You have already bought a card this turn: at most ${plural(K.PONY.purchasesPerTurn, 'card', 'cards')} per turn, across both free-action opportunities.`;
  }
  // R18.5.2 - tokens equal to the cost.
  const cost = K.PONY.costs[card.rank];
  const held = m.players[playerId].tokensHeld;
  if (held < cost) return `${cardName(card)} is a rank ${card.rank} card and costs ${plural(cost, 'token', 'tokens')}, and you hold ${held}.`;
  // R18.6 - the cap on ongoing cards.
  const cap = state.variants.ponyOngoingCap;
  if (card.kind === 'ongoing' && cap > 0 && m.players[playerId].ongoing.length >= cap) {
    return `${cardName(card)} is an ongoing card, and you already hold ${m.players[playerId].ongoing.length}, the most allowed in this game (ponyOngoingCap = ${cap}).`;
  }
  // R18.6, R7.7 - an immediate card of which no part can be carried out cannot be bought.
  if (card.kind === 'immediate') {
    const block = immediateCardBlock(state, playerId, card);
    if (block !== null) return block;
  }
  return timingBlock(
    state,
    playerId,
    isKind('freeActions'),
    'You can buy a Pony Express card only as a free action, before your worker step or after your district action.',
  );
}

/** R18.4. Why this player cannot return a token for 1 `resource`. */
export function getExchangeTokenBlockReason(state, playerId, resource) {
  const K = getConstants(state);
  const m = state.modules.pony;
  if (m === undefined) return PONY_OFF;
  if (resource === 'coins') return 'Coins are not a resource: a token buys Iron, Wood or Gunpowder.';
  if (!K.RESOURCES.includes(resource)) return `"${resource}" is not a resource: a token buys Iron, Wood or Gunpowder.`;
  const notActive = notActivePlayerBlock(state, playerId);
  if (notActive !== null) return notActive;
  if (m.players[playerId].tokensHeld < 1) return 'You hold no Pony Express token to return.';
  return timingBlock(
    state,
    playerId,
    isKind('freeActions'),
    'You can return a token only as a free action, before your worker step or after your district action.',
  );
}

/** R18.8. Why this player cannot use the once-per-turn ability of the ongoing card `cardId`. */
export function getUsePonyCardBlockReason(state, playerId, cardId) {
  const m = state.modules.pony;
  if (m === undefined) return PONY_OFF;
  const card = typeof cardId === 'string' ? ponyCardData(state, cardId) : undefined;
  if (card === undefined) return `"${cardId}" is not a Pony Express card.`;
  if (!m.players[playerId].ongoing.includes(card.id)) return `You do not hold ${cardName(card)}.`;
  const ability = ponyAbilities(state, playerId).find((a) => a.card.id === card.id);
  if (ability === undefined) return `${cardName(card)} has no once-per-turn ability.`;
  const notActive = notActivePlayerBlock(state, playerId);
  if (notActive !== null) return notActive;
  if (abilityUsed(state, card.id)) {
    return `You have already used ${cardName(card)} this ${state.variants.turnStructure === 'rounds' ? 'round' : 'turn'}.`;
  }
  const inner = ability.effect.effect;
  if (inner.type === 'steps' && !hasLegalMove(state, playerId)) {
    return `${cardName(card)} gives you a Move Train step, and none of your railheads can move: no claimed route touches either of them.`;
  }
  if (inner.type === 'bonusAction' && freeBonusOptions(state, playerId).length === 0) {
    return `${cardName(card)} lets you take a bonus action, and you could not take any of them even at no printed cost.`;
  }
  return timingBlock(
    state,
    playerId,
    isKind('freeActions'),
    'You can use the ability of a Pony Express card only as a free action, before your worker step or after your district action.',
  );
}

/** R4.4. Why this player cannot leave the free-action opportunity (they can, whenever one is open). */
export function getEndFreeActionsBlockReason(state, playerId) {
  return timingBlock(state, playerId, isKind('freeActions'), 'You are not in a free-action opportunity.');
}

/** Whether a pending decision is one in which part of a card effect may be declined with `skipEffect`. */
function acceptsSkipEffect(frame) {
  switch (frame.kind) {
    case 'hireSpecialist':
      return frame.mayStop === true;
    case 'addCarriage':
      return frame.optional === true;
    case 'exchange':
      return true;
    case 'freeCongress':
      return frame.stop === 'skipEffect';
    default:
      return false;
  }
}

/** R18.7. Why this player cannot decline the optional part of a card effect now. */
export function getSkipEffectBlockReason(state, playerId) {
  return timingBlock(state, playerId, acceptsSkipEffect, 'There is no optional part of a card effect to decline at the moment.');
}

/** R17.3 card 20. Why this player cannot decline the free Congress entry. */
export function getDeclineFreeEntryBlockReason(state, playerId) {
  return timingBlock(
    state,
    playerId,
    (frame) => frame.kind === 'freeCongress' && frame.stop === 'declineFreeEntry',
    'You are not being offered a free Congress entry.',
  );
}

/** R18.7 card 11. Why this player cannot give back 1 `resource`. */
export function getReturnResourceBlockReason(state, playerId, resource) {
  const K = getConstants(state);
  if (!K.RESOURCES.includes(resource)) return `"${resource}" is not a resource: choose Iron, Wood or Gunpowder.`;
  const frame = ownFrame(state, playerId, 'exchange');
  if (frame !== null && frame.returned >= frame.max) {
    return `You have already given back ${frame.max} resources, the most this card allows.`;
  }
  if (state.players[playerId].resources[resource] < 1) return `You have no ${K.NAMES[resource]} in storage to give back.`;
  return timingBlock(state, playerId, isKind('exchange'), 'You are not being asked to give resources back at the moment.');
}

/** R9.2, R18.7 cards 10, 22 and 32. Why this player cannot make the Foreman act as `specialist`. */
export function getChooseForemanTypeBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  return timingBlock(state, playerId, isKind('chooseForemanType'), 'You are not choosing what the Foreman acts as at the moment.');
}

/** R18.7 card 33. Why this player cannot double the specialist type `specialist`. */
export function getChooseSpecialistTypeBlockReason(state, playerId, specialist) {
  const K = getConstants(state);
  if (!K.SPECIALIST_TYPES.includes(specialist)) return `"${specialist}" is not a specialist type.`;
  if (specialistCounts(state, playerId)[specialist] < 1) return `You have no ${K.NAMES[specialist]} in your train to double.`;
  return timingBlock(state, playerId, isKind('chooseSpecialistType'), 'You are not choosing a specialist type to double at the moment.');
}

/** R18.7 card 15. Why this player cannot pick the specialist in slot `slot` of the level `level` carriage for an extra activation. */
export function getChooseExtraActivationBlockReason(state, playerId, level, slot) {
  const K = getConstants(state);
  const carriages = state.players[playerId].train.specialistCarriages;
  if (!Number.isInteger(level) || level < 1 || !Number.isInteger(slot) || slot < 1 || slot > K.TRAIN.specialistSlotsPerCarriage) {
    return `A specialist is named by its carriage level (from 1) and slot (1 to ${K.TRAIN.specialistSlotsPerCarriage}), not level "${level}" slot "${slot}".`;
  }
  if (level > carriages.length) return `You have only ${plural(carriages.length, 'specialist carriage', 'specialist carriages')}, so there is no level ${level} carriage.`;
  if (carriages[level - 1].slots[slot - 1] === null) return `Slot ${slot} of your level ${level} carriage holds no specialist.`;
  return timingBlock(state, playerId, isKind('chooseExtraActivation'), 'You are not choosing a specialist for an extra activation at the moment.');
}

/** The candidate free actions of a player's opportunity, before the block reasons are asked. */
function freeActionCandidates(state, playerId) {
  const m = state.modules.pony;
  const out = [];
  if (m === undefined) return out;
  const K = getConstants(state);
  for (const rank of K.PONY.ranks) {
    for (const id of m.market[rank]) if (id !== null) out.push({ type: 'buyPonyCard', card: id });
  }
  if (m.players[playerId].tokensHeld > 0) for (const resource of K.RESOURCES) out.push({ type: 'exchangeToken', resource });
  for (const ability of ponyAbilities(state, playerId)) out.push({ type: 'usePonyCard', card: ability.card.id });
  return out;
}

/**
 * R4.4. Whether the player has at least one free action available. The
 * opportunity is offered only if this is true; otherwise the engine does not
 * ask (a window with nothing in it would be an empty decision).
 */
export function hasFreeAction(state, playerId) {
  const m = state.modules.pony;
  if (m === undefined) return false;
  // Every free action needs a token (a purchase, an exchange) or a card with an ability: most turns have neither.
  if (m.players[playerId].tokensHeld === 0 && ponyOngoing(state, playerId).length === 0) return false;
  const saved = timingSuspended;
  timingSuspended = true;
  try {
    for (const action of freeActionCandidates(state, playerId)) {
      if (ACTIONS[action.type].block(state, playerId, action) === null) return true;
    }
    return false;
  } finally {
    timingSuspended = saved;
  }
}

/**
 * R18.7 card 28. The bonus actions the player could take on the terms of the
 * card (no printed cost, no limit), as a list of actions. Asked before the
 * decision exists, so it answers on the hypothesis that the terms hold.
 */
export function freeBonusOptions(state, playerId) {
  const K = getConstants(state);
  const savedT = timingSuspended;
  const savedF = assumeFreeBonus;
  timingSuspended = true;
  assumeFreeBonus = true;
  try {
    const out = [];
    for (const bonus of bonusActionsInPlay(K, state.variants)) {
      const type = BONUS_ACTION_TYPES[bonus];
      if (type === undefined) continue;
      out.push(...keepLegal(state, playerId, bonusCandidates(state, playerId, type)));
    }
    return out;
  } finally {
    timingSuspended = savedT;
    assumeFreeBonus = savedF;
  }
}

// ---------------------------------------------------------------------------
// The action table
// ---------------------------------------------------------------------------
//
// One entry per action `type`. THE KEYS MUST MATCH `MUTATORS` IN actions.js
// (tests/contract.test.mjs checks it).
//
//   params   - the fields of the action object besides `type`, in the order
//              used by actionKey.
//   block    - (state, playerId, action) => string | null
//   space    - (state) => every well-formed action of this type, legal or not;
//              used by getActionSpace for diagnostics and tests.
//   describe - (state, action) => a short imperative phrase for logs and buttons.
//   stop     - true for "stop / skip / done" actions (see STOP_ACTION_TYPES).

function cityName(city) {
  return MAP.cityById[city] ? MAP.cityById[city].name : String(city);
}

export const ACTIONS = {
  placeRailhead: {
    params: ['city'],
    rule: 'R3.5',
    block: (state, pid, a) => getPlaceRailheadBlockReason(state, pid, a.city),
    space: () => MAP.cityIds.map((city) => ({ type: 'placeRailhead', city })),
    describe: (state, a) => `Put a railhead on ${cityName(a.city)}`,
  },
  chooseStartingProduction: {
    params: ['track'],
    rule: 'R3.4, R3.6',
    block: (state, pid, a) => getStartingProductionBlockReason(state, pid, a.track),
    space: (state) =>
      getConstants(state).PLAYER_BOARD.houseTracks.map((track) => ({ type: 'chooseStartingProduction', track })),
    describe: (state, a) => `Leave the "2" house slot of the ${getConstants(state).NAMES[a.track]} track empty (production 2)`,
  },
  chooseStartingSpecialist: {
    params: ['specialist'],
    rule: 'R3.6',
    block: (state, pid, a) => getStartingSpecialistBlockReason(state, pid, a.specialist),
    space: (state) =>
      getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'chooseStartingSpecialist', specialist })),
    describe: (state, a) => `Take a ${getConstants(state).NAMES[a.specialist]} as the free starting specialist`,
  },
  chooseResource: {
    params: ['resource'],
    rule: 'R1.8',
    block: (state, pid, a) => getChooseResourceBlockReason(state, pid, a.resource),
    space: (state) => getConstants(state).RESOURCES.map((resource) => ({ type: 'chooseResource', resource })),
    describe: (state, a) => `Take 1 ${getConstants(state).NAMES[a.resource]}`,
  },
  discard: {
    params: ['item'],
    rule: 'R8.5.4',
    block: (state, pid, a) => getDiscardBlockReason(state, pid, a.item),
    space: (state) => getConstants(state).STORAGE_ITEMS.map((item) => ({ type: 'discard', item })),
    describe: (state, a) => {
      const K = getConstants(state);
      return K.TERRAINS.includes(a.item) ? `Discard 1 built ${K.NAMES[a.item]} tile` : `Discard 1 ${K.NAMES[a.item]}`;
    },
  },
  placeWorker: {
    params: ['space'],
    rule: 'R5.3',
    block: (state, pid, a) => getPlaceWorkerBlockReason(state, pid, a.space),
    space: () => SPACE_IDS.map((space) => ({ type: 'placeWorker', space })),
    describe: (state, a) => `Place a worker on ${a.space}`,
  },
  displaceWorker: {
    params: ['district'],
    rule: 'R5.5',
    block: (state, pid, a) => getDisplaceWorkerBlockReason(state, pid, a.district),
    space: () => DISTRICT_IDS.map((district) => ({ type: 'displaceWorker', district })),
    describe: (state, a) => `Displace: place a worker on the centre of ${districtName(state, a.district)}`,
  },
  removeWorker: {
    params: ['from'],
    rule: 'R5.4',
    block: (state, pid, a) => getRemoveWorkerBlockReason(state, pid, a.from),
    space: () => [...SPACE_IDS, ...DISTRICT_IDS].map((from) => ({ type: 'removeWorker', from })),
    describe: (state, a) =>
      isDistrictId(a.from)
        ? `Remove the worker from the centre of ${districtName(state, a.from)}`
        : `Remove the worker from ${a.from}`,
  },
  chooseDistrict: {
    params: ['district', 'hat'],
    rule: 'R4.2 step 3, R5.6, R14.2',
    block: (state, pid, a) => getChooseDistrictBlockReason(state, pid, a.district, a.hat),
    space: () => {
      const out = [];
      for (const district of [...DISTRICT_IDS, 'none']) {
        out.push({ type: 'chooseDistrict', district, hat: false });
        out.push({ type: 'chooseDistrict', district, hat: true });
      }
      return out;
    },
    describe: (state, a) => {
      if (a.district === 'none') return 'Take no district action this turn';
      return `Take ${districtName(state, a.district)}${a.hat ? ', spending a cowboy hat' : ''}`;
    },
  },
  buyHat: {
    params: [],
    rule: 'R7.5',
    block: (state, pid) => getBuyHatBlockReason(state, pid),
    space: () => [{ type: 'buyHat' }],
    describe: (state) => `Buy Hat: pay ${formatCost(state, getConstants(state).BONUS_ACTIONS.hat.cost)} for 1 cowboy hat`,
  },
  addCarriage: {
    params: ['carriage'],
    rule: 'R7.6, R8.7',
    block: (state, pid, a) => getAddCarriageBlockReason(state, pid, a.carriage),
    space: () => ['specialist', 'storage'].map((carriage) => ({ type: 'addCarriage', carriage })),
    describe: (state, a) => `Add a ${a.carriage} carriage`,
  },
  hireSpecialist: {
    params: ['specialist'],
    rule: 'R7.4, R8.6',
    block: (state, pid, a) => getHireSpecialistBlockReason(state, pid, a.specialist),
    space: (state) => getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'hireSpecialist', specialist })),
    describe: (state, a) => `Hire a ${getConstants(state).NAMES[a.specialist]}`,
  },
  skipBonusAction: {
    params: [],
    rule: 'R7.1',
    stop: true,
    block: (state, pid) => getSkipBonusActionBlockReason(state, pid),
    space: () => [{ type: 'skipBonusAction' }],
    describe: () => 'Skip the bonus action',
  },
  useStep: {
    params: [],
    rule: 'R9.4.3, R8.8',
    block: (state, pid) => getUseStepBlockReason(state, pid),
    space: () => [{ type: 'useStep' }],
    describe: (state) => {
      const K = getConstants(state);
      const frame = topFrame(state);
      const step = frame !== null && frame.kind === 'trainActivation' ? waitingStep(frame) : null;
      if (step === null) return 'Use this step to make a built tile';
      const recipe = K.TRAIN.recipes[state.variants.conversionRate][step.type];
      return `Use your ${describeStep(state, step)}: pay ${formatCost(state, recipe.cost)} for 1 built ${K.NAMES[recipe.output]} tile`;
    },
  },
  skipStep: {
    params: [],
    rule: 'R9.4.3',
    stop: true,
    block: (state, pid) => getSkipStepBlockReason(state, pid),
    space: () => [{ type: 'skipStep' }],
    describe: (state) => {
      const frame = topFrame(state);
      const step = frame !== null && frame.kind === 'trainActivation' ? waitingStep(frame) : null;
      return step === null ? 'Skip this step' : `Skip your ${describeStep(state, step)}`;
    },
  },
  takeCongressEntry: {
    params: ['entry'],
    rule: 'R10.4, R10.6',
    block: (state, pid, a) => getTakeCongressEntryBlockReason(state, pid, a.entry),
    space: (state) => congressTable(state).map((e) => ({ type: 'takeCongressEntry', entry: e.id })),
    describe: (state, a) => {
      const entry = congressTable(state).find((e) => e.id === a.entry);
      if (!entry) return `Take Congress entry ${a.entry}`;
      const frame = topFrame(state);
      if (frame !== null && frame.kind === 'freeCongress') return `Take Congress entry ${entry.id} for free: ${entry.text}`;
      const coins = state.toAct === null ? entry.coinCost : congressCoinCost(state, state.toAct, entry);
      return `Take Congress entry ${entry.id} (${plural(entry.tier, 'lobby point', 'lobby points')} + ${plural(coins, 'Coin', 'Coins')}): ${entry.text}`;
    },
  },
  closeCongress: {
    params: [],
    rule: 'R9.4.3',
    stop: true,
    block: (state, pid) => getCloseCongressBlockReason(state, pid),
    space: () => [{ type: 'closeCongress' }],
    describe: () => 'Take no (more) Congress entries for now',
  },
  chooseBuiltTile: {
    params: ['terrain'],
    rule: 'R10.7',
    block: (state, pid, a) => getChooseBuiltTileBlockReason(state, pid, a.terrain),
    space: (state) => getConstants(state).TERRAINS.map((terrain) => ({ type: 'chooseBuiltTile', terrain })),
    describe: (state, a) => `Take 1 built ${getConstants(state).NAMES[a.terrain] ?? a.terrain} tile`,
  },
  chooseOption: {
    params: ['option'],
    rule: 'R10.1',
    block: (state, pid, a) => getChooseOptionBlockReason(state, pid, a.option),
    space: () => [0, 1, 2].map((option) => ({ type: 'chooseOption', option })),
    describe: (state, a) => {
      const frame = topFrame(state);
      const text = frame !== null && frame.kind === 'chooseOption' && frame.options[a.option] ? frame.options[a.option].text : null;
      return text === null ? `Choose option ${a.option}` : `Choose: ${text}`;
    },
  },
  claimRoute: {
    params: ['route', 'from'],
    rule: 'R11.4, R11.5',
    block: (state, pid, a) => getClaimRouteBlockReason(state, pid, a.route, a.from),
    space: () => MAP.routes.flatMap((r) => [{ type: 'claimRoute', route: r.id, from: r.a }, { type: 'claimRoute', route: r.id, from: r.b }]),
    describe: (state, a) => {
      const r = MAP.routeById[a.route];
      if (!r) return `Claim ${a.route}`;
      return `Claim ${routeName(r)} (${formatRouteCost(state, r)}) from ${cityNameOf(a.from)}`;
    },
  },
  moveTrain: {
    params: ['from', 'to'],
    rule: 'R12.2',
    block: (state, pid, a) => getMoveTrainBlockReason(state, pid, a.from, a.to),
    space: () => MAP.cityIds.flatMap((from) => MAP.cityIds.filter((to) => to !== from).map((to) => ({ type: 'moveTrain', from, to }))),
    describe: (state, a) => `Move your railhead from ${cityNameOf(a.from)} to ${cityNameOf(a.to)}`,
  },
  stopLaying: {
    params: [],
    rule: 'R11.3',
    stop: true,
    block: (state, pid) => getStopLayingBlockReason(state, pid),
    space: () => [{ type: 'stopLaying' }],
    describe: () => 'Stop: take no more steps',
  },
  placeRailwayStation: {
    params: ['city', 'houseTrack'],
    rule: 'R13.2, R13.7',
    block: (state, pid, a) => getPlaceRailwayStationBlockReason(state, pid, a.city, a.houseTrack),
    space: (state) =>
      MAP.inlandCities.flatMap((city) =>
        getConstants(state).PLAYER_BOARD.houseTracks.map((houseTrack) => ({ type: 'placeRailwayStation', city, houseTrack })),
      ),
    describe: (state, a) => {
      const K = getConstants(state);
      return `Place a railway station in ${cityNameOf(a.city)}, taking the leftmost house from your ${K.NAMES[a.houseTrack] ?? a.houseTrack} track`;
    },
  },
  placeTelegraphStation: {
    params: ['city'],
    rule: 'R13.3, R13.7',
    block: (state, pid, a) => getPlaceTelegraphStationBlockReason(state, pid, a.city),
    space: () => MAP.inlandCities.map((city) => ({ type: 'placeTelegraphStation', city })),
    describe: (state, a) => {
      const vp = state.toAct === null ? null : nextTelegraphVp(state, state.toAct);
      return `Place a telegraph station in ${cityNameOf(a.city)}${vp === null ? '' : ` (+${vp} VP)`}`;
    },
  },
  skipBuilding: {
    params: [],
    rule: 'R13.4 to R13.6',
    stop: true,
    block: (state, pid) => getSkipBuildingBlockReason(state, pid),
    space: () => [{ type: 'skipBuilding' }],
    describe: () => 'Place no (more) buildings',
  },

  // ----- The add-on modules. Each space() is empty while its module is off. -----
  installUpgrade: {
    params: ['tile', 'level'],
    rule: 'R7.3, R15.3',
    block: (state, pid, a) => getInstallUpgradeBlockReason(state, pid, a.tile, a.level),
    space: (state) =>
      state.modules.upgrades === undefined
        ? []
        : getConstants(state).UPGRADE_TILES.flatMap((t) =>
            Array.from({ length: getConstants(state).TRAIN.maxSpecialistCarriages }, (_, i) => ({ type: 'installUpgrade', tile: t.id, level: i + 1 })),
          ),
    describe: (state, a) => {
      const tile = upgradeTileData(state, a.tile);
      return tile === undefined ? `Install upgrade ${a.tile}` : `Install ${tile.name} (${tile.text}) in your level ${a.level} carriage`;
    },
  },
  buyPonyCard: {
    params: ['card'],
    rule: 'R18.5, R18.6',
    block: (state, pid, a) => getBuyPonyCardBlockReason(state, pid, a.card),
    space: (state) => (state.modules.pony === undefined ? [] : getConstants(state).PONY_CARDS.map((c) => ({ type: 'buyPonyCard', card: c.id }))),
    describe: (state, a) => {
      const K = getConstants(state);
      const card = ponyCardData(state, a.card);
      return card === undefined ? `Buy card ${a.card}` : `Buy ${card.name} for ${plural(K.PONY.costs[card.rank], 'token', 'tokens')}: ${card.text}`;
    },
  },
  exchangeToken: {
    params: ['resource'],
    rule: 'R18.4',
    block: (state, pid, a) => getExchangeTokenBlockReason(state, pid, a.resource),
    space: (state) => (state.modules.pony === undefined ? [] : getConstants(state).RESOURCES.map((resource) => ({ type: 'exchangeToken', resource }))),
    describe: (state, a) => `Return 1 Pony Express token for 1 ${getConstants(state).NAMES[a.resource] ?? a.resource}`,
  },
  usePonyCard: {
    params: ['card'],
    rule: 'R18.8',
    block: (state, pid, a) => getUsePonyCardBlockReason(state, pid, a.card),
    space: (state) =>
      state.modules.pony === undefined
        ? []
        : getConstants(state).PONY_CARDS.filter((c) => c.effects.some((e) => e.type === 'oncePerTurn')).map((c) => ({ type: 'usePonyCard', card: c.id })),
    describe: (state, a) => {
      const card = ponyCardData(state, a.card);
      return card === undefined ? `Use card ${a.card}` : `Use ${card.name}: ${card.text}`;
    },
  },
  endFreeActions: {
    params: [],
    rule: 'R4.4',
    stop: true,
    block: (state, pid) => getEndFreeActionsBlockReason(state, pid),
    space: (state) => (state.modules.pony === undefined ? [] : [{ type: 'endFreeActions' }]),
    describe: () => 'End the free-action opportunity',
  },
  skipEffect: {
    params: [],
    rule: 'R18.7',
    stop: true,
    block: (state, pid) => getSkipEffectBlockReason(state, pid),
    space: (state) => (state.modules.pony === undefined ? [] : [{ type: 'skipEffect' }]),
    describe: (state) => {
      const frame = topFrame(state);
      if (frame !== null && frame.kind === 'exchange') return 'Stop giving resources back';
      return 'Decline the rest of this card effect';
    },
  },
  returnResource: {
    params: ['resource'],
    rule: 'R18.7 card 11',
    block: (state, pid, a) => getReturnResourceBlockReason(state, pid, a.resource),
    space: (state) => (state.modules.pony === undefined ? [] : getConstants(state).RESOURCES.map((resource) => ({ type: 'returnResource', resource }))),
    describe: (state, a) => `Give back 1 ${getConstants(state).NAMES[a.resource] ?? a.resource} from your storage`,
  },
  chooseForemanType: {
    params: ['specialist'],
    rule: 'R9.2, R18.7 cards 10, 22, 32',
    block: (state, pid, a) => getChooseForemanTypeBlockReason(state, pid, a.specialist),
    space: (state) =>
      state.modules.pony === undefined ? [] : getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'chooseForemanType', specialist })),
    describe: (state, a) => {
      const name = getConstants(state).NAMES[a.specialist] ?? a.specialist;
      return `The Foreman acts as ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
    },
  },
  chooseSpecialistType: {
    params: ['specialist'],
    rule: 'R18.7 card 33',
    block: (state, pid, a) => getChooseSpecialistTypeBlockReason(state, pid, a.specialist),
    space: (state) =>
      state.modules.pony === undefined ? [] : getConstants(state).SPECIALIST_TYPES.map((specialist) => ({ type: 'chooseSpecialistType', specialist })),
    describe: (state, a) => `Double the activations of your ${getConstants(state).NAMES[a.specialist] ?? a.specialist} specialists this turn`,
  },
  chooseExtraActivation: {
    params: ['level', 'slot'],
    rule: 'R18.7 card 15',
    block: (state, pid, a) => getChooseExtraActivationBlockReason(state, pid, a.level, a.slot),
    space: (state) => {
      if (state.modules.pony === undefined) return [];
      const K = getConstants(state);
      const out = [];
      for (let level = 1; level <= K.TRAIN.maxSpecialistCarriages; level++) {
        for (let slot = 1; slot <= K.TRAIN.specialistSlotsPerCarriage; slot++) out.push({ type: 'chooseExtraActivation', level, slot });
      }
      return out;
    },
    describe: (state, a) => {
      const carriage = state.toAct === null ? undefined : state.players[state.toAct].train.specialistCarriages[a.level - 1];
      const type = carriage ? carriage.slots[a.slot - 1] : null;
      const name = type ? getConstants(state).NAMES[type] : 'specialist';
      return `Activate your level ${a.level} ${name} (slot ${a.slot}) one extra time in this activation`;
    },
  },
  declineFreeEntry: {
    params: [],
    rule: 'R17.3 card 20',
    stop: true,
    block: (state, pid) => getDeclineFreeEntryBlockReason(state, pid),
    space: (state) => (state.modules.legislative === undefined ? [] : [{ type: 'declineFreeEntry' }]),
    describe: () => 'Do not take a free Congress entry',
  },
};

/**
 * The "stop / skip / done" action types. When one of these is applied
 * automatically (it was the only legal action) it means "there was nothing
 * to do here"; a log may leave such events out.
 */
export const STOP_ACTION_TYPES = Object.keys(ACTIONS).filter((type) => ACTIONS[type].stop === true);

// ---------------------------------------------------------------------------
// The decision table
// ---------------------------------------------------------------------------
//
// One entry per kind of pending decision (frame on `state.stack`).
//
//   label - (state, frame) => what the player is being asked, as a verb phrase
//           that reads after "you must ..." and after "<name>: ".
//   list  - (state, frame) => the COMPLETE list of legal actions. Candidates
//           may be narrowed cheaply first, but every action returned has been
//           passed by its block-reason function.

/**
 * The Carriage Upgrade candidates worth asking about (R15.3): a tile still on display,
 * in a carriage that exists, holds a specialist and has its slot empty, of at least the
 * tile's level. Narrowing only: every one is still passed through its block reason.
 */
function installCandidates(state, playerId) {
  const m = state.modules.upgrades;
  if (m === undefined) return [];
  const carriages = state.players[playerId].train.specialistCarriages;
  const out = [];
  for (let level = 1; level <= carriages.length; level++) {
    if (m.installed[playerId][level - 1] !== null) continue;
    if (!carriages[level - 1].slots.some((x) => x !== null)) continue;
    for (const id of m.display) {
      if (upgradeTileData(state, id).level <= level) out.push({ type: 'installUpgrade', tile: id, level });
    }
  }
  return out;
}

/** The actions of the bonus action's type that could be offered, before their block reasons are asked. */
function bonusCandidates(state, playerId, type) {
  return type === 'installUpgrade' ? installCandidates(state, playerId) : ACTIONS[type].space(state);
}

function keepLegal(state, playerId, candidates) {
  const out = [];
  for (const action of candidates) {
    if (ACTIONS[action.type].block(state, playerId, action) === null) out.push(action);
  }
  return out;
}

export const FRAMES = {
  /** R3.5. Frame: { kind, player }. */
  setupRailhead: {
    label: (state, frame) =>
      state.players[frame.player].railheads[0] === null ? 'place your first railhead' : 'place your second railhead',
    list: (state, frame) =>
      keepLegal(state, frame.player, MAP.startCities.map((city) => ({ type: 'placeRailhead', city }))),
  },
  /** R3.4, R3.6(a). Frame: { kind, player }. */
  setupProduction: {
    label: () => 'choose which house track starts at production 2',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseStartingProduction.space(state)),
  },
  /** R3.6(b). Frame: { kind, player }. */
  setupSpecialist: {
    label: () => 'choose your free starting specialist',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseStartingSpecialist.space(state)),
  },
  /** R1.8, R3.7, R14.1. Frame: { kind, player, remaining, reason }. One resource per action. */
  chooseResource: {
    label: (state, frame) => `take ${plural(frame.remaining, 'resource', 'resources')} of your choice`,
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseResource.space(state)),
  },
  /** R8.5.4. Frame: { kind, player }. One item per action until storage is back at capacity. */
  discard: {
    label: (state, frame) => {
      const over = storageOverflow(state, frame.player);
      return `discard ${plural(over, 'item', 'items')} from storage (you hold ${storageUsed(state.players[frame.player])} of ${storageCapacity(state, frame.player)})`;
    },
    list: (state, frame) => {
      const player = state.players[frame.player];
      const held = getConstants(state).STORAGE_ITEMS.filter((item) => storedCount(player, item) > 0);
      return keepLegal(state, frame.player, held.map((item) => ({ type: 'discard', item })));
    },
  },
  /** R4.2 step 2. Frame: { kind, player }. */
  workerStep: {
    label: (state) =>
      state.variants.turnStructure === 'rounds' ? 'place or displace a worker' : 'place, displace or remove a worker',
    list: (state, frame) => {
      const pid = frame.player;
      const grid = state.grid;
      const candidates = [];
      if (state.players[pid].workersInSupply > 0) {
        for (const space of SPACE_IDS) {
          if (grid.spaces[space] === null) candidates.push({ type: 'placeWorker', space });
        }
        for (const district of DISTRICT_IDS) {
          if (grid.centres[district] === null) candidates.push({ type: 'displaceWorker', district });
        }
      }
      if (state.variants.turnStructure !== 'rounds') {
        for (const space of SPACE_IDS) {
          if (grid.spaces[space] === pid) candidates.push({ type: 'removeWorker', from: space });
        }
        for (const district of DISTRICT_IDS) {
          if (grid.centres[district] === pid) candidates.push({ type: 'removeWorker', from: district });
        }
      }
      return keepLegal(state, pid, candidates);
    },
  },
  /** R4.2 step 3. Frame: { kind, player }. The districts on offer come from `state.turn.worker`. */
  chooseDistrict: {
    label: () => 'choose the district whose action you take',
    list: (state, frame) => {
      const candidates = [];
      for (const district of accessDistricts(state)) {
        candidates.push({ type: 'chooseDistrict', district, hat: false });
        candidates.push({ type: 'chooseDistrict', district, hat: true });
      }
      candidates.push({ type: 'chooseDistrict', district: 'none', hat: false });
      return keepLegal(state, frame.player, candidates);
    },
  },
  /** R6.6, R7. Frame: { kind, player, bonus, remaining }. */
  bonusAction: {
    label: (state, frame) =>
      frame.bonus === 'any'
        ? 'take any one of the four bonus actions, at no printed cost (Frontier Mastery)'
        : `take or skip the ${getConstants(state).BONUS_ACTIONS[frame.bonus].name} bonus action`,
    list: (state, frame) => {
      // R18.7 card 28: `bonus` is 'any' and the player has committed to taking one, so there is no skip.
      if (frame.bonus === 'any') return freeBonusOptions(state, frame.player);
      const type = BONUS_ACTION_TYPES[frame.bonus];
      const candidates = type ? bonusCandidates(state, frame.player, type) : [];
      const out = keepLegal(state, frame.player, candidates);
      out.push({ type: 'skipBonusAction' });
      return out;
    },
  },
  /**
   * R9.4. Frame: { kind, player, foreman, steps: [{ type, level }], index,
   * lobby, built: { ground, tunnel, bridge }, congress, cause }.
   * `steps` is the step list of R9.4.2 (level 0 is the Foreman); `index` the
   * step to resolve next; `lobby` the lobby points in hand (R9.4.1); `built`
   * the tiles built so far (R9.4.1); `congress` is true while the window of
   * R9.4.3 / R9.4.4 for taking Congress entries is open.
   */
  trainActivation: {
    label: (state, frame) => {
      if (frame.congress) {
        return `take Lobby Congress entries with your ${plural(frame.lobby, 'lobby point', 'lobby points')}, or carry on`;
      }
      const step = frame.steps[frame.index];
      return `use or skip your ${describeStep(state, step)}`;
    },
    list: (state, frame) => {
      const pid = frame.player;
      if (frame.congress) {
        const out = keepLegal(state, pid, ACTIONS.takeCongressEntry.space(state));
        out.push({ type: 'closeCongress' });
        return out;
      }
      return keepLegal(state, pid, [{ type: 'useStep' }, { type: 'skipStep' }]);
    },
  },
  /** R10.7. Frame: { kind, player, remaining, cause }. One tile per action. */
  chooseBuiltTile: {
    label: (state, frame) => `take ${plural(frame.remaining, 'built track tile', 'built track tiles')} of your choice`,
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseBuiltTile.space(state)),
  },
  /** R10.1. Frame: { kind, player, options: [{ text, effects }], cause }. */
  chooseOption: {
    label: (state, frame) => `choose one: ${frame.options.map((o) => o.text).join(' or ')}`,
    list: (state, frame) =>
      keepLegal(state, frame.player, frame.options.map((o, option) => ({ type: 'chooseOption', option }))),
  },
  /** R8.7, R10.1 C4. Frame: { kind, player, cause }. A carriage of the player's choice, free. */
  addCarriage: {
    label: (state, frame) =>
      frame.optional ? 'add a carriage, a specialist or a storage carriage, for free, or decline' : 'add a carriage, a specialist or a storage carriage, for free',
    list: (state, frame) => {
      const out = keepLegal(state, frame.player, ACTIONS.addCarriage.space(state));
      if (frame.optional) out.push({ type: 'skipEffect' });
      return out;
    },
  },
  /** R4.4, R18. Frame: { kind, player, which: 'before' | 'after' }. The player stays here until `endFreeActions`. */
  freeActions: {
    label: (state, frame) =>
      frame.which === 'before'
        ? 'take free actions before your worker step, or end this opportunity'
        : 'take free actions after your district action, or end this opportunity',
    list: (state, frame) => {
      const out = keepLegal(state, frame.player, freeActionCandidates(state, frame.player));
      out.push({ type: 'endFreeActions' });
      return out;
    },
  },
  /** R8.6.4, R18.7 cards 6, 9, 27. Frame: { kind, player, cause, remaining, free, mayStop }. */
  hireSpecialist: {
    label: (state, frame) =>
      frame.free
        ? `hire ${plural(frame.remaining, 'specialist', 'specialists')} for free${frame.mayStop ? ', or stop' : ''}`
        : `hire a specialist, paying its hire cost${frame.mayStop ? ', or decline' : ''}`,
    list: (state, frame) => {
      const out = keepLegal(state, frame.player, ACTIONS.hireSpecialist.space(state));
      if (frame.mayStop) out.push({ type: 'skipEffect' });
      return out;
    },
  },
  /** R9.2, R18.7 cards 10, 22, 32. Frame: { kind, player, cause, foremanTimes }. */
  chooseForemanType: {
    label: () => 'choose what the Foreman acts as in this train activation',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseForemanType.space(state)),
  },
  /** R18.7 card 33. Frame: { kind, player, cause }. */
  chooseSpecialistType: {
    label: () => 'choose the specialist type whose activations double until the end of this turn',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseSpecialistType.space(state)),
  },
  /** R18.7 card 15. Frame: { kind, player, foreman, foremanTimes, cause }. */
  chooseExtraActivation: {
    label: () => 'choose the specialist that is activated one extra time in this train activation',
    list: (state, frame) => keepLegal(state, frame.player, ACTIONS.chooseExtraActivation.space(state)),
  },
  /** R18.7 card 11. Frame: { kind, player, max, returned, cause }. */
  exchange: {
    label: (state, frame) =>
      `give back up to ${plural(frame.max - frame.returned, 'resource', 'resources')} from your storage to take the same number of your choice, or stop`,
    list: (state, frame) => {
      const out = keepLegal(state, frame.player, ACTIONS.returnResource.space(state));
      out.push({ type: 'skipEffect' });
      return out;
    },
  },
  /** R17.3 card 20, R18.7 cards 13 and 24. Frame: { kind, player, tier, remaining, exclude, stop, activation, cause }. */
  freeCongress: {
    label: (state, frame) =>
      `take ${frame.remaining === 1 ? 'a free tier ' + frame.tier + ' Congress entry' : 'up to ' + frame.remaining + ' free tier ' + frame.tier + ' Congress entries'}, or decline`,
    list: (state, frame) => {
      const out = keepLegal(state, frame.player, ACTIONS.takeCongressEntry.space(state));
      out.push({ type: frame.stop });
      return out;
    },
  },
  /**
   * R13.4 to R13.6. Frame: { kind, player, scope, city, cost, left, allow: {
   * railwayStation, telegraphStation }, cause }. `scope` 'city' (the arrival
   * city `city`) or 'connected' (any connected inland city, Congress C6);
   * `left` is how many buildings may still be placed; `allow` how many of
   * each kind; `cost` what each building costs (nothing when free).
   */
  placeBuildings: {
    label: (state, frame) => {
      const where = frame.scope === 'city' ? ` in ${cityNameOf(frame.city)}` : '';
      const cost = Object.keys(frame.cost).length > 0 ? `, ${formatCost(state, frame.cost)} each` : ', for free';
      return `place ${frame.left === 1 ? 'a building' : 'up to ' + frame.left + ' buildings'}${where}${cost}, or none`;
    },
    list: (state, frame) => {
      const pid = frame.player;
      const K = getConstants(state);
      const cities = frame.scope === 'city' ? [frame.city] : MAP.inlandCities;
      const candidates = [];
      for (const city of cities) {
        if (frame.allow.telegraphStation > 0) candidates.push({ type: 'placeTelegraphStation', city });
        if (frame.allow.railwayStation > 0) {
          for (const houseTrack of K.PLAYER_BOARD.houseTracks) candidates.push({ type: 'placeRailwayStation', city, houseTrack });
        }
      }
      const out = keepLegal(state, pid, candidates);
      out.push({ type: 'skipBuilding' });
      return out;
    },
  },
  /**
   * R11.3. Frame: { kind, player, taken, totals: { routes, slots: { ground,
   * tunnel, bridge } }, ... } plus the steps left: `steps` (per-step, and in
   * network mode), or `claimsLeft: [a, b]` per railhead and `movesLeft`
   * (layTrackClaims = per-railhead).
   */
  layTracks: {
    label: (state, frame) => {
      const left =
        frame.steps !== undefined
          ? `${plural(frame.steps, 'step', 'steps')} left`
          : `${frame.claimsLeft[0] + frame.claimsLeft[1]} claims and ${plural(frame.movesLeft, 'move', 'moves')} left`;
      const moves = state.variants.claimFrom === 'network' ? 'claim a route or place a building' : 'claim a route or move your train';
      return `${moves} (${left})${frame.taken > 0 ? ', or stop' : ''}`;
    },
    list: (state, frame) => {
      const pid = frame.player;
      const player = state.players[pid];
      const owner = state.map.routeOwner;
      const candidates = [];
      // `only` limits the steps a card gives to claims or to moves (Pony Express cards 3, 5, 14).
      if (state.variants.claimFrom === 'network') {
        const net = networkCities(state, pid);
        for (const route of MAP.routes) {
          if (owner[route.id] !== null) continue;
          const aIn = net.includes(route.a);
          if (!aIn && !net.includes(route.b)) continue;
          candidates.push({ type: 'claimRoute', route: route.id, from: aIn ? route.a : route.b });
        }
        const K = getConstants(state);
        if (!frame.only) {
          for (const city of net) {
            if (MAP.cityById[city].kind !== 'inland') continue;
            candidates.push({ type: 'placeTelegraphStation', city });
            for (const houseTrack of K.PLAYER_BOARD.houseTracks) candidates.push({ type: 'placeRailwayStation', city, houseTrack });
          }
        }
      } else {
        for (const city of new Set(player.railheads)) {
          if (frame.only !== 'move') {
            for (const id of MAP.cityRoutes[city]) {
              if (owner[id] === null) candidates.push({ type: 'claimRoute', route: id, from: city });
            }
          }
          if (frame.only !== 'claim') {
            for (const to of reachableCities(state, city)) candidates.push({ type: 'moveTrain', from: city, to });
          }
        }
      }
      if (frame.taken > 0) candidates.push({ type: 'stopLaying' });
      return keepLegal(state, pid, candidates);
    },
  },
};

/** What the pending decision asks, as a verb phrase ("place your first railhead"). */
export function frameLabel(state, frame) {
  const def = FRAMES[frame.kind];
  return def ? def.label(state, frame) : frame.kind;
}

// ---------------------------------------------------------------------------
// The public functions
// ---------------------------------------------------------------------------

/**
 * LAYER 1. The complete list of legal next actions, all for the one player
 * `state.toAct`. Empty only when the game is over. Every action in the list
 * is accepted by applyAction. On a state that came from createGame or
 * applyAction the list never has exactly one entry: a forced action is
 * applied by the engine itself (docs/engine-contract.md, "Auto-advance").
 *
 * Returns fresh objects; does not copy or change the state.
 */
export function getValidActions(state) {
  if (state.phase === 'ended') return [];
  const frame = topFrame(state);
  if (frame === null) return [];
  return FRAMES[frame.kind].list(state, frame);
}

/**
 * LAYER 2. Why `action` cannot be taken now: a sentence for the player, or
 * null when the action is legal.
 *
 * The question is asked for `action.player` if the action carries one, else
 * for `state.toAct`. An unknown type or a missing field is itself a reason.
 */
export function getBlockReason(state, action) {
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return 'An action must be an object with a `type`.';
  }
  const def = ACTIONS[action.type];
  if (!def) return `"${action.type}" is not an action of this game.`;
  for (const param of def.params) {
    if (action[param] === undefined || action[param] === null) {
      return `The action "${action.type}" needs \`${param}\`.`;
    }
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
 * decision is pending: the answer to "if it were my move of the right kind,
 * could I?". Null means nothing but timing stands in the way. For tooltips
 * shown ahead of time and for bots that plan ("could I afford that hire?").
 *
 * Costs are those of the context the action would normally be taken in (for
 * a bonus action, its printed cost). An action whose legality depends on an
 * earlier step of the same turn (chooseDistrict) still reports that step as
 * missing.
 */
export function getStructuralBlockReason(state, action) {
  timingSuspended = true;
  try {
    return getBlockReason(state, action);
  } finally {
    timingSuspended = false;
  }
}

/**
 * Every well-formed action a player could ever propose in this game, legal or
 * not: the cross product of the action types and their parameters. For
 * diagnostics ("why can I not ...", for each of them) and for tests. Not for
 * bots: bots use getValidActions.
 */
export function getActionSpace(state) {
  const out = [];
  for (const type of Object.keys(ACTIONS)) {
    for (const action of ACTIONS[type].space(state)) out.push(action);
  }
  return out;
}

/** A canonical text key for an action: equal actions give equal keys. For maps, logs and search trees. */
export function actionKey(action) {
  const def = ACTIONS[action.type];
  if (!def || def.params.length === 0) return action.type;
  let key = action.type;
  for (const param of def.params) key += `:${action[param]}`;
  return key;
}

/** A short imperative phrase for an action, for buttons and logs ("Place a worker on W4"). */
export function describeAction(state, action) {
  const def = ACTIONS[action.type];
  return def ? def.describe(state, action) : action.type;
}

/**
 * What is being asked, and of whom: `{ player, kind, prompt }`, or null when
 * the game is over. `prompt` reads "Anna: choose the district
 * whose action you take".
 */
export function describeDecision(state) {
  const frame = topFrame(state);
  if (state.phase === 'ended' || frame === null) return null;
  return {
    player: frame.player,
    kind: frame.kind,
    prompt: `${nameOf(state, frame.player)}: ${frameLabel(state, frame)}`,
  };
}

/**
 * For the district-choice step: what M would be for each district on offer,
 * with and without a hat, as `[{ district, hat, multiplier, adjacent }]`.
 * Lets the UI show "x2" on a district before the player commits (R5.6).
 */
export function previewMultipliers(state) {
  const frame = topFrame(state);
  if (frame === null || frame.kind !== 'chooseDistrict') return [];
  const worker = state.turn.worker;
  const exclude = worker.via === 'remove' ? null : worker.at;
  return getValidActions(state)
    .filter((a) => a.district !== 'none')
    .map((a) => {
      const m = multiplierFor(state, frame.player, a.district, a.hat, exclude);
      return { district: a.district, hat: a.hat, multiplier: m.multiplier, adjacent: m.adjacent };
    });
}

/** Whether the active player could still spend a hat this turn (R14.2). For the UI's hat toggle. */
export function canSpendHat(state, playerId) {
  return getSpendHatBlockReason(state, playerId) === null;
}
