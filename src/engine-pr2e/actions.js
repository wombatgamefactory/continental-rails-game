// actions.js - everything that changes the game state.
//
//   applyAction(state, action)  the ONE way a player's decision reaches the state
//   MUTATORS                    one function per action type
//   RESUME                      what a pending decision does by itself
//   the turn flow               what happens between decisions (P3, P4.2, P19)
//   advance                     runs the flow and applies forced actions
//
// VALIDATE EVERYTHING, THEN APPLY. applyAction asks getBlockReason first and
// throws if the action is refused; only then does a mutator run. Mutators do
// not validate and must not throw.
//
// The model: `state.stack` holds the pending decisions, the last one being
// asked now. A player's action answers it. Whenever the stack is empty the
// turn flow pushes the next decision or does the next automatic thing.
// Whenever the decision on top has exactly one legal action, the engine
// applies it itself. The loop stops when a real choice is waiting, or the
// game is over.

import { getConstants, topFrame, pushFrame, popFrame, newTurn } from './state.js';
import { openEventSink, closeEventSink, setEventSeq, eventsOn, emit } from './events.js';
import { MAP, DISTRICT_SPACES } from './board.js';
import {
  districtInfo,
  production,
  storageOverflow,
  nextSpecialistSlot,
  hireCost,
  multiplierFor,
  usedWorkerAt,
  playersAfter,
  nextPlayerId,
  lastSeatId,
  districtHousesOn,
  nextTelegraphVp,
  evaluateLay,
  wildSlotsOnPath,
  upgradeTileData,
} from './queries.js';
import { ACTIONS, FRAMES, getBlockReason, describeAction, canPlaceArrivalBuilding, hasLegalLay, canHire } from './legality.js';
import { addVp, applyFinalScoring, scoreGame } from './scoring.js';

/** Safety limits of the engine itself. Not rules of the game. */
export const ENGINE_LIMITS = {
  /** Most automatic steps `advance` may take after one action before it reports an engine bug. */
  maxAutoSteps: 10000,
};

// ---------------------------------------------------------------------------
// Gaining and paying. Every change to what a player holds goes through here.
// ---------------------------------------------------------------------------

/** P7.6. Asks `playerId` to discard if they are over capacity. Safe to call after any gain. */
export function ensureDiscard(state, playerId) {
  if (storageOverflow(state, playerId) === 0) return;
  const top = topFrame(state);
  if (top !== null && top.kind === 'discard' && top.player === playerId) return;
  pushFrame(state, { kind: 'discard', player: playerId });
}

/** P7.7. Takes a cost `{ iron?, wood?, gunpowder?, coins? }` from a player. The caller has checked they can pay. */
export function pay(state, playerId, cost, cause) {
  const player = state.players[playerId];
  let any = false;
  for (const key in cost) {
    if (cost[key] === 0) continue;
    any = true;
    if (key === 'coins') player.coins -= cost[key];
    else player.resources[key] -= cost[key];
  }
  if (any) emit({ type: 'pay', player: playerId, cost: { ...cost }, cause });
}

/** P6.4, P7.3. A resource or Coins into storage; asks for a discard if that overflows. */
export function gainResource(state, playerId, resource, amount, cause) {
  if (amount <= 0) return;
  if (resource === 'coins') state.players[playerId].coins += amount;
  else state.players[playerId].resources[resource] += amount;
  emit({ type: 'gain', player: playerId, item: resource, amount, cause });
  ensureDiscard(state, playerId);
}

/** P7.3. Coins are stored like any resource (the contract's name for this helper). */
export function gainCoins(state, playerId, amount, cause) {
  gainResource(state, playerId, 'coins', amount, cause);
}

/** P1.11, P9.3. BUILT track tiles into storage (never onto the map); asks for a discard if that overflows. */
export function gainBuiltTiles(state, playerId, terrain, amount, cause) {
  if (amount <= 0) return;
  state.players[playerId].builtTiles[terrain] += amount;
  emit({ type: 'gain', player: playerId, item: terrain, built: true, amount, cause });
  ensureDiscard(state, playerId);
}

/**
 * P11.1, P5.5.3. Gives hats up to the holding limit; each hat that does not fit
 * becomes 1 resource of the player's choice (a `chooseResource` frame, Coin
 * allowed). For a displacement that is always so (P5.5.3); for any other source
 * (`fromDisplacement` false: Congress column K4) the variant `hatOverflow`
 * decides, and with `lost` the extra hat is simply not gained.
 * Returns the number of resources owed.
 */
export function gainHats(state, playerId, amount, cause, fromDisplacement = true) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const room = Math.max(0, K.HATS.hatLimit - player.hats);
  const taken = Math.min(room, amount);
  if (taken > 0) {
    player.hats += taken;
    emit({ type: 'gain', player: playerId, item: 'hats', amount: taken, cause });
  }
  const refused = amount - taken;
  const owed = fromDisplacement || state.variants.hatOverflow === 'resource' ? refused : 0;
  if (refused > 0) emit({ type: 'hatLimit', player: playerId, hatsRefused: refused, resourcesOwed: owed, cause });
  if (owed > 0) pushFrame(state, { kind: 'chooseResource', player: playerId, remaining: owed, reason: 'hatLimit', allowed: K.CHOICE_RESOURCES.slice() });
  return owed;
}

/** Gains several items at once (`{ iron, wood, gunpowder, coins }`), each through the helpers above. */
export function gainItems(state, playerId, items, cause) {
  for (const key in items) gainResource(state, playerId, key, items[key], cause);
}

// ---------------------------------------------------------------------------
// Pieces onto the board
// ---------------------------------------------------------------------------

/** P16.2. The leftmost house of `houseTrack` goes onto `city` as a railway station; production rises at once. */
function putRailwayStation(state, playerId, city, houseTrack, cause) {
  state.players[playerId].houses[houseTrack] -= 1;
  state.map.railwayStation[city] = playerId;
  emit({ type: 'buildingPlaced', player: playerId, kind: 'railwayStation', city, houseTrack, cause });
}

/** P16.3. The bottom telegraph station of the row goes onto `city` and scores the VP printed under it. */
function putTelegraphStation(state, playerId, city, cause) {
  const vp = nextTelegraphVp(state, playerId);
  state.players[playerId].telegraphsPlaced += 1;
  state.map.telegraphStation[city] = playerId;
  emit({ type: 'buildingPlaced', player: playerId, kind: 'telegraphStation', city, vp, cause });
  addVp(state, playerId, 'telegraph', vp, 'P16.3');
}

/** P7.4, P16.5. The player's next numbered carriage, right of the last. */
function addCarriage(state, playerId, cause) {
  const K = getConstants(state);
  const carriages = state.players[playerId].train.specialistCarriages;
  const number = carriages.length + 1;
  carriages.push({ number, slots: new Array(K.PLAYER_BOARD.specialistSpacesPerCarriage).fill(null), upgrade: null });
  emit({ type: 'carriageAdded', player: playerId, carriage: number, specialistCarriages: carriages.length, cause });
}

/**
 * P16.5. A railway station placed by the Lay Track action counts towards the
 * carriages: the 1st, 2nd and 3rd bring carriages 1, 2 and 3; carriage 1
 * brings a free specialist of any type still in the supply.
 */
function layStationReward(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  player.layStationsPlaced += 1;
  if (player.layStationsPlaced > K.MAP_RULES.carriagesForLayStations) return;
  if (player.train.specialistCarriages.length >= K.PLAYER_BOARD.maxCarriages) return;
  addCarriage(state, playerId, 'layStation');
  if (player.train.specialistCarriages.length === 1 && K.MAP_RULES.freeSpecialistsWithCarriage1 > 0) {
    if (K.SPECIALIST_TYPES.some((t) => state.supply.specialists[t] > 0)) {
      pushFrame(state, { kind: 'chooseFreeSpecialist', player: playerId });
    }
  }
  // Capacity rose: an earlier overflow cannot exist here (a discard is settled at once), so nothing more to do.
}

// ---------------------------------------------------------------------------
// Building the step list of a board activation (P9.2)
// ---------------------------------------------------------------------------

function pushBoardActivation(state, playerId, foremanType, times, cause) {
  const steps = [];
  for (let i = 0; i < times; i++) steps.push({ type: foremanType, carriage: 0, slot: null });
  for (const carriage of state.players[playerId].train.specialistCarriages) {
    // P12.4 - the carriage's upgrade token acts after the earlier carriages and before its own specialists.
    if (carriage.upgrade !== null) steps.push({ type: 'upgrade', carriage: carriage.number, slot: null, token: carriage.upgrade });
    carriage.slots.forEach((specialist, slot) => {
      if (specialist !== null) steps.push({ type: specialist, carriage: carriage.number, slot });
    });
  }
  emit({ type: 'boardActivation', player: playerId, foreman: foremanType, steps: steps.length, cause });
  pushFrame(state, { kind: 'boardActivation', player: playerId, foreman: foremanType, steps, index: 0, cause });
}

/** P12.4. An upgrade step: a level 1 or 2 token gives its resources at once; a level 3 token asks for its resources one at a time. */
function upgradeYield(state, playerId, step) {
  const K = getConstants(state);
  const data = upgradeTileData(state, step.token);
  const amount = K.UPGRADES.yield[data.level - 1];
  emit({ type: 'upgradeStep', player: playerId, tile: step.token, token: step.token, carriage: step.carriage, level: data.level, gives: data.gives, amount });
  if (data.gives === 'choice') {
    pushFrame(state, { kind: 'chooseResource', player: playerId, remaining: amount, reason: `upgrade:${step.token}`, allowed: K.CHOICE_RESOURCES.slice() });
  } else {
    gainResource(state, playerId, data.gives, amount, `upgrade:${step.token}`);
  }
}

/** P12.2, P12.3. Puts `token` from the supply into carriage `number`; a token already there returns to the supply. */
function putUpgrade(state, playerId, token, number, cause) {
  const carriage = state.players[playerId].train.specialistCarriages[number - 1];
  const replaced = carriage.upgrade;
  const supply = state.supply.upgrades;
  supply.splice(supply.indexOf(token), 1);
  if (replaced !== null) supply.push(replaced);
  carriage.upgrade = token;
  emit({ type: 'upgradeInstalled', player: playerId, tile: token, token, carriage: number, level: number, replaced, cause });
  return replaced;
}

/** P10.3. Resolves the reward of a Congress column (its Coins and senator are done by the caller). */
function congressReward(state, playerId, column) {
  const K = getConstants(state);
  const cause = `congress:${column.id}`;
  switch (column.reward) {
    case 'gain':
      gainItems(state, playerId, column.items, cause);
      return;
    case 'hats':
      gainHats(state, playerId, column.count, cause, false); // P10.3.2, P11.1
      return;
    case 'districtHouseOrUpgrade':
    case 'buildings':
      pushFrame(state, { kind: 'congressPlacement', player: playerId, column: column.id, placed: { railwayStation: false, telegraphStation: false } });
      return;
    case 'choice':
      pushFrame(state, { kind: 'chooseResource', player: playerId, remaining: column.count, reason: cause, allowed: K.RESOURCES.slice() });
      return;
    case 'builtTiles':
      pushFrame(state, { kind: 'chooseBuiltTile', player: playerId, remaining: column.count, cause });
      return;
    default:
      throw new Error(`Engine bug: unknown Congress reward "${column.reward}".`);
  }
}

// ---------------------------------------------------------------------------
// Resolving a lay (P14.5)
// ---------------------------------------------------------------------------

/**
 * P14.5, steps 1 to 7, for the lay in `layFrame` (the `lay` frame, on top of the
 * stack). `fills` is the terrain chosen for each wild slot of its unlaid routes,
 * `[{ route, slot, terrain }]` in path order (P14.9); empty when there is none.
 * Runs at `endLay` itself when the path has no wild slot, otherwise when the last
 * `fillWildSlot` is answered.
 */
function resolveLay(state, layFrame, fills) {
  const K = getConstants(state);
  const frame = layFrame;
  const pid = frame.player;
  const player = state.players[pid];
  const { train, cities, routes } = frame.path;
  const from = cities[0];
  const to = cities[cities.length - 1];
  const result = evaluateLay(state, pid, cities, routes);
  const laid = routes.filter((id) => state.map.routeOwner[id] === null);
  // 1. Pay: the built tiles go onto the slots, each wild slot taking the tile chosen for it (P14.9); the routes are laid, and belong to nobody.
  const paid = { ground: result.tiles.ground, tunnel: result.tiles.tunnel, bridge: result.tiles.bridge };
  for (const f of fills) paid[f.terrain] += 1;
  for (const t of K.TERRAINS) player.builtTiles[t] -= paid[t];
  for (const id of laid) {
    const route = MAP.routeById[id];
    const here = fills.filter((f) => f.route === id).map((f) => ({ slot: f.slot, terrain: f.terrain })).sort((x, y) => x.slot - y.slot);
    const cost = { ...route.cost };
    for (const f of here) cost[f.terrain] += 1;
    state.map.routeOwner[id] = pid;
    if (here.length > 0) state.map.wildFill[id] = here.map((f) => ({ ...f }));
    emit({ type: 'routeLaid', player: pid, route: id, slots: route.length, cost, wild: here.map((f) => ({ ...f })) });
  }
  // 2. The transcontinental check (P19.1, P19.2).
  if (result.completes) {
    state.completion = { player: pid, turn: state.turn.number, route: laid[laid.length - 1], routes: laid.slice(), slots: result.slots };
    if (state.gameEnd === null) triggerGameEnd(state, 'transcontinental');
  }
  // 3. Track VP (P14.7), or the completion VP instead (P19.2).
  if (result.completes) {
    emit({ type: 'completion', player: pid, route: laid[laid.length - 1], routes: laid.slice(), bonus: result.completionVp });
    addVp(state, pid, 'completion', result.completionVp, 'P19.2');
  } else {
    for (const seg of result.segments) addVp(state, pid, 'track', seg.perSlot * seg.slots, 'P14.7');
  }
  // 4. Tolls (P17).
  for (const toll of result.tolls) {
    emit({ type: 'toll', player: toll.owner, by: pid, city: toll.city, kind: toll.kind });
    addVp(state, toll.owner, 'toll', K.MAP_RULES.tollVp, 'P17.1');
  }
  // 5. Advance: the train moves to the destination.
  player.railheads[train] = to;
  emit({ type: 'railheadMoved', player: pid, railhead: train, from, to, cities: cities.slice(), routes: routes.slice() });
  emit({ type: 'lay', player: pid, from, to, cities: cities.slice(), routes: routes.slice(), laid: laid.slice(), segments: result.segments, trackVp: result.trackVp, completes: result.completes, wild: fills.map((f) => ({ ...f })) });
  frame.path = null;
  frame.taken += 1;
  frame.remaining -= 1;
  // 6. The arrival building (P14.6): asked only if the player is able.
  if (canPlaceArrivalBuilding(state, pid, to)) {
    // P14.3.3 b - a zero-tile lay always ends with a building, whatever `arrivalBuilding` says.
    const optional = state.variants.arrivalBuilding === 'optional' && laid.length > 0;
    pushFrame(state, { kind: 'placeBuildings', player: pid, city: to, optional, cause: 'arrival' });
  }
  // 7. The carriage reward follows from placeRailwayStation (P16.5).
}

// ---------------------------------------------------------------------------
// The mutators: one per action type
// ---------------------------------------------------------------------------

export const MUTATORS = {
  /** P3.5. */
  placeRailhead(state, frame, a) {
    const player = state.players[frame.player];
    const index = player.railheads[0] === null ? 0 : 1;
    player.railheads[index] = a.city;
    player.startCities[index] = a.city;
    emit({ type: 'railheadPlaced', player: frame.player, city: a.city, railhead: index });
    popFrame(state);
  },

  /** P3.3. One house leaves that track, so its +1 space starts empty (production 2). */
  chooseStartingProduction(state, frame, a) {
    // P3.3, SETUP.housesPerPlayer: the board starts full and loses (spaces - houses) houses, 1 by the
    // printed rules. They leave the chosen track first; any more (a lower housesPerPlayer) leave the
    // other tracks in board order, always from the leftmost space.
    const K = getConstants(state);
    const houses = state.players[frame.player].houses;
    const spaces = K.PLAYER_BOARD.houseSlotsPerTrack * K.PLAYER_BOARD.houseTracks.length;
    let remove = Math.max(0, Math.min(spaces, spaces - K.SETUP.housesPerPlayer));
    for (const track of [a.track, ...K.PLAYER_BOARD.houseTracks.filter((t) => t !== a.track)]) {
      const n = Math.min(remove, houses[track]);
      houses[track] -= n;
      remove -= n;
    }
    emit({ type: 'startingProduction', player: frame.player, track: a.track });
    popFrame(state);
  },

  /** P5.5.3, P11.1. */
  chooseResource(state, frame, a) {
    frame.remaining -= 1;
    gainResource(state, frame.player, a.resource, 1, frame.reason);
  },

  /** P7.6. */
  discard(state, frame, a) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    if (a.item === 'coins') player.coins -= 1;
    else if (K.TERRAINS.includes(a.item)) player.builtTiles[a.item] -= 1;
    else player.resources[a.item] -= 1;
    emit({ type: 'discard', player: frame.player, item: a.item });
  },

  /** P5.3. */
  placeWorker(state, frame, a) {
    state.players[frame.player].workersInSupply -= 1;
    state.grid.spaces[a.space] = frame.player;
    state.turn.worker = { via: 'place', at: a.space };
    popFrame(state);
  },

  /** P5.5. Every worker on the district's spaces and centre returns; owners are compensated in turn order. */
  displaceWorker(state, frame, a) {
    const K = getConstants(state);
    const pid = frame.player;
    const grid = state.grid;
    const returned = new Array(state.players.length).fill(0);
    for (const w of DISTRICT_SPACES[a.district]) {
      const owner = grid.spaces[w];
      if (owner === null) continue;
      grid.spaces[w] = null;
      state.players[owner].workersInSupply += 1;
      returned[owner] += 1;
      emit({ type: 'workerReturned', player: owner, space: w, by: pid });
    }
    const centre = grid.centres[a.district];
    if (centre !== null) {
      grid.centres[a.district] = null;
      state.players[centre].workersInSupply += 1;
      returned[centre] += 1;
      emit({ type: 'workerReturned', player: centre, space: a.district, by: pid });
    }
    state.players[pid].workersInSupply -= 1;
    grid.centres[a.district] = pid;
    state.turn.worker = { via: 'displace', at: a.district };
    popFrame(state);
    // P5.5.3 - compensation, in turn order from the active player's left. Choices are pushed in
    // reverse so that the first owner is asked first.
    const owners = playersAfter(state, pid).filter((o) => returned[o] > 0);
    for (let i = owners.length - 1; i >= 0; i--) {
      gainHats(state, owners[i], returned[owners[i]] * K.GRID.displacementHatsPerWorker, 'displacement');
    }
  },

  /** P5.4. */
  removeWorker(state, frame, a) {
    if (state.grid.spaces[a.from] !== undefined) state.grid.spaces[a.from] = null;
    else state.grid.centres[a.from] = null;
    state.players[frame.player].workersInSupply += 1;
    state.turn.worker = { via: 'remove', at: a.from };
    popFrame(state);
  },

  /** P4.2.2, P5.7, P11.2. Fixes the district, the mode and M. */
  chooseDistrict(state, frame, a) {
    const turn = state.turn;
    const player = state.players[frame.player];
    turn.district = a.district;
    turn.mode = a.mode ?? null;
    turn.hatsSpent = a.hats;
    if (a.district === 'none') {
      emit({ type: 'districtChosen', player: frame.player, district: 'none', tile: null, multiplier: null, adjacent: null, hats: 0, hat: false, mode: null });
      popFrame(state);
      return;
    }
    player.hats -= a.hats;
    const m = multiplierFor(state, frame.player, a.district, a.hats, usedWorkerAt(state));
    turn.multiplier = m.multiplier;
    turn.adjacent = m.adjacent;
    emit({
      type: 'districtChosen',
      player: frame.player,
      district: a.district,
      tile: state.grid.tiles[a.district],
      multiplier: m.multiplier,
      adjacent: m.adjacent,
      hats: a.hats,
      hat: a.hats > 0,
      mode: turn.mode,
    });
    popFrame(state);
  },

  /** P9.3. Pay the recipe, gain one built tile. */
  useStep(state, frame) {
    const K = getConstants(state);
    const step = frame.steps[frame.index];
    const recipe = K.ACTIVATION.recipes[step.type];
    frame.index += 1;
    pay(state, frame.player, recipe.cost, 'build');
    emit({ type: 'build', player: frame.player, terrain: recipe.builds, specialist: step.type, carriage: step.carriage, level: step.carriage, amount: 1 });
    gainBuiltTiles(state, frame.player, recipe.builds, 1, 'build');
  },

  /** P9.3. */
  skipStep(state, frame) {
    frame.index += 1;
  },

  /** P6.7. */
  skipSpecialAction(state) {
    popFrame(state);
  },

  /** P16.3: on arrival (P14.6) or by the Collect Gunpowder special action (P6.7). */
  placeTelegraphStation(state, frame, a) {
    const K = getConstants(state);
    if (frame.kind === 'congressPlacement') {
      // P10.3.4 - K7: the frame stays for the other building; it closes by itself (RESUME).
      frame.placed.telegraphStation = true;
      putTelegraphStation(state, frame.player, a.city, 'congress:K7');
      return;
    }
    popFrame(state);
    if (frame.kind === 'specialAction') {
      pay(state, frame.player, K.GRID.specialActions.telegraphStation.cost, 'special:telegraphStation');
      putTelegraphStation(state, frame.player, a.city, 'special');
    } else {
      putTelegraphStation(state, frame.player, a.city, 'arrival');
    }
  },

  /** P16.2: on arrival (P14.6, then P16.5) or by the Collect Coins special action (P6.7). */
  placeRailwayStation(state, frame, a) {
    const K = getConstants(state);
    if (frame.kind === 'congressPlacement') {
      // P10.3.4, P16.5 - K7: no carriage; the frame stays for the other building.
      frame.placed.railwayStation = true;
      putRailwayStation(state, frame.player, a.city, a.houseTrack, 'congress:K7');
      return;
    }
    popFrame(state);
    if (frame.kind === 'specialAction') {
      pay(state, frame.player, K.GRID.specialActions.railwayStation.cost, 'special:railwayStation');
      putRailwayStation(state, frame.player, a.city, a.houseTrack, 'special');
    } else {
      putRailwayStation(state, frame.player, a.city, a.houseTrack, 'arrival');
      layStationReward(state, frame.player); // P14.5.7
    }
  },

  /** P6.6, P6.7. The Collect Iron special action: pay 1 Wood, a district house on the first empty site, 2 VP. */
  placeDistrictHouse(state, frame, a) {
    const K = getConstants(state);
    const k5 = frame.kind === 'congressPlacement';
    popFrame(state);
    if (!k5) pay(state, frame.player, K.GRID.specialActions.districtHouse.cost, 'special:districtHouse');
    const sites = state.grid.sites[a.district];
    const index = sites.indexOf(null);
    sites[index] = frame.player;
    state.players[frame.player].houses[a.houseTrack] -= 1;
    emit({ type: 'districtHousePlaced', player: frame.player, district: a.district, site: index, houseTrack: a.houseTrack, cause: k5 ? 'congress:K5' : 'special' });
    if (k5) addVp(state, frame.player, 'congress', K.CONGRESS.k5Vp, 'P10.3.3');
    else addVp(state, frame.player, 'districtHouse', K.SCORING.specialActionVp.districtHouse, 'P6.7');
  },

  /** P12.2, P12.3: by the Collect Wood special action (1 Gunpowder; 2 VP, none when replacing) or Congress column K5 (1 VP). */
  installUpgrade(state, frame, a) {
    const K = getConstants(state);
    popFrame(state);
    if (frame.kind === 'congressPlacement') {
      putUpgrade(state, frame.player, a.token, a.carriage, 'congress:K5');
      addVp(state, frame.player, 'congress', K.CONGRESS.k5Vp, 'P10.3.3');
      return;
    }
    pay(state, frame.player, K.GRID.specialActions.upgrade.cost, 'special:upgrade');
    const replaced = putUpgrade(state, frame.player, a.token, a.carriage, 'special');
    if (replaced === null) addVp(state, frame.player, 'upgrade', K.SCORING.specialActionVp.upgrade, 'P6.7');
  },

  /** P10.2.1. One Financier action: pay the column's Coins, its senator goes down, its reward is resolved. */
  takeCongressColumn(state, frame, a) {
    const K = getConstants(state);
    const column = K.CONGRESS.columns.find((c) => c.id === a.column);
    frame.index += 1;
    pay(state, frame.player, { coins: column.cost }, `congress:${column.id}`);
    state.congress.down[column.id] = true;
    emit({ type: 'congressEntry', player: frame.player, entry: column.id, column: column.id, coins: column.cost });
    congressReward(state, frame.player, column);
  },

  /** P10.2.2. One Financier action: pay 1 Coin, every senator returns, 1 VP each. */
  resetSenators(state, frame) {
    const K = getConstants(state);
    frame.index += 1;
    pay(state, frame.player, { coins: K.CONGRESS.resetCost }, 'congress:KR');
    let count = 0;
    for (const id in state.congress.down) {
      if (state.congress.down[id]) {
        state.congress.down[id] = false;
        count += 1;
      }
    }
    emit({ type: 'congressEntry', player: frame.player, entry: 'KR', column: 'KR', coins: K.CONGRESS.resetCost });
    emit({ type: 'senatorsReset', player: frame.player, count });
    addVp(state, frame.player, 'congress', K.CONGRESS.resetVpPerSenator * count, 'P10.2.2');
  },

  /** P10.3.5. */
  chooseBuiltTile(state, frame, a) {
    frame.remaining -= 1;
    gainBuiltTiles(state, frame.player, a.terrain, 1, frame.cause);
  },

  /** P14.6.1 with `arrivalBuilding = optional`; or the second building of Congress column K7 declined (P10.3.4). */
  skipBuilding(state) {
    popFrame(state);
  },

  /** P8.3, P8.4, P8.5. Into the leftmost empty space; carriage 3 scores its printed VP. */
  hireSpecialist(state, frame, a) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    const cost = hireCost(state, frame.player, a.specialist);
    const spot = nextSpecialistSlot(player);
    pay(state, frame.player, cost, 'hire');
    player.train.specialistCarriages[spot.carriage - 1].slots[spot.slot] = a.specialist;
    state.supply.specialists[a.specialist] -= 1;
    frame.remaining -= 1;
    frame.taken += 1;
    emit({ type: 'hire', player: frame.player, specialist: a.specialist, carriage: spot.carriage, level: spot.carriage, slot: spot.slot, cause: 'hire' });
    if (spot.carriage === 3) addVp(state, frame.player, 'carriage3', K.PLAYER_BOARD.carriage3SpaceVp[spot.slot], 'P8.4');
  },

  /** P8.1. */
  stopHiring(state) {
    popFrame(state);
  },

  /** P16.5.1. Into space 1 of carriage 1, free. */
  chooseFreeSpecialist(state, frame, a) {
    const player = state.players[frame.player];
    player.train.specialistCarriages[0].slots[0] = a.specialist;
    state.supply.specialists[a.specialist] -= 1;
    emit({ type: 'hire', player: frame.player, specialist: a.specialist, carriage: 1, level: 1, slot: 0, cause: 'carriage1' });
    popFrame(state);
  },

  /** P14.2.1. */
  startLay(state, frame, a) {
    const city = state.players[frame.player].railheads[a.train];
    frame.path = { train: a.train, cities: [city], routes: [] };
  },

  /** P14.2.2, P4.7. */
  extendPath(state, frame, a) {
    const route = MAP.routeById[a.route];
    const last = frame.path.cities[frame.path.cities.length - 1];
    frame.path.cities.push(route.a === last ? route.b : route.a);
    frame.path.routes.push(a.route);
  },

  /**
   * P14.5, P14.9. Ends the lay. With no wild slot on its unlaid routes it resolves at
   * once (`resolveLay`). With wild slots it first asks for their tiles: one
   * `wildSlot` frame per slot is pushed, the first the train passes on top, and the
   * lay resolves when the last is answered (`fillWildSlot`).
   */
  endLay(state, frame) {
    const wild = wildSlotsOnPath(state, frame.path.cities, frame.path.routes);
    if (wild.length === 0) {
      resolveLay(state, frame, []);
      return;
    }
    frame.wildFills = [];
    for (let i = wild.length - 1; i >= 0; i--) {
      pushFrame(state, { kind: 'wildSlot', player: frame.player, route: wild[i].route, slot: wild[i].slot, remaining: wild.length - 1 - i, cause: 'lay' });
    }
  },

  /** P14.9.3. The tile for one wild slot; after the last, the lay resolves (P14.5). */
  fillWildSlot(state, frame, a) {
    // The `lay` frame is the nearest one under the remaining `wildSlot` frames.
    let lay = null;
    for (let i = state.stack.length - 2; i >= 0 && lay === null; i--) if (state.stack[i].kind === 'lay') lay = state.stack[i];
    lay.wildFills.push({ route: frame.route, slot: frame.slot, terrain: a.terrain });
    popFrame(state);
    if (frame.remaining === 0) {
      const fills = lay.wildFills;
      delete lay.wildFills;
      resolveLay(state, lay, fills);
    }
  },
  /** P14.1. */
  stopLaying(state) {
    popFrame(state);
  },
};

// ---------------------------------------------------------------------------
// What a pending decision does by itself
// ---------------------------------------------------------------------------
//
// RESUME[kind](state, frame) returns true when it changed something (the
// engine then looks again), false when the frame is waiting for a player.

export const RESUME = {
  chooseResource(state, frame) {
    if (frame.remaining > 0) return false;
    popFrame(state);
    return true;
  },
  discard(state, frame) {
    if (storageOverflow(state, frame.player) > 0) return false;
    popFrame(state);
    return true;
  },
  /** P9.4, P12.4. An upgrade step is no decision: its yield is taken here. The activation ends after its last step. */
  boardActivation(state, frame) {
    if (frame.index < frame.steps.length) {
      const step = frame.steps[frame.index];
      if (step.type !== 'upgrade') return false;
      frame.index += 1;
      upgradeYield(state, frame.player, step);
      return true;
    }
    popFrame(state);
    return true;
  },
  /** P10.3.4. K7 closes once a building is placed and no other can be (K5 closes in its mutators). */
  congressPlacement(state, frame) {
    if (!frame.placed.railwayStation && !frame.placed.telegraphStation) return false;
    const list = FRAMES.congressPlacement.list(state, frame);
    if (list.some((a) => !ACTIONS[a.type].stop)) return false;
    popFrame(state);
    return true;
  },
  /** P10.3.5. */
  chooseBuiltTile(state, frame) {
    if (frame.remaining > 0) return false;
    popFrame(state);
    return true;
  },
  /** P8.1. The hires allowed are made, or no further hire is possible. */
  hire(state, frame) {
    if (frame.remaining > 0 && (frame.taken === 0 || canHire(state, frame.player))) return false;
    popFrame(state);
    return true;
  },
  /** P14.1. Between lays: the lays allowed are made, or no further lay is possible. */
  lay(state, frame) {
    if (frame.path !== null) return false;
    if (frame.remaining > 0 && (frame.taken === 0 || hasLegalLay(state, frame.player))) return false;
    popFrame(state);
    return true;
  },
};

// ---------------------------------------------------------------------------
// Resolving a district action (P4.2.3)
// ---------------------------------------------------------------------------
//
// THIS TABLE MUST HAVE THE SAME KEYS AS `DISTRICT_ACTION_RULES` IN legality.js.

export const DISTRICT_RESOLVERS = {
  collect: {
    /** P6.3. Yield = production + your district houses there + action bonuses. */
    resolve(state) {
      const K = getConstants(state);
      const turn = state.turn;
      const info = districtInfo(state, turn.district);
      const p = production(state, turn.player, info.collects);
      const houses = districtHousesOn(state, turn.player, turn.district);
      const bonus = turn.multiplier - K.GRID.baseMultiplier;
      const amount = p + houses * K.GRID.districtHouseYield + bonus;
      emit({ type: 'gather', player: turn.player, district: turn.district, item: info.collects, production: p, districtHouses: houses, multiplier: turn.multiplier, amount });
      gainResource(state, turn.player, info.collects, amount, 'collect');
    },
    /** P6.7. The special action, after the yield is in storage. */
    followUp(state) {
      const turn = state.turn;
      const info = districtInfo(state, turn.district);
      pushFrame(state, { kind: 'specialAction', player: turn.player, district: turn.district, special: info.special });
    },
  },
  /** P9.1, P9.2. The Foreman takes the district's type and acts M times. */
  boardActivation: {
    resolve(state) {
      const turn = state.turn;
      pushBoardActivation(state, turn.player, districtInfo(state, turn.district).foremanType, turn.multiplier, 'district');
    },
  },
  /** P8.1, P14.1. M hires or M lays. */
  layOrHire: {
    resolve(state) {
      const turn = state.turn;
      if (turn.mode === 'hire') pushFrame(state, { kind: 'hire', player: turn.player, remaining: turn.multiplier, taken: 0 });
      else pushFrame(state, { kind: 'lay', player: turn.player, remaining: turn.multiplier, taken: 0, path: null });
    },
  },
};

// ---------------------------------------------------------------------------
// The flow of setup (P3.3, P3.5, P3.6)
// ---------------------------------------------------------------------------

function runSetupFlow(state) {
  const setup = state.setup;
  const n = state.players.length;
  switch (setup.step) {
    // P3.3 - each player in seat order chooses the track whose +1 space starts empty.
    case 'production':
      if (setup.index < n) {
        pushFrame(state, { kind: 'setupProduction', player: setup.index });
        setup.index += 1;
      } else {
        setup.step = 'trainFirst';
        setup.index = n - 1;
      }
      return;
    // P3.5.1 - first trains, in reverse seat order.
    case 'trainFirst':
      if (setup.index >= 0) {
        pushFrame(state, { kind: 'setupRailhead', player: setup.index });
        setup.index -= 1;
      } else {
        setup.step = 'trainSecond';
        setup.index = 0;
      }
      return;
    // P3.5.2 - second trains, in seat order.
    case 'trainSecond':
      if (setup.index < n) {
        pushFrame(state, { kind: 'setupRailhead', player: setup.index });
        setup.index += 1;
      } else {
        // P3.6 - seat 1 takes the first turn.
        state.phase = 'play';
        state.setup = null;
        state.turn = newTurn(1, state.startPlayer);
        emit({ type: 'setupComplete' });
      }
      return;
    default:
      throw new Error(`Engine bug: unknown setup step "${setup.step}".`);
  }
}

// ---------------------------------------------------------------------------
// The flow of a turn (P4.2)
// ---------------------------------------------------------------------------

function districtResolver(state) {
  const district = state.turn.district;
  if (district === null || district === 'none') return null; // P5.4.4: no district action this turn
  return DISTRICT_RESOLVERS[districtInfo(state, district).family] ?? null;
}

/** P19.1. Marks the end as triggered; play goes on until the last seat has played (P19.3). */
function triggerGameEnd(state, reason) {
  state.gameEnd = { reason, triggeredBy: state.turn.player, triggeredOnTurn: state.turn.number };
  emit({ type: 'gameEndTriggered', reason, player: state.turn.player, turn: state.turn.number });
}

/** P19.3, P20.2. */
function finishGame(state) {
  state.phase = 'ended';
  state.stack.length = 0;
  state.toAct = null;
  state.turn.player = null;
  state.turn.step = null;
  applyFinalScoring(state);
  if (eventsOn()) {
    const score = scoreGame(state);
    emit({ type: 'gameOver', reason: state.gameEnd.reason, winner: score.winner, winners: score.winners, ranking: score.ranking, totals: score.players.map((p) => p.total) });
  }
}

/** P4.2.4. */
function endTurn(state) {
  const turn = state.turn;
  const player = state.players[turn.player];
  player.turnsTaken += 1;
  // P19.5 - the digital safety stop.
  const limit = state.variants.maxTurnsPerPlayer;
  if (state.gameEnd === null && limit > 0 && player.turnsTaken >= limit) triggerGameEnd(state, 'turn-limit');
  emit({ type: 'turnEnd', player: player.id, turn: turn.number });
  // P19.3 - once triggered, the game ends after the turn of the player in the last seat.
  if (state.gameEnd !== null && player.id === lastSeatId(state)) finishGame(state);
  else state.turn = newTurn(turn.number + 1, nextPlayerId(state, player.id));
}

function runPlayFlow(state) {
  const turn = state.turn;
  switch (turn.step) {
    case 'start':
      emit({ type: 'turnStart', player: turn.player, turn: turn.number });
      turn.step = 'worker';
      pushFrame(state, { kind: 'workerStep', player: turn.player });
      return;
    case 'worker':
      turn.step = 'district';
      pushFrame(state, { kind: 'chooseDistrict', player: turn.player });
      return;
    case 'district': {
      turn.step = 'resolve';
      const resolver = districtResolver(state);
      if (resolver !== null) resolver.resolve(state);
      return;
    }
    case 'resolve': {
      turn.step = 'followUp';
      const resolver = districtResolver(state);
      if (resolver !== null && resolver.followUp) resolver.followUp(state);
      return;
    }
    case 'followUp':
      endTurn(state);
      return;
    default:
      throw new Error(`Engine bug: unknown turn step "${turn.step}".`);
  }
}

// ---------------------------------------------------------------------------
// advance and applyAction
// ---------------------------------------------------------------------------

function applyOne(state, frame, action, auto) {
  state.seq += 1;
  setEventSeq(state.seq);
  if (eventsOn()) {
    emit({ type: 'action', player: frame.player, action: { ...action }, auto, text: describeAction(state, action) });
  }
  MUTATORS[action.type](state, frame, action);
}

/**
 * Runs the game forward until a real choice is waiting or the game is over.
 * THE AUTO-ADVANCE RULE: a decision with exactly one legal action is not a
 * choice, so the engine applies that action itself (`auto: true`).
 */
function advance(state) {
  for (let steps = 0; ; steps++) {
    if (steps > ENGINE_LIMITS.maxAutoSteps) {
      throw new Error('Engine bug: the game does not reach a decision (advance made no progress).');
    }
    if (state.phase === 'ended') return;
    const frame = topFrame(state);
    if (frame === null) {
      if (state.phase === 'setup') runSetupFlow(state);
      else runPlayFlow(state);
      continue;
    }
    const resume = RESUME[frame.kind];
    if (resume && resume(state, frame)) continue;
    const list = FRAMES[frame.kind].list(state, frame);
    if (list.length === 0) {
      throw new Error(`Engine bug: the decision "${frame.kind}" has no legal action for ${state.players[frame.player].name}.`);
    }
    if (list.length > 1) return;
    applyOne(state, frame, list[0], true);
  }
}

/** For createGame: runs a fresh state forward to its first decision. Events of setup are not collected. */
export function advanceToFirstDecision(state) {
  openEventSink(false, state.seq);
  try {
    advance(state);
  } finally {
    closeEventSink();
  }
}

/** Options for applyAction that switch event collection off: the fast path for search and bulk simulation. */
export const SILENT = Object.freeze({ events: false });

const WITH_EVENTS = Object.freeze({ events: true });

/**
 * LAYER 3. Applies one action for the player who must decide, then runs the
 * game forward to the next real choice (or the end). Changes `state` in
 * place. Throws an Error with `code: 'ILLEGAL_ACTION'` and `reason` if the
 * action is not legal (the state is then untouched). Returns the events, or
 * null with SILENT.
 */
export function applyAction(state, action, options = WITH_EVENTS) {
  const reason = getBlockReason(state, action);
  if (reason !== null) {
    const type = action !== null && typeof action === 'object' ? action.type : String(action);
    const err = new Error(`Illegal action "${type}": ${reason}`);
    err.code = 'ILLEGAL_ACTION';
    err.reason = reason;
    throw err;
  }
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action.type) || !MUTATORS[action.type]) {
    throw new Error(`Engine bug: no mutator for action type "${action.type}".`);
  }
  let events = null;
  openEventSink(options.events !== false, state.seq);
  try {
    applyOne(state, topFrame(state), action, false);
    advance(state);
  } finally {
    events = closeEventSink();
  }
  return events;
}
