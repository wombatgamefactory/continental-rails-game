// html.mjs - small HTML building blocks: tables, figures, badges, legends, metric spans.

import { esc, isNum, count, DASH } from './util.mjs';

/** An inline 14 px swatch (colour plus optional pattern), so legends match the chart fills. */
export function swatch(color, pattern) {
  return `<svg class="swsvg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style="flex:none"><rect x=".5" y=".5" width="13" height="13" rx="2" style="fill:${color};stroke:var(--axis)"/>${pattern ? `<rect x=".5" y=".5" width="13" height="13" rx="2" fill="url(#${pattern})"/>` : ''}</svg>`;
}

export function legend(items) {
  return `<div class="legend">${items.map((i) => `<span>${swatch(i.color, i.pattern)}${esc(i.label)}</span>`).join('')}</div>`;
}

export function basisWord(arm) {
  return arm.basis === 'counted' ? 'counted games' : 'all finished games (turn-limit included)';
}

/** The "which games, how many" line under a chart title; one entry per arm. */
export function badges(model, opts = {}) {
  const multi = model.arms.length > 1;
  const items = model.arms.map((a) => {
    const n = opts.n ? opts.n(a) : a.n;
    const unit = opts.unit ?? 'games';
    const small = isNum(n) && n < 10;
    return `<span class="badge">${multi ? swatch(a.color, a.pattern) : ''}${multi ? `<b>${esc(a.short)}</b>: ` : ''}${esc(opts.basis === false ? 'Games: ' : 'Games used: ' + basisWord(a) + ', ')}<span class="${small ? 'small-n' : ''}">n = ${count(n)} ${esc(unit)}</span></span>`;
  });
  return `<div class="badges">${items.join('')}</div>`;
}

export function smallWarning(model, opts = {}) {
  const bad = model.arms.filter((a) => {
    const n = opts.n ? opts.n(a) : a.n;
    return isNum(n) && n < 10;
  });
  if (!bad.length) return '';
  return `<div class="notice"><strong>Small sample.</strong> ${bad.map((a) => `${esc(a.short)} has only ${count(opts.n ? opts.n(a) : a.n)} ${esc(opts.unit ?? 'games')} behind this chart`).join('; ')}. Fewer than about 10 is too few to read: treat the chart as an illustration, not a finding.</div>`;
}

/**
 * A figure: a question as the title, one line on what is shown, the game-set badges, the
 * chart and a collapsible exact-figures table.
 */
export function fig(model, o) {
  return `<figure class="fig${o.half ? ' half' : ''}"><h3>${esc(o.title)}</h3>${o.sub ? `<p class="sub">${o.sub}</p>` : ''}${badges(model, o.badge)}${smallWarning(model, o.badge)}${o.legend ?? ''}${o.svg}${o.after ?? ''}${o.table ? `<details><summary>Exact figures</summary>${o.table}</details>` : ''}</figure>`;
}

/** Two half-width figures side by side (stacked on a narrow screen). */
export function pair(a, b) {
  return `<div class="grid2">${a}${b}</div>`;
}

/**
 * Table. headers: string[]; rows: (string|{html}|number|null)[][]; opts.flags: row index -> class.
 */
export function table(headers, rows, opts = {}) {
  const cell = (c) => (c && typeof c === 'object' && 'html' in c ? c.html : esc(c === null || c === undefined ? DASH : c));
  const head = `<tr>${headers.map((h) => `<th>${typeof h === 'object' ? h.html : esc(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr${opts.rowClass?.[i] ? ` class="${opts.rowClass[i]}"` : ''}>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('');
  return `<table>${opts.caption ? `<caption class="sub" style="text-align:left">${esc(opts.caption)}</caption>` : ''}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function armLabel(arm) {
  return { html: `<span class="badge">${swatch(arm.color, arm.pattern)}<b>${esc(arm.short)}</b></span>` };
}

/**
 * A printed figure that the tests can read back: data-metric (headline id), data-arm,
 * data-set (counted | all-finished), data-raw (the JSON value) and data-fmt (how it was rounded).
 */
export function metric(id, arm, raw, text, fmt) {
  const rawAttr = isNum(raw) ? ` data-raw="${raw}"` : '';
  return { html: `<span data-metric="${esc(id)}" data-arm="${esc(arm.key)}" data-set="${esc(arm.basis)}"${rawAttr} data-fmt="${esc(fmt)}">${esc(text)}</span>` };
}

export function pill(status) {
  if (status === 'pass') return { html: '<span class="pill pass">&#10003; Pass</span>' };
  if (status === 'warn') return { html: '<span class="pill warn">&#9888; Warn</span>' };
  return { html: '<span class="pill na">n/a</span>' };
}

export function section(id, title, intro, parts, notes = []) {
  const missing = notes.length ? `<div class="notice">${notes.map((n) => esc(n)).join('<br>')}</div>` : '';
  return `<section id="${esc(id)}"><h2>${esc(title)}</h2>${intro ? `<p class="sub">${intro}</p>` : ''}${parts.join('')}${missing}</section>`;
}
