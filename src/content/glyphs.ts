/**
 * Armor glyphs — exact port of items/armor/glyphs/*.java
 * (watabou/pixel-dungeon).
 *
 * Vanilla shape: Armor.proc(attacker, defender, damage) (Armor.java:187-205)
 * runs the glyph proc (which may rewrite the damage — Viscosity returns 0),
 * then Item.use(). Called from Hero.defenseProc (Hero.java:855-865), which
 * first applies Earthroot armor absorption.
 *
 * Glyph selection is uniform: Glyph.random() picks a uniform random class
 * (Glyph.java). Buff helpers (affect/prolong) live in enchantments.ts.
 */

import type { MechanicsRng } from '../mechanics/rng.js';
import {
  effectiveLevel,
  polish,
  TXT_GOING_TO_BREAK,
  TXT_HAS_BROKEN,
  useDurability,
} from '../mechanics/durability.js';
import {
  affectBuff,
  FROST_DURATION,
  prolongBuff,
  reigniteBurning,
  type ProcChar,
  type ProcFx,
} from './enchantments.js';

/** Vanilla Glyph subclasses (uniform random pool, Glyph.java). */
export type GlyphId =
  | 'affection'
  | 'antiEntropy'
  | 'autoRepair'
  | 'bounce'
  | 'displacement'
  | 'entanglement'
  | 'metabolism'
  | 'multiplicity'
  | 'potential'
  | 'stench'
  | 'viscosity';

const GLYPH_ORDER: GlyphId[] = [
  'affection',
  'antiEntropy',
  'autoRepair',
  'bounce',
  'displacement',
  'entanglement',
  'metabolism',
  'multiplicity',
  'potential',
  'stench',
  'viscosity',
];

export const GLYPH_INFO: Record<GlyphId, { name: string }> = {
  affection: { name: '%s of affection' },
  antiEntropy: { name: '%s of anti-entropy' },
  autoRepair: { name: '%s of auto-repair' },
  bounce: { name: '%s of bounce' },
  displacement: { name: '%s of displacement' },
  entanglement: { name: '%s of entanglement' },
  metabolism: { name: '%s of metabolism' },
  multiplicity: { name: '%s of multiplicity' },
  potential: { name: '%s of potential' },
  stench: { name: '%s of stench' },
  viscosity: { name: '%s of viscosity' },
};

/** Glyph.random() (Glyph.java): uniform over the 11 glyphs. */
export function randomGlyphId(rng: MechanicsRng): GlyphId {
  return GLYPH_ORDER[rng.int(0, GLYPH_ORDER.length)]!;
}

/** 8-neighborhood adjacency (Level.adjacent). */
function adjacent(a: ProcChar, b: ProcChar): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && (dx > 0 || dy > 0);
}

/**
 * Affection (Affection.java:30-56): level clamped to [0,6]; adjacent and
 * `Random.Int(level/2 + 5) >= 4` charms the attacker for IntRange(3,7)
 * (object = defender), then charms the defender for that x Random.Float
 * (0.5, 1) — the compound assignment truncates back to int.
 */
function affectionProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  const lvl = Math.max(0, Math.min(level, 6));
  if (adjacent(attacker, defender) && fx.rng.int(0, Math.floor(lvl / 2) + 5) >= 4) {
    let duration = fx.rng.intRange(3, 7);
    affectBuff(attacker, 'charm', duration, { sourceId: defender.id });
    duration = Math.floor(duration * fx.rng.float(0.5, 1));
    affectBuff(defender, 'charm', duration, { sourceId: attacker.id });
  }
  return damage;
}

/**
 * AntiEntropy (AntiEntropy.java:30-47): adjacent and
 * `Random.Int(level + 6) >= 5` frosts the attacker for
 * Frost.duration x Random.Float(1, 1.5) and reignites Burning on the
 * defender.
 */
function antiEntropyProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 6) >= 5) {
    prolongBuff(
      attacker,
      'frost',
      FROST_DURATION * fx.rng.float(1, 1.5),
    );
    reigniteBurning(defender, 8);
  }
  return damage;
}

/**
 * AutoRepair (AutoRepair.java:28-40): if the defender is the hero and his
 * gold covers the armor tier, spend the gold and polish() the armor.
 */
function autoRepairProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  armor: { tier: number; durability?: number; level: number },
): number {
  if (defender.kind === 'hero' && fx.spendGold(armor.tier)) {
    polish(armor, 'armor');
    // fx.polishHeroArmor() is folded into the direct polish above: the
    // armor object IS the hero's equipped armor at the call site.
  }
  return damage;
}

/**
 * Bounce (Bounce.java:28-60): adjacent and `Random.Int(level + 5) >= 4`
 * shoves the attacker one cell farther from the defender when that cell is
 * passable/avoid and unoccupied, then presses it.
 */
function bounceProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
  w: number,
): number {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 5) >= 4) {
    const ofsX = attacker.x - defender.x;
    const ofsY = attacker.y - defender.y;
    const newPos = (attacker.y + ofsY) * w + (attacker.x + ofsX);
    if (fx.isFreeCell(newPos)) {
      attacker.pos = newPos;
      // Actor.addDelayed(new Pushing(...)): visual, renderer-owned.
      fx.pressCell(attacker);
    }
  }
  return damage;
}

/**
 * Displacement (Displacement.java:28-66): no proc chance — runs on every
 * defense proc except on boss levels. Up to (level<0 ? 1 : level+1)*5 tries
 * to teleport the defender to a visible, passable, unoccupied cell.
 */
function displacementProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
  w: number,
  h: number,
): number {
  if (fx.isBossLevel()) {
    return damage;
  }
  const nTries = (level < 0 ? 1 : level + 1) * 5;
  for (let i = 0; i < nTries; i++) {
    const pos = fx.rng.int(0, w * h);
    if (fx.isVisible(pos) && fx.isFreeCell(pos)) {
      fx.teleport(defender, pos);
      // Dungeon.observe() (FOV recompute): engine-owned per action.
      fx.pressCell(defender);
      break;
    }
  }
  return damage;
}

/**
 * Entanglement (Entanglement.java:29-50): flat 1/4 chance roots the
 * defender for 5 - level/5 and sets Earthroot armor to 5*(level+1)
 * (level() only raises).
 */
function entanglementProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (fx.rng.int(0, 4) === 0) {
    prolongBuff(defender, 'roots', 5 - Math.floor(level / 5));
    const armorLevel = 5 * (level + 1);
    const existing = defender.buffs['earthrootArmor'];
    if (existing) {
      // Earthroot.Armor.level(int): only raises (Earthroot.java).
      if (existing.amount === undefined || existing.amount < armorLevel) {
        existing.amount = armorLevel;
      }
    } else if (!defender.immunities.includes('earthrootArmor')) {
      defender.buffs['earthrootArmor'] = {
        kind: 'earthrootArmor',
        left: Number.POSITIVE_INFINITY,
        amount: armorLevel,
      };
    }
  }
  return damage;
}

/**
 * Metabolism (Metabolism.java:30-54): `Random.Int(level/2 + 5) >= 4` heals
 * min(missing HP, Random.Int(1, HT/5)) — but only when the defender is the
 * hero, has hunger, and is not starving. Hunger worsens by STARVING/10.
 */
function metabolismProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (
    defender.kind === 'hero' &&
    !fx.isStarving() &&
    fx.rng.int(0, Math.floor(level / 2) + 5) >= 4
  ) {
    const healing = Math.min(
      defender.ht - defender.hp,
      fx.rng.int(1, Math.floor(defender.ht / 5)),
    );
    if (healing > 0) {
      // Hunger.satisfy(-STARVING/10): hunger worsens by 36 (Hunger.java).
      fx.addHunger(36);
      fx.heal(defender, healing);
      // Speck.HEALING emitter: visual, renderer-owned.
    }
  }
  return damage;
}

/**
 * Multiplicity (Multiplicity.java:30-83): `Random.Int(level/2 + 6) >= 5`.
 * When an adjacent free cell exists, a MirrorImage of the hero defender
 * materializes there and the defender takes Random.IntRange(1, HT/6).
 */
function multiplicityProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
  w: number,
): number {
  if (fx.rng.int(0, Math.floor(level / 2) + 6) >= 5) {
    const candidates: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const pos = (defender.y + dy) * w + (defender.x + dx);
        if (fx.isFreeCell(pos)) candidates.push(pos);
      }
    }
    if (candidates.length > 0 && fx.spawnMirrorImage(defender)) {
      // WandOfBlink.appear(mob, Random.element(respawnPoints)) inside.
      fx.directDamage(
        defender,
        fx.rng.intRange(1, Math.floor(defender.ht / 6)),
        'multiplicity',
      );
      // checkOwner(defender): pet bookkeeping — no pets in the port.
    }
  }
  return damage;
}

/**
 * Potential (Potential.java:28-58): adjacent and
 * `Random.Int(level + 7) >= 6` — lightning hits the attacker for
 * IntRange(1, damage), then the defender for IntRange(1, that damage).
 */
function potentialProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 7) >= 6) {
    const dmg = fx.rng.intRange(1, damage);
    fx.directDamage(attacker, dmg, 'lightning');
    // Lightning arcs: visual, renderer-owned.
    if (attacker.kind === 'hero' || defender.kind === 'hero') {
      // Camera.main.shake(2, 0.3f): visual, renderer-owned.
    }
    fx.directDamage(defender, fx.rng.intRange(1, dmg), 'lightning');
    // checkOwner(defender): pet bookkeeping — no pets in the port.
  }
  return damage;
}

/**
 * Stench (Stench.java:28-44): adjacent and `Random.Int(level + 5) >= 4`
 * seeds 20 ToxicGas at the attacker's position.
 */
function stenchProc(
  fx: ProcFx,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (adjacent(attacker, defender) && fx.rng.int(0, level + 5) >= 4) {
    fx.seedGas(attacker.pos, 20);
  }
  return damage;
}

/**
 * Viscosity (Viscosity.java:30-68): damage 0 passes through. Otherwise
 * `Random.Int(level + 7) >= 6` adds the whole damage to the DeferredDamage
 * pool and returns 0 — the hit is fully deferred (1 damage per tick).
 */
function viscosityProc(
  fx: ProcFx,
  _attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
): number {
  if (damage === 0) {
    return 0;
  }
  if (fx.rng.int(0, level + 7) >= 6) {
    // DeferedDamage.prolong(int): this.damage += damage (Viscosity.java:108).
    const existing = defender.buffs['deferredDamage'];
    if (existing) {
      existing.amount = (existing.amount ?? 0) + damage;
    } else if (!defender.immunities.includes('deferredDamage')) {
      defender.buffs['deferredDamage'] = {
        kind: 'deferredDamage',
        left: Number.POSITIVE_INFINITY,
        amount: damage,
      };
    }
    return 0;
  }
  return damage;
}

/** Per-instance armor state needed by Armor.proc. */
export interface ProcArmor {
  name: string;
  level: number;
  tier: number;
  durability?: number;
  glyph?: GlyphId | null;
}

/**
 * Armor.inscribe() (Armor.java:207-218): assign a random glyph, re-rolling
 * while the new class equals the old one — the glyph always changes.
 */
export function inscribeArmorInstance(
  rng: MechanicsRng,
  armor: { glyph?: GlyphId | null },
): GlyphId {
  let id = randomGlyphId(rng);
  let guard = 0;
  while (id === armor.glyph && guard++ < 100) {
    id = randomGlyphId(rng);
  }
  armor.glyph = id;
  return id;
}

/**
 * Earthroot.Armor.absorb (Earthroot.java): damage >= level detaches and
 * passes damage - level; otherwise the armor soaks it all and loses that
 * much level. Returns [remainingDamage, keepBuff].
 */
export function earthrootAbsorb(
  armorLevel: number,
  damage: number,
): { damage: number; remaining: number } {
  if (damage >= armorLevel) {
    return { damage: damage - armorLevel, remaining: 0 };
  }
  return { damage: 0, remaining: armorLevel - damage };
}

/**
 * Armor.proc (Armor.java:187-205) as run from Hero.defenseProc
 * (Hero.java:855-865): Earthroot absorption first, then the glyph proc
 * (which may rewrite the damage), then Item.use().
 */
export function armorDefenseProc(
  fx: ProcFx,
  armor: ProcArmor,
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  w: number,
  h: number,
): number {
  const level = effectiveLevel(armor);
  // Hero.defenseProc: Earthroot armor absorbs before the glyph.
  const earthroot = defender.buffs['earthrootArmor'];
  if (earthroot && (earthroot.amount ?? 0) > 0) {
    const absorbed = earthrootAbsorb(earthroot.amount ?? 0, damage);
    damage = absorbed.damage;
    if (absorbed.remaining <= 0) {
      delete defender.buffs['earthrootArmor'];
    } else {
      earthroot.amount = absorbed.remaining;
    }
  }
  if (armor.glyph) {
    damage = runGlyph(
      fx,
      armor.glyph,
      armor,
      attacker,
      defender,
      damage,
      level,
      w,
      h,
    );
  }
  // hitsToKnow identification: the port has no ID system (always known).
  const used = useDurability(armor, 'armor', true);
  if (used.warned) {
    fx.log(TXT_GOING_TO_BREAK.replace('%s', armor.name));
  }
  if (used.broke) {
    fx.log(TXT_HAS_BROKEN.replace('%s', armor.name));
  }
  return damage;
}

/** Dispatch one glyph proc. */
function runGlyph(
  fx: ProcFx,
  id: GlyphId,
  armor: { tier: number; durability?: number; level: number },
  attacker: ProcChar,
  defender: ProcChar,
  damage: number,
  level: number,
  w: number,
  h: number,
): number {
  switch (id) {
    case 'affection':
      return affectionProc(fx, attacker, defender, damage, level);
    case 'antiEntropy':
      return antiEntropyProc(fx, attacker, defender, damage, level);
    case 'autoRepair':
      return autoRepairProc(fx, attacker, defender, damage, armor);
    case 'bounce':
      return bounceProc(fx, attacker, defender, damage, level, w);
    case 'displacement':
      return displacementProc(fx, attacker, defender, damage, level, w, h);
    case 'entanglement':
      return entanglementProc(fx, attacker, defender, damage, level);
    case 'metabolism':
      return metabolismProc(fx, attacker, defender, damage, level);
    case 'multiplicity':
      return multiplicityProc(fx, attacker, defender, damage, level, w);
    case 'potential':
      return potentialProc(fx, attacker, defender, damage, level);
    case 'stench':
      return stenchProc(fx, attacker, defender, damage, level);
    case 'viscosity':
      return viscosityProc(fx, attacker, defender, damage, level);
  }
}
