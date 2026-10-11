// ui-smoke.mjs - drives the real page in the installed Chrome (or Edge).
//
// NOT part of `npm test` (it needs a browser). Run with `npm run test:ui`.
//
// Starts tools/serve.mjs on a free port, launches the browser through
// playwright-core (channel 'chrome', falling back to 'msedge'; nothing is ever
// downloaded), and FAILS on any console error, page error, failed request or
// HTTP error. Sections:
//
//   1  a four-bot game (random bots, instant speed, every module on) reaches the end screen
//   2  scripted human segments through the BESPOKE controls: place, remove, displace,
//      choose a district with and without a hat, gather, a bonus action, train
//      activation use and skip, a Congress entry, a route claim, a move, stop,
//      a railway station, a telegraph station, a discard, a resource choice,
//      and the setup choices (railhead, house track, specialist)
//   3  undo: a move is undone (state hash returns), and undo is gone once the turn passes
//   4  hot-seat: the "pass the device" cover between two human seats and the hand-back
//   5  the generic layer alone (?generic=1) finishes a human-driven game
//   6  screenshots at 1440 x 900 and 1024 x 768 into tests/tmp/ui/
//  20 the landing page as a pitch, the layout at four widths, floating things, reduced
//      motion, text contrast, and the final screenshots into tests/tmp/ui/final/
//
// Situations that need a specific position are loaded through the test hook
// window.__cr.loadState (only present with ?test=1): the state is built with the
// engine in Node, serialised, and handed to the page.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from '../tools/serve.mjs';
import { writeEvidence } from './helpers/tmp.mjs';
import * as E from '../src/engine/index.js';
import { start, put, give, setHeads, setTrain, claim } from './helpers/rig.mjs';
import { startWith, giveTokens, stock, ownCard, installTile, gatherCoinsTurn } from './helpers/modules.mjs';

// Test-only dummy values for the configuration override; built from parts so that the source holds no address or id.
const DUMMY_USER = 'tester';
const DUMMY_HOST = ['example', 'invalid'].join('.');
const DUMMY_GA = ['G', 'TEST123456'].join('-');

const UPGRADES_V = { moduleCarriageUpgrades: true };
const PONY_V = { modulePonyExpress: true };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'tmp', 'ui');
fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
const results = [];
let currentTest = 'startup';
const t0 = Date.now();

function log(text) {
  process.stdout.write(`${text}\n`);
}

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (err) {
    log(`chrome not available (${err.message.split('\n')[0]}); trying msedge`);
    return await chromium.launch({ channel: 'msedge' });
  }
}

/** Watches a page: any console error, page error, failed request or HTTP error is a problem. */
function watch(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${currentTest}] console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${currentTest}] page error: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`[${currentTest}] request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[${currentTest}] HTTP ${res.status()}: ${res.url()}`);
  });
  page.on('dialog', (d) => d.dismiss());
}

// UI_ONLY=2a runs only the sections whose name starts with "2a" (handy while developing).
const ONLY = process.env.UI_ONLY || '';

async function test(name, fn) {
  if (ONLY && !name.startsWith(ONLY)) return;
  currentTest = name;
  const before = problems.length;
  const started = Date.now();
  try {
    await fn();
    const newProblems = problems.length - before;
    if (newProblems > 0) throw new Error(`${newProblems} console/page/request problem(s) during this section`);
    results.push({ name, ok: true, ms: Date.now() - started });
    log(`  ok   ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err.message });
    log(`  FAIL ${name}: ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

let BASE = '';

async function newPage(browser, w = 1440, h = 900) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  watch(page);
  return page;
}

/**
 * Waits until the set-up screen is on screen AND the page's script has finished starting. The screen's data
 * attribute is in the static HTML, so waiting for it alone returns before the bug button is mounted and
 * before window.__cr exists (every page here is opened with ?test=1).
 */
async function waitSetup(page) {
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForFunction(() => window.__cr && window.__cr.ready && document.getElementById('bug-report-btn'), null, { timeout: 10000 });
}

async function kind(page) {
  return page.evaluate(() => document.getElementById('app').dataset.kind);
}

/** Waits until the root element's data attribute has a value (the page's own state, not the layout). */
async function waitData(page, attr, value, timeout = 8000) {
  await page.waitForFunction(([a, v]) => document.getElementById('app').dataset[a] === v, [attr, value], { timeout });
}

async function waitKind(page, wanted, timeout = 5000) {
  try {
    await waitData(page, 'kind', wanted, timeout);
  } catch {
    throw new Error(`expected the pending decision "${wanted}", the page shows "${await kind(page)}"`);
  }
}

/** Selector of the element to click for a target key (the legal marker proves it is a bespoke control). */
function targetSelector(key) {
  const [type, id] = key.split(':');
  if (type === 'route') return `g[data-target="${key}"][data-legal="1"] rect >> nth=0`;
  if (type === 'city') return `g[data-target="${key}"][data-legal="1"] .city__disc`;
  return `[data-target="${key}"][data-legal="1"]`;
}

async function clickTarget(page, key) {
  try {
    await page.locator(targetSelector(key)).click({ timeout: 3000, force: key.startsWith('route:') || key.startsWith('city:') });
  } catch (err) {
    throw new Error(`target ${key} is not clickable as a legal bespoke control (kind ${await kind(page)}): ${err.message.split('\n')[0]}`);
  }
}

async function clickAkey(page, key) {
  try {
    await page.locator(`[data-akey="${key}"][data-legal="1"]`).first().click({ timeout: 3000 });
  } catch (err) {
    throw new Error(`action button ${key} not available (kind ${await kind(page)}): ${err.message.split('\n')[0]}`);
  }
}

async function hasTarget(page, key) {
  return (await page.locator(targetSelector(key)).count()) > 0;
}

async function hasAkey(page, key) {
  return (await page.locator(`[data-akey="${key}"]`).count()) > 0;
}

const evalState = (page, fn, arg) => page.evaluate(fn, arg);

async function loadPrepared(page, state, seats = ['human', 'random'], { paused = true } = {}) {
  await page.goto(`${BASE}?test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  const text = E.serialiseState(state);
  await page.evaluate(([t, s, p]) => {
    window.__cr.loadState(t, s);
    window.__cr.pause(p);
  }, [text, seats, paused]);
}

async function shot(page, name, w, h) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const file = path.join(SHOTS, `${name}-${w}x${h}.png`);
  writeEvidence(file, await page.screenshot());
  if (w < 1300) writeEvidence(path.join(SHOTS, `${name}-${w}x${h}-full-page.png`), await page.screenshot({ fullPage: true }));
  return file;
}

async function hash(page) {
  return page.evaluate(() => window.__cr.hash());
}

async function player(page, id) {
  return page.evaluate((i) => JSON.parse(JSON.stringify(window.__cr.getState().players[i])), id);
}

// ---------------------------------------------------------------------------
// Prepared states (built with the engine in Node)
// ---------------------------------------------------------------------------

const COLOURS = ['#c0392b', '#e07b00', '#8a3fb0', '#d6478f'];

/** The engine's test rig gives the players no colour; give them the setup screen's. */
function paint(state) {
  state.players.forEach((p, i) => {
    p.colour = COLOURS[i % COLOURS.length];
  });
  return state;
}

/** A two-player game at Anna's worker step: Anna has stock, hats, coins. */
function baseState(options = {}) {
  const s = paint(start(2, { variants: options.variants }));
  give(s, 0, { resources: { iron: 3, wood: 1, gunpowder: 2 }, coins: 4, hats: 1, ...(options.give ?? {}) });
  return s;
}

/** A mid-game position for the early-game screenshot: random play for a while, then Anna to move. */
function midGameState() {
  const state = E.createGame({ players: [{ name: 'Anna' }, { name: 'Ben' }, { name: 'Cara' }], seed: 11, shuffleSeats: false });
  const rng = E.makeRng('shots');
  let guard = 0;
  while (!E.isGameOver(state) && guard++ < 4000) {
    const frame = E.topFrame(state);
    if (state.turn.number >= 24 && state.toAct === 0 && frame.kind === 'workerStep') break;
    E.applyAction(state, E.rngPick(rng, E.getValidActions(state)), E.SILENT);
  }
  return paint(state);
}

/** A finished two-player game, for the end screen at any viewport. */
function endedState() {
  const state = E.createGame({ players: [{ name: 'Anna' }, { name: 'Ben' }, { name: 'Cara' }, { name: 'Dev' }], seed: 3, shuffleSeats: false });
  const rng = E.makeRng('end');
  let guard = 0;
  while (!E.isGameOver(state) && guard++ < 20000) E.applyAction(state, E.rngPick(rng, E.getValidActions(state)), E.SILENT);
  return paint(state);
}

// ---------------------------------------------------------------------------
// 1 - four bots
// ---------------------------------------------------------------------------

async function fourBotGame(browser) {
  const page = await newPage(browser);
  const started = Date.now();
  await page.goto(`${BASE}?players=4&bots=random,random,random,random&fast=1&seed=5&test=1`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  const ranks = await page.$$eval('th[data-rank]', (els) => els.map((e) => Number(e.dataset.rank)));
  assert(ranks.length === 4, `the end screen shows four ranked scores, found ${ranks.length}`);
  assert(ranks.join(',') === '1,2,3,4', `ranks are 1 to 4 in order, got ${ranks.join(',')}`);
  const totals = await page.$$eval('[data-total]', (els) => els.map((e) => e.textContent.trim()));
  assert(totals.length === 4 && totals.every((t) => /^\d+$/.test(t)), 'four numeric totals');
  const seed = await page.$eval('[data-screen="end"] [data-field="seed"]', (e) => e.textContent);
  assert(seed === '5', 'the seed is shown on the end screen');
  assert((await page.locator('.badge--bot').count()) >= 4, 'seat badges are shown');
  assert((await page.evaluate(() => window.__cr.incidents().length)) === 0, 'no bot driver incidents (no refused bot action)');
  const state = await page.evaluate(() => window.__cr.getState());
  const modules = Object.keys(state.modules).sort().join(',');
  assert(modules.includes('pony') && modules.includes('upgrades') && modules.includes('legislative'), `all modules on (${modules})`);
  await shot(page, 'end-four-bots', 1440, 900);
  await page.click('[data-ui="view-board"]');
  assert((await page.locator('#end:not([hidden])').count()) === 0, 'the end screen can be put aside to look at the final board');
  assert((await page.locator('[data-ui="show-end"]').count()) === 1, 'and brought back');
  await shot(page, 'final-board', 1440, 900);
  log(`       four-bot game: ${((Date.now() - started) / 1000).toFixed(1)} s, scores ${totals.join(' / ')}, ${state.seq} actions`);
  await page.close();
}

async function mixedBots(browser) {
  const levels = await (async () => {
    const mod = await import('../src/bots/index.js');
    return mod.BOT_LEVELS.map((l) => l.id);
  })();
  const pick = ['random', 'easy', 'medium', 'medium'].map((id) => (levels.includes(id) ? id : 'random'));
  const page = await newPage(browser);
  const started = Date.now();
  await page.goto(`${BASE}?players=4&bots=${pick.join(',')}&fast=1&seed=21&test=1`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
  assert((await page.evaluate(() => window.__cr.incidents().length)) === 0, 'no bot driver incidents with the registered bot levels');
  assert((await page.locator('th[data-rank]').count()) === 4, 'four ranked scores');
  log(`       bots ${pick.join(', ')}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 2 - scripted human segments
// ---------------------------------------------------------------------------

async function setupChoices(browser) {
  const page = await newPage(browser);
  await page.goto(`${BASE}?players=2&bots=human,random&seed=7&test=1&speed=instant`);
  await page.waitForSelector('#app[data-phase="setup"]');
  const seen = new Set();
  for (let guard = 0; guard < 20; guard++) {
    await page.waitForFunction(() => document.getElementById('app').dataset.human === '1' || document.getElementById('app').dataset.phase === 'play' && document.getElementById('app').dataset.kind === 'workerStep', { timeout: 8000 });
    const k = await kind(page);
    seen.add(k);
    if (k === 'setupRailhead') {
      await page.locator('g[data-city][data-legal="1"] .city__disc').first().click({ force: true });
    } else if (k === 'setupProduction') {
      await clickTarget(page, 'house:wood');
    } else if (k === 'setupSpecialist') {
      await page.locator('[data-panel="specialist-start"] [data-akey]').first().click();
    } else if (k === 'chooseResource') {
      await page.locator('[data-panel="resource"] [data-akey]').first().click();
    } else if (k === 'workerStep') {
      break;
    } else {
      throw new Error(`unexpected setup decision ${k}`);
    }
  }
  assert(seen.has('setupRailhead') && seen.has('setupProduction') && seen.has('setupSpecialist'), `setup decisions seen: ${[...seen].join(', ')}`);
  assert((await kind(page)) === 'workerStep', 'setup ends at the worker step');
  await page.close();
}

async function placeHatGatherBonus(browser) {
  const page = await newPage(browser);
  const state = baseState();
  await loadPrepared(page, state);
  await waitKind(page, 'workerStep');
  await clickTarget(page, 'space:W11'); // PLACE: between Gather Wood and Tunnel Tracks
  await waitKind(page, 'chooseDistrict');
  assert(await hasTarget(page, 'district:D7'), 'Gather Wood is lit');
  assert(await hasTarget(page, 'district:D8'), 'Tunnel Tracks is lit');
  assert((await page.getAttribute('.district[data-district="D7"] .district__badge', 'data-multiplier')) === '1', 'multiplier badge without a hat is x1');
  await page.check('[data-ui="toggle-hat"]'); // hat toggle
  assert((await page.getAttribute('.district[data-district="D7"] .district__badge', 'data-multiplier')) === '2', 'multiplier badge with a hat is x2');
  await page.uncheck('[data-ui="toggle-hat"]');
  assert((await page.getAttribute('.district[data-district="D7"] .district__badge', 'data-multiplier')) === '1', 'toggling the hat off restores x1');
  await page.check('[data-ui="toggle-hat"]');
  const before = (await player(page, 0)).resources.wood;
  await clickTarget(page, 'district:D7'); // CHOOSE with a hat
  await waitKind(page, 'bonusAction');
  const after = await player(page, 0);
  assert(after.resources.wood === before + 2, `gathered Wood with a hat: x2 of production 1 (was ${before}, now ${after.resources.wood})`);
  assert(after.hats === 0, 'the hat was spent');
  assert(await hasAkey(page, 'skipBonusAction'), 'the bonus action can be skipped');
  await clickAkey(page, 'buyHat'); // BONUS ACTION through its panel
  const done = await player(page, 0);
  assert(done.hats === 1, `Buy Hat gave a hat back (hats ${done.hats})`);
  assert(done.resources.gunpowder === 1, 'Buy Hat cost 1 Gunpowder');
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'the turn passed to Ben');
  await page.close();
}

async function gatherWithoutHat(browser) {
  const page = await newPage(browser);
  const state = baseState();
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W3'); // between Gather Gunpowder and Ground Tracks
  await waitKind(page, 'chooseDistrict');
  assert(!(await page.locator('[data-ui="toggle-hat"]').isChecked()), 'the hat toggle starts off');
  const before = (await player(page, 0)).resources.gunpowder;
  await clickTarget(page, 'district:D1'); // CHOOSE without a hat
  const after = await player(page, 0);
  assert(after.resources.gunpowder === before + 1, 'Gather Gunpowder gave production x1');
  assert(after.hats === 1, 'no hat was spent');
  await page.close();
}

async function removeAndActivate(browser) {
  const page = await newPage(browser);
  const state = baseState({ give: { hats: 0, resources: { iron: 7, wood: 0, gunpowder: 1 } } });
  setTrain(state, 0, [['crew', 'crew']]);
  put(state, 0, 'W6'); // Anna already has a worker between Ground Tracks and Lay Tracks
  await loadPrepared(page, state);
  await waitKind(page, 'workerStep');
  await clickTarget(page, 'space:W6'); // REMOVE: click her own worker
  // Lay Tracks has no legal claim or move for her, so Ground Tracks is the only action: the engine takes it.
  await waitKind(page, 'trainActivation');
  assert((await page.locator('[data-field="activation"] .astep').count()) >= 3, 'the activation shows its steps');
  assert((await page.locator('.astep--current').count()) === 1, 'exactly one step is highlighted as current');
  assert(await hasAkey(page, 'useStep') && await hasAkey(page, 'skipStep'), 'Use and Skip are offered');
  const builtBefore = (await player(page, 0)).builtTiles.ground;
  await clickAkey(page, 'useStep'); // USE: Foreman crew builds Ground
  const afterUse = await player(page, 0);
  assert(afterUse.builtTiles.ground === builtBefore + 1, 'the Foreman built a Ground tile into storage');
  await waitKind(page, 'trainActivation');
  await clickAkey(page, 'skipStep'); // SKIP the first Crew
  await waitKind(page, 'trainActivation');
  await clickAkey(page, 'skipStep'); // SKIP the second Crew
  const end = await player(page, 0);
  assert(end.builtTiles.ground === builtBefore + 1, 'a skipped step builds nothing');
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'the turn passed to Ben');
  await page.close();
}

async function congressSegment(browser) {
  const page = await newPage(browser);
  const state = baseState();
  setTrain(state, 0, [['financier', 'crew']]);
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W2'); // Lobby Congress / Gather Iron
  await waitKind(page, 'chooseDistrict');
  await clickTarget(page, 'district:D2');
  await waitKind(page, 'trainActivation');
  assert((await page.locator('[data-field="lobby"]').count()) === 1, 'the Congress strip shows the lobby points');
  assert(await hasTarget(page, 'congress:C2'), 'a Congress entry lights up when lobby points are in hand');
  const iron = (await player(page, 0)).resources.iron;
  await clickTarget(page, 'congress:C2'); // CONGRESS ENTRY: gain 2 Iron
  const afterEntry = await player(page, 0);
  assert(afterEntry.resources.iron === iron + 2, 'the Congress entry gave 2 Iron');
  assert(afterEntry.coins === 3, 'the entry cost 1 Coin');
  let closed = 0;
  for (let guard = 0; guard < 8 && (await kind(page)) === 'trainActivation'; guard++) {
    if (await hasAkey(page, 'closeCongress')) {
      await clickAkey(page, 'closeCongress');
      closed++;
    } else if (await hasAkey(page, 'useStep')) {
      await clickAkey(page, 'useStep');
    } else {
      await clickAkey(page, 'skipStep');
    }
  }
  assert(closed >= 1, 'a Congress window was closed with the button');
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'the turn passed to Ben');
  await page.close();
}

async function layTracksTelegraph(browser, takeShots) {
  const page = await newPage(browser);
  const state = baseState();
  setHeads(state, 0, 'SEA', 'OMA');
  give(state, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W6'); // Ground Tracks / Lay Tracks
  await waitKind(page, 'chooseDistrict');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  assert(await hasTarget(page, 'route:SEA-SPO'), 'a claimable route is lit on the map');
  assert((await page.locator('g.route.is-legal .routecost').count()) >= 1, 'a lit route shows its tile cost');
  if (takeShots) await takeShots('lay-tracks');
  const tilesBefore = (await player(page, 0)).builtTiles.ground;
  await clickTarget(page, 'route:SEA-SPO'); // CLAIM a route (2 Ground)
  await waitKind(page, 'placeBuildings');
  const afterClaim = await player(page, 0);
  assert(afterClaim.builtTiles.ground === tilesBefore - 2, 'the claim spent 2 built Ground tiles');
  assert((await page.evaluate(() => window.__cr.getState().map.routeOwner['SEA-SPO'])) === 0, 'Anna owns Seattle - Spokane');
  assert(await hasAkey(page, 'placeRailwayStation:SPO:wood'), 'the railway station choice names the house track');
  assert((await page.locator('[data-panel="buildings:SPO"] .btn__sub').count()) >= 2, 'the building choice explains its effect');
  const vp = (await player(page, 0)).vp.telegraph;
  await clickAkey(page, 'placeTelegraphStation:SPO'); // TELEGRAPH STATION
  const after = await player(page, 0);
  assert(after.vp.telegraph > vp, 'the telegraph station scored VP');
  assert((await page.evaluate(() => window.__cr.getState().map.telegraphStation.SPO)) === 0, 'the telegraph station is on Spokane');
  await page.close();
}

async function layTracksRailway(browser) {
  const page = await newPage(browser);
  const state = baseState();
  setHeads(state, 0, 'SEA', 'OMA');
  give(state, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  await clickTarget(page, 'route:SEA-SPO');
  await waitKind(page, 'placeBuildings');
  const prodBefore = await page.evaluate(() => window.__cr.getState().players[0].houses.wood);
  await clickAkey(page, 'placeRailwayStation:SPO:wood'); // RAILWAY STATION, taking a house from the Wood track
  const after = await page.evaluate(() => window.__cr.getState());
  assert(after.players[0].houses.wood === prodBefore - 1, 'a house left the Wood track of the player board');
  assert(after.map.railwayStation.SPO === 0, 'the railway station is on Spokane');
  await page.close();
}

async function moveTrain(browser, takeShots) {
  const page = await newPage(browser);
  const state = baseState();
  setHeads(state, 0, 'SEA', 'OMA');
  claim(state, 1, 'SEA-SPO');
  put(state, 0, 'W4'); // an adjacent worker makes M = 2 for Lay Tracks
  give(state, 0, { tiles: { ground: 2, tunnel: 2, bridge: 2 }, hats: 0, coins: 5 }); // several legal steps, so none is made for her
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W6');
  await waitKind(page, 'chooseDistrict');
  assert((await page.getAttribute('.district[data-district="D5"] .district__badge', 'data-multiplier')) === '2', 'Lay Tracks shows x2 with an adjacent worker');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  assert(await hasTarget(page, 'city:SPO'), 'a move destination is lit');
  if (takeShots) await takeShots('move-train');
  await clickTarget(page, 'city:SPO'); // MOVE the railhead along a claimed route
  const heads = await page.evaluate(() => window.__cr.getState().players[0].railheads);
  assert(heads.includes('SPO'), `the railhead moved to Spokane (${heads.join(', ')})`);
  await waitKind(page, 'placeBuildings');
  await clickAkey(page, 'skipBuilding');
  await waitKind(page, 'layTracks');
  await clickAkey(page, 'stopLaying'); // STOP
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'the turn passed to Ben');
  await page.close();
}

async function discardOnOverflow(browser) {
  const page = await newPage(browser);
  const state = baseState({ give: { resources: { iron: 1, wood: 1, gunpowder: 1 }, hats: 0 } });
  give(state, 0, { tiles: { ground: 6 } }); // 9 of 9 used: any gain overflows
  await loadPrepared(page, state);
  await clickTarget(page, 'space:W2');
  await clickTarget(page, 'district:D3'); // Gather Iron: production 2
  await waitKind(page, 'discard');
  assert(await hasTarget(page, 'store:iron'), 'storage items are clickable while discarding');
  const used = async () => page.evaluate(() => { const p = window.__cr.getState().players[0]; return p.resources.iron + p.resources.wood + p.resources.gunpowder + p.builtTiles.ground + p.builtTiles.tunnel + p.builtTiles.bridge; });
  const startUsed = await used();
  assert(startUsed > 9, `storage is over capacity (${startUsed})`);
  for (let guard = 0; guard < 5 && (await kind(page)) === 'discard'; guard++) await clickTarget(page, 'store:iron'); // DISCARD
  assert((await used()) === 9, 'discarding brought storage back to its capacity');
  await page.close();
}

async function displaceAndHotSeat(browser, takeShots) {
  const page = await newPage(browser);
  const state = baseState({ give: { hats: 0 } });
  put(state, 1, 'W2');
  put(state, 1, 'W5'); // both worker spaces of Gather Iron are Ben's
  give(state, 1, { hats: 2 });
  await loadPrepared(page, state, ['human', 'human']);
  await waitData(page, 'cover', '1');
  const coverName = await page.textContent('[data-field="cover-name"]');
  assert(/Anna/.test(coverName), `the cover names the first player (${coverName.trim()})`);
  assert((await page.locator('#cover:not([hidden])').count()) === 1, 'the cover is shown before anything is revealed');
  if (takeShots) await takeShots('pass-the-device');
  await page.click('[data-ui="cover-ok"]');
  await waitData(page, 'cover', '0');
  // A click on something that is not legal explains itself, with the engine's own reason.
  await page.locator('[data-target="space:W2"]').click();
  const refusal = await page.textContent('[data-field="notice"]');
  assert(refusal && refusal.length > 10, `a refused click says why (${refusal})`);
  await clickTarget(page, 'centre:D3'); // DISPLACE a blocked district
  const afterDisplace = await page.evaluate(() => window.__cr.getState());
  assert(afterDisplace.grid.spaces.W2 === null && afterDisplace.grid.spaces.W5 === null, "Ben's workers returned to his supply");
  // Ben already holds 2 hats, so he is asked to take a resource: a decision for a player who is not the active one.
  await waitKind(page, 'chooseResource');
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'Ben is asked, mid-turn');
  await waitData(page, 'cover', '1');
  assert(/Ben/.test(await page.textContent('[data-field="cover-name"]')), 'the cover now names Ben');
  await page.click('[data-ui="cover-ok"]');
  for (let guard = 0; guard < 4 && (await kind(page)) === 'chooseResource'; guard++) {
    await page.locator('[data-panel="resource"] [data-akey]').first().click(); // RESOURCE CHOICE
    if ((await page.evaluate(() => window.__cr.getState().toAct)) !== 1) break;
  }
  // Control returns to Anna: a second cover.
  await waitData(page, 'cover', '1');
  assert(/Anna/.test(await page.textContent('[data-field="cover-name"]')), 'the device is handed back to Anna');
  await page.click('[data-ui="cover-ok"]');
  assert((await page.evaluate(() => window.__cr.getState().turn.player)) === 0, "it is still Anna's turn");
  assert((await kind(page)) === 'bonusAction', 'Anna continues with the Hire Specialist bonus action of the displaced district');
  await clickAkey(page, 'skipBonusAction');
  await page.close();
}

// ---------------------------------------------------------------------------
// 3 - undo
// ---------------------------------------------------------------------------

async function undoSegment(browser) {
  const page = await newPage(browser);
  await loadPrepared(page, baseState());
  const h0 = await hash(page);
  assert((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '0', 'nothing to undo at the start');
  await clickTarget(page, 'space:W11');
  const h1 = await hash(page);
  assert(h1 !== h0, 'placing a worker changed the state');
  assert((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '1', 'undo is available after a move');
  await page.check('[data-ui="toggle-hat"]');
  await page.click('[data-ui="undo"]');
  assert((await hash(page)) === h0, 'undo returned the state hash to its earlier value');
  assert((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '0', 'undo is gone at the start of the run');
  await waitKind(page, 'workerStep');
  // Two steps and back one: undo goes back one choice at a time within the run.
  await clickTarget(page, 'space:W11');
  const h2 = await hash(page);
  await clickTarget(page, 'district:D7');
  assert((await hash(page)) !== h2, 'choosing a district changed the state');
  await page.click('[data-ui="undo"]');
  assert((await hash(page)) === h2, 'undo went back one choice');
  assert(!(await page.locator('[data-ui="toggle-hat"]').isChecked()), 'the hat toggle was reset by the undo');
  // Finish the turn: undo must be gone once the turn has passed.
  await clickTarget(page, 'district:D7');
  for (let guard = 0; guard < 4 && (await page.evaluate(() => window.__cr.getState().toAct)) === 0; guard++) {
    if (await hasAkey(page, 'skipBonusAction')) await clickAkey(page, 'skipBonusAction');
  }
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'the turn passed to Ben');
  assert((await page.getAttribute('[data-ui="undo"]', 'data-undo-available')) === '0', 'undo is unavailable once the turn has passed');
  assert((await page.evaluate(() => window.__cr.undoDepth())) === 0, 'the undo stack was cleared');
  await page.close();
}

// ---------------------------------------------------------------------------
// 7 and 8 - bots: pacing, pause, the failure cap
// ---------------------------------------------------------------------------

async function botPacing(browser) {
  const page = await newPage(browser);
  await loadPrepared(page, baseState({ give: { hats: 0 } }), ['human', 'random'], { paused: false });
  await page.evaluate(() => window.__cr.speed('normal'));
  await clickTarget(page, 'space:W3');
  await clickTarget(page, 'district:D1'); // Gather Gunpowder: no bonus action here, so the turn passes to the bot
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, "Ben (the bot) is to act");
  const thinking = await page.textContent('[data-field="thinking"]');
  assert(/thinking/.test(thinking), `a thinking indicator is shown (${thinking.trim()})`);
  await page.click('[data-ui="pause"]');
  const seq = await page.evaluate(() => window.__cr.getState().seq);
  await page.waitForTimeout(1600);
  assert((await page.evaluate(() => window.__cr.getState().seq)) === seq, 'a paused bot does not move');
  assert(/paused/.test(await page.textContent('[data-field="thinking"]')), 'the banner says the bot is paused');
  await page.click('[data-ui="pause"]');
  await page.waitForFunction((n) => window.__cr.getState().seq > n, seq, { timeout: 6000 });
  assert((await page.locator('.log__bot').count()) >= 1, "the bot's action is in the log, marked as a bot move");
  await page.close();
}

/**
 * The pacing delay belongs to the bots that move at once. A search bot (Hard, Expert) thinks for
 * seconds already, so the page asks it for its move after a short highlight pause only; the full
 * 0.85 s before each decision would stack on top of its thinking.
 */
async function botPacingLevels(browser) {
  const { pacingFor, PACING, HIGHLIGHT_PAUSE } = await import('../src/ui/bot-driver.js');
  const { BOT_LEVELS } = await import('../src/bots/index.js');
  for (const level of BOT_LEVELS) {
    for (const speed of ['normal', 'fast', 'instant']) {
      const expected = level.defaultTimeBudgetMs > 0 ? HIGHLIGHT_PAUSE[speed] : PACING[speed];
      assert(pacingFor(level.id, speed) === expected, `${level.id} at ${speed} waits ${expected} ms (got ${pacingFor(level.id, speed)})`);
    }
  }
  assert(pacingFor('hard', 'normal') < pacingFor('medium', 'normal') / 2, 'a search bot waits well under half the pause of an instant bot at normal speed');
  assert(pacingFor('expert', 'instant') === 0 && pacingFor('hard', 'instant') === 0, 'instant speed waits for nothing');
  assert(HIGHLIGHT_PAUSE.normal > 0, 'a short highlight pause is kept at normal speed');

  // In the page: how long after a human's turn ends does the first message reach the bot worker?
  const delays = {};
  for (const level of ['medium', 'hard']) {
    const page = await newPage(browser);
    await page.addInitScript(() => {
      window.__posts = [];
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (...args) {
        window.__posts.push(performance.now());
        return original.apply(this, args);
      };
    });
    await loadPrepared(page, baseState({ give: { hats: 0 } }), ['human', level], { paused: false });
    await page.evaluate(() => window.__cr.speed('normal'));
    await clickTarget(page, 'space:W3');
    await clickTarget(page, 'district:D1');
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => window.__posts.length > 0, null, { timeout: 5000 });
    delays[level] = (await page.evaluate(() => window.__posts[0])) - t0;
    assert(/thinking/.test(await page.textContent('[data-field="thinking"]')), `the thinking indicator is up for the ${level} bot`);
    await page.close();
  }
  log(`       first request to the bot worker after the human's turn: medium ${delays.medium.toFixed(0)} ms, hard ${delays.hard.toFixed(0)} ms`);
  assert(delays.medium > 600, `an instant bot is paced at normal speed (${delays.medium.toFixed(0)} ms)`);
  assert(delays.hard < 600, `a search bot is asked for its move after the short pause only (${delays.hard.toFixed(0)} ms)`);
}

async function botFailureCap(browser) {
  const page = await newPage(browser);
  await loadPrepared(page, baseState(), ['random', 'random'], { paused: true });
  await page.evaluate(() => { window.__cr.speed('instant'); window.__cr.injectBotFaults(3); });
  const seq = await page.evaluate(() => window.__cr.getState().seq);
  await page.evaluate(() => window.__cr.pause(false));
  // The log shows the newest 120 entries and instant bots fill it fast: look for the notice the moment it is drawn.
  await page.waitForFunction(() => window.__cr.incidents().some((t) => /random legal action/.test(t)) && /Driver notice/.test(document.getElementById('region-log').textContent), null, { timeout: 8000, polling: 'raf' });
  const incidents = await page.evaluate(() => window.__cr.incidents());
  assert(incidents.filter((t) => /Bot failure/.test(t)).length === 3, `three failures were counted (${incidents.length} incidents)`);
  await page.waitForFunction((n) => window.__cr.getState().seq > n + 3, seq, { timeout: 8000 });
  await page.close();
}

// ---------------------------------------------------------------------------
// 5 - the generic layer alone
// ---------------------------------------------------------------------------

async function genericOnly(browser) {
  const page = await newPage(browser);
  const started = Date.now();
  await page.goto(`${BASE}?players=2&bots=human,random&seed=9&generic=1&fast=1&test=1`);
  let clicks = 0;
  for (; clicks < 6000; clicks++) {
    if ((await page.locator('[data-screen="end"]').count()) > 0) break;
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('[data-field="generic"] [data-akey]');
      if (!el) return false;
      el.click();
      return true;
    });
    if (!clicked) await page.waitForTimeout(20);
  }
  await page.waitForSelector('[data-screen="end"]', { timeout: 5000 });
  assert((await page.locator('[data-target][data-legal="1"]').count()) === 0, 'no bespoke control was lit in generic mode');
  const ranks = await page.$$eval('th[data-rank]', (els) => els.length);
  assert(ranks === 2, 'the end screen shows both players');
  log(`       generic layer: ${clicks} clicks, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 6 - screenshots
// ---------------------------------------------------------------------------

async function screenshots(browser, w, h) {
  const page = await newPage(browser, w, h);
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  await shot(page, 'setup', w, h);

  // Early game: a mid-game position at Anna's worker step.
  const mid = midGameState();
  await loadPrepared(page, mid, ['human', 'random', 'random']);
  await waitKind(page, 'workerStep');
  await shot(page, 'early-game', w, h);

  // A train activation, mid-way through its steps.
  const act = baseState();
  setTrain(act, 0, [['crew', 'miner'], ['engineer', 'financier']]);
  give(act, 0, { resources: { iron: 4, wood: 2, gunpowder: 2 }, tiles: { ground: 1, tunnel: 0, bridge: 0 }, coins: 3, hats: 0 });
  claim(act, 1, 'SEA-SPO', 'POR-SPO');
  setHeads(act, 0, 'LAX', 'KCY');
  await loadPrepared(page, act);
  await clickTarget(page, 'space:W3');
  await clickTarget(page, 'district:D4');
  await waitKind(page, 'trainActivation');
  await clickAkey(page, 'useStep');
  await waitKind(page, 'trainActivation');
  await shot(page, 'train-activation', w, h);

  // A Lay Tracks choice.
  const lay = baseState();
  setHeads(lay, 0, 'SEA', 'OMA');
  give(lay, 0, { resources: { iron: 1, wood: 1, gunpowder: 1 }, tiles: { ground: 4, tunnel: 2, bridge: 1 }, hats: 0 });
  claim(lay, 1, 'POR-SPO');
  await loadPrepared(page, lay);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  await shot(page, 'lay-tracks', w, h);

  // A bonus action after a gather (Hire Specialist at Gather Iron).
  const bonus = baseState({ give: { hats: 0 } });
  await loadPrepared(page, bonus);
  await clickTarget(page, 'space:W2');
  await clickTarget(page, 'district:D3');
  await waitKind(page, 'bonusAction');
  await shot(page, 'bonus-action', w, h);

  // The building choice after a claim.
  const bld = baseState();
  setHeads(bld, 0, 'SEA', 'OMA');
  give(bld, 0, { resources: { iron: 1, wood: 1, gunpowder: 1 }, tiles: { ground: 3, tunnel: 1, bridge: 1 }, hats: 0 });
  await loadPrepared(page, bld);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await clickTarget(page, 'route:SEA-SPO');
  await waitKind(page, 'placeBuildings');
  await shot(page, 'building-choice', w, h);

  // Hot-seat hand-over.
  const hot = baseState({ give: { hats: 0 } });
  await loadPrepared(page, hot, ['human', 'human']);
  await waitData(page, 'cover', '1');
  await shot(page, 'pass-the-device', w, h);

  // The end screen.
  await loadPrepared(page, endedState(), ['random', 'random', 'random', 'random'], { paused: true });
  await page.waitForSelector('[data-screen="end"]');
  await shot(page, 'end-screen', w, h);
  await page.close();
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Add-on modules, the variants panel, illegal-move messaging
// ---------------------------------------------------------------------------

const MODULES_OFF_QUERY = 'moduleCarriageUpgrades=false,endGameScoring=none,moduleLegislativeAgenda=false,modulePonyExpress=false';

/** A two-player game with the given variants (every module off unless the variants say so), painted. */
function modState(variants, mutate) {
  const s = paint(startWith(2, variants));
  give(s, 0, { resources: { iron: 3, wood: 1, gunpowder: 2 }, coins: 4, hats: 0 });
  if (mutate) mutate(s);
  return s;
}

/** Anna at the Lay Tracks choice with two claimable routes and one that she cannot pay for. */
function layState() {
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 3, tunnel: 0, bridge: 1 }, hats: 0 });
  return s;
}

/** Anna in a free-action opportunity with a card on offer and `tokens` Pony Express tokens. */
function ponyOffer(cardId = 'PX7', tokens = 2, mutate) {
  const s = modState(PONY_V);
  if (cardId) stock(s, cardId);
  giveTokens(s, 0, tokens, Math.max(tokens, 5));
  if (mutate) mutate(s);
  gatherCoinsTurn(s);
  return s;
}

async function noticeText(page) {
  return (await page.textContent('[data-field="notice"]')) ?? '';
}

async function assertDisabledReasons(page, where) {
  const bad = await page.$$eval('button:disabled', (bs) => bs.filter((b) => !(b.title || '').trim()).map((b) => (b.textContent || '').trim().slice(0, 40)));
  assert(bad.length === 0, `${where}: every disabled button carries its reason, but these do not: ${bad.join(' | ')}`);
}

/**
 * The text of the tooltip a PLAYER gets by pointing at something: the real pointer is moved there.
 *
 * It used to dispatch a synthetic mouseover, which raced. After a click the pointer rests on whatever was
 * clicked (a district, say), and the browser sends a real mouseover for the element under a resting pointer
 * whenever the page is redrawn, on its own schedule. When that event landed after the synthetic one, the
 * tooltip read here was the district's and not the route's (section 12b: failing on one machine, passing on another).
 *
 * So: (1) park the pointer where nothing has a tooltip and wait for the tooltip to go, which makes a stale
 * tooltip impossible; (2) hover the element for real. Playwright refuses the hover when something else is on
 * top at that point, so a target that is covered, off screen or without pointer events fails here, and so does
 * a target that has lost its tooltip.
 */
async function tipOf(page, selector) {
  await page.mouse.move(2, 2);
  await page.waitForSelector('#tip', { state: 'hidden', timeout: 2000 });
  // The part of the target to point at: a route by one of its slots, a city by its disc, and a district away
  // from its centre ring (which is a target of its own, with its own tooltip).
  let target = page.locator(selector).first();
  let position;
  if (/data-route/.test(selector)) target = target.locator('.slot__socket, .tile__bed').first(); // an open slot's socket, or the laid tile that covers a claimed slot
  else if (/data-city/.test(selector)) target = target.locator('.city__disc, .city__ring').last(); // a start city's ring is drawn over its disc
  else if (/^\.district\b/.test(selector)) position = { x: 14, y: 14 };
  try {
    await target.hover({ position, timeout: 3000 });
    await page.waitForSelector('#tip:not([hidden])', { timeout: 2000 });
  } catch (err) {
    throw new Error(`pointing at ${selector} shows no tooltip: ${err.message.split('\n')[0]}`);
  }
  const onScreen = await page.evaluate(() => {
    const r = document.getElementById('tip').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  });
  assert(onScreen, `the tooltip of ${selector} is wholly on screen`);
  return (await page.textContent('#tip')) ?? '';
}

async function clickSelector(page, selector) {
  await page.dispatchEvent(selector, 'click');
}

// ---- 10 - modules on and off ------------------------------------------------

async function modulesOnGame(browser) {
  const page = await newPage(browser);
  const started = Date.now();
  await page.goto(`${BASE}?players=4&bots=random,random,random,random&fast=1&seed=6&test=1&variants=endGameScoring=both`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  assert((await page.evaluate(() => window.__cr.incidents().length)) === 0, 'no bot driver incidents');
  const state = await page.evaluate(() => window.__cr.getState());
  assert(Object.keys(state.modules).sort().join(',') === 'goals,legislative,milestones,pony,upgrades', `every module is on (${Object.keys(state.modules).join(',')})`);
  assert((await page.locator('[data-screen="end"] [data-chip="endGameScoring"]').count()) === 1, 'the end screen shows the non-default variant as a chip');
  await page.click('[data-ui="view-board"]');
  assert((await page.locator('#region-dock:not([hidden])').count()) === 1, 'the module dock is shown');
  const tabs = await page.$$eval('.dock__tab', (els) => els.map((e) => e.textContent.trim()));
  assert(tabs.length === 4 && /Upgrades/.test(tabs[0]) && /Goals/.test(tabs[1]) && /Agenda/.test(tabs[2]) && /Pony Express/.test(tabs[3]), `four tabs (${tabs.join(' / ')})`);
  assert(((await page.textContent('[data-field="agenda-compact"]')) ?? '').trim().length > 20, 'the agenda card is always shown, compactly');
  const left = Object.values(state.modules.pony.tokens).filter(Boolean).length;
  assert((await page.locator('.ptoken').count()) === left, `${left} Pony Express tokens are still on the map`);
  assert((await page.locator('.dock__body').count()) === 0, 'the dock is closed until opened (nothing is asking for it)');
  for (const tab of ['upgrades', 'goals', 'agenda', 'pony']) {
    await page.click(`[data-ui="tab:${tab}"]`);
    assert((await page.locator(`.dock__body[data-tab="${tab}"]`).count()) === 1, `the ${tab} tab opens`);
    // The dock is beneath the map, never over it.
    const map = await page.locator('.region--map').boundingBox();
    const dock = await page.locator('#region-dock').boundingBox();
    assert(map.height > 160 && dock.y >= map.y + map.height - 2, `the map stays visible above the open ${tab} panel (map ${Math.round(map.height)} px high)`);
  }
  await page.click('[data-ui="tab:goals"]');
  assert((await page.locator('[data-section="milestones"] .mcard').count()) === state.modules.milestones.inPlay.length, 'every milestone in play is shown');
  assert((await page.locator('[data-section="goals"] .gcard').count()) === state.modules.goals.inPlay.length, 'every goal in play is shown');
  assert((await page.locator('[data-standing]').count()) >= 4, 'goal standings are shown per player');
  await page.click('[data-ui="tab:upgrades"]');
  assert((await page.locator('.utile').count()) === state.modules.upgrades.display.length, 'every tile still on display is shown');
  await page.click('[data-ui="tab:pony"]');
  const faceUp = Object.values(state.modules.pony.market).flat().filter(Boolean).length;
  assert((await page.locator('.pcard:not(.pcard--empty)').count()) === faceUp, `${faceUp} market cards are shown`);
  assert((await page.locator('.ptok').count()) === 4, 'each player has a token line');
  await assertDisabledReasons(page, 'end of a four-bot game');
  log(`       modules on: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await page.close();
}

async function modulesOffGame(browser) {
  const page = await newPage(browser);
  await page.goto(`${BASE}?players=4&bots=random,random,random,random&fast=1&seed=5&test=1&variants=${MODULES_OFF_QUERY}`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  const state = await page.evaluate(() => window.__cr.getState());
  assert(Object.keys(state.modules).length === 0, `no module in the state (${Object.keys(state.modules).join(',')})`);
  assert((await page.locator('#region-dock[hidden]').count()) === 1 && (await page.locator('.dock, [data-section], .dock__tab').count()) === 0, 'the dock does not exist: no panel, no heading');
  for (const sel of ['.ptoken', '.cslot--upgrade', '[data-milestone]', '[data-goal]', '[data-field="agenda-compact"]', '[data-ui^="tab:"]', '.stat--tokens', '.pcard', '.utile']) {
    assert((await page.locator(sel).count()) === 0, `nothing of a module off is in the page: ${sel}`);
  }
  const endText = await page.evaluate(() => {
    const clone = document.getElementById('end').cloneNode(true);
    clone.querySelector('.end__meta').remove();
    return clone.textContent;
  });
  assert(!/Pony|Legislative|Milestones|Carriage upgrades|goals/i.test(endText), 'the end screen lists no module VP source');
  await page.click('[data-ui="view-board"]');
  // No mention anywhere on the game screen (the variant chips in the header say what is off, and are the one place that does).
  const text = await page.evaluate(() => {
    const clone = document.getElementById('screen-game').cloneNode(true);
    clone.querySelector('#region-header').remove();
    return clone.textContent;
  });
  const mention = /Pony Express|Legislative|Milestone|Goals|Upgrade|Agenda/i.exec(text);
  assert(!mention, `no module is mentioned on the game screen (found "${mention && mention[0]}")`);
  assert((await page.locator('[data-chip="modulePonyExpress"]').count()) >= 1, 'the header chips say which modules are off');
  await page.close();
}

// ---- 11 - the variants panel ------------------------------------------------------

async function variantsPanel(browser) {
  const page = await newPage(browser);
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  assert((await page.locator('[data-variant]').count()) === 0, 'the panel starts closed');
  await page.click('[data-setup="variants-toggle"]');
  const shown = await page.$$eval('[data-variant]', (els) => els.map((e) => e.dataset.variant).sort());
  const wanted = E.VARIANTS.map((v) => v.name).sort();
  assert(JSON.stringify(shown) === JSON.stringify(wanted), `the panel lists exactly the engine's ${wanted.length} variants (page has ${shown.length})`);
  for (const def of E.VARIANTS) {
    const row = page.locator(`[data-variant="${def.name}"]`);
    const desc = await row.locator('.vrow__desc').textContent();
    assert(desc.includes(def.description), `${def.name}: its description is shown`);
    assert(/Default/.test(desc), `${def.name}: its default is marked`);
    if (def.type === 'boolean') assert((await row.locator('input[type="checkbox"]').count()) === 1, `${def.name}: a switch`);
    else if (def.type === 'enum') assert((await row.locator('select option').count()) === def.values.length, `${def.name}: a select with every value`);
    else if (def.type === 'integer') {
      const n = row.locator('input[type="number"]');
      assert((await n.getAttribute('min')) === String(def.min) && (await n.getAttribute('max')) === String(def.max), `${def.name}: a number box with its limits`);
    } else assert((await row.locator('select').count()) === 1, `${def.name}: a select that also takes a number`);
  }
  const groups = await page.$$eval('fieldset.vgroup', (els) => els.map((e) => ({ id: e.dataset.group, names: [...e.querySelectorAll('[data-variant]')].map((r) => r.dataset.variant) })));
  assert(groups.length === 2 && groups[0].id === 'modules' && groups[0].names.includes('modulePonyExpress'), 'module switches come first');
  const rest = groups[1].names;
  assert(JSON.stringify(rest) === JSON.stringify([...rest].sort((a, b) => a.localeCompare(b))), 'the other variants follow alphabetically');
  assert((await page.locator('[data-changed="1"]').count()) === 0 && (await page.getAttribute('[data-setup="preset:full"]', 'aria-pressed')) === 'true', 'at the defaults nothing is marked changed and the full game preset is on');

  // A non-default choice is highlighted and carried in the address.
  await page.selectOption('select[data-setup="variant:conversionRate"]', '1:1');
  assert((await page.getAttribute('[data-variant="conversionRate"]', 'data-changed')) === '1', 'a changed variant is highlighted');
  assert(/variants=/.test(page.url()) && decodeURIComponent(page.url()).includes('conversionRate=1:1'), `the address carries it (${page.url()})`);
  assert(/1 changed/.test(await page.textContent('[data-field="variants-summary"]')), 'the summary counts it');

  // The engine's own message for an illegal value, under the control, and Start is held back.
  await page.fill('input[data-setup="variantnum:goalsInPlay"]', '99');
  const msg = await page.textContent('[data-variant-error="goalsInPlay"]');
  assert(/goalsInPlay/.test(msg) && /99/.test(msg) && /1 to 12/.test(msg), `an out-of-range number shows the engine's message (${msg})`);
  assert(await page.locator('[data-setup="start"]').isDisabled(), 'Start waits while the variants are illegal');
  assert(/Illegal value 99/.test((await page.getAttribute('[data-setup="start"]', 'title')) ?? ''), 'and says why in its tooltip');
  await page.fill('input[data-setup="variantnum:goalsInPlay"]', '3');
  assert(((await page.textContent('[data-variant-error="goalsInPlay"]')) ?? '').trim() === '' && !(await page.locator('[data-setup="start"]').isDisabled()), 'a legal value clears the message');

  // An illegal COMBINATION: goals on, upgrades off, all twelve goals.
  await page.selectOption('select[data-setup="variant:endGameScoring"]', 'goals');
  await page.uncheck('input[data-setup="variant:moduleCarriageUpgrades"]');
  await page.fill('input[data-setup="variantnum:goalsInPlay"]', '12');
  const combo = await page.textContent('[data-field="variants-error"]');
  assert(/goal 6/.test(combo), `an illegal combination shows the engine's message (${combo})`);
  assert(await page.locator('[data-setup="start"]').isDisabled(), 'Start waits for the combination too');

  // Reset to defaults.
  await page.click('[data-setup="variants-reset"]');
  assert((await page.locator('[data-changed="1"]').count()) === 0, 'Reset to defaults clears every change');
  assert(!/variants=/.test(page.url()), 'and the address');
  assert(!(await page.locator('[data-setup="start"]').isDisabled()), 'and Start is available again');

  // Presets.
  await page.click('[data-setup="preset:core"]');
  assert(!(await page.isChecked('input[data-setup="variant:modulePonyExpress"]')) && !(await page.isChecked('input[data-setup="variant:moduleLegislativeAgenda"]')) && !(await page.isChecked('input[data-setup="variant:moduleCarriageUpgrades"]')), 'Core only switches the modules off');
  assert((await page.inputValue('select[data-setup="variant:endGameScoring"]')) === 'none', 'and the objectives');
  assert((await page.getAttribute('[data-setup="preset:core"]', 'aria-pressed')) === 'true', 'and shows the preset as chosen');
  await page.click('[data-setup="preset:base"]');
  assert(!(await page.isChecked('input[data-setup="variant:modulePonyExpress"]')) && (await page.isChecked('input[data-setup="variant:moduleCarriageUpgrades"]')), 'Base game keeps upgrades and drops Pony Express');
  await page.click('[data-setup="preset:full"]');
  assert((await page.isChecked('input[data-setup="variant:modulePonyExpress"]')) && (await page.locator('[data-changed="1"]').count()) === 0, 'Full game is the defaults');
  await assertDisabledReasons(page, 'the setup screen');
  await page.close();
}

async function variantsThroughPanel(browser) {
  const page = await newPage(browser);
  await page.goto(`${BASE}?test=1&fast=1`);
  await waitSetup(page);
  await page.click('[data-setup="variants-toggle"]');
  await page.selectOption('select[data-setup="variant:conversionRate"]', '1:1');
  await page.selectOption('select[data-setup="kind:0"]', 'random');
  await page.selectOption('select[data-setup="kind:1"]', 'random');
  await page.click('[data-setup="start"]');
  await page.waitForSelector('#app[data-phase="play"]');
  const chip = (await page.textContent('#region-header [data-chip="conversionRate"]')) ?? '';
  assert(/Conversion rate/.test(chip) && /1:1/.test(chip), `the header shows a readable chip (${chip.trim()})`);
  assert((await page.evaluate(() => window.__cr.getState().variants.conversionRate)) === '1:1', "the engine's state carries the variant");
  assert(decodeURIComponent(page.url()).includes('variants=conversionRate=1:1'), `the address carries it (${page.url()})`);
  const title = await page.getAttribute('#region-header [data-chip="conversionRate"]', 'title');
  assert(/What a Crew, Miner and Engineer pay/.test(title), 'the chip explains itself');
  // Reload: restored from the address.
  await page.reload();
  await waitSetup(page);
  assert((await page.inputValue('select[data-setup="variant:conversionRate"]')) === '1:1', 'a reload restores the variant from the address');
  assert((await page.getAttribute('[data-variant="conversionRate"]', 'data-changed')) === '1', 'and marks it changed');
  await page.selectOption('select[data-setup="kind:0"]', 'random');
  await page.selectOption('select[data-setup="kind:1"]', 'random');
  await page.click('[data-setup="start"]');
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  assert((await page.evaluate(() => window.__cr.getState().variants.conversionRate)) === '1:1', 'the restored game plays the variant');
  const endChip = (await page.textContent('[data-screen="end"] [data-chip="conversionRate"]')) ?? '';
  assert(/1:1/.test(endChip), `the end screen shows it (${endChip.trim()})`);
  await page.close();
}

// ---- 12 - illegal moves: states, reasons, refusals, tooltips ----------------------------

async function refusedClicks(browser, takeShots) {
  const page = await newPage(browser);
  // (a) a route she cannot pay for
  await loadPrepared(page, layState());
  await clickTarget(page, 'space:W6');
  await waitKind(page, 'chooseDistrict');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  assert((await page.getAttribute('g[data-route="SEA-SPO"]', 'data-state')) === 'legal', 'a claimable route is legal');
  assert((await page.getAttribute('g[data-route="SEA-HEL"]', 'data-state')) === 'illegal', 'a route she cannot pay for is illegal but clickable');
  assert((await page.getAttribute('.district[data-district="D1"]', 'data-state')) === 'out', 'the action grid is out of scope while laying tracks');
  assert((await page.locator('g.routecost--short').count()) >= 1, 'a route she cannot pay for carries a short badge');
  const badge = await page.textContent('g.routecost--short');
  assert(/have/.test(badge), `the badge says what she has (${badge})`);
  const tip = await tipOf(page, 'g[data-route="SEA-HEL"]');
  assert(/Seattle - Helena/.test(tip) && /needs 4 Tunnel/.test(tip), `the tooltip gives the cost against the holding (${tip.slice(0, 160)})`);
  await clickSelector(page, 'g[data-route="SEA-HEL"]');
  const a = await noticeText(page);
  assert(/\d/.test(a) && /(Tunnel|Seattle|Helena)/.test(a), `a refused route click says why with numbers (${a})`);
  assert((await page.evaluate(() => window.__cr.getState().map.routeOwner['SEA-HEL'])) === null, 'nothing was claimed');
  if (takeShots) await takeShots('refused-click');
  await assertDisabledReasons(page, 'the Lay Tracks decision');
  await page.keyboard.press('Escape');
  assert((await page.locator('[data-field="notice"]').count()) === 0, 'Escape dismisses the message');

  // (b) an occupied worker space
  const occ = baseState({ give: { hats: 0 } });
  put(occ, 1, 'W2');
  await loadPrepared(page, occ);
  assert((await page.getAttribute('[data-space="W2"]', 'data-state')) === 'illegal', 'an occupied space is illegal but clickable');
  await page.locator('[data-space="W2"]').click();
  const b = await noticeText(page);
  assert(/Ben/.test(b) && /W2/.test(b), `a refused worker space names who is there (${b})`);

  // (c) a used Congress entry
  const cong = baseState();
  setTrain(cong, 0, [['financier', 'crew']]);
  cong.congress.used.C1 = true;
  await loadPrepared(page, cong);
  await clickTarget(page, 'space:W2');
  await clickTarget(page, 'district:D2');
  await waitKind(page, 'trainActivation');
  assert((await page.getAttribute('.cong[data-entry="C1"]', 'data-state')) === 'illegal', 'a used entry is illegal but clickable');
  assert((await page.getAttribute('.cong[data-entry="C2"]', 'data-state')) === 'legal', 'an open entry is lit');
  assert((await page.locator('.wspace[data-state="out"]').count()) === 12, 'the worker spaces are out of scope in the Congress window');
  await page.locator('.cong[data-entry="C1"]').click();
  const c = await noticeText(page);
  assert(/C1/.test(c) && /senator/.test(c), `a used Congress entry says so (${c})`);
  await page.close();
}

async function tooltipsAndBadges(browser) {
  const page = await newPage(browser);
  const prepared = layState();
  claim(prepared, 1, 'POR-SPO'); // one route already owned, for the tooltip of a claimed route
  await loadPrepared(page, prepared);
  let tip = await tipOf(page, '[data-space="W6"]');
  assert(/Worker space W6/.test(tip) && /You can do this now/.test(tip), `a worker space tooltip gives its facts and that it is open (${tip.slice(0, 120)})`);
  tip = await tipOf(page, '.cong[data-entry="C3"]');
  assert(/lobby point/.test(tip) && /Coin/.test(tip), `a Congress tooltip gives the lobby points and Coins (${tip.slice(0, 120)})`);
  assert((await page.locator('#tip .tip__avail--no').count()) === 1, 'and why it cannot be taken now');
  tip = await tipOf(page, '.district[data-district="D5"]');
  assert(/Lay Tracks/.test(tip), `a district tooltip names the district (${tip.slice(0, 100)})`);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  tip = await tipOf(page, 'g[data-route="SEA-SPO"]');
  assert(/Seattle - Spokane/.test(tip) && /2 Ground/.test(tip) && /You hold 3 Ground/.test(tip), `an affordable route says what is held (${tip.slice(0, 160)})`);
  tip = await tipOf(page, 'g[data-route="SEA-HEL"]');
  assert(/Seattle - Helena/.test(tip) && /needs \d+ Tunnel; you have 0/.test(tip), `a route she cannot pay for says what is missing (${tip.slice(0, 220)})`);
  tip = await tipOf(page, 'g[data-route="POR-SPO"]');
  assert(/Portland - Spokane/.test(tip) && /Owned by/.test(tip) && !/Claiming it costs/.test(tip), `a claimed route names its owner (${tip.slice(0, 160)})`);
  tip = await tipOf(page, 'g[data-city="SPO"]');
  assert(/Spokane/.test(tip), 'a city tooltip names the city');
  tip = await tipOf(page, 'g[data-city="SEA"]');
  assert(/Seattle/.test(tip) && /Railhead/.test(tip), `a city with a railhead on it still answers, and names the railhead (${tip.slice(0, 120)})`);
  // Pieces drawn on top of the map (railheads, stations) never take the pointer from what is under them:
  // the city and the route ends beside them stay the targets, for a hover and for a click.
  const stolen = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#region-map .railhead, #region-map .building').forEach((g) => {
      const r = g.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (top && top.closest('.railhead, .building')) out.push(g.getAttribute('class'));
      }
    });
    return { n: document.querySelectorAll('#region-map .railhead').length, out };
  });
  assert(stolen.n >= 2 && stolen.out.length === 0, `no piece standing on the map takes the pointer (${stolen.out.join(', ')})`);
  // The middle of each end slot of a lit route belongs to that route, and every city disc to its city.
  const hits = await page.evaluate(() => {
    const topAt = (el) => {
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return t ? t.closest('[data-target]') : null;
    };
    const out = [];
    const lit = document.querySelectorAll('#region-map g.route[data-legal="1"]');
    lit.forEach((g) => {
      const slots = g.querySelectorAll('.slot__socket');
      for (const s of [slots[0], slots[slots.length - 1]]) {
        const t = topAt(s);
        if (!t || t.dataset.target !== g.dataset.target) out.push(`${g.dataset.target} -> ${t ? t.dataset.target : 'nothing'}`);
      }
    });
    document.querySelectorAll('#region-map g.city').forEach((g) => {
      const t = topAt(g.querySelector('.city__disc'));
      if (!t || t.dataset.target !== g.dataset.target) out.push(`${g.dataset.target} -> ${t ? t.dataset.target : 'nothing'}`);
    });
    return { routes: lit.length, out };
  });
  assert(hits.routes >= 2 && hits.out.length === 0, `end slots belong to their route and city discs to their city (${hits.out.join('; ')})`);
  // Real clicks, with no force: the slot beside Seattle and its railhead claims the route; the lit city is taken as the city.
  await page.locator('g[data-target="route:SEA-SPO"][data-legal="1"] .slot__socket').first().click({ timeout: 3000 });
  await waitKind(page, 'placeBuildings');
  assert((await page.evaluate(() => window.__cr.getState().map.routeOwner['SEA-SPO'])) === 0, 'a real click on the slot beside the railhead claims the route');
  const before = await page.evaluate(() => window.__cr.getState().seq);
  await page.locator('g[data-target="city:SPO"][data-legal="1"] .city__disc').click({ timeout: 3000 });
  const after = await page.evaluate(() => ({ seq: window.__cr.getState().seq, mode: window.__cr.pendingUi().mode }));
  assert(after.seq > before || after.mode === 'choose', `a real click on the lit city is taken as the city (${JSON.stringify(after)})`);
  await page.close();
}

// ---- 13 - forced follow-ups, automatic steps, the flash --------------------------------------

async function forcedFollowUp(browser) {
  const page = await newPage(browser);
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 2, tunnel: 0, bridge: 0 }, hats: 0 });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W6');
  await waitKind(page, 'chooseDistrict');
  const text = (await page.textContent('[data-field="consequences"]')) ?? '';
  assert(/your only option is to claim Seattle - Spokane/.test(text) && /at once/.test(text), `the district choice says what will happen by itself (${text.trim()})`);
  assert((await page.locator('[data-consequence="D5"]').count()) === 1 && (await page.locator('[data-consequence="D4"]').count()) === 0, 'only the choice that has a forced follow-up is listed');
  assert((await page.locator('.district[data-district="D5"] .district__forced').count()) === 1, 'and the district carries a "then automatic" mark');
  const tip = await tipOf(page, '.district[data-district="D5"]');
  assert(/only option/.test(tip), `the district tooltip says it too (${tip.slice(0, 160)})`);
  assert((await page.evaluate(() => window.__cr.getState().map.routeOwner['SEA-SPO'])) === null, 'nothing has happened yet: it is a preview');
  await clickTarget(page, 'district:D5');
  assert((await page.evaluate(() => window.__cr.getState().map.routeOwner['SEA-SPO'])) === 0, 'the claim happened at once');
  assert((await page.locator('.log__entry[data-auto="1"] .log__auto').count()) >= 1, 'the automatic step is marked in the log');
  assert(/automatic/i.test((await page.locator('.log__auto').first().textContent()) ?? ''), 'with the word "automatic"');
  assert((await page.locator('g.route.is-flash[data-route="SEA-SPO"]').count()) === 1, 'the route it touched is highlighted');
  // A re-render inside the highlight continues the animation; it does not start it again.
  await page.waitForTimeout(450);
  await page.setViewportSize({ width: 1436, height: 900 });
  await page.waitForTimeout(420);
  const resumed = await page.evaluate(() => {
    const el = document.querySelector('g.route.is-flash[data-route="SEA-SPO"]');
    if (!el) return { gone: true };
    const anim = el.getAnimations().find((x) => x.animationName === 'flash');
    return { gone: false, time: anim ? anim.currentTime - anim.effect.getComputedTiming().delay : -1, style: el.getAttribute('style') };
  });
  assert(!resumed.gone, 'the highlight is still running after a re-render');
  assert(/animation-delay:\s*-\d+ms/.test(resumed.style), `a re-render resumes the animation (${resumed.style})`);
  assert(resumed.time >= 500, `the animation was not restarted by the re-render (at ${resumed.time} ms)`);
  await page.close();
}

async function activationHighlight(browser) {
  const page = await newPage(browser);
  const s = baseState({ give: { hats: 0, resources: { iron: 6, wood: 0, gunpowder: 1 } } });
  setTrain(s, 0, [['crew', 'miner']]);
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W3');
  await clickTarget(page, 'district:D4');
  await waitKind(page, 'trainActivation');
  assert((await page.locator('.engine.is-active-step').count()) === 1 && (await page.locator('.cslot.is-acting').count()) === 0, 'on the Foreman step the engine is lit, no slot');
  await clickAkey(page, 'useStep');
  await waitKind(page, 'trainActivation');
  assert((await page.locator('.carriage.is-active-step').count()) === 1, 'on a specialist step the carriage is lit');
  assert((await page.locator('.cslot.is-acting').count()) >= 1, 'and the slot that holds that specialist type');
  assert(/Crew/.test((await page.getAttribute('.cslot.is-acting', 'title')) ?? ''), 'it is the Crew slot');
  await page.close();
}

// ---- 14 - Cancel and Escape ----------------------------------------------------------------

async function cancelAndEscape(browser) {
  const page = await newPage(browser);
  const pend = () => page.evaluate(() => window.__cr.pendingUi());
  // The hat toggle.
  await loadPrepared(page, baseState());
  await clickTarget(page, 'space:W11');
  await waitKind(page, 'chooseDistrict');
  await page.check('[data-ui="toggle-hat"]');
  assert((await pend()).hat === true, 'the hat is selected');
  await page.click('[data-ui="cancel"]');
  assert((await pend()).hat === false && !(await page.locator('[data-ui="toggle-hat"]').isChecked()), 'Cancel clears the hat');
  await page.check('[data-ui="toggle-hat"]');
  await page.keyboard.press('Escape');
  assert((await pend()).hat === false && !(await page.locator('[data-ui="toggle-hat"]').isChecked()), 'Escape clears the hat');
  assert((await page.locator('[data-ui="cancel"]').count()) === 0, 'and Cancel is not offered when nothing is selected');

  // A route that can be claimed from either end: a choice, then Cancel, Escape, and a second click that switches.
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'SPO');
  give(s, 0, { tiles: { ground: 5, tunnel: 2, bridge: 1 }, hats: 0 });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  await clickTarget(page, 'route:SEA-SPO');
  assert((await pend()).mode === 'choose' && (await page.locator('[data-field="choice"]').count()) === 1, 'a route claimable from two ends opens a choice');
  assert((await page.locator('[data-field="choice"] [data-akey]').count()) === 2, 'with one button per end');
  await page.click('[data-ui="cancel"]');
  assert((await pend()).mode === 'idle' && (await page.locator('[data-field="choice"]').count()) === 0, 'Cancel closes the choice');
  await clickTarget(page, 'route:SEA-SPO');
  await page.keyboard.press('Escape');
  assert((await pend()).mode === 'idle', 'Escape closes the choice');
  await clickTarget(page, 'route:SEA-SPO');
  assert((await pend()).mode === 'choose', 'the choice opens again');
  await clickTarget(page, 'route:BOI-SPO'); // another target: switches, never stacks
  const after = await page.evaluate(() => ({ owners: [window.__cr.getState().map.routeOwner['SEA-SPO'], window.__cr.getState().map.routeOwner['BOI-SPO']], mode: window.__cr.pendingUi().mode }));
  assert(after.owners[1] === 0 && after.owners[0] === null, `the second click took the second route and left the first alone (${after.owners})`);
  assert(after.mode === 'idle' && (await page.locator('[data-field="choice"]').count()) === 0, 'and the first choice is gone');
  await page.close();
}

// ---- 15 - the scoring pop-up -------------------------------------------------------------------

async function scoringPopup(browser, takeShots) {
  const page = await newPage(browser);
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  await clickTarget(page, 'route:SEA-SPO');
  await waitKind(page, 'placeBuildings');
  const lines = await page.$$eval('[data-field="scoring-popup"] li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert(lines.length >= 2, `the pop-up shows a line per source (${lines.join(' | ')})`);
  assert(lines.some((l) => /Track laid/.test(l) && /2 slots × 1 VP = 2/.test(l)) && lines.some((l) => /First connections/.test(l)), `with the arithmetic (${lines.join(' | ')})`);
  const total = await page.textContent('[data-field="popup-total"]');
  assert(/\+\d+ VP/.test(total), `and a total (${total})`);
  assert((await page.locator('.log__d--score').count()) >= 1 && /Scored/.test((await page.locator('.log__d--score').first().textContent()) ?? ''), 'the arithmetic is also in the log');
  if (takeShots) await takeShots('scoring-popup');
  await clickAkey(page, 'skipBuilding'); // it does not block play
  assert((await page.locator('[data-field="scoring-popup"]').count()) === 1, 'and it stays while play goes on');
  await page.keyboard.press('Escape');
  assert((await page.locator('[data-field="scoring-popup"]').count()) === 0, 'Escape dismisses it');
  await page.close();
}

// ---- 16 - small things: seat fallbacks ----------------------------------------------------------

async function seatFallbacks(browser) {
  const page = await newPage(browser);
  const s = baseState();
  s.players.forEach((p) => {
    p.name = '';
    p.colour = null;
  });
  await loadPrepared(page, s, ['human', 'random']);
  await waitKind(page, 'workerStep');
  const names = await page.$$eval('.score__name', (els) => els.map((e) => e.textContent.trim()));
  assert(names.join(',') === 'Player 1,Player 2', `seats without names are called Player 1, Player 2 (${names.join(',')})`);
  const style = await page.getAttribute('.score[data-player="0"]', 'style');
  assert(/#c0392b/i.test(style), `and get the setup palette's colours (${style})`);
  const text = await page.evaluate(() => document.body.innerText);
  assert(!/undefined|null|NaN/.test(text), 'no "undefined", "null" or "NaN" is shown');
  assert(/Player 1/.test((await page.textContent('[data-field="to-act"]')) ?? ''), 'the prompt uses the fallback name');
  await page.close();
}

// ---- 17 - module controls through the bespoke UI ---------------------------------------------------

async function upgradesFlow(browser) {
  const page = await newPage(browser);
  const s = modState(UPGRADES_V, (st) => {
    setTrain(st, 0, [['miner', null]]);
    give(st, 0, { resources: { iron: 3 } });
  });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W1');
  await clickTarget(page, 'district:D1'); // Gather Gunpowder: the Carriage Upgrade bonus action
  await waitKind(page, 'bonusAction');
  assert((await page.getAttribute('#app', 'data-dock')) === 'open' && (await page.getAttribute('.dock', 'data-active')) === 'upgrades', 'the Upgrades panel opens itself for the decision');
  assert((await page.locator('.dock__tab.is-wanted').count()) === 1, 'and the tab is marked');
  assert((await page.locator('.utile[data-tile="U1-wood"] [data-akey^="installUpgrade:U1-wood"]').count()) === 1, 'a tile offers the carriage it can go in, from the legal actions');
  assert(/Wood Supply/.test((await page.textContent('.utile[data-tile="U1-wood"]')) ?? '') && /Gain 1 Wood/.test((await page.textContent('.utile[data-tile="U1-wood"]')) ?? ''), 'with its name and effect');
  assert((await page.locator('.utile[data-tile="U2-vp"] [data-akey]').count()) === 0, 'a tile that does not fit has no install button');
  await assertDisabledReasons(page, 'the upgrade decision');
  const tip = await tipOf(page, '.utile[data-tile="U2-vp"]');
  assert(/level 2/.test(tip), `its tooltip gives the engine's reason (${tip.slice(0, 200)})`);
  await page.click('.utile[data-tile="U1-wood"] [data-akey^="installUpgrade:U1-wood"]');
  assert((await page.evaluate(() => window.__cr.getState().modules.upgrades.installed[0][0])) === 'U1-wood', 'the tile is installed');
  assert((await page.locator('.train--full [data-installed="U1-wood"]').count()) === 1 && /Wood Supply/.test((await page.textContent('.train--full [data-installed="U1-wood"]')) ?? ''), 'the carriage shows the tile with its name');
  assert(/Gain 1 Wood/.test((await page.textContent('.train--full [data-installed="U1-wood"] .cslot__fx')) ?? ''), 'and its effect');
  await page.close();

  // The upgrade step shows in the activation sequence.
  const page2 = await newPage(browser);
  const s2 = modState(UPGRADES_V, (st) => {
    setTrain(st, 0, [['crew', 'crew']]);
    installTile(st, 0, 1, 'U1-wood');
  });
  await loadPrepared(page2, s2);
  await clickTarget(page2, 'space:W3');
  await clickTarget(page2, 'district:D4');
  await waitKind(page2, 'trainActivation');
  assert((await page2.locator('.astep--upgrade').count()) === 1, 'the upgrade step is in the activation sequence');
  assert(/Wood Supply/.test((await page2.textContent('.astep--upgrade')) ?? ''), 'named after its tile');
  await page2.close();
}

async function ponyBuy(browser, takeShots) {
  const page = await newPage(browser);
  await loadPrepared(page, ponyOffer('PX7', 2));
  await waitKind(page, 'freeActions');
  assert((await page.getAttribute('.dock', 'data-active')) === 'pony' && (await page.getAttribute('#app', 'data-dock')) === 'open', 'the Pony Express panel opens itself for a free-action opportunity');
  const card = page.locator('.pcard[data-card="PX7"]');
  assert(/2 tokens/.test((await card.textContent()) ?? '') && /Mail Delivery Contract/.test((await card.textContent()) ?? ''), 'a market card shows its cost and name');
  assert((await card.locator('.pcard__text').textContent()).trim().length > 5, 'and its effect text');
  assert((await card.locator('[data-akey="buyPonyCard:PX7"][data-legal="1"]').count()) === 1, 'an affordable card is lit');
  const dead = page.locator('.pcard[data-rank="C"] button:disabled').first();
  assert((await dead.count()) === 1 && ((await dead.getAttribute('title')) ?? '').length > 10, 'an unaffordable card is disabled and carries the reason');
  assert(((await page.locator('.pcard[data-rank="C"] .reasoned__why').first().textContent()) ?? '').length > 10, 'and says it in text as well');
  const cardTip = await tipOf(page, '.pcard[data-card="PX7"]');
  assert(/Mail Delivery Contract/.test(cardTip) && /You hold 2 tokens/.test(cardTip), `the card tooltip gives the facts (${cardTip.slice(0, 160)})`);
  await assertDisabledReasons(page, 'the Pony Express panel');
  if (takeShots) await takeShots('pony-free-actions');
  await page.click('.pcard[data-card="PX7"] [data-akey="buyPonyCard:PX7"]');
  const after = await page.evaluate(() => ({ held: window.__cr.getState().modules.pony.players[0].tokensHeld, market: window.__cr.getState().modules.pony.market.A }));
  assert(after.held === 0 && !after.market.includes('PX7'), `buying paid 2 tokens and took the card off the market (${JSON.stringify(after)})`);
  assert((await page.locator('.log__d--gain', { hasText: 'Bought Pony Express card' }).count()) >= 1, 'the purchase is in the log');
  await page.close();
}

async function ponyExchange(browser) {
  const page = await newPage(browser);
  await loadPrepared(page, ponyOffer(null, 2, (st) => give(st, 0, { resources: {}, coins: 0 })));
  await waitKind(page, 'freeActions');
  const before = await player(page, 0);
  await page.click('[data-akey="exchangeToken:wood"]');
  const after = await player(page, 0);
  assert(after.resources.wood === before.resources.wood + 1, 'a token bought 1 Wood');
  assert((await page.evaluate(() => window.__cr.getState().modules.pony.players[0].tokensHeld)) === 1, 'and was spent');
  assert((await page.textContent('.ptok[data-player="0"] [data-field="tokens-held"]')).trim() === '1', 'the panel shows the tokens left');
  await page.click('[data-field="free-actions"] [data-akey="endFreeActions"]'); // end the opportunity from the panel
  await page.waitForFunction(() => window.__cr.getState().toAct === 1, null, { timeout: 4000 });
  assert((await page.evaluate(() => window.__cr.getState().toAct)) === 1, 'ending the free actions passed the turn');
  await page.close();
}

async function ponyAbility(browser) {
  const page = await newPage(browser);
  const s = modState(PONY_V, (st) => {
    ownCard(st, 0, 'PX14');
    claim(st, 1, 'SEA-SPO', 'POR-SPO');
    setHeads(st, 0, 'SEA', 'MIN');
    giveTokens(st, 0, 1);
    gatherCoinsTurn(st);
  });
  await loadPrepared(page, s);
  await waitKind(page, 'freeActions');
  assert(/Overland Route/.test((await page.textContent('.ocard[data-card="PX14"]')) ?? ''), 'a card in play is listed with its name');
  assert((await page.locator('.ocard[data-card="PX14"] [data-akey="usePonyCard:PX14"][data-legal="1"]').count()) === 1, 'its once-per-turn ability has a button');
  await page.click('.ocard[data-card="PX14"] [data-akey="usePonyCard:PX14"]');
  await waitKind(page, 'layTracks');
  assert(await hasTarget(page, 'city:SPO'), 'it gave a Move Train step: a destination is lit');
  await page.close();
}

async function milestoneFlow(browser, takeShots) {
  const page = await newPage(browser);
  const s = modState({ endGameScoring: 'milestones', milestonesInPlay: 10 }, (st) => setTrain(st, 0, [['crew', 'miner'], ['engineer', 'financier']]));
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W10');
  await clickTarget(page, 'district:D9');
  await waitKind(page, 'bonusAction');
  await clickAkey(page, 'skipBonusAction');
  assert((await page.evaluate(() => window.__cr.getState().modules.milestones.claimedBy.MS8)) === 0, 'Full Crew was claimed at the end of the turn');
  const entry = await page.locator('.log__d--milestone').first().textContent();
  assert(/Milestone claimed: Full Crew/.test(entry), `a clear notice in the log (${entry})`);
  assert((await page.locator('.dock__tab.is-flash').count()) >= 1, 'the Goals tab is highlighted briefly');
  await page.click('[data-ui="tab:goals"]');
  const card = page.locator('.mcard[data-milestone="MS8"]');
  assert((await card.getAttribute('data-claimed-by')) === '0', 'the card is marked as claimed by Anna');
  assert(/Claimed by Anna on turn \d+/.test((await card.textContent()) ?? ''), `with who and when (${(await card.textContent()).replace(/\s+/g, ' ')})`);
  assert(/#c0392b/i.test((await card.getAttribute('style')) ?? ''), "in the claimant's colour");
  assert((await page.locator('.mcard:not(.is-claimed) .prog').count()) >= 2, 'unclaimed milestones show live progress per player');
  assert((await page.locator('.mcard:not(.is-claimed) .prog__text').first().textContent()).trim().length > 3, 'from describeProgress');
  const tip = await tipOf(page, '.mcard[data-milestone="MS8"]');
  assert(/Full Crew/.test(tip), 'the card has a tooltip');
  if (takeShots) await takeShots('milestone-claimed');
  await page.close();
}

async function goalsProgress(browser) {
  const page = await newPage(browser);
  const s = modState({ endGameScoring: 'goals', goalsInPlay: 4 }, (st) => setTrain(st, 0, [['crew', 'miner'], ['engineer', 'financier'], ['crew', null]]));
  await loadPrepared(page, s);
  await waitKind(page, 'workerStep');
  await page.click('[data-ui="tab:goals"]');
  assert((await page.locator('[data-section="goals"] .gcard').count()) === 4, 'four goals are in play');
  assert((await page.locator('[data-section="milestones"]').count()) === 0, 'and no milestones');
  const standings = await page.$$eval('[data-standing]', (els) => els.map((e) => e.textContent.trim()));
  assert(standings.length === 8 && standings.every((t) => /currently \d(st|nd|rd|th)|not tracked/.test(t)), `each goal shows "currently 1st / 2nd" for each player (${standings.slice(0, 3).join(' | ')})`);
  await page.close();
}

async function agendaCard(browser) {
  const page = await newPage(browser);
  const s = modState({ moduleLegislativeAgenda: true, legislativeAgendaCard: 4 });
  await loadPrepared(page, s);
  await waitKind(page, 'workerStep');
  assert((await page.locator('.dock__tab').count()) === 1 && (await page.locator('.dock__body').count()) === 0, 'with only the agenda on, one tab and the panel closed');
  const compact = (await page.textContent('[data-field="agenda-compact"]')) ?? '';
  assert(/Transcontinental Priority/.test(compact) && /35 VP/.test(compact), `the card in force is always shown, compactly (${compact.replace(/\s+/g, ' ').trim()})`);
  await page.click('[data-ui="agenda-open"]');
  assert((await page.locator('[data-field="opened-card"]').count()) === 1 && (await page.locator('.opened__img[data-art-id^="card-agenda-04"], .opened .art-chip').count()) === 1, 'Full card opens the whole card');
  await page.keyboard.press('Escape');
  assert((await page.locator('[data-field="opened-card"]').count()) === 0 && (await page.locator('.dock__body').count()) === 1, 'Escape closes the card first');
  await page.keyboard.press('Escape');
  assert((await page.locator('.dock__body').count()) === 0, 'then the panel');
  assert((await page.locator('[data-field="agenda-compact"]').count()) === 1, 'the compact card stays');
  await page.close();
}

// ---- screenshots of the new work ----------------------------------------------------------------

function allOnMidGame() {
  const state = E.createGame({ players: [{ name: 'Anna' }, { name: 'Ben' }, { name: 'Cara' }], seed: 17, shuffleSeats: false, variants: { endGameScoring: 'both', goalsInPlay: 4 } });
  const rng = E.makeRng('mods');
  let guard = 0;
  while (!E.isGameOver(state) && guard++ < 6000) {
    const frame = E.topFrame(state);
    if (state.turn.number >= 30 && state.toAct === 0 && frame.kind === 'workerStep') break;
    E.applyAction(state, E.rngPick(rng, E.getValidActions(state)), E.SILENT);
  }
  return paint(state);
}

async function moduleScreenshots(browser, w, h) {
  const page = await newPage(browser, w, h);
  const snap = (name) => shot(page, name, w, h);
  // Setup with the variants panel open and a few changes.
  await page.goto(`${BASE}?test=1&variants=conversionRate=1:1,modulePonyExpress=false`);
  await waitSetup(page);
  await snap('setup-variants');
  writeEvidence(path.join(SHOTS, `setup-variants-panel-${w}x${h}.png`), await page.locator('#variants-mount').screenshot());
  // Each module panel, in a mid-game position with every module on.
  await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
  await waitKind(page, 'workerStep');
  for (const tab of ['upgrades', 'goals', 'agenda', 'pony']) {
    await page.click(`[data-ui="tab:${tab}"]`);
    if (tab === 'agenda') await page.click('[data-ui="agenda-open"]');
    await snap(`module-${tab}`);
  }
  // A free-action opportunity with the market.
  await loadPrepared(page, ponyOffer('PX7', 2, (st) => ownCard(st, 0, 'PX14')));
  await waitKind(page, 'freeActions');
  await snap('module-pony-free-actions');
  // Upgrades in a bonus action.
  await loadPrepared(page, modState(UPGRADES_V, (st) => { setTrain(st, 0, [['miner', null]]); give(st, 0, { resources: { iron: 3 } }); }));
  await clickTarget(page, 'space:W1');
  await clickTarget(page, 'district:D1');
  await waitKind(page, 'bonusAction');
  await snap('module-upgrades-install');
  // A refused click and the scoring pop-up.
  await refusedShots(page, snap);
  await page.close();
}

async function refusedShots(page, snap) {
  await loadPrepared(page, layState());
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await waitKind(page, 'layTracks');
  await clickSelector(page, 'g[data-route="SEA-HEL"]');
  await page.mouse.move(700, 8);
  await page.waitForTimeout(450);
  await snap('refused-click');
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await clickTarget(page, 'route:SEA-SPO');
  await waitKind(page, 'placeBuildings');
  await page.mouse.move(700, 8);
  await page.waitForTimeout(450);
  await snap('scoring-popup');
}

// ---------------------------------------------------------------------------
// 19 - the bug reporter and analytics
// ---------------------------------------------------------------------------

const BUG_ID = /^crbug-\d{8}-\d{6}-[a-z0-9]{4}$/;

async function openBug(page) {
  await page.click('#bug-report-btn');
  await page.waitForSelector('#bug-modal [data-bug-field="dialog"]');
}

async function closeBugWithEscape(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#bug-modal', { state: 'detached' });
}

const frozenReport = (page) => page.evaluate(() => window.__cr.bug.frozen());
const liveCapture = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__cr.bug.capture())));

/** A fresh created game, one human (seat 1) against a random bot at instant speed. */
async function freshHumanGame(page, extra = '') {
  await page.goto(`${BASE}?players=2&bots=human,random&seed=11&shuffle=0&speed=instant&test=1${extra}`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready && window.__cr.getState());
}

async function waitHumanToAct(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const s = window.__cr.getState();
    return s.phase === 'ended' || window.__cr.seats()[s.toAct].human;
  }, null, { timeout });
}

/** The human takes the first legal action n times (bots reply in between). */
async function humanCommits(page, n) {
  for (let i = 0; i < n; i++) {
    await waitHumanToAct(page);
    const ok = await page.evaluate(() => {
      const s = window.__cr.getState();
      if (s.phase === 'ended') return false;
      window.__cr.commit(window.__cr.actions()[0]);
      return true;
    });
    if (!ok) break;
  }
  await waitHumanToAct(page);
}

/** Pauses the bots, then lets the human act until a bot is the one to move (the bot then waits, paused). */
async function humanThenBotToAct(page) {
  await waitHumanToAct(page);
  await page.evaluate(() => {
    window.__cr.pause(true);
    for (let i = 0; i < 60; i++) {
      const s = window.__cr.getState();
      if (s.phase === 'ended' || !window.__cr.seats()[s.toAct].human) break;
      window.__cr.commit(window.__cr.actions()[0]);
    }
  });
}

/** Whether the bug button overlaps any other visible control, and whether it is wholly on screen. */
async function bugButtonOverlaps(page) {
  // The set-up screen's data attribute is in the static HTML, so it is there before the script has mounted the button.
  await page.waitForFunction(() => window.__cr && window.__cr.ready && document.getElementById('bug-report-btn'), null, { timeout: 8000 });
  return page.evaluate(() => {
    const fab = document.getElementById('bug-report-btn').getBoundingClientRect();
    const hits = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
    };
    document.querySelectorAll('button, select, input, textarea, a[href], summary, [data-target], [data-akey]').forEach((el) => {
      if (el.id === 'bug-report-btn' || el.closest('#bug-modal') || !visible(el)) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(fab.right, r.right) - Math.max(fab.left, r.left);
      const y = Math.min(fab.bottom, r.bottom) - Math.max(fab.top, r.top);
      if (!(x > 1 && y > 1)) return;
      // On a page that scrolls the button sits on an opaque bar at the foot of the window. A control that has
      // scrolled UNDER that bar is not covered by the button (it is not on show there at all), so ask what would be
      // on top at that spot if the button were not there.
      const btn = document.getElementById('bug-report-btn');
      btn.style.visibility = 'hidden';
      const top = document.elementFromPoint((Math.max(fab.left, r.left) + Math.min(fab.right, r.right)) / 2, (Math.max(fab.top, r.top) + Math.min(fab.bottom, r.bottom)) / 2);
      btn.style.visibility = '';
      if (top && (top === el || el.contains(top))) hits.push(`${el.tagName} ${el.dataset.target || el.dataset.ui || el.dataset.setup || el.className}`.slice(0, 80));
    });
    return { hits, inView: fab.left >= 0 && fab.top >= 0 && fab.right <= window.innerWidth && fab.bottom <= window.innerHeight };
  });
}

async function bugButtonEverywhere(browser) {
  const page = await newPage(browser);
  // --- setup screen
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  assert((await page.locator('#bug-report-btn').count()) === 1, 'the bug button is on the setup screen');
  assert((await page.locator('#app #bug-report-btn').count()) === 0, 'and it is mounted outside the game root');
  await openBug(page);
  assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.bugField === 'title'), 'focus moves to the title field');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement.closest('#bug-modal')), `Tab stays inside the dialog (press ${i + 1})`);
  }
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => !!document.activeElement.closest('#bug-modal')), `Shift+Tab stays inside the dialog (press ${i + 1})`);
  }
  let f = await frozenReport(page);
  assert(f.screen === 'setup' && f.gameState === null && f.setupForm && f.setupForm.playerCount >= 2, `setup report: screen ${f.screen}`);
  assert(f.words.title === '' && Array.isArray(f.eventLog), 'the setup report has words and an event log');
  await closeBugWithEscape(page);
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id === 'bug-report-btn'), 'focus returns to the button after Escape');
  await page.keyboard.press('Control+Shift+B');
  await page.waitForSelector('#bug-modal');
  await closeBugWithEscape(page);
  // the Start button still works after the dialog came and went
  assert((await page.locator('[data-setup="start"]').count()) === 1, 'the setup screen is untouched');

  // --- mid-game, and twenty re-renders
  await loadPrepared(page, midGameState(), ['human', 'random', 'random']);
  await waitKind(page, 'workerStep');
  await page.evaluate(() => { document.getElementById('bug-report-btn').dataset.mark = 'same-element'; });
  const rendersBefore = await page.evaluate(() => window.__cr.renders());
  for (let i = 0; i < 20; i++) await page.click(`[data-ui="speed:${i % 2 === 0 ? 'fast' : 'normal'}"]`);
  const rendersAfter = await page.evaluate(() => window.__cr.renders());
  assert(rendersAfter - rendersBefore >= 20, `twenty re-renders happened (${rendersAfter - rendersBefore})`);
  assert((await page.locator('#bug-report-btn[data-mark="same-element"]').count()) === 1, 'the very same button survived twenty re-renders');
  await openBug(page);
  f = await frozenReport(page);
  assert(f.screen === 'game' && f.gameState && f.gameState.phase === 'play', `mid-game report: screen ${f.screen}`);
  await closeBugWithEscape(page);
  await page.keyboard.press('Control+Shift+B');
  await page.waitForSelector('#bug-modal');
  await closeBugWithEscape(page);

  // --- the hand-over cover
  const hot = baseState({ give: { hats: 0 } });
  await loadPrepared(page, hot, ['human', 'human']);
  await waitData(page, 'cover', '1');
  assert((await page.locator('#cover:not([hidden])').count()) === 1, 'the cover is up');
  await openBug(page); // a real click: the button sits above the cover
  f = await frozenReport(page);
  assert(f.screen === 'cover', `cover report: screen ${f.screen}`);
  assert(f.ui.coverUp === true, 'the report records that the cover was up');
  await closeBugWithEscape(page);

  // --- the end screen
  await loadPrepared(page, endedState(), ['human', 'random', 'random', 'random']);
  await page.waitForSelector('[data-screen="end"]');
  await openBug(page);
  f = await frozenReport(page);
  assert(f.screen === 'end', `end report: screen ${f.screen}`);
  assert(f.diagnostics.actionSpace.skipped && f.replayCheck.ok === true, 'a finished game reports no open action and still replays');
  await closeBugWithEscape(page);
  await page.close();
}

async function bugCaptureContent(browser) {
  const page = await newPage(browser);
  await freshHumanGame(page);
  await humanCommits(page, 30);
  await page.evaluate(() => window.__cr.pause(true));
  const [before, after] = await page.evaluate(() => {
    const h = window.__cr.hash();
    window.__cr.bug.capture();
    window.__cr.bug.capture();
    return [h, window.__cr.hash()];
  });
  assert(before === after, 'a capture does not change the live game (hashState identical before and after)');
  await openBug(page);
  const f = await frozenReport(page);
  const state = E.deserialiseState(JSON.stringify(f.gameState));
  assert(E.hashState(state) === f.stateHash, 'the stored state hashes to the stored hash');
  assert(f.stateHash === before, 'and it is the live game as it was when the dialog opened');
  assert(f.schemaVersion === 1 && BUG_ID.test(f.id), `schema and id (${f.id})`);
  assert(f.replay.origin === 'created' && f.replayCheck.ok === true, 'the capture verified its own replay record');
  assert(E.hashState(E.replayGame(f.replay.config, f.replay.actions)) === f.stateHash, 'replayGame(config, actions) in Node reproduces the reported state hash');
  const live = await page.evaluate(() => window.__cr.replayRecord());
  assert(live.actions.length === f.replay.actions.length && live.base === null, `the page kept ${live.actions.length} applied actions for replay`);
  assert(f.state === undefined && f.table.seats.length === 2 && f.table.seed === 11, 'the table section lists the seats and the seed');
  assert(f.table.seats.filter((s) => s.kind === 'human').length === 1, 'one human seat, one bot');
  // the diagnostics
  const d = f.diagnostics;
  assert(d.reporter.player === state.toAct && /must act now/.test(d.reporter.why), `the reporter is the human to act (${d.reporter.why})`);
  const legal = E.getValidActions(state);
  assert(d.legal.actions.map((a) => a.key).join('|') === legal.map(E.actionKey).join('|'), 'the legal list is exactly getValidActions');
  const legalListed = Object.values(d.actionSpace.byType).flatMap((slot) => slot.legal);
  assert(legalListed.length === legal.length && legalListed.every((a) => E.getBlockReason(state, { type: a.key.split(':')[0], ...a.params, player: state.toAct }) === null), 'every action with a null reason is legal');
  let checked = 0;
  for (const [type, slot] of Object.entries(d.actionSpace.byType)) {
    for (const g of slot.blocked) {
      assert(typeof g.now === 'string' && g.now.length > 3, `${type}: a block reason is a sentence`);
      for (const a of g.actions.slice(0, 3)) {
        const again = E.getBlockReason(state, { type, ...a.params, player: state.toAct });
        assert(again === g.now, `${a.key}: the engine says "${again}", the report says "${g.now}"`);
        checked += 1;
      }
    }
  }
  assert(checked > 15, `${checked} blocked actions were re-asked of the engine and matched`);
  assert(d.actionSpace.agreement.ok === true, `getValidActions and the block-reason ladder agree: ${JSON.stringify(d.actionSpace.agreement)}`);
  assert(d.players.length === 2 && typeof d.players[0].storage.capacity === 'number' && d.score.players.length === 2, 'per-player numbers and the score by source');
  assert(d.stack.frames.length >= 1 && d.decision && d.decision.prompt, 'the decision and the stack');
  // controls
  assert(d.controls.count > 0 && d.controls.items.every((i) => typeof i.label === 'string' && typeof i.enabled === 'boolean'), `controls: ${d.controls.count} items, each with a label and an enabled flag`);
  const lit = d.controls.items.filter((i) => i.kind === 'target' && i.state === 'legal');
  assert(lit.length > 0 && lit.every((i) => i.litMarker === true && typeof i.tooltip === 'string'), 'lit targets carry their marker and their tooltip text');
  const dim = d.controls.items.filter((i) => i.kind === 'target' && i.state === 'illegal' && i.tooltip);
  if (dim.length > 0) assert(dim.every((i) => i.tooltip.length > 5), 'a target that is not legal says why in its tooltip');
  // environment, UI state, logs
  assert(f.environment.viewport.width === 1440 && f.environment.devicePixelRatio >= 1 && /Chrome|Edg/.test(f.environment.userAgent) && /test=1/.test(f.environment.url), 'environment');
  assert(typeof f.environment.reducedMotion === 'boolean' && typeof f.environment.language === 'string', 'language and reduced-motion preference');
  assert(f.ui.mode === 'idle' && f.ui.paused === true && f.ui.botSpeed === 'instant' && typeof f.ui.undoDepth === 'number' && f.ui.botThinking === false, `UI state ${JSON.stringify(f.ui).slice(0, 200)}`);
  assert(f.actionLog.length > 5 && f.actionLog.every((a) => ['human', 'bot', 'automatic', 'fallback'].includes(a.how)), 'the action log has humans, bots and automatic actions');
  assert(f.actionLog.some((a) => a.how === 'bot') && f.actionLog.some((a) => a.how === 'human'), 'both human and bot actions are logged');
  assert(f.actionLog.every((a) => typeof a.text === 'string' && a.text.length > 0), 'each logged action has its describeAction text');
  assert(f.capture.sectionsWithErrors.length === 0, 'no section failed');
  assert(f.build === 'prototype 2026-10-11', `the build string comes from the config (${f.build})`);
  const size = JSON.stringify(f).length;
  assert(size < 3000000, `the report is ${Math.round(size / 1024)} KB`);
  log(`       a mid-game report: ${Math.round(size / 1024)} KB, ${f.replay.actions.length} actions, ${d.controls.count} controls`);
  await closeBugWithEscape(page);
  await page.close();
}

async function bugSectionFailure(browser) {
  const page = await newPage(browser);
  await freshHumanGame(page);
  await humanCommits(page, 4);
  await page.evaluate(() => window.__cr.pause(true));
  await page.evaluate(() => window.__cr.bug.failSections(['diagnostics']));
  await openBug(page);
  const f = await frozenReport(page);
  assert(typeof f.diagnostics.error === 'string' && /forced failure/.test(f.diagnostics.error), 'the broken section is { error }');
  assert(f.capture.sectionsWithErrors.includes('diagnostics'), 'the report names the failed section');
  assert(f.gameState && f.replay && f.stateHash && f.id && f.eventLog && f.actionLog, 'the rest of the report completed');
  await page.fill('[data-bug-field="title"]', 'Forced failure');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-bug-act="download"]')]);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert(saved.diagnostics.error && saved.words.title === 'Forced failure' && saved.gameState.phase === 'play', 'the downloaded file has the failed section marked and everything else');
  await closeBugWithEscape(page);
  await page.evaluate(() => window.__cr.bug.failSections([]));
  const g = await liveCapture(page);
  assert(g.diagnostics.reporter && !g.diagnostics.error, 'with the hook cleared the section works again');
  await page.close();
}

async function bugEventLog(browser) {
  // A click on the board while a bot is to act.
  const page = await newPage(browser);
  await freshHumanGame(page);
  await humanThenBotToAct(page);
  const toAct = await page.evaluate(() => window.__cr.getState().toAct);
  assert(await page.evaluate((t) => !window.__cr.seats()[t].human, toAct), 'a bot is to act');
  await page.evaluate(() => document.querySelector('#region-grid [data-target], [data-target^="space:"], [data-target^="city:"]').click());
  let f = await liveCapture(page);
  assert(f.eventLog.some((e) => e.kind === 'ignored' && /a bot is thinking/.test(e.text)), `a swallowed click appears in the event log: ${JSON.stringify(f.eventLog.slice(-3))}`);
  assert(f.diagnostics.reporter.player === 0 && /acted last/.test(f.diagnostics.reporter.why), `with a bot to act the report is about the human who acted last (${f.diagnostics.reporter.why})`);
  assert(f.diagnostics.actionSpace.askedFor === 0, 'the block reasons were asked for that human');
  // The page's own hooks: warnings, window errors and rejections, with the originals still called.
  await page.evaluate(() => {
    console.warn('warned-by-the-smoke-test');
    window.dispatchEvent(new ErrorEvent('error', { message: 'synthetic window error', filename: 'test.js', lineno: 7 }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('synthetic rejection') }));
  });
  f = await liveCapture(page);
  assert(f.eventLog.some((e) => e.kind === 'warning' && /warned-by-the-smoke-test/.test(e.text)), 'console.warn is logged');
  assert(f.eventLog.some((e) => e.kind === 'error' && /synthetic window error/.test(e.text)), 'window errors are logged');
  assert(f.eventLog.some((e) => e.kind === 'error' && /synthetic rejection/.test(e.text)), 'unhandled rejections are logged');
  await page.close();

  // The hand-over cover, a refused click, and a control with no action behind it.
  const page2 = await newPage(browser);
  const state = baseState({ give: { hats: 0 } });
  put(state, 1, 'W2');
  put(state, 1, 'W5');
  await loadPrepared(page2, state, ['human', 'human']);
  await waitData(page2, 'cover', '1');
  await page2.evaluate(() => document.querySelector('[data-target="space:W6"]').click());
  await page2.click('[data-ui="cover-ok"]');
  await waitData(page2, 'cover', '0');
  await page2.locator('[data-target="space:W2"]').click();
  await page2.waitForSelector('[data-field="notice"]');
  const shown = await page2.textContent('[data-field="notice"]');
  await page2.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.akey = 'noSuchAction:1';
    b.id = 'fake-control';
    document.getElementById('region-prompt').appendChild(b);
    b.click();
    b.remove();
  });
  f = await liveCapture(page2);
  assert(f.eventLog.some((e) => e.kind === 'ignored' && /hand-over cover is up/.test(e.text)), 'a click behind the hand-over cover is logged as ignored');
  const refusal = f.eventLog.find((e) => e.kind === 'refusal' && /shown to the player/.test(e.text));
  assert(refusal && refusal.text.includes(shown.trim().slice(0, 30)), `a refused click is logged with the reason the player saw ("${shown.trim().slice(0, 40)}...")`);
  assert(f.eventLog.some((e) => e.kind === 'ignored' && /no legal action maps to this control/.test(e.text)), 'a control with no legal action behind it is logged');
  assert(f.diagnostics.reporter.player === 0, 'the report is about the human who must act');
  await page2.close();
}

async function bugDownloadArchiveFrozen(browser) {
  const page = await newPage(browser);
  await freshHumanGame(page);
  await humanThenBotToAct(page);
  await page.evaluate(() => window.__cr.bug.archive.clear());
  const h0 = await hash(page);
  await openBug(page);
  const idShown = (await page.textContent('[data-bug-field="id"]')).trim();
  assert(BUG_ID.test(idShown), `the report id is shown prominently (${idShown})`);
  // A bot moves while the dialog is open.
  await page.evaluate(() => window.__cr.pause(false));
  await page.waitForFunction((h) => window.__cr.hash() !== h, h0, { timeout: 20000 });
  assert((await page.locator('#bug-modal').count()) === 1, 'the dialog is still open while the bot moves');
  await page.fill('[data-bug-field="title"]', 'Bot moved while I typed!');
  await page.selectOption('[data-bug-field="category"]', 'A bot did something odd');
  await page.fill('[data-bug-field="expected"]', 'the position to hold still');
  await page.fill('[data-bug-field="actual"]', 'it moved');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-bug-act="download"]')]);
  const name = dl.suggestedFilename();
  const m = /^continental-rails-bug-(crbug-\d{8}-\d{6}-[a-z0-9]{4})-(.+)\.json$/.exec(name);
  assert(m && m[1] === idShown && m[2] === 'bot-moved-while-i-typed', `the file name carries the id and the title slug (${name})`);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert(saved.id === idShown && saved.words.title === 'Bot moved while I typed!' && saved.words.category === 'A bot did something odd', 'the file holds the words, with the category as a verbatim label');
  assert(saved.stateHash === h0 && E.hashState(E.deserialiseState(JSON.stringify(saved.gameState))) === h0, 'the snapshot was frozen when the dialog opened, not when it was submitted');
  assert((await hash(page)) !== h0, 'while the live game has moved on');
  assert(/acted last/.test(saved.diagnostics.reporter.why), 'a bot was to act, so the report is about the human');
  // the archive
  assert((await page.evaluate(() => window.__cr.bug.archive.list().map((e) => e.id))).join() === idShown, 'the local archive lists the report');
  assert((await page.locator(`[data-bug-past="${idShown}"]`).count()) === 1, 'and the "Past reports" list shows it');
  await page.click('details[data-bug-field="past"] summary');
  const [again] = await Promise.all([page.waitForEvent('download'), page.click(`[data-bug-past="${idShown}"] [data-bug-act="past-download"]`)]);
  assert(again.suggestedFilename() === name, 'a past report downloads again under the same name');
  assert(fs.readFileSync(await again.path(), 'utf8') === fs.readFileSync(await dl.path(), 'utf8'), 'with the same content');
  // eviction beyond the cap
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) window.__cr.bug.archive.add({ id: `crbug-fake-${String(i).padStart(2, '0')}`, savedAt: 'x', title: `fake ${i}`, fileName: `f${i}.json`, text: '{}' });
  });
  const ids = await page.evaluate(() => window.__cr.bug.archive.list().map((e) => e.id));
  assert(ids.length === 20 && ids[19] === 'crbug-fake-24' && !ids.includes(idShown) && !ids.includes('crbug-fake-04'), `the archive holds 20 and evicts the oldest (${ids.length}, first ${ids[0]})`);
  await closeBugWithEscape(page);
  await page.close();

  // Storage that throws: everything still works.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page2);
  await page2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage denied'); } });
  });
  await freshHumanGame(page2);
  await openBug(page2);
  await page2.fill('[data-bug-field="title"]', 'No storage');
  const [dl2] = await Promise.all([page2.waitForEvent('download'), page2.click('[data-bug-act="download"]')]);
  assert(/-no-storage\.json$/.test(dl2.suggestedFilename()), 'the download works with storage denied');
  assert((await page2.locator('[data-bug-field="past-empty"]').count()) === 1, 'and the past list is simply empty');
  await page2.close();
}

async function bugNetworkAndMailto(browser) {
  // 1. Both config values empty: a whole bot game makes no request but to the test server, and no mailto: shows.
  const page = await newPage(browser);
  const foreign = [];
  const origin = new URL(BASE).origin;
  page.on('request', (req) => {
    const u = req.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== origin) foreign.push(u);
  });
  await page.goto(`${BASE}?players=2&bots=random,random&fast=1&seed=5&test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  await openBug(page);
  assert((await page.locator('#bug-modal a[href^="mailto:"], #bug-modal [data-bug-field="mailto"]').count()) === 0, 'no mailto: link with an empty address (mid-game)');
  await closeBugWithEscape(page);
  await page.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  await openBug(page);
  assert((await page.locator('#bug-modal a[href^="mailto:"]').count()) === 0, 'no mailto: link at the end');
  await page.fill('[data-bug-field="title"]', 'End');
  await Promise.all([page.waitForEvent('download'), page.click('[data-bug-act="download"]')]);
  await closeBugWithEscape(page);
  assert(foreign.length === 0, `no request to any host but the test server during a full bot game (${foreign.slice(0, 3).join(', ')})`);
  const quiet = await page.evaluate(() => ({ scripts: [...document.scripts].map((s) => s.src).filter((s) => /google|gtag|analytics/i.test(s)), dataLayer: typeof window.dataLayer, gtag: typeof window.gtag, tracked: window.__cr.tracked.length, id: window.__cr.config.GA4_MEASUREMENT_ID, email: window.__cr.config.BUG_REPORT_EMAIL }));
  assert(quiet.scripts.length === 0 && quiet.dataLayer === 'undefined' && quiet.gtag === 'undefined', `no analytics script, dataLayer or gtag (${JSON.stringify(quiet)})`);
  assert(quiet.tracked === 0 && quiet.id === '' && quiet.email === '', 'track() did nothing with the id empty, and both config values are empty');
  await page.close();

  // 2. The config overridden for the test: the mailto: appears with the id in its subject; track() calls are observable.
  const page2 = await newPage(browser);
  const foreign2 = [];
  page2.on('request', (req) => {
    const u = req.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).origin !== origin) foreign2.push(u);
  });
  await page2.goto(`${BASE}?players=2&bots=random,random&fast=1&seed=5&test=1&cfg_email=${DUMMY_USER}%40${DUMMY_HOST}&cfg_ga=${DUMMY_GA}&cfg_build=abc1234`);
  await page2.waitForSelector('[data-screen="end"]', { timeout: 180000 });
  await openBug(page2);
  const idShown = (await page2.textContent('[data-bug-field="id"]')).trim();
  await page2.fill('[data-bug-field="title"]', 'Secret title about Anna');
  const href = await page2.getAttribute('a[data-bug-field="mailto"]', 'href');
  assert(href.startsWith(`mailto:${DUMMY_USER}@${DUMMY_HOST}?`), `the mailto: link is pre-addressed (${href.slice(0, 60)})`);
  const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  assert(q.get('subject').includes(idShown), 'the report id is in the subject');
  assert(q.get('body').includes(idShown) && q.get('body').includes(`continental-rails-bug-${idShown}-secret-title-about-anna.json`), 'and in the body, with the name of the file to attach');
  const dl = await Promise.all([page2.waitForEvent('download'), page2.click('[data-bug-act="download"]')]);
  assert(dl[0].suggestedFilename().includes(idShown), 'the download still carries the id');
  const saved = JSON.parse(fs.readFileSync(await dl[0].path(), 'utf8'));
  assert(saved.build === 'abc1234', 'the build string is the configured one');
  await closeBugWithEscape(page2);
  const events = await page2.evaluate(() => window.__cr.tracked);
  const names = events.map((e) => e.event);
  for (const wanted of ['game_start', 'action_taken', 'game_end', 'bug_report_opened', 'bug_report_downloaded']) assert(names.includes(wanted), `track('${wanted}') was called (${[...new Set(names)].join(', ')})`);
  const start = events.find((e) => e.event === 'game_start').params;
  assert(start.player_count === 2 && start.bots === 2 && start.humans === 0 && start.bot_levels === 'random,random' && start.seed_given === true, `game_start params ${JSON.stringify(start)}`);
  const end = events.find((e) => e.event === 'game_end').params;
  assert(typeof end.end_reason === 'string' && end.turns > 0 && typeof end.duration_minutes === 'number' && end.winner_seat_type === 'random' && /^\d+\/\d+$/.test(end.scores), `game_end params ${JSON.stringify(end)}`);
  const taken = events.filter((e) => e.event === 'action_taken');
  assert(taken.length > 0 && taken.length <= 60, `action_taken is sampled (${taken.length} events for a whole bot game)`);
  assert(taken.every((e) => Object.keys(e.params).sort().join() === 'source,type'), 'action_taken carries the action type only');
  const blob = JSON.stringify(events);
  assert(!/Secret title|Anna|Player 1/.test(blob) && !blob.includes(`${DUMMY_USER}@`), 'no free text, no name, no address in any analytics event');
  assert(events.every((e) => Object.values(e.params).every((v) => ['number', 'boolean', 'string'].includes(typeof v) && String(v).length <= 100)), 'every parameter is a short plain value');
  assert(foreign2.length === 0, `still no network request with the sink on (${foreign2.slice(0, 3).join(', ')})`);
  await page2.close();

  // 3. The real injection path, with the one host intercepted so nothing leaves the machine.
  const page3 = await newPage(browser);
  let intercepted = 0;
  await page3.route('https://www.googletagmanager.com/**', (route) => {
    intercepted += 1;
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  const leaks = [];
  page3.on('request', (req) => {
    const u = req.url();
    if (/^(data|blob|about):/.test(u) || new URL(u).origin === origin || u.startsWith('https://www.googletagmanager.com/')) return;
    leaks.push(u);
  });
  await page3.goto(`${BASE}?test=1&cfg_ga=${DUMMY_GA}`);
  await page3.waitForFunction(() => window.__cr && window.__cr.ready);
  await page3.evaluate(() => window.__cr.trackSink(false));
  await openBug(page3);
  await closeBugWithEscape(page3);
  await openBug(page3);
  await closeBugWithEscape(page3);
  const injected = await page3.evaluate(() => ({ scripts: [...document.scripts].filter((s) => /googletagmanager/.test(s.src)).length, layer: window.dataLayer.map((x) => Array.from(x)[0]) }));
  assert(injected.scripts === 1, `the gtag script is added exactly once (${injected.scripts})`);
  assert(injected.layer.includes('config') && injected.layer.filter((x) => x === 'event').length === 2, `events were forwarded to gtag (${injected.layer.join(',')})`);
  assert(intercepted === 1 && leaks.length === 0, `one intercepted request to the analytics host, nothing else leaves (${intercepted}, ${leaks.join(',')})`);
  await page3.close();
}

async function bugButtonLayout(browser) {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await newPage(browser, w, h);
    await page.goto(`${BASE}?test=1`);
    await waitSetup(page);
    let r = await bugButtonOverlaps(page);
    assert(r.inView && r.hits.length === 0, `${w}x${h} setup: the bug button is on screen and covers nothing (${r.hits.join('; ')})`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    r = await bugButtonOverlaps(page);
    assert(r.hits.length === 0, `${w}x${h} setup scrolled to the bottom: covers nothing (${r.hits.join('; ')})`);
    await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
    await waitKind(page, 'workerStep');
    await page.mouse.move(w / 2, 4);
    for (const tab of [null, 'goals', 'pony']) {
      if (tab) await page.click(`[data-ui="tab:${tab}"]`);
      for (const bottom of [false, true]) {
        await page.evaluate((b) => window.scrollTo(0, b ? document.documentElement.scrollHeight : 0), bottom);
        r = await bugButtonOverlaps(page);
        assert(r.inView && r.hits.length === 0, `${w}x${h} in play${tab ? ` (${tab} tab)` : ''}${bottom ? ' scrolled down' : ''}: covers nothing (${r.hits.join('; ')})`);
      }
    }
    // a refusal toast and a scoring pop-up on screen: the button stays reachable (they stack above it, never under it).
    await openBug(page);
    assert((await page.locator('.bug-card').boundingBox()).width <= w, `${w}x${h}: the dialog fits the width`);
    await closeBugWithEscape(page);
    await shot(page, 'bug-button-play', w, h);
    await openBug(page);
    writeEvidence(path.join(SHOTS, `bug-dialog-${w}x${h}.png`), await page.screenshot());
    await closeBugWithEscape(page);
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 20 - the landing page, the layout at four widths, and the look
// ---------------------------------------------------------------------------

const FINAL = path.join(SHOTS, 'final');
const SIZES = [[1440, 900], [1280, 800], [1024, 768], [390, 844]];
const MB = 1024 * 1024;

/** The manifest's status of every picture in the page, and whether each loaded. Runs in the page. */
async function picturesOn(page, rootSelector) {
  return page.evaluate(async (sel) => {
    const manifest = await (await fetch('assets/art-manifest.json', { cache: 'no-store' })).json();
    const status = new Map(manifest.map((e) => [e.id, e.status]));
    const root = document.querySelector(sel);
    return [...root.querySelectorAll('img, image')].map((img) => {
      const r = img.getBoundingClientRect();
      return {
        id: img.dataset.artId ?? null,
        status: img.dataset.artId ? status.get(img.dataset.artId) ?? 'unknown' : 'no-id',
        shown: r.width > 0 && r.height > 0,
        inHero: !!img.closest('[data-field="hero"]'),
        loaded: img.tagName !== 'IMG' || (img.complete && img.naturalWidth > 0),
      };
    });
  }, rootSelector);
}

async function landingPage(browser) {
  const page = await newPage(browser);
  // Everything the first paint asks for: where it came from, and how heavy the pictures are.
  const origin = new URL(BASE).origin;
  const seen = [];
  page.on('request', (req) => seen.push({ url: req.url(), type: req.resourceType() }));
  const weights = [];
  page.on('response', (res) => {
    if (res.request().resourceType() !== 'image') return;
    weights.push(res.body().then((b) => ({ url: res.url(), bytes: b.length }), () => ({ url: res.url(), bytes: 0 })));
  });
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  await page.waitForLoadState('networkidle');
  const images = await Promise.all(weights);
  const total = images.reduce((n, i) => n + i.bytes, 0);
  const foreign = seen.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:'));
  assert(foreign.length === 0, `first paint asks no other host for anything (${foreign.map((r) => r.url).join(', ')})`);
  assert(images.length >= 1 && total < 2 * MB, `first paint loads under 2 MB of images (${images.length} images, ${(total / 1024).toFixed(0)} KB)`);
  assert(!seen.some((r) => r.type === 'font'), 'no web font is fetched');
  log(`       landing page first paint: ${images.length} images, ${(total / 1024).toFixed(0)} KB, every request to ${origin}`);

  // The document itself.
  const head = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    desc: (document.querySelector('meta[name="description"]') || {}).content || '',
    og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute('property'), m.content])),
    icon: (document.querySelector('link[rel="icon"]') || {}).href || '',
  }));
  assert(head.lang === 'en-GB' && /Continental Rails/.test(head.title) && head.desc.length > 60, `lang, title and description (${head.lang}, ${head.title})`);
  assert(head.og['og:title'] && head.og['og:description'] && head.og['og:image'], 'Open Graph title, description and image');
  assert(/^data:image\/svg/.test(head.icon), 'the favicon is the drawn one while ui-favicon is a placeholder');
  // The address a link preview uses is absolute, on the published site; the file it names must exist in the repository.
  const SITE = 'https://www.wombatgamefactory.com/continental-rails-game/';
  assert(head.og['og:url'] === SITE, `og:url is the published address (${head.og['og:url']})`);
  assert(head.og['og:image'].startsWith(SITE), `og:image is an absolute address on the published site (${head.og['og:image']})`);
  const ogRelative = head.og['og:image'].slice(SITE.length);
  const ogStatus = await page.evaluate(async (src) => (await fetch(src)).status, ogRelative);
  assert(ogStatus === 200, `the og:image file exists in the repository (${ogRelative})`);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'art-manifest.json'), 'utf8'));
  const ogEntry = manifest.find((e) => `assets/${e.file}` === ogRelative);
  assert(ogEntry && ogEntry.status === 'real', 'and it is real art in the manifest, not a placeholder');

  // The pitch, in order.
  const hook = ((await page.textContent('[data-field="hook"]')) ?? '').trim();
  assert(hook.length > 30 && /railroad/.test(hook), `the hook is shown (${hook})`);
  assert(((await page.textContent('.hero__title')) ?? '').trim() === 'Continental Rails', 'the title is text while ui-logo is a placeholder');
  const steps = await page.$$eval('[data-field="loop"] .step h3', (els) => els.map((e) => e.textContent.replace(/^\d+/, '').trim()));
  assert(steps.join(',') === 'Collect,Build,Lay', `how a turn works in three steps (${steps.join(',')})`);
  const stepText = await page.$$eval('[data-field="loop"] .step p', (els) => els.map((e) => e.textContent.trim()));
  assert(stepText.every((t) => t.length > 60) && /built on your train/.test(stepText[1]) && /only lay what you have already built/.test(stepText[2]), 'each step is explained, and build is told apart from lay');
  const note = (await page.textContent('[data-field="build-lay-note"]')) ?? '';
  assert(/built on your train first, then laid on the map as whole routes/.test(note), `the build-then-lay line (${note.trim()})`);
  const stats = await page.$$eval('[data-field="stat-strip"] [data-stat]', (els) => els.map((e) => `${e.dataset.stat}=${e.querySelector('dd').textContent.trim()}`));
  assert(stats.join('|') === 'players=2 to 4|weight=Heavyweight Euro', `the stat strip has players and weight and NO play time or age while the config is empty (${stats.join('|')})`);
  assert((await page.locator('[data-field="distinctive"] li').count()) === 4 && (await page.locator('[data-field="prototype"] li').count()) === 4, 'four points on what is different and four on the prototype');
  const order = await page.evaluate(() => ['[data-field="hero"]', '#setup-panel', '[data-field="loop"]', '[data-field="distinctive"]', '[data-field="credits"]'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY)));
  assert(order.every((y, i) => i === 0 || y > order[i - 1]), `hero, set-up, the loop, the points, the credits, in that order (${order.join(' < ')})`);
  const text = await page.evaluate(() => document.getElementById('screen-setup').innerText);
  const banned = new RegExp(['Pacific' + ' Rails', 'Vesuv' + 'ius', 'Steel', 'playtest', 'simulat', 'award', 'undefined', 'NaN'].join('|'), 'i').exec(text);
  assert(!banned, `nothing the page must not say (${banned && banned[0]})`);
  assert(/Designed by Dean Morris/.test(text) && /Wombat Game Factory/.test(text) && /Prototype - rules and art subject to change/.test(text), 'the credits');
  const levels = (await import('../src/bots/index.js')).BOT_LEVELS;
  assert(levels.every((l) => text.includes(l.name)), 'every registered bot level is named');
  const seatNote = (await page.textContent('.seat[data-seat="1"] [data-field="seat-note"]')) ?? '';
  assert(levels.some((l) => l.description === seatNote.trim()), `a bot seat shows its level's description (${seatNote.trim()})`);

  // The set-up panel: the seed is under Advanced, the variants are folded with the presets in view.
  assert(!(await page.locator('[data-setup="seed"]').isVisible()), 'the seed is tucked under Advanced');
  await page.click('[data-setup="advanced-toggle"]');
  assert(await page.locator('[data-setup="seed"]').isVisible(), 'and Advanced shows it');
  assert((await page.locator('[data-variant]').count()) === 0 && (await page.locator('[data-setup^="preset:"]:visible').count()) === 3, 'the variants are folded away and the three presets are in view');

  // No placeholder picture anywhere on the page (scrolled through, so the lazy ones have loaded).
  for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForLoadState('networkidle');
  const pics = await picturesOn(page, '#screen-setup');
  assert(pics.length >= 4, `the page shows pictures (${pics.length})`);
  const bad = pics.filter((p) => p.status !== 'real');
  assert(bad.length === 0, `no placeholder picture is on the landing page (${bad.map((p) => `${p.id}:${p.status}`).join(', ')})`);
  assert(pics.some((p) => p.inHero && p.shown && p.status === 'real'), 'the hero is built from real art');
  assert(pics.every((p) => p.loaded && p.shown), 'and every picture loaded');
  assert((await page.locator('#screen-setup .art-chip').count()) === 0, 'no picture fell back to a text chip');
  await page.evaluate(() => window.scrollTo(0, 0));

  // "Play now" brings the set-up panel into view.
  await page.click('.hero [data-setup="play"]');
  await page.waitForFunction(() => document.querySelector('#setup-panel').getBoundingClientRect().top < 200, null, { timeout: 4000 });

  // The designer's play time appears the moment the config has one, and not before.
  const page2 = await newPage(browser);
  await page2.goto(`${BASE}?test=1&cfg_playtime=${encodeURIComponent('90-120 min')}`);
  await waitSetup(page2);
  assert(((await page2.textContent('[data-stat="time"] dd')) ?? '').trim() === '90-120 min', 'a play time set in the config is shown as written');
  await page2.close();

  // "Watch a demo game": one click, four bots, moving, at a speed a person can follow.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.hero [data-setup="demo"]');
  await page.waitForSelector('#app[data-phase="setup"], #app[data-phase="play"]');
  await page.waitForFunction(() => window.__cr.getState() && window.__cr.getState().seq >= 12, null, { timeout: 30000 });
  const demo = await page.evaluate(() => ({ seats: window.__cr.seats().map((s) => (s.human ? 'human' : s.level)), ui: document.querySelector('[data-ui^="speed:"].is-on').dataset.ui, incidents: window.__cr.incidents().length, screen: document.body.dataset.screen }));
  assert(demo.seats.length === 4 && demo.seats.every((s) => s !== 'human'), `one click starts a four-bot game (${demo.seats.join(',')})`);
  assert(demo.ui === 'speed:fast' && demo.incidents === 0 && demo.screen === 'game', `at a watchable speed, with no driver incident (${demo.ui})`);
  assert((await page.locator('#cover:not([hidden])').count()) === 0, 'and no hand-over screen in the way');
  await page.close();
}

/** No sideways scroll of the page, and (on a phone) no control too small to tap. */
async function fitsWidth(page, where, w) {
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, win: window.innerWidth }));
  assert(m.doc <= m.win && m.body <= m.win, `${where}: no horizontal scroll (document ${m.doc}, body ${m.body}, window ${m.win})`);
  if (w > 700) return;
  const small = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.btn, select, input[type="text"], input[type="number"], .wspace, .cong, .score, .dock__tab, .dock__home, .bug-btn, summary').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || el.closest('[hidden]') || el.closest('[inert]')) return;
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.height)}px "${(el.textContent || '').trim().slice(0, 18)}"`);
    });
    return out;
  });
  assert(small.length === 0, `${where}: every control is at least 44 px high (${small.slice(0, 6).join('; ')})`);
}

async function layoutWidths(browser) {
  for (const [w, h] of SIZES) {
    const page = await newPage(browser, w, h);
    await page.goto(`${BASE}?test=1`);
    await waitSetup(page);
    await fitsWidth(page, `${w}x${h} landing page`, w);
    await page.click('[data-setup="variants-toggle"]');
    await fitsWidth(page, `${w}x${h} landing page with the variants open`, w);
    await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
    await waitKind(page, 'workerStep');
    await fitsWidth(page, `${w}x${h} in play`, w);
    for (const tab of ['upgrades', 'goals', 'pony']) {
      await page.click(`[data-ui="tab:${tab}"]`);
      await fitsWidth(page, `${w}x${h} with the ${tab} panel open`, w);
    }
    await loadPrepared(page, endedState(), ['human', 'random', 'random', 'random']);
    await page.waitForSelector('[data-screen="end"]');
    await fitsWidth(page, `${w}x${h} end screen`, w);
    assert((await page.locator('[data-field="winner"]').count()) === 1 && (await page.locator('.podium__seat').count()) === 4, 'the end screen names the winner and ranks the four');
    const sums = await page.$$eval('.end__sum', (els) => els.map((e) => e.textContent.trim()));
    const totals = await page.$$eval('[data-total]', (els) => els.map((e) => e.textContent.trim()));
    assert(sums.every((s, i) => s === '' || new RegExp(`= ${totals[i]}$`).test(s)), `the arithmetic of each total is written out (${sums.join(' | ')})`);
    await page.close();
  }
}

/** Rectangles of things on screen, for the layout checks. */
function rectsOf(page, selectors) {
  return page.evaluate((sels) => {
    const out = { vw: window.innerWidth, vh: window.innerHeight, pageH: document.documentElement.scrollHeight };
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }
    return out;
  }, selectors);
}
const inside = (a, vw, vh) => a && a.w > 0 && a.h > 0 && a.x >= -0.5 && a.y >= -0.5 && a.r <= vw + 0.5 && a.b <= vh + 0.5;
const overlap = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;

async function oneScreenAt1440(browser) {
  const page = await newPage(browser, 1440, 900);
  await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
  await waitKind(page, 'workerStep');
  const sel = { prompt: '#region-prompt', grid: '#region-grid .grid3', map: '#region-map svg.map', mapRegion: '.region--map', train: '#region-trains .train--full', trainRegion: '.region--trains', scores: '#region-scores', lastScore: '#region-scores .score:last-child', district: '.district[data-district="D5"]', reset: '.cong.is-reset', lastEntry: '.cong[data-entry="C6"]', congress: '.region--congress', log: '#region-log' };
  const r = await rectsOf(page, sel);
  assert(r.pageH <= r.vh, `the page itself does not scroll at 1440 x 900 (${r.pageH} px of content in ${r.vh})`);
  for (const name of ['prompt', 'grid', 'map', 'train', 'scores', 'lastScore', 'log']) assert(inside(r[name], r.vw, r.vh), `${name} is wholly inside the window (${JSON.stringify(r[name])})`);
  assert(r.train.b <= r.trainRegion.b + 0.5 && r.lastScore.b <= r.scores.b + 0.5, 'the train and the last player card are not cut off by their own frames');
  assert(r.district.w >= 125, `a district tile is at least 125 px wide (${Math.round(r.district.w)})`);
  assert(r.map.w >= 600, `the map is at least 600 px wide (${Math.round(r.map.w)})`);
  // The Congress strip: the last entry and Reset are on screen at 900 px high with an ordinary prompt.
  assert(inside(r.lastEntry, r.vw, r.vh) && inside(r.reset, r.vw, r.vh) && r.reset.b <= r.congress.b + 0.5, `Congress entry C6 and Reset are visible without scrolling (${Math.round(r.reset.b)} of ${Math.round(r.congress.b)})`);
  // An opened module panel takes the train strip's place: the map keeps (nearly) its size.
  const closed = r.map;
  await page.click('[data-ui="tab:pony"]');
  const open = await rectsOf(page, { map: '#region-map svg.map', dock: '#region-dock', body: '.dock__body', mapRegion: '.region--map' });
  const mapBox = (m) => Math.min(m.w, m.h * 1.25);
  assert(mapBox(open.map) >= 0.85 * mapBox(closed), `with the dock open the map keeps at least 85% of its size (${Math.round(mapBox(open.map))} of ${Math.round(mapBox(closed))})`);
  assert(inside(open.body, open.vw, open.vh) && open.dock.y >= open.mapRegion.b - 2, 'and the panel is under the map, inside the window');
  assert(open.pageH <= open.vh, 'still without scrolling the page');
  await page.keyboard.press('Escape');
  assert((await page.locator('.dock__home.is-active').count()) === 1 && (await page.locator('#region-trains .train--full').isVisible()), 'Escape brings the train back');

  // A tall prompt (five building buttons): Reset is still reachable by scrolling the Congress strip, never lost.
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, s);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await clickTarget(page, 'route:SEA-SPO');
  await waitKind(page, 'placeBuildings');
  await page.locator('.cong.is-reset').scrollIntoViewIfNeeded();
  const tall = await rectsOf(page, { reset: '.cong.is-reset', grid: '#region-grid .grid3', prompt: '#region-prompt' });
  assert(inside(tall.reset, tall.vw, tall.vh) && tall.pageH <= tall.vh, 'with a tall prompt Reset can still be scrolled into view inside the strip');
  assert(inside(tall.grid, tall.vw, tall.vh), 'and the action grid stays on screen');

  // Built tiles on the train and laid tiles on the map are the same drawing.
  const same = await page.evaluate(() => {
    const laid = document.querySelector('g.route[data-route="SEA-SPO"] .tile__bed');
    const built = document.querySelector('.stock--ground .tile__bed');
    return laid && built ? { laid: getComputedStyle(laid).fill, built: getComputedStyle(built).fill, rails: document.querySelectorAll('g.route[data-route="SEA-SPO"] .tile__rail').length } : null;
  });
  assert(same && same.laid === same.built && same.rails >= 2, `a laid Ground tile and a built Ground tile share one shape and colour (${JSON.stringify(same)})`);
  // Player colours are clear of the three terrain colours.
  const clash = await page.evaluate(async () => {
    const { PLAYER_COLOURS } = await import('./src/ui/setup.js');
    const cs = getComputedStyle(document.documentElement);
    const hex = (v) => { const m = /^#([0-9a-f]{6})$/i.exec(v.trim()); const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const terrain = ['--ground', '--tunnel', '--bridge'].map((t) => [t, hex(cs.getPropertyValue(t))]);
    // CIE L*a*b* distance (Delta E 1976): about 2 is just noticeable, 30 and over is a plainly different colour.
    const lab = (rgb) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const dist = (a, b) => { const p = lab(a); const q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    const out = [];
    let nearest = { d: Infinity, pair: '' };
    for (const c of PLAYER_COLOURS) for (const [t, rgb] of terrain) {
      const d = dist(hex(c.hex), rgb);
      if (d < nearest.d) nearest = { d, pair: `${c.name} / ${t}` };
      if (d < 30) out.push(`${c.name} / ${t} ${d.toFixed(0)}`);
    }
    return { out, nearest: `${nearest.pair} at ${nearest.d.toFixed(0)}` };
  });
  assert(clash.out.length === 0, `no player colour sits near a terrain colour (${clash.out.join(', ')})`);
  log(`       player colours against Ground, Tunnel and Bridge: the nearest pair is ${clash.nearest} (Delta E; 30 is the floor)`);
  await page.close();
}

async function floatingThings(browser) {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await newPage(browser, w, h);
    const s = baseState({ give: { hats: 0 } });
    setHeads(s, 0, 'SEA', 'OMA');
    give(s, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
    await loadPrepared(page, s);
    await clickTarget(page, 'space:W6');
    await clickTarget(page, 'district:D5');
    await waitKind(page, 'layTracks');
    await clickTarget(page, 'route:SEA-SPO');
    await waitKind(page, 'placeBuildings');
    await clickSelector(page, 'g[data-route="SEA-HEL"]'); // a refused click: the widest message there is
    await page.waitForSelector('[data-field="notice"]');
    await page.waitForSelector('[data-field="scoring-popup"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    const r = await rectsOf(page, { toast: '.toast', popup: '.popup', bug: '#bug-report-btn', train: '.region--trains' });
    assert(inside(r.toast, r.vw, r.vh) && inside(r.popup, r.vw, r.vh) && inside(r.bug, r.vw, r.vh), `${w}x${h}: the message, the pop-up and the report button are all on screen`);
    assert(!overlap(r.toast, r.popup), `${w}x${h}: the message and the scoring pop-up do not overlap`);
    assert(!overlap(r.toast, r.bug) && !overlap(r.popup, r.bug), `${w}x${h}: neither covers the report button`);
    if (w > 1100) assert(!overlap(r.popup, r.train) && !overlap(r.toast, r.train), `${w}x${h}: neither covers the train strip`);
    await page.close();
  }
}

async function reducedMotion(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  watch(page);
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || 'animation'));
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  assert((await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) === true, 'the page sees the reduced-motion preference');
  let list = await running();
  assert(list.length === 0, `landing page: nothing is animating (${list.join(', ')})`);
  // In play, with lit targets (they pulse otherwise), a message and the scoring pop-up up.
  const s = baseState({ give: { hats: 0 } });
  setHeads(s, 0, 'SEA', 'OMA');
  give(s, 0, { tiles: { ground: 4, tunnel: 2, bridge: 2 }, hats: 0 });
  await loadPrepared(page, s);
  await waitKind(page, 'workerStep');
  assert((await page.locator('.wspace.is-legal').count()) > 0, 'there are lit worker spaces');
  list = await running();
  assert(list.length === 0, `lit targets: nothing is animating (${list.join(', ')})`);
  await clickTarget(page, 'space:W6');
  await clickTarget(page, 'district:D5');
  await clickTarget(page, 'route:SEA-SPO');
  await clickSelector(page, 'g[data-route="SEA-HEL"]');
  await page.waitForSelector('[data-field="notice"]');
  list = await running();
  assert(list.length === 0, `a flash, a message and a pop-up: nothing is animating (${list.join(', ')})`);
  // A bot thinking (the spinner).
  await loadPrepared(page, baseState(), ['random', 'random'], { paused: true });
  await page.waitForSelector('[data-field="thinking"]');
  list = await running();
  assert(list.length === 0, `the thinking spinner is still (${list.join(', ')})`);
  await context.close();
  // And with no such preference the lit targets do pulse (so the check above is not vacuous).
  const page2 = await newPage(browser);
  await loadPrepared(page2, baseState());
  await waitKind(page2, 'workerStep');
  const moving = await page2.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  assert(moving > 0, 'without the preference the lit targets pulse');
  await page2.close();
}

/** WCAG contrast of the text of each selector against the background actually behind it. Runs in the page. */
function contrastOf(page, selectors) {
  return page.evaluate((sels) => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const backgroundOf = (el) => {
      const stack = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const bg = parse(cs.backgroundColor);
        if (cs.backgroundImage !== 'none' && bg[3] < 1) return null; // a picture or gradient with nothing solid under it: not measurable here
        if (bg[3] > 0) stack.push(bg);
        if (bg[3] >= 1) break;
      }
      let base = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
      return base;
    };
    const out = [];
    for (const sel of sels) {
      const els = [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled && !el.closest('[hidden]') && (el.textContent || '').trim() !== ''; });
      if (els.length === 0) { out.push({ sel, missing: true }); continue; }
      let worst = null;
      for (const el of els.slice(0, 12)) {
        const bg = backgroundOf(el);
        if (!bg) continue;
        const fg = over(parse(getComputedStyle(el).color), bg);
        const a = lum(fg); const b = lum(bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (worst === null || ratio < worst) worst = ratio;
      }
      out.push({ sel, ratio: worst });
    }
    return out;
  }, selectors);
}

async function contrastCheck(browser) {
  const page = await newPage(browser);
  const check = async (where, selectors) => {
    const res = await contrastOf(page, selectors);
    const missing = res.filter((r) => r.missing).map((r) => r.sel);
    assert(missing.length === 0, `${where}: each selector of the contrast check is on screen (${missing.join(', ')})`);
    const low = res.filter((r) => r.ratio !== null && r.ratio < 4.5).map((r) => `${r.sel} ${r.ratio.toFixed(2)}`);
    assert(low.length === 0, `${where}: text contrast is at least 4.5:1 (${low.join('; ')})`);
    const lowest = res.filter((r) => r.ratio !== null).sort((a, b) => a.ratio - b.ratio)[0];
    log(`       ${where}: ${res.length} text styles, lowest ${lowest.sel} at ${lowest.ratio.toFixed(2)}:1`);
  };
  await page.goto(`${BASE}?test=1`);
  await waitSetup(page);
  await page.click('[data-setup="variants-toggle"]');
  await check('landing page', ['.hero__kicker', '.hero__title', '.hero__hook', '.stat-box dt', '.stat-box dd', '.landing__intro', '.btn--primary', '.btn--ghost', '.setup__panel h2', '.setup__count .btn', '.setup__count .btn.is-on', '.seat__n', '.seat__note', '.seat select', '.setup__bots summary', '.vpanel__summary', '.vpreset .btn__label', '.vpreset .btn__sub', '.vrow__label', '.vrow__desc', '.vgroup legend', '.step__body h3', '.step__body p', '.step__n', '.steps__note', '.pitch h2', '.points li', '.points b', '.credits__main', '.credits__small', '#bug-report-btn']);
  await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
  await waitKind(page, 'workerStep');
  await check('in play', ['.hdr__title', '.hdr__meta', '.hdr .btn', '.hdr .btn.is-on', '.chip', '.prompt__name', '.prompt__turn', '.prompt__main', '.prompt__hint', '.allmoves summary', '.region__title', '.region__title small', '.cong__cost', '.cong__text', '.cong__senator', '.congress__lobby', '.score__name', '.score__vp', '.score__vp small', '.score__flag', '.badge--human', '.badge--bot', '.pstat b', '.log__head', '.log__entry', '.dock__home', '.dock__tab', '.dock__agenda-label', '.dock__agenda-text', '.train__name', '.storage__head', '.storage__label', '.storage__note', '.engine__head', '.engine__head small', '.htrack__p', '.tslot b', '.cslot small', '#bug-report-btn']);
  await page.click('[data-ui="tab:pony"]');
  await check('Pony Express panel', ['.dock__tab.is-active', '.ptok', '.pony__left', '.prank h4', '.pcard__head b', '.pcard__cost', '.pcard__kind', '.pcard__text']);
  await loadPrepared(page, endedState(), ['human', 'random', 'random', 'random']);
  await page.waitForSelector('[data-screen="end"]');
  await check('end screen', ['.end__kicker', '.end__title', '.end__reason', '.podium__name', '.podium__rank', '.podium__vp', '.end__table tbody th', '.end__table tbody td', '.end__col', '.end__total', '.end__sumrow td', '.end__aux th', '.end__tie', '.end__meta', '.end__buttons .btn--primary', '.end__buttons .btn:not(.btn--primary)']);
  await loadPrepared(page, baseState({ give: { hats: 0 } }), ['human', 'human']);
  await waitData(page, 'cover', '1');
  await check('hand-over cover', ['.cover__big', '.cover__name', '.cover__small', '.cover .btn--primary']);
  // Keyboard focus is visible: a focused control carries an outline.
  await page.click('[data-ui="cover-ok"]');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, w: parseFloat(cs.outlineWidth), style: cs.outlineStyle }; });
  assert(ring.w >= 2 && ring.style !== 'none', `keyboard focus is visible (${JSON.stringify(ring)})`);
  await page.close();
}

async function finalScreenshots(browser) {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await newPage(browser, w, h);
    const snap = async (name, fullPage = false) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(Math.round(w / 2), 3);
      await page.waitForTimeout(200);
      writeEvidence(path.join(FINAL, `${name}-${w}x${h}.png`), await page.screenshot({ fullPage }));
    };
    await page.goto(`${BASE}?test=1`);
    await waitSetup(page);
    // Walk the page once so the pictures below the fold have loaded before the full-page picture is taken.
    for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(50);
    }
    await page.waitForLoadState('networkidle');
    await snap('landing-page', true);
    await loadPrepared(page, allOnMidGame(), ['human', 'random', 'random']);
    await waitKind(page, 'workerStep');
    await snap('in-play', w < 1101);
    await page.click('[data-ui="tab:pony"]');
    await snap('dock-open', w < 1101);
    const act = baseState();
    setTrain(act, 0, [['crew', 'miner'], ['engineer', 'financier']]);
    give(act, 0, { resources: { iron: 4, wood: 2, gunpowder: 2 }, tiles: { ground: 1, tunnel: 0, bridge: 0 }, coins: 3, hats: 0 });
    claim(act, 1, 'SEA-SPO', 'POR-SPO');
    setHeads(act, 0, 'LAX', 'KCY');
    await loadPrepared(page, act);
    await clickTarget(page, 'space:W3');
    await clickTarget(page, 'district:D4');
    await waitKind(page, 'trainActivation');
    await clickAkey(page, 'useStep');
    await waitKind(page, 'trainActivation');
    await snap('train-activation', w < 1101);
    const lay = baseState();
    setHeads(lay, 0, 'SEA', 'OMA');
    give(lay, 0, { resources: { iron: 1, wood: 1, gunpowder: 1 }, tiles: { ground: 4, tunnel: 2, bridge: 1 }, hats: 0 });
    claim(lay, 1, 'POR-SPO');
    await loadPrepared(page, lay);
    await clickTarget(page, 'space:W6');
    await clickTarget(page, 'district:D5');
    await waitKind(page, 'layTracks');
    await snap('lay-tracks', w < 1101);
    await loadPrepared(page, baseState({ give: { hats: 0 } }), ['human', 'human']);
    await waitData(page, 'cover', '1');
    await snap('hand-over');
    await loadPrepared(page, endedState(), ['human', 'medium', 'easy', 'random'].map((id) => id), { paused: true });
    await page.waitForSelector('[data-screen="end"]');
    await snap('end-screen'); // the end screen is a fixed sheet with its own scroll: the window is the picture
    await page.close();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const server = await startServer(0);
  BASE = server.url;
  const browser = await launch();
  log(`UI smoke test against ${BASE} in ${browser.version()}`);
  try {
    await test('1 four-bot game reaches the end screen (all modules on)', () => fourBotGame(browser));
    await test('1b a four-bot game with the registered levels (random, easy, medium) runs without driver incidents', () => mixedBots(browser));
    await test('2a setup choices: railhead, house track, specialist', () => setupChoices(browser));
    await test('2b place, hat toggle, choose district with a hat, gather, bonus action', () => placeHatGatherBonus(browser));
    await test('2c choose a district without a hat, gather', () => gatherWithoutHat(browser));
    await test('2d remove, train activation use and skip', () => removeAndActivate(browser));
    await test('2e Congress entry', () => congressSegment(browser));
    await test('2f claim a route, telegraph station', () => layTracksTelegraph(browser, null));
    await test('2g claim a route, railway station', () => layTracksRailway(browser));
    await test('2h move train, skip building, stop', () => moveTrain(browser, null));
    await test('2i discard on overflow', () => discardOnOverflow(browser));
    await test('2j displace; 4 hot-seat cover, resource choice for a non-active player and hand-back', () => displaceAndHotSeat(browser, null));
    await test('3 undo', () => undoSegment(browser));
    await test('7 bot pacing: thinking indicator, pause, resume', () => botPacing(browser));
    await test('7b pacing belongs to the instant-moving levels: a search bot is asked for its move after the short pause only', () => botPacingLevels(browser));
    await test('8 bot failure cap: three failures, then a random legal action and an incident in the log', () => botFailureCap(browser));
    await test('5 the generic layer alone finishes a human-driven game', () => genericOnly(browser));
    await test('10a a four-bot game with every module on: dock, tabs, tokens on the map, panels beside the map', () => modulesOnGame(browser));
    await test('10b a four-bot game with every module off: no panel, no heading, no control, no mention', () => modulesOffGame(browser));
    await test('11a the variants panel is generated from the engine table; highlights, messages, reset, presets', () => variantsPanel(browser));
    await test('11b a variant set through the panel reaches the header chip, the engine state, the address, a reload and the end screen', () => variantsThroughPanel(browser));
    await test('12a refused clicks: an unaffordable route, an occupied space, a used Congress entry; the three highlight states', () => refusedClicks(browser, null));
    await test('12b tooltips and badges: worker space, Congress entry, district, route, city', () => tooltipsAndBadges(browser));
    await test('13a a forced follow-up is previewed before the click, marked automatic after it, and its highlight survives a re-render', () => forcedFollowUp(browser));
    await test('13b the acting slot is highlighted in a train activation', () => activationHighlight(browser));
    await test('14 Cancel and Escape clear a pending selection; a second click switches', () => cancelAndEscape(browser));
    await test('15 the scoring pop-up shows the arithmetic, does not block play, and is also in the log', () => scoringPopup(browser, null));
    await test('16 seats without names or colours fall back', () => seatFallbacks(browser));
    await test('17a carriage upgrades: the panel opens itself, an install, the carriage, the activation step', () => upgradesFlow(browser));
    await test('17b Pony Express: buy a card through the market', () => ponyBuy(browser, null));
    await test('17c Pony Express: exchange a token, end the free actions', () => ponyExchange(browser));
    await test('17d Pony Express: use a once-per-turn card', () => ponyAbility(browser));
    await test('17e a milestone is claimed: log notice, highlight, claimant and turn; live progress', () => milestoneFlow(browser, null));
    await test('17f goals: standings per player', () => goalsProgress(browser));
    await test('17g the Legislative Agenda card: always shown, expands, Escape closes', () => agendaCard(browser));
    await test('19a bug reporter: the button and Ctrl+Shift+B on the setup screen, mid-game, the hand-over cover and the end screen; twenty re-renders; focus', () => bugButtonEverywhere(browser));
    await test('19b bug reporter: a mid-game capture parses, holds the complete state, replays to the same hash, has diagnostics, controls and logs, and changes nothing', () => bugCaptureContent(browser));
    await test('19c bug reporter: a section forced to fail is marked { error } and the report still completes and downloads', () => bugSectionFailure(browser));
    await test('19d bug reporter: swallowed, refused and unmapped clicks, warnings and errors reach the event log; a bot to act reports the human', () => bugEventLog(browser));
    await test('19e bug reporter: download name carries the id, the snapshot is frozen at open, the local archive lists, re-downloads and evicts, storage denied', () => bugDownloadArchiveFrozen(browser));
    await test('19f bug reporter and analytics: no request and no mailto: with the config empty; with it set, mailto: and track() calls (no free text) and the real gtag path through an intercepted host', () => bugNetworkAndMailto(browser));
    await test('19g bug button: on screen and covering no control at 1440 x 900, 1024 x 768 and phone width, on setup and in play; the dialog fits', () => bugButtonLayout(browser));
    await test('20a landing page: hook, three-step loop, stat strip with no play time, no placeholder picture, first paint under 2 MB from this host only, demo game in one click', () => landingPage(browser));
    await test('20b no horizontal scroll at 1440, 1280, 1024 and 390 wide: landing page, in play, dock open, end screen; 44 px controls on a phone', () => layoutWidths(browser));
    await test('20c at 1440 x 900 the prompt, action grid, whole map, train and players fit without scrolling; Congress Reset reachable; the dock keeps the map', () => oneScreenAt1440(browser));
    await test('20d the message, the scoring pop-up and the report button never overlap', () => floatingThings(browser));
    await test('20e prefers-reduced-motion: no running animation anywhere', () => reducedMotion(browser));
    await test('20f text contrast is at least AA on the landing page, in play, the end screen and the cover; keyboard focus is visible', () => contrastCheck(browser));
    await test('20g final screenshots at 1440 x 900, 1024 x 768 and 390 x 844', () => finalScreenshots(browser));
    for (const [w, h] of [[1440, 900], [1024, 768]]) {
      await test(`6 screenshots at ${w} x ${h}`, () => screenshots(browser, w, h));
      await test(`18 module and messaging screenshots at ${w} x ${h}`, () => moduleScreenshots(browser, w, h));
    }
  } finally {
    const closing = Date.now();
    // A browser that is slow to shut down (a busy machine) must not hold the verdict back.
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 8000))]);
    const browserClosed = Date.now();
    await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    log(`  (browser closed in ${browserClosed - closing} ms, server in ${Date.now() - browserClosed} ms)`);
  }
  const failed = results.filter((r) => !r.ok);
  for (const p of problems) log(`  PROBLEM ${p}`);
  log(`\nUI smoke: ${results.length - failed.length}/${results.length} sections passed, ${problems.length} console/page/request problem(s), ${((Date.now() - t0) / 1000).toFixed(0)} s. Screenshots in ${path.relative(ROOT, SHOTS)}`);
  process.exit(failed.length > 0 || problems.length > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`UI smoke crashed: ${err.stack || err}`);
  process.exit(1);
});
