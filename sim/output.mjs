// output.mjs - where results go and how they are written.
//
// Never overwrites: an existing file name gets -2, -3, ... and the file is created with the
// exclusive flag, so two runs started in the same minute cannot both claim one name.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { round } from './stats.mjs';

/** Date parts in Europe/London. */
export function londonParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** "20261011-1405" in Europe/London. */
export function fileStamp(date) {
  const p = londonParts(date);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

/** "11/10/2026 14:05". */
export function ukDateTime(date) {
  const p = londonParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** The short git commit of the repo and whether src/ has uncommitted changes. Read-only; null when git is not available. */
export function engineCommit(repoRoot) {
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  try {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    let dirty = false;
    try {
      dirty = git(['status', '--porcelain', '--', 'src/engine', 'src/bots']).length > 0;
    } catch {
      dirty = false;
    }
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

/**
 * Creates `file` (or file-2, file-3, ...) with `text` and returns the path used.
 * Uses the exclusive flag, so an existing file is never touched.
 */
export function writeUnique(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  for (let n = 1; n < 10000; n++) {
    const candidate = n === 1 ? file : `${base}-${n}${ext}`;
    try {
      fs.writeFileSync(candidate, text, { flag: 'wx' });
      return candidate;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not find a free name for ${file}.`);
}

const roundReplacer = (key, value) => (typeof value === 'number' ? round(value, 6) : value);

/**
 * JSON text of a result: everything indented, except that each game record sits on one line
 * (a 5,000-game file would otherwise run to a million lines). Numbers are rounded to 6
 * decimals; key order is the order the objects were built in, which is deterministic.
 */
export function serialise(result) {
  const held = [];
  const shell = {
    ...result,
    arms: result.arms.map((arm) => {
      if (!arm.games) return arm;
      held.push(arm.games);
      return { ...arm, games: `@@GAMES${held.length - 1}@@` };
    }),
  };
  let text = JSON.stringify(shell, roundReplacer, 1);
  held.forEach((games, i) => {
    const body = games.map((g) => ` ${JSON.stringify(g, roundReplacer)}`).join(',\n');
    text = text.replace(`"@@GAMES${i}@@"`, () => (games.length === 0 ? '[]' : `[\n${body}\n ]`));
  });
  return `${text}\n`;
}
