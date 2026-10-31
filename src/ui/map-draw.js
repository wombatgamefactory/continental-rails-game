// map-draw.js - the route map's look, shared by both rulesets' map views.
//
// The map is an SVG, 1 unit = 1 mm of the printed 600 x 350 mm board. It is drawn the way the printed board is: the
// designer's watercolour as the backdrop, a black line joining the two cities of a route only where the printed map
// has one, slots as rounded rectangles in the printed green (Ground), grey (Tunnel), blue (Bridge) and tan (a wild
// slot, "any tile"), each with its icon in a cream disc, cities as cream discs (a red ring in the west, a navy ring
// in the east for the start cities) and the city names where the print puts them.
//
// Nothing here knows a rule. Callers pass the engine's MAP (the ruleset's own), the state they want drawn, and the
// classes and attributes that make a thing a click target; this module only returns markup. Pure functions, no DOM.

import { artUrl, svgTrackTile } from './art.js';
import { SLOT_ICON_PATHS } from './map-icons.js';
import { LABEL_PLACE, LABEL_FONT_SIZE } from './map-labels.js';

/** The manifest id of the map's watercolour. */
export const BACKDROP_ID = 'map-backdrop-v3';

/** HTML-escapes the engine's city names (the only free text in the markup here). */
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** The cream disc and dark rim behind a slot's icon (the print's badge), in mm. */
const BADGE = { r: 3.24, rim: 0.38 };

/** The opening tag of the map's SVG and its fixed layers: the paper, the watercolour, nothing else. */
export function mapOpen(MAP) {
  const W = MAP.board.w;
  const H = MAP.board.h;
  const url = artUrl(BACKDROP_ID);
  const image = url ? `<image class="map__backdrop" href="${url}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" data-art-id="${BACKDROP_ID}"/>` : '';
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Route map" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><rect class="map__bg" x="0" y="0" width="${W}" height="${H}"/>${image}`;
}

/** The thin frame drawn over the edge of the map, after everything else that touches the edge. */
export function mapFrame(MAP) {
  return `<rect class="map__frame" x="0" y="0" width="${MAP.board.w}" height="${MAP.board.h}" rx="0" pointer-events="none"/>`;
}

/**
 * The black line between a route's two cities, an arc (the route's `bow` is the arc's half-angle in radians, signed
 * by the side it bulges to), or '' when the printed map draws none for that route. Drawn beneath the slots.
 */
export function routeLine(MAP, route) {
  if (!route.line) return '';
  const a = MAP.cityById[route.a];
  const b = MAP.cityById[route.b];
  const bow = route.bow || 0;
  if (Math.abs(bow) < 1e-4) return `<path class="map__line" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const radius = chord / (2 * Math.sin(Math.abs(bow)));
  // A positive bow bulges to the left-hand normal of a -> b in the board's y-down space, which is a counter-clockwise sweep.
  return `<path class="map__line" d="M${a.x} ${a.y}A${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${bow > 0 ? 0 : 1} ${b.x} ${b.y}"/>`;
}

/** A slot's icon: the cream badge with a black glyph, or the white question mark of a wild slot. Upright whatever the slot's angle. */
function slotIcon(kind, angle) {
  const d = SLOT_ICON_PATHS[kind];
  const upright = `transform="rotate(${-angle})"`;
  if (kind === 'wild') return `<path class="slot__icon slot__icon--wild" d="${d}" ${upright}/>`;
  return `<g ${upright}><circle class="slot__badge" r="${BADGE.r}" stroke-width="${BADGE.rim}"/><path class="slot__icon" d="${d}"/></g>`;
}

/**
 * An empty slot: a socket in the printed colour of its kind (`slot.terrain` is ground, tunnel, bridge or wild) with its
 * icon. `favoured` outlines a slot of the scoring card's terrain; `asking` lights the wild slot whose tile is being chosen.
 */
export function slotOpen(MAP, slot, favoured = false, asking = false) {
  const { l, w, outline } = MAP.slotSize;
  const o = outline || 0.68;
  return `<g class="slot slot--open slot--${slot.terrain}${favoured ? ' slot--favoured' : ''}${asking ? ' slot--asking' : ''}" transform="translate(${slot.x} ${slot.y}) rotate(${slot.angle})"><rect class="slot__socket" x="${-(l + o) / 2}" y="${-(w + o) / 2}" width="${l + o}" height="${w + o}" rx="1.15"/>${slotIcon(slot.terrain, slot.angle)}</g>`;
}

/**
 * A laid slot: a bed (the player's colour, or the plain bed of a rule set where laid track belongs to nobody) with the
 * track tile on it. `tile` is the terrain of the tile that lies there: for a wild slot the one chosen for it, which is
 * marked with a tan rim so the slot still reads as the printed "any tile" slot.
 */
export function slotLaid(MAP, slot, tile, colour = null) {
  const { l, w, outline } = MAP.slotSize;
  const o = outline || 0.68;
  const wild = slot.terrain === 'wild';
  const style = colour ? ` style="fill:${colour}"` : '';
  return `<g class="slot slot--laid${wild ? ' slot--wildfill' : ''}" data-tile="${tile}" transform="translate(${slot.x} ${slot.y}) rotate(${slot.angle})"><rect class="slot__bed${colour ? '' : ' slot__bed--nobody'}${wild ? ' slot__bed--wild' : ''}" x="${-(l + o) / 2}" y="${-(w + o) / 2}" width="${l + o}" height="${w + o}" rx="1.15"${style}/>${svgTrackTile(tile, 1.25)}</g>`;
}

/**
 * The terrain a laid slot holds: its printed one, or for a wild slot the tile chosen for it. `wildFill` is the state's
 * `map.wildFill` ({ [routeId]: [{ slot, terrain }] }); a wild slot with no record (an older saved game) shows as Ground.
 */
export function laidTerrain(wildFill, route, index) {
  const printed = route.terrains ? route.terrains[index] : route.slots[index].terrain;
  if (printed !== 'wild') return printed;
  const fills = wildFill && wildFill[route.id];
  const hit = fills ? fills.find((f) => f.slot === index) : null;
  return hit ? hit.terrain : 'ground';
}

/** City discs: the geometry of the printed map. `kind` is 'inland', 'west' or 'east'. */
export function cityShapes(MAP, city) {
  const style = MAP.cityStyle || { inland: { r: 8.86, fill_r: 7.17 }, start: { r: 9.29, fill_r: 6.67 } };
  const s = city.kind === 'inland' ? style.inland : style.start;
  const mid = (s.r + s.fill_r) / 2;
  const width = s.r - s.fill_r;
  if (city.kind === 'inland') {
    return `<circle class="city__disc" cx="${city.x}" cy="${city.y}" r="${mid.toFixed(3)}" stroke-width="${width.toFixed(3)}"/>`;
  }
  return `<circle class="city__disc city__disc--start" cx="${city.x}" cy="${city.y}" r="${s.fill_r}"/><circle class="city__ring city__ring--${city.kind}" cx="${city.x}" cy="${city.y}" r="${mid.toFixed(3)}" stroke-width="${width.toFixed(3)}"/>`;
}

/** The outer radius of a city (its click target and halo are built on it). */
export function cityOuterR(MAP, city) {
  const style = MAP.cityStyle;
  if (!style) return MAP.cityRadius;
  return city.kind === 'inland' ? style.inland.r : style.start.r;
}

/**
 * Every city name, in a layer of its own above the routes and cities (the print letters over its slots, with a pale halo
 * so a name stays legible on a slot or a line). A city with no entry in the placement table gets its name under its disc.
 */
export function cityLabels(MAP) {
  const out = ['<g class="map__labels" pointer-events="none" aria-hidden="true">'];
  for (const c of MAP.cities) {
    const spec = MAP.labels.find((l) => l.city === c.id);
    const colour = spec ? spec.colour : c.kind === 'west' ? 'red' : c.kind === 'east' ? 'blue' : 'dark';
    const place = LABEL_PLACE[c.id];
    if (place) {
      out.push(`<text class="map__label map__label--${colour}" data-label="${c.id}" x="${place[0]}" y="${place[1]}" textLength="${place[2]}" lengthAdjust="spacingAndGlyphs" font-size="${LABEL_FONT_SIZE}">${esc(c.name)}</text>`);
    } else {
      out.push(`<text class="map__label map__label--${colour}" data-label="${c.id}" x="${c.x}" y="${c.y + 17}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}">${esc(c.name)}</text>`);
    }
  }
  out.push('</g>');
  return out.join('');
}

// ---------------------------------------------------------------------------
// Where the pieces that stand beside a city go
// ---------------------------------------------------------------------------

/** Rough extent of a printed city name for keeping pieces off it: [x0, y0, x1, y1] in mm, or null. */
function labelBox(cityId) {
  const p = LABEL_PLACE[cityId];
  return p ? [p[0] - 0.5, p[1] - 5.4, p[0] + p[2] + 0.5, p[1] + 1.9] : null;
}

/** Distance from the point (x, y) to the rectangle [x0, y0, x1, y1] (0 inside). */
function boxDistance(x, y, b) {
  const dx = Math.max(b[0] - x, 0, x - b[2]);
  const dy = Math.max(b[1] - y, 0, y - b[3]);
  return Math.hypot(dx, dy);
}

/**
 * A place allocator for the pieces drawn beside cities (trains, stations, Pony Express tokens). Each call to `take`
 * gives the best free spot around the city for a piece of that radius: clear of the printed names, of the slots and
 * lines around it, of other cities, of the board's edge and of the pieces already placed there. Call it in draw order
 * and the same position always comes out for the same state.
 */
export function pieceSpots(MAP) {
  const used = new Map();
  const labels = MAP.cities.map((c) => ({ id: c.id, box: labelBox(c.id) })).filter((l) => l.box);
  const slots = [];
  for (const r of MAP.routes) for (const s of r.slots) slots.push(s);
  const { l: sl, w: sw } = MAP.slotSize;
  return {
    take(cityId, size) {
      const c = MAP.cityById[cityId];
      const outer = cityOuterR(MAP, c);
      const placed = used.get(cityId) ?? [];
      let best = null;
      for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * 2 * Math.PI;
        for (const reach of [outer + size - 3, outer + size + 1]) {
          const x = c.x + Math.cos(angle) * reach;
          const y = c.y + Math.sin(angle) * reach;
          let penalty = 0;
          if (x < size || x > MAP.board.w - size || y < size || y > MAP.board.h - size) penalty += 200;
          for (const l of labels) {
            const d = boxDistance(x, y, l.box);
            if (d < size) penalty += (size - d) * 12;
          }
          for (const s of slots) {
            if (Math.abs(s.x - x) > 20 || Math.abs(s.y - y) > 20) continue;
            // the slot's own frame: u along it, v across it
            const a = (s.angle * Math.PI) / 180;
            const dx = x - s.x;
            const dy = y - s.y;
            const u = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - sl / 2;
            const v = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - sw / 2;
            const d = Math.hypot(Math.max(u, 0), Math.max(v, 0));
            if (d < size) penalty += (size - d) * 4;
          }
          for (const o of MAP.cities) {
            if (o.id === cityId) continue;
            const d = Math.hypot(o.x - x, o.y - y) - cityOuterR(MAP, o);
            if (d < size) penalty += (size - d) * 8;
          }
          for (const p of placed) {
            const d = Math.hypot(p.x - x, p.y - y) - p.size - size;
            if (d < 0.5) penalty += 400 - d * 20;
          }
          // a mild liking for below the city, then to the right
          penalty += Math.abs(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))) * 0.6 + (reach > outer + size - 2 ? 0.8 : 0);
          if (best === null || penalty < best.penalty) best = { x, y, penalty };
        }
      }
      placed.push({ x: best.x, y: best.y, size });
      used.set(cityId, placed);
      return { x: Math.round(best.x * 100) / 100, y: Math.round(best.y * 100) / 100 };
    },
  };
}
