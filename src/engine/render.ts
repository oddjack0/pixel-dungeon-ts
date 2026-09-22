import { ART_PX, PALETTE, REGION_TINTS, SPRITES } from '../assets/sprites.js';
import { Terrain, regionForDepth, type Region } from '../core/grid.js';
import type { Level } from '../dungeon/level.js';
import type { Game } from './loop.js';

/** Rendered tile size: 3x of the 16px art (SPEC). */
export const TILE_PX = 48;

/** Chars with per-region overrides in REGION_TINTS. */
const TINTABLE = new Set(['F', 'f', 'W', 'w']);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Synthesized magenta/black "missing sprite" marker (16x16 char grid).
 * Used when a sprite key is absent from the atlas — never touches art files.
 */
function missingSpriteRows(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < ART_PX; y++) {
    let row = '';
    for (let x = 0; x < ART_PX; x++) row += (x + y) % 2 === 0 ? 'M' : 'k';
    rows.push(row);
  }
  return rows;
}

/**
 * Canvas 2D renderer + camera. Draws tiles from the sprite atlas
 * (SPEC contract §2 format), entities, FOV/explored dimming.
 * UI screens (HUD, inventory, minimap) are the UI designer's; this only
 * paints the dungeon view.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Prerendered 48px sprites: key `${region}:${name}` for tinted tiles. */
  private readonly cache = new Map<string, HTMLCanvasElement>();
  /** Camera top-left in tile units (fractional for smooth centering). */
  private camX = 0;
  private camY = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer: 2d context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  /** CSS-pixel size of the drawing surface. */
  private viewSize(): { w: number; h: number } {
    return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr };
  }

  /** Convert a CSS-pixel screen point to a tile coordinate. */
  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = sx - rect.left;
    const py = sy - rect.top;
    return {
      x: Math.floor(this.camX + px / TILE_PX),
      y: Math.floor(this.camY + py / TILE_PX),
    };
  }

  /** CSS-pixel center of a tile (inverse of screenToTile; for UI overlays). */
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    return {
      x: (tx + 0.5 - this.camX) * TILE_PX,
      y: (ty + 0.5 - this.camY) * TILE_PX,
    };
  }

  render(game: Game): void {
    const { ctx } = this;
    const { w: vw, h: vh } = this.viewSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const level = game.level;
    this.updateCamera(game, vw, vh);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);

    const x0 = Math.max(0, Math.floor(this.camX));
    const y0 = Math.max(0, Math.floor(this.camY));
    const x1 = Math.min(level.w - 1, Math.ceil(this.camX + vw / TILE_PX));
    const y1 = Math.min(level.h - 1, Math.ceil(this.camY + vh / TILE_PX));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = level.idx(x, y);
        const dx = (x - this.camX) * TILE_PX;
        const dy = (y - this.camY) * TILE_PX;
        if (!level.explored[i]) {
          ctx.fillStyle = '#000';
          ctx.fillRect(dx, dy, TILE_PX, TILE_PX);
          continue;
        }
        const seen = level.visible[i] === 1;
        ctx.globalAlpha = seen ? 1 : 0.45;
        const sprite = this.tileSprite(level, x, y);
        ctx.drawImage(sprite, dx, dy, TILE_PX, TILE_PX);
        ctx.globalAlpha = 1;
      }
    }

    // Items (shown on explored tiles, dimmed outside FOV).
    for (const item of level.items) {
      const i = item.pos;
      if (!level.explored[i]) continue;
      const x = i % level.w;
      const y = Math.floor(i / level.w);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      ctx.globalAlpha = level.visible[i] ? 1 : 0.45;
      ctx.drawImage(
        this.entitySprite(item.sprite),
        (x - this.camX) * TILE_PX,
        (y - this.camY) * TILE_PX,
        TILE_PX,
        TILE_PX,
      );
      ctx.globalAlpha = 1;
    }

    // Mobs (only when actually visible).
    for (const m of game.mobs) {
      const i = level.idx(m.x, m.y);
      if (!level.visible[i]) continue;
      ctx.drawImage(
        this.entitySprite(m.sprite),
        (m.x - this.camX) * TILE_PX,
        (m.y - this.camY) * TILE_PX,
        TILE_PX,
        TILE_PX,
      );
    }

    // Tap-to-move path preview.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const p of game.currentPath) {
      const i = level.idx(p.x, p.y);
      if (!level.visible[i]) continue;
      const cx = (p.x - this.camX) * TILE_PX + TILE_PX / 2;
      const cy = (p.y - this.camY) * TILE_PX + TILE_PX / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hero.
    const hx = (game.hero.x - this.camX) * TILE_PX;
    const hy = (game.hero.y - this.camY) * TILE_PX;
    ctx.drawImage(this.entitySprite(game.hero.sprite), hx, hy, TILE_PX, TILE_PX);
  }

  private updateCamera(game: Game, vw: number, vh: number): void {
    const level = game.level;
    const viewTilesW = vw / TILE_PX;
    const viewTilesH = vh / TILE_PX;
    if (level.w <= viewTilesW) {
      this.camX = (level.w - viewTilesW) / 2; // center small levels
    } else {
      this.camX = Math.min(Math.max(game.hero.x + 0.5 - viewTilesW / 2, 0), level.w - viewTilesW);
    }
    if (level.h <= viewTilesH) {
      this.camY = (level.h - viewTilesH) / 2;
    } else {
      this.camY = Math.min(Math.max(game.hero.y + 0.5 - viewTilesH / 2, 0), level.h - viewTilesH);
    }
  }

  /** Sprite for a terrain cell (hidden traps/doors render as their cover). */
  private tileSprite(level: Level, x: number, y: number): HTMLCanvasElement {
    const t = level.get(x, y);
    const region = regionForDepth(level.depth);
    let name: string;
    switch (t) {
      case Terrain.WALL:
      case Terrain.BARRICADE:
        name = 'wall';
        break;
      case Terrain.DOOR_SECRET:
        name = 'door_secret';
        break;
      case Terrain.FLOOR:
      case Terrain.EMBERS:
      case Terrain.WALKWAY:
      case Terrain.TRAP_INACTIVE:
        name = (x * 7 + y * 13) % 3 === 0 ? 'floor1' : 'floor0';
        break;
      case Terrain.DOOR:
        name = 'door';
        break;
      case Terrain.DOOR_LOCKED:
        name = 'door_locked';
        break;
      case Terrain.ENTRANCE:
        name = 'stairs_up';
        break;
      case Terrain.EXIT:
      case Terrain.EXIT_LOCKED:
        name = 'stairs_down';
        break;
      case Terrain.WATER:
        name = 'water';
        break;
      case Terrain.GRASS:
      case Terrain.HIGH_GRASS:
        name = 'grass';
        break;
      case Terrain.CHASM:
        name = 'chasm';
        break;
      case Terrain.WELL:
        name = 'well';
        break;
      case Terrain.TRAP_TOXIC:
      case Terrain.TRAP_FIRE:
      case Terrain.TRAP_PARALYTIC:
      case Terrain.TRAP_POISON:
      case Terrain.TRAP_ALARM:
      case Terrain.TRAP_LIGHTNING:
      case Terrain.TRAP_GRIPPING:
      case Terrain.TRAP_SUMMONING:
        name = 'trap_revealed';
        break;
      default:
        // Hidden trap variants render as floor (their cover).
        name = (x * 7 + y * 13) % 3 === 0 ? 'floor1' : 'floor0';
    }
    return this.getSprite(name, region);
  }

  /** Non-tinted sprite for entities (hero, mobs, items). */
  entitySprite(name: string): HTMLCanvasElement {
    return this.getSprite(name, undefined);
  }

  private getSprite(name: string, region: Region | undefined): HTMLCanvasElement {
    const key = `${region ?? '-'}:${name}`;
    let c = this.cache.get(key);
    if (!c) {
      c = this.prerender(name, region);
      this.cache.set(key, c);
    }
    return c;
  }

  private prerender(name: string, region: Region | undefined): HTMLCanvasElement {
    const rows = SPRITES[name] ?? missingSpriteRows();
    // Per-region char overrides (art director's REGION_TINTS table).
    const overrides = region ? REGION_TINTS[region] : undefined;
    const img = document.createElement('canvas');
    img.width = ART_PX;
    img.height = ART_PX;
    const g = img.getContext('2d')!;
    const data = g.createImageData(ART_PX, ART_PX);
    for (let y = 0; y < ART_PX; y++) {
      const row = rows[y]!;
      for (let x = 0; x < ART_PX; x++) {
        const ch = row[x]!;
        const o = (y * ART_PX + x) * 4;
        if (ch === '.') {
          data.data[o + 3] = 0;
          continue;
        }
        let hex = PALETTE[ch] ?? '#ff00ff';
        if (overrides && TINTABLE.has(ch)) hex = overrides[ch] ?? hex;
        const rgb = hexToRgb(hex);
        data.data[o] = rgb[0];
        data.data[o + 1] = rgb[1];
        data.data[o + 2] = rgb[2];
        data.data[o + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    // Scale up to render size with smoothing off (crisp pixels).
    const big = document.createElement('canvas');
    big.width = TILE_PX;
    big.height = TILE_PX;
    const bg = big.getContext('2d')!;
    bg.imageSmoothingEnabled = false;
    bg.drawImage(img, 0, 0, TILE_PX, TILE_PX);
    return big;
  }
}
