// sim.test.mjs - the simulator: sim/sim.mjs and its modules.
//
// Semantics: exits 1 on any failure.
//
// Three kinds of check:
//   1. the harness as a whole (real runs of a few dozen random-bot games): determinism, thread
//      independence, variants recorded and acted on, bad input refused before any game, the
//      baseline arm, files never overwritten, --rotate, --fast agreeing with full mode;
//   2. the arithmetic: hand-made records with known scores pushed through the REAL aggregate,
//      health and comparison functions, with the expected numbers written out by hand;
//   3. the documentation: --help lists every flag and variant, SCHEMA.md names every field.
//
// Outputs go to a folder of this process's own under the operating system's temp folder.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSuite } from './helpers/play.mjs';
import { makeTempDir, removeTempDir } from './helpers/tmp.mjs';
import { runCli } from '../sim/sim.mjs';
import { FLAGS, PREFIX_FLAGS, helpText } from '../sim/args.mjs';
import { tieSplit, marginPct, aggregateArm, compareArms, computeSections } from '../sim/aggregate.mjs';
import { evaluateHealth, HEALTH_TABLE } from '../sim/health.mjs';
import { ratio, describe, proportionSe, sigmaFromFair } from '../sim/stats.mjs';
import { createTally, tallyEvents, finishTrace } from '../sim/metrics.mjs';
import { VARIANTS, RULES } from '../src/engine/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
// A folder of this process's own under the operating system's temp folder: two runs at once cannot collide,
// and a sync tool's lock on a just-written file cannot fail the clean-up.
const tmp = makeTempDir('cr-sim-test');

const suite = makeSuite('sim');
const started = performance.now();

/** Runs the simulator in this process with output captured. */
async function sim(args) {
  const out = [];
  const err = [];
  const r = await runCli(args, { out: (s) => out.push(s), err: (s) => err.push(s), progress: null });
  return { ...r, out: out.join('\n'), err: err.join('\n') };
}

/** A parsed result file with every `timing` key removed. */
function stripTiming(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'timing' ? undefined : v)));
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const base = ['--games=20', '--players=2', '--bots=random', '--seed=sim-test', '--quiet'];

// ---------------------------------------------------------------------------------------------
// 1. Real runs
// ---------------------------------------------------------------------------------------------

const outA = path.join(tmp, 'same.json');
const runA1 = await sim([...base, '--threads=1', `--out=${outA}`]);
const runA2 = await sim([...base, '--threads=1', `--out=${outA}`]);
const runThreads = await sim([...base, '--threads=3', `--out=${path.join(tmp, 'threads.json')}`]);

suite.check('20 games twice with the same seed give identical output apart from timing, and the second run never overwrites the first file', () => {
  assert.equal(runA1.exitCode, 0, runA1.err);
  assert.equal(runA2.exitCode, 0, runA2.err);
  assert.notEqual(runA1.path, runA2.path, 'the second run reused the first file name');
  assert.ok(runA2.path.endsWith('same-2.json'), `expected same-2.json, got ${runA2.path}`);
  assert.ok(fs.existsSync(runA1.path) && fs.existsSync(runA2.path));
  const a = stripTiming(readJson(runA1.path));
  const b = stripTiming(readJson(runA2.path));
  assert.equal(JSON.stringify(a.arms), JSON.stringify(b.arms), 'arms differ between two runs on one seed');
  assert.equal(JSON.stringify(stripTiming(runA1.result.arms)), JSON.stringify(stripTiming(runA2.result.arms)), 'the unrounded in-memory results differ between two runs on one seed');
  // The aggregates are byte-identical text, not merely equal values.
  assert.equal(JSON.stringify(a.arms[0].aggregate), JSON.stringify(b.arms[0].aggregate));
});

suite.check('one thread against several: identical aggregates and per-game records', () => {
  assert.equal(runThreads.exitCode, 0, runThreads.err);
  assert.equal(runThreads.result.run.threads, 3);
  assert.equal(runA1.result.run.threads, 1);
  assert.equal(JSON.stringify(stripTiming(runThreads.result.arms)), JSON.stringify(stripTiming(runA1.result.arms)));
});

suite.check('every game is played, every record is whole, and the harness saw zero refusals, caps, crashes and bookkeeping mismatches', () => {
  const arm = runA1.result.arms[0];
  assert.equal(arm.games.length, 20);
  assert.deepEqual(arm.games.map((g) => g.index), [...Array(20).keys()]);
  assert.deepEqual(runA1.result.failures, []);
  const c = arm.aggregate.counts;
  assert.deepEqual([c.games, c.finished, c.failed, c.refusals, c.decisionCapHits, c.errors, c.integrity], [20, 20, 0, 0, 0, 0, 0]);
  for (const g of arm.games) {
    assert.equal(g.failed, undefined);
    assert.equal(g.seed, `sim-test-${g.index}`);
    assert.equal(g.scores.length, 2);
    assert.ok(g.scores.every(Number.isInteger));
    assert.deepEqual(g.rank.slice().sort(), [1, 2]);
    assert.equal(g.rank[g.winner], 1);
    assert.ok(g.timing.ms > 0);
    // VP by source adds up to the score, per seat.
    g.vp.forEach((v, s) => assert.equal(Object.values(v).reduce((a, b) => a + b, 0), g.scores[s]));
    // Quarters hold the in-play VP; the rest of the score is final scoring.
    const finalVp = g.vp.reduce((a, v) => a + (v.buildingsEnd ?? 0) + (v.goals ?? 0) + (v.ponyEnd ?? 0), 0);
    assert.equal(g.quarters.reduce((a, b) => a + b, 0) + finalVp, g.scores.reduce((a, b) => a + b, 0), 'quarters + final scoring = total VP');
    assert.deepEqual(g.trace[g.trace.length - 1].reduce((a, b) => a + b, 0), g.quarters.reduce((a, b) => a + b, 0));
    assert.ok(g.decisions > 0 && g.legal.n > 0);
  }
  assert.ok(runA1.result.run.timing.gamesPerSecond > 0);
});

const outFast = path.join(tmp, 'fast.json');
const runFast = await sim([...base, '--threads=2', '--fast', `--out=${outFast}`]);
suite.check('--fast plays the same games as full mode (events on or off change nothing) and drops the event-only fields', () => {
  assert.equal(runFast.exitCode, 0, runFast.err);
  const full = runA1.result.arms[0].games;
  const fast = runFast.result.arms[0].games;
  assert.equal(runFast.result.run.mode, 'fast');
  fast.forEach((g, i) => {
    for (const key of ['seed', 'seats', 'end', 'turns', 'turnsTotal', 'decisions', 'setupDecisions', 'forced', 'scores', 'rank', 'winner', 'vp', 'actions', 'routes', 'buildings', 'unlaid', 'left']) {
      assert.deepEqual(g[key], full[i][key], `game ${i}: ${key} differs between fast and full`);
    }
    for (const key of ['legal', 'trace', 'quarters', 'leadChanges', 'districts', 'auto']) assert.equal(g[key], undefined, `${key} should be absent in fast mode`);
  });
  assert.equal(runFast.result.arms[0].aggregate.legalActions, undefined);
  assert.equal(runFast.result.arms[0].aggregateAll.bySeat.length, 2);
  assert.equal(runFast.result.arms[0].aggregateAll.legalActions, undefined);
});

const varOut = path.join(tmp, 'variant.json');
const runVariant = await sim([...base, '--threads=2', '--variant.conversionRate=1:1', '--variant.maxTurnsPerPlayer=12', `--out=${varOut}`]);
suite.check('a --variant flag is recorded and changes behaviour', () => {
  assert.equal(runVariant.exitCode, 0, runVariant.err);
  const arm = runVariant.result.arms[0];
  assert.deepEqual(arm.variantsNonDefault, { conversionRate: '1:1', maxTurnsPerPlayer: 12 });
  assert.equal(arm.variants.conversionRate, '1:1');
  assert.equal(arm.variants.maxTurnsPerPlayer, 12);
  assert.equal(readJson(runVariant.path).arms[0].variants.conversionRate, '1:1');
  const plain = runA1.result.arms[0];
  assert.deepEqual(plain.variantsNonDefault, {});
  // It acted: a 12-turn limit ends every game within 12 turns each, and the plain games ran far longer.
  assert.ok(arm.games.every((g) => Math.max(...g.turns) <= 12), 'maxTurnsPerPlayer=12 was not obeyed');
  assert.ok(plain.games.some((g) => Math.max(...g.turns) > 12));
  assert.notDeepEqual(arm.games.map((g) => g.scores), plain.games.map((g) => g.scores));
  assert.ok(runVariant.out.includes('conversionRate=1:1'), 'the summary should name the variant');
});

const constRun = await sim([...base, '--games=10', '--threads=1', '--const.SCORING.firstConnectionVp=0', `--out=${path.join(tmp, 'const.json')}`]);
suite.check('a --const override reaches the engine, is recorded, and changes scores', () => {
  const r = constRun;
  assert.equal(r.exitCode, 0, r.err);
  const arm = r.result.arms[0];
  assert.deepEqual(arm.constants, { SCORING: { firstConnectionVp: 0 } });
  assert.ok(arm.games.every((g) => g.vp.every((v) => v.firstConnection === 0)), 'no first-connection VP should be scored with the constant at 0');
  const plain = runA1.result.arms[0].games;
  assert.ok(plain.slice(0, 10).some((g) => g.vp.some((v) => v.firstConnection > 0)), 'the control games should score first connections');
});

const baselineRun = await sim([...base, '--games=12', '--threads=2', '--variant.conversionRate=1:1', '--baseline', `--out=${path.join(tmp, 'baseline.json')}`]);
const plainRun = await sim([...base, '--games=12', '--threads=1', `--out=${path.join(tmp, 'plain12.json')}`]);
suite.check('--baseline writes two arms on the same seeds, in one file, with a comparison', () => {
  const r = baselineRun;
  assert.equal(r.exitCode, 0, r.err);
  const file = readJson(r.path);
  assert.deepEqual(file.arms.map((a) => a.name), ['test', 'baseline']);
  assert.deepEqual(file.arms[0].variantsNonDefault, { conversionRate: '1:1' });
  assert.deepEqual(file.arms[1].variantsNonDefault, {});
  assert.equal(file.arms[1].variants.conversionRate, '2:1');
  assert.deepEqual(file.arms[0].games.map((g) => g.seed), file.arms[1].games.map((g) => g.seed), 'both arms must use the same game seeds');
  // The baseline arm is the plain game: it equals a plain run of the same seeds.
  assert.equal(JSON.stringify(stripTiming(file.arms[1].games)), JSON.stringify(stripTiming(plainRun.result.arms[0].games)));
  assert.ok(file.comparison && file.comparison.counted.metrics.length > 0 && file.comparison.allFinished.metrics.length > 0);
  const row = file.comparison.allFinished.metrics.find((m) => m.id === 'score.mean');
  assert.ok(Math.abs(row.diff - (row.test - row.baseline)) < 2e-6, 'the file rounds figures to 6 decimal places');
  assert.ok(r.out.includes('Test arm against baseline'));
  assert.equal(runA1.result.comparison, null);
});

// Three bots of one level, one of them marked by weights (random ignores them), so there is a bot type to follow.
const rotateRun = await sim(['--games=12', '--players=3', '--bots=random,random,random', '--weights.focus=2', '--weights-seat=1', '--rotate', '--seed=rot', '--threads=2', '--quiet', `--out=${path.join(tmp, 'rotate.json')}`]);
const fixedRun = await sim(['--games=6', '--players=3', '--bots=random,random,random', '--weights.focus=2', '--weights-seat=1', '--seed=rot', '--threads=1', '--quiet', `--out=${path.join(tmp, 'norotate.json')}`]);
suite.check('--rotate puts each bot in each seat equally often, and the report has both views', () => {
  const r = rotateRun;
  assert.equal(r.exitCode, 0, r.err);
  const agg = r.result.arms[0].aggregateAll;
  assert.deepEqual(agg.seatTypeCounts['random+w'], [4, 4, 4]);
  assert.deepEqual(agg.seatTypeCounts.random, [8, 8, 8]);
  r.result.arms[0].games.forEach((g, k) => assert.equal(g.seats.indexOf('random+w'), k % 3, `game ${k}: bot 1 should sit at seat ${(k % 3) + 1}`));
  assert.equal(agg.byType.length, 2);
  assert.equal(agg.bySeat.length, 3);
  assert.ok(r.out.includes('Win rate by bot type') && r.out.includes('Win rate by seat'));
  // Without --rotate the first bot stays in seat 1.
  assert.ok(fixedRun.result.arms[0].games.every((g) => g.seats[0] === 'random+w'));
});

const summaryRun = await sim([...base, '--threads=2', '--keep-games=false', `--out=${path.join(tmp, 'summary.json')}`]);
suite.check('--keep-games=false writes the aggregates without the per-game records, and they match the full run', () => {
  assert.equal(summaryRun.exitCode, 0, summaryRun.err);
  const arm = summaryRun.result.arms[0];
  assert.equal(arm.games, null);
  assert.equal(arm.gamesKept, false);
  assert.equal(JSON.stringify(stripTiming(arm.aggregate)), JSON.stringify(stripTiming(runA1.result.arms[0].aggregate)), 'dropping the records must not change a single aggregate');
  assert.ok(!fs.readFileSync(summaryRun.path, 'utf8').includes('"trace"'));
  assert.ok(runA1.result.arms[0].games.every((g) => Array.isArray(g.trace)), 'kept games carry a trace');
});

const capRun = await sim(['--games=3', '--players=2', '--bots=random', '--max-decisions=100', '--threads=1', '--quiet', `--out=${path.join(tmp, 'cap.json')}`]);
suite.check('--max-decisions: a game that cannot end is reported, the file is still written, and the exit status is non-zero', () => {
  const r = capRun;
  assert.equal(r.exitCode, 1);
  assert.ok(fs.existsSync(r.path));
  assert.equal(r.result.failures.length, 3);
  assert.equal(r.result.failures[0].type, 'cap');
  assert.ok(typeof r.result.failures[0].hash === 'string' && r.result.failures[0].hash.length === 16);
  assert.equal(r.result.arms[0].aggregate.counts.decisionCapHits, 3);
  assert.equal(r.result.arms[0].aggregate.health.find((x) => x.id === 'decisionCap').status, 'warn');
  assert.ok(r.out.includes('FAILED GAMES'));
});

// ---------------------------------------------------------------------------------------------
// Bad input is refused before any game is played
// ---------------------------------------------------------------------------------------------

const filesBeforeBad = fs.readdirSync(tmp).length;
const badCases = [
  [['--variant.noSuchVariant=1'], /Unknown variant "noSuchVariant"/],
  [['--variant.conversionRate=3:1'], /Illegal value "3:1" for variant "conversionRate"/],
  [['--variant.goalsInPlay=99'], /goalsInPlay/],
  [['--const.SCORING.noSuchConstant=1'], /Unknown constant "SCORING.noSuchConstant"/],
  [['--const.SCORING.firstConnectionVp=lots'], /Illegal value "lots" for constant "SCORING.firstConnectionVp"/],
  [['--noSuchFlag'], /Unknown option "--noSuchFlag"/],
  [['--noSuchFlag=3'], /Unknown option/],
  [['games=5'], /Unexpected argument/],
  [['--players=5'], /--players must be one of 2, 3, 4/],
  [['--games=0'], /at least 1/],
  [['--games=ten'], /whole number/],
  [['--bots=noSuchBot'], /Unknown bot level "noSuchBot"/],
  [['--players=3', '--bots=random,random'], /2 levels for 3 players/],
  [['--baseline'], /needs at least one/],
  [['--weights-seat=1'], /needs at least one --weights/],
  [['--weights.x=abc'], /needs a number/],
  [['--seed'], /needs a value/],
];
const badResults = [];
for (const [args, pattern] of badCases) badResults.push({ args, pattern, r: await sim([...args, `--out=${path.join(tmp, 'never.json')}`]) });
suite.check('an unknown variant, an illegal value, an unknown flag and other bad input are each rejected (exit 2, no game, no file)', () => {
  for (const { args, pattern, r } of badResults) {
    assert.equal(r.exitCode, 2, `${args.join(' ')} should be refused (got ${r.exitCode})`);
    assert.match(r.err, pattern, `${args.join(' ')}: wrong message`);
    assert.equal(r.out, '', `${args.join(' ')}: nothing should be printed to stdout`);
  }
  assert.equal(fs.readdirSync(tmp).length, filesBeforeBad, 'a refused run must write nothing');
});

suite.check('the real command line exits non-zero for an unknown variant and an unknown flag, and zero for --help', () => {
  const simPath = path.join(repo, 'sim', 'sim.mjs');
  const run = (...args) => spawnSync(process.execPath, [simPath, ...args], { encoding: 'utf8', cwd: repo });
  const a = run('--variant.nope=1');
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /Unknown variant "nope"/);
  assert.equal(a.stdout, '');
  const b = run('--frobnicate');
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /Unknown option/);
  const c = run('--illegal-thing=1');
  assert.notEqual(c.status, 0);
  const h = run('--help');
  assert.equal(h.status, 0);
  assert.match(h.stdout, /--games=N/);
  const ok = run('--games=2', '--players=2', '--bots=random', '--threads=1', '--seed=cli', '--quiet', `--out=${path.join(tmp, 'cli.json')}`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Results written to .*cli\.json/);
  assert.ok(fs.existsSync(path.join(tmp, 'cli.json')));
});

// ---------------------------------------------------------------------------------------------
// 2. The arithmetic, on hand-made records
// ---------------------------------------------------------------------------------------------

const P = 3;
/** A hand-made record: scores and an end reason, everything else neutral. VP: 5 from Congress, the rest from track. */
function fake(scores, extra = {}) {
  const seat = (v) => v;
  return {
    index: 0,
    seed: 'fake',
    seats: ['bot', 'bot', 'bot'],
    startPlayer: 0,
    end: 'transcontinental',
    turns: [40, 40, 40],
    turnsTotal: 120,
    decisions: 360,
    setupDecisions: 12,
    forced: 120,
    scores,
    rank: scores.map((s) => 1 + scores.filter((o) => o > s).length),
    winner: scores.indexOf(Math.max(...scores)),
    vp: scores.map((s) => seat({ track: s - 5, congress: 5 })),
    actions: scores.map(() => ({ placeWorker: 2, chooseDistrict: 1 })),
    routes: scores.map(() => ({ n: 1, byLength: { 2: 1 }, slots: { ground: 2, tunnel: 0, bridge: 0 } })),
    buildings: scores.map(() => ({ railway: 1, telegraph: 0 })),
    unlaid: scores.map(() => ({ ground: 1, tunnel: 0, bridge: 0 })),
    left: scores.map(() => ({ iron: 2, wood: 0, gunpowder: 0, coins: 1, hats: 0 })),
    upgrades: null,
    milestones: null,
    goals: null,
    agenda: null,
    pony: null,
    completion: null,
    timing: { ms: 1 },
    ...extra,
  };
}
const fakeCtx = { players: P, botTypes: ['bot'], variants: { congressTable: 'design-2026-10' }, modulesOn: {} };
const near = (actual, expected, label, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${label}: ${actual} is not ${expected}`);

// Four counted games with known results, plus one turn-limit game and one failed game that must stay out of the means.
const fakeGames = [
  fake([10, 20, 30]), // seat 3 wins; margin 10/30 = 33.33%
  fake([30, 20, 10]), // seat 1 wins; margin 33.33%
  fake([20, 20, 10]), // seats 1 and 2 tie on top: 1/2 each; margin 0
  fake([50, 45, 5]), // seat 1 wins; margin 5/50 = 10% (inside 10%)
];
const turnLimitGame = fake([1, 2, 3], { end: 'turn-limit' });
const failedGame = { index: 9, seed: 'bad', failed: { type: 'refusal', seat: 1, hash: '0123456789abcdef', reason: 'x' }, decisions: 5, timing: { ms: 1 } };

suite.check('arithmetic: tie splitting, margins, win rates, standard errors and sigma on hand-made records', () => {
  assert.deepEqual(tieSplit([20, 20, 10]), [0.5, 0.5, 0]);
  assert.deepEqual(tieSplit([10, 20, 30]), [0, 0, 1]);
  assert.deepEqual(tieSplit([7, 7, 7]).map((x) => +x.toFixed(6)), [0.333333, 0.333333, 0.333333]);
  near(marginPct([50, 45, 5]), 10, 'margin 50 v 45');
  near(marginPct([20, 20, 10]), 0, 'margin of a tie');
  near(marginPct([30, 20, 10]), 100 / 3, 'margin 30 v 20');

  const s = computeSections(fakeGames, fakeCtx);
  assert.equal(s.n, 4);
  // Seat 1 won 0 + 1 + 0.5 + 1 = 2.5 of 4; seat 2 won 0.5; seat 3 won 1.
  const [s1, s2, s3] = s.bySeat;
  near(s1.wins, 2.5, 'seat 1 wins');
  near(s1.winRate, 0.625, 'seat 1 win rate');
  near(s2.winRate, 0.125, 'seat 2 win rate');
  near(s3.winRate, 0.25, 'seat 3 win rate');
  near(s1.winRate + s2.winRate + s3.winRate, 1, 'win rates add to one');
  // se = sqrt(0.625 x 0.375 / 4) = 0.242061; sigma = (0.625 - 1/3) / sqrt((1/3)(2/3)/4) = 1.237437.
  near(s1.se, 0.2420615, 'seat 1 se', 1e-6);
  near(s1.sigma, 1.2374369, 'seat 1 sigma', 1e-6);
  near(s2.sigma, (0.125 - 1 / 3) / Math.sqrt((1 / 3) * (2 / 3) / 4), 'seat 2 sigma');
  assert.equal(s1.fair, 1 / 3);
  // The engine's winner (after tie-breaks) is the first listed top scorer in these records: seats 3, 1, 1, 1.
  assert.equal(s1.tieBreakWins, 3);
  assert.equal(s3.tieBreakWins, 1);
  near(s.firstPlayer.winRate, 0.625, 'first player');
  // Margins: 33.33, 33.33, 0, 10 -> mean 19.1667; two games within 10% (the tie and the 10.0% game).
  near(s.marginPct.mean, (100 / 3 + 100 / 3 + 0 + 10) / 4, 'mean margin');
  near(s.within10.value, 0.5, 'within 10%');
  near(s.within10.se, 0.25, 'within 10% se');
  // Winning scores 30, 30, 20, 50 -> 32.5. All 12 scores total 270 -> mean 22.5.
  near(s.winningScore.mean, 32.5, 'winning score');
  near(s.score.mean, 22.5, 'mean score');
  assert.equal(s.score.min, 5);
  assert.equal(s.score.max, 50);
  near(s.score.median, 20, 'median score');
  near(s.bySeat[0].score.mean, 27.5, 'seat 1 mean score');
  // VP by source: Congress was 5 per player per game = 60 of 270.
  const congress = s.vpBySource.find((x) => x.source === 'congress');
  near(congress.share, 60 / 270, 'congress share');
  assert.equal(s.largestVpSource.source, 'track');
  near(s.largestVpSource.share, 210 / 270, 'track share');
  // Winners: seat 3 (30), seat 1 (30), seats 1 and 2 are both rank 1 in the tie (20, 20), seat 1 (50): 5 rank-1 players, 130 VP.
  near(s.winnersScore.n, 5, 'rank-1 players');
  near(s.winnersScore.mean * 5, 30 + 30 + 20 + 20 + 50, 'winners score');
});

suite.check('arithmetic: ratio estimator, proportions and describe', () => {
  const r = ratio([1, 3], [2, 2]); // R = 4/4 = 1; residuals -1 and 1; se = sqrt(2/1) / (sqrt(2) x 2) = 0.5
  near(r.value, 1, 'ratio');
  near(r.se, 0.5, 'ratio se');
  near(ratio([1, 2, 3], [2, 4, 6]).se, 0, 'proportional data has no ratio error');
  assert.deepEqual(ratio([], []), { value: null, se: null });
  near(proportionSe(0.5, 100), 0.05, 'se at n = 100');
  near(proportionSe(0.5, 200), Math.sqrt(0.25 / 200), 'se at n = 200');
  near(sigmaFromFair(0.59, 0.5, 200), 0.09 / Math.sqrt(0.25 / 200), 'sigma of 59% at n = 200');
  assert.ok(Math.abs(sigmaFromFair(0.59, 0.5, 200) - 2.55) < 0.01, '59% at n = 200 is about 2.5 sigma');
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9]); // classic: mean 5, sample sd = sqrt(32/7)
  near(d.mean, 5, 'mean');
  near(d.sd, Math.sqrt(32 / 7), 'sd');
  near(d.median, 4.5, 'median');
  assert.equal(describe([]).mean, null);
  assert.equal(describe([3]).sd, null);
});

suite.check('arithmetic: turn-limit and failed games are counted on their own and never averaged in', () => {
  const { aggregate, aggregateAll } = aggregateArm([...fakeGames, turnLimitGame, failedGame], fakeCtx);
  const c = aggregate.counts;
  assert.deepEqual([c.games, c.finished, c.failed, c.counted, c.turnLimit, c.refusals], [6, 5, 1, 4, 1, 1]);
  near(c.turnLimitPct, 20, 'turn-limit percentage of finished games');
  assert.equal(aggregate.n, 4);
  near(aggregate.winningScore.mean, 32.5, 'the turn-limit game (winning score 3) must not enter the mean');
  near(aggregate.bySeat[0].winRate, 0.625, 'seat 1 win rate is unchanged by the turn-limit game');
  assert.equal(aggregate.endReasons['turn-limit'].games, 1);
  assert.equal(aggregate.endReasons.transcontinental.games, 4);
  near(aggregate.endReasons['turn-limit'].pct, 20, 'turn-limit pct');
  // All finished games: five, the turn-limit one included, the failed one still out.
  assert.equal(aggregateAll.n, 5);
  near(aggregateAll.winningScore.mean, (30 + 30 + 20 + 50 + 3) / 5, 'winning score over all finished games');
  // If every game ended by the turn limit the headline is empty, not made up.
  const none = aggregateArm([turnLimitGame, turnLimitGame], fakeCtx);
  assert.equal(none.aggregate.n, 0);
  assert.equal(none.aggregateAll.n, 2);
  assert.equal(none.aggregate.counts.turnLimit, 2);
});

suite.check('arithmetic: lead changes, the trace and the quarters from a hand-made event stream', () => {
  // 2 players, 8 turns (4 rounds). Leader after each turn: P0 (5-0), P0 (5-0), P1 (5-7), P1, P0 (12-7), P0, tie (12-12) = no change, P1 (12-20).
  const vp = (player, amount) => ({ type: 'vp', player, source: 'track', amount });
  const stream = [
    { type: 'turnStart', turn: 1, player: 0 }, vp(0, 5), { type: 'turnEnd', turn: 1, player: 0 },
    { type: 'turnStart', turn: 2, player: 1 }, { type: 'turnEnd', turn: 2, player: 1 }, // round 1 ends: 5-0
    { type: 'turnStart', turn: 3, player: 0 }, { type: 'turnEnd', turn: 3, player: 0 },
    { type: 'turnStart', turn: 4, player: 1 }, vp(1, 7), { type: 'turnEnd', turn: 4, player: 1 }, // round 2 ends: 5-7 (lead change 1)
    { type: 'turnStart', turn: 5, player: 0 }, vp(0, 7), { type: 'turnEnd', turn: 5, player: 0 }, // 12-7 (lead change 2)
    { type: 'turnStart', turn: 6, player: 1 }, { type: 'turnEnd', turn: 6, player: 1 }, // round 3 ends: 12-7
    { type: 'turnStart', turn: 7, player: 0 }, vp(1, 5), { type: 'turnEnd', turn: 7, player: 0 }, // 12-12: a tie changes nothing
    { type: 'turnStart', turn: 8, player: 1 }, vp(1, 8), { type: 'turnEnd', turn: 8, player: 1 }, // 12-20 (lead change 3); round 4 ends
    vp(0, 2), // a VP booked after the final turnEnd (an end-of-turn milestone) still belongs to the last row
  ];
  const t = createTally(2);
  tallyEvents(t, stream);
  const out = finishTrace(t, 8);
  assert.equal(out.leadChanges, 3);
  assert.deepEqual(out.trace, [[5, 0], [5, 7], [12, 7], [14, 20]]);
  // Four rows, so each quarter is one row: 5, then 7 more, then 7 more, then 15 more (34 in all).
  assert.deepEqual(out.quarters, [5, 7, 7, 15]);
  assert.equal(out.quarters.reduce((a, b) => a + b, 0), 34);
  // Half-time = after 2 rows = 5-7, so P1 led.
  assert.deepEqual(out.halfLeaders, [1]);
  // A game that is level at half-time lists both.
  const level = createTally(2);
  tallyEvents(level, [{ type: 'turnStart', turn: 1, player: 0 }, { type: 'turnEnd', turn: 1, player: 0 }, { type: 'turnStart', turn: 2, player: 1 }, { type: 'turnEnd', turn: 2, player: 1 }]);
  assert.deepEqual(finishTrace(level, 2).halfLeaders, [0, 1]);
});

suite.check('arithmetic: acquisition win rates, with small samples flagged', () => {
  // Seat 1 holds tile U1-wood in games 0 and 3 (it wins game 3, loses game 0); nobody else holds one.
  const recs = fakeGames.map((g, i) => ({ ...g, upgrades: [i === 0 || i === 3 ? [['U1-wood', 5]] : [], [], []] }));
  const ctx = { ...fakeCtx, modulesOn: { upgrades: true } };
  const s = computeSections(recs, ctx);
  const item = s.modules.upgrades.winRateWithWithout.items.find((x) => x.id === 'U1-wood');
  assert.equal(item.nWith, 2);
  near(item.winRateWith, 0.5, 'with: one win in two');
  assert.equal(item.nWithout, 10);
  // Without: 12 player-games minus 2 = 10; total credit 4 minus the 1 won with = 3.
  near(item.winRateWithout, 0.3, 'without: 3 of 10');
  near(item.diff, 0.2, 'difference');
  assert.equal(item.small, true);
  assert.ok(s.modules.upgrades.neverInstalled.includes('U3-vp'));
  assert.ok(!s.modules.upgrades.neverInstalled.includes('U1-wood'));
});

suite.check('arithmetic: the baseline comparison (difference, its standard error, the 2 SE flag)', () => {
  const head = (a, b, c) => ({ x: { label: 'x', value: a[0], se: a[1], n: 100 }, y: { label: 'y', value: b[0], se: b[1], n: 100 }, z: { label: 'z', value: c[0], se: c[1], n: 100 } });
  const arm = (h, counted = 100) => ({ aggregate: { headline: { ...h, 'turnLimit.share': { label: 't', value: 0, se: 0, n: 1 } }, counts: { counted } }, aggregateAll: { headline: h } });
  const c = compareArms(arm(head([0.6, 0.03], [0.51, 0.03], [10, null])), arm(head([0.5, 0.03], [0.5, 0.03], [8, 1])));
  const get = (id) => c.counted.metrics.find((m) => m.id === id);
  near(get('x').diff, 0.1, 'diff');
  near(get('x').diffSe, Math.sqrt(0.03 * 0.03 * 2), 'diff se');
  assert.equal(get('x').exceedsTwoSe, true); // 0.1 > 2 x 0.0424
  near(get('x').z, 0.1 / Math.sqrt(0.0018), 'z');
  assert.equal(get('y').exceedsTwoSe, false);
  assert.equal(get('z').diffSe, null);
  assert.equal(get('z').exceedsTwoSe, null);
  assert.equal(c.preferred, 'counted');
  assert.equal(compareArms(arm(head([1, 0], [1, 0], [1, 0]), 3), arm(head([1, 0], [1, 0], [1, 0]), 100)).preferred, 'all-finished');
});

suite.check('arithmetic: the health table judges against thresholds that live in one table', () => {
  const agg = (over) => ({
    counts: { turnLimit: 0, decisionCapHits: 0, refusals: 0, errors: 0, integrity: 0 },
    winningScore: { mean: 100 },
    marginPct: { mean: 18 },
    within10: { value: 0.3 },
    firstPlayer: { winRate: 0.52, sigma: 0.5 },
    leadChanges: { mean: 6 },
    vpByQuarter: { finalQuarterWithEndScoring: 0.35 },
    legalActions: { atTurnStart: 10, distinctTypesAtTurnStart: 3 },
    largestVpSource: { source: 'track', share: 0.3 },
    subsystems: [{ id: 'pony', value: 0.8 }],
    ...over,
  });
  const status = (rows, id) => rows.find((r) => r.id === id).status;
  const good = evaluateHealth(agg({}));
  for (const row of good) if (row.id !== 'winningScore') assert.equal(row.status, 'pass', `${row.id} should pass`);
  assert.equal(status(good, 'winningScore'), 'n/a', 'no design target is set for the winning score');
  const bad = evaluateHealth(agg({ marginPct: { mean: 30 }, within10: { value: 0.1 }, firstPlayer: { winRate: 0.7, sigma: 2.5 }, leadChanges: { mean: 1.5 }, counts: { turnLimit: 2, decisionCapHits: 1, refusals: 0, errors: 0, integrity: 0 }, subsystems: [{ id: 'pony', value: 0 }], largestVpSource: { source: 'track', share: 0.5 } }));
  for (const id of ['margin', 'within10', 'firstPlayer', 'leadChanges', 'turnLimit', 'decisionCap', 'singleSource', 'usage.pony']) assert.equal(status(bad, id), 'warn', `${id} should warn`);
  assert.equal(status(bad, 'refusals'), 'pass');
  // Boundaries: a limit is inclusive where the table says "at least" / "to", strict where it says "under".
  assert.equal(status(evaluateHealth(agg({ marginPct: { mean: 22 } })), 'margin'), 'pass');
  assert.equal(status(evaluateHealth(agg({ marginPct: { mean: 22.01 } })), 'margin'), 'warn');
  assert.equal(status(evaluateHealth(agg({ largestVpSource: { source: 'a', share: 0.45 } })), 'singleSource'), 'warn');
  assert.equal(status(evaluateHealth(agg({ legalActions: { atTurnStart: 4.9, distinctTypesAtTurnStart: 3 } })), 'legalActions'), 'warn');
  assert.ok(HEALTH_TABLE.every((row) => row.rule && row.label && row.badReading), 'every row of the table has a rule, a label and a reading');
  // Fast mode leaves figures out; the rows say n/a rather than guess.
  const sparse = evaluateHealth(agg({ leadChanges: undefined, vpByQuarter: undefined, legalActions: undefined }));
  assert.equal(status(sparse, 'leadChanges'), 'n/a');
  assert.equal(status(sparse, 'legalActions'), 'n/a');
});

suite.check('two hand-checked figures from real per-game records agree with the aggregate', () => {
  const arm = runA1.result.arms[0];
  const games = arm.games;
  // Mean winning score, summed by eye from the records.
  const top = games.map((g) => Math.max(...g.scores));
  const counted = games.filter((g) => g.end !== 'turn-limit');
  const countedTop = counted.map((g) => Math.max(...g.scores));
  if (counted.length > 0) near(arm.aggregate.winningScore.mean, countedTop.reduce((a, b) => a + b, 0) / counted.length, 'winning score over counted games');
  near(arm.aggregateAll.winningScore.mean, top.reduce((a, b) => a + b, 0) / games.length, 'winning score over all games');
  // Games the engine's winner took from seat 1.
  const seat1 = games.filter((g) => g.winner === 0).length;
  near(arm.aggregateAll.bySeat[0].tieBreakWins, seat1, 'seat 1 wins by the engine\'s winner');
  assert.equal(arm.aggregate.counts.turnLimit, games.filter((g) => g.end === 'turn-limit').length);
});

// ---------------------------------------------------------------------------------------------
// 3. The documentation cannot drift from the flags and the output
// ---------------------------------------------------------------------------------------------

suite.check('--help lists every flag of the table and every variant, and mentions every dotted family', () => {
  const help = helpText();
  for (const flag of FLAGS) assert.ok(help.includes(`--${flag.name}`), `--help does not mention --${flag.name}`);
  for (const family of PREFIX_FLAGS) assert.ok(help.includes(family.usage), `--help does not mention ${family.usage}`);
  for (const v of VARIANTS) assert.ok(help.includes(v.name), `--help does not list the variant ${v.name}`);
  assert.ok(FLAGS.length >= 18);
});

suite.check('SCHEMA.md names every field of the run, the arm, a game record, the aggregate sections, a health row and the comparison', () => {
  const schema = fs.readFileSync(path.join(repo, 'sim', 'SCHEMA.md'), 'utf8');
  const mentioned = (key) => schema.includes(`\`${key}\``);
  const full = readJson(runA1.path);
  const fromCompare = readJson(path.join(tmp, 'baseline.json'));
  const groups = {
    'top level': Object.keys(full),
    run: Object.keys(full.run),
    arm: Object.keys(full.arms[0]),
    'game record': Object.keys(full.arms[0].games[0]),
    'aggregate section': Object.keys(full.arms[0].aggregate),
    'health row': Object.keys(full.arms[0].aggregate.health[0]),
    comparison: Object.keys(fromCompare.comparison),
    'comparison row': Object.keys(fromCompare.comparison.counted.metrics[0]),
    'run.timing': Object.keys(full.run.timing),
    legal: Object.keys(full.arms[0].games[0].legal),
  };
  const missing = [];
  for (const [group, keys] of Object.entries(groups)) for (const key of keys) if (!mentioned(key)) missing.push(`${group}: ${key}`);
  assert.deepEqual(missing, [], `SCHEMA.md does not describe: ${missing.join(', ')}`);
  assert.ok(RULES.VP_SOURCES.length > 0);
});

const seconds = (performance.now() - started) / 1000;
suite.check('the suite stays well inside its time budget', () => assert.ok(seconds < 20, `took ${seconds.toFixed(1)} s`));
removeTempDir(tmp); // best effort: a locked folder is left for the operating system
suite.finish(`${seconds.toFixed(1)} s`);
