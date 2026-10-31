// Rules audit (pr2e), part 8: the legality of a lay against a brute-force oracle.
//
// For hundreds of random positions (trains, laid routes, buildings, built tiles, house and
// telegraph pieces left, and every value of layShape and newConnectionRule) the set of
// extendPath / startLay / endLay actions on offer is compared with an exhaustive search of
// the simple paths of the route map, written from P14.2 to P14.4, P14.9.2 and P4.7: an extension is
// offered exactly when some complete legal lay still has the path so far as its prefix.

import { assert, E, check, start, act, setTrains, setStorage, layRoutes, build, setHouses, placeAndChoose } from './kit.mjs';

const INLAND = new Set(E.MAP.inlandCities.map((c) => c.id ?? c));
const ALL = E.MAP.cities.map((c) => c.id ?? c);

/** Connected components of the laid routes (city -> component id). */
function components(state) {
  const comp = {};
  let n = 0;
  for (const c of ALL) {
    if (c in comp) continue;
    comp[c] = n;
    const stack = [c];
    while (stack.length) {
      const x = stack.pop();
      for (const id of E.MAP.cityRoutes[x]) {
        if (state.map.routeOwner[id] === null) continue;
        const o = E.otherEnd(E.MAP.routeById[id], x);
        if (!(o in comp)) { comp[o] = n; stack.push(o); }
      }
    }
    n += 1;
  }
  return comp;
}

/** Whether `p` could place an arrival building in `c` (P14.6.2). */
function able(state, p, c) {
  if (!INLAND.has(c)) return false;
  const rs = state.map.railwayStation[c];
  const ts = state.map.telegraphStation[c];
  const houses = Object.values(state.players[p].houses).reduce((a, b) => a + b, 0);
  const left = 7 - state.players[p].telegraphsPlaced;
  return (rs === null && ts !== p && houses > 0) || (ts === null && rs !== p && left > 0);
}

/**
 * P14.3.2, P14.9.2, written here from the rules text: can `have` pay the unlaid routes among `routes`?
 * Each Ground, Tunnel and Bridge slot takes one tile of its own terrain; each wild slot takes one more
 * tile of any terrain, from what is left over.
 */
function payable(state, have, routes) {
  const need = { ground: 0, tunnel: 0, bridge: 0 };
  let wild = 0;
  for (const id of routes) {
    if (state.map.routeOwner[id] !== null) continue;
    for (const t of E.MAP.routeById[id].terrains) {
      if (t === 'wild') wild += 1;
      else need[t] += 1;
    }
  }
  if (need.ground > have.ground || need.tunnel > have.tunnel || need.bridge > have.bridge) return false;
  return have.ground - need.ground + (have.tunnel - need.tunnel) + (have.bridge - need.bridge) >= wild;
}

/** The oracle: is the path (cities, routes) a complete legal lay (P14.3)? */
function complete(state, p, comp, cities, routes) {
  const k = routes.length;
  if (k === 0) return false;
  let unlaid = 0;
  for (const id of routes) {
    if (state.map.routeOwner[id] !== null) continue;
    unlaid += 1;
    if (state.variants.newConnectionRule === 'must-join-unjoined') {
      const r = E.MAP.routeById[id];
      if (comp[r.a] === comp[r.b]) return false;
    }
  }
  if (!payable(state, state.players[p].builtTiles, routes)) return false;
  const shape = state.variants.layShape;
  const lastUnlaid = state.map.routeOwner[routes[k - 1]] === null;
  if (lastUnlaid) {
    if (shape === 'one-new-route') return unlaid === 1;
    if (shape === 'adjacent-only') return k === 1;
    return true;
  }
  if (unlaid > 0 || shape === 'adjacent-only') return false;
  const c = cities[k];
  return INLAND.has(c) && state.map.railwayStation[c] === null && state.map.telegraphStation[c] === null && able(state, p, c);
}

/** Whether some complete legal lay has this prefix (exhaustive, with a budget). */
function finishable(state, p, comp, cities, routes, budget) {
  if (complete(state, p, comp, cities, routes)) return true;
  if (budget.n-- <= 0) throw new Error('search budget');
  const last = cities[cities.length - 1];
  for (const id of E.MAP.cityRoutes[last]) {
    const o = E.otherEnd(E.MAP.routeById[id], last);
    if (cities.includes(o)) continue;
    if (!extensionAllowed(state, p, comp, cities, routes, id)) continue;
    if (finishable(state, p, comp, cities.concat([o]), routes.concat([id]), budget)) return true;
  }
  return false;
}

/** Prunes the search: the tiles and the shape rules that no longer-path can undo. */
function extensionAllowed(state, p, comp, cities, routes, id) {
  const all = routes.concat([id]);
  let unlaid = 0;
  for (const r of all) if (state.map.routeOwner[r] === null) unlaid += 1;
  if (!payable(state, state.players[p].builtTiles, all)) return false;
  const shape = state.variants.layShape;
  if (shape === 'adjacent-only' && (all.length > 1 || unlaid !== 1)) return false;
  if (shape === 'one-new-route' && unlaid > 1) return false;
  if (state.map.routeOwner[id] === null && state.variants.newConnectionRule === 'must-join-unjoined') {
    const r = E.MAP.routeById[id];
    if (comp[r.a] === comp[r.b]) return false;
  }
  return true;
}

function randomPosition(rng, variants) {
  const players = 2 + Math.floor(E.rngNext(rng) * 2);
  const s = start(players, { variants, seed: Math.floor(E.rngNext(rng) * 1e6) });
  const pick = (list) => list[Math.floor(E.rngNext(rng) * list.length)];
  setTrains(s, 0, [pick(ALL), pick(ALL)]);
  setStorage(s, 0, { ground: Math.floor(E.rngNext(rng) * 5), tunnel: Math.floor(E.rngNext(rng) * 5), bridge: Math.floor(E.rngNext(rng) * 5) });
  const nLaid = Math.floor(E.rngNext(rng) * 11);
  const ids = E.MAP.routeIds.slice();
  const laid = [];
  for (let i = 0; i < nLaid; i++) laid.push(ids.splice(Math.floor(E.rngNext(rng) * ids.length), 1)[0]);
  layRoutes(s, laid, 1);
  const inland = E.MAP.inlandCities.map((c) => c.id ?? c);
  for (const c of inland) {
    const r = E.rngNext(rng);
    if (r < 0.2) build(s, 'railwayStation', c, 1 + Math.floor(E.rngNext(rng) * (players - 1)));
    else if (r < 0.35) build(s, 'telegraphStation', c, 1 + Math.floor(E.rngNext(rng) * (players - 1)));
    else if (r < 0.4) { build(s, 'telegraphStation', c, 0); s.players[0].telegraphsPlaced = 0; }
    else if (r < 0.43) { build(s, 'railwayStation', c, 0); s.players[0].houses = { wood: 3, iron: 3, gunpowder: 3, coins: 3 }; }
  }
  s.players[0].telegraphsPlaced = Math.floor(E.rngNext(rng) * 8);
  const hr = E.rngNext(rng);
  if (hr < 0.2) setHouses(s, 0, 0);
  else if (hr < 0.4) s.players[0].houses = { wood: 3, iron: 3, gunpowder: 3, coins: 3 };
  else s.players[0].houses = { wood: 1, iron: 2, gunpowder: 3, coins: 0 };
  return s;
}

function runOracle() {
  const bad = new Map();
  const note = (id, message) => {
    if (!bad.has(id)) bad.set(id, []);
    if (bad.get(id).length < 3) bad.get(id).push(message);
  };
  const rng = E.makeRng('lay-oracle');
  const stats = { positions: 0, withLay: 0, steps: 0, offers: 0, forced: 0, wildSteps: 0 };
  const shapes = ['path', 'one-new-route', 'adjacent-only'];
  const joins = ['any-unlaid-route', 'must-join-unjoined'];
  for (let i = 0; i < 900; i++) {
    const variants = { layShape: shapes[i % 3], newConnectionRule: joins[Math.floor(i / 3) % 2], arrivalBuilding: i % 5 === 0 ? 'optional' : 'compulsory-if-able' };
    const s = randomPosition(rng, variants);
    const comp = components(s);
    stats.positions += 1;
    const trainCities = [...new Set(s.players[0].railheads)];
    const expectedStarts = trainCities.filter((c) => finishable(s, 0, comp, [c], [], { n: 200000 }));
    const engineHas = E.hasLegalLay(s, 0);
    stats.offers += 1;
    if (engineHas !== (expectedStarts.length > 0)) note('P15.5', `position ${i} (${JSON.stringify(variants)}): hasLegalLay ${engineHas}, oracle ${expectedStarts.length > 0}`);
    if ((E.getDistrictActionBlockReason(s, 0, 'D5', 'lay') === null) !== (expectedStarts.length > 0)) note('P4.4/3', `position ${i}: D5 lay choosable mismatch`);
    if (expectedStarts.length === 0) continue;
    stats.withLay += 1;
    // Open the lay.
    act(s, { type: 'placeWorker', space: 'W4' });
    if (!E.getValidActions(s).some((a) => a.type === 'chooseDistrict' && a.mode === 'lay')) { note('P4.4/3', `position ${i}: no lay choice though a lay exists`); continue; }
    act(s, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' });
    let top = E.topFrame(s);
    if (top.kind !== 'lay') { stats.forced += 1; continue; } // the engine made the only lay itself (a forced step is applied at once)
    if (top.path === null) {
      const offeredTrains = E.getValidActions(s).filter((a) => a.type === 'startLay').map((a) => s.players[0].railheads[a.train]).sort();
      const want = expectedStarts.slice().sort();
      if (JSON.stringify([...new Set(offeredTrains)]) !== JSON.stringify(want)) note('P14.2/1', `position ${i}: startLay from ${offeredTrains}, oracle ${want}`);
      const first = E.getValidActions(s).find((a) => a.type === 'startLay');
      act(s, first);
    }
    // Walk a random prefix, comparing the offers at every step.
    for (let step = 0; step < 6; step++) {
      top = E.topFrame(s);
      if (top === null || top.kind !== 'lay' || top.path === null) break;
      const { cities, routes } = top.path;
      stats.steps += 1;
      const offered = new Set(E.getValidActions(s).filter((a) => a.type === 'extendPath').map((a) => a.route));
      const expected = new Set();
      const last = cities[cities.length - 1];
      if (E.MAP.cityRoutes[last].some((id) => E.MAP.routeById[id].terrains.includes('wild') && s.map.routeOwner[id] === null)) stats.wildSteps += 1;
      for (const id of E.MAP.cityRoutes[last]) {
        const o = E.otherEnd(E.MAP.routeById[id], last);
        if (cities.includes(o)) continue;
        if (!extensionAllowed(s, 0, comp, cities, routes, id)) continue;
        if (finishable(s, 0, comp, cities.concat([o]), routes.concat([id]), { n: 200000 })) expected.add(id);
      }
      if (JSON.stringify([...offered].sort()) !== JSON.stringify([...expected].sort())) {
        note('P4.7', `position ${i} ${JSON.stringify(variants)} path ${cities.join('>')}: engine offers ${[...offered].sort()}, oracle ${[...expected].sort()}`);
        break;
      }
      const endOffered = E.getValidActions(s).some((a) => a.type === 'endLay');
      if (endOffered !== complete(s, 0, comp, cities, routes)) {
        note('P14.3', `position ${i} path ${cities.join('>')}: endLay offered ${endOffered}, oracle ${complete(s, 0, comp, cities, routes)}`);
        break;
      }
      if (expected.size === 0) break;
      act(s, { type: 'extendPath', route: [...expected][Math.floor(E.rngNext(rng) * expected.size)] });
    }
  }
  return { bad, stats };
}

export default function part8() {
  let run;
  try {
    run = runOracle();
  } catch (err) {
    check('oracle/crash', 'the run completes without an engine error', () => { throw err; });
    return;
  }
  const { bad, stats } = run;
  for (const id of ['P15.5', 'P4.4/3', 'P14.1', 'P14.2/1', 'P4.7', 'P14.3']) {
    check(`${id}/oracle`, `against an exhaustive search over ${stats.positions} random positions (${stats.withLay} with a lay, ${stats.steps} path steps compared): the offers agree`, () => {
      assert.deepEqual(bad.get(id) ?? [], []);
    });
  }
  check('P14.3/oracle-coverage', 'the oracle compared many positions with a lay and many path steps, a good many of them beside a wild slot', () => {
    assert.ok(stats.withLay >= 400, `positions with a lay: ${stats.withLay}`);
    assert.ok(stats.steps >= 600, `steps: ${stats.steps}`);
    assert.ok(stats.wildSteps >= 50, `path steps beside an unlaid wild route: ${stats.wildSteps}`);
    if (process.env.AUDIT_STATS) process.stderr.write(`lay-oracle stats ${JSON.stringify(stats)}
`);
  });
  void placeAndChoose;
}
