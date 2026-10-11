// variants-loop.mjs - every variant, every non-default value, played to the end by two bots.
//
// Run by hand:  node tests/qa/variants-loop.mjs [--only=name] [--panel-only] [--url-only]
//
// The list comes from the engine's own table (VARIANTS), nothing is typed here. Two passes:
//   URL pass    for each variant and each non-default value (every listed value of a boolean or enum;
//               for an integer the lowest, the highest and one in between; for an enum-or-integer its
//               named values and the lowest and highest number), start a two-bot Instant game by address
//               (?variants=name=value) and wait for the end screen. Checks: the engine state holds the
//               value, the end screen names the variant, zero console errors, zero driver incidents.
//   Panel pass  for each variant, change ONE value through the "Rules variants" panel on the landing
//               page (switch, selection or number box), check the page marks it as changed, press Start
//               and play to the end. Checks as above.
// Exit 1 on any failure; results in tests/tmp/qa/variants-loop.json.

import { VARIANTS } from '../../src/engine/index.js';
import { launch, serve, watch, writeJson, log } from './lib.mjs';

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const panelOnly = process.argv.includes('--panel-only');
const urlOnly = process.argv.includes('--url-only');

function nonDefaults(def) {
  if (def.type === 'boolean' || def.type === 'enum') return def.values.filter((v) => v !== def.default);
  const mid = Math.round((def.min + def.max) / 2);
  const numbers = [...new Set([def.min, mid, def.max])].filter((n) => n !== def.default);
  if (def.type === 'integer') return numbers;
  return [...def.values.filter((v) => v !== def.default), ...numbers.filter((n) => n !== def.default)];
}

const server = await serve();
const browser = await launch();
const rows = [];
let failed = 0;
const fail = (t) => {
  failed++;
  log(`  FAIL ${t}`);
};

async function playToEnd(page, label, name, value) {
  await page.waitForFunction(() => window.__cr && window.__cr.ready, null, { timeout: 15000 });
  await page.evaluate(() => window.__cr.speed('instant'));
  await page.waitForSelector('[data-screen="end"]', { timeout: 120000 });
  const info = await page.evaluate(([n]) => {
    const s = window.__cr.getState();
    return { value: s.variants[n], turns: s.turn.number, reason: s.end ? s.end.reason : null, incidents: window.__cr.incidents(), endText: document.querySelector('[data-screen="end"]').innerText };
  }, [name]);
  const matches = JSON.stringify(info.value) === JSON.stringify(value);
  return { ...info, matches };
}

for (const def of VARIANTS) {
  if (only && def.name !== only) continue;
  const values = nonDefaults(def);

  if (!panelOnly) {
    for (const value of values) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const logs = watch(page, `${def.name}=${value}`);
      const seed = `qa-${def.name}-${value}`;
      await page.goto(`${server.base}?players=2&bots=medium,medium&seed=${encodeURIComponent(seed)}&fast=1&test=1&variants=${def.name}=${encodeURIComponent(value)}`);
      let row;
      try {
        const r = await playToEnd(page, 'url', def.name, value);
        const named = r.endText.toLowerCase().includes((def.label ?? def.name).toLowerCase()) || r.endText.includes(def.name);
        row = { variant: def.name, value, how: 'url', ended: true, stateHolds: r.matches, endScreenNamesIt: named, turns: r.turns, endReason: r.reason, incidents: r.incidents.length, consoleProblems: logs.problems.length };
        if (!r.matches) fail(`${def.name}=${value}: the engine state holds ${JSON.stringify(r.value)}`);
        if (!named) fail(`${def.name}=${value}: the end screen does not show the variant`);
        if (r.incidents.length) fail(`${def.name}=${value}: driver incidents ${r.incidents.join(' | ')}`);
      } catch (err) {
        row = { variant: def.name, value, how: 'url', ended: false, error: String(err.message).split('\n')[0], consoleProblems: logs.problems.length };
        fail(`${def.name}=${value}: ${row.error}`);
      }
      if (logs.problems.length) fail(`${def.name}=${value}: ${logs.problems.slice(0, 2).join(' | ')}`);
      rows.push(row);
      log(`url   ${def.name}=${value}: ${row.ended ? `ended after ${row.turns} turns (${row.endReason})` : 'DID NOT END'}; state ${row.stateHolds}; end screen names it ${row.endScreenNamesIt}`);
      await page.close();
    }
  }

  if (!urlOnly) {
    const value = values[0];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const logs = watch(page, `panel ${def.name}`);
    await page.goto(`${server.base}?test=1`);
    await page.waitForSelector('[data-screen="setup"]');
    if ((await page.locator('[data-setup="variants-toggle"][aria-expanded="false"]').count()) > 0) await page.locator('[data-setup="variants-toggle"]').first().click();
    await page.selectOption('[data-setup="kind:0"]', 'medium');
    await page.selectOption('[data-setup="kind:1"]', 'medium');
    const control = page.locator(`[data-setup="variant:${def.name}"]`).first();
    let changed = false;
    try {
      if (def.type === 'boolean') {
        await control.click();
      } else if (def.type === 'integer') {
        const num = page.locator(`[data-setup="variantnum:${def.name}"]`).first();
        await num.fill(String(value));
        await num.dispatchEvent('change');
        await num.blur();
      } else if (typeof value === 'number') {
        // enum-or-integer: choose the numeric option, then the number box
        const options = await control.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
        const numeric = options.find((o) => /number|card/i.test(o.t) || /^\d+$/.test(o.v));
        if (numeric) await control.selectOption(numeric.v);
        const num = page.locator(`[data-setup="variantnum:${def.name}"]`).first();
        if ((await num.count()) > 0) {
          await num.fill(String(value));
          await num.dispatchEvent('change');
          await num.blur();
        }
      } else {
        await control.selectOption(String(value));
      }
      changed = (await page.locator(`.vrow[data-variant="${def.name}"][data-changed="1"]`).count()) > 0;
    } catch (err) {
      fail(`panel ${def.name}: could not operate the control: ${String(err.message).split('\n')[0]}`);
    }
    let row = { variant: def.name, value, how: 'panel', markedChanged: changed };
    try {
      await page.locator('[data-setup="start"]').first().click({ timeout: 4000 });
      await page.waitForSelector('#screen-game:not([hidden])', { timeout: 8000 });
      const r = await playToEnd(page, 'panel', def.name, value);
      row = { ...row, ended: true, stateHolds: r.matches, turns: r.turns, endReason: r.reason, incidents: r.incidents.length, consoleProblems: logs.problems.length };
      if (!changed) fail(`panel ${def.name}: the panel did not mark the row as changed`);
      if (!r.matches) fail(`panel ${def.name}=${value}: the engine state holds ${JSON.stringify(r.value)}`);
      if (r.incidents.length) fail(`panel ${def.name}: driver incidents`);
    } catch (err) {
      row = { ...row, ended: false, error: String(err.message).split('\n')[0] };
      fail(`panel ${def.name}=${value}: ${row.error}`);
    }
    if (logs.problems.length) fail(`panel ${def.name}: ${logs.problems.slice(0, 2).join(' | ')}`);
    rows.push(row);
    log(`panel ${def.name}=${value}: marked changed ${changed}; ${row.ended ? `ended after ${row.turns} turns (${row.endReason})` : 'DID NOT END'}; state ${row.stateHolds}`);
    await page.close();
  }
}

await browser.close();
await server.close();
writeJson('variants-loop.json', { variants: VARIANTS.length, runs: rows.length, failed, rows });
log(`${VARIANTS.length} variants, ${rows.length} games; ${failed ? `${failed} FAILED` : 'all reached the end screen with zero console errors'}`);
process.exit(failed ? 1 : 0);
