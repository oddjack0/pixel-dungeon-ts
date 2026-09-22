/**
 * DM-300, the Caves boss (depth 15) — pure stat constants and decision
 * helpers. Turn logic lives in src/content/dm300-boss.ts.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/DM300.java.
 * Java wins every conflict.
 *
 * Stat constants (DM300.java:54-65):
 *   HP = HT = 200, EXP = 30, defenseSkill = 18, dr() = 10,
 *   damageRoll = NormalIntRange(18, 24), attackSkill = 28,
 *   maxLvl default 30 (Mob.java:69 — DM300 does not override it).
 *   resistances: Death, ScrollOfPsionicBlast (DM300.java:156-163; halved,
 *     not negated — Char.damage).
 *   immunities: ToxicGas (DM300.java:166-172) — it walks in its own gas.
 * Name: "DM-300" if depth == deepestFloor else "DM-350" (DM300.java:56);
 *   deepestFloor tracking lands with the meta systems, so the def uses
 *   "DM-300" (first-visit name) with this note.
 *
 * Per-turn (DM300.act, DM300.java:78-82): seeds ToxicGas 30 at its own cell
 * BEFORE super.act() — the machine trails a poison cloud wherever it goes.
 * On move (DM300.move, DM300.java:84-116):
 *   - stepping onto an INACTIVE_TRAP with HP < HT repairs it:
 *     HP += Random.Int(1, HT - HP) (DM300.java:84-91), yelling
 *     "DM-300 repairs itself!" when the cell is visible and the hero lives
 *     (DM300.java:88-90);
 *   - then one of the 8 cells around the NEW position is picked at random
 *     (DM300.java:93-101): when visible it gets the rock-burst effect
 *     (visuals — renderer territory), water there ripples, EMPTY becomes
 *     EMPTY_DECO (DM300.java:109-112), and any other char on it is
 *     paralysed for 2 turns (DM300.java:114-116).
 */
import type { MechanicsRng } from './rng';

export const DM300_HT = 200;
export const DM300_EXP = 30;
export const DM300_DEFENSE = 18;
export const DM300_DR = 10;
export const DM300_ATTACK = 28;
/** Damage die (DM300.damageRoll, DM300.java:67-69). */
export const DM300_DMG_MIN = 18;
export const DM300_DMG_MAX = 24;
/** DM300 does not override maxLvl (Mob.java:69 default). */
export const DM300_MAX_LVL = 30;
/**
 * Toxic gas seeded at the boss's cell every turn (DM300.act, DM300.java:79).
 */
export const DM300_GAS_SEED = 30;
/** Paralysis duration for the move-effect stomp (DM300.java:115). */
export const DM300_PARALYSIS_TURNS = 2;
/**
 * Source tags halved by DM300's resistances (DM300.java:156-163).
 * Tag naming follows the codebase convention ('death', 'psionic_blast';
 * toxic gas uses 'toxic_gas').
 */
export const DM300_RESISTANCES = ['death', 'psionic_blast'] as const;
/** Immunities (DM300.java:166-172). */
export const DM300_IMMUNITIES = ['toxic_gas'] as const;

/** DM300 damage die (DM300.damageRoll, DM300.java:67-69). */
export function dm300DamageRoll(rng: MechanicsRng): number {
  return rng.normalIntRange(DM300_DMG_MIN, DM300_DMG_MAX);
}

/**
 * Trap repair (DM300.move, DM300.java:86): HP += Random.Int(1, HT - HP) —
 * a heal in [1, HT-HP), so it can never quite reach full (Java
 * Random.Int(a, b) is [a, b), the port's rng.int matches).
 */
export function dm300Repair(rng: MechanicsRng, hp: number, ht: number): number {
  return hp + rng.int(1, ht - hp);
}

/**
 * Move-effect target (DM300.move, DM300.java:93-101): one of the 8 cells
 * around the destination, picked uniformly. Returns the cell index, or -1
 * when the pick falls outside the level (vanilla reads off-map silently —
 * the port guards the bounds instead of crashing).
 */
export function dm300MoveCell(
  rng: MechanicsRng,
  step: number,
  w: number,
  h: number,
): number {
  const sx = step % w;
  const sy = Math.floor(step / w);
  const dx = [-1, 1, 0, 0, -1, -1, 1, 1];
  const dy = [0, 0, -1, 1, -1, 1, -1, 1];
  const i = rng.int(0, 8);
  const nx = sx + dx[i]!;
  const ny = sy + dy[i]!;
  if (nx < 0 || ny < 0 || nx >= w || ny >= h) return -1;
  return ny * w + nx;
}
