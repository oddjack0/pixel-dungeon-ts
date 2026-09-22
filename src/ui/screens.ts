/**
 * Full-screen UI states: title/start, death, pause, help.
 *
 * The Screens manager owns the overlay state machine and draws the overlays
 * on the game canvas. It never touches the Game directly: the UiManager
 * wires the callbacks (start run, continue, quit) and supplies the death
 * summary.
 */
import { drawButton, drawPanel, inRect, roundRect, UI, type Rect, type SpriteSource, type View } from './palette.js';

export type ScreenState = 'title' | 'playing' | 'paused' | 'help' | 'dead';

export interface RunSummary {
  cause: string;
  depth: number;
  turns: number;
  lvl: number;
  kills: number;
  gold: number;
  seed: number;
}

interface Button {
  id: string;
  rect: Rect;
  label: string;
  disabled?: boolean;
  primary?: boolean;
}

export const CONTROLS: { key: string; action: string }[] = [
  { key: 'Arrows / WASD / QEZC', action: 'Move (8 directions)' },
  { key: 'Space / .', action: 'Wait a turn' },
  { key: 'G', action: 'Pick up item' },
  { key: 'I', action: 'Inventory' },
  { key: 'M', action: 'Minimap' },
  { key: '>  /  <', action: 'Descend / ascend stairs' },
  { key: 'Esc', action: 'Pause / resume' },
  { key: 'Tap dungeon', action: 'Walk there (tap-to-move)' },
  { key: 'Tap enemy', action: 'Attack adjacent enemy' },
  { key: 'Tap hero', action: 'Wait a turn' },
  { key: 'Dart slot → tap foe', action: 'Throw a dart' },
];

export class Screens {
  state: ScreenState = 'title';
  seedText = '';
  seedEditing = false;

  onStartRun: (seed: number) => void = () => {};
  onContinue: () => void = () => {};
  onQuitToTitle: () => void = () => {};
  onAbandonRun: () => void = () => {};
  hasSave: () => boolean = () => false;
  getSummary: () => RunSummary | null = () => null;

  private buttons: Button[] = [];
  private seedRect: Rect | null = null;

  show(s: ScreenState): void {
    this.state = s;
    this.seedEditing = false;
  }

  /** Title-screen button layout (pure; also used by handleTap). */
  titleLayout(view: View): { buttons: Button[]; seedRect: Rect } {
    const bw = Math.min(280, view.w - 64);
    const bx = (view.w - bw) / 2;
    const cy = view.h * 0.52;
    const buttons: Button[] = [
      { id: 'new', rect: { x: bx, y: cy, w: bw, h: 52 }, label: 'New Run', primary: true },
      {
        id: 'continue',
        rect: { x: bx, y: cy + 62, w: bw, h: 52 },
        label: 'Continue',
        disabled: !this.hasSave(),
      },
    ];
    const seedRect: Rect = { x: bx, y: cy + 124, w: bw - 64, h: 48 };
    buttons.push({ id: 'random', rect: { x: bx + bw - 56, y: cy + 124, w: 56, h: 48 }, label: '🎲' });
    return { buttons, seedRect };
  }

  /** Keyboard. Returns true when the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.state === 'title') {
      if (this.seedEditing) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          this.seedEditing = false;
          e.preventDefault();
          return true;
        }
        if (e.key === 'Backspace') {
          this.seedText = this.seedText.slice(0, -1);
          e.preventDefault();
          return true;
        }
        if (/^[0-9]$/.test(e.key) && this.seedText.length < 10) {
          this.seedText += e.key;
          e.preventDefault();
          return true;
        }
        return true; // swallow other keys while editing the seed
      }
      if (e.key === 'Enter') {
        this.startFromSeed();
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (this.state === 'dead') {
      if (e.key === 'Enter') {
        this.onStartRun(this.parseSeed() ?? ((Math.random() * 0xffffffff) >>> 0));
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (this.state === 'paused' || this.state === 'help') {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        this.show(this.state === 'help' ? 'paused' : 'playing');
        e.preventDefault();
        return true;
      }
      return false;
    }
    return false;
  }

  /** Tap in CSS px. Returns true when consumed. */
  handleTap(x: number, y: number): boolean {
    if (this.state !== 'title' && this.state !== 'dead' && this.state !== 'paused' && this.state !== 'help') {
      return false;
    }
    if (this.state === 'title') {
      const { buttons, seedRect } = this.titleLayout(Screens.lastView ?? { w: 390, h: 700 });
      if (inRect(seedRect, x, y)) {
        this.seedEditing = true;
        return true;
      }
      this.seedEditing = false;
      for (const b of buttons) {
        if (inRect(b.rect, x, y) && !b.disabled) {
          this.pressTitle(b.id);
          return true;
        }
      }
      return true;
    }
    for (const b of this.buttons) {
      if (inRect(b.rect, x, y) && !b.disabled) {
        this.press(b.id);
        return true;
      }
    }
    return true; // modal: swallow everything else
  }

  private pressTitle(id: string): void {
    if (id === 'new') this.startFromSeed();
    else if (id === 'continue') this.onContinue();
    else if (id === 'random') this.seedText = `${(Math.random() * 0xffffffff) >>> 0}`;
  }

  private startFromSeed(): void {
    const s = this.parseSeed();
    this.onStartRun(s ?? ((Math.random() * 0xffffffff) >>> 0));
  }

  private parseSeed(): number | null {
    const t = this.seedText.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n >>> 0 : null;
  }

  private press(id: string): void {
    switch (id) {
      case 'resume':
        this.show('playing');
        break;
      case 'help':
        this.show('help');
        break;
      case 'back-pause':
        this.show('paused');
        break;
      case 'save-quit':
        this.onQuitToTitle();
        break;
      case 'abandon':
        this.onAbandonRun();
        break;
      case 'retry':
        this.onStartRun((Math.random() * 0xffffffff) >>> 0);
        break;
      case 'to-title':
        this.onQuitToTitle();
        break;
    }
  }

  private static lastView: View | null = null;

  draw(ctx: CanvasRenderingContext2D, sprites: SpriteSource, view: View, nowMs: number): void {
    Screens.lastView = view;
    if (this.state === 'title') this.drawTitle(ctx, sprites, view, nowMs);
    else if (this.state === 'dead') this.drawDeath(ctx, view);
    else if (this.state === 'paused') this.drawPause(ctx, view);
    else if (this.state === 'help') this.drawHelp(ctx, view);
  }

  private drawTitle(ctx: CanvasRenderingContext2D, sprites: SpriteSource, view: View, nowMs: number): void {
    ctx.fillStyle = UI.backdrop;
    ctx.fillRect(0, 0, view.w, view.h);

    // sprite showcase: warrior vs. the Sewers roster
    const keys = ['mob_rat', 'mob_gnoll', 'hero_warrior', 'mob_crab', 'mob_goo'];
    const size = 56;
    const totalW = keys.length * (size + 10);
    let sx = (view.w - totalW) / 2;
    const sy = view.h * 0.30;
    for (const k of keys) {
      try {
        ctx.drawImage(sprites.entitySprite(k), sx, sy, size, size);
      } catch {
        /* headless */
      }
      sx += size + 10;
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    const ty = view.h * 0.20;
    ctx.strokeText('PIXEL DUNGEON', view.w / 2, ty);
    ctx.fillStyle = UI.gold;
    ctx.fillText('PIXEL DUNGEON', view.w / 2, ty);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#9a917e';
    ctx.fillText('a storybook roguelike · v2', view.w / 2, ty + 30);
    ctx.fillText('The Sewers await. Permadeath is forever.', view.w / 2, ty + 52);
    ctx.textAlign = 'left';

    const { buttons, seedRect } = this.titleLayout(view);
    this.seedRect = seedRect;
    for (const b of buttons) drawButton(ctx, b.rect, b.label, { disabled: b.disabled, primary: b.primary, fontSize: 17 });

    // seed field
    ctx.fillStyle = this.seedEditing ? '#fff8e6' : '#e8dcc0';
    ctx.strokeStyle = this.seedEditing ? UI.gold : UI.ink;
    ctx.lineWidth = 3;
    roundRect(ctx, seedRect, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI.text;
    ctx.font = '16px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const shown = this.seedText === '' ? (this.seedEditing ? '' : 'seed (optional)') : this.seedText;
    ctx.fillStyle = this.seedText === '' && !this.seedEditing ? UI.textDim : UI.text;
    ctx.fillText(shown, seedRect.x + 12, seedRect.y + seedRect.h / 2);
    if (this.seedEditing && Math.floor(nowMs / 500) % 2 === 0) {
      const tw = ctx.measureText(this.seedText).width;
      ctx.fillRect(seedRect.x + 12 + tw + 2, seedRect.y + 10, 2, seedRect.h - 20);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawDeath(ctx: CanvasRenderingContext2D, view: View): void {
    ctx.fillStyle = 'rgba(20, 4, 6, 0.92)';
    ctx.fillRect(0, 0, view.w, view.h);
    const s = this.getSummary();

    ctx.textAlign = 'center';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    ctx.strokeText('YOU DIED', view.w / 2, view.h * 0.22);
    ctx.fillStyle = UI.danger;
    ctx.fillText('YOU DIED', view.w / 2, view.h * 0.22);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = UI.textLight;
    ctx.fillText(s?.cause ?? 'The dungeon claims another.', view.w / 2, view.h * 0.22 + 34);

    if (s) {
      const rows: [string, string][] = [
        ['Depth', `${s.depth}`],
        ['Turns', `${s.turns}`],
        ['Level', `${s.lvl}`],
        ['Kills', `${s.kills}`],
        ['Gold', `${s.gold}`],
        ['Seed', `${s.seed}`],
      ];
      const pw = Math.min(320, view.w - 48);
      const px = (view.w - pw) / 2;
      const py = view.h * 0.22 + 56;
      drawPanel(ctx, { x: px, y: py, w: pw, h: rows.length * 30 + 20 }, 12);
      ctx.font = '14px system-ui, sans-serif';
      rows.forEach(([k, v], i) => {
        const y = py + 26 + i * 30;
        ctx.textAlign = 'left';
        ctx.fillStyle = UI.textDim;
        ctx.fillText(k, px + 20, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = UI.text;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText(v, px + pw - 20, y);
        ctx.font = '14px system-ui, sans-serif';
      });
      ctx.textAlign = 'left';
    }

    const bw = Math.min(280, view.w - 64);
    const bx = (view.w - bw) / 2;
    const by = view.h * 0.22 + 56 + 6 * 30 + 40;
    this.buttons = [
      { id: 'retry', rect: { x: bx, y: by, w: bw, h: 52 }, label: 'Try Again', primary: true },
      { id: 'to-title', rect: { x: bx, y: by + 62, w: bw, h: 52 }, label: 'Title Screen' },
    ];
    for (const b of this.buttons) drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 17 });
  }

  private drawPause(ctx: CanvasRenderingContext2D, view: View): void {
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    const pw = Math.min(420, view.w - 32);
    const px = (view.w - pw) / 2;
    const py = Math.max(24, view.h * 0.12);
    const ph = Math.min(view.h - py * 2, CONTROLS.length * 26 + 210);
    drawPanel(ctx, { x: px, y: py, w: pw, h: ph }, 12);

    ctx.fillStyle = UI.text;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Paused', view.w / 2, py + 36);
    ctx.textAlign = 'left';
    ctx.font = '13px system-ui, sans-serif';
    CONTROLS.slice(0, 7).forEach((c, i) => {
      const y = py + 64 + i * 24;
      ctx.fillStyle = UI.textDim;
      ctx.fillText(c.key, px + 20, y);
      ctx.fillStyle = UI.text;
      ctx.fillText(c.action, px + 190, y);
    });

    const bw = pw - 40;
    const bx = px + 20;
    let by = py + 64 + 7 * 24 + 12;
    this.buttons = [
      { id: 'resume', rect: { x: bx, y: by, w: bw, h: 50 }, label: 'Resume', primary: true },
      { id: 'help', rect: { x: bx, y: (by += 60), w: bw, h: 50 }, label: 'All Controls' },
      { id: 'save-quit', rect: { x: bx, y: (by += 60), w: bw, h: 50 }, label: 'Save & Quit to Title' },
      { id: 'abandon', rect: { x: bx, y: (by += 60), w: bw, h: 50 }, label: 'Abandon Run' },
    ];
    for (const b of this.buttons) drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 16 });
  }

  private drawHelp(ctx: CanvasRenderingContext2D, view: View): void {
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    const pw = Math.min(460, view.w - 32);
    const px = (view.w - pw) / 2;
    const py = Math.max(20, view.h * 0.08);
    const ph = Math.min(view.h - py * 2, CONTROLS.length * 26 + 130);
    drawPanel(ctx, { x: px, y: py, w: pw, h: ph }, 12);

    ctx.fillStyle = UI.text;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Controls', view.w / 2, py + 36);
    ctx.textAlign = 'left';
    ctx.font = '13px system-ui, sans-serif';
    CONTROLS.forEach((c, i) => {
      const y = py + 64 + i * 26;
      if (y > py + ph - 70) return;
      ctx.fillStyle = UI.textDim;
      ctx.fillText(c.key, px + 20, y);
      ctx.fillStyle = UI.text;
      ctx.fillText(c.action, px + 200, y);
    });

    const bw = pw - 40;
    this.buttons = [{ id: 'back-pause', rect: { x: px + 20, y: py + ph - 62, w: bw, h: 50 }, label: 'Back', primary: true }];
    for (const b of this.buttons) drawButton(ctx, b.rect, b.label, { primary: b.primary, fontSize: 16 });
  }
}
