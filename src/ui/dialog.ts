/**
 * Modal quest dialog system — faithful port of vanilla `windows/WndQuest`
 * (title + highlighted text + optional buttons, WndQuest.java:29-79) and the
 * reward-choice windows `WndSadGhost` (WndSadGhost.java:30-67) and
 * `WndWandmaker` (WndWandmaker.java:34-76). GPL-3.0, (C) Oleg Dolya.
 *
 * Vanilla windows are blocking: `interact()` shows the window and the game
 * waits for `onSelect`. The port's loop is synchronous, so dialogs are a
 * promise queue instead:
 *
 *   const choice = await showDialog({ title, text, choices });
 *
 * Content code (src/content/npcs.ts) awaits the promise; the simulation
 * pauses while a dialog is open (UiManager.tick skips pumping when
 * Dialogs.open). The canvas renderer draws the head of the queue and tap
 * input resolves it. Headless contexts (tests, engine without UI) drive the
 * queue through the exported test helpers below.
 *
 * Text uses vanilla's `_highlight_` spans (WndQuest HighlightedText):
 * segments wrapped in underscores render in the highlight color.
 */
import { UI, TAP, type Rect, type View, type SpriteSource } from './palette.js';

export interface DialogChoice {
  /** Button label (vanilla: the full button text). */
  label: string;
  /** Value the showDialog promise resolves with. */
  value: string;
}

export interface DialogRequest {
  /** NPC name, vanilla WndQuest IconTitle (WndQuest.java:40). */
  title: string;
  /** Body text; `_..._` spans render highlighted. */
  text: string;
  /** NPC sprite key for the title icon (vanilla: the npc's sprite). */
  sprite?: string;
  /** Buttons. Empty choices render a single "Continue" button that resolves ''. */
  choices: DialogChoice[];
}

interface PendingDialog extends DialogRequest {
  resolve: (value: string) => void;
}

const queue: PendingDialog[] = [];

/**
 * Queue a modal dialog. Resolves with the chosen value, or '' when the
 * dialog is dismissed without choosing (vanilla: window closed, onSelect
 * never called — WndQuest with tapped-outside/Escape).
 */
export function showDialog(req: DialogRequest): Promise<string> {
  return new Promise<string>((resolve) => {
    queue.push({ ...req, resolve });
  });
}

/** Head of the queue (what the renderer draws), or null. */
export function currentDialog(): DialogRequest | null {
  return queue.length > 0 ? queue[0] : null;
}

/** True while at least one dialog is queued. */
export function dialogOpen(): boolean {
  return queue.length > 0;
}

/**
 * Resolve the head dialog with a value and close it. Returns false when no
 * dialog was open.
 */
export function resolveDialog(value: string): boolean {
  const head = queue.shift();
  if (!head) return false;
  head.resolve(value);
  return true;
}

/** Dismiss the head dialog without a choice (vanilla: closed window). */
export function dismissDialog(): boolean {
  return resolveDialog('');
}

/** Drain the whole queue, resolving everything with ''. Test/edge helper. */
export function dismissAllDialogs(): void {
  while (queue.length > 0) dismissDialog();
}

/**
 * UI shell bridge. Content code calls `showDialog` (which only queues);
 * the UiManager installs the bridge so the canvas renderer can also draw
 * and the shop worker's `openShop` contract can be reached from NPC talk
 * routing. Null in headless contexts.
 */
export interface UiBridge {
  openShop(mode: 'buy' | 'sell'): void;
}
export const uiBridge: { current: UiBridge | null } = { current: null };

/** Await a macrotask so queued dialog promise chains settle (tests). */
export function settleDialogs(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Canvas renderer
// ---------------------------------------------------------------------------

const FONT = '14px system-ui, sans-serif';
const TITLE_FONT = 'bold 15px system-ui, sans-serif';
const BTN_FONT = 'bold 14px system-ui, sans-serif';
const HIGHLIGHT = '#8a5c00'; // gold on parchment (vanilla _..._ spans)
const PAD = 16;
const MAX_W = 440;

interface ButtonRect extends Rect {
  value: string;
}

interface Layout {
  panel: Rect;
  buttons: ButtonRect[];
}

/** Split text into plain/highlighted segments (vanilla WndQuest _..._ spans). */
export function splitHighlight(text: string): { text: string; hi: boolean }[] {
  const out: { text: string; hi: boolean }[] = [];
  const parts = text.split(/(_[^_]+_)/g);
  for (const p of parts) {
    if (p.length === 0) continue;
    if (p.startsWith('_') && p.endsWith('_') && p.length >= 2) {
      out.push({ text: p.slice(1, -1), hi: true });
    } else {
      out.push({ text: p, hi: false });
    }
  }
  return out;
}

/** Word-wrap highlighted segments into lines that fit `maxW`. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): { text: string; hi: boolean }[][] {
  const lines: { text: string; hi: boolean }[][] = [];
  for (const para of text.split('\n')) {
    const segs = splitHighlight(para);
    // Flatten to words, keeping the highlight flag per word.
    const words: { text: string; hi: boolean }[] = [];
    for (const s of segs) {
      for (const w of s.text.split(/\s+/)) {
        if (w.length > 0) words.push({ text: w, hi: s.hi });
      }
    }
    let line: { text: string; hi: boolean }[] = [];
    let lineW = 0;
    ctx.font = FONT;
    for (const w of words) {
      const ww = ctx.measureText(w.text + ' ').width;
      if (line.length > 0 && lineW + ww > maxW) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
      line.push(w);
      lineW += ww;
    }
    lines.push(line);
  }
  return lines;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  line: { text: string; hi: boolean }[],
  x: number,
  y: number,
): void {
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  let cx = x;
  for (const w of line) {
    ctx.fillStyle = w.hi ? HIGHLIGHT : UI.text;
    ctx.fillText(w.text, cx, y);
    cx += ctx.measureText(w.text + ' ').width;
  }
}

function roundPanel(ctx: CanvasRenderingContext2D, r: Rect, rad: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

/**
 * Canvas renderer for the dialog queue. Draws the head dialog; tap/key
 * input resolves it. Layout is recomputed every draw and cached for
 * hit-testing.
 */
export class Dialogs {
  private layout: Layout | null = null;

  get open(): boolean {
    return dialogOpen();
  }

  draw(ctx: CanvasRenderingContext2D, sprites: SpriteSource, view: View): void {
    const dlg = currentDialog();
    if (!dlg) {
      this.layout = null;
      return;
    }
    const choices =
      dlg.choices.length > 0 ? dlg.choices : [{ label: 'Continue', value: '' }];

    // Scrim.
    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);

    const pw = Math.min(view.w - 48, MAX_W);
    const px = (view.w - pw) / 2;
    const textW = pw - PAD * 2;
    const lines = wrapLines(ctx, dlg.text, textW);
    const lineH = 20;
    const textH = lines.length * lineH;
    const btnH = Math.max(TAP, 40);
    const btnGap = 8;
    const titleH = 40;
    const ph = PAD + titleH + 8 + textH + 12 + choices.length * (btnH + btnGap) - btnGap + PAD;
    const py = Math.max(24, (view.h - ph) / 2 - 20);

    // Panel.
    ctx.fillStyle = UI.panel;
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 3;
    roundPanel(ctx, { x: px, y: py, w: pw, h: ph }, 10);
    ctx.fill();
    ctx.stroke();

    // Title bar: npc sprite + name (vanilla WndQuest IconTitle).
    let ty = py + PAD;
    if (dlg.sprite) {
      try {
        const img = sprites.entitySprite(dlg.sprite);
        ctx.drawImage(img, px + PAD, ty, 28, 28);
      } catch {
        /* sprite missing: title still renders */
      }
    }
    ctx.font = TITLE_FONT;
    ctx.fillStyle = UI.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(dlg.title, px + PAD + (dlg.sprite ? 36 : 0), ty + 15);
    ty += titleH;
    ctx.strokeStyle = UI.panelDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + PAD, ty);
    ctx.lineTo(px + pw - PAD, ty);
    ctx.stroke();
    ty += 8;

    // Body text.
    for (const line of lines) {
      drawLine(ctx, line, px + PAD, ty + 14);
      ty += lineH;
    }
    ty += 12;

    // Buttons.
    const buttons: ButtonRect[] = [];
    for (const c of choices) {
      const r: ButtonRect = { x: px + PAD, y: ty, w: pw - PAD * 2, h: btnH, value: c.value };
      buttons.push(r);
      ctx.fillStyle = UI.panelDark;
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 2;
      roundPanel(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      ctx.font = BTN_FONT;
      ctx.fillStyle = UI.text;
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(c.label).width;
      ctx.fillText(c.label, r.x + (r.w - tw) / 2, r.y + r.h / 2 + 1);
      ty += btnH + btnGap;
    }
    ctx.textBaseline = 'alphabetic';

    this.layout = { panel: { x: px, y: py, w: pw, h: ph }, buttons };
  }

  /**
   * Route a tap. Returns true when the tap was consumed by the dialog.
   * Tapping a button resolves with its value; tapping outside the panel
   * dismisses (vanilla: window closed, no onSelect).
   */
  handleTap(x: number, y: number): boolean {
    const dlg = currentDialog();
    if (!dlg) return false;
    const layout = this.layout;
    if (layout) {
      for (const b of layout.buttons) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          resolveDialog(b.value);
          return true;
        }
      }
      const p = layout.panel;
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
        return true; // inside panel, not on a button: swallow
      }
    }
    dismissDialog(); // outside the panel: vanilla close-window
    return true;
  }

  /** Route a key. Digits pick choices; Escape dismisses. */
  handleKey(key: string): boolean {
    const dlg = currentDialog();
    if (!dlg) return false;
    if (key === 'Escape') {
      dismissDialog();
      return true;
    }
    const n = parseInt(key, 10);
    const choices =
      dlg.choices.length > 0 ? dlg.choices : [{ label: 'Continue', value: '' }];
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
      resolveDialog(choices[n - 1].value);
      return true;
    }
    return true; // modal: swallow everything else
  }
}
