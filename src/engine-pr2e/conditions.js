// conditions.js - the interpreter for declarative conditions.
//
// This ruleset has no milestones, cards or Legislative Agenda, so there is
// nothing to interpret yet. PART 2: the goal tiles (P18.2) will add their
// measures to METRICS. The functions are kept because the contract and the
// page ask every engine for them (describeProgress, metricValue,
// evaluateCondition); an unknown metric is false, never true.

/** Measures by name. PART 2: the twelve goal measures of P18.2. */
export const METRICS = {};

/** The value of a metric for a player, or null when the metric is not known. */
export function metricValue(state, playerId, metric) {
  const m = METRICS[metric];
  return m ? m(state, playerId) : null;
}

/** Whether a condition `{ metric, op, value }` holds. An unknown metric is false. */
export function evaluateCondition(state, playerId, condition) {
  const v = metricValue(state, playerId, condition.metric);
  if (v === null) return false;
  switch (condition.op) {
    case '>=':
      return v >= condition.value;
    case '<=':
      return v <= condition.value;
    case '==':
      return v === condition.value;
    case '>':
      return v > condition.value;
    case '<':
      return v < condition.value;
    default:
      return false;
  }
}

/** Progress towards an item. Nothing is tracked in part 1. */
export function describeProgress(state, playerId, item) {
  void state;
  void playerId;
  void item;
  return { known: false, value: null, target: null, met: false, text: 'Not tracked' };
}
