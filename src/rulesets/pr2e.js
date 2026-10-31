// pr2e.js - the "Pacific Rails, second edition" ruleset (id `pr2e`): the
// published 2020 rules of the game Continental Rails grew from, adapted to the
// same route map.
//
// Engine: src/engine-pr2e/, a separate engine behind the same contract, with
// its own action types and decisions (docs/engine-contract-pr2e.md).
//
// Policies: TEMPORARY STAND-IN. The Continental Rails heuristic bot cannot read
// this engine's actions, so until a bot is written for these rules, Easy,
// Medium, Hard and Expert all rest on `makeStandInPolicies` below: a random
// policy that prefers any action that is not a stop action (so it collects,
// builds, lays and hires whenever it can, instead of skipping). The search
// levels (Hard, Expert) run the shared tree search with these priors and
// playouts; a playout plays the game to its end (by the transcontinental
// line or the turn limit). Replace `makeStandInPolicies` with the real pr2e
// policies when they exist; nothing else here needs to change.

import * as engine from '../engine-pr2e/index.js';
import { defineRuleset } from './define.js';

/**
 * TEMPORARY: the stand-in policies of every pr2e bot level above Random.
 * Pure: the only randomness is the bot's own stream (`context.rng`).
 *
 * @param {object} E the pr2e engine namespace
 */
export function makeStandInPolicies(E) {
  const { getValidActions, rngPick, makeRng, topFrame, ACTIONS } = E;

  const isStop = (action) => ACTIONS[action.type] !== undefined && ACTIONS[action.type].stop === true;

  /** A uniformly random action among the non-stop ones; a stop action only when nothing else is legal. */
  function heuristicPolicy(state, context = {}) {
    const actions = getValidActions(state);
    if (actions.length === 0) throw new Error('pr2e stand-in bot: there is no legal action (the game is over).');
    const active = actions.filter((a) => !isStop(a));
    const rng = context.rng || makeRng(`pr2e-stand-in:${state.seq}`);
    return rngPick(rng, active.length > 0 ? active : actions);
  }

  /** Scores for the search's priors: 1 for a non-stop action, 0 for a stop action. */
  function scoreValidActions(state) {
    return getValidActions(state).map((action) => ({ action, score: isStop(action) ? 0 : 1 }));
  }

  const bot = {
    /** TEMPORARY stand-in (see the file header). */
    chooseAction(state, context = {}) {
      return heuristicPolicy(state, context);
    },
  };

  /** The share of a turn's search allowance a decision gets, by the kind of the pending decision. */
  function decisionShare(state, S) {
    if (state.phase !== 'play') return S.shareSetup;
    if (state.turn.player !== state.toAct) return S.shareOffTurn;
    const frame = topFrame(state);
    switch (frame === null ? '' : frame.kind) {
      case 'workerStep':
        return S.shareWorker;
      case 'chooseDistrict':
        return S.shareDistrict;
      case 'lay':
        return S.shareLayTracks;
      case 'placeBuildings':
        return S.shareBuilding;
      default:
        return S.shareFollowUp;
    }
  }

  /** What a player holds, at a playout cut-off: built tiles score 1 VP each at the end (P20.2.2). */
  function pipelineValue(player, S) {
    const t = player.builtTiles;
    const r = player.resources;
    return (t.ground + t.tunnel + t.bridge) * S.evalBuiltTile + (r.iron + r.wood + r.gunpowder + player.coins) * S.evalResource + player.hats * S.evalHat;
  }

  return {
    heuristicBot: bot,
    easyBot: bot,
    heuristicPolicy,
    rolloutPolicy: heuristicPolicy,
    scoreValidActions,
    // The Continental Rails search guards against a railhead shuttling back and forth; pr2e has no Move Train.
    repeatGuard: { note() {}, wouldRepeat: () => false },
    decisionShare,
    pipelineValue,
    standIn: true,
  };
}

export const pr2e = defineRuleset({
  id: 'pr2e',
  name: 'Pacific Rails, second edition',
  description: 'The published 2020 rules of the game Continental Rails grew from, played on the same map.',
  engine,
  engineDir: 'src/engine-pr2e',
  makePolicies: makeStandInPolicies,
  ui: { views: {} },
});
