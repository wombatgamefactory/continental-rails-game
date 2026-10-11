// page.mjs - assembles the whole HTML document: header, verdict strip, caution, "what
// changed", health table, the chart sections and the footer.

import { CSS, SCRIPT, DEFS } from './style.mjs';
import { esc, isNum, pct, fixed, count, signed, pp, ukDate, arr, obj, DASH, vpLabel, humanise } from './util.mjs';
import { table, armLabel, metric, pill, section, swatch, legend } from './html.mjs';
import { headlineInfo } from './model.mjs';
import { buildVerdicts, isPctId } from './verdict.mjs';
import { winsSection, scoresSection, lengthSection, pointsSection, pacingSection } from './sections-a.mjs';
import { actionsSection, mapSection, economySection, modulesSection } from './sections-b.mjs';

const multi = (M) => M.arms.length > 1;

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function botsText(run) {
  const bots = arr(run.bots);
  if (!bots.length) return DASH;
  const text = bots.map((b, i) => `Seat ${i + 1}: ${b.type ?? b.level ?? '?'}`).join(', ');
  const rot = run.rotate ? ' (bots rotate between seats from game to game, so the seat order below is where the first bot started)' : run.shuffleSeats ? ' (seats shuffled by the engine)' : '';
  return text + rot;
}

function runFields(run, arm) {
  const f = [];
  f.push(['Run date', run.dateUk ? `${run.dateUk} (London time)` : ukDate(run.date)]);
  f.push(['Games', `${count(run.gamesPerArm)} per arm`]);
  f.push(['Players', isNum(run.players) ? String(run.players) : DASH]);
  f.push(['Bots by seat', botsText(run)]);
  f.push(['Seed', `${run.seed ?? DASH}${run.seedIsDefault ? ' (the default)' : ''}; game k uses seed "${run.seed ?? '?'}-k"`]);
  f.push(['Engine commit', `${run.engineCommit ?? 'unknown'}${run.engineDirty ? ' (src/engine or src/bots had uncommitted changes)' : ''}`]);
  f.push(['Jitter', run.jitter === null || run.jitter === undefined ? 'none' : String(run.jitter)]);
  f.push(['Mode', run.mode === 'fast' ? 'fast (no per-turn events, so some metrics are missing)' : run.mode ?? DASH]);
  if (run.weights) f.push(['Bot weights', JSON.stringify(run.weights) + (run.weightsSeat ? ` (bot ${run.weightsSeat} only)` : ' (every bot)')]);
  void arm;
  return f;
}

function header(M) {
  const A = M.arms[0];
  const title = multi(M) ? 'Continental Rails: simulation comparison' : 'Continental Rails: simulation report';
  const run = A.run;
  const labelBits = M.kind === 'files' ? M.arms.map((a) => a.run.label ?? a.file).join(' against ') : run.label ?? '';
  let meta;
  if (M.kind === 'files') {
    const fa = runFields(M.arms[0].run);
    const fb = runFields(M.arms[1].run);
    meta = table(['', ...M.arms.map((a) => ({ html: `${swatch(a.color, a.pattern)} ${esc(a.short)}: ${esc(a.file)}` }))], fa.map(([k], i) => [k, fa[i][1], fb[i][1]]));
  } else {
    meta = `<dl class="meta">${runFields(run).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }
  const rules = M.arms.map((a) => {
    const lines = a.rules.length ? `<ul>${a.rules.map((r) => `<li>${esc(r.text)}${r.detail ? ` <span class="sub">- ${esc(r.detail)}</span>` : ''}</li>`).join('')}</ul>` : '<p>Default rules (no variants or constants changed).</p>';
    return `<div>${multi(M) ? `<h4>${swatch(a.color, a.pattern)} ${esc(a.label)}</h4>` : '<h4>Rules that differ from the default</h4>'}${lines}</div>`;
  }).join('');
  const cmds = M.arms.map((a) => a.run.commandLine).filter(Boolean);
  const uniqCmds = [...new Set(cmds)];
  const cmdBlock = uniqCmds.length ? `<h4>Command that produced ${uniqCmds.length > 1 ? 'these runs' : 'this run'} (run it again from the repository folder to repeat it)</h4>${uniqCmds.map((c) => `<pre>${esc(c)}</pre>`).join('')}` : '';
  const runNotes = [...new Set(M.arms.flatMap((a) => arr(a.run.warnings)))];
  const notes = [...M.warnings, ...runNotes.map((w) => `Note from the run: ${w}`)];
  const basisNote = M.basis === 'all-finished'
    ? `<div class="notice big"><strong>Small counted sample: this report reads ALL finished games, turn-limit games included.</strong> ${M.arms.map((a) => `${multi(M) ? esc(a.short) + ': ' : ''}only ${count(a.counts.counted)} of ${count(a.counts.finished)} finished games ended by something other than the turn limit`).join('; ')}. That is too few to average (fewer than 30), so, as the health table does, every chart uses all finished games, and each one says so and gives its n. These games mostly show what the bots do up to the safety stop.</div>`
    : '';
  return `<header><h1>${esc(title)}</h1><p class="sub">${esc(labelBits)}${labelBits ? ' - ' : ''}${esc(ukDate(run.date))}</p>${meta}<div class="card" style="margin-top:8px"><div class="${multi(M) ? 'grid2' : ''}">${rules}</div>${cmdBlock}</div>${basisNote}${notes.length ? `<div class="notice">${notes.map((n) => esc(n)).join('<br>')}</div>` : ''}</header>`;
}

// ---------------------------------------------------------------------------
// Verdict, caution
// ---------------------------------------------------------------------------

function verdictStrip(M) {
  const v = buildVerdicts(M);
  return `<section id="verdict"><div class="card verdict"><h2 style="border:0;padding:0">What to look at first</h2><ol>${v.map((t) => `<li>${esc(t)}</li>`).join('')}</ol><p class="sub">Each sentence is generated from the numbers below it. A difference of less than two standard errors is called not distinguishable from chance; no sentence recommends a rule change.</p></div></section>`;
}

const CAUTION = `<div class="caution"><strong>Read these results with care.</strong> They describe how <em>these bots</em> play, not how people will. A subsystem used 0% or 100% of the time is first a question about the bot, and only then about the rule. Bots that are tuned or changed will change the numbers, so re-measure after any bot change.</div>`;

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

function fmtValue(info, id, v) {
  if (!isNum(v)) return DASH;
  return info.kind === 'pct' ? pct(v) : fixed(v, info.d);
}

function changedTable(M) {
  const cmp = M.comparison;
  if (!cmp || !cmp.rows.length) return multi(M) ? section('changed', 'What changed', '', [], ['The two runs share no headline metrics to compare.']) : '';
  const [A, B] = M.arms;
  const rows = cmp.rows.map((r) => ({ r, info: headlineInfo(r.id) }));
  const flagged = rows.filter((x) => x.r.exceedsTwoSe).length;
  const expected = Math.round(rows.length * 0.05);
  const mk = (x) => {
    const { r, info } = x;
    const diffText = info.kind === 'pct' ? pp(r.diff) : signed(r.diff, info.d);
    const se = isNum(r.diffSe) ? (info.kind === 'pct' ? `±${fixed(r.diffSe * 100, 1)} pp` : `±${fixed(r.diffSe, info.d)}`) : DASH;
    const reading = !isNum(r.diffSe) ? 'cannot tell (no standard error)' : r.exceedsTwoSe ? 'Yes - more than 2 standard errors: a real difference at this sample size' : 'No - not distinguishable from chance at this sample size';
    const unit = info.unit && !r.label.includes(info.unit) ? ` <span class="sub">(${esc(info.unit)})</span>` : '';
    return [
      { html: `${esc(/^vpShare\./.test(r.id) ? `VP share: ${vpLabel(r.id.slice(8))}` : r.label)}${unit}<br><span class="sub">${esc(info.meaning)}</span>` },
      metric(r.id, A, r.test, fmtValue(info, r.id, r.test), info.kind === 'pct' ? 'pct1' : `f${info.d}`),
      metric(r.id, B, r.baseline, fmtValue(info, r.id, r.baseline), info.kind === 'pct' ? 'pct1' : `f${info.d}`),
      diffText,
      se,
      isNum(r.z) ? fixed(r.z, 1) : DASH,
      { html: r.exceedsTwoSe ? `<span class="pill warn">${esc(reading)}</span>` : `<span class="pill na">${esc(reading)}</span>` },
    ];
  };
  const head = ['Metric', `${A.short} (${A.label.length > 40 ? 'first' : A.label})`, `${B.short}`, 'Difference', 'Std error of the difference', 'Std errors apart', 'More than 2 std errors?'];
  head[1] = A.short;
  const main = rows.filter((x) => x.info.curated || x.r.exceedsTwoSe);
  const rest = rows.filter((x) => !(x.info.curated || x.r.exceedsTwoSe));
  const tMain = table(head, main.map(mk), { rowClass: main.map((x) => (x.r.exceedsTwoSe ? 'flag' : '')) });
  const tRest = rest.length ? `<details><summary>The other ${rest.length} headline metrics (all within 2 standard errors)</summary>${table(head, rest.map(mk))}</details>` : '';
  const sub = `Each row is one headline metric with its value in both arms. "${esc(A.short)}" is ${esc(A.label)}; "${esc(B.short)}" is ${esc(B.label)}. A difference is only called real when it exceeds <strong>two standard errors</strong> of the difference. Across ${rows.length} metrics, about ${expected} would cross that line by chance alone: ${flagged} did here. Source: ${esc(cmp.source)}; game set: ${cmp.basis === 'counted' ? 'counted games' : 'all finished games, turn-limit games included'} (n = ${count(A.n)} and ${count(B.n)} games). Shaded rows are the ones beyond two standard errors.`;
  const warn = M.kind === 'files' ? M.warnings.filter((w) => /comparable|engine commits/.test(w)).map((w) => `<div class="notice">${esc(w)}</div>`).join('') : '';
  return `<section id="changed"><h2>What changed</h2><p class="sub">${sub}</p>${warn}<div class="fig">${legend(M.arms.map((a) => ({ label: a.label, color: a.color, pattern: a.pattern })))}${tMain}${tRest}</div></section>`;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

function healthValueText(r) {
  if (!r || !isNum(r.value)) return 'not available';
  let t;
  if (r.unit === '%' || r.unit === '% of games') t = `${fixed(r.value, 1)}%`;
  else if (r.unit === 'VP') t = `${fixed(r.value, 1)} VP`;
  else if (r.unit === 'games') t = `${Math.round(r.value)}`;
  else t = fixed(r.value, 1);
  if (isNum(r.sigma)) t += ` (${fixed(Math.abs(r.sigma), 1)} standard errors ${r.sigma >= 0 ? 'above' : 'below'} fair)`;
  if (r.detail) t += ` [${vpLabel(r.detail)}]`;
  return t;
}

function healthSection(M) {
  const base = M.arms[0].health;
  if (!base.length) return section('health', 'Health checks', '', [], ['The health table is not in this file.']);
  const ids = [];
  for (const a of M.arms) for (const r of a.health) if (!ids.includes(r.id)) ids.push(r.id);
  const find = (a, id) => a.health.find((r) => r.id === id);
  const rows = ids.map((id) => {
    const first = M.arms.map((a) => find(a, id)).find(Boolean);
    const cells = M.arms.flatMap((a) => {
      const r = find(a, id);
      const text = healthValueText(r);
      const val = r && isNum(r.value) ? metric(`health.${id}`, a, r.value, text, 'health') : text;
      return [val, pill(r?.status)];
    });
    return [{ html: esc(first.label) }, ...cells, first.healthy, first.badReading];
  });
  const flags = ids.map((id) => (M.arms.some((a) => find(a, id)?.status === 'warn') ? 'flag' : ''));
  const head = ['Check', ...M.arms.flatMap((a) => [multi(M) ? `${a.short}: value` : 'Value', multi(M) ? `${a.short}: status` : 'Status']), 'Healthy range', 'What a bad reading means'];
  const lines = M.arms.map((a) => {
    const warns = a.health.filter((r) => r.status === 'warn').length;
    const rated = a.health.filter((r) => r.status !== 'n/a').length;
    const b = a.healthBasis === 'counted' ? `counted games only (n = ${count(a.counts.counted)}; turn-limit games excluded)` : `ALL ${count(a.counts.finished)} finished games, turn-limit games included, because only ${count(a.counts.counted)} games ended any other way (fewer than 30 is too few to read)`;
    return `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}${warns} of ${rated} rated checks show a warning. Based on ${esc(b)}.`;
  });
  const intro = `${lines.join('<br>')}<br>A warning is a prompt to look, not a verdict: the limits are rules of thumb for heavy Euro games. "n/a" means there is no figure (a --fast run, or no target set yet).`;
  return section('health', 'Health checks', intro, [`<div class="fig">${table(head, rows, { rowClass: flags })}</div>`]);
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function footer(M) {
  const schemas = [...new Set(M.arms.map((a) => a.json.schemaVersion))].join(', ');
  return `<footer class="card" style="margin-top:34px"><h3>How to read the numbers</h3>
<ul class="rules">
<li><strong>Standard error</strong>: how much a figure would wobble if the whole experiment were repeated with new games. For a rate p over n games it is the square root of p(1-p)/n; for a mean it is the standard deviation divided by the square root of n. More games shrink it. Error bars on the charts run plus or minus 2 standard errors, roughly a 95% range.</li>
<li><strong>Sigma (standard errors from fair)</strong>: how far a win rate is from the fair share (1 divided by the number of players), measured in standard errors of the fair share. Beyond about 2 it is unlikely to be chance. 59% at n = 200 is real; 59% at n = 60 is noise.</li>
<li><strong>Difference between two arms</strong>: the square root of the two standard errors squared and added (independent samples); called real only beyond 2 of those. Among about 50 metrics, 2 or 3 will cross the line by chance.</li>
<li><strong>Game sets</strong>: "counted games" exclude games that ended by the turn limit; every mean in them is over counted games only. When fewer than 30 games were counted, the report uses all finished games instead and says so on every chart. Failed games are in neither set.</li>
<li><strong>Win credit</strong>: 1 for a sole top score, 1/k when k players tie on top VP. Shares not given a standard error by the simulator (a share by seat, bonus-action rates) get sqrt(p(1-p)/n) computed here.</li>
<li><strong>The bot is an instrument</strong>: a one-ply bot finds dead rules, dominant strategies and arithmetic problems. It cannot measure fun, and it will not find the clever line a person will.</li>
</ul>
<p class="sub">Simulator output schema version ${esc(schemas)}. Made by sim/sim-report.mjs from ${esc(M.files.join(' and '))}. No scripts or fonts are loaded from anywhere; this page is one file.</p></footer>`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function buildPage(M) {
  const secs = [
    changedTable(M),
    healthSection(M),
    winsSection(M),
    scoresSection(M),
    lengthSection(M),
    pointsSection(M),
    pacingSection(M),
    actionsSection(M),
    mapSection(M),
    economySection(M),
    modulesSection(M),
  ];
  const toc = [['verdict', 'What to look at first'], ...(M.comparison ? [['changed', 'What changed']] : []), ['health', 'Health checks'], ['wins', 'Who wins'], ['scores', 'Scores'], ['length', 'Game length'], ['points', 'Where the points come from'], ['pacing', 'Pacing'], ['actions', 'What players do'], ['map', 'The map'], ['economy', 'Economy'], ['modules', 'Modules']];
  const nav = `<nav class="sub" aria-label="Sections">${toc.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join(' &middot; ')}</nav>`;
  const A = M.arms[0];
  const title = `Continental Rails simulation ${multi(M) ? 'comparison' : 'report'}: ${A.run.label ?? A.file}`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${DEFS}
<main>
${header(M)}
${nav}
${verdictStrip(M)}
${CAUTION}
${secs.join('\n')}
${footer(M)}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
