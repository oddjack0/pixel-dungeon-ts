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
  | 'regeneration'
  | 'frost'
  | 'levitation'
  | 'invisibility'
  | 'mindvision'
  | 'gasesimmunity'
  | 'terror'
  | 'rage'
  // Stage 2 (wands/rings worker): Amok debuff + the 12 RingBuff kinds
  // (items/rings/Ring.java: RingBuff subclasses). Ring buffs are permanent
  // while equipped; their `level` field carries the ring's (possibly
  // negative) level, exactly like vanilla RingBuff.level().
  | 'amok'
  | 'ring_mending'
  | 'ring_detection'
  | 'ring_shadows'
  | 'ring_power'
  | 'ring_herbalism'
  | 'ring_accuracy'
  | 'ring_evasion'
  | 'ring_satiety'
  | 'ring_haste'
  | 'ring_haggler'
  | 'ring_elements'
  | 'ring_thorns'
  // Stage 2 (enchantments/glyphs worker): weapon enchantment + armor glyph
  // buffs. 'slow' is consumed by Char.spend's time scale (charTimeScale,
  // Char.java:303-314); 'vertigo'/'charm' are flavor buffs the engine ticks
  // down (Vertigo/Charm.java); 'deferredDamage' pays out 1 damage per tick
  // (Viscosity.DeferedDamage, Viscosity.java:88-127); 'earthrootArmor' is a
  // permanent counter buff holding the remaining absorb pool
  // (Earthroot.Armor, Earthroot.java) — the buff never expires; its
  // `amount` field is the armor level.
  | 'slow'
  | 'vertigo'
  | 'charm'
  | 'deferredDamage'
  | 'earthrootArmor'
  // Stage 3 (Worker G — buff audit completion): Weakness (Weakness.java)
  // and Speed (Speed.java) had no kinds; 'sacrificeMarked' is
  // SacrificialFire.Marked (SacrificialFire.java), the sacrificial fire's
  // offering mark. All other general buffs (frost, levitation, invisibility,
  // mindvision, gasesimmunity, terror, rage, amok) already had kinds but no
  // mechanics — added below. Fury/Combo/Shadows/SnipersMark are another
  // worker's (subclass-specific) file.
  | 'weakness'
  | 'speed'
  | 'sacrificeMarked'
  // Stage 3 (subclass system): Fury/Combo/Shadows/SnipersMark buff states
  // live in mechanics/subclass_buffs.ts (actors/buffs/{Fury,Combo,Shadows,
  // SnipersMark}.java); these kinds let them sit in hero.buffs.
  | 'fury'
  | 'combo'
  | 'shadows'
  | 'snipersmark'
  // Stage 3 (well wiring): Awareness buff (Awareness.java) — applied by
  // WaterOfAwareness.heroAction (Buff.affect(hero, Awareness.class, 2)).
  | 'awareness';

export const BURNING_DURATION = 8;
export const POISON_TRAP_BASE = 4;
export const PARALYSIS_DURATION = 10;
/** Cripple duration (Cripple.java:24). Halves speed (Char.java:248). */
export const CRIPPLE_DURATION = 10;
/** Slow base duration (Slow.java:26). */
export const SLOW_DURATION = 10;
/** Vertigo base duration (Vertigo.java:24). */
export const VERTIGO_DURATION = 10;

/**
 * RingOfElements duration factor (RingOfElements.java:66-74):
 * `level < 0 ? 1 : (2 + 0.5*level) / (2 + level)`. Multiplies the durations
 * of Burning, Poison, Paralysis, Slow, Vertigo and other elemental effects.
 * `null` = no Ring of Elements equipped.
 */
export function elementsDurationFactor(elementsLevel: number | null): number {
  if (elementsLevel === null || elementsLevel < 0) return 1;
  return (2 + 0.5 * elementsLevel) / (2 + elementsLevel);
}

/** Slow.duration(ch) (Slow.java:28-30): factor * SLOW_DURATION. */
export function slowDuration(elementsLevel: number | null): number {
  return elementsDurationFactor(elementsLevel) * SLOW_DURATION;
}

/** Vertigo.duration(ch) (Vertigo.java:26-28): factor * VERTIGO_DURATION. */
export function vertigoDuration(elementsLevel: number | null): number {
  return elementsDurationFactor(elementsLevel) * VERTIGO_DURATION;
}
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

// ---------------------------------------------------------------------------
// Stage 3 (Worker G): general-buff audit completion.
// Audit result: every buff in actors/buffs/*.java is now ported. Already
// present before this work: burning, poison, paralysis, sleep, roots, ooze,
// bleeding, cripple, blindness, hunger, regeneration, slow, vertigo, charm
// (kinds only, no mechanics for frost/levitation/invisibility/mindvision/
// gasesimmunity/terror/rage/amok/blindness/hunger/regeneration/speed) and
// the ring_* kinds. Fury/Combo/Shadows/SnipersMark are subclass-specific and
// belong to another worker (deliberately not implemented here).
// ---------------------------------------------------------------------------

/** Frost DURATION (Frost.java:21). */
export const FROST_DURATION = 5;
/** Terror DURATION (Terror.java:23). */
export const TERROR_DURATION = 10;
/** Levitation DURATION (Levitation.java:21). */
export const LEVITATION_DURATION = 20;
/** Invisibility DURATION (Invisibility.java:21). */
export const INVISIBILITY_DURATION = 15;
/** MindVision DURATION (MindVision.java:21). */
export const MINDVISION_DURATION = 20;
/** MindVision sight distance (MindVision.java:23: distance = 2). */
export const MINDVISION_DISTANCE = 2;
/** GasesImmunity DURATION (GasesImmunity.java:21). */
export const GASESIMMUNITY_DURATION = 5;
/** Awareness DURATION (Awareness.java:21). */
export const AWARENESS_DURATION = 2;
/** Weakness DURATION (Weakness.java:23). */
export const WEAKNESS_DURATION = 40;
/** Light DURATION + DISTANCE (Light.java:23-24). */
export const LIGHT_DURATION = 250;
export const LIGHT_DISTANCE = 4;
/** Speed DURATION (Speed.java:24). */
export const SPEED_DURATION = 10;
/** SacrificialFire.Marked DURATION (SacrificialFire.java). */
export const MARKED_DURATION = 5;
/** Hunger tuning (Hunger.java:30-32). */
export const HUNGER_STEP = 10;
export const HUNGER_HUNGRY = 260;
export const HUNGER_STARVING = 360;
/** Regeneration REGENERATION_DELAY (Regeneration.java:23). */
export const REGENERATION_DELAY = 10;

/**
 * Frost.duration(ch) (Frost.java:76-79): Resistance durationFactor × 5.
 * Resistance.durationFactor is the RingOfElements formula, identical to
 * elementsDurationFactor (RingOfElements.java:73-75).
 */
export function frostDuration(elementsLevel: number | null): number {
  return elementsDurationFactor(elementsLevel) * FROST_DURATION;
}

/**
 * Weakness.duration(ch) (Weakness.java:64-67): Resistance durationFactor ×
 * 40, same formula.
 */
export function weaknessDuration(elementsLevel: number | null): number {
  return elementsDurationFactor(elementsLevel) * WEAKNESS_DURATION;
}

/** Charm.durationFactor(ch) (Charm.java:55-58): Resistance durationFactor. */
export function charmDurationFactor(elementsLevel: number | null): number {
  return elementsDurationFactor(elementsLevel);
}

/**
 * Terror.recover(target) (Terror.java:55-60): removes the terror when its
 * remaining cooldown is below the full DURATION (10).
 */
export function terrorRecover(cooldown: number): boolean {
  return cooldown < TERROR_DURATION;
}

/**
 * Invisibility.dispel() (Invisibility.java:56-61): dispels the hero's
 * invisibility when any enemy is visible to them.
 */
export function invisibilityDispel(visibleEnemies: number): boolean {
  return visibleEnemies > 0;
}

/**
 * Light.attachTo viewDistance (Light.java:28-36):
 * max(level viewDistance, DISTANCE=4); detach restores level viewDistance
 * (Light.java:39-44).
 */
export function lightViewDistance(levelViewDistance: number): number {
  return Math.max(levelViewDistance, LIGHT_DISTANCE);
}

/**
 * GasesImmunity.IMMUNITIES (GasesImmunity.java:44-49) as port immunity tags.
 * Vanilla swaps the hero's whole immunity set to this while attached
 * (Hero.immunities(), Hero.java:1409-1413); Buff.attachTo refuses buffs in
 * the set (Buff.java:30) and Char.damage refuses damage from sources in the
 * set (Char.java:260).
 */
export const GASES_IMMUNITIES: readonly string[] = [
  'paralysis', // Paralysis.class
  'toxic_gas', // ToxicGas.class
  'vertigo', // Vertigo.class
];

/** True when the char carries the gases-immunity buff (port tag check). */
export function hasGasesImmunity(
  buffs: Partial<Record<BuffKind, unknown>>,
): boolean {
  return buffs.gasesimmunity != null;
}

/**
 * Frost attach effects (Frost.java:25-49): paralyses the target, detaches
 * Burning, and freezes one random unequipped backpack item when it is
 * mystery meat (→ FrozenCarpaccio, carried or dropped at the feet when the
 * pack is full). The engine applies these; the meat branch is unreachable
 * until meat items land (documented at burningInventoryTick).
 */
export interface FrostAttach {
  paralysed: true;
  detachBurning: true;
  freezeRandomMeat: true;
}
export function frostAttach(): FrostAttach {
  return { paralysed: true, detachBurning: true, freezeRandomMeat: true };
}

/**
 * Frost detach (Frost.java:52-55): Paralysis.unfreeze(target). unfreeze
 * (Paralysis.java:51-57) only clears paralysed when no Paralysis buff is
 * attached — the engine passes hasParalysis accordingly.
 */
export function frostDetachClearsParalysed(hasParalysis: boolean): boolean {
  return !hasParalysis;
}

/** Invisibility attach/detach: target.invisible++/-- (Invisibility.java). */
export function invisibilityDelta(attached: boolean): 1 | -1 {
  return attached ? 1 : -1;
}

/**
 * Levitation attach (Levitation.java:24-33): flying = true, Roots detached.
 * Detach (Levitation.java:36-42): flying = false, then
 * Dungeon.level.press(target.pos, target) — the engine re-presses the cell.
 */
export interface LevitationAttach {
  flying: true;
  detachRoots: true;
}
export function levitationAttach(): LevitationAttach {
  return { flying: true, detachRoots: true };
}
export interface LevitationDetach {
  flying: false;
  pressCell: true;
}
export function levitationDetach(): LevitationDetach {
  return { flying: false, pressCell: true };
}

/**
 * Weakness attach (Weakness.java:47-59): hero-only — vanilla casts to Hero,
 * so non-hero targets are a vanilla crash, not a behavior. Sets
 * hero.weakened and discharges wands (belongings.discharge()).
 */
export function weaknessAttachHero(): {
  weakened: true;
  dischargeWands: true;
} {
  return { weakened: true, dischargeWands: true };
}

/**
 * Barkskin tick (Barkskin.java:26-40): spend TICK; --level; detach at 0
 * (also detaches when dead — the engine checks that).
 */
export function barkskinTick(level: number): {
  level: number;
  detached: boolean;
} {
  const next = level - 1;
  return { level: next, detached: next <= 0 };
}

/**
 * Barkskin.level(value) (Barkskin.java:46-50): raises the level, never
 * lowers it.
 */
export function barkskinLevel(current: number, value: number): number {
  return current < value ? value : current;
}

export interface RegenerationTick {
  /** HP gained this tick (0 or 1). */
  heal: number;
  /** Time spent: REGENERATION_DELAY / 1.2^bonus (Regeneration.java:52). */
  spend: number;
}

/**
 * Regeneration act (Regeneration.java:27-56): +1 HP when below max and not
 * starving (Regeneration.java:31-33); the RingOfMending bonus shortens the
 * delay (Regeneration.java:35-40, 42).
 */
export function regenerationTick(
  hp: number,
  ht: number,
  starving: boolean,
  mendingBonus: number,
): RegenerationTick {
  return {
    heal: hp < ht && !starving ? 1 : 0,
    spend: REGENERATION_DELAY / Math.pow(1.2, mendingBonus),
  };
}

export interface HungerTick {
  /** New hunger level (Hunger.level). */
  level: number;
  /** Starvation damage this tick (0 or 1). */
  damage: number;
  /** GLog lines, in order. */
  messages: string[];
  /** Whether the hero's action was interrupted (starvation paths). */
  interrupt: boolean;
  /** Time spent: STEP, ×1.2 for rogues, ×1.5 more with Shadows. */
  spend: number;
}

/**
 * Hunger act (Hunger.java:60-111), verbatim:
 * - starving: 30% chance (Random.Float() < 0.3) and (HP > 1 or not
 *   paralysed) → GLog.n("You are starving!"), 1 damage, interrupt.
 * - else: newLevel = level + STEP − satiety bonus; crossing STARVING →
 *   GLog.n("You are starving!") + interrupt; crossing HUNGRY upward →
 *   GLog.w("You are hungry.").
 * - spend: rogue ×1.2; ×1.5 when a Shadows buff is attached.
 * rngFloat01 supplies Random.Float() for the 30% roll.
 */
export function hungerTick(
  rngFloat01: number,
  level: number,
  hp: number,
  paralysed: boolean,
  satietyBonus: number,
  isRogue: boolean,
  hasShadows: boolean,
): HungerTick {
  const messages: string[] = [];
  let damage = 0;
  let interrupt = false;
  let next = level;
  if (level >= HUNGER_STARVING) {
    if (rngFloat01 < 0.3 && (hp > 1 || !paralysed)) {
      messages.push(MSG_STARVING); // GLog.n(TXT_STARVING), Hunger.java:66
      damage = 1;
      interrupt = true;
    }
  } else {
    const newLevel = level + HUNGER_STEP - satietyBonus;
    if (newLevel >= HUNGER_STARVING) {
      messages.push(MSG_STARVING); // GLog.n(TXT_STARVING), Hunger.java:82
      interrupt = true;
    } else if (newLevel >= HUNGER_HUNGRY && level < HUNGER_HUNGRY) {
      messages.push(MSG_HUNGRY); // GLog.w(TXT_HUNGRY), Hunger.java:89
    }
    next = newLevel;
  }
  const step = isRogue ? HUNGER_STEP * 1.2 : HUNGER_STEP;
  return {
    level: next,
    damage,
    messages,
    interrupt,
    spend: hasShadows ? step * 1.5 : step,
  };
}

/**
 * Hunger.satisfy(energy) (Hunger.java:114-122): level -= energy, clamped to
 * [0, STARVING].
 */
export function hungerSatisfy(level: number, energy: number): number {
  const next = level - energy;
  if (next < 0) return 0;
  if (next > HUNGER_STARVING) return HUNGER_STARVING;
  return next;
}

/**
 * Buff display names (each buff's toString()). Buffs without a toString()
 * override fall back to the class name (Awareness, Speed, Regeneration).
 */
export const BUFF_NAMES: Record<BuffKind, string> = {
  burning: 'Burning',
  poison: 'Poisoned',
  paralysis: 'Paralysed',
  sleep: 'Asleep',
  roots: 'Rooted',
  ooze: 'Oozed',
  bleeding: 'Bleeding',
  cripple: 'Crippled',
  blindness: 'Blinded', // Blindness.java:41-43
  hunger: 'Hungry', // Hunger.java:136-141 (level-dependent; base name)
  regeneration: 'Regeneration',
  frost: 'Frozen', // Frost.java:67-69
  levitation: 'Levitating', // Levitation.java:50-52
  invisibility: 'Invisible', // Invisibility.java:49-51
  mindvision: 'Mind vision', // MindVision.java:31-33
  gasesimmunity: 'Immune to gases', // GasesImmunity.java:31-33
  terror: 'Terror', // Terror.java:48-50
  rage: 'Blinded with rage', // Rage.java:29-31
  amok: 'Amok', // Amok.java:28-30
  ring_mending: 'Mending',
  ring_detection: 'Detection',
  ring_shadows: 'Shadows',
  ring_power: 'Power',
  ring_herbalism: 'Herbalism',
  ring_accuracy: 'Accuracy',
  ring_evasion: 'Evasion',
  ring_satiety: 'Satiety',
  ring_haste: 'Haste',
  ring_haggler: 'Haggler',
  ring_elements: 'Elements',
  ring_thorns: 'Thorns',
  slow: 'Slowed',
  vertigo: 'Vertigo',
  charm: 'Charmed', // Charm.java:48-50
  deferredDamage: 'Deferred damage',
  earthrootArmor: 'Earthen armor',
  weakness: 'Weakened', // Weakness.java:30-32
  speed: 'Speed',
  sacrificeMarked: 'Marked for sacrifice', // SacrificialFire.Marked
  // Stage 3 subclass buffs (actors/buffs/{Fury,Combo,Shadows,SnipersMark}.java
  // toString()); state/logic lives in mechanics/subclass_buffs.ts.
  fury: 'Fury', // Fury.java:43-45
  combo: 'Combo', // Combo.java:37-39
  shadows: 'Shadowmelded', // Shadows.java:92-94
  snipersmark: 'Zeroed in', // SnipersMark.java:48-50
  awareness: 'Awareness', // Awareness.java: no toString override; class name
};

/**
 * BuffKind → original 7x7 buff-icon sprite key (buffs.png, BuffIndicator.java
 * constants). Null = BuffIndicator.NONE: Awareness, Speed and Regeneration
 * have no icon() override, so Buff.icon() returns NONE (Buff.java:50-52);
 * Hunger below HUNGRY returns NONE too. Every key below already exists in
 * ORIGINAL_SPRITES (assets/original_sprites.ts), extracted by
 * scripts/extract_original_sprites.ts with per-key provenance comments —
 * nothing new had to be extracted for this worker's buffs.
 */
export function buffSpriteKey(kind: BuffKind): string | null {
  switch (kind) {
    case 'burning':
      return 'bufficon_fire'; // FIRE=2
    case 'poison':
      return 'bufficon_poison'; // POISON=3
    case 'paralysis':
      return 'bufficon_paralysis'; // PARALYSIS=4
    case 'hunger':
      return 'bufficon_hunger'; // HUNGER=5 (level < STARVING)
    case 'slow':
      return 'bufficon_slow'; // SLOW=7
    case 'ooze':
      return 'bufficon_ooze'; // OOZE=8
    case 'amok':
      return 'bufficon_amok'; // AMOK=9
    case 'terror':
      return 'bufficon_terror'; // TERROR=10
    case 'roots':
      return 'bufficon_roots'; // ROOTS=11
    case 'invisibility':
      return 'bufficon_invisible'; // INVISIBLE=12
    case 'weakness':
      return 'bufficon_weakness'; // WEAKNESS=14
    case 'frost':
      return 'bufficon_frost'; // FROST=15
    case 'blindness':
      return 'bufficon_blindness'; // BLINDNESS=16
    case 'charm':
      return 'bufficon_heart'; // HEART=21
    case 'mindvision':
      return 'bufficon_mind_vision'; // MIND_VISION=0
    case 'levitation':
      return 'bufficon_levitation'; // LEVITATION=1
    case 'gasesimmunity':
      return 'bufficon_immunity'; // IMMUNITY=25
    case 'cripple':
      return 'bufficon_cripple'; // CRIPPLE=23
    case 'bleeding':
      return 'bufficon_bleeding'; // BLEEDING=26
    case 'vertigo':
      return 'bufficon_vertigo'; // VERTIGO=29
    case 'rage':
      return 'bufficon_rage'; // RAGE=30
    case 'sacrificeMarked':
      return 'bufficon_sacrifice'; // SACRIFICE=31
    default:
      return null;
  }
}
