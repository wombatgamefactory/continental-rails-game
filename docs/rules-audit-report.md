# Continental Rails - rules conformance audit

- Date: 11/10/2026. The checks were written from the designer's rules text before any engine code or existing test was read. The rules text itself is not part of this repository; rule numbers (`R11.5.4`) refer to it.
- Subject: `src/engine/` against that rules text.
- Suite: `tests/rules-audit.test.mjs` (checks in `tests/rules-audit/part-1.mjs` to `part-6.mjs`, runner and helpers in `kit.mjs`, the spec's data tables in `spec-tables.mjs`).
- Result: `rules-audit: 476/476 checks passed (6 skipped)`. `npm test`: 11 suites, 0 failed; smoke 2,934 random games, 0 refusals.

## 1. Verdict in one paragraph

The engine conforms to the spec. Written from the spec's wording, 476 checks found **no rule that the engine plays differently from the spec**. The audit found two tuning numbers written as bare literals in logic, one loose word in a player-facing label, and several constants that are named but never read; the first three are fixed. Six places where the rules text itself can be read two ways are left as the engine has them (their checks are skipped, with the reason). Four small engine additions made during the audit are in and checked.

## 2. Counts

| | |
|---|---|
| Numbered rule heads in the spec (`R1.1` to `R23.1`) | 166 |
| Of those, rules that describe behaviour | 157 (the other 9 are definitions of words or records of what was removed: R1.1, R1.2, R1.3, R1.4, R1.5, R1.9, R6.7, R11.7, R23.1) |
| Rule heads with at least one check under their own number | 166 of 166 (the 9 non-behavioural ones have a static or a "nothing happens" check) |
| Checks written | 476 |
| - on rule heads and their numbered steps | 314 |
| - on rows of data tables (`R15.2/U1-vp`, `R16.5/4`, `R16.8/MS7`, `R17.3/20`, `R18.7/26`, `R21.3/claimFrom`, `R8.6.3/crew`, `R8.8/2:1`, `R20.3/rising`, `R6.4.1/11`) | 137 |
| - whole-table comparisons against the spec (`A.1`, `A.2`, `A.3`, `R10.1/table`, `R15.2/table`, `R16.5/table`, `R16.8/table`, `R17.3/table`, `R18.7/table`, `R20.3/table`, `R21.3/table`) | 11 |
| - of which constant values, override probes and the literal scan (`R21.4`, `R21.4/...`) | 17 (included in the 314) |
| - worked examples `E1` to `E10` | 10 |
| - engine additions (`engine/...`) | 4 |
| Skipped (spec ambiguous) | 6 |

(314 + 137 + 11 + 10 + 4 = 476. `AUDIT_LIST=1 node tests/rules-audit.test.mjs` prints every id.)

## 3. Divergences found and fixed

No behavioural divergence from a rule was found. The table lists everything the audit changed in `src/engine/`.

| # | Rule | What the engine did | What the spec says | Fix | Files | Existing tests changed |
|---|---|---|---|---|---|---|
| 1 | R21.4, R18.7 card 33 | The doubling of card 33 was a bare `times * 2` in `pushTrainActivation`; the card's own `activationMultiplier` value (2) in `rules.js` was never read. | R21.4: tuning numbers are named data, "not bare numbers", so balance work can change them in one place. | `activationMultiplierValue(K)` reads the factor from the card data. Check `R21.4/card33` plays the card with the value set to 3. | `actions.js` | none |
| 2 | R21.4, R18.4 | `exchangeToken` gave a literal 1 resource; `PONY.resourcesPerToken` existed in `rules.js` and was never read. | As above. | The mutator reads `PONY.resourcesPerToken`. Check `R21.4/token`. | `actions.js` | none |
| 3 | R1.2, R1.4 (terminology) | The label of the Lay Tracks decision in network mode said "claim a route or place a station". | A map building is a railway station or a telegraph station; together, a building. | "claim a route or place a building". Check `R1.2` scans every string of the engine. | `legality.js` | none |

Additions made during the audit (not divergences):

| # | Change | Files | Check |
|---|---|---|---|
| 4 | `createGame` rejects a constant override of another kind than its default (number, string, boolean, object, array of the same length with entries of the same kind), naming the constant. Unknown names were already rejected. | `state.js` | `engine/constants-kind` |
| 5 | `turnEnd` is now the last event of a turn: after the end-of-turn milestone check and the end triggers (R4.2 step 6, R16.9), before `roundEnd`, final scoring and the next `turnStart`. Before, it was emitted ahead of the milestone check. Only the position of one event moved. | `actions.js` | `engine/turnEnd-last` |
| 6 | New event `bonusAction { player, district, bonus, free }` when a bonus action is taken (`district` is null and `free` true for Pony Express card 28). | `actions.js` | `engine/bonusAction-event` |
| 7 | "Add `turn` to `turnStart` and `turnEnd`": already there (`turn` = `state.turn.number`). Nothing changed; the contract now says what the field is. | - | `engine/turn-number` |

No exported function, action type, action parameter, frame kind or state field was renamed, removed or reshaped. `docs/engine-contract.md` records the changes in sections 10, 13 and 18.

No check of `contract`, `rules-core`, `rules-modules` or any other existing suite had to change.

## 4. Data tables against the spec

Every row was compared, mechanically: `tests/rules-audit/spec-tables.mjs` is a transcription of the spec's tables made by script from the spec file, and the `.../table` checks compare `rules.js` and the map with it.

| Table | Rows | Compared | Result |
|---|---|---|---|
| R8.6.3 hire costs | 12 cells | paid in play at each level | match |
| R8.8 recipes | 3 variants x 4 | paid in play | match |
| R10.1 Congress strip (default) | 7 | id, tier, Coin cost, numbers of the benefit; each entry taken in play | match |
| R10.1 `jan-2026` | 8 | tier, cost, each benefit taken in play | match |
| R15.2 upgrade tiles | 16 | id, level, name, text, effect; each tile run in an activation | match |
| R16.5 goals | 12 | number, name, direction, machine id; each measure on a constructed position | match |
| R16.8 milestones | 10 | id, name, VP, metric, bound; each claimed at its bound and not one short | match |
| R17.3 Legislative Agenda | 20 | number, name, event, filters, condition, numbers; each card in play | match |
| R18.7 Pony Express | 38 | number, rank, cost, name, kind, numbers, removals; each card in play | match |
| R20.3 building table | 2 x 19 | both rows, and scored at 0 to 18 buildings | match |
| R21.3 variants | 25 | name, type, allowed values, default; every allowed value accepted, neighbours rejected | match |
| R21.4 constants | every named row | value; 14 probes change one or more and watch the behaviour follow | match |
| Appendix A.1 cities | 25 | id, name, kind, routes, junction flag, region, y | match |
| Appendix A.2 routes | 47 | id, ends, slots, terrain in order, counts | match |
| Appendix A.3 facts | 8 | recomputed from the map | match |

One difference of form, not of content: the spec writes Pony Express card 20 as an event (`on: "congressEntryTaken", coinDiscount: 1`); `rules.js` keeps it as a cost modifier. The behaviour is the spec's (check `R18.7/20`).

## 5. Terminology

Searched: every identifier, string and comment of `src/engine/*.js` and `src/engine/data/route-map.js`.

- **Iron, never Steel.** No occurrence of "steel" in any case. Resource ids are `iron`, `wood`, `gunpowder`.
- **House.** The only words containing "house" are `house`, `houses`, `houseTrack`, `houseTracks`, `houseSlotsPerTrack`, `housesOnBoard`. Every player-facing string that says "house" is about the player board (house track, house slot, "no house left on your player board"). Nothing in `state.map` or `state.grid` is called a house.
- **Railway station / telegraph station.** Identifiers are `railwayStation`, `telegraphStation`. One player-facing string used "station" alone (fixed, divergence 3). "Station step" (the spec's own term, R11.11.5) and the card name "Station Network" are the only other uses.
- **District.** Grid locations are `district`, `D1` to `D9`, `districtTiles`. No "site".

Checks `R1.1`, `R1.2`, `R1.5`, `R1.9` keep this true.

## 6. Tuning numbers in logic

Method: the five logic files (`actions.js`, `legality.js`, `queries.js`, `scoring.js`, `conditions.js`) with comments and strings removed, searched for numeric literals other than 0 and 1 (check `R21.4/literals`); every key of `rules.js` counted for readers; 14 override probes.

- Literals found: `* 2` for card 33 (fixed); `10000` in `ENGINE_LIMITS.maxAutoSteps` (a safety limit in a named object, not a rule); `parts.length >= 2` ("both parts" of card 9); `n === 2` in `goalStandings` ("a 2-player game", R16.4.4; the number of places awarded is the constant `goalPlacesTwoPlayers`); `[0, 1, 2]` (option numbers in `getActionSpace`, diagnostics). The last four are structural and are allow-listed in the check.
- A literal 1 where a constant existed: the token exchange (fixed).
- **Named in `rules.js` but never read by logic** (changing them changes nothing; not fixed, because making them effective needs setup or state-shape work beyond a behaviour fix):
  - `PLAYER_BOARD.houses` (11; R21.4 names it): the engine derives 11 as 4 tracks x 3 slots less the one empty "2" slot. Check `R21.4/consistent` holds the three numbers together.
  - `MAP_RULES.buildingsPerInlandCity` (R21.4 names it): one of each per city is built into the state shape (`railwayStation[city]` is one owner or null).
  - `SETUP.freeStartingSpecialists`, `TRAIN.upgradeSlotsPerCarriage`, `GRID.workersPerSpace`, `GRID.workersPerCentre`: structural for the same reason.
  - `HATS.hatsPerTurn` is read, but a value above 1 has no effect: the district choice carries one yes/no hat.
- Numbers of the rules that have no name in R21.4 and are literals in logic, left as they are: 1 hat from Buy Hat, 1 building per claim or move, 1 purchase... (`PONY.purchasesPerTurn` is read), 1 item per `chooseResource` / `discard` action.

## 7. The 27 readings of contract section 20

Verdict on each: **consistent** means the engine's behaviour agrees with the rules text. None is overturned. "Ambiguous" means the wording allows another reading; the engine's reading is kept and the matching check is skipped with the reason.

| # | Subject | Verdict |
|---|---|---|
| 1 | Module setup revealed before the railhead draft | Consistent. R3.8 numbers the steps but nothing depends on the order; R2.4 makes revealed cards open. |
| 2 | R5.4.4 offered per centre worker | Consistent with the literal text; ambiguous. |
| 3 | No displacement onto D5 without a legal claim or move | Consistent: R5.5.4 "you then take D's action", R4.6.3, R4.3 (step 3 may not be skipped except in R5.4.4). |
| 4 | Ids J1 to J7 for the `jan-2026` table | Consistent (the spec gives none). |
| 5 | R20.5.4 with rounds: the final round's start player | Ambiguous. |
| 6 | R3.6 choices asked seat by seat | Consistent: "in seat order ... reveals them at once" reads as both choices of one player together. |
| 7 | One Congress window after the last step | Consistent: R9.4.3 and R9.4.4 name the same moment. |
| 8 | `from` of a network claim with both ends in the network | Consistent (R11.11.4: no arrival city). |
| 9 | `per-railhead` in network mode: one pool of 2 x M; Lay Tracks needs a legal claim | Pool: consistent with R11.3. Choosability: ambiguous. |
| 10 | An offer that cannot be carried out is not made | Consistent: no rule is changed; R10.5 gives C6 its 3 VP. |
| 11 | "First alphabetically" by city id | Consistent: R12.3.1 says "list of city ids". |
| 12 | Transcontinental bonus after another trigger | Ambiguous. |
| 13 | Both railheads on one city: no choice offered | Consistent (R12.5; the two are interchangeable). |
| 14 | Free-action window asked only when there is a free action | Consistent: nothing is lost. |
| 15 | What "no part can be carried out" means | Consistent with R18.6 and R7.7. |
| 16 | Cards 3, 5, 14: at least one step | Consistent with R11.3; "up to 2" with zero steps would be a purchase for nothing. |
| 17 | Card 6 must hire; cards 27 and 9 may stop | Consistent with "hire 1", "up to 2", "either part may be skipped". |
| 18 | Card 32: Foreman type once per activation | Consistent with R9.2 ("for the whole activation"). |
| 19 | Card 33: types offered, what it multiplies | Consistent with the card text ("as many times as R9.3 says"). |
| 20 | Legislative Agenda card 20: used up when taken | Consistent ("once per train activation ... you may take one other entry"). |
| 21 | Cards 14 and 28 are the once-per-round cards | Consistent with R18.8. |
| 22 | Card 28: committing, hire cost, not a bonus action for cards 18 and 19 | Committing and cost: consistent. Cards 18 and 19: ambiguous. |
| 23 | `on-install`: VP tiles have no step | Consistent ("do nothing afterwards"). |
| 24 | Milestones checked for every player | Consistent with R16.9. |
| 25 | Dense places; 0 scores on a "fewest" goal | Consistent with R16.4.1 to R16.4.3. |
| 26 | A token's resource can overflow storage | Consistent with R18.4 and R8.5.4. |
| 27 | Module setup draws after core draws | Consistent (not a rule). |

## 8. Ambiguous wording

The six items marked "ambiguous" in section 7 concern: whether the no-action Remove of R5.4.4 is only for a player with no other move; whether Lay Tracks may be chosen in network mode only to place a building (R4.6.3 with R11.11.5); whether the transcontinental bonus is paid when another end trigger came first (R19.2 with R19.6); whether a hire or carriage taken through Pony Express card 28 counts as the matching bonus action for the Legislative Agenda cards 18 and 19; which source books the VP of a Congress entry taken free through a card (R20.1); and which start player the last tie-break is measured from under `turnStructure = rounds` (R20.5.4). The engine keeps its reading in each and the matching check is skipped. One further note: R18.5 refills the market after the card is resolved and the engine refills before; no card looks at the market, so nothing can tell the difference.

## 9. Rules that could not be tested through the public API

| Rule | Why |
|---|---|
| R2.1 "treated as unlimited" (track tiles, resources, Coins) | Absence of a limit; only large gains without refusal were exercised. |
| R3.1.1, R3.1.3 (lay out the boards, the general supply) | Physical setup with no state to observe. |
| R5.6 "M does not change while the action resolves" | Nothing a player can do inside an action changes adjacency, so the alternative cannot be produced. |
| R8.6.5, R11.6, R13.8, R15.4 ("never moves", "never changes owner") | Only checked as "no action offers it and it is unchanged after several turns". |
| R2.4 hidden information | Checked through `determinise` (only deck orders and the RNG may differ), not through a per-player view; there is none. |
| R19.4 default of 80 turns in play | The default value is checked; a full 80-turn game is left to the smoke suite. |
| R24 standing assumptions | Not rules. |

Mutation testing of the audit suite itself (break the engine on a scratch copy, expect red) was not run. `R21.4/card33`, `R21.4/token`, `R21.4/literals` and `R1.2` are the checks tied to the three fixes.
