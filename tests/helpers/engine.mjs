// engine.mjs - which ruleset the test helpers and the contract-level suites run against.
//
// Not a suite. The ruleset comes from the TEST_RULES environment variable (a ruleset
// id of src/rulesets/index.js); unset, it is the default, Continental Rails. The
// shared helpers (play.mjs, rig.mjs, builder.mjs, modules.mjs) and the contract-level
// suites (contract, determinism, purity, smoke) take their engine and bots from here,
// so the same suite can be run against either ruleset:
//
//   node tests/contract.test.mjs                    Continental Rails
//   TEST_RULES=pr2e node tests/contract.test.mjs    Pacific Rails, second edition
//
// tests/rulesets.test.mjs runs those suites with TEST_RULES set to every ruleset other
// than the default (npm test runs them for the default).

import { getRuleset, isRulesetId, rulesetIds, DEFAULT_RULESET_ID } from '../../src/rulesets/index.js';

const asked = process.env.TEST_RULES;
if (asked !== undefined && asked !== '' && !isRulesetId(asked)) {
  throw new Error(`TEST_RULES="${asked}" is not a ruleset. The rulesets are: ${rulesetIds().join(', ')}.`);
}

/** The ruleset id under test. */
export const RULES_ID = asked ? asked : DEFAULT_RULESET_ID;

/** Its registry entry (engine, policies, bots, variants). */
export const RULESET = getRuleset(RULES_ID);

/** Its engine: the namespace its index.js exports. */
export const ENGINE = RULESET.engine;

/** A word for the summary line of a suite run against a ruleset that is not the default: '' for the default. */
export const RULES_TAG = RULES_ID === DEFAULT_RULESET_ID ? '' : ` [rules: ${RULES_ID}]`;
