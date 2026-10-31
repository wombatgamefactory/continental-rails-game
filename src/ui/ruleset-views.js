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

/** The views of a ruleset (by id), or an empty object. */
export function viewsFor(rulesetId) {
  return VIEWS_BY_RULESET[rulesetId] ?? {};
}
