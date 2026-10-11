// pool.mjs - plays the games of every arm across worker threads.
//
// Work is handed out in chunks of consecutive game indices. A chunk is played by
// whichever worker is free, but each record is filed under its (arm, game index), so the
// result is the same whatever the thread count and whatever order the chunks finish in.
// With one thread the games are played in this process, no worker started.

import { Worker } from 'node:worker_threads';
import { runGame } from './run-game.mjs';

/**
 * @param {object} plan the resolved plan (plain JSON)
 * @param {{ threads: number, onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<Object<string, object[]>>} arm name -> records in game-index order
 */
export async function playAll(plan, { threads, onProgress }) {
  const results = {};
  const chunks = [];
  const size = chunkSize(plan, threads);
  for (const arm of plan.arms) {
    results[arm.name] = new Array(plan.games);
    for (let from = 0; from < plan.games; from += size) chunks.push({ arm: arm.name, from, to: Math.min(plan.games, from + size) });
  }
  const total = plan.games * plan.arms.length;
  let done = 0;

  if (threads <= 1) {
    for (const chunk of chunks) {
      for (let i = chunk.from; i < chunk.to; i++) results[chunk.arm][i] = runGame(plan, chunk.arm, i);
      done += chunk.to - chunk.from;
      if (onProgress) onProgress(done, total);
    }
    return results;
  }

  const workerCount = Math.min(threads, chunks.length);
  const workers = [];
  const queue = chunks.slice();
  await new Promise((resolve, reject) => {
    let idle = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      reject(err);
    };
    const give = (worker) => {
      const chunk = queue.shift();
      if (chunk === undefined) {
        idle += 1;
        if (idle === workerCount) resolve();
        return;
      }
      worker.postMessage({ type: 'run', ...chunk });
    };
    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { plan } });
      workers.push(worker);
      worker.on('message', (message) => {
        if (message.type !== 'done') return;
        for (let k = 0; k < message.records.length; k++) results[message.arm][message.from + k] = message.records[k];
        done += message.records.length;
        if (onProgress) onProgress(done, total);
        give(worker);
      });
      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (code !== 0) fail(new Error(`A simulator worker exited with code ${code}.`));
      });
      give(worker);
    }
  }).finally(async () => {
    await Promise.all(workers.map((w) => w.terminate()));
  });
  return results;
}

/** Chunk size: small enough to balance the load, large enough that messaging is not the cost. */
export function chunkSize(plan, threads) {
  if (plan.timeBudgeted) return 1;
  const perArm = plan.games;
  return Math.max(1, Math.min(50, Math.ceil(perArm / (Math.max(1, threads) * 8))));
}
