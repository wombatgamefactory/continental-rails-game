// human-game.mjs - a complete HUMAN game, played through the bespoke controls.
//
// Run by hand:  node tests/qa/human-game.mjs [--preset=full|core] [--bot=medium] [--seed=N] [--port=0]
//
// Starts at the landing page, chooses a preset and "Human v <bot>" through the page's own controls,
// presses Start, and then at every human decision:
//   1. picks a legal action by a simple seeded rule (never a stop/skip while something else is legal,
//      most of the time),
//   2. finds the on-screen target that the page offers for that action (the page's own
//      action-targets.js mapping, asked inside the page) and CLICKS it with the mouse,
//   3. completes a "choose" step or the hat toggle if the page asks for one,
//   4. only if the page offers no target for the action does it use the generic list of legal
//      moves; every such fallback is recorded with its action type.
// It fails on any console error, page error, failed request, or if the game does not reach the end
// screen. Output: tests/tmp/qa/human-game-<preset>.json and screenshots.

import { actionKey, makeRng, rngNext } from '../../src/engine/index.js';
import { launch, serve, watch, shot, writeJson, log } from './lib.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const preset = arg('preset', 'full');
const botLevel = arg('bot', 'medium');
const seed = arg('seed', `qa-human-${preset}`);
const STOP_TYPES = new Set(['skipStep', 'closeCongress', 'stopLaying', 'skipBuilding', 'skipBonusAction', 'endFreeActions', 'skipEffect', 'declineFreeEntry']);
const rng = makeRng(`human-rule:${seed}`);

const server = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = watch(page, `human-${preset}`);
const t0 = Date.now();

// ---- the landing page: preset, seats, start ----
await page.goto(`${server.base}?test=1`);
await page.waitForSelector('[data-screen="setup"]');
await shot(page, `human-${preset}-landing`);
// Presets live inside the rules-variants panel.
if ((await page.locator(`[data-setup="preset:${preset}"]`).count()) === 0 || !(await page.locator(`[data-setup="preset:${preset}"]`).first().isVisible())) {
  await page.locator('[data-setup="variants-toggle"], [data-setup="variants-open"], summary:has-text("Rules variants"), button:has-text("Rules variants")').first().click();
}
await page.locator(`[data-setup="preset:${preset}"]`).first().click();
await page.selectOption('[data-setup="kind:0"]', 'human');
await page.selectOption('[data-setup="kind:1"]', botLevel);
await page.fill('[data-setup="name:0"]', 'Tester');
await page.locator('#advanced-toggle, [data-setup="advanced-toggle"]').first().click().catch(() => {});
await page.fill('[data-setup="seed"]', seed).catch(() => {});
await shot(page, `human-${preset}-setup`);
await page.locator('[data-setup="start"]').first().click();
await page.waitForSelector('[data-screen="game"], #screen-game:not([hidden])');
await page.evaluate(() => window.__cr.speed('instant'));

const fallbacks = [];
const panelFallbacks = []; // the board target was not usable but the prompt panel's own button was (still bespoke)
const counts = {};
let decisions = 0;
let nowait = 0;

/** Asks the page which control it offers for the action: { how: 'target', key } | { how: 'akey' } | { how: 'generic' }. */
async function locate(action) {
  const key = actionKey(action);
  return page.evaluate(
    async ([k]) => {
      const mod = await import('/src/ui/action-targets.js');
      const engine = await import('/src/engine/index.js');
      const state = window.__cr.getState();
      const actions = window.__cr.actions();
      const targets = mod.buildTargets(state, actions, { generic: false, hat: window.__cr.pendingUi().hat });
      const same = (a) => engine.actionKey(a) === k;
      for (const [tkey, entry] of targets.byTarget) if (entry.actions.some(same)) return { how: 'target', key: tkey, tab: targets.wantedTab };
      if (targets.primary.some(same) || targets.secondary.some(same)) return { how: 'akey' };
      for (const panel of targets.panels) if (panel.items.some((i) => i.key === k)) return { how: 'akey' };
      return { how: 'generic' };
    },
    [key],
  );
}

function targetSelector(tkey) {
  const [type] = tkey.split(':');
  if (type === 'route') return `g[data-target="${tkey}"][data-legal="1"] rect >> nth=0`;
  if (type === 'city') return `g[data-target="${tkey}"][data-legal="1"] .city__disc`;
  return `[data-target="${tkey}"][data-legal="1"]`;
}

function choose(actions) {
  // A simple rule: avoid stops and skips while anything else is legal (90%), prefer claiming routes and
  // laying, otherwise take a seeded random pick.
  const progress = actions.filter((a) => !STOP_TYPES.has(a.type));
  const pool = progress.length > 0 && rngNext(rng) < 0.9 ? progress : actions;
  const claim = pool.filter((a) => a.type === 'claimRoute' || a.type === 'useStep');
  if (claim.length > 0 && rngNext(rng) < 0.7) return claim[Math.floor(rngNext(rng) * claim.length)];
  return pool[Math.floor(rngNext(rng) * pool.length)];
}

/** Every disabled control on the game screen must say why (title, tooltip text or a reason beside it). */
async function auditDisabled() {
  return page.evaluate(() => {
    const found = [...document.querySelectorAll('#screen-game button:disabled, #screen-game [aria-disabled="true"], #screen-game .is-disabled')];
    return found.map((el) => {
      const reason = (el.getAttribute('title') || el.getAttribute('data-tip') || el.getAttribute('aria-description') || '').trim();
      const described = el.getAttribute('aria-describedby') ? (document.getElementById(el.getAttribute('aria-describedby')) || {}).textContent : '';
      return { text: (el.textContent || el.getAttribute('aria-label') || el.dataset.ui || '').trim().slice(0, 40), reason: reason || (described || '').trim() };
    });
  });
}
const disabledSeen = new Map(); // control text -> { count, withReason }

let lastSeq = -1;
let stuck = 0;
for (let guard = 0; guard < 6000; guard++) {
  if ((await page.locator('[data-screen="end"]').count()) > 0) break;
  const snap = await page.evaluate(() => {
    const s = window.__cr.getState();
    return { ended: s.phase === 'ended', toAct: s.toAct, seq: s.seq, coverUp: !!document.querySelector('#cover:not([hidden])'), human: window.__cr.seats()[s.toAct].human };
  });
  if (snap.ended) break;
  if (!snap.human) {
    await page.waitForTimeout(15);
    if (snap.seq === lastSeq && ++stuck > 4000) throw new Error('the bot never answered');
    continue;
  }
  if (snap.coverUp) {
    await page.click('[data-ui="cover-ok"]');
    continue;
  }
  stuck = 0;
  const actions = await page.evaluate(() => window.__cr.actions());
  if (actions.length === 0) {
    await page.waitForTimeout(20);
    if (++nowait > 400) throw new Error('no legal action and no progress');
    continue;
  }
  nowait = 0;
  for (const d of await auditDisabled()) {
    const e = disabledSeen.get(d.text) ?? { count: 0, withReason: 0, sample: d.reason };
    e.count++;
    if (d.reason) e.withReason++;
    disabledSeen.set(d.text, e);
  }
  const action = choose(actions);
  const k = actionKey(action);
  const seqBefore = snap.seq;
  const where = await locate(action);
  let used = where.how;
  try {
    if (action.type === 'chooseDistrict' && action.district !== 'none') {
      const hatOn = await page.evaluate(() => window.__cr.pendingUi().hat);
      if (hatOn !== !!action.hat) await page.click('[data-ui="toggle-hat"]');
    }
    if (where.how === 'target') {
      // The board target first; if it is not on screen or not clickable (for instance it sits in a closed module
      // panel or a hidden storage chip) the same action is also a button in the prompt panel (a bespoke control,
      // not the generic list): take that, as a person would.
      try {
        await page.locator(targetSelector(where.key)).click({ timeout: 1500, force: /^(route|city):/.test(where.key) });
      } catch (targetErr) {
        const panelButton = page.locator(`[data-akey="${k}"][data-legal="1"]`);
        if ((await panelButton.count()) === 0) throw targetErr;
        used = 'akey';
        if (panelFallbacks.length === 0 || action.type === 'discard' && panelFallbacks.every((f) => f.type !== 'discard')) {
          await shot(page, `human-${preset}-panel-button-${action.type}`);
          log('DEBUG target ' + where.key + ' ' + JSON.stringify(await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), vis: getComputedStyle(e).visibility, inert: !!e.closest('[inert]') }; }), `[data-target="${where.key}"]`)) + ' ' + targetErr.message.split(String.fromCharCode(10)).slice(0, 4).join(' | '));
        }
        panelFallbacks.push({ type: action.type, target: where.key });
        await panelButton.first().click({ timeout: 3000 });
      }
      // Several actions share the target: the page asks which one.
      const mode = await page.evaluate(() => window.__cr.pendingUi().mode);
      if (mode === 'choose') await page.locator(`[data-akey="${k}"]`).first().click({ timeout: 3000 });
    } else if (where.how === 'akey') {
      await page.locator(`[data-akey="${k}"]`).first().click({ timeout: 3000 });
    } else {
      throw new Error('no bespoke target');
    }
    await page.waitForFunction((s) => window.__cr.getState().seq !== s, seqBefore, { timeout: 4000 }).catch(() => {});
    if ((await page.evaluate(() => window.__cr.getState().seq)) === seqBefore) throw new Error(`click on ${where.key ?? k} did not apply the action`);
  } catch (err) {
    // The generic list of legal moves: recorded every time.
    used = 'generic';
    await page.keyboard.press('Escape');
    const btn = page.locator(`[data-field="generic"] [data-akey="${k}"]`);
    if ((await btn.count()) === 0) await page.locator('[data-ui="all-moves"]').first().click().catch(() => {});
    if ((await btn.count()) === 0) { await shot(page, `human-${preset}-stuck`); log('DEBUG ' + JSON.stringify(await page.evaluate((key) => ({ ui: window.__cr.pendingUi(), upg: [...document.querySelectorAll('[data-target^="upgrade"]')].map((e) => e.outerHTML.slice(0, 200)), tabs: [...document.querySelectorAll('[data-ui^="tab:"]')].map((e) => e.dataset.ui + ':' + e.className), akeys: [...document.querySelectorAll('[data-akey]')].map((e) => e.dataset.akey + '/' + e.dataset.legal).slice(0, 12), wanted: key }), k))); }
    if ((await btn.count()) === 0) throw new Error(`no control at all for ${k}: ${err.message}`);
    await btn.first().click({ timeout: 3000 });
    fallbacks.push({ type: action.type, key: k, reason: String(err.message).split('\n')[0], turn: snap.seq });
  }
  decisions++;
  counts[used] = (counts[used] ?? 0) + 1;
  lastSeq = seqBefore;
  if (decisions === 40) await shot(page, `human-${preset}-play-early`);
  if (decisions === 400) await shot(page, `human-${preset}-play-mid`);
}

await page.waitForSelector('[data-screen="end"]', { timeout: 120000 });
await shot(page, `human-${preset}-end`);
const end = await page.evaluate(() => {
  const s = window.__cr.getState();
  return { seq: s.seq, turns: s.turn.number, modules: Object.keys(s.modules ?? {}), reason: s.end ? s.end.reason : null, incidents: window.__cr.incidents(), scores: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent.trim()) };
});
const byType = {};
for (const f of fallbacks) byType[f.type] = (byType[f.type] ?? 0) + 1;
const disabledAudit = [...disabledSeen.entries()].map(([text, e]) => ({ control: text, seen: e.count, withReason: e.withReason, sampleReason: e.sample }));
const unexplained = disabledAudit.filter((d) => d.withReason < d.seen);
const result = { disabledControls: disabledAudit, disabledWithoutReason: unexplained, preset, bot: botLevel, seed, decisions, how: counts, panelButtonInsteadOfBoardTarget: panelFallbacks.length, panelFallbackTargets: [...new Set(panelFallbacks.map((f) => f.target))], panelButtonTypes: Object.fromEntries([...new Set(panelFallbacks.map((f) => f.type))].map((ty) => [ty, panelFallbacks.filter((f) => f.type === ty).length])), fallbackCount: fallbacks.length, fallbackTypes: byType, fallbacks: fallbacks.slice(0, 40), end, seconds: Math.round((Date.now() - t0) / 1000), consoleProblems: logs.problems, warnings: logs.warnings.slice(0, 10) };
writeJson(`human-game-${preset}.json`, result);
log(`human game (${preset}, v ${botLevel}, seed ${seed}): ${decisions} decisions by the human, ${JSON.stringify(counts)}; fallbacks ${fallbacks.length} ${JSON.stringify(byType)}; ended after ${end.turns} turns with scores ${end.scores.join(' / ')}; modules ${end.modules.join(',') || '(none)'}; console problems ${logs.problems.length}; ${result.seconds} s`);
log(`disabled controls met during the game: ${disabledAudit.length} kinds, ${unexplained.length} without a reason${unexplained.length ? ` -> ${JSON.stringify(unexplained)}` : ''}`);
await browser.close();
await server.close();
process.exit(logs.problems.length || unexplained.length ? 1 : 0);
