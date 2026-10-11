# Bug reports

When a playtester says "the game would not let me do that", the answer is a rules question as the engine read it at that instant. A screenshot cannot answer it. The in-game reporter captures a self-contained JSON file that can.

## What a report contains

One file, `continental-rails-bug-<id>-<slug-of-title>.json`, with the id `crbug-YYYYMMDD-HHMMSS-xxxx` (local time, random suffix). Top-level keys:

| key | what it holds |
|---|---|
| `schemaVersion`, `id`, `timestamp`, `build` | format version, the id, the time, and `CONFIG.BUILD` |
| `environment` | URL with query string, user agent, viewport, device pixel ratio, language, reduced-motion preference |
| `screen` | `setup`, `game`, `cover` (the hand-over cover) or `end` |
| `words` | the player's title, category (verbatim label), what they expected, what happened |
| `table` | seats (human or bot level, names, colours), seed, variants not at their default, modules on |
| `gameState`, `stateHash`, `seq` | the **complete** game state, its `hashState`, the number of actions applied |
| `replay` | `getGameConfig(state)` and the full list of actions applied, so `replayGame(config, actions)` rebuilds the state |
| `replayCheck` | the capture re-derived the state from `replay` and says whether the hash agrees |
| `ui` | the page's own state: interaction mode, pending choice, hat toggle, open panel, undo depth, whether a bot was thinking, bot speed, paused |
| `diagnostics` | see below |
| `actionLog` | the last 80 applied actions: player, `describeAction` text, and `human` / `bot` / `fallback` / `automatic` |
| `eventLog` | the last 120 events: errors, warnings, every refusal shown to the player with its reason, every click the page ignored and why (`ignored: a bot is thinking`, `ignored: hand-over cover is up`, `ignored: no legal action maps to this control`), bot incidents and failure-cap trips |
| `capture` | which sections failed (an `error` key in a section is itself worth reading) and the caps used |

Everything except `gameState` and `replay` is capped (depth 12, 300 items in an array, 4000 characters in a string) so one fat object cannot bloat the file. A typical mid-game report is about 130 KB compact.

### Diagnostics, the heart of it

Computed for **the player the report is about**: the human who must act now; if a bot is to act, the human who acted last (answering "why can't I act" for a bot answers the wrong question). `diagnostics.reporter` says who and why.

- `decision` and `stack`: the engine's `describeDecision`, and the pending decision stack as kinds and players.
- `legal`: the complete list of legal actions with `describeAction` text.
- `actionSpace`: for **every** action in `getActionSpace(state)`, grouped by action type, the engine's `getBlockReason` (`now`) and `getStructuralBlockReason` (`structural`, the same question with timing aside). **`null` means the action WAS legal.** That turns a rules question into a UI bug: a control that looked dead beside a `null` reason. Identical reasons are grouped with a count. Claims, moves, placements, hires, Congress entries, card purchases and every type in the current decision are described in full (up to 120 actions per type; the rest are listed by key under their reason in `moreKeys`, so any action can be found by key). `agreement` checks that the actions with a null reason are exactly `getValidActions`; a difference is an engine bug.
- `players`: the numbers a rules question usually turns on: resources, built tiles, storage used and capacity, Coins, hats and hats gained this turn, workers in supply and on the grid, production per track, railheads, routes owned, buildings, specialists, bonus actions used, lobby points in an activation, Pony Express tokens, upgrades installed, VP by source.
- `score` and `progress`: `scoreGame` by source, and goal and milestone progress using the same strings the UI shows (`describeProgress`, `standingText`).
- `controls`: what each control the UI had rendered said about itself: label, whether enabled, its lit marker, its tooltip text.

### The three promises

The module header of `src/ui/bug-report-capture.js` states them and the tests enforce them.

1. **It never throws.** Every section is built inside `section(name, fn)`; a failure becomes `{ error: 'message' }` and the report still completes.
2. **It never mutates.** It works on clones of the game state (one written, one the engine helpers are pointed at). The tests compare `hashState` of the live game before and after a capture.
3. **It is stringify-safe, proven.** The finished report is round-tripped once through `JSON.stringify` / `JSON.parse`; a section that will not survive becomes `{ error }`.

The snapshot is frozen the instant the dialog opens, not when the player presses Download, because a bot may move while they type.

## How a tester sends one

1. Press the **Report a problem** button (on every screen: at the bottom left of the set-up page, in the header during a game) or **Ctrl+Shift+B**.
2. Give a short title, pick the kind of problem, say what they expected and what happened.
3. Press **Download report** and send the file back with the report id shown at the top of the dialog. If the download is blocked, **Copy to clipboard** (or the box that appears) and paste it into the message.
4. Reports are also kept on the device (about 20 reports or 4 MB; the oldest go first). **Past reports on this device** lists them for downloading again.

If `BUG_REPORT_EMAIL` in `src/ui/config.js` is set, the dialog also shows an **Email this report** link addressed to it, with the id in the subject and body and the name of the file to attach. While it is empty (as in the public repository) no email link is shown. The file is never sent automatically; there is no server.

No personal data goes in beyond what the tester types. The report holds the game position, the recent actions and refusals, and the browser's own facts (user agent, viewport, URL).

## How the developer reads and replays one

Drop the file in `bug-reports/` (git-ignored), then:

```
node tools/replay-bug-report.mjs bug-reports/<file>.json
```

It checks the schema, rebuilds the state **both ways** (deserialise the stored state; replay config + actions) and compares them by `hashState` (a disagreement is itself a finding, exit code 3). Then it prints the reporter's words, the pending decision, the legal actions, and the block reasons **recomputed now** by the current engine, with a comparison against the reasons stored in the report: a difference means the engine has changed since the report was made. It also flags a control that the UI showed as disabled while the engine said the action was legal.

Options: `--action='<json>'` asks the block reason for one specific action (for example `--action='{"type":"claimRoute","route":"DEN-KCY","from":"DEN"}'`); `--type=claimRoute` shows only that type; `--all` lists every blocked action. A truncated, wrong-schema or damaged file exits 2 with a plain sentence.

To get the position into the browser, use the test hook: with `?test=1` the page exposes `window.__cr.loadState(text, seatKinds)`; `JSON.stringify(report.gameState)` is the text.

## Closing the loop

When a report produces a fix, **quote the report id in the fix's code comment and add a regression check in the same commit**: an assertion in `tests/` that fails on the old behaviour. The id ties the code, the test and the file together.

```js
// crbug-20261011-143015-k3x9: Pony Express card 14 was offered while ...
```

## Analytics

`src/ui/analytics.js` has a `track(event, params)` that does nothing, makes no request and adds no script while `GA4_MEASUREMENT_ID` in `src/ui/config.js` is empty. When the designer fills it in, the first call adds the gtag script once. Events are wired at the page's choke points: `game_start`, `action_taken` (type only, sampled so a bot game does not send thousands), `illegal_action_attempted` (action type and a short reason category), `bot_incident`, `game_end`, `bug_report_opened`, `bug_report_downloaded`. Only numbers, booleans and short fixed values are sent: no names, no seed, no free text.

## Tests

- `tests/bug-report.test.mjs` (in `npm test`): the capture and replay tool, headless.
- `tests/ui-smoke.mjs` sections 19a to 19g (`npm run test:ui`): the button on every screen, the dialog, the downloaded file, the frozen snapshot, the archive, no network request with empty config, the `mailto:` and `track()` with a test-only config override (`?test=1&cfg_email=...&cfg_ga=...&cfg_build=...`), and the button's position at three viewport sizes.
