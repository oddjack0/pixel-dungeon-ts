#!/usr/bin/env python3
"""
Convert AI-assisted original sprite sheets (art-src/*.webp, magenta background)
into the game's 16x16 char-art sprite format.

Pipeline per sprite:
  1. Slice the sheet into its grid cells.
  2. Key out near-magenta (#FF00FF) -> transparent; crop to content bbox.
  3. Terrain tiles: stretch to 16x16 (full-bleed). Entities/objects: fit
     aspect-preserved into 16x16, centered on transparency.
  4. Post-extract fixes: water gets white ripple arcs stamped at 16x16
     (scripts/stamp_ripples.py); wall + door_secret get border-connected
     transparency filled (no seam darkening).
  5. Quantize: floor/wall map to the tintable gray chars (F,f,W,w,k) so
     REGION_TINTS keeps producing the 5 regional tilesets; saturated
     moss/detail pixels (HSV sat >= 0.45, luma >= 48) bypass the gray ramp
     into the shared pool. Everything else is median-cut to a shared
     limited palette ("chunky" look).
  6. Emit src/assets/sprites.ts.

Usage: python3 scripts/build_sprites.py
Grid logic and mechanics are untouched — this only replaces art.
"""
import colorsys
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stamp_ripples import stamp_ripples

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_SRC = os.path.join(ROOT, "art-src")
OUT_MAIN = os.path.join(ROOT, "src", "assets", "sprites.ts")

PX = 16
MAGENTA = (255, 0, 255)

# (sheet file stem, cols, rows, [(sprite_name, 'fill'|'fit'), ...]) in row-major order
# Stems resolve via SHEET_EXACT to the supervisor-APPROVED v3 sheets.
# Deliberately NO prefix/glob matching: art-src/ holds unapproved
# intermediate generations (media-generation-<stem>-0-*.webp) that a
# startswith() lookup would happily resolve to instead of the approved
# final file.
SHEETS = [
    ("sheet-terrain-a-v3", 3, 2, [
        ("floor0", "fill"), ("wall", "fill"), ("door", "fill"),
        ("door_locked", "fill"), ("door_secret", "fill"), ("water", "fill"),
    ]),
    ("sheet-terrain-b-v3", 3, 2, [
        ("grass", "fill"), ("chasm", "fill"), ("stairs_down", "fill"),
        ("stairs_up", "fill"), ("trap_revealed", "fill"), ("well", "fit"),
    ]),
    ("sheet-entities-v3", 3, 3, [
        ("chest", "fit"), ("hero_warrior", "fit"), ("mob_rat", "fit"),
        ("mob_gnoll", "fit"), ("mob_crab", "fit"), ("mob_swarm", "fit"),
        ("mob_skeleton", "fit"), ("mob_thief", "fit"), ("mob_goo", "fit"),
    ]),
    ("sheet-items-v3", 3, 2, [
        ("shortsword", "fit"), ("dart", "fit"), ("potion_red", "fit"),
        ("potion_strength", "fit"), ("ration", "fit"), ("scroll", "fit"),
    ]),
]

# Exact approved file per stem. The build fails loudly if an entry is
# missing rather than falling back to an unapproved intermediate.
SHEET_EXACT = {
    "sheet-terrain-a-v3": "sheet-terrain-a-v3.webp",
    "sheet-terrain-b-v3": "sheet-terrain-b-v3.webp",
    "sheet-entities-v3": "sheet-entities-v3.webp",
    "sheet-items-v3": "sheet-items-v3.webp",
    # Additive-only sheet for scripts/add_sprites.py: its 4 item sprites
    # (armor_cloth, gold, key_iron, key_skeleton) are already approved and
    # live in the atlas. Exact path, same as the rest — no globbing.
    "sheet-items-b": "media-generation-sheet-items-b-0-touchup.webp",
}

# Sprites that must stay in the tintable gray ramp so REGION_TINTS works.
# door_secret looks like a wall tile, so it must tint identically to wall.
# grass rides the floor ramp (base = F): REGION_TINTS turns its grays into
# the region's grass green; its saturated blades/clumps bypass via
# is_moss_detail into the shared pool. Verified no conflict with the wall
# top-cap promotion, which keys on name == "wall" only.
TINTABLE = {"floor0", "floor1", "wall", "door_secret", "grass"}
# Saturated authored detail inside tintable sprites (moss tufts, lichen):
# HSV saturation at/above this bypasses the gray ramp into the shared pool.
MOSS_SAT_MIN = 0.45
MOSS_LUMA_MIN = 48
BASE_GRAYS = {  # char -> rgb (untinted base colors from sprites.ts PALETTE)
    "k": (43, 34, 38),
    "F": (110, 116, 132),
    "f": (91, 97, 112),
    "W": (61, 67, 84),
    "w": (86, 94, 120),
}
OUTLINE_LUMA = 40  # below this -> 'k' (warm dark outline, ART-STYLE.md §8)

# Pool of fresh single-char palette keys (no collisions with the base palette).
CHAR_POOL = list("abhijlmnpqrtxACEIJKLMQVXYZ0123456789")

# Base palette entries carried over (documented colors incl. tintable ramp).
BASE_PALETTE = {
    ".": ("transparent", None),
    "k": ("warm dark outline", "#2b2226"),
    "F": ("floor base", "#6e7484"),
    "f": ("floor dark speckle", "#5b6170"),
    "W": ("wall face", "#3d4354"),
    "w": ("wall top highlight", "#565e78"),
    "D": ("wood", "#8a5a2b"),
    "d": ("dark wood", "#6e4520"),
    "S": ("skin", "#e8b06a"),
    "T": ("hero tunic (teal)", "#2e8a7a"),
    "B": ("blade steel", "#9aa2b5"),
    "R": ("red potion liquid", "#c0392b"),
    "G": ("glass", "#cfd4dc"),
    "H": ("glass sparkle", "#ffffff"),
    "P": ("parchment", "#e8e0c8"),
    "N": ("dark parchment (scroll band)", "#b8ad8e"),
}
EXTRA_BASE_PALETTE = {
    "U": ("water blue", "#3b9bd4"),
    "u": ("dark water shadow", "#2778ad"),
    "g": ("grass green", "#4da64d"),
    "e": ("dark grass (tufts/shade)", "#3a7f3a"),
    "y": ("gold", "#f2c14e"),
    "v": ("purple (books, faint chasm glints)", "#8b5aa8"),
    "o": ("flame orange", "#e8862e"),
    "c": ("magic glow cyan", "#5af2e0"),
    "s": ("light stone (rims, lids)", "#a9b0c2"),
    "z": ("chasm dark", "#120e16"),
}


# Merged known palette (documented colors with fixed meaning).
KNOWN_PALETTE = {**BASE_PALETTE, **EXTRA_BASE_PALETTE}

# Final sprite order in sprites.ts.
SPRITE_ORDER = [
    "hero", "hero_warrior",
    "floor0", "floor1", "wall",
    "door", "door_locked", "door_secret",
    "water", "grass", "chasm",
    "stairs_up", "stairs_down", "trap_revealed", "well", "chest",
    "mob_rat", "mob_gnoll", "mob_crab", "mob_swarm", "mob_skeleton", "mob_thief",
    "mob_goo",
    "shortsword", "dart", "potion_red", "potion_strength", "ration", "scroll",
]


# Hand-authored sprites that ship in the atlas but are not pipeline-generated.
# scroll_upgrade: a parchment roll with a golden up-arrow rune, drawn in the
# 16x16 char-art idiom. Char remap vs the v1 original (q->0, p->t): the v2
# median-cut reassigns 'q'/'p' to olive-green/teal, so the v1 parchment-tan
# chars are remapped to the nearest v2 tans to keep the art visually
# identical. Its KNOWN_PALETTE chars ('y' gold) are force-included in the
# emitted palette below.
HAND_AUTHORED = {
    "scroll_upgrade": [
        "................",
        "................",
        "................",
        "......yy........",
        ".....kyyk.......",
        "....kyyyyk......",
        "..kkkkyykkkk....",
        ".k00ttkyyktt00k.",
        "k000ttyyktt0000k",
        "k000ttyyktt0000k",
        "k00ttkyyktt0000k",
        ".k00ttkyyktt00k.",
        "..kkkkyykkkk....",
        "......yy........",
        "......kk........",
        "................",
    ],
}


def is_transparent(px):
    # Strict magenta only. Interior magenta-tinted shadow pixels (the image
    # model shades dark folds with magenta-tinged tones) are REAL sprite
    # pixels and must survive; background removal is handled by
    # key_background's border-connected flood fill below.
    r, g, b = px[:3]
    return r > 180 and g < 120 and b > 180


def find_sheet(stem):
    fname = SHEET_EXACT[stem]
    path = os.path.join(ART_SRC, fname)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"approved sheet missing: {path}")
    return path


def is_magenta_loose(px):
    r, g, b = px[:3]
    return r > 140 and g < 140 and b > 140


def despeckle(img):
    """Zero out generous-magenta pixels connected to the image border.

    Kills anti-aliased magenta halos the strict key misses, without touching
    interior pixels (e.g. purple book covers).
    """
    w, h = img.size
    px = img.load()
    mask = [[is_magenta_loose(px[x, y]) and px[x, y][3] > 128 for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    stack = [(x, 0) for x in range(w) if mask[0][x]] + [(x, h - 1) for x in range(w) if mask[h - 1][x]] + \
            [(0, y) for y in range(h) if mask[y][0]] + [(w - 1, y) for y in range(h) if mask[y][w - 1]]
    while stack:
        x, y = stack.pop()
        if seen[y][x] or not mask[y][x]:
            continue
        seen[y][x] = True
        px[x, y] = (255, 0, 255, 0)
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))
    return img


def key_background(cell):
    """Key out the sheet background: strict magenta plus any loose-magenta
    pixels connected to the image border (halos, AA fringes). Interior
    magenta-tinted shadow pixels are enclosed by opaque art and survive.
    Returns an RGBA image."""
    rgba = cell.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    loose = [[is_magenta_loose((px[x, y][0], px[x, y][1], px[x, y][2])) or
              is_transparent((px[x, y][0], px[x, y][1], px[x, y][2]))
              for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    stack = [(x, 0) for x in range(w) if loose[0][x]] + \
            [(x, h - 1) for x in range(w) if loose[h - 1][x]] + \
            [(0, y) for y in range(h) if loose[y][0]] + \
            [(w - 1, y) for y in range(h) if loose[y][w - 1]]
    while stack:
        x, y = stack.pop()
        if seen[y][x] or not loose[y][x]:
            continue
        seen[y][x] = True
        px[x, y] = (255, 0, 255, 0)
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))
    return rgba


def drop_border_bleed(keyed):
    """Remove small connected components that touch the cell border.

    The image model sometimes lets art spill a few dozen px across cell
    boundaries (e.g. goo slime into the thief cell). Such spill fragments
    touch the border and are much smaller than the real sprite; drop any
    border-touching component under 6% of the cell area. Components joined
    to the main sprite (sword tips, whiskers) are unaffected.
    """
    import numpy as np
    a = np.array(keyed.split()[3]) > 128
    h, w = a.shape
    seen = np.zeros_like(a, dtype=bool)
    for y in range(h):
        for x in range(w):
            if not a[y, x] or seen[y, x]:
                continue
            # BFS one component
            stack = [(x, y)]
            seen[y, x] = True
            comp = []
            touches = False
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                if cx == 0 or cy == 0 or cx == w - 1 or cy == h - 1:
                    touches = True
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and a[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((nx, ny))
            if touches and len(comp) < 0.06 * w * h:
                for cx, cy in comp:
                    keyed.putpixel((cx, cy), (255, 0, 255, 0))
    return keyed


# Full-bleed terrain tiles (no outer outline; edges must tile seamlessly).
# floor1 is derived as a horizontal flip of floor0, so it inherits the fixes.
FULL_BLEED_TERRAIN = {"floor0", "grass", "water"}

# wall/door_secret are not full-bleed art, but their keyed source art leaves
# border-connected transparent pixels (~30% of the edge) that render as black
# vertical grid seams on the engine's black canvas. Fill those (edge fill
# ONLY — fix_terrain_seam would eat the wall's legitimate dark face).
EDGE_FILL_TERRAIN = {"wall", "door_secret"}

SEAM_DARK_RATIO = 0.62  # a trailing row this much darker than the interior
# median is treated as a border-shadow artifact, not real art


def fix_terrain_seam(rgba):
    """Remove the dark band at the bottom of full-bleed terrain tiles.

    The source art's bottom edge carries a dark border shadow that survives
    the content-bbox crop, so the downscaled tile ends with 1-2 rows much
    darker than the interior (floor bottom-row luma ~26 vs ~56 above),
    producing a visible dark band every tile when tiled vertically.
    Detect trailing rows darker than SEAM_DARK_RATIO * interior median luma
    and replace each with a mirror of the rows above the band, so the tile
    butts seamlessly. Idempotent: already-fixed tiles detect no dark rows.
    """
    w, h = rgba.size
    px = rgba.load()

    def row_luma(y):
        ls = [luma(px[x, y][:3]) for x in range(w) if px[x, y][3] > 128]
        return sum(ls) / len(ls) if ls else 0.0

    interior = sorted(row_luma(y) for y in range(2, h - 2))
    ref = interior[len(interior) // 2]
    if ref <= 0:
        return rgba
    bad = []
    for y in range(h - 1, 1, -1):
        if row_luma(y) < SEAM_DARK_RATIO * ref:
            bad.append(y)
        else:
            break
    if not bad:
        return rgba
    last_good = bad[-1] - 1
    for y in bad:
        src_y = 2 * last_good + 1 - y  # mirror across the band boundary
        if not 0 <= src_y <= last_good:
            break
        for x in range(w):
            px[x, y] = px[x, src_y]
    return rgba


def fill_edge_transparency(rgba):
    """Fill border-connected transparent pixels on full-bleed terrain tiles.

    Moss keyed out along the source art's edges leaves transparent pixels on
    the tile border (floor 17, grass 31, water 4) that would punch holes in
    the tiled terrain. Fill every transparent pixel connected to the image
    border (4-connectivity) with its nearest opaque neighbor's color.
    Interior isolated holes (none currently) are left alone.
    """
    w, h = rgba.size
    px = rgba.load()
    transparent = [[px[x, y][3] <= 128 for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    stack = [(x, 0) for x in range(w) if transparent[0][x]] + \
            [(x, h - 1) for x in range(w) if transparent[h - 1][x]] + \
            [(0, y) for y in range(h) if transparent[y][0]] + \
            [(w - 1, y) for y in range(h) if transparent[y][w - 1]]
    holes = []
    while stack:
        x, y = stack.pop()
        if seen[y][x] or not transparent[y][x]:
            continue
        seen[y][x] = True
        holes.append((x, y))
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))
    if not holes:
        return rgba
    opaque = [(x, y) for y in range(h) for x in range(w) if not transparent[y][x]]
    for x, y in holes:
        nx, ny = min(opaque, key=lambda q: (q[0] - x) ** 2 + (q[1] - y) ** 2)
        r, g, b, _ = px[nx, ny]
        px[x, y] = (r, g, b, 255)
    return rgba


def extract_sprites():
    """Return dict name -> 16x16 RGBA PIL image.

    Background comes from key_background (strict + border-connected magenta
    flood fill). Transparency comes from a coverage mask: the keyed alpha is
    downscaled alongside the art, and any output pixel that is <40% covered
    by opaque source pixels becomes transparent. This kills residual
    anti-aliased fringes without eroding the silhouette.
    """
    COV_MIN = 64  # 0.25 * 255 — low because key_background already removed the
    # real background; this only needs to kill detached 1px fringe while
    # preserving thin features (ribs, legs, antennae).
    out = {}
    for stem, cols, rows, specs in SHEETS:
        im = Image.open(find_sheet(stem)).convert("RGB")
        cw, ch = im.width // cols, im.height // rows
        assert len(specs) == cols * rows, f"{stem}: spec/grid mismatch"
        for idx, (name, mode) in enumerate(specs):
            cx, cy = idx % cols, idx // cols
            cell = im.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
            keyed = key_background(cell)
            if mode == "fit":
                keyed = drop_border_bleed(keyed)
            mask = keyed.split()[3].point(lambda a: 255 if a > 128 else 0)
            bbox = mask.getbbox()
            if not bbox:
                raise ValueError(f"{stem}/{name}: empty cell")
            crop_w, crop_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
            rgba = Image.new("RGBA", (PX, PX), (255, 0, 255, 0))
            cov = Image.new("L", (PX, PX), 0)
            if mode == "fill":
                rgba.alpha_composite(keyed.crop(bbox).resize((PX, PX), Image.BOX).convert("RGBA"), (0, 0))
                cov.paste(mask.crop(bbox).resize((PX, PX), Image.BOX), (0, 0))
            else:
                s = min(PX / crop_w, PX / crop_h)
                nw, nh = max(1, round(crop_w * s)), max(1, round(crop_h * s))
                ox, oy = (PX - nw) // 2, (PX - nh) // 2
                rgba.alpha_composite(keyed.crop(bbox).resize((nw, nh), Image.BOX).convert("RGBA"), (ox, oy))
                cov.paste(mask.crop(bbox).resize((nw, nh), Image.BOX), (ox, oy))
            rp, vp = rgba.load(), cov.load()
            for y in range(PX):
                for x in range(PX):
                    if vp[x, y] < COV_MIN:
                        rp[x, y] = (255, 0, 255, 0)
            if name in FULL_BLEED_TERRAIN:
                # Art-review fixes: kill the dark bottom-row band, then fill
                # keyed-out edge transparency, before the tile is emitted.
                rgba = fill_edge_transparency(fix_terrain_seam(rgba))
            elif name in EDGE_FILL_TERRAIN:
                # Seam step skipped on purpose: fix_terrain_seam eats the
                # wall's legitimate dark face (row 15 luma 62.6 < 0.82 *
                # median). Edge-fill alone -> 0 transparent px, tiles
                # seamlessly.
                rgba = fill_edge_transparency(rgba)
            out[name] = rgba
    # floor1: horizontal flip of floor0 -> a second speckle variant.
    out["floor1"] = out["floor0"].transpose(Image.FLIP_LEFT_RIGHT)
    # Water ripples: the source arcs are 1-3px at 640px and cannot survive the
    # 40:1 BOX downscale (built tile had 0 white px). Stamp 1px white arcs at
    # 16x16 post-build, only onto blue water pixels — see stamp_ripples.py.
    # Asserts 18 <= white px <= 30 (ART-STYLE.md §7 foam budget: white ≤ 12%).
    out["water"] = stamp_ripples(out["water"])
    return out


def luma(rgb):
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def nearest(rgb, choices):
    return min(choices, key=lambda c: (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2)


def hsv_sat(rgb):
    return colorsys.rgb_to_hsv(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)[1]


def is_moss_detail(rgb):
    """Authored saturated detail inside tintable sprites (moss tufts, lichen).

    These pixels bypass the tintable gray ramp (REGION_TINTS flat-replaces
    F/f/W/w, which would mute them) and go to the shared quantized pool
    instead, preserving the sheet's full-saturation moss at build size.
    """
    return hsv_sat(rgb) >= MOSS_SAT_MIN and luma(rgb) >= MOSS_LUMA_MIN


def median_cut(pixels, target):
    boxes = [pixels]
    while len(boxes) < target:
        # Split the box with the largest channel range.
        def spread(b):
            rs = [p[0] for p in b]; gs = [p[1] for p in b]; bs = [p[2] for p in b]
            return max(max(rs) - min(rs), max(gs) - min(gs), max(bs) - min(bs))
        i = max(range(len(boxes)), key=lambda k: spread(boxes[k]) if len(boxes[k]) > 1 else -1)
        box = boxes[i]
        if len(box) < 2:
            break
        rs = [p[0] for p in box]; gs = [p[1] for p in box]; bs = [p[2] for p in box]
        spans = [max(rs) - min(rs), max(gs) - min(gs), max(bs) - min(bs)]
        ch = spans.index(max(spans))
        box = sorted(box, key=lambda p: p[ch])
        boxes[i] = box[: len(box) // 2]
        boxes.append(box[len(box) // 2:])
    out = []
    for b in boxes:
        n = len(b)
        out.append(tuple(sum(p[c] for p in b) // n for c in range(3)))
    return out


def quantize(sprites, fixed_centers=None):
    """Return (palette: char->hex, rows: name->[16 strings]).

    fixed_centers: optional [(char, (r,g,b)), ...] to quantize against an
    EXISTING palette instead of median-cutting a new one. Used for stable
    re-emission after art fixes: sprites whose source art didn't change come
    out bit-identical, so fixes can't silently shift the whole atlas (same
    rationale as scripts/add_sprites.py's additive merge).
    """
    # Gather quantize pool: non-transparent, non-outline pixels of non-tintable sprites,
    # plus the saturated moss/detail pixels of tintable sprites (they bypass
    # the gray ramp via is_moss_detail, so they must drive palette centers).
    # Magenta-tinted shadow pixels are excluded from the POOL (they still get
    # rendered, mapped to the nearest center) so they don't waste palette
    # slots on dark purples at the expense of clean grays.
    pool = []
    for name, img in sprites.items():
        for p in img.getdata():
            if p[3] < 128 or is_transparent(p[:3]):
                continue
            if luma(p[:3]) < OUTLINE_LUMA:
                continue
            r, g, b = p[:3]
            if r > 90 and b > 90 and r > g + 40 and b > g + 40:
                continue  # magenta-tinted shadow, not a palette driver
            if name in TINTABLE and not is_moss_detail(p[:3]):
                continue
            pool.append(p[:3])
    if fixed_centers is not None:
        centers = [c for _, c in fixed_centers]
        new_chars = [ch for ch, _ in fixed_centers]
    else:
        centers = median_cut(pool, 30)
        new_chars = CHAR_POOL[: len(centers)]
    assert len(new_chars) == len(centers), "palette char pool exhausted"
    center_hex = {ch: "#%02x%02x%02x" % c for ch, c in zip(new_chars, centers)}
    center_rgbs = list(zip(new_chars, centers))

    def pixel_char(p, name, y):
        if p[3] < 128 or is_transparent(p[:3]):
            return "."
        rgb = p[:3]
        if luma(rgb) < OUTLINE_LUMA:
            return "k"
        if name in ("water", "floor0", "grass", "trap_revealed") and luma(rgb) > 225:
            # stamp_ripples() paints pure-white ripple arcs post-build, and
            # the pre-stamp tile has no pixels above luma ~202, so anything
            # this bright is a stamped ripple or authored near-white detail
            # (flower dots on the meadow tiles, glint teeth on the trap).
            # Keep it bit-exact white via 'H' (glass sparkle #ffffff): such
            # pixels are too few to earn their own median-cut box and would
            # otherwise fold into a light-tan center, failing the ART-STYLE.md
            # §7 foam budget (white ≤ 12% of the water tile).
            return "H"
        if name in TINTABLE:
            if is_moss_detail(rgb):
                # Saturated authored detail (moss/lichen) bypasses the
                # tintable gray ramp into the shared quantized pool.
                ch, _ = min(center_rgbs, key=lambda kc: (rgb[0] - kc[1][0]) ** 2 + (rgb[1] - kc[1][1]) ** 2 + (rgb[2] - kc[1][2]) ** 2)
                return ch
            ch, _ = min(BASE_GRAYS.items(),
                        key=lambda kv: (rgb[0] - kv[1][0]) ** 2 + (rgb[1] - kv[1][1]) ** 2 + (rgb[2] - kv[1][2]) ** 2)
            if name == "wall" and ch == "W" and y < 5 and luma(rgb) >= 80:
                # The wall's top-cap highlight pixels land on 'W' (face) by
                # nearest-gray, leaving the 'w' (wall highlight) slot of
                # REGION_TINTS dead. Promote top-cap pixels brighter than
                # the W/w midpoint to 'w' so the wall actually uses its
                # highlight char, per ART-STYLE.md ("top cap lighter").
                # In sewers tint this is a subtle lightening of the cap;
                # the tint table shape stays intact.
                return "w"
            return ch
        ch, _ = min(center_rgbs, key=lambda kc: (rgb[0] - kc[1][0]) ** 2 + (rgb[1] - kc[1][1]) ** 2 + (rgb[2] - kc[1][2]) ** 2)
        return ch

    rows = {}
    for name, img in sprites.items():
        data = list(img.getdata())
        lines = []
        for y in range(PX):
            lines.append("".join(pixel_char(data[y * PX + x], name, y) for x in range(PX)))
        rows[name] = lines
    char_luma = {}
    for ch, (_desc, hexv) in KNOWN_PALETTE.items():
        if hexv is not None:
            char_luma[ch] = luma((int(hexv[1:3], 16), int(hexv[3:5], 16), int(hexv[5:7], 16)))
    for ch, hexv in center_hex.items():
        char_luma[ch] = luma((int(hexv[1:3], 16), int(hexv[3:5], 16), int(hexv[5:7], 16)))
    rows = touchup_rows(rows, char_luma)
    # 'hero' stays as the warrior alias for backward compatibility.
    rows["hero"] = rows["hero_warrior"]
    return center_hex, rows


def _border_background(rows):
    """Set of (x, y) transparent pixels connected to the image border."""
    seen = set()
    stack = [(x, y) for y in range(PX) for x in range(PX)
             if rows[y][x] == "." and (x in (0, PX - 1) or y in (0, PX - 1))]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or rows[y][x] != ".":
            continue
        seen.add((x, y))
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < PX and 0 <= ny < PX:
                stack.append((nx, ny))
    return seen


def _set(rows, name, x, y, ch):
    rows[name][y] = rows[name][y][:x] + ch + rows[name][y][x + 1:]


def touchup_rows(rows, char_luma):
    """Char-level art-review fixes on the final 16x16 atlas (coordinates are
    atlas coords). Every fix asserts its precondition: if a future pipeline
    change moves the pixels, the build fails loudly instead of mis-editing.
    char_luma maps palette char -> luma, used to spare gloss highlights.

    v3 note: the v1 crab-floater, thief-stray and thief rim-light touchups do
    not apply to the v3 sheets either — verified on the built v3 art:
    mob_crab is a single connected component (no floaters), mob_thief is a
    single connected component (no stray singletons), and the v1 rim-light
    coords land on different pixels. They were dropped rather than
    mis-edited; the sheets themselves are the approved art.
    """
    # mob_goo: add the 1px warm-dark 'k' silhouette outline every other entity
    # has (it washes out on light floors without one). Sprites that already
    # carry 'k' in the built art (v3 potion_strength) are skipped.
    # Only outer-silhouette pixels (adjacent to border-connected
    # background); near-white gloss highlights are spared as bright-rim
    # breaks per ART-STYLE.md.
    for name in ("mob_goo", "potion_strength"):
        if "k" in "".join(rows[name]):
            continue  # already outlined in the source art
        bg = _border_background(rows[name])
        for y in range(PX):
            for x in range(PX):
                ch = rows[name][y][x]
                if ch == "." or char_luma.get(ch, 0) > 160:
                    continue
                if any((nx, ny) in bg
                       for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                       if 0 <= nx < PX and 0 <= ny < PX):
                    _set(rows, name, x, y, "k")

    # door_secret: normalize the sheet's door tell to a single 1px 'k' seam,
    # stamped post-quantize on the secret-door tile only. The source art's
    # tell (door-knocker remnant) quantizes to a 2px 'k' blob at (6..7, 12)
    # — too blobby next to the wall tile. Clear it to 'W', then stamp a
    # deliberate 1px vertical 'k' seam at col 5 (left edge of the doorway
    # slot zone, dirt face only; the grass cap stays untouched). Everything
    # else on the tile stays wall-identical so it blends at 3x.
    ds = rows["door_secret"]
    assert ds[12][6] == "k" and ds[12][7] == "k", \
        f"door_secret tell moved: row 12 = {ds[12]!r}"
    _set(rows, "door_secret", 6, 12, "W")
    _set(rows, "door_secret", 7, 12, "W")
    for y in range(6, 15):
        assert rows["door_secret"][y][5] in "Ww", \
            f"door_secret seam target not wall ramp: (5,{y})={rows['door_secret'][y][5]!r}"
        _set(rows, "door_secret", 5, y, "k")
    return rows


def used_chars(rows):
    s = set()
    for lines in rows.values():
        for ln in lines:
            s.update(ln)
    return s


def palette_block(entries, indent="  "):
    lines = []
    for ch, (desc, hexv) in entries.items():
        val = '"transparent"' if hexv is None else f'"{hexv}"'
        lines.append(f'{indent}"{ch}": {val}, // {desc}')
    return "\n".join(lines)


def sprite_block(name, lines):
    body = "\n".join(f"    '{ln}'," for ln in lines)
    return f"  {name}: [\n{body}\n  ],"


def emit_all(palette_hex, rows):
    merged = {**rows, **HAND_AUTHORED}
    used = used_chars(merged)
    pal_entries = {}
    for ch, (desc, hexv) in KNOWN_PALETTE.items():
        if ch in used:
            pal_entries[ch] = (desc, hexv)
    for ch, hexv in palette_hex.items():
        if ch in used:
            pal_entries[ch] = ("quantized", hexv)
    header = """/**
 * Storybook Dungeon pixel-art sprites for the Pixel Dungeon v2 browser rebuild.
 * Generated from original AI-assisted sprite sheets (art-src/) via
 * scripts/build_sprites.py: magenta-keyed, cropped, downscaled to 16x16 and
 * palette-quantized. All art is original to this project — nothing is copied
 * from any game. Floor/wall/secret-door stay on the tintable gray ramp
 * (F,f,W,w) so REGION_TINTS renders the 5 regional tilesets.
 *
 * scroll_upgrade is hand-authored in the same 16x16 char-art idiom (a
 * parchment roll with a golden up-arrow rune, reusing the shared palette)
 * rather than pipeline-generated; see HAND_AUTHORED in build_sprites.py.
 *
 * Format: each sprite is 16 strings of 16 chars; each char maps to PALETTE.
 * '.' is transparent.
 */
export const ART_PX = 16;

export const PALETTE: Record<string, string> = {
"""
    body = "\n\n".join(sprite_block(n, merged[n]) for n in SPRITE_ORDER + list(HAND_AUTHORED))
    tints = """};

/**
 * Per-region overrides for the floor/wall chars ('F', 'f', 'W', 'w') so the
 * same sprite patterns render as 5 tilesets. Only the sewers region is used
 * in Milestone 1; the other four are placeholders for later regions.
 */
export const REGION_TINTS: Record<string, Record<string, string>> = {
  sewers: {
    F: '#5da02e', // reference grass base (ART-STYLE.md §5, v3)
    f: '#4b7e2a', // grass clump shade
    W: '#6e4c2c', // dirt-brown wall face, darker than floor so walls read
    w: '#74b53a', // sunlit grass cap, brightest terrain
  },
  prison: {
    F: '#6a7488', // cold blue-gray floor base
    f: '#565e72', // cold floor speckle
    W: '#424a5e', // blue-gray brick face
    w: '#5c6680', // brick highlight
  },
  caves: {
    F: '#6b5a48', // brown rough rock base
    f: '#57493a', // rock speckle
    W: '#453a2e', // dark rock face
    w: '#5f5142', // rock highlight
  },
  city: {
    F: '#9aa0ae', // pale marble base
    f: '#848a98', // marble speckle
    W: '#6e7488', // worked stone face
    w: '#8b91a3', // worked stone highlight
  },
  halls: {
    F: '#4a3f4a', // dark obsidian, faint red tint
    f: '#3a3138', // obsidian speckle
    W: '#2e2430', // dark obsidian face
    w: '#4a3a44', // faint red highlight
  },
};

/**
 * Validates the atlas: 16 rows x 16 cols, every char in the palette.
 * Returns a list of problems (empty = OK). Used by the smoke test.
 */
export function validateSprites(): string[] {
  const errors: string[] = [];
  for (const [name, rows] of Object.entries(SPRITES)) {
    if (rows.length !== ART_PX) errors.push(`${name}: ${rows.length} rows, expected ${ART_PX}`);
    rows.forEach((row, y) => {
      if (row.length !== ART_PX) {
        errors.push(`${name} row ${y}: ${row.length} chars, expected ${ART_PX}`);
      }
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (!(ch in PALETTE)) errors.push(`${name} (${x},${y}): unknown palette char '${ch}'`);
      }
    });
  }
  return errors;
}
"""
    return header + palette_block(pal_entries) + "\n};\n\nexport const SPRITES: Record<string, string[]> = {\n" + body + "\n" + tints


def main():
    sprites = extract_sprites()
    print(f"extracted {len(sprites)} sprites")
    palette_hex, rows = quantize(sprites)
    print(f"quantized palette: {len(palette_hex)} new colors")
    with open(OUT_MAIN, "w") as f:
        f.write(emit_all(palette_hex, rows))
    print("wrote", OUT_MAIN)


if __name__ == "__main__":
    main()
