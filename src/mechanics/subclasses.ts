/**
 * Hero subclass system (Stage 3, Worker F).
 *
 * Ground truth: watabou/pixel-dungeon,
 *   actors/hero/HeroSubClass.java (enum + titles + descriptions),
 *   actors/hero/Hero.java (attackProc switch, damage fury check,
 *     defenseSkill freerunner branch, speed freerunner branch,
 *     damageRoll fury branch, earnExp warlock branch, name()),
 *   actors/Char.java (sniper armor-piercing dr branch),
 *   actors/mobs/Mob.java (assassin surprise-attack defenseProc),
 *   actors/blobs/Foliage.java (shadows on high grass),
 *   levels/features/HighGrass.java (warden barkskin),
 *   plants/Plant.java (warden seed/dewdrop drops),
 *   items/Item.java (sniper's mark throw-delay branch),
 *   items/TomeOfMastery.java + windows/WndChooseWay.java (the tome).
 * Java wins every conflict.
 *
 * Only the Warrior's tree (Gladiator/Berserker) is reachable in the current
 * build; all eight subclasses are implemented faithfully anyway — the
 * Mage/Rogue/Huntress branches activate with those classes (Stage 5) with
 * no changes needed here.
 *
 * Conventions: pure functions of explicit inputs (the port's mechanics
 * style); the engine applies the returned mutations. Where vanilla has an
 * upstream quirk (the BATTLEMAGE -> SNIPER switch fall-through), it is
 * preserved and cited — exact copy means exact copy.
 *
 * Integration contract (for the worker that wires these into the engine):
 * add `subClass: HeroSubClass` to the Hero interface (mechanics/char.ts)
 * and thread it through; add the four SubclassBuffKinds to BuffKind
 * (mechanics/buffs.ts). No edits to those files were made here.
 */

import type { MechanicsRng } from './rng';
import { FURY_LEVEL, comboHit, furyDamageBonus } from './subclass_buffs.js';

/** HeroSubClass.java: the nine values, in declaration order. */
export type HeroSubClass =
  | 'none'
  | 'gladiator'
  | 'berserker'
  | 'battlemage'
  | 'warlock'
  | 'assassin'
  | 'freerunner'
  | 'sniper'
  | 'warden';

/**
 * Subclass titles (HeroSubClass.java constructor args), verbatim.
 * NONE has null title/desc in vanilla.
 */
export const SUBCLASS_TITLES: Record<Exclude<HeroSubClass, 'none'>, string> = {
  gladiator: 'gladiator',
  berserker: 'berserker',
  warlock: 'warlock',
  battlemage: 'battlemage',
  assassin: 'assassin',
  freerunner: 'freerunner',
  sniper: 'sniper',
  warden: 'warden',
};

/**
 * Subclass descriptions (HeroSubClass.java), verbatim — including the
 * _underscore_ emphasis markers (vanilla HighlightedText).
 */
export const SUBCLASS_DESCS: Record<Exclude<HeroSubClass, 'none'>, string> = {
  gladiator:
    'A successful attack with a melee weapon allows the _Gladiator_ to start a combo, ' +
    'in which every next successful hit inflicts more damage.',
  berserker:
    'When severely wounded, the _Berserker_ enters a state of wild fury ' +
    'significantly increasing his damage output.',
  warlock:
    'After killing an enemy the _Warlock_ consumes its soul. ' +
    'It heals his wounds and satisfies his hunger.',
  battlemage:
    'When fighting with a wand in his hands, the _Battlemage_ inflicts additional damage depending ' +
    'on the current number of charges. Every successful hit restores 1 charge to this wand.',
  assassin:
    'When performing a surprise attack, the _Assassin_ inflicts additional damage to his target.',
  freerunner:
    'The _Freerunner_ can move almost twice faster, than most of the monsters. When he ' +
    'is running, the Freerunner is much harder to hit. For that he must be unencumbered and not starving.',
  sniper:
    '_Snipers_ are able to detect weak points in an enemy\'s armor, ' +
    'effectively ignoring it when using a missile weapon.',
  warden:
    'Having a strong connection with forces of nature gives _Wardens_ an ability to gather dewdrops and ' +
    'seeds from plants. Also trampling a high grass grants them a temporary armor buff.',
};

/** Capitalize like Utils.capitalize (Utils.java:24-26). */
export function capitalizeTitle(title: string): string {
  return title.length === 0 ? title : title[0]!.toUpperCase() + title.slice(1);
}

/** Hero classes that can read the tome (TomeOfMastery.execute switch). */
export type TomeHeroClass = 'warrior' | 'mage' | 'rogue' | 'huntress';

/**
 * The two subclass choices offered per hero class
 * (TomeOfMastery.execute, TomeOfMastery.java:61-74).
 */
export const TOME_CHOICES: Record<TomeHeroClass, [HeroSubClass, HeroSubClass]> =
  {
    warrior: ['gladiator', 'berserker'],
    mage: ['battlemage', 'warlock'],
    rogue: ['assassin', 'freerunner'],
    huntress: ['sniper', 'warden'],
  };

/** Hero display name (Hero.java:234): subclass title once chosen. */
export function heroDisplayName(
  subClass: HeroSubClass,
  heroClassTitle: string,
): string {
  return subClass === 'none' ? heroClassTitle : SUBCLASS_TITLES[subClass];
}

// ---------------------------------------------------------------------------
// Tome of Mastery / Tome of Remastery (items/TomeOfMastery.java)
// ---------------------------------------------------------------------------

/** TomeOfMastery.TIME_TO_READ (TomeOfMastery.java:26). */
export const TIME_TO_READ = 10;

/** TomeOfMastery.TXT_BLINDED (TomeOfMastery.java:24). */
export const TOME_BLINDED_MSG = "You can't read while blinded";

/** TomeOfMastery.AC_READ (TomeOfMastery.java:28). */
export const TOME_READ_ACTION = 'READ';

/**
 * Tome name (TomeOfMastery.java:32): "Tome of Remastery" once the hero has
 * a subclass, otherwise "Tome of Mastery".
 */
export function tomeDisplayName(subClass: HeroSubClass): string {
  return subClass === 'none' ? 'Tome of Mastery' : 'Tome of Remastery';
}

/**
 * Which choice window the tome shows (TomeOfMastery.read, TomeOfMastery.java:116-124):
 * - subClass == first choice  -> respec window offering only the second
 * - subClass == second choice -> respec window offering only the first
 * - otherwise                 -> initial window offering both
 */
export function tomeChoices(
  heroClass: TomeHeroClass,
  subClass: HeroSubClass,
): { respec: boolean; options: HeroSubClass[] } {
  const [sc1, sc2] = TOME_CHOICES[heroClass];
  if (subClass === sc1) return { respec: true, options: [sc2!] };
  if (subClass === sc2) return { respec: true, options: [sc1!] };
  return { respec: false, options: [sc1!, sc2!] };
}

/** "Which way will you follow?" (WndChooseWay, WndChooseWay.java:38). */
export const WND_MASTERY_TITLE = 'Which way will you follow?';
/** "I'll decide later" (WndChooseWay.java:39). */
export const WND_MASTERY_CANCEL = "I'll decide later";
/** "Do you want to respec into %s?" (WndChooseWay.java:77). */
export const WND_REMASTERY_PROMPT = 'Do you want to respec into %s?';
/** "Yes, I want to respec" (WndChooseWay.java:79). */
export const WND_REMASTERY_OK = 'Yes, I want to respec';
/** "Maybe later" (WndChooseWay.java:80). */
export const WND_REMASTERY_CANCEL = 'Maybe later';

/**
 * Respec prompt text: Utils.format(TXT_REMASTERY, Utils.indefinite(way.title()))
 * (WndChooseWay.java:84). Utils.indefinite prefixes "a "/"an " (Utils.java:34-40).
 */
export function respecPrompt(subClass: Exclude<HeroSubClass, 'none'>): string {
  const title = SUBCLASS_TITLES[subClass];
  const article = 'aoeiu'.includes(title[0]!.toLowerCase()) ? 'an' : 'a';
  return WND_REMASTERY_PROMPT.replace('%s', `${article} ${title}`);
}

export interface TomeChooseResult {
  subClass: HeroSubClass;
  /** Time spent reading (TomeOfMastery.choose: curUser.spend(TIME_TO_READ)). */
  timeCost: number;
  /** "You have chosen the way of the %s!" (TomeOfMastery.java:133). */
  log: string;
  /** Berserker chosen while at/below the fury threshold gains Fury immediately
   *  (TomeOfMastery.java:136-138). Note: no 0 < HP guard here, unlike Hero.damage. */
  gainFury: boolean;
}

/**
 * TomeOfMastery.choose (TomeOfMastery.java:126-140): the tome is detached
 * from the backpack, the hero spends TIME_TO_READ, subClass is set, and a
 * Berserker at/below the fury threshold gains Fury.
 */
export function tomeChoose(
  way: Exclude<HeroSubClass, 'none'>,
  hp: number,
  ht: number,
): TomeChooseResult {
  return {
    subClass: way,
    timeCost: TIME_TO_READ,
    log: `You have chosen the way of the ${capitalizeTitle(SUBCLASS_TITLES[way])}!`,
    gainFury: way === 'berserker' && hp <= ht * FURY_LEVEL,
  };
}

/**
 * Whether the tome drops from Tengu (Tengu.die, Tengu.java:95-97): dropped
 * unless the class mastery badge is already unlocked AND the hero already
 * has a subclass.
 */
export function tomeDropsOnTenguKill(
  masteryBadgeUnlocked: boolean,
  subClass: HeroSubClass,
): boolean {
  return !masteryBadgeUnlocked || subClass !== 'none';
}

// ---------------------------------------------------------------------------
// Hero.attackProc subclass switch (Hero.java:803-841)
// ---------------------------------------------------------------------------

export interface SubclassAttackInput {
  subClass: HeroSubClass;
  /** wep = rangedWeapon ?? weapon; true when wep instanceof MeleeWeapon. */
  wepIsMeleeWeapon: boolean;
  /** True when wep instanceof Wand. */
  wepIsWand: boolean;
  /** True when a missile weapon is being thrown (rangedWeapon != null). */
  hasRangedWeapon: boolean;
  /** Battlemage: the wand's curCharges. */
  wandCurCharges: number;
  /** Battlemage: the wand's maxCharges. */
  wandMaxCharges: number;
  /** Hero.attackDelay() — feeds the sniper's mark duration. */
  attackDelay: number;
  /** The enemy's Actor id — feeds SnipersMark.object. */
  enemyId: number;
  /** Current Combo.count (0 when the hero has no Combo buff). */
  comboCount: number;
  /** Effective damage after armor — the attackProc input damage. */
  damage: number;
}

export interface SubclassAttackResult {
  damage: number;
  combo: {
    count: number;
    bonus: number;
    duration: number;
    log: string | null;
    badgeCount: number;
  } | null;
  /**
   * Battlemage wand mutation: chargeDelta is added to curCharges;
   * wandUsed means wand.use() was called (Item.use durability tick,
   * Item.java:300); rechargingFx is ScrollOfRecharging.charge's visual
   * (ScrollOfRecharging.java:61-63, presentation only).
   */
  wand: { chargeDelta: number; wandUsed: boolean; rechargingFx: boolean } | null;
  /** Sniper's mark to apply (prolonged attackDelay()*1.1, object = enemy id). */
  sniperMark: { object: number; duration: number } | null;
}

/**
 * Hero.attackProc subclass cases (Hero.java:803-841), exact including the
 * upstream quirk: the BATTLEMAGE case has NO break, so it falls through
 * into SNIPER — a Battlemage throwing a missile weapon applies a sniper's
 * mark (the SNIPER body only checks rangedWeapon != null, not the
 * subclass). Preserved verbatim per the exact-copy mandate.
 */
export function heroSubclassAttackProc(
  input: SubclassAttackInput,
): SubclassAttackResult {
  let damage = input.damage;
  let combo: SubclassAttackResult['combo'] = null;
  let wand: SubclassAttackResult['wand'] = null;
  let sniperMark: SubclassAttackResult['sniperMark'] = null;

  // GLADIATOR (Hero.java:811-816)
  if (input.subClass === 'gladiator' && input.wepIsMeleeWeapon) {
    const hit = comboHit(input.comboCount, damage);
    damage += hit.bonus;
    combo = hit;
  }

  // BATTLEMAGE (Hero.java:817-833) — falls through to SNIPER below.
  if (input.subClass === 'battlemage' && input.wepIsWand) {
    let cur = input.wandCurCharges;
    let used = false;
    let delta = 0;
    if (cur >= input.wandMaxCharges) {
      used = true; // wand.use() — durability tick, charges unchanged
    } else if (damage > 0) {
      delta = 1;
      cur += 1;
    }
    damage += cur; // damage += wand.curCharges (after the branch above)
    wand = { chargeDelta: delta, wandUsed: used, rechargingFx: true };
  }

  // SNIPER (Hero.java:834-837); also reached via the BATTLEMAGE fall-through.
  if (input.subClass === 'sniper' || input.subClass === 'battlemage') {
    if (input.hasRangedWeapon) {
      sniperMark = {
        object: input.enemyId,
        duration: input.attackDelay * 1.1,
      };
    }
  }

  return { damage, combo, wand, sniperMark };
}

// ---------------------------------------------------------------------------
// Remaining per-subclass hooks
// ---------------------------------------------------------------------------

/**
 * Sniper armor piercing (Char.attack, Char.java:143): a Sniper throwing a
 * missile weapon ignores the defender's armor entirely (dr = 0).
 */
export function sniperIgnoresArmor(
  subClass: HeroSubClass,
  hasRangedWeapon: boolean,
): boolean {
  return subClass === 'sniper' && hasRangedWeapon;
}

/**
 * Assassin surprise attack (Mob.defenseProc, Mob.java:297-303): when the
 * mob cannot see the attacking hero-assassin, bonus damage
 * Random.Int(1, damage) is added. (Per watabou Random semantics
 * Random.Int(1, 0) == 1, so a fully-absorbed hit still gains +1.)
 */
export function assassinSurpriseBonus(
  rng: MechanicsRng,
  damage: number,
  mobSeesHero: boolean,
): number {
  if (mobSeesHero) {
    return damage;
  }
  return damage + rng.int(1, damage);
}

/**
 * Freerunner evasion (Hero.defenseSkill, Hero.java:294-299): the rogue-only
 * branch doubles evasion while the hero has a current action (i.e. is
 * moving), is a Freerunner, and is not starving. The aEnc > 0 early return
 * (Hero.java:289-291) already excludes encumbered heroes upstream.
 */
export function freerunnerEvasionMultiplier(opts: {
  heroClass: TomeHeroClass;
  subClass: HeroSubClass;
  /** curAction != null — the hero is mid-move. */
  moving: boolean;
  starving: boolean;
}): number {
  return opts.heroClass === 'rogue' &&
    opts.subClass === 'freerunner' &&
    opts.moving &&
    !opts.starving
    ? 2
    : 1;
}

/**
 * Freerunner speed (Hero.speed, Hero.java:339): 1.6x while a Freerunner and
 * not starving. The aEnc > 0 branch (Hero.java:331-335) returns before the
 * sprint check, so encumbered heroes get no bonus. HeroSprite.sprint just
 * returns its argument (HeroSprite.java:123-126).
 */
export function freerunnerSpeedMultiplier(
  subClass: HeroSubClass,
  starving: boolean,
  encumbered: boolean,
): number {
  return !encumbered && subClass === 'freerunner' && !starving ? 1.6 : 1;
}

/**
 * Warlock soul consumption (Hero.earnExp, Hero.java:1049-1059): on every
 * experience gain the Warlock heals min(HT - HP, 1 + (depth-1)/5) — integer
 * division — and satisfies 10 hunger (unconditionally, even at full HP).
 */
export function warlockSoulHeal(
  hp: number,
  ht: number,
  depth: number,
): { heal: number; hungerSatisfied: number } {
  const value = Math.min(ht - hp, 1 + Math.floor((depth - 1) / 5));
  return { heal: value > 0 ? value : 0, hungerSatisfied: 10 };
}

/**
 * Warden trampling high grass (HighGrass.trample, HighGrass.java:60-68):
 * Barkskin at HT/3 (Java int division) and 8 leaf particles instead of 4.
 */
export function wardenBarkskinLevel(ht: number): number {
  return Math.floor(ht / 3);
}

/** Warden trample leaf burst: 8 vs the normal 4 (HighGrass.java:64,67). */
export const WARDEN_TRAMPLE_LEAVES = 8;
export const NORMAL_TRAMPLE_LEAVES = 4;

/**
 * Warden plant gathering (Plant.wither, Plant.java:66-75): two independent
 * 1/5 rolls — a random seed and a dewdrop.
 */
export function wardenPlantWither(rng: MechanicsRng): {
  seed: boolean;
  dewdrop: boolean;
} {
  return { seed: rng.int(0, 5) === 0, dewdrop: rng.int(0, 5) === 0 };
}

/**
 * Hero fury damage-roll branch (Hero.damageRoll, Hero.java:327): exported
 * here so the engine can compose it with the port's heroDamageRoll without
 * editing mechanics/hero.ts.
 */
export function heroDamageRollFury(damage: number, hasFury: boolean): number {
  return hasFury ? furyDamageBonus(damage) : damage;
}
