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
import type { ArmorDef, BuffState, WeaponDef } from '../mechanics/char.js';
import {
  heroAttackSkill,
  heroDamageRoll,
} from '../mechanics/hero.js';
import { isStarving, satisfy, STARVING } from '../mechanics/hunger.js';
import { tickBlobs } from '../mechanics/blobs.js';
import {
  makeBlobWorld,
  type TrapHero,
  type TrapMob,
} from '../mechanics/traps.js';
import {
  dropSlot,
  equipSlot,
  mineDarkGold,
  moveHero,
  noteSignCells,
  noteWallDecoCells,
  pickupAt,
  searchIntentional,
  throwDart,
  tickHeroClock,
  useInventorySlot,
  waitTurn,
} from './actions.js';
import { throwPotion, isPotionId, potionUiInfo } from './potions.js';
import { scrollUiInfo } from './scrolls.js';
import { throwHoneypot, HONEYPOT_ID } from './honeypot.js';
import { shatterHoneypotInHands } from './honeypot.js';
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
import './tengu-boss.js'; // registers the Tengu constructor for buildMob
import './dm300-boss.js'; // registers the DM-300 constructor for buildMob
import './npcs.js'; // registers the quest-NPC builder for buildMob
import { resetQuestState, type NpcMob } from './npcs.js';

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
    case 'dewdrop':
    case 'seed':
    case 'quest':
    case 'bag':
    case 'misc':
    case 'wand':
    case 'ring':
      return 'misc';
  }
}

function contentInventoryAdapter(game: Game): UiItem[] {
  const hero = game.hero as unknown as ContentHero;
  const items: UiItem[] = hero.inventory.map((s, slot) => {
    const def = getItem(s.itemId);
    // Stage 2 (Worker 4): potions/scrolls show their run-assigned
    // color/rune names and sprites once the ID system is initialized.
    const potionInfo = potionUiInfo(s.itemId, def.name, def.sprite);
    const scrollInfo = potionInfo ? null : scrollUiInfo(s.itemId, def.name, def.sprite);
    const info = potionInfo ?? scrollInfo;
    return {
      slot,
      id: s.itemId,
      name: info?.name ?? def.name,
      sprite: info?.sprite ?? def.sprite,
      qty: s.qty,
      kind: catalogKind(def),
      equipped: false,
      identified: info?.identified ?? true,
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
  /**
   * Live per-instance state of the equipped gear (level, enchantment/glyph,
   * durability, curse). Vanilla saves these as the item objects themselves
   * (Bundle); the port saves the instance beside the id.
   */
  weapon: WeaponDef | null;
  armor: ArmorDef | null;
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
  timeToJump: number; // Tengu.timeToJump (Tengu.java:50)
  enraged: boolean; // Brute.enraged (Brute.java:147)
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
    weapon: hero.weapon ? { ...hero.weapon } : null,
    armor: hero.armor ? { ...hero.armor } : null,
    inventory: hero.inventory.map((s) => ({
      ...s,
      gear: s.gear
        ? {
            weapon: s.gear.weapon ? { ...s.gear.weapon } : undefined,
            armor: s.gear.armor ? { ...s.gear.armor } : undefined,
          }
        : undefined,
    })),
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
  // Re-equip the saved live instances (vanilla saves the item objects).
  hero.inventory = save.inventory.map((s) => ({ ...s }));
  hero.weaponId = save.weaponId;
  hero.armorId = save.armorId;
  if (save.weaponId) {
    hero.weapon = save.weapon
      ? { ...save.weapon }
      : (() => {
          const wdef = getItem(save.weaponId).weapon;
          return wdef ? { ...wdef } : null;
        })();
  } else {
    hero.weapon = null;
  }
  if (save.armorId) {
    hero.armor = save.armor
      ? { ...save.armor }
      : (() => {
          const adef = getItem(save.armorId).armor;
          return adef ? { ...adef } : null;
        })();
  } else {
    hero.armor = null;
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
  const tengu = mob as unknown as { timeToJump?: number };
  const brute = mob as unknown as { enraged?: boolean };
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
    timeToJump: tengu.timeToJump ?? 5, // Tengu.timeToJump (Tengu.java:50)
    enraged: brute.enraged ?? false, // Brute.enraged (Brute.java:147)
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
  const tengu = mob as unknown as { timeToJump?: number };
  if ('timeToJump' in mob) tengu.timeToJump = save.timeToJump ?? 5;
  const brute = mob as unknown as { enraged?: boolean };
  if ('enraged' in mob) brute.enraged = save.enraged ?? false;
  mob.buffs = { ...save.buffs };
  mob.paralysed = save.paralysed;
  return mob;
}

export const contentMechanics: MechanicsHooks = {
  spawnHero(_rng: RNG, level: Level): HeroActor {
    // Quest state is run-level (vanilla Ghost.Quest/Wandmaker.Quest statics);
    // a fresh hero means a fresh run.
    resetQuestState();
    return createStarterHero(level.stairsUp, level.w);
  },

  spawnMobs(rng: RNG, level: Level): MobActor[] {
    // loadGame boots a Game with a restored level (no GenResult was
    // stashed); its mobs come from reviveMob right after, so [] is correct.
    const result = takeGenResult(level);
    if (!result) return [];
    // Stage 0 (exact copy): register the painter's sign markers so the
    // 'wait' intent can read signs (Sign.java).
    noteSignCells(level, result.markers.signs);
    // Stage 2 (Worker 5): register the painter's wall-deco markers so the
    // pickaxe's MINE action can find dark gold veins (Pickaxe.java).
    noteWallDecoCells(level, result.markers.wallDeco);
    const resolved = resolveMobSpawns(rng, result.level.depth, result.mobs, result.level);
    return buildMobs(resolved, result.level.w, result.level.depth);
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
        cost = waitTurn(ctx, hero);
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
        const targetCell = target.y * ctx.level.w + target.x;
        const thrownId = hero.inventory[intent.slot]?.itemId;
        // Stage 2 (Worker 4): potions and the honeypot throw at a cell
        // (Potion.doThrow / Honeypot.onThrow), not at a mob's HP.
        if (thrownId === HONEYPOT_ID) {
          cost = throwHoneypot(ctx, hero, intent.slot, targetCell);
          break;
        }
        if (thrownId !== undefined && isPotionId(thrownId)) {
          cost = throwPotion(ctx, hero, intent.slot, targetCell);
          break;
        }
        cost = throwDart(ctx, hero, intent.slot, targetCell);
        break;
      }
      case 'shatterItem': {
        // Stage 2 (Worker 4): Honeypot AC_SHATTER — shatter at own feet.
        cost = shatterHoneypotInHands(ctx, hero, intent.slot);
        break;
      }
      case 'mineItem': {
        // Stage 2 (Worker 5): Pickaxe AC_MINE — mine an adjacent dark
        // gold vein (Pickaxe.java:59-108).
        cost = mineDarkGold(ctx, hero, intent.slot);
        break;
      }
      case 'talk': {
        // Vanilla Hero.actInteract: talking to an adjacent NPC costs no
        // turn (Hero.java:498-516). onTalk is the shared NPC contract
        // (seams.ts MobActor.onTalk, implemented by NpcMob in npcs.ts).
        const npc = ctx.mobs.find(
          (m) => m.id === intent.targetId && m.isAlive(),
        ) as NpcMob | undefined;
        if (!npc || typeof npc.onTalk !== 'function') {
          ctx.log('Nobody there.');
          cost = 0;
          break;
        }
        if (mobChebyshev(hero.pos, npc.pos, ctx.level.w) > 1) {
          ctx.log('You are too far away to talk.');
          cost = 0;
          break;
        }
        npc.onTalk(ctx);
        cost = 0;
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

  evolveBlobs(ctx: ActionContext): void {
    // Vanilla Blob.act -> evolve() once per round (engine owns the call site).
    const hero = heroOf(ctx) as unknown as TrapHero;
    const mobs = ctx.mobs as unknown as TrapMob[];
    // Logging flows through makeBlobWorld's log (ctx.log).
    tickBlobs(ctx.rng, makeBlobWorld(ctx, hero, mobs), ctx.level.blobs);
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
