// scoring-popup.js - the scoring arithmetic for an action that scores several
// ways at once (a route claim: track VP, first connection, agenda bonus, card
// bonus, milestone, transcontinental bonus; a train activation with upgrade VP).
//
// Built only from the `vp` events the engine returned (one per source, per
// scoring) plus the neighbouring events that say what the VP were for. Nothing
// is recomputed: an amount on screen is an amount in an event.

import { MAP, ponyCardData, upgradeTileData } from '../engine/index.js';
import { VP_LABELS } from './log.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function cityName(id) {
  return MAP.cityById[id] ? MAP.cityById[id].name : String(id);
}

/** What the VP of one source were for, from the other events of the same call. Returns { text, per } */
function detailFor(state, source, events, playerId) {
  const mine = events.filter((e) => e.player === playerId);
  switch (source) {
    case 'track': {
      const claims = mine.filter((e) => e.type === 'routeClaimed');
      if (claims.length === 0) return { text: '', slots: 0 };
      const names = claims.map((c) => {
        const r = MAP.routeById[c.route];
        return r ? `${cityName(r.a)} - ${cityName(r.b)}` : c.route;
      });
      return { text: names.join(', '), slots: claims.reduce((n, c) => n + c.slots, 0) };
    }
    case 'firstConnection':
      return { text: mine.filter((e) => e.type === 'firstConnection').map((e) => `connected ${cityName(e.city)}`).join(', ') };
    case 'telegraph':
      return { text: mine.filter((e) => e.type === 'buildingPlaced' && e.kind === 'telegraphStation').map((e) => `telegraph station in ${cityName(e.city)}`).join(', ') };
    case 'milestones':
      return { text: mine.filter((e) => e.type === 'milestoneClaimed').map((e) => e.name).join(', ') };
    case 'upgrades':
      return { text: mine.filter((e) => e.type === 'upgradeStep' || e.type === 'upgradeInstalled').map((e) => (upgradeTileData(state, e.tile) || { name: e.tile }).name).join(', ') };
    case 'ponyCards':
      return { text: mine.filter((e) => e.type === 'ponyCardBought' || e.type === 'ponyCardUsed').map((e) => (ponyCardData(state, e.card) || { name: e.card }).name).join(', ') };
    case 'toll':
      return { text: events.filter((e) => e.type === 'toll' && e.player === playerId).map((e) => `toll at ${cityName(e.city)}`).join(', ') };
    case 'completion':
      return { text: 'line completed from coast to coast' };
    default:
      return { text: '' };
  }
}

/**
 * Groups the vp events of one applyAction call by player and source, with the
 * arithmetic for each line. Only players who scored in at least two ways (two
 * sources) are returned: that is "scored several ways at once".
 *
 * @param {object} state the state AFTER the call (for card and tile names)
 * @param {object[]} events the events applyAction returned
 * @param {(pid: number) => { name: string, colour: string }} who
 * @returns {{ player: number, name: string, colour: string, total: number, lines: { source: string, label: string, detail: string, sum: string, amount: number }[] }[]}
 */
export function scoringBreakdown(state, events, who) {
  const byPlayer = new Map();
  for (const ev of events) {
    if (ev.type !== 'vp' || !ev.amount) continue;
    if (!byPlayer.has(ev.player)) byPlayer.set(ev.player, new Map());
    const sources = byPlayer.get(ev.player);
    if (!sources.has(ev.source)) sources.set(ev.source, []);
    sources.get(ev.source).push(ev.amount);
  }
  const groups = [];
  for (const [player, sources] of byPlayer) {
    if (sources.size < 2) continue;
    const lines = [];
    let total = 0;
    for (const [source, amounts] of sources) {
      const amount = amounts.reduce((a, b) => a + b, 0);
      total += amount;
      const detail = detailFor(state, source, events, player);
      const same = amounts.every((a) => a === amounts[0]);
      let sum;
      if (source === 'track' && detail.slots > 0 && amount % detail.slots === 0) sum = `${plural(detail.slots, 'slot', 'slots')} × ${amount / detail.slots} VP = ${amount}`;
      else if (amounts.length > 1 && same) sum = `${amounts.length} × ${amounts[0]} VP = ${amount}`;
      else if (amounts.length > 1) sum = `${amounts.join(' + ')} = ${amount}`;
      else sum = `${amount} VP`;
      lines.push({ source, label: VP_LABELS[source] ?? source, detail: detail.text, sum, amount });
    }
    const w = who(player);
    groups.push({ player, name: w.name, colour: w.colour, total, lines });
  }
  return groups;
}

/** A single sentence for the log: "Scored 12 VP: Track laid 2 + First connections 5 + ...". */
export function scoringSummary(group) {
  return `Scored ${group.total} VP in ${group.lines.length} ways: ${group.lines.map((l) => `${l.label} ${l.amount >= 0 ? '+' : ''}${l.amount}`).join(', ')}`;
}

/** The pop-up as HTML. `popup` is { id, groups }. */
export function renderPopup(popup) {
  if (!popup) return '';
  const blocks = popup.groups
    .map(
      (g) => `<section class="popup__group" style="--pc:${esc(g.colour)}" data-player="${g.player}">
        <div class="popup__who"><span class="score__dot"></span> <b>${esc(g.name)}</b> scores <b data-field="popup-total">${g.total >= 0 ? '+' : ''}${g.total} VP</b></div>
        <ul class="popup__lines">${g.lines
          .map(
            (l) => `<li data-source="${esc(l.source)}"><span class="popup__label">${esc(l.label)}</span>${l.detail ? `<span class="popup__detail">${esc(l.detail)}</span>` : ''}<span class="popup__sum">${esc(l.sum)}</span></li>`,
          )
          .join('')}</ul>
      </section>`,
    )
    .join('');
  return `<aside class="popup" role="status" data-field="scoring-popup" data-popup-id="${popup.id}">
      <div class="popup__head"><b>Scoring</b><button type="button" class="popup__close" data-ui="popup-close" aria-label="Dismiss the scoring pop-up" title="Dismiss (Escape)">&times;</button></div>
      ${blocks}
    </aside>`;
}

