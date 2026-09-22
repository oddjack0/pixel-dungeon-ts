/**
 * Stage 0 hero-mechanics tests (exact-copy port of watabou/pixel-dungeon).
 * Every formula is checked against the Java source cited in the test.
 */
import { describe, expect, test } from 'bun:test';
import type { MechanicsRng } from '../src/mechanics/rng';
import type { BuffState, Char, Hero } from '../src/mechanics/char';
import type { BuffKind } from '../src/mechanics/buffs';
import {
  charSpeed,
  charTimeScale,
  crippleFactor,
  hasBuff,
} from '../src/mechanics/char';
import {
  createWarrior,
  heroSpeed,
  intentionalSearchLevel,
  passiveSearchLevel,
  searchTimeCost,
  updateAwareness,
  vertigoRedirect,
} from '../src/mechanics/hero';
import { earnExp } from '../src/mechanics/exp';
import { Scheduler } from '../src/core/turn';

/** Deterministic RNG stub (Random.Float / Random.Int semantics). */
function stubRng(floats: number[] = [0], ints: number[] = [0]): MechanicsRng {
  let fi = 0;
  let ii = 0;
  return {
    float: (min, max) => min + floats[fi++ % floats.length]! * (max - min),
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

function mkChar(...kinds: string[]): Char {
  const buffs: Record<string, BuffState> = {};
  for (const k of kinds) buffs[k] = { kind: k as BuffKind, left: 10 };
  return {
    id: 1,
    pos: 50,
    hp: 10,
    ht: 10,
    sprite: 'x',
    paralysed: false,
    rooted: false,
    flying: false,
    buffs: buffs as Char['buffs'],
  };
}

function buffedHero(...kinds: string[]): Hero {
  const h = createWarrior(0, 50);
  const buffs: Record<string, BuffState> = {};
  for (const k of kinds) buffs[k] = { kind: k as BuffKind, left: 10 };
  h.buffs = buffs as Hero['buffs'];
  return h;
}

describe('awareness (Hero.updateAwareness, Hero.java:1064-1069)', () => {
  test('lvl 1 warrior starts at 0.1, matching the constructor (Hero.java:175)', () => {
    expect(updateAwareness(1, false)).toBeCloseTo(0.1, 10);
  });
  test('warrior lvl 5: 1 - 0.90^3 = 0.271 (diminishing, not +1/lvl)', () => {
    expect(updateAwareness(5, false)).toBeCloseTo(0.271, 10);
  });
  test('rogue uses 0.85 base: 1 - 0.85^3 = 0.385875', () => {
    expect(updateAwareness(5, true)).toBeCloseTo(0.385875, 10);
  });
  test('capped by min(lvl, 9): lvl 10 and 12 both give 1 - 0.90^5 = 0.40951', () => {
    expect(updateAwareness(10, false)).toBeCloseTo(0.40951, 10);
    expect(updateAwareness(12, false)).toBeCloseTo(
      updateAwareness(9, false),
      10,
    );
  });
  test('earnExp recomputes awareness on level-up while lvl < 10 (Hero.java:1032-1034)', () => {
    const s = {
      lvl: 1, exp: 0, ht: 20, hp: 20,
      attackSkill: 10, defenseSkill: 5, awareness: 0.1,
    };
    earnExp(s, 10); // -> lvl 2
    expect(s.lvl).toBe(2);
    expect(s.awareness).toBeCloseTo(updateAwareness(2, false), 10);
  });
  test('earnExp does NOT recompute once lvl reaches 10 (Hero.java:1032)', () => {
    const s = {
      lvl: 9, exp: 0, ht: 60, hp: 60,
      attackSkill: 18, defenseSkill: 13, awareness: updateAwareness(9, false),
    };
    earnExp(s, 50); // maxExp(9) = 50 -> lvl 10
    expect(s.lvl).toBe(10);
    expect(s.awareness).toBeCloseTo(updateAwareness(9, false), 10);
  });
});

describe('Slow/Speed time scale (Char.spend, Char.java:303-314)', () => {
  test('no buffs: timeScale 1', () => {
    expect(charTimeScale(mkChar())).toBe(1);
  });
  test('Slow halves the scale (charged 2x time)', () => {
    expect(charTimeScale(mkChar('slow'))).toBe(0.5);
  });
  test('Speed doubles the scale (charged half time)', () => {
    expect(charTimeScale(mkChar('speed'))).toBe(2.0);
  });
  test('Slow + Speed cancel out', () => {
    expect(charTimeScale(mkChar('slow', 'speed'))).toBe(1);
  });
  test('hasBuff reads buffs outside the M1 BuffKind union', () => {
    expect(hasBuff(mkChar('slow'), 'slow')).toBe(true);
    expect(hasBuff(mkChar(), 'slow')).toBe(false);
  });
  test('Scheduler.spend charges cost / (speed * timeScale)', () => {
    const sch = new Scheduler();
    const slow = { time: 0, getSpeed: () => 1, getTimeScale: () => 0.5 };
    sch.spend(slow, 1);
    expect(slow.time).toBeCloseTo(2, 10); // vanilla: time += 1 / 0.5
    const fast = { time: 0, getSpeed: () => 1, getTimeScale: () => 2.0 };
    sch.spend(fast, 1);
    expect(fast.time).toBeCloseTo(0.5, 10);
    const plain = { time: 0, getSpeed: () => 1 };
    sch.spend(plain, 1);
    expect(plain.time).toBeCloseTo(1, 10);
  });
});

describe('Cripple and hero speed (Char.speed / Hero.speed)', () => {
  test('Char.speed: no cripple -> 1; cripple -> 0.5 (Char.java:247-249)', () => {
    expect(charSpeed(mkChar())).toBe(1);
    expect(charSpeed(mkChar('cripple'))).toBe(0.5);
    expect(crippleFactor(mkChar('cripple'))).toBe(0.5);
    expect(crippleFactor(mkChar())).toBe(1);
  });
  test('Hero.speed: no armor encumbrance -> base speed (Hero.java:328-341)', () => {
    const h = buffedHero();
    h.armor = null;
    expect(heroSpeed(h)).toBe(1);
    // ClothArmor STR 9 vs warrior STR 11: aEnc = -2 -> no penalty
    expect(heroSpeed(buffedHero())).toBe(1);
  });
  test('Hero.speed: aEnc > 0 -> speed * 1.3^-aEnc', () => {
    const h = buffedHero();
    h.armor = { name: 'plate', level: 0, str: 15, dr: 4, tier: 5 }; // aEnc = 4
    expect(heroSpeed(h)).toBeCloseTo(Math.pow(1.3, -4), 10);
  });
  test('Hero.speed: weakened STR feeds aEnc (STR() = str - 2)', () => {
    const h = buffedHero();
    h.weakened = true; // STR() = 9
    h.armor = { name: 'mail', level: 0, str: 11, dr: 3, tier: 3 }; // aEnc = 2
    expect(heroSpeed(h)).toBeCloseTo(Math.pow(1.3, -2), 10);
  });
  test('Hero.speed: cripple stacks with encumbrance (super.speed() first)', () => {
    const h = buffedHero('cripple');
    h.armor = { name: 'plate', level: 0, str: 15, dr: 4, tier: 5 };
    expect(heroSpeed(h)).toBeCloseTo(0.5 * Math.pow(1.3, -4), 10);
  });
});

describe('search discovery levels and time cost (Hero.search)', () => {
  test('intentional level = 2a - a^2 (Hero.java:1311)', () => {
    expect(intentionalSearchLevel(0.1)).toBeCloseTo(0.19, 10);
    expect(intentionalSearchLevel(0.5)).toBeCloseTo(0.75, 10);
  });
  test('passive level = awareness (Hero.java:1311)', () => {
    expect(passiveSearchLevel(0.1)).toBeCloseTo(0.1, 10);
  });
  test('nothing found -> TIME_TO_SEARCH = 2 (Hero.java:1378)', () => {
    expect(searchTimeCost(stubRng([0.999]), false, 0.19)).toBe(2);
  });
  test('found: Random.Float() < level -> 2, else 4 (Hero.java:1376)', () => {
    expect(searchTimeCost(stubRng([0.0]), true, 0.19)).toBe(2);
    expect(searchTimeCost(stubRng([0.189]), true, 0.19)).toBe(2);
    expect(searchTimeCost(stubRng([0.999]), true, 0.19)).toBe(4);
  });
});

describe('Vertigo step redirect (Char.move, Char.java:474-482)', () => {
  const W = 10;
  const open = () => false; // nothing blocked
  test('follows NEIGHBOURS8 order: {+1,-1,+W,-W,+1+W,+1-W,-1+W,-1-W} (Level.java:89)', () => {
    const expected = [51, 49, 60, 40, 61, 41, 59, 39];
    for (let i = 0; i < 8; i++) {
      expect(vertigoRedirect(stubRng([], [i]), 50, W, open)).toBe(expected[i]);
    }
  });
  test('blocked redirect (wall) cancels the move -> null', () => {
    expect(vertigoRedirect(stubRng([], [0]), 50, W, () => true)).toBeNull();
  });
  test('occupied redirect cancels the move -> null', () => {
    const occupied = (p: number) => p === 51; // a mob stands east
    expect(vertigoRedirect(stubRng([], [0]), 50, W, occupied)).toBeNull();
    // ...but a different random pick still moves
    expect(vertigoRedirect(stubRng([], [1]), 50, W, occupied)).toBe(49);
  });
});
