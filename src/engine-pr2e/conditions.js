// conditions.js - the one interpreter for declarative conditions.
//
// Goals, milestones and card conditions are DATA (rules.js): flat records
// `{ metric, op, value, filter? }`. This file turns a metric name into a
// number for a player and compares it. One rule holds from day one:
//
//   AN UNKNOWN METRIC IS FALSE, NEVER TRUE.
//
// A condition the engine does not understand must never be met by accident:
// a placeholder that silently passes is a scoring exploit.
//
// `METRICS` has one entry for every name in rules.js METRIC_NAMES
// (tests/data-integrity.test.mjs checks it). Each is a thin wrapper over a
// read in queries.js. `describeProgress` writes the progress text the UI
// shows ("4 of 6 Tunnel slots"), so the UI composes no rules text itself.

import { getConstants } from './state.js';
import { MAP } from './board.js';
import {
  railwayStationCount,
  telegraphStationCount,
  buildingCount,
  carriageCount,
  cargo,
  completeSpecialistSets,
  maxSpecialistsOneType,
  specialistTotal,
  startCitiesJoined,
  inlandCitiesOnOwnRoutes,
  citiesWithBothOwnBuildings,
  citiesWithOwnBuilding,
  telegraphsWithOpponentRailway,
  cityHasOpponentBuilding,
  isJunctionCity,
  minNorthSouthBuildings,
  buildingsInJunctionCities,
  installedUpgrades,
  ponyTokens,
} from './queries.js';

/**
 * The routes a player owns, worked out in one pass: how many, the longest, and the slots by terrain.
 * Four milestones ask about them (R16.8 MS2 to MS6), and the check of R16.9 asks every player about
 * every tile at the end of every turn, so a caller that evaluates many conditions in a row passes
 * `context = { cache: {} }` and the pass is made once per player. Nothing is stored in the state.
 */
function routeStats(state, p, context) {
  const cache = context !== null && context.cache ? context.cache : null;
  if (cache !== null && cache[p] !== undefined) return cache[p];
  const owner = state.map.routeOwner;
  const routes = MAP.routes;
  const stats = { count: 0, longest: 0, total: 0, slots: { ground: 0, tunnel: 0, bridge: 0 } };
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (owner[route.id] !== p) continue;
    stats.count += 1;
    stats.total += route.length;
    if (route.length > stats.longest) stats.longest = route.length;
    stats.slots.ground += route.cost.ground;
    stats.slots.tunnel += route.cost.tunnel;
    stats.slots.bridge += route.cost.bridge;
  }
  if (cache !== null) cache[p] = stats;
  return stats;
}

/** Slots laid by one Lay Tracks action, by terrain, from the `context` of a `layTracksActionEnd` trigger (R11.10). */
function laidSlots(context) {
  return context !== null && context.totals ? context.totals.slots : null;
}

/**
 * metric name => (state, playerId, filter, context) => number | null.
 * A yes/no metric returns 1 or 0. `context` carries the event a trigger is
 * about (the city of a building being placed, the totals of a Lay Tracks
 * action). A metric that needs a context it was not given returns null,
 * which the interpreter treats as unknown and therefore false.
 */
export const METRICS = {
  // --- goals (R16.5) ---------------------------------------------------------
  railwayStations: (state, p) => railwayStationCount(state, p),
  minNorthSouthBuildings: (state, p) => minNorthSouthBuildings(state, p),
  buildingsInJunctionCities: (state, p) => buildingsInJunctionCities(state, p),
  maxSpecialistsOneType: (state, p) => maxSpecialistsOneType(state, p),
  carriages: (state, p) => carriageCount(state.players[p]),
  upgradesInstalled: (state, p) => installedUpgrades(state, p).length,
  completeSpecialistSets: (state, p) => completeSpecialistSets(state, p),
  specialists: (state, p) => specialistTotal(state, p),
  telegraphsWithOpponentRailway: (state, p) => telegraphsWithOpponentRailway(state, p),
  cargo: (state, p) => cargo(state.players[p]),
  telegraphStations: (state, p) => telegraphStationCount(state, p),
  citiesWithOwnBuilding: (state, p) => citiesWithOwnBuilding(state, p),
  // --- milestones (R16.8) ----------------------------------------------------
  buildings: (state, p) => buildingCount(state, p),
  ownSlots: (state, p, filter, context) => {
    const stats = routeStats(state, p, context);
    return filter && filter.terrain ? stats.slots[filter.terrain] : stats.total;
  },
  longestOwnRoute: (state, p, filter, context) => routeStats(state, p, context).longest,
  ownRoutes: (state, p, filter, context) => routeStats(state, p, context).count,
  startCitiesJoined: (state, p) => (startCitiesJoined(state, p) ? 1 : 0),
  // --- Legislative Agenda trigger conditions (R17.3) -------------------------
  distinctTerrainsLaid: (state, p, filter, context) => {
    const slots = laidSlots(context);
    if (slots === null) return null;
    let n = 0;
    for (const t in slots) if (slots[t] > 0) n += 1;
    return n;
  },
  slotsLaid: (state, p, filter, context) => {
    const slots = laidSlots(context);
    if (slots === null) return null;
    let n = 0;
    for (const t in slots) n += slots[t];
    return n;
  },
  cityHasOpponentBuilding: (state, p, filter, context) =>
    context !== null && context.city ? (cityHasOpponentBuilding(state, context.city, p) ? 1 : 0) : null,
  cityIsJunction: (state, p, filter, context) =>
    context !== null && context.city ? (isJunctionCity(state, context.city) ? 1 : 0) : null,
  ownBuildings: (state, p) => buildingCount(state, p),
  // --- Pony Express per-unit effects (R18.7) ---------------------------------
  inlandCitiesOnOwnRoutes: (state, p) => inlandCitiesOnOwnRoutes(state, p),
  citiesWithBothOwnBuildings: (state, p) => citiesWithBothOwnBuildings(state, p),
  tokensCollected: (state, p) => ponyTokens(state, p).collected,
};

const OPS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
};

/** The value of a metric for a player, or null if the metric is unknown (or lacks its context). */
export function metricValue(state, playerId, metric, filter = null, context = null) {
  const fn = Object.prototype.hasOwnProperty.call(METRICS, metric) ? METRICS[metric] : null;
  if (typeof fn !== 'function') return null;
  const value = fn(state, playerId, filter, context);
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Whether `condition` holds for a player. False for an unknown metric, an
 * unknown operator or a malformed condition.
 */
export function evaluateCondition(state, playerId, condition, context = null) {
  if (condition === null || typeof condition !== 'object') return false;
  const compare = Object.prototype.hasOwnProperty.call(OPS, condition.op) ? OPS[condition.op] : null;
  if (!compare) return false;
  const value = metricValue(state, playerId, condition.metric, condition.filter ?? null, context);
  if (value === null || typeof condition.value !== 'number') return false;
  return compare(value, condition.value);
}

// ---------------------------------------------------------------------------
// Progress text (the UI shows it, the bug reporter records it)
// ---------------------------------------------------------------------------

/** metric => [singular, plural] of the thing counted, for "4 of 6 buildings on the map". */
const UNITS = {
  railwayStations: ['railway station on the map', 'railway stations on the map'],
  minNorthSouthBuildings: ['building in the thinner of North and South', 'buildings in the thinner of North and South'],
  buildingsInJunctionCities: ['building in a junction city', 'buildings in junction cities'],
  maxSpecialistsOneType: ['specialist of your commonest type', 'specialists of your commonest type'],
  carriages: ['carriage', 'carriages'],
  upgradesInstalled: ['upgrade tile installed', 'upgrade tiles installed'],
  completeSpecialistSets: ['complete set of the four specialist types', 'complete sets of the four specialist types'],
  specialists: ['specialist in your train', 'specialists in your train'],
  telegraphsWithOpponentRailway: ['telegraph station in a rival railway station city', 'telegraph stations in rival railway station cities'],
  cargo: ['item in storage', 'items in storage'],
  telegraphStations: ['telegraph station on the map', 'telegraph stations on the map'],
  citiesWithOwnBuilding: ['inland city with your building', 'inland cities with your buildings'],
  buildings: ['building on the map', 'buildings on the map'],
  longestOwnRoute: ['slot in your longest route', 'slots in your longest route'],
  ownRoutes: ['route owned', 'routes owned'],
  distinctTerrainsLaid: ['terrain laid', 'terrains laid'],
  slotsLaid: ['slot laid', 'slots laid'],
  ownBuildings: ['building on the map', 'buildings on the map'],
  inlandCitiesOnOwnRoutes: ['inland city on your routes', 'inland cities on your routes'],
  citiesWithBothOwnBuildings: ['city with both your buildings', 'cities with both your buildings'],
  tokensCollected: ['Pony Express token collected', 'Pony Express tokens collected'],
};

function progressText(state, metric, value, target, filter) {
  const K = getConstants(state);
  if (metric === 'ownSlots') {
    const terrain = filter && filter.terrain ? `${K.NAMES[filter.terrain]} slots` : 'slots';
    return target === null ? `${value} ${terrain}` : `${value} of ${target} ${terrain}`;
  }
  if (metric === 'startCitiesJoined') {
    return value >= 1 ? 'Your two starting cities are joined' : 'Your two starting cities are not yet joined';
  }
  if (metric === 'cityHasOpponentBuilding' || metric === 'cityIsJunction') {
    return value >= 1 ? 'Yes' : 'No';
  }
  const unit = UNITS[metric];
  if (!unit) return target === null ? `${value}` : `${value} of ${target}`;
  if (target === null) return `${value} ${value === 1 ? unit[0] : unit[1]}`;
  return `${value} of ${target} ${target === 1 ? unit[0] : unit[1]}`;
}

/**
 * Progress of one player towards something, for the UI.
 *
 * `item` may be a milestone tile (it has a `condition`), a goal card (it has a
 * `metric` and a `direction`) or a bare condition `{ metric, op, value }`.
 * Returns `{ known, value, target, met, text }`:
 *   known  false when the metric is not one the interpreter understands
 *          (then `met` is false and `text` says so);
 *   value  the player's measure now;
 *   target the number to reach (a milestone), or null (a goal has none);
 *   met    whether the condition holds (a goal is never "met": it is ranked);
 *   text   for example "4 of 6 Tunnel slots" or "2 railway stations on the map".
 */
export function describeProgress(state, playerId, item) {
  if (item === null || typeof item !== 'object') {
    return { known: false, value: null, target: null, met: false, text: 'Not tracked' };
  }
  const condition = item.condition ?? item;
  const metric = condition.metric;
  const filter = condition.filter ?? null;
  const target = typeof condition.value === 'number' ? condition.value : null;
  const value = metricValue(state, playerId, metric, filter, null);
  if (value === null) {
    return { known: false, value: null, target, met: false, text: 'Not tracked' };
  }
  const met = item.direction !== undefined ? false : evaluateCondition(state, playerId, condition);
  return { known: true, value, target, met, text: progressText(state, metric, value, target, filter) };
}
