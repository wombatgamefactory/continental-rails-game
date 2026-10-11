// stats.mjs - the small statistics the aggregates are built from.
//
// Every function is pure, takes plain arrays and numbers, and returns null (never
// NaN or Infinity) when the answer does not exist, so that the JSON output holds
// no `null`-from-NaN surprises. The aggregate tests push synthetic input through
// these and through aggregate.mjs, so the arithmetic is tested where it lives.

/** Sum of an array of numbers. */
export function sum(xs) {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

/** Arithmetic mean, or null for an empty list. */
export function mean(xs) {
  return xs.length === 0 ? null : sum(xs) / xs.length;
}

/** Sample standard deviation (n - 1), or null with fewer than 2 values. */
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = sum(xs) / xs.length;
  let ss = 0;
  for (let i = 0; i < xs.length; i++) ss += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Median (mean of the middle two for an even count), or null for an empty list. */
export function median(xs) {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** { n, mean, median, sd, min, max, se } of a list; every field null when it does not exist. `se` is sd / sqrt(n). */
export function describe(xs) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: null, median: null, sd: null, se: null, min: null, max: null };
  let min = xs[0];
  let max = xs[0];
  for (let i = 1; i < n; i++) {
    if (xs[i] < min) min = xs[i];
    if (xs[i] > max) max = xs[i];
  }
  const s = sd(xs);
  return { n, mean: mean(xs), median: median(xs), sd: s, se: s === null ? null : s / Math.sqrt(n), min, max };
}

/**
 * Standard error of a proportion, sqrt(p(1-p)/n). `p` may be a fraction of wins
 * with ties split. Null for n = 0.
 */
export function proportionSe(p, n) {
  if (!(n > 0) || p === null) return null;
  return Math.sqrt((p * (1 - p)) / n);
}

/**
 * Sigma of a proportion from a fair share: (p - fair) / sqrt(fair(1-fair)/n).
 * The denominator is the standard error UNDER the fair-share hypothesis, so the
 * figure is defined when p is 0 or 1 and means "how surprising is this if the
 * seat were fair". Null for n = 0.
 */
export function sigmaFromFair(p, fair, n) {
  if (!(n > 0) || p === null || !(fair > 0) || !(fair < 1)) return null;
  const se = Math.sqrt((fair * (1 - fair)) / n);
  return (p - fair) / se;
}

/**
 * Ratio estimator with its standard error. `xs[i]` and `ys[i]` are the numerator
 * and denominator of game i; the ratio is sum(x)/sum(y) (a pooled share, for
 * example VP from one source over all VP). The error is the linearised
 * (delta-method) error of a ratio of means over n games:
 *   se = sqrt( sum((x - R*y)^2) / (n - 1) ) / (sqrt(n) * mean(y)).
 * Returns { value, se } with null fields when undefined.
 */
export function ratio(xs, ys) {
  const n = xs.length;
  const sy = sum(ys);
  if (n === 0 || sy === 0) return { value: null, se: null };
  const r = sum(xs) / sy;
  if (n < 2) return { value: r, se: null };
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - r * ys[i];
    ss += d * d;
  }
  return { value: r, se: Math.sqrt(ss / (n - 1)) / (Math.sqrt(n) * (sy / n)) };
}

/** Rounds to `places` decimals (for output only); leaves integers and non-numbers alone. */
export function round(x, places = 6) {
  if (typeof x !== 'number' || !Number.isFinite(x) || Number.isInteger(x)) return x;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/** A copy of an object with its keys in sorted order (so output is byte-stable). */
export function sortedKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}
