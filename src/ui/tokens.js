// tokens.js - playing pieces drawn in code (SVG), used while a piece's real art
// is still a placeholder in the manifest.
//
// Every function returns the INNER markup of an SVG (shapes only), so the same
// drawing serves an <svg> in the page and a <g> on the map. Colours come from
// CSS: a piece is filled with the custom property --pc (the player's colour),
// which the wrapper sets; the look (outline, shading) is in style.css under
// ".tok". Nothing here knows a rule and nothing here is an image path.

/** Pieces are drawn on a 24 x 24 grid. */
export const TOKEN_BOX = 24;

/** Track tiles are drawn on the map's own slot grid: 25 x 8 (mm). */
export const TILE_W = 25;
export const TILE_H = 8;

const PIECES = {
  // A railway worker: broad-brimmed hat, head, shoulders.
  worker:
    '<path class="tok__body" d="M12 10.2c-4.6 0-7.4 3-7.4 7.6v3.4h14.8v-3.4c0-4.6-2.8-7.6-7.4-7.6z"/>' +
    '<circle class="tok__body tok__body--light" cx="12" cy="8" r="3.5"/>' +
    '<path class="tok__ink" d="M8.7 6.6V4.4c0-1 .8-1.8 1.8-1.8h3c1 0 1.8.8 1.8 1.8v2.2z"/>' +
    '<path class="tok__brim" d="M5.6 6.8h12.8"/>' +
    '<path class="tok__shine" d="M7.2 17.6c0-2.4 1-4.2 2.6-5"/>',
  // A house (production piece on the player board): pitched roof, door.
  house:
    '<path class="tok__body" d="M4.4 11.2 12 4.4l7.6 6.8v9.6H4.4z"/>' +
    '<path class="tok__roof" d="M2.6 12 12 3.4l9.4 8.6"/>' +
    '<rect class="tok__dark" x="10.2" y="14.6" width="3.6" height="6.2" rx=".5"/>' +
    '<rect class="tok__pale" x="6.4" y="13.4" width="2.4" height="2.4" rx=".3"/>' +
    '<rect class="tok__pale" x="15.2" y="13.4" width="2.4" height="2.4" rx=".3"/>',
  // A railhead: a small locomotive, side on.
  railhead:
    '<path class="tok__ink" d="M4.6 10.6V6.4h3.2v4.2z"/>' +
    '<rect class="tok__body" x="2.6" y="10" width="12.4" height="6.6" rx="2"/>' +
    '<rect class="tok__body tok__body--light" x="13.4" y="5.4" width="8" height="11.2" rx="1.2"/>' +
    '<rect class="tok__pale" x="15.4" y="7.4" width="4" height="3.4" rx=".5"/>' +
    '<path class="tok__ink" d="M2.8 16.4.8 19.6h4z"/>' +
    '<circle class="tok__wheel" cx="7.6" cy="18.6" r="2.7"/>' +
    '<circle class="tok__wheel" cx="17" cy="18" r="3.3"/>',
  // A score marker: a brass-rimmed disc.
  'score-marker': '<circle class="tok__body" cx="12" cy="12" r="8.6"/><circle class="tok__shineRing" cx="12" cy="12" r="5.6"/>',
};

/** Inner SVG of a player piece, or null when this module has no drawing for it. */
export function pieceShape(kind) {
  return PIECES[kind] ?? null;
}

/** Inner SVG of a Pony Express token (not a player's colour): a horseshoe on a leather disc. Drawn about the origin, radius 5. */
export function ponyTokenShape() {
  return (
    '<circle class="ptoken__disc" r="4.8"/>' +
    '<path class="ptoken__shoe" d="M-2.1 2.5C-3.4.4-2.6-2.9 0-2.9S3.4.4 2.1 2.5"/>' +
    '<path class="ptoken__nails" d="M-2.5-.2h.01M2.5-.2h.01M-1.5-2h.01M1.5-2h.01"/>'
  );
}

/**
 * Inner SVG of one track tile on the 25 x 8 slot grid, centred on the origin.
 * The same drawing is the built tile in a train's storage and the laid tile on
 * a route, so "build" and "lay" are visibly the same object in two places.
 * @param {'ground'|'tunnel'|'bridge'} terrain
 * @param {number} [inset] how far the tile sits inside the slot (a laid tile sits on the owner's coloured bed)
 */
export function tileShape(terrain, inset = 0) {
  const w = TILE_W - inset * 2.75;
  const h = TILE_H - inset * 2;
  const x = -w / 2;
  const y = -h / 2;
  const rail = h * 0.2;
  return (
    `<rect class="tile__bed tile__bed--${terrain}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.3"/>` +
    `<line class="tile__ties" x1="${x + 1.6}" y1="0" x2="${-x - 1.6}" y2="0" style="stroke-width:${(h * 0.62).toFixed(2)}"/>` +
    `<line class="tile__rail" x1="${x + 0.9}" y1="${-rail}" x2="${-x - 0.9}" y2="${-rail}"/>` +
    `<line class="tile__rail" x1="${x + 0.9}" y1="${rail}" x2="${-x - 0.9}" y2="${rail}"/>`
  );
}
