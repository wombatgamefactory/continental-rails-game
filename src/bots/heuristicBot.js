// heuristicBot.js - the heuristic bot: Medium as it stands, Easy with noise on
// top (src/bots/index.js), and a cheaper `rolloutPolicy` for tree search.
//
// HOW IT PLAYS
//
// Every decision is one atomic action from getValidActions(state), so the bot
// cannot score "a turn". Instead, at every decision it works out the same
// short plan again FROM THE STATE ALONE and scores each legal action by how
// far it carries that plan, in one currency: victory points, or the share of
// a future VP gain that the action secures ("VP-equivalents").
//
//   1. Map analysis (memoised per state object and route ownership): for every
//      player the cheapest way to finish a west-to-east crossing of their OWN
//      routes, which cities are joined by claimed track, who owns what.
//   2. Horizon: how many more turns this player can expect, from the end
//      triggers (routes claimed, somebody's crossing, the turn limit).
//   3. Targets: every unclaimed route a railhead could claim (at once, or after
//      a Move Train step) is valued - track VP, first connection, the building
//      it lets the player place, its share of the completion bonus, milestone
//      progress, what it denies a rival - and divided by the effort still
//      needed (missing built tiles, missing resources, a move). The best is
//      target 1, the best follow-up target 2.
//   4. Turns to go: for each target, how many more turns it needs with what is
//      in storage now (`turnsToClaim`: Gathers for the missing resources under
//      the conversion rate in play, train activations for the missing tiles
//      given the Foreman and the specialists, then the claim).
//   5. Each action is scored by the value it adds. Whatever changes storage
//      is scored by `phi`: the target's value times the share of its remaining
//      turns that the change saves. So a Gather that completes the resources
//      of a target three turns away is worth a third of the target, the
//      activation that then builds its tiles half of it, and the claim all of
//      it. Units beyond both targets are worth little, units that would
//      overflow storage nothing. A train activation is walked step by step
//      (build only what gains, lobby points into the best Congress entries,
//      upgrade tiles as they fire); Lay Tracks by the claims it could make; an
//      investment (specialist, carriage, upgrade tile, card) by its use over
//      the turns that are left.
//
// The collect -> build -> lay rhythm is not scripted: it falls out of the
// turns-to-go. Once the resources for the targets are in storage a Gather
// saves no turn and a train district does; once the tiles are built, only
// Lay Tracks does.
//
// HOW THE WEIGHTS WERE TUNED. `tests/tmp/ab.mjs`-style duels: the baseline
// against itself with one weight changed, seats alternated, 300 games at 2
// players and 300 at 4 (standard error about 2.9 points). "A/B 52/55" in a
// comment means the changed bot won 52% at 2 players and 55% at 4. A first
// version shared a target's value out per UNIT (40% when the resource was in
// storage, 75% when the tile was built); it was dropped because a player with
// the "gain 2 VP" upgrade tile then preferred an empty activation (2 VP) to
// gathering one missing resource (worth 1) for the whole game.
//
// THE FOUR ANTI-LIVELOCK GUARDS (web-board-game skill, "AI Bots")
//   (a) the bot always returns an action from getValidActions;
//   (b) it never proposes anything else, so the engine cannot refuse it;
//   (c) `repeatGuard` (exported) refuses a Move Train that recreates a recent
//       railhead layout with no progress in between; its memory is a WeakMap
//       keyed on the state object, never a field of the state;
//   (d) a scorer returns null for an action it cannot evaluate; such actions
//       rank below every scored one and are used only when nothing else is.
//
// PURITY. No clock, no random numbers but the `rng` handed in, no output, no storage. The bot never
// changes the state. Apart from the guard's WeakMap and a memo of the map
// analysis (a pure function of route ownership), nothing is remembered
// between decisions, so the policy can be called on cloned states in any
// order (tree search) and for many games in one process (the simulator).
//
// TERMINOLOGY. `house` is only ever the production multiplier on the player
// board; map buildings are `railwayStation` and `telegraphStation`; grid
// locations are `district`; the metal is `iron`. Built tiles (in storage) and
// laid tiles (on the map) are never confused: `useStep` builds, `claimRoute`
// lays.

import {
  getValidActions,
  getConstants,
  topFrame,
  rngNext,
  rngInt,
  MAP,
  SPACE_DISTRICTS,
  DISTRICT_SPACES,
  DISTRICT_NEIGHBOURS,
  DISTRICT_IDS,
  SPACE_IDS,
  isDistrictId,
  districtInfo,
  production,
  storageCapacity,
  nextSpecialistSlot,
  hireCost,
  multiplierFor,
  activationTile,
  standingEffects,
  cardIndex,
  congressTable,
  congressCoinCost,
  buildingTableVp,
  networkCities,
  metricValue,
  junctionCities,
} from '../engine/index.js';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
//
// ONE object. `context.weights` overrides any entry for one bot (archetype
// bots in the simulator: the baseline with one family multiplied through its
// `bias...` entry). Values are in VP-equivalents unless a comment says
// otherwise. Where a value was tuned, the comment gives the measurement;
// "T" figures are 4-player Medium tables on default variants unless stated.

export const HEURISTIC_WEIGHTS = {
  // --- the turn model behind every "how far is this target" estimate (turnsToClaim)
  /** Typical multiplier of a Gather, and tiles a Foreman builds in one activation. */
  avgM: 1.4,
  avgForeman: 1.4,
  /** A Gather for a missing resource costs its share of a turn plus this (a turn is a turn, however little is missing). */
  turnRound: 0.5,
  /** Each missing built tile adds this to the count of whole activations, so that building one tile of two is progress. */
  tileRound: 0.15,
  /** Progress on target 2 counts for this fraction of its value. A/B: 0.3 gave 46/42, 0.9 gave 50/52; kept. */
  secondDiscount: 0.6,
  /** A built tile beyond both targets (falling for each further spare). */
  tileSurplus: 0.5,
  /** A resource beyond both targets. */
  resSurplus: 0.2,
  /** A resource of the player's choice gained later (cards that pay in resources). */
  resGeneric: 0.8,
  /** Each unit that would not fit in storage (R8.5.4) counts against the action. */
  overflowPenalty: 0.15,
  /** A step is used only if building beats keeping the resources by this much. */
  buildFloor: 0.02,

  // --- choosing the targets
  /** Turns a Move Train step adds to a claim. */
  moveEffort: 0.7,
  /** Added to every claim: laying now beats holding tiles (a rival may take the route; storage is freed). A/B: 0 gave 51/49, 3 gave 48/48: it hardly matters, because a claim is already worth the whole route. */
  layUrgency: 1.0,
  /** Cost of the Move Train step that a claim needs first. A/B: 1.5 gave 51/48. */
  moveCost: 0.4,
  /** A move that only positions a railhead for target 1 (times how much of the target is already built). */
  movePosition: 1.2,
  /** A move with nothing behind it. Negative, so it loses to `stopLaying`. */
  moveBase: -0.3,
  /** Share of the best claim at the destination credited to a move that leaves no step to make it. */
  moveSetupFrac: 0.3,
  /** Choosing Lay Tracks with nothing to claim and nowhere useful to go. */
  layNothing: -0.6,
  /** Arriving in a city with no unclaimed route left strands the railhead (R11.8). */
  deadEnd: 1.0,
  /** Each unclaimed route at the arrival city (up to 2) keeps options open. */
  frontier: 0.3,
  /** VP an opponent gets from a toll, as a loss to this player (R13.9). */
  tollGiven: 0.5,

  // --- the transcontinental line (R19.2)
  /** Typical length of the route that completes a crossing (for the 3 VP per slot). */
  crossLastRoute: 3,
  /** How much of the expected completion bonus is credited to the slots on the cheapest own crossing. A/B: 1.2 gave 45/49; `biasCrossing` 0.5 gave 48/38 and 1.6 gave 51/51. */
  crossWeight: 0.8,
  /** Softness of "who gets there first", in turns. */
  crossTemp: 4,
  /** Prior on being the one who completes it, before any evidence. */
  crossConfidence: 0.7,
  /** A route on a rival's cheapest crossing, when the rival is within this many slots of finishing. */
  blockRange: 7,
  /** A/B: 0 gave 51/49 and 12 gave 51/49. No measurable effect; kept small. */
  blockValue: 6,

  // --- the horizon
  /** Prior on routes claimed per player-turn, and how many player-turns of evidence it is worth. */
  claimRatePrior: 0.22,
  claimRatePriorTurns: 12,
  /** Prior on slots laid per turn by one player, and its weight in turns. */
  slotRatePrior: 0.6,
  slotRatePriorTurns: 8,
  /** A crossing takes this much longer than slots / rate suggests. */
  crossSlack: 1.25,
  /** A target needing `e` turns counts in full when turnsLeft - e + feasSlack reaches feasWidth, and not at all at 0 (the horizon is an estimate). */
  feasSlack: 2.5,
  feasWidth: 1.5,
  /** Investments are valued over at most this many turns. */
  horizonCap: 30,
  /** Share of a player's turns that are train activations / gathers (for valuing engine pieces). */
  actRate: 0.33,
  gatherRate: 0.4,
  coinGatherRate: 0.07,

  // --- the engine: specialists, carriages, upgrade tiles
  /**
   * Value of one extra builder step in one activation, when its tile is in demand. A/B: 0.6 gave 47/48.
   * The whole engine family is NOT undervalued at this game length (about 26 turns): `biasEngine` 2 gave
   * 36/34, 0.5 gave 50/56, 0.25 gave 52/55, 0 gave 50/52. Storage and specialist carriages were cut after that.
   */
  specUse: 1.2,
  /** Value of one lobby point per activation. */
  finUse: 0.8,
  /** Each specialist of a type already in the train divides the value of the next by 1 + this. */
  specDim: 0.6,
  /** Storage carriages: the second (capacity 9 -> 18), the third, both fading out over `investHorizon` turns. Was 7; A/B: 12 gave 35/39, 3 gave 52/54. */
  storageSecond: 4,
  storageThird: 2,
  /** A specialist carriage when every slot is full (a quarter of it otherwise). Was 5; A/B: 2 gave 51/51. */
  specCarriage: 3,
  investHorizon: 12,
  /**
   * What the VP of a "gain N VP" upgrade tile count for when a DISTRICT is chosen, as a share of face value.
   * The VP are real, but they ride on activations the train makes anyway; a turn spent on an activation that
   * builds nothing gives up a turn of the collect -> build -> lay loop, which the step-by-step scores above
   * understate. (Installing the tile is valued at face value times the activations expected: `upgradeValue`.)
   */
  actVpNow: 0.5,
  // (A/B of actVpNow: 1 gave 44/48, 0.3 gave 48/51, 0 gave 48/53: little effect once scores were turn-based.)
  /** Share of the face value (VP x activations expected) at which a "gain N VP" tile is valued when installing. */
  upgradeVp: 1,
  /** One unit per activation from a resource / coin / hat upgrade tile. */
  upgradeRes: 0.8,
  upgradeCoin: 0.6,
  /**
   * A hat per activation (the "Action Token" tiles). Was 1.0, then 2.0 (A/B against 1.0: 58/55), now 3.0 (A/B
   * against 2.0: 57 at 2 players, 55 at 3). At 2.0 it tied exactly with the 2 VP tile and the first player took
   * the VP tile; whoever was left the hat tile then won 76% of 2-player and 57% of 3-player games (400 each).
   */
  upgradeHat: 3.0,
  /** One built tile per activation (the level 3 production tiles). */
  upgradeTile: 2.2,
  /** Tiles a "1 VP per tile built" tile is expected to count per activation. */
  upgradePerBuilt: 1.0,
  /** Installing a tile in a carriage above its level wastes the better slot, per level. */
  slotWaste: 1.5,

  // --- coins and hats
  /** Coins the bot likes to hold; more when it has a specialist slot to fill or Financiers to feed. */
  coinBuffer: 2,
  coinNeeded: 0.9,
  coinSurplus: 0.15,
  /** A cowboy hat in hand; spent when +1 M is worth more than this. */
  /** A/B: 0.8 gave 47/49, 2.5 gave 48/49. */
  hatValue: 1.5,
  /** A hat is worth this fraction when the player is at the limit (the next gain would be a resource anyway). */
  hatFullDiscount: 0.6,

  // --- buildings (R13)
  /** Value of one more resource per Gather, per expected Gather of that track. Was 0.7; A/B: 0.35 gave 44/34, 1.2 gave 51/54. */
  prodUnit: 1.0,
  /** Placing a telegraph station brings the dearer slots of the row nearer. A/B: 3 gave 43/36 (railway stations early are better). */
  telegraphUnlock: 1.5,
  /** Tolls expected from a railway station in a 5-route city over a long game. A/B: 0.1 gave 48/44. */
  tollExpect: 0.4,

  // --- the worker grid (R5)
  /** A worker left on the grid adds +1 M to its districts later: value per unit of how much those districts are wanted. A/B: 0.2 gave 49/48, 1.0 gave 47/50. */
  posPlace: 0.5,
  /** The same adjacency lost by a Remove. */
  posRemove: 0.35,
  posGather: 2.0,
  posTrain: 2.0,
  posLobby: 0.5,
  posLay: 0.6,
  posCoins: 0.3,
  /** Each worker a displacement sends home gives its owner a hat (R5.5.3). */
  displaceGift: 0.5,
  /** What a turn is normally worth: a displacement commits a later turn to the same district (R5.4.1, R5.4.3). A/B: 1 gave 50/46, 6 gave 50/45. */
  forcedTurn: 3,

  // --- Congress (R10)
  /** An entry outside the best set for the lobby points of this activation. */
  congressOffPlan: -1,

  // --- milestones, goals, Pony Express
  /** A step towards a goal in play (R16.5), per unit of its measure. */
  goalStep: 1.5,
  /** A Pony Express token in hand (1 VP at the end, R18.10, plus what it can buy). Was 1.25, at which most tokens were exchanged for one resource; A/B: 2 gave 56/59, 3 gave 53/57. */
  tokenValue: 2,
  /** Extra for a resource that is the last one missing for a needed tile (token exchange, R18.4). */
  unblock: 0.6,
  /** First connections a player expects per turn left (for cards that pay on them). */
  firstConnRate: 0.12,
  /** Cards that are hard to value exactly. */
  cardMove: 0.4,
  cardExchange: 0.8,
  cardDoubleType: 2,
  cardForemanAny: 2.5,
  freeMovePerTurn: 0.12,
  freeBonusPerTurn: 0.7,

  // --- setup (R3.5, R3.6)
  setupCross: 1.0,
  setupLocal: 2.0,
  setupCrowd: 1.5,
  /**
   * Per inland city within `setupReachSlots` slots of the start city. Added because with a random draft the
   * start cities are not equal as this bot plays (900 3-player games, VP against the table mean: Omaha +4.7,
   * Minneapolis +3.0, Sacramento +2.7, Portland +1.7, Seattle +0.3, Fort Worth -3.4, Kansas City -4.3,
   * Los Angeles -4.5) and without it seat 1 always drew Fort Worth or Kansas City. Wins by seat at 3 players,
   * 400 games: 0 gave 31/45/24, 1.0 gave 33/38/30, 2.5 gave 30/39/31.
   */
  setupReach: 1.0,
  setupReachSlots: 6,
  setupPair: 0.5,
  setupFinancier: 0.25,

  // --- archetype multipliers (1 = the baseline)
  /** Value of every slot of a terrain when routes are valued. */
  biasGround: 1,
  biasTunnel: 1,
  biasBridge: 1,
  /** Value of Congress entries. */
  biasCongress: 1,
  /** Value of specialists and carriages. */
  biasEngine: 1,
  /** Value of upgrade tiles. */
  biasUpgrades: 1,
  /** Value of buildings. */
  biasBuildings: 1,
  /** Value of Pony Express cards. */
  biasPony: 1,
  /** Value of the crossing. */
  biasCrossing: 1,
};

/** Settings of the Easy level (src/bots/index.js): noise on every score, and a chance of a pick among the top three. */
export const EASY_SETTINGS = {
  noise: 1.2,
  topThreeChance: 0.15,
};

/** Settings of `rolloutPolicy`. */
export const ROLLOUT_SETTINGS = {
  /** Chance that a decision is a uniformly random legal action, so that playouts differ. */
  epsilon: 0.04,
  /** A first connection, a slot on the player's cheapest crossing and the completing claim, when picking the route to aim for. */
  firstConnection: 8,
  crossingSlot: 1.5,
  completion: 30,
  /** Before this many turns a free building is a railway station (production); after it, a telegraph station (VP). */
  railwayUntilTurn: 10,
  /** Chance of taking a Congress entry that is on offer, and of buying a card that can be bought. */
  congressChance: 0.6,
  cardChance: 0.5,
};

/** The repeated-state guard keeps this many recent layouts per player. */
export const GUARD_SETTINGS = {
  memory: 6,
};

// ---------------------------------------------------------------------------
// Static tables of the map (fixed for the process: board.js builds one map)
// ---------------------------------------------------------------------------

const INF = 1e9;
const TERRAINS3 = ['ground', 'tunnel', 'bridge'];
const RES3 = ['iron', 'wood', 'gunpowder'];
const TERRAIN_OF = { crew: 'ground', miner: 'tunnel', engineer: 'bridge' };
const SPEC_OF = { ground: 'crew', tunnel: 'miner', bridge: 'engineer' };
const BIAS_OF = { ground: 'biasGround', tunnel: 'biasTunnel', bridge: 'biasBridge' };

const CITY_IDS = MAP.cityIds;
const N = CITY_IDS.length;
const CI = {};
CITY_IDS.forEach((id, i) => {
  CI[id] = i;
});
const IS_INLAND = CITY_IDS.map((id) => MAP.cityById[id].kind === 'inland');
const WEST = MAP.westStartCities.map((id) => CI[id]);
const EAST = MAP.eastStartCities.map((id) => CI[id]);

/** Routes by index: ends as city indices, length, cost by terrain, number of distinct terrains. */
const RT = MAP.routes.map((r) => ({
  id: r.id,
  a: r.a,
  b: r.b,
  ai: CI[r.a],
  bi: CI[r.b],
  len: r.length,
  cost: r.cost,
  kinds: TERRAINS3.filter((t) => r.cost[t] > 0).length,
}));
const R = RT.length;
const RI = {};
RT.forEach((r, i) => {
  RI[r.id] = i;
});
/** Route indices at each city. */
const ADJ = CITY_IDS.map((id) => MAP.cityRoutes[id].map((rid) => RI[rid]));

function shortestFrom(sources, weight) {
  const dist = new Array(N).fill(INF);
  const done = new Array(N).fill(false);
  for (const s of sources) dist[s] = 0;
  for (;;) {
    let u = -1;
    let best = INF;
    for (let i = 0; i < N; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = true;
    const adj = ADJ[u];
    for (let k = 0; k < adj.length; k++) {
      const ri = adj[k];
      const w = weight(ri);
      if (w < 0) continue;
      const r = RT[ri];
      const v = r.ai === u ? r.bi : r.ai;
      if (best + w < dist[v]) dist[v] = best + w;
    }
  }
  return dist;
}

/** Slots between every pair of cities on an empty map (for the railhead draft). */
const EMPTY_DIST = CITY_IDS.map((_, i) => shortestFrom([i], (ri) => RT[ri].len));

// ---------------------------------------------------------------------------
// Map analysis, memoised per state object and route ownership
// ---------------------------------------------------------------------------

const ANALYSIS = new WeakMap();

/**
 * Everything the bot reads off route ownership. A pure function of
 * `state.map.routeOwner` (and of the variant `gameEndTrigger`, fixed for a
 * state object), so the memo cannot go stale: its key is the ownership itself.
 */
function analyse(state) {
  const owner = state.map.routeOwner;
  let sig = '';
  for (let i = 0; i < R; i++) {
    const o = owner[RT[i].id];
    sig += o === null ? '-' : o;
  }
  const memo = ANALYSIS.get(state);
  if (memo !== undefined && memo.sig === sig) return memo;

  const n = state.players.length;
  const any = state.variants.gameEndTrigger === 'any-crossing';
  const own = new Array(R);
  const claimedAt = new Array(N).fill(0);
  const openAt = new Array(N).fill(0);
  const ownedRoutes = new Array(n).fill(0);
  const ownedSlots = new Array(n).fill(0);
  const longest = new Array(n).fill(0);
  const ownedTerrain = [];
  for (let p = 0; p < n; p++) ownedTerrain.push({ ground: 0, tunnel: 0, bridge: 0 });
  let claimed = 0;
  for (let i = 0; i < R; i++) {
    const r = RT[i];
    const o = owner[r.id];
    if (o === null) {
      own[i] = -1;
      openAt[r.ai] += 1;
      openAt[r.bi] += 1;
    } else {
      own[i] = o;
      claimed += 1;
      claimedAt[r.ai] += 1;
      claimedAt[r.bi] += 1;
      ownedRoutes[o] += 1;
      ownedSlots[o] += r.len;
      if (r.len > longest[o]) longest[o] = r.len;
      const t = ownedTerrain[o];
      t.ground += r.cost.ground;
      t.tunnel += r.cost.tunnel;
      t.bridge += r.cost.bridge;
    }
  }
  // Cities joined by claimed routes of any owner (R12.2: where a railhead can move).
  const comp = new Array(N).fill(-1);
  const members = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue;
    const id = members.length;
    const list = [s];
    comp[s] = id;
    for (let q = 0; q < list.length; q++) {
      const u = list[q];
      const adj = ADJ[u];
      for (let k = 0; k < adj.length; k++) {
        const ri = adj[k];
        if (own[ri] < 0) continue;
        const r = RT[ri];
        const v = r.ai === u ? r.bi : r.ai;
        if (comp[v] < 0) {
          comp[v] = id;
          list.push(v);
        }
      }
    }
    members.push(list);
  }
  // The crossing (R19.1): slots still to lay, per player, with their own routes free.
  const dW = [];
  const dE = [];
  const cross = [];
  for (let p = 0; p < n; p++) {
    const weight = (ri) => {
      const o = own[ri];
      if (o === p || (any && o >= 0)) return 0;
      return o === -1 ? RT[ri].len : -1;
    };
    const w = shortestFrom(WEST, weight);
    const e = shortestFrom(EAST, weight);
    let c = INF;
    for (const i of EAST) if (w[i] < c) c = w[i];
    dW.push(w);
    dE.push(e);
    cross.push(c);
  }
  const out = { sig, own, claimed, claimedAt, openAt, ownedRoutes, ownedSlots, longest, ownedTerrain, comp, members, dW, dE, cross };
  ANALYSIS.set(state, out);
  return out;
}

/** Slots the crossing of player `p` needs if it runs through route `r` (INF when it cannot). */
function crossThrough(an, p, r) {
  const w = an.dW[p];
  const e = an.dE[p];
  const through = Math.min(w[r.ai] + e[r.bi], w[r.bi] + e[r.ai]);
  if (through >= INF) return INF;
  const o = an.own[RI[r.id]];
  return through + (o === -1 ? r.len : 0);
}

// ---------------------------------------------------------------------------
// The repeated-state guard (anti-livelock guard c). EXPORTED: any other driver
// that moves railheads by its own rules (the simulator, a search) can apply it.
// ---------------------------------------------------------------------------

const GUARD_MEMORY = new WeakMap();

function guardList(state, playerId, create) {
  let perState = GUARD_MEMORY.get(state);
  if (perState === undefined) {
    if (!create) return null;
    perState = [];
    GUARD_MEMORY.set(state, perState);
  }
  if (perState[playerId] === undefined) {
    if (!create) return null;
    perState[playerId] = [];
  }
  return perState[playerId];
}

function layoutKey(state, playerId, railheads) {
  const an = analyse(state);
  let buildings = 0;
  const rail = state.map.railwayStation;
  const tele = state.map.telegraphStation;
  for (const city in rail) {
    if (rail[city] === playerId) buildings += 1;
    if (tele[city] === playerId) buildings += 1;
  }
  const heads = railheads.slice().sort();
  return `${heads.join(',')}#${an.ownedRoutes[playerId]}#${buildings}`;
}

/**
 * A Move Train step back to where a railhead stood a moment ago, with no
 * route claimed and no building placed in between, achieves nothing, and a
 * bot that scores each hop on its own will shuttle for ever. The guard
 * remembers the last few railhead layouts of each player (with a progress
 * count, so that a layout seen before a claim does not count) and refuses a
 * move that would recreate one.
 *
 * The memory lives in a WeakMap keyed on the state object: it never enters
 * the state, a clone starts with none, and it is freed with the state.
 *
 *   repeatGuard.note(state)                 remember the layout of `state.toAct` (call before choosing in a Lay Tracks decision)
 *   repeatGuard.wouldRepeat(state, action)  true for a `moveTrain` that recreates a remembered layout
 *   repeatGuard.filter(state, actions)      the actions with such moves removed (all of them back if nothing else is left)
 *   repeatGuard.fingerprint(state, playerId) the layout key, for tests and logs
 */
export const repeatGuard = {
  fingerprint(state, playerId) {
    return layoutKey(state, playerId, state.players[playerId].railheads);
  },
  note(state, playerId = state.toAct) {
    if (playerId === null || playerId === undefined) return;
    const list = guardList(state, playerId, true);
    const key = layoutKey(state, playerId, state.players[playerId].railheads);
    if (list[list.length - 1] === key) return;
    list.push(key);
    if (list.length > GUARD_SETTINGS.memory) list.shift();
  },
  wouldRepeat(state, action, playerId = state.toAct) {
    if (action === null || typeof action !== 'object' || action.type !== 'moveTrain') return false;
    const list = guardList(state, playerId, false);
    if (list === null || list.length === 0) return false;
    const heads = state.players[playerId].railheads.slice();
    const at = heads.indexOf(action.from);
    if (at < 0) return false;
    heads[at] = action.to;
    return list.includes(layoutKey(state, playerId, heads));
  },
  filter(state, actions, playerId = state.toAct) {
    const kept = actions.filter((a) => !repeatGuard.wouldRepeat(state, a, playerId));
    return kept.length > 0 ? kept : actions;
  },
  /** Forget what is remembered for a state (tests). */
  reset(state) {
    GUARD_MEMORY.delete(state);
  },
};

// ---------------------------------------------------------------------------
// The context of one decision: the plan, worked out from the state
// ---------------------------------------------------------------------------

const WEIGHT_CACHE = new WeakMap();

/**
 * HEURISTIC_WEIGHTS with `overrides` laid over it. Throws on a name that is
 * not a weight or a value that is not a finite number, so that a misspelt
 * override can never quietly run the baseline bot.
 */
export function resolveWeights(overrides) {
  if (overrides === null || overrides === undefined) return HEURISTIC_WEIGHTS;
  if (typeof overrides !== 'object') throw new Error('heuristicBot: `weights` must be an object of overrides of HEURISTIC_WEIGHTS.');
  let merged = WEIGHT_CACHE.get(overrides);
  if (merged === undefined) {
    for (const name of Object.keys(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(HEURISTIC_WEIGHTS, name)) {
        throw new Error(`heuristicBot: unknown weight "${name}". The weights are: ${Object.keys(HEURISTIC_WEIGHTS).join(', ')}.`);
      }
      if (typeof overrides[name] !== 'number' || !Number.isFinite(overrides[name])) {
        throw new Error(`heuristicBot: weight "${name}" must be a finite number, not ${JSON.stringify(overrides[name])}.`);
      }
    }
    merged = { ...HEURISTIC_WEIGHTS, ...overrides };
    WEIGHT_CACHE.set(overrides, merged);
  }
  return merged;
}

function smooth(x, lo, hi) {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  return (x - lo) / (hi - lo);
}

function makeCtx(state, pid, W) {
  const K = getConstants(state);
  const V = state.variants;
  const player = state.players[pid];
  const recipes = K.TRAIN.recipes[V.conversionRate];
  const ctx = {
    state,
    pid,
    player,
    K,
    V,
    W,
    an: analyse(state),
    network: V.claimFrom === 'network',
    /** Resource cost of one built tile, by terrain. */
    recipe: { ground: recipes.crew.cost, tunnel: recipes.miner.cost, bridge: recipes.engineer.cost },
    units: { ground: 0, tunnel: 0, bridge: 0 },
    cap: storageCapacity(state, pid),
    heads: [],
    flags: null,
    turnsLeft: 0,
    horizon: 0,
    acts: 0,
    pCross: 0,
    bonusEV: 0,
    resFactor: 1,
    tileFactor: 1,
    // Filled by getPlan.
    planned: false,
    cands: null,
    t1: null,
    t2: null,
    V1: 0,
    E1: 1,
    V2: 0,
    E2: 1,
    rc: null,
    yield: null,
    specRate: null,
    actVp: 0,
    vpNow: 1,
    demandT: null,
    demandR: null,
    coinWant: 0,
    // Lazy pieces.
    _buildings: null,
    _counts: null,
    _specSteps: null,
    _perBuilt: null,
    _ms: undefined,
    _goals: undefined,
    _bestBuilding: null,
    _districtValues: null,
    _canLay: undefined,
    _c6: undefined,
  };
  for (const t of TERRAINS3) {
    let u = 0;
    for (const k in ctx.recipe[t]) u += ctx.recipe[t][k];
    ctx.units[t] = u > 0 ? u : 1;
  }
  for (const c of player.railheads) if (c !== null && !ctx.heads.includes(c)) ctx.heads.push(c);
  ctx.flags = readFlags(ctx);
  readHorizon(ctx);
  // The turn model of turnsToClaim: recipe coefficients, what a Gather brings, what an activation builds.
  const rc = {};
  for (const t of TERRAINS3) rc[t] = { iron: ctx.recipe[t].iron || 0, wood: ctx.recipe[t].wood || 0, gunpowder: ctx.recipe[t].gunpowder || 0 };
  ctx.rc = rc;
  ctx.yield = {};
  for (const r of RES3) ctx.yield[r] = production(state, pid, r) * W.avgM + (ctx.flags.gather[r] || 0);
  const rate = { ground: 0, tunnel: 0, bridge: 0 };
  let actVp = 0;
  for (const step of specSteps(ctx)) {
    if (step.type === 'upgrade') {
      for (const e of step.tile.effects) if (e.type === 'vp') actVp += e.amount;
    } else if (TERRAIN_OF[step.type] !== undefined) rate[TERRAIN_OF[step.type]] += 1;
  }
  ctx.specRate = rate;
  // VP that ride on every activation: at face value once no turn is left to do better with, discounted before (see `actVpNow`).
  ctx.vpNow = W.actVpNow + (1 - W.actVpNow) * (1 - smooth(ctx.turnsLeft, 0, 3));
  ctx.actVp = actVp * W.biasUpgrades * ctx.vpNow;
  return ctx;
}

/** What the Legislative Agenda card and the player's own Pony Express cards change (R17, R18.9). */
function readFlags(ctx) {
  const { state, pid, K } = ctx;
  const f = {
    terrainVp: { ground: 0, tunnel: 0, bridge: 0 },
    firstConn: 0,
    firstConnPerSlot: 0,
    completion: 0,
    distinct: 0,
    slotsBonus: 0,
    slotsBonusAt: 99,
    oppBuilding: 0,
    junction: 0,
    atCount: 0,
    atCountValue: 0,
    gather: { iron: 0, wood: 0, gunpowder: 0, coins: 0 },
    telegraph: 0,
    telegraphRes: 0,
    railway: 0,
    railwayRes: 0,
    hireRes: 0,
    carriageRes: 0,
    tollVp: K.SCORING.tollVp,
    telegraphMult: 1,
    resetVp: K.CONGRESS.resetVpPerSenator,
    bothCities: 0,
    tokensEnd: 0,
  };
  if (state.modules.legislative === undefined && state.modules.pony === undefined) return f;
  for (const { source, effect } of standingEffects(state, pid)) {
    if (effect.type === 'trigger') {
      const e = effect.effect;
      const where = effect.where || {};
      const cond = effect.condition || null;
      switch (effect.on) {
        case 'laySlot':
          if (e.type === 'vp' && where.terrain) f.terrainVp[where.terrain] += e.amount;
          break;
        case 'firstConnection':
          if (e.type === 'vp') f.firstConn += e.amount;
          else if (e.type === 'vpPerSlot') f.firstConnPerSlot += e.amount;
          break;
        case 'completeTranscontinental':
          if (e.type === 'vp') f.completion += e.amount;
          break;
        case 'layTracksActionEnd':
          if (cond && cond.metric === 'distinctTerrainsLaid') f.distinct += e.amount;
          else if (cond && cond.metric === 'slotsLaid') {
            f.slotsBonus += e.amount;
            f.slotsBonusAt = cond.value;
          }
          break;
        case 'placeBuilding':
          if (where.kind === 'telegraphStation') {
            if (e.type === 'vp') f.telegraph += e.amount;
            else if (e.type === 'gainChoice') f.telegraphRes += e.count;
          } else if (where.kind === 'railwayStation') {
            if (e.type === 'vp') f.railway += e.amount;
            else if (e.type === 'gainChoice') f.railwayRes += e.count;
          } else if (cond && cond.metric === 'cityHasOpponentBuilding') f.oppBuilding += e.amount;
          else if (cond && cond.metric === 'cityIsJunction') f.junction += e.amount;
          else if (cond && cond.metric === 'ownBuildings') {
            const used = source === 'legislative' && state.modules.legislative.used && Object.keys(state.modules.legislative.used).length > 0;
            if (!used) {
              f.atCount = cond.value;
              f.atCountValue = e.amount;
            }
          }
          break;
        case 'gather':
          if (e.type === 'gain') for (const k in e.items) f.gather[k] = (f.gather[k] || 0) + e.items[k];
          else if (e.type === 'gainGathered') for (const k in f.gather) f.gather[k] += e.amount;
          break;
        case 'hire':
          if (e.type === 'gainChoice') f.hireRes += e.count;
          break;
        case 'addCarriage':
          if (e.type === 'gainChoice') f.carriageRes += e.count;
          break;
        default:
          break;
      }
    } else if (effect.type === 'modifier') {
      if (effect.what === 'tollVp') f.tollVp = effect.value;
      else if (effect.what === 'telegraphRowVpMultiplier') f.telegraphMult = effect.value;
      else if (effect.what === 'resetVpPerSenator') f.resetVp = effect.value;
    }
  }
  const pony = state.modules.pony;
  if (pony !== undefined && pony.players[pid].endgame.length > 0) {
    const index = cardIndex(K.PONY_CARDS);
    for (const id of pony.players[pid].endgame) {
      for (const e of index.get(id).effects) {
        if (e.type !== 'endVpPer') continue;
        if (e.metric === 'citiesWithBothOwnBuildings') f.bothCities += e.amount;
        else if (e.metric === 'tokensCollected') f.tokensEnd += e.amount;
      }
    }
  }
  return f;
}

/** How many more turns this player can expect, and the chance of being first across. */
function readHorizon(ctx) {
  const { state, pid, an, W, V, K } = ctx;
  const n = state.players.length;
  const me = state.players[pid];
  let turns;
  if (state.phase !== 'play') {
    turns = W.horizonCap;
  } else if (state.gameEnd !== null) {
    // R19.5: the round is played out. R4.8.4 with rounds: until the workers run out.
    if (V.turnStructure === 'rounds') {
      turns = me.workersInSupply - (state.turn.player === pid && state.turn.step === 'freeBefore' ? 1 : 0);
      if (turns < 0) turns = 0;
    } else {
      const active = state.turn.player;
      const order = (p) => (p - state.startPlayer + n) % n;
      turns = active !== null && order(pid) > order(active) ? 1 : 0;
    }
  } else {
    let totalTurns = 0;
    for (const p of state.players) totalTurns += p.turnsTaken;
    let est = V.maxTurnsPerPlayer > 0 ? V.maxTurnsPerPlayer - me.turnsTaken : INF;
    if (V.endRoutesPerPlayer > 0) {
      const left = V.endRoutesPerPlayer * n - an.claimed;
      const rate = (an.claimed + W.claimRatePrior * W.claimRatePriorTurns) / (totalTurns + W.claimRatePriorTurns);
      const byRoutes = left / Math.max(rate, 0.02) / n;
      if (byRoutes < est) est = byRoutes;
    }
    if (state.completion === null) {
      for (let p = 0; p < n; p++) {
        if (an.cross[p] >= INF) continue;
        const rate = (an.ownedSlots[p] + W.slotRatePrior * W.slotRatePriorTurns) / (state.players[p].turnsTaken + W.slotRatePriorTurns);
        const by = (an.cross[p] / Math.max(rate, 0.05)) * W.crossSlack;
        if (by < est) est = by;
      }
    }
    turns = Math.max(1, est);
  }
  ctx.turnsLeft = turns;
  ctx.horizon = Math.min(turns, W.horizonCap);
  ctx.acts = W.actRate * ctx.horizon;
  // A resource gathered now needs two more turns to become VP (build, lay); a built tile needs one.
  ctx.resFactor = smooth(turns, 0.9, 2.5);
  ctx.tileFactor = smooth(turns, 0.2, 1.2);

  // The crossing: who is likely to finish first (R19.2: once per game).
  const S = K.SCORING;
  ctx.bonusEV = S.completionVp + S.completionVpPerSlot * W.crossLastRoute + ctx.flags.completion;
  if (state.completion !== null || an.cross[pid] >= INF || state.phase !== 'play') {
    ctx.pCross = state.phase !== 'play' ? W.crossConfidence * 0.5 : 0;
  } else {
    const rateOf = (p) => (an.ownedSlots[p] + W.slotRatePrior * W.slotRatePriorTurns) / (state.players[p].turnsTaken + W.slotRatePriorTurns);
    const mine = an.cross[pid] / Math.max(rateOf(pid), 0.05);
    let theirs = INF;
    for (let p = 0; p < n; p++) {
      if (p === pid || an.cross[p] >= INF) continue;
      const t = an.cross[p] / Math.max(rateOf(p), 0.05);
      if (t < theirs) theirs = t;
    }
    let pr = theirs >= INF ? 1 : 1 / (1 + Math.exp((mine - theirs) / W.crossTemp));
    if (theirs < INF) pr = Math.min(1, pr * 2 * W.crossConfidence);
    // No use if the game is over first. After the trigger only a line that can be finished this turn counts.
    if (state.gameEnd !== null) pr = turns >= 1 || an.cross[pid] <= 6 ? pr : 0;
    else if (mine * W.crossSlack > turns * 1.5 + 2) pr *= 0.4;
    ctx.pCross = pr;
  }
}

// --- lazily computed facts ---------------------------------------------------

/** Buildings on the map per player. */
function buildings(ctx) {
  if (ctx._buildings !== null) return ctx._buildings;
  const n = ctx.state.players.length;
  const rail = new Array(n).fill(0);
  const tele = new Array(n).fill(0);
  const rs = ctx.state.map.railwayStation;
  const ts = ctx.state.map.telegraphStation;
  for (const city in rs) {
    if (rs[city] !== null) rail[rs[city]] += 1;
    if (ts[city] !== null) tele[ts[city]] += 1;
  }
  ctx._buildings = { rail, tele };
  return ctx._buildings;
}

/** Specialists of the player by type, carriages, free slot. */
function trainCounts(ctx) {
  if (ctx._counts !== null) return ctx._counts;
  const train = ctx.player.train;
  const c = { crew: 0, miner: 0, engineer: 0, financier: 0, total: 0, slots: 0 };
  for (const carriage of train.specialistCarriages) {
    for (const s of carriage.slots) {
      c.slots += 1;
      if (s !== null) {
        c[s] += 1;
        c.total += 1;
      }
    }
  }
  c.carriages = train.specialistCarriages.length + train.storageCarriages;
  ctx._counts = c;
  return c;
}

/** The steps of an activation after the Foreman's (R9.4.2.2), with the upgrade tile of each carriage. */
function specSteps(ctx) {
  if (ctx._specSteps !== null) return ctx._specSteps;
  const { state, pid, K, V } = ctx;
  const steps = [];
  const perBuilt = { ground: 0, tunnel: 0, bridge: 0 };
  const upgrades = state.modules.upgrades !== undefined;
  ctx.player.train.specialistCarriages.forEach((carriage, c) => {
    const level = c + 1;
    if (upgrades) {
      const tile = activationTile(state, pid, level);
      if (tile !== null) {
        steps.push({ type: 'upgrade', level, tile });
        for (const e of tile.effects) if (e.type === 'vpPerBuilt') perBuilt[e.terrain] += e.amount;
      }
    }
    const times = V.specialistActivations === 'once' ? K.TRAIN.activationsByLevel[0] : K.TRAIN.activationsByLevel[c];
    for (const s of carriage.slots) {
      if (s === null) continue;
      for (let t = 0; t < times; t++) steps.push({ type: s, level });
    }
  });
  ctx._specSteps = steps;
  ctx._perBuilt = perBuilt;
  return steps;
}

function perBuiltVp(ctx) {
  if (ctx._perBuilt === null) specSteps(ctx);
  return ctx._perBuilt;
}

/** Milestones still to be claimed (R16.8). */
function milestones(ctx) {
  if (ctx._ms !== undefined) return ctx._ms;
  const m = ctx.state.modules.milestones;
  const out = [];
  if (m !== undefined) {
    const index = cardIndex(ctx.K.MILESTONE_TILES);
    for (const id of m.inPlay) {
      if (m.claimedBy[id] !== null) continue;
      const tile = index.get(id);
      const c = tile.condition;
      out.push({ vp: tile.vp, metric: c.metric, terrain: c.filter && c.filter.terrain ? c.filter.terrain : null, target: c.value });
    }
  }
  ctx._ms = out;
  return out;
}

/**
 * Value of taking a milestone measure from `cur` to `cur + add`: the tile's
 * VP, credited more steeply the nearer the target is.
 */
function milestoneGain(ctx, metric, terrain, cur, add) {
  const list = milestones(ctx);
  if (list.length === 0) return 0;
  let v = 0;
  for (const m of list) {
    if (m.metric !== metric || m.terrain !== terrain || cur >= m.target) continue;
    const before = cur / m.target;
    const after = Math.min(cur + add, m.target) / m.target;
    v += m.vp * (after * after - before * before);
  }
  return v;
}

/** The measures of the goals in play (R16.5). */
function goalMetrics(ctx) {
  if (ctx._goals !== undefined) return ctx._goals;
  const g = ctx.state.modules.goals;
  let out = null;
  if (g !== undefined && g.inPlay.length > 0) {
    out = {};
    const index = cardIndex(ctx.K.GOAL_CARDS);
    for (const id of g.inPlay) {
      const card = index.get(id);
      out[card.metric] = card.direction === 'fewest' ? -1 : 1;
    }
  }
  ctx._goals = out;
  return out;
}

function goalGain(ctx, metric, add) {
  const g = goalMetrics(ctx);
  if (g === null || g[metric] === undefined) return 0;
  return ctx.W.goalStep * add * g[metric];
}

// --- simulated holdings ---------------------------------------------------------

/** A scratch copy of what the player holds, for walking through an action. */
function holdings(ctx) {
  const p = ctx.player;
  const r = p.resources;
  const t = p.builtTiles;
  return {
    iron: r.iron,
    wood: r.wood,
    gunpowder: r.gunpowder,
    ground: t.ground,
    tunnel: t.tunnel,
    bridge: t.bridge,
    coins: p.coins,
    hats: p.hats,
    used: r.iron + r.wood + r.gunpowder + t.ground + t.tunnel + t.bridge,
    cap: ctx.cap,
  };
}

/**
 * Turns still needed to claim a route of cost `cost` with the given tiles and
 * resources in storage: the claim itself, the Gathers for what the missing
 * tiles need, and the train activations to build them. A deliberately simple
 * model: a Gather brings `yield` of its resource, an activation builds
 * `avgForeman` tiles of the district's terrain plus one per matching
 * specialist step. `LAST_BUILD_TURNS` holds the activations counted.
 */
let LAST_BUILD_TURNS = 0;
function turnsToClaim(ctx, cost, g, t, b, iron, wood, gunpowder) {
  let mg = cost.ground - g;
  let mt = cost.tunnel - t;
  let mb = cost.bridge - b;
  if (mg < 0) mg = 0;
  if (mt < 0) mt = 0;
  if (mb < 0) mb = 0;
  LAST_BUILD_TURNS = 0;
  const missing = mg + mt + mb;
  if (missing === 0) return 1;
  const rc = ctx.rc;
  const round = ctx.W.turnRound;
  // Whole activations are counted below; `tileRound` per missing tile keeps every single tile worth building.
  let e = 1 + ctx.W.tileRound * missing;
  const nI = mg * rc.ground.iron + mt * rc.tunnel.iron + mb * rc.bridge.iron - iron;
  if (nI > 0) e += nI / ctx.yield.iron + round;
  const nW = mg * rc.ground.wood + mt * rc.tunnel.wood + mb * rc.bridge.wood - wood;
  if (nW > 0) e += nW / ctx.yield.wood + round;
  const nG = mg * rc.ground.gunpowder + mt * rc.tunnel.gunpowder + mb * rc.bridge.gunpowder - gunpowder;
  if (nG > 0) e += nG / ctx.yield.gunpowder + round;
  const f = ctx.W.avgForeman;
  const sp = ctx.specRate;
  let n = 0;
  while ((mg > 0 || mt > 0 || mb > 0) && n < 8) {
    if (mg >= mt && mg >= mb) mg -= f;
    else if (mt >= mb) mt -= f;
    else mb -= f;
    mg -= sp.ground;
    mt -= sp.tunnel;
    mb -= sp.bridge;
    n += 1;
  }
  LAST_BUILD_TURNS = n;
  return e + n;
}

function spare(n) {
  return n <= 0 ? 0 : n / (1 + 0.35 * n) / 0.74;
}

/**
 * The value of what is in storage, measured against the plan: for each target
 * its value times the share of the remaining turns that the holdings save
 * (relative to the holdings the decision started with), plus a little for
 * spare units. Scores are differences of this, so only changes matter.
 * `mask` leaves a target out: 1 = target 1, 2 = target 2 (when it is the route
 * being claimed, or is already claimed in a simulation).
 */
function phi(ctx, h, mask) {
  let g = h.ground;
  let t = h.tunnel;
  let b = h.bridge;
  let iron = h.iron;
  let wood = h.wood;
  let gunpowder = h.gunpowder;
  let v = 0;
  const rc = ctx.rc;
  for (let k = 1; k <= 2; k++) {
    const target = k === 1 ? ctx.t1 : ctx.t2;
    if (target === null || (mask & k) !== 0) continue;
    const value = k === 1 ? ctx.V1 : ctx.V2;
    if (value <= 0) continue;
    const cost = target.r.cost;
    const e = turnsToClaim(ctx, cost, g, t, b, iron, wood, gunpowder);
    v += value * (1 - e / (k === 1 ? ctx.E1 : ctx.E2));
    // Set aside what this target uses; the next one, and the spares, see only the rest.
    let mg = cost.ground - g;
    let mt = cost.tunnel - t;
    let mb = cost.bridge - b;
    g = mg < 0 ? -mg : 0;
    t = mt < 0 ? -mt : 0;
    b = mb < 0 ? -mb : 0;
    if (mg < 0) mg = 0;
    if (mt < 0) mt = 0;
    if (mb < 0) mb = 0;
    iron -= mg * rc.ground.iron + mt * rc.tunnel.iron + mb * rc.bridge.iron;
    wood -= mg * rc.ground.wood + mt * rc.tunnel.wood + mb * rc.bridge.wood;
    gunpowder -= mg * rc.ground.gunpowder + mt * rc.tunnel.gunpowder + mb * rc.bridge.gunpowder;
    if (iron < 0) iron = 0;
    if (wood < 0) wood = 0;
    if (gunpowder < 0) gunpowder = 0;
  }
  const W = ctx.W;
  v += W.tileSurplus * ctx.tileFactor * (spare(g) + spare(t) + spare(b));
  v += W.resSurplus * ctx.resFactor * (spare(iron) + spare(wood) + spare(gunpowder));
  return v;
}

/** What the next built tile of a terrain is worth, given what is held. */
function tileUnit(ctx, h, t) {
  const before = phi(ctx, h, 0);
  h[t] += 1;
  const after = phi(ctx, h, 0);
  h[t] -= 1;
  return after - before;
}

/** What the next unit of a resource is worth, given what is held. */
function resUnit(ctx, h, r) {
  const before = phi(ctx, h, 0);
  h[r] += 1;
  const after = phi(ctx, h, 0);
  h[r] -= 1;
  return after - before;
}

function coinUnit(ctx, h) {
  return h.coins < ctx.coinWant ? ctx.W.coinNeeded * ctx.resFactor : ctx.W.coinSurplus * ctx.resFactor;
}

/** Gains `n` of a resource or of a built tile into the scratch holdings; returns the value. Units that do not fit are wasted (R8.5.4). */
function gainItem(ctx, h, item, n) {
  const room = h.cap - h.used;
  const fit = n < room ? n : room > 0 ? room : 0;
  let v = -ctx.W.overflowPenalty * (n - fit);
  if (fit > 0) {
    const before = phi(ctx, h, 0);
    h[item] += fit;
    h.used += fit;
    v += phi(ctx, h, 0) - before;
  }
  return v;
}

function gainRes(ctx, h, r, n) {
  return gainItem(ctx, h, r, n);
}

function gainTile(ctx, h, t, n) {
  return gainItem(ctx, h, t, n);
}

function gainCoins(ctx, h, n) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += coinUnit(ctx, h);
    h.coins += 1;
  }
  return v;
}

function bestResource(ctx, h) {
  let best = RES3[0];
  let bv = -INF;
  for (const r of RES3) {
    const v = resUnit(ctx, h, r);
    if (v > bv) {
      bv = v;
      best = r;
    }
  }
  return best;
}

function bestTerrain(ctx, h) {
  let best = TERRAINS3[0];
  let bv = -INF;
  for (const t of TERRAINS3) {
    const v = tileUnit(ctx, h, t);
    if (v > bv) {
      bv = v;
      best = t;
    }
  }
  return best;
}

function gainChoice(ctx, h, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v += gainRes(ctx, h, bestResource(ctx, h), 1);
  return v;
}

function gainTileChoice(ctx, h, n, distinct) {
  let v = 0;
  const taken = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    let bv = -INF;
    for (const t of TERRAINS3) {
      if (distinct && taken.includes(t)) continue;
      const u = tileUnit(ctx, h, t);
      if (u > bv) {
        bv = u;
        best = t;
      }
    }
    if (best === null) break;
    taken.push(best);
    v += gainTile(ctx, h, best, 1);
  }
  return v;
}

function hatValueNow(ctx, h) {
  const limit = ctx.K.HATS.hatLimit;
  if (ctx.turnsLeft < 1) return 0;
  return ctx.W.hatValue * (h.hats >= limit - 1 ? ctx.W.hatFullDiscount : 1);
}

function gainHats(ctx, h, n) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    if (h.hats >= ctx.K.HATS.hatLimit) v += gainChoice(ctx, h, ctx.K.HATS.resourcesPerHatAtLimit);
    else {
      v += hatValueNow(ctx, h);
      h.hats += 1;
    }
  }
  return v;
}

function canPayH(h, cost) {
  for (const k in cost) if (h[k] < cost[k]) return false;
  return true;
}

/** What paying a cost would give up, without changing the holdings. */
function costValue(ctx, h, cost) {
  let v = 0;
  let any = false;
  for (const k in cost) {
    const n = cost[k];
    if (n <= 0) continue;
    if (k === 'coins') {
      for (let i = 0; i < n; i++) {
        h.coins -= 1;
        v += coinUnit(ctx, h);
      }
      h.coins += n;
    } else any = true;
  }
  if (any) {
    const before = phi(ctx, h, 0);
    for (const k in cost) if (k !== 'coins') h[k] -= cost[k];
    v += before - phi(ctx, h, 0);
    for (const k in cost) if (k !== 'coins') h[k] += cost[k];
  }
  return v;
}

// --- buildings ---------------------------------------------------------------------

let JUNCTIONS = null;
let JUNCTIONS_FOR = null;
function isJunction(ctx, city) {
  if (JUNCTIONS_FOR !== ctx.K.MAP_RULES.junctionMinRoutes) {
    JUNCTIONS_FOR = ctx.K.MAP_RULES.junctionMinRoutes;
    JUNCTIONS = new Set(junctionCities(ctx.K.MAP_RULES));
  }
  return JUNCTIONS.has(city);
}

function demand(ctx) {
  if (ctx.demandT !== null) return;
  // Before the plan exists: an even mix. getPlan replaces it with the mix of the routes within reach.
  ctx.demandT = { ground: 1 / 3, tunnel: 1 / 3, bridge: 1 / 3 };
  ctx.demandR = { iron: 1 / 3, wood: 1 / 3, gunpowder: 1 / 3 };
}

/** Value of one more unit of production on a house track for the rest of the game (R6.2, R13.2.4). */
function productionValue(ctx, track) {
  const W = ctx.W;
  demand(ctx);
  const gathers = track === 'coins' ? ctx.horizon * W.coinGatherRate : ctx.horizon * W.gatherRate * ctx.demandR[track];
  return gathers * W.avgM * W.prodUnit;
}

/** What placing one building is worth to the player (R13.2, R13.3, R20.3, and the cards that pay on it). */
function buildingValue(ctx, city, kind, houseTrack) {
  const { state, pid, W, flags } = ctx;
  const b = buildings(ctx);
  const mine = b.rail[pid] + b.tele[pid];
  let v = buildingTableVp(state, mine + 1) - buildingTableVp(state, mine);
  v += milestoneGain(ctx, 'buildings', null, mine, 1);
  const rs = state.map.railwayStation[city];
  const ts = state.map.telegraphStation[city];
  const hasOpp = (rs !== null && rs !== pid) || (ts !== null && ts !== pid);
  const hasOwn = rs === pid || ts === pid;
  if (flags.oppBuilding > 0 && hasOpp) v += flags.oppBuilding;
  if (flags.junction > 0 && isJunction(ctx, city)) v += flags.junction;
  if (flags.atCountValue > 0 && mine < flags.atCount) v += mine + 1 === flags.atCount ? flags.atCountValue : flags.atCountValue * 0.15;
  if (!hasOwn) v += goalGain(ctx, 'citiesWithOwnBuilding', 1);
  const goals = goalMetrics(ctx);
  if (goals !== null) {
    if (goals.buildingsInJunctionCities !== undefined && isJunction(ctx, city)) v += W.goalStep;
    if (goals.minNorthSouthBuildings !== undefined) v += W.goalStep * 0.5;
  }
  if (kind === 'telegraphStation') {
    const row = ctx.K.PLAYER_BOARD.telegraphRowVp;
    const placed = ctx.player.telegraphsPlaced;
    v += (row[placed] || 0) * flags.telegraphMult + flags.telegraph;
    if (flags.telegraphRes > 0) v += flags.telegraphRes * W.resGeneric * ctx.resFactor;
    if (placed + 1 < row.length) v += W.telegraphUnlock * smooth(ctx.turnsLeft, 0, 8);
    v += milestoneGain(ctx, 'telegraphStations', null, b.tele[pid], 1);
    v += goalGain(ctx, 'telegraphStations', 1);
    if (rs !== null && rs !== pid) v += goalGain(ctx, 'telegraphsWithOpponentRailway', 1);
    if (flags.bothCities > 0 && rs === pid) v += flags.bothCities;
  } else {
    v += flags.railway;
    if (flags.railwayRes > 0) v += flags.railwayRes * W.resGeneric * ctx.resFactor;
    v += productionValue(ctx, houseTrack);
    v += W.tollExpect * flags.tollVp * smooth(ctx.turnsLeft, 0, 12) * (ADJ[CI[city]].length / 5);
    v += goalGain(ctx, 'railwayStations', 1);
    if (flags.bothCities > 0 && ts === pid) v += flags.bothCities;
  }
  return v * W.biasBuildings;
}

/** The house track whose production is worth most among those that still hold a house. */
function bestHouseTrack(ctx) {
  let best = null;
  let bv = -INF;
  for (const track of ctx.K.PLAYER_BOARD.houseTracks) {
    if (ctx.player.houses[track] <= 0) continue;
    const v = productionValue(ctx, track);
    if (v > bv) {
      bv = v;
      best = track;
    }
  }
  return best;
}

/** The best single building the player could place in a city (0 when none), memoised per decision. */
function bestBuildingAt(ctx, city) {
  if (ctx._bestBuilding === null) ctx._bestBuilding = {};
  const memo = ctx._bestBuilding;
  if (memo[city] !== undefined) return memo[city];
  const { state, pid, V } = ctx;
  let best = 0;
  if (IS_INLAND[CI[city]]) {
    const rs = state.map.railwayStation[city];
    const ts = state.map.telegraphStation[city];
    const sameOwner = V.bothBuildingsSameOwner;
    if (ts === null && ctx.player.telegraphsPlaced < ctx.K.PLAYER_BOARD.telegraphStations && (sameOwner || rs !== pid)) {
      best = Math.max(best, buildingValue(ctx, city, 'telegraphStation', null));
    }
    if (rs === null && (sameOwner || ts !== pid)) {
      const track = bestHouseTrack(ctx);
      if (track !== null) best = Math.max(best, buildingValue(ctx, city, 'railwayStation', track));
    }
  }
  memo[city] = best;
  return best;
}

// --- routes and targets --------------------------------------------------------------

/**
 * What claiming a route is worth: `vp` is what the claim scores or secures at
 * once (R11.5), `strat` what it is worth beyond that (the crossing,
 * milestones, denying a rival). `arrival` is null for a network claim between
 * two cities already in the network (R11.11.4).
 */
function routeValue(ctx, r, arrival) {
  const { state, pid, an, W, flags, K } = ctx;
  const S = K.SCORING;
  let vp = 0;
  for (let i = 0; i < 3; i++) {
    const t = TERRAINS3[i];
    const n = r.cost[t];
    if (n === 0) continue;
    let per = S.vpPerSlot + flags.terrainVp[t];
    if (state.scoringCard === t) per += S.scoringCardVpPerSlot;
    vp += n * per * W[BIAS_OF[t]];
  }
  if (flags.distinct > 0 && r.kinds >= 2) vp += flags.distinct;
  if (flags.slotsBonus > 0 && r.len >= flags.slotsBonusAt) vp += flags.slotsBonus;
  let strat = 0;
  if (arrival !== null) {
    const ai = CI[arrival];
    if (IS_INLAND[ai]) {
      if (an.claimedAt[ai] === 0) {
        vp += S.firstConnectionVp + flags.firstConn + flags.firstConnPerSlot * r.len;
        if (state.modules.pony !== undefined) vp += W.tokenValue + flags.tokensEnd;
      }
      vp += bestBuildingAt(ctx, arrival);
      const rs = state.map.railwayStation[arrival];
      if (rs !== null && rs !== pid) vp -= W.tollGiven * S.tollVp;
    }
    if (!ctx.network) {
      const open = an.openAt[ai] - 1;
      if (open <= 0) strat -= W.deadEnd * ctx.tileFactor;
      else strat += W.frontier * Math.min(open, 2) * ctx.tileFactor;
    }
  }
  // The crossing (R19.2).
  let completes = false;
  if (state.completion === null && an.cross[pid] < INF) {
    const through = crossThrough(an, pid, r);
    const detour = through - an.cross[pid];
    if (detour <= 0) {
      if (an.cross[pid] <= r.len) {
        completes = true;
        vp += (S.completionVp + S.completionVpPerSlot * r.len + flags.completion) * W.biasCrossing;
      } else {
        strat += ctx.pCross * ctx.bonusEV * (r.len / an.cross[pid]) * W.crossWeight * W.biasCrossing;
      }
    } else if (detour <= 2) {
      strat += ctx.pCross * ctx.bonusEV * (r.len / (an.cross[pid] + detour)) * W.crossWeight * W.biasCrossing * 0.4;
    }
  }
  // Milestones (R16.8) the route moves.
  if (milestones(ctx).length > 0) {
    const mine = an.ownedTerrain[pid];
    for (let i = 0; i < 3; i++) {
      const t = TERRAINS3[i];
      if (r.cost[t] > 0) strat += milestoneGain(ctx, 'ownSlots', t, mine[t], r.cost[t]);
    }
    strat += milestoneGain(ctx, 'ownRoutes', null, an.ownedRoutes[pid], 1);
    if (r.len > an.longest[pid]) strat += milestoneGain(ctx, 'longestOwnRoute', null, an.longest[pid], r.len - an.longest[pid]);
  }
  // Denying a rival who is close to a crossing.
  if (state.completion === null && W.blockValue > 0) {
    for (let p = 0; p < state.players.length; p++) {
      if (p === pid) continue;
      const c = an.cross[p];
      if (c >= W.blockRange) continue;
      if (crossThrough(an, p, r) <= c) strat += W.blockValue * (1 - c / W.blockRange);
    }
  }
  return { vp, strat, total: vp + strat, completes };
}

function affordH(h, cost) {
  return h.ground >= cost.ground && h.tunnel >= cost.tunnel && h.bridge >= cost.bridge;
}

/** Turns to claim a candidate with the holdings given (a move counts `moveEffort`). */
function effortOf(ctx, h, cand) {
  return turnsToClaim(ctx, cand.r.cost, h.ground, h.tunnel, h.bridge, h.iron, h.wood, h.gunpowder) + (cand.move ? ctx.W.moveEffort : 0);
}

/** Whether a target that needs `e` turns (this one included) can still be claimed before the game ends. */
function feasible(ctx, e) {
  if (ctx.state.gameEnd !== null) return e - 1 <= ctx.turnsLeft + 0.3 ? 1 : 0;
  return smooth(ctx.turnsLeft - e + ctx.W.feasSlack, 0, ctx.W.feasWidth);
}

function makeCand(ctx, ri, from, arrival, move) {
  const r = RT[ri];
  return { ri, r, from, arrival, move, rv: routeValue(ctx, r, arrival) };
}

/** Every unclaimed route the player could claim now or after one Move Train step. */
function candidates(ctx) {
  const { state, pid, an } = ctx;
  const out = [];
  if (ctx.network) {
    const net = networkCities(state, pid);
    const inNet = new Array(N).fill(false);
    for (const c of net) inNet[CI[c]] = true;
    for (let ri = 0; ri < R; ri++) {
      if (an.own[ri] !== -1) continue;
      const r = RT[ri];
      const aIn = inNet[r.ai];
      const bIn = inNet[r.bi];
      if (!aIn && !bIn) continue;
      out.push(makeCand(ctx, ri, aIn ? r.a : r.b, aIn && bIn ? null : aIn ? r.b : r.a, false));
    }
    return out;
  }
  const seen = new Set();
  // Routes at the railheads first (no move), then those a move away.
  for (const head of ctx.heads) {
    const hi = CI[head];
    for (const ri of ADJ[hi]) {
      if (an.own[ri] !== -1) continue;
      const key = ri * 32 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = RT[ri];
      out.push(makeCand(ctx, ri, head, r.ai === hi ? r.b : r.a, false));
    }
  }
  for (const head of ctx.heads) {
    const hi = CI[head];
    const members = an.members[an.comp[hi]];
    if (members.length <= 1) continue;
    for (const ci of members) {
      if (an.openAt[ci] === 0) continue;
      for (const ri of ADJ[ci]) {
        if (an.own[ri] !== -1) continue;
        const key = ri * 32 + ci;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = RT[ri];
        out.push(makeCand(ctx, ri, CITY_IDS[ci], r.ai === ci ? r.b : r.a, true));
      }
    }
  }
  return out;
}

/** Works out the targets and the needs (steps 3 and 4 of the header). Idempotent. */
function getPlan(ctx) {
  if (ctx.planned) return ctx;
  ctx.planned = true;
  const { W, player } = ctx;
  demand(ctx);
  if (ctx.heads.length === 0) {
    ctx.cands = [];
    return ctx;
  }
  const cands = candidates(ctx);
  ctx.cands = cands;
  // The terrain mix within reach, for valuing specialists and production.
  if (cands.length > 0) {
    const mix = { ground: 1, tunnel: 1, bridge: 1 };
    for (const c of cands) {
      const w = c.move ? 0.5 : 1;
      mix.ground += c.r.cost.ground * w;
      mix.tunnel += c.r.cost.tunnel * w;
      mix.bridge += c.r.cost.bridge * w;
    }
    const sum = mix.ground + mix.tunnel + mix.bridge;
    const dR = { iron: 0, wood: 0, gunpowder: 0 };
    let sumR = 0;
    for (const t of TERRAINS3) {
      mix[t] /= sum;
      for (const k in ctx.recipe[t]) {
        if (dR[k] === undefined) continue;
        dR[k] += mix[t] * ctx.recipe[t][k];
        sumR += mix[t] * ctx.recipe[t][k];
      }
    }
    if (sumR > 0) for (const k in dR) dR[k] /= sumR;
    ctx.demandT = mix;
    ctx.demandR = sumR > 0 ? dR : ctx.demandR;
  }
  const h = holdings(ctx);
  let t1 = null;
  let best = -INF;
  for (const c of cands) {
    c.effort = effortOf(ctx, h, c);
    c.builds = LAST_BUILD_TURNS;
    c.prio = (c.rv.total * (0.15 + 0.85 * feasible(ctx, c.effort))) / c.effort;
    if (c.prio > best) {
      best = c.prio;
      t1 = c;
    }
  }
  ctx.t1 = t1;
  if (t1 === null) return finishPlan(ctx);
  // Target 2: the best follow-up with what is left after target 1 is paid.
  const h2 = holdings(ctx);
  reserve(ctx, h2, t1.r.cost);
  let t2 = null;
  let e2 = 0;
  best = -INF;
  const otherHeadAtFrom = !ctx.network && player.railheads[0] === player.railheads[1];
  const consider = (c, move) => {
    const saved = c.move;
    c.move = move;
    const own = effortOf(ctx, h2, c);
    c.move = saved;
    const e = own + t1.effort - 1;
    const prio = (c.rv.total * feasible(ctx, e)) / e;
    if (prio > best) {
      best = prio;
      t2 = c;
      e2 = own;
    }
  };
  for (const c of cands) {
    if (c.ri === t1.ri) continue;
    // A route at the city target 1 is claimed from needs a move back, unless the other railhead is there too.
    consider(c, c.move || (!ctx.network && c.from === t1.from && !otherHeadAtFrom));
  }
  if (!ctx.network && t1.arrival !== null) {
    const ai = CI[t1.arrival];
    for (const ri of ADJ[ai]) {
      if (ctx.an.own[ri] !== -1 || ri === t1.ri) continue;
      const r = RT[ri];
      consider(makeCand(ctx, ri, t1.arrival, r.ai === ai ? r.b : r.a, false), false);
    }
  }
  // Target 2 is collected for only if both fit in storage with room to work.
  if (t2 !== null && t1.r.len + t2.r.len <= ctx.cap - 2) {
    ctx.t2 = t2;
    ctx.E2 = e2;
  }
  return finishPlan(ctx);
}

/** Takes out of scratch holdings what a route of cost `cost` uses: its tiles, and the resources for those still to build. */
function reserve(ctx, h, cost) {
  const rc = ctx.rc;
  for (let i = 0; i < 3; i++) {
    const t = TERRAINS3[i];
    const m = cost[t] - h[t];
    if (m >= 0) {
      h[t] = 0;
      if (m > 0) {
        h.iron -= m * rc[t].iron;
        h.wood -= m * rc[t].wood;
        h.gunpowder -= m * rc[t].gunpowder;
      }
    } else h[t] = -m;
  }
  if (h.iron < 0) h.iron = 0;
  if (h.wood < 0) h.wood = 0;
  if (h.gunpowder < 0) h.gunpowder = 0;
}

function finishPlan(ctx) {
  const { W, t1, t2 } = ctx;
  const counts = trainCounts(ctx);
  // Coins worth holding: a buffer, more with a slot to fill or Financiers to feed.
  let coinWant = W.coinBuffer;
  if (counts.total < counts.slots && ctx.turnsLeft > 6) coinWant += 2;
  if (counts.financier > 0) coinWant += Math.min(3, counts.financier + 1);
  ctx.coinWant = ctx.turnsLeft < 1 ? 0 : coinWant;
  if (t1 === null) return ctx;
  // What a target is worth pursuing for: its own value, plus the VP its build turns bring by themselves (upgrade tiles).
  ctx.E1 = t1.effort;
  ctx.V1 = (t1.rv.total + ctx.actVp * t1.builds) * feasible(ctx, t1.effort);
  if (t2 !== null) ctx.V2 = t2.rv.total * W.secondDiscount * feasible(ctx, ctx.E2 + t1.effort - 1);
  return ctx;
}

// --- the engine pieces ------------------------------------------------------------------

/** What one more specialist of a type is worth over the turns left (R8.6, R9.3). */
function specialistValue(ctx, type, level) {
  const { W, K, V } = ctx;
  getPlan(ctx);
  const counts = trainCounts(ctx);
  const times = V.specialistActivations === 'once' ? K.TRAIN.activationsByLevel[0] : K.TRAIN.activationsByLevel[level - 1];
  const dim = 1 / (1 + W.specDim * counts[type]);
  let v;
  if (type === 'financier') v = ctx.acts * times * W.finUse * dim * W.biasCongress;
  else v = ctx.acts * times * W.specUse * (0.35 + ctx.demandT[TERRAIN_OF[type]]) * dim;
  // Milestone MS8 and goals 4, 7, 8.
  const sets = Math.min(counts.crew, counts.miner, counts.engineer, counts.financier);
  if (counts[type] === sets) {
    let others = 0;
    for (const s of K.SPECIALIST_TYPES) if (s !== type && counts[s] <= sets) others += 1;
    const distinctHeld = K.SPECIALIST_TYPES.filter((s) => counts[s] > 0).length;
    if (sets === 0 && counts[type] === 0) v += milestoneGain(ctx, 'completeSpecialistSets', null, distinctHeld / 4, 1 / 4) * 1;
    if (others === 0) v += goalGain(ctx, 'completeSpecialistSets', 1);
  }
  v += goalGain(ctx, 'specialists', 1);
  const most = Math.max(counts.crew, counts.miner, counts.engineer, counts.financier);
  if (counts[type] === most) v += goalGain(ctx, 'maxSpecialistsOneType', 1);
  return v * W.biasEngine;
}

/** What one more carriage is worth (R8.7). */
function carriageValue(ctx, kind) {
  const { W, K, player } = ctx;
  const counts = trainCounts(ctx);
  const fade = smooth(ctx.turnsLeft, 0, W.investHorizon);
  let v;
  if (kind === 'storage') {
    if (player.train.storageCarriages >= K.TRAIN.maxStorageCarriages) return -INF;
    v = (player.train.storageCarriages <= 1 ? W.storageSecond : W.storageThird) * fade;
  } else {
    if (player.train.specialistCarriages.length >= K.TRAIN.maxSpecialistCarriages) return -INF;
    v = W.specCarriage * (counts.total >= counts.slots ? 1 : 0.25) * fade;
  }
  v += milestoneGain(ctx, 'carriages', null, counts.carriages, 1);
  v += goalGain(ctx, 'carriages', 1);
  return v * W.biasEngine;
}

/** What installing an upgrade tile in a carriage is worth (R15). */
function upgradeValue(ctx, tile, level) {
  const { W, V } = ctx;
  getPlan(ctx);
  let v = 0;
  const acts = ctx.acts;
  for (const e of tile.effects) {
    if (e.type === 'vp') v += tile.vpTile && V.upgradeVpTiming === 'on-install' ? e.amount : e.amount * acts * W.upgradeVp;
    else if (e.type === 'gain') {
      for (const k in e.items) {
        const per = k === 'coins' ? W.upgradeCoin : k === 'hats' ? W.upgradeHat : W.upgradeRes * (0.6 + 1.2 * (ctx.demandR[k] || 0));
        v += e.items[k] * per * acts;
      }
    } else if (e.type === 'gainBuiltTile') v += e.count * W.upgradeTile * (0.6 + 1.2 * ctx.demandT[e.terrain]) * acts;
    else if (e.type === 'vpPerBuilt') v += e.amount * W.upgradePerBuilt * (0.5 + 1.5 * ctx.demandT[e.terrain]) * acts;
  }
  v -= W.slotWaste * (level - tile.level) * smooth(ctx.turnsLeft, 4, 16);
  v += goalGain(ctx, 'upgradesInstalled', 1);
  return v * W.biasUpgrades;
}

/** The best legal tile-and-carriage pair on the display, or null (R15.3). */
function bestUpgrade(ctx) {
  const { state, pid, K } = ctx;
  const m = state.modules.upgrades;
  if (m === undefined || m.display.length === 0) return null;
  const index = cardIndex(K.UPGRADE_TILES);
  const installed = m.installed[pid];
  let best = null;
  ctx.player.train.specialistCarriages.forEach((carriage, c) => {
    if (installed[c] !== null && installed[c] !== undefined) return;
    if (carriage.slots.every((s) => s === null)) return;
    const level = c + 1;
    for (const id of m.display) {
      const tile = index.get(id);
      if (tile.level > level) continue;
      const v = upgradeValue(ctx, tile, level);
      if (best === null || v > best.value) best = { value: v, tile, level };
    }
  });
  return best;
}

/** The best the bonus action of a Gather district could add, given the holdings after the yield (R7). */
function bonusBest(ctx, h, bonus) {
  const { state, pid, K, V, W, flags, player } = ctx;
  if (!bonus || K.BONUS_ACTIONS[bonus] === undefined) return 0;
  if (bonus === 'upgrade' && state.modules.upgrades === undefined) return 0;
  if (V.bonusActionLimit === 'once-per-game' && player.bonusActionsUsed[bonus]) return 0;
  const printed = K.BONUS_ACTIONS[bonus].cost;
  let best = 0;
  if (bonus === 'hire') {
    const slot = nextSpecialistSlot(player);
    if (slot === null) return 0;
    for (const type of K.SPECIALIST_TYPES) {
      if (state.supply.specialists[type] <= 0) continue;
      const cost = hireCost(state, pid, type, 'bonusAction').cost;
      if (!canPayH(h, cost)) continue;
      const v = specialistValue(ctx, type, slot.level) + flags.hireRes * W.resGeneric * ctx.resFactor - costValue(ctx, h, cost);
      if (v > best) best = v;
    }
  } else if (bonus === 'hat') {
    if (h.hats < K.HATS.hatLimit && canPayH(h, printed)) best = Math.max(0, hatValueNow(ctx, h) - costValue(ctx, h, printed));
  } else if (bonus === 'carriage') {
    if (canPayH(h, printed)) {
      const v = Math.max(carriageValue(ctx, 'storage'), carriageValue(ctx, 'specialist')) + flags.carriageRes * W.resGeneric * ctx.resFactor - costValue(ctx, h, printed);
      if (v > best) best = v;
    }
  } else if (bonus === 'upgrade') {
    if (canPayH(h, printed)) {
      const u = bestUpgrade(ctx);
      if (u !== null) best = Math.max(0, u.value - costValue(ctx, h, printed));
    }
  }
  return best;
}

// --- Congress -----------------------------------------------------------------------------

/** What Congress entry C6's buildings option could place, at its best (R13.6). */
function c6Value(ctx) {
  if (ctx._c6 !== undefined) return ctx._c6;
  const { state, pid, an, V } = ctx;
  let rail = 0;
  let tele = 0;
  const track = bestHouseTrack(ctx);
  const telesLeft = ctx.player.telegraphsPlaced < ctx.K.PLAYER_BOARD.telegraphStations;
  for (const city of MAP.inlandCities) {
    if (an.claimedAt[CI[city]] === 0) continue;
    const rs = state.map.railwayStation[city];
    const ts = state.map.telegraphStation[city];
    if (telesLeft && ts === null && (V.bothBuildingsSameOwner || rs !== pid)) tele = Math.max(tele, buildingValue(ctx, city, 'telegraphStation', null));
    if (track !== null && rs === null && (V.bothBuildingsSameOwner || ts !== pid)) rail = Math.max(rail, buildingValue(ctx, city, 'railwayStation', track));
  }
  ctx._c6 = rail + tele;
  return ctx._c6;
}

/**
 * What a list of one-off effects is worth (the effect vocabulary of the
 * contract, section 12). Changes the scratch holdings as the effects would.
 * Returns null for an effect type it does not know (guard d).
 */
function effectsValue(ctx, h, effects) {
  const { state, pid, W, K } = ctx;
  let v = 0;
  for (const e of effects) {
    switch (e.type) {
      case 'vp':
        v += e.amount;
        break;
      case 'gain':
        for (const k in e.items) {
          if (k === 'coins') v += gainCoins(ctx, h, e.items[k]);
          else if (k === 'hats') v += gainHats(ctx, h, e.items[k]);
          else v += gainRes(ctx, h, k, e.items[k]);
        }
        break;
      case 'gainChoice':
        v += gainChoice(ctx, h, e.count);
        break;
      case 'gainBuiltTile':
        v += gainTile(ctx, h, e.terrain, e.count);
        break;
      case 'gainBuiltTilesChoice':
        v += gainTileChoice(ctx, h, e.count, e.distinct === true);
        break;
      case 'addCarriage': {
        const kinds = e.carriage === 'choice' ? ['storage', 'specialist'] : [e.carriage];
        let best = -INF;
        for (const kind of kinds) best = Math.max(best, carriageValue(ctx, kind));
        if (best > -INF) v += e.optional ? Math.max(0, best) : best;
        break;
      }
      case 'hire': {
        const slot = nextSpecialistSlot(ctx.player);
        if (slot === null) break;
        let best = 0;
        for (const type of K.SPECIALIST_TYPES) {
          if (state.supply.specialists[type] <= 0) continue;
          let sv = specialistValue(ctx, type, slot.level);
          if (!e.free) {
            const cost = hireCost(state, pid, type, 'table').cost;
            if (!canPayH(h, cost)) continue;
            sv -= costValue(ctx, h, cost);
          }
          if (sv > best) best = sv;
        }
        const free = trainCounts(ctx).slots - trainCounts(ctx).total;
        v += best * Math.min(e.count, free) * (e.count > 1 ? 0.85 : 1);
        break;
      }
      case 'steps':
        if (e.claim) {
          const g = bestClaimNow(ctx, h);
          v += g === null ? 0 : Math.max(0, g);
        } else v += W.cardMove;
        break;
      case 'activateTrain': {
        let best = 0;
        for (const type of K.SPECIALIST_TYPES) best = Math.max(best, simActivation(ctx, { ...h }, type, K.TRAIN.cardActivationMultiplier));
        v += best;
        break;
      }
      case 'exchange':
        v += W.cardExchange * ctx.resFactor;
        break;
      case 'vpPer': {
        const m = metricValue(state, pid, e.metric);
        v += (m === null ? 0 : m) * e.amount;
        break;
      }
      case 'freeCongress': {
        const values = [];
        for (const entry of congressTable(state)) {
          if (entry.tier !== e.tier) continue;
          if (entry.reset ? !anyUsed(state) : state.congress.used[entry.id]) continue;
          const ev = effectsValue(ctx, { ...h }, entry.effects);
          if (ev !== null && ev > 0) values.push(ev * W.biasCongress);
        }
        values.sort((a, b) => b - a);
        for (let i = 0; i < Math.min(e.count, values.length); i++) v += values[i];
        break;
      }
      case 'chooseOne': {
        let best = -INF;
        for (const option of e.options) {
          const ov = effectsValue(ctx, { ...h }, option);
          if (ov !== null && ov > best) best = ov;
        }
        if (best > -INF) v += best;
        break;
      }
      case 'placeBuildings':
        v += c6Value(ctx);
        break;
      case 'resetSenators': {
        let used = 0;
        for (const id in state.congress.used) if (state.congress.used[id]) used += 1;
        v += used * ctx.flags.resetVp;
        break;
      }
      case 'untilEndOfTurn':
        v += W.cardDoubleType * ctx.tileFactor;
        break;
      default:
        return null;
    }
  }
  return v;
}

function anyUsed(state) {
  for (const id in state.congress.used) if (state.congress.used[id]) return true;
  return false;
}

/** Net value of taking a Congress entry: its benefit less the Coins (R10.4). */
function entryNet(ctx, h, entry, free) {
  const ev = effectsValue(ctx, { ...h }, entry.effects);
  if (ev === null) return null;
  const coins = free ? 0 : congressCoinCost(ctx.state, ctx.pid, entry);
  if (coins > h.coins) return null;
  return ev * ctx.W.biasCongress - costValue(ctx, h, { coins });
}

/**
 * The best set of Congress entries for `lobby` lobby points and the Coins in
 * hand: `{ value, ids }`. Entries are valued one by one against the same
 * holdings, which is close enough for at most three or four lobby points.
 */
function congressBest(ctx, h, lobby) {
  const { state } = ctx;
  const items = [];
  for (const entry of congressTable(state)) {
    if (entry.tier > lobby) continue;
    if (entry.reset ? !anyUsed(state) : state.congress.used[entry.id]) continue;
    const net = entryNet(ctx, h, entry, false);
    if (net === null || net <= 0) continue;
    items.push({ id: entry.id, tier: entry.tier, coins: congressCoinCost(state, ctx.pid, entry), net });
  }
  let best = { value: 0, ids: [] };
  if (items.length === 0) return best;
  const pick = [];
  const walk = (i, lp, coins, value) => {
    if (value > best.value) best = { value, ids: pick.slice() };
    for (let k = i; k < items.length; k++) {
      const it = items[k];
      if (it.tier > lp || it.coins > coins) continue;
      pick.push(it.id);
      walk(k + 1, lp - it.tier, coins - it.coins, value + it.net);
      pick.pop();
    }
  };
  walk(0, lobby, h.coins, 0);
  return best;
}

// --- train activations ---------------------------------------------------------------------

/** Tries a Crew, Miner or Engineer step on the scratch holdings; returns the gain, or 0 with nothing changed if it is not worth it. */
function buildStep(ctx, h, type) {
  const t = TERRAIN_OF[type];
  const cost = ctx.recipe[t];
  if (!canPayH(h, cost)) return 0;
  const before = phi(ctx, h, 0);
  let units = 0;
  for (const k in cost) {
    h[k] -= cost[k];
    units += cost[k];
  }
  h[t] += 1;
  const gain = phi(ctx, h, 0) - before + perBuiltVp(ctx)[t] * ctx.W.biasUpgrades;
  if (gain <= ctx.W.buildFloor) {
    for (const k in cost) h[k] += cost[k];
    h[t] -= 1;
    return 0;
  }
  h.used += 1 - units;
  return gain;
}

/**
 * Walks a whole train activation (R9.4) on scratch holdings: the Foreman M
 * times, then every carriage. Builds only what is worth building, turns the
 * lobby points into the best Congress entries. Returns the value.
 */
function simActivation(ctx, h, foreman, m) {
  getPlan(ctx);
  let v = 0;
  let lobby = 0;
  const per = ctx.K.CONGRESS.lobbyPointsPerFinancierStep;
  for (let i = 0; i < m; i++) {
    if (foreman === 'financier') lobby += per;
    else v += buildStep(ctx, h, foreman);
  }
  const steps = specSteps(ctx);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === 'upgrade') {
      let uv = 0;
      for (const e of step.tile.effects) {
        if (e.type === 'vpPerBuilt') continue; // counted per tile built, in buildStep
        const one = effectsValue(ctx, h, [e]);
        if (one !== null) uv += e.type === 'vp' ? one * ctx.vpNow : one;
      }
      v += uv * ctx.W.biasUpgrades;
    } else if (step.type === 'financier') lobby += per;
    else v += buildStep(ctx, h, step.type);
  }
  if (lobby > 0) v += congressBest(ctx, h, lobby).value;
  return v;
}

// --- Lay Tracks -----------------------------------------------------------------------------

/**
 * Gain of claiming a candidate with the tiles in the scratch holdings (not
 * changed): its value, less what taking those tiles sets the other targets
 * back. `gone` masks targets already claimed in a simulation.
 */
function claimGain(ctx, h, cand, gone) {
  let mask = gone || 0;
  if (ctx.t1 !== null && cand.ri === ctx.t1.ri) mask |= 1;
  if (ctx.t2 !== null && cand.ri === ctx.t2.ri) mask |= 2;
  const cost = cand.r.cost;
  const before = phi(ctx, h, mask);
  h.ground -= cost.ground;
  h.tunnel -= cost.tunnel;
  h.bridge -= cost.bridge;
  const after = phi(ctx, h, mask);
  h.ground += cost.ground;
  h.tunnel += cost.tunnel;
  h.bridge += cost.bridge;
  return cand.rv.total - (before - after) + ctx.W.layUrgency;
}

/** The best gain among claims that can be made at once from where the railheads stand, or null. */
function bestClaimNow(ctx, h) {
  getPlan(ctx);
  let best = null;
  for (const c of ctx.cands) {
    if (c.move || !affordH(h, c.r.cost)) continue;
    const g = claimGain(ctx, h, c, 0);
    if (best === null || g > best) best = g;
  }
  return best;
}

/** What a Lay Tracks / Move Train action with `steps` steps could achieve (R11.3). */
function laySim(ctx, steps) {
  getPlan(ctx);
  const { W } = ctx;
  const h = holdings(ctx);
  const heads = ctx.heads.slice();
  let pool = ctx.cands;
  const taken = [];
  let total = 0;
  let left = steps;
  let gone = 0;
  while (left > 0) {
    let best = null;
    let bestGain = 0;
    let bestSteps = 1;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (taken.includes(c.ri) || !affordH(h, c.r.cost)) continue;
      const needsMove = !ctx.network && !heads.includes(c.from);
      const use = needsMove ? 2 : 1;
      if (use > left) continue;
      const g = claimGain(ctx, h, c, gone) - (needsMove ? W.moveCost : 0);
      if (g > bestGain) {
        bestGain = g;
        best = c;
        bestSteps = use;
      }
    }
    if (best === null) break;
    for (const t of TERRAINS3) {
      h[t] -= best.r.cost[t];
      h.used -= best.r.cost[t];
    }
    total += bestGain;
    taken.push(best.ri);
    left -= bestSteps;
    if (ctx.t1 !== null && best.ri === ctx.t1.ri) gone |= 1;
    if (ctx.t2 !== null && best.ri === ctx.t2.ri) gone |= 2;
    if (!ctx.network && best.arrival !== null) {
      const at = heads.indexOf(best.from);
      if (at >= 0) heads[at] = best.arrival;
      else heads[0] = best.arrival;
      // Routes at the arrival city can be claimed with the next step.
      const ai = CI[best.arrival];
      let grown = null;
      for (const ri of ADJ[ai]) {
        if (ctx.an.own[ri] !== -1 || taken.includes(ri)) continue;
        if (pool.some((c) => c.ri === ri && c.from === best.arrival)) continue;
        const r = RT[ri];
        if (grown === null) grown = pool.slice();
        grown.push(makeCand(ctx, ri, best.arrival, r.ai === ai ? r.b : r.a, false));
      }
      if (grown !== null) pool = grown;
    }
  }
  if (taken.length > 0) return total;
  // Nothing to claim: is a positioning move for target 1 worth the action?
  const t1 = ctx.t1;
  if (t1 !== null && t1.move && !ctx.network) {
    let have = 0;
    for (const t of TERRAINS3) have += Math.min(h[t], t1.r.cost[t]);
    return W.movePosition * (have / t1.r.len) * ctx.tileFactor + W.moveBase;
  }
  return W.layNothing;
}

// --- districts ------------------------------------------------------------------------------

function canLay(ctx) {
  if (ctx._canLay !== undefined) return ctx._canLay;
  const { an } = ctx;
  getPlan(ctx);
  const h = holdings(ctx);
  let ok = false;
  for (const c of ctx.cands) {
    if (!c.move && affordH(h, c.r.cost)) {
      ok = true;
      break;
    }
  }
  if (!ok && !ctx.network) {
    // R12.2, R12.6: a railhead on a city that a claimed route touches can move.
    for (const head of ctx.heads) if (an.claimedAt[CI[head]] > 0) ok = true;
  }
  ctx._canLay = ok;
  return ok;
}

/**
 * What taking a district's action with multiplier M is worth now. Memoised
 * per decision. Null when the action cannot be chosen (R4.6.3).
 */
function districtValue(ctx, district, m) {
  if (ctx._districtValues === null) ctx._districtValues = new Map();
  const key = district + m;
  const memo = ctx._districtValues;
  if (memo.has(key)) return memo.get(key);
  const { state, pid, flags, V } = ctx;
  getPlan(ctx);
  const info = districtInfo(state, district);
  let v;
  if (info.family === 'gather') {
    const h = holdings(ctx);
    const what = info.gathers;
    const amount = production(state, pid, what) * m + (flags.gather[what] || 0);
    v = what === 'coins' ? gainCoins(ctx, h, amount) : gainRes(ctx, h, what, amount);
    const b = bonusBest(ctx, h, info.bonusAction);
    v += b;
    if (b > 0 && V.bonusActionLimit === 'multiplied' && m > 1) v += b * 0.3 * (m - 1);
  } else if (info.family === 'trainActivation') {
    v = simActivation(ctx, holdings(ctx), info.foremanType, m);
  } else if (info.family === 'layTracks') {
    v = canLay(ctx) ? laySim(ctx, V.layTrackClaims === 'per-railhead' ? m * 2 : m) : null;
  } else {
    v = null;
  }
  memo.set(key, v);
  return v;
}

/** How much each district is wanted in general, for judging where a worker is worth leaving (R5.6). */
function positionWants(ctx) {
  const { state, W } = ctx;
  getPlan(ctx);
  const want = {};
  const fin = trainCounts(ctx).financier;
  for (const d of DISTRICT_IDS) {
    const info = districtInfo(state, d);
    if (info.family === 'gather') want[d] = info.gathers === 'coins' ? W.posCoins : W.posGather * ctx.demandR[info.gathers];
    else if (info.family === 'layTracks') want[d] = W.posLay;
    else if (info.foremanType === 'financier') want[d] = W.posLobby * (fin > 0 ? 1 : 0.4);
    else want[d] = W.posTrain * ctx.demandT[TERRAIN_OF[info.foremanType]];
  }
  return want;
}

// ---------------------------------------------------------------------------
// Scorers, one per pending decision. Each returns a number, or null for an
// action it cannot evaluate (guard d).
// ---------------------------------------------------------------------------

function hatPrice(ctx) {
  return hatValueNow(ctx, { hats: ctx.player.hats - 1 });
}

function scoreWorkerStep(ctx, actions) {
  const { state, pid, W, K } = ctx;
  const grid = state.grid;
  const adj = {};
  for (const d of DISTRICT_IDS) {
    let n = 0;
    for (const w of DISTRICT_SPACES[d]) if (grid.spaces[w] === pid) n += 1;
    if (grid.centres[d] === pid) n += 1;
    for (const o of DISTRICT_NEIGHBOURS[d]) if (grid.centres[o] === pid) n += 1;
    adj[d] = n;
  }
  const want = positionWants(ctx);
  const canHat = state.turn.player === pid && state.turn.hatsAtStart > 0 && ctx.player.hats > 0 && !state.turn.hatSpent;
  const price = canHat ? hatPrice(ctx) : 0;
  const perHat = K.HATS.multiplierPerHat;
  const fade = smooth(ctx.turnsLeft, 0, 4);
  const bestOf = (districts, base) => {
    let best = null;
    for (let i = 0; i < districts.length; i++) {
      const d = districts[i];
      const m = base(d);
      const v = districtValue(ctx, d, m);
      if (v === null) continue;
      if (best === null || v > best) best = v;
      if (canHat) {
        const vh = districtValue(ctx, d, m + perHat);
        if (vh !== null && vh - price > best) best = vh - price;
      }
    }
    return best;
  };
  return actions.map((a) => {
    if (a.type === 'placeWorker') {
      const ds = SPACE_DISTRICTS[a.space];
      const best = bestOf(ds, (d) => 1 + adj[d]);
      if (best === null) return null;
      return best + W.posPlace * fade * (want[ds[0]] + want[ds[1]]);
    }
    if (a.type === 'removeWorker') {
      if (isDistrictId(a.from)) {
        const best = bestOf([a.from], (d) => adj[d]);
        let pos = want[a.from];
        for (const o of DISTRICT_NEIGHBOURS[a.from]) pos += want[o];
        // R5.4.4: with no legal claim or move the worker comes off D5 and nothing else happens.
        return (best === null ? 0 : best) - W.posRemove * fade * pos;
      }
      const ds = SPACE_DISTRICTS[a.from];
      const best = bestOf(ds, (d) => adj[d]);
      if (best === null) return null;
      return best - W.posRemove * fade * (want[ds[0]] + want[ds[1]]);
    }
    if (a.type === 'displaceWorker') {
      const best = bestOf([a.district], () => 1);
      if (best === null) return null;
      let pos = want[a.district];
      for (const o of DISTRICT_NEIGHBOURS[a.district]) pos += want[o];
      // R5.4.1, R5.4.3: the worker on the centre must be the next one removed, and that turn takes this district's action again.
      const once = districtValue(ctx, a.district, 1);
      const twice = districtValue(ctx, a.district, 2);
      const forced = once !== null && twice !== null ? Math.min(0, twice - once - W.forcedTurn) : -W.forcedTurn;
      return best + forced * fade + W.posPlace * fade * pos - W.displaceGift * DISTRICT_SPACES[a.district].length;
    }
    return null;
  });
}

function scoreChooseDistrict(ctx, actions) {
  const { state, pid } = ctx;
  const worker = state.turn.worker;
  const exclude = worker !== null && worker.via !== 'remove' ? worker.at : null;
  const price = hatPrice(ctx);
  return actions.map((a) => {
    if (a.type !== 'chooseDistrict') return null;
    if (a.district === 'none') return 0;
    const m = multiplierFor(state, pid, a.district, a.hat, exclude).multiplier;
    const v = districtValue(ctx, a.district, m);
    if (v === null) return null;
    return a.hat ? v - price : v;
  });
}

function scoreTrainActivation(ctx, frame, actions) {
  const { W } = ctx;
  getPlan(ctx);
  const h = holdings(ctx);
  if (frame.congress) {
    // Lobby points still to come in this activation may reach a dearer entry (R9.4.3).
    let future = 0;
    const per = ctx.K.CONGRESS.lobbyPointsPerFinancierStep;
    for (let i = frame.index; i < frame.steps.length; i++) if (frame.steps[i].type === 'financier') future += per;
    const plan = congressBest(ctx, h, frame.lobby + future);
    const table = cardIndex(congressTable(ctx.state));
    return actions.map((a) => {
      if (a.type === 'closeCongress') return 0;
      if (a.type !== 'takeCongressEntry') return null;
      const entry = table.get(a.entry);
      if (entry === undefined) return null;
      const net = entryNet(ctx, h, entry, false);
      if (net === null) return null;
      return plan.ids.includes(a.entry) ? Math.max(net, 0.01) : Math.min(net, 0) + W.congressOffPlan;
    });
  }
  const step = frame.steps[frame.index];
  return actions.map((a) => {
    if (a.type === 'skipStep') return 0;
    if (a.type !== 'useStep' || step === undefined || TERRAIN_OF[step.type] === undefined) return null;
    const g = buildStep(ctx, { ...h }, step.type);
    return g > 0 ? g : -0.5;
  });
}

function scoreLayTracks(ctx, frame, actions) {
  const { state, pid, W, an } = ctx;
  getPlan(ctx);
  repeatGuard.note(state, pid);
  const h = holdings(ctx);
  const stepsAfter = frame.steps !== undefined ? frame.steps - 1 : frame.claimsLeft[0] + frame.claimsLeft[1];
  const coinCost = ctx.K.MAP_RULES.moveBuildCost;
  /** Best claim that could be made from a city with the tiles in hand. */
  const bestAt = (city, skipRoute) => {
    const ci = CI[city];
    let best = 0;
    for (const ri of ADJ[ci]) {
      if (an.own[ri] !== -1 || ri === skipRoute) continue;
      const r = RT[ri];
      if (!affordH(h, r.cost)) continue;
      const g = claimGain(ctx, h, makeCand(ctx, ri, city, r.ai === ci ? r.b : r.a, false), 0);
      if (g > best) best = g;
    }
    return best;
  };
  const t1 = ctx.t1;
  return actions.map((a) => {
    if (a.type === 'stopLaying') return 0;
    if (a.type === 'claimRoute') {
      const ri = RI[a.route];
      if (ri === undefined) return null;
      const r = RT[ri];
      let arrival = r.a === a.from ? r.b : r.a;
      if (ctx.network) {
        const net = networkCities(state, pid);
        if (net.includes(arrival)) arrival = null;
      }
      const cand = makeCand(ctx, ri, a.from, arrival, false);
      let g = claimGain(ctx, h, cand, 0);
      // With a step to spare, a claim that opens a second one is worth a little more.
      if (stepsAfter >= 1 && arrival !== null && !ctx.network) {
        for (const t of TERRAINS3) h[t] -= r.cost[t];
        g += 0.25 * bestAt(arrival, ri);
        for (const t of TERRAINS3) h[t] += r.cost[t];
      }
      return g;
    }
    if (a.type === 'moveTrain') {
      if (repeatGuard.wouldRepeat(state, a, pid)) return null;
      let v = W.moveBase;
      const there = bestAt(a.to, -1);
      v += stepsAfter >= 1 ? there * 0.98 : there * W.moveSetupFrac;
      if (t1 !== null && t1.move && t1.from === a.to && !affordH(h, t1.r.cost)) {
        let have = 0;
        for (const t of TERRAINS3) have += Math.min(h[t], t1.r.cost[t]);
        v += W.movePosition * (have / t1.r.len) * ctx.tileFactor;
      }
      // The paid building on arrival (R12.4).
      if (canPayH(h, coinCost)) {
        const bv = bestBuildingAt(ctx, a.to) - costValue(ctx, h, coinCost);
        if (bv > 0) v += bv;
      }
      // Leaving a city where this railhead had something to claim.
      const stays = ctx.player.railheads[0] === ctx.player.railheads[1];
      if (!stays) v -= bestAt(a.from, -1) * 0.8;
      const rs = state.map.railwayStation[a.to];
      if (rs !== undefined && rs !== null && rs !== pid) v -= W.tollGiven * ctx.flags.tollVp;
      return v;
    }
    if (a.type === 'placeTelegraphStation' || a.type === 'placeRailwayStation') {
      // A station step in network mode (R11.11.5): a step of the action and 2 Coins.
      const cost = ctx.K.MAP_RULES.stationStepCost;
      const kind = a.type === 'placeTelegraphStation' ? 'telegraphStation' : 'railwayStation';
      return buildingValue(ctx, a.city, kind, a.houseTrack || null) - costValue(ctx, h, cost) - 0.5;
    }
    return null;
  });
}

function scorePlaceBuildings(ctx, frame, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  const cost = frame.cost && Object.keys(frame.cost).length > 0 ? costValue(ctx, h, frame.cost) : 0;
  return actions.map((a) => {
    if (a.type === 'skipBuilding') return 0;
    if (a.type === 'placeTelegraphStation') return buildingValue(ctx, a.city, 'telegraphStation', null) - cost;
    if (a.type === 'placeRailwayStation') return buildingValue(ctx, a.city, 'railwayStation', a.houseTrack) - cost;
    return null;
  });
}

function scoreBonusAction(ctx, frame, actions) {
  const { state, pid, K, W, flags } = ctx;
  getPlan(ctx);
  const h = holdings(ctx);
  const free = frame.free === true;
  const printed = (bonus) => (free ? 0 : costValue(ctx, h, K.BONUS_ACTIONS[bonus].cost));
  const spare = W.resGeneric * ctx.resFactor;
  return actions.map((a) => {
    switch (a.type) {
      case 'skipBonusAction':
        return 0;
      case 'buyHat':
        return hatValueNow(ctx, h) - printed('hat');
      case 'addCarriage': {
        const v = carriageValue(ctx, a.carriage);
        return v === -INF ? null : v + (free ? 0 : flags.carriageRes * spare) - printed('carriage');
      }
      case 'hireSpecialist': {
        const slot = nextSpecialistSlot(ctx.player);
        if (slot === null) return null;
        const cost = hireCost(state, pid, a.specialist, free ? 'table' : 'bonusAction').cost;
        return specialistValue(ctx, a.specialist, slot.level) + (free ? 0 : flags.hireRes * spare) - costValue(ctx, h, cost);
      }
      case 'installUpgrade': {
        const tile = cardIndex(K.UPGRADE_TILES).get(a.tile);
        if (tile === undefined) return null;
        return upgradeValue(ctx, tile, a.level) - printed('upgrade');
      }
      default:
        return null;
    }
  });
}

function scoreHireFrame(ctx, frame, actions) {
  const { state, pid } = ctx;
  getPlan(ctx);
  const h = holdings(ctx);
  const slot = nextSpecialistSlot(ctx.player);
  return actions.map((a) => {
    if (a.type === 'skipEffect') return 0;
    if (a.type !== 'hireSpecialist' || slot === null) return null;
    const cost = frame.free ? {} : hireCost(state, pid, a.specialist, 'table').cost;
    return specialistValue(ctx, a.specialist, slot.level) - costValue(ctx, h, cost);
  });
}

function scoreAddCarriage(ctx, actions) {
  getPlan(ctx);
  return actions.map((a) => {
    if (a.type === 'skipEffect') return 0;
    if (a.type !== 'addCarriage') return null;
    const v = carriageValue(ctx, a.carriage);
    return v === -INF ? null : v;
  });
}

function scoreChooseResource(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  return actions.map((a) => (a.type === 'chooseResource' ? resUnit(ctx, h, a.resource) : null));
}

function scoreChooseBuiltTile(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  return actions.map((a) => (a.type === 'chooseBuiltTile' ? tileUnit(ctx, h, a.terrain) : null));
}

/** R8.5.4: throw away what is worth least. */
function scoreDiscard(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  return actions.map((a) => {
    if (a.type !== 'discard') return null;
    const item = a.item;
    if (h[item] === undefined) return null;
    h[item] -= 1;
    const v = phi(ctx, h, 0);
    h[item] += 1;
    return v;
  });
}

function scoreChooseOption(ctx, frame, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  return actions.map((a) => {
    if (a.type !== 'chooseOption') return null;
    const option = frame.options[a.option];
    if (option === undefined || !Array.isArray(option.effects)) return null;
    return effectsValue(ctx, { ...h }, option.effects);
  });
}

function scoreFreeCongress(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  const table = cardIndex(congressTable(ctx.state));
  return actions.map((a) => {
    if (a.type !== 'takeCongressEntry') return 0;
    const entry = table.get(a.entry);
    return entry === undefined ? null : entryNet(ctx, h, entry, true);
  });
}

/** What one standing effect of an ongoing or endgame card is worth over the turns left (R18.6). */
function standingValue(ctx, e) {
  const { W, state, pid } = ctx;
  const firstConns = ctx.horizon * W.firstConnRate;
  if (e.type === 'trigger') {
    const x = e.effect;
    switch (e.on) {
      case 'firstConnection':
        return x.type === 'vpPerSlot' ? x.amount * 2.8 * firstConns : x.amount * firstConns;
      case 'completeTranscontinental':
        return x.amount * ctx.pCross;
      case 'trainActivationStart':
        return ctx.acts * W.specUse * (trainCounts(ctx).total > 0 ? 1 : 0.3);
      case 'placeBuilding':
        return (x.count || 1) * 0.8 * Math.min(ctx.horizon * 0.1, 4);
      case 'gather':
        return ctx.horizon * W.gatherRate * (x.amount || 1) * 0.8;
      default:
        return null;
    }
  }
  if (e.type === 'modifier') {
    switch (e.what) {
      case 'congressCoinDiscount':
        return ctx.acts * 0.3 * W.coinNeeded * (trainCounts(ctx).financier > 0 ? 1 : 0.3);
      case 'congressCoinCost':
        return ctx.acts * 0.3 * W.coinNeeded * (trainCounts(ctx).financier > 0 ? 1 : 0.3);
      case 'tollVp':
        return (e.value - ctx.K.SCORING.tollVp) * buildings(ctx).rail[pid] * 0.3 * smooth(ctx.turnsLeft, 0, 12);
      case 'resetVpPerSenator':
        return 1.5 * (trainCounts(ctx).financier > 0 ? 1 : 0.3) * smooth(ctx.turnsLeft, 0, 10);
      case 'foremanAnyType':
        return W.cardForemanAny * smooth(ctx.turnsLeft, 0, 10);
      case 'telegraphRowVpMultiplier': {
        const row = ctx.K.PLAYER_BOARD.telegraphRowVp;
        const expected = Math.min(row.length - ctx.player.telegraphsPlaced, Math.round(ctx.horizon * 0.1));
        let v = 0;
        for (let i = 0; i < expected; i++) v += row[ctx.player.telegraphsPlaced + i] * (e.value - 1);
        return v;
      }
      case 'productionBonus':
        return ctx.horizon * W.gatherRate * W.avgM * W.prodUnit * e.amount;
      default:
        return null;
    }
  }
  if (e.type === 'oncePerTurn') {
    const x = e.effect;
    if (x.type === 'steps') return ctx.horizon * W.freeMovePerTurn;
    if (x.type === 'bonusAction') return ctx.horizon * W.freeBonusPerTurn;
    return null;
  }
  if (e.type === 'endVpPer') {
    const now = metricValue(state, pid, e.metric);
    const grow = e.metric === 'tokensCollected' ? firstConns : ctx.horizon * 0.04;
    return ((now === null ? 0 : now) + grow) * e.amount;
  }
  return null;
}

/** What buying a Pony Express card is worth, before its token cost (R18.5 to R18.7). */
function cardValue(ctx, h, card) {
  let v;
  if (card.kind === 'immediate') {
    v = effectsValue(ctx, { ...h }, card.effects);
    if (v === null) return null;
  } else {
    v = 0;
    for (const e of card.effects) {
      const one = standingValue(ctx, e);
      if (one === null) return null;
      v += one;
    }
  }
  return v * ctx.W.biasPony;
}

function scoreFreeActions(ctx, frame, actions) {
  const { state, pid, K, W } = ctx;
  getPlan(ctx);
  const h = holdings(ctx);
  const index = cardIndex(K.PONY_CARDS);
  const token = W.tokenValue;
  return actions.map((a) => {
    switch (a.type) {
      case 'endFreeActions':
        return 0;
      case 'buyPonyCard': {
        const card = index.get(a.card);
        if (card === undefined) return null;
        const v = cardValue(ctx, h, card);
        return v === null ? null : v - K.PONY.costs[card.rank] * token;
      }
      case 'exchangeToken': {
        // R18.4: only when the resource is needed now; a token is 1 VP at the end otherwise.
        const v = resUnit(ctx, h, a.resource);
        if (h.used >= h.cap) return -1;
        return v - token;
      }
      case 'usePonyCard': {
        const card = index.get(a.card);
        if (card === undefined) return null;
        for (const e of card.effects) {
          if (e.type !== 'oncePerTurn') continue;
          if (e.effect.type === 'steps') {
            // A free Move Train step (card 14): only towards target 1.
            const t1 = ctx.t1;
            if (t1 === null || !t1.move || ctx.heads.includes(t1.from)) return -1;
            if (repeatGuard.wouldRepeat(state, { type: 'moveTrain', from: ctx.heads[0], to: t1.from }, pid)) return -1;
            return W.movePosition * ctx.tileFactor;
          }
          if (e.effect.type === 'bonusAction') {
            // Any bonus action at no printed cost (card 28): worth it if any of the four is.
            let best = -1;
            const slot = nextSpecialistSlot(ctx.player);
            if (slot !== null) {
              for (const type of K.SPECIALIST_TYPES) {
                if (state.supply.specialists[type] <= 0) continue;
                const cost = hireCost(state, pid, type, 'table').cost;
                if (canPayH(h, cost)) best = Math.max(best, specialistValue(ctx, type, slot.level) - costValue(ctx, h, cost));
              }
            }
            if (h.hats < K.HATS.hatLimit) best = Math.max(best, hatValueNow(ctx, h));
            for (const kind of ['storage', 'specialist']) {
              const cv = carriageValue(ctx, kind);
              if (cv > best) best = cv;
            }
            const up = bestUpgrade(ctx);
            if (up !== null) best = Math.max(best, up.value);
            return best > 0.3 ? best : -1;
          }
        }
        return null;
      }
      default:
        return null;
    }
  });
}

function scoreForemanType(ctx, frame, actions) {
  getPlan(ctx);
  const m = frame.foremanTimes || ctx.K.TRAIN.cardActivationMultiplier;
  return actions.map((a) => (a.type === 'chooseForemanType' ? simActivation(ctx, holdings(ctx), a.specialist, m) : null));
}

function scoreSpecialistType(ctx, actions) {
  getPlan(ctx);
  const counts = trainCounts(ctx);
  const h = holdings(ctx);
  return actions.map((a) => {
    if (a.type !== 'chooseSpecialistType') return null;
    const per = a.specialist === 'financier' ? ctx.W.finUse : tileUnit(ctx, h, TERRAIN_OF[a.specialist]);
    return counts[a.specialist] * per;
  });
}

function scoreExtraActivation(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  const carriages = ctx.player.train.specialistCarriages;
  return actions.map((a) => {
    if (a.type !== 'chooseExtraActivation') return null;
    const carriage = carriages[a.level - 1];
    const s = carriage ? carriage.slots[a.slot - 1] : null;
    if (!s) return null;
    if (s === 'financier') return ctx.W.finUse;
    const t = TERRAIN_OF[s];
    return canPayH(h, ctx.recipe[t]) ? tileUnit(ctx, h, t) : 0.05;
  });
}

/** Card 11: give back what is worth least, if what comes back is worth more. */
function scoreExchange(ctx, actions) {
  getPlan(ctx);
  const h = holdings(ctx);
  const bestGain = resUnit(ctx, h, bestResource(ctx, h));
  return actions.map((a) => {
    if (a.type === 'skipEffect') return 0;
    if (a.type !== 'returnResource') return null;
    h[a.resource] -= 1;
    const loss = resUnit(ctx, h, a.resource);
    h[a.resource] += 1;
    return bestGain - loss - 0.05;
  });
}

// --- setup (R3.5, R3.6) ---------------------------------------------------------------------

function scorePlaceRailhead(ctx, actions) {
  const { state, pid, W, K } = ctx;
  const first = ctx.player.railheads[0];
  const S = K.SCORING;
  return actions.map((a) => {
    if (a.type !== 'placeRailhead') return null;
    const ci = CI[a.city];
    const far = WEST.includes(ci) ? EAST : WEST;
    let cross = INF;
    for (const f of far) cross = Math.min(cross, EMPTY_DIST[ci][f]);
    let local = 0;
    let crowd = 0;
    for (const ri of ADJ[ci]) {
      const r = RT[ri];
      const other = r.ai === ci ? r.bi : r.ai;
      local += (r.len + (IS_INLAND[other] ? S.firstConnectionVp : 0)) / (1 + r.len);
      // Rivals whose railhead already stands next to the same first city.
      for (const p of state.players) {
        if (p.id === pid) continue;
        for (const head of p.railheads) {
          if (head === null) continue;
          for (const rj of ADJ[CI[head]]) {
            const q = RT[rj];
            if (q.ai === other || q.bi === other) crowd += 1;
          }
        }
      }
    }
    // Inland cities within a few slots: room to make first connections before the rivals arrive.
    let reach = 0;
    for (let i = 0; i < N; i++) if (IS_INLAND[i] && EMPTY_DIST[ci][i] <= W.setupReachSlots) reach += 1;
    let v = -W.setupCross * cross + W.setupLocal * local + W.setupReach * reach - W.setupCrowd * crowd;
    if (first !== null && first !== undefined) v -= W.setupPair * EMPTY_DIST[CI[first]][ci];
    return v;
  });
}

function scoreStartingProduction(ctx, actions) {
  getPlan(ctx);
  // The resource the first two targets need most; Coins a little.
  const need = { iron: 0, wood: 0, gunpowder: 0, coins: 0.6 };
  for (const t of TERRAINS3) {
    const n = (ctx.t1 !== null ? ctx.t1.r.cost[t] : 0) + (ctx.t2 !== null ? ctx.t2.r.cost[t] : 0);
    for (const k in ctx.recipe[t]) need[k] += (n + ctx.demandT[t]) * ctx.recipe[t][k];
  }
  return actions.map((a) => (a.type === 'chooseStartingProduction' ? need[a.track] ?? null : null));
}

function scoreStartingSpecialist(ctx, actions) {
  getPlan(ctx);
  return actions.map((a) => {
    if (a.type !== 'chooseStartingSpecialist') return null;
    if (a.specialist === 'financier') return ctx.W.setupFinancier * ctx.W.biasCongress;
    const t = TERRAIN_OF[a.specialist];
    const n = (ctx.t1 !== null ? ctx.t1.r.cost[t] : 0) + (ctx.t2 !== null ? ctx.t2.r.cost[t] : 0);
    return n + ctx.demandT[t] * ctx.W[BIAS_OF[t]];
  });
}

/** Scores every legal action of the pending decision; entries are numbers or null. */
function scoreActions(ctx, frame, actions) {
  switch (frame.kind) {
    case 'workerStep':
      return scoreWorkerStep(ctx, actions);
    case 'chooseDistrict':
      return scoreChooseDistrict(ctx, actions);
    case 'trainActivation':
      return scoreTrainActivation(ctx, frame, actions);
    case 'layTracks':
      return scoreLayTracks(ctx, frame, actions);
    case 'placeBuildings':
      return scorePlaceBuildings(ctx, frame, actions);
    case 'bonusAction':
      return scoreBonusAction(ctx, frame, actions);
    case 'chooseResource':
      return scoreChooseResource(ctx, actions);
    case 'chooseBuiltTile':
      return scoreChooseBuiltTile(ctx, actions);
    case 'discard':
      return scoreDiscard(ctx, actions);
    case 'chooseOption':
      return scoreChooseOption(ctx, frame, actions);
    case 'addCarriage':
      return scoreAddCarriage(ctx, actions);
    case 'hireSpecialist':
      return scoreHireFrame(ctx, frame, actions);
    case 'freeActions':
      return scoreFreeActions(ctx, frame, actions);
    case 'freeCongress':
      return scoreFreeCongress(ctx, actions);
    case 'chooseForemanType':
      return scoreForemanType(ctx, frame, actions);
    case 'chooseSpecialistType':
      return scoreSpecialistType(ctx, actions);
    case 'chooseExtraActivation':
      return scoreExtraActivation(ctx, actions);
    case 'exchange':
      return scoreExchange(ctx, actions);
    case 'setupRailhead':
      return scorePlaceRailhead(ctx, actions);
    case 'setupProduction':
      return scoreStartingProduction(ctx, actions);
    case 'setupSpecialist':
      return scoreStartingSpecialist(ctx, actions);
    default:
      return actions.map(() => null);
  }
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/**
 * Scores the legal actions of `state` as Medium sees them. For tests, logs
 * and the UI's "why did the bot do that": `[{ action, score }]`, null scores
 * for actions the bot has no opinion about.
 */
export function scoreValidActions(state, context = {}) {
  const actions = getValidActions(state);
  const frame = topFrame(state);
  if (actions.length === 0 || frame === null) return [];
  const ctx = makeCtx(state, state.toAct, resolveWeights(context.weights));
  const scores = scoreActions(ctx, frame, actions);
  return actions.map((action, i) => ({ action, score: typeof scores[i] === 'number' && Number.isFinite(scores[i]) ? scores[i] : null }));
}

/** The plan Medium has in mind in `state`, in words a log can print. */
export function describePlan(state, context = {}) {
  if (state.toAct === null || state.toAct === undefined) return null;
  const ctx = getPlan(makeCtx(state, state.toAct, resolveWeights(context.weights)));
  const show = (c) => (c === null ? null : { route: c.r.id, from: c.from, value: Math.round(c.rv.total * 10) / 10, needsMove: c.move });
  return {
    player: state.toAct,
    turnsLeft: Math.round(ctx.turnsLeft * 10) / 10,
    crossingSlots: ctx.an.cross[state.toAct] >= INF ? null : ctx.an.cross[state.toAct],
    crossingChance: Math.round(ctx.pCross * 100) / 100,
    target1: show(ctx.t1),
    target2: show(ctx.t2),
    turnsToTarget1: ctx.t1 === null ? null : Math.round(ctx.E1 * 10) / 10,
  };
}

function choose(state, context, settings) {
  const actions = getValidActions(state);
  if (actions.length === 0) throw new Error('heuristicBot: there is no legal action (the game is over).');
  const frame = topFrame(state);
  const rng = context.rng;
  const weights = resolveWeights(context.weights); // throws on an unknown name: never swallowed below
  let scores;
  try {
    const ctx = makeCtx(state, state.toAct, weights);
    scores = scoreActions(ctx, frame, actions);
  } catch (err) {
    // Guard (a): whatever goes wrong in a scorer, a legal action still comes back.
    scores = null;
  }
  const jitter = (typeof context.jitter === 'number' ? context.jitter : 0) + (settings.jitter || 0);
  const noise = settings.noise || 0;
  const ranked = [];
  const unscored = [];
  for (let i = 0; i < actions.length; i++) {
    let s = scores === null ? null : scores[i];
    if (typeof s !== 'number' || !Number.isFinite(s)) {
      unscored.push(actions[i]);
      continue;
    }
    if (jitter > 0 && rng) s += rngNext(rng) * jitter;
    if (noise > 0 && rng) s += (rngNext(rng) * 2 - 1) * noise;
    ranked.push({ action: actions[i], score: s });
  }
  if (ranked.length === 0) {
    // Guards (a) and (d): nothing could be scored, so any legal action will do.
    return rng ? unscored[rngInt(rng, unscored.length)] : unscored[0];
  }
  // Highest score first; equal scores keep the order of getValidActions, so the choice is deterministic.
  let best = 0;
  for (let i = 1; i < ranked.length; i++) if (ranked[i].score > ranked[best].score) best = i;
  if (settings.topThreeChance > 0 && rng && ranked.length > 1 && rngNext(rng) < settings.topThreeChance) {
    const order = ranked.map((_, i) => i).sort((a, b) => ranked[b].score - ranked[a].score || a - b);
    return ranked[order[rngInt(rng, Math.min(3, order.length))]].action;
  }
  return ranked[best].action;
}

/**
 * Builds a heuristic bot. `settings`: `{ noise, topThreeChance, jitter }`
 * (all optional). The Medium level is `createHeuristicBot()`.
 */
export function createHeuristicBot(settings = {}) {
  return {
    /**
     * @param {object} state the game state (not changed)
     * @param {{ rng?: { s: number }, weights?: object, jitter?: number }} context
     *   `rng` the bot's own stream (used only for jitter, noise and the fallback);
     *   `weights` overrides of HEURISTIC_WEIGHTS; `jitter` a random tie-break in [0, jitter).
     * @returns {object} one of getValidActions(state)
     */
    chooseAction(state, context = {}) {
      return choose(state, context, settings);
    },
  };
}

/** Medium: the heuristic as it stands. */
export const heuristicBot = createHeuristicBot();

/** Easy: the same scores with strong noise, and often a pick among the top three. */
export const easyBot = createHeuristicBot(EASY_SETTINGS);

/** The policy as a plain function, `(state, context) -> action`. */
export function heuristicPolicy(state, context = {}) {
  return choose(state, context, {});
}

// ---------------------------------------------------------------------------
// The rollout policy: the same loop, by rules instead of by valuation
// ---------------------------------------------------------------------------
//
// For playouts inside a tree search. It aims for one route (the best value
// per missing tile among the routes at its railheads), wants exactly one
// district at a time (Lay Tracks if the route can be paid, else the train
// district that builds a missing tile it has the resources for, else the
// Gather for the resource it is shortest of), and answers every other
// decision by a fixed rule. No valuation, no simulation of activations: a
// few dozen operations per decision. It still finishes games by a real
// trigger, which is what a playout is for.

const DISTRICT_ROLES = new WeakMap();

/** Which district does what in this game (R5.1, R5.8). Fixed for a game, so memoised on its `grid.tiles` object. */
function districtRoles(state) {
  const tiles = state.grid.tiles;
  let memo = DISTRICT_ROLES.get(tiles);
  if (memo !== undefined) return memo;
  memo = { gather: {}, train: {}, lay: null };
  for (const d of DISTRICT_IDS) {
    const info = districtInfo(state, d);
    if (info.family === 'gather') memo.gather[info.gathers] = d;
    else if (info.family === 'trainActivation') memo.train[info.foremanType] = d;
    else if (info.family === 'layTracks') memo.lay = d;
  }
  DISTRICT_ROLES.set(tiles, memo);
  return memo;
}

/** The route the rollout policy aims for: `{ r, from, short, missing: { ground, tunnel, bridge } }` or null. */
function liteTarget(state, pid, an) {
  const player = state.players[pid];
  const tiles = player.builtTiles;
  const L = ROLLOUT_SETTINGS;
  let best = null;
  let bestScore = -1;
  const crossOpen = state.completion === null && an.cross[pid] < INF;
  const consider = (ri, from, other) => {
    const r = RT[ri];
    let value = r.len;
    if (other >= 0 && IS_INLAND[other] && an.claimedAt[other] === 0) value += L.firstConnection;
    if (crossOpen && crossThrough(an, pid, r) <= an.cross[pid]) value += an.cross[pid] <= r.len ? L.completion : L.crossingSlot * r.len;
    let short = 0;
    if (r.cost.ground > tiles.ground) short += r.cost.ground - tiles.ground;
    if (r.cost.tunnel > tiles.tunnel) short += r.cost.tunnel - tiles.tunnel;
    if (r.cost.bridge > tiles.bridge) short += r.cost.bridge - tiles.bridge;
    const score = value / (1 + short);
    if (score > bestScore) {
      bestScore = score;
      best = { r, from, short, missing: null };
    }
  };
  if (state.variants.claimFrom === 'network') {
    const inNet = new Array(N).fill(false);
    for (const c of player.startCities) if (c !== null) inNet[CI[c]] = true;
    for (let ri = 0; ri < R; ri++) {
      if (an.own[ri] !== pid) continue;
      inNet[RT[ri].ai] = true;
      inNet[RT[ri].bi] = true;
    }
    for (let ri = 0; ri < R; ri++) {
      if (an.own[ri] !== -1) continue;
      const r = RT[ri];
      if (inNet[r.ai]) consider(ri, r.a, inNet[r.bi] ? -1 : r.bi);
      else if (inNet[r.bi]) consider(ri, r.b, r.ai);
    }
  } else {
    for (let k = 0; k < player.railheads.length; k++) {
      const head = player.railheads[k];
      if (head === null || (k === 1 && head === player.railheads[0])) continue;
      const hi = CI[head];
      const adj = ADJ[hi];
      for (let i = 0; i < adj.length; i++) {
        const ri = adj[i];
        if (an.own[ri] !== -1) continue;
        consider(ri, head, RT[ri].ai === hi ? RT[ri].bi : RT[ri].ai);
      }
    }
  }
  if (best !== null) {
    const c = best.r.cost;
    best.missing = {
      ground: c.ground > tiles.ground ? c.ground - tiles.ground : 0,
      tunnel: c.tunnel > tiles.tunnel ? c.tunnel - tiles.tunnel : 0,
      bridge: c.bridge > tiles.bridge ? c.bridge - tiles.bridge : 0,
    };
  }
  return best;
}

/** The one district the rollout policy wants now. */
function liteWant(state, pid, target) {
  const roles = districtRoles(state);
  // No route at the railheads: Lay Tracks, to move on (R11.8). Target paid for: Lay Tracks, to claim it.
  if (target === null || target.short === 0) return roles.lay;
  const recipes = getConstants(state).TRAIN.recipes[state.variants.conversionRate];
  const res = state.players[pid].resources;
  let build = null;
  let most = 0;
  let shortRes = null;
  let shortBy = 0;
  for (let i = 0; i < 3; i++) {
    const t = TERRAINS3[i];
    const m = target.missing[t];
    if (m === 0) continue;
    const cost = recipes[SPEC_OF[t]].cost;
    let can = true;
    for (const k in cost) {
      if (res[k] < cost[k]) can = false;
      const lack = cost[k] * m - res[k];
      if (lack > shortBy) {
        shortBy = lack;
        shortRes = k;
      }
    }
    if (can && m > most) {
      most = m;
      build = t;
    }
  }
  // Build when nothing is lacking for the tiles still missing, or when storage is filling up.
  if (build !== null && (shortRes === null || res.iron + res.wood + res.gunpowder >= 6)) return roles.train[SPEC_OF[build]];
  if (shortRes !== null) return roles.gather[shortRes];
  return build !== null ? roles.train[SPEC_OF[build]] : roles.gather.coins;
}

function liteChoose(state, actions, rng) {
  const frame = topFrame(state);
  const pid = state.toAct;
  const player = state.players[pid];
  const L = ROLLOUT_SETTINGS;
  const rand = () => (rng ? rngNext(rng) : 0);
  const any = (list) => list[rng ? rngInt(rng, list.length) : 0];
  const find = (type) => {
    for (let i = 0; i < actions.length; i++) if (actions[i].type === type) return actions[i];
    return undefined;
  };
  switch (frame.kind) {
    case 'workerStep': {
      const want = liteWant(state, pid, liteTarget(state, pid, analyse(state)));
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        let score;
        if (a.type === 'placeWorker') {
          const ds = SPACE_DISTRICTS[a.space];
          score = ds[0] === want || ds[1] === want ? 10 : 1;
        } else if (a.type === 'removeWorker') {
          const ds = isDistrictId(a.from) ? null : SPACE_DISTRICTS[a.from];
          score = (ds === null ? a.from === want : ds[0] === want || ds[1] === want) ? 8 : 0.8;
        } else score = a.district === want ? 4 : 0.1;
        score += rand();
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      return best;
    }
    case 'chooseDistrict': {
      const want = liteWant(state, pid, liteTarget(state, pid, analyse(state)));
      let plain = null;
      let hat = null;
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.district !== want) continue;
        if (a.hat) hat = a;
        else plain = a;
      }
      if (hat !== null && player.hats >= 2) return hat;
      if (plain !== null) return plain;
      // The wanted district is not on offer: any other, without a hat.
      const rest = actions.filter((a) => !a.hat && a.district !== 'none');
      return rest.length > 0 ? any(rest) : actions[0];
    }
    case 'trainActivation': {
      if (frame.congress) {
        if (rand() < L.congressChance) {
          const tiles = actions.find((a) => a.type === 'takeCongressEntry' && (a.entry === 'C5' || a.entry === 'J5' || a.entry === 'J7'));
          if (tiles) return tiles;
          const entries = actions.filter((a) => a.type === 'takeCongressEntry');
          if (entries.length > 0) return any(entries);
        }
        return find('closeCongress');
      }
      const step = frame.steps[frame.index];
      const terrain = step ? TERRAIN_OF[step.type] : undefined;
      if (terrain === undefined) return find('skipStep');
      const target = liteTarget(state, pid, analyse(state));
      // The tile the target lacks; besides that, one spare of every terrain for the next route.
      const wanted = (target !== null && target.missing[terrain] > 0) || player.builtTiles[terrain] < 1;
      return find(wanted ? 'useStep' : 'skipStep');
    }
    case 'layTracks': {
      const an = analyse(state);
      repeatGuard.note(state, pid);
      const target = liteTarget(state, pid, an);
      let best = null;
      let bestScore = 0;
      let stop = null;
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        let score;
        if (a.type === 'claimRoute') {
          const r = RT[RI[a.route]];
          const other = r.a === a.from ? r.bi : r.ai;
          score = 100 + r.len + (IS_INLAND[other] && an.claimedAt[other] === 0 ? L.firstConnection : 0);
          if (target !== null && target.r === r) score += 50;
          if (state.completion === null && an.cross[pid] <= r.len && crossThrough(an, pid, r) <= an.cross[pid]) score += 200;
        } else if (a.type === 'moveTrain') {
          // Only away from a city with nothing left to claim, to one with something, and never back and forth.
          if (an.openAt[CI[a.to]] === 0 || an.openAt[CI[a.from]] > 0) continue;
          if (repeatGuard.wouldRepeat(state, a, pid)) continue;
          score = 10 + an.openAt[CI[a.to]];
        } else if (a.type === 'stopLaying') {
          stop = a;
          continue;
        } else continue;
        score += rand();
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      if (best !== null) return best;
      return stop !== null ? stop : repeatGuard.filter(state, actions, pid)[0];
    }
    case 'placeBuildings': {
      const tele = find('placeTelegraphStation');
      if (player.turnsTaken < L.railwayUntilTurn || tele === undefined) {
        const rails = actions.filter((a) => a.type === 'placeRailwayStation');
        if (rails.length > 0) {
          const target = liteTarget(state, pid, analyse(state));
          if (target !== null) {
            const recipes = getConstants(state).TRAIN.recipes[state.variants.conversionRate];
            for (const t of TERRAINS3) {
              if (target.missing[t] === 0) continue;
              for (const k in recipes[SPEC_OF[t]].cost) {
                const hit = rails.find((a) => a.houseTrack === k);
                if (hit) return hit;
              }
            }
          }
          return any(rails);
        }
      }
      return tele !== undefined ? tele : find('skipBuilding') || actions[0];
    }
    case 'bonusAction': {
      const vpTile = actions.find((a) => a.type === 'installUpgrade' && a.tile.endsWith('-vp'));
      if (vpTile) return vpTile;
      const install = find('installUpgrade');
      if (install) return install;
      const hat = find('buyHat');
      if (hat) return hat;
      const storage = actions.find((a) => a.type === 'addCarriage' && a.carriage === 'storage');
      if (storage && player.train.storageCarriages < 2) return storage;
      const hires = actions.filter((a) => a.type === 'hireSpecialist' && a.specialist !== 'financier');
      if (hires.length > 0 && player.turnsTaken < 14) return any(hires);
      return find('skipBonusAction') || actions[0];
    }
    case 'chooseResource':
    case 'chooseBuiltTile': {
      const target = liteTarget(state, pid, analyse(state));
      if (target !== null) {
        if (frame.kind === 'chooseBuiltTile') {
          for (let i = 0; i < actions.length; i++) if (target.missing[actions[i].terrain] > 0) return actions[i];
        } else {
          const recipes = getConstants(state).TRAIN.recipes[state.variants.conversionRate];
          for (const t of TERRAINS3) {
            if (target.missing[t] === 0) continue;
            const cost = recipes[SPEC_OF[t]].cost;
            for (let i = 0; i < actions.length; i++) {
              const r = actions[i].resource;
              if (cost[r] && player.resources[r] < cost[r] * target.missing[t]) return actions[i];
            }
          }
        }
      }
      return any(actions);
    }
    case 'discard': {
      // The resource held most of; built tiles last.
      let best = actions[0];
      let most = -1;
      for (let i = 0; i < actions.length; i++) {
        const n = player.resources[actions[i].item];
        if (n !== undefined && n > most) {
          most = n;
          best = actions[i];
        }
      }
      return best;
    }
    case 'freeActions': {
      if (rand() < L.cardChance) {
        const buy = find('buyPonyCard');
        if (buy) return buy;
      }
      return find('endFreeActions');
    }
    case 'freeCongress':
      return find('takeCongressEntry') || actions[0];
    case 'chooseOption':
      return actions[0];
    case 'addCarriage':
      return actions.find((a) => a.carriage === 'storage') || actions[0];
    case 'hireSpecialist': {
      const builders = actions.filter((a) => a.type === 'hireSpecialist' && a.specialist !== 'financier');
      return builders.length > 0 ? any(builders) : actions[0];
    }
    default:
      return any(actions);
  }
}

/**
 * A much cheaper policy with the same interface, for playouts:
 * `rolloutPolicy(state, { rng }) -> action`. Always one of
 * getValidActions(state); deterministic for a state and an rng.
 */
export function rolloutPolicy(state, context = {}) {
  const actions = getValidActions(state);
  if (actions.length === 0) throw new Error('rolloutPolicy: there is no legal action (the game is over).');
  const rng = context.rng;
  if (rng && rngNext(rng) < ROLLOUT_SETTINGS.epsilon) return actions[rngInt(rng, actions.length)];
  let chosen;
  try {
    chosen = liteChoose(state, actions, rng);
  } catch (err) {
    chosen = undefined; // guard (a): a legal action whatever happens
  }
  if (chosen === undefined || chosen === null || !actions.includes(chosen)) return actions[rng ? rngInt(rng, actions.length) : 0];
  return chosen;
}

/** The rollout policy as a bot object, for drivers that take `{ chooseAction }`. */
export const rolloutBot = {
  chooseAction(state, context = {}) {
    return rolloutPolicy(state, context);
  },
};
