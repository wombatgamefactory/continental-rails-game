// verdict.mjs - the plain sentences at the top of the report, generated from the data.
//
// Rules for every sentence: state only what the numbers support; always give n; a
// difference under two standard errors is "not distinguishable from chance at this sample
// size"; never recommend a rule change.

import { isNum, pct, fixed, pctNum, count, vpLabel, get, arr, humanise, pp, signed } from './util.mjs';
import { zeroUsage } from './model.mjs';

function setWords(arm) {
  return arm.basis === 'counted' ? 'counted games' : 'all finished games, turn-limit games included';
}

function seatSentence(arm) {
  const seats = arr(arm.s.bySeat).filter((x) => x && isNum(x.sigma) && isNum(x.winRate));
  if (!seats.length) return null;
  const worst = seats.reduce((a, b) => (Math.abs(b.sigma) > Math.abs(a.sigma) ? b : a));
  const n = worst.n ?? arm.n;
  const std = `${fixed(Math.abs(worst.sigma), 1)} standard errors`;
  if (Math.abs(worst.sigma) >= 2) {
    return {
      weight: 90,
      text: `Seat ${worst.seat} wins ${pct(worst.winRate)} of games (fair share ${pct(worst.fair)}); that is ${std} ${worst.sigma > 0 ? 'above' : 'below'} fair - a real effect at this sample size (n = ${count(n)} ${setWords(arm)}).`,
    };
  }
  return {
    weight: 40,
    text: `No seat's win rate is distinguishable from chance at this sample size: the furthest from fair is seat ${worst.seat} at ${pct(worst.winRate)} (fair share ${pct(worst.fair)}; ${std}; n = ${count(n)} ${setWords(arm)}).`,
  };
}

export function buildVerdicts(model) {
  const A = model.arms[0];
  const s = A.s;
  const out = [];
  const c = A.counts;

  // Failures first: nothing else can be trusted
  const failed = (c.failed ?? 0) + 0;
  if (failed > 0) {
    out.push({ weight: 100, text: `${count(failed)} of ${count(c.games)} games failed outright (${count(c.refusals ?? 0)} refused bot actions, ${count(c.errors ?? 0)} crashes, ${count(c.decisionCapHits ?? 0)} decision-cap hits, ${count(c.integrity ?? 0)} bookkeeping mismatches). That is an engine or bot fault to look at before any balance figure.` });
  }

  // Turn limit
  if (isNum(c.turnLimit) && c.turnLimit > 0) {
    const limit = A.arm.variants?.maxTurnsPerPlayer;
    const limitWords = isNum(limit) && limit > 0 ? `${limit}-turn` : 'turn';
    const share = pct(c.turnLimit / c.finished);
    if (A.basis === 'counted') {
      out.push({ weight: 85, text: `${share} of games (${count(c.turnLimit)} of ${count(c.finished)}) hit the ${limitWords} safety limit and are excluded from the averages below, which use the other ${count(c.counted)} games.` });
    } else {
      out.push({ weight: 95, text: `${share} of games (${count(c.turnLimit)} of ${count(c.finished)}) hit the ${limitWords} safety limit. Only ${count(c.counted)} games ended any other way, too few to average, so every figure below uses all ${count(s.n)} finished games, turn-limit games included. Read them as how the bots play to the limit, not as full games.` });
    }
  }

  const seat = seatSentence(A);
  if (seat) out.push(seat);

  // Comparison summary
  if (model.comparison && model.comparison.rows.length) {
    const rows = model.comparison.rows;
    const flagged = rows.filter((r) => r.exceedsTwoSe);
    const expect = Math.round(rows.length * 0.05);
    const B = model.arms[1];
    const top = flagged
      .filter((r) => isNum(r.z))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 3)
      .map((r) => `${r.label} (${isPctId(r.id) ? pp(r.diff) : signed(r.diff, 2)}, ${fixed(Math.abs(r.z), 1)} standard errors)`);
    out.push({
      weight: 88,
      text: flagged.length
        ? `${A.short} against ${B.short}: ${flagged.length} of ${rows.length} headline metrics differ by more than two standard errors (about ${expect} would by chance alone), the largest being ${top.join('; ')}. The rest are not distinguishable from chance at this sample size (n = ${count(A.n)} and ${count(B.n)} games).`
        : `${A.short} against ${B.short}: none of the ${rows.length} headline metrics differs by more than two standard errors, so every difference is not distinguishable from chance at this sample size (n = ${count(A.n)} and ${count(B.n)} games).`,
    });
  }

  // Largest VP source
  const big = s.largestVpSource;
  if (big && isNum(big.share) && big.source) {
    if (big.share >= 0.45) {
      out.push({ weight: 80, text: `${vpLabel(big.source)} supplies ${pct(big.share)} of all points (n = ${count(s.n)} ${setWords(A)}); no single source should exceed 45%.` });
    } else {
      out.push({ weight: 30, text: `The largest source of points is ${vpLabel(big.source)} at ${pct(big.share)} of all VP (n = ${count(s.n)} ${setWords(A)}), inside the 45% limit for any one source.` });
    }
  }

  // Never used
  const z = zeroUsage(A);
  if (z.total > 0) {
    const names = z.groups.flatMap((g) => g.zero.map((x) => x.id)).slice(0, 4).join(', ');
    out.push({ weight: 75, text: `${count(z.total)} items were never used in ${count(s.n)} games${z.total > 4 ? ` (for example ${names})` : ` (${names})`}. Zero use is first a question about the bot, not the rule.` });
  }

  // Closeness and pacing
  const hl = (id) => A.health.find((h) => h.id === id);
  const margin = hl('margin');
  if (margin && margin.status === 'warn' && isNum(margin.value)) {
    out.push({ weight: 60, text: `The winner finishes ${pctNum(margin.value)} of their own score ahead of second place on average (healthy range ${margin.healthy}%; n = ${count(s.n)} games), and ${pct(s.within10?.value)} of games finish within 10%.` });
  }
  const lead = hl('leadChanges');
  if (lead && lead.status === 'warn' && isNum(lead.value)) {
    out.push({ weight: 55, text: `The lead changes hands ${fixed(lead.value, 1)} times per game on average (healthy: ${lead.healthy}; n = ${count(s.n)} games).` });
  }
  const half = s.leaderAtHalf;
  if (half && isNum(half.sigma) && Math.abs(half.sigma) >= 2) {
    out.push({ weight: 58, text: `The player leading at half-time wins ${pct(half.value)} of games (fair share ${pct(half.fair)}); that is ${fixed(Math.abs(half.sigma), 1)} standard errors ${half.sigma > 0 ? 'above' : 'below'} fair (n = ${count(half.n)} games).` });
  }
  const fq = hl('finalQuarter');
  if (fq && fq.status === 'warn' && isNum(fq.value)) {
    out.push({ weight: 50, text: `Only ${pctNum(fq.value)} of points arrive in the last quarter plus end scoring (healthy: ${fq.healthy}%; n = ${count(s.n)} games).` });
  }
  const warns = A.health.filter((h) => h.status === 'warn').length;

  out.sort((a, b) => b.weight - a.weight);
  const picked = out.slice(0, 6);
  // Fallbacks so there are always at least three
  const fill = [];
  if (isNum(s.length?.mean)) fill.push(`Games last ${fixed(s.length.mean, 1)} turns per player on average (n = ${count(s.n)} ${setWords(A)}).`);
  if (isNum(s.winningScore?.mean)) fill.push(`The winner scores ${fixed(s.winningScore.mean, 1)} VP on average and an average player ${fixed(s.score?.mean, 1)} VP (n = ${count(s.n)} games).`);
  if (A.health.length) fill.push(`${warns} of ${A.health.filter((h) => h.status !== 'n/a').length} health checks show a warning (table below).`);
  for (const f of fill) if (picked.length < 3) picked.push({ weight: 0, text: f });
  if (!picked.length) picked.push({ weight: 0, text: 'This file holds too few finished games to say anything yet.' });
  return picked.map((p) => p.text);
}

export function isPctId(id) {
  return /^(winRate|margin\.within10|leaderAtHalf|completion|usage|vpShare|vp\.|turnLimit|end\.)/.test(id);
}
