/**
 * Entity model for the mechanics layer.
 *
 * SPEC contract 4 (binding): `Char { id, pos, hp, ht, sprite, ... }`; `Hero`
 * and `Mob` extend it. The engine architect owns the game loop / scheduler;
 * combat math lives in combat.ts and operates on these types.
 *
 * Buffs are data here (`BuffState`); the engine ticks them (see buffs.ts,
 * hunger.ts) and the renderer reads `sprite` + buff flags for visuals.
 */
import type { BuffKind } from './buffs';
import type { HeroSubClass } from './subclasses.js';
import type { EnchantmentId } from '../content/enchantments.js';
import type { GlyphId } from '../content/glyphs.js';

/** Minimal buff instance attached to a Char. Engine schedules the ticks. */
export interface BuffState {
  kind: BuffKind;
  /** Remaining duration in time units (1 turn = 1.0). Used by Burning/Poison/Ooze etc. */
  left: number;
  /**
   * Buff-specific level (Bleeding.level, Bleeding.java): the bleed severity
   * re-rolled every tick. Only meaningful for kind 'bleeding'.
   */
  level?: number;
  /**
   * Buff object payload (Charm.object / Terror.object): the other char's
   * id. Carried on the state so content procs stay structural.
   */
  sourceId?: number;
  /**
   * Counter payload (Viscosity DeferredDamage pool / Earthroot armor level):
   * the accumulated/absorb integer.
   */
  amount?: number;
}

/** Base entity. Ports Char.java fields: pos (Char.java:58), HT/HP (63-64),
 *  paralysed/rooted/flying (68-70). */
export interface Char {
  /** Unique id for the run (matches Actor.id()). */
  id: number;
  /** Cell index in the level grid. */
  pos: number;
  /** Current hit points. Dead when <= 0 (Char.isAlive(), Char.java:335). */
  hp: number;
  /** Max hit points. */
  ht: number;
  /** Sprite key (art director's registry). */
  sprite: string;
  /** True while Paralysis/Frost holds the char (Paralysis.java:27-35). */
  paralysed: boolean;
  /** True while Roots holds the char (Roots.java:28-36). */
  rooted: boolean;
  /** True while levitating/flying (Char.java:70). */
  flying: boolean;
  /** Active buffs by kind. */
  buffs: Partial<Record<BuffKind, BuffState>>;
}

/** Weapon stats needed by combat formulas (min/max/STR/ACU/DLY). */
export interface WeaponDef {
  name: string;
  /** Melee tier (MeleeWeapon.tier); +1 max damage per upgrade level per tier
   *  (MeleeWeapon.max(): max0() + level() * tier, MeleeWeapon.java:55-57). */
  tier: number;
  /** Upgrade level (Item.level, Item.java:265-274). 0 for unupgraded gear. */
  level: number;
  /** Minimum damage die at level 0 (KindOfWeapon.min0()); effective min is
   *  min0 + level (MeleeWeapon.min(), MeleeWeapon.java:52-54). */
  min: number;
  /** Maximum damage die at level 0 (KindOfWeapon.max0()). */
  max: number;
  /** Strength requirement (Weapon.STR, Weapon.java:47). */
  str: number;
  /** Base accuracy factor (Weapon.ACU, Weapon.java:48). */
  acu: number;
  /** Base delay factor (Weapon.DLY, Weapon.java:49). */
  dly: number;
  /** True for MissileWeapon subclasses (Dart, etc.). */
  missile: boolean;
  /**
   * Per-instance weapon state (Weapon.java: enchantment is an instance
   * field; durability/curse too). Undefined = unenchanted / uninitialized.
   */
  enchantment?: EnchantmentId | null;
  durability?: number;
  cursed?: boolean;
  cursedKnown?: boolean;
  /** Pickaxe.Quest blood-stained (Pickaxe.java). */
  bloodStained?: boolean;
  /**
   * Item.isUpgradable() (Item.java): false for the pickaxe
   * (Pickaxe.isUpgradable, Pickaxe.java:110-112). Undefined = upgradable.
   */
  upgradable?: boolean;
}

/** Armor stats needed by combat formulas. */
export interface ArmorDef {
  name: string;
  /** Upgrade level (Item.level, Item.java:265-274). 0 for unupgraded gear. */
  level: number;
  /** Strength requirement (Armor.STR); -1 per upgrade
   *  (Armor.upgrade(), Armor.java:167). */
  str: number;
  /** Damage absorption cap at level 0 (Armor.DR() with level 0:
   *  tier * 2, Armor.java:145-147); effective DR is dr + level. */
  dr: number;
  /** Vanilla Armor.tier (Armor.java:46): DR per level + auto-repair cost. */
  tier: number;
  /**
   * Per-instance armor state (Armor.java: glyph is an instance field;
   * durability/curse too). Undefined = unglyphed / uninitialized.
   */
  glyph?: GlyphId | null;
  durability?: number;
  cursed?: boolean;
  cursedKnown?: boolean;
  /**
   * Item.isUpgradable() (Item.java): armor is always upgradable in vanilla.
   * Undefined = upgradable.
   */
  upgradable?: boolean;
}

/** The player character. Ports Hero.java fields. */
export interface Hero extends Char {
  kind: 'hero';
  /** Strength (Hero.java:159). Effective value is strEff() when weakened. */
  str: number;
  /** Weakened flag: effective STR = str - 2 (Hero.java:182-184). */
  weakened: boolean;
  /** Hero level (Hero.java:164). */
  lvl: number;
  /** Experience points toward next level (Hero.java:165). */
  exp: number;
  /** Base attack skill, +1 per level (Hero.java:139, 1030). Starts at 10. */
  attackSkill: number;
  /** Base defense skill, +1 per level (Hero.java:140, 1031). Starts at 5. */
  defenseSkill: number;
  /** Equipped melee weapon, or null when unarmed. */
  weapon: WeaponDef | null;
  /** Equipped armor, or null. */
  armor: ArmorDef | null;
  /** Currently-thrown missile weapon during a throw, else null
   *  (Hero.rangedWeapon, Hero.java:156; set by shoot(), Hero.java:246-254). */
  rangedWeapon: WeaponDef | null;
  /** Number of darts carried (stackable missile ammo). */
  darts: number;
  /**
   * Hero subclass (Hero.subClass, Hero.java:167; heroes/HeroSubClass.java).
   * 'none' until the Tome of Mastery is read (Stage 3). Mechanics live in
   * mechanics/subclasses.ts + mechanics/subclass_buffs.ts.
   */
  subClass: HeroSubClass;
}

/** Extension point for mobs. The content designer extends this with AI state
 *  and per-mob data (stats table below mirrors Mob.java fields). */
export interface Mob extends Char {
  kind: 'mob';
  /** Content key, e.g. 'rat', 'gnoll', 'goo'. */
  mobId: string;
  name: string;
  /** Attack skill (Mob subclasses' attackSkill()). */
  attack: number;
  /** Defense skill (Mob subclasses' defenseSkill). */
  defense: number;
  /** Damage absorption (Mob subclasses' dr()). */
  dr: number;
  /** Damage die bounds (Mob subclasses' damageRoll()). */
  dmgMin: number;
  dmgMax: number;
  /** True when the die is triangular (Random.NormalIntRange). */
  triangular: boolean;
  /** EXP granted on kill (Mob.EXP, Mob.java:68). */
  exp: number;
  /** Hero level above which no EXP is granted (Mob.maxLvl, Mob.java:69). */
  maxLvl: number;
  /** Source tags for immunity / resistance checks (Char.java:damage). */
  immunities: string[];
  resistances: string[];
}

/** Effective STR, accounting for Weakness (Hero.STR(), Hero.java:182-184). */
export function strEff(hero: Hero): number {
  return hero.weakened ? hero.str - 2 : hero.str;
}

/** Alive check (Char.isAlive(), Char.java:335). */
export function isAlive(ch: Char): boolean {
  return ch.hp > 0;
}

/**
 * Tempo/movement buff kinds from Char.java that sit outside the M1
 * BuffKind set in buffs.ts (Slow/Speed in Char.spend, Char.java:303-314;
 * Cripple in Char.speed, Char.java:247-249; Vertigo in Char.move,
 * Char.java:474-482). Kept as string keys here so char.ts never has to
 * widen the buffs.ts union; hasBuff() reads them via a string-key cast.
 */
export type TempoBuffKind = 'slow' | 'speed' | 'cripple' | 'vertigo';

/** True when the char carries the named buff (string-key read; see above). */
export function hasBuff(ch: Char, kind: TempoBuffKind | BuffKind): boolean {
  return (
    (ch.buffs as Partial<Record<string, BuffState>>)[kind] !== undefined
  );
}

/**
 * Time scale for spend() (Char.spend, Char.java:303-314):
 *   timeScale = 1; Slow -> x0.5; Speed -> x2.0; spend(time / timeScale).
 * So a slowed char is charged 2x time, a hasted char half. Both buffs at
 * once cancel out (0.5 * 2.0 = 1).
 */
export function charTimeScale(ch: Char): number {
  let timeScale = 1;
  if (hasBuff(ch, 'slow')) {
    timeScale *= 0.5;
  }
  if (hasBuff(ch, 'speed')) {
    timeScale *= 2.0;
  }
  return timeScale;
}

/**
 * Cripple factor (Char.speed, Char.java:247-249):
 *   speed() = cripple ? baseSpeed * 0.5 : baseSpeed.
 * M1 baseSpeed is 1 for the hero (Char.java:83); mobs multiply their own
 * def speed by this factor.
 */
export function crippleFactor(ch: Char): number {
  return hasBuff(ch, 'cripple') ? 0.5 : 1;
}

/**
 * Base char speed before hero armor encumbrance (Char.speed,
 * Char.java:247-249): baseSpeed (1) halved by Cripple.
 */
export function charSpeed(ch: Char): number {
  return crippleFactor(ch);
}
