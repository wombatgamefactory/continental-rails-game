// setup.js - the landing page: a sell sheet with the game's set-up panel in it.
//
// Order: hero, one-line hook, stat strip, "Play now" / "Watch a demo game",
// the set-up panel, then below the fold how a turn works (Collect, Build, Lay),
// what is distinctive, what this digital prototype holds, and the credits. The
// words live in COPY below so the designer can edit them in one place.
//
// The hero uses the real pictures the game already has. The manifest ids
// ui-hero and ui-logo are placeholders today; the day their status is "real"
// they take over the hero and the title with no change here (art.js decides).
// No placeholder picture is ever drawn on this page.
//
// Set-up: 2 to 4 seats, each a Human or a bot level (read from BOT_LEVELS, so a
// level registered in src/bots/index.js appears here with no change), a name, a
// colour (de-duplicated across seats), and under "Advanced" a seed and the seat
// order.
//
// Query string (so tests and the designer can start a configured game):
//   ?players=4&bots=random,random,random,random&seed=5&fast=1
//   ?bots=human,medium            per seat: "human" or a bot level id
//   ?names=Anna,Ben               seat names
//   ?variants=conversionRate=1:1,moduleLegislativeAgenda=false
//   ?speed=normal|fast|instant    (fast=1 is the same as speed=instant)
//   ?shuffle=0                    keep the seat order given
//   ?generic=1                    force the generic layer only
//   ?test=1                       expose window.__cr for tests
// A game starts straight away when `players` or `bots` is present (unless
// autostart=0).

import { BOT_LEVELS } from '../bots/index.js';
import { parseVariantValue, getVariantDef, VARIANTS } from '../engine/index.js';
import { PRESETS } from './presets.js';
import { renderVariantsPanel, checkVariants, tidy, variantsToQuery } from './variants-panel.js';
import { CONFIG } from './config.js';
import { art, realArt, isRealArt } from './art.js';

/**
 * Colours for the seats. Each is clear of the UI palette (parchment, brass,
 * engine green, signal red is darker and browner than Crimson) and of the three
 * terrain colours of the map (Ground green, Tunnel grey, Bridge blue): no green,
 * no blue, no mid grey is offered, so a claimed route can never be mistaken for
 * an unclaimed slot.
 */
export const PLAYER_COLOURS = [
  { id: 'crimson', name: 'Crimson', hex: '#c0392b' },
  { id: 'amber', name: 'Amber', hex: '#e07b00' },
  { id: 'violet', name: 'Violet', hex: '#8a3fb0' },
  { id: 'rose', name: 'Rose', hex: '#d6478f' },
  { id: 'charcoal', name: 'Charcoal', hex: '#2e2a27' },
  { id: 'gold', name: 'Gold', hex: '#e2b714' },
];

/** The form's own state (never stored in the DOM). */
const form = {
  playerCount: 2,
  seats: [
    { kind: 'human', name: 'Player 1', colour: PLAYER_COLOURS[0].hex },
    { kind: 'random', name: 'Player 2', colour: PLAYER_COLOURS[1].hex },
    { kind: 'human', name: 'Player 3', colour: PLAYER_COLOURS[2].hex },
    { kind: 'human', name: 'Player 4', colour: PLAYER_COLOURS[3].hex },
  ],
  seed: '',
  shuffle: true,
  /** Variant overrides chosen on the variants panel (or read from the address): { name: value }. Defaults are never stored. */
  variants: {},
  /** Whether the variants panel is expanded (kept here, not in the DOM). */
  variantsOpen: false,
  /** Whether the "Advanced" part of the set-up panel (seed, seat order) is open. */
  advancedOpen: false,
  error: null,
};

// A sensible default opponent: the strongest of the cheap levels that is registered.
{
  const preferred = ['medium', 'easy', 'random'].find((id) => BOT_LEVELS.some((l) => l.id === id)) ?? BOT_LEVELS[0].id;
  form.seats[1].kind = preferred;
}

export function getForm() {
  return form;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Display label for a seat kind: "Human" or "Random bot". */
export function seatLabel(kind) {
  if (kind === 'human') return 'Human';
  const level = BOT_LEVELS.find((l) => l.id === kind);
  return level ? `${level.name} bot` : `${kind} bot`;
}

/** Applies a parsed query string to the form. Returns the settings that are not part of the form. */
export function applyQuery(search) {
  const q = new URLSearchParams(search);
  const extras = { autostart: false, speed: null, generic: false, test: false, error: null };
  const players = q.get('players');
  const bots = q.get('bots');
  const names = q.get('names');
  if (players) form.playerCount = Math.max(2, Math.min(4, parseInt(players, 10) || 2));
  if (bots) {
    const list = bots.split(',').map((s) => s.trim().toLowerCase());
    if (!players && list.length >= 2 && list.length <= 4) form.playerCount = list.length;
    list.forEach((kind, i) => {
      if (i < 4) form.seats[i].kind = kind === 'human' || BOT_LEVELS.some((l) => l.id === kind) ? kind : 'human';
    });
  } else if (players) {
    // `players` alone: everyone human.
    for (let i = 0; i < form.playerCount; i++) form.seats[i].kind = 'human';
  }
  if (names) names.split(',').forEach((n, i) => { if (i < 4 && n.trim()) form.seats[i].name = n.trim(); });
  if (q.get('seed')) {
    form.seed = q.get('seed');
    form.advancedOpen = true;
  }
  if (q.get('shuffle') === '0') form.shuffle = false;
  const vq = q.get('variants');
  if (vq) {
    for (const part of vq.split(',')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const name = part.slice(0, eq).trim();
      const text = part.slice(eq + 1).trim();
      try {
        form.variants[name] = parseVariantValue(name, text);
        form.variantsOpen = true;
      } catch (err) {
        extras.error = err.message;
      }
    }
    form.variants = tidy(form.variants);
  }
  if (q.get('fast') === '1') extras.speed = 'instant';
  if (['normal', 'fast', 'instant'].includes(q.get('speed'))) extras.speed = q.get('speed');
  extras.generic = q.get('generic') === '1';
  extras.test = q.get('test') === '1';
  extras.autostart = (!!players || !!bots) && q.get('autostart') !== '0';
  return extras;
}

/** The seats and the engine config for the form as it stands. */
export function buildGame() {
  const seats = form.seats.slice(0, form.playerCount).map((s) => ({
    human: s.kind === 'human',
    level: s.kind === 'human' ? null : s.kind,
    label: seatLabel(s.kind),
    name: s.name.trim() || 'Player',
    colour: s.colour,
  }));
  let seed = String(form.seed).trim();
  if (seed === '') seed = String(Math.floor(Math.random() * 1000000));
  const config = {
    players: seats.map((s) => ({ name: s.name, colour: s.colour })),
    seed: /^-?\d+$/.test(seed) ? Number(seed) : seed,
    variants: { ...form.variants },
    shuffleSeats: form.shuffle,
  };
  return { config, seats };
}

/**
 * A four-bot game to watch, started in one click from the landing page. It does
 * not touch the form: the seats the visitor was setting up are still there when
 * they come back. The chosen rules variants are used when they are a legal set,
 * the defaults otherwise.
 */
export function buildDemoGame() {
  const level = ['medium', 'easy', 'random'].find((id) => BOT_LEVELS.some((l) => l.id === id)) ?? BOT_LEVELS[0].id;
  const seats = PLAYER_COLOURS.slice(0, 4).map((c) => ({ human: false, level, label: seatLabel(level), name: c.name, colour: c.hex }));
  const config = {
    players: seats.map((s) => ({ name: s.name, colour: s.colour })),
    seed: Math.floor(Math.random() * 1000000),
    variants: checkVariants(form.variants).ok ? { ...form.variants } : {},
    shuffleSeats: true,
  };
  return { config, seats, speed: DEMO_SPEED };
}

/** How fast the bots move in the demo game: quick enough to hold attention, slow enough to follow. */
const DEMO_SPEED = 'fast';

// ---------------------------------------------------------------------------
// The words. Everything a publisher reads on the landing page is here.
// ---------------------------------------------------------------------------

/** Manifest ids of the REAL pictures the page uses (ui-hero and ui-logo take over the hero when they become real). */
const PAGE_ART = {
  hero: 'illustration-train-engine',
  collect: 'district-gather-wood',
  build: 'district-ground-tracks',
  lay: 'district-lay-tracks',
};

export const COPY = {
  title: 'Continental Rails',
  kicker: '1869. The race to cross a continent.',
  hook: 'Build the train that builds the railroad, then race it across the continent.',
  intro:
    'Each turn you place or remove a single worker to gather Iron, Wood and Gunpowder, set the specialists aboard your train to work turning them into track, and lay that track across the map. There are no rounds and no waiting: one decision after another until the line is through.',
  weight: 'Heavyweight Euro',
  steps: [
    {
      id: 'collect',
      n: '1',
      title: 'Collect',
      text: 'Place one worker on the action grid, or take one back, and choose a district beside it. Gather districts pay out Iron, Wood, Gunpowder or Coins, and pay more for each of your other workers standing next to them.',
    },
    {
      id: 'build',
      n: '2',
      title: 'Build',
      text: 'Track districts set your train running: the Foreman and every specialist aboard turn resources into track tiles. Tiles are built on your train and wait in its storage. Nothing has reached the map yet.',
    },
    {
      id: 'lay',
      n: '3',
      title: 'Lay',
      text: 'Lay Tracks spends built tiles to claim a whole route between two cities, one tile for every Ground, Tunnel and Bridge slot. You can only lay what you have already built.',
    },
  ],
  stepsNote: 'Building and laying are two separate actions. Tiles are built on your train first, then laid on the map as whole routes.',
  distinctive: [
    ['One worker, every turn, no rounds.', 'Place a worker or take one back. There is no refresh phase and no passing, so the action grid never stops moving.'],
    ['Your train is your engine.', 'Hire specialists and couple on carriages; every activation then builds more. Each railway station you place takes a house off your player board and raises your production.'],
    ['Whole routes on a shared map.', 'A route is claimed in one go, by one player, for the rest of the game. Where you build your stations and where you cut a rival off matter as much as how fast you build.'],
    ['A race to complete the line.', 'The first player to join the west edge of the map to the east with their own routes takes the largest bonus in the game and brings it to a close.'],
  ],
  credits: {
    designer: 'Designed by Dean Morris',
    studio: 'Wombat Game Factory',
    status: 'Prototype - rules and art subject to change',
    copyright: '© 2026 Dean Morris. All rights reserved.',
  },
};

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const words = (n) => NUMBER_WORDS[n] ?? String(n);

/** What is in the digital prototype. Counted from the code, so the page cannot claim a level or a variant that is not there. */
function prototypeBullets() {
  const levels = BOT_LEVELS.map((l) => l.name).join(', ');
  return [
    ['Bots at ' + words(BOT_LEVELS.length) + ' levels.', `${levels}. Fill any seat with one, or all four and watch.`],
    ['Hot-seat for 2 to 4.', 'Any mix of people and bots on one device, with a hand-over screen between human turns.'],
    ['Switchable rule variants.', `${VARIANTS.length} rules can be changed from the set-up panel, including all four add-on modules, and the choice is kept in the address of the page.`],
    ['A problem-report button.', 'On every screen. It saves the exact position and the moves that led to it, so a fault can be replayed.'],
  ];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function colourOptions(current, others) {
  return PLAYER_COLOURS.map((c) => {
    const taken = others.includes(c.hex);
    return `<option value="${c.hex}" ${c.hex === current ? 'selected' : ''} ${taken ? 'disabled' : ''}>${c.name}${taken ? ' (taken)' : ''}</option>`;
  }).join('');
}

function seatRow(i) {
  const s = form.seats[i];
  const others = form.seats.slice(0, form.playerCount).filter((_, j) => j !== i).map((x) => x.colour);
  const level = BOT_LEVELS.find((l) => l.id === s.kind);
  const note = level ? level.description : 'Plays on this device. With two or more people, the game asks you to pass it on.';
  return `<div class="seat" data-seat="${i}" style="--pc:${s.colour}">
    <span class="seat__n"><span class="swatch" aria-hidden="true"></span>Seat ${i + 1}</span>
    <select class="seat__kind" data-setup="kind:${i}" aria-label="Seat ${i + 1} player type">
      <option value="human" ${s.kind === 'human' ? 'selected' : ''}>Human</option>
      ${BOT_LEVELS.map((l) => `<option value="${l.id}" ${s.kind === l.id ? 'selected' : ''}>${esc(l.name)} bot</option>`).join('')}
    </select>
    <input class="seat__name" type="text" data-setup="name:${i}" value="${esc(s.name)}" maxlength="20" aria-label="Seat ${i + 1} name">
    <select class="seat__colour" data-setup="colour:${i}" aria-label="Seat ${i + 1} colour">${colourOptions(s.colour, others)}</select>
    <span class="seat__note" data-field="seat-note">${esc(note)}</span>
  </div>`;
}

/** The stat strip. Play time and age appear only when the designer has filled them in (config.js); nothing is guessed. */
function statStrip() {
  const stats = [
    ['players', 'Players', '2 to 4'],
    ['weight', 'Weight', COPY.weight],
  ];
  if (String(CONFIG.PLAY_TIME).trim() !== '') stats.push(['time', 'Play time', String(CONFIG.PLAY_TIME).trim()]);
  if (String(CONFIG.AGE).trim() !== '') stats.push(['age', 'Age', String(CONFIG.AGE).trim()]);
  return `<dl class="stats" data-field="stat-strip">${stats
    .map(([id, label, value]) => `<div class="stat-box" data-stat="${id}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join('')}</dl>`;
}

function hero() {
  // A real ui-hero fills the whole hero; until then the engine illustration sits beside the words.
  const full = isRealArt('ui-hero');
  const picture = full ? art('ui-hero', { cls: 'hero__img', alt: '' }) : realArt(PAGE_ART.hero, { cls: 'hero__img', alt: 'A locomotive of 1869 crossing canyon country' });
  const title = isRealArt('ui-logo') ? art('ui-logo', { cls: 'hero__logo', alt: COPY.title }) : esc(COPY.title);
  return `<header class="hero${full ? ' hero--full' : ''}${picture ? '' : ' hero--plain'}" data-field="hero">
      ${picture ? `<div class="hero__art">${picture}</div>` : ''}
      <div class="hero__text">
        <p class="hero__kicker">${esc(COPY.kicker)}</p>
        <h1 class="hero__title">${title}</h1>
        <p class="hero__hook" data-field="hook">${esc(COPY.hook)}</p>
        ${statStrip()}
        <div class="hero__cta">
          <button type="button" class="btn btn--primary btn--big" data-setup="play">Play now</button>
          <button type="button" class="btn btn--ghost btn--big" data-setup="demo" title="Starts a game of four bots straight away. You can pause it, change its speed or leave it at any time.">Watch a demo game</button>
        </div>
      </div>
    </header>`;
}

function setupPanel() {
  const botRows = BOT_LEVELS.map((l) => `<li><b>${esc(l.name)}</b> ${esc(l.description)}</li>`).join('');
  return `<section class="setup__panel" id="setup-panel" aria-labelledby="setup-title">
      <div class="setup__head">
        <h2 id="setup-title">Set up a game</h2>
        <div class="setup__count" role="group" aria-label="Number of players">
          ${[2, 3, 4].map((n) => `<button type="button" class="btn${form.playerCount === n ? ' is-on' : ''}" data-setup="count:${n}" aria-pressed="${form.playerCount === n}">${n} players</button>`).join('')}
        </div>
      </div>
      <div class="seats" role="group" aria-label="Seats">${Array.from({ length: form.playerCount }, (_, i) => seatRow(i)).join('')}</div>
      <details class="setup__bots"><summary>What the bot levels do</summary><ul>${botRows}</ul></details>
      <div class="setup__adv">
        <button type="button" class="btn btn--small btn--quiet" data-setup="advanced-toggle" aria-expanded="${form.advancedOpen}" aria-controls="setup-advanced">${form.advancedOpen ? 'Hide advanced' : 'Advanced'}</button>
        <div id="setup-advanced" class="setup__row" ${form.advancedOpen ? '' : 'hidden'}>
          <label>Seed <input type="text" data-setup="seed" value="${esc(form.seed)}" placeholder="random" size="12" inputmode="text"></label>
          <label><input type="checkbox" data-setup="shuffle" ${form.shuffle ? 'checked' : ''}> Random seat order</label>
          <span class="setup__hint">The same seed and seats replay the same game.</span>
        </div>
      </div>
      ${renderVariantsPanel(form)}
      ${form.error ? `<p class="notice notice--refusal" role="alert" data-field="setup-error">${esc(form.error)}</p>` : ''}
      <div class="setup__go">${startButton()}<button type="button" class="btn btn--big" data-setup="demo">Watch a demo game</button></div>
    </section>`;
}

function howATurnWorks() {
  const cards = COPY.steps
    .map(
      (s) => `<li class="step" data-step="${s.id}">
        <div class="step__art">${realArt(PAGE_ART[s.id], { cls: 'step__img', alt: '', lazy: true })}</div>
        <div class="step__body"><h3><span class="step__n" aria-hidden="true">${s.n}</span>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>
      </li>`,
    )
    .join('');
  return `<section class="pitch pitch--steps" aria-labelledby="steps-title" data-field="loop">
      <h2 id="steps-title">How a turn works</h2>
      <ol class="steps">${cards}</ol>
      <p class="steps__note" data-field="build-lay-note">${esc(COPY.stepsNote)}</p>
    </section>`;
}

function bulletList(items) {
  return `<ul class="points">${items.map(([lead, rest]) => `<li><b>${esc(lead)}</b> ${esc(rest)}</li>`).join('')}</ul>`;
}

/** Renders the landing page into `root`. */
export function renderSetup(root) {
  root.innerHTML = `<div class="landing setup" data-screen="setup">
    ${hero()}
    <p class="landing__intro">${esc(COPY.intro)}</p>
    ${setupPanel()}
    ${howATurnWorks()}
    <div class="pitch__cols">
      <section class="pitch" aria-labelledby="why-title" data-field="distinctive"><h2 id="why-title">What makes it different</h2>${bulletList(COPY.distinctive)}</section>
      <section class="pitch" aria-labelledby="proto-title" data-field="prototype"><h2 id="proto-title">In this digital prototype</h2>${bulletList(prototypeBullets())}
        <p class="pitch__cta"><button type="button" class="btn btn--primary" data-setup="play">Set up a game</button> <button type="button" class="btn" data-setup="demo">Watch a demo game</button></p></section>
    </div>
    <footer class="credits" data-field="credits">
      <p class="credits__main"><b>${esc(COPY.credits.designer)}</b><span>${esc(COPY.credits.studio)}</span></p>
      <p class="credits__small">${esc(COPY.credits.status)}<br>${esc(COPY.credits.copyright)}</p>
    </footer>
  </div>`;
}

/** The Start button: disabled, with the engine's reason as its tooltip, while the chosen variants are not a legal set. */
function startButton() {
  const check = checkVariants(form.variants);
  if (check.ok) return '<button type="button" class="btn btn--primary btn--big" data-setup="start">Start game</button>';
  return `<button type="button" class="btn btn--primary btn--big" data-setup="start" disabled title="${esc(check.message)}">Start game</button><span class="setup__why">${esc(check.message)}</span>`;
}

/** Keeps the address of the page in step with the chosen variants (so a copy of it shares them). */
export function syncUrl() {
  try {
    const url = new URL(window.location.href);
    const q = variantsToQuery(form.variants);
    if (q) url.searchParams.set('variants', q);
    else url.searchParams.delete('variants');
    window.history.replaceState(null, '', url);
  } catch {
    // A page that may not change its own address still works; it just cannot be bookmarked.
  }
}

/**
 * Updates the validation messages, the "changed" marks, the summary and the
 * Reset and Start buttons IN PLACE. Used for a number box: redrawing the panel
 * while the player is typing (or on the blur that comes with their next click)
 * would lose the caret, or swallow the click on the button they were reaching for.
 */
function refreshStatus(root) {
  const check = checkVariants(form.variants);
  const top = root.querySelector('[data-field="variants-error"]');
  if (top) {
    top.textContent = check.ok ? '' : check.message;
    top.hidden = check.ok;
  }
  root.querySelectorAll('[data-variant-error]').forEach((el) => {
    const here = !check.ok && check.name === el.dataset.variantError;
    el.textContent = here ? check.message : '';
    const rowEl = el.closest('.vrow');
    if (rowEl) rowEl.classList.toggle('has-error', here);
  });
  root.querySelectorAll('.vrow[data-variant]').forEach((rowEl) => {
    const changed = rowEl.dataset.variant in form.variants;
    rowEl.classList.toggle('is-changed', changed);
    rowEl.dataset.changed = changed ? '1' : '0';
  });
  const count = Object.keys(form.variants).length;
  const summary = root.querySelector('[data-field="variants-summary"]');
  if (summary) summary.textContent = count === 0 ? 'Default rules' : `${count} changed from the defaults`;
  const reset = root.querySelector('[data-setup="variants-reset"]');
  if (reset) {
    reset.disabled = count === 0;
    if (count === 0) reset.title = 'Every variant is already at its default.';
    else reset.removeAttribute('title');
  }
  const go = root.querySelector('[data-setup="start"]');
  if (go) {
    go.disabled = !check.ok;
    if (check.ok) go.removeAttribute('title');
    else go.title = check.message;
  }
}

/**
 * Handles a click, change or input inside the setup screen. Returns 'start'
 * when the player pressed Start (main.js then builds the game), else null (the
 * screen was re-rendered, or only a status line was updated).
 * @param {string} [eventType] 'click' | 'change' | 'input'
 */
export function handleSetupEvent(root, target, eventType = 'click') {
  const el = target.closest('[data-setup]');
  if (!el) return null;
  const [action, arg] = el.dataset.setup.split(':');
  if (action === 'start') return eventType === 'click' && !el.disabled ? 'start' : null;
  if (action === 'demo') return eventType === 'click' ? 'demo' : null;
  if (action === 'play') {
    // "Play now": bring the set-up panel into view. Nothing in the form changes.
    const panel = root.querySelector('#setup-panel');
    if (panel && eventType === 'click') {
      const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      const first = panel.querySelector('button, select, input');
      if (first) first.focus({ preventScroll: true });
    }
    return null;
  }
  if (action === 'count') {
    form.playerCount = Number(arg);
  } else if (action === 'kind') {
    form.seats[Number(arg)].kind = el.value;
  } else if (action === 'name') {
    form.seats[Number(arg)].name = el.value;
    return null; // typing: do not re-render and lose the caret
  } else if (action === 'colour') {
    const i = Number(arg);
    const taken = form.seats.findIndex((s, j) => j !== i && j < form.playerCount && s.colour === el.value);
    if (taken >= 0) form.seats[taken].colour = form.seats[i].colour; // swap
    form.seats[i].colour = el.value;
  } else if (action === 'seed') {
    form.seed = el.value;
    return null;
  } else if (action === 'shuffle') {
    form.shuffle = el.checked;
    return null;
  } else if (action === 'variants-toggle') {
    form.variantsOpen = !form.variantsOpen;
  } else if (action === 'advanced-toggle') {
    form.advancedOpen = !form.advancedOpen;
  } else if (action === 'preset') {
    // A preset is chosen from the row that is always visible; it does not unfold the 25 switches.
    const preset = PRESETS.find((p) => p.id === arg);
    if (preset) form.variants = tidy(preset.variants);
    syncUrl();
  } else if (action === 'variants-reset') {
    form.variants = {};
    syncUrl();
  } else if (action === 'variant' || action === 'variantnum') {
    const def = getVariantDef(arg);
    if (!def) return null;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (action === 'variantnum') value = el.value.trim() !== '' && !Number.isNaN(Number(el.value)) ? Number(el.value) : el.value;
    else if (el.value === '__number__') value = typeof form.variants[def.name] === 'number' ? form.variants[def.name] : def.min;
    else value = def.values.find((v) => String(v) === el.value);
    if (value === undefined) return null;
    form.variants = tidy({ ...form.variants, [def.name]: value });
    syncUrl();
    if (action === 'variantnum') {
      refreshStatus(root);
      return null;
    }
  }
  form.error = null;
  renderSetup(root);
  return null;
}

export function setSetupError(message) {
  form.error = message;
}
