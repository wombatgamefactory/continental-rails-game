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
| `variants` | The 26 variants, their rejection messages, constants overrides, a module that is off leaves no trace in a fresh state. |
| `rules-data` | Shape, counts and vocabulary of every table in `rules.js`; the map; the printed values of R21.4. |
| `data-integrity` | The module data against the module code: unique ids, every metric known to the interpreter, every effect type / trigger / modifier handled, JSON round trip, no milestone claimable and no goal with a leader on a fresh board. |
| `rules-core` | The core rules R4.6 to R13, R19, R20 and worked examples E5 to E8, E10. |
| `rules-modules` | A behavioural check for every upgrade tile, every goal and milestone metric, every Legislative Agenda card, every Pony Express card and effect type, the free-action opportunities, the cap, the once-per-round cards in both turn structures, worked examples E2 and E5 with its real tile; it also asserts that every effect handler, card effect, module action and module event ran. |
| `smoke` | Whole games: 600 + 400 random games with the modules on, 100 with each module off, the variant runs, 6 games with each Legislative Agenda card fixed, builder games, the usage counters, the core unaffected by a module that is on or off. |

## Rules with nothing to implement

R0 (how to read the spec), R1 (terminology: enforced by identifiers), R2.1 to R2.3 (components: counts are in `rules.js`), R6.7 and R11.7 (older rules that were removed), R19.6 (after the trigger everything works normally: true by construction), R21.1 and R21.2 (defaults; two players have no special rule), R22 (worked examples: all ten are tests - E1, E3, E4, E9 in `contract.test.mjs`, E5 to E8 and E10 in `rules-core.test.mjs`, E2 and E5 with its real tile in `rules-modules.test.mjs`), R23 (material that is out), R24 (standing assumptions).

---

## Pacific Rails, second edition (`pr2e`): what is done and what follows (31/10/2026)

Done: the whole core rulebook is played by `src/engine-pr2e/` (386 audit checks, 0 known failures; `docs/rules-audit-report-pr2e.md`), it has its five bots (`docs/bots.md`, last section), its own screens (`src/ui/pr2e/`), presets, simulator output and bug-report capture, and it is chosen on the set-up page or by `?rules=pr2e`. Continental Rails was unchanged by it (the same seed gave the same 40 games as before the second ruleset was added; `docs/qa-report.md`, section 9.3). Both engines then moved to route map v3 (31/10/2026): 35 cities, 65 routes, 134 slots including 3 wild slots that take any built tile, the wild-slot decision in both (`fillWildSlot`), Continental Rails' junction cities, regions and Long Haul recounted, and its route end trigger at 10 routes a player; that identity check is retired and replaced by the baselines of `docs/qa-report.md`, section 10.5.

Follow-ups, none of them a rules change:

- **The second edition's Medium bot ends 0.4% of 3-player and 2.4% of 4-player games by the turn limit** on route map v3 (a full storage of tiles of the wrong terrain, the line one or two slots short; the planner does not build what it lacks). A horizon floor in the planner was tried and reverted. Bot work, not a rules change (`docs/qa-report.md`, section 10.4).
- **Continental Rails' engine plays spec v4's storage, its art is spec v5's** (6 spaces on the board, 3 on each carriage): the board shows lids on unused spaces and a "More storage" row for the rest. Moving the engine to v5 removes both (`src/ui/cr-player-board.js`).
- **The map is small at 1280 x 800** (600 px wide of a 1280 px page). An "enlarge map" toggle is the idea; not built.
- **Balance evidence is bot evidence.** On the old map identical Medium bots won seats 3 and 4 only about 10 to 14% of games; on route map v3 the second edition's bias has largely gone (4 players: 30 / 24 / 25 / 22%), while Continental Rails' 3-player table now favours seat 1 (67 / 21 / 12%). Medium leans heavily on Congress Resets fed by Coins (35 columns and Resets a game, 16 Coins collected a player against 1 to 2 of each other resource). Both are in `docs/qa-report.md`, section 9, as observations about the bot, not conclusions about the rules; an archetype bot that plays the other lines (a resource economy, the engine of carriages) would show whether the Reset is as strong for a player who does not play Coins.
- **The simulator's health table is calibrated on Continental Rails.** Three warnings stay on every second-edition run and are thresholds, not faults: lead changes per game (3.4 to 6.3 against "at least 5"), distinct action types offered at a turn's first decision (2.2 to 2.3 against "at least 2.5"), and, in runs that put different bots in fixed seats, the first-player win rate. The Move Train, claim, hat-purchase and carriage-purchase subsystem rows are no longer reported for an engine that has no such action. The hats of this ruleset are a district-choice parameter, so they have no usage row yet: a row built on `hatsSpent` would give the second edition one.
- **The Expert bot's turn is about as long as Continental Rails'** in the browser (on route map v3, two games each: 4.99 s against 5.23 s of a 6 s budget; with the old map's seed 7 alone, 4.95 s against 4.61 s); a second-edition playout costs about twice as much. `PR2E_SEARCH_SETTINGS.shareScale` (`src/bots/pr2e/weights-pr2e.js`) is the one number to turn if it matters.
- **Layout.** At 1280 x 800 the players column (cards and goals) scrolls inside its frame for 3 and 4 players: the four goals do not fit beside the cards at that height. The player board with three carriages and four players at 1440 x 900 fit.
- **Undo during a path lay** steps back one choice at a time (the unpaid routes of the path, the start of the lay, the district): by design, nothing is paid before the lay ends. See `docs/qa-report.md`, section 9.
- **A saved game can only be loaded through the test hook** (`?test=1`, `window.__cr.loadState`): the page has no "load a game" control for either ruleset. If one is added, it should go through `beginGame(..., 'loaded', rules)`, which makes the set-up form follow the game's rules (so that "Play again" keeps them).
- **Art.** Every picture of the second edition's screens is real art (44 `pr2e-` entries, 614 KB); the page asks the browser to fetch them while the player reads the set-up page (`warmArt`). Continental Rails' first screen is not warmed and draws blank pictures for as long as they take to load (about 3.5 s on a 1.6 Mbit/s line, 15 to 35 ms on a local server); the same warm-up would fix that and is a small change if wanted.

