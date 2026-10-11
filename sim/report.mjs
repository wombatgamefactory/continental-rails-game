// report.mjs - the terminal summary. Plain text, British English, dates DD/MM/YYYY.
//
// Reads only the result object that is written to the JSON file, so the summary can be
// regenerated from a file and never shows a figure the file does not hold.

const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
const pct = (x, d = 1) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(d)}%`);
const pm = (x, d = 1) => (x === null || x === undefined ? '' : ` +/-${(x * 100).toFixed(d)}`);

function table(rows, align = []) {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? '').length)));
  return rows.map((r) => '  ' + r.map((cell, c) => (align[c] === 'l' ? String(cell ?? '').padEnd(widths[c]) : String(cell ?? '').padStart(widths[c]))).join('  '));
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function sectionsText(s, players, title) {
  const out = [];
  out.push('');
  out.push(`== ${title} (${plural(s.n, 'game')}) ==`);
  if (!s.n) {
    out.push('  No games to report.');
    return out;
  }

  // Wins
  out.push('');
  out.push('Win rate by seat (ties on VP split; seat 1 moves first). Fair share is ' + pct(1 / players) + '.');
  const rows = [['seat', 'win rate', 'std err', 'sigma', 'by tie-break', 'mean rank', 'score mean', 'sd']];
  for (const x of s.bySeat) rows.push([x.seat, pct(x.winRate), pct(x.se), f(x.sigma, 2), pct(x.tieBreakWinRate), f(x.meanRank, 2), f(x.score.mean), f(x.score.sd)]);
  out.push(...table(rows));
  if (s.byType.length > 1) {
    out.push('');
    out.push('Win rate by bot type (per seat taken; seats of each type):');
    const t = [['bot', 'seats', 'win rate', 'std err', 'sigma', 'by tie-break', 'mean rank', 'score mean']];
    for (const x of s.byType) t.push([x.type, x.n, pct(x.winRate), pct(x.se), f(x.sigma, 2), pct(x.tieBreakWinRate), f(x.meanRank, 2), f(x.score.mean)]);
    out.push(...table(t, ['l']));
    out.push('  Seats held by each bot type: ' + Object.entries(s.seatTypeCounts).map(([k, v]) => `${k} [${v.join(', ')}]`).join('; '));
  }
  out.push(`  VP ties for first place: ${pct(s.vpTieForFirst.value)} of games.`);

  // Scores
  out.push('');
  out.push('Scores');
  out.push(`  All players: mean ${f(s.score.mean)}, median ${f(s.score.median)}, sd ${f(s.score.sd)}, min ${s.score.min}, max ${s.score.max}`);
  out.push(`  Winning score: mean ${f(s.winningScore.mean)}, median ${f(s.winningScore.median)}, min ${s.winningScore.min}, max ${s.winningScore.max}`);
  out.push(`  Margin of the winner over second: mean ${f(s.marginPct.mean)}% of the winner's score; games within 10%: ${pct(s.within10.value)}`);

  // Shape
  out.push('');
  out.push('Shape of the game');
  out.push(`  Turns per player: mean ${f(s.length.mean)}, median ${f(s.length.median)}, min ${s.length.min}, max ${s.length.max}`);
  if (s.lengthHistogram.length > 1) out.push('  Length histogram (turns per player): ' + s.lengthHistogram.map((b) => `${b.from}-${b.to}: ${b.games}`).join(', '));
  if (s.leadChanges) out.push(`  Lead changes per game: mean ${f(s.leadChanges.mean, 2)}, median ${f(s.leadChanges.median)}; half-time leader wins ${pct(s.leaderAtHalf.value)}${pm(s.leaderAtHalf.se)} (fair ${pct(s.leaderAtHalf.fair)}, sigma ${f(s.leaderAtHalf.sigma, 2)})`);
  if (s.vpByQuarter) out.push(`  Share of all VP by quarter: ${s.vpByQuarter.shares.map((x, i) => `Q${i + 1} ${pct(x)}`).join(', ')}, end scoring ${pct(s.vpByQuarter.finalScoring)}  (final quarter with end scoring ${pct(s.vpByQuarter.finalQuarterWithEndScoring)})`);
  out.push(`  Decisions per turn: ${f(s.decisions.perTurn.mean, 2)}; per game ${f(s.decisions.perGame.mean, 0)} (+${f(s.decisions.forcedPerGame.mean, 0)} applied by the engine as forced)`);
  if (s.legalActions) {
    const la = s.legalActions;
    out.push(`  Legal actions: ${f(la.atTurnStart, 1)} at a turn's first decision (${f(la.distinctTypesAtTurnStart, 2)} action types), ${f(la.perDecision, 1)} per decision overall (${f(la.distinctTypesPerDecision, 2)} types), max ${la.max}`);
    out.push('  By decision: ' + Object.entries(la.byKind).map(([k, v]) => `${k} ${f(v.meanLegal, 1)}`).join(', '));
  }

  // VP
  out.push('');
  out.push('Where the points come from (share of all VP; winners against the rest)');
  const v = [['source', 'share', 'winners', 'rest', 'per player']];
  for (const x of s.vpBySource) v.push([x.source + (x.final ? ' *' : ''), pct(x.share), pct(x.shareWinners), pct(x.shareRest), f(x.meanPerPlayer)]);
  out.push(...table(v, ['l']));
  out.push('  * booked by final scoring.');

  // Actions
  out.push('');
  out.push('What players did');
  const mix = Object.entries(s.actionMix.share).sort((a, b) => b[1] - a[1]).slice(0, 10);
  out.push('  Action mix (chosen): ' + mix.map(([k, x]) => `${k} ${pct(x)}`).join(', '));
  if (s.actionTypesNeverChosen.length > 0) out.push(`  Action types never chosen in any game (zero = plumbing first, design second): ${s.actionTypesNeverChosen.join(', ')}`);
  if (s.districts) out.push('  Districts chosen: ' + Object.entries(s.districts.share).map(([k, x]) => `${k} ${pct(x, 0)}`).join(', '));
  if (s.bonusActions) out.push('  Bonus actions per player per game: ' + Object.entries(s.bonusActions.perPlayer).map(([k, x]) => `${k} ${f(x, 2)}`).join(', '));
  if (s.congress) out.push(`  Congress entries per game ${f(s.congress.perGame, 1)}${s.congress.neverTaken.length ? `; never taken: ${s.congress.neverTaken.join(', ')}` : ''}`);
  if (s.economy) out.push(`  Per player: gathered ${Object.entries(s.economy.gathered).map(([k, x]) => `${k} ${f(x, 0)}`).join(', ')}; built ${Object.entries(s.economy.built).map(([k, x]) => `${k} ${f(x, 1)}`).join(', ')}; hats spent ${f(s.economy.hatsSpent, 1)}; lobby points lost ${f(s.economy.lobbyPointsLost, 1)}`);

  // Map
  out.push('');
  out.push('The map and what is left over');
  out.push(`  Routes claimed per game: mean ${f(s.routes.perGame.mean)} of ${s.routes.available.routes} (${pct(s.routes.fillShare)}); per player ${f(s.routes.perPlayer, 2)} (winners ${f(s.routes.perPlayerWinners, 2)}, rest ${f(s.routes.perPlayerRest, 2)})`);
  out.push('  Routes per player by length: ' + Object.entries(s.routes.byLength).map(([k, x]) => `${k}: ${f(x, 2)}`).join(', ') + '; slots by terrain: ' + Object.entries(s.routes.slotsByTerrain).map(([k, x]) => `${k} ${f(x, 1)}`).join(', '));
  out.push(`  Buildings per player: ${f(s.buildings.railwayPerPlayer, 2)} railway stations, ${f(s.buildings.telegraphPerPlayer, 2)} telegraph stations`);
  out.push(`  Transcontinental line completed in ${pct(s.completion.value)} of games${s.completion.meanTurnShare !== null ? ` (on average ${pct(s.completion.meanTurnShare, 0)} of the way through)` : ''}`);
  out.push(`  Left over per player: ${f(s.leftovers.unlaidTilesTotal, 2)} built tiles never laid (winners ${f(s.leftovers.unlaidTilesWinners, 2)}, rest ${f(s.leftovers.unlaidTilesRest, 2)}); ${Object.entries(s.leftovers.resources).map(([k, x]) => `${k} ${f(x, 1)}`).join(', ')}`);

  // Modules
  out.push('');
  out.push('Subsystem use (share of games)');
  out.push('  ' + s.subsystems.map((x) => `${x.id} ${pct(x.value, 0)}`).join(', '));
  const m = s.modules;
  if (m.upgrades) out.push(`  Upgrade tiles: ${f(m.upgrades.installsPerPlayer, 2)} installed per player; never installed: ${m.upgrades.neverInstalled.join(', ') || 'none'}`);
  if (m.milestones) out.push(`  Milestones: ${f(m.milestones.perGame, 2)} claimed per game; never claimed (when in play): ${m.milestones.neverClaimed.join(', ') || 'none'}; never in play: ${m.milestones.neverInPlay.join(', ') || 'none'}`);
  if (m.goals) out.push(`  Goals: never paid (when in play): ${m.goals.neverPaid.join(', ') || 'none'}; never in play: ${m.goals.neverInPlay.join(', ') || 'none'}`);
  if (m.legislative) out.push(`  Legislative Agenda cards never in force: ${m.legislative.neverInForce.join(', ') || 'none'}`);
  if (m.pony) {
    out.push(`  Pony Express: ${f(m.pony.tokensCollectedPerPlayer, 2)} tokens collected per player, ${f(m.pony.tokensHeldAtEndPerPlayer, 2)} held at the end${m.pony.cardsBoughtPerPlayer !== null ? `, ${f(m.pony.cardsBoughtPerPlayer, 2)} cards bought` : ''}`);
    if (m.pony.neverBought) out.push(`  Pony Express cards never bought: ${m.pony.neverBought.join(', ') || 'none'}`);
  }
  const effects = [];
  for (const [name, mod] of Object.entries(m)) {
    const items = mod.winRateWithWithout?.items ?? [];
    for (const it of items) if (!it.small && it.diff !== null) effects.push({ name, ...it });
  }
  if (effects.length > 0) {
    effects.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    out.push('  Largest win-rate differences, with against without (only where both sides have more than 30 players):');
    out.push(...table(effects.slice(0, 6).map((e) => [e.id, `with ${pct(e.winRateWith)} (n ${e.nWith})`, `without ${pct(e.winRateWithout)} (n ${e.nWithout})`, `diff ${pct(e.diff)}`]), ['l']));
  }
  return out;
}

function healthText(rows, basis) {
  const out = ['', `== Health table (${basis === 'counted' ? 'counted games' : 'ALL finished games: too few games ended by anything but the turn limit'}) ==`];
  const t = [['status', 'metric', 'value', 'healthy']];
  for (const r of rows) {
    const value = r.value === null || r.value === undefined ? '-' : `${f(r.value, Number.isInteger(r.value) ? 0 : 1)}${r.unit && r.unit !== 'games' ? ` ${r.unit}` : ''}${r.sigma !== undefined && r.sigma !== null ? ` (${f(r.sigma, 1)} sigma)` : ''}${r.detail ? ` [${r.detail}]` : ''}`;
    t.push([r.status === 'warn' ? 'WARN' : r.status === 'pass' ? 'pass' : 'n/a', r.label, value, r.healthy]);
  }
  out.push(...table(t, ['l', 'l', 'l', 'l']));
  return out;
}

function comparisonText(c) {
  const block = c.preferred === 'counted' ? c.counted : c.allFinished;
  const out = ['', `== Test arm against baseline (${block.basis === 'counted' ? 'counted games' : 'ALL finished games, turn-limit games included'}) ==`];
  if (c.preferred !== 'counted') {
    out.push(`  Only ${c.countedGames.test} (test) and ${c.countedGames.baseline} (baseline) games ended by something other than the turn limit, too few to compare, so this uses every finished game. The counted-games comparison is in the file.`);
  }
  const flagged = block.metrics.filter((x) => x.exceedsTwoSe);
  out.push(`  ${flagged.length} of ${block.metrics.length} metrics differ by more than 2 standard errors (expect about ${Math.round(block.metrics.length * 0.05)} by chance).`);
  const show = block.metrics.filter((x) => x.exceedsTwoSe || /^(winRate|score\.|margin|length|leadChanges|turnLimit|completion)/.test(x.id));
  const t = [['', 'metric', 'test', 'baseline', 'diff', 'std err', 'z']];
  const fmt = (x, id) => (/^(winRate|margin\.within10|leaderAtHalf|completion|usage|vpShare|vp\.|turnLimit|end\.)/.test(id) ? pct(x, 1) : f(x, 2));
  for (const x of show) t.push([x.exceedsTwoSe ? '*' : ' ', x.label, fmt(x.test, x.id), fmt(x.baseline, x.id), fmt(x.diff, x.id), x.diffSe === null ? '-' : fmt(x.diffSe, x.id), f(x.z, 1)]);
  out.push(...table(t, ['l', 'l']));
  out.push('  * = more than 2 standard errors apart.');
  return out;
}

/** The whole terminal summary, as one string. */
export function formatReport(result) {
  const run = result.run;
  const out = [];
  out.push(`Continental Rails simulation, ${run.dateUk} (Europe/London)`);
  out.push(`Command: ${run.commandLine}`);
  out.push(`Engine: ${run.engineCommit ?? 'commit unknown'}${run.engineDirty ? ' (src/engine or src/bots has uncommitted changes)' : ''}; Node ${run.nodeVersion}`);
  out.push(
    `${run.players} players; bots by seat: ${run.bots.map((b) => b.type).join(', ')}${run.rotate ? ' (rotated between games)' : ''}; seed ${run.seed}${run.seedIsDefault ? ' (default)' : ''}; jitter ${run.jitter === null ? 'not set' : run.jitter}; mode ${run.mode}${run.mode === 'fast' ? ' (no events: some metrics are not collected)' : ''}`,
  );
  if (run.weights) out.push(`Bot weights${run.weightsSeat ? ` for bot ${run.weightsSeat}` : ' for every bot'}: ${JSON.stringify(run.weights)}`);

  const t = run.timing;
  out.push(`Played ${plural(run.gamesPerArm * result.arms.length, 'game')} on ${plural(run.threads, 'thread')} in ${f(t.wallMs / 1000, 1)} s: ${f(t.gamesPerSecond, 1)} games per second.`);

  for (const arm of result.arms) {
    const a = arm.aggregate;
    const c = a.counts;
    out.push('');
    out.push(`######## Arm "${arm.name}": ${Object.keys(arm.variantsNonDefault).length === 0 && Object.keys(arm.constants).length === 0 ? 'default rules' : ''}${Object.entries(arm.variantsNonDefault).map(([k, v]) => `${k}=${v}`).join(', ')}${Object.keys(arm.constants).length ? `${Object.keys(arm.variantsNonDefault).length ? '; ' : ''}constants ${JSON.stringify(arm.constants)}` : ''} ########`);
    out.push(`  Games ${c.games}: finished ${c.finished}, failed ${c.failed}. Refusals ${c.refusals}, harness decision-cap hits ${c.decisionCapHits}, crashes ${c.errors}, bookkeeping mismatches ${c.integrity}.`);
    out.push(`  Ended by the turn limit (R19.4): ${c.turnLimit} (${f(c.turnLimitPct, 1)}%), excluded from the means below. Other end reasons: ${Object.entries(a.endReasons).filter(([k]) => k !== 'turn-limit').map(([k, x]) => `${k} ${x.games} (${f(x.pct, 1)}%)`).join(', ') || 'none'}.`);
    if (c.failed > 0) out.push('  *** FAILED GAMES: see the "failures" list in the file. The run will exit with a non-zero status. ***');
    if (arm === result.arms[0]) {
      if (a.n === 0 && arm.aggregateAll.n > 0) {
        out.push(`  *** EVERY finished game ended by the turn limit, so there is nothing to average under the rule above. The figures below are for ALL ${arm.aggregateAll.n} finished games (turn-limit games INCLUDED). ***`);
        out.push(...sectionsText(arm.aggregateAll, run.players, 'All finished games, turn-limit included'));
      } else {
        out.push(...sectionsText(a, run.players, 'Counted games (turn-limit games excluded)'));
        if (c.turnLimitPct > 50) {
          out.push('');
          out.push(`  *** More than half of the finished games ended by the turn limit, so the counted games above are a small and unrepresentative sample. The same figures over ALL ${arm.aggregateAll.n} finished games (turn-limit games INCLUDED): ***`);
          out.push(...sectionsText(arm.aggregateAll, run.players, 'All finished games, turn-limit included'));
        }
      }
      out.push(...healthText(a.health, a.healthBasis));
    } else {
      const s = a.n > 0 ? a : arm.aggregateAll;
      out.push(`  Baseline arm, ${s.n} games${s === a ? '' : ' (all finished, turn-limit included)'}: win rate by seat ${s.bySeat ? s.bySeat.map((x) => pct(x.winRate)).join(' / ') : '-'}; mean score ${f(s.score?.mean)}; turns per player ${f(s.length?.mean)}`);
    }
  }
  if (result.comparison) out.push(...comparisonText(result.comparison));

  if (run.warnings.length > 0) {
    out.push('');
    for (const w of run.warnings) out.push(`NOTE: ${w}`);
  }
  if (result.failures.length > 0) {
    out.push('');
    out.push(`FAILURES (${result.failures.length}); the first few:`);
    for (const x of result.failures.slice(0, 5)) {
      out.push(`  [${x.arm}] game ${x.index} seed "${x.seed}": ${x.type}${x.seat !== null && x.seat !== undefined ? ` at seat ${x.seat + 1}` : ''}, state ${x.hash}: ${x.reason}${x.action ? ` | action ${JSON.stringify(x.action)}` : ''}`);
    }
  }
  out.push('');
  out.push(`Results written to ${result.path}`);
  return out.join('\n');
}
