// variants.test.mjs - the variants table, resolveVariants, and the variants
// and constant overrides this build already acts on.
//
// Semantics: permanently green; exits 1 on any failure.
//
// The list of names and defaults below is the ONE place where printed values
// from spec R21.3 are repeated in a test, so that drift between the spec and
// variants.js is caught here and nowhere else. Every other check drives the
// real functions and reads its expectations from the engine's own tables.

import assert from 'node:assert/strict';
import {
  VARIANTS,
  VARIANT_NAMES,
  resolveVariants,
  defaultVariants,
  getVariantDef,
  isAllowedValue,
  describeAllowed,
  parseVariantValue,
  nonDefaultVariants,
  activeModules,
  createGame,
  getConstants,
  cloneState,
  hashState,
  RULES,
  HATS,
  UNIMPLEMENTED_VARIANT_VALUES,
  production,
} from '../src/engine/index.js';
import { playGame, drive, makeSuite } from './helpers/play.mjs';
import { MODULES_OFF } from './helpers/rig.mjs';

const suite = makeSuite('variants');

// Spec R21.3, rows 1 to 25: name, default.
const SPEC_R21_3 = [
  ['conversionRate', '2:1'],
  ['turnStructure', 'continuous'],
  ['moduleCarriageUpgrades', true],
  ['endGameScoring', 'milestones'],
  ['goalsInPlay', 3],
  ['milestonesInPlay', 6],
  ['moduleLegislativeAgenda', true],
  ['legislativeAgendaCard', 'random'],
  ['modulePonyExpress', true],
  ['ponyOngoingCap', 2],
  ['startCompensation', 'graduated'],
  ['congressTable', 'design-2026-10'],
  ['claimFrom', 'railhead'],
  ['layTrackClaims', 'per-step'],
  ['gameEndTrigger', 'own-crossing'],
  ['endRoutesPerPlayer', 8],
  ['maxTurnsPerPlayer', 80],
  ['bonusActionLimit', 'once-per-turn'],
  ['hireCostModel', 'fee-plus-table'],
  ['bothBuildingsSameOwner', true],
  ['buildingScoreCurve', 'rising'],
  ['scoringCard', 'none'],
  ['upgradeVpTiming', 'per-activation'],
  ['specialistActivations', 'by-level'],
  ['gridLayout', 'fixed'],
];

suite.check('the table holds exactly the 25 variants of spec R21.3, in order, with their defaults', () => {
  assert.equal(VARIANTS.length, 25);
  assert.deepEqual(VARIANT_NAMES, SPEC_R21_3.map(([name]) => name));
  assert.deepEqual(defaultVariants(), Object.fromEntries(SPEC_R21_3));
  assert.equal(new Set(VARIANT_NAMES).size, 25, 'names must be unique');
});

suite.check('every variant is complete: type, allowed values, a legal default, a description, a rule', () => {
  for (const def of VARIANTS) {
    assert.ok(['enum', 'boolean', 'integer', 'enum-or-integer'].includes(def.type), `${def.name}: type`);
    assert.ok(isAllowedValue(def, def.default), `${def.name}: the default must be an allowed value`);
    assert.ok(typeof def.description === 'string' && def.description.length > 10, `${def.name}: description`);
    assert.match(def.rule, /^R\d/, `${def.name}: rule`);
    assert.ok(describeAllowed(def).length > 0);
    if (def.type === 'integer' || def.type === 'enum-or-integer') {
      assert.ok(Number.isInteger(def.min) && Number.isInteger(def.max) && def.min <= def.max, `${def.name}: range`);
    }
    if (def.type !== 'integer') assert.ok(Array.isArray(def.values) && def.values.length > 0, `${def.name}: values`);
    assert.equal(getVariantDef(def.name), def);
  }
  assert.equal(getVariantDef('noSuchVariant'), null);
});

suite.check('resolveVariants fills in every default and returns a fresh object', () => {
  const a = resolveVariants();
  const b = resolveVariants({});
  assert.deepEqual(a, defaultVariants());
  assert.notEqual(a, b);
  assert.deepEqual(Object.keys(a), VARIANT_NAMES);
});

suite.check('resolveVariants accepts every allowed value of every variant', () => {
  for (const def of VARIANTS) {
    const values = def.type === 'integer' ? [def.min, def.max] : def.type === 'enum-or-integer' ? [...def.values, def.min, def.max] : def.values;
    for (const value of values) {
      // goalsInPlay 12 needs carriage upgrades on, which is the default.
      const resolved = resolveVariants({ [def.name]: value });
      assert.equal(resolved[def.name], value, `${def.name} = ${value}`);
    }
  }
});

suite.check('resolveVariants rejects unknown names with a message that names them', () => {
  assert.throws(() => resolveVariants({ conversonRate: '1:1' }), /Unknown variant "conversonRate"/);
  assert.throws(() => resolveVariants({ ConversionRate: '1:1' }), /Unknown variant/);
  assert.throws(() => resolveVariants([]), /object/);
  assert.throws(() => resolveVariants(null), /object/);
});

suite.check('resolveVariants rejects illegal values with a message that says what is allowed', () => {
  assert.throws(() => resolveVariants({ conversionRate: '3:1' }), /Illegal value "3:1" for variant "conversionRate".*"1:1", "2:1", "iron-in-all"/);
  assert.throws(() => resolveVariants({ modulePonyExpress: 'true' }), /Illegal value "true" for variant "modulePonyExpress"/);
  assert.throws(() => resolveVariants({ modulePonyExpress: 1 }), /Illegal value/);
  for (const def of VARIANTS) {
    if (def.type === 'integer' || def.type === 'enum-or-integer') {
      assert.throws(() => resolveVariants({ [def.name]: def.max + 1 }), /Illegal value/, `${def.name} above its range`);
      assert.throws(() => resolveVariants({ [def.name]: def.min - 1 }), /Illegal value/, `${def.name} below its range`);
      assert.throws(() => resolveVariants({ [def.name]: def.min + 0.5 }), /Illegal value/, `${def.name} not whole`);
      assert.throws(() => resolveVariants({ [def.name]: String(def.min) }), /Illegal value/, `${def.name} as text`);
    } else {
      assert.throws(() => resolveVariants({ [def.name]: 'definitely-not-a-value' }), /Illegal value/, def.name);
    }
    assert.throws(() => resolveVariants({ [def.name]: null }), /Illegal value/, `${def.name} null`);
  }
  assert.throws(() => resolveVariants({ legislativeAgendaCard: 'first' }), /"random", or an integer from 1 to 20/);
  assert.equal(resolveVariants({ legislativeAgendaCard: 20 }).legislativeAgendaCard, 20);
});

suite.check('goalsInPlay is capped at 11 when goal 6 is removed (R3.8.2)', () => {
  const off = { moduleCarriageUpgrades: false, endGameScoring: 'goals' };
  assert.throws(() => resolveVariants({ ...off, goalsInPlay: 12 }), /at most 11/);
  assert.equal(resolveVariants({ ...off, goalsInPlay: 11 }).goalsInPlay, 11);
  // Not a problem when goals are not in play at all.
  assert.equal(resolveVariants({ moduleCarriageUpgrades: false, goalsInPlay: 12 }).goalsInPlay, 12);
});

suite.check('parseVariantValue turns flag text into typed values', () => {
  assert.equal(parseVariantValue('modulePonyExpress', 'false'), false);
  assert.equal(parseVariantValue('modulePonyExpress', 'true'), true);
  assert.equal(parseVariantValue('maxTurnsPerPlayer', '40'), 40);
  assert.equal(parseVariantValue('legislativeAgendaCard', '7'), 7);
  assert.equal(parseVariantValue('legislativeAgendaCard', 'random'), 'random');
  assert.equal(parseVariantValue('conversionRate', '1:1'), '1:1');
  assert.equal(parseVariantValue('buildingScoreCurve', '2018'), '2018', 'an enum value that looks like a number stays text');
  assert.throws(() => parseVariantValue('nope', 'x'), /Unknown variant/);
  // Whatever it returns still goes through resolveVariants.
  assert.throws(() => resolveVariants({ maxTurnsPerPlayer: parseVariantValue('maxTurnsPerPlayer', 'lots') }), /Illegal value/);
  for (const def of VARIANTS) {
    const text = String(def.default);
    assert.equal(resolveVariants({ [def.name]: parseVariantValue(def.name, text) })[def.name], def.default, def.name);
  }
});

suite.check('nonDefaultVariants and activeModules read the resolved object', () => {
  assert.deepEqual(nonDefaultVariants(resolveVariants()), {});
  assert.deepEqual(nonDefaultVariants(resolveVariants({ conversionRate: '1:1', gridLayout: 'fixed' })), { conversionRate: '1:1' });
  assert.deepEqual(activeModules(resolveVariants()), { upgrades: true, milestones: true, goals: false, legislative: true, pony: true });
  assert.deepEqual(
    activeModules(resolveVariants({ moduleCarriageUpgrades: false, endGameScoring: 'both', moduleLegislativeAgenda: false, modulePonyExpress: false })),
    { upgrades: false, milestones: true, goals: true, legislative: false, pony: false },
  );
  assert.deepEqual(Object.values(activeModules(resolveVariants({ endGameScoring: 'none' }))).filter(Boolean).length, 3);
});

// --- variants in the game state ---------------------------------------------

suite.check('createGame stores the resolved variants in the state and refuses bad ones', () => {
  const state = createGame({ playerCount: 3, seed: 1, variants: { conversionRate: '1:1', maxTurnsPerPlayer: 12 } });
  assert.deepEqual(state.variants, resolveVariants({ conversionRate: '1:1', maxTurnsPerPlayer: 12 }));
  assert.ok(Object.isFrozen(state.variants));
  assert.deepEqual(JSON.parse(JSON.stringify(state)).variants, state.variants);
  assert.throws(() => createGame({ playerCount: 3, seed: 1, variants: { speed: 'fast' } }), /Unknown variant "speed"/);
  assert.throws(() => createGame({ playerCount: 3, seed: 1, variants: { conversionRate: 'cheap' } }), /Illegal value/);
});

suite.check('a variant value whose rules are not written yet is refused loudly, never silently ignored', () => {
  for (const [name, values] of Object.entries(UNIMPLEMENTED_VARIANT_VALUES)) {
    for (const value of values) {
      assert.ok(isAllowedValue(getVariantDef(name), value), `${name}=${value} must be a legal value`);
      assert.throws(() => createGame({ playerCount: 2, seed: 1, variants: { [name]: value } }), /not implemented yet/);
    }
  }
});

suite.check('a module that is off leaves no trace in the state or the scoring', () => {
  const allOff = { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false };
  const state = createGame({ playerCount: 4, seed: 3, variants: allOff });
  assert.deepEqual(state.modules, {});
  const core = RULES.VP_SOURCES.filter((s) => s.module === null).map((s) => s.id);
  for (const p of state.players) {
    assert.deepEqual(Object.keys(p.vp), core);
    assert.ok(!('upgrade' in p.bonusActionsUsed), 'the Carriage Upgrade bonus action does not exist without its module (R7.3)');
  }
  const text = JSON.stringify(state);
  for (const word of ['pony', 'milestone', 'goal', 'legislative', 'upgrade']) {
    const stripped = text.replace(JSON.stringify(state.variants), '');
    assert.ok(!stripped.toLowerCase().includes(word), `"${word}" appears in a state with every module off`);
  }
  // With everything on, every source of R20.1 and R20.2 that applies is present, in rule order.
  const on = createGame({ playerCount: 4, seed: 3, variants: { endGameScoring: 'both' } });
  assert.deepEqual(Object.keys(on.players[0].vp), RULES.VP_SOURCES.map((s) => s.id));
  assert.deepEqual(RULES.VP_SOURCES.map((s) => s.id), [
    'track', 'firstConnection', 'completion', 'telegraph', 'toll', 'congress', 'upgrades',
    'milestones', 'legislative', 'ponyCards', 'buildingsEnd', 'goals', 'ponyEnd',
  ]);
});

suite.check('startCompensation: graduated gives later seats their choices, none gives nothing (R3.7)', () => {
  const comp = RULES.SETUP.graduatedCompensation;
  for (const players of [2, 3, 4]) {
    const chosen = (variant) => {
      const state = createGame({ playerCount: players, seed: 9, variants: { startCompensation: variant } });
      const count = new Array(players).fill(0);
      drive(state, (s) => s.phase === 'setup', (actions, s) => {
        if (actions[0].type === 'chooseResource') count[s.toAct] += 1;
        return actions[0];
      });
      return count;
    };
    assert.deepEqual(chosen('graduated'), comp.slice(0, players));
    assert.deepEqual(chosen('none'), new Array(players).fill(0));
  }
});

suite.check('gridLayout: fixed is the printed grid, shuffle-resources permutes only the three resource tiles (R5.8)', () => {
  const fixed = createGame({ playerCount: 2, seed: 1 });
  assert.deepEqual(fixed.grid.tiles, RULES.GRID.defaultTiles);
  const seen = new Set();
  for (let seed = 0; seed < 80; seed++) {
    const state = createGame({ playerCount: 2, seed, variants: { gridLayout: 'shuffle-resources' } });
    const moved = RULES.GRID.shufflePositions;
    for (const d of Object.keys(state.grid.tiles)) {
      if (!moved.includes(d)) assert.equal(state.grid.tiles[d], RULES.GRID.defaultTiles[d], `${d} must stay put`);
    }
    assert.deepEqual(moved.map((d) => state.grid.tiles[d]).sort(), moved.map((d) => RULES.GRID.defaultTiles[d]).sort());
    seen.add(moved.map((d) => state.grid.tiles[d]).join('|'));
  }
  assert.equal(seen.size, 6, 'all 6 layouts should turn up over 80 seeds');
});

suite.check('scoringCard: none, fixed and random (R3.8.5)', () => {
  assert.equal(createGame({ playerCount: 2, seed: 1 }).scoringCard, null);
  assert.equal(createGame({ playerCount: 2, seed: 1, variants: { scoringCard: 'tunnel' } }).scoringCard, 'tunnel');
  const drawn = new Set();
  for (let seed = 0; seed < 40; seed++) drawn.add(createGame({ playerCount: 2, seed, variants: { scoringCard: 'random' } }).scoringCard);
  assert.deepEqual([...drawn].sort(), RULES.TERRAINS.slice().sort());
});

suite.check('maxTurnsPerPlayer sets the length of a game that nothing else ends (R19.4, R19.5)', () => {
  for (const limit of [5, 17]) {
    for (const players of [2, 3, 4]) {
      const { state, refusals } = playGame({ playerCount: players, seed: `limit-${limit}`, variants: { maxTurnsPerPlayer: limit } });
      assert.equal(refusals.length, 0);
      assert.equal(state.gameEnd.reason, 'turn-limit');
      assert.deepEqual(state.players.map((p) => p.turnsTaken), new Array(players).fill(limit));
    }
  }
});

suite.check('bonusActionLimit changes how often a bonus action is offered (R7.2)', () => {
  const taken = (limit) => {
    const perGather = [];
    const everUsed = [];
    for (let g = 0; g < 6; g++) {
      let current = 0;
      const { state } = playGame(
        { playerCount: 2, seed: `bonus-${g}`, variants: { ...MODULES_OFF, bonusActionLimit: limit, maxTurnsPerPlayer: 60 } },
        {
          events: true,
          onApplied(s, action, events) {
            for (const e of events) {
              if (e.type === 'gather') current = 0;
              if (e.type === 'action' && ['buyHat', 'addCarriage', 'hireSpecialist'].includes(e.action.type)) {
                current += 1;
                perGather.push(current);
              }
            }
          },
        },
      );
      everUsed.push(...state.players.map((p) => Object.values(p.bonusActionsUsed).filter(Boolean).length));
    }
    return { most: Math.max(0, ...perGather), everUsed };
  };
  const once = taken('once-per-turn');
  assert.equal(once.most, 1, 'once-per-turn: at most one bonus action per Gather');
  assert.ok(once.everUsed.every((n) => n === 0), 'the used marks belong to the once-per-game variant only');
  const multiplied = taken('multiplied');
  assert.ok(multiplied.most > 1, 'multiplied: several bonus actions after one Gather with M > 1');
  const perGame = taken('once-per-game');
  assert.equal(perGame.most, 1);
  assert.ok(perGame.everUsed.some((n) => n > 0));
});

// --- constant overrides -----------------------------------------------------

suite.check('constant overrides are stored in the state, reach the logic, and leave rules.js alone', () => {
  const base = createGame({ playerCount: 2, seed: 5 });
  assert.equal(base.constantOverrides, null);
  assert.equal(getConstants(base), RULES);

  const limit = HATS.hatLimit + 3;
  const coins = RULES.SETUP.startingCoins + 4;
  const patched = createGame({ playerCount: 2, seed: 5, constants: { HATS: { hatLimit: limit }, SETUP: { startingCoins: coins } } });
  assert.deepEqual(patched.constantOverrides, { HATS: { hatLimit: limit }, SETUP: { startingCoins: coins } });
  assert.equal(getConstants(patched).HATS.hatLimit, limit);
  assert.equal(getConstants(patched).HATS.hatsPerTurn, HATS.hatsPerTurn, 'what is not overridden is unchanged');
  assert.equal(HATS.hatLimit, limit - 3, 'rules.js itself must not be touched');
  assert.ok(patched.players.every((p) => p.coins === coins), 'the override must reach setup');
  assert.notEqual(hashState(base), hashState(patched));

  // The override survives a save and a clone, and is what the copy plays by.
  const restored = JSON.parse(JSON.stringify(patched));
  assert.equal(getConstants(restored).HATS.hatLimit, limit);
  assert.equal(getConstants(cloneState(patched)).HATS.hatLimit, limit);
});

suite.check('a misspelt or misshapen constant override is refused', () => {
  assert.throws(() => createGame({ playerCount: 2, seed: 1, constants: { SCORING: { vpPerSlott: 2 } } }), /Unknown constant "SCORING.vpPerSlott"/);
  assert.throws(() => createGame({ playerCount: 2, seed: 1, constants: { NOPE: {} } }), /Unknown constant "NOPE"/);
  assert.throws(() => createGame({ playerCount: 2, seed: 1, constants: { SCORING: 5 } }), /wrong shape/);
  assert.throws(() => createGame({ playerCount: 2, seed: 1, constants: [] }), /object/);
});

suite.check('patching an exported rules object at run time reaches a game without overrides', () => {
  const state = createGame({ playerCount: 2, seed: 2 });
  drive(state, (s) => s.phase === 'setup');
  const track = RULES.PLAYER_BOARD.houseTracks[0];
  const before = production(state, 0, track);
  const saved = RULES.PLAYER_BOARD.baseProduction;
  try {
    RULES.PLAYER_BOARD.baseProduction = saved + 2;
    assert.equal(production(state, 0, track), before + 2, 'tuning values must be read live from the exported object');
  } finally {
    RULES.PLAYER_BOARD.baseProduction = saved;
  }
  assert.equal(production(state, 0, track), before);
});

suite.finish();
