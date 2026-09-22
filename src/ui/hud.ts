/**
 * HUD: top status bar, message log, quick-action slots.
 *
 * Reads the live Game every frame (no duplicated state). Layout is computed
 * from the viewport so phone-portrait (360–430px wide) stays usable:
 * tap targets are >= 44px, text stays >= 11px.
 */
import type { Game } from '../engine/loop.js';
import { regionForDepth } from '../core/grid.js';
import { buffLabel, readHeroView } from './heroView.js';
import { readInventory } from './inventory.js';
import {
  drawBar,
  drawCoin,
  drawDrumstick,
  drawPanel,
  roundRect,
  UI,
  type Rect,
  type SpriteSource,
  type View,
} from './palette.js';

/** Fading message-log buffer. Pure logic — headless-testable. */
export interface FadedLine {
  text: string;
  alpha: number;
}

export class LogBuffer {
  private lines: { text: string; at: number }[] = [];
  private seen = 0;
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Lines the game log has gained since the last sync. */
  sync(log: string[]): string[] {
    const fresh = log.slice(this.seen);
    this.seen = log.length;
    const t = this.now();
    for (const text of fresh) this.lines.push({ text, at: t });
    if (this.lines.length > 40) this.lines.splice(0, this.lines.length - 40);
    return fresh;
  }

  /** Last `n` lines with fade alpha (1 = fresh, 0.22 = old). */
  visible(n: number): FadedLine[] {
    const t = this.now();
    return this.lines.slice(-n).map((l) => {
      const age = (t - l.at) / 1000;
      return { text: l.text, alpha: Math.max(0.22, 1 - age / 9) };
    });
  }

  reset(): void {
    this.lines = [];
    this.seen = 0;
  }
}

export interface HudLayout {
  potionBtn: Rect;
  dartBtn: Rect;
  topBarH: number;
}

const SLOT = 56;

export class Hud {
  readonly logBuffer = new LogBuffer();

  /** Button rects for the UiManager's tap routing. */
  layout(view: View): HudLayout {
    const pad = 10;
    const dartBtn: Rect = { x: view.w - pad - SLOT, y: view.h - pad - SLOT, w: SLOT, h: SLOT };
    const potionBtn: Rect = { x: dartBtn.x - 8 - SLOT, y: view.h - pad - SLOT, w: SLOT, h: SLOT };
    return { potionBtn, dartBtn, topBarH: 64 };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    game: Game,
    sprites: SpriteSource,
    view: View,
    opts: { throwMode: boolean; now?: number } = { throwMode: false },
  ): void {
    const hv = readHeroView(game);
    const L = this.layout(view);
    this.drawTopBar(ctx, game, view, hv);
    this.drawLog(ctx, view);
    this.drawQuickSlots(ctx, game, sprites, view, L, opts.throwMode);
  }

  private drawTopBar(
    ctx: CanvasRenderingContext2D,
    game: Game,
    view: View,
    hv: ReturnType<typeof readHeroView>,
  ): void {
    // translucent dark strip so the bar reads over any tile
    ctx.fillStyle = 'rgba(10, 8, 14, 0.78)';
    ctx.fillRect(0, 0, view.w, 64);

    const barW = Math.min(210, view.w - 180);
    // HP
    const lowHp = hv.hp / hv.ht < 0.25;
    drawBar(
      ctx,
      { x: 8, y: 8, w: barW, h: 18 },
      hv.hp / hv.ht,
      lowHp ? UI.hpLow : UI.hp,
      UI.hpTrack,
      `${hv.hp}/${hv.ht}`,
      11,
    );
    // EXP
    drawBar(
      ctx,
      { x: 8, y: 31, w: barW, h: 10 },
      hv.exp / hv.maxExp,
      UI.xp,
      UI.xpTrack,
      '',
      9,
    );
    ctx.fillStyle = UI.textLight;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Lvl ${hv.lvl}  ${hv.exp}/${hv.maxExp} XP`, 8 + barW + 8, 36);

    // Depth + seed, right aligned
    const region = regionForDepth(game.level.depth);
    const regionName = region.charAt(0).toUpperCase() + region.slice(1);
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = UI.textLight;
    ctx.fillText(`Depth ${game.level.depth} · ${regionName}`, view.w - 8, 17);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#9a917e';
    ctx.fillText(`seed ${game.seed}`, view.w - 8, 34);
    ctx.textAlign = 'left';

    // Hunger badge
    const hx = 8 + barW + 8;
    if (hv.starving) {
      drawDrumstick(ctx, hx, 44, 16);
      ctx.fillStyle = UI.danger;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('Starving!', hx + 20, 52);
    } else if (hv.hungry) {
      drawDrumstick(ctx, hx, 44, 16);
      ctx.fillStyle = '#e8a33d';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('Hungry', hx + 20, 52);
    } else {
      ctx.globalAlpha = 0.45;
      drawDrumstick(ctx, hx, 44, 16);
      ctx.globalAlpha = 1;
    }

    // Gold
    const gx = view.w - 90;
    drawCoin(ctx, gx, 52, 8);
    ctx.fillStyle = UI.gold;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`${hv.gold}`, gx + 12, 52);

    // Buff badges
    let bx = 8;
    ctx.font = 'bold 10px system-ui, sans-serif';
    for (const b of hv.buffs) {
      if (b === 'hunger') continue;
      const label = buffLabel(b);
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = buffColor(b);
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 1.5;
      roundRect(ctx, { x: bx, y: 44, w, h: 16 }, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + w / 2, 52.5);
      ctx.textAlign = 'left';
      bx += w + 6;
      if (bx > view.w - 110) break;
    }
  }

  private drawLog(ctx: CanvasRenderingContext2D, view: View): void {
    const lines = this.logBuffer.visible(4);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const slotH = 18;
    const bottomY = view.h - SLOT - 22;
    lines.forEach((l, i) => {
      const y = bottomY - (lines.length - 1 - i) * slotH;
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = '#000';
      ctx.fillText(l.text, 9, y + 1);
      ctx.fillStyle = UI.log;
      ctx.fillText(l.text, 8, y);
    });
    ctx.globalAlpha = 1;
  }

  private drawQuickSlots(
    ctx: CanvasRenderingContext2D,
    game: Game,
    sprites: SpriteSource,
    view: View,
    L: HudLayout,
    throwMode: boolean,
  ): void {
    const items = readInventory(game);
    const potion = items.find((i) => i.kind === 'potion') ?? null;
    const darts = items.find((i) => i.kind === 'missile') ?? null;

    this.drawSlot(ctx, sprites, L.potionBtn, potion?.sprite ?? 'potion_red', potion ? 1 : 0, 'Drink', !potion);
    this.drawSlot(
      ctx,
      sprites,
      L.dartBtn,
      'dart',
      darts ? darts.qty : 0,
      throwMode ? 'Aim…' : 'Throw',
      !darts || darts.qty <= 0,
      throwMode,
    );
  }

  private drawSlot(
    ctx: CanvasRenderingContext2D,
    sprites: SpriteSource,
    r: Rect,
    sprite: string,
    qty: number,
    hint: string,
    dimmed: boolean,
    active = false,
  ): void {
    drawPanel(ctx, r, 12);
    if (active) {
      ctx.strokeStyle = UI.gold;
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
    ctx.globalAlpha = dimmed ? 0.35 : 1;
    try {
      ctx.drawImage(sprites.entitySprite(sprite), r.x + 8, r.y + 4, r.w - 16, r.w - 16);
    } catch {
      /* headless */
    }
    ctx.globalAlpha = 1;
    if (qty > 1) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.strokeText(`${qty}`, r.x + r.w - 5, r.y + r.h - 16);
      ctx.fillText(`${qty}`, r.x + r.w - 5, r.y + r.h - 16);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = UI.textDim;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hint, r.x + r.w / 2, r.y + r.h - 5);
    ctx.textAlign = 'left';
  }
}

function buffColor(kind: string): string {
  switch (kind) {
    case 'burning':
      return UI.buffBurn;
    case 'poison':
      return UI.buffPoison;
    case 'ooze':
      return UI.buffOoze;
    case 'paralysis':
      return UI.buffPara;
    case 'roots':
      return UI.buffRoot;
    default:
      return '#6e7484';
  }
}

// (regionForDepth is imported from core/grid for the depth label.)
