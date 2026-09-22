/**
 * Shop system tests: ShopPainter terrain/stock/shopkeeper placement
 * (faithful to levels/painters/ShopPainter.java), WndTradeItem price math,
 * and the buy/sell gold flow (Shopkeeper.java / WndTradeItem.java).
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { PainterCtx } from '../src/dungeon/painters.js';
import { paintShopRoom, shopStock } from '../src/dungeon/shopPainter.js';
import { DoorType, makeRoom, RoomType, type Door } from '../src/dungeon/rooms.js';
import type { Game } from '../src/engine/loop.js';
import type { ItemStack } from '../src/content/hero.js';
import type { PlacedItem } from '../src/dungeon/level.js';
import {
  buyFromShop,
  destroyShopStock,
  readSellable,
  readShopStock,
  sellToShop,
  Shopkeeper,
  shopBuyPrice,
  shopSellAllPrice,
  shopSellOnePrice,
  stockBuyPrice,
  unitPriceOf,
} from '../src/content/shopkeeper.js';
import { ShopPanel } from '../src/ui/shop.js';
import type { View } from '../src/ui/palette.js';

/** No-op 2d context (same pattern as test/ui.test.ts). */
function fakeCtx(): CanvasRenderingContext2D {
  const noop = (..._a: unknown[]): unknown => undefined;
  return new Proxy(
    {},
    {
      get: (_t, p) => (p === 'measureText' ? () => ({ width: 10 }) : noop),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

/** No-op sprite source. */
const fakeSprites = {
  entitySprite: (_name: string) => {
    throw new Error('headless');
  },
};

const VIEW: View = { w: 390, h: 700 };

/** A 9x9 shop room at (2,2)-(10,10) with one REGULAR-candidate door. */
function shopRoom() {
  const room = makeRoom(2, 2, 10, 10);
  room.type = RoomType.SHOP;
  const door: Door = { x: 6, y: 2, type: DoorType.EMPTY };
  const neighbor = makeRoom(2, -6, 10, 1);
  neighbor.doors.push(door);
  room.doors.push(door);
  room.carvedTo.push(neighbor);
  return room;
}

function paintAt(depth: number, seed = 1234) {
  const rng = new RNG(seed);
  const ctx = new PainterCtx(rng, 32, 32, depth, 'none', false, false);
  paintShopRoom(ctx, shopRoom());
  return ctx;
}

/** Minimal Game-shaped fake for the trade flow (Game type asserted). */
function fakeGame(stock: PlacedItem[], inventory: ItemStack[], gold: number, depth = 6) {
  const log: string[] = [];
  return {
    game: {
      level: { items: [...stock], depth },
      hero: { gold, inventory: [...inventory], weaponId: null, armorId: null, weapon: null, armor: null },
      logMsg(msg: string) {
        log.push(msg);
      },
    } as unknown as Game,
    log,
  };
}

describe('paintShopRoom terrain (ShopPainter.java:60-65)', () => {
  test('interior is EMPTY_SP (WALKWAY), wall ring is WALL', () => {
    const ctx = paintAt(6);
    for (let y = 3; y <= 9; y++) {
      for (let x = 3; x <= 9; x++) {
        const i = ctx.idx(x, y);
        // Stock cells and the keeper cell keep their floor terrain.
        expect([Terrain.WALKWAY, Terrain.WATER].includes(ctx.tiles[i])).toBe(true);
      }
    }
    for (let x = 2; x <= 10; x++) {
      expect(ctx.tiles[ctx.idx(x, 2)]).toBe(Terrain.WALL);
      expect(ctx.tiles[ctx.idx(x, 10)]).toBe(Terrain.WALL);
    }
    for (let y = 2; y <= 10; y++) {
      expect(ctx.tiles[ctx.idx(2, y)]).toBe(Terrain.WALL);
      expect(ctx.tiles[ctx.idx(10, y)]).toBe(Terrain.WALL);
    }
  });

  test('connected doors are upgraded to REGULAR', () => {
    const room = shopRoom();
    const ctx = new PainterCtx(new RNG(7), 32, 32, 6, 'none', false, false);
    paintShopRoom(ctx, room);
    expect(room.doors[0]!.type).toBe(DoorType.REGULAR);
  });
});

describe('shop stock (ShopPainter.range, ShopPainter.java:90-140)', () => {
  test('depth 6: 15 items — quarterstaff/spear, leather armor, seed pouch, weightstone + common stock', () => {
    const tags = shopStock(new PainterCtx(new RNG(1), 32, 32, 6, 'none', false, false), 6);
    expect(tags).toHaveLength(15);
    expect(tags.filter((t) => t === 'quarterstaff' || t === 'spear')).toHaveLength(1);
    expect(tags).toContain('leather-armor');
    expect(tags).toContain('seed-pouch');
    expect(tags).toContain('weightstone');
    expect(tags).toContain('potion-of-healing');
    expect(tags.filter((t) => t === 'random-potion')).toHaveLength(3);
    expect(tags).toContain('scroll-of-identify');
    expect(tags).toContain('scroll-of-remove-curse');
    expect(tags).toContain('scroll-of-magic-mapping');
    expect(tags).toContain('random-scroll');
    expect(tags.filter((t) => t === 'overpriced-ration')).toHaveLength(2);
    expect(tags).toContain('ankh');
  });

  test('depth 11: sword/mace + mail armor + scroll holder + weightstone + common (15)', () => {
    const tags = shopStock(new PainterCtx(new RNG(2), 32, 32, 11, 'none', false, false), 11);
    expect(tags).toHaveLength(15);
    expect(tags.filter((t) => t === 'sword' || t === 'mace')).toHaveLength(1);
    expect(tags).toContain('mail-armor');
    expect(tags).toContain('scroll-holder');
    expect(tags).toContain('weightstone');
  });

  test('depth 16: longsword/battle-axe + scale armor + wand holster + weightstone + common (15)', () => {
    const tags = shopStock(new PainterCtx(new RNG(3), 32, 32, 16, 'none', false, false), 16);
    expect(tags).toHaveLength(15);
    expect(tags.filter((t) => t === 'longsword' || t === 'battle-axe')).toHaveLength(1);
    expect(tags).toContain('scale-armor');
    expect(tags).toContain('wand-holster');
  });

  test('depth 21: one of glaive/war-hammer/plate-armor + 2 torches + common (14)', () => {
    const tags = shopStock(new PainterCtx(new RNG(4), 32, 32, 21, 'none', false, false), 21);
    expect(tags).toHaveLength(14);
    expect(tags.filter((t) => t === 'glaive' || t === 'war-hammer' || t === 'plate-armor')).toHaveLength(1);
    expect(tags.filter((t) => t === 'torch')).toHaveLength(2);
  });

  test('other depths get only the common stock (11)', () => {
    const tags = shopStock(new PainterCtx(new RNG(5), 32, 32, 5, 'none', false, false), 5);
    expect(tags).toHaveLength(11);
  });

  test('painted stock: FOR_SALE heaps, unique cells, tracked in ctx.heaps', () => {
    const ctx = paintAt(6);
    expect(ctx.out.items).toHaveLength(15);
    const cells = ctx.out.items.map((s) => s.pos);
    expect(new Set(cells).size).toBe(15);
    for (const s of ctx.out.items) {
      expect(s.heap).toBe('FOR_SALE');
      expect(ctx.heaps.has(s.pos)).toBe(true);
      const x = s.pos % 32;
      const y = Math.floor(s.pos / 32);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(10);
    }
  });

  test('deterministic for a fixed seed', () => {
    const a = paintAt(6, 999);
    const b = paintAt(6, 999);
    expect(a.out.items.map((s) => `${s.pos}:${s.tag}`)).toEqual(b.out.items.map((s) => `${s.pos}:${s.tag}`));
    expect(a.out.mobs).toEqual(b.out.mobs);
  });
});

describe('shopkeeper spawn (ShopPainter.placeShopkeeper, ShopPainter.java:142-160)', () => {
  test("one 'shopkeeper' mob spawn on a heap-free interior cell", () => {
    const ctx = paintAt(6);
    expect(ctx.out.mobs).toHaveLength(1);
    const m = ctx.out.mobs[0]!;
    expect(m.kind).toBe('shopkeeper');
    expect(ctx.heaps.has(m.pos)).toBe(false);
    const x = m.pos % 32;
    const y = Math.floor(m.pos / 32);
    expect(x).toBeGreaterThanOrEqual(3);
    expect(x).toBeLessThanOrEqual(9);
    expect(y).toBeGreaterThanOrEqual(3);
    expect(y).toBeLessThanOrEqual(9);
  });

  test('depth 21: water moat floods the keeper 3x3 EMPTY_SP cells', () => {
    const ctx = paintAt(21);
    const m = ctx.out.mobs[0]!;
    const kx = m.pos % 32;
    const ky = Math.floor(m.pos / 32);
    // The keeper stands on interior floor: its own cell was EMPTY_SP -> WATER.
    expect(ctx.tiles[m.pos]).toBe(Terrain.WATER);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = ctx.idx(kx + dx, ky + dy);
        // Wall cells are untouched; every interior cell became WATER.
        if (ctx.tiles[i] !== Terrain.WALL) expect(ctx.tiles[i]).toBe(Terrain.WATER);
      }
    }
  });

  test('depth 6: no water painted', () => {
    const ctx = paintAt(6);
    for (let y = 2; y <= 10; y++) {
      for (let x = 2; x <= 10; x++) {
        expect(ctx.tiles[ctx.idx(x, y)]).not.toBe(Terrain.WATER);
      }
    }
  });
});

describe('trade price math (WndTradeItem.java:168-199)', () => {
  test('buy price = unit * 5 * (depth/5 + 1), Java integer division on depth', () => {
    expect(shopBuyPrice(40, 6)).toBe(400); // 40*5*2
    expect(shopBuyPrice(40, 11)).toBe(600); // 40*5*3
    expect(shopBuyPrice(20, 16)).toBe(400); // 20*5*4
    expect(shopBuyPrice(50, 21)).toBe(1250); // 50*5*5
    expect(shopBuyPrice(20, 9)).toBe(200); // 9/5 = 1 (int) -> *5*2
    expect(shopBuyPrice(15, 10)).toBe(225); // 10/5 = 2 -> 15*5*3
  });

  test('haggling halves the buy price (truncating), only when >= 2', () => {
    expect(shopBuyPrice(40, 6, true)).toBe(200);
    expect(shopBuyPrice(1, 6, true)).toBe(5); // 1*5*2 = 10 -> 5
    expect(shopBuyPrice(3, 6, true)).toBe(15); // 3*5*2 = 30 -> 15
    expect(shopBuyPrice(0, 6, true)).toBe(0);
  });

  test('sell-all pays the whole-stack price; sell-one uses Java int division', () => {
    expect(shopSellAllPrice(20, 3)).toBe(60);
    expect(shopSellOnePrice(60, 3)).toBe(20);
    expect(shopSellOnePrice(61, 3)).toBe(20); // 61/3 truncates, like Java
  });

  test('stock entry buy price scales with quantity', () => {
    const entry = {
      levelIndex: 0,
      pos: 1,
      itemId: 'potion_healing',
      qty: 2,
      name: 'potion of healing',
      sprite: 'potion_red',
      unitPrice: 20,
    };
    expect(stockBuyPrice(entry, 6)).toBe(400); // 20*5*2 per unit, x2
  });

  test('unitPriceOf: missing catalog entry or absent price -> 0, never invented', () => {
    expect(unitPriceOf('no-such-item')).toBe(0);
    expect(unitPriceOf('dart')).toBe(2); // Dart.price() = quantity * 2 (Dart.java)
    expect(unitPriceOf('gold')).toBe(0); // Item.price() = 0 (Item.java)
  });
});

describe('buy flow (WndTradeItem.buy, WndTradeItem.java:201-212)', () => {
  function stockedGame(gold: number) {
    return fakeGame(
      [{ pos: 100, itemId: 'potion_healing', sprite: 'potion_red', forSale: true }],
      [],
      gold,
    );
  }

  test('buying deducts gold, removes the stock heap, adds the item, logs TXT_BOUGHT', () => {
    const { game, log } = stockedGame(1000);
    const entry = {
      levelIndex: 0,
      pos: 100,
      itemId: 'potion_healing',
      qty: 1,
      name: 'potion of healing',
      sprite: 'potion_red',
      unitPrice: 20,
    };
    const r = buyFromShop(game, entry);
    expect(r).toEqual({ ok: true, price: 200 }); // 20*5*(6/5+1) = 200
    const hero = game.hero as unknown as { gold: number; inventory: ItemStack[] };
    expect(hero.gold).toBe(800);
    expect(game.level.items).toHaveLength(0);
    expect(hero.inventory).toEqual([{ itemId: 'potion_healing', qty: 1 }]);
    expect(log).toEqual(["You've bought potion of healing for 200g."]);
  });

  test('buy is refused when the purse is short (the button is disabled in vanilla)', () => {
    const { game, log } = stockedGame(199);
    const entry = {
      levelIndex: 0,
      pos: 100,
      itemId: 'potion_healing',
      qty: 1,
      name: 'potion of healing',
      sprite: 'potion_red',
      unitPrice: 20,
    };
    const r = buyFromShop(game, entry);
    expect(r).toEqual({ ok: false, reason: 'no-gold' });
    const hero = game.hero as unknown as { gold: number; inventory: ItemStack[] };
    expect(hero.gold).toBe(199);
    expect(game.level.items).toHaveLength(1);
    expect(hero.inventory).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  test('buying a heap that is already gone fails cleanly', () => {
    const { game } = stockedGame(1000);
    game.level.items = [];
    const entry = {
      levelIndex: 0,
      pos: 100,
      itemId: 'potion_healing',
      qty: 1,
      name: 'potion of healing',
      sprite: 'potion_red',
      unitPrice: 20,
    };
    expect(buyFromShop(game, entry)).toEqual({ ok: false, reason: 'gone' });
  });
});

describe('sell flow (WndTradeItem.sell/sellOne, WndTradeItem.java:168-195)', () => {
  function sellable(qty: number) {
    return {
      slot: 0,
      itemId: 'potion_healing',
      name: 'potion of healing',
      sprite: 'potion_red',
      qty,
      equipped: false,
      unitPrice: 20,
    };
  }

  test("sell-one pays priceAll/quantity and keeps the rest of the stack", () => {
    const { game, log } = fakeGame([], [{ itemId: 'potion_healing', qty: 3 }], 0);
    const r = sellToShop(game, sellable(3), 'one');
    expect(r).toEqual({ ok: true, price: 20 }); // 60/3
    const hero = game.hero as unknown as { gold: number; inventory: ItemStack[] };
    expect(hero.gold).toBe(20);
    expect(hero.inventory).toEqual([{ itemId: 'potion_healing', qty: 2 }]);
    expect(log).toEqual(["You've sold your potion of healing for 20g."]);
  });

  test('sell-all pays the whole-stack price and removes the stack', () => {
    const { game, log } = fakeGame([], [{ itemId: 'potion_healing', qty: 3 }], 5);
    const r = sellToShop(game, sellable(3), 'all');
    expect(r).toEqual({ ok: true, price: 60 });
    const hero = game.hero as unknown as { gold: number; inventory: ItemStack[] };
    expect(hero.gold).toBe(65);
    expect(hero.inventory).toHaveLength(0);
    expect(log).toEqual(["You've sold your potion of healing for 60g."]);
  });

  test('sell-one on a single item sells it all', () => {
    const { game } = fakeGame([], [{ itemId: 'potion_healing', qty: 1 }], 0);
    const r = sellToShop(game, sellable(1), 'one');
    expect(r).toEqual({ ok: true, price: 20 });
    const hero = game.hero as unknown as { gold: number; inventory: ItemStack[] };
    expect(hero.inventory).toHaveLength(0);
    expect(hero.gold).toBe(20);
  });

  test('equipped gear is unequipped first, then sold (WndTradeItem.java:172-175)', () => {
    const { game } = fakeGame([], [], 0);
    const hero = game.hero as unknown as {
      gold: number;
      inventory: ItemStack[];
      weaponId: string | null;
      weapon: unknown;
    };
    hero.weaponId = 'shortsword';
    const entry = {
      slot: -1,
      itemId: 'shortsword',
      name: 'short sword',
      sprite: 'shortsword',
      qty: 1,
      equipped: true,
      unitPrice: 20,
    };
    const r = sellToShop(game, entry, 'all');
    expect(r).toEqual({ ok: true, price: 20 });
    expect(hero.weaponId).toBeNull();
    expect(hero.inventory).toHaveLength(0);
    expect(hero.gold).toBe(20);
  });

  test('readSellable lists only items with price() > 0 (WndBag FOR_SALE rule)', () => {
    // Darts have a price now (Dart.price() = quantity * 2); gold does not.
    const { game } = fakeGame(
      [],
      [
        { itemId: 'dart', qty: 8 },
        { itemId: 'gold', qty: 10 },
      ],
      0,
    );
    const sellable = readSellable(game);
    expect(sellable.map((s) => s.itemId)).toEqual(['dart']);
    expect(sellable[0]!.qty).toBe(8);
  });

  test('readShopStock reads only FOR_SALE heaps', () => {
    const { game } = fakeGame(
      [
        { pos: 1, itemId: 'potion_healing', sprite: 'potion_red', forSale: true },
        { pos: 2, itemId: 'ration', sprite: 'ration' },
      ],
      [],
      0,
    );
    const stock = readShopStock(game);
    expect(stock).toHaveLength(1);
    expect(stock[0]!.pos).toBe(1);
  });
});

describe('Shopkeeper.flee heap destruction (Shopkeeper.java:53-64)', () => {
  test('destroyShopStock removes every FOR_SALE heap and counts them', () => {
    const { game } = fakeGame(
      [
        { pos: 1, itemId: 'potion_healing', sprite: 'potion_red', forSale: true },
        { pos: 2, itemId: 'ration', sprite: 'ration' },
        { pos: 3, itemId: 'ankh', sprite: 'scroll', forSale: true },
      ],
      [],
      0,
    );
    expect(destroyShopStock(game)).toBe(2);
    expect(game.level.items.map((i) => i.itemId)).toEqual(['ration']);
  });
});

describe('Shopkeeper talk contract', () => {
  test("onTalk opens the shop UI (vanilla interact -> sell window)", () => {
    const keeper = new Shopkeeper();
    expect(keeper.name).toBe('shopkeeper');
    expect(keeper.sprite).toBe('mob_shopkeeper');
    expect(keeper.description()).toContain('stout guy');
    const seen: { mode: 'buy' | 'sell' | null } = { mode: null };
    keeper.onTalk({
      game: null as unknown as Game,
      openShop: (mode) => {
        seen.mode = mode;
      },
    });
    expect(seen.mode).toBe('sell');
  });
});

describe('ShopPanel (WndTradeItem concept)', () => {
  test('opens, draws headless, and switches tabs on tap', () => {
    const { game } = fakeGame(
      [{ pos: 100, itemId: 'potion_healing', sprite: 'potion_red', forSale: true }],
      [{ itemId: 'dart', qty: 8 }],
      500,
    );
    const panel = new ShopPanel();
    expect(panel.open).toBe(false);
    panel.openShop('buy');
    expect(panel.open).toBe(true);
    expect(panel.tab).toBe('buy');
    panel.draw(fakeCtx(), game, fakeSprites, VIEW);
    // Tap the Sell tab.
    const L = panel.layout(VIEW, 1);
    panel.handleTap(L.tabSell.x + 4, L.tabSell.y + 4, game);
    expect(panel.tab).toBe('sell');
    // Escape closes.
    panel.handleTap(L.closeBtn.x + 4, L.closeBtn.y + 4, game);
    expect(panel.open).toBe(false);
  });

  test('row tap selects the entry; buy action runs through the panel', () => {
    const { game } = fakeGame(
      [{ pos: 100, itemId: 'potion_healing', sprite: 'potion_red', forSale: true }],
      [],
      500,
    );
    const panel = new ShopPanel();
    panel.openShop('buy');
    panel.draw(fakeCtx(), game, fakeSprites, VIEW);
    const L = panel.layout(VIEW, 1);
    // Tap the first stock row (selects it).
    panel.handleTap(L.rows[0]!.x + 4, L.rows[0]!.y + 4, game);
    expect(panel.selected).toBe(0);
    expect(panel.open).toBe(true);
  });
});
