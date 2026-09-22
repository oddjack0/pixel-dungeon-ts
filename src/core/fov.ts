import type { Grid } from './grid.js';

/**
 * Field of view via recursive shadowcasting (8 octants).
 * A cell is visible when some unobstructed sight cone reaches it; opaque
 * cells themselves (wall faces, secret doors) are marked visible so the
 * player sees the wall that blocks them.
 *
 * Signature matches the oracle's line-of-sight version so callers
 * (Level.updateFov) are unaffected by the algorithm swap.
 */
export function computeFov(
  grid: Grid,
  opaque: (x: number, y: number) => boolean,
  cx: number,
  cy: number,
  radius: number,
  out: Uint8Array,
): void {
  out.fill(0);
  if (!grid.inBounds(cx, cy)) return;
  out[grid.idx(cx, cy)] = 1;

  // 8 octants as (xx, xy, yx, yy) transforms.
  const transforms: ReadonlyArray<readonly [number, number, number, number]> = [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, -1, 1, 0],
    [-1, 0, 0, 1],
    [-1, 0, 0, -1],
    [0, -1, -1, 0],
    [0, 1, -1, 0],
    [1, 0, 0, -1],
  ];
  for (const t of transforms) {
    castLight(grid, opaque, cx, cy, radius, 1, 1.0, 0.0, t[0], t[1], t[2], t[3], out);
  }
}

function castLight(
  grid: Grid,
  opaque: (x: number, y: number) => boolean,
  cx: number,
  cy: number,
  radius: number,
  row: number,
  startSlope: number,
  endSlope: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  out: Uint8Array,
): void {
  if (startSlope < endSlope) return;
  let newStart = startSlope;

  for (let j = row; j <= radius; j++) {
    let blocked = false;
    for (let dx = -j, dy = -j; dx <= 0; dx++) {
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (startSlope < rSlope) continue;
      if (endSlope > lSlope) break;

      const sax = dx * xx + dy * xy;
      const say = dx * yx + dy * yy;
      const ax = cx + sax;
      const ay = cy + say;
      if (ax < 0 || ay < 0 || ax >= grid.w || ay >= grid.h) continue;
      // Chebyshev radius (matches the oracle's line-of-sight behavior).
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;

      out[grid.idx(ax, ay)] = 1;
      const isOpaque = opaque(ax, ay);
      if (blocked) {
        if (isOpaque) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        startSlope = newStart;
      } else if (isOpaque && j < radius) {
        blocked = true;
        castLight(grid, opaque, cx, cy, radius, j + 1, startSlope, lSlope, xx, xy, yx, yy, out);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}
