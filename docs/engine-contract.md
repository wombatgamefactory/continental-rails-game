# Continental Rails - engine contract

- Contract version 1 (11/10/2026). The core rules and the four add-on modules are implemented. State `schemaVersion`: 1.
- Rules: the engine follows the designer's rules text, which is not part of this repository. Rule numbers (`R11.5.4`) refer to it and are cited throughout and in code comments.
- Status: **binding** for the engine, the bots, the simulator and the UI. If the contract has to change, change this file in the same piece of work and say so in the commit message. Nobody works round it.

What is binding and what is not:

| Binding | Not binding (may change with a note here) |
|---|---|
| The public functions and their signatures (section 2) | Fields of a pending decision other than `kind` and `player` |
| The state shape outside `state.stack` (section 3) | Wording of player-facing sentences |
| Action types and their parameters (section 5) | Event fields beyond `type`, `seq`, `player` (new fields may be added) |
| The auto-advance rule and the stop actions (section 4) | Internal helper functions |
| Module namespacing (section 11), VP source ids (section 9) | |

Contents: 1 the model - 2 public API - 3 state shape - 4 decisions - 5 action catalogue - 6 block reasons - 7 hidden information - 8 RNG - 9 scoring - 10 variants and constants - 11 modules - 12 effect encoding - 13 events - 14 bots - 15 files - 16 speed - 17 identifiers - 18 tests - 19 how to add a rule - 20 how the engine reads the rules where they are silent or ambiguous.

---

## 1. The model in one page

The game state is one plain JSON object. It holds a **stack of pending decisions**, `state.stack`. The last element is the decision being asked now; `state.toAct` is the player it is asked of.

Every choice a player makes, of any size, is **one atomic action** taken from `getValidActions(state)`. Applying it with `applyAction(state, action)` changes the state and then runs the game forward by itself until the next real choice. So this loop plays a whole game, from the first railhead to final scoring, with no other knowledge of the rules:

```js
import { createGame, getValidActions, applyAction, isGameOver, scoreGame } from './src/engine/index.js';

const state = createGame({ playerCount: 4, seed: 12345 });
while (!isGameOver(state)) {
  const actions = getValidActions(state);       // all legal next actions, all for state.toAct
  const action = choose(state.toAct, actions);  // a click, a random pick, a heuristic, a tree search
  applyAction(state, action);                   // never refuses an action from the list
}
const result = scoreGame(state);
```

The random bot, the heuristic bot, Monte Carlo search, the simulator and the UI all drive the engine this way and no other way.

Three promises make the loop safe:

1. **Complete.** `getValidActions` returns every legal next action. If a rule lets the player stop, the list holds an explicit stop action.
2. **Sound.** Every action in the list is accepted by `applyAction`. The list is built by filtering candidates through the same block-reason functions that `applyAction` asks, so the two cannot disagree.
3. **Never a non-choice.** On a state that came from `createGame` or `applyAction`, the list has 0 entries (the game is over) or at least 2. A decision with exactly one legal action is applied by the engine itself (section 4.3).

---

## 2. Public API

Import everything from `src/engine/index.js`. Nothing in `src/ui`, `src/bots`, `sim` or `tests` imports another engine file directly (tests may, for an internal helper, and say so).

### 2.1 Games

| Function | Returns | Notes |
|---|---|---|
| `createGame(config, { rng }?)` | state | Builds the table and runs forward to the first decision (the first railhead of R3.5). `config` below. `rng` is an RNG from `makeRng`, used in place of `config.seed`; it is copied, never kept or advanced. |
| `getValidActions(state)` | `action[]` | Complete list for `state.toAct`. Fresh objects. `[]` only when the game is over. Does not copy or change the state. |
| `applyAction(state, action, options?)` | `event[]` or `null` | Changes `state` in place, then auto-advances. Throws `Error` with `code: 'ILLEGAL_ACTION'` and `reason` (the sentence) if refused; the state is then untouched. `options` is `{ events: boolean }`; pass the exported `SILENT` to skip event collection (returns `null`). |
| `getBlockReason(state, action)` | `string` or `null` | `null` = legal now. Otherwise the first blocker in rulebook order, as a sentence for the player. Asked for `action.player` if present, else for `state.toAct`. |
| `getStructuralBlockReason(state, action)` | `string` or `null` | The same question with timing left aside: "if it were my move of the right kind, could I?" For tooltips ahead of time and for bots that plan. |
| `isGameOver(state)` | boolean | `state.phase === 'ended'`. |
| `scoreGame(state)` | score object | Section 9. Callable at any time. |
| `replayGame(config, actions, { rng }?)` | state | `createGame` then each action. Throws naming the position of the first refused action. |
| `getGameConfig(state)` | config | The config that recreates this game, read back from any state of it (it carries the starting RNG as `rngStart`). `replayGame(getGameConfig(state), actions)` rebuilds the state, so a bug report needs only a state and the actions taken. |

`config`:

```js
{
  players: [{ name: 'Anna', colour: '#b33' }, ...], // 2 to 4, in setup-screen order; or:
  playerCount: 4,
  seed: 12345,               // number or string; required unless options.rng is given
  variants: { conversionRate: '1:1' },          // overrides, checked by resolveVariants
  constants: { SCORING: { vpPerSlot: 2 } },     // overrides of rules.js, by group (section 10)
  shuffleSeats: true,        // default true: R3.2. false keeps the order given.
  rngStart: { s: 123 }       // optional: an RNG to start from in place of `seed` (what getGameConfig records)
}
```

`createGame` throws on: a player count outside 2 to 4; no seed, `rngStart` or `options.rng`; an unknown variant or illegal value; an unknown or misshapen constant; a variant value listed in `UNIMPLEMENTED_VARIANT_VALUES` (so a game never silently plays a different rule from the one asked for).

A game is a pure function of `(config, seed, list of actions)`.

### 2.2 State as a value

| Function | Notes |
|---|---|
| `cloneState(state)` | Fast structural copy, not a JSON round trip (about 9 microseconds; JSON takes about 26). Shares `config`, `variants` and `constantOverrides`, which are frozen. Equal to the JSON clone, key order included. |
| `hashState(state)` | 16 hex characters over the whole state including RNG and hidden deck orders, excluding `config`. Stable across `cloneState` and a JSON round trip. Two states with the same hash play out identically. About 13 microseconds. |
| `serialiseState(state)` / `deserialiseState(text)` | JSON text. `deserialiseState` refuses another `schemaVersion` or map. |
| `determinise(state, rng)` | Section 7. |
| `hiddenDecks(state)` | The hidden-order arrays, for tests. |
| `getConstants(state)` | Section 10. |
| `topFrame(state)` | The pending decision or `null`. |

### 2.3 Describing things (so that no rules text is composed in the UI)

| Function | Returns |
|---|---|
| `describeDecision(state)` | `{ player, kind, prompt }` or `null`. `prompt` reads `"Anna: choose the district whose action you take"`. |
| `describeAction(state, action)` | A short imperative phrase: `"Place a worker on W4"`. Also on every `action` event as `text`. |
| `actionKey(action)` | Canonical text key, `"chooseDistrict:D5:true"`. Equal actions give equal keys. For maps, search trees, logs. |
| `getActionSpace(state)` | Every well-formed action of every type, legal or not. For diagnostics: the bug reporter runs `getBlockReason` over it. Not for bots. |
| `previewMultipliers(state)` | During the district choice: `[{ district, hat, multiplier, adjacent }]` (R5.6). |
| `canSpendHat(state, playerId)` | R14.2. |
| `frameLabel(state, frame)` | The verb phrase of a pending decision. |

### 2.4 Reads (queries.js)

Players and order: `getPlayer`, `playerName`, `activePlayerId`, `nextPlayerId`, `playersAfter`, `lastSeatId`.
Player board: `production(state, playerId, track)` (R6.2), `housesOnBoard(player)`.
Storage: `storageUsed(player)`, `storageCapacity(state, playerId)`, `storageOverflow`, `storedCount(player, item)`, `cargo(player)`.
Costs: `canPay(player, cost)`, `firstShortfall(player, cost)`, `addCosts`, `formatCost(state, cost)`, `formatAmount(K, key, n)`.
Train: `specialistCarriageCount`, `carriageCount`, `nextSpecialistSlot(player)` (R8.6.1), `specialistCounts(state, playerId)`, `specialistSlotUse(player)`, `hireCost(state, playerId, specialist, mode)` (R8.6.3, R7.4).
Grid: `districtTileId`, `districtInfo`, `districtName`, `workersOnGrid`, `hasCentreWorker`, `adjacencyLocations(district)`, `adjacentWorkers(state, playerId, district, excludeAt)` (R5.6.2), `multiplierFor(state, playerId, district, spendHat, excludeAt)` (R5.6.1), `accessDistricts(state)`.
Map: `claimedRouteCount`, `isCityConnected` (R1.21), `ownedRoutes`, `ownedSlots`, `railwayStationCount`, `telegraphStationCount`, `buildingCount`, `railheadsAt`.
Score: `totalVp(player)`.

Static data: everything in `rules.js` (`RULES` and its groups), `variants.js` (`VARIANTS`, `resolveVariants`, ...) and `board.js` (`MAP`, `DISTRICT_IDS`, `SPACE_IDS`, `SPACE_DISTRICTS`, `DISTRICT_SPACES`, `DISTRICT_NEIGHBOURS`, `junctionCities`, `cityRegion`, ...).

Not public: the functions that change the state piecemeal (`pushFrame`, `popFrame`, `pay`, `gainResource`, `gainCoins`, `gainHats`, `gainBuiltTiles`, `gainItems`, `ensureDiscard`, `emit`, `createInitialState`, `applyEffects`, `pushTrainActivation`, `pushLayTracks`). Engine files import them from each other; nothing outside the engine may call them. Outside the engine the state changes only through `applyAction`.

Reads for the core rules (all exported from `index.js`):

- `queries.js`: `routeCost`, `routeShortfall(player, route)`, `canAffordRoute(player, route)`, `routeName(route)`, `formatRouteCost(state, route)` (R11.4.3); `networkCities(state, playerId)` (R11.11.2); `hasOpponentRailwayStation(state, city, playerId)` (R13.9); `reachableCities(state, from)`, `touchesClaimedRoute(state, city)` (R12.2, R12.6); `moveTrainPath(state, playerId, from, to)` (R12.3: `{ cities, routes, tollCities }` or null); `hasTranscontinentalLine(state, playerId)` (R19.1, R19.7); `buildingRoom(state, city)`, `nextTelegraphVp(state, playerId)` (R13).
- `legality.js`: `hasLegalClaim(state, playerId)`, `hasLegalMove(state, playerId)` (R4.6.3); `waitingStep(frame)`, `describeStep(state, step)` (R9.4); `congressTable(state)`, `congressCoinCost(state, playerId, entry)`, `anySenatorUsed(state)` (R10); `claimRailheadIndex`, `moveRailheadIndex` (R11.3); `placementContext(state, playerId)`, `canPlaceAnyBuilding(state, playerId, ctx)` (R13).

Reads for the modules (all exported from `index.js`; every one answers "nothing" when its module is off):

- `queries.js`: `cardIndex(table)`, `upgradeTileData`, `ponyCardData`, `installedUpgrades(state, playerId)` (R15.4), `upgradeTileAt(state, playerId, level)`, `activationTile(state, playerId, level)` (R15.5.1, R15.6: the tile whose step belongs in an activation), `legislativeCardData(state)` (R17.1), `ponyOngoing`, `standingEffects(state, playerId)` (R17, R18.9), `ponyModifier(state, playerId, what)`, `ponyAbilities` (R18.8), `ponyTokens` (R18.3), and the measures of R16.5 / R16.8 / R18.7: `completeSpecialistSets`, `maxSpecialistsOneType`, `specialistTotal`, `ownedSlotsOf(state, playerId, terrain?)`, `ownedRouteCount`, `longestOwnRoute`, `startCitiesJoined`, `inlandCitiesOnOwnRoutes`, `citiesWithBothOwnBuildings`, `citiesWithOwnBuilding`, `telegraphsWithOpponentRailway`, `cityHasOpponentBuilding`, `isJunctionCity`, `minNorthSouthBuildings`, `buildingsInJunctionCities`. `production` adds Pony Express card 36's bonus (R6.4.2).
- `conditions.js`: `METRICS` (one entry for every name of `METRIC_NAMES`), `metricValue`, `evaluateCondition`, and **`describeProgress(state, playerId, item)`**: `item` is a milestone tile, a goal card or a bare condition; it returns `{ known, value, target, met, text }` with `text` such as `"4 of 6 Tunnel slots"`, `"2 railway stations on the map"` or `"Your two starting cities are not yet joined"`. An unknown metric gives `{ known: false, met: false, text: 'Not tracked' }`.
- `scoring.js`: `goalStandings(state, goal)` (`{ goal, values, places, awards }`, the ranking of R16.3 and R16.4 on the current position) and `goalsInPlay(state)`.
- `legality.js`: `hasFreeAction(state, playerId)` (R4.4: whether an opportunity is worth asking), `freeBonusOptions(state, playerId)` (card 28), `cardPartFeasible`, `BONUS_ACTION_TYPES.upgrade`.
- `state.js`: `cardRemoved(card, variants)` (the `removedWhen` of R11.11.6 and R13.7).

Rule: **a function that takes only the state and returns only data lives in the engine, never in `src/ui`.**

---

## 3. State shape

Plain JSON throughout: objects, arrays, strings, finite numbers, booleans, `null`. Never `undefined`, functions, Dates, Maps, Sets or class instances. Collections over board elements are objects keyed by the element's id (`spaces.W4`, `routeOwner['SEA-SPO']`), so an action's id indexes the state directly.

No derived data is stored. Everything that can be computed from the fields below is computed by a query. (There are no caches at present; if one is ever added it must be documented here, be plain JSON, and be covered by the clone and hash tests.)

```js
state = {
  schemaVersion: 1,

  // --- fixed at createGame; frozen; shared by cloneState ----------------------
  config: { playerCount, players, seed, rngStart, shuffleSeats, mapId },   // how the game was created; play never reads it
  variants: { ...all 25 resolved variants },            // section 10
  constantOverrides: null | { GROUP: { key: value } },  // section 10
  constantsKey: null | string,                          // JSON text of the overrides (cache key)

  // --- randomness ---------------------------------------------------------------
  rng: { s: int32 },             // the game's own RNG (section 8)

  // --- where we are -------------------------------------------------------------
  seq: 0,                        // number of actions applied so far, forced ones included
  phase: 'setup' | 'play' | 'ended',
  setup: null | { step, index, part },   // progress of R3.5 to R3.7; null once play begins
  turn: {
    number: 0,                   // 1-based count of turns; 0 during setup
    player: null | playerId,     // the ACTIVE player (R4.2); null in setup and after the end
    step: null | 'start' | 'freeBefore' | 'worker' | 'district' | 'resolve' | 'followUp' | 'freeAfter',
    hatsAtStart: 0,              // R14.2: only these can be spent this turn
    worker: null | { via: 'place' | 'remove' | 'displace', at: 'W4' | 'D5' },
    district: null | 'D1'..'D9' | 'none',   // 'none' is R5.4.4
    hatSpent: false,
    multiplier: null | M,        // R5.6, fixed when the district is chosen
    adjacent: null | A
  },
  startPlayer: 0,                // holder of the start player marker (moves at each round end with turnStructure = rounds, R4.8.3)
  stack: [ frame, ... ],         // pending decisions; the last is asked now (section 4)
  toAct: null | playerId,        // always the player of the last frame; null when the game is over

  // --- players, index = player id = seat - 1 ----------------------------------------
  players: [{
    id: 0, configIndex: 2,       // configIndex: position in config.players (seats may be shuffled)
    name: 'Anna', colour: null | '#b33',
    coins: 1,
    hats: 0,
    resources: { iron: 1, wood: 1, gunpowder: 1 },   // in storage
    builtTiles: { ground: 0, tunnel: 0, bridge: 0 }, // BUILT tiles in storage (R1.13). Not on the map.
    houses: { wood: 3, coins: 3, iron: 2, gunpowder: 3 }, // houses still on each track of the player board
    telegraphsPlaced: 0,         // telegraph stations that have left the telegraph row (0 to 7)
    workersInSupply: 3,
    train: {
      specialistCarriages: [{ slots: ['crew', null] }],  // index = level - 1 (R8.2)
      storageCarriages: 1
    },
    railheads: ['SEA', 'OMA'],   // city ids; null until placed in the draft
    startCities: ['SEA', 'OMA'], // where the railheads started (milestone MS7)
    bonusActionsUsed: { hire: false, hat: false, carriage: false, upgrade: false }, // R7.2 once-per-game; keys only for bonus actions in play
    turnsTaken: 0,
    vp: { track: 0, firstConnection: 0, ... }   // by source (section 9); keys only for sources in play
  }],

  // --- shared boards ---------------------------------------------------------------
  grid: {
    tiles:   { D1: 'gather-gunpowder', ... D9: 'gather-coins' }, // district tile on each position (R5.1, R5.8)
    spaces:  { W1: null | playerId, ... W12 },   // worker spaces (R5.2)
    centres: { D1: null | playerId, ... D9 }     // district centres (R5.5)
  },
  map: {
    routeOwner:       { 'SEA-SPO': null | playerId, ... },  // 47 routes; a claimed route holds LAID tiles
    railwayStation:   { SPO: null | playerId, ... },        // 17 inland cities (R13.1)
    telegraphStation: { SPO: null | playerId, ... }
  },
  supply: { specialists: { crew: 12, miner: 12, engineer: 12, financier: 12 } }, // R2.1, limited
  congress: { used: { C1: false, ... } },   // one senator per non-Reset entry of the table in play (R10.2)
  scoringCard: null | 'ground' | 'tunnel' | 'bridge',   // R11.9
  completion: null,              // null, or { player, turn, route } once the transcontinental line of R19.2 has been completed (once per game)
  gameEnd: null | { reason, triggeredBy, triggeredOnTurn },   // set when the end is TRIGGERED (R19.5); reason is one of END_REASONS

  // --- add-on modules -----------------------------------------------------------------
  modules: {}                    // one key per module that is ON (section 11); { upgrades?, milestones?, goals?, legislative?, pony? }
}
```

Build and lay are different fields on purpose. A train activation adds to `player.builtTiles`. A claim subtracts from `player.builtTiles` and sets `map.routeOwner`. Nothing else connects them.

`production` of a track is `1 + (3 - houses[track])`. A railway station placed on the map (R13.2) takes one from `houses[track]`; the piece is then counted in `map.railwayStation`, never as a house.

---

## 4. Decisions

### 4.1 The stack

A pending decision is a **frame**: `{ kind, player, ...fields }`. `kind` selects an entry of `FRAMES` (legality.js), which knows how to list its legal actions. Frames are pushed and popped only by `pushFrame` and `popFrame` (state.js), which keep `state.toAct` equal to the player of the top frame.

A frame is a permission, not a completed effect. An entitlement that a rule grants ("you may now take the bonus action") is a frame; it is resolved by an action or closed by an explicit stop action. Nothing is ever resolved outside the engine, so there is no `autoResolveEntitlements` and a bot cannot forfeit a choice by accident.

Consumers read `kind` and `player` only. For anything else about what is pending they use `describeDecision`, `getValidActions` and the queries the engine exports for that decision.

### 4.2 The flow between decisions

When the stack is empty the flow runs one step and looks again:

- **Setup** (`state.setup.step`): first railheads in reverse seat order (R3.5.1), second railheads in seat order (R3.5.2), then for each seat the two starting choices (R3.6), then compensation in seat order (R3.7), then turn 1 (R3.9).
- **A turn** (`state.turn.step`, R4.2):

| step | what the flow does when the stack is empty |
|---|---|
| `start` | Records `hatsAtStart` (R14.2), starts the module's per-turn flags afresh (`hookTurnStart`). Then `freeBefore`: with Pony Express on, pushes a `freeActions` frame **if the player has a free action to take** (R4.4); otherwise nothing is asked. |
| `freeBefore` | Pushes `workerStep` (R4.2 step 2). |
| `worker` | Pushes `chooseDistrict` (step 3). Any displacement choices (R5.5.3) were resolved before this. |
| `district` | Runs `DISTRICT_RESOLVERS[family].resolve`: does the action or pushes the frames that do it (step 4). |
| `resolve` | Runs `.followUp` if the family has one (for Gather, the bonus action of R6.6). |
| `followUp` | Then `freeAfter`: the second `freeActions` opportunity under the same condition (step 5). |
| `freeAfter` | `endTurn` (step 6): milestones (R16.9, for every player), end triggers (R19.3, R19.4), then the next turn or, once the end is triggered and the last seat has played, final scoring (R19.5, R20.2). |

`endTurn` replaces `state.turn` with a fresh record, so no per-turn flag can leak into the next turn. A turn cannot end while a frame is pending.

**With `turnStructure = rounds` (R4.8)** only step 6 differs. The worker step offers Place and Displace, never Remove (R4.8.1). After a turn, the next player is the next clockwise **with a worker in supply** (R4.8.2). When no player has a worker in supply the round is over (R4.8.3): if the game end has been triggered the game ends now (R4.8.4, whatever the seat), otherwise every worker returns to its owner's supply, `state.startPlayer` passes one seat clockwise, the "once per round" abilities of Pony Express cards become usable again (`pony.roundUsed` is emptied, R4.8.5, R18.8), a `roundEnd` event is emitted, and the new start player begins. Turn counts per player are then unequal, so the checks of R19.5 that say "the same number of turns" do not apply.

### 4.3 The auto-advance rule

> After every applied action the engine keeps going until **the pending decision has more than one legal action**, or the game is over. A decision whose complete list of legal actions has exactly one entry is not a choice: the engine applies that action itself.

A forced action is applied exactly like a player's action: it increments `state.seq` and emits an `action` event, with `auto: true`. It is not part of the list of actions a driver records for replay (`replayGame` regenerates it).

Consequences worth knowing:

- A train-activation step that cannot be paid for is skipped by the engine (only `skipStep` is legal).
- A bonus action that cannot be taken is skipped by the engine (only `skipBonusAction` is legal).
- A player with one legal worker move has it made for them. The UI shows the event.
- The `STOP_ACTION_TYPES` list names the stop actions. A log that wants to stay quiet can drop events where `auto` is true and the action type is in that list: they mean "nothing was possible here".

Some things are not decisions at all and never reach the stack: a Financier step (R9.4: "no cost and no choice"), a fixed upgrade-tile effect, milestone claims (R16.9 is deterministic), the toll, the Move Train path (R12.3.1 works it out).

A decision with zero legal actions is an engine bug and throws. A `RESUME[kind]` entry lets a frame close itself when it has nothing left to ask (a `discard` frame once storage is back at capacity).

### 4.4 Granularity

One action = one choice the rules give the player. Where a rule gives several things at once to choose ("gain 5 resources of your choice"), each unit is its own action: three options five times, not twenty-one combinations once. That keeps the branching factor low for search and lets the UI build every action from one click.

The worker step and the district choice are separate decisions (R4.2 steps 2 and 3), because a displacement puts other players' choices between them. The cowboy hat is part of the district choice (`chooseDistrict { district, hat }`), as R14.2 says it is declared then.

### 4.5 Stop actions

Wherever a rule says "may", the list contains an explicit stop action; a player never stops by doing nothing. Each has `stop: true` in `ACTIONS`.

| Stop action | Where | Rule |
|---|---|---|
| `skipBonusAction` | bonus action after a Gather | R7.1 |
| `skipStep` | a Crew, Miner or Engineer step of a train activation | R9.4.3 |
| `closeCongress` | the Congress window after a step, with lobby points in hand and an entry that could be taken | R9.4.3, R9.4.4 |
| `stopLaying` | after a step of Lay Tracks / Move Train, once at least one step is taken | R11.3 |
| `skipBuilding` | the optional building after a claim or a move; the second building of C6 | R13.4 to R13.6 |
| `endFreeActions` | a free-action opportunity | R4.4 |
| `skipEffect` | an optional part of a card: a hire "up to", card 9's two parts, giving resources back (card 11), the free Congress entries of cards 13 and 24 | R18.7 |
| `declineFreeEntry` | the free entry of Legislative Agenda card 20 | R17.3 |

`STOP_ACTION_TYPES` (legality.js) lists the ones that exist.

### 4.6 Decisions by a player who is not the active player

`state.toAct` and `state.turn.player` are different fields and often differ:

- R5.5.3 with R14.1: a displaced worker's owner who already holds 2 hats chooses a resource. Owners are asked in turn order from the active player's left.
- R8.5.4: any player over capacity discards at once, "on their own turn or not".
- A toll or a card may give another player a choice in the same way.

The engine never chooses for a player where the rules give them a choice. Drivers must always ask `state.toAct`, never assume it is the active player. Each frame names its own `player`.

### 4.7 The frames

Implemented (fields are not binding; `kind`, `player` and what each accepts are):

| kind | fields | accepts | rule |
|---|---|---|---|
| `setupRailhead` | | `placeRailhead` | R3.5 |
| `setupProduction` | | `chooseStartingProduction` | R3.4, R3.6 |
| `setupSpecialist` | | `chooseStartingSpecialist` | R3.6 |
| `chooseResource` | `remaining`, `reason` | `chooseResource` | R1.8; used by R3.7, R14.1, the `gainChoice` effect |
| `discard` | | `discard` | R8.5.4 |
| `workerStep` | | `placeWorker`, `displaceWorker`, `removeWorker` (not with rounds) | R4.2 step 2, R4.8.1 |
| `chooseDistrict` | | `chooseDistrict` | R4.2 step 3 |
| `bonusAction` | `bonus`, `remaining` | the action of that bonus, `skipBonusAction` | R6.6, R7 |
| `trainActivation` | `foreman`, `steps: [{ type, level }]`, `index`, `lobby`, `built: { ground, tunnel, bridge }`, `congress`, `cause` | `useStep`, `skipStep`; while `congress` is true: `takeCongressEntry`, `closeCongress` | R9.4, R10.4 |
| `chooseBuiltTile` | `remaining`, `cause` | `chooseBuiltTile` | R10.7 |
| `chooseOption` | `options: [{ text, effects }]`, `cause`, `vpSource`, `rule` | `chooseOption` | R10.1 C6 |
| `addCarriage` | `cause` | `addCarriage` (free) | R8.7, R10.1 C4 |
| `placeBuildings` | `scope` ('city' or 'connected'), `city`, `cost`, `left`, `allow: { railwayStation, telegraphStation }`, `cause` | `placeRailwayStation`, `placeTelegraphStation`, `skipBuilding` | R13.4 to R13.6 |
| `layTracks` | `taken`, `totals: { routes, slots }`, and the steps left: `steps`, or `claimsLeft: [a, b]` with `movesLeft` | `claimRoute`, `moveTrain`, `stopLaying`; in network mode also `placeRailwayStation`, `placeTelegraphStation` (the station step) | R11.3, R12, R11.11 |

Module frames (the kinds and what they accept are binding; the fields are as built):

| kind | fields | accepts | rule |
|---|---|---|---|
| `freeActions` | `which` (`'before'` or `'after'`) | `buyPonyCard`, `exchangeToken`, `usePonyCard`, `endFreeActions` | R4.4, R18 |
| `hireSpecialist` | `cause`, `remaining`, `free`, `mayStop` | `hireSpecialist`, `skipEffect` (only if `mayStop`) | R8.6.4, cards 6, 9, 27 |
| `chooseForemanType` | `cause`, `foremanTimes` | `chooseForemanType` | R9.2, cards 10, 22, 32 |
| `chooseSpecialistType` | `cause` | `chooseSpecialistType` | card 33 |
| `chooseExtraActivation` | `foreman`, `foremanTimes`, `count`, `cause` | `chooseExtraActivation` | card 15 |
| `exchange` | `max`, `returned`, `cause` | `returnResource`, `skipEffect` | card 11 |
| `freeCongress` | `tier`, `remaining`, `exclude`, `stop` (`'skipEffect'` or `'declineFreeEntry'`), `activation`, `cause` | `takeCongressEntry`, and its `stop` action | cards 13 and 24, Legislative Agenda card 20 |

Existing frames extended by the modules: a `bonusAction` frame with `bonus: 'any'` and `free: true` is Pony Express card 28 (any of the four bonus actions at no printed cost; the player has committed, so there is no `skipBonusAction`); an `addCarriage` frame may be `optional` (accepts `skipEffect`); a `chooseBuiltTile` frame may be `distinct` with the types already `taken` (card 4); a `layTracks` frame given by a card has `steps` and `only` (`'move'` or `'claim'`: cards 3, 5, 14); a `trainActivation` frame counts the Congress `entries` taken in it and may carry `freeEntryUsed` (Legislative Agenda card 20; Pony Express card 20 reads `entries`).

`chooseOption` also serves card 8, card 23 and the order of the parts of card 9 (a choice of "carriage, then hire" or "hire, then carriage"); `addCarriage` and `chooseBuiltTile` also serve cards 2, 4, 8, 9, 17 and 19.

How the larger sequences unfold:

**Train activation (R9.4).** `pushTrainActivation` (actions.js) builds the step list once and pushes one `trainActivation` frame. Foreman steps have `level` 0; a specialist step has the carriage level; an `upgrade` step (level = carriage level) is in the list only if `activationTile` returns a tile: one is installed in that carriage and it is not a VP tile under `upgradeVpTiming = on-install` (R15.6). A card that starts an activation goes through `beginActivation` first: the Foreman's type is chosen (`chooseForemanType`: cards 10, 22 and, for every activation, 32), then Pony Express card 15 asks for the specialist with one more activation (`chooseExtraActivation`), then the list is built; card 33's doubling (`pony.turn.doubled`) is read when the list is built. The frame is walked by its `RESUME` and its mutators, never by a driver:

- A **Financier** step and an **upgrade** step are not decisions: `RESUME` adds the lobby point (or calls `hookUpgradeStep`, which does the `vp`, `gain` and `gainBuiltTile` effects of the tile) and moves on.
- At a **Crew, Miner or Engineer** step the frame asks `useStep` or `skipStep`. A step that cannot be paid has only `skipStep`, so the engine applies it with `auto: true`.
- After **every** step `congress` is set. If `lobby` is at least 1 and some entry can be taken, the frame asks `takeCongressEntry { entry }` for each such entry, or `closeCongress`; taking an entry keeps the window open (several may be taken), `closeCongress` ends the window. If no entry can be taken the engine closes the window by itself.
- The window after the **last** step is the "last chance" of R9.4.4: R9.4.3 and R9.4.4 describe the same moment, so it is asked once, not twice. Then leftover lobby points are lost (`lobbyPointsLost`), `hookActivationEnd` runs (R9.4.5: the `vpPerBuilt` upgrade tiles read `frame.built`, what the Foreman and the specialists BUILT, not what a Congress entry or a tile gave) and the frame is popped.
- A benefit that needs a choice pushes its own frame on top (`chooseBuiltTile` for C5, `addCarriage` for C4, `chooseOption` for C6 and then `placeBuildings`, `chooseResource` for a hat at the limit or the `jan-2026` choices); storage overflow pushes `discard` above that. The activation frame resumes when they are done.

**Lay Tracks / Move Train (R11.3).** `pushLayTracks` pushes one `layTracks` frame. Its allowance is `steps = M` with `layTrackClaims = per-step`; `claimsLeft = [M, M]` (one per railhead) and `movesLeft = M` with `per-railhead`; `steps = 2 x M` with `per-railhead` in network mode (claims and station steps share the pool). The frame asks `claimRoute { route, from }` for every legal claim, `moveTrain { from, to }` for every legal move, and, once `taken` is at least 1, `stopLaying`. `from` is the city the claim is made from: in railhead mode the city a railhead stands on (not a railhead index; if both stand on the same city the two moves would be the same), in network mode the end of the route that is in the player's network (the route's first end if both are). With `per-railhead` and both railheads on one city, the one with more claims left is used. A claim resolves R11.5 steps 1 to 6 and 8 by itself (`claimRoute` in actions.js, step by step, each commented with its rule), then pushes `placeBuildings` for step 7 **if the player could place a building** (`canPlaceAnyBuilding`); otherwise nothing is asked. A move works out its path and tolls by itself (R12.3) and offers the paid building the same way (R12.4). The frame closes by itself when its allowance is spent (`RESUME`) or by `stopLaying`; `hookLayTracksEnd` then sees `frame.totals` (R11.10).

**Buildings (R13).** `placeRailwayStation { city, houseTrack }` and `placeTelegraphStation { city }` are legal in a `placeBuildings` frame (arrival by a claim: free, in the arrival city; arrival by a move: 2 Coins; Congress C6: any connected inland city, two buildings, one of each kind at most) and, in network mode, directly from the `layTracks` frame as a station step (2 Coins, one step of the action, any inland city of the network). Skipping is the explicit `skipBuilding`.

**Free actions (R4.4).** A `freeActions` frame stays on the stack while the player takes any number of free actions and is closed by `endFreeActions`. Buying an immediate card pushes the frames of its effects on top. **The opportunity is offered only when the player has a free action to take** (`hasFreeAction`: a card they can afford and may buy, a token to return, an ability they may use), so the engine never asks an empty question; and a frame whose last free action has been taken closes by itself (`RESUME`) instead of waiting for a lone `endFreeActions`. The two opportunities of a turn are `which: 'before'` and `'after'`.

---

## 5. Action catalogue

An action is `{ type, ...params }`, plain JSON. `player` is optional: if present it must equal `state.toAct` (and `getBlockReason` answers for that player). `getValidActions` does not add it.

Ids used in parameters: districts `D1` to `D9` (positions of the grid, R5.1); worker spaces `W1` to `W12` (R5.2); cities and routes as in the map data (`SPO`, `SEA-SPO`); resources `iron`, `wood`, `gunpowder`; tile types and terrains `ground`, `tunnel`, `bridge`; specialists `crew`, `miner`, `engineer`, `financier`; house tracks `wood`, `coins`, `iron`, `gunpowder`.

### 5.1 Implemented (25)

| type | params | meaning | rule |
|---|---|---|---|
| `placeRailhead` | `city` | Put a railhead on a start city in the draft. | R3.5 |
| `chooseStartingProduction` | `track` | Leave the "2" house slot of that track empty: its production starts at 2. | R3.4, R3.6 |
| `chooseStartingSpecialist` | `specialist` | Take the free starting specialist. | R3.6 |
| `chooseResource` | `resource` | Take 1 resource of your choice. One per action. | R1.8 |
| `discard` | `item` | Discard 1 item from storage: a resource id or a built tile type. One per action. | R8.5.4 |
| `placeWorker` | `space` | Place a worker from supply on an empty worker space. | R5.3 |
| `displaceWorker` | `district` | Place a worker from supply on the centre of a blocked district. | R5.5 |
| `removeWorker` | `from` | Take your worker off the grid. `from` is a worker space id, or a district id for a worker on a centre. | R5.4 |
| `chooseDistrict` | `district`, `hat` | Take that district's action; `hat: true` spends a cowboy hat for +1 M. `district: 'none'` is the one case of R5.4.4. | R4.2 step 3, R5.6, R14.2 |
| `buyHat` | | Bonus action: pay 1 Gunpowder, gain 1 hat. | R7.5 |
| `addCarriage` | `carriage` | Add a `specialist` or `storage` carriage. As a bonus action it costs 1 Wood. | R7.6, R8.7 |
| `hireSpecialist` | `specialist` | Hire into the next free slot. As a bonus action it costs the 1-Coin fee, and by default nothing else (`hireCostModel`). | R7.4, R8.6 |
| `skipBonusAction` | | Decline the bonus action. | R7.1 |

R5.4.4: the rule words the forced removal as "a Remove with action `none`". Here that is `removeWorker { from: 'D5' }` followed by `chooseDistrict { district: 'none', hat: false }`. The second is the only legal action at that point, so the engine applies it; the player sees one move.

The twelve core actions (parameters as built; a decision with several legal actions of one type lists each parameter combination):

| type | params | meaning | rule |
|---|---|---|---|
| `useStep` | | Use the current Crew, Miner or Engineer step: pay the recipe of `conversionRate`, gain 1 built tile. | R9.4.3, R8.8 |
| `skipStep` | | Skip it. | R9.4.3 |
| `takeCongressEntry` | `entry` | Take an available Congress entry (`C1`..`C6`, `CR`; `J1`..`J7`, `CR` in the other table): lobby points equal to its tier, Coins equal to its cost, then its benefit. | R10.4, R10.6 |
| `closeCongress` | | Take no (more) entries for now. | R9.4.3 |
| `chooseBuiltTile` | `terrain` | Gain 1 built tile of that type. One per action. | R10.7 |
| `chooseOption` | `option` | Pick option number `option` (from 0) of the choice on offer. An option that could not be carried out (C6's buildings with nowhere to place one) is not offered. | R10.1 C6 |
| `claimRoute` | `route`, `from` | Claim a route with the railhead standing on `from` (network mode: the end of the route in the network), paying built tiles. | R11.4, R11.5 |
| `moveTrain` | `from`, `to` | Move the railhead on `from` to `to` along claimed routes; the path and tolls are worked out for the player. | R12.2, R12.3 |
| `stopLaying` | | End the Lay Tracks / Move Train action. | R11.3 |
| `placeRailwayStation` | `city`, `houseTrack` | Place a railway station, taking the leftmost house of that track. | R13.2 |
| `placeTelegraphStation` | `city` | Place the leftmost telegraph station of the row. | R13.3 |
| `skipBuilding` | | Place no (more) buildings. | R13.4 to R13.6 |

`addCarriage` (5.1) is also taken from an `addCarriage` frame (Congress C4): then it is free and does not use up the bonus action (R7.2).

### 5.3 Module actions (11)

| type | params | meaning | rule |
|---|---|---|---|
| `installUpgrade` | `tile` (an id such as `U1-wood`), `level` (1 to 3) | Install an upgrade tile in the specialist carriage of that level. The bonus action of Gather Gunpowder; 1 Iron (nothing on the terms of card 28). | R7.3, R15.3 |
| `buyPonyCard` | `card` (`PX1` to `PX38`) | Buy a face-up Pony Express card with tokens. | R18.5 |
| `exchangeToken` | `resource` | Return 1 token for 1 resource. | R18.4 |
| `usePonyCard` | `card` | Use a once-per-turn ability (cards 14 and 28). | R18.8 |
| `endFreeActions` | | Leave the free-action opportunity. | R4.4 |
| `skipEffect` | | Decline an optional part of an effect (see 4.5). | R18.7 |
| `returnResource` | `resource` | Give back 1 resource for card 11. | R18.7 |
| `chooseForemanType` | `specialist` | What the Foreman acts as. | R9.2, cards 10, 22, 32 |
| `chooseSpecialistType` | `specialist` | The type doubled by card 33 (only a type in the train is offered). | R18.7 |
| `chooseExtraActivation` | `level`, `slot` | The specialist card 15 activates once more. | R18.7 |
| `declineFreeEntry` | | Do not take the free entry of Legislative Agenda card 20. | R17.3 |

`chooseOption` now has up to three options (cards 8 and 23). `hireSpecialist`, `addCarriage`, `chooseBuiltTile`, `chooseResource` and `takeCongressEntry` are reused on other terms by the frames that ask for them (a card's free hire, a free Congress entry with no lobby points and no Coins).

`addCarriage`, `hireSpecialist`, `chooseResource`, `chooseBuiltTile`, `takeCongressEntry` and the two building actions are reused wherever a rule grants the same thing on other terms (free from Congress entry C4, free from a card, a station step). The frame says on what terms; the action type stays the same. The core does this for `addCarriage` (the frame decides: a `bonusAction` frame pays and counts towards R7.2, an `addCarriage` frame is free), for the two building actions (a `placeBuildings` frame or the `layTracks` frame in network mode) and for `chooseBuiltTile`.

---

## 6. Block reasons

One function per action family, in `legality.js`, all with the shape

```js
get<Something>BlockReason(state, playerId, ...params) -> string | null
```

`null` means legal. Otherwise a sentence for the player. `getBlockReason(state, action)` dispatches to them through the `ACTIONS` table, and `getValidActions` lists an action only if its function returns `null`.

Rules for writing one (from the house pattern):

1. Check requirements **in the order the rulebook states them**, so the sentence names the first thing the player has to fix.
2. Put the timing check ("it is not your decision", "not at this point of the turn") **last**. It is near-universal and would hide every structural reason. Call `timingBlock` for it; `getStructuralBlockReason` relies on that.
3. **Quote the numbers**: `"Hiring a Financier into your level 1 carriage costs 2 Coins + 1 Iron and you have 1 Coin."`
4. Different causes get different sentences ("is not blocked: 1 of its 2 worker spaces is empty (W3)" is not "you have a worker on W3").
5. Address the player as "you"; name other players. British English. End with a full stop. Never the word "house" for anything on the map or the grid.

Implemented:

| Function | Rule |
|---|---|
| `getPlaceRailheadBlockReason(state, playerId, city)` | R3.5 |
| `getStartingProductionBlockReason(state, playerId, track)` | R3.4, R3.6 |
| `getStartingSpecialistBlockReason(state, playerId, specialist)` | R3.6 |
| `getChooseResourceBlockReason(state, playerId, resource)` | R1.8 |
| `getDiscardBlockReason(state, playerId, item)` | R8.5.4, R8.5.5 |
| `getPlaceWorkerBlockReason(state, playerId, space)` | R5.3 |
| `getDisplaceWorkerBlockReason(state, playerId, district)` | R5.5.1 |
| `getRemoveWorkerBlockReason(state, playerId, from)` | R5.4 |
| `getDistrictActionBlockReason(state, playerId, district)` | R4.6 - whether a district's action can be chosen at all |
| `getSpendHatBlockReason(state, playerId)` | R14.2 |
| `getChooseDistrictBlockReason(state, playerId, district, hat)` | R4.2 step 3 |
| `getBuyHatBlockReason(state, playerId)` | R7.5 |
| `getAddCarriageBlockReason(state, playerId, carriage)` | R7.6, R8.7 |
| `getHireSpecialistBlockReason(state, playerId, specialist)` | R7.4, R8.6 |
| `getSkipBonusActionBlockReason(state, playerId)` | R7.1 |

Core block reasons (same shape; the first blocker in rulebook order, timing last):

| Function | Rule |
|---|---|
| `getUseStepBlockReason(state, playerId)` | R9.4.3, R8.8 |
| `getSkipStepBlockReason(state, playerId)` | R9.4.3 |
| `getTakeCongressEntryBlockReason(state, playerId, entry)` | R10.4 to R10.6 |
| `getCloseCongressBlockReason(state, playerId)` | R9.4.3 |
| `getChooseBuiltTileBlockReason(state, playerId, terrain)` | R10.7 |
| `getChooseOptionBlockReason(state, playerId, option)` | R10.1 |
| `getClaimRouteBlockReason(state, playerId, route, from)` | R11.4, R11.6, R11.11.3 |
| `getMoveTrainBlockReason(state, playerId, from, to)` | R12.2, R12.6 |
| `getStopLayingBlockReason(state, playerId)` | R11.3 |
| `getPlaceRailwayStationBlockReason(state, playerId, city, houseTrack)` | R13.2, R13.7, R13.10 |
| `getPlaceTelegraphStationBlockReason(state, playerId, city)` | R13.3, R13.7, R13.10 |
| `getSkipBuildingBlockReason(state, playerId)` | R13.4 |

`getDistrictActionBlockReason` now answers for all nine districts: R4.6.2 (a train activation can always be chosen) and R4.6.3 (Lay Tracks / Move Train needs a legal claim or move; the sentence names the railheads' cities, the cheapest unclaimed route and what is missing).

Module block reasons (same shape; the first blocker in rulebook order, timing last, a sentence with the real numbers):

| Function | Rule |
|---|---|
| `getInstallUpgradeBlockReason(state, playerId, tile, level)` | R7.2, R7.3, R15.3: the limit, the 1 Iron, the tile on display, the carriage exists, holds a specialist, has its slot empty, is of at least the tile's level |
| `getBuyPonyCardBlockReason(state, playerId, card)` | R18.5, R18.6: face up, once per turn, the tokens, the cap on ongoing cards, an immediate card with at least one part that can be carried out |
| `getExchangeTokenBlockReason(state, playerId, resource)` | R18.4 |
| `getUsePonyCardBlockReason(state, playerId, card)` | R18.8: held, has an ability, not used this turn (round), the ability can be carried out |
| `getEndFreeActionsBlockReason`, `getSkipEffectBlockReason`, `getReturnResourceBlockReason`, `getChooseForemanTypeBlockReason`, `getChooseSpecialistTypeBlockReason`, `getChooseExtraActivationBlockReason`, `getDeclineFreeEntryBlockReason` | as section 5.3 |

`getHireSpecialistBlockReason`, `getAddCarriageBlockReason`, `getBuyHatBlockReason`, `getTakeCongressEntryBlockReason` (a free entry), `getChooseBuiltTileBlockReason` (`distinct`), `getClaimRouteBlockReason` and `getMoveTrainBlockReason` (`only`) read their terms from the pending frame. `congressCoinCost` applies Pony Express cards 20 and 37.

`getAddCarriageBlockReason` reads its terms from the pending frame (an `addCarriage` frame means free, from Congress C4 or a card); outside any such frame it answers for the bonus action, which is what `getStructuralBlockReason` reports. `getHireSpecialistBlockReason` does the same for the free hires of cards (a `hireSpecialist` frame).

Two tables must agree with their partners in `actions.js`; `tests/contract.test.mjs` checks both:

- `ACTIONS` (legality.js) and `MUTATORS` (actions.js): the same action types.
- `DISTRICT_ACTION_RULES` (legality.js, R4.6: when a district can be chosen) and `DISTRICT_RESOLVERS` (actions.js: what choosing it does): the same district families (`gather`, `trainActivation`, `layTracks`). A family missing from both is simply not choosable.

---

## 7. Hidden information

R2.4: everything is open except the order of undrawn cards.

- Hidden orders live in exactly one kind of place: `state.modules.<id>.decks`, an object of arrays, `{ deckName: [cardId, ...] }`. The next card drawn is the **last** element (`deck.pop()`). The only such place is `state.modules.pony.decks`, the three Pony Express decks (`A`, `B`, `C`). The face-up market (`pony.market`) is open and is not touched by `determinise`.
- Cards that can never be drawn after setup (the goal cards, milestone tiles and Legislative Agenda cards that were not revealed) are **not stored**. There is nothing to hide.
- The game RNG (`state.rng`) is hidden in the same sense: it determines nothing that is not also in a deck order today, but a bot must not be able to predict a future draw from it.
- Nothing is private to one player. There is no hand. So there is no `redactForPlayer`; if a per-player secret is ever added, add `redactForPlayer(state, playerId)` beside `determinise`, make the UI and the bot worker pass states through it, and extend the tests.

```js
determinise(state, rng) -> state
```

Returns a clone in which every array under a `decks` key is reshuffled with the caller's `rng` and `state.rng` is replaced by a fork of it. Everything open is unchanged. The original is untouched.

**A bot that looks ahead must search on determinised copies and never apply actions to, or read deck orders from, the real state.** Monte Carlo search determinises again for each iteration. The random bot and a one-ply heuristic that never draws need not.

All random draws during play come from deck orders fixed at setup or from `state.rng`. No engine function takes an outside RNG except `createGame` and `determinise`.

---

## 8. RNG

`rng.js`: mulberry32. An RNG is `{ s: int32 }`, plain JSON.

| Function | |
|---|---|
| `makeRng(seed)` | Number or string seed. Throws without one. |
| `rngNext(rng)` | Float in [0, 1). Advances `rng`. |
| `rngInt(rng, n)`, `rngPick(rng, array)`, `shuffle(rng, array)` | `shuffle` is in place. |
| `cloneRng(rng)`, `forkRng(rng)` | `forkRng` gives an independent child and advances the parent once. |

Two streams, never mixed:

- **The game stream**, `state.rng`. Only the engine advances it. All of it is consumed in `createGame` (seats R3.2, scoring card R3.8.5, grid R5.8, then module setup R3.8 in the order upgrades, milestones, goals, Legislative Agenda, Pony Express), before the first decision. Module setup comes after every core draw, so switching a module on or off never changes the seats, the grid or the scoring card. Nothing is drawn after setup: a market refill is `pop()` from a deck order fixed at setup.
- **Bot streams.** The driver makes them from its own seed (`makeRng('bots:' + seed)`) and hands each decision its own child (`forkRng`). A bot never reads or advances `state.rng`. `tests/determinism.test.mjs` checks that changing the bot seed leaves seating, grid and game RNG identical.

No `Math.random` anywhere in `src/engine` or `src/bots`. The UI may use `Math.random` or the clock to invent a seed when the player gives none; it then passes that seed in.

---

## 9. Scoring

VP are booked **by source, as they are scored**, in `player.vp`, only through `addVp(state, playerId, source, amount, rule)` (scoring.js). The source ids are exactly those of R20.1 and R20.2, in this order (`VP_SOURCES` in rules.js):

| id | when | module | rule |
|---|---|---|---|
| `track` | play | - | R11.5.2, R11.9 |
| `firstConnection` | play | - | R11.5.4 |
| `completion` | play | - | R19.2 |
| `telegraph` | play | - | R13.3 |
| `toll` | play | - | R13.9 |
| `congress` | play | - | R10 |
| `upgrades` | play | upgrades | R15 |
| `milestones` | play | milestones | R16.8 |
| `legislative` | play | legislative | R17 |
| `ponyCards` | play | pony | R18 |
| `buildingsEnd` | final | - | R20.2.1 |
| `goals` | final | goals | R20.2.2 |
| `ponyEnd` | final | pony | R20.2.3 |

- A source whose module is off has **no key** in `player.vp`, and `addVp` throws if code tries to book to it. Iterate `Object.keys(player.vp)` (or `vpSourcesInPlay`) rather than a fixed list.
- Base sources hold base values only. Whatever a Legislative Agenda card or a Pony Express card adds is booked to `legislative` or `ponyCards` (R20.1), even when it rides on a track or telegraph event.
- The three `final` sources stay 0 until the game ends; `applyFinalScoring` then writes them.
- The modules book the rest. `upgrades` (R15: the `vp` tiles; the `vpPerBuilt` tiles at the end of the activation; with `upgradeVpTiming = on-install` the three VP tiles once, at installation), `milestones` (R16.8, at the end of a turn), `legislative` (every VP the Legislative Agenda card adds, whatever event it rides on), `ponyCards` (card 7's 5 VP, card 12, the extra of cards 25, 26, 29, 30, 34, 35 - the base stays in `completion`, `toll`, `firstConnection`, `congress`, `telegraph`), and in final scoring `goals` (R16.3, R16.4) and `ponyEnd` (1 VP per token held, cards 31 and 38).
- The core books the six base play sources: `track` (1 per slot, plus the scoring card's terrain, R11.9; the 3 per slot of the completion bonus is `completion`, not `track`), `firstConnection`, `completion`, `telegraph`, `toll` (both for a claim and for a move) and `congress` (Reset, and the 3 VP option of C6). A `vp` effect inside a Congress benefit is booked to `congress`; the card effects choose their own source through the `vpSource` of the effect context (`applyEffects` in actions.js).

```js
scoreGame(state) -> {
  final: boolean,                 // false while the game is running
  endReason: null | 'transcontinental' | 'routes-claimed' | 'turn-limit',
  players: [{                     // index = player id
    id, name, total,
    bySource: { track: 0, ..., buildingsEnd: 0 },   // same keys as player.vp
    tieBreak: { buildings, ownedSlots, cargo, turnOrder },   // R20.5 steps 1 to 4
    rank                          // 1 = first; ranks are unique
  }],
  ranking: [playerId, ...],       // best first
  winner: null | playerId,        // null until final
  decidedBy: 'vp' | 'buildings' | 'ownedSlots' | 'cargo' | 'turnOrder'
}
```

Before the end, the `final` sources are filled in as they would be if the game ended now, without changing the state. That makes `scoreGame` usable as the evaluation at the depth cap of a search.

R20.5 step 4 always separates, so there is exactly one winner and no shared victory.

---

## 10. Variants and constants

**Variants** (`variants.js`). `VARIANTS` holds the 25 variants of R21.3 by their exact names, each `{ name, type, values | min, max, default, description, rule }` with `type` one of `enum`, `boolean`, `integer`, `enum-or-integer`. The setup screen builds its panel from this table and the simulator its flags.

| Function | |
|---|---|
| `resolveVariants(overrides)` | Complete object, defaults filled in. Throws on an unknown name (`Unknown variant "x". The variants are: ...`) or an illegal value (`Illegal value "3:1" for variant "conversionRate". Allowed: "1:1", "2:1", "iron-in-all".`). Strict on type: `"3"` is not `3`. Also refuses `goalsInPlay` 12 with goals on and upgrades off (R3.8.2). |
| `parseVariantValue(name, text)` | Text from a command-line flag or a URL into a typed value; then pass it to `resolveVariants`. |
| `defaultVariants()`, `getVariantDef(name)`, `isAllowedValue(def, value)`, `describeAllowed(def)` | |
| `nonDefaultVariants(variants)` | `{ name: value }` of what differs from default. For banners and reports. |
| `activeModules(variants)` | `{ upgrades, milestones, goals, legislative, pony }` booleans. |

The resolved object is frozen into `state.variants`. Logic reads `state.variants.<name>`.

**Constants** (`rules.js`). Every tuning number of R21.4 and every data table is in an exported object (`SETUP`, `PLAYER_BOARD`, `HATS`, `GRID`, `BONUS_ACTIONS`, `TRAIN`, `CONGRESS`, `MAP_RULES`, `SCORING`, `PONY`, the card tables), gathered in `RULES`. `R21_4_CONSTANTS` maps each name in the spec's table to its path. There are no magic numbers in logic files.

Logic never reads those objects directly. It calls **`getConstants(state)`**, written `K` by convention:

```js
const K = getConstants(state);
if (player.hats >= K.HATS.hatLimit) ...
```

- With no overrides, `getConstants` returns `RULES` itself, so a simulator that patches an exported object at run time (`SCORING.vpPerSlot = 2`) reaches every reader. Such a patch is **not** recorded in the state.
- `createGame({ constants: { SCORING: { vpPerSlot: 2 } } })` stores the patch at `state.constantOverrides`, and `getConstants` returns `RULES` with the patch laid over it (objects merged, arrays replaced whole, unknown keys refused). **This is the recorded, replayable way**; a `--probe` flag of the simulator should use it. The merged table is cached per distinct patch and snapshots `RULES` at first use. **An override must be of the same kind as its default** : a finite number for a number, a string for a string, a boolean for a boolean, an object for an object, and for an array an array of the same length whose entries are of the same kind as the default's; anything else makes `createGame` throw, naming the constant (`Constant "SCORING.firstConnectionVp" must be a number like its default ...`).

---

## 11. Modules

The four add-ons are five module ids, because goals and milestones switch separately: `upgrades`, `milestones`, `goals`, `legislative`, `pony` (`activeModules`).

**Off means no trace.** With a module off:

- `state.modules` has no key for it;
- no player field belongs to it (per-player module data lives inside the module's namespace, indexed by player id);
- `player.vp` has no key for its sources, and `player.bonusActionsUsed` has no key for a bonus action that needs it (R7.3);
- `getValidActions` never offers one of its actions and `getActionSpace` need not list them;
- no event of its types is emitted.

`tests/variants.test.mjs` checks the state side by searching a state with every module off for the words.

**Namespacing.** A module owns `state.modules.<id>` and nothing else. Core state is not reshaped for a module. The shapes as built (`setupModules` in state.js):

```js
state.modules.upgrades    = { display: ['U1-vp', ...],           // tiles still on display (R15.4: never refilled)
                              installed: [[null, null, null], ...] }  // per player, index = carriage level - 1
state.modules.milestones  = { inPlay: ['MS3', ...],              // in id order (R16.9)
                              claimedBy: { MS3: null | playerId } }
state.modules.goals       = { inPlay: ['G4', ...] }              // goal 6 is not eligible without upgrades (R3.8.2)
state.modules.legislative = { card: 'LA7', used: {} }            // `used`: LA10 (once per game) is marked here
state.modules.pony        = {
  decks:   { A: [...], B: [...], C: [...] },   // HIDDEN ORDER (section 7); top of deck is the last element; cards removed by `removedWhen` are not in them
  market:  { A: ['PX3', null], B: [...], C: [...] },   // two places per rank; null when the deck ran out (R18.5.4)
  tokens:  { SPO: true, ... },                 // 17 inland cities; true = the token is still on the city
  players: [{ tokensHeld: 0, tokensCollected: 0, ongoing: [], endgame: [] }],   // card ids; immediate cards are discarded
  turn:    { purchases: 0, usedCards: [], doubled: null },   // reset at the start of every turn (hookTurnStart); `doubled`: card 33's type
  roundUsed: []                                // abilities used this round (turnStructure = rounds); emptied by endRound
}
```

Cards that are never drawn after setup (unrevealed goals, milestones and Legislative Agenda cards, and the cards a variant removes) are **not stored**. Milestones and goals are revealed at setup, so their order is not hidden.

Where core code needs a module, it asks `state.modules.<id>` and does nothing when the key is absent. The places are the named hook functions below, `offerFreeActions` and `hookTurnStart` (actions.js), `production` (queries.js), `congressCoinCost` (legality.js) and `finalSourceValues` (scoring.js).

`UNIMPLEMENTED_VARIANT_VALUES` (state.js) lists legal variant values whose rules do not exist yet; `createGame` refuses them. It is **empty** (`turnStructure = rounds` is implemented). The module switches were never in it: with a module on but not yet written, `state.modules` is simply empty and nothing of the module is offered. Each namespace is created in `createInitialState`.

The module hooks are named functions in actions.js, each commented with the rule it serves and each doing nothing when its module is off: `hookGatherBonus` (R6.4: fires the `gather` trigger), `hookUpgradeStep` (R15.5.1; `activationTile` decides whether the step exists), `hookActivationEnd` (R9.4.5, R15.5.2), `hookCongressEntryTaken(state, playerId, entry, frame)` (R17.3 card 20), `hookFirstConnection(state, playerId, city, route)` (R11.5.4, R18.3: the Pony Express token, then the `firstConnection` trigger), `hookCompletion`, `hookBuildingPlaced`, `hookLayTracksEnd` (R11.10: `layTracksActionEnd`, with the whole-action totals), `hookMilestones` (R16.9: for every player, in id order, active player first), `hookTurnStart`, and `offerFreeActions` (R4.4). The hooks that fire a trigger go through one dispatcher, `fireTrigger(state, playerId, event, data)`, which reads the standing `trigger` effects of the Legislative Agenda card (everyone, R17.1) and of the ongoing Pony Express cards of the acting player (R18.9). `applyEffects` runs a list of effects through `EFFECT_HANDLERS` (one handler per effect type); effects that create a decision are pushed in reverse so that the first one in a list is asked first. A trigger that creates a decision (`gainChoice`, `extraActivations`, `freeCongressSameTier`) pushes its frame the same way.

---

## 12. Effect encoding

Congress entries, upgrade tiles, Legislative Agenda cards and Pony Express cards carry `effects: [effect, ...]`. An effect is `{ type, ...fields }`. The spec's "machine form" column was normalised into this one vocabulary; the numbers are the spec's. `rules.js` exports the vocabulary as `EFFECT_TYPES`, `TRIGGER_EVENTS`, `MODIFIER_KINDS`, `CONDITION_OPS`, `METRIC_NAMES`, and `tests/rules-data.test.mjs` fails if a table uses a word outside it.

Card effects are data plus a small set of handlers, one per `type`: not one function per card.

Things that happen once, now:

| type | fields | creates |
|---|---|---|
| `vp` | `amount` | - |
| `gain` | `items: { iron, wood, gunpowder, coins, hats }` | hats at the limit: `chooseResource` (R14.1); overflow: `discard` |
| `gainChoice` | `count` | `chooseResource` x count |
| `gainBuiltTile` | `terrain`, `count` | - |
| `gainBuiltTilesChoice` | `count`, `distinct` | `chooseBuiltTile` x count |
| `addCarriage` | `carriage: 'specialist' | 'storage' | 'choice'`, `optional?` | `addCarriage` when there is a choice |
| `hire` | `count`, `free`, `fee?`, `optional?` | `hireSpecialist` |
| `steps` | `move: n` or `claim: n` | `layTracks` limited to that kind |
| `activateTrain` | | `chooseForemanType`, then `trainActivation` with M = 1 |
| `exchange` | `max` | `exchange`, then `chooseResource` |
| `vpPer` | `metric`, `amount` | - |
| `freeCongress` | `tier`, `count` | `freeCongress` |
| `chooseOne` | `options: [[effect, ...], ...]` | `chooseOption` |
| `placeBuildings` | `railwayStation`, `telegraphStation`, `where` | `placeBuildings` |
| `resetSenators` | | - |
| `vpPerBuilt` | `terrain`, `amount` | - (scored at the end of the activation, R15.5.2) |
| `untilEndOfTurn` | `modifier` | `chooseSpecialistType` for card 33 |

Standing effects of something that stays in play:

| type | fields |
|---|---|
| `trigger` | `on` (one of `TRIGGER_EVENTS`), `where?` (match on the event, e.g. `{ terrain: 'tunnel' }`), `condition?` (`{ metric, op, value }`), `effect` (one effect), `limit?` (`oncePerGame`, `oncePerActivation`) |
| `modifier` | `what` (one of `MODIFIER_KINDS`), `value` or `amount`, `tier?`, `limit?` |
| `oncePerTurn` | `effect` (R18.8) |
| `endVpPer` | `metric`, `amount` (final scoring) |

Only inside a `trigger` or `oncePerTurn`: `gainGathered { amount }`, `vpPerSlot { amount }`, `extraActivations { count, target }`, `freeCongressSameTier { count }`, `bonusAction { which, printedCostFree }`.

Card-level fields: `kind` (`immediate`, `ongoing`, `endgame`), `rank`, `order: 'any'` (parts in either order, card 9), `removedWhen: { variant: value }` (cards 3, 14, 31), and on upgrade tiles `vpTile: true` (R15.6).

Conditions (`{ metric, op, value, filter? }`) are evaluated by `conditions.js`. **An unknown metric is false, never true.** A yes/no metric counts as 1 or 0. Goals rank the players by `metric` with a `direction`; milestones compare it with a threshold. A metric that needs the event it is about (`distinctTerrainsLaid`, `slotsLaid`, `cityHasOpponentBuilding`, `cityIsJunction`) answers "unknown" without it, so it is false.

**The modules did not extend the vocabulary**: every effect, trigger, modifier and metric in the data is the one `rules.js` already carried, and each now has a handler or reader. The three registries are exported and checked by `tests/data-integrity.test.mjs` (a typo in a table fails there, not in a game):

- `EFFECT_HANDLERS` - one function per one-off effect type; `STANDING_EFFECT_TYPES` (`trigger`, `modifier`, `oncePerTurn`, `endVpPer`) are not run but consulted where their event happens. Together they are exactly `EFFECT_TYPES`.
- `TRIGGER_SITES` - for each trigger event, where it is fired (exactly `TRIGGER_EVENTS`). `fireTrigger` refuses an unlisted event.
- `MODIFIER_READERS` - for each modifier, the function that reads it (exactly `MODIFIER_KINDS`).

How the less obvious types behave: `gain` with `hats` obeys the limit of R14.1; `gainBuiltTilesChoice` with `distinct` offers each type once; `addCarriage` with 'specialist' or 'storage' adds at once if the train is under the limit, 'choice' asks (and `optional` may be declined); `hire` asks (`free`, or the table price when `fee` is false; `optional` or `count > 1` may be stopped); `steps` gives a Lay Tracks action of its own limited to moves or to claims; `activateTrain` is `beginActivation` with M = 1; `exchange` returns resources one at a time and then asks for as many of the player's choice; `vpPer` books `amount` x the metric to the card's source; `freeCongress` takes entries without lobby points or Coins; `untilEndOfTurn` asks the type and sets `pony.turn.doubled`; `vpPerBuilt` is run at the end of the activation with the tiles built in it; inside triggers, `gainGathered` adds to the item just gathered, `vpPerSlot` scores per slot of the route just claimed, `extraActivations` asks for the specialist, `freeCongressSameTier` offers one other entry of the tier just taken, `bonusAction` is card 28's free choice. A trigger's `times` (the slots of a terrain on the route just laid) multiplies a `vp` effect.

---

## 13. Events

**Decision: `applyAction` returns the events; the state carries no log.**

| Concern | Why returning them is right |
|---|---|
| Search and simulation speed | A log inside the state would be copied by every `cloneState`, and Monte Carlo search clones for every iteration. With `SILENT` no event object is collected at all. |
| Undo | The UI snapshots the state before a call. Nothing about the log has to be undone inside the state; the UI truncates its own list to the snapshot's `seq`. |
| Replay | Events are a pure function of (state, action). `replayGame` regenerates them; nothing is lost by not storing them. |
| Bug reporter | It keeps its own ring buffers anyway (applied actions, refusals, swallowed clicks). It fills the first from these events at one choke point. |
| State size | A saved state stays about 6 kB for 4 players whatever the length of the game. |

What the state does keep is `seq`, the count of applied actions. Every event carries the `seq` of the action it belongs to.

An event is plain JSON: `{ type, seq, ...fields }`, usually with `player`. The first event of each applied action is

```js
{ type: 'action', seq, player, action: { ... }, auto: false | true, text: 'Place a worker on W4' }
```

followed by what the action caused, in order, including the forced actions that followed (each with its own `action` event, `auto: true`, and its own `seq`).

Implemented event types:

| type | fields | rule |
|---|---|---|
| `action` | `player`, `action`, `auto`, `text` | - |
| `railheadPlaced` | `player`, `city`, `railhead` | R3.5 |
| `startingProduction` | `player`, `track` | R3.4 |
| `hire` | `player`, `specialist`, `level`, `slot`, `cause` | R3.6, R8.6 |
| `gain` | `player`, `item`, `amount`, `cause`, `built?` (true for a built tile) | - |
| `pay` | `player`, `cost`, `cause` | - |
| `hatLimit` | `player`, `hatsRefused`, `resourcesOwed`, `cause` | R14.1 |
| `discard` | `player`, `item`, `used`, `capacity` | R8.5.4 |
| `workerReturned` | `player` (the owner), `space`, `by` | R5.5.2 |
| `districtChosen` | `player`, `district`, `tile`, `multiplier`, `adjacent`, `hat` | R5.6 |
| `gather` | `player`, `district`, `item`, `production`, `multiplier`, `amount` | R6.3 |
| `carriageAdded` | `player`, `carriage`, `specialistCarriages`, `storageCarriages`, `cause` | R8.7 |
| `vp` | `player`, `source`, `amount`, `rule` | R20 |
| `setupComplete` | | R3.9 |
| `turnStart`, `turnEnd` | `player`, `turn` (the running turn number of the game, `state.turn.number`) | R4.2. `turnEnd` is the LAST event of a turn: it comes after the end-of-turn milestone check (`milestoneClaimed`, its `vp`) and the end triggers (`gameEndTriggered`), and before `roundEnd`, the final-scoring `vp` events and `gameOver`, or the next `turnStart` |
| `gameEndTriggered` | `reason`, `player`, `turn` | R19 |
| `gameOver` | `reason`, `winner`, `ranking`, `totals` | R20 |

`cause` is a short code: `setup`, `gather`, `displacement`, `hatLimit`, `startCompensation`, `bonus:hat`, `bonus:carriage`, `bonus:hire`; the rules add `congress:C3`, `upgrade:U1-wood`, `pony:PX7` and so on.

Core event types:

| type | fields | rule |
|---|---|---|
| `trainActivation` | `player`, `foreman`, `steps` (length of the list), `cause` | R9.4 |
| `build` | `player`, `terrain`, `specialist`, `level` (0 = the Foreman), `amount` | R9.4.3 |
| `lobbyPoint` | `player`, `total`, `level` | R10.3 |
| `lobbyPointsLost` | `player`, `amount` | R9.4.4 |
| `congressEntry` | `player`, `entry`, `tier`, `coins`, `text` | R10.4 |
| `senatorsReset` | `player`, `count` | R10.6 |
| `routeClaimed` | `player`, `route`, `from`, `to` (null with no arrival city), `slots`, `cost` | R11.5 |
| `firstConnection` | `player`, `city` | R11.5.4 |
| `toll` | `player` (the owner paid), `by`, `city` | R13.9 |
| `railheadMoved` | `player`, `from`, `to`, `cities`, `routes` (the path) | R12 |
| `buildingPlaced` | `player`, `kind`, `city`, `houseTrack` or `vp`, `cause` (`arrival`, `move`, `stationStep`, `congress:C6`) | R13 |
| `completion` | `player`, `route`, `bonus` | R19.2 |
| `roundEnd` | `startPlayer` (the new one) | R4.8.3 |

`cause` of `gain` and `pay` events also takes `build`, `congress:C3`, `stationStep`.

Module event types:

| type | fields | rule |
|---|---|---|
| `upgradeInstalled` | `player`, `tile`, `level`, `cause` | R7.3, R15.3 |
| `upgradeStep` | `player`, `tile`, `level` | R15.5.1 |
| `milestoneClaimed` | `player`, `milestone`, `name`, `vp` | R16.9 |
| `ponyToken` | `player`, `city` | R18.3 |
| `ponyCardBought` | `player`, `card`, `rank`, `kind`, `cost` | R18.5 |
| `ponyMarketRefill` | `rank`, `card` | R18.5.4 |
| `tokenExchanged` | `player`, `resource` | R18.4 |
| `ponyCardUsed` | `player`, `card` | R18.8 |
| `resourceReturned` | `player`, `resource`, `cause` | card 11 |
| `foremanType` | `player`, `specialist`, `cause` | R9.2 |
| `extraActivation` | `player`, `level`, `slot`, `count`, `cause` | card 15 |
| `activationsDoubled` | `player`, `specialist`, `cause` | card 33 |

Also: the event `bonusAction` with `player`, `district` (the district whose Gather printed the bonus action; `null` when Pony Express card 28 gave it), `bonus` (`upgrade`, `hire`, `hat` or `carriage`) and `free` (true for card 28). It is emitted when a bonus action is TAKEN (R7), never when it is declined, and comes before the events of what the bonus action did.

`congressEntry` has a new field `free`. `cause` also takes `upgrade:U1-wood`, `bonus:upgrade`, `legislative:LA7`, `pony:PX7`, `pony:token`. Every VP change already produces a `vp` event with its source, so the "one action scored several ways" pop-up needs nothing more than the `vp` events sharing a `seq`. A module that is off emits none of its events.

Inside the engine: call `emit({ type, ... })` freely (events.js). When nobody is listening the record is dropped; guard with `eventsOn()` only if building the record is costly.

---

## 14. Bots

```js
bot.chooseAction(state, { rng, timeBudgetMs, iterations, now, ...options }) -> action
```

| | |
|---|---|
| `state` | The real state. A bot must not change it. A bot that looks ahead clones through `determinise` (section 7). |
| `rng` | The bot's own stream for this decision. |
| `timeBudgetMs` | Thinking time, or `null` for the level's default. |
| `iterations` | A fixed amount of search in place of a time budget, or `null`. With it, the same seed gives the same move; tests use it. |
| `now` | `() => milliseconds`, supplied by the driver, or `null`. **Bots do not read a clock themselves**; that keeps `src/bots` free of `Date.now`. |
| `...options` | Anything else a level understands, for example the `jitter` and `weights` of a heuristic bot. A bot ignores what it does not know. |
| returns | One of `getValidActions(state)`. Always legal. |

`src/bots/index.js`: `BOT_LEVELS` (`[{ id, name, description, defaultTimeBudgetMs }]`, weakest first; the setup screen builds its seat menu from it) and `getBot(level)` (throws on an unknown level). Five levels are registered: `random`, `easy`, `medium`, `hard`, `expert`.

`src/bots/bot-worker.js` is the module Web Worker entry.

```js
// request
{ id, state, level, seed, timeBudgetMs?, iterations?, options? }   // options: passed to the bot as they are
// reply
{ id, ok: true, action }   or   { id, ok: false, error }
```

`seed` seeds the bot's stream for that one decision; the page derives it from its own bot RNG. The worker never applies the action: the page does, with `applyAction`, through the same path as a human click. `handleBotRequest(message, clock)` is exported so that tests and the simulator can call it without a worker. It is the one file under `src/bots` allowed to read a clock (`performance.now`), which it passes to the bot as `now`.

Driver rules, for the UI and the simulator alike:

- Ask the bot of `state.toAct`, which need not be the active player.
- Because every proposal comes from `getValidActions`, a refusal can only mean an engine bug. The simulator asserts zero refusals; the UI keeps the consecutive-failure cap of the house pattern as a backstop and logs any trip.
- Guards against repetition (the recent-layout guard of the house pattern) live with the bot's scorers, in a `WeakMap` keyed on the state object, never in the state.

---

## 15. File responsibilities

| File | Holds | Never holds |
|---|---|---|
| `rules.js` | Constants, tuning numbers, card and tile data, the effect vocabulary. | Logic. |
| `variants.js` | The variants table, `resolveVariants`, `activeModules`. | Game logic. |
| `board.js` | Static geometry: grid adjacency, the map tables built from `data/route-map.js`. | Anything that changes during a game. |
| `data/route-map.json`, `data/route-map.js` | The map. The `.js` is generated from the `.json` by `tools/build-route-map-module.mjs`; a test checks they agree. | |
| `rng.js` | The seeded generator. | |
| `events.js` | The event sink of one `applyAction` call. | |
| `state.js` | The state shape, `createInitialState`, the stack primitives, `cloneState`, `hashState`, `determinise`, `getConstants`. | Rules. |
| `queries.js` | Every pure read over the state. | Anything that changes the state; anything about what a player may do. |
| `scoring.js` | `addVp`, final scoring, `scoreGame`, tie-breaks. | |
| `conditions.js` | The interpreter for declarative conditions, `METRICS`, `describeProgress`. It reads the state through `queries.js`. | Card-specific code. |
| `legality.js` | `getValidActions`, `getBlockReason`, every `get...BlockReason`, the `ACTIONS` and `FRAMES` tables, descriptions. | Anything that changes the state. |
| `actions.js` | `applyAction`, the `MUTATORS`, `RESUME`, the `DISTRICT_RESOLVERS`, the flow of setup and of a turn, the gain and pay helpers. | Validation (it asks legality.js). |
| `game.js` | `createGame`, `isGameOver`, `replayGame`. | |
| `index.js` | The public exports. | |

Imports run one way: `rng, rules, variants, events -> board -> state -> queries -> conditions -> scoring -> legality -> actions -> game -> index`. A file never imports from one to its right. `tests/purity.test.mjs` checks that engine files import only engine files and that bots import only bots and the engine.

Two rules from the house pattern, both enforced by tests or by the tables above:

1. **The engine and the bots are pure.** No DOM, no clock, no `Math.random`, no output, no storage. State is plain JSON.
2. **No function that takes only the state and returns only data lives in `src/ui`.** If the UI needs to know something about the position or about legality, the function goes in `queries.js` or `legality.js`.

---

## 16. Speed

Measured on the build machine, Node 24, random playouts with `SILENT`, with the core rules in (games are 80 turns per player, ended by the turn limit; a random bot almost never ends a game by a crossing, see section 18):

| | 2 players | 3 players | 4 players |
|---|---|---|---|
| Games per second | about 300 | about 220 | about 190 |
| Decisions per second (those a driver takes) | about 140,000 | about 160,000 | about 180,000 |
| Decisions per game | 477 | 713 | 937 |

About a third of all applied actions are forced ones (mostly `skipStep` for a step nobody can pay): the engine applies them itself, which is part of those rates. `cloneState` about 10 microseconds, `hashState` about 14, `getValidActions` at a worker step well under 1. State as JSON: about 6 kB (4 players); an activation frame adds a step list of up to about 20 small objects while it lasts.

Rules that keep it there:

- `getValidActions`, `getBlockReason`, queries and `scoreGame` never copy the state.
- Lists narrow their candidates cheaply first (only empty spaces, only your own workers) and then confirm each with its block-reason function. The narrowing must never drop a legal action; `tests/contract.test.mjs` compares the list with a brute-force pass over `getActionSpace`.
- Nothing derived is stored; nothing grows with the length of the game.
- A search clones once per iteration and then applies actions in place with `SILENT`.
- There is deliberately **no cache of the valid-action list**. One was considered (the engine computes the list once to test for a forced action, and the driver asks again) and rejected: a test that edits a state by hand would be handed a stale list.

`tests/smoke.test.mjs` prints the figures and fails if decisions per second fall below 20,000.

**With the four modules**, random playouts on the build machine (150 games each, `SILENT`): 2 players 277 games per second with every module off and 249 with all of them on (goals and milestones both); 3 players 255 and 205; 4 players 229 and 162. A game with the modules has about 17% more decisions (571 against 477 at 2 players, 1,107 against 946 at 4: the upgrade bonus action, gains of resources that overflow storage, choices from the Legislative Agenda), so per decision the cost is 5% to 18% more. A free-action opportunity costs nothing unless it is asked, and it is asked only when the player has a token or a card (`hasFreeAction` returns at once for a player with neither). Milestones are checked for every player at every turn (R16.9) with loops over arrays and one pass over the routes per player (`routeStats` in conditions.js); a first version with `for ... in` over the route table cost about a third of the speed. The share of forced actions among all applied ones is 28.6% against 30.8% before.

---

## 17. Terminology in identifiers

| Thing | Identifier | Never |
|---|---|---|
| Production multiplier piece on the player board (R1.1) | `house`, `houses`, `houseTrack`, `housesOnBoard` | for anything on the map or the grid |
| Buildings on the map (R1.2, R1.3) | `railwayStation`, `telegraphStation`, `buildingCount` | `house`, `station` alone |
| Location of the action grid (R1.5) | `district`, `D1`..`D9`, `districtTiles` | `house`, `site` |
| Worker space (R1.6) | `space`, `W1`..`W12`, `centre` | |
| Resources (R1.8, R1.9) | `iron`, `wood`, `gunpowder` | `steel` |
| Currency, hats | `coins`, `hats` | |
| A tile in storage (R1.13) | `builtTiles`, `gainBuiltTiles`, `chooseBuiltTile`, `useStep` | `lay` |
| A tile on the map (R1.14) | `routeOwner`, `claimRoute`, "laid" | `build` |

Build and lay are different actions (`useStep` in a train activation; `claimRoute` in Lay Tracks), different state fields (`player.builtTiles`; `map.routeOwner`) and different events.

---

## 18. Tests

Plain Node scripts, `tests/<name>.test.mjs`, `node:assert` only, run by `npm test`. Each exits non-zero on failure and prints a one-line summary. `tests/helpers/play.mjs` holds the shared game loop (`playGame`), `tests/helpers/rig.mjs` the set-up helpers of the rules suites (`start`, `put`, `take`, `give`, `setHeads`, `setTrain`, `claim`, ...) and `tests/helpers/builder.mjs` a scripted driver that plays to build and claim; none of them is a suite.

| Suite | Checks |
|---|---|
| `smoke` | 600 random-bot games on default variants (all modules on, milestones; 200 at each of 2, 3, 4 players); 100 under each non-default `conversionRate` and under `rounds`; 30 under each non-default value of every other variant the engine acts on (including `endRoutesPerPlayer = 0` and the four `scoringCard` values); 72 scripted builder games. **Modules:** 400 games with every module on (goals and milestones both), 100 with each module individually off (no key, no VP source, no action, no event, no decision, no word in the state), small runs for `endGameScoring` = `goals`, `both`, `none`, `upgradeVpTiming = on-install`, `ponyOngoingCap = 0` and the module variants with `rounds`, `network` and `bothBuildingsSameOwner = false`, 6 games with each of the 20 Legislative Agenda cards fixed (120), 204 builder games that play the module decisions (84 of them with tokens handed out by hand, reported as constructed). Every game ends by itself, zero refusals, zero harness-cap hits, always a real choice, the list equal to the actions whose block reason is null, invariants (houses plus railway stations constant, VP add up by source, upgrade tiles, cards and tokens conserved), every action type and every district used, speed; usage counters (every Legislative Agenda card in force, every Pony Express card bought, every upgrade tile installed, every goal and milestone scored); a core game is identical with an add-on module on or off under the same core choices. Prints the split of end reasons. |
| `determinism` | Same seed gives the same game; seeds differ; replay from the action list; bot RNG independent of game RNG; `hashState`; `determinise`. |
| `purity` | State plain JSON and round-trips at every decision; resume after a round trip; `cloneState` equals the JSON clone and shares nothing mutable; no impure call in `src/engine` or `src/bots`; import direction; LF. |
| `variants` | The 25 variants by name and default; rejection messages; variants and constant overrides in the state; the variants this build acts on. |
| `rules-data` | Shape, counts, unique ids and vocabulary of every table in `rules.js`; the map and Appendix A.3; the grid tables of R5.2; one check repeating the printed values of R21.4. |
| `contract` | The promises of this file, and one or more behavioural checks per rule the skeleton implemented, including worked examples E1, E3, E4 and E9. |
| `rules-core` | a behavioural check or more per core rule (R4.6, R4.8, R5.4.4, R8.8, R9, R10, R11, R11.11, R12, R13, R19, R20), with worked examples E5, E6, E7, E8 and E10 reproducing their numbers. The core suites build their games with every module off (`MODULES_OFF` in `tests/helpers/rig.mjs`). |
| `data-integrity` | unique ids; every metric of the data known to the interpreter and none unused; every effect type, trigger and modifier of the data has a handler, firing site or reader; JSON round trip; on a fresh board no milestone is claimable and no goal has a leader, for 2, 3 and 4 players. |
| `rules-modules` | a behavioural check per upgrade tile, per goal and milestone metric, per Legislative Agenda card, and per Pony Express card effect, on constructed states; the free-action opportunities; the ongoing cap; the once-per-round cards in both turn structures; worked examples E2 and E5 with its real tile. |

Conventions: assert behaviour, not constants; read expected numbers from `rules.js`; build a state with `createGame` and adjust it by hand rather than inventing one, and never replace `state.turn` wholesale; assert termination and zero refusals rather than printing them. The suites were checked against deliberately broken copies of the engine; this was repeated for `rules-core` with 18 one-line mutations (a toll dropped, a first connection scored twice, the move-train tie-break reversed, a Congress entry that ignores its tier, a completion that can repeat, ...), all turning the suite red. the skeleton had been checked with 23 mutations (a dropped adjacency case, yield P + M, no overflow discard, auto-advance off, a list missing an action, `Math.random` in the engine, a game that never ends, and so on). 22 turned at least one suite red. The one that did not showed that the hat-spending rule was written in two places; the duplicate was removed.

`rules-audit`: the independent conformance audit, 476 checks named by spec rule number (`R11.5.4`, `R18.7/26`, `E7`), written from the spec; permanently green, a red line is a regression. Its checks live in `tests/rules-audit/part-*.mjs`, the spec's data tables in `tests/rules-audit/spec-tables.mjs`. See `docs/rules-audit-report.md`.

Later suites: `bots`, `sim`, `mcts`, `sim-report`, `bug-report`.

---

## 19. How to add a rule

To add an action type:

1. `legality.js`: write `get<X>BlockReason(state, playerId, ...params)`; add the entry to `ACTIONS` (`params`, `rule`, `block`, `space`, `describe`, `stop` if it is a stop action).
2. `actions.js`: add the mutator to `MUTATORS` under the same key. It does not validate and must not throw.
3. If it answers a new kind of decision: add the frame to `FRAMES` (`label`, `list`), and to `RESUME` if the frame can finish by itself. Push it from the flow, from a resolver or from a mutator.
4. Emit events; book VP only through `addVp`.
5. This file: move the row from "reserved" to "implemented" and note any field you settled.
6. `docs/engine-todo.md`: strike the rule.
7. Tests: a behavioural check per rule; the smoke suite will fail if the new action type is never taken.

To add a district family: one entry in `DISTRICT_ACTION_RULES` (R4.6) and one in `DISTRICT_RESOLVERS`, same key. (`trainActivation` and `layTracks` were added this way.)

To add a Congress benefit or a card effect: give the data an effect of a type `applyEffects` knows; for a new type add a `case` there (and a frame, an action and a block reason if it needs a decision).

To add a module: create `state.modules.<id>` in `createInitialState` when `activeModules(variants).<id>`; put hidden orders under `decks`; fill the module hook points; never add a field outside the namespace.

---

## 20. How the engine reads the rules where they are silent or ambiguous

Places where the rules text is silent or can be read two ways and the engine had to settle something. In each the narrowest behaviour that keeps the engine running was taken.

1. **R3.8 against R3.5 to R3.7 - when module setup is revealed.** The spec lists module setup after the railhead draft and the starting choices but does not say the order matters. The engine draws **all** setup randomness inside `createGame`, before the first railhead: seats (R3.2), the grid shuffle (R5.8), the scoring card (R3.8.5), and the milestones or goals, the Legislative Agenda card and the Pony Express market. Players therefore see them while they draft and choose. This also means no random draw happens between decisions during setup. Say if the reveal should come after R3.7 instead.
2. **R5.4.4 - how widely the "no action" removal is offered.** The rule says the engine offers it "only in this case": R5.4.1 forces the removal of a worker on the centre of a district whose action cannot be chosen. The engine reads that per worker: any centre worker of yours whose district action cannot be chosen may be removed for no action, even if you could have placed a worker instead, or have a second centre worker whose district is available. The narrower reading (offer it only when the player has no other legal worker move at all) would need R5.4.1 to be read as conditional. The case cannot arise in the skeleton.
3. **R5.5 with R4.6.3 - displacing onto Lay Tracks / Move Train with no legal claim or move.** R5.5.1 lists four conditions and none mentions the action. R5.5.4 says "you then take D's action", and R4.6.3 says that action cannot be chosen without a legal claim or move. The engine refuses the displacement in that case (block reason from R4.6). The core inherits this through `getDistrictActionBlockReason`.
4. **R10.1 - the `jan-2026` Congress table has no entry ids.** The spec names the default table's entries C1 to C6 and gives the other table as prose. `rules.js` calls its seven entries `J1` to `J7`, plus `CR`.
5. **R20.5.4 with `turnStructure = rounds`.** The start player marker moves each round (R4.8.3). "Closest to the start player" is then ambiguous: the holder when the game ends, or seat 1. **Settled:** the game is finished at the moment the round ends (R4.8.4), before the marker passes on, so `state.startPlayer` at the end is the start player of the final round, and `scoreGame` measures turn order from it. Say if seat 1 should count instead.
6. **R3.6 - "reveals them at once".** The engine asks each player for the house track and then the specialist as two decisions, seat by seat, so a later seat sees an earlier seat's choices. That is how the rule's "in seat order" reads; simultaneous secret choice by all players is not implemented.
7. **R9.4.3 with R9.4.4 - one Congress window after the last step, not two.** R9.4.3 lets the player take entries "after the step", R9.4.4 gives "one last chance" when the step list is finished. After the last step these are the same moment, so the engine asks once; asking twice would only repeat the question. (Between two steps the window is asked after each step, whenever lobby points are in hand and some entry could be taken.)
8. **R11.4 and R11.11 - the `from` of a claim in network mode when both ends are in the network.** The action names the city the claim is made from. In network mode with only one end in the network that end is `from`. When both are, the two names would be the same claim (there is no arrival city), so the engine lists it once, from the route's first end (`route.a` in the map data), and refuses the other name with a sentence saying so.
9. **R11.3 with R11.11.5 - `per-railhead` in network mode and the station step.** The spec says the action then gives "2 x M claims" and says nothing about the station step of R11.11.5. The engine gives one pool of 2 x M steps, claims and station steps alike. And R4.6.3 lets Lay Tracks / Move Train be chosen only with a legal claim or move, so in network mode a player with Coins but no tiles cannot choose it just to place a station.
10. **R10.5 and R13.4 to R13.6 - an offer that cannot be carried out is not made.** The spec says the building after a claim or move is optional, and C6's buildings are "up to". The engine does not ask a question whose only answer is "none": after a claim or a move it offers `placeBuildings` only if the player could place a building (a start city, a city with no room, no house, no telegraph station left, too few Coins all mean no offer), and C6's buildings option is not offered when nowhere can take a building, so the 3 VP follow by themselves (R10.5: "the player may always choose the 3 VP"). No rule is changed; it saves a forced `skipBuilding`.
11. **R12.3.1 - "first alphabetically" is by city id.** The tie-break compares the lists of city ids (`BOI`, `REN`, `SLC`, ...), as the rule says "list of city ids", not the printed names. With this map the two orders agree on every diamond that exists; a new map could differ.
12. **R19.2 with R19.6 - the transcontinental bonus after the end was triggered by something else.** The bonus is paid whenever the first line of the game is completed, even after another trigger (the map filling up, the turn limit); the end is not triggered a second time and its reason stays. R19.6 ("everything works normally ... only R19.2 cannot happen again") reads that way.
13. **R11.3 - both railheads on one city.** The rule lets them share a city (R12.5). A claim or a move from that city moves one railhead: the first one in `player.railheads` (with `per-railhead`, the one with more claims left). The two railheads are interchangeable, so no choice is offered.

14. **R4.4 - the free-action opportunity is asked only when there is a free action.** The spec gives every turn two windows. The engine offers one only if the active player has something to do in it: a card they may buy now, a token to return, or an ability they may use. A turn of a player with no token and no card has no extra decision. This changes no rule (a player with nothing to do loses nothing) and keeps the random playouts from paying two empty decisions per turn. A player who holds a token always has a free action (a token can always be returned for a resource), so a token holder is asked twice a turn.
15. **R18.6 - what "cannot be carried out at all" means for an immediate card.** The narrowest reading: a card whose every part is blocked cannot be bought. A part is blocked when it has nothing to act on: Move Train steps with no railhead that can move (cards 3, 14), a claim step with no claim you can afford (5), a carriage over its limit (2, 17, and 9's carriage), a hire with no free slot or no tile or nothing affordable (6, 27, 9), card 11 with no resource in storage, card 12 with no inland city on your routes, cards 13 and 24 with no tier 1 entry available, card 33 with no specialist in the train. Cards that always have an effect (gains, VP, 8, 23, 10, 22, 4, 19) can always be bought. Card 9's hire stays "possible" while a specialist carriage can still be added, because a new carriage has free slots (R8.6.1).
16. **R18.7 cards 3, 5, 14 - "up to" and at least one step.** The steps are a Lay Tracks action of their own, so R11.3 applies: at least one step is taken, and the player may stop after any (`stopLaying`). A card whose steps cannot be taken cannot be bought (question 15), so "at least one" never traps a player.
17. **R18.7 cards 6, 9, 27 - which hires may be declined.** Card 6 ("hire 1") must be carried out once bought; card 27 ("hire up to 2") and card 9 ("either part may be skipped") may be stopped (`skipEffect`). Card 9 offers the choice of order (`chooseOption`) when both parts are in play.
18. **R18.7 card 32 - "each time your Foreman is activated".** Read as once per train activation (R9.2: the type holds "for the whole activation"), not once per repetition of the Foreman when M > 1. The choice is made before the step list is built.
19. **R18.7 card 33 - which types may be chosen, and what it multiplies.** Only a type that the train holds is offered (a card that doubles nothing cannot be bought, question 15). It applies to every train activation of the rest of the turn, including one that a card starts, and doubles the activations R9.3 gives (before card 15's extra one is added).
20. **R17.3 card 20 - when the free entry is used up.** It is used up when a free entry is TAKEN, once per train activation. Declining it (`declineFreeEntry`) keeps it: it is offered again after the next entry taken in the same activation. It applies only to entries taken with lobby points inside a train activation, not to the free entries of Pony Express cards 13 and 24. Reset is a tier 1 entry (so it may be the free one, and may be the first). The free entry is asked after the first entry's own benefit has been resolved (R10.4.4).
21. **R18.8 and R4.8.5 - the cards that say "once per round".** The three cards of the original are 14, 21 and 28. Under the adopted reading only 14 and 28 are once per turn abilities (continuous flow) / once per round (`turnStructure = rounds`). Card 21 is "each of your Gather actions gives +1", so it is the same in both structures.
22. **R18.7 card 28 - committing.** Using the card (`usePonyCard`) commits to taking one bonus action at once, with no way back (there is no `skipBonusAction`); the ability is spent when it is used. A hire pays the hire cost of R8.6.3 and not the 1-Coin fee; under the default `hireCostModel = fee-only` there is no hire cost, so it is free. The bonus action does not count towards `bonusActionLimit` and is not a "bonus action" for Legislative Agenda cards 18 and 19.
23. **R15.6 - the VP tiles with `on-install`.** They have no step in the list at all (a step that does nothing would only open another Congress window).
24. **R16.9 - checked for every player.** Every unclaimed tile is evaluated for the active player and then for the others in turn order; the first to meet it takes it. It is a loop over the players, not a shortcut, so a state edited by hand (a test, a bug report) is treated like a played one.
25. **R16.4 - the places are dense.** Players are ranked by distinct measures: A, B tied at 3 and C at 2 gives 10, 10, 5. On a "fewest" goal a measure of 0 is the best measure and scores (R16.4.3 is about "most" goals only), so players who all hold nothing all score 10.
26. **R18.3 and R18.4 - tokens and storage.** A token returned for a resource goes into storage and can overflow it (R8.5.4); the discard is then asked like any other.
27. **R3.8 - setup order.** Module setup draws from the game RNG after every core draw, in the order upgrades, milestones, goals, Legislative Agenda, Pony Express.

