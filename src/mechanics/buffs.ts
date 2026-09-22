/**
 * M1 buff set, ported from the buff classes. All ticks are pure functions of
 * (rng, state); the engine schedules them and applies the results.
 *
 * Burning (Burning.java):
 *   DURATION = 8 (Burning.java:48). act() each TICK:
 *     damage Random.Int(1, 5) -> 1..4 (Burning.java:75)
 *     left -= TICK (spend TICK then left -= TICK; Burning.java:96-98)
 *     detach when left <= 0
 *       || Random.Float() > (2 + HP/HT) / 3
 *       || (standing in water && !flying)          (Burning.java:100-105)
 *   reignite() resets left = duration(ch) = 8 (M1: no RingOfElements;
 *   Burning.java:109-111, 128-131).
 *   M1 applier: FireTrap -> Blob.seed(pos, 2, Fire) (FireTrap.java:34);
 *   fire blob reignites Burning on chars standing in it.
 *
 * Poison (Poison.java):
 *   act() each TICK: damage (int)(left / 3) + 1, then left -= TICK,
 *   detach at left <= 0 (Poison.java:64-78). Duration set by applier via
 *   set(duration) (Poison.java:52-54).
 *   M1 applier: PoisonTrap -> durationFactor * (4 + depth / 2)
 *   (PoisonTrap.java:34). No RingOfElements in M1, so durationFactor = 1.
 *   Swarm split: clone poisoned for 2 (Swarm.java:120-128).
 *
 * Paralysis (Paralysis.java, via FlavourBuff):
 *   DURATION = 10 (Paralysis.java:26). attachTo sets target.paralysed = true
 *   (Paralysis.java:27-35); detach clears it (via unfreeze, Paralysis.java:
 *   37-40, 51-57; M1 has no Frost so it always clears).
 *   Damage can break it early (see combat.applyDamage; Char.java:269-275).
 *   Paralysed halves hero evasion (Hero.java:283-285).
 *   M1 applier: ParalyticTrap -> ParalyticGas blob (ParalyticTrap.java:34);
 *   gas prolongs Paralysis by Paralysis.duration(ch) = 10
 *   (ParalyticGas.java:36; Paralysis.duration, Paralysis.java:46-49).
 *
 * Sleep (Sleep.java):
 *   FlavourBuff with SWS = 1.5 (Sleep.java:22). Mob.add(Sleep) sets state to
 *   SLEEPING and postpones the mob by Sleep.SWS (Mob.java:206-212).
 *   NOTE: no M1 applier (only ScrollOfLullaby, a later milestone) -- ported
 *   for completeness.
 *
 * Roots (Roots.java):
 *   attachTo sets target.rooted = true unless target.flying
 *   (Roots.java:28-36); detach clears it (Roots.java:38-42).
 *   NOTE: no M1 applier in the Sewers (Web blob is later regions) -- ported
 *   for completeness.
 *
 * Ooze (Ooze.java) -- applied by Goo's attackProc, 1/3 chance (Goo.java:99-103):
 *   act() each TICK: damage 1 (Ooze.java:42-44); detaches in water
 *   (Ooze.java:46-48). Included here because M1's boss uses it.
 */
import type { MechanicsRng } from './rng';

export type BuffKind =
  | 'burning'
  | 'poison'
  | 'paralysis'
  | 'sleep'
  | 'roots'
  | 'ooze'
  | 'hunger'
  | 'regeneration';

export const BURNING_DURATION = 8;
export const POISON_TRAP_BASE = 4;
export const PARALYSIS_DURATION = 10;
export const SLEEP_POSTPONE = 1.5;
export const OOZE_DAMAGE = 1;

export interface BurningTick {
  damage: number;
  left: number;
  detached: boolean;
}

/** One Burning act (Burning.java:64-107). */
export function burningTick(
  rng: MechanicsRng,
  hp: number,
  ht: number,
  left: number,
  inWater: boolean,
  flying: boolean,
): BurningTick {
  const damage = rng.int(1, 5); // Random.Int(1, 5) -> [1, 5) = 1..4
  const nextLeft = left - 1;
  const extinguished =
    rng.float(0, 1) > (2 + hp / ht) / 3 || (inWater && !flying);
  const detached = nextLeft <= 0 || extinguished;
  return { damage, left: nextLeft, detached };
}

/** Reignite: left = duration(ch) = DURATION (Burning.java:109-111, 128-131). */
export function reigniteBurning(): number {
  return BURNING_DURATION;
}

export interface PoisonTick {
  damage: number;
  left: number;
  detached: boolean;
}

/** One Poison act (Poison.java:64-78). */
export function poisonTick(left: number): PoisonTick {
  const damage = Math.floor(left / 3) + 1; // (int)(left / 3) + 1
  const nextLeft = left - 1;
  return { damage, left: nextLeft, detached: nextLeft <= 0 };
}

/** PoisonTrap duration (PoisonTrap.java:34): (4 + depth / 2), integer division. */
export function poisonTrapDuration(depth: number): number {
  return POISON_TRAP_BASE + Math.floor(depth / 2);
}

/** Ooze act: 1 damage per TICK; detaches in water (Ooze.java:39-50). */
export function oozeTick(inWater: boolean): { damage: number; detached: boolean } {
  return { damage: OOZE_DAMAGE, detached: inWater };
}

/** Paralysis duration with no RingOfElements (Paralysis.duration, Paralysis.java:46-49). */
export function paralysisDuration(): number {
  return PARALYSIS_DURATION;
}
