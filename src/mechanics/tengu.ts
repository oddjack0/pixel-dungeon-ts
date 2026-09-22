/**
 * Tengu, the Prison boss (depth 10) — pure stat constants and decision
 * helpers. Turn logic lives in src/content/tengu-boss.ts.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/Tengu.java.
 * Java wins every conflict.
 *
 * Stat constants (Tengu.java:51-75):
 *   HP = HT = 120, EXP = 20, defenseSkill = 20, dr() = 5,
 *   damageRoll = NormalIntRange(8, 15), attackSkill = 20,
 *   maxLvl default 30 (Mob.java:69 — Tengu does not override it),
 *   resistances: ToxicGas, Poison, Death, ScrollOfPsionicBlast
 *   (Tengu.java:183-189; damage halved, not negated — Char.damage).
 * Name: "Tengu" if depth == deepestFloor else "memory of Tengu"
 *   (Tengu.java:52; deepestFloor tracking lands with the meta systems).
 *
 * Jump (Tengu.java:49, 134-168): JUMP_DELAY = 5, timeToJump starts at 5.
 *   getCloser: if the target cell is in the HERO's FOV (Level.fieldOfView
 *     is the hero's — Mob.act / Tengu.java:110) Tengu jumps instead of
 *     walking. doAttack: timeToJump-- each attack; when it reaches 0 AND
 *     the enemy is adjacent, Tengu jumps instead of striking
 *     (Tengu.java:124-132). jump() itself resets timeToJump and spends
 *     1/speed() (Tengu.java:135, 167); the doAttack jump branch does NOT
 *     additionally spend attackDelay().
 *   Each jump also converts up to 4 INACTIVE_TRAP tiles (in hero FOV,
 *   passable) into revealed POISON_TRAPs (Tengu.java:137-148), then
 *   relocates to a random hero-visible passable cell that is not adjacent
 *   to the enemy and holds no char (Tengu.java:150-157).
 */
import type { MechanicsRng } from './rng';

export const TENGU_HT = 120;
export const TENGU_EXP = 20;
export const TENGU_DEFENSE = 20;
export const TENGU_DR = 5;
export const TENGU_ATTACK = 20;
/** Damage die (Tengu.damageRoll, Tengu.java:63-65). */
export const TENGU_DMG_MIN = 8;
export const TENGU_DMG_MAX = 15;
/** Tengu does not override maxLvl (Mob.java:69 default). */
export const TENGU_MAX_LVL = 30;
/** Jump cadence (Tengu.JUMP_DELAY, Tengu.java:49). */
export const TENGU_JUMP_DELAY = 5;
/** Traps armed per jump (Tengu.jump, Tengu.java:137). */
export const TENGU_TRAPS_PER_JUMP = 4;
/**
 * Source tags halved by Tengu's resistances (Tengu.java:183-189).
 * Tag naming follows the codebase convention ('death', 'toxic_gas',
 * 'psionic_blast'; poison ticks already carry the 'poison' tag).
 */
export const TENGU_RESISTANCES = [
  'toxic_gas',
  'poison',
  'death',
  'psionic_blast',
] as const;

/** Tengu damage die (Tengu.damageRoll, Tengu.java:63-65). */
export function tenguDamageRoll(rng: MechanicsRng): number {
  return rng.normalIntRange(TENGU_DMG_MIN, TENGU_DMG_MAX);
}

/**
 * doAttack branch (Tengu.doAttack, Tengu.java:124-132): decrement the jump
 * timer; jump instead of striking when it expires with the enemy adjacent.
 */
export function tenguShouldJump(timeToJump: number, adjacent: boolean): {
  jump: boolean;
  nextTimeToJump: number;
} {
  const next = timeToJump - 1;
  if (next <= 0 && adjacent) {
    return { jump: true, nextTimeToJump: TENGU_JUMP_DELAY };
  }
  return { jump: false, nextTimeToJump: next };
}
