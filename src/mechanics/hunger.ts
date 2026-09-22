/**
 * Hunger and natural regeneration, ported from Hunger.java and Regeneration.java.
 *
 * Hunger (Hunger.java):
 *   STEP = 10 (Hunger.java:34); HUNGRY = 260 (36); STARVING = 360 (37).
 *   Each act (while not starving): level += STEP (M1: no RingOfSatiety,
 *   so bonus = 0; Hunger.java:80).
 *   While starving: 30% chance per act of 1 damage, and the damage IS dealt
 *   when (target.HP > 1 || !target.paralysed) -- i.e. starvation CAN kill a
 *   conscious hero at 1 HP; only a paralysed 1-HP hero is spared
 *   (Hunger.java:66-72).
 *   Tick cadence: spend(STEP) per act for the warrior (10 time units);
 *   rogue spends STEP*1.2 (Hunger.java:108-109). M1 = warrior only.
 *   satisfy(energy): level -= energy, clamped to [0, STARVING]
 *   (Hunger.java:113-121). A Ration satisfies Hunger.HUNGRY = 260
 *   (Food.energy, Food.java:41).
 *
 * Regeneration (Regeneration.java):
 *   Every REGENERATION_DELAY = 10 time units (Regeneration.java:25):
 *   if HP < HT and not starving: HP += 1 (Regeneration.java:30-33).
 *   M1: no RingOfMending.
 */
import type { MechanicsRng } from './rng';

export const HUNGER_STEP = 10;
export const HUNGRY = 260;
export const STARVING = 360;
export const STARVE_DAMAGE_CHANCE = 0.3;
export const RATION_ENERGY = 260;
export const REGEN_DELAY = 10;

export interface HungerState {
  /** Accumulated hunger level (Hunger.level, Hunger.java:43). */
  level: number;
  hp: number;
  paralysed: boolean;
}

export function isHungry(level: number): boolean {
  return level >= HUNGRY;
}

export function isStarving(level: number): boolean {
  return level >= STARVING;
}

/** Result of one Hunger buff act (Hunger.act, Hunger.java:64-108). */
export interface HungerTickResult {
  level: number;
  /** Damage dealt this tick (0 or 1). */
  damage: number;
  died: boolean;
  becameStarving: boolean;
  becameHungry: boolean;
}

export function hungerTick(rng: MechanicsRng, s: HungerState): HungerTickResult {
  const wasHungry = isHungry(s.level);
  const wasStarving = isStarving(s.level);
  let level = s.level;
  let damage = 0;
  let died = false;

  if (wasStarving) {
    // Hunger.java:66: Random.Float() < 0.3f && (target.HP > 1 || !target.paralysed)
    if (rng.float(0, 1) < STARVE_DAMAGE_CHANCE && (s.hp > 1 || !s.paralysed)) {
      damage = 1;
      died = s.hp - 1 <= 0;
    }
  } else {
    level += HUNGER_STEP;
  }

  return {
    level,
    damage,
    died,
    becameStarving: !wasStarving && isStarving(level),
    becameHungry: !wasHungry && level >= HUNGRY && level < STARVING,
  };
}

/** satisfy(energy) (Hunger.java:113-121): clamps to [0, STARVING]. */
export function satisfy(level: number, energy: number): number {
  const v = level - energy;
  if (v < 0) return 0;
  if (v > STARVING) return STARVING;
  return v;
}

/**
 * One Regeneration tick (Regeneration.act, Regeneration.java:28-46):
 * +1 HP if HP < HT and not starving. Returns the new HP.
 * The engine schedules ticks every REGEN_DELAY (10) time units.
 */
export function regenTick(hp: number, ht: number, starving: boolean): number {
  return hp < ht && !starving ? hp + 1 : hp;
}
