// preview.js - "what would happen if" by trying it on a copy.
//
// The UI never works out the consequence of an action itself. It clones the
// state, asks the engine to apply the action to the clone, and reads what came
// back. The real state is never touched.

import { cloneState, applyAction, STOP_ACTION_TYPES } from '../engine/index.js';

/**
 * Applies `action` to a copy of `state`.
 * @returns {{ state: object, events: object[] }} the copy afterwards and the events the action produced
 */
export function simulate(state, action) {
  const copy = cloneState(state);
  const events = applyAction(copy, action) ?? [];
  return { state: copy, events };
}

/**
 * The steps the engine would take BY ITSELF after `action` because each had
 * exactly one legal action (events marked `auto: true`). The clicked action's
 * own event is not one of them.
 *
 * `stop` is true for the "nothing was possible here" kind (skip a step, skip a
 * bonus action ...): the player is told those were skipped, not chosen.
 *
 * @returns {{ text: string, type: string, stop: boolean, action: object }[]}
 */
export function forcedFollowUps(state, action) {
  let events;
  try {
    events = simulate(state, action).events;
  } catch {
    return [];
  }
  return followUpsFromEvents(events);
}

/** The forced steps among the events of one applyAction call (see forcedFollowUps). */
export function followUpsFromEvents(events) {
  const out = [];
  let skippedOwn = false;
  for (const ev of events) {
    if (ev.type !== 'action') continue;
    if (!skippedOwn) {
      skippedOwn = true;
      if (!ev.auto) continue;
    }
    if (ev.auto) out.push({ text: ev.text, type: ev.action.type, stop: STOP_ACTION_TYPES.includes(ev.action.type), action: ev.action });
  }
  return out;
}

/**
 * One sentence on what a choice will lead to, from its forced follow-ups, or ''
 * when nothing is forced. `label` names the choice ("Lay Tracks").
 */
export function consequenceSentence(label, followUps) {
  const real = followUps.filter((f) => !f.stop);
  const skipped = followUps.filter((f) => f.stop);
  const parts = [];
  if (real.length === 1) parts.push(`your only option is to ${lowerFirst(real[0].text)}, which will happen at once`);
  else if (real.length > 1) parts.push(`the only options left are forced: ${real.map((f) => lowerFirst(f.text)).join(', then ')}, all at once`);
  if (skipped.length > 0) {
    const names = skipped.map((f) => lowerFirst(f.text));
    parts.push(`${real.length > 0 ? 'and ' : ''}nothing else is possible after that, so the game will ${names.join(' and ')} for you`);
  }
  return parts.length === 0 ? '' : `${label}: ${parts.join(' ')}.`;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
