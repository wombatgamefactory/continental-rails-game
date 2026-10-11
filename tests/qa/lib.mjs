// lib.mjs - shared helpers for the hand-run QA scripts in tests/qa/.
//
// These scripts are NOT part of `npm test` or `npm run test:ui`. They drive the page in the
// installed Chrome (falling back to Edge) with playwright-core, record what they find as
// JSON and screenshots under tests/tmp/qa/ (git-ignored), and exit 1 on a failure.
// A browser is never downloaded.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { startServer } from '../../tools/serve.mjs';
import { writeEvidence } from '../helpers/tmp.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const QA_DIR = path.join(ROOT, 'tests', 'tmp', 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

export async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (err) {
    process.stdout.write(`chrome not available (${err.message.split('\n')[0]}); trying msedge\n`);
    return await chromium.launch({ channel: 'msedge' });
  }
}

/** Starts the repository's own static server on a free port. */
export async function serve() {
  const s = await startServer(0);
  return { base: s.url, close: s.close };
}

/**
 * Watches a page and returns { problems, requests, texts }: console errors and warnings, page errors,
 * failed requests, HTTP errors, and every request made (URL and resource type).
 */
export function watch(page, label = '') {
  const log = { problems: [], warnings: [], requests: [], responses: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.problems.push(`${label} console error: ${msg.text()}`);
    else if (msg.type() === 'warning') log.warnings.push(`${label} console warning: ${msg.text()}`);
  });
  page.on('pageerror', (err) => log.problems.push(`${label} page error: ${err.message}`));
  page.on('requestfailed', (req) => log.problems.push(`${label} request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`));
  page.on('request', (req) => log.requests.push({ url: req.url(), type: req.resourceType() }));
  page.on('response', (res) => {
    log.responses.push({ url: res.url(), status: res.status() });
    if (res.status() >= 400) log.problems.push(`${label} HTTP ${res.status()}: ${res.url()}`);
  });
  page.on('dialog', (d) => d.dismiss());
  return log;
}

export async function shot(page, name, opts = {}) {
  const file = path.join(QA_DIR, `${name}.png`);
  const buf = await page.screenshot({ fullPage: false, ...opts });
  writeEvidence(file, buf);
  return file;
}

export function writeJson(name, data) {
  const file = path.join(QA_DIR, name);
  writeEvidence(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(text) {
  process.stdout.write(`${text}\n`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

/**
 * A static server for any folder, behaving like GitHub Pages in the two ways that matter here:
 * a directory serves its index.html, and file names are CASE-SENSITIVE (Pages runs on Linux; a
 * Windows disk would hide a wrong-case URL). Returns { base, close, missing } where `missing` lists
 * every request that found no file.
 */
export function serveFolder(root) {
  const missing = [];
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    let file = path.normalize(path.join(root, urlPath));
    const reply = (code, body, type = 'text/plain') => {
      if (code === 404) missing.push(urlPath);
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (!file.startsWith(root)) return reply(403, 'Forbidden');
    // Case-sensitive check, segment by segment.
    const rel = path.relative(root, file).split(path.sep).filter(Boolean);
    let cursor = root;
    for (const seg of rel) {
      let names;
      try {
        names = fs.readdirSync(cursor);
      } catch {
        return reply(404, 'Not found');
      }
      if (!names.includes(seg)) return reply(404, 'Not found');
      cursor = path.join(cursor, seg);
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const data = fs.readFileSync(file);
      return reply(200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch {
      return reply(404, 'Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ base: `http://localhost:${port}/`, port, missing, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
