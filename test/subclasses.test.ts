/**
 * Stage 3 (Worker F) subclass-system tests — exact-copy port of
 * watabou/pixel-dungeon. Every number is checked against the Java source
 * cited in the test.
 */
import { describe, expect, test } from 'bun:test';
import type { MechanicsRng } from '../src/mechanics/rng';
import {
  FURY_LEVEL,
  comboHit,
  comboMessage,
  comboTickDetaches,
  furyCheckOnDamage,
  furyDamageBonus,
  furyTick,
  shadowsTick,
  snipersMarkDuration,
  sniperMarkThrow,
  SHADOWS_PROLONG_TICKS,
  COMBO_NAME,
  FURY_NAME,
  SHADOWS_NAME,
  SNIPERS_MARK_NAME,
} from '../src/mechanics/subclass_buffs';
import {
  assassinSurpriseBonus,
  freerunnerEvasionMultiplier,
  freerunnerSpeedMultiplier,
  heroDisplayName,
  heroSubclassAttackProc,
  respecPrompt,
  sniperIgnoresArmor,
  tomeChoices,
  tomeChoose,
  tomeDisplayName,
  tomeDropsOnTenguKill,
  wardenBarkskinLevel,
  wardenPlantWither,
  warlockSoulHeal,
  heroDamageRollFury,
  TIME_TO_READ,
  TOME_BLINDED_MSG,
  TOME_CHOICES,
  SUBCLASS_DESCS,
  SUBCLASS_TITLES,
  WARDEN_TRAMPLE_LEAVES,
  NORMAL_TRAMPLE_LEAVES,
  WND_MASTERY_TITLE,
  WND_MASTERY_CANCEL,
  WND_REMASTERY_OK,
  WND_REMASTERY_CANCEL,
} from '../src/mechanics/subclasses';
import { TOME_ITEMS, TOME_OF_MASTERY_ID, tomeNameFor } from '../src/content/tomes';
import { WORKER_F_SPRITES } from '../src/assets/stage3_workerF_sprites';

/** Deterministic RNG stub (Random.Int = [min, max) semantics). */
function stubRng(ints: number[] = [0]): MechanicsRng {
  let ii = 0;
  return {
    float: (min) => min,
    int: (min, max) => {
      const v = ints[ii++ % ints.length]!;
      if (v < min || v >= max) throw new Error(`stub int ${v} out of [${min},${max})`);
      return v;
    },
    intRange: (min) => min,
    normalIntRange: (min) => min,
    pick: (arr) => arr[0]!,
  };
}

describe('HeroSubClass enum texts (HeroSubClass.java)', () => {
  test('titles verbatim', () => {
    expect(SUBCLASS_TITLES.gladiator).toBe('gladiator');
    expect(SUBCLASS_TITLES.berserker).toBe('berserker');
    expect(SUBCLASS_TITLES.battlemage).toBe('battlemage');
    expect(SUBCLASS_TITLES.warlock).toBe('warlock');
    expect(SUBCLASS_TITLES.assassin).toBe('assassin');
    expect(SUBCLASS_TITLES.freerunner).toBe('freerunner');
    expect(SUBCLASS_TITLES.sniper).toBe('sniper');
    expect(SUBCLASS_TITLES.warden).toBe('warden');
  });

  test('descriptions verbatim', () => {
    expect(SUBCLASS_DESCS.gladiator).toBe(
      'A successful attack with a melee weapon allows the _Gladiator_ to start a combo, ' +
        'in which every next successful hit inflicts more damage.',
    );
    expect(SUBCLASS_DESCS.berserker).toBe(
      'When severely wounded, the _Berserker_ enters a state of wild fury ' +
        'significantly increasing his damage output.',
    );
    expect(SUBCLASS_DESCS.warlock).toBe(
      'After killing an enemy the _Warlock_ consumes its soul. ' +
        'It heals his wounds and satisfies his hunger.',
    );
    expect(SUBCLASS_DESCS.battlemage).toBe(
      'When fighting with a wand in his hands, the _Battlemage_ inflicts additional damage depending ' +
        'on the current number of charges. Every successful hit restores 1 charge to this wand.',
    );
    expect(SUBCLASS_DESCS.assassin).toBe(
      'When performing a surprise attack, the _Assassin_ inflicts additional damage to his target.',
    );
    expect(SUBCLASS_DESCS.freerunner).toBe(
      'The _Freerunner_ can move almost twice faster, than most of the monsters. When he ' +
        'is running, the Freerunner is much harder to hit. For that he must be unencumbered and not starving.',
    );
    expect(SUBCLASS_DESCS.sniper).toBe(
      "_Snipers_ are able to detect weak points in an enemy's armor, " +
        'effectively ignoring it when using a missile weapon.',
    );
    expect(SUBCLASS_DESCS.warden).toBe(
      'Having a strong connection with forces of nature gives _Wardens_ an ability to gather dewdrops and ' +
        'seeds from plants. Also trampling a high grass grants them a temporary armor buff.',
    );
  });

  test('tome offers the right pair per class (TomeOfMastery.execute)', () => {
    expect(TOME_CHOICES.warrior).toEqual(['gladiator', 'berserker']);
    expect(TOME_CHOICES.mage).toEqual(['battlemage', 'warlock']);
    expect(TOME_CHOICES.rogue).toEqual(['assassin', 'freerunner']);
    expect(TOME_CHOICES.huntress).toEqual(['sniper', 'warden']);
  });

  test('hero display name uses subclass title once chosen (Hero.java:234)', () => {
    expect(heroDisplayName('none', 'warrior')).toBe('warrior');
    expect(heroDisplayName('gladiator', 'warrior')).toBe('gladiator');
    expect(heroDisplayName('warden', 'huntress')).toBe('warden');
  });
});

describe('Tome of Mastery / Remastery (items/TomeOfMastery.java)', () => {
  test('TIME_TO_READ is 10; blind message verbatim', () => {
    expect(TIME_TO_READ).toBe(10);
    expect(TOME_BLINDED_MSG).toBe("You can't read while blinded");
  });

  test('name becomes Tome of Remastery once a subclass is chosen', () => {
    expect(tomeDisplayName('none')).toBe('Tome of Mastery');
    expect(tomeDisplayName('berserker')).toBe('Tome of Remastery');
    expect(tomeNameFor('gladiator')).toBe('Tome of Remastery');
  });

  test('first read offers both choices; reread offers only the other (respec)', () => {
    expect(tomeChoices('warrior', 'none')).toEqual({
      respec: false,
      options: ['gladiator', 'berserker'],
    });
    expect(tomeChoices('warrior', 'gladiator')).toEqual({
      respec: true,
      options: ['berserker'],
    });
    expect(tomeChoices('warrior', 'berserker')).toEqual({
      respec: true,
      options: ['gladiator'],
    });
    expect(tomeChoices('rogue', 'none').options).toEqual(['assassin', 'freerunner']);
  });

  test('choose sets the subclass, costs 10, logs the vanilla line', () => {
    const r = tomeChoose('berserker', 20, 20);
    expect(r.subClass).toBe('berserker');
    expect(r.timeCost).toBe(10);
    expect(r.log).toBe('You have chosen the way of the Berserker!');
    expect(r.gainFury).toBe(false); // full HP: 20 <= 20*0.4 is false
  });

  test('choosing Berserker at/below the fury threshold gains Fury immediately', () => {
    // TomeOfMastery.java:136: no 0 < HP guard (unlike Hero.damage)
    expect(tomeChoose('berserker', 8, 20).gainFury).toBe(true); // 8 <= 8
    expect(tomeChoose('berserker', 9, 20).gainFury).toBe(false); // 9 > 8
    expect(tomeChoose('gladiator', 1, 20).gainFury).toBe(false);
  });

  test('WndChooseWay texts verbatim', () => {
    expect(WND_MASTERY_TITLE).toBe('Which way will you follow?');
    expect(WND_MASTERY_CANCEL).toBe("I'll decide later");
    expect(WND_REMASTERY_OK).toBe('Yes, I want to respec');
    expect(WND_REMASTERY_CANCEL).toBe('Maybe later');
    expect(respecPrompt('berserker')).toBe('Do you want to respec into a berserker?');
    expect(respecPrompt('assassin')).toBe('Do you want to respec into an assassin?');
  });

  test('Tengu drops the tome unless badge unlocked AND subclass chosen', () => {
    expect(tomeDropsOnTenguKill(false, 'none')).toBe(true);
    // badge unlocked + no subclass yet: NO drop (vanilla Tengu.die condition)
    expect(tomeDropsOnTenguKill(true, 'none')).toBe(false);
    expect(tomeDropsOnTenguKill(true, 'gladiator')).toBe(true);
    expect(tomeDropsOnTenguKill(false, 'gladiator')).toBe(true);
  });

  test('catalog def (TOME_ITEMS)', () => {
    expect(TOME_ITEMS).toHaveLength(1);
    const def = TOME_ITEMS[0]!;
    expect(def.id).toBe(TOME_OF_MASTERY_ID);
    expect(def.name).toBe('Tome of Mastery');
    expect(def.sprite).toBe('item_tome_mastery');
    expect(def.stackable).toBe(false);
    expect(def.price).toBe(0); // Item.price() default (Item.java:444-446)
    expect(def.desc).toContain('This worn leather book is not that thick');
  });
});

describe('Fury — Berserker (actors/buffs/Fury.java)', () => {
  test('FURY_LEVEL is 0.4', () => {
    expect(FURY_LEVEL).toBe(0.4);
  });

  test('Fury detaches once HP rises above HT*0.4 (Fury.act)', () => {
    expect(furyTick(9, 20).detached).toBe(true); // 9 > 8
    expect(furyTick(8, 20).detached).toBe(false); // 8 <= 8: stays
    expect(furyTick(1, 20).detached).toBe(false);
  });

  test('Hero.damage gains Fury when left alive at/below threshold (Hero.java:873)', () => {
    expect(furyCheckOnDamage('berserker', 8, 20)).toBe(true);
    expect(furyCheckOnDamage('berserker', 9, 20)).toBe(false);
    expect(furyCheckOnDamage('berserker', 0, 20)).toBe(false); // 0 < HP required
    expect(furyCheckOnDamage('gladiator', 1, 20)).toBe(false);
  });

  test('Fury multiplies the damage roll by 1.5, truncated (Hero.java:327)', () => {
    expect(furyDamageBonus(10)).toBe(15);
    expect(furyDamageBonus(7)).toBe(10); // (int)(10.5f)
    expect(heroDamageRollFury(10, true)).toBe(15);
    expect(heroDamageRollFury(10, false)).toBe(10);
  });

  test('buff display name', () => {
    expect(FURY_NAME).toBe('Fury');
  });
});

describe('Combo — Gladiator (actors/buffs/Combo.java)', () => {
  test('first two hits only renew the window (postpone 1.1), no bonus', () => {
    const r1 = comboHit(0, 100);
    expect(r1).toMatchObject({ count: 1, bonus: 0, duration: 1.1, log: null });
    const r2 = comboHit(1, 100);
    expect(r2).toMatchObject({ count: 2, bonus: 0, duration: 1.1, log: null });
  });

  test('third hit: bonus (int)(damage*1/5), postpone 1.41-3/10', () => {
    const r = comboHit(2, 100);
    expect(r.count).toBe(3);
    expect(r.bonus).toBe(20); // (int)(100 * 1 / 5f)
    expect(r.duration).toBeCloseTo(1.11, 10);
    expect(r.log).toBe('3 hit combo!');
    expect(comboMessage(3)).toBe('3 hit combo!');
  });

  test('later hits scale: (int)(damage*(count-2)/5), duration shrinks', () => {
    const r4 = comboHit(3, 100);
    expect(r4.bonus).toBe(40);
    expect(r4.duration).toBeCloseTo(1.01, 10);
    const r7 = comboHit(6, 99);
    expect(r7.count).toBe(7);
    expect(r7.bonus).toBe(Math.floor((99 * 5) / 5)); // 99
    expect(r7.duration).toBeCloseTo(0.71, 10);
    expect(r7.badgeCount).toBe(7); // MASTERY_COMBO is the 7-hit combo
  });

  test('Combo.act always detaches (only hits keep it alive)', () => {
    expect(comboTickDetaches()).toBe(true);
    expect(COMBO_NAME).toBe('Combo');
  });
});

describe('Shadows — Assassin stealth (actors/buffs/Shadows.java)', () => {
  test('prolong sets left = 2', () => {
    expect(SHADOWS_PROLONG_TICKS).toBe(2);
  });

  test('ticks down; detaches at 0 or when an enemy is visible', () => {
    const t1 = shadowsTick(true, 0, 2);
    expect(t1).toEqual({ left: 1, detached: false });
    const t2 = shadowsTick(true, 0, 1);
    expect(t2).toEqual({ left: 0, detached: true });
    expect(shadowsTick(true, 1, 2).detached).toBe(true); // visibleEnemies > 0
    expect(shadowsTick(false, 0, 2).detached).toBe(true); // dead
  });

  test('display name', () => {
    expect(SHADOWS_NAME).toBe('Shadowmelded');
  });
});

describe("Sniper's mark (actors/buffs/SnipersMark.java)", () => {
  test('mark duration is attackDelay * 1.1 (Hero.java:835)', () => {
    expect(snipersMarkDuration(1)).toBeCloseTo(1.1, 10);
    expect(snipersMarkDuration(0.5)).toBeCloseTo(0.55, 10);
  });

  test('throwing at the marked enemy halves the throw delay (Item.java:559-567)', () => {
    const r = sniperMarkThrow(7, 7, 2);
    expect(r.delay).toBe(1); // 2 * 0.5
    expect(r.markConsumed).toBe(true);
  });

  test('mark is consumed even when the target is not the marked one', () => {
    const r = sniperMarkThrow(7, 9, 2);
    expect(r.delay).toBe(2);
    expect(r.markConsumed).toBe(true);
  });

  test('no mark: delay untouched', () => {
    expect(sniperMarkThrow(null, 7, 2)).toEqual({ delay: 2, markConsumed: false });
  });

  test('display name', () => {
    expect(SNIPERS_MARK_NAME).toBe('Zeroed in');
  });
});

describe('heroSubclassAttackProc (Hero.attackProc, Hero.java:803-841)', () => {
  const base = {
    subClass: 'gladiator' as const,
    wepIsMeleeWeapon: true,
    wepIsWand: false,
    hasRangedWeapon: false,
    wandCurCharges: 0,
    wandMaxCharges: 5,
    attackDelay: 1,
    enemyId: 42,
    comboCount: 0,
    damage: 100,
  };

  test('Gladiator melee hit builds combo bonus', () => {
    const r = heroSubclassAttackProc({ ...base, comboCount: 2 });
    expect(r.damage).toBe(120); // 100 + (int)(100*1/5)
    expect(r.combo!.count).toBe(3);
    expect(r.combo!.log).toBe('3 hit combo!');
    expect(r.sniperMark).toBeNull();
    expect(r.wand).toBeNull();
  });

  test('Gladiator with a non-melee weapon: no combo', () => {
    const r = heroSubclassAttackProc({ ...base, wepIsMeleeWeapon: false });
    expect(r.damage).toBe(100);
    expect(r.combo).toBeNull();
  });

  test('Battlemage wand: +curCharges damage, restores 1 charge on a damaging hit', () => {
    const r = heroSubclassAttackProc({
      ...base,
      subClass: 'battlemage',
      wepIsMeleeWeapon: false,
      wepIsWand: true,
      wandCurCharges: 3,
      wandMaxCharges: 5,
    });
    expect(r.damage).toBe(104); // 100 + 4 (after the +1)
    expect(r.wand).toMatchObject({ chargeDelta: 1, wandUsed: false, rechargingFx: true });
  });

  test('Battlemage wand at max charges: wand.use() (durability), no charge gain', () => {
    const r = heroSubclassAttackProc({
      ...base,
      subClass: 'battlemage',
      wepIsWand: true,
      wandCurCharges: 5,
      wandMaxCharges: 5,
    });
    expect(r.damage).toBe(105); // damage += curCharges (unchanged at max)
    expect(r.wand).toMatchObject({ chargeDelta: 0, wandUsed: true });
  });

  test('Battlemage wand, zero-damage hit: no charge restored, still +charges', () => {
    const r = heroSubclassAttackProc({
      ...base,
      subClass: 'battlemage',
      wepIsWand: true,
      damage: 0,
      wandCurCharges: 2,
      wandMaxCharges: 5,
    });
    expect(r.damage).toBe(2);
    expect(r.wand!.chargeDelta).toBe(0); // damage > 0 required
  });

  test('Sniper throwing: applies the mark, no damage change', () => {
    const r = heroSubclassAttackProc({
      ...base,
      subClass: 'sniper',
      wepIsMeleeWeapon: false,
      hasRangedWeapon: true,
    });
    expect(r.damage).toBe(100);
    expect(r.sniperMark).toMatchObject({ object: 42 });
    expect(r.sniperMark!.duration).toBeCloseTo(1.1, 10);
  });

  test('Sniper melee: no mark without a ranged weapon', () => {
    const r = heroSubclassAttackProc({ ...base, subClass: 'sniper' });
    expect(r.sniperMark).toBeNull();
  });

  test('BATTLEMAGE->SNIPER fall-through: a Battlemage throwing applies the mark (Hero.java:834-837, no break)', () => {
    const r = heroSubclassAttackProc({
      ...base,
      subClass: 'battlemage',
      wepIsMeleeWeapon: false,
      wepIsWand: false,
      hasRangedWeapon: true,
    });
    expect(r.wand).toBeNull();
    expect(r.sniperMark).toMatchObject({ object: 42 });
  });

  test('no subclass: attackProc is identity', () => {
    const r = heroSubclassAttackProc({ ...base, subClass: 'none' });
    expect(r).toMatchObject({ damage: 100, combo: null, wand: null, sniperMark: null });
  });
});

describe('remaining subclass hooks', () => {
  test('Sniper ignores armor when throwing (Char.java:143)', () => {
    expect(sniperIgnoresArmor('sniper', true)).toBe(true);
    expect(sniperIgnoresArmor('sniper', false)).toBe(false);
    expect(sniperIgnoresArmor('gladiator', true)).toBe(false);
  });

  test('Assassin surprise attack adds Random.Int(1, damage) when unseen (Mob.java:297-303)', () => {
    expect(assassinSurpriseBonus(stubRng([4]), 10, false)).toBe(14);
    expect(assassinSurpriseBonus(stubRng([1]), 10, true)).toBe(10); // seen: no bonus
  });

  test('Freerunner evasion x2 while moving, unstarving, unencumbered (Hero.java:294-299)', () => {
    const moving = { heroClass: 'rogue' as const, subClass: 'freerunner' as const, moving: true, starving: false };
    expect(freerunnerEvasionMultiplier(moving)).toBe(2);
    expect(freerunnerEvasionMultiplier({ ...moving, starving: true })).toBe(1);
    expect(freerunnerEvasionMultiplier({ ...moving, moving: false })).toBe(1);
    expect(freerunnerEvasionMultiplier({ ...moving, heroClass: 'warrior' })).toBe(1);
    expect(freerunnerEvasionMultiplier({ ...moving, subClass: 'assassin' })).toBe(1);
  });

  test('Freerunner speed x1.6 unless starving or encumbered (Hero.java:339)', () => {
    expect(freerunnerSpeedMultiplier('freerunner', false, false)).toBe(1.6);
    expect(freerunnerSpeedMultiplier('freerunner', true, false)).toBe(1);
    expect(freerunnerSpeedMultiplier('freerunner', false, true)).toBe(1);
    expect(freerunnerSpeedMultiplier('berserker', false, false)).toBe(1);
  });

  test('Warlock soul heal on earnExp: min(HT-HP, 1+(depth-1)/5); +10 satiety (Hero.java:1049-1059)', () => {
    expect(warlockSoulHeal(10, 20, 1)).toEqual({ heal: 1, hungerSatisfied: 10 });
    expect(warlockSoulHeal(10, 20, 6)).toEqual({ heal: 2, hungerSatisfied: 10 });
    expect(warlockSoulHeal(10, 20, 11)).toEqual({ heal: 3, hungerSatisfied: 10 });
    expect(warlockSoulHeal(20, 20, 1)).toEqual({ heal: 0, hungerSatisfied: 10 });
    expect(warlockSoulHeal(19, 20, 26)).toEqual({ heal: 1, hungerSatisfied: 10 }); // capped by missing HP
  });

  test('Warden high grass: Barkskin HT/3, 8 leaves vs 4 (HighGrass.java:60-68)', () => {
    expect(wardenBarkskinLevel(20)).toBe(6); // int division
    expect(wardenBarkskinLevel(21)).toBe(7);
    expect(WARDEN_TRAMPLE_LEAVES).toBe(8);
    expect(NORMAL_TRAMPLE_LEAVES).toBe(4);
  });

  test('Warden plant wither: independent 1/5 seed + dewdrop rolls (Plant.java:66-75)', () => {
    expect(wardenPlantWither(stubRng([0, 0]))).toEqual({ seed: true, dewdrop: true });
    expect(wardenPlantWither(stubRng([3, 4]))).toEqual({ seed: false, dewdrop: false });
  });
});

describe('Worker F sprite (stage3_workerF_sprites.ts)', () => {
  test('tome tile extracted from items.png index 82 (ItemSpriteSheet.MASTERY)', () => {
    const s = WORKER_F_SPRITES['item_tome_mastery']!;
    expect(s.w).toBe(16);
    expect(s.h).toBe(16);
    const rgba = Buffer.from(s.rgba, 'base64');
    expect(rgba.length).toBe(16 * 16 * 4);
    let visible = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 8) visible++;
    expect(visible).toBeGreaterThan(100); // not a blank tile
  });
});
