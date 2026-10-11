// subpath.mjs - the page served from a sub-path, as GitHub Pages serves a project site.
//
// Run by hand:  node tests/qa/subpath.mjs
//
// GitHub Pages serves this repository at https://<owner>.github.io/continental-rails-game/, not at
// the root of a host. The script copies the files git knows about (tracked, plus untracked files that
// are not ignored) into <os temp>/<unique>/continental-rails-game/, serves the PARENT folder with a
// case-sensitive static server, and loads http://localhost:<port>/continental-rails-game/. It then
//   - checks the source for any root-relative URL (a leading "/" in src, href, url(), fetch, import),
//   - loads the landing page, plays a four-bot game to the end screen, opens the bug reporter and
//     downloads a report,
//   - and fails on any console error, failed request, 404, or request outside the sub-path.
// The temp copy is left for the operating system to clear.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, serveFolder, watch, shot, writeJson, log, ROOT } from './lib.mjs';
import { makeTempDir } from '../helpers/tmp.mjs';

const parent = makeTempDir('cr-subpath');
const copy = path.join(parent, 'continental-rails-game');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
for (const f of files) {
  if (!fs.existsSync(path.join(ROOT, f))) continue; // deleted in the working tree
  fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(copy, f));
}
log(`copied ${files.length} files to ${copy}`);

let failed = 0;
const fail = (text) => {
  failed++;
  log(`  FAIL ${text}`);
};

// 1. No root-relative URL anywhere in the page's own source.
const rootRelative = [];
const patterns = [
  [/\b(src|href|action|poster)\s*=\s*["']\/(?!\/)/g, 'attribute'],
  [/url\(\s*["']?\/(?!\/)/g, 'css url()'],
  [/\b(fetch|importScripts|new Worker|new URL)\s*\(\s*["'`]\/(?!\/)/g, 'call'],
  [/\bfrom\s+["']\/(?!\/)/g, 'import'],
  [/\bimport\s*\(\s*["']\/(?!\/)/g, 'dynamic import'],
];
for (const f of files) {
  if (!/\.(html|css|js|mjs)$/.test(f) || !/^(index\.html|style\.css|src\/)/.test(f)) continue;
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [re, what] of patterns) for (const m of text.matchAll(re)) rootRelative.push(`${f}: ${what}: ${m[0]}`);
}
log(`root-relative URLs in index.html, style.css and src/: ${rootRelative.length}`);
if (rootRelative.length) fail(`root-relative URLs: ${rootRelative.slice(0, 5).join(' | ')}`);

const server = await serveFolder(parent);
const prefix = `${server.base}continental-rails-game/`;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = watch(page, 'subpath');
await page.goto(`${prefix}?test=1`);
await page.waitForSelector('[data-screen="setup"]');
await page.waitForTimeout(600);
const landing = await page.evaluate(() => ({
  title: document.title,
  images: [...document.querySelectorAll('img')].map((i) => ({ src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 })),
  style: [...document.styleSheets].map((s) => s.href),
}));
const brokenImages = landing.images.filter((i) => !i.ok);
log(`landing page: ${landing.images.length} pictures, ${brokenImages.length} broken; style sheets ${landing.style.join(', ')}`);
if (brokenImages.length) fail(`broken pictures: ${brokenImages.map((i) => i.src).join(', ')}`);
await shot(page, 'subpath-landing');

// 2. A four-bot game to the end screen (module worker, manifest, art, all through the sub-path).
await page.goto(`${prefix}?players=4&bots=medium,medium,easy,easy&seed=7&fast=1&test=1`);
await page.waitForSelector('[data-screen="end"]', { timeout: 240000 });
const ranks = await page.$$eval('th[data-rank]', (els) => els.length);
log(`four-bot game reached the end screen with ${ranks} ranked players; incidents ${await page.evaluate(() => window.__cr.incidents().length)}`);
if (ranks !== 4) fail('the end screen does not show four players');
await shot(page, 'subpath-end');

// 3. A bug report download from the end screen.
await page.keyboard.press('Control+Shift+B');
await page.waitForSelector('[data-bug-field="title"]');
await page.fill('[data-bug-field="title"]', 'sub-path check');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-bug-act="download"]')]);
const reportPath = await download.path();
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
log(`bug report downloaded: ${download.suggestedFilename()} (${fs.statSync(reportPath).size} bytes), screen ${report.screen}, url ${report.environment && report.environment.url}`);
if (!/^continental-rails-bug-crbug-/.test(download.suggestedFilename())) fail('unexpected report file name');
if (!report.gameState || !report.environment.url.includes('/continental-rails-game/')) fail('the report does not record the sub-path address');
// Replay it with the tool.
const savedReport = path.join(parent, 'subpath-report.json');
fs.copyFileSync(reportPath, savedReport);
let replay = '';
try {
  replay = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'replay-bug-report.mjs'), savedReport], { encoding: 'utf8' });
  log(`replay tool: exit 0, ${replay.split('\n').length} lines`);
} catch (err) {
  fail(`replay tool failed: ${String(err.stdout || err.message).slice(0, 200)}`);
}

// 4. Every request stayed inside the sub-path; none failed.
const outside = logs.requests.filter((r) => !r.url.startsWith(prefix) && !/^(data|blob):/.test(r.url));
const asked = new Set(logs.requests.map((r) => new URL(r.url).pathname.split('/').slice(0, 3).join('/')));
log(`requests: ${logs.requests.length}; outside the sub-path: ${outside.length}; 404s seen by the server: ${server.missing.length}`);
if (outside.length) fail(`requests outside the sub-path: ${outside.slice(0, 5).map((r) => r.url).join(', ')}`);
if (server.missing.length) fail(`404: ${server.missing.slice(0, 5).join(', ')}`);
if (logs.problems.length) fail(`problems: ${logs.problems.slice(0, 5).join(' | ')}`);

await browser.close();
await server.close();
writeJson('subpath-results.json', { prefix, files: files.length, rootRelative, requests: logs.requests.length, outside, missing: server.missing, problems: logs.problems, firstSegments: [...asked] });
log(failed ? `${failed} FAILED` : 'sub-path: all checks passed');
process.exit(failed ? 1 : 0);
