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
import { onItemDropped as cavesOnItemDropped } from '../dungeon/cavesBoss.js';
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
  elementsDurationFactor,
  oozeTick,
  poisonTick,
  type BuffKind,
} from '../mechanics/buffs.js';
import { earnExp, expForKill, MOB_EXP } from '../mechanics/exp.js';
import { tickPotionBuffs } from './potions.js';
import { heroDefenseSkill, heroDR, heroDamageRoll } from '../mechanics/hero.js';
import type { BuffState } from '../mechanics/char.js';
import { charTimeScale, crippleFactor } from '../mechanics/char.js';
import { satisfy, isStarving, STARVING } from '../mechanics/hunger.js';
import { seedBlob } from '../mechanics/blobs.js';
import { pressTrapCell, mobPressTrapCell, type TrapMob } from '../mechanics/traps.js';
import {
  affectBuff,
  weaponAttackProc,
  type ProcChar,
  type ProcFx,
} from './enchantments.js';
import { armorDefenseProc } from './glyphs.js';
import { ContentHero, addToInventory, removeFromInventory, type ItemStack } from './hero.js';
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
  /** viewDistance override (Char.java:90, default 8); Succubus = 4
   * (Light.DISTANCE, Succubus.java:35). */
  viewDistance?: number;
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
  // --- Stage 2: Caves depths (Bestiary.java:111-127) ---
  /** Spinner.java:33-62 — "cave spinner": HP/HT 50, def 14, atk 20,
   *  NormalIntRange(12,16), dr 6, EXP 9, maxLvl 16; resists Poison
   *  ('poison'), immune to Roots ('roots'); loot MysteryMeat @ 0.125
   *  (Spinner.java:44) — M1's only food is the ration (crab pattern). */
  spinner: {
    id: 'spinner', name: 'cave spinner', sprite: 'mob_spinner',
    hp: 50, atk: 20, def: 14, dmgMin: 12, dmgMax: 16, triangular: true, dr: 6,
    exp: MOB_EXP.spinner.exp, maxLvl: MOB_EXP.spinner.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: ['roots'], resistances: ['poison'],
  },
  /** Elemental.java:33-60 — "fire elemental": HP/HT 65, def 20, atk 25,
   *  NormalIntRange(16,20), dr 5, EXP 10, maxLvl 20, flying; immune to
   *  Burning/Fire/Firebolt/PsionicBlast ('burning' tag consumed by the
   *  fire-attach sites; the rest are forward-looking); loot
   *  PotionOfLiquidFlame @ 0.1 (Elemental.java:47) — not in the item
   *  catalog yet, gated like Tengu's tome. */
  elemental: {
    id: 'elemental', name: 'fire elemental', sprite: 'mob_elemental',
    hp: 65, atk: 25, def: 20, dmgMin: 16, dmgMax: 20, triangular: true, dr: 5,
    exp: MOB_EXP.elemental.exp, maxLvl: MOB_EXP.elemental.maxLvl, // single-sourced
    speed: 1, flying: true, ability: null, attackDelay: 1,
    immunities: ['burning', 'fire', 'firebolt', 'psionic_blast'], resistances: [],
  },
  /** Monk.java:33-59 — "dwarf monk": HP/HT 70, def 30, atk 30,
   *  NormalIntRange(12,16), dr 2, attackDelay 0.5, defenseVerb "parried",
   *  EXP 11, maxLvl 21, immune to Amok/Terror ('amok'/'terror',
   *  forward-looking — no such buffs in the port yet); loot Food @ 0.083
   *  (Monk.java:43) — the port's ration is Food.java-based. */
  monk: {
    id: 'monk', name: 'dwarf monk', sprite: 'mob_monk',
    hp: 70, atk: 30, def: 30, dmgMin: 12, dmgMax: 16, triangular: true, dr: 2,
    exp: MOB_EXP.monk.exp, maxLvl: MOB_EXP.monk.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 0.5,
    immunities: ['amok', 'terror'], resistances: [],
  },
  /** Warlock.java:31-53 — name 'dwarf warlock', HP/HT 70, def 18, atk 25,
   *  Random.NormalIntRange(12,20), dr 8, EXP 11, maxLvl 21; loot
   *  Generator.Category.POTION @ 0.83 (Warlock.java:50-51); resists Death
   *  (Warlock.java:63). Ranged shadow-bolt handled by WarlockMob below. */
  warlock: {
    id: 'warlock', name: 'dwarf warlock', sprite: 'mob_warlock',
    hp: 70, atk: 25, def: 18, dmgMin: 12, dmgMax: 20, triangular: true, dr: 8,
    exp: MOB_EXP.warlock.exp, maxLvl: MOB_EXP.warlock.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1,
    immunities: [], resistances: ['death'],
  },
  /** Golem.java:31-51 — name 'golem', HP/HT 85, def 18, atk 28,
   *  Random.NormalIntRange(20,40), dr 12, EXP 12, maxLvl 22; attackDelay
   *  1.5 (Golem.java:54); defense verb 'blocked' (Golem.java:58); immune
   *  to Amok/Terror/Sleep (Golem.java:61-62); resists Psionic Blast
   *  (Golem.java:66); no ordinary loot. Death triggers Imp.Quest.process
   *  (Golem.java:72-77) — port seam via GolemMob.die; Imp quest not ported. */
  golem: {
    id: 'golem', name: 'golem', sprite: 'mob_golem',
    hp: 85, atk: 28, def: 18, dmgMin: 20, dmgMax: 40, triangular: true, dr: 12,
    exp: MOB_EXP.golem.exp, maxLvl: MOB_EXP.golem.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1.5,
    immunities: ['amok', 'terror', 'sleep'], resistances: ['psionic_blast'],
  },
  /** Succubus.java:33-53 — name 'succubus', HP/HT 80, def 25, atk 40,
   *  Random.NormalIntRange(15,25), dr 10, EXP 12, maxLvl 25; viewDistance =
   *  Light.DISTANCE = 4 (Succubus.java:35); loot ScrollOfLullaby @ 0.05
   *  (Succubus.java:49-50); resists Leech (Succubus.java:98); immune to
   *  Sleep (Succubus.java:93). Blink + charm handled by SuccubusMob below. */
  succubus: {
    id: 'succubus', name: 'succubus', sprite: 'mob_succubus',
    hp: 80, atk: 40, def: 25, dmgMin: 15, dmgMax: 25, triangular: true, dr: 10,
    exp: MOB_EXP.succubus.exp, maxLvl: MOB_EXP.succubus.maxLvl, // single-sourced
    speed: 1, flying: false, ability: null, attackDelay: 1, viewDistance: 4,
    immunities: ['sleep'], resistances: ['leech'],
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
  /** Set while a Roots buff is attached (Roots.attachTo, Roots.java). */
  rooted: boolean;
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
  // Roots (Roots.java): FlavourBuff countdown; while attached the char is
  // rooted (Roots.attachTo sets target.rooted) and cannot move
  // (Mob.getCloser / Hero.getCloser return false when rooted).
  // Stage 2 applier: the spinner's web blob (Web.evolve, Web.java).
  if (b.roots) {
    b.roots.left -= 1;
    if (b.roots.left <= 0) {
      delete b.roots;
      ch.rooted = false; // Roots.detach (Roots.java)
    } else {
      ch.rooted = true;
    }
  }
  // Blindness (Blindness.java): FlavourBuff countdown; a blinded char
  // sees nothing (Level.updateFieldOfView, Level.java:793). Stage 1
  // applier: the crazy bandit's steal (Bandit.steal, Bandit.java:39-49).
  if (b.blindness) {
    b.blindness.left -= 1;
    if (b.blindness.left <= 0) delete b.blindness;
  }
  // Viscosity.DeferedDamage.act (Viscosity.java:88-127): the deferred pool
  // pays out exactly 1 damage per tick (spend(TICK) semantics); the buff
  // detaches when the pool is exhausted. The pool never merges with
  // normal damage: every hit is either fully deferred or fully taken.
  if (b.deferredDamage && ch.isAlive()) {
    const pool = Math.floor(b.deferredDamage.amount ?? 0);
    if (pool <= 0) {
      delete b.deferredDamage;
    } else {
      b.deferredDamage.amount = pool - 1;
      const applied = applyDamage(rng, buffTarget(ch), 1, 'deferredDamage');
      ch.hp = applied.hp;
      // DeferedDamage.onDeath (Viscosity.java:112-117): the deferred pool
      // is dropped on death; no death line of its own.
      if (applied.died) delete b.deferredDamage;
      else if ((b.deferredDamage.amount ?? 0) <= 0) delete b.deferredDamage;
      logBuffDeath('deferredDamage');
      if (applied.paralysisBroken) {
        ch.paralysed = false;
        delete b.paralysis;
      }
    }
  }
  // Slow (Slow.java): FlavourBuff countdown; the speed effect lives in
  // Char.spend's time scale (charTimeScale, Char.java:303-314) — the port
  // reads b.slow there.
  if (b.slow) {
    b.slow.left -= 1;
    if (b.slow.left <= 0) delete b.slow;
  }
  // Vertigo (Vertigo.java): FlavourBuff countdown (movement scramble is
  // renderer/input-owned; no movement-direction system in the port yet).
  if (b.vertigo) {
    b.vertigo.left -= 1;
    if (b.vertigo.left <= 0) delete b.vertigo;
  }
  // Charm (Charm.java): FlavourBuff countdown. The charmed-mob retargeting
  // (Mob.chooseEnemy picking the charmer's enemies) is not ported — the
  // port's selectEnemy always returns the hero (pre-existing Stage 1 gap).
  if (b.charm) {
    b.charm.left -= 1;
    if (b.charm.left <= 0) delete b.charm;
  }
  // Stage 2 (Worker 4): tick the potion/scroll buffs down in one place
  // (FlavourBuff spend semantics shared by all of them).
  tickPotionBuffs(b, ch, () => {
    const m = ch as unknown as { aiState?: string };
    if (m.aiState === 'sleeping') m.aiState = 'wandering';
  });
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
  // Boss-arena key drops: PrisonBossLevel.drop turns the arena door into an
  // ordinary door on depth 10 (PrisonBossLevel.java:331-343); CavesBossLevel
  // drop re-opens the collapsed arena door (EMPTY_DECO, stored as FLOOR in
  // the port) on depth 15 (CavesBossLevel.java:217-231). Depth-gated so the
  // two hooks never fire on each other's level — both reuse the
  // bossArena/arenaDoorCell/enteredArena/keyDropped fields.
  if (ctx.level.depth === 10) {
    onItemDropped(ctx.level, itemId);
  } else if (ctx.level.depth === 15) {
    cavesOnItemDropped(ctx.level, itemId);
  }
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
  /**
   * Retained enemy (Mob.java:66). Vanilla Mob.chooseEnemy (Mob.java:167-176)
   * returns the live retained enemy, else the hero. A hostile mob stung by
   * the honeypot bee keeps the bee as its enemy (Bee.attackProc calls
   * mob.aggro(this), Bee.java:159).
   */
  enemy: ContentHero | ContentMob | null = null;

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
   * Mob.aggro (Mob.java:305-307): the chaser becomes this mob's retained
   * enemy. A hostile mob stung by the bee hunts the bee (Bee.java:159).
   */
  aggro(chaser: ContentHero | ContentMob): void {
    this.enemy = chaser;
  }

  /**
   * Vanilla Mob.chooseEnemy() (Mob.java:167-176): the live retained enemy,
   * else the hero. The sad ghost overrides this to null (Ghost.java:77-85)
   * and never acquires an enemy; the bee overrides it to pick hostile
   * mobs in the hero's field of view (Bee.java:104-121).
   */
  protected selectEnemy(ctx: ActionContext): ContentHero | ContentMob | null {
    return this.enemy != null && this.enemy.isAlive() ? this.enemy : heroOf(ctx);
  }

  /** Hook: shown when the mob notices the hero (Goo yells). */
  protected onNotice(_ctx: ActionContext): void {
    // base mobs: sprite alert only (no text in vanilla)
  }

  /**
   * Vanilla `Mob.notice()` (Mob.java): public entry that fires the notice
   * hook. Used when a boss is spawned directly into HUNTING (Tengu via
   * PrisonBossLevel.press, PrisonBossLevel.java:318-321), bypassing the
   * normal sleep→hunt transition that would fire onNotice.
   */
  notice(ctx: ActionContext): void {
    this.onNotice(ctx);
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

  /** FOV from the mob's position, radius = viewDistance (Char.java:90, default
   *  8; Succubus overrides to Light.DISTANCE = 4, Succubus.java:35). */
  canSee(ctx: ActionContext, pos: number): boolean {
    const level = ctx.level;
    const out = new Uint8Array(level.w * level.h);
    computeFov(
      level,
      (x, y) => level.isOpaque(x, y),
      this.x,
      this.y,
      this.def.viewDistance ?? 8,
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
    enemy: ContentHero | ContentMob | null,
    enemyInFOV: boolean,
  ): number {
    // Hunting.act (Mob.java:479-513). enemy is null only when selectEnemy()
    // returned null (sad ghost), in which case enemyInFOV is false and the
    // enemy is never dereferenced. The bee's chooseEnemy can return a
    // hostile mob (Bee.java:104-121) — hunting works against any enemy.
    this.enemySeen = enemyInFOV;
    if (enemyInFOV && enemy != null && this.canAttack(ctx, enemy.pos)) {
      return this.doAttack(ctx, enemy);
    }
    if (enemyInFOV && enemy != null) {
      this.target = enemy.pos;
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
  /**
   * Mob attack against any enemy (Char.attack, Char.java:128-186). The
   * enemy is usually the hero; the honeypot bee hunts hostile mobs instead
   * (Bee.chooseEnemy, Bee.java:104-121), so mob-vs-mob strikes route
   * through strikeMobVsMob.
   */
  doAttack(ctx: ActionContext, enemy: ContentHero | ContentMob): number {
    const proc = (rng: MechanicsRng, damage: number) =>
      this.attackProc(ctx, enemy, damage);
    if (enemy instanceof ContentHero) {
      strikeMobVsHero(
        ctx,
        this,
        enemy,
        this.def.atk,
        (rng) => this.mobDamageRoll(rng),
        proc,
      );
    } else {
      strikeMobVsMob(
        ctx,
        this,
        enemy,
        this.def.atk,
        (rng) => this.mobDamageRoll(rng),
        proc,
      );
    }
    return this.attackCost(); // spend(attackDelay())
  }

  /**
   * Char.attack step 5 (Char.java:149), before defenseProc/damage:
   * thief steals here (Thief.attackProc, Thief.java:103-111), the albino
   * rat bleeds here (Albino.attackProc, Albino.java:52-60). The enemy is
   * `Char` in vanilla — procs that only work on the hero (thief's steal,
   * monk's disarm) guard on it, exactly like vanilla's `enemy instanceof
   * Hero` / `enemy == Dungeon.hero` checks.
   */
  attackProc(
    _ctx: ActionContext,
    _enemy: ContentHero | ContentMob,
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
  override attackProc(ctx: ActionContext, enemy: ContentHero | ContentMob, damage: number): number {
    // Thief.attackProc (Thief.java:102-108): the steal only targets the hero.
    if (enemy instanceof ContentHero) thiefSteal(ctx, this, enemy);
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
    _enemy: ContentHero | ContentMob,
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

  override doAttack(ctx: ActionContext, enemy: ContentHero | ContentMob): number {
    if (chebyshevPos(this.pos, enemy.pos, this.w) > 1) {
      return this.zap(ctx, enemy);
    }
    return super.doAttack(ctx, enemy);
  }

  /**
   * Shaman.doAttack zap branch (Shaman.java:85-119): magic accuracy
   * (hit(this, enemy, true), Char.java:213-217), uniform Random.Int(2,12)
   * — NOT the triangular melee die — x1.5 (Java float compound assignment
   * truncates) in water against a non-flying target (Shaman.java:95-98),
   * costs TIME_TO_ZAP = 2 turns (Shaman.java:40, 92). Vanilla works on any
   * Char enemy (a bee-aggroed shaman zaps the bee).
   */
  private zap(ctx: ActionContext, target: ContentHero | ContentMob): number {
    const rng = ctx.rng;
    const evasion =
      target instanceof ContentHero ? heroDefenseSkill(target) : target.mobDefenseSkill();
    if (hitRoll(rng, this.def.atk, evasion, true)) {
      let dmg = rng.int(2, 12);
      if (ctx.level.getAt(target.pos) === Terrain.WATER && !target.flying) {
        dmg = Math.floor(dmg * 1.5);
      }
      const applied = applyDamage(
        rng,
        {
          hp: target.hp, ht: target.ht, paralysed: target.paralysed,
          immunities: [], resistances: [],
        },
        dmg,
        'lightning',
      );
      target.hp = applied.hp;
      if (applied.paralysisBroken) {
        target.paralysed = false;
        delete target.buffs.paralysis;
      }
      if (target instanceof ContentHero) {
        ctx.log(`The ${this.name}'s lightning hits you for ${dmg}.`);
        if (applied.died) {
          ctx.log(`${this.name}'s lightning bolt killed you...`); // TXT_LIGHTNING_KILLED, Shaman.java:42
        }
      } else {
        ctx.log(`The ${this.name}'s lightning hits the ${target.name} for ${dmg}.`);
        if (applied.died) {
          killMob(ctx, target, {});
        } else {
          // Mob.damage wake/alert (Mob.java:328-337) + subclass hooks.
          if (target.state === 'sleeping') target.state = 'wandering';
          target.justAlerted = true;
          target.onDamaged(ctx);
        }
      }
    } else {
      // enemy.sprite.showStatus(NEUTRAL, enemy.defenseVerb()) (Shaman.java:114-118)
      ctx.log(
        target instanceof ContentHero
          ? `The ${this.name}'s lightning misses you.`
          : `The ${this.name}'s lightning misses the ${target.name}.`,
      );
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
    enemy: ContentHero | ContentMob,
    damage: number,
  ): number {
    if (ctx.rng.int(0, 2) === 0) {
      // Bleeding.affect(enemy).set(damage) (Albino.java:52-60): set, not
      // stacked — matches the GrippingTrap applier shape (traps.ts).
      enemy.buffs.bleeding = { kind: 'bleeding', left: 0, level: damage };
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
  override attackProc(ctx: ActionContext, enemy: ContentHero | ContentMob, damage: number): number {
    // Bandit.steal only targets the hero (Thief.attackProc guard, Thief.java:103).
    if (!(enemy instanceof ContentHero)) return damage;
    if (thiefSteal(ctx, this, enemy)) {
      // Buff.prolong(hero, Blindness.class, Random.Int(5, 12)) (Bandit.java:42)
      const left = ctx.rng.int(5, 12);
      const cur = enemy.buffs.blindness?.left ?? 0;
      enemy.buffs.blindness = { kind: 'blindness', left: Math.max(cur, left) };
      // Dungeon.observe() (Bandit.java:43): the engine recomputes FOV
      // afterAction; the blackout itself is applied in the FOV pass.
    }
    return damage;
  }
}

/**
 * Cave spinner (Spinner.java:33-143).
 *
 * - attackProc (Spinner.java:87-96): half of all successful hits poison
 *   the enemy for Random.Int(7,9) * Poison.durationFactor(enemy) — the
 *   port has no Resistance ring, so the factor is 1 — and the spinner
 *   starts FLEEING.
 * - act (Spinner.java:80-85): after the turn, a fleeing spinner whose
 *   enemy is visible and no longer poisoned returns to HUNTING
 *   ("wait in the distance while their victim slowly dies"). The port has
 *   no Terror buff (documented Stage 1), so that guard is dropped.
 * - move (Spinner.java:99-104): while fleeing, each move seeds a Web blob
 *   of Random.Int(5,7) at the cell being left.
 * - nowhereToRun (Spinner.java:139-143): back to HUNTING when cornered
 *   (no Terror in the port).
 */
export class SpinnerMob extends ContentMob {
  override attackProc(
    ctx: ActionContext,
    enemy: ContentHero | ContentMob,
    damage: number,
  ): number {
    if (ctx.rng.int(0, 2) === 0) {
      // Buff.affect(enemy, Poison.class).set(...) (Spinner.java:89-90):
      // Poison.set overwrites the duration (Poison.java:50-52).
      enemy.buffs.poison = {
        kind: 'poison',
        left: ctx.rng.int(7, 9) * 1, // * Poison.durationFactor — no Resistance ring in the port
      };
      this.state = 'fleeing';
    }
    return damage;
  }

  protected override afterMove(ctx: ActionContext, oldPos: number): void {
    // GameScene.add(Blob.seed(pos, Random.Int(5, 7), Web.class)) BEFORE
    // super.move(step) (Spinner.java:99-104): the web is left at the cell
    // the spinner moves FROM, and only while fleeing.
    if (this.state === 'fleeing') {
      seedBlob(
        ctx.level.blobs,
        'web',
        oldPos,
        ctx.rng.int(5, 7),
        ctx.level.w * ctx.level.h,
      );
    }
    super.afterMove(ctx, oldPos);
  }

  protected override nowhereToRun(_ctx: ActionContext): void {
    this.state = 'hunting';
  }

  /** Spinner.act (Spinner.java:76-86). */
  override takeTurn(ctx: ActionContext): number {
    const cost = super.takeTurn(ctx);
    if (this.state === 'fleeing' && this.enemySeen) {
      const hero = heroOf(ctx);
      if (hero.isAlive() && !hero.buffs.poison) {
        this.state = 'hunting';
      }
    }
    return cost;
  }
}

/**
 * Fire elemental (Elemental.java:33-119).
 *
 * - attackProc (Elemental.java:63-70): half of all successful hits reignite
 *   Burning on the enemy (Buff.affect(enemy, Burning).reignite(enemy) —
 *   left = BURNING_DURATION, Burning.java:109-111).
 * - add (Elemental.java:72-84): a Burning attach heals 1 HP instead of
 *   sticking (implemented at the fire-attach site in traps.ts); a Frost
 *   attach would deal Random.NormalIntRange(1, HT*2/3) — no frost effects
 *   exist in the port yet (forward-looking, documented).
 */
export class ElementalMob extends ContentMob {
  override attackProc(
    _ctx: ActionContext,
    enemy: ContentHero | ContentMob,
    damage: number,
  ): number {
    if (_ctx.rng.int(0, 2) === 0) {
      enemy.buffs.burning = { kind: 'burning', left: 8 }; // reignite, Burning.java:109-111
    }
    return damage;
  }
}

/**
 * Dwarf monk (Monk.java:33-114).
 *
 * - attackDelay 0.5 (Monk.java:64-66), defenseVerb "parried"
 *   (Monk.java:74-76).
 * - attackProc (Monk.java:90-106): 1/6 of successful hits disarm the hero —
 *   the equipped weapon drops at the hero's feet and the weapon slot is
 *   cleared, with the TXT_DISARM log. Vanilla skips Knuckles and cursed
 *   weapons; the port has no cursed items (documented) and no knuckles in
 *   the catalog yet (guarded by id for when the item worker adds it).
 * - die (Monk.java:79-84): Imp.Quest.process — the imp is a Stage 4 NPC;
 *   the hook lands with it (documented).
 */
export class MonkMob extends ContentMob {
  /** Monk.defenseVerb (Monk.java:74-76). */
  override defenseVerb(): string {
    return 'parried';
  }

  override attackProc(
    ctx: ActionContext,
    enemy: ContentHero | ContentMob,
    damage: number,
  ): number {
    // Monk.attackProc (Monk.java:86-106): disarm only the hero
    // (vanilla: `enemy == Dungeon.hero`).
    if (!(enemy instanceof ContentHero)) return damage;
    if (ctx.rng.int(0, 6) === 0 && enemy.weaponId !== null && enemy.weaponId !== 'knuckles') {
      const def = getItem(enemy.weaponId);
      dropItemAt(ctx, enemy.pos, enemy.weaponId); // Dungeon.level.drop(weapon, hero.pos)
      enemy.weapon = null;
      enemy.weaponId = null;
      ctx.log(`${this.name} has knocked the ${def.name} from your hands!`); // TXT_DISARM, Monk.java:34
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
  if (mobId === 'bee') {
    // The honeypot bee lives in bee.ts; it registers itself here to avoid
    // a cycle. spawn(depth) scales HP/attack/defense with depth, hence the
    // depth parameter (0 when reviving from a save, where HP is restored).
    const ctor = beeCtor;
    if (!ctor) throw new Error('bee not registered (import src/content/bee.js)');
    return new ctor(id, pos, w, depth);
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
  if (mobId === 'dm300') {
    // DM-300 lives in dm300-boss.ts; it registers itself here to avoid a cycle.
    const ctor = dm300Ctor;
    if (!ctor) throw new Error('dm300-boss not registered (import src/content/dm300-boss.js)');
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
    case 'spinner': return new SpinnerMob(id, def, pos, w);
    case 'elemental': return new ElementalMob(id, def, pos, w);
    case 'monk': return new MonkMob(id, def, pos, w);
    default: return new ContentMob(id, def, pos, w);
  }
}

/** Goo constructor registration (avoids a goo-boss <-> mobs import cycle). */
type GooCtor = new (id: number, pos: number, w: number) => ContentMob;
let gooCtor: GooCtor | null = null;
export function registerGoo(ctor: GooCtor): void {
  gooCtor = ctor;
}

/** Bee constructor registration (avoids a bee <-> mobs import cycle). */
export type BeeCtor = new (id: number, pos: number, w: number, depth: number) => ContentMob;
let beeCtor: BeeCtor | null = null;
export function registerBee(ctor: BeeCtor): void {
  beeCtor = ctor;
}

/** Tengu constructor registration (avoids a tengu-boss <-> mobs import cycle). */
type TenguCtor = new (id: number, pos: number, w: number) => ContentMob;
let tenguCtor: TenguCtor | null = null;
export function registerTengu(ctor: TenguCtor): void {
  tenguCtor = ctor;
}

/** DM-300 constructor registration (avoids a dm300-boss <-> mobs import cycle). */
type Dm300Ctor = new (id: number, pos: number, w: number) => ContentMob;
let dm300Ctor: Dm300Ctor | null = null;
export function registerDM300(ctor: Dm300Ctor): void {
  dm300Ctor = ctor;
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
    // --- Stage 2: Caves ---
    case 'spinner':
      // loot = MysteryMeat, lootChance 0.125 (Spinner.java:43-44); M1's only
      // food is the ration (crab pattern).
      if (rng.float(0, 1) < 0.125) {
        dropItemAt(ctx, mob.pos, 'ration');
      }
      break;
    case 'elemental':
      // loot = PotionOfLiquidFlame, lootChance 0.1 (Elemental.java:46-47);
      // not in the item catalog yet — gated like Tengu's tome of mastery.
      if (rng.float(0, 1) < 0.1 && ITEMS['potion_liquid_flame']) {
        dropItemAt(ctx, mob.pos, 'potion_liquid_flame');
      }
      break;
    case 'monk':
      // loot = Food, lootChance 0.083 (Monk.java:42-43) — the port's ration
      // is Food.java-based (energy 260).
      if (rng.float(0, 1) < 0.083) {
        dropItemAt(ctx, mob.pos, 'ration');
      }
      break;
    case 'dm300':
      // loot = new RingOfThorns().random(), lootChance 0.333 (DM300.java:60-61);
      // rings have no mechanics in the port yet — gated like Tengu's tome.
      if (rng.float(0, 1) < 0.333 && ITEMS['ring_of_thorns']) {
        dropItemAt(ctx, mob.pos, 'ring_of_thorns');
      }
      break;
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
/**
 * Build the enchantment/glyph ProcFx for live combat (content/enchantments.ts).
 * Every effect maps to its vanilla call; visuals with no port seam
 * (lightning arcs, emitters, floating status, camera shake) are
 * renderer-owned and omitted or no-ops.
 */
function combatProcFx(ctx: ActionContext): ProcFx {
  const level = ctx.level;
  const hero = heroOf(ctx);
  const charAtPos = (pos: number): ProcChar | null => {
    if (hero.pos === pos && hero.isAlive()) return hero as unknown as ProcChar;
    const m = ctx.mobs.find((mm) => (mm as ContentMob).pos === pos && (mm as ContentMob).isAlive());
    return (m as unknown as ProcChar) ?? null;
  };
  const unoccupied = (pos: number): boolean =>
    !(hero.isAlive() && hero.pos === pos) &&
    !ctx.mobs.some((mm) => (mm as ContentMob).isAlive() && (mm as ContentMob).pos === pos);
  return {
    rng: ctx.rng,
    log: (msg) => ctx.log(msg),
    directDamage: (target, amount, source) => {
      // Char.damage (Char.java:260-300): frost detaches on ANY damage,
      // then immunity/resistance (applyDamage), then HP write-back.
      if (target.hp <= 0) return;
      delete target.buffs.frost;
      const applied = applyDamage(
        ctx.rng,
        {
          hp: target.hp,
          ht: target.ht,
          paralysed: target.buffs.paralysis !== undefined,
          immunities: target.immunities,
          resistances: target.resistances,
        },
        amount,
        source,
      );
      target.hp = applied.hp;
      if (applied.paralysisBroken) {
        delete target.buffs.paralysis;
      }
      // The death pipeline runs at the strike-site checkpoints
      // (killMob / hero-death line), not here — vanilla's die() likewise
      // fires inside damage(), before the attack sequence resumes.
    },
    heal: (target, amount) => {
      const before = target.hp;
      target.hp = Math.min(target.ht, target.hp + amount);
      return target.hp - before;
    },
    attackerDamageRoll: (attacker) => {
      // Luck.java: attacker.damageRoll(). Only the hero carries
      // enchantments in the port's combat paths; the mob branch exists for
      // structural completeness of the ProcChar contract.
      if (attacker.kind === 'hero') {
        return heroDamageRoll(ctx.rng, hero, { ranged: false });
      }
      const mob = attacker as unknown as ContentMob;
      return ctx.rng.intRange(mob.def.dmgMin, mob.def.dmgMax);
    },
    showStatus: (_target, _text) => {
      // CharSprite.showStatus floating text: renderer-owned, no port seam.
    },
    isWater: (pos) => level.getAt(pos) === Terrain.WATER,
    charsAround: (pos) => {
      const { x, y } = level.xy(pos);
      const out: ProcChar[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
          const ch = charAtPos(ny * level.w + nx);
          if (ch) out.push(ch);
        }
      }
      return out;
    },
    isFreeCell: (pos) => {
      const { x, y } = level.xy(pos);
      // Bounce.java: (Level.passable || Level.avoid) && findChar == null.
      // The port's isPassable covers avoid (NpcMob.throwItem comment).
      return level.isPassable(x, y) && unoccupied(pos);
    },
    isVisible: (pos) => level.visible[pos] === 1,
    // Displacement.java: `if (!Dungeon.bossLevel())` (level.bossLevel is
    // set by the generator, generator.ts:591).
    isBossLevel: () => level.bossLevel,
    teleport: (ch, pos) => {
      ch.pos = pos;
      // WandOfBlink.appear visuals + Dungeon.observe(): renderer/engine
      // owned (FOV recomputes per action in the port).
    },
    pressCell: (ch) => {
      // Level.press(cell, ch): traps/pits under the landing cell
      // (Bounce.java:53, Displacement.java:57).
      const noop = (): void => undefined;
      if (ch.kind === 'hero') {
        pressTrapCell(ctx, ch.pos, hero, noop);
      } else {
        mobPressTrapCell(ctx, ch as unknown as TrapMob, noop);
      }
    },
    seedGas: (pos, amount) => {
      // Stench.java: GameScene.add(Blob.seed(pos, 20, ToxicGas.class)).
      seedBlob(level.blobs, 'toxic', pos, amount, level.w * level.h);
    },
    spawnMirrorImage: (_heroChar) => {
      // Multiplicity.java: new MirrorImage() + WandOfBlink.appear. The
      // port has no MirrorImage mob class yet (Stage-2 seam); the glyph
      // then skips its self-damage too (both are inside the same branch).
      return false;
    },
    spendGold: (amount) => {
      // AutoRepair.java: Dungeon.gold >= armor.tier.
      if (hero.gold < amount) return false;
      hero.gold -= amount;
      return true;
    },
    polishHeroArmor: () => {
      // Folded into armorDefenseProc's direct polish (same object).
    },
    addHunger: (amount) => {
      // Hunger.satisfy(-amount): the level rises by amount, clamped to
      // [0, STARVING] (hunger.ts satisfy).
      hero.hungerLevel = satisfy(hero.hungerLevel, -amount);
    },
    isStarving: () => isStarving(hero.hungerLevel),
  };
}

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
    // Hero.attackProc (Hero.java:845-853): the enchantment proc runs at
    // Char.attack step 5 (inside the sequence, before damage application).
    onAttackProc: (_r, dmg) => {
      const wep = hero.rangedWeapon ?? hero.weapon;
      if (wep) {
        if (wep === hero.weapon && hero.weaponId === 'pickaxe') {
          // Pickaxe.proc (Pickaxe.java:29-36) overrides Weapon.proc: a
          // pickaxe strike skips ordinary enchantment, identification,
          // and durability procs. The blood-stain check runs after
          // damage application (below).
        } else {
          const fx = combatProcFx(ctx);
          weaponAttackProc(fx, hero, mob, dmg, wep);
        }
      }
      return dmg;
    },
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
    // Pickaxe.proc (Pickaxe.java:29-36): a lethal strike against a bat
    // blood-stains the pickaxe (the blacksmith's blood quest).
    if (mob.def.id === 'bat' && hero.weaponId === 'pickaxe' && hero.weapon) {
      hero.weapon.bloodStained = true;
    }
  } else {
    // Mob.damage subclass hooks (Brute.damage enrage, Brute.java:173-184).
    mob.onDamaged(ctx);
  }
}

/**
 * Mob-vs-mob strike (Char.attack, Char.java:128-186): the bee's sting
 * against a hostile mob, or a bee-aggroed mob striking back at the bee.
 * Mirrors strikeHeroVsMob with the defender's mobDefenseSkill() and
 * vanilla Mob.damage wake/alert (Mob.java:328-337); invulnerable NPCs
 * (sad ghost, wandmaker) take no damage (NPC.damage no-op, NPC.java:33-37)
 * — the bee inherits this from NPC in vanilla too (Bee extends NPC).
 */
export function strikeMobVsMob(
  ctx: ActionContext,
  attacker: ContentMob,
  defender: ContentMob,
  accuracy: number,
  damageRoll: (rng: MechanicsRng) => number,
  onAttackProc?: (rng: MechanicsRng, damage: number) => number,
): void {
  const rng = ctx.rng;
  const seq = runAttackSequence(rng, {
    accuracy,
    evasion: defender.mobDefenseSkill(),
    defenderDr: defender.def.dr,
    damageRoll,
    onAttackProc,
    onDefenseProc: (_r, dmg) => mobDefenseProc(ctx, defender, dmg),
  });
  if (!seq.hit) {
    // Char.attack miss: the defender's defense verb (Char.java:196-203).
    ctx.log(`The ${attacker.name} misses the ${defender.name}.`);
    return;
  }
  if (defender.invulnerable) {
    // Vanilla NPC.damage() is a no-op (NPC.java:33-37).
    ctx.log(`The ${attacker.name} hits the ${defender.name}, but does no damage.`);
    return;
  }
  const applied = applyDamage(
    rng,
    {
      hp: defender.hp,
      ht: defender.ht,
      paralysed: defender.paralysed,
      immunities: defender.immunities,
      resistances: defender.resistances,
    },
    seq.damageDealt,
  );
  defender.hp = applied.hp;
  if (applied.paralysisBroken) {
    defender.paralysed = false;
    delete defender.buffs.paralysis;
  }
  ctx.log(
    seq.damageDealt > 0
      ? `The ${attacker.name} hits the ${defender.name} for ${seq.damageDealt}.`
      : `The ${attacker.name} hits the ${defender.name}, but does no damage.`,
  );
  if (applied.died) {
    killMob(ctx, defender, {});
  } else {
    // Mob.damage wake/alert (Mob.java:328-337) + subclass hooks.
    if (defender.state === 'sleeping') defender.state = 'wandering';
    defender.justAlerted = true;
    defender.onDamaged(ctx);
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
    // Hero.defenseProc (Hero.java:855-865): Earthroot absorption, then the
    // armor glyph proc, then Armor.use() — at Char.attack step 6.
    onDefenseProc: (_r, dmg) => {
      if (!hero.armor) return dmg;
      return armorDefenseProc(
        combatProcFx(ctx),
        hero.armor,
        mob,
        hero,
        dmg,
        ctx.level.w,
        ctx.level.h,
      );
    },
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
  // A glyph proc (Potential) can kill the attacker mid-sequence; vanilla
  // runs Mob.die() inside that lightning damage (Potential.java:42-50).
  if (!mob.isAlive()) {
    killMob(ctx, mob, {});
  }
}

// ---------------------------------------------------------------------------
// Stage 2: MirrorImage — moved from scrolls.ts to break the
// items -> scrolls -> mobs -> items import cycle (the class extends
// ContentMob, which must be initialized at class-definition time).
// ---------------------------------------------------------------------------

export interface MirrorImageStats {
  attackSkill: number;
  damage: number;
}

/**
 * MirrorImage mob (actors/mobs/npcs/MirrorImage.java): a friendly NPC
 * copy of the hero. attackSkill = hero.attackSkill(hero); damageRoll =
 * hero.damageRoll() (fixed at spawn). state = HUNTING; seeks hostile
 * mobs in the hero's field of view; destroys itself after its attack
 * lands (attackProc -> destroy).
 */
export class MirrorImageMob extends ContentMob {
  constructor(id: number, pos: number, w: number, stats: MirrorImageStats) {
    super(
      id,
      {
        id: 'mirrorimage',
        name: 'mirror image',
        sprite: 'mirror_image', // TODO(worker6): extract MirrorSprite frames
        hp: 1,
        atk: stats.attackSkill,
        def: 0,
        dmgMin: stats.damage,
        dmgMax: stats.damage,
        triangular: false,
        dr: 0,
        exp: 0,
        maxLvl: 0,
        speed: 1, // Mob default (Mob.java)
        flying: false,
        ability: null,
        attackDelay: 1,
        immunities: [],
        resistances: [],
      },
      pos,
      w,
    );
    this.hostile = false;
    this.state = 'hunting';
  }

  /**
   * MirrorImage.attackProc (MirrorImage.java:85-92): the image shatters
   * after its attack lands. Called by the mob combat pipeline (Worker 2);
   * until then the images persist.
   */
  shatterAfterAttack(): void {
    this.hp = 0;
  }
}
