// ruleset-views.js - which screens a ruleset draws for itself.
//
// The ruleset registry (src/rulesets) is loaded by Node code (the simulator, the bot
// worker, the tests) and must not import UI files, so the page keeps its own map from a
// ruleset id to the views of that ruleset. main.js `render` lays these over the page's
// own renderers (and over the registry's `ui.views`, which stays empty).
//
// A ruleset with no entry here is drawn entirely by the page's own renderers.

import { views as pr2eViews } from './pr2e/views.js';

export const VIEWS_BY_RULESET = Object.freeze({
  pr2e: pr2eViews,
});

/**
 * The manifest-id prefixes of the pictures a ruleset's first screen draws: its own (`pr2e-`) and the page's shared
 * icons and pieces its screens use. The set-up page asks the browser to fetch them in its idle time when that
 * ruleset is chosen (art.js `warmArt`), so the game's first screen is not drawn blank while they download. A
 * ruleset with no entry is not warmed.
 */
export const ART_PREFIX_BY_RULESET = Object.freeze({
  continental: ['board-', 'resource-', 'specialist-face-', 'token-cowboy-hat', 'piece-'],
  pr2e: ['pr2e-', 'resource-', 'icon-', 'piece-', 'token-cowboy-hat', 'footprint-marker', 'specialist-'],
});

/**
 * Accessible names (aria-label) of the page's fixed regions that a ruleset names differently from index.html, by
 * selector. The second edition has a player board where the page's own screens have a train, a Congress where they
 * have the Lobby, and no add-on modules; a region not listed keeps the label in index.html.
 */
export const REGION_LABELS_BY_RULESET = Object.freeze({
  pr2e: Object.freeze({
    '.region--trains': 'Player board',
    '.region--congress': 'Congress',
    '.region--dock': 'Goals, upgrade tokens and specialists',
  }),
});

/** The views of a ruleset (by id), or an empty object. */
export function viewsFor(rulesetId) {
  return VIEWS_BY_RULESET[rulesetId] ?? {};
}
