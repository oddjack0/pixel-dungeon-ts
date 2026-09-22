/**
 * Storybook Dungeon UI palette + shared canvas helpers.
 *
 * The UI chrome is drawn with simple canvas shapes (bars, frames, buttons)
 * over the sprite art — no programmer-art icons in shipped UI. Entity/item
 * icons always come from the sprite atlas (src/assets/sprites.ts).
 *
 * Colors follow docs/ART-STYLE.md: warm parchment panels, near-black
 * outlines (same #14161c as the sprite outline char `k`), jewel-tone
 * accents, hue-shifted shading (never pure gray ramps).
 */

export const UI = {
  /** Panel fill: warm parchment. */
  panel: '#f2e3bd',
  /** Panel fill, darker edge shading (hue-shifted toward brown). */
  panelDark: '#d9c08d',
  /** Panel fill, pressed/inner. */
  panelDeep: '#c8ab72',
  /** Near-black outline (matches sprite char `k`). */
  ink: '#14161c',
  /** Soft dark overlay for modals. */
  scrim: 'rgba(10, 8, 14, 0.72)',
  /** Title-screen backdrop. */
  backdrop: '#0d0b12',
  /** HP bar fill. */
  hp: '#d94f3d',
  /** HP bar, low (pulses when hp/ht < 0.25). */
  hpLow: '#a02020',
  /** HP bar track. */
  hpTrack: '#4a1f1a',
  /** EXP bar fill. */
  xp: '#7fc24a',
  /** EXP bar track. */
  xpTrack: '#2c3a1e',
  /** Gold. */
  gold: '#ffd75e',
  /** Boss (Goo) bar. */
  boss: '#58c23d',
  /** Boss bar track. */
  bossTrack: '#1e2f1a',
  /** Damage numbers. */
  dmgHero: '#ff6b5e',
  dmgMob: '#ffe9a8',
  heal: '#8fe07a',
  /** Buff badge fills. */
  buffBurn: '#e07b39',
  buffPoison: '#7fc24a',
  buffOoze: '#58c23d',
  buffPara: '#b48ce0',
  buffRoot: '#a9713f',
  /** Text. */
  text: '#2b2118',
  textLight: '#f5ecd4',
  textDim: '#8a7a5c',
  /** Message log text. */
  log: '#f5ecd4',
  /** Links/accents. */
  accent: '#2f6f9f',
  danger: '#c0392b',
} as const;

/** Minimum tap-target size (CSS px) for phone portrait. */
export const TAP = 44;

/** Anything that can serve prerendered sprites (the engine Renderer does). */
export interface SpriteSource {
  entitySprite(name: string): HTMLCanvasElement;
}

export interface View {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Parchment panel with ink outline and a soft inner highlight. */
export function drawPanel(ctx: CanvasRenderingContext2D, r: Rect, radius = 10): void {
  ctx.fillStyle = UI.scrim;
  // (scrim is drawn by the caller when modal; panel itself:)
  ctx.fillStyle = UI.panel;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 3;
  roundRect(ctx, r, radius);
  ctx.fill();
  ctx.stroke();
  // top highlight
  ctx.strokeStyle = 'rgba(255,250,235,0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y + 3);
  ctx.lineTo(r.x + r.w - radius, r.y + 3);
  ctx.stroke();
}

export function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

/** Horizontal stat bar with track, fill, outline, and centered label. */
export function drawBar(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  frac: number,
  fill: string,
  track: string,
  label: string,
  labelSize = 11,
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = track;
  roundRect(ctx, r, r.h / 2);
  ctx.fill();
  if (f > 0) {
    ctx.fillStyle = fill;
    const fw = Math.max(r.h, r.w * f);
    roundRect(ctx, { x: r.x, y: r.y, w: Math.min(fw, r.w), h: r.h }, r.h / 2);
    ctx.fill();
  }
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  roundRect(ctx, r, r.h / 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 3;
  ctx.font = `bold ${labelSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 + 0.5;
  ctx.strokeText(label, cx, cy);
  ctx.fillText(label, cx, cy);
  ctx.textAlign = 'left';
}

/** Chunky storybook button. Returns its rect (caller hit-tests). */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: { disabled?: boolean; primary?: boolean; fontSize?: number } = {},
): void {
  const { disabled = false, primary = false, fontSize = 16 } = opts;
  ctx.fillStyle = disabled ? '#9a8f78' : primary ? '#e8a33d' : UI.panel;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 3;
  roundRect(ctx, r, 10);
  ctx.fill();
  ctx.stroke();
  if (!disabled && primary) {
    ctx.strokeStyle = 'rgba(255,250,235,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x + 10, r.y + 3);
    ctx.lineTo(r.x + r.w - 10, r.y + 3);
    ctx.stroke();
  }
  ctx.fillStyle = disabled ? '#5c5344' : UI.text;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
}

/** Small gold-coin glyph (canvas shape, HUD only). */
export function drawCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = UI.gold;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#b8860b';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

/** Hunger drumstick glyph (canvas shape, HUD only). */
export function drawDrumstick(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // meat
  ctx.fillStyle = '#c98a5a';
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.42, y + s * 0.42, s * 0.34, s * 0.28, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // bone
  ctx.strokeStyle = '#f5ecd4';
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.62, y + s * 0.62);
  ctx.lineTo(x + s * 0.94, y + s * 0.94);
  ctx.stroke();
  ctx.fillStyle = '#f5ecd4';
  ctx.beginPath();
  ctx.arc(x + s * 0.94, y + s * 0.9, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}
