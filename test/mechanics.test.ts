/**
 * Mechanics unit tests (bun test). Every formula is checked against the
 * ported Java source; citations live in docs/MECHANICS-REPORT.md.
 */
import { describe, expect, test } from 'bun:test';
import type { MechanicsRng } from '../src/mechanics/rng';
import { RNG } from '../src/core/rng';
import {
  createWarrior,
  DART,
  SHORT_SWORD,
  accuracyFactor,
  heroAttackSkill,
  heroDamageRoll,
  heroDefenseSkill,
  heroDR,
  weaponDamageRoll,
  speedFactor,
} from '../src/mechanics/hero';
import {
  hitRoll,
  applyDamage,
  resolveAttack,
  skeletonDeathBurst,
} from '../src/mechanics/combat';
import { maxExp, earnExp, expForKill } from '../src/mechanics/exp';
import {
  hungerTick,
  satisfy,
  regenTick,
  isStarving,
  HUNGER_STEP,
  STARVING,
} from '../src/mechanics/hunger';
import {
  burningTick,
  poisonTick,
  poisonTrapDuration,
  oozeTick,
  paralysisDuration,
  burningInventoryTick,
  buffDeathMessage,
  burnsUpMessage,
  comboMessage,
  DEATH_MESSAGE_RE,
  BURNING_DURATION,
  SLEEP_POSTPONE,
  MSG_BURNED_TO_DEATH,
  MSG_DIED_FROM_POISON,
  MSG_OOZE_KILLED,
  MSG_BLED_TO_DEATH,
  MSG_STARVED_TO_DEATH,
  MSG_HUNGRY,
  MSG_STARVING,
  MSG_BURNS_UP,
  MSG_COMBO,
} from '../src/mechanics/buffs';
import {
  gooDamageRoll,
  gooAttackSkill,
  gooCanAttack,
  gooDecide,
  gooAfterAttack,
  gooAfterMove,
  gooOozeRoll,
  gooWaterRegen,
  GOO_HT,
} from '../src/mechanics/goo';

/** Deterministic scripted RNG: queues of raw values for float/int calls. */
class ScriptRng implements MechanicsRng {
  private floats: number[];
  private ints: number[];
  constructor(floats: number[] = [], ints: number[] = []) {
    this.floats = [...floats];
    this.ints = [...ints];
  }
  float(min: number, max: number): number {
    const v = this.floats.length ? this.floats.shift()! : 0.5;
    return min + v * (max - min);
  }
  int(min: number, max: number): number {
    if (this.ints.length) {
      const v = this.ints.shift()!;
      return Math.min(Math.max(v, min), Math.max(min, max - 1));
    }
    return min;
  }
  intRange(min: number, max: number): number {
    if (this.ints.length) {
      const v = this.ints.shift()!;
      return Math.min(Math.max(v, min), max);
    }
    return min;
  }
  normalIntRange(min: number, max: number): number {
    if (this.ints.length) {
      const v = this.ints.shift()!;
      return Math.min(Math.max(v, min), max);
    }
    return Math.floor((min + max) / 2);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[0];
  }
}

describe('hit chance (Char.hit, Char.java:213-217)', () => {
  test('acuRoll >= defRoll hits', () => {
    // floats: acu 0.6*10=6 >= def 0.3*5=1.5
    expect(hitRoll(new ScriptRng([0.6, 0.3]), 10, 5)).toBe(true);
  });
  test('acuRoll < defRoll misses', () => {
    expect(hitRoll(new ScriptRng([0.2, 0.8]), 10, 5)).toBe(false);
  });
  test('magic doubles the accuracy roll', () => {
    // acu 0.3*10=3, def 0.9*5=4.5: miss normal, hit magic (6 >= 4.5)
    expect(hitRoll(new ScriptRng([0.3, 0.9]), 10, 5)).toBe(false);
    expect(hitRoll(new ScriptRng([0.3, 0.9]), 10, 5, true)).toBe(true);
  });
});

describe('warrior hero stats (Hero.java / HeroClass.java)', () => {
  const hero = createWarrior(1, 0);
  test('starts STR 11, 20 HP, atk 10, def 5, 8 darts', () => {
    expect(hero.str).toBe(11);
    expect(hero.hp).toBe(20);
    expect(hero.ht).toBe(20);
    expect(hero.attackSkill).toBe(10);
    expect(hero.defenseSkill).toBe(5);
    expect(hero.lvl).toBe(1);
    expect(hero.darts).toBe(8);
    expect(hero.weapon).not.toBeNull();
    expect(hero.armor).not.toBeNull();
  });
  test('melee attackSkill = 10 (ShortSword STR 11, factor 1)', () => {
    expect(heroAttackSkill(hero, { ranged: false, adjacent: false })).toBe(10);
  });
  test('dart accuracy factor = 1/1.5^2 (warrior +3 encumbrance)', () => {
    // encumbrance = 10 - 11 + 3 = 2 -> 1 / 2.25
    expect(accuracyFactor(DART, 11)).toBeCloseTo(1 / 2.25, 10);
  });
  test('dart attackSkill = 4, adjacent throw = 2', () => {
    const ranged = { ...hero, rangedWeapon: { ...DART } };
    expect(heroAttackSkill(ranged, { ranged: true, adjacent: false })).toBe(4);
    expect(heroAttackSkill(ranged, { ranged: true, adjacent: true })).toBe(2);
  });
  test('defenseSkill = 5, DR = 2 (cloth armor)', () => {
    expect(heroDefenseSkill(hero)).toBe(5);
    expect(heroDR(hero)).toBe(2);
  });
  test('short sword damage is NormalIntRange(1,12); dart is (1,4)', () => {
    const rng = new RNG(12345);
    for (let i = 0; i < 200; i++) {
      const melee = weaponDamageRoll(rng, SHORT_SWORD, { str: 11, ranged: false });
      expect(melee).toBeGreaterThanOrEqual(1);
      expect(melee).toBeLessThanOrEqual(12);
      const dart = weaponDamageRoll(rng, DART, { str: 11, ranged: true });
      expect(dart).toBeGreaterThanOrEqual(1);
      expect(dart).toBeLessThanOrEqual(4);
    }
  });
  test('unarmed damage at STR 11 is 1..2', () => {
    const unarmed = { ...hero, weapon: null };
    const rng = new RNG(7);
    for (let i = 0; i < 50; i++) {
      const d = heroDamageRoll(rng, unarmed, { ranged: false });
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(2);
    }
  });
  test('attack delay is 1 for the starting kit', () => {
    expect(speedFactor(SHORT_SWORD, 11)).toBe(1);
    expect(speedFactor(DART, 11)).toBe(1);
  });
});

describe('resolveAttack (Char.attack, Char.java:128-186)', () => {
  const atk = { accuracy: 10, evasion: 5, dr: 0 };
  const def = { accuracy: 8, evasion: 3, dr: 1, hp: 8, ht: 8, paralysed: false, immunities: [], resistances: [] };
  test('hit: effectiveDamage = max(dmg - dr, 0)', () => {
    // hit roll ok; dr roll = 1; damage = 6 -> 5 dealt
    const rng = new ScriptRng([0.9, 0.1], [1, 6]);
    const r = resolveAttack(rng, atk, { ...def }, (g) => g.intRange(1, 12));
    expect(r.hit).toBe(true);
    expect(r.damageDealt).toBe(5);
    expect(r.defenderHp).toBe(3);
    expect(r.defenderDied).toBe(false);
  });
  test('miss deals nothing', () => {
    const rng = new ScriptRng([0.1, 0.9], []);
    const r = resolveAttack(rng, atk, { ...def }, (g) => g.intRange(1, 12));
    expect(r.hit).toBe(false);
    expect(r.damageDealt).toBe(0);
    expect(r.defenderHp).toBe(8);
  });
  test('damage cannot go negative through armor', () => {
    const rng = new ScriptRng([0.9, 0.1], [5, 2]);
    const r = resolveAttack(rng, atk, { ...def, dr: 5 }, (g) => g.intRange(1, 12));
    expect(r.damageDealt).toBe(0);
    expect(r.defenderHp).toBe(8);
  });
  test('killing blow sets died', () => {
    const rng = new ScriptRng([0.9, 0.1], [0, 12]);
    const r = resolveAttack(rng, atk, { ...def }, (g) => g.intRange(1, 12));
    expect(r.defenderHp).toBeLessThanOrEqual(0);
    expect(r.defenderDied).toBe(true);
  });
});

describe('applyDamage (Char.damage, Char.java:259-285)', () => {
  const t = { hp: 10, ht: 20, paralysed: false, immunities: [] as string[], resistances: [] as string[] };
  test('immunity zeroes damage', () => {
    const r = applyDamage(new ScriptRng(), { ...t, immunities: ['fire'] }, 9, 'fire');
    expect(r.hp).toBe(10);
  });
  test('resistance halves via IntRange(0, dmg)', () => {
    const r = applyDamage(new ScriptRng([], [4]), { ...t, resistances: ['toxicGas'] }, 9, 'toxicGas');
    expect(r.hp).toBe(6); // 10 - 4
  });
  test('paralysis break: Int(dmg) >= Int(HP) detaches', () => {
    // Int(dmg)=5 >= Int(HP)=2 -> broken
    const r = applyDamage(new ScriptRng([], [5, 2]), { ...t, paralysed: true }, 6);
    expect(r.paralysisBroken).toBe(true);
    expect(r.hp).toBe(4);
    // Int(dmg)=1 < Int(HP)=8 -> stays
    const r2 = applyDamage(new ScriptRng([], [1, 8]), { ...t, paralysed: true }, 6);
    expect(r2.paralysisBroken).toBe(false);
  });
});

describe('skeleton death burst (Skeleton.java:57-71)', () => {
  test('damage = max(0, roll - IntRange(0, dr/2))', () => {
    const r = skeletonDeathBurst(new ScriptRng([], [7, 1]), (g) => g.intRange(1, 8), 4);
    expect(r).toBe(6); // 7 - 1
    const r2 = skeletonDeathBurst(new ScriptRng([], [2, 3]), (g) => g.intRange(1, 8), 6);
    expect(r2).toBe(0); // max(0, 2-3)
  });
});

describe('EXP (Hero.java:1019-1063, Mob.java:353-355)', () => {
  test('maxExp thresholds: 10, 15, 20, ...', () => {
    expect(maxExp(1)).toBe(10);
    expect(maxExp(2)).toBe(15);
    expect(maxExp(3)).toBe(20);
    expect(maxExp(4)).toBe(25);
  });
  test('earnExp: level-up gains +5 HT/HP, +1 atk, +1 def', () => {
    const s = { lvl: 1, exp: 0, ht: 20, hp: 20, attackSkill: 10, defenseSkill: 5, awareness: 0.1 };
    const gained = earnExp(s, 10);
    expect(gained).toBe(1);
    expect(s.lvl).toBe(2);
    expect(s.exp).toBe(0);
    expect(s.ht).toBe(25);
    expect(s.hp).toBe(25);
    expect(s.attackSkill).toBe(11);
    expect(s.defenseSkill).toBe(6);
  });
  test('earnExp: overflow carries, multiple levels', () => {
    const s = { lvl: 1, exp: 0, ht: 20, hp: 20, attackSkill: 10, defenseSkill: 5, awareness: 0.1 };
    earnExp(s, 26); // 10 -> lvl2 (16 left), 15 -> lvl3 (1 left)
    expect(s.lvl).toBe(3);
    expect(s.exp).toBe(1);
    expect(s.ht).toBe(30);
  });
  test('mob EXP table with maxLvl cutoff', () => {
    expect(expForKill('rat', 5)).toBe(1);
    expect(expForKill('rat', 6)).toBe(0);
    expect(expForKill('gnoll', 8)).toBe(2);
    expect(expForKill('crab', 9)).toBe(3);
    expect(expForKill('swarm', 10)).toBe(1);
    expect(expForKill('skeleton', 10)).toBe(5);
    expect(expForKill('skeleton', 11)).toBe(0);
    expect(expForKill('thief', 10)).toBe(5);
    expect(expForKill('goo', 1)).toBe(10);
  });
});

describe('hunger (Hunger.java / Regeneration.java)', () => {
  test('accumulates +10 per tick; starving at 360', () => {
    let level = 0;
    for (let i = 0; i < 35; i++) {
      const r = hungerTick(new ScriptRng(), { level, hp: 20, paralysed: false });
      level = r.level;
    }
    expect(level).toBe(350);
    expect(isStarving(level)).toBe(false);
    const r = hungerTick(new ScriptRng(), { level, hp: 20, paralysed: false });
    expect(r.level).toBe(360);
    expect(r.becameStarving).toBe(true);
    expect(isStarving(r.level)).toBe(true);
  });
  test('starving: 30% chance of 1 damage', () => {
    const hit = hungerTick(new ScriptRng([0.29]), { level: STARVING, hp: 20, paralysed: false });
    expect(hit.damage).toBe(1);
    const miss = hungerTick(new ScriptRng([0.31]), { level: STARVING, hp: 20, paralysed: false });
    expect(miss.damage).toBe(0);
  });
  test('starvation CAN kill a conscious hero at 1 HP', () => {
    const r = hungerTick(new ScriptRng([0.1]), { level: STARVING, hp: 1, paralysed: false });
    expect(r.damage).toBe(1);
    expect(r.died).toBe(true);
  });
  test('starvation spares a paralysed hero at 1 HP', () => {
    const r = hungerTick(new ScriptRng([0.1]), { level: STARVING, hp: 1, paralysed: true });
    expect(r.damage).toBe(0);
    expect(r.died).toBe(false);
  });
  test('starvation still hits a paralysed hero above 1 HP', () => {
    const r = hungerTick(new ScriptRng([0.1]), { level: STARVING, hp: 2, paralysed: true });
    expect(r.damage).toBe(1);
    expect(r.died).toBe(false);
  });
  test('satisfy clamps to [0, 360]', () => {
    expect(satisfy(300, 260)).toBe(40);
    expect(satisfy(100, 260)).toBe(0);
    expect(satisfy(400, -50)).toBe(STARVING);
  });
  test('hunger step is 10', () => {
    expect(HUNGER_STEP).toBe(10);
  });
  test('regen: +1 HP per tick when hurt and not starving', () => {
    expect(regenTick(15, 20, false)).toBe(16);
    expect(regenTick(20, 20, false)).toBe(20);
    expect(regenTick(15, 20, true)).toBe(15);
  });
});

describe('buffs', () => {
  test('burning: 1..4 damage per tick, left decrements', () => {
    const rng = new RNG(42);
    for (let i = 0; i < 100; i++) {
      const t = burningTick(rng, 20, 20, 5, false, false);
      expect(t.damage).toBeGreaterThanOrEqual(1);
      expect(t.damage).toBeLessThanOrEqual(4);
      expect(t.left).toBe(4);
    }
  });
  test('burning: detaches when left runs out', () => {
    // force extinguish roll low so only left<=0 detaches
    const t = burningTick(new ScriptRng([0.0]), 20, 20, 1, false, false);
    expect(t.left).toBe(0);
    expect(t.detached).toBe(true);
  });
  test('burning: high random roll extinguishes early', () => {
    // threshold at full HP: (2 + 1)/3 = 1.0 -> roll 0.99 <= 1.0 stays
    const stays = burningTick(new ScriptRng([0.99]), 20, 20, 8, false, false);
    expect(stays.detached).toBe(false);
    // threshold at low HP: (2 + 0.05)/3 ~ 0.683 -> roll 0.99 > threshold
    const out = burningTick(new ScriptRng([0.99]), 1, 20, 8, false, false);
    expect(out.detached).toBe(true);
  });
  test('burning duration is 8', () => {
    expect(BURNING_DURATION).toBe(8);
  });
  test('poison: damage = floor(left/3)+1, ticks 6,5,...,1 then detaches', () => {
    const damages: number[] = [];
    let left = 6;
    let detached = false;
    while (!detached) {
      const t = poisonTick(left);
      damages.push(t.damage);
      left = t.left;
      detached = t.detached;
    }
    expect(damages).toEqual([3, 2, 2, 2, 1, 1]);
    expect(left).toBe(0);
  });
  test('poison trap duration: 4 + floor(depth/2)', () => {
    expect(poisonTrapDuration(1)).toBe(4);
    expect(poisonTrapDuration(2)).toBe(5);
    expect(poisonTrapDuration(3)).toBe(5);
    expect(poisonTrapDuration(4)).toBe(6);
  });
  test('ooze: 1 damage per tick, detaches in water', () => {
    expect(oozeTick(false)).toEqual({ damage: 1, detached: false });
    expect(oozeTick(true)).toEqual({ damage: 1, detached: true });
  });
  test('paralysis duration 10; sleep postpones 1.5', () => {
    expect(paralysisDuration()).toBe(10);
    expect(SLEEP_POSTPONE).toBe(1.5);
  });
});

describe('Goo (Goo.java)', () => {
  test('unpumped damage 2..12, pumped 5..30', () => {
    const rng = new RNG(99);
    for (let i = 0; i < 200; i++) {
      const calm = gooDamageRoll(rng, false);
      expect(calm).toBeGreaterThanOrEqual(2);
      expect(calm).toBeLessThanOrEqual(12);
      const pumped = gooDamageRoll(rng, true);
      expect(pumped).toBeGreaterThanOrEqual(5);
      expect(pumped).toBeLessThanOrEqual(30);
    }
  });
  test('attackSkill: 30 pumped (no jump), else 15', () => {
    expect(gooAttackSkill(true, false)).toBe(30);
    expect(gooAttackSkill(true, true)).toBe(15);
    expect(gooAttackSkill(false, false)).toBe(15);
  });
  test('canAttack: pumped -> dist<=2, else adjacent', () => {
    expect(gooCanAttack(false, 1)).toBe(true);
    expect(gooCanAttack(false, 2)).toBe(false);
    expect(gooCanAttack(true, 2)).toBe(true);
    expect(gooCanAttack(true, 3)).toBe(false);
  });
  test('decide: pumped + adjacent -> pumpedAttack (jumped=false pre-strike)', () => {
    const a = gooDecide(new ScriptRng(), { hp: 80, pumpedUp: true, jumped: false }, { dist: 1, jumpPathClear: true });
    expect(a).toEqual({ kind: 'pumpedAttack' });
  });
  test('decide: pumped + dist 2 + clear path -> jumpAttack', () => {
    const a = gooDecide(new ScriptRng(), { hp: 80, pumpedUp: true, jumped: false }, { dist: 2, jumpPathClear: true });
    expect(a).toEqual({ kind: 'jumpAttack' });
  });
  test('decide: pumped + blocked path -> pumpFizzle', () => {
    const a = gooDecide(new ScriptRng(), { hp: 80, pumpedUp: true, jumped: false }, { dist: 2, jumpPathClear: false });
    expect(a).toEqual({ kind: 'pumpFizzle' });
  });
  test('decide: calm -> attack on Int(3)>0, pump on 0', () => {
    const atk = gooDecide(new ScriptRng([], [2]), { hp: 80, pumpedUp: false, jumped: false }, { dist: 1, jumpPathClear: false });
    expect(atk).toEqual({ kind: 'attack' });
    const pump = gooDecide(new ScriptRng([], [0]), { hp: 80, pumpedUp: false, jumped: false }, { dist: 1, jumpPathClear: false });
    expect(pump).toEqual({ kind: 'pump' });
  });
  test('jumped is written only by the pumped branches (Goo.java:115, 121)', () => {
    // Normal attack: jumped untouched (Goo.java:150-156; the attack() wrapper
    // clears ONLY pumpedUp, Goo.java:176-180).
    expect(
      gooAfterAttack({ hp: 80, pumpedUp: false, jumped: true }, { kind: 'attack' }),
    ).toEqual({ hp: 80, pumpedUp: false, jumped: true });
    // Pump-up: jumped untouched (Goo.java:158-167).
    expect(
      gooAfterAttack({ hp: 80, pumpedUp: false, jumped: true }, { kind: 'pump' }),
    ).toEqual({ hp: 80, pumpedUp: true, jumped: true });
    // Pump fizzle: jumped untouched (Goo.java:144-148).
    expect(
      gooAfterAttack({ hp: 80, pumpedUp: true, jumped: true }, { kind: 'pumpFizzle' }),
    ).toEqual({ hp: 80, pumpedUp: false, jumped: true });
    // Pumped + adjacent: jumped = false before the strike (Goo.java:115).
    expect(
      gooAfterAttack({ hp: 80, pumpedUp: true, jumped: true }, { kind: 'pumpedAttack' }),
    ).toEqual({ hp: 80, pumpedUp: false, jumped: false });
    // Jump attack: jumped = true before the strike (Goo.java:121).
    expect(
      gooAfterAttack({ hp: 80, pumpedUp: true, jumped: false }, { kind: 'jumpAttack' }),
    ).toEqual({ hp: 80, pumpedUp: false, jumped: true });
    // Moving clears pumpedUp only (Goo.getCloser, Goo.java:182-185).
    expect(gooAfterMove({ hp: 80, pumpedUp: true, jumped: true })).toEqual({
      hp: 80,
      pumpedUp: false,
      jumped: true,
    });
  });
  test('ooze applied on Int(3)==0 (1/3)', () => {
    expect(gooOozeRoll(new ScriptRng([], [0]))).toBe(true);
    expect(gooOozeRoll(new ScriptRng([], [1]))).toBe(false);
    expect(gooOozeRoll(new ScriptRng([], [2]))).toBe(false);
  });
  test('water regen: +1 HP in water when hurt', () => {
    expect(gooWaterRegen(79, true)).toBe(80);
    expect(gooWaterRegen(80, true)).toBe(80);
    expect(gooWaterRegen(79, false)).toBe(79);
    expect(GOO_HT).toBe(80);
  });
});

describe('seeded RNG sanity', () => {
  test('RNG is deterministic', () => {
    const a = new RNG(123);
    const b = new RNG(123);
    for (let i = 0; i < 20; i++) {
      expect(a.intRange(1, 100)).toBe(b.intRange(1, 100));
    }
  });
  test('int bounds [a,b), intRange [a,b], normalIntRange triangular in [a,b]', () => {
    const rng = new RNG(5);
    for (let i = 0; i < 500; i++) {
      const v = rng.int(1, 5);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      const w = rng.intRange(1, 5);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(5);
      const n = rng.normalIntRange(2, 12);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(12);
    }
    // triangular: middle values more likely than extremes
    let extremes = 0;
    let middles = 0;
    for (let i = 0; i < 2000; i++) {
      const n = rng.normalIntRange(1, 5);
      if (n === 1 || n === 5) extremes++;
      if (n === 3) middles++;
    }
    expect(middles).toBeGreaterThan(extremes);
  });
});

describe('buff messages (exact Java strings)', () => {
  test('death messages are verbatim from the Java sources', () => {
    expect(MSG_BURNED_TO_DEATH).toBe('You burned to death...'); // Burning.java:46
    expect(MSG_DIED_FROM_POISON).toBe('You died from poison...'); // Poison.java:94
    expect(MSG_OOZE_KILLED).toBe('Caustic ooze killed you...'); // Ooze.java:29 + toString
    expect(MSG_BLED_TO_DEATH).toBe('You bled to death...'); // Bleeding.java:77
    expect(MSG_STARVED_TO_DEATH).toBe('You starved to death...'); // Hunger.java:41
  });

  test('act-time messages are verbatim', () => {
    expect(MSG_HUNGRY).toBe('You are hungry.'); // Hunger.java:39
    expect(MSG_STARVING).toBe('You are starving!'); // Hunger.java:40
    expect(MSG_BURNS_UP).toBe('%s burns up!'); // Burning.java:45
    expect(MSG_COMBO).toBe('%d hit combo!'); // Combo.java:27
  });

  test('buffDeathMessage maps killer buffs, null otherwise', () => {
    expect(buffDeathMessage('burning')).toBe(MSG_BURNED_TO_DEATH);
    expect(buffDeathMessage('poison')).toBe(MSG_DIED_FROM_POISON);
    expect(buffDeathMessage('ooze')).toBe(MSG_OOZE_KILLED);
    expect(buffDeathMessage('hunger')).toBe(MSG_STARVED_TO_DEATH);
    expect(buffDeathMessage('bleeding')).toBe(MSG_BLED_TO_DEATH);
    expect(buffDeathMessage('paralysis')).toBeNull();
    expect(buffDeathMessage('roots')).toBeNull();
    expect(buffDeathMessage('sleep')).toBeNull();
    expect(buffDeathMessage('regeneration')).toBeNull();
    expect(buffDeathMessage('cripple')).toBeNull();
  });

  test('DEATH_MESSAGE_RE matches every vanilla death line', () => {
    for (const m of [
      MSG_BURNED_TO_DEATH,
      MSG_DIED_FROM_POISON,
      MSG_OOZE_KILLED,
      MSG_BLED_TO_DEATH,
      MSG_STARVED_TO_DEATH,
    ]) {
      expect(DEATH_MESSAGE_RE.test(m)).toBe(true);
    }
    expect(DEATH_MESSAGE_RE.test('You are starving!')).toBe(false);
    expect(DEATH_MESSAGE_RE.test('You died...')).toBe(false);
  });

  test('message formatters', () => {
    expect(burnsUpMessage('a scroll')).toBe('a scroll burns up!');
    expect(comboMessage(3)).toBe('3 hit combo!');
  });
});

describe('burning inventory side effects (Burning.java:76-98)', () => {
  const isScroll = (id: string) => id === 'scroll' || id === 'scroll_upgrade';
  const isMeat = (id: string) => id === 'mystery_meat';

  test('empty pack: nothing burns', () => {
    expect(burningInventoryTick(new ScriptRng(), [], isScroll, isMeat)).toBeNull();
  });

  test('scroll burns up (destroyed, no replacement)', () => {
    const r = burningInventoryTick(
      new ScriptRng(),
      [{ itemId: 'scroll', qty: 1 }],
      isScroll,
      isMeat,
    );
    expect(r).toEqual({ stackIndex: 0, cookedId: null });
  });

  test('mystery meat cooks into chargrilled meat', () => {
    const r = burningInventoryTick(
      new ScriptRng(),
      [{ itemId: 'mystery_meat', qty: 1 }],
      isScroll,
      isMeat,
    );
    expect(r).toEqual({ stackIndex: 0, cookedId: 'chargrilled_meat' });
  });

  test('other items are untouched', () => {
    const r = burningInventoryTick(
      new ScriptRng(),
      [{ itemId: 'potion_healing', qty: 2 }],
      isScroll,
      isMeat,
    );
    expect(r).toBeNull();
  });

  test('pick is uniform over instances (qty-weighted), like Random.element(backpack.items)', () => {
    // stacks: [scroll x1, potion x3]; ScriptRng int picks raw instance index.
    const stacks = [
      { itemId: 'scroll', qty: 1 },
      { itemId: 'potion_healing', qty: 3 },
    ];
    const pickScroll = burningInventoryTick(new ScriptRng([], [0]), stacks, isScroll, isMeat);
    expect(pickScroll?.stackIndex).toBe(0);
    const pickPotion = burningInventoryTick(new ScriptRng([], [2]), stacks, isScroll, isMeat);
    // instance 2 is a potion -> untouched
    expect(pickPotion).toBeNull();
  });
});
