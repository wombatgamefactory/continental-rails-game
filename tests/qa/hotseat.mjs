// hotseat.mjs - three humans at one device: does the hand-over cover always name the right player?
//
// Run by hand:  node tests/qa/hotseat.mjs
//
// Three human seats (Anna, Ben, Cleo) play a whole game through the page's generic buttons (a random
// legal move each time, chosen by a seeded rule). Whenever the hand-over cover is up, its name must be
// the player the ENGINE says is to act (state.players[state.toAct].name), including the moments in the
// middle of somebody else's turn when a different player must decide (a toll's choice, a displaced
// worker's resource, a Pony Express card). The script counts those mid-turn decisions for a non-active
// player. It also checks that nothing on the board takes a click while the cover is up.

import { makeRng, rngNext } from '../../src/engine/index.js';
import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const server = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = watch(page, 'hotseat');
const rng = makeRng('qa-hotseat');
let failed = 0;
const fail = (t) => {
  failed++;
  if (failed < 10) log(`  FAIL ${t}`);
};

await page.goto(`${server.base}?players=3&bots=human,human,human&names=Anna,Ben,Cleo&seed=31&generic=1&shuffle=0&test=1`);
await page.waitForFunction(() => window.__cr && window.__cr.ready);

let covers = 0;
let midTurnCovers = 0;
let rightName = 0;
let decisions = 0;
const byName = {};
let swallowedProbe = false;
for (let guard = 0; guard < 20000; guard++) {
  const snap = await page.evaluate(() => {
    const s = window.__cr.getState();
    const cover = document.querySelector('#cover:not([hidden])');
    return {
      ended: s.phase === 'ended',
      toAct: s.toAct,
      turnPlayer: s.turn.player,
      want: s.players[s.toAct] ? s.players[s.toAct].name : null,
      cover: !!cover,
      coverName: cover ? (cover.querySelector('[data-field="cover-name"]') || {}).textContent : null,
      screen: document.getElementById('app').dataset.screen ?? document.body.dataset.screen,
    };
  });
  if (snap.ended || (await page.locator('[data-screen="end"]').count()) > 0) break;
  if (snap.cover) {
    covers++;
    if (snap.toAct !== snap.turnPlayer) midTurnCovers++;
    if (snap.coverName === snap.want) rightName++;
    else fail(`cover names ${snap.coverName} but ${snap.want} is to act (turn of player ${snap.turnPlayer}, to act ${snap.toAct})`);
    byName[snap.coverName] = (byName[snap.coverName] ?? 0) + 1;
    if (covers === 3 && !swallowedProbe) {
      swallowedProbe = true;
      await shot(page, 'hotseat-cover');
      const before = await page.evaluate(() => window.__cr.getState().seq);
      // The board is inert behind the cover: a click on a generic button must not play.
      await page.evaluate(() => document.querySelector('[data-field="generic"] [data-akey]')?.click());
      const after = await page.evaluate(() => window.__cr.getState().seq);
      if (before !== after) fail('a click behind the cover played a move');
    }
    await page.click('[data-ui="cover-ok"]');
    continue;
  }
  const buttons = page.locator('[data-field="generic"] [data-akey]');
  const n = await buttons.count();
  if (n === 0) {
    await page.waitForTimeout(20);
    continue;
  }
  await buttons.nth(Math.floor(rngNext(rng) * n)).click({ timeout: 4000 });
  decisions++;
}
await page.waitForSelector('[data-screen="end"]', { timeout: 20000 });
await shot(page, 'hotseat-end');
const incidents = await page.evaluate(() => window.__cr.incidents());
const result = { decisions, covers, rightName, midTurnCovers, coversByName: byName, incidents, consoleProblems: logs.problems };
writeJson('hotseat.json', result);
log(`hot-seat game with three humans: ${decisions} decisions, ${covers} hand-over covers, ${rightName} named the right player, ${midTurnCovers} of them for a mid-turn decision by a player whose turn it was not; covers by name ${JSON.stringify(byName)}`);
if (rightName !== covers) fail('a cover named the wrong player');
if (midTurnCovers === 0) log('  note: no mid-turn decision for another player came up in this game (see the 2j section of the UI smoke test, which builds one)');
if (logs.problems.length) fail(logs.problems.join(' | '));
await browser.close();
await server.close();
log(failed ? `${failed} FAILED` : 'hot-seat: all checks passed');
process.exit(failed ? 1 : 0);
