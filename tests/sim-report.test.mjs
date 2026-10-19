// sim-report.test.mjs - the HTML report generator: sim/sim-report.mjs.
//
// Runs the simulator for a handful of random-bot games (single arm, baseline arm, --fast)
// into a temporary folder under the operating system's temp folder, builds reports and checks: the file is written and a
// second run writes -v2 without touching the first; no undefined / NaN / remote resource in
// the HTML; figures printed in the page (data-metric spans) equal the JSON aggregates; a
// truncated JSON (no modules, no vpByQuarter) still produces a page; two-file comparison.
// Exits 1 on any failure.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateReport } from '../sim/sim-report.mjs';
import { makeTempDir, removeTempDir } from './helpers/tmp.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A folder of this process's own under the operating system's temp folder (never a fixed name in the
// repository), so two runs at once cannot collide and a sync tool's lock cannot fail the clean-up.
const dir = makeTempDir('cr-sim-report-test');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(e.stack ?? e).split('\n').slice(0, 4).join('\n       ')}`);
  }
}

function sim(name, args) {
  const out = path.join(dir, `${name}.json`);
  const r = spawnSync(process.execPath, [path.join(repo, 'sim', 'sim.mjs'), '--quiet', '--threads=2', `--out=${out}`, '--bots=random', '--players=3', '--games=6', ...args], { encoding: 'utf8' });
  assert.ok(fs.existsSync(out), `sim failed: ${r.stderr || r.stdout}`);
  return out;
}

const single = sim('single', ['--label=t-single']);
// The scoring-card constant is there to make a difference of more than 2 standard errors certain in 6 games.
const baseline = sim('baseline', ['--baseline', '--variant.conversionRate=1:1', '--const.SCORING.scoringCardVpPerSlot=20', '--label=t-baseline']);
const fast = sim('fast', ['--fast', '--seed=2', '--label=t-fast']);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function checkHtml(html, label) {
  assert.ok(html.startsWith('<!doctype html>'), `${label}: doctype`);
  assert.ok(!/undefined|NaN/.test(html), `${label}: contains undefined or NaN: ${(html.match(/.{40}(undefined|NaN).{20}/) ?? [''])[0]}`);
  assert.ok(!/https?:\/\//i.test(html), `${label}: contains an http(s) URL`);
  assert.ok(!/@import/.test(html), `${label}: @import`);
  assert.ok(!/url\((?!#)/.test(html), `${label}: url( that is not a local #fragment`);
  assert.ok(!/<(script|link|img|iframe)\b[^>]*\b(src|href)=/i.test(html), `${label}: external resource tag`);
  assert.ok(!/\r/.test(html), `${label}: CR in output`);
  assert.ok(/Never used - check the bot before the rule/.test(html), `${label}: never-used block`);
}

const metrics = (html) => [...html.matchAll(/<span data-metric="([^"]+)" data-arm="([^"]+)" data-set="([^"]+)"(?: data-raw="([^"]*)")? data-fmt="([^"]+)">([^<]*)<\/span>/g)].map((m) => ({ id: m[1], arm: m[2], set: m[3], raw: m[4] === undefined ? null : Number(m[4]), fmt: m[5], text: m[6] }));

function fmtText(fmt, raw) {
  if (fmt === 'pct1') return `${(raw * 100).toFixed(1)}%`;
  if (fmt === 'pctnum1') return `${raw.toFixed(1)}%`;
  if (fmt === 'health') return null; // has extra words; the number is checked separately
  const m = /^f(\d)$/.exec(fmt);
  return m ? raw.toFixed(Number(m[1])) : null;
}

await test('writes the report beside the input; a second run writes -v2 and leaves the first untouched', async () => {
  const a = await generateReport([single]);
  assert.equal(a, single.replace(/\.json$/, '-report.html'));
  const before = fs.readFileSync(a, 'utf8');
  const mtime = fs.statSync(a).mtimeMs;
  const b = await generateReport([single]);
  assert.equal(b, single.replace(/\.json$/, '-report-v2.html'));
  assert.equal(fs.readFileSync(a, 'utf8'), before);
  assert.equal(fs.statSync(a).mtimeMs, mtime);
  const c = await generateReport([single]);
  assert.ok(c.endsWith('-report-v3.html'));
  checkHtml(before, 'single');
});

await test('CLI prints the output path and honours --out', () => {
  const out = path.join(dir, 'cli-out.html');
  const r = spawnSync(process.execPath, [path.join(repo, 'sim', 'sim-report.mjs'), single, `--out=${out}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  assert.ok(fs.existsSync(out));
  const bad = spawnSync(process.execPath, [path.join(repo, 'sim', 'sim-report.mjs')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

await test('five or more printed figures equal the JSON aggregates', async () => {
  const p = await generateReport([single], { out: path.join(dir, 'figs.html') });
  const html = fs.readFileSync(p, 'utf8');
  const j = read(single);
  const arm = j.arms[0];
  const ms = metrics(html);
  assert.ok(ms.length >= 15, `only ${ms.length} data-metric spans`);
  let checked = 0;
  for (const m of ms) {
    const s = m.set === 'counted' ? arm.aggregate : arm.aggregateAll;
    let expected;
    if (m.id.startsWith('health.')) expected = arm.aggregate.health.find((h) => h.id === m.id.slice(7))?.value;
    else expected = s.headline[m.id]?.value;
    assert.ok(typeof expected === 'number', `no JSON value for ${m.id}`);
    assert.ok(Math.abs(m.raw - expected) < 1e-9, `${m.id}: page ${m.raw} against JSON ${expected}`);
    const t = fmtText(m.fmt, m.raw);
    if (t !== null) assert.equal(m.text, t, `${m.id}: printed text`);
    else assert.ok(m.text.startsWith(Number.isInteger(m.raw) && !/\./.test(m.text) ? String(m.raw) : m.raw.toFixed(1)), `${m.id}: health text ${m.text} for ${m.raw}`);
    checked++;
  }
  assert.ok(checked >= 5);
  const ids = new Set(ms.map((m) => m.id));
  for (const want of ['winRate.seat1', 'score.mean', 'length.mean']) assert.ok(ids.has(want), `${want} printed`);
});

await test('with few counted games the report falls back to all finished games and says so', async () => {
  const j = read(single);
  if (j.arms[0].aggregate.healthBasis !== 'all-finished') return; // a lucky run with 30+ counted games
  const html = fs.readFileSync(await generateReport([single], { out: path.join(dir, 'basis.html') }), 'utf8');
  assert.ok(/ALL finished games/.test(html));
  assert.ok(/all finished games \(turn-limit included\)/.test(html));
});

await test('baseline file gives a comparison: What changed table, both arms in charts', async () => {
  const p = await generateReport([baseline], { out: path.join(dir, 'cmp.html') });
  const html = fs.readFileSync(p, 'utf8');
  checkHtml(html, 'baseline');
  assert.ok(html.includes('<h2>What changed</h2>'));
  assert.ok(/more than 2 standard errors/i.test(html));
  assert.ok(html.includes('var(--arm1)'), 'second arm colour used');
  assert.ok(html.includes('p-hatch'), 'second arm pattern used');
  const ms = metrics(html);
  const arms = new Set(ms.map((m) => m.arm));
  assert.ok(arms.has('a0') && arms.has('a1'));
  const j = read(baseline);
  const set = j.comparison.preferred === 'counted' ? j.comparison.counted : j.comparison.allFinished;
  const row = set.metrics.find((r) => r.id === 'winRate.seat1');
  const got = ms.filter((m) => m.id === 'winRate.seat1');
  assert.ok(got.some((m) => m.arm === 'a0' && Math.abs(m.raw - row.test) < 1e-9));
  assert.ok(got.some((m) => m.arm === 'a1' && Math.abs(m.raw - row.baseline) < 1e-9));
  assert.ok(/Conversion rate: 1:1 \(default 2:1\)/.test(html), 'variant in words');
});

await test('two files: comparison computed here, with a comparability warning when seeds differ', async () => {
  const p = await generateReport([single, fast], { out: path.join(dir, 'two.html') });
  const html = fs.readFileSync(p, 'utf8');
  checkHtml(html, 'two files');
  assert.ok(html.includes('<h2>What changed</h2>'));
  assert.ok(/only comparable if they used the same seeds/.test(html));
  assert.ok(/computed by this report from the two files/.test(html));
});

await test('--fast results (missing sections) give a page with one-line notes', async () => {
  const p = await generateReport([fast], { out: path.join(dir, 'fast.html') });
  const html = fs.readFileSync(p, 'utf8');
  checkHtml(html, 'fast');
  assert.ok(/not in this file|--fast/.test(html));
});

await test('a truncated JSON (no modules, no vpByQuarter) still produces a page', async () => {
  const j = read(single);
  for (const arm of j.arms) {
    for (const s of [arm.aggregate, arm.aggregateAll]) {
      delete s.modules;
      delete s.vpByQuarter;
    }
  }
  const t = path.join(dir, 'truncated.json');
  fs.writeFileSync(t, JSON.stringify(j));
  const html = fs.readFileSync(await generateReport([t]), 'utf8');
  assert.ok(!/undefined|NaN/.test(html));
  assert.ok(html.includes('id="wins"'));
  assert.ok(/not in this file/.test(html));
});

await test('badly damaged input does not throw an exception: nulls everywhere', async () => {
  const j = read(single);
  const a = j.arms[0];
  for (const k of Object.keys(a.aggregate)) if (!['counts', 'n', 'basis'].includes(k)) a.aggregate[k] = null;
  for (const k of Object.keys(a.aggregateAll)) if (!['counts', 'n', 'basis'].includes(k)) a.aggregateAll[k] = null;
  a.games = null;
  const t = path.join(dir, 'damaged.json');
  fs.writeFileSync(t, JSON.stringify(j));
  const html = fs.readFileSync(await generateReport([t]), 'utf8');
  assert.ok(!/undefined|NaN/.test(html));
  await assert.rejects(() => generateReport([path.join(dir, 'nope.json')]), /Cannot read/);
  fs.writeFileSync(path.join(dir, 'junk.json'), '{"x":1}');
  await assert.rejects(() => generateReport([path.join(dir, 'junk.json')]), /does not look like/);
});

await test('terminology: the metal is Iron, never Steel', async () => {
  const html = fs.readFileSync(await generateReport([baseline], { out: path.join(dir, 'terms.html') }), 'utf8');
  assert.ok(!/\bsteel\b/i.test(html));
});

removeTempDir(dir); // best effort: a locked folder is left for the operating system
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
