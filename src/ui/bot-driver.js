// bot-driver.js - runs the bot seats through the Web Worker, visibly paced.
//
// The loop (contract section 14): ask the bot for `state.toAct`, send it the
// serialisable state, receive an action, and hand it to the page's own commit
// path (the same one a human click takes). The worker never applies anything.
//
// Anti-livelock guard (the skill's first of four): every proposal comes from
// getValidActions, so a refusal can only mean an engine or bot bug. A refused
// action, a worker error and a timeout each count as a failure; after
// MAX_BOT_FAILURES in a row the driver applies a random legal action on the
// main thread, logs the incident, and starts counting again. The counter is
// reset by every action that is applied.

import { getValidActions, makeRng, rngNext } from '../engine/index.js';
import { BOT_LEVELS } from '../bots/index.js';

/**
 * Pacing in milliseconds between a bot's turn becoming current and its move being asked for, for the
 * levels that move at once (defaultTimeBudgetMs 0): without it their moves would flash past unseen.
 */
export const PACING = { normal: 850, fast: 220, instant: 0 };

/**
 * The short pause kept before a search bot (defaultTimeBudgetMs above 0) is asked for its move. Its own
 * thinking time is already a pause long enough to follow, so the full pacing would stack on top of it;
 * what is kept is a beat for the last move to stay highlighted.
 */
export const HIGHLIGHT_PAUSE = { normal: 250, fast: 80, instant: 0 };

/** The delay before the bot of this level is asked for a move, at this speed. */
export function pacingFor(level, speed) {
  const def = BOT_LEVELS.find((l) => l.id === level);
  const table = def && def.defaultTimeBudgetMs > 0 ? HIGHLIGHT_PAUSE : PACING;
  return table[speed] ?? table.normal;
}

export const MAX_BOT_FAILURES = 3;

/** How long to wait for the worker: the level's own budget with generous slack. */
function timeoutFor(level) {
  const def = BOT_LEVELS.find((l) => l.id === level);
  const budget = def ? def.defaultTimeBudgetMs || 0 : 0;
  return Math.max(20000, budget * 4 + 10000);
}

/**
 * @param {object} hooks
 *   getState()            the current game state
 *   shouldRun()           true when a bot move should be asked for now (a bot to act, not paused, game on screen)
 *   levelFor(playerId)    the bot level id of a seat
 *   speed()               'normal' | 'fast' | 'instant'
 *   apply(action, how)    the page's commit path; returns { ok, error? }; how is 'bot' or 'fallback'
 *   incident(text)        log a driver incident
 *   status(text|null)     optional status for the "thinking" line
 */
export function createBotDriver(hooks) {
  let worker = null;
  let timer = null;
  let watchdog = null;
  let nextId = 1;
  let inflight = null; // { id, seq, toAct }
  let failures = 0;
  let botRng = makeRng('bots:0');
  /** Test hook: how many of the next replies to treat as worker errors. */
  let faultsLeft = 0;

  /** Seeds the driver's own bot stream (the game seed is never touched). */
  function seed(value) {
    botRng = makeRng(`bots:${value}`);
    failures = 0;
  }

  function makeWorker() {
    const w = new Worker(new URL('../bots/bot-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (event) => onReply(event.data);
    w.onerror = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      onFailure(`The bot worker raised an error${event && event.message ? `: ${event.message}` : ''}.`, true);
    };
    return w;
  }

  function killWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function clearTimers() {
    if (timer !== null) clearTimeout(timer);
    if (watchdog !== null) clearTimeout(watchdog);
    timer = null;
    watchdog = null;
  }

  /** Stops everything in flight (new game, undo, back to setup). */
  function cancel() {
    clearTimers();
    inflight = null;
    killWorker();
  }

  /** Called whenever the situation may have changed: schedules a bot move if one is due. */
  function kick() {
    if (timer !== null || inflight !== null) return;
    if (!hooks.shouldRun()) return;
    const delay = pacingFor(hooks.levelFor(hooks.getState().toAct), hooks.speed());
    timer = setTimeout(() => {
      timer = null;
      request();
    }, delay);
  }

  function request() {
    if (!hooks.shouldRun() || inflight !== null) return;
    const state = hooks.getState();
    const level = hooks.levelFor(state.toAct);
    const id = nextId++;
    inflight = { id, seq: state.seq, toAct: state.toAct };
    try {
      if (!worker) worker = makeWorker();
      worker.postMessage({ id, state, level, seed: Math.floor(rngNext(botRng) * 2147483647), timeBudgetMs: null });
    } catch (err) {
      onFailure(`Could not start the bot worker: ${err.message}`, true);
      return;
    }
    watchdog = setTimeout(() => {
      onFailure(`The ${level} bot did not answer in time.`, true);
    }, timeoutFor(level));
  }

  function onReply(msg) {
    if (!inflight || !msg || msg.id !== inflight.id) return; // a stale reply
    const expect = inflight;
    inflight = null;
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
    const state = hooks.getState();
    if (state.seq !== expect.seq || state.toAct !== expect.toAct) return; // the position moved on; ask again
    if (faultsLeft > 0) {
      faultsLeft -= 1;
      msg = { id: msg.id, ok: false, error: 'injected fault (test)' };
    }
    if (!msg.ok) {
      onFailure(`The bot reported an error: ${msg.error}`, false);
      return;
    }
    const result = hooks.apply(msg.action, 'bot');
    if (result.ok) {
      failures = 0;
    } else {
      onFailure(`The engine refused the bot's action (${result.error}).`, false);
    }
  }

  function onFailure(text, killWorkerToo) {
    clearTimers();
    inflight = null;
    if (killWorkerToo) killWorker();
    failures += 1;
    hooks.incident(`Bot failure ${failures} of ${MAX_BOT_FAILURES}: ${text}`);
    if (failures >= MAX_BOT_FAILURES) {
      failures = 0;
      const state = hooks.getState();
      const legal = getValidActions(state);
      if (legal.length > 0) {
        const pick = legal[Math.floor(Math.random() * legal.length)];
        hooks.incident(`Applying a random legal action for ${hooks.levelFor(state.toAct)} instead.`);
        hooks.apply(pick, 'fallback');
      }
      return;
    }
    kick();
  }

  function injectFaults(n) {
    faultsLeft = n;
  }

  return {
    kick,
    cancel,
    seed,
    injectFaults,
    get failures() { return failures; },
    /** Whether a bot move is scheduled or being worked out (for the bug report). */
    get busy() { return timer !== null || inflight !== null; },
  };
}
