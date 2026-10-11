// ui-state.js - the ONE pending-action state machine, plus the view settings.
//
// Nothing here is rules logic and nothing here is stored in the DOM. The DOM
// carries only identifiers (data-target="space:W4"); everything the page
// remembers between clicks is in this module.
//
// The engine asks one question at a time, so the machine is small:
//
//   mode 'idle'    nothing half-made. A click on a target either commits its
//                  one legal action or, when several actions share the target,
//                  moves to 'choose'.
//   mode 'choose'  several legal actions share the clicked target (for
//                  example a route that could be claimed from either end);
//                  `data.actions` are offered as buttons in the prompt banner.
//                  Cancel, Escape or any other click returns to 'idle'. A click
//                  on a second target SWITCHES the choice; it never stacks.
//
// Flags that belong to the question being asked (the cowboy hat toggle of the
// district choice) are kept in `pending`. All of it is reset by resetPending(),
// which main.js calls after every applied action and every undo, so a
// half-made selection can never refer to a state that no longer exists.
//
// Besides the machine there is the rest of what the page itself holds and the
// engine does not: the module dock (open or closed, which tab, which card is
// opened large), the one message (toast) and the scoring pop-up, and the brief
// highlight of what the last action touched.

/** The pending-action machine: { mode, data, step }. */
const machine = { mode: 'idle', data: null, step: 0 };

/** Per-question flags. */
const pending = { hat: false };

/** How long a highlight lasts (ms). The animation is resumed, not restarted, by a re-render inside this time. */
export const FLASH_MS = 1600;

/** Settings and view state that are not part of a pending action. */
const view = {
  /** 'normal' | 'fast' | 'instant' */
  speed: 'normal',
  paused: false,
  /** Force the generic layer only (?generic=1). */
  generic: false,
  /** Show the full list of legal moves under the prompt. */
  showAllMoves: false,
  /** The player id whose board is shown in full, or null for "whoever is to act". */
  focus: null,
  /** Opponent boards that are expanded (player ids). */
  expanded: new Set(),
  /** The human who currently holds the device, or null before the first hand-over. */
  deviceHolder: null,
  /** Which end-of-game / setup screen is up: 'setup' | 'game' | 'end'. */
  screen: 'setup',
  /** The one message shown to the player (refusal, notice): { text, kind, id } or null. */
  notice: null,
  /** The scoring arithmetic pop-up: { id, groups } or null. */
  popup: null,
  /** The module dock under the map: { open, tab, autoSeq } (autoSeq: the decision the dock last opened itself for). */
  dock: { open: false, tab: null, autoSeq: -1 },
  /** A card opened large in the dock: { kind, id } or null. */
  cardOpen: null,
  /** Turn on which each milestone was claimed, learnt from the events: { MS3: 14 }. */
  milestoneTurns: {},
  /** What the last action touched, for a brief highlight. */
  flash: emptyFlash(),
};

let messageCounter = 0;

function emptyFlash() {
  return { routes: [], cities: [], districts: [], spaces: [], players: [], milestones: [], tabs: [], seq: -1, at: -1 };
}

// ---- the pending-action machine --------------------------------------------

export function getMode() {
  return machine.mode;
}

export function getModeData() {
  return machine.data;
}

/** Enter 'choose': `data` is { title, actions, key } (actions are engine actions; key identifies the clicked target). */
export function beginChoice(data) {
  machine.mode = 'choose';
  machine.data = data;
  machine.step = 1;
}

export function cancelChoice() {
  machine.mode = 'idle';
  machine.data = null;
  machine.step = 0;
}

/** Whether the UI holds a selection of its own that Cancel would clear. */
export function hasPending() {
  return machine.mode === 'choose' || pending.hat;
}

/** Clears every selection the UI itself holds (the choice, the hat). Returns whether anything was cleared. */
export function cancelPending() {
  const had = hasPending();
  cancelChoice();
  pending.hat = false;
  return had;
}

/** Whether the cowboy hat toggle is on for the district choice. */
export function hatOn() {
  return pending.hat;
}

export function setHat(on) {
  pending.hat = !!on;
}

export function toggleHat() {
  pending.hat = !pending.hat;
  return pending.hat;
}

/** Back to the start of a question. Called after every applied action and every undo. */
export function resetPending() {
  cancelChoice();
  pending.hat = false;
  view.notice = null;
  view.cardOpen = null;
}

// ---- view settings -----------------------------------------------------------

export function getView() {
  return view;
}

/** The one message. Every refusal, however it arose, comes through here (see main.js `say`). */
export function setNotice(text, kind = 'refusal') {
  messageCounter += 1;
  view.notice = text ? { text, kind, id: messageCounter } : null;
  return view.notice;
}

export function clearNotice() {
  view.notice = null;
}

export function setPopup(groups) {
  messageCounter += 1;
  view.popup = groups && groups.length ? { id: messageCounter, groups } : null;
  return view.popup;
}

export function clearPopup() {
  view.popup = null;
}

// ---- the module dock and opened cards ---------------------------------------------

export function openDock(tab) {
  view.dock.open = true;
  if (tab) view.dock.tab = tab;
}

export function closeDock() {
  view.dock.open = false;
}

export function toggleDock() {
  view.dock.open = !view.dock.open;
}

export function setTab(tab) {
  view.dock.tab = tab;
  view.dock.open = true;
  view.cardOpen = null;
}

export function openCard(kind, id) {
  view.cardOpen = view.cardOpen && view.cardOpen.kind === kind && view.cardOpen.id === id ? null : { kind, id };
}

export function closeCard() {
  view.cardOpen = null;
}

/**
 * Escape: closes the most recent thing, in order: a pending selection, an opened
 * card, the module dock, the scoring pop-up, the message. Returns what it
 * closed, or null when nothing was open.
 */
export function escape() {
  if (cancelPending()) return 'selection';
  if (view.cardOpen) {
    view.cardOpen = null;
    return 'card';
  }
  if (view.dock.open) {
    view.dock.open = false;
    return 'dock';
  }
  if (view.popup) {
    view.popup = null;
    return 'popup';
  }
  if (view.notice) {
    view.notice = null;
    return 'notice';
  }
  return null;
}

// ---- the highlight of what just happened ---------------------------------------------

export function setFlash(flash) {
  view.flash = { ...emptyFlash(), ...flash, at: performance.now() };
}

export function clearFlash() {
  view.flash = emptyFlash();
}

/**
 * Milliseconds since the highlight began, or -1 when it has run its course.
 * A render inside the window gives its elements a NEGATIVE animation-delay of
 * this age, so a re-render continues the animation where it was instead of
 * starting it again.
 */
export function flashAge() {
  if (view.flash.at < 0) return -1;
  const age = performance.now() - view.flash.at;
  return age >= 0 && age < FLASH_MS ? Math.round(age) : -1;
}

/** A fresh start for a new game: keeps speed and the generic flag. */
export function resetForNewGame() {
  resetPending();
  view.paused = false;
  view.showAllMoves = false;
  view.focus = null;
  view.expanded = new Set();
  view.deviceHolder = null;
  view.popup = null;
  view.dock = { open: false, tab: null, autoSeq: -1 };
  view.milestoneTurns = {};
  clearFlash();
}

export const SPEEDS = ['normal', 'fast', 'instant'];
