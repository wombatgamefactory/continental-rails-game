#!/usr/bin/env node
// sim-report.mjs - turns simulator results (sim-results/*.json) into one self-contained
// HTML report: inline CSS, inline SVG charts, no scripts from anywhere, no network.
//
//   node sim/sim-report.mjs <results.json> [second.json] [--out=<file>]
//
// One file with one arm: the report for that run. One file with a baseline arm, or two
// files: a comparison (every chart shows both arms; a "What changed" table lists each
// headline metric with its difference and whether it exceeds two standard errors).
//
// The report is written beside the first input as <input-name>-report.html. It never
// overwrites: if the file exists, -v2, -v3 ... is added. The path is printed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngineInfo, buildModel } from './report-html/model.mjs';
import { buildPage } from './report-html/page.mjs';

const HERE = new URL('./', import.meta.url);

const USAGE = `Usage: node sim/sim-report.mjs <results.json> [second.json] [--out=<file>]

Writes one self-contained HTML report beside the first input (<name>-report.html).
An existing file is never overwritten: -v2, -v3 are added.
  one file, one arm        the report for that run
  one file with baseline   a comparison of the test arm against the baseline arm
  two files                a comparison of the first arm of each (check the seeds, bots and
                           player count match; the report warns when they do not)
  --out=<file>             write here instead (still versioned, never overwritten)
`;

/** The first free path: base, then base-v2, base-v3 ... (the extension is kept). */
export function freePath(target) {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const stem = target.slice(0, target.length - ext.length);
  for (let v = 2; v < 10000; v++) {
    const p = `${stem}-v${v}${ext}`;
    if (!fs.existsSync(p)) return p;
  }
  throw new Error(`No free file name beside ${target}`);
}

/** Writes the report; returns the path written. */
export async function generateReport(inputPaths, opts = {}) {
  if (inputPaths.length < 1 || inputPaths.length > 2) throw new Error('Give one or two results files.');
  const inputs = inputPaths.map((p) => {
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`Cannot read ${p}: ${e.message}`);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`${p} is not valid JSON: ${e.message}`);
    }
    return { file: path.basename(p), json };
  });
  const info = await loadEngineInfo(HERE);
  const model = buildModel(inputs, info);
  const html = buildPage(model);
  const first = path.resolve(inputPaths[0]);
  const defaultOut = path.join(path.dirname(first), `${path.basename(first, path.extname(first))}-report.html`);
  const out = freePath(path.resolve(opts.out ?? defaultOut));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

async function main(argv) {
  const files = [];
  let out;
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      return 0;
    }
    if (a.startsWith('--out=')) out = a.slice(6);
    else if (a.startsWith('--')) {
      process.stderr.write(`Unknown option ${a}\n${USAGE}`);
      return 2;
    } else files.push(a);
  }
  if (files.length < 1 || files.length > 2) {
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    const p = await generateReport(files, { out });
    process.stdout.write(`${p}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`sim-report: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
