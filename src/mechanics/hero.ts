/**
 * Hero formulas, ported from Hero.java / HeroClass.java / Weapon.java.
 *
 * Warrior start (HeroClass.initWarrior, HeroClass.java:133-137):
 *   STR 11, ShortSword (identified, equipped), 8 Darts (identified).
 * initCommon (HeroClass.java:119-123): ClothArmor (identified, equipped),
 *   1 Food (identified), Keyring.
 * Base stats (Hero.java:139-141, 173-174): attackSkill 10, defenseSkill 5,
 *   HP = HT = 20, STR = STARTING_STR (10) + 1 = 11.
 *
 * Hero subclass hooks are NOT needed for M1 (Gladiator/Berserker/etc. are
 * later milestones); attackProc subclass cases are omitted by design.
 */
import type { ArmorDef, Hero, WeaponDef } from './char';
import { charSpeed, strEff } from './char';
import type { MechanicsRng } from './rng';
import { eraseArmorMagic, eraseWeaponMagic, upgradeItem } from './durability.js';

/** ShortSword: tier 1 (super(1, 1f, 1f), ShortSword.java:54-55), STR 11
 *  (ShortSword.java:57); min = min0() = tier = 1 (MeleeWeapon.java:41-42);
 *  max = max0() = 12 at level 0 (ShortSword.java:60-62 overrides MeleeWeapon
 *  max0; MeleeWeapon.max(): max0 + level*tier, MeleeWeapon.java:55-57). */
export const SHORT_SWORD: WeaponDef = {
  name: 'short sword',
  tier: 1,
  level: 0,
  min: 1,
  max: 12,
  str: 11,
  acu: 1,
  dly: 1,
  missile: false,
};

/** Dart: min 1 / max 4 (Dart.java:41-46); STR default 10 (Weapon.java:47). */
export const DART: WeaponDef = {
  name: 'dart',
  tier: 1,
  level: 0,
  min: 1,
  max: 4,
  str: 10,
  acu: 1,
  dly: 1,
  missile: true,
};

/** ClothArmor: tier 1 (ClothArmor.java:30-32); STR = typicalSTR() = 7 + tier*2
 *  = 9 (Armor.java:289-291); DR() = tier * (2 + effectiveLevel()) = 2 at
 *  level 0 (Armor.java:145-147). */
export const CLOTH_ARMOR: ArmorDef = {
  name: 'cloth armor',
  level: 0,
  str: 9,
  dr: 2,
  tier: 1,
};

/** Create a fresh level-1 Warrior, exactly as HeroClass.initWarrior does. */
export function createWarrior(id: number, pos: number): Hero {
  return {
    kind: 'hero',
    id,
    pos,
    hp: 20,
    ht: 20,
    sprite: 'hero_warrior',
    paralysed: false,
    rooted: false,
    flying: false,
    buffs: {},
    str: 11,
    weakened: false,
    lvl: 1,
    exp: 0,
    attackSkill: 10,
    defenseSkill: 5,
    weapon: { ...SHORT_SWORD },
    armor: { ...CLOTH_ARMOR },
    rangedWeapon: null,
    darts: 8,
  };
}

export type HeroClassId = 'warrior'; // M1: warrior only

/**
 * Weapon accuracy factor (Weapon.acuracyFactor, Weapon.java:101-119).
 *   encumbrance = STR - hero.STR(); missile weapons: warrior +3
 *   (huntress -2; M1 has no huntress, kept as a parameter for later).
 *   factor = encumbrance > 0 ? ACU / 1.5^encumbrance : ACU
 * M1: no Accuracy imbue.
 */
export function accuracyFactor(
  weapon: WeaponDef,
  heroStr: number,
  heroClass: HeroClassId = 'warrior',
): number {
  let encumbrance = weapon.str - heroStr;
  if (weapon.missile) {
    if (heroClass === 'warrior') encumbrance += 3;
  }
  return encumbrance > 0 ? weapon.acu / Math.pow(1.5, encumbrance) : weapon.acu;
}

/**
 * Weapon speed factor (Weapon.speedFactor, Weapon.java:123-133).
 *   factor = encumbrance > 0 ? DLY * 1.2^encumbrance : DLY
 * M1: no Speed imbue; warrior gets no missile STR reduction (huntress-only).
 */
export function speedFactor(weapon: WeaponDef, heroStr: number): number {
  const encumbrance = weapon.str - heroStr;
  return encumbrance > 0 ? weapon.dly * Math.pow(1.2, encumbrance) : weapon.dly;
}

/**
 * Hero attack skill (Hero.attackSkill, Hero.java:256-274).
 *   attackSkill * accuracy * wep.acuracyFactor(hero)
 * M1: no RingOfAccuracy (accuracy = 1); ranged throws at distance 1 halve
 * accuracy (Hero.java:262-264).
 */
export function heroAttackSkill(
  hero: Hero,
  opts: { ranged: boolean; adjacent: boolean; accuracyBonus?: number },
): number {
  let accuracy = 1;
  if (opts.ranged && opts.adjacent) accuracy *= 0.5;
  // RingOfAccuracy (Hero.java:261-264): accuracy *= 1.4^bonus (bonus = sum
  // of equipped Accuracy ring levels; 1.4^0 == 1 so the default is exact).
  accuracy *= accuracyMultiplier(opts.accuracyBonus ?? 0);
  const wep = opts.ranged ? hero.rangedWeapon ?? DART : hero.weapon;
  if (wep) {
    return Math.floor(hero.attackSkill * accuracy * accuracyFactor(wep, strEff(hero)));
  }
  return Math.floor(hero.attackSkill * accuracy);
}

/**
 * Ring of Accuracy multiplier (RingOfAccuracy.java:39-44):
 * `bonus == 0 ? 1 : 1.4^bonus`.
 */
export function accuracyMultiplier(bonus: number): number {
  return bonus === 0 ? 1 : Math.pow(1.4, bonus);
}

/**
 * Ring of Evasion multiplier (RingOfEvasion.java:39-44):
 * `bonus == 0 ? 1 : 1.2^bonus`.
 */
export function evasionMultiplier(bonus: number): number {
  return bonus === 0 ? 1 : Math.pow(1.2, bonus);
}

/**
 * Ring of Haste time multiplier (Hero.spend, Hero.java:358-364):
 * `hasteLevel == 0 ? 1 : 1.1^-hasteLevel`. Vanilla scales the spent time;
 * the port's scheduler divides cost by getTimeScale(), so the hero's time
 * scale is MULTIPLIED by 1.1^hasteLevel — exactly equivalent.
 */
export function hasteTimeMultiplier(hasteLevel: number): number {
  return hasteLevel === 0 ? 1 : Math.pow(1.1, -hasteLevel);
}

/**
 * Ring of Detection search radius (Hero.search, Hero.java:1301-1311):
 * `distance = 1 + positive + negative` where positive is the highest
 * positive Detection level and negative the sum of the negative levels.
 * When distance <= 0 the discovery chance is divided by (2 - distance)
 * and the search uses distance 1.
 */
export function detectionSearch(
  detectionLevels: number[],
  awareness: number,
  intentional: boolean,
): { distance: number; level: number } {
  const positive = detectionLevels.reduce((m, l) => (l > 0 ? Math.max(m, l) : m), 0);
  const negative = detectionLevels.reduce((s, l) => (l < 0 ? s + l : s), 0);
  let distance = 1 + positive + negative;
  let level = intentional
    ? intentionalSearchLevel(awareness)
    : passiveSearchLevel(awareness);
  if (distance <= 0) {
    level /= 2 - distance;
    distance = 1;
  }
  return { distance, level };
}

/**
 * Hero defense skill (Hero.defenseSkill, Hero.java:276-305).
 * M1: no RingOfEvasion (evasion = 1); non-rogue, so when armor STR - STR() <= 0
 * the result is simply defenseSkill (Hero.java:301-303). ClothArmor STR 9 vs
 * warrior STR 11 gives aEnc = -2, so defenseSkill = 5.
 * Paralysed halves evasion (Hero.java:283-285).
 * Stage 2: `evasionBonus` is the sum of equipped RingOfEvasion levels
 * (Hero.java:281: evasion *= 1.2^bonus when bonus != 0).
 */
export function heroDefenseSkill(
  hero: Hero,
  opts: { evasionBonus?: number } = {},
): number {
  let evasion = evasionMultiplier(opts.evasionBonus ?? 0);
  if (hero.paralysed) evasion /= 2; // Hero.java:283-285
  const aEnc = hero.armor ? hero.armor.str - strEff(hero) : 0;
  if (aEnc > 0) {
    return Math.floor((hero.defenseSkill * evasion) / Math.pow(1.5, aEnc));
  }
  return Math.floor(hero.defenseSkill * evasion);
}

/** Hero damage absorption (Hero.dr, Hero.java:307-315). M1: armor DR only.
 *  Armor.DR() = tier * (2 + effectiveLevel()) (Armor.java:145-147); the
 *  M1 cloth armor (tier 1) stores its level-0 DR (2) in the def, so the
 *  effective DR is simply dr + level. */
export function heroDR(hero: Hero): number {
  return hero.armor ? Math.max(hero.armor.dr + hero.armor.level, 0) : 0;
}

/**
 * Weapon damage roll (Weapon.damageRoll, Weapon.java:136-149 over
 * KindOfWeapon.damageRoll = Random.NormalIntRange(min, max),
 * KindOfWeapon.java:94-96).
 * Strength bonus applies when (rangedWeapon != null) == (class == HUNTRESS)
 * (Weapon.java:141). For the M1 warrior:
 *   melee  -> (false == false) = true,  exStr = 11 - 11 = 0 -> no bonus
 *   thrown -> (true  == false) = false -> no bonus
 * So both stay pure NormalIntRange(min, max). Kept parametric for later.
 */
export function weaponDamageRoll(
  rng: MechanicsRng,
  weapon: WeaponDef,
  opts: { str: number; ranged: boolean; heroClass?: HeroClassId | 'huntress' },
): number {
  // MeleeWeapon.min(): min0() + level() (MeleeWeapon.java:52-54);
  // MeleeWeapon.max(): max0() + level() * tier (MeleeWeapon.java:55-57).
  let damage = rng.normalIntRange(
    weapon.min + weapon.level,
    weapon.max + weapon.level * weapon.tier,
  );
  const isHuntress = opts.heroClass === 'huntress';
  if (opts.ranged === isHuntress) {
    const exStr = opts.str - weapon.str;
    if (exStr > 0) damage += rng.intRange(0, exStr);
  }
  return damage;
}

/**
 * Hero damage roll (Hero.damageRoll, Hero.java:317-327).
 * Unarmed: STR() > 10 ? Random.IntRange(1, STR() - 9) : 1 (Hero.java:323).
 * M1: no Fury (subclass later).
 */
export function heroDamageRoll(
  rng: MechanicsRng,
  hero: Hero,
  opts: { ranged: boolean },
): number {
  const wep = opts.ranged ? hero.rangedWeapon ?? DART : hero.weapon;
  if (wep) {
    return weaponDamageRoll(rng, wep, { str: strEff(hero), ranged: opts.ranged });
  }
  const s = strEff(hero);
  return s > 10 ? rng.intRange(1, s - 9) : 1;
}

/** Attack delay for the current weapon (Hero.attackDelay, Hero.java:349-359). */
export function heroAttackDelay(hero: Hero, opts: { ranged: boolean }): number {
  const wep = opts.ranged ? hero.rangedWeapon ?? DART : hero.weapon;
  return wep ? speedFactor(wep, strEff(hero)) : 1;
}

/**
 * Weapon.upgrade(boolean) (Weapon.java:150-164): the erasure check runs
 * FIRST at the pre-upgrade level when not enchant-preserving, then
 * Item.upgrade() (Item.java:265-274: uncurses, cursedKnown, +1 level,
 * fix()). Weapon.upgrade keeps STR (no STR change). ScrollOfUpgrade passes
 * enchant=false; the scroll-of-enchantment path would pass true.
 */
export function upgradeWeapon(
  weapon: WeaponDef,
  rng: MechanicsRng,
  opts: { preserveEnchant?: boolean; log?: (msg: string) => void } = {},
): void {
  eraseWeaponMagic(
    weapon,
    rng,
    opts.preserveEnchant ?? false,
    opts.log ?? (() => undefined),
  );
  upgradeItem(weapon, 'weapon');
}

/**
 * Armor.upgrade(boolean) (Armor.java:150-168): erasure check at the
 * pre-upgrade level, then STR-- (Armor.java:167), then Item.upgrade().
 */
export function upgradeArmor(
  armor: ArmorDef,
  rng: MechanicsRng,
  opts: { preserveGlyph?: boolean; log?: (msg: string) => void } = {},
): void {
  eraseArmorMagic(
    armor,
    rng,
    opts.preserveGlyph ?? false,
    opts.log ?? (() => undefined),
  );
  armor.str -= 1;
  upgradeItem(armor, 'armor');
}

/** Display name with the vanilla "+N" upgrade suffix (e.g. "short sword +2"). */
export function gearDisplayName(
  def: Pick<WeaponDef, 'name' | 'level'>,
): string {
  return def.level > 0 ? `${def.name} +${def.level}` : def.name;
}

/**
 * Awareness recompute (Hero.updateAwareness, Hero.java:1064-1069):
 *   awareness = 1 - (rogue ? 0.85 : 0.90) ^ ((1 + min(lvl, 9)) * 0.5)
 * NOT +1/lvl: it is a diminishing curve (0.1 at lvl 1 -> ~0.41 by lvl 9).
 * Called from Hero.earnExp whenever lvl < 10 (Hero.java:1032-1034) and from
 * restoreFromBundle (Hero.java:221). M1 is warrior-only (rogue = false).
 */
export function updateAwareness(lvl: number, rogue: boolean): number {
  return (
    1 - Math.pow(rogue ? 0.85 : 0.9, (1 + Math.min(lvl, 9)) * 0.5)
  );
}

/**
 * Hero speed (Hero.speed, Hero.java:328-341):
 *   aEnc = armor.STR - STR(); aEnc > 0 -> super.speed() * 1.3^-aEnc.
 * super.speed() is Char.speed (cripple x0.5). M1: no Freerunner subclass
 * sprint (that branch is subclass-gated in vanilla); warrior base is 1.
 */
export function heroSpeed(hero: Hero): number {
  const base = charSpeed(hero);
  const aEnc = hero.armor ? hero.armor.str - strEff(hero) : 0;
  return aEnc > 0 ? base * Math.pow(1.3, -aEnc) : base;
}

/** Intentional-search discovery chance (Hero.search, Hero.java:1311). */
export function intentionalSearchLevel(awareness: number): number {
  return 2 * awareness - awareness * awareness;
}

/** Passive-search discovery chance (Hero.search, Hero.java:1311). */
export function passiveSearchLevel(awareness: number): number {
  return awareness;
}

/**
 * Intentional-search time cost (Hero.search, Hero.java:1373-1379;
 * TIME_TO_SEARCH = 2, Hero.java:134): nothing found -> 2; something found
 * -> 2, or 4 when Random.Float() >= discovery level.
 */
export function searchTimeCost(
  rng: MechanicsRng,
  found: boolean,
  level: number,
): number {
  if (!found) {
    return 2;
  }
  return rng.float(0, 1) < level ? 2 : 4;
}

/**
 * Vertigo step redirect (Char.move, Char.java:474-482): when the char has
 * Vertigo and the intended step is adjacent, the step is replaced by a
 * random one of the 8 neighbors (step = pos + NEIGHBOURS8[Random.Int(8)]).
 * Returns null when the redirected cell is not (passable or avoid) or is
 * occupied -- the move is then cancelled but the turn is still spent
 * (Hero.act still calls spend(1 / speed()), Hero.java:949).
 * M1: no `avoid` tiles (no blobs yet), so `blocked` covers passable +
 * occupancy exactly as vanilla's combined check.
 */
export function vertigoRedirect(
  rng: MechanicsRng,
  pos: number,
  width: number,
  blocked: (pos: number) => boolean,
): number | null {
  const dx = [1, -1, 0, 0, 1, 1, -1, -1]; // Level.NEIGHBOURS8 order
  const dy = [0, 0, 1, -1, 1, -1, 1, -1]; // (Level.java:89): +1,-1,+W,-W,+1+W,+1-W,-1+W,-1-W
  const i = rng.int(0, 8);
  const step = pos + dx[i]! + dy[i]! * width;
  if (step < 0 || blocked(step)) {
    return null;
  }
  return step;
}
