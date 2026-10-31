// bug-report-pr2e.test.mjs - Pacific Rails, second edition: what the bug report captures.
//
// The report's player numbers and diagnostics were written for Continental Rails (storage carriages, bonus
// actions, lobby points, milestones). For this ruleset they must carry its own facts instead: carriages with
// their upgrade tokens, the board activation, the four goals with who leads, the Congress columns and the lay
// being built, and no field may come out as NaN or as an empty stand-in for a Continental Rails field.
//
// Semantics: permanently green; exits 1 on any failure.

import assert from 'node:assert/strict';
import { makeSuite } from '../helpers/play.mjs';
import { useRuleset } from '../../src/ui/active-ruleset.js';
import { buildReport, checkReplay } from '../../src/ui/bug-report-capture.js';
import { E, start, act, setStorage, giveCarriages } from './rig.mjs';

const suite = makeSuite('pr2e bug report');
useRuleset('pr2e');

function seatsOf(state) {
  return state.players.map((p) => ({ human: p.id === 0, level: p.id === 0 ? null : 'medium', label: p.id === 0 ? 'Human' : 'Medium bot', name: p.name, colour: '#c0392b' }));
}

function report(state) {
  return buildReport({ rules: 'pr2e', state, seats: seatsOf(state), replay: { actions: [], base: E.serialiseState(state) }, screen: 'game' });
}

/** A position with two carriages (a token in the first), two hats and Anna in the middle of a Crew board activation. */
function position() {
  const s = start(3, { trains: [['SEA', 'OMA'], ['POR', 'KCY'], ['LAX', 'MSP']] });
  giveCarriages(s, 0, [['crew', 'financier'], ['miner', null]]);
  s.players[0].train.specialistCarriages[0].upgrade = 'U1-iron';
  setStorage(s, 0, { iron: 2, wood: 0, gunpowder: 0, coins: 1, ground: 0, tunnel: 0, bridge: 0 });
  return s;
}

suite.check('the report names the ruleset and every section is built', () => {
  const r = report(position());
  assert.deepEqual(r.rules, { id: 'pr2e', name: 'Pacific Rails, second edition' });
  assert.deepEqual(r.capture.sectionsWithErrors, []);
  assert.equal(r.replayCheck.ok, true);
});

suite.check('a player\'s numbers carry the carriages with their tokens, and none of the Continental Rails stand-ins', () => {
  const p = report(position()).diagnostics.players[0];
  assert.deepEqual(p.train.carriages.map((c) => [c.number, c.upgrade]), [[1, 'U1-iron'], [2, null]]);
  assert.deepEqual(p.train.specialistCarriages, [['crew', 'financier'], ['miner', null]]);
  assert.ok(!('storageCarriages' in p.train), 'no storage carriages here');
  assert.ok(!('bonusActionsUsed' in p) && !('lobbyPointsInActivation' in p), 'no bonus actions or lobby points here');
  assert.equal(typeof p.layStationsPlaced, 'number');
  assert.equal(typeof p.districtHouses, 'number');
  assert.equal(p.hatsGainedThisTurn, null, 'no hats-at-start record in this ruleset: null, not NaN');
});

suite.check('no value in the report is NaN', () => {
  assert.ok(!JSON.stringify(report(position())).includes('NaN'));
});

suite.check('the goals in play are reported with their measure, each player\'s value and the sole leader', () => {
  const s = position();
  const goals = report(s).diagnostics.progress.goals;
  assert.equal(goals.length, 4);
  const standings = E.goalsInPlay(s).map((g) => E.goalStandings(s, g));
  goals.forEach((g, i) => {
    assert.deepEqual(g.progress.map((x) => x.value), standings[i].values);
    assert.equal(g.soleLeader, standings[i].places.indexOf(0));
    assert.equal(typeof g.metric, 'string');
    assert.ok(g.progress.every((x) => typeof x.text === 'string' && x.text.length > 0));
  });
});

suite.check('the Congress columns and the Reset are reported with their senators', () => {
  const s = position();
  s.congress.down.K2 = true;
  const congress = report(s).diagnostics.congress;
  assert.deepEqual(congress.map((c) => c.id), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'KR']);
  assert.equal(congress.find((c) => c.id === 'K2').down, true);
  assert.equal(congress.find((c) => c.id === 'KR').reset, true);
});

suite.check('a board activation in progress is reported (the Foreman\'s step and where it is in the list)', () => {
  const s = position();
  act(s, { type: 'placeWorker', space: 'W3' });
  act(s, { type: 'chooseDistrict', district: 'D4', hats: 0 });
  const top = E.topFrame(s);
  assert.equal(top.kind, 'boardActivation', `the Crew district started a board activation (${top.kind})`);
  const p = report(s).diagnostics.players[0];
  assert.equal(p.boardActivation.stepIndex, 0);
  assert.equal(p.boardActivation.steps, top.steps.length);
  assert.equal(p.boardActivation.current.type, top.steps[0].type);
});

suite.check('a lay being built is reported with its path and what it would score', () => {
  const s = start(3, { trains: [['SEA', 'OMA'], ['POR', 'KCY'], ['LAX', 'MSP']] });
  setStorage(s, 0, { iron: 0, wood: 0, gunpowder: 0, coins: 0, ground: 4, tunnel: 2, bridge: 2 });
  act(s, { type: 'placeWorker', space: 'W4' });
  act(s, { type: 'chooseDistrict', district: 'D5', hats: 0, mode: 'lay' });
  act(s, { type: 'startLay', train: 0 });
  const r = report(s);
  assert.deepEqual(r.capture.sectionsWithErrors, []);
  const lay = r.diagnostics.layPath;
  assert.ok(lay && lay.path && Array.isArray(lay.path.cities), 'the lay path is in the report');
  assert.equal(lay.path.train, 0);
  assert.ok(lay.path.cities[0], 'it starts at the train\'s city');
});

suite.check('a report outside a lay has no layPath of its own to read (null)', () => {
  assert.equal(report(position()).diagnostics.layPath, null);
});

suite.check('the replay record rebuilds the position the report holds', () => {
  const s = position();
  const r = report(s);
  assert.equal(checkReplay(r.replay, r.stateHash).ok, true);
});

suite.finish();
