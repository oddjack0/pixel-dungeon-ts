/**
 * Goo `jumped` flag — EXACT lifecycle (Goo.java; only three writes exist):
 *
 *   SET false: Goo.doAttack, pumped-up + adjacent branch, BEFORE the strike
 *     (Goo.java:115). This is the "pumped attack WITHOUT accuracy penalty".
 *   SET true:  Goo.doAttack, pumped-up jump branch, BEFORE the strike
 *     (Goo.java:121). This is the "pumped attack WITH accuracy penalty".
 *   CLEARED:  never. No code path resets `jumped` back to false except the
 *     pumped-adjacent set above. In particular it is NOT touched by:
 *       - the normal (non-pumped) attack branch (Goo.java:150-156),
 *       - the pump-up branch (Goo.java:158-167; only pumpedUp = true),
 *       - the pump-fizzle branch (Goo.java:144-148; only pumpedUp = false),
 *       - the attack() wrapper (Goo.java:176-180; only pumpedUp = false),
 *       - getCloser() (Goo.java:182-185; only pumpedUp = false).
 *
 * Gameplay effect (Goo.java:74): attackSkill = pumpedUp && !jumped ? 30 : 15.
 * Because every strike made while pumpedUp goes through doAttack — which
 * freshly sets `jumped` that same turn — the observable effect is fully
 * determined by the current turn's branch: pumped-adjacent strikes at 30,
 * jump strikes at 15, everything else at 15.
 *
 * Stat constants (Goo.java:51-59, 64-79, 228-233): HP = HT = 80, EXP = 10,
 * defenseSkill = 12, dr() = 2, damageRoll pumpedUp ? NormalIntRange(5, 30)
 * : NormalIntRange(2, 12), attackSkill pumpedUp && !jumped ? 30 : 15,
 * canAttack: pumpedUp ? distance <= 2 : adjacent (Goo.java:95-97).
 * Pump-up telegraph (Goo.doAttack, Goo.java:104-170): not pumped -> 2/3
 * normal attack (Random.Int(3) > 0), else 1/3 pump up: pumpedUp = true,
 * spend(PUMP_UP_DELAY = 2) (Goo.java:46, 158-167). Extras: +1 HP/turn in
 * water while hurt (Goo.act, Goo.java:84-89); attackProc 1/3 Ooze
 * (Goo.java:99-103); resistances ToxicGas/Death/ScrollOfPsionicBlast
 * (Goo.java:228-233).
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
  | { kind: 'attack' } // normal attack (Random.Int(3) > 0); jumped untouched
  | { kind: 'pumpedAttack' } // pumped + adjacent: jumped = false BEFORE the strike
  | { kind: 'pump' } // start pumping: pumpedUp = true; jumped untouched
  | { kind: 'jumpAttack' } // leap then strike: jumped = true BEFORE the strike
  | { kind: 'pumpFizzle' }; // jump path blocked: pumpedUp = false; jumped untouched

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
      return { kind: 'pumpedAttack' }; // Goo.java:112-118: jumped = false, strike at 30
    }
    if (ctx.jumpPathClear && ctx.dist <= 2) {
      return { kind: 'jumpAttack' }; // Goo.java:119-143: jumped = true, strike at 15
    }
    return { kind: 'pumpFizzle' }; // Goo.java:144-148: pumpedUp = false, no attack
  }
  // Random.Int(3) > 0 -> normal attack (2/3); else pump up (1/3).
  return rng.int(0, 3) > 0 ? { kind: 'attack' } : { kind: 'pump' };
}

/**
 * Post-strike state (Goo.doAttack sets + Goo.attack wrapper, Goo.java:176-180,
 * which clears ONLY pumpedUp). `jumped` is written exactly where Goo.java
 * writes it — nowhere else:
 *   - 'attack': normal branch never touches jumped (Goo.java:150-156).
 *   - 'pumpedAttack': jumped = false was set before the strike (Goo.java:115).
 *   - 'pump': pump-up branch never touches jumped (Goo.java:158-167).
 *   - 'jumpAttack': jumped = true was set before the strike (Goo.java:121).
 *   - 'pumpFizzle': fizzle branch never touches jumped (Goo.java:144-148).
 */
export function gooAfterAttack(state: GooState, action: GooAction): GooState {
  switch (action.kind) {
    case 'attack':
      return { ...state, pumpedUp: false };
    case 'pumpedAttack':
      return { ...state, pumpedUp: false, jumped: false };
    case 'pump':
      return { ...state, pumpedUp: true };
    case 'jumpAttack':
      return { ...state, pumpedUp: false, jumped: true };
    case 'pumpFizzle':
      return { ...state, pumpedUp: false };
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
