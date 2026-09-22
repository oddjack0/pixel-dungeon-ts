/**
 * Goo boss mechanics, ported from Goo.java (actors/mobs/Goo.java).
 *
 * Stats:
 *   HP = HT = 80 (Goo.java:51); EXP = 10 (Goo.java:52);
 *   defenseSkill = 12 (Goo.java:53); dr() = 2 (Goo.java:77-79).
 *   damageRoll: pumpedUp ? NormalIntRange(5, 30) : NormalIntRange(2, 12)
 *     (Goo.java:64-69).
 *   attackSkill: pumpedUp && !jumped ? 30 : 15 (Goo.java:72-74).
 *
 * Pump-up telegraph (Goo.doAttack, Goo.java:104-170):
 *   - Not pumped: 2/3 normal attack (Random.Int(3) > 0), else 1/3 pump up:
 *     pumpedUp = true, spend(PUMP_UP_DELAY = 2) (Goo.java:46, 158-167).
 *   - Pumped: if adjacent -> normal attack, jumped = false.
 *     Else if jump path (Ballistica) is clear and enemy within 2 -> jump
 *     attack, jumped = true (attackSkill drops back to 15 -- the "accuracy
 *     penalty"; Goo.java:74 comment "WITH accuracy penalty").
 *     Else (blocked) -> pumpedUp = false, turn spent, no attack
 *     (Goo.java:144-148).
 *   - canAttack: pumpedUp ? distance <= 2 : adjacent (Goo.java:95-97).
 *   - attack() clears pumpedUp afterwards (Goo.java:176-180).
 *   - getCloser() (moving) clears pumpedUp (Goo.java:182-185).
 *
 * Extras:
 *   - Heals 1 HP per turn while standing in water and HP < HT
 *     (Goo.act, Goo.java:84-89).
 *   - attackProc: 1/3 chance (Random.Int(3) == 0) to apply Ooze to the enemy
 *     (Goo.java:99-103).
 *   - Resistances (halve damage via Random.IntRange(0, dmg)): ToxicGas,
 *     Death glyph, ScrollOfPsionicBlast (Goo.java:228-233).
 *
 * The engine owns movement/ballistica/rendering; this module exposes the
 * stat constants and a pure decide() for the doAttack branch.
 */
import type { MechanicsRng } from './rng';

export const GOO_HT = 80;
export const GOO_EXP = 10;
export const GOO_DEFENSE = 12;
export const GOO_DR = 2;
export const GOO_ATTACK = 15;
export const GOO_ATTACK_PUMPED = 30;
/** Damage dice (Goo.damageRoll, Goo.java:64-69). */
export const GOO_DMG_MIN = 2;
export const GOO_DMG_MAX = 12;
export const GOO_DMG_PUMPED_MIN = 5;
export const GOO_DMG_PUMPED_MAX = 30;
/** Goo does not override maxLvl (Mob.java:69 default). */
export const GOO_MAX_LVL = 30;
export const PUMP_UP_DELAY = 2;
export const GOO_PUMP_CHANCE = 1 / 3;
export const GOO_OOZE_CHANCE = 1 / 3;
/**
 * Source tags halved by Goo's resistances (Goo.java:228-233: ToxicGas, Death,
 * ScrollOfPsionicBlast all sit in RESISTANCES — damage is halved, not
 * negated). Tag naming follows the codebase convention ('death', 'ooze').
 */
export const GOO_RESISTANCES = ['toxic_gas', 'death', 'psionic_blast'] as const;

export interface GooState {
  hp: number;
  pumpedUp: boolean;
  jumped: boolean;
}

/** Goo damage die (Goo.damageRoll, Goo.java:64-69). */
export function gooDamageRoll(rng: MechanicsRng, pumpedUp: boolean): number {
  return pumpedUp
    ? rng.normalIntRange(GOO_DMG_PUMPED_MIN, GOO_DMG_PUMPED_MAX)
    : rng.normalIntRange(GOO_DMG_MIN, GOO_DMG_MAX);
}

/** Goo attack skill (Goo.attackSkill, Goo.java:72-74). */
export function gooAttackSkill(pumpedUp: boolean, jumped: boolean): number {
  return pumpedUp && !jumped ? GOO_ATTACK_PUMPED : GOO_ATTACK;
}

/** Whether Goo can attack from `dist` (chebyshev) (Goo.canAttack, Goo.java:95-97). */
export function gooCanAttack(pumpedUp: boolean, dist: number): boolean {
  return pumpedUp ? dist <= 2 : dist <= 1;
}

export type GooAction =
  | { kind: 'attack' } // normal melee attack (also clears pumpedUp afterwards)
  | { kind: 'pump' } // start pumping: pumpedUp = true, spend PUMP_UP_DELAY
  | { kind: 'jumpAttack' } // leap to enemy then attack (jumped = true)
  | { kind: 'pumpFizzle' }; // jump path blocked: pumpedUp = false, turn spent

export interface GooContext {
  /** Chebyshev distance to the enemy. */
  dist: number;
  /** True if the jump ballistica reaches the enemy (engine computes). */
  jumpPathClear: boolean;
}

/**
 * Pure doAttack branch (Goo.doAttack, Goo.java:104-170).
 * Assumes gooCanAttack already held.
 */
export function gooDecide(
  rng: MechanicsRng,
  state: GooState,
  ctx: GooContext,
): GooAction {
  if (state.pumpedUp) {
    if (ctx.dist <= 1) {
      return { kind: 'attack' }; // pumped attack, no accuracy penalty
    }
    if (ctx.jumpPathClear && ctx.dist <= 2) {
      return { kind: 'jumpAttack' }; // pumped attack WITH accuracy penalty
    }
    return { kind: 'pumpFizzle' }; // blocked: pumpedUp = false, no attack
  }
  // Random.Int(3) > 0 -> normal attack (2/3); else pump up (1/3).
  return rng.int(0, 3) > 0 ? { kind: 'attack' } : { kind: 'pump' };
}

/**
 * Apply the consequences of a decided action to GooState (engine applies the
 * world effects). Mirrors Goo.attack (Goo.java:176-180) and Goo.getCloser
 * (Goo.java:182-185).
 */
export function gooAfterAttack(state: GooState, action: GooAction): GooState {
  switch (action.kind) {
    case 'attack':
      return { ...state, pumpedUp: false, jumped: false };
    case 'pump':
      return { ...state, pumpedUp: true, jumped: false };
    case 'jumpAttack':
      return { ...state, pumpedUp: false, jumped: true };
    case 'pumpFizzle':
      return { ...state, pumpedUp: false, jumped: false };
  }
}

/** Moving cancels the pump (Goo.getCloser, Goo.java:182-185). */
export function gooAfterMove(state: GooState): GooState {
  return { ...state, pumpedUp: false };
}

/** Ooze application roll (Goo.attackProc, Goo.java:99-103): 1/3 chance. */
export function gooOozeRoll(rng: MechanicsRng): boolean {
  return rng.int(0, 3) === 0;
}

/** Water regen (Goo.act, Goo.java:84-89): +1 HP per turn in water if hurt. */
export function gooWaterRegen(hp: number, inWater: boolean): number {
  return inWater && hp < GOO_HT ? hp + 1 : hp;
}
