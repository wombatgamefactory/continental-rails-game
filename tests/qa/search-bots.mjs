// search-bots.mjs - a Hard bot and an Expert bot each take three turns in the page at Normal speed.
//
// Run by hand:  node tests/qa/search-bots.mjs
//
// For each level: a two-seat bot game (the search bot against Medium) at Normal speed. The script
// watches until the search bot has taken three whole turns and records, per turn, the wall time from
// "its turn became current" to "its turn ended", the longest gap between two animation frames while
// it thought (the page must stay responsive), whether the "thinking" indicator was on screen, and the
// driver's incident list (the failure cap and the timeout must not trip). Fails on any console error.

import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const server = await serve();
const browser = await launch();
const results = {};
let failed = 0;
const fail = (t) => {
  failed++;
  log(`  FAIL ${t}`);
};

for (const level of ['hard', 'expert']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, level);
  await page.addInitScript(() => {
    window.__qa = { maxGap: 0, frames: 0, indicator: 0, indicatorChecks: 0 };
    let last = performance.now();
    const tick = (t) => {
      window.__qa.maxGap = Math.max(window.__qa.maxGap, t - last);
      last = t;
      window.__qa.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${server.base}?bots=${level},medium&seed=21&speed=normal&shuffle=0&test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  const turns = [];
  let current = null;
  const t0 = Date.now();
  let sawIndicator = false;
  let clickMs = null;
  while (turns.length < 3 && Date.now() - t0 < 5 * 60 * 1000) {
    const s = await page.evaluate(() => {
      const st = window.__cr.getState();
      const thinking = document.querySelector('[data-field="thinking"]');
      return { n: st.turn.number, player: st.toAct, seq: st.seq, thinking: thinking ? thinking.textContent.trim() : '', ended: st.phase === 'ended', level: window.__cr.seats()[st.toAct].level };
    });
    if (s.ended) break;
    const mine = s.level === level;
    if (mine && (current === null || current.n !== s.n)) {
      if (current) {
        current.end = Date.now();
        turns.push(current);
      }
      current = { n: s.n, start: Date.now(), sawIndicator: false };
    }
    if (!mine && current && current.n !== s.n) {
      current.end = Date.now();
      turns.push(current);
      current = null;
    }
    if (mine && current && /thinking/i.test(s.thinking)) {
      current.sawIndicator = true;
      sawIndicator = true;
      if (clickMs === null) {
        // A real click on a harmless control while the bot thinks: how long until it is painted?
        clickMs = await page.evaluate(
          () =>
            new Promise((resolve) => {
              const t = performance.now();
              const btn = document.querySelector('[data-ui="all-moves"]');
              if (btn) btn.click();
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t)));
            }),
        );
        await page.evaluate(() => document.querySelector('[data-ui="all-moves"]')?.click()); // toggle back
      }
    }
    await page.waitForTimeout(40);
  }
  const incidents = await page.evaluate(() => window.__cr.incidents());
  const qa = await page.evaluate(() => window.__qa);
  const times = turns.map((t) => (t.end - t.start) / 1000);
  await shot(page, `search-${level}-thinking`);
  const row = { level, turnsSeen: turns.length, turnSeconds: times.map((x) => Number(x.toFixed(2))), indicatorShown: sawIndicator, perTurnIndicator: turns.map((t) => t.sawIndicator), longestFrameGapMs: Math.round(qa.maxGap), clickPaintedMs: clickMs === null ? null : Math.round(clickMs), incidents, consoleProblems: logs.problems };
  results[level] = row;
  log(`${level}: ${turns.length} turns, wall times ${row.turnSeconds.join(', ')} s; indicator shown ${sawIndicator}; longest frame gap ${row.longestFrameGapMs} ms; click painted in ${row.clickPaintedMs} ms; driver incidents ${incidents.length}; console problems ${logs.problems.length}`);
  if (turns.length < 3) fail(`${level}: only ${turns.length} turns observed`);
  if (!sawIndicator) fail(`${level}: the thinking indicator never showed`);
  if (incidents.length) fail(`${level}: driver incidents: ${incidents.join(' | ')}`);
  if (qa.maxGap > 400) fail(`${level}: the page froze for ${Math.round(qa.maxGap)} ms`);
  if (logs.problems.length) fail(`${level}: ${logs.problems.join(' | ')}`);
  await page.close();
}

await browser.close();
await server.close();
writeJson('search-bots.json', results);
log(failed ? `${failed} FAILED` : 'search bots: all checks passed');
process.exit(failed ? 1 : 0);
