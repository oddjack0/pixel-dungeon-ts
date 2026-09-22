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
import type { ContentHero, ItemStack } from './hero.js';
import { addToInventory, removeFromInventory } from './hero.js';
import { getItem, ITEMS } from './items.js';

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
  ability: 'swarm' | 'skeleton' | 'thief' | null;
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
 * (Ooze.java:39-50), and Paralysis countdown (Paralysis.java:26).
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
  if (b.paralysis) {
    b.paralysis.left -= 1;
    if (b.paralysis.left <= 0) {
      delete b.paralysis;
      ch.paralysed = false;
    }
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

    const hero = heroOf(ctx);
    const enemyInFOV =
      hero.isAlive() && this.canSee(ctx, hero.pos); // Level.fieldOfView (Mob.java:157-159)

    switch (this.state) {
      case 'sleeping':
        return this.actSleeping(ctx, hero.pos, enemyInFOV);
      case 'wandering':
        return this.actWandering(ctx, hero.pos, enemyInFOV, justAlerted);
      case 'hunting':
        return this.actHunting(ctx, hero, enemyInFOV);
      case 'fleeing':
        return this.actFleeing(ctx, hero.pos, enemyInFOV);
      case 'passive':
      default:
        this.enemySeen = false;
        return this.waitCost();
    }
  }

  /** Hook: shown when the mob notices the hero (Goo yells). */
  protected onNotice(_ctx: ActionContext): void {
    // base mobs: sprite alert only (no text in vanilla)
  }

  /** Hook after any successful move (Goo seals the arena). */
  protected afterMove(_ctx: ActionContext, _oldPos: number): void {
    // mobPress (trap triggering) is a later milestone
  }

  /** Hook on death, after EXP/loot (Goo unseals + drops the skeleton key). */
  onDeath(_ctx: ActionContext): void {
    // base mobs: nothing
  }

  /** canAttack(enemy) (Mob.java:226-228); Goo overrides. */
  canAttack(targetPos: number): boolean {
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
    hero: ContentHero,
    enemyInFOV: boolean,
  ): number {
    // Hunting.act (Mob.java:479-513)
    this.enemySeen = enemyInFOV;
    if (enemyInFOV && this.canAttack(hero.pos)) {
      return this.doAttack(ctx, hero);
    }
    if (enemyInFOV) {
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
    strikeMobVsHero(ctx, this, hero, this.def.atk, (rng) => this.mobDamageRoll(rng));
    return this.attackCost(); // spend(attackDelay())
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
}

/** Build a live mob from a resolved spawn (spawns.ts) or a save blob. */
export function buildMob(mobId: string, id: number, pos: number, w: number): ContentMob {
  if (mobId === 'goo') {
    // Goo lives in goo-boss.ts; it registers itself here to avoid a cycle.
    const ctor = gooCtor;
    if (!ctor) throw new Error('goo-boss not registered (import src/content/goo-boss.js)');
    return new ctor(id, pos, w);
  }
  const def = MOB_DEFS[mobId];
  if (!def) throw new Error(`unknown mob id: ${mobId}`);
  if (mobId === 'thief') return new ThiefMob(id, def, pos, w);
  return new ContentMob(id, def, pos, w);
}

/** Goo constructor registration (avoids a goo-boss <-> mobs import cycle). */
type GooCtor = new (id: number, pos: number, w: number) => ContentMob;
let gooCtor: GooCtor | null = null;
export function registerGoo(ctor: GooCtor): void {
  gooCtor = ctor;
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
      clone.state = 'hunting'; // Swarm.java:95
      clone.generation = mob.generation + 1; // Swarm.split, Swarm.java:112-121
      clone.enemySeen = true;
      if (mob.buffs.burning) clone.buffs.burning = { kind: 'burning', left: 8 };
      if (mob.buffs.poison) clone.buffs.poison = { kind: 'poison', left: 2 };
      mob.hp -= clone.hp; // Swarm.java:101
      ctx.addMob(clone, 1); // GameScene.add(clone, SPLIT_DELAY=1), Swarm.java:101
      ctx.log('The swarm splits!');
    }
  }
  if (mob.def.ability === 'thief' && mob.state === 'fleeing') {
    dropItemAt(ctx, mob.pos, 'gold:1'); // Thief.java:114-121
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
  if (applied.died) killMob(ctx, mob, {});
}

/**
 * Full mob death pipeline: EXP (Mob.destroy, Mob.java:343-369),
 * loot (Mob.die -> dropLoot, Mob.java:371-398), skeleton burst AFTER
 * (Skeleton.die calls super.die first, Skeleton.java:54-76), then removal.
 */
export function killMob(ctx: ActionContext, mob: ContentMob, _opts: object): void {
  const hero = heroOf(ctx);
  const wasAlive = hero.isAlive();

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
    case 'skeleton':
      // Random.Int(5) == 0 -> random weapon, best of 3 (Skeleton.java:78-88);
      // M1: the only weapon is the short sword.
      if (rng.int(0, 5) === 0) {
        dropItemAt(ctx, mob.pos, 'shortsword');
      }
      break;
    // crab: MysteryMeat 0.167 (Crab.java:40-41) — no M1 mechanics; skipped.
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
    ctx.log(`You miss the ${mob.name}.`);
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
  if (applied.died) killMob(ctx, mob, {});
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
