# Continental Rails - quality assurance record

Date: 11/10/2026. Build label: `prototype 2026-10-11` (`src/ui/config.js`). Machine: Windows 11, Node 24, the installed Chrome (154), 23 worker threads.

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
| 2 | A complete human game from the landing page to the end screen, all modules on, against one Medium bot, through the bespoke controls | PASS | `tests/qa/human-game.mjs --preset=full`: chose the preset, the seats and Start on the page; 75 human decisions, each by clicking the on-screen target for a legal action picked by a seeded rule. **0 uses of the generic list of legal moves.** 53 clicked a target on the board; 22 clicked a button in the prompt panel (decisions the page offers only as panel buttons, such as choosing a resource, plus 9 where a board target existed but was not on screen: `discard` 7, `installUpgrade` 1, `exchangeToken` 1; see known issue 5). Ended on the end screen after 50 turns; 0 console errors; 0 driver incidents | `qa/human-full-*.png`, `human-game-full.json` |
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

Not verified: the live GitHub Pages site (HTTPS, headers, caching) - only its sub-path layout was reproduced locally; browsers other than Chrome (Edge, Firefox, Safari); real phones and tablets (the narrow layouts were checked at viewport sizes only); screen readers; slow devices; analytics with a real measurement id and the bug-report email link with a real address (both are inert while `src/ui/config.js` is empty, and smoke 19f checks them with a test-only override).

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

**Not covered by the sweep: the git history.** See known issue 1.

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

1. **The git history is not clean (decision needed before publishing).** All 15 commits carry the designer's personal email address in their author field, and earlier revisions of files contain what the sweep removed from the current files: the earlier game's title (commits c9f8deb, d149b15, ba354ca, b5ebe32), a publisher's name (b5ebe32), the spec's file path in the audit report and its test header (d726e10), a sync-folder name in a test comment (e71610e), and the earlier versions of the documents with their internal framing. No commit message contains any of these. Making the repository public publishes all of it. Options: publish a new repository with a single squashed commit under a no-reply address, or accept it. This QA could not change history.
2. **26 pictures are placeholders** (`assets/art-manifest.md`). The landing page uses a district illustration where `ui-hero` will go; `map-backdrop` and `train-engine` are not wired into the map and train renderers yet (each needs a small change once the art exists). Nothing hatched is ever shown.
3. **The start player is not marked on the board.** It matters only with `turnStructure = rounds` and in the last tie-break (the end screen's sentence mentions it). Reproduce: start a Rounds game and look for a marker.
4. **A player's name is cut short when its card also carries badges.** At 1440 x 900 in a two-player game, "Player 2" shows as "Pla..." beside the bot badge and the TURN badge (`qa/search-expert-thinking.png`). Reproduce: seat names longer than about six letters next to a bot level.
5. **A discard or upgrade target in the train is not clickable while a dock panel covers the train.** The prompt panel offers a button for the same action, so play is never blocked, but its heading says "click an item here or in your storage". Reproduce: a discard decision while the Upgrades tab is open (9 of the 75 human decisions in the full-game run).
6. **A search bot's first turn is long and the first frames can be slow.** Hard took 5.9 s and Expert 10.7 s on their first turn (their later turns took 1.7 to 4.5 s); the longest frame gap, 350 ms, came while the worker started. The page never froze and the driver never timed out.
7. **A demo game at Normal speed takes about eight minutes** (719 actions at 0.85 s). Fast speed takes under two. By design.
8. **Rule numbers (`R11.5.4`) in the documents, comments and test names refer to the designer's rules text, which is not in the repository.** A reader cannot look them up.
9. **Only Chrome was used** (section 2), and only at emulated viewport sizes.
10. **`?test=1` exposes `window.__cr`** (read the state, commit an action through the engine's own validation). It holds no secret and is how the tests drive the page; a visitor who adds it can use it.

## 7. Ready to publish?

**No, not yet - one decision is open; everything else is ready.**

- The tracked files are clean: every sweep category is at zero, all test suites pass (including five consecutive runs and two overlapping runs after the flaky suite was fixed), the clean-clone run of the published commit and of the corrected tree passes, the simulator ran 3,040 games with zero refusals, caps, crashes, mismatches or turn-limit games, and the browser checklist has no failure.
- **Blocking decision:** the git history publishes the designer's personal email address and earlier revisions that mention the earlier game's title, a publisher's name and internal framing (known issue 1). If the repository is published as it is, that is the price; if not, publish a squashed history first. This is the designer's call, not a defect in the files.
- The corrected files are in the working folder and have not been committed or pushed; the live site cannot be checked until they are.
- Not verified: the live Pages deployment, other browsers and real devices (section 2).
