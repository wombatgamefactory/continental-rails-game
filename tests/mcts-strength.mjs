// mcts-strength.mjs - the strength measurement of the search bots (Hard, Expert).
// NOT a suite: run it by hand. It uses every core but one.
//
//   node tests/mcts-strength.mjs                     the three acceptance measurements (about 25 minutes)
//   node tests/mcts-strength.mjs --quick             a quarter of the games
//   node tests/mcts-strength.mjs --only=hard         one of: hard, expert, table
//   node tests/mcts-strength.mjs --calibrate         iterations per second and per turn at the time budgets (one core)
//   node tests/mcts-strength.mjs --match=hard@240,medium --games=100
//                                                    any table: one seat spec per player
//
// A seat spec is  level            the level as registered (a search level with no clock uses its own
//                                  iteration allowance, so the game is reproducible)
//                 level@N          a search level with N iterations per turn
//                 level~MS         a search level with MS milliseconds per turn, on the real clock
//                                  (NOT reproducible, and weaker when every core is busy)
// Other flags:    --games=N --threads=N --seed=TEXT --players (implied by --match)
//                 --a.<setting>=<number>   override an MCTS_SETTINGS entry for the FIRST seat spec
//                 --b.<setting>=<number>   the same for the second (A/B duels of two settings)
//                 --variant.<name>=<value> a rules variant for every game
//
// Seats are rotated from game to game, so over `players` games each spec sits in each seat once.
// Game k uses the seed "<seed>-<k>" and each seat its own bot stream, so a run with fixed
// iteration allowances is the same whatever the thread count.
//
// Every proposal is applied through applyAction; a refusal is fatal and is printed with the seed,
// the state hash and the action.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createGame,
  applyAction,
  isGameOver,
  scoreGame,
  hashState,
  makeRng,
  forkRng,
  topFrame,
  parseVariantValue,
  installedUpgrades,
  specialistTotal,
  carriageCount,
  housesOnBoard,
  ponyCardData,
  SILENT,
} from '../src/engine/index.js';
import { getBot } from '../src/bots/index.js';
import { MCTS_SETTINGS, search } from '../src/bots/mctsBot.js';

const SEARCH_LEVELS = { hard: { timeBudgetMs: MCTS_SETTINGS.hardTimeBudgetMs, iterations: MCTS_SETTINGS.hardIterations }, expert: { timeBudgetMs: MCTS_SETTINGS.expertTimeBudgetMs, iterations: MCTS_SETTINGS.expertIterations } };
/** The tie-break jitter given to heuristic seats, as the simulator's --jitter does (identical deterministic bots otherwise repeat games). */
const HEURISTIC_JITTER = 0.01;

function parseSpec(text, overrides) {
  const m = /^([a-z]+)(?:([@~])(\d+))?$/.exec(text);
  if (!m) throw new Error(`Bad seat spec "${text}". Use level, level@iterations or level~milliseconds.`);
  getBot(m[1]);
  const spec = { label: text, level: m[1], iterations: null, timeBudgetMs: null, mcts: overrides && Object.keys(overrides).length > 0 ? overrides : null };
  if (m[2] === '@') spec.iterations = Number(m[3]);
  if (m[2] === '~') spec.timeBudgetMs = Number(m[3]);
  if (spec.mcts) spec.label += `{${Object.entries(spec.mcts).map(([k, v]) => `${k}=${v}`).join(',')}}`;
  return spec;
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

function playOne(job) {
  const { specs, index, seed, variants } = job;
  const P = specs.length;
  const gameSeed = `${seed}-${index}`;
  const order = specs.map((_, c) => (((c - index) % P) + P) % P); // slot at config position c
  const state = createGame({ playerCount: P, players: order.map((_, c) => ({ name: `P${c + 1}` })), seed: gameSeed, shuffleSeats: false, variants });
  const slotOfSeat = state.players.map((p) => order[p.configIndex]);
  const rngs = slotOfSeat.map((_, seat) => makeRng(`bots:${gameSeed}:${seat}`));
  const think = slotOfSeat.map(() => []); // per seat: ms per own turn
  const iters = slotOfSeat.map(() => []); // per seat: iterations per own turn
  const counts = slotOfSeat.map(() => ({}));
  const districts = slotOfSeat.map(() => ({}));
  const cards = slotOfSeat.map(() => ({ A: 0, B: 0, C: 0 }));
  let decisions = 0;
  const clock = () => performance.now();
  let curTurn = -1;
  let curMs = 0;
  let curIt = 0;
  const flush = () => {
    if (curTurn > 0) {
      const seat = flush.seat;
      think[seat].push(curMs);
      iters[seat].push(curIt);
    }
    curMs = 0;
    curIt = 0;
  };
  while (!isGameOver(state)) {
    const seat = state.toAct;
    const spec = specs[slotOfSeat[seat]];
    if (state.phase === 'play' && state.turn.number !== curTurn) {
      flush();
      curTurn = state.turn.number;
      flush.seat = state.turn.player;
    }
    const rng = forkRng(rngs[seat]);
    const t0 = performance.now();
    let action;
    let n = 0;
    if (SEARCH_LEVELS[spec.level]) {
      const context = { rng, defaults: SEARCH_LEVELS[spec.level], mcts: spec.mcts, timeBudgetMs: null, iterations: null, now: null };
      if (spec.iterations !== null) context.iterations = spec.iterations;
      if (spec.timeBudgetMs !== null) {
        context.timeBudgetMs = spec.timeBudgetMs;
        context.now = clock;
      }
      const found = search(state, context);
      action = found.action;
      n = found.iterations;
    } else {
      action = getBot(spec.level).chooseAction(state, { rng, jitter: HEURISTIC_JITTER, timeBudgetMs: 0, iterations: null, now: null });
    }
    const ms = performance.now() - t0;
    if (state.phase === 'play' && state.turn.player === seat) {
      curMs += ms;
      curIt += n;
    }
    counts[seat][action.type] = (counts[seat][action.type] || 0) + 1;
    if (action.type === 'chooseDistrict' && action.district !== 'none') {
      const tile = state.grid.tiles[action.district];
      districts[seat][tile] = (districts[seat][tile] || 0) + 1;
    }
    if (action.type === 'buyPonyCard') {
      const data = ponyCardData(state, action.card);
      const rank = data && data.rank ? data.rank : '?';
      cards[seat][rank] = (cards[seat][rank] || 0) + 1;
    }
    try {
      applyAction(state, action, SILENT);
    } catch (err) {
      return { index, failed: { seed: gameSeed, hash: hashState(state), action, seat, level: spec.label, message: err.message } };
    }
    decisions += 1;
  }
  flush();
  const score = scoreGame(state);
  const bySlot = [];
  for (let seat = 0; seat < P; seat++) {
    const player = state.players[seat];
    let upgrades = 0;
    let upgradeLevels = 0;
    try {
      const list = installedUpgrades(state, seat) || [];
      upgrades = list.length;
      for (const u of list) upgradeLevels += u && u.tile && u.tile.level ? u.tile.level : 0;
    } catch (err) {
      upgrades = 0;
    }
    bySlot[slotOfSeat[seat]] = {
      seat,
      total: score.players[seat].total,
      rank: score.players[seat].rank,
      bySource: score.players[seat].bySource,
      turns: player.turnsTaken,
      think: think[seat],
      iters: iters[seat],
      counts: counts[seat],
      districts: districts[seat],
      cards: cards[seat],
      specialists: specialistTotal(state, seat),
      carriages: carriageCount(player),
      upgrades,
      upgradeLevels,
      housesLeft: housesOnBoard(player),
    };
  }
  return { index, end: state.gameEnd.reason, turnsTotal: state.turn.number, decisions, slots: bySlot };
}

// ---------------------------------------------------------------------------
// Worker thread
// ---------------------------------------------------------------------------

if (!isMainThread) {
  parentPort.on('message', (job) => {
    let record;
    try {
      record = playOne(job);
    } catch (err) {
      record = { index: job.index, failed: { seed: `${job.seed}-${job.index}`, message: `crash: ${err && err.stack ? err.stack : err}` } };
    }
    parentPort.postMessage(record);
  });
}

// ---------------------------------------------------------------------------
// Main thread
// ---------------------------------------------------------------------------

const out = (text = '') => process.stdout.write(`${text}\n`);
const mean = (list) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
function sd(list) {
  if (list.length < 2) return 0;
  const m = mean(list);
  return Math.sqrt(list.reduce((a, b) => a + (b - m) * (b - m), 0) / (list.length - 1));
}

function runMatch(specs, games, threads, seed, variants) {
  return new Promise((resolve) => {
    const records = new Array(games);
    let next = 0;
    let done = 0;
    const workers = [];
    const n = Math.max(1, Math.min(threads, games));
    const feed = (worker) => {
      if (next >= games) {
        worker.terminate();
        return;
      }
      worker.postMessage({ specs, index: next++, seed, variants });
    };
    for (let i = 0; i < n; i++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      workers.push(worker);
      worker.on('message', (record) => {
        records[record.index] = record;
        done += 1;
        if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${games} games`);
        if (done === games) {
          if (process.stderr.isTTY) process.stderr.write('\r                    \r');
          for (const w of workers) w.terminate();
          resolve(records);
        } else feed(worker);
      });
      feed(worker);
    }
  });
}

function report(title, specs, records, wallMs) {
  out('');
  out(`=== ${title}`);
  const failed = records.filter((r) => r.failed);
  for (const r of failed) out(`  FAILED game ${r.index}: ${JSON.stringify(r.failed)}`);
  const good = records.filter((r) => !r.failed);
  const n = good.length;
  out(`  ${n} games (${failed.length} failed), ${specs.length} players, ${(wallMs / 1000).toFixed(0)} s wall`);
  const reasons = {};
  for (const r of good) reasons[r.end] = (reasons[r.end] || 0) + 1;
  out(`  game length: ${mean(good.map((r) => r.turnsTotal / specs.length)).toFixed(1)} turns per player (sd ${sd(good.map((r) => r.turnsTotal / specs.length)).toFixed(1)}), ${mean(good.map((r) => r.decisions)).toFixed(0)} decisions; ends: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const sources = new Set();
  for (const r of good) for (const s of r.slots) for (const k of Object.keys(s.bySource)) sources.add(k);
  const fair = 1 / specs.length;
  for (let slot = 0; slot < specs.length; slot++) {
    const mine = good.map((r) => r.slots[slot]);
    const wins = mine.filter((s) => s.rank === 1).length;
    const p = n > 0 ? wins / n : 0;
    const se = n > 0 ? Math.sqrt((p * (1 - p)) / n) : 0;
    out(`  [${slot + 1}] ${specs[slot].label}`);
    out(`      wins ${wins}/${n} = ${pct(p)} (standard error ${pct(se)}; an even table gives ${pct(fair)})`);
    out(`      score mean ${mean(mine.map((s) => s.total)).toFixed(1)} (sd ${sd(mine.map((s) => s.total)).toFixed(1)}); mean rank ${mean(mine.map((s) => s.rank)).toFixed(2)}`);
    out(`      VP by source: ${Array.from(sources).map((k) => `${k} ${mean(mine.map((s) => s.bySource[k] || 0)).toFixed(1)}`).join(', ')}`);
    out(`      engine at the end: specialists ${mean(mine.map((s) => s.specialists)).toFixed(2)}, carriages ${mean(mine.map((s) => s.carriages)).toFixed(2)}, upgrade tiles ${mean(mine.map((s) => s.upgrades)).toFixed(2)}, houses left on the player board ${mean(mine.map((s) => s.housesLeft)).toFixed(1)}`);
    const perGame = (key) => mean(mine.map((s) => s.counts[key] || 0)).toFixed(1);
    out(`      per game: routes claimed ${perGame('claimRoute')}, moves ${perGame('moveTrain')}, railway stations ${perGame('placeRailwayStation')}, telegraph stations ${perGame('placeTelegraphStation')}, steps used ${perGame('useStep')}, Congress entries ${perGame('takeCongressEntry')}, hires ${perGame('hireSpecialist')}, carriages added ${perGame('addCarriage')}, upgrade tiles installed ${perGame('installUpgrade')}, hats bought ${perGame('buyHat')}`);
    out(`      Pony Express cards bought per game: A ${mean(mine.map((s) => s.cards.A || 0)).toFixed(2)}, B ${mean(mine.map((s) => s.cards.B || 0)).toFixed(2)}, C ${mean(mine.map((s) => s.cards.C || 0)).toFixed(2)}`);
    const tiles = new Set();
    for (const s of mine) for (const k of Object.keys(s.districts)) tiles.add(k);
    out(`      districts chosen per game: ${Array.from(tiles).sort().map((k) => `${k} ${mean(mine.map((s) => s.districts[k] || 0)).toFixed(1)}`).join(', ')}`);
    const think = [];
    const its = [];
    for (const s of mine) {
      for (const t of s.think) think.push(t);
      for (const t of s.iters) its.push(t);
    }
    think.sort((a, b) => a - b);
    if (SEARCH_LEVELS[specs[slot].level]) {
      out(`      thinking per turn: mean ${mean(think).toFixed(0)} ms, p95 ${quantile(think, 0.95).toFixed(0)} ms, max ${quantile(think, 1).toFixed(0)} ms; iterations per turn: mean ${mean(its).toFixed(0)}; per game ${(mean(mine.map((s) => s.think.reduce((a, b) => a + b, 0))) / 1000).toFixed(1)} s`);
    }
  }
  return { n, failed: failed.length, winRate: (slot) => (n > 0 ? good.filter((r) => r.slots[slot].rank === 1).length / n : 0) };
}

/** Plays a few games on one core against the real clock and reports how many iterations a turn gets. */
function calibrate() {
  out('Calibration: one core, real clock, 2 players, the search level against Medium.');
  for (const level of ['hard', 'expert']) {
    const budget = SEARCH_LEVELS[level].timeBudgetMs;
    const games = level === 'hard' ? 3 : 2;
    const think = [];
    const its = [];
    for (let g = 0; g < games; g++) {
      const record = playOne({ specs: [parseSpec(`${level}~${budget}`), parseSpec('medium')], index: g, seed: 'calibrate', variants: {} });
      if (record.failed) {
        out(`  FAILED: ${JSON.stringify(record.failed)}`);
        continue;
      }
      for (const t of record.slots[0].think) think.push(t);
      for (const t of record.slots[0].iters) its.push(t);
    }
    const ms = think.reduce((a, b) => a + b, 0);
    const n = its.reduce((a, b) => a + b, 0);
    think.sort((a, b) => a - b);
    out(`  ${level} at ${budget} ms a turn: ${think.length} turns, ${(n / (ms / 1000)).toFixed(0)} iterations per second, ${mean(its).toFixed(0)} iterations per turn (mean), thinking per turn mean ${mean(think).toFixed(0)} ms, p95 ${quantile(think, 0.95).toFixed(0)} ms, max ${quantile(think, 1).toFixed(0)} ms`);
    // An allowance of N iterations is shared out exactly as the time is, so the allowance that matches the
    // time budget is (iterations per second) x (budget in seconds), not the mean number actually used.
    out(`      the equivalent fixed allowance is about ${Math.round(((n / (ms / 1000)) * budget) / 1000 / 10) * 10} iterations a turn (MCTS_SETTINGS.${level}Iterations is ${SEARCH_LEVELS[level].iterations})`);
  }
}

async function main() {
  const args = {};
  const overrides = { a: {}, b: {} };
  const variants = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`Bad argument "${arg}".`);
    const [, name, value] = m;
    if (name.startsWith('a.') || name.startsWith('b.')) overrides[name[0]][name.slice(2)] = Number(value);
    else if (name.startsWith('variant.')) variants[name.slice(8)] = parseVariantValue(name.slice(8), value);
    else args[name] = value === undefined ? true : value;
  }
  if (args.calibrate) {
    calibrate();
    return;
  }
  const quick = Boolean(args.quick);
  const threads = args.threads ? Number(args.threads) : Math.max(1, availableParallelism() - 1);
  const seed = args.seed || 'strength';
  let exit = 0;

  const run = async (title, specTexts, games) => {
    const specs = specTexts.map((text, i) => parseSpec(text, i === 0 ? overrides.a : i === 1 ? overrides.b : null));
    const t0 = performance.now();
    const records = await runMatch(specs, games, threads, seed, variants);
    const summary = report(title, specs, records, performance.now() - t0);
    if (summary.failed > 0) exit = 1;
    return summary;
  };

  if (args.match) {
    const texts = String(args.match).split(',');
    await run(`${texts.join(' v ')}`, texts, args.games ? Number(args.games) : 100);
    process.exit(exit);
  }

  const games = args.games ? Number(args.games) : quick ? 28 : 100;
  const hard = `hard@${MCTS_SETTINGS.hardIterations}`;
  const expert = `expert@${MCTS_SETTINGS.expertIterations}`;
  const only = args.only || null;
  out(`Strength of the search bots at fixed iteration allowances (Hard ${MCTS_SETTINGS.hardIterations}, Expert ${MCTS_SETTINGS.expertIterations} iterations a turn), ${threads} threads.`);
  if (!only || only === 'hard') {
    const s = await run('Hard v Medium, 2 players (target: Hard wins at least 60%)', [hard, 'medium'], games);
    out(`  -> Hard wins ${pct(s.winRate(0))} of ${s.n}: ${s.winRate(0) >= 0.6 ? 'target met' : 'TARGET MISSED'}`);
  }
  if (!only || only === 'expert') {
    const s = await run('Expert v Hard, 2 players (target: Expert wins at least 50%)', [expert, hard], games);
    out(`  -> Expert wins ${pct(s.winRate(0))} of ${s.n}: ${s.winRate(0) >= 0.5 ? 'target met' : 'TARGET MISSED'}`);
  }
  if (!only || only === 'table') {
    const s = await run('Hard among three Mediums, 4 players (an even table gives 25%)', [hard, 'medium', 'medium', 'medium'], games);
    out(`  -> Hard wins ${pct(s.winRate(0))} of ${s.n}`);
  }
  process.exit(exit);
}

if (isMainThread) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  });
}
