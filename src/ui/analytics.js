// analytics.js - a tiny track(event, params), wired at the page's choke points.
//
// Inert by default: while CONFIG.GA4_MEASUREMENT_ID is empty, track() returns
// at once. No script tag is added and no request of any kind is made. When the
// designer fills the id in, the first call injects the gtag script (once) and
// events are forwarded to it.
//
// What is sent: event names and short enumerated values (an action TYPE, a bot
// level, a variant NAME, counts, scores). Never a player name, a seed, a
// free-text field or a bug report.
//
// track() never throws: analytics must not be able to cost anybody a turn.
//
// Test hook: setSink(fn) sends the cleaned events to fn instead of gtag, so the
// test suite can see them without a network call (only with ?test=1).

import { CONFIG } from './config.js';

let injected = false;
let sink = null;

/** Per-game sampling state for action_taken (a bot game must not send thousands). */
const sampling = { human: 0, bot: 0, botSeen: 0 };

/** Policy for action_taken: every human action up to HUMAN_CAP, one bot action in BOT_EVERY up to BOT_CAP. */
export const SAMPLING = { HUMAN_CAP: 300, BOT_EVERY: 25, BOT_CAP: 60 };

/** Sends events to `fn(event, params)` instead of gtag (tests). Pass null to go back. */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

/** Whether analytics is switched on (an id is configured). */
export function analyticsOn() {
  return typeof CONFIG.GA4_MEASUREMENT_ID === 'string' && CONFIG.GA4_MEASUREMENT_ID.trim() !== '';
}

/** Only simple values, short strings: no free text can slip through. */
function clean(params) {
  const out = {};
  if (params === null || typeof params !== 'object') return out;
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = v.slice(0, 100);
    else if (Array.isArray(v)) out[key] = v.map((x) => String(x)).join(',').slice(0, 100);
  }
  return out;
}

function inject(id) {
  if (injected) return true;
  if (typeof document === 'undefined') return false;
  if (!/^G-[A-Z0-9]{4,}$/i.test(id)) return false;
  injected = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments); // gtag.js reads the `arguments` object itself, not an array
  };
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  return true;
}

/**
 * Records one event. Returns true when it was forwarded (or sunk), false when
 * analytics is off or anything went wrong.
 */
export function track(event, params = {}) {
  try {
    if (!analyticsOn()) return false;
    const id = CONFIG.GA4_MEASUREMENT_ID.trim();
    const cleaned = clean(params);
    if (sink) {
      sink(String(event), cleaned);
      return true;
    }
    if (!inject(id)) return false;
    window.gtag('event', String(event), cleaned);
    return true;
  } catch {
    return false;
  }
}

/** A new game: the per-game sampling counters start again. */
export function resetSampling() {
  sampling.human = 0;
  sampling.bot = 0;
  sampling.botSeen = 0;
}

/** action_taken, with the type only, sampled so a bot-only game sends a few dozen events at most. */
export function trackAction(type, source) {
  try {
    if (!analyticsOn()) return false;
    if (source === 'human') {
      if (sampling.human >= SAMPLING.HUMAN_CAP) return false;
      sampling.human += 1;
    } else {
      sampling.botSeen += 1;
      if ((sampling.botSeen - 1) % SAMPLING.BOT_EVERY !== 0 || sampling.bot >= SAMPLING.BOT_CAP) return false;
      sampling.bot += 1;
    }
    return track('action_taken', { type, source });
  } catch {
    return false;
  }
}
