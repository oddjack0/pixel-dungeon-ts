/**
 * Subclass-specific buffs (Stage 3, Worker F).
 *
 * Ground truth: watabou/pixel-dungeon, actors/buffs/{Fury,Combo,Shadows,
 * SnipersMark}.java. Java wins every conflict.
 *
 * These four buffs are the only buffs owned by the subclass system, so they
 * live here rather than in src/mechanics/buffs.ts (owned by another worker —
 * do NOT move them there). Integration note: add
 *   'fury' | 'combo' | 'shadows' | 'snipersmark'
 * to BuffKind in src/mechanics/buffs.ts so these states can sit in
 * hero.buffs; the shapes below are the canonical state for each kind.
 *
 * Conventions (matching the port's pure-mechanics style): every function is
 * a pure function of its inputs; the engine applies the returned results.
 * Durations use Buff.postpone semantics (Actor.postpone, Actor.java:48-52):
 * a re-application sets the remaining time to max(current, new).
 */

/** Buff kinds owned by the subclass system. */
export type SubclassBuffKind = 'fury' | 'combo' | 'shadows' | 'snipersmark';

/** Fury state: no duration — it persists while HP stays at/below the
 *  threshold and detaches itself once healed above it (Fury.act). */
export interface FuryState {
  kind: 'fury';
}

/** Combo state: Combo.count (Combo.java:29) + remaining time. */
export interface ComboState {
  kind: 'combo';
  count: number;
  /** Remaining time (Buff.postpone max semantics). */
  left: number;
}

/** Shadows state: Shadows.left (Shadows.java:23), ticks of shadowmeld left. */
export interface ShadowsState {
  kind: 'shadows';
  left: number;
}

/** Sniper's mark: a FlavourBuff carrying the marked enemy's id
 *  (SnipersMark.object, SnipersMark.java:23). */
export interface SnipersMarkState {
  kind: 'snipersmark';
  left: number;
  /** id() of the marked enemy (SnipersMark.object). */
  object: number;
}

// ---------------------------------------------------------------------------
// Fury (Fury.java) — Berserker.
// ---------------------------------------------------------------------------

/** Fury.LEVEL (Fury.java:25): fury holds while HP <= HT * 0.4. */
export const FURY_LEVEL = 0.4;

/**
 * Fury.act (Fury.java:27-35): detaches when HP rises above HT * LEVEL;
 * otherwise spends a TICK. Returns true when the buff detaches.
 */
export function furyTick(hp: number, ht: number): { detached: boolean } {
  return { detached: hp > ht * FURY_LEVEL };
}

/**
 * Hero.damage berserker branch (Hero.java:873): gains Fury when the hit
 * leaves the hero alive at or below the threshold.
 */
export function furyCheckOnDamage(
  subClass: 'berserker' | string,
  hp: number,
  ht: number,
): boolean {
  return subClass === 'berserker' && hp > 0 && hp <= ht * FURY_LEVEL;
}

/**
 * Hero.damageRoll fury branch (Hero.java:327):
 * `(int)(dmg * 1.5f)` — Java float cast truncates; damage is >= 0 here,
 * so Math.floor is exact.
 */
export function furyDamageBonus(damage: number): number {
  return Math.floor(damage * 1.5);
}

// ---------------------------------------------------------------------------
// Combo (Combo.java) — Gladiator.
// ---------------------------------------------------------------------------

export interface ComboHitResult {
  /** New Combo.count. */
  count: number;
  /** Bonus damage added on top of the hit's damage. */
  bonus: number;
  /** New remaining time (postpone value for this hit). */
  duration: number;
  /** "%d hit combo!" log line (GLog.p, Combo.java:27,49), or null. */
  log: string | null;
  /** Count to feed Badges.validateMasteryCombo (Combo.java:47). */
  badgeCount: number;
}

/**
 * Combo.hit (Combo.java:39-59): called from Hero.attackProc on every
 * successful melee-weapon hit (Hero.java:811-816).
 *   count++
 *   count >= 3: postpone(1.41 - count/10), bonus = (int)(damage*(count-2)/5),
 *               GLog.p "%d hit combo!", Badges.validateMasteryCombo(count)
 *   else:       postpone(1.1), no bonus
 */
export function comboHit(count: number, damage: number): ComboHitResult {
  const next = count + 1;
  if (next >= 3) {
    return {
      count: next,
      bonus: Math.floor((damage * (next - 2)) / 5),
      duration: 1.41 - next / 10,
      log: `${next} hit combo!`,
      badgeCount: next,
    };
  }
  return { count: next, bonus: 0, duration: 1.1, log: null, badgeCount: next };
}

/** Combo.act (Combo.java:61-65): always detaches — the buff only survives
 *  via postpone() on each consecutive hit. */
export function comboTickDetaches(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Shadows (Shadows.java) — Assassin stealth (shadowmeld).
// ---------------------------------------------------------------------------

/** Shadows.prolong (Shadows.java:76-78): left = 2. */
export const SHADOWS_PROLONG_TICKS = 2;

export interface ShadowsTickResult {
  left: number;
  detached: boolean;
}

/**
 * Shadows.act (Shadows.java:56-74): spends TICK*2 each act; detaches when
 * the target dies, when --left reaches 0, or when any enemy is visible
 * (Dungeon.hero.visibleEnemies() > 0).
 *
 * Shadows extends Invisibility (Shadows.java:21): while attached the hero
 * counts as invisible (Char.invisible++, Invisibility.attachTo,
 * Invisibility.java:31; Mob.canSee requires enemy.invisible <= 0,
 * Mob.java:151). The SND_MELD + Dungeon.observe() on attach/detach are
 * presentation (Shadows.java:41-54).
 */
export function shadowsTick(
  alive: boolean,
  visibleEnemies: number,
  left: number,
): ShadowsTickResult {
  if (!alive) {
    return { left, detached: true };
  }
  const next = left - 1;
  return { left: next, detached: next <= 0 || visibleEnemies > 0 };
}

// ---------------------------------------------------------------------------
// Sniper's mark (SnipersMark.java) — Sniper.
// ---------------------------------------------------------------------------

/**
 * Mark duration applied in Hero.attackProc (Hero.java:835):
 * `Buff.prolong(this, SnipersMark.class, attackDelay() * 1.1f)`.
 */
export function snipersMarkDuration(attackDelay: number): number {
  return attackDelay * 1.1;
}

export interface SniperThrowResult {
  /** Throw delay after the mark interaction. */
  delay: number;
  /** The mark is always consumed when a missile is thrown at an enemy
   *  while marked (Item.cast, Item.java:559-567). */
  markConsumed: boolean;
}

/**
 * Item.cast missile-throw branch (Item.java:555-568): when throwing a
 * missile weapon at an enemy while marked, the mark is removed; the throw
 * delay is halved iff the marked object is the target.
 */
export function sniperMarkThrow(
  markObject: number | null,
  enemyId: number,
  baseDelay: number,
): SniperThrowResult {
  if (markObject === null) {
    return { delay: baseDelay, markConsumed: false };
  }
  return {
    delay: markObject === enemyId ? baseDelay * 0.5 : baseDelay,
    markConsumed: true,
  };
}

// ---------------------------------------------------------------------------
// Display strings (toString / BuffIndicator icons).
// ---------------------------------------------------------------------------

/** Combo.toString (Combo.java:37). Icon: bufficon_combo (BuffIndicator.COMBO). */
export const COMBO_NAME = 'Combo';
/** Fury.toString (Fury.java:43). Icon: bufficon_fury (BuffIndicator.FURY). */
export const FURY_NAME = 'Fury';
/** Shadows.toString (Shadows.java:83). Icon: bufficon_shadows (BuffIndicator.SHADOWS). */
export const SHADOWS_NAME = 'Shadowmelded';
/** SnipersMark.toString (SnipersMark.java:47). Icon: bufficon_mark (BuffIndicator.MARK). */
export const SNIPERS_MARK_NAME = 'Zeroed in';
/** "%d hit combo!" (Combo.java:27). */
export const COMBO_MESSAGE = '%d hit combo!';

/** Format the combo log line (GLog.p, Combo.java:49). */
export function comboMessage(count: number): string {
  return COMBO_MESSAGE.replace('%d', String(count));
}
