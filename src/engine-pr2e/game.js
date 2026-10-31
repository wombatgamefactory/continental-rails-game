// game.js - createGame and replayGame: the two ways to obtain a game state.

import { createInitialState } from './state.js';
import { advanceToFirstDecision, applyAction, SILENT } from './actions.js';

/**
 * Starts a game and runs it forward to its first decision.
 *
 * A game is a pure function of (config, seed, list of actions): the same
 * three always give the same states.
 *
 * @param {object} config
 * @param {Array<{ name?: string, colour?: string }>} [config.players] 2 to 4 entries, in the order given by the setup screen
 * @param {number} [config.playerCount] 2 to 4; used when `players` is not given
 * @param {number|string} [config.seed] seed of the game's own RNG (required unless `options.rng` is given)
 * @param {object} [config.variants] overrides of the variants of variants.js, `{ name: value }`
 * @param {object} [config.constants] overrides of rules.js, by group, e.g. `{ SCORING: { vpPerSlot: 2 } }`
 * @param {boolean} [config.shuffleSeats] default true: seats are shuffled with the game RNG (R3.2)
 * @param {{ s: number }} [config.rngStart] an RNG to start from, as recorded by getGameConfig; takes the place of `seed`
 * @param {{ rng?: { s: number } }} [options] an RNG made by `makeRng`, used in place of `config.seed`; it is copied, not kept
 * @returns {object} the game state, plain JSON, waiting at its first decision
 */
export function createGame(config, options = {}) {
  const state = createInitialState(config, options);
  advanceToFirstDecision(state);
  return state;
}

/** Whether the game has ended. When true, getValidActions returns [] and `state.toAct` is null. */
export function isGameOver(state) {
  return state.phase === 'ended';
}

/**
 * Rebuilds a state from its recipe: createGame, then every action in order.
 * Throws at the first action the engine refuses, naming its position.
 * For saved games, bug reports and tests.
 *
 * @param {object} config the config the game was created with
 * @param {object[]} actions the actions the players took (forced actions the engine applied itself are NOT in this list)
 * @param {{ rng?: { s: number } }} [options] as for createGame
 */
export function replayGame(config, actions, options = {}) {
  const state = createGame(config, options);
  for (let i = 0; i < actions.length; i++) {
    try {
      applyAction(state, actions[i], SILENT);
    } catch (err) {
      const wrapped = new Error(`Replay stopped at action ${i + 1} of ${actions.length}: ${err.message}`);
      wrapped.code = err.code ?? null;
      wrapped.reason = err.reason ?? null;
      wrapped.index = i;
      throw wrapped;
    }
  }
  return state;
}
