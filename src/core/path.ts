import type { Grid, XY } from './grid.js';

/**
 * A* over the tile grid, 8-directional, Chebyshev heuristic.
 * `passable` decides walkability (walls, closed doors, other actors...).
 * Returns the tile list from start (exclusive) to target (inclusive), or null.
 * Deterministic: ties break by insertion order.
 */
export function findPath(
  grid: Grid,
  passable: (x: number, y: number) => boolean,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxExpand = 8192,
): XY[] | null {
  if (!grid.inBounds(tx, ty) || !passable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];

  const start = grid.idx(sx, sy);
  const target = grid.idx(tx, ty);
  const open: number[] = [start];
  const came = new Map<number, number>();
  const g = new Map<number, number>([[start, 0]]);
  const closed = new Set<number>();

  const h = (i: number): number => {
    const p = grid.xy(i);
    return Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty));
  };
  const f = (i: number): number => (g.get(i) ?? Infinity) + h(i);

  let expanded = 0;
  while (open.length > 0 && expanded++ < maxExpand) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (f(open[i]!) < f(open[bi]!)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    if (cur === target) {
      const path: XY[] = [];
      let c: number | undefined = cur;
      while (c !== undefined && c !== start) {
        path.push(grid.xy(c));
        c = came.get(c);
      }
      path.reverse();
      return path;
    }
    closed.add(cur);
    const p = grid.xy(cur);
    for (const n of grid.neighbors8(p.x, p.y)) {
      if (!passable(n.x, n.y)) continue;
      const ni = grid.idx(n.x, n.y);
      if (closed.has(ni)) continue;
      const ng = (g.get(cur) ?? Infinity) + 1;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur);
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return null;
}
