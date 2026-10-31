# Pacific Rails, second edition - rules conformance audit

- Date: 31/10/2026. The checks were written from the ruleset's rules text; the engine's own suites were read only to learn how to drive the API. The rules text itself is not part of this repository; rule numbers (`P14.6`) refer to it, and only short descriptions in my own words are given here.
- Subject: `src/engine-pr2e/` (ruleset id `pr2e`) against that rules text.
- Suite: `tests/pr2e/rules-audit-pr2e.test.mjs`; the checks are in `tests/rules-audit-pr2e/part-1.mjs` to `part-9.mjs`, the runner and set-up helpers in `kit.mjs`, and the rules that cannot be tested in `untestable.mjs`. The suite is found and run by `tests/run-all.mjs` (`npm test`).
- Result when the audit was written: `368/368 checks passed (3 known failures, 17 skipped)`. After the three fixes of section 6: `371/371 (0 known failures, 17 skipped)`. **Now, on route map v3 with the wild slot (section 10): `386/386 checks passed (0 known failures, 18 skipped)`.**

## 1. Verdict in one paragraph

The engine conforms to the rules text in everything the audit could reach, with **three small exceptions** (section 6; all three have since been fixed in the engine): with the simulator value `arrivalBuilding = optional` a zero-tile lay offers a way to skip the building although the rules say it always ends with one (P14.3.3 b, P21.1), and two constants that P21.2 names as data (`SETUP.housesPerPlayer`, `SUPPLY.senators`) are never read. Beyond the hand-built checks, the audit replays 24 random games (about 9,000 actions, every variant value) against an independent scorer for track VP, tolls, completion VP, buildings owed and carriages, and compares the lay actions on offer with an exhaustive search of all simple paths on the map in 900 random positions. Neither found a divergence. Expected values are the rules' own numbers, not read back from the engine.

## 2. Counts

| | |
|---|---|
| Rule heads covered by the audit (P1.1 to P21.2) | 130 |
| - with at least one check | 124 |
| - not testable, with a reason (section 5) | 6 |
| - not covered | 0 |
| Checks | 386 (all pass, 0 known failures, 0 failing) |
| - hand-built checks on rule numbers (P1 to P24) | 334 |
| - worked examples E1 to E9 (and variants of them) | 11 |
| - random-play checks against the oracles | 34 |
| - lay-legality checks against the exhaustive search | 7 |
| Untestable entries | 18 |

Checks per rule group: P1 18, P2 7, P3 12, P4 15, P5 26, P6 18, P7 13, P8 15, P9 10, P10 26, P11 8, P12 16, P13 9, P14 71, P15 7, P16 25, P17 12, P18 17, P19 16, P20 14, P21 18, P24 1; the worked examples E1 to E9 are counted apart (11 checks) and so is the random-play coverage check.

`AUDIT_LIST=1 node tests/pr2e/rules-audit-pr2e.test.mjs` prints every check id; `AUDIT_JSON=1` adds a machine-readable list.

## 3. Rule by rule

One row per numbered rule head. A check id with a suffix after `/` is one of several checks of that rule (a table row, a case, a variant value). `P10.1/K6` is the K6 column; `P14.6/own-telegraph` is one not-able case.

| Rule | What it covers | Checks | Check ids | Result |
|---|---|---|---|---|
| P1.1 | house: a player-board piece; leaving the board raises production | 1 | P1.1 | pass |
| P1.2 | railway station: a house that has left the board for a city | 1 | P1.2 | pass |
| P1.3 | telegraph station: scores VP when placed | 1 | P1.3 | pass |
| P1.4 | building means a railway or telegraph station; a district house is not one | 1 | P1.4 | pass |
| P1.5 | district: one of nine grid places, never a map place | 1 | P1.5 | pass |
| P1.6 | worker space: 12 between districts | 1 | P1.6 | pass |
| P1.7 | building site: 3 on each Collect district | 1 | P1.7 | pass |
| P1.8 | Coin is a resource kept in storage | 1 | P1.8 | pass |
| P1.9 | the metal resource is called Iron | 1 | P1.9 | pass |
| P1.10 | built tile versus laid tile | 1 | P1.10 | pass |
| P1.11 | building tiles and laying them are separate | 1 | P1.11 | pass |
| P1.12 | player board and carriages (the word) | 0 | - | not testable (section 5) |
| P1.13 | board activation (the word) | 0 | - | not testable (section 5) |
| P1.14 | specialist and Foreman (the words) | 0 | - | not testable (section 5) |
| P1.15 | city, start city, inland city | 1 | P1.15 | pass |
| P1.16 | route, slot and wild slot; a laid route belongs to nobody | 2 | P1.16, P1.16/wild | pass |
| P1.17 | train: moves only as part of a lay | 1 | P1.17 | pass |
| P1.18 | connected city = inland city with a building | 1 | P1.18 | pass |
| P1.19 | action bonus and M | 1 | P1.19 | pass |
| P1.20 | senator, Congress column, Financier action | 1 | P1.20 | pass |
| P1.21 | lay and path (the words) | 0 | - | not testable (section 5) |
| P1.22 | map of old words to new | 0 | - | not testable (section 5) |
| P2.1 | shared components and counts | 2 | P2.1, P2.1/specialists | pass |
| P2.2 | per-player components | 1 | P2.2 | pass |
| P2.3 | the player board layout | 2 | P2.3, P2.3/random-play | pass |
| P2.4 | which supplies are limited | 1 | P2.4 | pass |
| P2.5 | everything is open information | 1 | P2.5 | pass |
| P2.6 | what the page must show | 0 | - | not testable (section 5) |
| P3.1 | shared set-up steps (map, senators, upgrade tokens, specialists, goals) | 6 | P3.1.1, P3.1.2, P3.1.3, P3.1.5, P3.1.6, P3.1.7 | pass |
| P3.2 | player set-up table | 1 | P3.2 | pass |
| P3.3 | houses and the empty +1 space | 1 | P3.3 | pass |
| P3.4 | seat order | 1 | P3.4 | pass |
| P3.5 | train draft | 2 | P3.5, P3.5/after | pass |
| P3.6 | first turn | 1 | P3.6 | pass |
| P4.1 | continuous turns, no rounds | 1 | P4.1 | pass |
| P4.2 | the steps of a turn | 1 | P4.2 | pass |
| P4.3 | no passing | 1 | P4.3 | pass |
| P4.4 | which actions can be chosen | 5 | P4.4/1, P4.4/2, P4.4/3, P4.4/4, P4.4/3/oracle | pass |
| P4.5 | place or remove in any order | 1 | P4.5 | pass |
| P4.6 | the decisions asked and the forced ones applied | 4 | P4.6, P4.6/auto, P4.6/not-decisions, P4.6/random-play | pass |
| P4.7 | a lay is built one route at a time; no dead ends offered | 2 | P4.7, P4.7/oracle | pass |
| P5.1 | the nine districts | 4 | P5.1, P5.1/collect, P5.1/special, P5.1/board-activation | pass |
| P5.2 | worker spaces and centres | 2 | P5.2, P5.2/random-play | pass |
| P5.3 | placing a worker | 1 | P5.3 | pass |
| P5.4 | removing a worker (centre rule, no-action case) | 4 | P5.4, P5.4.1, P5.4.3, P5.4.4 | pass |
| P5.5 | displacement and hat compensation | 6 | P5.5.1, P5.5.2, P5.5.3, P5.5.3/three, P5.5.4, P5.5.5 | pass |
| P5.6 | adjacency | 1 | P5.6 | pass |
| P5.7 | action bonuses and M | 4 | P5.7/1, P5.7/2, P5.7/3, P5.7/4 | pass |
| P5.8 | what a bonus does for each action | 4 | P5.8/collect, P5.8/board, P5.8/lay, P5.8/hire | pass |
| P6.1 | the Collect districts | 1 | P6.1 | pass |
| P6.2 | production from houses removed | 1 | P6.2 | pass |
| P6.3 | yield formula (all terms add) | 2 | P6.3, P6.3/example | pass |
| P6.4 | collected items go to storage | 1 | P6.4 | pass |
| P6.5 | the printed Collect example | 1 | P6.5 | pass |
| P6.6 | district houses | 6 | P6.6/1, P6.6/2, P6.6/3, P6.6/4, P6.6/5, P6.6/random-play | pass |
| P6.7 | the four special actions | 6 | P6.7/D1, P6.7/D3, P6.7/D7, P6.7/D9, P6.7/once, P6.7/impossible | pass |
| P7.1 | starting board | 1 | P7.1 | pass |
| P7.2 | storage capacity | 2 | P7.2, P7.2/random-play | pass |
| P7.3 | what takes storage | 1 | P7.3 | pass |
| P7.4 | carriages | 1 | P7.4 | pass |
| P7.5 | carriage order and filling order | 2 | P7.5, P7.5/random-play | pass |
| P7.6 | overflow and discarding | 4 | P7.6, P7.6/items, P7.6/other-player, P7.6/random-play | pass |
| P7.7 | paying from storage | 2 | P7.7, P7.7/random-play | pass |
| P8.1 | the hire action and M hires | 1 | P8.1 | pass |
| P8.2 | when a hire is possible | 3 | P8.2/1, P8.2/2, P8.2/3 | pass |
| P8.3 | leftmost empty space | 2 | P8.3, P8.3/random-play | pass |
| P8.4 | carriage 3 VP on hiring | 1 | P8.4 | pass |
| P8.5 | Tycoon Mode costs | 6 | P8.5/crew, P8.5/miner, P8.5/engineer, P8.5/financier, P8.5/default, P8.5/free | pass |
| P8.6 | hired specialists stay | 2 | P8.6, P8.6/random-play | pass |
| P9.1 | the Foreman acts as the district type | 1 | P9.1 | pass |
| P9.2 | the step list | 1 | P9.2 | pass |
| P9.3 | what each step does | 5 | P9.3/crew, P9.3/miner, P9.3/engineer, P9.3/skip, P9.3/overflow | pass |
| P9.4 | fixed order, gains pay later steps | 2 | P9.4, P9.4/skipped | pass |
| P9.5 | built tiles wait in storage | 1 | P9.5 | pass |
| P10.1 | the eight columns and the Reset | 10 | P10.1/table, P10.1/K1, P10.1/K2, P10.1/K3, P10.1/K4, P10.1/K5 and 4 more | pass |
| P10.2 | one Financier action | 4 | P10.2/1, P10.2/2, P10.2/3, P10.2/one-per-step | pass |
| P10.3 | rewards in detail (K4 hats, K5, K6, K7, K8) | 11 | P10.3/1, P10.3/2, P10.3/3, P10.3/3-neither, P10.3/3-production, P10.3/4 and 5 more | pass |
| P10.4 | Coins pay, unaffordable steps skipped | 1 | P10.4 | pass |
| P11.1 | hat holding limit and overflow | 3 | P11.1, P11.1/other, P11.1/random-play | pass |
| P11.2 | spending hats | 3 | P11.2, P11.2/later, P11.2/every-action | pass |
| P11.3 | sources of hats | 1 | P11.3 | pass |
| P11.4 | hats score nothing | 1 | P11.4 | pass |
| P12.1 | the 20 upgrade tokens | 1 | P12.1 | pass |
| P12.2 | installing a token | 9 | P12.2/1, P12.2/2, P12.2/3, P12.2/4, P12.2/4b, P12.2/5 and 3 more | pass |
| P12.3 | replacing a token | 2 | P12.3, P12.3/item4 | pass |
| P12.4 | when a token works | 2 | P12.4, P12.4/once | pass |
| P12.5 | permanence | 2 | P12.5, P12.5/random-play | pass |
| P13.1 | the network: 35 cities, 65 routes, 134 slots by kind (46 Ground, 44 Tunnel, 41 Bridge, 3 wild); start cities with a 1-slot and a 3-slot route; at most one wild slot per route | 1 | P13.1 | pass |
| P13.2 | start cities | 4 | P13.2, P13.2/no-building, P13.2/vp, P13.2/ordinary | pass |
| P13.3 | inland cities | 1 | P13.3 | pass |
| P13.4 | routes: laid whole, once | 2 | P13.4, P13.4/random-play | pass |
| P13.5 | the three states of an inland city | 1 | P13.5 | pass |
| P14.1 | M lays per action | 3 | P14.1, P14.1/stop, P14.1/oracle | pass |
| P14.2 | the path | 5 | P14.2/1, P14.2/2, P14.2/3, P14.2/mix, P14.2/1/oracle | pass |
| P14.3 | a legal lay (tiles including the tile of any type each wild slot needs, ending, shape, connection) | 13 | P14.3/2, P14.3/2-wild, P14.3/3a, P14.3/3b, P14.3/3b-score, P14.3/4-path and 7 more | pass |
| P14.4 | a path ends at a city | 1 | P14.4 | pass |
| P14.5 | resolution order of a lay | 7 | P14.5/order, P14.5/1, P14.5/2, P14.5/2b, P14.5/4, P14.5/5 and 1 more | pass |
| P14.6 | the compulsory arrival building | 22 | P14.6/both-possible, P14.6/railway-only, P14.6/telegraph-only, P14.6/no-houses, P14.6/no-telegraph, P14.6/own-telegraph and 16 more | known failure (section 6) |
| P14.7 | track VP by scoring city (a wild slot scores like any slot) | 9 | P14.7/2, P14.7/1, P14.7/1b, P14.7/4, P14.7/start-stop, P14.7/3, P14.7/2-wild and 2 more | pass |
| P14.8 | a laid route is only travelled over | 1 | P14.8 | pass |
| P14.9 | filling wild slots: asked when the lay ends, one decision per slot in path order, only when two or more kinds are spare; legality; what is recorded; `wildSlotTerrain` changes nothing; saved mid-decision | 11 | P14.9/1-when, P14.9/1-travelled, P14.9/2-legality, P14.9/3-frame, P14.9/3-order, P14.9/4-auto, P14.9/5-record, P14.9/6-terrain, P14.9/save, P14.9/random-play, E9 | pass |
| P15.1 | two trains each | 1 | P15.1 | pass |
| P15.2 | trains move only in a lay | 2 | P15.2, P15.2/zero-tile | pass |
| P15.3 | trains share cities | 1 | P15.3 | pass |
| P15.4 | travelling over anyone's track | 1 | P15.4 | pass |
| P15.5 | a stranded train | 2 | P15.5, P15.5/oracle | pass |
| P16.1 | where buildings go; different owners | 4 | P16.1/inland, P16.1/one-each, P16.1/different-owners, P16.1/random-play | pass |
| P16.2 | placing a railway station | 2 | P16.2/1-3, P16.2/4-5 | pass |
| P16.3 | placing a telegraph station | 4 | P16.3/row, P16.3/none-left, P16.3/1, P16.3/random-play | pass |
| P16.4 | every way onto the map | 1 | P16.4 | pass |
| P16.5 | carriages for railway stations placed by Lay Track | 11 | P16.5/1, P16.5/2, P16.5/3, P16.5/4, P16.5/free, P16.5/telegraph-instead and 5 more | pass |
| P16.6 | buildings are permanent | 2 | P16.6, P16.6/random-play | pass |
| P16.7 | running out of pieces | 1 | P16.7 | pass |
| P17.1 | the toll | 4 | P17.1, P17.1/two-buildings, P17.1/same-owner-two-cities, P17.1/random-play | pass |
| P17.2 | toll details | 7 | P17.2/1, P17.2/2, P17.2/3, P17.2/4, P17.2/5-zero, P17.2/5-completion and 1 more | pass |
| P18.1 | goals in play | 1 | P18.1 | pass |
| P18.2 | the twelve goals | 14 | P18.2/table, P18.2/1, P18.2/2, P18.2/3, P18.2/4, P18.2/5 and 8 more | pass |
| P18.3 | scoring a goal, ties | 2 | P18.3, P18.3/2p | pass |
| P19.1 | the end trigger | 4 | P19.1, P19.1/negative, P19.1/checked-after-every-lay, P19.1/random-play | pass |
| P19.2 | completion VP (a wild slot counts) | 5 | P19.2/once, P19.2/second-lay, P19.2/whole-lay, P19.2/wild, P19.2/random-play | pass |
| P19.3 | finishing the round | 4 | P19.3/rest-of-action, P19.3/equal-turns, P19.3/last-seat, P19.3/random-play | pass |
| P19.4 | play after the trigger | 1 | P19.4 | pass |
| P19.5 | no other end; the turn limit | 1 | P19.5 | pass |
| P19.6 | end reasons | 1 | P19.6 | pass |
| P20.1 | VP by source | 2 | P20.1, P20.1/random-play | pass |
| P20.2 | final scoring | 3 | P20.2/order, P20.2/nothing-else, P20.2/random-play | pass |
| P20.3 | the building table | 4 | P20.3/table, P20.3/play, P20.3/check, P20.3/random-play | pass |
| P20.4 | winner and tie-breaks | 5 | P20.4/1, P20.4/2, P20.4/3, P20.4/vp, P20.4/random-play | pass |
| P21.1 | the eight variants | 5 | P21.1/table, P21.1/rejects, P21.1/tycoonMode, P21.1/hatOverflow, P21.1/maxTurns | pass |
| P21.2 | tuning constants are data | 13 | P21.2/more-data, P21.2/carriages, P21.2/tollVp, P21.2/track-vp, P21.2/goalVp, P21.2/storage and 7 more | known failure (section 6) |

## 4. Variants and worked examples

Every value of every variant of P21.1 is covered by at least one check, and the random games of part 7 play every value as well.

| Variant | Value | Checks |
|---|---|---|
| tycoonMode | false | P8.5/default, P21.1/tycoonMode |
| tycoonMode | true | P8.5/crew, P8.5/miner, P8.5/engineer, P8.5/financier, P8.2/3, P16.5/tycoon-free, P21.1/tycoonMode, E7 |
| layShape | path | P14.3/4-path, P14.2/mix, E3 |
| layShape | one-new-route | P14.3/4-one-new-route, E3/variants |
| layShape | adjacent-only | P14.3/4-adjacent-only, E3/variants |
| newConnectionRule | any-unlaid-route | P14.3/5-any |
| newConnectionRule | must-join-unjoined | P14.3/5-must-join, P14.3/5-before-this-lay |
| arrivalBuilding | compulsory-if-able | P14.6/* (all able and not-able cases), P14.6/random-play |
| arrivalBuilding | optional | P14.6/optional, P14.6/optional-zero-tile (known failure) |
| upgradePlacement | first-free | P12.2/4, P12.3/item4 |
| upgradePlacement | any-carriage | P12.2/4b |
| hatOverflow | resource | P10.3/2, P11.1/other, P21.1/hatOverflow |
| hatOverflow | lost | P21.1/hatOverflow |
| maxTurnsPerPlayer | 0 to 500, default 80 | P19.5, P21.1/maxTurns, P21.1/rejects |
| wildSlotTerrain | tile-terrain (default), no-terrain | P14.9/6-terrain (both values play the same game), P21.1/table |

Worked examples: `E1`, `E2`, `E3`, `E3/variants`, `E3/stop`, `E4`, `E5`, `E6`, `E7`, `E8`, `E9` (the wild-slot example, in part 9). E3, E4, E5 and E8 were redone for route map v3. Each is replayed through the real actions on the real map. One note: in E2 the upgrade token's Wood is taken by the engine at once when its step comes up (the step asks nothing), so the in-between storage figure of 8 of 9 after the second Financier action cannot be observed; the check asserts the following state (9 of 9, Engineer next) instead.

The special-attention areas of the brief, and where they are checked: lays (P14.1 to P14.5, `P14.3/*`, `P4.7`, `P14.3/oracle`); path lays and travel over laid track (`P14.2/mix`, `P14.7/1b`, `P15.4`); zero-tile lays (`P14.3/3b`, `P14.3/3b-score`, `P15.2/zero-tile`, `P16.5/zero-tile`); track VP by scoring city (`P14.7/*`, E3, `P14.7/random-play`); the completion bonus (`P14.5/2`, `P19.2/*`, `P19.1` for all 16 west-east pairs); the arrival building and every "able" case (`P14.6/*`, E8); tolls and several buildings in one city (`P17.*`); carriages only from Lay Track railway stations (`P16.5/*`); displacement and hat compensation (`P5.5/*`, E6); additive action bonuses and extra hires (`P5.7/*`, `P5.8/*`, `P6.3`, `P8.1`); every Congress column, the Reset, K5 and K7 placement (`P10.1/*`, `P10.2/*`, `P10.3/*`, E2); upgrade placement and yields (`P12.*`); all 12 goal metrics and ties (`P18.2/1` to `P18.2/12`); the building table (`P20.3/*`); tie-breaks (`P20.4/*`).

## 5. Rules that cannot be tested, and why

- **P0** how to read the document: notes on numbering, tags and fonts; no behaviour.
- **P1.12** player board (the word): a definition; its parts are checked under P2.3, P7.2 and P7.4.
- **P1.13** board activation (the word): a definition; the behaviour is checked under P9.2 and P9.3.
- **P1.14** specialist, Foreman (the words): a definition; checked under P9.1, P9.2 and P18.2/exclusions.
- **P1.21** lay, path (the words): a definition; checked under P14.2 and P14.3.
- **P1.22** terminology map: a table of old and new words; the engine's own text is only scanned for the two forbidden words (P1.9).
- **P2.6** components the UI must show: an inventory for the page and the artwork; not engine behaviour.
- **P3.1.4** tiles, resources, hats and carriages go in the general supply: the engine keeps no supply for them (P2.4), so there is no state to read.
- **P4.2/step-4** end of turn: checked under P19.3 (equal turns, game end after the last seat).
- **P9.3/refusal** a Crew, Miner or Engineer step may be used only if its cost can be paid: an unpayable step is skipped by the engine itself, so no decision is ever asked in which a refusal could be observed; that the skip happens is checked under P9.3/crew and P10.4.
- **P13.1/data** the 65 routes and their terrains match the route table of the map file: the table the rule points to is not available to this audit; the counts (35 cities, 65 routes, 134 slots by kind: 46 Ground, 44 Tunnel, 41 Bridge, 3 wild), the start-city roles, the wild routes and the structural facts are checked.
- **P19.5/stop-timing** the turn limit stops a game in which any player has taken the limit: the wording does not say whether the game stops at once or at the end of the round; the checks only require the end reason turn-limit and that nobody exceeds the limit.
- **P21.2/SUPPLY.hats** SUPPLY.hats, SUPPLY.trackTilesPerType, SUPPLY.resourcesPerType: the rules say these are for display only and never enforced, so changing them has no observable effect.
- **P14.9/7** what a bot sees and keeps for a wild slot: a note for the bot writer; the bots are tested in `tests/pr2e/bots-pr2e.test.mjs`, not here.
- **P22** worked examples: checked as E1 to E9.
- **P23** where the network changes the feel: commentary, not rules.
- **P24** differences from the earlier engine: a note for the programmer; the dropped systems are checked under P24.4, the changed ones under their own rules.
- **P25** source disagreements: commentary, not rules.

## 6. Failures (engine against the rules)

**Status: all three are fixed in the engine** (a zero-tile lay always ends with a building; the house and senator counts are read from their constants), and the three checks now pass as ordinary checks, so the suite reports 0 known failures. What follows is the record of what the audit found, as written. These checks were kept in the suite as `knownFailure`: they ran, were expected to fail, were listed on every run, and the suite stayed green; when the engine was fixed the check passed and the suite went red until it was moved to `check`, so a fix could not go unnoticed. The engine was not changed by the audit itself.


### F1. `P14.6/optional-zero-tile` - skipBuilding after a zero-tile lay (P14.3.3 b, P14.6.1, P21.1 row 4)

- Expected: with `arrivalBuilding = optional` the building after an ordinary lay may be skipped, but a zero-tile lay (a lay that lays nothing and ends in an unbuilt inland city) always ends with a building, whatever the value. `skipBuilding` must not be offered and must be refused.
- Actual: the building decision is pushed with `optional: state.variants.arrivalBuilding === 'optional'` whatever the lay was (`src/engine-pr2e/actions.js`, step 6 of the lay's resolution), so after a zero-tile lay `skipBuilding` is offered and accepted. The lay then moves the train and pays tolls but places nothing, a position the rules say cannot arise.
- Evidence: 3 players; (found on the old map, where Seattle - Spokane was a route; not re-run on route map v3) Anna's train on Seattle, Seattle - Spokane already laid, no built tiles, `arrivalBuilding = optional`; Anna places on W4 and chooses Lay Track; the engine makes the only lay (a zero-tile lay to Spokane); the decision on top is `placeBuildings` with `optional: true`, `getValidActions` lists `skipBuilding`, and `applyAction` accepts it.
- Reach: only the simulator value `optional`; the ruled default is not affected. Suggested fix: push the decision with `optional` true only when the lay laid at least one route.

### F2. `P21.2/housesPerPlayer` - a named constant that is never read

- Expected: P21.2 lists `SETUP.housesPerPlayer` (11) as data that balance work can change in one place.
- Actual: the number is not read anywhere; a player's 11 houses come from 4 tracks of 3 spaces less the one left empty (`PLAYER_BOARD.houseSlotsPerTrack`). `--const.SETUP.housesPerPlayer=10` changes nothing.
- Evidence: `createGame` with `constants: { SETUP: { housesPerPlayer: 10 } }` still gives 11 houses on every board.
- Severity: low (the number is redundant with the track layout); the engine is right at the default.

### F3. `P21.2/senators` - a named constant that is never read

- Expected: P21.2 lists `SUPPLY.senators` (8) as data.
- Actual: the senators are the Congress columns (`CONGRESS.columns`); `SUPPLY.senators` is not read. `constants: { SUPPLY: { senators: 6 } }` still gives 8.
- Severity: low; a change of the panel is made through `CONGRESS.columns`, which is read (`P21.2/congress-columns`).

## 7. Observations on the rules text and on the engine's interface

These are not failures; each is a place where the text can be read two ways or the interface is looser than the text.

1. **Turn limit (P19.5).** The rule says a game stops when any player has taken `maxTurnsPerPlayer` turns; it does not say whether it stops at once or at the end of the round. The checks accept either (reason `turn-limit`, nobody over the limit).
2. **The building table's last row (P20.3).** The table runs to 18 buildings and P20.3 says a player has 18 possible buildings (11 houses, 7 telegraph stations). On this map a player can hold at most 17: one building per inland city (there are 17), because P16.1 stops one player owning both buildings of a city. The row for 18 cannot be reached. The check covers 0 to 17 by play and the whole table as data.
3. **`isLegalLay(state, playerId, cities, routes)`.** The exported read does not check that the path meets P14.2 (it starts on a train, uses printed routes, repeats no city); it judges tiles, shape, connection rule and the ending. The actions `startLay` and `extendPath` do enforce P14.2, so play is correct (`P14.2/1` to `P14.2/3` go through the actions), but a caller that passes a malformed path to `isLegalLay` is told it is legal.
4. **Names of the setup decisions (P4.6).** The rules name the draft decision `setupTrain` and its action `placeTrain`; the engine keeps `setupRailhead` and `placeRailhead`, which the rules allow code to keep. The checks use the engine's names.
5. **A lone legal answer is applied by the engine (P4.6).** Several checks therefore assert the outcome (for example the telegraph station placed in a city where only that kind is possible) instead of a pending decision. That is the rule, not a gap.

## 8. How the audit was shown to bite

Four deliberate breaks were made on a scratch copy of the repository (not in this tree), the suite run, and each break reverted:

| Break | Checks that failed |
|---|---|
| Toll 3 VP changed to 4 (`MAP_RULES.tollVp`) | 16: `P17.1`, `P17.1/two-buildings`, `P17.1/same-owner-two-cities`, `P17.2/2`, `P17.2/5-zero`, `P17.2/5-completion`, `P14.5/4`, `P14.3/3b-score`, `P14.7/1`, `P14.7/1b`, `P15.4`, `E3`, `E3/stop`, `E4`, `E8`, `P17.1/random-play` |
| K6 gives 3 resources instead of 4 | 2: `P10.1/K6`, `E2` |
| The arrival-building test ignores the player's own telegraph station | 6: `P14.6/own-telegraph`, `P14.7/2`, `P14.7/3`, `P16.1/different-owners`, `E8`, and the lay-legality search (`oracle/crash`) |
| A start city is not a scoring stop | 2: `P14.7/start-stop`, `P14.7/random-play` |

## 9. Running it

```
node tests/pr2e/rules-audit-pr2e.test.mjs        # the audit: about 3 seconds
node tests/run-all.mjs                            # every suite, the audit included (npm test)
node tests/qa/sweep.mjs                           # the public-repository sweep
```

The audit is permanently green. A red line is a regression: fix the engine, not the check, unless the rules themselves changed (then change the check and say so here).

## 10. Route map v3 and the wild slot (31/10/2026)

The map changed from the 25-city, 47-route map to route map v3 (35 cities, 65 routes of 1 to 4 slots, 134 slots: 46 Ground, 44 Tunnel, 41 Bridge and 3 wild), and a lay can now include **wild slots** (P1.16, P14.3 item 2, P14.9): a slot that takes one built tile of any terrain. What changed in the audit:

- **Every check that named a city or route of the old map was redone** on the new one (parts 1 to 6): the fixtures are Seattle - Yakima (one Tunnel) for the simple lay and arrival-building cases, Seattle - The Dalles - Spokane for the longer paths, and Bismarck - Fargo - Minneapolis (with Seattle to Bismarck laid) for the completing lay; the counts are 35 / 27 / 65 / 134 and the worked examples E3, E4, E5 and E8 follow the rules text's versions on map v3. Check ids and what each rule check asserts did not change, except where a count is the rule's own (P1.15, P2.1, P13.1, P13.3, P16.1/inland).
- **Part 9 is new** (14 checks): the wild slot as a kind of slot and not of tile (`P1.16/wild`), the payment test (`P14.3/2-wild`: a path of G-G and T-B-W needs a fifth tile of any terrain), when the player is asked (`P14.9/1-when`: nothing of the resolution happens before the last answer; `P14.9/1-travelled`: a wild route only travelled over is not asked about), legality and the block reason (`P14.9/2-legality`), the frame and the action (`P14.9/3-frame`, `P14.9/3-order`: path order, the slot counted from the route's first city, no stop action), the engine applying a forced answer (`P14.9/4-auto`), what is recorded (`P14.9/5-record`: `map.wildFill`, the `routeLaid` cost and `wild`, the `lay` summary), `wildSlotTerrain` (`P14.9/6-terrain`: both values play the same game), a save taken mid-decision (`P14.9/save`), that a wild slot scores like any slot (`P14.7/2-wild`) and counts for the completion VP (`P19.2/wild`), and the worked example `E9`.
- **Random play (part 7)** gained `P14.9/random-play`: for every lay the tiles that leave the player's storage equal the tiles on the slots laid, the `routeLaid` cost sums to the route's length, every wild slot has its fill, a `wildSlot` decision never reaches the player with fewer than two answers, and `fillWildSlot` is never offered for a terrain the player does not hold. The 24 games lay 7 routes with a wild slot (printed in the check's title; `AUDIT_STATS=1` prints the counters of parts 7 and 8).
- **The lay oracle (part 8)** knows the wild slots (a path is payable when the fixed slots are paid by terrain and enough tiles of any kind are left over, written from the rules text, not from the engine) and its coverage check now requires 50 path steps beside an unlaid wild route (168 are compared).
- **Untestable**: `P14.9/7` (what a bot sees and keeps for a wild slot) is a note for the bot writer; the bots are tested in `tests/pr2e/bots-pr2e.test.mjs`. `P13.1/data` now speaks of 65 routes and 134 slots by kind.

Nothing in the engine failed an audit check on the new map once the checks were redone: the wild slot, the payment test and the decision were written first and the audit then confirmed them (including the exhaustive-search oracle in 900 random positions). Two things the audit cannot see are listed in the rules text's own notes: the choice of fill matters only for what stays in storage in this ruleset, and the map's 30 routes without a drawn black line are a matter for the page.

