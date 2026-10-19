// Rules audit, part 5: R19 what ends the game, R20 final scoring and tie-breaks,
// R21 variants and tuning constants, the worked examples E1 to E10 of R22.
// Written from rules spec v2.

import {
  createGame, RULES, MAP, VARIANTS, resolveVariants, defaultVariants, scoreGame, isGameOver, production, storageUsed, storageCapacity,
  isJunctionCity, getDistrictActionBlockReason,
} from '../../src/engine/index.js';
import { drive } from '../helpers/play.mjs';
import {
  assert, check, game, act, take, put, give, setHeads, setTrain, claim, placeAndChoose, choose, types, eventOf, eventsOf, vpBySource,
  offered, offers, refused, idleTurn, idleUntil, finishTurn, playTurn, goTo, kind, keys, giveTokens, stock, ownCard, installTile, building,
  getValidActions, topFrame, vpTotal, vpOfEvents, MODULES_OFF,
} from './kit.mjs';

const PONY = { modulePonyExpress: true };
const UPGRADES = { moduleCarriageUpgrades: true };
const sorted = (a) => a.slice().sort();
const held = (p) => ({ ...p.resources, coins: p.coins });
const TILES = { ground: 9, tunnel: 9, bridge: 9 };
const INLAND = ['SPO', 'REN', 'FRE', 'HEL', 'BOI', 'LVG', 'PHX', 'BIL', 'SLC', 'SFE', 'BIS', 'CHE', 'DEN', 'ELP', 'SXF', 'NPL', 'DOD'];

function layGame(west = 'POR', east = 'MIN', variants = {}, players = 2) {
  const s = game(players, variants);
  setHeads(s, 0, west, east);
  s.players[0].train.storageCarriages = 3;
  give(s, 0, { resources: {}, tiles: TILES });
  return s;
}

/** Gives a player `n` buildings on the map by hand: telegraph stations first (up to 7), then railway stations. */
function buildings(s, pid, n, from = 0) {
  let placed = 0;
  for (let i = from; i < INLAND.length && placed < n && placed < 7; i++) {
    if (s.map.telegraphStation[INLAND[i]] === null) {
      building(s, pid, 'telegraphStation', INLAND[i]);
      placed += 1;
    }
  }
  const tracks = ['wood', 'coins', 'iron', 'gunpowder'];
  for (let i = from; i < INLAND.length && placed < n; i++) {
    if (s.map.railwayStation[INLAND[i]] === null) {
      building(s, pid, 'railwayStation', INLAND[i], tracks.find((t) => s.players[pid].houses[t] > 0));
      placed += 1;
    }
  }
  assert.equal(placed, n);
}

/** Seat `pid` (at their worker step, railhead on Bismarck, owning Seattle-Helena-Bismarck) completes the line into Minneapolis. */
function complete(s, pid, space = 'W4') {
  const p = s.players[pid];
  p.railheads = ['BIS', p.railheads[1]];
  claim(s, pid, 'SEA-HEL', 'HEL-BIS');
  give(s, pid, { tiles: { ground: 5 }, resources: {} });
  const ev = placeAndChoose(s, space, 'D5');
  if (offered(s, 'claimRoute', { route: 'BIS-MIN' })) ev.push(...act(s, { type: 'claimRoute', route: 'BIS-MIN', from: 'BIS' }));
  return ev;
}

// R21.3, transcribed from the spec: name, type, allowed values (or [min, max]), default.
const R21_3 = [
  ['conversionRate', 'enum', ['1:1', '2:1', 'iron-in-all'], '2:1'],
  ['turnStructure', 'enum', ['continuous', 'rounds'], 'continuous'],
  ['moduleCarriageUpgrades', 'boolean', [true, false], true],
  ['endGameScoring', 'enum', ['milestones', 'goals', 'both', 'none'], 'milestones'],
  ['goalsInPlay', 'integer', [1, 12], 3],
  ['milestonesInPlay', 'integer', [1, 10], 6],
  ['moduleLegislativeAgenda', 'boolean', [true, false], true],
  ['legislativeAgendaCard', 'enum-or-integer', [4, 20], 'random'],
  ['modulePonyExpress', 'boolean', [true, false], true],
  ['ponyOngoingCap', 'integer', [0, 15], 2],
  ['startCompensation', 'enum', ['graduated', 'none'], 'graduated'],
  ['congressTable', 'enum', ['design-2026-10', 'jan-2026'], 'design-2026-10'],
  ['claimFrom', 'enum', ['railhead', 'network'], 'railhead'],
  ['layTrackClaims', 'enum', ['per-step', 'per-railhead'], 'per-step'],
  ['gameEndTrigger', 'enum', ['own-crossing', 'any-crossing'], 'own-crossing'],
  ['endRoutesPerPlayer', 'integer', [0, 23], 8],
  ['maxTurnsPerPlayer', 'integer', [0, 500], 80],
  ['bonusActionLimit', 'enum', ['once-per-turn', 'once-per-game', 'multiplied'], 'once-per-turn'],
  ['hireCostModel', 'enum', ['fee-plus-table', 'fee-only', 'table-only'], 'fee-only'],
  ['bothBuildingsSameOwner', 'boolean', [true, false], true],
  ['buildingScoreCurve', 'enum', ['rising', '2018'], 'rising'],
  ['scoringCard', 'enum', ['none', 'random', 'ground', 'tunnel', 'bridge'], 'random'],
  ['upgradeVpTiming', 'enum', ['per-activation', 'on-install'], 'per-activation'],
  ['specialistActivations', 'enum', ['by-level', 'once'], 'once'],
  ['gridLayout', 'enum', ['fixed', 'shuffle-resources'], 'fixed'],
];

const R20_3 = {
  rising: [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 70, 79, 88, 98, 108],
  2018: [0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 69, 75, 80, 84, 87],
};

export default function part5() {
  // ----- R19 -----------------------------------------------------------------
  check('R19.1', 'own-crossing (default): a transcontinental line is a chain of routes all owned by one player joining any west start city to any east start city', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'OMA'); // the line need not use the player's own starting cities
    const ev = complete(s, 0);
    assert.equal(vpBySource(ev, 0).completion, 40);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    const t = game(2);
    setHeads(t, 0, 'POR', 'OMA');
    t.players[0].railheads = ['BIS', 'OMA'];
    claim(t, 0, 'SEA-HEL');
    claim(t, 1, 'HEL-BIS'); // one link belongs to somebody else
    give(t, 0, { tiles: { ground: 5 }, resources: {} });
    const ev2 = placeAndChoose(t, 'W4', 'D5');
    if (offered(t, 'claimRoute', { route: 'BIS-MIN' })) ev2.push(...act(t, { type: 'claimRoute', route: 'BIS-MIN', from: 'BIS' }));
    assert.equal(t.map.routeOwner['BIS-MIN'], 0);
    assert.equal(vpBySource(ev2, 0).completion, undefined);
    assert.equal(t.gameEnd, null);
  });
  check('R19.2.1', 'completing it: 25 VP plus 3 VP per slot of the route just claimed, on top of that route\'s track VP', () => {
    const s = game(2);
    const ev = complete(s, 0);
    assert.deepEqual(vpBySource(ev, 0), { track: 5, completion: 25 + 3 * 5 });
    const short = layGame('SXF', 'OMA');
    short.players[0].railheads = ['SXF', 'OMA'];
    claim(short, 0, 'SEA-HEL', 'HEL-BIS', 'BIS-SXF');
    const ev2 = placeAndChoose(short, 'W4', 'D5');
    ev2.push(...act(short, { type: 'claimRoute', route: 'MIN-SXF', from: 'SXF' }));
    assert.deepEqual(vpBySource(ev2, 0), { track: 2, completion: 25 + 3 * 2 });
  });
  check('R19.2.2', 'completing it triggers the game end', () => {
    const s = game(3);
    complete(s, 0);
    assert.deepEqual([s.gameEnd.reason, isGameOver(s)], ['transcontinental', false]);
  });
  check('R19.2/once', 'it happens once per game: a second line completed later scores nothing extra and triggers nothing', () => {
    const s = game(2);
    const first = complete(s, 0);
    assert.equal(vpBySource(first, 0).completion, 40);
    if (s.turn.player === 0) finishTurn(s);
    // Ben completes a line of his own in the south on the last turn of the game.
    s.players[1].railheads = ['ELP', s.players[1].railheads[1]];
    claim(s, 1, 'LAX-PHX', 'PHX-ELP');
    give(s, 1, { tiles: { ground: 5 }, resources: {} });
    const ev = placeAndChoose(s, 'W6', 'D5');
    if (offered(s, 'claimRoute', { route: 'ELP-FTW' })) ev.push(...act(s, { type: 'claimRoute', route: 'ELP-FTW', from: 'ELP' }));
    assert.equal(s.map.routeOwner['ELP-FTW'], 1);
    assert.deepEqual(vpBySource(ev, 1), { track: 5 });
    assert.equal(s.completion.player, 0);
    assert.equal(s.gameEnd.reason, 'transcontinental');
  });
  check('R19.3', 'second trigger: at step 6, claimed routes >= endRoutesPerPlayer x players (16, 24, 32 by default); nobody scores for it; 0 switches it off', () => {
    const ids = MAP.routeIds;
    for (const [n, limit] of [[2, 16], [3, 24], [4, 32]]) {
      const s = game(n);
      claim(s, 1, ...ids.slice(0, limit - 1));
      idleTurn(s);
      assert.equal(s.gameEnd, null, `${limit - 1} routes with ${n} players`);
      claim(s, 1, ids[limit - 1]);
      const ev = idleTurn(s);
      assert.equal(s.gameEnd.reason, 'routes-claimed');
      assert.equal(eventsOf(ev, 'vp').length, 0, 'nobody scores a bonus for it');
    }
    const off = game(2, { endRoutesPerPlayer: 0 });
    claim(off, 1, ...ids.slice(0, 40));
    idleTurn(off);
    assert.equal(off.gameEnd, null);
    const five = game(2, { endRoutesPerPlayer: 5 });
    claim(five, 1, ...ids.slice(0, 10));
    idleTurn(five);
    assert.equal(five.gameEnd.reason, 'routes-claimed');
  });
  check('R19.4', 'turn limit: when a player has taken maxTurnsPerPlayer turns the end is triggered with reason turn-limit; 0 switches it off', () => {
    const s = game(3, { maxTurnsPerPlayer: 2 });
    for (let i = 0; i < 3; i++) idleTurn(s);
    assert.equal(s.gameEnd, null);
    idleTurn(s);
    assert.equal(s.gameEnd.reason, 'turn-limit');
    assert.ok(!isGameOver(s));
    idleTurn(s);
    idleTurn(s);
    assert.ok(isGameOver(s));
    assert.deepEqual(s.players.map((p) => p.turnsTaken), [2, 2, 2]);
    const off = game(2, { maxTurnsPerPlayer: 0, endRoutesPerPlayer: 0 });
    for (let i = 0; i < 200; i++) idleTurn(off);
    assert.equal(off.gameEnd, null);
    assert.equal(defaultVariants().maxTurnsPerPlayer, 80);
  });
  check('R19.5', 'after the trigger play continues to the end of the round, so every player has had the same number of turns', () => {
    for (const n of [2, 3, 4]) {
      for (let seat = 0; seat < n; seat++) {
        const s = game(n);
        for (let i = 0; i < n + seat; i++) idleTurn(s); // one full round, then up to the triggering seat
        assert.equal(s.turn.player, seat);
        complete(s, seat, 'W4');
        if (s.turn.player === seat && !isGameOver(s)) finishTurn(s);
        for (let later = seat + 1; later < n; later++) {
          assert.ok(!isGameOver(s), `${n} players, trigger by seat ${seat + 1}: seat ${later + 1} still plays`);
          assert.equal(s.turn.player, later);
          idleTurn(s);
        }
        assert.ok(isGameOver(s), `${n} players, trigger by seat ${seat + 1}: the game ends after the last seat`);
        assert.deepEqual(s.players.map((p) => p.turnsTaken), new Array(n).fill(2));
      }
    }
  });
  check('R19.5/last', 'if the trigger happens on the last seat\'s own turn the game ends when that turn ends, after its remaining steps', () => {
    const s = game(2, PONY);
    idleTurn(s);
    giveTokens(s, 1, 1);
    const ev = complete(s, 1, 'W4');
    assert.ok(!isGameOver(s), 'the turn is not over: the second free-action window is still to come');
    assert.equal(kind(s), 'freeActions');
    act(s, { type: 'endFreeActions' });
    assert.ok(isGameOver(s));
    assert.equal(vpBySource(ev, 1).completion, 40);
  });
  check('R19.6', 'after the trigger everything works normally: routes are claimed, milestones claimed, buildings placed', () => {
    const s = game(2, { endGameScoring: 'milestones' });
    s.modules.milestones.inPlay = ['MS5'];
    s.modules.milestones.claimedBy = { MS5: null };
    s.modules.milestones.claimedBy.MS5 = 0; // Anna has it already (her 5-slot route below)
    complete(s, 0);
    if (s.turn.player === 0) finishTurn(s);
    assert.ok(!isGameOver(s));
    s.modules.milestones.inPlay = ['MS5', 'MS9'];
    s.modules.milestones.claimedBy.MS9 = null;
    setTrain(s, 1, [['crew', null], [null, null]]);
    s.players[1].train.storageCarriages = 3;
    setHeads(s, 1, 'POR', 'OMA');
    give(s, 1, { tiles: { bridge: 2 }, resources: {} });
    const ev = placeAndChoose(s, 'W6', 'D5');
    if (offered(s, 'claimRoute', { route: 'POR-SPO' })) ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    ev.push(...act(s, { type: 'placeTelegraphStation', city: 'SPO' }));
    // the game then ends (Ben is the last seat), so the events also carry his final building score: 1 building = 2 VP
    assert.deepEqual(vpBySource(ev, 1), { track: 2, firstConnection: 5, telegraph: 1, milestones: 5, buildingsEnd: 2 });
    assert.ok(isGameOver(s));
  });
  check('R19.7', 'any-crossing: a chain of claimed routes of any owners; the player whose claim completes the first one gets the bonus and triggers the end', () => {
    const s = game(3, { gameEndTrigger: 'any-crossing' });
    s.players[0].railheads = ['BIS', s.players[0].railheads[1]];
    claim(s, 1, 'SEA-HEL');
    claim(s, 2, 'HEL-BIS');
    give(s, 0, { tiles: { ground: 5 }, resources: {} });
    const ev = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute', { route: 'BIS-MIN' })) ev.push(...act(s, { type: 'claimRoute', route: 'BIS-MIN', from: 'BIS' }));
    assert.deepEqual(vpBySource(ev, 0), { track: 5, completion: 40 });
    assert.deepEqual([vpBySource(ev, 1), vpBySource(ev, 2)], [{}, {}]);
    assert.equal(s.gameEnd.reason, 'transcontinental');
    assert.equal(s.gameEnd.triggeredBy, 0);
  });
  check('R19.8', 'end reasons recorded: transcontinental, routes-claimed, turn-limit', () => {
    assert.deepEqual(sorted(RULES.END_REASONS), ['routes-claimed', 'transcontinental', 'turn-limit']);
    const s = game(2, { maxTurnsPerPlayer: 1 });
    assert.equal(scoreGame(s).endReason, null);
    idleTurn(s);
    idleTurn(s);
    assert.equal(scoreGame(s).endReason, 'turn-limit');
    assert.equal(scoreGame(s).final, true);
  });

  // ----- R20 -----------------------------------------------------------------
  check('R20.1', 'VP are kept by source: track, firstConnection, completion, telegraph, toll, congress, upgrades, milestones, legislative, ponyCards', () => {
    const s = createGame({ playerCount: 2, seed: 3 });
    assert.deepEqual(Object.keys(s.players[0].vp), ['track', 'firstConnection', 'completion', 'telegraph', 'toll', 'congress', 'upgrades', 'milestones', 'legislative', 'ponyCards', 'buildingsEnd', 'ponyEnd']);
    const both = createGame({ playerCount: 2, seed: 3, variants: { endGameScoring: 'both' } });
    assert.ok('goals' in both.players[0].vp);
    const core = game(2);
    assert.deepEqual(Object.keys(core.players[0].vp), ['track', 'firstConnection', 'completion', 'telegraph', 'toll', 'congress', 'buildingsEnd']);
  });
  check('R20.1/total', 'a player\'s score is the sum of the sources', () => {
    const s = layGame();
    building(s, 1, 'railwayStation', 'SPO');
    placeAndChoose(s, 'W4', 'D5');
    act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' });
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    const score = scoreGame(s);
    assert.deepEqual(score.players[0].bySource, { track: 2, firstConnection: 5, completion: 0, telegraph: 1, toll: 0, congress: 0, buildingsEnd: 2 });
    assert.equal(score.players[0].total, 10);
    assert.equal(score.players[1].bySource.toll, 3);
  });
  check('R20.2.1', 'final scoring, buildings: railway stations plus telegraph stations on the map, scored from the building table', () => {
    const s = game(2, { maxTurnsPerPlayer: 1 });
    building(s, 0, 'railwayStation', 'SPO');
    building(s, 0, 'railwayStation', 'BOI');
    building(s, 0, 'telegraphStation', 'SPO');
    building(s, 1, 'telegraphStation', 'BOI');
    idleTurn(s);
    assert.deepEqual(s.players.map((p) => p.vp.buildingsEnd), [0, 0], 'not before the game has ended');
    idleTurn(s);
    assert.ok(isGameOver(s));
    assert.deepEqual(s.players.map((p) => p.vp.buildingsEnd), [7, 2]);
  });
  check('R20.2.2', 'final scoring, goals, if in play', () => {
    const s = game(2, { endGameScoring: 'goals', maxTurnsPerPlayer: 1 });
    s.modules.goals.inPlay = ['G5', 'G8'];
    setTrain(s, 0, [['crew', 'crew'], [null, null]]); // most carriages (3 against 2), most specialists (2 against 1)
    idleTurn(s);
    idleTurn(s);
    assert.deepEqual(s.players.map((p) => p.vp.goals), [20, 0]);
  });
  check('R20.2.3', 'final scoring, Pony Express: 1 VP per token still held and the endgame cards 31 and 38', () => {
    const s = game(2, { ...PONY, maxTurnsPerPlayer: 1 });
    ownCard(s, 0, 'PX31');
    ownCard(s, 0, 'PX38');
    giveTokens(s, 0, 2, 3);
    building(s, 0, 'railwayStation', 'SPO');
    building(s, 0, 'telegraphStation', 'SPO');
    for (let i = 0; i < 2 && !isGameOver(s); i++) {
      if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
      idleTurn(s);
    }
    assert.ok(isGameOver(s));
    assert.equal(s.modules.pony.players[0].tokensHeld, 2);
    assert.equal(s.players[0].vp.ponyEnd, 2 + 5 + 9);
  });
  check('R20.2/nothing-else', 'leftover resources, built tiles, Coins, hats, specialists, carriages and workers are worth 0 VP', () => {
    const plain = game(2);
    const rich = game(2);
    give(rich, 0, { resources: { iron: 9, wood: 9, gunpowder: 9 }, tiles: TILES, coins: 99, hats: 2 });
    setTrain(rich, 0, [['crew', 'miner'], ['engineer', 'financier'], ['crew', 'crew']]);
    rich.players[0].train.storageCarriages = 3;
    put(rich, 0, 'W1');
    assert.equal(scoreGame(rich).players[0].total, scoreGame(plain).players[0].total);
    assert.equal(scoreGame(rich).players[0].total, 0);
  });
  for (const curve of ['rising', '2018']) {
    check(`R20.3/${curve}`, `the building table "${curve}": 0 to 18 buildings`, () => {
      const got = [];
      for (let n = 0; n <= 18; n++) {
        const s = game(2, { buildingScoreCurve: curve });
        buildings(s, 0, n);
        got.push(scoreGame(s).players[0].bySource.buildingsEnd);
      }
      assert.deepEqual(got, R20_3[curve]);
    });
  }
  check('R20.4', 'the player with the most VP wins', () => {
    const s = game(3, { maxTurnsPerPlayer: 1 });
    s.players[1].vp.track = 9;
    s.players[2].vp.track = 4;
    for (let i = 0; i < 3; i++) idleTurn(s);
    const score = scoreGame(s);
    assert.deepEqual([score.winner, score.ranking, score.decidedBy], [1, [1, 2, 0], 'vp']);
  });
  check('R20.5.1', 'tie-break 1: most buildings on the map', () => {
    const s = game(3, { maxTurnsPerPlayer: 1 });
    buildings(s, 2, 2); // 4 VP at the end
    s.players[0].vp.track = 4;
    s.players[1].vp.track = 4;
    claim(s, 0, 'SEA-HEL', 'LAX-PHX'); // more slots, more cargo, earlier seat: none of it matters
    for (let i = 0; i < 3; i++) idleTurn(s);
    const score = scoreGame(s);
    assert.deepEqual(score.players.map((p) => p.total), [4, 4, 4]);
    assert.deepEqual([score.winner, score.decidedBy], [2, 'buildings']);
  });
  check('R20.5.2', 'tie-break 2: most slots in routes they own', () => {
    const s = game(3, { maxTurnsPerPlayer: 1 });
    claim(s, 1, 'POR-SPO', 'SPO-REN'); // 5 slots
    claim(s, 0, 'SEA-SPO', 'POR-REN'); // 4 slots in two routes
    claim(s, 2, 'HEL-BIS'); // 4 slots
    give(s, 0, { resources: { iron: 9 } });
    for (let i = 0; i < 3; i++) idleTurn(s);
    const score = scoreGame(s);
    assert.deepEqual([score.winner, score.decidedBy], [1, 'ownedSlots']);
    assert.deepEqual(score.ranking, [1, 0, 2], 'second and third are separated by cargo');
  });
  check('R20.5.3', 'tie-break 3: most Iron + Wood + Gunpowder + built track tiles in storage', () => {
    const s = game(3, { maxTurnsPerPlayer: 1 });
    give(s, 0, { resources: { iron: 2 }, tiles: {}, coins: 50, hats: 2 });
    give(s, 1, { resources: { wood: 1 }, tiles: { tunnel: 3 } });
    give(s, 2, { resources: { iron: 1, wood: 1, gunpowder: 1 }, tiles: {} });
    for (let i = 0; i < 3; i++) idleTurn(s);
    const score = scoreGame(s);
    assert.deepEqual([score.winner, score.decidedBy, score.ranking], [1, 'cargo', [1, 2, 0]]);
  });
  check('R20.5.4', 'tie-break 4: closest to the start player in turn order, the start player counting as closest', () => {
    const s = game(4, { maxTurnsPerPlayer: 1 });
    for (let i = 0; i < 4; i++) idleTurn(s);
    const score = scoreGame(s);
    assert.deepEqual([score.winner, score.decidedBy, score.ranking], [0, 'turnOrder', [0, 1, 2, 3]]);
    const t = game(4, { maxTurnsPerPlayer: 1 });
    t.players[2].vp.track = 1;
    t.players[3].vp.track = 1;
    for (let i = 0; i < 4; i++) idleTurn(t);
    assert.deepEqual(scoreGame(t).ranking, [2, 3, 0, 1]);
  });

  // ----- R21 -----------------------------------------------------------------
  check('R21.1', 'the four add-on modules are on by default: carriage upgrades, milestones, Legislative Agenda, Pony Express', () => {
    const s = createGame({ playerCount: 3, seed: 11 });
    assert.deepEqual(sorted(Object.keys(s.modules)), ['legislative', 'milestones', 'pony', 'upgrades']);
    const off = createGame({ playerCount: 3, seed: 11, variants: MODULES_OFF });
    assert.deepEqual(Object.keys(off.modules), []);
    drive(off, (x) => x.phase === 'setup');
    for (let i = 0; i < 9; i++) idleTurn(off);
    assert.equal(off.phase, 'play', 'the game is complete without the modules');
  });
  check('R21.2', 'two players: no rule changes beyond the worker count', () => {
    const s = game(2);
    assert.deepEqual(s.players.map((p) => p.workersInSupply), [6, 6]);
    assert.ok(Object.values(s.grid.spaces).every((x) => x === null) && Object.values(s.grid.centres).every((x) => x === null), 'no neutral blocker');
    assert.equal(Object.keys(s.map.routeOwner).length, 47, 'the whole map');
  });
  check('R21.3', 'the variants object: exactly the 25 variants of the spec; unknown names are rejected', () => {
    assert.deepEqual(VARIANTS.map((v) => v.name), R21_3.map((r) => r[0]));
    assert.deepEqual(Object.keys(defaultVariants()), R21_3.map((r) => r[0]));
    assert.throws(() => resolveVariants({ noSuchVariant: 1 }));
    assert.throws(() => createGame({ playerCount: 2, seed: 1, variants: { conversionrate: '1:1' } }));
  });
  for (const [name, type, allowed, def] of R21_3) {
    check(`R21.3/${name}`, `variant ${name}: default ${JSON.stringify(def)}, allowed values, everything else rejected`, () => {
      assert.deepEqual(defaultVariants()[name], def);
      const base = name === 'goalsInPlay' ? { endGameScoring: 'goals' } : {};
      const ok = (value) => assert.equal(resolveVariants({ ...base, [name]: value })[name], value);
      const bad = (value) => assert.throws(() => resolveVariants({ ...base, [name]: value }), undefined, `${name} = ${JSON.stringify(value)} must be rejected`);
      if (type === 'enum') {
        for (const v of allowed) ok(v);
        bad('other');
        bad(1);
        bad(null);
      } else if (type === 'boolean') {
        ok(true);
        ok(false);
        bad('true');
        bad(1);
      } else {
        const [min, max] = allowed;
        if (type === 'enum-or-integer') ok('random');
        for (let v = min; v <= max; v++) ok(v);
        bad(min - 1);
        bad(max + 1);
        bad(min + 0.5);
        bad(String(min));
      }
    });
  }
  check('R21.3/goalsInPlay-11', 'goalsInPlay is at most 11 when carriage upgrades are off, because goal 6 is then removed', () => {
    assert.throws(() => resolveVariants({ endGameScoring: 'goals', goalsInPlay: 12, moduleCarriageUpgrades: false }));
    assert.equal(resolveVariants({ endGameScoring: 'goals', goalsInPlay: 11, moduleCarriageUpgrades: false }).goalsInPlay, 11);
    assert.equal(resolveVariants({ endGameScoring: 'goals', goalsInPlay: 12 }).goalsInPlay, 12);
  });
  check('R21.3/isolation', 'a variant changes the behaviour it names and nothing else: with any one variant at a non-default value the rest of setup is untouched', () => {
    const base = createGame({ playerCount: 4, seed: 21, variants: { legislativeAgendaCard: 5 } });
    const core = (s) => JSON.stringify([s.players.map((p) => [p.name, p.coins, p.resources, p.houses, p.workersInSupply, p.train]), s.supply, s.completion, s.gameEnd]);
    for (const [name, type, allowed, def] of R21_3) {
      if (['goalsInPlay'].includes(name)) continue;
      const value = type === 'boolean' ? !def : type === 'enum' ? allowed.find((v) => v !== def) : name === 'legislativeAgendaCard' ? 6 : def + 1;
      const s = createGame({ playerCount: 4, seed: 21, variants: { legislativeAgendaCard: 5, [name]: value } });
      assert.equal(core(s), core(base), name);
      if (name !== 'gridLayout') assert.deepEqual(s.grid, base.grid, name);
      if (name !== 'scoringCard') assert.equal(s.scoringCard, base.scoringCard, name);
      if (name !== 'congressTable') assert.deepEqual(s.congress, base.congress, name);
      for (const [other, , , otherDefault] of R21_3) {
        if (other !== name && other !== 'legislativeAgendaCard') assert.deepEqual(s.variants[other], otherDefault, `${name} must not change ${other}`);
      }
    }
  });
  check('R21.4', 'the tuning constants hold the values of the spec', () => {
    const K = RULES;
    assert.deepEqual(K.SETUP.workersByPlayerCount, { 2: 6, 3: 4, 4: 3 });
    assert.deepEqual([K.SETUP.startingResources, K.SETUP.startingCoins], [{ iron: 1, wood: 1, gunpowder: 1 }, 1]);
    assert.deepEqual(K.SETUP.graduatedCompensation, [0, 1, 1, 2]);
    assert.deepEqual([K.PLAYER_BOARD.houseSlotsPerTrack, K.PLAYER_BOARD.houses], [3, 11]);
    assert.deepEqual(K.PLAYER_BOARD.telegraphRowVp, [1, 2, 3, 4, 5, 6, 9]);
    assert.deepEqual([K.HATS.hatLimit, K.HATS.hatsPerTurn], [2, 1]);
    assert.equal(K.TRAIN.storagePerCarriage, 9);
    assert.deepEqual([K.TRAIN.maxSpecialistCarriages, K.TRAIN.maxStorageCarriages], [3, 3]);
    assert.equal(K.TRAIN.specialistsPerType, 12);
    assert.deepEqual(
      [K.BONUS_ACTIONS.upgrade.cost, K.BONUS_ACTIONS.hire.cost, K.BONUS_ACTIONS.hat.cost, K.BONUS_ACTIONS.carriage.cost],
      [{ iron: 1 }, { coins: 1 }, { gunpowder: 1 }, { wood: 1 }],
    );
    assert.deepEqual([K.SCORING.vpPerSlot, K.SCORING.firstConnectionVp, K.SCORING.tollVp], [1, 5, 3]);
    assert.deepEqual([K.MAP_RULES.moveBuildCost, K.MAP_RULES.stationStepCost], [{ coins: 2 }, { coins: 2 }]);
    assert.deepEqual([K.SCORING.completionVp, K.SCORING.completionVpPerSlot], [25, 3]);
    assert.deepEqual(K.SCORING.goalVp, [10, 5]);
    assert.deepEqual([K.PONY.costs, K.PONY.marketPerRank, K.SCORING.ponyTokenEndVp], [{ A: 2, B: 3, C: 5 }, 2, 1]);
    assert.deepEqual(K.SCORING.buildingTable, R20_3);
    assert.deepEqual([K.HATS.displacementHatsPerWorker, K.CONGRESS.lobbyPointsPerFinancierStep, K.CONGRESS.resetVpPerSenator], [1, 1, 1]);
    assert.deepEqual(K.MAP_RULES.buildingsPerInlandCity, { railwayStation: 1, telegraphStation: 1 });
    assert.deepEqual([K.MAP_RULES.junctionMinRoutes, K.MAP_RULES.northRegionMaxY, K.MAP_RULES.southRegionMinY], [5, 140, 250]);
  });
  // Every tuning number must be READ from the constants: change one and the behaviour follows.
  const probe = (constants, variants = {}, players = 2) => game(players, variants, { constants });
  check('R21.4/workers', 'workersByPlayerCount, startingCoins and startingResources are read from the constants', () => {
    const s = probe({ SETUP: { workersByPlayerCount: { 2: 5, 3: 4, 4: 3 }, startingCoins: 4, startingResources: { iron: 2, wood: 0, gunpowder: 3 } } });
    assert.deepEqual([s.players[0].workersInSupply, s.players[0].coins, s.players[0].resources], [5, 4, { iron: 2, wood: 0, gunpowder: 3 }]);
  });
  check('R21.4/hats', 'hatLimit and displacementHatsPerWorker are read from the constants', () => {
    const s = probe({ HATS: { hatLimit: 3, displacementHatsPerWorker: 2 } }, {}, 3);
    put(s, 1, 'W10');
    put(s, 2, 'W12');
    give(s, 2, { hats: 2 });
    act(s, { type: 'displaceWorker', district: 'D9' });
    assert.equal(s.players[1].hats, 2);
    assert.equal(s.players[2].hats, 3);
    assert.equal(kind(s), 'chooseResource', 'the fourth hat does not fit a limit of 3');
  });
  check('R21.4/storage', 'storagePerCarriage and the carriage limits are read from the constants', () => {
    const s = probe({ TRAIN: { storagePerCarriage: 4, maxStorageCarriages: 4, maxSpecialistCarriages: 1 } });
    assert.equal(storageCapacity(s, 0), 4);
    s.players[0].train.storageCarriages = 3;
    give(s, 0, { resources: { wood: 1 } });
    placeAndChoose(s, 'W12', 'D9');
    assert.deepEqual(offers(s, 'addCarriage').map((a) => a.carriage), ['storage']);
  });
  check('R21.4/bonus', 'the bonus action costs are read from the constants', () => {
    const s = probe({ BONUS_ACTIONS: { hat: { cost: { gunpowder: 2 } } } });
    give(s, 0, { resources: { gunpowder: 2 } });
    placeAndChoose(s, 'W11', 'D7');
    act(s, { type: 'buyHat' });
    assert.equal(s.players[0].resources.gunpowder, 0);
  });
  check('R21.4/recipes', 'recipes and hire costs are read from the constants', () => {
    const s = probe({ TRAIN: { recipes: { '2:1': { crew: { cost: { iron: 3 }, output: 'ground' } } }, hireCosts: { miner: [{ wood: 1 }, { wood: 1 }, { wood: 1 }] } } }, { hireCostModel: 'table-only' });
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { resources: { iron: 3, wood: 2 } });
    placeAndChoose(s, 'W6', 'D4');
    act(s, { type: 'useStep' });
    assert.equal(s.players[0].resources.iron, 0);
    idleUntil(s, 0);
    placeAndChoose(s, 'W2', 'D3');
    act(s, { type: 'hireSpecialist', specialist: 'miner' });
    assert.equal(s.players[0].resources.wood, 1);
  });
  check('R21.4/track', 'vpPerSlot, firstConnectionVp and tollVp are read from the constants', () => {
    const s = probe({ SCORING: { vpPerSlot: 2, firstConnectionVp: 7, tollVp: 4 } });
    setHeads(s, 0, 'POR', 'OMA');
    give(s, 0, { tiles: { bridge: 2 } });
    s.map.railwayStation.SPO = 1;
    const ev = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute')) ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    assert.deepEqual([vpBySource(ev, 0), vpBySource(ev, 1)], [{ track: 4, firstConnection: 7 }, { toll: 4 }]);
  });
  check('R21.4/completion', 'completionVp and completionVpPerSlot are read from the constants', () => {
    const s = probe({ SCORING: { completionVp: 30, completionVpPerSlot: 4 } });
    assert.equal(vpBySource(complete(s, 0), 0).completion, 30 + 4 * 5);
  });
  check('R21.4/move', 'moveBuildCost and stationStepCost are read from the constants', () => {
    const s = probe({ MAP_RULES: { moveBuildCost: { coins: 3 } } });
    setHeads(s, 0, 'POR', 'OMA');
    claim(s, 1, 'POR-SPO');
    give(s, 0, { coins: 3 });
    placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'moveTrain')) act(s, { type: 'moveTrain', from: 'POR', to: 'SPO' });
    act(s, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(s.players[0].coins, 0);
    const n = probe({ MAP_RULES: { stationStepCost: { coins: 4 } } }, { claimFrom: 'network' });
    setHeads(n, 0, 'POR', 'OMA');
    claim(n, 0, 'POR-SPO');
    give(n, 0, { coins: 4, tiles: { tunnel: 2 } });
    placeAndChoose(n, 'W4', 'D5');
    act(n, { type: 'placeTelegraphStation', city: 'SPO' });
    assert.equal(n.players[0].coins, 0);
  });
  check('R21.4/telegraph', 'telegraphRowVp and the building table are read from the constants', () => {
    const s = probe({ PLAYER_BOARD: { telegraphRowVp: [3, 2, 3, 4, 5, 6, 9] }, SCORING: { buildingTable: { rising: [0, 9, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 62, 70, 79, 88, 98, 108] } } });
    setHeads(s, 0, 'POR', 'OMA');
    give(s, 0, { tiles: { bridge: 2 } });
    const ev = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute')) ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    ev.push(...act(s, { type: 'placeTelegraphStation', city: 'SPO' }));
    assert.equal(vpBySource(ev, 0).telegraph, 3);
    assert.equal(scoreGame(s).players[0].bySource.buildingsEnd, 9);
  });
  check('R21.4/congress', 'lobbyPointsPerFinancierStep, resetVpPerSenator and the Congress table are read from the constants', () => {
    const s = probe({ CONGRESS: { lobbyPointsPerFinancierStep: 2, resetVpPerSenator: 3 } });
    setTrain(s, 0, [[null, null]]);
    give(s, 0, { coins: 5 });
    s.congress.used.C5 = true;
    placeAndChoose(s, 'W1', 'D2');
    assert.equal(topFrame(s).lobby, 2);
    const ev = act(s, { type: 'takeCongressEntry', entry: 'CR' });
    assert.equal(vpBySource(ev, 0).congress, 3);
  });
  check('R21.4/goals', 'goalVp and junctionMinRoutes are read from the constants', () => {
    const s = probe({ SCORING: { goalVp: [12, 6] }, MAP_RULES: { junctionMinRoutes: 6 } }, { endGameScoring: 'goals' }, 3);
    s.modules.goals.inPlay = ['G11'];
    building(s, 0, 'telegraphStation', 'SPO');
    building(s, 0, 'telegraphStation', 'BOI');
    building(s, 1, 'telegraphStation', 'REN');
    assert.deepEqual(scoreGame(s).players.map((p) => p.bySource.goals), [12, 6, 0]);
    assert.deepEqual(sorted(MAP.inlandCities.filter((c) => isJunctionCity(s, c))), ['CHE', 'DEN', 'REN']);
  });
  check('R21.4/pony', 'ponyCosts, ponyMarketPerRank and ponyTokenEndVp are read from the constants', () => {
    const s = probe({ PONY: { costs: { A: 1, B: 3, C: 5 }, marketPerRank: 3 }, SCORING: { ponyTokenEndVp: 2 } }, PONY);
    assert.deepEqual(['A', 'B', 'C'].map((r) => s.modules.pony.market[r].length), [3, 3, 3]);
    stock(s, 'PX7');
    giveTokens(s, 1, 3);
    idleTurn(s);
    act(s, { type: 'buyPonyCard', card: 'PX7' });
    assert.equal(s.modules.pony.players[1].tokensHeld, 2);
    assert.equal(scoreGame(s).players[1].bySource.ponyEnd, 4);
  });

  // ----- R22: the worked examples ----------------------------------------------
  check('E1', 'Gather, with the Hire Specialist bonus action', () => {
    const s = game(4);
    put(s, 0, 'W5');
    const ev = placeAndChoose(s, 'W2', 'D3');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 2);
    assert.deepEqual(s.players[0].resources, { iron: 5, wood: 1, gunpowder: 1 });
    assert.equal(storageUsed(s.players[0]), 7);
    assert.deepEqual(sorted(offers(s, 'hireSpecialist').map((a) => a.specialist)), ['crew', 'engineer', 'financier', 'miner'], 'any type for the same 1 Coin');
    act(s, { type: 'hireSpecialist', specialist: 'crew' });
    assert.deepEqual(held(s.players[0]), { iron: 5, wood: 1, gunpowder: 1, coins: 0 });
    assert.equal(storageUsed(s.players[0]), 7);
    assert.deepEqual(s.players[0].train.specialistCarriages[0].slots, ['crew', 'crew']);
  });
  check('E2', 'Gather, with the Carriage Upgrade bonus action', () => {
    const s = game(2, UPGRADES);
    put(s, 1, 'W1');
    setTrain(s, 1, [['miner', null]]);
    idleTurn(s);
    give(s, 1, { hats: 1, resources: { iron: 2 } });
    const ev = choose(s, act(s, { type: 'removeWorker', from: 'W1' }), 'D1', true);
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 2);
    assert.equal(s.players[1].resources.gunpowder, 2);
    assert.equal(s.players[1].hats, 0);
    act(s, { type: 'installUpgrade', tile: 'U1-gunpowder', level: 1 });
    assert.equal(s.players[1].resources.iron, 1);
    assert.equal(s.modules.upgrades.installed[1][0], 'U1-gunpowder');
    // "from now on every one of his train activations gains 1 Gunpowder just before his level 1 specialists act"
    idleUntil(s, 1);
    give(s, 1, { resources: { gunpowder: 1 } });
    placeAndChoose(s, 'W8', 'D4'); // the Foreman (a Crew) has no Iron; the tile gives 1 Gunpowder; the Miner then has 2
    assert.ok(offered(s, 'useStep'));
    act(s, { type: 'useStep' });
    assert.deepEqual([s.players[1].builtTiles.tunnel, s.players[1].resources.gunpowder], [1, 0]);
  });
  check('E3', 'Gather, with Buy Hat', () => {
    const s = game(4);
    idleTurn(s);
    idleTurn(s);
    give(s, 2, { hats: 1 });
    placeAndChoose(s, 'W8', 'D7');
    assert.equal(s.players[2].resources.wood, 2);
    act(s, { type: 'buyHat' });
    assert.deepEqual([s.players[2].hats, s.players[2].resources.gunpowder], [2, 0]);
    idleUntil(s, 2);
    give(s, 2, { resources: { gunpowder: 2 } });
    choose(s, act(s, { type: 'removeWorker', from: 'W8' }), 'D7');
    assert.ok(s.turn.player !== 2 || !offered(s, 'buyHat'), 'holding 2 hats she cannot take Buy Hat at all');
  });
  check('E4', 'Gather, with Add Carriage', () => {
    const s = game(4, { hireCostModel: 'fee-only' });
    for (let i = 0; i < 3; i++) idleTurn(s);
    placeAndChoose(s, 'W12', 'D9');
    assert.equal(s.players[3].coins, 2);
    act(s, { type: 'addCarriage', carriage: 'specialist' });
    assert.equal(s.players[3].resources.wood, 0);
    assert.deepEqual(s.players[3].train.specialistCarriages.map((c) => c.slots), [['crew', null], [null, null]]);
    idleUntil(s, 3);
    const ev = placeAndChoose(s, 'W2', 'D3');
    ev.push(...act(s, { type: 'hireSpecialist', specialist: 'miner' }));
    assert.deepEqual([eventOf(ev, 'hire').level, eventOf(ev, 'hire').slot], [1, 2], 'his next hire still goes to the level 1 carriage');
  });
  check('E5', 'Train activation at Bridge Tracks', () => {
    const s = game(2, UPGRADES);
    setTrain(s, 0, [['engineer', 'crew'], ['engineer', null]]);
    installTile(s, 0, 1, 'U1-wood');
    give(s, 0, { resources: { wood: 5, iron: 2 } });
    put(s, 0, 'W10');
    const map = JSON.stringify(s.map);
    const ev = placeAndChoose(s, 'W7', 'D6');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 2);
    assert.equal(eventOf(ev, 'trainActivation').steps, 6);
    const snapshot = () => [s.players[0].resources.wood, s.players[0].resources.iron, s.players[0].builtTiles.bridge, s.players[0].builtTiles.ground];
    ev.push(...act(s, { type: 'useStep' }));
    assert.deepEqual(snapshot(), [3, 2, 1, 0]);
    ev.push(...act(s, { type: 'useStep' })); // Foreman again; then the U1-wood step runs by itself
    assert.deepEqual(snapshot(), [2, 2, 2, 0]);
    ev.push(...act(s, { type: 'useStep' })); // Engineer, level 1
    assert.deepEqual(snapshot(), [0, 2, 3, 0]);
    ev.push(...act(s, { type: 'useStep' })); // Crew, level 1; the level 2 Engineer cannot pay
    assert.deepEqual(snapshot(), [0, 0, 3, 1]);
    assert.equal(s.turn.player, 1);
    assert.equal(storageUsed(s.players[0]), 4);
    assert.equal(JSON.stringify(s.map), map, 'nothing has been put on the map');
    assert.deepEqual(eventsOf(ev, 'build').map((e) => `${e.level}:${e.terrain}`), ['0:bridge', '0:bridge', '1:bridge', '1:ground']);
  });
  check('E6', 'Lobby Congress', () => {
    const s = game(2);
    setTrain(s, 0, [['financier', 'miner']]);
    give(s, 0, { coins: 4, resources: { iron: 1, wood: 1 } });
    const ev = placeAndChoose(s, 'W4', 'D2');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 1);
    assert.equal(eventOf(ev, 'trainActivation').steps, 3);
    assert.equal(topFrame(s).lobby, 1);
    assert.deepEqual(sorted(offers(s, 'takeCongressEntry').map((a) => a.entry)), ['C1', 'C2'], 'Reset is not available: no entry is used');
    act(s, { type: 'closeCongress' });
    assert.equal(topFrame(s).lobby, 2);
    act(s, { type: 'takeCongressEntry', entry: 'C3' });
    assert.deepEqual([s.players[0].coins, s.players[0].resources.gunpowder, s.players[0].hats], [2, 2, 1]);
    assert.ok(offered(s, 'useStep'));
    act(s, { type: 'useStep' });
    assert.deepEqual([s.players[0].resources.gunpowder, s.players[0].builtTiles.tunnel], [0, 1]);
    assert.equal(s.turn.player, 1);
    assert.equal(s.congress.used.C3, true);
    // the alternative: C1 after the Foreman, C2 after the Financier
    const t = game(2);
    setTrain(t, 0, [['financier', 'miner']]);
    give(t, 0, { coins: 4, resources: {} });
    placeAndChoose(t, 'W4', 'D2');
    act(t, { type: 'takeCongressEntry', entry: 'C1' });
    act(t, { type: 'takeCongressEntry', entry: 'C2' });
    assert.deepEqual(held(t.players[0]), { iron: 2, wood: 2, gunpowder: 0, coins: 2 });
  });
  check('E7', 'Lay Tracks', () => {
    const s = game(2, PONY);
    setHeads(s, 0, 'POR', 'KCY');
    setHeads(s, 1, 'SEA', 'OMA');
    give(s, 0, { resources: {}, tiles: { bridge: 2, tunnel: 2, ground: 1 } });
    put(s, 0, 'W6');
    const ev = choose(s, act(s, { type: 'removeWorker', from: 'W6' }), 'D5');
    assert.equal(eventOf(ev, 'districtChosen').multiplier, 1);
    assert.deepEqual(sorted(offers(s, 'claimRoute').map((a) => a.route)), ['POR-REN', 'POR-SPO']);
    ev.push(...act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' }));
    assert.equal(s.players[0].railheads[0], 'SPO');
    assert.equal(s.modules.pony.players[0].tokensHeld, 1);
    ev.push(...act(s, { type: 'placeTelegraphStation', city: 'SPO' }));
    assert.deepEqual(vpBySource(ev, 0), { track: 2, firstConnection: 5, telegraph: 1 });
    assert.equal(vpTotal(s, 0), 8);
    assert.deepEqual(s.players[0].builtTiles, { ground: 1, tunnel: 2, bridge: 0 });
    // had he placed a railway station instead: 7 VP and one more production
    const alt = game(2, PONY);
    setHeads(alt, 0, 'POR', 'KCY');
    give(alt, 0, { resources: {}, tiles: { bridge: 2, tunnel: 2, ground: 1 } });
    placeAndChoose(alt, 'W6', 'D5');
    act(alt, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' });
    act(alt, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'wood' });
    assert.equal(vpTotal(alt, 0), 7);
    assert.equal(production(alt, 0, 'wood'), 2);
    // later Hal, on Seattle, claims Seattle - Spokane
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    assert.equal(s.turn.player, 1);
    give(s, 1, { resources: {}, tiles: { ground: 2 } });
    const hal = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute')) hal.push(...act(s, { type: 'claimRoute', route: 'SEA-SPO', from: 'SEA' }));
    assert.deepEqual(vpBySource(hal, 1), { track: 2 });
    assert.equal(s.players[1].railheads[0], 'SPO');
    assert.equal(s.modules.pony.players[1].tokensHeld, 0);
    const coins = s.players[1].coins;
    act(s, { type: 'placeRailwayStation', city: 'SPO', houseTrack: 'iron' });
    assert.deepEqual([s.map.railwayStation.SPO, s.players[1].coins], [1, coins]);
  });
  check('E8', 'Move Train', () => {
    const s = game(2);
    setHeads(s, 0, 'POR', 'MIN');
    s.players[0].railheads = ['SPO', 'MIN'];
    claim(s, 0, 'POR-SPO');
    claim(s, 1, 'BOI-SPO', 'BOI-SLC');
    building(s, 1, 'railwayStation', 'BOI');
    building(s, 1, 'telegraphStation', 'SLC');
    give(s, 0, { coins: 3, resources: {} });
    const iron = production(s, 0, 'iron');
    const ev = placeAndChoose(s, 'W4', 'D5');
    ev.push(...act(s, { type: 'moveTrain', from: 'SPO', to: 'SLC' }));
    assert.deepEqual(vpBySource(ev, 1), { toll: 3 });
    assert.deepEqual(vpBySource(ev, 0), {});
    ev.push(...act(s, { type: 'placeRailwayStation', city: 'SLC', houseTrack: 'iron' }));
    assert.deepEqual([s.players[0].coins, production(s, 0, 'iron'), s.map.railwayStation.SLC], [1, iron + 1, 0]);
    assert.equal(s.players[0].railheads[0], 'SLC');
  });
  check('E9', 'Displacement', () => {
    const s = game(4);
    for (let i = 0; i < 3; i++) idleTurn(s);
    for (const w of Object.keys(s.grid.spaces)) {
      if (s.grid.spaces[w] !== null) {
        s.players[s.grid.spaces[w]].workersInSupply += 1;
        s.grid.spaces[w] = null;
      }
    }
    put(s, 0, 'W4');
    put(s, 0, 'W6');
    put(s, 1, 'W7');
    put(s, 2, 'W9');
    give(s, 0, { hats: 1, resources: {} });
    give(s, 1, { hats: 2, resources: {} });
    give(s, 2, { hats: 0 });
    give(s, 3, { hats: 1, tiles: { bridge: 2, tunnel: 2 } });
    setHeads(s, 3, 'POR', 'MIN');
    act(s, { type: 'displaceWorker', district: 'D5' });
    assert.deepEqual(s.players.slice(0, 3).map((p) => p.workersInSupply), [3, 3, 3]);
    assert.equal(s.toAct, 0);
    act(s, { type: 'chooseResource', resource: 'iron' });
    assert.deepEqual([s.players[0].hats, s.players[0].resources.iron], [2, 1]);
    assert.equal(s.toAct, 1);
    act(s, { type: 'chooseResource', resource: 'wood' });
    assert.deepEqual([s.players[1].hats, s.players[1].resources.wood], [2, 1]);
    assert.equal(s.players[2].hats, 1);
    assert.equal(s.toAct, 3);
    assert.deepEqual(keys(s), ['chooseDistrict:D5:false', 'chooseDistrict:D5:true'], 'M = 1, or 2 if Lou spends a hat');
    act(s, { type: 'chooseDistrict', district: 'D5', hat: true });
    act(s, { type: 'claimRoute', route: 'POR-SPO', from: 'POR' });
    act(s, { type: 'skipBuilding' });
    assert.equal(kind(s), 'layTracks', 'a second step');
    finishTurn(s);
    // while the worker stays on the centre it counts for D5 and its four neighbours
    idleUntil(s, 3);
    for (const [space, district] of [['W1', 'D2'], ['W3', 'D4'], ['W5', 'D6'], ['W11', 'D8']]) {
      const c = JSON.parse(JSON.stringify(s));
      const ev = placeAndChoose(c, space, district);
      assert.equal(eventOf(ev, 'districtChosen').multiplier, 2, district);
    }
    const far = JSON.parse(JSON.stringify(s));
    assert.equal(eventOf(placeAndChoose(far, 'W12', 'D9'), 'districtChosen').multiplier, 1);
    // when Lou next removes a worker it must be this one, and it gives the D5 action
    put(s, 3, 'W12');
    assert.deepEqual(offers(s, 'removeWorker').map((a) => a.from), ['D5']);
    const ev = act(s, { type: 'removeWorker', from: 'D5' });
    assert.ok(kind(s) === 'layTracks' || kind(s) === 'chooseDistrict' || eventOf(ev, 'districtChosen').district === 'D5');
  });
  check('E10', 'Game end', () => {
    const s = game(4, { endGameScoring: 'goals', modulePonyExpress: true });
    idleTurn(s);
    idleTurn(s);
    assert.equal(s.turn.player, 2);
    if (kind(s) === 'freeActions') act(s, { type: 'endFreeActions' });
    claim(s, 2, 'SEA-HEL', 'HEL-BIS');
    const others = MAP.routeIds.filter((id) => !['SEA-HEL', 'HEL-BIS', 'BIS-MIN'].includes(id)).slice(0, 17);
    claim(s, 0, ...others);
    assert.equal(Object.values(s.map.routeOwner).filter((o) => o !== null).length, 19);
    s.players[2].railheads = ['BIS', s.players[2].railheads[1]];
    give(s, 2, { resources: {}, tiles: { ground: 5 } });
    const ev = placeAndChoose(s, 'W4', 'D5');
    if (offered(s, 'claimRoute', { route: 'BIS-MIN' })) ev.push(...act(s, { type: 'claimRoute', route: 'BIS-MIN', from: 'BIS' }));
    assert.deepEqual(vpBySource(ev, 2), { track: 5, completion: 40 });
    assert.equal(s.players[2].railheads[0], 'MIN');
    assert.notEqual(kind(s), 'placeBuildings');
    assert.equal(s.gameEnd.reason, 'transcontinental');
    if (s.turn.player === 2) finishTurn(s);
    assert.ok(!isGameOver(s));
    assert.equal(s.turn.player, 3, 'seat 4 takes one more turn');
    idleTurn(s);
    assert.ok(isGameOver(s));
    const score = scoreGame(s);
    assert.equal(score.final, true);
    assert.deepEqual(Object.keys(score.players[2].bySource).filter((k) => ['buildingsEnd', 'goals', 'ponyEnd'].includes(k)), ['buildingsEnd', 'goals', 'ponyEnd']);
    assert.equal(score.winner, 2);
  });
}
