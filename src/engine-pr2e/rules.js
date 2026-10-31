// rules.js - every tuning number and data table of the second edition's ruleset
// (id `pr2e`, shown to players as "Pacific Rails, second edition").
//
// NO LOGIC. Logic files never read these objects directly: they call
// `getConstants(state)` (state.js), which returns these tables or these tables
// with the game's recorded overrides laid over them (`--const.<GROUP>.<name>`
// on the simulator command line). So there are no bare numbers in the logic.
//
// Rule numbers (`P14.7`) refer to the ruleset's rules text, which is not part
// of this repository. Each table cites the rule it comes from. P21.2 lists the
// constants; `P21_2_CONSTANTS` at the end maps each of its names to its path.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** P1.8. The resources stored as resources. Coin is a resource too, but it is kept in `player.coins` (still in storage, P7.3). */
export const RESOURCES = ['iron', 'wood', 'gunpowder'];

/** P1.8, P5.5.3, P11.1. "A resource of your choice": any of the four, Coin included. */
export const CHOICE_RESOURCES = ['wood', 'iron', 'gunpowder', 'coins'];

/** P1.10, P13.1. Track tile types; also the terrain of a slot. */
export const TERRAINS = ['ground', 'tunnel', 'bridge'];

/** P13.1. Terrain letters of the map data. */
export const TERRAIN_BY_LETTER = { G: 'ground', T: 'tunnel', B: 'bridge' };

/** P7.3. Everything that takes one unit of storage. */
export const STORAGE_ITEMS = ['iron', 'wood', 'gunpowder', 'coins', 'ground', 'tunnel', 'bridge'];

/** P1.14. Specialist types. */
export const SPECIALIST_TYPES = ['crew', 'miner', 'engineer', 'financier'];

/** P1.4. The two kinds of building on the map. */
export const BUILDING_KINDS = ['railwayStation', 'telegraphStation'];

/** Player-facing names (P1 terminology). */
export const NAMES = {
  iron: 'Iron',
  wood: 'Wood',
  gunpowder: 'Gunpowder',
  coins: 'Coin',
  coinsPlural: 'Coins',
  ground: 'Ground',
  tunnel: 'Tunnel',
  bridge: 'Bridge',
  crew: 'Crew',
  miner: 'Miner',
  engineer: 'Engineer',
  financier: 'Financier',
  railwayStation: 'railway station',
  telegraphStation: 'telegraph station',
  districtHouse: 'district house',
  hats: 'cowboy hat',
};

// ---------------------------------------------------------------------------
// Setup (P3)
// ---------------------------------------------------------------------------

export const SETUP = {
  minPlayers: 2,
  maxPlayers: 4,
  /** P3.2. Workers in each player's supply, by player count. */
  workersByPlayerCount: { 2: 6, 3: 4, 4: 3 },
  /** P3.2. Starting resources in storage (the Coin is `startingCoins`). */
  startingResources: { wood: 1, iron: 1, gunpowder: 1 },
  startingCoins: 1,
  startingHats: 0,
  /** P3.3. Houses on the player board: one +1 space is left empty. */
  housesPerPlayer: 11,
  /** P3.1.7. Goal tiles revealed at setup (P18). */
  goalsInPlay: 4,
};

// ---------------------------------------------------------------------------
// The general supply (P2.1, P2.4, P3.1)
// ---------------------------------------------------------------------------

export const SUPPLY = {
  /** P3.1.6. Specialist tokens of each type in play, by player count. Limited. */
  specialistsPerTypeByPlayerCount: { 2: 4, 3: 5, 4: 6 },
  /**
   * P12.1, P3.1.5. The 20 upgrade tokens: level, what they give, and the lowest
   * player count they are used with. Limited. Identical tokens share an id.
   */
  upgradeTokens: [
    { id: 'U1-wood', level: 1, gives: 'wood', minPlayers: 2 },
    { id: 'U1-iron', level: 1, gives: 'iron', minPlayers: 2 },
    { id: 'U1-gunpowder', level: 1, gives: 'gunpowder', minPlayers: 2 },
    { id: 'U1-coins', level: 1, gives: 'coins', minPlayers: 2 },
    { id: 'U1-iron', level: 1, gives: 'iron', minPlayers: 3 },
    { id: 'U1-gunpowder', level: 1, gives: 'gunpowder', minPlayers: 3 },
    { id: 'U1-wood', level: 1, gives: 'wood', minPlayers: 4 },
    { id: 'U1-coins', level: 1, gives: 'coins', minPlayers: 4 },
    { id: 'U2-wood', level: 2, gives: 'wood', minPlayers: 2 },
    { id: 'U2-iron', level: 2, gives: 'iron', minPlayers: 2 },
    { id: 'U2-gunpowder', level: 2, gives: 'gunpowder', minPlayers: 2 },
    { id: 'U2-coins', level: 2, gives: 'coins', minPlayers: 2 },
    { id: 'U2-wood', level: 2, gives: 'wood', minPlayers: 3 },
    { id: 'U2-coins', level: 2, gives: 'coins', minPlayers: 3 },
    { id: 'U2-iron', level: 2, gives: 'iron', minPlayers: 4 },
    { id: 'U2-gunpowder', level: 2, gives: 'gunpowder', minPlayers: 4 },
    { id: 'U3-choice', level: 3, gives: 'choice', minPlayers: 2 },
    { id: 'U3-choice', level: 3, gives: 'choice', minPlayers: 2 },
    { id: 'U3-choice', level: 3, gives: 'choice', minPlayers: 3 },
    { id: 'U3-choice', level: 3, gives: 'choice', minPlayers: 4 },
  ],
  /** P2.1. */
  senators: 8,
  hats: 8,
  /** P2.4. For display only: track tiles and resources are treated as unlimited. */
  trackTilesPerType: 70,
  resourcesPerType: 20,
};

// ---------------------------------------------------------------------------
// The player board and carriages (P2.3, P7)
// ---------------------------------------------------------------------------

export const PLAYER_BOARD = {
  /** P2.3.3. The four house tracks: Wood top left, Iron top right, Gunpowder bottom left, Coin bottom right. */
  houseTracks: ['wood', 'iron', 'gunpowder', 'coins'],
  /** P2.3.3. House spaces per track (+1, +2, +3). */
  houseSlotsPerTrack: 3,
  /** P6.2. Production of a full track. */
  productionBase: 1,
  /** P2.3.1, P16.3. VP printed under the telegraph row, bottom first. */
  telegraphRowVp: [1, 2, 3, 4, 5, 6, 9],
  /** P7.2. */
  boardStorage: 6,
  storagePerCarriage: 3,
  /** P7.4. */
  maxCarriages: 3,
  specialistSpacesPerCarriage: 2,
  /** P8.4. VP printed over carriage 3's two specialist spaces. */
  carriage3SpaceVp: [2, 5],
  /** P15.1. */
  railheads: 2,
};

export const HATS = {
  /** P11.1. */
  hatLimit: 2,
};

// ---------------------------------------------------------------------------
// The action grid (P5, P6)
// ---------------------------------------------------------------------------

export const GRID = {
  /** P5.1. The nine positions of the 3 x 3 grid. Rows from the top, columns from the left. */
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
  /** P5.1. Which district lies on which position (fixed). */
  defaultTiles: {
    D1: 'collect-gunpowder',
    D2: 'financier',
    D3: 'collect-iron',
    D4: 'crew',
    D5: 'lay-or-hire',
    D6: 'engineer',
    D7: 'collect-wood',
    D8: 'miner',
    D9: 'collect-coins',
  },
  /**
   * P5.1. The nine districts. `family` is what the action does:
   *   collect          P6; `collects` names the resource; `special` the special action (P6.7).
   *   boardActivation  P9; `foremanType` is what the Foreman acts as.
   *   layOrHire        P8 or P14, the player's choice (`mode`).
   */
  districtTiles: {
    'collect-gunpowder': { name: 'Collect Gunpowder', family: 'collect', collects: 'gunpowder', special: 'telegraphStation' },
    financier: { name: 'Financier', family: 'boardActivation', foremanType: 'financier' },
    'collect-iron': { name: 'Collect Iron', family: 'collect', collects: 'iron', special: 'districtHouse' },
    crew: { name: 'Crew', family: 'boardActivation', foremanType: 'crew' },
    'lay-or-hire': { name: 'Lay Track or Hire Specialists', family: 'layOrHire' },
    engineer: { name: 'Engineer', family: 'boardActivation', foremanType: 'engineer' },
    'collect-wood': { name: 'Collect Wood', family: 'collect', collects: 'wood', special: 'upgrade' },
    miner: { name: 'Miner', family: 'boardActivation', foremanType: 'miner' },
    'collect-coins': { name: 'Collect Coins', family: 'collect', collects: 'coins', special: 'railwayStation' },
  },
  /** P5.2. The 12 worker spaces, each on the border between two districts. */
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
  /** P5.7.3. M = this + action bonuses. */
  baseMultiplier: 1,
  /** P6.6. */
  buildingSitesPerDistrict: 3,
  /** P6.3, P6.6.3. Extra resources per district house of yours on the district collected. */
  districtHouseYield: 1,
  /** P5.5.3. Hats per returned worker. */
  displacementHatsPerWorker: 1,
  /** P6.7. What the special action of each Collect district costs (its VP are SCORING.specialActionVp). */
  specialActions: {
    telegraphStation: { cost: { coins: 1 } },
    districtHouse: { cost: { wood: 1 } },
    upgrade: { cost: { gunpowder: 1 } },
    railwayStation: { cost: { iron: 1 } },
  },
};

// ---------------------------------------------------------------------------
// Board activation (P9)
// ---------------------------------------------------------------------------

export const ACTIVATION = {
  /** P9.3. 1:1 conversion: what a Crew, Miner or Engineer step pays and builds. */
  recipes: {
    crew: { cost: { iron: 1 }, builds: 'ground' },
    miner: { cost: { gunpowder: 1 }, builds: 'tunnel' },
    engineer: { cost: { wood: 1 }, builds: 'bridge' },
  },
};

// ---------------------------------------------------------------------------
// Hiring (P8)
// ---------------------------------------------------------------------------

export const HIRING = {
  /** P8.5. Tycoon Mode costs by type; index = the carriage number the specialist goes into, minus 1. */
  tycoonCosts: {
    crew: [{ iron: 1, gunpowder: 1 }, { iron: 2, gunpowder: 1 }, { iron: 2, gunpowder: 2 }],
    miner: [{ gunpowder: 1, wood: 1 }, { gunpowder: 2, wood: 1 }, { gunpowder: 2, wood: 2 }],
    engineer: [{ wood: 1, coins: 1 }, { wood: 2, coins: 1 }, { wood: 2, coins: 2 }],
    financier: [{ coins: 1, iron: 1 }, { coins: 2, iron: 1 }, { coins: 2, iron: 2 }],
  },
};

// ---------------------------------------------------------------------------
// Congress (P10)
// ---------------------------------------------------------------------------

export const CONGRESS = {
  /**
   * P10.1. The eight columns: Coin cost and reward. `reward` is resolved by
   * actions.js: gain (items), hats (count), districtHouseOrUpgrade (vp),
   * choice (count resources of choice, not Coins), buildings, builtTiles (count).
   */
  columns: [
    { id: 'K1', cost: 1, reward: 'gain', items: { wood: 2 } },
    { id: 'K2', cost: 1, reward: 'gain', items: { gunpowder: 2 } },
    { id: 'K3', cost: 1, reward: 'gain', items: { iron: 2 } },
    { id: 'K4', cost: 1, reward: 'hats', count: 2 },
    { id: 'K5', cost: 2, reward: 'districtHouseOrUpgrade', vp: 1 },
    { id: 'K6', cost: 2, reward: 'choice', count: 4 },
    { id: 'K7', cost: 3, reward: 'buildings' },
    { id: 'K8', cost: 3, reward: 'builtTiles', count: 2 },
  ],
  /** P10.2.2. */
  resetCost: 1,
  resetVpPerSenator: 1,
  /** P10.3.3. */
  k5Vp: 1,
};

// ---------------------------------------------------------------------------
// Upgrade yields (P12.4)
// ---------------------------------------------------------------------------

export const UPGRADES = {
  /** P12.1. What a token gives at its step, by level - 1 (level 3: that many resources of the player's choice). */
  yield: [1, 2, 3],
};

// ---------------------------------------------------------------------------
// The map (P13 to P17, P19)
// ---------------------------------------------------------------------------

export const MAP_RULES = {
  /** P14.7. */
  vpPerSlotUnconnected: 2,
  vpPerSlotConnected: 1,
  /** P19.2. Per slot of the lay that completes the first transcontinental line, instead of the above. */
  completionVpPerSlot: 3,
  /** P17.1. */
  tollVp: 3,
  /** P16.5. Railway stations placed by Lay Track that bring carriages 1, 2 and 3. */
  carriagesForLayStations: 3,
  /** P16.5.1. Free specialists that come with carriage 1. */
  freeSpecialistsWithCarriage1: 1,
  /** P14.6.5. */
  buildingsPerLay: 1,
};

// ---------------------------------------------------------------------------
// Scoring (P18, P20)
// ---------------------------------------------------------------------------

export const SCORING = {
  /** P18.3. To the sole leader of a goal only. */
  goalVp: 5,
  /** P20.2.2. */
  builtTileEndVp: 1,
  /** P20.3. VP by number of buildings on the map, index = count (0 to 18). */
  buildingTable: [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87],
  /** P6.7. */
  specialActionVp: { districtHouse: 2, upgrade: 2 },
};

/**
 * P20.1, P20.2. The VP sources, in report order. `when`: booked during play or
 * by final scoring. No source belongs to a module (`module: null`): this
 * ruleset has none.
 */
export const VP_SOURCES = [
  { id: 'track', when: 'play', module: null, rule: 'P14.7' },
  { id: 'completion', when: 'play', module: null, rule: 'P19.2' },
  { id: 'telegraph', when: 'play', module: null, rule: 'P16.3' },
  { id: 'toll', when: 'play', module: null, rule: 'P17' },
  { id: 'districtHouse', when: 'play', module: null, rule: 'P6.7' },
  { id: 'upgrade', when: 'play', module: null, rule: 'P6.7' },
  { id: 'congress', when: 'play', module: null, rule: 'P10' },
  { id: 'carriage3', when: 'play', module: null, rule: 'P8.4' },
  { id: 'buildingsEnd', when: 'final', module: null, rule: 'P20.2.1' },
  { id: 'tilesEnd', when: 'final', module: null, rule: 'P20.2.2' },
  { id: 'goals', when: 'final', module: null, rule: 'P20.2.3' },
];

/** P19.6. Why a game ended. */
export const END_REASONS = ['transcontinental', 'turn-limit'];

/**
 * P18.2. The 12 goal tiles: id, a short name, and the measure (a METRICS name
 * in conditions.js) that ranks the players at the end. Each goal pays the sole
 * player with the highest measure (P18.3).
 */
export const GOAL_TILES = [
  { id: 'G1', name: 'Most railway stations', metric: 'railwayStations' },
  { id: 'G2', name: 'Most Crew', metric: 'crew' },
  { id: 'G3', name: 'Most Financiers', metric: 'financiers' },
  { id: 'G4', name: 'Most Iron in storage', metric: 'ironStored' },
  { id: 'G5', name: 'Most telegraph stations', metric: 'telegraphStations' },
  { id: 'G6', name: 'Most Engineers', metric: 'engineers' },
  { id: 'G7', name: 'Most Coins in storage', metric: 'coinsStored' },
  { id: 'G8', name: 'Most Gunpowder in storage', metric: 'gunpowderStored' },
  { id: 'G9', name: 'Most district houses', metric: 'districtHouses' },
  { id: 'G10', name: 'Most Miners', metric: 'miners' },
  { id: 'G11', name: 'Most Wood in storage', metric: 'woodStored' },
  { id: 'G12', name: 'Most upgrade tokens', metric: 'upgradesInstalled' },
];

// ---------------------------------------------------------------------------
// Everything, by group
// ---------------------------------------------------------------------------

export const RULES = {
  RESOURCES,
  CHOICE_RESOURCES,
  TERRAINS,
  TERRAIN_BY_LETTER,
  STORAGE_ITEMS,
  SPECIALIST_TYPES,
  BUILDING_KINDS,
  NAMES,
  SETUP,
  SUPPLY,
  PLAYER_BOARD,
  HATS,
  GRID,
  ACTIVATION,
  HIRING,
  CONGRESS,
  UPGRADES,
  MAP_RULES,
  SCORING,
  VP_SOURCES,
  END_REASONS,
  GOAL_TILES,
};

/** P21.2. Each constant name of the rules text, and where it lives (`GROUP.name`). */
export const P21_2_CONSTANTS = {
  'SETUP.workersByPlayerCount': 'SETUP.workersByPlayerCount',
  'SETUP.startingResources': 'SETUP.startingResources (Coin: SETUP.startingCoins)',
  'SETUP.housesPerPlayer': 'SETUP.housesPerPlayer',
  'SETUP.goalsInPlay': 'SETUP.goalsInPlay',
  'SUPPLY.specialistsPerTypeByPlayerCount': 'SUPPLY.specialistsPerTypeByPlayerCount',
  'SUPPLY.upgradeTokens': 'SUPPLY.upgradeTokens',
  'SUPPLY.senators': 'SUPPLY.senators',
  'SUPPLY.hats': 'SUPPLY.hats',
  'SUPPLY.trackTilesPerType': 'SUPPLY.trackTilesPerType',
  'SUPPLY.resourcesPerType': 'SUPPLY.resourcesPerType',
  'PLAYER_BOARD.houseSlotsPerTrack': 'PLAYER_BOARD.houseSlotsPerTrack',
  'PLAYER_BOARD.productionBase': 'PLAYER_BOARD.productionBase',
  'PLAYER_BOARD.telegraphRowVp': 'PLAYER_BOARD.telegraphRowVp',
  'PLAYER_BOARD.boardStorage': 'PLAYER_BOARD.boardStorage',
  'PLAYER_BOARD.storagePerCarriage': 'PLAYER_BOARD.storagePerCarriage',
  'PLAYER_BOARD.maxCarriages': 'PLAYER_BOARD.maxCarriages',
  'PLAYER_BOARD.specialistSpacesPerCarriage': 'PLAYER_BOARD.specialistSpacesPerCarriage',
  'PLAYER_BOARD.carriage3SpaceVp': 'PLAYER_BOARD.carriage3SpaceVp',
  'HATS.hatLimit': 'HATS.hatLimit',
  'GRID.districts': 'GRID.defaultTiles, GRID.districtTiles',
  'GRID.buildingSitesPerDistrict': 'GRID.buildingSitesPerDistrict',
  'GRID.districtHouseYield': 'GRID.districtHouseYield',
  'GRID.displacementHatsPerWorker': 'GRID.displacementHatsPerWorker',
  'GRID.specialActions': 'GRID.specialActions',
  'ACTIVATION.recipes': 'ACTIVATION.recipes',
  'HIRING.tycoonCosts': 'HIRING.tycoonCosts',
  'CONGRESS.columns': 'CONGRESS.columns',
  'CONGRESS.resetCost': 'CONGRESS.resetCost',
  'CONGRESS.resetVpPerSenator': 'CONGRESS.resetVpPerSenator',
  'CONGRESS.k5Vp': 'CONGRESS.k5Vp',
  'UPGRADES.yield': 'UPGRADES.yield',
  'MAP_RULES.vpPerSlotUnconnected': 'MAP_RULES.vpPerSlotUnconnected',
  'MAP_RULES.vpPerSlotConnected': 'MAP_RULES.vpPerSlotConnected',
  'MAP_RULES.completionVpPerSlot': 'MAP_RULES.completionVpPerSlot',
  'MAP_RULES.tollVp': 'MAP_RULES.tollVp',
  'MAP_RULES.buildingsPerInlandCity': 'BUILDING_KINDS (one of each, different owners: fixed in legality.js)',
  'MAP_RULES.carriagesForLayStations': 'MAP_RULES.carriagesForLayStations, MAP_RULES.freeSpecialistsWithCarriage1',
  'MAP_RULES.buildingsPerLay': 'MAP_RULES.buildingsPerLay',
  'MAP_RULES.arrivalBuildingCost': '(nothing: an arrival building is free)',
  'SCORING.goalVp': 'SCORING.goalVp',
  'SCORING.builtTileEndVp': 'SCORING.builtTileEndVp',
  'SCORING.buildingTable': 'SCORING.buildingTable',
  'SCORING.specialActionVp': 'SCORING.specialActionVp',
};
