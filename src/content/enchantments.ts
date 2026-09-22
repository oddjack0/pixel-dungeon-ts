/**
 * Weapon enchantments — exact port of
 * items/weapon/enchantments/*.java (watabou/pixel-dungeon).
 *
 * Vanilla shape: Weapon.proc(attacker, defender, damage) (Weapon.java:61-77)
 * runs the enchantment proc first, then Item.use(). The enchantment's
 * boolean return is ignored there; the level used is
 * `Math.max(0, weapon.effectiveLevel())` (each enchantment recomputes it).
 *
 * Proc context: enchantments need more than a damage number (buffs, direct
 * damage, healing, positions, water, floating text). Those world effects
 * arrive through ProcFx, implemented by the content layer (mobs.ts), so
 * this module stays deterministic and unit-testable. Pure RNG flows through
 * MechanicsRng (the single run-wide stream).
 *
 * Buff attach semantics mirror Buff.java exactly:
 * - affect(ch, kind, duration): attach if absent, then EXTEND remaining by
 *   duration (affect + spend, Buff.java:79-83).
 * - prolong(ch, kind, duration): attach if absent, else remaining =
 *   max(remaining, duration) (affect + postpone, Buff.java:85-89).
 * - Buff.attachTo refuses when the target is immune (immunity tag check).
 * The port has no RingOfElements yet, so every durationFactor is 1
 * (Vertigo/Frost/Charm/Poison durationFactor, *.java).
 */

import type { MechanicsRng } from '../mechanics/rng.js';
import type { BuffKind } from '../mechanics/buffs.js';
import {
  effectiveLevel,
  polish,
  TXT_GOING_TO_BREAK,
  TXT_HAS_BROKEN,
  useDurability,
} from '../mechanics/durability.js';

/** Vanilla Weapon.Enchantment subclasses (Weapon.java:227-231). */
export type EnchantmentId =
  | 'death'
  | 'fire'
  | 'horror'
  | 'instability'
  | 'leech'
  | 'luck'
  | 'paralysis'
  | 'poison'
  | 'shock'
  | 'slow'
  | 'tempering';

/**
 * Enchantment order, inscription names and weights — the `enchants` table and
 * `chances` array (Weapon.java:227-231):
 * Fire 10, Poison 10, Death 1, Paralysis 2, Leech 1, Slow 2, Shock 6,
 * Instability 3, Horror 2, Luck 2, Tempering 3.
 */
const ENCHANTMENT_ORDER: EnchantmentId[] = [
  'fire',
  'poison',
  'death',
  'paralysis',
  'leech',
  'slow',
  'shock',
  'instability',
  'horror',
  'luck',
  'tempering',
];

export const ENCHANTMENT_INFO: Record<
  EnchantmentId,
  { name: string; weight: number }
> = {
  fire: { name: 'blazing', weight: 10 },
  poison: { name: 'venomous', weight: 10 },
  death: { name: 'grim', weight: 1 },
  paralysis: { name: 'stunning', weight: 2 },
  leech: { name: 'vampiric', weight: 1 },
  slow: { name: 'chilling', weight: 2 },
  shock: { name: 'shocking', weight: 6 },
  instability: { name: 'unstable', weight: 3 },
  horror: { name: 'eldritch', weight: 2 },
  luck: { name: 'lucky', weight: 2 },
  tempering: { name: 'tempered', weight: 3 },
};

/**
 * Weapon.Enchantment.random() (Weapon.java:237-244): weighted draw via
 * Random.chances (first index whose cumulative weight exceeds a uniform
 * [0, total) roll).
 */
export function randomEnchantmentId(rng: MechanicsRng): EnchantmentId {
  let total = 0;
  for (const id of ENCHANTMENT_ORDER) total += ENCHANTMENT_INFO[id].weight;
  const roll = rng.float(0, total);
  let acc = 0;
  for (const id of ENCHANTMENT_ORDER) {
    acc += ENCHANTMENT_INFO[id].weight;
    if (roll < acc) return id;
  }
  return ENCHANTMENT_ORDER[ENCHANTMENT_ORDER.length - 1]!;
}

/** Buff instance state touched by procs (extends the mechanics BuffState). */
export interface ProcBuff {
  kind: BuffKind;
  left: number;
  /** Charm/Terror object: the other char's id (Charm.java / Terror.java). */
  sourceId?: number;
  /** Counter payloads: Viscosity deferred pool, Earthroot armor level. */
  amount?: number;
}

/**
 * A combatant as seen by enchantment/glyph procs. ContentHero and
 * ContentMob both satisfy this structurally (buffs carry the extended
 * ProcBuff fields via BuffState.sourceId/amount).
 */
export interface ProcChar {
  readonly id: number;
  /** 'hero' on the hero (ContentHero.kind); mobs carry no kind. */
  readonly kind?: string;
  pos: number;
  readonly x: number;
  readonly y: number;
  hp: number;
  ht: number;
  flying: boolean;
  buffs: Partial<Record<BuffKind, ProcBuff>>;
  immunities: string[];
  resistances: string[];
}

/**
 * World effects a proc may trigger, provided by the content layer.
 * Every entry maps to a concrete vanilla call; visuals with no port seam
 * (lightning arcs, emitters, camera shake) are renderer-owned and omitted.
 */
export interface ProcFx {
  rng: MechanicsRng;
  log(msg: string): void;
  /**
   * Char.damage without the attack-sequence wrapper (Char.java:260-300):
   * frost detaches on any damage, then immunity/resistance, then HP.
   * Writes the result back to the live char. Death pipeline runs at the
   * strike-site checkpoints (killMob / hero-death line), not here —
   * vanilla's die() likewise happens inside damage(), i.e. before the
   * attack sequence resumes.
   */
  directDamage(target: ProcChar, amount: number, source: string): void;
  /** Heal up to HT. Returns the actual amount healed. */
  heal(target: ProcChar, amount: number): number;
  /** The attacker's own damage roll (Luck: attacker.damageRoll()). */
  attackerDamageRoll(attacker: ProcChar): number;
  /** Floating combat text (Luck: CharSprite.showStatus POSITIVE). */
  showStatus(target: ProcChar, text: string): void;
  /** Level.water[pos] (Shock doubles in water when not flying). */
  isWater(pos: number): boolean;
  /** Chars in the 8-neighborhood of pos (Shock chaining). */
  charsAround(pos: number): ProcChar[];
  /** Passable/avoid and unoccupied (Bounce landing, Displacement target). */
  isFreeCell(pos: number): boolean;
  /** Dungeon.visible[pos] (Displacement target legality). */
  isVisible(pos: number): boolean;
  /** Dungeon.bossLevel() (Displacement never procs on boss levels). */
  isBossLevel(): boolean;
  /** WandOfBlink.appear: relocate the char (visuals renderer-owned). */
  teleport(ch: ProcChar, pos: number): void;
  /** Level.press for a char landing on a cell (Bounce). */
  pressCell(ch: ProcChar): void;
  /** Seed a gas blob (Stench: 20 ToxicGas at the attacker). */
  seedGas(pos: number, amount: number): void;
  /** Materialize a MirrorImage for the hero (Multiplicity); false when the
   *  mob system cannot spawn one (no MirrorImage class in the port yet). */
  spawnMirrorImage(hero: ProcChar): boolean;
  /** Spend hero gold; false if insufficient (AutoRepair). */
  spendGold(amount: number): boolean;
  /** Polish the hero's equipped armor (AutoRepair). */
  polishHeroArmor(): void;
  /** Raise the hero's hunger level (Metabolism worsens by STARVING/10). */
  addHunger(amount: number): void;
  /** Whether the hero is starving (Metabolism requires non-starving). */
  isStarving(): boolean;
}

/** Buff.attachTo immunity gate (Buff.java:41-62). */
function immune(ch: ProcChar, kind: BuffKind): boolean {
  return ch.immunities.includes(kind);
}

/**
 * Buff.affect(target, cls) + spend(duration) (Buff.java:79-83): attach if
 * absent, then EXTEND the remaining time by duration.
 */
export function affectBuff(
  ch: ProcChar,
  kind: BuffKind,
  duration: number,
  extra?: { sourceId?: number; amount?: number },
): void {
  if (immune(ch, kind)) return;
  const b = ch.buffs[kind];
  if (b) {
    b.left += duration;
    if (extra?.sourceId !== undefined) b.sourceId = extra.sourceId;
    if (extra?.amount !== undefined) b.amount = extra.amount;
  } else {
    ch.buffs[kind] = { kind, left: duration, ...extra };
  }
}

/**
 * Buff.prolong(target, cls, duration) (Buff.java:85-89): attach if absent,
 * else remaining = max(remaining, duration).
 */
export function prolongBuff(
  ch: ProcChar,
  kind: BuffKind,
  duration: number,
  extra?: { sourceId?: number; amount?: number },
): void {
  if (immune(ch, kind)) return;
  const b = ch.buffs[kind];
  if (b) {
    if (b.left < duration) b.left = duration;
    if (extra?.sourceId !== undefined) b.sourceId = extra.sourceId;
    if (extra?.amount !== undefined) b.amount = extra.amount;
  } else {
    ch.buffs[kind] = { kind, left: duration, ...extra };
  }
}

/** Burning.reignite(): duration reset to BURNING_DURATION (Burning.java). */
export function reigniteBurning(ch: ProcChar, duration: number): void {
  if (immune(ch, 'burning')) return;
  ch.buffs['burning'] = { kind: 'burning', left: duration };
}

/** Vertigo.duration(ch) (Vertigo.java): Resistance factor x DURATION(10);
 *  the port has no RingOfElements, so always 10. */
export const VERTIGO_DURATION = 10;
/** Terror.DURATION (Terror.java:26). */
export const TERROR_DURATION = 10;
/** Frost duration base (Frost.java:31, DURATION = 5, x durationFactor). */
export const FROST_DURATION = 5;

// ---------------------------------------------------------------------------
// Individual enchantment procs (items/weapon/enchantments/*.java)
// ---------------------------------------------------------------------------

/**
 * Death / grim (Death.java:26-41): unless the (non-hero) defender is immune
 * to Death, `Random.Int(level + 100) >= 92` deals the defender's full
 * current HP as direct damage.
 */
function deathProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  level: number,
): void {
  if (defender.kind !== 'hero' && defender.immunities.includes('death')) {
    return;
  }
  if (fx.rng.int(0, level + 100) >= 92) {
    fx.directDamage(defender, defender.hp, 'death');
    // Badges.validateGrimWeapon(): no badge system in the port.
  }
}

/**
 * Fire / blazing (Fire.java:26-39): `Random.Int(level + 3) >= 2`; then a
 * coin flip between reigniting Burning and direct `Random.Int(1, level+2)`
 * damage.
 */
function fireProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  _damage: number,
  level: number,
): void {
  if (fx.rng.int(0, level + 3) >= 2) {
    if (fx.rng.int(0, 2) === 0) {
      // Buff.affect(defender, Burning.class); buff.reignite() (Fire.java:32)
      reigniteBurning(defender, 8);
    } else {
      fx.directDamage(defender, fx.rng.int(1, level + 2), 'fire');
    }
  }
}

/**
 * Horror / eldritch (Horror.java:26-42): `Random.Int(level + 5) >= 4`.
 * Hero defender: Vertigo (affect, i.e. extended). Other defenders: Terror
 * for TERROR_DURATION with the attacker as its object.
 */
function horrorProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  level: number,
): void {
  if (fx.rng.int(0, level + 5) >= 4) {
    if (defender.kind === 'hero') {
      affectBuff(defender, 'vertigo', VERTIGO_DURATION);
    } else {
      affectBuff(defender, 'terror', TERROR_DURATION, {
        sourceId: attacker.id,
      });
    }
  }
}

/**
 * Leech / vampiric (Leech.java:26-40): heals
 * min(Random.IntRange(0, damage*(level+2)/(level+6)), missing HP).
 */
function leechProc(
  fx: ProcFx,
  attacker: ProcChar,
  _defender: ProcChar,
  damage: number,
  level: number,
): void {
  const maxValue = Math.floor((damage * (level + 2)) / (level + 6));
  const healed = fx.heal(
    attacker,
    Math.min(fx.rng.intRange(0, maxValue), attacker.ht - attacker.hp),
  );
  void healed;
  // Speck.HEALING emitter: visual, renderer-owned.
}

/**
 * Luck / lucky (Luck.java:26-44): for i in 1..level+1, compare the running
 * best against attacker.damageRoll() - i; deal any positive difference as
 * direct damage with a floating status number.
 */
function luckProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): void {
  let best = damage;
  for (let i = 1; i <= level + 1; i++) {
    const roll = fx.attackerDamageRoll(attacker) - i;
    if (roll > best) best = roll;
  }
  if (best > damage) {
    fx.directDamage(defender, best - damage, 'luck');
    fx.showStatus(defender, `+${best - damage}`);
  }
}

/**
 * Paralysis / stunning (Paralysis.java:26-36): `Random.Int(level + 8) >= 7`
 * prolongs Paralysis by Random.Float(1, 1.5 + level).
 */
function paralysisProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  level: number,
): void {
  if (fx.rng.int(0, level + 8) >= 7) {
    prolongBuff(defender, 'paralysis', fx.rng.float(1, 1.5 + level));
  }
}

/**
 * Poison / venomous (Poison.java:26-37): `Random.Int(level + 3) >= 2` sets
 * Poison to durationFactor * (level + 1) (Poison.set overwrites).
 */
function poisonProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  level: number,
): void {
  if (fx.rng.int(0, level + 3) >= 2) {
    if (immune(defender, 'poison')) return;
    defender.buffs['poison'] = { kind: 'poison', left: 1 * (level + 1) };
  }
}

/**
 * Shock / shocking (Shock.java:26-84): `Random.Int(level + 4) >= 3`.
 * Lightning strikes the defender for Random.Int(1, damage/2) (doubled in
 * water when not flying), then chains to one random adjacent not-yet-struck
 * char for Random.Int(damage/2, damage), recursively.
 */
function shockProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): void {
  if (fx.rng.int(0, level + 4) >= 3) {
    const affected = new Set<number>();
    const hit = (ch: ProcChar, dmg: number): void => {
      affected.add(ch.id);
      // Random.Int(1, damage / 2): Java int division first.
      let amount = fx.rng.int(1, Math.floor(dmg / 2));
      if (!ch.flying && fx.isWater(ch.pos)) {
        amount *= 2;
      }
      fx.directDamage(ch, amount, 'lightning');
      // Lightning arcs between cells: visual, renderer-owned.
      const candidates = fx
        .charsAround(ch.pos)
        .filter((c) => !affected.has(c.id));
      if (candidates.length > 0) {
        const next = candidates[fx.rng.int(0, candidates.length)]!;
        hit(next, fx.rng.int(Math.floor(dmg / 2), dmg));
      }
    };
    hit(defender, damage);
  }
}

/**
 * Slow / chilling (Slow.java:26-36): `Random.Int(level + 4) >= 3`
 * prolongs Slow by Random.Float(1, 1.5 + level). The speed effect lives in
 * Char.spend's time scale (charTimeScale, Char.java:303-314).
 */
function slowProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  level: number,
): void {
  if (fx.rng.int(0, level + 4) >= 3) {
    prolongBuff(defender, 'slow', fx.rng.float(1, 1.5 + level));
  }
}

/**
 * Tempering / tempered (Tempering.java:26-33): weapon.polish() on every
 * proc — +1 durability up to the maximum.
 */
function temperingProc(
  weapon: { durability?: number; level: number },
): void {
  polish(weapon, 'weapon');
}

/** Dispatch one enchantment proc (Instability recurses into random()). */
function runEnchantment(
  fx: ProcFx,
  id: EnchantmentId,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
  weapon: { durability?: number; level: number },
): void {
  switch (id) {
    case 'death':
      deathProc(fx, attacker, defender, level);
      break;
    case 'fire':
      fireProc(fx, attacker, defender, damage, level);
      break;
    case 'horror':
      horrorProc(fx, attacker, defender, level);
      break;
    case 'instability':
      // Instability.proc (Instability.java:29-31): random().proc(...) —
      // the pool includes Instability itself.
      runEnchantment(
        fx,
        randomEnchantmentId(fx.rng),
        attacker,
        defender,
        damage,
        level,
        weapon,
      );
      break;
    case 'leech':
      leechProc(fx, attacker, defender, damage, level);
      break;
    case 'luck':
      luckProc(fx, attacker, defender, damage, level);
      break;
    case 'paralysis':
      paralysisProc(fx, attacker, defender, level);
      break;
    case 'poison':
      poisonProc(fx, attacker, defender, level);
      break;
    case 'shock':
      shockProc(fx, attacker, defender, damage, level);
      break;
    case 'slow':
      slowProc(fx, attacker, defender, level);
      break;
    case 'tempering':
      temperingProc(weapon);
      break;
  }
}

/** Per-instance weapon state needed by Weapon.proc. */
export interface ProcWeapon {
  name: string;
  level: number;
  durability?: number;
  enchantment?: EnchantmentId | null;
}

/**
 * Weapon.enchant() (Weapon.java:215-226): assign a random enchantment,
 * re-rolling while the new class equals the old one — the enchantment
 * always changes.
 */
export function enchantWeaponInstance(
  rng: MechanicsRng,
  weapon: { enchantment?: EnchantmentId | null },
): EnchantmentId {
  let id = randomEnchantmentId(rng);
  let guard = 0;
  while (id === weapon.enchantment && guard++ < 100) {
    id = randomEnchantmentId(rng);
  }
  weapon.enchantment = id;
  return id;
}

/**
 * Weapon.proc (Weapon.java:61-77): run the enchantment (if any), then
 * Item.use(). `levelKnown` gates the durability log lines (the port has no
 * identification system — gear is always identified).
 */
export function weaponAttackProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  weapon: ProcWeapon,
): void {
  const level = effectiveLevel(weapon);
  if (weapon.enchantment) {
    runEnchantment(fx, weapon.enchantment, attacker, defender, damage, level, weapon);
  }
  // hitsToKnow identification: the port has no ID system (always known).
  const used = useDurability(weapon, 'weapon', true);
  if (used.warned) {
    fx.log(TXT_GOING_TO_BREAK.replace('%s', weapon.name));
  }
  if (used.broke) {
    fx.log(TXT_HAS_BROKEN.replace('%s', weapon.name));
    // Dungeon.hero.interrupt() + Degradation visuals: the port has no
    // action queue and visuals are renderer-owned.
  }
}
