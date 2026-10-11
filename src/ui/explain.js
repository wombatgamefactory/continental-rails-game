// explain.js - layers 3 and 4 of the illegal-move messaging: the sentence for a
// refused click, and the ambient tooltip on hover.
//
// Every reason in this file is the ENGINE's: getBlockReason for "can I now",
// getStructuralBlockReason for "could I at all, timing aside". This file only
// chooses which of the two to show and wraps it in the facts of the thing
// pointed at (read from the engine's data and queries). It decides nothing.
//
// A tooltip is built when the pointer arrives (main.js asks tipFor), not on
// every render: the page would otherwise compute a block reason for every
// route, city, worker space and card on every frame.

import {
  GRID,
  MAP,
  NAMES,
  getBlockReason,
  getStructuralBlockReason,
  districtInfo,
  congressTable,
  congressCoinCost,
  formatRouteCost,
  routeShortfall,
  production,
  ponyCardData,
  upgradeTileData,
  cardIndex,
  getConstants,
  describeProgress,
  goalsInPlay,
  goalStandings,
  legislativeCardData,
} from '../engine/index.js';
import { probesFor, refusalReason } from './action-targets.js';
import { forcedFollowUps, consequenceSentence } from './preview.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "1st", "2nd", "3rd", "4th" for a zero-based place. */
export function ordinal(place) {
  const n = place + 1;
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${tail}`;
}

// ---------------------------------------------------------------------------
// The two questions
// ---------------------------------------------------------------------------

/**
 * The engine's two answers for one probe action: `now` (null = legal now) and
 * `structural` (null = nothing about the position forbids it, only the timing).
 */
export function reasonPair(state, probe) {
  const now = getBlockReason(state, probe);
  const structural = now === null ? null : getStructuralBlockReason(state, probe);
  return { now, structural };
}

/** The same, for the best probe of a target key; null when the key has no probe. */
export function reasonPairForKey(state, key, opts = {}) {
  const probes = probesFor(state, key, opts);
  if (probes.length === 0) return null;
  let best = null;
  for (const probe of probes) {
    const pair = reasonPair(state, probe);
    if (pair.now === null) return pair;
    if (best === null) best = pair;
  }
  return best;
}

/** One line saying whether it can be done, using the right one of the two reasons. */
export function availability(pair) {
  if (pair === null) return null;
  if (pair.now === null) return { ok: true, text: 'You can do this now.' };
  if (pair.structural === null) return { ok: false, text: `Not at this point of your turn: ${pair.now}` };
  return { ok: false, text: pair.structural };
}

// ---------------------------------------------------------------------------
// Layer 3 - the refused click
// ---------------------------------------------------------------------------

/** The sentence for a click on a target that is not legal, or '' when there is nothing to say. */
export function refusalMessage(ctx, key) {
  const reason = refusalReason(ctx.state, key, { hat: ctx.hat });
  if (reason) return reason;
  if (ctx.targets.byTarget.has(key)) return '';
  return 'That cannot be used at this point of the game.';
}

// ---------------------------------------------------------------------------
// Layer 4 - ambient tooltips
// ---------------------------------------------------------------------------

function line(cls, html) {
  return `<div class="tip__${cls}">${html}</div>`;
}

function availabilityHtml(ctx, key) {
  if (!ctx.interactive) return '';
  if (ctx.targets.byTarget.has(key)) return line('avail tip__avail--ok', 'You can do this now.');
  const a = availability(reasonPairForKey(ctx.state, key, { hat: ctx.hat }));
  return a ? line(a.ok ? 'avail tip__avail--ok' : 'avail tip__avail--no', esc(a.text)) : '';
}

function consequenceHtml(ctx, key, label) {
  const entry = ctx.targets.byTarget.get(key);
  if (!entry || !ctx.interactive) return '';
  const sentence = consequenceSentence(label, forcedFollowUps(ctx.state, entry.actions[0]));
  return sentence ? line('forced', esc(sentence)) : '';
}

function tileName(state, district) {
  const info = GRID.districtTiles[state.grid.tiles[district]];
  return info ? info.name : district;
}

function who(ctx, pid) {
  return ctx.who(pid).name;
}

function heldText(ctx, terrain) {
  const p = ctx.state.players[ctx.viewer];
  return `${p.builtTiles[terrain]} ${NAMES[terrain]}`;
}

function routeFacts(ctx, id) {
  const { state } = ctx;
  const route = MAP.routeById[id];
  const owner = state.map.routeOwner[id];
  const a = MAP.cityById[route.a].name;
  const b = MAP.cityById[route.b].name;
  const slots = route.terrains.map((t) => NAMES[t]).join(', ');
  const parts = [`<b>${esc(a)} - ${esc(b)}</b>: ${plural(route.length, 'slot', 'slots')} (${esc(slots)}).`];
  if (owner !== null) {
    parts.push(`Owned by ${esc(who(ctx, owner))}.`);
    return parts.join(' ');
  }
  parts.push(`Claiming it costs ${esc(formatRouteCost(state, route))} in built tiles.`);
  const player = state.players[ctx.viewer];
  const short = routeShortfall(player, route);
  const held = ['ground', 'tunnel', 'bridge'].filter((t) => route.cost[t] > 0).map((t) => heldText(ctx, t));
  if (short) parts.push(`<span class="tip__bad">It needs ${short.need} ${esc(NAMES[short.terrain])}; you have ${short.have}.</span>`);
  else parts.push(`You hold ${esc(held.join(', '))}: enough.`);
  return parts.join(' ');
}

function cityFacts(ctx, id) {
  const { state } = ctx;
  const city = MAP.cityById[id];
  const parts = [];
  const kind = city.kind === 'inland' ? 'Inland city' : `${city.kind === 'west' ? 'West' : 'East'} start city`;
  parts.push(`<b>${esc(city.name)}</b>: ${kind}.`);
  const heads = state.players.filter((p) => p.railheads.includes(id)).map((p) => who(ctx, p.id));
  if (heads.length) parts.push(`Railhead: ${esc(heads.join(', '))}.`);
  const rs = state.map.railwayStation[id];
  const ts = state.map.telegraphStation[id];
  if (rs !== null && rs !== undefined) parts.push(`Railway station: ${esc(who(ctx, rs))}.`);
  if (ts !== null && ts !== undefined) parts.push(`Telegraph station: ${esc(who(ctx, ts))}.`);
  if (state.modules.pony && state.modules.pony.tokens[id] === true) parts.push('A Pony Express token is still here.');
  return parts.join(' ');
}

function congressFacts(ctx, id) {
  const { state } = ctx;
  const entry = congressTable(state).find((e) => e.id === id);
  if (!entry) return '';
  const coin = ctx.interactive ? congressCoinCost(state, state.toAct, entry) : entry.coinCost;
  const used = !entry.reset && state.congress.used[id] === true;
  return `<b>${entry.reset ? 'Reset' : `Entry ${esc(id)}`}</b>: costs ${plural(entry.tier, 'lobby point', 'lobby points')} and ${plural(coin, 'Coin', 'Coins')}. ${esc(entry.text)}${used ? ' <span class="tip__bad">Its senator is on the benefit.</span>' : ''}`;
}

function districtFacts(ctx, id) {
  const { state, targets } = ctx;
  const info = districtInfo(state, id);
  const pv = targets.districts.previews[id];
  const parts = [`<b>${esc(info.name)}</b>.`];
  const v = pv && (ctx.hat && pv.hat ? pv.hat : pv.plain);
  if (v) parts.push(`Multiplier x${v.multiplier}${v.adjacent ? ` (${plural(v.adjacent, 'adjacent worker', 'adjacent workers')})` : ''}${v.outcome ? `: ${esc(v.outcome)}` : ''}.`);
  return parts.join(' ');
}

function spaceFacts(ctx, id) {
  const { state } = ctx;
  const w = GRID.workerSpaces.find((s) => s.id === id);
  const [a, b] = w.between;
  const owner = state.grid.spaces[id];
  return `<b>Worker space ${esc(id)}</b>, between ${esc(tileName(state, a))} and ${esc(tileName(state, b))}. ${owner !== null ? `${esc(who(ctx, owner))}'s worker is here.` : 'Empty.'}`;
}

function ponyCardFacts(ctx, card, extra = '') {
  const K = getConstants(ctx.state);
  const cost = K.PONY.costs[card.rank];
  const kindText = { immediate: 'Immediate: used once when bought', ongoing: 'Ongoing: stays in play', endgame: 'Endgame: scores in final scoring' }[card.kind] ?? card.kind;
  return `<b>${esc(card.name)}</b> (rank ${esc(card.rank)}, ${plural(cost, 'token', 'tokens')}). ${esc(kindText)}. ${esc(card.text)}${extra}`;
}

function progressFacts(ctx, item) {
  const lines = ctx.state.players.map((p) => `${esc(who(ctx, p.id))}: ${esc(describeProgress(ctx.state, p.id, item).text)}`);
  return lines.join('<br>');
}

/**
 * The tooltip for a data-tip key, as HTML ('' for a key with nothing to say).
 * Keys are the target keys of action-targets.js plus: milestone:ID, goal:ID,
 * agenda:ID, owned:ID, ptoken:CITY.
 */
export function tipFor(ctx, key) {
  const { state } = ctx;
  const sep = key.indexOf(':');
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  let title = '';
  switch (kind) {
    case 'space':
      return line('facts', spaceFacts(ctx, id)) + availabilityHtml(ctx, key) + consequenceHtml(ctx, key, 'If you take this');
    case 'centre': {
      const owner = state.grid.centres[id];
      return line('facts', `<b>Centre of ${esc(tileName(state, id))}</b>. ${owner !== null ? `${esc(who(ctx, owner))}'s worker is on it.` : 'A worker goes here only to displace a blocked district.'}`) + availabilityHtml(ctx, key);
    }
    case 'district': {
      const entry = ctx.targets.byTarget.get(key);
      const pv = ctx.targets.districts.previews[id];
      const v = pv && (ctx.hat && pv.hat ? pv.hat : pv.plain);
      return (
        line('facts', districtFacts(ctx, id)) +
        availabilityHtml(ctx, key) +
        (entry && v && v.sentence ? line('forced', esc(v.sentence)) : '')
      );
    }
    case 'route':
      return line('facts', routeFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'city':
      return line('facts', cityFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'congress':
      return line('facts', congressFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'store': {
      const p = state.players[ctx.viewer];
      const n = p.resources[id] ?? p.builtTiles[id] ?? 0;
      return line('facts', `<b>${esc(NAMES[id] ?? id)}</b>: ${n} in storage${p.builtTiles[id] !== undefined ? ' (built tiles)' : ''}.`) + availabilityHtml(ctx, key);
    }
    case 'house': {
      return line('facts', `<b>${esc(NAMES[id] ?? id)} track</b>: production ${production(state, ctx.viewer, id)}.`) + availabilityHtml(ctx, key);
    }
    case 'upgrade': {
      const tile = upgradeTileData(state, id);
      if (!tile) return '';
      title = line('facts', `<b>${esc(tile.name)}</b> (level ${tile.level}). ${esc(tile.text)}`);
      return title + availabilityHtml(ctx, key);
    }
    case 'installed': {
      const tile = upgradeTileData(state, id);
      return tile ? line('facts', `<b>${esc(tile.name)}</b> (level ${tile.level}), installed in this carriage. ${esc(tile.text)}`) : '';
    }
    case 'pony': {
      const card = ponyCardData(state, id);
      if (!card) return '';
      const held = state.modules.pony ? state.modules.pony.players[ctx.viewer].tokensHeld : 0;
      return line('facts', ponyCardFacts(ctx, card, ` You hold ${plural(held, 'token', 'tokens')}.`)) + availabilityHtml(ctx, key);
    }
    case 'owned': {
      const card = ponyCardData(state, id);
      return card ? line('facts', ponyCardFacts(ctx, card)) + availabilityHtml(ctx, `ability:${id}`) : '';
    }
    case 'token':
      return line('facts', `<b>Return a Pony Express token</b> for 1 ${esc(NAMES[id] ?? id)}.`) + availabilityHtml(ctx, key);
    case 'ability':
      return availabilityHtml(ctx, key);
    case 'milestone': {
      const item = cardIndex(getConstants(state).MILESTONE_TILES).get(id);
      if (!item) return '';
      const claimed = state.modules.milestones.claimedBy[id];
      return line('facts', `<b>${esc(item.name)}</b> (${item.vp} VP). ${esc(item.text)}${claimed !== null ? ` Claimed by ${esc(who(ctx, claimed))}.` : ' Not yet claimed.'}`) + line('facts', progressFacts(ctx, item));
    }
    case 'goal': {
      const item = goalsInPlay(state).find((g) => g.id === id);
      if (!item) return '';
      return line('facts', `<b>${esc(item.name)}</b>. ${esc(item.text)}.`) + line('facts', progressFacts(ctx, item));
    }
    case 'agenda': {
      const card = legislativeCardData(state);
      return card ? line('facts', `<b>${esc(card.name)}</b>. ${esc(card.text)}`) : '';
    }
    case 'ptoken':
      return line('facts', `A <b>Pony Express token</b> lies on ${esc(MAP.cityById[id].name)}.`);
    default:
      return '';
  }
}

/** The ordinal standing line for a goal: "currently 1st (10 VP)". */
export function standingText(state, goal, playerId) {
  const s = goalStandings(state, goal);
  const place = s.places[playerId];
  if (place < 0) return 'not tracked';
  const tied = s.values.filter((v) => v === s.values[playerId]).length > 1;
  const award = s.awards[playerId];
  return `currently ${ordinal(place)}${tied ? ' (tied)' : ''}${award > 0 ? `, ${award} VP` : ', no VP'}`;
}
