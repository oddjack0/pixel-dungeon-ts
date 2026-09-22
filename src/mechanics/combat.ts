/**
 * Pure combat functions, ported from Char.java / Hero.java.
 *
 * Every function takes an explicit RNG and plain data; there are no side
 * effects except the returned result. The engine applies results to the world.
 *
 * Hit chance (Char.hit, Char.java:213-217):
 *   acuRoll = Random.Float(attacker.attackSkill(defender))
 *   defRoll = Random.Float(defender.defenseSkill(attacker))
 *   hit iff (magic ? acuRoll * 2 : acuRoll) >= defRoll
 *
 * Melee attack (Char.attack, Char.java:128-186):
 *   1. hit(this, enemy, false)
 *   2. dr  = Random.IntRange(0, enemy.dr())          (Char.java:143-144;
 *      the SNIPER subclass zero-dr branch is deferred to subclass hooks)
 *   3. dmg = damageRoll()
 *   4. effectiveDamage = max(dmg - dr, 0)             (Char.java:147)
 *   5. attackProc(enemy, effectiveDamage)             (Char.java:149)
 *   6. enemy.defenseProc(this, effectiveDamage)       (Char.java:150)
 *   7. enemy.damage(effectiveDamage, this)            (Char.java:151)
 *
 * Damage (Char.damage, Char.java:259-285):
 *   - immunities: dmg = 0; resistances: dmg = Random.IntRange(0, dmg)
 *     (Char.java:263-267)
 *   - paralysis break: if paralysed and Random.Int(dmg) >= Random.Int(HP),
 *     paralysis detaches (Char.java:269-275)
 *   - HP -= dmg; death at HP <= 0
 */
import type { MechanicsRng } from './rng';

/** Combat stats of one side of an attack. */
export interface CombatStats {
  /** attackSkill(target) */
  accuracy: number;
  /** defenseSkill(attacker) */
  evasion: number;
  /** dr() */
  dr: number;
}

export interface DamageTarget {
  hp: number;
  ht: number;
  paralysed: boolean;
  immunities: string[];
  resistances: string[];
}

export interface AttackOptions {
  /** Magic attacks double the accuracy roll (Char.hit, Char.java:216). M1: unused. */
  magic?: boolean;
  /** Tag of the damage source for immunity/resistance checks, e.g. 'ooze'. */
  sourceTag?: string;
  /** Hook for attackProc (Goo's Ooze etc.). Default: identity. */
  onAttackProc?: (rng: MechanicsRng, damage: number) => number;
  /** Hook for defenseProc (Swarm split etc.). Default: identity. */
  onDefenseProc?: (rng: MechanicsRng, damage: number) => number;
}

export interface AttackResult {
  hit: boolean;
  /** effectiveDamage after armor and procs (0 on miss). */
  damageDealt: number;
  /** Defender HP after the attack. */
  defenderHp: number;
  defenderDied: boolean;
  /** True if a damage hit snapped the defender out of paralysis. */
  paralysisBroken: boolean;
}

/** Pure hit roll (Char.hit, Char.java:213-217). */
export function hitRoll(
  rng: MechanicsRng,
  accuracy: number,
  evasion: number,
  magic = false,
): boolean {
  const acuRoll = rng.float(0, accuracy);
  const defRoll = rng.float(0, evasion);
  return (magic ? acuRoll * 2 : acuRoll) >= defRoll;
}

/** Pure damage application (Char.damage, Char.java:259-285). */
export function applyDamage(
  rng: MechanicsRng,
  target: DamageTarget,
  dmg: number,
  sourceTag?: string,
): { hp: number; died: boolean; paralysisBroken: boolean } {
  if (target.hp <= 0) return { hp: target.hp, died: true, paralysisBroken: false };

  if (sourceTag && target.immunities.includes(sourceTag)) {
    dmg = 0;
  } else if (sourceTag && target.resistances.includes(sourceTag)) {
    dmg = rng.intRange(0, dmg);
  }

  let paralysisBroken = false;
  if (target.paralysed) {
    // Char.java:269-275: Random.Int(dmg) >= Random.Int(HP) breaks paralysis.
    // Faithful even at dmg == 0 (Random.Int(0) = 0, so it breaks with P=1/HP).
    if (rng.int(0, dmg) >= rng.int(0, target.hp)) {
      paralysisBroken = true;
    }
  }

  const hp = target.hp - dmg;
  return { hp, died: hp <= 0, paralysisBroken };
}

/**
 * Full melee/ranged attack sequence (Char.attack, Char.java:128-186).
 * `damageRoll` supplies the attacker's damage die (already class/weapon aware).
 */
export function resolveAttack(
  rng: MechanicsRng,
  attacker: CombatStats,
  defender: CombatStats & DamageTarget,
  damageRoll: (rng: MechanicsRng) => number,
  opts: AttackOptions = {},
): AttackResult {
  if (!hitRoll(rng, attacker.accuracy, defender.evasion, opts.magic ?? false)) {
    return {
      hit: false,
      damageDealt: 0,
      defenderHp: defender.hp,
      defenderDied: defender.hp <= 0,
      paralysisBroken: false,
    };
  }

  const dr = rng.intRange(0, defender.dr);
  const dmg = damageRoll(rng);
  let effective = Math.max(dmg - dr, 0);
  effective = opts.onAttackProc ? opts.onAttackProc(rng, effective) : effective;
  effective = opts.onDefenseProc ? opts.onDefenseProc(rng, effective) : effective;

  const applied = applyDamage(rng, defender, effective, opts.sourceTag);
  return {
    hit: true,
    damageDealt: effective,
    defenderHp: applied.hp,
    defenderDied: applied.died,
    paralysisBroken: applied.paralysisBroken,
  };
}

/** Skeleton death burst (Skeleton.die, Skeleton.java:57-71):
 *  damage = max(0, damageRoll() - Random.IntRange(0, ch.dr() / 2))
 *  to every adjacent living char. M1: engine triggers it on skeleton death. */
export function skeletonDeathBurst(
  rng: MechanicsRng,
  damageRoll: (rng: MechanicsRng) => number,
  victimDr: number,
): number {
  return Math.max(0, damageRoll(rng) - rng.intRange(0, Math.floor(victimDr / 2)));
}
