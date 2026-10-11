// sections-b.mjs - the second half of the chart sections: what players do, the map,
// the economy and the add-on modules (with the "never used" block).

import { barV, barH, rangeH, diffH } from './svg.mjs';
import { fig, table, armLabel, metric, section, swatch } from './html.mjs';
import { series } from './sections-a.mjs';
import { MODULES, moduleItems, zeroUsage } from './model.mjs';
import {
  esc, isNum, pct, fixed, count, arr, obj, get, propSe, actionLabel, kindLabel, districtLabel, resLabel, bonusLabel, humanise, itemLabel, int, pp,
} from './util.mjs';

const multi = (M) => M.arms.length > 1;
const armTitle = (M, a, text) => (multi(M) ? `${a.short} - ${text}` : text);
const dash = '-';

// ---------------------------------------------------------------------------
// What players do
// ---------------------------------------------------------------------------

export function actionsSection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);

  // Action mix
  if (M.arms.some((a) => a.s.actionMix?.share)) {
    const ids = [...new Set(M.arms.flatMap((a) => Object.keys(obj(a.s.actionMix?.share))))];
    const peak = (id) => Math.max(...M.arms.map((a) => a.s.actionMix?.share?.[id] ?? 0));
    ids.sort((x, y) => peak(y) - peak(x));
    const top = ids.slice(0, 14);
    const rows = top.map((id) => ({ label: actionLabel(id), values: M.arms.map((a) => ({ v: a.s.actionMix?.share?.[id] ?? null, tip: `${a.short}: ${actionLabel(id)}: ${pct(a.s.actionMix?.share?.[id])} of chosen actions (${count(a.s.actionMix?.counts?.[id])})` })) }));
    const svg = barH({ label: 'Action mix', rows, series: ser, xFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), xLabel: 'Share of actions the bots chose (%)' });
    const trows = ids.map((id) => [actionLabel(id), id, ...M.arms.flatMap((a) => [count(a.s.actionMix?.counts?.[id]), pct(a.s.actionMix?.share?.[id])])]);
    const forced = M.arms.map((a) => `${multi(M) ? `${esc(a.short)}: ` : ''}${pct(a.s.actionMix?.forcedShare)} of all applied actions were forced (only one legal action, so the bot never chose them and they are not in this chart)`).join('; ');
    parts.push(fig(M, {
      title: 'What do the bots actually do with their turns?',
      sub: `The ${top.length} most common action types the bots chose, as a share of all choices. The full list is under Exact figures. ${forced}.`,
      svg, table: table(['Action', 'Engine id', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}times chosen`, 'share'])], trows),
      badge: { n: (a) => a.s.actionMix ? Object.values(obj(a.s.actionMix.counts)).reduce((t, x) => t + x, 0) : 0, unit: 'chosen actions' },
    }));
  } else notes.push('The action mix is not in this file.');

  // Districts
  if (M.arms.some((a) => a.s.districts?.share)) {
    const ids = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', ...[...new Set(M.arms.flatMap((a) => Object.keys(obj(a.s.districts?.share))))].filter((k) => !/^D[1-9]$/.test(k))];
    const fixedLayout = M.arms.every((a) => a.fixedLayout);
    const rows = ids.map((id) => ({ label: districtLabel(id, fixedLayout), values: M.arms.map((a) => ({ v: a.s.districts?.share?.[id] ?? 0, tip: `${a.short}: ${districtLabel(id, fixedLayout)}: ${pct(a.s.districts?.share?.[id])}` })) }));
    const svg = barH({ label: 'District usage', rows, series: ser, xFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), xLabel: 'Share of district choices (%)' });
    const trows = ids.map((id) => [districtLabel(id, fixedLayout), ...M.arms.flatMap((a) => [count(a.s.districts?.counts?.[id] ?? 0), pct(a.s.districts?.share?.[id] ?? 0)])]);
    parts.push(fig(M, {
      title: 'Which districts do players use?',
      sub: `Share of all district choices (forced choices included).${fixedLayout ? '' : ' The grid layout is shuffled in this run, so D1 to D9 are board positions, not fixed districts.'} A district chosen far less than the others is one to look at: is it the rule, or is the bot ignoring it?`,
      svg, table: table(['District', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}times chosen`, 'share'])], trows),
      badge: { n: (a) => a.s.districts ? Object.values(obj(a.s.districts.counts)).reduce((t, x) => t + x, 0) : 0, unit: 'district choices' },
    }));
  } else notes.push('District usage is not in this file (a --fast run does not collect it).');

  // Legal actions
  if (M.arms.some((a) => a.s.legalActions)) {
    const rowsA = [];
    const rowsB = [];
    for (const [label, key, seKey, target] of [['At a turn\'s first decision', 'atTurnStart', 'atTurnStartSe', rowsA], ['At every decision', 'perDecision', 'perDecisionSe', rowsA]]) {
      for (const a of M.arms) if (isNum(a.s.legalActions?.[key])) target.push({ label: armTitle(M, a, label), color: a.color, pattern: a.pattern, mean: a.s.legalActions[key], se: a.s.legalActions[seKey], tip: `${a.short}: ${label}: ${fixed(a.s.legalActions[key], 1)} legal actions` });
    }
    for (const [label, key, seKey] of [['At a turn\'s first decision', 'distinctTypesAtTurnStart', 'distinctTypesAtTurnStartSe'], ['At every decision', 'distinctTypesPerDecision', 'distinctTypesPerDecisionSe']]) {
      for (const a of M.arms) if (isNum(a.s.legalActions?.[key])) rowsB.push({ label: armTitle(M, a, label), color: a.color, pattern: a.pattern, mean: a.s.legalActions[key], se: a.s.legalActions[seKey], tip: `${a.short}: ${label}: ${fixed(a.s.legalActions[key], 2)} action types` });
    }
    const nPlay = (a) => a.s.legalActions?.playDecisions ?? 0;
    const tblL = table([...(multi(M) ? [''] : []), 'Legal actions at first decision of a turn', 'Std error', 'Legal actions per decision', 'Distinct action types at first decision', 'Distinct types per decision', 'Largest list offered', 'Decisions counted'],
      M.arms.map((a) => [...(multi(M) ? [armLabel(a)] : []), fixed(a.s.legalActions?.atTurnStart, 2), fixed(a.s.legalActions?.atTurnStartSe, 3), fixed(a.s.legalActions?.perDecision, 2), fixed(a.s.legalActions?.distinctTypesAtTurnStart, 2), fixed(a.s.legalActions?.distinctTypesPerDecision, 2), count(a.s.legalActions?.max), count(a.s.legalActions?.playDecisions)]));
    if (rowsA.length) {
      parts.push(fig(M, {
        title: 'How many legal moves does a player have?',
        sub: 'The number of legal actions on offer when a bot chooses. The turn\'s real choice is its first decision. Healthy is 8 to 12 (shaded): under 5 is forced moves, over 20 is analysis paralysis. The bar is plus or minus 2 standard errors of the mean.',
        svg: rangeH({ label: 'Legal actions', rows: rowsA, band: { from: 8, to: 12, label: 'Healthy: 8 to 12' }, xLabel: 'Legal actions on offer' }), table: tblL, badge: { n: nPlay, unit: 'play decisions' },
      }));
    }
    if (rowsB.length) {
      parts.push(fig(M, {
        title: 'How many different kinds of action are on offer?',
        sub: 'Distinct action types among the legal actions. Healthy is 2.5 or more; one type means one obvious move.',
        svg: rangeH({ label: 'Distinct action types', rows: rowsB, band: { from: 2.5, to: null, label: 'Healthy: 2.5 or more' }, xLabel: 'Distinct action types on offer', xFmt: (v) => fixed(v, 1) }), badge: { n: nPlay, unit: 'play decisions' },
      }));
    }
    const kinds = [...new Set(M.arms.flatMap((a) => Object.keys(obj(a.s.legalActions?.byKind))))];
    if (kinds.length) {
      kinds.sort((x, y) => Math.max(...M.arms.map((a) => a.s.legalActions?.byKind?.[y]?.meanLegal ?? 0)) - Math.max(...M.arms.map((a) => a.s.legalActions?.byKind?.[x]?.meanLegal ?? 0)));
      const rows = kinds.map((k) => ({ label: kindLabel(k), values: M.arms.map((a) => ({ v: a.s.legalActions?.byKind?.[k]?.meanLegal ?? null, tip: `${a.short}: ${kindLabel(k)}: ${fixed(a.s.legalActions?.byKind?.[k]?.meanLegal, 1)} legal actions over ${count(a.s.legalActions?.byKind?.[k]?.decisions)} decisions` })) }));
      parts.push(fig(M, {
        title: 'Which kinds of decision offer the most options?',
        sub: 'Mean legal actions at each kind of decision a turn is made of (worker step, district choice, laying track and so on).',
        svg: barH({ label: 'Legal actions by kind of decision', rows, series: ser, xFmt: (v) => fixed(v, 0), valueFmt: (v) => fixed(v, 1), xLabel: 'Mean legal actions' }),
        table: table(['Kind of decision', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}decisions`, 'mean legal actions', 'mean distinct types'])], kinds.map((k) => [kindLabel(k), ...M.arms.flatMap((a) => { const x = a.s.legalActions?.byKind?.[k]; return [count(x?.decisions), fixed(x?.meanLegal, 2), fixed(x?.meanDistinctTypes, 2)]; })])),
        badge: { n: nPlay, unit: 'play decisions' },
      }));
    }
  } else notes.push('Legal-action counts are not in this file (a --fast run does not collect them).');

  if (!parts.length) return section('actions', 'What players do', '', [], notes);
  return section('actions', 'What players do', 'What the bots chose, which districts they used and how many options they had. Remember these describe the bots.', parts, notes);
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export function mapSection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);

  if (M.arms.some((a) => a.s.routes?.byLength)) {
    const lens = [...new Set(M.arms.flatMap((a) => Object.keys(obj(a.s.routes?.byLength))))].sort((x, y) => x - y);
    const avail = obj(M.arms[0].s.routes?.available?.byLength);
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: lens.map((l) => a.s.routes?.byLength?.[l] ?? null), tips: lens.map((l) => `${a.short}: ${a.s.routes?.byLength?.[l] !== undefined ? fixed(a.s.routes.byLength[l], 2) : dash} routes of ${l} slots per player`) }));
    const svg = barV({ label: 'Routes claimed by length', categories: lens.map((l) => `${l}-slot routes (${avail[l] ?? '?'} on the map)`), series: sers, yFmt: (v) => fixed(v, 1), valueFmt: (v) => fixed(v, 2), yLabel: 'Routes claimed per player', xLabel: 'Route length (slots) and how many such routes the map has', height: 300 });
    const trows = lens.map((l) => [`${l} slots`, avail[l] ?? dash, ...M.arms.map((a) => fixed(a.s.routes?.byLength?.[l], 2))]);
    parts.push(fig(M, {
      title: 'Which routes do players claim?',
      sub: 'Mean number of routes a player claimed, by route length (a route is claimed whole, all at once). Each route is exclusive: once claimed, nobody else can use it.',
      svg, table: table(['Route length', 'Routes on the map', ...M.arms.map((a) => `${a.short}: claimed per player`)], trows), badge: { n: (a) => (a.s.routes?.perGame?.n ?? a.n) * (a.players ?? 1), unit: 'player-games' },
      after: `<p class="sub">${M.arms.map((a) => `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}${metric('routes.perGame', a, a.s.routes?.perGame?.mean, fixed(a.s.routes?.perGame?.mean, 1), 'f1').html} routes claimed per game out of ${esc(String(a.s.routes?.available?.routes ?? '?'))} (${pct(a.s.routes?.fillShare)} of the map); ${fixed(a.s.routes?.perPlayerWinners, 2)} routes per winner against ${fixed(a.s.routes?.perPlayerRest, 2)} per other player.`).join('<br>')}</p>`,
    }));
    const terr = ['ground', 'tunnel', 'bridge'];
    const sers2 = M.arms.map((a, ai) => ({ ...ser[ai], values: terr.map((t) => a.s.routes?.slotsByTerrain?.[t] ?? null), tips: terr.map((t) => `${a.short}: ${fixed(a.s.routes?.slotsByTerrain?.[t], 2)} ${resLabel(t)} slots per player`) }));
    parts.push(fig(M, {
      title: 'Which terrain do players lay track on?',
      sub: 'Mean slots of each terrain covered per player. Ground is built from Iron, Tunnel from Gunpowder and Bridge from Wood, so this also shows which resources the track is really made of.',
      svg: barV({ label: 'Slots by terrain', categories: terr.map(resLabel), series: sers2, yFmt: (v) => fixed(v, 0), valueFmt: (v) => fixed(v, 1), yLabel: 'Slots laid per player', xLabel: 'Terrain', height: 270 }),
      table: table(['Terrain', ...M.arms.map((a) => `${a.short}: slots per player`)], terr.map((t) => [resLabel(t), ...M.arms.map((a) => fixed(a.s.routes?.slotsByTerrain?.[t], 2))])), half: false,
    }));
  } else notes.push('Route statistics are not in this file.');

  if (M.arms.some((a) => a.s.buildings)) {
    const cats = ['Railway stations', 'Telegraph stations'];
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: [a.s.buildings?.railwayPerPlayer ?? null, a.s.buildings?.telegraphPerPlayer ?? null], tips: [`${a.short}: ${fixed(a.s.buildings?.railwayPerPlayer, 2)} railway stations per player`, `${a.short}: ${fixed(a.s.buildings?.telegraphPerPlayer, 2)} telegraph stations per player`] }));
    parts.push(fig(M, {
      title: 'How many railway and telegraph stations get built?',
      sub: 'Mean number of each station type on the map per player at the end of the game. Stations are buildings on the map; they are not the houses on a player board.',
      svg: barV({ label: 'Stations per player', categories: cats, series: sers, yFmt: (v) => fixed(v, 1), valueFmt: (v) => fixed(v, 2), yLabel: 'Stations per player', height: 260 }),
      table: table(['', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}per player`])], [['Railway stations', ...M.arms.map((a) => fixed(a.s.buildings?.railwayPerPlayer, 2))], ['Telegraph stations', ...M.arms.map((a) => fixed(a.s.buildings?.telegraphPerPlayer, 2))], ['Stations in total, per winner', ...M.arms.map((a) => fixed(a.s.buildings?.perPlayerWinners, 2))], ['Stations in total, per other player', ...M.arms.map((a) => fixed(a.s.buildings?.perPlayerRest, 2))]]),
      badge: { n: (a) => (a.s.score?.n ?? a.n), unit: 'players' },
    }));
  }

  if (M.arms.some((a) => a.s.completion)) {
    const seatsN = Math.max(0, ...M.arms.map((a) => arr(a.s.completion?.bySeat).length));
    const cats = ['Any seat', ...Array.from({ length: seatsN }, (_, i) => `Seat ${i + 1}`)];
    const sers = M.arms.map((a, ai) => {
      const c = a.s.completion;
      const bySeat = arr(c?.bySeat);
      return {
        ...ser[ai],
        values: [c?.value ?? null, ...cats.slice(1).map((_, i) => bySeat[i] ?? null)],
        ses: [c?.se ?? null, ...cats.slice(1).map((_, i) => propSe(bySeat[i], a.n))],
        tips: cats.map((x, i) => `${a.short}: ${x} completed the transcontinental line in ${pct(i === 0 ? c?.value : bySeat[i - 1])} of games`),
      };
    });
    parts.push(fig(M, {
      title: 'How often is the transcontinental line completed, and by whom?',
      sub: `Share of games in which a player completed the line across the whole map, and which seat did it. ${M.arms.map((a) => `${multi(M) ? esc(a.short) + ': ' : ''}${isNum(a.s.completion?.meanTurnShare) ? `on average ${pct(a.s.completion.meanTurnShare, 0)} of the way through the game` : 'timing not collected'}`).join('; ')}. Whiskers are plus or minus 2 standard errors.`,
      svg: barV({ label: 'Transcontinental completion', categories: cats, series: sers, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Share of games (%)', height: 280 }),
      table: table([...(multi(M) ? [''] : []), 'Games with a completed line', 'Std error', 'Mean point in the game reached', ...Array.from({ length: seatsN }, (_, i) => `Seat ${i + 1}`)], M.arms.map((a) => [...(multi(M) ? [armLabel(a)] : []), metric('completion.rate', a, a.s.completion?.value, pct(a.s.completion?.value), 'pct1'), `±${pct(a.s.completion?.se)}`, pct(a.s.completion?.meanTurnShare), ...Array.from({ length: seatsN }, (_, i) => pct(arr(a.s.completion?.bySeat)[i]))])),
      badge: { n: (a) => a.s.completion?.n ?? a.n, unit: 'games' },
    }));
  }
  if (!parts.length) return section('map', 'The map', '', [], notes);
  return section('map', 'The map', 'Routes, stations and the transcontinental line. Routes are claimed whole and are exclusive.', parts, notes);
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export function economySection(M) {
  const parts = [];
  const notes = [];
  const ser = series(M);
  const res = ['iron', 'wood', 'gunpowder', 'coins', 'hats'];

  if (M.arms.some((a) => a.s.leftovers?.resources)) {
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: res.map((r) => a.s.leftovers?.resources?.[r] ?? null), tips: res.map((r) => `${a.short}: ${fixed(a.s.leftovers?.resources?.[r], 2)} ${resLabel(r)} left per player`) }));
    parts.push(fig(M, {
      title: 'What do players have left over at the end?',
      sub: 'Mean resources, coins and cowboy hats still in a player\'s hands when the game ended. A large pile means the resource was not needed; a pile near zero everywhere means players were using everything.',
      svg: barV({ label: 'Leftover resources', categories: res.map(resLabel), series: sers, yFmt: (v) => fixed(v, 1), valueFmt: (v) => fixed(v, 2), yLabel: 'Left per player at the end', height: 280 }),
      table: table(['', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}all players`, 'winners', 'everyone else'])], res.map((r) => [resLabel(r), ...M.arms.flatMap((a) => [fixed(a.s.leftovers?.resources?.[r], 2), fixed(a.s.leftovers?.resourcesWinners?.[r], 2), fixed(a.s.leftovers?.resourcesRest?.[r], 2)])])),
      badge: { n: (a) => a.s.score?.n ?? a.n, unit: 'players' },
    }));
  } else notes.push('Leftover resources are not in this file.');

  if (M.arms.some((a) => a.s.leftovers?.unlaidTiles)) {
    const terr = ['ground', 'tunnel', 'bridge'];
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: terr.map((t) => a.s.leftovers?.unlaidTiles?.[t] ?? null), tips: terr.map((t) => `${a.short}: ${fixed(a.s.leftovers?.unlaidTiles?.[t], 2)} ${resLabel(t)} tiles built but never laid`) }));
    parts.push(fig(M, {
      title: 'How many built tiles are never laid?',
      sub: 'Tiles a player built (turned resources into track) but never laid on the map. Building and laying are separate steps, so a high number means players build more than they lay.',
      svg: barV({ label: 'Unlaid tiles', categories: terr.map(resLabel), series: sers, yFmt: (v) => fixed(v, 1), valueFmt: (v) => fixed(v, 2), yLabel: 'Built tiles never laid, per player', height: 260 }),
      table: table([...(multi(M) ? [''] : []), 'All terrains, all players', 'winners', 'everyone else'], M.arms.map((a) => [...(multi(M) ? [armLabel(a)] : []), metric('unlaidTiles.perPlayer', a, a.s.leftovers?.unlaidTilesTotal, fixed(a.s.leftovers?.unlaidTilesTotal, 2), 'f2'), fixed(a.s.leftovers?.unlaidTilesWinners, 2), fixed(a.s.leftovers?.unlaidTilesRest, 2)])),
      badge: { n: (a) => a.s.score?.n ?? a.n, unit: 'players' },
    }));
  }

  if (M.arms.some((a) => a.s.congress?.perGameById)) {
    const ids = [...new Set(M.arms.flatMap((a) => Object.keys(obj(a.s.congress?.perGameById))))];
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: ids.map((i) => a.s.congress?.perGameById?.[i] ?? 0), tips: ids.map((i) => `${a.short}: Congress entry ${i}: ${fixed(a.s.congress?.perGameById?.[i], 2)} per game`) }));
    parts.push(fig(M, {
      title: 'Which Congress entries get taken?',
      sub: `Mean times each Congress entry was taken per game, all players together. ${M.arms.map((a) => `${multi(M) ? esc(a.short) + ': ' : ''}${fixed(a.s.congress?.perGame, 1)} entries per game in all`).join('; ')}. An entry nobody takes is listed under "Never used" below.`,
      svg: barV({ label: 'Congress entries per game', categories: ids, series: sers, yFmt: (v) => fixed(v, 1), valueFmt: (v) => fixed(v, 2), yLabel: 'Entries taken per game', xLabel: 'Congress entry', height: 270 }),
      table: table(['Entry', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}taken in total`, 'per game'])], ids.map((i) => [i, ...M.arms.flatMap((a) => [count(a.s.congress?.taken?.[i] ?? 0), fixed(a.s.congress?.perGameById?.[i] ?? 0, 2)])])),
    }));
  }

  if (M.arms.some((a) => a.s.bonusActions?.perPlayer)) {
    const kinds = ['hire', 'hat', 'carriage', 'upgrade'];
    const sers = M.arms.map((a, ai) => ({ ...ser[ai], values: kinds.map((k) => a.s.bonusActions?.rate?.[k] ?? null), ses: kinds.map((k) => propSe(a.s.bonusActions?.rate?.[k], a.s.score?.n ?? a.n)), tips: kinds.map((k) => `${a.short}: ${bonusLabel(k)}: ${pct(a.s.bonusActions?.rate?.[k])} of players took it at least once (${fixed(a.s.bonusActions?.perPlayer?.[k], 2)} per player)`) }));
    parts.push(fig(M, {
      title: 'How often do players take each bonus action?',
      sub: 'Share of players who took each bonus action at least once in a game. Whiskers are plus or minus 2 standard errors (computed here from the share and the number of players).',
      svg: barV({ label: 'Bonus actions', categories: kinds.map(bonusLabel), series: sers, yFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), yLabel: 'Players who took it (%)', height: 270 }),
      table: table(['Bonus action', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}share of players`, 'times per player'])], kinds.map((k) => [bonusLabel(k), ...M.arms.flatMap((a) => [pct(a.s.bonusActions?.rate?.[k]), fixed(a.s.bonusActions?.perPlayer?.[k], 2)])])),
      badge: { n: (a) => a.s.score?.n ?? a.n, unit: 'players' },
    }));
  }

  if (M.arms.some((a) => a.s.economy)) {
    const rows = [];
    const put = (label, fn, d = 2) => rows.push([label, ...M.arms.map((a) => fixed(fn(obj(a.s.economy)), d))]);
    for (const r of ['iron', 'wood', 'gunpowder', 'coins']) put(`${resLabel(r)} gathered`, (e) => e.gathered?.[r]);
    for (const t of ['ground', 'tunnel', 'bridge']) put(`${resLabel(t)} tiles built`, (e) => e.built?.[t]);
    put('Cowboy hats spent', (e) => e.hatsSpent);
    put('Lobby points gained', (e) => e.lobbyPointsGained);
    put('Lobby points lost', (e) => e.lobbyPointsLost);
    put('Workers of others displaced', (e) => e.workersDisplaced);
    put('Items discarded for storage overflow', (e) => e.storageDiscards);
    parts.push(`<div class="card"><h4>The economy per player per game</h4><p class="sub">Means over players (${M.arms.map((a) => `${multi(M) ? esc(a.short) + ': ' : ''}n = ${count(a.s.score?.n ?? a.n)} players`).join('; ')}).</p>${table(['', ...M.arms.map((a) => a.short)], rows)}</div>`);
  } else notes.push('The per-player economy table (gathered, built, hats, lobby points) is not in this file (a --fast run does not collect it).');

  if (!parts.length) return section('economy', 'Economy', '', [], notes);
  return section('economy', 'Economy', 'Resources, built tiles, Congress and bonus actions. Iron, Wood and Gunpowder are turned into Ground, Bridge and Tunnel tiles by the specialists on the train.', parts, notes);
}

// ---------------------------------------------------------------------------
// Modules and the "never used" block
// ---------------------------------------------------------------------------

export function neverUsedBlock(M) {
  const per = M.arms.map((a) => ({ a, z: zeroUsage(a) }));
  const body = per.map(({ a, z }) => {
    const head = multi(M) ? `<h4>${swatch(a.color, a.pattern)} ${esc(a.short)} (n = ${count(a.n)} games)</h4>` : '';
    if (!z.groups.length) return `${head}<p>Nothing was left unused: every item, subsystem and action type shows some use in this file.</p>`;
    return head + z.groups.map((g) => `<p><strong>${esc(g.title)}</strong></p>${g.zero.length ? `<ul>${g.zero.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}${g.notInPlay.length ? `<p class="sub">Never came into play at all in this run (a sample-size matter, not a usage finding): ${esc(g.notInPlay.join(', '))}.</p>` : ''}`).join('');
  }).join('');
  const total = per.reduce((t, x) => t + x.z.total, 0);
  return `<div class="zero"><h3>Never used - check the bot before the rule</h3><p>Anything on this list was never used in the games counted. A zero is first a question about the bot (can it see the option, does it value it?) and only then a question about the rule. ${total === 0 ? '' : ''}</p>${body}</div>`;
}

function usageFig(M, def) {
  const infos = M.arms.map((a) => moduleItems(a.s, def));
  if (!infos.some(Boolean)) return null;
  const ids = [];
  for (const mi of infos) for (const x of mi?.items ?? []) if (!ids.includes(x.id)) ids.push(x.id);
  if (!ids.length) return null;
  const ser = series(M);
  const get_ = (mi, id) => mi?.items.find((x) => x.id === id);
  const rows = ids.map((id) => ({
    label: itemLabel(def.key, id),
    values: infos.map((mi, ai) => {
      const x = get_(mi, id);
      if (!x || !isNum(x.rate)) return null;
      return { v: x.rate, se: def.countRate ? null : propSe(x.rate, x.n), tip: `${M.arms[ai].short}: ${itemLabel(def.key, id)}: ${x.detail}` };
    }),
  }));
  const xf = def.countRate ? (v) => fixed(v, 2) : (v) => pct(v, 0);
  const svg = barH({ label: `${def.title}: usage`, rows, series: ser, xFmt: xf, valueFmt: def.countRate ? (v) => fixed(v, 2) : (v) => pct(v), xLabel: def.rateLabel });
  const trows = ids.map((id) => [itemLabel(def.key, id), ...infos.flatMap((mi) => { const x = get_(mi, id); return [isNum(x?.used) ? count(x.used) : 'not collected', x && isNum(x.rate) ? (def.countRate ? fixed(x.rate, 2) : pct(x.rate)) : dash, x && x.n !== undefined ? count(x.n) : dash]; })]);
  const tbl = table(['Item', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}${def.usedWord}`, def.countRate ? 'per game' : 'rate', 'games it applies to'])], trows);
  return fig(M, {
    title: `How often is each ${def.title.toLowerCase().replace(/s$/, '')} used?`,
    sub: `${esc(def.rateLabel)}. ${def.countRate ? '' : 'Whiskers are plus or minus 2 standard errors. '}Items are shown by id (and name where the rules table is available).`,
    svg, table: tbl, badge: { n: (a) => a.n },
  });
}

function winWithFig(M, def) {
  const infos = M.arms.map((a) => get(a.s, `modules.${def.key}.winRateWithWithout.items`));
  if (!infos.some((x) => Array.isArray(x) && x.length)) return null;
  const ids = [];
  for (const it of infos) for (const x of arr(it)) if (x && x.nWith > 0 && !ids.includes(x.id)) ids.push(x.id);
  if (!ids.length) return null;
  const rows = ids.map((id) => ({
    label: itemLabel(def.key, id),
    cells: infos.map((it, ai) => {
      const x = arr(it).find((y) => y && y.id === id);
      if (!x || !isNum(x.diff)) return null;
      const se = Math.sqrt((x.seWith ?? 0) ** 2 + (x.seWithout ?? 0) ** 2) * 100;
      const d = x.diff * 100;
      return { d, lo: d - 2 * se, hi: d + 2 * se, small: !!x.small, tip: `${M.arms[ai].short}: ${itemLabel(def.key, id)}: players with it won ${pct(x.winRateWith)} (n = ${count(x.nWith)}); without it ${pct(x.winRateWithout)} (n = ${count(x.nWithout)}); difference ${fixed(d, 1)} points${x.small ? ' (small sample: 30 players or fewer on one side)' : ''}`, note: `${pct(x.winRateWith, 0)} (n ${count(x.nWith)}) / ${pct(x.winRateWithout, 0)} (n ${count(x.nWithout)})${x.small ? ' small' : ''}` };
    }),
  }));
  const svg = diffH({ label: `${def.title}: win rate with versus without`, rows, series: series(M), xFmt: (v) => `${fixed(v, 0)}`, xLabel: 'Win rate of players with it minus win rate of players without it (percentage points)' });
  const trows = [];
  for (const id of ids) for (const [ai, it] of infos.entries()) {
    const x = arr(it).find((y) => y && y.id === id);
    if (!x) continue;
    trows.push([...(multi(M) ? [M.arms[ai].short] : []), itemLabel(def.key, id), pct(x.winRateWith), count(x.nWith), pct(x.winRateWithout), count(x.nWithout), fixed(x.diff * 100, 1), x.small ? 'small sample' : '']);
  }
  const note = infos.map((it) => get({ it }, 'it.note')).find(Boolean);
  void note;
  return fig(M, {
    title: `Do players who use a ${def.title.toLowerCase().replace(/s$/, '')} win more often?`,
    sub: `Win rate of players who had it minus those who did not, in percentage points; the whisker is plus or minus 2 standard errors, so a whisker that crosses the zero line is <strong>not distinguishable from chance at this sample size</strong>. Faded rows have 30 players or fewer on one side. This is a correlation only: strong players tend to do more of everything. Numbers on the right are win rate with (n players) / without (n players).`,
    svg, table: table([...(multi(M) ? [''] : []), 'Item', 'Win rate with', 'Players with', 'Win rate without', 'Players without', 'Difference (points)', ''], trows), badge: { n: (a) => a.s.score?.n ?? a.n, unit: 'players' },
  });
}

export function modulesSection(M) {
  const parts = [];
  const notes = [];
  parts.push(neverUsedBlock(M));
  // Subsystems
  if (M.arms.some((a) => arr(a.s.subsystems).length)) {
    const ids = [...new Set(M.arms.flatMap((a) => arr(a.s.subsystems).map((x) => x.id)))];
    const rows = ids.map((id) => ({ label: humanise(id), values: M.arms.map((a) => { const x = arr(a.s.subsystems).find((y) => y.id === id); return x && isNum(x.value) ? { v: x.value, se: x.se, tip: `${a.short}: ${humanise(id)} used in ${count(x.games)} of ${count(x.n)} games` } : null; }) }));
    parts.push(fig(M, {
      title: 'Which subsystems did the bots use at all?',
      sub: 'Share of games in which each add-on module, core action and the toll income was used at least once. 0% is a plumbing question first and a design finding second; 100% for something optional is also worth a look at the bot.',
      svg: barH({ label: 'Subsystem usage', rows, series: series(M), xFmt: (v) => pct(v, 0), valueFmt: (v) => pct(v), xLabel: 'Share of games that used it (%)', xMax: 1.05 }),
      table: table(['Subsystem', ...M.arms.flatMap((a) => [`${multi(M) ? a.short + ': ' : ''}games used in`, 'share', 'std error'])], ids.map((id) => [humanise(id), ...M.arms.flatMap((a) => { const x = arr(a.s.subsystems).find((y) => y.id === id); return [x ? count(x.games) : dash, x ? pct(x.value) : dash, x ? `±${pct(x.se)}` : dash]; })])),
    }));
  }
  let any = false;
  for (const def of MODULES) {
    const u = usageFig(M, def);
    const w = winWithFig(M, def);
    const pony = def.key === 'pony' ? M.arms.map((a) => ({ a, m: get(a.s, 'modules.pony') })).filter((x) => x.m) : [];
    if (!u && !w) continue;
    any = true;
    const extra = pony.length ? `<p class="sub">${pony.map(({ a, m }) => `${multi(M) ? `<b>${esc(a.short)}</b>: ` : ''}Pony Express tokens per player: ${fixed(m.tokensCollectedPerPlayer, 2)} collected, ${fixed(m.tokensHeldAtEndPerPlayer, 2)} still held at the end, ${fixed(m.tokensExchangedPerPlayer, 2)} exchanged for resources, ${fixed(m.cardsBoughtPerPlayer, 2)} cards bought.`).join('<br>')}</p>` : '';
    parts.push(`<h3 style="margin-top:22px">${esc(def.title)}</h3>${extra}${u ?? ''}${w ?? ''}`);
  }
  if (!any) notes.push('No add-on module (upgrades, milestones, goals, Legislative Agenda, Pony Express) is in play in this file.');
  // Legislative extra
  const legs = M.arms.map((a) => ({ a, c: arr(get(a.s, 'modules.legislative.cards')) })).filter((x) => x.c.length);
  if (legs.length) {
    const ids = [...new Set(legs.flatMap((x) => x.c.map((c) => c.id)))];
    parts.push(`<details><summary>Legislative Agenda: mean VP the card scored when in force</summary>${table(['Card', ...legs.flatMap((x) => [`${multi(M) ? x.a.short + ': ' : ''}games in force`, 'mean VP from the card'])], ids.map((id) => [itemLabel('legislative', id), ...legs.flatMap((x) => { const c = x.c.find((y) => y.id === id); return [count(c?.games), fixed(c?.meanLegislativeVp, 1)]; })]))}</details>`);
  }
  return section('modules', 'Modules: upgrades, milestones, goals, Legislative Agenda, Pony Express', 'How often each item was used, and whether using it goes with winning. Items that were never used come first.', parts, notes);
}
