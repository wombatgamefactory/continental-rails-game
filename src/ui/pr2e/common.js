// common.js - small helpers shared by the second edition's screens (views.js, hooks.js).
//
// This file is imported by the ruleset registry (through views.js), so it must
// not import src/ui/active-ruleset.js (nor any module that does), and it must
// not touch the DOM when it loads. Everything it needs from the engine it is
// handed (`engine`, `state`).

/** HTML-escapes text for markup and attribute values. */
export function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Anna", "Anna and Ben", "Anna, Ben and Cara". */
export function nameList(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Manifest ids of the shared pictures (the same ones the Continental Rails screens use). */
export const ITEM_ART = {
  iron: 'resource-iron',
  wood: 'resource-wood',
  gunpowder: 'resource-gunpowder',
  coins: 'resource-coin',
  hats: 'token-cowboy-hat',
  ground: 'terrain-ground',
  tunnel: 'terrain-tunnel',
  bridge: 'terrain-bridge',
  crew: 'specialist-crew',
  miner: 'specialist-miner',
  engineer: 'specialist-engineer',
  financier: 'specialist-financier',
};

/** The district tile of each tile id (assets/pr2e, manifest ids `pr2e-district-...`). */
export const DISTRICT_ART = {
  'collect-gunpowder': 'pr2e-district-collect-gunpowder',
  'collect-iron': 'pr2e-district-collect-iron',
  'collect-wood': 'pr2e-district-collect-wood',
  'collect-coins': 'pr2e-district-collect-coins',
  crew: 'pr2e-district-crew',
  miner: 'pr2e-district-miner',
  engineer: 'pr2e-district-engineer',
  financier: 'pr2e-district-financier',
  'lay-or-hire': 'pr2e-district-lay-track-or-hire',
};

/** The goal tile picture of each goal measure (machine id of the art inventory). */
export const GOAL_ART = {
  coinsStored: 'pr2e-goal-tile-01-coin',
  ironStored: 'pr2e-goal-tile-02-iron',
  woodStored: 'pr2e-goal-tile-03-wood',
  districtHouses: 'pr2e-goal-tile-04-district-houses',
  railwayStations: 'pr2e-goal-tile-05-railway-stations',
  telegraphStations: 'pr2e-goal-tile-06-telegraph-stations',
  gunpowderStored: 'pr2e-goal-tile-07-gunpowder',
  crew: 'pr2e-goal-tile-08-crew',
  miners: 'pr2e-goal-tile-09-miner',
  financiers: 'pr2e-goal-tile-10-financier',
  upgradesInstalled: 'pr2e-goal-tile-11-upgrades',
  engineers: 'pr2e-goal-tile-12-engineer',
};

/** The picture of an upgrade token id ("U2-iron" is `pr2e-upgrade-token-u2-iron`; the Coin tokens are `-coin`). */
export function upgradeTokenArt(token) {
  const m = /^U([123])-(.+)$/.exec(String(token));
  if (!m) return null;
  const kind = m[2] === 'coins' ? 'coin' : m[2];
  return `pr2e-upgrade-token-u${m[1]}-${kind}`;
}

/**
 * The Congress rewards by column (the rules, P10.1), each with the picture to
 * show and what it says. The printed panel art is from an older board, so the
 * cells are used one by one: K4 (hats) is the composite, K6 is drawn over the
 * cell that says III with a 4, K8 uses the II cell, which is right for 2 tiles.
 */
export const CONGRESS_CELLS = {
  K1: { art: 'pr2e-congress-reward-col1-wood', text: '2 Wood', short: '2 Wood' },
  K2: { art: 'pr2e-congress-reward-col2-gunpowder', text: '2 Gunpowder', short: '2 Gunpowder' },
  K3: { art: 'pr2e-congress-reward-col3-iron', text: '2 Iron', short: '2 Iron' },
  K4: { art: 'pr2e-congress-reward-hats-composite', text: '2 cowboy hats', short: '2 hats' },
  K5: { art: 'pr2e-congress-reward-col4-house-or-upgrade', text: 'A district house or an upgrade token, and 1 VP', short: 'District house or token, 1 VP' },
  K6: { art: 'pr2e-congress-reward-col6-three-resources', text: '4 resources of your choice (not Coins)', short: '4 of choice', number: '4' },
  K7: { art: 'pr2e-congress-reward-col5-telegraph-house-map', text: 'A railway station and / or a telegraph station on the map', short: 'Station(s) on the map' },
  K8: { art: 'pr2e-congress-reward-col8-two-tiles', text: '2 built tiles of your choice', short: '2 built tiles' },
};

/** "2G 1T" for a route's tiles. */
const TERRAIN_LETTER = { ground: 'G', tunnel: 'T', bridge: 'B' };
export function costLetters(cost) {
  return ['ground', 'tunnel', 'bridge']
    .filter((t) => cost[t] > 0)
    .map((t) => `${cost[t]}${TERRAIN_LETTER[t]}`)
    .join(' ');
}

/** "2 Ground, 1 Tunnel" for a tile count, with the engine's names. */
export function tilesText(NAMES, tiles) {
  const parts = ['ground', 'tunnel', 'bridge'].filter((t) => tiles[t] > 0).map((t) => `${tiles[t]} ${NAMES[t]}`);
  return parts.length ? parts.join(', ') : 'no tiles';
}

/** The kind of a city for a sentence. */
export function cityKindText(city) {
  if (city.kind === 'inland') return 'Inland city';
  return `${city.kind === 'west' ? 'West' : 'East'} start city`;
}

/** ' is-flash' when the last action touched this id and the highlight is still running. */
export function flashCls(ctx, list, id) {
  return ctx.flashAge >= 0 && list && list.includes(id) ? ' is-flash' : '';
}

export function flashDelay(ctx) {
  return ctx.flashAge >= 0 ? `animation-delay:-${ctx.flashAge}ms;` : '';
}

/**
 * The identity attributes of one target (click key, tooltip key, and while the
 * player is deciding its state), like the Continental Rails screens: `kind` is
 * the kind of target ("route"), `key` the full key ("route:SEA-SPO").
 */
export function tgt(ctx, kind, key) {
  let attrs = ` data-target="${esc(key)}" data-tip="${esc(key)}"`;
  let state = null;
  if (ctx.interactive && !ctx.view.generic) {
    state = ctx.targets.stateOf(kind, key);
    attrs += ` data-state="${state}"`;
    if (state === 'legal') attrs += ' data-legal="1"';
  }
  return { attrs, state, legal: state === 'legal', cls: state ? ` is-${state}` : '' };
}

/** Production of a house track, from the engine. */
export function productionOf(engine, state, playerId, track) {
  return engine.production(state, playerId, track);
}

/** The per-player chips of the variants that differ from the defaults (header, end screen). */
export function variantChips(engine, variants, cls = '') {
  const diffs = engine.nonDefaultVariants(variants);
  const names = Object.keys(diffs);
  if (names.length === 0) return `<span class="chip chip--default ${cls}" data-field="variant-chips">Default rules</span>`;
  return `<span class="chips ${cls}" data-field="variant-chips">${names
    .map((name) => {
      const def = engine.getVariantDef(name);
      const label = def && def.label ? def.label : name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
      const raw = diffs[name];
      const value = typeof raw === 'boolean' ? (raw ? 'On' : 'Off') : String(raw).replace(/-/g, ' ');
      return `<span class="chip chip--changed" data-chip="${esc(name)}" title="${esc(def ? `${def.description}.` : name)}">${esc(label)}: <b>${esc(value)}</b></span>`;
    })
    .join('')}</span>`;
}

const SPECIAL_TEXT = {
  telegraphStation: "a telegraph station in a city that holds another player's railway station",
  districtHouse: 'a district house on a building site',
  upgrade: 'an upgrade token, new or replacing one of the same level',
  railwayStation: "a railway station in a city that holds another player's telegraph station",
};

/** What a Collect district's special action does, with its price and VP, in one sentence (the engine's own price table). */
export function specialSentence(engine, state, special) {
  const K = engine.getConstants(state);
  const cost = engine.formatCost(state, K.GRID.specialActions[special].cost);
  const vp = K.SCORING.specialActionVp[special];
  return `Special action: pay ${cost} for ${SPECIAL_TEXT[special]}${vp ? ` (${vp} VP)` : ''}.`;
}

export function hasSpecialText(special) {
  return SPECIAL_TEXT[special] !== undefined;
}
