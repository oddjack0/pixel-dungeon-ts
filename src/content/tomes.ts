/**
 * Tome of Mastery / Tome of Remastery (Stage 3, Worker F).
 *
 * Ground truth: watabou/pixel-dungeon, items/TomeOfMastery.java
 * (GPL-3.0). Java wins every conflict.
 *
 * The tome is a single item class: its name becomes "Tome of Remastery"
 * once the hero has a subclass (TomeOfMastery.java:32 — the instance
 * initializer reads Dungeon.hero.subClass). Reading it (10 time units)
 * presents the class's two subclass choices; reading it again after
 * choosing offers a respec to the other subclass (WndChooseWay).
 * Reading is impossible while blinded ("You can't read while blinded").
 *
 * The choice/choose logic and the WndChooseWay texts live in
 * src/mechanics/subclasses.ts (tomeChoices, tomeChoose, respecPrompt);
 * this file owns the item catalog defs. Another worker merges TOME_ITEMS
 * into the ITEMS catalog at integration — export shape matches the
 * catalog (ItemDef[]), like POTION_DEFS / SCROLL_DEFS / HONEYPOT_DEF.
 *
 * Item facts (TomeOfMastery.java):
 * - image = ItemSpriteSheet.MASTERY (index 82, ItemSpriteSheet.java:174);
 *   sprite key 'item_tome_mastery' in src/assets/stage3_workerF_sprites.ts
 * - stackable = false, unique = true (ItemDef has no `unique` field; noted)
 * - isUpgradable() = false, isIdentified() = true, price() = 0 (Item.java:444)
 * - doPickUp: Badges.validateMastery() (badge worker's hook)
 * - info(): "This worn leather book is not that thick, but you feel somehow,
 *   that you can gather a lot from it. Remember though that reading
 *   this tome may require some time."
 * - Dropped by Tengu when the class mastery badge is not yet unlocked or
 *   the hero has no subclass yet (Tengu.die, Tengu.java:95-97;
 *   see tomeDropsOnTenguKill in mechanics/subclasses.ts).
 * - There is NO hero-level requirement in the Java: the level ~10 gating
 *   comes from the Tengu (depth 10 boss) drop, not from the item.
 */

import type { ItemDef } from './items.js';
import { tomeDisplayName } from '../mechanics/subclasses.js';
import type { HeroSubClass } from '../mechanics/subclasses.js';

export const TOME_OF_MASTERY_ID = 'tome_of_mastery';

/** Tome of Mastery (items/TomeOfMastery.java). */
const TOME_OF_MASTERY: ItemDef = {
  id: TOME_OF_MASTERY_ID,
  name: 'Tome of Mastery',
  sprite: 'item_tome_mastery',
  type: 'misc',
  stackable: false,
  // TomeOfMastery.info() (TomeOfMastery.java:102-108), verbatim.
  desc:
    'This worn leather book is not that thick, but you feel somehow, ' +
    'that you can gather a lot from it. Remember though that reading ' +
    'this tome may require some time.',
  /** Item.price() default is 0 (Item.java:444-446); no override in the tome. */
  price: 0,
};

/**
 * Catalog entries for the integration worker to merge into ITEMS.
 * (There is exactly one def: "Tome of Remastery" is the same item,
 * renamed when hero.subClass != NONE — see tomeDisplayName.)
 */
export const TOME_ITEMS: ItemDef[] = [TOME_OF_MASTERY];

/**
 * Display name for the tome given the hero's subclass
 * (TomeOfMastery.java:32): "Tome of Remastery" once subClass != NONE.
 */
export function tomeNameFor(subClass: HeroSubClass): string {
  return tomeDisplayName(subClass);
}
