# Still needed: placeholders to replace

In order of how much the game would gain: the first rows are what a player sees, or would notice, first. The size is what to make the picture at (or larger, then scale down).

| # | id | file | size (px) | what it should show | why it matters now | where it is used |
|---|---|---|---|---|---|---|
| 1 | `ui-hero` | `ui/ui-hero.png` | 1600 x 700 | A wide 1869 transcontinental railroad scene for the top of the landing page: two locomotives meeting at the golden spike, or a prairie with a train, in the same illustrated style as the districts. Leave the left third calm so the title can sit on it. **Note:** Art list: "Box Cover Art" is the closest, not complete. No cover art in the PSDs; illustration-train-engine or the district scenes could be cropped as a stopgap. | The landing page's top picture. Until it exists the page makes do with the district illustrations. | Landing page header. |
| 2 | `map-backdrop` | `ui/map-backdrop.png` | 1500 x 1200 | A 1869 style map of the western and central United States, 5:4 landscape, with terrain washes (plains, forest, rivers, mountains) but no cities, routes or labels. The UI draws the 25 cities and 47 routes from the route-map JSON. **Note:** Checked Gameboard-v1.psd: its 'map' group is 260 plain grey 260 px squares and the background layer is blank white, so there is no map art. | Would sit behind the route map, the largest area of the game screen, which is plain parchment today. Not wired in yet: the map renderer needs one line to show it. | Behind the route map (R11). The printed map is 500 x 400 mm. |
| 3 | `ui-logo` | `ui/ui-logo.png` | 640 x 160 | The "Continental Rails" wordmark, 4:1, transparent background, readable on a dark or a light page. 1869 poster lettering with a rail line underneath. **Note:** The title may change; keep the file name. | The title lettering on the landing page and in the header. Until it exists the title is plain text. | Landing page and header. |
| 4 | `train-engine` | `pieces/train-engine.png` | 640 x 260 | Side view of the locomotive that forms the engine part of the player board (it carries the Foreman, four house tracks and the telegraph row). Neutral greys so the UI can tint it in the player colour. **Note:** Tintable per player colour (one greyscale image). Checked every PSD: only a full-colour scene with a baked-in background exists (Art-v1.psd 'train_engine', exported as illustration-train-engine); no transparent side view. | The locomotive of every player board (tinted per player). Not wired in yet: the board draws its engine in code. | Player board header (R8.1). |
| 5 | `track-ground` | `pieces/track-ground.png` | 300 x 96 | One Ground track tile, long and thin (25 x 8 mm on the board, so 25:8): green (tree silhouette on green disc in the art list), with rails along its length. **Note:** Checked Example Terrain costs.psd: it holds only terrain icons and coloured circle segments, no track tile art. Terrain badges terrain-ground, terrain-tunnel and terrain-bridge exist as real icons and can be used on it. | The three track tiles are drawn in code today (a hatched picture is never shown); art would make the built stockpile read at a glance. | Built tiles in storage and laid slots on routes (Ground) (R1.12, R11). |
| 6 | `track-tunnel` | `pieces/track-tunnel.png` | 300 x 96 | One Tunnel track tile, long and thin (25 x 8 mm on the board, so 25:8): black or dark grey (mountain peak on black disc in the art list), with rails along its length. **Note:** Checked Example Terrain costs.psd: no track tile art. Terrain badges terrain-ground, terrain-tunnel and terrain-bridge exist as real icons and can be used on it. | As track-ground. | Built tiles in storage and laid slots on routes (Tunnel) (R1.12, R11). |
| 7 | `track-bridge` | `pieces/track-bridge.png` | 300 x 96 | One Bridge track tile, long and thin (25 x 8 mm on the board, so 25:8): blue (wave pattern on blue disc in the art list), with rails along its length. **Note:** Checked Example Terrain costs.psd: no track tile art. Terrain badges terrain-ground, terrain-tunnel and terrain-bridge exist as real icons and can be used on it. | As track-ground. | Built tiles in storage and laid slots on routes (Bridge) (R1.12, R11). |
| 8 | `piece-worker` | `pieces/piece-worker.png` | 128 x 128 | Worker: a railroad worker shape (meeple), front view. **Note:** Tintable per player colour: one greyscale image, the UI multiplies it by the player colour, so paint it in neutral greys with white highlights on a transparent background. Art list: "Worker Meeple", not complete. | Workers on the action grid, drawn in code today. | Workers on the action grid and in supplies (R1.7). |
| 9 | `piece-house` | `pieces/piece-house.png` | 128 x 128 | House: a small house block as seen on the player board; this is the production multiplier and never a building on the map. **Note:** Tintable per player colour: one greyscale image, the UI multiplies it by the player colour, so paint it in neutral greys with white highlights on a transparent background. Keep it clearly different from the railway station. | Houses on the player boards, drawn in code today. | Houses on the four house tracks of the player board (R1.1). |
| 10 | `piece-railhead` | `pieces/piece-railhead.png` | 128 x 128 | Railhead: a small locomotive or rail-end marker. **Note:** Tintable per player colour: one greyscale image, the UI multiplies it by the player colour, so paint it in neutral greys with white highlights on a transparent background. | Railheads on the map, drawn in code today. | Railheads on the map (R1.20); two per player. |
| 11 | `token-pony-express` | `pieces/token-pony-express.png` | 160 x 160 | A round token with a horse and rider in motion. The same picture serves all 17; the UI writes the city name. **Note:** Art list: "Pony Express" icon, not complete. | Pony Express tokens, drawn in code today. | Pony Express tokens on inland cities, in player hands and as a spendable resource (R18). |
| 12 | `ui-favicon` | `ui/ui-favicon.png` | 64 x 64 | A bold, simple mark that still reads at 16 px: a locomotive front or a rail ladder in gold on dark. **Note:** At 64 x 64 the placeholder text is tiny; that is expected. | The browser tab icon; a lettered stand-in is used today. | Browser tab icon. |
| 13 | `specialist-foreman` | `pieces/specialist-foreman.png` | 256 x 256 | The Foreman: a foreman in a flat cap and waistcoat, as printed on the engine. **Note:** No foreman art exists in any PSD. specialist-generic-figure (Icons-v1.psd 'specialist') could stand in if the designer agrees. | Replaces a labelled placeholder picture. | The Foreman printed on the engine (R1.16, R9). |
| 14 | `train-specialist-carriage` | `pieces/train-specialist-carriage.png` | 480 x 260 | Side view of a passenger or office carriage with two specialist bays and an upgrade plate. The UI lays the slots over it. **Note:** Checked every PSD: only a mock-up with scenery and a baked-in figure exists (Specialists - carriage 1.psd 'Layer 1', exported as illustration-specialist-carriage). | Replaces a labelled placeholder picture. | Specialist carriages, levels 1 to 3 (R8.2). The level number is drawn by the UI. |
| 15 | `player-board-backdrop` | `ui/player-board-backdrop.png` | 1600 x 900 | The player board background: a train cross-section with an engine area at the left, a long carriage track along the middle, and room for the four house tracks (Wood, Coins, Iron, Gunpowder) and a 7-slot telegraph row, left empty so the UI can lay slots over them. **Note:** Art list: "Player Board Background", not complete. No PSD holds one. The UI draws the house tracks and slots itself, so keep the picture quiet. | Replaces a labelled placeholder picture. | Player panel behind the train (R2.3). |
| 16 | `piece-score-marker` | `pieces/piece-score-marker.png` | 128 x 128 | Score marker: a round disc or small trophy token. **Note:** Tintable per player colour: one greyscale image, the UI multiplies it by the player colour, so paint it in neutral greys with white highlights on a transparent background. | Replaces a labelled placeholder picture. | Score track marker (R2.2). |
| 17 | `piece-senator` | `pieces/piece-senator.png` | 128 x 128 | A senator token: a top-hatted figure or bust, in full colour (not player coloured). **Note:** Art list: "Senator Token", not complete. Not tinted. | Replaces a labelled placeholder picture. | Senators on the Congress strip (R10.2). Belongs to nobody. |
| 18 | `token-start-player` | `pieces/token-start-player.png` | 128 x 128 | A conductor's whistle or lantern. **Note:** Art list: "First Player Marker", not complete. | Replaces a labelled placeholder picture. | Start player marker (R2.1). |
| 19 | `frame-pony-a` | `cards/frame-pony-a.png` | 400 x 563 | The empty card frame the UI draws text on: a window at the top for the card picture, a title banner under it, a parchment text area, and room for a cost badge in a corner. Rank A (cost 2 tokens): give it the rank A colour so it matches the back of that rank. **Note:** The 38 cards are drawn as text on three frames, not 38 images. | Replaces a labelled placeholder picture. | All rank A Pony Express cards: picture, name, cost and text are drawn on it (R18.7). |
| 20 | `frame-pony-b` | `cards/frame-pony-b.png` | 400 x 563 | The empty card frame the UI draws text on: a window at the top for the card picture, a title banner under it, a parchment text area, and room for a cost badge in a corner. Rank B (cost 3 tokens): give it the rank B colour so it matches the back of that rank. **Note:** The 38 cards are drawn as text on three frames, not 38 images. | Replaces a labelled placeholder picture. | All rank B Pony Express cards: picture, name, cost and text are drawn on it (R18.7). |
| 21 | `frame-pony-c` | `cards/frame-pony-c.png` | 400 x 563 | The empty card frame the UI draws text on: a window at the top for the card picture, a title banner under it, a parchment text area, and room for a cost badge in a corner. Rank C (cost 5 tokens): give it the rank C colour so it matches the back of that rank. **Note:** The 38 cards are drawn as text on three frames, not 38 images. | Replaces a labelled placeholder picture. | All rank C Pony Express cards: picture, name, cost and text are drawn on it (R18.7). |
| 22 | `frame-goal` | `cards/frame-goal.png` | 400 x 563 | The empty card frame the UI draws text on: a window at the top for the card picture, a title banner under it, a parchment text area, and room for a cost badge in a corner. Add a 10 VP / 5 VP placement strip. **Note:** Not asked for in the brief, but the goal pictures carry no text so the UI needs a frame. | Replaces a labelled placeholder picture. | Text for the 12 end-game goal cards (R16.5). |
| 23 | `frame-agenda` | `cards/frame-agenda.png` | 400 x 563 | The empty card frame the UI draws text on: a window at the top for the card picture, a title banner under it, a parchment text area, and room for a cost badge in a corner.  **Note:** As frame-goal: the pictures carry no text. | Replaces a labelled placeholder picture. | Text for the 20 Legislative Agenda cards (R17.3). |
| 24 | `card-scoring-ground` | `cards/card-scoring-ground.png` | 400 x 563 | The Ground scoring card: a card face with the Ground terrain motif and a table of VP by route length. **Note:** Optional component: only needed if that variant is shipped. | Replaces a labelled placeholder picture. | Scoring cards, used only if variant scoringCard is not none (R2.1, R11.9). |
| 25 | `card-scoring-tunnel` | `cards/card-scoring-tunnel.png` | 400 x 563 | The Tunnel scoring card: a card face with the Tunnel terrain motif and a table of VP by route length. **Note:** Optional component: only needed if that variant is shipped. | Replaces a labelled placeholder picture. | Scoring cards, used only if variant scoringCard is not none (R2.1, R11.9). |
| 26 | `card-scoring-bridge` | `cards/card-scoring-bridge.png` | 400 x 563 | The Bridge scoring card: a card face with the Bridge terrain motif and a table of VP by route length. **Note:** Optional component: only needed if that variant is shipped. | Replaces a labelled placeholder picture. | Scoring cards, used only if variant scoringCard is not none (R2.1, R11.9). |

Generated from `art-manifest.json` by `tools/build-art-manifest.py` on 11/10/2026. Do not edit this file by hand; edit the JSON and rebuild.

184 images: 158 real, 26 placeholders, 43 marked unused. Folder size 4.87 MB (limit 6 MB, 200 KB per file).

## How to replace a placeholder

1. Make the picture at the size in the table (or larger, then scale down). Keep it under 200 KB: PNG for anything with transparency, JPEG or WebP for pictures.
2. Save it over the placeholder file, with the same name, in the same folder. Never rename a file or change an id: the game looks images up by id.
3. Run `python tools/build-art-manifest.py --promote <id> --source "where it came from"`. That reads the real pixel size, marks the entry real and rebuilds this file.
4. Run `python tools/build-art-manifest.py` with no arguments to check the folder.

Things worth knowing:

- **Player pieces are tinted by the game.** Entries whose note starts "Tintable" (`piece-worker`, `piece-house`, `piece-railway-station`, `piece-telegraph-station`, `piece-railhead`, `piece-score-marker`, `train-engine`) are one greyscale image on a transparent background. The UI multiplies it by the player colour, so paint neutral greys with white highlights, never a player colour.
- **The metal is called Iron.** The ids are `resource-iron` and the like; no picture may say Steel.
- **Terminology.** A house is a production multiplier on the player board only. Buildings on the map are railway stations and telegraph stations. Keep the pictures consistent with that: `piece-house` must not look like `piece-railway-station`.
- **Cards are drawn, not painted.** The 12 goal, 20 Legislative Agenda and 38 Pony Express card pictures hold no text; the UI draws names and rules on the `frame-*` images. Milestone tiles (10) are drawn on one frame.
- **Placeholder look.** Yellow diagonal hatch (grey for tintable pieces), the word PLACEHOLDER, the component name and its pixel size. `python tools/make-placeholder.py --help` makes more.

## Real art

| id | file | size (px) | file size | source |
|---|---|---|---|---|
| `district-gather-gunpowder` | `districts/district-gather-gunpowder.jpg` | 600 x 335 | 83 KB | `TTS/action_area.png` |
| `district-lobby-congress` | `districts/district-lobby-congress.jpg` | 600 x 335 | 83 KB | `TTS/action_area.png` |
| `district-gather-iron` | `districts/district-gather-iron.jpg` | 600 x 335 | 66 KB | `TTS/action_area.png` |
| `district-ground-tracks` | `districts/district-ground-tracks.jpg` | 600 x 335 | 64 KB | `TTS/action_area.png` |
| `district-lay-tracks` | `districts/district-lay-tracks.jpg` | 600 x 335 | 72 KB | `TTS/action_area.png` |
| `district-bridge-tracks` | `districts/district-bridge-tracks.jpg` | 600 x 335 | 81 KB | `TTS/action_area.png` |
| `district-gather-wood` | `districts/district-gather-wood.jpg` | 600 x 335 | 73 KB | `TTS/action_area.png` |
| `district-tunnel-tracks` | `districts/district-tunnel-tracks.jpg` | 600 x 335 | 68 KB | `TTS/action_area.png` |
| `district-gather-coins` | `districts/district-gather-coins.jpg` | 600 x 335 | 78 KB | `TTS/action_area.png` |
| `bonus-carriage-upgrade` | `icons/bonus-carriage-upgrade.jpg` | 300 x 110 | 15 KB | `TTS/action_area.png` |
| `bonus-hire-specialist` | `icons/bonus-hire-specialist.jpg` | 300 x 110 | 15 KB | `TTS/action_area.png` |
| `bonus-buy-hat` | `icons/bonus-buy-hat.jpg` | 300 x 110 | 12 KB | `TTS/action_area.png` |
| `bonus-add-carriage` | `icons/bonus-add-carriage.jpg` | 300 x 110 | 14 KB | `TTS/action_area.png` |
| `footprint-marker` | `icons/footprint-marker.png` | 128 x 128 | 19 KB | `TTS/action_area.png` |
| `congress-capitol` | `congress/congress-capitol.jpg` | 900 x 487 | 78 KB | `TTS/lobby_congress.png` |
| `congress-cost-c1` | `congress/congress-cost-c1.jpg` | 128 x 128 | 8 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c1` | `congress/congress-benefit-c1.jpg` | 128 x 128 | 5 KB | `TTS/lobby_congress.png` |
| `congress-cost-c2` | `congress/congress-cost-c2.jpg` | 128 x 128 | 8 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c2` | `congress/congress-benefit-c2.jpg` | 128 x 128 | 4 KB | `TTS/lobby_congress.png` |
| `congress-cost-c3` | `congress/congress-cost-c3.jpg` | 128 x 128 | 7 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c3` | `congress/congress-benefit-c3.jpg` | 128 x 128 | 6 KB | `TTS/lobby_congress.png` |
| `congress-cost-c4` | `congress/congress-cost-c4.jpg` | 128 x 128 | 7 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c4` | `congress/congress-benefit-c4.jpg` | 128 x 128 | 4 KB | `TTS/lobby_congress.png` |
| `congress-cost-c5` | `congress/congress-cost-c5.jpg` | 128 x 128 | 9 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c5` | `congress/congress-benefit-c5.jpg` | 128 x 128 | 4 KB | `TTS/lobby_congress.png` |
| `congress-cost-c6` | `congress/congress-cost-c6.jpg` | 128 x 128 | 9 KB | `TTS/lobby_congress.png` |
| `congress-benefit-c6` | `congress/congress-benefit-c6.jpg` | 128 x 128 | 3 KB | `TTS/lobby_congress.png` |
| `congress-cost-reset` | `congress/congress-cost-reset.jpg` | 128 x 128 | 8 KB | `TTS/lobby_congress.png` |
| `congress-benefit-reset` | `congress/congress-benefit-reset.jpg` | 128 x 128 | 3 KB | `TTS/lobby_congress.png` |
| `resource-coin` | `icons/resource-coin.png` | 128 x 128 | 34 KB | `TTS/lobby_congress.png` |
| `resource-wood` | `icons/resource-wood.png` | 128 x 128 | 20 KB | `TTS/lobby_congress.png` |
| `resource-iron` | `icons/resource-iron.png` | 128 x 128 | 15 KB | `TTS/lobby_congress.png` |
| `resource-gunpowder` | `icons/resource-gunpowder.png` | 128 x 128 | 22 KB | `TTS/lobby_congress.png` |
| `token-cowboy-hat` | `icons/token-cowboy-hat.png` | 128 x 128 | 12 KB | `TTS/lobby_congress.png` |
| `icon-carriage` | `icons/icon-carriage.png` | 128 x 128 | 15 KB | `TTS/lobby_congress.png` |
| `icon-track` | `icons/icon-track.png` | 128 x 128 | 6 KB | `TTS/lobby_congress.png` |
| `icon-building` | `icons/icon-building.png` | 128 x 128 | 15 KB | `TTS/lobby_congress.png` |
| `icon-reset` | `icons/icon-reset.png` | 128 x 128 | 7 KB | `TTS/lobby_congress.png` |
| `terrain-bridge` | `icons/terrain-bridge.png` | 128 x 128 | 5 KB | `images/bridge.png` |
| `terrain-tunnel` | `icons/terrain-tunnel.png` | 128 x 128 | 14 KB | `images/tunnel.png` |
| `terrain-ground` | `icons/terrain-ground.png` | 128 x 128 | 5 KB | `images/grass (1).png` |
| `terrain-hills` | `icons/terrain-hills.png` | 128 x 128 | 8 KB | `images/hills.png` |
| `terrain-mountain` | `icons/terrain-mountain.png` | 128 x 128 | 11 KB | `images/mountain.png` |
| `terrain-canyon` | `icons/terrain-canyon.png` | 128 x 128 | 12 KB | `images/canyon.png` |
| `terrain-grand-canyon` | `icons/terrain-grand-canyon.png` | 128 x 128 | 18 KB | `images/grand-canyon.png` |
| `icon-goal` | `icons/icon-goal.png` | 128 x 128 | 7 KB | `images/goal.png` |
| `card-goal-01-most-railway-stations` | `cards/goal-01-most-railway-stations.webp` | 400 x 563 | 54 KB | `images/goal_01_railways.png` |
| `card-goal-02-continental-span` | `cards/goal-02-continental-span.webp` | 400 x 562 | 57 KB | `images/goal_02_north_south.png` |
| `card-goal-03-strategic-positions` | `cards/goal-03-strategic-positions.webp` | 400 x 563 | 46 KB | `images/goal_03_most_junctions.png` |
| `card-goal-04-specialist-focus` | `cards/goal-04-specialist-focus.webp` | 400 x 563 | 51 KB | `images/goal_04_most_specialists_of_a_type.png` |
| `card-goal-05-longest-train` | `cards/goal-05-longest-train.webp` | 400 x 563 | 35 KB | `images/goal_05_longest_train.png` |
| `card-goal-06-upgrade-mastery` | `cards/goal-06-upgrade-mastery.webp` | 400 x 563 | 35 KB | `images/goal_06_most_upgrades.png` |
| `card-goal-07-diversified-company` | `cards/goal-07-diversified-company.webp` | 400 x 563 | 34 KB | `images/goal_07_specialist_sets.png` |
| `card-goal-08-specialist-army` | `cards/goal-08-specialist-army.webp` | 400 x 563 | 47 KB | `images/goal_08_most_specialists.png` |
| `card-goal-09-opportunistic-builder` | `cards/goal-09-opportunistic-builder.webp` | 400 x 563 | 34 KB | `images/goal_09_most_shared.png` |
| `card-goal-10-economic-efficiency` | `cards/goal-10-economic-efficiency.webp` | 400 x 563 | 19 KB | `images/goal_10_empty_shelves.png` |
| `card-goal-11-most-telegraph-stations` | `cards/goal-11-most-telegraph-stations.webp` | 400 x 563 | 50 KB | `images/goal_11_most_telegraphs.png` |
| `card-goal-12-city-presence` | `cards/goal-12-city-presence.webp` | 400 x 563 | 58 KB | `images/goal_12_most_cities.png` |
| `card-agenda-01-mountain-railway-initiative` | `cards/agenda-01-mountain-railway-initiative.webp` | 400 x 563 | 22 KB | `images/law_1_tunnel_vp.png` |
| `card-agenda-02-bridge-construction-program` | `cards/agenda-02-bridge-construction-program.webp` | 400 x 563 | 45 KB | `images/law_2_bridge_vp.png` |
| `card-agenda-03-heartland-expansion-act` | `cards/agenda-03-heartland-expansion-act.webp` | 400 x 563 | 20 KB | `images/law_3_ground_vp.png` |
| `card-agenda-04-transcontinental-priority` | `cards/agenda-04-transcontinental-priority.webp` | 400 x 563 | 44 KB | `images/law_4_completion_bonus.png` |
| `card-agenda-05-infrastructure-diversity` | `cards/agenda-05-infrastructure-diversity.webp` | 400 x 563 | 37 KB | `images/law_5_diversity_bonus.png` |
| `card-agenda-06-rapid-construction-bonus` | `cards/agenda-06-rapid-construction-bonus.webp` | 400 x 563 | 50 KB | `images/law_6_long_track.png` |
| `card-agenda-07-station-network` | `cards/agenda-07-station-network.webp` | 400 x 563 | 37 KB | `images/law_7_shared_city.png` |
| `card-agenda-08-urban-development` | `cards/agenda-08-urban-development.webp` | 400 x 563 | 57 KB | `images/law_8_full_city.png` |
| `card-agenda-09-strategic-outposts` | `cards/agenda-09-strategic-outposts.webp` | 400 x 563 | 27 KB | `images/law_9_first_connection_bonus.png` |
| `card-agenda-10-expansion-leader` | `cards/agenda-10-expansion-leader.webp` | 400 x 563 | 29 KB | `images/law_10_5_buildings.png` |
| `card-agenda-11-iron-subsidy` | `cards/agenda-11-iron-subsidy.webp` | 400 x 563 | 35 KB | `images/law_11_cheap_iron.png` |
| `card-agenda-12-lumber-grant` | `cards/agenda-12-lumber-grant.webp` | 400 x 563 | 35 KB | `images/law_12_cheap_wood.png` |
| `card-agenda-13-mining-incentives` | `cards/agenda-13-mining-incentives.webp` | 400 x 563 | 36 KB | `images/law_13_cheap_gunpowder.png` |
| `card-agenda-14-federal-treasury` | `cards/agenda-14-federal-treasury.webp` | 400 x 563 | 46 KB | `images/law_14_cheap_coins.png` |
| `card-agenda-15-telegraph-expansion-act` | `cards/agenda-15-telegraph-expansion-act.webp` | 400 x 563 | 38 KB | `images/law_15_telegraph_vp.png` |
| `card-agenda-16-railway-network-bonus` | `cards/agenda-16-railway-network-bonus.webp` | 400 x 563 | 48 KB | `images/law_16_railway_vp.png` |
| `card-agenda-17-production-scaling` | `cards/agenda-17-production-scaling.webp` | 400 x 563 | 31 KB | `images/law_17_house_resource.png` |
| `card-agenda-18-specialist-recruitment-drive` | `cards/agenda-18-specialist-recruitment-drive.webp` | 400 x 563 | 34 KB | `images/law_18_recruitment_bonus.png` |
| `card-agenda-19-industrial-expansion` | `cards/agenda-19-industrial-expansion.webp` | 400 x 563 | 40 KB | `images/law_19_carriage_bonus.png` |
| `card-agenda-20-congressional-support` | `cards/agenda-20-congressional-support.webp` | 400 x 563 | 38 KB | `images/law_20_congress_bonus.png` |
| `card-pony-01-fresh-horses` | `cards/pony-01-fresh-horses.webp` | 400 x 563 | 33 KB | `images/pony_01_get_3_resources.png` |
| `card-pony-02-saddle-bags` | `cards/pony-02-saddle-bags.webp` | 400 x 563 | 25 KB | `images/pony_02_gain_1_carriage.png` |
| `card-pony-03-swift-passage` | `cards/pony-03-swift-passage.webp` | 400 x 563 | 16 KB | `images/pony_03_move_twice.png` |
| `card-pony-04-frontier-scout` | `cards/pony-04-frontier-scout.webp` | 400 x 563 | 34 KB | `images/pony_04_gain_2_track.png` |
| `card-pony-05-quick-route` | `cards/pony-05-quick-route.webp` | 400 x 563 | 31 KB | `images/pony_05_lay_track.png` |
| `card-pony-06-frontier-recruitment` | `cards/pony-06-frontier-recruitment.webp` | 400 x 563 | 27 KB | `images/pony_06_hire_specialist.png` |
| `card-pony-07-mail-delivery-contract` | `cards/pony-07-mail-delivery-contract.webp` | 400 x 563 | 36 KB | `images/pony_07_5vp.png` |
| `card-pony-08-versatile-rider` | `cards/pony-08-versatile-rider.webp` | 400 x 563 | 36 KB | `images/pony_08_choice.png` |
| `card-pony-09-rapid-expansion` | `cards/pony-09-rapid-expansion.webp` | 400 x 563 | 39 KB | `images/pony_09_carriage_and_specialist.png` |
| `card-pony-10-double-time` | `cards/pony-10-double-time.webp` | 400 x 563 | 33 KB | `images/pony_10_run_train.png` |
| `card-pony-11-frontier-trade` | `cards/pony-11-frontier-trade.webp` | 400 x 563 | 36 KB | `images/pony_11_swap_resources.png` |
| `card-pony-12-frontier-legend` | `cards/pony-12-frontier-legend.webp` | 400 x 563 | 27 KB | `images/pony_12_vp_for_cities.png` |
| `card-pony-13-congressional-courier` | `cards/pony-13-congressional-courier.webp` | 400 x 563 | 33 KB | `images/pony_13_2_free_congress.png` |
| `card-pony-14-overland-route` | `cards/pony-14-overland-route.webp` | 400 x 563 | 33 KB | `images/pony_14_move_for_free.png` |
| `card-pony-15-pioneer-s-knowledge` | `cards/pony-15-pioneer-s-knowledge.webp` | 400 x 563 | 38 KB | `images/pony_15_specialist_twice.png` |
| `card-pony-16-express-mail-contract` | `cards/pony-16-express-mail-contract.webp` | 400 x 563 | 37 KB | `images/pony_16_telegraph_gives_resources.png` |
| `card-pony-17-frontier-expansion` | `cards/pony-17-frontier-expansion.webp` | 400 x 563 | 44 KB | `images/pony_17_2_carriages.png` |
| `card-pony-18-bulk-shipment` | `cards/pony-18-bulk-shipment.webp` | 400 x 563 | 52 KB | `images/pony_18_5_resources.png` |
| `card-pony-19-track-stockpile` | `cards/pony-19-track-stockpile.webp` | 400 x 563 | 43 KB | `images/pony_19_3_tracks.png` |
| `card-pony-20-congressional-favor` | `cards/pony-20-congressional-favor.webp` | 400 x 563 | 24 KB | `images/pony_20_cheap_financier.png` |
| `card-pony-21-efficient-operations` | `cards/pony-21-efficient-operations.webp` | 400 x 563 | 51 KB | `images/pony_21_extra_resource.png` |
| `card-pony-22-double-time` | `cards/pony-22-double-time.webp` | 400 x 563 | 30 KB | `images/pony_22_activate_train.png` |
| `card-pony-23-versatile-rider` | `cards/pony-23-versatile-rider.webp` | 400 x 563 | 20 KB | `images/pony_23_choice.png` |
| `card-pony-24-congressional-courier` | `cards/pony-24-congressional-courier.webp` | 400 x 563 | 36 KB | `images/pony_24_2_free_congress.png` |
| `card-pony-25-transcontinental-express` | `cards/pony-25-transcontinental-express.webp` | 400 x 563 | 36 KB | `images/pony_25_vp_for_end.png` |
| `card-pony-26-master-network` | `cards/pony-26-master-network.webp` | 400 x 563 | 35 KB | `images/pony_26_more_for_stations.png` |
| `card-pony-27-experienced-crew` | `cards/pony-27-experienced-crew.webp` | 400 x 563 | 34 KB | `images/pony_27_hire_2_specialists.png` |
| `card-pony-28-frontier-mastery` | `cards/pony-28-frontier-mastery.webp` | 400 x 563 | 29 KB | `images/pony_28_free_bonus_action.png` |
| `card-pony-29-rails-and-riders` | `cards/pony-29-rails-and-riders.webp` | 400 x 563 | 31 KB | `images/pony_29_first_connect_bonus.png` |
| `card-pony-30-political-influence` | `cards/pony-30-political-influence.webp` | 400 x 563 | 35 KB | `images/pony_30_senate_reset_bonus.png` |
| `card-pony-31-territory-baron` | `cards/pony-31-territory-baron.webp` | 400 x 563 | 27 KB | `images/pony_31_dual_city_bonus.png` |
| `card-pony-32-master-engineer` | `cards/pony-32-master-engineer.webp` | 400 x 563 | 42 KB | `images/pony_32_wild_foreman.png` |
| `card-pony-33-specialist-mastery` | `cards/pony-33-specialist-mastery.webp` | 400 x 563 | 39 KB | `images/pony_33_double_production.png` |
| `card-pony-34-telegraph-tycoon` | `cards/pony-34-telegraph-tycoon.webp` | 400 x 563 | 28 KB | `images/pony_34_double_telegraph.png` |
| `card-pony-35-track-master` | `cards/pony-35-track-master.webp` | 400 x 563 | 30 KB | `images/pony_35_new_city_track_bonus.png` |
| `card-pony-36-production-mastery` | `cards/pony-36-production-mastery.webp` | 400 x 563 | 41 KB | `images/pony_36_extra_resources.png` |
| `card-pony-37-congressional-control` | `cards/pony-37-congressional-control.webp` | 400 x 596 | 39 KB | `images/pony_37_senate_1_free.png` |
| `card-pony-38-pony-express-legacy` | `cards/pony-38-pony-express-legacy.webp` | 400 x 563 | 27 KB | `images/pony_38_vp_for_express_tokens.png` |
| `card-back-goal` | `cards/back-goal.webp` | 400 x 563 | 42 KB | `images/goal_back.png` |
| `card-back-agenda` | `cards/back-agenda.webp` | 400 x 563 | 27 KB | `images/law_back.png` |
| `card-back-pony-a` | `cards/back-pony-a.webp` | 400 x 563 | 15 KB | `images/pony_back_1.png` |
| `card-back-pony-b` | `cards/back-pony-b.webp` | 400 x 563 | 28 KB | `images/pony_back_2.png` |
| `card-back-pony-c` | `cards/back-pony-c.webp` | 400 x 563 | 17 KB | `images/pony_back_3.png` |
| `specialist-crew` | `pieces/specialist-crew.webp` | 256 x 256 | 10 KB | `Pieces/Icons-v1.psd :: pixel layer 'specialist-crew'` |
| `specialist-miner` | `pieces/specialist-miner.webp` | 256 x 256 | 8 KB | `Pieces/Icons-v1.psd :: pixel layer 'specialist-miner'` |
| `specialist-engineer` | `pieces/specialist-engineer.webp` | 256 x 256 | 9 KB | `Pieces/Icons-v1.psd :: pixel layer 'specialist-engineer'` |
| `specialist-financier` | `pieces/specialist-financier.webp` | 256 x 256 | 9 KB | `Pieces/Icons-v1.psd :: pixel layer 'specialist-financier'` |
| `train-storage-carriage` | `pieces/train-storage-carriage.webp` | 480 x 230 | 22 KB | `Pieces/Icons-v1.psd :: smart object layer 'carriage'` |
| `piece-railway-station` | `pieces/piece-railway-station.png` | 128 x 83 | 9 KB | `Pieces/Icons-v1.psd :: smart object layer 'icon_railway_station'` |
| `piece-telegraph-station` | `pieces/piece-telegraph-station.png` | 128 x 126 | 5 KB | `Pieces/Icons-v1.psd :: smart object layer 'icon_telegraph_station'` |
| `frame-milestone` | `cards/frame-milestone.webp` | 300 x 247 | 26 KB | `Pieces/Icons-v1.psd :: smart object layer 'square_frame'` |
| `upgrade-u1-vp` | `pieces/upgrade-u1-vp.webp` | 512 x 164 | 24 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp2'` |
| `upgrade-u1-wood` | `pieces/upgrade-u1-wood.webp` | 512 x 183 | 28 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'upgrade_wood'` |
| `upgrade-u1-iron` | `pieces/upgrade-u1-iron.webp` | 512 x 213 | 27 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'upgrade_iron'` |
| `upgrade-u1-coin` | `pieces/upgrade-u1-coin.webp` | 512 x 266 | 36 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'upgrade_coins'` |
| `upgrade-u1-gunpowder` | `pieces/upgrade-u1-gunpowder.webp` | 512 x 266 | 31 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'upgrade_gunpowder'` |
| `upgrade-u1-hat` | `pieces/upgrade-u1-hat.webp` | 512 x 241 | 34 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_cowboy_1'` |
| `upgrade-u2-vp` | `pieces/upgrade-u2-vp.webp` | 512 x 148 | 19 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp3'` |
| `upgrade-u2-bridge` | `pieces/upgrade-u2-bridge.webp` | 512 x 174 | 28 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp_bridge'` |
| `upgrade-u2-tunnel` | `pieces/upgrade-u2-tunnel.webp` | 512 x 208 | 22 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp_tunnel'` |
| `upgrade-u2-ground` | `pieces/upgrade-u2-ground.webp` | 512 x 163 | 30 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp_ground'` |
| `upgrade-u2-hat` | `pieces/upgrade-u2-hat.webp` | 512 x 241 | 41 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_cowboy_2'` |
| `upgrade-u3-vp` | `pieces/upgrade-u3-vp.webp` | 512 x 172 | 29 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_vp4'` |
| `upgrade-u3-bridge` | `pieces/upgrade-u3-bridge.webp` | 512 x 156 | 26 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_free_bridge'` |
| `upgrade-u3-tunnel` | `pieces/upgrade-u3-tunnel.webp` | 512 x 214 | 29 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_free_tunnrl'` |
| `upgrade-u3-ground` | `pieces/upgrade-u3-ground.webp` | 512 x 163 | 31 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_free_ground'` |
| `upgrade-u3-hat` | `pieces/upgrade-u3-hat.webp` | 512 x 156 | 26 KB | `Pieces/Carriage Upgrades v1.psd :: layer 'bonus_cowboy_3'` |
| `specialist-financier-figure` | `pieces/specialist-financier-figure.webp` | 127 x 320 | 13 KB | `Pieces/Icons-v1.psd :: smart object layer 'specialist_financier'` |
| `specialist-crew-figure` | `pieces/specialist-crew-figure.webp` | 197 x 320 | 19 KB | `Pieces/Icons-v1.psd :: smart object layer 'specialist_crew'` |
| `specialist-miner-figure` | `pieces/specialist-miner-figure.webp` | 157 x 320 | 16 KB | `Pieces/Icons-v1.psd :: smart object layer 'specialist_miner'` |
| `specialist-engineer-figure` | `pieces/specialist-engineer-figure.webp` | 205 x 320 | 24 KB | `Pieces/Icons-v1.psd :: smart object layer 'specialist_engineer'` |
| `specialist-generic-figure` | `pieces/specialist-generic-figure.webp` | 240 x 273 | 23 KB | `Pieces/Icons-v1.psd :: smart object layer 'specialist'` |
| `piece-railway-station-colour` | `pieces/piece-railway-station-colour.png` | 128 x 83 | 14 KB | `Pieces/Icons-v1.psd :: smart object layer 'icon_railway_station'` |
| `piece-telegraph-station-colour` | `pieces/piece-telegraph-station-colour.png` | 128 x 126 | 6 KB | `Pieces/Icons-v1.psd :: smart object layer 'icon_telegraph_station'` |
| `ui-banner` | `ui/ui-banner.webp` | 400 x 152 | 9 KB | `Pieces/Icons-v1.psd :: smart object layer 'banner'` |
| `ui-frame-wide` | `ui/ui-frame-wide.webp` | 800 x 210 | 27 KB | `Pieces/Icons-v1.psd :: smart object layer 'frame'` |
| `icon-carriage-upgrade` | `icons/icon-carriage-upgrade.png` | 128 x 111 | 21 KB | `Pieces/Icons-v1.psd :: smart object layer 'carriage_upgrade'` |
| `illustration-city` | `ui/illustration-city.webp` | 256 x 256 | 17 KB | `images/icons v1.psd :: pixel layer 'city'` |
| `illustration-train-engine` | `ui/illustration-train-engine.webp` | 800 x 447 | 70 KB | `Pieces/Art-v1.psd :: smart object layer 'train_engine' (hidden)` |
| `illustration-specialist-carriage` | `ui/illustration-specialist-carriage.webp` | 480 x 480 | 30 KB | `Pieces/Specialists - carriage 1.psd :: pixel layer 'Layer 1'` |

A source is the designer's own working file (a Photoshop file and layer, a sheet or an exported picture). Those files are private and not in this repository; the paths are relative to the designer's art folder. Everything here was copied and resized; the originals are untouched. Crop details and notes for each picture are in `art-manifest.json`.

## Photoshop files

Art was extracted from these files (read only) where it existed; see `docs/psd-extraction-report.md` for what became of every layer. Pony Express Cards v1.psd (1.6 GB) was not opened.

- `Pieces/Carriage Upgrades v1.psd`: the 16 carriage upgrade tiles
- `Pieces/Example Terrain costs.psd`: terrain examples and track tile costs
- `Pieces/Art-v1.psd`: general art: hero, board and box material
- `Pieces/Gameboard-v1.psd`: the game board / map
- `Pieces/Icons-v1.psd`: icons: specialists, buildings, resources, bonus icons, frames
- `Pieces/Pony Express Cards v1.psd`: Pony Express cards
- `Pieces/Specialists - carriage 1.psd`: specialists and carriages
- `images/icons v1.psd`: an earlier icon set (Feb 2024)

## In the folder but not used by any screen

Kept on purpose (art is never deleted); marked `"unused": true` in the manifest.

| id | file | why it is not used |
|---|---|---|
| `bonus-hire-specialist` | `icons/bonus-hire-specialist.jpg` | The Hire Specialist bonus panel is drawn from the specialist pictures; this panel picture is not shown by any screen. |
| `bonus-add-carriage` | `icons/bonus-add-carriage.jpg` | The Add Carriage bonus panel is drawn from the carriage pictures; this panel picture is not shown by any screen. |
| `congress-capitol` | `congress/congress-capitol.jpg` | Not wired in yet: the Congress strip shows the cost and benefit pictures only. |
| `icon-reset` | `icons/icon-reset.png` | Not wired in yet: the Congress reset entry uses its own cost and benefit pictures. |
| `terrain-hills` | `icons/terrain-hills.png` | Reserved for terrain labels on the map; slots are coloured by terrain instead. |
| `terrain-mountain` | `icons/terrain-mountain.png` | Reserved for terrain labels on the map; slots are coloured by terrain instead. |
| `terrain-canyon` | `icons/terrain-canyon.png` | Reserved for terrain labels on the map; slots are coloured by terrain instead. |
| `terrain-grand-canyon` | `icons/terrain-grand-canyon.png` | Reserved for terrain labels on the map; slots are coloured by terrain instead. |
| `icon-goal` | `icons/icon-goal.png` | Not wired in yet: goals are shown by their card pictures. |
| `card-back-goal` | `cards/back-goal.webp` | No screen shows a face-down card yet. |
| `card-back-agenda` | `cards/back-agenda.webp` | No screen shows a face-down card yet. |
| `card-back-pony-a` | `cards/back-pony-a.webp` | No screen shows a face-down card yet. |
| `card-back-pony-b` | `cards/back-pony-b.webp` | No screen shows a face-down card yet. |
| `card-back-pony-c` | `cards/back-pony-c.webp` | No screen shows a face-down card yet. |
| `specialist-foreman` | `pieces/specialist-foreman.png` | No screen asks for it yet: the Foreman is shown as text. |
| `train-engine` | `pieces/train-engine.png` | Not wired in yet: the player board draws the engine in code. When the picture exists the train renderer needs a small change to show it. |
| `train-specialist-carriage` | `pieces/train-specialist-carriage.png` | No screen asks for it yet: carriages are drawn in code. |
| `player-board-backdrop` | `ui/player-board-backdrop.png` | Not wired in yet: the player board is drawn on plain parchment. |
| `map-backdrop` | `ui/map-backdrop.png` | Not wired in yet: the map is drawn as SVG on plain parchment. When the picture exists the map renderer needs one line to show it behind the routes. |
| `piece-score-marker` | `pieces/piece-score-marker.png` | No screen uses a score marker: scores are shown as numbers. |
| `piece-senator` | `pieces/piece-senator.png` | No screen draws a senator piece: the Congress strip shows each entry as open or used. |
| `token-start-player` | `pieces/token-start-player.png` | No screen shows a start-player marker yet. |
| `frame-pony-a` | `cards/frame-pony-a.png` | No screen puts a card on this frame yet: cards are shown as a picture with their text beside it. |
| `frame-pony-b` | `cards/frame-pony-b.png` | No screen puts a card on this frame yet: cards are shown as a picture with their text beside it. |
| `frame-pony-c` | `cards/frame-pony-c.png` | No screen puts a card on this frame yet: cards are shown as a picture with their text beside it. |
| `frame-goal` | `cards/frame-goal.png` | No screen puts a card on this frame yet: cards are shown as a picture with their text beside it. |
| `frame-agenda` | `cards/frame-agenda.png` | No screen puts a card on this frame yet: cards are shown as a picture with their text beside it. |
| `frame-milestone` | `cards/frame-milestone.webp` | No screen uses this frame yet: milestones are drawn in code. |
| `card-scoring-ground` | `cards/card-scoring-ground.png` | No screen shows the scoring card (variant scoringCard) as a picture yet. |
| `card-scoring-tunnel` | `cards/card-scoring-tunnel.png` | No screen shows the scoring card (variant scoringCard) as a picture yet. |
| `card-scoring-bridge` | `cards/card-scoring-bridge.png` | No screen shows the scoring card (variant scoringCard) as a picture yet. |
| `specialist-financier-figure` | `pieces/specialist-financier-figure.webp` | A full-figure alternative to the framed tile; the framed tile is used. |
| `specialist-crew-figure` | `pieces/specialist-crew-figure.webp` | A full-figure alternative to the framed tile; the framed tile is used. |
| `specialist-miner-figure` | `pieces/specialist-miner-figure.webp` | A full-figure alternative to the framed tile; the framed tile is used. |
| `specialist-engineer-figure` | `pieces/specialist-engineer-figure.webp` | A full-figure alternative to the framed tile; the framed tile is used. |
| `specialist-generic-figure` | `pieces/specialist-generic-figure.webp` | A full-figure alternative; not used by any screen. |
| `piece-railway-station-colour` | `pieces/piece-railway-station-colour.png` | A full-colour alternative to the tintable station; the tintable one is used. |
| `piece-telegraph-station-colour` | `pieces/piece-telegraph-station-colour.png` | A full-colour alternative to the tintable station; the tintable one is used. |
| `ui-banner` | `ui/ui-banner.webp` | Not wired in yet. |
| `ui-frame-wide` | `ui/ui-frame-wide.webp` | Not wired in yet. |
| `icon-carriage-upgrade` | `icons/icon-carriage-upgrade.png` | Not wired in yet: upgrade tiles use their own pictures. |
| `illustration-city` | `ui/illustration-city.webp` | Reserved for a city panel on the map; not wired in yet. |
| `illustration-specialist-carriage` | `ui/illustration-specialist-carriage.webp` | A mock-up with a baked-in figure; kept as reference, not used by any screen. |

## Existing art found but not used

- `images/goal_12_msot_cities.png`: byte-for-byte duplicate of goal_12_most_cities.png (misspelt name); the correctly spelt file is used
- `AI-Art/ (ChatGPT, Gemini and DALL-E images)`: concept and generation dumps, not game components; the finished pieces are the harvested ones
- `TTS/action_area.png, TTS/lobby_congress.png (the rest of each sheet)`: only the tiles, panels, marker and cells are used; the empty lower half of the Congress sheet and the blue backing are not
