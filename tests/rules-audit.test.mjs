// rules-audit.test.mjs - independent rules conformance audit (11/10/2026).
//
// SEMANTICS: this suite is PERMANENTLY GREEN. Every check is named for the rule of
// rules spec v2 it tests (`R11.5.4`; a suffix after "/" separates several checks of
// one rule; `R15.2/U1-vp`, `R17.3/7`, `R18.7/26` are rows of the data tables; `E1`
// to `E10` are the worked examples of R22). A red line is a REGRESSION: the engine
// has drifted from the spec. Fix the engine, not the check - unless the spec itself
// changed, in which case change the check and say so in docs/rules-audit-report.md.
//
// The checks were written from the wording of the spec, not from the engine and not
// from the implementers' suites (contract, rules-core, rules-modules). Expected
// values are the spec's own numbers. Each check drives the real engine through its
// public API (createGame, getValidActions, applyAction, getBlockReason, scoreGame)
// on a state built by createGame and adjusted by hand.
//
// A skipped check marks a place where the SPEC is ambiguous or contradicts itself;
// the engine was left as it is and the question is listed for the designer in
// docs/rules-audit-report.md.
//
// Output: one line per failed check, then
//   rules-audit: N/N checks passed (S skipped)
// Exit code 0 only if every check passed. AUDIT_LIST=1 prints every check id.
//
// The checks live in tests/rules-audit/part-*.mjs (one file per group of spec
// sections) so that no file is unmanageably long; tests/rules-audit/kit.mjs holds
// the runner and the set-up helpers.

import { finish } from './rules-audit/kit.mjs';
import part1 from './rules-audit/part-1.mjs';
import part2 from './rules-audit/part-2.mjs';
import part3 from './rules-audit/part-3.mjs';
import part4 from './rules-audit/part-4.mjs';
import part5 from './rules-audit/part-5.mjs';
import part6 from './rules-audit/part-6.mjs';

part1(); // R1 to R5: terms, components, setup, turn structure, the action grid
part2(); // R6 to R10: gathering, bonus actions, the train, train activation, Lobby Congress
part3(); // R11 to R14: the map, Lay Tracks, Move Train, buildings, cowboy hats
part4(); // R15 to R18: carriage upgrades, goals and milestones, Legislative Agenda, Pony Express
part5(); // R19 to R23: game end, final scoring, variants, worked examples E1 to E10
part6(); // static audits: terminology, tuning numbers, the data tables of the spec

finish();
