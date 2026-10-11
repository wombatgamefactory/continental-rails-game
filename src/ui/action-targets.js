// action-targets.js - the ONE mapping from legal actions to things on screen.
//
// The engine lists what the player may do (getValidActions). This module turns
// that list into clickable targets: a worker space, a district, a route, a
// city, a Congress entry, a storage chip, a button in the decision panel. It
// never decides what is legal; an action that the engine did not list has no
// target, and a target exists only because an action does.
//
// Every action is routed by its type and parameters. An action that no rule in
// `route()` knows is NOT covered and falls to the generic layer: a plain button
// labelled with describeAction. The generic layer is therefore always complete,
// and a new action type added to the engine works in the UI the day it exists.
//
// Targets are keyed "kind:id" (space:W4, district:D5, route:SEA-SPO, city:SPO,
// congress:C3, store:iron, house:wood). The DOM carries that key and nothing
// else; main.js looks it up here when something is clicked.

import {
  actionKey,
  describeAction,
  getBlockReason,
  previewMultipliers,
  districtInfo,
  moveTrainPath,
  formatRouteCost,
  routeShortfall,
  production,
  hireCost,
  formatCost,
  topFrame,
  MAP,
  NAMES,
  upgradeTileData,
} from '../engine/index.js';
import { simulate, followUpsFromEvents, consequenceSentence } from './preview.js';

/** Action types that become the buttons of the prompt banner (the "stop / go on" family). */
const PRIMARY_STOPS = new Set(['useStep']);
const SECONDARY_STOPS = new Set([
  'skipStep',
  'closeCongress',
  'stopLaying',
  'skipBuilding',
  'skipBonusAction',
  'endFreeActions',
  'skipEffect',
  'declineFreeEntry',
]);

/** Resource / tile / specialist art ids by engine id. */
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

/**
 * Which module panel an action type belongs to. The module dock opens itself on
 * the tab of the first legal action found here (a decision "concerns" a module
 * when one of its actions is among the legal ones). Tab ids: upgrades, goals,
 * agenda, pony.
 */
export const MODULE_OF_ACTION = {
  installUpgrade: 'upgrades',
  buyPonyCard: 'pony',
  exchangeToken: 'pony',
  usePonyCard: 'pony',
  returnResource: 'pony',
  chooseForemanType: 'pony',
  chooseSpecialistType: 'pony',
  chooseExtraActivation: 'pony',
  declineFreeEntry: 'agenda',
};

/**
 * Which parts of the screen the pending decision is about. A target outside the
 * scope is drawn dimmed ("out of scope"); a target inside the scope that is not
 * legal is drawn "illegal but clickable", so that the click can say why.
 */
const SCOPE_BY_KIND = {
  workerStep: ['spaces'],
  chooseDistrict: ['districts'],
  layTracks: ['map'],
  placeBuildings: ['map'],
  setupRailhead: ['map'],
  freeCongress: ['congress'],
  discard: ['store'],
  setupProduction: ['houses'],
  freeActions: ['modules'],
  bonusAction: ['modules'],
};

/** The screen region each kind of target lives in. */
const REGION_OF = {
  space: 'spaces',
  centre: 'spaces',
  district: 'districts',
  route: 'map',
  city: 'map',
  congress: 'congress',
  store: 'store',
  house: 'houses',
  upgrade: 'modules',
  pony: 'modules',
  token: 'modules',
  ability: 'modules',
};

/** The regions the decision `frame` is about (a Set of the names used by REGION_OF). */
export function scopeOf(frame) {
  const scope = new Set(frame ? SCOPE_BY_KIND[frame.kind] ?? [] : []);
  if (frame && frame.kind === 'trainActivation' && frame.congress) scope.add('congress');
  return scope;
}

/** 'legal', 'illegal' (in scope, clickable so the click explains itself) or 'out' (dimmed) for a target key. */
export function targetState(targets, kind, key) {
  if (targets.byTarget.has(key)) return 'legal';
  return targets.scope.has(REGION_OF[kind]) ? 'illegal' : 'out';
}

/**
 * Builds every target for the current decision.
 *
 * @param {object} state the game state (read only)
 * @param {object[]} actions getValidActions(state)
 * @param {{ generic: boolean, hat: boolean }} opts generic: force the generic layer only; hat: the hat toggle
 */
export function buildTargets(state, actions, opts) {
  const targets = {
    byTarget: new Map(),
    covered: new Set(),
    primary: [],
    secondary: [],
    panels: [],
    districts: { previews: {}, hatAvailable: false, anyDistrict: false },
    generic: [],
    all: actions,
    scope: scopeOf(topFrame(state)),
    wantedTab: null,
  };
  const modular = actions.find((a) => MODULE_OF_ACTION[a.type]);
  if (modular) targets.wantedTab = MODULE_OF_ACTION[modular.type];

  if (opts.generic) {
    targets.generic = actions.slice();
    return targets;
  }

  const addTarget = (kind, id, action) => {
    const key = `${kind}:${id}`;
    let entry = targets.byTarget.get(key);
    if (!entry) {
      entry = { kind, id, actions: [] };
      targets.byTarget.set(key, entry);
    }
    entry.actions.push(action);
    targets.covered.add(actionKey(action));
  };
  const addPanel = (id, title, hint, action, item) => {
    let panel = targets.panels.find((p) => p.id === id);
    if (!panel) {
      panel = { id, title, hint, items: [] };
      targets.panels.push(panel);
    }
    panel.items.push({ action, key: actionKey(action), label: describeAction(state, action), ...item });
    targets.covered.add(actionKey(action));
  };

  for (const action of actions) {
    switch (action.type) {
      // ---- the action grid ----
      case 'placeWorker':
        addTarget('space', action.space, action);
        break;
      case 'displaceWorker':
        addTarget('centre', action.district, action);
        break;
      case 'removeWorker':
        addTarget(/^W/.test(action.from) ? 'space' : 'centre', action.from, action);
        break;
      case 'chooseDistrict':
        if (action.district === 'none') {
          targets.secondary.push(action);
          targets.covered.add(actionKey(action));
        } else {
          addTarget('district', action.district, action);
          targets.districts.anyDistrict = true;
          if (action.hat) targets.districts.hatAvailable = true;
        }
        break;

      // ---- the map ----
      case 'claimRoute':
        addTarget('route', action.route, action);
        break;
      case 'moveTrain':
        addTarget('city', action.to, action);
        break;
      case 'placeRailhead':
        addTarget('city', action.city, action);
        break;
      case 'placeRailwayStation':
      case 'placeTelegraphStation':
        addTarget('city', action.city, action);
        addPanel(`buildings:${action.city}`, `Place a building in ${MAP.cityById[action.city].name}`, null, action, {
          art: action.type === 'placeRailwayStation' ? 'icon-building' : null,
          building: action.type === 'placeRailwayStation' ? 'railwayStation' : 'telegraphStation',
        });
        break;

      // ---- Congress ----
      case 'takeCongressEntry':
        addTarget('congress', action.entry, action);
        break;

      // ---- storage and player board ----
      case 'discard':
        addTarget('store', action.item, action);
        addPanel('discard', 'Discard from storage (click an item here or in your storage)', null, action, { art: ITEM_ART[action.item], item: action.item });
        break;
      case 'chooseStartingProduction':
        addTarget('house', action.track, action);
        addPanel('production', 'Which house track starts at production 2?', 'Click a track on your player board, or a button here.', action, { art: ITEM_ART[action.track], item: action.track });
        break;
      case 'chooseStartingSpecialist':
        addPanel('specialist-start', 'Choose your free starting specialist', null, action, { art: ITEM_ART[action.specialist], item: action.specialist });
        break;
      case 'chooseResource':
        addPanel('resource', 'Take a resource of your choice', null, action, { art: ITEM_ART[action.resource], item: action.resource });
        break;
      case 'chooseBuiltTile':
        addPanel('built-tile', 'Take a built track tile of your choice', 'It goes to your storage on the train, not onto the map.', action, { art: ITEM_ART[action.terrain], item: action.terrain });
        break;

      // ---- bonus actions and train building ----
      case 'buyHat':
        addPanel('bonus', 'Bonus action', null, action, { art: 'bonus-buy-hat' });
        break;
      case 'addCarriage':
        addPanel('carriage', 'Add a carriage', null, action, { art: action.carriage === 'storage' ? 'train-storage-carriage' : 'icon-carriage' });
        break;
      case 'hireSpecialist':
        addPanel('hire', 'Hire a specialist', null, action, { art: ITEM_ART[action.specialist], item: action.specialist, sub: hireText(state, action) });
        break;
      case 'installUpgrade':
        addTarget('upgrade', action.tile, action);
        addPanel('bonus', 'Bonus action', null, action, { art: 'bonus-carriage-upgrade' });
        break;

      // ---- Pony Express ----
      case 'buyPonyCard':
        addTarget('pony', action.card, action);
        break;
      case 'exchangeToken':
        addTarget('token', action.resource, action);
        break;
      case 'usePonyCard':
        addTarget('ability', action.card, action);
        break;
      case 'returnResource':
        addPanel('return', 'Give back a resource', null, action, { art: ITEM_ART[action.resource], item: action.resource });
        break;
      case 'chooseForemanType':
        addPanel('foreman', 'What does the Foreman act as?', null, action, { art: ITEM_ART[action.specialist], item: action.specialist });
        break;
      case 'chooseSpecialistType':
        addPanel('doubling', 'Which specialist type is doubled this turn?', null, action, { art: ITEM_ART[action.specialist], item: action.specialist });
        break;
      case 'chooseExtraActivation': {
        const carriage = state.players[state.toAct].train.specialistCarriages[action.level - 1];
        const held = carriage ? carriage.slots[action.slot] : null;
        addPanel('extra', 'Which specialist acts once more?', null, action, { art: held ? ITEM_ART[held] : null, item: held, sub: held ? `${NAMES[held] ?? held}, level ${action.level} carriage` : '' });
        break;
      }
      case 'chooseOption':
        addPanel('option', 'Choose one', null, action, {});
        break;

      default:
        if (PRIMARY_STOPS.has(action.type)) {
          targets.primary.push(action);
          targets.covered.add(actionKey(action));
        } else if (SECONDARY_STOPS.has(action.type)) {
          targets.secondary.push(action);
          targets.covered.add(actionKey(action));
        }
        // Anything else is left uncovered: the generic layer serves it.
        break;
    }
  }

  // Previews for the district choice: what each district would give, with and without a hat.
  if (targets.districts.anyDistrict) {
    for (const p of previewMultipliers(state)) {
      const slot = (targets.districts.previews[p.district] ??= {});
      slot[p.hat ? 'hat' : 'plain'] = { multiplier: p.multiplier, adjacent: p.adjacent };
    }
    for (const entry of targets.byTarget.values()) {
      if (entry.kind !== 'district') continue;
      const info = districtInfo(state, entry.id);
      const slot = (targets.districts.previews[entry.id] ??= {});
      slot.name = info.name;
      slot.family = info.family;
      for (const variant of ['plain', 'hat']) {
        const action = entry.actions.find((a) => a.hat === (variant === 'hat'));
        if (!action || !slot[variant]) continue;
        const read = outcomeOf(state, action, info);
        slot[variant].outcome = read.outcome;
        slot[variant].forced = read.forced;
        slot[variant].sentence = consequenceSentence(info.name, read.forced);
      }
    }
  }

  // Everything not covered goes to the generic layer.
  targets.generic = actions.filter((a) => !targets.covered.has(actionKey(a)));
  return targets;
}

/** What a hire costs, from the engine's own read (the mode depends on what offered the hire). */
function hireText(state, action) {
  const frame = topFrame(state);
  const mode = frame && frame.kind === 'hireSpecialist' ? (frame.free ? 'free' : 'table') : 'bonusAction';
  const c = hireCost(state, state.toAct, action.specialist, mode);
  if (!c) return '';
  const text = formatCost(state, c.cost);
  return text ? `Costs ${text} (level ${c.level} carriage)` : `Free (level ${c.level} carriage)`;
}

/**
 * What a district choice would do, read from one trial run on a copy:
 * a short phrase (what it gathers, or what the Foreman acts as) and the steps
 * the engine would then take by itself.
 */
function outcomeOf(state, action, info) {
  let events;
  try {
    events = simulate(state, action).events;
  } catch {
    return { outcome: '', forced: [] };
  }
  let outcome = '';
  if (info.family === 'gather') {
    const g = events.find((e) => e.type === 'gather');
    if (g) outcome = `+${g.amount} ${g.item === 'coins' ? 'Coins' : NAMES[g.item] ?? g.item}`;
  } else {
    const ta = events.find((e) => e.type === 'trainActivation');
    if (ta) outcome = `Foreman acts as ${NAMES[ta.foreman] ?? ta.foreman}`;
  }
  return { outcome, forced: followUpsFromEvents(events) };
}

/**
 * The action a click on a district should commit, given the hat toggle.
 * Falls back to the other variant when the wanted one is not in the list.
 */
export function pickDistrictAction(entry, hat) {
  return entry.actions.find((a) => a.hat === hat) ?? entry.actions[0];
}

/** Which route ends can claim a route right now (for the map), from the claim actions. */
export function claimFromCities(entry) {
  return entry.actions.map((a) => a.from);
}

/**
 * A short description of a route claim for a tooltip: cost against holdings.
 */
export function claimSummary(state, player, routeId) {
  const route = MAP.routeById[routeId];
  const short = routeShortfall(player, route);
  const held = ['ground', 'tunnel', 'bridge']
    .filter((t) => route.cost[t] > 0)
    .map((t) => `${player.builtTiles[t]} ${NAMES[t]}`)
    .join(', ');
  return `${MAP.cityById[route.a].name} - ${MAP.cityById[route.b].name}: needs ${formatRouteCost(state, route)}; you hold ${held}${short ? ' (short)' : ''}.`;
}

/** Toll cities on the path of a move, for a destination badge. */
export function moveTolls(state, playerId, from, to) {
  const path = moveTrainPath(state, playerId, from, to);
  return path ? path.tollCities : [];
}

/** What a building choice does to production, read by trying it on a copy. */
export function stationEffect(state, playerId, action) {
  if (action.type !== 'placeRailwayStation') return null;
  try {
    const { state: after } = simulate(state, action);
    const track = action.houseTrack;
    return { track, before: production(state, playerId, track), after: production(after, playerId, track) };
  } catch {
    return null;
  }
}

/**
 * The engine actions a click on a target would be asking for, whether or not
 * they are legal: the questions to put to getBlockReason when the target is
 * not lit. (A lit target already has its legal actions; this is for the rest.)
 *
 * @param {object} state
 * @param {string} key a target key such as "route:SEA-SPO"
 * @param {{ hat?: boolean }} [opts]
 * @returns {object[]} probes, best guess first (empty when the key is unknown)
 */
export function probesFor(state, key, opts = {}) {
  const who = state.toAct;
  if (who === null || who === undefined) return [];
  const player = state.players[who];
  const frame = topFrame(state);
  const [kind, id] = key.split(':');
  switch (kind) {
    case 'space':
      return state.grid.spaces[id] === who ? [{ type: 'removeWorker', from: id }] : [{ type: 'placeWorker', space: id }];
    case 'centre':
      return state.grid.centres[id] === who ? [{ type: 'removeWorker', from: id }] : [{ type: 'displaceWorker', district: id }];
    case 'district':
      return [{ type: 'chooseDistrict', district: id, hat: !!opts.hat }];
    case 'route': {
      const route = MAP.routeById[id];
      if (!route) return [];
      const own = [route.a, route.b].filter((c) => player.railheads.includes(c));
      return (own.length ? own : [route.a, route.b]).map((from) => ({ type: 'claimRoute', route: id, from }));
    }
    case 'city': {
      if (frame && frame.kind === 'setupRailhead') return [{ type: 'placeRailhead', city: id }];
      if (frame && frame.kind === 'placeBuildings') return [{ type: 'placeTelegraphStation', city: id }];
      return player.railheads.filter((c) => c && c !== id).map((from) => ({ type: 'moveTrain', from, to: id }));
    }
    case 'congress':
      return [{ type: 'takeCongressEntry', entry: id }];
    case 'store':
      return [{ type: 'discard', item: id }];
    case 'house':
      return [{ type: 'chooseStartingProduction', track: id }];
    case 'upgrade': {
      const tile = state.modules.upgrades ? upgradeTileData(state, id) : null;
      return tile ? [{ type: 'installUpgrade', tile: id, level: tile.level }] : [];
    }
    case 'pony':
      return [{ type: 'buyPonyCard', card: id }];
    case 'token':
      return [{ type: 'exchangeToken', resource: id }];
    case 'ability':
      return [{ type: 'usePonyCard', card: id }];
    default:
      return [];
  }
}

/**
 * Why a click on `key` does nothing: the engine's own sentence for the first
 * probe that is blocked, or null when some probe is legal (then it is not a
 * refusal at all).
 */
export function refusalReason(state, key, opts = {}) {
  const probes = probesFor(state, key, opts);
  let first = null;
  for (const probe of probes) {
    const reason = getBlockReason(state, probe);
    if (reason === null) return null;
    if (first === null) first = reason;
  }
  return first;
}
