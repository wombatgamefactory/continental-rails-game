// presets.js - the setup screen's named starting points, as plain data, per ruleset.
//
// A preset is a set of variant OVERRIDES (name -> value); anything it does not
// mention stays at the engine's default. This is the only place in the UI that
// names variants, and it is data the designer can edit: nothing else reads these
// names. A preset that names a variant the engine does not have is shown with
// the engine's own message when it is applied (resolveVariants rejects it).
//
// Each ruleset has its own list, keyed by its id (src/rulesets/index.js): the
// set-up page shows only the presets of the rules chosen. A ruleset with no
// entry here shows no presets.

const CONTINENTAL_PRESETS = [
  {
    id: 'full',
    label: 'Full game',
    note: 'All four add-on modules. The default.',
    variants: {},
  },
  {
    id: 'base',
    label: 'Base game',
    note: 'Carriage upgrades and milestones; no Legislative Agenda, no Pony Express.',
    variants: { moduleLegislativeAgenda: false, modulePonyExpress: false },
  },
  {
    id: 'core',
    label: 'Core only',
    note: 'Collect, build and lay with nothing added: the cleanest game to learn.',
    variants: { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false },
  },
];

/**
 * The second edition's engine is still a copy of the Continental Rails engine, so its variants
 * (and these presets) are the same for now. Replace them when its own variants are written.
 */
const PR2E_PRESETS = CONTINENTAL_PRESETS.map((p) => ({ ...p, variants: { ...p.variants } }));

export const PRESETS_BY_RULESET = {
  continental: CONTINENTAL_PRESETS,
  pr2e: PR2E_PRESETS,
};

/** The presets of a ruleset (by id), or [] when it has none. */
export function presetsFor(rulesId) {
  return PRESETS_BY_RULESET[rulesId] ?? [];
}

/** The Continental Rails presets (the default ruleset's), as before rulesets existed. */
export const PRESETS = CONTINENTAL_PRESETS;
