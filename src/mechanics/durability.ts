/**
 * Vanilla durability / curse / upgrade model — exact port of the logic in
 * Item.java, Weapon.java, Armor.java and Wand.java (watabou/pixel-dungeon).
 *
 * - Maximum durability: Weapon.maxDurability = 5 * (lvl < 16 ? 16 - lvl : 1),
 *   Armor/Wand.maxDurability = 6 * (lvl < 16 ? 16 - lvl : 1), where
 *   lvl = max(0, level) (Weapon.java / Armor.java / Wand.java).
 * - Item.use() (Item.java:301-324): durability drops only when level > 0 and
 *   the item is not broken. Warning crosses (int)(maxDurability * 1/6)
 *   (DURABILITY_WARNING_LEVEL = 1/6f, Item.java:66); breaking logs.
 * - Item.effectiveLevel() (Item.java): broken items behave as level 0.
 * - Item.fix() (Item.java): restore durability to the current maximum.
 * - Item.polish() (Item.java): +1 durability, never above the maximum.
 * - Item.upgrade() (Item.java:265-274): clears curse, sets cursedKnown, +1
 *   level, then fix(). Item.degrade(): -1 level, then fix() (no uncurse).
 * - Weapon.upgrade(boolean)/Armor.upgrade(boolean): when upgrading WITHOUT
 *   the inscribe/enchant flag, an existing enchantment/glyph is erased with
 *   `Random.Int(level()) > 0` evaluated against the pre-upgrade level
 *   (Weapon.java / Armor.java:150-168).
 *
 * These helpers are pure and operate on a minimal structural interface so
 * both equipped gear (WeaponDef/ArmorDef) and backpack instance state can
 * use them.
 */
import type { MechanicsRng } from './rng.js';

/** Gear kinds with a durability model (Weapon.java / Armor.java / Wand.java). */
export type DurableKind = 'weapon' | 'armor' | 'wand';

/** Minimal per-instance gear state: upgrade level, current durability,
 *  curse flags (EquipableItem.java). */
export interface DurableItem {
  /** Upgrade level (Item.level). */
  level: number;
  /** Current durability (Item.durability). Absent/undefined means "fresh":
   *  callers initialize via initDurability(). */
  durability?: number;
  /** Cursed gear cannot be unequipped (EquipableItem.doUnequip). */
  cursed?: boolean;
  /** Whether the curse state is known to the player. */
  cursedKnown?: boolean;
}

/** Warning threshold fraction (Item.DURABILITY_WARNING_LEVEL = 1/6f). */
export const DURABILITY_WARNING_LEVEL = 1 / 6;

/** GLog.w text when durability crosses the warning threshold (Item.java:59). */
export const TXT_GOING_TO_BREAK =
  'Because of frequent use, your %s is going to break soon.';
/** GLog.n text when an item breaks (Item.java:58). */
export const TXT_HAS_BROKEN = 'Because of frequent use, your %s has broken.';
/** GLog.w when an upgrade erases a weapon enchantment
 *  (Weapon.java:41-42, TXT_INCOMPATIBLE). */
export const TXT_INCOMPATIBLE_WEAPON =
  'Interaction of different types of magic has negated the enchantment on this weapon!';
/** GLog.w when an upgrade erases an armor glyph
 *  (Armor.java:48-49, TXT_INCOMPATIBLE). */
export const TXT_INCOMPATIBLE_ARMOR =
  'Interaction of different types of magic has erased the glyph on this armor!';
/** "you wince as your grip involuntarily tightens around your %s"
 *  (KindOfWeapon.java:30). */
export const TXT_EQUIP_CURSED_WEAPON =
  'you wince as your grip involuntarily tightens around your %s';
/** "your %s constricts around you painfully" (Armor.java:41). */
export const TXT_EQUIP_CURSED_ARMOR = 'your %s constricts around you painfully';
/** "You can't remove cursed %s!" (EquipableItem.java). */
export const TXT_UNEQUIP_CURSED = "You can't remove cursed %s!";

/**
 * Maximum durability for a gear kind at a level
 * (Weapon.maxDurability / Armor.maxDurability / Wand.maxDurability).
 */
export function maxDurability(kind: DurableKind, level: number): number {
  const lvl = level < 0 ? 0 : level;
  return (kind === 'weapon' ? 5 : 6) * (lvl < 16 ? 16 - lvl : 1);
}

/**
 * Initialize durability on a fresh item (the Java field initializer
 * `durability = maxDurability()` runs at construction).
 */
export function initDurability(item: DurableItem, kind: DurableKind): void {
  if (item.durability === undefined) {
    item.durability = maxDurability(kind, item.level);
  }
}

/** Item.isBroken(): durability() <= 0. */
export function isBroken(item: Pick<DurableItem, 'durability'>): boolean {
  return (item.durability ?? 1) <= 0;
}

/**
 * Item.effectiveLevel(): a broken item behaves as level 0
 * (Item.java — used by damage rolls, DR, enchantment level, ...).
 */
export function effectiveLevel(
  item: Pick<DurableItem, 'level' | 'durability'>,
): number {
  return isBroken(item) ? 0 : item.level;
}

/** Item.fix(): durability back to the current maximum. */
export function fixDurability(item: DurableItem, kind: DurableKind): void {
  item.durability = maxDurability(kind, item.level);
}

/**
 * Item.polish(): +1 durability, never above the maximum
 * (Tempering enchantment, AutoRepair glyph).
 */
export function polish(item: DurableItem, kind: DurableKind): void {
  initDurability(item, kind);
  const max = maxDurability(kind, item.level);
  if (item.durability! < max) {
    item.durability = item.durability! + 1;
  }
}

export interface DurabilityUse {
  /** Crossed the (int)(max/6) warning threshold this use (Item.java:304). */
  warned: boolean;
  /** The item broke on this use (Item.java:307). */
  broke: boolean;
}

/**
 * Item.use() (Item.java:301-324): durability decreases by 1 only when
 * level > 0 and the item is not already broken. The warning fires when the
 * decrement crosses `threshold = (int)(maxDurability * 1/6)` from above
 * (`durability-- >= threshold && threshold > durability`, Item.java:304).
 * `levelKnown` gates the log lines exactly as in vanilla.
 */
export function useDurability(
  item: DurableItem,
  kind: DurableKind,
  levelKnown: boolean,
): DurabilityUse {
  initDurability(item, kind);
  if (item.level <= 0 || isBroken(item)) {
    return { warned: false, broke: false };
  }
  const threshold = Math.floor(
    maxDurability(kind, item.level) * DURABILITY_WARNING_LEVEL,
  );
  const before = item.durability!;
  item.durability = Math.max(0, before - 1);
  return {
    warned: levelKnown && before >= threshold && item.durability < threshold,
    broke: isBroken(item),
  };
}

/**
 * Item.upgrade() (Item.java:265-274): clears the curse, marks it known,
 * +1 level, then fix().
 */
export function upgradeItem(item: DurableItem, kind: DurableKind): void {
  item.cursed = false;
  item.cursedKnown = true;
  item.level += 1;
  fixDurability(item, kind);
}

/**
 * Item.degrade() (Item.java): -1 level, then fix(). The curse is NOT
 * cleared.
 */
export function degradeItem(item: DurableItem, kind: DurableKind): void {
  item.level -= 1;
  fixDurability(item, kind);
}

/**
 * Weapon.upgrade(boolean)/Armor.upgrade(boolean) enchantment/glyph erasure
 * (Weapon.java / Armor.java:150-168): when upgrading WITHOUT the
 * inscribe/enchant flag, an existing enchantment/glyph is erased when
 * `Random.Int(level()) > 0`, evaluated against the pre-upgrade level.
 * Returns true when the magic should be erased.
 */
export function upgradeErasesMagic(
  rng: { int(min: number, max: number): number },
  preUpgradeLevel: number,
  inscribe: boolean,
  hasMagic: boolean,
): boolean {
  if (!hasMagic || inscribe) {
    return false;
  }
  return rng.int(0, preUpgradeLevel) > 0;
}

/**
 * Weapon.upgrade(boolean) erasure (Weapon.java:150-164): at the pre-upgrade
 * level, a non-preserving upgrade strips the enchantment with the exact
 * TXT_INCOMPATIBLE warning. ScrollOfUpgrade calls upgrade(false).
 */
export function eraseWeaponMagic(
  weapon: { enchantment?: { id: string } | string | null; level: number },
  rng: MechanicsRng,
  preserve: boolean,
  log: (msg: string) => void,
): void {
  if (
    weapon.enchantment &&
    upgradeErasesMagic(rng, weapon.level, preserve, true)
  ) {
    weapon.enchantment = null;
    log(TXT_INCOMPATIBLE_WEAPON);
  }
}

/**
 * Armor.upgrade(boolean) erasure (Armor.java:150-168): same shape with the
 * armor TXT_INCOMPATIBLE warning. ScrollOfUpgrade calls upgrade(false).
 */
export function eraseArmorMagic(
  armor: { glyph?: { id: string } | string | null; level: number },
  rng: MechanicsRng,
  preserve: boolean,
  log: (msg: string) => void,
): void {
  if (armor.glyph && upgradeErasesMagic(rng, armor.level, preserve, true)) {
    armor.glyph = null;
    log(TXT_INCOMPATIBLE_ARMOR);
  }
}
