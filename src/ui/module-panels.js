// module-panels.js - the dock under the map that holds the add-on modules:
// Upgrades, Goals, Agenda, Pony Express.
//
// Each module is drawn ONLY when the engine has it (state.modules.<id>); with a
// module off there is no tab, no heading, no card and no control for it, and
// when all four are off the dock does not exist.
//
// Everything on a card is read from the engine's data (the card tables, the
// describeProgress / goalStandings reads, the block reasons). No rules text is
// written here. A control is drawn lit only because the engine listed the
// action; an unlit one carries the engine's reason as its tooltip AND as small
// text beside it.
//
// The dock sits in the layout below the map and never over it. Its bar of tabs
// is always there; an opened panel takes the place of the train strip (whose
// numbers stay on the player cards beside the map), so the map keeps its size.

import {
  NAMES,
  activeModules,
  getConstants,
  cardIndex,
  ponyCardData,
  upgradeTileData,
  legislativeCardData,
  goalsInPlay,
  describeProgress,
  ponyOngoing,
} from '../engine/index.js';
import { art, cardArtId, upgradeArtId, ponyToken } from './art.js';
import { reasonPair, availability, standingText } from './explain.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const TAB_TITLES = { upgrades: 'Upgrades', goals: 'Goals', agenda: 'Agenda', pony: 'Pony Express' };

/** The tabs the game has, in order, from the engine's own answer (activeModules). Empty when every module is off. */
export function tabsInPlay(variants) {
  const m = activeModules(variants);
  const tabs = [];
  if (m.upgrades) tabs.push('upgrades');
  if (m.milestones || m.goals) tabs.push('goals');
  if (m.legislative) tabs.push('agenda');
  if (m.pony) tabs.push('pony');
  return tabs;
}

function dot(colour) {
  return `<span class="score__dot" style="--pc:${esc(colour)}"></span>`;
}

function flashClass(ctx, list, id) {
  return ctx.flashAge >= 0 && list.includes(id) ? ' is-flash' : '';
}

function flashStyle(ctx) {
  return ctx.flashAge >= 0 ? `animation-delay:-${ctx.flashAge}ms;` : '';
}

/** A button for a legal action, or a disabled one carrying the engine's reason. */
function actionOrReason(ctx, key, action, label, cls = 'btn--small') {
  if (!ctx.interactive) return '';
  const entry = ctx.targets.byTarget.get(key);
  const legal = entry ? entry.actions.find((a) => ctx.keyOf(a) === ctx.keyOf(action)) : null;
  if (legal) return `<button type="button" class="btn ${cls} btn--lit" data-akey="${esc(ctx.keyOf(legal))}" data-legal="1">${esc(label)}</button>`;
  const a = availability(reasonPair(ctx.state, action));
  const why = a ? a.text : 'Not available.';
  return `<span class="reasoned"><button type="button" class="btn ${cls}" disabled title="${esc(why)}" aria-disabled="true">${esc(label)}</button><small class="reasoned__why">${esc(why)}</small></span>`;
}

// ---------------------------------------------------------------------------
// The opened card
// ---------------------------------------------------------------------------

function openedCard(ctx) {
  const open = ctx.view.cardOpen;
  if (!open) return '';
  const { state } = ctx;
  let id = null;
  let name = '';
  let text = '';
  let sub = '';
  if (open.kind === 'agenda') {
    const c = legislativeCardData(state);
    if (!c) return '';
    id = cardArtId('agenda', c.number);
    name = c.name;
    text = c.text;
    sub = 'Legislative Agenda in force';
  } else if (open.kind === 'pony') {
    const c = ponyCardData(state, open.id);
    if (!c) return '';
    id = cardArtId('pony', c.number);
    name = c.name;
    text = c.text;
    sub = `Rank ${c.rank}, ${c.kind}`;
  } else if (open.kind === 'goal') {
    const c = goalsInPlay(state).find((g) => g.id === open.id);
    if (!c) return '';
    id = cardArtId('goal', c.number);
    name = c.name;
    text = c.text;
    sub = 'End-game goal';
  } else {
    return '';
  }
  return `<section class="opened" data-field="opened-card" aria-label="Card: ${esc(name)}">
      <div class="opened__pic">${id ? art(id, { cls: 'opened__img', label: name }) : ''}</div>
      <div class="opened__text"><h3>${esc(name)}</h3><div class="opened__sub">${esc(sub)}</div><p>${esc(text)}</p>
        <button type="button" class="btn btn--small" data-ui="card-close">Close the card (Escape)</button></div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

function upgradesTab(ctx) {
  const { state } = ctx;
  const m = state.modules.upgrades;
  const K = getConstants(state);
  const reasons = new Map();
  for (const id of m.display) {
    const tile = upgradeTileData(state, id);
    const a = ctx.interactive && !ctx.targets.byTarget.has(`upgrade:${id}`) ? availability(reasonPair(state, { type: 'installUpgrade', tile: id, level: tile.level })) : null;
    if (a) reasons.set(id, a.text);
  }
  // The reason most tiles share (the bonus action is not on offer, no Iron ...) is said once, above the tiles.
  const tally = new Map();
  for (const r of reasons.values()) tally.set(r, (tally.get(r) ?? 0) + 1);
  const common = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const sharedReason = common && common[1] >= Math.max(2, Math.ceil(m.display.length / 2)) ? common[0] : null;

  const tileHtml = (id) => {
    const tile = upgradeTileData(state, id);
    const entry = ctx.targets.byTarget.get(`upgrade:${id}`);
    const installs = entry ? entry.actions.map((a) => `<button type="button" class="btn btn--small btn--lit" data-akey="${esc(ctx.keyOf(a))}" data-legal="1">Install in carriage ${a.level}</button>`).join('') : '';
    const own = reasons.get(id);
    const why = !entry && own && own !== sharedReason ? `<small class="reasoned__why">${esc(own)}</small>` : '';
    return `<article class="utile${entry ? ' is-legal' : ''}" data-tile="${esc(id)}" data-tip="upgrade:${esc(id)}">
        ${art(upgradeArtId(id), { cls: 'utile__img', label: tile.name })}
        <div class="utile__text"><b>${esc(tile.name)}</b><span class="utile__level">Level ${tile.level}</span><span class="utile__effect">${esc(tile.text)}</span></div>
        ${installs ? `<div class="utile__buttons">${installs}</div>` : ''}${why}
      </article>`;
  };
  const levels = [1, 2, 3]
    .map((level) => {
      const ids = m.display.filter((id) => upgradeTileData(state, id).level === level);
      if (ids.length === 0) return '';
      return `<div class="ulevel"><h4>Level ${level} tiles</h4><div class="utiles">${ids.map(tileHtml).join('')}</div></div>`;
    })
    .join('');

  const installed = state.players
    .map((p) => {
      const c = ctx.who(p.id);
      const slots = m.installed[p.id]
        .map((tid, i) => {
          if (i >= p.train.specialistCarriages.length) return '';
          const tile = tid ? upgradeTileData(state, tid) : null;
          return `<li>${tile ? `<b>${esc(tile.name)}</b> (level ${tile.level}): ${esc(tile.text)}` : '<span class="muted">empty</span>'}<small> in carriage ${i + 1}</small></li>`;
        })
        .join('');
      return `<div class="uinst" style="--pc:${esc(c.colour)}">${dot(c.colour)} <b>${esc(c.name)}</b><ul>${slots}</ul></div>`;
    })
    .join('');

  return `${sharedReason ? `<p class="dock__note" data-field="upgrade-reason"><b>No tile can be installed now.</b> ${esc(sharedReason)}</p>` : ''}
    <div class="dock__cols"><div class="dock__main">${levels || '<p class="muted">Every tile has been taken.</p>'}</div>
    <aside class="dock__side"><h4>Installed in the trains</h4>${installed}</aside></div>
    <p class="dock__foot muted">${esc(`${m.display.length} of ${K.UPGRADE_TILES.length} tiles are still on display.`)}</p>`;
}

// ---------------------------------------------------------------------------
// Goals and milestones
// ---------------------------------------------------------------------------

function progressRows(ctx, item, goal) {
  const { state } = ctx;
  return state.players
    .map((p) => {
      const c = ctx.who(p.id);
      const pr = describeProgress(state, p.id, item);
      const pct = pr.known && pr.target ? Math.max(0, Math.min(100, Math.round((pr.value / pr.target) * 100))) : null;
      const stand = goal ? `<span class="prog__stand" data-standing="${p.id}">${esc(standingText(state, goal, p.id))}</span>` : '';
      return `<li class="prog" style="--pc:${esc(c.colour)}" data-player="${p.id}">
          ${dot(c.colour)}<span class="prog__name">${esc(c.name)}</span>
          <span class="prog__text${pr.met ? ' is-met' : ''}">${esc(pr.text)}</span>
          ${pct !== null ? `<span class="prog__bar" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}${stand}
        </li>`;
    })
    .join('');
}

function goalsTab(ctx) {
  const { state } = ctx;
  const K = getConstants(state);
  const parts = [];
  if (state.modules.milestones) {
    const index = cardIndex(K.MILESTONE_TILES);
    const cards = state.modules.milestones.inPlay
      .map((id) => {
        const tile = index.get(id);
        const by = state.modules.milestones.claimedBy[id];
        const claim = by !== null && by !== undefined ? ctx.who(by) : null;
        const turn = ctx.view.milestoneTurns[id];
        return `<article class="mcard${claim ? ' is-claimed' : ''}${flashClass(ctx, ctx.view.flash.milestones, id)}" data-milestone="${esc(id)}" data-claimed-by="${by ?? ''}" data-tip="milestone:${esc(id)}" style="${claim ? `--pc:${esc(claim.colour)};` : ''}${flashStyle(ctx)}">
            <div class="mcard__body">
              <div class="mcard__head"><b>${esc(tile.name)}</b><span class="mcard__vp">${tile.vp} VP</span></div>
              <div class="mcard__cond">${esc(tile.text)}</div>
              ${claim ? `<div class="mcard__claim" data-field="claimed">${dot(claim.colour)} Claimed by <b>${esc(claim.name)}</b>${turn ? ` on turn ${turn}` : ''}</div>` : `<ul class="progs">${progressRows(ctx, tile, null)}</ul>`}
            </div>
          </article>`;
      })
      .join('');
    parts.push(`<section class="gsec" data-section="milestones"><h3>Milestones</h3><div class="mcards">${cards}</div></section>`);
  }
  if (state.modules.goals) {
    const cards = goalsInPlay(state)
      .map((goal) => {
        const pic = cardArtId('goal', goal.number);
        return `<article class="gcard" data-goal="${esc(goal.id)}" data-tip="goal:${esc(goal.id)}">
            <button type="button" class="gcard__pic" data-ui="card" data-card="goal:${esc(goal.id)}" aria-label="Show the ${esc(goal.name)} card large" title="Show the card large">${pic ? art(pic, { cls: 'gcard__img', label: goal.name }) : ''}</button>
            <div class="gcard__body">
              <div class="mcard__head"><b>${esc(goal.name)}</b><span class="mcard__vp">end of game</span></div>
              <div class="mcard__cond">${esc(goal.text)}</div>
              <ul class="progs">${progressRows(ctx, goal, goal)}</ul>
            </div>
          </article>`;
      })
      .join('');
    parts.push(`<section class="gsec" data-section="goals"><h3>End-game goals</h3><div class="gcards">${cards}</div></section>`);
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Legislative Agenda
// ---------------------------------------------------------------------------

/** The always-visible one-line form of the agenda card in force. */
export function agendaCompact(ctx) {
  const card = legislativeCardData(ctx.state);
  if (!card) return '';
  return `<div class="dock__agenda" data-field="agenda-compact" data-tip="agenda:${esc(card.id)}">
      <span class="dock__agenda-label">Legislative Agenda</span>
      <b class="dock__agenda-name">${esc(card.name)}</b>
      <span class="dock__agenda-text">${esc(card.text)}</span>
      <button type="button" class="btn btn--small" data-ui="agenda-open" aria-label="Show the whole Legislative Agenda card">Full card</button>
    </div>`;
}

function agendaTab(ctx) {
  const card = legislativeCardData(ctx.state);
  const pic = cardArtId('agenda', card.number);
  return `<section class="agenda" data-section="agenda">
      <button type="button" class="agenda__pic" data-ui="card" data-card="agenda:${esc(card.id)}" aria-label="Show the card large" title="Show the card large">${pic ? art(pic, { cls: 'agenda__img', label: card.name }) : ''}</button>
      <div class="agenda__text"><h3>${esc(card.name)}</h3><p class="agenda__effect">${esc(card.text)}</p></div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Pony Express
// ---------------------------------------------------------------------------

function ponyCardHtml(ctx, id, rank) {
  const { state } = ctx;
  const card = ponyCardData(state, id);
  const cost = getConstants(state).PONY.costs[rank];
  const key = `pony:${id}`;
  const action = { type: 'buyPonyCard', card: id };
  const pic = cardArtId('pony', card.number);
  const kindText = { immediate: 'immediate', ongoing: 'ongoing', endgame: 'endgame' }[card.kind] ?? card.kind;
  const lit = ctx.interactive && ctx.targets.byTarget.has(key);
  return `<article class="pcard${lit ? ' is-legal' : ''}" data-card="${esc(id)}" data-rank="${esc(rank)}" data-tip="pony:${esc(id)}">
      <button type="button" class="pcard__pic" data-ui="card" data-card="pony:${esc(id)}" aria-label="Show ${esc(card.name)} large" title="Show the card large">${pic ? art(pic, { cls: 'pcard__img', label: card.name }) : ''}</button>
      <div class="pcard__body">
        <div class="pcard__head"><b>${esc(card.name)}</b><span class="pcard__cost" title="Cost in Pony Express tokens">${plural(cost, 'token', 'tokens')}</span></div>
        <div class="pcard__kind">${esc(kindText)}</div>
        <div class="pcard__text">${esc(card.text)}</div>
        ${actionOrReason(ctx, key, action, `Buy for ${plural(cost, 'token', 'tokens')}`)}
      </div>
    </article>`;
}

function ponyTab(ctx) {
  const { state } = ctx;
  const pony = state.modules.pony;
  const K = getConstants(state);
  const viewer = ctx.viewer;
  const free = ctx.frame && ctx.frame.kind === 'freeActions';
  const left = Object.values(pony.tokens).filter(Boolean).length;

  const tokens = state.players
    .map((p) => {
      const c = ctx.who(p.id);
      const mine = pony.players[p.id];
      return `<li class="ptok" style="--pc:${esc(c.colour)}" data-player="${p.id}" title="${esc(`${c.name} has collected ${mine.tokensCollected} tokens in the game and holds ${mine.tokensHeld}.`)}">${dot(c.colour)} <b>${esc(c.name)}</b> ${ponyToken({ cls: 'icon--inline' })} <span data-field="tokens-held">${mine.tokensHeld}</span> held <small>(${mine.tokensCollected} collected)</small></li>`;
    })
    .join('');

  const market = K.PONY.ranks
    .map((rank) => {
      const cards = pony.market[rank].map((id) => (id === null ? '<div class="pcard pcard--empty muted">No card here (the deck has run out)</div>' : ponyCardHtml(ctx, id, rank))).join('');
      return `<div class="prank" data-rank="${esc(rank)}"><h4>Rank ${esc(rank)} <small>${plural(K.PONY.costs[rank], 'token', 'tokens')} each</small></h4>${cards}</div>`;
    })
    .join('');

  const exchange = ['iron', 'wood', 'gunpowder']
    .map((r) => actionOrReason(ctx, `token:${r}`, { type: 'exchangeToken', resource: r }, `Return a token for 1 ${NAMES[r]}`))
    .join(' ');

  const cardsOf = (pid) => {
    const mine = pony.players[pid];
    return [...mine.ongoing, ...mine.endgame];
  };
  const own = cardsOf(viewer)
    .map((id) => {
      const card = ponyCardData(state, id);
      const ability = card.effects.some((e) => e.type === 'oncePerTurn');
      return `<li class="ocard" data-card="${esc(id)}" data-tip="owned:${esc(id)}"><b>${esc(card.name)}</b> <small>${esc(card.kind)}</small><span>${esc(card.text)}</span>${ability ? actionOrReason(ctx, `ability:${id}`, { type: 'usePonyCard', card: id }, 'Use it now') : ''}</li>`;
    })
    .join('');
  const others = state.players
    .filter((p) => p.id !== viewer)
    .map((p) => {
      const c = ctx.who(p.id);
      const list = cardsOf(p.id);
      return `<li class="ochip" style="--pc:${esc(c.colour)}">${dot(c.colour)} <b>${esc(c.name)}</b>: ${list.length ? list.map((id) => `<span class="chip chip--card" data-tip="owned:${esc(id)}">${esc(ponyCardData(state, id).name)}</span>`).join(' ') : '<span class="muted">no cards</span>'}</li>`;
    })
    .join('');

  const done = free
    ? ctx.targets.all
        .filter((a) => a.type === 'endFreeActions')
        .map((a) => `<button type="button" class="btn btn--primary btn--small" data-akey="${esc(ctx.keyOf(a))}" data-legal="1">Done with free actions</button>`)
        .join('')
    : '';
  const ongoing = ponyOngoing(state, viewer).length;
  const cap = state.variants.ponyOngoingCap;

  return `<div class="pony" data-section="pony">
      ${free ? `<p class="dock__note" data-field="free-actions"><b>A free-action opportunity is open</b> (${esc(ctx.frame.which)} your turn): buy a card, return a token, use a card, or finish. ${done}</p>` : ''}
      <ul class="ptoks">${tokens}</ul>
      <p class="muted pony__left">${plural(left, 'token', 'tokens')} still lie on the map.${cap ? ` You hold ${ongoing} of the ${cap} ongoing cards allowed.` : ''}</p>
      <div class="pmarket">${market}</div>
      <div class="pexchange"><h4>Exchange</h4><div class="pexchange__row">${exchange}</div></div>
      <div class="powned"><h4>Cards in play</h4><ul class="ocards">${own || '<li class="muted">You hold no ongoing or endgame cards.</li>'}</ul><ul class="ochips">${others}</ul></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// The dock
// ---------------------------------------------------------------------------

/**
 * The whole dock. '' when no module is in play.
 * ctx: state, view, targets, who, interactive, viewer, frame, keyOf, flashAge
 */
export function renderDock(ctx) {
  const { state, view } = ctx;
  const tabs = tabsInPlay(state.variants);
  if (tabs.length === 0) return '';
  const active = tabs.includes(view.dock.tab) ? view.dock.tab : tabs[0];
  const open = view.dock.open;
  const wanted = ctx.targets.wantedTab;
  const bar = tabs
    .map((t) => {
      const flash = ctx.flashAge >= 0 && view.flash.tabs.includes(t);
      return `<button type="button" role="tab" class="dock__tab${open && active === t ? ' is-active' : ''}${wanted === t ? ' is-wanted' : ''}${flash ? ' is-flash' : ''}" data-ui="tab:${t}" aria-selected="${open && active === t}" style="${flash ? `animation-delay:-${ctx.flashAge}ms;` : ''}">${TAB_TITLES[t]}${wanted === t ? ' <span class="dock__badge" title="This decision is about this module">!</span>' : ''}</button>`;
    })
    .join('');
  // The first tab is the train itself: lit while no panel is open, and the way back when one is.
  const home = open
    ? '<button type="button" class="dock__home" data-ui="dock-toggle" aria-pressed="false" title="Close the panel and show the train again (Escape)">Train</button>'
    : '<span class="dock__home is-active" aria-current="true">Train</span>';
  let body = '';
  if (open) {
    const content = active === 'upgrades' ? upgradesTab(ctx) : active === 'goals' ? goalsTab(ctx) : active === 'agenda' ? agendaTab(ctx) : ponyTab(ctx);
    body = `<div class="dock__body" role="tabpanel" data-tab="${active}">${openedCard(ctx)}${content}</div>`;
  }
  return `<div class="dock${open ? ' is-open' : ''}" data-open="${open ? 1 : 0}" data-active="${active}">
      <div class="dock__bar" role="tablist" aria-label="The train and the add-on modules">${home}${bar}</div>
      ${agendaCompact(ctx)}
      ${body}
    </div>`;
}

