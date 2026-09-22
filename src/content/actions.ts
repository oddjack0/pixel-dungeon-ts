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
import { type Level } from '../dungeon/level.js';
import type { ActionContext } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import {
  gearDisplayName,
  heroAttackSkill,
  heroDamageRoll,
  intentionalSearchLevel,
  passiveSearchLevel,
  searchTimeCost,
  upgradeArmor,
  upgradeWeapon,
  vertigoRedirect,
} from '../mechanics/hero.js';
import { hasBuff } from '../mechanics/char.js';
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
} from '../mechanics/hunger.js';
import { getItem, parseItemId } from './items.js';
import {
  addToInventory,
  countItem,
  removeFromInventory,
  syncDarts,
  type ContentHero,
  type ItemStack,
} from './hero.js';
import { heroOf, strikeHeroVsMob, type ContentMob } from './mobs.js';

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
  }
}

/** Potion.apply (Potion.java:68-87) + per-potion effects (shatter/apply). */
function drinkPotion(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  const def = getItem(stack.itemId);
  removeFromInventory(hero, slot, 1);
  switch (stack.itemId) {
    case 'potion_healing':
      // PotionOfHealing: heal to full + detach Weakened/Poison/Crippled
      // (PotionOfHealing.java:38-48). M1: only poison can exist.
      hero.hp = hero.ht;
      delete hero.buffs.poison;
      ctx.log('Your wounds heal completely.'); // TXT_VALUE
      break;
    case 'potion_strength':
      // PotionOfStrength: STR++ (PotionOfStrength.java:38-47).
      hero.str += 1;
      ctx.log('Newfound strength surges through your body.'); // TXT_VALUE
      break;
    default:
      ctx.log(`You drink the ${def.name}. Nothing happens.`);
      break;
  }
  return 1; // TIME_TO_DRINK (Item.java:48)
}

/**
 * Read a scroll (Scroll.execute, Scroll.java:46-58; TIME_TO_READ = 1).
 * M1 note: scrolls are auto-identified — vanilla's rune-label system and
 * identify-on-read (Scroll.java:52-58) arrive with the M2 identification
 * system; until then every scroll reads directly.
 */
function readScroll(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  stack: ItemStack,
): number {
  switch (stack.itemId) {
    case 'scroll_upgrade': {
      // ScrollOfUpgrade.onItemSelected (ScrollOfUpgrade.java:38-48): uncurse
      // + upgrade. M1 has no curse model; WndBag.Mode.UPGRADEABLE item choice
      // is simplified to "equipped weapon, else equipped armor" (the
      // selection UI is M2). Consumes the scroll like any read scroll.
      const weapon = hero.weapon;
      const armor = hero.armor;
      if (!weapon && !armor) {
        ctx.log('You have nothing to upgrade.');
        return 1;
      }
      removeFromInventory(hero, slot, 1);
      if (weapon) {
        // Vanilla: a weapon's quality improves; ScrollOfUpgrade also fixes
        // broken gear (ScrollOfUpgrade.java:40-44) — M1 has no durability.
        upgradeWeapon(weapon);
        ctx.log(`your ${gearDisplayName(weapon)} certainly looks better now`);
      } else {
        upgradeArmor(armor!);
        ctx.log(`your ${gearDisplayName(armor!)} certainly looks better now`);
      }
      return 1; // TIME_TO_READ (Scroll.java:35)
    }
    default:
      // Other scrolls have no effects yet (later milestone).
      ctx.log('You cannot read that yet.'); // TXT_CANT_READ
      return 1;
  }
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

/** KindOfWeapon.doEquip (KindOfWeapon.java:32): 1 turn, swaps with old. */
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
  const oldId = hero.weaponId;
  hero.weapon = { ...def.weapon };
  hero.weaponId = def.id;
  removeFromInventory(hero, slot, 1);
  if (oldId) addToInventory(hero, oldId, 1);
  ctx.log(`You equip the ${def.name}.`);
  return 1; // TIME_TO_EQUIP
}

/** Armor.doEquip (Armor.java): 1 turn, swaps with old. */
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
  const oldId = hero.armorId;
  hero.armor = { ...def.armor };
  hero.armorId = def.id;
  removeFromInventory(hero, slot, 1);
  if (oldId) addToInventory(hero, oldId, 1);
  ctx.log(`You equip the ${def.name}.`);
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
    const def = getItem(hero.weaponId);
    addToInventory(hero, hero.weaponId, 1);
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
    const def = getItem(hero.armorId);
    addToInventory(hero, hero.armorId, 1);
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

/** Move (or unlock) toward a locked door, bump-attack a mob, or step. */
export function moveHero(
  ctx: ActionContext,
  hero: ContentHero,
  dx: number,
  dy: number,
): number {
  const level = ctx.level;
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
  if (tile === Terrain.DOOR_LOCKED) {
    const keySlot = hero.inventory.findIndex((s) => s.itemId === 'iron_key');
    if (keySlot === -1) {
      ctx.log('The door is locked.'); // Hero.actUnlock: no key (Hero.java:1010)
      return 1;
    }
    level.set(nx, ny, Terrain.DOOR);
    removeFromInventory(hero, keySlot, 1);
    ctx.log('You unlock the door.');
    hero.pos = ny * level.w + nx;
    // Vanilla Hero.onMotionComplete -> search(false) (Hero.java:1241-1246).
    passiveSearch(ctx, hero);
    return 1;
  }
  if (!level.isPassable(nx, ny)) return 1;
  hero.pos = ny * level.w + nx;
  // Vanilla Hero.onMotionComplete -> search(false) (Hero.java:1241-1246).
  passiveSearch(ctx, hero);
  return 1; // TIME_TO_MOVE (Hero.java:36)
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
