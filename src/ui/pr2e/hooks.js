// hooks.js - everything the page does for the second edition's rules that is not
// drawing: which legal action belongs to which thing on screen (targets), the
// sentences for a refused click and the hover tooltips, the game log, the
// highlight of what the last action touched, the scoring pop-up and the words of
// the end screen.
//
// The Continental Rails equivalents are action-targets.js, explain.js, log.js
// and scoring-popup.js; main.js picks this module when the game is played by the
// second edition's rules (`app.rules === 'pr2e'`). Like them, this module decides
// nothing about legality: a thing is lit because the engine lists an action for it,
// and every reason given to the player is the engine's own.
//
// Unlike views.js (which the registry imports, and so cannot import
// active-ruleset.js), this module is imported only by main.js and may use the
// page's active engine.

import { activeRuleset, getBlockReason, getStructuralBlockReason, topFrame, actionKey, describeAction, getConstants } from '../active-ruleset.js';
import { reasonPair, availability } from '../explain.js';
import { simulate, followUpsFromEvents, consequenceSentence } from '../preview.js';
import { esc, plural, ITEM_ART, CONGRESS_CELLS, tilesText, cityKindText, specialSentence as specialSentenceFor, hasSpecialText } from './common.js';

const E = () => activeRuleset().engine;

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Player-facing names of the VP sources (the rules, P20.1 and P20.2). */
export const VP_LABELS = {
  track: 'Track laid',
  completion: 'Transcontinental line',
  telegraph: 'Telegraph stations',
  toll: 'Tolls',
  districtHouse: 'District houses',
  upgrade: 'Upgrade tokens',
  congress: 'Congress',
  carriage3: 'Carriage 3 specialists',
  buildingsEnd: 'Buildings on the map (final)',
  tilesEnd: 'Built tiles in storage (final)',
  goals: 'Scoring goals (final)',
};

export const END_REASON_TEXT = {
  transcontinental: 'A line of laid routes joined the west edge of the map to the east, and every seat then took its last turn.',
  'turn-limit': 'The safety turn limit was reached (a digital-only stop, not a rule of the tabletop game).',
};

export const TIE_BREAK_TEXT = {
  vp: 'Decided on victory points.',
  districtHouses: 'Tied on VP: decided by most district houses on the building sites.',
  buildings: 'Tied on VP and district houses: decided by most buildings (railway and telegraph stations) on the map.',
  shared: 'Tied on everything, tie-breaks included: the tied players share the victory.',
};

/** What a district's special action does, with its price and VP, in one sentence. */
export function specialSentence(state, special) {
  return specialSentenceFor(E(), state, special);
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** Which parts of the screen the pending decision is about (see action-targets.js SCOPE_BY_KIND). */
export function scopeOf(state, frame) {
  const scope = new Set();
  if (!frame) return scope;
  switch (frame.kind) {
    case 'setupProduction':
      scope.add('houses');
      break;
    case 'setupRailhead':
    case 'placeBuildings':
    case 'lay':
      scope.add('map');
      break;
    case 'workerStep':
      scope.add('spaces');
      break;
    case 'chooseDistrict':
      scope.add('districts');
      break;
    case 'specialAction':
      if (frame.special === 'districtHouse') scope.add('sites');
      else if (frame.special === 'upgrade') scope.add('board');
      else scope.add('map');
      break;
    case 'congressPlacement':
      if (frame.column === 'K5') {
        scope.add('sites');
        scope.add('board');
      } else scope.add('map');
      break;
    case 'boardActivation': {
      const step = frame.steps && frame.steps[frame.index];
      if (step && step.type === 'financier') scope.add('congress');
      break;
    }
    case 'discard':
      scope.add('store');
      break;
    default:
      break;
  }
  return scope;
}

const REGION_OF = {
  space: 'spaces',
  centre: 'spaces',
  district: 'districts',
  site: 'sites',
  route: 'map',
  city: 'map',
  train: 'map',
  congress: 'congress',
  store: 'store',
  house: 'houses',
  carriage: 'board',
};

const PRIMARY_STOPS = new Set(['useStep', 'endLay']);
const SECONDARY_STOPS = new Set(['skipStep', 'skipSpecialAction', 'skipBuilding', 'stopHiring', 'stopLaying']);

/** What a district choice would yield, in a short phrase (the engine's formula, P6.3, read back from the state). */
function outcomeOf(state, district, multiplier, mode) {
  const E_ = E();
  const K = getConstants(state);
  const info = E_.districtInfo(state, district);
  const pid = state.toAct;
  if (info.family === 'collect') {
    const p = E_.production(state, pid, info.collects);
    const houses = E_.districtHousesOn(state, pid, district);
    const amount = p + houses * K.GRID.districtHouseYield + (multiplier - K.GRID.baseMultiplier);
    return `+${amount} ${info.collects === 'coins' ? (amount === 1 ? 'Coin' : 'Coins') : K.NAMES[info.collects]}`;
  }
  if (info.family === 'boardActivation') return `${K.NAMES[info.foremanType]} step${multiplier > 1 ? ` x${multiplier}` : ''}`;
  if (mode === 'lay') return multiplier === 1 ? '1 lay' : `up to ${multiplier} lays`;
  return multiplier === 1 ? '1 hire' : `up to ${multiplier} hires`;
}

/**
 * Builds every target for the current decision.
 *
 * @param {object} state the game state (read only)
 * @param {object[]} actions getValidActions(state)
 * @param {{ generic: boolean, hats: number }} opts generic: the generic layer only; hats: the cowboy hats the district choice would spend
 */
export function buildTargets(state, actions, opts) {
  const E_ = E();
  const frame = topFrame(state);
  const targets = {
    byTarget: new Map(),
    covered: new Set(),
    primary: [],
    secondary: [],
    panels: [],
    districts: { previews: {}, hatAvailable: false, maxHats: 0, anyDistrict: false },
    generic: [],
    all: actions,
    scope: scopeOf(state, frame),
    wantedTab: null,
    stateOf(kind, key) {
      if (targets.byTarget.has(key)) return 'legal';
      return targets.scope.has(REGION_OF[kind]) ? 'illegal' : 'out';
    },
  };
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

  const K = getConstants(state);
  const me = state.toAct === null ? null : state.players[state.toAct];

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
          if (action.hats > 0) targets.districts.hatAvailable = true;
          targets.districts.maxHats = Math.max(targets.districts.maxHats, action.hats);
        }
        break;
      case 'chooseStartingProduction':
        addTarget('house', action.track, action);
        addPanel('production', 'Which house track starts at production 2?', 'Click a track on your player board, or a button here.', action, { art: ITEM_ART[action.track], item: action.track });
        break;

      // ---- the map ----
      case 'placeRailhead':
        addTarget('city', action.city, action);
        break;
      case 'startLay': {
        addTarget('train', action.train, action);
        const city = me ? me.railheads[action.train] : null;
        addPanel('lay-start', 'Start a lay from one of your trains', 'Click a train on the map, or a button here. You will then pick the routes one at a time.', action, { art: 'icon-track', sub: city ? `Train on ${E_.MAP.cityById[city].name}` : '' });
        break;
      }
      case 'extendPath': {
        addTarget('route', action.route, action);
        const route = E_.MAP.routeById[action.route];
        const laid = state.map.routeOwner[action.route] !== null;
        addPanel('lay-next', 'Where does the lay go next?', 'Click a lit route on the map, or a button here. A laid route is travelled over; an unlaid one is laid with your built tiles.', action, {
          art: 'icon-track',
          sub: laid ? 'Laid already: travel over it' : `Lay it: ${E_.formatRouteCost(state, route)}`,
        });
        break;
      }
      case 'placeRailwayStation':
      case 'placeTelegraphStation':
        addTarget('city', action.city, action);
        if (frame && frame.kind === 'placeBuildings') {
          const rail = action.type === 'placeRailwayStation';
          addPanel('building', `Place a building in ${E_.MAP.cityById[action.city].name}`, null, action, {
            art: rail ? 'icon-building' : null,
            building: rail ? 'railwayStation' : 'telegraphStation',
          });
        }
        break;
      case 'placeDistrictHouse':
        addTarget('site', action.district, action);
        break;
      case 'installUpgrade':
        addTarget('carriage', action.carriage, action);
        addPanel('upgrade', 'Install an upgrade token', 'Pick a token and the carriage it goes in. A token of level N goes in carriage N.', action, { upgradeToken: action.token, carriage: action.carriage });
        break;

      // ---- Congress ----
      case 'takeCongressColumn':
        addTarget('congress', action.column, action);
        break;
      case 'resetSenators':
        addTarget('congress', 'KR', action);
        break;

      // ---- storage, resources, tiles, specialists ----
      case 'discard':
        addTarget('store', action.item, action);
        addPanel('discard', 'Discard from storage (click an item here or in your storage)', null, action, { art: ITEM_ART[action.item], item: action.item });
        break;
      case 'chooseResource':
        addPanel('resource', 'Take a resource of your choice', null, action, { art: ITEM_ART[action.resource], item: action.resource });
        break;
      case 'chooseBuiltTile':
        addPanel('built-tile', 'Take a built track tile of your choice', 'It goes to your storage on your player board, not onto the map.', action, { art: ITEM_ART[action.terrain], item: action.terrain });
        break;
      case 'hireSpecialist':
        addPanel('hire', 'Hire a specialist', 'It goes into the leftmost empty space of your carriages.', action, { art: ITEM_ART[action.specialist], item: action.specialist, sub: hireText(state, action) });
        break;
      case 'chooseFreeSpecialist':
        addPanel('free-specialist', 'Choose the free specialist that comes with carriage 1', null, action, { art: ITEM_ART[action.specialist], item: action.specialist });
        break;

      default:
        if (PRIMARY_STOPS.has(action.type)) {
          targets.primary.push(action);
          targets.covered.add(actionKey(action));
        } else if (SECONDARY_STOPS.has(action.type)) {
          targets.secondary.push(action);
          targets.covered.add(actionKey(action));
        }
        break;
    }
  }

  // The district choice: what each district gives for the hats chosen.
  if (targets.districts.anyDistrict) {
    const hats = Math.max(0, Math.min(opts.hats ?? 0, targets.districts.maxHats));
    targets.districts.selectedHats = hats;
    for (const p of E_.previewMultipliers(state)) {
      const slot = (targets.districts.previews[p.district] ??= { byHats: {} });
      const byHats = (slot.byHats[p.hats] ??= { multiplier: p.multiplier, adjacent: p.adjacent, modes: {} });
      byHats.modes[p.mode ?? 'once'] = {};
    }
    for (const entry of targets.byTarget.values()) {
      if (entry.kind !== 'district') continue;
      const info = E_.districtInfo(state, entry.id);
      const slot = (targets.districts.previews[entry.id] ??= { byHats: {} });
      slot.name = info.name;
      slot.family = info.family;
      slot.special = info.special ?? null;
      const here = slot.byHats[hats];
      if (!here) continue;
      for (const mode of Object.keys(here.modes)) {
        const action = entry.actions.find((a) => a.hats === hats && (a.mode ?? 'once') === mode);
        if (!action) continue;
        here.modes[mode].outcome = outcomeOf(state, entry.id, here.multiplier, action.mode ?? null);
        here.modes[mode].action = action;
      }
      const first = Object.values(here.modes).find((m) => m.action);
      if (first) {
        here.outcome = first.outcome;
        try {
          const forced = followUpsFromEvents(simulate(state, first.action).events);
          here.sentence = consequenceSentence(info.name, forced);
        } catch {
          here.sentence = '';
        }
      }
    }
  }
  void K;

  targets.generic = actions.filter((a) => !targets.covered.has(actionKey(a)));
  return targets;
}

/** What a hire costs and where it goes, from the engine's own read. */
function hireText(state, action) {
  const E_ = E();
  const K = getConstants(state);
  const spot = E_.nextSpecialistSlot(state.players[state.toAct]);
  const cost = E_.hireCost(state, state.toAct, action.specialist);
  const bits = [];
  if (spot) bits.push(`Carriage ${spot.carriage}, space ${spot.slot + 1}`);
  const vp = spot && spot.carriage === 3 ? K.PLAYER_BOARD.carriage3SpaceVp[spot.slot] : 0;
  if (vp) bits.push(`${vp} VP`);
  const price = E_.formatCost(state, cost);
  bits.push(price === 'nothing' ? 'free' : `costs ${price} (Tycoon Mode)`);
  return bits.join(', ');
}

/**
 * The actions a click on a district asks for, given the hats chosen: the ones
 * that spend exactly those hats (the engine lists them all), or the nearest
 * fewer when that many cannot be spent there. At the Lay Track or Hire
 * Specialists district there are two, and the player is asked which.
 */
export function districtCandidates(entry, hats) {
  const max = Math.max(...entry.actions.map((a) => a.hats));
  let n = Math.min(hats, max);
  while (n > 0 && !entry.actions.some((a) => a.hats === n)) n -= 1;
  const list = entry.actions.filter((a) => a.hats === n);
  return { actions: list.length ? list : entry.actions, title: list.length > 1 ? 'Lay Track or Hire Specialists?' : null };
}

// ---------------------------------------------------------------------------
// Probes: what a click on a target would ask, whether or not it is legal
// ---------------------------------------------------------------------------

export function probesFor(state, key, opts = {}) {
  const who = state.toAct;
  if (who === null || who === undefined) return [];
  const E_ = E();
  const player = state.players[who];
  const frame = topFrame(state);
  const [kind, id] = key.split(':');
  const hats = opts.hats ?? 0;
  switch (kind) {
    case 'space':
      return state.grid.spaces[id] === who ? [{ type: 'removeWorker', from: id }] : [{ type: 'placeWorker', space: id }];
    case 'centre':
      return state.grid.centres[id] === who ? [{ type: 'removeWorker', from: id }] : [{ type: 'displaceWorker', district: id }];
    case 'district': {
      const info = E_.districtInfo(state, id);
      if (info && info.family === 'layOrHire') return [{ type: 'chooseDistrict', district: id, hats, mode: 'lay' }, { type: 'chooseDistrict', district: id, hats, mode: 'hire' }];
      return [{ type: 'chooseDistrict', district: id, hats }];
    }
    case 'site': {
      const tracks = E_.tracksWithHouses(state, who);
      return (tracks.length ? tracks : getConstants(state).PLAYER_BOARD.houseTracks.slice(0, 1)).map((houseTrack) => ({ type: 'placeDistrictHouse', district: id, houseTrack }));
    }
    case 'route':
      return [{ type: 'extendPath', route: id }];
    case 'train':
      return [{ type: 'startLay', train: Number(id) }];
    case 'city': {
      if (frame && frame.kind === 'setupRailhead') return [{ type: 'placeRailhead', city: id }];
      const tracks = E_.tracksWithHouses(state, who);
      const rail = (tracks.length ? tracks : getConstants(state).PLAYER_BOARD.houseTracks.slice(0, 1)).map((houseTrack) => ({ type: 'placeRailwayStation', city: id, houseTrack }));
      if (frame && frame.kind === 'specialAction') {
        return frame.special === 'railwayStation' ? rail : [{ type: 'placeTelegraphStation', city: id }];
      }
      return [...rail, { type: 'placeTelegraphStation', city: id }];
    }
    case 'congress':
      return id === 'KR' ? [{ type: 'resetSenators' }] : [{ type: 'takeCongressColumn', column: id }];
    case 'store':
      return [{ type: 'discard', item: id }];
    case 'house':
      return [{ type: 'chooseStartingProduction', track: id }];
    case 'carriage': {
      const n = Number(id);
      const token = [...new Set(state.supply.upgrades)].find((t) => E_.upgradeTileData(state, t).level === n);
      return token ? [{ type: 'installUpgrade', token, carriage: n }] : [];
    }
    default:
      void player;
      return [];
  }
}

/** The engine's two answers for the best probe of a target key; null when the key has no probe. */
function reasonPairForKey(state, key, opts = {}) {
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

/** Why a click on `key` does nothing: the engine's own sentence for the first blocked probe, or null when some probe is legal. */
function refusalReason(state, key, opts = {}) {
  let first = null;
  for (const probe of probesFor(state, key, opts)) {
    const reason = getBlockReason(state, probe);
    if (reason === null) return null;
    if (first === null) first = reason;
  }
  return first;
}

/** The sentence for a click on a target that is not legal, or '' when there is nothing to say. */
export function refusalMessage(ctx, key) {
  const reason = refusalReason(ctx.state, key, { hats: ctx.hats });
  if (reason) return reason;
  if (ctx.targets.byTarget.has(key)) return '';
  return 'That cannot be used at this point of the game.';
}

/** The engine's reason a lit-or-not target is or is not open, as { ok, text } (null when there is none). */
export function availabilityFor(state, key, opts = {}) {
  return availability(reasonPairForKey(state, key, opts));
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

function line(cls, html) {
  return `<div class="tip__${cls}">${html}</div>`;
}

function availabilityHtml(ctx, key) {
  if (!ctx.interactive) return '';
  if (ctx.targets.byTarget.has(key)) return line('avail tip__avail--ok', 'You can do this now.');
  const a = availability(reasonPairForKey(ctx.state, key, { hats: ctx.hats }));
  return a ? line(a.ok ? 'avail tip__avail--ok' : 'avail tip__avail--no', esc(a.text)) : '';
}

function districtName(state, id) {
  const info = E().districtInfo(state, id);
  return info ? info.name : id;
}

function routeFacts(ctx, id) {
  const E_ = E();
  const { state } = ctx;
  const route = E_.MAP.routeById[id];
  const a = E_.MAP.cityById[route.a].name;
  const b = E_.MAP.cityById[route.b].name;
  const K = getConstants(state);
  const slots = route.terrains.map((t) => K.NAMES[t]).join(', ');
  const parts = [`<b>${esc(a)} - ${esc(b)}</b>: ${plural(route.length, 'slot', 'slots')} (${esc(slots)}).`];
  if (state.map.routeOwner[id] !== null) {
    parts.push('Laid already. Laid track belongs to nobody: any train may travel over it, and passing a rival\'s building pays that owner a toll.');
    return parts.join(' ');
  }
  parts.push(`Laying it takes ${esc(E_.formatRouteCost(state, route))} in built tiles, all at once.`);
  const p = state.players[ctx.viewer];
  const short = E_.routeShortfall(p, route);
  const lacks = ['ground', 'tunnel', 'bridge'].filter((t) => short[t] > 0);
  if (lacks.length) parts.push(`<span class="tip__bad">You lack ${esc(lacks.map((t) => `${short[t]} ${K.NAMES[t]}`).join(' and '))}.</span>`);
  else parts.push(`You hold ${esc(tilesText(K.NAMES, p.builtTiles))}.`);
  return parts.join(' ');
}

function cityFacts(ctx, id) {
  const E_ = E();
  const { state } = ctx;
  const city = E_.MAP.cityById[id];
  const parts = [`<b>${esc(city.name)}</b>: ${cityKindText(city)}.`];
  const heads = state.players.filter((p) => p.railheads.includes(id)).map((p) => ctx.who(p.id).name);
  if (heads.length) parts.push(`Train${heads.length > 1 ? 's' : ''}: ${esc(heads.join(', '))}.`);
  const rs = state.map.railwayStation[id];
  const ts = state.map.telegraphStation[id];
  if (rs !== null && rs !== undefined) parts.push(`Railway station: ${esc(ctx.who(rs).name)}.`);
  if (ts !== null && ts !== undefined) parts.push(`Telegraph station: ${esc(ctx.who(ts).name)}.`);
  if (city.kind === 'inland') {
    const connected = (rs !== null && rs !== undefined) || (ts !== null && ts !== undefined);
    parts.push(connected ? 'Connected (it holds a building): laying track to it scores 1 VP a slot, and a train entering it pays each other player\'s building here 3 VP.' : 'Not connected (no building yet): track laid to it scores 2 VP a slot.');
  } else parts.push('Laying track to a start city scores 1 VP a slot. Buildings never go in a start city.');
  return parts.join(' ');
}

function congressFacts(ctx, id) {
  const E_ = E();
  const { state } = ctx;
  const K = getConstants(state);
  if (id === 'KR') {
    const down = Object.values(state.congress.down).filter(Boolean).length;
    return `<b>Reset</b>: pay ${esc(E_.formatCost(state, { coins: K.CONGRESS.resetCost }))}; every senator that is down goes back up, and you score 1 VP for each (${down} down now).`;
  }
  const col = K.CONGRESS.columns.find((c) => c.id === id);
  if (!col) return '';
  const down = state.congress.down[id] === true;
  return `<b>Column ${esc(id)}</b>: costs ${esc(E_.formatCost(state, { coins: col.cost }))}. Reward: ${esc(CONGRESS_CELLS[id].text)}.${down ? ' <span class="tip__bad">Its senator is down: it stays closed until a Reset.</span>' : ' Its senator is up.'} Taking a column needs a Financier step.`;
}

function goalFacts(ctx, id) {
  const E_ = E();
  const { state } = ctx;
  const goal = E_.goalsInPlay(state).find((g) => g.id === id);
  if (!goal) return '';
  const st = E_.goalStandings(state, goal);
  const rows = state.players.map((p) => `${esc(ctx.who(p.id).name)}: ${esc(E_.describeProgress(state, p.id, goal).text)}${st.awards[p.id] > 0 ? ` <b>(leads: ${st.awards[p.id]} VP)</b>` : ''}`);
  return `<b>${esc(goal.name)}</b>. At the end of the game the one player with the most, and at least one, scores ${getConstants(state).SCORING.goalVp} VP; a tie for the most scores nobody.<br>${rows.join('<br>')}`;
}

/** The tooltip for a data-tip key, as HTML ('' for a key with nothing to say). */
export function tipFor(ctx, key) {
  const E_ = E();
  const { state } = ctx;
  const sep = key.indexOf(':');
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  const K = getConstants(state);
  switch (kind) {
    case 'space': {
      const w = E_.GRID.workerSpaces.find((s) => s.id === id);
      const [a, b] = w.between;
      const owner = state.grid.spaces[id];
      return line('facts', `<b>Worker space ${esc(id)}</b>, between ${esc(districtName(state, a))} and ${esc(districtName(state, b))}. ${owner !== null ? `${esc(ctx.who(owner).name)}'s worker is here.` : 'Empty.'}`) + availabilityHtml(ctx, key);
    }
    case 'centre': {
      const owner = state.grid.centres[id];
      return line('facts', `<b>Centre of ${esc(districtName(state, id))}</b>. ${owner !== null ? `${esc(ctx.who(owner).name)}'s worker is on it.` : 'A worker goes here only to displace a blocked district.'}`) + availabilityHtml(ctx, key);
    }
    case 'district': {
      const info = E_.districtInfo(state, id);
      const pv = ctx.targets.districts.previews[id];
      const here = pv && pv.byHats ? pv.byHats[ctx.targets.districts.selectedHats ?? 0] : null;
      const parts = [`<b>${esc(info.name)}</b>.`];
      if (info.family === 'collect') parts.push(`Collects ${esc(K.NAMES[info.collects])}: your production, plus 1 for each district house of yours here, plus 1 for each extra adjacent worker or hat spent.`);
      else if (info.family === 'boardActivation') parts.push(`Runs your board activation: the Foreman acts as a ${esc(K.NAMES[info.foremanType])}, once for each point of the multiplier, then every carriage in turn.`);
      else parts.push('Lay Track or Hire Specialists, your choice: as many lays or hires as the multiplier.');
      if (here) parts.push(`Multiplier x${here.multiplier}${here.adjacent ? ` (${plural(here.adjacent, 'adjacent worker', 'adjacent workers')})` : ''}${here.outcome ? `: ${esc(here.outcome)}` : ''}.`);
      let html = line('facts', parts.join(' '));
      if (info.special) html += line('facts', esc(specialSentence(state, info.special)));
      const sites = state.grid.sites[id];
      if (sites) html += line('facts', esc(`Building sites: ${sites.filter((s) => s !== null).length} of ${sites.length} hold a district house.`));
      return html + availabilityHtml(ctx, key) + (here && here.sentence ? line('forced', esc(here.sentence)) : '');
    }
    case 'site': {
      const sites = state.grid.sites[id] || [];
      const owners = sites.map((s) => (s === null ? 'empty' : ctx.who(s).name));
      return line('facts', `<b>Building sites of ${esc(districtName(state, id))}</b>: ${esc(owners.join(', '))}. A district house here adds 1 to every Collect of that district by its owner, scores 2 VP when the Collect Iron special action places it, and breaks ties.`) + availabilityHtml(ctx, key);
    }
    case 'route':
      return line('facts', routeFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'city':
      return line('facts', cityFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'train': {
      // "train:<player>:<index>" on the map (a tooltip), or "train:<index>" (the target of a lay's start, always the player to act).
      const bits = id.split(':');
      const pid = bits.length > 1 ? Number(bits[0]) : state.toAct;
      const idx = Number(bits.length > 1 ? bits[1] : bits[0]);
      const p = state.players[pid];
      const city = p.railheads[idx];
      return line('facts', `<b>${esc(ctx.who(p.id).name)}'s train ${idx + 1}</b>${city ? ` in ${esc(E_.MAP.cityById[city].name)}` : ''}. A lay starts from a train and moves it to the lay's last city.`) + (pid === state.toAct ? availabilityHtml(ctx, `train:${idx}`) : '');
    }
    case 'congress':
      return line('facts', congressFacts(ctx, id)) + availabilityHtml(ctx, key);
    case 'store': {
      const p = state.players[ctx.viewer];
      const n = id === 'coins' ? p.coins : p.resources[id] ?? p.builtTiles[id] ?? 0;
      const name = id === 'coins' ? 'Coins' : K.NAMES[id] ?? id;
      return line('facts', `<b>${esc(name)}</b>: ${n} in storage${p.builtTiles[id] !== undefined ? ' (built tiles)' : ''}. Coins take a place in storage like anything else.`) + availabilityHtml(ctx, key);
    }
    case 'house':
      return line('facts', `<b>${esc(K.NAMES[id] ?? id)} track</b>: production ${E_.production(state, ctx.viewer, id)}.`) + availabilityHtml(ctx, key);
    case 'carriage': {
      const n = Number(id);
      const c = state.players[ctx.viewer].train.specialistCarriages[n - 1];
      if (!c) return '';
      return line('facts', `<b>Carriage ${n}</b>: 2 specialist spaces and 3 more places in storage. It takes a level ${n} upgrade token.${n === 3 ? ' Hires into its spaces score 2 VP and 5 VP.' : ''}`) + availabilityHtml(ctx, key);
    }
    case 'token': {
      const data = E_.upgradeTileData(state, id);
      if (!data) return '';
      const text = data.gives === 'choice' ? `${K.UPGRADES.yield[data.level - 1]} resources of your choice` : E_.formatCost(state, { [data.gives]: K.UPGRADES.yield[data.level - 1] });
      return line('facts', `<b>Upgrade token ${esc(id)}</b> (level ${data.level}): each board activation, at its carriage's turn, it gives ${esc(text)}.`);
    }
    case 'goal':
      return line('facts', goalFacts(ctx, id));
    case 'special': {
      const text = hasSpecialText(id) ? specialSentence(state, id) : '';
      return text ? line('facts', esc(text)) : '';
    }
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

function cityLabel(id) {
  const c = E().MAP.cityById[id];
  return c ? c.name : String(id);
}

function describeEvent(state, ev, nameOf) {
  const E_ = E();
  const K = getConstants(state);
  const itemLabel = (item) => K.NAMES[item] ?? item;
  const who = (id) => (id === undefined || id === null ? '' : nameOf(id));
  switch (ev.type) {
    case 'action':
    case 'turnEnd':
      return null;
    case 'gain':
      if (ev.item === 'hats') return { text: `+${plural(ev.amount, 'cowboy hat', 'cowboy hats')}`, kind: 'gain' };
      if (ev.built) return { text: `+${plural(ev.amount, `built ${itemLabel(ev.item)} tile`, `built ${itemLabel(ev.item)} tiles`)} (in storage on the player board)`, kind: 'build' };
      return { text: `+${ev.amount} ${ev.item === 'coins' ? (ev.amount === 1 ? 'Coin' : 'Coins') : itemLabel(ev.item)}`, kind: 'gain' };
    case 'pay':
      return { text: `Paid ${E_.formatCost(state, ev.cost)}`, kind: 'pay' };
    case 'vp':
      return { text: `${ev.amount >= 0 ? '+' : ''}${ev.amount} VP (${VP_LABELS[ev.source] ?? ev.source})`, kind: 'vp' };
    case 'hatLimit':
      return { text: `At the cowboy hat limit: ${plural(ev.resourcesOwed, 'resource', 'resources')} of choice instead`, kind: 'note' };
    case 'discard':
      return { text: `Discarded 1 ${ev.item === 'coins' ? 'Coin' : itemLabel(ev.item)}`, kind: 'pay' };
    case 'workerReturned':
      return { text: `${who(ev.player)}'s worker returned from ${ev.space}`, kind: 'note' };
    case 'districtChosen': {
      if (ev.district === 'none') return { text: 'No district action this turn', kind: 'note' };
      const name = E_.GRID.districtTiles[ev.tile] ? E_.GRID.districtTiles[ev.tile].name : ev.tile;
      const mode = ev.mode === 'lay' ? ' (Lay Track)' : ev.mode === 'hire' ? ' (Hire Specialists)' : '';
      return { text: `${name}${mode}: multiplier ${ev.multiplier}${ev.adjacent ? ` (${plural(ev.adjacent, 'adjacent worker', 'adjacent workers')}${ev.hats ? ` and ${plural(ev.hats, 'cowboy hat', 'cowboy hats')}` : ''})` : ev.hats ? ` (${plural(ev.hats, 'cowboy hat', 'cowboy hats')})` : ''}`, kind: 'note' };
    }
    case 'gather':
      return { text: `Collected ${ev.amount} ${ev.item === 'coins' ? 'Coins' : itemLabel(ev.item)} (production ${ev.production}${ev.districtHouses ? `, ${plural(ev.districtHouses, 'district house', 'district houses')}` : ''}, multiplier ${ev.multiplier})`, kind: 'gain' };
    case 'boardActivation':
      return { text: `Board activation: the Foreman acts as a ${itemLabel(ev.foreman)}, ${plural(ev.steps, 'step', 'steps')}`, kind: 'note' };
    case 'build':
      return { text: `Built 1 ${itemLabel(ev.terrain)} tile with ${ev.carriage === 0 ? 'the Foreman' : `a ${itemLabel(ev.specialist)} in carriage ${ev.carriage}`}`, kind: 'build' };
    case 'hire':
      return { text: ev.cause === 'carriage1' ? `Took a free ${itemLabel(ev.specialist)} into carriage 1` : `Hired a ${itemLabel(ev.specialist)} into carriage ${ev.carriage}`, kind: 'note' };
    case 'carriageAdded':
      return { text: `Carriage ${ev.carriage} added (storage ${K.PLAYER_BOARD.boardStorage + K.PLAYER_BOARD.storagePerCarriage * ev.specialistCarriages})`, kind: 'build' };
    case 'upgradeStep':
      return { text: `Upgrade token ${ev.token} acts in carriage ${ev.carriage}`, kind: 'note' };
    case 'upgradeInstalled':
      return { text: `${ev.replaced ? `Replaced ${ev.replaced} with` : 'Installed'} upgrade token ${ev.token} in carriage ${ev.carriage}`, kind: 'build' };
    case 'districtHousePlaced':
      return { text: `Placed a district house on ${E_.districtName(state, ev.district)} (a house left the ${itemLabel(ev.houseTrack)} track)`, kind: 'lay' };
    case 'buildingPlaced':
      return {
        text:
          ev.kind === 'railwayStation'
            ? `Placed a railway station in ${cityLabel(ev.city)} (a house left the ${itemLabel(ev.houseTrack)} track)`
            : `Placed a telegraph station in ${cityLabel(ev.city)}${ev.vp !== undefined ? ` (+${ev.vp} VP)` : ''}`,
        kind: 'lay',
      };
    case 'congressEntry':
      return { text: ev.entry === 'KR' ? `Congress Reset (${plural(ev.coins, 'Coin', 'Coins')})` : `Congress column ${ev.entry}: ${CONGRESS_CELLS[ev.entry] ? CONGRESS_CELLS[ev.entry].text : ''} (${plural(ev.coins, 'Coin', 'Coins')})`, kind: 'congress' };
    case 'senatorsReset':
      return { text: `${plural(ev.count, 'senator', 'senators')} back up`, kind: 'congress' };
    case 'routeLaid': {
      const r = E_.MAP.routeById[ev.route];
      return { text: `Laid ${r ? `${cityLabel(r.a)} - ${cityLabel(r.b)}` : ev.route} (${plural(ev.slots, 'slot', 'slots')})`, kind: 'lay' };
    }
    case 'lay': {
      const laid = ev.laid.length;
      const travelled = ev.routes.length - laid;
      return { text: `Lay from ${cityLabel(ev.from)} to ${cityLabel(ev.to)}: ${plural(laid, 'route laid', 'routes laid')}${travelled > 0 ? `, ${plural(travelled, 'laid route', 'laid routes')} travelled` : ''}`, kind: 'lay' };
    }
    case 'railheadMoved':
      return { text: `Train moved ${cityLabel(ev.from)} to ${cityLabel(ev.to)}`, kind: 'lay' };
    case 'toll':
      return { text: `Toll at ${cityLabel(ev.city)}: ${who(ev.player)}'s ${ev.kind === 'railwayStation' ? 'railway station' : 'telegraph station'} scores 3 VP`, kind: 'vp' };
    case 'completion':
      return { text: `Transcontinental line completed (${ev.bonus} VP, 3 for every slot of the lay)`, kind: 'vp' };
    case 'turnStart':
      return { text: `Turn ${ev.turn}`, kind: 'turn' };
    case 'gameEndTriggered':
      return { text: `The game end has been triggered (${ev.reason === 'transcontinental' ? 'a line joins the two edges of the map' : ev.reason}); every seat takes its last turn`, kind: 'note' };
    case 'gameOver':
      return { text: 'Game over', kind: 'note' };
    case 'railheadPlaced':
      return { text: `Train on ${cityLabel(ev.city)}`, kind: 'note' };
    case 'startingProduction':
      return { text: `${itemLabel(ev.track)} starts at production 2`, kind: 'note' };
    case 'setupComplete':
      return { text: 'Setup complete', kind: 'note' };
    default: {
      const bits = Object.entries(ev)
        .filter(([k, v]) => !['type', 'seq', 'player'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        .map(([k, v]) => `${k} ${v}`);
      return { text: `${ev.type}${bits.length ? `: ${bits.join(', ')}` : ''}`, kind: 'note' };
    }
  }
}

/** Builds log entries from the events of one applyAction call (the shape log.js gives: { seq, player, name, colour, text, auto, source, details, turn }). */
export function entriesFromEvents(state, events, source = 'human', who = null) {
  const identity = who ?? ((pid) => ({ name: state.players[pid].name, colour: state.players[pid].colour || '#888888' }));
  const nameOf = (pid) => identity(pid).name;
  const entries = [];
  let current = null;
  for (const ev of events) {
    if (ev.type === 'action') {
      current = { seq: ev.seq, player: ev.player, name: nameOf(ev.player), colour: identity(ev.player).colour, text: ev.text, auto: !!ev.auto, source, details: [], turn: null };
      entries.push(current);
      continue;
    }
    const entryLine = describeEvent(state, ev, nameOf);
    if (entryLine === null) continue;
    if (entryLine.kind === 'turn') {
      entries.push({ seq: ev.seq, player: ev.player, name: nameOf(ev.player), colour: identity(ev.player).colour, text: entryLine.text, auto: false, source, details: [], turn: ev.turn });
      current = null;
      continue;
    }
    if (current === null) {
      current = { seq: ev.seq, player: ev.player ?? null, name: ev.player === undefined ? '' : nameOf(ev.player), colour: ev.player === undefined ? '#888888' : identity(ev.player).colour, text: '', auto: false, source, details: [], turn: null };
      entries.push(current);
    }
    current.details.push(entryLine);
  }
  return entries;
}

/** What the events touched, for a brief highlight on the board. */
export function flashFromEvents(events) {
  const flash = { routes: [], cities: [], districts: [], spaces: [], players: [], milestones: [], tabs: [], congress: [], carriages: [] };
  for (const ev of events) {
    switch (ev.type) {
      case 'routeLaid':
        flash.routes.push(ev.route);
        break;
      case 'lay':
        for (const r of ev.routes) if (!flash.routes.includes(r)) flash.routes.push(r);
        flash.cities.push(ev.to);
        break;
      case 'railheadMoved':
      case 'railheadPlaced':
        flash.cities.push(ev.type === 'railheadMoved' ? ev.to : ev.city);
        break;
      case 'buildingPlaced':
        flash.cities.push(ev.city);
        break;
      case 'districtHousePlaced':
      case 'districtChosen':
        if (ev.district && ev.district !== 'none') flash.districts.push(ev.district);
        break;
      case 'congressEntry':
        flash.congress.push(ev.entry);
        break;
      case 'upgradeInstalled':
      case 'carriageAdded':
      case 'hire':
        flash.carriages.push(ev.carriage);
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

// ---------------------------------------------------------------------------
// The scoring pop-up
// ---------------------------------------------------------------------------

/** What the VP of one source were for, from the other events of the same call. */
function detailFor(state, source, events, playerId) {
  const mine = events.filter((e) => e.player === playerId);
  switch (source) {
    case 'track': {
      const lay = mine.filter((e) => e.type === 'lay');
      const segments = lay.flatMap((e) => e.segments || []);
      const names = segments.map((s) => {
        const r = E().MAP.routeById[s.route];
        return `${r ? `${cityLabel(r.a)} - ${cityLabel(r.b)}` : s.route}: ${plural(s.slots, 'slot', 'slots')} to ${cityLabel(s.scoringCity)} at ${s.perSlot} VP`;
      });
      return { text: names.join('; '), segments };
    }
    case 'completion':
      return { text: 'the lay that joined the west edge of the map to the east: 3 VP for every slot of the lay', segments: [] };
    case 'telegraph':
      return { text: mine.filter((e) => e.type === 'buildingPlaced' && e.kind === 'telegraphStation').map((e) => `telegraph station in ${cityLabel(e.city)}`).join(', ') };
    case 'toll':
      return { text: events.filter((e) => e.type === 'toll' && e.player === playerId).map((e) => `${e.kind === 'railwayStation' ? 'railway' : 'telegraph'} station in ${cityLabel(e.city)}`).join(', ') };
    case 'districtHouse':
      return { text: mine.filter((e) => e.type === 'districtHousePlaced').map((e) => `district house on ${E().districtName(state, e.district)}`).join(', ') };
    case 'upgrade':
      return { text: mine.filter((e) => e.type === 'upgradeInstalled').map((e) => `token ${e.token} in carriage ${e.carriage}`).join(', ') };
    case 'congress':
      return { text: mine.filter((e) => e.type === 'congressEntry').map((e) => (e.entry === 'KR' ? 'Reset' : `column ${e.entry}`)).join(', ') };
    default:
      return { text: '' };
  }
}

/**
 * Groups the vp events of one applyAction call by player and source, with the
 * arithmetic for each line (the shape scoring-popup.js gives). A player who
 * scored in two ways, or from track laid, gets a group.
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
    if (sources.size < 2 && !sources.has('track') && !sources.has('completion')) continue;
    const lines = [];
    let total = 0;
    for (const [source, amounts] of sources) {
      const amount = amounts.reduce((a, b) => a + b, 0);
      total += amount;
      const detail = detailFor(state, source, events, player);
      let sum;
      if (source === 'track' && detail.segments && detail.segments.length > 0) {
        const byRate = new Map();
        for (const s of detail.segments) byRate.set(s.perSlot, (byRate.get(s.perSlot) ?? 0) + s.slots);
        sum = `${[...byRate.entries()].map(([rate, slots]) => `${plural(slots, 'slot', 'slots')} x ${rate} VP`).join(' + ')} = ${amount}`;
      } else if (amounts.length > 1 && amounts.every((a) => a === amounts[0])) sum = `${amounts.length} x ${amounts[0]} VP = ${amount}`;
      else if (amounts.length > 1) sum = `${amounts.join(' + ')} = ${amount}`;
      else sum = `${amount} VP`;
      lines.push({ source, label: VP_LABELS[source] ?? source, detail: detail.text, sum, amount });
    }
    const w = who(player);
    groups.push({ player, name: w.name, colour: w.colour, total, lines });
  }
  return groups;
}
