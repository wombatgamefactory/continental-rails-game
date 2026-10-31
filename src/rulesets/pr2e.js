// pr2e.js - the "Pacific Rails, second edition" ruleset (id `pr2e`): the
// published 2020 rules of the game Continental Rails grew from, adapted to the
// same route map.
//
// Engine: src/engine-pr2e/, a separate engine behind the same contract, with
// its own action types and decisions (docs/engine-contract-pr2e.md).
//
// Policies: the heuristic bot of src/bots/pr2e/ (heuristicBot-pr2e.js), built
// over this engine by `createPr2eHeuristicPolicies`. Medium plays it as it
// stands, Easy plays it with noise, and the search levels (Hard, Expert) run
// the shared tree search (src/bots/mctsBot.js) with its scores as priors and
// its policy for the playouts; a playout plays the game to its end (by the
// transcontinental line or the turn limit).

import * as engine from '../engine-pr2e/index.js';
import { defineRuleset } from './define.js';
import { createPr2eHeuristicPolicies } from '../bots/pr2e/heuristicBot-pr2e.js';

export const pr2e = defineRuleset({
  id: 'pr2e',
  name: 'Pacific Rails, second edition',
  description: 'The published 2020 rules of the game Continental Rails grew from, played on the same map.',
  engine,
  engineDir: 'src/engine-pr2e',
  makePolicies: createPr2eHeuristicPolicies,
  ui: { views: {} },
});
