// sweep.mjs - the pre-publication sweep, over every file the repository will publish.
//
// Run by hand:  node tests/qa/sweep.mjs [--json]
//
// The repository becomes public, so this looks at every file git tracks or would track (tracked files
// plus new files that are not ignored) and reports, per category, a count and every hit:
//   internal documents   paths or text from the rules spec, balance analysis or project ledger
//   internal references  task numbers, the word "manager", design questions left for the designer
//   secrets              tokens, keys, passwords, .env files
//   addresses            email addresses (none are allowed; test-only dummies are built from parts)
//   local paths          drive letters, user folders, Dropbox, AppData
//   names                the earlier game's title and any publisher's name
//   terminology          "Steel" anywhere; "house" outside the player-board sense
//   structure            file names starting with an underscore, CRLF line endings, files over 1 MB,
//                        art over 200 KB, ignored folders really untracked
//   page and config      lang, title, description, absolute og:url / og:image, empty config values, BUILD
//   licence              LICENSE is all rights reserved; README says so in one line
// Exit code 1 if any category has a hit.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)));

// Patterns are assembled from parts so that this file does not trip its own sweep.
const j = (...parts) => parts.join('');
const PATTERNS = {
  internalDocuments: [new RegExp(j('rules', '-spec'), 'i'), new RegExp(j('balance', '-baseline'), 'i'), new RegExp(j('balance', '-changes'), 'i'), /web-game\.md/i, new RegExp(j('rulings', ' list'), 'i'), /\bledger\b/i],
  internalReferences: [/\bT[0-9]{1,2}b?\b/, /\bMGR[0-9]\b/, new RegExp(j('\\bman', 'ager\\b'), 'i'), /\btask [A-Z]?[0-9]+\b/i, /questions? for the designer/i, /designer (must|has to|needs to|will) (decide|confirm|rule)/i],
  secrets: [/\bgh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /\bAKIA[0-9A-Z]{12,}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(api[_-]?key|secret|password|passwd|auth[_-]?token)\b\s*[:=]\s*['"][^'"]{8,}['"]/i, /\bG-[A-Z0-9]{8,}\b/],
  addresses: [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/],
  localPaths: [/\b[A-Za-z]:[\\/](?!\/)/, /\/(Users|home)\/[A-Za-z0-9._-]+\//, /\/c\/Users/, new RegExp(j('Drop', 'box'), 'i'), new RegExp(j('App', 'Data'), 'i'), new RegExp(j('One', 'Drive'), 'i')],
  names: [new RegExp(j('Pacific', ' Rails'), 'i'), new RegExp(j('Vesuv', 'ius'), 'i'), new RegExp(j('Pacific', 'Rails'), 'i')],
  terminology: [/\bsteel\b/i],
};
const SKIP_CONTENT = /\.(png|jpe?g|webp|gif|ico)$/i;
const SKIP_CONTENT_FILES = new Set(['package-lock.json']);
const hits = {};
const add = (cat, text) => (hits[cat] ??= []).push(text);

for (const f of files) {
  const selfFile = f === 'tests/qa/sweep.mjs'; // this file names the patterns it looks for; its content is not swept
  // Names of files themselves.
  if (/(^|\/)_/.test(f)) add('structure', `${f}: a name starting with an underscore (GitHub Pages' Jekyll would drop it)`);
  if (/(^|\/)\.env/i.test(f) || /\.(pem|key|p12|pfx)$/i.test(f)) add('secrets', `${f}: a secrets-type file`);
  if (/^(rules-spec|balance|tasks)\//.test(f)) add('internalDocuments', `${f}: a folder that stays internal`);
  if (SKIP_CONTENT.test(f) || SKIP_CONTENT_FILES.has(f) || selfFile) continue;
  const buffer = fs.readFileSync(path.join(ROOT, f));
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  if (text.includes('\r')) add('structure', `${f}: CRLF line endings`);
  const lines = text.split('\n');
  for (const [cat, patterns] of Object.entries(PATTERNS)) {
    lines.forEach((line, i) => {
      for (const re of patterns) {
        const m = re.exec(line);
        if (!m) continue;
        // "Steel" is only allowed where a test or document says it must never appear.
        if (cat === 'terminology' && /\b(never|not|no|must not|ban|banned|forbid|reject|iron|mentions)\b|!\/steel/i.test(line)) continue;
        // An address built from parts, or a local-path-looking match in a regex literal or a URL, is checked by eye below.
        add(cat, `${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
        break;
      }
    });
  }
}

// Sizes.
const sizes = files.map((f) => ({ f, n: fs.statSync(path.join(ROOT, f)).size })).sort((a, b) => b.n - a.n);
const total = sizes.reduce((a, s) => a + s.n, 0);
for (const s of sizes) {
  if (s.n > 1024 * 1024 && s.f !== 'package-lock.json') add('structure', `${s.f}: ${(s.n / 1048576).toFixed(2)} MB (over 1 MB)`);
  if (s.f.startsWith('assets/') && !/art-manifest\.(json|md)$/.test(s.f) && s.n > 200 * 1024) add('structure', `${s.f}: ${(s.n / 1024).toFixed(0)} KB (art over 200 KB)`);
}
// Ignored folders are really untracked.
const tracked = new Set(git('ls-files').split('\n').filter(Boolean));
for (const prefix of ['node_modules/', 'sim-results/', 'tests/tmp/', 'bug-reports/', 'test-results/']) {
  const bad = [...tracked].filter((f) => f.startsWith(prefix));
  if (bad.length) add('structure', `${prefix}: ${bad.length} tracked files`);
}

// The page, the configuration and the licence.
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = read('index.html');
const SITE = 'https://wombatgamefactory.github.io/continental-rails-game/';
const meta = (prop) => (new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`).exec(page) || [])[1];
if (!/<html lang="en-GB">/.test(page)) add('page', 'index.html: lang is not en-GB');
if (!/<title>[^<]{10,}<\/title>/.test(page)) add('page', 'index.html: no title');
if (!meta('description') || meta('description').length < 60) add('page', 'index.html: no description');
if (meta('og:url') !== SITE) add('page', `index.html: og:url is ${meta('og:url')}`);
const ogImage = meta('og:image') ?? '';
if (!ogImage.startsWith(SITE)) add('page', `index.html: og:image is not an absolute address on the site (${ogImage})`);
else if (!fs.existsSync(path.join(ROOT, ogImage.slice(SITE.length)))) add('page', `index.html: the og:image file ${ogImage.slice(SITE.length)} is not in the repository`);
const config = read('src/ui/config.js');
if (!/BUG_REPORT_EMAIL: ''/.test(config)) add('page', 'config.js: BUG_REPORT_EMAIL is not empty');
if (!/GA4_MEASUREMENT_ID: ''/.test(config)) add('page', 'config.js: GA4_MEASUREMENT_ID is not empty');
const build = (/BUILD: '([^']*)'/.exec(config) || [])[1];
if (!build || /[0-9a-f]{7,40}/.test(build.replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}/, '')) || /filled at release/.test(build)) add('page', `config.js: BUILD is "${build}"`);
if (!fs.existsSync(path.join(ROOT, '.nojekyll'))) add('page', 'no .nojekyll file at the repository root');
if (!/All rights reserved/i.test(read('LICENSE'))) add('licence', 'LICENSE is not an all-rights-reserved notice');
if (!/All rights reserved/i.test(read('README.md'))) add('licence', 'README.md does not say all rights reserved');

const order = ['internalDocuments', 'internalReferences', 'secrets', 'addresses', 'localPaths', 'names', 'terminology', 'structure', 'page', 'licence'];
const counts = Object.fromEntries(order.map((c) => [c, (hits[c] ?? []).length]));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ files: files.length, totalBytes: total, counts, hits, largest: sizes.slice(0, 10) }, null, 2));
} else {
  console.log(`${files.length} files, ${(total / 1048576).toFixed(2)} MB (${total} bytes)`);
  console.log('ten largest:');
  for (const s of sizes.slice(0, 10)) console.log(`  ${(s.n / 1024).toFixed(0).padStart(7)} KB  ${s.f}`);
  console.log(`build label: "${build}"`);
  for (const c of order) {
    console.log(`${c}: ${counts[c]}`);
    for (const h of (hits[c] ?? []).slice(0, 40)) console.log(`    ${h}`);
  }
}
process.exit(Object.values(counts).some((n) => n > 0) ? 1 : 0);
