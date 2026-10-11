// end-screen.mjs - the end screen against the engine's own scoring.
//
// Run by hand:  node tests/qa/end-screen.mjs
//
// 1. Bot games at 2, 3 and 4 players (the last with a non-default variant) are played to the end screen.
//    For each: the ranking in the page is the order scoreGame gives; every source cell equals
//    scoreGame's bySource for that player; the cells of a column add up to the printed total and the
//    total equals scoreGame's; the tie-break lines equal the engine's; the seed, the seat badges and the
//    variants in play are shown.
// 2. Tied end positions are built in Node (a game played out with the engine, then victory points moved
//    between the top two players so the totals are equal) and loaded through the test hook. For every
//    way the tie can be decided that turns up (buildings, slots, cargo, turn order), the page's
//    tie-break sentence must be the one the engine's `decidedBy` calls for.

import * as E from '../../src/engine/index.js';
import { TIE_BREAK_TEXT } from '../../src/ui/log.js';
import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const server = await serve();
const browser = await launch();
let failed = 0;
const fail = (t) => {
  failed++;
  log(`  FAIL ${t}`);
};
const results = { games: [], ties: [] };

/** Reads the end screen: per player id, the cells of the table. */
async function readEnd(page) {
  return page.evaluate(() => {
    const cols = [...document.querySelectorAll('.end__table thead th[data-player]')].map((th) => ({ id: Number(th.dataset.player), rank: Number(th.dataset.rank) }));
    const cellsOf = (index) => [...document.querySelectorAll('.end__table tbody tr')].map((tr) => ({ source: tr.querySelector('td[data-source]')?.dataset.source ?? null, value: Number(tr.querySelectorAll('td')[index]?.textContent.trim()) })).filter((c) => c.source);
    return {
      cols: cols.map((c, i) => ({ ...c, cells: cellsOf(i), total: Number(document.querySelector(`[data-total="${c.id}"]`)?.textContent.trim()) })),
      tie: (document.querySelector('[data-field="tie-break"]')?.textContent ?? '').trim(),
      aux: [...document.querySelectorAll('.end__aux')].map((tr) => [...tr.querySelectorAll('td')].map((td) => Number(td.textContent.trim()))),
      seed: (document.querySelector('[data-screen="end"] [data-field="seed"]')?.textContent ?? '').trim(),
      badges: [...document.querySelectorAll('[data-screen="end"] .badge')].map((b) => b.textContent.trim()),
      text: document.querySelector('[data-screen="end"]').innerText,
    };
  });
}

function compare(label, shown, state) {
  const score = E.scoreGame(state);
  const order = score.ranking;
  const problems = [];
  const shownOrder = shown.cols.map((c) => c.id);
  if (shownOrder.join(',') !== order.join(',')) problems.push(`ranking ${shownOrder} against ${order}`);
  shown.cols.forEach((col, i) => {
    const p = score.players.find((x) => x.id === col.id);
    for (const c of col.cells) if (c.value !== p.bySource[c.source]) problems.push(`player ${col.id} ${c.source}: page ${c.value}, scoreGame ${p.bySource[c.source]}`);
    const sum = col.cells.reduce((a, c) => a + c.value, 0);
    if (sum !== col.total) problems.push(`player ${col.id}: cells add to ${sum}, page total ${col.total}`);
    if (col.total !== p.total) problems.push(`player ${col.id}: page total ${col.total}, scoreGame ${p.total}`);
    if (shown.aux[0] && shown.aux[0][i] !== p.tieBreak.buildings) problems.push(`player ${col.id}: tie-break buildings ${shown.aux[0][i]} against ${p.tieBreak.buildings}`);
    if (shown.aux[1] && shown.aux[1][i] !== p.tieBreak.ownedSlots) problems.push(`player ${col.id}: tie-break slots ${shown.aux[1][i]} against ${p.tieBreak.ownedSlots}`);
    if (col.rank !== p.rank) problems.push(`player ${col.id}: rank ${col.rank} against ${p.rank}`);
  });
  const expectTie = TIE_BREAK_TEXT[score.decidedBy];
  if (shown.tie !== expectTie) problems.push(`tie-break sentence "${shown.tie}" against "${expectTie}" (decidedBy ${score.decidedBy})`);
  if (problems.length) fail(`${label}: ${problems.join('; ')}`);
  return { decidedBy: score.decidedBy, problems };
}

// ---- 1. played games ----
for (const [players, bots, variants] of [[2, 'medium,medium', ''], [3, 'medium,medium,easy', ''], [4, 'medium,easy,medium,easy', '&variants=conversionRate=1:1,modulePonyExpress=false']]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, `end-${players}p`);
  await page.goto(`${server.base}?players=${players}&bots=${bots}&seed=end-${players}${variants}&fast=1&test=1`);
  await page.waitForSelector('[data-screen="end"]', { timeout: 120000 });
  const shown = await readEnd(page);
  const state = await page.evaluate(() => window.__cr.getState());
  const r = compare(`${players} players`, shown, state);
  if (String(state.config.seed) !== shown.seed) fail(`${players} players: seed ${shown.seed} shown, game seed ${state.config.seed}`);
  if (shown.badges.length < players) fail(`${players} players: ${shown.badges.length} seat badges`);
  if (variants && !(/Conversion rate/i.test(shown.text) && /Pony Express/i.test(shown.text))) fail(`${players} players: variants in play are not shown on the end screen`);
  if (!variants && /Conversion rate: 1:1/i.test(shown.text)) fail('a default game shows a variant');
  await shot(page, `end-${players}p`);
  results.games.push({ players, ranking: shown.cols.map((c) => c.id), totals: shown.cols.map((c) => c.total), decidedBy: r.decidedBy, badges: shown.badges, seed: shown.seed, variantsShown: !!variants, problems: r.problems, consoleProblems: logs.problems });
  log(`${players} players: ranking ${shown.cols.map((c) => c.id)}, totals ${shown.cols.map((c) => c.total)}, decided by ${r.decidedBy}; sums and tie-breaks match scoreGame: ${r.problems.length === 0}; badges ${shown.badges.join('/')}`);
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}

// ---- 2. tied positions ----
const wanted = new Set(['buildings', 'ownedSlots', 'cargo', 'turnOrder']);
const found = new Map();
for (let seed = 1; seed <= 60 && found.size < wanted.size; seed++) {
  const players = 2 + (seed % 3);
  const state = E.createGame({ players: Array.from({ length: players }, (_, i) => ({ name: `P${i + 1}` })), seed: `tie-${seed}`, shuffleSeats: false });
  const rng = E.makeRng(`tie-play-${seed}`);
  let guard = 0;
  while (!E.isGameOver(state) && guard++ < 30000) E.applyAction(state, E.rngPick(rng, E.getValidActions(state)), E.SILENT);
  if (!E.isGameOver(state)) continue;
  const score = E.scoreGame(state);
  const [a, b] = score.ranking.map((id) => score.players.find((p) => p.id === id));
  // Make the top two level on points by moving the difference onto the lower one's track VP.
  state.players[b.id].vp.track = (state.players[b.id].vp.track ?? 0) + (a.total - b.total);
  const tied = E.scoreGame(state);
  if (tied.players.find((p) => p.id === a.id).total !== tied.players.find((p) => p.id === b.id).total) continue;
  const key = tied.decidedBy;
  if (key === 'vp' || found.has(key)) continue;
  found.set(key, E.serialiseState(state));
}
// A tie that nothing breaks: a fresh game ended at once, everyone on nothing.
{
  const state = E.createGame({ players: [{ name: 'P1' }, { name: 'P2' }], seed: 'tie-bare', shuffleSeats: false });
  state.phase = 'ended';
  state.gameEnd = { reason: 'turnLimit', turn: 0, player: 0 };
  const tied = E.scoreGame(state);
  if (tied.decidedBy === 'turnOrder' && !found.has('turnOrder')) found.set('turnOrder', E.serialiseState(state));
}
for (const [key, text] of found) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = watch(page, `tie-${key}`);
  await page.goto(`${server.base}?test=1`);
  await page.waitForFunction(() => window.__cr && window.__cr.ready);
  await page.evaluate(([t]) => window.__cr.loadState(t, null), [text]);
  await page.waitForSelector('[data-screen="end"]', { timeout: 8000 });
  const shown = await readEnd(page);
  const state = await page.evaluate(() => window.__cr.getState());
  const r = compare(`tie decided by ${key}`, shown, state);
  await shot(page, `end-tie-${key}`);
  results.ties.push({ decidedBy: key, sentence: shown.tie, totals: shown.cols.map((c) => c.total), problems: r.problems, consoleProblems: logs.problems });
  log(`tie decided by ${key}: totals ${shown.cols.map((c) => c.total)}; the page says "${shown.tie}"; matches the engine: ${r.problems.length === 0}`);
  if (logs.problems.length) fail(logs.problems.join(' | '));
  await page.close();
}
for (const key of wanted) if (!found.has(key)) log(`  note: no tie decided by ${key} could be built in the 60 games tried`);

await browser.close();
await server.close();
writeJson('end-screen.json', results);
log(failed ? `${failed} FAILED` : `end screen: all checks passed (${results.games.length} played games, ${results.ties.length} tied positions: ${[...found.keys()].join(', ')})`);
process.exit(failed ? 1 : 0);
