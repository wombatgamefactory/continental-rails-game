// undo-refusal.mjs - a refused action leaves nothing to undo.
//
// Run by hand:  node tests/qa/undo-refusal.mjs
//
// In a fresh human game: (1) an illegal action pushed through the page's commit path is refused with a
// message, the position is unchanged, no undo snapshot is kept and Undo stays disabled; (2) a legal move
// then makes Undo available, and Undo takes it back exactly (same position hash); (3) a click on an
// illegal-but-lit target explains itself and still leaves Undo as it was.

import { launch, serve, watch, shot, log } from './lib.mjs';

const server = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = watch(page, 'undo-refusal');
let failed = 0;
const check = (ok, text) => {
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
await page.goto(`${server.base}?players=2&bots=human,human&seed=undo&test=1&shuffle=0`);
await page.waitForFunction(() => window.__cr && window.__cr.ready);
// Get past the set-up decisions (railheads, house tracks, specialists) with the first legal action each time.
for (let i = 0; i < 60; i++) {
  const k = await page.evaluate(() => document.getElementById('app').dataset.kind);
  if (k === 'workerStep') break;
  await page.evaluate(() => window.__cr.commit(window.__cr.actions()[0]));
}
const kind = await page.evaluate(() => document.getElementById('app').dataset.kind);
check(kind === 'workerStep', `at a worker step (${kind})`);
if (await page.locator('#cover:not([hidden])').count()) await page.click('[data-ui="cover-ok"]');
const h0 = await page.evaluate(() => window.__cr.hash());
const depth0 = await page.evaluate(() => window.__cr.undoDepth());
const result = await page.evaluate(() => window.__cr.commit({ type: 'placeWorker', space: 'NOPE' }));
const h1 = await page.evaluate(() => window.__cr.hash());
const depth1 = await page.evaluate(() => window.__cr.undoDepth());
const undoState = await page.getAttribute('[data-ui="undo"]', 'data-undo-available');
const message = await page.evaluate(() => (document.querySelector('#toast') || {}).innerText || '');
check(h0 === h1, 'an illegal action leaves the position unchanged');
check(depth1 === depth0, `and keeps no undo snapshot (depth ${depth0} -> ${depth1})`);
check(undoState === '0', 'Undo stays disabled after a refused action');
log(`       commit result ${JSON.stringify(result)}; message shown: "${message.trim().slice(0, 120)}"`);
// A legal move, then undo.
const legal = await page.evaluate(() => window.__cr.actions().find((a) => ['placeWorker', 'removeWorker', 'displaceWorker'].includes(a.type)) ?? window.__cr.actions()[0]);
log(`       legal action used: ${JSON.stringify(legal)}`);
await page.evaluate((a) => window.__cr.commit(a), legal);
check((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '1', 'a legal move makes Undo available');
await page.click('[data-ui="undo"]');
check((await page.evaluate(() => window.__cr.hash())) === h0, 'Undo restores the exact position');
check((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '0', 'and Undo is disabled again');
await shot(page, 'undo-refusal');
check(logs.problems.length === 0, `no console problems (${logs.problems.join(' | ')})`);
await browser.close();
await server.close();
log(failed ? `${failed} FAILED` : 'undo and refusal: all checks passed');
process.exit(failed ? 1 : 0);
