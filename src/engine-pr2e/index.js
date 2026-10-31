// index.js - the public face of the "Pacific Rails, second edition" engine
// (ruleset id `pr2e`).
//
// This engine began as a straight copy of src/engine/ (Continental Rails) and
// behaves identically until its rules are rewritten. It meets the whole engine
// contract (docs/engine-contract.md) on its own: it never imports anything
// from src/engine/, and nothing outside it imports its files except through
// the ruleset registry (src/rulesets/index.js). Its map data is its own copy
// in ./data/, loaded by relative module import, so it works in Node and in
// the browser alike.
//
// Engine files import each other directly and in one direction:
//
//   rng, rules, variants, events -> board -> state -> queries -> conditions
//     -> scoring -> legality -> actions -> game -> index

export { createGame, isGameOver, replayGame } from './game.js';
export {
  applyAction,
  SILENT,
  MUTATORS,
  RESUME,
  DISTRICT_RESOLVERS,
  ENGINE_LIMITS,
  EFFECT_HANDLERS,
  STANDING_EFFECT_TYPES,
  TRIGGER_SITES,
  MODIFIER_READERS,
} from './actions.js';
export * from './legality.js';
export * from './queries.js';
export { scoreGame, addVp, buildingTableVp, finalSourceValues, goalStandings, goalsInPlay, TIE_BREAK_STEPS } from './scoring.js';
export {
  SCHEMA_VERSION,
  MAP_ID,
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
