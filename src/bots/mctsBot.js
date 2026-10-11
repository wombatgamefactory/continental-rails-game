// mctsBot.js - the search bot: Hard and Expert (src/bots/index.js).
//
// HOW IT PLAYS, IN ONE PARAGRAPH
//
// At every decision the bot grows a small search tree from the position in
// front of it. One iteration: take a copy of the position in which everything
// hidden has been re-drawn at random (`determinise`), walk down the tree
// choosing at each node the action with the best mix of "Medium likes it"
// (the prior, from `scoreValidActions`) and "it has done well so far" (the
// mean result), add one new node, then finish the game from there with the
// Medium policy playing every seat, and credit the final scores back up the
// path. After the allowance is spent the bot plays the root action that was
// visited most. It is the classic rollout improvement of a base policy: the
// bot asks, of every plausible move, "how does the game end if I do this and
// everybody then plays like Medium?", and so sees what Medium, scoring one
// action at a time, cannot: the whole turn, the opponent's reply, and the
// end of the game.
//
// THE PIECES
//
//   Tree policy   PUCT: mean result + exploration x prior x sqrt(parent visits) / (1 + visits).
//                 Priors are a softmax over Medium's scores, so the search
//                 starts from Medium's choice and widens only as visits allow
//                 (this is the progressive widening: an action nobody likes
//                 is not tried until its siblings have been visited often).
//   Open loop     A node is a sequence of actions from the root, not a state.
//                 The legal actions are asked afresh at every visit, so a
//                 different deal of the hidden cards can offer different
//                 actions at the same node without any special handling.
//   Expansion     One new node per iteration.
//   Playout       `heuristicPolicy` (Medium) for every seat, with a little
//                 jitter so that playouts differ; optionally the cheap
//                 `rolloutPolicy` after some turns, or a cut-off with a static
//                 evaluation (both measured and rejected, see MCTS_SETTINGS).
//   Result        For each player: their score margin over the best other
//                 player, squashed to 0..1, blended with a win bonus.
//   Backup        Every node is credited with the result OF THE PLAYER WHO
//                 CHOSE THERE (`state.toAct` when the action was picked), so a
//                 decision that falls to another player inside the tree (an
//                 overflow discard, a resource instead of a hat) is searched
//                 from that player's point of view.
//   Budget        PER TURN, not per decision: `timeBudgetMs` (or `iterations`)
//                 is what the bot may spend on one whole turn of its own. Each
//                 decision takes a share that depends only on what kind of
//                 decision it is (the worker step and the district choice set
//                 the plan and get most), read from the state, never from a
//                 counter.
//
// HIDDEN INFORMATION (R2.4). The first thing a search does is `blindCopy`:
// a clone whose hidden deck orders are sorted and whose game RNG is zeroed.
// Everything the search then sees is `determinise(blind, rng)`. So the result
// provably does not depend on the real order of any deck:
// tests/mcts.test.mjs scrambles the decks of a position and gets the same
// move with the same statistics.
//
// PURITY. No clock of its own (`context.now` is injected), no random numbers
// but `context.rng`, no output, no storage, nothing remembered between calls.
// The state passed in is never changed.
//
// TERMINOLOGY. As everywhere: `house` is only the production multiplier on
// the player board; buildings on the map are railway and telegraph stations;
// grid locations are districts. Building tiles and laying tiles are different
// actions (`useStep` builds, `claimRoute` lays).

import {
  getValidActions,
  applyAction,
  isGameOver,
  scoreGame,
  cloneState,
  determinise,
  hiddenDecks,
  actionKey,
  topFrame,
  forkRng,
  makeRng,
  SILENT,
} from '../engine/index.js';
import { heuristicBot, heuristicPolicy, rolloutPolicy, scoreValidActions, repeatGuard } from './heuristicBot.js';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
//
// ONE object. `context.mcts` overrides any entry for one call (the strength
// script uses it for A/B duels). "A/B" in a comment is a 2-player duel of the
// search with that one value changed against the search as it then stood,
// both at 120 iterations a turn, seats alternated, 64 or 69 games (standard
// error about 6 points); the figure is the share of games the CHANGED bot
// won. See docs/bots.md for how to repeat them. Entries with no A/B figure
// were set by reasoning and never tuned.

export const MCTS_SETTINGS = {
  // --- the tree policy
  /**
   * Exploration constant of PUCT. Results are in 0..1 and good moves differ by a few hundredths.
   * Was 0.6. A/B against 0.6: 0.25 won 48%, 1.5 won 62%. The three widenings adopted together (this, the
   * temperature and the jitter) then won only 50% of 64 against the three old values, so the gain is not established.
   */
  exploration: 1.5,
  /** Temperature of the softmax that turns Medium's scores (VP-equivalents) into priors. Was 1.5; A/B: 4 won 61%. */
  priorTemperature: 3,
  /** Score given to an action Medium has no opinion about, below the worst scored one. */
  unscoredBelow: 2,
  /** No prior is smaller than this (so every legal action can be reached with enough visits). */
  priorFloor: 0.01,
  /** An unvisited action is assumed to do this much worse than its parent's mean ("first-play urgency"). */
  firstPlayReduction: 0.05,
  /**
   * Nodes are added only for decisions of this many turns, counting the root's turn as 1 (0 = no limit).
   * A/B: 1 (the tree stops at the end of the bot's own turn) won 35%. Tried and reverted.
   */
  treeTurns: 0,

  // --- the playout
  /** Random tie-break handed to Medium in playouts (in its score units), so that playouts differ. Was 0.3; A/B: 0.05 won 39%. */
  playoutJitter: 0.6,
  /**
   * After this many turns of a playout the cheap rollout policy takes over from Medium (0 = Medium to the end).
   * A/B: 6 won 19% for 45% of the thinking time. Tried and reverted: the cheap policy plays too differently.
   */
  mediumTurns: 0,
  /**
   * Cut a playout after this many turns and evaluate statically (0 = play to the end of the game).
   * At equal iterations a cut at 10 turns won 42% for a third of the time. At about equal TIME: 10 turns with
   * three times the iterations won 59% of 64, 16 turns with 1.8 times the iterations 47% of 64. Not established
   * either way, and it rests on the crude evaluation below, so playouts run to the end. Worth another look.
   */
  maxPlayoutTurns: 0,
  /** Hard cap on the decisions of one playout (a livelock guard; a game is a few hundred decisions). */
  maxPlayoutDecisions: 4000,

  // --- the result
  /** A margin of this many VP over the best other player gives tanh(1) = 0.76 of the full margin credit. */
  marginScale: 30,
  /** Share of the result that is "came first" (the rest is the squashed margin). A/B: 0 won 54% (no effect seen). */
  winWeight: 0.3,
  /** Static evaluation at a cut-off (used only with maxPlayoutTurns > 0): VP-equivalents of what is in the pipeline. */
  evalBuiltTile: 2.0,
  evalResource: 0.5,
  evalCoin: 0.25,
  evalHat: 1.0,

  // --- the share of the per-turn allowance each decision gets
  // Set so that a turn costs about the budget: in the browser a Hard turn took 1.42 s on average and 2.4 s at most
  // (25 turns), an Expert turn 5.1 s and 7.9 s (20 turns). A first set 20% lower gave 0.9 s and was raised.
  /** The free-action opportunity before the worker step (R4.4). */
  shareFreeBefore: 0.1,
  /** The worker step (R4.2 step 2): where the plan of the turn is set. */
  shareWorker: 0.5,
  /** The district choice (step 3). */
  shareDistrict: 0.25,
  /** A Lay Tracks / Move Train decision: which route, which move. */
  shareLayTracks: 0.2,
  /** A building after a claim or a move. */
  shareBuilding: 0.1,
  /** Any other decision of the bot's own turn (a step of a train activation, a Congress entry, a bonus action). */
  shareFollowUp: 0.06,
  /** A decision that falls to the bot in another player's turn (a discard, a resource instead of a hat). */
  shareOffTurn: 0.06,
  /** Each decision of setup (railheads, starting production, starting specialist). */
  shareSetup: 0.3,

  // --- stopping and the final choice
  /** With fewer iterations than this for a decision the bot does not search: it plays Medium's choice. */
  minIterations: 8,
  /** Stop early when the most visited action cannot be caught in what is left of the allowance. */
  earlyExit: true,
  /** How often (in iterations) the early exit is tested. */
  earlyExitEvery: 8,
  /**
   * The search leaves Medium's choice only if the action it prefers has a mean result at least this much
   * higher than Medium's choice (0 = always play the most visited action).
   */
  deviationMargin: 0,

  // --- the levels (src/bots/index.js): thinking time per TURN, and the iteration allowance used when no clock is given
  // Calibration (tests/mcts-strength.mjs --calibrate, one core, on a machine shared with other jobs): 180 to 400
  // iterations a second over a game, so 1.5 s is 270 to 600 iterations. 300 and 1200 are the cautious end.
  hardTimeBudgetMs: 1500,
  expertTimeBudgetMs: 6000,
  hardIterations: 300,
  expertIterations: 1200,
};

/** MCTS_SETTINGS with `overrides` laid over it; throws on an unknown name so that a misspelt override cannot run the baseline. */
export function resolveSettings(overrides) {
  if (overrides === null || overrides === undefined) return MCTS_SETTINGS;
  if (typeof overrides !== 'object') throw new Error('mctsBot: `mcts` must be an object of overrides of MCTS_SETTINGS.');
  for (const name of Object.keys(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(MCTS_SETTINGS, name)) {
      throw new Error(`mctsBot: unknown setting "${name}". The settings are: ${Object.keys(MCTS_SETTINGS).join(', ')}.`);
    }
  }
  return { ...MCTS_SETTINGS, ...overrides };
}

// ---------------------------------------------------------------------------
// Hidden information
// ---------------------------------------------------------------------------

/**
 * A clone of `state` with nothing hidden left in it: every hidden deck is put
 * in a fixed order (sorted) and the game RNG is zeroed. The search works from
 * this copy only, so no result can depend on the real order of a deck.
 */
export function blindCopy(state) {
  const copy = cloneState(state);
  for (const deck of hiddenDecks(copy)) deck.sort();
  copy.rng = { s: 0 };
  return copy;
}

// ---------------------------------------------------------------------------
// The budget of one decision, read from the state
// ---------------------------------------------------------------------------

/** The share of the per-turn allowance that the pending decision of `state` gets. */
export function decisionShare(state, S = MCTS_SETTINGS) {
  if (state.phase !== 'play') return S.shareSetup;
  if (state.turn.player !== state.toAct) return S.shareOffTurn;
  const frame = topFrame(state);
  switch (frame === null ? '' : frame.kind) {
    case 'workerStep':
      return S.shareWorker;
    case 'chooseDistrict':
      return S.shareDistrict;
    case 'layTracks':
      return S.shareLayTracks;
    case 'placeBuildings':
      return S.shareBuilding;
    case 'freeActions':
      return frame.which === 'before' ? S.shareFreeBefore : S.shareFollowUp;
    default:
      return S.shareFollowUp;
  }
}

// ---------------------------------------------------------------------------
// The result of a finished (or cut-off) playout
// ---------------------------------------------------------------------------

function pipelineValue(player, S) {
  const t = player.builtTiles;
  const r = player.resources;
  return (t.ground + t.tunnel + t.bridge) * S.evalBuiltTile + (r.iron + r.wood + r.gunpowder) * S.evalResource + player.coins * S.evalCoin + player.hats * S.evalHat;
}

/** One number in 0..1 per player: the squashed margin over the best other player, blended with "came first". */
function resultOf(state, S, out) {
  const score = scoreGame(state);
  const n = score.players.length;
  const over = isGameOver(state);
  const totals = [];
  for (let p = 0; p < n; p++) totals.push(score.players[p].total + (over ? 0 : pipelineValue(state.players[p], S)));
  for (let p = 0; p < n; p++) {
    let best = -Infinity;
    for (let q = 0; q < n; q++) if (q !== p && totals[q] > best) best = totals[q];
    const margin = totals[p] - best;
    const first = over ? (score.players[p].rank === 1 ? 1 : 0) : margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    out[p] = (1 - S.winWeight) * (0.5 + 0.5 * Math.tanh(margin / S.marginScale)) + S.winWeight * first;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

function makeNode() {
  return { visits: 0, value: 0, children: null };
}

/** Priors over `scored` (the output of scoreValidActions): a softmax of Medium's scores with a floor. */
function priorsOf(scored, S) {
  let worst = Infinity;
  let best = -Infinity;
  for (const entry of scored) {
    if (entry.score === null) continue;
    if (entry.score < worst) worst = entry.score;
    if (entry.score > best) best = entry.score;
  }
  if (best === -Infinity) return scored.map(() => 1 / scored.length);
  const fallback = worst - S.unscoredBelow;
  const raw = [];
  let sum = 0;
  for (const entry of scored) {
    const s = entry.score === null ? fallback : entry.score;
    const w = Math.exp((s - best) / S.priorTemperature);
    raw.push(w);
    sum += w;
  }
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    raw[i] = Math.max(raw[i] / sum, S.priorFloor);
    total += raw[i];
  }
  for (let i = 0; i < raw.length; i++) raw[i] /= total;
  return raw;
}

/**
 * The legal actions of `sim` as Medium scores them; if a scorer fails, the
 * plain list with no scores (the search then treats them alike).
 */
function scoredActions(sim) {
  try {
    const scored = scoreValidActions(sim);
    if (scored.length > 0) return scored;
  } catch (err) {
    // fall through: a legal list whatever happens
  }
  return getValidActions(sim).map((action) => ({ action, score: null }));
}

/** Picks the child of `node` to follow in `sim`; returns `{ action, child }`. */
function selectChild(node, sim, S, rootFilter) {
  let scored = scoredActions(sim);
  if (rootFilter !== null) {
    const kept = scored.filter((entry) => rootFilter(entry.action));
    if (kept.length > 0) scored = kept;
  }
  const priors = priorsOf(scored, S);
  if (node.children === null) node.children = new Map();
  const parentMean = node.visits > 0 ? node.value / node.visits : 0.5;
  const root = Math.sqrt(Math.max(1, node.visits));
  let bestIndex = 0;
  let bestScore = -Infinity;
  let bestChild = null;
  let bestKey = null;
  for (let i = 0; i < scored.length; i++) {
    const key = actionKey(scored[i].action);
    const child = node.children.get(key);
    const visits = child === undefined ? 0 : child.visits;
    const mean = visits > 0 ? child.value / visits : parentMean - S.firstPlayReduction;
    const u = mean + (S.exploration * priors[i] * root) / (1 + visits);
    if (u > bestScore) {
      bestScore = u;
      bestIndex = i;
      bestChild = child === undefined ? null : child;
      bestKey = key;
    }
  }
  if (bestChild === null) {
    bestChild = makeNode();
    bestChild.key = bestKey;
    bestChild.action = scored[bestIndex].action;
    bestChild.prior = priors[bestIndex];
    node.children.set(bestKey, bestChild);
  }
  return bestChild;
}

/** Plays `sim` on with the playout policy until the game ends or the cut-off. */
function playout(sim, rng, S, turnZero) {
  const policyContext = { rng, jitter: S.playoutJitter };
  let decisions = 0;
  while (!isGameOver(sim) && decisions < S.maxPlayoutDecisions) {
    const ahead = sim.turn.number - turnZero;
    if (S.maxPlayoutTurns > 0 && ahead >= S.maxPlayoutTurns) break;
    const cheap = S.mediumTurns > 0 && ahead >= S.mediumTurns;
    const action = cheap ? rolloutPolicy(sim, policyContext) : heuristicPolicy(sim, policyContext);
    applyAction(sim, action, SILENT);
    decisions += 1;
  }
}

/**
 * The search itself. Returns `{ action, searched, iterations, children, reason }`:
 * `action` is always one of getValidActions(state); `children` lists the root
 * actions tried, most visited first (`{ action, visits, mean, prior }`), for
 * tests, logs and the strength script.
 *
 * @param {object} state the real state (never changed)
 * @param {object} context the bot context (docs/engine-contract.md, section 14) plus
 *   `mcts` (overrides of MCTS_SETTINGS) and the level's `defaults`
 */
export function search(state, context = {}) {
  const S = resolveSettings(context.mcts);
  const defaults = context.defaults || { timeBudgetMs: S.hardTimeBudgetMs, iterations: S.hardIterations };
  const legal = getValidActions(state);
  if (legal.length === 0) throw new Error('mctsBot: there is no legal action (the game is over).');
  const rng = context.rng || makeRng('mcts');
  const medium = () => heuristicBot.chooseAction(state, { rng, weights: context.weights, jitter: context.jitter });

  // --- the allowance of this decision
  const share = decisionShare(state, S);
  const now = typeof context.now === 'function' ? context.now : null;
  const fixed = typeof context.iterations === 'number';
  let maxIterations;
  let deadline = null;
  let started = 0;
  if (fixed) {
    maxIterations = Math.floor(context.iterations * share);
  } else {
    const turnBudget = typeof context.timeBudgetMs === 'number' ? context.timeBudgetMs : defaults.timeBudgetMs;
    if (!(turnBudget > 0)) return { action: medium(), searched: false, iterations: 0, children: [], reason: 'no budget' };
    if (now === null) {
      // No clock: the level's own iteration allowance, scaled if a different time was asked for.
      maxIterations = Math.floor(defaults.iterations * (turnBudget / defaults.timeBudgetMs) * share);
    } else {
      maxIterations = Infinity;
      started = now();
      deadline = turnBudget * share;
    }
  }
  if (maxIterations < S.minIterations) return { action: medium(), searched: false, iterations: 0, children: [], reason: 'allowance too small' };

  // --- the root
  const blind = blindCopy(state);
  const me = state.toAct;
  const turnZero = state.turn.number;
  let rootFilter = null;
  const frame = topFrame(state);
  if (frame !== null && frame.kind === 'layTracks') {
    // Anti-livelock guard (c) of the heuristic bot: never shuttle a railhead back to a layout just left.
    repeatGuard.note(state, me);
    rootFilter = (action) => !repeatGuard.wouldRepeat(state, action, me);
  }
  const root = makeNode();
  const result = [];
  const path = [];
  const players = [];
  let iterations = 0;
  let reason = 'allowance spent';

  while (iterations < maxIterations) {
    if (deadline !== null && now() - started >= deadline) {
      reason = 'time spent';
      break;
    }
    const iterationRng = forkRng(rng);
    const sim = determinise(blind, iterationRng);
    path.length = 0;
    players.length = 0;
    let node = root;
    // Selection and expansion: walk down until a node is new, the tree limit is passed or the game ends.
    while (!isGameOver(sim)) {
      if (S.treeTurns > 0 && sim.turn.number - turnZero >= S.treeTurns && node !== root) break;
      const child = selectChild(node, sim, S, node === root ? rootFilter : null);
      players.push(sim.toAct);
      path.push(child);
      applyAction(sim, child.action, SILENT);
      if (child.visits === 0) break;
      node = child;
    }
    playout(sim, iterationRng, S, turnZero);
    resultOf(sim, S, result);
    // Backup: each node is credited with the result of the player who chose there.
    root.visits += 1;
    root.value += result[me];
    for (let i = 0; i < path.length; i++) {
      path[i].visits += 1;
      path[i].value += result[players[i]];
    }
    iterations += 1;

    if (S.earlyExit && iterations % S.earlyExitEvery === 0 && root.children !== null) {
      let first = 0;
      let second = 0;
      for (const child of root.children.values()) {
        if (child.visits > first) {
          second = first;
          first = child.visits;
        } else if (child.visits > second) second = child.visits;
      }
      let left = maxIterations - iterations;
      if (deadline !== null) {
        const elapsed = now() - started;
        left = elapsed > 0 ? (iterations * (deadline - elapsed)) / elapsed : Infinity;
      }
      if (first - second > left) {
        reason = 'one action cannot be caught';
        break;
      }
    }
  }

  if (iterations < S.minIterations || root.children === null || root.children.size === 0) {
    return { action: medium(), searched: false, iterations, children: [], reason: 'too few iterations' };
  }

  // --- the final choice: the most visited root action; ties by mean, then by prior.
  const children = Array.from(root.children.values())
    .filter((child) => child.visits > 0)
    .map((child) => ({ action: child.action, key: child.key, visits: child.visits, mean: child.value / child.visits, prior: child.prior }));
  children.sort((a, b) => b.visits - a.visits || b.mean - a.mean || b.prior - a.prior);
  let pick = children[0];
  if (S.deviationMargin > 0) {
    let liked = children[0];
    for (const child of children) if (child.prior > liked.prior) liked = child;
    if (liked !== pick && pick.mean - liked.mean < S.deviationMargin) pick = liked;
  }
  // The action handed back is the engine's own object for it, looked up by key in the real list.
  const byKey = new Map(legal.map((action) => [actionKey(action), action]));
  const action = byKey.get(pick.key);
  if (action === undefined) return { action: medium(), searched: false, iterations, children, reason: 'chosen action not in the legal list' };
  return { action, searched: true, iterations, children, reason };
}

// ---------------------------------------------------------------------------
// The bots
// ---------------------------------------------------------------------------

/**
 * Builds a search bot. `level` is `{ timeBudgetMs, iterations }`: the default
 * thinking time per turn, and the per-turn iteration allowance used when the
 * driver gives no clock.
 */
export function createMctsBot(level) {
  return {
    /**
     * @param {object} state the game state (not changed)
     * @param {object} context `rng`, `timeBudgetMs` (per TURN; null = the level's default; 0 = play Medium's
     *   choice), `iterations` (per TURN, in place of the clock), `now`, and optionally `mcts`, `weights`, `jitter`
     * @returns {object} one of getValidActions(state)
     */
    chooseAction(state, context = {}) {
      return search(state, { ...context, defaults: level }).action;
    },
  };
}

/** Hard: about 1.5 seconds of search per turn. */
export const hardBot = createMctsBot({ timeBudgetMs: MCTS_SETTINGS.hardTimeBudgetMs, iterations: MCTS_SETTINGS.hardIterations });

/** Expert: about 6 seconds of search per turn. */
export const expertBot = createMctsBot({ timeBudgetMs: MCTS_SETTINGS.expertTimeBudgetMs, iterations: MCTS_SETTINGS.expertIterations });
