// health.mjs - the health-threshold table of the web-board-game skill, as data.
//
// THE THRESHOLDS LIVE HERE AND NOWHERE ELSE. Edit this table to move a limit; the
// aggregates, the terminal summary and the report generator all read the result.
//
// A rule is one of:
//   { kind: 'range', min, max }   pass when min <= value <= max (either end may be null = open)
//   { kind: 'positive' }          pass when value > 0 (a subsystem that is never used is a plumbing bug first)
//   { kind: 'sigma', max }        pass when the seat's |sigma| from the fair share is below max
//   { kind: 'unset' }             no target has been set: status 'n/a' until one is
// The status is 'pass', 'warn' or 'n/a' (the figure does not exist: fast mode, no games, no target).
//
// Source of the numbers: skills/web-board-game "Health thresholds". Two of them are not
// directly defined for a game whose turn is several decisions long, and the notes say how
// this table reads them:
//   - "legal actions per turn" is read at the FIRST decision of a turn (the worker step, where
//     the turn's real choice is made); later decisions of the turn (pay a step, close Congress)
//     are small and would drag a per-decision mean down.
//   - "VP earned in the final quarter" counts the final-scoring VP (buildings, goals, Pony
//     Express tokens) as booked at the very end of the game.

export const HEALTH_TABLE = [
  {
    id: 'winningScore',
    label: 'Winning score',
    unit: 'VP',
    rule: { kind: 'unset' }, // set { kind: 'range', min, max } once there is a design target score
    badReading: 'Inflation is usually a per-piece multiplier.',
    value: (a) => a.winningScore?.mean ?? null,
  },
  {
    id: 'margin',
    label: 'Margin as % of winner',
    unit: '%',
    rule: { kind: 'range', min: 15, max: 22 },
    badReading: 'Above 25 is blowouts.',
    value: (a) => a.marginPct?.mean ?? null,
  },
  {
    id: 'within10',
    label: 'Games inside 10%',
    unit: '%',
    rule: { kind: 'range', min: 25, max: null },
    badReading: 'Endings are not close.',
    value: (a) => (a.within10?.value ?? null) === null ? null : a.within10.value * 100,
  },
  {
    id: 'firstPlayer',
    label: 'First-player win rate',
    unit: '%',
    rule: { kind: 'sigma', max: 2 },
    badReading: 'A positional problem. Never read it without --jitter for deterministic bots.',
    value: (a) => (a.firstPlayer?.winRate ?? null) === null ? null : a.firstPlayer.winRate * 100,
    sigma: (a) => a.firstPlayer?.sigma ?? null,
  },
  {
    id: 'leadChanges',
    label: 'Lead changes per game',
    unit: '',
    rule: { kind: 'range', min: 5, max: null },
    badReading: 'Under 2: the leader is never challenged.',
    value: (a) => a.leadChanges?.mean ?? null,
  },
  {
    id: 'finalQuarter',
    label: 'VP earned in the final quarter (end scoring included)',
    unit: '%',
    rule: { kind: 'range', min: 30, max: null },
    badReading: 'Flat pacing, no climax.',
    value: (a) => (a.vpByQuarter?.finalQuarterWithEndScoring ?? null) === null ? null : a.vpByQuarter.finalQuarterWithEndScoring * 100,
  },
  {
    id: 'legalActions',
    label: 'Legal actions at a turn\'s first decision',
    unit: '',
    rule: { kind: 'range', min: 8, max: 12 },
    badReading: 'Under 5: forced moves. Over 20: analysis paralysis.',
    value: (a) => a.legalActions?.atTurnStart ?? null,
  },
  {
    id: 'distinctTypes',
    label: 'Distinct action types offered at a turn\'s first decision',
    unit: '',
    rule: { kind: 'range', min: 2.5, max: null },
    badReading: 'One obvious move.',
    value: (a) => a.legalActions?.distinctTypesAtTurnStart ?? null,
  },
  {
    id: 'singleSource',
    label: 'Largest single VP source (share of all VP)',
    unit: '%',
    rule: { kind: 'range', min: null, max: 45 },
    badReading: 'The other sources are decoration.',
    value: (a) => (a.largestVpSource?.share ?? null) === null ? null : a.largestVpSource.share * 100,
    detail: (a) => a.largestVpSource?.source ?? null,
  },
  {
    id: 'turnLimit',
    label: 'Games ending by the turn limit (R19.4)',
    unit: 'games',
    rule: { kind: 'range', min: 0, max: 0 },
    badReading: 'Livelock or dead end: investigate, never average away.',
    value: (a) => a.counts.turnLimit,
  },
  {
    id: 'decisionCap',
    label: 'Games hitting the harness decision cap',
    unit: 'games',
    rule: { kind: 'range', min: 0, max: 0 },
    badReading: 'A livelock the harness caught.',
    value: (a) => a.counts.decisionCapHits,
  },
  {
    id: 'refusals',
    label: 'Refused bot actions (and crashes, bookkeeping mismatches)',
    unit: 'games',
    rule: { kind: 'range', min: 0, max: 0 },
    badReading: 'The engine\'s action list and its own mutators disagree: an engine bug.',
    value: (a) => a.counts.refusals + a.counts.errors + a.counts.integrity,
  },
  {
    id: 'usage',
    label: 'Subsystem usage',
    unit: '% of games',
    rule: { kind: 'positive' },
    badReading: 'Zero is a plumbing bug first, a design finding second.',
    expand: (a) => (a.subsystems ?? []).map((s) => ({ suffix: s.id, value: s.value === null ? null : s.value * 100 })),
  },
];

function describeRule(rule) {
  switch (rule.kind) {
    case 'range':
      if (rule.min !== null && rule.max !== null) return rule.min === rule.max ? `exactly ${rule.min}` : `${rule.min} to ${rule.max}`;
      if (rule.min !== null) return `at least ${rule.min}`;
      return `under ${rule.max}`;
    case 'positive':
      return 'above 0';
    case 'sigma':
      return `within ${rule.max} sigma of the fair share 1/players`;
    default:
      return 'no target set';
  }
}

function judge(rule, value, sigma) {
  if (rule.kind === 'unset') return 'n/a';
  if (rule.kind === 'sigma') {
    if (sigma === null || sigma === undefined) return 'n/a';
    return Math.abs(sigma) < rule.max ? 'pass' : 'warn';
  }
  if (value === null || value === undefined) return 'n/a';
  if (rule.kind === 'positive') return value > 0 ? 'pass' : 'warn';
  if (rule.min !== null && value < rule.min) return 'warn';
  if (rule.max !== null) {
    // "under 45" reads as a strict limit; a count row with max 0 reads as "none".
    if (rule.min === null ? value >= rule.max : value > rule.max) return 'warn';
  }
  return 'pass';
}

/**
 * Evaluates the table against an aggregate (the sections of `computeSections` plus `counts`).
 * @returns {object[]} rows: { id, label, value, unit, healthy, status, sigma?, detail?, badReading }
 */
export function evaluateHealth(agg) {
  const rows = [];
  for (const def of HEALTH_TABLE) {
    const base = { id: def.id, label: def.label, unit: def.unit, healthy: describeRule(def.rule), badReading: def.badReading };
    if (def.expand) {
      const items = def.expand(agg);
      for (const item of items) {
        rows.push({ ...base, id: `${def.id}.${item.suffix}`, label: `${def.label}: ${item.suffix}`, value: item.value, status: judge(def.rule, item.value, null) });
      }
      continue;
    }
    const value = def.value(agg);
    const sigma = def.sigma ? def.sigma(agg) : null;
    const row = { ...base, value, status: judge(def.rule, value, sigma) };
    if (def.sigma) row.sigma = sigma;
    if (def.detail) row.detail = def.detail(agg);
    rows.push(row);
  }
  return rows;
}
