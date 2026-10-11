// board.js - static geometry: the action grid and the route map.
//
// Nothing here changes during a game and nothing here is stored in the game
// state. The state holds only who is where (`state.grid`, `state.map`); this
// file says what is next to what.
//
// The map comes from data/route-map.js, generated from data/route-map.json
// (a copy of route-map-v2-solved.json) by tools/build-route-map-module.mjs.
// To swap the map, replace the JSON and regenerate.

import { GRID, TERRAIN_BY_LETTER, TERRAINS } from './rules.js';
import { ROUTE_MAP } from './data/route-map.js';

// ---------------------------------------------------------------------------
// The action grid (R5.1, R5.2)
// ---------------------------------------------------------------------------

/** The nine district POSITION ids, D1 to D9, row by row. */
export const DISTRICT_IDS = GRID.positions.map((p) => p.id);

/** The twelve worker space ids, W1 to W12. */
export const SPACE_IDS = GRID.workerSpaces.map((w) => w.id);

/** R5.2. `SPACE_DISTRICTS.W4` is `['D2', 'D5']`: the two districts a worker space borders. */
export const SPACE_DISTRICTS = {};
for (const w of GRID.workerSpaces) SPACE_DISTRICTS[w.id] = [w.between[0], w.between[1]];

/** R5.2. `DISTRICT_SPACES.D5` is `['W4', 'W6', 'W7', 'W9']`: the worker spaces of a district. */
export const DISTRICT_SPACES = {};
for (const d of DISTRICT_IDS) DISTRICT_SPACES[d] = [];
for (const w of GRID.workerSpaces) for (const d of w.between) DISTRICT_SPACES[d].push(w.id);

/** R5.2. `DISTRICT_NEIGHBOURS.D1` is `['D2', 'D4']`: the orthogonal neighbour districts. */
export const DISTRICT_NEIGHBOURS = {};
for (const a of GRID.positions) {
  DISTRICT_NEIGHBOURS[a.id] = GRID.positions
    .filter((b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1)
    .map((b) => b.id);
}

/** Whether `id` names a district position (D1 to D9). */
export function isDistrictId(id) {
  return Object.prototype.hasOwnProperty.call(DISTRICT_SPACES, id);
}

/** Whether `id` names a worker space (W1 to W12). */
export function isSpaceId(id) {
  return Object.prototype.hasOwnProperty.call(SPACE_DISTRICTS, id);
}

// ---------------------------------------------------------------------------
// The route map (R11.1, Appendix A)
// ---------------------------------------------------------------------------

/**
 * Turns raw map data (the shape of route-map.json) into the tables the engine
 * reads. Exported so a test or a tool can build a second map; the engine
 * itself uses the one built below.
 */
export function buildMap(data) {
  const cities = data.cities.map((c) => ({
    id: c.id,
    name: c.name,
    /** 'west' and 'east' are start cities (R11.2); 'inland' is everything else (R1.18). */
    kind: c.role === 'w' ? 'west' : c.role === 'e' ? 'east' : 'inland',
    x: c.x,
    y: c.y,
  }));
  const cityById = {};
  for (const c of cities) cityById[c.id] = c;

  const routes = data.routes.map((r, index) => {
    const terrains = r.terrain.split('').map((letter) => {
      const t = TERRAIN_BY_LETTER[letter];
      if (!t) throw new Error(`Route ${r.a}-${r.b}: unknown terrain letter "${letter}"`);
      return t;
    });
    /** R11.4.3. Built tiles needed to claim the route, by terrain. */
    const cost = { ground: 0, tunnel: 0, bridge: 0 };
    for (const t of terrains) cost[t] += 1;
    return {
      id: `${r.a}-${r.b}`,
      index,
      /** The two end cities. `terrains` runs from `a` to `b`. */
      a: r.a,
      b: r.b,
      terrains,
      length: terrains.length,
      cost,
      /** For the UI only: where each slot is drawn. */
      slots: r.slots.map((s, i) => ({ x: s.x, y: s.y, angle: s.angle, terrain: terrains[i] })),
    };
  });
  const routeById = {};
  for (const r of routes) {
    if (routeById[r.id]) throw new Error(`Duplicate route id ${r.id}`);
    if (!cityById[r.a] || !cityById[r.b]) throw new Error(`Route ${r.id} names an unknown city`);
    routeById[r.id] = r;
  }

  /** Route ids touching each city, in map order. */
  const cityRoutes = {};
  for (const c of cities) cityRoutes[c.id] = [];
  for (const r of routes) {
    cityRoutes[r.a].push(r.id);
    cityRoutes[r.b].push(r.id);
  }

  return {
    title: data.title,
    board: { w: data.board.w, h: data.board.h },
    slotSize: { l: data.slot.l, w: data.slot.w },
    cityRadius: data.city_r,
    cities,
    cityById,
    routes,
    routeById,
    cityRoutes,
    cityIds: cities.map((c) => c.id),
    routeIds: routes.map((r) => r.id),
    westStartCities: cities.filter((c) => c.kind === 'west').map((c) => c.id),
    eastStartCities: cities.filter((c) => c.kind === 'east').map((c) => c.id),
    startCities: cities.filter((c) => c.kind !== 'inland').map((c) => c.id),
    inlandCities: cities.filter((c) => c.kind === 'inland').map((c) => c.id),
  };
}

/** The map in play. */
export const MAP = buildMap(ROUTE_MAP);

/** The city at the other end of a route from `cityId`. */
export function otherEnd(route, cityId) {
  return route.a === cityId ? route.b : route.a;
}

/** Whether a city is a start city (R1.18). */
export function isStartCity(cityId) {
  return MAP.cityById[cityId].kind !== 'inland';
}

/** 'west' or 'east' for a start city, null for an inland city. */
export function startSide(cityId) {
  const kind = MAP.cityById[cityId].kind;
  return kind === 'inland' ? null : kind;
}

/**
 * R16.6.1. The junction cities: inland cities with at least
 * `mapRules.junctionMinRoutes` printed routes.
 */
export function junctionCities(mapRules) {
  return MAP.inlandCities.filter((id) => MAP.cityRoutes[id].length >= mapRules.junctionMinRoutes);
}

/**
 * R16.6.2. 'north', 'south' or 'middle' for an inland city; null for a start
 * city. North is map y below `northRegionMaxY`, south is y above
 * `southRegionMinY`.
 */
export function cityRegion(cityId, mapRules) {
  const c = MAP.cityById[cityId];
  if (c.kind !== 'inland') return null;
  if (c.y < mapRules.northRegionMaxY) return 'north';
  if (c.y > mapRules.southRegionMinY) return 'south';
  return 'middle';
}

/** Slot counts of the whole map by terrain. For tests and reports. */
export function mapSlotTotals() {
  const totals = {};
  for (const t of TERRAINS) totals[t] = 0;
  for (const r of MAP.routes) for (const t of r.terrains) totals[t] += 1;
  return totals;
}
