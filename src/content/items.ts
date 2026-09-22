/**
 * Item catalog — data-driven item definitions for the dungeon.
 *
 * Every def carries Java citations (file + line). Stats mirror the Java item
 * classes exactly; behavior (drink/eat/equip/throw) is implemented in
 * src/content/actions.ts and hooks into src/mechanics/ (combat, hunger).
 *
 * Scope: the Sewer depths 1-4 catalog (+ Goo's skeleton key on depth 5),
 * quest items (Sad Ghost / Wandmaker), and the Stage 1 shop stock
 * (ShopPainter.java): melee tiers 2-5, armor tiers 2-5, bags, weightstone,
 * torch, ankh, shop scrolls, overpriced rations.
 *
 * Prices are vanilla Item.price() for one unit. The port has no
 * identification system, so potions/scrolls always price at the unidentified
 * base (Potion 20, Scroll 15); weapons/armor are identified in shop stock
 * (ShopPainter.java) and price at the tier formula.
 */
import type { ArmorDef, WeaponDef } from '../mechanics/char';
import { SPRITES } from '../assets/sprites';
import { ORIGINAL_SPRITES } from '../assets/original_sprites';

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
  | 'seed'
  | 'bag'
  | 'misc'
  | 'quest';

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
  /**
   * Shop price in gold (Item.price() in vanilla; STAGE 1: populated for the
   * shop system — the hero SELLS at price() and BUYS shop stock at
   * price()*5*(depth/5+1) per WndTradeItem.java:168-199.
   */
  price?: number;
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
  /** MeleeWeapon.price() = 20 * 2^(tier-1), tier 1 (MeleeWeapon.java). */
  price: 20,
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
  /** Dart.price() = quantity * 2 (Dart.java:64-66) -> 2 per unit. */
  price: 2,
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
  /** Armor.price() = 10 * 2^(tier-1), tier 1 (Armor.java). */
  price: 10,
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
  /**
   * Unidentified base price: Potion.price() = 20 (Potion.java). The port has
   * no identification system, so isKnown() is never true and price() never
   * reaches the known 30 (PotionOfHealing.java: price = isKnown ? 30 : 20).
   * Shop stock is unidentified in vanilla too (ShopPainter.java).
   */
  price: 20,
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
  /** PotionOfStrength has no price override: Potion.price() = 20 (Potion.java). */
  price: 20,
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
  /** Food.price() = 10 (Food.java). */
  price: 10,
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
  /** Scroll.price() = 15, unidentified base (Scroll.java). */
  price: 15,
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
  /** ScrollOfUpgrade has no price override: Scroll.price() = 15 (Scroll.java). */
  price: 15,
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
  /** Item.price() base = 0 (Item.java); gold is currency, never sold. */
  price: 0,
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
  /** Key has no price override: Item.price() = 0 (Item.java). */
  price: 0,
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
  /** Key has no price override: Item.price() = 0 (Item.java). */
  price: 0,
};

/** GoldenKey: opens LOCKED_CHEST and CRYSTAL_CHEST heaps (Hero.actOpenChest,
 *  Hero.java:615-648). name "golden key" (GoldenKey.java:32). Like vanilla,
 *  keys are depth-specific (Key.depth); the port does not track key depth
 *  yet — a golden key opens any locked chest (same gap as iron keys). */
const GOLDEN_KEY: ItemDef = {
  id: 'golden_key',
  name: 'golden key',
  sprite: 'key_gold',
  type: 'key',
  stackable: true,
  desc: 'The notches on this golden key are tiny and intricate. Maybe it can open some chest lock?',
  /** Key has no price override: Item.price() = 0 (Item.java). */
  price: 0,
};

/** Dewdrop: dropped by trampling high grass (HighGrass.trample,
 *  HighGrass.java:44-47). name "dewdrop" (Dewdrop.java:33); stackable
 *  (Dewdrop.java:36). Never sits in the backpack: doPickUp heals the hero
 *  immediately (Dewdrop.java:41-64) — see pickupDewdrop in actions.ts.
 *  STAGE 0 SCOPE: the DewVial is not ported, so the vial branch of
 *  doPickUp (vial.collectDew) cannot fire; with no vial the drop always
 *  takes the direct-heal branch (Dewdrop.java:45). */
const DEWDROP: ItemDef = {
  id: 'dewdrop',
  name: 'dewdrop',
  sprite: 'dewdrop',
  type: 'dewdrop',
  stackable: true,
  desc: 'A crystal clear dewdrop.',
  /** Dewdrop has no price override: Item.price() = 0 (Item.java). */
  price: 0,
};

/** Seed: dropped by trampling high grass (HighGrass.trample,
 *  HighGrass.java:40-42). Vanilla drops a random plant Seed subtype
 *  (Generator.Category.SEED); the plant/seed system is not ported yet, so
 *  this is a single generic stackable seed item — it can be picked up and
 *  dropped, but planting/throwing effects arrive with the plant system.
 *  The trample drop probabilities are exact (HighGrass.java). */
const SEED: ItemDef = {
  id: 'seed',
  name: 'seed',
  sprite: 'seed',
  type: 'seed',
  stackable: true,
  desc: 'A strange seed. Perhaps it can be planted.',
  /** Plant.Seed has no price override: Item.price() = 0 (Item.java). */
  price: 0,
};

/**
 * Quest items (Sad Ghost / Wandmaker quests). All are unique, identified,
 * non-upgradable quest items (DriedRose.java:24-45, RatSkull.java:24-51,
 * CorpseDust.java:24-42, PhantomFish.java:30-81, Rotberry.Seed via
 * Rotberry.java:53). They have no use action in Stage 1 — they are only
 * carried back to the quest giver. Type 'quest' (new): they are none of the
 * existing catalog types. Sprites come from the original-sprite pipeline
 * (ItemSpriteSheet indices, see scripts/extract_original_sprites.ts).
 */
const DRIED_ROSE: ItemDef = {
  id: 'dried_rose',
  name: 'dried rose',
  sprite: 'rose',
  type: 'quest',
  stackable: false,
  desc: 'The rose has dried long ago, but it has kept all its petals somehow.',
};

const RAT_SKULL: ItemDef = {
  id: 'rat_skull',
  name: 'giant rat skull',
  sprite: 'skull',
  type: 'quest',
  stackable: false,
  desc: 'It could be a nice hunting trophy, but it smells too bad to place it on a wall.',
  price: 100, // RatSkull.price() (RatSkull.java:49-51)
};

const CORPSE_DUST: ItemDef = {
  id: 'corpse_dust',
  name: 'corpse dust',
  sprite: 'dust',
  type: 'quest',
  stackable: false,
  desc:
    "The ball of corpse dust doesn't differ outwardly from a regular dust ball. " +
    "However, you know somehow that it's better to get rid of it as soon as possible.",
};

const PHANTOM_FISH: ItemDef = {
  id: 'phantom_fish',
  name: 'phantom fish',
  sprite: 'phantom',
  type: 'quest',
  stackable: false,
  desc:
    'You can barely see this tiny translucent fish in the air. ' +
    'In the water it becomes effectively invisible.',
};

const ROTBERRY_SEED: ItemDef = {
  id: 'rotberry_seed',
  name: 'seed of Rotberry', // Rotberry.Seed: name = "seed of " + plantName (Rotberry.java:52)
  sprite: 'seed_rotberry',
  type: 'quest',
  stackable: false,
  desc: 'A strange seed. Perhaps it can be planted.',
};

/**
 * Shop-stock weapons (ShopPainter.java depth tiers) — Stage 1 shop system.
 * Stats: min0() = tier (MeleeWeapon.java:39-41);
 * max0() = (int)((tier*tier - tier + 10) / ACU * DLY) (MeleeWeapon.java:43-45);
 * typicalSTR() = 8 + tier*2 (MeleeWeapon.java:77-79);
 * price() = 20 * 2^(tier-1) (MeleeWeapon.java:173-178).
 */

/** Quarterstaff: tier 2 (super(2, 1f, 1f), Quarterstaff.java); shop depth 6. */
const QUARTERSTAFF: ItemDef = {
  id: 'quarterstaff',
  name: 'quarterstaff',
  sprite: 'weapon_quarterstaff',
  type: 'weapon',
  stackable: false,
  desc: 'A staff of hardwood, its ends are shod with iron.',
  weapon: { name: 'quarterstaff', tier: 2, level: 0, min: 2, max: 12, str: 12, acu: 1, dly: 1, missile: false },
  price: 40,
};

/** Spear: tier 2 (super(2, 1f, 1.5f), Spear.java); shop depth 6. */
const SPEAR: ItemDef = {
  id: 'spear',
  name: 'spear',
  sprite: 'weapon_spear',
  type: 'weapon',
  stackable: false,
  desc: 'A slender wooden rod tipped with sharpened iron.',
  weapon: { name: 'spear', tier: 2, level: 0, min: 2, max: 18, str: 12, acu: 1, dly: 1.5, missile: false },
  price: 40,
};

/** Sword: tier 3 (super(3, 1f, 1f), Sword.java); shop depth 11. */
const SWORD: ItemDef = {
  id: 'sword',
  name: 'sword',
  sprite: 'weapon_sword',
  type: 'weapon',
  stackable: false,
  desc: 'The razor-sharp length of steel blade shines reassuringly.',
  weapon: { name: 'sword', tier: 3, level: 0, min: 3, max: 16, str: 14, acu: 1, dly: 1, missile: false },
  price: 80,
};

/** Mace: tier 3 (super(3, 1f, 0.8f), Mace.java); shop depth 11. */
const MACE: ItemDef = {
  id: 'mace',
  name: 'mace',
  sprite: 'weapon_mace',
  type: 'weapon',
  stackable: false,
  desc: 'The iron head of this weapon inflicts substantial damage.',
  weapon: { name: 'mace', tier: 3, level: 0, min: 3, max: 12, str: 14, acu: 1, dly: 0.8, missile: false },
  price: 80,
};

/** Longsword: tier 4 (super(4, 1f, 1f), Longsword.java); shop depth 16. */
const LONGSWORD: ItemDef = {
  id: 'longsword',
  name: 'longsword',
  sprite: 'weapon_longsword',
  type: 'weapon',
  stackable: false,
  desc: 'This towering blade inflicts heavy damage by investing its heft into every cut.',
  weapon: { name: 'longsword', tier: 4, level: 0, min: 4, max: 22, str: 16, acu: 1, dly: 1, missile: false },
  price: 160,
};

/** BattleAxe: tier 4 (super(4, 1.2f, 1f), BattleAxe.java); shop depth 16. */
const BATTLE_AXE: ItemDef = {
  id: 'battle_axe',
  name: 'battle axe',
  sprite: 'weapon_battle_axe',
  type: 'weapon',
  stackable: false,
  desc: 'The enormous steel head of this battle axe puts considerable heft behind each stroke.',
  weapon: { name: 'battle axe', tier: 4, level: 0, min: 4, max: 18, str: 16, acu: 1.2, dly: 1, missile: false },
  price: 160,
};

/** Glaive: tier 5 (super(5, 1f, 1f), Glaive.java); shop depth 21. */
const GLAIVE: ItemDef = {
  id: 'glaive',
  name: 'glaive',
  sprite: 'weapon_glaive',
  type: 'weapon',
  stackable: false,
  desc: 'A polearm consisting of a sword blade on the end of a pole.',
  weapon: { name: 'glaive', tier: 5, level: 0, min: 5, max: 30, str: 18, acu: 1, dly: 1, missile: false },
  price: 320,
};

/** WarHammer: tier 5 (super(5, 1.2f, 1f), WarHammer.java); shop depth 21. */
const WAR_HAMMER: ItemDef = {
  id: 'war_hammer',
  name: 'war hammer',
  sprite: 'weapon_war_hammer',
  type: 'weapon',
  stackable: false,
  desc: 'Few creatures can withstand the crushing blow of this towering mass of lead and steel, but only the strongest of adventurers can use it effectively.',
  weapon: { name: 'war hammer', tier: 5, level: 0, min: 5, max: 25, str: 18, acu: 1.2, dly: 1, missile: false },
  price: 320,
};

/**
 * Shop-stock armor (ShopPainter.java depth tiers).
 * STR = typicalSTR() = 7 + tier*2 (Armor.java:289-291);
 * DR() = tier * (2 + effectiveLevel()) = tier*2 at level 0 (Armor.java:145-147);
 * price() = 10 * 2^(tier-1) (Armor.java:298-303).
 */

/** LeatherArmor: tier 2 (LeatherArmor.java); shop depth 6. */
const LEATHER_ARMOR: ItemDef = {
  id: 'leather_armor',
  name: 'leather armor',
  sprite: 'armor_leather',
  type: 'armor',
  stackable: false,
  desc: 'Armor made from tanned monster hide. Not as light as cloth armor but provides better protection.',
  armor: { name: 'leather armor', level: 0, str: 11, dr: 4 },
  price: 20,
};

/** MailArmor: tier 3 (MailArmor.java); shop depth 11. */
const MAIL_ARMOR: ItemDef = {
  id: 'mail_armor',
  name: 'mail armor',
  sprite: 'armor_mail',
  type: 'armor',
  stackable: false,
  desc: 'Interlocking metal links make for a tough but flexible suit of armor.',
  armor: { name: 'mail armor', level: 0, str: 13, dr: 6 },
  price: 40,
};

/** ScaleArmor: tier 4 (ScaleArmor.java); shop depth 16. */
const SCALE_ARMOR: ItemDef = {
  id: 'scale_armor',
  name: 'scale armor',
  sprite: 'armor_scale',
  type: 'armor',
  stackable: false,
  desc: 'The metal scales sewn onto a leather vest create a flexible, yet protective armor.',
  armor: { name: 'scale armor', level: 0, str: 15, dr: 8 },
  price: 80,
};

/** PlateArmor: tier 5 (PlateArmor.java); shop depth 21. */
const PLATE_ARMOR: ItemDef = {
  id: 'plate_armor',
  name: 'plate armor',
  sprite: 'armor_plate',
  type: 'armor',
  stackable: false,
  desc: 'Enormous plates of metal are joined together into a suit that provides unmatched protection to any adventurer strong enough to bear its staggering weight.',
  armor: { name: 'plate armor', level: 0, str: 17, dr: 10 },
  price: 160,
};

/**
 * Shop-stock bags (ShopPainter.java). Vanilla Bags are containers
 * (items/bags/Bag.java); the port has no container mechanics yet, so these
 * are buyable/sellable/misc inventory items with no use action.
 * price() = 50 each (SeedPouch.java / ScrollHolder.java / WandHolster.java).
 */

/** SeedPouch: "seed pouch" (SeedPouch.java); shop depth 6. */
const SEED_POUCH: ItemDef = {
  id: 'seed_pouch',
  name: 'seed pouch',
  sprite: 'seed_pouch',
  type: 'bag',
  stackable: false,
  desc: 'This small velvet pouch allows you to store any number of seeds in it. Very convenient.',
  price: 50,
};

/** ScrollHolder: "scroll holder" (ScrollHolder.java); shop depth 11. */
const SCROLL_HOLDER: ItemDef = {
  id: 'scroll_holder',
  name: 'scroll holder',
  sprite: 'scroll_holder',
  type: 'bag',
  stackable: false,
  desc: 'You can place any number of scrolls into this tubular container. It saves room in your backpack and protects scrolls from fire.',
  price: 50,
};

/** WandHolster: "wand holster", size 12 (WandHolster.java); shop depth 16. */
const WAND_HOLSTER: ItemDef = {
  id: 'wand_holster',
  name: 'wand holster',
  sprite: 'wand_holster',
  type: 'bag',
  stackable: false,
  desc: 'This slim holder is made of leather of some exotic animal. It allows to compactly carry up to 12 wands.',
  price: 50,
};

/**
 * Shop-stock misc items (ShopPainter.java). Type 'misc': plain Items with no
 * use action in the port (torch light, ankh resurrection, weightstone
 * weapon-balancing are later milestones).
 */

/** Weightstone: stackable (Weightstone.java); shop depths 6/11/16. */
const WEIGHTSTONE: ItemDef = {
  id: 'weightstone',
  name: 'weightstone',
  sprite: 'weightstone',
  type: 'misc',
  stackable: true,
  desc: 'Using a weightstone, you can balance your melee weapon to increase its speed or accuracy.',
  /** Weightstone.price() = 40 (Weightstone.java). */
  price: 40,
};

/** Torch: stackable (Torch.java); shop depth 21 (x2). */
const TORCH: ItemDef = {
  id: 'torch',
  name: 'torch',
  sprite: 'torch',
  type: 'misc',
  stackable: true,
  desc: "It's an indispensable item in The Demon Halls, which are notorious for their poor ambient lighting.",
  /** Torch.price() = 10 (Torch.java). */
  price: 10,
};

/** Ankh: stackable (Ankh.java); every shop. */
const ANKH: ItemDef = {
  id: 'ankh',
  name: 'Ankh',
  sprite: 'ankh',
  type: 'misc',
  stackable: true,
  desc: 'The ancient symbol of immortality grants an ability to return to life after death. Upon resurrection all non-equipped items are lost.',
  /** Ankh.price() = 50 (Ankh.java). */
  price: 50,
};

/**
 * Shop-stock scrolls (ShopPainter.java common stock). All unidentified in
 * vanilla, so price() is the Scroll base = 15 (Scroll.java); the port has no
 * identification system, so the known prices (30/30/25) never apply.
 * Sprite: the unidentified scroll rune (same as the generic scroll).
 */

/** ScrollOfIdentify: "Scroll of Identify" (ScrollOfIdentify.java). */
const SCROLL_IDENTIFY: ItemDef = {
  id: 'scroll_identify',
  name: 'Scroll of Identify',
  sprite: 'scroll',
  type: 'scroll',
  stackable: true,
  desc: 'Permanently reveals all of the secrets of a single item.',
  price: 15,
};

/** ScrollOfRemoveCurse: "Scroll of Remove Curse" (ScrollOfRemoveCurse.java). */
const SCROLL_REMOVE_CURSE: ItemDef = {
  id: 'scroll_remove_curse',
  name: 'Scroll of Remove Curse',
  sprite: 'scroll',
  type: 'scroll',
  stackable: true,
  desc: "The incantation on this scroll will instantly strip from the reader's weapon, armor, rings and carried items any evil enchantments that might prevent the wearer from removing them.",
  price: 15,
};

/** ScrollOfMagicMapping: "Scroll of Magic Mapping" (ScrollOfMagicMapping.java). */
const SCROLL_MAGIC_MAPPING: ItemDef = {
  id: 'scroll_magic_mapping',
  name: 'Scroll of Magic Mapping',
  sprite: 'scroll',
  type: 'scroll',
  stackable: true,
  desc: 'When this scroll is read, an image of crystal clarity will be etched into your memory, alerting you to the precise layout of the level and revealing all hidden secrets. The locations of items and creatures will remain unknown.',
  price: 15,
};

/** OverpricedRation: "overpriced food ration" (OverpricedRation.java);
 *  energy = STARVING - HUNGRY = 360 - 260 = 100 (Hunger.java:36-37);
 *  price() = 20 (OverpricedRation.java). Shop common stock (x2). */
const OVERPRICED_RATION: ItemDef = {
  id: 'overpriced_ration',
  name: 'overpriced food ration',
  sprite: 'overpriced_ration',
  type: 'food',
  stackable: true,
  desc: 'It looks exactly like a standard ration of food but smaller.',
  energy: 100,
  price: 20,
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
  golden_key: GOLDEN_KEY,
  dewdrop: DEWDROP,
  seed: SEED,
  dried_rose: DRIED_ROSE,
  rat_skull: RAT_SKULL,
  corpse_dust: CORPSE_DUST,
  phantom_fish: PHANTOM_FISH,
  rotberry_seed: ROTBERRY_SEED,
  quarterstaff: QUARTERSTAFF,
  spear: SPEAR,
  sword: SWORD,
  mace: MACE,
  longsword: LONGSWORD,
  battle_axe: BATTLE_AXE,
  glaive: GLAIVE,
  war_hammer: WAR_HAMMER,
  leather_armor: LEATHER_ARMOR,
  mail_armor: MAIL_ARMOR,
  scale_armor: SCALE_ARMOR,
  plate_armor: PLATE_ARMOR,
  seed_pouch: SEED_POUCH,
  scroll_holder: SCROLL_HOLDER,
  wand_holster: WAND_HOLSTER,
  weightstone: WEIGHTSTONE,
  torch: TORCH,
  ankh: ANKH,
  scroll_identify: SCROLL_IDENTIFY,
  scroll_remove_curse: SCROLL_REMOVE_CURSE,
  scroll_magic_mapping: SCROLL_MAGIC_MAPPING,
  overpriced_ration: OVERPRICED_RATION,
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

/** True when every catalog sprite key exists in an atlas.
 * The renderer prefers ORIGINAL_SPRITES (exact-copy extraction pipeline) and
 * falls back to the ASCII atlas, so both count as present. */
export function missingCatalogSprites(): string[] {
  return catalogSpriteKeys().filter(
    (k) => !(k in ORIGINAL_SPRITES) && !(k in SPRITES),
  );
}
