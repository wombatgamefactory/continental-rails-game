// sections-a.mjs - the first half of the chart sections: who wins, scores, game length,
// where the points come from, pacing.
//
// Every section function takes the model and returns one HTML string (or '' when the file
// holds nothing for it, in which case the page notes it in one line).

import { barV, barH, stackedH, rangeH } from './svg.mjs';
import { fig, table, armLabel, metric, legend, section, pair } from './html.mjs';
import {
  esc, isNum, pct, pctNum, fixed, count, arr, obj, get, propSe, vpLabel, sourceIndex, endLabel, FINAL_SOURCES, humanise, int, plural,
} from './util.mjs';

export const series = (M) => M.arms.map((a) => ({ name: a.short, color: a.color, pattern: a.pattern }));
const multi = (M) => M.arms.length > 1;
const armTitle = (M, a, text) => (multi(M) ? `${a.short} - ${text}` : text);

const SRC_PATTERN = [null, null, null, null, null, null, 'p-hatch', 'p-dots', 'p-vert', 'p-cross', 'p-dots', 'p-horiz', 'p-cross', 'p-hatch', 'p-vert', 'p-horiz'];
export function srcStyle(id) {
  const i = sourceIndex(id);
  return { color: `var(--s${i})`, pattern: SRC_PATTERN[i] ?? null };
}

const stdErr = (sigma) => (isNum(sigma) ? `${sigma >= 0 ? '+' : ''}${fixed(sigma, 1)}` : '');
const verdictWord = (sigma) => (!isNum(sigma) ? '' : Math.abs(sigma) >= 2 ? 'real effect at this sample size' : 'not distinguishable from chance');

// ---------------------------------------------------------------------------
// Histograms from the per-game records (when the run kept them)
// ---------------------------------------------------------------------------

function histogramData(M, getVals, binW, o = {}) {
  const sets = M.arms.map((a) => getVals(a));
  if (sets.some((s) => !s || s.length === 0)) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of sets) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
  lo = o.min ?? Math.floor(lo / binW) * binW;
  const nb = Math.floor((hi - lo) / binW) + 1;
  if (nb > 400) return null;
  const counts = sets.map((s) => {
    const c = new Array(nb).fill(0);
    for (const v of s) c[Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / binW)))] += 1;
    return c;
  });
  return { lo, nb, binW, counts, ns: sets.map((s) => s.length) };
}

function histFig(M, o) {
  const h = histogramData(M, o.values, o.binW, o);
  if (!h) return '';
  const cats = Array.from({ length: h.nb }, (_, i) => String(h.lo + i * h.binW));
  const ser = series(M).map((s, si) => ({
    ...s,
    values: h.counts[si].map((c) => c / h.ns[si]),
    tips: h.counts[si].map((c, i) => `${M.arms[si].short}: ${o.range(h.lo + i * h.binW, h.lo + (i + 1) * h.binW - (o.integer ? 1 : 0))}: ${pct(c / h.ns[si])} of ${o.unit} (${count(c)} of ${count(h.ns[si])})`),
  }));
  const svg = barV({
    label: o.title, categories: cats, series: ser, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), showValues: false, groupPad: multi(M) ? 0.1 : 0.06,
    labelEvery: h.nb > 24 ? 4 : h.nb > 12 ? 2 : 1, yLabel: `Share of ${o.unit} (%)`, xLabel: o.xLabel, ref: o.ref, band: o.band, height: 300,
  });
  const rows = [];
  for (let i = 0; i < h.nb; i++) rows.push([o.range(h.lo + i * h.binW, h.lo + (i + 1) * h.binW - (o.integer ? 1 : 0)), ...M.arms.flatMap((a, si) => [count(h.counts[si][i]), pct(h.counts[si][i] / h.ns[si])])]);
  const tbl = table([o.rangeHead, ...M.arms.flatMap((a) => [`${a.short}: ${o.unit}`, `${a.short}: share`])], rows);
  return fig(M, { title: o.title, sub: o.sub, svg, table: tbl, badge: { n: (a) => h.ns[a.idx], unit: o.unit } });
}

const describeRows = (M, label, getter, d = 1) => M.arms.map((a) => {
  const x = getter(a);
  return [armTitle(M, a, label), x ? count(x.n) : '-', x ? fixed(x.mean, d) : '-', x ? fixed(x.se, 2) : '-', x ? fixed(x.median, d) : '-', x ? fixed(x.sd, d) : '-', x ? fixed(x.min, 0) : '-', x ? fixed(x.max, 0) : '-'];
});
const DESCRIBE_HEAD = ['', 'n', 'Mean', 'Std error', 'Median', 'Std dev', 'Lowest', 'Highest'];

// ---------------------------------------------------------------------------
// Who wins
// ---------------------------------------------------------------------------

export function winsSection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);
  const seatsN = Math.max(0, ...M.arms.map((a) => arr(a.s.bySeat).length));
  if (seatsN) {
    const cats = Array.from({ length: seatsN }, (_, i) => `Seat ${i + 1}`);
    const fair = M.arms[0].s.bySeat?.[0]?.fair ?? (M.arms[0].players ? 1 / M.arms[0].players : null);
    const sers = M.arms.map((a, ai) => ({
      ...ser[ai],
      values: cats.map((_, k) => a.s.bySeat?.[k]?.winRate ?? null),
      ses: cats.map((_, k) => a.s.bySeat?.[k]?.se ?? null),
      tips: cats.map((_, k) => `${a.short}, seat ${k + 1}: wins ${pct(a.s.bySeat?.[k]?.winRate)} (fair ${pct(fair)}; ${stdErr(a.s.bySeat?.[k]?.sigma)} standard errors from fair)`),
    }));
    const svg = barV({ label: 'Win rate by seat', categories: cats, series: sers, ref: { v: fair, label: `Fair share ${pct(fair)}` }, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Games won (% of games)', xLabel: 'Seat (turn-order position)', height: 330 });
    const rows = [];
    for (const a of M.arms) {
      for (const x of arr(a.s.bySeat)) {
        rows.push([...(multi(M) ? [armLabel(a)] : []), `Seat ${x.seat}`, metric(`winRate.seat${x.seat}`, a, x.winRate, pct(x.winRate), 'pct1'), `±${pct(x.se)}`, stdErr(x.sigma), verdictWord(x.sigma), pct(x.tieBreakWinRate), fixed(x.meanRank, 2), fixed(x.score?.mean, 1)]);
      }
    }
    const tbl = table([...(multi(M) ? [''] : []), 'Seat', 'Win rate', 'Std error', 'Std errors from fair (+ above, - below)', 'Reading', 'Wins after tie-breaks', 'Mean rank (1 = best)', 'Mean score (VP)'], rows);
    parts.push(fig(M, {
      title: 'Does any seat win more often than its fair share?',
      sub: `Each bar is the share of games won by a seat (a tie on VP splits the win). The dashed line is the fair share, 1 divided by the number of players. The whisker is plus or minus 2 standard errors: if it crosses the dashed line, that seat is <strong>not distinguishable from chance at this sample size</strong>.`,
      svg, table: tbl,
    }));
  } else notes.push('Win rate by seat is not in this file.');

  // by bot type
  if (M.arms.some((a) => arr(a.s.byType).length > 1)) {
    const types = [...new Set(M.arms.flatMap((a) => arr(a.s.byType).map((t) => t.type)))];
    const fair = M.arms[0].s.byType?.[0]?.fair ?? (M.arms[0].players ? 1 / M.arms[0].players : null);
    const sers = M.arms.map((a, ai) => ({
      ...ser[ai],
      values: types.map((t) => arr(a.s.byType).find((x) => x.type === t)?.winRate ?? null),
      ses: types.map((t) => arr(a.s.byType).find((x) => x.type === t)?.se ?? null),
      tips: types.map((t) => `${a.short}, ${t}: wins ${pct(arr(a.s.byType).find((x) => x.type === t)?.winRate)} per seat taken`),
    }));
    const svg = barV({ label: 'Win rate by bot type', categories: types, series: sers, ref: { v: fair, label: `Fair share per seat ${pct(fair)}` }, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Games won per seat taken (%)', xLabel: 'Bot type', height: 300 });
    const rows = [];
    for (const a of M.arms) for (const x of arr(a.s.byType)) rows.push([...(multi(M) ? [armLabel(a)] : []), x.type, count(x.n), count(x.games), pct(x.winRate), `±${pct(x.se)}`, stdErr(x.sigma), verdictWord(x.sigma), fixed(x.meanRank, 2), fixed(x.score?.mean, 1)]);
    const tbl = table([...(multi(M) ? [''] : []), 'Bot type', 'Seats played', 'Games', 'Win rate per seat', 'Std error', 'Std errors from fair', 'Reading', 'Mean rank', 'Mean score (VP)'], rows);
    const seats = obj(M.arms[0].s.seatTypeCounts);
    parts.push(fig(M, {
      title: 'Do the different bots win equally often?',
      sub: `Win rate per seat the bot took, against the fair share per seat. Bot types in this run: ${esc(Object.entries(seats).map(([k, v]) => `${k} (games at each seat: ${v.join(', ')})`).join('; '))}. A bot that wins above its fair share is playing better; that tells you about the bots, not about the rules.`,
      svg, table: tbl,
    }));
  }

  // first player and leader at half
  if (M.arms.some((a) => a.s.firstPlayer || a.s.leaderAtHalf)) {
    const fair = M.arms[0].s.firstPlayer?.fair ?? M.arms[0].s.leaderAtHalf?.fair ?? null;
    const cats = ['Player who moved first wins', 'Half-time leader wins'];
    const sers = M.arms.map((a, ai) => ({
      ...ser[ai],
      values: [a.s.firstPlayer?.winRate ?? null, a.s.leaderAtHalf?.value ?? null],
      ses: [a.s.firstPlayer?.se ?? null, a.s.leaderAtHalf?.se ?? null],
      tips: [`${a.short}: first player wins ${pct(a.s.firstPlayer?.winRate)}`, `${a.short}: half-time leader wins ${pct(a.s.leaderAtHalf?.value)}`],
    }));
    const svg = barV({ label: 'First-player and half-time-leader win rates', categories: cats, series: sers, ref: { v: fair, label: `Fair share ${pct(fair)}` }, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Games won (% of games)', height: 290 });
    const rows = [];
    for (const a of M.arms) {
      const fp = a.s.firstPlayer;
      const hl = a.s.leaderAtHalf;
      rows.push([...(multi(M) ? [armLabel(a)] : []), 'Player who moved first', fp ? metric('winRate.firstPlayer', a, fp.winRate, pct(fp.winRate), 'pct1') : '-', fp ? `±${pct(fp.se)}` : '-', stdErr(fp?.sigma), verdictWord(fp?.sigma)]);
      rows.push([...(multi(M) ? [armLabel(a)] : []), 'Leader at half-time', hl ? metric('leaderAtHalf.winRate', a, hl.value, pct(hl.value), 'pct1') : 'not collected', hl ? `±${pct(hl.se)}` : '-', stdErr(hl?.sigma), verdictWord(hl?.sigma)]);
    }
    const tbl = table([...(multi(M) ? [''] : []), 'Who', 'Win rate', 'Std error', 'Std errors from fair', 'Reading'], rows);
    const ties = M.arms.map((a) => `${multi(M) ? `${esc(a.short)}: ` : ''}${pct(a.s.vpTieForFirst?.value)} of games ended with a VP tie for first (settled by the tie-breaks)`).join('; ');
    parts.push(fig(M, {
      title: 'Does moving first, or leading at half-time, decide the game?',
      sub: `Half-time is half the rounds played, not half the points. A half-time leader who wins far above the fair share means early leads are rarely overturned. ${ties}.`,
      svg, table: tbl,
    }));
  }
  if (!parts.length) return '';
  return section('wins', 'Who wins', 'Win rates are shares of games. Seats are turn-order positions; ties on VP split the win.', parts, notes);
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export function scoresSection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);
  const hasGames = M.arms.every((a) => a.games);

  const all = histFig(M, {
    title: 'How are final scores spread?', sub: 'Every player\'s final score, in bands of 10 VP. Each bar is the share of players whose score falls in that band.',
    values: (a) => a.games?.flatMap((g) => g.scores.filter(isNum)), binW: 10, unit: 'players', xLabel: 'Final score, VP (label = lowest score in the band)', rangeHead: 'Score band (VP)', range: (a, b) => `${a}-${b}`, integer: true,
  });
  const win = histFig(M, {
    title: 'How high do winning scores go?', sub: 'The top score of each game, in bands of 10 VP. A wide spread means games differ a lot in how many points it takes to win.',
    values: (a) => a.games?.map((g) => Math.max(...g.scores.filter(isNum))), binW: 10, unit: 'games', xLabel: 'Winning score, VP (label = lowest score in the band)', rangeHead: 'Score band (VP)', range: (a, b) => `${a}-${b}`, integer: true,
  });
  const margin = histFig(M, {
    title: 'How close are the finishes?', sub: 'Margin = (winner minus second place) as a percentage of the winner\'s score, in bands of 5 points. Healthy is a typical margin of 15 to 22%; bars under 10 are the close finishes.',
    values: (a) => a.games?.map((g) => { const s = g.scores.filter(isNum).sort((x, y) => y - x); return s.length > 1 && s[0] > 0 ? ((s[0] - s[1]) / s[0]) * 100 : null; }).filter(isNum), binW: 5, unit: 'games', min: 0, xLabel: 'Margin of the winner over second place (% of winner\'s score; label = start of the band)', rangeHead: 'Margin band (%)', range: (a, b) => `${a} to under ${b}%`,
  });

  if (all) parts.push(all);
  if (win) parts.push(win);
  if (margin) parts.push(margin);
  if (!hasGames) notes.push('Score histograms need the per-game records, which this file does not hold (a run of more than 5,000 games per arm drops them unless --keep-games is given). The summary below uses the aggregate figures.');

  // Summary range plot (always available)
  const measures = [
    ['All players\' scores', (a) => a.s.score],
    ['Winning scores', (a) => a.s.winningScore],
    ['Scores of everyone else', (a) => a.s.restScore],
  ];
  const rows = [];
  for (const [label, getter] of measures) {
    for (const a of M.arms) {
      const x = getter(a);
      if (!x || !isNum(x.mean)) continue;
      rows.push({ label: armTitle(M, a, label), color: a.color, pattern: a.pattern, mean: x.mean, se: x.se, median: x.median, min: x.min, max: x.max, tip: `${a.short} ${label}: mean ${fixed(x.mean, 1)} VP, median ${fixed(x.median, 1)}, lowest ${x.min}, highest ${x.max} (n = ${count(x.n)})` });
    }
  }
  if (rows.length) {
    const svg = rangeH({ label: 'Score summary', rows, xFmt: (v) => fixed(v, 0), xLabel: 'Score (VP)' });
    const tbl = table(DESCRIBE_HEAD, measures.flatMap(([label, getter]) => describeRows(M, label, getter)));
    parts.push(fig(M, {
      title: 'What do scores look like at a glance?',
      sub: 'The dot is the mean, the thick bar is plus or minus 2 standard errors of that mean, the black tick is the median, and the thin line runs from the lowest to the highest score seen.',
      svg, table: tbl, badge: { n: (a) => a.s.score?.n ?? a.n, unit: 'player scores' },
      after: `<p class="sub">${M.arms.map((a) => `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}mean score ${metric('score.mean', a, a.s.score?.mean, fixed(a.s.score?.mean, 1), 'f1').html} VP per player; mean winning score ${metric('score.winning', a, a.s.winningScore?.mean, fixed(a.s.winningScore?.mean, 1), 'f1').html} VP; the winner is ahead of second place by ${metric('margin.mean', a, a.s.marginPct?.mean, pctNum(a.s.marginPct?.mean), 'pctnum1').html} of their own score on average.`).join('<br>')}</p>`,
    }));
  } else notes.push('Score statistics are not in this file.');

  // Closeness
  if (M.arms.some((a) => a.s.within10)) {
    const cats = ['Winner ahead by 10% or less', 'VP tie for first place'];
    const sers = M.arms.map((a, ai) => ({
      ...ser[ai],
      values: [a.s.within10?.value ?? null, a.s.vpTieForFirst?.value ?? null],
      ses: [a.s.within10?.se ?? null, a.s.vpTieForFirst?.se ?? null],
      tips: [`${a.short}: ${pct(a.s.within10?.value)} of games within 10%`, `${a.short}: ${pct(a.s.vpTieForFirst?.value)} of games tied for first`],
    }));
    const svg = barV({ label: 'Close finishes', categories: cats, series: sers, ref: { v: 0.25, label: 'Healthy: at least 25% within 10%' }, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Share of games (%)', height: 270 });
    const trows = M.arms.map((a) => [...(multi(M) ? [armLabel(a)] : []), metric('margin.within10', a, a.s.within10?.value, pct(a.s.within10?.value), 'pct1'), `±${pct(a.s.within10?.se)}`, pct(a.s.vpTieForFirst?.value), count(a.s.within10?.n)]);
    parts.push(fig(M, {
      title: 'How often is it a close finish?',
      sub: 'Share of games where the winner beat second place by 10% of their score or less (healthy: at least 25%), and share of games that finished level on VP. The whisker is plus or minus 2 standard errors.',
      svg, table: table([...(multi(M) ? [''] : []), 'Within 10%', 'Std error', 'VP tie for first', 'Games'], trows),
    }));
  }
  if (!parts.length) return '';
  return section('scores', 'Scores', 'VP = victory points. Scores are final totals including end-of-game scoring.', parts, notes);
}

// ---------------------------------------------------------------------------
// Game length
// ---------------------------------------------------------------------------

export function lengthSection(M) {
  const parts = [];
  const notes = [];
  let hist = histFig(M, {
    title: 'How long do games last?', sub: 'Turns taken by each player (the most turns any one player took), in bands of 2 turns. Each bar is the share of games.',
    values: (a) => a.games?.map((g) => Math.max(...arr(g.turns).filter(isNum))).filter(isFinite), binW: 2, unit: 'games', xLabel: 'Turns per player (label = lowest in the band)', rangeHead: 'Turns per player', range: (a, b) => `${a}-${b}`, integer: true,
  });
  if (!hist && M.arms.every((a) => arr(a.s.lengthHistogram).length)) {
    const bins = [...new Set(M.arms.flatMap((a) => arr(a.s.lengthHistogram).map((b) => b.from)))].sort((x, y) => x - y);
    const ser = series(M).map((s, si) => {
      const a = M.arms[si];
      const total = arr(a.s.lengthHistogram).reduce((t, b) => t + (b.games ?? 0), 0);
      return { ...s, values: bins.map((f) => (arr(a.s.lengthHistogram).find((b) => b.from === f)?.games ?? 0) / (total || 1)), tips: bins.map((f) => `${a.short}: ${f}-${f + 9} turns: ${arr(a.s.lengthHistogram).find((b) => b.from === f)?.games ?? 0} games`) };
    });
    const svg = barV({ label: 'Game length', categories: bins.map((b) => `${b}-${b + 9}`), series: ser, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Share of games (%)', xLabel: 'Turns per player (bands of 10)', height: 280 });
    hist = fig(M, { title: 'How long do games last?', sub: 'Turns taken by each player, in bands of 10 turns (finer bands need the per-game records).', svg });
  }
  if (hist) parts.push(hist);

  // End reasons
  const haveEnd = M.arms.some((a) => Object.keys(a.endReasons).length);
  if (haveEnd) {
    const order = ['transcontinental', 'routes-claimed', 'turn-limit'];
    const keys = [...new Set([...order, ...M.arms.flatMap((a) => Object.keys(a.endReasons))])].filter((k) => M.arms.some((a) => a.endReasons[k]));
    const style = (k) => (k === 'transcontinental' ? { color: 'var(--e0)', pattern: null } : k === 'routes-claimed' ? { color: 'var(--e1)', pattern: 'p-dots' } : k === 'turn-limit' ? { color: 'var(--e2)', pattern: 'p-cross' } : { color: 'var(--s13)', pattern: 'p-vert' });
    const totals = M.arms.map((a) => keys.reduce((t, k) => t + (a.endReasons[k]?.games ?? 0), 0));
    const rows = M.arms.map((a, ai) => ({
      label: armTitle(M, a, 'how the game ended'),
      parts: keys.map((k) => ({ key: k, label: endLabel(k), value: (a.endReasons[k]?.games ?? 0) / (totals[ai] || 1), ...style(k), edge: 'var(--card)', tip: `${a.short}: ${endLabel(k)}: ${count(a.endReasons[k]?.games ?? 0)} of ${count(totals[ai])} games (${pct((a.endReasons[k]?.games ?? 0) / (totals[ai] || 1))})` })),
    }));
    const svg = stackedH({ label: 'How games end', rows, xLabel: 'Share of all finished games (%)', rowHeight: 40 });
    const trows = [];
    for (const [ai, a] of M.arms.entries()) for (const k of keys) trows.push([...(multi(M) ? [armLabel(a)] : []), endLabel(k), count(a.endReasons[k]?.games ?? 0), pct((a.endReasons[k]?.games ?? 0) / (totals[ai] || 1)), `±${pct(propSe((a.endReasons[k]?.games ?? 0) / (totals[ai] || 1), totals[ai]))}`]);
    const tl = M.arms.map((a) => {
      const c = a.counts;
      if (!isNum(c.turnLimit)) return '';
      return c.turnLimit > 0
        ? `<div class="notice ${c.turnLimitPct > 10 ? 'big' : ''}"><strong>${multi(M) ? `${esc(a.short)}: ` : ''}${count(c.turnLimit)} of ${count(c.finished)} finished games (${fixed(c.turnLimitPct, 1)}%) ended by the turn limit.</strong> ${a.basis === 'counted' ? 'They are excluded from every average on this page and counted here on their own.' : 'Too few games ended any other way, so this page reads every finished game, turn-limit games included.'} A game that runs to the safety stop is a livelock or a dead end to investigate, not a normal game.</div>`
        : `<p class="sub">${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}No game hit the turn limit (n = ${count(c.finished)} finished games).</p>`;
    }).join('');
    parts.push(fig(M, {
      title: 'How do games end?',
      sub: 'Share of all finished games by end reason. This chart always includes the turn-limit games, so you can see how many there were.',
      legend: legend(keys.map((k) => ({ label: endLabel(k), ...style(k) }))),
      svg, after: tl, table: table([...(multi(M) ? [''] : []), 'End reason', 'Games', 'Share', 'Std error'], trows), badge: { n: (a) => totals[a.idx], basis: false },
    }));
  } else notes.push('End reasons are not in this file.');

  // Length table
  const lrows = describeRows(M, 'Turns per player', (a) => a.s.length);
  const d = M.arms.map((a) => `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}mean ${metric('length.mean', a, a.s.length?.mean, fixed(a.s.length?.mean, 1), 'f1').html} turns per player; ${fixed(a.s.decisions?.perTurn?.mean, 2)} bot decisions per turn (${metric('decisions.perTurn', a, a.s.decisions?.perTurn?.mean, fixed(a.s.decisions?.perTurn?.mean, 2), 'f2').html}); ${fixed(a.s.decisions?.perGame?.mean, 0)} decisions per game plus ${fixed(a.s.decisions?.forcedPerGame?.mean, 0)} applied automatically when only one action was legal.`).join('<br>');
  if (M.arms.some((a) => a.s.length)) parts.push(`<div class="card"><h4>Game length in numbers</h4><p>${d}</p>${table(DESCRIBE_HEAD, lrows)}</div>`);
  if (!parts.length) return '';
  return section('length', 'Game length and how games end', 'A turn is one player\'s turn. Games that end by the turn limit are reported on their own.', parts, notes);
}

// ---------------------------------------------------------------------------
// Where the points come from
// ---------------------------------------------------------------------------

export function pointsSection(M) {
  if (!M.arms.some((a) => arr(a.s.vpBySource).length)) return section('points', 'Where the points come from', '', [], ['Victory-point sources are not in this file.']);
  const ids = [];
  for (const a of M.arms) for (const x of arr(a.s.vpBySource)) if (!ids.includes(x.source)) ids.push(x.source);
  ids.sort((x, y) => sourceIndex(x) - sourceIndex(y));
  const find = (a, id) => arr(a.s.vpBySource).find((x) => x.source === id);
  const leg = legend(ids.map((id) => ({ label: vpLabel(id) + (FINAL_SOURCES.has(id) ? ' *' : ''), ...srcStyle(id) })));
  const part = (a, id, field, who) => {
    const x = find(a, id);
    return { key: id, label: vpLabel(id), value: x?.[field] ?? 0, ...srcStyle(id), edge: 'var(--card)', tip: `${a.short}, ${who}: ${vpLabel(id)}: ${pct(x?.[field])} of VP` };
  };
  const rowsAll = M.arms.map((a) => ({ label: armTitle(M, a, 'all players'), parts: ids.map((id) => part(a, id, 'share', 'all players')) }));
  const rowsWin = M.arms.flatMap((a) => [
    { label: armTitle(M, a, 'winners'), parts: ids.map((id) => part(a, id, 'shareWinners', 'winners')) },
    { label: armTitle(M, a, 'everyone else'), parts: ids.map((id) => part(a, id, 'shareRest', 'everyone else')) },
  ]);
  const note = '<p class="sub">* Booked by final scoring when the game ends; the others are booked as the game is played. Bar segments over 4% carry their share.</p>';
  const flags = [];
  const trows = ids.map((id) => {
    const cells = M.arms.flatMap((a) => {
      const x = find(a, id);
      return [fixed(x?.meanPerPlayer, 1), metric(`vpShare.${id}`, a, x?.share, pct(x?.share), 'pct1'), x ? `±${pct(x.shareSe)}` : '-', pct(x?.shareWinners), pct(x?.shareRest)];
    });
    flags.push(M.arms.some((a) => (find(a, id)?.share ?? 0) >= 0.45) ? 'flag' : '');
    return [vpLabel(id) + (FINAL_SOURCES.has(id) ? ' *' : ''), ...cells];
  });
  const head = ['VP source', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}mean VP per player`, 'share of all VP', 'std error', 'share of winners\' VP', 'share of the rest\'s VP'])];
  const tbl = table(head, trows, { rowClass: flags });
  const parts = [];
  const n = { n: (a) => a.s.score?.n ?? a.n, unit: 'player scores' };
  parts.push(fig(M, {
    title: 'Which scoring sources carry the game?',
    sub: 'Each bar adds up to 100% of the VP scored by all players. Healthy: no single source above 45%, otherwise the others are decoration. Segment labels show the share; the legend gives the source (patterns repeat colours, so follow the legend order from left to right).',
    legend: leg, svg: stackedH({ label: 'VP share by source', rows: rowsAll, xLabel: 'Share of all VP (%)', rowHeight: 44 }), after: note, table: tbl, badge: n,
  }));
  parts.push(fig(M, {
    title: 'Do winners score their points differently from everyone else?',
    sub: 'The same split for the winners\' points and for the points of the other players. A source that is much larger for winners is what separates winning from losing.',
    legend: leg, svg: stackedH({ label: 'VP share by source, winners and the rest', rows: rowsWin, xLabel: 'Share of that group\'s VP (%)', rowHeight: 38 }), badge: { n: (a) => a.s.winnersScore?.n ?? a.n, unit: 'winners' },
  }));
  return section('points', 'Where the points come from', 'Victory points by source. "Share" is a share of all VP scored; mean VP per player is per player per game.', parts);
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

export function pacingSection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);
  if (M.arms.some((a) => a.s.vpByQuarter?.shares)) {
    const cats = ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4', 'End-of-game scoring'];
    const sers = M.arms.map((a, ai) => {
      const q = a.s.vpByQuarter;
      return { ...ser[ai], values: q ? [...arr(q.shares).slice(0, 4), q.finalScoring ?? null] : cats.map(() => null), ses: q ? [...arr(q.shareSes).slice(0, 4), q.finalScoringSe ?? null] : [], tips: cats.map((c, i) => `${a.short}, ${c}: ${pct(q ? (i < 4 ? q.shares?.[i] : q.finalScoring) : null)} of all VP`) };
    });
    const svg = barV({ label: 'VP by game quarter', categories: cats, series: sers, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Share of all VP (%)', xLabel: 'Part of the game (quarters of the rounds played)', height: 300 });
    const trows = M.arms.map((a) => { const q = a.s.vpByQuarter; return [...(multi(M) ? [armLabel(a)] : []), ...(q ? [...arr(q.shares).slice(0, 4).map((x) => pct(x)), pct(q.finalScoring), metric('vp.finalQuarter', a, q.finalQuarterWithEndScoring, pct(q.finalQuarterWithEndScoring), 'pct1'), `±${pct(q.finalQuarterWithEndScoringSe)}`] : ['-', '-', '-', '-', '-', '-', '-'])]; });
    const tbl = table([...(multi(M) ? [''] : []), 'Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4', 'End scoring', 'Quarter 4 plus end scoring', 'Std error'], trows);
    parts.push(fig(M, {
      title: 'When in the game are the points scored?',
      sub: 'Share of all VP booked in each quarter of the game, and at the final count. The healthy guide is at least 30% in the last quarter plus end scoring; less means flat pacing with no climax. Whiskers are plus or minus 2 standard errors.',
      svg, table: tbl,
    }));
  } else notes.push('VP by game quarter is not in this file (a --fast run does not collect it).');

  // Lead changes
  const lcHist = histFig(M, {
    title: 'How often does the lead change hands?', sub: 'Times the player in front changed during a game, counted at the end of every turn (ties change nothing). Healthy is 5 or more per game; under 2 means the leader is never challenged.',
    values: (a) => a.games?.map((g) => g.leadChanges).filter(isNum), binW: 1, unit: 'games', xLabel: 'Lead changes in a game', rangeHead: 'Lead changes', range: (a) => `${a}`, integer: true, min: 0,
  });
  if (lcHist) parts.push(lcHist);
  else if (M.arms.some((a) => a.s.leadChanges)) {
    const rows = M.arms.filter((a) => a.s.leadChanges).map((a) => ({ label: armTitle(M, a, 'lead changes'), color: a.color, pattern: a.pattern, mean: a.s.leadChanges.mean, se: a.s.leadChanges.se, median: a.s.leadChanges.median, min: a.s.leadChanges.min, max: a.s.leadChanges.max }));
    parts.push(fig(M, { title: 'How often does the lead change hands?', sub: 'Mean lead changes per game; healthy is 5 or more.', svg: rangeH({ label: 'Lead changes', rows, band: { from: 5, to: null, label: 'Healthy: 5 or more' }, xLabel: 'Lead changes per game' }), table: table(DESCRIBE_HEAD, describeRows(M, 'Lead changes', (a) => a.s.leadChanges, 2)) }));
  } else notes.push('Lead changes are not in this file (a --fast run does not collect them).');
  if (M.arms.some((a) => a.s.leadChanges)) {
    parts.push(`<p class="sub">${M.arms.map((a) => `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}mean lead changes per game ${metric('leadChanges.mean', a, a.s.leadChanges?.mean, fixed(a.s.leadChanges?.mean, 1), 'f1').html} (median ${fixed(a.s.leadChanges?.median, 1)}, n = ${count(a.s.leadChanges?.n)} games).`).join(' ')}</p>`);
  }
  if (!parts.length) return section('pacing', 'Pacing', '', [], notes);
  return section('pacing', 'Pacing', 'The shape of a game from start to finish.', parts, notes);
}
