// conditions.js - the measures of the goal tiles (P18.2), and the small
// interpreter the contract asks every engine for (metricValue,
// evaluateCondition, describeProgress). An unknown metric is false, never true.

import { railwayStationCount, telegraphStationCount, specialistCounts, districtHouseCount, installedUpgrades } from './queries.js';

/** P18.2. Each goal's measure, by name: (state, playerId) => number. "In storage" is the storage as it stands. */
export const METRICS = {
  railwayStations: (state, pid) => railwayStationCount(state, pid),
  crew: (state, pid) => specialistCounts(state, pid).crew, // the Foreman never counts
  financiers: (state, pid) => specialistCounts(state, pid).financier,
  ironStored: (state, pid) => state.players[pid].resources.iron,
  telegraphStations: (state, pid) => telegraphStationCount(state, pid),
  engineers: (state, pid) => specialistCounts(state, pid).engineer,
  coinsStored: (state, pid) => state.players[pid].coins,
  gunpowderStored: (state, pid) => state.players[pid].resources.gunpowder,
  districtHouses: (state, pid) => districtHouseCount(state, pid), // district houses on building sites, not railway stations
  miners: (state, pid) => specialistCounts(state, pid).miner,
  woodStored: (state, pid) => state.players[pid].resources.wood,
  upgradesInstalled: (state, pid) => installedUpgrades(state, pid).length,
};

/** Words for a measure, for describeProgress. */
const UNITS = {
  railwayStations: ['railway station', 'railway stations'],
  crew: ['Crew', 'Crew'],
  financiers: ['Financier', 'Financiers'],
  ironStored: ['Iron in storage', 'Iron in storage'],
  telegraphStations: ['telegraph station', 'telegraph stations'],
  engineers: ['Engineer', 'Engineers'],
  coinsStored: ['Coin in storage', 'Coins in storage'],
  gunpowderStored: ['Gunpowder in storage', 'Gunpowder in storage'],
  districtHouses: ['district house', 'district houses'],
  miners: ['Miner', 'Miners'],
  woodStored: ['Wood in storage', 'Wood in storage'],
  upgradesInstalled: ['upgrade token', 'upgrade tokens'],
};

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

/**
 * A player's progress on an item with a `metric` (a goal tile): `{ known, value,
 * target, met, text }`. Goals have no target: `met` is false and `text` is the
 * measure, for example "3 railway stations".
 */
export function describeProgress(state, playerId, item) {
  const metric = item && item.metric;
  const value = metric ? metricValue(state, playerId, metric) : null;
  if (value === null) return { known: false, value: null, target: null, met: false, text: 'Not tracked' };
  const [one, many] = UNITS[metric];
  return { known: true, value, target: null, met: false, text: `${value} ${value === 1 ? one : many}` };
}
