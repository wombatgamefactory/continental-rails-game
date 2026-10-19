# Continental Rails

Continental Rails is a heavyweight Euro board game for 2 to 4 players about building the 1869 transcontinental railroad. You place and remove workers on a grid of districts to **collect** resources, your train's specialists **build** them into track tiles, and you **lay** those tiles on a shared map to claim whole routes and race the line across the continent.

This repository is the playable browser prototype: the full rules, bots from Random to a search-based Expert, a headless simulator that plays thousands of games, an in-game bug reporter, and the test suites. Everything runs in the browser or in Node with no build step and no runtime dependencies.

Designed by Dean Morris, Wombat Game Factory. The game is a prototype: the rules and the art are subject to change.

## Play

- **Online:** <https://www.wombatgamefactory.com/continental-rails-game/>. Choose "Play now", or set every seat to a bot and choose "Watch a demo game".
- **On your own computer:** you need [Node.js](https://nodejs.org/) (tested with Node 24). The page uses ES modules and a Web Worker, so it has to be served over `http`, not opened as a file.

  ```
  npm install
  npm run dev
  ```

  Then open <http://localhost:8080>. `npm install` is only needed for the test tools (it adds `playwright-core`); the game itself has no dependencies.

Two to four seats, each a human (pass the device between turns) or a bot. A game takes the time it takes: bots at "instant" speed play a whole game in seconds, and you can pause, speed up or slow down any bot game.

## The bots

| Level | How it decides | Speed |
|---|---|---|
| Random | Any legal move, uniformly. A test instrument, not an opponent. | instant |
| Easy | Medium's judgement with noise, and sometimes a second-best move. | instant |
| Medium | Scores every legal move by how far it carries a short plan (the best route to claim, and the next) and plays the best. One move at a time, no look-ahead. | instant |
| Hard | Monte Carlo tree search: plays each plausible move out to the end of the game with Medium at every seat, and takes the one that ended best. | about 1.5 s a turn |
| Expert | The same search with four times the thinking. | about 6 s a turn |

How each works, how strong each is, what was tried and how to add a level: [docs/bots.md](docs/bots.md).

## Rule variants

Every rule that was not settled is a switchable **variant**. On the set-up page, "Rules variants" lists all 25 with their choices (and three presets: Full game, Base game, Core only). A variant that differs from the default shows in the game header, on the end screen and in bug reports.

A configuration is shared by address: the set-up page keeps `?variants=name=value,name=value` in step with your choices, so copying the address copies the rules. For example:

```
https://www.wombatgamefactory.com/continental-rails-game/?variants=conversionRate=1:1,modulePonyExpress=false
```

Other parameters of the address: `bots=human,medium` (a level per seat, which also starts the game), `players=3`, `names=Anna,Ben`, `seed=42`, `speed=normal|fast|instant`. The full list is at the top of `src/ui/setup.js`. The same variant names work on the simulator command line as `--variant.<name>=<value>`.

The variants (the engine's table in `src/engine/variants.js` is the one list; the page and the simulator are built from it):

| Variant (the name used in the address and on the simulator command line) | Choices (default marked *) | What it changes |
|---|---|---|
| `conversionRate` | 1:1 / 2:1* / iron-in-all | What a Crew, Miner and Engineer pay for one built tile |
| `turnStructure` | continuous* / rounds | Place-or-remove with no rounds, or place-only rounds with a refresh |
| `moduleCarriageUpgrades` | true* / false | Carriage upgrade tiles in play |
| `endGameScoring` | milestones* / goals / both / none | Which of the two objective systems is in play |
| `goalsInPlay` | 1 to 12 (default 3) | Goal cards revealed (used when goals are in play; at most 11 when carriage upgrades are off, because goal 6 is then removed) |
| `milestonesInPlay` | 1 to 10 (default 6) | Milestone tiles revealed (used when milestones are in play) |
| `moduleLegislativeAgenda` | true* / false | One Legislative Agenda card in force |
| `legislativeAgendaCard` | random or 4 to 20 (default random) | Which Legislative Agenda card, when the module is on: random, or a card number |
| `modulePonyExpress` | true* / false | Pony Express tokens and cards in play |
| `ponyOngoingCap` | 0 to 15 (default 2) | Most ongoing Pony Express cards one player may hold (0 = no cap) |
| `startCompensation` | graduated* / none | Extra starting resources for later seats |
| `congressTable` | design-2026-10* / jan-2026 | Which Congress price table is on the strip |
| `claimFrom` | railhead* / network | Claim only where a railhead stands (with Move Train), or anywhere touching your network (no Move Train) |
| `layTrackClaims` | per-step* / per-railhead | How many claims one Lay Tracks action gives |
| `gameEndTrigger` | own-crossing* / any-crossing | Whether a transcontinental line must be one player's own routes |
| `endRoutesPerPlayer` | 0 to 23 (default 8) | Game end is triggered when claimed routes reach this number x players (0 = off) |
| `maxTurnsPerPlayer` | 0 to 500 (default 80) | Digital safety stop: the game end is triggered when a player has taken this many turns (0 = off) |
| `bonusActionLimit` | once-per-turn* / once-per-game / multiplied | How often a bonus action may be taken |
| `hireCostModel` | fee-plus-table / fee-only* / table-only | What the Hire Specialist bonus action costs |
| `bothBuildingsSameOwner` | true* / false | Whether one player may own both buildings of a city |
| `buildingScoreCurve` | rising* / 2018 | The end-game building table |
| `scoringCard` | none / random* / ground / tunnel / bridge | One terrain scores 3 VP per slot when laid |
| `upgradeVpTiming` | per-activation* / on-install | Whether the three VP upgrade tiles score every activation or once |
| `specialistActivations` | by-level / once* | Whether level 2 and 3 specialists act 2 and 3 times |
| `gridLayout` | fixed* / shuffle-resources | Whether three Gather districts are shuffled at setup |

## Tests

```
npm test            # 15 suites in Node: rules, data, determinism, bots, simulator, bug reporter; no browser needed
npm run test:ui     # drives the real page in your installed Chrome or Edge with playwright-core (nothing is downloaded)
```

`npm test` takes a minute or two and must always be green. `npm run test:ui` needs Chrome or Edge installed; it plays whole games through the page and fails on any console error, page error or failed request. Temporary files go to the operating system's temp folder, so two runs can overlap. A record of the last full quality check is in [docs/qa-report.md](docs/qa-report.md).

## Simulate games

`sim/sim.mjs` plays bot-versus-bot games headless, through the same driver as the browser, across all your processor cores, and prints balance statistics. Results are written to `sim-results/` (not tracked). `node sim/sim.mjs --help` lists every option; the output format is in [sim/SCHEMA.md](sim/SCHEMA.md).

```
# 1. 200 four-player games of Medium bots (a small random jitter stops identical bots favouring seat 1)
node sim/sim.mjs --games=200 --players=4 --bots=medium --jitter=0.05 --label=readme-medium

# 2. The same seeds with and without a rule changed, in one file with a comparison
node sim/sim.mjs --games=200 --players=3 --bots=medium --jitter=0.05 --baseline --variant.conversionRate=1:1 --label=readme-conversion

# 3. The search bot against Medium, seats rotated, at a fixed number of search iterations a turn
node sim/sim.mjs --games=20 --players=2 --bots=hard,medium --rotate --iterations=120 --label=readme-hard
```

Then turn a result into a single self-contained HTML report with charts (no network needed; it is written beside the input, and a second run writes `-v2`):

```
node sim/sim-report.mjs sim-results/<the file the run printed>.json
```

A run exits non-zero if any bot proposal was refused, a game hit the decision cap, or anything crashed.

## Report a bug

The "Report a problem" button on every screen (or Ctrl+Shift+B) captures the full game state, the recent actions and refusals, and the reason the engine gives for every action. It downloads one JSON file. To replay it:

```
node tools/replay-bug-report.mjs path/to/continental-rails-bug-<id>.json
```

It rebuilds the position from the file and prints the legal actions and the block reasons as the current engine gives them. Details: [docs/bug-reports.md](docs/bug-reports.md). Nothing is sent anywhere: the repository holds no email address and no analytics id (`src/ui/config.js` is where the designer would add them).

## Repository layout

```
index.html, style.css      the page
src/engine/                the rules: pure functions over JSON state (no DOM, no clock, seeded randomness)
src/bots/                  Random, Easy, Medium and the tree-search bot; run in a Web Worker in the page
src/ui/                    the screens: set-up page, board, trains, dock, end screen, bug reporter
sim/                       the simulator and its HTML report generator
tests/                     the Node suites (npm test), the browser tests (test:ui) and hand-run QA scripts (tests/qa)
tools/                     static server, bug-report replay, art manifest builder, placeholder maker
assets/                    web-sized art and art-manifest.json / .md
docs/                      engine contract, bots, bug reports, art extraction notes, QA record
```

The engine contract ([docs/engine-contract.md](docs/engine-contract.md)) is the binding API between the engine, the bots, the simulator and the page.

## Art

Where real art exists it is used; every other picture is a labelled **placeholder**, and the page draws such pieces in code instead of showing a hatched picture. [assets/art-manifest.md](assets/art-manifest.md) lists every placeholder still needed, most valuable first, with the size and what it should show. The designer's Photoshop sources are not in this repository.

## Copyright

Copyright (c) 2026 Dean Morris / Wombat Game Factory. All rights reserved: the game design, rules and artwork may not be reproduced without permission (see [LICENSE](LICENSE)).
