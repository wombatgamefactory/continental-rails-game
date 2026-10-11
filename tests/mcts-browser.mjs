// mcts-browser.mjs - a search bot in the real page: does it think off the main thread, in time?
//
// NOT part of `npm test` (it needs a browser, and a quiet machine for the timings). Run by hand:
//
//   node tests/mcts-browser.mjs                  a Hard bot against a Medium bot, whole game
//   node tests/mcts-browser.mjs --level=expert   the same with Expert (about three minutes)
//   node tests/mcts-browser.mjs --seed=11
//
// It starts tools/serve.mjs on a free port and launches the installed Chrome through
// playwright-core (channel 'chrome', falling back to 'msedge'; nothing is ever downloaded).
//
// What is checked while the search bot plays a whole game at speed "instant":
//   1. the page stays responsive: a requestAnimationFrame counter keeps ticking while the bot
//      thinks (the longest gap between two frames is reported and must stay short), and real
//      clicks on a UI control are handled and painted within about 100 ms;
//   2. the "is thinking..." indicator is on screen while the bot thinks;
//   3. a turn of the search bot takes about its budget (Hard: 1.5 s) of wall time;
//   4. the game reaches the end screen with no console error, page error, failed request or
//      bot-driver incident.
// Exit code 0 if all four hold, 1 otherwise.

import { chromium } from 'playwright-core';
import { startServer } from '../tools/serve.mjs';
import { BOT_LEVELS } from '../src/bots/index.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const LEVEL = args.level || 'hard';
const SEED = args.seed || '7';
const BUDGET = BOT_LEVELS.find((l) => l.id === LEVEL).defaultTimeBudgetMs;

/** Limits. The frame gap allows for the page's own rendering of a move; a blocked main thread would show the whole think time. */
const LIMITS = {
  maxFrameGapMs: 250,
  clickMs: 100,
  turnMeanMinMs: Math.round(BUDGET * 0.4),
  turnMeanMaxMs: Math.round(BUDGET * 1.7),
  turnP95MaxMs: Math.round(BUDGET * 2.2),
  thinkingShare: 0.9,
  gameTimeoutMs: Math.max(240000, BUDGET * 120),
};

const log = (text) => process.stdout.write(`${text}\n`);
const problems = [];
const failures = [];
const check = (ok, text) => {
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failures.push(text);
};

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (err) {
    log(`chrome not available (${err.message.split('\n')[0]}); trying msedge`);
    return await chromium.launch({ channel: 'msedge' });
  }
}

/** Runs in the page before anything else: a frame counter, a trace of whose turn it is, and click timing. */
function instrument() {
  const trace = { frames: 0, maxGap: 0, maxGapThinking: 0, turns: [], clicks: [], thinkingFrames: 0, indicatorFrames: 0 };
  window.__trace = trace;
  let last = performance.now();
  let current = null;
  const tick = (t) => {
    const gap = t - last;
    last = t;
    trace.frames += 1;
    const cr = window.__cr;
    const state = cr && cr.ready ? cr.getState() : null;
    if (state && state.phase === 'play') {
      const seats = cr.seats();
      const levelOf = (pid) => seats[state.players[pid].configIndex].level;
      if (current === null || current.number !== state.turn.number) {
        if (current !== null) current.end = t;
        current = { number: state.turn.number, level: levelOf(state.turn.player), start: t, end: null };
        trace.turns.push(current);
      }
      const thinking = state.toAct !== null && levelOf(state.toAct) === window.__searchLevel;
      if (thinking) {
        trace.thinkingFrames += 1;
        if (gap > trace.maxGapThinking) trace.maxGapThinking = gap;
        const el = document.querySelector('[data-field="thinking"]');
        if (el && el.getClientRects().length > 0) trace.indicatorFrames += 1;
      }
    } else if (state && state.phase === 'ended' && current !== null && current.end === null) {
      current.end = t;
    }
    if (trace.frames > 30 && gap > trace.maxGap) trace.maxGap = gap;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // A click is "handled" once its handlers have run and the next frame has been painted.
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const made = event.timeStamp;
    const cr = window.__cr;
    const state = cr && cr.ready ? cr.getState() : null;
    const thinking = Boolean(state && state.toAct !== null && cr.seats()[state.players[state.toAct].configIndex].level === window.__searchLevel);
    requestAnimationFrame((t) => trace.clicks.push({ ms: t - made, thinking }));
  }, true);
}

const server = await startServer(0);
const browser = await launch();
let exitCode = 1;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  await page.addInitScript(`window.__searchLevel = ${JSON.stringify(LEVEL)};`);
  await page.addInitScript(instrument);

  const url = `${server.url}?bots=${LEVEL},medium&seed=${encodeURIComponent(SEED)}&speed=instant&shuffle=0&test=1`;
  log(`${LEVEL} v medium in the browser (${browser.version()}), seed ${SEED}: ${url}`);
  const started = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__cr && window.__cr.ready && window.__cr.getState(), null, { timeout: 15000 });

  // Click a harmless control (a player's train summary: it only expands or collapses) while the game runs.
  let clicks = 0;
  let ended = false;
  while (!ended && Date.now() - started < LIMITS.gameTimeoutMs) {
    ended = await page.evaluate(() => {
      const end = document.getElementById('end');
      return window.__cr.getState().phase === 'ended' && end !== null && !end.hidden;
    });
    if (ended) break;
    const thinking = await page.evaluate(() => {
      const s = window.__cr.getState();
      return s.phase === 'play' && s.toAct !== null && window.__cr.seats()[s.players[s.toAct].configIndex].level === window.__searchLevel;
    });
    if (thinking && clicks < 40) {
      try {
        await page.locator('[data-ui^="expand:"]').first().click({ timeout: 1000 });
        clicks += 1;
      } catch (err) {
        // the control was being redrawn; try again on the next pass
      }
    }
    await page.waitForTimeout(350);
  }

  const wallS = (Date.now() - started) / 1000;
  const trace = await page.evaluate(() => window.__trace);
  const incidents = await page.evaluate(() => window.__cr.incidents());
  const scores = await page.evaluate(() => {
    const s = window.__cr.getState();
    return s.players.map((p) => `${window.__cr.seats()[p.configIndex].level} ${Object.values(p.vp).reduce((a, b) => a + b, 0)}`).join(', ');
  });

  const mine = trace.turns.filter((t) => t.level === LEVEL && t.end !== null).map((t) => t.end - t.start).sort((a, b) => a - b);
  const meanOf = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const q = (list, p) => (list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : 0);
  const whileThinking = trace.clicks.filter((c) => c.thinking).map((c) => c.ms).sort((a, b) => a - b);

  log('');
  log(`Game: ${ended ? 'reached the end screen' : 'DID NOT END'} after ${wallS.toFixed(0)} s; ${trace.turns.length} turns; final VP: ${scores}`);
  log(`${LEVEL} turns: ${mine.length}; wall time per turn mean ${meanOf(mine).toFixed(0)} ms, median ${q(mine, 0.5).toFixed(0)} ms, p95 ${q(mine, 0.95).toFixed(0)} ms, max ${q(mine, 1).toFixed(0)} ms (budget ${BUDGET} ms)`);
  log(`Frames: ${trace.frames} (${(trace.frames / wallS).toFixed(0)} a second); longest gap between two frames ${trace.maxGap.toFixed(0)} ms, while the bot thinks ${trace.maxGapThinking.toFixed(0)} ms`);
  log(`Clicks while the bot was thinking: ${whileThinking.length}; handled and painted in mean ${meanOf(whileThinking).toFixed(0)} ms, max ${q(whileThinking, 1).toFixed(0)} ms`);
  log(`Thinking indicator: on screen in ${trace.indicatorFrames} of ${trace.thinkingFrames} frames in which the ${LEVEL} bot was to act`);
  log('');
  check(ended, 'the game reaches the end screen');
  check(problems.length === 0, `no console error, page error or failed request${problems.length ? `: ${problems.slice(0, 5).join(' | ')}` : ''}`);
  check(incidents.length === 0, `no bot-driver incident${incidents.length ? `: ${incidents.slice(0, 3).join(' | ')}` : ''}`);
  check(trace.frames / wallS > 20, 'the frame counter keeps ticking (more than 20 frames a second over the whole game)');
  check(trace.maxGapThinking <= LIMITS.maxFrameGapMs, `no frame gap over ${LIMITS.maxFrameGapMs} ms while the bot thinks`);
  check(whileThinking.length >= 5 && q(whileThinking, 1) <= LIMITS.clickMs, `clicks while the bot thinks are handled within ${LIMITS.clickMs} ms (at least 5 measured)`);
  check(trace.thinkingFrames > 0 && trace.indicatorFrames / trace.thinkingFrames >= LIMITS.thinkingShare, 'the thinking indicator is visible while the bot thinks');
  check(mine.length > 5 && meanOf(mine) >= LIMITS.turnMeanMinMs && meanOf(mine) <= LIMITS.turnMeanMaxMs, `a ${LEVEL} turn takes about its budget on average (${LIMITS.turnMeanMinMs} to ${LIMITS.turnMeanMaxMs} ms)`);
  check(q(mine, 0.95) <= LIMITS.turnP95MaxMs, `95% of ${LEVEL} turns take at most ${LIMITS.turnP95MaxMs} ms`);
  exitCode = failures.length === 0 ? 0 : 1;
  log('');
  log(exitCode === 0 ? 'mcts-browser: all checks passed' : `mcts-browser: ${failures.length} check(s) FAILED`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
