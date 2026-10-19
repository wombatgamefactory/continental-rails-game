// actions.js - everything that changes the game state.
//
//   applyAction(state, action)  the ONE way a player's decision reaches the state
//   MUTATORS                    one function per action type
//   RESUME                      what a pending decision does by itself
//   the turn flow               what happens between decisions (R3, R4.2, R19)
//   advance                     runs the flow and applies forced actions
//
// VALIDATE EVERYTHING, THEN APPLY. applyAction asks getBlockReason first and
// throws if the action is refused; only then does a mutator run. Mutators do
// not validate and must not throw: a mutator that throws half-way leaves a
// state that no undo can repair.
//
// The model, in one paragraph (docs/engine-contract.md has the long form):
// `state.stack` holds the pending decisions, the last one being asked now.
// A player's action answers it. Whenever the stack is empty the turn flow
// pushes the next decision or does the next automatic thing. Whenever the
// decision on top has exactly one legal action, the engine applies it itself.
// The loop stops when a real choice is waiting, or the game is over.

import { getConstants, topFrame, pushFrame, popFrame, newTurn } from './state.js';
import { openEventSink, closeEventSink, setEventSeq, eventsOn, emit } from './events.js';
import { MAP, DISTRICT_SPACES, isSpaceId, otherEnd } from './board.js';
import {
  districtInfo,
  production,
  storageOverflow,
  storageUsed,
  storageCapacity,
  nextSpecialistSlot,
  hireCost,
  multiplierFor,
  playersAfter,
  nextPlayerId,
  lastSeatId,
  claimedRouteCount,
  isCityConnected,
  networkCities,
  moveTrainPath,
  hasTranscontinentalLine,
  hasOpponentRailwayStation,
  nextTelegraphVp,
  cardIndex,
  upgradeTileData,
  ponyCardData,
  activationTile,
  standingEffects,
  ponyModifier,
  ponyAbilities,
  specialistTotal,
  formatAmount,
} from './queries.js';
import { evaluateCondition, metricValue } from './conditions.js';
import {
  ACTIONS,
  FRAMES,
  getBlockReason,
  describeAction,
  isBonusActionAvailable,
  getTakeCongressEntryBlockReason,
  congressTable,
  congressCoinCost,
  claimRailheadIndex,
  moveRailheadIndex,
  canPlaceAnyBuilding,
  hasFreeAction,
  cardPartFeasible,
} from './legality.js';
import { addVp, applyFinalScoring, scoreGame } from './scoring.js';

/** Safety limits of the engine itself. Not rules of the game. */
export const ENGINE_LIMITS = {
  /** Most automatic steps `advance` may take after one action before it reports an engine bug. */
  maxAutoSteps: 10000,
};

// ---------------------------------------------------------------------------
// Gaining and paying. Every change to what a player holds goes through here.
// ---------------------------------------------------------------------------

/** R8.5.4. Asks `playerId` to discard if they are over capacity. Safe to call after any gain. */
export function ensureDiscard(state, playerId) {
  if (storageOverflow(state, playerId) === 0) return;
  const top = topFrame(state);
  if (top !== null && top.kind === 'discard' && top.player === playerId) return;
  pushFrame(state, { kind: 'discard', player: playerId });
}

/** Takes a cost `{ iron?, wood?, gunpowder?, coins? }` from a player. The caller has checked they can pay. */
export function pay(state, playerId, cost, cause) {
  const player = state.players[playerId];
  for (const key in cost) {
    if (key === 'coins') player.coins -= cost[key];
    else player.resources[key] -= cost[key];
  }
  emit({ type: 'pay', player: playerId, cost: { ...cost }, cause });
}

/** R6.5, R8.5. Iron, Wood or Gunpowder into storage; asks for a discard if that overflows. */
export function gainResource(state, playerId, resource, amount, cause) {
  if (amount <= 0) return;
  state.players[playerId].resources[resource] += amount;
  emit({ type: 'gain', player: playerId, item: resource, amount, cause });
  ensureDiscard(state, playerId);
}

/** R1.10. Coins have no holding limit and take no storage. */
export function gainCoins(state, playerId, amount, cause) {
  if (amount <= 0) return;
  state.players[playerId].coins += amount;
  emit({ type: 'gain', player: playerId, item: 'coins', amount, cause });
}

/** R1.13, R8.5. BUILT track tiles into storage (never onto the map); asks for a discard if that overflows. */
export function gainBuiltTiles(state, playerId, terrain, amount, cause) {
  if (amount <= 0) return;
  state.players[playerId].builtTiles[terrain] += amount;
  emit({ type: 'gain', player: playerId, item: terrain, built: true, amount, cause });
  ensureDiscard(state, playerId);
}

/**
 * R14.1. Gives hats up to the holding limit and returns how many resources of
 * the player's choice are owed in place of the hats that did not fit.
 */
function grantHats(state, playerId, amount, cause) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const room = Math.max(0, K.HATS.hatLimit - player.hats);
  const taken = Math.min(room, amount);
  if (taken > 0) {
    player.hats += taken;
    emit({ type: 'gain', player: playerId, item: 'hats', amount: taken, cause });
  }
  const owed = (amount - taken) * K.HATS.resourcesPerHatAtLimit;
  if (owed > 0) {
    emit({ type: 'hatLimit', player: playerId, hatsRefused: amount - taken, resourcesOwed: owed, cause });
  }
  return owed;
}

/**
 * R14.1. Cowboy hats, from any source. Hats beyond the holding limit become
 * resources of the player's choice: a `chooseResource` decision for that
 * player, whoever's turn it is.
 */
export function gainHats(state, playerId, amount, cause) {
  if (amount <= 0) return;
  const owed = grantHats(state, playerId, amount, cause);
  if (owed > 0) pushFrame(state, { kind: 'chooseResource', player: playerId, remaining: owed, reason: 'hatLimit' });
}

/**
 * The effect `{ type: 'gain', items }` of rules.js: any mix of resources,
 * Coins and hats.
 *
 * Hats are handled first so that the choice a hat at the limit creates
 * (R14.1) lies UNDER the discard a resource gain may create (R8.5.4): the
 * overflow is then settled at once, before the player picks the resource.
 */
export function gainItems(state, playerId, items, cause) {
  if (items.hats) gainHats(state, playerId, items.hats, cause);
  for (const key in items) {
    if (key === 'coins') gainCoins(state, playerId, items[key], cause);
    else if (key !== 'hats') gainResource(state, playerId, key, items[key], cause);
  }
}

// ---------------------------------------------------------------------------
// Hooks for the add-on modules
// ---------------------------------------------------------------------------
//
// Each is a named place where a module attaches. In the core game every one
// does nothing, and a module that is off keeps it that way (docs/
// engine-contract.md section 11): the first line of each hook is a test for
// the module's key in `state.modules`. The rule that owns the moment is named
// in each comment. Two more attach elsewhere: `offerFreeActions` (R4.4, the
// two free-action opportunities of a turn) and `finalSourceValues` in
// scoring.js (R20.2.2, R20.2.3); `production` in queries.js is where Pony
// Express card 36 raises P (R6.4.2).

/**
 * Where each trigger of the effect encoding (contract section 12) is fired
 * from. `fireTrigger` refuses an event that is not listed, and
 * tests/data-integrity.test.mjs checks that every `on` used by a card is here.
 */
export const TRIGGER_SITES = {
  completeTranscontinental: 'hookCompletion (R19.2)',
  layTracksActionEnd: 'hookLayTracksEnd (R11.10): the whole-action totals are the context',
  placeBuilding: 'hookBuildingPlaced (R13.2, R13.3)',
  firstConnection: 'hookFirstConnection (R11.5.4)',
  gather: 'hookGatherBonus (R6.4): after the yield has been multiplied',
  hire: 'the hireSpecialist mutator (R7.4): via = bonusAction or card',
  addCarriage: 'the addCarriage mutator (R7.6): via = bonusAction or card',
  congressEntryTaken: 'hookCongressEntryTaken (R10.4)',
  trainActivationStart: 'continueActivation (R9.4.1): before the step list is built',
};

/**
 * Where each modifier of the effect encoding is read. A modifier changes a
 * number the rules compute; the reader is the function that computes it.
 */
export const MODIFIER_READERS = {
  congressCoinDiscount: 'congressCoinCost (legality.js, R18.7 card 20)',
  congressCoinCost: 'congressCoinCost (legality.js, R18.7 card 37)',
  tollVp: 'tollBonus (R18.7 card 26)',
  resetVpPerSenator: 'the resetSenators effect (R18.7 card 30)',
  foremanAnyType: 'beginActivation (R18.7 card 32)',
  telegraphRowVpMultiplier: 'the placeTelegraphStation mutator (R18.7 card 34)',
  productionBonus: 'production (queries.js, R18.7 card 36)',
  activationMultiplier: 'pushTrainActivation, through pony.turn.doubled (R18.7 card 33)',
};

/** Whether the effect (one of a `trigger`'s `where`) matches the event data. */
function whereMatches(where, data) {
  for (const key in where) if (data[key] !== where[key]) return false;
  return true;
}

/**
 * Fires every standing `trigger` that listens to `event`, for `playerId`: the
 * Legislative Agenda card (everyone, R17.1) and the ongoing Pony Express
 * cards the player owns (R18.9). `data` is the event (what `where` matches,
 * what `condition` reads, what the effect needs). Every VP goes to the source
 * of the card that caused it (R20.1).
 */
function fireTrigger(state, playerId, event, data) {
  if (!Object.prototype.hasOwnProperty.call(TRIGGER_SITES, event)) {
    throw new Error(`Engine bug: "${event}" is not a trigger event with a firing site.`);
  }
  if (state.modules.legislative === undefined && state.modules.pony === undefined) return;
  for (const { source, card, effect } of standingEffects(state, playerId)) {
    if (effect.type !== 'trigger' || effect.on !== event) continue;
    if (effect.where && !whereMatches(effect.where, data)) continue;
    if (effect.condition && !evaluateCondition(state, playerId, effect.condition, data)) continue;
    if (effect.limit === 'oncePerGame') {
      const used = state.modules.legislative.used; // R17.3 card 10: the only once-per-game card
      if (used[card.id]) continue;
      used[card.id] = true;
    }
    const legislative = source === 'legislative';
    const ctx = {
      ...data,
      cause: `${legislative ? 'legislative' : 'pony'}:${card.id}`,
      vpSource: legislative ? 'legislative' : 'ponyCards',
      rule: `${legislative ? 'R17.3' : 'R18.7'} card ${card.number}`,
    };
    runEffect(state, playerId, effect.effect, ctx);
  }
}

/** R6.4. Extra items gathered AFTER multiplying (Legislative Agenda cards 11 to 14, Pony Express card 21). */
function hookGatherBonus(state, playerId, item) {
  fireTrigger(state, playerId, 'gather', { resource: item });
}

/** R15.5.1. The upgrade tile step of a train activation: `vp`, `gain` and `gainBuiltTile` effects happen here. */
function hookUpgradeStep(state, frame, step) {
  const tile = activationTile(state, frame.player, step.level);
  if (tile === null) return;
  emit({ type: 'upgradeStep', player: frame.player, tile: tile.id, level: step.level });
  // The `vpPerBuilt` part of a tile waits for the end of the activation (R15.5.2).
  const now = tile.effects.filter((e) => e.type !== 'vpPerBuilt');
  applyEffects(state, frame.player, now, { cause: `upgrade:${tile.id}`, vpSource: 'upgrades', rule: 'R15.5.1' });
}

/** R9.4.5, R15.5.2. The end of a train activation: the `vpPerBuilt` tiles count what the activation BUILT (`frame.built`). */
function hookActivationEnd(state, frame) {
  if (state.modules.upgrades === undefined) return;
  const installed = state.modules.upgrades.installed[frame.player];
  for (const id of installed) {
    if (id === null) continue;
    const tile = upgradeTileData(state, id);
    const later = tile.effects.filter((e) => e.type === 'vpPerBuilt');
    if (later.length > 0) {
      applyEffects(state, frame.player, later, { cause: `upgrade:${tile.id}`, vpSource: 'upgrades', rule: 'R15.5.2', built: frame.built });
    }
  }
}

/** R17.3 card 20. A Congress entry has been taken in a train activation (`frame`), before its benefit is resolved. */
function hookCongressEntryTaken(state, playerId, entry, frame) {
  fireTrigger(state, playerId, 'congressEntryTaken', { entry, activation: frame });
}

/**
 * R11.5.4, R18.3. A first connection has scored: the player takes the Pony
 * Express token of the city, then Legislative Agenda card 9 and Pony Express
 * cards 29 and 35 add to the 5 VP.
 */
function hookFirstConnection(state, playerId, city, route) {
  const pony = state.modules.pony;
  if (pony !== undefined && pony.tokens[city] === true) {
    pony.tokens[city] = false;
    pony.players[playerId].tokensHeld += 1;
    pony.players[playerId].tokensCollected += 1;
    emit({ type: 'ponyToken', player: playerId, city });
  }
  fireTrigger(state, playerId, 'firstConnection', { city, route });
}

/** R19.2. The transcontinental bonus has been paid: Legislative Agenda card 4 and Pony Express card 25 add to it. */
function hookCompletion(state, playerId, route) {
  fireTrigger(state, playerId, 'completeTranscontinental', { route });
}

/** R13.2, R13.3. A building was placed. `via` is the occasion ('arrival', 'move', 'stationStep' or a Congress cause). */
function hookBuildingPlaced(state, playerId, kind, city, via) {
  fireTrigger(state, playerId, 'placeBuilding', { kind, city, via });
}

/** R11.10. The Lay Tracks / Move Train action has ended; `frame.totals` holds the whole-action sums (Legislative Agenda cards 5 and 6). */
function hookLayTracksEnd(state, frame) {
  fireTrigger(state, frame.player, 'layTracksActionEnd', { totals: frame.totals });
}

/** R18.7 card 26. The toll of R13.9 has been paid to `ownerId`; card 26 makes it worth more. The base 3 VP stay in `toll`. */
function tollBonus(state, ownerId) {
  const mod = ponyModifier(state, ownerId, 'tollVp');
  if (mod === null) return;
  const K = getConstants(state);
  const extra = mod.value - K.SCORING.tollVp;
  if (extra > 0) addVp(state, ownerId, 'ponyCards', extra, 'R18.7 card 26');
}

/**
 * R16.9. End of turn, step 6: claim milestones for every player, before the
 * end triggers. For each unclaimed tile in id order: if exactly one player
 * meets the condition they claim it; if several do, the active player claims
 * it if they are among them, otherwise the first of them in turn order after
 * the active player. One player may claim several tiles in one check.
 */
function hookMilestones(state) {
  const m = state.modules.milestones;
  if (m === undefined) return;
  const index = cardIndex(getConstants(state).MILESTONE_TILES);
  const active = state.turn.player;
  const order = [active, ...playersAfter(state, active)];
  const context = { cache: {} }; // one pass over the routes per player (conditions.js routeStats); claiming changes only VP
  for (const id of m.inPlay) {
    if (m.claimedBy[id] !== null) continue;
    const tile = index.get(id);
    const winner = order.find((pid) => evaluateCondition(state, pid, tile.condition, context));
    if (winner === undefined) continue;
    m.claimedBy[id] = winner;
    emit({ type: 'milestoneClaimed', player: winner, milestone: id, name: tile.name, vp: tile.vp });
    addVp(state, winner, 'milestones', tile.vp, 'R16.8');
  }
}

/** R4.2 step 1. A turn begins: whatever a module limits "per turn" starts again (R18.5, R18.8, R18.7 card 33). */
function hookTurnStart(state) {
  const pony = state.modules.pony;
  if (pony !== undefined) pony.turn = { purchases: 0, usedCards: [], doubled: null };
}

// ---------------------------------------------------------------------------
// Effects (docs/engine-contract.md section 12)
// ---------------------------------------------------------------------------

function copyData(v) {
  return JSON.parse(JSON.stringify(v));
}

/** A short player-facing phrase for one effect, for the options of a choice. */
function describeEffect(K, effect) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  switch (effect.type) {
    case 'vp':
      return `Gain ${effect.amount} VP`;
    case 'placeBuildings':
      return `Place up to ${n(effect.railwayStation, K.NAMES.railwayStation, K.NAMES.railwayStation + 's')} and up to ${n(effect.telegraphStation, K.NAMES.telegraphStation, K.NAMES.telegraphStation + 's')}`;
    case 'gain':
      return `Gain ${Object.keys(effect.items).map((k) => formatAmount(K, k, effect.items[k])).join(' and ')}`;
    case 'gainChoice':
      return `Gain ${n(effect.count, 'resource', 'resources')} of your choice`;
    case 'gainBuiltTilesChoice':
      return `Gain ${n(effect.count, 'built track tile', 'built track tiles')} of your choice`;
    case 'addCarriage':
      return effect.carriage === 'choice' ? 'Add a carriage of your choice' : `Add a ${K.NAMES[effect.carriage] ?? effect.carriage}`;
    case 'hire':
      return effect.free ? 'Hire a specialist for free' : 'Hire a specialist, paying its hire cost';
    default:
      return effect.type;
  }
}

/**
 * The handler of every one-off effect type of the encoding:
 * `(state, playerId, effect, ctx) => void`. `ctx` is `{ cause, vpSource,
 * rule }` (the event cause, the VP source any `vp` effect is booked to
 * (R20.1) and the rule number), plus whatever the firing event supplies
 * (`times`, `route`, `resource`, `activation`, `entry`, `built`).
 *
 * An effect that needs a decision pushes its frame and returns. The standing
 * effect types (`trigger`, `modifier`, `oncePerTurn`, `endVpPer`) are not run
 * from here: they are consulted where their event happens (TRIGGER_SITES,
 * MODIFIER_READERS, `usePonyCard`, final scoring).
 */
export const EFFECT_HANDLERS = {
  /** R10.1, R15.2, R18.7. */
  vp(state, playerId, effect, ctx) {
    addVp(state, playerId, ctx.vpSource, effect.amount * (ctx.times ?? 1), ctx.rule);
  },
  gain(state, playerId, effect, ctx) {
    gainItems(state, playerId, effect.items, ctx.cause);
  },
  /** R1.8. */
  gainChoice(state, playerId, effect, ctx) {
    pushFrame(state, { kind: 'chooseResource', player: playerId, remaining: effect.count, reason: ctx.cause });
  },
  /** R15.2 U3 tiles. */
  gainBuiltTile(state, playerId, effect, ctx) {
    gainBuiltTiles(state, playerId, effect.terrain, effect.count, ctx.cause);
  },
  /** R10.7; `distinct` is card 4 (two different types). */
  gainBuiltTilesChoice(state, playerId, effect, ctx) {
    const frame = { kind: 'chooseBuiltTile', player: playerId, remaining: effect.count, cause: ctx.cause };
    if (effect.distinct) {
      frame.distinct = true;
      frame.taken = [];
    }
    pushFrame(state, frame);
  },
  /** R8.7. 'specialist' and 'storage' are added at once if the train is under the limit; 'choice' asks. */
  addCarriage(state, playerId, effect, ctx) {
    const K = getConstants(state);
    const player = state.players[playerId];
    if (effect.carriage === 'choice') {
      const canS = player.train.specialistCarriages.length < K.TRAIN.maxSpecialistCarriages;
      const canT = player.train.storageCarriages < K.TRAIN.maxStorageCarriages;
      if (effect.optional && !canS && !canT) return;
      const frame = { kind: 'addCarriage', player: playerId, cause: ctx.cause };
      if (effect.optional) frame.optional = true;
      pushFrame(state, frame);
      return;
    }
    const have = effect.carriage === 'specialist' ? player.train.specialistCarriages.length : player.train.storageCarriages;
    const max = effect.carriage === 'specialist' ? K.TRAIN.maxSpecialistCarriages : K.TRAIN.maxStorageCarriages;
    if (have < max) performAddCarriage(state, player, effect.carriage, ctx.cause);
  },
  /** R8.6.4, R18.7 cards 6, 9, 27. `free` and `fee` decide what the hire costs; `optional` and "up to" let the player stop. */
  hire(state, playerId, effect, ctx) {
    pushFrame(state, {
      kind: 'hireSpecialist',
      player: playerId,
      cause: ctx.cause,
      remaining: effect.count,
      free: effect.free === true,
      mayStop: effect.optional === true || effect.count > 1,
    });
  },
  /** R18.7 cards 3, 5, 14: Move Train or claim steps, as a Lay Tracks action of their own (R11.10). */
  steps(state, playerId, effect) {
    const only = effect.move !== undefined ? 'move' : 'claim';
    pushCardSteps(state, playerId, only, effect.move ?? effect.claim);
  },
  /** R9.1, R18.7 cards 10 and 22: M = 1 and the player chooses the Foreman's type. */
  activateTrain(state, playerId, effect, ctx) {
    beginActivation(state, playerId, null, getConstants(state).TRAIN.cardActivationMultiplier, ctx.cause);
  },
  /** R18.7 card 11. */
  exchange(state, playerId, effect, ctx) {
    pushFrame(state, { kind: 'exchange', player: playerId, max: effect.max, returned: 0, cause: ctx.cause });
  },
  /** R18.7 card 12. */
  vpPer(state, playerId, effect, ctx) {
    const value = metricValue(state, playerId, effect.metric, null, null) ?? 0;
    addVp(state, playerId, ctx.vpSource, value * effect.amount, ctx.rule);
  },
  /** R18.7 cards 13 and 24. */
  freeCongress(state, playerId, effect, ctx) {
    pushFrame(state, {
      kind: 'freeCongress',
      player: playerId,
      tier: effect.tier,
      remaining: effect.count,
      exclude: null,
      stop: 'skipEffect',
      activation: false,
      cause: ctx.cause,
    });
  },
  /** R10.1 C6, R18.7 cards 8 and 23, card 9's order. */
  chooseOne(state, playerId, effect, ctx) {
    const K = getConstants(state);
    pushFrame(state, {
      kind: 'chooseOption',
      player: playerId,
      options: effect.options.map((list) => ({ text: list.map((e) => describeEffect(K, e)).join(', then '), effects: copyData(list) })),
      cause: ctx.cause,
      vpSource: ctx.vpSource,
      rule: ctx.rule,
    });
  },
  /** R13.6. The only place it is used is Congress C6: any connected inland city. */
  placeBuildings(state, playerId, effect, ctx) {
    pushFrame(state, {
      kind: 'placeBuildings',
      player: playerId,
      scope: 'connected',
      city: null,
      cost: {},
      left: effect.railwayStation + effect.telegraphStation,
      allow: { railwayStation: effect.railwayStation, telegraphStation: effect.telegraphStation },
      cause: ctx.cause,
    });
  },
  /** R10.6 with R18.7 card 30. */
  resetSenators(state, playerId) {
    const K = getConstants(state);
    let count = 0;
    for (const id in state.congress.used) {
      if (state.congress.used[id]) {
        state.congress.used[id] = false;
        count += 1;
      }
    }
    emit({ type: 'senatorsReset', player: playerId, count });
    addVp(state, playerId, 'congress', count * K.CONGRESS.resetVpPerSenator, 'R10.6');
    // Card 30: 2 VP per senator instead of 1. The base VP stay in `congress`; what the card adds is `ponyCards` (R20.1).
    const mod = ponyModifier(state, playerId, 'resetVpPerSenator');
    if (mod !== null && mod.value > K.CONGRESS.resetVpPerSenator) {
      addVp(state, playerId, 'ponyCards', count * (mod.value - K.CONGRESS.resetVpPerSenator), 'R18.7 card 30');
    }
  },
  /** R15.5.2. Worked out at the end of the activation from `ctx.built`. */
  vpPerBuilt(state, playerId, effect, ctx) {
    addVp(state, playerId, ctx.vpSource, (ctx.built ? ctx.built[effect.terrain] : 0) * effect.amount, ctx.rule);
  },
  /** R18.7 card 33. The modifier lives in `pony.turn.doubled` and is read when a step list is built. */
  untilEndOfTurn(state, playerId, effect, ctx) {
    pushFrame(state, { kind: 'chooseSpecialistType', player: playerId, cause: ctx.cause });
  },
  // ----- only inside a trigger or an oncePerTurn -----
  /** R18.7 card 21: more of what was just gathered. */
  gainGathered(state, playerId, effect, ctx) {
    if (ctx.resource === 'coins') gainCoins(state, playerId, effect.amount, ctx.cause);
    else gainResource(state, playerId, ctx.resource, effect.amount, ctx.cause);
  },
  /** R18.7 card 35: VP per slot of the route just claimed. */
  vpPerSlot(state, playerId, effect, ctx) {
    addVp(state, playerId, ctx.vpSource, effect.amount * ctx.route.length, ctx.rule);
  },
  /** R18.7 card 15: choose a specialist for extra activations; the frame carries the activation on. */
  extraActivations(state, playerId, effect, ctx) {
    if (specialistTotal(state, playerId) === 0) return;
    pushFrame(state, {
      kind: 'chooseExtraActivation',
      player: playerId,
      foreman: ctx.activation.foreman,
      foremanTimes: ctx.activation.foremanTimes,
      count: effect.count,
      cause: ctx.activation.cause,
    });
  },
  /** R17.3 card 20: once per train activation, one other entry of the same tier for free. */
  freeCongressSameTier(state, playerId, effect, ctx) {
    const activation = ctx.activation;
    if (!activation || activation.kind !== 'trainActivation' || activation.freeEntryUsed) return;
    pushFrame(state, {
      kind: 'freeCongress',
      player: playerId,
      tier: ctx.entry.tier,
      remaining: effect.count,
      exclude: ctx.entry.id,
      stop: 'declineFreeEntry',
      activation: true,
      cause: ctx.cause,
    });
  },
  /** R18.7 card 28: any one bonus action, at no printed cost. */
  bonusAction(state, playerId, effect, ctx) {
    pushFrame(state, { kind: 'bonusAction', player: playerId, bonus: 'any', remaining: 1, free: true, cause: ctx.cause });
  },
};

/** The effect types that are standing rules, consulted where their event happens rather than run (see EFFECT_HANDLERS). */
export const STANDING_EFFECT_TYPES = ['trigger', 'modifier', 'oncePerTurn', 'endVpPer'];

function runEffect(state, playerId, effect, ctx) {
  const handler = EFFECT_HANDLERS[effect.type];
  if (!handler) {
    throw new Error(`Engine bug: the effect type "${effect.type}" has no handler.`);
  }
  handler(state, playerId, effect, ctx);
}

/** Effects that put a decision on the stack. When a list holds several, the first is pushed LAST so it is asked first. */
function createsDecision(effect) {
  switch (effect.type) {
    case 'gainChoice':
    case 'gainBuiltTilesChoice':
    case 'hire':
    case 'steps':
    case 'activateTrain':
    case 'exchange':
    case 'freeCongress':
    case 'chooseOne':
    case 'placeBuildings':
    case 'untilEndOfTurn':
      return true;
    case 'addCarriage':
      return effect.carriage === 'choice';
    default:
      return false;
  }
}

/**
 * Carries out a list of effects for a player. `ctx` is `{ cause, vpSource,
 * rule }`: the event cause, the VP source any `vp` effect is booked to
 * (R20.1), and the rule number.
 *
 * Effects that happen at once run in order. Effects that need a decision push
 * their frame; when a list has several (Pony Express card 9, `order: 'any'`
 * and its two orders) they are pushed in reverse, so the first one in the list
 * is asked first.
 */
export function applyEffects(state, playerId, effects, ctx) {
  const decisions = [];
  for (const effect of effects) {
    if (createsDecision(effect)) decisions.push(effect);
    else runEffect(state, playerId, effect, ctx);
  }
  for (let i = decisions.length - 1; i >= 0; i--) runEffect(state, playerId, decisions[i], ctx);
}

/** R7.6, R8.7. One new carriage of the train; the specialist carriage takes the next level and starts empty. */
function performAddCarriage(state, player, kind, cause) {
  const K = getConstants(state);
  if (kind === 'specialist') {
    player.train.specialistCarriages.push({ slots: new Array(K.TRAIN.specialistSlotsPerCarriage).fill(null) });
  } else {
    player.train.storageCarriages += 1;
  }
  emit({
    type: 'carriageAdded',
    player: player.id,
    carriage: kind,
    specialistCarriages: player.train.specialistCarriages.length,
    storageCarriages: player.train.storageCarriages,
    cause,
  });
}

/**
 * R9.1, R9.2. Starts a train activation. The Foreman's type is given for an
 * activation caused by a district; it is `null` for one caused by a card,
 * where the player chooses it (R9.2). Pony Express card 32 lets the owner
 * choose it for district activations too (R18.7). The choice comes first, then
 * the start-of-activation triggers (card 15), then the step list is built.
 */
export function beginActivation(state, playerId, foremanType, foremanTimes, cause) {
  if (foremanType === null || ponyModifier(state, playerId, 'foremanAnyType') !== null) {
    pushFrame(state, { kind: 'chooseForemanType', player: playerId, foremanTimes, cause });
    return;
  }
  continueActivation(state, playerId, foremanType, foremanTimes, cause);
}

/** R9.4.1, R18.7 card 15. The triggers of the start of an activation, then the step list. */
function continueActivation(state, playerId, foremanType, foremanTimes, cause) {
  const before = state.stack.length;
  fireTrigger(state, playerId, 'trainActivationStart', { activation: { foreman: foremanType, foremanTimes, cause } });
  if (state.stack.length === before) pushTrainActivation(state, playerId, foremanType, foremanTimes, cause, null);
}

// ---------------------------------------------------------------------------
// Train activation (R9): the frame, and how a step is resolved
// ---------------------------------------------------------------------------

/** R18.7 card 33. The factor of the `activationMultiplier` modifier, read from the card data of rules.js (never a bare 2). */
function activationMultiplierValue(K) {
  for (const card of K.PONY_CARDS) {
    for (const e of card.effects) {
      if (e.type === 'untilEndOfTurn' && e.modifier.what === 'activationMultiplier') return e.modifier.value;
    }
  }
  return 1;
}

/**
 * R9.4.1, R9.4.2. Starts a train activation: builds the step list and pushes
 * the `trainActivation` frame. `foremanTimes` is M (R9.3) for an action and
 * the card multiplier for an activation caused by a card.
 */
export function pushTrainActivation(state, playerId, foremanType, foremanTimes, cause, extra = null) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const steps = [];
  // R18.7 card 33: the specialist type doubled until the end of this turn.
  const doubled = state.modules.pony === undefined ? null : state.modules.pony.turn.doubled;
  // R9.4.2.1 - the Foreman, repeated M times; it always matches the district (R9.7).
  for (let i = 0; i < foremanTimes; i++) steps.push({ type: foremanType, level: 0 });
  // R9.4.2.2 - each specialist carriage in level order (R8.4).
  player.train.specialistCarriages.forEach((carriage, c) => {
    const level = c + 1;
    // R9.4.2.2.1 - the carriage's upgrade tile, if it has one (one step).
    // R15.6 - a VP tile does nothing in the step list with `upgradeVpTiming = on-install`.
    if (activationTile(state, playerId, level) !== null) steps.push({ type: 'upgrade', level });
    // R9.3 - activations per piece; `once` makes every specialist act once.
    const times = state.variants.specialistActivations === 'once' ? K.TRAIN.activationsByLevel[0] : K.TRAIN.activationsByLevel[c];
    // R9.4.2.2.2, R9.4.2.2.3 - slot 1, then slot 2.
    carriage.slots.forEach((specialist, slotIndex) => {
      if (specialist === null) return;
      let n = specialist === doubled ? times * activationMultiplierValue(K) : times; // R18.7 card 33: the factor is the card's own (rules.js)
      if (extra !== null && extra.level === level && extra.slot === slotIndex + 1) n += extra.count; // R18.7 card 15
      for (let t = 0; t < n; t++) steps.push({ type: specialist, level });
    });
  });
  const built = {};
  for (const t of K.TERRAINS) built[t] = 0;
  emit({ type: 'trainActivation', player: playerId, foreman: foremanType, steps: steps.length, cause });
  pushFrame(state, {
    kind: 'trainActivation',
    player: playerId,
    foreman: foremanType,
    steps,
    index: 0,
    lobby: 0,
    built,
    congress: false,
    entries: 0,
    cause,
  });
}

/** R9.4.4, R9.4.5. The step list is done and the last chance for Congress has passed. */
function finishActivation(state, frame) {
  if (frame.lobby > 0) {
    // R9.4.4 - leftover lobby points are lost.
    emit({ type: 'lobbyPointsLost', player: frame.player, amount: frame.lobby });
    frame.lobby = 0;
  }
  hookActivationEnd(state, frame);
  popFrame(state);
}

// ---------------------------------------------------------------------------
// Lay Tracks / Move Train (R11, R12) and buildings (R13): shared pieces
// ---------------------------------------------------------------------------

/** R11.3. The frame of a Lay Tracks / Move Train action with M steps (R5.6.4). */
export function pushLayTracks(state, playerId, m) {
  const v = state.variants;
  const heads = state.players[playerId].railheads.length;
  const frame = { kind: 'layTracks', player: playerId, taken: 0, totals: { routes: 0, slots: { ground: 0, tunnel: 0, bridge: 0 } } };
  if (v.layTrackClaims === 'per-step') {
    frame.steps = m; // M steps, each a claim or a move (a station step in network mode)
  } else if (v.claimFrom === 'network') {
    frame.steps = m * heads; // 2 x M claims
  } else {
    frame.claimsLeft = new Array(heads).fill(m); // M claims for each railhead ...
    frame.movesLeft = m; // ... and M moves in all
  }
  pushFrame(state, frame);
}

/**
 * R18.7 cards 3, 5, 14. A Lay Tracks action of its own that a card gives:
 * `n` steps that may only be `move` or only `claim`. It ends like any other
 * (R11.10 applies to its totals).
 */
function pushCardSteps(state, playerId, only, n) {
  pushFrame(state, {
    kind: 'layTracks',
    player: playerId,
    taken: 0,
    totals: { routes: 0, slots: { ground: 0, tunnel: 0, bridge: 0 } },
    steps: n,
    only,
  });
}

/** R11.10. The action ends: the whole-action sums are final. */
function endLayTracks(state, frame) {
  hookLayTracksEnd(state, frame);
  popFrame(state);
}

/** R11.5.7, R12.4, R13.4, R13.5. Offers one building in the arrival city, if the player could place one. */
function offerArrivalBuilding(state, playerId, city, cost, cause) {
  const ctx = { scope: 'city', city, cost, left: 1, allow: { railwayStation: 1, telegraphStation: 1 } };
  if (!canPlaceAnyBuilding(state, playerId, ctx)) return;
  pushFrame(state, { kind: 'placeBuildings', player: playerId, ...ctx, cost: { ...cost }, allow: { ...ctx.allow }, cause });
}

/** What a building costs on this occasion and how it uses up the occasion's allowance. */
function chargePlacement(state, frame, kind) {
  const K = getConstants(state);
  if (frame.kind === 'layTracks') {
    // R11.11.5 - a station step: 2 Coins, and it is one of the action's steps.
    pay(state, frame.player, K.MAP_RULES.stationStepCost, 'stationStep');
    frame.steps -= 1;
    frame.taken += 1;
    return;
  }
  if (Object.keys(frame.cost).length > 0) pay(state, frame.player, frame.cost, frame.cause);
  frame.left -= 1;
  frame.allow[kind] -= 1;
}

/** R19.1 to R19.2. The first transcontinental line of the game: the bonus, and the end is triggered. */
function completeTranscontinental(state, playerId, route) {
  const K = getConstants(state);
  const bonus = K.SCORING.completionVp + K.SCORING.completionVpPerSlot * route.length;
  state.completion = { player: playerId, turn: state.turn.number, route: route.id };
  addVp(state, playerId, 'completion', bonus, 'R19.2');
  emit({ type: 'completion', player: playerId, route: route.id, bonus });
  hookCompletion(state, playerId, route);
  // R19.6 - the bonus is paid even if the end was triggered earlier; the end only once.
  if (state.gameEnd === null) triggerGameEnd(state, 'transcontinental');
}

// ---------------------------------------------------------------------------
// The mutators: one per action type. (state, frame, action) => void
// ---------------------------------------------------------------------------
//
// `frame` is the pending decision the action answers (the top of the stack).
// THE KEYS MUST MATCH `ACTIONS` IN legality.js.

function markBonusTaken(state, frame, bonus) {
  frame.remaining -= 1;
  // `district` is the district whose Gather printed the bonus action; null when Pony Express card 28 gave it (`free`).
  emit({ type: 'bonusAction', player: frame.player, district: frame.free ? null : state.turn.district, bonus, free: frame.free === true });
  if (frame.free) return; // R18.7 card 28: a free bonus action does not count towards bonusActionLimit
  if (state.variants.bonusActionLimit === 'once-per-game') {
    state.players[frame.player].bonusActionsUsed[bonus] = true;
  }
}

/** The cause code of a bonus action: its own, or the card that gave it for free (R18.7 card 28). */
function bonusCause(frame, own) {
  return frame.free ? frame.cause : own;
}

export const MUTATORS = {
  /** R3.5. */
  placeRailhead(state, frame, action) {
    const player = state.players[frame.player];
    const index = player.railheads[0] === null ? 0 : 1;
    player.railheads[index] = action.city;
    player.startCities[index] = action.city;
    emit({ type: 'railheadPlaced', player: player.id, city: action.city, railhead: index });
    popFrame(state);
  },

  /** R3.4, R3.6(a). The chosen track loses the house of its "2" slot and starts at production 2. */
  chooseStartingProduction(state, frame, action) {
    const player = state.players[frame.player];
    player.houses[action.track] -= 1;
    emit({ type: 'startingProduction', player: player.id, track: action.track });
    popFrame(state);
  },

  /** R3.6(b). Free, into slot 1 of the level 1 carriage. */
  chooseStartingSpecialist(state, frame, action) {
    const player = state.players[frame.player];
    const where = nextSpecialistSlot(player);
    player.train.specialistCarriages[where.level - 1].slots[where.slot - 1] = action.specialist;
    state.supply.specialists[action.specialist] -= 1;
    emit({ type: 'hire', player: player.id, specialist: action.specialist, level: where.level, slot: where.slot, cause: 'setup' });
    popFrame(state);
  },

  /** R1.8. One resource per action; RESUME closes the decision when none is left to take. */
  chooseResource(state, frame, action) {
    frame.remaining -= 1;
    gainResource(state, frame.player, action.resource, 1, frame.reason);
  },

  /** R8.5.4. One item per action; RESUME closes the decision when storage is back at capacity. */
  discard(state, frame, action) {
    const player = state.players[frame.player];
    if (action.item in player.resources) player.resources[action.item] -= 1;
    else player.builtTiles[action.item] -= 1;
    emit({
      type: 'discard',
      player: player.id,
      item: action.item,
      used: storageUsed(player),
      capacity: storageCapacity(state, player.id),
    });
  },

  /** R5.3. */
  placeWorker(state, frame, action) {
    const player = state.players[frame.player];
    player.workersInSupply -= 1;
    state.grid.spaces[action.space] = player.id;
    state.turn.worker = { via: 'place', at: action.space };
    popFrame(state);
  },

  /** R5.5. */
  displaceWorker(state, frame, action) {
    const K = getConstants(state);
    const active = state.players[frame.player];
    const district = action.district;
    active.workersInSupply -= 1;
    state.grid.centres[district] = active.id;
    state.turn.worker = { via: 'displace', at: district };
    popFrame(state);

    // R5.5.2 - every worker on a worker space of the district goes home.
    const returned = {};
    for (const space of DISTRICT_SPACES[district]) {
      const owner = state.grid.spaces[space];
      state.grid.spaces[space] = null;
      state.players[owner].workersInSupply += 1;
      returned[owner] = (returned[owner] ?? 0) + 1;
      emit({ type: 'workerReturned', player: owner, space, by: active.id });
    }
    // R5.5.3 - 1 hat per returned worker; owners resolve in turn order from
    // the active player's left. A hat that does not fit (R14.1) becomes a
    // choice for that owner. The decisions are pushed in reverse so that the
    // first owner in turn order is asked first.
    const pending = [];
    for (const owner of playersAfter(state, active.id)) {
      if (!returned[owner]) continue;
      const owed = grantHats(state, owner, returned[owner] * K.HATS.displacementHatsPerWorker, 'displacement');
      if (owed > 0) pending.push({ kind: 'chooseResource', player: owner, remaining: owed, reason: 'hatLimit' });
    }
    for (let i = pending.length - 1; i >= 0; i--) pushFrame(state, pending[i]);
  },

  /** R5.4. */
  removeWorker(state, frame, action) {
    const player = state.players[frame.player];
    if (isSpaceId(action.from)) state.grid.spaces[action.from] = null;
    else state.grid.centres[action.from] = null;
    player.workersInSupply += 1;
    state.turn.worker = { via: 'remove', at: action.from };
    popFrame(state);
  },

  /** R4.2 step 3, R5.6, R14.2. Fixes the district and M for the rest of the turn. */
  chooseDistrict(state, frame, action) {
    const turn = state.turn;
    const player = state.players[frame.player];
    turn.district = action.district;
    if (action.district !== 'none') {
      if (action.hat) {
        player.hats -= 1;
        turn.hatSpent = true;
      }
      // R5.6.3 - the worker used this turn is never counted: a placed worker
      // is excluded by its location, a removed worker is already off the grid.
      const exclude = turn.worker.via === 'remove' ? null : turn.worker.at;
      const m = multiplierFor(state, player.id, action.district, action.hat, exclude);
      turn.multiplier = m.multiplier;
      turn.adjacent = m.adjacent;
      emit({
        type: 'districtChosen',
        player: player.id,
        district: action.district,
        tile: state.grid.tiles[action.district],
        multiplier: m.multiplier,
        adjacent: m.adjacent,
        hat: action.hat,
      });
    } else {
      emit({ type: 'districtChosen', player: player.id, district: 'none', tile: null, multiplier: null, adjacent: null, hat: false });
    }
    popFrame(state);
  },

  /** R7.5. */
  buyHat(state, frame) {
    const K = getConstants(state);
    const cause = bonusCause(frame, 'bonus:hat');
    if (!frame.free) pay(state, frame.player, K.BONUS_ACTIONS.hat.cost, cause);
    markBonusTaken(state, frame, 'hat');
    gainHats(state, frame.player, 1, cause);
  },

  /**
   * R7.6, R8.7. A new specialist carriage takes the next level and starts
   * empty. As the bonus action it is paid for; from an `addCarriage` frame
   * (Congress entry C4, cards) it is free.
   */
  addCarriage(state, frame, action) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    let cause;
    let via;
    if (frame.kind === 'bonusAction') {
      cause = bonusCause(frame, 'bonus:carriage');
      if (!frame.free) pay(state, player.id, K.BONUS_ACTIONS.carriage.cost, cause);
      markBonusTaken(state, frame, 'carriage');
      via = frame.free ? 'card' : 'bonusAction';
    } else {
      cause = frame.cause;
      via = 'card';
      popFrame(state);
    }
    performAddCarriage(state, player, action.carriage, cause);
    // R17.3 card 19: only the Add Carriage bonus action triggers it, not Congress C4 and not a card.
    fireTrigger(state, player.id, 'addCarriage', { via });
  },

  /** R7.4, R8.6. */
  hireSpecialist(state, frame, action) {
    const player = state.players[frame.player];
    // R8.6.4: a hire decision of a card is free or costs the table price without the 1-Coin fee; card 28 pays the table price.
    let mode;
    let cause;
    let via;
    if (frame.kind === 'hireSpecialist') {
      mode = frame.free ? 'free' : 'table';
      cause = frame.cause;
      via = 'card';
      frame.remaining -= 1;
    } else {
      mode = frame.free ? 'table' : 'bonusAction';
      cause = bonusCause(frame, 'bonus:hire');
      via = frame.free ? 'card' : 'bonusAction';
      markBonusTaken(state, frame, 'hire');
    }
    const price = hireCost(state, player.id, action.specialist, mode);
    const where = nextSpecialistSlot(player);
    if (Object.keys(price.cost).length > 0) pay(state, player.id, price.cost, cause);
    player.train.specialistCarriages[where.level - 1].slots[where.slot - 1] = action.specialist;
    state.supply.specialists[action.specialist] -= 1;
    emit({ type: 'hire', player: player.id, specialist: action.specialist, level: where.level, slot: where.slot, cause });
    // R17.3 card 18: only the Hire Specialist bonus action triggers it, not a hire made by a card.
    fireTrigger(state, player.id, 'hire', { via });
  },

  /** R7.1. Taking the bonus action is optional. */
  skipBonusAction(state) {
    popFrame(state);
  },

  // ----- Train activation (R9) and Lobby Congress (R10) ---------------------

  /** R9.4.3, R8.8. Pay the recipe, take 1 built tile into storage, count it for the activation. */
  useStep(state, frame) {
    const K = getConstants(state);
    const step = frame.steps[frame.index];
    const recipe = K.TRAIN.recipes[state.variants.conversionRate][step.type];
    pay(state, frame.player, recipe.cost, 'build');
    frame.built[recipe.output] += K.TRAIN.tilesPerUse;
    frame.index += 1;
    frame.congress = true; // R9.4.3 - after the step, the window for Congress entries
    emit({ type: 'build', player: frame.player, terrain: recipe.output, specialist: step.type, level: step.level, amount: K.TRAIN.tilesPerUse });
    gainBuiltTiles(state, frame.player, recipe.output, K.TRAIN.tilesPerUse, 'build'); // R9.4.3 - overflow is asked right after
  },

  /** R9.4.3. A skipped step cannot be taken later (R9.5). */
  skipStep(state, frame) {
    frame.index += 1;
    frame.congress = true;
  },

  /** R10.4. Lobby points, Coins, the senator slides down, then the benefit in full. */
  takeCongressEntry(state, frame, action) {
    const entry = congressTable(state).find((e) => e.id === action.entry);
    let coins = 0;
    let activation = frame;
    if (frame.kind === 'freeCongress') {
      // R17.3 card 20, R18.7 cards 13 and 24: no lobby points and no Coins.
      frame.remaining -= 1;
      activation = null;
      if (frame.activation) {
        activation = [...state.stack].reverse().find((f) => f.kind === 'trainActivation' && f.player === frame.player) ?? null;
        if (activation !== null) activation.freeEntryUsed = true; // once per train activation
      }
    } else {
      coins = congressCoinCost(state, frame.player, entry); // before `entries` counts this one (card 20)
      frame.lobby -= entry.tier;
      if (coins > 0) pay(state, frame.player, { coins }, `congress:${entry.id}`);
    }
    if (activation !== null) activation.entries += 1;
    if (!entry.reset) state.congress.used[entry.id] = true; // R10.2
    emit({ type: 'congressEntry', player: frame.player, entry: entry.id, tier: entry.tier, coins, text: entry.text, free: frame.kind === 'freeCongress' });
    // R17.3 card 20 acts on entries taken with lobby points inside an activation; its free frame goes UNDER the benefit's own decisions.
    if (frame.kind === 'trainActivation') hookCongressEntryTaken(state, frame.player, entry, frame);
    applyEffects(state, frame.player, entry.effects, { cause: `congress:${entry.id}`, vpSource: 'congress', rule: 'R10' });
  },

  /** R9.4.3. The window closes; lobby points not spent stay for later steps. */
  closeCongress(state, frame) {
    frame.congress = false;
  },

  /** R10.7. One tile per action; RESUME closes the decision when none is left to take. */
  chooseBuiltTile(state, frame, action) {
    frame.remaining -= 1;
    if (frame.distinct) frame.taken.push(action.terrain); // R18.7 card 4: two different types
    gainBuiltTiles(state, frame.player, action.terrain, 1, frame.cause);
  },

  /** R10.1 C6. Pops the choice, then carries out the chosen option (which may push its own decision). */
  chooseOption(state, frame, action) {
    const option = frame.options[action.option];
    popFrame(state);
    applyEffects(state, frame.player, option.effects, { cause: frame.cause, vpSource: frame.vpSource, rule: frame.rule });
  },

  // ----- Lay Tracks / Move Train (R11, R12) ---------------------------------

  /** R11.5. The eight steps of resolving a claim, in order. */
  claimRoute(state, frame, action) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    const route = MAP.routeById[action.route];
    const network = state.variants.claimFrom === 'network';
    const idx = claimRailheadIndex(state, frame, action.from);
    // The arrival city Y. In network mode there is none if both ends were already in the network (R11.11.4).
    let arrival;
    if (network) {
      const other = otherEnd(route, action.from);
      arrival = networkCities(state, player.id).includes(other) ? null : other;
    } else {
      arrival = otherEnd(route, action.from);
    }
    // R11.5.4 asks whether Y was connected BEFORE this claim.
    const wasConnected = arrival !== null && isCityConnected(state, arrival);
    if (frame.steps !== undefined) frame.steps -= 1;
    else frame.claimsLeft[idx] -= 1;
    frame.taken += 1;

    // R11.5.1 Pay. The tiles move from storage onto the route, which is now owned for good (R11.6).
    for (const t of K.TERRAINS) player.builtTiles[t] -= route.cost[t];
    state.map.routeOwner[route.id] = player.id;
    emit({ type: 'routeClaimed', player: player.id, route: route.id, from: action.from, to: arrival, slots: route.length, cost: { ...route.cost } });
    // R11.5.2 Track VP: 1 per slot, plus 2 more per slot of the scoring card's terrain (R11.9); both are `track` (R20.1).
    addVp(state, player.id, 'track', K.SCORING.vpPerSlot * route.length, 'R11.5.2');
    if (state.scoringCard !== null) {
      addVp(state, player.id, 'track', K.SCORING.scoringCardVpPerSlot * route.cost[state.scoringCard], 'R11.9');
    }
    // R11.5.3 Advance the railhead used from X to Y (railheads never move in network mode, R11.11.1).
    if (!network) player.railheads[idx] = arrival;
    const inland = arrival !== null && MAP.cityById[arrival].kind === 'inland';
    // R11.5.4 First connection (never at a start city, R11.2.4).
    if (inland && !wasConnected) {
      addVp(state, player.id, 'firstConnection', K.SCORING.firstConnectionVp, 'R11.5.4');
      emit({ type: 'firstConnection', player: player.id, city: arrival });
      hookFirstConnection(state, player.id, arrival, route);
    }
    // R11.5.5 Toll, R13.9: entering a city that holds another player's railway station.
    if (arrival !== null && hasOpponentRailwayStation(state, arrival, player.id)) {
      const owner = state.map.railwayStation[arrival];
      addVp(state, owner, 'toll', K.SCORING.tollVp, 'R13.9');
      tollBonus(state, owner);
      emit({ type: 'toll', player: owner, by: player.id, city: arrival });
    }
    // R11.5.6 Transcontinental check, R19.1, R19.7: only the first line of the game counts (R19.2).
    if (state.completion === null && hasTranscontinentalLine(state, player.id)) completeTranscontinental(state, player.id, route);
    // R11.5.8 The route's slots join the running totals of this action (R11.10).
    frame.totals.routes += 1;
    for (const t of K.TERRAINS) frame.totals.slots[t] += route.cost[t];
    // R11.5.7 Building: one, free, in the arrival city (R13.4). Pushed last, so it is asked first.
    if (arrival !== null) offerArrivalBuilding(state, player.id, arrival, {}, 'arrival');
  },

  /** R12.2 to R12.4. The path and the tolls are worked out for the player. */
  moveTrain(state, frame, action) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    const idx = moveRailheadIndex(state, frame, action.from);
    if (frame.steps !== undefined) frame.steps -= 1;
    else frame.movesLeft -= 1;
    frame.taken += 1;
    const path = moveTrainPath(state, player.id, action.from, action.to);
    // R12.3.2, R13.9 - each city entered that holds another player's railway station pays its owner, once per move.
    for (const city of path.tollCities) {
      const owner = state.map.railwayStation[city];
      addVp(state, owner, 'toll', K.SCORING.tollVp, 'R12.3');
      tollBonus(state, owner);
      emit({ type: 'toll', player: owner, by: player.id, city });
    }
    player.railheads[idx] = action.to;
    emit({ type: 'railheadMoved', player: player.id, from: action.from, to: action.to, cities: path.cities, routes: path.routes });
    // R12.4, R13.5 - on arrival, 2 Coins buy one building.
    offerArrivalBuilding(state, player.id, action.to, K.MAP_RULES.moveBuildCost, 'move');
  },

  /** R11.3. */
  stopLaying(state, frame) {
    endLayTracks(state, frame);
  },

  // ----- Buildings (R13) ------------------------------------------------------

  /** R13.2. The leftmost house of the chosen track leaves the player board and becomes the railway station. */
  placeRailwayStation(state, frame, action) {
    const player = state.players[frame.player];
    const via = frame.kind === 'layTracks' ? 'stationStep' : frame.cause;
    chargePlacement(state, frame, 'railwayStation');
    player.houses[action.houseTrack] -= 1; // R13.2.4 - production of that track rises by 1 at once (R6.2)
    state.map.railwayStation[action.city] = player.id;
    emit({ type: 'buildingPlaced', player: player.id, kind: 'railwayStation', city: action.city, houseTrack: action.houseTrack, cause: via });
    hookBuildingPlaced(state, player.id, 'railwayStation', action.city, via);
  },

  /** R13.3. The leftmost telegraph station of the row scores the VP printed on the slot it leaves. */
  placeTelegraphStation(state, frame, action) {
    const player = state.players[frame.player];
    const via = frame.kind === 'layTracks' ? 'stationStep' : frame.cause;
    chargePlacement(state, frame, 'telegraphStation');
    const vp = nextTelegraphVp(state, player.id);
    player.telegraphsPlaced += 1;
    state.map.telegraphStation[action.city] = player.id;
    addVp(state, player.id, 'telegraph', vp, 'R13.3');
    // R18.7 card 34: the telegraph row VP are doubled. The base VP stay in `telegraph`; the extra is `ponyCards` (R20.1).
    const doubling = ponyModifier(state, player.id, 'telegraphRowVpMultiplier');
    if (doubling !== null && doubling.value > 1) addVp(state, player.id, 'ponyCards', vp * (doubling.value - 1), 'R18.7 card 34');
    emit({ type: 'buildingPlaced', player: player.id, kind: 'telegraphStation', city: action.city, vp, cause: via });
    hookBuildingPlaced(state, player.id, 'telegraphStation', action.city, via);
  },

  /** R13.4 to R13.6. */
  skipBuilding(state) {
    popFrame(state);
  },

  // ----- The add-on modules -------------------------------------------------

  /** R7.3, R15.3, R15.4, R15.6. Pay 1 Iron, take the tile from the display, install it for good. */
  installUpgrade(state, frame, action) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    const tile = upgradeTileData(state, action.tile);
    const cause = bonusCause(frame, 'bonus:upgrade');
    if (!frame.free) pay(state, player.id, K.BONUS_ACTIONS.upgrade.cost, cause);
    markBonusTaken(state, frame, 'upgrade');
    const m = state.modules.upgrades;
    m.display.splice(m.display.indexOf(tile.id), 1);
    m.installed[player.id][action.level - 1] = tile.id;
    emit({ type: 'upgradeInstalled', player: player.id, tile: tile.id, level: action.level, cause });
    // R15.6: with `on-install` the three VP tiles score once, now, and never again.
    if (tile.vpTile && state.variants.upgradeVpTiming === 'on-install') {
      applyEffects(state, player.id, tile.effects, { cause: `upgrade:${tile.id}`, vpSource: 'upgrades', rule: 'R15.6' });
    }
  },

  /** R18.5. Pay the tokens, take the card, refill its place from the same deck, resolve it by its kind (R18.6). */
  buyPonyCard(state, frame, action) {
    const K = getConstants(state);
    const m = state.modules.pony;
    const mine = m.players[frame.player];
    const card = ponyCardData(state, action.card);
    const cost = K.PONY.costs[card.rank];
    mine.tokensHeld -= cost; // R18.5.2: the tokens go back to the box
    m.turn.purchases += 1;
    const slot = m.market[card.rank].indexOf(card.id);
    const refill = m.decks[card.rank].length > 0 ? m.decks[card.rank].pop() : null; // R18.5.4
    m.market[card.rank][slot] = refill;
    emit({ type: 'ponyCardBought', player: frame.player, card: card.id, rank: card.rank, kind: card.kind, cost });
    if (refill !== null) emit({ type: 'ponyMarketRefill', rank: card.rank, card: refill });
    if (card.kind === 'ongoing') {
      mine.ongoing.push(card.id);
    } else if (card.kind === 'endgame') {
      mine.endgame.push(card.id);
    } else {
      resolveImmediateCard(state, frame.player, card);
    }
  },

  /** R18.4. A token goes back to the box; 1 resource of the player's choice into storage. */
  exchangeToken(state, frame, action) {
    state.modules.pony.players[frame.player].tokensHeld -= 1;
    emit({ type: 'tokenExchanged', player: frame.player, resource: action.resource });
    gainResource(state, frame.player, action.resource, getConstants(state).PONY.resourcesPerToken, 'pony:token'); // R18.4: the number is rules.js's
  },

  /** R18.8. The ability is used up for this turn (or round); its effect then happens. */
  usePonyCard(state, frame, action) {
    const m = state.modules.pony;
    const card = ponyCardData(state, action.card);
    const ability = ponyAbilities(state, frame.player).find((a) => a.card.id === card.id);
    (state.variants.turnStructure === 'rounds' ? m.roundUsed : m.turn.usedCards).push(card.id);
    emit({ type: 'ponyCardUsed', player: frame.player, card: card.id });
    runEffect(state, frame.player, ability.effect.effect, {
      cause: `pony:${card.id}`,
      vpSource: 'ponyCards',
      rule: `R18.8 card ${card.number}`,
    });
  },

  /** R4.4. */
  endFreeActions(state) {
    popFrame(state);
  },

  /** R18.7. Declines the optional part of an effect that is being asked (see getSkipEffectBlockReason). */
  skipEffect(state, frame) {
    if (frame.kind === 'exchange') finishExchange(state, frame);
    else popFrame(state);
  },

  /** R18.7 card 11. Gives back 1 resource; the same number is taken in its place when the player stops. */
  returnResource(state, frame, action) {
    state.players[frame.player].resources[action.resource] -= 1;
    frame.returned += 1;
    emit({ type: 'resourceReturned', player: frame.player, resource: action.resource, cause: frame.cause });
  },

  /** R9.2, R18.7. The Foreman's type for this activation. */
  chooseForemanType(state, frame, action) {
    popFrame(state);
    emit({ type: 'foremanType', player: frame.player, specialist: action.specialist, cause: frame.cause });
    continueActivation(state, frame.player, action.specialist, frame.foremanTimes, frame.cause);
  },

  /** R18.7 card 33. */
  chooseSpecialistType(state, frame, action) {
    popFrame(state);
    state.modules.pony.turn.doubled = action.specialist;
    emit({ type: 'activationsDoubled', player: frame.player, specialist: action.specialist, cause: frame.cause });
  },

  /** R18.7 card 15. The step list is built now, with one extra activation for the chosen specialist. */
  chooseExtraActivation(state, frame, action) {
    popFrame(state);
    emit({ type: 'extraActivation', player: frame.player, level: action.level, slot: action.slot, count: frame.count, cause: frame.cause });
    pushTrainActivation(state, frame.player, frame.foreman, frame.foremanTimes, frame.cause, {
      level: action.level,
      slot: action.slot,
      count: frame.count,
    });
  },

  /** R17.3 card 20. */
  declineFreeEntry(state) {
    popFrame(state);
  },
};

/** R18.6. An immediate card: its whole effect now, then it is discarded. Card 9 lets the player order its two parts (`order: 'any'`). */
function resolveImmediateCard(state, playerId, card) {
  const ctx = { cause: `pony:${card.id}`, vpSource: 'ponyCards', rule: `R18.7 card ${card.number}` };
  if (card.order === 'any') {
    const K = getConstants(state);
    const feasible = card.effects.map((e) => cardPartFeasible(state, playerId, card, e));
    // R8.6.1: a new specialist carriage has free slots, so a hire that is impossible now stays in play while one can be added.
    const canGrow = state.players[playerId].train.specialistCarriages.length < K.TRAIN.maxSpecialistCarriages;
    const parts = card.effects.filter((e, i) => feasible[i] || (e.type === 'hire' && feasible.some(Boolean) && canGrow));
    if (parts.length >= 2) {
      const options = [parts, parts.slice().reverse()].map((list) => ({
        text: list.map((e) => describeEffect(K, e)).join(', then '),
        effects: copyData(list),
      }));
      pushFrame(state, { kind: 'chooseOption', player: playerId, options, cause: ctx.cause, vpSource: ctx.vpSource, rule: ctx.rule });
      return;
    }
    applyEffects(state, playerId, parts, ctx);
    return;
  }
  applyEffects(state, playerId, card.effects, ctx);
}

/** R18.7 card 11. Stops giving resources back: the same number are taken in their place. */
function finishExchange(state, frame) {
  popFrame(state);
  if (frame.returned > 0) pushFrame(state, { kind: 'chooseResource', player: frame.player, remaining: frame.returned, reason: frame.cause });
}

// ---------------------------------------------------------------------------
// RESUME: what a pending decision does by itself when it is on top.
// (state, frame) => true if it changed something, false if it waits for an action.
// ---------------------------------------------------------------------------

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
  bonusAction(state, frame) {
    if (frame.remaining > 0) return false;
    popFrame(state);
    return true;
  },
  /**
   * R9.4. Does everything in an activation that is not a decision: Financier
   * steps ("no cost and no choice", R9.4.3), the upgrade-tile step, closing a
   * Congress window nobody can use, and the end of the list. Waits (returns
   * false) at a Crew, Miner or Engineer step, and at an open Congress window.
   */
  trainActivation(state, frame) {
    const K = getConstants(state);
    if (frame.congress) {
      // R9.4.3, R9.4.4 - the window is a real question only if some entry can be taken.
      if (frame.lobby >= 1) {
        for (const entry of congressTable(state)) {
          if (getTakeCongressEntryBlockReason(state, frame.player, entry.id) === null) return false;
        }
      }
      frame.congress = false;
      return true;
    }
    if (frame.index >= frame.steps.length) {
      finishActivation(state, frame);
      return true;
    }
    const step = frame.steps[frame.index];
    if (step.type === 'financier') {
      // R9.4.3, R10.3 - a Financier step adds a lobby point; there is no choice.
      frame.lobby += K.CONGRESS.lobbyPointsPerFinancierStep;
      emit({ type: 'lobbyPoint', player: frame.player, total: frame.lobby, level: step.level });
      frame.index += 1;
      frame.congress = true;
      return true;
    }
    if (step.type === 'upgrade') {
      hookUpgradeStep(state, frame, step);
      frame.index += 1;
      frame.congress = true;
      return true;
    }
    return false; // a Crew, Miner or Engineer step: use or skip
  },
  /** R10.7. */
  chooseBuiltTile(state, frame) {
    if (frame.remaining > 0) return false;
    popFrame(state);
    return true;
  },
  /** R4.4. The opportunity ends by itself once nothing is left to do in it (the player may still end it earlier). */
  freeActions(state, frame) {
    if (hasFreeAction(state, frame.player)) return false;
    popFrame(state);
    return true;
  },
  /** R8.6.4. Closes when the hires are made, or when none can be made any more. */
  hireSpecialist(state, frame) {
    if (frame.remaining > 0 && FRAMES.hireSpecialist.list(state, frame).some((a) => a.type === 'hireSpecialist')) return false;
    popFrame(state);
    return true;
  },
  /** R18.7 card 9. An optional carriage that cannot be added any more is simply over. */
  addCarriage(state, frame) {
    if (!frame.optional || FRAMES.addCarriage.list(state, frame).some((a) => a.type === 'addCarriage')) return false;
    popFrame(state);
    return true;
  },
  /** R18.7 card 11. Closes when the most is given back or no resource is left to give. */
  exchange(state, frame) {
    const K = getConstants(state);
    const player = state.players[frame.player];
    if (frame.returned < frame.max && K.RESOURCES.some((r) => player.resources[r] > 0)) return false;
    finishExchange(state, frame);
    return true;
  },
  /** R17.3 card 20, R18.7 cards 13 and 24. Closes when the entries are taken or none is left to take. */
  freeCongress(state, frame) {
    if (frame.remaining > 0 && FRAMES.freeCongress.list(state, frame).some((a) => a.type === 'takeCongressEntry')) return false;
    popFrame(state);
    return true;
  },
  /** R13.4 to R13.6. Closes when the occasion has no building left to give. */
  placeBuildings(state, frame) {
    if (frame.left > 0) return false;
    popFrame(state);
    return true;
  },
  /** R11.3. Closes when the action has no step left. */
  layTracks(state, frame) {
    const done = frame.steps !== undefined ? frame.steps <= 0 : frame.claimsLeft.every((n) => n <= 0) && frame.movesLeft <= 0;
    if (!done) return false;
    endLayTracks(state, frame);
    return true;
  },
};

// ---------------------------------------------------------------------------
// Resolving a district action (R4.2 step 4)
// ---------------------------------------------------------------------------
//
// One entry per district family that is implemented.
//   resolve(state)   - does the action, or pushes the decisions that do it.
//   followUp(state)  - optional; runs when everything `resolve` started is done.
//
// THIS TABLE MUST HAVE THE SAME KEYS AS `DISTRICT_ACTION_RULES` IN legality.js.
//
// To add a family, see docs/engine-contract.md section 19.

export const DISTRICT_RESOLVERS = {
  /** R9.1, R9.2, R5.6.4. The Foreman takes the district's type and is activated M times. */
  trainActivation: {
    resolve(state) {
      const turn = state.turn;
      beginActivation(state, turn.player, districtInfo(state, turn.district).foremanType, turn.multiplier, 'district');
    },
  },
  /** R11.3, R5.6.4. M steps, each a claim or a move. */
  layTracks: {
    resolve(state) {
      const turn = state.turn;
      pushLayTracks(state, turn.player, turn.multiplier);
    },
  },
  gather: {
    /** R6.3. Yield = production x M. */
    resolve(state) {
      const turn = state.turn;
      const info = districtInfo(state, turn.district);
      const p = production(state, turn.player, info.gathers);
      const amount = p * turn.multiplier;
      emit({
        type: 'gather',
        player: turn.player,
        district: turn.district,
        item: info.gathers,
        production: p,
        multiplier: turn.multiplier,
        amount,
      });
      // R6.5 - Coins are simply added; resources go to storage and obey its limit.
      if (info.gathers === 'coins') gainCoins(state, turn.player, amount, 'gather');
      else gainResource(state, turn.player, info.gathers, amount, 'gather');
      // R6.4 - Legislative Agenda cards 11 to 14 and Pony Express card 21 add after multiplying.
      hookGatherBonus(state, turn.player, info.gathers);
    },
    /** R6.6, R7.1, R7.2. The printed bonus action, after the yield is in storage. */
    followUp(state) {
      const turn = state.turn;
      const bonus = districtInfo(state, turn.district).bonusAction;
      if (!bonus || !isBonusActionAvailable(state, bonus)) return;
      const limit = state.variants.bonusActionLimit;
      if (limit === 'once-per-game' && state.players[turn.player].bonusActionsUsed[bonus]) return;
      const remaining = limit === 'multiplied' ? turn.multiplier : 1;
      pushFrame(state, { kind: 'bonusAction', player: turn.player, bonus, remaining });
    },
  },
};

// ---------------------------------------------------------------------------
// The flow of setup (R3.5 to R3.9)
// ---------------------------------------------------------------------------

function runSetupFlow(state) {
  const K = getConstants(state);
  const setup = state.setup;
  const n = state.players.length;
  switch (setup.step) {
    // R3.5.1 - first railheads, in reverse seat order.
    case 'railheadFirst':
      if (setup.index >= 0) {
        pushFrame(state, { kind: 'setupRailhead', player: setup.index });
        setup.index -= 1;
      } else {
        setup.step = 'railheadSecond';
        setup.index = 0;
      }
      return;
    // R3.5.2 - second railheads, in seat order.
    case 'railheadSecond':
      if (setup.index < n) {
        pushFrame(state, { kind: 'setupRailhead', player: setup.index });
        setup.index += 1;
      } else {
        setup.step = 'choices';
        setup.index = 0;
        setup.part = 'production';
      }
      return;
    // R3.6 - in seat order, each player makes both starting choices.
    case 'choices':
      if (setup.index >= n) {
        setup.step = 'compensation';
        setup.index = 0;
        setup.part = null;
      } else if (setup.part === 'production') {
        pushFrame(state, { kind: 'setupProduction', player: setup.index });
        setup.part = 'specialist';
      } else {
        pushFrame(state, { kind: 'setupSpecialist', player: setup.index });
        setup.part = 'production';
        setup.index += 1;
      }
      return;
    // R3.7 - start-player compensation, in seat order.
    case 'compensation':
      if (setup.index < n) {
        const amount =
          state.variants.startCompensation === 'graduated' ? (K.SETUP.graduatedCompensation[setup.index] ?? 0) : 0;
        if (amount > 0) {
          pushFrame(state, { kind: 'chooseResource', player: setup.index, remaining: amount, reason: 'startCompensation' });
        }
        setup.index += 1;
      } else {
        // R3.9 - the start player takes the first turn.
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
// The flow of a turn (R4.2)
// ---------------------------------------------------------------------------

function districtResolver(state) {
  const district = state.turn.district;
  if (district === null || district === 'none') return null; // R5.4.4: no district action this turn
  return DISTRICT_RESOLVERS[districtInfo(state, district).family] ?? null;
}

/**
 * R4.2 steps 1 and 5, R4.4. `which` is 'before' or 'after' the district action.
 * Free actions exist only when a module provides them: with Pony Express on,
 * the opportunity is a `freeActions` decision, and it is offered only when
 * the player has a free action to take. Otherwise the engine does not ask.
 */
function offerFreeActions(state, which) {
  if (state.modules.pony === undefined) return;
  const player = state.turn.player;
  if (hasFreeAction(state, player)) pushFrame(state, { kind: 'freeActions', player, which });
}

/** R19.2 to R19.4, R19.8. Marks the end as triggered; play goes on until the round is complete (R19.5, R4.8.4). */
function triggerGameEnd(state, reason) {
  state.gameEnd = { reason, triggeredBy: state.turn.player, triggeredOnTurn: state.turn.number };
  emit({ type: 'gameEndTriggered', reason, player: state.turn.player, turn: state.turn.number });
}

/** R19.5, R4.8.4, R20.2. */
function finishGame(state) {
  state.phase = 'ended';
  state.stack.length = 0;
  state.toAct = null;
  state.turn.player = null;
  state.turn.step = null;
  applyFinalScoring(state);
  if (eventsOn()) {
    const score = scoreGame(state);
    emit({
      type: 'gameOver',
      reason: state.gameEnd.reason,
      winner: score.winner,
      ranking: score.ranking,
      totals: score.players.map((p) => p.total),
    });
  }
}

/**
 * R4.8.3. Every worker on the grid returns to its owner's supply and the start
 * player marker passes one seat clockwise (`rounds` only).
 */
function endRound(state) {
  const K = getConstants(state);
  const n = state.players.length;
  for (const space in state.grid.spaces) state.grid.spaces[space] = null;
  for (const district in state.grid.centres) state.grid.centres[district] = null;
  for (const p of state.players) p.workersInSupply = K.SETUP.workersByPlayerCount[n];
  state.startPlayer = (state.startPlayer + 1) % n;
  // R4.8.5, R18.8: "once per round" starts again.
  if (state.modules.pony !== undefined) state.modules.pony.roundUsed = [];
  emit({ type: 'roundEnd', startPlayer: state.startPlayer });
}

/**
 * R4.8. Who plays next with `turnStructure = rounds`: the next player clockwise
 * with a worker in supply (R4.8.2). When nobody has one the round is over
 * (R4.8.3): the game ends if it was triggered during the round (R4.8.4),
 * else the workers return and the new start player begins.
 */
function passTurnRounds(state, player) {
  const turn = state.turn;
  if (state.players.every((p) => p.workersInSupply === 0)) {
    if (state.gameEnd !== null) {
      finishGame(state);
      return;
    }
    endRound(state);
    state.turn = newTurn(turn.number + 1, state.startPlayer);
    return;
  }
  let next = nextPlayerId(state, player.id);
  while (state.players[next].workersInSupply === 0) next = nextPlayerId(state, next);
  state.turn = newTurn(turn.number + 1, next);
}

/** R4.2 step 6. */
function endTurn(state) {
  const turn = state.turn;
  const player = state.players[turn.player];
  const n = state.players.length;
  player.turnsTaken += 1;

  hookMilestones(state); // R16.9, before the end triggers

  if (state.gameEnd === null) {
    const v = state.variants;
    // R19.3 - the map fills up.
    if (v.endRoutesPerPlayer > 0 && claimedRouteCount(state) >= v.endRoutesPerPlayer * n) {
      triggerGameEnd(state, 'routes-claimed');
    }
    // R19.4 - the digital turn limit.
    else if (v.maxTurnsPerPlayer > 0 && player.turnsTaken >= v.maxTurnsPerPlayer) {
      triggerGameEnd(state, 'turn-limit');
    }
    // R19.2 triggers 'transcontinental' at the moment of the claim (completeTranscontinental), not here.
  }
  // R4.2 step 6: the milestone check and the end triggers belong to the turn, so `turnEnd` comes after them
  // and is the last event of the turn (before the round end, final scoring or the next `turnStart`).
  emit({ type: 'turnEnd', player: player.id, turn: turn.number });

  if (state.variants.turnStructure === 'rounds') {
    passTurnRounds(state, player);
    return;
  }
  // R19.5 - once triggered, the game ends after the turn of the player in the last seat.
  if (state.gameEnd !== null && player.id === lastSeatId(state)) {
    finishGame(state);
  } else {
    state.turn = newTurn(turn.number + 1, nextPlayerId(state, player.id));
  }
}

function runPlayFlow(state) {
  const turn = state.turn;
  switch (turn.step) {
    case 'start': {
      // R14.2 - only hats held now can be spent at step 3 of this turn.
      turn.hatsAtStart = state.players[turn.player].hats;
      emit({ type: 'turnStart', player: turn.player, turn: turn.number });
      hookTurnStart(state);
      turn.step = 'freeBefore';
      offerFreeActions(state, 'before');
      return;
    }
    case 'freeBefore':
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
      turn.step = 'freeAfter';
      offerFreeActions(state, 'after');
      return;
    case 'freeAfter':
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
 * choice, so the engine applies that action itself (its `action` event has
 * `auto: true`).
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
 * game forward to the next real choice (or the end).
 *
 * - Changes `state` in place.
 * - Throws an Error with `code: 'ILLEGAL_ACTION'` and `reason` (the sentence
 *   from getBlockReason) if the action is not legal. In that case the state
 *   is untouched.
 * - Returns the events of this action and of everything that followed from
 *   it automatically, in order; or null when called with `{ events: false }`.
 *
 * @param {object} state
 * @param {object} action one of getValidActions(state), or an equal object
 * @param {{ events?: boolean }} [options] pass SILENT to skip event collection
 * @returns {object[]|null}
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
    // The sink must be closed even if the engine itself fails.
    events = closeEventSink();
  }
  return events;
}
