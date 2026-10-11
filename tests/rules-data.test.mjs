// rules-data.test.mjs - the data tables of rules.js and the map data.
//
// Semantics: permanently green; exits 1 on any failure.
//
// The tables were typed in once from rules spec v2. This suite guards them:
// shape, counts, unique ids, internal consistency, and that every word they
// use belongs to the documented effect vocabulary. One check, "printed values
// of R21.4", repeats the spec's tuning numbers so that an accidental edit is
// caught in one place; a deliberate balance change updates that one check.
//
// tests/data-integrity.test.mjs adds for what needs the module code (every
// metric known to the interpreter, no goal or milestone claimable on a fresh
// board). This suite needs no module code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as engine from '../src/engine/index.js';
import { ROUTE_MAP } from '../src/engine/data/route-map.js';
import { makeSuite } from './helpers/play.mjs';

const {
  RULES,
  R21_4_CONSTANTS,
  EFFECT_TYPES,
  TRIGGER_EVENTS,
  MODIFIER_KINDS,
  CONDITION_OPS,
  METRIC_NAMES,
  MAP,
  buildMap,
  mapSlotTotals,
  junctionCities,
  cityRegion,
  DISTRICT_IDS,
  SPACE_IDS,
  SPACE_DISTRICTS,
  DISTRICT_SPACES,
  DISTRICT_NEIGHBOURS,
  evaluateCondition,
  describeProgress,
  createGame,
} = engine;

const suite = makeSuite('rules-data');
const here = dirname(fileURLToPath(import.meta.url));

const COST_KEYS = ['iron', 'wood', 'gunpowder', 'coins'];
const GAIN_KEYS = [...COST_KEYS, 'hats'];

function isCost(cost) {
  return cost !== null && typeof cost === 'object' && Object.keys(cost).every((k) => COST_KEYS.includes(k) && Number.isInteger(cost[k]) && cost[k] > 0);
}

function uniqueIds(list, label) {
  const ids = list.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ids`);
}

/** Walks an effect and everything nested in it, checking each word against the vocabulary. */
function checkEffect(effect, where) {
  assert.ok(effect !== null && typeof effect === 'object', `${where}: an effect must be an object`);
  assert.ok(EFFECT_TYPES.includes(effect.type), `${where}: unknown effect type "${effect.type}"`);
  switch (effect.type) {
    case 'vp':
      assert.ok(Number.isInteger(effect.amount) && effect.amount > 0, `${where}: vp amount`);
      break;
    case 'gain':
      for (const key of Object.keys(effect.items)) {
        assert.ok(GAIN_KEYS.includes(key), `${where}: cannot gain "${key}"`);
        assert.ok(Number.isInteger(effect.items[key]) && effect.items[key] > 0);
      }
      break;
    case 'gainChoice':
      assert.ok(Number.isInteger(effect.count) && effect.count > 0, `${where}: count`);
      break;
    case 'gainBuiltTile':
      assert.ok(RULES.TERRAINS.includes(effect.terrain) && effect.count > 0, `${where}: terrain`);
      break;
    case 'gainBuiltTilesChoice':
      assert.ok(Number.isInteger(effect.count) && typeof effect.distinct === 'boolean', `${where}: count / distinct`);
      if (effect.distinct) assert.ok(effect.count <= RULES.TERRAINS.length);
      break;
    case 'addCarriage':
      assert.ok(['specialist', 'storage', 'choice'].includes(effect.carriage), `${where}: carriage`);
      break;
    case 'hire':
      assert.ok(Number.isInteger(effect.count) && typeof effect.free === 'boolean', `${where}: hire`);
      break;
    case 'steps':
      assert.ok(Number.isInteger(effect.move ?? effect.claim), `${where}: steps`);
      break;
    case 'exchange':
      assert.ok(Number.isInteger(effect.max), `${where}: exchange`);
      break;
    case 'vpPer':
    case 'endVpPer':
      assert.ok(METRIC_NAMES.includes(effect.metric), `${where}: unknown metric "${effect.metric}"`);
      assert.ok(Number.isInteger(effect.amount) && effect.amount > 0);
      break;
    case 'vpPerBuilt':
      assert.ok(RULES.TERRAINS.includes(effect.terrain) && effect.amount > 0, `${where}: vpPerBuilt`);
      break;
    case 'freeCongress':
      assert.ok(Number.isInteger(effect.tier) && Number.isInteger(effect.count), `${where}: freeCongress`);
      break;
    case 'chooseOne':
      assert.ok(Array.isArray(effect.options) && effect.options.length >= 2, `${where}: chooseOne needs options`);
      effect.options.forEach((option, i) => option.forEach((e, j) => checkEffect(e, `${where} option ${i + 1}.${j + 1}`)));
      break;
    case 'placeBuildings':
      assert.ok(Number.isInteger(effect.railwayStation) && Number.isInteger(effect.telegraphStation));
      break;
    case 'trigger':
      assert.ok(TRIGGER_EVENTS.includes(effect.on), `${where}: unknown trigger event "${effect.on}"`);
      if (effect.condition) {
        assert.ok(METRIC_NAMES.includes(effect.condition.metric), `${where}: unknown metric "${effect.condition.metric}"`);
        assert.ok(CONDITION_OPS.includes(effect.condition.op), `${where}: unknown operator`);
        assert.ok(Number.isInteger(effect.condition.value));
      }
      checkEffect(effect.effect, `${where} -> effect`);
      break;
    case 'modifier':
      assert.ok(MODIFIER_KINDS.includes(effect.what), `${where}: unknown modifier "${effect.what}"`);
      assert.ok(effect.value !== undefined || effect.amount !== undefined, `${where}: a modifier needs value or amount`);
      break;
    case 'untilEndOfTurn':
      assert.ok(MODIFIER_KINDS.includes(effect.modifier.what), `${where}: unknown modifier "${effect.modifier.what}"`);
      break;
    case 'oncePerTurn':
      checkEffect(effect.effect, `${where} -> effect`);
      break;
    default:
      break; // types with no further fields to check
  }
}

// --- vocabulary and aggregate ------------------------------------------------

suite.check('index.js exports every table (no export name is lost to a clash between files)', () => {
  for (const name of Object.keys(RULES)) assert.equal(engine[name], RULES[name], `engine.${name}`);
  for (const name of ['createGame', 'getValidActions', 'applyAction', 'getBlockReason', 'cloneState', 'hashState', 'isGameOver', 'scoreGame', 'makeRng', 'determinise', 'resolveVariants', 'VARIANTS', 'MAP', 'ACTIONS', 'FRAMES']) {
    assert.ok(engine[name] !== undefined, `engine.${name} is missing`);
  }
});

suite.check('all rules data is plain JSON', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(RULES)), RULES);
});

suite.check('every constant named in spec R21.4 resolves to a value in RULES', () => {
  assert.equal(Object.keys(R21_4_CONSTANTS).length, 40);
  for (const [name, path] of Object.entries(R21_4_CONSTANTS)) {
    let value = RULES;
    for (const part of path.split('.')) value = value === undefined ? undefined : value[part];
    assert.ok(value !== undefined && value !== null, `${name} -> ${path} is missing`);
  }
});

suite.check('printed values of R21.4 (the one place the spec numbers are repeated)', () => {
  const { SETUP, PLAYER_BOARD, HATS, TRAIN, BONUS_ACTIONS, CONGRESS, MAP_RULES, SCORING, PONY } = RULES;
  assert.deepEqual(SETUP.workersByPlayerCount, { 2: 6, 3: 4, 4: 3 });
  assert.deepEqual(SETUP.startingResources, { iron: 1, wood: 1, gunpowder: 1 });
  assert.equal(SETUP.startingCoins, 1);
  assert.deepEqual(SETUP.graduatedCompensation, [0, 1, 1, 2]);
  assert.equal(PLAYER_BOARD.houseSlotsPerTrack, 3);
  assert.equal(PLAYER_BOARD.houses, 11);
  assert.deepEqual(PLAYER_BOARD.telegraphRowVp, [1, 2, 3, 4, 5, 6, 9]);
  assert.deepEqual(PLAYER_BOARD.houseTracks, ['wood', 'coins', 'iron', 'gunpowder']);
  assert.equal(HATS.hatLimit, 2);
  assert.equal(HATS.hatsPerTurn, 1);
  assert.equal(HATS.displacementHatsPerWorker, 1);
  assert.equal(TRAIN.storagePerCarriage, 9);
  assert.equal(TRAIN.maxSpecialistCarriages, 3);
  assert.equal(TRAIN.maxStorageCarriages, 3);
  assert.equal(TRAIN.specialistsPerType, 12);
  assert.deepEqual(
    Object.fromEntries(Object.entries(BONUS_ACTIONS).map(([id, b]) => [id, b.cost])),
    { upgrade: { iron: 1 }, hire: { coins: 1 }, hat: { gunpowder: 1 }, carriage: { wood: 1 } },
  );
  assert.deepEqual(TRAIN.hireCosts, {
    crew: [{ iron: 1, gunpowder: 1 }, { iron: 2, gunpowder: 1 }, { iron: 2, gunpowder: 2 }],
    miner: [{ gunpowder: 1, wood: 1 }, { gunpowder: 2, wood: 1 }, { gunpowder: 2, wood: 2 }],
    engineer: [{ wood: 1, coins: 1 }, { wood: 2, coins: 1 }, { wood: 2, coins: 2 }],
    financier: [{ coins: 1, iron: 1 }, { coins: 2, iron: 1 }, { coins: 2, iron: 2 }],
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(TRAIN.recipes).map(([rate, r]) => [rate, [r.crew.cost, r.miner.cost, r.engineer.cost, r.financier.cost]])),
    {
      '1:1': [{ iron: 1 }, { gunpowder: 1 }, { wood: 1 }, {}],
      '2:1': [{ iron: 2 }, { gunpowder: 2 }, { wood: 2 }, {}],
      'iron-in-all': [{ iron: 2 }, { gunpowder: 1, iron: 1 }, { wood: 1, iron: 1 }, {}],
    },
  );
  assert.equal(CONGRESS.lobbyPointsPerFinancierStep, 1);
  assert.equal(CONGRESS.resetVpPerSenator, 1);
  assert.deepEqual(
    CONGRESS.tables['design-2026-10'].map((e) => [e.id, e.tier, e.coinCost]),
    [['C1', 1, 1], ['C2', 1, 1], ['C3', 2, 2], ['C4', 2, 2], ['C5', 3, 3], ['C6', 3, 3], ['CR', 1, 1]],
  );
  assert.equal(SCORING.vpPerSlot, 1);
  assert.equal(SCORING.firstConnectionVp, 5);
  assert.equal(SCORING.tollVp, 3);
  assert.equal(SCORING.completionVp, 25);
  assert.equal(SCORING.completionVpPerSlot, 3);
  assert.deepEqual(SCORING.goalVp, [10, 5]);
  assert.equal(SCORING.ponyTokenEndVp, 1);
  assert.deepEqual(SCORING.buildingTable.rising, [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 70, 79, 88, 98, 108]);
  assert.deepEqual(SCORING.buildingTable['2018'], [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87]);
  assert.deepEqual(MAP_RULES.moveBuildCost, { coins: 2 });
  assert.deepEqual(MAP_RULES.stationStepCost, { coins: 2 });
  assert.deepEqual(MAP_RULES.buildingsPerInlandCity, { railwayStation: 1, telegraphStation: 1 });
  assert.equal(MAP_RULES.junctionMinRoutes, 5);
  assert.equal(MAP_RULES.northRegionMaxY, 140);
  assert.equal(MAP_RULES.southRegionMinY, 250);
  assert.deepEqual(PONY.costs, { A: 2, B: 3, C: 5 });
  assert.equal(PONY.marketPerRank, 2);
});

// --- the grid ----------------------------------------------------------------

suite.check('the action grid: 9 districts, 12 worker spaces, adjacency as in R5.2', () => {
  assert.equal(DISTRICT_IDS.length, 9);
  assert.equal(SPACE_IDS.length, 12);
  // The two tables of R5.2, as printed.
  assert.deepEqual(DISTRICT_SPACES, {
    D1: ['W1', 'W3'], D2: ['W1', 'W2', 'W4'], D3: ['W2', 'W5'], D4: ['W3', 'W6', 'W8'], D5: ['W4', 'W6', 'W7', 'W9'],
    D6: ['W5', 'W7', 'W10'], D7: ['W8', 'W11'], D8: ['W9', 'W11', 'W12'], D9: ['W10', 'W12'],
  });
  assert.deepEqual(DISTRICT_NEIGHBOURS, {
    D1: ['D2', 'D4'], D2: ['D1', 'D3', 'D5'], D3: ['D2', 'D6'], D4: ['D1', 'D5', 'D7'], D5: ['D2', 'D4', 'D6', 'D8'],
    D6: ['D3', 'D5', 'D9'], D7: ['D4', 'D8'], D8: ['D5', 'D7', 'D9'], D9: ['D6', 'D8'],
  });
  // Every worker space lies between two orthogonal neighbours, and every such border has exactly one space.
  const borders = new Set();
  for (const w of SPACE_IDS) {
    const [a, b] = SPACE_DISTRICTS[w];
    assert.ok(DISTRICT_NEIGHBOURS[a].includes(b), `${w} joins ${a} and ${b}, which are not neighbours`);
    borders.add([a, b].sort().join('-'));
  }
  assert.equal(borders.size, 12);
});

suite.check('the district tiles: four Gather, four train activations, one Lay Tracks (R5.1)', () => {
  const { GRID, BONUS_ACTIONS, SPECIALIST_TYPES, PLAYER_BOARD } = RULES;
  const tiles = Object.values(GRID.defaultTiles);
  assert.equal(new Set(tiles).size, 9);
  assert.deepEqual(tiles.slice().sort(), Object.keys(GRID.districtTiles).sort());
  const families = tiles.map((t) => GRID.districtTiles[t].family);
  assert.equal(families.filter((f) => f === 'gather').length, 4);
  assert.equal(families.filter((f) => f === 'trainActivation').length, 4);
  assert.equal(families.filter((f) => f === 'layTracks').length, 1);
  assert.equal(GRID.districtTiles[GRID.defaultTiles.D5].family, 'layTracks', 'Lay Tracks is the centre district');
  const gathers = Object.values(GRID.districtTiles).filter((t) => t.family === 'gather');
  assert.deepEqual(gathers.map((t) => t.gathers).sort(), PLAYER_BOARD.houseTracks.slice().sort(), 'one Gather district per house track');
  assert.deepEqual(gathers.map((t) => t.bonusAction).sort(), Object.keys(BONUS_ACTIONS).sort(), 'each bonus action is printed once');
  const foremen = Object.values(GRID.districtTiles).filter((t) => t.family === 'trainActivation').map((t) => t.foremanType);
  assert.deepEqual(foremen.slice().sort(), SPECIALIST_TYPES.slice().sort(), 'one train district per specialist type');
  for (const d of GRID.shufflePositions) assert.equal(GRID.districtTiles[GRID.defaultTiles[d]].family, 'gather');
});

// --- the train ---------------------------------------------------------------

suite.check('hire costs and recipes cover every type, level and conversion rate', () => {
  const { TRAIN, SPECIALIST_TYPES, TERRAINS } = RULES;
  const rates = engine.getVariantDef('conversionRate').values;
  assert.deepEqual(Object.keys(TRAIN.recipes).sort(), rates.slice().sort());
  for (const type of SPECIALIST_TYPES) {
    assert.equal(TRAIN.hireCosts[type].length, TRAIN.maxSpecialistCarriages, `${type}: one hire cost per carriage level`);
    let previous = 0;
    for (const cost of TRAIN.hireCosts[type]) {
      assert.ok(isCost(cost), `${type}: hire cost`);
      const total = Object.values(cost).reduce((a, b) => a + b, 0);
      assert.ok(total > previous, `${type}: a higher level must cost more`);
      previous = total;
    }
    for (const rate of rates) {
      const recipe = TRAIN.recipes[rate][type];
      assert.ok(recipe, `${rate}: no recipe for ${type}`);
      assert.ok(Object.keys(recipe.cost).length === 0 || isCost(recipe.cost));
    }
  }
  for (const rate of rates) {
    const r = TRAIN.recipes[rate];
    // R8.8: the pairings Iron -> Ground, Gunpowder -> Tunnel, Wood -> Bridge are fixed.
    assert.deepEqual([r.crew.output, r.miner.output, r.engineer.output], TERRAINS);
    assert.equal(r.financier.output, 'lobbyPoint');
    assert.deepEqual(r.financier.cost, {});
    assert.ok(r.crew.cost.iron > 0 && r.miner.cost.gunpowder > 0 && r.engineer.cost.wood > 0);
  }
  assert.equal(TRAIN.activationsByLevel.length, TRAIN.maxSpecialistCarriages);
});

// --- Congress ----------------------------------------------------------------

suite.check('both Congress tables: tiers match coin costs, one Reset, known effects (R10.1)', () => {
  const tables = RULES.CONGRESS.tables;
  assert.deepEqual(Object.keys(tables).sort(), engine.getVariantDef('congressTable').values.slice().sort());
  assert.equal(tables['design-2026-10'].filter((e) => !e.reset).length, 6, 'six entries, six senators (R2.1)');
  assert.equal(tables['jan-2026'].filter((e) => !e.reset).length, 7, 'seven entries, seven senators');
  for (const [name, table] of Object.entries(tables)) {
    uniqueIds(table, name);
    assert.equal(table.filter((e) => e.reset).length, 1, `${name}: exactly one Reset`);
    for (const entry of table) {
      assert.ok([1, 2, 3].includes(entry.tier), `${entry.id}: tier`);
      assert.equal(entry.coinCost, entry.tier, `${entry.id}: tier n costs n Coins`);
      assert.ok(entry.text.length > 0);
      entry.effects.forEach((e, i) => checkEffect(e, `${name} ${entry.id} effect ${i + 1}`));
    }
    const createdUsed = createGame({ playerCount: 2, seed: 1, variants: { congressTable: name } }).congress.used;
    assert.deepEqual(Object.keys(createdUsed), table.filter((e) => !e.reset).map((e) => e.id), 'the state tracks one senator per entry');
  }
});

// --- scoring -----------------------------------------------------------------

suite.check('the building tables: 19 values, rising, identical up to 13 buildings (R20.3)', () => {
  const tables = RULES.SCORING.buildingTable;
  assert.deepEqual(Object.keys(tables).sort(), engine.getVariantDef('buildingScoreCurve').values.slice().sort());
  const most = RULES.PLAYER_BOARD.houses + RULES.PLAYER_BOARD.telegraphStations;
  for (const [name, table] of Object.entries(tables)) {
    assert.equal(table.length, most + 1, `${name}: one value for each of 0 to ${most} buildings`);
    assert.equal(table[0], 0);
    for (let i = 1; i < table.length; i++) assert.ok(table[i] > table[i - 1], `${name}: more buildings must score more`);
  }
  assert.deepEqual(tables.rising.slice(0, 14), tables['2018'].slice(0, 14));
  const steps = (t) => t.slice(1).map((v, i) => v - t[i]);
  const rising = steps(tables.rising);
  for (let i = 1; i < rising.length; i++) assert.ok(rising[i] >= rising[i - 1], 'rising: each building is worth at least as much as the one before');
});

suite.check('the VP sources are the 13 of R20.1 and R20.2, with modules that exist', () => {
  const ids = RULES.VP_SOURCES.map((s) => s.id);
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
  const modules = Object.keys(engine.activeModules(engine.defaultVariants()));
  for (const s of RULES.VP_SOURCES) {
    assert.ok(['play', 'final'].includes(s.when));
    assert.ok(s.module === null || modules.includes(s.module), `${s.id}: unknown module ${s.module}`);
  }
  assert.deepEqual(RULES.VP_SOURCES.filter((s) => s.when === 'final').map((s) => s.id), ['buildingsEnd', 'goals', 'ponyEnd']);
  assert.deepEqual(RULES.END_REASONS, ['transcontinental', 'routes-claimed', 'turn-limit']);
});

// --- module data -------------------------------------------------------------

suite.check('carriage upgrade tiles: 16, as 6 / 5 / 5 by level (R15.2)', () => {
  const tiles = RULES.UPGRADE_TILES;
  uniqueIds(tiles, 'upgrade tiles');
  assert.equal(tiles.length, 16);
  assert.deepEqual([1, 2, 3].map((level) => tiles.filter((t) => t.level === level).length), [6, 5, 5]);
  for (const t of tiles) {
    assert.match(t.id, new RegExp(`^U${t.level}-`), `${t.id}: the id carries the level`);
    assert.ok(t.name.length > 0 && t.text.length > 0);
    assert.ok(t.level <= RULES.TRAIN.maxSpecialistCarriages);
    t.effects.forEach((e, i) => checkEffect(e, `${t.id} effect ${i + 1}`));
  }
  const vpTiles = tiles.filter((t) => t.vpTile);
  assert.deepEqual(vpTiles.map((t) => t.id), ['U1-vp', 'U2-vp', 'U3-vp'], 'the three tiles of R15.6');
  assert.deepEqual(vpTiles.map((t) => t.effects[0].amount), [2, 3, 4]);
  for (const terrain of RULES.TERRAINS) {
    assert.equal(tiles.filter((t) => t.effects[0].type === 'vpPerBuilt' && t.effects[0].terrain === terrain).length, 1);
    assert.equal(tiles.filter((t) => t.effects[0].type === 'gainBuiltTile' && t.effects[0].terrain === terrain).length, 1);
  }
});

suite.check('goal cards: 12, numbered 1 to 12, known metrics (R16.5)', () => {
  const goals = RULES.GOAL_CARDS;
  uniqueIds(goals, 'goals');
  assert.deepEqual(goals.map((g) => g.number), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(goals.map((g) => g.metric)).size, 12, 'each goal measures something different');
  for (const g of goals) {
    assert.equal(g.id, `G${g.number}`);
    assert.ok(METRIC_NAMES.includes(g.metric), `${g.id}: unknown metric "${g.metric}"`);
    assert.ok(['most', 'fewest'].includes(g.direction));
    assert.ok(g.name.length > 0 && g.text.length > 0);
  }
  assert.deepEqual(goals.filter((g) => g.direction === 'fewest').map((g) => g.number), [10]);
  assert.deepEqual(goals.filter((g) => g.requiresModule !== null).map((g) => [g.number, g.requiresModule]), [[6, 'upgrades']]);
  assert.equal(RULES.SCORING.goalVp.length, 2);
});

suite.check('milestone tiles: 10, 5 to 8 VP each, declarative conditions (R16.8)', () => {
  const tiles = RULES.MILESTONE_TILES;
  uniqueIds(tiles, 'milestones');
  assert.deepEqual(tiles.map((t) => t.id), Array.from({ length: 10 }, (_, i) => `MS${i + 1}`));
  for (const t of tiles) {
    assert.ok(Number.isInteger(t.vp) && t.vp >= 5 && t.vp <= 8, `${t.id}: VP`);
    assert.ok(METRIC_NAMES.includes(t.condition.metric), `${t.id}: unknown metric "${t.condition.metric}"`);
    assert.ok(CONDITION_OPS.includes(t.condition.op));
    assert.ok(Number.isInteger(t.condition.value) && t.condition.value > 0, `${t.id}: a threshold of 0 would be claimable at once`);
    assert.ok(t.name.length > 0 && t.text.length > 0);
  }
  assert.equal(tiles.reduce((sum, t) => sum + t.vp, 0), 60);
  assert.ok(engine.getVariantDef('milestonesInPlay').max === tiles.length);
});

suite.check('Legislative Agenda cards: 20, numbered 1 to 20, every effect in the vocabulary (R17.3)', () => {
  const cards = RULES.LEGISLATIVE_CARDS;
  uniqueIds(cards, 'Legislative Agenda');
  assert.deepEqual(cards.map((c) => c.number), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(cards.map((c) => c.name)).size, 20);
  for (const c of cards) {
    assert.equal(c.id, `LA${c.number}`);
    assert.ok(c.text.length > 0);
    assert.ok(c.effects.length > 0);
    c.effects.forEach((e, i) => {
      assert.equal(e.type, 'trigger', `${c.id}: a Legislative Agenda card is a standing trigger`);
      checkEffect(e, `${c.id} effect ${i + 1}`);
    });
  }
  assert.equal(engine.getVariantDef('legislativeAgendaCard').max, cards.length);
  // Cards 1 to 3 and 11 to 14 come in families that differ only in terrain or resource.
  assert.deepEqual(cards.slice(0, 3).map((c) => c.effects[0].where.terrain).sort(), RULES.TERRAINS.slice().sort());
  assert.deepEqual(cards.slice(10, 14).map((c) => c.effects[0].where.resource).sort(), RULES.PLAYER_BOARD.houseTracks.slice().sort());
});

suite.check('Pony Express cards: 38 as 13 A, 11 B, 14 C, every effect in the vocabulary (R18.7)', () => {
  const cards = RULES.PONY_CARDS;
  uniqueIds(cards, 'Pony Express');
  assert.deepEqual(cards.map((c) => c.number), Array.from({ length: 38 }, (_, i) => i + 1));
  assert.deepEqual(RULES.PONY.ranks.map((rank) => cards.filter((c) => c.rank === rank).length), [13, 11, 14]);
  // Ranks come in blocks: A is 1 to 13, B is 14 to 24, C is 25 to 38.
  assert.deepEqual(cards.map((c) => c.rank).join(''), 'A'.repeat(13) + 'B'.repeat(11) + 'C'.repeat(14));
  for (const c of cards) {
    assert.equal(c.id, `PX${c.number}`);
    assert.ok(RULES.PONY.costs[c.rank] > 0);
    assert.ok(['immediate', 'ongoing', 'endgame'].includes(c.kind), `${c.id}: kind`);
    assert.ok(c.name.length > 0 && c.text.length > 0);
    assert.ok(c.effects.length > 0);
    c.effects.forEach((e, i) => checkEffect(e, `${c.id} effect ${i + 1}`));
    const standing = c.effects.some((e) => ['trigger', 'modifier', 'oncePerTurn'].includes(e.type));
    if (c.kind === 'ongoing') assert.ok(standing, `${c.id}: an ongoing card needs a standing effect`);
    if (c.kind === 'immediate') assert.ok(!standing, `${c.id}: an immediate card cannot have a standing effect`);
    if (c.kind === 'endgame') assert.ok(c.effects.every((e) => e.type === 'endVpPer'), `${c.id}: an endgame card scores at the end`);
    if (c.removedWhen) {
      for (const [variant, value] of Object.entries(c.removedWhen)) {
        assert.ok(engine.isAllowedValue(engine.getVariantDef(variant), value), `${c.id}: removedWhen names ${variant}=${value}`);
      }
    }
  }
  assert.deepEqual(cards.filter((c) => c.kind === 'endgame').map((c) => c.number), [31, 38]);
  assert.deepEqual(cards.filter((c) => c.kind === 'ongoing').map((c) => c.number), [14, 15, 16, 20, 21, 25, 26, 28, 29, 30, 32, 34, 35, 36, 37]);
  assert.deepEqual(cards.filter((c) => c.removedWhen).map((c) => c.number), [3, 14, 31]);
  // The three pairs with one name and one effect at two ranks (R18.7 notes).
  for (const [a, b] of [[8, 23], [10, 22], [13, 24]]) {
    assert.equal(cards[a - 1].name, cards[b - 1].name);
    assert.deepEqual(cards[a - 1].effects, cards[b - 1].effects);
    assert.notEqual(cards[a - 1].rank, cards[b - 1].rank);
  }
  assert.equal(engine.getVariantDef('ponyOngoingCap').max, cards.filter((c) => c.kind === 'ongoing').length);
});

suite.check('the effect vocabulary has no unused and no duplicated word', () => {
  for (const list of [EFFECT_TYPES, TRIGGER_EVENTS, MODIFIER_KINDS, CONDITION_OPS, METRIC_NAMES]) {
    assert.equal(new Set(list).size, list.length);
  }
  const text = JSON.stringify([RULES.CONGRESS, RULES.UPGRADE_TILES, RULES.LEGISLATIVE_CARDS, RULES.PONY_CARDS, RULES.GOAL_CARDS, RULES.MILESTONE_TILES]);
  for (const word of [...EFFECT_TYPES, ...TRIGGER_EVENTS, ...MODIFIER_KINDS, ...METRIC_NAMES]) {
    assert.ok(text.includes(`"${word}"`), `"${word}" is in the vocabulary but no table uses it`);
  }
});

suite.check('an unknown metric is false, never true (the interpreter default)', () => {
  const state = createGame({ playerCount: 2, seed: 1 });
  assert.equal(evaluateCondition(state, 0, { metric: 'noSuchMetric', op: '>=', value: 0 }), false);
  assert.equal(evaluateCondition(state, 0, { metric: 'noSuchMetric', op: '<=', value: 999 }), false);
  assert.equal(evaluateCondition(state, 0, { metric: 'toString', op: '>=', value: 0 }), false);
  assert.equal(evaluateCondition(state, 0, { metric: 'carriages', op: 'approximately', value: 0 }), false);
  assert.equal(evaluateCondition(state, 0, null), false);
  assert.equal(describeProgress(state, 0, { metric: 'noSuchMetric', op: '>=', value: 1 }).met, false);
});

// --- the map -----------------------------------------------------------------

suite.check('route-map.js and route-map.json hold the same data', () => {
  const json = JSON.parse(readFileSync(join(here, '..', 'src', 'engine', 'data', 'route-map.json'), 'utf8'));
  // The source file writes a straight route's bow as -0.0; a JSON round trip
  // turns that into 0, which is the only difference the generator makes.
  const normalised = JSON.parse(JSON.stringify(json));
  assert.deepEqual(ROUTE_MAP, normalised, 'regenerate with: node tools/build-route-map-module.mjs');
  assert.equal(JSON.stringify(ROUTE_MAP), JSON.stringify(json));
});

suite.check('the map: 25 cities, 47 routes, 136 slots, and the facts of Appendix A.3', () => {
  assert.equal(MAP.cities.length, 25);
  assert.equal(MAP.routes.length, 47);
  assert.equal(new Set(MAP.cityIds).size, 25);
  assert.equal(new Set(MAP.routeIds).size, 47);
  assert.deepEqual(mapSlotTotals(), { ground: 44, tunnel: 46, bridge: 46 });
  const byLength = {};
  for (const r of MAP.routes) byLength[r.length] = (byLength[r.length] ?? 0) + 1;
  assert.deepEqual(byLength, { 2: 20, 3: 19, 4: 2, 5: 5, 6: 1 });
  assert.deepEqual(MAP.westStartCities.map((id) => MAP.cityById[id].name), ['Seattle', 'Portland', 'Sacramento', 'Los Angeles']);
  assert.deepEqual(MAP.eastStartCities.map((id) => MAP.cityById[id].name), ['Minneapolis', 'Omaha', 'Kansas City', 'Fort Worth']);
  assert.equal(MAP.inlandCities.length, 17);
  assert.equal(MAP.startCities.length, RULES.PLAYER_BOARD.railheads * RULES.SETUP.maxPlayers, 'a start city for every railhead');
});

suite.check('the map: routes are well formed (R11.1)', () => {
  const pairs = new Set();
  for (const r of MAP.routes) {
    assert.equal(r.id, `${r.a}-${r.b}`);
    assert.ok(r.length >= 2 && r.length <= 6, `${r.id}: 2 to 6 slots`);
    assert.equal(r.terrains.length, r.length);
    assert.equal(r.slots.length, r.length);
    assert.equal(r.cost.ground + r.cost.tunnel + r.cost.bridge, r.length);
    for (const t of r.terrains) assert.ok(RULES.TERRAINS.includes(t));
    for (const s of r.slots) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.angle));
    const pair = [r.a, r.b].sort().join('-');
    assert.ok(!pairs.has(pair), `${r.id}: two routes join the same cities`);
    pairs.add(pair);
    assert.ok(!(MAP.cityById[r.a].kind !== 'inland' && MAP.cityById[r.b].kind !== 'inland'), `${r.id} joins two start cities`);
    assert.equal(MAP.routeById[r.id], r);
  }
  for (const id of MAP.startCities) assert.equal(MAP.cityRoutes[id].length, 2, `${id}: a start city has exactly 2 routes`);
  for (const id of MAP.cityIds) {
    for (const routeId of MAP.cityRoutes[id]) {
      const r = MAP.routeById[routeId];
      assert.ok(r.a === id || r.b === id);
      assert.equal(engine.otherEnd(r, engine.otherEnd(r, id)), id);
    }
  }
  // A second build from the same data gives the same tables (the map is swappable data).
  assert.deepEqual(buildMap(ROUTE_MAP).routeIds, MAP.routeIds);
});

suite.check('the map: junction cities and regions as in R16.6', () => {
  const names = (ids) => ids.map((id) => MAP.cityById[id].name).sort();
  assert.deepEqual(
    names(junctionCities(RULES.MAP_RULES)),
    ['Boise', 'Cheyenne', 'Denver', 'El Paso', 'Fresno', 'Helena', 'Reno', 'Salt Lake City', 'Sioux Falls', 'Spokane'],
  );
  const region = (wanted) => names(MAP.inlandCities.filter((id) => cityRegion(id, RULES.MAP_RULES) === wanted));
  assert.deepEqual(region('north'), ['Billings', 'Bismarck', 'Boise', 'Cheyenne', 'Helena', 'Sioux Falls', 'Spokane']);
  assert.deepEqual(region('south'), ['Dodge City', 'El Paso', 'Fresno', 'Las Vegas', 'Phoenix', 'Santa Fe']);
  assert.deepEqual(region('middle'), ['Denver', 'North Platte', 'Reno', 'Salt Lake City']);
  for (const id of MAP.startCities) assert.equal(cityRegion(id, RULES.MAP_RULES), null);
});

suite.check('the map: the shortest crossing is 14 slots (Appendix A.3)', () => {
  // Dijkstra over slots, from every west start city to the nearest east start city.
  const best = {};
  for (const west of MAP.westStartCities) {
    const dist = Object.fromEntries(MAP.cityIds.map((id) => [id, Infinity]));
    dist[west] = 0;
    const open = new Set(MAP.cityIds);
    while (open.size > 0) {
      let at = null;
      for (const id of open) if (at === null || dist[id] < dist[at]) at = id;
      open.delete(at);
      for (const routeId of MAP.cityRoutes[at]) {
        const r = MAP.routeById[routeId];
        const to = engine.otherEnd(r, at);
        if (dist[at] + r.length < dist[to]) dist[to] = dist[at] + r.length;
      }
    }
    best[west] = Math.min(...MAP.eastStartCities.map((id) => dist[id]));
  }
  assert.equal(Math.min(...Object.values(best)), 14);
});

suite.finish();
