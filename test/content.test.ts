/**
 * Content tests (Milestone 1): items, mobs, Goo, spawns, interactions,
 * save/revive, and engine wiring — all grounded in the Java sources.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { computeFov } from '../src/core/fov.js';
import { Level } from '../src/dungeon/level.js';
import {
  generateLevel,
  newRunState,
} from '../src/dungeon/generator.js';
import { Game } from '../src/engine/loop.js';
import type {
  ActionContext,
  MobActor,
} from '../src/engine/seams.js';
import { SPRITES } from '../src/assets/sprites.js';
import {
  ITEMS,
  MISSING_SPRITES,
  getItem,
  missingCatalogSprites,
  parseItemId,
} from '../src/content/items.js';
import {
  MOB_DEFS,
  buildMob,
  chebyshevPos,
  ContentMob,
  damageMobDirect,
  killMob,
  mobDefenseProc,
  strikeHeroVsMob,
  thiefSteal,
  tickBuffs,
} from '../src/content/mobs.js';
import {
  ContentHero,
  addToInventory,
  createStarterHero,
} from '../src/content/hero.js';
import {
  dropSlot,
  equipSlot,
  moveHero,
  pickupAt,
  throwDart,
  tickHeroClock,
  useInventorySlot,
} from '../src/content/actions.js';
import {
  buildMobs,
  contentLevelGen,
  pickMobId,
  resolveItemSpawns,
  resolveItemTag,
  resolveMobSpawns,
} from '../src/content/spawns.js';
import {
  GEN_CATEGORY_WEIGHTS,
  GeneratorBag,
  skeletonWeaponDrop,
} from '../src/content/itemgen.js';
import type { MechanicsRng } from '../src/mechanics/rng.js';
import { contentMechanics } from '../src/content/hooks.js';
import { GooMob, GOO_DEF } from '../src/content/goo-boss.js';
import {
  heroAttackSkill,
  heroDamageRoll,
} from '../src/mechanics/hero.js';

// --- helpers ---

function makeLevel(w = 12, h = 12, depth = 1): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  }
  lvl.depth = depth;
  lvl.stairsUp = 5 * w + 5;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
  added: ContentMob[];
  mobs: ContentMob[];
}

function makeCtx(level: Level, seed = 1234): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const added: ContentMob[] = [];
  const mobs: ContentMob[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: mobs as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    addMob: (m: MobActor, _delay?: number) => {
      added.push(m as ContentMob);
      mobs.push(m as ContentMob);
    },
    syncMobs: () => {},
  };
  return { ctx, hero, logs, added, mobs };
}

/** Place a mob on the ctx (and return it). */
function addMob(c: Ctx, mob: ContentMob): ContentMob {
  c.mobs.push(mob);
  return mob;
}

// --- item catalog ---

describe('item catalog', () => {
  test('all seven M1 items are defined with complete fields', () => {
    for (const id of [
      'shortsword',
      'dart',
      'cloth_armor',
      'potion_healing',
      'potion_strength',
      'ration',
      'scroll',
    ]) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def!.name.length).toBeGreaterThan(0);
      expect(def!.desc.length).toBeGreaterThan(0);
      expect(def!.sprite.length).toBeGreaterThan(0);
    }
  });

  test('every sprite key exists in the atlas or is flagged missing', () => {
    const missing = missingCatalogSprites();
    const flagged = new Set(MISSING_SPRITES);
    for (const id of Object.keys(ITEMS)) {
      const sprite = ITEMS[id]!.sprite;
      const inAtlas = (SPRITES as Record<string, unknown>)[sprite] !== undefined;
      expect(
        inAtlas || flagged.has(sprite),
        `${id} sprite ${sprite}`,
      ).toBe(true);
    }
    // The flagged set is exactly what the catalog reports.
    expect(new Set(missing)).toEqual(flagged);
    // No known gaps: armor_cloth, gold, key_iron, key_skeleton were merged
    // into the atlas (items-b sheet, 2026-09-19).
    expect(flagged.size).toBe(0);
  });

  test('core stats match the Java sources', () => {
    expect(ITEMS['shortsword']!.weapon).toMatchObject({ min: 1, max: 12, str: 11 });
    expect(ITEMS['dart']!.weapon).toMatchObject({ min: 1, max: 4, str: 10, missile: true });
    expect(ITEMS['cloth_armor']!.armor).toMatchObject({ str: 9, dr: 2 });
    expect(ITEMS['ration']!.energy).toBe(260);
    expect(getItem('gold').stackable).toBe(true);
  });

  test('parseItemId handles sized ids', () => {
    expect(parseItemId('gold:25')).toEqual({ defId: 'gold', qty: 25 });
    expect(parseItemId('dart:8')).toEqual({ defId: 'dart', qty: 8 });
    expect(parseItemId('scroll')).toEqual({ defId: 'scroll', qty: 1 });
  });
});

// --- mob stats ---

describe('mob stats (Java ground truth)', () => {
  const expected: Record<
    string,
    { hp: number; atk: number; def: number; dmg: [number, number]; dr: number; exp: number; maxLvl: number; speed: number }
  > = {
    // Rat.java / Gnoll.java / Crab.java / Swarm.java / Skeleton.java / Thief.java
    rat: { hp: 8, atk: 8, def: 3, dmg: [1, 5], dr: 1, exp: 1, maxLvl: 5, speed: 1 },
    gnoll: { hp: 12, atk: 11, def: 4, dmg: [2, 5], dr: 2, exp: 2, maxLvl: 8, speed: 1 },
    crab: { hp: 15, atk: 12, def: 5, dmg: [3, 6], dr: 4, exp: 3, maxLvl: 9, speed: 2 },
    swarm: { hp: 80, atk: 12, def: 5, dmg: [1, 4], dr: 0, exp: 1, maxLvl: 10, speed: 1 },
    skeleton: { hp: 25, atk: 12, def: 9, dmg: [3, 8], dr: 5, exp: 5, maxLvl: 10, speed: 1 },
    thief: { hp: 20, atk: 12, def: 12, dmg: [1, 7], dr: 3, exp: 5, maxLvl: 10, speed: 1 },
  };
  for (const [id, e] of Object.entries(expected)) {
    test(`${id} matches Java`, () => {
      const d = MOB_DEFS[id]!;
      expect(d.hp).toBe(e.hp);
      expect(d.atk).toBe(e.atk);
      expect(d.def).toBe(e.def);
      expect([d.dmgMin, d.dmgMax]).toEqual(e.dmg);
      expect(d.dr).toBe(e.dr);
      expect(d.exp).toBe(e.exp);
      expect(d.maxLvl).toBe(e.maxLvl);
      expect(d.speed).toBe(e.speed);
    });
  }

  test('goo matches Goo.java', () => {
    expect(GOO_DEF.hp).toBe(80);
    expect(GOO_DEF.atk).toBe(15);
    expect(GOO_DEF.def).toBe(12);
    expect([GOO_DEF.dmgMin, GOO_DEF.dmgMax]).toEqual([2, 12]);
    expect(GOO_DEF.dr).toBe(2);
    expect(GOO_DEF.exp).toBe(10);
  });

  test('buildMob constructs every roster mob (goo registered via goo-boss)', () => {
    for (const id of ['rat', 'gnoll', 'crab', 'swarm', 'skeleton', 'thief']) {
      const m = buildMob(id, 1, 0, 12);
      expect(m).toBeInstanceOf(ContentMob);
      expect(m.def.id).toBe(id);
      expect(m.hp).toBe(m.ht);
      expect(m.isAlive()).toBe(true);
    }
    expect(buildMob('goo', 2, 0, 12)).toBeInstanceOf(GooMob);
    expect(buildMob('thief', 3, 0, 12).state).toBe('sleeping');
  });

  test('positions are cell indices with x/y derived', () => {
    const m = buildMob('rat', 1, 5 * 12 + 7, 12);
    expect(m.pos).toBe(5 * 12 + 7);
    expect(m.x).toBe(7);
    expect(m.y).toBe(5);
    m.x = 8;
    expect(m.pos).toBe(5 * 12 + 8);
  });
});

// --- spawn tables ---

describe('spawn tables (Bestiary.mobClass)', () => {
  test('depth 1 is all rats', () => {
    const rng = new RNG(1);
    for (let i = 0; i < 200; i++) expect(pickMobId(rng, 1)).toBe('rat');
  });

  test('depth 2 is rats and gnolls', () => {
    const rng = new RNG(2);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickMobId(rng, 2));
    expect(seen).toEqual(new Set(['rat', 'gnoll']));
  });

  test('depth 3 has no skeletons/thieves', () => {
    const rng = new RNG(3);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(pickMobId(rng, 3));
    expect(seen.has('skeleton')).toBe(false);
    expect(seen.has('thief')).toBe(false);
    expect(seen.has('crab')).toBe(true);
    expect(seen.has('rat')).toBe(true);
    expect(seen.has('gnoll')).toBe(true);
  });

  test('depth 4 can spawn skeletons and thieves', () => {
    const rng = new RNG(4);
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) seen.add(pickMobId(rng, 4));
    expect(seen.has('skeleton')).toBe(true);
    expect(seen.has('thief')).toBe(true);
    expect(seen.has('swarm')).toBe(true);
  });

  test('resolveMobSpawns maps kinds; skips M1-unimplemented kinds', () => {
    const rng = new RNG(9);
    const out = resolveMobSpawns(
      rng,
      1,
      [
        { pos: 10, kind: 'mob' },
        { pos: 20, kind: 'boss' },
        { pos: 30, kind: 'ghost' },
        { pos: 40, kind: 'piranha' },
      ],
    );
    expect(out).toEqual([
      { pos: 10, mobId: 'rat' },
      { pos: 20, mobId: 'goo' },
    ]);
  });

  test('buildMobs keeps positions and assigns ids', () => {
    const mobs = buildMobs(
      [
        { pos: 10, mobId: 'rat' },
        { pos: 20, mobId: 'gnoll' },
      ],
      12,
    );
    expect(mobs.map((m) => m.pos)).toEqual([10, 20]);
    expect(mobs[0]!.id).not.toBe(mobs[1]!.id);
  });
});

// --- item spawn resolution ---

describe('item spawn resolution', () => {
  const cases: Array<[string, string]> = [
    ['food', 'ration'],
    ['potion-of-strength', 'potion_strength'],
    ['scroll-of-upgrade', 'scroll_upgrade'],
    ['scroll-of-enchantment', 'scroll'],
    ['dew-vial', 'potion_healing'],
    ['iron-key', 'iron_key'],
    ['golden-key', 'golden_key'],
    ['prize-armor', 'cloth_armor'],
    ['prize-weapon', 'shortsword'],
    ['prize-potion', 'potion_healing'],
    ['prize-scroll', 'scroll'],
    ['prize-food', 'ration'],
    ['prize-wand', 'scroll'],
    ['prize-ring', 'scroll'],
    ['invisibility', 'potion_healing'],
    ['levitation', 'potion_healing'],
    ['liquid-flame', 'potion_healing'],
    ['honeypot', 'potion_healing'],
    ['sungrass-seed', 'ration'],
  ];
  for (const [tag, expected] of cases) {
    test(`tag ${tag} -> ${expected}`, () => {
      expect(resolveItemTag(new RNG(5), 1, tag)).toBe(expected);
    });
  }

  test('prize-bomb becomes a sized dart stack', () => {
    const id = resolveItemTag(new RNG(5), 1, 'prize-bomb');
    expect(id.startsWith('dart:')).toBe(true);
    const { defId, qty } = parseItemId(id);
    expect(defId).toBe('dart');
    expect(qty).toBeGreaterThanOrEqual(5);
    expect(qty).toBeLessThan(15); // Dart.random(): Random.Int(5, 15), Dart.java:59
  });

  test('random tag resolves into the catalog', () => {
    const id = resolveItemTag(new RNG(6), 2, 'random');
    const { defId } = parseItemId(id);
    expect(ITEMS[defId]).toBeDefined();
  });

  test('unknown tag throws', () => {
    expect(() => resolveItemTag(new RNG(6), 1, 'frobnicate')).toThrow();
  });

  test('resolveItemSpawns passes gold through with its sprite', () => {
    const [it] = resolveItemSpawns(new RNG(7), 1, [
      { pos: 42, heap: 'HEAP', tag: 'gold:7' },
    ]);
    expect(it!.itemId).toBe('gold:7');
    expect(it!.pos).toBe(42);
    expect(it!.sprite).toBe('gold');
  });

  test('undefined tag defaults to random', () => {
    const [it] = resolveItemSpawns(new RNG(7), 1, [
      { pos: 42, heap: 'HEAP', tag: undefined },
    ]);
    expect(ITEMS[parseItemId(it!.itemId).defId]).toBeDefined();
  });

  test('prize-bomb dart stack uses the exact Dart quantity range [5, 15)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const id = resolveItemTag(new RNG(seed), 1, 'prize-bomb');
      const { qty } = parseItemId(id);
      expect(qty).toBeGreaterThanOrEqual(5);
      expect(qty).toBeLessThan(15); // Dart.random(): Random.Int(5, 15), Dart.java:59
    }
  });
});

// --- vanilla item generator (items/Generator.java) ---

/** Scripted MechanicsRng for deterministic Generator tests. */
class StubRng implements MechanicsRng {
  private floats: number[];
  private ints: number[];
  constructor(floats: number[] = [], ints: number[] = []) {
    this.floats = [...floats];
    this.ints = [...ints];
  }
  float(min: number, max: number): number {
    const f = this.floats.length ? this.floats.shift()! : 0;
    return min + f * (max - min);
  }
  int(min: number, max: number): number {
    const v = this.ints.length ? this.ints.shift()! : min;
    return Math.min(Math.max(v, min), max - 1);
  }
  intRange(min: number, max: number): number {
    const v = this.ints.length ? this.ints.shift()! : min;
    return Math.min(Math.max(v, min), max);
  }
  normalIntRange(min: number, _max: number): number {
    return min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[0]!;
  }
}

describe('vanilla item generator (Generator.java)', () => {
  test('category base weights match Generator.java:38-48', () => {
    expect(GEN_CATEGORY_WEIGHTS).toEqual([
      { cat: 'weapon', weight: 15 },
      { cat: 'armor', weight: 10 },
      { cat: 'potion', weight: 50 },
      { cat: 'scroll', weight: 40 },
      { cat: 'wand', weight: 4 },
      { cat: 'ring', weight: 2 },
      { cat: 'seed', weight: 5 },
      { cat: 'food', weight: 0 },
      { cat: 'gold', weight: 50 },
      { cat: 'misc', weight: 5 },
    ]);
  });

  test('random() picks by current weights and halves the drawn category', () => {
    const bag = new GeneratorBag();
    // Category roll 0 of 181 -> WEAPON (first entry); class roll 0 -> Dagger.
    const id = bag.random(new StubRng([0, 0]), 1);
    expect(id).toBe('shortsword');
    expect(bag.weightOf('weapon')).toBe(7.5); // 15 / 2 (Generator.java:113)
    expect(bag.weightOf('gold')).toBe(50); // untouched
  });

  test('gold draw uses the exact Gold.random() bounds [20+10d, 40+20d)', () => {
    const bag = new GeneratorBag();
    // randomFrom('gold'): halves GOLD, class roll 0 -> Gold, qty int -> min.
    expect(bag.randomFrom(new StubRng([0], []), 'gold', 2)).toBe('gold:40');
    expect(bag.weightOf('gold')).toBe(25);
  });

  test('missile classes map to darts with their exact quantity ranges', () => {
    const bag = new GeneratorBag();
    // WEAPON class probs: 10 melee (1 each), then Javelin [10,11),
    // IncendiaryDart [11,12), CurareDart [12,13), Shuriken [13,14),
    // Tamahawk [14,15) of total 15.
    expect(bag.randomFrom(new StubRng([11.5 / 15], [4]), 'weapon', 1)).toBe(
      'dart:4', // IncendiaryDart Random.Int(3, 6)
    );
    expect(bag.randomFrom(new StubRng([12.5 / 15], [2]), 'weapon', 1)).toBe(
      'dart:2', // CurareDart Random.Int(2, 5)
    );
    expect(bag.randomFrom(new StubRng([14.5 / 15], [11]), 'weapon', 1)).toBe(
      'dart:11', // Tamahawk Random.Int(5, 12)
    );
  });

  test('reset() restores base weights (Generator.reset)', () => {
    const bag = new GeneratorBag();
    bag.random(new StubRng([0, 0]), 1);
    expect(bag.weightOf('weapon')).toBe(7.5);
    bag.reset();
    expect(bag.weightOf('weapon')).toBe(15);
    expect(bag.weightOf('potion')).toBe(50);
  });

  test('skeletonWeaponDrop draws 3 weapons, keeps the first (M1: all lvl 0)', () => {
    const bag = new GeneratorBag();
    // Class rolls: Dagger -> shortsword, then Javelin -> dart, then Sword.
    const id = skeletonWeaponDrop(new StubRng([0, 10.5 / 15, 5.5 / 15]), 3, bag);
    expect(id).toBe('shortsword');
    expect(bag.weightOf('weapon')).toBe(15 / 8); // halved once per draw
  });

  test('scroll/wand/ring/seeds collapse onto M1 catalog items', () => {
    const bag = new GeneratorBag();
    expect(bag.randomFrom(new StubRng([0], []), 'scroll', 1)).toBe('scroll');
    expect(bag.randomFrom(new StubRng([0], []), 'wand', 1)).toBe('scroll');
    expect(bag.randomFrom(new StubRng([0], []), 'ring', 1)).toBe('scroll');
    expect(bag.randomFrom(new StubRng([0], []), 'seed', 1)).toBe('ration');
    expect(bag.randomFrom(new StubRng([0], []), 'potion', 1)).toBe('potion_healing');
    expect(bag.randomFrom(new StubRng([0], []), 'armor', 1)).toBe('cloth_armor');
    expect(bag.randomFrom(new StubRng([0], []), 'misc', 1)).toBe('dart:5'); // Bomb [0,2)
    expect(bag.randomFrom(new StubRng([2.5 / 3], []), 'misc', 1)).toBe('potion_healing'); // Honeypot [2,3)
  });
});

// --- mob loot tables (depths 1-5) ---

describe('M1 mob loot', () => {
  test('crab drops mystery meat (ration) ~16.7% (Crab.java:39-41)', () => {
    const level = makeLevel(12, 12, 3);
    const c = makeCtx(level, 777);
    let drops = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      killMob(c.ctx, buildMob('crab', 1000 + i, 6 * 12 + 6, 12), {});
      if (level.items.some((it) => it.itemId === 'ration')) drops++;
      level.items.length = 0;
    }
    expect(drops).toBeGreaterThan(200);
    expect(drops).toBeLessThan(500);
  });

  test('skeleton drops a weapon ~20% via best-of-3 Generator draws (Skeleton.java:78-88)', () => {
    const level = makeLevel(12, 12, 4);
    const c = makeCtx(level, 4242);
    c.hero.pos = 0; // keep the hero clear of the death burst
    const drops: string[] = [];
    const N = 2000;
    for (let i = 0; i < N; i++) {
      killMob(c.ctx, buildMob('skeleton', 2000 + i, 6 * 12 + 6, 12), {});
      for (const it of level.items) drops.push(it.itemId);
      level.items.length = 0;
    }
    expect(drops.length).toBeGreaterThan(250);
    expect(drops.length).toBeLessThan(550);
    for (const id of drops) {
      const { defId, qty } = parseItemId(id);
      expect(['shortsword', 'dart']).toContain(defId);
      if (defId === 'dart') {
        // Missile classes: CurareDart Int(2,5) .. Tamahawk Int(5,12)
        expect(qty).toBeGreaterThanOrEqual(2);
        expect(qty).toBeLessThan(15);
      }
    }
  });
});

// --- swarm split ---

describe('swarm split (Swarm.defenseProc)', () => {
  test('splits when HP >= damage + 2, halving HP (Swarm.java:76-107)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 11);
    const swarm = addMob(c, buildMob('swarm', 1, 6 * 12 + 6, 12));
    mobDefenseProc(c.ctx, swarm, 10);
    expect(c.added.length).toBe(1);
    const clone = c.added[0]!;
    expect(clone.hp).toBe(35); // (80 - 10) / 2
    expect(swarm.hp).toBe(45); // 80 - 35, before the 10 damage lands
    expect(clone.state).toBe('hunting');
    expect(clone.generation).toBe(1);
    expect(chebyshevPos(clone.pos, swarm.pos, 12)).toBe(1);
    // Vanilla sets no enemySeen and logs nothing at split (Swarm.java:76-107;
    // enemySeen is assigned by the clone's first Hunting.act, Mob.java:509).
    expect(clone.enemySeen).toBe(false);
    expect(c.logs.some((l) => l.includes('splits'))).toBe(false);
  });

  test('no split when HP < damage + 2', () => {
    const level = makeLevel();
    const c = makeCtx(level, 11);
    const swarm = addMob(c, buildMob('swarm', 1, 6 * 12 + 6, 12));
    swarm.hp = 5;
    mobDefenseProc(c.ctx, swarm, 10);
    expect(c.added.length).toBe(0);
  });

  test('no split when surrounded', () => {
    const level = makeLevel(5, 5);
    const c = makeCtx(level, 11);
    // Fill every neighbor with walls except the mob's own cell.
    for (let y = 1; y <= 3; y++)
      for (let x = 1; x <= 3; x++) level.set(x, y, Terrain.WALL);
    const swarm = addMob(c, buildMob('swarm', 1, 2 * 5 + 2, 5));
    level.set(2, 2, Terrain.FLOOR);
    mobDefenseProc(c.ctx, swarm, 10);
    expect(c.added.length).toBe(0);
  });

  test('burning propagates to the clone; poison becomes duration 2', () => {
    const level = makeLevel();
    const c = makeCtx(level, 11);
    const swarm = addMob(c, buildMob('swarm', 1, 6 * 12 + 6, 12));
    swarm.buffs.burning = { kind: 'burning', left: 8 };
    swarm.buffs.poison = { kind: 'poison', left: 9 };
    mobDefenseProc(c.ctx, swarm, 10);
    const clone = c.added[0]!;
    expect(clone.buffs.burning).toBeDefined();
    expect(clone.buffs.poison).toEqual({ kind: 'poison', left: 2 });
  });
});

// --- thief ---

describe('thief (Thief.java)', () => {
  test('steals a random inventory stack and flees (Thief.attackProc)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 21);
    const thief = addMob(c, buildMob('thief', 1, 6 * 12 + 6, 12));
    expect(c.hero.inventory.length).toBe(2); // ration + darts
    expect(thiefSteal(c.ctx, thief, c.hero)).toBe(true);
    expect(c.hero.inventory.length).toBe(1);
    expect(thief.stolen).not.toBeNull();
    expect(thief.state).toBe('fleeing');
    expect(c.logs.some((l) => l.includes('stole'))).toBe(true);
    // Already carrying: no second steal.
    expect(thiefSteal(c.ctx, thief, c.hero)).toBe(false);
  });

  test('cornered thief returns to hunting (Thief.Fleeing.nowhereToRun)', () => {
    const level = makeLevel(5, 5);
    const c = makeCtx(level, 21);
    for (let y = 1; y <= 3; y++)
      for (let x = 1; x <= 3; x++) level.set(x, y, Terrain.WALL);
    level.set(2, 2, Terrain.FLOOR);
    const thief = addMob(c, buildMob('thief', 1, 2 * 5 + 2, 5));
    thief.state = 'fleeing';
    thief.target = 2 * 5 + 2;
    const cost = thief.takeTurn(c.ctx);
    expect<string>(thief.state).toBe('hunting');
    expect(cost).toBeGreaterThan(0);
  });

  test('drops the stolen item on death (Thief.die)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 21);
    const thief = addMob(c, buildMob('thief', 1, 6 * 12 + 6, 12));
    thief.stolen = { itemId: 'ration', qty: 1 };
    damageMobDirect(c.ctx, thief, 999);
    expect(c.mobs.includes(thief)).toBe(false);
    expect(level.items.some((it) => it.itemId === 'ration')).toBe(true);
  });

  test('attack costs half a turn (attackDelay 0.5)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 21);
    const thief = addMob(c, buildMob('thief', 1, 6 * 12 + 6, 12));
    // Hero adjacent -> hunting attack path.
    c.hero.pos = 6 * 12 + 7;
    thief.state = 'hunting';
    thief.target = c.hero.pos;
    const cost = thief.takeTurn(c.ctx);
    expect(cost).toBe(0.5);
  });
});

// --- skeleton burst ---

describe('skeleton death burst (Skeleton.die)', () => {
  test('hits adjacent chars, spares distant ones', () => {
    const level = makeLevel();
    const c = makeCtx(level, 31);
    const skel = addMob(c, buildMob('skeleton', 1, 6 * 12 + 6, 12));
    c.hero.pos = 6 * 12 + 7; // adjacent
    const far = addMob(c, buildMob('rat', 2, 6 * 12 + 11, 12));
    const heroHp = c.hero.hp;
    damageMobDirect(c.ctx, skel, 999);
    expect(c.mobs.includes(skel)).toBe(false);
    expect(c.hero.hp).toBeLessThan(heroHp);
    expect(far.hp).toBe(far.ht); // untouched
  });
});

// --- mob AI ---

describe('mob AI (Mob.java)', () => {
  test('sleeping mob far away keeps sleeping', () => {
    const level = makeLevel(20, 20);
    const c = makeCtx(level, 41);
    const rat = addMob(c, buildMob('rat', 1, 15 * 20 + 15, 20));
    const cost = rat.takeTurn(c.ctx);
    expect(rat.state).toBe('sleeping');
    expect(cost).toBe(1); // spend(TICK) at speed 1
  });

  test('wandering mob next to the hero notices it (cost 0 transition)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 41);
    const rat = addMob(c, buildMob('rat', 1, 6 * 12 + 6, 12));
    rat.state = 'wandering';
    c.hero.pos = 6 * 12 + 7; // distance 1 -> Random.Int(0) == 0 always
    const cost = rat.takeTurn(c.ctx);
    expect<string>(rat.state).toBe('hunting');
    expect(cost).toBe(0);
  });

  test('hunting mob attacks the adjacent hero', () => {
    const level = makeLevel();
    const c = makeCtx(level, 41);
    const rat = addMob(c, buildMob('rat', 1, 6 * 12 + 6, 12));
    rat.state = 'hunting';
    rat.target = c.hero.pos;
    c.hero.pos = 6 * 12 + 7;
    const cost = rat.takeTurn(c.ctx);
    expect(cost).toBe(1); // attackDelay 1 * speed 1
    expect(
      c.logs.some((l) => l.includes('hits you') || l.includes('misses you')),
    ).toBe(true);
  });

  test('hunting mob paths toward the hero', () => {
    const level = makeLevel(20, 20);
    const c = makeCtx(level, 41);
    const gnoll = addMob(c, buildMob('gnoll', 1, 10 * 20 + 5, 20));
    gnoll.state = 'hunting';
    c.hero.pos = 10 * 20 + 15;
    gnoll.target = c.hero.pos;
    // Force visibility: put the hero in FOV (open room, distance 10 > 8
    // means not seen; move hero adjacent instead and block the attack by
    // placing a wall between? simpler: hero in FOV at distance 5).
    c.hero.pos = 10 * 20 + 10;
    gnoll.target = c.hero.pos;
    const before = chebyshevPos(gnoll.pos, c.hero.pos, 20);
    gnoll.takeTurn(c.ctx);
    const after = chebyshevPos(gnoll.pos, c.hero.pos, 20);
    expect(after).toBeLessThan(before);
  });

  test('paralysed mob spends its turn', () => {
    const level = makeLevel();
    const c = makeCtx(level, 41);
    const rat = addMob(c, buildMob('rat', 1, 6 * 12 + 6, 12));
    rat.state = 'hunting';
    rat.paralysed = true;
    rat.buffs.paralysis = { kind: 'paralysis', left: 2 };
    const pos = rat.pos;
    // Engine owns the buff-tick call site: tick via mechanics hook, then takeTurn.
    contentMechanics.tickActorBuffs(rat, c.ctx);
    const cost = rat.takeTurn(c.ctx);
    expect(rat.pos).toBe(pos);
    expect(cost).toBe(1);
    expect(rat.buffs.paralysis!.left).toBe(1); // ticked
  });

  test('zero defense skill when the hero was never seen', () => {
    const rat = buildMob('rat', 1, 0, 12);
    expect(rat.mobDefenseSkill()).toBe(0);
    rat.enemySeen = true;
    expect(rat.mobDefenseSkill()).toBe(3);
  });
});

// --- hero vs mob combat ---

describe('hero vs mob combat (Char.attack)', () => {
  test('a strike can miss or hit; a kill grants EXP and removes the mob', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    const rat = addMob(c, buildMob('rat', 1, 6 * 12 + 6, 12));
    rat.hp = 1;
    c.hero.pos = 6 * 12 + 7;
    const expBefore = c.hero.exp;
    strikeHeroVsMob(
      c.ctx,
      c.hero,
      rat,
      heroAttackSkill(c.hero, { ranged: false, adjacent: false }),
      (r) => heroDamageRoll(r, c.hero, { ranged: false }),
    );
    // Either it missed (still alive) or it died with EXP granted.
    if (!c.mobs.includes(rat)) {
      expect(c.hero.exp).toBeGreaterThan(expBefore);
      expect(c.logs.some((l) => l.includes('EXP'))).toBe(true);
    } else {
      expect(c.logs.some((l) => l.includes('miss'))).toBe(true);
    }
  });

  test('swarm split fires through the hero attack (defenseProc before damage)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    const swarm = addMob(c, buildMob('swarm', 1, 6 * 12 + 6, 12));
    c.hero.pos = 6 * 12 + 7;
    // Force a hit with fixed damage: accuracy huge, damage roll fixed.
    strikeHeroVsMob(c.ctx, c.hero, swarm, 1000, () => 10);
    expect(c.added.length).toBe(1);
    // Parent lost the clone's HP before the 10 damage landed.
    expect(swarm.hp).toBe(80 - 35 - 10);
  });

  test('buffs tick on the mob turn (burning damages)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    const rat = addMob(c, buildMob('rat', 1, 15 * 12 + 15, 12));
    rat.buffs.burning = { kind: 'burning', left: 8 };
    const hp = rat.hp;
    tickBuffs(c.ctx.rng, level, rat, c.ctx.log);
    expect(rat.hp).toBeLessThan(hp);
  });
});

// --- goo ---

describe('goo (Goo.java)', () => {
  test('pumped adjacent attack clears the pump', () => {
    const level = makeLevel();
    const c = makeCtx(level, 61);
    const goo = addMob(c, buildMob('goo', 1, 6 * 12 + 6, 12)) as GooMob;
    goo.pumpedUp = true;
    goo.state = 'hunting';
    c.hero.pos = 6 * 12 + 7;
    goo.takeTurn(c.ctx);
    expect(goo.pumpedUp).toBe(false);
    expect(
      c.logs.some((l) => l.includes('hits you') || l.includes('misses you')),
    ).toBe(true);
  });

  test('ooze warning uses the exact vanilla string (Hero.java:1091)', () => {
    const seen: string[] = [];
    for (let seed = 0; seed < 80; seed++) {
      const level = makeLevel();
      const c = makeCtx(level, 1000 + seed);
      const goo = addMob(c, buildMob('goo', 1, 6 * 12 + 6, 12)) as GooMob;
      goo.pumpedUp = true;
      goo.state = 'hunting';
      c.hero.pos = 6 * 12 + 7;
      goo.takeTurn(c.ctx);
      for (const l of c.logs) if (l.includes('ooze')) seen.push(l);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const l of seen) {
      expect(l).toBe('Caustic ooze eats your flesh. Wash away it!');
    }
  });

  test('moving clears the pump (Goo.getCloser)', () => {
    const level = makeLevel(20, 20);
    const c = makeCtx(level, 61);
    const goo = addMob(c, buildMob('goo', 1, 10 * 20 + 5, 20)) as GooMob;
    goo.pumpedUp = true;
    goo.state = 'hunting';
    c.hero.pos = 10 * 20 + 12; // in FOV, not adjacent
    goo.target = c.hero.pos;
    goo.takeTurn(c.ctx);
    expect(goo.pumpedUp).toBe(false);
  });

  test('death unseals the arena and drops the skeleton key', () => {
    const level = makeLevel();
    const c = makeCtx(level, 61);
    level.sealed = true;
    const goo = addMob(c, buildMob('goo', 1, 6 * 12 + 6, 12));
    damageMobDirect(c.ctx, goo, 999);
    expect(level.sealed).toBe(false);
    expect(level.items.some((it) => it.itemId === 'skeleton_key')).toBe(true);
    expect(c.logs.some((l) => l.includes('glurp'))).toBe(true);
    expect(c.mobs.includes(goo)).toBe(false);
  });

  test('regenerates in water', () => {
    const level = makeLevel();
    const c = makeCtx(level, 61);
    const pos = 6 * 12 + 6;
    level.set(6, 6, Terrain.WATER);
    const goo = addMob(c, buildMob('goo', 1, pos, 12)) as GooMob;
    goo.hp = 70;
    goo.state = 'passive'; // no AI interference
    goo.takeTurn(c.ctx);
    expect(goo.hp).toBe(71);
  });
});

// --- interactions ---

describe('interactions', () => {
  test('pickup takes one heap; gold goes to the counter', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    level.items.push({ pos: c.hero.pos, itemId: 'gold:25', sprite: 'gold' });
    level.items.push({ pos: c.hero.pos, itemId: 'ration', sprite: 'ration' });
    expect(pickupAt(c.ctx, c.hero)).toBe(1);
    expect(c.hero.gold).toBe(25);
    expect(level.items.length).toBe(1); // one heap per action
    expect(pickupAt(c.ctx, c.hero)).toBe(1);
    // Ration is stackable: the stack merged to qty 2.
    expect(
      c.hero.inventory.find((s) => s.itemId === 'ration')!.qty,
    ).toBe(2);
  });

  test('drinking a healing potion restores full HP and cures poison', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    c.hero.hp = 5;
    c.hero.buffs.poison = { kind: 'poison', left: 5 };
    addToInventory(c.hero, 'potion_healing', 1);
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'potion_healing');
    useInventorySlot(c.ctx, c.hero, slot);
    expect(c.hero.hp).toBe(c.hero.ht);
    expect(c.hero.buffs.poison).toBeUndefined();
  });

  test('strength potion raises STR', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    addToInventory(c.hero, 'potion_strength', 1);
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'potion_strength');
    useInventorySlot(c.ctx, c.hero, slot);
    expect(c.hero.str).toBe(12);
  });

  test('eating satisfies hunger and heals 5 (warrior)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    c.hero.hungerLevel = 300;
    c.hero.hp = 10;
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'ration');
    expect(useInventorySlot(c.ctx, c.hero, slot)).toBe(3);
    expect(c.hero.hungerLevel).toBe(40);
    expect(c.hero.hp).toBe(15);
  });

  test('equip swaps with the old weapon; slot -1 unwields', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    addToInventory(c.hero, 'shortsword', 1);
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'shortsword');
    equipSlot(c.ctx, c.hero, slot);
    expect(c.hero.weaponId).toBe('shortsword');
    // The old shortsword went back to the inventory.
    expect(c.hero.inventory.filter((s) => s.itemId === 'shortsword').length).toBe(1);
    equipSlot(c.ctx, c.hero, -1);
    expect(c.hero.weaponId).toBeNull();
    expect(c.hero.weapon).toBeNull();
  });

  test('drop puts the stack on the floor', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'ration');
    dropSlot(c.ctx, c.hero, slot);
    expect(level.items.some((it) => it.pos === c.hero.pos && it.itemId === 'ration')).toBe(true);
  });

  test('locked door: without a key it stays shut; with a key it opens', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.DOOR_LOCKED);
    moveHero(c.ctx, c.hero, 1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.DOOR_LOCKED);
    expect(c.logs.some((l) => l.includes('locked'))).toBe(true);
    addToInventory(c.hero, 'iron_key', 1);
    moveHero(c.ctx, c.hero, 1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.DOOR);
    expect(c.hero.pos).toBe(hy * level.w + hx + 1);
  });

  test('throwing a dart consumes one and can hit (Hero.shoot)', () => {
    const level = makeLevel(20, 12);
    const c = makeCtx(level, 71);
    const mob = addMob(c, buildMob('rat', 1, 5 * 20 + 10, 20));
    c.hero.pos = 5 * 20 + 5;
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'dart');
    const before = c.hero.inventory[slot]!.qty;
    throwDart(c.ctx, c.hero, slot, mob.pos);
    expect(c.hero.inventory[slot]!.qty).toBe(before - 1);
    expect(mob.hp < mob.ht || c.logs.some((l) => l.includes('miss'))).toBe(true);
  });

  test('a missed dart lands on the floor', () => {
    const level = makeLevel(20, 12);
    const c = makeCtx(level, 71);
    c.hero.pos = 5 * 20 + 5;
    // Throw at a far wall-adjacent cell with no mob in the way.
    const slot = c.hero.inventory.findIndex((s) => s.itemId === 'dart');
    throwDart(c.ctx, c.hero, slot, 5 * 20 + 15);
    expect(level.items.some((it) => it.itemId === 'dart')).toBe(true);
  });

  test('hunger clock ticks hunger and regen', () => {
    const level = makeLevel();
    const c = makeCtx(level, 71);
    c.hero.hungerLevel = 259;
    c.hero.hungerClock = 9;
    c.hero.hp = 10;
    tickHeroClock(c.ctx.rng, c.ctx, c.hero, 1);
    expect(c.hero.hungerLevel).toBe(269);
    expect(c.logs).toContain('You are hungry.');
    expect(c.hero.hp).toBe(11); // regen +1
  });
});

// --- engine wiring ---

describe('engine wiring', () => {
  test('contentLevelGen + spawnMobs produce a depth-1 rat level', () => {
    const rng = new RNG(100);
    const level = contentLevelGen.generate(rng, 1);
    expect(level.items.length).toBeGreaterThan(0);
    const mobs = contentMechanics.spawnMobs(rng, level) as ContentMob[];
    expect(mobs.length).toBeGreaterThan(0);
    expect(mobs.every((m) => m.def.id === 'rat')).toBe(true);
    const hero = contentMechanics.spawnHero(rng, level) as ContentHero;
    expect(hero.pos).toBe(level.stairsUp);
    expect(hero.weaponId).toBe('shortsword');
    expect(hero.armorId).toBe('cloth_armor');
  });

  test('spawn positions stay out of the entrance FOV (fair distance)', () => {
    const rng = new RNG(7);
    const result = generateLevel(rng, 1, newRunState());
    const level = result.level;
    const resolved = resolveMobSpawns(rng, 1, result.mobs);
    expect(resolved.length).toBeGreaterThan(0);
    const fov = new Uint8Array(level.w * level.h);
    computeFov(
      level,
      (x, y) => level.isOpaque(x, y),
      level.stairsUp % level.w,
      Math.floor(level.stairsUp / level.w),
      8,
      fov,
    );
    for (const m of resolved) expect(fov[m.pos]).toBe(0);
  });

  test('a live Game runs turns without crashing', () => {
    const game = new Game(20260919, {
      gen: contentLevelGen,
      mechanics: contentMechanics,
    });
    expect(game.hero.isAlive()).toBe(true);
    for (let i = 0; i < 30; i++) {
      game.queueIntent({ kind: 'wait' });
      const r = game.pump();
      if (r === 'over') break;
    }
    expect(game.gameOver).toBe(false);
  });

  test('loadGame-style boot: spawnMobs with no stashed GenResult returns []', () => {
    // loadGame restores the level directly (no contentLevelGen), then
    // overwrites game.mobs from reviveMob — so [] is the correct answer.
    const level = makeLevel();
    expect(contentMechanics.spawnMobs(new RNG(1), level)).toEqual([]);
  });

  test('hero intent attack routes through the hooks', () => {
    const game = new Game(555, {
      gen: contentLevelGen,
      mechanics: contentMechanics,
    });
    const hero = game.hero as ContentHero;
    // Teleport a rat next to the hero for a deterministic attack.
    const rat = buildMob('rat', 999, hero.pos + 1, game.level.w);
    (game as unknown as { mobs: MobActor[] }).mobs.push(rat);
    game.queueIntent({ kind: 'attack', targetId: 999 });
    game.pump();
    expect(game.log.some((l) => l.includes('rat'))).toBe(true);
  });
});

// --- save / revive ---

describe('save / revive', () => {
  test('hero round-trips through the opaque save blob', () => {
    const level = makeLevel();
    const c = makeCtx(level, 81);
    c.hero.lvl = 3;
    c.hero.exp = 25;
    c.hero.gold = 99;
    c.hero.hungerLevel = 120;
    c.hero.hp = 14;
    addToInventory(c.hero, 'potion_healing', 2);
    const save = contentMechanics.saveHero(c.hero);
    const revived = contentMechanics.reviveHero(new RNG(1), save) as ContentHero;
    expect(revived.pos).toBe(c.hero.pos);
    expect(revived.lvl).toBe(3);
    expect(revived.exp).toBe(25);
    expect(revived.gold).toBe(99);
    expect(revived.hungerLevel).toBe(120);
    expect(revived.hp).toBe(14);
    expect(revived.weaponId).toBe('shortsword');
    expect(revived.armorId).toBe('cloth_armor');
    expect(revived.inventory).toEqual(c.hero.inventory);
    expect(revived.isAlive()).toBe(true);
  });

  test('mob round-trips (swarm generation, thief loot, goo pump)', () => {
    const swarm = buildMob('swarm', 5, 42, 12);
    swarm.generation = 2;
    swarm.state = 'hunting';
    const thief = buildMob('thief', 6, 43, 12);
    thief.stolen = { itemId: 'dart', qty: 3 };
    const goo = buildMob('goo', 7, 44, 12) as GooMob;
    goo.pumpedUp = true;
    for (const m of [swarm, thief, goo]) {
      const save = contentMechanics.saveMob(m);
      const r = contentMechanics.reviveMob(new RNG(1), save) as ContentMob;
      expect(r.def.id).toBe(m.def.id);
      expect(r.pos).toBe(m.pos);
      expect(r.hp).toBe(m.hp);
      expect(r.state).toBe(m.state);
    }
    const rSwarm = contentMechanics.reviveMob(
      new RNG(1),
      contentMechanics.saveMob(swarm),
    ) as ContentMob;
    expect(rSwarm.generation).toBe(2);
    const rThief = contentMechanics.reviveMob(
      new RNG(1),
      contentMechanics.saveMob(thief),
    ) as ContentMob;
    expect(rThief.stolen).toEqual({ itemId: 'dart', qty: 3 });
    const rGoo = contentMechanics.reviveMob(
      new RNG(1),
      contentMechanics.saveMob(goo),
    ) as GooMob;
    expect(rGoo.pumpedUp).toBe(true);
    expect(rGoo).toBeInstanceOf(GooMob);
  });
});

// --- buff messages + burning side effects (Stage 0) ---

describe('burning side effects (Burning.java:76-98)', () => {
  test('scroll in the pack burns up with "%s burns up!"', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.inventory.length = 0; // isolate: only the scroll is in the pack
    addToInventory(c.hero, 'scroll', 1);
    c.hero.buffs.burning = { kind: 'burning', left: 8 };
    const hp = c.hero.hp;
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.hero.hp).toBeLessThan(hp);
    expect(c.hero.inventory.find((s) => s.itemId === 'scroll')).toBeUndefined();
    expect(c.logs).toContain('scroll burns up!');
  });

  test('non-scroll items are untouched by burning', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.inventory.length = 0; // isolate: only the potion is in the pack
    addToInventory(c.hero, 'potion_healing', 1);
    c.hero.buffs.burning = { kind: 'burning', left: 8 };
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.hero.inventory.find((s) => s.itemId === 'potion_healing')?.qty).toBe(1);
    expect(c.logs.some((l) => l.includes('burns up!'))).toBe(false);
  });

  test('item loss happens even on the killing tick, before the death line', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.inventory.length = 0; // isolate: only the scroll is in the pack
    addToInventory(c.hero, 'scroll', 1);
    c.hero.hp = 1;
    c.hero.buffs.burning = { kind: 'burning', left: 8 };
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.hero.isAlive()).toBe(false);
    expect(c.hero.inventory.find((s) => s.itemId === 'scroll')).toBeUndefined();
    const burnIdx = c.logs.indexOf('scroll burns up!');
    const deathIdx = c.logs.indexOf('You burned to death...');
    expect(burnIdx).toBeGreaterThanOrEqual(0);
    expect(deathIdx).toBeGreaterThan(burnIdx);
  });

  test('mobs get no hero-facing messages when buffs kill them', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    const rat = addMob(c, buildMob('rat', 1, 15 * 12 + 15, 12));
    rat.hp = 1;
    rat.buffs.burning = { kind: 'burning', left: 8 };
    tickBuffs(c.ctx.rng, level, rat, c.ctx.log);
    expect(rat.isAlive()).toBe(false);
    expect(c.logs.some((l) => /you burned|burns up/i.test(l))).toBe(false);
  });
});

describe('buff death messages', () => {
  test('burning kill logs "You burned to death..." (Burning.java:152)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hp = 1;
    c.hero.buffs.burning = { kind: 'burning', left: 8 };
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.logs).toContain('You burned to death...');
  });

  test('poison kill logs "You died from poison..." (Poison.java:94)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hp = 1;
    c.hero.buffs.poison = { kind: 'poison', left: 2 }; // damage = (2/3|0)+1 = 1
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.logs).toContain('You died from poison...');
  });

  test('ooze kill logs "Caustic ooze killed you..." (Ooze.java:50)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hp = 1;
    c.hero.buffs.ooze = { kind: 'ooze', left: 8 };
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.logs).toContain('Caustic ooze killed you...');
  });

  test('surviving a buff tick logs no death line', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.buffs.poison = { kind: 'poison', left: 2 };
    tickBuffs(c.ctx.rng, level, c.hero, c.ctx.log);
    expect(c.hero.isAlive()).toBe(true);
    expect(c.logs.some((l) => /to death|killed you/i.test(l))).toBe(false);
  });
});

describe('hunger messages (Hunger.java)', () => {
  test('threshold crossings log the exact strings', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hungerLevel = 255; // one STEP (10) from HUNGRY=260
    tickHeroClock(c.ctx.rng, c.ctx, c.hero, 10);
    expect(c.logs).toContain('You are hungry.');
    c.hero.hungerLevel = 355; // one STEP from STARVING=360
    tickHeroClock(c.ctx.rng, c.ctx, c.hero, 10);
    expect(c.logs).toContain('You are starving!');
  });

  test('each starvation damage proc re-logs "You are starving!" (Hunger.java:68)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hungerLevel = 360;
    const script = {
      float: (min: number, max: number) => min, // 0.0 < 0.3: proc fires
      int: (min: number, _max: number) => min,
      intRange: (min: number, _max: number) => min,
      normalIntRange: (min: number, _max: number) => min,
      pick: <T>(arr: readonly T[]): T => arr[0]!,
    };
    tickHeroClock(script, c.ctx, c.hero, 10);
    expect(c.hero.hp).toBe(19);
    expect(c.logs.filter((l) => l === 'You are starving!').length).toBe(1);
  });

  test('starvation death logs "You starved to death..." (Hunger.java:156)', () => {
    const level = makeLevel();
    const c = makeCtx(level, 51);
    c.hero.hungerLevel = 360;
    c.hero.hp = 1;
    const script = {
      float: (min: number, max: number) => min,
      int: (min: number, _max: number) => min,
      intRange: (min: number, _max: number) => min,
      normalIntRange: (min: number, _max: number) => min,
      pick: <T>(arr: readonly T[]): T => arr[0]!,
    };
    tickHeroClock(script, c.ctx, c.hero, 10);
    expect(c.hero.isAlive()).toBe(false);
    expect(c.logs).toContain('You starved to death...');
  });
});
