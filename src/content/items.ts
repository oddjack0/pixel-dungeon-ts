/**
 * M1 item catalog — data-driven item definitions for the Sewers depths 1-4
 * (+ Goo's skeleton key on depth 5).
 *
 * Every def carries Java citations (file + line). Stats mirror the Java item
 * classes exactly; behavior (drink/eat/equip/throw) is implemented in
 * src/content/actions.ts and hooks into src/mechanics/ (combat, hunger).
 *
 * M1 scope (per SPEC): short sword only (no other melee), darts, cloth armor,
 * potion of healing, potion of strength, ration, scroll placeholder.
 * Gold / iron key / skeleton key are included because the generator, mob
 * loot, and the Goo encounter require them.
 */
import type { ArmorDef, WeaponDef } from '../mechanics/char';
import { SPRITES } from '../assets/sprites';

export type ItemType =
  | 'weapon'
  | 'armor'
  | 'missile'
  | 'potion'
  | 'food'
  | 'scroll'
  | 'gold'
  | 'key'
  | 'dewdrop'
  | 'seed';

export interface ItemDef {
  /** Catalog id. Gold drops encode the amount as `gold:<n>` (see Gold below). */
  id: string;
  name: string;
  /** Key into the art director's SPRITES atlas. */
  sprite: string;
  type: ItemType;
  /** Stacks merge in the inventory (Item.stackable). */
  stackable: boolean;
  desc: string;
  /** Melee stats (type 'weapon'). */
  weapon?: WeaponDef;
  /** Armor stats (type 'armor'). */
  armor?: ArmorDef;
  /** Hunger energy restored (type 'food'; Food.energy, Food.java:41). */
  energy?: number;
}

/** ShortSword: tier 1 (super(1, 1f, 1f), ShortSword.java:54-55), STR 11
 *  (ShortSword.java:57); min = tier = 1 (MeleeWeapon.java:41-42);
 *  max = max0() = 12 (ShortSword.java:60-62). */
const SHORT_SWORD: ItemDef = {
  id: 'shortsword',
  name: 'short sword',
  sprite: 'shortsword',
  type: 'weapon',
  stackable: false,
  desc: 'It is indeed quite short, just a few inches longer than a dagger.',
  weapon: { name: 'short sword', tier: 1, level: 0, min: 1, max: 12, str: 11, acu: 1, dly: 1, missile: false },
};

/** Dart: min 1 / max 4 (Dart.java:41-46); STR default 10 (Weapon.java:47);
 *  random() quantity 5..15 (Dart.java:77-80). Thrown via MissileWeapon. */
const DART: ItemDef = {
  id: 'dart',
  name: 'dart',
  sprite: 'dart',
  type: 'missile',
  stackable: true,
  desc: 'These simple metal spikes are weighted to fly true and sting their prey with a flick of the wrist.',
  weapon: { name: 'dart', tier: 1, level: 0, min: 1, max: 4, str: 10, acu: 1, dly: 1, missile: true },
};

/** ClothArmor: tier 1 (ClothArmor.java:30-32); STR = typicalSTR() = 7 + tier*2
 *  = 9 (Armor.java:289-291); DR() = tier * (2 + effectiveLevel()) = 2 at
 *  level 0 (Armor.java:145-147). */
const CLOTH_ARMOR: ItemDef = {
  id: 'cloth_armor',
  name: 'cloth armor',
  sprite: 'armor_cloth',
  type: 'armor',
  stackable: false,
  desc: 'This lightweight armor offers basic protection.',
  armor: { name: 'cloth armor', level: 0, str: 9, dr: 2 },
};

/** PotionOfHealing: apply() heals to full and cures poison
 *  (PotionOfHealing.java:36-45; heal() sets HP = HT and detaches Poison).
 *  M1: cures the M1 poison buff; ooze is NOT cured (vanilla heal() does not
 *  detach Ooze). TIME_TO_DRINK = 1 (Potion.java:53). */
const POTION_HEALING: ItemDef = {
  id: 'potion_healing',
  name: 'potion of healing',
  sprite: 'potion_red',
  type: 'potion',
  stackable: true,
  desc: 'An elixir that will instantly return you to full health and cure poison.',
};

/** PotionOfStrength: apply() does hero.STR++ (PotionOfStrength.java:36-45).
 *  TIME_TO_DRINK = 1 (Potion.java:53). */
const POTION_STRENGTH: ItemDef = {
  id: 'potion_strength',
  name: 'potion of strength',
  sprite: 'potion_strength',
  type: 'potion',
  stackable: true,
  desc: 'This powerful liquid will course through your muscles, permanently increasing your strength by one point.',
};

/** Food ("ration of food"): stackable (Food.java:41-46); energy =
 *  Hunger.HUNGRY = 260 (Food.java:41); warrior heals 5 HP when hurt
 *  (Food.java:74-82); TIME_TO_EAT = 3 (Food.java:34). */
const RATION: ItemDef = {
  id: 'ration',
  name: 'ration of food',
  sprite: 'ration',
  type: 'food',
  stackable: true,
  desc: 'Nothing fancy here: dried meat, some biscuits - things like that.',
  energy: 260,
};

/** Scroll placeholder. M1 ships no identification system and no scroll
 *  effects (later milestone), so scrolls exist as loot/quest items only.
 *  Vanilla shape: stackable, AC_READ, TIME_TO_READ = 1 (Scroll.java). */
const SCROLL: ItemDef = {
  id: 'scroll',
  name: 'scroll',
  sprite: 'scroll',
  type: 'scroll',
  stackable: true,
  desc: 'A scroll covered in indecipherable runes.',
};

/** ScrollOfUpgrade: upgrades one equipped weapon/armor by +1
 *  (ScrollOfUpgrade.java:38-48). M1 note: auto-identified — the full
 *  identification system (rune labels, scrolls identify on read) arrives
 *  in M2; until then the scroll is readable directly. */
const SCROLL_UPGRADE: ItemDef = {
  id: 'scroll_upgrade',
  name: 'Scroll of Upgrade',
  sprite: 'scroll_upgrade',
  type: 'scroll',
  stackable: true,
  desc: 'This scroll will upgrade a single item, improving its quality. A weapon will inflict more damage; a suit of armor will deflect additional blows. Weapons and armor will also require less strength to use.',
};

/** Gold: stackable item (Gold.java:44); doPickUp adds quantity to the purse
 *  (Gold.java:65-75). Amounts on the floor are encoded in the placed item id
 *  as `gold:<n>` (matching the generator's `gold:<n>` tag convention).
 *  Gnoll loot rolls Gold.random(): 20 + depth*10 .. 40 + depth*20
 *  (Gold.java:100-103). */
const GOLD: ItemDef = {
  id: 'gold',
  name: 'gold',
  sprite: 'gold',
  type: 'gold',
  stackable: true,
  desc: 'Collect gold coins to spend them later in a shop.',
};

/** IronKey: unlocks LOCKED_DOOR (Hero.actUnlock, Hero.java:666-689);
 *  Key.TIME_TO_UNLOCK = 1 (Key.java:26). name "iron key" (IronKey.java:34). */
const IRON_KEY: ItemDef = {
  id: 'iron_key',
  name: 'iron key',
  sprite: 'key_iron',
  type: 'key',
  stackable: true,
  desc: 'The notches on this ancient iron key are well worn.',
};

/** SkeletonKey: dropped by Goo on death (Goo.die, Goo.java:188-214);
 *  unlocks LOCKED_EXIT (Hero.actUnlock, Hero.java:666-689). */
const SKELETON_KEY: ItemDef = {
  id: 'skeleton_key',
  name: 'skeleton key',
  sprite: 'key_skeleton',
  type: 'key',
  stackable: true,
  desc: 'A key carved from bone. It must open the way down.',
};

export const ITEMS: Readonly<Record<string, ItemDef>> = {
  shortsword: SHORT_SWORD,
  dart: DART,
  cloth_armor: CLOTH_ARMOR,
  potion_healing: POTION_HEALING,
  potion_strength: POTION_STRENGTH,
  ration: RATION,
  scroll: SCROLL,
  scroll_upgrade: SCROLL_UPGRADE,
  gold: GOLD,
  iron_key: IRON_KEY,
  skeleton_key: SKELETON_KEY,
};

export function getItem(id: string): ItemDef {
  const { defId } = parseItemId(id);
  const def = ITEMS[defId];
  if (!def) throw new Error(`unknown item id: ${id}`);
  return def;
}

/**
 * Parse a placed item id into its catalog id + quantity.
 * Stackable catalog items may carry a ":qty" suffix (e.g. "gold:25",
 * "dart:8"); everything else is quantity 1.
 */
export function parseItemId(id: string): { defId: string; qty: number } {
  const colon = id.indexOf(':');
  if (colon === -1) return { defId: id, qty: 1 };
  const n = parseInt(id.slice(colon + 1), 10);
  return {
    defId: id.slice(0, colon),
    qty: Number.isFinite(n) && n > 0 ? n : 1,
  };
}

/**
 * Sprite keys referenced by the catalog that are NOT in the art atlas yet.
 * The renderer falls back to a magenta marker (never crashes), but these
 * need art: flagged for the art director / coordinator.
 */
/** Sprite keys still missing from the atlas (magenta fallback shown).
 * Empty: the M1 catalog's sprites are all present as of the items-b merge. */
export const MISSING_SPRITES: readonly string[] = [];

/** Sprite keys the catalog needs (for the completeness test). */
export function catalogSpriteKeys(): string[] {
  return Object.values(ITEMS).map((d) => d.sprite);
}

/** True when every catalog sprite key exists in the atlas. */
export function missingCatalogSprites(): string[] {
  return catalogSpriteKeys().filter((k) => !(k in SPRITES));
}
