// weights-pr2e.js - the tuning constants of the "Pacific Rails, second edition"
// heuristic bot (src/bots/pr2e/heuristicBot-pr2e.js).
//
// ONE object, like HEURISTIC_WEIGHTS of the Continental Rails bot. Values are
// in VP-equivalents unless a comment says otherwise. `context.weights`
// overrides any entry for one bot (the simulator's `--weights.<name>=<n>`).
// Nothing here depends on the engine.

export const PR2E_WEIGHTS = {
  // --- how long the game is expected to last (for the value of an investment)
  /** Turns a player is expected to take in all. Measured in Medium-versus-Medium tables. */
  gameLength: 24,
  /** Slots one player lays in a turn on average, for "how far off is the end" (slots still to lay across the map, over this and the players). */
  slotsPerTurn: 0.6,
  /** Turns an end still needs once the crossing is laid out, however short it is. */
  endBaseTurns: 4,
  /** The fewest turns an investment is judged over while the game is running. */
  minTurnsLeft: 2,

  // --- the turn model behind "how many turns to lay this" (turnsToGo)
  /** Typical multiplier of a Collect, and Foreman steps in one activation. */
  avgM: 2.2,
  avgForeman: 1.5,
  /** A Collect for a missing resource costs its share of a turn plus this. */
  turnRound: 0.35,
  /** A target's plan counts for this share of its value once its tiles are all built (the lay is still to do). */
  progressShare: 1.0,

  // --- units
  /** A Coin: it buys Congress columns and special actions. The first coins are worth most. */
  coin: 2.2,
  coinFade: 0.18,
  coinFloor: 0.25,
  /** A cowboy hat: one more action bonus. */
  hat: 1.2,
  /** A resource beyond what the two targets need: it can still be built into a tile, which is 1 VP at the end. */
  resSurplus: 0.35,
  /** Surplus resources beyond this many of a kind are worth nothing. */
  resSurplusCap: 4,
  /** A built tile beyond what the targets need: 1 VP at the end (P20.2.2). */
  tileSurplus: 1.0,
  /** Progress on target 2 counts for this share of its value. */
  secondDiscount: 0.2,
  /** Collecting a resource also scores what a special action it enables is worth, times this. */
  specialShare: 0.5,
  /** A step of an activation that builds a tile nobody needs is used only while at least this many units of the resource remain. */
  keepResource: 1,

  // --- the lay
  /** Longest path a plan looks at (routes), and most unlaid routes in it. */
  maxRoutes: 3,
  maxUnlaid: 2,
  /** Planning paths are cut after this many candidates (a livelock and a speed guard). */
  maxCandidates: 700,
  /** Each VP a toll pays a rival costs this many of mine (the rival gains it too). */
  tollPaid: 1.6,
  /** A toll a building can expect, per route that meets its city beyond the second, at its best. */
  tollPotential: 0.9,
  /** A turn's worth of laying a plan counts for even when its tiles are held: laying now beats holding. */
  layUrgency: 0.5,
  /** Tiles spent in a lay are worth this each had they been kept to the end. */
  tileKept: 0.9,
  /** Divisor of the lay value when ranking targets: turns plus this. */
  targetRound: 0.5,
  /** A second lay in the same action is worth this share of the best other lay. */
  secondLay: 0.8,
  /** Each lay in one action after the first (hat or workers): the share of its value kept when a tile mix cannot cover two. */
  stopLayBelow: 1.0,

  // --- buildings
  /** Where a building will stand in the table at the end: the marginal VP are taken this many buildings further on. */
  tableAhead: 1.5,
  /** A railway station's extra production is worth this many uses of the resource per turn left. */
  prodUses: 0.13,
  /** One unit of production, in VP-equivalents (fixed: building values come before the targets). */
  prodUnit: 1.1,
  /** Coin production is worth this much more than another resource's (Congress). */
  coinProdBonus: 1.15,
  /** Carriages 1, 2 and 3 from railway stations placed by Lay Track (P16.5). */
  carriageValue: [7, 4.5, 4.5],
  /** A railway station keeps houses off the district sites: a small cost per house. */
  houseCost: 0.4,
  /** A district house: 2 VP, production, and one more of that district's resource whenever it is collected. */
  districtHouseUses: 0.1,
  /** Upgrade: uses a turn. */
  upgradeUses: 0.5,

  // --- specialists
  /** Share of the turns left that are board activations. */
  activationShare: 0.3,
  /** At most this many activations are counted when valuing a specialist. */
  activationCap: 7,
  /** Chance a builder's resource is in storage when its step comes up. */
  stepChance: 0.55,
  /** One Financier action. */
  financierUse: 1.8,
  /** A carriage 3 space prints its VP (P8.4): counted in full. */

  // --- Congress
  /** The value of a column's hats and tiles etc. is worked out from the units; these only scale. */
  congressBias: 0.0,
  /** A Reset's senators count this each (1 VP each). */
  resetVp: 1.0,

  // --- goals
  /** Goals are worth this share of their 5 VP now, rising to all of it at the end. */
  goalCertaintyMin: 0.25,
  goalHorizon: 25,
  /** A stored-resource goal (Iron, Coins, Gunpowder, Wood) is worth this share, until the last turns. */
  storedGoalShare: 0.3,

  // --- the end of the game
  /** Crossing: the VP-equivalent of each slot of progress along the cheapest chain, from the start, and added per turn taken after crossFrom. */
  crossBase: 0.25,
  crossPerTurn: 0.08,
  crossFrom: 8,
  /** When a lay completes the line: the bonus if it leaves the player ahead, and the penalty rate if behind. */
  raceBonus: 4,
  racePenaltyRate: 0.5,
  raceMaxPenalty: 14,
  /** VP a rival is expected to add in each turn left in the round once the end is triggered. */
  vpPerTurn: 4,

  // --- the worker step
  /** The share of the gain from one more worker next to a district that a placement counts now. */
  futureShare: 0.35,
  /** Displacing: each rival worker sent home is worth this to the rival (a hat) and costs them their place. */
  displaceCost: 0.4,

  // --- set-up
  /** Which house track starts with its +1 space empty (production 2). */
  startProduction: { coins: 1.2, iron: 1.0, gunpowder: 0.9, wood: 0.9 },
  /** Set-up train: slots of a crossing from the city, and the distance between a player's two trains. */
  startCrossing: 0.5,
  startApart: 0.15,
  startHub: 0.3,
};

/** Settings of the Easy level (src/bots/index.js): noise on every score, and a chance of a pick among the top three. */
export const PR2E_EASY_SETTINGS = {
  noise: 1.0,
  topThreeChance: 0.2,
  /** Easy plans one lay at a time and never counts a rival: it ignores this many turns of its horizon. */
  shortSighted: true,
};

/**
 * How the tree search spends its time on pr2e decisions (src/bots/mctsBot.js hands `MCTS_SETTINGS` to
 * `decisionShare`; these scale what it finds there).
 */
export const PR2E_SEARCH_SETTINGS = {
  /**
   * Every share of a turn's allowance is multiplied by this. A playout costs about twice a Continental Rails
   * playout, and a decision cannot stop in the middle of one, so with the Continental Rails shares an Expert turn
   * took 5.8 s on average and 8.8 s at the 95th percentile against 5.0 and 7.2 for Continental Rails (Node,
   * one game each, 6 s budget). 0.8 brings it level.
   */
  shareScale: 0.8,
};

/** Settings of `rolloutPolicy`. */
export const PR2E_ROLLOUT_SETTINGS = {
  /** Chance that a decision is a uniformly random legal action, so that playouts differ. */
  epsilon: 0.03,
};

const WEIGHT_CACHE = new WeakMap();

/**
 * PR2E_WEIGHTS with `overrides` laid over it. Throws on a name that is not a
 * weight or a value that is not a finite number (or, for startProduction, an
 * object), so that a misspelt override can never quietly run the baseline.
 */
export function resolvePr2eWeights(overrides) {
  if (overrides === null || overrides === undefined) return PR2E_WEIGHTS;
  if (typeof overrides !== 'object') throw new Error('pr2e heuristic bot: `weights` must be an object of overrides of PR2E_WEIGHTS.');
  const cached = WEIGHT_CACHE.get(overrides);
  if (cached) return cached;
  for (const name of Object.keys(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(PR2E_WEIGHTS, name)) {
      throw new Error(`pr2e heuristic bot: unknown weight "${name}". The weights are: ${Object.keys(PR2E_WEIGHTS).join(', ')}.`);
    }
    const base = PR2E_WEIGHTS[name];
    const value = overrides[name];
    if (typeof base === 'number' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`pr2e heuristic bot: weight "${name}" must be a finite number.`);
    }
  }
  const resolved = { ...PR2E_WEIGHTS, ...overrides };
  WEIGHT_CACHE.set(overrides, resolved);
  return resolved;
}
