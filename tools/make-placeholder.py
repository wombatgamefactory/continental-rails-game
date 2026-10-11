#!/usr/bin/env python3
"""Generate unmistakable placeholder images for Continental Rails.

A placeholder is a flat, diagonally hatched PNG carrying the word PLACEHOLDER,
the component name and the pixel size, at the size the real art should be
delivered.

Usage:
  python tools/make-placeholder.py ID "Label text" WIDTH HEIGHT [--out PATH] [--grey] [--force]
  python tools/make-placeholder.py --from-manifest [--force]

--from-manifest reads assets/art-manifest.json and creates every entry whose
status is "placeholder" and whose file does not exist yet (with --force it
rewrites them all). Entries whose notes begin with "Tintable" are drawn in
greyscale. Real art is never touched.

Needs Pillow only. Run from anywhere; paths are resolved from this file.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
MANIFEST = os.path.join(ASSETS, "art-manifest.json")

BG = (250, 232, 150)        # flat pale yellow
HATCH = (214, 160, 40)      # amber hatch lines
INK = (120, 20, 20)         # dark red for the word PLACEHOLDER
TEXT = (40, 40, 40)
PANEL = (255, 255, 255)
BG_G, HATCH_G, INK_G, TEXT_G = (232, 232, 232), (150, 150, 150), (60, 60, 60), (40, 40, 40)

# Font file NAMES, not paths: Pillow looks them up in the system's own font folders.
FONT_CANDIDATES = ["arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"]


def font(size):
    size = max(6, int(size))
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:  # old Pillow
        return ImageFont.load_default()


def text_size(draw, text, f):
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0], box[3] - box[1]


def fit_single(draw, text, max_w, max_h, start):
    s = int(start)
    while s > 6:
        f = font(s)
        w, h = text_size(draw, text, f)
        if w <= max_w and h <= max_h:
            return f, w, h
        s -= 1
    f = font(6)
    w, h = text_size(draw, text, f)
    return f, w, h


def wrap_label(draw, text, max_w, max_h, start, max_lines=3):
    """Largest font that wraps `text` into <= max_lines lines within the box."""
    s = int(start)
    while s >= 6:
        f = font(s)
        words, lines, cur = text.split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if text_size(draw, trial, f)[0] <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        lh = text_size(draw, "Ag", f)[1] + 2
        if (len(lines) <= max_lines and all(text_size(draw, l, f)[0] <= max_w for l in lines)
                and lh * len(lines) <= max_h):
            return f, lines, lh
        s -= 1
    f = font(6)
    return f, [text], text_size(draw, text, f)[1] + 2


def make_placeholder(label, width, height, grey=False):
    bg, hatch, ink, txt = (BG_G, HATCH_G, INK_G, TEXT_G) if grey else (BG, HATCH, INK, TEXT)
    img = Image.new("RGB", (width, height), bg)
    d = ImageDraw.Draw(img)
    step = max(8, min(width, height) // 12)
    lw = max(1, step // 7)
    for k in range(-height, width + height, step):
        d.line([(k, 0), (k + height, height)], fill=hatch, width=lw)
    # frame
    bw = max(1, min(width, height) // 40)
    d.rectangle([0, 0, width - 1, height - 1], outline=ink, width=bw)
    # centre panel
    m = max(3, int(min(width, height) * 0.07))
    px0, py0, px1, py1 = m + bw, m + bw, width - m - bw - 1, height - m - bw - 1
    d.rectangle([px0, py0, px1, py1], fill=PANEL, outline=ink, width=max(1, bw // 2 + 1))
    pw, ph = px1 - px0 - 2 * max(2, m // 2), py1 - py0 - 2 * max(2, m // 2)
    f1, w1, h1 = fit_single(d, "PLACEHOLDER", pw, ph * 0.30, ph * 0.30)
    f2, lines, lh = wrap_label(d, label, pw, ph * 0.40, ph * 0.18)
    f3, w3, h3 = fit_single(d, f"{width} x {height} px", pw, ph * 0.16, ph * 0.12)
    gap = max(1, int(ph * 0.04))
    total = h1 + gap + lh * len(lines) + gap + h3
    y = py0 + (py1 - py0 - total) // 2
    cx = (px0 + px1) // 2
    d.text((cx - w1 // 2, y - d.textbbox((0, 0), "PLACEHOLDER", font=f1)[1]), "PLACEHOLDER", font=f1, fill=ink)
    y += h1 + gap
    for line in lines:
        lw_, _ = text_size(d, line, f2)
        d.text((cx - lw_ // 2, y - d.textbbox((0, 0), line, font=f2)[1]), line, font=f2, fill=txt)
        y += lh
    y += gap
    d.text((cx - w3 // 2, y - d.textbbox((0, 0), "0", font=f3)[1]), f"{width} x {height} px", font=f3, fill=txt)
    if grey:
        img = img.convert("L")
    else:
        img = img.quantize(colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return img


def write(path, label, width, height, grey=False):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    make_placeholder(label, width, height, grey).save(path, "PNG", optimize=True)
    size = os.path.getsize(path)
    if size > 200 * 1024:
        raise SystemExit(f"{path} is {size} bytes, over the 200 KB limit")
    return size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", nargs="?")
    ap.add_argument("label", nargs="?")
    ap.add_argument("width", nargs="?", type=int)
    ap.add_argument("height", nargs="?", type=int)
    ap.add_argument("--out", help="output path (default assets/<folder>/<id>.png via --from-manifest only)")
    ap.add_argument("--grey", action="store_true", help="greyscale (for pieces the UI tints per player)")
    ap.add_argument("--from-manifest", action="store_true")
    ap.add_argument("--force", action="store_true", help="overwrite existing files")
    a = ap.parse_args()

    if a.from_manifest:
        with open(MANIFEST, encoding="utf-8") as fh:
            entries = json.load(fh)
        made = 0
        for e in entries:
            if e["status"] != "placeholder":
                continue
            path = os.path.join(ASSETS, e["file"])
            if os.path.exists(path) and not a.force:
                continue
            grey = (e.get("notes") or "").startswith("Tintable")
            label = e.get("name") or e["id"]
            write(path, label, e["width"], e["height"], grey)
            made += 1
        print(f"wrote {made} placeholder file(s)")
        return 0

    if not (a.id and a.label and a.width and a.height):
        ap.error("give ID LABEL WIDTH HEIGHT, or --from-manifest")
    out = a.out or os.path.join(ASSETS, "ui", a.id + ".png")
    if os.path.exists(out) and not a.force:
        sys.exit(f"{out} exists; use --force or --out to write elsewhere")
    print(out, write(out, a.label, a.width, a.height, a.grey), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
