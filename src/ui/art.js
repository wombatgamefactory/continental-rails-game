// art.js - the ONE place that knows where an image lives.
//
// Everything else asks for a picture by manifest id ("district-gather-wood",
// "specialist-miner"); this module loads assets/art-manifest.json, resolves
// the id to a URL and returns markup. Nothing outside this file contains an
// image path.
//
// Guarded fallback: an id that is not in the manifest, or a file that fails to
// load, becomes a small text chip instead of a broken-image icon.
//
// Greyscale pieces (workers, stations, railheads ...) are one image tinted per
// player colour with a CSS filter chain (see tintFilter). A piece whose art is
// still a placeholder is drawn in code instead (tokens.js: a worker, a house, a
// railhead, a track tile, a Pony Express token), so a hatched "PLACEHOLDER"
// picture never appears on screen; the day the manifest says the art is real,
// the picture takes over with no other change.

import { pieceShape, ponyTokenShape, tileShape, TOKEN_BOX, TILE_W, TILE_H } from './tokens.js';

const ASSET_ROOT = 'assets/';
const MANIFEST_URL = `${ASSET_ROOT}art-manifest.json`;

/** id -> manifest entry. Filled by loadArt(). */
const entries = new Map();

/** Fetches the manifest. Resolves even when it fails (every id then falls back to a chip). */
export async function loadArt() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    entries.clear();
    for (const entry of list) entries.set(entry.id, entry);
    return { ok: true, count: entries.size };
  } catch (err) {
    return { ok: false, count: 0, error: String(err) };
  }
}

/** Whether the manifest knows this id. */
export function hasArt(id) {
  return entries.has(id);
}

/** True when the manifest entry exists and its status is "real" (not a placeholder). */
export function isRealArt(id) {
  const e = entries.get(id);
  return e !== undefined && e.status === 'real';
}

/**
 * The manifest id of a numbered card picture: `card-<kind>-<NN>-<slug>`, where
 * kind is goal, agenda or pony. The slug is the card's title, so the number is
 * what the engine knows; the id is found by its prefix. Null when there is none.
 */
export function cardArtId(kind, number) {
  const prefix = `card-${kind}-${String(number).padStart(2, '0')}-`;
  for (const id of entries.keys()) if (id.startsWith(prefix)) return id;
  return null;
}

/** The manifest id of an upgrade tile picture: tile "U1-vp" is `upgrade-u1-vp`. */
export function upgradeArtId(tileId) {
  return `upgrade-${String(tileId).toLowerCase()}`;
}

/** The URL of an id, or null. */
export function artUrl(id) {
  const e = entries.get(id);
  return e ? ASSET_ROOT + e.file : null;
}

/** The manifest entry's size, or null. */
export function artSize(id) {
  const e = entries.get(id);
  return e ? { w: e.width, h: e.height } : null;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** A text stand-in for a picture. */
export function chip(label, cls = '') {
  return `<span class="art-chip ${cls}">${escapeHtml(label)}</span>`;
}

/**
 * An <img> for a manifest id, or a chip when the id is unknown.
 * @param {string} id manifest id
 * @param {{ cls?: string, alt?: string, tint?: string, label?: string, title?: string }} [opts]
 *   tint: a player colour (hex) to tint a greyscale piece with.
 */
export function art(id, opts = {}) {
  const url = artUrl(id);
  const alt = opts.alt ?? opts.label ?? id;
  if (url === null) return chip(opts.label ?? alt, opts.cls ?? '');
  const style = opts.tint ? ` style="filter:${tintFilter(opts.tint)}"` : '';
  const title = opts.title ? ` title="${escapeHtml(opts.title)}"` : '';
  return `<img class="art ${opts.cls ?? ''}" src="${url}" alt="${escapeHtml(alt)}" data-art-id="${id}" data-art-label="${escapeHtml(opts.label ?? alt)}" decoding="async" draggable="false"${style}${title}>`;
}

/**
 * A picture ONLY when its art is real: '' while the manifest says placeholder
 * (or does not know the id). For places that must never show a hatched
 * placeholder, such as the landing page; the caller supplies what to show instead.
 * @param {{ lazy?: boolean }} [opts] as for art(); lazy: load when scrolled near
 */
export function realArt(id, opts = {}) {
  if (!isRealArt(id)) return '';
  const html = art(id, opts);
  return opts.lazy ? html.replace('<img ', '<img loading="lazy" ') : html;
}

/** The same picture as an SVG <image> element (for the map). */
export function svgArt(id, x, y, w, h, opts = {}) {
  const url = artUrl(id);
  if (url === null) return '';
  const style = opts.tint ? ` style="filter:${tintFilter(opts.tint)}"` : '';
  return `<image href="${url}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" data-art-id="${id}"${style}/>`;
}

/**
 * A CSS filter chain that turns a greyscale image into the given colour. Hue
 * rotating coloured art does not work (low-saturation art goes muddy); a
 * greyscale source through sepia then hue-rotate does.
 */
export function tintFilter(colour) {
  const { h, s, l } = hexToHsl(colour);
  const hue = Math.round(h - 40); // sepia's own hue is about 40 degrees
  const sat = (2.2 + s * 4).toFixed(2);
  const bright = (0.55 + l * 0.9).toFixed(2);
  return `grayscale(1) sepia(1) saturate(${sat}) hue-rotate(${hue}deg) brightness(${bright}) contrast(1.05)`;
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const n = m ? parseInt(m[1], 16) : 0x888888;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

/**
 * A player-coloured piece. `kind` is worker, house, railhead, railway-station,
 * telegraph-station or score-marker. Real art is used when the manifest has it
 * (and tinted); otherwise a CSS shape in the player's colour.
 */
export function piece(kind, colour, opts = {}) {
  const id = `piece-${kind}`;
  const size = opts.size ? ` style="--piece-size:${opts.size}px"` : '';
  const title = opts.title ? ` title="${escapeHtml(opts.title)}"` : '';
  if (isRealArt(id)) {
    return `<span class="piece piece--art piece--${kind} ${opts.cls ?? ''}"${size}${title}>${art(id, { tint: colour, alt: kind, cls: 'piece__img' })}</span>`;
  }
  const shape = pieceShape(kind);
  const box = `style="--pc:${colour};${opts.size ? `--piece-size:${opts.size}px` : ''}"`;
  if (shape) {
    return `<span class="piece piece--token piece--${kind} ${opts.cls ?? ''}" ${box}${title}><svg class="tok" viewBox="0 0 ${TOKEN_BOX} ${TOKEN_BOX}" aria-hidden="true" focusable="false">${shape}</svg></span>`;
  }
  return `<span class="piece piece--shape piece--${kind} ${opts.cls ?? ''}" ${box}${title}></span>`;
}

/**
 * The same piece as an SVG group on the map, centred on (x, y) and `size` map
 * units across. Real art (tinted) once the manifest has it.
 */
export function svgPiece(kind, colour, x, y, size) {
  const id = `piece-${kind}`;
  if (isRealArt(id)) return svgArt(id, x - size / 2, y - size / 2, size, size, { tint: colour });
  const shape = pieceShape(kind);
  if (!shape) return '';
  const k = size / TOKEN_BOX;
  return `<g class="tok" style="--pc:${colour}" transform="translate(${x - size / 2} ${y - size / 2}) scale(${k.toFixed(4)})">${shape}</g>`;
}

/** A Pony Express token on the map, centred on the origin of its group: the real picture once it exists. */
export function svgPonyToken() {
  if (isRealArt('token-pony-express')) return svgArt('token-pony-express', -5, -5, 10, 10);
  return ponyTokenShape();
}

/** A Pony Express token in the page (panels, player cards). */
export function ponyToken(opts = {}) {
  const title = opts.title ? ` title="${escapeHtml(opts.title)}"` : '';
  if (isRealArt('token-pony-express')) return art('token-pony-express', { cls: `icon ${opts.cls ?? ''}`, label: 'Pony Express token', title: opts.title });
  return `<svg class="ptok-icon ${opts.cls ?? ''}" viewBox="-5.5 -5.5 11 11" role="img" aria-label="Pony Express token"${title}>${ponyTokenShape()}</svg>`;
}

const TERRAIN_LETTER = { ground: 'G', tunnel: 'T', bridge: 'B' };

/**
 * One track tile as an SVG group centred on the origin of the map's slot grid
 * (25 x 8). `inset` leaves room for the owner's coloured bed under a laid tile.
 * Real art (track-ground, track-tunnel, track-bridge) takes over when it exists.
 */
export function svgTrackTile(terrain, inset = 0) {
  const id = `track-${terrain}`;
  if (isRealArt(id)) return svgArt(id, -TILE_W / 2 + inset * 1.4, -TILE_H / 2 + inset, TILE_W - inset * 2.8, TILE_H - inset * 2);
  return tileShape(terrain, inset);
}

/** A built track tile in the page (a train's storage, a player card): the same drawing as a laid tile on the map. */
export function trackTile(terrain, opts = {}) {
  const id = `track-${terrain}`;
  const label = opts.label ?? `${terrain} track tile`;
  if (isRealArt(id)) return art(id, { cls: `tile ${opts.cls ?? ''}`, label });
  return `<svg class="tile tile--${terrain} ${opts.cls ?? ''}" viewBox="${-TILE_W / 2} ${-TILE_H / 2} ${TILE_W} ${TILE_H}" role="img" aria-label="${escapeHtml(label)}">${tileShape(terrain)}<text class="tile__t" x="0" y="2.3" text-anchor="middle">${TERRAIN_LETTER[terrain] ?? ''}</text></svg>`;
}

/**
 * Swaps any picture that fails to load for a text chip. Call once. The error
 * event does not bubble, so it is listened for in the capture phase.
 */
export function installArtFallback(root = document) {
  root.addEventListener(
    'error',
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLImageElement) || !el.dataset.artId) return;
      const span = document.createElement('span');
      span.className = `art-chip ${el.className}`;
      span.textContent = el.dataset.artLabel || el.dataset.artId;
      el.replaceWith(span);
    },
    true,
  );
}

/** The art ids to fetch before first paint (used on every screen). */
export function preloadIds() {
  return ['resource-iron', 'resource-wood', 'resource-gunpowder', 'resource-coin', 'token-cowboy-hat'];
}

export const ART_ROOT = ASSET_ROOT;
