#!/usr/bin/env python3
"""QA: render REAL generated levels (fixed seeds) with the ORIGINAL Pixel
Dungeon sprites, mirroring src/engine/render.ts tile-selection logic exactly
(16x16 -> 48x48 NEAREST). Frames are sliced from the original PNGs with the
same rects as scripts/extract_original_sprites.ts.

Scenes:
  1. depth-1, seed 1234: hero-centered viewport crop + full map
  2. depth-5, seed 777: Goo arena crop + full map
Outputs: docs/qa-orig-*.png
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PD = '/home/hatch/workspace/pixel-dungeon-src/assets'
DOCS = os.path.join(ROOT, 'docs')

# Terrain enum values from src/core/grid.ts (must match render.ts switch);
# ALCHEMY..CHEST_LOCKED are the TS special-room/furniture values.
T = dict(WALL=0, FLOOR=1, DOOR=2, DOOR_LOCKED=3, DOOR_SECRET=4, EXIT_LOCKED=5,
         ENTRANCE=6, EXIT=7, CHASM=8, WATER=9, GRASS=10, WALKWAY=11, WELL=12,
         ALCHEMY=13, PEDESTAL=14, STATUE=15, TOMB=16, BOOKSHELF=17, CHEST=18,
         CHEST_LOCKED=19, TRAP_TOXIC=20, TRAP_TOXIC_HIDDEN=21, TRAP_FIRE=22,
         TRAP_FIRE_HIDDEN=23, TRAP_PARALYTIC=24, TRAP_PARALYTIC_HIDDEN=25,
         TRAP_POISON=26, TRAP_POISON_HIDDEN=27, TRAP_ALARM=28, TRAP_ALARM_HIDDEN=29,
         TRAP_LIGHTNING=30, TRAP_LIGHTNING_HIDDEN=31, TRAP_GRIPPING=32,
         TRAP_GRIPPING_HIDDEN=33, TRAP_SUMMONING=34, TRAP_SUMMONING_HIDDEN=35,
         TRAP_INACTIVE=36, BARRICADE=37, EMBERS=38, HIGH_GRASS=39)
HIDDEN_TRAP = {21, 23, 25, 27, 29, 31, 33, 35}

_cache = {}
def sheet(name):
    if name not in _cache:
        _cache[name] = Image.open(os.path.join(PD, name)).convert('RGBA')
    return _cache[name]

def frame(img_name, x, y, w, h, pad=False):
    """Slice a frame; pad to 16x16 bottom-aligned when smaller."""
    fr = sheet(img_name).crop((x, y, x + w, y + h))
    if pad:
        c = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        c.paste(fr, (0, 16 - h), fr)
        fr = c
    return fr.resize((48, 48), Image.NEAREST)

def tile16(img_name, idx):
    cols = sheet(img_name).width // 16
    return frame(img_name, (idx % cols) * 16, (idx // cols) * 16, 16, 16)

# Same slice table as scripts/extract_original_sprites.ts
def sprite(key):
    if key in ('hero', 'hero_warrior'):
        return frame('warrior.png', 0, 15, 12, 15, pad=True)
    mobs = {'mob_rat': ('rat.png', 0, 0, 16, 15), 'mob_gnoll': ('gnoll.png', 0, 0, 12, 15),
            'mob_crab': ('crab.png', 0, 0, 16, 16), 'mob_swarm': ('swarm.png', 0, 0, 16, 16),
            'mob_skeleton': ('skeleton.png', 0, 0, 12, 15), 'mob_thief': ('thief.png', 0, 0, 12, 13),
            'mob_goo': ('goo.png', 0, 0, 20, 14)}
    if key in mobs:
        f, x, y, w, h = mobs[key]
        return frame(f, x, y, w, h, pad=(w < 16 or h < 16))
    items = {'shortsword': 2, 'dart': 31, 'armor_cloth': 24, 'potion_red': 57,
             'potion_strength': 60, 'ration': 4, 'scroll': 40, 'scroll_upgrade': 41,
             'gold': 14, 'key_iron': 9, 'key_skeleton': 8, 'chest': 11,
             'chest_locked': 12, 'tomb': 13, 'bones': 0}
    if key in items:
        return tile16('items.png', items[key])
    tiles = {'floor0': 1, 'floor1': 24, 'wall': 4, 'door': 5, 'door_locked': 10,
             'door_secret': 16, 'stairs_up': 7, 'stairs_down': 8, 'embers': 9,
             'grass': 2, 'chasm': 0, 'well': 34, 'trap_revealed': 17, 'trap_toxic': 17,
             'trap_fire': 19, 'trap_paralytic': 21, 'trap_poison': 27, 'trap_alarm': 30,
             'trap_lightning': 32, 'trap_gripping': 37, 'trap_summoning': 39,
             'pedestal': 11, 'statue': 35, 'bookshelf': 41, 'alchemy': 42}
    if key in tiles:
        return tile16('tiles0.png', tiles[key])
    if key == 'water':
        return frame('water0.png', 0, 0, 16, 16)
    raise KeyError(key)

def tile_sprite(t, x, y):
    """Exact mirror of Renderer.tileSprite in src/engine/render.ts."""
    if t in (T['WALL'], T['BARRICADE']):
        name = 'wall'
    elif t == T['DOOR_SECRET']:
        name = 'door_secret'
    elif t in (T['FLOOR'], T['WALKWAY'], T['TRAP_INACTIVE']) or t in HIDDEN_TRAP:
        name = 'floor1' if (x * 7 + y * 13) % 3 == 0 else 'floor0'
    elif t == T['EMBERS']:
        name = 'embers'
    elif t == T['DOOR']:
        name = 'door'
    elif t == T['DOOR_LOCKED']:
        name = 'door_locked'
    elif t == T['ENTRANCE']:
        name = 'stairs_up'
    elif t in (T['EXIT'], T['EXIT_LOCKED']):
        name = 'stairs_down'
    elif t == T['WATER']:
        name = 'water'
    elif t in (T['GRASS'], T['HIGH_GRASS']):
        name = 'grass'
    elif t == T['CHASM']:
        name = 'chasm'
    elif t == T['WELL']:
        name = 'well'
    elif t == T['ALCHEMY']:
        name = 'alchemy'
    elif t == T['PEDESTAL']:
        name = 'pedestal'
    elif t == T['STATUE']:
        name = 'statue'
    elif t == T['BOOKSHELF']:
        name = 'bookshelf'
    elif t == T['CHEST']:
        name = 'chest'
    elif t == T['CHEST_LOCKED']:
        name = 'chest_locked'
    elif t == T['TOMB']:
        name = 'tomb'
    elif t == T['TRAP_TOXIC']:
        name = 'trap_toxic'
    elif t == T['TRAP_FIRE']:
        name = 'trap_fire'
    elif t == T['TRAP_PARALYTIC']:
        name = 'trap_paralytic'
    elif t == T['TRAP_POISON']:
        name = 'trap_poison'
    elif t == T['TRAP_ALARM']:
        name = 'trap_alarm'
    elif t == T['TRAP_LIGHTNING']:
        name = 'trap_lightning'
    elif t == T['TRAP_GRIPPING']:
        name = 'trap_gripping'
    elif t == T['TRAP_SUMMONING']:
        name = 'trap_summoning'
    else:
        name = 'floor1' if (x * 7 + y * 13) % 3 == 0 else 'floor0'
    return sprite(name)

def render_scene(level):
    w, h = level['w'], level['h']
    im = Image.new('RGB', (w * 48, h * 48), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            im.paste(tile_sprite(level['tiles'][y * w + x], x, y), (x * 48, y * 48))
    for it in level['items']:
        x, y = it['pos'] % w, it['pos'] // w
        ent = sprite(it['sprite'])
        im.paste(ent, (x * 48, y * 48), ent)
    for m in level['mobs']:
        ent = sprite(m['sprite'])
        im.paste(ent, (m['x'] * 48, m['y'] * 48), ent)
    sx, sy = level['stairsUp'] % w, level['stairsUp'] // w
    hero = sprite('hero_warrior')
    im.paste(hero, (sx * 48, sy * 48), hero)
    return im

def crop_view(im, cx, cy, tw, th):
    w, h = im.size
    px = int((cx + 0.5) * 48 - tw * 48 / 2)
    py = int((cy + 0.5) * 48 - th * 48 / 2)
    px = max(0, min(px, w - tw * 48))
    py = max(0, min(py, h - tw * 48))
    return im.crop((px, py, px + tw * 48, py + th * 48))

levels = [json.loads(l) for l in open('/tmp/levels.json') if l.strip()]
for level in levels:
    im = render_scene(level)
    d = level['depth']
    im.save(os.path.join(DOCS, f'qa-orig-map-d{d}.png'))
    sx, sy = level['stairsUp'] % level['w'], level['stairsUp'] // level['w']
    crop_view(im, sx, sy, 13, 9).save(os.path.join(DOCS, f'qa-orig-view-d{d}.png'))
    print(f'depth {d}: map + view saved')

# entity montage: every mapped entity/item sprite at 3x
keys = ['hero_warrior', 'mob_rat', 'mob_gnoll', 'mob_crab', 'mob_swarm',
        'mob_skeleton', 'mob_thief', 'mob_goo', 'shortsword', 'dart',
        'armor_cloth', 'potion_red', 'potion_strength', 'ration', 'scroll',
        'scroll_upgrade', 'gold', 'key_iron', 'key_skeleton', 'chest',
        'chest_locked', 'tomb', 'bones', 'pedestal', 'statue', 'bookshelf',
        'alchemy']
mon = Image.new('RGBA', (48 * len(keys), 48), (20, 20, 20, 255))
for i, k in enumerate(keys):
    mon.paste(sprite(k), (i * 48, 0), sprite(k))
mon.save(os.path.join(DOCS, 'qa-orig-entities-montage.png'))
print('entities montage saved')
