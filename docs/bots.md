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

Other tests: `tests/mcts.test.mjs` is part of `npm test` (legality over 20 full games, determinism, hidden information, the fallback, the clock, off-turn decisions; under a minute). `node tests/mcts-browser.mjs` (`--level=expert`) plays a whole game in the installed Chrome and checks that the page stays responsive while the bot thinks.

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

1. Write the bot: an object with `chooseAction(state, context)` returning one of `getValidActions(state)` (contract section 14). It must not change `state`, must take its randomness from `context.rng` only, and must not read a clock (`context.now` is injected). A bot that looks ahead works on `determinise` copies. For a search level of a different strength, `createMctsBot({ timeBudgetMs, iterations })` in `mctsBot.js` is enough.
2. Register it in `src/bots/index.js`: an entry in `BOT_LEVELS` (`id`, `name`, `description`, `defaultTimeBudgetMs`, weakest first) and in `BOTS`. The setup screen, the simulator's `--bots=` and the worker pick it up from there.
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
