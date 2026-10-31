# Continental Rails - the bots

For the designer and for whoever works on the bots next. Written 11/10/2026. Every figure here was measured on one development machine (a fast desktop, Node 24) while other jobs were using it, so timings are approximate; win rates were measured at fixed iteration allowances and do not depend on the load.

Terminology as everywhere in this project: a *house* is only the production multiplier on the player board; buildings on the map are *railway stations* and *telegraph stations*; locations on the action grid are *districts*. *Building* a track tile (a train activation) and *laying* it (the Lay Tracks action) are different things.

## The five levels

| Level | How it decides | Default budget | Strength against the level below | Speed |
|---|---|---|---|---|
| Random | Any legal action, uniformly. | none | - | under 10 microseconds a decision |
| Easy | Medium's scores with strong noise, and a pick among the top three 15% of the time. | none | beats Random 100 of 100 (2 players) | as Medium |
| Medium | Scores every legal action by how far it carries a short plan (the best route to claim, and the next), in VP-equivalents, and plays the best. One action at a time; no look-ahead. | none | beats Easy 189 of 200 = 94.5% (SE 1.6%) | 60 to 115 microseconds a decision; a whole 2-player game in 15 ms |
| Hard | Monte Carlo tree search: tries the plausible moves, plays each game out to the end with Medium in every seat, and takes the move that ended best. | 1.5 s a turn | beats Medium 102 of 104 = 98.1% (SE 1.3%) at 2 players; wins 52 of 52 at a table with three Mediums | 180 to 400 playouts a second; a turn 1.4 s on average in the browser (2.4 s at most) |
| Expert | The same search with four times the thinking. | 6 s a turn | beats Hard 81 of 112 = 72.3% (SE 4.2%) at 2 players, by 128 VP to 101 | a turn 5.1 s on average in the browser (7.9 s at most) |

The figures for Random, Easy and Medium are from `tests/bots-strength.mjs`. SE is the standard error of the win rate.

The budget of Hard and Expert is **per turn, not per decision**. A turn is a string of small decisions (the worker step, the district, then the steps of that district's action). The bot spends half of the turn's allowance on the worker step, a quarter on the district choice, a fifth on each Lay Tracks decision and a few per cent on each of the rest. It works out which decision it is facing from the state alone, so it needs no memory between calls. A game costs a Hard seat about 35 seconds of thinking in all and an Expert seat about two minutes.

## How the search works, in plain English

At each decision the bot repeats the following a few hundred times (Hard) or a few thousand times (Expert) per turn:

1. **Hide what is hidden.** The only hidden thing in the game is the order of the undrawn Pony Express cards. The bot first takes a copy of the position with those decks put in a fixed order (`blindCopy`), and for every repetition deals them again at random (`determinise`). It never looks at the real order; a test scrambles the decks and checks that the bot's answer does not change in any detail.
2. **Walk down the tree.** The tree records the sequences of actions tried so far and how they turned out. At each step the bot picks the action with the best mix of "Medium likes it" (the prior: Medium's own score for the action, from `scoreValidActions`) and "it has turned out well so far". So the search starts at Medium's choice and widens to the second and third choices only as it gathers evidence. The tree runs on through the opponents' turns too; where another player chooses, the tree picks what is best *for that player*.
3. **Add one new node**, then **play the game out to the end** with the Medium policy in every seat (with a little random tie-breaking so that playouts differ).
4. **Score it.** For each player: their margin over the best other player, squashed to a number between 0 and 1, blended 70/30 with whether they came first. A margin is used, not just win or lose, because for most of a Euro game the question is "how far ahead does this put me", and a win/lose signal is nearly flat until late.
5. **Credit the result back up the path**: each node gets the result of the player who chose there.

When the allowance is spent the bot plays the action it visited most. If one action is so far ahead that the rest of the allowance could not change the answer, it stops early. If the allowance is too small to search (fewer than 8 playouts for a decision) it plays Medium's choice.

In short: Hard asks, of every sensible move, "how does the game end if I do this and then everybody plays like Medium?". Medium scores one action at a time and cannot see a whole turn, the opponent's reply or the end of the game. That is the whole difference between the two.

All the tuning numbers are in one object, `MCTS_SETTINGS` in `src/bots/mctsBot.js`, each with the measurement behind it.

## What each level is good and bad at

**Random.** A test instrument. It almost never completes a crossing; its games end at the turn limit.

**Easy.** Plays the collect, build, lay loop recognisably, but wastes turns. A fair first opponent for somebody learning the rules.

**Medium.** A competent, fast, single-minded player. Known weaknesses: it barely develops its engine (about 1.6 specialists and 2.7 carriages at the end, one level 1 upgrade tile), takes under one Congress entry a game, never buys a rank C Pony Express card, pays no attention to what opponents are about to do, and races for the crossing.

**Hard.** Beats Medium almost every game, by about 55 VP at 2 players (143 against 88) and 60 VP at 4 players. How it does it, per game against Medium at 2 players (104 games):

| | Hard | Medium |
|---|---|---|
| Completion bonus (VP) | 27.8 | 1.4 |
| Milestones (VP) | 15.1 | 7.1 |
| Buildings at the end (VP) | 24.7 | 17.4 |
| First connections (VP) | 30.6 | 24.4 |
| Track (VP) | 17.0 | 14.8 |
| Upgrade tiles (VP) | 9.2 | 9.6 |
| Lay Tracks turns | 7.1 | 5.5 |
| Routes claimed | 6.6 | 5.5 |
| Specialists at the end | 1.6 | 1.6 |
| Carriages at the end | 2.3 | 2.7 |
| Congress entries | 0.6 | 0.8 |
| Rank C Pony Express cards | 0 | 0 |

So Hard does **not** win by a different line of play. It plays Medium's game with better timing: it takes Lay Tracks more often and gathers less, claims one more route, places one more railway station, and above all it is the one who completes the transcontinental line - in nearly every game. Its engine is, if anything, smaller than Medium's (fewer carriages). At 4 players the picture is the same, with tolls added (18.6 VP a game for Hard against about 6 for a Medium).

Weaknesses of Hard, honestly:

- **Its picture of the future is Medium.** Every playout is played by Medium, its opponents included. Against Medium that picture is exact, which flatters the 98%. Against a human, or against a strategy Medium would never play, it is planning against the wrong opponent. Expect it to be a strong opponent for a human, but not by this margin.
- **It cannot find a strategy Medium cannot finish.** An engine built over ten turns only pays if the rest of the game is played to use it. The playouts are played by Medium, which under-uses an engine, so the search sees little value in building one. The absence of an engine strategy in Hard's play is therefore weak evidence that no such strategy exists.
- **Few playouts.** A few hundred a turn, spread over the decisions of the turn. Minor decisions (a single step of a train activation) get a dozen playouts or fewer and often fall back to Medium's choice.
- **It starts from Medium's opinion.** An action Medium scores very low is tried late or never.

**Expert.** The same bot with four times the allowance, so the same strengths and the same blind spots. Against Hard it wins 72% of games and takes the crossing more often than not (completion about 20 VP a game against 10), with the same small engine. The extra thinking buys better timing, not a new plan.

## Running the strength tests

```
node tests/mcts-strength.mjs                       the three acceptance measurements (a long run: about an hour on a busy machine)
node tests/mcts-strength.mjs --quick               a quarter of the games
node tests/mcts-strength.mjs --only=hard           one of: hard, expert, table
node tests/mcts-strength.mjs --calibrate           iterations per second against the real clock, one core
node tests/mcts-strength.mjs --match=hard@300,medium --games=100 --threads=12
node tests/mcts-strength.mjs --match=hard@120,hard@120 --games=64 --a.exploration=3     an A/B duel of one setting
```

A seat is `level`, `level@N` (N iterations a turn, reproducible) or `level~MS` (MS milliseconds a turn on the real clock, not reproducible). `--a.<setting>=<number>` overrides an entry of `MCTS_SETTINGS` for the first seat, `--b.` for the second. Seats rotate from game to game. The output gives, for each seat: wins with n and standard error, score mean, VP by source, the engine at the end, actions per game, districts chosen, and thinking time per turn (mean, 95th percentile, maximum).

**Calibration.** The time budgets are turned into iteration allowances for reproducible runs. `--calibrate` measured 180 to 400 playouts a second over a whole game depending on what else the machine was doing (and on whether the thread landed on a fast or a slow core), so 1.5 seconds is somewhere between 270 and 600 iterations. The allowances used are the cautious end: **300 iterations a turn for Hard, 1,200 for Expert**. A playout early in the game is five to ten times as long as one near the end, so at a fixed allowance the early turns take longer than the budget and the late ones less; with the clock (the browser) every turn takes about the budget and the early turns get fewer playouts. At 4 players playouts are longer still, so 1.5 seconds buys fewer of them than at 2 players.

The simulator (`sim/sim.mjs`) accepts `--bots=hard,medium`. With `--iterations=N` every search seat gets the same N per turn (it cannot give Hard and Expert different allowances; use `tests/mcts-strength.mjs` for that); with neither `--iterations` nor `--budget` the search seats use the real clock and the run is not reproducible.

Other tests: `tests/mcts.test.mjs` is part of `npm test` (legality over 20 full games, determinism, hidden information, the fallback, the clock, off-turn decisions; under a minute). `node tests/mcts-browser.mjs` (`--level=expert`, `--rules=pr2e`) plays a whole game in the installed Chrome and checks that the page stays responsive while the bot thinks.

## In the browser

Measured with `tests/mcts-browser.mjs`, speed "instant", against a Medium bot:

| | Hard | Expert |
|---|---|---|
| Wall time per turn: mean / 95th percentile / maximum | 1.42 s / 2.23 s / 2.40 s | 5.14 s / 7.93 s / 7.93 s |
| Longest gap between two animation frames while the bot thinks | 50 ms | 83 ms |
| A click on a control while the bot thinks: handled and painted in | 6 ms on average, 15 ms at most | 7 ms, 16 ms |
| "is thinking..." indicator on screen while the bot is to act | every frame | every frame |
| Whole game | 39 s | 112 s |

The search runs in the Web Worker (`src/bots/bot-worker.js`), so the page never blocks. The page's bot driver allows each *decision* at least 15 seconds (32 seconds for Expert) before it gives up on the worker; the longest single decision of an Expert turn is about 3 seconds. Pacing at the "normal" speed setting: the page waits 0.85 seconds before each decision of a bot that answers at once (Random, Easy, Medium) so that its moves can be followed, but only 0.25 seconds before each decision of Hard and Expert, whose own thinking time is already the pause (`pacingFor` in `src/ui/bot-driver.js`; "fast" waits 0.22 and 0.08 seconds, "instant" none).

## Adding a level

1. Write the bot: an object with `chooseAction(state, context)` returning one of `getValidActions(state)` (contract section 14). It must not change `state`, must take its randomness from `context.rng` only, and must not read a clock (`context.now` is injected). A bot that looks ahead works on `determinise` copies. Bots import no engine: write it as a factory over the engine a ruleset hands it (as `createRandomBot(engine)`, `createHeuristicPolicies(engine)` and `createMctsSearch(engine, policies)` are; contract section 21). For a search level of a different strength, the `createMctsBot({ timeBudgetMs, iterations })` of a ruleset's `search` is enough.
2. Register it: an entry in `BOT_LEVELS` in `src/bots/index.js` (`id`, `name`, `description`, `defaultTimeBudgetMs`, weakest first), and the bot itself in the `bots` of every ruleset (`src/rulesets/define.js`, `RULESET_BOT_LEVELS`). The setup screen, the simulator's `--bots=` and the worker pick it up from there.
3. If it thinks for longer than about 10 seconds a decision, check the timeout in `src/ui/bot-driver.js`.
4. Add it to `tests/mcts.test.mjs` (the registry check lists the ids in order) and measure it against the level below with `tests/mcts-strength.mjs --match=`.

## Using the levels as balance instruments

- **Medium** is the workhorse: a thousand games in seconds, so small effects are measurable. It is one opinionated player; a finding from Medium tables is "true for a player who races the crossing with a small engine".
- **Hard** costs a few thousand times as much per game, so samples are a few hundred games at most. Use it for two questions. First, *does a rule change survive a better player?* If a variant looks balanced among Mediums but Hard's margin over Medium jumps, the variant rewards something Medium does badly. Second, *where do a strong player's points come from?* The VP-by-source table of Hard against Medium shows which sources skill converts into points (today: completion, milestones, buildings).
- **Do not** read "Hard never does X" as "X is weak" for anything that needs a long plan (an engine, rank C cards, heavy Congress use): the playouts are Medium's, and Medium does not do X either. To test such a strategy, give Medium the strategy through its weights (`--weights.biasEngine=2`, the archetype bots of the simulator) and let Hard play *against* it, or put the biased weights in the playouts.
- **Do not** use mixed tables of Hard and Medium for seat-order or first-player questions: the skill gap swamps everything else. Use all-Medium or all-Hard tables.
- **Expert** is for checking that a Hard finding is not an artefact of a small search, and as the strongest opponent in the demo. It is too slow for routine balance work.
- Time-budgeted runs are not reproducible and are weaker on a busy machine. For anything that will be quoted, use fixed iterations.

## What was tried and not kept

All A/B duels: the changed search against the search as it then stood, 2 players, 120 iterations a turn each unless stated, 64 or 69 games, standard error about 6 points. The figure is the share won by the changed bot.

| Change | Result | Decision |
|---|---|---|
| Cheap `rolloutPolicy` after 6 turns of each playout | 19%, for 45% of the time | Reverted. The cheap policy plays too differently from Medium to stand in for it. |
| Tree stops at the end of the bot's own turn | 35% | Reverted. Letting the tree run into the opponents' turns is better. |
| Playout jitter 0.05 in place of 0.3 | 39% | More variety between playouts is better; now 0.6. |
| Exploration 0.25 / 1.5 in place of 0.6 | 48% / 62% | Now 1.5. |
| Prior temperature 4 in place of 1.5 | 61% | Now 3. |
| The three widenings together against the three old values | 50% of 64 | Kept, but the gain is **not established**: the single-change results may have been luck. |
| No win bonus in the result (margin only) | 54% | No effect seen; kept the 30% bonus. |
| Playouts cut after 10 turns and scored by a simple evaluation, same iterations | 42%, for a third of the time | See next row. |
| The same at about equal time: cut at 10 turns with 3 times the iterations; cut at 16 turns with 1.8 times | 59% of 64; 47% of 64 | Not established either way. Playouts run to the end, which needs no hand-made evaluation. The most promising thing to try next. |
| Reusing the tree from one decision of a turn to the next | not built | It needs memory between calls, which the bot contract rules out (and the browser sends a fresh copy of the state each time). |

## What would make it stronger

- A proper evaluation at a cut-off (the plan value Medium already computes, per player), so that playouts can be a third as long.
- Playouts by a better policy than Medium for the bot's own seat, and an opponent model that is not Medium when the opponent is not Medium.
- Engine-minded playouts (biased weights), so that the search can see a long plan pay off.

## Pacific Rails, second edition (`pr2e`)

Written 31/10/2026. The five levels exist for the second ruleset too, built over its engine by `src/rulesets/pr2e.js`. The search levels are the shared tree search of `src/bots/mctsBot.js`, unchanged; what is specific to these rules is the heuristic policy in `src/bots/pr2e/` (`heuristicBot-pr2e.js`, its tuning constants in `weights-pr2e.js`). It imports no engine: `createPr2eHeuristicPolicies(engine)` builds it over the engine the ruleset hands it, and returns the same shape as `createHeuristicPolicies` (heuristic bot, Easy bot, heuristic and rollout policies, `scoreValidActions`, a no-op `repeatGuard`, `decisionShare`, `pipelineValue`). Every figure below was measured on a shared development machine with `node sim/sim.mjs --rules=pr2e ... --jitter=0.05 --rotate` unless it says otherwise; Medium was tuned by the A/B method of the Continental Rails bot (`--weights-seat=1 --weights.<name>=<n>`).

| Level | How it decides | Strength |
|---|---|---|
| Random | Any legal action. | - |
| Easy | Medium's scores with noise (1.0), a pick among the top three 20% of the time, no look at tolls and no second target. | beats Random 1000 of 1000 (2 players) |
| Medium | The policy below, one action at a time. | beats Easy 90.1% of 800 (SE 1.1%) at 2 players; wins 87.5% of 600 at a table of Medium, Easy and Random. A 2-player game takes it about 26 ms: about 100 microseconds a decision, twice a Continental Rails decision (47 microseconds, 11 ms a game). |
| Hard | Tree search, Medium in every seat of the playouts, 1.5 s a turn (`--iterations=100` in the figures). | beats Medium 45 of 46 = 97.8% (SE 2.2%) at 2 players at 100 iterations a turn, by 160 VP to 113 |
| Expert | The same with four times the allowance. | Not measured for strength (a long run). Speed below. |

### What the Medium policy values

It works out the same short plan from the state at every decision and scores each legal action by what it adds to it, in VP-equivalents.

- **Lays.** A depth-first search over printed routes from each train finds every lay (a path may travel over laid track and lay up to two routes, three routes long). A path is worth its track VP (2 a slot to a city with no building, 1 to a connected city or a start city, 3 a slot if it completes the line), minus the tolls it pays (weighted above their face value because a rival gains them), plus the building the lay forces on arrival (P14.6: the table VP at the end, the next telegraph row VP, or a railway station's production and, for the first three, its carriage), plus its share of the cheapest crossing of the map (rising with the turn number, so games end by the line). A lay that completes the line gets a bonus if the player would be ahead when the game ends and a penalty if behind: it races to end the game when ahead and does not hand a rival the win.
- **Targets.** The best path (value over the turns still needed: Collects for missing resources, board activations for missing tiles, then the lay) is target 1, the best disjoint one target 2. Every unit gained is scored by how much of the way to the targets it saves; units beyond them are worth a little (a built tile is 1 VP at the end, a Coin buys Congress).
- **Districts.** Each district is scored by simulating its action at the multiplier the grid gives: production, district houses and action bonuses for a Collect (plus the special action it pays for: telegraph station, district house, upgrade or railway station); every step of a board activation, with each Financier step choosing a Congress column (priced against its Coins) or a Reset (1 VP a senator down); the best lays, or the best hires, for the centre district. The worker step is scored by the best district a placement, removal or displacement opens, at the multiplier it gives, hats included, plus a small share of what one more worker beside it would add next turn.
- **Everything else.** Specialists by the activations left and the tile types the targets want (carriage 3's printed VP in full); upgrade tokens by their yield; district houses, buildings (where rivals' trains are likely to pass: junction cities), goals (the 4 in play, by how likely a +1 is to make the player the sole leader), storage limits (what to discard), and the arrival building (compulsory when able).

### Results

**Ladder** (2 players, `--jitter=0.05 --rotate`, default variants):

| Match | Result |
|---|---|
| Easy v Random | Easy 1000 of 1000 |
| Medium v Easy | Medium 90.1% of 800 (SE 1.1%) |
| Hard v Medium | Hard 97.8% of 46 (SE 2.2%), `--iterations=100` |
| Medium v Medium, 2 players | 1000 games: 0% ended by the turn limit, all by the line; 22.3 turns a player (13 to 35); seat 1 won 57.5% (SE 1.6%) |
| Medium v Medium, 3 players | 600 games: 0% by the turn limit; 20.8 turns; seat wins 52.2%, 34.3%, 13.6% |
| Medium v Medium, 4 players | 600 games: 0% by the turn limit; 21.7 turns; seat wins 39.4%, 37.5%, 12.7%, 10.4% |

Later seats lose heavily at 3 and 4 players, with identical bots: a game is a race to the line and the first two seats choose their worker spaces and Congress columns first. That is a property of the rules as played by this bot, not a bot defect that was found, but it deserves a look before the figures are quoted as balance evidence.

**Where Medium's points come from** (2 players, 1000 games, per player, VP: share): track 27.0 (20.8%), completion 7.0 (5.4%), telegraph 18.1 (14.0%), toll 2.9 (2.3%), district houses 2.1 (1.6%), upgrades 1.7 (1.3%), Congress 15.2 (11.7%), carriage 3 4.9 (3.8%), buildings at the end 42.1 (32.4%), built tiles at the end 2.2 (1.7%), goals 6.6 (5.1%); about 130 VP a player. It uses Congress heavily (35.6 columns and Resets a game; 16 Coins collected a player against 1 to 2 of each other resource: it plays a Coin economy, takes 2.4 upgrade tokens a player, and takes about 1.3 of the 4 goals in play). It rarely collects iron, wood or gunpowder: the Foreman and Congress rewards (columns K1 to K3 and K6) supply them. Tolls are small (2.9 VP a player): it avoids paying them and places buildings in junction cities, but a 2-player map gives few chances.

A caution for the designer: the bot found Congress by itself, and the Reset (1 Coin, 1 VP for every senator that is down) is probably the reason: it is cheap VP for anyone with Coins and a Financier. A Coin weight of 1.0 in place of 2.2 made it a Coin-light player that Medium beat 71% to 29%.

**Speed** (Node, one shared machine, interleaved with the Continental Rails figures; the browser adds only page work): wall time per turn of the search bot on the real clock, against a Medium bot.

| | pr2e mean / 95th percentile / maximum | Continental Rails, same harness |
|---|---|---|
| Hard, 1.5 s (3 games) | 1.88 s / 3.46 s / 4.13 s | 2.24 s / 3.66 s / 5.13 s |
| Expert, 6 s (2 games) | 4.94 s / 7.51 s / 9.02 s | 4.91 s / 7.45 s / 8.45 s |

A pr2e playout costs about twice a Continental Rails one, and a decision cannot stop in the middle of a playout, so with the Continental Rails shares an Expert turn ran 5.76 s on average, 8.77 s at the 95th percentile. `PR2E_SEARCH_SETTINGS.shareScale` (0.8, in `weights-pr2e.js`) multiplies every share of the turn's allowance; that brought it level. The real browser is measured below.

**In the browser** (31/10/2026, the installed Chrome 156, `node tests/mcts-browser.mjs --level=<level> --rules=pr2e`, speed "instant", seed 7, against a Medium bot, on an otherwise idle machine; one game each, so a few dozen turns: read the means as approximate). The same harness under Continental Rails for comparison:

| | pr2e Hard | pr2e Expert | Continental Rails Expert |
|---|---|---|---|
| Turns of the search bot | 25 | 26 | 19 |
| Wall time per turn: mean / median / 95th percentile / maximum | 1.41 s / 1.37 s / 2.02 s / 2.87 s | 4.98 s / 4.93 s / 8.13 s / 8.35 s | 4.50 s / 4.68 s / 7.33 s / 7.33 s |
| Budget | 1.5 s | 6 s | 6 s |
| Longest gap between two animation frames while the bot thinks | 217 ms | 33 ms | 117 ms |
| A click while the bot thinks: handled and painted in (mean / maximum) | 13 ms / 14 ms | 13 ms / 14 ms | 13 ms / 14 ms |
| "is thinking..." indicator on screen while the bot is to act | every frame | every frame | every frame |
| Whole game | 37 s, 37 turns | 137 s, 51 turns | 94 s, 36 turns |

Every check of the harness passed in all three runs (the game reaches the end screen, no console or page error, no driver incident, the frame counter keeps ticking, no frame gap over 250 ms, clicks handled within 100 ms, the indicator visible, a turn takes about its budget). The second-edition Expert turn is about a half second longer than the Continental Rails one on average (a playout costs about twice as much and a decision cannot stop in the middle of one), within the limit the harness sets (2.4 to 10.2 s a turn, 95% under 13.2 s) and under the page's driver timeout. The harness's click control was a stale selector (it clicked a control that no longer exists, so no click was measured); it now clicks a player card, and `--rules=` was added.

Where to look: `describePlan(state)` of the policies prints the two targets; `scoreValidActions(state)` gives the scores the search starts from.

### What was tried and not kept

Medium against Medium, 1500 games, 2 players, one setting changed in seat 1 (standard error about 1.3 points). Medium meeting itself favours any change a little (the two bots stop contending for the same targets), so only the large effects were kept.

| Change | Result | Decision |
|---|---|---|
| `coin` 0.6 / 1.5 / 2 / 2.5 / 3.5 in place of 1.0 | 45% / 61% / 71% / 71% / 48% | 2.2 |
| `maxRoutes` 3 and `maxUnlaid` 2 in place of 4 and 3 | 49% (600 games), a third of the lay candidates | Kept: faster, no weaker |
| `slotsPerTurn` 0.6, `secondDiscount` 0.2, `upgradeUses` 0.5, `avgM` 2.2, `specialShare` 0.5 together | 56% | Kept. Singly each gave 56 to 61%, not additive. |
| `tollPaid` 0.8 / 2.6, `hat` 0.6 / 2, `crossBase`, `crossPerTurn`, `raceBonus` 0 / 10, `keepResource` | 47 to 50% | Left as they were |
| `activationShare` 0.15, `financierUse` 0.8, `upgradeUses` 0.1, `avgForeman` 2.2, `houseCost` 1.5, `districtHouseUses` 0.25 | 35% to 44% | Left as they were |
| Easy noise 0.5 / 1 / 1.8 / 3 / 5 / 7 | Medium wins 87.5% / 89.5% / 94% / 97% / 98.5% / 100% | 1.0: a weaker player, not a hopeless one |
