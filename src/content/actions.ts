/**
 * Hero interactions for Milestone 1: picking up, using (drink/eat/equip/
 * unlock), and throwing darts.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src (Hero.actPickUp
 * (Hero.java:1038-1054), Potion.apply (Potion.java:68-87), Food.execute
 * (Food.java:74-86), KindOfWeapon.doEquip/Armor.doEquip, Key (Key.java:65-79),
 * Hero.shoot (Hero.java:240-255)). Java wins every conflict.
 *
 * All item semantics read from src/content/items.ts (the catalog), not from
 * per-class Java files — except where the catalog explicitly quotes the
 * Java behavior in its comments.
 */
import { isHiddenTrap, Terrain } from '../core/grid.js';
import { type Level, type PlacedItem } from '../dungeon/level.js';
import type { ActionContext } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import { CRIPPLE_DURATION } from '../mechanics/buffs.js';
import { applyDamage } from '../mechanics/combat.js';
import {
  heroAttackSkill,
  heroDamageRoll,
  intentionalSearchLevel,
  passiveSearchLevel,
  searchTimeCost,
  vertigoRedirect,
} from '../mechanics/hero.js';
import { hasBuff } from '../mechanics/char.js';
import type { ArmorDef, WeaponDef } from '../mechanics/char.js';
import {
  initDurability,
  TXT_EQUIP_CURSED_ARMOR,
  TXT_EQUIP_CURSED_WEAPON,
  TXT_UNEQUIP_CURSED,
} from '../mechanics/durability.js';
import {
  MSG_HUNGRY,
  MSG_STARVED_TO_DEATH,
  MSG_STARVING,
} from '../mechanics/buffs.js';
import {
  HUNGER_STEP,
  hungerTick,
  isStarving,
  regenTick,
  satisfy,
  STARVING,
} from '../mechanics/hunger.js';
import { pressTrapCell } from '../mechanics/traps.js';
import { pressArenaCell } from '../dungeon/prisonBoss.js';
import { pressArenaCell as pressCavesArenaCell } from '../dungeon/cavesBoss.js';
import { pressArenaCell as pressCityArenaCell } from '../dungeon/cityBoss.js';
import { pedestalCell } from '../dungeon/cityLevel.js';
import { setKingPedestals } from '../mechanics/king.js';
import { spawnKingArena } from './king.js';
import { drinkWell } from './wellwire.js';
import { getItem, parseItemId } from './items.js';
import { drinkPotion as drinkPotionFull } from './potions.js';
import { readScroll as readScrollFull } from './scrolls.js';
import {
  addToInventory,
  countItem,
  removeFromInventory,
  syncDarts,
  type ContentHero,
  type ItemStack,
} from './hero.js';
import { heroOf, strikeHeroVsMob, buildMob, nextMobId, type ContentMob } from './mobs.js';
// Stage 2 (wands/rings worker): id predicates for the inventory use-path.
import { isWandId, rechargeWands } from './wands.js';
import { isRingId, tickRingClocks, useRingFromSlot } from './rings.js';

/**
 * Hero.actPickUp (Hero.java:1038-1054): one heap per action, takes 1 turn
 * (TIME_TO_PICK_UP = 1, Hero.java:33). Gold goes to the gold counter
 * (Gold.doPickUp, Gold.java:78-98).
 */
export function pickupAt(ctx: ActionContext, hero: ContentHero): number {
  const level = ctx.level;
  const item = level.items.find((it) => it.pos === hero.pos);
  if (!item) {
    ctx.log('There is nothing here to pick up.');
    return 1;
  }
  level.items = level.items.filter((it) => it !== item);
  const { defId, qty } = parseItemId(item.itemId);
  // Dewdrops never enter the backpack: doPickUp consumes them for healing
  // (Dewdrop.java:41-64).
  if (defId === 'dewdrop') return pickupDewdrop(ctx, hero, qty);
  // Locked chests need a golden key (Hero.actOpenChest, Hero.java:615-648).
  if (item.lockedChest) return openLockedChest(ctx, hero, item);
  const def = getItem(defId);
  if (def.type === 'gold') {
    hero.gold += qty;
    ctx.log(`You pick up ${qty} gold.`); // TXT_VALUE %d
  } else {
    addToInventory(hero, defId, qty);
    const label = qty > 1 ? `${qty}x ${def.name}` : def.name;
    ctx.log(`You pick up the ${label}.`);
  }
  return 1;
}

/**
 * Use the item in an inventory slot. Returns the turn cost.
 * Routes by catalog type (Item.execute branches in each Java class).
 */
export function useInventorySlot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  const def = getItem(stack.itemId);
  // Stage 3 (Worker A): wands route through cell targeting (Wand.execute
  // AC_ZAP -> GameScene.selectCell(zapper), Wand.java:123-126) — a bare
  // inventory 'use' only enters zap-targeting mode in the UiManager, so the
  // mechanics path is a no-op here. Rings equip into the two ring fingers
  // (Ring.doEquip, Ring.java:123-179).
  if (isWandId(stack.itemId)) {
    ctx.log('Choose a cell to zap.');
    return 0;
  }
  if (isRingId(stack.itemId)) {
    return useRingFromSlot(ctx, hero, slot) > 0 ? 1 : 0; // TIME_TO_EQUIP (Ring.java:179)
  }
  switch (def.type) {
    case 'potion':
      return drinkPotion(ctx, hero, slot, stack);
    case 'food':
      return eatFood(ctx, hero, slot, stack);
    case 'scroll':
      return readScroll(ctx, hero, slot, stack);
    case 'weapon':
      return equipWeaponFromInventory(ctx, hero, slot, stack);
    case 'armor':
      return equipArmorFromInventory(ctx, hero, slot, stack);
    case 'missile':
      ctx.log('Choose a target to throw the dart at.'); // M1: throwItem intent
      return 0;
    case 'key':
      return useKey(ctx, hero, slot, stack);
    case 'gold':
      return 1;
    case 'dewdrop':
    case 'seed':
      // Dewdrops auto-heal on pickup (never used from inventory); seed
      // planting/throwing arrives with the plant system. No-op for now.
      return 1;
    case 'bag':
    case 'misc':
    case 'quest':
      // Bags are containers (WndBag, not ported); torch/ankh/weightstone
      // have no use action in vanilla (passive or applied via other UI).
      // Quest items are handed to NPCs via dialog, not used from inventory.
      // The inventory UI only offers 'drop' for these (actionsFor default).
      return 1;
    case 'wand':
    case 'ring':
      // Intercepted by id above (isWandId/isRingId); unreachable here.
      // The wand-zap and ring-equip use-paths live in wands.ts/rings.ts.
      return 1;
  }
}

/** Drink a potion: Stage-2 full implementation (Worker 4).
 * Replaces the M1 healing/strength-only version; covers all 12 vanilla
 * potions with the exact identification system (potions.ts).
 */
function drinkPotion(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  _stack: ItemStack,
): number {
  return drinkPotionFull(ctx, hero, slot);
}

/**
 * Read a scroll: Stage-2 full implementation (Worker 4).
 * Replaces the M1 upgrade-only version; covers all 12 vanilla scrolls with
 * the exact identification system (scrolls.ts). The upgrade path keeps its
 * Stage-1-tested behavior (equipped weapon else armor).
 */
function readScroll(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  _stack: ItemStack,
): number {
  return readScrollFull(ctx, hero, slot);
}

/** Food.execute (Food.java:74-86): satisfy hunger, warrior heals 5. */
function eatFood(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  const def = getItem(stack.itemId);
  removeFromInventory(hero, slot, 1);
  hero.hungerLevel = satisfy(hero.hungerLevel, def.energy ?? 260); // Food.java:40
  if (hero.hp < hero.ht) {
    hero.hp = Math.min(hero.hp + 5, hero.ht); // Food.java:77-79
  }
  ctx.log('That food tasted delicious!'); // Food.java:82
  return 3; // TIME_TO_EAT (Food.java:35)
}

/**
 * KindOfWeapon.doEquip (KindOfWeapon.java:32-52): detach from the pack, equip
 * (the old weapon is unequipped first — which fails when cursed), mark
 * cursedKnown, and log the cursed-equip line. 1 turn (TIME_TO_EQUIP).
 */
function equipWeaponFromInventory(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  const def = getItem(stack.itemId);
  if (!def.weapon) {
    ctx.log("You can't wield that.");
    return 1;
  }
  // The old weapon must come off first (doUnequip fails when cursed).
  if (hero.weapon?.cursed) {
    ctx.log(TXT_UNEQUIP_CURSED.replace('%s', hero.weapon.name));
    return 1;
  }
  const oldWeapon = hero.weapon;
  const oldId = hero.weaponId;
  const inst: WeaponDef = stack.gear?.weapon
    ? { ...stack.gear.weapon }
    : { ...def.weapon };
  if (inst.durability === undefined) initDurability(inst, 'weapon');
  removeFromInventory(hero, slot, 1);
  hero.weapon = inst;
  hero.weaponId = def.id;
  // doEquip: cursedKnown = true, then the cursed-equip line (GLog.n).
  hero.weapon.cursedKnown = true;
  if (oldId && oldWeapon) {
    addToInventory(hero, oldId, 1, { weapon: oldWeapon });
  }
  ctx.log(`You equip the ${def.name}.`);
  if (inst.cursed) {
    ctx.log(TXT_EQUIP_CURSED_WEAPON.replace('%s', inst.name));
  }
  return 1; // TIME_TO_EQUIP
}

/**
 * Armor.doEquip (Armor.java:87-106): same shape as the weapon path, with
 * the armor cursed-equip line ("your %s constricts around you painfully").
 */
function equipArmorFromInventory(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  const def = getItem(stack.itemId);
  if (!def.armor) {
    ctx.log("You can't wear that.");
    return 1;
  }
  if (hero.armor?.cursed) {
    ctx.log(TXT_UNEQUIP_CURSED.replace('%s', hero.armor.name));
    return 1;
  }
  const oldArmor = hero.armor;
  const oldId = hero.armorId;
  const inst: ArmorDef = stack.gear?.armor
    ? { ...stack.gear.armor }
    : { ...def.armor };
  if (inst.durability === undefined) initDurability(inst, 'armor');
  removeFromInventory(hero, slot, 1);
  hero.armor = inst;
  hero.armorId = def.id;
  hero.armor.cursedKnown = true;
  if (oldId && oldArmor) {
    addToInventory(hero, oldId, 1, { armor: oldArmor });
  }
  ctx.log(`You equip the ${def.name}.`);
  if (inst.cursed) {
    ctx.log(TXT_EQUIP_CURSED_ARMOR.replace('%s', inst.name));
  }
  return 1; // TIME_TO_EQUIP
}

/**
 * Key use (Key.java:65-79): iron key unlocks a locked door (takes 1 turn,
 * TIME_TO_UNLOCK, Key.java:29); the skeleton key unlocks the boss-exit lock
 * (SkeletonKey, via LockedExit mechanics).
 */
function useKey(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  const level = ctx.level;
  const w = level.w;
  const x = hero.x;
  const y = hero.y;
  const lockedAround = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  if (stack.itemId === 'iron_key') {
    for (const [nx, ny] of lockedAround) {
      if (level.inBounds(nx, ny) && level.get(nx, ny) === Terrain.DOOR_LOCKED) {
        level.set(nx, ny, Terrain.DOOR); // Door.unlock (Door.java:75-93)
        removeFromInventory(hero, slot, 1);
        ctx.log('You unlock the door.'); // TXT_UNLOCK
        return 1; // TIME_TO_UNLOCK
      }
    }
    ctx.log('There is no locked door nearby.');
    return 1;
  }
  if (stack.itemId === 'skeleton_key') {
    for (const [nx, ny] of lockedAround) {
      if (level.inBounds(nx, ny) && level.get(nx, ny) === Terrain.EXIT_LOCKED) {
        level.set(nx, ny, Terrain.EXIT); // LockedExit.unlock (SewerBossLevel)
        removeFromInventory(hero, slot, 1);
        ctx.log('You unlock the way down with the skeleton key.');
        return 1;
      }
    }
    ctx.log('There is no locked exit nearby.');
    return 1;
  }
  ctx.log("You can't use that here.");
  return 1;
}

/**
 * Hero.shoot (Hero.java:240-255): accuracy = attackSkill(ranged),
 * damageRoll(ranged), miss recovers the dart at the target cell
 * (MissileWeapon.onThrow miss branch, MissileWeapon.java:85-88), then
 * belongs.ranged = null (Hero.java:253-254).
 */
export function throwDart(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  targetPos: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== 'dart') {
    ctx.log('You have no darts to throw.');
    return 1;
  }
  const level = ctx.level;
  const trace = dartTrace(level, hero.pos, targetPos);
  removeFromInventory(hero, slot, 1);
  syncDarts(hero);

  // Hit the first mob along the trace (Hero.shoot -> MissileWeapon.onThrow).
  for (const cell of trace.cells) {
    const mob = ctx.mobs.find(
      (m) => m.isAlive() && m.x === cell % level.w && m.y === Math.floor(cell / level.w),
    ) as ContentMob | undefined;
    if (mob) {
      const ranged = { ...getItem('dart').weapon! };
      const dist = trace.distances.get(cell) ?? 1;
      try {
        hero.rangedWeapon = ranged; // Belongings.ranged (Hero.java:250)
        strikeHeroVsMob(
          ctx,
          hero,
          mob,
          heroAttackSkill(hero, { ranged: true, adjacent: dist <= 1 }),
          (rng) => heroDamageRoll(rng, hero, { ranged: true }),
        );
      } finally {
        hero.rangedWeapon = null; // Hero.java:253-254
      }
      return 1; // TIME_TO_THROW (MissileWeapon.java:34)
    }
  }
  // Miss: the dart lands at the end of the trace.
  dropDartAt(level, trace.landCell);
  ctx.log('The dart clatters to the floor.'); // MissileWeapon.onThrow miss
  return 1;
}

function dropDartAt(level: Level, pos: number): void {
  level.items.push({ pos, itemId: 'dart', sprite: getItem('dart').sprite });
}

/**
 * 'equip' intent: equip a weapon/armor from the inventory, or unequip the
 * currently equipped gear when the slot is -1 (weapon) / -2 (armor).
 * (Slot convention owned by the content inventory adapter in hooks.ts.)
 */
export function equipSlot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  if (slot === -1) {
    if (!hero.weaponId) {
      ctx.log('You wield nothing.');
      return 1;
    }
    // EquipableItem.doUnequip (EquipableItem.java:70-90): cursed gear
    // cannot come off ("You can't remove cursed %s!").
    if (hero.weapon?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace('%s', hero.weapon.name));
      return 1;
    }
    const def = getItem(hero.weaponId);
    const inst = hero.weapon;
    addToInventory(hero, hero.weaponId, 1, inst ? { weapon: inst } : undefined);
    hero.weapon = null;
    hero.weaponId = null;
    ctx.log(`You unwield the ${def.name}.`);
    return 1;
  }
  if (slot === -2) {
    if (!hero.armorId) {
      ctx.log('You wear nothing.');
      return 1;
    }
    if (hero.armor?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace('%s', hero.armor.name));
      return 1;
    }
    const def = getItem(hero.armorId);
    const inst = hero.armor;
    addToInventory(hero, hero.armorId, 1, inst ? { armor: inst } : undefined);
    hero.armor = null;
    hero.armorId = null;
    ctx.log(`You take off the ${def.name}.`);
    return 1;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  const def = getItem(stack.itemId);
  if (def.type === 'weapon') return equipWeaponFromInventory(ctx, hero, slot, stack);
  if (def.type === 'armor') return equipArmorFromInventory(ctx, hero, slot, stack);
  // Ring.doEquip (Ring.java:123-179): into ring1/ring2; both full -> vanilla
  // opens WndOptions to pick a finger (the port logs and spends no time so
  // the player can free a finger first). TIME_TO_EQUIP on success.
  if (isRingId(stack.itemId)) {
    const finger = useRingFromSlot(ctx, hero, slot);
    if (finger === 0) {
      ctx.log('Unequip one ring first.'); // WndOptions TXT_UNEQUIP_TITLE (Ring.java:131)
      return 0;
    }
    return 1; // TIME_TO_EQUIP (Ring.java:179)
  }
  ctx.log("You can't equip that.");
  return 1;
}

/**
 * 'drop' intent: drop the whole stack (or the equipped item for slots
 * -1/-2) on the floor. Takes 0.5 turns (TIME_TO_DROP, Item.java:70).
 */
export function dropSlot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  if (slot === -1 || slot === -2) {
    const equippedId = slot === -1 ? hero.weaponId : hero.armorId;
    if (!equippedId) {
      ctx.log('Nothing in that slot.');
      return 1;
    }
    // Dropping equipped gear unequips it first (Item.doDrop -> detach);
    // cursed gear cannot come off (EquipableItem.java:70-90).
    const inst = slot === -1 ? hero.weapon : hero.armor;
    if (inst?.cursed) {
      ctx.log(TXT_UNEQUIP_CURSED.replace('%s', inst.name));
      return 1;
    }
    if (slot === -1) {
      hero.weapon = null;
      hero.weaponId = null;
    } else {
      hero.armor = null;
      hero.armorId = null;
    }
    const def = getItem(equippedId);
    ctx.level.items.push({
      pos: hero.pos,
      itemId: equippedId,
      sprite: def.sprite,
    });
    ctx.log(`You drop the ${def.name}.`);
    return 0.5;
  }
  const stack = hero.inventory[slot];
  if (!stack) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  const removed = removeFromInventory(hero, slot, stack.qty);
  const def = getItem(removed!.itemId);
  ctx.level.items.push({
    pos: hero.pos,
    itemId: removed!.itemId,
    sprite: def.sprite,
  });
  ctx.log(`You drop the ${def.name}.`);
  return 0.5;
}

/**
 * Chasm jump confirmation (Chasm.heroJump, Chasm.java:30-54).
 *
 * Vanilla shows a modal WndOptions: "Do you really want to jump into the
 * chasm? You can probably die." (TXT_JUMP, Chasm.java:35-36) with
 * "Yes, I know what I'm doing" / "No, I changed my mind" (TXT_YES/TXT_NO).
 * Yes sets jumpConfirmed=true and resumes the interrupted move; No (or
 * tapping elsewhere) dismisses. The port has no modal dialogs, so the
 * confirmation is two taps: the first step toward a chasm cell arms it and
 * logs the warning (the hero does not move — the move is interrupted for
 * free, Hero.getCloser → Chasm.heroJump → interrupt(), Hero.java:919-925);
 * repeating the exact same step confirms the jump ("Yes"). Any other step
 * disarms it ("No"). A flying hero steps over chasms freely — vanilla
 * skips press() while flying (Hero.move, Hero.java:1229-1239), so no fall.
 */
let chasmArmed: { from: number; to: number } | null = null;

/** Test hook: clear the chasm confirmation between runs. */
export function resetChasmState(): void {
  chasmArmed = null;
}

/**
 * Step toward a chasm cell (Hero.getCloser, Hero.java:919-925).
 * Returns the turn cost of the intent: 0 for the warning (vanilla's modal
 * dialog passes no time — interrupt() + ready() spend nothing), the fall
 * cost (1) once confirmed.
 */
function stepTowardChasm(
  ctx: ActionContext,
  hero: ContentHero,
  nx: number,
  ny: number,
): number {
  const level = ctx.level;
  const from = hero.pos;
  const to = ny * level.w + nx;
  if (hero.flying) {
    hero.pos = to;
    passiveSearch(ctx, hero);
    return 1; // TIME_TO_MOVE (Hero.java:36)
  }
  if (chasmArmed !== null && chasmArmed.from === from && chasmArmed.to === to) {
    chasmArmed = null;
    return heroFall(ctx, hero);
  }
  chasmArmed = { from, to };
  ctx.log('Do you really want to jump into the chasm? You can probably die.'); // TXT_JUMP (Chasm.java:35-36)
  return 0; // interrupted for free (Hero.getCloser, Hero.java:921-924)
}

/**
 * Chasm.heroFall (Chasm.java:52-72) + landing (Chasm.heroLand,
 * Chasm.java:74-87).
 *
 * Vanilla: jumpConfirmed=false; SND_FALLING; interrupt(); then
 * InterlevelScene FALL → the next depth, landing either at the pit cell of
 * a weak-floor room (fallIntoPit, InterlevelScene.java:243) or a random
 * respawn cell. On landing: blood burst + camera shake, Cripple prolonged
 * to DURATION (10), then damage Random.IntRange(HT/3, HT/2) via Hero.Doom,
 * whose onDeath logs "You fell to death..." (Chasm.java:79-86) — no armor
 * DR applies (Char.damage, not attack()).
 *
 * PORT SCOPE: ActionContext has no depth-transition seam (no
 * InterlevelScene equivalent — the engine worker owns level transitions),
 * so the fall resolves on the current depth: the hero does not move (chasm
 * cells are impassable), takes the exact landing damage + Cripple, and the
 * fall is logged. Wire the real transition when the engine seam exists.
 */
export function heroFall(ctx: ActionContext, hero: ContentHero): number {
  chasmArmed = null; // jumpConfirmed = false (Chasm.java:55)
  // SND_FALLING + InterlevelScene.Mode.FALL: engine seam needed (see above).
  ctx.log('You fall into the chasm!');
  // Chasm.heroLand (Chasm.java:74-87): Buff.prolong(hero, Cripple.class,
  // Cripple.DURATION) — prolong sets the remaining duration to DURATION.
  hero.buffs.cripple = { kind: 'cripple', left: CRIPPLE_DURATION };
  // hero.damage(Random.IntRange(hero.HT/3, hero.HT/2), Doom) — Java integer
  // division floors both endpoints; IntRange is inclusive (Chasm.java:79).
  const dmg = ctx.rng.intRange(
    Math.floor(hero.ht / 3),
    Math.floor(hero.ht / 2),
  );
  const applied = applyDamage(ctx.rng, hero, dmg);
  hero.hp = applied.hp;
  if (applied.paralysisBroken) {
    hero.paralysed = false;
    delete hero.buffs.paralysis;
  }
  if (!hero.isAlive()) {
    // Hero.Doom.onDeath (Chasm.java:80-86): Badges.validateDeathFromFalling
    // + Dungeon.fail(FALL) are Stage 6 (badges/rankings); the player-facing
    // message is GLog.n("You fell to death...").
    ctx.log('You fell to death...');
  }
  return 1; // TIME_TO_MOVE (Hero.java:36)
}

/**
 * Chasm.mobFall (Chasm.java:89-92): a mob that ends up over a pit is
 * destroyed outright (no EXP, no loot — destroy(), not die()). Vanilla
 * trigger: Level.mobPress (Level.java:729-732). Currently unreachable in
 * the port (mobs path only through passable tiles and CHASM is not
 * passable); kept exact for future knockback/teleport work.
 */
export function mobFall(ctx: ActionContext, mob: ContentMob): void {
  mob.hp = 0;
  ctx.killMob(mob); // engine removal; exp/loot intentionally skipped (destroy)
}

/**
 * Door.enter (Door.java:14-21): stepping onto a closed door swings it open
 * (DOOR → OPEN_DOOR) and refreshes the map/FOV (GameScene.updateMap +
 * Dungeon.observe — the engine recomputes FOV afterAction). No extra time:
 * opening is part of the move step (vanilla spends 1/speed() for the step;
 * Door.enter itself spends nothing).
 */
export function doorEnter(ctx: ActionContext, x: number, y: number): void {
  ctx.level.set(x, y, Terrain.OPEN_DOOR);
}

/**
 * Door.leave (Door.java:23-29): leaving an open door swings it shut
 * (OPEN_DOOR → DOOR) unless a heap lies on it. Port heaps = placed items.
 * (Mob equivalent lives in mobs.ts afterMove; kept separate to avoid a
 * content cycle — see the note there.)
 */
export function doorLeave(ctx: ActionContext, x: number, y: number): void {
  const level = ctx.level;
  if (!level.items.some((it) => it.pos === level.idx(x, y))) {
    level.set(x, y, Terrain.DOOR);
  }
}

/**
 * HighGrass.trample (HighGrass.java:33-71): stepping on high grass flattens
 * it to GRASS and may shake loose a seed or a dewdrop. Placed in
 * enterCell() in vanilla Level.press order: traps → grass → well →
 * alchemy → door (Level.java:622-704).
 *
 * Vanilla details:
 * - Level.set(pos, GRASS) + GameScene.updateMap (HighGrass.java:35-36).
 * - The seed/dew rolls are skipped under the NO_HERBALISM challenge
 *   (HighGrass.java:38); challenges are Stage 6, so rolls always happen.
 * - herbalismLevel = the trampler's RingOfHerbalism buff level, default 0
 *   (HighGrass.java:39-45); the ring is not ported → always 0.
 * - Seed: Random.Int(18) <= Random.Int(herbalismLevel+1) → 1/18 at level 0
 *   (HighGrass.java:47-49). Dew: Random.Int(6) <= Random.Int(herbalismLevel+1)
 *   → 1/6 at level 0 (HighGrass.java:52-54).
 * - Warden subclass: Barkskin at HT/3 + 8 leaves (HighGrass.java:60-64);
 *   hero subclasses are Stage 5 — warrior-only port, branch inert.
 * - LeafParticle burst 4/8 + Dungeon.observe() (HighGrass.java:66-68):
 *   visuals; the engine recomputes FOV afterAction.
 */
export function trampleHighGrass(
  ctx: ActionContext,
  hero: ContentHero,
  x: number,
  y: number,
): void {
  const level = ctx.level;
  level.set(x, y, Terrain.GRASS);
  const herbalismLevel = 0; // no RingOfHerbalism in the port (see above)
  if (ctx.rng.int(0, 18) <= ctx.rng.int(0, herbalismLevel + 1)) {
    dropAt(ctx, level.idx(x, y), 'seed');
  }
  if (ctx.rng.int(0, 6) <= ctx.rng.int(0, herbalismLevel + 1)) {
    dropAt(ctx, level.idx(x, y), 'dewdrop');
  }
}

/** Place an item on the floor (vanilla Level.drop(item, pos)). */
function dropAt(ctx: ActionContext, pos: number, itemId: string): void {
  ctx.level.items.push({ pos, itemId, sprite: getItem(itemId).sprite });
}

/**
 * Dewdrop.doPickUp (Dewdrop.java:41-64): the drop never sits in the
 * backpack — it is consumed on pickup. healValue = 1 + (depth-1)/5, Java
 * integer division (Dewdrop.java:47); +1 for the huntress (Dewdrop.java:48-50)
 * — the port is warrior-only, so no bonus. effect = min(HT-HP, value*quantity);
 * heals for that (showStatus "%+dHP", Dewdrop.java:31).
 *
 * STAGE 0 SCOPE: the DewVial is not ported, so the vial branch
 * (vial.collectDew, Dewdrop.java:57-61) cannot fire; with vial == null the
 * drop always takes the direct-heal branch (Dewdrop.java:45). At full HP the
 * drop is still consumed for no healing — exactly like vanilla.
 */
export function pickupDewdrop(
  ctx: ActionContext,
  hero: ContentHero,
  qty: number,
): number {
  // (pickupAt already lifted the drop off the floor.)
  const level = ctx.level;
  const value = 1 + Math.floor((level.depth - 1) / 5); // (Dungeon.depth-1)/5
  const effect = Math.min(hero.ht - hero.hp, value * qty);
  if (effect > 0) {
    hero.hp += effect;
    ctx.log(`+${effect}HP`); // TXT_VALUE "%+dHP" (Dewdrop.java:31)
  }
  // SND_DEWDROP: no audio in the port.
  return 1; // TIME_TO_PICK_UP (Hero.java:40)
}

/**
 * Locked chest (Hero.actOpenChest, Hero.java:615-648 + onOperateComplete,
 * Hero.java:1277-1288). A LOCKED_CHEST/CRYSTAL_CHEST heap needs a
 * depth-matching GoldenKey. Without it: GLog.w("This chest is locked and
 * you don't have matching key") (TXT_LOCKED_CHEST, Hero.java:124) and no
 * time is spent (ready()). With it: spend Key.TIME_TO_UNLOCK (1)
 * (Key.java:26), the key is consumed, and the heap opens — unlocking and
 * opening are a single action (heap.open in onOperateComplete).
 *
 * Port: heaps are simplified to floor items (spawns.ts); the pickup intent
 * stands in for OpenChest (vanilla allows adjacent or same-cell; the port
 * has no adjacent-interact intent, so the hero steps onto the chest cell).
 * Like vanilla keys, GoldenKeys are depth-specific (Key.depth) — the port
 * does not track key depth, so any golden key opens any locked chest (same
 * documented gap as iron keys).
 */
export function openLockedChest(
  ctx: ActionContext,
  hero: ContentHero,
  item: PlacedItem,
): number {
  const level = ctx.level;
  const keySlot = hero.inventory.findIndex((s) => s.itemId === 'golden_key');
  if (keySlot === -1) {
    ctx.log("This chest is locked and you don't have matching key"); // TXT_LOCKED_CHEST (Hero.java:124)
    return 0; // ready(), no time spent (Hero.java:631-633)
  }
  removeFromInventory(hero, keySlot, 1); // theKey.detach (Hero.java:1280-1283)
  // heap.open(hero): the chest opens and the loot is taken. The port places
  // chest loot directly on the floor, so taking it now IS the open.
  level.items = level.items.filter((it) => it !== item);
  const { defId, qty } = parseItemId(item.itemId);
  const def = getItem(defId);
  const label = qty > 1 ? `${qty}x ${def.name}` : def.name;
  if (def.type === 'gold') {
    hero.gold += qty; // Gold.doPickUp adds to the purse (Gold.java:65-75)
    ctx.log(`You unlock the chest and take ${qty} gold.`);
  } else {
    addToInventory(hero, defId, qty);
    ctx.log(`You unlock the chest and take the ${label}.`); // SND_UNLOCK in vanilla; no audio here
  }
  return 1; // Key.TIME_TO_UNLOCK (Key.java:26)
}

/**
 * Sign tips (Sign.java:28-68). Depth d (1-based) reads TIPS[d-1]. Depths
 * past the tip list burn the sign instead (Sign.read, Sign.java:84-101);
 * the DeadEndLevel branch (Sign.java:74-78) has no port equivalent (no
 * DeadEndLevel in the Sewers). Sign cells come from the generator's
 * PainterMarkers.signs (one in the entrance room per sewer depth, never on
 * the entrance cell — SewerLevel.java:93-103, SewerBossLevel.java:160-170).
 */
const SIGN_TIPS = [
  'Wear the highest tier armor you can; do not rely on dodging alone.',
  'Enchantments on weapons and armor are potent; identify items to find them.',
  'Dewdrops heal a little; save potions of healing for emergencies.',
  'Do not be afraid to run from a fight you cannot win.',
  'Upgrade scrolls are precious; spend them on gear you will keep.',
  'Mystery meat is risky; cook it at a stove if you can.',
  'Strength potions let you wear heavier gear sooner.',
  'Hidden traps and doors can be found by searching.',
  'Blandfruit can be cooked with seeds for useful meals.',
  'Flies are weak alone; do not let a swarm surround you.',
  'Gnoll scouts hit hard; use doorways to fight them one at a time.',
  'Crabs block a lot of damage; use wands or surprise attacks.',
  'Goo is coming. Fire will keep it from healing.',
  'Fire hurts Goo, but do not stand in it yourself.',
  'Keep your distance from spinners and their webs.',
  'Skeletons hit hard; blind or slow them first.',
  'Thieves steal; kill them before they flee with your gear.',
  'Shaman bolts hurt; break line of sight.',
  'Brutes enrage when hurt; finish them quickly.',
  'DM-300 is coming. Lightning hurts it most.',
  'Lightning wands and surprise attacks bring DM-300 down.',
  'The City awaits. Mind the monks and their disabling strikes.',
] as const;

/** Cells carrying a painted sign, per generated level. */
const signCells = new WeakMap<object, Set<number>>();

/**
 * Register the generator's sign markers for a level. Called by the engine's
 * level-setup path (hooks.ts spawnMobs) from PainterMarkers.signs.
 */
export function noteSignCells(level: object, cells: number[]): void {
  signCells.set(level, new Set(cells));
}

/**
 * Cells with WALL_DECO terrain (dark gold veins), per generated level.
 * Registered by the engine's level-setup path (hooks.ts spawnMobs) from
 * PainterMarkers.wallDeco — the veins are wall cells with WALL_DECO tile
 * data (Level.WALL_DECO), not live actors.
 */
const wallDecoCells = new WeakMap<object, Set<number>>();

export function noteWallDecoCells(level: object, cells: number[]): void {
  wallDecoCells.set(level, new Set(cells));
}

/**
 * Pickaxe.execute AC_MINE (Pickaxe.java:59-108): outside depths 11-15, or
 * with no WALL_DECO cell in the 8 neighbors, log TXT_NO_VEIN (no time
 * spent — the spend happens only when a vein is found). On a vein: spend
 * TIME_TO_MINE (2), convert the vein to plain wall, grant one dark gold
 * ore, and satisfy non-starving hunger by STARVING/10 (36).
 */
export function mineDarkGold(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== 'pickaxe') {
    ctx.log('Nothing to mine with.');
    return 0;
  }
  if (ctx.level.depth < 11 || ctx.level.depth > 15) {
    ctx.log(TXT_NO_VEIN); // GLog.w
    return 0;
  }
  const veins = wallDecoCells.get(ctx.level);
  const w = ctx.level.w;
  const hx = hero.pos % w;
  const hy = Math.floor(hero.pos / w);
  let vein: number | null = null;
  for (let dy = -1; dy <= 1 && vein === null; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const pos = (hy + dy) * w + (hx + dx);
      if (veins?.has(pos)) {
        vein = pos;
        break;
      }
    }
  }
  if (vein === null) {
    ctx.log(TXT_NO_VEIN); // GLog.w
    return 0;
  }
  veins!.delete(vein);
  // Level.set(pos, Terrain.WALL) + GameScene.updateMap(pos)
  // (Pickaxe.java:90-91): the port's painters store WALL_DECO veins as plain
  // WALL tiles (painters.ts:59), so deleting the marker cell IS the
  // conversion — no tile-map change is needed.
  // DarkGold.doPickUp → "You now have dark gold ore" (Hero.TXT_YOU_NOW_HAVE).
  addToInventory(hero, 'darkgold', 1);
  ctx.log('You now have dark gold ore');
  if (hero.hungerLevel < STARVING) {
    hero.hungerLevel = satisfy(hero.hungerLevel, -STARVING / 10);
  }
  return 2; // TIME_TO_MINE
}

const TXT_NO_VEIN = 'There is no dark gold vein near you to mine';

/**
 * Sign.read (Sign.java:72-102). Vanilla trigger: a Move action that cannot
 * move while standing on a SIGN (Hero.actMove, Hero.java:485-498) — reading
 * spends no time (ready(), not spend()). The port has no tap-self move, so
 * the 'wait' intent reads a sign when standing on one (see waitTurn).
 */
export function readSign(ctx: ActionContext, hero: ContentHero): number {
  const cells = signCells.get(ctx.level);
  if (!cells || !cells.has(hero.pos)) return 1; // not on a sign: plain wait
  const index = ctx.level.depth - 1;
  if (index < SIGN_TIPS.length) {
    ctx.log(SIGN_TIPS[index]); // WndMessage(TIPS[index]) (Sign.java:84-88)
  } else {
    // Burn branch (Sign.read, Sign.java:89-101): the sign is destroyed
    // (Level.destroy → EMBERS, Level.java:475-479); green flames + burn
    // sound in vanilla — the port logs the message (TXT_BURN, Sign.java:70-71).
    cells.delete(hero.pos);
    ctx.level.set(hero.x, hero.y, Terrain.EMBERS);
    ctx.log('As you try to read the sign it bursts into greenish flames.'); // TXT_BURN
  }
  return 0; // reading costs no time (Hero.actMove → ready(), Hero.java:493-497)
}

/**
 * 'wait' intent. Vanilla tap-self while standing on a SIGN reads the sign
 * for free (Hero.actMove, Hero.java:485-498); otherwise a plain wait (1 turn).
 */
export function waitTurn(ctx: ActionContext, hero: ContentHero): number {
  return readSign(ctx, hero);
}

/** Move (or unlock) toward a locked door, bump-attack a mob, or step. */
export function moveHero(
  ctx: ActionContext,
  hero: ContentHero,
  dx: number,
  dy: number,
): number {
  const level = ctx.level;
  // Hero.getCloser (Hero.java:908-913): a rooted hero cannot step — the
  // camera shake is visual (renderer territory); the turn is still spent
  // (the vanilla action branch spends regardless of getCloser's result).
  if (hero.rooted) return 1; // TIME_TO_MOVE (Hero.java:36)
  let nx = hero.x + dx;
  let ny = hero.y + dy;
  if (!level.inBounds(nx, ny)) return 1;
  // Vanilla Hero.handle: walking into a mob attacks it instead of moving.
  // (Attacks never go through Char.move, so Vertigo does not redirect them.)
  const foe = ctx.mobs.find(
    (m) => m.isAlive() && m.x === nx && m.y === ny,
  ) as ContentMob | undefined;
  if (foe) {
    strikeHeroVsMob(
      ctx,
      hero,
      foe,
      heroAttackSkill(hero, { ranged: false, adjacent: false }),
      (r) => heroDamageRoll(r, hero, { ranged: false }),
    );
    return 1; // TIME_TO_ATTACK (Hero.java:38)
  }
  // Vertigo (Char.move, Char.java:474-482): an adjacent step is replaced by
  // a random one of the 8 neighbors. A blocked redirect cancels the move,
  // but the turn is still spent (Hero.act still calls spend(1 / speed()),
  // Hero.java:949) and the post-move search still runs (onMotionComplete).
  if (hasBuff(hero, 'vertigo')) {
    const step = vertigoRedirect(ctx.rng, hero.pos, level.w, (p) => {
      const px = p % level.w;
      const py = Math.floor(p / level.w);
      return (
        !level.inBounds(px, py) ||
        !level.isPassable(px, py) ||
        ctx.mobs.some((m) => m.isAlive() && m.x === px && m.y === py)
      );
    });
    if (step === null) {
      // Vanilla Hero.onMotionComplete -> search(false) (Hero.java:1241-1246).
      passiveSearch(ctx, hero);
      return 1; // TIME_TO_MOVE (Hero.java:36)
    }
    nx = step % level.w;
    ny = Math.floor(step / level.w);
  }
  const tile = level.get(nx, ny);
  // Chasm (Hero.getCloser, Hero.java:919-925): never step in unprompted —
  // first tap warns, the repeat confirms, flying steps over freely.
  if (tile === Terrain.CHASM) return stepTowardChasm(ctx, hero, nx, ny);
  if (tile === Terrain.DOOR_LOCKED) {
    const keySlot = hero.inventory.findIndex((s) => s.itemId === 'iron_key');
    if (keySlot === -1) {
      // actUnlock without a matching key: warning, no time spent
      // (GLog.w + ready(), Hero.java:688-691).
      ctx.log("You don't have a matching key"); // TXT_LOCKED_DOOR (Hero.java:125)
      return 0;
    }
    // Vanilla HeroAction.Unlock with the key (Hero.java:680-687, 1264-1277):
    // spend Key.TIME_TO_UNLOCK = 1 (Key.java:26); the door becomes a plain
    // DOOR and the hero does NOT step in — the next move opens it
    // (Door.enter via press, Level.java:695-706).
    level.set(nx, ny, Terrain.DOOR);
    removeFromInventory(hero, keySlot, 1);
    ctx.log('You unlock the door.'); // SND_UNLOCK in vanilla; no audio here
    return 1; // TIME_TO_UNLOCK (Key.java:26)
  }
  if (!level.isPassable(nx, ny)) return 1;
  // Char.move (Char.java:484-486): an open door swings shut behind any char
  // unless a heap lies on it.
  if (level.get(hero.x, hero.y) === Terrain.OPEN_DOOR) {
    doorLeave(ctx, hero.x, hero.y);
  }
  hero.pos = ny * level.w + nx;
  // STAGE0-TRAP (worker 2/5): vanilla Hero.move -> if (!flying) Dungeon.level.press(pos, this) (Hero.java:1230-1238).
  if (!hero.flying) {
    pressTrapCell(ctx, hero.pos, hero, (mobId, pos) => {
      // SummoningTrap: Bestiary.mob(depth), state = WANDERING,
      // GameScene.add(mob, DELAY = 2) (SummoningTrap.java).
      const mob = buildMob(mobId, nextMobId(), pos, level.w);
      mob.state = 'wandering';
      ctx.addMob(mob, 2);
    });
    // PrisonBossLevel.press (PrisonBossLevel.java:303-328): the hero's first
    // step inside the Tengu arena spawns Tengu (HUNTING) at a free arena cell
    // and re-locks the arena door. No-op on levels without an arena.
    // CavesBossLevel.press (CavesBossLevel.java:184-214): the hero's first
    // step OUTSIDE the entrance room spawns DM-300 (HUNTING) at a random
    // passable, non-visible cell outside the room and collapses the arena
    // door to WALL. Depth-gated: both levels reuse the bossArena /
    // arenaDoorCell fields, so the wrong hook must never fire.
    if (ctx.level.depth === 10) {
      pressArenaCell(ctx.level, ctx.rng, hero.pos, {
        occupied: (pos) => pos === hero.pos || ctx.mobs.some((m) => m.y * level.w + m.x === pos),
        spawn: (pos) => {
          // Bestiary.mob(depth) at depth 10 -> Tengu (Bestiary.java:107-110);
          // boss.state = boss.HUNTING; GameScene.add( boss ) (PrisonBossLevel.java:316-319).
          const tengu = buildMob('tengu', nextMobId(), pos, level.w);
          tengu.state = 'hunting';
          ctx.addMob(tengu);
          // boss.notice() -> Tengu.notice() yell (Tengu.java:170-174).
          tengu.notice(ctx);
          // mobPress( boss ) (PrisonBossLevel.java:322): the arena interior is
          // inactive-trap fill, so there is nothing to trigger.
        },
      });
    } else if (ctx.level.depth === 15) {
      pressCavesArenaCell(ctx.level, ctx.rng, hero.pos, {
        occupied: (pos) => pos === hero.pos || ctx.mobs.some((m) => m.y * level.w + m.x === pos),
        spawn: (pos) => {
          // Bestiary.mob(depth) at depth 15 -> DM300 (Bestiary.java:133-136);
          // boss.state = boss.HUNTING; GameScene.add( boss ) (CavesBossLevel.java:199-201).
          const dm300 = buildMob('dm300', nextMobId(), pos, level.w);
          dm300.state = 'hunting';
          ctx.addMob(dm300);
          // boss.notice() -> DM300.notice() yell (DM300.java:147-150).
          dm300.notice(ctx);
        },
      });
    } else if (ctx.level.depth === 20) {
      // CityBossLevel.press (CityBossLevel.java:176-200): the hero's first
      // step outside the entrance room spawns the Dwarf King (HUNTING) and
      // re-locks the arena door. Register the pedestal cells for the King's
      // summoning AI (CityBossLevel.pedestal, CityBossLevel.java:137-143)
      // at entry time — the King only exists after this hook fires.
      setKingPedestals(pedestalCell(true), pedestalCell(false));
      pressCityArenaCell(ctx.level, ctx.rng, hero.pos, {
        occupied: (pos) => pos === hero.pos || ctx.mobs.some((m) => m.y * level.w + m.x === pos),
        spawn: (pos) => {
          // Bestiary.mob(depth) at depth 20 -> King (Bestiary.java:151-153);
          // CityBossLevel.press: boss.state = boss.HUNTING; GameScene.add;
          // notice() when visible (CityBossLevel.java:194-196, 208-212).
          spawnKingArena(ctx, pos);
        },
      });
    }
    // Vanilla Level.press continues after traps: HIGH_GRASS trample, then
    // WELL, ALCHEMY, then DOOR enter (Level.java:622-704). Wells and the
    // alchemy pot are later milestones; grass and doors are handled here.
    enterCell(ctx, hero, nx, ny);
  } else if (tile === Terrain.DOOR) {
    // Char.move: a flying char opens a closed door on entry even though
    // press() is skipped while flying (Char.java:488-490).
    doorEnter(ctx, nx, ny);
  }
  // Vanilla Hero.onMotionComplete -> search(false) (Hero.java:1241-1246).
  passiveSearch(ctx, hero);
  return 1; // TIME_TO_MOVE (Hero.java:36)
}

/**
 * The Level.press cell effects for hero movement after the trap stage:
 * high grass tramples, closed doors swing open (Door.enter,
 * Level.java:688-706).
 */
function enterCell(ctx: ActionContext, hero: ContentHero, x: number, y: number): void {
  const t = ctx.level.get(x, y);
  if (t === Terrain.HIGH_GRASS) trampleHighGrass(ctx, hero, x, y);
  else if (t === Terrain.DOOR) doorEnter(ctx, x, y);
  // Stage 3 (well wiring): Level.press WELL case (Level.java:690-700) —
  // the hero drinks from the magic well.
  else if (t === Terrain.WELL) drinkWell(ctx, hero, y * ctx.level.w + x);
}

/** Intentional search costs TIME_TO_SEARCH = 2 (Hero.java:134). */
export const TIME_TO_SEARCH = 2;

/**
 * Intentional search (Hero.search(true), Hero.java:1295-1388): every SECRET
 * tile (secret doors AND hidden traps -- Level.secret[p], Hero.java:1344;
 * Terrain.discover maps both, Terrain.java:143-166) in a visible cell
 * within the radius is ALWAYS revealed (the `intentional ||` branch fires
 * unconditionally). Hidden heaps are also opened (Hero.java:1361-1366) --
 * M1 has no hidden-heap model (vanilla creates them only for the Wandmaker
 * quest, Wandmaker.java:382), so that branch is a documented no-op.
 * Time: TIME_TO_SEARCH (2) when nothing found; when something is found,
 * 2 or 4 depending on Random.Float() < discovery level (Hero.java:1376).
 * M1 has no RingOfDetection, so the radius is exactly 1 (Hero.java:1308).
 */
export function searchIntentional(
  ctx: ActionContext,
  hero: ContentHero,
): number {
  const level = ctx.level;
  const distance = 1;
  const level_ = intentionalSearchLevel(hero.awareness); // Hero.java:1311
  let found = false;
  for (let dy = -distance; dy <= distance; dy++) {
    for (let dx = -distance; dx <= distance; dx++) {
      const nx = hero.x + dx;
      const ny = hero.y + dy;
      if (!level.inBounds(nx, ny)) continue;
      if (level.visible[level.idx(nx, ny)] === 0) continue; // Dungeon.visible[p]
      const t = level.get(nx, ny);
      if (t === Terrain.DOOR_SECRET || isHiddenTrap(t)) {
        if (t === Terrain.DOOR_SECRET) {
          level.revealSecretDoor(nx, ny);
        } else {
          level.revealTrap(nx, ny);
        }
        found = true;
      }
    }
  }
  if (found) {
    ctx.log('You noticed something'); // TXT_NOTICED_SMTH (Hero.java:126)
    // Hero.interrupt() (Hero.java:1386) is a no-op in the target: intents
    // are discrete single actions, so there is no continued action to cancel.
  }
  return searchTimeCost(ctx.rng, found, level_); // Hero.java:1373-1379
}

/**
 * Passive search after movement (Hero.onMotionComplete -> search(false),
 * Hero.java:1241-1246): each SECRET tile (secret door or hidden trap) in a
 * visible cell within radius 1 is discovered with probability
 * hero.awareness (Hero.java:1311, 1344).
 * NOTE: level.visible is the FOV from the previous action (the engine
 * recomputes it in afterAction, after this runs) — adjacent cells are
 * visible in all but pathological corner cases.
 */
export function passiveSearch(ctx: ActionContext, hero: ContentHero): void {
  const level = ctx.level;
  const chance = passiveSearchLevel(hero.awareness); // Hero.java:1311
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = hero.x + dx;
      const ny = hero.y + dy;
      if (!level.inBounds(nx, ny)) continue;
      if (level.visible[level.idx(nx, ny)] === 0) continue; // Dungeon.visible[p]
      const t = level.get(nx, ny);
      if (
        (t === Terrain.DOOR_SECRET || isHiddenTrap(t)) &&
        ctx.rng.float(0, 1) < chance
      ) {
        if (t === Terrain.DOOR_SECRET) {
          level.revealSecretDoor(nx, ny);
        } else {
          level.revealTrap(nx, ny);
        }
      }
    }
  }
}

/**
 * Apply one hunger/regen tick per HUNGER_STEP (10) time units, driven by the
 * hero's accumulated turn cost (Hunger/Regeneration buff actors in vanilla;
 * hungerTick is Hunger.act, Hunger.java:64-108; regen is Regeneration.act,
 * Regeneration.java:28-46).
 */
export function tickHeroClock(
  rng: MechanicsRng,
  ctx: ActionContext,
  hero: ContentHero,
  cost: number,
): void {
  hero.hungerClock += cost;
  while (hero.hungerClock >= HUNGER_STEP) {
    hero.hungerClock -= HUNGER_STEP;
    const t = hungerTick(rng, {
      level: hero.hungerLevel,
      hp: hero.hp,
      paralysed: hero.paralysed,
    });
    hero.hungerLevel = t.level;
    if (t.becameStarving) ctx.log(MSG_STARVING); // Hunger.java:84
    else if (t.becameHungry) ctx.log(MSG_HUNGRY); // Hunger.java:91
    if (t.damage > 0) {
      // While starving, every 30% damage proc also re-logs "You are
      // starving!" (Hunger.java:66-72) — not just the threshold crossing.
      ctx.log(MSG_STARVING); // Hunger.java:68
      hero.hp = Math.max(hero.hp - t.damage, 0);
      if (!hero.isAlive()) ctx.log(MSG_STARVED_TO_DEATH); // Hunger.java:156
    }
    if (hero.isAlive()) {
      hero.hp = regenTick(hero.hp, hero.ht, isStarving(hero.hungerLevel));
    }
  }
  // Stage 3 (Worker A): each carried wand's Charger recharges while the wand
  // is in the inventory (Wand.Charger, Wand.java:478-500). The port has no
  // Mage class yet, so mageClass=false (Wand recharge is TIME_TO_CHARGE 40
  // turns for non-mages; the battlemage 20-turn rate lands with the class).
  rechargeWands(hero, cost, false);
  // Equipped rings tick their RingBuff clocks once per hero turn
  // (RingBuff.act; the 200-tick identification counter, Ring.java).
  tickRingClocks(hero, cost);
}

/**
 * Missile flight path: cells along the line from `from` to `to`, stopping
 * before the first opaque cell (Ballistica, Ballistica.java). Returns the
 * cells in order, their distances, and the landing cell for a miss
 * (MissileWeapon.onThrow, MissileWeapon.java:85-88).
 *
 * (There is no dartTrace in src/mechanics/ yet, so it lives here for M1.)
 */
export function dartTrace(
  level: Level,
  from: number,
  to: number,
): { cells: number[]; distances: Map<number, number>; landCell: number } {
  const w = level.w;
  const x0 = from % w;
  const y0 = Math.floor(from / w);
  const x1 = to % w;
  const y1 = Math.floor(to / w);
  const cells: number[] = [];
  const distances = new Map<number, number>();
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  let dist = 0;
  for (;;) {
    if (dist > 0) {
      if (!level.inBounds(x, y) || level.isOpaque(x, y)) break;
      const pos = y * w + x;
      cells.push(pos);
      distances.set(pos, dist);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    dist++;
    if (dist > 64) break;
  }
  return {
    cells,
    distances,
    landCell: cells.length > 0 ? cells[cells.length - 1]! : from,
  };
}

/** Re-export for hooks. */
export { heroOf };
export { countItem };
