# Continental Rails - engine to-do

- Status on 11/10/2026, against the designer's rules text and `docs/engine-contract.md`. Rule numbers (`R11.5.4`) refer to that rules text, which is not part of this repository.

## Nothing outstanding

Every numbered rule of the spec is carried out by the engine, and every module is controlled by its variant switch (off means no key in `state.modules`, no VP source, no action, no event, no decision). The four add-on modules are all complete:

- carriage upgrades: R3.8.1, R7.3, R15.1 to R15.6 (the `upgradeVpTiming` variant included);
- goals and milestones: R3.8.2, R16.1 to R16.9, with `describeProgress`;
- Legislative Agenda: R3.8.3, R6.4.1, R17.1 to R17.3 (all 20 cards);
- Pony Express: R3.8.4, R4.4, R4.8.5, R4.8.6, R6.4.2, R8.6.4, R18.1 to R18.10 (all 38 cards), R20.1 and R20.2.2 / R20.2.3 for the module sources.

What a reader should know before relying on a number:

- A game with the default variants has **all four modules on** (milestones, not goals). The core suites build their games with every module off so that they test the core alone (`MODULES_OFF` in `tests/helpers/rig.mjs`).
- Where the rules text was silent or could be read two ways the engine took the narrowest reading and recorded it in `docs/engine-contract.md` section 20. None changes a rule; each can be turned the other way in one place.
- The builder (`tests/helpers/builder.mjs`) plays the module decisions greedily; the smoke suite hands tokens out by hand in some of its builder games so that the 5-token rank C cards are bought, and says so ("constructed").

## What each suite covers

| Suite | Covers |
|---|---|
| `contract` | The promises of the contract: the loop, the list equals the legal actions, block reasons are sentences, an illegal action leaves the state untouched, the bots, worked examples E1, E3, E4, E9. |
| `determinism` | Same seed, same game; replay; bot randomness never touches the game's; `hashState` (every module field is in it); `determinise` (the three Pony Express decks and nothing else). |
| `purity` | State is plain JSON at every decision, also with every module on and with every decision the modules add; `cloneState`; no impure call in `src/engine` or `src/bots`; import direction; LF. |
| `variants` | The 25 variants, their rejection messages, constants overrides, a module that is off leaves no trace in a fresh state. |
| `rules-data` | Shape, counts and vocabulary of every table in `rules.js`; the map; the printed values of R21.4. |
| `data-integrity` | The module data against the module code: unique ids, every metric known to the interpreter, every effect type / trigger / modifier handled, JSON round trip, no milestone claimable and no goal with a leader on a fresh board. |
| `rules-core` | The core rules R4.6 to R13, R19, R20 and worked examples E5 to E8, E10. |
| `rules-modules` | A behavioural check for every upgrade tile, every goal and milestone metric, every Legislative Agenda card, every Pony Express card and effect type, the free-action opportunities, the cap, the once-per-round cards in both turn structures, worked examples E2 and E5 with its real tile; it also asserts that every effect handler, card effect, module action and module event ran. |
| `smoke` | Whole games: 600 + 400 random games with the modules on, 100 with each module off, the variant runs, 6 games with each Legislative Agenda card fixed, builder games, the usage counters, the core unaffected by a module that is on or off. |

## Rules with nothing to implement

R0 (how to read the spec), R1 (terminology: enforced by identifiers), R2.1 to R2.3 (components: counts are in `rules.js`), R6.7 and R11.7 (older rules that were removed), R19.6 (after the trigger everything works normally: true by construction), R21.1 and R21.2 (defaults; two players have no special rule), R22 (worked examples: all ten are tests - E1, E3, E4, E9 in `contract.test.mjs`, E5 to E8 and E10 in `rules-core.test.mjs`, E2 and E5 with its real tile in `rules-modules.test.mjs`), R23 (material that is out), R24 (standing assumptions).
