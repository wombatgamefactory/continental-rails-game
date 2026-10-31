// human-game-pr2e.mjs - one HUMAN seat against two bots under ?rules=pr2e, played by clicking the page's own controls to the end
// screen (3 players, Medium and Easy bots). On the way it downloads a bug report through the real dialog (to replay with
// tools/replay-bug-report.mjs); after the end it checks that "Replay this seed" and "New game" keep the second edition.
//
// Run by hand:  node tests/qa/human-game-pr2e.mjs [--seed=TEXT] [--rng=N]
// Output: tests/tmp/qa/human-game-pr2e.json, bug-report-pr2e.json, screenshots. Exit code 1 on a failed check.

import fs from 'node:fs';
import { launch, serve, watch, QA_DIR } from './lib.mjs';

const OUT = QA_DIR;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SEED = arg('seed', 'qa-human-pr2e');
const RNGSEED = Number(arg('rng', '20261031'));
function seededRandom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = seededRandom(RNGSEED);
const results = { checks: [], seen: {}, how: {} };
const check = (ok, text) => { results.checks.push({ ok: !!ok, text }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`); };

const server = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = watch(page, 'pr2e-human');
const shot = (name) => page.screenshot({ path: `${OUT}/shots/${name}.png` });
const t0 = Date.now();

async function clickDecision() {
  const snap = await page.evaluate(() => {
    const app = document.getElementById('app');
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      kind: app.dataset.kind, phase: app.dataset.phase, cover: app.dataset.cover === '1', human: app.dataset.human === '1',
      choice: q('[data-field="choice"] [data-akey]').map((e) => e.dataset.akey),
      targets: q('[data-target][data-legal="1"]').map((e) => e.dataset.target),
      akeys: q('[data-akey][data-legal="1"]').filter((e) => !e.closest('[data-field="choice"]')).map((e) => ({ key: e.dataset.akey, via: e.closest('[data-panel]') ? 'panel' : e.closest('[data-field="generic"]') ? 'generic' : 'button' })),
      hats0: !!document.querySelector('[data-ui="hats:0"][aria-pressed="true"]'),
      hatButtons: q('[data-ui^="hats:"]').length,
    };
  });
  if (snap.phase === 'ended') return 'ended';
  if (snap.cover) { await page.click('[data-ui="cover-ok"]'); return 'cover'; }
  if (!snap.human) { await page.waitForTimeout(20); return 'wait'; }
  const note = (how) => { results.seen[snap.kind] = (results.seen[snap.kind] ?? 0) + 1; results.how[how] = (results.how[how] ?? 0) + 1; };
  if (snap.choice.length) {
    const key = snap.choice[Math.floor(rnd() * snap.choice.length)];
    await page.locator(`[data-field="choice"] [data-akey="${key}"]`).click();
    note('choice');
    return 'choice';
  }
  const pick = (list, weight) => { const total = list.reduce((n, x) => n + weight(x), 0); let r = rnd() * total; for (const x of list) { r -= weight(x); if (r <= 0) return x; } return list[list.length - 1]; };
  if (snap.kind === 'chooseDistrict' && snap.hatButtons > 1 && snap.hats0 && rnd() < 0.3) { await page.click(`[data-ui="hats:${1 + Math.floor(rnd() * (snap.hatButtons - 1))}"]`); return 'hats'; }
  const options = [...snap.targets.map((t) => ({ type: 'target', key: t })), ...snap.akeys.map((a) => ({ type: 'akey', key: a.key, via: a.via }))];
  const weight = (o) => {
    const k = o.key;
    if (o.type === 'akey' && o.via === 'generic') return 0.05;
    if (/^(skip|stop)/.test(k)) return 0.35;
    if (k === 'endLay') return 2.5;
    if (k === 'useStep') return 4;
    if (/mode=lay/.test(k)) return 12;
    if (/mode=hire/.test(k)) return 2;
    if (/^district:D[468]$/.test(k)) return 6;
    if (k === 'district:D2') return 3;
    if (/^congress:/.test(k)) return 2;
    return 1;
  };
  const chosen = pick(options.length ? options : snap.akeys.map((a) => ({ type: 'akey', key: a.key, via: a.via })), weight);
  if (!chosen) throw new Error(`nothing to click for ${snap.kind}`);
  if (chosen.type === 'target') {
    const [type] = chosen.key.split(':');
    const sel = type === 'route' ? `g[data-target="${chosen.key}"][data-legal="1"] rect >> nth=0` : type === 'city' ? `g[data-target="${chosen.key}"][data-legal="1"] .city__disc >> nth=0` : type === 'train' ? `g[data-target="${chosen.key}"][data-legal="1"] circle >> nth=0` : type === 'house' ? `[data-target="${chosen.key}"][data-legal="1"] .pbp` : `[data-target="${chosen.key}"][data-legal="1"]`;
    await page.locator(sel).first().click({ timeout: 4000, force: type === 'route' || type === 'city' || type === 'train' });
    note('target');
  } else {
    await page.locator(`[data-akey="${chosen.key}"][data-legal="1"]`).first().click({ timeout: 4000 });
    note(chosen.via);
  }
  return 'clicked';
}

// ---- fresh load: the default is Continental Rails
await page.goto(`${server.base}?test=1`);
await page.waitForSelector('[data-screen="setup"]');
await page.waitForFunction(() => window.__cr && window.__cr.ready);
check((await page.getAttribute('[data-setup="rules:continental"]', 'aria-pressed')) === 'true', 'a fresh load has Continental Rails chosen');
check(!new URL(page.url()).searchParams.has('rules'), 'and no rules= in the address');
await page.click('[data-setup="rules:pr2e"]');
await page.click('[data-setup="count:3"]');
await page.selectOption('[data-setup="kind:0"]', 'human');
await page.selectOption('[data-setup="kind:1"]', 'medium');
await page.selectOption('[data-setup="kind:2"]', 'easy');
await page.fill('[data-setup="name:0"]', 'Tester');
await page.locator('[data-setup="advanced-toggle"]').first().click().catch(() => {});
await page.fill('[data-setup="seed"]', SEED);
await shot('setup-pr2e-3p');
await page.locator('[data-setup="start"]').first().click();
await page.waitForSelector('#screen-game:not([hidden])');
await page.evaluate(() => window.__cr.speed('instant'));
check((await page.evaluate(() => window.__cr.rules())) === 'pr2e' && (await page.evaluate(() => window.__cr.engineIs('pr2e'))), 'the game is the second edition, on its engine');

let decisions = 0; let stuck = 0; let lastSeq = ''; let bugDone = false;
for (let step = 0; step < 9000; step++) {
  const what = await clickDecision();
  if (what === 'ended') break;
  if (what === 'clicked' || what === 'choice' || what === 'hats') decisions++;
  const seq = await page.evaluate(() => document.getElementById('app').dataset.seq + document.getElementById('app').dataset.cover);
  stuck = seq === lastSeq && what !== 'hats' && what !== 'choice' ? stuck + 1 : 0;
  lastSeq = seq;
  if (stuck >= 80) { await shot('stuck'); throw new Error(`stuck at step ${step}, kind ${await page.evaluate(() => document.getElementById('app').dataset.kind)}`); }
  if (decisions === 30) await shot('in-play-early');
  if (decisions === 120) await shot('in-play-mid');
  if (!bugDone && decisions >= 45 && what === 'clicked') {
    bugDone = true;
    // the real dialog: button, a title, download
    await page.click('#bug-report-btn');
    await page.waitForSelector('[data-bug-field="dialog"]');
    await page.fill('[data-bug-field="title"]', 'pr2e capture from the human-game script');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-bug-act="download"]')]);
    const file = `${OUT}/bug-report-pr2e.json`;
    await download.saveAs(file);
    results.bugFile = file;
    results.bugFileName = download.suggestedFilename();
    await page.keyboard.press('Escape');
    results.bugAtDecision = decisions;
  }
}
await page.waitForSelector('[data-screen="end"]', { timeout: 60000 });
await shot('end');
const end = await page.evaluate(() => {
  const s = window.__cr.getState();
  return { rules: window.__cr.rules(), seq: s.seq, turns: s.turn.number, reason: s.gameEnd ? s.gameEnd.reason : null, incidents: window.__cr.incidents(), totals: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent.trim()), seed: s.config.seed, text: document.body.innerText.replace(/\s+/g, ' ') };
});
check(end.incidents.length === 0, `no bot-driver incidents (${end.incidents.length})`);
check(logs.problems.length === 0, `no console/page/request problems (${logs.problems.length}) ${logs.problems.slice(0, 3).join(' | ')}`);
check(/Pacific Rails, second edition/.test(end.text), 'the end screen names the second edition');
console.log(`  game: ${decisions} human decisions, ${end.turns} turns, ended by ${end.reason}, totals ${end.totals.join('/')}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`  decision kinds clicked: ${JSON.stringify(results.seen)}`);
console.log(`  how: ${JSON.stringify(results.how)}`);

// ---- after the end: Replay this seed, Play again, Change set-up keep the ruleset
const seedBefore = end.seed;
await page.click('[data-ui="again-same-seed"]');
await page.waitForSelector('#screen-game:not([hidden])');
let after = await page.evaluate(() => ({ rules: window.__cr.rules(), engine: window.__cr.engineIs('pr2e'), seed: window.__cr.getState().config.seed, players: window.__cr.getState().players.length, root: document.getElementById('app').dataset.rules, url: location.search }));
check(after.rules === 'pr2e' && after.engine && after.root === 'pr2e', `Replay this seed keeps pr2e (${JSON.stringify(after)})`);
check(String(after.seed) === String(seedBefore), `and the same seed (${after.seed} v ${seedBefore})`);
await shot('replay-seed');
// back to the end screen quickly: let the human click on to the end again is long; use change set-up through New game instead.
await page.click('[data-ui="new-game"]').catch(() => {});
await page.waitForTimeout(100);
await page.click('[data-ui="new-game"]').catch(() => {});
await page.waitForSelector('[data-screen="setup"]', { timeout: 5000 });
check((await page.getAttribute('[data-setup="rules:pr2e"]', 'aria-pressed')) === 'true', 'New game returns to a set-up page that still has the second edition chosen');
check(new URL(page.url()).searchParams.get('rules') === 'pr2e', 'and rules=pr2e in the address');
await page.click('[data-setup="start"]');
await page.waitForSelector('#screen-game:not([hidden])');
after = await page.evaluate(() => ({ rules: window.__cr.rules(), engine: window.__cr.engineIs('pr2e') }));
check(after.rules === 'pr2e' && after.engine, 'starting again from that set-up page is pr2e');

fs.writeFileSync(`${OUT}/human-game-pr2e.json`, `${JSON.stringify({ ...results, decisions, end: { ...end, text: undefined }, problems: logs.problems, warnings: logs.warnings.slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000) }, null, 1)}\n`);
const failed = results.checks.filter((c) => !c.ok);
console.log(failed.length ? `FAILED ${failed.length}` : 'pr2e-human: all checks passed');
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
