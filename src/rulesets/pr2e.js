// pr2e.js - the "Pacific Rails, second edition" ruleset (id `pr2e`): the
// published 2020 rules of the game Continental Rails grew from, adapted to the
// same route map.
//
// Engine: src/engine-pr2e/, a separate engine behind the same contract. It
// began as a copy of the Continental Rails engine and plays identically until
// its rules are rewritten.
//
// Policies: for now the Continental Rails heuristic bot, built against THIS
// engine, stands in (it works because the engine is still a copy). It is to be
// replaced by a heuristic written for these rules; the search levels pick the
// replacement up through `makePolicies` with no other change.

import * as engine from '../engine-pr2e/index.js';
import { createHeuristicPolicies } from '../bots/heuristicBot.js';
import { defineRuleset } from './define.js';

export const pr2e = defineRuleset({
  id: 'pr2e',
  name: 'Pacific Rails, second edition',
  description: 'The published 2020 rules of the game Continental Rails grew from, played on the same map.',
  engine,
  engineDir: 'src/engine-pr2e',
  makePolicies: createHeuristicPolicies,
  ui: { views: {} },
});
