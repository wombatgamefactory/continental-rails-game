// smoke.test.mjs - the engine survives whole games: random bots on every
// variant, and a scripted builder that reaches the real ending triggers.
//
// Semantics: exits 1 on any failure. Every figure printed here is also
// asserted on: a number that is printed but never checked is a bug waiting.
//
// Runs:
//   - 600 random-bot games on default variants, 200 each at 2, 3 and 4 players;
//   - 100 random-bot games under EACH non-default value of conversionRate
//     (1:1, iron-in-all) and turnStructure (rounds), the player counts mixed;
//   - a smaller run under each non-default value of every other variant the
//     engine acts on (claimFrom, layTrackClaims, gameEndTrigger, congressTable,
//     specialistActivations, bothBuildingsSameOwner, buildingScoreCurve,
//     scoringCard, endRoutesPerPlayer = 0, and the core-rule variants);
//   - scripted builder games (tests/helpers/builder.mjs) on default variants.
//
// Checked: every game ends by itself, ZERO refused proposals, ZERO harness-cap
// hits, always a real choice (never 0 or exactly 1 legal action), invariants
// (nothing negative, no piece lost or invented, houses plus railway stations
// constant, VP add up by source), and that EVERY action type and EVERY
// district is used at least once across the run: a zero is a plumbing bug.
//
// The four add-on modules (docs/engine-contract.md section 11):
//   - the 600 default games above have every module on at its default (milestones);
//   - 400 more with ALL modules on, goals and milestones both, 2, 3 and 4 players;
//   - 100 with EACH module individually off, which must show no trace of it in the
//     state, the actions, the events or the scoring;
//   - small runs for endGameScoring = goals / both / none, upgradeVpTiming =
//     on-install, ponyOngoingCap = 0, and each of the 20 Legislative Agenda cards fixed;
//   - builder games that play the module decisions (install upgrades, buy cards), one set
//     of them with tokens handed out by hand ("constructed", reported as such);
//   - usage counters over the whole run: every Legislative Agenda card in play, every
//     Pony Express card bought, every upgrade tile installed, every goal and milestone
//     scored at least once. A counter that stays at zero must be named in NOT_REACHED
//     below with its reason (the behaviour is then covered in tests/rules-modules.test.mjs);
//     the list is asserted both ways, so it cannot go stale.
//
// How random games end: a random bot almost never builds the exact tiles a
// route needs, so random games end by the turn limit of R19.4. The report
// gives the split of end reasons. The builder games are what exercise the
// transcontinental line (R19.2, the 25 VP bonus) and the map filling up
// (R19.3) end to end.

import assert from 'node:assert/strict';
import {
  createGame,
  getValidActions,
  applyAction,
  makeRng,
  rngInt,
  rngNext,
  SILENT,
  getBlockReason,
  getConstants,
  isGameOver,
  scoreGame,
  storageUsed,
  storageCapacity,
  housesOnBoard,
  workersOnGrid,
  railwayStationCount,
  telegraphStationCount,
  ownedSlots,
  ACTIONS,
  SPACE_IDS,
  DISTRICT_IDS,
  DISTRICT_ACTION_RULES,
  BONUS_ACTION_TYPES,
  MAP,
  RULES,
  goalsInPlay,
  goalStandings,
  describeAction,
  describeDecision,
  getActionSpace,
  actionKey,
  topFrame,
} from '../src/engine/index.js';
import { playGame, assertPlainJson, makeSuite, HARNESS } from './helpers/play.mjs';
import { makeBuilder } from './helpers/builder.mjs';

const FULL_CHECK_GAMES = 3; // games per run in which every offered action is re-checked after every action
const suite = makeSuite('smoke');

const usage = {}; // action type -> times applied (the player's and the engine's), over the whole run
const taken = {}; // action type -> times chosen by the driver
const districtUse = {}; // district id -> times chosen
const report = [];
const totals = { games: 0, decisions: 0, refusals: 0, capHits: 0, forced: 0 };

function count(table, key, n = 1) {
  table[key] = (table[key] ?? 0) + n;
}

// ---------------------------------------------------------------------------------------------
// The add-on modules
// ---------------------------------------------------------------------------------------------

/** Everything the run counts about the modules. */
const moduleUse = {
  agenda: {}, // Legislative Agenda card id -> games in which it was in force
  bought: {}, // Pony Express card id -> times bought
  installed: {}, // upgrade tile id -> times installed
  milestones: {}, // milestone id -> times claimed
  goals: {}, // goal id -> games in which it paid somebody VP
  goalsInPlay: {}, // goal id -> games in which it was in play
  // The same three counters for games in which tokens were handed out by hand (constructed).
  constructed: { bought: {}, installed: {}, milestones: {} },
  tokens: 0,
  exchanged: 0,
  windows: 0, // free-action opportunities that were asked
  autoEndFree: 0, // opportunities that were left by the engine itself (there was nothing to do): must be 0
  constructedGames: 0, // games in which tokens were handed out by hand
};

/** States in which tokens were handed out by hand: the token count cannot be checked there. */
const constructedStates = new WeakSet();

/** What a module being off must never produce. */
const TRACE = {
  upgrades: {
    key: 'upgrades',
    word: 'upgrade',
    vp: ['upgrades'],
    actions: ['installUpgrade'],
    events: ['upgradeInstalled', 'upgradeStep'],
    causes: ['upgrade:', 'bonus:upgrade'],
    frames: () => false,
  },
  milestones: { key: 'milestones', word: 'milestone', vp: ['milestones'], actions: [], events: ['milestoneClaimed'], causes: [], frames: () => false },
  goals: { key: 'goals', word: 'goal', vp: ['goals'], actions: [], events: [], causes: [], frames: () => false },
  legislative: {
    key: 'legislative',
    word: 'legislative',
    vp: ['legislative'],
    actions: ['declineFreeEntry'],
    events: [],
    causes: ['legislative:'],
    frames: (top) => top.kind === 'freeCongress' && top.stop === 'declineFreeEntry', // (cards 13 and 24 of Pony Express use the same decision)
  },
  pony: {
    key: 'pony',
    word: 'pony',
    vp: ['ponyCards', 'ponyEnd'],
    actions: ['buyPonyCard', 'exchangeToken', 'usePonyCard', 'endFreeActions', 'skipEffect', 'returnResource', 'chooseForemanType', 'chooseSpecialistType', 'chooseExtraActivation'],
    events: ['ponyToken', 'ponyCardBought', 'ponyMarketRefill', 'tokenExchanged', 'ponyCardUsed', 'resourceReturned', 'activationsDoubled'],
    causes: ['pony:'],
    frames: (top) =>
      ['freeActions', 'hireSpecialist', 'chooseForemanType', 'chooseSpecialistType', 'chooseExtraActivation', 'exchange'].includes(top.kind) ||
      (top.kind === 'freeCongress' && top.stop === 'skipEffect') ||
      (top.kind === 'bonusAction' && top.bonus === 'any'),
  },
};
const OFF_VARIANTS = {
  upgrades: { moduleCarriageUpgrades: false },
  milestones: { endGameScoring: 'none' },
  goals: { endGameScoring: 'milestones' }, // goals off, milestones still on
  legislative: { moduleLegislativeAgenda: false },
  pony: { modulePonyExpress: false },
};
/** Every module on, goals and milestones both. */
const ALL_ON_VARIANTS = { endGameScoring: 'both', goalsInPlay: 5, milestonesInPlay: 8 };

/** A module that is off: nothing of it in an event. Returns a list of problems. */
function offEventProblems(off, events) {
  const t = TRACE[off];
  const problems = [];
  for (const e of events) {
    if (t.events.includes(e.type)) problems.push(`event ${e.type}`);
    if (e.type === 'action' && t.actions.includes(e.action.type)) problems.push(`action ${e.action.type}`);
    if (e.type === 'vp' && t.vp.includes(e.source)) problems.push(`vp to ${e.source}`);
    if (typeof e.cause === 'string' && t.causes.some((c) => e.cause.startsWith(c))) problems.push(`cause ${e.cause}`);
  }
  return problems;
}

/** A module that is off leaves no trace in a state: no key, no VP source, no word. */
function assertNoTrace(state, off) {
  const t = TRACE[off];
  assert.ok(!(t.key in state.modules), `${off}: state.modules.${t.key} exists`);
  for (const p of state.players) for (const source of t.vp) assert.ok(!(source in p.vp), `${off}: VP source ${source}`);
  const text = JSON.stringify(state).replace(JSON.stringify(state.variants), '').toLowerCase();
  assert.ok(!text.includes(t.word), `${off}: the word "${t.word}" appears in the state`);
}

/** The cards, tiles and goals of the modules are consistent at every point of a game. */
function checkModuleInvariants(state) {
  const K = getConstants(state);
  const m = state.modules;
  const n = state.players.length;
  if (m.upgrades) {
    const installed = m.upgrades.installed.flat().filter((t) => t !== null);
    const all = [...m.upgrades.display, ...installed];
    assert.equal(all.length, K.UPGRADE_TILES.length, 'upgrade tiles lost or invented');
    assert.equal(new Set(all).size, all.length, 'an upgrade tile is in two places');
    m.upgrades.installed.forEach((slots, pid) => {
      slots.forEach((id, i) => {
        if (id === null) return;
        const tile = K.UPGRADE_TILES.find((t) => t.id === id);
        const carriage = state.players[pid].train.specialistCarriages[i];
        assert.ok(carriage, `a tile in a carriage that does not exist (level ${i + 1})`);
        assert.ok(tile.level <= i + 1, `${id} installed in a level ${i + 1} carriage (R15.3.3)`);
        assert.ok(carriage.slots.some((x) => x !== null), 'a tile in a carriage with no specialist (R15.3.1)');
      });
    });
  }
  if (m.milestones) {
    for (const id of m.milestones.inPlay) {
      const by = m.milestones.claimedBy[id];
      assert.ok(by === null || (by >= 0 && by < n));
    }
    const claimed = Object.values(m.milestones.claimedBy).filter((x) => x !== null).length;
    const vp = state.players.reduce((a, p) => a + p.vp.milestones, 0);
    assert.equal(vp > 0, claimed > 0, 'milestone VP and claims agree');
  }
  if (m.goals) {
    assert.equal(new Set(m.goals.inPlay).size, m.goals.inPlay.length);
    if (!state.modules.upgrades) assert.ok(!m.goals.inPlay.includes('G6'), 'goal 6 is out without upgrades (R3.8.2)');
  }
  if (m.legislative) assert.ok(K.LEGISLATIVE_CARDS.some((c) => c.id === m.legislative.card));
  if (m.pony) {
    const own = m.pony.players.flatMap((p) => [...p.ongoing, ...p.endgame]);
    const everywhere = [...Object.values(m.pony.decks).flat(), ...Object.values(m.pony.market).flat().filter((x) => x !== null), ...own];
    assert.equal(new Set(everywhere).size, everywhere.length, 'a Pony Express card is in two places');
    for (const rank of K.PONY.ranks) {
      m.pony.market[rank].forEach((id) => {
        if (id === null) assert.equal(m.pony.decks[rank].length, 0, 'a market place is empty while its deck is not (R18.5.4)');
      });
    }
    m.pony.players.forEach((p, pid) => {
      assert.ok(p.tokensHeld >= 0 && p.tokensHeld <= p.tokensCollected, `player ${pid}: tokens held ${p.tokensHeld} of ${p.tokensCollected} collected`);
      const cap = state.variants.ponyOngoingCap;
      if (cap > 0) assert.ok(p.ongoing.length <= cap, `player ${pid} holds ${p.ongoing.length} ongoing cards, over the cap ${cap}`);
    });
    if (!constructedStates.has(state)) {
      const left = Object.values(m.pony.tokens).filter(Boolean).length;
      const collected = m.pony.players.reduce((a, p) => a + p.tokensCollected, 0);
      assert.equal(left + collected, MAP.inlandCities.length, 'Pony Express tokens lost or invented');
    }
    assert.ok(m.pony.turn.purchases <= K.PONY.purchasesPerTurn);
  }
}

/** Counts what an applied action's events say about the modules. */
function tallyEvent(e, into = moduleUse) {
  if (e.type === 'ponyCardBought') count(into.bought, e.card);
  else if (e.type === 'upgradeInstalled') count(into.installed, e.tile);
  else if (e.type === 'milestoneClaimed') count(into.milestones, e.milestone);
  else if (e.type === 'ponyToken') moduleUse.tokens += 1;
  else if (e.type === 'tokenExchanged') moduleUse.exchanged += 1;
  else if (e.type === 'action' && e.auto && e.action.type === 'endFreeActions') moduleUse.autoEndFree += 1;
}

/** At the end of a game: which agenda card was in force, which goals were in play and paid. */
function tallyGame(state) {
  if (state.modules.legislative) count(moduleUse.agenda, state.modules.legislative.card);
  if (state.modules.goals) {
    for (const goal of goalsInPlay(state)) {
      count(moduleUse.goalsInPlay, goal.id);
      if (goalStandings(state, goal).awards.some((a) => a > 0)) count(moduleUse.goals, goal.id);
    }
  }
}

function checkInvariants(state) {
  checkModuleInvariants(state);
  const K = getConstants(state);
  const n = state.players.length;
  const hired = {};
  for (const type of K.SPECIALIST_TYPES) hired[type] = 0;
  let workersOut = 0;
  for (const p of state.players) {
    assert.ok(p.coins >= 0, `${p.name} has ${p.coins} Coins`);
    assert.ok(p.hats >= 0 && p.hats <= K.HATS.hatLimit, `${p.name} holds ${p.hats} hats`);
    for (const r of K.RESOURCES) assert.ok(p.resources[r] >= 0, `${p.name} has ${p.resources[r]} ${r}`);
    for (const t of K.TERRAINS) assert.ok(p.builtTiles[t] >= 0, `${p.name} has ${p.builtTiles[t]} built ${t}`);
    assert.ok(p.workersInSupply >= 0, `${p.name} has ${p.workersInSupply} workers in supply`);
    const grid = workersOnGrid(state, p.id);
    const onGrid = grid.spaces.length + grid.centres.length;
    workersOut += onGrid;
    assert.equal(p.workersInSupply + onGrid, K.SETUP.workersByPlayerCount[n], `${p.name}: workers lost or invented`);
    // R8.5.4: a player is over capacity only while they are being asked to discard.
    const mustDiscard = state.stack.some((f) => f.kind === 'discard' && f.player === p.id);
    if (!mustDiscard) {
      assert.ok(storageUsed(p) <= storageCapacity(state, p.id), `${p.name} is over capacity with no discard pending`);
    }
    assert.ok(p.train.specialistCarriages.length <= K.TRAIN.maxSpecialistCarriages);
    assert.ok(p.train.storageCarriages <= K.TRAIN.maxStorageCarriages);
    for (const carriage of p.train.specialistCarriages) {
      let seenEmpty = false;
      for (const s of carriage.slots) {
        if (s === null) seenEmpty = true;
        else {
          assert.ok(!seenEmpty, `${p.name}: a specialist sits after an empty slot (R8.6.1)`);
          hired[s] += 1;
        }
      }
    }
    if (state.phase !== 'setup') {
      // R13.2: a house on the map is a railway station, and no longer on the board.
      assert.equal(housesOnBoard(p) + railwayStationCount(state, p.id), K.PLAYER_BOARD.houses, `${p.name}: houses on the board plus railway stations`);
      assert.equal(p.telegraphsPlaced, telegraphStationCount(state, p.id), `${p.name}: telegraph stations placed`);
      assert.ok(p.telegraphsPlaced <= K.PLAYER_BOARD.telegraphStations);
      for (const track of K.PLAYER_BOARD.houseTracks) assert.ok(p.houses[track] >= 0 && p.houses[track] <= K.PLAYER_BOARD.houseSlotsPerTrack);
      for (const city of p.railheads) assert.ok(MAP.cityById[city], `${p.name}: a railhead on an unknown city`);
    }
  }
  for (const type of K.SPECIALIST_TYPES) {
    assert.equal(hired[type] + state.supply.specialists[type], K.TRAIN.specialistsPerType, `${type} tiles lost or invented`);
  }
  assert.ok(workersOut <= SPACE_IDS.length + DISTRICT_IDS.length);
  if (!isGameOver(state)) {
    assert.ok(state.toAct !== null && state.toAct >= 0 && state.toAct < n, 'toAct must name a player');
    assert.equal(state.stack[state.stack.length - 1].player, state.toAct, 'toAct must be the player of the pending decision');
  }
}

/** The checks on a finished game. */
function checkEnded(state, players, label) {
  assert.equal(isGameOver(state), true);
  assert.equal(state.toAct, null);
  assert.deepEqual(state.stack, []);
  checkInvariants(state);
  assertPlainJson(state);
  const K = getConstants(state);
  assert.ok(K.END_REASONS.includes(state.gameEnd.reason), `unknown end reason ${state.gameEnd.reason}`);
  const turns = state.players.map((p) => p.turnsTaken);
  if (state.variants.turnStructure === 'continuous') {
    // R19.5 - everybody has had the same number of turns.
    assert.ok(turns.every((t) => t === turns[0]), `unequal turns: ${turns.join(', ')}`);
    assert.ok(turns[0] <= state.variants.maxTurnsPerPlayer, 'the turn limit of R19.4 was overrun');
  } else {
    assert.ok(turns.every((t) => t >= 1), 'with rounds every player took at least one turn');
  }
  // R19.2 - one completion per game, and it is why the game ended if that was its reason.
  if (state.gameEnd.reason === 'transcontinental') assert.notEqual(state.completion, null, 'a transcontinental end needs a completion');
  const completions = state.players.filter((p) => p.vp.completion > 0);
  assert.equal(completions.length, state.completion === null ? 0 : 1, 'the transcontinental bonus is paid once per game');
  if (state.completion !== null) {
    const route = MAP.routeById[state.completion.route];
    assert.equal(
      state.players[state.completion.player].vp.completion,
      K.SCORING.completionVp + K.SCORING.completionVpPerSlot * route.length,
      'R19.2: 25 + 3 per slot of the route just claimed',
    );
  }
  const score = scoreGame(state);
  assert.equal(score.final, true);
  assert.equal(score.players.length, players);
  for (const p of score.players) {
    assert.ok(Number.isInteger(p.total) && p.total >= 0, `${label}: score of ${p.name} is ${p.total}`);
    const sum = Object.values(p.bySource).reduce((a, b) => a + b, 0);
    assert.equal(sum, p.total, 'VP by source must add up to the total');
  }
  // R20.2.1 - the buildings table, from the buildings on the map.
  for (const p of state.players) assert.ok(ownedSlots(state, p.id) >= 0);
  assert.deepEqual(score.ranking.slice().sort(), state.players.map((p) => p.id), 'ranking must list every player once');
  assert.equal(score.winner, score.ranking[0]);
}

/** Plays `games` random-bot games and folds the results into the shared tallies. Returns the run's own summary. */
function randomRun(label, variants, playerCounts, games, seedBase, options = {}) {
  const run = { label, games: 0, decisions: 0, forced: 0, refusals: 0, capHits: 0, turns: 0, reasons: {}, byCount: {}, routes: 0, ms: 0, windows: 0 };
  const off = options.off ?? null; // a module that must leave no trace
  const offProblems = [];
  for (let g = 0; g < games; g++) {
    const players = playerCounts[g % playerCounts.length];
    const config = { playerCount: players, seed: `${seedBase}-${players}-${g}`, variants };
    const full = g < FULL_CHECK_GAMES;
    let seen = 0; // decisions seen in this game
    const started = performance.now();
    const result = playGame(config, {
      events: true,
      onDecision(state, actions) {
        seen += 1;
        if (actions.length < 2) {
          throw new Error(`${label}: a pending decision offered ${actions.length} action(s); a forced action must be applied by the engine`);
        }
        const top = topFrame(state);
        if (top.kind === 'freeActions') {
          run.windows += 1;
          moduleUse.windows += 1;
        }
        if (off !== null && TRACE[off].frames(top)) offProblems.push(`decision ${top.kind}`);
        if (full) {
          for (const action of actions) {
            assert.equal(getBlockReason(state, action), null, `offered action is blocked: ${JSON.stringify(action)}`);
            const text = describeAction(state, action);
            assert.ok(typeof text === 'string' && text.length > 3 && !/undefined|\[object|NaN|null/.test(text), `describeAction: "${text}" for ${actionKey(action)}`);
          }
          const prompt = describeDecision(state).prompt;
          assert.ok(!/undefined|\[object|NaN|null/.test(prompt), `describeDecision: "${prompt}"`);
          // The list is exactly the actions whose block reason is null (contract section 6), also with the modules.
          if (seen % 12 === 0 || top.kind !== 'workerStep') {
            const listed = actions.map(actionKey).sort();
            const legal = getActionSpace(state)
              .filter((a) => getBlockReason(state, a) === null)
              .map(actionKey)
              .sort();
            assert.deepEqual(listed, legal, `decision "${top.kind}": the list and the block reasons disagree`);
          }
        }
      },
      onApplied(state, action, events) {
        count(taken, action.type);
        for (const e of events) {
          if (e.type === 'action') {
            count(usage, e.action.type);
            if (e.auto) run.forced += 1;
          } else if (e.type === 'districtChosen' && e.district !== 'none') {
            count(districtUse, e.district);
          }
          tallyEvent(e);
        }
        if (off !== null) offProblems.push(...offEventProblems(off, events));
        if (full) checkInvariants(state);
      },
    });
    run.ms += performance.now() - started;
    const { state } = result;
    tallyGame(state);
    suite.check(`${label}: ${players}p game ${g} ends by itself with zero refusals`, () => {
      assert.deepEqual(result.refusals, [], 'the engine refused a proposal taken from getValidActions');
      assert.equal(result.capHit, false, `possible non-termination: ${HARNESS.maxDecisionsPerGame} decisions without an end`);
      checkEnded(state, players, label);
      if (off !== null) {
        assert.deepEqual([...new Set(offProblems)], [], `${label}: module "${off}" is off but left a trace`);
        assertNoTrace(state, off);
      }
    });
    run.games += 1;
    run.decisions += result.decisions;
    run.refusals += result.refusals.length;
    run.capHits += result.capHit ? 1 : 0;
    run.turns += state.turn.number;
    run.routes += Object.values(state.map.routeOwner).filter((o) => o !== null).length;
    const reason = state.gameEnd ? state.gameEnd.reason : 'none';
    run.reasons[reason] = (run.reasons[reason] ?? 0) + 1;
    const c = (run.byCount[players] ??= { games: 0, reasons: {} });
    c.games += 1;
    c.reasons[reason] = (c.reasons[reason] ?? 0) + 1;
  }
  totals.games += run.games;
  totals.decisions += run.decisions;
  totals.refusals += run.refusals;
  totals.capHits += run.capHits;
  totals.forced += run.forced;
  return run;
}

function describeRun(run) {
  const per = Object.entries(run.byCount)
    .map(([n, c]) => `${n}p ${JSON.stringify(c.reasons)}`)
    .join('; ');
  return (
    `  ${run.label}: ${run.games} games, refusals ${run.refusals}, harness-cap hits ${run.capHits}, ` +
    `avg decisions ${(run.decisions / run.games).toFixed(0)} (+${(run.forced / run.games).toFixed(0)} forced), ` +
    `avg turns ${(run.turns / run.games).toFixed(0)}, avg routes claimed ${(run.routes / run.games).toFixed(1)}, ` +
    `${run.windows > 0 ? `free-action opportunities ${(run.windows / run.games).toFixed(1)} per game, ` : ''}` +
    `end reasons ${per}, ${(run.games / (run.ms / 1000)).toFixed(0)} games/s (with events and checks)`
  );
}

// -----------------------------------------------------------------------------
// 1. Default variants: 200 games at each of 2, 3 and 4 players
// -----------------------------------------------------------------------------

const defaultRuns = [];
for (const players of [2, 3, 4]) {
  const run = randomRun(`default ${players}p`, {}, [players], 200, `smoke-${players}`);
  defaultRuns.push(run);
  report.push(describeRun(run));
}

// -----------------------------------------------------------------------------
// 2. 100 games under each non-default value of conversionRate and turnStructure
// -----------------------------------------------------------------------------

const bigVariantRuns = [
  ['conversionRate=1:1', { conversionRate: '1:1' }],
  ['conversionRate=iron-in-all', { conversionRate: 'iron-in-all' }],
  ['turnStructure=rounds', { turnStructure: 'rounds' }],
];
for (const [label, variants] of bigVariantRuns) {
  const run = randomRun(label, variants, [2, 3, 4], 100, `smoke-${label}`);
  report.push(describeRun(run));
}

// -----------------------------------------------------------------------------
// 3. A smaller run under each non-default value of the other variants
// -----------------------------------------------------------------------------

const smallVariantRuns = [
  ['claimFrom=network', { claimFrom: 'network' }],
  ['layTrackClaims=per-railhead', { layTrackClaims: 'per-railhead' }],
  ['network+per-railhead', { claimFrom: 'network', layTrackClaims: 'per-railhead' }],
  ['gameEndTrigger=any-crossing', { gameEndTrigger: 'any-crossing' }],
  ['congressTable=jan-2026', { congressTable: 'jan-2026' }],
  ['specialistActivations=once', { specialistActivations: 'once' }],
  ['bothBuildingsSameOwner=false', { bothBuildingsSameOwner: false }],
  ['buildingScoreCurve=2018', { buildingScoreCurve: '2018' }],
  ['scoringCard=random', { scoringCard: 'random' }],
  ['scoringCard=ground', { scoringCard: 'ground' }],
  ['scoringCard=tunnel', { scoringCard: 'tunnel' }],
  ['scoringCard=bridge', { scoringCard: 'bridge' }],
  ['endRoutesPerPlayer=0', { endRoutesPerPlayer: 0 }],
  ['startCompensation=none', { startCompensation: 'none' }],
  ['gridLayout=shuffle-resources', { gridLayout: 'shuffle-resources' }],
  ['bonusActionLimit=once-per-game', { bonusActionLimit: 'once-per-game' }],
  ['bonusActionLimit=multiplied', { bonusActionLimit: 'multiplied' }],
  ['hireCostModel=fee-only', { hireCostModel: 'fee-only' }],
  ['hireCostModel=table-only', { hireCostModel: 'table-only' }],
];
for (const [label, variants] of smallVariantRuns) {
  const run = randomRun(label, variants, [2, 3, 4], 30, `smoke-${label}`);
  report.push(describeRun(run));
}

// -----------------------------------------------------------------------------
// 3b. The add-on modules
// -----------------------------------------------------------------------------

const moduleRuns = {};
// 400 games with every module on, goals and milestones both.
moduleRuns.allOn = randomRun('all modules on', ALL_ON_VARIANTS, [2, 3, 4], 400, 'smoke-all-on');
report.push(describeRun(moduleRuns.allOn));
// 100 games with each module individually off (the others on).
for (const off of Object.keys(OFF_VARIANTS)) {
  const variants = { ...ALL_ON_VARIANTS, ...OFF_VARIANTS[off] };
  if (off === 'goals') variants.endGameScoring = 'milestones';
  // (the seed text must not contain the module's name: the state keeps the seed)
  const run = randomRun(`${off} off`, variants, [2, 3, 4], 100, `smoke-module-off-${Object.keys(OFF_VARIANTS).indexOf(off)}`, { off });
  moduleRuns[`off-${off}`] = run;
  report.push(describeRun(run));
}
// Small runs for the module variants.
const moduleVariantRuns = [
  ['endGameScoring=goals', { endGameScoring: 'goals', goalsInPlay: 12 }],
  ['endGameScoring=both', { endGameScoring: 'both', goalsInPlay: 12, milestonesInPlay: 10 }],
  ['endGameScoring=none', { endGameScoring: 'none' }],
  ['upgradeVpTiming=on-install', { upgradeVpTiming: 'on-install' }],
  ['ponyOngoingCap=0', { ponyOngoingCap: 0 }],
  ['turnStructure=rounds + modules', { turnStructure: 'rounds', endGameScoring: 'both' }],
  ['claimFrom=network + modules', { claimFrom: 'network', endGameScoring: 'both' }],
  ['bothBuildingsSameOwner=false + modules', { bothBuildingsSameOwner: false, endGameScoring: 'both' }],
];
for (const [label, variants] of moduleVariantRuns) {
  const run = randomRun(label, variants, [2, 3, 4], 30, `smoke-${label}`);
  report.push(describeRun(run));
}
// Each of the 17 Legislative Agenda cards fixed, a few games each (7, so that the 119 games match the 120 of the
// 20-card deck before spec v4 retired cards 1 to 3).
const agendaRuns = [];
for (const card of RULES.LEGISLATIVE_CARDS) {
  const run = randomRun(`agenda card ${card.number}`, { legislativeAgendaCard: card.number, endGameScoring: 'both' }, [2, 3, 4], 7, `smoke-agenda-${card.number}`);
  agendaRuns.push(run);
}
report.push(
  `  Legislative Agenda, each card fixed: ${agendaRuns.reduce((a, r) => a + r.games, 0)} games, refusals ${agendaRuns.reduce((a, r) => a + r.refusals, 0)}, harness-cap hits ${agendaRuns.reduce((a, r) => a + r.capHits, 0)}`,
);

// -----------------------------------------------------------------------------
// 4. The builder: both ending triggers and the 25 VP bonus, end to end
// -----------------------------------------------------------------------------

const builderRuns = {};
for (const mode of ['line', 'sprawl']) {
  const run = { mode, games: 0, reasons: {}, completions: 0, refusals: 0, capHits: 0, decisions: 0, routes: 0 };
  for (const players of [2, 3, 4]) {
    for (let g = 0; g < 12; g++) {
      const state = createGame({ playerCount: players, seed: `builder-${mode}-${players}-${g}` });
      const rng = makeRng(`builder-bots-${mode}-${players}-${g}`);
      const choose = makeBuilder(mode);
      let decisions = 0;
      let refused = null;
      while (!isGameOver(state) && decisions < HARNESS.maxDecisionsPerGame) {
        const actions = getValidActions(state);
        assert.ok(actions.length >= 2, 'a forced action must be applied by the engine');
        const action = choose(state, actions, () => rngNext(rng));
        count(taken, action.type);
        try {
          applyAction(state, action, SILENT);
        } catch (err) {
          refused = err;
          break;
        }
        decisions += 1;
        if (decisions % 40 === 0) checkInvariants(state);
      }
      suite.check(`builder ${mode} ${players}p game ${g}: ends by itself, nothing refused`, () => {
        assert.equal(refused, null, refused ? refused.message : '');
        assert.ok(decisions < HARNESS.maxDecisionsPerGame, 'harness cap hit');
        checkEnded(state, players, `builder ${mode}`);
      });
      run.games += 1;
      run.decisions += decisions;
      run.refusals += refused ? 1 : 0;
      run.capHits += decisions >= HARNESS.maxDecisionsPerGame ? 1 : 0;
      run.reasons[state.gameEnd.reason] = (run.reasons[state.gameEnd.reason] ?? 0) + 1;
      run.completions += state.completion === null ? 0 : 1;
      run.routes += Object.values(state.map.routeOwner).filter((o) => o !== null).length;
      // Usage from the final state, for the tallies that need events: districts the builder reached are counted by the random runs.
    }
  }
  builderRuns[mode] = run;
  totals.refusals += run.refusals;
  totals.capHits += run.capHits;
  report.push(
    `  builder ${mode}: ${run.games} games, refusals ${run.refusals}, cap hits ${run.capHits}, avg decisions ${(run.decisions / run.games).toFixed(0)}, ` +
      `avg routes claimed ${(run.routes / run.games).toFixed(1)}, end reasons ${JSON.stringify(run.reasons)}, completions ${run.completions}`,
  );
}

// -----------------------------------------------------------------------------
// 5. Builder games that play the module decisions (install, buy), events collected
// -----------------------------------------------------------------------------

/**
 * Plays builder games with every module on. With `inject`, a player at a free-action
 * opportunity who holds fewer than 8 tokens is handed tokens up to 8 (held AND collected),
 * so that the dearest cards can be bought: those games are CONSTRUCTED (tokens come from
 * nowhere) and are reported as such.
 */
function builderModuleRun(label, modes, games, seedBase, inject) {
  const run = { label, games: 0, decisions: 0, refusals: 0, capHits: 0, reasons: {} };
  for (const mode of modes) {
    for (const players of [2, 3, 4]) {
      for (let g = 0; g < games; g++) {
        const state = createGame({ playerCount: players, seed: `${seedBase}-${mode}-${players}-${g}`, variants: { ...ALL_ON_VARIANTS, goalsInPlay: 12, milestonesInPlay: 10 } });
        const rng = makeRng(`${seedBase}-bots-${mode}-${players}-${g}`);
        const choose = makeBuilder(mode);
        let decisions = 0;
        let refused = null;
        let handedOut = false;
        while (!isGameOver(state) && decisions < HARNESS.maxDecisionsPerGame) {
          if (inject) {
            const top = topFrame(state);
            if (top.kind === 'freeActions') {
              const mine = state.modules.pony.players[top.player];
              if (mine.tokensHeld < 8) {
                mine.tokensCollected += 8 - mine.tokensHeld;
                mine.tokensHeld = 8;
                handedOut = true;
                constructedStates.add(state);
              }
            }
          }
          const actions = getValidActions(state);
          assert.ok(actions.length >= 2, 'a forced action must be applied by the engine');
          const action = choose(state, actions, () => rngNext(rng));
          count(taken, action.type);
          try {
            const events = applyAction(state, action);
            for (const e of events) {
              tallyEvent(e, inject ? moduleUse.constructed : moduleUse);
              if (e.type === 'action') count(usage, e.action.type);
            }
          } catch (err) {
            refused = err;
            break;
          }
          decisions += 1;
          if (decisions % 50 === 0) checkInvariants(state);
        }
        if (handedOut) moduleUse.constructedGames += 1;
        tallyGame(state);
        suite.check(`${label} ${mode} ${players}p game ${g}: ends by itself, nothing refused`, () => {
          assert.equal(refused, null, refused ? refused.message : '');
          assert.ok(decisions < HARNESS.maxDecisionsPerGame, 'harness cap hit');
          checkEnded(state, players, label);
        });
        run.games += 1;
        run.decisions += decisions;
        run.refusals += refused ? 1 : 0;
        run.capHits += decisions >= HARNESS.maxDecisionsPerGame ? 1 : 0;
        run.reasons[state.gameEnd.reason] = (run.reasons[state.gameEnd.reason] ?? 0) + 1;
      }
    }
  }
  totals.games += run.games;
  totals.refusals += run.refusals;
  totals.capHits += run.capHits;
  report.push(
    `  ${label}: ${run.games} games, refusals ${run.refusals}, cap hits ${run.capHits}, avg decisions ${(run.decisions / run.games).toFixed(0)}, end reasons ${JSON.stringify(run.reasons)}`,
  );
  return run;
}
const builderPlain = builderModuleRun('builder with modules', ['line', 'sprawl'], 20, 'bm', false);
const builderTokens = builderModuleRun('builder with modules and tokens handed out (constructed)', ['line', 'sprawl'], 14, 'bt', true);

// -----------------------------------------------------------------------------
// 6. Off means absent: the core is unaffected
// -----------------------------------------------------------------------------

const CORE_ACTIONS = Object.keys(ACTIONS).filter(
  (t) => !['installUpgrade', 'buyPonyCard', 'exchangeToken', 'usePonyCard', 'endFreeActions', 'skipEffect', 'returnResource', 'chooseForemanType', 'chooseSpecialistType', 'chooseExtraActivation', 'declineFreeEntry'].includes(t),
);

/** Plays a game choosing among CORE actions only, by a fixed random stream; a decision with only module actions takes a stop action. */
function coreOnlyGame(variants, seed, players) {
  const state = createGame({ playerCount: players, seed, variants });
  const rng = makeRng(`core-only-${seed}`);
  let guard = 0;
  while (!isGameOver(state) && guard++ < HARNESS.maxDecisionsPerGame) {
    const actions = getValidActions(state);
    const core = actions.filter((a) => CORE_ACTIONS.includes(a.type));
    let action;
    if (core.length === 0) action = actions.find((a) => ACTIONS[a.type].stop) ?? actions[0];
    else if (core.length === 1) action = core[0];
    else action = core[rngInt(rng, core.length)];
    applyAction(state, action, SILENT);
  }
  return state;
}

/** The parts of a state that the core rules own, for comparing two games. */
function coreView(state) {
  return {
    turn: state.turn.number,
    end: state.gameEnd ? state.gameEnd.reason : null,
    grid: state.grid,
    scoringCard: state.scoringCard,
    map: state.map,
    congress: state.congress,
    supply: state.supply,
    players: state.players.map((p) => ({
      coins: p.coins,
      hats: p.hats,
      resources: p.resources,
      builtTiles: p.builtTiles,
      houses: p.houses,
      workersInSupply: p.workersInSupply,
      railheads: p.railheads,
      train: p.train,
      turnsTaken: p.turnsTaken,
      telegraphsPlaced: p.telegraphsPlaced,
      vp: Object.fromEntries(Object.entries(p.vp).filter(([k]) => RULES.VP_SOURCES.find((x) => x.id === k).module === null)),
    })),
  };
}

for (const [module, on] of [
  ['upgrades', { moduleCarriageUpgrades: true }],
  ['milestones and goals', { endGameScoring: 'both', goalsInPlay: 6 }],
  ['pony', { modulePonyExpress: true }],
]) {
  suite.check(`off means absent: with ${module} on or off, the same core choices give the same core game`, () => {
    const allOff = { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false };
    for (const players of [2, 3, 4]) {
      for (let g = 0; g < 3; g++) {
        const seed = `core-${module}-${players}-${g}`;
        const without = coreOnlyGame(allOff, seed, players);
        const withModule = coreOnlyGame({ ...allOff, ...on }, seed, players);
        assert.equal(isGameOver(without), true);
        assert.deepEqual(coreView(withModule), coreView(without), `${module}: the core game differs (${players}p game ${g})`);
      }
    }
  });
}

suite.check('off means absent: a game created with a module on draws the same seats, grid and scoring card as with it off', () => {
  const allOff = { moduleCarriageUpgrades: false, endGameScoring: 'none', moduleLegislativeAgenda: false, modulePonyExpress: false };
  for (let seed = 0; seed < 10; seed++) {
    const a = createGame({ playerCount: 4, seed, variants: { ...allOff, scoringCard: 'random', gridLayout: 'shuffle-resources' } });
    const b = createGame({ playerCount: 4, seed, variants: { ...ALL_ON_VARIANTS, scoringCard: 'random', gridLayout: 'shuffle-resources' } });
    assert.deepEqual(b.players.map((p) => p.configIndex), a.players.map((p) => p.configIndex));
    assert.deepEqual(b.grid, a.grid);
    assert.equal(b.scoringCard, a.scoringCard);
    assert.deepEqual(Object.keys(a.modules), []);
    assert.deepEqual(Object.keys(b.modules), ['upgrades', 'milestones', 'goals', 'legislative', 'pony']);
  }
});

// -----------------------------------------------------------------------------
// Assertions over the whole run
// -----------------------------------------------------------------------------

suite.check('zero refusals over the whole run', () => assert.equal(totals.refusals, 0));
suite.check('zero harness-cap hits over the whole run', () => assert.equal(totals.capHits, 0));
suite.check('600 random games on default variants, 200 at each player count', () => {
  assert.deepEqual(defaultRuns.map((r) => r.games), [200, 200, 200]);
});

// A zero here is a plumbing bug: an action that exists but is never offered.
suite.check('every action type was applied at least once', () => {
  const unused = Object.keys(ACTIONS).filter((type) => !usage[type]);
  assert.deepEqual(unused, [], `never applied in ${totals.games} games: ${unused.join(', ')}`);
});

suite.check('every action type was chosen by a driver at least once, apart from the ones the engine takes on its own', () => {
  const unchosen = Object.keys(ACTIONS).filter((type) => !taken[type]);
  // Stop actions are often forced and so applied by the engine; any other action never chosen is a plumbing bug.
  const suspicious = unchosen.filter((type) => ACTIONS[type].stop !== true);
  assert.deepEqual(suspicious, [], `never chosen by a driver: ${suspicious.join(', ')}`);
});

suite.check('every district was chosen at least once', () => {
  const unused = DISTRICT_IDS.filter((d) => !districtUse[d]);
  assert.deepEqual(unused, [], `never chosen: ${unused.join(', ')}`);
});

suite.check('every district family and every bonus action is implemented', () => {
  assert.deepEqual(Object.keys(DISTRICT_ACTION_RULES).sort(), ['gather', 'layTracks', 'trainActivation']);
  assert.ok(Object.keys(BONUS_ACTION_TYPES).length > 0);
});

// Where random games end. Honest reporting: nearly all end by the turn limit.
const randomEnds = defaultRuns.reduce((acc, r) => {
  for (const [reason, n] of Object.entries(r.reasons)) acc[reason] = (acc[reason] ?? 0) + n;
  return acc;
}, {});
suite.check('every random game ended by a reason of R19 (the share by each is reported)', () => {
  assert.equal(Object.values(randomEnds).reduce((a, b) => a + b, 0), 600);
  for (const reason of Object.keys(randomEnds)) assert.ok(getConstants(createGame({ playerCount: 2, seed: 1 })).END_REASONS.includes(reason));
});

// Random bots rarely end a game by a crossing or the map filling up, so the
// builder is what covers those rules in whole games.
suite.check('the builder ends games by a transcontinental line AND by the map filling up, and the bonus is paid', () => {
  const all = Object.values(builderRuns);
  const crossing = all.reduce((a, r) => a + (r.reasons.transcontinental ?? 0), 0);
  const filled = all.reduce((a, r) => a + (r.reasons['routes-claimed'] ?? 0), 0);
  assert.ok(crossing >= 10, `only ${crossing} builder games ended by a transcontinental line`);
  assert.ok(filled >= 10, `only ${filled} builder games ended by the map filling up`);
  const completions = all.reduce((a, r) => a + r.completions, 0);
  assert.ok(completions >= crossing, 'every transcontinental end paid the 25 VP bonus');
});

// Usage counters of the modules. A zero must be NAMED here with its reason; the list is asserted both ways.
//
// Three levels, all in WHOLE games: reached by the bots and the builder as they play; reached
// only in the builder games in which tokens were handed out by hand (ONLY_WITH_TOKENS_HANDED_OUT,
// "constructed"); not reached at all (NOT_REACHED). The behaviour of every item is also covered
// by a constructed STATE in tests/rules-modules.test.mjs.
const NOT_REACHED = {
  // item id -> why whole games do not reach it
};
const ONLY_WITH_TOKENS_HANDED_OUT = Object.fromEntries(
  // A rank C card costs 5 tokens, and a player must hold them all at once. The 17 tokens of the map are shared by 2 to 4
  // players and the bots spend them on cheaper cards as they collect them, so in games as played nobody gets to 5.
  [
    ...RULES.PONY_CARDS.filter((c) => c.rank === 'C').map((c) => [c.id, 'rank C costs 5 tokens held at once; games as played do not collect that many in one hand']),
    // Rank B cards are bought 0 to 8 times each in these runs. Double Time was bought twice before spec v4 (scoring card
    // drawn every game) moved the random stream, and not at all after. Chance, not a rule: remove this line when it is bought again.
    ['PX22', 'rank B, bought 0 to 2 times in the random runs; 0 since spec v4 moved the random stream'],
  ],
);
const COUNTED = {
  'Legislative Agenda card in force': [RULES.LEGISLATIVE_CARDS.map((c) => c.id), moduleUse.agenda, {}],
  'Pony Express card bought': [RULES.PONY_CARDS.map((c) => c.id), moduleUse.bought, moduleUse.constructed.bought],
  'upgrade tile installed': [RULES.UPGRADE_TILES.map((t) => t.id), moduleUse.installed, moduleUse.constructed.installed],
  'milestone claimed': [RULES.MILESTONE_TILES.map((t) => t.id), moduleUse.milestones, moduleUse.constructed.milestones],
  'goal paid VP': [RULES.GOAL_CARDS.map((g) => g.id), moduleUse.goals, {}],
};
for (const [what, [ids, natural, constructed]] of Object.entries(COUNTED)) {
  suite.check(`usage: every ${what} at least once across the run (or named in NOT_REACHED / ONLY_WITH_TOKENS_HANDED_OUT)`, () => {
    const never = ids.filter((id) => !natural[id] && !constructed[id]);
    const onlyConstructed = ids.filter((id) => !natural[id] && constructed[id]);
    const unexplained = never.filter((id) => !(id in NOT_REACHED));
    assert.deepEqual(unexplained, [], `never reached in whole games, with no explanation: ${unexplained.join(', ')}`);
    const unexplainedC = onlyConstructed.filter((id) => !(id in ONLY_WITH_TOKENS_HANDED_OUT));
    assert.deepEqual(unexplainedC, [], `reached only in games with tokens handed out, with no explanation: ${unexplainedC.join(', ')}`);
    const stale = [
      ...Object.keys(NOT_REACHED).filter((id) => ids.includes(id) && (natural[id] || constructed[id])),
      ...Object.keys(ONLY_WITH_TOKENS_HANDED_OUT).filter((id) => ids.includes(id) && natural[id]),
    ];
    assert.deepEqual(stale, [], `listed as not reached / constructed-only but reached after all: ${stale.join(', ')}`);
  });
}
suite.check('usage: a free-action opportunity is never left by the engine for lack of anything to do, and tokens were collected and spent', () => {
  assert.equal(moduleUse.autoEndFree, 0, 'a free-action opportunity with nothing in it was asked');
  assert.ok(moduleUse.windows > 100, `only ${moduleUse.windows} opportunities were asked`);
  assert.ok(moduleUse.tokens > 100, `only ${moduleUse.tokens} tokens were collected`);
  assert.ok(moduleUse.exchanged > 10);
});
suite.check('every Legislative Agenda card is in force in at least one fixed-card run, each with zero refusals', () => {
  for (const run of agendaRuns) assert.deepEqual([run.refusals, run.capHits], [0, 0], run.label);
  for (const card of RULES.LEGISLATIVE_CARDS) assert.ok(moduleUse.agenda[card.id] >= 6, `${card.id} fixed in 6 games`);
});
suite.check('the module runs are the sizes the acceptance asks for', () => {
  assert.equal(moduleRuns.allOn.games, 400);
  for (const off of Object.keys(OFF_VARIANTS)) assert.equal(moduleRuns[`off-${off}`].games, 100);
});

// Speed of a bare random playout: the loop a simulator or a Monte Carlo
// rollout runs (list, pick, apply, no events, no checks). The figure is for
// the report; the assertion is only a floor that catches a collapse.
const speed = [];
for (const players of [2, 3, 4]) {
  const games = 100;
  const rng = makeRng(`speed-${players}`);
  let decisions = 0;
  let turns = 0;
  const started = performance.now();
  for (let g = 0; g < games; g++) {
    const state = createGame({ playerCount: players, seed: `speed-${players}-${g}` });
    while (!isGameOver(state)) {
      const actions = getValidActions(state);
      applyAction(state, actions[rngInt(rng, actions.length)], SILENT);
      decisions += 1;
    }
    turns += state.turn.number;
  }
  const seconds = (performance.now() - started) / 1000;
  speed.push({ players, gamesPerSecond: games / seconds, decisionsPerSecond: decisions / seconds, decisionsPerGame: decisions / games, turnsPerGame: turns / games });
}
suite.check('random playouts run at a usable speed', () => {
  for (const s of speed) assert.ok(s.decisionsPerSecond > 20000, `${s.players}p: only ${s.decisionsPerSecond.toFixed(0)} decisions per second`);
});

for (const line of report) process.stdout.write(`${line}\n`);
process.stdout.write(
  `  bare random playouts: ${speed.map((s) => `${s.players}p ${s.gamesPerSecond.toFixed(0)} games/s (${(s.decisionsPerSecond / 1000).toFixed(0)}k decisions/s, ${s.decisionsPerGame.toFixed(0)} decisions and ${s.turnsPerGame.toFixed(0)} turns per game)`).join(', ')}\n`,
);
process.stdout.write(`  forced actions applied by the engine: ${totals.forced} against ${totals.decisions} decisions taken by the driver\n`);
process.stdout.write(
  `  forced share of all applied actions: ${((100 * totals.forced) / (totals.forced + totals.decisions)).toFixed(1)}% (before the modules: 30.8%)\n`,
);
{
  const line = (what, [ids, natural, constructed]) =>
    `${what}: ${ids.filter((id) => natural[id]).length}/${ids.length} in games as played` +
    `${ids.some((id) => !natural[id] && constructed[id]) ? `, only with tokens handed out: ${ids.filter((id) => !natural[id] && constructed[id]).join(', ')}` : ''}` +
    `${ids.some((id) => !natural[id] && !constructed[id]) ? `, NEVER: ${ids.filter((id) => !natural[id] && !constructed[id]).join(', ')}` : ''}`;
  process.stdout.write(`  usage counters: ${Object.entries(COUNTED).map(([w, v]) => line(w, v)).join('; ')}\n`);
  process.stdout.write(
    `  module play: ${moduleUse.windows} free-action opportunities asked, ${moduleUse.autoEndFree} left by the engine, ${moduleUse.tokens} tokens collected, ${moduleUse.exchanged} exchanged, ${moduleUse.constructedGames} constructed games (tokens handed out)\n`,
  );
  process.stdout.write(`  cards bought (as played): ${JSON.stringify(moduleUse.bought)}
  cards bought (tokens handed out): ${JSON.stringify(moduleUse.constructed.bought)}
  tiles installed: ${JSON.stringify(moduleUse.installed)}
  milestones claimed: ${JSON.stringify(moduleUse.milestones)}
  goals paid: ${JSON.stringify(moduleUse.goals)} of ${JSON.stringify(moduleUse.goalsInPlay)} in play
`);
}
process.stdout.write(`  action mix (applied, including forced): ${JSON.stringify(usage)}\n`);
process.stdout.write(`  chosen by the driver: ${JSON.stringify(taken)}\n`);
process.stdout.write(`  districts chosen: ${JSON.stringify(districtUse)}\n`);
suite.finish(`${totals.games} random games, ${totals.decisions} decisions, ${totals.refusals} refusals, ${totals.capHits} cap hits`);
