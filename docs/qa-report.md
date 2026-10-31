# Continental Rails - quality assurance record

Date: 11/10/2026. Build label: `prototype 2026-10-11` (`src/ui/config.js`). Machine: Windows 11, Node 24, the installed Chrome (154), 23 worker threads.

**Status: published on 11/10/2026** at <https://www.wombatgamefactory.com/continental-rails-game/>. Sections 1 to 5 record the check made before publication; sections 6 to 8 were brought up to date afterwards. **Section 9 (31/10/2026) records the check of the second ruleset, Pacific Rails, second edition, added after publication and not yet published: its tests, simulations, browser checks, the bugs it found, the issues left open and the terminology debt of the Continental Rails screens.** **Section 10 (31/10/2026) records the check of route map v3, the wild slot and the new Continental Rails player-board art, in both rulesets. Sections 1 to 9 describe the earlier map (25 cities, 47 routes, the end trigger at 8 routes a player): their map facts and figures are history.**

This is the record of the last full check before the repository was made public: every test suite, the simulator, the browser checklist, the art inventory and a sweep of every file that is published. Anything not checked is marked NOT VERIFIED. The scripts that produced the browser results are in `tests/qa/` (run by hand, not part of `npm test`); their output goes to `tests/tmp/qa/` (not tracked).

## 1. Tests

| Check | Result |
|---|---|
| `npm test` (15 suites) in the working folder, three runs before any change | 2 passed, 1 failed (one suite; the log kept only the last lines, so the suite is not named, but it matches the known intermittent failure below) |
| `npm run test:ui`, two runs before any change | 52/52 sections both times, 0 console, page or request problems, 74 s |
| `npm test`, five consecutive runs after the fix | 5 of 5 passed (84 to 85 s each) |
| `npm test`, two runs started at the same moment after the fix | both passed (88 s and 87 s) |
| Fresh clone of the published `origin/main` (commit b5ebe32) in the operating system's temp folder: `npm ci`, `npm test`, `npm run test:ui` | all passed: 15 suites, 0 failed; 52/52 sections, 0 problems |
| Fresh copy of the corrected working tree (tracked files plus new files, in the temp folder, no access to the project folders): `npm ci`, `npm test`, `npm run test:ui` | all passed: `npm ci` exit 0; 15 suites, 0 failed; 53/53 sections, 0 problems (80 s). An earlier copy of the same tree failed one section, see below |
| `npm test` and `npm run test:ui` in the working folder at the end | `npm test`: 5 consecutive runs passed (83 to 85 s) and two started at the same moment both passed (86 s each); `npm run test:ui`: 5 consecutive runs, 53/53 sections each (75 to 77 s), 0 problems |

**A second flake, in the browser test.** Two runs of `npm run test:ui` during this check each failed one section (19g, then 19a) with the bug button reported missing. The test waited for the set-up screen's `data-screen` attribute, which is in the static HTML, so it could return before the page's script had mounted the button. Not a fault in the page. The tests now wait for the script to finish starting (`waitSetup` in `tests/ui-smoke.mjs`); after that 5 consecutive runs and a clean copy passed. One run of the corrected tree's copy had also failed a unit suite because of a slip of mine in a comment edit; the clean-copy test caught it and it was fixed.

**The flaky suite.** `tests/sim-report.test.mjs` failed intermittently with `EPERM` when removing its temporary folder `tests/tmp/sim-report-test`: the repository sat in a synced folder that briefly locks a file it has just seen written, and the suite also collided with itself when two runs overlapped (a fixed folder name). Fix: every test that writes temporary files now uses a folder of its own under the operating system's temp folder (`fs.mkdtemp`, `tests/helpers/tmp.mjs`), and a failed clean-up is retried briefly and then left (never a failure). Screenshots and logs that the hand-run scripts leave in `tests/tmp/` are written through a helper that skips a locked stale file instead of failing.

### Simulator

All with Medium bots, every module on, `--jitter=0.05`. "Clean" means 0 refusals, 0 decision-cap hits, 0 crashes, 0 bookkeeping mismatches and 0 turn-limit games.

| Command | Games | Result |
|---|---|---|
| `node sim/sim.mjs --games=1000 --players=2 --bots=medium --jitter=0.05 --label=t19-qa-2p` | 1,000 in 3.7 s | clean; 758 ended by the transcontinental line, 242 by routes claimed |
| same, `--players=3 --label=t19-qa-3p` | 1,000 in 6.5 s | clean; 733 and 267 |
| same, `--players=4 --label=t19-qa-4p` | 1,000 in 8.0 s | clean; 886 and 114 |
| `node sim/sim.mjs --games=40 --players=2 --bots=hard,medium --rotate --iterations=120 --label=t19-qa-search` | 40 in 70 s | clean (0 refusals); 36 and 4 |
| the three README examples (200 four-player Medium games; 200 three-player games with a baseline arm and `--variant.conversionRate=1:1`; 20 Hard v Medium games) | 200, 400, 20 | all clean |

The HTML report of the 4-player batch (`node sim/sim-report.mjs ...`) was opened from `file://` in headless Chrome by `tests/qa/report-open.mjs`: 34 charts, 0 console errors or warnings, 0 page errors, 0 network requests, no sideways scroll, no `undefined` or `NaN`.

## 2. Browser checklist

Everything was done with `playwright-core` on the installed Chrome (`channel: 'chrome'`; nothing downloaded) against `node tools/serve.mjs` or, for the sub-path, a static server of the checks' own. "Smoke" means a section of `tests/ui-smoke.mjs` (`npm run test:ui`, 53 sections). Screenshots are in `tests/tmp/qa/` (`qa/`) or `tests/tmp/ui/` (`ui/`); at least one per item was looked at, not only asserted.

| # | Item | Result | How checked | Evidence |
|---|---|---|---|---|
| 1 | Landing page at 1440 x 900, 1280 x 800, 1024 x 768, 768 x 1024, 390 x 844: no horizontal scroll, no overlap, no placeholder picture, copy free of typos, British spelling | PASS | `tests/qa/landing.mjs`: scroll width equals window width at all five sizes; no element outside the window; no sibling blocks overlapping; no clipped text; the four pictures are real art and none broken; the page text scanned for US spellings, doubled words, stray characters, "undefined", "Steel" (0 findings); the text was also read. Smoke 20a, 20b | `qa/landing-1440x900.png` ... `landing-390x844.png`, `landing-text.txt` |
| 2 | A complete human game from the landing page to the end screen, all modules on, against one Medium bot, through the bespoke controls | PASS | `tests/qa/human-game.mjs --preset=full`: chose the preset, the seats and Start on the page; 75 human decisions, each by clicking the on-screen target for a legal action picked by a seeded rule. **0 uses of the generic list of legal moves.** 53 clicked a target on the board; 22 clicked a button in the prompt panel (decisions the page offers only as panel buttons, such as choosing a resource, plus 9 where a board target existed but was not on screen: `discard` 7, `installUpgrade` 1, `exchangeToken` 1; see known issue 4). Ended on the end screen after 50 turns; 0 console errors; 0 driver incidents | `qa/human-full-*.png`, `human-game-full.json` |
| 3 | The same with the "Core only" preset | PASS | `--preset=core`: 59 human decisions, **0 generic fallbacks** (11 prompt-panel buttons), no module in the state, ended after 56 turns, 0 console errors | `qa/human-core-*.png`, `human-game-core.json` |
| 4 | A four-bot demo game at Normal speed watched to the end | PASS | `tests/qa/demo.mjs --part=watch`: "Watch a demo game", speed set to Normal; reached the end screen after **8 min 6 s** (719 actions, 132 turns); 0 driver incidents; 0 console errors | `qa/demo-normal-end.png` |
| 5 | Pause, resume, speed change mid-game | PASS | same run: a paused game made no move in 2.5 s and the banner said so; Resume moved it again; Normal 1.0 moves a second, Fast 4.7 | `qa/demo-paused.png` |
| 6 | "New game" mid-game; "Play again"; "Change set-up" | PASS | `--part=controls`: the first press asks "Really abandon this game?", the second returns to the set-up page; `--part=end`: "Play again" starts a new demo with a new seed, "Change set-up" returns to the landing page, "Play again" with the same seed reaches the identical final position | `qa/demo-new-game-confirm.png`, `demo-end-screen.png`, `demo-change-setup.png` |
| 7 | A Hard and an Expert bot each take three turns without tripping the driver's timeout or failure cap; the thinking indicator shows; the page stays responsive | PASS | `tests/qa/search-bots.mjs` at Normal speed: Hard turns 5.9, 1.7, 1.8 s; Expert 10.7, 4.5, 3.8 s (the first turn includes the opening decisions); indicator on screen every time; 0 driver incidents; a click while Hard thought painted in 40 ms, while Expert thought in 21 ms; longest frame gap 350 ms (Hard, at start-up) and 34 ms (Expert) | `qa/search-hard-thinking.png`, `search-expert-thinking.png` |
| 8 | The fixed 0.85 s bot pause no longer stacks on a search bot's thinking | PASS (fixed) | Smoke 7b: the pause applies to the levels with no time budget; Hard and Expert wait 0.25 s (Fast 0.08 s). In the page, the first request to the bot worker came 846 ms after the human's turn for Medium and 247 ms for Hard | - |
| 9 | Every disabled button has a reason | PASS | the human games audited every disabled control on every decision: 7 kinds in the full game (Undo, three "Buy for n tokens", three "Return a token") and 1 in the core game, all with a reason sentence; smoke 12b | `qa/human-full-play-early.png` |
| 10 | An illegal click explains itself with numbers | PASS | smoke 12a; the screenshot shows "Seattle - Helena needs 4 Tunnel + 1 Bridge in built tiles, and you hold 0 of the 4 built Tunnel you need." | `ui/refused-click-1440x900.png` |
| 11 | Half-made actions can be cancelled | PASS | smoke 14 (Cancel and Escape clear a pending selection; a second click switches) | `ui/building-choice-1440x900.png` |
| 12 | Undo works, cannot cross a hand-over, cannot undo a refused action | PASS | smoke 3 (state hash returns; the stack is empty once the turn passes); `tests/qa/undo-refusal.mjs`: a refused action leaves the position, the undo depth and the disabled Undo button as they were; a legal move is undone to the identical hash | `qa/undo-refusal.png` |
| 13 | Hot-seat with three humans: the cover names the right player every time, including a mid-turn decision for a non-active player | PASS | `tests/qa/hotseat.mjs`: a whole game of Anna, Ben and Cleo through the page; 855 decisions, 252 covers, **252 named the player the engine said was to act**, 14 of them for a decision by a player whose turn it was not; a click behind the cover did not play | `qa/hotseat-cover.png` |
| 14 | End screen: ranked scores, VP-by-source arithmetic, tie-break text, seat badges, seed, variants | PASS | `tests/qa/end-screen.mjs`: three played games (2, 3 and 4 players, the last with variants) and four constructed ties (decided by buildings, slots, cargo and turn order): the ranking, every source cell, every total, the printed sum and the tie-break lines equal `scoreGame`; the tie sentence equals the engine's `decidedBy`; seat badges, seed and non-default variants shown | `qa/end-4p.png`, `end-tie-ownedSlots.png`, `end-tie-turnOrder.png` |
| 15 | Bug-report button on every screen; a report downloads and replays | PASS | smoke 19a to 19g (landing page, mid-game, hand-over cover, end screen; the file parses, replays to the same hash, survives 20 re-renders); `tests/qa/subpath.mjs` downloaded a report from the end screen and `node tools/replay-bug-report.mjs` replayed it (exit 0) | `ui/bug-button-play-1440x900.png`, `ui/bug-dialog-1440x900.png` |
| 16 | All 25 variants, every non-default value, played to the end by two bots with zero console errors | PASS | `tests/qa/variants-loop.mjs`: 44 games started by address (`?variants=name=value`) covering every non-default value of all 25 variants (for a number: the lowest, a middle one and the highest) and 25 games started through the panel (one value changed per variant with its own control; the row is marked as changed); 69 of 69 reached the end screen, the engine state held the value, the end screen named the variant, 0 console errors, 0 driver incidents | `variants-loop.json` |
| 17 | Reduced motion honoured | PASS | smoke 20e; `tests/qa/network-keyboard.mjs`: with `prefers-reduced-motion: reduce`, 0 running animations on the landing page and in a game | - |
| 18 | Keyboard: Tab reaches every control; focus visible; Escape closes panels and dialogs | PASS | landing page: 21 interactive controls, Tab reached all, each with a visible focus ring; game screen: Tab reached 41 controls including the nine districts, undo (when enabled), pause, New game and the bug button, all with a focus ring; Escape closed the bug dialog and the dock panel; smoke 17g (the large card closes with Escape), 20f (contrast and focus) | `qa/keyboard-landing-focus.png`, `keyboard-game-focus.png` |
| 19 | Network: only its own origin across a full game; first paint under 2 MB of images; no 404s | PASS | landing page plus a four-bot game: 143 requests, 0 to another origin, 0 error responses, no analytics script; the landing page loads 4 pictures, **280 KB** | `network-keyboard.json` |
| 20 | Served from a sub-path as GitHub Pages will serve it | PASS | `tests/qa/subpath.mjs`: a copy of the files in `<temp>/<unique>/continental-rails-game/`, the parent folder served by a case-sensitive static server; no root-relative URL in `index.html`, `style.css` or `src/` (0 found); the landing page, a four-bot game to the end screen (the module Web Worker included) and a bug-report download all worked at `/continental-rails-game/`; 142 requests, 0 outside the sub-path, 0 not found | `qa/subpath-landing.png`, `subpath-end.png` |
| 21 | No console errors, no debug logs in the render path | PASS | every script and smoke test fails on any console error or page error; `grep` finds no `console.` in `src/engine`, `src/bots`, or the render code (purity suite) | - |
| 22 | `.nojekyll` present; no file or folder name starts with an underscore | PASS | `.nojekyll` added at the root; the sweep found 0 such names | - |

The live site was checked after publication (section 8). Not verified: browsers other than Chrome (Edge, Firefox, Safari); real phones and tablets (the narrow layouts were checked at viewport sizes only); screen readers; slow devices; analytics with a real measurement id and the bug-report email link with a real address (both are inert while `src/ui/config.js` is empty, and smoke 19f checks them with a test-only override).

## 3. Art reconciliation

| | |
|---|---|
| Manifest entries | 184: 158 real, 26 placeholders |
| Ids the page requested while the checks played (`tests/qa/art-ids.mjs` served `art.js` with an instrumented lookup and played the landing page, bot games with every module on and with goals and milestones both, all four dock tabs and the hand-over cover) | 85, **all in the manifest** (one id the code asked for, `icon-bug`, was not: the optional lookup was dead code and was removed) |
| Requested by code but not hit in those games | 56: 49 numbered card pictures (found by `cardArtId`, so each appears when its card does) and 7 pictures with a literal reference (two bonus panels, three terrain icons, a carriage icon, the storage carriage) |
| Marked `"unused": true` with a note | 43 (27 real pictures kept for later or as alternatives, 16 placeholders no screen asks for yet). Nothing was deleted |
| Files over 200 KB in `assets/` | 0 (largest: 85 KB). The folder is 4.9 MB |
| Print-resolution art | none: the longest side of any picture is 1,600 px, and only for the placeholders; the largest real picture is 900 px |
| `python tools/build-art-manifest.py` | exit 0; regenerates `assets/art-manifest.md`. It now also rejects an absolute path or a personal folder name in any text field and an `unused` entry with no note |

The "Still needed" table in `assets/art-manifest.md` lists the 26 placeholders with size and what each should show, in order of benefit: `ui-hero` first (the landing page uses a district illustration until it exists), then `map-backdrop` (the map is drawn on plain parchment; the renderer needs one line to show the picture once it exists), then `ui-logo`, `train-engine`, the three track tiles, the player pieces, `token-pony-express` and `ui-favicon`, then the rest. No placeholder picture is shown on any screen: pieces whose art is a placeholder are drawn in code.

## 4. Pre-publication sweep

Run over every file git tracks or would track (319 files, 7.33 MB) by `node tests/qa/sweep.mjs`, which prints every hit.

| Category | Found and fixed | Remaining |
|---|---|---|
| Files or text from the internal rules spec, balance work or project task list | one test header naming the spec's file path (reworded); the audit report and engine contract pointed at the spec (reworded) | 0 |
| Internal references: task numbers, labels of internal rulings, internal role names, questions left for the designer | 5 documents, about 40 comment lines, 5 test names, one audit check id and a whole section of the engine contract | 0 |
| Secrets: tokens, keys, passwords, `.env` files | none found | 0 |
| Email addresses | one dummy address in a browser test (now built from parts); the configuration holds none: `BUG_REPORT_EMAIL` and `GA4_MEASUREMENT_ID` are empty | 0 |
| Local absolute paths: drive letters, user folders, sync-folder names, system font paths | a test comment, the placeholder tool's font paths, the art manifest checker's own pattern | 0 |
| The earlier game's title or a publisher's name | 6 files: the README, the art manifest in both forms, an extraction document, a browser test and the manifest tool | 0 |
| The metal's old name in any string (it is Iron); "house" outside the player-board sense | none found (every "house" in page and engine strings is the production piece on the player board) | 0 |
| Names starting with an underscore; CRLF line endings; a file over 1 MB; art over 200 KB | none found | 0 |
| Ignored folders really untracked (`node_modules`, `sim-results`, `tests/tmp`, `bug-reports`) | untracked | untracked |

Sizes: 319 files, 7.33 MB (7,686,122 bytes). Ten largest: `tests/ui-smoke.mjs` 157 KB, `src/bots/heuristicBot.js` 122 KB, `assets/art-manifest.json` 114 KB, `tests/rules-modules.test.mjs` 112 KB, `src/engine/legality.js` 109 KB, `docs/engine-contract.md` 94 KB, three district pictures of 81 to 83 KB, `src/engine/actions.js` 79 KB. Nothing is over 1 MB.

The page: `lang="en-GB"`, a title and description, `og:url` and `og:image` are absolute addresses on `https://www.wombatgamefactory.com/continental-rails-game/` (the image file is in the repository and is real art), a canonical link. `LICENSE` is the all-rights-reserved notice and `README.md` says so in one line. `CONFIG.BUILD` is `prototype 2026-10-11`.

What was removed from the documents: the engine contract's questions section is now "How the engine reads the rules where they are silent or ambiguous" (the questions framing and the three "what a task changed" sections were removed); the rules audit report lost its section of questions addressed to the designer (replaced by a neutral paragraph naming the six ambiguous readings) and its internal notes; the engine to-do lost its task attributions; the art extraction report lost its internal title and a request for confirmation; `docs/bots.md` lost its "Design findings from the search bots" section (observations about the game's balance) and the build machine's processor model.

**The git history.** The sweep reads files, not history. The repository was therefore published with a new, clean history under a no-reply author address (section 7); the working history of the build is not part of it.

## 5. Fixes made during the check

| File | What | Why |
|---|---|---|
| `tests/helpers/tmp.mjs` (new), `tests/sim.test.mjs`, `tests/sim-report.test.mjs`, `tests/bug-report.test.mjs` | temporary files go to a unique folder under the operating system's temp folder; clean-up is retried then left | the intermittent `EPERM` failure and the collision of overlapping runs |
| `tests/ui-smoke.mjs`, `tests/sim-report-browser.mjs`, `tests/bots-strength.mjs` | screenshots and logs are written through `writeEvidence` (a locked stale file is skipped); sim-report-browser keeps its simulator output in the temp folder; `waitSetup` waits for the page script to finish starting | a locked file under `tests/tmp/` must not fail a run; the browser-test race above |
| `src/ui/bot-driver.js`; `tests/ui-smoke.mjs` section 7b | `pacingFor(level, speed)`: the 0.85 s pause applies to the levels whose `defaultTimeBudgetMs` is 0; Hard and Expert wait 0.25 s (`HIGHLIGHT_PAUSE`) | the fixed pause stacked on a search bot's thinking time |
| `sim/args.mjs` | `--budget` and `--iterations` help say per turn | for the search levels the allowance is per turn, not per move |
| `index.html`, `tests/ui-smoke.mjs` | `og:url`, absolute `og:image`, canonical link | link previews are fetched by other sites |
| `.nojekyll` (new), `.gitignore` | the empty file; `__pycache__/` and `*.pyc` ignored | GitHub Pages' Jekyll; a Python tool leaves cache folders |
| `src/ui/config.js`, `tests/ui-smoke.mjs` | `BUILD` set to `prototype 2026-10-11` | a label that stays true |
| `src/ui/bug-report-ui.js` | removed an optional lookup of a bug icon that is not in the manifest (the button is text only, as before) | an id requested but missing from the manifest |
| `assets/art-manifest.json`, `assets/art-manifest.md`, `tools/build-art-manifest.py` | sources and notes made neutral (no earlier title, no spec wording); 43 entries marked unused with notes; the tool rejects absolute paths, understands `unused`, orders the "Still needed" table by benefit and drops an outdated note about renaming Iron | art reconciliation and the public repository |
| `tools/make-placeholder.py` | font file names instead of system paths | local paths in a tool default |
| `README.md` | rewritten for a public reader; every command in it was run | documentation |
| `docs/engine-contract.md`, `docs/rules-audit-report.md`, `docs/engine-todo.md`, `docs/psd-extraction-report.md`, `docs/bots.md` | internal framing removed (section 4); the bot pacing statement corrected | documents become public |
| comments in `src/`, `style.css` and `tests/` (about 40 lines), check names `R5.4.4`, `R14.2` and the audit id `R14.2/hat-timing` | task numbers and internal labels removed | public repository. **No engine behaviour changed**: the engine files differ only in comments |
| `tests/qa/*.mjs` (new) | the hand-run browser, art and sweep scripts used for this record | repeatability |

## 6. Known issues, most important first

1. **26 pictures are placeholders** (`assets/art-manifest.md`). The landing page uses a district illustration where `ui-hero` will go; `map-backdrop` and `train-engine` are not wired into the map and train renderers yet (each needs a small change once the art exists). Nothing hatched is ever shown.
2. **The start player is not marked on the board.** It matters only with `turnStructure = rounds` and in the last tie-break (the end screen's sentence mentions it). Reproduce: start a Rounds game and look for a marker.
3. **A player's name is cut short when its card also carries badges.** At 1440 x 900 in a two-player game, "Player 2" shows as "Pla..." beside the bot badge and the TURN badge (`qa/search-expert-thinking.png`). Reproduce: seat names longer than about six letters next to a bot level.
4. **A discard or upgrade target in the train is not clickable while a dock panel covers the train.** The prompt panel offers a button for the same action, so play is never blocked, but its heading says "click an item here or in your storage". Reproduce: a discard decision while the Upgrades tab is open (9 of the 75 human decisions in the full-game run).
5. **A search bot's first turn is long and the first frames can be slow.** Hard took 5.9 s and Expert 10.7 s on their first turn (their later turns took 1.7 to 4.5 s); the longest frame gap, 350 ms, came while the worker started. The page never froze and the driver never timed out.
6. **A demo game at Normal speed takes about eight minutes** (719 actions at 0.85 s). Fast speed takes under two. By design.
7. **Rule numbers (`R11.5.4`) in the documents, comments and test names refer to the designer's rules text, which is not in the repository.** A reader cannot look them up.
8. **Only Chrome was used** (section 2), and only at emulated viewport sizes.
9. **`?test=1` exposes `window.__cr`** (read the state, commit an action through the engine's own validation). It holds no secret and is how the tests drive the page; a visitor who adds it can use it.

## 7. Ready to publish?

**Yes. Published on 11/10/2026.**

- The tracked files are clean: every sweep category is at zero, all test suites pass (including five consecutive runs and two overlapping runs after the flaky suite was fixed), the clean-copy run passes, the simulator ran 3,040 games with zero refusals, caps, crashes, mismatches or turn-limit games, and the browser checklist has no failure.
- The one open point at the end of the check was the git history, which a file sweep cannot see. It was settled by publishing a new repository with a clean history under a no-reply author address. The file tree of the first published commit is identical to the tree that was checked.
- Not verified: browsers other than Chrome, real phones and tablets, screen readers and slow devices (section 2).

## 8. The live site

Checked after publication, in the installed Chrome driven by `playwright-core`, against <https://www.wombatgamefactory.com/continental-rails-game/>.

| Check | Result |
|---|---|
| The address | The site is served from `www.wombatgamefactory.com/continental-rails-game/` over HTTPS. The `github.io` address of the repository redirects to it. The page's `og:url`, `og:image` and canonical link use the served address. |
| Landing page | Loads with its title, heading and hook; 280 KB of images at first paint. |
| A four-bot game (Medium bots, instant speed, started by query string) | Reaches the end screen with ranked scores. |
| A Hard bot against a Medium bot | The search runs in the Web Worker and the game reaches the end screen in about 30 seconds at instant speed. |
| Console errors, page errors, failed requests, responses of 400 or above | None. |
| Hosts contacted | Only the site's own. |

One run made within seconds of a redeploy timed out waiting for the landing page; the runs before and after it passed. Allow a minute after a push before judging the live site.

## 9. The second ruleset: the final integration round (31/10/2026)

Pacific Rails, second edition (`pr2e`) was added as a second ruleset beside Continental Rails (engine, bots, screens, set-up choice). This section is the record of the check made once all of it was in, on an otherwise idle machine (Windows 11, Node 24, the installed Chrome 156, 23 worker threads), with what the check found and fixed. Build label unchanged (`prototype 2026-10-11`). The hand-run scripts it used are in `tests/qa/` (`rules-switch.mjs` and `human-game-pr2e.mjs` are new; `mcts-browser.mjs` gained `--rules=`).

### 9.1 Tests

| Check | Result |
|---|---|
| `npm test` (24 suites: the Continental Rails suites, the second edition's rule suites in `tests/pr2e/`, and the registry suite that runs the contract-level suites against every ruleset), two runs on the finished code | 24 suites, 0 failed, both times (148 s and 148 s) |
| `npm run test:ui` (68 sections, 13 of them for the second edition's screens), two runs | 68/68 sections passed both times, 0 console, page or request problems (143 s and 143 s) |
| `node tests/qa/sweep.mjs`, two runs | clean both times: 426 files, 9.18 MB, every category at 0 |
| The same three before any fix of this round (23 suites; 66 sections) | `npm test` 183 s and 163 s, all passed; `npm run test:ui` 66/66 both times (151 s, 129 s), 0 problems; sweep clean both times (423 files, 9.14 MB) |

### 9.2 Simulation health

All with `--jitter=0.05`, default variants, seed 1, Medium unless stated. "Clean" means 0 failed games, 0 refused bot actions, 0 harness decision-cap hits, 0 crashes and 0 bookkeeping mismatches; every run below was clean, and none ended by the turn limit.

| Run | Games | End reasons | Turn limit | Warnings in the health block |
|---|---|---|---|---|
| pr2e, 2 players, Medium v Medium | 200, 3.1 s | transcontinental line 200 (100%) | 0 (0.0%) | first-player win rate 57.5% (2.1 sigma); lead changes per game 4.6 (at least 5); distinct action types at a turn's first decision 2.2 (at least 2.5) |
| pr2e, 3 players, Medium, Easy, Random | 200, 2.5 s | transcontinental line 200 (100%) | 0 (0.0%) | margin of the winner 29.2% and games inside 10% 15.5% (a table of unequal bots); first-player win rate 87.5% (the Medium bot sits in seat 1); lead changes 3.4; legal actions at a turn's first decision 7.3 (8 to 12); distinct action types 2.3 |
| pr2e, 4 players, Medium, Medium, Easy, Easy | 200, 2.8 s | transcontinental line 200 (100%) | 0 (0.0%) | first-player win rate 61.3% (the two Mediums sit in seats 1 and 2); legal actions 6.6; distinct action types 2.3 |
| pr2e, 2 players, Hard v Medium, `--iterations=60` | 40, 84 s | transcontinental line 40 (100%) | 0 (0.0%) | margin 29.6% and games inside 10% 7.5% (Hard won 38 of 40); first-player win rate 95% (Hard sits in seat 1); lead changes 4.8; distinct action types 2.2 |
| Continental Rails, 3 players, Medium, Easy, Random | 200, 2.2 s | transcontinental line 192 (96%), routes claimed 8 (4%) | 0 (0.0%) | the same fixed-seat warnings as ever for this table: margin 39.4%, games inside 10% 4%, first-player win rate 95%, lead changes 4.0, legal actions 6.7, distinct action types 2.3 |

The warnings are thresholds written for Continental Rails and, in the fixed-seat tables, a consequence of the bots (a stronger bot in an early seat), not failures; none is a plumbing warning. The health block used to add four false warnings to every second-edition run ("moveTrain", "claimRoute", "hats" and "carriages" used in 0% of games, rules the second edition does not have): fixed (`sim/aggregate.mjs` leaves out a subsystem whose action the run's engine does not have; Continental Rails' output is unchanged).

### 9.3 Continental Rails is unchanged

`node sim/sim.mjs --games=40 --players=3 --bots=medium,easy,random --seed=4242` was run before the second ruleset's work (`arms[0].games` kept) and again on the finished code, after every change of this round: the 40 per-game records (seats, end reason, turns, decisions, scores, VP by source, actions, routes, buildings, milestones, goals and the rest; only the timing field is ignored) are **identical, 40 of 40 games, byte for byte**. (The last comparison, made after the last code change, found 0 differing games.)

### 9.4 The browser, in the installed Chrome

| # | Check | Result | How |
|---|---|---|---|
| 1 | A whole second-edition game, one human seat against a Medium and an Easy bot (3 players), by clicking only the page's own controls, to the end screen | PASS | `tests/qa/human-game-pr2e.mjs`: 73 human decisions (54 on board targets, 7 on panel buttons, 10 on other buttons), 84 turns, ended by the transcontinental line, 0 console, page or request problems, 0 bot-driver incidents; the decisions clicked included the set-up draft, worker steps, districts, board activations, resource choices, a discard, buildings on arrival, the free specialist and a special action. A second, shorter game (seed 2, 56 decisions) passed the same way |
| 2 | A whole Continental Rails game, one human seat against a Medium bot, all modules on | PASS | `tests/qa/human-game.mjs --preset=full`: 79 human decisions (61 on board targets, 18 on prompt buttons), 0 uses of the generic list of moves, ended after 56 turns, 0 console problems, 7 kinds of disabled control met, every one with a reason |
| 3 | Choosing the rules on a fresh load; switching part-way through set-up; the `?rules=pr2e` round trip; a saved game of each ruleset loaded onto the other's page; "Play again" and "Replay this seed" | PASS after one fix (below) | `tests/qa/rules-switch.mjs`: 27 checks, 0 failed. A fresh load has Continental Rails chosen and no `rules` in the address; switching to the second edition keeps the seats, kinds and names, drops the Continental Rails preset's variants from the address and shows the second edition's four presets; switching back drops the second edition's variants and brings Continental Rails' three presets back; `?rules=pr2e` (with `variants=`) survives a reload; an unknown rules value, and a variant name of the other ruleset, leave the page working (the unknown value stays in the address). |
| 4 | The bug reporter capturing a second-edition game, and `tools/replay-bug-report.mjs` replaying it | PASS after one fix (below) | the real dialog (button, title, Download) part-way through the game of check 1: the file names the ruleset (`rules: { id: "pr2e" }`), holds the complete state and the 184-action replay record, its replay check agrees (stored, deserialised and replayed hashes equal) and the tool exits 0 and prints the position, the pending decision, the legal actions and the block reasons by the second edition's engine |
| 5 | A Hard and an Expert search bot in the page, second edition against Continental Rails | PASS | `tests/mcts-browser.mjs --level=<level> --rules=pr2e`: see `docs/bots.md`, last section. Expert turn mean 4.98 s (95th percentile 8.13 s, maximum 8.35 s) against Continental Rails' 4.50 s (7.33 s, 7.33 s); Hard 1.41 s (2.02 s, 2.87 s); page frames at 60 a second, no frame gap over 217 ms, clicks handled in 13 ms, the thinking indicator on screen in every frame |
| 6 | Art on the first render of a second-edition game | PASS after one fix (below) | `art-check` (a script of the round, not kept): the district, Congress and carriage pictures are requested by the first render, so on a slow line they are blank until they arrive; see 9.5 |
| 7 | Layout of the second edition's screens at 1280 x 800 and 1440 x 900 (3 and 4 players, three carriages) | PASS after one fix; one limit left (9.6) | `ui-smoke` 21f3 |
| 8 | Every word on a second-edition screen against the terminology (train = map piece, house = player-board multiplier, district house, board activation) | PASS | the page text, every `title`, `alt` and `aria-label` and the tooltips of every kind of target, collected through a whole game (106 distinct uses of train, house, activation and the like: every one a correct use) |

### 9.5 Bugs found and fixed in this round

| Where | What was wrong | Fix |
|---|---|---|
| `src/ui/pr2e/pr2e.css` | **A click on the player board chose the wrong track.** Each of the four house tracks has a transparent overlay that covers the whole board, and a lit overlay took every click; with several lit at once (the first choice of every game, "which track starts at production 2", and every choice of a house track later) every click on the board went to the last overlay, Coins, whichever track was meant. The buttons in the prompt panel were right, so play was never blocked, which is why the clicking tests did not catch it (they click the element, not the point). | A lit overlay no longer takes clicks itself; its own house spaces and production badge do. `ui-smoke` 21f2 asks the browser which element is under each track's badge and then clicks one with the real mouse. |
| `src/ui/bug-report-capture.js` | The report read Continental Rails fields: `storageCarriages` came out empty, `hatsGainedThisTurn` came out as the text "NaN", the goals and the Congress columns were missing, the carriages showed no upgrade token, and a board activation was not recognised. | The report carries the second edition's carriages with their tokens, the board activation in progress, the four goals with each player's value and the sole leader, the eight Congress columns and the Reset with their senators, the lay path being built and what it would score; no Continental Rails stand-in fields. A Continental Rails report is unchanged. New suite `tests/pr2e/bug-report-pr2e.test.mjs` (9 checks). |
| `src/ui/main.js` | **"Play again" and "Replay this seed" after a loaded game started the set-up form's rules, not the game's** (a loaded second-edition game became Continental Rails, and the other way round). Only the test hook loads games today. | A loaded game makes the set-up form follow its rules (`setRules`). `tests/qa/rules-switch.mjs` checks both directions. |
| `src/ui/art.js`, `src/ui/setup.js`, `src/ui/ruleset-views.js`, `tests/ui-smoke.mjs` | The blank art in `tests/tmp/ui/pr2e-in-play-1440x900.png` is what a player sees too: pictures are first requested when a screen is first drawn, so for as long as they take to arrive the district, Congress and carriage art is blank (nothing is "loaded only after a later re-render"). Measured with an empty cache: all 91 pictures of the second edition's first screen pending at the first frame and complete 14 ms later on a local server and 3.2 s later on a 1.6 Mbit/s line, the same shape as Continental Rails (33 ms and 3.5 s). It was the test's screenshot being taken at once that made it look like a defect. | Choosing the second edition on the set-up page asks the browser to fetch its real pictures in its idle time (`warmArt`: 44 `pr2e-` pictures and the shared icons its screens use, about 840 KB; Continental Rails is not warmed). After 8 s on the set-up page on the slow line the first frame has 1 picture pending and all are in 89 ms later; after only 1.5 s the line has not finished and the gain is small. `shot()` of the smoke test now waits for the pictures that are on screen. |
| `src/ui/pr2e/pr2e.css` | **Three carriages forced sideways scrolling** at 1280 x 800 and, it turned out, at 1440 x 900 too (the strip was 840 and 877 px wide for about 1,000 px of board and carriages), partly because a "next carriage" box (here only a count of railway stations) kept its 120 px. | The strip is a size container and the board height shrinks to fit three carriages (`--pb-h`, never above the printed 160 px); the count box gives way below 1250 px. No sideways scrolling at either size; `ui-smoke` 21f3. |
| `src/ui/pr2e/pr2e.css` | At 1440 x 900 with 4 players the side column was 51 px too short for the four cards and four goals, so the last goals were cut and had to be scrolled to. | Four players (`:has()` the fourth card) get slightly tighter cards, goal rows and log; everything now fits at 1440 x 900. At 1280 x 800 the column still scrolls inside its frame (9.6). |
| `src/ui/main.js`, `src/ui/ruleset-views.js` | The accessible names of the page's fixed regions came from `index.html`: "Train", "Lobby Congress" and "Add-on modules" were read out on second-edition screens. | A second-edition game names them "Player board", "Congress" and "Goals, upgrade tokens and specialists" (`REGION_LABELS_BY_RULESET`); Continental Rails keeps the `index.html` names. `ui-smoke` 21f. |
| `src/ui/pr2e/common.js` | The Congress column 5 reward was abbreviated "House or token, 1 VP" (a house is the player-board piece; the reward is a district house). Not shown on any screen yet. | "District house or token, 1 VP". |
| `sim/aggregate.mjs` | The subsystem rows of the health table counted Continental Rails' actions in a second-edition run (9.2). | Rows for actions the engine does not have are left out. |
| `tests/mcts-browser.mjs` | Its "click while the bot thinks" control was a selector for a control the page does not have, so no click would have been measured; it had no `--rules`. | It clicks a player card; `--rules=pr2e`. |
| `README.md`, `docs/engine-contract.md`, `docs/engine-contract-pr2e.md`, `docs/rules-audit-report-pr2e.md`, `docs/bots.md`, `docs/engine-todo.md`, `tests/pr2e/smoke-pr2e.mjs` | Text saying the second edition's bots were a temporary stand-in (they are the heuristic bot of `src/bots/pr2e/`) and that its page used Continental Rails' views; the audit report still listed three known failures that the engine has since fixed (371 of 371 pass). | Brought up to date; the README now describes both rulesets, `--rules`, how to run each one's tests and simulations, and the layout. |

### 9.6 Known issues and behaviours left open

1. **Undo stays available during a second-edition path lay, and steps back one choice at a time.** During a lay it undoes the last route added to the path, then the start of the lay, then the district choice and the worker. Nothing is paid, scored or moved before the lay ends (the engine's `endLay`), so this loses nothing. Left as it is, by decision. Reproduce: choose Lay Track at the centre district, start a lay, add a route, press Undo (the path goes SEA > SPO > POR, then SEA > SPO, then no path, then back to the district choice).
2. **At 1280 x 800 the players column scrolls inside its frame** for 3 and 4 players: the third and fourth goals are below the fold of the column (the cards are all visible). The column is as tight as the page allows at that height without cutting the log; a player scrolls it with the wheel. Reproduce: any 3 or 4-player game at 1280 x 800.
3. **Continental Rails draws its first screen's pictures blank until they arrive** (about 3.5 s on a 1.6 Mbit/s line; 15 to 35 ms locally), as the second edition did before the warm-up; Continental Rails is not warmed because it is the default page and its landing page is held to a small first load. A small change if wanted (`ART_PREFIX_BY_RULESET` takes a Continental Rails entry).
4. **An unknown `?rules=` value stays in the address** after the page has fallen back to Continental Rails (the set-up page reports the unknown rules); harmless.
5. **A saved game can only be loaded through the test hook** (`?test=1`); the page has no load control for either ruleset.
6. **The second-edition Expert turn is about 0.5 s longer than Continental Rails'** (4.98 s against 4.50 s of a 6 s budget): one game each, so approximate; `PR2E_SEARCH_SETTINGS.shareScale` is the number to turn.
7. **Upgrade tokens are named by their id on the second edition's screens** ("U2-coins"), not by a printed name; the pictures are the printed tokens.
8. Still not verified (as in section 2): browsers other than Chrome, real phones and tablets, screen readers.

### 9.7 Balance observations from the bots (notes, not design conclusions)

These come from the Medium bot playing the second edition's rules and are evidence about the bot first. Nothing here was changed or ruled on.

- **Later seats win far less often, with identical bots.** Medium against Medium: at 2 players seat 1 won 57.5% of 200 games (2.1 sigma); at 3 players seats 1 to 3 won 52%, 34% and 14% of 600 games and at 4 players seats 1 to 4 won 39%, 38%, 13% and 10% of 600 (`docs/bots.md`). A game is a race to the line, and the first seats choose their worker spaces and Congress columns first, so it is plausibly a property of the rules; whether a better or different bot would show less of it is not known.
- **Medium leans heavily on Congress, and above all on Resets fed by Coins.** About 35 columns and Resets a game at 2 players (11.7% of its VP come from Congress), 16 Coins collected a player against 1 to 2 of every other resource: it plays a Coin economy, and a Coin weight of 1.0 in place of 2.2 made it a player Medium beat 71% to 29%. The Reset (1 Coin, 1 VP for each senator that is down) is cheap VP for anyone with Coins and a Financier. Whether it is as strong for a human, or for a bot that plays another line, is not shown by these runs.
- In the same runs, the largest single VP source is the final building table (30 to 34% of all VP), and the winners-against-the-rest tables of the simulator show goals G12 and G5, and the upgrade tokens U2-coins and U3-choice, with the biggest win-rate differences; at these sample sizes they are leads to look at, not findings.

### 9.8 Terminology debt (Continental Rails): where its screens call the player board a "train"

For the designer to decide; **no Continental Rails wording was changed**. The player board is the "player board" and running it a "board activation"; a train is a map piece. Each place below calls the player board a train, or a board activation a "train activation", in text a player or a search engine can read. Line numbers are as of this date.

The landing page and the page's own text:

- `index.html:7` (meta description: "build the train that builds the railroad"), `:14` (`og:description`, the same sentence), `:54` (`aria-label="Train"` of the strip under the map; second-edition games override it).
- `src/ui/setup.js:229` (the landing hook "Build the train that builds the railroad, then race it across the continent."), `:231` (intro: "the specialists aboard your train"), `:244` (the Build step: "Track districts set your train running ... Tiles are built on your train and wait in its storage"), `:253` (the closing note: "Tiles are built on your train first"), `:256` ("Your train is your engine.").

The game screens:

- `src/ui/board-render.js:158` (the player cards' tooltips: "...'s train is shown under the map" and "Show ...'s train under the map"), `:180` ("click one to see its train"), `:479` (tooltip "Built by train activations"), `:480` ("Built here by a train activation."), `:505` (the heading "Train activation").
- `src/ui/module-panels.js:174` ("Installed in the trains"), `:379` and `:380` (the tab "Train", and the tooltip "show the train again"), `:387` (`aria-label` "The train and the add-on modules").
- `src/ui/log.js:67` ("(in storage on the train)"), `:89` ("Train activation: Foreman acts as ...").
- `src/ui/action-targets.js:242` ("It goes to your storage on the train, not onto the map.").

Text the Continental Rails engine produces, which the screens show (block reasons, decision labels, card and goal text; the second edition's engine has none of it):

- `src/engine/legality.js:275`, `:581`, `:607`, `:611` ("in trains", "your train", "every specialist slot in your train"), `:723`, `:733` and `:831` ("only while you are in a train activation", "during a train activation"), `:780`, `:1205`, `:1206`, `:1208`, `:1215`, `:1247`, `:1424` (the carriage, slot and specialist reasons of cards), `:2095` and `:2105` (decision labels: "in this train activation").
- `src/engine/rules.js:581`, `:590`, `:599`, `:617`, `:720`, `:727` (goal and milestone texts: "in your train"), `:587` (the goal's name, "Longest Train"), `:905`, `:1092`, `:1148`, `:1266` ("train activation" in the Legislative Agenda and Pony Express card texts), `:1046` and `:1166` ("Activate your train now with M = 1").
- `src/engine/conditions.js:170` ("specialist in your train").

Not debt: "Move Train", "your train" for the piece that moves on the map (`legality.js:984`, `:994`, `:2169`, `rules.js:168`), and the code identifiers (`railhead`, `trainActivation`, the `train` field of the state), which keep their old spelling by rule. The art ids `illustration-train-engine` and `train-storage-carriage` and the CSS classes `train`, `region--trains` are names, not text.

## 10. Route map v3, the wild slot and the new player-board art (31/10/2026)

What changed since section 9: both rulesets play on route map v3 (35 cities, 65 routes, 134 slots, 3 of them wild slots; engines, bots and the on-screen map redrawn on the designer's watercolour backdrop), Continental Rails' route end trigger is 10 routes a player, and Continental Rails has its new player-board, carriage, specialist and resource art. This is the check of all of it together, on the working tree at commit 4f9ae20 plus the small fixes of 10.6. Windows 11, Node 24, the installed Chrome 156, 24 logical processors. The hand-run script `tests/qa/human-game-map3.mjs` is new.

**Another project's job shared this machine.** A bot-ladder run of a different game used 16 worker processes from 17:52 to 18:11 and again from 18:34 for about 20 minutes. Every timed check below says whether it ran while the machine was quiet; a check that fails only under load is recorded as such, not hidden.

### 10.1 Tests

| Check | Result |
|---|---|
| `npm test` (24 suites), run 1, **machine busy** with the other job | 23 passed, 1 failed: `smoke`, only its check "random playouts run at a usable speed" (16,566 decisions a second at 2 players against the 20,000 it asks for); every game and every other check of the suite passed. Not a fault of the game |
| `npm test`, runs 2 and 3, **quiet** | 24 suites, 0 failed, both times (run 3: 218 s). The speed check read 108,000 decisions a second at 2 players. Counts: rules audit 496/496 (6 skipped), second-edition audit 386/386 (18 skipped), smoke 3,027/3,027 (2,933 random games, 2,486,923 decisions, 0 refusals, 0 cap hits), rules-data 23/23 (one new check, 10.6) |
| `npm run test:ui` (71 sections), run 1, **quiet** | 71/71, 0 console, page or request problems, 165 s |
| `npm run test:ui`, run 2, **busy again** (the other job's second run) | 70/71 in 449 s: section 17a (carriage upgrades, Continental Rails) hit a 3 s click timeout ("target space:W1 is not clickable"), the kind of failure a loaded machine causes; the same section passed in run 1 and in run 3 below |
| `npm run test:ui`, run 3, **quiet** (the other job had ended) | 71/71, 0 console, page or request problems, 242 s |
| `node tests/qa/sweep.mjs` | clean every time: 446 files, 9.95 MB (the backdrop is 247 KB, inside its exemption), every category at 0 (three runs, the last after every document edit of this round) |

### 10.2 One clicked game in each ruleset, with wild-slot decisions

`tests/qa/human-game-map3.mjs --rules=continental|pr2e` (adapted from the second edition's human-game script): one human seat against a Medium and an Easy bot, 3 players, 1440 x 900, played to the end screen by clicking the page's own controls (board targets, prompt-panel buttons and the choice dialog). A random clicker almost never builds two kinds of tile, and the engine asks about a wild slot only when more than one kind could fill it, so the script makes two **assisted** moves, recorded in its output: at the human's 15th and about 45th decision it saves the game through `window.__cr.saveGame()`, gives the human 2 built tiles of each kind and a train on the first city of an unlaid wild route (Spokane for Spokane - Helena, Billings for Billings - Denver), and reloads it through `loadState`; from then on it heads for that route. Every other click is its seeded random rule.

| | Continental Rails | Second edition |
|---|---|---|
| Game | 98 human decisions, 105 turns, ended by the transcontinental line, 271 / 225 / 95 VP (the human last), 38 s | 61 human decisions, 60 turns, ended by the line (and the last round), 151 / 150 / 39 VP (the human last), 16 s |
| Wild-slot decisions taken by the human | 2: Spokane - Helena slot 3 (Ground, Tunnel and Bridge offered; chose Ground), Billings - Denver slot 2 (all three offered; chose Tunnel) | the same 2, same offers and choices (the second edition asks when the lay ends) |
| What the page showed | the prompt named the slot and route, three buttons "Ground tile / Tunnel tile / Bridge tile" with "You hold 2", exactly one slot lit on the map; the choice was in `map.wildFill` at the end | the same text and lit slot; `remaining: 0` in the frame |
| Console, page or request problems; bot-driver incidents | 0; 0 | 0; 0 |
| Clicks that fell back from a board target to a prompt-panel button | 6, all "discard" while the Pony Express dock tab was open (the discard targets are on the player board, in the Train tab, which was not showing; the prompt panel's buttons worked and the prompt says "click an item here or in your storage") | 0 |

The set-up screen's house-track target (`house:coins`) is a transparent wrapper over the whole track by design (its own house spaces and production badge take the click, as the second edition's fix of 9.5 does), so the script clicks the badge. Looked at (screenshots of the prompt, the position after the choice, the assist, early play and the end screen, both rulesets): the map, backdrop, slots, icons and labels agree with the printed board at 1440 x 900, the wild-slot prompt and the lit slot are right, and both end screens are right; the one oddity is cosmetic (10.7 item 7). The two older hand-run games were re-run on the new map and pass: `tests/qa/human-game-pr2e.mjs` (all checks, including "Replay this seed" and "New game" keeping the ruleset) and `tests/qa/human-game.mjs --preset=full` (112 human decisions, 0 console problems, 64 turns; 31 of its clicks now go to the prompt panel's buttons because the player board's house-track and storage targets are only clickable on their own spaces or when the Train tab is showing, which is by design).

### 10.3 Bot timing in the browser

`node tests/mcts-browser.mjs --level=<level> --rules=<rules> --seed=<n>`, speed "instant", against a Medium bot, quiet machine; time-budgeted bots are not reproducible, so each combination was played twice (seeds 7 and 11) and the second edition's Hard seed 7 three times. Per turn of the search bot: mean (95th percentile, maximum); then the longest gap between two animation frames while the bot thinks.

| | Continental Rails Hard | Second edition Hard | Continental Rails Expert | Second edition Expert |
|---|---|---|---|---|
| seed 7 | 1.40 s (1.87, 1.88); 117 ms | 1.60 s (2.53, 2.63); **317 ms**; repeats 1.34 s (1.98, 2.33); 50 ms and 1.34 s (2.03, 2.32); 50 ms | 4.61 s (7.33, 7.50); 117 ms | 4.95 s (8.63, 9.25); 83 ms |
| seed 11 | 1.41 s (2.48, 2.48); 50 ms | 1.35 s (2.08, 2.08); 183 ms | 6.01 s (9.07, 9.07); 117 ms | 5.02 s (7.85, 8.37); 217 ms |
| Both games together | 1.40 s over 43 turns | 1.41 s over 92 turns (4 games) | 5.23 s over 41 turns | 4.99 s over 46 turns |
| Whole game | 36 s and 31 s | 41, 34, 34 and 30 s | 115 s and 119 s | 120 s and 120 s |

The figures of `docs/bots.md` (seed 7, old map) were second-edition Expert 4.98 s and Continental Rails Expert 4.50 s; on the new map and the same seed they are 4.95 s and 4.61 s, so the larger map has not made a search turn slower (the budget is a clock; what changes is the playouts a turn buys). Every check of the harness passed in all runs except **one**: the second edition's Hard game of seed 7, first run, had a 317 ms gap between two frames (the limit is 250 ms); its two repeats had 50 ms and the other second-edition games 183 ms and 217 ms, which fits the earlier record (217 ms), so it reads as a one-off hitch of the machine, not a regression. Clicks while the bot thinks were handled in 8 to 12 ms on average (16 ms at most), and the thinking indicator was on screen in every frame.

### 10.4 Simulation health

500 games each, `--jitter=0.05`, default variants, seed 1, 6 worker threads (the results do not depend on the thread count). Every run had 0 failed games, 0 refused bot actions, 0 decision-cap hits, 0 crashes and 0 bookkeeping mismatches. Mixed table: Medium, Easy, Random with rotated seats.

| Ruleset, table | Turn-limit games | End reasons | Turns a player: mean (range) | Seat win rates | Routes claimed a game |
|---|---|---|---|---|---|
| Continental Rails, 2 players, Medium | 0 | routes claimed 381 (76.2%), transcontinental 119 | 22.9 (15 to 30) | 55.1 / 44.9% | 19.8 of 65 |
| Continental Rails, 3 players, Medium | 0 | routes claimed 156 (31.2%), transcontinental 344 | 23.5 (14 to 32) | 66.7 / 21.2 / 12.1% | 27.0 |
| Continental Rails, 4 players, Medium | 0 | routes claimed 82 (16.4%), transcontinental 418 | 23.2 (11 to 33) | 29.7 / 18.5 / 25.5 / 26.4% | 34.0 |
| Continental Rails, 3 players, Medium + Easy + Random | 0 | routes claimed 29 (5.8%), transcontinental 471 | 26.9 (13 to 45) | by seat 34.5 / 33.6 / 31.9%; by bot Medium 94.3%, Easy 5.7%, Random 0% | 21.2 |
| Second edition, 2 players, Medium | 0 | transcontinental 500 | 23.4 (14 to 34) | 46.9 / 53.1% | 17.7 |
| Second edition, 3 players, Medium | **2 (0.4%)** | transcontinental 498 | 23.7 (14 to 70) | 39.4 / 30.2 / 30.4% | 23.1 |
| Second edition, 4 players, Medium | **12 (2.4%)** | transcontinental 488 | 25.3 (13 to 77) | 30.1 / 23.5 / 24.5 / 21.9% | 27.2 |
| Second edition, 3 players, Medium + Easy + Random | 0 | transcontinental 500 | 25.3 (15 to 37) | by seat 34.3 / 30.7 / 35.0%; by bot Medium 89.2%, Easy 10.8%, Random 0% | 18.7 |

Means exclude turn-limit games. **The second edition's turn-limit games are confirmed**: 0.4% at 3 players and 2.4% at 4, exactly the figures the engine port found. The port's diagnosis is that the Medium bot has a full storage of tiles of the wrong terrain, its line stops one or two slots short, and it does not build what it lacks; a horizon floor in the planner was tried and reverted. Not fixed here (bot work). Seat win rates are bot evidence: the Continental Rails 3-player table gives seat 1 two thirds of the wins and its 4-player table gives seat 2 only 18.5%; with the end trigger at 10 routes a player, 76% of its 2-player games end by the route limit and not by a transcontinental line.

### 10.5 Fixed-seed baselines on route map v3, and determinism

`node sim/sim.mjs --games=40 --players=3 --bots=medium,easy,random --seed=4242` (the second edition with `--rules=pr2e`), run twice per ruleset with different thread counts (4 and 2). **All 40 games of each pair are identical** (every field of every game and of the arm's aggregates, ignoring only the per-game `timing.ms`): the engines are deterministic on the new map. The first run of each is the new baseline, kept outside the repository; the old Continental Rails identity check of 9.3 is retired by design, because the map changed the game. Both ended 40 of 40 with 0 refusals.

### 10.6 Small repository fixes made in this round

- `tools/build-route-map-module.mjs` now builds both engines' `route-map.js` (`continental`, `pr2e`, or both with no argument). The Continental Rails module regenerates byte for byte; the second edition's differs from the committed one in one header line (`Regenerate with: node tools/build-route-map-module.mjs pr2e`).
- `tests/rules-data.test.mjs`: a check that the two engines' `route-map.json` files are identical, that the second edition's `route-map.js` equals its JSON, and that both modules hold the same map.
- `tests/rules-audit-pr2e/part-6.mjs` (check `P21.2/telegraph-and-carriage3`): it laid `SEA-SPO`, a route of the old map, which the helper skipped silently (the check passed on the telegraph VP for another reason); it now lays `SEA-YAK` with a Tunnel, so the check does what it says. Audit still 386/386.
- Stale text: `SEA-SPO` in comments and the engine contract (now `SEA-TDL`), `DEN-KCY` in the bug-report example (`GRI-KCY`), "serves all 17" Pony Express tokens in the art manifest (27), "8 routes per player" in `tests/smoke.test.mjs` and `docs/rules-audit-report.md` (the default is 10), the variant counts (26 and 8) in the README, `docs/engine-todo.md` and `sim/SCHEMA.md`, and an old-map note in `docs/rules-audit-report-pr2e.md`. A search for "25 cities", "47 routes", "136", "17 inland", "500 x 400", Cheyenne, Sioux Falls and every route id that no longer exists found nothing else outside git history and the ignored `tests/tmp/` scratch folder (old-map files from earlier work).

### 10.7 Known issues and behaviours left open

1. **The second edition's Medium bot ends 0.4% (3 players) and 2.4% (4 players) of its games by the turn limit** (10.4): a bot weakness, not a rules fault. `maxTurnsPerPlayer` (80) is what stops them.
2. **The map is small at 1280 x 800.** The drawn map is 600 px wide there (681 px at 1440 x 900, 994 at 1920 x 1080), under half the page, with an empty strip of its frame below it, and the slot icons are small. An **"enlarge map" toggle** (the map across the centre and the dock folded away while it is on) is the idea; not built. At phone width the map is 780 px wide inside its own frame and the page does not scroll sideways.
3. **Art and engine storage disagree (Continental Rails).** The printed board and carriage are the one-kind-of-carriage design of spec v5 (6 spaces on the board, 3 on each carriage); the engine plays spec v4's storage (a specialist carriage stores nothing; a storage carriage holds 9). The board draws the stored items on the printed spaces in order, puts a lid on spaces the capacity does not allow, and shows capacity beyond the printed spaces as a "More storage" row. When the engine moves to v5 the lids and the extra row never appear (`src/ui/cr-player-board.js`).
4. **Continental Rails' discard prompt says "click an item here or in your storage"**, but the storage is in the Train tab, which is not opened for the decision when another dock tab (here Pony Express) is showing; the prompt's own buttons always work. A small change if wanted.
5. **Seat bias with identical Medium bots on the new map** (10.4): Continental Rails 3 players 66.7 / 21.2 / 12.1%; the second edition's old bias has mostly gone (4 players 40 / 38 / 12 / 10% before, 30 / 24 / 25 / 22% now). Bot evidence only.
6. **The route end trigger is now the usual end of a two-player game** (76% of Continental Rails games at 2 players end by the 10-route limit; 31% at 3 players, 16% at 4).
7. **Cosmetic, not investigated:** on the second edition's end screen the game log's "Scoring" popover shows at full brightness at the right edge, beside the dimmed end dialog.
8. **A timed check can fail on a busy machine** (the smoke suite's decisions-a-second check, the UI test's 3 s click timeouts, the browser harness's 250 ms frame gap). They need a quiet machine, as their headers say.
9. **The rulebook, the sell sheet and the map diagrams lag the new map** (the rulebook is written from spec v8 and shows route map v2); section 9.8's line numbers for the terminology debt are those of the earlier date. Not touched here.
10. Still not verified (as in section 2): browsers other than Chrome, real phones and tablets, screen readers.
