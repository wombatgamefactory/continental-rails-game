// log.js - turns the events returned by applyAction into the readable game log
// and into the brief highlights.
//
// The state carries no log (contract section 13). The page keeps its own list
// of entries, built here. One entry per applied action, including the actions
// the engine made for a player because there was only one legal choice
// (`auto: true`): those are marked so the player can see why the game moved on.

import { formatCost, MAP, NAMES, ponyCardData, upgradeTileData } from '../engine/index.js';

/** Player-facing names of the VP sources (R20.1, R20.2). */
export const VP_LABELS = {
  track: 'Track laid',
  firstConnection: 'First connections',
  completion: 'Transcontinental line',
  telegraph: 'Telegraph stations',
  toll: 'Railway station tolls',
  congress: 'Congress',
  upgrades: 'Carriage upgrades',
  milestones: 'Milestones',
  legislative: 'Legislative Agenda',
  ponyCards: 'Pony Express cards',
  buildingsEnd: 'Buildings on the map (final)',
  goals: 'End-game goals (final)',
  ponyEnd: 'Pony Express (final)',
};

export const END_REASON_TEXT = {
  transcontinental: 'A transcontinental line was completed.',
  'routes-claimed': 'Enough routes were claimed to fill the map.',
  'turn-limit': 'The safety turn limit was reached (a digital-only stop, not a rule of the tabletop game).',
};

export const TIE_BREAK_TEXT = {
  vp: 'Decided on victory points.',
  buildings: 'Tied on VP: decided by most buildings on the map.',
  ownedSlots: 'Tied on VP and buildings: decided by most slots in routes owned.',
  cargo: 'Tied on VP, buildings and slots: decided by most resources and built tiles in storage.',
  turnOrder: 'Tied on everything else: decided by turn order (the start player counts as closest).',
};

function cityLabel(id) {
  return MAP.cityById[id] ? MAP.cityById[id].name : String(id);
}

function itemLabel(item) {
  return NAMES[item] ?? item;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One line (or null) for an event other than the leading `action` event.
 * @returns {{ text: string, kind: string } | null}
 */
function describeEvent(state, ev, nameOf) {
  const who = (id) => (id === undefined || id === null ? '' : nameOf(id));
  const cardName = (id) => (ponyCardData(state, id) || { name: id }).name;
  const tileName = (id) => (upgradeTileData(state, id) || { name: id }).name;
  switch (ev.type) {
    case 'action':
      return null;
    case 'gain': {
      if (ev.item === 'hats') return { text: `+${plural(ev.amount, 'cowboy hat', 'cowboy hats')}`, kind: 'gain' };
      if (ev.built) return { text: `+${plural(ev.amount, `built ${itemLabel(ev.item)} tile`, `built ${itemLabel(ev.item)} tiles`)} (in storage on the train)`, kind: 'build' };
      return { text: `+${ev.amount} ${itemLabel(ev.item)}`, kind: 'gain' };
    }
    case 'pay':
      return { text: `Paid ${formatCost(state, ev.cost)}`, kind: 'pay' };
    case 'vp':
      return { text: `${ev.amount >= 0 ? '+' : ''}${ev.amount} VP (${VP_LABELS[ev.source] ?? ev.source})`, kind: 'vp' };
    case 'hatLimit':
      return { text: `At the cowboy hat limit: ${plural(ev.resourcesOwed, 'resource', 'resources')} of choice instead`, kind: 'note' };
    case 'discard':
      return { text: `Discarded 1 ${itemLabel(ev.item)} (storage ${ev.used} of ${ev.capacity})`, kind: 'pay' };
    case 'workerReturned':
      return { text: `${who(ev.player)}'s worker returned from ${ev.space}`, kind: 'note' };
    case 'districtChosen':
      return { text: `Multiplier ${ev.multiplier}${ev.adjacent ? ` (${plural(ev.adjacent, 'adjacent worker', 'adjacent workers')}${ev.hat ? ' and a cowboy hat' : ''})` : ev.hat ? ' (with a cowboy hat)' : ''}`, kind: 'note' };
    case 'gather':
      return { text: `Gathered ${ev.amount} ${ev.item === 'coins' ? 'Coins' : itemLabel(ev.item)} (production ${ev.production} x ${ev.multiplier})`, kind: 'gain' };
    case 'carriageAdded':
      return { text: `Added a ${ev.carriage} carriage (now ${ev.specialistCarriages} specialist, ${ev.storageCarriages} storage)`, kind: 'note' };
    case 'hire':
      return { text: `Hired a ${itemLabel(ev.specialist)} into the level ${ev.level} carriage`, kind: 'note' };
    case 'trainActivation':
      return { text: `Train activation: Foreman acts as ${itemLabel(ev.foreman)}, ${plural(ev.steps, 'step', 'steps')}`, kind: 'note' };
    case 'build':
      return {
        text: `Built ${ev.amount} ${itemLabel(ev.terrain)} tile${ev.amount === 1 ? '' : 's'} with ${ev.level === 0 ? 'the Foreman' : `a level ${ev.level} ${itemLabel(ev.specialist)}`}`,
        kind: 'build',
      };
    case 'lobbyPoint':
      return { text: `+1 lobby point (${ev.total} in hand)`, kind: 'note' };
    case 'lobbyPointsLost':
      return { text: `${plural(ev.amount, 'lobby point', 'lobby points')} unused and lost`, kind: 'note' };
    case 'congressEntry':
      return { text: `Congress entry ${ev.entry}: ${ev.text}`, kind: 'congress' };
    case 'senatorsReset':
      return { text: `${plural(ev.count, 'senator', 'senators')} returned`, kind: 'congress' };
    case 'routeClaimed': {
      const r = MAP.routeById[ev.route];
      return { text: `Laid tracks on ${r ? `${cityLabel(r.a)} - ${cityLabel(r.b)}` : ev.route} (${plural(ev.slots, 'slot', 'slots')})${ev.to ? `, railhead now in ${cityLabel(ev.to)}` : ''}`, kind: 'lay' };
    }
    case 'firstConnection':
      return { text: `First connection to ${cityLabel(ev.city)}`, kind: 'lay' };
    case 'toll':
      return { text: `Toll at ${cityLabel(ev.city)}: ${who(ev.player)}'s railway station`, kind: 'vp' };
    case 'railheadMoved':
      return { text: `Railhead moved ${cityLabel(ev.from)} to ${cityLabel(ev.to)}`, kind: 'lay' };
    case 'buildingPlaced':
      return {
        text:
          ev.kind === 'railwayStation'
            ? `Placed a railway station in ${cityLabel(ev.city)} (a house left the ${itemLabel(ev.houseTrack)} track)`
            : `Placed a telegraph station in ${cityLabel(ev.city)}${ev.vp !== undefined ? ` (+${ev.vp} VP)` : ''}`,
        kind: 'lay',
      };
    case 'completion':
      return { text: `Transcontinental line completed (+${ev.bonus} VP)`, kind: 'vp' };
    case 'turnStart':
      return { text: `Turn ${ev.turn}`, kind: 'turn' };
    case 'turnEnd':
      return null;
    case 'roundEnd':
      return { text: 'Round over: workers return to supplies', kind: 'note' };
    case 'gameEndTriggered':
      return { text: `The game end has been triggered (${ev.reason}); the round will be completed`, kind: 'note' };
    case 'gameOver':
      return { text: 'Game over', kind: 'note' };
    case 'railheadPlaced':
      return { text: `Railhead on ${cityLabel(ev.city)}`, kind: 'note' };
    case 'startingProduction':
      return { text: `${itemLabel(ev.track)} starts at production 2`, kind: 'note' };
    case 'setupComplete':
      return { text: 'Setup complete', kind: 'note' };
    case 'milestoneClaimed':
      return { text: `Milestone claimed: ${ev.name} (+${ev.vp} VP)`, kind: 'milestone' };
    case 'ponyToken':
      return { text: `Took the Pony Express token in ${cityLabel(ev.city)}`, kind: 'gain' };
    case 'ponyCardBought':
      return { text: `Bought Pony Express card ${cardName(ev.card)} for ${plural(ev.cost, 'token', 'tokens')}`, kind: 'gain' };
    case 'ponyMarketRefill':
      return { text: `Pony Express market refilled (rank ${ev.rank})`, kind: 'note' };
    case 'tokenExchanged':
      return { text: `Returned 1 Pony Express token for 1 ${itemLabel(ev.resource)}`, kind: 'gain' };
    case 'ponyCardUsed':
      return { text: `Used Pony Express card ${cardName(ev.card)}`, kind: 'note' };
    case 'resourceReturned':
      return { text: `Gave back 1 ${itemLabel(ev.resource)}`, kind: 'pay' };
    case 'foremanType':
      return { text: `The Foreman acts as ${itemLabel(ev.specialist)}`, kind: 'note' };
    case 'extraActivation':
      return { text: `Extra activation of the level ${ev.level} specialist in slot ${ev.slot}`, kind: 'note' };
    case 'activationsDoubled':
      return { text: `${itemLabel(ev.specialist)} activations are doubled this turn`, kind: 'note' };
    case 'upgradeStep':
      return { text: `Upgrade tile ${tileName(ev.tile)} acts (level ${ev.level} carriage)`, kind: 'note' };
    case 'upgradeInstalled':
      return { text: `Installed upgrade ${tileName(ev.tile)} in the level ${ev.level} carriage`, kind: 'build' };
    case 'bonusAction':
      return { text: `${ev.free ? 'Free ' : ''}bonus action taken: ${{ upgrade: 'carriage upgrade', hire: 'hire a specialist', hat: 'buy a cowboy hat', carriage: 'add a carriage' }[ev.bonus] ?? ev.bonus}`, kind: 'note' };
    default: {
      const bits = Object.entries(ev)
        .filter(([k, v]) => !['type', 'seq', 'player'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        .map(([k, v]) => `${k} ${v}`);
      return { text: `${ev.type}${bits.length ? ': ' + bits.join(', ') : ''}`, kind: 'note' };
    }
  }
}

/**
 * Builds log entries from the events of one applyAction call.
 * An entry is { seq, player, name, text, auto, source, details: [{ text, kind }], turn }.
 * `state` is the state after the action (names do not change).
 */
export function entriesFromEvents(state, events, source = 'human', who = null) {
  // `who(pid)` gives { name, colour } (with the fallbacks for a state that carries neither).
  const identity = who ?? ((pid) => ({ name: state.players[pid].name, colour: state.players[pid].colour || '#888888' }));
  const nameOf = (pid) => identity(pid).name;
  const entries = [];
  let current = null;
  for (const ev of events) {
    if (ev.type === 'action') {
      current = {
        seq: ev.seq,
        player: ev.player,
        name: nameOf(ev.player),
        colour: identity(ev.player).colour,
        text: ev.text,
        auto: !!ev.auto,
        source,
        details: [],
        turn: null,
      };
      entries.push(current);
      continue;
    }
    const line = describeEvent(state, ev, nameOf);
    if (line === null) continue;
    if (line.kind === 'turn') {
      // A turn marker starts its own entry so the log shows whose turn it is.
      entries.push({ seq: ev.seq, player: ev.player, name: nameOf(ev.player), colour: identity(ev.player).colour, text: line.text, auto: false, source, details: [], turn: ev.turn });
      current = null;
      continue;
    }
    if (current === null) {
      current = { seq: ev.seq, player: ev.player ?? null, name: ev.player === undefined ? '' : nameOf(ev.player), colour: ev.player === undefined ? '#888888' : identity(ev.player).colour, text: '', auto: false, source, details: [], turn: null };
      entries.push(current);
    }
    current.details.push(line);
  }
  return entries;
}

/** What the events touched, for a brief highlight on the board. */
export function flashFromEvents(events) {
  const flash = { routes: [], cities: [], districts: [], spaces: [], players: [], milestones: [], tabs: [] };
  for (const ev of events) {
    switch (ev.type) {
      case 'routeClaimed':
        flash.routes.push(ev.route);
        if (ev.to) flash.cities.push(ev.to);
        break;
      case 'railheadMoved':
        flash.cities.push(ev.to);
        break;
      case 'buildingPlaced':
      case 'firstConnection':
        flash.cities.push(ev.city);
        break;
      case 'railheadPlaced':
        flash.cities.push(ev.city);
        break;
      case 'districtChosen':
        flash.districts.push(ev.district);
        break;
      case 'milestoneClaimed':
        flash.milestones.push(ev.milestone);
        flash.tabs.push('goals');
        break;
      case 'ponyToken':
        flash.cities.push(ev.city);
        flash.tabs.push('pony');
        break;
      case 'ponyCardBought':
      case 'tokenExchanged':
        flash.tabs.push('pony');
        break;
      case 'upgradeInstalled':
        flash.tabs.push('upgrades');
        break;
      case 'action':
        if (ev.action.type === 'placeWorker') flash.spaces.push(ev.action.space);
        if (ev.action.type === 'removeWorker') flash.spaces.push(ev.action.from);
        if (ev.action.type === 'displaceWorker') flash.districts.push(ev.action.district);
        break;
      default:
        break;
    }
    if (ev.player !== undefined && ev.player !== null) flash.players.push(ev.player);
  }
  return flash;
}

/** Whether any event reveals hidden information (a card drawn from a deck): undo must then be cleared. */
export function revealsHiddenInformation(events) {
  return events.some((ev) => ev.type === 'ponyMarketRefill');
}
