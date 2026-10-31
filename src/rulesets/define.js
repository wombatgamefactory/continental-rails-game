// define.js - builds one entry of the ruleset registry (src/rulesets/index.js).
//
// A ruleset is a complete game: an engine that meets the whole engine contract
// (docs/engine-contract.md), the bot policies that play it, and the hooks the
// page uses to show it. `defineRuleset` checks the engine exports what the
// contract requires, and wires the five bot levels to that engine:
//
//   random   createRandomBot(engine)                  (src/bots/randomBot.js)
//   easy     policies.easyBot                         (the ruleset's heuristic, with noise)
//   medium   policies.heuristicBot                    (the ruleset's heuristic)
//   hard     createMctsSearch(engine, policies).hardBot    (src/bots/mctsBot.js: tree search whose
//   expert   createMctsSearch(engine, policies).expertBot   priors and playouts come from `policies`)
//
// The policies and the bots are built on first use and kept, once per ruleset,
// so a page or a process that never plays a ruleset never builds its bots, and
// every caller of one ruleset shares the same instances (and so the same memos,
// which are pure functions of the state).

import { createRandomBot } from '../bots/randomBot.js';
import { createMctsSearch } from '../bots/mctsBot.js';

/**
 * What every engine must export: the contract's public API (section 2) as the
 * bots, the simulator, the bug reporter and the set-up page use it. An engine
 * may export more (the board and the trains of the page read further queries);
 * these are the names nothing can work without.
 */
export const REQUIRED_ENGINE_EXPORTS = [
  // games (2.1)
  'createGame', 'getValidActions', 'applyAction', 'isGameOver', 'scoreGame', 'replayGame', 'getGameConfig',
  'getBlockReason', 'getStructuralBlockReason', 'SILENT',
  // state as a value (2.2)
  'cloneState', 'hashState', 'serialiseState', 'deserialiseState', 'topFrame', 'getConstants',
  // hidden information and randomness (7, 8)
  'determinise', 'hiddenDecks', 'makeRng', 'forkRng', 'rngNext', 'rngInt', 'rngPick',
  // describing things (2.3)
  'actionKey', 'describeAction', 'describeDecision', 'getActionSpace', 'ACTIONS',
  // variants and constants (10)
  'VARIANTS', 'RULES', 'resolveVariants', 'defaultVariants', 'nonDefaultVariants', 'parseVariantValue', 'getVariantDef', 'activeModules',
];

/** The bot level ids every ruleset provides, in the order of BOT_LEVELS (src/bots/index.js). */
export const RULESET_BOT_LEVELS = ['random', 'easy', 'medium', 'hard', 'expert'];

/**
 * Builds a registry entry.
 *
 * @param {object} spec
 * @param {string} spec.id            the ruleset id: used in the address (`?rules=`), on the simulator command line
 *                                    (`--rules=`), in bug reports, analytics and simulator output
 * @param {string} spec.name          the player-facing name
 * @param {string} spec.description   one line for the set-up page
 * @param {object} spec.engine        the namespace exported by the engine's index.js (`import * as engine`)
 * @param {string} spec.engineDir     where the engine lives, from the repository root (`src/engine`): for the tests
 *                                    that scan an engine's files and for tools; nothing loads modules by it at run time
 * @param {(engine: object) => object} spec.makePolicies
 *                                    builds the bot policies against the engine; must return at least
 *                                    `{ heuristicBot, easyBot, heuristicPolicy, rolloutPolicy, scoreValidActions, repeatGuard }`
 *                                    and may add `decisionShare` and `pipelineValue` for the search (mctsBot.js)
 * @param {object} [spec.ui]          hooks for the page (see src/rulesets/index.js, "UI hooks")
 */
export function defineRuleset(spec) {
  const { id, name, description, engine, engineDir, makePolicies } = spec;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`defineRuleset: "${id}" is not a ruleset id (lower case letters, digits and hyphens).`);
  if (typeof name !== 'string' || name.trim() === '') throw new Error(`defineRuleset: ruleset "${id}" needs a name.`);
  if (engine === null || typeof engine !== 'object') throw new Error(`defineRuleset: ruleset "${id}" needs its engine namespace.`);
  if (typeof engineDir !== 'string' || !/^src\/engine[a-z0-9-]*$/.test(engineDir)) throw new Error(`defineRuleset: ruleset "${id}" needs engineDir, the folder of its engine ("src/engine..."), not ${JSON.stringify(engineDir)}.`);
  const missing = REQUIRED_ENGINE_EXPORTS.filter((key) => engine[key] === undefined);
  if (missing.length > 0) throw new Error(`defineRuleset: the engine of "${id}" does not export ${missing.join(', ')} (docs/engine-contract.md, "Rulesets").`);
  if (typeof makePolicies !== 'function') throw new Error(`defineRuleset: ruleset "${id}" needs makePolicies(engine).`);

  let policies = null;
  let search = null;
  let bots = null;

  const ruleset = {
    id,
    name,
    description: description ?? '',
    engine,
    engineDir,
    /** The engine's variants table (src/engine.../variants.js): what the set-up page and `--variant.` offer. */
    get variants() {
      return engine.VARIANTS;
    },
    /** The engine's tuning constants (rules.js): what `--const.` overrides. */
    get constants() {
      return engine.RULES;
    },
    /** The heuristic policies built against this engine (built on first use, then kept). */
    get policies() {
      if (policies === null) {
        policies = makePolicies(engine);
        for (const key of ['heuristicBot', 'easyBot', 'heuristicPolicy', 'rolloutPolicy', 'scoreValidActions', 'repeatGuard']) {
          if (policies[key] === undefined) throw new Error(`Ruleset "${id}": its policies do not provide ${key}.`);
        }
      }
      return policies;
    },
    /** The tree search built against this engine and these policies: { search, blindCopy, decisionShare, createMctsBot, hardBot, expertBot }. */
    get search() {
      if (search === null) search = createMctsSearch(engine, ruleset.policies);
      return search;
    },
    /** The five levels, by id. */
    get bots() {
      if (bots === null) {
        const p = ruleset.policies;
        const s = ruleset.search;
        bots = Object.freeze({ random: createRandomBot(engine), easy: p.easyBot, medium: p.heuristicBot, hard: s.hardBot, expert: s.expertBot });
      }
      return bots;
    },
    /**
     * The bot of a level for this ruleset.
     * @param {string} level an id from BOT_LEVELS
     */
    getBot(level) {
      if (!RULESET_BOT_LEVELS.includes(level)) {
        throw new Error(`Unknown bot level "${level}". The levels are: ${RULESET_BOT_LEVELS.join(', ')}.`);
      }
      return ruleset.bots[level];
    },
    ui: Object.freeze({ views: Object.freeze({ ...((spec.ui && spec.ui.views) || {}) }) }),
  };
  return Object.freeze(ruleset);
}
