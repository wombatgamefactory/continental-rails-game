// landing.mjs - the landing page at five sizes.
//
// Run by hand:  node tests/qa/landing.mjs
//
// At 1440 x 900, 1280 x 800, 1024 x 768, 768 x 1024 and 390 x 844 it checks: no horizontal scroll,
// nothing wider than the window, no two blocks overlapping, no picture that the manifest calls a
// placeholder and no broken picture; it dumps the page text (tests/tmp/qa/landing-text.txt) and
// scans it for US spellings, doubled words and stray characters; it takes a viewport and a
// full-page screenshot of each size into tests/tmp/qa/.

import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, shot, writeJson, log, ROOT, QA_DIR } from './lib.mjs';
import { writeEvidence } from '../helpers/tmp.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'art-manifest.json'), 'utf8'));
const placeholderFiles = new Set(manifest.filter((e) => e.status === 'placeholder').map((e) => `assets/${e.file}`));

const SIZES = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]];
const server = await serve();
const browser = await launch();
const results = [];
let failed = 0;
const fail = (text) => {
  failed++;
  log(`  FAIL ${text}`);
};

for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = watch(page, `${w}x${h}`);
  await page.goto(`${server.base}?test=1`);
  await page.waitForSelector('[data-screen="setup"]');
  // Walk the page so lazy pictures load.
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= total; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const m = await page.evaluate((placeholders) => {
    const doc = document.documentElement;
    const out = { sw: doc.scrollWidth, iw: window.innerWidth, bodySw: document.body.scrollWidth, wide: [], overlaps: [], placeholders: [], broken: [], imgs: 0, tiny: [] };
    const root = document.getElementById('screen-setup');
    // Anything poking out of the window on the right (ignoring things clipped by an ancestor with overflow hidden).
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') { clipped = true; break; }
        }
        if (!clipped) out.wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
      }
      // Text that is cut off inside its own box.
      if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && el.clientWidth > 0) {
        out.tiny.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 30)}" scroll ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    // Blocks inside the landing page that overlap each other: compare siblings at every level of the main sections.
    const groups = [root.querySelector('.landing') ?? root];
    const seen = new Set();
    const consider = (parent) => {
      const kids = [...parent.children].filter((c) => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return r.width > 4 && r.height > 4 && cs.position !== 'absolute' && cs.position !== 'fixed' && cs.display !== 'none';
      });
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 3 && iy > 3) out.overlaps.push(`${kids[i].tagName.toLowerCase()}.${String(kids[i].className).split(' ')[0]} x ${kids[j].tagName.toLowerCase()}.${String(kids[j].className).split(' ')[0]} (${Math.round(ix)}x${Math.round(iy)})`);
        }
      }
    };
    const walk = (el, depth) => {
      if (depth > 4 || seen.has(el)) return;
      seen.add(el);
      consider(el);
      for (const c of el.children) walk(c, depth + 1);
    };
    for (const g of groups) walk(g, 0);
    for (const img of root.querySelectorAll('img')) {
      out.imgs++;
      const src = img.getAttribute('src') || '';
      if (placeholders.includes(src)) out.placeholders.push(src);
      if (img.complete && img.naturalWidth === 0) out.broken.push(src);
    }
    return out;
  }, [...placeholderFiles]);

  const row = { size: `${w}x${h}`, scrollWidth: m.sw, innerWidth: m.iw, pictures: m.imgs, wide: m.wide.slice(0, 5), overlaps: m.overlaps.slice(0, 5), clippedText: m.tiny.slice(0, 5), placeholderPictures: m.placeholders, brokenPictures: m.broken, consoleProblems: logs.problems.length };
  results.push(row);
  log(`${w}x${h}: scrollWidth ${m.sw}/${m.iw}, pictures ${m.imgs}, overlaps ${m.overlaps.length}, wide ${m.wide.length}, clipped text ${m.tiny.length}, placeholder pictures ${m.placeholders.length}, broken ${m.broken.length}`);
  if (m.sw > m.iw) fail(`${w}x${h}: page scrolls sideways (${m.sw} > ${m.iw})`);
  if (m.wide.length) fail(`${w}x${h}: elements outside the window: ${m.wide.slice(0, 3).join('; ')}`);
  if (m.overlaps.length) fail(`${w}x${h}: overlapping blocks: ${m.overlaps.slice(0, 3).join('; ')}`);
  if (m.tiny.length) fail(`${w}x${h}: clipped text: ${m.tiny.slice(0, 3).join('; ')}`);
  if (m.placeholders.length) fail(`${w}x${h}: placeholder pictures on the page: ${m.placeholders.join(', ')}`);
  if (m.broken.length) fail(`${w}x${h}: broken pictures: ${m.broken.join(', ')}`);
  if (logs.problems.length) fail(`${w}x${h}: ${logs.problems.join(' | ')}`);

  await shot(page, `landing-${w}x${h}`);
  await shot(page, `landing-${w}x${h}-full`, { fullPage: true });

  if (w === 1440) {
    const text = await page.evaluate(() => document.getElementById('screen-setup').innerText);
    writeEvidence(path.join(QA_DIR, 'landing-text.txt'), text);
    const findings = [];
    const checks = [
      [/\b(color|colors|colored|center|centered|gray|favorite|organize|organized|recognize|analyze|neighbor|honor|labor|armor|defense|license|meter|liter|catalog|program)\b/gi, 'US spelling'],
      [/\b(\w+)[ \t]+\1\b/gi, 'doubled word'],
      [/ {2,}/g, 'double space'],
      [/[^\S\n]\./g, 'space before full stop'],
      [/\bteh\b|\brecieve|\boccured|\bseperat|\bdefinately|\bwich\b|\balot\b|\bthier\b|\bbeleive/gi, 'common typo'],
      [/\bTODO\b|\bFIXME\b|\blorem\b|\bplaceholder\b|\bundefined\b|\bNaN\b|\[object/gi, 'unfinished text'],
      [/\bSteel\b|\bPacific\b/g, 'forbidden word'],
    ];
    for (const [re, label] of checks) for (const hit of text.matchAll(re)) findings.push(`${label}: "${hit[0]}"`);
    log(`copy scan: ${findings.length} finding(s)${findings.length ? ` -> ${findings.join('; ')}` : ''}`);
    if (findings.length) fail(`copy: ${findings.join('; ')}`);
    results.push({ copyFindings: findings, characters: text.length });
  }
  await page.close();
}

await browser.close();
await server.close();
writeJson('landing-results.json', results);
log(failed ? `${failed} FAILED` : 'landing page: all checks passed');
process.exit(failed ? 1 : 0);
