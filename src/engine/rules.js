// rules.js - every constant and data table of Continental Rails. DATA ONLY.
//
// Source of truth: rules spec v2 (rule numbers such as R8.6 are cited beside
// each table). No logic lives here.
//
// Why everything is an exported OBJECT and never a bare number: a simulator
// must be able to change a tuning value at run time and have every reader see
// it. `export const PRICE = 3` is bound at import time and cannot be patched;
// `export const SCORING = { vpPerSlot: 1 }` can.
//
// Logic files never read these objects directly. They call
// `getConstants(state)` (state.js), which returns `RULES` below or, when the
// game was created with `config.constants`, a merged copy. That is what makes
// a saved state replay identically (docs/engine-contract.md, "Constants").
//
// Identifiers follow the terminology rule: `house` only for the player-board
// production multiplier; `railwayStation` and `telegraphStation` for map
// buildings; `district` for action-grid locations. Resource ids are `iron`,
// `wood`, `gunpowder`; the currency is `coins`; cowboy hats are `hats`.
// BUILT tiles (in storage, R1.13) and LAID tiles (on the map, R1.14) are
// different things everywhere in this code base.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** R1.8. Coins are a currency, not a resource. */
export const RESOURCES = ['iron', 'wood', 'gunpowder'];

/** R1.12, R1.19. Terrain of a route slot and type of a track tile. */
export const TERRAINS = ['ground', 'tunnel', 'bridge'];

/** Letters used by the map data file (Appendix A). */
export const TERRAIN_BY_LETTER = { G: 'ground', T: 'tunnel', B: 'bridge' };

/** R8.5.2. Everything that takes one unit of storage: resources, then built tiles. */
export const STORAGE_ITEMS = ['iron', 'wood', 'gunpowder', 'ground', 'tunnel', 'bridge'];

/** R1.16. */
export const SPECIALIST_TYPES = ['crew', 'miner', 'engineer', 'financier'];

/** R1.4. Buildings exist only on the map. */
export const BUILDING_KINDS = ['railwayStation', 'telegraphStation'];

/** Player-facing names. British English. */
export const NAMES = {
  iron: 'Iron',
  wood: 'Wood',
  gunpowder: 'Gunpowder',
  coins: 'Coins',
  hats: 'cowboy hats',
  ground: 'Ground',
  tunnel: 'Tunnel',
  bridge: 'Bridge',
  crew: 'Crew',
  miner: 'Miner',
  engineer: 'Engineer',
  financier: 'Financier',
  railwayStation: 'railway station',
  telegraphStation: 'telegraph station',
  specialist: 'specialist carriage',
  storage: 'storage carriage',
};

// ---------------------------------------------------------------------------
// Setup (R3)
// ---------------------------------------------------------------------------

export const SETUP = {
  minPlayers: 2,
  maxPlayers: 4,
  /** R3.3. Always 12 workers in play, equal to the 12 worker spaces. */
  workersByPlayerCount: { 2: 6, 3: 4, 4: 3 },
  /** R3.3. In storage at the start. */
  startingResources: { iron: 1, wood: 1, gunpowder: 1 },
  /** R3.3. */
  startingCoins: 1,
  /** R3.3. */
  startingHats: 0,
  /** R3.3, R8.1. */
  startingSpecialistCarriages: 1,
  startingStorageCarriages: 1,
  /** R3.6. One specialist of the player's choice, free. */
  freeStartingSpecialists: 1,
  /** R3.7, variant `startCompensation = graduated`. Index = seat - 1. */
  graduatedCompensation: [0, 1, 1, 2],
};

// ---------------------------------------------------------------------------
// The player board (R2.2, R2.3, R6.2, R13.3)
// ---------------------------------------------------------------------------

export const PLAYER_BOARD = {
  /** R2.3.1. Order of the four house tracks, named for what they produce. */
  houseTracks: ['wood', 'coins', 'iron', 'gunpowder'],
  /** R2.3.1. Slots printed 2, 3, 4 on each track. */
  houseSlotsPerTrack: 3,
  /** R2.2. 11 houses on 12 slots: one "2" slot starts empty (R3.4). */
  houses: 11,
  /** R6.2. Production with every house slot covered. */
  baseProduction: 1,
  /** R2.2, R13.3. Printed VP of the telegraph row, left to right. */
  telegraphRowVp: [1, 2, 3, 4, 5, 6, 9],
  /** R2.2. */
  telegraphStations: 7,
  /** R2.2. */
  railheads: 2,
};

// ---------------------------------------------------------------------------
// Cowboy hats (R14)
// ---------------------------------------------------------------------------

export const HATS = {
  /** R14.1. Holding limit; a hat gained at the limit becomes 1 resource of choice. */
  hatLimit: 2,
  /** R14.2. Most hats spent in one turn. */
  hatsPerTurn: 1,
  /** R5.6.1. What one spent hat adds to M. */
  multiplierPerHat: 1,
  /** R5.5.3. Hats owed to the owner of each displaced worker. */
  displacementHatsPerWorker: 1,
  /** R14.1. Resources of choice taken in place of one hat at the limit. */
  resourcesPerHatAtLimit: 1,
};

// ---------------------------------------------------------------------------
// The action grid (R5)
// ---------------------------------------------------------------------------

export const GRID = {
  /** R5.1. The nine POSITIONS of the 3 x 3 grid. Rows from the top, columns from the left. */
  positions: [
    { id: 'D1', row: 1, col: 1 },
    { id: 'D2', row: 1, col: 2 },
    { id: 'D3', row: 1, col: 3 },
    { id: 'D4', row: 2, col: 1 },
    { id: 'D5', row: 2, col: 2 },
    { id: 'D6', row: 2, col: 3 },
    { id: 'D7', row: 3, col: 1 },
    { id: 'D8', row: 3, col: 2 },
    { id: 'D9', row: 3, col: 3 },
  ],
  /** R5.1. Which district tile lies on which position with `gridLayout = fixed`. */
  defaultTiles: {
    D1: 'gather-gunpowder',
    D2: 'lobby-congress',
    D3: 'gather-iron',
    D4: 'ground-tracks',
    D5: 'lay-tracks',
    D6: 'bridge-tracks',
    D7: 'gather-wood',
    D8: 'tunnel-tracks',
    D9: 'gather-coins',
  },
  /**
   * R5.1. The nine district tiles. `family` is what the action does:
   *   gather          - R6; `gathers` names the resource (or `coins`);
   *                     `bonusAction` names the printed bonus action (R7).
   *   trainActivation - R9; `foremanType` is what the Foreman acts as (R9.2).
   *   layTracks       - R11 and R12.
   */
  districtTiles: {
    'gather-gunpowder': { name: 'Gather Gunpowder', family: 'gather', gathers: 'gunpowder', bonusAction: 'upgrade' },
    'lobby-congress': { name: 'Lobby Congress', family: 'trainActivation', foremanType: 'financier' },
    'gather-iron': { name: 'Gather Iron', family: 'gather', gathers: 'iron', bonusAction: 'hire' },
    'ground-tracks': { name: 'Ground Tracks', family: 'trainActivation', foremanType: 'crew' },
    'lay-tracks': { name: 'Lay Tracks / Move Train', family: 'layTracks' },
    'bridge-tracks': { name: 'Bridge Tracks', family: 'trainActivation', foremanType: 'engineer' },
    'gather-wood': { name: 'Gather Wood', family: 'gather', gathers: 'wood', bonusAction: 'hat' },
    'tunnel-tracks': { name: 'Tunnel Tracks', family: 'trainActivation', foremanType: 'miner' },
    'gather-coins': { name: 'Gather Coins', family: 'gather', gathers: 'coins', bonusAction: 'carriage' },
  },
  /** R5.2. The 12 worker spaces, each on the border between two districts. */
  workerSpaces: [
    { id: 'W1', between: ['D1', 'D2'] },
    { id: 'W2', between: ['D2', 'D3'] },
    { id: 'W3', between: ['D1', 'D4'] },
    { id: 'W4', between: ['D2', 'D5'] },
    { id: 'W5', between: ['D3', 'D6'] },
    { id: 'W6', between: ['D4', 'D5'] },
    { id: 'W7', between: ['D5', 'D6'] },
    { id: 'W8', between: ['D4', 'D7'] },
    { id: 'W9', between: ['D5', 'D8'] },
    { id: 'W10', between: ['D6', 'D9'] },
    { id: 'W11', between: ['D7', 'D8'] },
    { id: 'W12', between: ['D8', 'D9'] },
  ],
  /** R5.2. Each worker space and each district centre holds at most this many workers. */
  workersPerSpace: 1,
  workersPerCentre: 1,
  /** R5.6.1. The worker used this turn. */
  baseMultiplier: 1,
  /** R5.8, variant `gridLayout = shuffle-resources`: the positions whose tiles are shuffled. */
  shufflePositions: ['D1', 'D3', 'D7'],
};

// ---------------------------------------------------------------------------
// The four bonus actions (R7)
// ---------------------------------------------------------------------------

export const BONUS_ACTIONS = {
  /** R7.3. Needs the carriage upgrades module. */
  upgrade: { name: 'Carriage Upgrade', cost: { iron: 1 }, rule: 'R7.3', module: 'upgrades' },
  /** R7.4. The 1 Coin is the FEE; by default it is all a hire costs (variant `hireCostModel`, R8.6.3). */
  hire: { name: 'Hire Specialist', cost: { coins: 1 }, rule: 'R7.4', module: null },
  /** R7.5. */
  hat: { name: 'Buy Hat', cost: { gunpowder: 1 }, rule: 'R7.5', module: null },
  /** R7.6. */
  carriage: { name: 'Add Carriage', cost: { wood: 1 }, rule: 'R7.6', module: null },
};

// ---------------------------------------------------------------------------
// The train (R8, R9)
// ---------------------------------------------------------------------------

export const TRAIN = {
  /** R8.5.1. */
  storagePerCarriage: 9,
  /** R8.2.1, R8.3. Including the starting one of each. */
  maxSpecialistCarriages: 3,
  maxStorageCarriages: 3,
  /** R8.2.2. */
  specialistSlotsPerCarriage: 2,
  upgradeSlotsPerCarriage: 1,
  /** R2.1. Limited supply: a type that has run out cannot be hired. */
  specialistsPerType: 12,
  /**
   * R8.6.3. Hire cost by specialist type; index = carriage level - 1.
   * Paid only with `hireCostModel` fee-plus-table or table-only; the default fee-only has no hire cost.
   * Read by eye from the 2018 rulebook images (spec R24 item 1).
   */
  hireCosts: {
    crew: [{ iron: 1, gunpowder: 1 }, { iron: 2, gunpowder: 1 }, { iron: 2, gunpowder: 2 }],
    miner: [{ gunpowder: 1, wood: 1 }, { gunpowder: 2, wood: 1 }, { gunpowder: 2, wood: 2 }],
    engineer: [{ wood: 1, coins: 1 }, { wood: 2, coins: 1 }, { wood: 2, coins: 2 }],
    financier: [{ coins: 1, iron: 1 }, { coins: 2, iron: 1 }, { coins: 2, iron: 2 }],
  },
  /**
   * R8.8. What one activation of a specialist costs and makes, by the
   * `conversionRate` variant. `output` is a BUILT tile type, or `lobbyPoint`.
   */
  recipes: {
    '1:1': {
      crew: { cost: { iron: 1 }, output: 'ground' },
      miner: { cost: { gunpowder: 1 }, output: 'tunnel' },
      engineer: { cost: { wood: 1 }, output: 'bridge' },
      financier: { cost: {}, output: 'lobbyPoint' },
    },
    '2:1': {
      crew: { cost: { iron: 2 }, output: 'ground' },
      miner: { cost: { gunpowder: 2 }, output: 'tunnel' },
      engineer: { cost: { wood: 2 }, output: 'bridge' },
      financier: { cost: {}, output: 'lobbyPoint' },
    },
    'iron-in-all': {
      crew: { cost: { iron: 2 }, output: 'ground' },
      miner: { cost: { gunpowder: 1, iron: 1 }, output: 'tunnel' },
      engineer: { cost: { wood: 1, iron: 1 }, output: 'bridge' },
      financier: { cost: {}, output: 'lobbyPoint' },
    },
  },
  /** R8.8. Tiles made by one use of a Crew, Miner or Engineer. */
  tilesPerUse: 1,
  /** R9.3. Activations of a specialist; index = carriage level - 1. Used only by variant `specialistActivations = by-level`; the default `once` uses index 0. */
  activationsByLevel: [1, 2, 3],
  /** R9.3. Foreman activations when a card starts the train activation. */
  cardActivationMultiplier: 1,
};

// ---------------------------------------------------------------------------
// Lobby Congress (R10)
// ---------------------------------------------------------------------------
//
// Each entry: id, tier (lobby points to spend, R10.4.1), coinCost (R10.4.2),
// text, and `effects` in the effect encoding described at the foot of this
// file. `reset: true` marks the Reset entry, which has no senator (R10.2).
// A table needs one senator per non-Reset entry.

export const CONGRESS = {
  /** R10.3. */
  lobbyPointsPerFinancierStep: 1,
  /** R10.6. */
  resetVpPerSenator: 1,
  tables: {
    /** R10.1, the default: the newest art and DESIGN.md agree. */
    'design-2026-10': [
      { id: 'C1', tier: 1, coinCost: 1, text: 'Gain 2 Wood', effects: [{ type: 'gain', items: { wood: 2 } }] },
      { id: 'C2', tier: 1, coinCost: 1, text: 'Gain 2 Iron', effects: [{ type: 'gain', items: { iron: 2 } }] },
      {
        id: 'C3',
        tier: 2,
        coinCost: 2,
        text: 'Gain 2 Gunpowder and 1 cowboy hat',
        effects: [{ type: 'gain', items: { gunpowder: 2, hats: 1 } }],
      },
      {
        id: 'C4',
        tier: 2,
        coinCost: 2,
        text: 'Add 1 carriage, specialist or storage, for free',
        effects: [{ type: 'addCarriage', carriage: 'choice' }],
      },
      {
        id: 'C5',
        tier: 3,
        coinCost: 3,
        text: 'Gain 2 built track tiles, any types, same or different',
        effects: [{ type: 'gainBuiltTilesChoice', count: 2, distinct: false }],
      },
      {
        id: 'C6',
        tier: 3,
        coinCost: 3,
        text: 'Place up to 1 railway station and up to 1 telegraph station, or gain 3 VP',
        effects: [
          {
            type: 'chooseOne',
            options: [
              [{ type: 'placeBuildings', railwayStation: 1, telegraphStation: 1, where: 'connectedInlandCity' }],
              [{ type: 'vp', amount: 3 }],
            ],
          },
        ],
      },
      {
        id: 'CR',
        tier: 1,
        coinCost: 1,
        reset: true,
        text: 'Reset: return all used senators and gain 1 VP for each',
        effects: [{ type: 'resetSenators' }],
      },
    ],
    /**
     * R10.1, variant `congressTable = jan-2026`. Seven entries plus Reset.
     * The spec gives this table no entry ids; J1 to J7 are this code's own.
     */
    'jan-2026': [
      { id: 'J1', tier: 1, coinCost: 1, text: 'Gain 1 Wood', effects: [{ type: 'gain', items: { wood: 1 } }] },
      { id: 'J2', tier: 1, coinCost: 1, text: 'Gain 2 Iron', effects: [{ type: 'gain', items: { iron: 2 } }] },
      { id: 'J3', tier: 1, coinCost: 1, text: 'Gain 2 cowboy hats', effects: [{ type: 'gain', items: { hats: 2 } }] },
      {
        id: 'J4',
        tier: 2,
        coinCost: 2,
        text: 'Gain 4 resources of your choice',
        effects: [{ type: 'gainChoice', count: 4 }],
      },
      {
        id: 'J5',
        tier: 2,
        coinCost: 2,
        text: 'Gain 2 built track tiles of your choice',
        effects: [{ type: 'gainBuiltTilesChoice', count: 2, distinct: false }],
      },
      {
        id: 'J6',
        tier: 3,
        coinCost: 3,
        text: 'Gain 6 resources of your choice',
        effects: [{ type: 'gainChoice', count: 6 }],
      },
      {
        id: 'J7',
        tier: 3,
        coinCost: 3,
        text: 'Gain 3 built track tiles of your choice',
        effects: [{ type: 'gainBuiltTilesChoice', count: 3, distinct: false }],
      },
      {
        id: 'CR',
        tier: 1,
        coinCost: 1,
        reset: true,
        text: 'Reset: return all used senators and gain 1 VP for each',
        effects: [{ type: 'resetSenators' }],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// The map: claims, moves, buildings (R11, R12, R13, R16.6)
// ---------------------------------------------------------------------------

export const MAP_RULES = {
  /** R12.4, R13.5. Paid building after a Move Train step. */
  moveBuildCost: { coins: 2 },
  /** R11.11.5. Station step, `claimFrom = network` only. */
  stationStepCost: { coins: 2 },
  /** R13.1. Room in each inland city. */
  buildingsPerInlandCity: { railwayStation: 1, telegraphStation: 1 },
  /** R16.6.1. An inland city with at least this many printed routes is a junction city. */
  junctionMinRoutes: 5,
  /** R16.6.2. North region: inland cities with map y below this (mm). */
  northRegionMaxY: 140,
  /** R16.6.2. South region: inland cities with map y above this (mm). */
  southRegionMinY: 250,
};

// ---------------------------------------------------------------------------
// Scoring (R11.5, R13.9, R16.3, R19.2, R20)
// ---------------------------------------------------------------------------

export const SCORING = {
  /** R11.5.2. */
  vpPerSlot: 1,
  /** R11.9. Extra VP per slot of the scoring card's terrain (3 in all with vpPerSlot). */
  scoringCardVpPerSlot: 2,
  /** R11.5.4. */
  firstConnectionVp: 5,
  /** R13.9. */
  tollVp: 3,
  /** R19.2. */
  completionVp: 25,
  completionVpPerSlot: 3,
  /** R16.3. First place, second place. Third and fourth score nothing. */
  goalVp: [10, 5],
  /** R16.4.4. In a 2-player game only this many places are awarded (first place). */
  goalPlacesTwoPlayers: 1,
  /** R18.10. */
  ponyTokenEndVp: 1,
  /**
   * R20.3. VP for the number of buildings a player has on the map; index =
   * number of buildings, 0 to 18. Variant `buildingScoreCurve`.
   */
  buildingTable: {
    rising: [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 70, 79, 88, 98, 108],
    2018: [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87],
  },
};

/**
 * R20.1 and R20.2. The VP sources, in the order the rules list them.
 * `when`: scored during `play`, or added in `final` scoring.
 * `module`: the module that must be on for the source to exist, or null.
 * A source whose module is off has no key in `player.vp` at all.
 */
export const VP_SOURCES = [
  { id: 'track', when: 'play', module: null, name: 'Track laid', rule: 'R11.5.2, R11.9' },
  { id: 'firstConnection', when: 'play', module: null, name: 'First connections', rule: 'R11.5.4' },
  { id: 'completion', when: 'play', module: null, name: 'Transcontinental line', rule: 'R19.2' },
  { id: 'telegraph', when: 'play', module: null, name: 'Telegraph row', rule: 'R13.3' },
  { id: 'toll', when: 'play', module: null, name: 'Tolls', rule: 'R13.9' },
  { id: 'congress', when: 'play', module: null, name: 'Congress', rule: 'R10' },
  { id: 'upgrades', when: 'play', module: 'upgrades', name: 'Carriage upgrades', rule: 'R15' },
  { id: 'milestones', when: 'play', module: 'milestones', name: 'Milestones', rule: 'R16.8' },
  { id: 'legislative', when: 'play', module: 'legislative', name: 'Legislative Agenda', rule: 'R17' },
  { id: 'ponyCards', when: 'play', module: 'pony', name: 'Pony Express cards', rule: 'R18' },
  { id: 'buildingsEnd', when: 'final', module: null, name: 'Buildings on the map', rule: 'R20.2.1' },
  { id: 'goals', when: 'final', module: 'goals', name: 'End-game goals', rule: 'R20.2.2' },
  { id: 'ponyEnd', when: 'final', module: 'pony', name: 'Pony Express tokens and endgame cards', rule: 'R20.2.3' },
];

/** R19.8. */
export const END_REASONS = ['transcontinental', 'routes-claimed', 'turn-limit'];

// ---------------------------------------------------------------------------
// Module: carriage upgrades (R15.2)
// ---------------------------------------------------------------------------
//
// One copy of each. `effects` happen each time the tile's step is reached in
// a train activation (R9.4, R15.5); `vpPerBuilt` is worked out at the end of
// the activation (R15.5.2). `vpTile: true` marks the three tiles affected by
// the variant `upgradeVpTiming` (R15.6).

export const UPGRADE_TILES = [
  { id: 'U1-vp', level: 1, name: 'Engine Power', text: 'Gain 2 VP', vpTile: true, effects: [{ type: 'vp', amount: 2 }] },
  { id: 'U1-wood', level: 1, name: 'Wood Supply', text: 'Gain 1 Wood', effects: [{ type: 'gain', items: { wood: 1 } }] },
  { id: 'U1-iron', level: 1, name: 'Iron Supply', text: 'Gain 1 Iron', effects: [{ type: 'gain', items: { iron: 1 } }] },
  { id: 'U1-coin', level: 1, name: 'Coin Supply', text: 'Gain 1 Coin', effects: [{ type: 'gain', items: { coins: 1 } }] },
  {
    id: 'U1-gunpowder',
    level: 1,
    name: 'Gunpowder Supply',
    text: 'Gain 1 Gunpowder',
    effects: [{ type: 'gain', items: { gunpowder: 1 } }],
  },
  { id: 'U1-hat', level: 1, name: 'Action Token', text: 'Gain 1 cowboy hat', effects: [{ type: 'gain', items: { hats: 1 } }] },
  { id: 'U2-vp', level: 2, name: 'Advanced Engine', text: 'Gain 3 VP', vpTile: true, effects: [{ type: 'vp', amount: 3 }] },
  {
    id: 'U2-bridge',
    level: 2,
    name: 'Bridge Specialist',
    text: 'Gain 1 VP for each Bridge tile built in this activation',
    effects: [{ type: 'vpPerBuilt', terrain: 'bridge', amount: 1 }],
  },
  {
    id: 'U2-tunnel',
    level: 2,
    name: 'Tunnel Specialist',
    text: 'Gain 1 VP for each Tunnel tile built in this activation',
    effects: [{ type: 'vpPerBuilt', terrain: 'tunnel', amount: 1 }],
  },
  {
    id: 'U2-ground',
    level: 2,
    name: 'Ground Specialist',
    text: 'Gain 1 VP for each Ground tile built in this activation',
    effects: [{ type: 'vpPerBuilt', terrain: 'ground', amount: 1 }],
  },
  { id: 'U2-hat', level: 2, name: 'Efficiency Boost', text: 'Gain 1 cowboy hat', effects: [{ type: 'gain', items: { hats: 1 } }] },
  {
    id: 'U3-vp',
    level: 3,
    name: 'Transcontinental Engine',
    text: 'Gain 4 VP',
    vpTile: true,
    effects: [{ type: 'vp', amount: 4 }],
  },
  {
    id: 'U3-bridge',
    level: 3,
    name: 'Bridge Production',
    text: 'Gain 1 built Bridge tile',
    effects: [{ type: 'gainBuiltTile', terrain: 'bridge', count: 1 }],
  },
  {
    id: 'U3-tunnel',
    level: 3,
    name: 'Tunnel Production',
    text: 'Gain 1 built Tunnel tile',
    effects: [{ type: 'gainBuiltTile', terrain: 'tunnel', count: 1 }],
  },
  {
    id: 'U3-ground',
    level: 3,
    name: 'Ground Production',
    text: 'Gain 1 built Ground tile',
    effects: [{ type: 'gainBuiltTile', terrain: 'ground', count: 1 }],
  },
  { id: 'U3-hat', level: 3, name: 'Supreme Action', text: 'Gain 1 cowboy hat', effects: [{ type: 'gain', items: { hats: 1 } }] },
];

// ---------------------------------------------------------------------------
// Module: end-game goals (R16.5)
// ---------------------------------------------------------------------------
//
// Each goal ranks the players by `metric` (a name known to conditions.js);
// `direction` says whether the most or the fewest ranks first.
// `requiresModule` removes the goal from the deck when that module is off
// (R3.8.2: goal 6).

export const GOAL_CARDS = [
  {
    id: 'G1',
    number: 1,
    name: 'Most Railway Stations',
    metric: 'railwayStations',
    direction: 'most',
    text: 'Number of your railway stations on the map',
    requiresModule: null,
  },
  {
    id: 'G2',
    number: 2,
    name: 'Continental Span',
    metric: 'minNorthSouthBuildings',
    direction: 'most',
    text: 'The smaller of your buildings in North region cities and your buildings in South region cities',
    requiresModule: null,
  },
  {
    id: 'G3',
    number: 3,
    name: 'Strategic Positions',
    metric: 'buildingsInJunctionCities',
    direction: 'most',
    text: 'Number of your buildings in junction cities',
    requiresModule: null,
  },
  {
    id: 'G4',
    number: 4,
    name: 'Specialist Focus',
    metric: 'maxSpecialistsOneType',
    direction: 'most',
    text: 'The largest number of specialists of one type in your train',
    requiresModule: null,
  },
  {
    id: 'G5',
    number: 5,
    name: 'Longest Train',
    metric: 'carriages',
    direction: 'most',
    text: 'Number of carriages in your train, both kinds',
    requiresModule: null,
  },
  {
    id: 'G6',
    number: 6,
    name: 'Upgrade Mastery',
    metric: 'upgradesInstalled',
    direction: 'most',
    text: 'Number of upgrade tiles installed in your train',
    requiresModule: 'upgrades',
  },
  {
    id: 'G7',
    number: 7,
    name: 'Diversified Company',
    metric: 'completeSpecialistSets',
    direction: 'most',
    text: 'The smallest of your counts of Crew, Miner, Engineer and Financier',
    requiresModule: null,
  },
  {
    id: 'G8',
    number: 8,
    name: 'Specialist Army',
    metric: 'specialists',
    direction: 'most',
    text: 'Number of specialists in your train (the Foreman is not counted)',
    requiresModule: null,
  },
  {
    id: 'G9',
    number: 9,
    name: 'Opportunistic Builder',
    metric: 'telegraphsWithOpponentRailway',
    direction: 'most',
    text: 'Number of your telegraph stations in cities whose railway station belongs to another player',
    requiresModule: null,
  },
  {
    id: 'G10',
    number: 10,
    name: 'Economic Efficiency',
    metric: 'cargo',
    direction: 'fewest',
    text: 'Iron + Wood + Gunpowder + built track tiles in your storage (fewest wins)',
    requiresModule: null,
  },
  {
    id: 'G11',
    number: 11,
    name: 'Most Telegraph Stations',
    metric: 'telegraphStations',
    direction: 'most',
    text: 'Number of your telegraph stations on the map',
    requiresModule: null,
  },
  {
    id: 'G12',
    number: 12,
    name: 'City Presence',
    metric: 'citiesWithOwnBuilding',
    direction: 'most',
    text: 'Number of inland cities holding at least one of your buildings',
    requiresModule: null,
  },
];

// ---------------------------------------------------------------------------
// Module: milestones (R16.8)
// ---------------------------------------------------------------------------
//
// `condition` is a flat declarative record `{ metric, op, value, filter? }`
// evaluated for the claiming player by conditions.js. A yes/no metric counts
// as 1 or 0. Every condition, once true, stays true (R16.9).

export const MILESTONE_TILES = [
  {
    id: 'MS1',
    name: 'Rail Baron',
    vp: 6,
    text: 'Has 5 or more buildings on the map',
    condition: { metric: 'buildings', op: '>=', value: 5 },
  },
  {
    id: 'MS2',
    name: 'Mountain Conqueror',
    vp: 6,
    text: 'Owns routes containing 6 or more Tunnel slots in total',
    condition: { metric: 'ownSlots', filter: { terrain: 'tunnel' }, op: '>=', value: 6 },
  },
  {
    id: 'MS3',
    name: 'River Crosser',
    vp: 6,
    text: 'Owns routes containing 6 or more Bridge slots in total',
    condition: { metric: 'ownSlots', filter: { terrain: 'bridge' }, op: '>=', value: 6 },
  },
  {
    id: 'MS4',
    name: 'Plainsman',
    vp: 6,
    text: 'Owns routes containing 6 or more Ground slots in total',
    condition: { metric: 'ownSlots', filter: { terrain: 'ground' }, op: '>=', value: 6 },
  },
  {
    id: 'MS5',
    name: 'Long Haul',
    vp: 5,
    text: 'Owns a route of 5 or more slots',
    condition: { metric: 'longestOwnRoute', op: '>=', value: 5 },
  },
  {
    id: 'MS6',
    name: 'Network Complete',
    vp: 7,
    text: 'Owns 6 or more routes',
    condition: { metric: 'ownRoutes', op: '>=', value: 6 },
  },
  {
    id: 'MS7',
    name: 'Continental Reach',
    vp: 7,
    text: 'The two cities where your railheads started are joined by a chain of claimed routes, of any owners',
    condition: { metric: 'startCitiesJoined', filter: { owner: 'any' }, op: '>=', value: 1 },
  },
  {
    id: 'MS8',
    name: 'Full Crew',
    vp: 6,
    text: 'Has at least one Crew, one Miner, one Engineer and one Financier in their train',
    condition: { metric: 'completeSpecialistSets', op: '>=', value: 1 },
  },
  {
    id: 'MS9',
    name: 'Iron Horse',
    vp: 5,
    text: 'Has 5 or more carriages in their train, both kinds',
    condition: { metric: 'carriages', op: '>=', value: 5 },
  },
  {
    id: 'MS10',
    name: 'Telegraph Pioneer',
    vp: 6,
    text: 'Has 4 or more telegraph stations on the map',
    condition: { metric: 'telegraphStations', op: '>=', value: 4 },
  },
];

// ---------------------------------------------------------------------------
// Module: Legislative Agenda (R17.3)
// ---------------------------------------------------------------------------
//
// One card is in force for the whole game and applies to every player.
// Every VP a card adds is booked to the VP source `legislative` (R20.1).
// Cards 1 to 3 (+1 VP per slot of one terrain) were retired in spec v4: the
// scoring card (R11.9) does their job. The rest keep their numbers (R17.2).

export const LEGISLATIVE_CARDS = [
  {
    id: 'LA4',
    number: 4,
    name: 'Transcontinental Priority',
    text: 'The completion bonus is 10 VP higher: 35 VP + 3 per slot',
    effects: [{ type: 'trigger', on: 'completeTranscontinental', effect: { type: 'vp', amount: 10 } }],
  },
  {
    id: 'LA5',
    number: 5,
    name: 'Infrastructure Diversity',
    text: 'When the slots you laid in one Lay Tracks action include at least 2 different terrains, gain 3 VP',
    effects: [
      {
        type: 'trigger',
        on: 'layTracksActionEnd',
        condition: { metric: 'distinctTerrainsLaid', op: '>=', value: 2 },
        effect: { type: 'vp', amount: 3 },
      },
    ],
  },
  {
    id: 'LA6',
    number: 6,
    name: 'Rapid Construction Bonus',
    text: 'When you laid 5 or more slots in one Lay Tracks action, gain 5 VP',
    effects: [
      {
        type: 'trigger',
        on: 'layTracksActionEnd',
        condition: { metric: 'slotsLaid', op: '>=', value: 5 },
        effect: { type: 'vp', amount: 5 },
      },
    ],
  },
  {
    id: 'LA7',
    number: 7,
    name: 'Station Network',
    text: "When you place a building in a city that already holds another player's building, gain 5 VP",
    effects: [
      {
        type: 'trigger',
        on: 'placeBuilding',
        condition: { metric: 'cityHasOpponentBuilding', op: '>=', value: 1 },
        effect: { type: 'vp', amount: 5 },
      },
    ],
  },
  {
    id: 'LA8',
    number: 8,
    name: 'Urban Development',
    text: 'When you place a building in a junction city, gain 2 VP',
    effects: [
      {
        type: 'trigger',
        on: 'placeBuilding',
        condition: { metric: 'cityIsJunction', op: '>=', value: 1 },
        effect: { type: 'vp', amount: 2 },
      },
    ],
  },
  {
    id: 'LA9',
    number: 9,
    name: 'Strategic Outposts',
    text: 'A first connection scores +3 VP (8 instead of 5)',
    effects: [{ type: 'trigger', on: 'firstConnection', effect: { type: 'vp', amount: 3 } }],
  },
  {
    id: 'LA10',
    number: 10,
    name: 'Expansion Leader',
    text: 'The first player to have 5 buildings on the map gains 10 VP at once. Once per game',
    effects: [
      {
        type: 'trigger',
        on: 'placeBuilding',
        condition: { metric: 'ownBuildings', op: '==', value: 5 },
        effect: { type: 'vp', amount: 10 },
        limit: 'oncePerGame',
      },
    ],
  },
  {
    id: 'LA11',
    number: 11,
    name: 'Iron Subsidy',
    text: 'Each Gather Iron action gives +1 Iron',
    effects: [{ type: 'trigger', on: 'gather', where: { resource: 'iron' }, effect: { type: 'gain', items: { iron: 1 } } }],
  },
  {
    id: 'LA12',
    number: 12,
    name: 'Lumber Grant',
    text: 'Each Gather Wood action gives +1 Wood',
    effects: [{ type: 'trigger', on: 'gather', where: { resource: 'wood' }, effect: { type: 'gain', items: { wood: 1 } } }],
  },
  {
    id: 'LA13',
    number: 13,
    name: 'Mining Incentives',
    text: 'Each Gather Gunpowder action gives +1 Gunpowder',
    effects: [
      { type: 'trigger', on: 'gather', where: { resource: 'gunpowder' }, effect: { type: 'gain', items: { gunpowder: 1 } } },
    ],
  },
  {
    id: 'LA14',
    number: 14,
    name: 'Federal Treasury',
    text: 'Each Gather Coins action gives +1 Coin',
    effects: [{ type: 'trigger', on: 'gather', where: { resource: 'coins' }, effect: { type: 'gain', items: { coins: 1 } } }],
  },
  {
    id: 'LA15',
    number: 15,
    name: 'Telegraph Expansion Act',
    text: 'When you place a telegraph station, gain 3 VP as well as the VP from the telegraph row',
    effects: [{ type: 'trigger', on: 'placeBuilding', where: { kind: 'telegraphStation' }, effect: { type: 'vp', amount: 3 } }],
  },
  {
    id: 'LA16',
    number: 16,
    name: 'Railway Network Bonus',
    text: 'When you place a railway station, gain 3 VP',
    effects: [{ type: 'trigger', on: 'placeBuilding', where: { kind: 'railwayStation' }, effect: { type: 'vp', amount: 3 } }],
  },
  {
    id: 'LA17',
    number: 17,
    name: 'Production Scaling',
    text: 'When you place a railway station (which removes a house from your player board), gain 2 resources of your choice',
    effects: [
      { type: 'trigger', on: 'placeBuilding', where: { kind: 'railwayStation' }, effect: { type: 'gainChoice', count: 2 } },
    ],
  },
  {
    id: 'LA18',
    number: 18,
    name: 'Specialist Recruitment Drive',
    text: 'When you hire a specialist with the Hire Specialist bonus action, gain 1 resource of your choice',
    effects: [{ type: 'trigger', on: 'hire', where: { via: 'bonusAction' }, effect: { type: 'gainChoice', count: 1 } }],
  },
  {
    id: 'LA19',
    number: 19,
    name: 'Industrial Expansion',
    text: 'When you add a carriage with the Add Carriage bonus action, gain 2 resources of your choice',
    effects: [{ type: 'trigger', on: 'addCarriage', where: { via: 'bonusAction' }, effect: { type: 'gainChoice', count: 2 } }],
  },
  {
    id: 'LA20',
    number: 20,
    name: 'Congressional Support',
    text: 'Once per train activation, right after you take a Congress entry, you may take one other available entry of the same tier without spending lobby points or Coins',
    effects: [
      {
        type: 'trigger',
        on: 'congressEntryTaken',
        effect: { type: 'freeCongressSameTier', count: 1 },
        limit: 'oncePerActivation',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Module: Pony Express (R18)
// ---------------------------------------------------------------------------

export const PONY = {
  /** R18.5.2. Token cost by rank. */
  costs: { A: 2, B: 3, C: 5 },
  /** R18.2. Face-up cards per rank; the market holds 3 x this. */
  marketPerRank: 2,
  /** R18.4. Resources of choice for one returned token. */
  resourcesPerToken: 1,
  /** R18.5. Purchases per turn across both free-action opportunities. */
  purchasesPerTurn: 1,
  ranks: ['A', 'B', 'C'],
};

// R18.7. `kind`: immediate (resolve, then discard), ongoing (kept; counts
// towards `ponyOngoingCap`), endgame (kept; scores in final scoring).
// `removedWhen` names a variant value that takes the card out of its deck.
// Every VP a card adds is booked to `ponyCards` (during play) or `ponyEnd`.
//
// Cards 8/23, 10/22 and 13/24 share a name and an effect at different ranks.

const VERSATILE_RIDER = [
  {
    type: 'chooseOne',
    options: [
      [{ type: 'gainBuiltTilesChoice', count: 2, distinct: false }],
      [{ type: 'gainChoice', count: 3 }],
      [{ type: 'gain', items: { hats: 1 } }],
    ],
  },
];
const DOUBLE_TIME = [{ type: 'activateTrain' }];
const CONGRESSIONAL_COURIER = [{ type: 'freeCongress', tier: 1, count: 2 }];

export const PONY_CARDS = [
  {
    id: 'PX1',
    number: 1,
    rank: 'A',
    name: 'Fresh Horses',
    kind: 'immediate',
    text: 'Gain 3 resources of your choice',
    effects: [{ type: 'gainChoice', count: 3 }],
  },
  {
    id: 'PX2',
    number: 2,
    rank: 'A',
    name: 'Saddle Bags',
    kind: 'immediate',
    text: 'Add 1 storage carriage for free',
    effects: [{ type: 'addCarriage', carriage: 'storage' }],
  },
  {
    id: 'PX3',
    number: 3,
    rank: 'A',
    name: 'Swift Passage',
    kind: 'immediate',
    text: 'Take up to 2 Move Train steps now',
    effects: [{ type: 'steps', move: 2 }],
    removedWhen: { claimFrom: 'network' },
  },
  {
    id: 'PX4',
    number: 4,
    rank: 'A',
    name: 'Frontier Scout',
    kind: 'immediate',
    text: 'Gain 2 built track tiles of two different types',
    effects: [{ type: 'gainBuiltTilesChoice', count: 2, distinct: true }],
  },
  {
    id: 'PX5',
    number: 5,
    rank: 'A',
    name: 'Quick Route',
    kind: 'immediate',
    text: 'Take 1 claim step now. It is a Lay Tracks action of its own',
    effects: [{ type: 'steps', claim: 1 }],
  },
  {
    id: 'PX6',
    number: 6,
    rank: 'A',
    name: 'Frontier Recruitment',
    kind: 'immediate',
    text: 'Hire 1 specialist for free',
    effects: [{ type: 'hire', count: 1, free: true }],
  },
  {
    id: 'PX7',
    number: 7,
    rank: 'A',
    name: 'Mail Delivery Contract',
    kind: 'immediate',
    text: 'Gain 5 VP',
    effects: [{ type: 'vp', amount: 5 }],
  },
  {
    id: 'PX8',
    number: 8,
    rank: 'A',
    name: 'Versatile Rider',
    kind: 'immediate',
    text: 'Choose one: 2 built track tiles of your choice, or 3 resources of your choice, or 1 cowboy hat',
    effects: VERSATILE_RIDER,
  },
  {
    id: 'PX9',
    number: 9,
    rank: 'A',
    name: 'Rapid Expansion',
    kind: 'immediate',
    text: 'Add 1 carriage of your choice for free, and hire 1 specialist paying its hire cost but no 1-Coin fee. Either order; either part may be skipped',
    effects: [
      { type: 'addCarriage', carriage: 'choice', optional: true },
      { type: 'hire', count: 1, free: false, fee: false, optional: true },
    ],
    order: 'any',
  },
  {
    id: 'PX10',
    number: 10,
    rank: 'A',
    name: 'Double Time',
    kind: 'immediate',
    text: "Activate your train now with M = 1; you choose the Foreman's type",
    effects: DOUBLE_TIME,
  },
  {
    id: 'PX11',
    number: 11,
    rank: 'A',
    name: 'Frontier Trade',
    kind: 'immediate',
    text: 'Return up to 3 resources from your storage and gain the same number of resources of your choice',
    effects: [{ type: 'exchange', max: 3 }],
  },
  {
    id: 'PX12',
    number: 12,
    rank: 'A',
    name: 'Frontier Legend',
    kind: 'immediate',
    text: 'Gain 1 VP for each inland city that is an end of at least one route you own',
    effects: [{ type: 'vpPer', metric: 'inlandCitiesOnOwnRoutes', amount: 1 }],
  },
  {
    id: 'PX13',
    number: 13,
    rank: 'A',
    name: 'Congressional Courier',
    kind: 'immediate',
    text: 'Take up to 2 available tier 1 Congress entries without lobby points or Coins',
    effects: CONGRESSIONAL_COURIER,
  },
  {
    id: 'PX14',
    number: 14,
    rank: 'B',
    name: 'Overland Route',
    kind: 'ongoing',
    text: 'Once per turn, in a free-action opportunity, you may take 1 Move Train step',
    effects: [{ type: 'oncePerTurn', effect: { type: 'steps', move: 1 } }],
    removedWhen: { claimFrom: 'network' },
  },
  {
    id: 'PX15',
    number: 15,
    rank: 'B',
    name: "Pioneer's Knowledge",
    kind: 'ongoing',
    text: 'At the start of each of your train activations choose one specialist in your train (not the Foreman); it is activated 1 extra time in this activation',
    effects: [
      {
        type: 'trigger',
        on: 'trainActivationStart',
        effect: { type: 'extraActivations', count: 1, target: 'chosenSpecialist' },
      },
    ],
  },
  {
    id: 'PX16',
    number: 16,
    rank: 'B',
    name: 'Express Mail Contract',
    kind: 'ongoing',
    text: 'When you place a telegraph station, gain 2 resources of your choice',
    effects: [
      { type: 'trigger', on: 'placeBuilding', where: { kind: 'telegraphStation' }, effect: { type: 'gainChoice', count: 2 } },
    ],
  },
  {
    id: 'PX17',
    number: 17,
    rank: 'B',
    name: 'Frontier Expansion',
    kind: 'immediate',
    text: 'Add 1 specialist carriage and 1 storage carriage for free (each only if you are under its limit)',
    effects: [
      { type: 'addCarriage', carriage: 'specialist' },
      { type: 'addCarriage', carriage: 'storage' },
    ],
  },
  {
    id: 'PX18',
    number: 18,
    rank: 'B',
    name: 'Bulk Shipment',
    kind: 'immediate',
    text: 'Gain 5 resources of your choice',
    effects: [{ type: 'gainChoice', count: 5 }],
  },
  {
    id: 'PX19',
    number: 19,
    rank: 'B',
    name: 'Track Stockpile',
    kind: 'immediate',
    text: 'Gain 3 built track tiles of your choice',
    effects: [{ type: 'gainBuiltTilesChoice', count: 3, distinct: false }],
  },
  {
    id: 'PX20',
    number: 20,
    rank: 'B',
    name: 'Congressional Favor',
    kind: 'ongoing',
    text: 'The first Congress entry you take in each train activation costs 1 Coin less (not below 0)',
    effects: [{ type: 'modifier', what: 'congressCoinDiscount', amount: 1, limit: 'firstPerActivation' }],
  },
  {
    id: 'PX21',
    number: 21,
    rank: 'B',
    name: 'Efficient Operations',
    kind: 'ongoing',
    text: 'Each of your Gather actions gives +1 of what you gathered, added after multiplying',
    effects: [{ type: 'trigger', on: 'gather', effect: { type: 'gainGathered', amount: 1 } }],
  },
  {
    id: 'PX22',
    number: 22,
    rank: 'B',
    name: 'Double Time',
    kind: 'immediate',
    text: "Activate your train now with M = 1; you choose the Foreman's type",
    effects: DOUBLE_TIME,
  },
  {
    id: 'PX23',
    number: 23,
    rank: 'B',
    name: 'Versatile Rider',
    kind: 'immediate',
    text: 'Choose one: 2 built track tiles of your choice, or 3 resources of your choice, or 1 cowboy hat',
    effects: VERSATILE_RIDER,
  },
  {
    id: 'PX24',
    number: 24,
    rank: 'B',
    name: 'Congressional Courier',
    kind: 'immediate',
    text: 'Take up to 2 available tier 1 Congress entries without lobby points or Coins',
    effects: CONGRESSIONAL_COURIER,
  },
  {
    id: 'PX25',
    number: 25,
    rank: 'C',
    name: 'Transcontinental Express',
    kind: 'ongoing',
    text: 'If you complete the transcontinental line, gain +10 VP',
    effects: [{ type: 'trigger', on: 'completeTranscontinental', effect: { type: 'vp', amount: 10 } }],
  },
  {
    id: 'PX26',
    number: 26,
    rank: 'C',
    name: 'Master Network',
    kind: 'ongoing',
    text: 'Tolls paid to you are 5 VP instead of 3',
    effects: [{ type: 'modifier', what: 'tollVp', value: 5 }],
  },
  {
    id: 'PX27',
    number: 27,
    rank: 'C',
    name: 'Experienced Crew',
    kind: 'immediate',
    text: 'Hire up to 2 specialists for free',
    effects: [{ type: 'hire', count: 2, free: true }],
  },
  {
    id: 'PX28',
    number: 28,
    rank: 'C',
    name: 'Frontier Mastery',
    kind: 'ongoing',
    text: 'Once per turn, in a free-action opportunity, you may take any one of the four bonus actions without being at its district and without paying its printed cost. A specialist hired this way still pays its hire cost. This does not count towards the bonus action limit',
    effects: [{ type: 'oncePerTurn', effect: { type: 'bonusAction', which: 'any', printedCostFree: true } }],
  },
  {
    id: 'PX29',
    number: 29,
    rank: 'C',
    name: 'Rails and Riders',
    kind: 'ongoing',
    text: 'Your first connections score +3 VP (8 instead of 5)',
    effects: [{ type: 'trigger', on: 'firstConnection', effect: { type: 'vp', amount: 3 } }],
  },
  {
    id: 'PX30',
    number: 30,
    rank: 'C',
    name: 'Political Influence',
    kind: 'ongoing',
    text: 'When you take Reset, gain 2 VP per senator returned instead of 1',
    effects: [{ type: 'modifier', what: 'resetVpPerSenator', value: 2 }],
  },
  {
    id: 'PX31',
    number: 31,
    rank: 'C',
    name: 'Territory Baron',
    kind: 'endgame',
    text: '5 VP for each city in which you own both the railway station and the telegraph station',
    effects: [{ type: 'endVpPer', metric: 'citiesWithBothOwnBuildings', amount: 5 }],
    removedWhen: { bothBuildingsSameOwner: false },
  },
  {
    id: 'PX32',
    number: 32,
    rank: 'C',
    name: 'Master Engineer',
    kind: 'ongoing',
    text: 'Each time your Foreman is activated you choose which of the four specialist types he acts as',
    effects: [{ type: 'modifier', what: 'foremanAnyType', value: true }],
  },
  {
    id: 'PX33',
    number: 33,
    rank: 'C',
    name: 'Specialist Mastery',
    kind: 'immediate',
    text: 'Choose one specialist type. Until the end of this turn each specialist of that type in your train is activated twice as many times as normal. The Foreman is not affected',
    effects: [{ type: 'untilEndOfTurn', modifier: { what: 'activationMultiplier', value: 2, target: 'chosenSpecialistType' } }],
  },
  {
    id: 'PX34',
    number: 34,
    rank: 'C',
    name: 'Telegraph Tycoon',
    kind: 'ongoing',
    text: 'The VP you score from your telegraph row when you place a telegraph station are doubled',
    effects: [{ type: 'modifier', what: 'telegraphRowVpMultiplier', value: 2 }],
  },
  {
    id: 'PX35',
    number: 35,
    rank: 'C',
    name: 'Track Master',
    kind: 'ongoing',
    text: 'When a claim of yours makes a first connection, every slot of that route scores +3 VP (4 instead of 1)',
    effects: [{ type: 'trigger', on: 'firstConnection', effect: { type: 'vpPerSlot', amount: 3 } }],
  },
  {
    id: 'PX36',
    number: 36,
    rank: 'C',
    name: 'Production Mastery',
    kind: 'ongoing',
    text: 'Your production is 1 higher on all four tracks',
    effects: [{ type: 'modifier', what: 'productionBonus', amount: 1 }],
  },
  {
    id: 'PX37',
    number: 37,
    rank: 'C',
    name: 'Congressional Control',
    kind: 'ongoing',
    text: 'Tier 1 Congress entries cost you 0 Coins. They still cost 1 lobby point',
    effects: [{ type: 'modifier', what: 'congressCoinCost', tier: 1, value: 0 }],
  },
  {
    id: 'PX38',
    number: 38,
    rank: 'C',
    name: 'Pony Express Legacy',
    kind: 'endgame',
    text: '3 VP for each Pony Express token you collected during the game, spent or not',
    effects: [{ type: 'endVpPer', metric: 'tokensCollected', amount: 3 }],
  },
];

// ---------------------------------------------------------------------------
// The effect encoding (one vocabulary for Congress entries, upgrade tiles,
// Legislative Agenda cards and Pony Express cards)
// ---------------------------------------------------------------------------
//
// An effect is `{ type, ...fields }`. docs/engine-contract.md, "Effect
// encoding", says what each type means and which decisions it creates. These
// lists are the whole vocabulary: tests/rules-data.test.mjs fails if a table
// above uses a word that is not listed here, and the module interpreter must have a
// handler for every word.

/** Things that happen once, now. */
export const EFFECT_TYPES = [
  'vp', // { amount }
  'gain', // { items: { iron|wood|gunpowder|coins|hats: n } } fixed gains
  'gainChoice', // { count } resources of the player's choice (R1.8)
  'gainBuiltTile', // { terrain, count } built tiles of a fixed type
  'gainBuiltTilesChoice', // { count, distinct } built tiles of the player's choice
  'addCarriage', // { carriage: 'specialist'|'storage'|'choice' } free of charge (R8.7)
  'hire', // { count, free, fee } hire specialists (R8.6)
  'steps', // { move: n } or { claim: n } steps of R11 / R12
  'activateTrain', // a train activation with M = 1 (R9.2, R9.3)
  'exchange', // { max } return resources, gain as many of choice
  'vpPer', // { metric, amount } VP now, per unit of a metric
  'freeCongress', // { tier, count } entries without lobby points or Coins
  'chooseOne', // { options: [ [effects], ... ] } the player picks one list
  'placeBuildings', // { railwayStation, telegraphStation, where } R13.6
  'resetSenators', // R10.6
  'vpPerBuilt', // { terrain, amount } at the end of the train activation (R15.5.2)
  'untilEndOfTurn', // { modifier } a modifier that lasts until the turn ends
  // Standing effects of a card that stays in play:
  'trigger', // { on, where?, condition?, effect, limit? }
  'modifier', // { what, value|amount, tier?, limit? }
  'oncePerTurn', // { effect } usable once in each of the owner's turns (R18.8)
  'endVpPer', // { metric, amount } VP in final scoring, per unit of a metric
  // Effects that appear only inside a trigger or a oncePerTurn:
  'gainGathered', // { amount } more of what was just gathered
  'vpPerSlot', // { amount } VP per slot of the route just claimed
  'extraActivations', // { count, target }
  'freeCongressSameTier', // { count }
  'bonusAction', // { which, printedCostFree }
];

/** Events a `trigger` may listen to (`on`). */
export const TRIGGER_EVENTS = [
  'completeTranscontinental', // R19.2
  'layTracksActionEnd', // R11.10, whole-action totals
  'placeBuilding', // where: { kind }
  'firstConnection', // R11.5.4
  'gather', // where: { resource }
  'hire', // where: { via }
  'addCarriage', // where: { via }
  'congressEntryTaken', // R10.4
  'trainActivationStart', // R9.4.1
];

/** Rule values a `modifier` may change (`what`). */
export const MODIFIER_KINDS = [
  'congressCoinDiscount',
  'tollVp',
  'resetVpPerSenator',
  'foremanAnyType',
  'telegraphRowVpMultiplier',
  'productionBonus',
  'congressCoinCost',
  'activationMultiplier',
];

/** Comparison operators of a condition `{ metric, op, value }`. */
export const CONDITION_OPS = ['>=', '<=', '==', '>', '<'];

/** Every metric named by a goal, a milestone, a trigger condition or a per-unit effect. */
export const METRIC_NAMES = [
  // goals (R16.5)
  'railwayStations',
  'minNorthSouthBuildings',
  'buildingsInJunctionCities',
  'maxSpecialistsOneType',
  'carriages',
  'upgradesInstalled',
  'completeSpecialistSets',
  'specialists',
  'telegraphsWithOpponentRailway',
  'cargo',
  'telegraphStations',
  'citiesWithOwnBuilding',
  // milestones (R16.8)
  'buildings',
  'ownSlots',
  'longestOwnRoute',
  'ownRoutes',
  'startCitiesJoined',
  // Legislative Agenda trigger conditions (R17.3)
  'distinctTerrainsLaid',
  'slotsLaid',
  'cityHasOpponentBuilding',
  'cityIsJunction',
  'ownBuildings',
  // Pony Express per-unit effects (R18.7)
  'inlandCitiesOnOwnRoutes',
  'citiesWithBothOwnBuildings',
  'tokensCollected',
];

// ---------------------------------------------------------------------------
// The aggregate table and the R21.4 index
// ---------------------------------------------------------------------------

/**
 * Every group above under one roof. `getConstants(state)` returns this object
 * (or a patched copy). `config.constants` patches it by group name, for
 * example `{ SCORING: { vpPerSlot: 2 } }`.
 */
export const RULES = {
  RESOURCES,
  TERRAINS,
  TERRAIN_BY_LETTER,
  STORAGE_ITEMS,
  SPECIALIST_TYPES,
  BUILDING_KINDS,
  NAMES,
  SETUP,
  PLAYER_BOARD,
  HATS,
  GRID,
  BONUS_ACTIONS,
  TRAIN,
  CONGRESS,
  MAP_RULES,
  SCORING,
  VP_SOURCES,
  END_REASONS,
  UPGRADE_TILES,
  GOAL_CARDS,
  MILESTONE_TILES,
  LEGISLATIVE_CARDS,
  PONY,
  PONY_CARDS,
};

/**
 * Where each named constant of spec R21.4 lives, as a path into `RULES`.
 * For readers, for the simulator's flags and for the data test.
 */
export const R21_4_CONSTANTS = {
  workersByPlayerCount: 'SETUP.workersByPlayerCount',
  startingResources: 'SETUP.startingResources', // the 1 Coin is SETUP.startingCoins
  graduatedCompensation: 'SETUP.graduatedCompensation',
  houseSlotsPerTrack: 'PLAYER_BOARD.houseSlotsPerTrack',
  houses: 'PLAYER_BOARD.houses',
  telegraphRowVp: 'PLAYER_BOARD.telegraphRowVp',
  hatLimit: 'HATS.hatLimit',
  hatsPerTurn: 'HATS.hatsPerTurn',
  storagePerCarriage: 'TRAIN.storagePerCarriage',
  maxSpecialistCarriages: 'TRAIN.maxSpecialistCarriages',
  maxStorageCarriages: 'TRAIN.maxStorageCarriages',
  specialistsPerType: 'TRAIN.specialistsPerType',
  bonusActionCosts: 'BONUS_ACTIONS',
  hireCosts: 'TRAIN.hireCosts',
  recipes: 'TRAIN.recipes',
  congressEntries: 'CONGRESS.tables',
  vpPerSlot: 'SCORING.vpPerSlot',
  firstConnectionVp: 'SCORING.firstConnectionVp',
  tollVp: 'SCORING.tollVp',
  moveBuildCost: 'MAP_RULES.moveBuildCost',
  stationStepCost: 'MAP_RULES.stationStepCost',
  completionVp: 'SCORING.completionVp',
  completionVpPerSlot: 'SCORING.completionVpPerSlot',
  goalVp: 'SCORING.goalVp',
  ponyCosts: 'PONY.costs',
  ponyMarketPerRank: 'PONY.marketPerRank',
  ponyTokenEndVp: 'SCORING.ponyTokenEndVp',
  buildingTable: 'SCORING.buildingTable',
  displacementHatsPerWorker: 'HATS.displacementHatsPerWorker',
  lobbyPointsPerFinancierStep: 'CONGRESS.lobbyPointsPerFinancierStep',
  resetVpPerSenator: 'CONGRESS.resetVpPerSenator',
  buildingsPerInlandCity: 'MAP_RULES.buildingsPerInlandCity',
  junctionMinRoutes: 'MAP_RULES.junctionMinRoutes',
  northRegionMaxY: 'MAP_RULES.northRegionMaxY',
  southRegionMinY: 'MAP_RULES.southRegionMinY',
  upgradeTiles: 'UPGRADE_TILES',
  goalCards: 'GOAL_CARDS',
  milestoneTiles: 'MILESTONE_TILES',
  legislativeCards: 'LEGISLATIVE_CARDS',
  ponyCardTable: 'PONY_CARDS',
};
