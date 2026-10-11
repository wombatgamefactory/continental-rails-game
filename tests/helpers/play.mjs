// Shared helpers for the test suites. Not a suite: tests/run-all.mjs runs
// only tests/*.test.mjs.

import {
  createGame,
  getValidActions,
  applyAction,
  isGameOver,
  makeRng,
  forkRng,
  SILENT,
} from '../../src/engine/index.js';
import { getBot } from '../../src/bots/index.js';

/** Hard stops of the HARNESS. Hitting one means the engine failed to end a game by itself. */
export const HARNESS = {
  maxDecisionsPerGame: 20000,
};

/**
 * Plays one game with registry bots through the same path the browser and the
 * simulator use: ask the bot, apply its action.
 *
 * @param {object} config createGame config
 * @param {object} [options]
 * @param {object} [options.state] continue this state in place of creating one
 * @param {string|number} [options.botSeed] seed of the bots' random stream (independent of the game seed)
 * @param {string} [options.level] bot level for every seat
 * @param {(state: object, actions: object[]) => void} [options.onDecision] called before each decision
 * @param {(state: object, action: object, events: object[]|null) => void} [options.onApplied] called after each applied action
 * @param {boolean} [options.events] collect events (slower)
 * @param {number} [options.stopAfter] stop after this many decisions, leaving the game unfinished
 * @returns {{ state: object, decisions: number, refusals: object[], capHit: boolean, actions: object[] }}
 */
export function playGame(config, options = {}) {
  const bot = getBot(options.level ?? 'random');
  const botRng = makeRng(options.botSeed ?? `bots:${config ? config.seed : 'none'}`);
  const state = options.state ?? createGame(config);
  const applyOptions = options.events ? undefined : SILENT;
  const actions = [];
  const refusals = [];
  let decisions = 0;
  let capHit = false;
  while (!isGameOver(state)) {
    if (options.stopAfter !== undefined && decisions >= options.stopAfter) break;
    if (decisions >= HARNESS.maxDecisionsPerGame) {
      capHit = true;
      break;
    }
    if (options.onDecision) options.onDecision(state, getValidActions(state));
    const action = bot.chooseAction(state, { rng: forkRng(botRng), timeBudgetMs: 0, iterations: null, now: null });
    let events = null;
    try {
      events = applyAction(state, action, applyOptions);
    } catch (err) {
      refusals.push({ action, message: err.message });
      break; // a refusal leaves the state untouched, so the same proposal would come back for ever
    }
    actions.push(action);
    decisions += 1;
    if (options.onApplied) options.onApplied(state, action, events);
  }
  return { state, decisions, refusals, capHit, actions };
}

/**
 * Applies actions while `keepGoing(state)` holds, taking `pick(actions, state)`
 * each time (the first legal action by default). Returns all events.
 * Throws rather than loop for ever: termination is asserted, never assumed.
 */
export function drive(state, keepGoing, pick = (actions) => actions[0]) {
  const events = [];
  for (let steps = 0; !isGameOver(state) && keepGoing(state); steps++) {
    if (steps >= HARNESS.maxDecisionsPerGame) {
      throw new Error(`possible non-termination: ${steps} decisions without reaching the condition`);
    }
    events.push(...applyAction(state, pick(getValidActions(state), state)));
  }
  return events;
}

/** Throws if `value` holds anything that is not plain JSON (undefined, NaN, functions, class instances...). */
export function assertPlainJson(value, path = 'state') {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}, not a finite number`);
    return;
  }
  if (t !== 'object') throw new Error(`${path} is a ${t}, which is not plain JSON`);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertPlainJson(v, `${path}[${i}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`${path} is a class instance, not a plain object`);
  for (const key of Object.keys(value)) assertPlainJson(value[key], `${path}.${key}`);
}

/** Runs named checks, prints one line each on failure and a one-line summary; exits non-zero if any failed. */
export function makeSuite(name) {
  const failures = [];
  let count = 0;
  return {
    check(label, fn) {
      count += 1;
      try {
        fn();
      } catch (err) {
        failures.push(label);
        process.stdout.write(`  FAIL ${label}\n       ${String(err && err.message ? err.message : err).split('\n').join('\n       ')}\n`);
        // TEST_STACK=1 prints where an assertion failed, for debugging.
        if (process.env.TEST_STACK && err && err.stack) process.stdout.write(`${err.stack.split('\n').slice(0, 6).join('\n')}\n`);
      }
    },
    finish(extra = '') {
      const ok = failures.length === 0;
      process.stdout.write(`${name}: ${count - failures.length}/${count} checks passed${extra ? ` - ${extra}` : ''}\n`);
      process.exit(ok ? 0 : 1);
    },
  };
}
