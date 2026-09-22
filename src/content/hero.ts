/**
 * Content-side hero state for Milestone 1.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src (Hero.java + Belongings.java +
 * HeroClass WARRIOR, HeroClass.java:97-124). Java wins every conflict.
 *
 * Positions are CELL INDICES (pos = y*w + x) everywhere here; x/y are
 * derived for the engine seam (src/engine/seams.ts HeroActor).
 *
 * Inventory model: the single source of truth. Equipped gear lives on the
 * hero (weapon/armor fields, like Belongings.weapon/armor); everything else
 * (potions, scrolls, food, darts, keys) is an ItemStack in inventory
 * (Belongings.backpack).
 */
import { Actor } from '../core/turn.js';
import type { HeroActor } from '../engine/seams.js';
import type {
  ArmorDef,
  Hero,
  WeaponDef,
} from '../mechanics/char.js';
import type { BuffKind } from '../mechanics/buffs.js';
import type { BuffState } from '../mechanics/char.js';
import { getItem } from './items.js';

/** One inventory slot: catalog id + count (stacks merge for stackables). */
export interface ItemStack {
  itemId: string;
  qty: number;
}

/**
 * Live hero. Implements both the engine's HeroActor (x/y) and the
 * mechanics Hero shape (pos + stats + buffs) so mechanics formulas take it
 * directly.
 */
export class ContentHero extends Actor implements HeroActor, Hero {
  readonly kind = 'hero' as const;
  readonly id = 0;
  /** Cell index — the canonical position (SPEC binding). */
  pos: number;
  /** Level width, for pos <-> x/y conversion. */
  w: number;
  hp = 20; // Belongings/WARRIOR: Hero.HT(0) = 20 (Hero.java:55-63)
  ht = 20;
  sprite = 'hero_warrior';
  name = 'you';
  sight = 8; // Char.viewDistance
  paralysed = false;
  rooted = false;
  flying = false;
  buffs: Partial<Record<BuffKind, BuffState>> = {};
  immunities: string[] = [];
  resistances: string[] = [];

  str = 11; // WARRIOR STR (HeroClass.java:101)
  weakened = false;
  lvl = 1;
  exp = 0;
  attackSkill = 10; // Hero.ATTACK (Hero.java:50)
  defenseSkill = 5; // Hero.DEFENSE (Hero.java:50)
  /**
   * Secret-discovery chance for passive search (Hero.awareness, Hero.java:162;
   * 0.1 for the warrior, Hero.java:175). M1: flat 0.1 — vanilla's
   * updateAwareness() level scaling (Hero.java:1064-1069) is not ported.
   */
  awareness = 0.1;

  weapon: WeaponDef | null = null;
  weaponId: string | null = null;
  armor: ArmorDef | null = null;
  armorId: string | null = null;
  rangedWeapon: WeaponDef | null = null;
  darts = 0;

  /** Belongings.backpack (unequipped gear, potions, scrolls, food, darts, keys). */
  inventory: ItemStack[] = [];
  gold = 0;

  hungerLevel = 0;
  hungerClock = 0;

  constructor(pos: number, w: number) {
    super();
    this.pos = pos;
    this.w = w;
  }

  get x(): number {
    return this.pos % this.w;
  }
  set x(v: number) {
    this.pos = this.y * this.w + v;
  }
  get y(): number {
    return Math.floor(this.pos / this.w);
  }
  set y(v: number) {
    this.pos = v * this.w + this.x;
  }

  getSpeed(): number {
    return 1; // Char.speed() (Hero.java:306)
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  /**
   * The engine drives the hero through MechanicsHooks.handleHeroIntent,
   * not this. (Kept to satisfy the HeroActor structural type.)
   */
  act(): number {
    throw new Error(
      'ContentHero.act: route through MechanicsHooks.handleHeroIntent',
    );
  }
}

/** Starting warrior (HeroClass.setup, HeroClass.java:97-124). */
export function createStarterHero(pos: number, w: number): ContentHero {
  const hero = new ContentHero(pos, w);
  const sword = getItem('shortsword');
  const armor = getItem('cloth_armor');
  hero.weapon = sword.weapon ? { ...sword.weapon } : null;
  hero.weaponId = 'shortsword';
  hero.armor = armor.armor ? { ...armor.armor } : null;
  hero.armorId = 'cloth_armor';
  // Belongings: ClothArmor identified & equipped, Food x1 in the backpack,
  // Dart x8 in the backpack (HeroClass.java:116-123). Keyring: M1 has no
  // keyring — keys stack in the inventory like other items (documented).
  hero.inventory.push({ itemId: 'ration', qty: 1 });
  hero.inventory.push({ itemId: 'dart', qty: 8 });
  syncDarts(hero);
  return hero;
}

/** Keep hero.darts in sync with the dart stack in the inventory. */
export function syncDarts(hero: ContentHero): void {
  hero.darts =
    hero.inventory.find((s) => s.itemId === 'dart')?.qty ?? 0;
}

/** Add an item stack, merging with an existing stack for stackables. */
export function addToInventory(
  hero: ContentHero,
  itemId: string,
  qty: number,
): void {
  const def = getItem(itemId);
  if (qty <= 0) return;
  if (def.stackable) {
    const existing = hero.inventory.find((s) => s.itemId === itemId);
    if (existing) {
      existing.qty += qty;
    } else {
      hero.inventory.push({ itemId, qty });
    }
  } else {
    for (let i = 0; i < qty; i++) {
      hero.inventory.push({ itemId, qty: 1 });
    }
  }
  syncDarts(hero);
}

/**
 * Remove up to `qty` from a slot. Returns the removed stack or null.
 * (Item.split, Item.java:248-273.)
 */
export function removeFromInventory(
  hero: ContentHero,
  slot: number,
  qty = 1,
): ItemStack | null {
  const stack = hero.inventory[slot];
  if (!stack || qty <= 0) return null;
  const take = Math.min(qty, stack.qty);
  const removed: ItemStack = { itemId: stack.itemId, qty: take };
  stack.qty -= take;
  if (stack.qty <= 0) {
    hero.inventory.splice(slot, 1);
  }
  syncDarts(hero);
  return removed;
}

/** Count of a stackable item across the inventory. */
export function countItem(hero: ContentHero, itemId: string): number {
  return hero.inventory
    .filter((s) => s.itemId === itemId)
    .reduce((n, s) => n + s.qty, 0);
}
