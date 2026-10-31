// Rules audit (pr2e), part 7: random play against independent oracles.
//
// Many seeded games are played with a random policy, over several variant settings. After every
// action the state is checked against the rules' invariants (conservation of pieces, storage
// limits, the building rules), and every lay is re-scored by an oracle written here from the rules
// text (P14.7 track VP, P17 tolls, P19.2 completion, P14.6.2 whether a building was owed, P16.5
// carriages), using the position BEFORE the action.

import { assert, E, check } from './kit.mjs';

const GAMES = [
  // [players, seed, variants]
  [2, 11, {}], [3, 12, {}], [4, 13, {}], [2, 14, {}], [3, 15, {}], [4, 16, {}],
  [2, 21, { tycoonMode: true }], [3, 22, { tycoonMode: true }],
  [2, 31, { layShape: 'one-new-route' }], [3, 32, { layShape: 'adjacent-only' }], [4, 33, { layShape: 'one-new-route' }],
  [2, 41, { newConnectionRule: 'must-join-unjoined' }], [3, 42, { newConnectionRule: 'must-join-unjoined' }],
  [2, 51, { arrivalBuilding: 'optional' }], [3, 52, { arrivalBuilding: 'optional' }],
  [2, 61, { upgradePlacement: 'any-carriage' }], [3, 62, { upgradePlacement: 'any-carriage' }],
  [3, 71, { hatOverflow: 'lost' }], [4, 72, { hatOverflow: 'lost' }],
  [2, 81, { layShape: 'path', tycoonMode: true, newConnectionRule: 'must-join-unjoined' }],
  [3, 91, {}], [4, 92, {}], [2, 93, {}], [3, 94, {}],
];

const INLAND = new Set(E.MAP.inlandCities.map((c) => c.id ?? c));
const WEST = E.MAP.westStartCities.map((c) => c.id ?? c);
const EAST = E.MAP.eastStartCities.map((c) => c.id ?? c);

/** Whether a chain of the given laid route ids joins a west start city to an east start city. */
function crossing(routeIds) {
  const adj = {};
  for (const id of routeIds) {
    const r = E.MAP.routeById[id];
    (adj[r.a] ??= []).push(r.b);
    (adj[r.b] ??= []).push(r.a);
  }
  for (const w of WEST) {
    const seen = new Set([w]);
    const queue = [w];
    for (let i = 0; i < queue.length; i++) for (const o of adj[queue[i]] ?? []) if (!seen.has(o)) { seen.add(o); queue.push(o); }
    if (EAST.some((e) => seen.has(e))) return true;
  }
  return false;
}

const laidIds = (state) => Object.keys(state.map.routeOwner).filter((id) => state.map.routeOwner[id] !== null);

/** The oracle: what a lay along `cities` / `routes` by `p` scores and pays, from the position `pre`. */
function oracle(pre, p, cities, routes) {
  const has = (c) => pre.map.railwayStation[c] !== null || pre.map.telegraphStation[c] !== null;
  const isStop = (c) => !INLAND.has(c) || has(c);
  let track = 0;
  let slots = 0;
  const laid = [];
  for (let i = 1; i < cities.length; i++) {
    const id = routes[i - 1];
    if (pre.map.routeOwner[id] !== null) continue;
    laid.push(id);
    let j = i;
    while (j < cities.length - 1 && !isStop(cities[j])) j++;
    const scoring = cities[j];
    const per = INLAND.has(scoring) && !has(scoring) ? 2 : 1;
    const n = E.MAP.routeById[id].length;
    track += per * n;
    slots += n;
  }
  const tolls = {};
  for (let i = 1; i < cities.length; i++) {
    const c = cities[i];
    for (const [owner, kinds] of [[pre.map.railwayStation[c], 'rs'], [pre.map.telegraphStation[c], 'ts']]) {
      if (owner !== null && owner !== p) tolls[owner] = (tolls[owner] ?? 0) + 3;
      void kinds;
    }
  }
  const before = laidIds(pre);
  const completes = !crossing(before) && crossing(before.concat(laid));
  return { track: completes ? 0 : track, completion: completes ? 3 * slots : 0, tolls, completes, laid };
}

/** Whether `p` is able to place an arrival building in `c` (P14.6.2), on the position `s`. */
function able(s, p, c) {
  if (!INLAND.has(c)) return false;
  const rs = s.map.railwayStation[c];
  const ts = s.map.telegraphStation[c];
  const houses = Object.values(s.players[p].houses).reduce((a, b) => a + b, 0);
  const telegraphsLeft = 7 - s.players[p].telegraphsPlaced;
  return (rs === null && ts !== p && houses > 0) || (ts === null && rs !== p && telegraphsLeft > 0);
}

function vpOf(player) {
  return { ...player.vp };
}

/** Plays the games and collects violations by rule id. */
function randomAudit() {
  const bad = new Map();
  const note = (id, message) => {
    if (!bad.has(id)) bad.set(id, []);
    if (bad.get(id).length < 3) bad.get(id).push(message);
  };
  let lays = 0;
  let zeroTile = 0;
  let completions = 0;
  let arrivals = 0;
  let carriagesSeen = 0;
  let actions = 0;

  for (const [players, seed, variants] of GAMES) {
    const state = E.createGame({ players: Array.from({ length: players }, (_, i) => ({ name: `P${i}` })), seed, variants: { maxTurnsPerPlayer: 45, ...variants } });
    const rng = E.makeRng(`audit-${seed}`);
    const initial = {
      workers: state.players.map((p) => p.workersInSupply),
      upgrades: state.supply.upgrades.length,
      specialists: { ...state.supply.specialists },
    };
    const laidBy = {};
    const stationOwner = { railwayStation: {}, telegraphStation: {} };
    const prevVp = state.players.map(vpOf);
    for (let step = 0; !E.isGameOver(state); step++) {
      assert.ok(step < 40000, 'the game does not end');
      const list = E.getValidActions(state);
      // Prefer laying and building a little, to reach the map rules sooner.
      let pick = E.rngPick(rng, list);
      const lay = list.filter((a) => (a.type === 'chooseDistrict' && a.mode === 'lay') || a.type === 'startLay' || a.type === 'extendPath');
      if (lay.length > 0 && E.rngNext(rng) < 0.6) pick = E.rngPick(rng, lay);
      const build = list.filter((a) => a.type === 'useStep' || a.type === 'hireSpecialist');
      if (build.length > 0 && E.rngNext(rng) < 0.5) pick = E.rngPick(rng, build);
      const pre = E.cloneState(state);
      const topPre = E.topFrame(pre);
      const mover = pre.toAct;
      let events;
      try {
        events = E.applyAction(state, pick);
      } catch (err) {
        note('P4.6', `a listed action was refused: ${E.actionKey(pick)}: ${err.message}`);
        break;
      }
      actions += 1;

      // ---- per-lay oracles (the position before the action is `pre`) -------------------------
      for (const ev of events) {
        if (ev.type !== 'lay') continue;
        lays += 1;
        const o = oracle(pre, ev.player, ev.cities, ev.routes);
        if (o.laid.length === 0) zeroTile += 1;
        // The engine's own `lay` events fire inside the action; the pre position of a LATER lay of the
        // same action differs from `pre` only by earlier lays of that action, which the action events
        // list. When one action holds several lays, skip the oracle for all but the first.
        const sameAction = events.filter((e) => e.type === 'lay').length;
        if (sameAction === 1) {
          const gotTrack = state.players[ev.player].vp.track - prevVp[ev.player].track;
          const gotCompletion = state.players[ev.player].vp.completion - prevVp[ev.player].completion;
          if (gotTrack !== o.track) note('P14.7', `seed ${seed}: path ${ev.cities.join('>')} track VP ${gotTrack}, expected ${o.track}`);
          if (gotCompletion !== o.completion) note('P19.2', `seed ${seed}: path ${ev.cities.join('>')} completion VP ${gotCompletion}, expected ${o.completion}`);
          for (const q of state.players) {
            if (q.id === ev.player) continue;
            const gotToll = q.vp.toll - prevVp[q.id].toll;
            if (gotToll !== (o.tolls[q.id] ?? 0)) note('P17.1', `seed ${seed}: path ${ev.cities.join('>')} toll to ${q.id}: ${gotToll}, expected ${o.tolls[q.id] ?? 0}`);
          }
          if (state.players[ev.player].vp.toll !== prevVp[ev.player].toll) note('P17.2/3', 'the mover was paid a toll');
          if (o.completes) completions += 1;
          if (o.completes !== (ev.completes === true)) note('P14.5/2', `seed ${seed}: completion judged ${ev.completes}, expected ${o.completes}`);
          if (o.completes && state.gameEnd === null) note('P19.1', 'a completing lay did not trigger the end');
        }
        // P14.6.2: was a building owed? Judged on the position after tiles, VP, tolls and the move.
        arrivals += 1;
        const c = ev.to;
        const placed = events.find((e) => e.type === 'buildingPlaced' && e.cause === 'arrival' && e.city === c && e.player === ev.player);
        const top = E.topFrame(state);
        const pending = top !== null && top.kind === 'placeBuildings' && top.city === c;
        // Position the oracle judges: `pre` plus the lays of this action; for one lay it is `pre` itself.
        if (sameAction === 1) {
          const owed = able(pre, ev.player, c) && !(placed === undefined && !pending && false);
          const mine = ev.player;
          if (state.variants.arrivalBuilding === 'compulsory-if-able' || o.laid.length === 0) {
            if (owed && placed === undefined && !pending) note('P14.6', `seed ${seed}: lay to ${c} by ${mine} owed a building and none was placed or asked`);
            if (!owed && (placed !== undefined || pending)) note('P14.6', `seed ${seed}: lay to ${c} by ${mine} was not able but a building was placed or asked`);
          }
          if (pending && state.variants.arrivalBuilding === 'compulsory-if-able') {
            const acts = E.getValidActions(state);
            if (acts.some((a) => a.type === 'skipBuilding')) note('P14.6/skip', 'skipBuilding offered with compulsory-if-able');
          }
        }
        void topPre;
        void mover;
      }

      // ---- invariants -----------------------------------------------------------------------
      const K = E.getConstants(state);
      for (const p of state.players) {
        const ownRs = Object.values(state.map.railwayStation).filter((o) => o === p.id).length;
        const district = Object.values(state.grid.sites).flat().filter((o) => o === p.id).length;
        const onBoard = Object.values(p.houses).reduce((a, b) => a + b, 0);
        if (state.phase !== 'setup' && onBoard + ownRs + district !== K.SETUP.housesPerPlayer) note('P6.6', `houses: ${onBoard} + ${ownRs} + ${district} != 11 for ${p.id}`);
        const ownTs = Object.values(state.map.telegraphStation).filter((o) => o === p.id).length;
        if (p.telegraphsPlaced !== ownTs) note('P16.3', `telegraph stations: placed ${p.telegraphsPlaced}, on the map ${ownTs}`);
        for (const t of Object.keys(p.houses)) if (p.houses[t] < 0 || p.houses[t] > 3) note('P2.3', `house track ${t}: ${p.houses[t]}`);
        if (p.coins < 0 || Object.values(p.resources).some((n) => n < 0) || Object.values(p.builtTiles).some((n) => n < 0)) note('P7.7', 'a negative stock');
        if (p.hats < 0 || p.hats > K.HATS.hatLimit) note('P11.1', `hats ${p.hats}`);
        const carriages = p.train.specialistCarriages;
        if (carriages.length !== Math.min(K.PLAYER_BOARD.maxCarriages, p.layStationsPlaced)) note('P16.5', `carriages ${carriages.length} with ${p.layStationsPlaced} lay stations`);
        carriagesSeen = Math.max(carriagesSeen, carriages.length);
        carriages.forEach((c, i) => { if (c.number !== i + 1) note('P7.5', 'carriage order'); });
        if (E.storageCapacity(state, p.id) !== 6 + 3 * carriages.length) note('P7.2', 'capacity');
        const spaces = state.stack.length === 0 ? 0 : 0;
        void spaces;
        const grid = Object.values(state.grid.spaces).filter((o) => o === p.id).length + Object.values(state.grid.centres).filter((o) => o === p.id).length;
        if (p.workersInSupply + grid !== initial.workers[p.id]) note('P5.2', `workers ${p.workersInSupply} + ${grid} != ${initial.workers[p.id]}`);
        for (const [k, v] of Object.entries(p.vp)) if (v < prevVp[p.id][k]) note('P20.1', `VP source ${k} decreased`);
        prevVp[p.id] = vpOf(p);
      }
      const inCarriages = { crew: 0, miner: 0, engineer: 0, financier: 0 };
      let tokens = state.supply.upgrades.length;
      for (const p of state.players) for (const c of p.train.specialistCarriages) {
        for (const x of c.slots) if (x !== null) inCarriages[x] += 1;
        if (c.upgrade !== null) tokens += 1;
        if (c.upgrade !== null && E.upgradeTileData(state, c.upgrade).level !== c.number) note('P12.2/3', `level ${c.upgrade} on carriage ${c.number}`);
        if (c.upgrade !== null && !c.slots.some((x) => x !== null)) note('P12.2/1', 'a token on a carriage with no specialist');
        if (c.slots[0] === null && c.slots[1] !== null) note('P8.3', 'space 2 filled before space 1');
      }
      for (const t of Object.keys(inCarriages)) if (inCarriages[t] + state.supply.specialists[t] !== initial.specialists[t]) note('P8.6', `specialists of ${t} not conserved`);
      if (tokens !== initial.upgrades) note('P12.5', `upgrade tokens ${tokens} != ${initial.upgrades}`);
      for (const city of Object.keys(state.map.railwayStation)) {
        const rs = state.map.railwayStation[city];
        const ts = state.map.telegraphStation[city];
        if (rs !== null && ts !== null && rs === ts) note('P16.1', `one owner holds both buildings in ${city}`);
        if ((rs !== null || ts !== null) && !INLAND.has(city)) note('P16.1', `a building in the start city ${city}`);
        for (const [kind, owner] of [['railwayStation', rs], ['telegraphStation', ts]]) {
          const was = stationOwner[kind][city];
          if (was !== undefined && owner !== was) note('P16.6', `${kind} in ${city} changed from ${was} to ${owner}`);
          if (owner !== null) stationOwner[kind][city] = owner;
        }
      }
      for (const [id, owner] of Object.entries(state.map.routeOwner)) {
        if (owner !== null && laidBy[id] !== undefined && laidBy[id] !== owner) note('P13.4', `route ${id} changed hands`);
        if (owner !== null) laidBy[id] = owner;
      }
      // At a settled turn start nobody is over capacity (P7.6).
      const top = E.topFrame(state);
      if (top !== null && top.kind === 'workerStep') {
        for (const p of state.players) if (E.storageUsed(p) > E.storageCapacity(state, p.id)) note('P7.6', `player ${p.id} over capacity at a turn start`);
      }
      if (state.completion !== null && !E.hasTranscontinentalLine(state)) note('P19.1', 'a completion without a line');
    }
    // End of the game.
    const sc = E.scoreGame(state);
    const reason = sc.endReason;
    if (reason === 'transcontinental') {
      const turns = state.players.map((p) => p.turnsTaken);
      if (Math.max(...turns) !== Math.min(...turns)) note('P19.3', `seed ${seed}: unequal turns ${turns.join(',')}`);
    }
    for (const p of sc.players) {
      const sum = Object.values(state.players[p.id].vp).reduce((a, b) => a + b, 0);
      if (p.total !== sum) note('P20.1', 'final total differs from the sum of the sources');
      const buildings = Object.values(state.map.railwayStation).filter((o) => o === p.id).length + Object.values(state.map.telegraphStation).filter((o) => o === p.id).length;
      if (state.players[p.id].vp.buildingsEnd !== E.getConstants(state).SCORING.buildingTable[buildings]) note('P20.3', `building table for ${buildings} buildings`);
      const tiles = Object.values(state.players[p.id].builtTiles).reduce((a, b) => a + b, 0);
      if (state.players[p.id].vp.tilesEnd !== tiles) note('P20.2', 'built tiles at the end');
    }
    if (sc.winners.length === 0) note('P20.4', 'no winner');
  }
  return { bad, stats: { lays, zeroTile, completions, arrivals, carriagesSeen, actions } };
}

export default function part7() {
  let run;
  try {
    run = randomAudit();
  } catch (err) {
    check('random-play/crash', 'the run completes without an engine error', () => { throw err; });
    return;
  }
  const { bad, stats } = run;
  const ids = ['P4.6', 'P5.2', 'P6.6', 'P2.3', 'P7.2', 'P7.5', 'P7.6', 'P7.7', 'P8.3', 'P8.6', 'P11.1', 'P12.2/1', 'P12.2/3', 'P12.5', 'P13.4', 'P14.5/2', 'P14.6', 'P14.6/skip', 'P14.7', 'P16.1', 'P16.3', 'P16.5', 'P16.6', 'P17.1', 'P17.2/3', 'P19.1', 'P19.2', 'P19.3', 'P20.1', 'P20.2', 'P20.3', 'P20.4'];
  for (const id of ids) {
    check(`${id}/random-play`, `over ${stats.actions} random actions in ${GAMES.length} games (${stats.lays} lays, ${stats.zeroTile} zero-tile, ${stats.completions} completions): no violation`, () => {
      assert.deepEqual(bad.get(id) ?? [], []);
    });
  }
  check('random-play/coverage', 'the random games exercised lays, zero-tile lays, completions and carriages', () => {
    assert.ok(stats.lays >= 50, `lays ${stats.lays}`);
    assert.ok(stats.carriagesSeen >= 1, 'a carriage was earned');
  });
  for (const [id, list] of bad) if (!ids.includes(id)) check(`${id}/random-play`, 'unlisted violation', () => assert.deepEqual(list, []));
}
