// worker.mjs - the entry of a simulator worker thread.
//
// It plays the games it is told to play and posts the compact records back. It holds no
// state between messages, so which worker plays which game cannot change a result.

import { parentPort, workerData } from 'node:worker_threads';
import { runGame } from './run-game.mjs';

const plan = workerData.plan;

parentPort.on('message', (message) => {
  if (message.type === 'run') {
    const records = [];
    for (let i = message.from; i < message.to; i++) records.push(runGame(plan, message.arm, i));
    parentPort.postMessage({ type: 'done', arm: message.arm, from: message.from, records });
  }
});
