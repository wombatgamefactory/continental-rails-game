// rules-audit-pr2e.test.mjs - independent rules conformance audit of the second-edition
// engine (src/engine-pr2e/), 31/10/2026.
//
// SEMANTICS: this suite is PERMANENTLY GREEN. Every check is named for the rule it tests
// (`P14.6`; a suffix after "/" separates several checks of one rule; `P10.1/K6` is a row of
// a table; `E1` to `E8` are the worked examples of P22). A red line is a REGRESSION: the
// engine has drifted from the rules. Fix the engine, not the check - unless the rules
// themselves changed, in which case change the check and say so in
// docs/rules-audit-report-pr2e.md.
//
// The checks were written from the wording of the rules, not from the engine and not from
// the implementers' suites (tests/pr2e/*.test.mjs). Expected values are the rules' own
// numbers. Each check drives the real engine through its public API (createGame,
// getValidActions, applyAction, getBlockReason, scoreGame) on a state built by createGame
// and adjusted by hand (tests/pr2e/rig.mjs).
//
// A `knownFailure` is a check of a rule the engine breaks: it is expected to fail, is
// listed in the output, and keeps the suite green; when the engine is fixed it turns the
// suite red until it is moved to `check`. A skip marks a rule that cannot be tested
// through the public API, or whose wording is ambiguous.
//
// Output: one line per failed check, one per known failure, then
//   rules-audit-pr2e: N/N checks passed (K known failures, S skipped)
// Exit code 0 only if every check passed. AUDIT_LIST=1 prints every check id.
//
// The checks live in tests/rules-audit-pr2e/part-*.mjs; kit.mjs holds the runner and helpers.

import { finish } from '../rules-audit-pr2e/kit.mjs';
import part1 from '../rules-audit-pr2e/part-1.mjs';
import part2 from '../rules-audit-pr2e/part-2.mjs';
import part3 from '../rules-audit-pr2e/part-3.mjs';
import part4 from '../rules-audit-pr2e/part-4.mjs';
import part5 from '../rules-audit-pr2e/part-5.mjs';
import part6 from '../rules-audit-pr2e/part-6.mjs';
import part7 from '../rules-audit-pr2e/part-7.mjs';
import part8 from '../rules-audit-pr2e/part-8.mjs';
import untestable from '../rules-audit-pr2e/untestable.mjs';

part1(); // P1 to P4: terms, components, setup, turn structure
part2(); // P5 to P7: the action grid, collecting, the player board
part3(); // P8 to P12: hiring, board activation, Congress, hats, upgrades
part4(); // P13 to P14: the map and the Lay Track action
part5(); // P15 to P17: trains, buildings and carriages, tolls
part6(); // P18 to P21: goals, the end, final scoring, variants and constants; worked examples E1 to E8
part7(); // random play against independent oracles and invariants
part8(); // lay legality against an exhaustive path search
untestable(); // the rules that cannot be tested, with reasons

finish();
