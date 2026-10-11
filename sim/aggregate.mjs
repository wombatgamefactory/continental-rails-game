// aggregate.mjs - from per-game records to the statistics a designer reads.
//
// Everything here is a pure function of an array of records (see SCHEMA.md) and a small
// context, so the arithmetic is tested by pushing hand-made records through the real
// functions (tests/sim.test.mjs). Nothing here knows about threads, files or the engine's
// state: only the compact records.
//
// Conventions
//   - A game is FINISHED if it has no `failed` field. Failed games (refused action, decision
//     cap, crash, bookkeeping mismatch) are counted and listed, never averaged.
//   - A game is COUNTED if it finished and did not end by the turn limit (R19.4). The headline
//     `aggregate` is over counted games only; turn-limit games are a count and a percentage of
//     their own. `aggregateAll` repeats the sections over every finished game, labelled as such,
//     for runs (random bots) in which nearly every game ends by the turn limit.
//   - Win credit: a player scores 1 for sole top VP, 1/k when k players tie on top VP ("ties
//     split"). `tieBreakWins` repeats the count with the engine's winner (R20.5, tie-breaks
//     applied), which is what happens at a real table.
//   - Seats are arrays: position i is seat i + 1 (turn order, seat 1 first). A `seat` field
//     gives the 1-based number.
//   - Rates of "per seat-instance" are over every (game, seat) pair of the games used.

import { RULES, MAP, ACTIONS } from '../src/engine/index.js';
import { describe, mean, sum, proportionSe, sigmaFromFair, ratio, sortedKeys } from './stats.mjs';
import { FINAL_SOURCES } from './metrics.mjs';
import { evaluateHealth } from './health.mjs';

export const SMALL_N = 30; // an acquisition comparison with fewer than this on either side is flagged
const LENGTH_BIN = 10; // turns per player per bin of the game-length histogram

/** Win credit per seat: 1 for sole top VP, 1/k for k tied on top. */
export function tieSplit(scores) {
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  const k = scores.filter((s) => s === max).length;
  return scores.map((s) => (s === max ? 1 / k : 0));
}

/** Margin of the top score over the second, as a percentage of the top (0 for a tie or a 0 top). */
export function marginPct(scores) {
  const sorted = scores.slice().sort((a, b) => b - a);
  return sorted[0] > 0 ? ((sorted[0] - sorted[1]) / sorted[0]) * 100 : 0;
}

function proportion(successes, n) {
  const p = n > 0 ? successes / n : null;
  return { n, value: p, se: proportionSe(p, n) };
}

function winStats(wins, n, fair) {
  const p = n > 0 ? wins / n : null;
  return { n, wins, winRate: p, se: proportionSe(p, n), fair, sigma: sigmaFromFair(p, fair, n) };
}

function countInto(target, source) {
  for (const key of Object.keys(source)) target[key] = (target[key] ?? 0) + source[key];
}

function shares(counts) {
  const total = sum(Object.values(counts));
  const out = {};
  for (const key of Object.keys(counts)) out[key] = total > 0 ? counts[key] / total : null;
  return out;
}

/** Per-seat-instance mean of an object of counters over a list of instances. */
function meanCounters(insts, pick, keys) {
  const out = {};
  for (const key of keys) out[key] = insts.length > 0 ? sum(insts.map((i) => pick(i)[key] ?? 0)) / insts.length : null;
  return out;
}

/**
 * A with/without table for things a seat can acquire during a game.
 * @param ids the items
 * @param insts seat-instances ({ credit, ... })
 * @param has (inst, id) => boolean
 * @param eligible (inst, id) => boolean, whether the item could have been acquired at all
 */
function acquisitionTable(ids, insts, has, eligible = () => true) {
  return ids.map((id) => {
    let nWith = 0;
    let winsWith = 0;
    let nWithout = 0;
    let winsWithout = 0;
    for (const inst of insts) {
      if (!eligible(inst, id)) continue;
      if (has(inst, id)) {
        nWith += 1;
        winsWith += inst.credit;
      } else {
        nWithout += 1;
        winsWithout += inst.credit;
      }
    }
    const rateWith = nWith > 0 ? winsWith / nWith : null;
    const rateWithout = nWithout > 0 ? winsWithout / nWithout : null;
    return {
      id,
      nWith,
      winRateWith: rateWith,
      seWith: proportionSe(rateWith, nWith),
      nWithout,
      winRateWithout: rateWithout,
      seWithout: proportionSe(rateWithout, nWithout),
      diff: rateWith !== null && rateWithout !== null ? rateWith - rateWithout : null,
      small: nWith < SMALL_N || nWithout < SMALL_N,
    };
  });
}

/** The action types that exist only with a module on (so a zero with the module off is not a finding). */
const MODULE_OF_ACTION = {
  installUpgrade: 'upgrades',
  buyPonyCard: 'pony',
  exchangeToken: 'pony',
  usePonyCard: 'pony',
  endFreeActions: 'pony',
  returnResource: 'pony',
  chooseForemanType: 'pony',
  chooseSpecialistType: 'pony',
  chooseExtraActivation: 'pony',
  declineFreeEntry: 'legislative',
};

/** Builds every statistics section over one set of records. */
export function computeSections(recs, ctx) {
  const P = ctx.players;
  const n = recs.length;
  if (n === 0) return { n: 0 };
  const fair = 1 / P;
  const credits = recs.map((r) => tieSplit(r.scores));

  // One object per (game, seat).
  const insts = [];
  recs.forEach((r, g) => {
    for (let s = 0; s < P; s++) {
      insts.push({ r, g, s, credit: credits[g][s], type: r.seats[s], score: r.scores[s], rank: r.rank[s], winner: r.winner === s });
    }
  });
  const winners = insts.filter((i) => i.rank === 1);
  const rest = insts.filter((i) => i.rank !== 1);

  const out = { n };

  // ---- Wins -------------------------------------------------------------------------------
  out.bySeat = [];
  for (let s = 0; s < P; s++) {
    const mine = insts.filter((i) => i.s === s);
    const w = winStats(sum(mine.map((i) => i.credit)), n, fair);
    out.bySeat.push({
      seat: s + 1,
      ...w,
      tieBreakWins: mine.filter((i) => i.winner).length,
      tieBreakWinRate: mine.filter((i) => i.winner).length / n,
      meanRank: mean(mine.map((i) => i.rank)),
      score: describe(mine.map((i) => i.score)),
    });
  }
  const fpCredit = recs.map((r, g) => credits[g][r.startPlayer ?? 0]);
  out.firstPlayer = winStats(sum(fpCredit), n, fair);

  const types = ctx.botTypes.filter((t) => insts.some((i) => i.type === t));
  out.byType = types.map((type) => {
    const mine = insts.filter((i) => i.type === type);
    const w = winStats(sum(mine.map((i) => i.credit)), mine.length, fair);
    return {
      type,
      ...w,
      games: new Set(mine.map((i) => i.g)).size,
      tieBreakWins: mine.filter((i) => i.winner).length,
      tieBreakWinRate: mine.filter((i) => i.winner).length / mine.length,
      meanRank: mean(mine.map((i) => i.rank)),
      score: describe(mine.map((i) => i.score)),
    };
  });
  out.seatTypeCounts = {};
  for (const type of types) out.seatTypeCounts[type] = Array.from({ length: P }, (_, s) => insts.filter((i) => i.s === s && i.type === type).length);

  const tied = recs.filter((r, g) => credits[g].some((c) => c > 0 && c < 1)).length;
  out.vpTieForFirst = proportion(tied, n);

  // ---- Scores -----------------------------------------------------------------------------
  out.score = describe(insts.map((i) => i.score));
  out.winningScore = describe(recs.map((r) => Math.max(...r.scores)));
  const margins = recs.map((r) => marginPct(r.scores));
  out.marginPct = describe(margins);
  out.within10 = proportion(margins.filter((m) => m <= 10).length, n);
  out.winnersScore = describe(winners.map((i) => i.score));
  out.restScore = describe(rest.map((i) => i.score));

  // ---- Shape of the game --------------------------------------------------------------------
  const lengths = recs.map((r) => Math.max(...r.turns));
  out.length = describe(lengths);
  const hist = {};
  for (const len of lengths) {
    const bin = Math.floor(len / LENGTH_BIN) * LENGTH_BIN;
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  out.lengthHistogram = Object.keys(hist)
    .map(Number)
    .sort((a, b) => a - b)
    .map((from) => ({ from, to: from + LENGTH_BIN - 1, games: hist[from] }));

  const withLead = recs.filter((r) => r.leadChanges !== undefined);
  if (withLead.length > 0) {
    out.leadChanges = describe(withLead.map((r) => r.leadChanges));
    const halfCredit = [];
    recs.forEach((r, g) => {
      if (r.leadChanges !== undefined) halfCredit.push(mean(r.halfLeaders.map((s) => credits[g][s])));
    });
    out.leaderAtHalf = { ...proportion(sum(halfCredit), withLead.length), fair };
    out.leaderAtHalf.sigma = sigmaFromFair(out.leaderAtHalf.value, fair, withLead.length);
  }

  out.decisions = {
    perGame: describe(recs.map((r) => r.decisions)),
    forcedPerGame: describe(recs.map((r) => r.forced)),
    perTurn: describe(recs.map((r) => (r.turnsTotal > 0 ? (r.decisions - r.setupDecisions) / r.turnsTotal : 0))),
  };

  const withLegal = recs.filter((r) => r.legal !== undefined);
  if (withLegal.length > 0) {
    const m = ratio(withLegal.map((r) => r.legal.sum), withLegal.map((r) => r.legal.n));
    const d = ratio(withLegal.map((r) => r.legal.distinct), withLegal.map((r) => r.legal.n));
    const t = ratio(withLegal.map((r) => r.legal.turnStart[1]), withLegal.map((r) => r.legal.turnStart[0]));
    const td = ratio(withLegal.map((r) => r.legal.turnStart[2]), withLegal.map((r) => r.legal.turnStart[0]));
    const kinds = {};
    for (const r of withLegal) {
      for (const [kind, [kn, ks, kd]] of Object.entries(r.legal.byKind)) {
        const k = kinds[kind] ?? (kinds[kind] = [0, 0, 0]);
        k[0] += kn;
        k[1] += ks;
        k[2] += kd;
      }
    }
    out.legalActions = {
      perDecision: m.value,
      perDecisionSe: m.se,
      distinctTypesPerDecision: d.value,
      distinctTypesPerDecisionSe: d.se,
      atTurnStart: t.value,
      atTurnStartSe: t.se,
      distinctTypesAtTurnStart: td.value,
      distinctTypesAtTurnStartSe: td.se,
      max: Math.max(...withLegal.map((r) => r.legal.max)),
      playDecisions: sum(withLegal.map((r) => r.legal.n)),
      byKind: sortedKeys(
        Object.fromEntries(Object.entries(kinds).map(([kind, [kn, ks, kd]]) => [kind, { decisions: kn, meanLegal: kn > 0 ? ks / kn : null, meanDistinctTypes: kn > 0 ? kd / kn : null }])),
      ),
    };
  }

  // ---- Where the points come from ---------------------------------------------------------------
  const sourceIds = RULES.VP_SOURCES.map((s) => s.id).filter((id) => recs.some((r) => r.vp.some((v) => id in v)));
  const totals = recs.map((r) => sum(r.scores));
  out.vpBySource = sourceIds.map((id) => {
    const perGame = recs.map((r) => sum(r.vp.map((v) => v[id] ?? 0)));
    const share = ratio(perGame, totals);
    const wTotal = sum(winners.map((i) => i.score));
    const rTotal = sum(rest.map((i) => i.score));
    return {
      source: id,
      final: FINAL_SOURCES.has(id),
      meanPerPlayer: sum(perGame) / (n * P),
      share: share.value,
      shareSe: share.se,
      shareWinners: wTotal > 0 ? sum(winners.map((i) => i.r.vp[i.s][id] ?? 0)) / wTotal : null,
      shareRest: rTotal > 0 ? sum(rest.map((i) => i.r.vp[i.s][id] ?? 0)) / rTotal : null,
    };
  });
  const top = out.vpBySource.reduce((a, b) => (b.share !== null && (a === null || b.share > a.share) ? b : a), null);
  out.largestVpSource = top ? { source: top.source, share: top.share } : null;

  const withQuarters = recs.filter((r) => r.quarters !== undefined);
  if (withQuarters.length > 0) {
    const tot = withQuarters.map((r) => sum(r.scores));
    const qs = [0, 1, 2, 3].map((k) => ratio(withQuarters.map((r) => r.quarters[k]), tot));
    const finalScoring = ratio(withQuarters.map((r) => sum(r.scores) - sum(r.quarters)), tot);
    const q4End = ratio(withQuarters.map((r) => r.quarters[3] + (sum(r.scores) - sum(r.quarters))), tot);
    const inPlay = withQuarters.map((r) => sum(r.quarters));
    out.vpByQuarter = {
      note: 'Shares of ALL VP (final scoring included). Quarters cover the VP booked while the game runs; `finalScoring` is buildings, goals and Pony Express tokens, booked at the end.',
      shares: qs.map((q) => q.value),
      shareSes: qs.map((q) => q.se),
      finalScoring: finalScoring.value,
      finalScoringSe: finalScoring.se,
      finalQuarterWithEndScoring: q4End.value,
      finalQuarterWithEndScoringSe: q4End.se,
      inPlayShares: [0, 1, 2, 3].map((k) => ratio(withQuarters.map((r) => r.quarters[k]), inPlay).value),
    };
  }

  // ---- What players did ---------------------------------------------------------------------------
  const mixAll = {};
  const mixByType = {};
  const autoAll = {};
  for (const r of recs) {
    r.actions.forEach((counts, s) => {
      countInto(mixAll, counts);
      countInto(mixByType[r.seats[s]] ?? (mixByType[r.seats[s]] = {}), counts);
    });
    if (r.auto) r.auto.forEach((counts) => countInto(autoAll, counts));
  }
  out.actionMix = {
    note: 'Actions CHOSEN by a bot (the driver). `forcedShare` counts the ones the engine applied itself because only one was legal.',
    counts: sortedKeys(mixAll),
    share: sortedKeys(shares(mixAll)),
    byBotType: sortedKeys(Object.fromEntries(Object.entries(mixByType).map(([t, c]) => [t, sortedKeys(shares(c))]))),
    forcedCounts: recs.some((r) => r.auto) ? sortedKeys(autoAll) : null,
    forcedShare: sum(recs.map((r) => r.forced)) / Math.max(1, sum(recs.map((r) => r.decisions)) + sum(recs.map((r) => r.forced))),
  };
  const known = Object.keys(ACTIONS);
  out.actionTypesNeverChosen = known.filter((t) => !(t in mixAll) && !(MODULE_OF_ACTION[t] && ctx.modulesOn && !ctx.modulesOn[MODULE_OF_ACTION[t]]));

  const withDistricts = recs.filter((r) => r.districts !== undefined);
  if (withDistricts.length > 0) {
    const all = {};
    const byType = {};
    for (const r of withDistricts) {
      r.districts.forEach((counts, s) => {
        countInto(all, counts);
        countInto(byType[r.seats[s]] ?? (byType[r.seats[s]] = {}), counts);
      });
    }
    out.districts = { counts: sortedKeys(all), share: sortedKeys(shares(all)), byBotType: sortedKeys(Object.fromEntries(Object.entries(byType).map(([t, c]) => [t, sortedKeys(shares(c))]))) };
  }

  // ---- The map ---------------------------------------------------------------------------------------
  const routeLengths = [...new Set(MAP.routes.map((r) => r.length))].sort((a, b) => a - b);
  out.routes = {
    perGame: describe(recs.map((r) => sum(r.routes.map((x) => x.n)))),
    fillShare: mean(recs.map((r) => sum(r.routes.map((x) => x.n)) / MAP.routes.length)),
    perPlayer: sum(insts.map((i) => i.r.routes[i.s].n)) / insts.length,
    perPlayerWinners: winners.length ? mean(winners.map((i) => i.r.routes[i.s].n)) : null,
    perPlayerRest: rest.length ? mean(rest.map((i) => i.r.routes[i.s].n)) : null,
    byLength: Object.fromEntries(routeLengths.map((len) => [len, mean(insts.map((i) => i.r.routes[i.s].byLength[len] ?? 0))])),
    slotsByTerrain: meanCounters(insts, (i) => i.r.routes[i.s].slots, RULES.TERRAINS),
    available: { routes: MAP.routes.length, byLength: Object.fromEntries(routeLengths.map((len) => [len, MAP.routes.filter((r) => r.length === len).length])) },
  };
  out.buildings = {
    railwayPerPlayer: mean(insts.map((i) => i.r.buildings[i.s].railway)),
    telegraphPerPlayer: mean(insts.map((i) => i.r.buildings[i.s].telegraph)),
    perPlayerWinners: winners.length ? mean(winners.map((i) => i.r.buildings[i.s].railway + i.r.buildings[i.s].telegraph)) : null,
    perPlayerRest: rest.length ? mean(rest.map((i) => i.r.buildings[i.s].railway + i.r.buildings[i.s].telegraph)) : null,
  };
  out.completion = {
    ...proportion(recs.filter((r) => r.completion).length, n),
    bySeat: Array.from({ length: P }, (_, s) => recs.filter((r) => r.completion && r.completion.seat === s).length / n),
    meanTurnShare: mean(recs.filter((r) => r.completion && r.turnsTotal > 0).map((r) => r.completion.turn / r.turnsTotal)),
  };

  // ---- Leftovers ---------------------------------------------------------------------------------------
  const resKeys = ['iron', 'wood', 'gunpowder', 'coins', 'hats'];
  out.leftovers = {
    note: 'Per player at the end of the game. Unlaid tiles are BUILT tiles never laid on the map.',
    unlaidTiles: meanCounters(insts, (i) => i.r.unlaid[i.s], RULES.TERRAINS),
    unlaidTilesTotal: mean(insts.map((i) => sum(Object.values(i.r.unlaid[i.s])))),
    unlaidTilesWinners: winners.length ? mean(winners.map((i) => sum(Object.values(i.r.unlaid[i.s])))) : null,
    unlaidTilesRest: rest.length ? mean(rest.map((i) => sum(Object.values(i.r.unlaid[i.s])))) : null,
    resources: meanCounters(insts, (i) => i.r.left[i.s], resKeys),
    resourcesWinners: winners.length ? meanCounters(winners, (i) => i.r.left[i.s], resKeys) : null,
    resourcesRest: rest.length ? meanCounters(rest, (i) => i.r.left[i.s], resKeys) : null,
  };

  const withEconomy = insts.filter((i) => i.r.gathered !== undefined);
  if (withEconomy.length > 0) {
    out.economy = {
      note: 'Per player per game, from events.',
      gathered: meanCounters(withEconomy, (i) => i.r.gathered[i.s], [...RULES.RESOURCES, 'coins']),
      built: meanCounters(withEconomy, (i) => i.r.built[i.s], RULES.TERRAINS),
      lobbyPointsGained: mean(withEconomy.map((i) => i.r.lobby[i.s][0])),
      lobbyPointsLost: mean(withEconomy.map((i) => i.r.lobby[i.s][1])),
      hatsSpent: mean(withEconomy.map((i) => i.r.hatsSpent[i.s])),
      workersDisplaced: mean(withEconomy.map((i) => i.r.displaced[i.s])),
      storageDiscards: mean(withEconomy.map((i) => i.r.discards[i.s])),
    };
    const bonusKinds = ['hire', 'hat', 'carriage', 'upgrade'];
    out.bonusActions = {
      note: 'Bonus actions taken (R7), per player per game; `rate` is the share of players taking at least one.',
      perPlayer: Object.fromEntries(bonusKinds.map((k) => [k, mean(withEconomy.map((i) => i.r.bonus[i.s][k] ?? 0))])),
      rate: Object.fromEntries(bonusKinds.map((k) => [k, mean(withEconomy.map((i) => ((i.r.bonus[i.s][k] ?? 0) > 0 ? 1 : 0)))])),
    };
    const table = RULES.CONGRESS.tables[ctx.variants?.congressTable ?? 'design-2026-10'] ?? [];
    const entryIds = table.map((e) => e.id);
    const taken = Object.fromEntries(entryIds.map((id) => [id, sum(withEconomy.map((i) => i.r.congress[i.s][id] ?? 0))]));
    out.congress = {
      note: 'Entries taken, all players. Free entries (cards) are included.',
      perGame: mean(withEconomy.map((i) => sum(Object.values(i.r.congress[i.s])))) * P,
      taken,
      perGameById: Object.fromEntries(entryIds.map((id) => [id, taken[id] / n])),
      neverTaken: entryIds.filter((id) => taken[id] === 0),
    };
  }

  // ---- The add-on modules -----------------------------------------------------------------------------
  out.modules = {};
  const smallNote = `Win rates with / without are per player; ${SMALL_N} or fewer on either side is flagged \`small\`.`;

  const upgradeIds = RULES.UPGRADE_TILES.map((t) => t.id);
  if (recs.some((r) => r.upgrades)) {
    const have = (i) => new Set((i.r.upgrades?.[i.s] ?? []).map((x) => x[0]));
    const counts = Object.fromEntries(upgradeIds.map((id) => [id, 0]));
    const gamesWith = Object.fromEntries(upgradeIds.map((id) => [id, 0]));
    for (const r of recs) {
      const inGame = new Set();
      (r.upgrades ?? []).forEach((list) => list.forEach(([id]) => {
        counts[id] += 1;
        inGame.add(id);
      }));
      for (const id of inGame) gamesWith[id] += 1;
    }
    const sets = new Map(insts.map((i) => [i, have(i)]));
    out.modules.upgrades = {
      installsPerPlayer: mean(insts.map((i) => (i.r.upgrades?.[i.s] ?? []).length)),
      tiles: upgradeIds.map((id) => ({ id, installs: counts[id], perGame: counts[id] / n, gamesWith: gamesWith[id], rate: gamesWith[id] / n })),
      neverInstalled: upgradeIds.filter((id) => counts[id] === 0),
      winRateWithWithout: { note: smallNote, items: acquisitionTable(upgradeIds, insts, (i, id) => sets.get(i).has(id)) },
    };
  }

  if (recs.some((r) => r.milestones)) {
    const ids = RULES.MILESTONE_TILES.map((t) => t.id);
    const inPlay = Object.fromEntries(ids.map((id) => [id, 0]));
    const claimed = Object.fromEntries(ids.map((id) => [id, 0]));
    const turnShares = Object.fromEntries(ids.map((id) => [id, []]));
    for (const r of recs) {
      if (!r.milestones) continue;
      for (const id of r.milestones.inPlay) inPlay[id] += 1;
      for (const [id, , turn] of r.milestones.claimed) {
        claimed[id] += 1;
        if (turn !== null && r.turnsTotal > 0) turnShares[id].push(turn / r.turnsTotal);
      }
    }
    const claimedBy = new Map(insts.map((i) => [i, new Set((i.r.milestones?.claimed ?? []).filter((c) => c[1] === i.s).map((c) => c[0]))]));
    out.modules.milestones = {
      tiles: ids.map((id) => ({ id, gamesInPlay: inPlay[id], claimed: claimed[id], claimRate: inPlay[id] > 0 ? claimed[id] / inPlay[id] : null, meanTurnShare: mean(turnShares[id]) })),
      perGame: mean(recs.map((r) => r.milestones?.claimed.length ?? 0)),
      neverClaimed: ids.filter((id) => inPlay[id] > 0 && claimed[id] === 0),
      neverInPlay: ids.filter((id) => inPlay[id] === 0),
      winRateWithWithout: { note: `${smallNote} Only games in which the milestone was in play are used.`, items: acquisitionTable(ids, insts, (i, id) => claimedBy.get(i).has(id), (i, id) => !!i.r.milestones && i.r.milestones.inPlay.includes(id)) },
    };
  }

  if (recs.some((r) => r.goals)) {
    const ids = RULES.GOAL_CARDS.map((g) => g.id);
    const inPlay = Object.fromEntries(ids.map((id) => [id, 0]));
    const paid = Object.fromEntries(ids.map((id) => [id, 0]));
    const vp = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const r of recs) {
      if (!r.goals) continue;
      for (const id of r.goals.inPlay) {
        inPlay[id] += 1;
        const awards = r.goals.awards[id] ?? [];
        const total = sum(awards);
        if (total > 0) paid[id] += 1;
        vp[id] += total;
      }
    }
    const awardOf = (i, id) => i.r.goals?.awards[id]?.[i.s] ?? 0;
    out.modules.goals = {
      tiles: ids.map((id) => ({ id, gamesInPlay: inPlay[id], gamesPaid: paid[id], paidRate: inPlay[id] > 0 ? paid[id] / inPlay[id] : null, meanVpAwarded: inPlay[id] > 0 ? vp[id] / inPlay[id] : null })),
      neverPaid: ids.filter((id) => inPlay[id] > 0 && paid[id] === 0),
      neverInPlay: ids.filter((id) => inPlay[id] === 0),
      winRateWithWithout: {
        note: `${smallNote} "With" means the player scored VP from the goal. Only games in which it was in play are used.`,
        items: acquisitionTable(ids, insts, (i, id) => awardOf(i, id) > 0, (i, id) => !!i.r.goals && i.r.goals.inPlay.includes(id)),
      },
    };
  }

  if (recs.some((r) => r.agenda)) {
    const ids = RULES.LEGISLATIVE_CARDS.map((c) => c.id);
    const games = Object.fromEntries(ids.map((id) => [id, 0]));
    const vp = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const r of recs) {
      if (!r.agenda) continue;
      games[r.agenda] += 1;
      vp[r.agenda] += sum(r.vp.map((v) => v.legislative ?? 0));
    }
    out.modules.legislative = {
      cards: ids.map((id) => ({ id, games: games[id], meanLegislativeVp: games[id] > 0 ? vp[id] / games[id] : null })),
      neverInForce: ids.filter((id) => games[id] === 0),
    };
  }

  if (recs.some((r) => r.pony)) {
    const ids = RULES.PONY_CARDS.map((c) => c.id);
    const bought = Object.fromEntries(ids.map((id) => [id, 0]));
    const held = Object.fromEntries(ids.map((id) => [id, 0]));
    const hasBought = recs.some((r) => r.pony?.bought);
    for (const r of recs) {
      if (!r.pony) continue;
      for (const [id] of r.pony.bought ?? []) bought[id] += 1;
      for (const list of r.pony.held) for (const id of list) held[id] += 1;
    }
    const sets = new Map(insts.map((i) => [i, new Set((i.r.pony?.bought ?? []).filter((b) => b[1] === i.s).map((b) => b[0]))]));
    out.modules.pony = {
      tokensCollectedPerPlayer: mean(insts.map((i) => i.r.pony?.tokens[i.s][0] ?? 0)),
      tokensHeldAtEndPerPlayer: mean(insts.map((i) => i.r.pony?.tokens[i.s][1] ?? 0)),
      tokensSpentPerPlayer: mean(insts.map((i) => (i.r.pony?.tokens[i.s][0] ?? 0) - (i.r.pony?.tokens[i.s][1] ?? 0))),
      tokensExchangedPerPlayer: hasBought ? mean(insts.map((i) => i.r.pony?.exchanged?.[i.s] ?? 0)) : null,
      cardsBoughtPerPlayer: hasBought ? sum(ids.map((id) => bought[id])) / insts.length : null,
      cards: ids.map((id) => ({ id, bought: hasBought ? bought[id] : null, perGame: hasBought ? bought[id] / n : null, heldAtEnd: held[id] })),
      neverBought: hasBought ? ids.filter((id) => bought[id] === 0) : null,
      winRateWithWithout: hasBought
        ? { note: `${smallNote} "Not bought" includes games in which the card never came to the market.`, items: acquisitionTable(ids, insts, (i, id) => sets.get(i).has(id)) }
        : null,
    };
  }

  // ---- Subsystem usage (the health table's zero test) ------------------------------------------------------
  const used = {
    upgrades: (r) => !!r.upgrades && r.upgrades.some((l) => l.length > 0),
    milestones: (r) => !!r.milestones && r.milestones.claimed.length > 0,
    goals: (r) => !!r.goals && Object.values(r.goals.awards).some((a) => sum(a) > 0),
    legislative: (r) => r.vp.some((v) => (v.legislative ?? 0) > 0),
    pony: (r) => !!r.pony && r.pony.tokens.some((t) => t[0] > 0),
  };
  const modulesOn = ctx.modulesOn ?? {};
  out.subsystems = [];
  for (const [id, test] of Object.entries(used)) {
    if (modulesOn[id] === false) continue;
    if (id === 'upgrades' && !recs.some((r) => r.upgrades)) continue;
    const k = recs.filter(test).length;
    out.subsystems.push({ id, kind: 'module', ...proportion(k, n), games: k });
  }
  const actionUse = (type) => recs.filter((r) => r.actions.some((c) => (c[type] ?? 0) > 0)).length;
  for (const [id, type] of [['congress', 'takeCongressEntry'], ['moveTrain', 'moveTrain'], ['claimRoute', 'claimRoute'], ['railwayStations', 'placeRailwayStation'], ['telegraphStations', 'placeTelegraphStation'], ['hats', 'buyHat'], ['hire', 'hireSpecialist'], ['carriages', 'addCarriage']]) {
    const k = actionUse(type);
    out.subsystems.push({ id, kind: 'action', action: type, ...proportion(k, n), games: k });
  }
  const tollGames = recs.filter((r) => r.vp.some((v) => (v.toll ?? 0) > 0)).length;
  out.subsystems.push({ id: 'tolls', kind: 'vp', ...proportion(tollGames, n), games: tollGames });

  return out;
}

/** Turns the sections into the flat headline map used by the comparison and the report generator. */
export function headlineOf(s, ctx) {
  const h = {};
  const add = (id, label, value, se, n) => {
    if (value !== null && value !== undefined) h[id] = { label, value, se: se ?? null, n };
  };
  if (!s.n) return h;
  for (const x of s.bySeat) add(`winRate.seat${x.seat}`, `Win rate, seat ${x.seat}`, x.winRate, x.se, x.n);
  add('winRate.firstPlayer', 'Win rate, first player', s.firstPlayer.winRate, s.firstPlayer.se, s.firstPlayer.n);
  if (s.byType.length > 1) for (const x of s.byType) add(`winRate.type.${x.type}`, `Win rate, ${x.type}`, x.winRate, x.se, x.n);
  add('score.mean', 'Mean score per player', s.score.mean, s.score.se, s.score.n);
  add('score.winning', 'Mean winning score', s.winningScore.mean, s.winningScore.se, s.winningScore.n);
  add('margin.mean', 'Mean margin, % of winner', s.marginPct.mean, s.marginPct.se, s.marginPct.n);
  add('margin.within10', 'Games within 10%', s.within10.value, s.within10.se, s.within10.n);
  add('length.mean', 'Mean turns per player', s.length.mean, s.length.se, s.length.n);
  add('decisions.perTurn', 'Decisions per turn', s.decisions.perTurn.mean, s.decisions.perTurn.se, s.decisions.perTurn.n);
  if (s.leadChanges) add('leadChanges.mean', 'Lead changes per game', s.leadChanges.mean, s.leadChanges.se, s.leadChanges.n);
  if (s.leaderAtHalf) add('leaderAtHalf.winRate', 'Half-time leader wins', s.leaderAtHalf.value, s.leaderAtHalf.se, s.leaderAtHalf.n);
  if (s.legalActions) {
    add('legal.perDecision', 'Legal actions per decision', s.legalActions.perDecision, s.legalActions.perDecisionSe, s.legalActions.playDecisions);
    add('legal.atTurnStart', 'Legal actions at a turn\'s first decision', s.legalActions.atTurnStart, s.legalActions.atTurnStartSe, s.n);
    add('legal.distinctPerDecision', 'Distinct action types per decision', s.legalActions.distinctTypesPerDecision, s.legalActions.distinctTypesPerDecisionSe, s.legalActions.playDecisions);
  }
  for (const v of s.vpBySource) add(`vpShare.${v.source}`, `VP share, ${v.source}`, v.share, v.shareSe, s.n);
  if (s.vpByQuarter) add('vp.finalQuarter', 'VP in final quarter incl. end scoring', s.vpByQuarter.finalQuarterWithEndScoring, s.vpByQuarter.finalQuarterWithEndScoringSe, s.n);
  add('routes.perGame', 'Routes claimed per game', s.routes.perGame.mean, s.routes.perGame.se, s.routes.perGame.n);
  add('completion.rate', 'Games with a transcontinental line', s.completion.value, s.completion.se, s.completion.n);
  add('unlaidTiles.perPlayer', 'Built tiles left unlaid per player', s.leftovers.unlaidTilesTotal, null, s.n);
  for (const sub of s.subsystems) add(`usage.${sub.id}`, `Games using ${sub.id}`, sub.value, sub.se, sub.n);
  return h;
}

/**
 * The whole aggregate of one arm.
 * @param {object[]} records every record of the arm, in game-index order
 * @param {{ players: number, botTypes: string[], variants: object, modulesOn: object }} ctx
 * @returns {{ aggregate: object, aggregateAll: object }}
 */
export function aggregateArm(records, ctx) {
  const finished = records.filter((r) => !r.failed);
  const failedRecords = records.filter((r) => r.failed);
  const turnLimit = finished.filter((r) => r.end === 'turn-limit');
  const counted = finished.filter((r) => r.end !== 'turn-limit');

  const endCounts = {};
  for (const r of finished) endCounts[r.end] = (endCounts[r.end] ?? 0) + 1;
  const failures = { refusals: 0, decisionCapHits: 0, errors: 0, integrity: 0 };
  for (const r of failedRecords) {
    const key = { refusal: 'refusals', cap: 'decisionCapHits', error: 'errors', integrity: 'integrity' }[r.failed.type];
    failures[key] += 1;
  }
  const counts = {
    games: records.length,
    finished: finished.length,
    failed: failedRecords.length,
    counted: counted.length,
    turnLimit: turnLimit.length,
    turnLimitPct: finished.length > 0 ? (100 * turnLimit.length) / finished.length : null,
    ...failures,
    note: 'Turn-limit games (R19.4) are excluded from every mean in `aggregate` and counted here. `decisionCapHits` is the harness livelock guard and must be 0.',
  };
  const endReasons = Object.fromEntries(
    Object.keys(endCounts)
      .sort()
      .map((k) => [k, { games: endCounts[k], pct: (100 * endCounts[k]) / finished.length, se: proportionSe(endCounts[k] / finished.length, finished.length) }]),
  );

  const sections = computeSections(counted, ctx);
  const sectionsAll = computeSections(finished, ctx);
  const aggregate = { basis: 'counted', counts, endReasons, ...sections, headline: headlineOf(sections, ctx) };
  aggregate.headline['turnLimit.share'] = {
    label: 'Games ended by the turn limit',
    value: counts.turnLimitPct === null ? null : counts.turnLimitPct / 100,
    se: finished.length > 0 ? proportionSe(turnLimit.length / finished.length, finished.length) : null,
    n: finished.length,
  };
  for (const [reason, x] of Object.entries(endReasons)) aggregate.headline[`end.${reason}`] = { label: `Games ended: ${reason}`, value: x.pct / 100, se: x.se, n: finished.length };
  // The health table reads the counted games, unless there are too few of them to mean anything
  // (a random-bot run in which nearly every game hits the turn limit): then it reads every finished
  // game, and says so in `healthBasis`. The turn-limit row counts the turn-limit games either way.
  const healthOnAll = counted.length < MIN_COUNTED_FOR_COMPARISON;
  aggregate.healthBasis = healthOnAll ? 'all-finished' : 'counted';
  aggregate.health = evaluateHealth(healthOnAll ? { ...sectionsAll, counts } : aggregate, ctx);
  const aggregateAll = { basis: 'all-finished', note: 'The same sections over every finished game, turn-limit games included.', counts, ...sectionsAll, headline: headlineOf(sectionsAll, ctx) };
  return { aggregate, aggregateAll };
}

/** Minimum counted games in EACH arm before the counted-games comparison is the preferred one. */
export const MIN_COUNTED_FOR_COMPARISON = 30;

function compareHeadlines(th, bh, basis) {
  const rows = [];
  for (const id of Object.keys(th)) {
    const x = th[id];
    const y = bh[id];
    if (!y || x.value === null || y.value === null) continue;
    const diff = x.value - y.value;
    const se = x.se !== null && y.se !== null ? Math.sqrt(x.se * x.se + y.se * y.se) : null;
    rows.push({
      id,
      label: x.label,
      test: x.value,
      testSe: x.se,
      baseline: y.value,
      baselineSe: y.se,
      diff,
      diffSe: se,
      z: se !== null && se > 0 ? diff / se : null,
      exceedsTwoSe: se !== null ? Math.abs(diff) > 2 * se : null,
    });
  }
  return { basis, metrics: rows };
}

/**
 * Compares two arms on every headline metric they share, on two bases: the COUNTED games
 * (turn-limit games excluded, the headline) and ALL finished games. `preferred` names the
 * basis to read: counted, unless either arm has fewer than MIN_COUNTED_FOR_COMPARISON counted
 * games (a comparison of two or three games means nothing).
 *
 * The arms are treated as independent samples (they use the same game seeds, but once a rule
 * differs the games diverge), so the standard error of a difference is sqrt(se_a^2 + se_b^2).
 */
export function compareArms(testArm, baselineArm) {
  const turnLimit = (arm) => ({ 'turnLimit.share': arm.aggregate.headline['turnLimit.share'] });
  const counted = compareHeadlines({ ...testArm.aggregate.headline }, { ...baselineArm.aggregate.headline }, 'counted');
  const all = compareHeadlines({ ...testArm.aggregateAll.headline, ...turnLimit(testArm) }, { ...baselineArm.aggregateAll.headline, ...turnLimit(baselineArm) }, 'all-finished');
  const enough = testArm.aggregate.counts.counted >= MIN_COUNTED_FOR_COMPARISON && baselineArm.aggregate.counts.counted >= MIN_COUNTED_FOR_COMPARISON;
  return {
    note: 'diff = test - baseline. Independent-samples standard error. `exceedsTwoSe` is true when |diff| > 2 x diffSe; with this many rows expect a few false alarms at 2 SE.',
    preferred: enough ? 'counted' : 'all-finished',
    countedGames: { test: testArm.aggregate.counts.counted, baseline: baselineArm.aggregate.counts.counted },
    counted,
    allFinished: all,
  };
}
