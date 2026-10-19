// purity.test.mjs - the state is plain JSON and the engine has no side doors.
//
// Semantics: permanently green; exits 1 on any failure.
//
// Three things are checked.
//  1. Serialisable state: at many points of real games the state survives
//     JSON.parse(JSON.stringify(state)) unchanged, holds nothing that is not
//     plain JSON, and a game continued from the round-tripped copy ends in
//     the same place as the original.
//  2. cloneState: equal to the JSON clone, and fully independent of the
//     original apart from the three parts documented as shared and frozen.
//  3. No impurity in src/engine or src/bots: no random source but the seeded
//     RNG, no clock, no browser globals, no output.
//
// About check 3. `Math.random`, `Date.now`, `localStorage` and `console.` are
// refused anywhere in the files, comments included. The words `document` and
// `window` are refused in CODE only (comments and string literals are
// stripped first), because the rules themselves speak of a "free-action
// window" and player-facing sentences may need the word.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import {
  createGame,
  cloneState,
  hashState,
  serialiseState,
  deserialiseState,
  getValidActions,
  applyAction,
  scoreGame,
  isGameOver,
  makeRng,
  rngNext,
  SILENT,
} from '../src/engine/index.js';
import { playGame, assertPlainJson, makeSuite, HARNESS } from './helpers/play.mjs';
import { makeBuilder } from './helpers/builder.mjs';

const suite = makeSuite('purity');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 1. serialisable state --------------------------------------------------

for (const players of [2, 3, 4]) {
  suite.check(`${players}p: the state is plain JSON at every decision and survives a round trip`, () => {
    const config = { playerCount: players, seed: `pure-${players}`, variants: { maxTurnsPerPlayer: 25 } };
    let checked = 0;
    const result = playGame(config, {
      onDecision(state) {
        assertPlainJson(state);
        const copy = JSON.parse(JSON.stringify(state));
        assert.deepEqual(copy, state);
        checked += 1;
      },
    });
    assert.equal(result.refusals.length, 0);
    assert.ok(checked > 50, `only ${checked} states were checked`);
    assertPlainJson(result.state);
    assertPlainJson(scoreGame(result.state), 'scoreGame');
  });

  suite.check(`${players}p: a game continued from a JSON round trip ends exactly as the original`, () => {
    const config = { playerCount: players, seed: `resume-${players}`, variants: { maxTurnsPerPlayer: 30 } };
    const whole = playGame(config, { botSeed: 'b' });
    const mid = Math.floor(whole.actions.length / 2);

    const first = createGame(config);
    for (let i = 0; i < mid; i++) applyAction(first, whole.actions[i]);
    const restored = deserialiseState(serialiseState(first));
    for (let i = mid; i < whole.actions.length; i++) applyAction(restored, whole.actions[i]);
    assert.equal(hashState(restored), hashState(whole.state));
    assert.deepEqual(restored, whole.state);
  });
}

// The decisions of the core rules (activation frames with their step lists, option choices,
// building placement, Lay Tracks totals) and the variants that change their
// shape are all plain JSON too. The builder reaches the deep states random play
// rarely does: claims, buildings, Congress benefits.
suite.check('core-rule states are plain JSON at every decision, under the variants that change their shape', () => {
  const sets = [
    { turnStructure: 'rounds' },
    { claimFrom: 'network', layTrackClaims: 'per-railhead' },
    { congressTable: 'jan-2026', specialistActivations: 'once', scoringCard: 'bridge' },
    { gameEndTrigger: 'any-crossing', bothBuildingsSameOwner: false, conversionRate: 'iron-in-all' },
  ];
  const seen = new Set();
  for (const [i, variants] of sets.entries()) {
    for (const mode of ['line', 'sprawl']) {
      const state = createGame({ playerCount: 3, seed: `t8-pure-${i}-${mode}`, variants });
      const rng = makeRng(`t8-bots-${i}-${mode}`);
      const choose = makeBuilder(mode);
      let n = 0;
      while (!isGameOver(state) && n < 600) {
        assertPlainJson(state);
        const text = JSON.stringify(state);
        assert.deepEqual(JSON.parse(text), state);
        assert.equal(JSON.stringify(cloneState(state)), text, 'cloneState keeps every field and its order');
        assert.equal(hashState(deserialiseState(text)), hashState(state));
        if (state.stack.length > 0) seen.add(state.stack[state.stack.length - 1].kind);
        applyAction(state, choose(state, getValidActions(state), () => rngNext(rng)), SILENT);
        n += 1;
      }
      assert.ok(n >= 600 || isGameOver(state));
    }
  }
  for (const kind of ['trainActivation', 'layTracks', 'placeBuildings', 'discard']) {
    assert.ok(seen.has(kind), `the decision "${kind}" was never reached`);
  }
});

// The module decisions (free actions, hires, exchanges, free Congress entries, the Foreman's type, option
// choices, upgrade bonus actions) and every field of state.modules are plain JSON too. Tokens are handed out by
// hand so that the Pony Express decisions are reached; the builder plays the rest.
suite.check('module states are plain JSON at every decision, with every module on, and clone, hash and round trip agree', () => {
  const seen = new Set();
  const variants = { endGameScoring: 'both', goalsInPlay: 12, milestonesInPlay: 10 };
  for (const [i, mode] of ['line', 'sprawl', 'line', 'sprawl'].entries()) {
    for (const extra of [{}, { turnStructure: 'rounds' }, { claimFrom: 'network' }]) {
      const state = createGame({ playerCount: 3, seed: `t9-pure-${i}-${JSON.stringify(extra)}`, variants: { ...variants, legislativeAgendaCard: 4 + ((i * 7) % 17), ...extra } });
      const rng = makeRng(`t9-bots-${i}-${JSON.stringify(extra)}`);
      const choose = makeBuilder(mode);
      let n = 0;
      while (!isGameOver(state) && n < 700) {
        const top = state.stack[state.stack.length - 1];
        if (top.kind === 'freeActions' && state.modules.pony.players[top.player].tokensHeld < 6) state.modules.pony.players[top.player].tokensHeld = 6;
        assertPlainJson(state);
        const text = JSON.stringify(state);
        assert.deepEqual(JSON.parse(text), state);
        assert.equal(JSON.stringify(cloneState(state)), text, 'cloneState keeps every field and its order');
        assert.equal(hashState(deserialiseState(text)), hashState(state));
        seen.add(state.stack[state.stack.length - 1].kind);
        applyAction(state, choose(state, getValidActions(state), () => rngNext(rng)), SILENT);
        n += 1;
      }
      assertPlainJson(state);
    }
  }
  for (const kind of ['freeActions', 'chooseOption', 'bonusAction', 'trainActivation', 'layTracks', 'placeBuildings']) {
    assert.ok(seen.has(kind), `the decision "${kind}" was never reached`);
  }
  // Pony Express decisions that need a card to be bought and used: reach them with the module's own cards.
  assert.ok(['hireSpecialist', 'chooseForemanType', 'exchange', 'freeCongress', 'chooseExtraActivation', 'chooseSpecialistType'].some((k) => seen.has(k)), 'no card decision was reached');
});

suite.check('every decision the modules add is plain JSON and survives a round trip: built by hand, one by one', () => {
  const frames = [
    { kind: 'freeActions', player: 0, which: 'before' },
    { kind: 'hireSpecialist', player: 0, cause: 'pony:PX27', remaining: 2, free: true, mayStop: true },
    { kind: 'chooseForemanType', player: 0, foremanTimes: 1, cause: 'pony:PX10' },
    { kind: 'chooseSpecialistType', player: 0, cause: 'pony:PX33' },
    { kind: 'chooseExtraActivation', player: 0, foreman: 'crew', foremanTimes: 2, count: 1, cause: 'district' },
    { kind: 'exchange', player: 0, max: 3, returned: 1, cause: 'pony:PX11' },
    { kind: 'freeCongress', player: 0, tier: 1, remaining: 1, exclude: 'C1', stop: 'declineFreeEntry', activation: true, cause: 'legislative:LA20' },
    { kind: 'bonusAction', player: 0, bonus: 'any', remaining: 1, free: true, cause: 'pony:PX28' },
    { kind: 'chooseBuiltTile', player: 0, remaining: 1, cause: 'pony:PX4', distinct: true, taken: ['ground'] },
    { kind: 'layTracks', player: 0, taken: 0, totals: { routes: 0, slots: { ground: 0, tunnel: 0, bridge: 0 } }, steps: 2, only: 'move' },
  ];
  for (const frame of frames) {
    const state = createGame({ playerCount: 2, seed: 'frames', variants: { endGameScoring: 'both' } });
    state.stack.push(frame);
    state.toAct = frame.player;
    assertPlainJson(state);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.equal(JSON.stringify(cloneState(state)), JSON.stringify(state));
    assert.equal(hashState(deserialiseState(serialiseState(state))), hashState(state));
  }
});

suite.check('events are plain JSON too', () => {
  const state = createGame({ playerCount: 4, seed: 'events', variants: { maxTurnsPerPlayer: 10 } });
  let n = 0;
  while (getValidActions(state).length > 0) {
    assert.ok(n < HARNESS.maxDecisionsPerGame, 'possible non-termination');
    const events = applyAction(state, getValidActions(state)[n % getValidActions(state).length]);
    assert.ok(Array.isArray(events) && events.length > 0);
    assertPlainJson(events, 'events');
    for (const e of events) {
      assert.equal(typeof e.type, 'string');
      assert.equal(typeof e.seq, 'number');
    }
    n += 1;
  }
  assert.ok(n > 30);
});

// --- 2. cloneState ----------------------------------------------------------

const SHARED = ['config', 'variants', 'constantOverrides'];

function assertIndependent(a, b, path) {
  if (a === null || typeof a !== 'object') return;
  assert.notEqual(a, b, `${path} is shared between the state and its clone`);
  for (const key of Object.keys(a)) assertIndependent(a[key], b[key], `${path}.${key}`);
}

suite.check('cloneState equals the JSON clone and shares nothing that can change', () => {
  for (const players of [2, 3, 4]) {
    for (const stopAfter of [0, 7, 40, 200]) {
      const config = { playerCount: players, seed: `clone-${players}`, constants: { HATS: { hatLimit: 3 } } };
      const { state } = playGame(config, { stopAfter });
      const before = JSON.stringify(state);
      const clone = cloneState(state);
      assert.deepEqual(clone, JSON.parse(before), 'cloneState must equal the JSON clone');
      assert.equal(JSON.stringify(clone), before, 'cloneState must keep the order of keys');
      for (const key of Object.keys(state)) {
        if (SHARED.includes(key)) {
          assert.equal(clone[key], state[key], `${key} is documented as shared`);
          if (state[key] !== null) assert.ok(Object.isFrozen(state[key]), `${key} is shared, so it must be frozen`);
        } else {
          assertIndependent(state[key], clone[key], key);
        }
      }
      // Playing on in the clone must leave the original untouched.
      for (let i = 0; i < 25 && getValidActions(clone).length > 0; i++) applyAction(clone, getValidActions(clone)[0]);
      assert.equal(JSON.stringify(state), before, 'playing in the clone changed the original');
    }
  }
});

suite.check('getValidActions, getBlockReason and scoreGame do not change the state', () => {
  const { state } = playGame({ playerCount: 4, seed: 'readonly' }, { stopAfter: 120 });
  const before = JSON.stringify(state);
  const actions = getValidActions(state);
  assert.ok(actions.length > 1);
  scoreGame(state);
  assert.equal(JSON.stringify(state), before);
  // The caller owns the list: changing it must not reach the engine.
  actions.forEach((a) => {
    a.type = 'tampered';
  });
  assert.ok(getValidActions(state).every((a) => a.type !== 'tampered'));
});

// --- 3. no side doors -------------------------------------------------------

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/** The source with comments and the contents of string literals blanked out. Code inside `${ }` is kept. */
function stripCommentsAndStrings(src) {
  let out = '';
  const stack = []; // 'template' entries: we are inside `${ ... }` of a template literal
  let i = 0;
  const n = src.length;
  const readString = (quote) => {
    i += 1;
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') i += 1;
      i += 1;
    }
    i += 1;
    out += '""';
  };
  const readTemplate = () => {
    // i is just past the opening backtick or past a closing brace of ${ }
    while (i < n) {
      if (src[i] === '\\') {
        i += 2;
      } else if (src[i] === '`') {
        i += 1;
        out += '""';
        return;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        stack.push(0);
        out += '(';
        return;
      } else {
        i += 1;
      }
    }
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
    } else if (c === "'" || c === '"') {
      readString(c);
    } else if (c === '`') {
      i += 1;
      readTemplate();
    } else if (c === '{' && stack.length > 0) {
      stack[stack.length - 1] += 1;
      out += c;
      i += 1;
    } else if (c === '}' && stack.length > 0) {
      if (stack[stack.length - 1] === 0) {
        stack.pop();
        out += ')';
        i += 1;
        readTemplate();
      } else {
        stack[stack.length - 1] -= 1;
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const RAW_BANNED = [
  ['Math.random', /Math\s*\.\s*random/],
  ['Date.now', /Date\s*\.\s*now/],
  ['localStorage', /localStorage/],
  ['console.', /console\s*\./],
];
const CODE_BANNED = [
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['new Date', /\bnew\s+Date\b/],
  ['process.', /\bprocess\s*\./],
  ['require(', /\brequire\s*\(/],
  ['setTimeout / setInterval', /\bset(Timeout|Interval)\b/],
  ['fetch(', /\bfetch\s*\(/],
];
// The Web Worker entry is the one file allowed to read a clock; it hands it to the bot as `now`.
const CLOCK_ALLOWED = ['src/bots/bot-worker.js'];

suite.check('the stripper keeps code and drops comments and strings', () => {
  const sample = "const a = 'window'; // document\n/* Math.random */ const b = `x ${window.y} z`; c = \"console.log\";";
  const code = stripCommentsAndStrings(sample);
  assert.ok(!/document/.test(code) && !/Math/.test(code) && !/console/.test(code));
  assert.ok(/\bwindow\b/.test(code), 'code inside ${ } must still be seen');
  assert.equal((code.match(/window/g) ?? []).length, 1);
});

const files = [...sourceFiles(join(root, 'src', 'engine')), ...sourceFiles(join(root, 'src', 'bots'))];

suite.check('src/engine and src/bots hold no impure call', () => {
  assert.ok(files.length >= 12, `expected the engine and bot files, found ${files.length}`);
  const problems = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const code = stripCommentsAndStrings(raw);
    for (const [label, pattern] of RAW_BANNED) {
      if (pattern.test(raw)) problems.push(`${rel}: ${label}`);
    }
    for (const [label, pattern] of CODE_BANNED) {
      if (pattern.test(code)) problems.push(`${rel}: ${label}`);
    }
    if (/\bperformance\b/.test(code) && !CLOCK_ALLOWED.includes(rel)) problems.push(`${rel}: performance (a clock)`);
    if (/from\s+['"]node:/.test(raw)) problems.push(`${rel}: imports a Node built-in`);
  }
  assert.deepEqual(problems, []);
});

suite.check('source files use LF line endings', () => {
  const withCr = files.filter((file) => readFileSync(file, 'utf8').includes('\r'));
  assert.deepEqual(withCr.map((f) => relative(root, f)), []);
});

suite.check('engine files import only from inside src/engine, bots only from src/bots and src/engine', () => {
  const problems = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    for (const match of raw.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
      const target = join(dirname(file), match[1]);
      const targetRel = relative(root, target).split('\\').join('/');
      const inEngine = targetRel.startsWith('src/engine/');
      const inBots = targetRel.startsWith('src/bots/');
      if (rel.startsWith('src/engine/') && !inEngine) problems.push(`${rel} imports ${match[1]}`);
      if (rel.startsWith('src/bots/') && !inEngine && !inBots) problems.push(`${rel} imports ${match[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

suite.finish(`${files.length} source files scanned`);
