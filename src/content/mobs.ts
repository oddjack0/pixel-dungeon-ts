/**
 * Sewer mob roster + AI for Milestone 1 (depths 1-4).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/ (Java wins every
 * conflict). AI states port Mob.java's Sleeping/Wandering/Hunting/Fleeing
 * (Mob.java:404-545); stats come from each mob's Java file (cited per def).
 *
 * Positions are CELL INDICES (pos = y*w + x) everywhere here; x/y are
 * derived for the engine seam (src/engine/seams.ts MobActor).
 *
 * Turn-cost mapping (engine's Scheduler.spend does time = now + cost/speed,
 * src/core/turn.ts; vanilla Actor.spend adds directly):
 *   move      -> cost 1            (vanilla spend(1/speed()), Mob.java:449)
 *   wait/idle -> cost speed        (vanilla spend(TICK), real 1.0)
 *   attack    -> cost attackDelay*speed (vanilla spend(attackDelay()))
 */
import { Actor } from '../core/turn.js';
import { computeFov } from '../core/fov.js';
import { findPath } from '../core/path.js';
import { Terrain } from '../core/grid.js';
import { type Level } from '../dungeon/level.js';
import { onItemDropped } from '../dungeon/prisonBoss.js';
import type { ActionContext, MobActor } from '../engine/seams.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import {
  applyDamage,
  hitRoll,
  skeletonDeathBurst,
} from '../mechanics/combat.js';
import {
  buffDeathMessage,
  burningInventoryTick,
  burningTick,
  burnsUpMessage,
  bleedingTick,
  oozeTick,
  poisonTick,
  type BuffKind,
} from '../mechanics/buffs.js';
import { earnExp, expForKill, MOB_EXP } from '../mechanics/exp.js';
import { heroDefenseSkill, heroDR } from '../mechanics/hero.js';
import type { BuffState } from '../mechanics/char.js';
import { charTimeScale, crippleFactor } from '../mechanics/char.js';
import { seedBlob } from '../mechanics/blobs.js';
import type { ContentHero, ItemStack } from './hero.js';
import { addToInventory, removeFromInventory } from './hero.js';
import { getItem, ITEMS } from './items.js';
import { itemGenerator, skeletonWeaponDrop } from './itemgen.js';

/** Mob AI states (Mob.SLEEPEING/WANDERING/HUNTING/FLEEING/PASSIVE, Mob.java:70-76). */
export type MobAiState = 'sleeping' | 'wandering' | 'hunting' | 'fleeing' | 'passive';

/** Data-driven mob stats. Every value cites its Java source in MOB_DEFS. */
export interface MobDef {
  id: string;
  name: string;
  sprite: string;
  hp: number;
  /** attackSkill() */
  atk: number;
  /** defenseSkill field */
  def: number;
  dmgMin: number;
  dmgMax: number;
  /** All M1 mobs roll Random.NormalIntRange (triangular). */
  triangular: boolean;
  dr: number;
  exp: number;
  maxLvl: number;
  /** baseSpeed (Char.speed); crab = 2. */
  speed: number;
  flying: boolean;
  /** Special-ability hook id. */
  ability: 'swarm' | 'skeleton' | 'thief' | 'fetidrat' | null;
  /** attackDelay() in turns (Thief 0.5, Thief.java:88-91). */
  attackDelay: number;
  immunities: string[];
  resistances: string[];
}

export const MOB_DEFS: Readonly<Record<string, MobDef>> = {
  /** Rat.java:31-48 — HP/HT 8, def 3, atk 8, NormalIntRange(1,5), dr 1,
   *  maxLvl 5, EXP default 1 (Mob.java:68). */
  rat: {
    id: 'rat', name: 'marsupial rat', sprite: 'mob_rat',
    hp: 8, atk: 8, def: 3, dmgMin: 1, dmgMax: 5, triangular: true, dr: 1,
    exp: MOB_EXP.rat.exp, maxLvl: MOB_EXP.rat.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: [],
  },
  /** Gnoll.java:32-53 — HP/HT 12, def 4, atk 11, NormalIntRange(2,5), dr 2,
   *  EXP 2, maxLvl 8, loot Gold 0.5. */
  gnoll: {
    id: 'gnoll', name: 'gnoll scout', sprite: 'mob_gnoll',
    hp: 12, atk: 11, def: 4, dmgMin: 2, dmgMax: 5, triangular: true, dr: 2,
    exp: MOB_EXP.gnoll.exp, maxLvl: MOB_EXP.gnoll.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: [],
  },
  /** Crab.java:32-54 — HP/HT 15, def 5, baseSpeed 2, atk 12,
   *  NormalIntRange(3,6), dr 4, EXP 3, maxLvl 9, loot MysteryMeat 0.167
   *  (M1: mystery meat has no mechanics yet — no loot, documented). */
  crab: {
    id: 'crab', name: 'sewer crab', sprite: 'mob_crab',
    hp: 15, atk: 12, def: 5, dmgMin: 3, dmgMax: 6, triangular: true, dr: 4,
    exp: MOB_EXP.crab.exp, maxLvl: MOB_EXP.crab.maxLvl, // single-sourced
    speed: 2, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: [],
  },
  /** Swarm.java:44-72 — HP/HT 80, def 5, atk 12, NormalIntRange(1,4),
   *  maxLvl 10, EXP default 1, flying. Splits in defenseProc
   *  (Swarm.java:76-107); loot PotionOfHealing 1/(5*(generation+1))
   *  (Swarm.java:123-128). */
  swarm: {
    id: 'swarm', name: 'swarm of flies', sprite: 'mob_swarm',
    hp: 80, atk: 12, def: 5, dmgMin: 1, dmgMax: 4, triangular: true, dr: 0,
    exp: MOB_EXP.swarm.exp, maxLvl: MOB_EXP.swarm.maxLvl, // single-sourced
    speed: 1, flying: true, ability: 'swarm', attackDelay: 1,
    immunities: [], resistances: [],
  },
  /** Skeleton.java:44-53 — HP/HT 25, def 9, atk 12, NormalIntRange(3,8),
   *  dr 5, EXP 5, maxLvl 10, death burst (Skeleton.java:54-76),
   *  immune to Death (Skeleton.java:107-115; M1: no death effects exist). */
  skeleton: {
    id: 'skeleton', name: 'skeleton', sprite: 'mob_skeleton',
    hp: 25, atk: 12, def: 9, dmgMin: 3, dmgMax: 8, triangular: true, dr: 5,
    exp: MOB_EXP.skeleton.exp, maxLvl: MOB_EXP.skeleton.maxLvl, // single-sourced
    speed: 1, flying: false, ability: 'skeleton', attackDelay: 1,
    immunities: ['death'], resistances: [],
  },
  /** Thief.java:45-97 — HP/HT 20, def 12, atk 12, NormalIntRange(1,7),
   *  dr 3, EXP 5, maxLvl 10, attackDelay 0.5; steals on attackProc
   *  (Thief.java:103-111), flees, drops 1 gold per hit while fleeing
   *  (Thief.java:114-121), drops the stolen item on death
   *  (Thief.java:94-100). RingOfHaggler loot 0.01 (M1: no rings — none). */
  thief: {
    id: 'thief', name: 'crazy thief', sprite: 'mob_thief',
    hp: 20, atk: 12, def: 12, dmgMin: 1, dmgMax: 7, triangular: true, dr: 3,
    exp: MOB_EXP.thief.exp, maxLvl: MOB_EXP.thief.maxLvl, // single-sourced
    speed: 1, flying: false, ability: 'thief', attackDelay: 0.5,
    immunities: [], resistances: [],
  },
  // --- Stage 1: Prison depths (Bestiary.java:90-105) ---
  /** Shaman.java:44-71 — "gnoll shaman": HP/HT 18, def 8, atk 11,
   *  melee NormalIntRange(2,6), dr 4, EXP 6, maxLvl 14, resists Electricity
   *  ('lightning'); loot: Generator.Category.SCROLL @ 0.33 (Shaman.java:54). */
  shaman: {
    id: 'shaman', name: 'gnoll shaman', sprite: 'mob_shaman',
    hp: 18, atk: 11, def: 8, dmgMin: 2, dmgMax: 6, triangular: true, dr: 4,
    exp: MOB_EXP.shaman.exp, maxLvl: MOB_EXP.shaman.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: ['lightning'],
  },
  /** Bat.java:31-61 — "vampire bat": HP/HT 30, def 15, atk 16,
   *  NormalIntRange(6,12), dr 4, baseSpeed 2, flying, EXP 7, maxLvl 15,
   *  heals min(damage, HT-HP) per landed hit (Bat.java:69-79),
   *  loot PotionOfHealing @ 0.125 (Bat.java:44), resists Leech. */
  bat: {
    id: 'bat', name: 'vampire bat', sprite: 'mob_bat',
    hp: 30, atk: 16, def: 15, dmgMin: 6, dmgMax: 12, triangular: true, dr: 4,
    exp: MOB_EXP.bat.exp, maxLvl: MOB_EXP.bat.maxLvl, // single-sourced
    speed: 2, flying: true, ability: null, attackDelay: 1,
    immunities: [], resistances: ['leech'],
  },
  /** Brute.java:133-170 — "gnoll brute": HP/HT 40, def 15, atk 20,
   *  NormalIntRange(8,18) / enraged NormalIntRange(10,40), dr 8, EXP 8,
   *  maxLvl 15, immune to Terror ('terror'), loot Gold @ 0.5 (Brute.java:145). */
  brute: {
    id: 'brute', name: 'gnoll brute', sprite: 'mob_brute',
    hp: 40, atk: 20, def: 15, dmgMin: 8, dmgMax: 18, triangular: true, dr: 8,
    exp: MOB_EXP.brute.exp, maxLvl: MOB_EXP.brute.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: ['terror'], resistances: [],
  },
  /** Albino.java:27-50 — "albino rat" (Rat variant): HP/HT 15, Rat stats
   *  otherwise (EXP 1, maxLvl 5); no dedicated loot table. */
  albino: {
    id: 'albino', name: 'albino rat', sprite: 'mob_albino',
    hp: 15, atk: 8, def: 3, dmgMin: 1, dmgMax: 5, triangular: true, dr: 1,
    exp: MOB_EXP.albino.exp, maxLvl: MOB_EXP.albino.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: [],
  },
  /** Bandit.java:29-55 — "crazy bandit" (Thief variant): Thief stats
   *  (EXP 5, maxLvl 10); steal prolongs Blindness (Bandit.steal). */
  bandit: {
    id: 'bandit', name: 'crazy bandit', sprite: 'mob_bandit',
    hp: 20, atk: 12, def: 12, dmgMin: 1, dmgMax: 7, triangular: true, dr: 3,
    exp: MOB_EXP.bandit.exp, maxLvl: MOB_EXP.bandit.maxLvl, // single-sourced
    speed: 1, flying: false, ability: 'thief', attackDelay: 0.5,
    immunities: [], resistances: [],
  },
  /** Shielded.java:25-46 — "shielded brute" (Brute variant): def 20, dr 10,
   *  defenseVerb "blocked"; Brute stats otherwise (EXP 8, maxLvl 15). */
  shielded: {
    id: 'shielded', name: 'shielded brute', sprite: 'mob_shielded',
    hp: 40, atk: 20, def: 20, dmgMin: 8, dmgMax: 18, triangular: true, dr: 10,
    exp: MOB_EXP.shielded.exp, maxLvl: MOB_EXP.shielded.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: ['terror'], resistances: [],
  },
};

let mobIdCounter = 1;
export function nextMobId(): number {
  return mobIdCounter++;
}

/** Chebyshev distance between two cell indices (Level.distance, Level.java:874-880). */
export function chebyshevPos(a: number, b: number, w: number): number {
  return Math.max(
    Math.abs((a % w) - (b % w)),
    Math.abs(Math.floor(a / w) - Math.floor(b / w)),
  );
}

/** Anything with buffs that tickBuffs can operate on (hero + mobs). */
export interface Buffable {
  pos: number;
  hp: number;
  ht: number;
  flying: boolean;
  paralysed: boolean;
  immunities: string[];
  resistances: string[];
  buffs: Partial<Record<BuffKind, BuffState>>;
  /** 'hero' on the hero (ContentHero.kind); drives hero-only buff branches. */
  kind?: string;
  isAlive(): boolean;
}

function buffTarget(ch: Buffable): {
  hp: number; ht: number; paralysed: boolean; immunities: string[]; resistances: string[];
} {
  return {
    hp: ch.hp, ht: ch.ht, paralysed: ch.paralysed,
    immunities: ch.immunities, resistances: ch.resistances,
  };
}

/**
 * Tick one char's buffs (mechanics logic; the engine owns the call site —
 * this runs at the start of the owner's turn). Ports Burning.act
 * (Burning.java:64-107), Poison.act (Poison.java:64-78), Ooze.act
 * (Ooze.java:39-50), the Paralysis countdown (Paralysis.java:26), and the
 * Cripple countdown (Cripple.java, DURATION = 10).
 *
 * M1 simplification (flagged in ENGINE-REPORT): vanilla ticks each buff as
 * its own scheduler actor every 1.0 time units; here buffs tick once per
 * owner turn. Exact for the speed-1 hero; mobs have no M1 buff appliers
 * except the swarm-split poison copy.
 */
export function tickBuffs(
  rng: MechanicsRng,
  level: Level,
  ch: Buffable,
  log: (msg: string) => void,
): void {
  const inWater = level.getAt(ch.pos) === Terrain.WATER;
  const b = ch.buffs;
  // The hero drives hero-only branches (inventory loss, "You ..." death
  // lines); ContentHero carries kind='hero' + inventory, mobs carry neither.
  const hero = ch.kind === 'hero' ? (ch as unknown as ContentHero) : null;
  /** Log the vanilla death line when a buff just killed the hero. */
  const logBuffDeath = (kind: BuffKind): void => {
    if (hero && !hero.isAlive()) {
      const msg = buffDeathMessage(kind);
      if (msg) log(msg);
    }
  };
  if (b.burning && ch.isAlive()) {
    const t = burningTick(rng, ch.hp, ch.ht, b.burning.left, inWater, ch.flying);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, 'burning');
    ch.hp = applied.hp;
    if (hero) {
      // Burning.act hero branch (Burning.java:76-98): each tick one random
      // backpack item burns up; scrolls are destroyed, mystery meat cooks
      // into chargrilled meat (kept). Happens even on the killing tick —
      // vanilla does the damage first, then the item loss, then onDeath.
      const burn = burningInventoryTick(
        rng,
        hero.inventory,
        (id) => getItem(id).type === 'scroll',
        (id) => id === 'mystery_meat',
      );
      if (burn) {
        const stack = hero.inventory[burn.stackIndex];
        if (stack) {
          const name = getItem(stack.itemId).name;
          removeFromInventory(hero, burn.stackIndex, 1);
          // Vanilla: steak.collect(backpack), else drop at the hero's feet
          // (Burning.java:88-90). M1's pack has no capacity limit, so the
          // drop branch is unreachable; the catalog also has no meat yet.
          if (burn.cookedId !== null && burn.cookedId in ITEMS) {
            addToInventory(hero, burn.cookedId, 1);
          }
          log(burnsUpMessage(name)); // GLog.w, Burning.java:83/94
        }
      }
    }
    logBuffDeath('burning'); // "You burned to death...", Burning.java:152
    if (t.detached) delete b.burning;
    else b.burning.left = t.left;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  if (b.poison && ch.isAlive()) {
    const t = poisonTick(b.poison.left);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, 'poison');
    ch.hp = applied.hp;
    logBuffDeath('poison'); // "You died from poison...", Poison.java:94
    if (t.detached) delete b.poison;
    else b.poison.left = t.left;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  if (b.ooze && ch.isAlive()) {
    const t = oozeTick(inWater);
    const applied = applyDamage(rng, buffTarget(ch), t.damage, 'ooze');
    ch.hp = applied.hp;
    logBuffDeath('ooze'); // "Caustic ooze killed you...", Ooze.java:50
    if (t.detached) delete b.ooze;
    if (applied.paralysisBroken) {
      ch.paralysed = false;
      delete b.paralysis;
    }
  }
  // STAGE0-TRAP (worker 2/5): Bleeding.act (Bleeding.java:58-81) —
  // GrippingTrap applier. Level re-rolled every tick; detach at 0.
  if (b.bleeding && ch.isAlive()) {
    const t = bleedingTick(rng, b.bleeding.level ?? 0);
    if (t.detached) {
      delete b.bleeding;
    } else {
      b.bleeding.level = t.level;
      const applied = applyDamage(rng, buffTarget(ch), t.level, 'bleeding');
      ch.hp = applied.hp;
      logBuffDeath('bleeding'); // "You bled to death...", Bleeding.java:70
      if (applied.paralysisBroken) {
        ch.paralysed = false;
        delete b.paralysis;
      }
    }
  } else if (b.bleeding) {
    delete b.bleeding;
  }
  if (b.paralysis) {
    b.paralysis.left -= 1;
    if (b.paralysis.left <= 0) {
      delete b.paralysis;
      ch.paralysed = false;
    }
  }
  // Cripple (Cripple.java): FlavourBuff countdown, DURATION = 10
  // (Cripple.java:24). Halves speed while attached via crippleFactor
  // (Char.speed, Char.java:247-249). Stage 0 applier: Chasm.heroLand.
  if (b.cripple) {
    b.cripple.left -= 1;
    if (b.cripple.left <= 0) delete b.cripple;
  }
  // Blindness (Blindness.java): FlavourBuff countdown; a blinded char
  // sees nothing (Level.updateFieldOfView, Level.java:793). Stage 1
  // applier: the crazy bandit's steal (Bandit.steal, Bandit.java:39-49).
  if (b.blindness) {
    b.blindness.left -= 1;
    if (b.blindness.left <= 0) delete b.blindness;
  }
}

/** The live hero, cast from the engine seam. */
export function heroOf(ctx: ActionContext): ContentHero {
  return ctx.hero as ContentHero;
}

/** Live mob (not the engine's structural copy) at a cell, excluding `self`. */
export function mobAtCell(
  ctx: ActionContext,
  x: number,
  y: number,
  self?: ContentMob,
): ContentMob | undefined {
  return ctx.mobs.find(
    (m) => m !== self && m.x === x && m.y === y && m.isAlive(),
  ) as ContentMob | undefined;
}

/** Any char (hero or live mob) at a cell index. */
export function charAtPos(
  ctx: ActionContext,
  pos: number,
  self?: ContentMob,
): ContentHero | ContentMob | undefined {
  const hero = heroOf(ctx);
  if (hero.isAlive() && hero.pos === pos) return hero;
  const w = ctx.level.w;
  const m = mobAtCell(ctx, pos % w, Math.floor(pos / w), self);
  return m;
}

function tileWalkableFor(level: Level, x: number, y: number): boolean {
  return level.isPassable(x, y);
}

/**
 * One step toward (tx, ty), mirroring Dungeon.findPath (Dungeon.java:618-641):
 * adjacent target steps straight in when free; otherwise A* with other chars
 * as blockers (M1: chars block regardless of the mob's FOV — the FOV-gated
 * blocking is a vanilla subtlety with no M1-visible effect).
 * M1 simplification: flying ignores nothing extra (no M1 tile distinguishes
 * Level.avoid from passable for pathing; water is passable for all).
 */
function stepToward(
  ctx: ActionContext,
  mob: ContentMob,
  tx: number,
  ty: number,
): number {
  const level = ctx.level;
  const w = level.w;
  const sx = mob.x;
  const sy = mob.y;
  if (Math.max(Math.abs(tx - sx), Math.abs(ty - sy)) <= 1) {
    if (!charAtPos(ctx, ty * w + tx, mob) && tileWalkableFor(level, tx, ty)) {
      return ty * w + tx;
    }
    return -1;
  }
  const path = findPath(
    level,
    (x, y) => {
      if (x === tx && y === ty) return tileWalkableFor(level, x, y);
      return tileWalkableFor(level, x, y) && !charAtPos(ctx, y * w + x, mob);
    },
    sx,
    sy,
    tx,
    ty,
  );
  if (!path || path.length === 0) return -1;
  const s = path[0]!;
  if (charAtPos(ctx, s.y * w + s.x, mob)) return -1;
  return s.y * w + s.x;
}

/**
 * One step away from (fx, fy). Vanilla uses PathFinder.getStepBack
 * (BFS distance map); M1 uses max Chebyshev distance among walkable free
 * neighbors — documented simplification, same observable behavior in rooms.
 */
function stepAway(ctx: ActionContext, mob: ContentMob, fx: number, fy: number): number {
  const level = ctx.level;
  const w = level.w;
  let best = -1;
  let bestD = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = mob.x + dx;
      const ny = mob.y + dy;
      if (!tileWalkableFor(level, nx, ny)) continue;
      if (charAtPos(ctx, ny * w + nx, mob)) continue;
      const d = Math.max(Math.abs(nx - fx), Math.abs(ny - fy));
      if (d > bestD) {
        bestD = d;
        best = ny * w + nx;
      }
    }
  }
  return best;
}

/** Random passable cell (Level.randomDestination, Level.java:585-590). */
export function randomDestination(rng: MechanicsRng, level: Level): number {
  for (let i = 0; i < 50; i++) {
    const pos = rng.int(0, level.w * level.h);
    if (level.isPassable(pos % level.w, Math.floor(pos / level.w))) return pos;
  }
  return -1;
}

/** Drop an item on the floor (Dungeon.level.drop). */
export function dropItemAt(ctx: ActionContext, pos: number, itemId: string): void {
  ctx.level.items.push({ pos, itemId, sprite: getItem(itemId).sprite });
  // PrisonBossLevel.drop (PrisonBossLevel.java:331-343): the first SkeletonKey
  // dropped on the prison boss level turns the arena door into an ordinary door.
  onItemDropped(ctx.level, itemId);
}

/**
 * Char.attack sequence (Char.java:128-186) WITHOUT the final damage
 * application, so defenseProc side effects that mutate the defender (swarm
 * split) land before damage is computed. Callers apply `damageDealt` via
 * applyDamage themselves.
 */
export interface AttackSides {
  accuracy: number;
  evasion: number;
  defenderDr: number;
  damageRoll: (rng: MechanicsRng) => number;
  onAttackProc?: (rng: MechanicsRng, damage: number) => number;
  onDefenseProc?: (rng: MechanicsRng, damage: number) => number;
}

export function runAttackSequence(rng: MechanicsRng, sides: AttackSides): {
  hit: boolean;
  damageDealt: number;
} {
  if (!hitRoll(rng, sides.accuracy, sides.evasion)) {
    return { hit: false, damageDealt: 0 };
  }
  const dr = rng.intRange(0, sides.defenderDr); // Char.java:143-144
  const dmg = sides.damageRoll(rng);
  let effective = Math.max(dmg - dr, 0); // Char.java:147
  effective = sides.onAttackProc ? sides.onAttackProc(rng, effective) : effective; // :149
  effective = sides.onDefenseProc ? sides.onDefenseProc(rng, effective) : effective; // :150
  return { hit: true, damageDealt: effective };
}

export class ContentMob extends Actor implements MobActor {
  id: number;
  def: MobDef;
  /** Cell index — the canonical position (SPEC binding). */
  pos: number;
  /** Level width, for pos <-> x/y conversion. */
  w: number;
  hp: number;
  ht: number;
  name: string;
  sprite: string;
  hostile = true;

  state: MobAiState = 'sleeping'; // Mob.java:76
  enemySeen = false;
  target = -1;
  justAlerted = false;

  paralysed = false;
  rooted = false;
  flying: boolean;
  buffs: Partial<Record<BuffKind, BuffState>> = {};
  immunities: string[];
  resistances: string[];

  /** Swarm.split generation (Swarm.java:44). */
  generation = 0;
  /** Thief.stolen item (Thief.java:28). */
  stolen: ItemStack | null = null;
  /**
   * Vanilla NPC.damage()/NPC.add(Buff) no-ops (NPC.java:33-53): the sad ghost
   * and wandmaker cannot be damaged or buffed. Set by NPC subclasses;
   * honored by strikeHeroVsMob, damageMobDirect, damageFromTrap and the
   * trap buff-attach sites.
   */
  invulnerable = false;

  constructor(id: number, def: MobDef, pos: number, w: number) {
    super();
    this.id = id;
    this.def = def;
    this.pos = pos;
    this.w = w;
    this.hp = def.hp;
    this.ht = def.hp;
    this.name = def.name;
    this.sprite = def.sprite;
    this.flying = def.flying;
    this.immunities = [...def.immunities];
    this.resistances = [...def.resistances];
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

  /** Char.speed (Char.java:247-249): base speed halved by Cripple. */
  getSpeed(): number {
    return this.def.speed * crippleFactor(this);
  }

  /** Char.spend time scale (Char.java:303-314): Slow x0.5, Speed x2.0. */
  getTimeScale(): number {
    return charTimeScale(this);
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  /** attackDelay() (Mob.java:252-254); thief 0.5 (Thief.java:88-91). */
  attackDelay(): number {
    return this.def.attackDelay;
  }

  /** defenseSkill(enemy): enemySeen && !paralysed ? def : 0 (Mob.java:262-264). */
  mobDefenseSkill(): number {
    return this.enemySeen && !this.paralysed ? this.def.def : 0;
  }

  /**
   * Defense verb shown when the hero's attack misses
   * (Char.TXT_YOU_MISSED "%s %s your attack", Char.java:69, 196-203).
   * Default "dodged" (Char.java:227-229).
   */
  defenseVerb(): string {
    return 'dodged';
  }

  mobDamageRoll(rng: MechanicsRng): number {
    return rng.normalIntRange(this.def.dmgMin, this.def.dmgMax);
  }

  /**
   * The engine routes mob turns through MechanicsHooks.actMob, not this.
   * (Kept to satisfy the MobActor structural type.)
   */
  act(): number {
    throw new Error('ContentMob.act: route through MechanicsHooks.actMob -> takeTurn(ctx)');
  }

  /** Cost helpers: engine spend() computes real time = cost / speed. */
  protected moveCost(): number {
    return 1; // vanilla spend(1/speed()) -> real 1/speed
  }
  protected waitCost(): number {
    return this.getSpeed(); // vanilla spend(TICK) -> real 1.0
  }
  protected attackCost(): number {
    return this.attackDelay() * this.getSpeed(); // vanilla spend(attackDelay())
  }

  /** Mob.act() (Mob.java:143-165) + AI states (Mob.java:404-545). */
  takeTurn(ctx: ActionContext): number {
    const rng = ctx.rng;
    if (!this.isAlive()) {
      killMob(ctx, this, {});
      return this.waitCost();
    }

    const justAlerted = this.justAlerted;
    this.justAlerted = false;

    if (this.paralysed) {
      // Mob.act: paralysed -> spend(TICK) (Mob.java:149-153)
      this.enemySeen = false;
      return this.waitCost();
    }

    // Vanilla Mob.chooseEnemy() (Mob.java:167-176): the sad ghost overrides
    // it to null (Ghost.java:77-85) and never acquires an enemy.
    const enemy = this.selectEnemy(ctx);
    const enemyInFOV =
      enemy != null && enemy.isAlive() && this.canSee(ctx, enemy.pos); // Level.fieldOfView (Mob.java:157-159)
    const enemyPos = enemy != null ? enemy.pos : -1;

    switch (this.state) {
      case 'sleeping':
        return this.actSleeping(ctx, enemyPos, enemyInFOV);
      case 'wandering':
        return this.actWandering(ctx, enemyPos, enemyInFOV, justAlerted);
      case 'hunting':
        return this.actHunting(ctx, enemy, enemyInFOV);
      case 'fleeing':
        return this.actFleeing(ctx, enemyPos, enemyInFOV);
      case 'passive':
      default:
        this.enemySeen = false;
        return this.waitCost();
    }
  }

  /**
   * Vanilla Mob.chooseEnemy() (Mob.java:167-176): default returns the hero.
   * The sad ghost overrides this to null (Ghost.java:77-85).
   */
  protected selectEnemy(ctx: ActionContext): ContentHero | null {
    return heroOf(ctx);
  }

  /** Hook: shown when the mob notices the hero (Goo yells). */
  protected onNotice(_ctx: ActionContext): void {
    // base mobs: sprite alert only (no text in vanilla)
  }

  /** Hook after any successful move (Goo seals the arena). */
  protected afterMove(ctx: ActionContext, oldPos: number): void {
    // Doors for mobs (Char.move, Char.java:484-492; Mob.move -> mobPress,
    // Mob.java:258-264; Level.mobPress): leaving an open door closes it
    // unless a heap lies on it (Door.leave, Door.java:23-29); stepping onto
    // a closed door opens it (Door.enter, Door.java:14-21). Port heaps =
    // placed items. (Mob trap triggering via mobPress is the trap worker's
    // call site — see enterCell in actions.ts. Kept inline here rather than
    // importing actions.ts to avoid a content import cycle.)
    const level = ctx.level;
    const ox = oldPos % level.w;
    const oy = Math.floor(oldPos / level.w);
    if (level.get(ox, oy) === Terrain.OPEN_DOOR) {
      if (!level.items.some((it) => it.pos === oldPos)) {
        level.set(ox, oy, Terrain.DOOR);
      }
    }
    if (level.get(this.x, this.y) === Terrain.DOOR) {
      level.set(this.x, this.y, Terrain.OPEN_DOOR);
    }
  }

  /** Hook on death, after EXP/loot (Goo unseals + drops the skeleton key). */
  onDeath(_ctx: ActionContext): void {
    // base mobs: nothing
  }

  /** canAttack(enemy) (Mob.java:226-228); Goo overrides. */
  canAttack(_ctx: ActionContext, targetPos: number): boolean {
    return chebyshevPos(this.pos, targetPos, this.w) <= 1;
  }

  /** FOV from the mob's position, radius = viewDistance 8 (Char.java:90). */
  canSee(ctx: ActionContext, pos: number): boolean {
    const level = ctx.level;
    const out = new Uint8Array(level.w * level.h);
    computeFov(
      level,
      (x, y) => level.isOpaque(x, y),
      this.x,
      this.y,
      8,
      out,
    );
    return out[pos] === 1;
  }

  private actSleeping(
    ctx: ActionContext,
    heroPos: number,
    enemyInFOV: boolean,
  ): number {
    const rng = ctx.rng;
    // Sleeping.act (Mob.java:408-438): wake when
    // Random.Int(distance + stealth + flying?2:0) == 0. M1: hero stealth 0
    // (Hero.stealth, Hero.java:1132-1138), hero not flying.
    if (enemyInFOV) {
      const dist = chebyshevPos(this.pos, heroPos, this.w);
      const hero = heroOf(ctx);
      if (rng.int(0, dist + (hero.flying ? 2 : 0)) === 0) {
        this.enemySeen = true;
        this.onNotice(ctx);
        this.state = 'hunting';
        this.target = heroPos;
        return this.waitCost(); // spend(TIME_TO_WAKE_UP = 1)
      }
    }
    this.enemySeen = false;
    return this.waitCost(); // spend(TICK)
  }

  private actWandering(
    ctx: ActionContext,
    heroPos: number,
    enemyInFOV: boolean,
    justAlerted: boolean,
  ): number {
    const rng = ctx.rng;
    // Wandering.act (Mob.java:442-475)
    if (enemyInFOV) {
      const dist = chebyshevPos(this.pos, heroPos, this.w);
      if (justAlerted || rng.int(0, Math.floor(dist / 2)) === 0) {
        this.enemySeen = true;
        this.onNotice(ctx);
        this.state = 'hunting';
        this.target = heroPos;
        return 0; // vanilla spends nothing on the transition
      }
    }
    this.enemySeen = false;
    const oldPos = this.pos;
    if (this.target !== -1 && this.getCloser(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost(); // spend(1/speed())
    }
    this.target = randomDestination(rng, ctx.level);
    return this.waitCost(); // spend(TICK)
  }

  private actHunting(
    ctx: ActionContext,
    hero: ContentHero | null,
    enemyInFOV: boolean,
  ): number {
    // Hunting.act (Mob.java:479-513). hero is null only when selectEnemy()
    // returned null (sad ghost), in which case enemyInFOV is false and the
    // hero is never dereferenced.
    this.enemySeen = enemyInFOV;
    if (enemyInFOV && hero != null && this.canAttack(ctx, hero.pos)) {
      return this.doAttack(ctx, hero);
    }
    if (enemyInFOV && hero != null) {
      this.target = hero.pos;
    }
    const oldPos = this.pos;
    if (this.target !== -1 && this.getCloser(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost(); // spend(1/speed())
    }
    this.state = 'wandering';
    this.target = randomDestination(ctx.rng, ctx.level);
    return this.waitCost(); // spend(TICK)
  }

  private actFleeing(
    ctx: ActionContext,
    heroPos: number,
    enemyInFOV: boolean,
  ): number {
    // Fleeing.act (Mob.java:517-545)
    this.enemySeen = enemyInFOV;
    if (enemyInFOV) {
      this.target = heroPos;
    }
    const oldPos = this.pos;
    if (this.target !== -1 && this.getFurther(ctx, this.target)) {
      this.afterMove(ctx, oldPos);
      return this.moveCost(); // spend(1/speed())
    }
    this.nowhereToRun(ctx);
    return this.waitCost(); // spend(TICK)
  }

  /** Fleeing.nowhereToRun (Mob.java:538-539); thief overrides. */
  protected nowhereToRun(_ctx: ActionContext): void {
    // base: nothing
  }

  /** getCloser(target) (Mob.java:231-245). */
  getCloser(ctx: ActionContext, target: number): boolean {
    if (this.rooted) return false;
    const step = stepToward(ctx, this, target % this.w, Math.floor(target / this.w));
    if (step === -1) return false;
    this.pos = step;
    return true;
  }

  /** getFurther(target) (Mob.java:247-256). */
  getFurther(ctx: ActionContext, target: number): boolean {
    const step = stepAway(ctx, this, target % this.w, Math.floor(target / this.w));
    if (step === -1) return false;
    this.pos = step;
    return true;
  }

  /** doAttack(enemy) (Mob.java:267-278); damage resolves immediately in M1. */
  doAttack(ctx: ActionContext, hero: ContentHero): number {
    strikeMobVsHero(
      ctx,
      this,
      hero,
      this.def.atk,
      (rng) => this.mobDamageRoll(rng),
      (_rng, damage) => this.attackProc(ctx, hero, damage),
    );
    return this.attackCost(); // spend(attackDelay())
  }

  /**
   * Char.attack step 5 (Char.java:149), before defenseProc/damage:
   * thief steals here (Thief.attackProc, Thief.java:103-111), the albino
   * rat bleeds here (Albino.attackProc, Albino.java:52-60).
   */
  attackProc(
    _ctx: ActionContext,
    _hero: ContentHero,
    damage: number,
  ): number {
    return damage;
  }

  /**
   * Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184):
   * fired by damageMob/strikeHeroVsMob/damageFromTrap whenever the mob
   * survives a damage call (vanilla checks isAlive() first).
   */
  onDamaged(_ctx: ActionContext): void {
    // base: nothing
  }
}

/**
 * Ranged canAttack (Ballistica.cast(pos, enemy.pos, false, true) == enemy.pos;
 * Shaman.java:74-76, Tengu.java:119-121): the trace stops at the first
 * non-passable cell (before it — Ballistica.java:85) or AT the first
 * opaque cell / char (hitChars=true — Ballistica.java:88). The mob can
 * attack iff the trace ends on the target.
 */
export function rangedCanAttack(
  ctx: ActionContext,
  self: ContentMob,
  targetPos: number,
): boolean {
  const level = ctx.level;
  const w = level.w;
  if (targetPos === self.pos) return true; // Ballistica.cast: trace[0] == to
  const x0 = self.pos % w;
  const y0 = Math.floor(self.pos / w);
  const x1 = targetPos % w;
  const y1 = Math.floor(targetPos / w);
  // Bresenham trace (mirrors the integer walk used by Goo's lineClear).
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    const cell = y * w + x;
    if (cell === self.pos) continue; // start-exclusive
    if (!level.inBounds(x, y)) return false;
    if (!level.isPassable(x, y)) return false; // trace stops before it
    if (level.isOpaque(x, y)) return cell === targetPos; // trace stops AT it
    if (charAtPos(ctx, cell, self)) return cell === targetPos; // hitChars
    if (cell === targetPos) return true;
  }
}
/**
 * Thief's Fleeing.nowhereToRun: back to HUNTING when cornered
 * (Thief.java:151-160; M1 has no Terror buff).
 */
export class ThiefMob extends ContentMob {
  protected override nowhereToRun(_ctx: ActionContext): void {
    this.state = 'hunting';
  }

  /** Thief.attackProc (Thief.java:103-111): steal before damage resolves. */
  override attackProc(ctx: ActionContext, hero: ContentHero, damage: number): number {
    thiefSteal(ctx, this, hero);
    return damage;
  }
}

/**
 * Bat (Bat.java:69-79): a landed hit sates the bat — it heals
 * min(damage, HT - HP). No message in vanilla (red sparkle emitter only).
 */
export class BatMob extends ContentMob {
  /** Bat.defenseVerb (Bat.java:64-66). */
  override defenseVerb(): string {
    return 'evaded';
  }

  override attackProc(
    _ctx: ActionContext,
    _hero: ContentHero,
    damage: number,
  ): number {
    const reg = Math.min(damage, this.ht - this.hp);
    if (reg > 0) this.hp += reg;
    return damage;
  }
}

/**
 * Shaman (Shaman.java:44-120): ranged lightning zap through Ballistica
 * (Shaman.canAttack, Shaman.java:74-76); adjacent targets take the plain
 * melee die instead (Shaman.doAttack, Shaman.java:79-84).
 */
export class ShamanMob extends ContentMob {
  override canAttack(ctx: ActionContext, targetPos: number): boolean {
    return rangedCanAttack(ctx, this, targetPos);
  }

  override doAttack(ctx: ActionContext, hero: ContentHero): number {
    if (chebyshevPos(this.pos, hero.pos, this.w) > 1) {
      return this.zap(ctx, hero);
    }
    return super.doAttack(ctx, hero);
  }

  /**
   * Shaman.doAttack zap branch (Shaman.java:85-119): magic accuracy
   * (hit(this, enemy, true), Char.java:213-217), uniform Random.Int(2,12)
   * — NOT the triangular melee die — x1.5 (Java float compound assignment
   * truncates) in water against a non-flying target (Shaman.java:95-98),
   * costs TIME_TO_ZAP = 2 turns (Shaman.java:40, 92).
   */
  private zap(ctx: ActionContext, hero: ContentHero): number {
    const rng = ctx.rng;
    if (hitRoll(rng, this.def.atk, heroDefenseSkill(hero), true)) {
      let dmg = rng.int(2, 12);
      if (ctx.level.getAt(hero.pos) === Terrain.WATER && !hero.flying) {
        dmg = Math.floor(dmg * 1.5);
      }
      const applied = applyDamage(
        rng,
        {
          hp: hero.hp, ht: hero.ht, paralysed: hero.paralysed,
          immunities: [], resistances: [],
        },
        dmg,
        'lightning',
      );
      hero.hp = applied.hp;
      if (applied.paralysisBroken) {
        hero.paralysed = false;
        delete hero.buffs.paralysis;
      }
      ctx.log(`The ${this.name}'s lightning hits you for ${dmg}.`);
      if (applied.died) {
        ctx.log(`${this.name}'s lightning bolt killed you...`); // TXT_LIGHTNING_KILLED, Shaman.java:42
      }
    } else {
      // enemy.sprite.showStatus(NEUTRAL, enemy.defenseVerb()) (Shaman.java:114-118)
      ctx.log(`The ${this.name}'s lightning misses you.`);
    }
    return 2 * this.getSpeed();
  }
}

/**
 * Brute (Brute.java:133-184): enrages (extra NormalIntRange(10,40) die)
 * below HT/4 HP; the spend(TICK) on enrage (Brute.java:178) lands on the
 * brute's next turn cost — Goo's pumpedTicks pattern — because the
 * engine's scheduler heap cannot re-sort a mid-turn time mutation.
 */
export class BruteMob extends ContentMob {
  enraged = false; // Brute.enraged (Brute.java:147)
  private enrageDebt = 0;

  /** Brute.damageRoll (Brute.java:156-160). */
  override mobDamageRoll(rng: MechanicsRng): number {
    return this.enraged
      ? rng.normalIntRange(10, 40)
      : rng.normalIntRange(8, 18);
  }

  /** Brute.damage (Brute.java:173-184). */
  override onDamaged(ctx: ActionContext): void {
    if (this.isAlive() && !this.enraged && this.hp < Math.floor(this.ht / 4)) {
      this.enraged = true;
      this.enrageDebt = 1;
      if (ctx.level.visible[this.pos]) {
        ctx.log(`${this.name} becomes enraged!`); // TXT_ENRAGED, Brute.java:131
      }
    }
  }

  override takeTurn(ctx: ActionContext): number {
    const cost = super.takeTurn(ctx);
    if (this.enrageDebt > 0) {
      this.enrageDebt = 0;
      return cost + 1;
    }
    return cost;
  }
}

/**
 * Shielded brute (Shielded.java:25-47): inherits Brute's enrage and damage
 * dice; defenseSkill 20, dr 10, defenseVerb "blocked" come from the def.
 */
export class ShieldedMob extends BruteMob {
  /** Shielded.defenseVerb (Shielded.java:38-40). */
  override defenseVerb(): string {
    return 'blocked';
  }
}

/**
 * Albino rat (Albino.java:29-60): Rat stats with HP/HT 15; half of all
 * successful attackProcs apply Bleeding at the damage dealt
 * (Albino.attackProc, Albino.java:52-60) — set, not stacked.
 */
export class AlbinoMob extends ContentMob {
  override attackProc(
    ctx: ActionContext,
    hero: ContentHero,
    damage: number,
  ): number {
    if (ctx.rng.int(0, 2) === 0) {
      // Bleeding.affect(enemy).set(damage) (Albino.java:52-60): set, not
      // stacked — matches the GrippingTrap applier shape (traps.ts).
      hero.buffs.bleeding = { kind: 'bleeding', left: 0, level: damage };
    }
    return damage;
  }
}

/**
 * Crazy bandit (Bandit.java:33-55): a Thief whose steal also prolongs
 * Blindness by Random.Int(5,12) turns and re-observes the FOV
 * (Bandit.steal, Bandit.java:39-49). Extends ThiefMob so the steal,
 * fleeing, and defenseProc gold drop stay identical.
 */
export class BanditMob extends ThiefMob {
  override attackProc(ctx: ActionContext, hero: ContentHero, damage: number): number {
    if (thiefSteal(ctx, this, hero)) {
      // Buff.prolong(hero, Blindness.class, Random.Int(5, 12)) (Bandit.java:42)
      const left = ctx.rng.int(5, 12);
      const cur = hero.buffs.blindness?.left ?? 0;
      hero.buffs.blindness = { kind: 'blindness', left: Math.max(cur, left) };
      // Dungeon.observe() (Bandit.java:43): the engine recomputes FOV
      // afterAction; the blackout itself is applied in the FOV pass.
    }
    return damage;
  }
}

/** Build a live mob from a resolved spawn (spawns.ts) or a save blob. */
export function buildMob(mobId: string, id: number, pos: number, w: number, depth = 0): ContentMob {
  if (mobId === 'goo') {
    // Goo lives in goo-boss.ts; it registers itself here to avoid a cycle.
    const ctor = gooCtor;
    if (!ctor) throw new Error('goo-boss not registered (import src/content/goo-boss.js)');
    return new ctor(id, pos, w);
  }
  // Quest NPCs (sad ghost, wandmaker, fetid rat, curse, shopkeeper) live in
  // npcs.ts; they register here to avoid a cycle. The curse's HP scales with
  // depth (CursePersonification, CursePersonification.java:36-37), hence the
  // depth parameter (0 when reviving from a save, where HP is restored).
  if (npcBuilder) {
    const npc = npcBuilder(mobId, id, pos, w, depth);
    if (npc) return npc;
  }
  if (mobId === 'tengu') {
    // Tengu lives in tengu-boss.ts; it registers itself here to avoid a cycle.
    const ctor = tenguCtor;
    if (!ctor) throw new Error('tengu-boss not registered (import src/content/tengu-boss.js)');
    return new ctor(id, pos, w);
  }
  const def = MOB_DEFS[mobId];
  if (!def) throw new Error(`unknown mob id: ${mobId}`);
  switch (mobId) {
    case 'thief': return new ThiefMob(id, def, pos, w);
    case 'shaman': return new ShamanMob(id, def, pos, w);
    case 'bat': return new BatMob(id, def, pos, w);
    case 'brute': return new BruteMob(id, def, pos, w);
    case 'albino': return new AlbinoMob(id, def, pos, w);
    case 'bandit': return new BanditMob(id, def, pos, w);
    case 'shielded': return new ShieldedMob(id, def, pos, w);
    default: return new ContentMob(id, def, pos, w);
  }
}

/** Goo constructor registration (avoids a goo-boss <-> mobs import cycle). */
type GooCtor = new (id: number, pos: number, w: number) => ContentMob;
let gooCtor: GooCtor | null = null;
export function registerGoo(ctor: GooCtor): void {
  gooCtor = ctor;
}

/** Tengu constructor registration (avoids a tengu-boss <-> mobs import cycle). */
type TenguCtor = new (id: number, pos: number, w: number) => ContentMob;
let tenguCtor: TenguCtor | null = null;
export function registerTengu(ctor: TenguCtor): void {
  tenguCtor = ctor;
}

/** NPC builder registration (avoids an npcs <-> mobs import cycle). */
export type NpcBuilder = (
  mobId: string,
  id: number,
  pos: number,
  w: number,
  depth: number,
) => ContentMob | null;
let npcBuilder: NpcBuilder | null = null;
export function registerNpcBuilder(builder: NpcBuilder): void {
  npcBuilder = builder;
}

/**
 * Sewer-kill hook registration. Vanilla Rat.die (Rat.java:54), Gnoll.die
 * (Gnoll.java:59), Crab.die (Crab.java:65) — and Albino via Rat.die — call
 * Ghost.Quest.processSewersKill(pos) before the death pipeline. The quest
 * logic lives in npcs.ts; this avoids an mobs <-> npcs import cycle.
 */
let sewersKillHook: ((ctx: ActionContext, pos: number) => void) | null = null;
export function registerSewersKillHook(
  fn: (ctx: ActionContext, pos: number) => void,
): void {
  sewersKillHook = fn;
}

/**
 * Thief.attackProc steal (Thief.java:103-111 + steal(), Thief.java:127-142):
 * takes a random unequipped item (M1: any inventory stack — equipped gear
 * lives on the hero, not in the inventory) and starts FLEEING.
 */
export function thiefSteal(
  ctx: ActionContext,
  thief: ContentMob,
  hero: ContentHero,
): boolean {
  if (thief.stolen) return false;
  if (hero.inventory.length === 0) return false;
  const i = ctx.rng.int(0, hero.inventory.length);
  const stack = hero.inventory.splice(i, 1)[0]!;
  thief.stolen = { ...stack };
  ctx.log(`The ${thief.name} stole ${stackLabel(stack)} from you!`); // TXT_STOLE
  thief.state = 'fleeing';
  return true;
}

function stackLabel(stack: ItemStack): string {
  const def = getItem(stack.itemId);
  return stack.qty > 1 ? `${stack.qty}x ${def.name}` : `your ${def.name}`;
}

/**
 * Mob defenseProc hook (Char.attack step 6, Char.java:150):
 * swarm split (Swarm.defenseProc, Swarm.java:76-107) and thief gold drop
 * while fleeing (Thief.defenseProc, Thief.java:114-121).
 */
export function mobDefenseProc(
  ctx: ActionContext,
  mob: ContentMob,
  damage: number,
): number {
  if (mob.def.ability === 'swarm' && mob.isAlive() && mob.hp >= damage + 2) {
    const cell = findSplitCell(ctx, mob);
    if (cell !== -1) {
      const clone = new ContentMob(nextMobId(), mob.def, cell, ctx.level.w);
      clone.hp = Math.floor((mob.hp - damage) / 2); // (HP - damage) / 2, Swarm.java:94
      clone.state = 'hunting'; // Swarm.java:95 — no enemy/target/enemySeen set:
      // the clone's first actHunting (Mob.java:479-513) then behaves exactly
      // like vanilla: hero in FOV and adjacent -> attacks; hero in FOV but
      // distant -> target = hero.pos, moves toward the hero; hero not in FOV
      // (target stays -1) -> drops to WANDERING. enemySeen is assigned by
      // that first act (Mob.java:509); vanilla logs nothing here.
      clone.generation = mob.generation + 1; // Swarm.split, Swarm.java:112-121
      if (mob.buffs.burning) clone.buffs.burning = { kind: 'burning', left: 8 }; // reignite, Swarm.java:114-116
      if (mob.buffs.poison) clone.buffs.poison = { kind: 'poison', left: 2 }; // set(2), Swarm.java:117-119
      mob.hp -= clone.hp; // Swarm.java:101
      ctx.addMob(clone, 1); // GameScene.add(clone, SPLIT_DELAY=1), Swarm.java:101
    }
  }
  if (mob.def.ability === 'thief' && mob.state === 'fleeing') {
    dropItemAt(ctx, mob.pos, 'gold:1'); // Thief.java:114-121
  }
  if (mob.def.ability === 'fetidrat') {
    // FetidRat.defenseProc (FetidRat.java:79-82): seeds 20 ParalyticGas at
    // its cell on every defense proc.
    seedBlob(ctx.level.blobs, 'paralytic', mob.pos, 20, ctx.level.w * ctx.level.h);
  }
  return damage;
}

/** Split candidates: 4-neighbors, tile-passable, no char (Swarm.java:80-87). */
function findSplitCell(ctx: ActionContext, mob: ContentMob): number {
  const level = ctx.level;
  const w = level.w;
  const x = mob.x;
  const y = mob.y;
  const candidates: number[] = [];
  const n4 = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  for (const [nx, ny] of n4) {
    const pos = ny * w + nx;
    if (tileWalkableFor(level, nx, ny) && !charAtPos(ctx, pos, mob)) {
      candidates.push(pos);
    }
  }
  if (candidates.length === 0) return -1;
  return ctx.rng.pick(candidates);
}

/**
 * Damage a mob outside the attack sequence (skeleton burst, buff ticks already
 * applied separately). Runs Mob.damage wake/alert (Mob.java:328-337) but NOT
 * defenseProc — vanilla's burst calls ch.damage() directly (Skeleton.java:62).
 */
export function damageMobDirect(
  ctx: ActionContext,
  mob: ContentMob,
  amount: number,
  sourceTag?: string,
): void {
  if (!mob.isAlive()) return;
  if (mob.invulnerable) return; // Vanilla NPC.damage() is a no-op (NPC.java:33-37).
  if (mob.state === 'sleeping') mob.state = 'wandering';
  mob.justAlerted = true;
  const applied = applyDamage(
    ctx.rng,
    {
      hp: mob.hp, ht: mob.ht, paralysed: mob.paralysed,
      immunities: mob.immunities, resistances: mob.resistances,
    },
    amount,
    sourceTag,
  );
  mob.hp = applied.hp;
  if (applied.paralysisBroken) {
    mob.paralysed = false;
    delete mob.buffs.paralysis;
  }
  if (applied.died) {
    killMob(ctx, mob, {});
  } else {
    // Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184):
    // fires on any survived damage call — vanilla checks isAlive() first.
    mob.onDamaged(ctx);
  }
}

/**
 * Full mob death pipeline: EXP (Mob.destroy, Mob.java:343-369),
 * loot (Mob.die -> dropLoot, Mob.java:371-398), skeleton burst AFTER
 * (Skeleton.die calls super.die first, Skeleton.java:54-76), then removal.
 */
export function killMob(ctx: ActionContext, mob: ContentMob, _opts: object): void {
  const hero = heroOf(ctx);
  const wasAlive = hero.isAlive();

  // Vanilla Rat.die / Gnoll.die / Crab.die (Albino via Rat.die) call
  // Ghost.Quest.processSewersKill(pos) before super.die() — the ghost quest
  // hook (rose drop chance / fetid rat spawn). FetidRat extends Mob, not
  // Rat, so its own death does not fire it.
  if (
    mob.def.id === 'rat' ||
    mob.def.id === 'gnoll' ||
    mob.def.id === 'crab' ||
    mob.def.id === 'albino'
  ) {
    sewersKillHook?.(ctx, mob.pos);
  }

  // EXP (Mob.destroy): only when the hero is alive to earn it.
  if (wasAlive) {
    const exp = expForKill(mob.def.id, hero.lvl); // Mob.exp, Mob.java:353-355
    if (exp > 0) {
      const gained = earnExp(hero, exp); // Hero.earnExp
      ctx.log(`+${exp} EXP`);
      if (gained > 0) ctx.log(`You level up! Welcome to level ${hero.lvl}.`);
    }
  }

  // Loot (Mob.die: hero.lvl <= maxLvl + 2 gate, Mob.java:371-381).
  if (hero.lvl <= mob.def.maxLvl + 2) {
    rollMobLoot(ctx, mob);
  }
  // Thief drops whatever it stole (Thief.die, Thief.java:94-100).
  if (mob.stolen) {
    dropItemAt(ctx, mob.pos, mob.stolen.itemId);
    mob.stolen = null;
  }

  mob.onDeath(ctx);

  // Skeleton death burst (Skeleton.die, Skeleton.java:54-76): damage =
  // max(0, damageRoll() - Random.IntRange(0, ch.dr()/2)) to every adjacent
  // living char.
  if (mob.def.ability === 'skeleton') {
    skeletonBurst(ctx, mob);
  }

  ctx.log(`The ${mob.name} dies.`);
  ctx.killMob(mob);
}

function skeletonBurst(ctx: ActionContext, mob: ContentMob): void {
  const level = ctx.level;
  const w = level.w;
  const hero = heroOf(ctx);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = mob.x + dx;
      const ny = mob.y + dy;
      if (!level.inBounds(nx, ny)) continue;
      const ch = charAtPos(ctx, ny * w + nx);
      if (!ch || !ch.isAlive()) continue;
      const victimDr = ch === hero ? heroDR(ch) : (ch as ContentMob).def.dr;
      const dmg = skeletonDeathBurst(ctx.rng, (r) => mob.mobDamageRoll(r), victimDr);
      if (dmg <= 0) continue;
      if (ch === hero) {
        const applied = applyDamage(
          ctx.rng,
          { hp: hero.hp, ht: hero.ht, paralysed: hero.paralysed, immunities: [], resistances: [] },
          dmg,
        );
        hero.hp = applied.hp;
        ctx.log(`The skeleton's explosion hits you for ${dmg}.`);
        if (applied.died) ctx.log('You were killed by the explosion of bones...'); // TXT_HERO_KILLED
      } else {
        damageMobDirect(ctx, ch as ContentMob, dmg);
      }
    }
  }
}

/** Mob loot rolls (dropLoot, Mob.java:383-406 + per-mob loot/lootChance). */
function rollMobLoot(ctx: ActionContext, mob: ContentMob): void {
  const rng = ctx.rng;
  const depth = ctx.level.depth;
  switch (mob.def.id) {
    case 'gnoll':
      // loot = Gold.class, lootChance 0.5 (Gnoll.java:38-39);
      // Gold.random(): 20 + depth*10 .. 40 + depth*20 (Gold.java:100-103)
      if (rng.float(0, 1) < 0.5) {
        dropItemAt(ctx, mob.pos, `gold:${rng.intRange(20 + depth * 10, 40 + depth * 20)}`);
      }
      break;
    case 'swarm':
      // Random.Int(5 * (generation + 1)) == 0 -> PotionOfHealing (Swarm.java:123-128)
      if (rng.int(0, 5 * (mob.generation + 1)) === 0) {
        dropItemAt(ctx, mob.pos, 'potion_healing');
      }
      break;
    case 'skeleton': {
      // Skeleton.dropLoot (Skeleton.java:78-88): Random.Int(5) == 0 -> three
      // Generator.random(WEAPON) draws, keeping the lowest-level weapon.
      // The draws share the run's Generator bag (halving per draw).
      if (rng.int(0, 5) === 0) {
        dropItemAt(ctx, mob.pos, skeletonWeaponDrop(rng, depth, itemGenerator));
      }
      break;
    }
    case 'crab':
      // loot = MysteryMeat, lootChance 0.167 (Crab.java:39-41); M1's only
      // food is the ration.
      if (rng.float(0, 1) < 0.167) {
        dropItemAt(ctx, mob.pos, 'ration');
      }
      break;
    case 'shaman': {
      // loot = Generator.Category.SCROLL, lootChance 0.33 (Shaman.java:54-55);
      // Generator.random(SCROLL) draws from the scroll probability bag.
      if (rng.float(0, 1) < 0.33) {
        dropItemAt(ctx, mob.pos, itemGenerator.randomFrom(rng, 'scroll', depth));
      }
      break;
    }
    case 'bat':
      // loot = PotionOfHealing, lootChance 0.125 (Bat.java:44-45)
      if (rng.float(0, 1) < 0.125) {
        dropItemAt(ctx, mob.pos, 'potion_healing');
      }
      break;
    case 'brute':
    case 'shielded':
      // loot = Gold.class, lootChance 0.5 (Brute.java:144-145); Shielded
      // extends Brute with no loot override (Shielded.java), so it inherits.
      // Gold.random(): 20 + depth*10 .. 40 + depth*20 (Gold.java:100-103)
      if (rng.float(0, 1) < 0.5) {
        dropItemAt(ctx, mob.pos, `gold:${rng.intRange(20 + depth * 10, 40 + depth * 20)}`);
      }
      break;
    // albino: Rat has no loot table (Rat.java) — none.
    // bandit: Thief's RingOfHaggler 0.01 skipped like the thief — no M1 rings.
    // thief: RingOfHaggler 0.01 (Thief.java:52-53) — no M1 rings; skipped.
    // goo: LloydsBeacon 0.333 (Goo.java:58-59) — no M1 beacons; skipped.
    default:
      break;
  }
}

/**
 * Hero melee strike (Char.attack, Char.java:128-186): hit -> dr roll ->
 * damage roll -> defenseProc (swarm split may mutate mob.hp first) ->
 * damage application -> wake/alert -> death pipeline.
 */
export function strikeHeroVsMob(
  ctx: ActionContext,
  hero: ContentHero,
  mob: ContentMob,
  accuracy: number,
  damageRoll: (rng: MechanicsRng) => number,
): void {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: mob.mobDefenseSkill(),
    defenderDr: mob.def.dr,
    damageRoll,
    onDefenseProc: (_r, dmg) => mobDefenseProc(ctx, mob, dmg),
  });
  if (!seq.hit) {
    // TXT_YOU_MISSED "%s %s your attack" (Char.java:69, 196-203).
    ctx.log(`The ${mob.name} ${mob.defenseVerb()} your attack.`);
    return;
  }
  if (mob.invulnerable) {
    // Vanilla NPC.damage() is a no-op (NPC.java:33-37): the sad ghost and
    // wandmaker cannot be hurt. The hit roll above still runs (defense 1000
    // -> a miss in practice); a rolled hit deals nothing.
    ctx.log(`You hit the ${mob.name}, but do no damage.`);
    return;
  }
  const applied = applyDamage(
    rng,
    {
      hp: mob.hp, ht: mob.ht, paralysed: mob.paralysed,
      immunities: mob.immunities, resistances: mob.resistances,
    },
    seq.damageDealt,
  );
  mob.hp = applied.hp;
  if (applied.paralysisBroken) {
    mob.paralysed = false;
    delete mob.buffs.paralysis;
  }
  // Mob.damage wake/alert (Mob.java:328-337)
  if (mob.state === 'sleeping') mob.state = 'wandering';
  mob.justAlerted = true;
  ctx.log(
    seq.damageDealt > 0
      ? `You hit the ${mob.name} for ${seq.damageDealt}.`
      : `You hit the ${mob.name}, but do no damage.`,
  );
  if (applied.died) {
    killMob(ctx, mob, {});
  } else {
    // Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184).
    mob.onDamaged(ctx);
  }
}

/**
 * Mob strike vs the hero. onAttackProc carries Goo's ooze / thief's steal
 * (Char.attack step 5 runs before defenseProc/damage, Char.java:149).
 */
export function strikeMobVsHero(
  ctx: ActionContext,
  mob: ContentMob,
  hero: ContentHero,
  accuracy: number,
  damageRoll: (rng: MechanicsRng) => number,
  onAttackProc?: (rng: MechanicsRng, damage: number) => number,
): void {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: heroDefenseSkill(hero), // Hero.java:276-305 (paralysis halves)
    defenderDr: heroDR(hero), // Hero.java:307-315
    damageRoll,
    onAttackProc,
  });
  if (!seq.hit) {
    ctx.log(`The ${mob.name} misses you.`);
    return;
  }
  const applied = applyDamage(
    rng,
    { hp: hero.hp, ht: hero.ht, paralysed: hero.paralysed, immunities: [], resistances: [] },
    seq.damageDealt,
  );
  hero.hp = applied.hp;
  if (applied.paralysisBroken) {
    hero.paralysed = false;
    delete hero.buffs.paralysis;
  }
  ctx.log(
    seq.damageDealt > 0
      ? `The ${mob.name} hits you for ${seq.damageDealt}.`
      : `The ${mob.name} hits you, but does no damage.`,
  );
  if (applied.died) ctx.log(`You were killed by the ${mob.name}...`);
}
