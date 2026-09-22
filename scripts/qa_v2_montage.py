#!/usr/bin/env python3
"""QA v2 montage: every key sprite at 8x labeled, plus an 8x room-crop of the
real depth-1 level (hero + rats + items + traps + stairs + well + chest)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_v2_scenes import prerender, SPR
from PIL import Image, ImageDraw

DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")

def tile8(name, region):
    return prerender(name, region).resize((128, 128), Image.NEAREST)

rows = [
    ("entities", None, ["hero_warrior", "mob_rat", "mob_gnoll", "mob_crab",
                        "mob_swarm", "mob_skeleton", "mob_thief", "mob_goo"]),
    ("items", None, ["potion_red", "potion_strength", "shortsword", "gold",
                     "key_iron", "scroll", "ration", "armor_cloth", "dart"]),
    ("terrain", "sewers", ["floor0", "floor1", "wall", "door", "door_locked",
                           "door_secret", "stairs_up", "stairs_down"]),
    ("terrain2", "sewers", ["water", "grass", "chasm", "trap_revealed",
                            "well", "chest"]),
]
S = 128
LABEL = 16
sheet_w = max(len(r[2]) for r in rows) * (S + 8)
sheet_h = sum((S + LABEL) * 1 for r in rows) + 20
sheet = Image.new("RGB", (sheet_w, sheet_h), (24, 26, 32))
d = ImageDraw.Draw(sheet)
y = 10
for title, region, names in rows:
    x = 8
    for n in names:
        sheet.paste(tile8(n, region), (x, y))
        d.text((x + 4, y + S + 2), n, fill=(255, 255, 255))
        x += S + 8
    y += S + LABEL + 8
sheet.save(os.path.join(DOCS, "qa-v2-montage-8x.png"))
print("saved qa-v2-montage-8x.png")

# 8x crops from the real scenes: hero area + goo area
v1 = Image.open(os.path.join(DOCS, "qa-v2-view-d1.png"))
v5 = Image.open(os.path.join(DOCS, "qa-v2-view-d5.png"))
print("view sizes:", v1.size, v5.size)
