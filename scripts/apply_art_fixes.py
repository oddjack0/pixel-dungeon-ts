#!/usr/bin/env python3
"""Re-run the sprite pipeline after art fixes WITHOUT shifting the atlas.

Re-running scripts/build_sprites.py from scratch would median-cut the
quantize pool again and silently change every existing sprite (the pool
changes because grass/water/floor source pixels changed), and it would drop
the 4 additively-merged item sprites (scripts/add_sprites.py), which are not
part of the pipeline's SHEETS.

Instead this driver:
  1. Runs build_sprites.extract_sprites() (terrain seam + edge-fill fixes
     are wired into the pipeline there).
  2. Re-quantizes against the FROZEN palette parsed from the current
     src/assets/sprites.ts (the 30 quantized centers, in CHAR_POOL order),
     so any sprite whose source art didn't change comes out bit-identical.
  3. Runs the char-level touchup_rows() fixes (part of quantize()).
  4. Splices only the pipeline-owned sprite blocks back into sprites.ts,
     leaving PALETTE, REGION_TINTS, the 4 additive item blocks, and the file
     format byte-identical.

Usage: python3 scripts/apply_art_fixes.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_sprites as bs

OUT_MAIN = os.path.join(ROOT, "src", "assets", "sprites.ts")


def parse_palette(path):
    m = re.search(
        r"export const PALETTE: Record<string, string> = \{\n(.*?)\n\};",
        open(path).read(), re.DOTALL)
    pal = {}
    for mm in re.finditer(r'^\s*"(.+?)": "(transparent|#[0-9a-f]{6})",', m.group(1), re.M):
        pal[mm.group(1)] = mm.group(2)
    return pal


def parse_rows(path):
    text = open(path).read()
    rows = {}
    for mm in re.finditer(r"  (\w+): \[\n((?:    '.{16}',\n)+)  \],", text):
        rows[mm.group(1)] = [l.strip().strip("',") for l in mm.group(2).split("\n") if l.strip()]
    return rows, text


def main():
    sprites = bs.extract_sprites()
    print(f"extracted {len(sprites)} sprites (terrain fixes applied in-pipeline)")

    pal = parse_palette(OUT_MAIN)
    # Frozen centers: the 30 quantized chars, in original CHAR_POOL order,
    # so nearest-center mapping reproduces the original emission exactly.
    frozen = [(ch, (int(pal[ch][1:3], 16), int(pal[ch][3:5], 16), int(pal[ch][5:7], 16)))
              for ch in bs.CHAR_POOL if ch in pal and pal[ch] != "transparent"]
    assert len(frozen) == 30, f"expected 30 frozen centers, got {len(frozen)}"

    _, rows = bs.quantize(sprites, fixed_centers=frozen)
    print("re-quantized against frozen palette + touchup_rows applied")

    old_rows, text = parse_rows(OUT_MAIN)
    for name in bs.SPRITE_ORDER:
        assert name in old_rows, f"{name} missing from current sprites.ts"
        assert name in rows, f"{name} missing from pipeline output"
    # The wall 'w' highlight (NOTE resolution) introduces a palette char that
    # was previously unused and therefore absent from PALETTE. Add its
    # documented BASE_PALETTE entry right after "W" (KNOWN-first ordering).
    if "w" not in pal and any("w" in "".join(rows[n]) for n in bs.SPRITE_ORDER):
        desc, hexv = bs.KNOWN_PALETTE["w"]
        anchor = '  "W": "#3d4354", // wall face\n'
        assert anchor in text, "PALETTE W anchor not found"
        text = text.replace(anchor, anchor + f'  "w": "{hexv}", // {desc}\n', 1)
        pal["w"] = hexv
        print(f"added palette entry 'w': {hexv} ({desc})")
    # Every emitted char must already be in the palette (no new colors).
    for name in bs.SPRITE_ORDER:
        for y, line in enumerate(rows[name]):
            for x, ch in enumerate(line):
                assert ch in pal, f"{name} ({x},{y}): new palette char '{ch}'"

    changed = [n for n in bs.SPRITE_ORDER if rows[n] != old_rows[n]]
    for name in bs.SPRITE_ORDER:
        block_re = re.compile(r"(  " + name + r": \[\n)(?:    '.{16}',\n)+(  \],)")
        new_block = bs.sprite_block(name, rows[name])
        text, n = block_re.subn(new_block, text, count=1)
        assert n == 1, f"splice failed for {name}"

    with open(OUT_MAIN, "w") as f:
        f.write(text)
    print(f"wrote {OUT_MAIN}")
    print(f"changed sprites ({len(changed)}): {', '.join(changed)}")
    expected = {"floor0", "floor1", "grass", "water", "wall",
                "mob_crab", "mob_thief", "mob_goo", "potion_strength"}
    assert set(changed) == expected, f"unexpected change set: {set(changed) ^ expected}"
    print("change set matches the expected art-fix list")


if __name__ == "__main__":
    main()
