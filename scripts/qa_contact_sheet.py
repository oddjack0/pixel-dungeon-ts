#!/usr/bin/env python3
"""QA v2: per-sprite labeled strip at 8x with checkerboard bg, plus sewers-tinted terrain row."""
import re, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(ROOT, "src", "assets", "sprites.ts")
OUT = os.path.join(ROOT, "docs")

src = open(TS).read()
pal_src = src.split("export const PALETTE")[1].split("};")[0]
palette = {}
for m in re.finditer(r'"([^"]+)":\s*("transparent"|"#[0-9a-fA-F]{6}")', pal_src):
    palette[m.group(1)] = None if m.group(2) == '"transparent"' else m.group(2).lstrip('"')
spr_src = src.split("export const SPRITES")[1].split("export const REGION_TINTS")[0]
sprites = {}
for m in re.finditer(r"  (\w+): \[\n((?:    '[.A-Za-z0-9]+',\n)+)  \],", spr_src):
    sprites[m.group(1)] = re.findall(r"'([.A-Za-z0-9]+)'", m.group(2))
tints = {}
for region in ["sewers", "prison", "caves", "city", "halls"]:
    block = re.search(region + r": \{([^}]+)\}", src).group(1)
    tints[region] = dict(re.findall(r"([FfWw]): '(#[0-9a-f]+)'", block))

def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

S = 8
cell = 16 * S

def render(rows, pal, tint=None):
    p = dict(pal)
    if tint:
        p.update(tint)
    im = Image.new("RGB", (cell, cell), (128, 128, 128))
    px = im.load()
    # checkerboard for transparency check
    for y in range(cell):
        for x in range(cell):
            if (x // 16 + y // 16) % 2:
                px[x, y] = (170, 170, 170)
    for y in range(16):
        for x in range(16):
            c = p.get(rows[y][x])
            if c is None:
                continue
            r, g, b = hex2rgb(c)
            for dy in range(S):
                for dx in range(S):
                    px[x * S + dx, y * S + dy] = (r, g, b)
    return im

names = list(sprites.keys())
LABEL = 18
sheet = Image.new("RGB", (cell, (cell + LABEL) * len(names)), (40, 40, 48))
d = ImageDraw.Draw(sheet)
for i, name in enumerate(names):
    sheet.paste(render(sprites[name], palette), (0, i * (cell + LABEL)))
    d.text((6, i * (cell + LABEL) + cell + 3), name, fill=(255, 255, 255))
sheet.save(os.path.join(OUT, "qa-strip.png"))

terrain = ["floor0", "floor1", "wall", "door_secret", "door", "door_locked",
           "water", "grass", "chasm", "stairs_up", "stairs_down", "trap_revealed",
           "well", "chest"]
s2 = Image.new("RGB", (cell, (cell + LABEL) * len(terrain)), (30, 40, 30))
d2 = ImageDraw.Draw(s2)
for i, name in enumerate(terrain):
    s2.paste(render(sprites[name], palette, tint=tints["sewers"]), (0, i * (cell + LABEL)))
    d2.text((6, i * (cell + LABEL) + cell + 3), name, fill=(255, 255, 255))
s2.save(os.path.join(OUT, "qa-terrain-sewers.png"))
print("ok")
