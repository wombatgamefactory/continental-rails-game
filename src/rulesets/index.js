// index.js - the ruleset registry.
//
// The game offers more than one ruleset. Each is a complete game behind the
// SAME engine contract (docs/engine-contract.md): its own engine, its own bot
// policies, its own variants and constants, and hooks for the page. The rule
// sets never share an engine file; they meet only here.
//
//   continental   Continental Rails (src/engine/)                         the default
//   pr2e          Pacific Rails, second edition (src/engine-pr2e/)
//
// HOW EVERYTHING ELSE GETS ITS ENGINE
//
// Nothing outside an engine imports an engine's index.js except this registry
// (through the entries in ./continental.js and ./pr2e.js). Everything else asks
// for a ruleset and takes `ruleset.engine`:
//
//   - the bots are generic over an engine: src/bots/randomBot.js,
//     heuristicBot.js and mctsBot.js export factories, and a ruleset builds its
//     levels from them (define.js); `getBot(level, rulesetId)` in
//     src/bots/index.js and `ruleset.getBot(level)` here hand them out;
//   - the bot Web Worker (src/bots/bot-worker.js) is told the ruleset in every
//     request (`rules`) and looks it up here;
//   - the simulator takes `--rules=<id>` and passes the id to its worker
//     threads in the plan; every module that needs the engine is handed it;
//   - the page has ONE active ruleset at a time: src/ui/active-ruleset.js holds
//     live bindings of the active engine's exports, switched by useRuleset(id)
//     when the set-up page changes the rules or a game is started or loaded;
//   - the test helpers read the ruleset from the TEST_RULES environment
//     variable (tests/helpers/engine.mjs), so a contract-level suite can be run
//     against any ruleset.
//
// UI HOOKS. `ruleset.ui.views` is an object of optional render functions that
// replace the page's own for this ruleset, by name: renderHeader, renderScores,
// renderPrompt, renderGrid, renderCongress, renderMap, renderTrains, renderLog,
// renderDock, renderEnd (src/ui/main.js). Each takes the render context
// (`ctx.engine` and `ctx.ruleset` are in it) and returns HTML. A view module
// must not import src/ui/active-ruleset.js (that would be an import cycle
// through this registry); it reads the engine from the context. Empty for
// both rulesets today.
//
// TO ADD A RULESET: put its engine in src/engine-<id>/ (it must meet the whole
// contract on its own), write src/rulesets/<id>.js with defineRuleset, add it
// to RULESETS below, give it presets in src/ui/presets.js, and run the
// contract-level suites against it (tests/rulesets.test.mjs lists them).

import { continental } from './continental.js';
import { pr2e } from './pr2e.js';

export { REQUIRED_ENGINE_EXPORTS, RULESET_BOT_LEVELS } from './define.js';

/** The ruleset a game uses when none is named. */
export const DEFAULT_RULESET_ID = 'continental';

/** Every ruleset, in the order the set-up page offers them. */
export const RULESETS = Object.freeze([continental, pr2e]);

const BY_ID = new Map(RULESETS.map((r) => [r.id, r]));

/** The ids of the registered rulesets. */
export function rulesetIds() {
  return RULESETS.map((r) => r.id);
}

/** Whether `id` names a registered ruleset. */
export function isRulesetId(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

/**
 * A ruleset by id. `undefined`, `null` or '' give the default; a ruleset
 * object is returned as it is. An unknown id throws, naming the ids there are.
 * @param {string|object|null} [id]
 */
export function getRuleset(id) {
  if (id === undefined || id === null || id === '') return BY_ID.get(DEFAULT_RULESET_ID);
  if (typeof id === 'object' && BY_ID.get(id.id) === id) return id;
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown rules "${id}". The rules are: ${rulesetIds().join(', ')}.`);
  return found;
}

/** The engine of a ruleset (by id; the default when none is named). */
export function getEngine(id) {
  return getRuleset(id).engine;
}
