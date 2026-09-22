#!/usr/bin/env python3
"""
Post-build fix for the v3 water tile: stamp white foam accents at 16x16.

Why: the source art's ripple arcs are 1-3px at 640px; the pipeline's 40:1 BOX
downscale averages them into the blue, leaving ZERO white pixels in the built
tile (measured pre-quantize max luma ~202, 0 px > 200). ART-STYLE.md v3
section 7 treats foam as an accent on a blue fill, not a wash: the struck v2
"ripples >= 20%" gate is what manufactured ice. v3 budget: white foam <= 12%
of the tile.

Usage (after build_sprites emits 16x16 RGBA for "water", before quantize):
    from stamp_ripples import stamp_ripples
    sprites["water"] = stamp_ripples(sprites["water"])

The stamp draws 1px #ffffff arcs (PIL, width=1) ONLY onto blue water pixels
(blue channel dominant), never onto the mossy rim:
  - cluster A (top):    arc r=6 around (4,5), angles 180-360
  - cluster B (bottom): arc r=4 around (11,11), angles 0-180
  - 1 four-point sparkle at (7,1)
Result on the v3 build: 24 white px = 9.4% of the tile (budget: <= 12%).
Re-verify the count after any pipeline change: assert 18 <= n <= 30.
"""
from PIL import Image, ImageDraw

WHITE = (255, 255, 255, 255)


def _is_water(px):
    r, g, b = px[0], px[1], px[2]
    return px[3] > 128 and b > 110 and b > r + 20


def stamp_ripples(rgba16):
    """rgba16: 16x16 RGBA PIL image of the water tile. Returns new image."""
    assert rgba16.size == (16, 16), rgba16.size
    out = rgba16.copy()
    ov = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)

    def arc_c(cx, cy, rad, a0, a1):
        dr.arc([cx - rad, cy - rad, cx + rad, cy + rad],
               start=a0, end=a1, fill=WHITE, width=1)

    arc_c(4, 5, 6, 180, 360)     # cluster A, top
    arc_c(11, 11, 4, 0, 180)     # cluster B, bottom
    for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:  # sparkle at (7,1)
        dr.point((7 + dx, 1 + dy), fill=WHITE)

    src, mask, dst = rgba16.load(), ov.load(), out.load()
    n = 0
    for y in range(16):
        for x in range(16):
            if mask[x, y][3] > 128 and _is_water(src[x, y]):
                dst[x, y] = WHITE
                n += 1
    assert 18 <= n <= 30, f"ripple coverage {n}/256 = {n/256*100:.1f}% outside 18-30 gate"
    return out


if __name__ == "__main__":
    print("import stamp_ripples and call stamp_ripples(rgba16)")
