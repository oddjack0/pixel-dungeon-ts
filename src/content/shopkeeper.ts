/**
 * Shopkeeper NPC logic — faithful port of vanilla
 * `actors/mobs/npcs/Shopkeeper.java`, `actors/mobs/npcs/NPC.java` (trade
 * halves) and `windows/WndTradeItem.java` (price math, buy/sell flow).
 * GPL-3.0, (C) Oleg Dolya.
 *
 * Vanilla trade rules (all cited below):
 * - The hero BUYS shop stock at item.price() * 5 * (depth/5 + 1) gold
 *   (WndTradeItem.price, WndTradeItem.java:191-199), halved by the
 *   RingOfHaggler Haggling buff when the result is >= 2.
 * - The hero SELLS their own items for item.price() of the whole stack
 *   (WndTradeItem.sell, WndTradeItem.java:168-180); selling one out of a
 *   stack pays priceAll / quantity with Java integer division
 *   (WndTradeItem.sellOne + TXT_SELL_1, WndTradeItem.java:108, 182-195).
 * - Only items with price() > 0 can be sold, and equipped-but-cursed items
 *   cannot (WndBag FOR_SALE enable rule, WndBag.java: sellable =
 *   price() > 0 && (!equipped || !cursed)). The port has no cursed items
 *   yet, so equipped gear is sellable after an automatic unequip — mirroring
 *   WndTradeItem.sell's doUnequip-first behavior (WndTradeItem.java:172-175).
 *
 * NOTE on vanilla Shopkeeper "greeting": Shopkeeper.interact() opens the
 * sell window immediately (Shopkeeper.java:96-98) — there is no greeting
 * line in vanilla, so onTalk opens the shop UI directly. The flavor text is
 * description() (Shopkeeper.java:67-73).
 */
import type { Game } from '../engine/loop.js';
import { addToInventory, type ContentHero, type ItemStack } from './hero.js';
import { getItem, parseItemId } from './items.js';
import type { PlacedItem } from '../dungeon/level.js';

/** The per-unit shop value of a catalog item: vanilla Item.price() for one.
 *  Missing catalog entries or absent prices resolve to 0 (never invented). */
export function unitPriceOf(itemId: string): number {
  try {
    const { defId } = parseItemId(itemId);
    return getItem(defId).price ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Hero buys FROM the shop. Vanilla `WndTradeItem.price(Item)`:
 * `item.price() * 5 * (Dungeon.depth / 5 + 1)` with Java integer division on
 * depth/5 (WndTradeItem.java:193), halved (truncating) by Haggling when the
 * result is >= 2 (WndTradeItem.java:196-198). Stage 1 has no rings, so
 * `haggling` defaults to false.
 */
export function shopBuyPrice(unitPrice: number, depth: number, haggling = false): number {
  let price = unitPrice * 5 * (Math.floor(depth / 5) + 1);
  if (haggling && price >= 2) price = Math.floor(price / 2);
  return price;
}

/**
 * Hero sells TO the shop, whole stack. Vanilla `WndTradeItem.sell` pays
 * `item.price()` — the whole-stack price (WndTradeItem.java:177).
 */
export function shopSellAllPrice(unitPrice: number, qty: number): number {
  return unitPrice * qty;
}

/**
 * Hero sells TO the shop, one item out of a stack. Vanilla shows
 * `priceAll / item.quantity()` (WndTradeItem.java:108) with Java integer
 * division and pays the detached single item's price()
 * (WndTradeItem.sellOne, WndTradeItem.java:182-195).
 */
export function shopSellOnePrice(stackPrice: number, qty: number): number {
  return Math.floor(stackPrice / qty);
}

/** One FOR_SALE heap on the level (vanilla Heap.Type.FOR_SALE). */
export interface ShopStockEntry {
  /** Index into game.level.items (resolved at read time). */
  levelIndex: number;
  pos: number;
  itemId: string;
  qty: number;
  name: string;
  sprite: string;
  unitPrice: number;
}

/** Read the shop's current stock from the level. */
export function readShopStock(game: Game): ShopStockEntry[] {
  const out: ShopStockEntry[] = [];
  game.level.items.forEach((it, levelIndex) => {
    if (!it.forSale) return;
    const { defId, qty } = parseItemId(it.itemId);
    let name = it.itemId;
    let sprite = it.sprite;
    try {
      const def = getItem(defId);
      name = def.name;
      sprite = def.sprite;
    } catch {
      /* unknown catalog id: surface the raw id, price 0 */
    }
    out.push({ levelIndex, pos: it.pos, itemId: it.itemId, qty, name, sprite, unitPrice: unitPriceOf(it.itemId) });
  });
  return out;
}

/** Full buy price for a stock entry (vanilla prices the whole heap). */
export function stockBuyPrice(entry: ShopStockEntry, depth: number, haggling = false): number {
  return shopBuyPrice(entry.unitPrice, depth, haggling) * entry.qty;
}

/** One hero item the shopkeeper will buy (WndBag.Mode.FOR_SALE). */
export interface SellableEntry {
  /** Index into hero.inventory, or -1 (weapon) / -2 (armor) when equipped. */
  slot: number;
  itemId: string;
  name: string;
  sprite: string;
  qty: number;
  equipped: boolean;
  unitPrice: number;
}

/**
 * Read the hero's sellable items. Vanilla WndBag FOR_SALE enable rule:
 * `item.price() > 0 && (!item.isEquipped(hero) || !item.cursed)`
 * (WndBag.java, ItemButton.item). The port has no cursed items, so equipped
 * gear is listed (selling unequips it first, as WndTradeItem.sell does).
 */
export function readSellable(game: Game): SellableEntry[] {
  const hero = game.hero as unknown as ContentHero;
  const out: SellableEntry[] = [];
  hero.inventory.forEach((stack, slot) => {
    const unitPrice = unitPriceOf(stack.itemId);
    if (unitPrice <= 0) return;
    const { defId } = parseItemId(stack.itemId);
    let name = stack.itemId;
    let sprite = 'scroll';
    try {
      const def = getItem(defId);
      name = def.name;
      sprite = def.sprite;
    } catch {
      /* raw id, price already 0-excluded above */
    }
    out.push({ slot, itemId: stack.itemId, name, sprite, qty: stack.qty, equipped: false, unitPrice });
  });
  // Equipped weapon/armor (vanilla sells these too after doUnequip).
  for (const [slot, id, equipped] of [
    [-1, hero.weaponId, true],
    [-2, hero.armorId, true],
  ] as const) {
    if (!id) continue;
    const unitPrice = unitPriceOf(id);
    if (unitPrice <= 0) continue;
    const def = getItem(parseItemId(id).defId);
    out.push({ slot, itemId: id, name: def.name, sprite: def.sprite, qty: 1, equipped, unitPrice });
  }
  return out;
}

export type BuyResult = { ok: true; price: number } | { ok: false; reason: 'no-gold' | 'gone' };

/**
 * Buy a stock entry. Vanilla `WndTradeItem.buy(Heap)` (WndTradeItem.java:201-212):
 * price is charged from the purse, the item goes to the hero (or drops at the
 * heap when the backpack is full — the port's inventory is unbounded, so
 * pickup always succeeds), and "You've bought %s for %dg" is logged.
 * The buy button is disabled when price > gold (WndTradeItem.java:128).
 */
export function buyFromShop(game: Game, entry: ShopStockEntry, haggling = false): BuyResult {
  const hero = game.hero as unknown as ContentHero;
  const placed: PlacedItem | undefined = game.level.items[entry.levelIndex];
  if (!placed || !placed.forSale || placed.pos !== entry.pos) {
    return { ok: false, reason: 'gone' };
  }
  const price = stockBuyPrice(entry, game.level.depth, haggling);
  if (hero.gold < price) return { ok: false, reason: 'no-gold' };

  hero.gold -= price;
  game.level.items.splice(entry.levelIndex, 1);
  const { defId, qty } = parseItemId(entry.itemId);
  addToInventory(hero, defId, qty);
  game.logMsg(`You've bought ${entry.name} for ${price}g.`); // TXT_BOUGHT (WndTradeItem.java:30)
  return { ok: true, price };
}

export type SellResult = { ok: true; price: number } | { ok: false; reason: 'gone' };

/**
 * Sell a hero item. Vanilla `WndTradeItem.sell` / `sellOne`
 * (WndTradeItem.java:168-195): equipped items are unequipped first (the sale
 * aborts when that fails — impossible in the port, which has no cursed
 * items); the gold paid is item.price() for the whole stack, or one item's
 * price when selling a single out of a stack; "You've sold your %s for %dg"
 * is logged (TXT_SOLD, WndTradeItem.java:32).
 */
export function sellToShop(game: Game, entry: SellableEntry, which: 'one' | 'all'): SellResult {
  const hero = game.hero as unknown as ContentHero;

  // WndTradeItem.sell: unequip first (WndTradeItem.java:172-175).
  let stack: ItemStack | undefined;
  if (entry.slot === -1) {
    if (hero.weaponId !== entry.itemId) return { ok: false, reason: 'gone' };
    addToInventory(hero, hero.weaponId, 1);
    hero.weapon = null;
    hero.weaponId = null;
    stack = hero.inventory[hero.inventory.length - 1];
  } else if (entry.slot === -2) {
    if (hero.armorId !== entry.itemId) return { ok: false, reason: 'gone' };
    addToInventory(hero, hero.armorId, 1);
    hero.armor = null;
    hero.armorId = null;
    stack = hero.inventory[hero.inventory.length - 1];
  } else {
    stack = hero.inventory[entry.slot];
  }
  if (!stack || stack.itemId !== entry.itemId) return { ok: false, reason: 'gone' };

  const stackPrice = shopSellAllPrice(entry.unitPrice, stack.qty);
  let price: number;
  if (which === 'one' && stack.qty > 1) {
    // WndTradeItem.sellOne: detach one, pay that single item's price.
    price = shopSellOnePrice(stackPrice, stack.qty);
    stack.qty -= 1;
  } else {
    price = stackPrice;
    hero.inventory.splice(hero.inventory.indexOf(stack), 1);
  }
  hero.gold += price;
  game.logMsg(`You've sold your ${entry.name} for ${price}g.`); // TXT_SOLD (WndTradeItem.java:32)
  return { ok: true, price };
}

/**
 * Vanilla `Shopkeeper.flee` (Shopkeeper.java:53-64): when the shopkeeper is
 * hurt or buffed, every FOR_SALE heap is destroyed and the keeper vanishes.
 * This helper does the heap-destruction half (pure level state); removing
 * the mob itself and the ElmoParticle bursts belong to the mob/engine
 * worker that owns NPC actors.
 *
 * @returns the number of stock heaps destroyed.
 */
export function destroyShopStock(game: Game): number {
  const before = game.level.items.length;
  game.level.items = game.level.items.filter((it) => !it.forSale);
  return before - game.level.items.length;
}

/** Context handed to the shopkeeper when the hero talks to it. The quest
 *  worker (which owns NPC talk routing) wires click/tap to `onTalk`. */
export interface ShopTalkCtx {
  game: Game;
  /** Opens the shop trade UI (owned by the UiManager). */
  openShop: (mode: 'buy' | 'sell') => void;
}

/**
 * The shopkeeper NPC. Vanilla `Shopkeeper.java` (102 lines): a passive,
 * non-hostile NPC (NPC.java: HP=HT=1, EXP=0, hostile=false, PASSIVE) that
 * throws misplaced items off its tile each turn (NPC.throwItem,
 * Shopkeeper.act), turns to face the hero, and opens the trade UI on
 * interact (Shopkeeper.java:96-98). Combat/AI scheduling belongs to the mob
 * worker; this class is the talk contract.
 */
export class Shopkeeper {
  readonly name = 'shopkeeper'; // Shopkeeper.java:28
  readonly sprite = 'mob_shopkeeper'; // ShopkeeperSprite.java (idle frame 0, 14x14)

  /** Vanilla interact(): sell() — "Select an item to sell" (Shopkeeper.java:82-98). */
  onTalk(ctx: ShopTalkCtx): void {
    ctx.openShop('sell');
  }

  /** Shopkeeper.description() (Shopkeeper.java:67-73). */
  description(): string {
    return (
      'This stout guy looks more appropriate for a trade district in some large city ' +
      'than for a dungeon. His prices explain why he prefers to do business here.'
    );
  }
}
