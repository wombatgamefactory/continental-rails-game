// replay-bug-report.mjs - opens a bug report headless and answers the question
// it was filed about.
//
//   node tools/replay-bug-report.mjs <report.json>
//   node tools/replay-bug-report.mjs <report.json> --action='{"type":"claimRoute","route":"DEN-KCY","from":"DEN"}'
//   node tools/replay-bug-report.mjs <report.json> --all            (list every blocked action, not a summary)
//   node tools/replay-bug-report.mjs <report.json> --type=claimRoute (only that action type)
//
// What it does:
//   1. checks the file is a bug report of a schema it understands (a truncated
//      or wrong-schema file is refused, exit 2);
//   2. rebuilds the game state BOTH ways, from the stored state and by replaying
//      config + actions, and compares the two by hashState (a mismatch is itself
//      a finding, exit 3);
//   3. prints the reporter's words, the decision pending, the legal actions, and
//      the block reasons recomputed NOW by the current engine next to the ones
//      stored in the report (a difference means the engine has changed since the
//      report was made).
//
// Exit codes: 0 fine, 2 damaged or unsupported file, 3 the two rebuilds disagree.
//
// Node only, no browser, no dependencies; imports the engine's public face.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  replayGame,
  applyAction,
  SILENT,
  deserialiseState,
  hashState,
  cloneState,
  getValidActions,
  getBlockReason,
  getStructuralBlockReason,
  getActionSpace,
  describeDecision,
  describeAction,
  actionKey,
} from '../src/engine/index.js';

/** The report format this tool reads (bug-report-capture.js REPORT_SCHEMA_VERSION). */
export const SUPPORTED_REPORT_SCHEMA = 1;

/** Thrown for a file that is not a usable report. */
export class DamagedReport extends Error {}

/**
 * Parses and checks a report. Returns the report object.
 * @throws {DamagedReport} with a plain sentence
 */
export function loadReport(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch (err) {
    throw new DamagedReport(`This is not valid JSON (the file may be truncated): ${err.message}`);
  }
  if (report === null || typeof report !== 'object' || Array.isArray(report)) throw new DamagedReport('This is JSON, but not a bug report (expected an object).');
  if (report.schemaVersion !== SUPPORTED_REPORT_SCHEMA) {
    throw new DamagedReport(`Report schema version ${JSON.stringify(report.schemaVersion)} is not one this tool reads (it reads ${SUPPORTED_REPORT_SCHEMA}).`);
  }
  if (typeof report.id !== 'string' || !/^crbug-/.test(report.id)) throw new DamagedReport('The report has no id of the form crbug-YYYYMMDD-HHMMSS-xxxx.');
  if (report.gameState === null) return report; // a report filed from the setup screen: words and environment only
  if (report.gameState === undefined || typeof report.gameState !== 'object' || report.gameState.error !== undefined) {
    throw new DamagedReport(`The report's gameState is missing or damaged${report.gameState && report.gameState.error ? ` (${report.gameState.error})` : ''}.`);
  }
  const rp = report.replay;
  if (!rp || typeof rp !== 'object' || rp.error !== undefined || !Array.isArray(rp.actions) || typeof rp.config !== 'object' || rp.config === null) {
    throw new DamagedReport(`The report's replay record is missing or damaged${rp && rp.error ? ` (${rp.error})` : ''}.`);
  }
  if (typeof report.stateHash !== 'string') throw new DamagedReport('The report has no stateHash.');
  return report;
}

/**
 * Rebuilds the state both ways and compares them.
 * @returns {{ ok: boolean, hashStored: string, hashDeserialised: string|null, hashReplayed: string|null,
 *   deserialised: object|null, replayed: object|null, problems: string[] }}
 */
export function rebuildBothWays(report) {
  const out = { ok: true, hashStored: report.stateHash, hashDeserialised: null, hashReplayed: null, deserialised: null, replayed: null, problems: [] };
  try {
    out.deserialised = deserialiseState(JSON.stringify(report.gameState));
    out.hashDeserialised = hashState(out.deserialised);
  } catch (err) {
    out.problems.push(`Could not load the stored state: ${err.message}`);
  }
  try {
    const rp = report.replay;
    if (rp.base) {
      const state = deserialiseState(rp.base);
      rp.actions.forEach((action, i) => {
        try {
          applyAction(state, action, SILENT);
        } catch (err) {
          throw new Error(`Replay stopped at action ${i + 1} of ${rp.actions.length}: ${err.message}`);
        }
      });
      out.replayed = state;
    } else {
      out.replayed = replayGame(rp.config, rp.actions);
    }
    out.hashReplayed = hashState(out.replayed);
  } catch (err) {
    out.problems.push(`Could not replay config + actions: ${err.message}`);
  }
  if (out.hashDeserialised !== null && out.hashDeserialised !== out.hashStored) out.problems.push(`The stored state hashes to ${out.hashDeserialised}, but the report says ${out.hashStored}.`);
  if (out.hashReplayed !== null && out.hashReplayed !== out.hashStored) out.problems.push(`Replaying config + ${report.replay.actions.length} actions gives ${out.hashReplayed}, not ${out.hashStored}: the replay record or the engine differs from the one that made the report.`);
  out.ok = out.problems.length === 0;
  return out;
}

/** The human or player whose point of view the diagnostics took. */
function reporterOf(report, state) {
  const r = report.diagnostics && report.diagnostics.reporter;
  return r && typeof r.player === 'number' ? r.player : state.toAct ?? 0;
}

/**
 * The block reasons as the CURRENT engine gives them, over the whole action
 * space, asked for `playerId`. Same shape as the stored `byType`, without the
 * example limits: { total, byType: { type: { total, legalNow, legal:[{key,text}], blocked:[{now,structural,count,actions:[{key,text}]}] } } }
 */
export function recomputeReasons(state, playerId) {
  const work = cloneState(state);
  const byType = {};
  const index = new Map(); // key -> { type, now, structural }
  let total = 0;
  for (const action of getActionSpace(work)) {
    total += 1;
    const probe = { ...action, player: playerId };
    let now;
    let structural = null;
    try {
      now = getBlockReason(work, probe);
      structural = now === null ? null : getStructuralBlockReason(work, probe);
    } catch (err) {
      now = `[the engine threw: ${err.message}]`;
    }
    const key = actionKey(action);
    index.set(key, { type: action.type, now, structural });
    const slot = (byType[action.type] ||= { total: 0, legalNow: 0, legal: [], blocked: new Map() });
    slot.total += 1;
    const item = { key, text: describeAction(work, action) };
    if (now === null) {
      slot.legalNow += 1;
      slot.legal.push(item);
    } else {
      const gk = `${now}\u0000${structural}`;
      if (!slot.blocked.has(gk)) slot.blocked.set(gk, { now, structural, count: 0, actions: [] });
      const g = slot.blocked.get(gk);
      g.count += 1;
      g.actions.push(item);
    }
  }
  for (const type of Object.keys(byType)) byType[type].blocked = [...byType[type].blocked.values()].sort((a, b) => b.count - a.count);
  return { total, byType, index };
}

/**
 * Compares the reasons stored in the report with those recomputed now.
 * Only actions the report listed are compared one by one; the per-type counts
 * (total, legal now) are compared for every type.
 * @returns {{ checked: number, differences: string[] }}
 */
export function compareWithStored(report, recomputed) {
  const differences = [];
  let checked = 0;
  const space = report.diagnostics && report.diagnostics.actionSpace;
  if (!space || space.error || !space.byType) return { checked, differences, note: 'The report holds no stored block reasons to compare.' };
  for (const [type, stored] of Object.entries(space.byType)) {
    const now = recomputed.byType[type];
    if (!now) {
      differences.push(`${type}: stored in the report, but the current engine has no such action type.`);
      continue;
    }
    if (stored.total !== now.total) differences.push(`${type}: ${stored.total} actions in the report's action space, ${now.total} now.`);
    if (stored.legalNow !== now.legalNow) differences.push(`${type}: ${stored.legalNow} legal in the report, ${now.legalNow} now.`);
    for (const item of stored.legal || []) {
      checked += 1;
      const r = recomputed.index.get(item.key);
      if (!r || r.now !== null) differences.push(`${item.key}: legal in the report, now blocked: ${r ? r.now : 'not in the action space'}`);
    }
    for (const group of stored.blocked || []) {
      for (const item of group.actions || []) {
        checked += 1;
        const r = recomputed.index.get(item.key);
        if (!r) differences.push(`${item.key}: in the report, not in the action space now.`);
        else if (r.now !== group.now) differences.push(`${item.key}: reason was "${group.now}", now "${r.now}".`);
        else if (r.structural !== group.structural) differences.push(`${item.key}: structural reason was "${group.structural}", now "${r.structural}".`);
      }
    }
  }
  return { checked, differences };
}

/** Controls the UI showed as clickable or lit that the engine did not call legal, and the reverse. */
export function controlFindings(report, recomputed) {
  const out = [];
  const controls = report.diagnostics && report.diagnostics.controls;
  if (!controls || controls.error || !Array.isArray(controls.items)) return out;
  for (const c of controls.items) {
    if (c.kind !== 'action-button') continue;
    const r = recomputed.index.get(c.key);
    if (!r) continue;
    if (c.enabled && r.now !== null) out.push(`UI shows "${c.label}" (${c.key}) as available, but the engine said: ${r.now}`);
    if (!c.enabled && r.now === null) out.push(`UI shows "${c.label}" (${c.key}) as disabled, but the engine says it was legal (block reason null): a UI bug`);
  }
  return out;
}

function printGroups(lines, slot, type, { all }) {
  const groups = all ? slot.blocked : slot.blocked.slice(0, 5);
  for (const g of groups) {
    lines.push(`    x${g.count}  ${g.now}`);
    if (g.structural !== g.now) lines.push(`         (timing aside: ${g.structural === null ? 'nothing in the position forbids it' : g.structural})`);
    const show = all ? g.actions : g.actions.slice(0, 3);
    for (const a of show) lines.push(`         - ${a.key}: ${a.text}`);
    if (show.length < g.actions.length) lines.push(`         ... and ${g.actions.length - show.length} more (use --all)`);
  }
  if (groups.length < slot.blocked.length) lines.push(`    ... and ${slot.blocked.length - groups.length} more groups of reasons (use --all or --type=${type})`);
}

/** The whole printout as an array of lines (so the tests can read it). */
export function describeReport(report, options = {}) {
  const lines = [];
  const w = report.words || {};
  lines.push(`Report ${report.id}  (build ${report.build}, schema ${report.schemaVersion})`);
  lines.push(`Filed ${report.timestamp && report.timestamp.local ? report.timestamp.local : '?'} from the ${report.screen} screen`);
  lines.push('');
  lines.push("The reporter's words");
  lines.push(`  Title:      ${w.title || '(none)'}`);
  lines.push(`  Category:   ${w.category || '(none)'}`);
  lines.push(`  Expected:   ${w.expected || '(none)'}`);
  lines.push(`  Happened:   ${w.actual || '(none)'}`);
  const caps = report.capture && report.capture.sectionsWithErrors;
  if (caps && caps.length > 0) lines.push(`  NOTE: these sections failed while the report was made: ${caps.join(', ')}`);
  if (report.gameState === null) {
    lines.push('');
    lines.push('This report was filed from the setup screen; there is no game to replay.');
    if (report.setupForm) lines.push(`Setup form: ${JSON.stringify(report.setupForm)}`);
    return { lines, exitCode: 0 };
  }

  const built = rebuildBothWays(report);
  lines.push('');
  lines.push('Rebuilding the state both ways');
  lines.push(`  stored hash   ${built.hashStored}`);
  lines.push(`  deserialised  ${built.hashDeserialised ?? 'failed'}${built.hashDeserialised === built.hashStored ? '  (agrees)' : ''}`);
  lines.push(`  replayed      ${built.hashReplayed ?? 'failed'}  (${report.replay.actionCount ?? report.replay.actions.length} actions${report.replay.base ? ' from a loaded base state' : ''})${built.hashReplayed === built.hashStored ? '  (agrees)' : ''}`);
  if (!built.ok) {
    lines.push('');
    lines.push('MISMATCH - this is itself a finding:');
    for (const p of built.problems) lines.push(`  ${p}`);
  }
  const state = built.deserialised || built.replayed;
  if (!state) return { lines, exitCode: 3 };

  const t = report.table || {};
  lines.push('');
  lines.push(`Table: ${(t.seats || []).map((s) => `${s.name} (${s.kind === 'bot' ? `${s.level} bot` : 'human'})`).join(', ')}; seed ${t.seed}; variants not at default: ${t.variantsNotDefault && Object.keys(t.variantsNotDefault).length ? JSON.stringify(t.variantsNotDefault) : 'none'}`);
  lines.push(`Position: action ${state.seq}, phase ${state.phase}, turn ${state.turn.number} (active player ${state.turn.player === null ? '-' : state.players[state.turn.player].name}, step ${state.turn.step})`);
  const reporter = reporterOf(report, state);
  const rd = report.diagnostics && report.diagnostics.reporter;
  lines.push(`Diagnostics are for ${state.players[reporter] ? state.players[reporter].name : `player ${reporter}`}${rd && rd.why ? ` (${rd.why})` : ''}`);
  lines.push('');
  const decision = describeDecision(state);
  lines.push(`Decision pending: ${decision ? `${decision.prompt}  [${decision.kind}]` : 'none (the game is over)'}`);
  const legal = state.phase === 'ended' ? [] : getValidActions(state);
  lines.push(`Legal actions now (${legal.length}):`);
  for (const a of legal.slice(0, options.all ? legal.length : 40)) lines.push(`  - ${actionKey(a)}: ${describeAction(state, a)}`);
  if (!options.all && legal.length > 40) lines.push(`  ... and ${legal.length - 40} more (use --all)`);

  if (state.phase !== 'ended') {
    const re = recomputeReasons(state, reporter);
    lines.push('');
    lines.push(`Block reasons recomputed by the current engine for ${state.players[reporter].name} (${re.total} actions in the action space):`);
    for (const [type, slot] of Object.entries(re.byType)) {
      if (options.type && options.type !== type) continue;
      if (slot.blocked.length === 0 && !options.type) continue;
      lines.push(`  ${type}: ${slot.legalNow} legal of ${slot.total}`);
      printGroups(lines, slot, type, options);
    }
    const cmp = compareWithStored(report, re);
    lines.push('');
    if (cmp.note) lines.push(cmp.note);
    else if (cmp.differences.length === 0) lines.push(`Stored reasons vs current engine: all ${cmp.checked} stored actions agree. The engine has not changed in a way that touches this report.`);
    else {
      lines.push(`Stored reasons vs current engine: ${cmp.differences.length} DIFFERENCE(S) - the engine has changed since this report was made:`);
      for (const d of cmp.differences.slice(0, 60)) lines.push(`  ${d}`);
    }
    const agreement = report.diagnostics && report.diagnostics.actionSpace && report.diagnostics.actionSpace.agreement;
    if (agreement && agreement.ok === false) lines.push(`At report time getValidActions and the block-reason ladder DISAGREED: ${JSON.stringify(agreement)}`);
    for (const f of controlFindings(report, re)) lines.push(`CONTROL FINDING: ${f}`);
  }

  if (options.action) {
    lines.push('');
    const probe = { ...options.action, player: options.action.player ?? reporter };
    lines.push(`Asked about ${JSON.stringify(options.action)} for ${state.players[probe.player] ? state.players[probe.player].name : probe.player}:`);
    try {
      const now = getBlockReason(cloneState(state), probe);
      const structural = now === null ? null : getStructuralBlockReason(cloneState(state), probe);
      lines.push(`  ${describeAction(state, probe)}`);
      lines.push(`  block reason now:  ${now === null ? 'null (it is legal)' : now}`);
      lines.push(`  structural reason: ${structural === null ? 'null (nothing in the position forbids it)' : structural}`);
      lines.push(`  in getValidActions: ${legal.some((a) => actionKey(a) === actionKey(probe)) ? 'yes' : 'no'}`);
    } catch (err) {
      lines.push(`  the engine could not answer: ${err.message}`);
    }
  }
  return { lines, exitCode: built.ok ? 0 : 3 };
}

function parseArgs(argv) {
  const opts = { file: null, all: false, type: null, action: null };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--type=')) opts.type = arg.slice(7);
    else if (arg.startsWith('--action=')) {
      try {
        opts.action = JSON.parse(arg.slice(9));
      } catch (err) {
        throw new DamagedReport(`--action is not valid JSON: ${err.message}`);
      }
    } else if (!arg.startsWith('--') && opts.file === null) opts.file = arg;
    else throw new DamagedReport(`Unknown argument: ${arg}`);
  }
  if (opts.file === null) throw new DamagedReport("Usage: node tools/replay-bug-report.mjs <report.json> [--action='<json>'] [--all] [--type=<actionType>]");
  return opts;
}

/** Runs the tool; returns the exit code (prints to stdout / stderr). */
export function main(argv) {
  let opts;
  let report;
  try {
    opts = parseArgs(argv);
    report = loadReport(fs.readFileSync(opts.file, 'utf8'));
  } catch (err) {
    process.stderr.write(`${err instanceof DamagedReport ? err.message : `Cannot read the report: ${err.message}`}\n`);
    return 2;
  }
  let result;
  try {
    result = describeReport(report, opts);
  } catch (err) {
    process.stderr.write(`The report loaded but could not be analysed: ${err.message}\n`);
    return 2;
  }
  process.stdout.write(`${result.lines.join('\n')}\n`);
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
