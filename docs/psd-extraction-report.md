# Art extraction report (11/10/2026)

The designer's Photoshop source files are private and are not in this repository; this report records how the art in `assets/` was taken from them. They were opened read only with `psd-tools` (nothing saved). `Pony Express Cards v1.psd` (1.6 GB) was not opened: every Pony Express picture and token it might hold is either already real (38 card pictures) or not needed. This report is in `docs/` because the asset validator rejects unlisted files in `assets/`.

Result: 24 placeholders replaced, 26 remain, 13 new real entries added (184 entries: 158 real, 26 placeholders). Folder 4.86 MB, no file over 200 KB. Placeholder files that were replaced were removed from `assets/`; extensions changed to `.webp` where a PNG would have been too large.

Source strings in `art-manifest.json` read `<PSD path> :: <layer>`. "Used" below means exported into `assets/`.

## Pieces/Icons-v1.psd (2048 x 2048, 27 layers, 17 used)

| Layer | Became |
|---|---|
| `icon_railway_station` | Used: `piece-railway-station` (greyscale, tintable) and `piece-railway-station-colour` |
| `icon_telegraph_station` | Used: `piece-telegraph-station` (greyscale) and `piece-telegraph-station-colour` |
| `specialist_crew`, `_financier`, `_miner`, `_engineer` (smart objects, full figures) | Used: new `specialist-*-figure` entries; alternatives to the framed tiles |
| `specialist-financier`, `-crew`, `-miner`, `-engineer` (709 px pixel layers, framed tiles) | Used: `specialist-*` (chosen as the finished tiles) |
| `specialist` | Used: new `specialist-generic-figure` (not made as a foreman, so `specialist-foreman` stays a placeholder) |
| `carriage` | Used: `train-storage-carriage` (also what the existing `icon-carriage` is) |
| `carriage_upgrade` | Used: new `icon-carriage-upgrade` |
| `square_frame` | Used: `frame-milestone` (judgement call, see below) |
| `banner` | Used: new `ui-banner` |
| `frame` | Used: new `ui-frame-wide` |
| `resource_coin`, `resource_gunpowder`, `resource_iron`, `resource_wood`, `resource_cowboy_hat` | Not replaced. The existing `resource-*` and `token-cowboy-hat` icons are already clean transparent 128 px art of the same drawings, so they were left. These layers are higher resolution if ever wanted (coin 1265 px, wood 2722 px). |
| `bonus_recruit`, `bonus_add_carriage`, `bonus_carriage_upgrade` | Alternatives: clean transparent versions of the pictures already in the `bonus-*` panels. Not exported; panels are real. |
| `arrow`, `arrow_reset`, `track_any` | Not exported: plain black or white glyphs; `icon-reset` and `icon-track` already exist as real icons. Available. |

## Pieces/Carriage Upgrades v1.psd (2816 x 1536, 25 layers, 16 used)

Each of the 16 upgrade tiles uses one layer. Wide top-down wagons, exported at 512 px long side (not the 256 x 256 in the manifest, which would leave them about 100 px high); width/height in the manifest are the real sizes.

| id | Layer used | Alternatives / rejected |
|---|---|---|
| `upgrade-u1-vp` | `bonus_vp2` | |
| `upgrade-u1-wood` | `upgrade_wood` (layer 8, logs, whole wagon; background made transparent) | `upgrade_wood` layer 3 (logs, cropped wagon); layers 5 and 9 (sawn planks) |
| `upgrade-u1-iron` | `upgrade_iron` (smart object) | `upgrade_iron` pixel layer (white background); `upgrade_iron_no` (rejected) |
| `upgrade-u1-coin` | `upgrade_coins` | |
| `upgrade-u1-gunpowder` | `upgrade_gunpowder` | `upgrade_gunpowder_no` (rejected) |
| `upgrade-u1-hat` | `bonus_cowboy_1` | `bonus_cowboy1` (different wagon shape) |
| `upgrade-u2-vp` | `bonus_vp3` | |
| `upgrade-u2-bridge` | `bonus_vp_bridge` | |
| `upgrade-u2-tunnel` | `bonus_vp_tunnel` | |
| `upgrade-u2-ground` | `bonus_vp_ground` | |
| `upgrade-u2-hat` | `bonus_cowboy_2` | |
| `upgrade-u3-vp` | `bonus_vp4` | unnamed hidden `Layer 19` (golden-spike car with flags; fits "golden spike" wording better but is unnamed) |
| `upgrade-u3-bridge` | `bonus_free_bridge` | |
| `upgrade-u3-tunnel` | `bonus_free_tunnrl` (sic) | |
| `upgrade-u3-ground` | `bonus_free_ground` | unnamed hidden `Layer 23` (wagon interior with track bed) |
| `upgrade-u3-hat` | `bonus_cowboy_3` | |

Layers not used: the three duplicate/alternative wood layers, `upgrade_iron` (pixel), `upgrade_iron_no`, `upgrade_gunpowder_no`, `bonus_cowboy1`, `Layer 19`, `Layer 23` (9 layers; 25 - 16 = 9).

Pairing was by name and by the effect text in the manifest (vp2/3/4 are the 2, 3 and 4 VP engines; `bonus_vp_*` are the per-terrain VP level 2 tiles; `bonus_free_*` are the "gain 1 tile" level 3 tiles).

## Pieces/Specialists - carriage 1.psd (1606 x 1606, 8 layers, 1 used)

| Layer | Became |
|---|---|
| `Layer 1` | Used: new `illustration-specialist-carriage` (mock-up with scenery and a baked-in figure; not usable as `train-specialist-carriage`) |
| `Rectangle 4` x2, `Rectangle 5` x4 | Not components: white placeholder boxes for specialist and roof slots |
| `wood 1` | Not exported: a storage bay strip with a "1" badge (473 x 177); available |

## Pieces/Art-v1.psd (2752 x 1536, 10 layers, 1 used)

| Layer | Became |
|---|---|
| `action_collect_wood`, `_gunpowder`, `_coins`, `_iron`, `action_crew`, `_miner`, `_engineer`, `_financier`, `action_lay_track` | Not exported: the high-resolution illustrations behind the district tiles, which are already real as `district-*`/`congress`. Available at full size. |
| `train_engine` (hidden) | Used: new `illustration-train-engine` (full-colour scene, opaque). It cannot serve `train-engine`, which needs a transparent greyscale side view. |

## Pieces/Gameboard-v1.psd (6544 x 9448, 289 layers including groups, 0 used)

| Layer(s) | Became |
|---|---|
| `Layer 0` (background) | Blank white; not a component |
| `map` group: 260 `map_cell` smart objects in 13 rows, `map_spacers` rectangles | Not components: plain grey 260 px squares, no map art |
| `spacer_action_vertical` / `spacer_action_horizontal` groups (6 hidden layers) | Not components (layout spacers) |
| `square_frame` | Same drawing as the Icons-v1 layer; already used for `frame-milestone` |
| `action_area`, `lobby_congress` | Smart objects holding the same sheets already harvested from `TTS/` |

So the Gameboard file cannot supply `map-backdrop`.

## Pieces/Example Terrain costs.psd (2480 x 3508, 60 layers, 0 used)

Layers are duplicated `canyon`, `hills`, `mountain` icon smart objects (already real as `terrain-*` and `images/icons v1.psd`), coloured circle and half/third/quarter segment shapes (terrain cost diagrams), and the background. None is a track tile or a new component.

## images/icons v1.psd (1500 x 1500, 5 layers, 1 used)

| Layer | Became |
|---|---|
| `canyon`, `hills`, `mountain` (visible) | Already real as `terrain-canyon`, `terrain-hills`, `terrain-mountain`; not touched |
| `mountain` (hidden, outlined variant) | Alternative; not used |
| `city` | Used: new `illustration-city` (256 px frontier town) |

## Decisions where there was a choice

- **Specialist tiles:** framed 709 px tiles chosen over full-figure smart objects (both exported; figures are `specialist-*-figure`).
- **Tintable pieces:** railway and telegraph stations are full colour in the PSD. Greyscale tintable `piece-railway-station` / `piece-telegraph-station` plus full-colour `-colour` entries, both noted. Sizes are 128 px on the long side, so heights are 83 and 126.
- **`frame-milestone`:** `square_frame` is 992 x 816 so the entry is 300 x 247 (not square). It is a stand-in for a card frame; revert if unwanted.
- **Upgrade tiles:** 512 px long side, wide, as above.
- **`train-storage-carriage`:** 480 x 230 (art proportions).

## Placeholders that remain (26)

No PSD holds the art for: `specialist-foreman`, `train-engine` (only a full-colour scene), `train-specialist-carriage` (only a mock-up), `player-board-backdrop`, `map-backdrop`, `track-ground`, `track-tunnel`, `track-bridge`, `piece-worker`, `piece-house`, `piece-railhead`, `piece-score-marker`, `piece-senator`, `token-pony-express`, `token-start-player`, `frame-pony-a`, `frame-pony-b`, `frame-pony-c`, `frame-goal`, `frame-agenda`, `card-scoring-ground`, `card-scoring-tunnel`, `card-scoring-bridge`, `ui-hero`, `ui-favicon`, `ui-logo`.

## Tool changes

`tools/build-art-manifest.py`: the PSD list now names `Icons-v1.psd` (renamed by the designer) and the "Photoshop files" section no longer says the files were not opened. No logic changed.
