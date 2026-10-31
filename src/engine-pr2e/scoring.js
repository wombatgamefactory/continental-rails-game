// scoring.js - victory points: booking them during play, final scoring,
// the winner and the tie-breaks (P20).
//
// VP are kept per player BY SOURCE, in `player.vp`, with exactly the source
// ids of P20.1 and P20.2 (VP_SOURCES in rules.js).

import { getConstants } from './state.js';
import { emit } from './events.js';
import { buildingCount, districtHouseCount } from './queries.js';

/**
 * Books VP to one source of one player. THE only way VP change.
 *
 * @param {string} source one of the ids in rules.js VP_SOURCES
 * @param {number} amount whole number; 0 does nothing
 * @param {string} rule   the rule that awards it, for the event record
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

/** P20.3. VP for having `count` buildings on the map. */
export function buildingTableVp(state, count) {
  const table = getConstants(state).SCORING.buildingTable;
  return table[Math.min(count, table.length - 1)];
}

/** PART 2: the goal tiles in play (P18.1). None until part 2. */
export function goalsInPlay(state) {
  void state;
  return [];
}

/**
 * PART 2: how one goal ranks the players (P18.3: 5 VP to a sole leader,
 * nobody on a tie). Until part 2 nobody scores.
 */
export function goalStandings(state, goal) {
  const n = state.players.length;
  return { goal, values: new Array(n).fill(0), places: new Array(n).fill(-1), awards: new Array(n).fill(0) };
}

/**
 * P20.2. What each final-scoring source is worth for one player on the
 * current position. Pure: changes nothing.
 */
export function finalSourceValues(state, playerId) {
  const K = getConstants(state);
  const player = state.players[playerId];
  const out = {};
  // P20.2.1 - buildings on the map, from the table of P20.3.
  out.buildingsEnd = buildingTableVp(state, buildingCount(state, playerId));
  // P20.2.2 - 1 VP per built tile in storage.
  const t = player.builtTiles;
  out.tilesEnd = K.SCORING.builtTileEndVp * (t.ground + t.tunnel + t.bridge);
  // P20.2.3 - the goals, left to right.
  let goals = 0;
  for (const goal of goalsInPlay(state)) goals += goalStandings(state, goal).awards[playerId];
  out.goals = goals;
  return out;
}

/** P20.2. Writes the final-scoring sources into `player.vp`. Called once, when the game ends. */
export function applyFinalScoring(state) {
  for (const player of state.players) {
    const values = finalSourceValues(state, player.id);
    for (const source in values) {
      player.vp[source] = 0;
      addVp(state, player.id, source, values[source], 'P20.2');
    }
  }
}

function sumValues(o) {
  let n = 0;
  for (const k in o) n += o[k];
  return n;
}

/** The names of the P20.4 tie-break steps, in order (then a shared victory). */
export const TIE_BREAK_STEPS = ['districtHouses', 'buildings'];

/**
 * The scores, with VP broken down by source, the ranking and the tie-breaks.
 *
 * May be called at any time. While the game is running the final-scoring
 * sources are filled in as they would be if the game ended now (`final` is
 * false), which makes this usable as a position evaluation for bots.
 *
 * P20.4.3: players still tied after both tie-breaks SHARE their place. They
 * have the same `rank`; `winners` lists every player of rank 1 (once final).
 * `ranking` still lists every id once (tied players in seat order) and
 * `winner` is its first entry, so a reader that wants one name gets one.
 *
 * @returns {{
 *   final: boolean, endReason: string|null,
 *   players: Array<{ id, name, total, bySource, tieBreak: { districtHouses, buildings }, rank }>,
 *   ranking: number[], winner: number|null, winners: number[],
 *   decidedBy: 'vp'|'districtHouses'|'buildings'|'shared'
 * }}
 */
export function scoreGame(state) {
  const final = state.phase === 'ended';
  const players = state.players.map((p) => {
    const bySource = { ...p.vp };
    if (!final) Object.assign(bySource, finalSourceValues(state, p.id));
    return {
      id: p.id,
      name: p.name,
      total: sumValues(bySource),
      bySource,
      tieBreak: {
        districtHouses: districtHouseCount(state, p.id), // P20.4.1, most
        buildings: buildingCount(state, p.id), // P20.4.2, most
      },
      rank: 0,
    };
  });

  const compareStrict = (a, b) =>
    b.total - a.total || b.tieBreak.districtHouses - a.tieBreak.districtHouses || b.tieBreak.buildings - a.tieBreak.buildings;
  const order = players.slice().sort((a, b) => compareStrict(a, b) || a.id - b.id);
  order.forEach((p, i) => {
    p.rank = i > 0 && compareStrict(order[i - 1], p) === 0 ? order[i - 1].rank : i + 1;
  });

  let decidedBy = 'vp';
  if (order.length > 1 && order[0].total === order[1].total) {
    const a = order[0].tieBreak;
    const b = order[1].tieBreak;
    decidedBy = TIE_BREAK_STEPS.find((step) => a[step] !== b[step]) ?? 'shared';
  }

  return {
    final,
    endReason: state.gameEnd === null ? null : state.gameEnd.reason,
    players,
    ranking: order.map((p) => p.id),
    winner: final ? order[0].id : null,
    winners: final ? order.filter((p) => p.rank === 1).map((p) => p.id) : [],
    decidedBy,
  };
}
