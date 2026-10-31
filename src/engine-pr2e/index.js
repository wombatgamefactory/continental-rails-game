// index.js - the public face of the "Pacific Rails, second edition" engine
// (ruleset id `pr2e`).
//
// The published 2020 second-edition rules, adapted to the Continental Rails
// route map. Rule numbers (`P14.6`) refer to the ruleset's rules text, which
// is not part of this repository. This engine meets the whole engine contract
// (docs/engine-contract.md) on its own; the action types and decisions that
// differ from Continental Rails are in docs/engine-contract-pr2e.md. It never
// imports anything from src/engine/, and nothing outside it imports its files
// except through the ruleset registry (src/rulesets/index.js). Its map data
// is its own copy in ./data/, loaded by relative module import.
//
// The whole core rulebook is played: setup, the action grid, collecting and
// the special actions, hiring, board activation, the Financier and Congress,
// cowboy hats, carriage upgrades, the lay, buildings, tolls, the goal tiles,
// the end and final scoring, and every variant of P21.1.
//
// Engine files import each other directly and in one direction:
//
//   rng, rules, variants, events -> board -> state -> queries -> conditions
//     -> scoring -> legality -> actions -> game -> index

export { createGame, isGameOver, replayGame } from './game.js';
export { applyAction, SILENT, MUTATORS, RESUME, DISTRICT_RESOLVERS, ENGINE_LIMITS } from './actions.js';
export * from './legality.js';
export * from './queries.js';
export { scoreGame, addVp, buildingTableVp, finalSourceValues, goalStandings, goalsInPlay, TIE_BREAK_STEPS } from './scoring.js';
export {
  SCHEMA_VERSION,
  MAP_ID,
  RULESET_ID,
  UNIMPLEMENTED_VARIANT_VALUES,
  getConstants,
  topFrame,
  cloneState,
  hashState,
  getGameConfig,
  serialiseState,
  deserialiseState,
  hiddenDecks,
  determinise,
  vpSourcesInPlay,
  bonusActionsInPlay,
  cardRemoved,
} from './state.js';
export { makeRng, cloneRng, forkRng, rngNext, rngInt, rngPick, shuffle, hashSeed } from './rng.js';
export * from './variants.js';
export * from './rules.js';
export * from './board.js';
export { METRICS, metricValue, evaluateCondition, describeProgress } from './conditions.js';
