# Simulator output: schema 1

The file written by `node sim/sim.mjs` (default `sim-results/<yyyymmdd-hhmm>-<label>.json`, gitignored). The report generator is written against this document. `schemaVersion` is bumped when a field is renamed, removed or changes meaning; adding a field does not bump it.

Conventions used throughout:

- **Seat** = turn-order position, a player id of the engine. Arrays indexed by seat: position 0 is seat 1 (the first player). Where a `seat` field exists it is the 1-based number. `triggeredBy`, `winner`, `halfLeaders`, `completion.seat` and the `seat` of a failure are 0-based indices.
- **Bot type** = the label of a bot in `run.bots[].type`: its level (`random`, `medium`...), with `+w` added for the bot that has `--weights.*` applied when `--weights-seat` is used.
- **Counted game** = a finished game whose end reason is not `turn-limit`. **Finished** = no `failed` field. Every mean in `aggregate` is over counted games; `aggregateAll` repeats the sections over all finished games (turn-limit included), labelled as such.
- **Win credit** = 1 for a sole top score, 1/k when k players tie on top VP (ties split). `tieBreak*` fields use the engine's winner instead (R20.5 tie-breaks applied).
- **In-play VP** = VP of the sources booked while the game runs. **Final-scoring VP** = `buildingsEnd`, `goals`, `ponyEnd`, booked when the game ends.
- Numbers are rounded to 6 decimals. Every `se` is a standard error; `null` means "does not exist" (an empty set, fewer than two values, a metric not collected in `--fast` mode). Fields marked **(full)** exist only when events were collected, i.e. without `--fast`.
- Time lives under keys called `timing` only (`run.timing`, `games[].timing`). Drop every `timing` key and two runs with the same seeds are byte-identical, whatever the thread count.

## Top level

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `run` | How the run was made (below). |
| `arms` | One or two objects: `test`, then `baseline` when `--baseline` was given. |
| `comparison` | `null`, or the test arm against the baseline (below). |
| `failures` | Every failed game of every arm: `{ arm, index, seed, type, seat, hash, action, reason }`. `type` is `refusal` (the engine threw `ILLEGAL_ACTION` for a bot's choice; `action` is that action, `reason` the engine's sentence), `cap` (the decision cap was reached), `error` (a crash; `reason` has the first stack lines) or `integrity` (the VP announced by `vp` events differed from the score). `hash` is `hashState` of the state at the failure. Empty on a clean run; the process exits 1 otherwise. |

## `run`

| Field | Meaning |
|---|---|
| `date`, `dateUk` | Start time: ISO 8601 UTC, and `DD/MM/YYYY HH:mm` in Europe/London. |
| `engineCommit`, `engineDirty` | Short git commit of the repo (null if git is unavailable); whether `src/engine` or `src/bots` have uncommitted changes. |
| `nodeVersion`, `commandLine` | The command line as given (`node sim/sim.mjs <args>`). |
| `label` | The label used for the file name. |
| `seed`, `seedIsDefault` | The base seed. Game k of an arm is played on the seed `"<seed>-<k>"`, the same in both arms. |
| `gamesPerArm`, `players` | |
| `bots` | One per bot slot, in `--bots` order: `{ level, weights, type }`. `weights` is the object passed to that bot, or null. |
| `rotate`, `shuffleSeats` | With `rotate`, slot j sits at seat `(j + k) mod players` in game k. Without `shuffleSeats`, slot order is seat order. |
| `jitter`, `weights`, `weightsSeat` | As given (`weightsSeat` is 1-based, null = weights go to every bot). |
| `budgetMs`, `iterations`, `timeBudgeted` | `--budget`, `--iterations`. `timeBudgeted` is true when a bot thinks for a time budget, so the run is not reproducible. |
| `mode` | `full` (events collected) or `fast`. |
| `maxDecisions` | The livelock guard: decisions allowed in one game. |
| `baseline`, `threads` | |
| `warnings` | Strings the summary prints as NOTE lines (no jitter, `--fast`, time-budgeted bots, ...). |
| `timing` | `wallMs`, `gamesPerSecond` (all arms together), `cpuMsPerGame` (mean play time of a game in one thread). |

## `arms[]`

| Field | Meaning |
|---|---|
| `name` | `test` or `baseline`. |
| `variants` | All 25 variants, resolved (`resolveVariants`). |
| `variantsNonDefault` | Only the ones that differ from the default (`nonDefaultVariants`). |
| `constants` | The `--const.*` overrides passed to `createGame` (`{}` for none; always `{}` in the baseline). |
| `gamesKept` | Whether `games` holds the records. |
| `aggregate` | Statistics over counted games (below). |
| `aggregateAll` | The same sections over all finished games, plus `basis`, `note`, `counts`, `headline`. |
| `games` | Per-game records (below), in game-index order, or `null` if not kept. |

## Per-game record (`arms[].games[]`)

Keys exist in every record unless marked **(full)**. A failed game has only `index`, `seed`, `seats`, `startPlayer`, `failed`, `decisions`, `timing`.

| Field | Meaning |
|---|---|
| `index`, `seed` | Game number from 0; its seed. |
| `seats` | Bot type at each seat. |
| `startPlayer` | Seat holding the start-player marker when the game began. |
| `end` | End reason: `transcontinental`, `routes-claimed`, `turn-limit`. |
| `triggeredBy`, `triggeredOn` | Seat and global turn number of the turn on which the end was triggered. |
| `turns` | Turns taken by each seat. `turnsTotal`: the engine's global turn counter at the end. |
| `decisions` | Decisions the bots made (the driver's calls to `applyAction`), setup included. `setupDecisions`: those during setup (railheads, starting choices). `forced`: actions the engine applied itself because only one was legal (all of the game, setup included). |
| `scores` | Final totals per seat. `rank`: engine rank per seat (1 = winner, always unique). `winner`: the engine's winner seat. |
| `vp` | Per seat, VP by source at the end (`scoreGame().players[i].bySource`); keys only for sources in play. |
| `actions` | Per seat, count of each action type CHOSEN by the bot. Forced actions are not here. |
| `auto` **(full)** | Per seat, count of each action type applied by the engine itself (`auto: true` events). |
| `districts` **(full)** | Per seat, how often each district `D1`..`D9` (and `none`, R5.4.4) was chosen, forced choices included. |
| `hatsSpent` **(full)** | Per seat, turns on which a cowboy hat was spent. |
| `congress` **(full)** | Per seat, Congress entries taken, by entry id, free entries included. |
| `bonus` **(full)** | Per seat, bonus actions taken (R7) by `hire`, `hat`, `carriage`, `upgrade` (counted from the payment, so Pony Express card 28's free bonus action is not counted). |
| `built` **(full)** | Per seat, tiles built by terrain. `gathered`: per seat, resources and coins gathered by item. |
| `lobby` **(full)** | Per seat `[lobby points gained, lobby points lost]`. |
| `displaced` **(full)** | Per seat, workers of others displaced by this seat. `discards`: per seat, items discarded for storage overflow. |
| `trace` **(full)** | In-play VP of every seat, `[seat1, seat2, ...]`, after each round (when the turn counter is a multiple of the player count, and once more at the end; the last row is the in-play total at the end). Present only when games are kept. |
| `leadChanges` **(full)** | Times the unique leader (in-play VP, checked at the end of every turn) differed from the previous unique leader. Ties change nothing. The position at the end of a turn is read when the next turn starts, because the engine books end-of-turn milestones (R16.9) after its `turnEnd` event. |
| `halfLeaders` **(full)** | Seats tied for the in-play lead after floor(R/2) of the R trace rows. |
| `quarters` **(full)** | In-play VP, all seats together, earned in each quarter of the game (trace rows rounded to R/4, R/2, 3R/4, R). Sum = in-play VP; `sum(scores) - sum(quarters)` = final-scoring VP. |
| `legal` **(full)** | Decision-space counters over decisions made in play (setup excluded): `n` decisions, `sum` legal actions offered, `distinct` summed count of distinct action types offered, `max` largest list, `turnStart` `[n, sum, distinct]` for the first decision of each turn, `byKind` `{ frameKind: [n, sum, distinct] }`. |
| `routes` | Per seat `{ n, byLength: { length: count }, slots: { ground, tunnel, bridge } }`, from the final map. |
| `buildings` | Per seat `{ railway, telegraph }` on the map at the end. |
| `unlaid` | Per seat, BUILT tiles never laid, by terrain. |
| `left` | Per seat, `iron`, `wood`, `gunpowder`, `coins`, `hats` left. |
| `upgrades` | `null` if the module is off, else per seat `[[tileId, globalTurnInstalled|null], ...]` (turn null in `--fast`). |
| `milestones` | `null` if off, else `{ inPlay: [ids], claimed: [[id, seat, globalTurn|null], ...] }`. |
| `goals` | `null` if off, else `{ inPlay: [ids], awards: { id: [VP per seat] } }` (the standing at the end). |
| `agenda` | `null` if off, else the Legislative Agenda card in force (`LA7`). |
| `pony` | `null` if off, else `{ tokens: [[collected, held at end] per seat], held: [[card ids held at the end] per seat], bought, exchanged, used }`; the last three are **(full)**: `bought` `[[card, seat, globalTurn], ...]`, `exchanged` tokens returned for resources per seat, `used` once-per-turn abilities used per seat. |
| `completion` | `null`, or `{ seat, turn, route }`: who completed the transcontinental line (R19.2), on which global turn, with which route. |
| `failed` | Only on a failed game: `{ type, seat, hash, reason, action? }` as in `failures`. |
| `timing` | `{ ms }` play time of the game. |

## `aggregate`

Counted games. Sections:

| Field | Meaning |
|---|---|
| `basis` | `counted`. |
| `counts` | `games`, `finished`, `failed`, `counted`, `turnLimit`, `turnLimitPct` (of finished), and the failure counts `refusals`, `decisionCapHits`, `errors`, `integrity`. |
| `endReasons` | `{ reason: { games, pct, se } }` over all finished games, the turn-limit ones included. |
| `n` | Counted games. Every section below is absent when `n` is 0 (only `{ n: 0 }`). |
| `bySeat[]` | `{ seat, n, wins, winRate, se, fair, sigma, tieBreakWins, tieBreakWinRate, meanRank, score }`. `wins` = sum of win credit; `winRate` = wins / n; `se` = sqrt(p(1-p)/n); `fair` = 1/players; `sigma` = (p - fair) / sqrt(fair(1-fair)/n); `score` = `describe` block (below). |
| `firstPlayer` | Win credit of the seat holding the start marker at the start (`n, wins, winRate, se, fair, sigma`). |
| `byType[]` | As `bySeat` but per bot type, counted per seat taken (`n` = seats, `games` = games the type played in). `fair` is 1/players per seat. |
| `seatTypeCounts` | `{ type: [games with this type at seat 1, seat 2, ...] }`; with `--rotate` these are equal when games is a multiple of the player count. |
| `vpTieForFirst` | `{ n, value, se }`: share of games where players tied on top VP (settled by the tie-breaks of R20.5 in the engine). |
| `score`, `winningScore`, `winnersScore`, `restScore` | `describe` blocks: all players' scores; the top score of each game; scores of rank-1 players; scores of the others. `describe` = `{ n, mean, median, sd, se, min, max }` (`sd` sample, `se` = sd/sqrt(n)). |
| `marginPct` | `describe` of (top - second) / top x 100. `within10`: `{ n, value, se }`, share of games with margin of 10% or less. |
| `length`, `lengthHistogram` | `describe` of the most turns any player took; `[{ from, to, games }]` in bins of 10 turns. |
| `leadChanges`, `leaderAtHalf` **(full)** | `describe` of lead changes; `{ n, value, se, fair, sigma }`: how often the half-time leader won (win credit shared among leaders who tied). |
| `decisions` | `perGame`, `forcedPerGame`, `perTurn` (play decisions per turn): `describe` blocks. |
| `legalActions` **(full)** | `perDecision` and `distinctTypesPerDecision` (pooled means over all play decisions), `atTurnStart` and `distinctTypesAtTurnStart` (the first decision of each turn), each with `...Se` (ratio-estimator error over games), `max`, `playDecisions`, and `byKind` `{ frameKind: { decisions, meanLegal, meanDistinctTypes } }`. |
| `vpBySource[]` | `{ source, final, meanPerPlayer, share, shareSe, shareWinners, shareRest }`: share of all VP, and of winners' VP and the rest's. |
| `largestVpSource` | `{ source, share }`. |
| `vpByQuarter` **(full)** | `shares` (4 values, each a share of ALL VP including final scoring), `shareSes`, `finalScoring` (+`Se`), `finalQuarterWithEndScoring` (+`Se`: quarter 4 plus final scoring), `inPlayShares` (shares of in-play VP only). |
| `actionMix` | `counts` and `share` of actions chosen, `byBotType` (shares), `forcedCounts` (full; forced actions by type), `forcedShare` (forced / all applied). |
| `actionTypesNeverChosen` | Engine action types no bot chose in any game, apart from the ones of modules that are off. Zero use is a plumbing bug first. |
| `districts` **(full)** | `counts`, `share`, `byBotType`. |
| `routes` | `perGame` (`describe`), `fillShare`, `perPlayer` (+`Winners`, `Rest`), `byLength` (mean per player), `slotsByTerrain` (mean slots per player), `available` (routes on the map, by length). |
| `buildings` | Mean railway and telegraph stations per player; total per winner and per other player. |
| `completion` | `{ n, value, se }` share of games with a transcontinental line, `bySeat` (share of games completed by each seat), `meanTurnShare`. |
| `leftovers` | Per player at the end: `unlaidTiles` by terrain, `unlaidTilesTotal` (+`Winners`, `Rest`), `resources` (+`Winners`, `Rest`). |
| `economy` **(full)** | Per player per game: `gathered`, `built`, `lobbyPointsGained`, `lobbyPointsLost`, `hatsSpent`, `workersDisplaced`, `storageDiscards`. |
| `bonusActions` **(full)** | `perPlayer` and `rate` (share of players taking at least one) by bonus action. |
| `congress` **(full)** | `perGame`, `taken` and `perGameById` by entry id of the table in play, `neverTaken`. |
| `modules` | One block per module that is on: `upgrades`, `milestones`, `goals`, `legislative`, `pony`. Each lists every item of its table with usage counts and rates (Pony Express also has `tokensCollectedPerPlayer`, `tokensHeldAtEndPerPlayer`, `tokensSpentPerPlayer` = collected minus held at the end, on cards or exchanged for resources), and the items never used (`neverInstalled`, `neverClaimed`, `neverInPlay`, `neverPaid`, `neverInForce`, `neverBought`). `winRateWithWithout.items[]` = `{ id, nWith, winRateWith, seWith, nWithout, winRateWithout, seWithout, diff, small }` per player; `small` is true when either side has 30 or fewer players. Milestones and goals count only games in which the item was in play; a Pony Express card's "without" includes games in which it never reached the market. |
| `subsystems[]` | `{ id, kind, n, value, se, games }`: share of games using each add-on module (`kind: module`, only those on), each core action family (`action`) and tolls (`vp`). The health table's zero test. |
| `headline` | A flat map `{ id: { label, value, se, n } }` of every headline metric. The comparison and the report generator read this. |
| `healthBasis` | `counted`, or `all-finished` when fewer than 30 games were counted (the table then reads every finished game, since a handful of counted games would make it meaningless). |
| `health` | The health table as data (below). |

## `aggregateAll`

`{ basis: 'all-finished', note, counts, <the sections above>, headline }` over every finished game. No `health` and no `endReasons` (those are in `aggregate`).

## `health[]`

One row per entry of `HEALTH_TABLE` in `sim/health.mjs` (the subsystem row is expanded to one per subsystem, with ids like `usage.pony`). Fields:

| Field | Meaning |
|---|---|
| `id`, `label` | Row id and its name. |
| `value` | The measured figure (`null` when it does not exist: `--fast`, no counted games). |
| `unit` | `%`, `VP`, `games`, `% of games`, or empty. |
| `healthy` | The rule in words (`15 to 22`, `at least 25`, `under 45`, `exactly 0`, `above 0`, `within 2 sigma of the fair share 1/players`). |
| `status` | `pass`, `warn` or `n/a` (no figure, or no target set: the winning-score row stays `n/a` until a design target is put in the table). |
| `badReading` | What a warning means (from the skill's table). |
| `sigma` | On the first-player row only: its sigma from the fair share. The rule there is |sigma| < 2. |
| `detail` | On the largest-VP-source row only: which source. |

## `comparison`

`null` without `--baseline`; else:

| Field | Meaning |
|---|---|
| `note` | How to read it. |
| `preferred` | `counted`, unless either arm has fewer than 30 counted games, when it is `all-finished` (a comparison of two or three games means nothing). |
| `countedGames` | `{ test, baseline }`: counted games in each arm. |
| `counted`, `allFinished` | Each `{ basis, metrics[] }`: the same comparison over counted games and over all finished games. |

Each element of `metrics[]` covers one headline id that both arms hold:

| Field | Meaning |
|---|---|
| `id`, `label` | The headline id and its name. |
| `test`, `testSe` | The test arm's value and standard error. |
| `baseline`, `baselineSe` | The same for the baseline arm. |
| `diff` | test - baseline. |
| `diffSe` | sqrt(testSe^2 + baselineSe^2): independent samples (the arms share game seeds, but once a rule differs the games diverge). `null` if either error is unknown. |
| `z` | diff / diffSe. |
| `exceedsTwoSe` | true when \|diff\| > 2 x diffSe. With roughly 50 rows, 2 or 3 will exceed 2 SE by chance. |

## Headline ids

`winRate.seat1`..`seat4`, `winRate.firstPlayer`, `winRate.type.<type>` (when several types), `score.mean`, `score.winning`, `margin.mean`, `margin.within10`, `length.mean`, `decisions.perTurn`, `leadChanges.mean`, `leaderAtHalf.winRate`, `legal.perDecision`, `legal.atTurnStart`, `legal.distinctPerDecision`, `vpShare.<source>`, `vp.finalQuarter`, `routes.perGame`, `completion.rate`, `unlaidTiles.perPlayer`, `usage.<subsystem>`, `turnLimit.share`, `end.<reason>`. Shares and rates are fractions (0 to 1).

## Definitions worth knowing before reading a number

- **Lead changes** are measured on in-play VP at the end of every turn. A game with a long tie for the lead has few.
- **Half-time** is half the rounds played, not half the VP.
- **Legal actions** are counted at decisions made in play. A turn is several decisions (worker, district, steps, Congress, buildings); the health table reads the first decision of each turn because that is where the turn's real choice sits.
- **Forced** actions (one legal action) are applied by the engine and never reach a bot, so they are absent from `actions` and from every "what players chose" figure.
- **`--fast`** drops: `auto`, `districts`, `hatsSpent`, `congress`, `bonus`, `built`, `gathered`, `lobby`, `displaced`, `discards`, `trace`, `leadChanges`, `halfLeaders`, `quarters`, `legal`, the turns inside `upgrades` / `milestones`, and `pony.bought` / `exchanged` / `used`; and with them the sections built from those.
- **Bookkeeping check** (full mode): the VP the `vp` events announced for every seat and source must equal `scoreGame`'s `bySource`; a mismatch fails the game as `integrity`.
