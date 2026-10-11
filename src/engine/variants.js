// variants.js - the 25 rule variants of spec R21.3, exactly by name.
//
// This table is the ONE list of variants. The setup screen builds its "Rules
// variants" panel from it and the simulator builds its `--variant.<name>=`
// flags from it, so a variant added here appears in both with no other change.
//
// A game stores its resolved variants at `state.variants` (frozen at
// createGame). Logic reads `state.variants.<name>`, never this table.

/**
 * @typedef {object} VariantDef
 * @property {string} name        exact name from spec R21.3
 * @property {string} [label]     the name as a person reads it (setup screen, chips); data only, no rule reads it
 * @property {'enum'|'boolean'|'integer'|'enum-or-integer'} type
 * @property {Array} [values]     allowed values (enum, boolean, and the named values of enum-or-integer)
 * @property {number} [min]       lowest integer allowed (integer, enum-or-integer)
 * @property {number} [max]       highest integer allowed
 * @property {*} default
 * @property {string} description one line for the setup screen
 * @property {string} rule        spec rule numbers
 */

/** @type {VariantDef[]} */
export const VARIANTS = [
  {
    name: 'conversionRate',
    label: 'Conversion rate',
    type: 'enum',
    values: ['1:1', '2:1', 'iron-in-all'],
    default: '2:1',
    description: 'What a Crew, Miner and Engineer pay for one built tile',
    rule: 'R8.8',
  },
  {
    name: 'turnStructure',
    label: 'Turn structure',
    type: 'enum',
    values: ['continuous', 'rounds'],
    default: 'continuous',
    description: 'Place-or-remove with no rounds, or place-only rounds with a refresh',
    rule: 'R4.1, R4.8',
  },
  {
    name: 'moduleCarriageUpgrades',
    label: 'Carriage upgrades',
    type: 'boolean',
    values: [true, false],
    default: true,
    description: 'Carriage upgrade tiles in play',
    rule: 'R15',
  },
  {
    name: 'endGameScoring',
    label: 'Milestones and goals',
    type: 'enum',
    values: ['milestones', 'goals', 'both', 'none'],
    default: 'milestones',
    description: 'Which of the two objective systems is in play',
    rule: 'R16.1',
  },
  {
    name: 'goalsInPlay',
    label: 'Goals in play',
    type: 'integer',
    min: 1,
    max: 12,
    default: 3,
    description:
      'Goal cards revealed (used when goals are in play; at most 11 when carriage upgrades are off, because goal 6 is then removed)',
    rule: 'R16.2, R3.8.2',
  },
  {
    name: 'milestonesInPlay',
    label: 'Milestones in play',
    type: 'integer',
    min: 1,
    max: 10,
    default: 6,
    description: 'Milestone tiles revealed (used when milestones are in play)',
    rule: 'R16.7',
  },
  {
    name: 'moduleLegislativeAgenda',
    label: 'Legislative Agenda',
    type: 'boolean',
    values: [true, false],
    default: true,
    description: 'One Legislative Agenda card in force',
    rule: 'R17',
  },
  {
    name: 'legislativeAgendaCard',
    label: 'Legislative Agenda card',
    type: 'enum-or-integer',
    values: ['random'],
    min: 1,
    max: 20,
    default: 'random',
    description: 'Which Legislative Agenda card, when the module is on: random, or a card number',
    rule: 'R3.8.3',
  },
  {
    name: 'modulePonyExpress',
    label: 'Pony Express',
    type: 'boolean',
    values: [true, false],
    default: true,
    description: 'Pony Express tokens and cards in play',
    rule: 'R18',
  },
  {
    name: 'ponyOngoingCap',
    label: 'Ongoing Pony Express cards',
    type: 'integer',
    min: 0,
    max: 15,
    default: 2,
    description: 'Most ongoing Pony Express cards one player may hold (0 = no cap)',
    rule: 'R18.6',
  },
  {
    name: 'startCompensation',
    label: 'Start compensation',
    type: 'enum',
    values: ['graduated', 'none'],
    default: 'graduated',
    description: 'Extra starting resources for later seats',
    rule: 'R3.7',
  },
  {
    name: 'congressTable',
    label: 'Congress price table',
    type: 'enum',
    values: ['design-2026-10', 'jan-2026'],
    default: 'design-2026-10',
    description: 'Which Congress price table is on the strip',
    rule: 'R10.1',
  },
  {
    name: 'claimFrom',
    label: 'Where routes are claimed',
    type: 'enum',
    values: ['railhead', 'network'],
    default: 'railhead',
    description:
      'Claim only where a railhead stands (with Move Train), or anywhere touching your network (no Move Train)',
    rule: 'R11.4, R11.11, R12',
  },
  {
    name: 'layTrackClaims',
    label: 'Claims per Lay Tracks',
    type: 'enum',
    values: ['per-step', 'per-railhead'],
    default: 'per-step',
    description: 'How many claims one Lay Tracks action gives',
    rule: 'R11.3',
  },
  {
    name: 'gameEndTrigger',
    label: 'Transcontinental line',
    type: 'enum',
    values: ['own-crossing', 'any-crossing'],
    default: 'own-crossing',
    description: "Whether a transcontinental line must be one player's own routes",
    rule: 'R19.1, R19.7',
  },
  {
    name: 'endRoutesPerPlayer',
    label: 'Routes that end the game',
    type: 'integer',
    min: 0,
    max: 23,
    default: 8,
    description: 'Game end is triggered when claimed routes reach this number x players (0 = off)',
    rule: 'R19.3',
  },
  {
    name: 'maxTurnsPerPlayer',
    label: 'Turn limit',
    type: 'integer',
    min: 0,
    max: 500,
    default: 80,
    description: 'Digital safety stop: the game end is triggered when a player has taken this many turns (0 = off)',
    rule: 'R19.4',
  },
  {
    name: 'bonusActionLimit',
    label: 'Bonus action limit',
    type: 'enum',
    values: ['once-per-turn', 'once-per-game', 'multiplied'],
    default: 'once-per-turn',
    description: 'How often a bonus action may be taken',
    rule: 'R7.2',
  },
  {
    name: 'hireCostModel',
    label: 'Hire Specialist cost',
    type: 'enum',
    values: ['fee-plus-table', 'fee-only', 'table-only'],
    default: 'fee-plus-table',
    description: 'What the Hire Specialist bonus action costs',
    rule: 'R7.4, R8.6',
  },
  {
    name: 'bothBuildingsSameOwner',
    label: 'Both buildings, one owner',
    type: 'boolean',
    values: [true, false],
    default: true,
    description: 'Whether one player may own both buildings of a city',
    rule: 'R13.7',
  },
  {
    name: 'buildingScoreCurve',
    label: 'Building score table',
    type: 'enum',
    values: ['rising', '2018'],
    default: 'rising',
    description: 'The end-game building table',
    rule: 'R20.3',
  },
  {
    name: 'scoringCard',
    label: 'Scoring card',
    type: 'enum',
    values: ['none', 'random', 'ground', 'tunnel', 'bridge'],
    default: 'none',
    description: 'One terrain scores double when laid',
    rule: 'R11.9',
  },
  {
    name: 'upgradeVpTiming',
    label: 'Upgrade VP timing',
    type: 'enum',
    values: ['per-activation', 'on-install'],
    default: 'per-activation',
    description: 'Whether the three VP upgrade tiles score every activation or once',
    rule: 'R15.6',
  },
  {
    name: 'specialistActivations',
    label: 'Specialist activations',
    type: 'enum',
    values: ['by-level', 'once'],
    default: 'by-level',
    description: 'Whether level 2 and 3 specialists act 2 and 3 times',
    rule: 'R9.3',
  },
  {
    name: 'gridLayout',
    label: 'Action grid layout',
    type: 'enum',
    values: ['fixed', 'shuffle-resources'],
    default: 'fixed',
    description: 'Whether three Gather districts are shuffled at setup',
    rule: 'R5.8',
  },
];

const BY_NAME = new Map(VARIANTS.map((v) => [v.name, v]));

/** The names, in spec order. */
export const VARIANT_NAMES = VARIANTS.map((v) => v.name);

/** The definition of one variant, or null if there is no variant of that name. */
export function getVariantDef(name) {
  return BY_NAME.get(name) ?? null;
}

/** All defaults as a fresh plain object. */
export function defaultVariants() {
  const out = {};
  for (const v of VARIANTS) out[v.name] = v.default;
  return out;
}

/** A short description of what a variant accepts, for error messages and the UI. */
export function describeAllowed(def) {
  if (def.type === 'integer') return `an integer from ${def.min} to ${def.max}`;
  if (def.type === 'enum-or-integer') {
    return `${def.values.map((v) => `"${v}"`).join(' or ')}, or an integer from ${def.min} to ${def.max}`;
  }
  return def.values.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(', ');
}

/** Whether `value` is legal for the variant `def`. Strict on type: "3" is not 3. */
export function isAllowedValue(def, value) {
  if (def.type === 'integer') {
    return Number.isInteger(value) && value >= def.min && value <= def.max;
  }
  if (def.type === 'enum-or-integer') {
    if (def.values.includes(value)) return true;
    return Number.isInteger(value) && value >= def.min && value <= def.max;
  }
  return def.values.includes(value);
}

/**
 * Turns text (a command-line flag or a URL query value) into a value of the
 * variant's type. Does not validate the range: pass the result to
 * resolveVariants. Throws on an unknown variant name.
 */
export function parseVariantValue(name, text) {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(unknownVariantMessage(name));
  if (typeof text !== 'string') return text;
  if (def.type === 'boolean') {
    if (text === 'true' || text === 'on' || text === '1') return true;
    if (text === 'false' || text === 'off' || text === '0') return false;
    return text;
  }
  if (def.type === 'integer' || def.type === 'enum-or-integer') {
    if (/^-?\d+$/.test(text)) return Number(text);
    return text;
  }
  return text;
}

function unknownVariantMessage(name) {
  return `Unknown variant "${name}". The variants are: ${VARIANT_NAMES.join(', ')}.`;
}

/**
 * Checks a set of overrides and returns the complete variants object: every
 * variant present, defaults filled in.
 *
 * Rejects, with a message that names the problem:
 *   - a name that is not a variant;
 *   - a value outside the variant's allowed values;
 *   - `goalsInPlay` of 12 when goals are in play and carriage upgrades are
 *     off (R3.8.2 removes goal 6, leaving 11 cards).
 *
 * @param {object} [overrides] `{ variantName: value }`
 * @returns {object} a fresh plain object with all 25 variants
 */
export function resolveVariants(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Variants must be given as an object of { name: value }.');
  }
  const out = defaultVariants();
  for (const name of Object.keys(overrides)) {
    const def = BY_NAME.get(name);
    if (!def) throw new Error(unknownVariantMessage(name));
    const value = overrides[name];
    if (!isAllowedValue(def, value)) {
      throw new Error(
        `Illegal value ${JSON.stringify(value)} for variant "${name}". Allowed: ${describeAllowed(def)}.`,
      );
    }
    out[name] = value;
  }
  const goalsOn = out.endGameScoring === 'goals' || out.endGameScoring === 'both';
  if (goalsOn && !out.moduleCarriageUpgrades && out.goalsInPlay > 11) {
    throw new Error(
      `Illegal value ${out.goalsInPlay} for variant "goalsInPlay": with "moduleCarriageUpgrades" off goal 6 is removed, so at most 11 goal cards can be in play.`,
    );
  }
  return out;
}

/** The variants whose value differs from the default, as `{ name: value }`. For banners and reports. */
export function nonDefaultVariants(variants) {
  const out = {};
  for (const v of VARIANTS) {
    if (variants[v.name] !== v.default) out[v.name] = variants[v.name];
  }
  return out;
}

/**
 * Which add-on modules are on. A module that is off leaves no trace in the
 * state, the valid actions or the scoring (docs/engine-contract.md, "Modules").
 * Keys are the module ids used by `state.modules` and by `VP_SOURCES`.
 */
export function activeModules(variants) {
  const e = variants.endGameScoring;
  return {
    upgrades: variants.moduleCarriageUpgrades === true,
    milestones: e === 'milestones' || e === 'both',
    goals: e === 'goals' || e === 'both',
    legislative: variants.moduleLegislativeAgenda === true,
    pony: variants.modulePonyExpress === true,
  };
}
