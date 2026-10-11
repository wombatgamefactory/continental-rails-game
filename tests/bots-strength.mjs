// bots-strength.mjs - the full measurement of the heuristic bot. NOT a suite:
// run it by hand (about a minute, one core):
//
//   node tests/bots-strength.mjs            everything, and tests/tmp/medium-game-log.txt
//   node tests/bots-strength.mjs --quick    a quarter of the games
//
// It prints: Medium v Random and Medium v Easy at 2 players with seats
// alternated (win rate, standard error); Medium tables at 2, 3 and 4 players
// (end reasons, turns, scores, VP by source, wins by seat); how often each
// action type is chosen when it is on offer, with every 0% and 100% flagged
// and explained; what the modules were used for; the same table with
// `upgradeVpTiming = on-install`; decision times of Medium and of the
// rollout policy. Every proposal is checked against getValidActions and a
// refusal is fatal.

import { writeEvidence } from './helpers/tmp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createGame,
  getValidActions,
  applyAction,
  isGameOver,
  scoreGame,
  actionKey,
  makeRng,
  forkRng,
  totalVp,
  districtInfo,
  nonDefaultVariants,
  ACTIONS,
  SILENT,
} from '../src/engine/index.js';
import { getBot } from '../src/bots/index.js';
import { describePlan, rolloutBot } from '../src/bots/heuristicBot.js';

const quick = process.argv.includes('--quick');
const scale = quick ? 0.25 : 1;
const started = process.hrtime.bigint();
const out = (text = '') => process.stdout.write(`${text}\n`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const mean = (list) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length);

const medium = getBot('medium');
const easy = getBot('easy');
const random = getBot('random');

/** Why an action type is taken never or always when it is on offer. Printed beside the flag. */
const EXPLAIN = {
  placeRailhead: 'setup: the only action type of the draft (R3.5).',
  chooseStartingProduction: 'setup: the only action type of that decision (R3.6).',
  chooseStartingSpecialist: 'setup: the only action type of that decision (R3.6).',
  chooseResource: 'the only action type of a "resource of your choice" decision.',
  chooseBuiltTile: 'the only action type of a "built tile of your choice" decision.',
  discard: 'the only action type when storage overflows (R8.5.4).',
  chooseDistrict: 'the only action type of the district choice (R4.2 step 3).',
  chooseOption: 'the only action type of a choice between options.',
  chooseForemanType: 'the only action type of that decision (cards 10, 22, 32).',
  chooseSpecialistType: 'the only action type of that decision (card 33).',
  chooseExtraActivation: 'the only action type of that decision (card 15).',
};

function newStats() {
  return {
    games: 0,
    reasons: {},
    turns: [],
    scores: [],
    winnerScores: [],
    bySource: {},
    seatWins: [],
    offered: {},
    chosen: {},
    districts: {},
    entries: {},
    cards: {},
    tiles: {},
    milestones: 0,
    hatsSpent: 0,
    districtChoices: 0,
    times: [],
    decisions: 0,
    players: 0,
    crossings: 0,
    routes: [],
    specialists: [],
    carriages: [],
    buildings: [],
  };
}

/**
 * Plays one game. `bots[configIndex]` plays that seat; `watch(bot)` says
 * whose decisions are counted in `stats` (Medium's). Throws on a refusal.
 */
function playGame(config, bots, stats, watch, timed) {
  const state = createGame(config);
  const rng = makeRng(`strength-bots:${config.seed}`);
  let decisions = 0;
  while (!isGameOver(state)) {
    if (++decisions > 30000) throw new Error(`seed ${config.seed}: the game did not end`);
    const actor = state.toAct;
    const bot = bots[state.players[actor].configIndex % bots.length];
    const counted = stats !== null && watch(bot);
    const valid = counted ? getValidActions(state) : null;
    const ctx = { rng: forkRng(rng), timeBudgetMs: 0, iterations: null, now: null };
    let action;
    if (timed && counted) {
      const t0 = process.hrtime.bigint();
      action = bot.chooseAction(state, ctx);
      stats.times.push(Number(process.hrtime.bigint() - t0) / 1000);
    } else action = bot.chooseAction(state, ctx);
    if (counted) {
      const key = actionKey(action);
      if (!valid.some((a) => actionKey(a) === key)) throw new Error(`seed ${config.seed}: ${key} is not a legal action`);
      const types = new Set(valid.map((a) => a.type));
      for (const t of types) stats.offered[t] = (stats.offered[t] || 0) + 1;
      stats.chosen[action.type] = (stats.chosen[action.type] || 0) + 1;
      stats.decisions += 1;
      if (action.type === 'chooseDistrict' && action.district !== 'none') {
        const name = districtInfo(state, action.district).name;
        stats.districts[name] = (stats.districts[name] || 0) + 1;
        stats.districtChoices += 1;
        if (action.hat) stats.hatsSpent += 1;
      } else if (action.type === 'takeCongressEntry') stats.entries[action.entry] = (stats.entries[action.entry] || 0) + 1;
      else if (action.type === 'buyPonyCard') stats.cards[action.card] = (stats.cards[action.card] || 0) + 1;
      else if (action.type === 'installUpgrade') stats.tiles[action.tile] = (stats.tiles[action.tile] || 0) + 1;
    }
    try {
      applyAction(state, action, SILENT);
    } catch (err) {
      throw new Error(`REFUSED seed ${config.seed}: ${JSON.stringify(action)}: ${err.message}`);
    }
  }
  const score = scoreGame(state);
  if (stats !== null) {
    stats.games += 1;
    stats.reasons[score.endReason] = (stats.reasons[score.endReason] || 0) + 1;
    stats.turns.push(Math.max(...state.players.map((p) => p.turnsTaken)));
    stats.winnerScores.push(score.players[score.winner].total);
    stats.seatWins[score.winner] = (stats.seatWins[score.winner] || 0) + 1;
    if (state.completion !== null) stats.crossings += 1;
    stats.routes.push(Object.values(state.map.routeOwner).filter((o) => o !== null).length);
    if (state.modules.milestones) stats.milestones += Object.values(state.modules.milestones.claimedBy).filter((o) => o !== null).length;
    for (const p of score.players) {
      const pl = state.players[p.id];
      if (!watch(bots[pl.configIndex % bots.length])) continue;
      stats.players += 1;
      stats.scores.push(p.total);
      for (const k in p.bySource) stats.bySource[k] = (stats.bySource[k] || 0) + p.bySource[k];
      stats.specialists.push(pl.train.specialistCarriages.reduce((n, c) => n + c.slots.filter((s) => s !== null).length, 0));
      stats.carriages.push(pl.train.specialistCarriages.length + pl.train.storageCarriages);
      stats.buildings.push(p.tieBreak.buildings);
    }
  }
  return { state, score };
}

function duel(nameA, botA, nameB, botB, games) {
  let wins = 0;
  const margin = [];
  const reasons = {};
  for (let g = 0; g < games; g++) {
    const bots = g % 2 === 0 ? [botA, botB] : [botB, botA];
    const { state, score } = playGame({ playerCount: 2, seed: `strength-${nameA}-${nameB}-${g >> 1}`, shuffleSeats: false }, bots, null, () => false, false);
    const winnerBot = bots[state.players[score.winner].configIndex];
    if (winnerBot === botA) wins += 1;
    const a = score.players.find((p) => bots[state.players[p.id].configIndex] === botA).total;
    const b = score.players.find((p) => bots[state.players[p.id].configIndex] === botB).total;
    margin.push(a - b);
    reasons[score.endReason] = (reasons[score.endReason] || 0) + 1;
  }
  const p = wins / games;
  const se = Math.sqrt((p * (1 - p)) / games);
  out(`${nameA} v ${nameB}, 2 players, seats alternated: ${nameA} wins ${wins} of ${games} = ${pct(p)} (standard error ${pct(se)}); mean margin ${mean(margin).toFixed(1)} VP; ends ${JSON.stringify(reasons)}`);
  return p;
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function timeLine(label, times) {
  const sorted = times.slice().sort((a, b) => a - b);
  return `${label}: mean ${mean(times).toFixed(1)} us, median ${quantile(sorted, 0.5).toFixed(1)} us, p95 ${quantile(sorted, 0.95).toFixed(1)} us, p99 ${quantile(sorted, 0.99).toFixed(1)} us, max ${(sorted[sorted.length - 1] / 1000).toFixed(2)} ms over ${times.length} decisions`;
}

function table(n, games, variants, label) {
  const stats = newStats();
  for (let g = 0; g < games; g++) playGame({ playerCount: n, seed: `strength-table-${n}-${g}`, variants }, [medium], stats, () => true, true);
  const real = stats.games - (stats.reasons['turn-limit'] || 0);
  out(`--- ${label}: ${n} players, ${games} games, every seat Medium ---`);
  out(`end reasons: ${Object.entries(stats.reasons).map(([k, v]) => `${k} ${v} (${pct(v / stats.games)})`).join(', ')}; a real trigger in ${pct(real / stats.games)}`);
  out(`turns per player: mean ${mean(stats.turns).toFixed(1)}, min ${Math.min(...stats.turns)}, max ${Math.max(...stats.turns)}; routes claimed at the end: mean ${mean(stats.routes).toFixed(1)} of 47; a transcontinental line in ${pct(stats.crossings / stats.games)}`);
  out(`final score: mean ${mean(stats.scores).toFixed(1)}, winner's mean ${mean(stats.winnerScores).toFixed(1)}`);
  const total = Object.values(stats.bySource).reduce((a, b) => a + b, 0);
  out(`VP by source, mean per player (share): ${Object.entries(stats.bySource).map(([k, v]) => `${k} ${(v / stats.players).toFixed(1)} (${pct(v / total)})`).join(', ')}`);
  out(`wins by seat: ${Array.from({ length: n }, (_, i) => `seat ${i + 1} ${pct((stats.seatWins[i] || 0) / stats.games)}`).join(', ')} (standard error about ${pct(Math.sqrt(((1 / n) * (1 - 1 / n)) / stats.games))})`);
  out(`at the end, mean per player: ${mean(stats.specialists).toFixed(1)} specialists, ${mean(stats.carriages).toFixed(1)} carriages, ${mean(stats.buildings).toFixed(1)} buildings on the map; milestones claimed per game ${(stats.milestones / stats.games).toFixed(1)}`);
  return stats;
}

function usage(stats) {
  out('action types: chosen / decisions in which the type was on offer = rate; per game');
  const flags = [];
  for (const type of Object.keys(ACTIONS)) {
    const offered = stats.offered[type] || 0;
    const chosen = stats.chosen[type] || 0;
    if (offered === 0) {
      flags.push(`  ${type}: NEVER ON OFFER - ${NEVER_OFFERED[type] || 'unexplained'}`);
      continue;
    }
    const rate = chosen / offered;
    let line = `  ${type.padEnd(26)} ${String(chosen).padStart(7)} / ${String(offered).padStart(7)} = ${pct(rate).padStart(6)}   ${(chosen / stats.games).toFixed(1)} per game`;
    if (chosen === 0) line += `   <-- 0%: ${ZERO[type] || 'UNEXPLAINED'}`;
    else if (chosen === offered) line += `   <-- 100%: ${EXPLAIN[type] || ALWAYS[type] || 'UNEXPLAINED'}`;
    out(line);
  }
  for (const f of flags) out(f);
  out(`districts chosen (share of turns): ${Object.entries(stats.districts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / stats.districtChoices)}`).join(', ')}; a hat spent on ${pct(stats.hatsSpent / stats.districtChoices)} of turns`);
  out(`Congress entries taken per game: ${Object.entries(stats.entries).sort().map(([k, v]) => `${k} ${(v / stats.games).toFixed(2)}`).join(', ') || 'none'}`);
  out(`upgrade tiles installed per game: ${Object.entries(stats.tiles).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / stats.games).toFixed(2)}`).join(', ') || 'none'}`);
  const cards = Object.entries(stats.cards).sort((a, b) => b[1] - a[1]);
  out(`Pony Express cards bought per game: ${(cards.reduce((a, c) => a + c[1], 0) / stats.games).toFixed(2)} (${cards.length} different cards; most often ${cards.slice(0, 8).map(([k, v]) => `${k} ${(v / stats.games).toFixed(2)}`).join(', ')})`);
}

/** Types that can be on offer and were never chosen, with the reason if it is known to be sound. */
const ZERO = {
  skipBuilding:
    'a free building on arrival is never declined: every building scores at least 2 VP in the end-game table (R20.3) and costs nothing. The paid building after a move is decided when the MOVE is chosen, so a move to a city where the bot would not pay is not made for the building.',
  declineFreeEntry: 'Legislative Agenda card 20 only; a free Congress entry is taken whenever one is worth anything.',
  skipEffect: 'an optional part of a card is declined only when it is worth nothing to the bot.',
};
const ALWAYS = {
  addCarriage:
    'selection, not a stuck scorer: the bot goes to Gather Coins (3% of turns) mostly WHEN it wants a carriage, so the bonus is nearly always taken once it is on offer; the other source is a card or Congress C4 chosen for the carriage. Expect under 100% in longer runs.',
  installUpgrade: 'selection: Gather Gunpowder is often chosen for the tile; and a tile costs 1 Iron for a lasting effect.',
  hireSpecialist: 'selection: Gather Iron is often chosen for the hire.',
  useStep: 'steps that cannot be paid are skipped by the engine and never reach the bot; the bot picks a train district when it has tiles to build.',
};
const NEVER_OFFERED = {
  declineFreeEntry: 'needs Legislative Agenda card 20 in force and a Congress entry taken.',
  chooseSpecialistType: 'needs Pony Express card 33 to be bought.',
  chooseExtraActivation: 'needs Pony Express card 15 to be owned.',
  returnResource: 'needs Pony Express card 11 to be bought.',
  usePonyCard: 'needs Pony Express card 14 or 28 to be owned.',
  skipEffect: 'needs a card with an optional part to be bought.',
};

// --- a readable log of one game ---------------------------------------------------------

const SHORT = { iron: 'Fe', wood: 'Wd', gunpowder: 'Gp', coins: 'c', hats: 'hat', ground: 'G', tunnel: 'T', bridge: 'B' };

function holdingsText(p) {
  const r = p.resources;
  const t = p.builtTiles;
  return `Fe${r.iron} Wd${r.wood} Gp${r.gunpowder} | G${t.ground} T${t.tunnel} B${t.bridge} | ${p.coins}c ${p.hats}hat`;
}

/** Plays one game with every seat the same level and returns its log as text, one line per turn. */
export function gameLog({ playerCount = 3, seed = 'medium-log-1', level = 'medium', variants = {} } = {}) {
  const state = createGame({ playerCount, seed, variants });
  const rng = makeRng(`bots:${seed}`);
  const bot = getBot(level);
  const lines = [];
  lines.push(`Continental Rails - one ${playerCount}-player game, every seat the ${level} bot. Seed "${seed}".`);
  lines.push(`Variants away from default: ${JSON.stringify(nonDefaultVariants(state.variants))}`);
  lines.push(`Milestones in play ${JSON.stringify(state.modules.milestones ? state.modules.milestones.inPlay : [])}; Legislative Agenda card ${state.modules.legislative ? state.modules.legislative.card : '-'}.`);
  lines.push('Each line is one turn: the worker step; the district and its multiplier; what happened; VP gained; then the player\'s total VP and storage after the turn,');
  lines.push('and in brackets the plan the bot had when the turn began (the route it aims for, the next one, the turns it expects are left).');
  lines.push('Fe iron, Wd wood, Gp gunpowder; G / T / B are BUILT Ground / Tunnel / Bridge tiles in storage (not yet laid); c Coins. "build" = a tile built on the train; "CLAIM" = tiles laid on the map.');
  lines.push('');
  let turnKey = null;
  let parts = [];
  let planText = '';
  let vpBefore = 0;
  let active = null;
  const flush = () => {
    if (turnKey === null) return;
    const p = state.players[active];
    const gained = totalVp(p) - vpBefore;
    lines.push(`T${String(turnKey).padStart(3)} P${active + 1} ${parts.join('; ')}${gained ? `  [+${gained} VP]` : ''}  => ${totalVp(p)} VP, ${holdingsText(p)}${planText}`);
  };
  let setupDone = false;
  while (!isGameOver(state)) {
    if (state.phase === 'play' && state.turn.number !== turnKey) {
      flush();
      turnKey = state.turn.number;
      active = state.turn.player;
      parts = [];
      vpBefore = totalVp(state.players[active]);
      const plan = describePlan(state);
      planText = plan && plan.target1 ? `  (aim ${plan.target1.route}${plan.target2 ? ', then ' + plan.target2.route : ''}; ${plan.turnsLeft} turns left est.)` : '';
    }
    const action = bot.chooseAction(state, { rng: forkRng(rng), timeBudgetMs: 0, iterations: null, now: null });
    const events = applyAction(state, action);
    if (state.phase !== 'setup' && !setupDone) {
      setupDone = true;
      for (const p of state.players) {
        const spec = p.train.specialistCarriages[0].slots[0];
        const track = Object.keys(p.houses).find((k) => p.houses[k] === 2);
        lines.push(`Setup P${p.id + 1}: railheads ${p.railheads.join(' + ')}, production 2 on ${track}, starts with a ${spec}; ${holdingsText(p)}`);
      }
      lines.push('');
    }
    for (const e of events) {
      const who = e.player !== undefined && e.player !== active ? `P${e.player + 1} ` : '';
      switch (e.type) {
        case 'action':
          if (e.auto) {
            // A forced move is still part of the story of the turn.
            if (e.action.type === 'removeWorker') parts.push(`remove ${e.action.from} (forced)`);
            else if (e.action.type === 'placeWorker') parts.push(`place ${e.action.space} (forced)`);
            else if (e.action.type === 'moveTrain') parts.push(`move ${e.action.from}->${e.action.to} (forced)`);
            break;
          }
          if (e.action.type === 'placeWorker') parts.push(`place ${e.action.space}`);
          else if (e.action.type === 'removeWorker') parts.push(`remove ${e.action.from}`);
          else if (e.action.type === 'displaceWorker') parts.push(`DISPLACE onto ${e.action.district}`);
          else if (e.action.type === 'moveTrain') parts.push(`move ${e.action.from}->${e.action.to}`);
          else if (e.action.type === 'buyPonyCard') parts.push(`buy card ${e.action.card}`);
          else if (e.action.type === 'exchangeToken') parts.push(`token->${SHORT[e.action.resource]}`);
          else if (e.action.type === 'usePonyCard') parts.push(`use card ${e.action.card}`);
          else if (e.action.type === 'discard') parts.push(`${who}DISCARD ${SHORT[e.action.item]}`);
          else if (e.action.type === 'stopLaying') parts.push('stop');
          break;
        case 'districtChosen':
          parts.push(`${districtInfo(state, e.district).name} x${e.multiplier}${e.hat ? ' (hat)' : ''}:`);
          break;
        case 'gather':
          parts.push(`+${e.amount} ${SHORT[e.item]}`);
          break;
        case 'build':
          parts.push(`build ${SHORT[e.terrain]}`);
          break;
        case 'congressEntry':
          parts.push(`Congress ${e.entry}${e.free ? ' (free)' : ''}`);
          break;
        case 'routeClaimed':
          parts.push(`CLAIM ${e.route} (${e.slots} slots)`);
          break;
        case 'firstConnection':
          parts.push(`first connection ${e.city}`);
          break;
        case 'buildingPlaced':
          parts.push(e.kind === 'railwayStation' ? `railway station ${e.city} (house off ${e.houseTrack})` : `telegraph station ${e.city}`);
          break;
        case 'hire':
          if (e.cause !== 'setup') parts.push(`hire ${e.specialist} (level ${e.level})`);
          break;
        case 'carriageAdded':
          parts.push(`add ${e.carriage} carriage`);
          break;
        case 'upgradeInstalled':
          parts.push(`install ${e.tile} (level ${e.level})`);
          break;
        case 'milestoneClaimed':
          parts.push(`${who}MILESTONE ${e.name} +${e.vp}`);
          break;
        case 'toll':
          parts.push(`toll to P${e.player + 1}`);
          break;
        case 'completion':
          parts.push(`TRANSCONTINENTAL LINE +${e.bonus}`);
          break;
        case 'gameEndTriggered':
          parts.push(`<< game end triggered: ${e.reason} >>`);
          break;
        case 'gain':
          if (e.cause && (e.cause === 'bonus:hat' || /^upgrade|^congress|^pony|^legislative|displacement|hatLimit/.test(e.cause))) {
            parts.push(`${who}+${e.amount} ${e.built ? 'built ' : ''}${SHORT[e.item] || e.item}`);
          }
          break;
        default:
          break;
      }
    }
  }
  flush();
  const score = scoreGame(state);
  lines.push('');
  lines.push(`Game over: ${score.endReason}. Turns per player ${state.players.map((p) => p.turnsTaken).join('/')}.`);
  for (const p of score.players) {
    const src = Object.entries(p.bySource).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v}`).join(', ');
    const pl = state.players[p.id];
    const train = pl.train.specialistCarriages.map((c) => `[${c.slots.map((s) => s || '-').join(',')}]`).join('');
    lines.push(`P${p.id + 1}${p.id === score.winner ? ' (winner)' : ''}: ${p.total} VP - ${src}. Train ${train} + ${pl.train.storageCarriages} storage; upgrade tiles ${JSON.stringify(state.modules.upgrades ? state.modules.upgrades.installed[p.id] : [])}`);
  }
  return `${lines.join('\n')}\n`;
}

// --- the run ------------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const G2 = Math.round(200 * scale);
  const G = Math.round(100 * scale);
  out(`Continental Rails - heuristic bot strength${quick ? ' (--quick)' : ''}`);
  out('');
  out('=== strength ===');
  const pRandom = duel('Medium', medium, 'Random', random, G2);
  const pEasy = duel('Medium', medium, 'Easy', easy, G2);
  duel('Easy', easy, 'Random', random, G);
  out(`targets: Medium v Random at least 90% - ${pRandom >= 0.9 ? 'MET' : 'NOT MET'}; Medium v Easy at least 60% - ${pEasy >= 0.6 ? 'MET' : 'NOT MET'}`);
  out('');
  out('=== Medium tables, default variants ===');
  const all = newStats();
  const tables = {};
  for (const n of [4, 3, 2]) {
    const s = table(n, G, {}, 'default variants');
    tables[n] = s;
    for (const k of ['offered', 'chosen', 'districts', 'entries', 'cards', 'tiles']) for (const x in s[k]) all[k][x] = (all[k][x] || 0) + s[k][x];
    all.games += s.games;
    all.districtChoices += s.districtChoices;
    all.hatsSpent += s.hatsSpent;
    all.times.push(...s.times);
    out('');
  }
  out('=== what Medium does (the three default tables together) ===');
  usage(all);
  out('');
  out('=== the same tables with upgradeVpTiming = on-install (is Medium a one-trick instrument?) ===');
  for (const n of [4, 3]) {
    table(n, G, { upgradeVpTiming: 'on-install' }, 'upgradeVpTiming = on-install');
    out('');
  }
  out('=== decision time ===');
  out(timeLine('Medium (all decisions of the default tables)', all.times));
  for (const n of [4, 2]) out(timeLine(`Medium, ${n} players`, tables[n].times));
  const roll = newStats();
  for (let g = 0; g < G; g++) playGame({ playerCount: 4, seed: `strength-roll-${g}` }, [rolloutBot], roll, () => true, true);
  out(timeLine('rolloutPolicy, 4 players', roll.times));
  out(`rolloutPolicy games: ends ${JSON.stringify(roll.reasons)}, turns ${mean(roll.turns).toFixed(1)}; Medium is ${(mean(all.times) / mean(roll.times)).toFixed(1)} times slower than the rollout policy`);
  out('');
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'tmp');
  const file = join(dir, 'medium-game-log.txt');
  writeEvidence(file, gameLog({ playerCount: 3, seed: 'medium-log-1' })); // a locked stale file is skipped, not fatal
  out(`one 3-player Medium game, turn by turn: ${file}`);
  out(`total time ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}
