// main.js - game flow, action dispatch, undo and the hand-over between seats.
//
// The page is a thin loop over the engine's one question ("player P, choose
// one of these actions"):
//
//   render(state)  ->  click  ->  commitAction  ->  applyAction  ->  events
//        ^                                                              |
//        +---------------- afterStep (log, undo, game over) <-----------+
//
// Humans and bots go through the SAME commitAction and the SAME afterStep, so
// the game-over check cannot be skipped on one path.
//
// Who acts is always `state.toAct`, which is not always the active player
// (an overflow discard or a displaced worker's resource choice can fall to
// someone else mid-turn).
//
// Everything the player is told about a refusal goes through ONE function,
// `say`: the engine's refusal of a click, the engine's refusal of an action,
// a click on something that is not open to them. One mechanism, one place.

import {
  createGame,
  getValidActions,
  applyAction,
  describeAction,
  actionKey,
  isGameOver,
  cloneState,
  hashState,
  serialiseState,
  deserialiseState,
  topFrame,
  playerName,
  scoreGame,
  nonDefaultVariants,
} from '../engine/index.js';
import { BOT_LEVELS } from '../bots/index.js';
import { loadArt, installArtFallback, isRealArt, artUrl } from './art.js';
import * as UI from './ui-state.js';
import { buildTargets, pickDistrictAction } from './action-targets.js';
import { entriesFromEvents, flashFromEvents, revealsHiddenInformation, VP_LABELS, END_REASON_TEXT, TIE_BREAK_TEXT } from './log.js';
import { renderHeader, renderScores, renderPrompt, renderGrid, renderCongress, renderTrains, renderMap, renderLog, renderCover, renderEnd, renderToast } from './board-render.js';
import { applyQuery, renderSetup, handleSetupEvent, buildGame, buildDemoGame, setSetupError, getForm, syncUrl, PLAYER_COLOURS } from './setup.js';
import { createBotDriver } from './bot-driver.js';
import { renderDock, tabsInPlay, TAB_TITLES } from './module-panels.js';
import { scoringBreakdown, scoringSummary, renderPopup } from './scoring-popup.js';
import { tipFor, refusalMessage } from './explain.js';
// bug reporter and analytics (hooks only: the logic lives in these modules)
import { CONFIG } from './config.js';
import { installBugReporter } from './bug-report-ui.js';
import { logAction, logEvent, startLogs } from './bug-report-capture.js';
import { track, trackAction, resetSampling, setSink } from './analytics.js';

const $ = (id) => document.getElementById(id);

/** How long a refusal stays up, and how long the scoring pop-up stays (ms). Both can be dismissed at once. */
const NOTICE_MS = 12000;
const POPUP_MS = 9000;

/** Everything the page remembers about the running game. Nothing of it is stored in the DOM. */
const app = {
  state: null,
  /** seats[playerId] = { human, level, label, name, colour } */
  seats: [],
  setupSeats: [],
  config: null,
  log: [],
  undoStack: [],
  actions: [],
  targets: null,
  ctx: null,
  endHidden: false,
  confirmNew: false,
  test: false,
  lastRender: 0,
  renderTimer: null,
  noticeTimer: null,
  popupTimer: null,
  incidents: [],
  renders: 0,
  // what the bug reporter and analytics need to know about the running game
  /** Every action passed to applyAction since the game began (forced ones are re-derived by the engine). */
  replay: [],
  /** Serialised state the replay starts from, or null when the game was created from a config. */
  replayBase: null,
  /** The player id of the human who acted last. */
  lastHumanActor: null,
  startedAt: 0,
  /** True while the running game is the landing page's four-bot demo ("Play again" then starts another demo). */
  demo: false,
  seedGiven: false,
  endTracked: false,
};

let bugApi = null;

let driver = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  installArtFallback(document);
  const art = loadArt();
  const extras = applyQuery(window.location.search);
  if (extras.test) applyTestConfig(window.location.search);
  await art;
  // The page's own drawn favicon stays until the manifest's ui-favicon is real art.
  if (isRealArt('ui-favicon')) {
    const icon = document.getElementById('favicon');
    if (icon) icon.href = artUrl('ui-favicon');
  }
  if (extras.speed) UI.getView().speed = extras.speed;
  UI.getView().generic = extras.generic;
  app.test = extras.test;
  if (extras.error) setSetupError(extras.error);

  driver = createBotDriver({
    getState: () => app.state,
    shouldRun: () => app.state !== null && app.state.phase !== 'ended' && UI.getView().screen === 'game' && !UI.getView().paused && !isHuman(app.state.toAct) && !needsCover(),
    levelFor: (pid) => (app.seats[pid] ? app.seats[pid].level : 'random'),
    speed: () => UI.getView().speed,
    apply: (action, how) => commitAction(action, how === 'bot' ? 'bot' : 'fallback'),
    incident: (text) => logIncident(text),
  });

  installListeners();
  bugApi = installBugReporter({ getContext: bugContext });
  if (app.test) installTestHook();

  if (extras.autostart) {
    startGame();
  } else {
    showSetup();
  }
}

function showSetup() {
  UI.getView().screen = 'setup';
  document.body.dataset.screen = 'setup';
  if (driver) driver.cancel();
  $('screen-setup').hidden = false;
  $('screen-game').hidden = true;
  $('end').hidden = true;
  $('cover').hidden = true;
  hideFloating();
  renderSetup($('screen-setup'));
}

function startGame() {
  const { config, seats } = buildGame();
  let state;
  try {
    state = createGame(config);
  } catch (err) {
    setSetupError(err.message);
    showSetup();
    return;
  }
  app.config = config;
  app.setupSeats = seats;
  app.seedGiven = String(getForm().seed).trim() !== '';
  app.demo = false;
  syncUrl();
  beginGame(state, seats.map((s) => s));
}

/**
 * "Watch a demo game": four bots, started in one click at a speed a person can
 * follow. It goes through the same beginGame as any other game; only the seats
 * and the bot speed differ. `seed` replays a particular demo.
 */
function startDemo(seed = null) {
  const { config, seats, speed } = buildDemoGame();
  if (seed !== null) config.seed = seed;
  let state;
  try {
    state = createGame(config);
  } catch (err) {
    setSetupError(err.message);
    showSetup();
    return;
  }
  app.config = config;
  app.setupSeats = seats;
  app.seedGiven = seed !== null;
  app.demo = true;
  UI.getView().speed = speed;
  beginGame(state, seats.map((s) => s));
}

/**
 * A name and a colour for a seat: the seat's own, else the player's, else a
 * default that is the same every time ("Player 3", the third colour of the setup
 * palette). A prepared or loaded state may carry neither.
 */
function normaliseSeat(seat, player) {
  const fallbackColour = PLAYER_COLOURS[player.configIndex % PLAYER_COLOURS.length].hex;
  const name = (seat && seat.name && seat.name.trim()) || (player.name && String(player.name).trim()) || `Player ${player.configIndex + 1}`;
  const colour = (seat && seat.colour) || player.colour || fallbackColour;
  return { human: true, level: null, label: 'Human', ...seat, name, colour };
}

/** Starts play from a freshly created state. `seatList` is in setup order; players know their `configIndex`. */
function beginGame(state, seatList, origin = 'created') {
  app.state = state;
  app.seats = state.players.map((p) => normaliseSeat({ ...seatList[p.configIndex] }, p));
  app.log = [];
  app.undoStack = [];
  app.endHidden = false;
  app.confirmNew = false;
  app.incidents = [];
  app.replay = [];
  app.replayBase = origin === 'loaded' ? serialiseState(state) : null;
  if (origin === 'loaded') app.demo = false;
  app.lastHumanActor = null;
  app.startedAt = Date.now();
  app.endTracked = false;
  if (origin === 'loaded') app.seedGiven = false;
  clearTimeout(app.noticeTimer);
  clearTimeout(app.popupTimer);
  UI.resetForNewGame();
  UI.getView().screen = 'game';
  document.body.dataset.screen = 'game';
  window.scrollTo(0, 0);
  if (driver) {
    driver.cancel();
    driver.seed(state.config.seed);
  }
  app.log.push({ seq: 0, player: null, name: '', colour: '#888888', text: `Game started with seed ${state.config.seed}. Seat order: ${state.players.map((p, i) => app.seats[i].name).join(', ')}.`, auto: false, source: 'system', details: [], turn: null });
  $('screen-setup').hidden = true;
  $('screen-game').hidden = false;
  settleDeviceHolder();
  startLogs();
  logEvent('info', `game started (${origin})`, { seed: state.config.seed, players: state.players.length });
  resetSampling();
  trackGameStart(state);
  afterStep();
}

function isHuman(pid) {
  return pid !== null && app.seats[pid] !== undefined && app.seats[pid].human;
}

function humanCount() {
  return app.seats.filter((s) => s.human).length;
}

/** { name, colour } of a player, with the fallbacks of normaliseSeat. */
function who(pid) {
  const seat = app.seats[pid];
  return seat ? { name: seat.name, colour: seat.colour } : { name: `Player ${pid + 1}`, colour: '#888888' };
}

/** With one human at the table the device never changes hands. */
function settleDeviceHolder() {
  const view = UI.getView();
  if (humanCount() === 1) view.deviceHolder = app.seats.findIndex((s) => s.human);
}

/** Whether the "pass the device" cover must be shown before the board. */
function needsCover() {
  const view = UI.getView();
  const state = app.state;
  if (!state || state.phase === 'ended' || state.toAct === null) return false;
  if (!isHuman(state.toAct)) return false;
  return humanCount() >= 2 && view.deviceHolder !== state.toAct;
}

function logIncident(text) {
  app.incidents.push(text);
  const trip = text.startsWith('Applying a random legal action');
  logEvent(trip ? 'cap-trip' : 'incident', text);
  track('bot_incident', { category: trip ? 'failure-cap' : /refused/.test(text) ? 'refused-action' : /in time/.test(text) ? 'timeout' : 'error' });
  app.log.push({ seq: app.state ? app.state.seq : 0, player: null, name: '', colour: '#888888', text: `Driver notice: ${text}`, auto: false, source: 'system', details: [], turn: null });
  scheduleRender();
}

// ---------------------------------------------------------------------------
// The one dispatcher for what the player is told
// ---------------------------------------------------------------------------

/**
 * Tells the player something (a refusal, a reason). Every refusal comes through
 * here: a refused click, a refused action, a click on something out of scope.
 * The message appears once, in one place (the toast), and fades after a while;
 * Escape or its close button dismisses it at once.
 */
function say(text, kind = 'refusal', info = null) {
  logEvent(kind === 'refusal' ? 'refusal' : 'info', `shown to the player: ${text}`, info || undefined);
  if (kind === 'refusal' && info) track('illegal_action_attempted', { type: info.type, category: info.category });
  const notice = UI.setNotice(text, kind);
  paintToast();
  clearTimeout(app.noticeTimer);
  if (notice) {
    app.noticeTimer = setTimeout(() => {
      const current = UI.getView().notice;
      if (current && current.id === notice.id) {
        UI.clearNotice();
        paintToast();
      }
    }, NOTICE_MS);
  }
}

/** The message element is rewritten only when the message itself changes, so a re-render never restarts its animation. */
function paintToast() {
  const el = $('toast');
  const notice = UI.getView().notice;
  const id = notice ? String(notice.id) : '';
  if (el.dataset.shown === id) return;
  el.dataset.shown = id;
  el.innerHTML = renderToast(notice);
  el.hidden = notice === null;
}

function paintPopup() {
  const el = $('popup');
  const popup = UI.getView().popup;
  const id = popup ? String(popup.id) : '';
  if (el.dataset.shown === id) return;
  el.dataset.shown = id;
  el.innerHTML = renderPopup(popup);
  el.hidden = popup === null;
}

function hideFloating() {
  $('toast').hidden = true;
  $('popup').hidden = true;
  $('tip').hidden = true;
}

/** Shows the scoring arithmetic for an action that scored several ways; fades by itself. */
function showScoring(groups) {
  const popup = UI.setPopup(groups);
  paintPopup();
  clearTimeout(app.popupTimer);
  if (popup) {
    app.popupTimer = setTimeout(() => {
      const current = UI.getView().popup;
      if (current && current.id === popup.id) {
        UI.clearPopup();
        paintPopup();
      }
    }, POPUP_MS);
  }
}

// ---------------------------------------------------------------------------
// The one commit path (humans, bots and the fallback all come through here)
// ---------------------------------------------------------------------------

/**
 * Applies an action to the real state.
 * @param {object} action an engine action
 * @param {'human'|'bot'|'fallback'} source
 * @returns {{ ok: boolean, error?: string }}
 */
function commitAction(action, source) {
  const state = app.state;
  if (!state || state.phase === 'ended') return { ok: false, error: 'The game is over.' };
  const snapshot = { state: cloneState(state), logLength: app.log.length, actor: state.toAct, replayLength: app.replay.length };
  let events;
  try {
    events = applyAction(state, action);
  } catch (err) {
    // Discard on throw: nothing was kept, and if the throw was not a clean refusal restore the state.
    if (err && err.code !== 'ILLEGAL_ACTION') app.state = snapshot.state;
    const reason = (err && (err.reason || err.message)) || 'The engine refused that action.';
    logEvent('refusal', `the engine refused ${source} action ${actionKey(action)}: ${reason}`, { source, code: err && err.code ? err.code : null });
    if (source === 'human') {
      say(reason, 'refusal', { type: action.type, category: 'engine-refused' });
      render();
    }
    return { ok: false, error: reason };
  }
  const human = source === 'human';
  recordApplied(action, events, source, snapshot.actor);
  if (human) app.undoStack.push(snapshot);
  const entries = entriesFromEvents(app.state, events, human ? 'human' : 'bot', who);
  const groups = scoringBreakdown(app.state, events, who);
  if (groups.length > 0 && entries.length > 0) {
    // The arithmetic is kept in the log as well as shown in the pop-up.
    for (const g of groups) entries[0].details.push({ text: scoringSummary(g), kind: 'score' });
  }
  for (const entry of entries) app.log.push(entry);
  for (const ev of events) {
    if (ev.type === 'milestoneClaimed') UI.getView().milestoneTurns[ev.milestone] = snapshot.state.turn.number;
  }
  UI.setFlash({ ...flashFromEvents(events), seq: app.state.seq });
  // Undo is cleared when control passes to another player, when a bot acted, when the game ended,
  // or when the action revealed hidden information (a card from a deck).
  if (!human || app.state.toAct !== snapshot.actor || app.state.toAct === null || revealsHiddenInformation(events)) app.undoStack = [];
  UI.resetPending();
  if (groups.length > 0 && (human || UI.getView().speed !== 'instant')) showScoring(groups);
  afterStep(human);
  return { ok: true };
}

/** The shared end of every step: game-over check, hand-over bookkeeping, draw, and wake the bots. */
function afterStep(immediate = true) {
  const state = app.state;
  const view = UI.getView();
  if (isGameOver(state)) {
    trackGameEnd(state);
    app.undoStack = [];
    if (driver) driver.cancel();
    render();
    return;
  }
  if (isHuman(state.toAct)) view.focus = null;
  // A run of instant bot moves is drawn at most every ~90 ms; anything a human did, or anything that
  // hands the move to a human, is drawn at once so the page never shows a prompt that is no longer true.
  const instantBots = view.speed === 'instant' && !isHuman(state.toAct) && !immediate;
  if (instantBots) scheduleRender();
  else render();
  if (driver) driver.kick();
}

function undoAvailable() {
  const state = app.state;
  if (!state || state.phase === 'ended' || state.toAct === null) return false;
  if (!isHuman(state.toAct) || app.undoStack.length === 0) return false;
  return app.undoStack[app.undoStack.length - 1].actor === state.toAct;
}

function undo() {
  if (!undoAvailable()) return;
  const snap = app.undoStack.pop();
  app.state = snap.state;
  app.log.length = snap.logLength;
  logEvent('info', `undo: replay record cut from ${app.replay.length} to ${snap.replayLength} actions`);
  app.replay.length = snap.replayLength;
  UI.resetPending();
  UI.clearFlash();
  UI.clearPopup();
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Throttled render for runs of instant bot moves. */
function scheduleRender() {
  if (app.renderTimer !== null) return;
  const wait = Math.max(0, 90 - (performance.now() - app.lastRender));
  app.renderTimer = setTimeout(() => {
    app.renderTimer = null;
    render();
  }, wait);
}

function buildContext() {
  const state = app.state;
  const view = UI.getView();
  const cover = needsCover();
  const interactive = state.phase !== 'ended' && isHuman(state.toAct) && !cover;
  const actions = interactive ? getValidActions(state) : [];
  const hat = UI.hatOn();
  const targets = buildTargets(state, actions, { generic: view.generic, hat });
  app.actions = actions;
  app.targets = targets;
  // A decision that concerns a module opens its panel, once per decision (closing it keeps it closed until the next).
  if (interactive && targets.wantedTab && view.dock.autoSeq !== state.seq && tabsInPlay(state.variants).includes(targets.wantedTab)) {
    UI.openDock(targets.wantedTab);
    view.dock.autoSeq = state.seq;
  }
  let viewer = view.focus;
  if (viewer === null) {
    if (state.toAct !== null && isHuman(state.toAct)) viewer = state.toAct;
    else if (view.deviceHolder !== null) viewer = view.deviceHolder;
    else viewer = state.toAct ?? state.turn.player ?? 0;
  }
  const tabs = tabsInPlay(state.variants);
  return {
    state,
    actions,
    targets,
    view,
    mode: UI.getMode(),
    modeData: UI.getModeData(),
    hat,
    hasPending: UI.hasPending(),
    seats: app.seats,
    who,
    interactive,
    cover,
    viewer,
    frame: topFrame(state),
    undo: { available: undoAvailable() },
    log: app.log,
    flashAge: UI.flashAge(),
    activeTab: tabs.includes(view.dock.tab) ? view.dock.tab : tabs[0] ?? null,
    tabTitles: TAB_TITLES,
    labels: { vp: VP_LABELS, endReason: END_REASON_TEXT, tieBreak: TIE_BREAK_TEXT },
    describe: (a) => describeAction(state, a),
    keyOf: actionKey,
  };
}

function render() {
  if (!app.state || UI.getView().screen === 'setup') return;
  app.lastRender = performance.now();
  app.renders += 1;
  const ctx = buildContext();
  app.ctx = ctx;
  const state = app.state;
  const root = $('app');
  root.dataset.toAct = state.toAct === null ? '' : String(state.toAct);
  root.dataset.human = ctx.interactive || (state.toAct !== null && isHuman(state.toAct)) ? '1' : '0';
  root.dataset.seq = String(state.seq);
  root.dataset.phase = state.phase;
  root.dataset.kind = ctx.frame ? ctx.frame.kind : '';
  root.dataset.cover = ctx.cover ? '1' : '0';
  root.dataset.turn = String(state.turn.number);
  if (app.test) root.dataset.hash = hashState(state);
  const dockEl = $('region-dock');
  const oldBody = dockEl.querySelector('.dock__body');
  const keepScroll = oldBody ? { tab: oldBody.dataset.tab, top: oldBody.scrollTop } : null;
  $('region-header').innerHTML = renderHeader(ctx);
  $('region-scores').innerHTML = renderScores(ctx);
  $('region-prompt').innerHTML = renderPrompt(ctx);
  $('region-grid').innerHTML = renderGrid(ctx);
  $('region-congress').innerHTML = renderCongress(ctx);
  $('region-map').innerHTML = renderMap(ctx);
  $('region-trains').innerHTML = renderTrains(ctx);
  $('region-log').innerHTML = renderLog(ctx);
  const dock = renderDock(ctx);
  dockEl.innerHTML = dock;
  dockEl.hidden = dock === '';
  $('app').dataset.dock = dock === '' ? 'none' : ctx.view.dock.open ? 'open' : 'closed';
  if (keepScroll) {
    const body = dockEl.querySelector('.dock__body');
    if (body && body.dataset.tab === keepScroll.tab) body.scrollTop = keepScroll.top;
  }
  paintToast();
  paintPopup();
  $('tip').hidden = true;

  const cover = $('cover');
  if (ctx.cover) {
    cover.innerHTML = renderCover(ctx, state.toAct);
    cover.hidden = false;
  } else {
    cover.hidden = true;
    cover.innerHTML = '';
  }
  $('screen-game').toggleAttribute('inert', ctx.cover);

  const end = $('end');
  if (state.phase === 'ended' && !app.endHidden) {
    end.innerHTML = renderEnd(ctx);
    end.hidden = false;
    UI.getView().screen = 'end';
  } else {
    end.hidden = true;
    end.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
// Tooltips: built on demand, when the pointer arrives
// ---------------------------------------------------------------------------

function showTip(el, event) {
  const tip = $('tip');
  if (!app.ctx || UI.getView().screen === 'setup') return;
  let html = '';
  try {
    html = tipFor(app.ctx, el.dataset.tip);
  } catch {
    html = '';
  }
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  placeTip(tip, event, el);
}

function placeTip(tip, event, el) {
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const rect = el.getBoundingClientRect();
  let x = event && typeof event.clientX === 'number' && event.clientX > 0 ? event.clientX + pad : rect.right + 6;
  let y = event && typeof event.clientY === 'number' && event.clientY > 0 ? event.clientY + pad : rect.top;
  if (x + w > window.innerWidth - 6) x = Math.max(6, (event && event.clientX ? event.clientX : rect.left) - w - pad);
  if (y + h > window.innerHeight - 6) y = Math.max(6, window.innerHeight - h - 6);
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

// ---------------------------------------------------------------------------
// Input: one delegated listener per kind of event
// ---------------------------------------------------------------------------

function installListeners() {
  const root = document.body;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', (event) => {
    if (UI.getView().screen === 'setup') handleSetupEvent($('screen-setup'), event.target, 'input');
  });
  root.addEventListener('mouseover', (event) => {
    if (UI.getView().screen === 'setup' || !(event.target instanceof Element)) return;
    const el = event.target.closest('[data-tip]');
    if (el) showTip(el, event);
    else $('tip').hidden = true;
  });
  root.addEventListener('mousemove', (event) => {
    const tip = $('tip');
    if (tip.hidden || !(event.target instanceof Element)) return;
    const el = event.target.closest('[data-tip]');
    if (el) placeTip(tip, event, el);
  });
  root.addEventListener('focusin', (event) => {
    if (UI.getView().screen === 'setup' || !(event.target instanceof Element)) return;
    const el = event.target.closest('[data-tip]');
    if (el) showTip(el, null);
  });
  root.addEventListener('focusout', () => {
    $('tip').hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('tip').hidden = true;
      // Closes the most recent thing: a half-made selection, an opened card, the module panel, the pop-up, the message.
      if (UI.getView().screen !== 'setup' && UI.escape()) {
        clearTimeout(app.noticeTimer);
        render();
      }
      return;
    }
    // Keyboard: Enter or Space on a lit district (a div with role=button) acts like a click.
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.getAttribute('role') === 'button' && event.target.dataset.target) {
      event.preventDefault();
      if (app.state && UI.getView().screen !== 'setup') handleTarget(event.target.dataset.target);
    }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (app.state && UI.getView().screen !== 'setup') render();
    }, 150);
  });
}

function onChange(event) {
  const view = UI.getView();
  if (view.screen === 'setup') {
    const result = handleSetupEvent($('screen-setup'), event.target, 'change');
    if (result === 'start') startGame();
    else if (result === 'demo') startDemo();
    return;
  }
  const el = event.target.closest('[data-ui]');
  if (el && el.dataset.ui === 'toggle-hat') {
    UI.setHat(el.checked);
    render();
  }
}

function onClick(event) {
  const view = UI.getView();
  if (view.screen === 'setup') {
    // Selects and text boxes act on `change` / `input`; a click that merely opens one must not redraw the form.
    if (event.target.closest('select, input[type="text"], input[type="number"], input[type="checkbox"], label')) return;
    const result = handleSetupEvent($('screen-setup'), event.target, 'click');
    if (result === 'start') startGame();
    else if (result === 'demo') startDemo();
    return;
  }
  const el = event.target.closest('[data-ui],[data-akey],[data-target]');
  if (!el) return;
  if (el.dataset.ui !== undefined) {
    if (el.dataset.ui === 'all-moves') event.preventDefault();
    if (el.dataset.ui === 'toggle-hat') return; // handled by the change event
    handleUiAction(el.dataset.ui, el);
    return;
  }
  if (!app.state || app.state.phase === 'ended') {
    logEvent('ignored', 'ignored: the game is over', { control: el.dataset.akey ?? el.dataset.target });
    return;
  }
  if (el.dataset.akey !== undefined) {
    const action = app.actions.find((a) => actionKey(a) === el.dataset.akey);
    if (action) commitAction(action, 'human');
    else logEvent('ignored', 'ignored: no legal action maps to this control', { control: el.dataset.akey, toAct: app.state.toAct });
    return;
  }
  if (el.dataset.target !== undefined) handleTarget(el.dataset.target);
}

function handleUiAction(name, el) {
  const view = UI.getView();
  const cut = name.indexOf(':');
  const verb = cut < 0 ? name : name.slice(0, cut);
  const arg = cut < 0 ? '' : name.slice(cut + 1);
  if (verb !== 'new-game') app.confirmNew = false;
  switch (verb) {
    case 'speed':
      view.speed = arg;
      render();
      if (driver) driver.kick();
      break;
    case 'pause':
      view.paused = !view.paused;
      render();
      if (!view.paused && driver) driver.kick();
      break;
    case 'undo':
      undo();
      break;
    case 'cancel':
      UI.cancelPending();
      render();
      break;
    case 'tab':
      UI.setTab(arg);
      render();
      break;
    case 'dock-toggle':
      UI.toggleDock();
      render();
      break;
    case 'agenda-open': {
      const card = app.state.modules.legislative ? app.state.modules.legislative.card : null;
      UI.setTab('agenda');
      if (card && !(view.cardOpen && view.cardOpen.kind === 'agenda')) UI.openCard('agenda', card);
      render();
      break;
    }
    case 'card': {
      const [kind, id] = (el ? el.dataset.card : arg).split(':');
      UI.openCard(kind, id);
      render();
      break;
    }
    case 'card-close':
      UI.closeCard();
      render();
      break;
    case 'popup-close':
      UI.clearPopup();
      paintPopup();
      break;
    case 'notice-close':
      UI.clearNotice();
      paintToast();
      break;
    case 'focus':
      view.focus = view.focus === Number(arg) ? null : Number(arg);
      render();
      break;
    case 'all-moves':
      view.showAllMoves = !view.showAllMoves;
      render();
      break;
    case 'cover-ok':
      view.deviceHolder = app.state.toAct;
      render();
      if (driver) driver.kick();
      break;
    case 'new-game':
      if (!app.confirmNew && app.state.phase !== 'ended') {
        app.confirmNew = true;
        const btn = document.querySelector('[data-ui="new-game"]');
        if (btn) btn.textContent = 'Really abandon this game?';
        return;
      }
      app.confirmNew = false;
      showSetup();
      break;
    case 'back-to-setup':
      showSetup();
      break;
    case 'again-new-seed':
      if (app.demo) {
        startDemo();
        break;
      }
      getForm().seed = '';
      startGame();
      break;
    case 'again-same-seed':
      if (app.demo) {
        startDemo(app.state.config.seed);
        break;
      }
      getForm().seed = String(app.state.config.seed);
      startGame();
      break;
    case 'view-board':
      app.endHidden = true;
      render();
      break;
    case 'show-end':
      app.endHidden = false;
      render();
      break;
    default:
      break;
  }
}

/** A click on something on the board or the player boards. */
function handleTarget(key) {
  const state = app.state;
  if (state.toAct === null || !isHuman(state.toAct)) {
    logEvent('ignored', state.toAct === null ? 'ignored: the game is over' : 'ignored: a bot is thinking', { target: key, toAct: state.toAct });
    return;
  }
  if (needsCover()) {
    logEvent('ignored', 'ignored: hand-over cover is up', { target: key });
    return;
  }
  const entry = app.targets.byTarget.get(key);
  if (!entry) {
    refuse(key);
    return;
  }
  // A click on a second target SWITCHES the selection: the old one is dropped, never stacked.
  if (UI.getMode() === 'choose') UI.cancelChoice();
  UI.clearNotice();
  let pick = null;
  if (entry.kind === 'district') pick = pickDistrictAction(entry, UI.hatOn());
  else if (entry.actions.length === 1) pick = entry.actions[0];
  if (pick) {
    commitAction(pick, 'human');
    return;
  }
  logEvent('info', `several actions share ${key}; the player is asked which`, { count: entry.actions.length });
  UI.beginChoice({ title: `${entry.actions.length} things you can do here`, actions: entry.actions, key });
  render();
}

/** A click on something that is not a legal target: say why, in the engine's own words, through `say`. */
function refuse(key) {
  if (UI.getMode() === 'choose') {
    UI.cancelChoice();
    render();
  }
  const text = refusalMessage(app.ctx, key);
  if (text) say(text, 'refusal', { type: key.split(':')[0], category: 'click-not-legal', target: key });
  else logEvent('ignored', 'ignored: no legal action maps to this target and there is nothing to say about it', { target: key });
}

// ---------------------------------------------------------------------------
// bug reporter and analytics hooks (narrow: the logic is in bug-report-*.js and analytics.js)
// ---------------------------------------------------------------------------

/** Records an applied action in the replay record and the action log (called from commitAction only). */
function recordApplied(action, events, source, actor) {
  try {
    app.replay.push(JSON.parse(JSON.stringify(action)));
    if (source === 'human') app.lastHumanActor = actor;
    for (const ev of events || []) {
      if (ev.type !== 'action') continue;
      logAction({ seq: ev.seq, player: ev.player, name: who(ev.player).name, text: ev.text, how: ev.auto ? 'automatic' : source, action: ev.action });
    }
    trackAction(action.type, source === 'human' ? 'human' : 'bot');
  } catch {
    // the reporter must never cost anybody a turn
  }
}

function trackGameStart(state) {
  const kinds = app.seats.map((s) => (s.human ? 'human' : s.level));
  track('game_start', {
    player_count: state.players.length,
    humans: kinds.filter((k) => k === 'human').length,
    bots: kinds.filter((k) => k !== 'human').length,
    bot_levels: kinds.filter((k) => k !== 'human').sort().join(','),
    variants_changed: Object.keys(nonDefaultVariants(state.variants)).join(','),
    seed_given: app.seedGiven,
  });
}

function trackGameEnd(state) {
  if (app.endTracked) return;
  app.endTracked = true;
  try {
    const score = scoreGame(state);
    const winner = score.winner === null || score.winner === undefined ? null : app.seats[score.winner];
    logEvent('info', 'game over', { reason: state.gameEnd ? state.gameEnd.reason : null, seq: state.seq });
    track('game_end', {
      end_reason: score.endReason ?? (state.gameEnd ? state.gameEnd.reason : 'unknown'),
      turns: state.turn.number,
      duration_minutes: Math.round(((Date.now() - app.startedAt) / 60000) * 10) / 10,
      winner_seat_type: winner ? (winner.human ? 'human' : winner.level) : 'none',
      scores: score.players.map((p) => p.total).join('/'),
      player_count: state.players.length,
    });
  } catch {
    // analytics must not be able to break the end of a game
  }
}

/** Plain text of a tooltip (what the player would read), for the bug report's list of controls. */
function tipText(key) {
  if (!app.ctx) return '';
  const html = tipFor(app.ctx, key);
  return String(html)
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Everything the bug reporter needs from the page, read at the moment the dialog opens. */
function bugContext() {
  const view = UI.getView();
  const state = app.state;
  const onSetup = !state || view.screen === 'setup';
  let screen = 'game';
  if (onSetup) screen = 'setup';
  else if (needsCover()) screen = 'cover';
  else if (state.phase === 'ended' && !app.endHidden) screen = 'end';
  const form = getForm();
  const choice = UI.getModeData();
  return {
    screen,
    state: onSetup ? null : state,
    seats: app.seats,
    replay: { actions: app.replay, base: app.replayBase },
    lastHumanActor: app.lastHumanActor,
    tipText,
    setupForm: onSetup
      ? { playerCount: form.playerCount, seats: form.seats.slice(0, form.playerCount).map((s) => ({ kind: s.kind, name: s.name, colour: s.colour })), seed: form.seed, shuffle: form.shuffle, variants: { ...form.variants }, error: form.error }
      : null,
    ui: {
      screen: view.screen,
      mode: UI.getMode(),
      pendingChoice: choice ? { title: choice.title, key: choice.key, actions: (choice.actions || []).map(actionKey) } : null,
      hatToggle: UI.hatOn(),
      dock: { open: view.dock.open, tab: view.dock.tab },
      cardOpen: view.cardOpen,
      undoDepth: app.undoStack.length,
      undoAvailable: !onSetup && undoAvailable(),
      botThinking: driver ? driver.busy : false,
      botFailuresInARow: driver ? driver.failures : 0,
      botSpeed: view.speed,
      paused: view.paused,
      genericLayerOnly: view.generic,
      deviceHolder: view.deviceHolder,
      focusedBoard: view.focus,
      notice: view.notice ? { text: view.notice.text, kind: view.notice.kind } : null,
      coverUp: !onSetup && needsCover(),
      endScreenHidden: app.endHidden,
      renders: app.renders,
      incidents: app.incidents.slice(-10),
    },
  };
}

/** Test only (?test=1): ?cfg_email=, ?cfg_ga= and ?cfg_build= override the empty release config for one page load. */
function applyTestConfig(search) {
  const q = new URLSearchParams(search);
  if (q.has('cfg_email')) CONFIG.BUG_REPORT_EMAIL = q.get('cfg_email');
  if (q.has('cfg_ga')) CONFIG.GA4_MEASUREMENT_ID = q.get('cfg_ga');
  if (q.has('cfg_build')) CONFIG.BUILD = q.get('cfg_build');
  if (q.has('cfg_playtime')) CONFIG.PLAY_TIME = q.get('cfg_playtime');
  if (q.has('cfg_age')) CONFIG.AGE = q.get('cfg_age');
}

// ---------------------------------------------------------------------------
// Test hook (only with ?test=1)
// ---------------------------------------------------------------------------

function installTestHook() {
  window.__cr = {
    /** The state as JSON text. */
    serialise: () => serialiseState(app.state),
    getState: () => app.state,
    hash: () => hashState(app.state),
    actions: () => (app.state && app.state.phase !== 'ended' ? getValidActions(app.state) : []),
    seats: () => app.seats,
    undoDepth: () => app.undoStack.length,
    renders: () => app.renders,
    incidents: () => app.incidents.slice(),
    /** The UI's own pending selection: { mode, hat, dock, card } (for the tests of Cancel and Escape). */
    pendingUi: () => ({ mode: UI.getMode(), hat: UI.hatOn(), dock: UI.getView().dock.open, card: UI.getView().cardOpen }),
    /** Replaces the running game with a prepared state. `seatKinds` is per player id: 'human' or a bot level. */
    loadState(text, seatKinds) {
      const state = typeof text === 'string' ? deserialiseState(text) : text;
      const kinds = seatKinds || state.players.map(() => 'human');
      const seatList = [];
      state.players.forEach((p) => {
        const kind = kinds[p.id] ?? 'human';
        const level = kind === 'human' ? null : kind;
        const label = kind === 'human' ? 'Human' : `${(BOT_LEVELS.find((l) => l.id === kind) || { name: kind }).name} bot`;
        // A prepared state may carry no name and no colour: the seat then falls back (see normaliseSeat).
        seatList[p.configIndex] = { human: kind === 'human', level, label, name: p.name, colour: p.colour };
      });
      beginGame(state, seatList, 'loaded');
      return true;
    },
    commit: (action) => commitAction(action, 'human'),
    /** Pauses or resumes the bots. */
    pause(on) {
      UI.getView().paused = !!on;
      render();
      if (!on && driver) driver.kick();
    },
    speed(value) {
      UI.getView().speed = value;
    },
    /** Makes the next n bot replies fail, to exercise the consecutive-failure cap. */
    injectBotFaults: (n) => driver.injectFaults(n),
    name: (pid) => playerName(app.state, pid),
    /** the actions applied since the game began (what a bug report replays), and the state they start from, if not a fresh game. */
    replayRecord: () => ({ actions: JSON.parse(JSON.stringify(app.replay)), base: app.replayBase }),
    /** the bug reporter's own API (open, close, frozen, capture, failSections, archive, lastDownload). */
    bug: bugApi,
    /** analytics events land here instead of the network (only when an id is configured). */
    tracked: [],
    /** sink on (default) records events in `tracked`; sink off lets track() use the real gtag path (the test routes it). */
    trackSink(on) {
      setSink(on ? (event, params) => window.__cr.tracked.push({ event, params }) : null);
    },
    config: CONFIG,
  };
  window.__cr.trackSink(true);
  window.__cr.ready = true;
}

boot().catch((err) => {
  // A boot failure must be visible, not silent.
  const box = document.createElement('pre');
  box.className = 'boot-error';
  box.textContent = `Continental Rails could not start: ${err && err.stack ? err.stack : err}`;
  document.body.prepend(box);
  throw err;
});
