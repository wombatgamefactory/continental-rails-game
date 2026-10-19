// Rules audit, part 6: static audits. Terminology (R1), every row of the spec's data
// tables against src/engine/rules.js and the map (R10.1, R15.2, R16.5, R16.8, R17.3,
// R18.7, R20.3, R21.3, Appendix A), tuning numbers in logic files (R21.4), material
// that must not be in the game (R23.1), a few rule heads whose behaviour is checked
// in passing elsewhere, and the engine additions asked for during the audit.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createGame, RULES, MAP, VARIANTS, ACTIONS, isCityConnected, isJunctionCity, cityRegion, storageCapacity, getConstants,
} from '../../src/engine/index.js';
import * as SPEC from './spec-tables.mjs';
import {
  assert, check, skip, game, act, put, give, setHeads, setTrain, claim, placeAndChoose, choose, eventOf, eventsOf, vpBySource,
  offered, idleTurn, idleUntil, finishTurn, playTurn, goTo, kind, giveTokens, stock, ownCard, installTile, getValidActions, MODULES_OFF,
} from './kit.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'engine');
const FILES = readdirSync(ENGINE).filter((f) => f.endsWith('.js'));
const source = (f) => readFileSync(join(ENGINE, f), 'utf8');
const sorted = (a) => a.slice().sort();
const numbers = (text) => (String(text).match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
const PONY = { modulePonyExpress: true };

/** Source text with comments removed. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
/** Code with string and template literals removed as well. */
function bare(text) {
  return code(text).replace(/`(?:[^`\\]|\\.)*`/g, '``').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}
/** Every string and template literal of a file (comments removed first). */
function strings(text) {
  return code(text).match(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? [];
}

export default function part6() {
  // ----- R1: terminology ---------------------------------------------------------
  check('R1.1', '"house" is used only for the player-board production multiplier: identifiers and player-facing strings', () => {
    const allowed = new Set(['house', 'houses', 'Houses', 'houseTrack', 'houseTracks', 'houseSlotsPerTrack', 'housesOnBoard']);
    for (const f of FILES) {
      for (const word of source(f).match(/[A-Za-z_]*[hH]ouse[A-Za-z_]*/g) ?? []) assert.ok(allowed.has(word), `${f}: identifier or word "${word}"`);
      for (const s of strings(source(f))) {
        if (!/house/i.test(s) || !/\s/.test(s)) continue;
        assert.ok(/house track|house slot|player board|track has no house|no house left|houseTrack/i.test(s), `${f}: a string uses "house" away from the player board: ${s.slice(0, 120)}`);
        assert.ok(!/house (in|on) (the )?(map|city|district|grid)/i.test(s), `${f}: ${s.slice(0, 120)}`);
      }
    }
    const s = game(2);
    assert.ok(!JSON.stringify(s.map).includes('house') && !JSON.stringify(s.grid).includes('house'), 'nothing on the map or the grid is called a house');
  });
  check('R1.2', 'a building on the map is a railwayStation or a telegraphStation, never a bare "station" in player-facing text', () => {
    for (const f of FILES) {
      for (const s of strings(source(f))) {
        const loose = s.replace(/(railway|telegraph) stations?/gi, '').replace(/station step/gi, '').replace(/Station Network/g, '');
        assert.ok(!/\bstations?\b/i.test(loose), `${f}: "station" alone in ${s.slice(0, 120)}`);
      }
    }
    assert.deepEqual(RULES.BUILDING_KINDS, ['railwayStation', 'telegraphStation']);
    assert.deepEqual([RULES.NAMES.railwayStation, RULES.NAMES.telegraphStation], ['railway station', 'telegraph station']);
  });
  check('R1.3', 'a telegraph station comes from the telegraph row of the player board', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'OMA');
    give(s, 0, { tiles: { bridge: 2 } });
    const ev = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute')) ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.deepEqual([s.players[0].telegraphsPlaced, s.map.telegraphStation.SPO], [1, 0]);
  });
  check('R1.4', 'buildings exist only on the map: two kinds, in the map part of the state', () => {
    const s = game(2);
    assert.deepEqual(sorted(Object.keys(s.map)), ['railwayStation', 'routeOwner', 'telegraphStation']);
    assert.ok(!('railwayStation' in s.players[0]) && !('telegraphStation' in s.grid));
  });
  check('R1.5', 'a location of the action grid is a district: nine of them, never called a site or a house', () => {
    const s = game(2);
    assert.deepEqual(Object.keys(s.grid.tiles), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
    for (const f of FILES) {
      for (const str of strings(source(f))) assert.ok(!/building site/i.test(str), `${f}: ${str.slice(0, 100)}`);
    }
    assert.ok(Object.keys(ACTIONS).includes('chooseDistrict'));
  });
  check('R1.9', 'the metal resource is Iron everywhere: no "Steel" in any identifier, string or comment of the engine', () => {
    for (const f of FILES) assert.ok(!/steel/i.test(source(f)), `${f} mentions steel`);
    assert.ok(!/steel/i.test(readFileSync(join(ENGINE, 'data', 'route-map.js'), 'utf8')));
    assert.deepEqual(RULES.RESOURCES, ['iron', 'wood', 'gunpowder']);
    assert.equal(RULES.NAMES.iron, 'Iron');
    assert.deepEqual(RULES.TRAIN.recipes['2:1'].crew, { cost: { iron: 2 }, output: 'ground' });
  });
  check('R1.11', 'a cowboy hat raises the multiplier of one action by 1', () => {
    const run = (hat) => {
      const s = game(2);
      give(s, 0, { hats: 1 });
      return eventOf(placeAndChoose(s, 'W12', 'D9', hat), 'districtChosen').multiplier;
    };
    assert.equal(run(true) - run(false), 1);
  });
  check('R1.16', 'specialists are Crew, Miner, Engineer or Financier; the Foreman takes the type of the district that started the activation', () => {
    assert.deepEqual(sorted(RULES.SPECIALIST_TYPES), ['crew', 'engineer', 'financier', 'miner']);
    const s = game(2);
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { resources: { gunpowder: 2, iron: 2, wood: 2 } });
    placeAndChoose(s, 'W11', 'D8');
    const ev = act(s, { type: 'useStep' });
    assert.equal(eventOf(ev, 'build').specialist, 'miner');
  });
  check('R1.17', 'a train activation runs the Foreman and every specialist in order, left to right', () => {
    const s = game(2);
    setTrain(s, 0, [['miner', 'engineer']]);
    give(s, 0, { resources: { iron: 2, gunpowder: 2, wood: 2 } });
    const ev = placeAndChoose(s, 'W6', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
    assert.deepEqual(eventsOf(ev, 'build').map((e) => e.terrain), ['ground', 'tunnel', 'bridge']);
  });
  check('R1.21', 'a connected city is an end of at least one claimed route, whoever owns it', () => {
    const s = game(2);
    assert.equal(isCityConnected(s, 'SPO'), false);
    claim(s, 1, 'BOI-SPO');
    assert.deepEqual([isCityConnected(s, 'SPO'), isCityConnected(s, 'BOI'), isCityConnected(s, 'REN')], [true, true, false]);
  });

  // ----- rule heads checked in passing elsewhere ------------------------------------
  check('R4.8.5', 'rounds: "once per round" card abilities use real rounds', () => {
    const s = game(2, { ...PONY, turnStructure: 'rounds' });
    ownCard(s, 1, 'PX14');
    setHeads(s, 1, 'POR', 'OMA');
    claim(s, 0, 'POR-SPO');
    idleTurn(s);
    act(s, { type: 'usePonyCard', card: 'PX14' });
    if (offered(s, 'moveTrain')) act(s, { type: 'moveTrain', from: 'POR', to: 'SPO' });
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    playTurn(s, { type: 'placeWorker', space: 'W12' });
    idleTurn(s);
    assert.equal(s.turn.player, 1);
    assert.ok(!offered(s, 'usePonyCard', { card: 'PX14' }), 'a later turn of the same round: already used');
    assert.deepEqual(s.modules.pony.roundUsed, ['PX14']);
  });
  check('R8.2.2', 'a specialist carriage has 2 specialist slots and 1 upgrade slot', () => {
    const s = game(2, { moduleCarriageUpgrades: true });
    assert.equal(s.players[0].train.specialistCarriages[0].slots.length, 2);
    assert.equal(s.modules.upgrades.installed[0].length, 3, 'one upgrade slot for each of up to three carriages');
    assert.deepEqual([RULES.TRAIN.specialistSlotsPerCarriage, RULES.TRAIN.upgradeSlotsPerCarriage], [2, 1]);
  });
  check('R8.2.3', 'a specialist carriage stores nothing', () => {
    const s = game(2);
    const before = storageCapacity(s, 0);
    setTrain(s, 0, [['crew', null], [null, null], [null, null]]);
    assert.equal(storageCapacity(s, 0), before);
  });
  check('R9.4.1', 'each activation starts with builtThisActivation at zero', () => {
    const s = game(2, { moduleCarriageUpgrades: true });
    setTrain(s, 0, [[null, null], ['crew', null]]);
    installTile(s, 0, 2, 'U2-ground');
    give(s, 0, { resources: { iron: 2 } });
    const first = placeAndChoose(s, 'W6', 'D4');
    first.push(...act(s, { type: 'useStep' }));
    if (s.turn.player === 0) first.push(...finishTurn(s));
    assert.equal(vpBySource(first, 0).upgrades, 1);
    idleUntil(s, 0);
    give(s, 0, { resources: { iron: 2 }, tiles: { ground: 1 } });
    const second = choose(s, act(s, { type: 'removeWorker', from: 'W6' }), 'D4');
    second.push(...act(s, { type: 'useStep' }));
    if (s.turn.player === 0) second.push(...finishTurn(s));
    assert.equal(vpBySource(second, 0).upgrades, 1, 'the tile built last time is not counted again');
  });
  check('R9.4.5', '"per tile built" upgrade tiles are resolved when the step list is finished', () => {
    const s = game(2, { moduleCarriageUpgrades: true });
    setTrain(s, 0, [['crew', 'crew']]);
    installTile(s, 0, 1, 'U2-ground'); // its step comes before the two Crew of its own carriage
    give(s, 0, { resources: { iron: 6 } });
    const ev = placeAndChoose(s, 'W6', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 0) ev.push(...act(s, { type: 'useStep' }));
    assert.equal(vpBySource(ev, 0).upgrades, 3, 'tiles built after the tile\'s own step count too');
  });
  check('R18.5.3', 'buying: take the card and resolve it according to its kind', () => {
    const s = game(2, PONY);
    stock(s, 'PX7');
    giveTokens(s, 1, 2);
    idleTurn(s);
    const ev = act(s, { type: 'buyPonyCard', card: 'PX7' });
    assert.equal(vpBySource(ev, 1).ponyCards, 5);
    const all = ['A', 'B', 'C'].flatMap((r) => [...s.modules.pony.market[r], ...s.modules.pony.decks[r]]);
    assert.ok(!all.includes('PX7'), 'an immediate card is discarded');
  });
  check('R23.1', 'material of older sources is not in the game', () => {
    const types = Object.keys(ACTIONS).join(' ');
    assert.ok(!/bonusCard|wagon|objective|automa|solo|agendaMarker/i.test(types));
    for (const f of FILES) assert.ok(!/wagon spot|automa\b|solo mode|Theodore Judah|Missouri River/i.test(source(f)), f);
    assert.throws(() => createGame({ playerCount: 5, seed: 1 }));
    assert.throws(() => createGame({ playerCount: 6, seed: 1 }));
    assert.throws(() => createGame({ playerCount: 1, seed: 1 }));
    assert.equal(RULES.PONY_CARDS.length, 38, 'the 38 cards of January 2026, not the 33 of 2021');
    const s = game(2);
    assert.ok(!offered(s, 'hireSpecialist'), 'Hire Specialist is not an alternative on the centre district');
  });

  // ----- the data tables of the spec, every row ----------------------------------------
  check('A.1', 'Appendix A.1: the 25 cities - id, name, kind, number of routes, junction flag, region, y', () => {
    assert.equal(SPEC.A1.length, 25);
    assert.deepEqual(MAP.cityIds, SPEC.A1.map((c) => c.id), 'ids, in the order of the appendix');
    const state = game(2);
    for (const row of SPEC.A1) {
      const c = MAP.cityById[row.id];
      const kindOf = row.kind.startsWith('west') ? 'west' : row.kind.startsWith('east') ? 'east' : 'inland';
      assert.deepEqual([c.name, c.kind, MAP.cityRoutes[row.id].length, c.y], [row.name, kindOf, row.routes, row.y], row.id);
      assert.equal(isJunctionCity(state, row.id), row.junction, `${row.id} junction`);
      if (kindOf === 'inland') assert.equal(cityRegion(row.id, RULES.MAP_RULES), row.region.toLowerCase(), `${row.id} region`);
    }
  });
  check('A.2', 'Appendix A.2: the 47 routes - id, ends, slots and terrain in order', () => {
    assert.equal(SPEC.A2.length, 47);
    assert.deepEqual(MAP.routeIds, SPEC.A2.map((r) => r.id));
    const letter = { ground: 'G', tunnel: 'T', bridge: 'B' };
    for (const row of SPEC.A2) {
      const r = MAP.routeById[row.id];
      assert.deepEqual([MAP.cityById[r.a].name, MAP.cityById[r.b].name], [row.from, row.to], row.id);
      assert.equal(r.terrains.map((t) => letter[t]).join(''), row.terrain, row.id);
      assert.deepEqual([r.length, r.cost.ground, r.cost.tunnel, r.cost.bridge], [row.slots, row.ground, row.tunnel, row.bridge], row.id);
    }
  });
  check('A.3', 'Appendix A.3: facts derived from the map data', () => {
    const byLength = {};
    for (const r of MAP.routes) byLength[r.length] = (byLength[r.length] ?? 0) + 1;
    assert.deepEqual(byLength, { 2: 20, 3: 19, 4: 2, 5: 5, 6: 1 });
    for (const c of MAP.startCities) {
      const lengths = sorted(MAP.cityRoutes[c].map((id) => MAP.routeById[id].length));
      assert.ok(lengths[0] === 2 && [2, 5, 6].includes(lengths[1]), c);
    }
    // fewest slots from any west start city to any east start city: 14
    const dist = (from) => {
      const d = Object.fromEntries(MAP.cityIds.map((c) => [c, Infinity]));
      d[from] = 0;
      for (let changed = true; changed; ) {
        changed = false;
        for (const r of MAP.routes) {
          for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) {
            if (d[a] + r.length < d[b]) { d[b] = d[a] + r.length; changed = true; }
          }
        }
      }
      return d;
    };
    const best = Math.min(...MAP.westStartCities.flatMap((w) => MAP.eastStartCities.map((e) => dist(w)[e])));
    assert.equal(best, 14);
    assert.deepEqual([dist('LAX').MIN, dist('LAX').OMA], [17, 17]);
    assert.equal(MAP.inlandCities.length * 2, 34);
  });
  check('R10.1/table', 'R10.1: every row of the Congress strip', () => {
    const table = RULES.CONGRESS.tables['design-2026-10'];
    assert.deepEqual(table.map((e) => [e.id, e.tier, e.coinCost]), SPEC.R10_1.map((r) => [r.id, r.tier, r.coinCost]));
    table.forEach((e, i) => {
      const want = numbers(SPEC.R10_1[i].benefit.replace(/\(R[\d.]+\)/g, ''));
      const got = numbers(JSON.stringify(e.effects));
      assert.deepEqual(got.filter((n) => n > 1), want.filter((n) => n > 1), `${e.id}: ${SPEC.R10_1[i].benefit}`);
    });
  });
  check('R15.2/table', 'R15.2: all 16 upgrade tiles - id, level, name, effect', () => {
    assert.deepEqual(RULES.UPGRADE_TILES.map((t) => [t.id, t.level, t.name, t.text]), SPEC.R15_2.map((r) => [r.id, r.level, r.name, r.text]));
    RULES.UPGRADE_TILES.forEach((t, i) => {
      const machine = SPEC.R15_2[i].machine;
      const e = t.effects[0];
      assert.equal(t.effects.length, 1);
      if (/vpPerBuilt/.test(machine)) assert.deepEqual([e.type, e.terrain, e.amount], ['vpPerBuilt', machine.match(/"(\w+)"/)[1], 1], t.id);
      else if (/gainTile/.test(machine)) assert.deepEqual([e.type, e.terrain, e.count], ['gainBuiltTile', machine.match(/"(\w+)"/)[1], 1], t.id);
      else if (/vp:/.test(machine)) assert.deepEqual([e.type, e.amount], ['vp', numbers(machine)[0]], t.id);
      else {
        const [, item, n] = machine.match(/gain: \{ (\w+): (\d+) \}/);
        const key = { coin: 'coins', hat: 'hats' }[item] ?? item;
        assert.deepEqual([e.type, e.items], ['gain', { [key]: Number(n) }], t.id);
      }
      assert.equal(t.vpTile === true, /^\{ vp:/.test(machine), `${t.id} vpTile`);
    });
  });
  check('R16.5/table', 'R16.5: all 12 goals - number, name, direction, machine id', () => {
    assert.deepEqual(RULES.GOAL_CARDS.map((g) => [g.number, g.name, g.direction, g.metric]), SPEC.R16_5.map((r) => [r.number, r.name, r.direction, r.metric]));
    assert.deepEqual(RULES.GOAL_CARDS.filter((g) => g.requiresModule !== null).map((g) => g.number), [6]);
  });
  check('R16.8/table', 'R16.8: all 10 milestone tiles - id, name, VP, condition', () => {
    assert.deepEqual(RULES.MILESTONE_TILES.map((t) => [t.id, t.name, t.vp]), SPEC.R16_8.map((r) => [r.id, r.name, r.vp]));
    RULES.MILESTONE_TILES.forEach((t, i) => {
      const machine = SPEC.R16_8[i].machine;
      const metric = machine.match(/\{ (\w+):/)[1];
      assert.equal(t.condition.metric, metric, t.id);
      const terrain = machine.match(/\{ (tunnel|bridge|ground):/);
      assert.deepEqual(t.condition.filter && t.condition.filter.terrain ? t.condition.filter.terrain : null, terrain ? terrain[1] : null, t.id);
      const bound = machine.match(/"(>=)(\d+)"/);
      if (bound) assert.deepEqual([t.condition.op, t.condition.value], [bound[1], Number(bound[2])], t.id);
      else assert.deepEqual([t.id, t.condition.op, t.condition.value, t.condition.filter], ['MS7', '>=', 1, { owner: 'any' }]);
    });
  });
  check('R17.3/table', 'R17.3: all 17 Legislative Agenda cards - number, name, event, numbers', () => {
    assert.deepEqual(RULES.LEGISLATIVE_CARDS.map((c) => [c.number, c.name]), SPEC.R17_3.map((r) => [r.number, r.name]));
    const KIND = { telegraph: 'telegraphStation', railway: 'railwayStation' };
    RULES.LEGISLATIVE_CARDS.forEach((c, i) => {
      const machine = SPEC.R17_3[i].machine;
      assert.equal(c.effects.length, 1, c.id);
      const e = c.effects[0];
      assert.equal(e.type, 'trigger');
      assert.equal(e.on, machine.match(/on: "(\w+)"/)[1], `${c.id} event`);
      const field = (name) => (machine.match(new RegExp(`${name}: "(\\w+)"`)) ?? [])[1];
      if (field('terrain')) assert.equal(e.where.terrain, field('terrain'), c.id);
      if (field('kind')) assert.equal(e.where.kind, KIND[field('kind')], c.id);
      if (field('resource')) assert.equal(e.where.resource, field('resource') === 'coin' ? 'coins' : field('resource'), c.id);
      if (field('via')) assert.equal(e.where.via, field('via'), c.id);
      assert.equal(e.limit ?? null, field('once') === 'game' ? 'oncePerGame' : field('limit') === 'perActivation' ? 'oncePerActivation' : null, `${c.id} limit`);
      const cond = machine.match(/if: "(\w+)(?: (>=|==) (\d+))?"/);
      if (cond) {
        assert.equal(e.condition.metric, cond[1], c.id);
        assert.deepEqual([e.condition.op, e.condition.value], cond[2] ? [cond[2], Number(cond[3])] : ['>=', 1], c.id);
      } else assert.equal(e.condition, undefined, c.id);
      const effectNumbers = numbers(JSON.stringify(e.effect));
      const want = numbers(machine.replace(/if: "[^"]*"/, ''));
      assert.deepEqual(effectNumbers, want, `${c.id}: ${machine}`);
    });
  });
  check('R18.7/table', 'R18.7: all 38 Pony Express cards - number, rank, cost, name, kind, numbers; the removals', () => {
    assert.deepEqual(
      RULES.PONY_CARDS.map((c) => [c.number, c.rank, RULES.PONY.costs[c.rank], c.name, c.kind]),
      SPEC.R18_7.map((r) => [r.number, r.rank, r.cost, r.name, r.kind]),
    );
    const implicit = { 12: [1], 33: [2] }; // "1 VP for each", "twice as many": the number is in the words, not the machine form
    RULES.PONY_CARDS.forEach((c, i) => {
      let machine = SPEC.R18_7[i].machine;
      const same = machine.match(/^as card (\d+)$/);
      if (same) {
        const other = RULES.PONY_CARDS[Number(same[1]) - 1];
        assert.deepEqual(c.effects, other.effects, `card ${c.number} is the same as card ${same[1]}`);
        machine = SPEC.R18_7[Number(same[1]) - 1].machine;
      }
      const got = numbers(JSON.stringify(c.effects));
      const want = [...numbers(machine), ...(implicit[c.number] ?? [])].sort((a, b) => a - b);
      assert.deepEqual(got, want, `card ${c.number}: ${machine}`);
      const top = machine.match(/\{ (\w+)/)[1];
      const standing = { oncePerTurn: 'oncePerTurn', on: 'trigger', endVpPer: 'endVpPer' }[top];
      // Card 20 is written as an event in the spec and kept as a cost modifier in rules.js; its behaviour is check R18.7/20.
      if (standing && c.number !== 20) assert.equal(c.effects[0].type, standing, `card ${c.number}`);
      if (top === 'on' && c.number !== 20) assert.equal(c.effects[0].on === 'trainActivationStart' ? 'trainActivation' : c.effects[0].on, machine.match(/on: "(\w+)"/)[1], `card ${c.number} event`);
    });
    assert.deepEqual(RULES.PONY_CARDS.filter((c) => c.removedWhen).map((c) => [c.number, c.removedWhen]), [
      [3, { claimFrom: 'network' }],
      [14, { claimFrom: 'network' }],
      [31, { bothBuildingsSameOwner: false }],
    ]);
  });
  check('R20.3/table', 'R20.3: both rows of the building table', () => {
    assert.deepEqual(RULES.SCORING.buildingTable, SPEC.R20_3);
  });
  check('R21.3/table', 'R21.3: all 25 variants - name, type, allowed values, default, as the spec\'s table has them', () => {
    assert.equal(SPEC.R21_3.length, 25);
    VARIANTS.forEach((v, i) => {
      const row = SPEC.R21_3[i];
      assert.equal(v.name, row.name);
      assert.equal(String(v.default), row.default, v.name);
      if (v.type === 'enum') assert.deepEqual(v.values, row.allowed.split(', '), v.name);
      else if (v.type === 'boolean') assert.equal(row.allowed, 'true, false', v.name);
      else assert.deepEqual([v.min, v.max], row.allowed.match(/\d+/g).slice(0, 2).map(Number), v.name);
      assert.equal(v.type.replace(/-/g, ' '), row.type, v.name);
    });
  });

  // ----- R21.4: tuning numbers in the logic files ---------------------------------------
  check('R21.4/literals', 'no tuning number is written as a bare literal in actions.js, legality.js, queries.js, scoring.js or conditions.js', () => {
    // What may appear besides 0 and 1: nothing that is a number of the rules.
    const allowed = {
      'actions.js': ['10000', '2'], // ENGINE_LIMITS.maxAutoSteps (a safety limit, not a rule); "two parts" of Pony Express card 9
      'legality.js': ['0, 1, 2'], // the option numbers of a chooseOption action in getActionSpace (diagnostics)
      'queries.js': [],
      'scoring.js': ['2'], // "a 2-player game" of R16.4.4 (the number of places awarded is K.SCORING.goalPlacesTwoPlayers)
      'conditions.js': [],
    };
    for (const f of Object.keys(allowed)) {
      const found = [];
      for (const line of bare(source(f)).split('\n')) {
        const cleaned = line.replace(/\[0, 1, 2\]/, () => { found.push('0, 1, 2'); return ''; });
        for (const m of cleaned.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)(?![\w$])/g)) {
          if (m[1] !== '0' && m[1] !== '1') found.push(m[1]);
        }
      }
      assert.deepEqual(sorted(found), sorted(allowed[f]), `${f}: numeric literals ${JSON.stringify(found)}`);
    }
  });
  check('R21.4/card33', 'the factor of Pony Express card 33 is read from the card data, not written into the logic', () => {
    const cards = JSON.parse(JSON.stringify(RULES.PONY_CARDS));
    cards[32].effects[0].modifier.value = 3;
    const s = game(2, PONY, { constants: { PONY_CARDS: cards } });
    stock(s, 'PX33');
    giveTokens(s, 1, 5);
    setTrain(s, 1, [['crew', null]]);
    give(s, 1, { resources: { iron: 8 } });
    idleTurn(s);
    act(s, { type: 'buyPonyCard', card: 'PX33' });
    if (kind(s) === 'chooseSpecialistType') act(s, { type: 'chooseSpecialistType', specialist: 'crew' });
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    placeAndChoose(s, 'W8', 'D4');
    while (kind(s) === 'trainActivation' && s.turn.player === 1) act(s, { type: 'useStep' });
    assert.equal(s.players[1].builtTiles.ground, 1 + 3);
  });
  check('R21.4/token', 'the resources a returned token gives are read from the constants', () => {
    const s = game(2, PONY, { constants: { PONY: { resourcesPerToken: 2 } } });
    giveTokens(s, 1, 1);
    idleTurn(s);
    act(s, { type: 'exchangeToken', resource: 'wood' });
    assert.equal(s.players[1].resources.wood, 3);
  });
  check('R21.4/consistent', 'the named constants agree with each other: 11 houses on 4 tracks of 3 slots, 7 telegraph stations on a row of 7', () => {
    const K = RULES;
    assert.equal(K.PLAYER_BOARD.houseTracks.length * K.PLAYER_BOARD.houseSlotsPerTrack - 1, K.PLAYER_BOARD.houses);
    assert.equal(K.PLAYER_BOARD.telegraphRowVp.length, K.PLAYER_BOARD.telegraphStations);
    assert.equal(getConstants(game(2)), RULES);
  });

  // ----- places where the SPEC can be read two ways: not checked, listed for the designer ----------
  skip('R5.4.4/voluntary', 'may a player who could place a worker instead choose the no-action Remove of a worker on the centre of D5?',
    'R5.4.4 says "only in this case" (R5.4.1 requires that worker), the rule heading calls it a "forced Remove"; the engine offers it whenever the D5 action cannot be chosen, even if other worker moves exist.');
  skip('R4.6.3/network', 'in network mode, does a possible station step make Lay Tracks choosable when no claim is possible?',
    'R4.6.3 names only "a legal claim or a legal move"; R11.11.5 puts the station step "instead" of Move Train. The engine needs a legal claim.');
  skip('R19.2/after-trigger', 'is the transcontinental bonus still paid when the first line is completed after the end was triggered by the map filling up or the turn limit?',
    'R19.2 says "the first time in the game"; R19.6 says after the trigger "only R19.2 cannot happen again". The engine pays the bonus once, whenever the first line is completed.');
  skip('R17.3/18-19-card28', 'does a Hire Specialist or Add Carriage bonus action taken through Pony Express card 28 count for Legislative Agenda cards 18 and 19?',
    'Cards 18 and 19 say "with the ... bonus action" and "not for cards"; card 28 lets the player take "one of the four bonus actions". The engine does not count it.');
  skip('R20.1/free-entries', 'to which VP source do the VP of a Congress entry taken free through a card belong (Reset or C6 through Pony Express cards 13 and 24 or Legislative Agenda card 20)?',
    'R20.1 gives Reset and C6 to "congress" and "every VP scored only because of" a card to the card\'s source. The engine books them to congress.');
  skip('R20.5.4/rounds', 'with turnStructure rounds the start player marker moves: is "closest to the start player" measured from the final round\'s start player or from seat 1?',
    'R4.8.3 moves the marker; R20.5.4 does not say which start player. The engine uses the start player of the final round.');

  // ----- engine additions made during the audit (docs/engine-contract.md, sections 10 and 13) ----
  check('engine/constants-kind', 'createGame rejects a constant override of another kind than its default in rules.js', () => {
    const make = (constants) => () => createGame({ playerCount: 2, seed: 1, variants: MODULES_OFF, constants });
    assert.throws(make({ SCORING: { firstConnectionVp: 'x' } }), /firstConnectionVp/);
    assert.throws(make({ SCORING: { firstConnectionVp: null } }));
    assert.throws(make({ SCORING: { firstConnectionVp: NaN } }));
    assert.throws(make({ SCORING: { goalVp: [10] } }), /goalVp/);
    assert.throws(make({ SCORING: { goalVp: [10, '5'] } }), /goalVp\[1\]/);
    assert.throws(make({ PLAYER_BOARD: { telegraphRowVp: [1, 2, 3] } }));
    assert.throws(make({ SCORING: { buildingTable: { rising: 'steep' } } }));
    assert.throws(make({ MAP_RULES: { moveBuildCost: { coins: '2' } } }));
    assert.throws(make({ GRID: { shufflePositions: ['D1', 'D3', 7] } }));
    assert.throws(make({ SCORING: { noSuchConstant: 1 } }), /Unknown constant/);
    assert.doesNotThrow(make({ SCORING: { firstConnectionVp: 7, goalVp: [12, 6] }, MAP_RULES: { moveBuildCost: { coins: 3 } } }));
  });
  check('engine/turnEnd-last', 'turnEnd is emitted after the end-of-turn milestone check and the end triggers (R4.2 step 6)', () => {
    const s = game(2, { endGameScoring: 'milestones', maxTurnsPerPlayer: 1 });
    s.modules.milestones.inPlay = ['MS9'];
    s.modules.milestones.claimedBy = { MS9: null };
    setTrain(s, 0, [['crew', null], [null, null]]);
    s.players[0].train.storageCarriages = 3;
    const ev = idleTurn(s).map((e) => e.type);
    const end = ev.indexOf('turnEnd');
    assert.ok(ev.indexOf('milestoneClaimed') >= 0 && ev.indexOf('milestoneClaimed') < end);
    assert.ok(ev.indexOf('gameEndTriggered') >= 0 && ev.indexOf('gameEndTriggered') < end);
    assert.ok(ev.indexOf('turnStart') > end, 'and before the next turn starts');
    const last = idleTurn(s).map((e) => e.type);
    assert.ok(last.indexOf('turnEnd') < last.indexOf('gameOver'));
  });
  check('engine/bonusAction-event', 'a bonusAction event { player, district, bonus } is emitted when a bonus action is taken', () => {
    const s = game(2);
    placeAndChoose(s, 'W11', 'D7');
    const ev = eventsOf(act(s, { type: 'buyHat' }), 'bonusAction');
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].player, ev[0].district, ev[0].bonus, ev[0].free], [0, 'D7', 'hat', false]);
    const skipped = placeAndChoose(s, 'W12', 'D9');
    skipped.push(...act(s, { type: 'skipBonusAction' }));
    assert.equal(eventsOf(skipped, 'bonusAction').length, 0, 'not when the bonus action is declined');
    const p = game(2, PONY);
    ownCard(p, 1, 'PX28');
    idleTurn(p);
    act(p, { type: 'usePonyCard', card: 'PX28' });
    const free = eventOf(act(p, { type: 'addCarriage', carriage: 'storage' }), 'bonusAction');
    assert.deepEqual([free.player, free.district, free.bonus, free.free], [1, null, 'carriage', true]);
  });
  check('engine/turn-number', 'turnStart and turnEnd events carry the running turn number', () => {
    const s = game(3);
    const first = idleTurn(s);
    assert.deepEqual([eventOf(first, 'turnEnd').turn, eventOf(first, 'turnStart').turn], [1, 2]);
    const second = idleTurn(s);
    assert.deepEqual([eventOf(second, 'turnEnd').turn, eventOf(second, 'turnEnd').player, eventOf(second, 'turnStart').turn], [2, 1, 3]);
  });
}
