// continental.js - the Continental Rails ruleset (id `continental`, the default).
//
// Engine: src/engine/. Policies: the heuristic bot of src/bots/heuristicBot.js,
// tuned for these rules.

import * as engine from '../engine/index.js';
import { createHeuristicPolicies } from '../bots/heuristicBot.js';
import { defineRuleset } from './define.js';

export const continental = defineRuleset({
  id: 'continental',
  name: 'Continental Rails',
  description: 'The current design: one worker a turn, no rounds, a train that builds the track you lay.',
  engine,
  engineDir: 'src/engine',
  makePolicies: createHeuristicPolicies,
  ui: { views: {} },
});
