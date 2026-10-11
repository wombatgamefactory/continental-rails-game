// index.js - the bot registry.
//
// The setup screen builds its seat menu from BOT_LEVELS and the simulator
// accepts the same ids on its command line, so a level registered here
// appears in both.
//
// The bot interface (docs/engine-contract.md, "Bots"):
//
//   bot.chooseAction(state, { rng, timeBudgetMs, iterations, now, ...options }) -> action
//
//   state         the real game state. A bot must not change it. A bot that
//                 looks ahead must search on `determinise(state, rng)` copies,
//                 never on `state` itself (hidden deck orders, R2.4).
//   rng           the bot's OWN random stream, `{ s }` from makeRng. A bot
//                 never reads or advances `state.rng`.
//   timeBudgetMs  how long the bot may think, or null for the level's default.
//                 For the search levels (hard, expert) this is the time for
//                 one whole TURN of the bot, shared out over the decisions of
//                 that turn (mctsBot.js), not the time for each decision.
//   iterations    a fixed amount of search in place of a time budget, or null.
//                 Tests use it so that a seed gives the same move every time.
//                 For the search levels it is likewise an allowance per turn.
//   now           () => milliseconds, supplied by the driver, or null. Bots do
//                 not read a clock themselves; with `iterations` set they
//                 need none.
//   ...options    anything else a level understands (the `jitter` and `weights`
//                 of a heuristic bot). A bot ignores what it does not know.
//
// The action returned is always one of getValidActions(state).

import { randomBot } from './randomBot.js';
import { heuristicBot, easyBot } from './heuristicBot.js';
import { hardBot, expertBot, MCTS_SETTINGS } from './mctsBot.js';

/**
 * The levels on offer, weakest first.
 * The five levels are `random`, `easy`, `medium`, `hard` and `expert`.
 * `name` is the label on the setup screen, `description` its one line.
 */
export const BOT_LEVELS = [
  {
    id: 'random',
    name: 'Random',
    description: 'Plays any legal move at random. A baseline for testing, not an opponent.',
    defaultTimeBudgetMs: 0,
  },
  {
    id: 'easy',
    name: 'Easy',
    description: 'Knows how to gather, build and lay track, but plays loosely and often picks a second-best move.',
    defaultTimeBudgetMs: 0,
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Plans its routes, builds an engine and races for the crossing. Moves at once.',
    defaultTimeBudgetMs: 0,
  },
  {
    id: 'hard',
    name: 'Hard',
    description: 'Thinks each turn through to the end of the game before it moves. About a second and a half a turn.',
    defaultTimeBudgetMs: MCTS_SETTINGS.hardTimeBudgetMs,
  },
  {
    id: 'expert',
    name: 'Expert',
    description: 'The same search with four times the thinking: about six seconds a turn. The strongest opponent.',
    defaultTimeBudgetMs: MCTS_SETTINGS.expertTimeBudgetMs,
  },
];

const BOTS = {
  random: randomBot,
  easy: easyBot,
  medium: heuristicBot,
  hard: hardBot,
  expert: expertBot,
};

/** The ids of the registered levels. */
export function botLevelIds() {
  return BOT_LEVELS.map((level) => level.id);
}

/**
 * The bot for a level.
 * @param {string} level an id from BOT_LEVELS
 * @returns {{ chooseAction: (state: object, context: object) => object }}
 */
export function getBot(level) {
  if (!Object.prototype.hasOwnProperty.call(BOTS, level)) {
    throw new Error(`Unknown bot level "${level}". The levels are: ${botLevelIds().join(', ')}.`);
  }
  return BOTS[level];
}
