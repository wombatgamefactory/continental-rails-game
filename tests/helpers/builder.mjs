// builder.mjs - a scripted test driver that PLAYS TO BUILD AND CLAIM, so that
// whole games reach the two real ending triggers (R19.2 the transcontinental
// line, R19.3 the map filling up). It is a test helper, not a bot: it lives
// under tests/, is not registered in src/bots, and makes no claim to play well.
//
// A random bot almost never builds the exact tiles a route needs, so random
// games end by the turn limit of R19.4 and never exercise the end triggers or
// the 25 VP bonus. The builder's whole strategy:
//
//   mode 'line'    aim for one chain of routes from the player's railhead to
//                  the far coast (the cheapest chain in slots, worked out
//                  again at each decision because other players claim routes);
//   mode 'sprawl'  claim whatever is affordable, cheapest route first.
//
// It works out which built tiles it is short of, takes the district that
// gets them (Gather for the raw resource, a train district to build, Lay
// Tracks when a claim is affordable), uses only the activation steps that
// make a tile it still needs, and places buildings for their VP and for the
// house it takes off the board (more production).
//
// It also takes the module decisions in the simplest greedy way: it installs an
// upgrade whenever one fits, buys a Pony Express card it can afford (often
// saving up for a dearer one) and keeps its tokens otherwise. Everything it has no opinion about is a random
// pick from the list.
//
// It only ever returns an action from the list it is given.

import {
  topFrame,
  getConstants,
  hasLegalClaim,
  hasLegalMove,
  canAffordRoute,
  MAP,
  SPACE_DISTRICTS,
  districtInfo,
  isDistrictId,
} from '../../src/engine/index.js';

const TERRAIN_OF = { crew: 'ground', miner: 'tunnel', engineer: 'bridge' };

/** Cheapest unclaimed chain (by slots) from `from` to any city in `goals`, as a list of route ids; routes `pid` owns cost nothing. */
function cheapestChain(state, pid, from, goals) {
  const dist = { [from]: 0 };
  const prev = {};
  const open = [from];
  const done = new Set();
  while (open.length > 0) {
    open.sort((a, b) => dist[a] - dist[b]);
    const city = open.shift();
    if (done.has(city)) continue;
    done.add(city);
    if (goals.includes(city)) {
      const chain = [];
      for (let c = city; c !== from; c = prev[c].city) chain.unshift(prev[c].route);
      return chain;
    }
    for (const id of MAP.cityRoutes[city]) {
      const owner = state.map.routeOwner[id];
      if (owner !== null && owner !== pid) continue;
      const r = MAP.routeById[id];
      const other = r.a === city ? r.b : r.a;
      const cost = dist[city] + (owner === pid ? 0 : r.length);
      if (dist[other] === undefined || cost < dist[other]) {
        dist[other] = cost;
        prev[other] = { city, route: id };
        open.push(other);
      }
    }
  }
  return null;
}

/** The routes the player means to claim next, in order. */
function targets(state, pid, mode) {
  const player = state.players[pid];
  const owner = state.map.routeOwner;
  if (mode === 'line') {
    let best = null;
    for (const city of new Set(player.railheads)) {
      const side = MAP.cityById[city].kind;
      const goals = side === 'east' ? MAP.westStartCities : side === 'west' ? MAP.eastStartCities : [...MAP.westStartCities, ...MAP.eastStartCities];
      const chain = cheapestChain(state, pid, city, goals);
      if (chain === null) continue;
      const open = chain.filter((id) => owner[id] === null);
      if (best === null || open.length < best.length) best = open;
    }
    if (best !== null && best.length > 0) return best.map((id) => MAP.routeById[id]);
  }
  // Sprawl (and a line with no way through): the cheapest unclaimed routes at the railheads.
  const found = [];
  for (const city of new Set(player.railheads)) {
    for (const id of MAP.cityRoutes[city]) if (owner[id] === null) found.push(MAP.routeById[id]);
  }
  found.sort((a, b) => a.length - b.length || (a.id < b.id ? -1 : 1));
  return found;
}

/** Tiles still to build for the next routes on the list, by terrain. */
function deficits(state, pid, plan) {
  const player = state.players[pid];
  const need = { ground: 0, tunnel: 0, bridge: 0 };
  // The first two routes of the plan: enough to keep working without hoarding.
  for (const route of plan.slice(0, 2)) for (const t in need) need[t] += route.cost[t];
  for (const t in need) need[t] = Math.max(0, need[t] - player.builtTiles[t]);
  return need;
}

/** How short the player is of each raw resource to build the missing tiles. */
function resourceShortfall(state, pid, need) {
  const K = getConstants(state);
  const player = state.players[pid];
  const want = { iron: 0, wood: 0, gunpowder: 0 };
  const recipes = K.TRAIN.recipes[state.variants.conversionRate];
  const owner = { ground: 'crew', tunnel: 'miner', bridge: 'engineer' };
  for (const t in need) {
    const cost = recipes[owner[t]].cost;
    for (const k in cost) want[k] += cost[k] * need[t];
  }
  const short = {};
  for (const k in want) short[k] = Math.max(0, want[k] - player.resources[k]);
  return short;
}

/** How much the player would like the action of a district now. */
function districtScore(state, pid, district, plan) {
  const K = getConstants(state);
  const player = state.players[pid];
  const info = districtInfo(state, district);
  const need = deficits(state, pid, plan);
  if (info.family === 'layTracks') {
    return plan.some((r) => canAffordRoute(player, r)) && hasLegalClaim(state, pid) ? 10 : hasLegalMove(state, pid) && !hasLegalClaim(state, pid) ? 0.2 : 0;
  }
  if (info.family === 'trainActivation') {
    const terrain = { crew: 'ground', miner: 'tunnel', engineer: 'bridge' }[info.foremanType];
    if (!terrain || need[terrain] <= 0) return 0.1;
    const cost = K.TRAIN.recipes[state.variants.conversionRate][info.foremanType].cost;
    for (const k in cost) if (player.resources[k] < cost[k]) return 0.1;
    return 5 + need[terrain];
  }
  // Gather.
  if (info.gathers === 'coins') return player.coins < 3 ? 1.5 : 0.3;
  const short = resourceShortfall(state, pid, need)[info.gathers];
  return short > 0 ? 2 + short : 0.4;
}

function accessOf(action) {
  if (action.type === 'placeWorker') return SPACE_DISTRICTS[action.space];
  if (action.type === 'displaceWorker') return [action.district];
  if (action.type === 'removeWorker') return isDistrictId(action.from) ? [action.from] : SPACE_DISTRICTS[action.from];
  return [];
}

/**
 * Builds a chooser: `choose(state, actions, rng)` returns one of `actions`.
 * `rng` is any function returning a float in [0, 1) for tie-breaks.
 */
export function makeBuilder(mode = 'line') {
  const decide = (state, actions, random) => {
    const frame = topFrame(state);
    const pid = state.toAct;
    const K = getConstants(state);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const plan = frame.kind === 'workerStep' || frame.kind === 'chooseDistrict' || frame.kind === 'layTracks' || frame.kind === 'trainActivation' ? targets(state, pid, mode) : [];

    switch (frame.kind) {
      case 'workerStep': {
        let bestScore = -1;
        let best = [];
        for (const a of actions) {
          const score = Math.max(...accessOf(a).map((d) => districtScore(state, pid, d, plan)));
          // Placing keeps the grid fuller (more multiplier); removing is the fallback.
          const adj = a.type === 'placeWorker' ? 0.05 : 0;
          if (score + adj > bestScore + 1e-9) {
            bestScore = score + adj;
            best = [a];
          } else if (Math.abs(score + adj - bestScore) < 1e-9) best.push(a);
        }
        return pick(best);
      }
      case 'chooseDistrict': {
        let bestScore = -1;
        let best = [];
        for (const a of actions) {
          if (a.district === 'none') continue;
          const score = districtScore(state, pid, a.district, plan) + (a.hat ? 0.01 : 0);
          if (score > bestScore + 1e-9) {
            bestScore = score;
            best = [a];
          } else if (Math.abs(score - bestScore) < 1e-9) best.push(a);
        }
        // Spend a hat only on something that matters.
        const withHat = best.filter((a) => a.hat);
        return bestScore >= 5 && withHat.length > 0 ? pick(withHat) : pick(best.filter((a) => !a.hat).concat(best.length === 0 ? actions : []));
      }
      case 'trainActivation': {
        if (frame.congress) {
          const entries = actions.filter((a) => a.type === 'takeCongressEntry');
          // Tiles first (C5/J5/J7), then anything the highest tier gives.
          const tiles = entries.filter((a) => /^(C5|J5|J7)$/.test(a.entry));
          if (tiles.length > 0) return tiles[0];
          return entries.length > 0 && random() < 0.5 ? entries[entries.length - 1] : actions.find((a) => a.type === 'closeCongress');
        }
        const step = frame.steps[frame.index];
        const terrain = TERRAIN_OF[step.type];
        const need = deficits(state, pid, targets(state, pid, mode));
        const use = actions.find((a) => a.type === 'useStep');
        return use && terrain && need[terrain] > 0 ? use : actions.find((a) => a.type === 'skipStep');
      }
      case 'layTracks': {
        const claims = actions.filter((a) => a.type === 'claimRoute');
        if (claims.length > 0) {
          const ids = plan.map((r) => r.id);
          claims.sort((a, b) => {
            const ia = ids.indexOf(a.route);
            const ib = ids.indexOf(b.route);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
          return claims[0];
        }
        const stop = actions.find((a) => a.type === 'stopLaying');
        return stop ?? pick(actions);
      }
      case 'placeBuildings': {
        const tele = actions.find((a) => a.type === 'placeTelegraphStation');
        if (tele) return tele;
        const need = deficits(state, pid, targets(state, pid, mode));
        const short = resourceShortfall(state, pid, need);
        const rail = actions.filter((a) => a.type === 'placeRailwayStation');
        if (rail.length > 0) {
          // Take the house off the track whose resource the player needs most.
          const track = ['iron', 'wood', 'gunpowder', 'coins'].sort((a, b) => (short[b] ?? 0) - (short[a] ?? 0))[0];
          return rail.find((a) => a.houseTrack === track) ?? rail[0];
        }
        return actions.find((a) => a.type === 'skipBuilding');
      }
      case 'bonusAction': {
        // The Carriage Upgrade (R7.3): install whatever fits, any tile. Card 28's free choice (bonus 'any') is answered the same way.
        const installs = actions.filter((a) => a.type === 'installUpgrade');
        if (installs.length > 0) return pick(installs);
        if (frame.bonus === 'any') return pick(actions);
        const hat = actions.find((a) => a.type === 'buyHat');
        if (hat) return hat;
        const hires = actions.filter((a) => a.type === 'hireSpecialist' && a.specialist !== 'financier');
        if (hires.length > 0) return pick(hires);
        const storage = actions.find((a) => a.type === 'addCarriage' && a.carriage === 'storage');
        if (storage && state.players[pid].train.storageCarriages < 2) return storage;
        return actions.find((a) => a.type === 'skipBonusAction');
      }
      case 'chooseResource': {
        const short = resourceShortfall(state, pid, deficits(state, pid, targets(state, pid, mode)));
        const order = K.RESOURCES.slice().sort((a, b) => short[b] - short[a]);
        return actions.find((a) => a.resource === order[0]) ?? pick(actions);
      }
      case 'chooseBuiltTile': {
        const need = deficits(state, pid, targets(state, pid, mode));
        const order = K.TERRAINS.slice().sort((a, b) => need[b] - need[a]);
        return actions.find((a) => a.terrain === order[0]) ?? pick(actions);
      }
      case 'discard': {
        // Drop the resource the player needs least.
        const short = resourceShortfall(state, pid, deficits(state, pid, targets(state, pid, mode)));
        const order = K.RESOURCES.slice().sort((a, b) => short[a] - short[b]);
        for (const r of order) {
          const a = actions.find((x) => x.item === r);
          if (a) return a;
        }
        return pick(actions);
      }
      case 'freeActions': {
        // R4.4, R18: buy a card whenever one can be bought, use an ability, and keep the tokens otherwise (a token can always be exchanged, which a builder has no use for).
        // A card it can afford: half the time the dearest ones when a 5-token card is in reach, otherwise it often saves up.
        const buys = actions.filter((a) => a.type === 'buyPonyCard');
        if (buys.length > 0) {
          const cost = (a) => K.PONY.costs[K.PONY_CARDS.find((c) => c.id === a.card).rank];
          const dearest = Math.max(...buys.map(cost));
          if (dearest >= 5 && random() < 0.5) return pick(buys.filter((a) => cost(a) === dearest));
          if (random() < 0.4) return pick(buys);
        }
        const uses = actions.filter((a) => a.type === 'usePonyCard');
        if (uses.length > 0 && random() < 0.5) return pick(uses);
        return actions.find((a) => a.type === 'endFreeActions');
      }
      case 'freeCongress':
        return actions.find((a) => a.type === 'takeCongressEntry') ?? actions[0];
      case 'chooseOption':
        return actions[0];
      case 'addCarriage':
        return actions.find((a) => a.carriage === 'storage') ?? actions[0];
      default:
        return pick(actions);
    }
  };
  // Whatever the strategy cannot answer, any listed action will do.
  return function choose(state, actions, random) {
    const chosen = decide(state, actions, random);
    return chosen !== undefined ? chosen : actions[Math.floor(random() * actions.length)];
  };
}
