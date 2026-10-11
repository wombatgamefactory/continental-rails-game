// report-open.mjs - opens a generated simulation HTML report in headless Chrome.
//
// Run by hand:  node tests/qa/report-open.mjs <report.html>
//
// The report is opened from file://. Fails on any console message of type error or warning, any page
// error, or any network request (the page must be self-contained); records the page size, the number
// of charts and takes a full-page screenshot into tests/tmp/qa/.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, shot, log } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  log('usage: node tests/qa/report-open.mjs <report.html>');
  process.exit(2);
}
const url = pathToFileURL(path.resolve(file)).href;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('request', (r) => {
  if (r.url() !== url && !r.url().startsWith('data:')) problems.push(`network request: ${r.url()}`);
});
await page.goto(url, { waitUntil: 'load' });
const info = await page.evaluate(() => ({ title: document.title, charts: document.querySelectorAll('svg[role=img]').length, sideways: document.documentElement.scrollWidth > window.innerWidth + 1, bad: /undefined|NaN/.test(document.body.innerText), height: document.documentElement.scrollHeight }));
const png = await shot(page, 'sim-report-4p-full', { fullPage: true });
log(`report ${path.basename(file)}: "${info.title}", ${info.charts} charts, page height ${info.height}px, scrolls sideways ${info.sideways}, shows undefined/NaN ${info.bad}; console errors/warnings, page errors and network requests: ${problems.length}`);
if (problems.length) log(problems.join('\n'));
await browser.close();
log(`screenshot ${png}`);
process.exit(problems.length || info.sideways || info.bad || info.charts < 10 ? 1 : 0);
