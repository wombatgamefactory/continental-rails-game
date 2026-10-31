// Rules audit (pr2e): the rules that cannot be tested through the public API, or whose wording
// leaves a choice, each with the reason. The report (docs/rules-audit-report-pr2e.md) lists them.

import { skip } from './kit.mjs';

export default function untestable() {
  skip('P0', 'how to read the document', 'notes on numbering, tags and fonts; no behaviour');
  skip('P1.12', 'player board (the word)', 'a definition; its parts are checked under P2.3, P7.2 and P7.4');
  skip('P1.13', 'board activation (the word)', 'a definition; the behaviour is checked under P9.2 and P9.3');
  skip('P1.14', 'specialist, Foreman (the words)', 'a definition; checked under P9.1, P9.2 and P18.2/exclusions');
  skip('P1.21', 'lay, path (the words)', 'a definition; checked under P14.2 and P14.3');
  skip('P1.22', 'terminology map', 'a table of old and new words; the engine\'s own text is only scanned for the two forbidden words (P1.9)');
  skip('P2.6', 'components the UI must show', 'an inventory for the page and the artwork; not engine behaviour');
  skip('P3.1.4', 'tiles, resources, hats and carriages go in the general supply', 'the engine keeps no supply for them (P2.4), so there is no state to read');
  skip('P4.2/step-4', 'end of turn', 'checked under P19.3 (equal turns, game end after the last seat)');
  skip('P9.3/refusal', 'a Crew, Miner or Engineer step may be used only if its cost can be paid', 'an unpayable step is skipped by the engine itself, so no decision is ever asked in which a refusal could be observed; that the skip happens is checked under P9.3/crew and P10.4');
  skip('P13.1/data', 'the 65 routes and their terrains match the route table of the map file', 'the table the rule points to (Appendix A of the rules text) is not available to this audit; the counts (35 cities, 65 routes, 134 slots by kind: 46 Ground, 44 Tunnel, 41 Bridge, 3 wild), the start-city roles, the wild routes and the structural facts are checked');
  skip('P19.5/stop-timing', 'the turn limit stops a game in which any player has taken the limit', 'the wording does not say whether the game stops at once or at the end of the round; the checks only require the end reason turn-limit and that nobody exceeds the limit');
  skip('P21.2/SUPPLY.hats', 'SUPPLY.hats, SUPPLY.trackTilesPerType, SUPPLY.resourcesPerType', 'the rules say these are for display only and never enforced, so changing them has no observable effect');
  skip('P22', 'worked examples', 'checked as E1 to E9');
  skip('P14.9/7', 'what a bot sees and keeps for a wild slot', 'a note for the bot writer; the bots are tested in tests/pr2e/bots-pr2e.test.mjs, not here');
  skip('P23', 'where the network changes the feel', 'commentary, not rules');
  skip('P24', 'differences from the earlier engine', 'a note for the programmer; the dropped systems are checked under P24.4, the changed ones under their own rules');
  skip('P25', 'source disagreements', 'commentary, not rules');
}
