// presets.js - the setup screen's named starting points, as plain data.
//
// A preset is a set of variant OVERRIDES (name -> value); anything it does not
// mention stays at the engine's default. This is the only place in the UI that
// names variants, and it is data the designer can edit: nothing else reads these
// names. A preset that names a variant the engine does not have is shown with
// the engine's own message when it is applied (resolveVariants rejects it).

export const PRESETS = [
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
