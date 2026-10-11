// board-render.js - DOM rendering, split into named sub-renderers.
//
// Every renderer takes the render context and returns an HTML string; main.js
// assigns each string to its region. All of them run on every frame (a full
// re-render per action is fine; the page rebuilds a few hundred nodes).
//
// Nothing here decides what is legal. A thing is drawn as clickable only
// because action-targets.js found a legal action for it. The DOM carries
// identifiers (data-target="route:SEA-SPO") and nothing else.
//
// Every target carries one of three states (data-state):
//   legal    the engine lists an action for it: lit.
//   illegal  in scope for the pending decision but not legal: drawn plainly and
//            left clickable on purpose, so the click can say why.
//   out      not what the pending decision is about: dimmed.
// and data-tip="<key>", from which main.js builds the hover tooltip on demand.
//
// Context (built by main.js):
//   state, targets, view, mode, modeData, hat, hasPending,
//   seats[pid] = { human, level, label, name, colour }, who(pid) -> { name, colour },
//   interactive, viewer (player id shown in full), flashAge,
//   undo: { available }, frame (the pending decision frame)

import {
  GRID,
  MAP,
  NAMES,
  PLAYER_BOARD,
  DISTRICT_IDS,
  getConstants,
  congressTable,
  congressCoinCost,
  describeDecision,
  describeStep,
  production,
  storageUsed,
  storageCapacity,
  totalVp,
  routeShortfall,
  nextTelegraphVp,
  scoreGame,
  upgradeTileData,
  upgradeTileAt,
} from '../engine/index.js';
import { art, hasArt, piece, isRealArt, svgArt, upgradeArtId, trackTile, ponyToken, svgPiece, svgPonyToken, svgTrackTile } from './art.js';
import { ITEM_ART, moveTolls, stationEffect, targetState } from './action-targets.js';
import { entryHtml } from './log-html.js';
import { variantChips } from './variants-panel.js';
import { reasonPairForKey, availability } from './explain.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

const colourOf = (ctx, pid) => ctx.who(pid).colour;
const nameOf = (ctx, pid) => ctx.who(pid).name;

/** ' is-flash' when this id was touched by the last action and the highlight is still running. */
function flashCls(ctx, list, id) {
  return ctx.flashAge >= 0 && list.includes(id) ? ' is-flash' : '';
}

/** The animation offset that makes a re-render CONTINUE the highlight rather than restart it. */
function flashDelay(ctx) {
  return ctx.flashAge >= 0 ? `animation-delay:-${ctx.flashAge}ms;` : '';
}

/**
 * The identity attributes of one target: its key for clicks, its tooltip key,
 * and (while the player is deciding) its state. `kind` is the kind of target
 * ("route"), `key` the full target key ("route:SEA-SPO").
 */
function tgt(ctx, kind, key) {
  let attrs = ` data-target="${esc(key)}" data-tip="${esc(key)}"`;
  let state = null;
  if (ctx.interactive && !ctx.view.generic) {
    state = targetState(ctx.targets, kind, key);
    attrs += ` data-state="${state}"`;
    if (state === 'legal') attrs += ' data-legal="1"';
  }
  return { attrs, state, legal: state === 'legal', cls: state ? ` is-${state}` : '' };
}

// ---------------------------------------------------------------------------
// Header and score strip
// ---------------------------------------------------------------------------

export function renderHeader(ctx) {
  const { state, view } = ctx;
  const ended = state.phase === 'ended';
  const undoWhy = ctx.undo.available ? 'Undo your last choice' : 'Nothing of yours to undo: undo only goes back within your own run of choices, and not into another player\'s turn.';
  const speedNames = { normal: 'Normal', fast: 'Fast', instant: 'Instant' };
  return `
    <div class="hdr__title">Continental Rails</div>
    <div class="hdr__meta" title="Use this seed to reproduce the game">Seed <b data-field="seed">${esc(state.config.seed)}</b></div>
    <div class="hdr__meta hdr__variants" aria-label="Rules variants in this game">${variantChips(state.variants)}</div>
    <div class="hdr__spacer"></div>
    <div class="hdr__group" role="group" aria-label="Bot speed">
      <span class="hdr__label">Bots</span>
      ${['normal', 'fast', 'instant']
        .map((s) => `<button type="button" class="btn btn--small${view.speed === s ? ' is-on' : ''}" data-ui="speed:${s}" aria-pressed="${view.speed === s}" title="Bot speed: ${s}">${speedNames[s]}</button>`)
        .join('')}
      <button type="button" class="btn btn--small${view.paused ? ' is-on' : ''}" data-ui="pause" aria-pressed="${view.paused}" ${ended ? 'disabled title="The game is over."' : `title="${view.paused ? 'Let the bots carry on' : 'Hold the bots until you resume'}"`}>${view.paused ? 'Resume' : 'Pause'}</button>
    </div>
    <button type="button" class="btn btn--small" data-ui="undo" data-undo-available="${ctx.undo.available ? 1 : 0}" ${ctx.undo.available ? '' : 'disabled'} title="${esc(undoWhy)}">Undo</button>
    <button type="button" class="btn btn--small" data-ui="new-game">New game</button>`;
}

/** One number with its picture, for the player cards: "[coin] 3". */
function num(icon, n, title, cls = '') {
  return `<span class="pstat${n === 0 ? ' is-zero' : ''} ${cls}" title="${esc(title)}: ${n}">${icon}<b>${n}</b></span>`;
}

/**
 * The players, in seat order: who is to move, who is winning, and the numbers
 * that matter about each (VP, routes, buildings, built tiles, resources). A card
 * is a button: it shows that player's train in the strip under the map.
 */
export function renderScores(ctx) {
  const { state } = ctx;
  const best = Math.max(...state.players.map((p) => totalVp(p)));
  const cards = state.players
    .map((p) => {
      const seat = ctx.seats[p.id];
      const acting = state.toAct === p.id;
      const isTurn = state.turn.player === p.id;
      const viewed = ctx.viewer === p.id;
      const vp = totalVp(p);
      const leading = best > 0 && vp === best;
      const name = nameOf(ctx, p.id);
      const routes = Object.values(state.map.routeOwner).filter((o) => o === p.id).length;
      const buildings = p.telegraphsPlaced + Object.values(state.map.railwayStation).filter((o) => o === p.id).length;
      const pony = state.modules.pony ? state.modules.pony.players[p.id] : null;
      const ic = (id, label) => art(id, { cls: 'icon icon--pstat', label });
      return `<button type="button" class="score${acting ? ' is-acting' : ''}${isTurn ? ' is-turn' : ''}${viewed ? ' is-viewed' : ''}${leading ? ' is-leading' : ''}" data-ui="focus:${p.id}" data-player="${p.id}" style="--pc:${colourOf(ctx, p.id)}" aria-pressed="${viewed}" title="${viewed ? `${esc(name)}'s train is shown under the map` : `Show ${esc(name)}'s train under the map`}">
        <span class="score__top">
          <span class="score__dot"></span>
          <span class="score__name">${esc(name)}</span>
          <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
          ${isTurn ? '<span class="score__flag">turn</span>' : ''}${acting && !isTurn && state.turn.number > 0 ? '<span class="score__flag score__flag--ask">asked</span>' : ''}
          <span class="score__vp" data-vp="${p.id}">${leading ? '<span class="score__lead" title="In the lead" aria-label="In the lead">&#9733;</span>' : ''}${vp}<small> VP</small></span>
        </span>
        <span class="score__stats">
          ${num(ic('icon-track', 'Routes'), routes, 'Routes owned')}
          ${num(ic('icon-building', 'Buildings'), buildings, 'Buildings on the map')}
          ${['ground', 'tunnel', 'bridge'].map((t) => num(trackTile(t, { cls: 'tile--mini' }), p.builtTiles[t], `Built ${NAMES[t]} tiles`, 'pstat--tile')).join('')}
        </span>
        <span class="score__stats">
          ${num(ic('resource-coin', 'Coins'), p.coins, 'Coins')}
          ${['iron', 'wood', 'gunpowder'].map((r) => num(ic(ITEM_ART[r], NAMES[r]), p.resources[r], NAMES[r])).join('')}
          ${num(ic('token-cowboy-hat', 'Cowboy hats'), p.hats, 'Cowboy hats')}
          ${pony ? num(ponyToken({ cls: 'icon--pstat' }), pony.tokensHeld, 'Tokens held', 'pstat--tokens') : ''}
        </span>
      </button>`;
    })
    .join('');
  return `<h2 class="region__title">Players <small>click one to see its train</small></h2>${cards}`;
}

// ---------------------------------------------------------------------------
// The prompt banner and the decision panel
// ---------------------------------------------------------------------------

/** One button for a legal action. */
function actionButton(ctx, action, label, cls = '', extra = '') {
  return `<button type="button" class="btn ${cls}" data-akey="${esc(ctx.keyOf(action))}" data-legal="1" ${extra}>${esc(label)}</button>`;
}

export function renderPrompt(ctx) {
  const { state, targets, view } = ctx;
  if (state.phase === 'ended') {
    return `<div class="prompt prompt--end"><div class="prompt__main">The game is over.</div><div class="prompt__buttons"><button type="button" class="btn btn--primary" data-ui="show-end">Show the final scores</button></div></div>`;
  }
  const decision = describeDecision(state);
  const seat = ctx.seats[state.toAct];
  const pc = colourOf(ctx, state.toAct);
  const botThinking = !seat.human;
  const interactive = ctx.interactive;
  const lines = [];

  lines.push(`<div class="prompt__who" style="--pc:${pc}">
      <span class="score__dot"></span>
      <span class="prompt__name" data-field="to-act">${esc(nameOf(ctx, state.toAct))}</span>
      <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
      ${state.turn.number > 0 ? `<span class="prompt__turn">Turn ${state.turn.number}${state.turn.player !== null && state.turn.player !== state.toAct ? ` (${esc(nameOf(ctx, state.turn.player))}'s turn)` : ''}</span>` : '<span class="prompt__turn">Setup</span>'}
    </div>`);
  lines.push(`<div class="prompt__main" data-field="prompt" data-kind="${esc(decision ? decision.kind : '')}">${esc(decision ? decision.prompt : '')}</div>`);

  if (botThinking) {
    lines.push(`<div class="prompt__thinking" data-field="thinking" role="status"><span class="spinner" aria-hidden="true"></span> ${esc(nameOf(ctx, state.toAct))} (${esc(seat.label)}) is ${view.paused ? 'paused' : 'thinking'}...</div>`);
  } else if (interactive) {
    const hint = hintFor(ctx);
    if (hint) lines.push(`<div class="prompt__hint">${hint}</div>`);

    // Hat toggle for the district choice.
    if (targets.districts.anyDistrict && targets.districts.hatAvailable) {
      lines.push(`<label class="hat-toggle"><input type="checkbox" data-ui="toggle-hat" ${ctx.hat ? 'checked' : ''}> Spend a cowboy hat for +1 multiplier ${art('token-cowboy-hat', { cls: 'icon icon--inline', label: 'hat' })}</label>`);
    }

    // What each lit district leads to, where the engine will then move by itself.
    if (targets.districts.anyDistrict) {
      const items = [];
      for (const [key] of targets.byTarget) {
        if (!key.startsWith('district:')) continue;
        const pv = targets.districts.previews[key.slice(9)];
        const v = pv && (ctx.hat && pv.hat ? pv.hat : pv.plain);
        if (v && v.sentence) items.push(`<li data-consequence="${esc(key.slice(9))}">${esc(v.sentence)}</li>`);
      }
      if (items.length) lines.push(`<div class="consequences" data-field="consequences"><div class="consequences__title">What your choice leads to</div><ul>${items.join('')}</ul></div>`);
    }

    // The banner's own buttons: use / skip / stop, a way out of a half-made choice, and the way to the module panel.
    const buttons = [];
    for (const a of targets.primary) buttons.push(actionButton(ctx, a, ctx.describe(a), 'btn--primary'));
    for (const a of targets.secondary) buttons.push(actionButton(ctx, a, ctx.describe(a), 'btn--secondary'));
    if (ctx.hasPending) buttons.push(`<button type="button" class="btn btn--secondary" data-ui="cancel" title="Clear what you have selected (Escape)">Cancel${ctx.mode === 'choose' ? '' : ' the hat'}</button>`);
    if (targets.wantedTab && !(view.dock.open && ctx.activeTab === targets.wantedTab)) {
      buttons.push(`<button type="button" class="btn" data-ui="tab:${esc(targets.wantedTab)}" data-field="open-panel">Open the ${esc(ctx.tabTitles[targets.wantedTab])} panel</button>`);
    }
    if (buttons.length) lines.push(`<div class="prompt__buttons">${buttons.join('')}</div>`);

    // A choice between several actions that share the clicked target.
    if (ctx.mode === 'choose' && ctx.modeData) {
      lines.push(`<div class="choice" data-field="choice"><div class="choice__title">${esc(ctx.modeData.title)}</div>${ctx.modeData.actions
        .map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--choice'))
        .join('')}</div>`);
    }

    // Decision panels (bespoke controls for decisions that have no board target of their own).
    for (const panel of targets.panels) lines.push(renderPanel(ctx, panel));

    // The generic layer: every legal action the bespoke controls do not cover.
    const generic = targets.generic;
    if (generic.length) {
      lines.push(`<div class="generic" data-field="generic"><div class="generic__title">${view.generic ? 'Choose a move' : 'Other moves available'}</div>${generic
        .map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--generic'))
        .join('')}</div>`);
    }
  }

  // All legal moves, always available (and the proof the generic layer is complete).
  if (interactive && !view.generic && targets.all.length) {
    lines.push(`<details class="allmoves" ${view.showAllMoves ? 'open' : ''}><summary data-ui="all-moves">All ${targets.all.length} legal moves</summary>${
      view.showAllMoves ? targets.all.map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--generic btn--tiny')).join('') : ''
    }</details>`);
  }
  lines.push(lastMove(ctx));
  return `<div class="prompt">${lines.join('')}</div>`;
}

/**
 * "What did the last player just do": the newest move in the log made by somebody
 * other than the player now being asked, in one line, with what it scored. The
 * full account stays in the log; this is the glance.
 */
function lastMove(ctx) {
  const { state } = ctx;
  for (let i = ctx.log.length - 1; i >= 0; i--) {
    const e = ctx.log[i];
    if (e.turn !== null || e.player === null || e.player === undefined) continue;
    if (e.player === state.toAct) continue;
    const scored = e.details.filter((d) => d.kind === 'vp' || d.kind === 'score').map((d) => d.text);
    return `<div class="prompt__last" data-field="last-move" style="--pc:${esc(e.colour || '#888888')}"><span class="prompt__lastlabel">Last move</span><span class="score__dot"></span><b>${esc(e.name)}</b> <span class="prompt__lasttext">${esc(e.text)}${scored.length ? ` <i>${esc(scored[0])}</i>` : ''}</span></div>`;
  }
  return '';
}

/** One sentence under the prompt saying what to do and where, per kind of decision. */
function hintFor(ctx) {
  const kind = ctx.frame ? ctx.frame.kind : '';
  switch (kind) {
    case 'workerStep':
      return 'Click a lit worker space to place a worker, one of your own workers to take it off the grid, or the centre ring of a blocked district to displace. Hover anything for the reason it is or is not open to you.';
    case 'chooseDistrict':
      return 'Click one of the lit districts. The badge shows the multiplier and what you would get.';
    case 'trainActivation':
      return ctx.frame && ctx.frame.congress
        ? 'Click a lit Congress entry to spend lobby points and Coins, or carry on.'
        : 'This builds track tiles into your storage. Nothing goes onto the map until you take Lay Tracks.';
    case 'layTracks':
      return 'Lay tracks: click a lit route to claim it, spending built tiles from storage. Lit cities are places a railhead can move to.';
    case 'placeBuildings':
      return 'Click the city, or choose below. A railway station takes a house off your player board (raising production); a telegraph station scores VP.';
    case 'setupRailhead':
      return 'Click a start city on the map to put a railhead there.';
    case 'discard':
      return 'Your storage is over capacity. Discard items until it fits.';
    case 'freeActions':
      return 'Free actions: the controls are in the panel under the map.';
    default:
      return '';
  }
}

function renderPanel(ctx, panel) {
  const { state } = ctx;
  const items = panel.items
    .map((item) => {
      const a = item.action;
      let sub = item.sub ?? '';
      if (item.building === 'railwayStation') {
        const fx = stationEffect(state, state.toAct, a);
        sub = fx ? `A house leaves your ${NAMES[fx.track]} track: production ${fx.before} to ${fx.after}.` : '';
      } else if (item.building === 'telegraphStation') {
        const vp = nextTelegraphVp(state, state.toAct);
        sub = vp === null ? '' : `Scores ${vp} VP.`;
      }
      const label = item.building === 'railwayStation' ? `Railway station: ${NAMES[a.houseTrack]} track` : item.building === 'telegraphStation' ? 'Telegraph station' : item.label;
      return `<button type="button" class="btn btn--panel" data-akey="${esc(item.key)}" data-legal="1" title="${esc(item.label)}">
        ${item.art ? art(item.art, { cls: item.art.startsWith('bonus-') ? 'icon icon--bonus' : 'icon icon--panel', label: label }) : ''}
        <span class="btn__text"><span class="btn__label">${esc(label)}</span>${sub ? `<span class="btn__sub">${esc(sub)}</span>` : ''}</span>
      </button>`;
    })
    .join('');
  return `<section class="panel" data-panel="${esc(panel.id)}"><div class="panel__title">${esc(panel.title)}</div>${panel.hint ? `<div class="panel__hint">${esc(panel.hint)}</div>` : ''}<div class="panel__items">${items}</div></section>`;
}

// ---------------------------------------------------------------------------
// The action grid
// ---------------------------------------------------------------------------

export function renderGrid(ctx) {
  const { state, targets } = ctx;
  const flash = ctx.view.flash;
  const cells = [];
  const pos = Object.fromEntries(GRID.positions.map((p) => [p.id, p]));

  for (const d of DISTRICT_IDS) {
    const p = pos[d];
    const tileId = state.grid.tiles[d];
    const dt = tgt(ctx, 'district', `district:${d}`);
    const preview = dt.legal ? targets.districts.previews[d] : null;
    const variant = preview ? (ctx.hat && preview.hat ? 'hat' : 'plain') : null;
    const pv = preview && variant ? preview[variant] : null;
    const ct = tgt(ctx, 'centre', `centre:${d}`);
    const centreOwner = state.grid.centres[d];
    const info = GRID.districtTiles[tileId];
    const name = info ? info.name : tileId;
    const interactiveCls = ctx.interactive && !ctx.view.generic;
    cells.push(`<div class="district${dt.cls}${flashCls(ctx, flash.districts, d)}" data-district="${d}" data-tile="${tileId}" ${interactiveCls ? `${dt.attrs} role="button" tabindex="0" aria-label="${esc(name)}"` : `data-tip="district:${d}"`}
      style="grid-row:${2 * p.row - 1};grid-column:${2 * p.col - 1};${flashDelay(ctx)}">
        ${art(`district-${tileId}`, { cls: 'district__art', label: name })}
        ${pv ? `<span class="district__badge" data-multiplier="${pv.multiplier}"><b>x${pv.multiplier}</b>${pv.outcome ? `<small>${esc(pv.outcome)}</small>` : ''}${pv.sentence ? '<small class="district__forced">then automatic</small>' : ''}</span>` : ''}
        <button type="button" class="centre${centreOwner !== null ? ' is-occupied' : ''}${ct.cls}" data-centre="${d}" ${ct.state === 'out' ? '' : ct.attrs}
          aria-label="Centre of ${esc(name)}"
          style="${centreOwner !== null ? `--pc:${colourOf(ctx, centreOwner)}` : ''}">${centreOwner !== null ? piece('worker', colourOf(ctx, centreOwner)) : ''}</button>
      </div>`);
  }

  for (const w of GRID.workerSpaces) {
    const [a, b] = w.between;
    const pa = pos[a];
    const pb = pos[b];
    // Row/column of the gap track between two districts (even tracks of the 5 x 5 layout grid).
    const gridRow = pa.row === pb.row ? 2 * pa.row - 1 : pa.row + pb.row - 1;
    const gridCol = pa.col === pb.col ? 2 * pa.col - 1 : pa.col + pb.col - 1;
    const owner = state.grid.spaces[w.id];
    const st = tgt(ctx, 'space', `space:${w.id}`);
    const entry = st.legal ? targets.byTarget.get(`space:${w.id}`) : undefined;
    const isRemove = entry && entry.actions.some((x) => x.type === 'removeWorker');
    cells.push(`<button type="button" class="wspace${owner !== null ? ' is-occupied' : ''}${st.cls}${isRemove ? ' is-remove' : ''}${flashCls(ctx, flash.spaces, w.id)}" data-space="${w.id}" ${st.attrs}
        aria-label="Worker space ${w.id}${owner !== null ? `, ${esc(nameOf(ctx, owner))}'s worker` : ', empty'}"
        style="grid-row:${gridRow};grid-column:${gridCol};${owner !== null ? `--pc:${colourOf(ctx, owner)};` : ''}${flashDelay(ctx)}">
        ${owner !== null ? piece('worker', colourOf(ctx, owner)) : art('footprint-marker', { cls: 'wspace__feet', alt: '' })}
        <span class="wspace__id">${w.id}</span>
      </button>`);
  }

  return `<div class="grid3" role="group" aria-label="Action grid: nine districts and twelve worker spaces">${cells.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// The Congress strip
// ---------------------------------------------------------------------------

export function renderCongress(ctx) {
  const { state } = ctx;
  const table = congressTable(state);
  const frame = ctx.frame;
  const inActivation = frame && frame.kind === 'trainActivation';
  const lobby = inActivation ? frame.lobby : null;
  const anyUsed = table.some((e) => !e.reset && state.congress.used[e.id]);
  const rows = table
    .map((e) => {
      const used = !e.reset && state.congress.used[e.id] === true;
      const ct = tgt(ctx, 'congress', `congress:${e.id}`);
      const lower = e.id.toLowerCase();
      const costArt = hasArt(`congress-cost-${lower === 'cr' ? 'reset' : lower}`) ? art(`congress-cost-${lower === 'cr' ? 'reset' : lower}`, { cls: 'cong__cell', label: `cost ${e.coinCost}` }) : '';
      const benefitArt = hasArt(`congress-benefit-${lower === 'cr' ? 'reset' : lower}`) ? art(`congress-benefit-${lower === 'cr' ? 'reset' : lower}`, { cls: 'cong__cell', label: 'benefit' }) : '';
      // The price to this player (a Pony Express card can change the Coins), against what they hold.
      const coin = ctx.interactive ? congressCoinCost(state, state.toAct, e) : e.coinCost;
      let why = '';
      if (ct.state === 'illegal' && !ctx.view.generic) {
        const a = availability(reasonPairForKey(state, `congress:${e.id}`));
        if (a) why = a.text;
      }
      return `<button type="button" class="cong${used ? ' is-used' : ''}${ct.cls}${e.reset ? ' is-reset' : ''}" data-entry="${e.id}" ${ct.attrs}>
        <span class="cong__cells">${costArt}${benefitArt}</span>
        <span class="cong__body">
          <span class="cong__cost">${e.reset ? 'Reset' : esc(e.id)} - ${plural(e.tier, 'lobby point', 'lobby points')} + ${plural(coin, 'Coin', 'Coins')}</span>
          <span class="cong__text">${esc(e.text)}</span>
          ${why ? `<span class="cong__why" data-field="congress-why">${esc(why)}</span>` : ''}
        </span>
        <span class="cong__senator">${e.reset ? (anyUsed ? 'ready' : '') : used ? 'used' : 'open'}</span>
      </button>`;
    })
    .join('');
  return `<div class="congress__head"><h2 class="region__title">Lobby Congress</h2>${lobby !== null ? `<span class="congress__lobby" data-field="lobby">Lobby points in hand: <b>${lobby}</b></span>` : '<span class="congress__lobby congress__lobby--idle">Financiers earn lobby points</span>'}</div>
    <div class="congress__rows">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Train boards
// ---------------------------------------------------------------------------

function houseTrackRow(ctx, p, track) {
  const { state } = ctx;
  const colour = colourOf(ctx, p.id);
  const prod = production(state, p.id, track);
  const left = p.houses[track];
  const slots = [2, 3, 4]
    .map((n, i) => {
      const filled = i >= PLAYER_BOARD.houseSlotsPerTrack - left;
      return `<span class="hslot${filled ? ' has-house' : ''}" title="${filled ? 'A house covers this production number' : 'Empty: this house has left the track (production +1)'}">${filled ? piece('house', colour) : n}</span>`;
    })
    .join('');
  const mine = ctx.interactive && p.id === state.toAct;
  const ht = mine ? tgt(ctx, 'house', `house:${track}`) : { attrs: '', cls: '' };
  return `<div class="htrack${ht.cls}" data-track="${track}" ${ht.attrs}>
    ${art(ITEM_ART[track], { cls: 'icon icon--track', label: NAMES[track] })}
    <span class="htrack__p" title="Production of ${esc(NAMES[track])}">${prod}</span>${slots}
  </div>`;
}

/**
 * The storage: resources, and the stockpile of BUILT track tiles. A built tile
 * is drawn exactly as it will look on the map once laid (art.js trackTile), so
 * the two halves of build-then-lay are visibly the same object in two places.
 */
function storageChips(ctx, p) {
  const { state } = ctx;
  const mine = ctx.interactive && p.id === state.toAct;
  const chipHtml = (item, n, built) => {
    const ct = mine ? tgt(ctx, 'store', `store:${item}`) : { attrs: '', cls: '' };
    const picture = built ? trackTile(item, { label: `${NAMES[item]} track tile` }) : art(ITEM_ART[item], { cls: 'icon icon--stock', label: NAMES[item] });
    return `<span class="stock stock--${built ? 'tile' : 'res'} stock--${item}${n === 0 ? ' is-zero' : ''}${ct.cls}" data-item="${item}" data-count="${n}" ${ct.attrs} title="${esc(NAMES[item])}${built ? ' (built track tile)' : ''}: ${n}">
      ${picture}<b>${n}</b></span>`;
  };
  const used = storageUsed(p);
  const cap = storageCapacity(state, p.id);
  return `<section class="storage${used > cap ? ' is-over' : ''}">
    <div class="storage__head"><span>Storage</span><span class="storage__cap" data-field="storage" title="Items held of the storage capacity">${used} / ${cap}</span></div>
    <div class="storage__group"><span class="storage__label">Resources</span>${['iron', 'wood', 'gunpowder'].map((r) => chipHtml(r, p.resources[r], false)).join('')}</div>
    <div class="storage__group storage__group--tiles" title="Built by train activations. Spent by Lay Tracks to claim a route on the map."><span class="storage__label">Built tiles</span>${['ground', 'tunnel', 'bridge'].map((t) => chipHtml(t, p.builtTiles[t], true)).join('')}</div>
    <div class="storage__note">Built here by a train activation. Laid on the map by Lay Tracks.</div>
  </section>`;
}

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
      const label = s.level === 0 ? `Foreman` : `L${s.level}`;
      const type = NAMES[s.type] ?? s.type;
      return `<li class="astep astep--${status}" data-step="${i}" data-status="${status}" title="${esc(describeStep(state, s))}">
        ${ITEM_ART[s.type] ? art(ITEM_ART[s.type], { cls: 'icon icon--step', label: type }) : ''}<span class="astep__t">${esc(label)}</span><span class="astep__s">${esc(type)}</span></li>`;
    })
    .join('');
  const built = frame.built;
  const builtText = ['ground', 'tunnel', 'bridge'].filter((t) => built[t] > 0).map((t) => `${built[t]} ${NAMES[t]}`).join(', ') || 'nothing yet';
  return `<div class="activation" data-field="activation">
    <div class="activation__head"><b>Train activation</b> <span>Foreman acts as ${esc(NAMES[frame.foreman] ?? frame.foreman)}</span> <span>lobby points <b>${frame.lobby}</b></span> <span>built so far: ${esc(builtText)}</span></div>
    <ol class="activation__steps">${steps}</ol>
  </div>`;
}

function carriageHtml(ctx, p, level) {
  const { state } = ctx;
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
  const upgradeCell = upgrades
    ? `<span class="cslot cslot--upgrade${tile ? ' has-upgrade' : ''}${activeLevel === level && step && step.type === 'upgrade' ? ' is-acting' : ''}" ${tile ? `data-tip="installed:${esc(tile.id)}" data-installed="${esc(tile.id)}"` : 'title="Carriage upgrade slot: empty"'}>${
        tile
          ? `${art(upgradeArtId(tile.id), { cls: 'cslot__tile', label: tile.name })}<small class="cslot__name">${esc(tile.name)}</small><small class="cslot__fx">${esc(tile.text)}</small>`
          : '<small>upgrade slot</small>'
      }</span>`
    : '';
  return `<section class="car carriage${activeLevel === level ? ' is-active-step' : ''}" data-level="${level}">
    <div class="carriage__head">Carriage ${level} <small>level ${level} specialists</small></div>
    <div class="carriage__slots">${slots
      .map((s) => `<span class="cslot${s ? ' has-spec' : ''}${s && actingSlot(s) ? ' is-acting' : ''}" title="${s ? esc(NAMES[s]) : 'Empty slot'}">${s ? art(ITEM_ART[s], { cls: 'icon icon--spec', label: NAMES[s] }) + `<small>${esc(NAMES[s])}</small>` : '<small>empty</small>'}</span>`)
      .join('')}${upgradeCell}</div>
  </section>`;
}

/**
 * One player's train, drawn as a train: a manifest (who, what they hold, the
 * storage) and then the engine and its carriages coupled in a row.
 */
function trainFull(ctx, p) {
  const { state } = ctx;
  const seat = ctx.seats[p.id];
  const colour = colourOf(ctx, p.id);
  const tele = PLAYER_BOARD.telegraphRowVp
    .map((vp, i) => `<span class="tslot${i >= p.telegraphsPlaced ? ' has-station' : ' is-placed'}${i === p.telegraphsPlaced ? ' is-next' : ''}" title="${i >= p.telegraphsPlaced ? `Telegraph station worth ${vp} VP` : 'Placed on the map'}">${i >= p.telegraphsPlaced ? piece('telegraph-station', colour) : ''}<b>${vp}</b></span>`)
    .join('');
  const carriages = [];
  for (let l = 1; l <= p.train.specialistCarriages.length; l++) carriages.push(carriageHtml(ctx, p, l));
  const frame = ctx.frame;
  const foremanActive = frame && frame.kind === 'trainActivation' && frame.player === p.id && !frame.congress && frame.steps[frame.index] && frame.steps[frame.index].level === 0;
  const pony = state.modules.pony ? state.modules.pony.players[p.id] : null;
  const heads = p.railheads.filter((c) => c).map((c) => esc(MAP.cityById[c].name)).join(', ');
  return `<article class="train train--full" data-player="${p.id}" style="--pc:${colour}">
    <div class="train__manifest">
      <header class="train__head">
        <span class="score__dot"></span><b class="train__name">${esc(nameOf(ctx, p.id))}</b>
        <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
        <span class="train__vp" data-vp="${p.id}">${totalVp(p)} VP</span>
      </header>
      <div class="train__stats">
        <span class="stat" title="Coins">${art('resource-coin', { cls: 'icon icon--stat', label: 'Coins' })}<b data-stat="coins">${p.coins}</b></span>
        <span class="stat" title="Cowboy hats (limit ${getConstants(state).HATS.hatLimit})">${art('token-cowboy-hat', { cls: 'icon icon--stat', label: 'Hats' })}<b data-stat="hats">${p.hats}</b></span>
        <span class="stat" title="Workers in your supply">${piece('worker', colour)}<b data-stat="workers">${p.workersInSupply}</b></span>
        ${pony ? `<span class="stat stat--tokens" title="Pony Express tokens held">${ponyToken({ cls: 'icon--stat' })}<b data-stat="tokens">${pony.tokensHeld}</b></span>` : ''}
        <span class="stat stat--heads" title="Railheads">${piece('railhead', colour)}<span>${heads}</span></span>
      </div>
      ${storageChips(ctx, p)}
    </div>
    <div class="train__consist">
      ${activationStrip(ctx, p)}
      <div class="train__cars">
        <section class="car engine${foremanActive ? ' is-active-step' : ''}">
          <div class="engine__head">Engine <small>Foreman, house tracks, telegraph row</small></div>
          <div class="engine__tracks">${getConstants(state).PLAYER_BOARD.houseTracks.map((t) => houseTrackRow(ctx, p, t)).join('')}</div>
          <div class="engine__tele"><span class="engine__label" title="Telegraph stations still on the player board, with the VP each scores when placed">Telegraph</span>${tele}</div>
        </section>
        ${carriages.join('')}
      </div>
    </div>
  </article>`;
}

/** The train strip under the map: the train of the player to move (or of the player whose card was clicked). */
export function renderTrains(ctx) {
  return trainFull(ctx, ctx.state.players[ctx.viewer]);
}

// ---------------------------------------------------------------------------
// The route map (SVG, 1 unit = 1 mm, drawn from the engine's map data)
// ---------------------------------------------------------------------------

function cityLabelPos(city) {
  // Start cities sit on the board edge: label on the inside. Inland cities: below.
  if (city.kind === 'west') return { x: city.x + 12, y: city.y + 2.5, anchor: 'start' };
  if (city.kind === 'east') return { x: city.x - 12, y: city.y + 2.5, anchor: 'end' };
  return { x: city.x, y: city.y + 17, anchor: 'middle' };
}

const TERRAIN_LETTER = { ground: 'G', tunnel: 'T', bridge: 'B' };

/** The cost badge of a route: "2G 1T", with what is missing ("short 1T") when the player cannot pay. */
function routeBadge(ctx, r, mid, legal) {
  const { state } = ctx;
  const player = state.players[state.toAct];
  const cost = ['ground', 'tunnel', 'bridge'].filter((t) => r.cost[t] > 0).map((t) => `${r.cost[t]}${TERRAIN_LETTER[t]}`).join(' ');
  const short = routeShortfall(player, r);
  const text = short ? `${cost} - have ${short.have}${TERRAIN_LETTER[short.terrain]}` : cost;
  const w = text.length * 5.0 + 8;
  return `<g class="routecost${short ? ' routecost--short' : ''}${legal ? ' routecost--legal' : ''}" data-cost="${esc(cost)}" transform="translate(${Math.max(w / 2 + 3, Math.min(MAP.board.w - w / 2 - 3, mid.x))} ${Math.max(9, mid.y - 11)})"><rect x="${-w / 2}" y="-5.5" width="${w}" height="9.5" rx="3"/><text x="0" y="1.6" text-anchor="middle">${esc(text)}</text></g>`;
}

export function renderMap(ctx) {
  const { state, targets } = ctx;
  const flash = ctx.view.flash;
  const W = MAP.board.w;
  const H = MAP.board.h;
  const sl = MAP.slotSize.l;
  const sw = MAP.slotSize.w;
  const out = [];
  out.push(`<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Route map" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`);
  out.push(`<rect class="map__bg" x="0" y="0" width="${W}" height="${H}" rx="6"/><rect class="map__rule" x="5" y="5" width="${W - 10}" height="${H - 10}" rx="3"/>`);

  // Routes
  const player = state.players[state.toAct ?? 0];
  const mapInScope = ctx.interactive && targets.scope.has('map');
  for (const r of MAP.routes) {
    const owner = state.map.routeOwner[r.id];
    const rt = tgt(ctx, 'route', `route:${r.id}`);
    const cls = ['route', owner !== null ? 'route--claimed' : '', rt.cls.trim(), flashCls(ctx, flash.routes, r.id).trim()].filter(Boolean).join(' ');
    const colour = owner !== null ? colourOf(ctx, owner) : null;
    const slots = r.slots
      .map((s) => {
        const letter = TERRAIN_LETTER[s.terrain];
        const t = `translate(${s.x} ${s.y}) rotate(${s.angle})`;
        // A laid tile is the same drawing as a built tile in a train's storage, sitting on a bed of its owner's colour.
        if (colour) {
          return `<g class="slot slot--laid" transform="${t}"><rect class="slot__bed" x="${-sl / 2}" y="${-sw / 2}" width="${sl}" height="${sw}" rx="1.8" style="fill:${colour}"/>${svgTrackTile(s.terrain, 1.25)}</g>`;
        }
        // An unclaimed slot is an empty socket in its terrain colour, waiting for a tile of that kind.
        return `<g class="slot slot--open slot--${s.terrain}" transform="${t}"><rect class="slot__socket" x="${-sl / 2}" y="${-sw / 2}" width="${sl}" height="${sw}" rx="1.8"/><text class="slot__t" x="0" y="2.4" text-anchor="middle" transform="rotate(${-s.angle})">${letter}</text></g>`;
      })
      .join('');
    // A cost badge on a claimable route, and on any unclaimed route that starts at one of the player's railheads.
    let badge = '';
    if (owner === null && mapInScope && (rt.legal || player.railheads.includes(r.a) || player.railheads.includes(r.b))) {
      badge = routeBadge(ctx, r, r.slots[Math.floor(r.slots.length / 2)], rt.legal);
    }
    out.push(`<g class="${cls}" data-route="${r.id}" ${rt.attrs} ${owner !== null ? `data-owner="${owner}"` : ''} style="${flashDelay(ctx)}">${slots}${badge}</g>`);
  }

  // Cities
  const railheadCount = {};
  for (const c of MAP.cities) {
    const ct = tgt(ctx, 'city', `city:${c.id}`);
    const entry = ct.legal ? targets.byTarget.get(`city:${c.id}`) : undefined;
    const move = entry && entry.actions.some((a) => a.type === 'moveTrain');
    const build = entry && entry.actions.some((a) => a.type === 'placeRailwayStation' || a.type === 'placeTelegraphStation');
    const setup = entry && entry.actions.some((a) => a.type === 'placeRailhead');
    const cls = ['city', `city--${c.kind}`, ct.cls.trim(), move ? 'is-move' : '', build ? 'is-build' : '', setup ? 'is-setup' : '', flashCls(ctx, flash.cities, c.id).trim()].filter(Boolean).join(' ');
    const lab = cityLabelPos(c);
    let tollBadge = '';
    if (move) {
      const t = moveTolls(state, state.toAct, entry.actions.find((a) => a.type === 'moveTrain').from, c.id);
      if (t.length) tollBadge = `<text class="city__toll" x="${c.x}" y="${c.y - 12}" text-anchor="middle">toll</text>`;
    }
    out.push(`<g class="${cls}" data-city="${c.id}" ${ct.attrs} style="${flashDelay(ctx)}">
      ${ct.legal ? `<circle class="city__halo" cx="${c.x}" cy="${c.y}" r="${MAP.cityRadius + 4}"/>` : ''}
      <circle class="city__disc" cx="${c.x}" cy="${c.y}" r="${MAP.cityRadius}"/>
      ${c.kind !== 'inland' ? `<circle class="city__ring city__ring--${c.kind}" cx="${c.x}" cy="${c.y}" r="${MAP.cityRadius - 3}"/>` : ''}
      <text class="city__name" x="${lab.x}" y="${lab.y}" text-anchor="${lab.anchor}">${esc(c.name)}</text>${tollBadge}</g>`);
    railheadCount[c.id] = 0;
  }

  // Pony Express tokens still lying on inland cities (taken tokens are gone from the map)
  if (state.modules.pony) {
    for (const id of MAP.inlandCities) {
      if (state.modules.pony.tokens[id] !== true) continue;
      const c = MAP.cityById[id];
      out.push(`<g class="ptoken" data-ptoken="${id}" data-tip="ptoken:${id}" transform="translate(${c.x + 9.5} ${c.y + 8.5})">${svgPonyToken()}</g>`);
    }
  }

  // Buildings
  for (const c of MAP.inlandCities.map((id) => MAP.cityById[id])) {
    const rs = state.map.railwayStation[c.id];
    const ts = state.map.telegraphStation[c.id];
    if (ts !== null && ts !== undefined) {
      out.push(`<g class="building building--telegraph" data-city="${c.id}" data-building="telegraph" transform="translate(${c.x + 7} ${c.y - 14})"><title>${esc(nameOf(ctx, ts))}'s telegraph station in ${esc(c.name)}</title>${buildingGlyph('telegraph', colourOf(ctx, ts))}</g>`);
    }
    if (rs !== null && rs !== undefined) {
      out.push(`<g class="building building--railway" data-city="${c.id}" data-building="railway" transform="translate(${c.x - 15} ${c.y - 14})"><title>${esc(nameOf(ctx, rs))}'s railway station in ${esc(c.name)}</title>${buildingGlyph('railway', colourOf(ctx, rs))}</g>`);
    }
  }

  // Railheads
  for (const p of state.players) {
    p.railheads.forEach((city, idx) => {
      if (!city) return;
      const c = MAP.cityById[city];
      const k = railheadCount[city]++;
      const x = c.x - 10 + k * 11;
      const y = c.y + 11;
      out.push(`<g class="railhead" data-railhead="${p.id}:${idx}" transform="translate(${x} ${y})"><title>${esc(nameOf(ctx, p.id))}'s railhead in ${esc(c.name)}</title>
        <circle class="railhead__plate" r="7.6" style="fill:${colourOf(ctx, p.id)}"/>${svgPiece('railhead', '#fbf5e6', 0, -0.5, 12.5)}</g>`);
    });
  }
  out.push('</svg>');
  return out.join('');
}

/** A building drawn as a small SVG glyph in the owner's colour (or the real piece art, tinted, when it exists). */
function buildingGlyph(kind, colour) {
  const id = kind === 'telegraph' ? 'piece-telegraph-station' : 'piece-railway-station';
  if (isRealArt(id)) return svgArt(id, 0, 0, 12, 11, { tint: colour });
  if (kind === 'telegraph') return `<path d="M6 0 L11 11 L1 11 Z" class="glyph" style="fill:${colour}"/><rect x="5" y="3" width="2" height="8" fill="#fff" opacity=".55"/>`;
  return `<path d="M0 5 L6 0 L12 5 L12 11 L0 11 Z" class="glyph" style="fill:${colour}"/><rect x="4.5" y="6" width="3" height="5" fill="#fff" opacity=".6"/>`;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export function renderLog(ctx) {
  const items = ctx.log.slice(-120).reverse().map((e) => entryHtml(e, ctx.state));
  return `<div class="log__head">Game log</div><ol class="log__list" data-field="log">${items.join('')}</ol>`;
}

// ---------------------------------------------------------------------------
// The one message (toast)
// ---------------------------------------------------------------------------

/** The refusal / notice message, or '' when there is none. It lives outside the re-rendered regions, so it does not flicker. */
export function renderToast(notice) {
  if (!notice) return '';
  return `<div class="toast toast--${esc(notice.kind)}" role="alert" data-field="notice" data-notice-id="${notice.id}">
      <span class="toast__text">${esc(notice.text)}</span>
      <button type="button" class="toast__close" data-ui="notice-close" aria-label="Dismiss the message" title="Dismiss (Escape)">&times;</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Hand-over cover, end screen
// ---------------------------------------------------------------------------

export function renderCover(ctx, pid) {
  const colour = colourOf(ctx, pid);
  const name = nameOf(ctx, pid);
  return `<div class="cover__card" style="--pc:${colour}" role="dialog" aria-modal="true" aria-label="Pass the device">
    <div class="cover__piece" aria-hidden="true">${piece('worker', colour)}</div>
    <div class="cover__big">Pass the device to</div>
    <div class="cover__name" data-field="cover-name">${esc(name)}</div>
    <button type="button" class="btn btn--primary btn--big" data-ui="cover-ok" autofocus>I am ${esc(name)}: show the board</button>
    <div class="cover__small">Nothing is hidden in this game. This screen only makes sure the right person is looking.</div>
  </div>`;
}

/** "Anna", "Anna and Ben", "Anna, Ben and Cara". */
function nameList(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function renderEnd(ctx) {
  const { state } = ctx;
  const result = scoreGame(state);
  const ranked = result.ranking.map((id) => result.players.find((p) => p.id === id));
  // A source nobody scored from is left out: the table then reads as the sum it is.
  const sources = Object.keys(ranked[0].bySource).filter((src) => ranked.some((p) => p.bySource[src] !== 0));
  const winners = ranked.filter((p) => p.rank === ranked[0].rank);
  const shared = winners.length > 1;
  const winnerNames = winners.map((p) => nameOf(ctx, p.id));
  const badge = (p) => {
    const seat = ctx.seats[p.id];
    return `<span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>`;
  };
  const podium = ranked
    .map(
      (p) => `<li class="podium__seat${p.rank === ranked[0].rank ? ' is-winner' : ''}" style="--pc:${colourOf(ctx, p.id)}">
        <span class="podium__rank">${shared && p.rank === ranked[0].rank ? '=' : ''}${p.rank}</span>
        <span class="podium__who"><span class="podium__name"><span class="score__dot"></span> ${esc(nameOf(ctx, p.id))}</span>${badge(p)}</span>
        <span class="podium__vp"><b>${p.total}</b> VP</span>
      </li>`,
    )
    .join('');
  const rows = sources
    .map((src) => `<tr><th scope="row">${esc(ctx.labels.vp[src] ?? src)}</th>${ranked.map((p) => `<td data-source="${src}"${p.bySource[src] === 0 ? ' class="is-zero"' : ''}>${p.bySource[src]}</td>`).join('')}</tr>`)
    .join('');
  const sums = ranked
    .map((p) => {
      const terms = sources.map((src) => p.bySource[src]).filter((v) => v !== 0);
      return `<td class="end__sum">${terms.length > 1 ? `${terms.join(' + ').replace(/\+ -/g, '- ')} = ${p.total}` : ''}</td>`;
    })
    .join('');
  return `<div class="end__card" data-screen="end" role="dialog" aria-modal="true" aria-label="Final scores">
    <header class="end__head" style="--pc:${colourOf(ctx, winners[0].id)}">
      <p class="end__kicker">The game is over</p>
      <h2 class="end__title" data-field="winner">${shared ? `${esc(nameList(winnerNames))} share the victory` : `${esc(winnerNames[0])} wins`}</h2>
      <p class="end__reason" data-field="end-reason">${esc(ctx.labels.endReason[result.endReason] ?? '')}</p>
    </header>
    <ol class="podium" aria-label="Final ranking">${podium}</ol>
    <div class="end__scroll">
    <table class="end__table" data-field="final-table">
      <thead><tr><th scope="col">Victory points by source</th>${ranked
        .map((p) => `<th scope="col" class="end__col" style="--pc:${colourOf(ctx, p.id)}" data-rank="${p.rank}" data-player="${p.id}"><span class="score__dot"></span> ${esc(nameOf(ctx, p.id))}</th>`)
        .join('')}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="end__totalrow"><th scope="row">Total</th>${ranked.map((p) => `<td class="end__total" data-total="${p.id}"><b>${p.total}</b></td>`).join('')}</tr>
      <tr class="end__sumrow"><th scope="row">The sum</th>${sums}</tr>
      <tr class="end__aux"><th scope="row">Tie-break 1: buildings on the map</th>${ranked.map((p) => `<td>${p.tieBreak.buildings}</td>`).join('')}</tr>
      <tr class="end__aux"><th scope="row">Tie-break 2: slots in routes owned</th>${ranked.map((p) => `<td>${p.tieBreak.ownedSlots}</td>`).join('')}</tr></tfoot>
    </table>
    </div>
    <p class="end__tie" data-field="tie-break">${esc(ctx.labels.tieBreak[result.decidedBy] ?? '')}</p>
    <div class="end__meta">Seed <b data-field="seed">${esc(state.config.seed)}</b> <span class="end__rules">Rules: ${variantChips(state.variants, 'end__chips')}</span></div>
    <div class="end__buttons">
      <button type="button" class="btn btn--primary btn--big" data-ui="again-new-seed">Play again</button>
      <button type="button" class="btn" data-ui="back-to-setup">Change set-up</button>
      <button type="button" class="btn" data-ui="again-same-seed" title="The same seed and seats: the cards and the seat order come out the same">Replay this seed</button>
      <button type="button" class="btn" data-ui="view-board">Look at the final board</button>
    </div>
  </div>`;
}
