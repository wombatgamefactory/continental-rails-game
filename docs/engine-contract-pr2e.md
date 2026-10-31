# Pacific Rails, second edition - engine contract supplement

- Ruleset id `pr2e`, engine `src/engine-pr2e/`. Supplement version 3 (31/10/2026): the engine is on route map v3 (35 cities, 65 routes, 134 slots) and a lay can include wild slots (the `wildSlot` decision, the `fillWildSlot` action, the variant `wildSlotTerrain`). Version 2 covered the whole core rulebook; version 1 part 1, the game without Congress, upgrades and goals.
- Rules: the engine follows the ruleset's rules text, which is not part of this repository. Rule numbers (`P14.6`) refer to it and are cited here and in code comments.
- Status: **binding** for the pr2e engine, its bots and the page's pr2e views, together with `docs/engine-contract.md`.

`docs/engine-contract.md` is the contract every engine meets. This engine meets all of it as written: the model of section 1 (one plain-JSON state, a stack of pending decisions, atomic actions from `getValidActions`, the auto-advance rule, explicit stop actions, block reasons shared by the list and `applyAction`), the games API and state-as-a-value functions of section 2, hidden information and the RNG (sections 7, 8), events (section 13), bots (section 14), file responsibilities and the import direction (section 15). What this file adds is what is different in this ruleset: its state, its decisions, its action types, its block reasons, its scoring and its variants. The section numbers follow the main contract's.

Every rule of the core rulebook is played, with every value of every variant: the Financier action and the 8-column Congress (P10), cowboy hats from both sources (P11), carriage upgrades (P12) and the goal tiles (P18) included. The bots are in section 22.

---

## 2. Public API: what differs

Every function of sections 2.1 to 2.3 is exported with the same signature. Differences in what they return:

| Function | pr2e |
|---|---|
| `scoreGame` | Adds `winners` (every player of rank 1 once the game is over) and allows shared ranks (P20.4.3); section 9. |
| `previewMultipliers` | `[{ district, hats, mode, hat, multiplier, adjacent }]`: one entry per legal district choice; `hat` is `hats > 0`. |
| `canSpendHat(state, playerId)` | True at the player's own district choice when they hold a hat (P11.2). |
| `deserialiseState` | Also refuses a state whose `rules` is not `pr2e`. |

Reads added by this ruleset (all exported from `index.js`):

- `legality.js`: `hasLegalLay(state, playerId)` (P4.4.3, P15.5), `canFinishLay(state, playerId, cities, routes)` (P4.7: can a lay begun along this path still be finished), `isLegalLay(state, playerId, cities, routes)` (P14.3: is this path a complete legal lay), `canPlaceArrivalBuilding(state, playerId, city)` (P14.6.2), `canHire(state, playerId)` (P4.4.4, P8.2), `layPath(state)` (the path being built or, while its wild slots are asked, being resolved; or null), `previewLay(state)` (what the lay being built would score and pay if ended now), `wildSlotSpare(state)` (`{ terrain: spare count }` for each tile type the pending `wildSlot` decision can be filled with, or null), `getFillWildSlotBlockReason`, `specialActionPossible(state, playerId, special)`, `waitingStep(frame)`, `describeStep(state, step)`, `anySenatorUsed(state)` (P10.2.2), and the block reasons of section 6.
- `queries.js`: `evaluateLay(state, playerId, cities, routes)` (P14.7, P17, P19.2: `{ tiles, segments: [{ route, scoringCity, perSlot, slots, wild }], slots, trackVp, completes, completionVp, tolls: [{ owner, city, kind }], tollVp }`; `tiles` is `{ ground, tunnel, bridge, wild }`: the fixed slots by terrain and the number of wild slots, section 4.7), `scoringCityIndex`, `tilesForRoutes` (the same shape), `holdsTiles(player, tiles)` (each terrain's fixed tiles, then at least `wild` tiles of any kind left over, P14.9.2), `wildSlotsOnPath(state, cities, routes)` (`[{ route, slot }]`, the wild slots of a path's unlaid routes in the order the train passes them), `routeShortfall` (`{ ground, tunnel, bridge, wild }`: `wild` is the tiles of any kind still missing after the fixed slots are paid), `canAffordRoute`, `laidComponents`, `hasTranscontinentalLine(state)` (any owner, P19.1), `isLaid`, `laidRouteCount`, `isEmptyInlandCity`, `isOnNetwork` (P13.5), `routeBetween`, `districtHousesOn`, `districtHouseCount`, `emptySites`, `tracksWithHouses`, `telegraphsLeft`, `usedWorkerAt`, `carriageCount`, `congressColumns(state)` (P10.1: the eight columns `{ id, cost, reward, ..., down }` and the Reset `{ id: 'KR', cost, reset: true }`: this ruleset's Congress panel), `upgradeTokenIds(state)` (the distinct token ids, P12.1).
- `conditions.js`: `METRICS` (the twelve goal measures of P18.2), `metricValue`, `describeProgress(state, playerId, goal)` (`{ known: true, value, target: null, met: false, text: '3 railway stations' }`).
- `scoring.js`: `goalsInPlay(state)` (the 4 goal tiles `{ id, name, metric }`, left to right), `goalStandings(state, goal)` (`{ goal, values, places, awards }`: 5 VP to a sole leader with at least 1, nobody on a tie, P18.3).

Reads of the main contract kept with this ruleset's meaning: `production` (P6.2), `storageUsed` / `storageCapacity` (P7.2, P7.3: Coins count), `nextSpecialistSlot` (`{ carriage, slot, level }`, carriage = its number), `hireCost` (P8.5: nothing, or the Tycoon cost), `isCityConnected` (P1.18: an inland city with a building), `ownedRoutes` / `ownedSlots` (who laid what: statistics only, nobody owns track), `adjacentWorkers` / `multiplierFor` (P5.6: a centre worker is adjacent to its own district only; `multiplierFor` takes a hat count).

Reads of the main contract with this ruleset's meaning: `congressCoinCost(state, playerId, entry)` (a column's Coins, or the Reset's), `upgradeTileData(state, id)` (`{ id, level, gives, minPlayers }`), `installedUpgrades(state, playerId)` (token ids, left to right), `upgradeTileAt(state, playerId, carriageNumber)` (a token id or null).

Reads that answer "nothing" here, because the page asks every engine for them: `congressTable` (`[]`: the page's Continental Rails Congress strip reads fields this state does not have, so it shows nothing; the second edition's panel is `congressColumns`), `cardIndex`, `ponyCardData`, `ponyOngoing`, `legislativeCardData` (null / empty: no such module), `moveTrainPath` (null: there is no Move Train, P15.2), `bonusActionsInPlay` (`[]`), `BONUS_ACTION_TYPES` (`{}`), `activeModules` (all false: the goals and upgrades are core rules here, not modules). Continental Rails reads that do not exist here: `hasLegalClaim`, `hasLegalMove`, `claimRailheadIndex`, `moveRailheadIndex`, `placementContext`, `canPlaceAnyBuilding`, `networkCities`, `reachableCities`, `touchesClaimedRoute`, `hasOpponentRailwayStation`, `buildingRoom`, `getSpendHatBlockReason`, the module reads, `junctionCities`, `cityRegion`.

---

## 3. State shape

Plain JSON, as section 3 of the main contract requires. Field names are kept from Continental Rails where the thing is the same, so that the shared page and the simulator read them (code may keep `railhead` for a train and `train` for the player board, P1.22; player-facing text never does).

```js
state = {
  schemaVersion: 1,
  rules: 'pr2e',                 // the ruleset; deserialiseState refuses anything else
  config, variants, constantOverrides, constantsKey, rng, seq,   // as the main contract
  phase: 'setup' | 'play' | 'ended',
  setup: null | { step: 'production' | 'trainFirst' | 'trainSecond', index },
  turn: {
    number, player,
    step: null | 'start' | 'worker' | 'district' | 'resolve' | 'followUp',
    worker: null | { via: 'place' | 'remove' | 'displace', at: 'W4' | 'D5' },
    district: null | 'D1'..'D9' | 'none',
    mode: null | 'lay' | 'hire',  // P8.1, P14.1: the choice at D5
    hatsSpent: 0,                 // P11.2
    multiplier: null | M,         // P5.7
    adjacent: null | A
  },
  startPlayer: 0, stack: [...], toAct,
  players: [{
    id, configIndex, name, colour,
    coins: 1,                     // P1.8: a resource IN STORAGE (counted by storageUsed)
    hats: 0,                      // P11.1: 0 to 2
    resources: { iron, wood, gunpowder },
    builtTiles: { ground, tunnel, bridge },   // BUILT tiles in storage (P1.10)
    houses: { wood, iron, gunpowder, coins }, // houses left on each track (P2.3.3); production = 1 + (3 - houses)
    telegraphsPlaced: 0,          // telegraph stations gone from the row (P16.3)
    workersInSupply,
    train: { specialistCarriages: [{ number: 1, slots: [type | null, type | null], upgrade: null | tokenId }] },  // the player board's carriages, index = number - 1 (P7.4); `upgrade`: the token installed (P12)
    railheads: ['SEA', 'OMA'],    // the two trains (P15)
    startCities: [...],
    layStationsPlaced: 0,         // P16.5: railway stations placed by Lay Track
    turnsTaken: 0,
    vp: { track, completion, telegraph, toll, districtHouse, upgrade, congress, carriage3, buildingsEnd, tilesEnd, goals }
  }],
  grid: {
    tiles:  { D1: 'collect-gunpowder', ... },   // fixed (P5.1)
    spaces: { W1: null | playerId, ... },
    centres: { D1: null | playerId, ... },
    sites:  { D1: [null, null, null], D3: [...], D7: [...], D9: [...] }   // P6.6: district houses
  },
  map: {
    routeOwner: { 'SEA-YAK': null | playerId },   // a laid route records who laid it (statistics only, P13.4)
    railwayStation: { TDL: null | playerId },
    telegraphStation: { TDL: null | playerId },
    wildFill: { 'SPO-HEL': [{ slot: 2, terrain: 'ground' }] }   // P14.9.5: the terrain of the tile on each laid wild slot; a route with no wild slot has no entry
  },
  supply: { specialists: { crew, miner, engineer, financier },   // P3.1.6: 4 / 5 / 6 per type
            upgrades: ['U1-wood', ...] },                        // P3.1.5: the upgrade supply, filtered by player count; identical tokens share an id
  congress: { down: { K1: false, ... K8: false } },              // P10.1: true while a column's senator is down
  goals: ['G7', 'G1', 'G12', 'G4'],   // P3.1.7, P18.1: the goal tiles in play, left to right (drawn at setup; the rest are not stored)
  scoringCard: null,             // always null (no scoring card in this ruleset)
  completion: null | { player, turn, route, routes, slots },     // P19.2: the lay that completed the first line
  gameEnd: null | { reason: 'transcontinental' | 'turn-limit', triggeredBy, triggeredOnTurn },
  modules: {}                    // always empty: this ruleset has no modules
}
```

Nothing is hidden (P2.5): `hiddenDecks` is empty and `determinise` only replaces the game RNG.

`config.mapId` is `route-map-v3`: a save made on another map is refused by `deserialiseState`.

### 3.1 The map (P13, route map v3)

`MAP` (board.js) is built from `data/route-map.json` (the generated module `data/route-map.js` holds the same data): a 600 x 350 board, 35 cities (4 west and 4 east start cities, 27 inland), 65 routes of 1 to 4 slots, 134 slots: Ground 46, Tunnel 44, Bridge 41, wild 3. Route ids are `a-b` as the data gives them (`SEA-YAK`, `TDL-POR`, `SPO-HEL`); the full table is in the ruleset's rules text and the data file. A route record is `{ id, index, a, b, terrains, length, cost, wild, line, slots }`:

- `terrains`: one entry per slot from `a` to `b`: `ground`, `tunnel`, `bridge` or `wild`.
- `cost`: **only the fixed slots**, `{ ground, tunnel, bridge }` (always exactly these three keys, so a loop over them is a loop over tile types), and `wild`: how many of the route's slots are wild (P1.16; the data has at most one per route: `SPO-HEL`, `BIL-DEN`, `BIL-BIS`). `wild` is a kind of slot, never a tile type or a storage item (`TERRAINS` and `STORAGE_ITEMS` do not have it; `NAMES.wild` is "any tile", the words a screen shows).
- For the page only: `line` (whether the art draws a black line between the two cities) and `slots: [{ x, y, angle, terrain }]` (where each slot is drawn). `MAP` also carries `cityStyle` (how the art draws a city), `labels` (`[{ city, text, x, y, x0, y0, x1, y1, colour }]`, where the art puts each city's name), `slotSize` (`{ l, w, outline }`) and `board` (`{ w, h }`).
- `mapSlotTotals()` returns `{ ground, tunnel, bridge, wild }`.

---

## 4. Decisions

### 4.2 The flow between decisions

- **Setup.** `setupProduction` for each seat in seat order (P3.3), then `setupRailhead` in reverse seat order, then in seat order (P3.5). Then turn 1 of seat 1 (P3.6). All setup randomness (the seats, P3.4) is drawn in `createGame`.
- **A turn** (P4.2):

| step | what the flow does when the stack is empty |
|---|---|
| `start` | Emits `turnStart`, pushes `workerStep`. |
| `worker` | Pushes `chooseDistrict`. (A displacement's compensation choices, P5.5.3, are resolved before this.) |
| `district` | Runs the district family's resolver: Collect gains the yield (P6.3); a board activation pushes `boardActivation` (P9); D5 pushes `hire` or `lay` (P8.1, P14.1). |
| `resolve` | Collect only: pushes `specialAction` (P6.7). |
| `followUp` | Ends the turn: the turn limit (P19.5), `turnEnd`, then the next turn or, once the end is triggered and the last seat has played, final scoring (P19.3, P20.2). |

The end by the transcontinental line is triggered inside the lay that completes it (P14.5.2), not at the end of the turn; the action and the round then finish normally.

### 4.3 Auto-advance

As the main contract. In this ruleset the forced actions are mostly: a Crew, Miner or Engineer step that cannot be paid (`skipStep`), a Financier step with no affordable column and no possible Reset (`skipStep`, P10.4), an upgrade step (no decision at all: its yield is taken by `RESUME`; a level 3 token then asks `chooseResource` three times), a special action that cannot be paid or carried out (`skipSpecialAction`), a district choice with one legal answer, a lay step with one way on (`startLay`, `extendPath`, `endLay`), a wild slot with one terrain to spare (`fillWildSlot`, section 4.7), and an arrival building with one legal answer (one kind possible and, for a railway station, one track with a house).

### 4.4 Granularity

A lay is built one route at a time (`extendPath`), so no action lists a whole path (P4.7). An `extendPath` is offered only if the lay can still be finished from where it would stand (`canFinishLay`), so a player never builds into a dead end; nothing is paid, scored or moved until `endLay` (P14.5). A resource of choice is one action per unit. The hats spent and the D5 mode are part of the district choice (`chooseDistrict { district, hats, mode }`).

### 4.5 Stop actions

| Stop action | Where | Rule |
|---|---|---|
| `skipStep` | a Crew, Miner, Engineer or Financier step of a board activation | P9.3, P10.2.3 |
| `skipSpecialAction` | the special action after a Collect | P6.7 |
| `skipBuilding` | the arrival building, ONLY with `arrivalBuilding = optional`; and the second building of Congress column K7, once the first is placed | P14.6, P10.3.4 |
| `stopHiring` | after at least one hire | P8.1 |
| `stopLaying` | between lays, after at least one lay | P14.1 |

`STOP_ACTION_TYPES` is `['skipStep', 'skipSpecialAction', 'skipBuilding', 'stopHiring', 'stopLaying']`.

### 4.6 Decisions by a player who is not the active player

- P5.5.3: a displaced worker's owner who holds 2 hats chooses a resource (any of the four, Coin included), in turn order from the active player's left.
- P7.6: any player over capacity discards at once.

### 4.7 The frames

| kind | fields | accepts | rule |
|---|---|---|---|
| `setupProduction` | | `chooseStartingProduction` | P3.3 |
| `setupRailhead` | | `placeRailhead` | P3.5 |
| `workerStep` | | `placeWorker`, `displaceWorker`, `removeWorker` | P4.2.1, P5.3 to P5.5 |
| `chooseResource` | `remaining`, `reason`, `allowed` (resource ids) | `chooseResource` | P5.5.3, P11.1 |
| `discard` | | `discard` | P7.6 |
| `chooseDistrict` | | `chooseDistrict` | P4.2.2 |
| `specialAction` | `district`, `special` (`telegraphStation`, `districtHouse`, `upgrade`, `railwayStation`) | the district's action (`placeTelegraphStation`, `placeDistrictHouse`, `installUpgrade`, `placeRailwayStation`), `skipSpecialAction` | P6.7, P12.2, P12.3 |
| `boardActivation` | `foreman`, `steps: [{ type, carriage, slot, token? }]` (carriage 0 = the Foreman; `type: 'upgrade'` with the `token` for an upgrade step), `index`, `cause` | at a Crew, Miner or Engineer step: `useStep`, `skipStep`; at a Financier step: `takeCongressColumn`, `resetSenators`, `skipStep`; an upgrade step asks nothing | P9, P10.2, P12.4 |
| `congressPlacement` | `column` (`K5` or `K7`), `placed: { railwayStation, telegraphStation }` | K5: `placeDistrictHouse`, `installUpgrade` (no replacing); K7: `placeRailwayStation`, `placeTelegraphStation`, then `skipBuilding` once one is placed | P10.3.3, P10.3.4 |
| `chooseBuiltTile` | `remaining`, `cause` | `chooseBuiltTile` | P10.3.5 |
| `hire` | `remaining`, `taken` | `hireSpecialist`, `stopHiring` (once `taken` is at least 1) | P8 |
| `chooseFreeSpecialist` | | `chooseFreeSpecialist` | P16.5.1 |
| `lay` | `remaining`, `taken`, `path: null \| { train, cities, routes }`; `wildFills` only while the lay's wild slots are being asked | with no path: `startLay`, `stopLaying` (once `taken` is at least 1); with a path: `extendPath`, `endLay` | P14 |
| `wildSlot` | `route` (the route id), `slot` (the index of the wild slot in the route's terrain string, counted from the route's first city `a`), `remaining` (how many more wild slots this lay asks about after this one), `cause: 'lay'` | `fillWildSlot` | P14.9 |
| `placeBuildings` | `city`, `optional`, `cause` (`arrival`) | `placeRailwayStation { city, houseTrack }`, `placeTelegraphStation { city }`; `skipBuilding` only when `optional` | P14.6 |

The frame names of the setup draft are Continental Rails' (`setupRailhead`, `placeRailhead`): P24.1 keeps the draft unchanged and P1.22 lets code keep `railhead`.

**Board activation (P9).** `boardActivation` holds the whole step list, built once: the Foreman M times as the district's type, then for carriages 1, 2, 3 in turn: the carriage's upgrade token, if any, then its specialists in space order (P12.4). Each specialist and each token acts once. At a Crew, Miner or Engineer step the frame asks `useStep` (pay 1 Iron / Gunpowder / Wood, gain 1 built Ground / Tunnel / Bridge tile) or `skipStep`; overflow is settled after each step. An upgrade step is no decision: `RESUME` takes its yield (level 1: 1 of its type; level 2: 2; level 3: a `chooseResource` frame for 3 of choice, Coin allowed), which may pay for later steps. A token installed during the activation (Congress column K5) acts from the next activation: the list is built once. The frame closes after its last step (`RESUME`).

**The Financier step (P10.2).** It offers `takeCongressColumn { column }` for every column whose senator is up, whose Coins the player holds and whose reward can be carried out at all (P10.3.6), `resetSenators` when a senator is down and the player has 1 Coin, and `skipStep`. Taking a column pays its Coins, puts its senator down, consumes the step and resolves the reward completely before the next step: K1 to K3 gain 2 resources (overflow is discarded at once); K4 gives 2 hats (P11.1: each over the limit is a `chooseResource`, Coin allowed, or with `hatOverflow = lost` nothing); K5 pushes `congressPlacement` (a free district house, or an installed token under P12.2 without replacing; 1 VP either way); K6 pushes `chooseResource` for 4 of Wood, Iron or Gunpowder; K7 pushes `congressPlacement` for one or both buildings under P10.3.4, which bring no carriage (P16.5); K8 pushes `chooseBuiltTile` twice. The Reset pays 1 Coin, returns every senator that is down and books 1 VP each to `congress`.

**Upgrades (P12).** `installUpgrade { token, carriage }` puts a token from the supply into one of the player's carriages: the carriage holds a specialist, has no token, the token's level equals the carriage number, and with `upgradePlacement = first-free` it is the leftmost such carriage (P12.2). At the Collect Wood special action (1 Gunpowder, 2 VP) the same action on a carriage that already holds a token of that level replaces it (P12.3: no VP, the old token returns to the supply; not with an identical token). Congress column K5 installs (1 VP) but never replaces.

**The lay (P14).** `lay` gives M lays. `startLay { train }` begins a path at a train (with both trains on one city only the first index is offered: the two would be the same lay). `extendPath { route }` adds a printed route from the path's last city to a city not yet on it: laid routes are travelled, unlaid ones will be laid. `endLay` resolves P14.5 in order: pay the tiles and lay the unlaid routes; the transcontinental check; track VP by scoring city (or the completion VP instead); tolls; the train moves; then, if the player is able (`canPlaceArrivalBuilding`), `placeBuildings` is pushed (P14.6), and a railway station placed there counts towards carriages (P16.5, pushing `chooseFreeSpecialist` with carriage 1). Between lays the frame offers the next `startLay` or `stopLaying`, and closes by itself when the lays are used up or no further lay is possible. The shapes of `layShape` and the rule of `newConnectionRule` are applied by `isLegalLay` and `canFinishLay`.

**Wild slots in a lay (P14.9).** A wild slot takes one built tile of any terrain, on top of the fixed slots: a path whose unlaid routes have the fixed slots `cost` (by terrain) and `wild` wild slots is payable when each `builtTiles[t] >= cost[t]` and `(builtTiles.ground - cost.ground) + (builtTiles.tunnel - cost.tunnel) + (builtTiles.bridge - cost.bridge) >= wild`. That one test (`holdsTiles` on `tilesForRoutes`) is used by `isLegalLay`, `canFinishLay`, `hasLegalLay` and `getExtendPathBlockReason`, so `extendPath` is offered only when some finished lay can still pay, and the block reason when only the second part fails reads "This lay also needs N more built tile(s) of any type for a wild slot: after the fixed slots you have S spare." `startLay`, `extendPath` and `endLay` are unchanged. `endLay` on a path whose unlaid routes include wild slots does **not** resolve the lay: it sets `wildFills: []` on the `lay` frame and pushes one `wildSlot` frame per wild slot, in the order the train passes them (route by route from the path's first city; within a route in the direction of travel), the first on top, each with its `remaining`. `fillWildSlot { terrain }` is offered for each tile type with a spare tile: held, minus the lay's fixed slots, minus the tiles already chosen for earlier wild slots of this lay (`wildSlotSpare`). There is no stop action. By the auto-advance rule a frame with exactly one legal terrain is applied by the engine (`auto: true`), so the choice reaches the player only when two or more kinds are spare; up to three questions in a row on map v3 (Spokane - Helena - Denver - Billings - Bismarck). The last answer resolves P14.5 (pay the fixed tiles and the chosen ones, the line check, track VP, tolls, the train, the building); nothing of it happens earlier, and the choices cannot be undone. `layPath(state)` and `previewLay(state)` keep answering while the `wildSlot` frames are on top. A wild slot scores like any slot (P14.7, P19.2) and no rule of this ruleset reads the terrain of a laid slot, so the variant `wildSlotTerrain` (section 10) changes nothing here.

**Hiring (P8).** `hire` gives M hires into the leftmost empty space, the first required; Tycoon Mode charges the table of P8.5; a specialist hired into carriage 3 scores 2 or 5 VP. The frame closes by itself when the hires are used up or no further hire is possible.

---

## 5. Action catalogue

An action is `{ type, ...params }`, plain JSON; `player` is optional as in the main contract. Ids: districts `D1`..`D9`, worker spaces `W1`..`W12`, cities and routes as in the map data, resources `wood`, `iron`, `gunpowder`, `coins`, terrains `ground`, `tunnel`, `bridge`, specialists `crew`, `miner`, `engineer`, `financier`, house tracks `wood`, `iron`, `gunpowder`, `coins`, trains `0` and `1`.

| type | params | meaning | rule |
|---|---|---|---|
| `chooseStartingProduction` | `track` | Leave that track's +1 space empty: production 2. | P3.3 |
| `placeRailhead` | `city` | Put a train on a start city in the draft. | P3.5 |
| `chooseResource` | `resource` | Take 1 resource of choice (one of the frame's `allowed`). | P5.5.3, P11.1 |
| `discard` | `item` | Discard 1 stored item (a resource, a Coin or a built tile). | P7.6 |
| `placeWorker` | `space` | Place a worker on an empty worker space. | P5.3 |
| `displaceWorker` | `district` | Place a worker on the centre of a blocked district; every worker on its spaces and centre returns. | P5.5 |
| `removeWorker` | `from` | Take your worker off a worker space or (district id) a centre. | P5.4 |
| `chooseDistrict` | `district`, `hats`; optional `mode` | Take that district's action, spending `hats` cowboy hats; at D5 `mode` is `lay` or `hire`, elsewhere it is absent. `district: 'none'` (hats 0) only in the case of P5.4.4. | P4.2.2, P5.7, P8.1, P11.2 |
| `useStep` | | Use the current Crew, Miner or Engineer step. | P9.3 |
| `skipStep` | | Skip the current step. | P9.3 |
| `skipSpecialAction` | | Decline the special action. | P6.7 |
| `placeTelegraphStation` | `city` | The bottom telegraph station of your row onto `city`, scoring its VP: on arrival, or by the Collect Gunpowder special action (1 Coin; a city with another player's railway station). | P16.3, P14.6, P6.7 |
| `placeRailwayStation` | `city`, `houseTrack` | The leftmost house of that track onto `city`: on arrival (counts towards carriages), or by the Collect Coins special action (1 Iron; a city with another player's telegraph station; no carriage). | P16.2, P14.6, P6.7, P16.5 |
| `placeDistrictHouse` | `district`, `houseTrack` | The Collect Iron special action: 1 Wood, the leftmost house of that track onto the first empty building site of `district`, 2 VP. | P6.6, P6.7 |
| `skipBuilding` | | Place no arrival building (`arrivalBuilding = optional` only). | P14.6 |
| `hireSpecialist` | `specialist` | Hire into the leftmost empty space. | P8 |
| `stopHiring` | | Stop hiring. | P8.1 |
| `chooseFreeSpecialist` | `specialist` | The free specialist with carriage 1, into its space 1. | P16.5.1 |
| `startLay` | `train` | Begin a lay at train 0 or 1. | P14.1, P14.2 |
| `extendPath` | `route` | Extend the lay along a route from its last city. | P14.2, P14.3, P4.7 |
| `endLay` | | End the lay at its last city and resolve it. | P14.5 |
| `stopLaying` | | Make no further lay this action. | P14.1 |
| `fillWildSlot` | `terrain` (`ground`, `tunnel` or `bridge`) | Put a spare built tile of that terrain on the wild slot being asked (a `wildSlot` frame). | P14.9 |
| `takeCongressColumn` | `column` (`K1`..`K8`) | At a Financier step: pay the column's Coins, its senator goes down, take its reward. | P10.2.1, P10.3 |
| `resetSenators` | | At a Financier step: pay 1 Coin, every senator that is down returns, 1 VP each. | P10.2.2 |
| `installUpgrade` | `token` (an id such as `U2-coins`), `carriage` (1 to 3) | Install that token from the supply in that carriage, or (Collect Wood only) replace the token there. | P12.2, P12.3, P6.7, P10.3.3 |
| `chooseBuiltTile` | `terrain` | Take 1 built tile of that type (Congress column K8). | P10.3.5 |

`actionKey` appends an optional parameter only when it is present (`chooseDistrict:D5:0:mode=lay`), so equal actions give equal keys. Continental Rails action types that do not exist here: `chooseStartingSpecialist`, `buyHat`, `addCarriage`, `skipBonusAction`, `takeCongressEntry`, `closeCongress`, `chooseOption`, `claimRoute`, `moveTrain`, and the module actions. `installUpgrade` and `chooseBuiltTile` exist in both rulesets: `chooseBuiltTile` has the same parameters; `installUpgrade` here takes `{ token, carriage }` (Continental Rails: `{ tile, level }`).

---

## 6. Block reasons

The same shape and the same rules for writing them as section 6 of the main contract; `getBlockReason` dispatches through `ACTIONS`, and `getValidActions` lists only actions whose block reason is null.

| Function | Rule |
|---|---|
| `getStartingProductionBlockReason(state, playerId, track)` | P3.3 |
| `getPlaceRailheadBlockReason(state, playerId, city)` | P3.5 |
| `getChooseResourceBlockReason(state, playerId, resource)` | P1.8, P5.5.3 |
| `getDiscardBlockReason(state, playerId, item)` | P7.6 |
| `getPlaceWorkerBlockReason(state, playerId, space)` | P5.3 |
| `getDisplaceWorkerBlockReason(state, playerId, district)` | P5.5.1, P5.5.5 |
| `getRemoveWorkerBlockReason(state, playerId, from)` | P5.4 |
| `getDistrictActionBlockReason(state, playerId, district, mode?)` | P4.4 (with `mode` at D5: that action only) |
| `getChooseDistrictBlockReason(state, playerId, district, hats, mode)` | P4.2.2, P11.2 |
| `getUseStepBlockReason(state, playerId)`, `getSkipStepBlockReason` | P9.3 |
| `getSkipSpecialActionBlockReason` | P6.7 |
| `getPlaceTelegraphStationBlockReason(state, playerId, city)` | P16.3, P16.1, P14.6, P6.7 |
| `getPlaceRailwayStationBlockReason(state, playerId, city, houseTrack)` | P16.2, P16.1, P14.6, P6.7 |
| `getPlaceDistrictHouseBlockReason(state, playerId, district, houseTrack)` | P6.6, P6.7 |
| `getSkipBuildingBlockReason` | P14.6.1 |
| `getHireSpecialistBlockReason(state, playerId, specialist)`, `getStopHiringBlockReason` | P8 |
| `getChooseFreeSpecialistBlockReason(state, playerId, specialist)` | P16.5.1 |
| `getStartLayBlockReason(state, playerId, train)`, `getExtendPathBlockReason(state, playerId, route)`, `getEndLayBlockReason`, `getStopLayingBlockReason` | P14 |
| `getFillWildSlotBlockReason(state, playerId, terrain)` | P14.9: a tile type, a spare tile of it, then the wild-slot decision |
| `getTakeCongressColumnBlockReason(state, playerId, column)` | P10.2.1, P10.3.6: the senator, the Coins, the reward, then the Financier step |
| `getResetSenatorsBlockReason(state, playerId)` | P10.2.2: a senator down, 1 Coin, then the Financier step |
| `getInstallUpgradeBlockReason(state, playerId, token, carriage)` | P12.2 items 1 to 5 in order, P12.3 (replacing at Collect Wood only), then the Gunpowder or the K5 frame |
| `getChooseBuiltTileBlockReason(state, playerId, terrain)` | P10.3.5 |

`getPlaceDistrictHouseBlockReason`, `getPlaceRailwayStationBlockReason` and `getPlaceTelegraphStationBlockReason` also read the `congressPlacement` frame (K5: a free district house; K7: the city conditions of P10.3.4), and `getSkipBuildingBlockReason` allows the stop after K7's first building.

`DISTRICT_ACTION_RULES` and `DISTRICT_RESOLVERS` have the families `collect`, `boardActivation` and `layOrHire`.

---

## 9. Scoring

VP are booked by source through `addVp`, with these ids (`VP_SOURCES`, P20.1, P20.2); every source is always in play:

| id | when | what | rule |
|---|---|---|---|
| `track` | play | 2 VP per slot to an unconnected scoring city, 1 VP otherwise | P14.7 |
| `completion` | play | the completing lay's slots at 3 VP each (instead of `track`) | P19.2 |
| `telegraph` | play | the telegraph row's VP | P16.3 |
| `toll` | play | 3 VP per other player's train entering a city with your building | P17 |
| `districtHouse` | play | 2 VP per district house of the Collect Iron special action | P6.7 |
| `upgrade` | play | 2 VP per upgrade token installed by the Collect Wood special action (none for a replacement) | P6.7, P12.3 |
| `congress` | play | K5's 1 VP and the Reset's 1 VP per senator | P10.2.2, P10.3.3 |
| `carriage3` | play | 2 or 5 VP for a specialist hired into carriage 3 | P8.4 |
| `buildingsEnd` | final | the building table of P20.3 | P20.2.1 |
| `tilesEnd` | final | 1 VP per built tile in storage | P20.2.2 |
| `goals` | final | 5 VP to the sole leader of each goal in play | P20.2.3, P18.3 |

```js
scoreGame(state) -> {
  final, endReason: null | 'transcontinental' | 'turn-limit',
  players: [{ id, name, total, bySource, tieBreak: { districtHouses, buildings }, rank }],
  ranking: [playerId, ...],   // best first; players tied after both tie-breaks in seat order
  winner: null | playerId,    // ranking[0] once final
  winners: [playerId, ...],   // every player of rank 1 once final (P20.4.3: a shared victory)
  decidedBy: 'vp' | 'districtHouses' | 'buildings' | 'shared'
}
```

Ranks are shared by players tied on VP, district houses and buildings (1, 1, 3). Before the end the final sources are filled in as they would be if the game ended now.

---

## 10. Variants and constants

`VARIANTS` holds the 8 variants of P21.1, each with its default; the functions of section 10 of the main contract work unchanged.

| Variant | Values (default first) | Rule | Read by |
|---|---|---|---|
| `tycoonMode` | `false`, `true` | P8.5 | `hireCost` |
| `layShape` | `path`, `one-new-route`, `adjacent-only` | P14.3.4 | `isLegalLay`, `canFinishLay`, `getExtendPathBlockReason` |
| `newConnectionRule` | `any-unlaid-route`, `must-join-unjoined` | P14.3.5 | the same |
| `arrivalBuilding` | `compulsory-if-able`, `optional` | P14.6 | the `placeBuildings` frame (`optional`) |
| `upgradePlacement` | `first-free`, `any-carriage` | P12.2.4 | `installTerms` (legality.js) |
| `hatOverflow` | `resource`, `lost` | P11.1 | `gainHats` for Congress column K4 (a displacement always gives a resource) and K4's feasibility |
| `maxTurnsPerPlayer` | 80, integer 0 to 500 (0 = off) | P19.5 | `endTurn` |
| `wildSlotTerrain` | `tile-terrain`, `no-terrain` | P14.9.6 | nothing: no rule of this ruleset reads the terrain of a laid slot, so both values play the same game; it exists so that both rulesets accept the same switch |

`UNIMPLEMENTED_VARIANT_VALUES` is empty: every value is played.

Constants are in `rules.js` by group (`SETUP`, `SUPPLY`, `PLAYER_BOARD`, `HATS`, `GRID`, `ACTIVATION`, `HIRING`, `CONGRESS`, `UPGRADES`, `MAP_RULES`, `SCORING`, and the vocabulary tables), gathered in `RULES`; `P21_2_CONSTANTS` maps each constant name of P21.2 to where it lives. Logic reads them through `getConstants(state)`; `--const.<GROUP>.<name>` overrides them, recorded in the state, exactly as in the main contract.

---

## 13. Events

As the main contract (`action` first, then what it caused). The event types of this ruleset: `action`, `startingProduction`, `railheadPlaced`, `setupComplete`, `turnStart`, `turnEnd`, `workerReturned`, `districtChosen` (`district`, `tile`, `mode`, `multiplier`, `adjacent`, `hats`, `hat`), `gather` (`item`, `production`, `districtHouses`, `multiplier`, `amount`), `gain`, `pay`, `hatLimit`, `discard`, `boardActivation` (`foreman`, `steps`, `cause`), `build` (`terrain`, `specialist`, `carriage`), `hire` (`specialist`, `carriage`, `slot`, `cause`: `hire` or `carriage1`), `carriageAdded` (`carriage`), `districtHousePlaced` (`district`, `site`, `houseTrack`), `buildingPlaced` (`kind`, `city`, `houseTrack` or `vp`, `cause`: `arrival` or `special`), `routeLaid` (`route`, `slots`, `cost`: the tiles actually paid for the route by terrain, wild fills included; `wild`: `[{ slot, terrain }]`, empty for a route with no wild slot), `toll` (`player` = the owner paid, `by`, `city`, `kind`), `railheadMoved` (`railhead`, `from`, `to`, `cities`, `routes`), `lay` (a summary: `cities`, `routes`, `laid`, `segments`, `trackVp`, `completes`, `wild`: every fill of the lay, `[{ route, slot, terrain }]`), `completion` (`route`, `routes`, `bonus`), `congressEntry` (`entry` / `column`: `K1`..`K8`, or `KR` for the Reset; `coins`), `senatorsReset` (`count`), `upgradeInstalled` (`tile` = `token`, `carriage`, `level`, `replaced` (the token returned, or null), `cause`: `special` or `congress:K5`), `upgradeStep` (`token`, `carriage`, `level`, `gives`, `amount`), `vp`, `gameEndTriggered`, `gameOver` (adds `winners`). Each `fillWildSlot` is an `action` event like any other (`auto: true` when the engine applied it), placed between the `endLay` action event (or the previous `fillWildSlot`) and the events of the lay it lets resolve. `districtHousePlaced` and `buildingPlaced` take the cause `congress:K5` / `congress:K7`.

---

## 20. How the engine reads the rules where they leave a choice

1. **Coins** (P1.8, P7.3) are kept in `player.coins`, as in Continental Rails, but counted in storage, discarded like any item and allowed as "a resource of your choice" wherever the rule allows it.
2. **The special action is always asked after a Collect** (P6.7) and declined by the engine when nothing can be done (a forced `skipSpecialAction`).
3. **A displaced owner with several returned workers** (P5.5.3) gains hats up to the limit first; the rest are owed as one `chooseResource` frame of that many units.
4. **Both trains on one city** (P15.3): `startLay` is offered for the first train there only.
5. **The completion VP after the end was triggered by the turn limit** (P19.2, P19.5): still paid to the lay that completes the first line; the end is not triggered again and its reason stays `turn-limit`.
6. **`state.completion.route`** is the last route laid by the completing lay; `routes` lists all it laid, `slots` their total.
7. **A shared victory** (P20.4.3) is reported by shared ranks and `winners`; `winner` stays the first id of `ranking` so that a reader wanting one name gets one.
8. **`routeOwner`** records who laid a route, for statistics and the page; no rule reads it (P13.4).
9. **Hire and lay frames close by themselves** once at least one hire or lay is made and no further one is possible, rather than asking a lone stop action.
10. **The K5 choice** (P10.3.3, P4.6 "`chooseOption` then the placement") is one decision: the frame lists both halves' placements together (`placeDistrictHouse` and `installUpgrade`), so the half is chosen by choosing a placement. Nothing is lost: each action names exactly one half and one place.
11. **K7's second building** (P10.3.4 "one or both") is offered after the first with `skipBuilding` as the stop; the reward ends by itself when no second building is possible.
12. **A token installed by K5 during a board activation** acts from the next activation (the step list is built when the activation starts, P9.2).
13. **Replacing with an identical token** (P12.3) is refused: it would change nothing but cost a Gunpowder.
14. **K4 with `hatOverflow = lost`** at the hat limit cannot be taken, since its reward could not be carried out at all (P10.3.6).
15. **Tycoon Mode** (P8.5) charges the table; the free specialist of carriage 1 never costs anything.
16. **The upgrade tokens** in the supply (P3.1.5) are stored by id with duplicates (`U1-iron` twice at 3 players); identical tokens are interchangeable.
17. **The goal tiles** are drawn from the game RNG in `createGame`, after the seats, and stored in the order drawn; the eight left in the box are not stored (nothing is hidden).
18. **Wild slots are paid from what is left over** (P14.9.2): the fixed slots of the whole path are paid by terrain first, and each wild slot then takes one spare tile of any terrain. The fill is asked of the player, when the lay ends, only when two or more terrains are spare; the engine never picks between real alternatives. Wild slots on routes the path only travels over are already filled and are not asked about.
19. **`layPath` and `previewLay` while wild slots are asked**: they keep returning the path of the lay being resolved (the `lay` frame under the `wildSlot` frames), so a page can keep drawing it; `getValidActions` offers only `fillWildSlot` then.
20. **Saved games**: a save of this ruleset made on another map is refused (`config.mapId`), and a state with `wildSlot` frames on its stack loads and goes on exactly as it was.

---

## 22. Bots

The five levels exist for this ruleset, built by `src/rulesets/pr2e.js`:

- **Random** is the shared random bot over this engine.
- **Easy and Medium** are the heuristic bot of `src/bots/pr2e/` (`heuristicBot-pr2e.js`, tuning in `weights-pr2e.js`), built by `createPr2eHeuristicPolicies(engine)`; Easy plays the same scores with noise. It plans path lays (tolls, the forced arrival building, the track VP by scoring city, wild slots), Congress columns and the Reset, goals, upgrade tokens and hiring. A candidate path's need is its fixed tiles by terrain plus a count of wild slots; it is payable by the engine's own test (fixed tiles, then enough tiles of any kind left over), and for planning the wild tiles are given first to the terrains with the most spare tiles in storage and then to the terrain whose resource is most plentiful. The `wildSlot` decision is scored by keeping what the plan's other targets still need and spending the terrain with the most spare tiles beyond that (every built tile left at the end is worth 1 VP whatever its type, so the choice matters only for the next lays); ties go to Ground, then Tunnel. The policies have the same shape as the Continental Rails ones (`heuristicBot`, `easyBot`, `heuristicPolicy`, `rolloutPolicy`, `scoreValidActions`, a no-op `repeatGuard`, `decisionShare`, `pipelineValue`).
- **Hard and Expert** are the shared tree search (`src/bots/mctsBot.js`, unchanged) with those scores as priors and that policy for the playouts. A playout runs to the end of the game (the transcontinental line or the turn limit); the search reads only `determinise`, which here replaces the game RNG, since nothing is hidden.

Strengths, speeds and the tuning record are in `docs/bots.md` (last section). A bot reads the engine it is handed and imports no engine of its own (section 21 of the main contract).
