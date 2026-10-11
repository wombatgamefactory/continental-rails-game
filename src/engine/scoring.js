// scoring.js - victory points: booking them during play, final scoring,
// the winner and the tie-breaks (R20).
//
// VP are kept per player BY SOURCE, in `player.vp`, with exactly the source
// ids of R20.1 and R20.2. A source whose module is off has no key there.
// Base sources hold base values only; anything a Legislative Agenda card or a
// Pony Express card adds is booked to `legislative` or `ponyCards` (R20.1),
// so a balance report can say what a card was worth.

import { getConstants } from './state.js';
import { emit } from './events.js';
import { buildingCount, ownedSlots, cargo, cardIndex } from './queries.js';
import { metricValue } from './conditions.js';

/**
 * Books VP to one source of one player. THE only way VP change.
 * Throws if the source is not in play: that is how "a module that is off
 * leaves no trace in the scoring" is enforced.
 *
 * @param {string} source one of the ids in rules.js VP_SOURCES
 * @param {number} amount whole number; 0 does nothing
 * @param {string} rule   the spec rule that awards it, for the event record
 */
export function addVp(state, playerId, source, amount, rule) {
  if (amount === 0) return;
  const vp = state.players[playerId].vp;
  if (!Object.prototype.hasOwnProperty.call(vp, source)) {
    throw new Error(`VP source "${source}" is not in play in this game.`);
  }
  vp[source] += amount;
  emit({ type: 'vp', player: playerId, source, amount, rule });
}

/** R20.3. VP for having `count` buildings on the map, from the table chosen by `buildingScoreCurve`. */
export function buildingTableVp(state, count) {
  const table = getConstants(state).SCORING.buildingTable[state.variants.buildingScoreCurve];
  return table[Math.min(count, table.length - 1)];
}

/**
 * R16.3, R16.4. How one goal ranks the players on the current position.
 * Returns `{ goal, values: [measure per player], places: [0 = first, ...],
 * awards: [VP per player] }`.
 *
 * Places are by DISTINCT measure (a dense ranking): players tied for a place
 * all score that place's full value (R16.4.1), and second place goes to the
 * next-best measure even when two players tied for first (R16.4.2). On a
 * "most" goal a measure of 0 scores nothing (R16.4.3); with 2 players only
 * first place is awarded (R16.4.4). A goal whose metric the interpreter does
 * not know awards nothing (an unknown metric is false).
 */
export function goalStandings(state, goal) {
  const K = getConstants(state);
  const n = state.players.length;
  const values = state.players.map((p) => metricValue(state, p.id, goal.metric, null, null));
  const known = values.every((v) => v !== null);
  const awards = new Array(n).fill(0);
  const places = new Array(n).fill(-1);
  if (known) {
    const distinct = [...new Set(values)].sort((a, b) => (goal.direction === 'fewest' ? a - b : b - a));
    const placesAwarded = n === 2 ? K.SCORING.goalPlacesTwoPlayers : K.SCORING.goalVp.length; // R16.4.4
    values.forEach((value, i) => {
      const place = distinct.indexOf(value);
      places[i] = place;
      if (place >= placesAwarded) return;
      if (goal.direction === 'most' && value === 0) return; // R16.4.3
      awards[i] = K.SCORING.goalVp[place];
    });
  }
  return { goal, values: known ? values : values.map(() => null), places, awards };
}

/** R16.2. The goal records in play, in goal order (empty when the goals module is off). */
export function goalsInPlay(state) {
  const m = state.modules.goals;
  if (m === undefined) return [];
  const index = cardIndex(getConstants(state).GOAL_CARDS);
  return m.inPlay.map((id) => index.get(id));
}

/** R18.10, R18.7 cards 31 and 38. Final VP of the Pony Express module for one player. */
function ponyEndValue(state, playerId) {
  const K = getConstants(state);
  const m = state.modules.pony;
  const mine = m.players[playerId];
  let total = mine.tokensHeld * K.SCORING.ponyTokenEndVp; // R18.10
  const index = cardIndex(K.PONY_CARDS);
  for (const id of mine.endgame) {
    for (const effect of index.get(id).effects) {
      if (effect.type !== 'endVpPer') continue;
      const value = metricValue(state, playerId, effect.metric, null, null);
      if (value !== null) total += value * effect.amount;
    }
  }
  return total;
}

/**
 * R20.2. What each final-scoring source is worth for one player on the
 * current position. Pure: changes nothing. Returns only sources in play.
 */
export function finalSourceValues(state, playerId) {
  const vp = state.players[playerId].vp;
  const out = {};
  // R20.2.1 - buildings on the map.
  out.buildingsEnd = buildingTableVp(state, buildingCount(state, playerId));
  // R20.2.2 - goals: 10 / 5 VP by placement on each goal in play (R16.3, R16.4).
  if ('goals' in vp) {
    let total = 0;
    for (const goal of goalsInPlay(state)) total += goalStandings(state, goal).awards[playerId];
    out.goals = total;
  }
  // R20.2.3 - Pony Express: tokens still held (R18.10) and the endgame cards 31 and 38.
  if ('ponyEnd' in vp) out.ponyEnd = ponyEndValue(state, playerId);
  return out;
}

/** R20.2. Writes the final-scoring sources into `player.vp`. Called once, when the game ends. */
export function applyFinalScoring(state) {
  for (const player of state.players) {
    const values = finalSourceValues(state, player.id);
    for (const source in values) {
      player.vp[source] = 0;
      addVp(state, player.id, source, values[source], 'R20.2');
    }
  }
}

function sumValues(o) {
  let n = 0;
  for (const k in o) n += o[k];
  return n;
}

/** The names of the R20.5 tie-break steps, in order. */
export const TIE_BREAK_STEPS = ['buildings', 'ownedSlots', 'cargo', 'turnOrder'];

/**
 * The scores, with VP broken down by source, the ranking and the tie-breaks.
 *
 * May be called at any time. While the game is running the final-scoring
 * sources are filled in as they would be if the game ended now (`final` is
 * false), which makes this usable as a position evaluation for bots.
 *
 * @returns {{
 *   final: boolean,
 *   endReason: string|null,
 *   players: Array<{ id: number, name: string, total: number, bySource: object,
 *                    tieBreak: { buildings: number, ownedSlots: number, cargo: number, turnOrder: number },
 *                    rank: number }>,
 *   ranking: number[],
 *   winner: number|null,
 *   decidedBy: string|null
 * }} `players` is indexed by player id. `ranking` lists ids best first.
 *   `winner` is null until the game has ended. `decidedBy` is 'vp' or the
 *   R20.5 step that separated first from second place.
 */
export function scoreGame(state) {
  const final = state.phase === 'ended';
  const n = state.players.length;
  const players = state.players.map((p) => {
    const bySource = { ...p.vp };
    if (!final) Object.assign(bySource, finalSourceValues(state, p.id));
    return {
      id: p.id,
      name: p.name,
      total: sumValues(bySource),
      bySource,
      tieBreak: {
        buildings: buildingCount(state, p.id), // R20.5.1, most
        ownedSlots: ownedSlots(state, p.id), // R20.5.2, most
        cargo: cargo(p), // R20.5.3, most
        turnOrder: (p.id - state.startPlayer + n) % n, // R20.5.4, lowest is closest to the start player
      },
      rank: 0,
    };
  });

  const compare = (a, b) =>
    b.total - a.total ||
    b.tieBreak.buildings - a.tieBreak.buildings ||
    b.tieBreak.ownedSlots - a.tieBreak.ownedSlots ||
    b.tieBreak.cargo - a.tieBreak.cargo ||
    a.tieBreak.turnOrder - b.tieBreak.turnOrder;
  const order = players.slice().sort(compare);
  order.forEach((p, i) => {
    p.rank = i + 1;
  });

  let decidedBy = 'vp';
  if (order.length > 1 && order[0].total === order[1].total) {
    const a = order[0].tieBreak;
    const b = order[1].tieBreak;
    decidedBy = TIE_BREAK_STEPS.find((step) => a[step] !== b[step]) ?? 'turnOrder';
  }

  return {
    final,
    endReason: state.gameEnd === null ? null : state.gameEnd.reason,
    players,
    ranking: order.map((p) => p.id),
    winner: final ? order[0].id : null,
    decidedBy,
  };
}
