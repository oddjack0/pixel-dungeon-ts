/**
 * Scroll of Upgrade tests: catalog, dungeon generation, upgrade mechanics,
 * and reading the scroll — faithful to ScrollOfUpgrade.java / Item.java /
 * Dungeon.java (souNeeded quota), per the M1+ surgical addition.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import {
  generateLevel,
  newRunState,
} from '../src/dungeon/generator.js';
import type {
  ActionContext,
  MobActor,
} from '../src/engine/seams.js';
import { SPRITES } from '../src/assets/sprites.js';
import {
  ITEMS,
  getItem,
  missingCatalogSprites,
} from '../src/content/items.js';
import {
  resolveItemSpawns,
  resolveItemTag,
} from '../src/content/spawns.js';
import { DoorType, resetSpecials } from '../src/dungeon/rooms.js';
import {
  addToInventory,
  ContentHero,
  createStarterHero,
  type ItemStack,
} from '../src/content/hero.js';
import { useInventorySlot } from '../src/content/actions.js';
import {
  gearDisplayName,
  heroDR,
  upgradeArmor,
  upgradeWeapon,
  weaponDamageRoll,
} from '../src/mechanics/hero.js';
import type { MechanicsRng } from '../src/mechanics/rng.js';

function makeLevel(w = 12, h = 12): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  }
  lvl.stairsUp = 5 * w + 5;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
}

function makeCtx(level: Level, seed = 1234): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: [],
    log: (m: string) => logs.push(m),
    killMob: (_m: MobActor) => {},
    addMob: (_m: MobActor, _d?: number) => {},
    syncMobs: () => {},
  };
  return { ctx, hero, logs };
}

/** Deterministic stub: normalIntRange returns the midpoint. */
function midRng(): MechanicsRng {
  return {
    float: (a: number, _b: number) => a,
    int: (a: number, _b: number) => a,
    intRange: (a: number, _b: number) => a,
    normalIntRange: (a: number, b: number) => Math.floor((a + b) / 2),
    pick: <T>(arr: readonly T[]): T => arr[0]!,
  };
}

describe('Scroll of Upgrade catalog', () => {
  test('scroll_upgrade def is registered and auto-identified', () => {
    const def = ITEMS['scroll_upgrade']!;
    expect(def.name).toBe('Scroll of Upgrade');
    expect(def.type).toBe('scroll');
    expect(def.stackable).toBe(true);
    expect(def.sprite).toBe('scroll_upgrade');
    expect(getItem('scroll_upgrade')).toBe(def);
  });

  test('scroll_upgrade sprite exists in the atlas', () => {
    expect('scroll_upgrade' in SPRITES).toBe(true);
    expect(SPRITES['scroll_upgrade']).toHaveLength(16);
    for (const row of SPRITES['scroll_upgrade']!) {
      expect(row).toHaveLength(16);
    }
    expect(missingCatalogSprites()).toEqual([]);
  });
});

describe('Scroll of Upgrade generation', () => {
  test('quest tag resolves to the real scroll', () => {
    const rng = new RNG(99);
    expect(resolveItemTag(rng, 2, 'scroll-of-upgrade')).toBe('scroll_upgrade');
    expect(resolveItemTag(rng, 4, 'scroll-of-upgrade')).toBe('scroll_upgrade');
  });

  test('souNeeded quota: scrolls appear on depths 1-4 at roughly the vanilla rate', () => {
    // Dungeon.java:288-303 — quota {5,3,10,6,15,9,20,12,25,13}; this checks
    // the distribution is sane, not the exact vanilla RNG stream.
    let found = 0;
    const depths = new Set<number>();
    for (let s = 1; s <= 60; s++) {
      const run = newRunState();
      resetSpecials(new RNG(s)); // vanilla shuffles special rooms once per run
      for (const depth of [1, 2, 3, 4]) {
        const rng = new RNG(s * 1000 + depth);
        const gen = generateLevel(rng, depth, run);
        const placed = resolveItemSpawns(rng, depth, gen.items);
        if (placed.some((p) => p.itemId === 'scroll_upgrade')) {
          found++;
          depths.add(depth);
        }
      }
    }
    // Expected total ~ (3/5 + 2/5 + 3/6 + 2/7) * 60 ≈ 107; allow wide bounds.
    expect(found).toBeGreaterThan(40);
    expect(found).toBeLessThan(170);
    // Depth 1 is eligible (unlike the old fixed depth-2/4 schedule).
    expect(depths.has(1)).toBe(true);
  });

  test('random scroll loot never yields Scroll of Upgrade (Generator.java:94, weight 0)', () => {
    const rng = new RNG(7);
    // prize-scroll / generic 'random' scroll draws stay the plain scroll.
    expect(resolveItemTag(rng, 1, 'prize-scroll')).toBe('scroll');
  });

  test('quest scrolls always drop on walkable, unlocked-room tiles', () => {
    // Vanilla-faithful: Level.create quest items must be obtainable —
    // never on water, never in a room behind a locked door, and never
    // consumed as a special-room prize (takeSpawnAsPrize).
    for (let s = 1; s <= 40; s++) {
      const run = newRunState();
      resetSpecials(new RNG(s * 31)); // vanilla shuffles special rooms once per run
      for (const depth of [1, 2, 3, 4]) {
        const rng = new RNG(s * 7919 + depth);
        const gen = generateLevel(rng, depth, run);
        const placed = resolveItemSpawns(rng, depth, gen.items);
        for (const p of placed) {
          if (p.itemId !== 'scroll_upgrade') continue;
          const x = p.pos % gen.level.w;
          const y = Math.floor(p.pos / gen.level.w);
          const tile = gen.level.get(x, y);
          expect(tile).not.toBe(Terrain.WATER);
          expect(gen.level.isPassable(x, y)).toBe(true);
          const room = gen.rooms.find((r) => x >= r.l && x <= r.r && y >= r.t && y <= r.b);
          expect(room).toBeDefined();
          expect(room!.doors.some((d) => d.type === DoorType.LOCKED)).toBe(false);
        }
      }
    }
  });
});

describe('upgrade mechanics (Item.java / Armor.java / MeleeWeapon.java)', () => {
  test('upgradeWeapon: +1 level, min/max shift by level and level*tier', () => {
    const rng = midRng();
    const w = { ...ITEMS['shortsword']!.weapon! };
    const before = weaponDamageRoll(rng, w, { str: 11, ranged: false });
    upgradeWeapon(w);
    expect(w.level).toBe(1);
    // midpoint of (1..12) is 6; midpoint of (2..13) is 7.
    expect(before).toBe(6);
    expect(weaponDamageRoll(rng, w, { str: 11, ranged: false })).toBe(7);
  });

  test('upgradeArmor: +1 level, DR +1, STR req -1', () => {
    const a = { ...ITEMS['cloth_armor']!.armor! };
    expect(a.str).toBe(9);
    upgradeArmor(a);
    expect(a.level).toBe(1);
    expect(a.str).toBe(8); // Armor.upgrade(): STR-- (Armor.java:167)
  });

  test('heroDR follows armor level (Armor.DR = tier*(2+level))', () => {
    const c = makeCtx(makeLevel());
    expect(heroDR(c.hero)).toBe(2);
    upgradeArmor(c.hero.armor!);
    expect(heroDR(c.hero)).toBe(3);
  });

  test('gearDisplayName adds the vanilla +N suffix', () => {
    expect(gearDisplayName({ name: 'short sword', level: 0 })).toBe(
      'short sword',
    );
    expect(gearDisplayName({ name: 'short sword', level: 2 })).toBe(
      'short sword +2',
    );
  });
});

describe('reading a Scroll of Upgrade', () => {
  function slotOf(hero: ContentHero, itemId: string): number {
    return hero.inventory.findIndex((s: ItemStack) => s.itemId === itemId);
  }

  test('reading upgrades the equipped weapon by +1 and consumes the scroll', () => {
    const c = makeCtx(makeLevel());
    addToInventory(c.hero, 'scroll_upgrade', 2);
    const slot = slotOf(c.hero, 'scroll_upgrade');
    expect(c.hero.weapon!.level).toBe(0);
    const cost = useInventorySlot(c.ctx, c.hero, slot);
    expect(cost).toBe(1); // TIME_TO_READ (Scroll.java:35)
    expect(c.hero.weapon!.level).toBe(1);
    expect(c.hero.inventory[slotOf(c.hero, 'scroll_upgrade')].qty).toBe(1);
    expect(
      c.logs.some((m) => m.includes('short sword +1 certainly looks better')),
    ).toBe(true);
  });

  test('armor is upgraded when no weapon is equipped', () => {
    const c = makeCtx(makeLevel());
    c.hero.weapon = null;
    c.hero.weaponId = null;
    addToInventory(c.hero, 'scroll_upgrade', 1);
    const slot = slotOf(c.hero, 'scroll_upgrade');
    useInventorySlot(c.ctx, c.hero, slot);
    expect(c.hero.armor!.level).toBe(1);
    expect(c.hero.armor!.str).toBe(8);
    expect(
      c.logs.some((m) => m.includes('cloth armor +1 certainly looks better')),
    ).toBe(true);
  });

  test('nothing equipped: scroll is not consumed', () => {
    const c = makeCtx(makeLevel());
    c.hero.weapon = null;
    c.hero.armor = null;
    addToInventory(c.hero, 'scroll_upgrade', 1);
    const slot = slotOf(c.hero, 'scroll_upgrade');
    useInventorySlot(c.ctx, c.hero, slot);
    expect(slotOf(c.hero, 'scroll_upgrade')).toBe(slot);
    expect(c.logs.some((m) => m.includes('nothing to upgrade'))).toBe(true);
  });

  test('other scrolls still cannot be read yet (M1)', () => {
    const c = makeCtx(makeLevel());
    addToInventory(c.hero, 'scroll', 1);
    const slot = slotOf(c.hero, 'scroll');
    useInventorySlot(c.ctx, c.hero, slot);
    expect(c.logs.some((m) => m.includes('cannot read'))).toBe(true);
    expect(slotOf(c.hero, 'scroll')).toBe(slot);
  });
});
