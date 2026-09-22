/**
 * Inventory panel (I key). UI-owned view over the hero's kit.
 *
 * Item defs themselves live with the content designer (src/content/); this
 * module defines the UI's *view model* (UiItem) and an adapter seam:
 * `defaultInventoryAdapter` reads the mechanics Hero (weapon/armor/darts)
 * and any content-owned `inventory` array on the hero; the content designer
 * can replace it via `setInventoryAdapter` without touching UI code.
 *
 * Actions dispatch to HeroIntent (engine/seams.ts): 'use' -> useItem is live
 * today; 'equip'/'drop'/'throwItem' are new intent kinds proposed for the
 * mechanics worker (see docs/UI-REPORT.md).
 */
import type { Game } from '../engine/loop.js';
import type { Hero } from '../mechanics/char.js';
import { drawButton, drawPanel, inRect, roundRect, TAP, UI, type Rect, type SpriteSource, type View } from './palette.js';

export type ItemKind = 'weapon' | 'armor' | 'missile' | 'potion' | 'food' | 'scroll' | 'misc';
export type ItemAction = 'use' | 'equip' | 'drop' | 'throw';

export interface UiItem {
  /** Slot index understood by the mechanics' useItem/equip/drop intents. */
  slot: number;
  /** Content item id (e.g. 'shortsword', 'potion_healing', 'dart'). */
  id: string;
  name: string;
  /** Sprite key from src/assets/sprites.ts. */
  sprite: string;
  qty: number;
  kind: ItemKind;
  equipped: boolean;
  identified: boolean;
}

/** Content-owned inventory entry shape (structural; content designer owns it). */
export interface ContentItem {
  id: string;
  name: string;
  sprite: string;
  qty?: number;
  kind?: ItemKind;
  equipped?: boolean;
  identified?: boolean;
}

export type InventoryAdapter = (game: Game) => UiItem[];

function asHero(game: Game): Partial<Hero> & { inventory?: ContentItem[] } {
  return game.hero as unknown as Partial<Hero> & { inventory?: ContentItem[] };
}

function toUiItem(c: ContentItem, slot: number): UiItem {
  return {
    slot,
    id: c.id,
    name: c.name,
    sprite: c.sprite,
    qty: c.qty ?? 1,
    kind: c.kind ?? 'misc',
    equipped: c.equipped ?? false,
    identified: c.identified ?? true,
  };
}

/**
 * Default adapter: the warrior kit from the mechanics Hero —
 * equipped short sword + cloth armor, dart stack — plus any content-owned
 * `inventory` array the content designer attaches to the hero later.
 */
export function defaultInventoryAdapter(game: Game): UiItem[] {
  const h = asHero(game);
  const items: UiItem[] = [];
  let slot = 0;
  if (h.weapon) {
    items.push({
      slot: slot++,
      id: 'shortsword',
      name: h.weapon.name,
      sprite: 'shortsword',
      qty: 1,
      kind: 'weapon',
      equipped: true,
      identified: true,
    });
  }
  if (h.armor) {
    items.push({
      slot: slot++,
      id: 'clotharmor',
      name: h.armor.name,
      sprite: 'scroll', // no armor sprite in the M1 atlas; see UI-REPORT
      qty: 1,
      kind: 'armor',
      equipped: true,
      identified: true,
    });
  }
  const darts = h.darts ?? 0;
  if (darts > 0) {
    items.push({
      slot: slot++,
      id: 'dart',
      name: 'dart',
      sprite: 'dart',
      qty: darts,
      kind: 'missile',
      equipped: false,
      identified: true,
    });
  }
  const extra = h.inventory;
  if (Array.isArray(extra)) {
    for (const c of extra) items.push(toUiItem(c, slot++));
  }
  // Ration: the warrior starts with one food (HeroClass.java:119-123).
  // Shown until the content inventory reports food of its own.
  if (!items.some((i) => i.kind === 'food')) {
    items.push({
      slot: slot++,
      id: 'ration',
      name: 'ration of food',
      sprite: 'ration',
      qty: 1,
      kind: 'food',
      equipped: false,
      identified: true,
    });
  }
  return items;
}

let adapter: InventoryAdapter = defaultInventoryAdapter;

/** Content designer hook: replace how the panel reads the hero's items. */
export function setInventoryAdapter(fn: InventoryAdapter): void {
  adapter = fn;
}

export function readInventory(game: Game): UiItem[] {
  return adapter(game);
}

/** Context-aware actions for an item, in display order. */
export function actionsFor(item: UiItem): ItemAction[] {
  switch (item.kind) {
    case 'weapon':
    case 'armor':
      return item.equipped ? ['equip', 'drop'] : ['equip', 'drop'];
    case 'missile':
      return ['throw', 'drop'];
    case 'potion':
    case 'food':
    case 'scroll':
      return ['use', 'drop'];
    default:
      return ['drop'];
  }
}

export function actionLabel(action: ItemAction, item: UiItem): string {
  switch (action) {
    case 'use':
      return item.kind === 'potion' ? 'Drink' : item.kind === 'food' ? 'Eat' : item.kind === 'scroll' ? 'Read' : 'Use';
    case 'equip':
      return item.equipped ? (item.kind === 'armor' ? 'Take off' : 'Unwield') : item.kind === 'armor' ? 'Wear' : 'Wield';
    case 'drop':
      return 'Drop';
    case 'throw':
      return 'Throw';
  }
}

/**
 * Dispatch an inventory action. Returns 'throw-targeting' when the UI should
 * enter throw-targeting mode (the UiManager owns that interaction).
 */
export function doItemAction(game: Game, item: UiItem, action: ItemAction): 'done' | 'throw-targeting' {
  switch (action) {
    case 'use':
      game.queueIntent({ kind: 'useItem', slot: item.slot });
      return 'done';
    case 'equip':
      game.queueIntent({ kind: 'equip', slot: item.slot });
      return 'done';
    case 'drop':
      game.queueIntent({ kind: 'drop', slot: item.slot });
      return 'done';
    case 'throw':
      return 'throw-targeting';
  }
}

// --- Panel ---

export interface InventoryLayout {
  panel: Rect;
  rows: Rect[];
  actions: { action: ItemAction; rect: Rect; label: string }[];
  closeBtn: Rect;
  title: string;
}

const ROW_H = 56;

export class InventoryPanel {
  open = false;
  selected = 0;
  /** Called when the player picks Throw on an item (UiManager owns targeting). */
  onThrowRequest: (item: UiItem) => void = () => {};

  toggle(): void {
    this.open = !this.open;
    this.selected = 0;
  }
  close(): void {
    this.open = false;
  }

  layout(view: View, itemCount: number, selected: UiItem | null): InventoryLayout {
    const wide = view.w >= 560;
    const pw = wide ? Math.min(480, view.w - 48) : view.w - 16;
    const maxRows = Math.max(1, Math.min(itemCount, Math.floor((view.h * 0.62) / ROW_H)));
    const headerH = 52;
    const actionH = selected ? 64 : 0;
    const ph = headerH + maxRows * ROW_H + actionH + 12;
    const px = (view.w - pw) / 2;
    const py = wide ? (view.h - ph) / 2 : view.h - ph - 8;
    const panel: Rect = { x: px, y: py, w: pw, h: ph };
    const rows: Rect[] = [];
    for (let i = 0; i < maxRows; i++) {
      rows.push({ x: px + 10, y: py + headerH + i * ROW_H, w: pw - 20, h: ROW_H - 6 });
    }
    const actions: InventoryLayout['actions'] = [];
    if (selected) {
      const acts = actionsFor(selected);
      const bw = (pw - 20 - (acts.length - 1) * 8) / acts.length;
      acts.forEach((a, i) => {
        actions.push({
          action: a,
          label: actionLabel(a, selected),
          rect: { x: px + 10 + i * (bw + 8), y: py + headerH + maxRows * ROW_H + 6, w: bw, h: 52 },
        });
      });
    }
    return {
      panel,
      rows,
      actions,
      closeBtn: { x: px + pw - 52, y: py + 6, w: TAP, h: TAP },
      title: 'Inventory',
    };
  }

  /** Tap handling. Returns true when the tap was consumed by the panel. */
  handleTap(x: number, y: number, game: Game): boolean {
    if (!this.open) return false;
    const items = readInventory(game);
    const sel = items[this.selected] ?? null;
    // Recompute layout from the last draw size; the UiManager passes the
    // current view so layout is deterministic for a given size.
    const view = InventoryPanel.lastView;
    if (!view) return true;
    const L = this.layout(view, items.length, sel);
    if (inRect(L.closeBtn, x, y)) {
      this.close();
      return true;
    }
    for (const a of L.actions) {
      if (inRect(a.rect, x, y) && sel) {
        const r = doItemAction(game, sel, a.action);
        if (r === 'throw-targeting') this.onThrowRequest(sel);
        else this.close();
        return true;
      }
    }
    for (let i = 0; i < L.rows.length; i++) {
      if (inRect(L.rows[i], x, y)) {
        this.selected = Math.min(i, items.length - 1);
        return true;
      }
    }
    // Tapping the scrim outside the panel closes it.
    if (!inRect(L.panel, x, y)) this.close();
    return true;
  }

  private static lastView: View | null = null;

  draw(ctx: CanvasRenderingContext2D, game: Game, sprites: SpriteSource, view: View): void {
    if (!this.open) return;
    InventoryPanel.lastView = view;
    const items = readInventory(game);
    if (this.selected >= items.length) this.selected = Math.max(0, items.length - 1);
    const sel = items[this.selected] ?? null;
    const L = this.layout(view, items.length, sel);

    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    drawPanel(ctx, L.panel, 12);

    ctx.fillStyle = UI.text;
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(L.title, L.panel.x + 16, L.panel.y + 26);
    // close ×
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', L.closeBtn.x + L.closeBtn.w / 2, L.closeBtn.y + L.closeBtn.h / 2);
    ctx.textAlign = 'left';

    const iconSize = 40;
    L.rows.forEach((r, i) => {
      const item = items[i];
      if (!item) return;
      const isSel = i === this.selected;
      ctx.fillStyle = isSel ? 'rgba(47,111,159,0.22)' : 'rgba(0,0,0,0.06)';
      ctx.strokeStyle = isSel ? UI.accent : 'rgba(20,22,28,0.25)';
      ctx.lineWidth = isSel ? 3 : 1.5;
      roundRect(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      try {
        ctx.drawImage(sprites.entitySprite(item.sprite), r.x + 6, r.y + (r.h - iconSize) / 2, iconSize, iconSize);
      } catch {
        /* sprite source unavailable in headless draws */
      }
      ctx.fillStyle = UI.text;
      ctx.font = 'bold 14px system-ui, sans-serif';
      const name = item.identified ? item.name : 'unknown ' + item.kind;
      ctx.fillText(item.qty > 1 ? `${name} ×${item.qty}` : name, r.x + iconSize + 12, r.y + r.h / 2 - 8);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = UI.textDim;
      const sub = item.equipped ? 'equipped' : item.kind;
      ctx.fillText(sub, r.x + iconSize + 12, r.y + r.h / 2 + 12);
    });

    for (const a of L.actions) {
      drawButton(ctx, a.rect, a.label, { fontSize: 15, primary: a.action === 'use' || a.action === 'throw' });
    }
  }
}
