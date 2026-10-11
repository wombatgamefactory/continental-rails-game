// bug-report-capture.js - builds the bug report: one self-contained JSON object
// that answers "why would the game not let me do X?" without a conversation.
//
// THE THREE PROMISES (each one enforced in code and asserted in the tests):
//
//   1. IT NEVER THROWS. Every section of the report is built inside
//      section(name, fn). A failure becomes { error: 'message' } in its place and
//      the report still completes. Losing one section is a nuisance; losing the
//      report is the whole feature. An `error` key anywhere in a report is
//      itself worth reading. The two loggers (logAction, logEvent) swallow their
//      own exceptions for the same reason.
//
//   2. IT NEVER MUTATES. The live game state is only ever read through
//      cloneState: one clone is what gets written (as a JSON round trip), a
//      second is what the engine helpers are pointed at. The tests compare
//      hashState of the live game before and after a capture.
//
//   3. THE OUTPUT IS STRINGIFY-SAFE, PROVEN. Every section is capped (depth,
//      array length, string length) EXCEPT the two that must be complete to be
//      useful: `gameState` and `replay` (the config and the full action list). The
//      finished report is then round-tripped once through JSON.stringify /
//      JSON.parse, and a section that will not survive is replaced by { error }.
//
// This module has no DOM access, so the same code runs in Node (the tests and
// tools/replay-bug-report.mjs). The page-specific facts (URL, viewport, what
// each control says about itself) are gathered by bug-report-ui.js and passed in.
// The clock and the random source are allowed here because this is UI code; the
// engine never sees them.
//
// No rules logic lives here: diagnostics call the engine's own functions
// (getBlockReason, getStructuralBlockReason, getActionSpace, describeDecision,
// describeAction, describeProgress, scoreGame, ...) and report what they say.

import {
  getValidActions,
  getBlockReason,
  getStructuralBlockReason,
  getActionSpace,
  describeDecision,
  describeAction,
  frameLabel,
  describeProgress,
  actionKey,
  cloneState,
  hashState,
  getGameConfig,
  replayGame,
  scoreGame,
  topFrame,
  getConstants,
  cardIndex,
  goalsInPlay,
  nonDefaultVariants,
  production,
  storageUsed,
  storageCapacity,
  workersOnGrid,
  ownedRoutes,
  railwayStationCount,
  telegraphStationCount,
  specialistCounts,
  installedUpgrades,
  deserialiseState,
  applyAction,
  SILENT,
} from '../engine/index.js';
import { standingText } from './explain.js';
import { CONFIG } from './config.js';

/** The version of THIS file's report format (the replay tool refuses any other). */
export const REPORT_SCHEMA_VERSION = 1;

/** The categories, stored in the report as these verbatim labels. */
export const CATEGORIES = [
  'The game would not let me do something',
  'The game let me do something it should not',
  'Scoring looks wrong',
  'A bot did something odd',
  'Display or layout problem',
  'Something else',
];

/** Caps for everything except `gameState` and `replay`. */
export const CAPS = { depth: 12, array: 300, string: 4000 };

/** Ring-buffer sizes. */
export const LOG_SIZES = { actions: 80, events: 120 };

/** Sections that are never capped (they must be complete to be replayable). */
export const UNCAPPED_SECTIONS = ['gameState', 'replay'];

/** Action types whose blocked actions are listed in full (the questions players ask). */
const DETAIL_TYPES = new Set([
  'claimRoute', 'moveTrain', 'placeWorker', 'displaceWorker', 'removeWorker', 'hireSpecialist',
  'takeCongressEntry', 'buyPonyCard', 'placeRailwayStation', 'placeTelegraphStation', 'placeRailhead',
  'chooseDistrict', 'installUpgrade', 'buyHat', 'addCarriage', 'useStep', 'skipStep',
]);

/** At most this many actions are described in full (key, text, parameters) in one group of identical reasons. */
const GROUP_LIST_LIMIT = 150;
/** ... but a group whose only blocker is the timing (structurally fine) is described for this many; the rest are listed by key. */
const TIMING_GROUP_LIMIT = 12;
/** Types that are not "detail" give this many examples per group. */
const EXAMPLE_LIMIT = 3;
/** At most this many actions of one type are described in full, whatever the groups (the others are listed by key under their group's reason). */
const TYPE_DETAIL_BUDGET = 120;
/** The keys of the actions of a group that are not described in full (so "why not X?" can always be looked up). */
const GROUP_KEYS_LIMIT = 300;

// ---------------------------------------------------------------------------
// Small helpers (all total: none of them throws)
// ---------------------------------------------------------------------------

function message(err) {
  try {
    if (err && typeof err === 'object' && 'message' in err) return String(err.message).slice(0, 500);
    return String(err).slice(0, 500);
  } catch {
    return 'unknown error';
  }
}

/** A deep copy by JSON round trip (throws on a circular value; callers wrap it). */
function jsonClone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** The same, never throwing: { error } on failure. */
function safe(fn) {
  try {
    return fn();
  } catch (err) {
    return { error: message(err) };
  }
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Local time as YYYYMMDD-HHMMSS. */
function stamp(now) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Four random characters from [a-z0-9], from crypto.getRandomValues when there is one. */
function randomSuffix(bytesFn) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(4);
  try {
    if (typeof bytesFn === 'function') bytesFn(bytes);
    else globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** "crbug-20261011-143015-k3x9": local time, random suffix. */
export function makeReportId(now = new Date(), bytesFn = null) {
  return `crbug-${stamp(now)}-${randomSuffix(bytesFn)}`;
}

/** A lowercase slug of a title for a file name ("" becomes "report"). */
export function slugOf(title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'report';
}

/** The download file name: continental-rails-bug-<id>-<slug-of-title>.json */
export function reportFileName(id, title) {
  return `continental-rails-bug-${id}-${slugOf(title)}.json`;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * A copy of `value` that JSON can always carry, within the caps. Functions,
 * symbols and bigints become short strings; NaN and Infinity become strings;
 * a cycle becomes '[circular]'; an Error becomes { error }.
 */
export function capValue(value, caps = CAPS, depth = 0, seen = new WeakSet()) {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > caps.string ? `${value.slice(0, caps.string)}... [+${value.length - caps.string} characters]` : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'undefined':
      return null;
    case 'bigint':
      return String(value);
    case 'function':
      return '[function]';
    case 'symbol':
      return '[symbol]';
    default:
      break;
  }
  if (seen.has(value)) return '[circular]';
  if (depth >= caps.depth) return Array.isArray(value) ? `[array of ${value.length}, past the depth cap]` : '[object, past the depth cap]';
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.slice(0, caps.array).map((item) => capValue(item, caps, depth + 1, seen));
    if (value.length > caps.array) out.push(`[+${value.length - caps.array} more items]`);
  } else if (value instanceof Error) {
    out = { error: message(value) };
  } else if (value instanceof Map) {
    out = capValue(Array.from(value.entries()), caps, depth, seen);
  } else if (value instanceof Set) {
    out = capValue(Array.from(value.values()), caps, depth, seen);
  } else if (typeof value.nodeType === 'number') {
    out = '[DOM node]';
  } else {
    out = {};
    const keys = Object.keys(value);
    for (const key of keys.slice(0, 200)) {
      let item;
      try {
        item = value[key];
      } catch {
        item = '[unreadable]';
      }
      if (item === undefined) continue;
      out[key] = capValue(item, caps, depth + 1, seen);
    }
    if (keys.length > 200) out.__moreKeys = keys.length - 200;
  }
  seen.delete(value);
  return out;
}

// ---------------------------------------------------------------------------
// The local archive (pure: the page does the localStorage reads and writes)
// ---------------------------------------------------------------------------

/** About 20 reports or 4 MB of text, whichever is hit first; the oldest are evicted. */
export const ARCHIVE_CAPS = { count: 20, bytes: 4000000 };

/**
 * `list` (oldest first) with `entry` added and the oldest evicted until both
 * caps hold. An entry with the same id replaces the old one. The newest entry
 * is always kept, however large. Entries: { id, savedAt, title, fileName, text }.
 */
export function addToArchive(list, entry, caps = ARCHIVE_CAPS) {
  const out = list.filter((e) => e && e.id !== entry.id);
  out.push(entry);
  const size = () => out.reduce((n, e) => n + (e.text ? e.text.length : 0), 0);
  while (out.length > 1 && (out.length > caps.count || size() > caps.bytes)) out.shift();
  return out;
}

// ---------------------------------------------------------------------------
// The two ring buffers (the page calls logAction in its commit path, logEvent wherever
// something is refused, ignored or goes wrong)
// ---------------------------------------------------------------------------

const logs = { actions: [], events: [], eventCount: 0, game: 0 };

function push(buffer, entry, size) {
  buffer.push(entry);
  if (buffer.length > size) buffer.splice(0, buffer.length - size);
}

/**
 * Records one APPLIED action. `entry`: { seq, player, name, text, how, action }
 * where `how` is 'human' | 'bot' | 'fallback' | 'automatic'. Never throws.
 */
export function logAction(entry) {
  try {
    push(logs.actions, { game: logs.game, ...capValue(entry, { depth: 4, array: 20, string: 300 }) }, LOG_SIZES.actions);
  } catch {
    // a logging failure must never cost anybody a turn
  }
}

/**
 * Records one event: kind is 'error' | 'warning' | 'refusal' | 'ignored' | 'incident' | 'cap-trip' | 'info'.
 * `data` is any small extra detail. Never throws.
 */
export function logEvent(kind, text, data) {
  try {
    logs.eventCount += 1;
    const entry = { n: logs.eventCount, game: logs.game, at: new Date().toISOString(), kind: String(kind), text: String(text).slice(0, 500) };
    if (data !== undefined) entry.data = capValue(data, { depth: 4, array: 20, string: 300 });
    push(logs.events, entry, LOG_SIZES.events);
  } catch {
    // swallowed on purpose
  }
}

/** A new game starts: the action log starts afresh (the event log keeps its history, tagged by game number). */
export function startLogs() {
  logs.actions.length = 0;
  logs.game += 1;
}

/** Empties both buffers (tests). */
export function resetLogs() {
  logs.actions.length = 0;
  logs.events.length = 0;
  logs.eventCount = 0;
  logs.game = 0;
}

/** Copies of both buffers. */
export function getLogs() {
  return { actionLog: logs.actions.map((e) => ({ ...e })), eventLog: logs.events.map((e) => ({ ...e })) };
}

// ---------------------------------------------------------------------------
// Diagnostics: the heart of the report
// ---------------------------------------------------------------------------

/**
 * Which player the report is about, and why. The human who must act now; if a
 * bot is to act, the human who acted last (answering "why can't I act" for a bot
 * answers the wrong question).
 */
export function pickReporter(state, seats, lastHumanActor) {
  const isHuman = (pid) => pid !== null && pid !== undefined && seats[pid] !== undefined && seats[pid].human === true;
  if (state.phase === 'ended') {
    const pid = isHuman(lastHumanActor) ? lastHumanActor : Math.max(0, seats.findIndex((s) => s.human));
    return { player: pid, why: 'the game is over; the human who acted last (or the first human seat)' };
  }
  if (isHuman(state.toAct)) return { player: state.toAct, why: 'the human who must act now' };
  if (isHuman(lastHumanActor)) return { player: lastHumanActor, why: 'a bot is to act, so this is the human who acted last' };
  const first = seats.findIndex((s) => s.human);
  if (first >= 0) return { player: first, why: 'a bot is to act and no human has acted yet, so the first human seat' };
  return { player: state.toAct ?? 0, why: 'every seat is a bot; the player to act' };
}

function paramsOf(action) {
  const out = {};
  for (const k of Object.keys(action)) if (k !== 'type' && k !== 'player') out[k] = action[k];
  return out;
}

/**
 * Block reasons for the whole action space, asked for `playerId`, grouped by
 * action type and then by identical (now, structural) reason pair. `null` for
 * `now` means the action WAS legal: next to a dead control that is a UI bug.
 */
function actionSpaceReport(state, playerId, relevantTypes) {
  const space = getActionSpace(state);
  const byType = {};
  const legalKeysBySpace = new Set();
  for (const action of space) {
    const probe = { ...action, player: playerId };
    let now;
    let structural = null;
    try {
      now = getBlockReason(state, probe);
      structural = now === null ? null : getStructuralBlockReason(state, probe);
    } catch (err) {
      now = `[the engine threw: ${message(err)}]`;
    }
    const type = action.type;
    const slot = (byType[type] ||= { total: 0, legalNow: 0, detail: DETAIL_TYPES.has(type) || relevantTypes.has(type), full: 0, legal: [], blocked: new Map() });
    slot.total += 1;
    const key = actionKey(action);
    if (now === null) {
      slot.legalNow += 1;
      slot.legal.push({ key, text: describeAction(state, action), params: paramsOf(action) });
      legalKeysBySpace.add(key);
      continue;
    }
    const gkey = `${now}\u0000${structural}`;
    let group = slot.blocked.get(gkey);
    if (!group) {
      group = { now, structural, count: 0, actions: [], moreKeys: [] };
      slot.blocked.set(gkey, group);
    }
    group.count += 1;
    const limit = slot.detail ? (structural === null ? TIMING_GROUP_LIMIT : GROUP_LIST_LIMIT) : EXAMPLE_LIMIT;
    if (group.actions.length < limit && (!slot.detail || slot.full < TYPE_DETAIL_BUDGET)) {
      group.actions.push({ key, text: describeAction(state, action), params: paramsOf(action) });
      slot.full += 1;
    } else if (slot.detail && group.moreKeys.length < GROUP_KEYS_LIMIT) group.moreKeys.push(key);
  }
  const out = {};
  for (const type of Object.keys(byType)) {
    const slot = byType[type];
    out[type] = {
      total: slot.total,
      legalNow: slot.legalNow,
      listedInFull: slot.detail,
      legal: slot.legal,
      blocked: Array.from(slot.blocked.values())
        .sort((a, b) => b.count - a.count)
        .map((g) => {
          const { moreKeys, ...rest } = g;
          const out = { ...rest, more: Math.max(0, g.count - g.actions.length) };
          if (moreKeys.length > 0) out.moreKeys = moreKeys;
          return out;
        }),
    };
  }
  return { total: space.length, byType: out, legalKeysBySpace };
}

/** Per-player numbers a rules question usually turns on. */
function playerNumbers(state, p, seats) {
  const seat = seats[p.id] ?? {};
  const tracks = Object.keys(p.houses);
  const workers = safe(() => workersOnGrid(state, p.id));
  const activation = state.stack.find((f) => f.kind === 'trainActivation' && f.player === p.id);
  const out = {
    id: p.id,
    name: p.name,
    seat: { human: seat.human === true, level: seat.level ?? null, label: seat.label ?? null, colour: seat.colour ?? p.colour ?? null },
    coins: p.coins,
    hats: p.hats,
    hatsGainedThisTurn: state.turn.player === p.id ? p.hats - state.turn.hatsAtStart : null,
    resources: { ...p.resources },
    builtTiles: { ...p.builtTiles },
    storage: safe(() => ({ used: storageUsed(p), capacity: storageCapacity(state, p.id) })),
    workers: { inSupply: p.workersInSupply, onSpaces: workers.spaces ?? workers, onCentres: workers.centres ?? [] },
    housesOnPlayerBoard: { ...p.houses },
    productionPerTrack: safe(() => Object.fromEntries(tracks.map((t) => [t, production(state, p.id, t)]))),
    railheads: [...p.railheads],
    startCities: [...p.startCities],
    routesOwned: safe(() => ownedRoutes(state, p.id)),
    buildings: safe(() => ({
      railwayStations: railwayStationCount(state, p.id),
      railwayStationCities: Object.keys(state.map.railwayStation).filter((c) => state.map.railwayStation[c] === p.id),
      telegraphStations: telegraphStationCount(state, p.id),
      telegraphStationCities: Object.keys(state.map.telegraphStation).filter((c) => state.map.telegraphStation[c] === p.id),
      telegraphsPlaced: p.telegraphsPlaced,
    })),
    train: { specialistCarriages: p.train.specialistCarriages.map((c) => [...c.slots]), storageCarriages: p.train.storageCarriages },
    specialists: safe(() => specialistCounts(state, p.id)),
    bonusActionsUsed: { ...p.bonusActionsUsed },
    turnsTaken: p.turnsTaken,
    lobbyPointsInActivation: activation ? activation.lobby : null,
    vp: { ...p.vp },
  };
  if (state.modules.pony) out.pony = safe(() => ({ ...state.modules.pony.players[p.id] }));
  if (state.modules.upgrades) out.upgradesInstalled = safe(() => installedUpgrades(state, p.id).map((t) => (typeof t === 'object' && t !== null ? (t.id ?? t) : t)));
  return out;
}

/** Goal and milestone progress, with the SAME strings the UI shows (describeProgress / standingText). */
function progressReport(state) {
  const out = {};
  const K = getConstants(state);
  if (state.modules.milestones) {
    const index = cardIndex(K.MILESTONE_TILES);
    out.milestones = state.modules.milestones.inPlay.map((id) => {
      const tile = index.get(id);
      return {
        id,
        name: tile.name,
        text: tile.text,
        claimedBy: state.modules.milestones.claimedBy[id] ?? null,
        progress: state.players.map((p) => {
          const pr = describeProgress(state, p.id, tile);
          return { player: p.id, text: pr.text, met: pr.met, value: pr.value, target: pr.target };
        }),
      };
    });
  }
  if (state.modules.goals) {
    out.goals = goalsInPlay(state).map((goal) => ({
      id: goal.id,
      name: goal.name,
      text: goal.text,
      progress: state.players.map((p) => {
        const pr = describeProgress(state, p.id, goal);
        return { player: p.id, text: pr.text, standing: standingText(state, goal, p.id) };
      }),
    }));
  }
  return out;
}

/** The pending decision stack in words: kinds and players, plus the top frame raw. */
function stackReport(state) {
  return {
    depth: state.stack.length,
    frames: state.stack.map((f, i) => ({ index: i, kind: f.kind, player: f.player, playerName: state.players[f.player] ? state.players[f.player].name : null, label: safe(() => frameLabel(state, f)) })),
    top: topFrame(state),
  };
}

/**
 * The diagnostics section. `state` is the CLONE that engine helpers may be
 * pointed at. `seats` maps player id to { human, level, ... }.
 */
export function buildDiagnostics(state, seats, lastHumanActor, controls) {
  const reporter = pickReporter(state, seats, lastHumanActor);
  const pid = reporter.player;
  const diag = {
    reporter: { player: pid, name: state.players[pid] ? state.players[pid].name : null, why: reporter.why },
    toAct: state.toAct,
    phase: state.phase,
    turn: { ...state.turn },
  };
  diag.decision = safe(() => describeDecision(state));
  diag.stack = safe(() => stackReport(state));
  let legalNow = [];
  diag.legal = safe(() => {
    legalNow = getValidActions(state);
    return {
      forPlayer: state.toAct,
      count: legalNow.length,
      actions: legalNow.map((a) => ({ key: actionKey(a), text: describeAction(state, a) })),
    };
  });
  diag.actionSpace = safe(() => {
    if (state.phase === 'ended') return { skipped: 'The game is over, so no action is open.' };
    const relevant = new Set(legalNow.map((a) => a.type));
    const space = actionSpaceReport(state, pid, relevant);
    const result = {
      askedFor: pid,
      note: 'now = getBlockReason (null means the action WAS legal); structural = getStructuralBlockReason (the same question with timing aside). Types with listedInFull true describe up to 120 actions in full (12 per group when only the timing blocks them) and list the keys of the rest in the moreKeys of its group; other types give a few examples per group.',
      total: space.total,
      byType: space.byType,
    };
    if (pid === state.toAct) {
      // The two lists that must agree: every action the block-reason ladder calls legal is in getValidActions, and the other way round.
      const validKeys = new Set(legalNow.map(actionKey));
      const onlyInSpace = [...space.legalKeysBySpace].filter((k) => !validKeys.has(k));
      const onlyInValid = [...validKeys].filter((k) => !space.legalKeysBySpace.has(k));
      result.agreement = { ok: onlyInSpace.length === 0 && onlyInValid.length === 0, legalBySpace: space.legalKeysBySpace.size, legalByValidActions: validKeys.size, onlyLegalBySpace: onlyInSpace.slice(0, 50), onlyInValidActions: onlyInValid.slice(0, 50) };
    }
    return result;
  });
  diag.players = safe(() => state.players.map((p) => safe(() => playerNumbers(state, p, seats))));
  diag.score = safe(() => {
    const s = scoreGame(state);
    return { final: s.final, endReason: s.endReason, players: s.players.map((p) => ({ id: p.id, name: p.name, total: p.total, bySource: p.bySource, tieBreak: p.tieBreak, rank: p.rank })) };
  });
  diag.progress = safe(() => progressReport(state));
  diag.controls = controls === undefined ? null : controls;
  return diag;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** The seats as the page holds them, plus the table-level facts. */
function tableReport(state, seats) {
  return {
    seats: state.players.map((p) => {
      const seat = seats[p.id] ?? {};
      return { playerId: p.id, seat: p.id + 1, configIndex: p.configIndex, name: p.name, colour: seat.colour ?? p.colour ?? null, kind: seat.human === false ? 'bot' : 'human', level: seat.level ?? null, label: seat.label ?? null };
    }),
    seed: state.config.seed,
    shuffleSeats: state.config.shuffleSeats,
    variantsNotDefault: nonDefaultVariants(state.variants),
    modulesOn: Object.keys(state.modules),
  };
}

/**
 * Re-derives the state from the replay record, in a scratch copy, and says
 * whether it agrees with the state in the report.
 */
export function checkReplay(replay, expectedHash) {
  const started = Date.now();
  let state;
  if (replay.base) {
    state = deserialiseState(replay.base);
    for (let i = 0; i < replay.actions.length; i++) applyAction(state, replay.actions[i], SILENT);
  } else {
    state = replayGame(replay.config, replay.actions);
  }
  const hash = hashState(state);
  return { ok: hash === expectedHash, replayedHash: hash, expectedHash, ms: Date.now() - started };
}

/**
 * Builds the report. NEVER THROWS.
 *
 * @param {object} input
 *   state            the live game state, or null (setup screen)
 *   seats            [{ human, level, label, name, colour }] by player id
 *   replay           { actions: [...applied actions], base: null | state text the actions start from }
 *   lastHumanActor   the player id of the human who acted last, or null
 *   words            { title, category, expected, actual } as typed
 *   screen           'setup' | 'game' | 'cover' | 'end'
 *   ui               the UI's own state (mode, pending selection, open panel, undo depth, bot thinking, speed, paused)
 *   controls         what each on-screen control says about itself
 *   environment      URL, user agent, viewport, ...
 *   setupForm        the setup form as it stands (setup screen only)
 * @param {object} [options]
 *   now, randomBytes, config (default CONFIG), failSections (test hook: names of sections to break)
 */
export function buildReport(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const config = options.config || CONFIG;
  const failSections = options.failSections || [];
  const errors = [];
  const sections = {};
  const section = (name, fn) => {
    try {
      if (failSections.includes(name)) throw new Error(`forced failure of the "${name}" section (test)`);
      sections[name] = fn();
    } catch (err) {
      sections[name] = { error: message(err) };
      errors.push(name);
    }
  };

  const live = input.state || null;
  const seats = Array.isArray(input.seats) ? input.seats : [];
  // Promise 2: one clone is what is written, one is what the engine helpers are pointed at.
  let forWrite = null;
  let forEngine = null;
  try {
    if (live) {
      forWrite = jsonClone(cloneState(live));
      forEngine = cloneState(live);
    }
  } catch (err) {
    errors.push('clone');
    sections.cloneError = { error: message(err) };
  }

  let id;
  try {
    id = makeReportId(now, options.randomBytes);
  } catch {
    id = `crbug-${Date.now()}`;
  }

  section('schemaVersion', () => REPORT_SCHEMA_VERSION);
  section('id', () => id);
  section('timestamp', () => ({ iso: now.toISOString(), local: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, utcOffsetMinutes: -now.getTimezoneOffset() }));
  section('build', () => String(config.BUILD));
  section('environment', () => input.environment ?? null);
  section('screen', () => input.screen ?? null);
  section('words', () => ({ title: String(input.words?.title ?? ''), category: String(input.words?.category ?? ''), expected: String(input.words?.expected ?? ''), actual: String(input.words?.actual ?? '') }));
  section('table', () => (forEngine ? tableReport(forEngine, seats) : null));
  section('setupForm', () => input.setupForm ?? null);
  section('stateHash', () => (forEngine ? hashState(forEngine) : null));
  section('seq', () => (forEngine ? forEngine.seq : null));
  section('gameState', () => forWrite);
  section('replay', () => {
    if (!forEngine) return null;
    const rp = input.replay || { actions: [], base: null };
    return {
      note: 'Rebuild: replayGame(config, actions) when base is null; otherwise load base and apply actions in order. Forced (automatic) actions are re-derived by the engine and are not in this list.',
      origin: rp.base ? 'loaded-state' : 'created',
      config: jsonClone(getGameConfig(forEngine)),
      base: rp.base ?? null,
      actionCount: rp.actions.length,
      actions: jsonClone(rp.actions),
    };
  });
  section('replayCheck', () => {
    if (!forEngine) return null;
    const rp = sections.replay;
    if (!rp || rp.error) return { ok: false, note: 'no replay record' };
    return checkReplay(rp, hashState(forEngine));
  });
  section('ui', () => input.ui ?? null);
  section('diagnostics', () => (forEngine ? buildDiagnostics(forEngine, seats, input.lastHumanActor ?? null, input.controls) : null));
  section('actionLog', () => getLogs().actionLog);
  section('eventLog', () => getLogs().eventLog);

  // Promise 3: cap everything but the sections that must be complete.
  const report = {};
  for (const name of Object.keys(sections)) {
    try {
      report[name] = UNCAPPED_SECTIONS.includes(name) ? sections[name] : capValue(sections[name]);
    } catch (err) {
      report[name] = { error: message(err) };
      errors.push(name);
    }
  }
  report.capture = { sectionsWithErrors: [...new Set(errors)], caps: CAPS, uncapped: UNCAPPED_SECTIONS };

  // ... and prove it is stringify-safe by one round trip.
  try {
    return JSON.parse(JSON.stringify(report));
  } catch {
    const out = {};
    for (const name of Object.keys(report)) {
      try {
        out[name] = JSON.parse(JSON.stringify(report[name]));
      } catch (err) {
        out[name] = { error: `could not be written as JSON: ${message(err)}` };
        out.capture.sectionsWithErrors.push(name);
      }
    }
    return out;
  }
}
