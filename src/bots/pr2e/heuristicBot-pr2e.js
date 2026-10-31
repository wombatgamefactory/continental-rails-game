// heuristicBot-pr2e.js - the heuristic bot of the "Pacific Rails, second edition"
// ruleset (id `pr2e`): Medium as it stands, Easy with noise on top, and the
// policies the tree search (Hard, Expert) is built on.
//
// HOW IT PLAYS
//
// Every decision is one atomic action from getValidActions(state), so the bot
// cannot score "a turn". At every decision it works out the same short plan
// again FROM THE STATE ALONE and scores each legal action by what it adds
// towards that plan, in one currency: victory points, or the share of a
// future VP gain that the action brings closer ("VP-equivalents").
//
//   1. Map analysis: which cities hold buildings, the laid chains, the cheapest
//      way across the map (slots still to lay), the turns the game has left.
//   2. Lay candidates: a depth-first search over printed routes from each of
//      the player's trains. A path may travel over laid track and lay routes;
//      it is valued by its track VP (2 per slot to a city without a building,
//      1 otherwise, 3 per slot if it completes the line), the tolls it pays,
//      the building it forces on arrival (compulsory, P14.6: the table VP, a
//      telegraph row VP or a railway station's production and carriage), its
//      share of the crossing, and, for a completing lay, whether the player
//      is ahead when the game ends.
//   3. Targets: every path that fits in storage, valued by VP over the turns
//      still needed (Collects for missing resources, activations for missing
//      tiles, then the lay). The best is target 1, the best follow-up target 2.
//   4. An action is scored by the value it adds: whatever changes storage is
//      scored by `phi`, the target's value times the share of its remaining
//      turns the change saves, plus the surplus a unit is worth beyond the
//      targets (a built tile is 1 VP at the end, a Coin buys Congress).
//      A district is scored by simulating its action at the multiplier the
//      grid gives (Collect: units plus the special action they pay for; board
//      activation: every step, with the Financier steps choosing Congress
//      columns or a Reset; Lay Track or Hire: the best lays or hires).
//      The worker step is scored by the best district it opens at the
//      multiplier it gives, hats included.
//
// Terminology as everywhere: a `house` is the production multiplier on the
// player board; buildings on the map are railway and telegraph stations;
// locations on the grid are districts. Built tiles (in storage) and laid
// tiles (on the map) are never confused: `useStep` builds, a lay lays.
//
// THE ANTI-LIVELOCK GUARDS (web-board-game skill, "AI Bots"): (a) the bot
// always returns an action from getValidActions; (b) it proposes nothing else;
// (c) pr2e has no Move Train, so `repeatGuard` is a no-op; (d) a scorer
// returns null for an action it cannot evaluate: such actions rank below every
// scored one.
//
// PURITY. No clock, no random numbers but the `rng` handed in, no output, no
// storage. The bot never changes the state, and remembers nothing between
// decisions, so the policy can be called on cloned states in any order (tree
// search) and for many games in one process (the simulator).
//
// ENGINE. This file imports no engine: `createPr2eHeuristicPolicies(engine)`
// builds the bot against whichever engine a ruleset hands it.

import { PR2E_WEIGHTS, PR2E_EASY_SETTINGS, PR2E_ROLLOUT_SETTINGS, PR2E_SEARCH_SETTINGS, resolvePr2eWeights } from './weights-pr2e.js';

export { PR2E_WEIGHTS, PR2E_EASY_SETTINGS, PR2E_ROLLOUT_SETTINGS, PR2E_SEARCH_SETTINGS, resolvePr2eWeights };

const TERRAINS = ['ground', 'tunnel', 'bridge'];
const RES3 = ['iron', 'wood', 'gunpowder'];
const RES_OF = { ground: 'iron', tunnel: 'gunpowder', bridge: 'wood' };
const TERR_OF_SPEC = { crew: 'ground', miner: 'tunnel', engineer: 'bridge' };
const TERR_OF_RES = { iron: 'ground', gunpowder: 'tunnel', wood: 'bridge' };
const METRIC_OF_SPEC = { crew: 'crew', miner: 'miners', engineer: 'engineers', financier: 'financiers' };
const STORED_METRICS = new Set(['ironStored', 'coinsStored', 'gunpowderStored', 'woodStored']);
const INF = 1e9;

/**
 * Builds the heuristic policies against one engine.
 * @param {object} engine the namespace exported by an engine's index.js (the pr2e engine)
 * @returns {{ heuristicBot, easyBot, heuristicPolicy, rolloutPolicy, scoreValidActions, repeatGuard, describePlan, decisionShare, pipelineValue, createHeuristicBot }}
 */
export function createPr2eHeuristicPolicies(engine) {
  const {
    getValidActions,
    topFrame,
    getConstants,
    MAP,
    otherEnd,
    isStartCity,
    SPACE_DISTRICTS,
    storageCapacity,
    production,
    housesOnBoard,
    tracksWithHouses,
    telegraphsLeft,
    nextTelegraphVp,
    specialistCounts,
    nextSpecialistSlot,
    adjacentWorkers,
    districtInfo,
    districtHousesOn,
    emptySites,
    canPlaceArrivalBuilding,
    usedWorkerAt,
    scoreGame,
    metricValue,
    goalsInPlay,
    isEmptyInlandCity,
    rngNext,
    rngInt,
  } = engine;

  // -------------------------------------------------------------------------
  // The map, as tables (it never changes in a game)
  // -------------------------------------------------------------------------

  const CITY_IDS = MAP.cityIds;
  const INLAND = MAP.inlandCities;
  const ADJ = {};
  const DEG = {};
  for (const c of CITY_IDS) {
    ADJ[c] = MAP.cityRoutes[c].map((id) => {
      const r = MAP.routeById[id];
      return { id, to: otherEnd(r, c), r };
    });
    DEG[c] = ADJ[c].length;
  }
  const WEST = MAP.westStartCities;
  const EAST = MAP.eastStartCities;

  /** Slots from `sources` to every city, laid routes costing nothing. */
  function slotDistances(ro, sources) {
    const d = {};
    for (const c of CITY_IDS) d[c] = INF;
    for (const s of sources) d[s] = 0;
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      for (const r of MAP.routes) {
        const cost = ro[r.id] !== null ? 0 : r.length;
        if (d[r.a] + cost < d[r.b]) {
          d[r.b] = d[r.a] + cost;
          changed = true;
        }
        if (d[r.b] + cost < d[r.a]) {
          d[r.a] = d[r.b] + cost;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return d;
  }

  /** Slots between two start cities on the printed map (every route counted), for the set-up draft. */
  const PRINTED = (() => {
    const none = {};
    for (const r of MAP.routes) none[r.id] = null;
    const table = {};
    for (const c of MAP.startCities) table[c] = slotDistances(none, [c]);
    return table;
  })();

  // -------------------------------------------------------------------------
  // The context of one decision
  // -------------------------------------------------------------------------

  function holdingsOf(P) {
    return {
      iron: P.resources.iron,
      wood: P.resources.wood,
      gunpowder: P.resources.gunpowder,
      coins: P.coins,
      ground: P.builtTiles.ground,
      tunnel: P.builtTiles.tunnel,
      bridge: P.builtTiles.bridge,
      hats: P.hats,
    };
  }

  function usedOf(h) {
    return h.iron + h.wood + h.gunpowder + h.coins + h.ground + h.tunnel + h.bridge;
  }

  function makeCtx(state, pid, W, easy) {
    const P = state.players[pid];
    const ctx = {
      state,
      pid,
      P,
      W,
      easy,
      n: state.players.length,
      K: getConstants(state),
      cap: storageCapacity(state, pid),
      h: holdingsOf(P),
      spec: specialistCounts(state, pid),
      bcount: 0,
      _map: null,
      _tl: undefined,
      _targets: null,
      _afford: null,
      _plan: null,
      _arr: new Map(),
      _margin: undefined,
      _unit: {},
      _goal: {},
      _dv: new Map(),
    };
    ctx.prod = {};
    for (const k of ['iron', 'wood', 'gunpowder', 'coins']) ctx.prod[k] = production(state, pid, k);
    // building count (railway plus telegraph stations on the map)
    let b = 0;
    for (const c of INLAND) {
      if (state.map.railwayStation[c] === pid) b += 1;
      if (state.map.telegraphStation[c] === pid) b += 1;
    }
    ctx.bcount = b;
    // district houses of the player on each collect district, and the average yield of a Collect of each resource
    ctx.dh = {};
    ctx.yield = {};
    const dhByRes = { gunpowder: 'D1', iron: 'D3', wood: 'D7', coins: 'D9' };
    for (const k of ['iron', 'wood', 'gunpowder', 'coins']) {
      const d = dhByRes[k];
      ctx.dh[k] = districtHousesOn(state, pid, d);
      ctx.yield[k] = Math.max(1, ctx.prod[k] + ctx.dh[k] + W.avgM - 1);
    }
    return ctx;
  }

  /** The laid routes as a string of 0 and 1, the key of everything that depends only on which routes are laid. */
  function laidKey(ro) {
    let k = '';
    for (const id of MAP.routeIds) k += ro[id] === null ? '0' : '1';
    return k;
  }

  const GEO_CACHE = new Map();

  /** Laid chains and slot distances for one set of laid routes (pure in the laid flags: shared by every game). */
  function geoOf(ro, key) {
    let geo = GEO_CACHE.get(key);
    if (geo !== undefined) return geo;
    const comp = {};
    let nc = 0;
    for (const c of CITY_IDS) {
      if (comp[c] !== undefined) continue;
      comp[c] = nc;
      const stack = [c];
      while (stack.length > 0) {
        const x = stack.pop();
        for (const e of ADJ[x]) {
          if (ro[e.id] === null || comp[e.to] !== undefined) continue;
          comp[e.to] = nc;
          stack.push(e.to);
        }
      }
      nc += 1;
    }
    const westComps = new Set(WEST.map((c) => comp[c]));
    const eastComps = new Set(EAST.map((c) => comp[c]));
    let lineExists = false;
    for (const x of eastComps) if (westComps.has(x)) lineExists = true;
    const dW = slotDistances(ro, WEST);
    const dE = slotDistances(ro, EAST);
    let cross = INF;
    for (const c of CITY_IDS) cross = Math.min(cross, dW[c] + dE[c]);
    geo = { comp, westComps, eastComps, lineExists, dW, dE, crossRemain: cross };
    if (GEO_CACHE.size > 20000) GEO_CACHE.clear();
    GEO_CACHE.set(key, geo);
    return geo;
  }

  function mapInfo(ctx) {
    if (ctx._map !== null) return ctx._map;
    const st = ctx.state;
    const ro = st.map.routeOwner;
    const key = laidKey(ro);
    const geo = geoOf(ro, key);
    ctx._map = { ...geo, key, ro, lineExists: geo.lineExists || st.completion !== null, rs: st.map.railwayStation, ts: st.map.telegraphStation };
    return ctx._map;
  }

  /** How many turns the player expects to take from here (P19 end by the line; the turn limit is a safety stop). */
  function horizon(ctx) {
    if (ctx._tl !== undefined) return ctx._tl;
    const { state, W, P } = ctx;
    let tl;
    if (state.gameEnd !== null) tl = 1;
    else {
      const m = mapInfo(ctx);
      const cr = m.crossRemain >= INF ? 14 : m.crossRemain;
      const byLine = W.endBaseTurns + cr / (W.slotsPerTurn * ctx.n);
      tl = Math.max(W.minTurnsLeft, Math.min(W.gameLength - P.turnsTaken, byLine));
    }
    ctx._tl = tl;
    return tl;
  }

  // -------------------------------------------------------------------------
  // Units, the targets and progress
  // -------------------------------------------------------------------------

  /** The value of one more Coin when `c` are held: the first are worth most (Congress). */
  function coinHold(W, c) {
    let v = 0;
    for (let i = 0; i < c; i++) v += Math.max(W.coinFloor, W.coin - W.coinFade * i);
    return v;
  }

  /** Turns to lay `need` (tiles by terrain) from holdings `h`: Collects, then activations, then the lay itself. */
  function turnsToGo(ctx, need, h) {
    const W = ctx.W;
    const mg = need.ground > h.ground ? need.ground - h.ground : 0;
    const mt = need.tunnel > h.tunnel ? need.tunnel - h.tunnel : 0;
    const mb = need.bridge > h.bridge ? need.bridge - h.bridge : 0;
    let collect = 0;
    let x = mg - h.iron;
    if (x > 0) collect += x / ctx.yield.iron + W.turnRound;
    x = mt - h.gunpowder;
    if (x > 0) collect += x / ctx.yield.gunpowder + W.turnRound;
    x = mb - h.wood;
    if (x > 0) collect += x / ctx.yield.wood + W.turnRound;
    const total = mg + mt + mb;
    let convert = 0;
    if (total > 0) {
      convert = 12;
      const s1 = ctx.spec.crew;
      const s2 = ctx.spec.miner;
      const s3 = ctx.spec.engineer;
      const F = W.avgForeman;
      const lower = total / (F + s1 + s2 + s3);
      for (let a = Math.max(0.5, Math.ceil(lower * 2) / 2); a <= 12; a += 0.5) {
        const foreman = (Math.max(0, mg - a * s1) + Math.max(0, mt - a * s2) + Math.max(0, mb - a * s3)) / F;
        if (foreman <= a) {
          convert = a;
          break;
        }
      }
    }
    return collect + convert + 1;
  }

  /** The share (0 to 1) of the way to laying a target that holdings `h` represent. */
  function progress(ctx, t, h) {
    if (t.Tempty <= 1.0001) return ctx.W.progressShare;
    const T = turnsToGo(ctx, t.need, h);
    return ctx.W.progressShare * Math.min(1, Math.max(0, (t.Tempty - T) / (t.Tempty - 1)));
  }

  const ZERO_H = { iron: 0, wood: 0, gunpowder: 0, coins: 0, ground: 0, tunnel: 0, bridge: 0, hats: 0 };

  /** Targets 1 and 2: the paths worth planning for (they need not be affordable yet). */
  function ensureTargets(ctx) {
    if (ctx._targets !== null) return ctx._targets;
    const W = ctx.W;
    const sorted = planCandidates(ctx).sorted; // best net value first, so the bound net / (1 + round) only falls
    const bound = 1 + W.targetRound;
    let best = null;
    let bestScore = 0;
    for (const c of sorted) {
      if (c.net <= 0 || c.net / bound <= bestScore) break;
      if (c.need.ground + c.need.tunnel + c.need.bridge > ctx.cap) continue;
      const T = turnsToGo(ctx, c.need, ctx.h);
      const score = c.net / (T + W.targetRound);
      if (score > bestScore) {
        bestScore = score;
        best = { c, T, net: c.net };
      }
    }
    let second = null;
    if (best !== null && !ctx.easy) {
      const used = new Set(best.c.unlaid);
      let secondScore = 0;
      for (const c of sorted) {
        if (c.net <= 0 || c.net / bound <= secondScore) break;
        if (c === best.c || c.need.ground + c.need.tunnel + c.need.bridge > ctx.cap) continue;
        if (c.unlaid.some((id) => used.has(id))) continue;
        const T = turnsToGo(ctx, c.need, ctx.h);
        const score = c.net / (T + W.targetRound);
        if (score > secondScore) {
          secondScore = score;
          second = { c, T, net: c.net };
        }
      }
    }
    const make = (s) => (s === null ? null : { V: s.net, need: s.c.need, cand: s.c, Tempty: turnsToGo(ctx, s.c.need, ZERO_H), T: s.T });
    ctx._targets = { t1: make(best), t2: make(second), count: sorted.length };
    return ctx._targets;
  }

  /** Items over capacity go, the least valuable first (what the player would discard). */
  function clipHold(ctx, h) {
    let over = usedOf(h) - ctx.cap;
    if (over <= 0) return h;
    const { t1, t2 } = ensureTargets(ctx);
    const g = { ...h };
    const needAll = (j) => (t1 ? t1.need[j] : 0) + (t2 ? t2.need[j] : 0);
    const drop = (key, floor) => {
      while (over > 0 && g[key] > floor) {
        g[key] -= 1;
        over -= 1;
      }
    };
    for (const j of TERRAINS) {
      const k = RES_OF[j];
      drop(k, Math.max(0, needAll(j) - g[j]));
    }
    drop('coins', 4);
    for (const j of TERRAINS) drop(j, needAll(j));
    drop('coins', 1);
    for (const j of TERRAINS) drop(j, 0);
    for (const k of RES3) drop(k, 0);
    drop('coins', 0);
    return g;
  }

  /**
   * The value of holding `h`: progress on the two targets, plus what a unit is worth beyond them. Differences
   * of this are what an action that changes storage is worth. `clip` (default) first discards what would not fit.
   */
  function phi(ctx, h, clip = true) {
    const W = ctx.W;
    const hh = clip ? clipHold(ctx, h) : h;
    const { t1, t2 } = ensureTargets(ctx);
    let v = 0;
    if (t1) v += t1.V * progress(ctx, t1, hh);
    if (t2) v += W.secondDiscount * t2.V * progress(ctx, t2, hh);
    for (const j of TERRAINS) {
      const needAll = (t1 ? t1.need[j] : 0) + (t2 ? t2.need[j] : 0);
      v += W.tileSurplus * Math.max(0, hh[j] - needAll);
      const resNeed = Math.max(0, needAll - hh[j]);
      const sur = Math.max(0, hh[RES_OF[j]] - resNeed);
      v += W.resSurplus * Math.min(sur, W.resSurplusCap);
    }
    v += coinHold(W, hh.coins) + W.hat * hh.hats;
    return v;
  }

  /** What one more unit of `key` (a resource or coins) is worth now, at least `floor`. */
  function unitGain(ctx, key) {
    if (ctx._unit[key] !== undefined) return ctx._unit[key];
    const h2 = { ...ctx.h };
    h2[key] += 1;
    const v = Math.max(0.4, phi(ctx, h2) - phi(ctx, ctx.h));
    ctx._unit[key] = v;
    return v;
  }

  /** The loss of paying one unit of `key` from `h`. */
  function unitLoss(ctx, h, key) {
    if (h[key] <= 0) return 99;
    const h2 = { ...h };
    h2[key] -= 1;
    return Math.max(0.3, phi(ctx, h) - phi(ctx, h2));
  }

  // -------------------------------------------------------------------------
  // Goals (P18)
  // -------------------------------------------------------------------------

  function goalDelta(ctx, metric, d) {
    if (d === 0) return 0;
    let info = ctx._goal[metric];
    if (info === undefined) {
      const goals = goalsInPlay(ctx.state).filter((g) => g.metric === metric);
      if (goals.length === 0) info = null;
      else {
        const mine = metricValue(ctx.state, ctx.pid, metric) ?? 0;
        let bestOther = 0;
        for (const p of ctx.state.players) if (p.id !== ctx.pid) bestOther = Math.max(bestOther, metricValue(ctx.state, p.id, metric) ?? 0);
        info = { count: goals.length, mine, bestOther };
      }
      ctx._goal[metric] = info;
    }
    if (info === null) return 0;
    const W = ctx.W;
    const tl = horizon(ctx);
    let cert = Math.min(1, Math.max(W.goalCertaintyMin, 1 - tl / W.goalHorizon));
    if (STORED_METRICS.has(metric) && tl > 3) cert *= W.storedGoalShare;
    const pl = (x) => 1 / (1 + Math.exp(-(x - info.bestOther - 0.5) * 1.2));
    return ctx.K.SCORING.goalVp * info.count * cert * (pl(info.mine + d) - pl(info.mine));
  }

  // -------------------------------------------------------------------------
  // Buildings (P16), production and carriages
  // -------------------------------------------------------------------------

  function tableMarginal(ctx) {
    const t = ctx.K.SCORING.buildingTable;
    const at = (x) => {
      const lo = Math.min(t.length - 2, Math.floor(x));
      const f = x - lo;
      const a = t[lo + 1] - t[lo];
      const b = t[Math.min(t.length - 1, lo + 2)] - t[Math.min(t.length - 1, lo + 1)];
      return a * (1 - f) + b * f;
    };
    return at(ctx.bcount + ctx.W.tableAhead);
  }

  /** What one more unit of production on `track` is worth, over the turns left. */
  function prodValue(ctx, track) {
    const W = ctx.W;
    const uses = W.prodUses * Math.min(horizon(ctx), 24);
    // a fixed unit value: the targets are planned from building values, so this cannot depend on them
    return uses * W.prodUnit * (track === 'coins' ? W.coinProdBonus : 1);
  }

  function tollPotential(ctx, city) {
    const W = ctx.W;
    return W.tollPotential * Math.max(0, DEG[city] - 2) * Math.min(1, horizon(ctx) / 10) * (ctx.n > 2 ? 1 : 0.8);
  }

  /** The best house track for a railway station: `{ value, track }`. */
  function bestTrack(ctx) {
    let best = { value: -INF, track: null };
    for (const t of tracksWithHouses(ctx.state, ctx.pid)) {
      const v = prodValue(ctx, t);
      if (v > best.value) best = { value: v, track: t };
    }
    return best;
  }

  /**
   * The value of placing a building. `kind` railwayStation or telegraphStation; `mode`: 'lay' (arrival: a railway
   * station counts towards carriages), 'special' or 'congress'. For a railway station `track` is its house track.
   */
  function buildingValue(ctx, city, kind, mode, track) {
    const W = ctx.W;
    let v = tableMarginal(ctx) + tollPotential(ctx, city);
    if (kind === 'telegraphStation') {
      v += nextTelegraphVp(ctx.state, ctx.pid) ?? 0;
      v += goalDelta(ctx, 'telegraphStations', 1);
    } else {
      v += prodValue(ctx, track) - W.houseCost + goalDelta(ctx, 'railwayStations', 1);
      if (mode === 'lay' && ctx.P.layStationsPlaced < ctx.K.MAP_RULES.carriagesForLayStations) {
        v += W.carriageValue[ctx.P.layStationsPlaced] * Math.min(1, horizon(ctx) / 12);
      }
    }
    return v;
  }

  /** The arrival building a lay forces in `city` (P14.6): `{ value, kind, track }`; 0 when the player is not able. */
  function arrivalBest(ctx, city) {
    let r = ctx._arr.get(city);
    if (r === undefined) {
      r = arrivalCompute(ctx, city);
      ctx._arr.set(city, r);
    }
    return r;
  }

  function arrivalCompute(ctx, city) {
    if (isStartCity(city)) return { value: 0, kind: null, track: null };
    const st = ctx.state;
    const rs = st.map.railwayStation[city];
    const ts = st.map.telegraphStation[city];
    let best = { value: 0, kind: null, track: null };
    if (rs === null && ts !== ctx.pid && housesOnBoard(ctx.P) > 0) {
      const bt = bestTrack(ctx);
      if (bt.track !== null) best = { value: buildingValue(ctx, city, 'railwayStation', 'lay', bt.track), kind: 'railwayStation', track: bt.track };
    }
    if (ts === null && rs !== ctx.pid && telegraphsLeft(st, ctx.pid) > 0) {
      const v = buildingValue(ctx, city, 'telegraphStation', 'lay', null);
      if (best.kind === null || v > best.value) best = { value: v, kind: 'telegraphStation', track: null };
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // The lay (P14): candidates and their value
  // -------------------------------------------------------------------------

  function currentMargin(ctx) {
    if (ctx._margin !== undefined) return ctx._margin;
    let margin = 0;
    try {
      const s = scoreGame(ctx.state);
      let best = -INF;
      for (const p of s.players) if (p.id !== ctx.pid) best = Math.max(best, p.total);
      margin = s.players[ctx.pid].total - best;
    } catch (err) {
      margin = 0;
    }
    ctx._margin = margin;
    return margin;
  }

  function crossWeight(ctx) {
    const W = ctx.W;
    return W.crossBase + W.crossPerTurn * Math.max(0, ctx.P.turnsTaken - W.crossFrom);
  }

  /** Fills in the VP, tolls, arrival and value of a path. */
  function evaluate(ctx, cand) {
    const st = ctx.state;
    const W = ctx.W;
    const m = mapInfo(ctx);
    const { cities, routes } = cand;
    let trackVp = 0;
    let slots = 0;
    let cross = 0;
    const crossRemain = m.crossRemain >= INF ? 14 : m.crossRemain;
    for (let i = 0; i < routes.length; i++) {
      if (m.ro[routes[i]] !== null) continue;
      const r = MAP.routeById[routes[i]];
      let j = cities.length - 1;
      for (let x = i + 1; x < cities.length; x++) {
        const c = cities[x];
        if (isStartCity(c) || m.rs[c] !== null || m.ts[c] !== null) {
          j = x;
          break;
        }
      }
      const sc = cities[j];
      const perSlot = !isStartCity(sc) && m.rs[sc] === null && m.ts[sc] === null ? 2 : 1;
      trackVp += perSlot * r.length;
      slots += r.length;
      // progress along the cheapest chain across the map (cost of the chain through this route, with it laid)
      const through = Math.min(m.dW[r.a] + m.dE[r.b], m.dW[r.b] + m.dE[r.a]);
      const excess = through + r.length - crossRemain;
      cross += Math.max(0, r.length - Math.max(0, excess));
    }
    // does it complete the line?
    let completes = false;
    // completing needs at least as many slots as the cheapest chain across the map still lacks
    if (!m.lineExists && slots >= m.crossRemain) {
      const parent = {};
      const find = (x) => {
        while (parent[x] !== undefined && parent[x] !== x) x = parent[x];
        return x;
      };
      for (const id of routes) {
        if (m.ro[id] !== null) continue;
        const r = MAP.routeById[id];
        const a = find(m.comp[r.a]);
        const b = find(m.comp[r.b]);
        if (a !== b) parent[a] = b;
      }
      const west = new Set();
      for (const x of m.westComps) west.add(find(x));
      for (const x of m.eastComps) if (west.has(find(x))) completes = true;
    }
    let tolls = 0;
    for (let i = 1; i < cities.length; i++) {
      const c = cities[i];
      if (isStartCity(c)) continue;
      if (m.rs[c] !== null && m.rs[c] !== ctx.pid) tolls += 1;
      if (m.ts[c] !== null && m.ts[c] !== ctx.pid) tolls += 1;
    }
    const dest = cities[cities.length - 1];
    const arrival = arrivalBest(ctx, dest);
    const tollVp = ctx.K.MAP_RULES.tollVp;
    const tollWeight = ctx.easy ? 0 : W.tollPaid;
    let V = (completes ? ctx.K.MAP_RULES.completionVpPerSlot * slots : trackVp) - tolls * tollVp * tollWeight + arrival.value + crossWeight(ctx) * cross + W.layUrgency;
    if (completes) {
      const after = currentMargin(ctx) + ctx.K.MAP_RULES.completionVpPerSlot * slots + arrival.value - tolls * tollVp - (ctx.n - 1 - ctx.pid) * W.vpPerTurn;
      V += after > 0 ? W.raceBonus : -Math.min(W.raceMaxPenalty, -after * W.racePenaltyRate);
    }
    cand.slots = slots;
    cand.trackVp = trackVp;
    cand.completes = completes;
    cand.tolls = tolls;
    cand.arrival = arrival;
    cand.V = V;
    cand.net = V - (cand.need.ground + cand.need.tunnel + cand.need.bridge) * W.tileKept;
    return cand;
  }

  /**
   * Lay candidates: complete paths (P14.2, P14.3) from the player's trains (or continuing `prefix`, a lay being
   * built), each with its value. `affordable`: only paths the player's built tiles pay for now.
   */
  function enumerateLays(ctx, opts) {
    const st = ctx.state;
    const P = ctx.P;
    const W = ctx.W;
    const m = mapInfo(ctx);
    const shape = st.variants.layShape;
    const mustJoin = st.variants.newConnectionRule === 'must-join-unjoined';
    const out = [];
    const limit = W.maxCandidates;
    const holds = P.builtTiles;
    let starts;
    if (opts.prefix !== null) starts = [{ train: opts.prefix.train, city: opts.prefix.cities[0] }];
    else {
      starts = [];
      P.railheads.forEach((city, train) => {
        if (city !== null && !starts.some((s) => s.city === city)) starts.push({ train, city });
      });
    }
    const maxRoutes = shape === 'adjacent-only' ? 1 : opts.maxRoutes;

    for (const s of starts) {
      const cities = [s.city];
      const routes = [];
      const visited = new Set(cities);
      const need = { ground: 0, tunnel: 0, bridge: 0 };
      const unlaid = [];

      const push = (e) => {
        const laid = m.ro[e.id] !== null;
        cities.push(e.to);
        routes.push(e.id);
        visited.add(e.to);
        if (!laid) {
          unlaid.push(e.id);
          for (const t of TERRAINS) need[t] += e.r.cost[t];
        }
        return laid;
      };
      const pop = (e, laid) => {
        cities.pop();
        routes.pop();
        visited.delete(e.to);
        if (!laid) {
          unlaid.pop();
          for (const t of TERRAINS) need[t] -= e.r.cost[t];
        }
      };
      const record = () => {
        if (out.length >= limit) return;
        out.push(
          evaluate(ctx, {
            train: s.train,
            cities: cities.slice(),
            routes: routes.slice(),
            unlaid: unlaid.slice(),
            need: { ground: need.ground, tunnel: need.tunnel, bridge: need.bridge },
            prefixLength: opts.prefix !== null ? opts.prefix.routes.length : 0,
          })
        );
      };
      const lastIsUnlaid = () => routes.length > 0 && m.ro[routes[routes.length - 1]] === null;
      const zeroTileEnd = () => unlaid.length === 0 && routes.length > 0 && shape !== 'adjacent-only' && isEmptyInlandCity(st, cities[cities.length - 1]) && canPlaceArrivalBuilding(st, ctx.pid, cities[cities.length - 1]);

      const dfs = (cur) => {
        for (const e of ADJ[cur]) {
          if (out.length >= limit) return;
          if (visited.has(e.to)) continue;
          const isUnlaid = m.ro[e.id] === null;
          if (isUnlaid) {
            if (unlaid.length >= opts.maxUnlaid) continue;
            if (mustJoin && m.comp[e.r.a] === m.comp[e.r.b]) continue;
            if (shape === 'one-new-route' && unlaid.length >= 1) continue;
            if (opts.affordable) {
              if (need.ground + e.r.cost.ground > holds.ground || need.tunnel + e.r.cost.tunnel > holds.tunnel || need.bridge + e.r.cost.bridge > holds.bridge) continue;
            }
          } else if (shape === 'adjacent-only') continue;
          const laid = push(e);
          if (isUnlaid) record();
          else if (zeroTileEnd()) record();
          // an unlaid route ends a lay under one-new-route; otherwise the path may go on
          if (routes.length < maxRoutes && !(shape === 'one-new-route' && isUnlaid)) dfs(e.to);
          pop(e, laid);
        }
      };

      if (opts.prefix !== null) {
        let ok = true;
        for (const id of opts.prefix.routes) {
          const route = MAP.routeById[id];
          const cur = cities[cities.length - 1];
          const e = ADJ[cur].find((x) => x.id === id);
          if (!e) {
            ok = false;
            break;
          }
          void route;
          push(e);
        }
        if (!ok) continue;
        if (lastIsUnlaid() || zeroTileEnd()) record();
        dfs(cities[cities.length - 1]);
      } else dfs(s.city);
    }
    return out;
  }

  const PLAN_CACHES = new WeakMap();

  /**
   * Every lay path worth planning (up to maxRoutes routes, maxUnlaid of them unlaid, tiles not yet held) with its
   * value, and the same sorted best first by net value. Nothing in it depends on what the player holds, so it is
   * kept for as long as the map, the player's trains and pieces and the turn number stay as they are (the
   * decisions of one turn, and the many copies of one position a tree search plays from).
   */
  function planCandidates(ctx) {
    if (ctx._plan !== null) return ctx._plan;
    const st = ctx.state;
    const P = ctx.P;
    const m = mapInfo(ctx);
    let key = `${ctx.pid}:${P.railheads.join(',')}:${P.turnsTaken}:${housesOnBoard(P)}:${P.telegraphsPlaced}:${P.layStationsPlaced}:${m.key}:`;
    for (const c of INLAND) key += `${m.rs[c] === null ? '-' : m.rs[c]}${m.ts[c] === null ? '-' : m.ts[c]}`;
    const v = st.variants;
    const scope = `${ctx.easy ? 'e' : 'm'}|${ctx.n}|${v.layShape}|${v.newConnectionRule}|${st.constantsKey ?? ''}|${st.goals.join('')}|${st.gameEnd === null ? 0 : 1}|${m.lineExists ? 1 : 0}`;
    let byScope = PLAN_CACHES.get(ctx.W);
    if (byScope === undefined) {
      byScope = new Map();
      PLAN_CACHES.set(ctx.W, byScope);
    }
    let cache = byScope.get(scope);
    if (cache === undefined) {
      cache = new Map();
      byScope.set(scope, cache);
    }
    let entry = cache.get(key);
    if (entry === undefined) {
      const list = enumerateLays(ctx, { affordable: false, prefix: null, maxRoutes: ctx.W.maxRoutes, maxUnlaid: ctx.W.maxUnlaid });
      const sorted = list.slice().sort((a, b) => b.net - a.net);
      entry = { list, sorted };
      if (cache.size > 300) cache.clear();
      cache.set(key, entry);
    }
    ctx._plan = entry;
    return entry;
  }

  /** The affordable lays now, best first (by net value after the tiles' end value). */
  function affordLays(ctx) {
    if (ctx._afford !== null) return ctx._afford;
    const h = ctx.h;
    const list = planCandidates(ctx).sorted.filter((c) => c.need.ground <= h.ground && c.need.tunnel <= h.tunnel && c.need.bridge <= h.bridge);
    ctx._afford = list;
    return list;
  }

  function holdsAfter(cand, tiles) {
    return tiles.ground >= cand.need.ground && tiles.tunnel >= cand.need.tunnel && tiles.bridge >= cand.need.bridge;
  }

  /** What `M` lays of one Lay Track action are worth: the best, then the best that is still affordable and shares no route. */
  function layGain(ctx, M) {
    const list = affordLays(ctx);
    if (list.length === 0 || list[0].net <= 0) return 0;
    const tiles = { ground: ctx.h.ground, tunnel: ctx.h.tunnel, bridge: ctx.h.bridge };
    const used = new Set();
    let total = 0;
    let factor = 1;
    for (let i = 0; i < M; i++) {
      let pick = null;
      for (const c of list) {
        if (c.net <= 0) break;
        if (!holdsAfter(c, tiles)) continue;
        if (c.unlaid.some((id) => used.has(id))) continue;
        pick = c;
        break;
      }
      if (pick === null) break;
      total += factor * pick.net;
      for (const t of TERRAINS) tiles[t] -= pick.need[t];
      for (const id of pick.unlaid) used.add(id);
      factor = ctx.W.secondLay;
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Specialists, upgrades, district houses and the other placements
  // -------------------------------------------------------------------------

  function specialistValue(ctx, type, spot) {
    const W = ctx.W;
    const tl = horizon(ctx);
    const uses = Math.min(W.activationCap, tl * W.activationShare);
    let per;
    if (type === 'financier') per = W.financierUse;
    else {
      const j = TERR_OF_SPEC[type];
      const { t1 } = ensureTargets(ctx);
      let demand = 0;
      if (t1) {
        const total = t1.need.ground + t1.need.tunnel + t1.need.bridge;
        if (total > 0) demand = t1.need[j] / total;
      }
      per = W.stepChance * (W.tileSurplus + 1.5 * demand);
    }
    let v = uses * per + goalDelta(ctx, METRIC_OF_SPEC[type], 1);
    if (spot && spot.carriage === 3) v += ctx.K.PLAYER_BOARD.carriage3SpaceVp[spot.slot] ?? 0;
    return v;
  }

  function upgradeValue(ctx, tokenId) {
    const W = ctx.W;
    const data = ctx.K.SUPPLY.upgradeTokens.find((t) => t.id === tokenId);
    if (!data) return 0;
    const uses = Math.min(W.activationCap, horizon(ctx) * W.upgradeUses);
    const unit = data.gives === 'choice' ? 1.1 : unitGain(ctx, data.gives);
    return uses * data.level * unit * 0.9;
  }

  function districtHouseValue(ctx, district, track, vp) {
    const W = ctx.W;
    const info = districtInfo(ctx.state, district);
    const res = info.collects;
    const uses = W.districtHouseUses * Math.min(horizon(ctx), 24);
    return vp + prodValue(ctx, track) + uses * unitGain(ctx, res) + goalDelta(ctx, 'districtHouses', 1) + 0.4 - W.houseCost;
  }

  /** The value of one placement action (a building, a district house or an upgrade), excluding what it costs. */
  function placementValue(ctx, a, mode) {
    const st = ctx.state;
    switch (a.type) {
      case 'placeTelegraphStation':
        return buildingValue(ctx, a.city, 'telegraphStation', mode, null);
      case 'placeRailwayStation':
        return buildingValue(ctx, a.city, 'railwayStation', mode, a.houseTrack);
      case 'placeDistrictHouse':
        return districtHouseValue(ctx, a.district, a.houseTrack, mode === 'k5' ? ctx.K.CONGRESS.k5Vp : ctx.K.SCORING.specialActionVp.districtHouse);
      case 'installUpgrade': {
        const carriage = ctx.P.train.specialistCarriages[a.carriage - 1];
        let v = upgradeValue(ctx, a.token) + goalDelta(ctx, 'upgradesInstalled', 1);
        if (carriage && carriage.upgrade !== null) v -= upgradeValue(ctx, carriage.upgrade) + goalDelta(ctx, 'upgradesInstalled', 1);
        else v += mode === 'k5' ? ctx.K.CONGRESS.k5Vp : ctx.K.SCORING.specialActionVp.upgrade;
        void st;
        return v;
      }
      default:
        return 0;
    }
  }

  /** The install actions possible now (P12.2), ignoring replacement. */
  function upgradeActions(ctx) {
    const out = [];
    const tokens = new Set(ctx.state.supply.upgrades);
    const firstFree = ctx.state.variants.upgradePlacement === 'first-free';
    for (const c of ctx.P.train.specialistCarriages) {
      if (c.upgrade !== null || !c.slots.some((s) => s !== null)) continue;
      for (const token of tokens) {
        const data = ctx.K.SUPPLY.upgradeTokens.find((t) => t.id === token);
        if (data && data.level === c.number) out.push({ type: 'installUpgrade', token, carriage: c.number });
      }
      if (firstFree) break;
    }
    return out;
  }

  /** Cities for the placement specials. */
  function otherRailwayCities(ctx) {
    const st = ctx.state;
    return INLAND.filter((c) => st.map.railwayStation[c] !== null && st.map.railwayStation[c] !== ctx.pid && st.map.telegraphStation[c] === null);
  }
  function otherTelegraphCities(ctx) {
    const st = ctx.state;
    return INLAND.filter((c) => st.map.telegraphStation[c] !== null && st.map.telegraphStation[c] !== ctx.pid && st.map.railwayStation[c] === null);
  }

  /** Best value of a special action of a Collect district (P6.7), given holdings `h` (cost not subtracted): { value, cost }. */
  function specialBest(ctx, special, h) {
    const st = ctx.state;
    const K = ctx.K;
    if (special === 'telegraphStation') {
      if (h.coins < 1 || telegraphsLeft(st, ctx.pid) <= 0) return null;
      let best = -INF;
      for (const c of otherRailwayCities(ctx)) best = Math.max(best, buildingValue(ctx, c, 'telegraphStation', 'special', null));
      return best === -INF ? null : { value: best, cost: 'coins' };
    }
    if (special === 'railwayStation') {
      if (h.iron < 1 || housesOnBoard(ctx.P) <= 0) return null;
      const cities = otherTelegraphCities(ctx);
      if (cities.length === 0) return null;
      const bt = bestTrack(ctx);
      let best = -INF;
      for (const c of cities) best = Math.max(best, buildingValue(ctx, c, 'railwayStation', 'special', bt.track));
      return { value: best, cost: 'iron' };
    }
    if (special === 'districtHouse') {
      if (h.wood < 1 || housesOnBoard(ctx.P) <= 0) return null;
      const sites = emptySites(st);
      if (sites.length === 0) return null;
      const bt = bestTrack(ctx);
      let best = -INF;
      for (const { district } of sites) best = Math.max(best, districtHouseValue(ctx, district, bt.track, K.SCORING.specialActionVp.districtHouse));
      return { value: best, cost: 'wood' };
    }
    if (special === 'upgrade') {
      if (h.gunpowder < 1) return null;
      let best = -INF;
      for (const a of upgradeActions(ctx)) best = Math.max(best, placementValue(ctx, a, 'special'));
      return best === -INF ? null : { value: best, cost: 'gunpowder' };
    }
    return null;
  }

  function specialGain(ctx, special, h) {
    const b = specialBest(ctx, special, h);
    if (b === null) return 0;
    return Math.max(0, b.value - unitLoss(ctx, h, b.cost));
  }

  // -------------------------------------------------------------------------
  // Congress (P10)
  // -------------------------------------------------------------------------

  /** The best resource of Wood, Iron, Gunpowder (or any, with coins) to add one unit of, by the gain in phi. */
  function bestUnit(ctx, h, keys) {
    let best = null;
    let bestV = -INF;
    const base = phi(ctx, h);
    for (const k of keys) {
      const h2 = { ...h };
      h2[k] += 1;
      const v = phi(ctx, h2) - base;
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    return best;
  }

  function bestTile(ctx, h) {
    let best = 'ground';
    let bestV = -INF;
    const base = phi(ctx, h);
    for (const j of TERRAINS) {
      const h2 = { ...h };
      h2[j] += 1;
      const v = phi(ctx, h2) - base;
      if (v > bestV) {
        bestV = v;
        best = j;
      }
    }
    return best;
  }

  /** What K5 (a free district house or an upgrade token, 1 VP) is worth. */
  function k5Value(ctx) {
    let best = -INF;
    const sites = emptySites(ctx.state);
    if (sites.length > 0 && housesOnBoard(ctx.P) > 0) {
      const bt = bestTrack(ctx);
      for (const { district } of sites) best = Math.max(best, districtHouseValue(ctx, district, bt.track, ctx.K.CONGRESS.k5Vp));
    }
    for (const a of upgradeActions(ctx)) best = Math.max(best, placementValue(ctx, a, 'k5'));
    return best;
  }

  /** What K7 (one or two buildings from the map) is worth: the best railway station and the best telegraph station. */
  function k7Value(ctx) {
    const st = ctx.state;
    let rsBest = { v: -INF, city: null };
    let tsBest = { v: -INF, city: null };
    if (housesOnBoard(ctx.P) > 0) {
      const bt = bestTrack(ctx);
      for (const c of INLAND) {
        const rs = st.map.railwayStation[c];
        const ts = st.map.telegraphStation[c];
        if (rs !== null || ts === ctx.pid) continue;
        const network = ts === null && mapInfo(ctx).comp !== null && onNetwork(ctx, c);
        if (ts === null && !network) continue;
        const v = buildingValue(ctx, c, 'railwayStation', 'congress', bt.track);
        if (v > rsBest.v) rsBest = { v, city: c };
      }
    }
    if (telegraphsLeft(st, ctx.pid) > 0) {
      for (const c of INLAND) {
        const rs = st.map.railwayStation[c];
        if (rs === null || rs === ctx.pid || st.map.telegraphStation[c] !== null) continue;
        const v = buildingValue(ctx, c, 'telegraphStation', 'congress', null);
        if (v > tsBest.v) tsBest = { v, city: c };
      }
    }
    if (rsBest.v === -INF && tsBest.v === -INF) return -INF;
    if (rsBest.v === -INF) return tsBest.v;
    if (tsBest.v === -INF) return rsBest.v;
    if (rsBest.city !== tsBest.city) return rsBest.v + tsBest.v * 0.9;
    return Math.max(rsBest.v, tsBest.v) + 0.3 * Math.min(rsBest.v, tsBest.v);
  }

  function onNetwork(ctx, c) {
    const ro = mapInfo(ctx).ro;
    for (const e of ADJ[c]) if (ro[e.id] !== null) return true;
    return false;
  }

  const COLUMN_ORDER = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'];

  /**
   * One Financier action for the holdings `h` and senators `down` (an object of booleans): every option as
   * `{ id, gain, h2, vp, down2 }`, where `gain` is the whole value (phi difference, VP and what it places).
   */
  function congressOptions(ctx, h, down) {
    const K = ctx.K;
    const W = ctx.W;
    const out = [];
    const base = phi(ctx, h);
    for (const col of K.CONGRESS.columns) {
      if (down[col.id] || h.coins < col.cost) continue;
      const h2 = { ...h };
      h2.coins -= col.cost;
      const vp = 0;
      let extra = 0;
      switch (col.reward) {
        case 'gain':
          for (const k in col.items) h2[k] += col.items[k];
          break;
        case 'hats': {
          const room = K.HATS.hatLimit - h2.hats;
          const get = Math.min(col.count, Math.max(0, room));
          h2.hats += get;
          for (let i = get; i < col.count; i++) {
            if (ctx.state.variants.hatOverflow === 'lost') break;
            const k = bestUnit(ctx, h2, ['wood', 'iron', 'gunpowder', 'coins']);
            h2[k] += 1;
          }
          break;
        }
        case 'districtHouseOrUpgrade': {
          const v = k5Value(ctx);
          if (v === -INF) continue;
          extra = v;
          break;
        }
        case 'choice':
          for (let i = 0; i < col.count; i++) {
            const k = bestUnit(ctx, h2, RES3);
            h2[k] += 1;
          }
          break;
        case 'buildings': {
          const v = k7Value(ctx);
          if (v === -INF) continue;
          extra = v;
          break;
        }
        case 'builtTiles':
          for (let i = 0; i < col.count; i++) h2[bestTile(ctx, h2)] += 1;
          break;
        default:
          continue;
      }
      const down2 = { ...down, [col.id]: true };
      const bonus = vp + extra + W.congressBias;
      out.push({ id: col.id, gain: phi(ctx, h2) - base + bonus, bonus, h2, down2 });
    }
    let downCount = 0;
    for (const id of COLUMN_ORDER) if (down[id]) downCount += 1;
    if (downCount > 0 && h.coins >= K.CONGRESS.resetCost) {
      const h2 = { ...h };
      h2.coins -= K.CONGRESS.resetCost;
      const vp = downCount * K.CONGRESS.resetVpPerSenator * W.resetVp;
      const down2 = {};
      for (const id of COLUMN_ORDER) down2[id] = false;
      const bonus = vp + W.congressBias;
      out.push({ id: 'KR', gain: phi(ctx, h2) - base + bonus, bonus, h2, down2 });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Districts: what an action is worth at multiplier M
  // -------------------------------------------------------------------------

  function activationSteps(ctx, foreman, M) {
    const steps = [];
    for (let i = 0; i < M; i++) steps.push({ type: foreman });
    for (const c of ctx.P.train.specialistCarriages) {
      if (c.upgrade !== null) steps.push({ type: 'upgrade', token: c.upgrade });
      for (const s of c.slots) if (s !== null) steps.push({ type: s });
    }
    return steps;
  }

  /**
   * Walks a board activation from holdings `h0`: returns the holdings after it and `extras`, the VP and the
   * placements (K5, K7) that the Financier steps earned and phi cannot see.
   */
  function simulateActivation(ctx, h0, foreman, M, down0) {
    const W = ctx.W;
    const { t1, t2 } = ensureTargets(ctx);
    const needAll = (j) => (t1 ? t1.need[j] : 0) + (t2 ? t2.need[j] : 0);
    const h = { ...h0 };
    let cur = h;
    let down = down0;
    let extras = 0;
    for (const step of activationSteps(ctx, foreman, M)) {
      if (step.type === 'upgrade') {
        const data = ctx.K.SUPPLY.upgradeTokens.find((t) => t.id === step.token);
        if (!data) continue;
        if (data.gives === 'choice') for (let i = 0; i < data.level; i++) cur[bestUnit(ctx, cur, ['wood', 'iron', 'gunpowder', 'coins'])] += 1;
        else cur[data.gives] += data.level;
      } else if (step.type === 'financier') {
        const opts = congressOptions(ctx, cur, down);
        let best = null;
        for (const o of opts) if (o.gain > 0.05 && (best === null || o.gain > best.gain)) best = o;
        if (best !== null) {
          extras += best.bonus;
          cur = best.h2;
          down = best.down2;
        }
      } else {
        const j = TERR_OF_SPEC[step.type];
        const k = RES_OF[j];
        if (cur[k] >= 1 && (needAll(j) > cur[j] || cur[k] > W.keepResource)) {
          cur[k] -= 1;
          cur[j] += 1;
        }
      }
    }
    return { h: cur, extras };
  }

  function activationGain(ctx, foreman, M) {
    const sim = simulateActivation(ctx, ctx.h, foreman, M, ctx.state.congress.down);
    return phi(ctx, sim.h) - phi(ctx, ctx.h) + sim.extras;
  }

  /** Free spaces for specialists, in hiring order: `[{ carriage, slot }]`. */
  function emptySlots(ctx) {
    const out = [];
    for (const c of ctx.P.train.specialistCarriages) c.slots.forEach((s, slot) => s === null && out.push({ carriage: c.number, slot }));
    return out;
  }

  function hireGain(ctx, M) {
    const st = ctx.state;
    const slots = emptySlots(ctx);
    if (slots.length === 0) return 0;
    const supply = { ...st.supply.specialists };
    let total = 0;
    for (let i = 0; i < Math.min(M, slots.length); i++) {
      let best = -INF;
      let bestType = null;
      for (const type of ctx.K.SPECIALIST_TYPES) {
        if (supply[type] <= 0) continue;
        let v = specialistValue(ctx, type, slots[i]);
        if (st.variants.tycoonMode) {
          const cost = ctx.K.HIRING.tycoonCosts[type][slots[i].carriage - 1];
          let paid = 0;
          for (const k in cost) paid += cost[k] * 0.8;
          v -= paid;
        }
        if (v > best) {
          best = v;
          bestType = type;
        }
      }
      if (bestType === null) break;
      supply[bestType] -= 1;
      if (best <= 0 && i > 0) break;
      total += best;
    }
    return total;
  }

  /** The value of the action of district `d` at multiplier `M` (D5: `mode` lay or hire). */
  function dv(ctx, d, M, mode) {
    const key = `${d}|${M}|${mode ?? ''}`;
    const cached = ctx._dv.get(key);
    if (cached !== undefined) return cached;
    const info = districtInfo(ctx.state, d);
    let v = 0;
    if (info.family === 'collect') {
      const k = info.collects;
      const units = ctx.prod[k] + ctx.dh[k] + (M - 1);
      const h2 = { ...ctx.h };
      h2[k] += units;
      v = phi(ctx, h2) - phi(ctx, ctx.h) + ctx.W.specialShare * specialGain(ctx, info.special, h2);
    } else if (info.family === 'boardActivation') {
      v = activationGain(ctx, info.foremanType, M);
    } else if (mode === 'hire') v = hireGain(ctx, M);
    else v = layGain(ctx, M);
    ctx._dv.set(key, v);
    return v;
  }

  /** The best way to take district `d` at base multiplier `M` with up to the hats held: { value, hats, mode }. */
  function bestDistrict(ctx, d, M) {
    const info = districtInfo(ctx.state, d);
    const modes = info.family === 'layOrHire' ? ['lay', 'hire'] : [undefined];
    let best = { value: -INF, hats: 0, mode: undefined };
    for (const mode of modes) {
      for (let hats = 0; hats <= ctx.P.hats; hats++) {
        const v = dv(ctx, d, M + hats, mode) - hats * ctx.W.hat;
        if (v > best.value) best = { value: v, hats, mode };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Scoring each kind of decision
  // -------------------------------------------------------------------------

  function scoreStartingProduction(ctx, actions) {
    return actions.map((a) => ctx.W.startProduction[a.track] ?? 0);
  }

  function scorePlaceRailhead(ctx, actions) {
    const P = ctx.P;
    const W = ctx.W;
    const first = P.railheads[0] === null ? null : P.railheads[0];
    return actions.map((a) => {
      const c = a.city;
      const side = WEST.includes(c) ? EAST : WEST;
      let nearest = INF;
      for (const o of side) nearest = Math.min(nearest, PRINTED[c][o]);
      let hub = 0;
      for (const e of ADJ[c]) hub += DEG[e.to];
      hub /= ADJ[c].length;
      let s = -W.startCrossing * nearest + W.startHub * hub;
      if (first !== null) s -= W.startApart * PRINTED[c][first];
      return s;
    });
  }

  function scoreWorkerStep(ctx, actions) {
    const st = ctx.state;
    const W = ctx.W;
    return actions.map((a) => {
      let districts;
      let exclude = null;
      let penalty = 0;
      let sign = 1;
      if (a.type === 'placeWorker') districts = SPACE_DISTRICTS[a.space];
      else if (a.type === 'removeWorker') {
        districts = SPACE_DISTRICTS[a.from] ? SPACE_DISTRICTS[a.from] : [a.from];
        exclude = a.from;
        sign = -1;
      } else {
        districts = [a.district];
        let n = 0;
        for (const w of engine.DISTRICT_SPACES[a.district]) if (st.grid.spaces[w] !== null) n += 1;
        if (st.grid.centres[a.district] !== null) n += 1;
        penalty = W.displaceCost * n;
      }
      let best = -INF;
      for (const d of districts) {
        const M = a.type === 'displaceWorker' ? 1 : 1 + adjacentWorkers(st, ctx.pid, d, exclude);
        const b = bestDistrict(ctx, d, M);
        let v = b.value;
        if (a.type !== 'displaceWorker') {
          const up = bestDistrict(ctx, d, M + 1).value;
          v += sign * W.futureShare * Math.max(0, up - b.value);
        }
        if (v > best) best = v;
      }
      return best - penalty;
    });
  }

  function scoreChooseDistrict(ctx, actions) {
    const st = ctx.state;
    const exclude = usedWorkerAt(st);
    return actions.map((a) => {
      if (a.district === 'none') return -50;
      const M = 1 + adjacentWorkers(st, ctx.pid, a.district, exclude) + a.hats;
      return dv(ctx, a.district, M, a.mode) - a.hats * ctx.W.hat;
    });
  }

  function scoreSpecialAction(ctx, frame, actions) {
    const h = ctx.h;
    return actions.map((a) => {
      if (a.type === 'skipSpecialAction') return 0;
      const kind = frame.special;
      const cost = kind === 'telegraphStation' ? 'coins' : kind === 'railwayStation' ? 'iron' : kind === 'districtHouse' ? 'wood' : 'gunpowder';
      return placementValue(ctx, a, 'special') - unitLoss(ctx, h, cost);
    });
  }

  function scoreBoardActivation(ctx, frame, actions) {
    const step = frame.steps[frame.index];
    const h = ctx.h;
    const base = phi(ctx, h);
    if (step && step.type === 'financier') {
      const opts = congressOptions(ctx, h, ctx.state.congress.down);
      const byId = {};
      for (const o of opts) byId[o.id] = o.gain;
      return actions.map((a) => {
        if (a.type === 'skipStep') return 0;
        if (a.type === 'resetSenators') return byId.KR ?? null;
        return byId[a.column] ?? null;
      });
    }
    const { t1, t2 } = ensureTargets(ctx);
    return actions.map((a) => {
      if (a.type === 'skipStep') return 0;
      const j = TERR_OF_SPEC[step.type];
      const k = RES_OF[j];
      const h2 = { ...h };
      h2[k] -= 1;
      h2[j] += 1;
      void t1;
      void t2;
      return phi(ctx, h2) - base + 0.02;
    });
  }

  function scoreCongressPlacement(ctx, frame, actions) {
    const mode = frame.column === 'K5' ? 'k5' : 'congress';
    return actions.map((a) => {
      if (a.type === 'skipBuilding') return 0;
      return placementValue(ctx, a, mode);
    });
  }

  function scoreChooseResource(ctx, actions) {
    const base = phi(ctx, ctx.h);
    return actions.map((a) => {
      const h2 = { ...ctx.h };
      h2[a.resource] += 1;
      return phi(ctx, h2) - base;
    });
  }

  function scoreDiscard(ctx, actions) {
    const base = phi(ctx, ctx.h, false);
    return actions.map((a) => {
      const h2 = { ...ctx.h };
      h2[a.item] -= 1;
      return phi(ctx, h2, false) - base;
    });
  }

  function scoreChooseBuiltTile(ctx, actions) {
    const base = phi(ctx, ctx.h);
    return actions.map((a) => {
      const h2 = { ...ctx.h };
      h2[a.terrain] += 1;
      return phi(ctx, h2) - base;
    });
  }

  function scoreHire(ctx, actions) {
    const slots = emptySlots(ctx);
    const spot = slots[0] ?? null;
    return actions.map((a) => {
      if (a.type === 'stopHiring') return 0;
      let v = specialistValue(ctx, a.specialist, spot);
      if (ctx.state.variants.tycoonMode && spot) {
        const cost = ctx.K.HIRING.tycoonCosts[a.specialist][spot.carriage - 1];
        for (const k in cost) v -= cost[k] * 0.8;
      }
      return v;
    });
  }

  function scoreFreeSpecialist(ctx, actions) {
    return actions.map((a) => specialistValue(ctx, a.specialist, { carriage: 1, slot: 0 }));
  }

  function scoreLay(ctx, frame, actions) {
    const W = ctx.W;
    if (frame.path === null) {
      const list = affordLays(ctx);
      return actions.map((a) => {
        if (a.type === 'stopLaying') return W.stopLayBelow;
        let best = null;
        for (const c of list) if (c.train === a.train) {
          best = c.net;
          break;
        }
        return best;
      });
    }
    const prefix = frame.path;
    const list = enumerateLays(ctx, { affordable: true, prefix, maxRoutes: W.maxRoutes + 2, maxUnlaid: W.maxUnlaid, });
    const k = prefix.routes.length;
    return actions.map((a) => {
      let best = null;
      if (a.type === 'endLay') {
        for (const c of list) if (c.routes.length === k && (best === null || c.net > best)) best = c.net;
        return best;
      }
      for (const c of list) if (c.routes.length > k && c.routes[k] === a.route && (best === null || c.net > best)) best = c.net;
      return best;
    });
  }

  function scorePlaceBuildings(ctx, frame, actions) {
    return actions.map((a) => {
      if (a.type === 'skipBuilding') return 0;
      return placementValue(ctx, a, 'lay');
    });
  }

  function scoreActions(ctx, frame, actions) {
    switch (frame.kind) {
      case 'setupProduction':
        return scoreStartingProduction(ctx, actions);
      case 'setupRailhead':
        return scorePlaceRailhead(ctx, actions);
      case 'workerStep':
        return scoreWorkerStep(ctx, actions);
      case 'chooseDistrict':
        return scoreChooseDistrict(ctx, actions);
      case 'specialAction':
        return scoreSpecialAction(ctx, frame, actions);
      case 'boardActivation':
        return scoreBoardActivation(ctx, frame, actions);
      case 'congressPlacement':
        return scoreCongressPlacement(ctx, frame, actions);
      case 'chooseResource':
        return scoreChooseResource(ctx, actions);
      case 'discard':
        return scoreDiscard(ctx, actions);
      case 'chooseBuiltTile':
        return scoreChooseBuiltTile(ctx, actions);
      case 'hire':
        return scoreHire(ctx, actions);
      case 'chooseFreeSpecialist':
        return scoreFreeSpecialist(ctx, actions);
      case 'lay':
        return scoreLay(ctx, frame, actions);
      case 'placeBuildings':
        return scorePlaceBuildings(ctx, frame, actions);
      default:
        return actions.map(() => null);
    }
  }

  // -------------------------------------------------------------------------
  // The policy
  // -------------------------------------------------------------------------

  /**
   * Scores the legal actions of `state` as Medium sees them: `[{ action, score }]`, null scores for actions the
   * bot has no opinion about. For tests, logs and the tree search's priors.
   */
  function scoreValidActions(state, context = {}) {
    const actions = getValidActions(state);
    const frame = topFrame(state);
    if (actions.length === 0 || frame === null) return [];
    const ctx = makeCtx(state, state.toAct, resolvePr2eWeights(context.weights), false);
    const scores = scoreActions(ctx, frame, actions);
    return actions.map((action, i) => ({ action, score: typeof scores[i] === 'number' && Number.isFinite(scores[i]) ? scores[i] : null }));
  }

  /** The plan in mind: the two targets, for a log or a test. */
  function describePlan(state, context = {}) {
    if (state.toAct === null || state.toAct === undefined) return null;
    const ctx = makeCtx(state, state.toAct, resolvePr2eWeights(context.weights), false);
    const { t1, t2 } = ensureTargets(ctx);
    const show = (t) => (t === null ? null : { path: t.cand.cities.join('>'), value: Math.round(t.V * 10) / 10, need: t.need, turns: Math.round(t.T * 10) / 10, completes: t.cand.completes });
    return { player: state.toAct, candidates: ctx._targets.count, turnsLeft: Math.round(horizon(ctx) * 10) / 10, crossRemain: mapInfo(ctx).crossRemain, target1: show(t1), target2: show(t2) };
  }

  function choose(state, context, settings) {
    const actions = getValidActions(state);
    if (actions.length === 0) throw new Error('pr2e heuristic bot: there is no legal action (the game is over).');
    const frame = topFrame(state);
    const rng = context.rng;
    const weights = resolvePr2eWeights(context.weights); // throws on an unknown name: never swallowed below
    let scores;
    try {
      const ctx = makeCtx(state, state.toAct, weights, settings.shortSighted === true);
      scores = scoreActions(ctx, frame, actions);
    } catch (err) {
      if (context.strict) throw err;
      scores = null; // guard (a): whatever goes wrong in a scorer, a legal action still comes back
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
      // guards (a) and (d): nothing could be scored, so any legal action will do
      return rng ? unscored[rngInt(rng, unscored.length)] : unscored[0];
    }
    let best = 0;
    for (let i = 1; i < ranked.length; i++) if (ranked[i].score > ranked[best].score) best = i;
    if (settings.topThreeChance > 0 && rng && ranked.length > 1 && rngNext(rng) < settings.topThreeChance) {
      const order = ranked.map((_, i) => i).sort((a, b) => ranked[b].score - ranked[a].score || a - b);
      return ranked[order[rngInt(rng, Math.min(3, order.length))]].action;
    }
    return ranked[best].action;
  }

  /**
   * Builds a heuristic bot. `settings`: `{ noise, topThreeChance, jitter, shortSighted }` (all optional).
   * The Medium level is `createHeuristicBot()`.
   */
  function createHeuristicBot(settings = {}) {
    return {
      /**
       * @param {object} state the game state (not changed)
       * @param {{ rng?: { s: number }, weights?: object, jitter?: number, strict?: boolean }} context
       * @returns {object} one of getValidActions(state)
       */
      chooseAction(state, context = {}) {
        return choose(state, context, settings);
      },
    };
  }

  const heuristicBot = createHeuristicBot();
  const easyBot = createHeuristicBot(PR2E_EASY_SETTINGS);

  /** The policy as a plain function, `(state, context) -> action`. */
  function heuristicPolicy(state, context = {}) {
    return choose(state, context, {});
  }

  /**
   * The playout policy of the search: the heuristic with a small chance of a uniformly random legal action, so
   * that playouts differ. Always one of getValidActions(state); deterministic for a state and an rng.
   */
  function rolloutPolicy(state, context = {}) {
    const rng = context.rng;
    if (rng && rngNext(rng) < PR2E_ROLLOUT_SETTINGS.epsilon) {
      const actions = getValidActions(state);
      if (actions.length === 0) throw new Error('pr2e rolloutPolicy: there is no legal action (the game is over).');
      return actions[rngInt(rng, actions.length)];
    }
    return choose(state, context, {});
  }

  /** pr2e has no Move Train, so no railhead can shuttle: the search's repeat guard has nothing to guard. */
  const repeatGuard = { note() {}, wouldRepeat: () => false };

  /** The share of a turn's search allowance a decision gets, by the kind of the pending decision. */
  function decisionShare(state, S) {
    return PR2E_SEARCH_SETTINGS.shareScale * kindShare(state, S);
  }

  function kindShare(state, S) {
    if (state.phase !== 'play') return S.shareSetup;
    if (state.turn.player !== state.toAct) return S.shareOffTurn;
    const frame = topFrame(state);
    switch (frame === null ? '' : frame.kind) {
      case 'workerStep':
        return S.shareWorker;
      case 'chooseDistrict':
        return S.shareDistrict;
      case 'lay':
        return S.shareLayTracks;
      case 'placeBuildings':
        return S.shareBuilding;
      default:
        return S.shareFollowUp;
    }
  }

  /** What a player holds, at a playout cut-off: built tiles score 1 VP each at the end (P20.2.2). */
  function pipelineValue(player, S) {
    const t = player.builtTiles;
    const r = player.resources;
    return (t.ground + t.tunnel + t.bridge) * S.evalBuiltTile + (r.iron + r.wood + r.gunpowder + player.coins) * S.evalResource + player.hats * S.evalHat;
  }

  return { heuristicBot, easyBot, heuristicPolicy, rolloutPolicy, scoreValidActions, repeatGuard, describePlan, decisionShare, pipelineValue, createHeuristicBot };
}
