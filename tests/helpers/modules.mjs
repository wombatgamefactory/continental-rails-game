// Set-up helpers for the module suites (rules-modules and the module part of the
// smoke, determinism and purity suites). Not a suite.
//
// A state is built with createGame (through rig.start, which switches every
// module off) and adjusted by hand: the module a test is about is switched on
// by its variant, tokens and cards are handed out, tiles are installed. The
// action under test always goes through applyAction.

import assert from 'node:assert/strict';
import { RULES, topFrame, getValidActions, actionKey, SPACE_IDS, SPACE_DISTRICTS } from '../../src/engine/index.js';
import { start, MODULES_OFF, put, act, take, give, setTrain, setHeads, claim, placeAndChoose, types } from './rig.mjs';

export { start, MODULES_OFF, put, act, take, give, setTrain, setHeads, claim, placeAndChoose, types };

/** Variants that switch one module on (the others stay off in `rig.start`). */
export const UPGRADES = { moduleCarriageUpgrades: true };
export const MILESTONES = { endGameScoring: 'milestones' };
export const GOALS = { endGameScoring: 'goals' };
export const PONY = { modulePonyExpress: true };
/** The Legislative Agenda with card number `n` in force. */
export const legislative = (n) => ({ moduleLegislativeAgenda: true, legislativeAgendaCard: n });

/** Every module on, and the Legislative Agenda card named. */
export const ALL_ON = (n = 1) => ({
  moduleCarriageUpgrades: true,
  endGameScoring: 'both',
  moduleLegislativeAgenda: true,
  legislativeAgendaCard: n,
  modulePonyExpress: true,
});

/** A game past setup with the given variants on top of `rig.start`'s defaults (every module off). */
export function startWith(players, variants = {}, options = {}) {
  return start(players, { ...options, variants });
}

/** The pending decision's kind. */
export function kind(state) {
  const f = topFrame(state);
  return f === null ? null : f.kind;
}

/** The action keys on offer, sorted. */
export function keys(state) {
  return getValidActions(state).map(actionKey).sort();
}

/** Gives a player tokens by hand (held and, by default, collected). */
export function giveTokens(state, playerId, held, collected = held) {
  const mine = state.modules.pony.players[playerId];
  mine.tokensHeld = held;
  mine.tokensCollected = collected;
}

function removeFromDecks(pony, cardId) {
  for (const rank of Object.keys(pony.decks)) {
    const i = pony.decks[rank].indexOf(cardId);
    if (i >= 0) pony.decks[rank].splice(i, 1);
  }
  for (const rank of Object.keys(pony.market)) {
    const i = pony.market[rank].indexOf(cardId);
    if (i >= 0) pony.market[rank][i] = pony.decks[rank].length > 0 ? pony.decks[rank].pop() : null;
  }
}

/**
 * Puts a Pony Express card face up in the first place of its rank in the market,
 * sending the card that was there back to the top of its deck. The card is
 * taken out of wherever it was, so every card is still in exactly one place.
 */
export function stock(state, cardId, slot = 0) {
  const pony = state.modules.pony;
  const card = RULES.PONY_CARDS.find((c) => c.id === cardId);
  assert.ok(card, `no card ${cardId}`);
  const rank = card.rank;
  if (pony.market[rank][slot] === cardId) return;
  const at = pony.market[rank].indexOf(cardId);
  if (at >= 0) {
    // already face up in the other place: swap
    pony.market[rank][at] = pony.market[rank][slot];
    pony.market[rank][slot] = cardId;
    return;
  }
  const d = pony.decks[rank].indexOf(cardId);
  assert.ok(d >= 0, `${cardId} is held by a player: it cannot be stocked`);
  pony.decks[rank].splice(d, 1);
  const displaced = pony.market[rank][slot];
  if (displaced !== null) pony.decks[rank].push(displaced);
  pony.market[rank][slot] = cardId;
}

/** Hands a player an ongoing or endgame card as if they had bought it earlier. */
export function ownCard(state, playerId, cardId) {
  const pony = state.modules.pony;
  const card = RULES.PONY_CARDS.find((c) => c.id === cardId);
  assert.ok(card && card.kind !== 'immediate', `${cardId} is not a card that is kept`);
  removeFromDecks(pony, cardId);
  (card.kind === 'ongoing' ? pony.players[playerId].ongoing : pony.players[playerId].endgame).push(cardId);
}

/** Installs an upgrade tile by hand (it leaves the display). */
export function installTile(state, playerId, level, tileId) {
  const m = state.modules.upgrades;
  const at = m.display.indexOf(tileId);
  if (at >= 0) m.display.splice(at, 1);
  m.installed[playerId][level - 1] = tileId;
}

/**
 * Plays the current player's turn as a Gather action of `district` (Gather Coins by
 * default) on a free worker space of that district, and skips the bonus action,
 * so that the free-action opportunity after the turn (if any) is what comes next.
 * If both its spaces are taken, another Gather district with a free space is used.
 * Returns the events.
 */
export function gatherTurn(state, district = 'D9') {
  const order = [district, ...['D9', 'D7', 'D3', 'D1'].filter((d) => d !== district)];
  let chosen = district;
  let space;
  for (const d of order) {
    space = SPACE_IDS.find((w) => state.grid.spaces[w] === null && SPACE_DISTRICTS[w].includes(d));
    chosen = d;
    if (space !== undefined) break;
  }
  let events;
  if (space !== undefined) {
    events = placeAndChoose(state, space, chosen);
  } else {
    const own = SPACE_IDS.find((w) => state.grid.spaces[w] === state.toAct && SPACE_DISTRICTS[w].includes('D9'));
    assert.ok(own !== undefined, 'no Gather worker space is free or held by the player');
    events = act(state, { type: 'removeWorker', from: own });
    events.push(...act(state, { type: 'chooseDistrict', district: 'D9', hat: false }));
  }
  if (kind(state) === 'bonusAction') events.push(...act(state, { type: 'skipBonusAction' }));
  return events;
}

/** A turn of Gather Coins: see gatherTurn. */
export function gatherCoinsTurn(state) {
  return gatherTurn(state, 'D9');
}

/** The VP events of a list of events, by source and player: `{ source: total }`. */
export function vpOf(events, playerId) {
  const out = {};
  for (const e of events) {
    if (e.type === 'vp' && (playerId === undefined || e.player === playerId)) out[e.source] = (out[e.source] ?? 0) + e.amount;
  }
  return out;
}

/** Takes the first `type` action matching `match`, if there is one on offer; otherwise returns null. */
export function maybeTake(state, type, match = {}) {
  const found = getValidActions(state).find((a) => a.type === type && Object.keys(match).every((k) => a[k] === match[k]));
  return found ? act(state, found) : null;
}
