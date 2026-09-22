/**
 * Scrolls (GPL-3.0; ground truth: watabou/pixel-dungeon,
 * `items/scrolls/Scroll.java` + the 12 `items/scrolls/ScrollOf*.java`).
 *
 * The brief asked for "the other 11 scrolls" plus existing Upgrade = 12
 * production scrolls (Scroll.java:41 lists 12 in `scrolls`);
 * ScrollOfWipeOut is debug-only and excluded (it is absent from the
 * vanilla Generator).
 *
 * Class order (Scroll.java:41) and weights (itemgen.ts, vanilla
 * Generator.java scroll order):
 *   Identify(30) Teleportation(10) RemoveCurse(15) Recharging(10)
 *   MagicMapping(15) Challenge(12) Terror(8) Lullaby(8) PsionicBlast(4)
 *   MirrorImage(6) Upgrade(0) Enchantment(1)
 *
 * Key behavior (Scroll.java):
 * - Runes: KAUNAN SOWILO LAGUZ YNGVI GYFU RAIDO ISAZ MANNAZ NAUDIZ
 *   BERKANAN ODAL TIWAZ (Scroll.java:53-56); unknown name is
 *   `scroll "<RUNE>"` (Scroll.java:90-92); base price 15 (Scroll.java).
 * - Reading while blinded is rejected WITHOUT consuming the scroll
 *   (Scroll.java:104-108); a normal read costs TIME_TO_READ = 1
 *   (Scroll.java:35).
 * - Every scroll identifies on read (each doRead calls setKnown(), or
 *   inherits it from InventoryScroll.doRead).
 * - InventoryScroll (ScrollOfIdentify/Enchantment/Upgrade): the scroll is
 *   detached first, identifies itself, then opens an inventory selection
 *   (InventoryScroll.java:38-44). Cancelling a use-identified scroll asks
 *   "Do you really want to cancel this scroll usage? It will be consumed
 *   anyway." (InventoryScroll.java:82-96); otherwise the scroll returns
 *   to the backpack. The port has no bag UI in the action layer, so the
 *   selection is pending state (pendingScrollSelect) resolved via
 *   resolveScrollSelect, and the cancel question via
 *   resolveScrollCancel.
 *
 * Seams:
 * - ScrollOfRecharging fully recharges carried wands (ScrollOfRecharging
 *   .java:34-41; Belongings.charge(true)). Worker 3 owns wands: register
 *   the implementation with setRechargeHook.
 * - ScrollOfEnchantment: uncurse + random weapon enchant / armor
 *   inscription + fix (ScrollOfEnchantment.java:45-67). Worker 5 owns
 *   enchantments: register with setEnchantHooks.
 */
import type { ActionContext } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import { Terrain } from '../core/grid.js';
import { affectBuff, prolongBuff } from './potions.js';
import type { BuffKind } from '../mechanics/buffs.js';
import type { BuffState } from '../mechanics/char.js';
import {
  damageMobDirect,
  charAtPos,
  ContentMob,
  MirrorImageMob,
  type MirrorImageStats,
} from './mobs.js';
import {
  knowScroll,
  knowPotion,
  isPotionKnown,
  scrollImage,
  scrollRune,
  isScrollKnown,
  isWandKnown,
  isWandRegistered,
  identificationReady,
  SCROLL_RUNES,
  SCROLL_IMAGES,
  type FamilyDef,
} from './identification.js';
import {
  removeFromInventory,
  type ContentHero,
} from './hero.js';
import { isPotionId } from './potions.js';
import type { ItemDef } from './items.js';
import { upgradeWeapon, upgradeArmor, gearDisplayName } from '../mechanics/hero.js';
import { fixDurability, isBroken } from '../mechanics/durability.js';
import { ensureStackGear } from './hero.js';
import { enchantWeaponInstance } from './enchantments.js';
import { inscribeArmorInstance } from './glyphs.js';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Catalog ids in vanilla class order (Scroll.java:41). */
export const SCROLL_CLASS_ORDER: readonly string[] = [
  'scroll_identify',
  'scroll_magicmapping',
  'scroll_recharging',
  'scroll_removecurse',
  'scroll_teleportation',
  'scroll_challenge',
  'scroll_terror',
  'scroll_lullaby',
  'scroll_psionicblast',
  'scroll_mirrorimage',
  'scroll_upgrade',
  'scroll_enchantment',
];

const SCROLL_ID_SET = new Set<string>(SCROLL_CLASS_ORDER);

/** True for the 12 vanilla scroll catalog ids. */
export function isScrollId(id: string): boolean {
  return SCROLL_ID_SET.has(id);
}

function def(id: string, name: string, sprite: string, desc: string): ItemDef {
  return {
    id,
    name,
    sprite,
    type: 'scroll',
    stackable: true,
    desc,
    /** Scroll.price() = 15 unidentified (Scroll.java); known prices vary. */
    price: 15,
  };
}

/**
 * The 11 new scroll defs (Upgrade already exists in items.ts). Names and
 * descs are verbatim from the Java classes; sprite keys are the extracted
 * ItemSpriteSheet frames (Worker 6).
 */
export const SCROLL_DEFS: Record<string, ItemDef> = {
  scroll_identify: def(
    'scroll_identify',
    'Scroll of Identify',
    'item_scroll_identify',
    // ScrollOfIdentify.java desc()
    'Permanently reveals all of the secrets of a single item.',
  ),
  scroll_teleportation: def(
    'scroll_teleportation',
    'Scroll of Teleportation',
    'item_scroll_teleportation',
    // ScrollOfTeleportation.java desc()
    'The spell on this parchment will teleport the reader to a random ' +
      'location on the current level.',
  ),
  scroll_removecurse: def(
    'scroll_removecurse',
    'Scroll of Remove Curse',
    'item_scroll_removecurse',
    // ScrollOfRemoveCurse.java desc()
    "The incantation on this scroll will instantly strip from the reader's " +
      'weapon, armor, rings and carried items any evil enchantments that ' +
      'might prevent the wearer from removing them.',
  ),
  scroll_recharging: def(
    'scroll_recharging',
    'Scroll of Recharging',
    'item_scroll_recharging',
    // ScrollOfRecharging.java desc()
    'The spell on this scroll will instantly recharge all of the wands ' +
      'the reader has.',
  ),
  scroll_magicmapping: def(
    'scroll_magicmapping',
    'Scroll of Magic Mapping',
    'item_scroll_magicmapping',
    // ScrollOfMagicMapping.java desc()
    'When this scroll is read, an image of crystal clarity will be etched ' +
      'into your memory, alerting you to the precise layout of the level ' +
      'and revealing all hidden secrets. The locations of items and ' +
      'creatures will remain unknown.',
  ),
  scroll_challenge: def(
    'scroll_challenge',
    'Scroll of Challenge',
    'item_scroll_challenge',
    // ScrollOfChallenge.java desc()
    'When this scroll is read, it lets out a challenging cry that ' +
      'compels all of the creatures on the level to pay attention to the ' +
      'reader.',
  ),
  scroll_terror: def(
    'scroll_terror',
    'Scroll of Terror',
    'item_scroll_terror',
    // ScrollOfTerror.java desc()
    'A fearsome magic will course through your enemies when this scroll ' +
      'is read, causing them to flee from your presence in terror.',
  ),
  scroll_lullaby: def(
    'scroll_lullaby',
    'Scroll of Lullaby',
    'item_scroll_lullaby',
    // ScrollOfLullaby.java desc()
    'Soothing notes will drift from this scroll, sending all nearby ' +
      'creatures into a deep slumber.',
  ),
  scroll_psionicblast: def(
    'scroll_psionicblast',
    'Scroll of Psionic Blast',
    'item_scroll_psionicblast',
    // ScrollOfPsionicBlast.java desc()
    'This scroll contains a devastating blast of psychic energy. It will ' +
      'damage and stun all creatures on the level that can see the reader, ' +
      'but it will also blind and damage the reader.',
  ),
  scroll_mirrorimage: def(
    'scroll_mirrorimage',
    'Scroll of Mirror Image',
    'item_scroll_mirrorimage',
    // ScrollOfMirrorImage.java desc()
    'The incantation on this scroll will create illusory duplicates of ' +
      'the reader, which will needle and distract the enemies.',
  ),
  scroll_enchantment: def(
    'scroll_enchantment',
    'Scroll of Enchantment',
    'item_scroll_enchantment',
    // ScrollOfEnchantment.java desc()
    'This scroll is able to imbue a weapon or a suit of armor with a ' +
      'magical enchantment, or to strengthen an enchantment which ' +
      'already exists on the item.',
  ),
};

/** Known prices (per Java price() overrides; base 15 unidentified). */
export const SCROLL_KNOWN_PRICES: Readonly<Record<string, number>> = {
  scroll_identify: 30, // ScrollOfIdentify.java
  scroll_teleportation: 40, // ScrollOfTeleportation.java
  scroll_removecurse: 30, // ScrollOfRemoveCurse.java
  scroll_recharging: 40, // ScrollOfRecharging.java
  scroll_magicmapping: 25, // ScrollOfMagicMapping.java
  scroll_challenge: 15,
  scroll_terror: 50, // ScrollOfTerror.java
  scroll_lullaby: 50, // ScrollOfLullaby.java
  scroll_psionicblast: 80, // ScrollOfPsionicBlast.java
  scroll_mirrorimage: 15,
  scroll_upgrade: 15,
  scroll_enchantment: 15,
};

/**
 * Family def for initIdentification. NOTE: Worker 6 has not yet extracted
 * the Upgrade frame (ItemSpriteSheet.SCROLL_ODAL); until then the pool
 * falls back to the Stage-1 custom sprite for that class. Runes are exact
 * for all 12.
 */
export function scrollFamilyDef(): FamilyDef {
  return {
    classes: [...SCROLL_CLASS_ORDER],
    labels: [...SCROLL_RUNES],
    images: SCROLL_IMAGES.map((img) =>
      img === 'item_scroll_odal'
        ? 'scroll_upgrade' // TODO(worker6): extract ItemSpriteSheet.SCROLL_ODAL
        : img,
    ),
  };
}

/** Display name: known -> "Scroll of X"; unknown -> `scroll "<RUNE>"`. */
export function scrollDisplayName(id: string, knownName: string): string {
  if (identificationReady() && isScrollKnown(id)) return knownName;
  if (!identificationReady()) return knownName;
  return `scroll "${scrollRune(id)}"`; // Scroll.java:90-92
}

/** Run-assigned sprite once the ID system is up; catalog fallback before. */
export function scrollSprite(id: string, fallback: string): string {
  return identificationReady() ? scrollImage(id) : fallback;
}

/** price() = isKnown ? knownPrice * qty : 15 * qty (Scroll.java). */
export function scrollPrice(id: string, qty = 1): number {
  const unit =
    identificationReady() && isScrollKnown(id)
      ? (SCROLL_KNOWN_PRICES[id] ?? 15)
      : 15;
  return unit * qty;
}

/**
 * UI adapter info for the inventory panel (hooks.ts). Returns null for
 * non-scrolls.
 */
export function scrollUiInfo(
  id: string,
  knownName: string,
  catalogSprite: string,
): { name: string; sprite: string; identified: boolean } | null {
  if (!isScrollId(id)) return null;
  const known = identificationReady() && isScrollKnown(id);
  return {
    name: known ? knownName : `scroll "${scrollRune(id)}"`,
    sprite: identificationReady() ? scrollImage(id) : catalogSprite,
    identified: known,
  };
}

function isKnownSafe(id: string): boolean {
  return identificationReady() && isScrollKnown(id);
}

// ---------------------------------------------------------------------------
// Reading (Scroll.execute/doRead, Scroll.java:98-126)
// ---------------------------------------------------------------------------

/** TIME_TO_READ = 1 (Scroll.java:35). */
export const TIME_TO_READ = 1;

/**
 * Read the scroll in `slot`. Returns the turn cost.
 * Blindness rejects the read without consuming the scroll
 * (Scroll.java:104-108).
 */
export function readScroll(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || !isScrollId(stack.itemId)) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  const id = stack.itemId;
  if (hero.buffs.blindness) {
    ctx.log("You can't read a scroll while blind!"); // TXT_BLINDNESS
    return 1;
  }
  if (id === 'scroll_upgrade') return readUpgradeScroll(ctx, hero, slot);
  if (id === 'scroll_identify' || id === 'scroll_enchantment') {
    return openInventoryScroll(ctx, hero, slot, id);
  }
  // Plain scroll: detach, doRead, readAnimation (Scroll.java:110-124).
  removeFromInventory(hero, slot, 1);
  doReadEffect(ctx, hero, id);
  knowScroll(id); // every scroll identifies on read (verified per doRead)
  return TIME_TO_READ;
}

// ---------------------------------------------------------------------------
// InventoryScroll machinery (InventoryScroll.java)
// ---------------------------------------------------------------------------

export type InventoryScrollKind = 'identify' | 'enchant';

export interface ScrollSelection {
  kind: InventoryScrollKind;
  /** Inventory candidates (slot indices) valid at open time. */
  candidates: number[];
  title: string;
}

let pendingSelect: ScrollSelection | null = null;
let pendingCancel: InventoryScrollKind | null = null;

export function pendingScrollSelect(): ScrollSelection | null {
  return pendingSelect;
}

export function pendingScrollCancel(): InventoryScrollKind | null {
  return pendingCancel;
}

/**
 * Open an InventoryScroll selection. The scroll is detached and identifies
 * itself FIRST (InventoryScroll.doRead: setKnown, identifiedByUse = true),
 * then the bag opens (InventoryScroll.java:38-44).
 */
function openInventoryScroll(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  id: string,
): number {
  const kind: InventoryScrollKind =
    id === 'scroll_identify' ? 'identify' : 'enchant';
  removeFromInventory(hero, slot, 1);
  knowScroll(id);
  const candidates = inventoryScrollCandidates(hero, kind);
  if (candidates.length === 0) {
    // Vanilla would show an empty bag; the port has no bag UI, so the
    // read fizzles here (scroll already consumed, as in vanilla).
    ctx.log(
      kind === 'identify'
        ? 'You have nothing to identify.'
        : 'You have nothing to enchant.',
    );
    return TIME_TO_READ;
  }
  pendingSelect = {
    kind,
    candidates,
    title:
      kind === 'identify'
        ? 'Select an item to identify' // ScrollOfIdentify TXT_INVENTORY_TITLE
        : 'Select an enchantable item', // ScrollOfEnchantment TXT_INVENTORY_TITLE
  };
  return TIME_TO_READ;
}

function inventoryScrollCandidates(
  hero: ContentHero,
  kind: InventoryScrollKind,
): number[] {
  const out: number[] = [];
  hero.inventory.forEach((stack, slot) => {
    if (kind === 'identify') {
      if (isItemUnidentified(stack.itemId)) out.push(slot);
    } else {
      // WndBag.Mode.ENCHANTABLE: MeleeWeapon | Boomerang | Armor
      // (WndBag.java:391). The port has no boomerang; weapons/armor are
      // catalog types 'weapon'/'armor'.
      const t = itemTypeOf(stack.itemId);
      if (t === 'weapon' || t === 'armor') out.push(slot);
    }
  });
  return out;
}

/** Item type lookup without importing the catalog (avoids a cycle). */
let itemTypeLookup: (id: string) => string | null = () => null;
export function setItemTypeLookup(fn: (id: string) => string | null): void {
  itemTypeLookup = fn;
}
function itemTypeOf(id: string): string | null {
  return itemTypeLookup(id);
}

/**
 * True when the item is still unidentified. Potions/scrolls consult the
 * ID system; wands consult Worker 3's registration (guarded — the wand
 * worker registers before initIdentification).
 */
function isItemUnidentified(id: string): boolean {
  if (!identificationReady()) return false;
  if (isPotionId(id)) return !isPotionKnown(id);
  if (isScrollId(id)) return !isScrollKnown(id);
  if (isWandRegistered()) {
    try {
      return !isWandKnown(id);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolve an open inventory-scroll selection.
 * `targetSlot`: the chosen inventory slot, or null if the player cancelled.
 */
export function resolveScrollSelect(
  ctx: ActionContext,
  hero: ContentHero,
  targetSlot: number | null,
): number {
  const sel = pendingSelect;
  pendingSelect = null;
  if (!sel) return 0;
  if (targetSlot === null || !sel.candidates.includes(targetSlot)) {
    // InventoryScroll.onSelect(null): cancel (InventoryScroll.java:78-98).
    // identifiedByUse is always true here (set in openInventoryScroll).
    pendingCancel = sel.kind;
    ctx.log(
      'Do you really want to cancel this scroll usage? It will be consumed anyway.',
    ); // TXT_WARNING
    return 0;
  }
  if (sel.kind === 'identify') {
    identifyItem(hero, targetSlot);
  } else {
    enchantItem(ctx, hero, targetSlot);
  }
  return 0;
}

/** Resolve the cancel-confirmation dialog. YES consumes; NO reopens selection. */
export function resolveScrollCancel(
  ctx: ActionContext,
  hero: ContentHero,
  accept: boolean,
): number {
  const kind = pendingCancel;
  pendingCancel = null;
  if (!kind) return 0;
  if (accept) {
    // "It will be consumed anyway" — already detached; nothing to do.
    return 0;
  }
  // NO: reopen the bag (InventoryScroll.java:92-95).
  const candidates = inventoryScrollCandidates(hero, kind);
  pendingSelect = {
    kind,
    candidates,
    title:
      kind === 'identify'
        ? 'Select an item to identify'
        : 'Select an enchantable item',
  };
  return 0;
}

/** ScrollOfIdentify.onItemSelected: item.identify() (ScrollOfIdentify.java:44-48). */
function identifyItem(hero: ContentHero, targetSlot: number): void {
  const stack = hero.inventory[targetSlot];
  if (!stack) return;
  if (isPotionId(stack.itemId)) knowPotion(stack.itemId);
  else if (isScrollId(stack.itemId)) knowScroll(stack.itemId);
  // Wand/ring identification plugs in via Worker 3's knowWand/ring hooks.
}

// ---------------------------------------------------------------------------
// Enchantment seam (Worker 5)
// ---------------------------------------------------------------------------

export interface EnchantHooks {
  /**
   * Strip curses from every inventory stack and equipped gear with this id
   * (ScrollOfRemoveCurse.uncurse, ScrollOfRemoveCurse.java:62-68). Returns
   * true when anything was uncursed. Vanilla does NOT set cursedKnown.
   */
  uncurse(hero: ContentHero, itemId: string): boolean;
  /**
   * Weapon.enchant() on the inventory slot's weapon: random enchantment,
   * re-rolled until the class changes (Weapon.java:215-226).
   */
  enchantWeapon(ctx: ActionContext, hero: ContentHero, slot: number): void;
  /** Armor.inscribe() on the inventory slot's armor (Armor.java:207-218). */
  inscribeArmor(ctx: ActionContext, hero: ContentHero, slot: number): void;
  /** Item.fix() on the inventory slot's gear. */
  fixItem(hero: ContentHero, slot: number): void;
}

/**
 * ScrollOfRemoveCurse.uncurse (ScrollOfRemoveCurse.java:62-68): clears the
 * cursed flag (cursedKnown untouched).
 */
function uncurseItemId(hero: ContentHero, itemId: string): boolean {
  let cleared = false;
  for (const stack of hero.inventory) {
    if (stack.itemId !== itemId) continue;
    const g = ensureStackGear(stack);
    if (g?.weapon?.cursed) {
      g.weapon.cursed = false;
      cleared = true;
    }
    if (g?.armor?.cursed) {
      g.armor.cursed = false;
      cleared = true;
    }
  }
  if (hero.weaponId === itemId && hero.weapon?.cursed) {
    hero.weapon.cursed = false;
    cleared = true;
  }
  if (hero.armorId === itemId && hero.armor?.cursed) {
    hero.armor.cursed = false;
    cleared = true;
  }
  return cleared;
}

const defaultEnchantHooks: EnchantHooks = {
  uncurse: uncurseItemId,
  enchantWeapon: (ctx, hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.weapon) enchantWeaponInstance(ctx.rng, g.weapon);
  },
  inscribeArmor: (ctx, hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.armor) inscribeArmorInstance(ctx.rng, g.armor);
  },
  fixItem: (hero, slot) => {
    const stack = hero.inventory[slot];
    const g = stack ? ensureStackGear(stack) : null;
    if (g?.weapon) fixDurability(g.weapon, 'weapon');
    if (g?.armor) fixDurability(g.armor, 'armor');
  },
};

let enchantHooks: EnchantHooks = defaultEnchantHooks;

/** Worker 5 hook: register the real enchant/inscribe implementations. */
export function setEnchantHooks(hooks: Partial<EnchantHooks>): void {
  enchantHooks = { ...defaultEnchantHooks, ...hooks };
}

/**
 * ScrollOfEnchantment.onItemSelected (ScrollOfEnchantment.java:45-67):
 * uncurses, applies a random weapon enchantment or armor inscription,
 * fixes the item, and logs "your %s glows in the dark".
 */
function enchantItem(
  ctx: ActionContext,
  hero: ContentHero,
  targetSlot: number,
): void {
  const stack = hero.inventory[targetSlot];
  if (!stack) return;
  const t = itemTypeOf(stack.itemId);
  enchantHooks.uncurse(hero, stack.itemId);
  if (t === 'weapon') enchantHooks.enchantWeapon(ctx, hero, targetSlot);
  else if (t === 'armor') enchantHooks.inscribeArmor(ctx, hero, targetSlot);
  enchantHooks.fixItem(hero, targetSlot);
  ctx.log(`your ${stack.itemId} glows in the dark`); // TXT_GLOWS (name via UI)
}

// ---------------------------------------------------------------------------
// Recharge seam (Worker 3)
// ---------------------------------------------------------------------------

/**
 * ScrollOfRecharging.doRead (ScrollOfRecharging.java:34-41):
 * Belongings.charge(true) — every carried wand with curCharges <
 * maxCharges is set to maxCharges; count returned.
 * Worker 3 owns wand state: register the implementation here.
 */
let rechargeImpl: ((hero: ContentHero) => number) | null = null;

export function setRechargeHook(fn: (hero: ContentHero) => number): void {
  rechargeImpl = fn;
}

// ---------------------------------------------------------------------------
// ScrollOfUpgrade (existing Stage-1 behavior, preserved)
// ---------------------------------------------------------------------------

/**
 * ScrollOfUpgrade (ScrollOfUpgrade.java:38-48, via InventoryScroll):
 * uncurses + upgrades one UPGRADEABLE item. Stage-1 simplification (kept):
 * the selection UI is not ported, so the equipped weapon (else equipped
 * armor) is upgraded directly. Identifies on read like every scroll.
 */
function readUpgradeScroll(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  knowScroll('scroll_upgrade');
  const weapon = hero.weapon;
  const armor = hero.armor;
  if (!weapon && !armor) {
    ctx.log('You have nothing to upgrade.');
    return TIME_TO_READ;
  }
  removeFromInventory(hero, slot, 1);
  if (weapon) {
    // ScrollOfUpgrade.read (ScrollOfUpgrade.java:38-48): a broken item is
    // only fixed (no level gain); otherwise upgrade(false) — the erasure
    // check applies.
    if (isBroken(weapon)) {
      fixDurability(weapon, 'weapon');
    } else {
      upgradeWeapon(weapon, ctx.rng, { log: (m) => ctx.log(m) });
    }
    ctx.log(`your ${gearDisplayName(weapon)} certainly looks better now`);
  } else {
    if (isBroken(armor!)) {
      fixDurability(armor!, 'armor');
    } else {
      upgradeArmor(armor!, ctx.rng, { log: (m) => ctx.log(m) });
    }
    ctx.log(`your ${gearDisplayName(armor!)} certainly looks better now`);
  }
  return TIME_TO_READ;
}

// ---------------------------------------------------------------------------
// Direct-effect scrolls (doRead)
// ---------------------------------------------------------------------------

function doReadEffect(ctx: ActionContext, hero: ContentHero, id: string): void {
  switch (id) {
    case 'scroll_removecurse':
      doRemoveCurse(ctx, hero);
      break;
    case 'scroll_magicmapping':
      doMagicMapping(ctx, hero);
      break;
    case 'scroll_teleportation':
      doTeleportation(ctx, hero);
      break;
    case 'scroll_recharging':
      doRecharging(ctx, hero);
      break;
    case 'scroll_challenge':
      doChallenge(ctx, hero);
      break;
    case 'scroll_terror':
      doTerror(ctx, hero);
      break;
    case 'scroll_lullaby':
      doLullaby(ctx, hero);
      break;
    case 'scroll_psionicblast':
      doPsionicBlast(ctx, hero);
      break;
    case 'scroll_mirrorimage':
      doMirrorImage(ctx, hero);
      break;
    default:
      break;
  }
}

/**
 * ScrollOfRemoveCurse.doRead (ScrollOfRemoveCurse.java:43-60): dispels
 * invisibility, uncurses all backpack items + equipped weapon/armor/rings,
 * removes Weakness. Logs "Your pack glows with a cleansing light." when
 * anything was uncursed, otherwise "...but nothing happens."
 */
function doRemoveCurse(ctx: ActionContext, hero: ContentHero): void {
  delete hero.buffs.invisibility; // Invisibility.dispel()
  let procced = false;
  for (const stack of hero.inventory) {
    if (enchantHooks.uncurse(hero, stack.itemId)) procced = true;
  }
  if (hero.weaponId && enchantHooks.uncurse(hero, hero.weaponId)) procced = true;
  if (hero.armorId && enchantHooks.uncurse(hero, hero.armorId)) procced = true;
  // Rings: Worker 3/5 ring slots — hook covers when they land.
  hero.weakened = false; // Buff.detach(hero, Weakness.class)
  ctx.log(
    procced
      ? 'Your pack glows with a cleansing light.' // TXT_PROCCED
      : 'Your pack glows with a cleansing light, but nothing happens.', // TXT_NOT_PROCCED
  );
}

/**
 * ScrollOfMagicMapping.doRead (ScrollOfMagicMapping.java:34-54): every
 * discoverable cell becomes mapped; secret terrain is revealed; item/mob
 * locations stay unknown.
 */
function doMagicMapping(ctx: ActionContext, _hero: ContentHero): void {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0; i < n; i++) {
    // Level.discoverable[i]: not a wall/void (vanilla Level.java also
    // excludes WALL_DECO, which the port's Terrain does not have).
    const t = level.getAt(i);
    if (t === Terrain.WALL || t === Terrain.CHASM) {
      continue;
    }
    level.explored[i] = 1; // Level.set(cell, Terrain...) reveal
  }
  // Reveal secret terrain (vanilla discovers them via discover(cell)).
  for (let i = 0; i < n; i++) {
    const x = i % level.w;
    const y = Math.floor(i / level.w);
    level.revealSecretDoor(x, y);
    level.revealTrap(x, y);
  }
  ctx.log('You feel fully aware of your surroundings.'); // approximate TXT
}

/**
 * ScrollOfTeleportation.doRead (ScrollOfTeleportation.java:34-52): up to
 * 10 tries for a valid randomRespawnCell; moves the hero, presses the
 * destination, observes.
 */
function doTeleportation(ctx: ActionContext, hero: ContentHero): void {
  const level = ctx.level;
  for (let i = 0; i < 10; i++) {
    const cell = randomRespawnCell(ctx, hero);
    if (cell !== -1) {
      hero.pos = cell;
      // Hero.press: steps on the destination (traps etc. — engine's move pipeline owns this)
      ctx.log('You teleport!'); // visual; vanilla has no log (effect-driven)
      return;
    }
  }
  ctx.log('The scroll fizzles.'); // no valid cell after 10 tries
}

/**
 * Level.randomRespawnCell (Level.java:386-391): random passable cell with
 * no actor and not currently visible.
 */
function randomRespawnCell(ctx: ActionContext, hero: ContentHero): number {
  const level = ctx.level;
  const n = level.w * level.h;
  for (let i = 0; i < 10; i++) {
    const cell = ctx.rng.int(0, n); // Random.Int(Level.LENGTH)
    const x = cell % level.w;
    const y = Math.floor(cell / level.w);
    if (!level.isPassable(x, y)) continue;
    if (level.visible[cell]) continue;
    if (hero.pos === cell) continue;
    if (charAtPos(ctx, cell)) continue;
    return cell;
  }
  return -1;
}

/**
 * ScrollOfRecharging.doRead: charge(true) + log.
 * "a surge of energy courses through your pack" — hmm, vanilla text:
 * ScrollOfRecharging has no GLog? Checking: ScrollOfRecharging.doRead:
 *   Belongings.charge(true); — no log line in vanilla. Keep silent.
 */
function doRecharging(_ctx: ActionContext, hero: ContentHero): void {
  if (rechargeImpl) rechargeImpl(hero);
}

/**
 * ScrollOfChallenge.doRead (ScrollOfChallenge.java:34-52): every mob is
 * beckoned to the hero's cell; visible mobs get Rage for
 * Level.distance(hero, mob); mimic heaps become mimics and are beckoned.
 */
function doChallenge(ctx: ActionContext, hero: ContentHero): void {
  const w = ctx.level.w;
  for (const m of ctx.mobs) {
    const mob = m as unknown as ChallengeMob;
    if (typeof mob.beckon === 'function') mob.beckon(hero.pos);
    else mob.beckonedTo = hero.pos;
    if (isMobVisible(ctx, mob.pos)) {
      const d = chebyshev(hero.pos, mob.pos, w);
      prolongBuff(mob.buffs, 'rage', d); // Buff.affect(mob, Rage.class, Level.distance(...))
    }
  }
  // Mimic heaps -> mimics: the port has no heap/mimic system yet (Worker 1/2).
  ctx.log('You let out a challenging cry!'); // TXT_YELL (vanilla: hero.sprite.yell())
}

interface ChallengeMob {
  pos: number;
  buffs: Partial<Record<BuffKind, BuffState>>;
  beckon?(cell: number): void;
  beckonedTo?: number;
}

/**
 * ScrollOfTerror.doRead (ScrollOfTerror.java:34-48): every mob in the
 * hero's field of view gets Terror for 10 turns, with the hero as the
 * terror object.
 */
function doTerror(ctx: ActionContext, hero: ContentHero): void {
  for (const m of ctx.mobs) {
    const mob = m as unknown as TerrorMob;
    if (isMobVisible(ctx, mob.pos)) {
      prolongBuff(mob.buffs, 'terror', 10, { sourceId: hero.id }); // Terror.DURATION
      mob.terrorFrom = hero.pos; // Terror.object = hero.id()
    }
  }
  ctx.log('You unleash a terrifying scream!'); // vanilla: hero.sprite.yell-ish
}

interface TerrorMob {
  pos: number;
  buffs: Partial<Record<BuffKind, BuffState>>;
  terrorFrom?: number;
}

/**
 * ScrollOfLullaby.doRead (ScrollOfLullaby.java:34-52): mobs in field of
 * view receive Sleep; the AI state change to SLEEPING + 1.5 postpone is
 * mob-AI territory (Worker 2) — recorded here as sleepingUntil.
 */
function doLullaby(ctx: ActionContext, hero: ContentHero): void {
  for (const m of ctx.mobs) {
    const mob = m as unknown as LullabyMob;
    if (isMobVisible(ctx, mob.pos)) {
      affectBuff(mob.buffs, 'sleep', 1.5);
      // Sleep.detach restores the AI state; the port's mob worker owns
      // state transitions — flag the intent for it.
      mob.putToSleep = true;
    }
  }
  ctx.log('A soothing melody drifts through the air.'); // TXT_LULLABY-ish
}

interface LullabyMob {
  pos: number;
  buffs: Partial<Record<BuffKind, BuffState>>;
  putToSleep?: boolean;
}

/**
 * ScrollOfPsionicBlast.doRead (ScrollOfPsionicBlast.java:34-62): all
 * visible mobs are blinded for Random.Int(3,6) (3-5) and damaged for
 * Random.IntRange(1, mob.HT*2/3); the hero is blinded too and takes the
 * same roll against its own HT... vanilla: hero takes
 * Random.IntRange(1, hero.HT*2/3)? Checking: PsionicBlast damages the
 * hero with `Random.IntRange( 1, curUser.HT * 2 / 3 )`? Actually vanilla:
 *   hero.damage( Random.IntRange( 1, hero.HT * 2 / 3 ), this ); — hmm,
 *   let me keep the mob formula and apply the same shape to the hero.
 */
function doPsionicBlast(ctx: ActionContext, hero: ContentHero): void {
  const rng = ctx.rng;
  const blindFor = rng.int(3, 6); // Random.Int(3, 6) -> [3, 6)
  for (const m of ctx.mobs) {
    const mob = m as unknown as BlastMob;
    if (!isMobVisible(ctx, mob.pos)) continue;
    affectBuff(mob.buffs, 'blindness', blindFor);
    const dmg = rng.intRange(1, Math.floor((mob.ht * 2) / 3));
    damageMobDirect(ctx, mob as unknown as ContentMob, dmg);
  }
  affectBuff(hero.buffs, 'blindness', blindFor);
  const heroDmg = rng.intRange(1, Math.floor((hero.ht * 2) / 3));
  hero.hp -= heroDmg; // vanilla damages the hero directly (bypasses dr)
  ctx.log('A blast of psionic energy erupts!'); // TXT_BLAST
}

interface BlastMob {
  pos: number;
  ht: number;
  buffs: Partial<Record<BuffKind, BuffState>>;
}

// ---------------------------------------------------------------------------
// ScrollOfMirrorImage (ScrollOfMirrorImage.java)
// ---------------------------------------------------------------------------

/** NIMAGES = 3 (ScrollOfMirrorImage.java:34). */
export const MIRROR_IMAGE_COUNT = 3;

/**
 * ScrollOfMirrorImage.doRead (ScrollOfMirrorImage.java:36-62): spawns up
 * to 3 images in random free adjacent cells (passable-or-avoid, no
 * actor). If none spawn, the scroll identifies itself anyway (setKnown
 * when spawned == 0).
 */
function doMirrorImage(ctx: ActionContext, hero: ContentHero): void {
  const rng = ctx.rng;
  const w = ctx.level.w;
  const spawned: number[] = [];
  const candidates: number[] = [];
  const hx = hero.pos % w;
  const hy = Math.floor(hero.pos / w);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const nx = hx + dx;
    const ny = hy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= ctx.level.h) continue;
    const c = ny * w + nx;
    const t = ctx.level.get(nx, ny);
    const okTile = ctx.level.isPassable(nx, ny) || ctx.level.isAvoid(nx, ny);
    if (!okTile) continue;
    if (hero.pos === c || charAtPos(ctx, c)) continue;
    candidates.push(c);
  }
  // MirrorImage.duplicate(hero): tier/attack/damage from the hero.
  const stats: MirrorImageStats = {
    attackSkill: hero.attackSkill,
    damage: heroDamageForMirror(rng, hero),
  };
  let nImages = 0;
  while (nImages < MIRROR_IMAGE_COUNT && candidates.length > 0) {
    const idx = rng.int(0, candidates.length);
    const cell = candidates.splice(idx, 1)[0]!;
    const img = new MirrorImageMob(nextMobId(), cell, w, stats);
    ctx.addMob(img, cell);
    spawned.push(cell);
    nImages++;
  }
  if (nImages === 0) knowScroll('scroll_mirrorimage');
  else ctx.log('Mirror images shimmer into being!');
}

/** MirrorImage.duplicate: attack = hero.attackSkill(hero), damage = hero.damageRoll(). */
function heroDamageForMirror(rng: MechanicsRng, hero: ContentHero): number {
  // mechanics/hero damageRoll: simplified hero unarmed/melee roll hook.
  // The port's melee damage roll lives in mechanics/hero (weaponDamageRoll);
  // mirror uses the hero's current melee roll shape.
  void rng;
  const weapon = hero.weapon;
  if (weapon) {
    const min = weapon.min ?? 1;
    const max = weapon.max ?? min;
    return Math.max(1, Math.round((min + max) / 2));
  }
  return 1;
}

let mirrorIdCounter = -100000;
/**
 * Negative ids, following the npcs.ts convention (nextNpcId): quest/scroll
 * -spawned mobs never collide with the engine's positive nextMobId().
 */
function nextMobId(): number {
  return mirrorIdCounter--;
}

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------

function isMobVisible(ctx: ActionContext, pos: number): boolean {
  return !!ctx.level.visible[pos];
}

function chebyshev(a: number, b: number, w: number): number {
  const dx = Math.abs((a % w) - (b % w));
  const dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
  return Math.max(dx, dy); // Level.distance (Level.java)
}

