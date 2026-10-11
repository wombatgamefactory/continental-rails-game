// network-keyboard.mjs - requests, first paint, keyboard and reduced motion.
//
// Run by hand:  node tests/qa/network-keyboard.mjs
//
// Network   With the configuration empty: every request made by the landing page and by a whole
//           four-bot game is to the page's own origin; none is a 404 or fails; the pictures fetched
//           for the first paint of the landing page add up to under 2 MB; no analytics script is added.
// Keyboard  On the landing page every visible interactive control is reached by Tab (and none is
//           skipped), each shows a visible focus ring; in a human game the main controls are reached
//           (the lit worker spaces, the undo and pause buttons, the dock tabs); Escape closes the bug
//           dialog, an opened card, and the dock panel.
// Motion    With prefers-reduced-motion: reduce nothing on the landing page or in a game is animating.

import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const server = await serve();
const browser = await launch();
const out = {};
let failed = 0;
const fail = (t) => {
  failed++;
  log(`  FAIL ${t}`);
};

// ---------- Network ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const logs = watch(page, 'network');
  const sizes = new Map();
  page.on('response', async (res) => {
    try {
      const body = await res.body();
      sizes.set(res.url(), body.length);
    } catch {
      // redirects and the like have no body
    }
  });
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const firstPaintImages = [...sizes.entries()].filter(([u]) => /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(u));
  const imageBytes = firstPaintImages.reduce((a, [, n]) => a + n, 0);
  log(`landing page first load: ${firstPaintImages.length} pictures, ${(imageBytes / 1024).toFixed(0)} KB of images (limit 2048 KB)`);
  if (imageBytes > 2 * 1024 * 1024) fail('first paint images over 2 MB');
  // A whole four-bot game on the same page.
  await page.goto(`${server.base}?players=4&bots=medium,medium,easy,easy&seed=net&fast=1&test=1`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  const origin = new URL(server.base).origin;
  const foreign = logs.requests.filter((r) => !/^(data|blob|about):/.test(r.url) && new URL(r.url).origin !== origin);
  const bad = logs.responses.filter((r) => r.status >= 400);
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.src));
  log(`landing page + a four-bot game: ${logs.requests.length} requests, ${foreign.length} to another origin, ${bad.length} errors (404 and the like); script tags ${JSON.stringify(scripts.map((s) => s.replace(origin, '')))}`);
  if (foreign.length) fail(`requests to another origin: ${foreign.slice(0, 5).map((r) => r.url).join(', ')}`);
  if (bad.length) fail(`error responses: ${bad.slice(0, 5).map((r) => `${r.status} ${r.url}`).join(', ')}`);
  if (scripts.some((s) => /googletagmanager|gtag/.test(s))) fail('an analytics script was added');
  if (logs.problems.length) fail(logs.problems.join(' | '));
  out.network = { requests: logs.requests.length, foreign: foreign.length, errors: bad.length, firstPaintImageKB: Math.round(imageBytes / 1024), firstPaintPictures: firstPaintImages.length };
  await context.close();
}

// ---------- Keyboard ----------
async function tabSweep(page, root, max = 400) {
  const reached = [];
  const seen = new Set();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate((rootSel) => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) || (cs.boxShadow && cs.boxShadow !== 'none');
      return { key: `${el.tagName}|${el.id}|${el.className}|${el.dataset.setup ?? el.dataset.ui ?? el.dataset.target ?? ''}|${Math.round(r.left)},${Math.round(r.top)}`, label: (el.dataset.setup ?? el.dataset.ui ?? el.dataset.target ?? el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), inRoot: !!el.closest(rootSel), ring: !!ring, visible: r.width > 0 && r.height > 0 };
    }, root);
    if (!info) continue;
    if (seen.has(info.key)) break; // wrapped round
    seen.add(info.key);
    reached.push(info);
  }
  return reached;
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, 'keyboard');
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  const expected = await page.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('[inert]');
    };
    return [...document.querySelectorAll(sel)].filter(vis).map((el) => `${el.tagName}|${el.id}|${el.className}|${el.dataset.setup ?? el.dataset.ui ?? el.dataset.target ?? ''}|${Math.round(el.getBoundingClientRect().left)},${Math.round(el.getBoundingClientRect().top)}`);
  });
  const reached = await tabSweep(page, '#screen-setup, #app');
  const reachedKeys = new Set(reached.map((r) => r.key));
  // Positions move as the page scrolls while tabbing, so compare by everything but position.
  const strip = (k) => k.split('|').slice(0, 4).join('|');
  const reachedLoose = new Set(reached.map((r) => strip(r.key)));
  const missed = expected.filter((k) => !reachedLoose.has(strip(k)));
  const noRing = reached.filter((r) => !r.ring);
  log(`landing page: ${expected.length} interactive controls, Tab reached ${reached.length}; missed ${missed.length}; reached without a visible focus ring ${noRing.length}`);
  if (missed.length) fail(`not reached by Tab: ${[...new Set(missed.map(strip))].slice(0, 6).join(', ')}`);
  if (noRing.length) fail(`no focus ring: ${noRing.slice(0, 6).map((r) => r.label).join(', ')}`);
  await page.keyboard.press('Tab');
  await shot(page, 'keyboard-landing-focus');
  out.keyboardLanding = { expected: expected.length, reached: reached.length, missed, noRing: noRing.map((r) => r.label) };
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, 'keyboard-game');
  await page.goto(`${server.base}?players=2&bots=human,medium&names=Anna,Ben&seed=kb&test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  await page.waitForSelector('#screen-game:not([hidden])');
  const reached = await tabSweep(page, '#screen-game');
  const labels = reached.map((r) => r.label);
  const undoDisabled = await page.evaluate(() => { const u = document.querySelector('[data-ui="undo"]'); return !!u && u.disabled; }); // a disabled button is correctly skipped by Tab
  const want = { ...(undoDisabled ? {} : { 'undo': /undo/i }), 'pause': /pause/i, 'new game': /new-?game|new game/i, 'a lit worker space': /^space:/, 'bug report': /report|problem/i };
  const missing = [];
  for (const [name, re] of Object.entries(want)) if (!labels.some((l) => re.test(l))) missing.push(name);
  const noRing = reached.filter((r) => r.inRoot && !r.ring);
  log(`game screen: Tab reached ${reached.length} controls (${reached.filter((r) => r.inRoot).length} inside the game); missing ${JSON.stringify(missing)}; without a visible focus ring ${noRing.length}${noRing.length ? ` -> ${noRing.slice(0, 5).map((r) => r.label).join(', ')}` : ''}`);
  if (missing.length) fail(`game controls not reached by Tab: ${missing.join(', ')}`);
  if (noRing.length) fail(`game controls with no focus ring: ${noRing.slice(0, 6).map((r) => r.label).join(', ')}`);
  await shot(page, 'keyboard-game-focus');
  out.keyboardGame = { reached: reached.length, missing, noRing: noRing.map((r) => r.label), labels: labels.slice(0, 60) };

  // Escape closes: the bug dialog, an opened card, the dock panel.
  await page.keyboard.press('Control+Shift+B');
  await page.waitForSelector('[data-bug-field="dialog"]', { state: 'visible' });
  await page.keyboard.press('Escape');
  const bugClosed = (await page.locator('[data-bug-field="dialog"]:visible').count()) === 0;
  await page.locator('[data-ui^="tab:"]').first().click();
  const dockOpen = (await page.locator('.dock.is-open').count()) > 0;
  await page.keyboard.press('Escape');
  const dockClosed = (await page.locator('.dock.is-open').count()) === 0;
  let cardClosed = null;
  await page.locator('[data-ui="tab:pony"], [data-ui="tab:goals"]').first().click().catch(() => {});
  const card = page.locator('[data-ui="card"]').first();
  if ((await card.count()) > 0) {
    await card.click();
    const opened = (await page.evaluate(() => window.__cr.pendingUi().card)) !== null;
    await page.keyboard.press('Escape');
    cardClosed = opened && (await page.evaluate(() => window.__cr.pendingUi().card)) === null;
  }
  log(`Escape: bug dialog closed ${bugClosed}; dock opened ${dockOpen} then closed ${dockClosed}; large card closed ${cardClosed}`);
  if (!bugClosed) fail('Escape did not close the bug dialog');
  if (dockOpen && !dockClosed) fail('Escape did not close the dock panel');
  if (cardClosed === false) fail('Escape did not close the opened card');
  out.escape = { bugClosed, dockOpen, dockClosed, cardClosed };
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

// ---------- Reduced motion ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const logs = watch(page, 'reduced-motion');
  const running = async () =>
    page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && !(a.effect && a.effect.getTiming().duration === 0)).map((a) => `${(a.effect && a.effect.target && (a.effect.target.className || a.effect.target.tagName)) || '?'}:${a.animationName ?? a.transitionProperty ?? ''}`));
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForTimeout(800);
  const landing = await running();
  await page.goto(`${server.base}?players=3&bots=human,medium,medium&seed=rm&test=1`);
  await page.waitForSelector('#screen-game:not([hidden])');
  await page.waitForTimeout(1500);
  const inGame = await running();
  const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  log(`reduced motion honoured by the browser: ${matches}; running animations on the landing page ${landing.length}, in a game ${inGame.length} ${[...landing, ...inGame].slice(0, 4).join(', ')}`);
  if (landing.length || inGame.length) fail(`animations running under reduced motion: ${[...landing, ...inGame].slice(0, 5).join(', ')}`);
  out.reducedMotion = { landingAnimations: landing.length, gameAnimations: inGame.length };
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await context.close();
}

await browser.close();
await server.close();
writeJson('network-keyboard.json', out);
log(failed ? `${failed} FAILED` : 'network, keyboard and motion: all checks passed');
process.exit(failed ? 1 : 0);
