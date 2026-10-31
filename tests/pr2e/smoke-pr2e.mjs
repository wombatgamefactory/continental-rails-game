// smoke-pr2e.mjs - the smoke suite for Pacific Rails, second edition (ruleset `pr2e`).
//
// Not a suite on its own: tests/smoke.test.mjs runs it in place of the
// Continental Rails smoke checks when TEST_RULES=pr2e (tests/rulesets.test.mjs
// does that, with a quarter of the random games).
//
// Runs:
//   - random-bot games on default variants, 200 each at 2, 3 and 4 players;
//   - 30 random games under each non-default value of every variant (P21.1);
//   - games of the stand-in Medium bot (it takes actions rather than stopping,
//     so it lays, builds, earns carriages and completes the line).
//
// Checked: every game ends by itself, ZERO refused proposals, ZERO harness-cap
// hits, always a real choice (never 0 or exactly 1 legal action), the list
// equal to the actions whose block reason is null (in the first games of each
// run), invariants (workers, houses, telegraph stations and specialists
// conserved, storage within capacity unless a discard is pending, carriages
// earned only by railway stations placed by Lay Track, VP adding up by
// source), the completion bonus at most once, equal turns at the end, and that
// EVERY action type, EVERY district and EVERY kind of decision is used.

import assert from 'node:assert/strict';
import { ENGINE, RULES_TAG } from '../helpers/engine.mjs';
import { playGame, assertPlainJson, makeSuite, HARNESS } from '../helpers/play.mjs';

const {
  createGame,
  getValidActions,
  applyAction,
  makeRng,
  rngInt,
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
  districtHouseCount,
  ACTIONS,
  FRAMES,
  DISTRICT_IDS,
  MAP,
  VARIANTS,
  describeAction,
  describeDecision,
  getActionSpace,
  actionKey,
  topFrame,
} = ENGINE;

const FULL_CHECK_GAMES = 3;

/** @param {number} SCALE the share of the random games to play (TEST_SMOKE_SCALE) */
export function runSmoke(SCALE = 1) {
  const scaled = (n) => Math.max(1, Math.round(n * SCALE));
  const suite = makeSuite(`smoke${RULES_TAG}`);
  const usage = {};
  const taken = {};
  const districtUse = {};
  const kindsSeen = {};
  const report = [];
  const totals = { games: 0, decisions: 0, refusals: 0, capHits: 0, forced: 0 };
  const count = (table, key, n = 1) => {
    table[key] = (table[key] ?? 0) + n;
  };

  function checkInvariants(state) {
    const K = getConstants(state);
    const n = state.players.length;
    const hired = {};
    for (const t of K.SPECIALIST_TYPES) hired[t] = 0;
    for (const p of state.players) {
      assert.ok(p.coins >= 0 && p.hats >= 0 && p.hats <= K.HATS.hatLimit, `${p.name}: coins ${p.coins}, hats ${p.hats}`);
      for (const r of K.RESOURCES) assert.ok(p.resources[r] >= 0, `${p.name}: ${r} ${p.resources[r]}`);
      for (const t of K.TERRAINS) assert.ok(p.builtTiles[t] >= 0, `${p.name}: built ${t} ${p.builtTiles[t]}`);
      const grid = workersOnGrid(state, p.id);
      assert.equal(p.workersInSupply + grid.spaces.length + grid.centres.length, K.SETUP.workersByPlayerCount[n], `${p.name}: workers lost or invented`);
      if (!state.stack.some((f) => f.kind === 'discard' && f.player === p.id)) {
        assert.ok(storageUsed(p) <= storageCapacity(state, p.id), `${p.name} is over capacity with no discard pending (P7.6)`);
      }
      const carriages = p.train.specialistCarriages;
      assert.ok(carriages.length <= K.PLAYER_BOARD.maxCarriages);
      assert.equal(carriages.length, Math.min(p.layStationsPlaced, K.MAP_RULES.carriagesForLayStations), `${p.name}: carriages come only from railway stations placed by Lay Track (P16.5)`);
      carriages.forEach((c, i) => {
        assert.equal(c.number, i + 1, 'carriages 1, 2, 3 in order (P7.5)');
        assert.equal(c.upgrade, null, 'PART 2: no upgrade token can be installed yet');
        let empty = false;
        c.slots.forEach((s, slot) => {
          if (s === null) empty = true;
          else {
            // P8.3 - leftmost first; the free specialist of P16.5 may sit in carriage 1 space 1 only.
            assert.ok(!empty, `${p.name}: a specialist after an empty space (P8.3), carriage ${c.number} space ${slot + 1}`);
            hired[s] += 1;
          }
        });
      });
      if (state.phase !== 'setup') {
        // P6.6, P16.2: a house leaves the board as a railway station or a district house.
        assert.equal(housesOnBoard(p) + railwayStationCount(state, p.id) + districtHouseCount(state, p.id), K.SETUP.housesPerPlayer, `${p.name}: houses`);
        assert.equal(p.telegraphsPlaced, telegraphStationCount(state, p.id), `${p.name}: telegraph stations`);
        for (const c of p.railheads) assert.ok(MAP.cityById[c], `${p.name}: a train on an unknown city`);
      }
      assert.ok(p.layStationsPlaced <= railwayStationCount(state, p.id));
    }
    for (const t of K.SPECIALIST_TYPES) {
      assert.equal(hired[t] + state.supply.specialists[t], K.SUPPLY.specialistsPerTypeByPlayerCount[n], `${t} specialists lost or invented`);
    }
    // P16.1 - never one owner for both buildings of a city.
    for (const city of MAP.inlandCities) {
      const r = state.map.railwayStation[city];
      assert.ok(r === null || r !== state.map.telegraphStation[city], `one player owns both buildings of ${city}`);
    }
    if (!isGameOver(state)) assert.equal(state.stack[state.stack.length - 1].player, state.toAct);
  }

  function checkEnded(state, players) {
    const K = getConstants(state);
    assert.equal(isGameOver(state), true);
    assert.equal(state.toAct, null);
    assert.deepEqual(state.stack, []);
    checkInvariants(state);
    assertPlainJson(state);
    assert.ok(K.END_REASONS.includes(state.gameEnd.reason), `unknown end reason ${state.gameEnd.reason}`);
    const turns = state.players.map((p) => p.turnsTaken);
    assert.ok(turns.every((t) => t === turns[0]), `unequal turns: ${turns.join(', ')} (P19.3)`);
    if (state.variants.maxTurnsPerPlayer > 0) assert.ok(turns[0] <= state.variants.maxTurnsPerPlayer);
    if (state.gameEnd.reason === 'transcontinental') assert.notEqual(state.completion, null);
    const completions = state.players.filter((p) => p.vp.completion > 0);
    assert.equal(completions.length, state.completion === null ? 0 : 1, 'the completion VP are paid once per game (P19.2)');
    if (state.completion !== null) {
      assert.equal(state.players[state.completion.player].vp.completion, K.MAP_RULES.completionVpPerSlot * state.completion.slots, 'P19.2: 3 VP per slot of the completing lay');
    }
    const score = scoreGame(state);
    assert.equal(score.final, true);
    assert.equal(score.players.length, players);
    for (const p of score.players) {
      assert.ok(Number.isInteger(p.total) && p.total >= 0);
      assert.equal(Object.values(p.bySource).reduce((a, b) => a + b, 0), p.total, 'VP by source add up to the total');
    }
    assert.deepEqual(score.ranking.slice().sort(), state.players.map((p) => p.id));
    assert.ok(score.winners.length >= 1 && score.winners.includes(score.winner));
  }

  function run(label, variants, playerCounts, games, seedBase, level = 'random') {
    const r = { label, games: 0, decisions: 0, forced: 0, refusals: 0, capHits: 0, turns: 0, reasons: {}, routes: 0, completions: 0, ms: 0 };
    for (let g = 0; g < games; g++) {
      const players = playerCounts[g % playerCounts.length];
      const full = g < FULL_CHECK_GAMES;
      let seen = 0;
      const started = performance.now();
      const result = playGame(
        { playerCount: players, seed: `${seedBase}-${players}-${g}`, variants },
        {
          level,
          events: true,
          onDecision(state, actions) {
            seen += 1;
            if (actions.length < 2) throw new Error(`${label}: a pending decision offered ${actions.length} action(s)`);
            const top = topFrame(state);
            count(kindsSeen, top.kind);
            if (full) {
              for (const action of actions) {
                assert.equal(getBlockReason(state, action), null);
                const text = describeAction(state, action);
                assert.ok(typeof text === 'string' && text.length > 3 && !/undefined|\[object|NaN|null/.test(text), `describeAction: "${text}"`);
              }
              assert.ok(!/undefined|\[object|NaN|null/.test(describeDecision(state).prompt));
              if (seen % 12 === 0 || top.kind !== 'workerStep') {
                const listed = actions.map(actionKey).sort();
                const legal = getActionSpace(state).filter((a) => getBlockReason(state, a) === null).map(actionKey).sort();
                assert.deepEqual(listed, legal, `decision "${top.kind}": the list and the block reasons disagree`);
              }
            }
          },
          onApplied(state, action, events) {
            count(taken, action.type);
            for (const e of events) {
              if (e.type === 'action') {
                count(usage, e.action.type);
                if (e.auto) r.forced += 1;
              } else if (e.type === 'districtChosen' && e.district !== 'none') count(districtUse, e.district);
            }
            if (full) checkInvariants(state);
          },
        },
      );
      r.ms += performance.now() - started;
      const { state } = result;
      suite.check(`${label}: ${players}p game ${g} ends by itself with zero refusals`, () => {
        assert.deepEqual(result.refusals, [], 'the engine refused a proposal taken from getValidActions');
        assert.equal(result.capHit, false, `possible non-termination: ${HARNESS.maxDecisionsPerGame} decisions without an end`);
        checkEnded(state, players);
      });
      r.games += 1;
      r.decisions += result.decisions;
      r.refusals += result.refusals.length;
      r.capHits += result.capHit ? 1 : 0;
      r.turns += state.turn.number;
      r.routes += Object.values(state.map.routeOwner).filter((o) => o !== null).length;
      r.completions += state.completion === null ? 0 : 1;
      const reason = state.gameEnd ? state.gameEnd.reason : 'none';
      r.reasons[reason] = (r.reasons[reason] ?? 0) + 1;
    }
    totals.games += r.games;
    totals.decisions += r.decisions;
    totals.refusals += r.refusals;
    totals.capHits += r.capHits;
    totals.forced += r.forced;
    report.push(
      `  ${label}: ${r.games} games, refusals ${r.refusals}, cap hits ${r.capHits}, avg decisions ${(r.decisions / r.games).toFixed(0)} (+${(r.forced / r.games).toFixed(0)} forced), ` +
        `avg turns ${(r.turns / r.games).toFixed(0)}, avg routes laid ${(r.routes / r.games).toFixed(1)}, completions ${r.completions}, end reasons ${JSON.stringify(r.reasons)}, ${(r.games / (r.ms / 1000)).toFixed(0)} games/s`,
    );
    return r;
  }

  // 1. Default variants, random bots.
  const defaults = [2, 3, 4].map((players) => run(`default ${players}p`, {}, [players], scaled(200), `pr2e-smoke-${players}`));

  // 2. Every non-default value of every variant.
  const variantRuns = [];
  for (const def of VARIANTS) {
    const values = def.type === 'integer' ? [0, 40] : def.values.filter((v) => v !== def.default);
    for (const value of values) {
      const variants = { [def.name]: value };
      if (def.name === 'maxTurnsPerPlayer' && value === 0) {
        // No safety stop: the stand-in Medium bot, which lays and completes the line.
        variantRuns.push(run(`${def.name}=${value} (medium)`, variants, [2, 3, 4], scaled(12), `pr2e-smoke-v-${def.name}-${value}`, 'medium'));
      } else {
        variantRuns.push(run(`${def.name}=${value}`, variants, [2, 3, 4], scaled(30), `pr2e-smoke-v-${def.name}-${value}`));
      }
    }
  }

  // 3. The stand-in Medium bot, which lays track and completes the line.
  const medium = run('stand-in medium bot', {}, [2, 3, 4], scaled(60), 'pr2e-smoke-medium', 'medium');

  suite.check('zero refusals and zero harness-cap hits over the whole run', () => {
    assert.equal(totals.refusals, 0);
    assert.equal(totals.capHits, 0);
  });
  suite.check(`${3 * scaled(200)} random games on default variants`, () => {
    assert.deepEqual(defaults.map((r) => r.games), [scaled(200), scaled(200), scaled(200)]);
  });
  suite.check('every action type was applied at least once', () => {
    const unused = Object.keys(ACTIONS).filter((t) => !usage[t]);
    assert.deepEqual(unused, [], `never applied: ${unused.join(', ')}`);
  });
  suite.check('every action type was chosen by a driver at least once, apart from stop actions the engine takes on its own', () => {
    const suspicious = Object.keys(ACTIONS).filter((t) => !taken[t] && ACTIONS[t].stop !== true);
    assert.deepEqual(suspicious, [], `never chosen by a driver: ${suspicious.join(', ')}`);
  });
  suite.check('every district was chosen at least once', () => {
    assert.deepEqual(DISTRICT_IDS.filter((d) => !districtUse[d]), []);
  });
  suite.check('every kind of decision was asked at least once', () => {
    assert.deepEqual(Object.keys(FRAMES).filter((k) => !kindsSeen[k]), []);
  });
  suite.check('games end by the transcontinental line, not only by the safety stop', () => {
    assert.ok(medium.completions + variantRuns.reduce((a, r) => a + r.completions, 0) > 0, 'no game completed the line');
    const noLimit = variantRuns.find((r) => r.label.startsWith('maxTurnsPerPlayer=0'));
    assert.equal(noLimit.reasons.transcontinental, noLimit.games, 'with no turn limit every game ends by the line (P19.5)');
  });

  // Speed of a bare random playout (list, pick, apply, no events, no checks).
  const speed = [];
  for (const players of [2, 3, 4]) {
    const games = scaled(60);
    const rng = makeRng(`pr2e-speed-${players}`);
    let decisions = 0;
    const started = performance.now();
    for (let g = 0; g < games; g++) {
      const state = createGame({ playerCount: players, seed: `pr2e-speed-${players}-${g}` });
      while (!isGameOver(state)) {
        const actions = getValidActions(state);
        applyAction(state, actions[rngInt(rng, actions.length)], SILENT);
        decisions += 1;
      }
    }
    const seconds = (performance.now() - started) / 1000;
    speed.push({ players, gamesPerSecond: games / seconds, decisionsPerSecond: decisions / seconds, decisionsPerGame: decisions / games });
  }
  suite.check('random playouts run at a usable speed', () => {
    for (const s of speed) assert.ok(s.decisionsPerSecond > 20000, `${s.players}p: only ${s.decisionsPerSecond.toFixed(0)} decisions per second`);
  });

  for (const line of report) process.stdout.write(`${line}\n`);
  process.stdout.write(`  bare random playouts: ${speed.map((s) => `${s.players}p ${s.gamesPerSecond.toFixed(0)} games/s (${(s.decisionsPerSecond / 1000).toFixed(0)}k decisions/s, ${s.decisionsPerGame.toFixed(0)} per game)`).join(', ')}\n`);
  process.stdout.write(`  action mix (applied, including forced): ${JSON.stringify(usage)}\n`);
  process.stdout.write(`  decisions asked: ${JSON.stringify(kindsSeen)}\n`);
  process.stdout.write(`  districts chosen: ${JSON.stringify(districtUse)}\n`);
  suite.finish(`${totals.games} games, ${totals.decisions} decisions, ${totals.refusals} refusals, ${totals.capHits} cap hits`);
}
