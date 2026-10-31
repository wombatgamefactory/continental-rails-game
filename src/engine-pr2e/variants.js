// variants.js - the 7 rule variants of the second edition's rules text (P21.1), exactly by name.
//
// This table is the ONE list of variants of this ruleset. The setup screen
// builds its "Rules variants" panel from it and the simulator builds its
// `--variant.<name>=` flags from it, so a variant added here appears in both
// with no other change.
//
// Every default is the ruled value (P21.1); the other values stay for the
// simulator. A game stores its resolved variants at `state.variants` (frozen
// at createGame). Logic reads `state.variants.<name>`, never this table.

/**
 * @typedef {object} VariantDef
 * @property {string} name        exact name from P21.1
 * @property {string} [label]     the name as a person reads it (setup screen, chips); data only
 * @property {'enum'|'boolean'|'integer'} type
 * @property {Array} [values]     allowed values (enum, boolean)
 * @property {number} [min]       lowest integer allowed (integer)
 * @property {number} [max]       highest integer allowed
 * @property {*} default
 * @property {string} description one line for the setup screen
 * @property {string} rule        rule numbers
 */

/** @type {VariantDef[]} */
export const VARIANTS = [
  {
    name: 'tycoonMode',
    label: 'Tycoon Mode',
    type: 'boolean',
    values: [true, false],
    default: false,
    description: 'Hiring a specialist costs resources, by type and by the carriage it goes into',
    rule: 'P8.5',
  },
  {
    name: 'layShape',
    label: 'Lay shape',
    type: 'enum',
    values: ['path', 'one-new-route', 'adjacent-only'],
    default: 'path',
    description: 'How far one lay may travel over laid routes and how many routes it may lay',
    rule: 'P14.3.4',
  },
  {
    name: 'newConnectionRule',
    label: 'New connections',
    type: 'enum',
    values: ['any-unlaid-route', 'must-join-unjoined'],
    default: 'any-unlaid-route',
    description: 'Whether a newly laid route may join two cities that laid routes already join',
    rule: 'P14.3.5',
  },
  {
    name: 'arrivalBuilding',
    label: 'Arrival building',
    type: 'enum',
    values: ['compulsory-if-able', 'optional'],
    default: 'compulsory-if-able',
    description: 'Whether a player able to build in a lay\'s destination must place one building there',
    rule: 'P14.6',
  },
  {
    name: 'upgradePlacement',
    label: 'Upgrade placement',
    type: 'enum',
    values: ['first-free', 'any-carriage'],
    default: 'first-free',
    description: 'Which carriage a new upgrade token may go in',
    rule: 'P12.2.4',
  },
  {
    name: 'hatOverflow',
    label: 'Hat overflow',
    type: 'enum',
    values: ['resource', 'lost'],
    default: 'resource',
    description: 'What a cowboy hat beyond the limit of 2 becomes, from sources other than displacement',
    rule: 'P11.1',
  },
  {
    name: 'maxTurnsPerPlayer',
    label: 'Turn limit',
    type: 'integer',
    min: 0,
    max: 500,
    default: 80,
    description: 'Digital safety stop: the game end is triggered when a player has taken this many turns (0 = off)',
    rule: 'P19.5',
  },
];

const BY_NAME = new Map(VARIANTS.map((v) => [v.name, v]));

/** The names, in rules-text order. */
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
  return def.values.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(', ');
}

/** Whether `value` is legal for the variant `def`. Strict on type: "3" is not 3. */
export function isAllowedValue(def, value) {
  if (def.type === 'integer') {
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
  if (def.type === 'integer') {
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
 * variant present, defaults filled in. Rejects, with a message that names the
 * problem, a name that is not a variant and a value outside its allowed values.
 *
 * @param {object} [overrides] `{ variantName: value }`
 * @returns {object} a fresh plain object with all 7 variants
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
      throw new Error(`Illegal value ${JSON.stringify(value)} for variant "${name}". Allowed: ${describeAllowed(def)}.`);
    }
    out[name] = value;
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
 * Which add-on modules are on: none. This ruleset has no modules (P24.4), so
 * `state.modules` is always empty; the function exists because the contract
 * requires it (section 10) and the page reads it.
 */
export function activeModules(variants) {
  void variants;
  return { upgrades: false, milestones: false, goals: false, legislative: false, pony: false };
}
