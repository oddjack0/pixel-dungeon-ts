/**
 * Worker 5 (Stage 2) tests: weapon enchantments, armor glyphs, curses and
 * durability, the blacksmith quest/reforge, dark gold and the pickaxe.
 *
 * Ground truth: watabou/pixel-dungeon — items/weapon/enchantments/*.java,
 * items/armor/glyphs/*.java, items/Item.java (durability/curses),
 * items/weapon/Weapon.java, items/armor/Armor.java,
 * actors/mobs/npcs/Blacksmith.java, items/quest/Pickaxe.java,
 * items/quest/DarkGold.java, items/scrolls/ScrollOfUpgrade.java.
 */
import { describe, expect, test } from 'bun:test';
import type { MechanicsRng } from '../src/mechanics/rng.js';
import {
  ENCHANTMENT_INFO,
  enchantWeaponInstance,
  randomEnchantmentId,
  VERTIGO_DURATION,
  TERROR_DURATION,
  weaponAttackProc,
  type EnchantmentId,
  type ProcChar,
  type ProcFx,
} from '../src/content/enchantments.js';
import {
  GLYPH_INFO,
  armorDefenseProc,
  earthrootAbsorb,
  inscribeArmorInstance,
  randomGlyphId,
  type GlyphId,
} from '../src/content/glyphs.js';
import {
  TXT_EQUIP_CURSED_WEAPON,
  TXT_EQUIP_CURSED_ARMOR,
  TXT_GOING_TO_BREAK,
  TXT_HAS_BROKEN,
  TXT_INCOMPATIBLE_WEAPON,
  TXT_INCOMPATIBLE_ARMOR,
  TXT_UNEQUIP_CURSED,
  degradeItem,
  effectiveLevel,
  eraseArmorMagic,
  eraseWeaponMagic,
  fixDurability,
  initDurability,
  isBroken,
  maxDurability,
  polish,
  upgradeErasesMagic,
  upgradeItem,
  useDurability,
} from '../src/mechanics/durability.js';
import { ORIGINAL_SPRITES } from '../src/assets/original_sprites.js';
import {
  addToInventory,
  createStarterHero,
  type ItemStack,
} from '../src/content/hero.js';
import {
  mineDarkGold,
  noteWallDecoCells,
} from '../src/content/actions.js';

// ---------------------------------------------------------------------------
// Deterministic stubs
// ---------------------------------------------------------------------------

/** Scripted RNG: each method pops its queue, falling back to a default. */
function makeRng(
  over: Partial<{
    float: number[];
    int: number[];
    intRange: number[];
    normal: number[];
    picks: unknown[];
  }> = {},
): MechanicsRng {
  const q = {
    float: [...(over.float ?? [])],
    int: [...(over.int ?? [])],
    intRange: [...(over.intRange ?? [])],
    normal: [...(over.normal ?? [])],
    picks: [...(over.picks ?? [])],
  };
  const pop = (arr: number[], dflt: number): number =>
    arr.length > 0 ? arr.shift()! : dflt;
  return {
    float: (a: number, _b: number) => pop(q.float, a),
    int: (a: number, _b: number) => pop(q.int, a),
    intRange: (a: number, _b: number) => pop(q.intRange, a),
    normalIntRange: (a: number, b: number) =>
      pop(q.normal, Math.floor((a + b) / 2)),
    pick: <T>(arr: readonly T[]): T =>
      q.picks.length > 0 ? (q.picks.shift() as T) : arr[0]!,
  };
}

function makeChar(over: Partial<ProcChar> = {}): ProcChar {
  return {
    id: 1,
    pos: 0,
    x: 0,
    y: 0,
    hp: 20,
    ht: 20,
    flying: false,
    buffs: {},
    immunities: [],
    resistances: [],
    ...over,
  };
}

interface FxCalls {
  logs: string[];
  damaged: { target: ProcChar; amount: number; source: string }[];
  healed: { target: ProcChar; amount: number }[];
  statuses: { target: ProcChar; text: string }[];
}

/** ProcFx stub recording every effect. */
function makeFx(rng: MechanicsRng, over: Partial<ProcFx> = {}): ProcFx & FxCalls {
  const calls: FxCalls = { logs: [], damaged: [], healed: [], statuses: [] };
  const fx = {
    rng,
    log: (m: string) => calls.logs.push(m),
    directDamage: (target: ProcChar, amount: number, source: string) => {
      calls.damaged.push({ target, amount, source });
      target.hp = Math.max(0, target.hp - amount);
    },
    heal: (target: ProcChar, amount: number) => {
      const real = Math.min(amount, target.ht - target.hp);
      target.hp += real;
      calls.healed.push({ target, amount: real });
      return real;
    },
    attackerDamageRoll: (_a: ProcChar) => 10,
    showStatus: (target: ProcChar, text: string) =>
      calls.statuses.push({ target, text }),
    isWater: (_p: number) => false,
    charsAround: (_p: number) => [],
    isFreeCell: (_p: number) => true,
    isVisible: (_p: number) => true,
    isBossLevel: () => false,
    teleport: (ch: ProcChar, pos: number) => {
      ch.pos = pos;
    },
    pressCell: (_ch: ProcChar) => {},
    seedGas: (_p: number, _a: number) => {},
    spawnMirrorImage: (_h: ProcChar) => false,
    spendGold: (_a: number) => true,
    polishHeroArmor: () => {},
    addHunger: (_a: number) => {},
    isStarving: () => false,
    ...over,
  } as ProcFx & FxCalls;
  Object.assign(fx, calls);
  return fx;
}

function makeWeapon(
  over: Partial<{
    name: string;
    level: number;
    durability: number;
    enchantment: EnchantmentId | null;
  }> = {},
) {
  return {
    name: 'sword',
    level: 0,
    durability: 80,
    enchantment: null,
    ...over,
  };
}

function makeArmor(
  over: Partial<{
    name: string;
    level: number;
    tier: number;
    durability: number;
    glyph: GlyphId | null;
  }> = {},
) {
  return {
    name: 'mail',
    level: 0,
    tier: 3,
    durability: 96,
    glyph: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Enchantment selection (Weapon.Enchantment.random, Weapon.java:237-244)
// ---------------------------------------------------------------------------

describe('enchantment selection', () => {
  test('weighted table matches the Java order and weights', () => {
    const expected: [EnchantmentId, number][] = [
      ['fire', 10],
      ['poison', 10],
      ['death', 1],
      ['paralysis', 2],
      ['leech', 1],
      ['slow', 2],
      ['shock', 6],
      ['instability', 3],
      ['horror', 2],
      ['luck', 2],
      ['tempering', 3],
    ];
    let total = 0;
    for (const [id, weight] of expected) {
      expect(ENCHANTMENT_INFO[id].weight).toBe(weight);
      total += weight;
    }
    expect(total).toBe(42);
  });

  test('exact enchantment names', () => {
    const names: Record<EnchantmentId, string> = {
      fire: 'blazing',
      poison: 'venomous',
      death: 'grim',
      paralysis: 'stunning',
      leech: 'vampiric',
      slow: 'chilling',
      shock: 'shocking',
      instability: 'unstable',
      horror: 'eldritch',
      luck: 'lucky',
      tempering: 'tempered',
    };
    for (const [id, name] of Object.entries(names) as [EnchantmentId, string][]) {
      expect(ENCHANTMENT_INFO[id].name).toBe(name);
    }
  });

  test('randomEnchantmentId draws by cumulative weight', () => {
    // Boundaries: fire [0,10), poison [10,20), death [20,21), ...
    expect(randomEnchantmentId(makeRng({ float: [0] }))).toBe('fire');
    expect(randomEnchantmentId(makeRng({ float: [9.99] }))).toBe('fire');
    expect(randomEnchantmentId(makeRng({ float: [10] }))).toBe('poison');
    expect(randomEnchantmentId(makeRng({ float: [19.99] }))).toBe('poison');
    expect(randomEnchantmentId(makeRng({ float: [20] }))).toBe('death');
    expect(randomEnchantmentId(makeRng({ float: [20.99] }))).toBe('death');
    expect(randomEnchantmentId(makeRng({ float: [21] }))).toBe('paralysis');
    expect(randomEnchantmentId(makeRng({ float: [41.99] }))).toBe('tempering');
  });

  test('enchantWeaponInstance re-rolls until the enchantment changes (Weapon.enchant)', () => {
    const w = makeWeapon({ enchantment: 'fire' });
    // First draw repeats 'fire' (roll 0), second draw gives 'poison'.
    const id = enchantWeaponInstance(makeRng({ float: [0, 10] }), w);
    expect(id).toBe('poison');
    expect(w.enchantment).toBe('poison');
  });

  test('enchantWeaponInstance on an unenchanted weapon takes the first draw', () => {
    const w = makeWeapon({ enchantment: null });
    expect(enchantWeaponInstance(makeRng({ float: [30] }), w)).toBe('shock');
  });
});

// ---------------------------------------------------------------------------
// Enchantment procs (items/weapon/enchantments/*.java), driven through
// weaponAttackProc so the durability consumption is included.
// ---------------------------------------------------------------------------

describe('enchantment procs', () => {
  test('death: Random.Int(level+100) >= 92 deals current HP (Death.java)', () => {
    const defender = makeChar({ hp: 17 });
    const fx = makeFx(makeRng({ int: [92] })); // gate passes
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'death' }));
    expect(fx.damaged).toHaveLength(1);
    expect(fx.damaged[0]!.amount).toBe(17);
    expect(fx.damaged[0]!.source).toBe('death');
    expect(defender.hp).toBe(0);
  });

  test('death: gate fails below 92, no damage', () => {
    const defender = makeChar({ hp: 17 });
    const fx = makeFx(makeRng({ int: [91] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'death' }));
    expect(fx.damaged).toHaveLength(0);
    expect(defender.hp).toBe(17);
  });

  test('death: immunity blocks the proc', () => {
    const defender = makeChar({ hp: 17, immunities: ['death'] });
    const fx = makeFx(makeRng({ int: [99] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'death' }));
    expect(fx.damaged).toHaveLength(0);
  });

  test('fire: gate Random.Int(level+3) >= 2; coin flip reignites or deals Int(1,level+2)', () => {
    // Reignite branch (coin 0).
    const d1 = makeChar();
    const fx1 = makeFx(makeRng({ int: [2, 0] }));
    weaponAttackProc(fx1, makeChar(), d1, 5, makeWeapon({ enchantment: 'fire' }));
    expect(d1.buffs['burning']).toBeDefined();
    expect(fx1.damaged).toHaveLength(0);
    // Direct-damage branch (coin 1): Int(1, level+2) with level 0 -> int(1,2).
    const d2 = makeChar({ hp: 20 });
    const fx2 = makeFx(makeRng({ int: [2, 1, 1] }));
    weaponAttackProc(fx2, makeChar(), d2, 5, makeWeapon({ enchantment: 'fire' }));
    expect(fx2.damaged).toHaveLength(1);
    expect(fx2.damaged[0]!.amount).toBe(1);
    expect(fx2.damaged[0]!.source).toBe('fire');
    // Gate fails.
    const d3 = makeChar();
    const fx3 = makeFx(makeRng({ int: [1] }));
    weaponAttackProc(fx3, makeChar(), d3, 5, makeWeapon({ enchantment: 'fire' }));
    expect(d3.buffs['burning']).toBeUndefined();
    expect(fx3.damaged).toHaveLength(0);
  });

  test('horror: hero defender gets Vertigo (affect), mob gets Terror sourced to attacker', () => {
    const attacker = makeChar({ id: 7 });
    const heroDef = makeChar({ kind: 'hero' });
    const fx1 = makeFx(makeRng({ int: [4] }));
    weaponAttackProc(fx1, attacker, heroDef, 5, makeWeapon({ enchantment: 'horror' }));
    expect(heroDef.buffs['vertigo']).toBeDefined();
    expect(heroDef.buffs['vertigo']!.left).toBe(VERTIGO_DURATION);

    const mobDef = makeChar({ id: 9 });
    const fx2 = makeFx(makeRng({ int: [4] }));
    weaponAttackProc(fx2, attacker, mobDef, 5, makeWeapon({ enchantment: 'horror' }));
    expect(mobDef.buffs['terror']).toBeDefined();
    expect(mobDef.buffs['terror']!.left).toBe(TERROR_DURATION);
    expect(mobDef.buffs['terror']!.sourceId).toBe(7);
  });

  test('horror: gate Random.Int(level+5) >= 4', () => {
    const defender = makeChar({ kind: 'hero' });
    const fx = makeFx(makeRng({ int: [3] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'horror' }));
    expect(defender.buffs['vertigo']).toBeUndefined();
  });

  test('leech: heals min(IntRange(0, floor(damage*(level+2)/(level+6))), missing HP)', () => {
    // damage 12, level 0: max = floor(12*2/6) = 4; roll 4; missing 10 -> heal 4.
    const attacker = makeChar({ hp: 10, ht: 20 });
    const fx = makeFx(makeRng({ intRange: [4] }));
    weaponAttackProc(fx, attacker, makeChar(), 12, makeWeapon({ enchantment: 'leech' }));
    expect(fx.healed).toHaveLength(1);
    expect(fx.healed[0]!.amount).toBe(4);
    expect(attacker.hp).toBe(14);
  });

  test('leech: heal is capped by missing HP', () => {
    const attacker = makeChar({ hp: 19, ht: 20 });
    const fx = makeFx(makeRng({ intRange: [4] }));
    weaponAttackProc(fx, attacker, makeChar(), 12, makeWeapon({ enchantment: 'leech' }));
    expect(fx.healed[0]!.amount).toBe(1);
    expect(attacker.hp).toBe(20);
  });

  test('luck: positive difference over damage dealt directly (Luck.java)', () => {
    // damage 5, level 1: i=1 -> roll 10-1=9 > 5; i=2 -> 10-2=8 < 9.
    // best 9 -> direct 4.
    const defender = makeChar({ hp: 20 });
    const fx = makeFx(makeRng());
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'luck', level: 1 }));
    expect(fx.damaged).toHaveLength(1);
    expect(fx.damaged[0]!.amount).toBe(4);
    expect(fx.damaged[0]!.source).toBe('luck');
    expect(fx.statuses).toHaveLength(1);
    expect(fx.statuses[0]!.text).toBe('+4');
  });

  test('luck: no bonus when rolls do not beat damage', () => {
    const defender = makeChar({ hp: 20 });
    const fx = makeFx(makeRng(), {
      attackerDamageRoll: () => 3,
    });
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'luck' }));
    expect(fx.damaged).toHaveLength(0);
  });

  test('paralysis: Random.Int(level+8) >= 7 prolongs by Float(1, 1.5+level)', () => {
    const defender = makeChar();
    const fx = makeFx(makeRng({ int: [7], float: [1.25] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'paralysis' }));
    expect(defender.buffs['paralysis']).toBeDefined();
    expect(defender.buffs['paralysis']!.left).toBeCloseTo(1.25, 10);
  });

  test('poison: Random.Int(level+3) >= 2 sets duration (level+1)', () => {
    const defender = makeChar();
    const fx = makeFx(makeRng({ int: [2] }));
    weaponAttackProc(
      fx, makeChar(), defender, 5,
      makeWeapon({ enchantment: 'poison', level: 2 }),
    );
    expect(defender.buffs['poison']!.left).toBe(3); // 1 * (2+1)
  });

  test('poison: immunity blocks', () => {
    const defender = makeChar({ immunities: ['poison'] });
    const fx = makeFx(makeRng({ int: [2] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'poison' }));
    expect(defender.buffs['poison']).toBeUndefined();
  });

  test('shock: Random.Int(level+4) >= 3; Int(1, damage/2); water doubles for non-flying', () => {
    const defender = makeChar({ hp: 20, pos: 5 });
    const fx = makeFx(makeRng({ int: [3, 2] })); // gate, then Int(1, 10/2=5) -> 2
    weaponAttackProc(fx, makeChar(), defender, 10, makeWeapon({ enchantment: 'shock' }));
    expect(fx.damaged).toHaveLength(1);
    expect(fx.damaged[0]!.amount).toBe(2);
    expect(fx.damaged[0]!.source).toBe('lightning');
  });

  test('shock: chains to an adjacent char', () => {
    const defender = makeChar({ id: 1, hp: 20, pos: 5 });
    const other = makeChar({ id: 2, hp: 20, pos: 6 });
    const fx = makeFx(
      // gate, Int(1,5), chain target idx 0, chain Int(5,10)->7, chain Int(1,3)->1
      makeRng({ int: [3, 2, 0, 7, 1] }),
      { charsAround: () => [other] },
    );
    weaponAttackProc(fx, makeChar(), defender, 10, makeWeapon({ enchantment: 'shock' }));
    expect(fx.damaged).toHaveLength(2);
    expect(fx.damaged[1]!.target).toBe(other);
    expect(fx.damaged[1]!.amount).toBe(1);
  });

  test('slow: Random.Int(level+4) >= 3 prolongs Slow', () => {
    const defender = makeChar();
    const fx = makeFx(makeRng({ int: [3], float: [2] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'slow' }));
    expect(defender.buffs['slow']!.left).toBe(2);
  });

  test('tempering: weaponAttackProc polishes (+1 durability)', () => {
    const w = makeWeapon({ enchantment: 'tempering', level: 1, durability: 70 });
    // max at level 1: 5*(16-1) = 75.
    const fx = makeFx(makeRng());
    weaponAttackProc(fx, makeChar(), makeChar(), 5, w);
    // polish +1 then useDurability -1 (level > 0): net unchanged.
    expect(w.durability).toBe(70);
  });

  test('instability: procs a random enchantment (recursive pool)', () => {
    // Instability draws 'death' (float 20 -> death) with gate 99.
    const defender = makeChar({ hp: 11 });
    const fx = makeFx(makeRng({ float: [20], int: [99] }));
    weaponAttackProc(fx, makeChar(), defender, 5, makeWeapon({ enchantment: 'instability' }));
    expect(fx.damaged).toHaveLength(1);
    expect(fx.damaged[0]!.source).toBe('death');
    expect(fx.damaged[0]!.amount).toBe(11);
  });

  test('weaponAttackProc with no enchantment only consumes durability', () => {
    const w = makeWeapon({ enchantment: null, level: 1, durability: 75 });
    const fx = makeFx(makeRng());
    weaponAttackProc(fx, makeChar(), makeChar(), 5, w);
    expect(fx.damaged).toHaveLength(0);
    expect(w.durability).toBe(74);
  });

  test('weaponAttackProc logs the break warning at the threshold', () => {
    // level 1: max 75, threshold floor(75/6) = 12. durability 13 -> 12: no
    // warning (crossing from above means strictly below after).
    const w1 = makeWeapon({ enchantment: null, level: 1, durability: 13 });
    const fx1 = makeFx(makeRng());
    weaponAttackProc(fx1, makeChar(), makeChar(), 5, w1);
    expect(fx1.logs).toHaveLength(0);
    // durability 12 -> 11: warning fires.
    const w2 = makeWeapon({ enchantment: null, level: 1, durability: 12 });
    const fx2 = makeFx(makeRng());
    weaponAttackProc(fx2, makeChar(), makeChar(), 5, w2);
    expect(fx2.logs).toHaveLength(1);
    expect(fx2.logs[0]).toBe(TXT_GOING_TO_BREAK.replace('%s', 'sword'));
  });

  test('weaponAttackProc logs the break line when durability hits 0', () => {
    const w = makeWeapon({ enchantment: null, level: 1, durability: 1 });
    const fx = makeFx(makeRng());
    weaponAttackProc(fx, makeChar(), makeChar(), 5, w);
    expect(w.durability).toBe(0);
    expect(fx.logs.some((m) => m === TXT_HAS_BROKEN.replace('%s', 'sword'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Glyph selection (Glyph.random, Glyph.java) and glyph procs
// (items/armor/glyphs/*.java), driven through armorDefenseProc.
// ---------------------------------------------------------------------------

describe('glyph selection', () => {
  test('uniform over the 11 glyphs', () => {
    const ids = Object.keys(GLYPH_INFO) as GlyphId[];
    expect(ids).toHaveLength(11);
    for (let i = 0; i < 11; i++) {
      expect(randomGlyphId(makeRng({ int: [i] }))).toBe(ids[i]);
    }
  });

  test('inscribeArmorInstance re-rolls until the glyph changes (Armor.inscribe)', () => {
    const a = makeArmor({ glyph: 'bounce' });
    const order = Object.keys(GLYPH_INFO) as GlyphId[];
    const bounceIdx = order.indexOf('bounce');
    const id = inscribeArmorInstance(makeRng({ int: [bounceIdx, 0] }), a);
    expect(id).toBe(order[0]);
    expect(id).not.toBe('bounce');
    expect(a.glyph).toBe(order[0]);
  });
});

describe('glyph procs', () => {
  // All glyphs are tested at level 0 unless noted; attacker adjacent to
  // the defender at (0,0)/(1,0) on a w=10 board.

  function adjacentPair(defenderKind?: string) {
    const attacker = makeChar({ id: 1, pos: 1, x: 1, y: 0 });
    const defender = makeChar({ id: 2, pos: 0, x: 0, y: 0, kind: defenderKind });
    return { attacker, defender };
  }

  function defense(
    fx: ProcFx,
    glyph: GlyphId,
    attacker: ProcChar,
    defender: ProcChar,
    damage: number,
    armor = makeArmor({ glyph }),
  ): number {
    return armorDefenseProc(fx, armor, attacker, defender, damage, 10, 10);
  }

  test('affection: adjacent and Int(lvl/2+5)>=4 charms both (Affection.java)', () => {
    const { attacker, defender } = adjacentPair();
    // lvl = max(0, min(0,6)) = 0 -> Int(0, 5) >= 4.
    const fx = makeFx(makeRng({ int: [4], intRange: [5], float: [0.5] }));
    const out = defense(fx, 'affection', attacker, defender, 8);
    expect(out).toBe(8);
    expect(attacker.buffs['charm']).toBeDefined();
    expect(attacker.buffs['charm']!.left).toBe(5);
    expect(attacker.buffs['charm']!.sourceId).toBe(defender.id);
    expect(defender.buffs['charm']!.left).toBe(2); // floor(5 * 0.5)
  });

  test('affection: non-adjacent never procs', () => {
    const attacker = makeChar({ id: 1, pos: 9, x: 9, y: 0 });
    const defender = makeChar({ id: 2, pos: 0, x: 0, y: 0 });
    const fx = makeFx(makeRng({ int: [4] }));
    defense(fx, 'affection', attacker, defender, 8);
    expect(attacker.buffs['charm']).toBeUndefined();
  });

  test('antiEntropy: frosts the attacker, reignites the defender (AntiEntropy.java)', () => {
    const { attacker, defender } = adjacentPair();
    defender.buffs['burning'] = { kind: 'burning', left: 1 };
    const fx = makeFx(makeRng({ int: [5], float: [1.25] })); // Int(0,6)>=5
    defense(fx, 'antiEntropy', attacker, defender, 8);
    expect(attacker.buffs['frost']).toBeDefined();
    expect(attacker.buffs['frost']!.left).toBeCloseTo(5 * 1.25, 10);
    expect(defender.buffs['burning']!.left).toBe(8); // reignited
  });

  test('autoRepair: hero defender with gold polishes the armor', () => {
    const { attacker, defender } = adjacentPair('hero');
    const armor = makeArmor({ glyph: 'autoRepair', durability: 90 });
    const fx = makeFx(makeRng());
    const out = armorDefenseProc(fx, armor, attacker, defender, 8, 10, 10);
    expect(out).toBe(8);
    // polish +1 then useDurability -1 (level 0: no consumption! level<=0).
    expect(armor.durability).toBe(91);
  });

  test('bounce: shoves the attacker one cell farther (Bounce.java)', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [4] })); // Int(0,5) >= 4
    defense(fx, 'bounce', attacker, defender, 8);
    // attacker (1,0), defender (0,0) -> new (2,0) = pos 2.
    expect(attacker.pos).toBe(2);
  });

  test('bounce: blocked landing cell -> no move', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [4] }), { isFreeCell: () => false });
    defense(fx, 'bounce', attacker, defender, 8);
    expect(attacker.pos).toBe(1);
  });

  test('displacement: teleports the defender (Displacement.java)', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [42] }));
    defense(fx, 'displacement', attacker, defender, 8);
    expect(defender.pos).toBe(42);
  });

  test('displacement: never procs on boss levels', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [42] }), { isBossLevel: () => true });
    defense(fx, 'displacement', attacker, defender, 8);
    expect(defender.pos).toBe(0);
  });

  test('entanglement: 1/4 roots and sets Earthroot armor 5*(level+1)', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [0] }));
    const out = armorDefenseProc(
      fx, makeArmor({ glyph: 'entanglement', level: 1 }), attacker, defender, 8, 10, 10,
    );
    expect(out).toBe(8);
    expect(defender.buffs['roots']!.left).toBe(5);
    expect(defender.buffs['earthrootArmor']!.amount).toBe(10); // 5*(1+1)
  });

  test('earthrootAbsorb: absorbs before the glyph (Hero.defenseProc)', () => {
    // 10 armor, 8 damage -> 0 damage, 2 remaining.
    expect(earthrootAbsorb(10, 8)).toEqual({ damage: 0, remaining: 2 });
    // 5 armor, 8 damage -> 3 damage, armor gone.
    expect(earthrootAbsorb(5, 8)).toEqual({ damage: 3, remaining: 0 });
  });

  test('earthroot armor absorbs in armorDefenseProc and is consumed', () => {
    const { attacker, defender } = adjacentPair();
    defender.buffs['earthrootArmor'] = {
      kind: 'earthrootArmor',
      left: Infinity,
      amount: 10,
    };
    const fx = makeFx(makeRng());
    const out = defense(fx, 'viscosity', attacker, defender, 8);
    expect(out).toBe(0); // fully absorbed
    expect(defender.buffs['earthrootArmor']!.amount).toBe(2);
  });

  test('metabolism: hero-only heal, hunger worsens by 36', () => {
    const { attacker, defender } = adjacentPair('hero');
    defender.hp = 10;
    defender.ht = 20;
    let hunger = 0;
    const fx = makeFx(makeRng({ int: [4, 3] }), { // gate Int(0,5)>=4, Int(1,4)
      addHunger: (a: number) => {
        hunger += a;
      },
    });
    const out = defense(fx, 'metabolism', attacker, defender, 8);
    expect(out).toBe(8);
    expect(defender.hp).toBe(13);
    expect(hunger).toBe(36);
  });

  test('metabolism: does not proc for non-hero defenders', () => {
    const { attacker, defender } = adjacentPair();
    defender.hp = 10;
    const fx = makeFx(makeRng({ int: [4] }));
    defense(fx, 'metabolism', attacker, defender, 8);
    expect(defender.hp).toBe(10);
  });

  test('multiplicity: spawns the image and deals IntRange(1, HT/6)', () => {
    const { attacker, defender } = adjacentPair();
    defender.ht = 24;
    let spawned = false;
    const fx = makeFx(makeRng({ int: [5], intRange: [2] }), {
      spawnMirrorImage: () => {
        spawned = true;
        return true;
      },
    });
    const out = defense(fx, 'multiplicity', attacker, defender, 8);
    expect(out).toBe(8);
    expect(spawned).toBe(true);
    expect(fx.damaged).toHaveLength(1);
    expect(fx.damaged[0]!.amount).toBe(2);
    expect(fx.damaged[0]!.source).toBe('multiplicity');
  });

  test('potential: lightning hits attacker then defender (Potential.java)', () => {
    const { attacker, defender } = adjacentPair();
    attacker.hp = 20;
    defender.hp = 20;
    const fx = makeFx(makeRng({ int: [6], intRange: [3, 2] })); // gate Int(0,7)>=6
    const out = defense(fx, 'potential', attacker, defender, 8);
    expect(out).toBe(8);
    expect(fx.damaged).toHaveLength(2);
    expect(fx.damaged[0]!.target).toBe(attacker);
    expect(fx.damaged[0]!.amount).toBe(3);
    expect(fx.damaged[1]!.target).toBe(defender);
    expect(fx.damaged[1]!.amount).toBe(2);
  });

  test('stench: seeds 20 ToxicGas at the attacker (Stench.java)', () => {
    const { attacker, defender } = adjacentPair();
    const seeded: { pos: number; amount: number }[] = [];
    const fx = makeFx(makeRng({ int: [4] }), {
      seedGas: (pos: number, amount: number) => seeded.push({ pos, amount }),
    });
    defense(fx, 'stench', attacker, defender, 8);
    expect(seeded).toEqual([{ pos: attacker.pos, amount: 20 }]);
  });

  test('viscosity: defers the whole hit, returns 0 (Viscosity.java)', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [6] })); // Int(0,7) >= 6
    const out = defense(fx, 'viscosity', attacker, defender, 8);
    expect(out).toBe(0);
    expect(defender.buffs['deferredDamage']!.amount).toBe(8);
  });

  test('viscosity: damage 0 passes through', () => {
    const { attacker, defender } = adjacentPair();
    const fx = makeFx(makeRng({ int: [6] }));
    const out = defense(fx, 'viscosity', attacker, defender, 0);
    expect(out).toBe(0);
    expect(defender.buffs['deferredDamage']).toBeUndefined();
  });

  test('viscosity: existing pool accumulates', () => {
    const { attacker, defender } = adjacentPair();
    defender.buffs['deferredDamage'] = {
      kind: 'deferredDamage',
      left: Infinity,
      amount: 5,
    };
    const fx = makeFx(makeRng({ int: [6] }));
    defense(fx, 'viscosity', attacker, defender, 8);
    expect(defender.buffs['deferredDamage']!.amount).toBe(13);
  });

  test('armorDefenseProc consumes durability and warns/breaks like weapons', () => {
    const { attacker, defender } = adjacentPair();
    // level 1 armor: max 90, threshold floor(90/6) = 15. 15 -> 14 warns.
    const armor = makeArmor({ glyph: null, level: 1, durability: 15 });
    const fx = makeFx(makeRng());
    armorDefenseProc(fx, armor, attacker, defender, 8, 10, 10);
    expect(armor.durability).toBe(14);
    expect(fx.logs).toHaveLength(1);
    expect(fx.logs[0]).toBe(TXT_GOING_TO_BREAK.replace('%s', 'mail'));
  });
});

// ---------------------------------------------------------------------------
// Durability (Item.java:301-324, Item.java:270-299)
// ---------------------------------------------------------------------------

describe('durability', () => {
  test('maxDurability formulas: weapon 5*(16-lvl), armor 6*(16-lvl)', () => {
    expect(maxDurability('weapon', 0)).toBe(80);
    expect(maxDurability('weapon', 5)).toBe(55);
    expect(maxDurability('weapon', 15)).toBe(5);
    expect(maxDurability('armor', 0)).toBe(96);
    expect(maxDurability('armor', 5)).toBe(66);
    expect(maxDurability('armor', 15)).toBe(6);
  });

  test('max-durability level is clamped to zero (no negative durability)', () => {
    expect(maxDurability('weapon', 16)).toBe(5);
    expect(maxDurability('weapon', 20)).toBe(5);
    expect(maxDurability('armor', 16)).toBe(6);
  });

  test('initDurability sets durability to the maximum', () => {
    const w = makeWeapon({ level: 3, durability: undefined });
    initDurability(w, 'weapon');
    expect(w.durability).toBe(maxDurability('weapon', 3));
  });

  test('useDurability consumes only when level > 0 and not broken', () => {
    const w0 = makeWeapon({ level: 0, durability: 80 });
    expect(useDurability(w0, 'weapon', true)).toEqual({
      warned: false,
      broke: false,
    });
    expect(w0.durability).toBe(80);

    const broken = makeWeapon({ level: 1, durability: 0 });
    expect(useDurability(broken, 'weapon', true)).toEqual({
      warned: false,
      broke: false,
    });
  });

  test('warning threshold is floor(max/6), fires crossing from above', () => {
    // level 1: max 75, threshold 12. 12->11 warns; 13->12 does not.
    const w = makeWeapon({ level: 1, durability: 12 });
    const r1 = useDurability(w, 'weapon', true);
    expect(r1.warned).toBe(true);
    expect(r1.broke).toBe(false);

    const w2 = makeWeapon({ level: 1, durability: 13 });
    expect(useDurability(w2, 'weapon', true).warned).toBe(false);
  });

  test('broke when durability reaches 0', () => {
    const w = makeWeapon({ level: 1, durability: 1 });
    const r = useDurability(w, 'weapon', true);
    expect(r.broke).toBe(true);
    expect(isBroken(w)).toBe(true);
  });

  test('effectiveLevel is 0 when broken', () => {
    expect(effectiveLevel(makeWeapon({ level: 3, durability: 10 }))).toBe(3);
    expect(effectiveLevel(makeWeapon({ level: 3, durability: 0 }))).toBe(0);
  });

  test('fixDurability restores the maximum; polish adds 1 up to the maximum', () => {
    const w = makeWeapon({ level: 1, durability: 10 });
    polish(w, 'weapon');
    expect(w.durability).toBe(11);
    const w2 = makeWeapon({ level: 1, durability: 75 });
    polish(w2, 'weapon');
    expect(w2.durability).toBe(75);
    fixDurability(w, 'weapon');
    expect(w.durability).toBe(75);
  });

  test('upgradeItem clears the curse, identifies, raises level, fixes', () => {
    const w = {
      level: 2,
      durability: 30,
      cursed: true,
      cursedKnown: false,
      upgradable: true,
    };
    upgradeItem(w, 'weapon');
    expect(w.level).toBe(3);
    expect(w.cursed).toBe(false);
    expect(w.cursedKnown).toBe(true);
    expect(w.durability).toBe(maxDurability('weapon', 3));
  });

  test('degradeItem lowers level and fixes without clearing the curse', () => {
    const w = {
      level: 2,
      durability: 30,
      cursed: true,
      cursedKnown: true,
      upgradable: true,
    };
    degradeItem(w, 'weapon');
    expect(w.level).toBe(1);
    expect(w.cursed).toBe(true);
    expect(w.durability).toBe(maxDurability('weapon', 1));
  });

  test('upgradeErasesMagic uses the pre-upgrade Random.Int(level) > 0 roll', () => {
    // level 3: Int(3) > 0 erases. level 1: Int(1) = 0 never erases.
    // (inscribe=false, hasMagic=true in all cases.)
    expect(upgradeErasesMagic(makeRng({ int: [2] }), 3, false, true)).toBe(true);
    expect(upgradeErasesMagic(makeRng({ int: [0] }), 3, false, true)).toBe(false);
    expect(upgradeErasesMagic(makeRng({ int: [0] }), 1, false, true)).toBe(false);
    expect(upgradeErasesMagic(makeRng({ int: [0] }), 0, false, true)).toBe(false);
  });

  test('eraseWeaponMagic/eraseArmorMagic clear enchantments/glyphs', () => {
    // Erasure needs pre-upgrade level >= 2 (Random.Int(level) > 0).
    const logs: string[] = [];
    const w = makeWeapon({ enchantment: 'fire', level: 2 });
    eraseWeaponMagic(w, makeRng({ int: [1] }), false, (m) => logs.push(m));
    expect(w.enchantment).toBeNull();

    const a = makeArmor({ glyph: 'bounce', level: 2 });
    eraseArmorMagic(a, makeRng({ int: [1] }), false, (m) => logs.push(m));
    expect(a.glyph).toBeNull();
    expect(logs.length).toBe(2);
  });

  test('exact durability log lines', () => {
    // Item.java:58-59 TXT_BROKEN / TXT_GONNA_BREAK.
    expect(TXT_GOING_TO_BREAK.replace('%s', 'dagger')).toBe(
      'Because of frequent use, your dagger is going to break soon.',
    );
    expect(TXT_HAS_BROKEN.replace('%s', 'dagger')).toBe(
      'Because of frequent use, your dagger has broken.',
    );
  });

  test('exact incompatible-magic messages', () => {
    // Weapon.java:41-42 / Armor.java:48-49 TXT_INCOMPATIBLE.
    expect(TXT_INCOMPATIBLE_WEAPON).toBe(
      'Interaction of different types of magic has negated the enchantment on this weapon!',
    );
    expect(TXT_INCOMPATIBLE_ARMOR).toBe(
      'Interaction of different types of magic has erased the glyph on this armor!',
    );
  });
});

// ---------------------------------------------------------------------------
// Curses (Item.cursed, equip/unequip gating)
// ---------------------------------------------------------------------------

describe('curses', () => {
  test('exact unequip refusal message', () => {
    expect(TXT_UNEQUIP_CURSED.replace('%s', 'cursed sword')).toBe(
      "You can't remove cursed cursed sword!",
    );
  });

  test('exact cursed-equip messages', () => {
    // KindOfWeapon.java:30 / Armor.java:41 TXT_EQUIP_CURSED.
    expect(TXT_EQUIP_CURSED_WEAPON).toBe(
      'you wince as your grip involuntarily tightens around your %s',
    );
    expect(TXT_EQUIP_CURSED_ARMOR).toBe(
      'your %s constricts around you painfully',
    );
  });
});

// ---------------------------------------------------------------------------
// Scroll of Upgrade (ScrollOfUpgrade.java): known vs broken handling
// ---------------------------------------------------------------------------

describe('scroll of upgrade', () => {
  test('broken (durability 0) weapon is fixed, not upgraded', async () => {
    const { RNG } = await import('../src/core/rng.js');
    const { Terrain } = await import('../src/core/grid.js');
    const { Level } = await import('../src/dungeon/level.js');
    const { addToInventory, createStarterHero } = await import(
      '../src/content/hero.js'
    );
    const { useInventorySlot } = await import('../src/content/actions.js');
    const { resetIdentification, initIdentification } = await import(
      '../src/content/identification.js'
    );
    const { potionFamilyDef } = await import('../src/content/potions.js');
    const { scrollFamilyDef } = await import('../src/content/scrolls.js');

    const level = new Level(12, 12);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) level.set(x, y, Terrain.FLOOR);
    const rng = new RNG(777);
    const hero = createStarterHero(5 * 12 + 5, 12);
    resetIdentification();
    initIdentification(rng, potionFamilyDef(), scrollFamilyDef());
    const logs: string[] = [];
    const ctx = {
      rng,
      level,
      hero,
      mobs: [],
      log: (m: string) => logs.push(m),
      killMob: () => {},
      removeMob: () => {},
      addMob: () => {},
      syncMobs: () => {},
    } as never;

    // The starter shortsword is equipped (hero.weapon), not in the backpack.
    const gear = hero.weapon!;
    gear.durability = 0; // broken
    gear.cursed = true; // must survive: the broken scroll only fixes
    const beforeLevel = gear.level;

    addToInventory(hero, 'scroll_upgrade', 1);
    const slot = hero.inventory.findIndex((s) => s.itemId === 'scroll_upgrade');
    useInventorySlot(ctx, hero, slot);

    // ScrollOfUpgrade.java:38-48: a broken item is only fixed (no level gain).
    expect(gear.level).toBe(beforeLevel);
    expect(gear.durability).toBe(maxDurability('weapon', beforeLevel));
    expect(gear.cursed).toBe(true);
    expect(logs.some((m) => m.includes('certainly looks better now'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pickaxe, dark gold, mining (Pickaxe.java, DarkGold.java)
// ---------------------------------------------------------------------------

describe('pickaxe and dark gold', () => {
  test('required sprite keys exist', () => {
    for (const key of ['npc_blacksmith', 'item_darkgold', 'item_pickaxe']) {
      expect(ORIGINAL_SPRITES[key]).toBeDefined();
    }
  });

  test('darkgold catalog: stackable quest ore, price 1', async () => {
    const { getItem } = await import('../src/content/items.js');
    const def = getItem('darkgold');
    expect(def.name).toBe('dark gold ore');
    expect(def.sprite).toBe('item_darkgold');
    expect(def.stackable).toBe(true);
    expect(def.price).toBe(1);
  });

  test('pickaxe catalog: STR 14, min 3, max 12, non-upgradable, price 0', async () => {
    const { getItem } = await import('../src/content/items.js');
    const def = getItem('pickaxe');
    expect(def.sprite).toBe('item_pickaxe');
    expect(def.weapon!.str).toBe(14);
    expect(def.weapon!.min).toBe(3);
    expect(def.weapon!.max).toBe(12);
    expect(def.weapon!.upgradable).toBe(false);
    expect(def.price).toBe(0);
  });

  function miningSetup(depth: number, veinPos: number | null) {
    const hero = createStarterHero(55, 10);
    hero.pos = 55; // (5,5) on a 10-wide board
    const level = { depth, w: 10 };
    noteWallDecoCells(level, veinPos === null ? [] : [veinPos]);
    addToInventory(hero, 'pickaxe', 1);
    const slot = hero.inventory.findIndex((s) => s.itemId === 'pickaxe');
    const logs: string[] = [];
    const ctx = {
      rng: {},
      level,
      hero,
      mobs: [],
      log: (m: string) => logs.push(m),
    } as never;
    return { hero, ctx, slot, logs, mineDarkGold };
  }

  test('mining a vein: costs 2 turns, grants one dark gold, hunger +36', () => {
    const { hero, ctx, slot, logs, mineDarkGold } = miningSetup(12, 56); // adjacent vein
    hero.hungerLevel = 100;
    const cost = mineDarkGold(ctx, hero, slot);
    expect(cost).toBe(2); // TIME_TO_MINE (Pickaxe.java)
    const gold = hero.inventory.find((s: { itemId: string }) => s.itemId === 'darkgold');
    expect(gold).toBeDefined();
    expect(gold!.qty).toBe(1);
    expect(hero.hungerLevel).toBe(136); // +36 (STARVING/10)
    expect(logs.some((m: string) => m.includes('dark gold ore'))).toBe(true);
  });

  test('mining twice consumes two veins', () => {
    const hero = createStarterHero(55, 10);
    hero.pos = 55;
    const level = { depth: 12, w: 10 };
    noteWallDecoCells(level, [56, 54]);
    addToInventory(hero, 'pickaxe', 1);
    const slot = hero.inventory.findIndex((s) => s.itemId === 'pickaxe');
    const logs: string[] = [];
    const ctx: { log: (m: string) => void; level: { depth: number; w: number } } = {
      log: (m) => logs.push(m),
      level,
    };
    mineDarkGold(ctx as never, hero, slot);
    mineDarkGold(ctx as never, hero, slot);
    const gold = hero.inventory.find((s) => s.itemId === 'darkgold');
    expect(gold!.qty).toBe(2);
    // Third attempt: no veins left.
    const cost = mineDarkGold(ctx as never, hero, slot);
    expect(cost).toBe(0);
    expect(logs[logs.length - 1]).toBe('There is no dark gold vein near you to mine');
  });

  test('mining failure spends no time (vanilla Pickaxe.execute)', () => {
    const { hero, ctx, slot, logs, mineDarkGold } = miningSetup(12, null);
    const cost = mineDarkGold(ctx, hero, slot);
    expect(cost).toBe(0);
    expect(logs[0]).toBe('There is no dark gold vein near you to mine');
    expect(hero.inventory.some((s: { itemId: string }) => s.itemId === 'darkgold')).toBe(false);
  });

  test('mining outside depths 11-15 fails', () => {
    const { hero, ctx, slot, logs, mineDarkGold } = miningSetup(10, 56);
    expect(mineDarkGold(ctx, hero, slot)).toBe(0);
    expect(logs[0]).toBe('There is no dark gold vein near you to mine');
    const deep = miningSetup(16, 56);
    expect(deep.mineDarkGold(deep.ctx, deep.hero, deep.slot)).toBe(0);
  });

  test('starving heroes mine without the hunger change', () => {
    const { hero, ctx, slot, mineDarkGold } = miningSetup(12, 56);
    hero.hungerLevel = 360; // STARVING: no satisfaction
    mineDarkGold(ctx, hero, slot);
    expect(hero.hungerLevel).toBe(360);
  });


  async function equipPickaxe() {
    const { RNG } = await import('../src/core/rng.js');
    const { createStarterHero } = await import('../src/content/hero.js');
    const { getItem } = await import('../src/content/items.js');
    const hero = createStarterHero(55, 10);
    const def = getItem('pickaxe');
    hero.weapon = {
      ...def.weapon!,
      name: 'pickaxe',
      level: 0,
      durability: 70,
      enchantment: null,
      bloodStained: false,
    };
    hero.weaponId = 'pickaxe';
    let killed = false;
    const ctx = {
      rng: new RNG(5),
      level: { depth: 12, w: 10 },
      hero,
      mobs: [],
      log: () => {},
      killMob: () => {
        killed = true;
      },
      removeMob: () => {},
      addMob: () => {},
      syncMobs: () => {},
    } as never;
    return { hero, ctx, killed: () => killed };
  }

  test('pickaxe strike skips ordinary enchantment/durability procs', async () => {
    const { buildMob, strikeHeroVsMob } = await import('../src/content/mobs.js');
    const { hero, ctx } = await equipPickaxe();
    // Even with a (theoretical) enchantment, Pickaxe.proc overrides Weapon.proc.
    hero.weapon!.enchantment = 'fire';
    const bat = buildMob('bat', 2, 56, 10);
    bat.hp = 30; // survives the strike
    strikeHeroVsMob(ctx, hero, bat, 100, () => 10);
    // No fire proc (no burning buff) and no durability consumed.
    expect((bat.buffs as Record<string, unknown>)['burning']).toBeUndefined();
    expect(hero.weapon!.durability).toBe(70);
  });

  test('lethal pickaxe strike on a bat blood-stains it', async () => {
    const { buildMob, strikeHeroVsMob } = await import('../src/content/mobs.js');
    const { hero, ctx, killed } = await equipPickaxe();
    expect(hero.weapon!.bloodStained).toBe(false);
    const bat = buildMob('bat', 2, 56, 10);
    bat.hp = 1; // lethal strike
    strikeHeroVsMob(ctx, hero, bat, 100, () => 10);
    expect(killed()).toBe(true);
    expect(hero.weapon!.bloodStained).toBe(true);
  });

  test('lethal pickaxe strike on a non-bat does not blood-stain', async () => {
    const { buildMob, strikeHeroVsMob } = await import('../src/content/mobs.js');
    const { hero, ctx } = await equipPickaxe();
    const rat = buildMob('rat', 2, 56, 10);
    rat.hp = 1;
    strikeHeroVsMob(ctx, hero, rat, 100, () => 10);
    expect(hero.weapon!.bloodStained).toBe(false);
  });
});
