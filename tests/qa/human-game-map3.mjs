// human-game-map3.mjs - one HUMAN seat against bots on route map v3, in either ruleset, played to the end screen by
// clicking the page's own controls (adapted from human-game-pr2e.mjs). It leans towards the routes that carry a wild
// ("any tile") slot so that the human takes wild-slot decisions, and records each one: the route and slot, the kinds
// the page offered, the kind chosen, and what the map showed afterwards.
//
// Run by hand:  node tests/qa/human-game-map3.mjs --rules=continental|pr2e [--seed=TEXT] [--rng=N] [--players=3] [--bots=medium,easy]
//               [--width=1440 --height=900]
// Output: tests/tmp/qa/human-game-map3-<rules>.json and screenshots in tests/tmp/qa/shots/. Exit code 1 on a failed check.

import fs from 'node:fs';
import { launch, serve, watch, QA_DIR } from './lib.mjs';

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const RULES = arg('rules', 'continental');
const PLAYERS = Number(arg('players', '3'));
const BOTS = arg('bots', 'medium,easy').split(',');
const SEED = arg('seed', `qa-map3-${RULES}`);
const RNGSEED = Number(arg('rng', '20261031'));
const WIDTH = Number(arg('width', '1440'));
const HEIGHT = Number(arg('height', '900'));
const OUT = QA_DIR;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

function seededRandom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = seededRandom(RNGSEED);
const results = { rules: RULES, checks: [], seen: {}, how: {}, wild: [] };
const check = (ok, text) => { results.checks.push({ ok: !!ok, text }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`); };

const server = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const logs = watch(page, `map3-${RULES}`);
const shot = (name) => page.screenshot({ path: `${OUT}/shots/map3-${RULES}-${name}.png` });
const t0 = Date.now();
const WILD_ROUTES = ['SPO-HEL', 'BIL-DEN', 'BIL-BIS'];
// An assist (recorded) hands the human built tiles and a train beside a wild route, because a random clicker almost never builds
// two kinds of tile by itself; after it the human heads for Lay Tracks / that route (FOCUS) until the wild slot has been filled.
const ASSIST_AT = [15, 45];
let focus = null; let assists = 0;

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
      prompt: (document.querySelector('[data-field="prompt"]') || {}).textContent || '',
    };
  });
  if (snap.phase === 'ended') return 'ended';
  if (snap.cover) { await page.click('[data-ui="cover-ok"]'); return 'cover'; }
  if (!snap.human) { await page.waitForTimeout(20); return 'wait'; }
  const note = (how) => { results.seen[snap.kind] = (results.seen[snap.kind] ?? 0) + 1; results.how[how] = (results.how[how] ?? 0) + 1; };
  if (snap.kind === 'wildSlot') { focus = null; return wildDecision(snap, note); }
  if (snap.kind === 'workerStep' && !focus && assists < ASSIST_AT.length && decisionsSoFar() >= ASSIST_AT[assists]) { await assist(); return 'assist'; }
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
    if (focus && /^route:/.test(k)) return k.endsWith(focus.route) ? 1000 : 0.01;
    if (focus && (k === 'space:W6' || k === 'space:W4' || k === 'district:D5' || /mode=lay/.test(k) || k === 'startLay' || k === 'train:0' || k === 'endLay')) return 500;
    if (focus && /^(train:[1-9]|extendPath:|claimRoute:)/.test(k)) return k.includes(focus.route) ? 1000 : 0.01;
    if (/^route:/.test(k)) return WILD_ROUTES.some((r) => k.endsWith(r)) ? 30 : 6;
    if (/mode=lay/.test(k)) return 12;
    if (/mode=hire/.test(k)) return 2;
    if (/^district:D[468]$/.test(k)) return 6;
    if (k === 'district:D2') return 3;
    if (/^congress:/.test(k)) return 2;
    return 1;
  };
  const chosen = pick(options.length ? options : snap.akeys.map((a) => ({ type: 'akey', key: a.key, via: a.via })), weight);
  if (focus || assists > 0) (results.trace = results.trace ?? []).push(`${snap.kind} ${chosen && chosen.key}`);
  if (!chosen) throw new Error(`nothing to click for ${snap.kind}`);
  if (chosen.type === 'target') {
    const [type] = chosen.key.split(':');
    const sel = type === 'route' ? `g[data-target="${chosen.key}"][data-legal="1"] rect >> nth=0` : type === 'city' ? `g[data-target="${chosen.key}"][data-legal="1"] .city__disc >> nth=0` : type === 'train' ? `g[data-target="${chosen.key}"][data-legal="1"] circle >> nth=0` : type === 'house' ? `[data-target="${chosen.key}"][data-legal="1"] ${RULES === 'pr2e' ? '.pbp' : '.cb__p'}` : `[data-target="${chosen.key}"][data-legal="1"]`;
    try {
      await page.locator(sel).first().click({ timeout: 2500, force: type === 'route' || type === 'city' || type === 'train' });
      note('target');
    } catch (err) {
      // The board target was not clickable: use the prompt panel's own button if there is one, and record it.
      const panel = page.locator(`[data-panel] [data-akey][data-legal="1"], [data-akey][data-legal="1"]`);
      results.fallbacks = results.fallbacks ?? [];
      const geo = await page.evaluate((key) => [...document.querySelectorAll(`[data-target="${key}"]`)].map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { tag: e.tagName, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: cs.visibility, pe: cs.pointerEvents, legal: e.dataset.legal, topmost: mid ? `${mid.tagName}.${String(mid.className).slice(0, 40)}` : null, inView: r.bottom > 0 && r.top < innerHeight };
      }), chosen.key);
      if (!results.fallbacks.some((x) => x.kind === snap.kind)) await shot(`fallback-${snap.kind}`);
      results.fallbacks.push({ kind: snap.kind, target: chosen.key, why: err.message.split('\n')[0], geo });
      if ((await panel.count()) === 0) throw err;
      await panel.first().click({ timeout: 3000 });
      note('fallback');
    }
  } else {
    await page.locator(`[data-akey="${chosen.key}"][data-legal="1"]`).first().click({ timeout: 4000 });
    note(chosen.via);
  }
  return 'clicked';
}

const decisionsSoFar = () => decisions;

/** Hands the human 2 built tiles of each kind and a train on the first city of a wild route that is not yet laid (goes through a saved game, as a tester would). */
async function assist() {
  const text = await page.evaluate(() => window.__cr.saveGame());
  const saved = JSON.parse(text);
  const st = saved.state;
  const route = WILD_ROUTES.find((r) => st.map.routeOwner[r] === null || st.map.routeOwner[r] === undefined);
  if (!route) { assists++; return; }
  const me = st.players[st.toAct];
  me.builtTiles = { ground: 2, tunnel: 2, bridge: 2 };
  me.resources = { iron: 0, wood: 0, gunpowder: 0 }; // nothing else in storage, so nothing has to be discarded on the way
  const first = route.split('-')[0];
  me.railheads = [first, me.railheads[1]];
  const kinds = st.players.map((p) => (p.id === st.toAct ? 'human' : BOTS[(p.id - 1 + BOTS.length) % BOTS.length]));
  await page.evaluate(([t, k]) => { window.__cr.loadState(t, k); window.__cr.speed('instant'); }, [JSON.stringify(saved), kinds]);
  focus = { route };
  assists++;
  results.assists = [...(results.assists ?? []), { atDecision: decisions, route, tiles: me.builtTiles, train: first }];
  await shot(`assist-${assists}`);
}

/** The wild-slot prompt: record it, look at it, and click one of the kinds it offers (a different one each time where possible). */
async function wildDecision(snap, note) {
  const before = await page.evaluate(() => { const s = window.__cr.getState(); const f = s.stack ? s.stack[s.stack.length - 1] : null; return { frame: f ? { kind: f.kind, route: f.route, slot: f.slot, remaining: f.remaining } : null, seq: s.seq }; });
  const n = results.wild.length;
  const offered = snap.akeys.filter((a) => /fillWildSlot/.test(a.key));
  const keys = (offered.length ? offered : snap.akeys).map((a) => a.key);
  const key = keys[n % keys.length];
  await shot(`wild-prompt-${n + 1}`);
  const litSlots = await page.evaluate(() => document.querySelectorAll('.slot--asking, [data-asking="1"], .slot__ring--asking').length);
  await page.locator(`[data-akey="${key}"][data-legal="1"]`).first().click({ timeout: 4000 });
  await page.waitForTimeout(150);
  const after = await page.evaluate((frame) => {
    const s = window.__cr.getState();
    const fill = s.map && s.map.wildFill && frame && frame.route ? s.map.wildFill[frame.route] : null;
    return { fill: fill ?? null, seq: s.seq };
  }, before.frame);
  results.wild.push({ at: Date.now() - t0, frame: before.frame, prompt: snap.prompt, offered: keys, chose: key, litSlots, wildFillAfter: after.fill });
  note('wild');
  if (n === 0) await shot('wild-after-1');
  return 'clicked';
}

await page.goto(`${server.base}?test=1`);
await page.waitForSelector('[data-screen="setup"]');
await page.waitForFunction(() => window.__cr && window.__cr.ready);
await page.click(`[data-setup="rules:${RULES}"]`);
await page.click(`[data-setup="count:${PLAYERS}"]`);
await page.selectOption('[data-setup="kind:0"]', 'human');
for (let i = 1; i < PLAYERS; i++) await page.selectOption(`[data-setup="kind:${i}"]`, BOTS[(i - 1) % BOTS.length]);
await page.fill('[data-setup="name:0"]', 'Tester');
await page.locator('[data-setup="advanced-toggle"]').first().click().catch(() => {});
await page.fill('[data-setup="seed"]', SEED);
await shot('setup');
await page.locator('[data-setup="start"]').first().click();
await page.waitForSelector('#screen-game:not([hidden])');
await page.evaluate(() => window.__cr.speed('instant'));
check((await page.evaluate(() => window.__cr.rules())) === RULES, `the game is ruleset ${RULES}`);
await shot('start');

let decisions = 0; let stuck = 0; let lastSeq = '';
for (let step = 0; step < 12000; step++) {
  const what = await clickDecision();
  if (what === 'ended') break;
  if (what === 'clicked' || what === 'choice' || what === 'hats') decisions++;
  const seq = await page.evaluate(() => document.getElementById('app').dataset.seq + document.getElementById('app').dataset.cover);
  stuck = seq === lastSeq && what !== 'hats' && what !== 'choice' ? stuck + 1 : 0;
  lastSeq = seq;
  if (stuck >= 80) { await shot('stuck'); throw new Error(`stuck at step ${step}, kind ${await page.evaluate(() => document.getElementById('app').dataset.kind)}`); }
  if (decisions === 40) await shot('in-play-early');
  if (decisions === 140) await shot('in-play-mid');
  if (decisions === 260) await shot('in-play-late');
}
await page.waitForSelector('[data-screen="end"]', { timeout: 60000 });
await shot('end');
const end = await page.evaluate(() => {
  const s = window.__cr.getState();
  return { rules: window.__cr.rules(), seq: s.seq, turns: s.turn.number, reason: s.gameEnd ? s.gameEnd.reason : null, incidents: window.__cr.incidents(), totals: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent.trim()), seed: s.config.seed, wildFill: s.map.wildFill, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600) };
});
check(end.incidents.length === 0, `no bot-driver incidents (${end.incidents.length})`);
check(logs.problems.length === 0, `no console/page/request problems (${logs.problems.length}) ${logs.problems.slice(0, 3).join(' | ')}`);
check(results.wild.length > 0, `the human took at least one wild-slot decision (${results.wild.length})`);
check(results.wild.every((w) => end.wildFill && end.wildFill[w.frame.route] && end.wildFill[w.frame.route].length > 0), 'every wild-slot choice is in map.wildFill at the end');
console.log(`  game: ${decisions} human decisions, ${end.turns} turns, ended by ${end.reason}, totals ${end.totals.join('/')}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`  decision kinds clicked: ${JSON.stringify(results.seen)}`);
console.log(`  wild-slot decisions: ${JSON.stringify(results.wild)}`);

fs.writeFileSync(`${OUT}/human-game-map3-${RULES}.json`, `${JSON.stringify({ ...results, decisions, end, problems: logs.problems, warnings: logs.warnings.slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000) }, null, 1)}\n`);
const failed = results.checks.filter((c) => !c.ok);
console.log(failed.length ? `FAILED ${failed.length}` : `map3-${RULES}: all checks passed`);
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
