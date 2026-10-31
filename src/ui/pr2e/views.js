// views.js - the screens of the "Pacific Rails, second edition" ruleset.
//
// Each export replaces the page's own renderer for one region when the game is
// played by the second edition's rules (src/ui/ruleset-views.js; main.js `render`). A view takes the render context and returns
// HTML. The regions it does not replace (the header, the hand-over cover, the
// message) are the page's own and work as they are.
//
// The views read the engine from the render context (`ctx.engine`) rather than from
// src/ui/active-ruleset.js, and touch no DOM when the file loads. Nothing here decides what is legal: a
// thing is drawn lit only because the engine lists an action for it.

import { art, artSize, piece, svgPiece, svgArt, isRealArt, hasArt, trackTile } from '../art.js';
import { entryHtml } from '../log-html.js';
import { mapOpen, mapFrame, routeLine, slotOpen, slotLaid, laidTerrain, cityShapes, cityOuterR, cityLabels, pieceSpots } from '../map-draw.js';
import {
  esc,
  plural,
  nameList,
  ITEM_ART,
  DISTRICT_ART,
  GOAL_ART,
  CONGRESS_CELLS,
  upgradeTokenArt,
  costLetters,
  tilesText,
  specialSentence,
  flashCls,
  flashDelay,
  tgt,
  variantChips,
  wildSlotHint,
} from './common.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const colourOf = (ctx, pid) => ctx.who(pid).colour;
const nameOf = (ctx, pid) => ctx.who(pid).name;

const TERRAIN_LETTER = { ground: 'G', tunnel: 'T', bridge: 'B' };

function actionButton(ctx, action, label, cls = '', extra = '') {
  return `<button type="button" class="btn ${cls}" data-akey="${esc(ctx.keyOf(action))}" data-legal="1" ${extra}>${esc(label)}</button>`;
}

/** The engine's reason an action is not available, as one sentence (null when it is). Same two-layer rule as explain.js. */
function whyNot(ctx, action) {
  const E = ctx.engine;
  const now = E.getBlockReason(ctx.state, action);
  if (now === null) return null;
  const structural = E.getStructuralBlockReason(ctx.state, action);
  return structural === null ? `Not at this point of your turn: ${now}` : structural;
}

/** A small number badge for a piece count, "[icon] 3". */
function num(icon, n, title, cls = '') {
  return `<span class="pstat${n === 0 ? ' is-zero' : ''} ${cls}" title="${esc(title)}: ${n}">${icon}<b>${n}</b></span>`;
}

// ---------------------------------------------------------------------------
// The players, and the four goals in play
// ---------------------------------------------------------------------------

function goalsHtml(ctx) {
  const E = ctx.engine;
  const { state } = ctx;
  const goals = E.goalsInPlay(state);
  const vp = ctx.engine.getConstants(state).SCORING.goalVp;
  const rows = goals
    .map((goal) => {
      const st = E.goalStandings(state, goal);
      const lead = st.places.indexOf(0);
      const pic = GOAL_ART[goal.metric];
      const measures = state.players
        .map((p) => {
          const c = ctx.who(p.id);
          const value = st.values[p.id];
          return `<span class="pgoal__m${lead === p.id ? ' is-lead' : ''}" style="--pc:${esc(c.colour)}" data-player="${p.id}" title="${esc(`${c.name}: ${E.describeProgress(state, p.id, goal).text}`)}"><i class="score__dot"></i>${value}</span>`;
        })
        .join('');
      return `<li class="pgoal${lead >= 0 ? ' has-leader' : ''}" data-goal="${esc(goal.id)}" data-metric="${esc(goal.metric)}" data-leader="${lead}" data-tip="goal:${esc(goal.id)}">
        ${pic ? art(pic, { cls: 'pgoal__img', label: goal.name }) : ''}
        <span class="pgoal__body"><span class="pgoal__name">${esc(goal.name)}</span><span class="pgoal__ms">${measures}<span class="pgoal__lead" data-field="goal-leader">${lead >= 0 ? `<b>${esc(nameOf(ctx, lead))}</b> leads` : 'no leader'}</span></span></span>
      </li>`;
    })
    .join('');
  return `<section class="pgoals" data-field="goals" aria-label="Scoring goals in play"><h3 class="pgoals__title">Scoring goals <small>${vp} VP to the sole leader</small></h3><ul class="pgoals__list">${rows}</ul></section>`;
}

/** The players in seat order with the numbers that matter, then the four goals in play. */
export function renderScores(ctx) {
  const E = ctx.engine;
  const { state } = ctx;
  const best = Math.max(...state.players.map((p) => E.totalVp(p)));
  const cards = state.players
    .map((p) => {
      const seat = ctx.seats[p.id];
      const acting = state.toAct === p.id;
      const isTurn = state.turn.player === p.id;
      const viewed = ctx.viewer === p.id;
      const vp = E.totalVp(p);
      const leading = best > 0 && vp === best;
      const name = nameOf(ctx, p.id);
      const buildings = E.buildingCount(state, p.id);
      const houses = E.districtHouseCount(state, p.id);
      const ic = (id, label) => art(id, { cls: 'icon icon--pstat', label });
      const K = E.getConstants(state);
      return `<button type="button" class="score${acting ? ' is-acting' : ''}${isTurn ? ' is-turn' : ''}${viewed ? ' is-viewed' : ''}${leading ? ' is-leading' : ''}" data-ui="focus:${p.id}" data-player="${p.id}" style="--pc:${colourOf(ctx, p.id)}" aria-pressed="${viewed}" title="${viewed ? `${esc(name)}'s player board is shown under the map` : `Show ${esc(name)}'s player board under the map`}">
        <span class="score__top">
          <span class="score__dot"></span>
          <span class="score__name">${esc(name)}</span>
          <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
          ${isTurn ? '<span class="score__flag">turn</span>' : ''}${acting && !isTurn && state.turn.number > 0 ? '<span class="score__flag score__flag--ask">asked</span>' : ''}
          <span class="score__vp" data-vp="${p.id}">${leading ? '<span class="score__lead" title="In the lead" aria-label="In the lead">&#9733;</span>' : ''}${vp}<small> VP</small></span>
        </span>
        <span class="score__stats">
          ${num(ic('icon-building', 'Buildings'), buildings, 'Railway and telegraph stations on the map')}
          ${num(art('pr2e-congress-reward-col4-house-or-upgrade', { cls: 'icon icon--pstat', label: 'District houses' }), houses, 'District houses on building sites')}
          ${num(ic('icon-carriage', 'Carriages'), E.carriageCount(p), 'Carriages')}
          ${num(trackTile('ground', { cls: 'tile--mini' }), p.builtTiles.ground + p.builtTiles.tunnel + p.builtTiles.bridge, `Built tiles: ${p.builtTiles.ground} Ground, ${p.builtTiles.tunnel} Tunnel, ${p.builtTiles.bridge} Bridge`, 'pstat--tile')}
        </span>
        <span class="score__stats">
          ${num(ic('resource-coin-v2', 'Coins'), p.coins, 'Coins')}
          ${['iron', 'wood', 'gunpowder'].map((r) => num(ic(ITEM_ART[r], K.NAMES[r]), p.resources[r], K.NAMES[r])).join('')}
          ${num(ic('token-cowboy-hat-v2', 'Cowboy hats'), p.hats, 'Cowboy hats')}
        </span>
      </button>`;
    })
    .join('');
  return `<h2 class="region__title">Players <small>click one to see its player board</small></h2>${cards}${goalsHtml(ctx)}`;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** One sentence under the prompt saying what to do and where, per kind of decision. */
function hintFor(ctx) {
  const { frame, state } = ctx;
  const kind = frame ? frame.kind : '';
  const E = ctx.engine;
  switch (kind) {
    case 'setupProduction':
      return 'Click a house track on your player board: its +1 space starts empty, so it produces 2.';
    case 'setupRailhead':
      return 'Click a start city on the map to put a train there. Your second train goes on the opposite side of the map.';
    case 'workerStep':
      return 'Click a lit worker space to place a worker, one of your own workers to take it off the grid, or the centre ring of a blocked district to displace. Hover anything for the reason it is or is not open to you.';
    case 'chooseDistrict':
      return 'Click one of the lit districts: the badge shows the multiplier and what you would get. Choose how many cowboy hats to spend first if you want a bigger multiplier. At the Lay Track or Hire Specialists district you choose Lay or Hire.';
    case 'specialAction':
      if (frame.special === 'districtHouse') return `${specialSentence(E, state, 'districtHouse')} Click the three building sites of a Collect district, or decline.`;
      if (frame.special === 'upgrade') return `${specialSentence(E, state, 'upgrade')} Pick a token and the carriage it goes in (a new token goes in your leftmost carriage with a specialist and no token), or decline.`;
      return `${specialSentence(E, state, frame.special)} Click a lit city on the map, or decline.`;
    case 'boardActivation': {
      const step = frame.steps[frame.index];
      if (step && step.type === 'financier') return 'Financier step: click a lit Congress column to pay its Coins and take its reward, Reset the senators, or skip the step.';
      return 'This builds track tiles into your storage. Nothing goes onto the map until you take Lay Track.';
    }
    case 'congressPlacement':
      return frame.column === 'K5'
        ? 'Congress column K5: click the building sites of a Collect district to place a district house, or install an upgrade token below.'
        : 'Congress column K7: click a lit city for a railway station or a telegraph station (one of each at most; stop after the first if you wish).';
    case 'wildSlot':
      return wildSlotHint(E, state) ?? 'Choose which kind of built tile goes in the "any tile" slot.';
    case 'chooseBuiltTile':
      return 'Take a built tile of your choice. It goes into your storage, not onto the map.';
    case 'chooseResource':
      return 'Take a resource of your choice. A Coin is a resource here and takes a place in storage.';
    case 'hire':
      return 'Hire into the leftmost empty space of your carriages. Hiring costs nothing unless Tycoon Mode is on.';
    case 'chooseFreeSpecialist':
      return 'Your first railway station placed by laying track brings carriage 1 and a free specialist of your choice.';
    case 'lay':
      return frame.path === null
        ? 'Lay Track: click one of your trains on the map to start a lay. You then pick the routes one at a time; laid routes are travelled over, unlaid ones are laid with your built tiles.'
        : 'Click the next route on the map (or below), or end the lay where it stands. Nothing is paid or scored until you end it.';
    case 'placeBuildings':
      return frame.optional
        ? `You arrived in ${E.MAP.cityById[frame.city].name}: place a building there, or none.`
        : `You arrived in ${E.MAP.cityById[frame.city].name} and can build there, so you must place one building: a railway station (a house leaves your player board, raising production) or a telegraph station (scores VP).`;
    case 'discard':
      return 'Your storage is over capacity. Discard items until it fits (Coins and built tiles count too).';
    default:
      void state;
      return '';
  }
}

/** A panel of bespoke controls for a decision with no board target of its own. */
function renderPanel(ctx, panel) {
  const { state } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const items = panel.items
    .map((item) => {
      const a = item.action;
      let sub = item.sub ?? '';
      let label = item.shortLabel ?? item.label;
      let pic = item.art ? art(item.art, { cls: 'icon icon--panel', label: label }) : '';
      if (item.building === 'railwayStation') {
        const before = E.production(state, state.toAct, a.houseTrack);
        sub = `A house leaves your ${K.NAMES[a.houseTrack]} track: production ${before} to ${before + 1}.`;
        label = `Railway station: ${K.NAMES[a.houseTrack]} track`;
      } else if (item.building === 'telegraphStation') {
        const vp = E.nextTelegraphVp(state, state.toAct);
        sub = vp === null ? '' : `Scores ${vp} VP.`;
        label = 'Telegraph station';
        pic = '';
      } else if (item.upgradeToken) {
        const tokenArt = upgradeTokenArt(item.upgradeToken);
        pic = tokenArt ? art(tokenArt, { cls: 'icon icon--token', label: item.upgradeToken }) : '';
        const c = state.players[state.toAct].train.specialistCarriages[a.carriage - 1];
        label = `${item.upgradeToken} in carriage ${a.carriage}`;
        sub = c && c.upgrade !== null ? `Replaces ${c.upgrade} (no VP for a replacement)` : '';
      }
      return `<button type="button" class="btn btn--panel" data-akey="${esc(item.key)}" data-legal="1" title="${esc(item.label)}">
        ${pic}
        <span class="btn__text"><span class="btn__label">${esc(label)}</span>${sub ? `<span class="btn__sub">${esc(sub)}</span>` : ''}</span>
      </button>`;
    })
    .join('');
  return `<section class="panel" data-panel="${esc(panel.id)}"><div class="panel__title">${esc(panel.title)}</div>${panel.hint ? `<div class="panel__hint">${esc(panel.hint)}</div>` : ''}<div class="panel__items">${items}</div></section>`;
}

/** The lay being built: the path, what it will cost and score, the tolls and the building owed at the end. */
function layPlanHtml(ctx) {
  const { state, frame } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const path = frame.path;
  const me = state.players[frame.player];
  if (path === null) {
    return `<div class="layplan" data-field="lay-plan"><div class="layplan__title">Your lay${frame.taken > 0 ? ` (lay ${frame.taken + 1} of up to ${frame.taken + frame.remaining})` : ` (up to ${frame.remaining} lay${frame.remaining === 1 ? '' : 's'} this action)`}</div>
      <div class="layplan__row">Built tiles in storage: <b>${esc(tilesText(K.NAMES, me.builtTiles))}</b>.</div></div>`;
  }
  const pv = E.previewLay(state);
  const names = path.cities.map((c) => E.MAP.cityById[c].name);
  const steps = path.routes
    .map((id, i) => {
      const r = E.MAP.routeById[id];
      const laid = state.map.routeOwner[id] !== null;
      const seg = pv.segments.find((s) => s.route === id);
      return `<li class="layplan__step" data-route="${esc(id)}" data-laid="${laid ? 1 : 0}"><span class="layplan__n">${i + 1}</span> ${esc(names[i])} to ${esc(names[i + 1])}: ${laid ? 'travel' : `lay ${esc(costLetters(r.cost))}${seg ? `, ${seg.perSlot} VP a slot (counted at ${esc(E.MAP.cityById[seg.scoringCity].name)})` : ''}`}</li>`;
    })
    .join('');
  const dest = path.cities[path.cities.length - 1];
  const tilesLine = pv.slots > 0 ? `Tiles used: <b>${esc(tilesText(K.NAMES, pv.tiles))}</b>; you hold ${esc(tilesText(K.NAMES, me.builtTiles))}.` : 'No tiles used: all of it is laid track.';
  let vpLine = 'This lay scores no track VP.';
  if (pv.completes) vpLine = `This lay <b>completes the transcontinental line</b>: 3 VP for each of its ${pv.slots} slots = <b>${pv.completionVp} VP</b>, and the game will end after every seat has had its last turn.`;
  else if (pv.slots > 0) vpLine = `Track VP if you end here: <b>${pv.trackVp}</b> (${pv.slots} slot${pv.slots === 1 ? '' : 's'}).`;
  const tolls = pv.tolls.length
    ? `Tolls: ${pv.tolls.map((t) => `${esc(nameOf(ctx, t.owner))} scores 3 VP (${t.kind === 'railwayStation' ? 'railway' : 'telegraph'} station in ${esc(E.MAP.cityById[t.city].name)})`).join('; ')}.`
    : 'No tolls: the cities entered hold no building of another player.';
  const able = E.canPlaceArrivalBuilding(state, frame.player, dest);
  const building = able
    ? `At ${esc(E.MAP.cityById[dest].name)} you ${state.variants.arrivalBuilding === 'optional' ? 'may' : '<b>must</b>'} place one building: a railway station${E.telegraphsLeft(state, frame.player) > 0 ? ' or a telegraph station' : ''}.`
    : `No building at ${esc(E.MAP.cityById[dest].name)}: ${E.MAP.cityById[dest].kind === 'inland' ? 'you cannot place one there' : 'buildings never go in a start city'}.`;
  const endable = E.getBlockReason(state, { type: 'endLay' }) === null;
  return `<div class="layplan" data-field="lay-plan" data-endable="${endable ? 1 : 0}">
      <div class="layplan__title">Your lay, train ${path.train + 1}: ${esc(names.join(' to '))}</div>
      <ol class="layplan__steps">${steps}</ol>
      <div class="layplan__row" data-field="lay-tiles">${tilesLine}</div>
      <div class="layplan__row" data-field="lay-vp">${vpLine}</div>
      <div class="layplan__row" data-field="lay-tolls">${tolls}</div>
      <div class="layplan__row" data-field="lay-building">${building}</div>
      ${endable ? '' : '<div class="layplan__row layplan__row--warn">It cannot end here yet: a lay ends with a route you lay, or with laid track only if it reaches an empty inland city where you can build.</div>'}
    </div>`;
}

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

export function renderPrompt(ctx) {
  const { state, targets, view } = ctx;
  const E = ctx.engine;
  if (state.phase === 'ended') {
    return `<div class="prompt prompt--end"><div class="prompt__main">The game is over.</div><div class="prompt__buttons"><button type="button" class="btn btn--primary" data-ui="show-end">Show the final scores</button></div></div>`;
  }
  const decision = E.describeDecision(state);
  const seat = ctx.seats[state.toAct];
  const pc = colourOf(ctx, state.toAct);
  const lines = [];
  lines.push(`<div class="prompt__who" style="--pc:${pc}">
      <span class="score__dot"></span>
      <span class="prompt__name" data-field="to-act">${esc(nameOf(ctx, state.toAct))}</span>
      <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
      ${state.turn.number > 0 ? `<span class="prompt__turn">Turn ${state.turn.number}${state.turn.player !== null && state.turn.player !== state.toAct ? ` (${esc(nameOf(ctx, state.turn.player))}'s turn)` : ''}</span>` : '<span class="prompt__turn">Setup</span>'}
    </div>`);
  lines.push(`<div class="prompt__main" data-field="prompt" data-kind="${esc(decision ? decision.kind : '')}">${esc(decision ? decision.prompt : '')}</div>`);

  if (!seat.human) {
    lines.push(`<div class="prompt__thinking" data-field="thinking" role="status"><span class="spinner" aria-hidden="true"></span> ${esc(nameOf(ctx, state.toAct))} (${esc(seat.label)}) is ${view.paused ? 'paused' : 'thinking'}...</div>`);
  } else if (ctx.interactive) {
    // While a lay is being built the plan says what the hint would, and the buttons come first so End the lay is never scrolled away.
    const inLay = !!(ctx.frame && ctx.frame.kind === 'lay' && ctx.frame.path !== null);
    const hint = inLay ? '' : hintFor(ctx);
    if (hint) lines.push(`<div class="prompt__hint">${esc(hint)}</div>`);

    // The cowboy hats to spend on the district choice: 0, 1 or 2 (P11.2).
    if (targets.districts.anyDistrict && targets.districts.maxHats > 0) {
      const chosen = targets.districts.selectedHats ?? 0;
      const buttons = Array.from({ length: targets.districts.maxHats + 1 }, (_, n) => `<button type="button" class="btn btn--small${chosen === n ? ' is-on' : ''}" data-ui="hats:${n}" aria-pressed="${chosen === n}" data-hats="${n}">${n === 0 ? 'No hat' : plural(n, 'hat', 'hats')}</button>`).join('');
      lines.push(`<div class="hat-pick" data-field="hat-pick" role="group" aria-label="Cowboy hats to spend">${art('token-cowboy-hat-v2', { cls: 'icon icon--inline', label: 'cowboy hat' })}<span>Spend cowboy hats for +1 multiplier each:</span>${buttons}</div>`);
    }

    // What each lit district leads to (for the hats chosen).
    if (targets.districts.anyDistrict) {
      const items = [];
      for (const [key] of targets.byTarget) {
        if (!key.startsWith('district:')) continue;
        const d = key.slice(9);
        const pv = targets.districts.previews[d];
        const here = pv && pv.byHats ? pv.byHats[targets.districts.selectedHats ?? 0] : null;
        if (here && here.sentence) items.push(`<li data-consequence="${esc(d)}">${esc(here.sentence)}</li>`);
      }
      if (items.length) lines.push(`<div class="consequences" data-field="consequences"><div class="consequences__title">What your choice leads to</div><ul>${items.join('')}</ul></div>`);
    }

    const buttons = [];
    for (const a of targets.primary) buttons.push(actionButton(ctx, a, ctx.describe(a), 'btn--primary'));
    for (const a of targets.secondary) buttons.push(actionButton(ctx, a, ctx.describe(a), 'btn--secondary'));
    if (ctx.hasPending) buttons.push(`<button type="button" class="btn btn--secondary" data-ui="cancel" title="Clear what you have selected (Escape)">Cancel${ctx.mode === 'choose' ? '' : ' the hats'}</button>`);
    if (buttons.length) lines.push(`<div class="prompt__buttons">${buttons.join('')}</div>`);
    if (ctx.frame && ctx.frame.kind === 'lay') lines.push(layPlanHtml(ctx));

    if (ctx.mode === 'choose' && ctx.modeData) {
      lines.push(`<div class="choice" data-field="choice"><div class="choice__title">${esc(ctx.modeData.title)}</div>${ctx.modeData.actions.map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--choice')).join('')}</div>`);
    }
    for (const panel of targets.panels) lines.push(renderPanel(ctx, panel));

    const generic = targets.generic;
    if (generic.length) {
      lines.push(`<div class="generic" data-field="generic"><div class="generic__title">${view.generic ? 'Choose a move' : 'Other moves available'}</div>${generic.map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--generic')).join('')}</div>`);
    }
  }

  if (ctx.interactive && !view.generic && targets.all.length) {
    lines.push(`<details class="allmoves" ${view.showAllMoves ? 'open' : ''}><summary data-ui="all-moves">All ${targets.all.length} legal moves</summary>${
      view.showAllMoves ? targets.all.map((a) => actionButton(ctx, a, ctx.describe(a), 'btn--generic btn--tiny')).join('') : ''
    }</details>`);
  }
  lines.push(lastMove(ctx));
  return `<div class="prompt">${lines.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// The action grid
// ---------------------------------------------------------------------------

/** Where the building sites sit on a district picture: x of the three sites, and y as a share of the displayed tile (the picture is cropped from the top). */
const SITE_X = [30.5, 50.5, 70];

function siteY(tileId) {
  const size = artSize(DISTRICT_ART[tileId]);
  if (!size) return 55;
  const shown = 480 / 290; // the tile's box: width over height (style.css .pd__art)
  const naturalH = size.h / size.w; // as a share of the width
  const boxH = 1 / shown;
  if (naturalH <= boxH) return 62;
  const y = (0.62 * naturalH - (naturalH - boxH)) / boxH;
  return Math.round(y * 1000) / 10;
}

const SPECIAL_SHORT = {
  telegraphStation: (cost) => `${cost}: telegraph station`,
  districtHouse: (cost, vp) => `${cost}: district house, ${vp} VP`,
  upgrade: (cost, vp) => `${cost}: upgrade token, ${vp} VP`,
  railwayStation: (cost) => `${cost}: railway station`,
};

export function renderGrid(ctx) {
  const { state, targets } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const flash = ctx.view.flash;
  const cells = [];
  const pos = Object.fromEntries(E.GRID.positions.map((p) => [p.id, p]));
  const hats = targets.districts.selectedHats ?? 0;

  for (const d of E.DISTRICT_IDS) {
    const p = pos[d];
    const tileId = state.grid.tiles[d];
    const info = E.GRID.districtTiles[tileId];
    const dt = tgt(ctx, 'district', `district:${d}`);
    const pv = dt.legal ? targets.districts.previews[d] : null;
    const here = pv && pv.byHats ? pv.byHats[hats] ?? pv.byHats[0] : null;
    const ct = tgt(ctx, 'centre', `centre:${d}`);
    const centreOwner = state.grid.centres[d];
    const interactiveCls = ctx.interactive && !ctx.view.generic;
    const sites = state.grid.sites[d];
    const y = sites ? siteY(tileId) : 0;
    let siteHtml = '';
    if (sites) {
      const st = tgt(ctx, 'site', `site:${d}`);
      const discs = sites
        .map((owner, i) => `<span class="pd__site${owner !== null ? ' is-taken' : ''}" data-site="${d}:${i}" style="left:${SITE_X[i]}%;top:${y}%${owner !== null ? `;--pc:${colourOf(ctx, owner)}` : ''}" title="${owner !== null ? esc(`${nameOf(ctx, owner)}'s district house`) : 'Empty building site'}">${owner !== null ? piece('house', colourOf(ctx, owner)) : ''}</span>`)
        .join('');
      siteHtml = `<button type="button" class="pd__sites${st.cls}" data-district-sites="${d}" ${st.state === 'out' ? '' : st.attrs} aria-label="Building sites of ${esc(info.name)}" style="top:${Math.max(0, y - 13)}%"></button>${discs}`;
    }
    let special = '';
    if (info.special) {
      const cost = E.formatCost(state, K.GRID.specialActions[info.special].cost);
      const vp = K.SCORING.specialActionVp[info.special];
      special = `<span class="pd__special" data-special="${info.special}" data-tip="special:${info.special}">${esc(SPECIAL_SHORT[info.special](cost, vp))}</span>`;
    }
    let modeButtons = '';
    if (info.family === 'layOrHire' && dt.legal && here) {
      modeButtons = `<span class="pd__modes" data-field="lay-or-hire">${['lay', 'hire']
        .map((mode) => {
          const m = here.modes[mode];
          if (!m || !m.action) return '';
          return `<button type="button" class="btn btn--tiny btn--lit" data-akey="${esc(ctx.keyOf(m.action))}" data-legal="1" data-mode="${mode}" title="${esc(`${mode === 'lay' ? 'Lay Track' : 'Hire Specialists'}: ${m.outcome}`)}">${mode === 'lay' ? 'Lay Track' : 'Hire'}</button>`;
        })
        .join('')}</span>`;
    }
    const outcomes = here && info.family !== 'layOrHire' ? here.outcome : '';
    cells.push(`<div class="district pr-district${dt.cls}${flashCls(ctx, flash.districts, d)}" data-district="${d}" data-tile="${tileId}" ${interactiveCls ? `${dt.attrs} role="button" tabindex="0" aria-label="${esc(info.name)}"` : `data-tip="district:${d}"`}
      style="grid-row:${2 * p.row - 1};grid-column:${2 * p.col - 1};${flashDelay(ctx)}">
        ${art(DISTRICT_ART[tileId], { cls: 'pd__art', label: info.name })}
        <span class="pd__name"><b>${esc(info.name)}</b>${special}</span>
        ${here ? `<span class="district__badge" data-multiplier="${here.multiplier}"><b>x${here.multiplier}</b>${outcomes ? `<small>${esc(outcomes)}</small>` : ''}${here.sentence ? '<small class="district__forced">then automatic</small>' : ''}</span>` : ''}
        ${modeButtons}
        ${siteHtml}
        <button type="button" class="centre${centreOwner !== null ? ' is-occupied' : ''}${ct.cls}" data-centre="${d}" ${ct.state === 'out' ? '' : ct.attrs}
          aria-label="Centre of ${esc(info.name)}"
          style="${centreOwner !== null ? `--pc:${colourOf(ctx, centreOwner)}` : ''}">${centreOwner !== null ? piece('worker', colourOf(ctx, centreOwner)) : ''}</button>
      </div>`);
  }

  for (const w of E.GRID.workerSpaces) {
    const [a, b] = w.between;
    const pa = pos[a];
    const pb = pos[b];
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

  return `<div class="grid3 grid3--pr2e" role="group" aria-label="Action grid: nine districts and twelve worker spaces">${cells.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// The Congress panel: 8 columns built from the individual cells
// ---------------------------------------------------------------------------

export function renderCongress(ctx) {
  const { state } = ctx;
  const E = ctx.engine;
  const frame = ctx.frame;
  const columns = E.congressColumns(state);
  const financier = !!(frame && frame.kind === 'boardActivation' && frame.steps[frame.index] && frame.steps[frame.index].type === 'financier');
  const down = columns.filter((c) => !c.reset && c.down).length;
  const cols = columns
    .filter((c) => !c.reset)
    .map((c) => {
      const ct = tgt(ctx, 'congress', `congress:${c.id}`);
      const cell = CONGRESS_CELLS[c.id];
      const tier = c.cost >= 3 ? 'high' : c.cost === 2 ? 'mid' : 'low';
      const senator = art('pr2e-senator-token', { cls: 'pc__senator', label: 'Senator' });
      let why = '';
      if (ct.state === 'illegal' && !ctx.view.generic) {
        const reason = c.down ? 'Its senator is down: it stays closed until a Reset.' : whyNot(ctx, { type: 'takeCongressColumn', column: c.id });
        why = reason ? `<span class="pc__why" data-field="congress-why">${esc(reason)}</span>` : '';
      }
      return `<button type="button" class="pc${c.down ? ' is-down' : ''}${ct.cls}${flashCls(ctx, ctx.view.flash.congress, c.id)}" data-entry="${c.id}" data-senator="${c.down ? 'down' : 'up'}" data-cost="${c.cost}" ${ct.attrs} style="${flashDelay(ctx)}" aria-label="Congress column ${c.id}: ${esc(cell.text)}, ${plural(c.cost, 'Coin', 'Coins')}${c.down ? ', senator down' : ''}">
        <span class="pc__cost pc__cost--${tier}">${art('resource-coin-v2', { cls: 'pc__coin', label: 'Coin' })}<b>${c.cost}</b></span>
        <span class="pc__cell pc__cell--top">${art('pr2e-congress-top-1vp', { cls: 'pc__img', label: '1 VP' })}${c.down ? '' : senator}</span>
        <span class="pc__cell pc__cell--reward">${art(cell.art, { cls: 'pc__img', label: cell.text })}${cell.number ? `<span class="pc__number" aria-hidden="true">${cell.number}</span>` : ''}${c.down ? senator : ''}</span>
        <span class="pc__text">${esc(cell.short)}</span>
        ${why}
      </button>`;
    })
    .join('');
  const resetCol = columns.find((c) => c.reset);
  const rt = tgt(ctx, 'congress', 'congress:KR');
  let resetWhy = '';
  if (rt.state === 'illegal' && !ctx.view.generic) {
    const reason = down === 0 ? 'No senator is down: nothing to reset.' : whyNot(ctx, { type: 'resetSenators' });
    resetWhy = reason ? `<span class="pc__why" data-field="congress-why">${esc(reason)}</span>` : '';
  }
  const reset = `<button type="button" class="pc-reset${down === 0 ? ' is-idle' : ''}${rt.cls}" data-entry="KR" ${rt.attrs}>
      ${art('icon-reset', { cls: 'icon icon--inline', label: '' })}<span><b>Reset</b> (${plural(resetCol.cost, 'Coin', 'Coins')}): senators up, 1 VP each${down > 0 ? ` (${down} VP now)` : ''}</span>${resetWhy}
    </button>`;
  return `<div class="congress__head"><h2 class="region__title">Congress <small data-field="financier-step">${financier ? 'a <b>Financier step</b> is waiting: choose a column' : `Financier step: one column`}</small></h2>${reset}</div>
    <div class="pc-panel" data-field="congress-panel">${cols}</div>`;
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

function routeBadge(ctx, r, mid, laid, legal) {
  const { state } = ctx;
  const E = ctx.engine;
  const player = state.players[state.toAct];
  const cost = costLetters(r.cost);
  const short = laid ? null : E.routeShortfall(player, r);
  const lacks = short ? ['ground', 'tunnel', 'bridge'].filter((t) => short[t] > 0) : [];
  const text = laid ? 'travel' : lacks.length ? `${cost} - short ${lacks.map((t) => `${short[t]}${TERRAIN_LETTER[t]}`).join(' ')}` : cost;
  const w = text.length * 5 + 8;
  return `<g class="routecost${lacks.length ? ' routecost--short' : ''}${legal ? ' routecost--legal' : ''}" data-cost="${esc(cost)}" transform="translate(${Math.max(w / 2 + 3, Math.min(E.MAP.board.w - w / 2 - 3, mid.x))} ${Math.max(9, mid.y - 11)})"><rect x="${-w / 2}" y="-5.5" width="${w}" height="9.5" rx="3"/><text x="0" y="1.6" text-anchor="middle">${esc(text)}</text></g>`;
}

function buildingGlyph(kind, colour) {
  const id = kind === 'telegraph' ? 'piece-telegraph-station' : 'piece-railway-station';
  if (isRealArt(id)) return svgArt(id, 0, 0, 12, 11, { tint: colour });
  if (kind === 'telegraph') return `<path d="M6 0 L11 11 L1 11 Z" class="glyph" style="fill:${colour}"/><rect x="5" y="3" width="2" height="8" fill="#fff" opacity=".55"/>`;
  return `<path d="M0 5 L6 0 L12 5 L12 11 L0 11 Z" class="glyph" style="fill:${colour}"/><rect x="4.5" y="6" width="3" height="5" fill="#fff" opacity=".6"/>`;
}

export function renderMap(ctx) {
  const { state, targets } = ctx;
  const E = ctx.engine;
  const MAP = E.MAP;
  const flash = ctx.view.flash;
  const frame = ctx.frame;
  const path = frame && frame.kind === 'lay' ? frame.path : null;
  const pathRoutes = path ? path.routes : [];
  const pathCities = path ? path.cities : [];
  // The wild slot being filled (P14.9): the lay's routes are still unlaid, its slot is lit.
  const asking = frame && frame.kind === 'wildSlot' ? frame : null;
  const out = [];
  out.push(mapOpen(MAP));
  // The black lines the printed map draws between cities, beneath every slot.
  out.push(`<g class="map__lines" pointer-events="none">${MAP.routes.map((r) => routeLine(MAP, r)).join('')}</g>`);

  const player = state.players[state.toAct ?? 0];
  const mapInScope = ctx.interactive && targets.scope.has('map');
  for (const r of MAP.routes) {
    const laid = state.map.routeOwner[r.id] !== null;
    const rt = tgt(ctx, 'route', `route:${r.id}`);
    const stepIndex = pathRoutes.indexOf(r.id);
    const cls = ['route', laid ? 'route--claimed route--nobody' : '', stepIndex >= 0 ? 'route--inpath' : '', rt.cls.trim(), flashCls(ctx, flash.routes, r.id).trim()].filter(Boolean).join(' ');
    const slots = r.slots
      .map((s, i) => {
        // Laid track belongs to nobody: the bed is plain, in no player's colour; a wild slot shows the tile that was chosen for it.
        if (laid) return slotLaid(MAP, s, laidTerrain(state.map.wildFill, r, i));
        return slotOpen(MAP, s, false, !!asking && asking.route === r.id && asking.slot === i);
      })
      .join('');
    const mid = r.slots[Math.floor(r.slots.length / 2)];
    let badge = '';
    if (mapInScope && rt.legal) badge = routeBadge(ctx, r, mid, laid, true);
    else if (mapInScope && !laid && frame && frame.kind === 'lay' && frame.path === null && (player.railheads.includes(r.a) || player.railheads.includes(r.b))) badge = routeBadge(ctx, r, mid, false, false);
    const stepMark = stepIndex >= 0 ? `<g class="routestep" transform="translate(${mid.x} ${mid.y})"><circle r="4.6"/><text y="1.8" text-anchor="middle">${stepIndex + 1}</text></g>` : '';
    out.push(`<g class="${cls}" data-route="${r.id}" ${rt.attrs} ${laid ? 'data-laid="1"' : 'data-laid="0"'} style="${flashDelay(ctx)}">${slots}${badge}${stepMark}</g>`);
  }

  // Pieces beside a city (buildings, trains) take the free spots around it, clear of the names and slots.
  const spots = pieceSpots(MAP);
  for (const c of MAP.cities) {
    const ct = tgt(ctx, 'city', `city:${c.id}`);
    const entry = ct.legal ? targets.byTarget.get(`city:${c.id}`) : undefined;
    const build = entry && entry.actions.some((a) => a.type === 'placeRailwayStation' || a.type === 'placeTelegraphStation');
    const setup = entry && entry.actions.some((a) => a.type === 'placeRailhead');
    const onPath = pathCities.includes(c.id);
    const isLast = path && pathCities[pathCities.length - 1] === c.id;
    const cls = ['city', `city--${c.kind}`, ct.cls.trim(), build ? 'is-build' : '', setup ? 'is-setup' : '', onPath ? 'city--inpath' : '', isLast ? 'city--pathend' : '', flashCls(ctx, flash.cities, c.id).trim()].filter(Boolean).join(' ');
    const outer = cityOuterR(MAP, c);
    out.push(`<g class="${cls}" data-city="${c.id}" ${ct.attrs} style="${flashDelay(ctx)}">${ct.legal ? `<circle class="city__halo" cx="${c.x}" cy="${c.y}" r="${outer + 4}"/>` : ''}${cityShapes(MAP, c)}</g>`);
  }

  // The city names, as the printed map letters them, over the routes and cities.
  out.push(cityLabels(MAP));

  for (const c of MAP.inlandCities.map((id) => MAP.cityById[id])) {
    const rs = state.map.railwayStation[c.id];
    const ts = state.map.telegraphStation[c.id];
    const railwayAt = rs !== null && rs !== undefined ? spots.take(c.id, 6.5) : null;
    const telegraphAt = ts !== null && ts !== undefined ? spots.take(c.id, 6.5) : null;
    if (ts !== null && ts !== undefined) {
      out.push(`<g class="building building--telegraph" data-city="${c.id}" data-building="telegraph" transform="translate(${telegraphAt.x - 6} ${telegraphAt.y - 5.5})"><title>${esc(nameOf(ctx, ts))}'s telegraph station in ${esc(c.name)}</title>${buildingGlyph('telegraph', colourOf(ctx, ts))}</g>`);
    }
    if (rs !== null && rs !== undefined) {
      out.push(`<g class="building building--railway" data-city="${c.id}" data-building="railway" transform="translate(${railwayAt.x - 6} ${railwayAt.y - 5.5})"><title>${esc(nameOf(ctx, rs))}'s railway station in ${esc(c.name)}</title>${buildingGlyph('railway', colourOf(ctx, rs))}</g>`);
    }
  }

  // The trains. Your own are clickable to start a lay.
  for (const p of state.players) {
    p.railheads.forEach((city, idx) => {
      if (!city) return;
      const c = MAP.cityById[city];
      const { x, y } = spots.take(city, 7.2);
      const own = ctx.interactive && p.id === state.toAct;
      const tt = own ? tgt(ctx, 'train', `train:${idx}`) : null;
      const active = path && path.train === idx && p.id === frame.player;
      out.push(`<g class="railhead${tt ? tt.cls : ''}${active ? ' railhead--active' : ''}" data-railhead="${p.id}:${idx}" ${tt ? tt.attrs : `data-tip="train:${p.id}:${idx}"`} transform="translate(${x} ${y})"><title>${esc(nameOf(ctx, p.id))}'s train ${idx + 1} in ${esc(c.name)}</title>
        <circle class="railhead__plate" r="7.6" style="fill:${colourOf(ctx, p.id)}"/>${svgPiece('railhead', '#fbf5e6', 0, -0.5, 12.5)}</g>`);
    });
  }
  out.push(mapFrame(MAP));
  out.push('</svg>');
  return out.join('');
}

// ---------------------------------------------------------------------------
// The player board and its carriages
// ---------------------------------------------------------------------------

// Positions on the printed player board (assets/pr2e/player-board.webp, 1200 x 591), as percentages.
const PB = { w: 1200, h: 591 };
const pbx = (x) => Math.round((x / PB.w) * 1000) / 10;
const pby = (y) => Math.round((y / PB.h) * 1000) / 10;
/** House spaces (+1, +2, +3) of each track, and where the production number goes. */
const HOUSE_SPOTS = {
  wood: { xs: [625, 700, 773], y: 224, badge: [745, 150] },
  iron: { xs: [905, 980, 1052], y: 224, badge: [1020, 150] },
  gunpowder: { xs: [625, 700, 773], y: 357, badge: [745, 287] },
  coins: { xs: [905, 980, 1052], y: 357, badge: [1020, 290] },
};
/** The seven telegraph spaces, by VP, on the pole at the left. */
const TELEGRAPH_Y = { 9: 65, 6: 138, 5: 210, 4: 282, 3: 361, 2: 437, 1: 520 };
const BOARD_ROOF_X = [590, 685, 785, 882, 980, 1080];
const BOARD_ROOF_Y = 62;
// Positions on a carriage (assets/pr2e/carriage-N.webp, 480 x 444).
const CAR = { w: 480, h: 444 };
const carx = (x) => Math.round((x / CAR.w) * 1000) / 10;
const cary = (y) => Math.round((y / CAR.h) * 1000) / 10;
const CAR_WINDOW_X = [155, 327];
const CAR_ROOF_X = [110, 195, 280];

/** Everything in storage as one list of items, in the order it fills the roof boxes: board first, then each carriage. */
function storageUnits(player) {
  const units = [];
  const add = (item, n, kind) => {
    for (let i = 0; i < n; i++) units.push({ item, kind });
  };
  add('iron', player.resources.iron, 'res');
  add('wood', player.resources.wood, 'res');
  add('gunpowder', player.resources.gunpowder, 'res');
  add('coins', player.coins, 'res');
  add('ground', player.builtTiles.ground, 'tile');
  add('tunnel', player.builtTiles.tunnel, 'tile');
  add('bridge', player.builtTiles.bridge, 'tile');
  return units;
}

function unitHtml(NAMES, u) {
  const name = u.item === 'coins' ? 'Coin' : NAMES[u.item];
  return u.kind === 'tile'
    ? `<span class="pbu pbu--tile" title="${esc(name)} tile (built)">${trackTile(u.item, { cls: 'tile--roof', label: `${name} tile` })}</span>`
    : `<span class="pbu" title="${esc(name)}">${art(ITEM_ART[u.item], { cls: 'pbu__img', label: name })}</span>`;
}

function boardHtml(ctx, p) {
  const { state } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const colour = colourOf(ctx, p.id);
  const mine = ctx.interactive && p.id === state.toAct;
  const units = storageUnits(p);
  const cap = E.storageCapacity(state, p.id);
  const tracks = K.PLAYER_BOARD.houseTracks
    .map((track) => {
      const spot = HOUSE_SPOTS[track];
      const left = p.houses[track];
      const ht = mine ? tgt(ctx, 'house', `house:${track}`) : { attrs: '', cls: '' };
      const houses = spot.xs
        .map((x, i) => {
          const filled = i >= K.PLAYER_BOARD.houseSlotsPerTrack - left;
          return `<span class="pbh${filled ? ' has-house' : ''}" style="left:${pbx(x)}%;top:${pby(spot.y)}%" title="${filled ? 'A house covers this production space' : 'Empty: this house has left the track (production +1)'}">${filled ? piece('house', colour) : ''}</span>`;
        })
        .join('');
      const prod = E.production(state, p.id, track);
      return `<span class="pbt${ht.cls}" data-track="${track}" ${ht.attrs}>${houses}<span class="pbp" style="left:${pbx(spot.badge[0])}%;top:${pby(spot.badge[1])}%" title="Production of ${esc(K.NAMES[track])}">${prod}</span></span>`;
    })
    .join('');
  const tele = K.PLAYER_BOARD.telegraphRowVp
    .map((vp, i) => {
      const present = i >= p.telegraphsPlaced;
      const next = i === p.telegraphsPlaced;
      return `<span class="pbs${present ? ' has-station' : ' is-placed'}${next ? ' is-next' : ''}" style="left:${pbx(107)}%;top:${pby(TELEGRAPH_Y[vp])}%" title="${present ? `Telegraph station worth ${vp} VP` : 'Placed on the map'}">${present ? piece('telegraph-station', colour) : ''}</span>`;
    })
    .join('');
  const hats = [0, 1]
    .map((i) => `<span class="pbhat${p.hats > i ? ' has-hat' : ''}" style="left:${pbx(i === 0 ? 297 : 405)}%;top:${pby(180)}%" title="Cowboy hat space ${i + 1}">${p.hats > i ? art('token-cowboy-hat-v2', { cls: 'pbhat__img', label: 'Cowboy hat' }) : ''}</span>`)
    .join('');
  const roof = BOARD_ROOF_X.map((x, i) => {
    const u = units[i];
    return `<span class="pbr${u ? ' has-item' : ''}" style="left:${pbx(x)}%;top:${pby(BOARD_ROOF_Y)}%">${u ? unitHtml(K.NAMES, u) : ''}</span>`;
  }).join('');
  void cap;
  return `<div class="pb__board" data-field="player-board">${art('pr2e-player-board', { cls: 'pb__boardimg', label: 'Player board' })}${roof}${tracks}${tele}${hats}</div>`;
}

function carriageHtml(ctx, p, c, unitsFrom, units) {
  const { state } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const n = c.number;
  const mine = ctx.interactive && p.id === state.toAct;
  const ct = mine ? tgt(ctx, 'carriage', `carriage:${n}`) : { attrs: `data-tip="carriage:${n}"`, cls: '' };
  const frame = ctx.frame;
  const step = frame && frame.kind === 'boardActivation' && frame.player === p.id && frame.steps[frame.index] ? frame.steps[frame.index] : null;
  const windows = c.slots
    .map((s, i) => {
      const acting = step && step.type === s && step.carriage === n && step.slot === i;
      const vp = n === 3 ? K.PLAYER_BOARD.carriage3SpaceVp[i] : 0;
      return `<span class="pbw${s ? ' has-spec' : ''}${acting ? ' is-acting' : ''}" style="left:${carx(CAR_WINDOW_X[i])}%;top:${cary(190)}%" title="${s ? esc(K.NAMES[s]) : 'Empty specialist space'}${vp ? `: hiring here scores ${vp} VP` : ''}">${s ? `${art(ITEM_ART[s], { cls: 'pbw__img', label: K.NAMES[s] })}<small>${esc(K.NAMES[s])}</small>` : '<small>empty</small>'}${vp ? `<i class="pbw__vp" data-vp="${vp}">${vp} VP</i>` : ''}</span>`;
    })
    .join('');
  const tokenArt = c.upgrade ? upgradeTokenArt(c.upgrade) : null;
  const upgradeActing = step && step.type === 'upgrade' && step.carriage === n;
  const token = c.upgrade
    ? `<span class="pbk${upgradeActing ? ' is-acting' : ''}" style="left:50%;top:${cary(281)}%" data-installed="${esc(c.upgrade)}" data-tip="token:${esc(c.upgrade)}">${tokenArt ? art(tokenArt, { cls: 'pbk__img', label: c.upgrade }) : esc(c.upgrade)}</span>`
    : '';
  const roof = CAR_ROOF_X.map((x, i) => {
    const u = units[unitsFrom + i];
    return `<span class="pbr pbr--car${u ? ' has-item' : ''}" style="left:${carx(x)}%;top:${cary(30)}%">${u ? unitHtml(K.NAMES, u) : ''}</span>`;
  }).join('');
  return `<div class="pb__car${ct.cls}${flashCls(ctx, ctx.view.flash.carriages, n)}" data-level="${n}" ${ct.attrs} style="${flashDelay(ctx)}">${art(`pr2e-carriage-${n}`, { cls: 'pb__carimg', label: `Carriage ${n}` })}${roof}${windows}${token}<b class="pb__carno">${n}</b></div>`;
}

/** One player's player board: the board itself on its printed art, then the carriages it has earned, then storage. */
function playerBoard(ctx, p) {
  const { state } = ctx;
  const E = ctx.engine;
  const K = E.getConstants(state);
  const seat = ctx.seats[p.id];
  const colour = colourOf(ctx, p.id);
  const carriages = p.train.specialistCarriages;
  const units = storageUnits(p);
  const cap = E.storageCapacity(state, p.id);
  const used = E.storageUsed(p);
  const placedByLay = p.layStationsPlaced ?? 0;
  const cars = carriages.map((c, i) => carriageHtml(ctx, p, c, K.PLAYER_BOARD.boardStorage + i * K.PLAYER_BOARD.storagePerCarriage, units)).join('');
  const nextCar = carriages.length < K.PLAYER_BOARD.maxCarriages ? carriages.length + 1 : null;
  const ghost = nextCar
    ? `<div class="pb__ghost" data-field="next-carriage" title="Railway stations you place at the end of a lay bring carriages: the first, second and third bring carriage 1, 2 and 3.">
        <b>${carriages.length === 0 ? 'No carriage yet' : `Carriage ${nextCar} next`}</b>
        <span>Your ${['1st', '2nd', '3rd'][nextCar - 1]} railway station placed by laying track brings carriage ${nextCar}${nextCar === 1 ? ' and a free specialist' : ''}.</span>
        <span class="pb__count" data-field="lay-stations">Railway stations placed by Lay Track: <b>${placedByLay}</b></span>
      </div>`
    : `<div class="pb__ghost pb__ghost--done"><span class="pb__count" data-field="lay-stations">Railway stations placed by Lay Track: <b>${placedByLay}</b> (all three carriages earned)</span></div>`;
  const chip = (item, n, built) => {
    const mineActive = ctx.interactive && p.id === state.toAct;
    const ct = mineActive ? tgt(ctx, 'store', `store:${item}`) : { attrs: '', cls: '' };
    const name = item === 'coins' ? 'Coins' : K.NAMES[item];
    const picture = built ? trackTile(item, { label: `${name} track tile` }) : art(ITEM_ART[item], { cls: 'icon icon--stock', label: name });
    return `<span class="stock stock--${built ? 'tile' : 'res'} stock--${item}${n === 0 ? ' is-zero' : ''}${ct.cls}" data-item="${item}" data-count="${n}" ${ct.attrs} title="${esc(name)}${built ? ' (built track tile)' : ''}: ${n}">${picture}<b>${n}</b></span>`;
  };
  const storage = `<section class="storage${used > cap ? ' is-over' : ''}">
      <div class="storage__head"><span>Storage</span><span class="storage__cap" data-field="storage" title="Items held of the storage capacity: 6 on the player board, 3 more in each carriage. Coins count">${used} / ${cap}</span></div>
      <div class="storage__group">${['iron', 'wood', 'gunpowder', 'coins'].map((r) => chip(r, r === 'coins' ? p.coins : p.resources[r], false)).join('')}</div>
      <div class="storage__group storage__group--tiles" title="Built by board activations. Spent by Lay Track to lay routes on the map.">${['ground', 'tunnel', 'bridge'].map((t) => chip(t, p.builtTiles[t], true)).join('')}</div>
    </section>`;
  return `<article class="pb" data-player="${p.id}" style="--pc:${colour}">
    <header class="pb__head">
      <span class="score__dot"></span><b class="pb__name">${esc(nameOf(ctx, p.id))}</b>
      <span class="badge badge--${seat.human ? 'human' : 'bot'}">${esc(seat.label)}</span>
      <span class="pb__vp" data-vp="${p.id}">${E.totalVp(p)} VP</span>
      <span class="stat" title="Cowboy hats (limit ${K.HATS.hatLimit})">${art('token-cowboy-hat-v2', { cls: 'icon icon--stat', label: 'Hats' })}<b data-stat="hats">${p.hats}</b></span>
      <span class="stat" title="Workers in your supply">${piece('worker', colour)}<b data-stat="workers">${p.workersInSupply}</b></span>
      <span class="stat stat--heads" title="Your trains">${piece('railhead', colour)}<span>${p.railheads.filter((c) => c).map((c) => esc(E.MAP.cityById[c].name)).join(', ')}</span></span>
      ${storage}
    </header>
    <div class="pb__row">${boardHtml(ctx, p)}${cars}${ghost}</div>
  </article>`;
}

/** The player board strip under the map: the player to move (or the one whose card was clicked). */
export function renderTrains(ctx) {
  return playerBoard(ctx, ctx.state.players[ctx.viewer]);
}

// ---------------------------------------------------------------------------
// The dock under the map: goals in full, the upgrade supply, the specialist piles
// ---------------------------------------------------------------------------

const DOCK_TABS = { goals: 'Goals', upgrades: 'Upgrade tokens', specialists: 'Specialists' };

function goalsTab(ctx) {
  const E = ctx.engine;
  const { state } = ctx;
  const vp = E.getConstants(state).SCORING.goalVp;
  const cards = E.goalsInPlay(state)
    .map((goal) => {
      const st = E.goalStandings(state, goal);
      const lead = st.places.indexOf(0);
      const rows = state.players
        .map((p) => {
          const c = ctx.who(p.id);
          return `<li class="prog${lead === p.id ? ' is-met' : ''}" style="--pc:${esc(c.colour)}" data-player="${p.id}"><span class="score__dot"></span><span class="prog__name">${esc(c.name)}</span><span class="prog__text">${esc(E.describeProgress(state, p.id, goal).text)}</span>${lead === p.id ? `<span class="prog__stand">leads: ${vp} VP</span>` : ''}</li>`;
        })
        .join('');
      return `<article class="gcard" data-goal="${esc(goal.id)}" data-tip="goal:${esc(goal.id)}">
        ${GOAL_ART[goal.metric] ? art(GOAL_ART[goal.metric], { cls: 'gcard__img', label: goal.name }) : ''}
        <div class="gcard__body"><div class="mcard__head"><b>${esc(goal.name)}</b><span class="mcard__vp">${vp} VP at the end</span></div><ul class="progs">${rows}</ul></div>
      </article>`;
    })
    .join('');
  return `<section class="gsec" data-section="goals"><h3>The four scoring goals in play</h3><p class="muted">The player with the most, and at least one, scores ${vp} VP when the game ends. A tie for the most scores nobody.</p><div class="gcards">${cards}</div></section>`;
}

function upgradesTab(ctx) {
  const E = ctx.engine;
  const { state } = ctx;
  const K = E.getConstants(state);
  const counts = new Map();
  for (const id of state.supply.upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
  const levels = [1, 2, 3]
    .map((level) => {
      const ids = [...counts.keys()].filter((id) => E.upgradeTileData(state, id).level === level);
      const tokens = ids
        .map((id) => {
          const data = E.upgradeTileData(state, id);
          const what = data.gives === 'choice' ? `${K.UPGRADES.yield[level - 1]} resources of your choice` : E.formatCost(state, { [data.gives]: K.UPGRADES.yield[level - 1] });
          return `<article class="utile" data-token="${esc(id)}" data-tip="token:${esc(id)}">${art(upgradeTokenArt(id), { cls: 'utile__img', label: id })}<div class="utile__text"><b>${esc(id)}</b> <span class="utile__level">x${counts.get(id)} in the supply</span><span class="utile__effect">Each board activation: ${esc(what)}.</span></div></article>`;
        })
        .join('');
      return `<div class="ulevel"><h4>Level ${level} tokens (carriage ${level})</h4><div class="utiles">${tokens || '<p class="muted">None left.</p>'}</div></div>`;
    })
    .join('');
  const installed = state.players
    .map((p) => {
      const c = ctx.who(p.id);
      const rows = p.train.specialistCarriages.length
        ? p.train.specialistCarriages.map((car) => `<li>${car.upgrade ? `<b>${esc(car.upgrade)}</b>` : '<span class="muted">no token</span>'}<small> in carriage ${car.number}</small></li>`).join('')
        : '<li class="muted">no carriage yet</li>';
      return `<div class="uinst" style="--pc:${esc(c.colour)}"><span class="score__dot"></span> <b>${esc(c.name)}</b><ul>${rows}</ul></div>`;
    })
    .join('');
  return `<div class="dock__cols"><div class="dock__main">${levels}</div><aside class="dock__side"><h4>Installed</h4>${installed}</aside></div>`;
}

function specialistsTab(ctx) {
  const E = ctx.engine;
  const { state } = ctx;
  const K = E.getConstants(state);
  const piles = K.SPECIALIST_TYPES.map((t) => {
    const left = state.supply.specialists[t];
    return `<div class="spile" data-specialist="${t}">${art(ITEM_ART[t], { cls: 'icon icon--spec', label: K.NAMES[t] })}<b>${esc(K.NAMES[t])}</b><span>${left} left in the supply</span></div>`;
  }).join('');
  const recipes = ['crew', 'miner', 'engineer']
    .map((t) => {
      const r = K.ACTIVATION.recipes[t];
      return `<li><b>${esc(K.NAMES[t])}</b>: pay ${esc(E.formatCost(state, r.cost))}, build 1 ${esc(K.NAMES[r.builds])} tile.</li>`;
    })
    .join('');
  const tycoon = state.variants.tycoonMode;
  const costs = K.SPECIALIST_TYPES.map((t) => `<tr><th scope="row">${esc(K.NAMES[t])}</th>${K.HIRING.tycoonCosts[t].map((c) => `<td>${esc(E.formatCost(state, c))}</td>`).join('')}</tr>`).join('');
  return `<section class="specs"><div class="spiles">${piles}</div>
    <ul class="spec__recipes">${recipes}<li><b>Financier</b>: takes one column of Congress, or resets the senators.</li></ul>
    <h4>Hiring costs${tycoon ? '' : ' (Tycoon Mode is off: hiring is free)'}</h4>
    <table class="spec__costs${tycoon ? '' : ' is-off'}"><thead><tr><th></th><th>Carriage 1</th><th>Carriage 2</th><th>Carriage 3</th></tr></thead><tbody>${costs}</tbody></table></section>`;
}

export function renderDock(ctx) {
  const { view } = ctx;
  const tabs = Object.keys(DOCK_TABS);
  const active = tabs.includes(view.dock.tab) ? view.dock.tab : tabs[0];
  const open = view.dock.open;
  const bar = tabs
    .map((t) => `<button type="button" role="tab" class="dock__tab${open && active === t ? ' is-active' : ''}" data-ui="tab:${t}" aria-selected="${open && active === t}">${DOCK_TABS[t]}</button>`)
    .join('');
  const home = open
    ? '<button type="button" class="dock__home" data-ui="dock-toggle" aria-pressed="false" title="Close the panel and show the player board again (Escape)">Player board</button>'
    : '<span class="dock__home is-active" aria-current="true">Player board</span>';
  let body = '';
  if (open) {
    const content = active === 'goals' ? goalsTab(ctx) : active === 'upgrades' ? upgradesTab(ctx) : specialistsTab(ctx);
    body = `<div class="dock__body" role="tabpanel" data-tab="${active}">${content}</div>`;
  }
  return `<div class="dock${open ? ' is-open' : ''}" data-open="${open ? 1 : 0}" data-active="${active}">
      <div class="dock__bar" role="tablist" aria-label="The player board and the supply">${home}${bar}</div>
      ${body}
    </div>`;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export function renderLog(ctx) {
  const items = ctx.log.slice(-120).reverse().map((e) => entryHtml(e, ctx.state));
  return `<div class="log__head">Game log</div><ol class="log__list" data-field="log">${items.join('')}</ol>`;
}

// ---------------------------------------------------------------------------
// The end screen
// ---------------------------------------------------------------------------

export function renderEnd(ctx) {
  const { state } = ctx;
  const E = ctx.engine;
  const result = E.scoreGame(state);
  const ranked = result.ranking.map((id) => result.players.find((p) => p.id === id));
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
        <span class="podium__rank">${p.rank === ranked[0].rank && shared ? '=' : ''}${p.rank}</span>
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
  const goalRows = E.goalsInPlay(state)
    .map((goal) => {
      const st = E.goalStandings(state, goal);
      const lead = st.places.indexOf(0);
      return `<li data-goal="${esc(goal.id)}"><b>${esc(goal.name)}</b>: ${state.players.map((p) => `${esc(nameOf(ctx, p.id))} ${st.values[p.id]}`).join(', ')}. ${lead >= 0 ? `${esc(nameOf(ctx, lead))} scored ${E.getConstants(state).SCORING.goalVp} VP.` : 'Nobody scored (a tie for the most, or none at all).'}</li>`;
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
      <tr class="end__aux"><th scope="row">Tie-break 1: district houses on building sites</th>${ranked.map((p) => `<td>${p.tieBreak.districtHouses}</td>`).join('')}</tr>
      <tr class="end__aux"><th scope="row">Tie-break 2: buildings on the map</th>${ranked.map((p) => `<td>${p.tieBreak.buildings}</td>`).join('')}</tr></tfoot>
    </table>
    <ul class="end__goals" data-field="end-goals">${goalRows}</ul>
    </div>
    <p class="end__tie" data-field="tie-break">${esc(ctx.labels.tieBreak[result.decidedBy] ?? '')}</p>
    <div class="end__meta">Seed <b data-field="seed">${esc(state.config.seed)}</b> <span class="end__rules">Rules: <b data-field="end-rules">${esc(ctx.ruleset ? ctx.ruleset.name : '')}</b> ${variantChips(E, state.variants, 'end__chips')}</span></div>
    <div class="end__buttons">
      <button type="button" class="btn btn--primary btn--big" data-ui="again-new-seed">Play again</button>
      <button type="button" class="btn" data-ui="back-to-setup">Change set-up</button>
      <button type="button" class="btn" data-ui="again-same-seed" title="The same seed and seats: the seat order and the goals come out the same">Replay this seed</button>
      <button type="button" class="btn" data-ui="view-board">Look at the final board</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// What the registry hands to the page
// ---------------------------------------------------------------------------

export const views = Object.freeze({
  renderScores,
  renderPrompt,
  renderGrid,
  renderCongress,
  renderMap,
  renderTrains,
  renderDock,
  renderLog,
  renderEnd,
});

// A small export for the tests: the district tile sites' vertical position, and whether a picture is in the manifest.
export const internals = { siteY, hasArt };
