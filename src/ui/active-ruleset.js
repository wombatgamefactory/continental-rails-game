// active-ruleset.js - the page's ONE active ruleset, and the engine the UI talks to.
//
// The page plays one game at a time, so it has one active ruleset at a time
// (src/rulesets/index.js). Every UI module imports the engine's functions and
// tables from THIS module, never from an engine's index.js:
//
//   import { getValidActions, MAP } from './active-ruleset.js';
//
// The names below are ES module LIVE bindings: `useRuleset(id)` reassigns them
// all to the exports of that ruleset's engine, and every importer sees the new
// values at its next call. The set-up page calls it when the rules are changed
// (so the variants panel lists that ruleset's variants), and main.js calls it
// when a game is started or loaded (so the board, the log, the bug reporter
// and the bot driver all talk to the engine the game belongs to).
//
// Rules for UI code that follow from this:
//   - read engine values INSIDE functions, never into a module-level constant
//     (a module-level copy would keep the engine that was active at load);
//   - a name the active engine does not export is undefined here: a view that
//     needs an export only one engine has belongs in that ruleset's
//     ui.views (src/rulesets/index.js, "UI hooks").
//
// The list below is every engine export the UI uses; add a name here (and to
// `useRuleset`) when a UI module needs another.

import { getRuleset, DEFAULT_RULESET_ID } from '../rulesets/index.js';

let current = null;

export let
  DISTRICT_IDS, GRID, MAP, NAMES, PLAYER_BOARD, SILENT, STOP_ACTION_TYPES, VARIANTS, actionKey,
  activeModules, applyAction, cardIndex, cloneState, congressCoinCost, congressTable, createGame,
  defaultVariants, describeAction, describeDecision, describeProgress, describeStep,
  deserialiseState, districtInfo, formatCost, formatRouteCost, frameLabel, getActionSpace,
  getBlockReason, getConstants, getGameConfig, getStructuralBlockReason, getValidActions,
  getVariantDef, goalStandings, goalsInPlay, hashState, hireCost, installedUpgrades, isGameOver,
  legislativeCardData, makeRng, moveTrainPath, nextTelegraphVp, nonDefaultVariants, ownedRoutes,
  parseVariantValue, playerName, ponyCardData, ponyOngoing, previewMultipliers, production,
  railwayStationCount, replayGame, resolveVariants, rngNext, routeShortfall, scoreGame,
  serialiseState, specialistCounts, storageCapacity, storageUsed, telegraphStationCount, topFrame,
  totalVp, upgradeTileAt, upgradeTileData, workersOnGrid;

/**
 * Makes `id` the active ruleset (the default when it is null or absent). Throws
 * on an unknown id, naming the ids there are. Returns the ruleset.
 * @param {string|null} [id]
 */
export function useRuleset(id) {
  const next = getRuleset(id);
  if (next === current) return next;
  const engine = next.engine;
  ({
    DISTRICT_IDS, GRID, MAP, NAMES, PLAYER_BOARD, SILENT, STOP_ACTION_TYPES, VARIANTS, actionKey,
    activeModules, applyAction, cardIndex, cloneState, congressCoinCost, congressTable, createGame,
    defaultVariants, describeAction, describeDecision, describeProgress, describeStep,
    deserialiseState, districtInfo, formatCost, formatRouteCost, frameLabel, getActionSpace,
    getBlockReason, getConstants, getGameConfig, getStructuralBlockReason, getValidActions,
    getVariantDef, goalStandings, goalsInPlay, hashState, hireCost, installedUpgrades, isGameOver,
    legislativeCardData, makeRng, moveTrainPath, nextTelegraphVp, nonDefaultVariants, ownedRoutes,
    parseVariantValue, playerName, ponyCardData, ponyOngoing, previewMultipliers, production,
    railwayStationCount, replayGame, resolveVariants, rngNext, routeShortfall, scoreGame,
    serialiseState, specialistCounts, storageCapacity, storageUsed, telegraphStationCount,
    topFrame, totalVp, upgradeTileAt, upgradeTileData, workersOnGrid,
  } = engine);
  current = next;
  return next;
}

/** The active ruleset (its registry entry: id, name, engine, policies, ui). */
export function activeRuleset() {
  return current;
}

/** The id of the active ruleset. */
export function activeRulesetId() {
  return current.id;
}

useRuleset(DEFAULT_RULESET_ID);
