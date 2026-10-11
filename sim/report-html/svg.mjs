// svg.mjs - the chart primitives. Each function returns one inline <svg> string.
//
// Text is real SVG text (never an image of text). Colours come from CSS custom properties
// (var(--arm0) ...), so the same markup is right in light mode, dark mode and print.
// Series after the first carry a hatch overlay, so the arms differ by pattern as well as
// by hue (colour-blind safe, and still distinct in a greyscale print).
//
// A series is { name, color: 'var(--arm0)', pattern: null | 'p-hatch' }.

import { esc, isNum, DASH } from './util.mjs';

const f1 = (x) => (Math.round(x * 10) / 10).toString();
const r1 = (x) => Math.round(x * 10) / 10;

export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
}

/** { max, ticks[] } for an axis from 0 to at least `top`. */
export function niceAxis(top, count = 5) {
  const step = niceStep((top > 0 ? top : 1) / count);
  const n = Math.max(1, Math.ceil(top / step - 1e-9));
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
  return { max: ticks[ticks.length - 1], ticks };
}

/** Axis from `lo` to `hi` (either may be negative). */
export function niceAxisRange(lo, hi, count = 6) {
  const span = Math.max(hi - lo, 1e-9);
  const step = niceStep(span / count);
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return { min: a, max: b, ticks };
}

export function wrapLabel(text, maxChars, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines - 1);
    keep.push(lines.slice(maxLines - 1).join(' '));
    return keep;
  }
  return lines.length ? lines : [''];
}

function textLines(x, y, lines, attrs = '', lh = 12.5) {
  return `<text x="${r1(x)}" y="${r1(y)}" ${attrs}>${lines.map((l, i) => `<tspan x="${r1(x)}" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join('')}</text>`;
}

function open(W, H, label) {
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
}

function bar(x, y, w, h, s, tip) {
  if (!(w > 0) || !(h > 0)) return '';
  const base = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" style="fill:${s.color}"/>`;
  const pat = s.pattern ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="url(#${s.pattern})"/>` : '';
  const outline = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" style="stroke:${s.edge ?? s.color}" stroke-width="${s.edge ? 1.5 : 1}"/>`;
  return `<g>${tip ? `<title>${esc(tip)}</title>` : ''}${base}${pat}${outline}</g>`;
}

// ---------------------------------------------------------------------------
// Vertical grouped bars (with optional error bars, reference line, healthy band)
// ---------------------------------------------------------------------------

/**
 * @param o.categories  string[]
 * @param o.series      [{ name, color, pattern, values: (number|null)[], ses?: (number|null)[], tips?: string[] }]
 * @param o.yFmt        axis tick formatter; o.valueFmt label formatter
 * @param o.ref         { v, label }   dashed reference line (for example the fair share)
 * @param o.band        { from, to, label }  shaded healthy range
 * @param o.errMult     error bar half-length in standard errors (default 2)
 */
export function barV(o) {
  const W = o.width ?? 880;
  const H = o.height ?? 320;
  const nCat = o.categories.length;
  const nSer = o.series.length;
  const m = { l: 62, r: o.ref ? 96 : 16, t: o.band ? 26 : 20, b: 28 + (o.xLabel ? 18 : 0) };
  const catW = (W - m.l - m.r) / Math.max(1, nCat);
  // label lines depend on width
  const maxChars = Math.max(6, Math.floor(catW / 6.3));
  const labelLines = o.categories.map((c, i) => (o.labelEvery && i % o.labelEvery !== 0 ? [''] : wrapLabel(c, maxChars, 3)));
  const extra = Math.max(...labelLines.map((l) => l.length), 1) - 1;
  m.b += extra * 12.5;
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const mult = o.errMult ?? 2;

  let top = 0;
  for (const s of o.series) {
    s.values.forEach((v, i) => {
      if (!isNum(v)) return;
      const se = s.ses?.[i];
      top = Math.max(top, v + (isNum(se) ? mult * se : 0));
    });
  }
  if (o.ref && isNum(o.ref.v)) top = Math.max(top, o.ref.v);
  if (o.band && isNum(o.band.to)) top = Math.max(top, o.band.to);
  const ax = niceAxis(o.yMax ?? top * 1.12, o.yTicks ?? 5);
  const yMax = o.yMax ?? ax.max;
  const Y = (v) => m.t + ph - (Math.max(0, Math.min(v, yMax)) / yMax) * ph;

  let out = open(W, H, o.label);
  for (const t of ax.ticks) {
    if (t > yMax + 1e-9) continue;
    out += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${r1(Y(t))}" y2="${r1(Y(t))}"/>`;
    out += `<text class="ax" x="${m.l - 6}" y="${r1(Y(t) + 4)}" text-anchor="end">${esc((o.yFmt ?? f1)(t))}</text>`;
  }
  if (o.band && isNum(o.band.from)) {
    const a = Y(o.band.from);
    const b = Y(isNum(o.band.to) ? o.band.to : yMax);
    out += `<rect class="band" x="${m.l}" y="${r1(Math.min(a, b))}" width="${pw}" height="${r1(Math.abs(a - b))}"><title>${esc(o.band.label)}</title></rect>`;
    out += `<text class="m" x="${W - m.r - 4}" y="${r1(Math.min(a, b) + 12)}" text-anchor="end">${esc(o.band.label)}</text>`;
  }
  out += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${r1(Y(0))}" y2="${r1(Y(0))}"/>`;
  out += `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${r1(Y(0))}"/>`;

  const pad = o.groupPad ?? 0.2;
  const inner = catW * (1 - pad);
  const bw = inner / nSer;
  const labelFits = bw >= (o.valueFmt ? 30 : 24);
  const showVals = o.showValues ?? labelFits;
  o.categories.forEach((c, ci) => {
    const gx = m.l + ci * catW + (catW - inner) / 2;
    o.series.forEach((s, si) => {
      const v = s.values[ci];
      const x = gx + si * bw;
      if (!isNum(v)) {
        out += `<text class="ax" x="${r1(x + bw / 2)}" y="${r1(Y(0) - 4)}" text-anchor="middle">${DASH}</text>`;
        return;
      }
      const y = Y(v);
      out += bar(x + (nSer > 1 ? 1 : 0), y, bw - (nSer > 1 ? 2 : 0), Y(0) - y, s, s.tips?.[ci] ?? `${s.name}: ${(o.valueFmt ?? o.yFmt ?? f1)(v)}`);
      const se = s.ses?.[ci];
      let labelTop = y;
      if (isNum(se) && se > 0) {
        const lo = Y(Math.max(0, v - mult * se));
        const hi = Y(v + mult * se);
        const cx = x + bw / 2;
        out += `<g><line class="err" x1="${r1(cx)}" x2="${r1(cx)}" y1="${r1(hi)}" y2="${r1(lo)}"/><line class="err" x1="${r1(cx - 4)}" x2="${r1(cx + 4)}" y1="${r1(hi)}" y2="${r1(hi)}"/><line class="err" x1="${r1(cx - 4)}" x2="${r1(cx + 4)}" y1="${r1(lo)}" y2="${r1(lo)}"/></g>`;
        labelTop = Math.min(labelTop, hi);
      }
      if (showVals) out += `<text class="val" x="${r1(x + bw / 2)}" y="${r1(labelTop - 4)}" text-anchor="middle">${esc((o.valueFmt ?? o.yFmt ?? f1)(v))}</text>`;
    });
    if (labelLines[ci].join('')) out += textLines(m.l + ci * catW + catW / 2, Y(0) + 15, labelLines[ci], 'class="ax" text-anchor="middle"', 12.5);
  });
  if (o.ref && isNum(o.ref.v)) {
    out += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${r1(Y(o.ref.v))}" y2="${r1(Y(o.ref.v))}"/>`;
    out += textLines(W - m.r + 6, Y(o.ref.v) - 3, wrapLabel(o.ref.label, 14, 3), 'class="ax" style="fill:var(--ink)"', 12);
  }
  if (o.yLabel) out += `<text class="ttl" transform="translate(13 ${r1(m.t + ph / 2)}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
  if (o.xLabel) out += `<text class="ttl" x="${r1(m.l + pw / 2)}" y="${H - 5}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  return out + '</svg>';
}

// ---------------------------------------------------------------------------
// Horizontal grouped bars
// ---------------------------------------------------------------------------

/**
 * @param o.rows    [{ label, values: [{ v, se, tip } | null] }]  one value per series
 * @param o.series  [{ name, color, pattern }]
 */
export function barH(o) {
  const W = o.width ?? 880;
  const nSer = o.series.length;
  const longest = Math.max(...o.rows.map((r) => String(r.label).length), 6);
  const left = Math.min(o.maxLabel ?? 300, Math.max(110, longest * 6.1 + 14));
  const maxChars = Math.floor((left - 10) / 6.1);
  const barH_ = o.barHeight ?? 13;
  const lines = o.rows.map((r) => wrapLabel(r.label, maxChars, 3));
  const rowHeights = o.rows.map((r, i) => Math.max(nSer * barH_ + 8, lines[i].length * 12.5 + 8));
  const m = { l: left, r: 56, t: o.ref ? 24 : 12, b: 30 + (o.xLabel ? 18 : 0) };
  const H = m.t + m.b + rowHeights.reduce((a, b) => a + b, 0);
  const pw = W - m.l - m.r;
  const mult = o.errMult ?? 2;
  let top = 0;
  o.rows.forEach((r) =>
    r.values.forEach((c) => {
      if (c && isNum(c.v)) top = Math.max(top, c.v + (isNum(c.se) ? mult * c.se : 0));
    }),
  );
  if (o.ref && isNum(o.ref.v)) top = Math.max(top, o.ref.v);
  const ax = niceAxis(o.xMax ?? top * 1.1, o.xTicks ?? 5);
  const xMax = o.xMax ?? ax.max;
  const X = (v) => m.l + (Math.max(0, Math.min(v, xMax)) / xMax) * pw;

  let out = open(W, H, o.label);
  for (const t of ax.ticks) {
    if (t > xMax + 1e-9) continue;
    out += `<line class="grid" x1="${r1(X(t))}" x2="${r1(X(t))}" y1="${m.t}" y2="${H - m.b}"/>`;
    out += `<text class="ax" x="${r1(X(t))}" y="${H - m.b + 14}" text-anchor="middle">${esc((o.xFmt ?? f1)(t))}</text>`;
  }
  out += `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
  let y = m.t;
  o.rows.forEach((r, ri) => {
    const rh = rowHeights[ri];
    const startY = y + (rh - nSer * barH_) / 2;
    if (ri % 2 === 1) out += `<rect x="0" y="${r1(y)}" width="${W}" height="${r1(rh)}" fill="var(--grid)" opacity=".35"/>`;
    out += textLines(m.l - 8, y + rh / 2 - (lines[ri].length - 1) * 6.25 + 4, lines[ri], 'class="ax" style="fill:var(--ink)" text-anchor="end"', 12.5);
    r.values.forEach((c, si) => {
      const by = startY + si * barH_;
      const s = o.series[si];
      if (!c || !isNum(c.v)) {
        out += `<text class="ax" x="${m.l + 6}" y="${r1(by + barH_ - 2)}">${DASH}</text>`;
        return;
      }
      out += bar(m.l, by + 1, X(c.v) - m.l, barH_ - 2, s, c.tip ?? `${s.name}: ${(o.valueFmt ?? o.xFmt ?? f1)(c.v)}`);
      let endX = X(c.v);
      if (isNum(c.se) && c.se > 0) {
        const lo = X(Math.max(0, c.v - mult * c.se));
        const hi = X(c.v + mult * c.se);
        const cy = by + barH_ / 2;
        out += `<g><line class="err" x1="${r1(lo)}" x2="${r1(hi)}" y1="${r1(cy)}" y2="${r1(cy)}"/><line class="err" x1="${r1(lo)}" x2="${r1(lo)}" y1="${r1(cy - 3.5)}" y2="${r1(cy + 3.5)}"/><line class="err" x1="${r1(hi)}" x2="${r1(hi)}" y1="${r1(cy - 3.5)}" y2="${r1(cy + 3.5)}"/></g>`;
        endX = Math.max(endX, hi);
      }
      if (o.showValues !== false) out += `<text class="val" x="${r1(endX + 5)}" y="${r1(by + barH_ - 2.5)}">${esc((o.valueFmt ?? o.xFmt ?? f1)(c.v))}</text>`;
    });
    y += rh;
  });
  if (o.ref && isNum(o.ref.v)) {
    out += `<line class="ref" x1="${r1(X(o.ref.v))}" x2="${r1(X(o.ref.v))}" y1="${m.t - 4}" y2="${H - m.b}"/>`;
    out += `<text class="val" x="${r1(X(o.ref.v) + 4)}" y="${m.t - 7}">${esc(o.ref.label)}</text>`;
  }
  if (o.xLabel) out += `<text class="ttl" x="${r1(m.l + pw / 2)}" y="${H - 5}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  return out + '</svg>';
}

// ---------------------------------------------------------------------------
// Stacked horizontal bars (shares of a whole)
// ---------------------------------------------------------------------------

/**
 * @param o.rows  [{ label, parts: [{ key, value (fraction), label, color, pattern, tip }] }]
 */
export function stackedH(o) {
  const W = o.width ?? 880;
  const longest = Math.max(...o.rows.map((r) => String(r.label).length), 6);
  const left = Math.min(220, Math.max(100, longest * 6.1 + 12));
  const rowH = o.rowHeight ?? 34;
  const m = { l: left, r: 16, t: 10, b: 34 + (o.xLabel ? 16 : 0) };
  const H = m.t + m.b + o.rows.length * rowH;
  const pw = W - m.l - m.r;
  const X = (v) => m.l + v * pw;
  let out = open(W, H, o.label);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    out += `<line class="grid" x1="${r1(X(t))}" x2="${r1(X(t))}" y1="${m.t}" y2="${H - m.b}"/>`;
    out += `<text class="ax" x="${r1(X(t))}" y="${H - m.b + 14}" text-anchor="middle">${Math.round(t * 100)}%</text>`;
  }
  o.rows.forEach((r, ri) => {
    const y = m.t + ri * rowH;
    out += textLines(m.l - 8, y + rowH / 2 + 4 - (wrapLabel(r.label, Math.floor((left - 10) / 6.1), 2).length - 1) * 6.25, wrapLabel(r.label, Math.floor((left - 10) / 6.1), 2), 'class="ax" style="fill:var(--ink)" text-anchor="end"', 12.5);
    let acc = 0;
    for (const p of r.parts) {
      const v = isNum(p.value) && p.value > 0 ? p.value : 0;
      if (v <= 0) continue;
      const w = v * pw;
      out += bar(X(acc), y + 3, w, rowH - 6, p, p.tip ?? `${p.label}: ${(v * 100).toFixed(1)}%`);
      if (w >= 34) out += `<text class="seg" x="${r1(X(acc) + w / 2)}" y="${r1(y + rowH / 2 + 4)}" text-anchor="middle">${(v * 100).toFixed(v >= 0.095 ? 0 : 1)}%</text>`;
      acc += v;
    }
  });
  if (o.xLabel) out += `<text class="ttl" x="${r1(m.l + pw / 2)}" y="${H - 5}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  return out + '</svg>';
}

// ---------------------------------------------------------------------------
// Range plot: min-max line, mean +/- 2 SE bar, mean dot, median tick
// ---------------------------------------------------------------------------

/** @param o.rows [{ label, color, pattern, mean, se, median, min, max, tip }] */
export function rangeH(o) {
  const W = o.width ?? 880;
  const longest = Math.max(...o.rows.map((r) => String(r.label).length), 6);
  const left = Math.min(300, Math.max(110, longest * 6.1 + 14));
  const rowH = 30;
  const m = { l: left, r: 40, t: o.band ? 24 : 12, b: 32 + (o.xLabel ? 16 : 0) };
  const H = m.t + m.b + o.rows.length * rowH;
  const pw = W - m.l - m.r;
  let lo = 0;
  let hi = 0;
  for (const r of o.rows) {
    if (isNum(r.max)) hi = Math.max(hi, r.max);
    if (isNum(r.mean)) hi = Math.max(hi, r.mean + (isNum(r.se) ? 2 * r.se : 0));
    if (isNum(r.min)) lo = Math.min(lo, r.min);
  }
  if (o.band) {
    hi = Math.max(hi, o.band.to ?? 0, o.band.from ?? 0);
  }
  const ax = niceAxisRange(lo, hi * 1.04, 6);
  const X = (v) => m.l + ((v - ax.min) / (ax.max - ax.min || 1)) * pw;
  let out = open(W, H, o.label);
  for (const t of ax.ticks) {
    out += `<line class="grid" x1="${r1(X(t))}" x2="${r1(X(t))}" y1="${m.t}" y2="${H - m.b}"/>`;
    out += `<text class="ax" x="${r1(X(t))}" y="${H - m.b + 14}" text-anchor="middle">${esc((o.xFmt ?? f1)(t))}</text>`;
  }
  if (o.band) {
    const a = X(o.band.from ?? ax.min);
    const b = X(o.band.to ?? ax.max);
    out += `<rect class="band" x="${r1(Math.min(a, b))}" y="${m.t}" width="${r1(Math.abs(b - a))}" height="${H - m.b - m.t}"><title>${esc(o.band.label)}</title></rect>`;
    out += `<text class="m" x="${r1(Math.min(a, b) + 4)}" y="${m.t - 8}">${esc(o.band.label)}</text>`;
  }
  out += `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
  o.rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    out += textLines(m.l - 8, cy + 4 - (wrapLabel(r.label, Math.floor((left - 10) / 6.1), 2).length - 1) * 6.25, wrapLabel(r.label, Math.floor((left - 10) / 6.1), 2), 'class="ax" style="fill:var(--ink)" text-anchor="end"', 12.5);
    if (!isNum(r.mean)) {
      out += `<text class="ax" x="${m.l + 6}" y="${r1(cy + 4)}">${DASH}</text>`;
      return;
    }
    const tip = r.tip ?? `${r.label}: mean ${(o.xFmt ?? f1)(r.mean)}`;
    out += `<g><title>${esc(tip)}</title>`;
    if (isNum(r.min) && isNum(r.max)) out += `<line style="stroke:${r.color}" stroke-width="2" opacity=".55" x1="${r1(X(r.min))}" x2="${r1(X(r.max))}" y1="${r1(cy)}" y2="${r1(cy)}"/><line style="stroke:${r.color}" stroke-width="2" x1="${r1(X(r.min))}" x2="${r1(X(r.min))}" y1="${r1(cy - 5)}" y2="${r1(cy + 5)}"/><line style="stroke:${r.color}" stroke-width="2" x1="${r1(X(r.max))}" x2="${r1(X(r.max))}" y1="${r1(cy - 5)}" y2="${r1(cy + 5)}"/>`;
    if (isNum(r.se) && r.se > 0) out += bar(X(r.mean - 2 * r.se), cy - 5, X(r.mean + 2 * r.se) - X(r.mean - 2 * r.se), 10, r);
    if (isNum(r.median)) out += `<line stroke="var(--ink)" stroke-width="2" x1="${r1(X(r.median))}" x2="${r1(X(r.median))}" y1="${r1(cy - 9)}" y2="${r1(cy + 9)}"/>`;
    out += `<circle cx="${r1(X(r.mean))}" cy="${r1(cy)}" r="5" style="fill:${r.color};stroke:var(--ink)" stroke-width="1.5"/></g>`;
    out += `<text class="val" x="${r1(X(r.mean))}" y="${r1(cy - 10)}" text-anchor="middle">${esc((o.xFmt ?? f1)(r.mean))}</text>`;
  });
  if (o.xLabel) out += `<text class="ttl" x="${r1(m.l + pw / 2)}" y="${H - 5}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  return out + '</svg>';
}

// ---------------------------------------------------------------------------
// Difference plot: a difference with its 2 SE interval around a zero line
// ---------------------------------------------------------------------------

/**
 * @param o.rows   [{ label, cells: [{ d, lo, hi, small, tip, note } | null] }]
 * @param o.series [{ name, color, pattern }]
 */
export function diffH(o) {
  const W = o.width ?? 880;
  const nSer = o.series.length;
  const longest = Math.max(...o.rows.map((r) => String(r.label).length), 6);
  const left = Math.min(300, Math.max(120, longest * 6.1 + 14));
  const rowH = nSer * 13 + 8;
  const m = { l: left, r: 200, t: 22, b: 34 + (o.xLabel ? 16 : 0) };
  const H = m.t + m.b + o.rows.length * rowH;
  const pw = W - m.l - m.r;
  let lo = 0;
  let hi = 0;
  for (const r of o.rows) for (const c of r.cells) if (c) { lo = Math.min(lo, c.lo); hi = Math.max(hi, c.hi); }
  const ax = niceAxisRange(lo, hi, 6);
  const X = (v) => m.l + ((v - ax.min) / (ax.max - ax.min || 1)) * pw;
  let out = open(W, H, o.label);
  for (const t of ax.ticks) {
    out += `<line class="grid" x1="${r1(X(t))}" x2="${r1(X(t))}" y1="${m.t}" y2="${H - m.b}"/>`;
    out += `<text class="ax" x="${r1(X(t))}" y="${H - m.b + 14}" text-anchor="middle">${esc((o.xFmt ?? f1)(t))}</text>`;
  }
  out += `<line class="ref" x1="${r1(X(0))}" x2="${r1(X(0))}" y1="${m.t - 4}" y2="${H - m.b}"/>`;
  out += `<text class="m" x="${r1(X(0))}" y="${m.t - 8}" text-anchor="middle">no difference</text>`;
  out += `<text class="m" x="${W - m.r + 10}" y="${m.t - 8}">players with / without</text>`;
  o.rows.forEach((r, ri) => {
    const y = m.t + ri * rowH;
    if (ri % 2 === 1) out += `<rect x="0" y="${r1(y)}" width="${W}" height="${rowH}" fill="var(--grid)" opacity=".35"/>`;
    out += `<text class="ax" style="fill:var(--ink)" x="${m.l - 8}" y="${r1(y + rowH / 2 + 4)}" text-anchor="end">${esc(r.label)}</text>`;
    r.cells.forEach((c, si) => {
      const cy = y + 4 + si * 13 + 6.5;
      const s = o.series[si];
      if (!c) return;
      const cls = c.small ? ' opacity=".4"' : '';
      out += `<g${cls}><title>${esc(c.tip ?? '')}</title><line class="err" x1="${r1(X(c.lo))}" x2="${r1(X(c.hi))}" y1="${r1(cy)}" y2="${r1(cy)}"/><line class="err" x1="${r1(X(c.lo))}" x2="${r1(X(c.lo))}" y1="${r1(cy - 3.5)}" y2="${r1(cy + 3.5)}"/><line class="err" x1="${r1(X(c.hi))}" x2="${r1(X(c.hi))}" y1="${r1(cy - 3.5)}" y2="${r1(cy + 3.5)}"/><circle cx="${r1(X(c.d))}" cy="${r1(cy)}" r="4.2" style="fill:${s.color};stroke:var(--ink)" stroke-width="1.2"/>${s.pattern ? `<circle cx="${r1(X(c.d))}" cy="${r1(cy)}" r="3.2" fill="url(#${s.pattern})"/>` : ''}</g>`;
      if (c.note) out += `<text class="ax" x="${W - m.r + 10}" y="${r1(cy + 4)}"${c.small ? ' opacity=".7"' : ''}>${esc(c.note)}</text>`;
    });
  });
  if (o.xLabel) out += `<text class="ttl" x="${r1(m.l + pw / 2)}" y="${H - 5}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  return out + '</svg>';
}
