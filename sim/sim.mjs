// sim.mjs - the Continental Rails simulator.
//
//   node sim/sim.mjs --games=1000 --players=4 --bots=random
//   npm run sim -- --games=200 --players=3 --bots=medium,medium,easy --rotate --jitter=0.05
//   npm run sim -- --games=500 --variant.conversionRate=1:1 --baseline --label=conversion-1to1
//   node sim/sim.mjs --help
//
// Plays bot-versus-bot games headless through the same driver loop as the browser (run-game.mjs),
// across worker threads (pool.mjs), records one compact record per game (metrics.mjs), aggregates
// them (aggregate.mjs, health.mjs), prints a summary (report.mjs) and writes the JSON file whose
// every field is described in SCHEMA.md.
//
// Exit codes: 0 clean; 1 a game was refused, hit the decision cap, crashed or failed the
// bookkeeping check (the results are still written); 2 the command line was wrong.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeModules } from '../src/engine/index.js';
import { UsageError, parseArgs, resolveOptions, helpText, slug } from './args.mjs';
import { playAll } from './pool.mjs';
import { aggregateArm, compareArms } from './aggregate.mjs';
import { engineCommit, fileStamp, ukDateTime, writeUnique, serialise } from './output.mjs';
import { formatReport } from './report.mjs';
import { sum } from './stats.mjs';

export const SCHEMA_VERSION = 1;

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');

function defaultLabel(plan) {
  const bots = [...new Set(plan.bots.map((b) => b.type))].join('-');
  const test = plan.arms[0];
  const rules = [...Object.keys(test.variants), ...Object.keys(test.constants)].map(slug).join('-').slice(0, 40);
  return slug(`${bots}-${plan.players}p-${plan.games}g${rules ? `-${rules}` : ''}${plan.baseline ? '-vs-baseline' : ''}`);
}

/**
 * Runs the simulator with the given arguments (without `node` and the script name).
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void, progress?: ((done: number, total: number) => void) | null, now?: Date }} [io]
 * @returns {Promise<{ exitCode: number, result?: object, path?: string }>}
 */
export async function runCli(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  let plan;
  try {
    const parsed = parseArgs(argv);
    if (parsed.options.help) {
      out(helpText());
      return { exitCode: 0 };
    }
    plan = resolveOptions(parsed);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`sim: ${e.message}`);
      err('Run with --help for the flags and the variants.');
      return { exitCode: 2 };
    }
    throw e;
  }

  const startedAt = io.now ?? new Date();
  const started = performance.now();
  let progress = io.progress;
  if (progress === undefined && !plan.quiet && process.stderr.isTTY) {
    let last = 0;
    progress = (done, total) => {
      const t = performance.now();
      if (t - last < 250 && done < total) return;
      last = t;
      process.stderr.write(`\r  ${done} / ${total} games`);
      if (done >= total) process.stderr.write('\n');
    };
  }

  const recordsByArm = await playAll(plan, { threads: plan.threads, onProgress: progress ?? undefined });
  const wallMs = performance.now() - started;

  // Aggregate in the main thread, from the records in game-index order.
  const botTypes = [...new Set(plan.bots.map((b) => b.type))].sort();
  const arms = [];
  const failures = [];
  for (const armPlan of plan.arms) {
    const records = recordsByArm[armPlan.name];
    const ctx = { players: plan.players, botTypes, variants: armPlan.variantsResolved, modulesOn: activeModules(armPlan.variantsResolved) };
    const { aggregate, aggregateAll } = aggregateArm(records, ctx);
    for (const r of records) {
      if (r.failed) failures.push({ arm: armPlan.name, index: r.index, seed: r.seed, type: r.failed.type, seat: r.failed.seat ?? null, hash: r.failed.hash ?? null, action: r.failed.action ?? null, reason: r.failed.reason });
    }
    arms.push({
      name: armPlan.name,
      variants: armPlan.variantsResolved,
      variantsNonDefault: armPlan.variantsNonDefault,
      constants: armPlan.constants,
      gamesKept: plan.keepGames,
      aggregate,
      aggregateAll,
      games: plan.keepGames ? records : null,
    });
  }
  const comparison = plan.baseline ? compareArms(arms[0], arms[1]) : null;

  const warnings = [];
  const seedIsDefault = !argv.some((a) => a.startsWith('--seed='));
  if (plan.jitter === null && plan.bots.some((b) => b.level !== 'random')) {
    warnings.push('No --jitter given. Deterministic bots with identical preferences manufacture a first-player advantage from moving first: do not read the seat 1 win rate as a design finding until it has been re-measured with --jitter.');
  }
  if (plan.timeBudgeted) warnings.push('A bot in this run thinks for a time budget, so the games are NOT reproducible from the seed. Use --iterations=N for reproducible search.');
  if (plan.mode === 'fast') warnings.push('--fast: no events were collected, so action mix covers the driver\'s choices only and per-turn, per-quarter, lead-change, legal-action, district, economy and card-purchase figures are absent.');
  if (plan.rotate && plan.games % plan.players !== 0) warnings.push(`--rotate with ${plan.games} games and ${plan.players} players: games is not a multiple of the player count, so seat-by-bot counts differ by one between seats (see seatTypeCounts).`);
  if (!plan.keepGames) warnings.push('Per-game records were not kept (--keep-games to force them); the aggregates are complete.');

  const engine = engineCommit(REPO_ROOT);
  const totalGames = plan.games * plan.arms.length;
  const cpuMs = sum(Object.values(recordsByArm).flatMap((rs) => rs.map((r) => r.timing.ms)));
  const result = {
    schemaVersion: SCHEMA_VERSION,
    run: {
      date: startedAt.toISOString(),
      dateUk: ukDateTime(startedAt),
      engineCommit: engine.commit,
      engineDirty: engine.dirty,
      nodeVersion: process.version,
      commandLine: ['node', 'sim/sim.mjs', ...argv].join(' '),
      label: plan.label ?? defaultLabel(plan),
      seed: plan.seed,
      seedIsDefault,
      gamesPerArm: plan.games,
      players: plan.players,
      bots: plan.bots,
      rotate: plan.rotate,
      shuffleSeats: plan.shuffleSeats,
      jitter: plan.jitter,
      weights: plan.weights,
      weightsSeat: plan.weightsSeat,
      budgetMs: plan.budget,
      iterations: plan.iterations,
      timeBudgeted: plan.timeBudgeted,
      mode: plan.mode,
      maxDecisions: plan.maxDecisions,
      baseline: plan.baseline,
      threads: plan.threads,
      warnings,
      timing: { wallMs, gamesPerSecond: totalGames / (wallMs / 1000), cpuMsPerGame: cpuMs / totalGames },
    },
    arms,
    comparison,
    failures,
  };

  const label = result.run.label;
  const target = plan.out
    ? path.resolve(plan.out)
    : path.join(REPO_ROOT, 'sim-results', `${fileStamp(startedAt)}-${label}.json`);
  const written = writeUnique(target, serialise(result));

  out(formatReport({ ...result, path: written }));
  return { exitCode: failures.length > 0 ? 1 : 0, result, path: written };
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then(
    (r) => {
      process.exitCode = r.exitCode;
    },
    (e) => {
      process.stderr.write(`sim: ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 1;
    },
  );
}
