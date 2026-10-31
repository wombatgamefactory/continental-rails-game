// rules-switch.mjs - choosing the rules in the real page: a fresh load, switching rules part-way through set-up (seats and
// names kept, the other ruleset's variants dropped), the ?rules= address round trip (an unknown value, a variant of the other
// ruleset), saved games of each ruleset loaded onto the other ruleset's page, and "Play again" / "Replay this seed" after a
// LOADED game keeping the game's ruleset.
//
// Run by hand:  node tests/qa/rules-switch.mjs [--only-c]     (--only-c: just the saved-game part)
// Exit code 1 on any failed check.

import { launch, serve, watch } from './lib.mjs';
const server = await serve();
const browser = await launch();
const checks = [];
const check = (ok, text) => { checks.push({ ok: !!ok, text }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`); };
const note = (text) => console.log(`  note ${text}`);
const q = (url) => `${server.base}${url}`;
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
async function fresh(url, auto = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const logs = watch(page, 'rules');
  await page.goto(q(url));
  if (auto) { await page.waitForFunction(() => window.__cr && window.__cr.ready && window.__cr.getState()); return { ctx, page, logs }; }
  await page.waitForSelector('[data-screen="setup"]');
  await page.waitForFunction(() => window.__cr && window.__cr.ready && document.getElementById('bug-report-btn'));
  return { ctx, page, logs };
}
const pressed = (page, id) => page.getAttribute(`[data-setup="rules:${id}"]`, 'aria-pressed');
const presets = (page) => page.$$eval('.vpreset .btn__label', (els) => els.map((e) => e.textContent.trim()));

if (process.argv.includes('--only-c')) {} else {
console.log('A. fresh load and switching');
{
  const { ctx, page, logs } = await fresh('?test=1');
  check((await pressed(page, 'continental')) === 'true' && (await pressed(page, 'pr2e')) === 'false', 'fresh load: Continental Rails chosen');
  check(!('rules' in params(page)), 'no rules in the address');
  const optionOrder = await page.$$eval('[data-setup^="rules:"]', (els) => els.map((e) => e.dataset.setup));
  note(`selector order ${optionOrder}`);
  // part-way through set-up: 4 players, bot kinds, a name, a preset, the seed
  await page.click('[data-setup="count:4"]');
  await page.selectOption('[data-setup="kind:1"]', 'hard');
  await page.fill('[data-setup="name:0"]', 'Zed');
  await page.locator('[data-setup="advanced-toggle"]').first().click().catch(() => {});
  await page.fill('[data-setup="seed"]', '777');
  if (!(await page.locator('[data-setup="preset:core"]').first().isVisible().catch(() => false))) await page.locator('[data-setup="variants-toggle"], summary:has-text("Rules variants"), button:has-text("Rules variants")').first().click().catch(() => {});
  await page.locator('[data-setup="preset:core"]').first().click().catch((e) => note(`preset click: ${e.message.split('\n')[0]}`));
  note(`CR address with core preset: ${page.url().replace(server.base, '')}`);
  await page.click('[data-setup="rules:pr2e"]');
  check((await pressed(page, 'pr2e')) === 'true' && params(page).rules === 'pr2e', 'switching to the second edition part-way: pressed, rules=pr2e in the address');
  note(`pr2e address after switching: ${page.url().replace(server.base, '')}`);
  check(!('variants' in params(page)), 'the Continental Rails preset\'s variants are NOT carried into the second edition (no variants= in the address)');
  check((await presets(page)).join() === 'As published,Tycoon Mode,One new route per lay,Short game', `pr2e presets shown (${await presets(page)})`);
  const seatsKept = await page.evaluate(() => ({ kind1: document.querySelector('[data-setup="kind:1"]').value, name0: document.querySelector('[data-setup="name:0"]').value, seed: document.querySelector('[data-setup="seed"]') && document.querySelector('[data-setup="seed"]').value, rows: document.querySelectorAll('.seat').length }));
  note(`seat settings after switching: ${JSON.stringify(seatsKept)}`);
  check(seatsKept.kind1 === 'hard' && seatsKept.name0 === 'Zed', 'seat kinds and names are kept across the switch');
  // pick a pr2e variant preset, then switch back
  await page.locator('[data-setup="preset:tycoon"]').first().click().catch((e) => note(`tycoon click: ${e.message.split('\n')[0]}`));
  note(`pr2e tycoon address: ${page.url().replace(server.base, '')}`);
  await page.click('[data-setup="rules:continental"]');
  check((await pressed(page, 'continental')) === 'true' && !('rules' in params(page)), 'switching back: Continental Rails, rules gone from the address');
  check(!('variants' in params(page)), 'and the second edition\'s variants are not carried back (no variants= in the address)');
  check((await presets(page)).join() === 'Full game,Base game,Core only', 'Continental Rails presets are back');
  await page.fill('[data-setup="name:0"]', 'Zed');
  // start from here: a CR game
  await page.click('[data-setup="count:2"]');
  await page.selectOption('[data-setup="kind:1"]', 'medium');
  await page.locator('[data-setup="start"]').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  check((await page.evaluate(() => window.__cr.rules())) === 'continental', 'a game started after switching back is Continental Rails');
  check(logs.problems.length === 0, `no problems (${logs.problems.length})`);
  await ctx.close();
}

console.log('B. the address round trip');
{
  const { ctx, page, logs } = await fresh('?test=1&rules=pr2e&variants=tycoonMode=true');
  check((await pressed(page, 'pr2e')) === 'true', '?rules=pr2e chooses the second edition on load');
  note(`address after load: ${page.url().replace(server.base, '')}`);
  check(params(page).variants === 'tycoonMode=true', 'the pr2e variant in the address is kept');
  await page.reload();
  await page.waitForSelector('[data-screen="setup"]');
  check((await pressed(page, 'pr2e')) === 'true' && params(page).rules === 'pr2e', 'a reload keeps it');
  await ctx.close();
  const b = await fresh('?test=1&rules=bogus');
  check((await pressed(b.page, 'continental')) === 'true', '?rules=bogus falls back to Continental Rails');
  note(`bogus: address ${b.page.url().replace(server.base, '')}; problems ${b.logs.problems.length}`);
  await b.ctx.close();
  const c = await fresh('?test=1&rules=continental&variants=tycoonMode=true');
  note(`CR with a pr2e variant name: address ${c.page.url().replace(server.base, '')}; error text: ${(await c.page.locator('[data-field="setup-error"], .setup__error, .variants__error').allTextContents().catch(() => [])).join(' | ').slice(0, 200)}; problems ${c.logs.problems.length}`);
  check((await pressed(c.page, 'continental')) === 'true', 'a pr2e variant name under rules=continental does not break the page');
  await c.ctx.close();
  const d = await fresh('?test=1&rules=pr2e&variants=conversionRate=1:1');
  note(`pr2e with a CR variant name: address ${d.page.url().replace(server.base, '')}; problems ${d.logs.problems.length}`);
  check((await pressed(d.page, 'pr2e')) === 'true', 'a CR variant name under rules=pr2e does not break the page');
  await d.ctx.close();
}

}
console.log('C. saved games of each ruleset, both directions, and Play again after a loaded game');
async function botGameSave(url, steps = 'mid') {
  const { ctx, page } = await fresh(url, true);
  await page.waitForFunction(() => window.__cr.getState && window.__cr.getState() && window.__cr.getState().turn.number >= 12, null, { timeout: 60000 });
  await page.evaluate(() => window.__cr.pause(true));
  const text = await page.evaluate(() => window.__cr.saveGame());
  const info = await page.evaluate(() => ({ rules: window.__cr.rules(), seed: window.__cr.getState().config.seed, turn: window.__cr.getState().turn.number }));
  await ctx.close();
  return { text, info };
}
const crSave = await botGameSave('?test=1&bots=medium,easy&seed=31&speed=instant&players=2');
const prSave = await botGameSave('?test=1&rules=pr2e&bots=medium,easy&seed=32&speed=instant&players=2');
check(crSave.info.rules === 'continental' && prSave.info.rules === 'pr2e', `the two saved games are of their own rules (${crSave.info.rules}, ${prSave.info.rules})`);
check(JSON.parse(prSave.text).rules === 'pr2e' && JSON.parse(crSave.text).rules === 'continental', 'and say so in the file');
for (const [name, save, onUrl, expect] of [['pr2e saved game onto a Continental Rails page', prSave, '?test=1', 'pr2e'], ['CR saved game onto a pr2e page', crSave, '?test=1&rules=pr2e', 'continental']]) {
  const { ctx, page, logs } = await fresh(onUrl);
  for (let i = 0; i < 4; i++) if ((await page.locator(`select[data-setup="kind:${i}"]`).count()) > 0) await page.selectOption(`select[data-setup="kind:${i}"]`, 'easy'); // the set-up form's seats are bots, so a replayed game can end by itself
  await page.evaluate(([t]) => window.__cr.loadState(t, ['medium', 'medium']), [save.text]);
  await page.waitForSelector('#screen-game:not([hidden])');
  const st = await page.evaluate(() => ({ rules: window.__cr.rules(), active: window.__cr.activeRules(), root: document.getElementById('app').dataset.rules, header: (document.querySelector('[data-field="rules"]') || {}).textContent }));
  check(st.rules === expect && st.active === expect && st.root === expect, `${name}: runs ${expect} (${JSON.stringify(st)})`);
  // play it to the end with bots, then Play again / Replay this seed
  await page.evaluate(() => { window.__cr.speed('instant'); window.__cr.pause(false); });
  await page.waitForSelector('[data-screen="end"]', { timeout: 120000 });
  const seed = await page.evaluate(() => String(window.__cr.getState().config.seed));
  await page.click('[data-ui="again-same-seed"]');
  await page.waitForSelector('#screen-game:not([hidden])');
  let a = await page.evaluate(() => ({ rules: window.__cr.rules(), active: window.__cr.activeRules(), seed: String(window.__cr.getState().config.seed), players: window.__cr.getState().players.length }));
  note(`${name}: after "Replay this seed": ${JSON.stringify(a)} (loaded game's seed ${seed}); address ${page.url().replace(server.base, '')}`);
  check(a.rules === expect, `${name}: "Replay this seed" after the loaded game keeps ${expect} (got ${a.rules})`);
  await page.evaluate(() => { window.__cr.speed('instant'); window.__cr.pause(false); });
  await page.waitForSelector('[data-screen="end"]', { timeout: 120000 }).catch(() => note('replayed game did not end in time'));
  await page.click('[data-ui="again-new-seed"]').catch(() => {});
  await page.waitForSelector('#screen-game:not([hidden])');
  a = await page.evaluate(() => ({ rules: window.__cr.rules(), active: window.__cr.activeRules() }));
  check(a.rules === expect, `${name}: "Play again" keeps ${expect} (got ${a.rules})`);
  check(logs.problems.length === 0, `${name}: no problems (${logs.problems.length}) ${logs.problems.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `FAILED ${failed.length}: ${failed.map((f) => f.text).join(' || ')}` : 'rules-checks: all passed');
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
