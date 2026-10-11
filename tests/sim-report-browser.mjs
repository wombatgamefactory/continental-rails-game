// sim-report-browser.mjs - opens generated simulation reports in a real (headless) browser.
// NOT part of `npm test`. Run with:  node tests/sim-report-browser.mjs
//
// Uses playwright-core with the installed Chrome (falling back to Edge); never downloads a
// browser. For a single-arm report and a comparison report it fails on any console error,
// page error or network request (the page is opened from file://, so nothing else may load),
// checks the page does not scroll sideways at 1280 px, and saves full-page screenshots in
// light and dark mode, plus per-section screenshots (light) and an A4 PDF, to tests/tmp/report/.
// The simulator output and the generated pages go in a temporary folder of their own under the
// operating system's temp folder; a stale, locked screenshot never fails a run.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { generateReport } from '../sim/sim-report.mjs';
import { makeTempDir, writeEvidence } from './helpers/tmp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'tmp', 'report'); // evidence for a person: screenshots and the PDF
const WORK = makeTempDir('cr-sim-report-browser'); // simulator output and generated pages
fs.mkdirSync(OUT, { recursive: true });

function sim(name, args) {
  const out = path.join(WORK, `${name}.json`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'sim', 'sim.mjs'), '--quiet', `--out=${out}`, ...args], { encoding: 'utf8' });
  if (!fs.existsSync(out)) throw new Error(`sim failed for ${name}: ${r.stderr || r.stdout}`);
  return out;
}

async function launch() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      console.log(`(could not launch ${channel}: ${String(e.message).split('\n')[0]})`);
    }
  }
  throw new Error('No installed Chrome or Edge found.');
}

const inputs = {
  single: sim('browser-single', ['--games=120', '--players=4', '--bots=medium', '--jitter=0.05', '--label=browser-single']),
  compare: sim('browser-compare', ['--games=120', '--players=3', '--bots=medium', '--jitter=0.05', '--baseline', '--variant.upgradeVpTiming=on-install', '--variant.endGameScoring=both', '--label=browser-compare']),
};
const reports = {};
for (const [k, v] of Object.entries(inputs)) {
  reports[k] = await generateReport([v], { out: path.join(WORK, `${k}-report.html`) });
  console.log(`${k}: ${reports[k]}`);
}

const browser = await launch();
let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL ${msg}`); };
try {
  for (const [kind, file] of Object.entries(reports)) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
      const page = await ctx.newPage();
      const url = pathToFileURL(file).href;
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fail(`${kind}/${scheme} console ${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => fail(`${kind}/${scheme} page error: ${e.message}`));
      page.on('request', (r) => { if (r.url() !== url && !r.url().startsWith('data:')) fail(`${kind}/${scheme} network request: ${r.url()}`); });
      page.on('requestfailed', (r) => fail(`${kind}/${scheme} request failed: ${r.url()}`));
      await page.goto(url, { waitUntil: 'load' });
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.documentElement.scrollHeight, svgs: document.querySelectorAll('svg[role=img]').length, bad: /undefined|NaN/.test(document.body.innerText) }));
      if (m.sw > m.iw + 1) fail(`${kind}/${scheme} scrolls sideways: scrollWidth ${m.sw} > ${m.iw}`);
      if (m.bad) fail(`${kind}/${scheme} shows undefined or NaN`);
      if (m.svgs < 10) fail(`${kind}/${scheme} only ${m.svgs} charts`);
      const shot = path.join(OUT, `${kind}-${scheme}-full.png`);
      writeEvidence(shot, await page.screenshot({ fullPage: true }));
      console.log(`${kind}/${scheme}: ${m.svgs} charts, page ${m.iw}x${m.h}, screenshot ${shot}`);
      if (scheme === 'light') {
        const ids = await page.evaluate(() => [...document.querySelectorAll('main > section[id], header, footer')].map((e) => e.id || e.tagName.toLowerCase()));
        for (const id of ids) {
          const sel = /^(header|footer)$/.test(id) ? id : `section#${id}`;
          const el = page.locator(sel).first();
          const box = await el.boundingBox();
          if (!box || box.height < 20) continue;
          if (box.height > 6000) {
            // very tall sections: split into 3000 px slices so each image stays legible
            for (let y = 0, i = 1; y < box.height; y += 3000, i++) {
              writeEvidence(path.join(OUT, `${kind}-light-${id}-${i}.png`), await page.screenshot({ fullPage: true, clip: { x: box.x, y: box.y + y, width: box.width, height: Math.min(3000, box.height - y) } }));
            }
          } else {
            writeEvidence(path.join(OUT, `${kind}-light-${id}.png`), await page.screenshot({ fullPage: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height } }));
          }
        }
        await page.emulateMedia({ media: 'print' });
        const pdf = path.join(OUT, `${kind}-print-a4.pdf`);
        writeEvidence(pdf, await page.pdf({ format: 'A4', printBackground: true }));
        console.log(`${kind}: print PDF ${pdf}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
if (failures) {
  console.error(`\n${failures} problem(s).`);
  process.exit(1);
}
console.log('\nBrowser check passed: no console errors, no network requests, no sideways scroll.');
