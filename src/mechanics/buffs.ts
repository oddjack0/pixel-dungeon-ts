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
 *
 * Bleeding (Bleeding.java) -- applied by GrippingTrap (GrippingTrap.java):
 *   set(level) with level = max(0, (depth + 3) - IntRange(0, dr()/2)).
 *   act() each TICK: level = Random.Int(level/2, level); if level > 0:
 *   damage level (Bleeding.java:58-81), else detach. Death message:
 *   "You bled to death..." (Bleeding.java:70).
 *
 * Cripple (Cripple.java) -- applied by GrippingTrap (GrippingTrap.java):
 *   FlavourBuff, DURATION = 10 (Cripple.java:24). While active the char's
 *   speed is halved (Char.speed(), Char.java:248).
 */
import type { MechanicsRng } from './rng';

export type BuffKind =
  | 'burning'
  | 'poison'
  | 'paralysis'
  | 'sleep'
  | 'roots'
  | 'ooze'
  | 'bleeding'
  | 'cripple'
  | 'blindness'
  | 'hunger'
  | 'regeneration';

export const BURNING_DURATION = 8;
export const POISON_TRAP_BASE = 4;
export const PARALYSIS_DURATION = 10;
/** Cripple duration (Cripple.java:24). Halves speed (Char.java:248). */
export const CRIPPLE_DURATION = 10;
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

export interface BleedingTick {
  /** New bleed level (0 detaches). */
  level: number;
  detached: boolean;
}

/**
 * One Bleeding act (Bleeding.java:58-81):
 *   level = Random.Int(level / 2, level)   (int division; [level/2, level))
 *   if level > 0: target.damage(level, this), spend TICK
 *   else detach (also detaches when the target is dead).
 */
export function bleedingTick(rng: MechanicsRng, level: number): BleedingTick {
  const next = rng.int(Math.floor(level / 2), level);
  return { level: next, detached: next <= 0 };
}

/** Ooze act: 1 damage per TICK; detaches in water (Ooze.java:39-50). */
export function oozeTick(inWater: boolean): { damage: number; detached: boolean } {
  return { damage: OOZE_DAMAGE, detached: inWater };
}

/** Paralysis duration with no RingOfElements (Paralysis.duration, Paralysis.java:46-49). */
export function paralysisDuration(): number {
  return PARALYSIS_DURATION;
}

// ---------------------------------------------------------------------------
// Hero-facing messages. Every string below was read verbatim from the Java
// sources cited; vanilla has NO generic buff-attach messages for these buffs
// (no GLog calls in Burning/Poison/Paralysis/Sleep/Roots/Ooze/Slow/Vertigo/
// Cripple/Frost/Bleeding/Charm/Terror/Amok attach paths) — only the act-time
// messages below exist.
// ---------------------------------------------------------------------------

/** Burning.java:45 — GLog.w when a scroll or mystery meat burns in the pack. */
export const MSG_BURNS_UP = '%s burns up!';
/** Burning.java:46 — Burning.onDeath (Burning.java:147-153), GLog.n. */
export const MSG_BURNED_TO_DEATH = 'You burned to death...';
/** Poison.java:94 — Poison.onDeath (Poison.java:90-95), GLog.n. */
export const MSG_DIED_FROM_POISON = 'You died from poison...';
/**
 * Ooze.java:29 (TXT_HERO_KILLED = "%s killed you...") + toString()
 * "Caustic ooze" (Ooze.java:39-41); logged in Ooze.act (Ooze.java:50), GLog.n.
 */
export const MSG_OOZE_KILLED = 'Caustic ooze killed you...';
/** Bleeding.java:77 — logged in Bleeding.act on hero death, GLog.n. */
export const MSG_BLED_TO_DEATH = 'You bled to death...';
/** Hunger.java:41 — Hunger.onDeath (Hunger.java:151-157), GLog.n. */
export const MSG_STARVED_TO_DEATH = 'You starved to death...';
/** Hunger.java:39 — crossing the HUNGRY threshold (Hunger.java:91), GLog.w. */
export const MSG_HUNGRY = 'You are hungry.';
/** Hunger.java:40 — crossing the STARVING threshold (Hunger.java:84), GLog.n. */
export const MSG_STARVING = 'You are starving!';
/** Combo.java:27 — on combo count increase (Combo.java:46-50), GLog.p. */
export const MSG_COMBO = '%d hit combo!';

/** Matches the vanilla death log lines these messages produce. */
export const DEATH_MESSAGE_RE =
  /you burned to death\.\.\.|you died from poison\.\.\.|caustic ooze killed you\.\.\.|you bled to death\.\.\.|you starved to death\.\.\.|you died from a toxic gas\.\.|you fell to death\.\.\./i;

/**
 * Vanilla death message for a buff that just killed the hero, if the buff
 * has one (Burning/Poison/Ooze/Hunger/Bleeding log in onDeath or in act on
 * hero death; see constants above). Null for buffs with no death message.
 */
export function buffDeathMessage(kind: BuffKind): string | null {
  switch (kind) {
    case 'burning':
      return MSG_BURNED_TO_DEATH;
    case 'poison':
      return MSG_DIED_FROM_POISON;
    case 'ooze':
      return MSG_OOZE_KILLED;
    case 'bleeding':
      return MSG_BLED_TO_DEATH;
    case 'hunger':
      return MSG_STARVED_TO_DEATH;
    default:
      return null;
  }
}

/** Format "%s burns up!" (Burning.java:45,83-94). */
export function burnsUpMessage(itemName: string): string {
  return MSG_BURNS_UP.replace('%s', itemName);
}

/** Format "%d hit combo!" (Combo.java:27,49). */
export function comboMessage(count: number): string {
  return MSG_COMBO.replace('%d', String(count));
}

// ---------------------------------------------------------------------------
// Burning inventory side effects (Burning.act hero branch, Burning.java:76-98).
// ---------------------------------------------------------------------------

/** One item destroyed (or cooked) in the hero's pack by Burning. */
export interface BurnInventoryResult {
  /** Stack index that lost one item (uniform over instances — see below). */
  stackIndex: number;
  /**
   * Replacement item id when mystery meat cooks instead of burning
   * (ChargrilledMeat; Burning.java:87-96). Null for scrolls (destroyed).
   */
  cookedId: string | null;
}

/**
 * Which backpack item Burning destroys this tick.
 * Belongings.randomUnequipped() = Random.element(backpack.items)
 * (Belongings.java:164-166): uniform over item INSTANCES, so the pure core
 * takes the stack list and picks uniformly over instances (qty-weighted).
 * Scrolls burn up; MysteryMeat becomes ChargrilledMeat (kept, not destroyed:
 * Burning.java:87-96); anything else is untouched.
 *
 * M1 note: the item catalog has no meat items (documented skip at
 * mobs.ts:910), so the meat branch is unreachable until they land — the
 * seam is exact anyway.
 */
export function burningInventoryTick(
  rng: MechanicsRng,
  stacks: { itemId: string; qty: number }[],
  isScroll: (itemId: string) => boolean,
  isMysteryMeat: (itemId: string) => boolean,
): BurnInventoryResult | null {
  let total = 0;
  for (const s of stacks) total += Math.max(0, s.qty);
  if (total <= 0) return null;
  let pick = rng.int(0, total); // Random.Int(0, n) -> [0, n)
  for (let i = 0; i < stacks.length; i++) {
    pick -= Math.max(0, stacks[i]!.qty);
    if (pick < 0) {
      const itemId = stacks[i]!.itemId;
      if (isScroll(itemId)) return { stackIndex: i, cookedId: null };
      if (isMysteryMeat(itemId)) return { stackIndex: i, cookedId: 'chargrilled_meat' };
      return null;
    }
  }
  return null;
}
