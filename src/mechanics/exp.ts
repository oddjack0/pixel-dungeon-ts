/**
 * EXP and leveling, ported from Hero.java and Mob.java.
 *
 * Thresholds (Hero.maxExp, Hero.java:1061-1063): maxExp() = 5 + lvl * 5.
 *   lvl 1 -> 10, lvl 2 -> 15, lvl 3 -> 20, ... (cumulative from 0: 10, 25, 45, ...)
 *
 * Level-up (Hero.earnExp, Hero.java:1019-1045):
 *   while (exp >= maxExp()) { exp -= maxExp(); lvl++; HT += 5; HP += 5;
 *                             attackSkill++; defenseSkill++;
 *                             if (lvl < 10) updateAwareness(); }
 * M1: warrior only (rogue = false); no subclass extras (Warlock's
 * post-level heal is a later milestone).
 *
 * Mob EXP (Mob.java:68-69, 353-355): exp() = hero.lvl <= maxLvl ? EXP : 0.
 */
import { GOO_EXP, GOO_MAX_LVL } from './goo.js';
import { updateAwareness } from './hero.js';

export interface LevelState {
  lvl: number;
  exp: number;
  ht: number;
  hp: number;
  attackSkill: number;
  defenseSkill: number;
  /** Hero.awareness (Hero.java:162); recomputed on level-up (Hero.java:1034). */
  awareness: number;
}

/** EXP needed to go from `lvl` to `lvl + 1` (Hero.maxExp, Hero.java:1061-1063). */
export function maxExp(lvl: number): number {
  return 5 + lvl * 5;
}

/**
 * Add EXP and apply level-ups (Hero.earnExp, Hero.java:1019-1041).
 * Mutates `state` in place and returns the number of levels gained.
 */
export function earnExp(state: LevelState, amount: number): number {
  state.exp += amount;
  let gained = 0;
  while (state.exp >= maxExp(state.lvl)) {
    state.exp -= maxExp(state.lvl);
    state.lvl++;
    state.ht += 5;
    state.hp += 5;
    state.attackSkill++;
    state.defenseSkill++;
    if (state.lvl < 10) {
      state.awareness = updateAwareness(state.lvl, false); // Hero.java:1032-1034
    }
    gained++;
  }
  return gained;
}

/** M1 mob EXP / maxLvl table.
 *  Rat: EXP default 1 (Mob.java:68), maxLvl 5 (Rat.java:34).
 *  Gnoll: EXP 2, maxLvl 8 (Gnoll.java:35-36).
 *  Crab: EXP 3, maxLvl 9 (Crab.java:36-37).
 *  Swarm: EXP default 1, maxLvl 10 (Swarm.java:47). (Splits keep full stats.)
 *  Skeleton: EXP 5, maxLvl 10 (Skeleton.java:47-48).
 *  Thief: EXP 5, maxLvl 10 (Thief.java:48-49).
 *  Goo: EXP 10, maxLvl default 30 (Goo.java:52; Mob.java:69). */
export const MOB_EXP: Readonly<Record<string, { exp: number; maxLvl: number }>> = {
  rat: { exp: 1, maxLvl: 5 },
  gnoll: { exp: 2, maxLvl: 8 },
  crab: { exp: 3, maxLvl: 9 },
  swarm: { exp: 1, maxLvl: 10 },
  skeleton: { exp: 5, maxLvl: 10 },
  thief: { exp: 5, maxLvl: 10 },
  goo: { exp: GOO_EXP, maxLvl: GOO_MAX_LVL },
};

/** EXP granted for a kill (Mob.exp, Mob.java:353-355). */
export function expForKill(mobId: string, heroLvl: number): number {
  const m = MOB_EXP[mobId];
  if (!m) return 0;
  return heroLvl <= m.maxLvl ? m.exp : 0;
}
