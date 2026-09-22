/**
 * Shop trade screen — the WndTradeItem concept (windows/WndTradeItem.java)
 * as a canvas panel, following the InventoryPanel pattern in
 * src/ui/inventory.ts.
 *
 * Vanilla has two windows: tapping a FOR_SALE heap opens
 * `WndTradeItem(heap)` ("FOR SALE: %s - %dg" + a "Buy for %dg" button,
 * disabled when the purse is short), and talking to the shopkeeper opens
 * the FOR_SALE bag ("Select an item to sell") whose pick opens
 * `WndTradeItem(item)` ("Sell for %dg", or "Sell 1 for %dg" / "Sell all
 * for %dg" for stacks, plus "Never mind"). This panel unifies both as two
 * tabs — Buy (the shop's stock) and Sell (the hero's sellable items) — with
 * the same labels and the same gold math (see src/content/shopkeeper.ts).
 *
 * After a sale vanilla hides the trade window and re-opens the sell bag
 * (WndTradeItem.hide -> Shopkeeper.sell); after a purchase it closes. This
 * panel instead stays open and refreshes, so both loops keep flowing.
 */
import type { Game } from '../engine/loop.js';
import {
  buyFromShop,
  readSellable,
  readShopStock,
  sellToShop,
  stockBuyPrice,
  shopSellAllPrice,
  shopSellOnePrice,
  type SellableEntry,
  type ShopStockEntry,
} from '../content/shopkeeper.js';
import { drawButton, drawPanel, inRect, roundRect, TAP, UI, type Rect, type SpriteSource, type View } from './palette.js';

export type ShopTab = 'buy' | 'sell';

interface Action {
  id: string;
  rect: Rect;
  label: string;
  disabled?: boolean;
  primary?: boolean;
}

export interface ShopLayout {
  panel: Rect;
  tabBuy: Rect;
  tabSell: Rect;
  goldText: string;
  rows: Rect[];
  actions: Action[];
  closeBtn: Rect;
}

const ROW_H = 56;
const HEADER_H = 52;
const TAB_H = 40;

export class ShopPanel {
  open = false;
  tab: ShopTab = 'buy';
  selected = 0;
  /** Last trade message (e.g. "You've bought ...") shown in the panel. */
  notice = '';

  openShop(tab: ShopTab = 'buy'): void {
    this.open = true;
    this.tab = tab;
    this.selected = 0;
    this.notice = '';
  }

  close(): void {
    this.open = false;
    this.notice = '';
  }

  layout(view: View, rowCount: number): ShopLayout {
    const wide = view.w >= 560;
    const pw = wide ? Math.min(480, view.w - 48) : view.w - 16;
    const maxRows = Math.max(1, Math.min(Math.max(rowCount, 1), Math.floor((view.h * 0.55) / ROW_H)));
    // The action row always exists (vanilla windows always have buttons;
    // an empty shop still offers "Never mind").
    const actionH = 64;
    const noticeH = this.notice ? 26 : 0;
    const ph = HEADER_H + TAB_H + maxRows * ROW_H + actionH + noticeH + 12;
    const px = (view.w - pw) / 2;
    const py = wide ? (view.h - ph) / 2 : Math.max(8, view.h - ph - 8);
    const panel: Rect = { x: px, y: py, w: pw, h: ph };
    const tabW = (pw - 20) / 2;
    const rows: Rect[] = [];
    for (let i = 0; i < maxRows; i++) {
      rows.push({ x: px + 10, y: py + HEADER_H + TAB_H + i * ROW_H, w: pw - 20, h: ROW_H - 6 });
    }
    // Action buttons are computed by actionsFor() (they need game state).
    const actions: Action[] = [];
    return {
      panel,
      tabBuy: { x: px + 10, y: py + HEADER_H + 4, w: tabW, h: TAB_H - 8 },
      tabSell: { x: px + 10 + tabW, y: py + HEADER_H + 4, w: tabW, h: TAB_H - 8 },
      goldText: '',
      rows,
      actions,
      closeBtn: { x: px + pw - 52, y: py + 6, w: TAP, h: TAP },
    };
  }

  private actionsFor(game: Game): Action[] {
    const view = ShopPanel.lastView ?? { w: 390, h: 700 };
    const L = this.layout(view, this.rowCount(game));
    const ay = L.panel.y + HEADER_H + TAB_H + L.rows.length * ROW_H + 6 + (this.notice ? 26 : 0);
    const mk = (i: number, n: number, id: string, label: string, disabled = false, primary = false): Action => {
      const bw = (L.panel.w - 20 - (n - 1) * 8) / n;
      return { id, label, disabled, primary, rect: { x: L.panel.x + 10 + i * (bw + 8), y: ay, w: bw, h: 52 } };
    };
    if (this.tab === 'buy') {
      const stock = readShopStock(game);
      const e = stock[this.selected];
      if (!e) return [mk(0, 2, 'cancel', 'Never mind')];
      const price = stockBuyPrice(e, game.level.depth);
      const hero = game.hero as unknown as { gold: number };
      return [
        mk(0, 2, 'buy', `Buy for ${price}g`, hero.gold < price, true),
        mk(1, 2, 'cancel', 'Never mind'),
      ];
    }
    const sellable = readSellable(game);
    const e = sellable[this.selected];
    if (!e) return [mk(0, 2, 'cancel', 'Never mind')];
    const all = shopSellAllPrice(e.unitPrice, e.qty);
    if (e.qty > 1) {
      const one = shopSellOnePrice(all, e.qty);
      return [
        mk(0, 3, 'sell-one', `Sell 1 for ${one}g`),
        mk(1, 3, 'sell-all', `Sell all for ${all}g`, false, true),
        mk(2, 3, 'cancel', 'Never mind'),
      ];
    }
    return [
      mk(0, 2, 'sell-all', `Sell for ${all}g`, false, true),
      mk(1, 2, 'cancel', 'Never mind'),
    ];
  }

  private rowCount(game: Game): number {
    return this.tab === 'buy' ? readShopStock(game).length : readSellable(game).length;
  }

  /** Tap handling. Returns true when the tap was consumed by the panel. */
  handleTap(x: number, y: number, game: Game): boolean {
    if (!this.open) return false;
    const view = ShopPanel.lastView;
    if (!view) return true;
    const count = this.rowCount(game);
    if (this.selected >= count) this.selected = Math.max(0, count - 1);
    const L = this.layout(view, count);
    if (inRect(L.closeBtn, x, y)) {
      this.close();
      return true;
    }
    if (inRect(L.tabBuy, x, y)) {
      this.tab = 'buy';
      this.selected = 0;
      this.notice = '';
      return true;
    }
    if (inRect(L.tabSell, x, y)) {
      this.tab = 'sell';
      this.selected = 0;
      this.notice = '';
      return true;
    }
    for (const a of this.actionsFor(game)) {
      if (inRect(a.rect, x, y) && !a.disabled) {
        this.press(a.id, game);
        return true;
      }
    }
    for (let i = 0; i < L.rows.length; i++) {
      if (inRect(L.rows[i], x, y) && i < count) {
        this.selected = i;
        this.notice = '';
        return true;
      }
    }
    // Tapping the scrim outside the panel closes it.
    if (!inRect(L.panel, x, y)) this.close();
    return true;
  }

  private press(id: string, game: Game): void {
    if (id === 'cancel') {
      this.close(); // TXT_CANCEL — "Never mind" (WndTradeItem.java:27)
      return;
    }
    if (id === 'buy' && this.tab === 'buy') {
      const e = readShopStock(game)[this.selected];
      if (!e) return;
      const r = buyFromShop(game, e);
      this.notice = r.ok ? `Bought ${e.name}.` : r.reason === 'no-gold' ? 'Not enough gold.' : 'That item is gone.';
      this.selected = 0;
      return;
    }
    if ((id === 'sell-one' || id === 'sell-all') && this.tab === 'sell') {
      const e = readSellable(game)[this.selected];
      if (!e) return;
      const r = sellToShop(game, e, id === 'sell-one' ? 'one' : 'all');
      this.notice = r.ok ? `Sold ${e.name} for ${r.price}g.` : 'That item is gone.';
      this.selected = 0;
    }
  }

  private static lastView: View | null = null;

  draw(ctx: CanvasRenderingContext2D, game: Game, sprites: SpriteSource, view: View): void {
    if (!this.open) return;
    ShopPanel.lastView = view;
    const stock = readShopStock(game);
    const sellable = readSellable(game);
    const count = this.tab === 'buy' ? stock.length : sellable.length;
    if (this.selected >= count) this.selected = Math.max(0, count - 1);
    const L = this.layout(view, count);
    const hero = game.hero as unknown as { gold: number };

    ctx.fillStyle = UI.scrim;
    ctx.fillRect(0, 0, view.w, view.h);
    drawPanel(ctx, L.panel, 12);

    // Header: title + purse (the bag window shows gold as its last slot).
    ctx.fillStyle = UI.text;
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Shopkeeper', L.panel.x + 16, L.panel.y + 26);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = UI.gold;
    ctx.textAlign = 'right';
    ctx.fillText(`${hero.gold}g`, L.panel.x + L.panel.w - 60, L.panel.y + 26);
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = UI.text;
    ctx.textAlign = 'center';
    ctx.fillText('×', L.closeBtn.x + L.closeBtn.w / 2, L.closeBtn.y + L.closeBtn.h / 2);
    ctx.textAlign = 'left';

    // Tabs.
    for (const [tab, rect, label] of [
      ['buy', L.tabBuy, 'Buy'],
      ['sell', L.tabSell, 'Sell'],
    ] as const) {
      const active = this.tab === tab;
      drawButton(ctx, rect, label, { primary: active, fontSize: 14 });
    }

    // Rows.
    const iconSize = 40;
    const rows = this.tab === 'buy' ? stock : sellable;
    L.rows.forEach((r, i) => {
      const e = (rows as (ShopStockEntry | SellableEntry)[])[i];
      if (!e) return;
      const isSel = i === this.selected;
      ctx.fillStyle = isSel ? 'rgba(47,111,159,0.22)' : 'rgba(0,0,0,0.06)';
      ctx.strokeStyle = isSel ? UI.accent : 'rgba(20,22,28,0.25)';
      ctx.lineWidth = isSel ? 3 : 1.5;
      roundRect(ctx, r, 8);
      ctx.fill();
      ctx.stroke();
      try {
        ctx.drawImage(sprites.entitySprite(e.sprite), r.x + 6, r.y + (r.h - iconSize) / 2, iconSize, iconSize);
      } catch {
        /* sprite source unavailable in headless draws */
      }
      const qty = 'qty' in e ? (e as ShopStockEntry).qty : (e as SellableEntry).qty;
      const name = qty > 1 ? `${e.name} ×${qty}` : e.name;
      ctx.fillStyle = UI.text;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(name, r.x + iconSize + 12, r.y + r.h / 2 - 8);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = UI.gold;
      const price =
        this.tab === 'buy'
          ? `${stockBuyPrice(e as ShopStockEntry, game.level.depth)}g`
          : `${shopSellAllPrice((e as SellableEntry).unitPrice, qty)}g`;
      ctx.textAlign = 'right';
      ctx.fillText(price, r.x + r.w - 10, r.y + r.h / 2 + 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.textDim;
      // TXT_SALE — "FOR SALE: %s - %dg" (WndTradeItem.java:22)
      const sub = this.tab === 'buy' ? 'for sale' : (e as SellableEntry).equipped ? 'equipped' : 'sell';
      ctx.fillText(sub, r.x + iconSize + 12, r.y + r.h / 2 + 12);
    });
    if (count === 0) {
      ctx.fillStyle = UI.textDim;
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const ry = L.rows[0]!;
      ctx.fillText(
        this.tab === 'buy' ? 'Sold out.' : 'Nothing the shopkeeper wants.',
        L.panel.x + L.panel.w / 2,
        ry.y + ry.h / 2,
      );
      ctx.textAlign = 'left';
    }

    if (this.notice) {
      ctx.fillStyle = UI.text;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const ny = L.panel.y + HEADER_H + TAB_H + L.rows.length * ROW_H + 18;
      ctx.fillText(this.notice, L.panel.x + L.panel.w / 2, ny);
      ctx.textAlign = 'left';
    }

    for (const a of this.actionsFor(game)) {
      drawButton(ctx, a.rect, a.label, { fontSize: 14, primary: a.primary, disabled: a.disabled });
    }
  }
}
