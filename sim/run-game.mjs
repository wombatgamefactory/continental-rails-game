// run-game.mjs - plays ONE game and returns its compact record.
//
// The driver is the same loop the browser runs (docs/engine-contract.md, section 1):
//
//   ask the bot of state.toAct  ->  applyAction(state, what it chose)  ->  repeat
//
// It never switches on action types to apply them, and never touches a state field
// to "help" a game along. A game is a pure function of (config, game seed, bot seeds):
//
//   game seed   "<--seed>-<game index>"                        -> config.seed
//   bot streams "bots:<game seed>:<seat>", one per seat, forked once per decision
//
// so game k is the same game whatever the thread count or the order games are played in.

import {
  createGame,
  getValidActions,
  applyAction,
  isGameOver,
  scoreGame,
  topFrame,
  hashState,
  makeRng,
  forkRng,
  SILENT,
} from '../src/engine/index.js';
import { getBot } from '../src/bots/index.js';
import { createTally, tallyEvents, finishTrace, finalMetrics, sortedCounters, FINAL_SOURCES } from './metrics.mjs';
import { sortedKeys } from './stats.mjs';

const clock = () => performance.now();

function mod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Which bot slot (index into plan.bots) sits at each config position, for game `index`.
 * Without --rotate the order is the order given. With --rotate slot j sits at position
 * (j + index) mod players, so over `players` consecutive games each slot meets each position.
 * Positions become seats directly (shuffleSeats off) or are shuffled by the engine.
 */
export function slotOrder(plan, index) {
  const P = plan.players;
  const order = [];
  for (let c = 0; c < P; c++) order.push(plan.rotate ? mod(c - index, P) : c);
  return order;
}

/** The seed of game `index` (the same in every arm). */
export function gameSeed(plan, index) {
  return `${plan.seed}-${index}`;
}

/**
 * Plays game `index` of arm `armName` and returns its record.
 * A game that fails (refused action, decision cap, crash, bookkeeping mismatch) still
 * returns a record, with `failed` set, so the run can report it and exit non-zero.
 */
export function runGame(plan, armName, index) {
  const arm = plan.arms.find((a) => a.name === armName);
  const P = plan.players;
  const seed = gameSeed(plan, index);
  const full = plan.mode === 'full';
  const started = performance.now();
  const record = { index, seed };

  let state = null;
  try {
    const order = slotOrder(plan, index);
    const config = {
      playerCount: P,
      players: order.map((slot, c) => ({ name: `Player ${c + 1}` })),
      seed,
      variants: arm.variants,
      shuffleSeats: plan.shuffleSeats,
    };
    if (Object.keys(arm.constants).length > 0) config.constants = arm.constants;
    state = createGame(config);

    // Who is who. state.players[p].configIndex is the position in config.players.
    const slotOfSeat = state.players.map((p) => order[p.configIndex]);
    const bots = slotOfSeat.map((slot) => plan.bots[slot]);
    const impl = bots.map((b) => getBot(b.level));
    const botRng = bots.map((_, seat) => makeRng(`bots:${seed}:${seat}`));
    const contexts = bots.map((b) => {
      const ctx = { timeBudgetMs: plan.budget, iterations: plan.iterations, now: clock };
      if (plan.jitter !== null) ctx.jitter = plan.jitter;
      if (b.weights) ctx.weights = b.weights;
      return ctx;
    });

    record.seats = bots.map((b) => b.type);
    record.startPlayer = state.startPlayer;

    const tally = full ? createTally(P) : null;
    const chosen = Array.from({ length: P }, () => ({}));
    let decisions = 0;
    let setupDecisions = 0;
    let failed = null;

    // Legal-action statistics (full mode).
    let legalN = 0;
    let legalSum = 0;
    let legalDistinct = 0;
    let legalMax = 0;
    let turnStartN = 0;
    let turnStartSum = 0;
    let turnStartDistinct = 0;
    const byKind = {};
    let lastTurn = -1;
    const seen = [];

    while (!isGameOver(state)) {
      if (decisions >= plan.maxDecisions) {
        failed = { type: 'cap', seat: state.toAct, hash: hashState(state), reason: `${decisions} decisions without an end` };
        break;
      }
      const seat = state.toAct;
      const inPlay = state.phase === 'play';
      if (full && inPlay) {
        const legal = getValidActions(state);
        seen.length = 0;
        for (let i = 0; i < legal.length; i++) if (seen.indexOf(legal[i].type) === -1) seen.push(legal[i].type);
        const n = legal.length;
        const distinct = seen.length;
        legalN += 1;
        legalSum += n;
        legalDistinct += distinct;
        if (n > legalMax) legalMax = n;
        const kind = topFrame(state).kind;
        const k = byKind[kind] ?? (byKind[kind] = [0, 0, 0]);
        k[0] += 1;
        k[1] += n;
        k[2] += distinct;
        if (state.turn.number !== lastTurn) {
          lastTurn = state.turn.number;
          turnStartN += 1;
          turnStartSum += n;
          turnStartDistinct += distinct;
        }
      }
      const rng = forkRng(botRng[seat]);
      const action = impl[seat].chooseAction(state, { ...contexts[seat], rng });
      let events = null;
      try {
        events = applyAction(state, action, full ? undefined : SILENT);
      } catch (err) {
        if (err && err.code === 'ILLEGAL_ACTION') {
          failed = { type: 'refusal', seat, hash: hashState(state), action, reason: err.reason ?? err.message };
          break;
        }
        throw err;
      }
      decisions += 1;
      if (!inPlay) setupDecisions += 1;
      const mix = chosen[seat];
      mix[action.type] = (mix[action.type] ?? 0) + 1;
      if (full) tallyEvents(tally, events);
    }

    if (failed) {
      record.failed = failed;
      record.decisions = decisions;
      record.timing = { ms: performance.now() - started };
      return record;
    }

    const score = scoreGame(state);
    const turnsTotal = state.turn.number;

    record.end = state.gameEnd.reason;
    record.triggeredBy = state.gameEnd.triggeredBy;
    record.triggeredOn = state.gameEnd.triggeredOnTurn;
    record.turns = state.players.map((p) => p.turnsTaken);
    record.turnsTotal = turnsTotal;
    record.decisions = decisions;
    record.setupDecisions = setupDecisions;
    record.forced = state.seq - decisions;
    record.scores = score.players.map((p) => p.total);
    record.rank = score.players.map((p) => p.rank);
    record.winner = score.winner;
    record.vp = score.players.map((p) => p.bySource);
    record.actions = sortedCounters(chosen);

    const fin = finalMetrics(state, tally);
    record.routes = fin.routes;
    record.buildings = fin.buildings;
    record.unlaid = fin.unlaid;
    record.left = fin.left;
    record.upgrades = fin.upgrades;
    record.milestones = fin.milestones;
    record.goals = fin.goals;
    record.agenda = fin.agenda;
    record.pony = fin.pony;
    record.completion = fin.completion;

    if (full) {
      const tr = finishTrace(tally, turnsTotal);
      record.auto = sortedCounters(tally.auto);
      record.districts = sortedCounters(tally.districts);
      record.hatsSpent = tally.hatsSpent;
      record.congress = sortedCounters(tally.congress);
      record.bonus = sortedCounters(tally.bonus);
      record.built = sortedCounters(tally.built);
      record.gathered = sortedCounters(tally.gathered);
      record.lobby = tally.lobby;
      record.displaced = tally.displaced;
      record.discards = tally.discards;
      record.leadChanges = tr.leadChanges;
      record.halfLeaders = tr.halfLeaders;
      record.quarters = tr.quarters;
      record.trace = plan.keepGames ? tr.trace : undefined;
      record.legal = {
        n: legalN,
        sum: legalSum,
        distinct: legalDistinct,
        max: legalMax,
        turnStart: [turnStartN, turnStartSum, turnStartDistinct],
        byKind: sortedKeys(byKind),
      };

      // Bookkeeping check: the VP the events announced must equal the VP the score reports,
      // seat by seat and source by source. A mismatch means one of the two is wrong.
      const problems = [];
      for (let p = 0; p < P; p++) {
        const keys = new Set([...Object.keys(tally.vpEvents[p]), ...Object.keys(score.players[p].bySource)]);
        for (const key of keys) {
          const fromEvents = tally.vpEvents[p][key] ?? 0;
          const fromScore = score.players[p].bySource[key] ?? 0;
          if (fromEvents !== fromScore) problems.push(`seat ${p + 1} ${key}: ${fromEvents} VP in events, ${fromScore} in the score`);
        }
        const inPlayTotal = Object.entries(score.players[p].bySource).reduce((a, [k, v]) => a + (FINAL_SOURCES.has(k) ? 0 : v), 0);
        if (inPlayTotal !== tally.vpPlay[p]) problems.push(`seat ${p + 1}: in-play VP ${tally.vpPlay[p]} against ${inPlayTotal} by source`);
      }
      if (problems.length > 0) {
        record.failed = { type: 'integrity', seat: null, hash: hashState(state), reason: problems.slice(0, 5).join('; ') };
      }
    }
  } catch (err) {
    record.failed = { type: 'error', seat: null, hash: state ? safeHash(state) : null, reason: String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err) };
  }
  record.timing = { ms: performance.now() - started };
  return record;
}

function safeHash(state) {
  try {
    return hashState(state);
  } catch {
    return null;
  }
}
