// model.mjs - turns one or two simulator result files into the report model: the arms
// (each with the game set it is read from), the comparison rows, the rules that differ
// from default (in words), compatibility warnings and the "never used" list.
//
// Nothing here prints; it only reads the JSON defensively (every section may be missing).

import { isNum, get, arr, obj, humanise, NAMES, itemLabel } from './util.mjs';

// ---------------------------------------------------------------------------
// Engine tables (optional): variant descriptions and defaults, card names.
// The report works without them (older engine, moved files): it then shows ids.
// ---------------------------------------------------------------------------

export async function loadEngineInfo(simDir) {
  const info = { variants: new Map(), rules: null };
  try {
    const v = await import(new URL('../src/engine/variants.js', simDir).href);
    for (const d of v.VARIANTS ?? []) info.variants.set(d.name, d);
  } catch { /* optional */ }
  try {
    const r = await import(new URL('../src/engine/rules.js', simDir).href);
    info.rules = r;
    const fill = (key, list) => {
      for (const x of arr(list)) if (x && x.id && x.name) NAMES[key][x.id] = x.name;
    };
    fill('upgrades', r.UPGRADE_TILES);
    fill('milestones', r.MILESTONE_TILES);
    fill('goals', r.GOAL_CARDS);
    fill('legislative', r.LEGISLATIVE_CARDS);
    fill('pony', r.PONY_CARDS);
  } catch { /* optional */ }
  return info;
}

// ---------------------------------------------------------------------------
// Headline metric info (format, unit, one-line meaning)
// ---------------------------------------------------------------------------

export function headlineInfo(id) {
  const pctInfo = (meaning, unit = '') => ({ kind: 'pct', d: 1, unit, meaning });
  let m;
  if (/^winRate\.firstPlayer$/.test(id)) return { ...pctInfo('Share of games won by whoever moved first.'), curated: true };
  if (/^winRate\.seat\d$/.test(id)) return { ...pctInfo('Share of games this seat won (ties split).'), curated: true };
  if (/^winRate\.type\./.test(id)) return { ...pctInfo('Share of seats of this bot type that won.'), curated: true };
  if (id === 'score.mean') return { kind: 'num', d: 1, unit: 'VP', meaning: 'Average final score of a player.', curated: true };
  if (id === 'score.winning') return { kind: 'num', d: 1, unit: 'VP', meaning: 'Average score of the winner.', curated: true };
  if (id === 'margin.mean') return { kind: 'num', d: 1, unit: '% of winner', meaning: 'How far ahead the winner finished, as a % of their own score.', curated: true };
  if (id === 'margin.within10') return { ...pctInfo('Share of games the winner won by 10% or less.'), curated: true };
  if (id === 'length.mean') return { kind: 'num', d: 1, unit: 'turns each', meaning: 'Turns each player took.', curated: true };
  if (id === 'decisions.perTurn') return { kind: 'num', d: 2, unit: '', meaning: 'Choices a bot makes in one turn.' };
  if (id === 'leadChanges.mean') return { kind: 'num', d: 1, unit: 'per game', meaning: 'Times the player in front changed.', curated: true };
  if (id === 'leaderAtHalf.winRate') return { ...pctInfo('Share of games won by the player leading at half-time.'), curated: true };
  if (/^legal\./.test(id)) return { kind: 'num', d: 1, unit: '', meaning: 'Options available to a bot when it chooses.' };
  if (/^vpShare\./.test(id)) return pctInfo('Share of all VP that came from this source.');
  if (id === 'vp.finalQuarter') return pctInfo('Share of all VP earned in the last quarter plus end scoring.');
  if (id === 'routes.perGame') return { kind: 'num', d: 1, unit: 'routes', meaning: 'Routes claimed on the map in a game.', curated: true };
  if (id === 'completion.rate') return { ...pctInfo('Share of games where someone completed the transcontinental line.'), curated: true };
  if (id === 'unlaidTiles.perPlayer') return { kind: 'num', d: 2, unit: 'tiles', meaning: 'Built tiles a player never laid.' };
  if (/^usage\./.test(id)) return pctInfo('Share of games that used this subsystem.');
  if (id === 'turnLimit.share') return { ...pctInfo('Share of games stopped by the turn limit.'), curated: true };
  if ((m = /^end\.(.+)$/.exec(id))) return pctInfo(`Share of games that ended by: ${m[1]}.`);
  return { kind: 'num', d: 2, unit: '', meaning: '' };
}

// ---------------------------------------------------------------------------
// Rules that differ from default, in words
// ---------------------------------------------------------------------------

function flattenConstants(o, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj(o))) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenConstants(v, p));
    else out.push([p, v]);
  }
  return out;
}

const showVal = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

export function describeRules(arm, info, otherArm) {
  const lines = [];
  for (const [name, value] of Object.entries(obj(arm.variantsNonDefault))) {
    const def = info.variants.get(name);
    const dflt = def ? def.default : otherArm?.variants?.[name];
    lines.push({
      text: `${humanise(name)}: ${showVal(value)}${dflt !== undefined ? ` (default ${showVal(dflt)})` : ''}`,
      detail: def?.description ?? '',
    });
  }
  for (const [path, value] of flattenConstants(arm.constants)) {
    const [group, ...rest] = path.split('.');
    let dflt;
    try {
      let o = info.rules?.[group];
      for (const p of rest) o = o?.[p];
      if (o !== undefined && typeof o !== 'object') dflt = o;
    } catch { /* ignore */ }
    lines.push({ text: `Constant ${path}: ${showVal(value)}${dflt !== undefined ? ` (default ${showVal(dflt)})` : ''}`, detail: 'A tuning constant of the rules table, overridden for this run.' });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Building the model
// ---------------------------------------------------------------------------

function needsAll(arm) {
  const a = arm.aggregate;
  if (!a || !(a.n > 0)) return true;
  if (a.healthBasis) return a.healthBasis === 'all-finished';
  return a.n < 30;
}

function gamesOf(arm, basis) {
  if (!Array.isArray(arm.games) || arm.games.length === 0) return null;
  const list = arm.games.filter((g) => g && !g.failed && Array.isArray(g.scores) && (basis === 'counted' ? g.end !== 'turn-limit' : true));
  return list.length ? list : null;
}

export function validateJson(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.arms) || j.arms.length === 0 || !j.arms[0] || typeof j.arms[0] !== 'object') {
    throw new Error('This does not look like a simulator results file (no "arms" list). Run node sim/sim.mjs first.');
  }
}

export function buildModel(inputs, info) {
  inputs.forEach((x) => validateJson(x.json));
  const warnings = [];
  const raw = [];
  let kind = null;
  if (inputs.length === 1) {
    const j = inputs[0].json;
    raw.push({ arm: j.arms[0], json: j, file: inputs[0].file, role: j.arms.length > 1 ? 'test' : 'single' });
    if (j.arms[1]) {
      raw.push({ arm: j.arms[1], json: j, file: inputs[0].file, role: 'baseline' });
      kind = 'baseline';
    }
  } else {
    inputs.slice(0, 2).forEach((x, i) => raw.push({ arm: x.json.arms[0], json: x.json, file: x.file, role: i === 0 ? 'A' : 'B' }));
    kind = 'files';
    if (inputs[0].json.arms.length > 1) warnings.push('The first file holds a baseline arm as well; only its first (test) arm is used for the two-file comparison.');
    if (inputs[1].json.arms.length > 1) warnings.push('The second file holds a baseline arm as well; only its first (test) arm is used for the two-file comparison.');
  }

  const preferred = kind === 'baseline' ? raw[0].json.comparison?.preferred : null;
  const wantAll = raw.some((r) => needsAll(r.arm)) || preferred === 'all-finished';
  const basis = wantAll ? 'all-finished' : 'counted';

  const arms = raw.map((r, i) => {
    const arm = r.arm;
    let s = wantAll ? arm.aggregateAll ?? arm.aggregate : arm.aggregate;
    s = obj(s);
    const sBasis = s === arm.aggregate ? 'counted' : 'all-finished';
    const run = obj(r.json.run);
    const other = raw.find((x) => x !== r)?.arm;
    const shortName = r.role === 'single' ? 'This run' : r.role === 'test' ? 'Test' : r.role === 'baseline' ? 'Baseline' : r.role === 'A' ? 'A' : 'B';
    const rules = describeRules(arm, info, other);
    let label = shortName;
    if (r.role === 'test') label = `Test (${rules.length ? rules.map((x) => x.text.replace(/ \(default.*$/, '')).join('; ') : 'default rules'})`;
    if (r.role === 'baseline') label = 'Baseline (default rules)';
    if (r.role === 'A' || r.role === 'B') label = `${shortName} (${run.label ?? r.file})`;
    return {
      key: `a${i}`,
      idx: i,
      role: r.role,
      short: shortName,
      label,
      color: `var(--arm${i})`,
      pattern: i === 1 ? 'p-hatch' : null,
      arm,
      json: r.json,
      file: r.file,
      run,
      s,
      basis: sBasis,
      n: isNum(s.n) ? s.n : 0,
      players: isNum(run.players) ? run.players : Array.isArray(s.bySeat) ? s.bySeat.length : null,
      counts: obj(arm.aggregate?.counts ?? arm.aggregateAll?.counts),
      endReasons: obj(arm.aggregate?.endReasons),
      health: arr(arm.aggregate?.health),
      healthBasis: arm.aggregate?.healthBasis ?? (needsAll(arm) ? 'all-finished' : 'counted'),
      games: gamesOf(arm, sBasis),
      rules,
      fixedLayout: (arm.variants?.gridLayout ?? 'fixed') === 'fixed',
    };
  });

  // Compatibility of two separate files
  if (kind === 'files') {
    const [a, b] = arms;
    const diffs = [];
    if (a.run.seed !== b.run.seed) diffs.push(`seeds differ (${a.run.seed} against ${b.run.seed}), so the games are not the same deals`);
    if (a.players !== b.players) diffs.push(`player counts differ (${a.players} against ${b.players})`);
    if (JSON.stringify(arr(a.run.bots).map((x) => x.type)) !== JSON.stringify(arr(b.run.bots).map((x) => x.type))) diffs.push('the bots by seat differ');
    if (a.run.gamesPerArm !== b.run.gamesPerArm) diffs.push(`game counts differ (${a.run.gamesPerArm} against ${b.run.gamesPerArm})`);
    if (a.run.jitter !== b.run.jitter) diffs.push('jitter differs');
    if (a.run.mode !== b.run.mode) diffs.push(`one run is --fast and the other is not (${a.run.mode} against ${b.run.mode})`);
    if (diffs.length) warnings.push(`Two separate files are only comparable if they used the same seeds, bots and player count. Here ${diffs.join('; ')}. Treat every difference below with caution.`);
    else warnings.push('The two files used the same seed, bots and player count, so the games are comparable (the games diverge once a rule differs).');
    if (a.run.engineCommit !== b.run.engineCommit) warnings.push(`The files were made by different engine commits (${a.run.engineCommit ?? 'unknown'} and ${b.run.engineCommit ?? 'unknown'}): a difference may come from engine or bot changes, not only the rules.`);
  }
  if (kind === 'baseline' && arms[0].basis !== arms[1].basis) warnings.push('The two arms are read from different game sets.');

  const model = { kind, arms, basis, warnings, info, files: inputs.map((x) => x.file) };
  model.comparison = kind ? comparisonRows(model) : null;
  return model;
}

// ---------------------------------------------------------------------------
// Comparison rows
// ---------------------------------------------------------------------------

function comparisonRows(model) {
  const [A, B] = model.arms;
  const block = model.kind === 'baseline' ? A.json.comparison?.[model.basis === 'counted' ? 'counted' : 'allFinished'] : null;
  if (block && Array.isArray(block.metrics)) {
    return { source: 'the comparison block of the results file', basis: block.basis ?? model.basis, rows: block.metrics.filter((r) => r && r.id) };
  }
  const ha = obj(A.s.headline);
  const hb = obj(B.s.headline);
  const rows = [];
  for (const [id, h] of Object.entries(ha)) {
    const g = hb[id];
    if (!g || !isNum(h.value) || !isNum(g.value)) continue;
    const diff = h.value - g.value;
    const diffSe = isNum(h.se) && isNum(g.se) ? Math.sqrt(h.se * h.se + g.se * g.se) : null;
    const z = diffSe ? diff / diffSe : null;
    rows.push({ id, label: h.label ?? id, test: h.value, testSe: h.se ?? null, baseline: g.value, baselineSe: g.se ?? null, diff, diffSe, z, exceedsTwoSe: diffSe ? Math.abs(diff) > 2 * diffSe : false });
  }
  return { source: 'computed by this report from the two files (independent samples)', basis: model.basis, rows };
}

// ---------------------------------------------------------------------------
// Modules: uniform item lists, and the "never used" list
// ---------------------------------------------------------------------------

export const MODULES = [
  {
    key: 'upgrades', title: 'Carriage upgrade tiles', list: 'tiles', never: 'neverInstalled',
    usedWord: 'installed', rateLabel: 'Share of games in which at least one player installed it',
    item: (t, n) => ({ id: t.id, used: t.installs, rate: t.rate, n, inPlay: true, detail: `${t.installs} installs in ${n} games` }),
  },
  {
    key: 'milestones', title: 'Milestone tiles', list: 'tiles', never: 'neverClaimed',
    usedWord: 'claimed', rateLabel: 'Share of the games it was in play in which someone claimed it',
    item: (t) => ({ id: t.id, used: t.claimed, rate: t.claimRate, n: t.gamesInPlay, inPlay: t.gamesInPlay > 0, detail: `claimed in ${t.claimed} of ${t.gamesInPlay} games where it was in play` }),
  },
  {
    key: 'goals', title: 'End-game goals', list: 'tiles', never: 'neverPaid',
    usedWord: 'paid out', rateLabel: 'Share of the games it was in play in which it paid someone VP',
    item: (t) => ({ id: t.id, used: t.gamesPaid, rate: t.paidRate, n: t.gamesInPlay, inPlay: t.gamesInPlay > 0, detail: `paid VP in ${t.gamesPaid} of ${t.gamesInPlay} games where it was in play` }),
  },
  {
    key: 'legislative', title: 'Legislative Agenda cards', list: 'cards', never: 'neverInForce',
    usedWord: 'in force', rateLabel: 'Share of games in which this card was the one in force',
    item: (c, n) => ({ id: c.id, used: c.games, rate: n > 0 && isNum(c.games) ? c.games / n : null, n, inPlay: true, detail: `in force in ${c.games} of ${n} games` }),
  },
  {
    key: 'pony', title: 'Pony Express cards', list: 'cards', never: 'neverBought',
    usedWord: 'bought', rateLabel: 'Cards bought per game (a count, not a share)', countRate: true,
    item: (c, n) => ({ id: c.id, used: c.bought, rate: c.perGame, n, inPlay: true, detail: isNum(c.bought) ? `bought ${c.bought} times in ${n} games` : 'purchases not collected in --fast runs' }),
  },
];

/** The module's items in one uniform shape, or null if the module is absent from this file. */
export function moduleItems(s, def) {
  const mod = get(s, `modules.${def.key}`);
  if (!mod || typeof mod !== 'object') return null;
  const list = arr(mod[def.list]);
  const n = isNum(s.n) ? s.n : 0;
  const items = list.filter((x) => x && x.id !== undefined).map((x) => ({ ...def.item(x, n), raw: x }));
  return { mod, items, never: arr(mod[def.never]), neverInPlay: arr(mod.neverInPlay) };
}

/** Everything with zero usage, for the "Never used" block and the verdict. */
export function zeroUsage(arm) {
  const s = arm.s;
  const groups = [];
  for (const def of MODULES) {
    const mi = moduleItems(s, def);
    if (!mi) continue;
    let zero;
    let notInPlay = [];
    if (mi.items.length) {
      zero = mi.items.filter((x) => x.inPlay && x.used === 0).map((x) => ({ id: x.id, text: `${itemLabel(def.key, x.id)}: ${def.usedWord} 0 times (${x.detail})` }));
      notInPlay = mi.items.filter((x) => !x.inPlay).map((x) => x.id);
    } else {
      zero = mi.never.map((id) => ({ id, text: `${itemLabel(def.key, id)}: never ${def.usedWord}` }));
      notInPlay = mi.neverInPlay;
    }
    if (zero.length || notInPlay.length) groups.push({ title: def.title, zero, notInPlay: notInPlay.map((id) => itemLabel(def.key, id)) });
  }
  const sub = arr(s.subsystems).filter((x) => x && x.value === 0).map((x) => ({ id: x.id, text: `${humanise(x.id)}: used in 0 of ${x.n ?? s.n} games` }));
  if (sub.length) groups.push({ title: 'Whole subsystems', zero: sub, notInPlay: [] });
  const acts = arr(s.actionTypesNeverChosen).map((id) => ({ id, text: `${humanise(id)}: no bot ever chose this action type` }));
  if (acts.length) groups.push({ title: 'Action types', zero: acts, notInPlay: [] });
  const congress = arr(get(s, 'congress.neverTaken')).map((id) => ({ id, text: `Congress entry ${id}: never taken` }));
  if (congress.length) groups.push({ title: 'Congress entries', zero: congress, notInPlay: [] });
  const total = groups.reduce((a, g) => a + g.zero.length, 0);
  return { groups, total };
}
