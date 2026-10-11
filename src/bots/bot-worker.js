// bot-worker.js - the Web Worker entry for bots.
//
// The page starts it with
//   new Worker('src/bots/bot-worker.js', { type: 'module' })
// and posts one request per bot decision:
//
//   { id, state, level, seed, timeBudgetMs, iterations, options }
//
//   id            anything; echoed back so the page can match replies
//   state         the game state (plain JSON, so it crosses the boundary as is)
//   level         a bot level id from BOT_LEVELS
//   seed          seed of the bot's own random stream for THIS decision
//   timeBudgetMs  optional; null or absent means the level's default
//   iterations    optional; a fixed amount of search in place of a time budget
//   options       optional; extra settings handed to the bot as they are (for
//                 example { jitter, weights } for a heuristic bot)
//
// The reply is `{ id, ok: true, action }` or `{ id, ok: false, error }`.
// The worker never applies the action: the page does, through applyAction.
//
// This is the one file under src/bots that touches a clock, because a time
// budget needs one. It hands the clock to the bot as `now`.

import { getBot, BOT_LEVELS } from './index.js';
import { makeRng } from '../engine/index.js';

/**
 * Answers one request. Exported so that tests and the simulator can call it
 * without a worker. Never throws: a failure becomes `{ ok: false, error }`.
 *
 * @param {object} message the request described above
 * @param {(() => number)|null} [clock] a millisecond clock, or null when none is available
 */
export function handleBotRequest(message, clock = null) {
  const id = message && message.id !== undefined ? message.id : null;
  try {
    const { state, level, seed } = message;
    if (seed === undefined || seed === null) throw new Error('A bot request needs a seed.');
    const bot = getBot(level);
    const def = BOT_LEVELS.find((entry) => entry.id === level);
    const timeBudgetMs = message.timeBudgetMs ?? def.defaultTimeBudgetMs;
    const iterations = message.iterations ?? null;
    const extra = message.options !== null && typeof message.options === 'object' ? message.options : {};
    const action = bot.chooseAction(state, { ...extra, rng: makeRng(seed), timeBudgetMs, iterations, now: clock });
    return { id, ok: true, action };
  } catch (err) {
    return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Wire up only when this module really is running as a Web Worker.
const scope = globalThis;
if (typeof scope.WorkerGlobalScope !== 'undefined' && scope instanceof scope.WorkerGlobalScope) {
  const clock = () => scope.performance.now();
  scope.onmessage = (event) => {
    scope.postMessage(handleBotRequest(event.data, clock));
  };
}
