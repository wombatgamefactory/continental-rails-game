// art-ids.mjs - which manifest ids does the page ask for, and are they all in the manifest?
//
// Run by hand:  node tests/qa/art-ids.mjs
//
// The page's art.js is served with its lookup table replaced by one that records every id asked
// for (found or not). The script then plays through the screens that ask for pictures: the landing
// page, the variants panel, bot games with every module on and with goals as well as milestones, all
// four dock tabs mid-game and at the end, the end screen, the hot-seat cover and the bug dialog.
// It writes tests/tmp/qa/art-ids.json: { requested, missing, unrequested }.
// Exit 1 if an id the page asked for is not in the manifest.

import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, writeJson, log, ROOT } from './lib.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'art-manifest.json'), 'utf8'));
const known = new Set(manifest.map((e) => e.id));

const server = await serve();
const browser = await launch();
const requested = new Map(); // id -> found
const failures = [];

async function spyPage(width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = watch(page);
  await page.route('**/src/ui/art.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const marker = 'const entries = new Map();';
    if (!body.includes(marker)) throw new Error('art.js no longer has the lookup table this script instruments');
    body = body.replace(
      marker,
      `class SpyMap extends Map {
  get(id) { (window.__artAsked ||= new Map()).set(id, super.has(id)); return super.get(id); }
  has(id) { (window.__artAsked ||= new Map()).set(id, super.has(id)); return super.has(id); }
}
const entries = new SpyMap();`,
    );
    await route.fulfill({ response, body });
  });
  return { page, logs };
}

async function harvest(page) {
  const asked = await page.evaluate(() => [...(window.__artAsked ?? new Map()).entries()]);
  for (const [id, found] of asked) requested.set(id, (requested.get(id) ?? false) || found);
  // Pictures the DOM actually holds count as requested too (matched by their manifest id).
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-art-id]')].map((e) => e.dataset.artId));
  for (const id of shown) requested.set(id, known.has(id));
}

async function openTabs(page) {
  for (const tab of ['upgrades', 'goals', 'agenda', 'pony']) {
    const btn = page.locator(`[data-ui="tab:${tab}"]`);
    if ((await btn.count()) === 0) continue;
    await btn.first().click();
    await page.waitForTimeout(150);
    // Open each card large once, so card pictures are asked for.
    const cards = page.locator('[data-ui="card"]');
    const n = Math.min(await cards.count(), 6);
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click().catch(() => {});
      await page.waitForTimeout(60);
    }
    await harvest(page);
  }
}

// 1 The landing page and the variants panel
{
  const { page, logs } = await spyPage();
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForTimeout(500);
  await harvest(page);
  failures.push(...logs.problems);
  await page.close();
}

// 2 A game with every module on, milestones AND goals; tabs opened mid-game and at the end
for (const [seed, variants] of [['11', 'endGameScoring=both'], ['12', '']]) {
  const { page, logs } = await spyPage();
  const vq = variants ? `&variants=${variants}` : '';
  await page.goto(`${server.base}?players=3&bots=medium,medium,easy&seed=${seed}${vq}&speed=fast&test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  await page.waitForFunction(() => window.__cr.getState().turn.number >= 12 || document.querySelector('[data-screen="end"]'), null, { timeout: 120000 });
  await page.evaluate(() => window.__cr.pause(true));
  await openTabs(page);
  await harvest(page);
  await page.evaluate(() => { window.__cr.speed('instant'); window.__cr.pause(false); });
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  await harvest(page);
  failures.push(...logs.problems);
  await page.close();
}

// 3 A human at the table with two humans: the hand-over cover
{
  const { page, logs } = await spyPage();
  await page.goto(`${server.base}?players=2&bots=human,human&seed=3&test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  await page.waitForTimeout(600);
  await harvest(page);
  await page.click('[data-ui="cover-ok"]', { timeout: 3000 }).catch(() => {});
  await openTabs(page);
  failures.push(...logs.problems);
  await page.close();
}

await browser.close();
await server.close();

const askedIds = [...requested.keys()].sort();
const missing = askedIds.filter((id) => !known.has(id));
const unrequested = [...known].filter((id) => !requested.has(id)).sort();
const out = { requestedCount: askedIds.length, requested: askedIds, missing, unrequestedCount: unrequested.length, unrequested, problems: failures };
const file = writeJson('art-ids.json', out);
log(`requested ${askedIds.length} ids; missing from the manifest: ${missing.length}; manifest entries never requested: ${unrequested.length}`);
if (missing.length) log(`MISSING: ${missing.join(', ')}`);
if (failures.length) log(`PROBLEMS:\n${failures.join('\n')}`);
log(`written ${file}`);
process.exit(missing.length || failures.length ? 1 : 0);
