// randomBot.js - picks uniformly among the legal actions.
//
// The baseline every other bot is measured against, and the workhorse of the
// smoke tests. It knows nothing about the game: everything it does comes from
// getValidActions, which is the point. If this bot is ever refused, the
// engine's own list and its own mutators disagree.

import { getValidActions, rngPick } from '../engine/index.js';

export const randomBot = {
  /**
   * @param {object} state the game state (not changed)
   * @param {{ rng: { s: number } }} context `rng` is the bot's own stream, never `state.rng`
   * @returns {object} one of getValidActions(state)
   */
  chooseAction(state, { rng }) {
    const actions = getValidActions(state);
    if (actions.length === 0) throw new Error('randomBot: there is no legal action (the game is over).');
    return rngPick(rng, actions);
  },
};
