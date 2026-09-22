#!/usr/bin/env python3
"""Additive sprite merge: convert ONE new sheet with build_sprites' pipeline
functions, then append the resulting sprites to src/assets/sprites.ts WITHOUT
regenerating the existing atlas.

Re-running scripts/build_sprites.py would median-cut the whole quantize pool
again and silently change every existing sprite, so this script only converts
the new sheet ("sheet-items-b", 2x2) and splices its 4 sprites into the
existing file:

  1. Extract via build_sprites keying/crop/resize/coverage logic (same as the
     original conversion).
  2. Map each pixel to the NEAREST EXISTING palette char in sprites.ts
     (outline rule luma<48 -> 'k' kept; tintable ramp F,f,W,w excluded since
     items are never region-tinted). If no existing char is close enough
     (sq-dist > FAR2), fall back to a documented-but-unused KNOWN_PALETTE
     char (e.g. 'y' gold, 'H' sparkle) and append it to PALETTE.
  3. Insert the 4 new sprite blocks after the last sprite and the new palette
     entries at the end of PALETTE, preserving the exact char-art format.

Usage: python3 scripts/add_sprites.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_sprites as bs

PX = 16
OUT_MAIN = os.path.join(ROOT, "src", "assets", "sprites.ts")

NEW_SHEET = ("sheet-items-b", 2, 2, [
    ("armor_cloth", "fit"), ("gold", "fit"),
    ("key_iron", "fit"), ("key_skeleton", "fit"),
])
ORDER = ["armor_cloth", "gold", "key_iron", "key_skeleton"]

FAR2 = 1600  # squared RGB distance beyond which a fallback palette char is used
RESERVED = {".", "k", "F", "f", "W", "w"}  # never nearest-search targets


def parse_palette(text):
    """Return (dict char->hex or 'transparent',) from the PALETTE block."""
    m = re.search(r"export const PALETTE: Record<string, string> = \{\n(.*?)\n\};",
                  text, re.DOTALL)
    pal = {}
    for mm in re.finditer(r'^\s*"(.+?)": "(transparent|#[0-9a-f]{6})",', m.group(1), re.M):
        pal[mm.group(1)] = mm.group(2)
    return pal


def hex_rgb(h):
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def extract_new_sheet():
    """Same conversion logic as build_sprites.extract_sprites, but for the
    single new sheet (avoids the pipeline's hardcoded floor0->floor1 flip)."""
    from PIL import Image
    stem, cols, rows, specs = NEW_SHEET
    im = Image.open(bs.find_sheet(stem)).convert("RGB")
    cw, ch = im.width // cols, im.height // rows
    out = {}
    for idx, (name, mode) in enumerate(specs):
        cx, cy = idx % cols, idx // cols
        cell = im.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
        keyed = bs.key_background(cell)
        if mode == "fit":
            keyed = bs.drop_border_bleed(keyed)
        mask = keyed.split()[3].point(lambda a: 255 if a > 128 else 0)
        bbox = mask.getbbox()
        if not bbox:
            raise ValueError(f"{stem}/{name}: empty cell")
        crop_w, crop_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        rgba = Image.new("RGBA", (PX, PX), (255, 0, 255, 0))
        cov = Image.new("L", (PX, PX), 0)
        s = min(PX / crop_w, PX / crop_h)
        nw, nh = max(1, round(crop_w * s)), max(1, round(crop_h * s))
        ox, oy = (PX - nw) // 2, (PX - nh) // 2
        rgba.alpha_composite(keyed.crop(bbox).resize((nw, nh), Image.BOX).convert("RGBA"), (ox, oy))
        cov.paste(mask.crop(bbox).resize((nw, nh), Image.BOX), (ox, oy))
        rp, vp = rgba.load(), cov.load()
        for y in range(PX):
            for x in range(PX):
                if vp[x, y] < 64:  # COV_MIN, same as pipeline
                    rp[x, y] = (255, 0, 255, 0)
        out[name] = rgba
    return out


def main():
    sprites = extract_new_sheet()
    print("extracted:", sorted(sprites))
    assert all(n in sprites for n in ORDER), "missing sprites"

    with open(OUT_MAIN) as f:
        text = f.read()
    for n in ORDER:
        assert f"\n  {n}: [" not in text, f"{n} already present — strip before re-running"
    pal = parse_palette(text)

    candidates = [(ch, hex_rgb(hx)) for ch, hx in pal.items()
                  if ch not in RESERVED and hx != "transparent"]
    unused_known = {ch: (desc, hexv) for ch, (desc, hexv) in bs.KNOWN_PALETTE.items()
                    if ch not in pal and ch not in RESERVED and hexv is not None}
    added = {}  # ch -> (desc, hexv)

    def pixel_char(p):
        if p[3] < 128 or bs.is_transparent(p[:3]):
            return "."
        rgb = p[:3]
        if bs.luma(rgb) < bs.OUTLINE_LUMA:
            return "k"
        r, g, b = rgb
        # Magenta-tinted fold shadows (the image model shades dark folds with
        # magenta-tinged tones) are never palette drivers and never earn a new
        # fallback char: map them to the nearest EXISTING char, exactly as the
        # original pipeline's pool exclusion did ("they still get rendered,
        # mapped to the nearest center"). This keeps them as gray/dark crevice
        # tones instead of introducing purple where it doesn't belong.
        tinted = r > 90 and b > 90 and r > g + 40 and b > g + 40
        best = min(candidates, key=lambda c: (rgb[0] - c[1][0]) ** 2 +
                   (rgb[1] - c[1][1]) ** 2 + (rgb[2] - c[1][2]) ** 2)
        d2 = sum((a - b) ** 2 for a, b in zip(rgb, best[1]))
        if d2 > FAR2 and not tinted:
            fb = min(unused_known.items(),
                     key=lambda kv: sum((a - b) ** 2 for a, b in zip(rgb, hex_rgb(kv[1][1]))))
            fd2 = sum((a - b) ** 2 for a, b in zip(rgb, hex_rgb(fb[1][1])))
            if fd2 < d2:
                if fb[0] not in added:
                    added[fb[0]] = fb[1]
                    candidates.append((fb[0], hex_rgb(fb[1][1])))
                    print(f"  fallback palette char '{fb[0]}' ({fb[1][0]} {fb[1][1]})")
                return fb[0]
        return best[0]

    rows = {}
    for name in ORDER:
        data = list(sprites[name].getdata())
        rows[name] = ["".join(pixel_char(data[y * PX + x]) for x in range(PX))
                      for y in range(PX)]
        print(f"  {name}: chars={sorted(set(''.join(rows[name])))}")

    # Splice new palette entries at the end of PALETTE.
    pal_anchor = "};\n\nexport const SPRITES"
    pal_lines = "\n".join(
        f'  "{ch}": "{hexv}", // {desc}'
        for ch, (desc, hexv) in sorted(added.items()))
    assert pal_anchor in text, "PALETTE anchor not found"
    text = text.replace(pal_anchor, pal_lines + ("\n" if pal_lines else "") + pal_anchor,
                        1)

    # Splice new sprite blocks after the last sprite block (scroll).
    blocks = "\n\n".join(bs.sprite_block(n, rows[n]) for n in ORDER)
    sprite_anchor = "  ],\n};\n\n/**\n * Per-region overrides"
    assert sprite_anchor in text, "SPRITES anchor not found"
    text = text.replace(sprite_anchor,
                        "  ],\n\n" + blocks + "\n};\n\n/**\n * Per-region overrides", 1)

    with open(OUT_MAIN, "w") as f:
        f.write(text)
    print("wrote", OUT_MAIN)


if __name__ == "__main__":
    main()
