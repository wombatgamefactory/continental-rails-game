// cr-player-board.js - the Continental Rails player board, drawn on the designer's printed art.
//
// The board (board-player-engine) and each carriage (board-player-carriage) are pictures with printed spaces:
// the house tracks, the telegraph row, two cowboy hat spaces, six storage spaces on the wagon roof; on a carriage,
// three storage spaces on the roof, two windows for specialists and a plate for the upgrade tile. This module lays
// the live pieces over those spaces with percentages measured on the art, so everything scales with the picture.
// The second edition does the same in src/ui/pr2e/views.js; the class names here start `cb` so the two never meet.
//
// Nothing here decides what is legal: a thing is drawn clickable only because `tgt` (handed in by board-render.js,
// which owns the target attributes) found a legal action for it.
//
// Storage and the engine. The art is the one-kind-of-carriage board of spec v5 (6 spaces on the board, 3 on every
// carriage), but the engine still plays spec v4: a specialist carriage stores nothing and a storage carriage holds 9
// (capacity 9, 18 or 27). So the stored items fill the printed spaces in order (board roof, then carriage 1's roof,
// carriage 2's, carriage 3's) and only as many spaces as the capacity allows are open: the others carry a lid. Capacity
// beyond the printed spaces (a storage carriage) is drawn as a row of extra spaces in the heading. When the engine
// moves to the v5 rule the lids and the extra row never appear and nothing else here changes.

import { art, piece, ponyToken, trackTile, upgradeArtId } from './art.js';
import { ITEM_ART } from './action-targets.js';
import { MAP, NAMES, PLAYER_BOARD, describeStep, getConstants, production, storageCapacity, storageUsed, totalVp, upgradeTileAt, upgradeTileData } from './active-ruleset.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// Where the printed spaces are
// ---------------------------------------------------------------------------

/** The board picture: the designer's original is 3501 x 1485; these numbers are pixels of that original. */
const ENG = { w: 3501, h: 1485 };
const ex = (x) => Math.round((x / ENG.w) * 10000) / 100;
const ey = (y) => Math.round((y / ENG.h) * 10000) / 100;
/** The x2 / x3 / x4 spaces of each house track, and where its production number sits (on the brass bar). */
const HOUSE_SPOTS = {
  wood: { xs: [2235.5, 2422.5, 2608.5], y: 715.5, badge: [2650, 592] },
  iron: { xs: [2854.5, 3041.5, 3227.5], y: 715.5, badge: [3262, 592] },
  gunpowder: { xs: [2235.5, 2422.5, 2608.5], y: 952.5, badge: [2650, 1075] },
  coins: { xs: [2854.5, 3041.5, 3227.5], y: 952.5, badge: [3262, 1075] },
};
/** The seven telegraph spaces by VP, on the pole at the left. */
const TELEGRAPH = { x: 159, y: { 9: 100, 6: 287, 5: 475, 4: 662, 3: 849, 2: 1037, 1: 1224 } };
const HAT_SPOTS = [[1686, 396], [1876, 396]];
const BOARD_ROOF = { xs: [2232.5, 2438.5, 2643.5, 2849.5, 3054.5, 3260.5], y: 394.5 };

/** The carriage picture: 1134 x 1134 in the designer's original. */
const CAR = { w: 1134, h: 1134 };
const cx = (x) => Math.round((x / CAR.w) * 10000) / 100;
const cy = (y) => Math.round((y / CAR.h) * 10000) / 100;
const CAR_ROOF = { xs: [362, 568, 774], y: 158 };
const CAR_WINDOWS = [[391, 475], [744.5, 475]];
const CAR_PLATE = [568, 703];

/** Storage spaces printed on the board's roof. */
const BOARD_SPACES = 6;

/** Width of the board picture over its height: the strip is this plus one square per carriage. */
const BOARD_ASPECT = ENG.w / ENG.h;

// ---------------------------------------------------------------------------
// Stored items
// ---------------------------------------------------------------------------

/** Everything in storage as one list, in the order it fills the spaces: resources first, then built tiles. */
function storageUnits(p) {
  const units = [];
  const add = (item, n, kind) => {
    for (let i = 0; i < n; i++) units.push({ item, kind });
  };
  add('iron', p.resources.iron, 'res');
  add('wood', p.resources.wood, 'res');
  add('gunpowder', p.resources.gunpowder, 'res');
  add('ground', p.builtTiles.ground, 'tile');
  add('tunnel', p.builtTiles.tunnel, 'tile');
  add('bridge', p.builtTiles.bridge, 'tile');
  return units;
}

function itemPicture(u) {
  return u.kind === 'tile'
    ? trackTile(u.item, { cls: 'cb__tile', label: `${NAMES[u.item]} track tile` })
    : art(ITEM_ART[u.item], { cls: 'cb__img', label: NAMES[u.item] });
}

/** One stored item. `where` is a style string that places it (on the printed art) or '' (in the extra row). */
function itemHtml(ctx, mine, u, where, cls, tgt) {
  const ct = mine ? tgt(ctx, 'store', `store:${u.item}`) : { attrs: '', cls: '' };
  const name = `${NAMES[u.item]}${u.kind === 'tile' ? ' (built track tile)' : ''}`;
  return `<span class="cb__u cb__u--${u.kind}${cls}${ct.cls}" data-item="${u.item}" ${ct.attrs} style="${where}" title="${esc(name)}">${itemPicture(u)}</span>`;
}

// ---------------------------------------------------------------------------
// Pieces of the board
// ---------------------------------------------------------------------------

function houseTracks(ctx, p, tgt) {
  const { state } = ctx;
  const colour = ctx.who(p.id).colour;
  const mine = ctx.interactive && p.id === state.toAct;
  return getConstants(state)
    .PLAYER_BOARD.houseTracks.map((track) => {
      const spot = HOUSE_SPOTS[track];
      const left = p.houses[track];
      const ht = mine ? tgt(ctx, 'house', `house:${track}`) : { attrs: '', cls: '' };
      const houses = spot.xs
        .map((x, i) => {
          const filled = i >= PLAYER_BOARD.houseSlotsPerTrack - left;
          return `<span class="cb__h${filled ? ' has-house' : ''}" style="left:${ex(x)}%;top:${ey(spot.y)}%" title="${filled ? 'A house covers this production space' : 'Empty: this house has left the track (production +1)'}">${filled ? piece('house', colour) : ''}</span>`;
        })
        .join('');
      return `<span class="cb__t${ht.cls}" data-track="${track}" ${ht.attrs}>${houses}<span class="cb__p" style="left:${ex(spot.badge[0])}%;top:${ey(spot.badge[1])}%" title="Production of ${esc(NAMES[track])}">${production(state, p.id, track)}</span></span>`;
    })
    .join('');
}

function telegraphRow(ctx, p) {
  const colour = ctx.who(p.id).colour;
  return PLAYER_BOARD.telegraphRowVp
    .map((vp, i) => {
      const present = i >= p.telegraphsPlaced;
      const next = i === p.telegraphsPlaced;
      return `<span class="cb__s${present ? ' has-station' : ' is-placed'}${next ? ' is-next' : ''}" style="left:${ex(TELEGRAPH.x)}%;top:${ey(TELEGRAPH.y[vp])}%" title="${present ? `Telegraph station worth ${vp} VP${next ? ' (next to be placed)' : ''}` : `Placed on the map (it scored ${vp} VP)`}">${present ? `${piece('telegraph-station', colour)}<small class="cb__vp">${vp}</small>` : ''}</span>`;
    })
    .join('');
}

/** The printed hats stay on the picture: a space with no hat is covered. */
function hatSpaces(p) {
  return HAT_SPOTS.map(
    ([x, y], i) => `<span class="cb__hat${p.hats > i ? ' has-hat' : ' is-empty'}" style="left:${ex(x)}%;top:${ey(y)}%" title="${p.hats > i ? `Cowboy hat ${i + 1}: held` : `Cowboy hat space ${i + 1}: empty`}"></span>`,
  ).join('');
}

// ---------------------------------------------------------------------------
// The activation strip and the carriages
// ---------------------------------------------------------------------------

function activationStrip(ctx, p) {
  const frame = ctx.frame;
  if (!frame || frame.kind !== 'trainActivation' || frame.player !== p.id) return '';
  const { state } = ctx;
  const steps = frame.steps
    .map((s, i) => {
      const status = i < frame.index ? 'done' : i === frame.index && !frame.congress ? 'current' : i === frame.index ? 'done' : 'todo';
      if (s.type === 'upgrade') {
        const tile = state.modules.upgrades ? upgradeTileData(state, upgradeTileAt(state, p.id, s.level)) : null;
        return `<li class="astep astep--upgrade astep--${status}" data-step="${i}" data-status="${status}" data-step-type="upgrade" title="${esc(tile ? `${tile.name}: ${tile.text}` : describeStep(state, s))}">
          ${tile ? art(upgradeArtId(tile.id), { cls: 'icon icon--step icon--tile', label: tile.name }) : ''}<span class="astep__t">L${s.level}</span><span class="astep__s">${esc(tile ? tile.name : 'upgrade')}</span></li>`;
      }
      const label = s.level === 0 ? 'Foreman' : `L${s.level}`;
      const type = NAMES[s.type] ?? s.type;
      return `<li class="astep astep--${status}" data-step="${i}" data-status="${status}" title="${esc(describeStep(state, s))}">
        ${ITEM_ART[s.type] ? art(ITEM_ART[s.type], { cls: 'icon icon--step', label: type }) : ''}<span class="astep__t">${esc(label)}</span><span class="astep__s">${esc(type)}</span></li>`;
    })
    .join('');
  const built = frame.built;
  const builtText = ['ground', 'tunnel', 'bridge'].filter((t) => built[t] > 0).map((t) => `${built[t]} ${NAMES[t]}`).join(', ') || 'nothing yet';
  return `<div class="activation" data-field="activation">
    <div class="activation__head"><b>Board activation</b> <span>Foreman acts as ${esc(NAMES[frame.foreman] ?? frame.foreman)}</span> <span>lobby points <b>${frame.lobby}</b></span> <span>built so far: ${esc(builtText)}</span></div>
    <ol class="activation__steps">${steps}</ol>
  </div>`;
}

/** The storage space numbers on a carriage roof: the board roof is 0 to 5, then three per carriage in order. */
function roofCells(level) {
  return [0, 1, 2].map((j) => BOARD_SPACES + 3 * (level - 1) + j);
}

function carriageHtml(ctx, p, level, cells) {
  const { state } = ctx;
  const mine = ctx.interactive && p.id === state.toAct;
  const slots = p.train.specialistCarriages[level - 1].slots;
  const frame = ctx.frame;
  const mineActive = frame && frame.kind === 'trainActivation' && frame.player === p.id && !frame.congress && frame.steps[frame.index];
  const step = mineActive ? frame.steps[frame.index] : null;
  const activeLevel = step ? step.level : -1;
  const upgrades = state.modules.upgrades;
  const installedId = upgrades ? upgrades.installed[p.id][level - 1] : null;
  const tile = installedId ? upgradeTileData(state, installedId) : null;
  // The engine names the carriage a step belongs to, not the slot: the slots holding that specialist type are marked.
  const actingSlot = (s) => activeLevel === level && step && step.type === s;
  const windows = slots
    .map((s, i) => {
      const [x, y] = CAR_WINDOWS[i];
      const pos = `left:${cx(x)}%;top:${cy(y)}%`;
      if (!s) return `<span class="cslot cb__w" style="${pos}" title="Empty specialist space"></span>`;
      return `<span class="cslot cb__w has-spec${actingSlot(s) ? ' is-acting' : ''}" style="${pos}" title="${esc(NAMES[s])}">${art(`specialist-face-${s}`, { cls: 'cb__face', label: NAMES[s] })}<small class="cb__wn">${esc(NAMES[s])}</small></span>`;
    })
    .join('');
  const upgradeActing = activeLevel === level && step && step.type === 'upgrade';
  const plate = upgrades
    ? `<span class="cslot cslot--upgrade cb__k${tile ? ' has-upgrade' : ''}${upgradeActing ? ' is-acting' : ''}" style="left:${cx(CAR_PLATE[0])}%;top:${cy(CAR_PLATE[1])}%" ${tile ? `data-tip="installed:${esc(tile.id)}" data-installed="${esc(tile.id)}"` : 'title="Carriage upgrade slot: empty"'}>${
        tile ? `${art(upgradeArtId(tile.id), { cls: 'cb__kimg', label: tile.name })}<small class="cslot__name cb__sr">${esc(tile.name)}</small><small class="cslot__fx cb__sr">${esc(tile.text)}</small>` : ''
      }</span>`
    : '';
  const roof = roofCells(level).map((cell, j) => cellHtml(ctx, mine, cells, cell, `left:${cx(CAR_ROOF.xs[j])}%;top:${cy(CAR_ROOF.y)}%`, 'car')).join('');
  return `<section class="carriage cb__car${activeLevel === level ? ' is-active-step' : ''}" data-level="${level}">
    ${art('board-player-carriage', { cls: 'cb__carimg', label: `Carriage ${level}` })}${roof}${windows}${plate}<b class="cb__carno" title="Carriage ${level}: level ${level} specialists">${level}</b>
  </section>`;
}

/**
 * What stands on one printed storage space: the item (clickable when the engine asks for a discard), a lid when the
 * capacity does not reach that space, or nothing.
 */
function cellHtml(ctx, mine, cells, index, where, place) {
  const c = cells.byIndex[index];
  const cls = place === 'car' ? ' cb__u--car' : '';
  if (c && c.unit) return itemHtml(ctx, mine, c.unit, where, cls, cells.tgt);
  if (index >= cells.capacity) return `<span class="cb__lid${cls}" style="${where}" title="Not in use: your storage holds ${cells.capacity} items in all"></span>`;
  return '';
}

/** Everything the storage drawing needs: the unit in each printed space, the extra row, the capacity. */
function planStorage(ctx, p, tgt) {
  const { state } = ctx;
  const capacity = storageCapacity(state, p.id);
  const units = storageUnits(p);
  const printed = BOARD_SPACES + 3 * p.train.specialistCarriages.length;
  const byIndex = {};
  const extra = [];
  units.forEach((unit, k) => {
    if (k < capacity && k < printed) byIndex[k] = { unit };
    else extra.push({ unit, over: k >= capacity });
  });
  // empty spaces beyond the printed ones (a storage carriage), so the row shows what is left
  const emptyExtra = Math.max(0, capacity - Math.max(printed, units.length));
  return { capacity, printed, byIndex, extra, emptyExtra, tgt, used: units.length };
}

function extraRow(ctx, p, plan) {
  if (plan.extra.length === 0 && plan.emptyExtra === 0) return '';
  const mine = ctx.interactive && p.id === ctx.state.toAct;
  const items = plan.extra.map((e) => itemHtml(ctx, mine, e.unit, '', e.over ? ' is-over' : '', plan.tgt)).join('');
  const empties = '<span class="cb__e"></span>'.repeat(plan.emptyExtra);
  return `<div class="cb__extra" data-field="storage-extra" title="Storage beyond the printed spaces: a storage carriage holds 9 more items. A space with a red edge is over your capacity.">
    <span class="cb__extralabel">More storage</span>${items}${empties}</div>`;
}

// ---------------------------------------------------------------------------
// The whole board
// ---------------------------------------------------------------------------

/**
 * One player's board: who and what they hold, then the board picture and its carriages coupled in a row.
 * `tgt` is board-render.js's target-attribute builder.
 */
export function renderPlayerBoard(ctx, p, tgt) {
  const { state } = ctx;
  const seat = ctx.seats[p.id];
  const colour = ctx.who(p.id).colour;
  const mine = ctx.interactive && p.id === state.toAct;
  const carriages = p.train.specialistCarriages.length;
  const frame = ctx.frame;
  const foremanActive = frame && frame.kind === 'trainActivation' && frame.player === p.id && !frame.congress && frame.steps[frame.index] && frame.steps[frame.index].level === 0;
  const pony = state.modules.pony ? state.modules.pony.players[p.id] : null;
  const heads = p.railheads.filter((c) => c).map((c) => esc(MAP.cityById[c].name)).join(', ');
  const plan = planStorage(ctx, p, tgt);
  const used = storageUsed(p);
  const cap = storageCapacity(state, p.id);
  const roof = BOARD_ROOF.xs.map((x, i) => cellHtml(ctx, mine, plan, i, `left:${ex(x)}%;top:${ey(BOARD_ROOF.y)}%`, 'board')).join('');
  const cars = Array.from({ length: carriages }, (_, i) => carriageHtml(ctx, p, i + 1, plan)).join('');
  const units = (BOARD_ASPECT + carriages).toFixed(3);
  return `<article class="train--full cb" data-player="${p.id}" style="--pc:${colour};--cb-units:${units}">
    <header class="cb__head">
      <span class="train__head"><span class="score__dot"></span><b class="train__name">${esc(ctx.who(p.id).name)}</b>
        <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
        <span class="train__vp" data-vp="${p.id}">${totalVp(p)} VP</span></span>
      <span class="train__stats">
        <span class="stat" title="Coins">${art('resource-coin-v2', { cls: 'icon icon--stat', label: 'Coins' })}<b data-stat="coins">${p.coins}</b></span>
        <span class="stat" title="Cowboy hats (limit ${getConstants(state).HATS.hatLimit})">${art('token-cowboy-hat-v2', { cls: 'icon icon--stat', label: 'Hats' })}<b data-stat="hats">${p.hats}</b></span>
        <span class="stat" title="Workers in your supply">${piece('worker', colour)}<b data-stat="workers">${p.workersInSupply}</b></span>
        ${pony ? `<span class="stat stat--tokens" title="Pony Express tokens held">${ponyToken({ cls: 'icon--stat' })}<b data-stat="tokens">${pony.tokensHeld}</b></span>` : ''}
        <span class="stat stat--heads" title="Your trains on the map">${piece('railhead', colour)}<span>${heads}</span></span>
        <span class="cb__store${used > cap ? ' is-over' : ''}"><span class="storage__head" title="Items held of the storage capacity (resources and built track tiles; Coins are not stored)"><span>Storage</span><span class="storage__cap" data-field="storage">${used} / ${cap}</span></span></span>
      </span>
      ${extraRow(ctx, p, plan)}
    </header>
    ${activationStrip(ctx, p)}
    <div class="cb__row">
      <section class="engine cb__eng${foremanActive ? ' is-active-step' : ''}" data-field="player-board">
        ${art('board-player-engine', { cls: 'cb__engimg', label: 'Player board' })}${roof}${houseTracks(ctx, p, tgt)}${telegraphRow(ctx, p)}${hatSpaces(p)}
      </section>
      ${cars}
    </div>
  </article>`;
}
