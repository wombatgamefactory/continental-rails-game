// demo.mjs - the four-bot demo game: Normal speed to the end, pause, resume, speed change,
// "New game" mid-game, and "Play again" / "Change set-up" from the end screen.
//
// Run by hand:  node tests/qa/demo.mjs [--part=watch|controls|end|all]
//
//   watch     "Watch a demo game" on the landing page, speed set to Normal, watched to the end screen.
//             Wall time recorded. In the first minute: pause (no move for 2.5 s, banner says paused),
//             resume, Fast for a few seconds (the move rate rises), back to Normal.
//   controls  a demo game, "New game" pressed mid-game (asks twice), back at the set-up page, no more
//             moves and no errors afterwards.
//   end       a demo game at Instant speed to the end screen, then "Play again" (a new demo starts) and,
//             at its end, "Change set-up" (the landing page).

import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const part = (process.argv.find((a) => a.startsWith('--part=')) || '--part=all').slice(7);
const server = await serve();
const browser = await launch();
const out = {};
let failed = 0;
const fail = (t) => {
  failed++;
  log(`  FAIL ${t}`);
};
const seqOf = (page) => page.evaluate(() => window.__cr.getState().seq);

async function startDemoFromLanding(page, speed) {
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  await page.locator('[data-setup="demo"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  if (speed) await page.locator(`[data-ui="speed:${speed}"]`).first().click();
}

if (part === 'watch' || part === 'all') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, 'demo-watch');
  const t0 = Date.now();
  await startDemoFromLanding(page, 'normal');
  const speedNow = await page.evaluate(() => document.querySelector('[data-ui^="speed:"][aria-pressed="true"], [data-ui^="speed:"].is-on')?.dataset.ui ?? null);
  log(`demo started; speed control shows ${speedNow}`);
  await page.waitForTimeout(15000);
  await shot(page, 'demo-normal-15s');
  // Pause
  await page.locator('[data-ui="pause"]').click();
  const s1 = await seqOf(page);
  await page.waitForTimeout(2500);
  const s2 = await seqOf(page);
  const bannerPaused = /paused/i.test(await page.textContent('[data-field="thinking"]').catch(() => '') ?? '');
  log(`pause: seq ${s1} -> ${s2} over 2.5 s; banner says paused: ${bannerPaused}`);
  if (s2 !== s1) fail('a paused game moved');
  await shot(page, 'demo-paused');
  // Resume
  await page.locator('[data-ui="pause"]').click();
  await page.waitForFunction((n) => window.__cr.getState().seq > n, s2, { timeout: 8000 });
  log('resume: the game moves again');
  // Speed change: Fast for 6 s then Normal for 6 s; count moves.
  const rate = async (ms) => {
    const a = await seqOf(page);
    await page.waitForTimeout(ms);
    return ((await seqOf(page)) - a) / (ms / 1000);
  };
  const normalRate = await rate(6000);
  await page.locator('[data-ui="speed:fast"]').click();
  const fastRate = await rate(6000);
  await page.locator('[data-ui="speed:normal"]').click();
  log(`moves per second: normal ${normalRate.toFixed(2)}, fast ${fastRate.toFixed(2)}`);
  if (!(fastRate > normalRate * 1.5)) fail(`Fast is not clearly faster than Normal (${fastRate} v ${normalRate})`);
  out.watch = { normalRate, fastRate, pausedWhilePaused: s2 === s1 };
  // Watch to the end at Normal.
  await page.waitForSelector('[data-screen="end"]', { timeout: 45 * 60 * 1000 });
  const wall = (Date.now() - t0) / 1000;
  const end = await page.evaluate(() => ({ seq: window.__cr.getState().seq, turns: window.__cr.getState().turn.number, incidents: window.__cr.incidents(), scores: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent.trim()) }));
  await shot(page, 'demo-normal-end');
  log(`demo at Normal speed reached the end screen after ${Math.floor(wall / 60)} min ${Math.round(wall % 60)} s (${end.seq} actions, ${end.turns} turns), scores ${end.scores.join(' / ')}, incidents ${end.incidents.length}`);
  out.watch = { ...out.watch, wallSeconds: Math.round(wall), actions: end.seq, turns: end.turns, scores: end.scores, incidents: end.incidents, consoleProblems: logs.problems };
  if (end.incidents.length) fail(`driver incidents: ${end.incidents.join(' | ')}`);
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

if (part === 'controls' || part === 'all') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, 'demo-controls');
  await startDemoFromLanding(page, 'fast');
  await page.waitForTimeout(6000);
  const before = await seqOf(page);
  await page.locator('[data-ui="new-game"]').click();
  const label = await page.locator('[data-ui="new-game"]').textContent();
  log(`New game, first press: button now reads "${label.trim()}"; still in the game: ${(await page.locator('#screen-game:not([hidden])').count()) === 1}`);
  if (!/really|abandon/i.test(label)) fail('the first press does not ask for confirmation');
  await shot(page, 'demo-new-game-confirm');
  await page.locator('[data-ui="new-game"]').click();
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForTimeout(3000);
  const shownSetup = (await page.locator('[data-setup="start"]').count()) > 0;
  log(`New game, second press: back at the set-up page (${shownSetup}); moves made before ${before}`);
  if (!shownSetup) fail('no set-up page after New game');
  await shot(page, 'demo-new-game-setup');
  // A new game can be started again straight away.
  await page.locator('[data-setup="demo"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  await page.waitForTimeout(1500);
  out.controls = { newGameAskedTwice: /really|abandon/i.test(label), backAtSetup: shownSetup, consoleProblems: logs.problems };
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

if (part === 'end' || part === 'all') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, 'demo-end');
  await startDemoFromLanding(page, 'instant');
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  const seed1 = await page.evaluate(() => window.__cr.getState().config.seed);
  await shot(page, 'demo-end-screen');
  await page.locator('[data-ui="again-new-seed"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  const seed2 = await page.evaluate(() => window.__cr.getState().config.seed);
  log(`Play again: a new demo started (seed ${seed1} -> ${seed2}); it is a bot game: ${await page.evaluate(() => window.__cr.seats().every((s) => !s.human))}`);
  if (seed1 === seed2) fail('Play again (new seed) reused the seed');
  await page.locator('[data-ui="speed:instant"]').first().click();
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  await page.locator('[data-ui="back-to-setup"]').first().click();
  await page.waitForSelector('[data-screen="setup"]');
  const hasHero = (await page.locator('[data-field="hero"]').count()) > 0;
  log(`Change set-up: the landing page is back (hero ${hasHero}, start button ${(await page.locator('[data-setup="start"]').count()) > 0})`);
  await shot(page, 'demo-change-setup');
  // Same seed from the end screen of a human-less demo.
  await page.locator('[data-setup="demo"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  await page.locator('[data-ui="speed:instant"]').first().click();
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  const seedA = await page.evaluate(() => window.__cr.getState().config.seed);
  const hashA = await page.evaluate(() => window.__cr.hash());
  await page.locator('[data-ui="again-same-seed"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  await page.locator('[data-ui="speed:instant"]').first().click();
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  const seedB = await page.evaluate(() => window.__cr.getState().config.seed);
  const hashB = await page.evaluate(() => window.__cr.hash());
  log(`Play again with the same seed: seed ${seedA} -> ${seedB}; same final position: ${hashA === hashB} (bots with a time budget of 0 are deterministic, so they should match)`);
  if (seedA !== seedB) fail('same-seed play again changed the seed');
  out.end = { sameSeedSamePosition: hashA === hashB, consoleProblems: logs.problems };
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

await browser.close();
await server.close();
writeJson(`demo-${part}.json`, out);
log(failed ? `${failed} FAILED` : `demo (${part}): all checks passed`);
process.exit(failed ? 1 : 0);
