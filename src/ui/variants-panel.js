// variants-panel.js - the "Rules variants" panel, generated from the engine's
// VARIANTS table.
//
// NOTHING in this file (or anywhere in the UI, apart from the presets table in
// presets.js) names a variant. The panel is built by walking VARIANTS: one
// control per entry, chosen by the entry's `type` (switch for boolean, select
// for enum, number input for integer, select plus number input for
// enum-or-integer), with its description, its default marked, a changed row
// highlighted and the engine's own message under the control that caused an
// illegal value. A variant added to variants.js therefore appears here, in the
// header chips and in the URL with no change to the UI.
//
// Grouping: no group field exists in the table, so the rule is simple and
// generic. A "module switch" is any variant whose change alters
// activeModules() (found by asking the engine, not by name); those come first,
// then every other variant, alphabetically by name.

import { VARIANTS, resolveVariants, activeModules, defaultVariants, nonDefaultVariants } from '../engine/index.js';
import { PRESETS } from './presets.js';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * The name of a variant as a person reads it: the table's own `label` when it
 * has one, otherwise the camel-case name split into words ("conversionRate" ->
 * "Conversion Rate"), so a variant added without a label still reads sensibly.
 */
export function variantLabel(def) {
  if (typeof def.label === 'string' && def.label.trim() !== '') return def.label;
  const words = def.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as a person reads it: On/Off, "iron-in-all" -> "Iron in all", numbers as they are. */
export function valueLabel(def, value) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return String(value);
  const text = String(value).replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The definition of a variant by name (from the table). */
function defOf(name) {
  return VARIANTS.find((v) => v.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// Grouping (derived from the engine, not from names)
// ---------------------------------------------------------------------------

/** Whether changing this variant switches an add-on module on or off. Asked of activeModules(). */
function isModuleSwitch(def) {
  const base = defaultVariants();
  const before = JSON.stringify(activeModules(base));
  if (def.type !== 'boolean' && def.type !== 'enum') return false;
  return def.values.some((v) => {
    try {
      return JSON.stringify(activeModules({ ...base, [def.name]: v })) !== before;
    } catch {
      return false;
    }
  });
}

/** [{ id, title, defs }] module switches first, then the rest alphabetically. */
export function variantGroups() {
  const modules = VARIANTS.filter(isModuleSwitch);
  const rest = VARIANTS.filter((v) => !modules.includes(v)).sort((a, b) => a.name.localeCompare(b.name));
  return [
    { id: 'modules', title: 'Add-on modules', defs: modules },
    { id: 'rules', title: 'Rule details', defs: rest },
  ].filter((g) => g.defs.length > 0);
}

// ---------------------------------------------------------------------------
// Validation (by the engine)
// ---------------------------------------------------------------------------

/**
 * Asks the engine whether these overrides are a legal set.
 * @returns {{ ok: boolean, message: string|null, name: string|null }} `name` is the variant the message is about, when it names one.
 */
export function checkVariants(overrides) {
  try {
    resolveVariants(overrides);
    return { ok: true, message: null, name: null };
  } catch (err) {
    const m = /variant "([^"]+)"/.exec(err.message);
    return { ok: false, message: err.message, name: m && defOf(m[1]) && !/^Unknown/.test(err.message) ? m[1] : null };
  }
}

/** Overrides without the entries that equal the default (a value set back to default is no override). */
export function tidy(overrides) {
  const out = {};
  const defs = defaultVariants();
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in defs) || defs[name] !== value) out[name] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/** "name=value,name=value" for the overrides, or '' (the format `?variants=` already reads). */
export function variantsToQuery(overrides) {
  return Object.entries(tidy(overrides))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

// ---------------------------------------------------------------------------
// Chips (header, end screen)
// ---------------------------------------------------------------------------

/** One chip per non-default variant of a RESOLVED variants object, readable, with the description as the tooltip. */
export function variantChips(variants, cls = '') {
  const diffs = nonDefaultVariants(variants);
  const names = Object.keys(diffs);
  if (names.length === 0) return `<span class="chip chip--default ${cls}" data-field="variant-chips">Default rules</span>`;
  return `<span class="chips ${cls}" data-field="variant-chips">${names
    .map((name) => {
      const def = defOf(name);
      const label = def ? variantLabel(def) : name;
      const value = def ? valueLabel(def, diffs[name]) : String(diffs[name]);
      return `<span class="chip chip--changed" data-chip="${esc(name)}" title="${esc(def ? `${def.description}. Default: ${valueLabel(def, def.default)}.` : name)}">${esc(label)}: <b>${esc(value)}</b></span>`;
    })
    .join('')}</span>`;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function sameOverrides(a, b) {
  const x = tidy(a);
  const y = tidy(b);
  const kx = Object.keys(x).sort();
  const ky = Object.keys(y).sort();
  return kx.length === ky.length && kx.every((k, i) => k === ky[i] && x[k] === y[k]);
}

/** The id of the preset the overrides equal, or null. */
export function activePreset(overrides) {
  const found = PRESETS.find((p) => sameOverrides(p.variants, overrides));
  return found ? found.id : null;
}

function control(def, value, errorHere) {
  const id = `v-${def.name}`;
  const named = (def.type === 'enum' || def.type === 'boolean') ? def.values : def.type === 'enum-or-integer' ? def.values : [];
  const isNumber = (def.type === 'integer') || (def.type === 'enum-or-integer' && typeof value === 'number');
  if (def.type === 'boolean') {
    return `<label class="vswitch"><input type="checkbox" role="switch" id="${id}" data-setup="variant:${esc(def.name)}" ${value ? 'checked' : ''} aria-describedby="${id}-d"><span class="vswitch__track" aria-hidden="true"></span><span class="vswitch__text">${value ? 'On' : 'Off'}</span></label>`;
  }
  const options = named.map((v) => {
    const isDefault = v === def.default;
    const selected = !isNumber && v === value;
    return `<option value="${esc(String(v))}" ${selected ? 'selected' : ''}>${esc(valueLabel(def, v))}${isDefault ? ' (default)' : ''}</option>`;
  });
  if (def.type === 'enum-or-integer') {
    options.push(`<option value="__number__" ${isNumber ? 'selected' : ''}>A number (${def.min} to ${def.max})</option>`);
  }
  const num = `<input type="number" class="vnum" id="${id}-n" data-setup="variantnum:${esc(def.name)}" min="${def.min}" max="${def.max}" step="1" value="${isNumber ? esc(String(value)) : esc(String(def.type === 'integer' ? def.default : def.min))}" aria-label="${esc(variantLabel(def))}, a number from ${def.min} to ${def.max}" ${errorHere ? 'aria-invalid="true"' : ''}>`;
  if (def.type === 'integer') {
    return `${num}<span class="vrange">${def.min} to ${def.max}</span>`;
  }
  return `<select id="${id}" data-setup="variant:${esc(def.name)}" aria-describedby="${id}-d">${options.join('')}</select>${def.type === 'enum-or-integer' && isNumber ? num : ''}`;
}

function row(def, form, check) {
  const value = def.name in form.variants ? form.variants[def.name] : def.default;
  const changed = value !== def.default;
  const errorHere = !check.ok && check.name === def.name;
  return `<div class="vrow${changed ? ' is-changed' : ''}${errorHere ? ' has-error' : ''}" data-variant="${esc(def.name)}" data-changed="${changed ? 1 : 0}">
      <div class="vrow__head">
        <label class="vrow__label" for="v-${esc(def.name)}${def.type === 'integer' ? '-n' : ''}">${esc(variantLabel(def))}</label>
        <span class="vrow__flag">changed</span>
      </div>
      <div class="vrow__control">${control(def, value, errorHere)}</div>
      <div class="vrow__desc" id="v-${esc(def.name)}-d">${esc(def.description)}. <span class="vrow__default">Default: <b>${esc(valueLabel(def, def.default))}</b>.</span></div>
      <div class="vrow__error" role="alert" data-variant-error="${esc(def.name)}">${errorHere ? esc(check.message) : ''}</div>
    </div>`;
}

/**
 * The whole panel as HTML.
 * @param {{ variants: object, variantsOpen: boolean }} form the setup form (overrides only)
 */
export function renderVariantsPanel(form) {
  const check = checkVariants(form.variants);
  const changedCount = Object.keys(tidy(form.variants)).length;
  const current = activePreset(form.variants);
  const summary = changedCount === 0 ? 'Default rules' : `${changedCount} changed from the defaults`;
  const presets = PRESETS.map(
    (p) => `<button type="button" class="btn vpreset${current === p.id ? ' is-on' : ''}" data-setup="preset:${esc(p.id)}" aria-pressed="${current === p.id}" ><span class="btn__text"><span class="btn__label">${esc(p.label)}</span><span class="btn__sub">${esc(p.note)}</span></span></button>`,
  ).join('');
  const body = form.variantsOpen
    ? `<div class="vpanel__body">
        ${variantGroups()
          .map((g) => `<fieldset class="vgroup" data-group="${esc(g.id)}"><legend>${esc(g.title)}</legend>${g.defs.map((d) => row(d, form, check)).join('')}</fieldset>`)
          .join('')}
        <div class="vpanel__foot">
          <button type="button" class="btn btn--small" data-setup="variants-reset" ${changedCount === 0 ? 'disabled title="Every variant is already at its default."' : ''}>Reset to defaults</button>
          <span class="vpanel__hint">The chosen variants are kept in the address of this page, so a copy of the address shares the same rules.</span>
        </div>
      </div>`
    : '';
  return `<section class="vpanel" data-mount="variants-panel" id="variants-mount" aria-labelledby="variants-title">
      <div class="vpanel__head">
        <h3 id="variants-title">Rules variants</h3>
        <span class="vpanel__summary" data-field="variants-summary">${esc(summary)}</span>
        <button type="button" class="btn btn--small btn--quiet" data-setup="variants-toggle" aria-expanded="${form.variantsOpen ? 'true' : 'false'}" aria-controls="variants-body">${form.variantsOpen ? 'Hide all ' + VARIANTS.length + ' variants' : 'Show all ' + VARIANTS.length + ' variants'}</button>
      </div>
      <div class="vpresets" role="group" aria-label="Presets">${presets}</div>
      <div id="variants-body">${body}</div>
      <p class="notice notice--refusal vpanel__error" role="alert" data-field="variants-error" ${check.ok ? 'hidden' : ''}>${check.ok ? '' : esc(check.message)}</p>
    </section>`;
}
