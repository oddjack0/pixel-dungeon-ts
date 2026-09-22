/**
 * Real MechanicsHooks for Milestone 1.
 *
 * Replaces the engine's stubMechanics (src/engine/stubs.ts). The engine owns
 * the scheduler, call sites, and persistence plumbing; everything here is
 * game logic (formulas, AI, interactions) grounded in
 * ~/workspace/pixel-dungeon-src — Java wins every conflict.
 */
import type { RNG } from '../core/rng.js';
import type { Level } from '../dungeon/level.js';
import type {
  ActionContext,
  HeroActor,
  HeroIntent,
  HeroSaveData,
  MechanicsHooks,
  MobActor,
  MobSaveData,
} from '../engine/seams.js';
import type { BuffKind } from '../mechanics/buffs.js';
import type { BuffState } from '../mechanics/char.js';
import {
  heroAttackSkill,
  heroDamageRoll,
} from '../mechanics/hero.js';
import { isStarving, satisfy, STARVING } from '../mechanics/hunger.js';
import {
  dropSlot,
  equipSlot,
  moveHero,
  pickupAt,
  searchIntentional,
  throwDart,
  tickHeroClock,
  useInventorySlot,
} from './actions.js';
import {
  createStarterHero,
  syncDarts,
  type ContentHero,
  type ItemStack,
} from './hero.js';
import {
  buildMob,
  chebyshevPos as mobChebyshev,
  heroOf,
  strikeHeroVsMob,
  tickBuffs,
  type ContentMob,
  type MobAiState,
} from './mobs.js';
import { buildMobs, resolveMobSpawns, takeGenResult } from './spawns.js';
import { getItem, type ItemDef } from './items.js';
import {
  setInventoryAdapter,
  type ItemKind,
  type UiItem,
} from '../ui/inventory.js';
import type { Game } from '../engine/loop.js';
import './goo-boss.js'; // registers the Goo constructor for buildMob

/**
 * Content inventory adapter (src/ui/inventory.ts seam): the panel shows the
 * hero's inventory stacks with catalog names/sprites, then the equipped
 * weapon (slot -1) and armor (slot -2). The 'equip'/'drop' intents reuse the
 * same slot convention (see equipSlot/dropSlot in actions.ts).
 */
function catalogKind(def: ItemDef): ItemKind {
  switch (def.type) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return 'armor';
    case 'missile':
      return 'missile';
    case 'potion':
      return 'potion';
    case 'food':
      return 'food';
    case 'scroll':
      return 'scroll';
    case 'key':
    case 'gold':
      return 'misc';
  }
}

function contentInventoryAdapter(game: Game): UiItem[] {
  const hero = game.hero as unknown as ContentHero;
  const items: UiItem[] = hero.inventory.map((s, slot) => {
    const def = getItem(s.itemId);
    return {
      slot,
      id: s.itemId,
      name: def.name,
      sprite: def.sprite,
      qty: s.qty,
      kind: catalogKind(def),
      equipped: false,
      identified: true,
    };
  });
  if (hero.weaponId) {
    const def = getItem(hero.weaponId);
    items.push({
      slot: -1,
      id: hero.weaponId,
      name: def.name,
      sprite: def.sprite,
      qty: 1,
      kind: 'weapon',
      equipped: true,
      identified: true,
    });
  }
  if (hero.armorId) {
    const def = getItem(hero.armorId);
    items.push({
      slot: -2,
      id: hero.armorId,
      name: def.name,
      sprite: def.sprite,
      qty: 1,
      kind: 'armor',
      equipped: true,
      identified: true,
    });
  }
  return items;
}

setInventoryAdapter(contentInventoryAdapter);

/** Save blob: opaque to the engine (HeroSaveData), schema owned here. */
export interface HeroSaveEx extends Record<string, unknown> {
  id: number;
  x: number;
  y: number;
  /** Level width (needed to rebuild pos = y*w + x; the seam passes no level). */
  w: number;
  hp: number;
  ht: number;
  time: number;
  lvl: number;
  exp: number;
  str: number;
  weaponId: string | null;
  armorId: string | null;
  inventory: ItemStack[];
  gold: number;
  hungerLevel: number;
  hungerClock: number;
  buffs: Partial<Record<BuffKind, BuffState>>;
  paralysed: boolean;
}

/** Save blob: opaque to the engine (MobSaveData), schema owned here. */
export interface MobSaveEx extends Record<string, unknown> {
  id: number;
  mobId: string;
  x: number;
  y: number;
  /** Level width (needed to rebuild pos = y*w + x; the seam passes no level). */
  w: number;
  hp: number;
  ht: number;
  time: number;
  hostile: boolean;
  state: MobAiState;
  enemySeen: boolean;
  target: number;
  generation: number;
  stolen: ItemStack | null;
  pumpedUp: boolean;
  jumped: boolean;
  buffs: Partial<Record<BuffKind, BuffState>>;
  paralysed: boolean;
}

function saveHeroEx(hero: ContentHero): HeroSaveEx {
  return {
    id: hero.id,
    x: hero.x,
    y: hero.y,
    w: hero.w,
    hp: hero.hp,
    ht: hero.ht,
    time: hero.time,
    lvl: hero.lvl,
    exp: hero.exp,
    str: hero.str,
    weaponId: hero.weaponId,
    armorId: hero.armorId,
    inventory: hero.inventory.map((s) => ({ ...s })),
    gold: hero.gold,
    hungerLevel: hero.hungerLevel,
    hungerClock: hero.hungerClock,
    buffs: { ...hero.buffs },
    paralysed: hero.paralysed,
  };
}

function reviveHeroEx(save: HeroSaveEx): ContentHero {
  const hero = createStarterHero(save.y * save.w + save.x, save.w);
  hero.hp = save.hp;
  hero.ht = save.ht;
  hero.time = save.time;
  hero.lvl = save.lvl;
  hero.exp = save.exp;
  hero.str = save.str;
  // Re-equip from the catalog (weapon/armor defs are data, not state).
  hero.inventory = save.inventory.map((s) => ({ ...s }));
  hero.weaponId = save.weaponId;
  hero.armorId = save.armorId;
  if (save.weaponId) {
    const wdef = getItem(save.weaponId).weapon;
    hero.weapon = wdef ? { ...wdef } : null;
  }
  if (save.armorId) {
    const adef = getItem(save.armorId).armor;
    hero.armor = adef ? { ...adef } : null;
  }
  syncDarts(hero);
  hero.gold = save.gold;
  hero.hungerLevel = save.hungerLevel;
  hero.hungerClock = save.hungerClock;
  hero.buffs = { ...save.buffs };
  hero.paralysed = save.paralysed;
  return hero;
}

function saveMobEx(mob: ContentMob): MobSaveEx {
  const goo = mob as unknown as { pumpedUp?: boolean; jumped?: boolean };
  return {
    id: mob.id,
    mobId: mob.def.id,
    x: mob.x,
    y: mob.y,
    w: mob.w,
    hp: mob.hp,
    ht: mob.ht,
    time: mob.time,
    hostile: mob.hostile,
    state: mob.state,
    enemySeen: mob.enemySeen,
    target: mob.target,
    generation: mob.generation,
    stolen: mob.stolen ? { ...mob.stolen } : null,
    pumpedUp: goo.pumpedUp ?? false,
    jumped: goo.jumped ?? false,
    buffs: { ...mob.buffs },
    paralysed: mob.paralysed,
  };
}

function reviveMobEx(save: MobSaveEx): ContentMob {
  const mob = buildMob(save.mobId, save.id, save.y * save.w + save.x, save.w);
  mob.hp = save.hp;
  mob.ht = save.ht;
  mob.time = save.time;
  mob.hostile = save.hostile;
  mob.state = save.state;
  mob.enemySeen = save.enemySeen;
  mob.target = save.target;
  mob.generation = save.generation;
  mob.stolen = save.stolen ? { ...save.stolen } : null;
  const goo = mob as unknown as { pumpedUp?: boolean; jumped?: boolean };
  if ('pumpedUp' in mob) {
    goo.pumpedUp = save.pumpedUp;
    goo.jumped = save.jumped;
  }
  mob.buffs = { ...save.buffs };
  mob.paralysed = save.paralysed;
  return mob;
}

export const contentMechanics: MechanicsHooks = {
  spawnHero(_rng: RNG, level: Level): HeroActor {
    return createStarterHero(level.stairsUp, level.w);
  },

  spawnMobs(rng: RNG, level: Level): MobActor[] {
    // loadGame boots a Game with a restored level (no GenResult was
    // stashed); its mobs come from reviveMob right after, so [] is correct.
    const result = takeGenResult(level);
    if (!result) return [];
    const resolved = resolveMobSpawns(rng, result.level.depth, result.mobs);
    return buildMobs(resolved, result.level.w);
  },

  handleHeroIntent(intent: HeroIntent, ctx: ActionContext): number {
    const hero = heroOf(ctx);

    if (!hero.isAlive()) return 1; // engine's checkHeroDeath ends the run

    // Paralysed hero can't act (Mob.act / Hero.act, Mob.java:149-153).
    if (hero.paralysed) {
      ctx.log('You are paralysed!');
      return 1;
    }

    let cost = 1;
    switch (intent.kind) {
      case 'move':
        cost = moveHero(ctx, hero, intent.dx, intent.dy);
        break;
      case 'search':
        cost = searchIntentional(ctx, hero);
        break;
      case 'wait':
        cost = 1;
        break;
      case 'pickup':
        cost = pickupAt(ctx, hero);
        break;
      case 'attack': {
        const target = ctx.mobs.find(
          (m) => m.id === intent.targetId && m.isAlive(),
        ) as ContentMob | undefined;
        if (!target || mobChebyshev(hero.pos, target.pos, ctx.level.w) > 1) {
          ctx.log('No target in range.');
          cost = 1;
          break;
        }
        strikeHeroVsMob(
          ctx,
          hero,
          target,
          heroAttackSkill(hero, { ranged: false, adjacent: false }),
          (r) => heroDamageRoll(r, hero, { ranged: false }),
        );
        cost = 1; // TIME_TO_ATTACK (Hero.java:38)
        break;
      }
      case 'useItem':
        cost = useInventorySlot(ctx, hero, intent.slot);
        break;
      case 'equip':
        cost = equipSlot(ctx, hero, intent.slot);
        break;
      case 'drop':
        cost = dropSlot(ctx, hero, intent.slot);
        break;
      case 'throwItem': {
        // The UI targets a mob (ui.ts throwMode queues targetId = mob id).
        const target = ctx.mobs.find(
          (m) => m.id === intent.targetId && m.isAlive(),
        );
        if (!target) {
          ctx.log('Your target is gone.');
          cost = 1;
          break;
        }
        cost = throwDart(
          ctx,
          hero,
          intent.slot,
          target.y * ctx.level.w + target.x,
        );
        break;
      }
      case 'descend':
      case 'ascend':
        // Handled by the engine; reaching here is a no-op guard.
        cost = 1;
        break;
    }

    return cost;
  },

  actMob(mob: MobActor, ctx: ActionContext): number {
    return (mob as ContentMob).takeTurn(ctx);
  },

  tickActorBuffs(actor: HeroActor | MobActor, ctx: ActionContext): void {
    // Mechanics owns the tick logic; the engine owns the call site (loop.ts).
    tickBuffs(ctx.rng, ctx.level, actor as ContentHero & ContentMob, ctx.log);
  },

  tickHeroClock(actor: HeroActor, ctx: ActionContext, cost: number): void {
    // Mechanics owns the tick logic; the engine owns the call site (loop.ts).
    tickHeroClock(ctx.rng, ctx, actor as unknown as ContentHero, cost);
  },

  applyTransitionHunger(actor: HeroActor): void {
    // Vanilla Hero.actDescend/actAscend: satisfy(-Hunger.STARVING/10),
    // skipped when already starving (Hero.java).
    const hero = actor as unknown as ContentHero;
    if (!isStarving(hero.hungerLevel)) {
      hero.hungerLevel = satisfy(hero.hungerLevel, -STARVING / 10);
    }
  },

  saveHero(hero: HeroActor): HeroSaveData {
    return saveHeroEx(hero as ContentHero);
  },

  reviveHero(_rng: RNG, data: HeroSaveData): HeroActor {
    return reviveHeroEx(data as unknown as HeroSaveEx);
  },

  saveMob(mob: MobActor): MobSaveData {
    return saveMobEx(mob as ContentMob);
  },

  reviveMob(_rng: RNG, data: MobSaveData): MobActor {
    return reviveMobEx(data as unknown as MobSaveEx);
  },
};
