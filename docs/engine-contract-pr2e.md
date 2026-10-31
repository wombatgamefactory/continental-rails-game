# Pacific Rails, second edition - engine contract supplement

- Ruleset id `pr2e`, engine `src/engine-pr2e/`. Supplement version 1 (31/10/2026): part 1 of 2, the core game.
- Rules: the engine follows the ruleset's rules text, which is not part of this repository. Rule numbers (`P14.6`) refer to it and are cited here and in code comments.
- Status: **binding** for the pr2e engine, its bots and the page's pr2e views, together with `docs/engine-contract.md`.

`docs/engine-contract.md` is the contract every engine meets. This engine meets all of it as written: the model of section 1 (one plain-JSON state, a stack of pending decisions, atomic actions from `getValidActions`, the auto-advance rule, explicit stop actions, block reasons shared by the list and `applyAction`), the games API and state-as-a-value functions of section 2, hidden information and the RNG (sections 7, 8), events (section 13), bots (section 14), file responsibilities and the import direction (section 15). What this file adds is what is different in this ruleset: its state, its decisions, its action types, its block reasons, its scoring and its variants. The section numbers follow the main contract's.

**Part 2** (a later task) adds the Financier action and the 8-column Congress (P10), cowboy hats from Congress column K4 (P11.3), carriage upgrades (P12), the goal tiles (P18) and nothing else. Every place it plugs in is marked `// PART 2:` in the code; section 22 below lists them.

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

- `legality.js`: `hasLegalLay(state, playerId)` (P4.4.3, P15.5), `canFinishLay(state, playerId, cities, routes)` (P4.7: can a lay begun along this path still be finished), `isLegalLay(state, playerId, cities, routes)` (P14.3: is this path a complete legal lay), `canPlaceArrivalBuilding(state, playerId, city)` (P14.6.2), `canHire(state, playerId)` (P4.4.4, P8.2), `layPath(state)` (the path being built, or null), `previewLay(state)` (what the lay being built would score and pay if ended now), `specialActionPossible(state, playerId, special)`, `waitingStep(frame)`, `describeStep(state, step)`, `anySenatorUsed(state)`.
- `queries.js`: `evaluateLay(state, playerId, cities, routes)` (P14.7, P17, P19.2: `{ tiles, segments: [{ route, scoringCity, perSlot, slots }], slots, trackVp, completes, completionVp, tolls: [{ owner, city, kind }], tollVp }`), `scoringCityIndex`, `tilesForRoutes`, `holdsTiles`, `laidComponents`, `hasTranscontinentalLine(state)` (any owner, P19.1), `isLaid`, `laidRouteCount`, `isEmptyInlandCity`, `isOnNetwork` (P13.5), `routeBetween`, `districtHousesOn`, `districtHouseCount`, `emptySites`, `tracksWithHouses`, `telegraphsLeft`, `usedWorkerAt`, `carriageCount`.

Reads of the main contract kept with this ruleset's meaning: `production` (P6.2), `storageUsed` / `storageCapacity` (P7.2, P7.3: Coins count), `nextSpecialistSlot` (`{ carriage, slot, level }`, carriage = its number), `hireCost` (P8.5: nothing, or the Tycoon cost), `isCityConnected` (P1.18: an inland city with a building), `ownedRoutes` / `ownedSlots` (who laid what: statistics only, nobody owns track), `adjacentWorkers` / `multiplierFor` (P5.6: a centre worker is adjacent to its own district only; `multiplierFor` takes a hat count).

Reads of the main contract that answer "nothing" here, because the page asks every engine for them: `congressTable` (PART 2: `[]`), `congressCoinCost`, `cardIndex`, `upgradeTileData`, `installedUpgrades`, `upgradeTileAt` (PART 2), `ponyCardData`, `ponyOngoing`, `legislativeCardData` (null / empty: no such module), `moveTrainPath` (null: there is no Move Train, P15.2), `describeProgress` (`{ known: false, ... }`), `goalsInPlay` (PART 2: `[]`), `goalStandings`, `METRICS` (empty), `bonusActionsInPlay` (`[]`), `BONUS_ACTION_TYPES` (`{}`), `activeModules` (all false). Continental Rails reads that do not exist here: `hasLegalClaim`, `hasLegalMove`, `claimRailheadIndex`, `moveRailheadIndex`, `placementContext`, `canPlaceAnyBuilding`, `networkCities`, `reachableCities`, `touchesClaimedRoute`, `hasOpponentRailwayStation`, `buildingRoom`, `getSpendHatBlockReason`, the module reads, `junctionCities`, `cityRegion`.

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
    train: { specialistCarriages: [{ number: 1, slots: [type | null, type | null], upgrade: null }] },  // the player board's carriages, index = number - 1 (P7.4); `upgrade` is PART 2
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
    routeOwner: { 'SEA-SPO': null | playerId },   // a laid route records who laid it (statistics only, P13.4)
    railwayStation: { SPO: null | playerId },
    telegraphStation: { SPO: null | playerId }
  },
  supply: { specialists: { crew, miner, engineer, financier },   // P3.1.6: 4 / 5 / 6 per type
            upgrades: ['U1-wood', ...] },                        // P3.1.5, filtered by player count (used in PART 2)
  congress: { down: { K1: false, ... K8: false } },              // P3.1.3 (used in PART 2)
  goals: [],                     // PART 2: the goal tiles in play (P18.1)
  scoringCard: null,             // always null (no scoring card in this ruleset)
  completion: null | { player, turn, route, routes, slots },     // P19.2: the lay that completed the first line
  gameEnd: null | { reason: 'transcontinental' | 'turn-limit', triggeredBy, triggeredOnTurn },
  modules: {}                    // always empty: this ruleset has no modules
}
```

Nothing is hidden (P2.5): `hiddenDecks` is empty and `determinise` only replaces the game RNG.

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

As the main contract. In this ruleset the forced actions are mostly: a Crew, Miner or Engineer step that cannot be paid (`skipStep`), every Financier step (PART 2: skip only), a special action that cannot be paid or carried out (`skipSpecialAction`), a district choice with one legal answer, a lay step with one way on (`startLay`, `extendPath`, `endLay`), and an arrival building with one legal answer (one kind possible and, for a railway station, one track with a house).

### 4.4 Granularity

A lay is built one route at a time (`extendPath`), so no action lists a whole path (P4.7). An `extendPath` is offered only if the lay can still be finished from where it would stand (`canFinishLay`), so a player never builds into a dead end; nothing is paid, scored or moved until `endLay` (P14.5). A resource of choice is one action per unit. The hats spent and the D5 mode are part of the district choice (`chooseDistrict { district, hats, mode }`).

### 4.5 Stop actions

| Stop action | Where | Rule |
|---|---|---|
| `skipStep` | a step of a board activation (and, PART 2, every Financier step) | P9.3 |
| `skipSpecialAction` | the special action after a Collect | P6.7 |
| `skipBuilding` | the arrival building, ONLY with `arrivalBuilding = optional` | P14.6 |
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
| `specialAction` | `district`, `special` (`telegraphStation`, `districtHouse`, `upgrade`, `railwayStation`) | the district's action (`placeTelegraphStation`, `placeDistrictHouse`, `placeRailwayStation`; PART 2: the upgrade), `skipSpecialAction` | P6.7 |
| `boardActivation` | `foreman`, `steps: [{ type, carriage, slot }]` (carriage 0 = the Foreman), `index`, `cause` | `useStep`, `skipStep` (PART 2: a Financier step adds the Financier action) | P9 |
| `hire` | `remaining`, `taken` | `hireSpecialist`, `stopHiring` (once `taken` is at least 1) | P8 |
| `chooseFreeSpecialist` | | `chooseFreeSpecialist` | P16.5.1 |
| `lay` | `remaining`, `taken`, `path: null \| { train, cities, routes }` | with no path: `startLay`, `stopLaying` (once `taken` is at least 1); with a path: `extendPath`, `endLay` | P14 |
| `placeBuildings` | `city`, `optional`, `cause` (`arrival`) | `placeRailwayStation { city, houseTrack }`, `placeTelegraphStation { city }`; `skipBuilding` only when `optional` | P14.6 |

The frame names of the setup draft are Continental Rails' (`setupRailhead`, `placeRailhead`): P24.1 keeps the draft unchanged and P1.22 lets code keep `railhead`.

**Board activation (P9).** `boardActivation` holds the whole step list, built once: the Foreman M times as the district's type, then for carriages 1, 2, 3 their specialists in space order (PART 2: each carriage's upgrade step goes before its specialists). Each specialist acts once. At a Crew, Miner or Engineer step the frame asks `useStep` (pay 1 Iron / Gunpowder / Wood, gain 1 built Ground / Tunnel / Bridge tile) or `skipStep`; overflow is settled after each step. The frame closes after its last step (`RESUME`).

**The lay (P14).** `lay` gives M lays. `startLay { train }` begins a path at a train (with both trains on one city only the first index is offered: the two would be the same lay). `extendPath { route }` adds a printed route from the path's last city to a city not yet on it: laid routes are travelled, unlaid ones will be laid. `endLay` resolves P14.5 in order: pay the tiles and lay the unlaid routes; the transcontinental check; track VP by scoring city (or the completion VP instead); tolls; the train moves; then, if the player is able (`canPlaceArrivalBuilding`), `placeBuildings` is pushed (P14.6), and a railway station placed there counts towards carriages (P16.5, pushing `chooseFreeSpecialist` with carriage 1). Between lays the frame offers the next `startLay` or `stopLaying`, and closes by itself when the lays are used up or no further lay is possible. The shapes of `layShape` and the rule of `newConnectionRule` are applied by `isLegalLay` and `canFinishLay`.

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

`actionKey` appends an optional parameter only when it is present (`chooseDistrict:D5:0:mode=lay`), so equal actions give equal keys. Continental Rails action types that do not exist here: `chooseStartingSpecialist`, `buyHat`, `addCarriage`, `skipBonusAction`, `installUpgrade` (PART 2 brings the pr2e form), `takeCongressEntry`, `closeCongress` (PART 2: `takeCongressColumn`, `resetSenators`), `chooseBuiltTile`, `chooseOption` (PART 2, for Congress), `claimRoute`, `moveTrain`, and the module actions.

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
| `upgrade` | play | PART 2: 2 VP per upgrade token of the Collect Wood special action | P6.7 |
| `congress` | play | PART 2: K5 and Reset | P10 |
| `carriage3` | play | 2 or 5 VP for a specialist hired into carriage 3 | P8.4 |
| `buildingsEnd` | final | the building table of P20.3 | P20.2.1 |
| `tilesEnd` | final | 1 VP per built tile in storage | P20.2.2 |
| `goals` | final | PART 2: 5 VP to the sole leader of each goal | P20.2.3, P18 |

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

`VARIANTS` holds the 7 variants of P21.1, each with the ruled default; the functions of section 10 of the main contract work unchanged.

| Variant | Values (default first) | Rule | In part 1 |
|---|---|---|---|
| `tycoonMode` | `false`, `true` | P8.5 | played |
| `layShape` | `path`, `one-new-route`, `adjacent-only` | P14.3.4 | played |
| `newConnectionRule` | `any-unlaid-route`, `must-join-unjoined` | P14.3.5 | played |
| `arrivalBuilding` | `compulsory-if-able`, `optional` | P14.6 | played |
| `upgradePlacement` | `first-free`, `any-carriage` | P12.2.4 | accepted; read in PART 2 |
| `hatOverflow` | `resource`, `lost` | P11.1 | accepted; read in PART 2 (Congress K4) |
| `maxTurnsPerPlayer` | 80, integer 0 to 500 (0 = off) | P19.5 | played |

Constants are in `rules.js` by group (`SETUP`, `SUPPLY`, `PLAYER_BOARD`, `HATS`, `GRID`, `ACTIVATION`, `HIRING`, `CONGRESS`, `UPGRADES`, `MAP_RULES`, `SCORING`, and the vocabulary tables), gathered in `RULES`; `P21_2_CONSTANTS` maps each constant name of P21.2 to where it lives. Logic reads them through `getConstants(state)`; `--const.<GROUP>.<name>` overrides them, recorded in the state, exactly as in the main contract.

---

## 13. Events

As the main contract (`action` first, then what it caused). The event types of this ruleset: `action`, `startingProduction`, `railheadPlaced`, `setupComplete`, `turnStart`, `turnEnd`, `workerReturned`, `districtChosen` (`district`, `tile`, `mode`, `multiplier`, `adjacent`, `hats`, `hat`), `gather` (`item`, `production`, `districtHouses`, `multiplier`, `amount`), `gain`, `pay`, `hatLimit`, `discard`, `boardActivation` (`foreman`, `steps`, `cause`), `build` (`terrain`, `specialist`, `carriage`), `hire` (`specialist`, `carriage`, `slot`, `cause`: `hire` or `carriage1`), `carriageAdded` (`carriage`), `districtHousePlaced` (`district`, `site`, `houseTrack`), `buildingPlaced` (`kind`, `city`, `houseTrack` or `vp`, `cause`: `arrival` or `special`), `routeLaid` (`route`, `slots`, `cost`), `toll` (`player` = the owner paid, `by`, `city`, `kind`), `railheadMoved` (`railhead`, `from`, `to`, `cities`, `routes`), `lay` (a summary: `cities`, `routes`, `laid`, `segments`, `trackVp`, `completes`), `completion` (`route`, `routes`, `bonus`), `vp`, `gameEndTriggered`, `gameOver` (adds `winners`).

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
10. **A Financier step** stays in the step list in part 1 and is skipped by the engine; part 2 gives it the Financier action.
11. **Tycoon Mode** (P8.5) is played in part 1: its costs are a table and a payment.
12. **The upgrade tokens** in the supply (P3.1.5) are stored by id with duplicates (`U1-iron` twice at 3 players); identical tokens are interchangeable.

---

## 22. Part 2: where it plugs in

| Rule | Where | Stub now |
|---|---|---|
| P10 Financier action, Congress | `legality.js` `getUseStepBlockReason` and `FRAMES.boardActivation` (a Financier step), `congressTable`, `congressCoinCost`; new actions `takeCongressColumn`, `resetSenators` and the reward decisions | a Financier step offers only `skipStep`; `congressTable` is `[]` |
| P11.3 hats from K4, `hatOverflow` | `actions.js` `gainHats` (displacement already uses it) | not reached |
| P12 upgrades | `FRAMES.specialAction` (the Collect Wood action), `pushBoardActivation` (the upgrade step), `upgradeTileData` / `installedUpgrades` / `upgradeTileAt`, `UPGRADES.yield`, `upgradePlacement` | Collect Wood's special action offers only skip; no upgrade step |
| P18 goals | `scoring.js` `goalsInPlay` / `goalStandings`, `conditions.js` `METRICS`, `state.goals` (revealed at setup, P3.1.7) | `goalsInPlay` is `[]`; `goals` scores 0 |

Bots: until a pr2e bot is written, Easy, Medium, Hard and Expert use the temporary stand-in policy of `src/rulesets/pr2e.js` (a random choice among the non-stop actions).
