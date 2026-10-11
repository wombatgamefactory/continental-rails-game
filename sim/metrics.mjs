// metrics.mjs - what is recorded about one game.
//
// Two sources, kept apart on purpose:
//   - the EVENTS an applied action returns (full mode only: collecting them costs
//     about a third of the speed), folded into a Tally by tallyEvents;
//   - the FINAL STATE (both modes), read by finalMetrics. Nothing there needs events.
//
// Definitions that matter for reading the numbers:
//   - "in-play VP" are the VP of the sources booked while the game runs (VP_SOURCES
//     with when = 'play'). The three final sources (buildingsEnd, goals, ponyEnd) are
//     added by final scoring, so they are not in the trace, the lead changes, the
//     half-time leader or the quarters. They are in the final scores.
//   - a "sample" of the trace is taken at the end of every round: when the game's
//     turn counter is a multiple of the player count (and once more at the end if the
//     last round was part-played, as with turnStructure = rounds). The position is read
//     when the NEXT turn starts, because the engine emits turnEnd before it books the
//     end-of-turn milestones (R16.9).
//   - a lead change is counted at the end of any turn when the unique leader differs
//     from the previous unique leader. Ties for the lead change nothing.
//   - the half-time leader is whoever led (ties: everyone tied) after the sample at
//     floor(R / 2), R being the number of samples.

import { MAP, RULES, goalsInPlay, goalStandings } from '../src/engine/index.js';
import { sortedKeys } from './stats.mjs';

/** The VP sources that are only booked by final scoring. */
export const FINAL_SOURCES = new Set(RULES.VP_SOURCES.filter((s) => s.when === 'final').map((s) => s.id));

const BONUS_KINDS = ['hire', 'hat', 'carriage', 'upgrade'];

function perSeat(P, make) {
  const out = [];
  for (let i = 0; i < P; i++) out.push(make());
  return out;
}

function bump(obj, key, by = 1) {
  obj[key] = (obj[key] ?? 0) + by;
}

/** A fresh tally for a game of P players. */
export function createTally(P) {
  return {
    P,
    turn: 0,
    vpPlay: new Array(P).fill(0),
    vpEvents: perSeat(P, () => ({})),
    trace: [],
    sampledAtTurn: 0,
    pendingTurn: null,
    leadChanges: 0,
    lastLeader: null,
    districts: perSeat(P, () => ({})),
    hatsSpent: new Array(P).fill(0),
    congress: perSeat(P, () => ({})),
    bonus: perSeat(P, () => ({})),
    built: perSeat(P, () => ({})),
    gathered: perSeat(P, () => ({})),
    lobby: perSeat(P, () => [0, 0]),
    displaced: new Array(P).fill(0),
    discards: new Array(P).fill(0),
    auto: perSeat(P, () => ({})),
    upgradeTurn: {},
    milestoneTurn: {},
    ponyBought: [],
    ponyExchanged: new Array(P).fill(0),
    ponyUsed: new Array(P).fill(0),
  };
}

/** Reads the position at the end of the turn that has just finished: lead check, and a trace sample at the end of a round. */
function flushTurn(t) {
  if (t.pendingTurn === null) return;
  checkLead(t);
  if (t.pendingTurn % t.P === 0) {
    t.trace.push(t.vpPlay.slice());
    t.sampledAtTurn = t.pendingTurn;
  }
  t.pendingTurn = null;
}

function checkLead(t) {
  let best = -1;
  let count = 0;
  let leader = -1;
  for (let p = 0; p < t.P; p++) {
    const v = t.vpPlay[p];
    if (v > best) {
      best = v;
      count = 1;
      leader = p;
    } else if (v === best) count += 1;
  }
  if (count !== 1) return;
  if (t.lastLeader !== null && t.lastLeader !== leader) t.leadChanges += 1;
  t.lastLeader = leader;
}

/** Folds the events of one applied action into the tally. */
export function tallyEvents(t, events) {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'action':
        if (e.auto) bump(t.auto[e.player], e.action.type);
        break;
      case 'turnStart':
        flushTurn(t); // the previous turn is over, end-of-turn milestones (R16.9) included
        t.turn = e.turn;
        break;
      case 'turnEnd':
        // The engine emits turnEnd BEFORE the end-of-turn milestones are booked (R16.9), so the
        // position is read when the next turn starts (or the game ends), not here.
        t.pendingTurn = e.turn;
        break;
      case 'vp':
        bump(t.vpEvents[e.player], e.source, e.amount);
        if (!FINAL_SOURCES.has(e.source)) t.vpPlay[e.player] += e.amount;
        break;
      case 'districtChosen':
        bump(t.districts[e.player], e.district);
        if (e.hat) t.hatsSpent[e.player] += 1;
        break;
      case 'congressEntry':
        bump(t.congress[e.player], e.entry);
        break;
      case 'pay':
        if (typeof e.cause === 'string' && e.cause.startsWith('bonus:')) bump(t.bonus[e.player], e.cause.slice(6));
        break;
      case 'build':
        bump(t.built[e.player], e.terrain, e.amount);
        break;
      case 'gather':
        bump(t.gathered[e.player], e.item, e.amount);
        break;
      case 'lobbyPoint':
        t.lobby[e.player][0] += 1;
        break;
      case 'lobbyPointsLost':
        t.lobby[e.player][1] += e.amount;
        break;
      case 'workerReturned':
        if (e.by !== undefined && e.by !== null) t.displaced[e.by] += 1;
        break;
      case 'discard':
        t.discards[e.player] += 1;
        break;
      case 'upgradeInstalled':
        t.upgradeTurn[`${e.player}:${e.tile}`] = t.turn;
        break;
      case 'milestoneClaimed':
        t.milestoneTurn[e.milestone] = t.turn;
        break;
      case 'ponyCardBought':
        t.ponyBought.push([e.card, e.player, t.turn]);
        break;
      case 'tokenExchanged':
        t.ponyExchanged[e.player] += 1;
        break;
      case 'ponyCardUsed':
        t.ponyUsed[e.player] += 1;
        break;
      default:
        break;
    }
  }
}

/** Leaders (everyone tied for the lead) after `rows` samples of the trace. */
function leadersAfter(trace, rows, P) {
  const v = rows <= 0 ? new Array(P).fill(0) : trace[rows - 1];
  let best = -1;
  for (let p = 0; p < P; p++) if (v[p] > best) best = v[p];
  const out = [];
  for (let p = 0; p < P; p++) if (v[p] === best) out.push(p);
  return out;
}

/**
 * Finishes the trace-based figures. Call once, after the last action, with the total of
 * turns taken. Returns { trace, leadChanges, halfLeaders, quarters }.
 */
export function finishTrace(t, totalTurns) {
  flushTurn(t);
  if (totalTurns > 0) {
    // The last row is always the true in-play total at the end: VP booked after the final
    // turnEnd event (end-of-turn milestones, R16.9) must not be lost from the quarters.
    if (t.sampledAtTurn === totalTurns && t.trace.length > 0) t.trace[t.trace.length - 1] = t.vpPlay.slice();
    else t.trace.push(t.vpPlay.slice()); // a part-played last round
    t.sampledAtTurn = totalTurns;
  }
  const R = t.trace.length;
  const at = (k) => (k <= 0 ? 0 : t.trace.length === 0 ? 0 : t.trace[Math.min(k, R) - 1].reduce((a, b) => a + b, 0));
  const cut = [0, 1, 2, 3, 4].map((k) => Math.round((k * R) / 4));
  const quarters = [1, 2, 3, 4].map((k) => at(cut[k]) - at(cut[k - 1]));
  return {
    trace: t.trace,
    leadChanges: t.leadChanges,
    halfLeaders: leadersAfter(t.trace, Math.floor(R / 2), t.P),
    quarters,
  };
}

/** Readable counters: sorted keys, so the output is the same whatever order events came in. */
export function sortedCounters(list) {
  return list.map((o) => sortedKeys(o));
}

/**
 * Everything the final state shows without events. `tally` (or null in fast mode)
 * adds the turns at which things happened.
 */
export function finalMetrics(state, tally) {
  const P = state.players.length;

  // Routes: count, by length, and slots by terrain, per seat.
  const routes = perSeat(P, () => ({ n: 0, byLength: {}, slots: { ground: 0, tunnel: 0, bridge: 0 } }));
  for (const route of MAP.routes) {
    const owner = state.map.routeOwner[route.id];
    if (owner === null || owner === undefined) continue;
    const r = routes[owner];
    r.n += 1;
    bump(r.byLength, route.length);
    for (const terrain of route.terrains) r.slots[terrain] += 1;
  }

  const buildings = perSeat(P, () => ({ railway: 0, telegraph: 0 }));
  for (const owner of Object.values(state.map.railwayStation)) if (owner !== null) buildings[owner].railway += 1;
  for (const owner of Object.values(state.map.telegraphStation)) if (owner !== null) buildings[owner].telegraph += 1;

  const unlaid = state.players.map((p) => ({ ground: p.builtTiles.ground, tunnel: p.builtTiles.tunnel, bridge: p.builtTiles.bridge }));
  const left = state.players.map((p) => ({
    iron: p.resources.iron,
    wood: p.resources.wood,
    gunpowder: p.resources.gunpowder,
    coins: p.coins,
    hats: p.hats,
  }));

  const out = { routes, buildings, unlaid, left };

  const m = state.modules;
  out.upgrades = null;
  out.milestones = null;
  out.goals = null;
  out.agenda = null;
  out.pony = null;

  if (m.upgrades) {
    out.upgrades = m.upgrades.installed.map((slots, p) => slots.filter((id) => id !== null).map((id) => [id, tally ? (tally.upgradeTurn[`${p}:${id}`] ?? null) : null]));
  }
  if (m.milestones) {
    const claimed = [];
    for (const id of m.milestones.inPlay) {
      const by = m.milestones.claimedBy[id];
      if (by !== null && by !== undefined) claimed.push([id, by, tally ? (tally.milestoneTurn[id] ?? null) : null]);
    }
    out.milestones = { inPlay: m.milestones.inPlay.slice(), claimed };
  }
  if (m.goals) {
    const awards = {};
    for (const goal of goalsInPlay(state)) awards[goal.id] = goalStandings(state, goal).awards.slice();
    out.goals = { inPlay: m.goals.inPlay.slice(), awards };
  }
  if (m.legislative) out.agenda = m.legislative.card;
  if (m.pony) {
    out.pony = {
      tokens: m.pony.players.map((q) => [q.tokensCollected, q.tokensHeld]),
      held: m.pony.players.map((q) => [...q.ongoing, ...q.endgame]),
    };
    if (tally) {
      out.pony.bought = tally.ponyBought;
      out.pony.exchanged = tally.ponyExchanged.slice();
      out.pony.used = tally.ponyUsed.slice();
    }
  }
  out.completion = state.completion ? { seat: state.completion.player, turn: state.completion.turn, route: state.completion.route } : null;
  return out;
}
