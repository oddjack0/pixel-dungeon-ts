#!/usr/bin/env python3
"""QA v3 in-game scenes: renders REAL generated levels (fixed seeds) using the
exact prerender algorithm from src/engine/render.ts (flat F/f/W/w region tint
replacement, 3x nearest-neighbor = 48px tiles). Also spot-checks numeric gates
from docs/ART-STYLE.md (v3).

Scenes (sewers region):
  1. depth-1, seed 1234: hero-centered viewport crop (13x9 tiles @3x) + full map
  2. depth-5, seed 777: Goo boss arena crop + full map
Outputs in docs/.
"""
import json, re, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(ROOT, "src", "assets", "sprites.ts")
DOCS = os.path.join(ROOT, "docs")

src = open(TS).read()
pal_src = src.split("export const PALETTE")[1].split("};")[0]
PAL = {}
for m in re.finditer(r'"([^"]+)":\s*("transparent"|"#[0-9a-fA-F]{6}")', pal_src):
    PAL[m.group(1)] = None if m.group(2) == '"transparent"' else m.group(2).lstrip('"')
spr_src = src.split("export const SPRITES")[1].split("export const REGION_TINTS")[0]
SPR = {}
for m in re.finditer(r"  (\w+): \[\n((?:    '[^']*',\n)+)  \],", spr_src):
    SPR[m.group(1)] = re.findall(r"'([^']*)'", m.group(2))
TINTS = {}
for region in ["sewers", "prison", "caves", "city", "halls"]:
    block = re.search(region + r": \{([^}]+)\}", src).group(1)
    TINTS[region] = dict(re.findall(r"([FfWw]): '(#[0-9a-f]+)'", block))

T = dict(WALL=0, FLOOR=1, DOOR=2, DOOR_LOCKED=3, DOOR_SECRET=4, EXIT_LOCKED=5,
         ENTRANCE=6, EXIT=7, CHASM=8, WATER=9, GRASS=10, WALKWAY=11, WELL=12,
         ALCHEMY=13, PEDESTAL=14, STATUE=15, TOMB=16, BOOKSHELF=17, CHEST=18,
         CHEST_LOCKED=19, TRAP_TOXIC=20, TRAP_INACTIVE=36, BARRICADE=37,
         EMBERS=38, HIGH_GRASS=39)
HIDDEN_TRAP = {21, 23, 25, 27, 29, 31, 33, 35}
REVEALED_TRAP = {20, 22, 24, 26, 28, 30, 32, 34}

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# --- exact mirror of render.ts prerender (16x16 -> 48x48 NEAREST) ---
_cache = {}
def prerender(name, region):
    key = (region, name)
    if key in _cache:
        return _cache[key]
    rows = SPR[name]
    tints = TINTS.get(region) if region else None
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        row = rows[y]
        for x in range(16):
            ch = row[x] if x < len(row) else '.'
            if ch == '.':
                continue
            hx = PAL.get(ch, "#ff00ff")
            if tints and ch in "FfWw":
                hx = tints.get(ch, hx)
            px[x, y] = hexrgb(hx) + (255,)
    big = img.resize((48, 48), Image.NEAREST)
    _cache[key] = big
    return big

def tile_sprite(t, x, y, region):
    if t in (T["WALL"], T["BARRICADE"]):
        name = "wall"
    elif t == T["DOOR_SECRET"]:
        name = "door_secret"
    elif t in (T["FLOOR"], T["EMBERS"], T["WALKWAY"], T["TRAP_INACTIVE"]) or t in HIDDEN_TRAP:
        name = "floor1" if (x * 7 + y * 13) % 3 == 0 else "floor0"
    elif t == T["DOOR"]:
        name = "door"
    elif t in (T["DOOR_LOCKED"], T["EXIT_LOCKED"]):
        name = "door_locked"
    elif t == T["ENTRANCE"]:
        name = "stairs_up"
    elif t == T["EXIT"]:
        name = "stairs_down"
    elif t == T["WATER"]:
        name = "water"
    elif t in (T["GRASS"], T["HIGH_GRASS"]):
        name = "grass"
    elif t == T["CHASM"]:
        name = "chasm"
    elif t == T["WELL"]:
        name = "well"
    elif t in REVEALED_TRAP:
        name = "trap_revealed"
    else:
        name = "floor1" if (x * 7 + y * 13) % 3 == 0 else "floor0"
    return prerender(name, region)

def render_scene(level, region, reveal_traps=()):
    w, h = level["w"], level["h"]
    im = Image.new("RGB", (w * 48, h * 48), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            t = level["tiles"][y * w + x]
            if (x, y) in reveal_traps:
                t = T["TRAP_TOXIC"]  # a revealed trap, as seen in-game after triggering
            im.paste(tile_sprite(t, x, y, region), (x * 48, y * 48))
    for it in level["items"]:
        x, y = it["pos"] % w, it["pos"] // w
        ent = prerender(it["sprite"], None)
        im.paste(ent, (x * 48, y * 48), ent)
    for m in level["mobs"]:
        ent = prerender(m["sprite"], None)
        im.paste(ent, (m["x"] * 48, m["y"] * 48), ent)
    # hero on entrance stairs
    sx, sy = level["stairsUp"] % w, level["stairsUp"] // w
    hero = prerender("hero_warrior", None)
    im.paste(hero, (sx * 48, sy * 48), hero)
    return im

def crop_view(im, cx, cy, tw, th):
    """Hero-centered viewport crop of tw x th tiles (like a small phone view)."""
    w, h = im.size
    px, py = int((cx + 0.5) * 48 - tw * 48 / 2), int((cy + 0.5) * 48 - th * 48 / 2)
    px = max(0, min(px, w - tw * 48))
    py = max(0, min(py, h - th * 48))
    return im.crop((px, py, px + tw * 48, py + th * 48))

levels = [json.loads(l) for l in open("/tmp/levels.json") if l.strip()]

def cells_of(level, *names):
    s = set()
    for n in names:
        s |= {i for i, t in enumerate(level["tiles"]) if t == T[n]}
    return s

# ---- Scene 1: depth 1, seed 1234 ----
d1 = levels[0]
hero1 = (d1["stairsUp"] % d1["w"], d1["stairsUp"] // d1["w"])
# reveal 2 traps on plain floor near the hero for the trap check
floors = cells_of(d1, "FLOOR")
hx, hy = hero1
rt = [(hx + 2, hy), (hx - 2, hy + 1)]
rt = [(x, y) for (x, y) in rt if (y * d1["w"] + x) in floors]
full1 = render_scene(d1, "sewers", reveal_traps=rt)
full1.resize((d1["w"] * 16, d1["h"] * 16), Image.NEAREST).save(os.path.join(DOCS, "qa-v2-map-d1.png"))
crop_view(full1, hx, hy, 13, 9).save(os.path.join(DOCS, "qa-v2-view-d1.png"))

# ---- Scene 2: depth 5 Goo arena, seed 777 ----
d5 = levels[1]
goo = [m for m in d5["mobs"] if m["sprite"] == "mob_goo"][0]
hero5 = (d5["stairsUp"] % d5["w"], d5["stairsUp"] // d5["w"])
full5 = render_scene(d5, "sewers")
full5.resize((d5["w"] * 16, d5["h"] * 16), Image.NEAREST).save(os.path.join(DOCS, "qa-v2-map-d5.png"))
crop_view(full5, goo["x"], goo["y"], 11, 9).save(os.path.join(DOCS, "qa-v2-view-d5.png"))

# ---- Numeric gate spot-checks (post-tint built tiles) ----
def luma(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def sat(rgb):
    mx, mn = max(rgb), min(rgb)
    return 0 if mx == 0 else (mx - mn) / mx * 100

sew = TINTS["sewers"]
expected = {"F": "#5da02e", "f": "#4b7e2a", "W": "#6e4c2c", "w": "#74b53a"}
print("sewers tints match ART-STYLE.md §5:", all(sew[k].lower() == v for k, v in expected.items()), sew)
vals = {k: (luma(hexrgb(v)), sat(hexrgb(v))) for k, v in sew.items()}
print("sewers tints luma/sat:", {k: (round(l), round(s)) for k, (l, s) in vals.items()})
l = {k: v[0] for k, v in vals.items()}
print("ordering w>F>f>W:", l["w"] > l["F"] > l["f"] > l["W"],
      "| bands F115-160:", 115 <= l["F"] <= 160,
      "f85-120:", 85 <= l["f"] <= 120,
      "w130-170:", 130 <= l["w"] <= 170,
      "W70-105:", 70 <= l["W"] <= 105)

water = prerender("water", "sewers")
wp = [p[:3] for p in water.getdata()]
white = sum(1 for p in wp if p[0] > 235 and p[1] > 235 and p[2] > 235)
blue = sum(1 for p in wp if p[2] > 110 and p[2] > p[0] + 20)
lowsat = sum(1 for p in wp if sat(p) < 40)
print("water white foam %%: %.1f (<=12 ok)" % (white / len(wp) * 100),
      "| blue fill %%: %.1f (>=70 ok)" % (blue / len(wp) * 100),
      "| low-sat fill %%: %.1f (few %% ok)" % (lowsat / len(wp) * 100))

# moss pixels on floor0: chars outside FfWw
rows = SPR["floor0"]
moss_chars = {ch for r in rows for ch in r if ch not in ".FfWw"}
moss_px = sum(1 for r in rows for ch in r if ch not in ".FfWw") / 256 * 100
moss_hexes = {PAL[c] for c in moss_chars}
moss_sat = [sat(hexrgb(h)) for h in moss_hexes]
print("floor0 clump detail px %%: %.1f (v3: sparse subtle clumps, sat>40), sat: %s" %
      (moss_px, [round(s) for s in moss_sat]))

# magenta garbage scan over all used sprites at 3x
bad = set()
for name in SPR:
    for region in ([None] if name not in
                   ("floor0", "floor1", "wall", "door_secret", "door", "door_locked",
                    "water", "grass", "chasm", "stairs_up", "stairs_down",
                    "trap_revealed", "well", "chest") else ["sewers"]):
        img = prerender(name, region)
        if any(p[:3] == (255, 0, 255) for p in img.getdata()):
            bad.add((name, region))
print("magenta #ff00ff pixels in:", bad or "NONE")

# outline gate on entities: dark pixels (luma<35) must not be neutral (sat<10).
# Transparent canvas pixels are skipped — only painted pixels count.
for name in ["hero_warrior", "mob_rat", "mob_gnoll", "mob_crab", "mob_swarm",
             "mob_skeleton", "mob_thief", "mob_goo"]:
    img = prerender(name, None)
    dark = [p[:3] for p in img.getdata() if p[3] > 128 and luma(p[:3]) < 35]
    neutral = sum(1 for p in dark if sat(p) < 10)
    frac = neutral / max(1, len(dark))
    print("outline %-12s dark-px %5d, neutral-frac %.2f %s" %
          (name, len(dark), frac, "FAIL" if frac > 0.5 and len(dark) > 200 else "ok"))

# wall edge seam check: near-black px on the outermost 1px border of wall
wall = prerender("wall", "sewers")
edge = [wall.getpixel((x, 0))[:3] for x in range(48)] + [wall.getpixel((x, 47))[:3] for x in range(48)] + \
       [wall.getpixel((0, y))[:3] for y in range(48)] + [wall.getpixel((47, y))[:3] for y in range(48)]
seam = sum(1 for p in edge if luma(p) < 20) / len(edge) * 100
print("wall border near-black px %%: %.1f" % seam)
print("scenes saved:", ["qa-v2-view-d1.png", "qa-v2-view-d5.png", "qa-v2-map-d1.png", "qa-v2-map-d5.png"])
