#!/usr/bin/env python3
"""Regenerate assets/art-manifest.md from assets/art-manifest.json and check the assets folder.

Usage:
  python tools/build-art-manifest.py
  python tools/build-art-manifest.py --promote ID [--source "where it came from"]

The check fails (exit 1) if:
  - a file listed in the manifest is missing,
  - a file in assets/ is not listed in the manifest (art-manifest.json/.md excepted),
  - any file is over 200 KB, or the whole folder is over 6 MB,
  - an id is duplicated or is not lowercase kebab-case,
  - a listed width/height does not match the image on disc,
  - a text field holds an absolute path or a personal folder name (the repository is public: a
    source is described as the designer's own file and layer, never as a location on a disk),
  - an entry marked "unused": true has no "unusedNote" saying why.

Art is never deleted. An entry that no screen asks for is kept and marked "unused": true with an
"unusedNote"; the .md lists those in a section of their own.

--promote ID is for when the designer has dropped real art over a placeholder file:
it reads the file's real pixel size, sets status to "real" and optionally the source,
then rebuilds the .md. Pillow is needed only for the size checks.
"""
import argparse
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
JSON_PATH = os.path.join(ASSETS, "art-manifest.json")
MD_PATH = os.path.join(ASSETS, "art-manifest.md")

MAX_FILE = 200 * 1024
MAX_TOTAL = 6 * 1024 * 1024
EXEMPT = {"art-manifest.json", "art-manifest.md"}
# Text that must never appear in the manifest: a drive letter or rooted path, a UNC or backslash
# path, or the name of a personal folder. Checked in every text field of every entry.
# (The names of sync folders are written in two halves so that this very file is clean under the same check.)
PERSONAL_FOLDERS = "|".join(["Drop" + "box", "App" + "Data", "One" + "Drive", "Documents and Settings"])
ABSOLUTE_PATH_RE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(^|[\s`'\"(])/(Users|home|c|mnt|Volumes)/|\\\\|" + PERSONAL_FOLDERS, re.I)
TEXT_FIELDS = ("name", "shows", "usedFor", "source", "notes", "unusedNote")
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
STATUSES = {"real", "placeholder"}
REQUIRED = ["id", "file", "status", "width", "height", "shows", "usedFor", "source"]

# The designer's Photoshop files (private; not in this repository). All except the Pony Express file were opened read-only for docs/psd-extraction-report.md.
PSD_SOURCES = [
    ("Pieces/Carriage Upgrades v1.psd", "the 16 carriage upgrade tiles"),
    ("Pieces/Example Terrain costs.psd", "terrain examples and track tile costs"),
    ("Pieces/Art-v1.psd", "general art: hero, board and box material"),
    ("Pieces/Gameboard-v1.psd", "the game board / map"),
    ("Pieces/Icons-v1.psd", "icons: specialists, buildings, resources, bonus icons, frames"),
    ("Pieces/Pony Express Cards v1.psd", "Pony Express cards"),
    ("Pieces/Specialists - carriage 1.psd", "specialists and carriages"),
    ("images/icons v1.psd", "an earlier icon set (Feb 2024)"),
]
# Existing art found but not used, with the reason. Static: these facts do not change with the manifest.
UNUSED = [
    ("images/goal_12_msot_cities.png", "byte-for-byte duplicate of goal_12_most_cities.png (misspelt name); the correctly spelt file is used"),
    ("AI-Art/ (ChatGPT, Gemini and DALL-E images)", "concept and generation dumps, not game components; the finished pieces are the harvested ones"),
    ("TTS/action_area.png, TTS/lobby_congress.png (the rest of each sheet)", "only the tiles, panels, marker and cells are used; the empty lower half of the Congress sheet and the blue backing are not"),
]


# The order of the "Still needed" table: what the page shows, or would gain most from, comes first.
# The ids listed here lead, in this order, each with its reason; every other placeholder follows in
# the order of the manifest. An id listed here that is not a placeholder is ignored.
PRIORITY = [
    ("ui-hero", "The landing page's top picture. Until it exists the page makes do with the district illustrations."),
    ("map-backdrop", "Would sit behind the route map, the largest area of the game screen, which is plain parchment today. Not wired in yet: the map renderer needs one line to show it."),
    ("ui-logo", "The title lettering on the landing page and in the header. Until it exists the title is plain text."),
    ("train-engine", "The locomotive of every player board (tinted per player). Not wired in yet: the board draws its engine in code."),
    ("track-ground", "The three track tiles are drawn in code today (a hatched picture is never shown); art would make the built stockpile read at a glance."),
    ("track-tunnel", "As track-ground."),
    ("track-bridge", "As track-ground."),
    ("piece-worker", "Workers on the action grid, drawn in code today."),
    ("piece-house", "Houses on the player boards, drawn in code today."),
    ("piece-railhead", "Railheads on the map, drawn in code today."),
    ("token-pony-express", "Pony Express tokens, drawn in code today."),
    ("ui-favicon", "The browser tab icon; a lettered stand-in is used today."),
]


def fail(msgs):
    for m in msgs:
        print("ERROR:", m, file=sys.stderr)
    print(f"{len(msgs)} problem(s). Fix them and run again.", file=sys.stderr)
    sys.exit(1)


def load():
    with open(JSON_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def image_size(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(path) as im:
        return im.size


def check(entries):
    errs = []
    seen_ids, seen_files = set(), set()
    for e in entries:
        for k in REQUIRED:
            if k not in e:
                errs.append(f"entry {e.get('id', '?')}: missing field {k}")
        i = e.get("id", "")
        if not ID_RE.match(i):
            errs.append(f"id {i!r} is not lowercase kebab-case")
        if i in seen_ids:
            errs.append(f"duplicate id {i}")
        seen_ids.add(i)
        f = e.get("file", "")
        if f in seen_files:
            errs.append(f"duplicate file {f}")
        seen_files.add(f)
        if e.get("status") not in STATUSES:
            errs.append(f"{i}: status must be real or placeholder, not {e.get('status')!r}")
        if " " in f or f != f.lower():
            errs.append(f"{i}: file name {f!r} must be lowercase with no spaces")
        if e.get("status") == "real" and not e.get("source"):
            errs.append(f"{i}: a real entry needs a source")
        for field in TEXT_FIELDS:
            value = e.get(field)
            if isinstance(value, str) and ABSOLUTE_PATH_RE.search(value):
                errs.append(f"{i}: {field} holds an absolute path or a personal folder name: {value[:80]!r}")
        if "unused" in e and not isinstance(e["unused"], bool):
            errs.append(f"{i}: unused must be true or false")
        if e.get("unused") is True and not (e.get("unusedNote") or "").strip():
            errs.append(f"{i}: marked unused but has no unusedNote")
        p = os.path.join(ASSETS, f)
        if not os.path.isfile(p):
            errs.append(f"{i}: listed file is missing: {f}")
            continue
        try:
            w, h = image_size(p)
            if (w, h) != (e["width"], e["height"]):
                errs.append(f"{i}: manifest says {e['width']} x {e['height']} but {f} is {w} x {h} (use --promote {i})")
        except Exception as ex:  # pragma: no cover
            errs.append(f"{i}: cannot read {f}: {ex}")
    total = 0
    for root, _dirs, files in os.walk(ASSETS):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, ASSETS).replace(os.sep, "/")
            size = os.path.getsize(full)
            total += size
            if rel in EXEMPT:
                continue
            if rel not in seen_files:
                errs.append(f"file not listed in the manifest: {rel}")
            if size > MAX_FILE:
                errs.append(f"{rel} is {size / 1024:.0f} KB, over the 200 KB limit")
    if total > MAX_TOTAL:
        errs.append(f"assets folder is {total / 1024 / 1024:.2f} MB, over the 6 MB limit")
    return errs, total


def cell(text):
    return (text or "").replace("|", "/").replace("\n", " ")


def build_md(entries, total):
    today = datetime.date.today().strftime("%d/%m/%Y")
    ph = [e for e in entries if e["status"] == "placeholder"]
    real = [e for e in entries if e["status"] == "real"]
    L = []
    reasons = dict(PRIORITY)
    order = {i: n for n, (i, _r) in enumerate(PRIORITY)}
    ph = sorted(ph, key=lambda e: order.get(e["id"], len(PRIORITY)))  # stable: the rest keep manifest order
    L.append("# Still needed: placeholders to replace")
    L.append("")
    L.append("In order of how much the game would gain: the first rows are what a player sees, or would notice, first. The size is what to make the picture at (or larger, then scale down).")
    L.append("")
    L.append("| # | id | file | size (px) | what it should show | why it matters now | where it is used |")
    L.append("|---|---|---|---|---|---|---|")
    for n, e in enumerate(ph, 1):
        shows = cell(e["shows"])
        if e.get("notes"):
            shows += " **Note:** " + cell(e["notes"])
        why = cell(reasons.get(e["id"], "Replaces a labelled placeholder picture."))
        L.append(f"| {n} | `{e['id']}` | `{e['file']}` | {e['width']} x {e['height']} | {shows} | {why} | {cell(e['usedFor'])} |")
    if not ph:
        L.append("| | (none) | | | Every component has real art. | | |")
    L.append("")
    L.append(f"Generated from `art-manifest.json` by `tools/build-art-manifest.py` on {today}. Do not edit this file by hand; edit the JSON and rebuild.")
    L.append("")
    unused = [e for e in entries if e.get("unused")]
    L.append(f"{len(entries)} images: {len(real)} real, {len(ph)} placeholders, {len(unused)} marked unused. Folder size {total / 1024 / 1024:.2f} MB (limit 6 MB, 200 KB per file).")
    L.append("")
    L.append("## How to replace a placeholder")
    L.append("")
    L.append("1. Make the picture at the size in the table (or larger, then scale down). Keep it under 200 KB: PNG for anything with transparency, JPEG or WebP for pictures.")
    L.append("2. Save it over the placeholder file, with the same name, in the same folder. Never rename a file or change an id: the game looks images up by id.")
    L.append('3. Run `python tools/build-art-manifest.py --promote <id> --source "where it came from"`. That reads the real pixel size, marks the entry real and rebuilds this file.')
    L.append("4. Run `python tools/build-art-manifest.py` with no arguments to check the folder.")
    L.append("")
    L.append("Things worth knowing:")
    L.append("")
    L.append("- **Player pieces are tinted by the game.** Entries whose note starts \"Tintable\" (`piece-worker`, `piece-house`, `piece-railway-station`, `piece-telegraph-station`, `piece-railhead`, `piece-score-marker`, `train-engine`) are one greyscale image on a transparent background. The UI multiplies it by the player colour, so paint neutral greys with white highlights, never a player colour.")
    L.append("- **The metal is called Iron.** The ids are `resource-iron` and the like; no picture may say Steel.")
    L.append("- **Terminology.** A house is a production multiplier on the player board only. Buildings on the map are railway stations and telegraph stations. Keep the pictures consistent with that: `piece-house` must not look like `piece-railway-station`.")
    L.append("- **Cards are drawn, not painted.** The 12 goal, 20 Legislative Agenda and 38 Pony Express card pictures hold no text; the UI draws names and rules on the `frame-*` images. Milestone tiles (10) are drawn on one frame.")
    L.append("- **Placeholder look.** Yellow diagonal hatch (grey for tintable pieces), the word PLACEHOLDER, the component name and its pixel size. `python tools/make-placeholder.py --help` makes more.")
    L.append("")
    L.append("## Real art")
    L.append("")
    L.append("| id | file | size (px) | file size | source |")
    L.append("|---|---|---|---|---|")
    for e in real:
        kb = os.path.getsize(os.path.join(ASSETS, e["file"])) / 1024
        src = e["source"] or ""
        L.append(f"| `{e['id']}` | `{e['file']}` | {e['width']} x {e['height']} | {kb:.0f} KB | `{cell(src)}` |")
    L.append("")
    L.append("A source is the designer's own working file (a Photoshop file and layer, a sheet or an exported picture). Those files are private and not in this repository; the paths are relative to the designer's art folder. Everything here was copied and resized; the originals are untouched. Crop details and notes for each picture are in `art-manifest.json`.")
    L.append("")
    L.append("## Photoshop files")
    L.append("")
    L.append("Art was extracted from these files (read only) where it existed; see `docs/psd-extraction-report.md` for what became of every layer. Pony Express Cards v1.psd (1.6 GB) was not opened.")
    L.append("")
    for path, what in PSD_SOURCES:
        L.append(f"- `{path}`: {what}")
    L.append("")
    if unused:
        L.append("## In the folder but not used by any screen")
        L.append("")
        L.append('Kept on purpose (art is never deleted); marked `"unused": true` in the manifest.')
        L.append("")
        L.append("| id | file | why it is not used |")
        L.append("|---|---|---|")
        for e in unused:
            L.append(f"| `{e['id']}` | `{e['file']}` | {cell(e.get('unusedNote'))} |")
        L.append("")
    L.append("## Existing art found but not used")
    L.append("")
    for path, why in UNUSED:
        L.append(f"- `{path}`: {why}")
    L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--promote", metavar="ID")
    ap.add_argument("--source", help="source text to record with --promote")
    a = ap.parse_args()

    entries = load()
    if a.promote:
        hit = [e for e in entries if e["id"] == a.promote]
        if not hit:
            fail([f"no entry with id {a.promote}"])
        e = hit[0]
        p = os.path.join(ASSETS, e["file"])
        if not os.path.isfile(p):
            fail([f"{e['file']} does not exist"])
        e["width"], e["height"] = image_size(p)
        e["status"] = "real"
        e["source"] = a.source or e["source"] or "made by the designer"
        with open(JSON_PATH, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(entries, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"{a.promote} is now real at {e['width']} x {e['height']}")

    errs, total = check(entries)
    if errs:
        fail(errs)
    with open(MD_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(build_md(entries, total))
    real = sum(1 for e in entries if e["status"] == "real")
    print(f"OK: {len(entries)} entries ({real} real, {len(entries) - real} placeholders), "
          f"{total / 1024 / 1024:.2f} MB, wrote {os.path.relpath(MD_PATH, os.path.dirname(HERE)).replace(os.sep, '/')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
