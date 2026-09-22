/**
 * Minimap (M key): explored-terrain overview in the storybook palette.
 *
 * `computeMinimap` is pure (headless-testable): it folds the level's
 * explored/visible memory into per-cell codes. `draw` paints it with
 * hero/mobs/stairs markers.
 */
import { Terrain } from '../core/grid.js';
import type { Level } from '../dungeon/level.js';
import type { Game } from '../engine/loop.js';
import { drawPanel, UI, type Rect, type View } from './palette.js';

/** Per-cell minimap codes. */
export const MM = {
  unseen: 0,
  floor: 1,
  wall: 2,
  water: 3,
  door: 4,
  stairsUp: 5,
  stairsDown: 6,
  grass: 7,
  chasm: 8,
  hero: 9,
  mob: 10,
  item: 11,
} as const;

export interface MinimapData {
  w: number;
  h: number;
  cells: Uint8Array; // MM codes
}

/** Pure fold of level memory -> minimap codes. Never crashes on any Level. */
export function computeMinimap(level: Level, mobs: { x: number; y: number; hostile: boolean }[]): MinimapData {
  const { w, h } = level;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = level.idx(x, y);
      if (!level.explored[i]) continue;
      const t = level.get(x, y);
      let c: number = MM.floor;
      switch (t) {
        case Terrain.WALL:
        case Terrain.BARRICADE:
          c = MM.wall;
          break;
        case Terrain.WATER:
          c = MM.water;
          break;
        case Terrain.DOOR:
        case Terrain.DOOR_SECRET:
        case Terrain.DOOR_LOCKED:
          c = MM.door;
          break;
        case Terrain.ENTRANCE:
          c = MM.stairsUp;
          break;
        case Terrain.EXIT:
        case Terrain.EXIT_LOCKED:
          c = MM.stairsDown;
          break;
        case Terrain.GRASS:
        case Terrain.HIGH_GRASS:
          c = MM.grass;
          break;
        case Terrain.CHASM:
          c = MM.chasm;
          break;
        case Terrain.TRAP_TOXIC:
        case Terrain.TRAP_FIRE:
        case Terrain.TRAP_PARALYTIC:
        case Terrain.TRAP_POISON:
        case Terrain.TRAP_ALARM:
        case Terrain.TRAP_LIGHTNING:
        case Terrain.TRAP_GRIPPING:
        case Terrain.TRAP_SUMMONING:
          c = MM.floor; // traps stay hidden on the map until seen
          break;
        default:
          c = MM.floor;
      }
      cells[i] = c;
    }
  }
  for (const it of level.items) {
    if (level.explored[it.pos]) cells[it.pos] = MM.item;
  }
  for (const m of mobs) {
    if (!level.inBounds(m.x, m.y)) continue;
    const i = level.idx(m.x, m.y);
    if (level.explored[i]) cells[i] = m.hostile ? MM.mob : MM.floor;
  }
  return { w, h, cells };
}

/** Storybook minimap colors (saturated, hue-shifted — no gray ramps). */
const MM_COLORS: Record<number, string> = {
  [MM.floor]: '#7a8a5f', // mossy stone green
  [MM.wall]: '#4a4258', // cool purple-gray stone
  [MM.water]: '#2f8fa8', // saturated teal
  [MM.door]: '#b07a3f', // warm wood
  [MM.stairsUp]: '#ffd75e',
  [MM.stairsDown]: '#ffd75e',
  [MM.grass]: '#58a03d',
  [MM.chasm]: '#0a0a10',
  [MM.hero]: '#ffffff',
  [MM.mob]: '#e04030', // hostile mobs shout red
  [MM.item]: '#e8e3d0',
};

export class Minimap {
  open = false;

  toggle(): void {
    this.open = !this.open;
  }

  /** Panel rect for the current viewport (pure layout). */
  layout(view: View, level: Level): Rect {
    const maxW = Math.min(view.w - 24, 240);
    const maxH = Math.min(view.h * 0.5, 260);
    const scale = Math.max(2, Math.min(maxW / level.w, maxH / level.h));
    const w = Math.ceil(level.w * scale);
    const h = Math.ceil(level.h * scale);
    return { x: view.w - w - 12, y: 72, w, h };
  }

  draw(ctx: CanvasRenderingContext2D, game: Game, view: View, nowMs: number): void {
    if (!this.open) return;
    const level = game.level;
    const data = computeMinimap(level, game.mobs);
    const panel = this.layout(view, level);
    const pad = 6;
    drawPanel(ctx, { x: panel.x - pad, y: panel.y - pad, w: panel.w + pad * 2, h: panel.h + pad * 2 }, 10);

    const sx = panel.w / level.w;
    const sy = panel.h / level.h;
    for (let y = 0; y < data.h; y++) {
      for (let x = 0; x < data.w; x++) {
        const c = data.cells[level.idx(x, y)];
        if (c === MM.unseen) continue;
        ctx.fillStyle = MM_COLORS[c] ?? MM_COLORS[MM.floor];
        ctx.fillRect(panel.x + x * sx, panel.y + y * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }

    // Hero marker: pulsing white dot with ink ring.
    const hx = panel.x + (game.hero.x + 0.5) * sx;
    const hy = panel.y + (game.hero.y + 0.5) * sy;
    const pulse = 2.5 + Math.sin(nowMs / 280) * 0.8;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(2.5, pulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Stairs markers: gold chevrons (drawn over the cell color).
    for (const [cell, up] of [
      [level.stairsUp, true],
      [level.stairsDown, false],
    ] as const) {
      if (cell < 0) continue;
      const x = cell % level.w;
      const y = Math.floor(cell / level.w);
      if (!level.explored[cell]) continue;
      const cx = panel.x + (x + 0.5) * sx;
      const cy = panel.y + (y + 0.5) * sy;
      ctx.fillStyle = UI.gold;
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (up) {
        ctx.moveTo(cx - 3, cy + 2);
        ctx.lineTo(cx, cy - 2);
        ctx.lineTo(cx + 3, cy + 2);
      } else {
        ctx.moveTo(cx - 3, cy - 2);
        ctx.lineTo(cx, cy + 2);
        ctx.lineTo(cx + 3, cy - 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}
